package dev.heldixclient.voice;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.player.LocalPlayer;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Sprachkanal zum Heldix-Dienst ({@code /v1/voice}, Protokoll in docs/dienst.md „Voice Chat“): verbindet sich nur, solange
 * ein Addon ihn eingeschaltet hat, der Dienst erreichbar ist und du auf einem Server spielst. Meldet Server, Welt und
 * Position (im Haupt-Thread), schickt Sprach-Rahmen der Addons und verteilt empfangene an ihre Listener (Netzwerk-Thread).
 * Die Sprache selbst (Aufnahme, Opus, Abspielen) macht das Addon. Ab Dienst 1.9.0 (features "state", "groups") kommen
 * der eigene Status (stumm, Ton aus) und Gruppen dazu: Für eine Gruppe geht nur ein SHA-256 aus Name und Passwort an den
 * Dienst. Ab Dienst 1.11.0 (feature "guests") sind auch Gäste und Spieler im Browser in der Gruppe ({@code guests} und
 * {@code browser} in "peers", ohne Position), Gäste lassen sich entfernen ("kick"), und für die Gruppe gibt es einen
 * Browser-Link (Einladung mit Gruppe über {@code POST /v1/invites}; den Prüfwert der Gruppe kennt nur der Client).
 * Ab Dienst 1.12.0 Party-Voice: Ohne eigene Gruppe nimmt der Kanal den Gruppen-Prüfwert der Party ({@code party.voice},
 * nur solange ein anderes Mitglied am selben Ort ist); wird er null oder verlässt man die Party, geht ein "join" ohne Gruppe raus.
 */
public final class VoiceLink {
	public enum Status {
		OFF,
		UNAVAILABLE,
		CONNECTING,
		CONNECTED
	}

	/** Empfänger von Rahmen (ein Addon), mit Namen für Fehlermeldungen */
	public record Sink(String owner, Receiver receiver) {
	}

	@FunctionalInterface
	public interface Receiver {
		void onFrame(UUID sender, int sequence, boolean last, byte[] frame);
	}

	private static final int VERSION = 1;
	/** so viele Rahmen höchstens in der Warteschlange; mehr wird verworfen (lieber Lücke als Verzögerung) */
	private static final int MAX_QUEUE = 12;
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();

	/** Addons, die den Kanal eingeschaltet haben */
	private static final Set<String> ACTIVE = ConcurrentHashMap.newKeySet();
	private static final Set<String> FRIENDS_ONLY = ConcurrentHashMap.newKeySet();
	private static final CopyOnWriteArrayList<Sink> SINKS = new CopyOnWriteArrayList<>();
	private static final ConcurrentLinkedQueue<Object> QUEUE = new ConcurrentLinkedQueue<>();
	private static final AtomicInteger QUEUED_AUDIO = new AtomicInteger();
	private static final AtomicBoolean SENDING = new AtomicBoolean();

	private static volatile WebSocket socket;
	private static volatile Status status = Status.OFF;
	private static volatile String statusText = "Aus";
	private static volatile int range = 48;
	private static volatile int maxFrame = 1024;
	private static volatile Set<UUID> peers = Set.of();
	/** Fähigkeiten des Dienstes aus "ready" (leer = Dienst 1.8.0) */
	private static volatile Set<String> features = Set.of();
	private static volatile boolean ready;
	private static volatile long connectedAt;
	private static volatile int maxGroup = 16;
	private static volatile Set<UUID> groupMembers = Set.of();
	private static final Set<UUID> PEER_MUTED = ConcurrentHashMap.newKeySet();
	private static final Set<UUID> PEER_DEAFENED = ConcurrentHashMap.newKeySet();
	/** Gäste unter den gelisteten (ID → Name) und wer über die Webseite dabei ist (ab Dienst 1.11.0) */
	private static volatile Map<UUID, String> guests = Map.of();
	private static volatile Set<UUID> browser = Set.of();
	/** eigener Status und Gruppe (von einem Addon gesetzt) */
	private static volatile boolean selfMuted;
	private static volatile boolean selfDeafened;
	private static volatile String groupOwner;
	private static volatile String groupName;
	private static volatile String groupKey;
	private static volatile boolean groupFull;
	/** die gemeldete Gruppe ist die der Party (ab Dienst 1.12.0) */
	private static volatile boolean partyGroupActive;
	private static volatile int generation;
	private static volatile long retryAt;
	private static int failures;

	/** zuletzt gemeldeter Raum und Position (Haupt-Thread); Server und Gruppe auch für den Browser-Link */
	private static String joinedRoom;
	private static boolean joinedFriendsOnly;
	private static volatile String joinedServer;
	private static volatile String joinedGroup;
	private static boolean sentMuted;
	private static boolean sentDeafened;
	private static boolean stateSent;
	private static double lastX = Double.NaN;
	private static double lastY;
	private static double lastZ;
	private static long lastPosAt;
	private static long lastPingAt;

	private VoiceLink() {
	}

	// ======================================================================================
	// Für die Addon-API
	// ======================================================================================

	public static void setActive(String owner, boolean active) {
		if (active) ACTIVE.add(owner);
		else {
			ACTIVE.remove(owner);
			FRIENDS_ONLY.remove(owner);
			if (owner.equals(groupOwner)) setGroup(owner, null, null);
		}
	}

	/** eigenen Status melden (stumm, Ton aus); geht beim nächsten Tick raus */
	public static void setState(boolean muted, boolean deafened) {
		selfMuted = muted;
		selfDeafened = deafened;
	}

	public static boolean peerMuted(UUID player) {
		return player != null && PEER_MUTED.contains(player);
	}

	public static boolean peerDeafened(UUID player) {
		return player != null && PEER_DEAFENED.contains(player);
	}

	/** Gruppe setzen (leerer Name = keine); geht beim nächsten Tick als neues "join" raus */
	public static void setGroup(String owner, String name, String password) {
		String trimmed = name == null ? "" : name.strip();
		if (trimmed.isEmpty()) {
			if (groupOwner == null || owner.equals(groupOwner)) {
				groupOwner = null;
				groupName = null;
				groupKey = null;
				groupFull = false;
			}
			return;
		}
		String key = groupKey(trimmed, password == null ? "" : password);
		if (key.equals(groupKey) && owner.equals(groupOwner)) return;
		groupOwner = owner;
		groupName = trimmed;
		groupKey = key;
		groupFull = false;
	}

	/** Prüfwert der Gruppe: SHA-256 aus festem Präfix, Name (klein) und Passwort, als 64 Hex-Zeichen */
	public static String groupKey(String name, String password) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			String text = "heldix-voice-group\n" + name.strip().toLowerCase(Locale.ROOT) + "\n" + password;
			return HexFormat.of().formatHex(digest.digest(text.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}

	public static String groupName() {
		return groupName;
	}

	/** Mitglieder der Gruppe, in der man gerade ist (eigene Gruppe oder die der Party) */
	public static Set<UUID> groupMembers() {
		return groupKey == null && !partyGroupActive ? Set.of() : groupMembers;
	}

	/** Ist man gerade in der Voice-Gruppe der Party (keine eigene Gruppe gesetzt)? */
	public static boolean inPartyGroup() {
		return partyGroupActive && status == Status.CONNECTED;
	}

	/** Nur für automatische Tests: Prüfwert der Gruppe, die zuletzt mit "join" an den Dienst ging (null = keine) */
	public static String joinedGroup() {
		return joinedGroup;
	}

	public static boolean groupsAvailable() {
		return status == Status.CONNECTED && features.contains("groups");
	}

	/** Warum die Gruppe nicht klappt, sonst null */
	public static String groupProblem() {
		if (groupKey == null || status != Status.CONNECTED || !ready) return null;
		if (!features.contains("groups")) return "Der Heldix-Dienst kann noch keine Gruppen";
		if (groupFull) return "Gruppe ist voll (höchstens " + maxGroup + ")";
		return null;
	}

	// --- Gäste und Browser-Teilnehmer (Dienst 1.11.0, feature "guests") -------------------------

	/** Kann der Dienst Gäste, Browser-Teilnehmer und Browser-Links? (false, solange nicht verbunden) */
	public static boolean guestsAvailable() {
		return status == Status.CONNECTED && features.contains("guests");
	}

	public static boolean isGuest(UUID participant) {
		return participant != null && guests.containsKey(participant);
	}

	/** über die Webseite dabei (Gast oder angemeldeter Spieler im Browser)? */
	public static boolean inBrowser(UUID participant) {
		return participant != null && (browser.contains(participant) || guests.containsKey(participant));
	}

	/** Name eines Gasts (vom Dienst geprüft), sonst null */
	public static String guestName(UUID participant) {
		return participant == null ? null : guests.get(participant);
	}

	/** Gäste unter den gelisteten Teilnehmern (ID → Name) */
	public static Map<UUID, String> guests() {
		return guests;
	}

	/** Gast aus der Gruppe entfernen ("kick"); false, wenn es kein Gast der Gruppe ist oder der Dienst das nicht kann */
	public static boolean removeGuest(UUID guest) {
		if (!guestsAvailable() || !isGuest(guest)) return false;
		JsonObject kick = new JsonObject();
		kick.addProperty("type", "kick");
		kick.addProperty("uuid", Social.compact(guest));
		sendText(kick);
		return true;
	}

	/** Warum es gerade keinen Browser-Link für die Gruppe gibt (deutsch), null = es geht */
	public static String browserLinkProblem() {
		if (status != Status.CONNECTED) return status == Status.OFF ? "Voice Chat ist aus – schalte ihn zuerst ein" : statusText;
		if (!ready && System.currentTimeMillis() - connectedAt < 5000) return "Voice Chat verbindet gerade – versuch es gleich noch einmal";
		if (!features.contains("guests")) return "Der Heldix-Dienst kann noch keine Gäste im Browser (ab Dienst 1.11.0)";
		if (groupKey == null) return "Du bist in keiner Voice-Gruppe – trag zuerst eine Gruppe ein";
		if (groupFull) return "Gruppe ist voll (höchstens " + maxGroup + ")";
		if (joinedServer == null || !groupKey.equals(joinedGroup)) return "Die Gruppe wird gerade betreten – versuch es gleich noch einmal";
		return null;
	}

	/**
	 * Browser-Link für die aktuelle Gruppe auf dem aktuellen Server (Einladung mit Gruppe, 24 Stunden). Schlägt mit einer
	 * deutschen Meldung fehl ({@link Social.ServiceException}), wenn es gerade nicht geht.
	 */
	public static CompletableFuture<Social.Invite> createBrowserLink() {
		String problem = browserLinkProblem();
		if (problem != null) return CompletableFuture.failedFuture(new Social.ServiceException(problem));
		return Social.createInvite(joinedServer, joinedGroup);
	}

	public static boolean isActive(String owner) {
		return ACTIVE.contains(owner);
	}

	public static void setFriendsOnly(String owner, boolean friendsOnly) {
		if (friendsOnly) FRIENDS_ONLY.add(owner);
		else FRIENDS_ONLY.remove(owner);
	}

	public static void addSink(Sink sink) {
		SINKS.add(sink);
	}

	public static void removeSink(Sink sink) {
		SINKS.remove(sink);
	}

	/** Addon abgeschaltet oder entladen: alles von ihm abmelden */
	public static void forget(String owner) {
		setActive(owner, false);
		SINKS.removeIf(sink -> sink.owner().equals(owner));
		if (ACTIVE.isEmpty()) setState(false, false);
	}

	public static Status status() {
		return status;
	}

	public static String statusText() {
		return statusText;
	}

	public static int range() {
		return range;
	}

	public static int maxFrameSize() {
		return maxFrame;
	}

	public static Set<UUID> peers() {
		return peers;
	}

	/** Rahmen senden (jeder Thread); false = nicht verbunden, zu groß oder Warteschlange voll */
	public static boolean send(byte[] frame, int sequence, boolean last) {
		if (status != Status.CONNECTED || frame == null || frame.length == 0 || frame.length > maxFrame) return false;
		if (QUEUED_AUDIO.get() >= MAX_QUEUE) return false;
		ByteBuffer buffer = ByteBuffer.allocate(4 + frame.length);
		buffer.put((byte) VERSION).put((byte) (last ? 1 : 0)).putShort((short) (sequence & 0xFFFF)).put(frame).flip();
		QUEUED_AUDIO.incrementAndGet();
		QUEUE.add(buffer);
		pump();
		return true;
	}

	// ======================================================================================
	// Haupt-Thread: verbinden, Raum und Position melden
	// ======================================================================================

	/** jeden Client-Tick */
	public static void tick(Minecraft mc) {
		if (ACTIVE.isEmpty()) {
			if (socket != null || status != Status.OFF) disconnect(Status.OFF, "Aus");
			return;
		}
		String why = unavailable(mc);
		if (why != null) {
			if (socket != null || status != Status.UNAVAILABLE || !why.equals(statusText)) disconnect(Status.UNAVAILABLE, why);
			return;
		}
		if (socket == null) {
			if (status != Status.CONNECTING && System.currentTimeMillis() >= retryAt) connect();
			return;
		}
		if (status != Status.CONNECTED) return;
		long now = System.currentTimeMillis();
		// erst nach "ready" (Fähigkeiten des Dienstes); kommt es nicht, nach 5 s trotzdem
		if (!ready && now - connectedAt < 5000) return;
		LocalPlayer player = mc.player;
		String room = room(mc);
		boolean friendsOnly = !FRIENDS_ONLY.isEmpty();
		// eigene Gruppe hat Vorrang; sonst die Gruppe der Party (Prüfwert vom Dienst, nur mit Mitgliedern am selben Ort)
		String group = !features.contains("groups") ? null : groupKey != null ? groupKey : dev.heldixclient.social.Party.voiceGroup(serverAddress(mc));
		partyGroupActive = group != null && groupKey == null;
		if (!room.equals(joinedRoom) || friendsOnly != joinedFriendsOnly || !Objects.equals(group, joinedGroup)) {
			JsonObject join = new JsonObject();
			join.addProperty("type", "join");
			join.addProperty("server", serverAddress(mc));
			join.addProperty("dimension", mc.level.dimension().identifier().toString());
			join.addProperty("mode", friendsOnly ? "friends" : "all");
			if (group != null) join.addProperty("group", group);
			if (!Objects.equals(group, joinedGroup)) {
				groupFull = false;
				if (group == null) groupMembers = Set.of();
			}
			sendText(join);
			joinedServer = serverAddress(mc);
			joinedRoom = room;
			joinedFriendsOnly = friendsOnly;
			joinedGroup = group;
			lastX = Double.NaN;
		}
		if (features.contains("state") && (!stateSent || selfMuted != sentMuted || selfDeafened != sentDeafened)) {
			JsonObject state = new JsonObject();
			state.addProperty("type", "state");
			state.addProperty("muted", selfMuted);
			state.addProperty("deafened", selfDeafened);
			sendText(state);
			sentMuted = selfMuted;
			sentDeafened = selfDeafened;
			stateSent = true;
		}
		double dx = player.getX() - lastX;
		double dy = player.getY() - lastY;
		double dz = player.getZ() - lastZ;
		boolean moved = Double.isNaN(lastX) || dx * dx + dy * dy + dz * dz > 0.25 * 0.25;
		if (moved && now - lastPosAt >= 200 || now - lastPosAt >= 2000) {
			JsonObject pos = new JsonObject();
			pos.addProperty("type", "pos");
			pos.addProperty("x", Math.round(player.getX() * 100) / 100.0);
			pos.addProperty("y", Math.round(player.getY() * 100) / 100.0);
			pos.addProperty("z", Math.round(player.getZ() * 100) / 100.0);
			sendText(pos);
			lastX = player.getX();
			lastY = player.getY();
			lastZ = player.getZ();
			lastPosAt = now;
		}
		if (now - lastPingAt >= 20_000) {
			JsonObject ping = new JsonObject();
			ping.addProperty("type", "ping");
			sendText(ping);
			lastPingAt = now;
		}
	}

	/** Grund, warum es gerade nicht geht, sonst null */
	private static String unavailable(Minecraft mc) {
		if (Social.baseUrl().isEmpty()) return "Heldix-Dienst nicht eingerichtet";
		if (Social.state() == Social.State.OFFLINE_ACCOUNT) return "Nur mit Microsoft-Konto";
		if (!Social.online()) return "Keine Verbindung zum Heldix-Dienst";
		if (mc.level == null || mc.player == null) return "Nur in einer Welt";
		if (serverAddress(mc) == null) return "Nur auf Servern und in geteilten Welten";
		return null;
	}

	/**
	 * Adresse des Servers (klein geschrieben, wie für die Anwesenheit); im Einzelspieler null – außer die Welt ist geteilt
	 * (dann die Weltadresse: Gastgeber und Mitspieler sind im selben Raum) oder im Autotest, der mit
	 * -Dheldixclient.voice.testServer=… einen Raum für die eigene Welt vorgibt. Heldix-Welten ohne den Standard-Port.
	 */
	private static String serverAddress(Minecraft mc) {
		if (mc.isLocalServer()) {
			String shared = dev.heldixclient.share.WorldShare.voiceServer();
			if (shared != null) return shared;
			String test = System.getProperty("heldixclient.voice.testServer", "").trim();
			return test.isEmpty() ? null : test.toLowerCase(Locale.ROOT);
		}
		ServerData server = mc.getCurrentServer();
		if (server == null) return null;
		if (dev.heldixclient.share.WorldShare.isWorldAddress(server.ip)) return dev.heldixclient.share.WorldShare.normalizeAddress(server.ip);
		return server.ip.trim().toLowerCase(Locale.ROOT);
	}

	private static String room(Minecraft mc) {
		return serverAddress(mc) + "|" + mc.level.dimension().identifier();
	}

	private static void connect() {
		String token = Social.serviceToken();
		if (token == null) return;
		int gen = ++generation;
		status = Status.CONNECTING;
		statusText = "Verbinde …";
		joinedRoom = null;
		joinedServer = null;
		joinedGroup = null;
		stateSent = false;
		ready = false;
		features = Set.of();
		String url = Social.baseUrl().replaceFirst("^http", "ws") + "/v1/voice";
		HTTP.newWebSocketBuilder()
				.header("Authorization", "Bearer " + token)
				.connectTimeout(Duration.ofSeconds(10))
				.buildAsync(URI.create(url), new Listener(gen))
				.whenComplete((ws, error) -> {
					if (gen != generation) {
						if (ws != null) ws.abort();
						return;
					}
					if (error != null) {
						failed(error.getCause() != null ? error.getCause() : error);
						return;
					}
					socket = ws;
					connectedAt = System.currentTimeMillis();
					status = Status.CONNECTED;
					statusText = "Verbunden";
					failures = 0;
					HeldixClient.LOGGER.info("Voice Chat: mit dem Heldix-Dienst verbunden");
				});
	}

	private static void failed(Throwable error) {
		String message = String.valueOf(error.getMessage());
		boolean missing = message.contains("404") || message.contains("Bad status");
		failures++;
		// mit wachsender Pause neu versuchen (5 s bis 60 s); ohne Voice Chat beim Dienst seltener
		long delay = missing ? 120_000 : Math.min(60_000, 5_000L * failures);
		retryAt = System.currentTimeMillis() + delay;
		socket = null;
		status = Status.UNAVAILABLE;
		statusText = missing ? "Der Heldix-Dienst bietet keinen Voice Chat an" : "Keine Verbindung – neuer Versuch gleich";
		HeldixClient.LOGGER.info("Voice Chat: Verbindung fehlgeschlagen ({})", error.toString());
	}

	private static void disconnect(Status newStatus, String text) {
		generation++;
		WebSocket ws = socket;
		socket = null;
		if (ws != null) ws.abort();
		QUEUE.clear();
		QUEUED_AUDIO.set(0);
		SENDING.set(false);
		clearRoom();
		joinedRoom = null;
		joinedServer = null;
		joinedGroup = null;
		partyGroupActive = false;
		stateSent = false;
		ready = false;
		status = newStatus;
		statusText = text;
	}

	/** Raum, Gruppe und Status der anderen vergessen (getrennt) */
	private static void clearRoom() {
		peers = Set.of();
		groupMembers = Set.of();
		PEER_MUTED.clear();
		PEER_DEAFENED.clear();
		guests = Map.of();
		browser = Set.of();
	}

	// ======================================================================================
	// Senden: immer nacheinander (WebSocket erlaubt kein gleichzeitiges Senden)
	// ======================================================================================

	private static void sendText(JsonObject message) {
		QUEUE.add(message.toString());
		pump();
	}

	private static void pump() {
		WebSocket ws = socket;
		if (ws == null || !SENDING.compareAndSet(false, true)) return;
		Object next = QUEUE.poll();
		if (next == null) {
			SENDING.set(false);
			// Rennen: zwischen poll und set kam etwas dazu
			if (!QUEUE.isEmpty()) pump();
			return;
		}
		CompletionStage<WebSocket> sent;
		if (next instanceof ByteBuffer buffer) {
			QUEUED_AUDIO.decrementAndGet();
			sent = ws.sendBinary(buffer, true);
		} else {
			sent = ws.sendText((String) next, true);
		}
		sent.whenComplete((result, error) -> {
			SENDING.set(false);
			if (error != null) {
				HeldixClient.LOGGER.debug("Voice Chat: Senden fehlgeschlagen", error);
				return;
			}
			pump();
		});
	}

	// ======================================================================================
	// Empfangen (Netzwerk-Thread)
	// ======================================================================================

	private static final class Listener implements WebSocket.Listener {
		private final int gen;
		private final StringBuilder text = new StringBuilder();
		private final ByteArrayOutputStream binary = new ByteArrayOutputStream();

		Listener(int gen) {
			this.gen = gen;
		}

		@Override
		public void onOpen(WebSocket webSocket) {
			webSocket.request(1);
		}

		@Override
		public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
			text.append(data);
			if (last) {
				String message = text.toString();
				text.setLength(0);
				if (gen == generation) handleText(message);
			}
			webSocket.request(1);
			return null;
		}

		@Override
		public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
			byte[] chunk = new byte[data.remaining()];
			data.get(chunk);
			binary.write(chunk, 0, chunk.length);
			if (last) {
				byte[] frame = binary.toByteArray();
				binary.reset();
				if (gen == generation) handleBinary(frame);
			}
			webSocket.request(1);
			return null;
		}

		@Override
		public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
			if (gen == generation) {
				socket = null;
				clearRoom();
				ready = false;
				status = Status.UNAVAILABLE;
				statusText = statusCode == 4002 ? "In einem anderen Spiel oder im Browser verbunden" : "Verbindung getrennt – neuer Versuch gleich";
				retryAt = System.currentTimeMillis() + (statusCode == 4002 ? 60_000 : 5_000);
				HeldixClient.LOGGER.info("Voice Chat: Verbindung getrennt ({})", statusCode);
			}
			return null;
		}

		@Override
		public void onError(WebSocket webSocket, Throwable error) {
			if (gen == generation) failed(error);
		}
	}

	private static void handleText(String message) {
		JsonObject json;
		try {
			JsonElement element = JsonParser.parseString(message);
			if (!element.isJsonObject()) return;
			json = element.getAsJsonObject();
		} catch (RuntimeException e) {
			return;
		}
		String type = json.has("type") ? json.get("type").getAsString() : "";
		switch (type) {
			case "ready" -> {
				if (json.has("range")) range = Math.clamp(json.get("range").getAsInt(), 1, 256);
				if (json.has("maxFrame")) maxFrame = Math.clamp(json.get("maxFrame").getAsInt(), 16, 4096);
				if (json.has("maxGroup")) maxGroup = Math.clamp(json.get("maxGroup").getAsInt(), 2, 256);
				features = Set.copyOf(strings(json, "features"));
				ready = true;
			}
			case "peers" -> {
				Set<UUID> set = uuids(json, "uuids");
				peers = Set.copyOf(set);
				groupMembers = Set.copyOf(uuids(json, "group"));
				Set<UUID> muted = uuids(json, "muted");
				Set<UUID> deafened = uuids(json, "deafened");
				PEER_MUTED.retainAll(muted);
				PEER_MUTED.addAll(muted);
				PEER_DEAFENED.retainAll(deafened);
				PEER_DEAFENED.addAll(deafened);
				// ab Dienst 1.11.0: Gäste (mit Namen) und wer über die Webseite dabei ist; ältere Dienste schicken beides nicht
				guests = guestNames(json);
				browser = Set.copyOf(uuids(json, "browser"));
				statusText = set.isEmpty() ? "Verbunden – noch niemand hier" : set.size() == 1 ? "Verbunden – 1 Spieler hier" : "Verbunden – " + set.size() + " Spieler hier";
			}
			case "state" -> {
				UUID uuid = json.has("uuid") ? Social.uuid(json.get("uuid").getAsString()) : null;
				if (uuid == null) return;
				boolean muted = json.has("muted") && json.get("muted").getAsBoolean();
				boolean deafened = json.has("deafened") && json.get("deafened").getAsBoolean();
				if (muted) PEER_MUTED.add(uuid);
				else PEER_MUTED.remove(uuid);
				if (deafened) PEER_DEAFENED.add(uuid);
				else PEER_DEAFENED.remove(uuid);
			}
			case "group" -> {
				if (json.has("status") && "full".equals(json.get("status").getAsString())) {
					groupFull = true;
					groupMembers = Set.of();
				}
			}
			default -> {
			}
		}
	}

	/** "guests": { "<32 hex>": "<Name>" } – Namen ohne Steuerzeichen und §, höchstens 24 Zeichen */
	private static Map<UUID, String> guestNames(JsonObject json) {
		if (!json.has("guests") || !json.get("guests").isJsonObject()) return Map.of();
		Map<UUID, String> map = new HashMap<>();
		for (Map.Entry<String, JsonElement> entry : json.getAsJsonObject("guests").entrySet()) {
			UUID id = Social.uuid(entry.getKey());
			if (id == null || !entry.getValue().isJsonPrimitive()) continue;
			String name = entry.getValue().getAsString().replaceAll("[\\p{Cc}\\p{Cf}§]", "").strip();
			if (name.length() > 24) name = name.substring(0, 24);
			map.put(id, name.isEmpty() ? "Gast" : name);
			if (map.size() >= 64) break;
		}
		return Map.copyOf(map);
	}

	private static Set<UUID> uuids(JsonObject json, String field) {
		Set<UUID> set = new HashSet<>();
		for (String value : strings(json, field)) {
			UUID uuid = Social.uuid(value);
			if (uuid != null) set.add(uuid);
		}
		return set;
	}

	private static Set<String> strings(JsonObject json, String field) {
		Set<String> set = new HashSet<>();
		if (!json.has(field) || !json.get(field).isJsonArray()) return set;
		for (JsonElement element : json.getAsJsonArray(field)) {
			if (element.isJsonPrimitive()) set.add(element.getAsString());
		}
		return set;
	}

	private static void handleBinary(byte[] data) {
		if (data.length < 21 || data[0] != VERSION) return;
		boolean last = (data[1] & 1) != 0;
		int sequence = ((data[2] & 0xFF) << 8) | (data[3] & 0xFF);
		ByteBuffer uuidBytes = ByteBuffer.wrap(data, 4, 16);
		UUID sender = new UUID(uuidBytes.getLong(), uuidBytes.getLong());
		byte[] frame = new byte[data.length - 20];
		System.arraycopy(data, 20, frame, 0, frame.length);
		for (Sink sink : SINKS) {
			try {
				sink.receiver().onFrame(sender, sequence, last, frame);
			} catch (Throwable t) {
				HeldixClient.LOGGER.warn("Voice Chat: Fehler im Addon {} beim Empfangen", sink.owner(), t);
			}
		}
	}
}
