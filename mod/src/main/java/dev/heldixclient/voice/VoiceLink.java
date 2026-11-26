package dev.heldixclient.voice;

import com.google.gson.JsonArray;
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
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
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
 * Die Sprache selbst (Aufnahme, Opus, Abspielen) macht das Addon.
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
	private static volatile int generation;
	private static volatile long retryAt;
	private static int failures;

	/** zuletzt gemeldeter Raum und Position (Haupt-Thread) */
	private static String joinedRoom;
	private static boolean joinedFriendsOnly;
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
		}
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
		LocalPlayer player = mc.player;
		String room = room(mc);
		boolean friendsOnly = !FRIENDS_ONLY.isEmpty();
		if (!room.equals(joinedRoom) || friendsOnly != joinedFriendsOnly) {
			JsonObject join = new JsonObject();
			join.addProperty("type", "join");
			join.addProperty("server", serverAddress(mc));
			join.addProperty("dimension", mc.level.dimension().identifier().toString());
			join.addProperty("mode", friendsOnly ? "friends" : "all");
			sendText(join);
			joinedRoom = room;
			joinedFriendsOnly = friendsOnly;
			lastX = Double.NaN;
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
		if (serverAddress(mc) == null) return "Nur auf Servern";
		return null;
	}

	/**
	 * Adresse des Servers (klein geschrieben, wie für die Anwesenheit); im Einzelspieler null – außer im Autotest, der mit
	 * -Dheldixclient.voice.testServer=… einen Raum für die eigene Welt vorgibt.
	 */
	private static String serverAddress(Minecraft mc) {
		if (mc.isLocalServer()) {
			String test = System.getProperty("heldixclient.voice.testServer", "").trim();
			return test.isEmpty() ? null : test.toLowerCase(Locale.ROOT);
		}
		ServerData server = mc.getCurrentServer();
		return server == null ? null : server.ip.trim().toLowerCase(Locale.ROOT);
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
		peers = Set.of();
		joinedRoom = null;
		status = newStatus;
		statusText = text;
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
				peers = Set.of();
				status = Status.UNAVAILABLE;
				statusText = statusCode == 4002 ? "In einem anderen Spiel verbunden" : "Verbindung getrennt – neuer Versuch gleich";
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
			}
			case "peers" -> {
				Set<UUID> set = new HashSet<>();
				if (json.has("uuids") && json.get("uuids").isJsonArray()) {
					JsonArray array = json.getAsJsonArray("uuids");
					for (JsonElement element : array) {
						UUID uuid = Social.uuid(element.getAsString());
						if (uuid != null) set.add(uuid);
					}
				}
				peers = Set.copyOf(set);
				statusText = set.isEmpty() ? "Verbunden – noch niemand hier" : set.size() == 1 ? "Verbunden – 1 Spieler hier" : "Verbunden – " + set.size() + " Spieler hier";
			}
			default -> {
			}
		}
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
