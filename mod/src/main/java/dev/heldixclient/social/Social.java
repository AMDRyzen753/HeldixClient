package dev.heldixclient.social;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.cosmetic.Capes;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.loader.api.event.ClientEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.User;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.AbstractClientPlayer;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Verbindung zum Heldix-Dienst (siehe docs/dienst.md): Capes anderer HeldixClient-Spieler, Heldix-Symbol (mit Rolle) in
 * der Tab-Liste und über Köpfen und Freunde mit Online-Status.
 *
 * <p>Anmeldung wie beim Betreten eines Minecraft-Servers: Der Dienst gibt eine serverId aus, der Client meldet bei
 * Mojang den Beitritt (Session-Service von Minecraft), der Dienst prüft das bei Mojang. Das Zugangs-Token verlässt
 * den PC dabei nie in Richtung Dienst. Netzwerk läuft auf einem eigenen Thread, nie im Hauptthread.
 */
public final class Social {
	public enum State {
		/** keine Adresse des Dienstes eingetragen */
		DISABLED,
		/** vom Spieler ausgeschaltet */
		OFF,
		/** Offline-Konto: der Dienst braucht ein Microsoft-Konto */
		OFFLINE_ACCOUNT,
		CONNECTING,
		ONLINE,
		ERROR
	}

	public record Friend(UUID uuid, String name, boolean online, String state, String server, long since) {
		/** Was der Freund gerade macht, für die Anzeige */
		public String activity() {
			if (!online) return "Offline";
			if (state == null) return "Online";
			return switch (state) {
				case "menu" -> "Im Hauptmenü";
				case "singleplayer" -> "Spielt Einzelspieler";
				case "multiplayer" -> server != null ? "Spielt auf " + server : "Spielt auf einem Server";
				case "realms" -> "Spielt auf Realms";
				case "lan" -> "Spielt im LAN";
				default -> "Online";
			};
		}
	}

	public record Request(UUID uuid, String name, long at) {
	}

	/**
	 * Ergebnis des Nachschlagens; role ist bei heldix immer gesetzt (PLAYER ohne besondere Rolle). cosmetics: Slot → ID
	 * (head, back, aura, companion; nur belegte Slots, wie vom Dienst gemeldet).
	 */
	private record Lookup(boolean heldix, String cape, Badge.Role role, Map<String, String> cosmetics, long at) {
	}

	private static final long LOOKUP_POSITIVE_MS = 30_000;
	private static final long LOOKUP_NEGATIVE_MS = 90_000;
	private static final int LOOKUP_BATCH = 200;

	// HTTP/1.1: sonst versucht Java bei http:// ein Upgrade auf HTTP/2 (h2c), das der Dienst nicht kennt
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
	static final ScheduledExecutorService NET = Executors.newSingleThreadScheduledExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Dienst");
		thread.setDaemon(true);
		return thread;
	});

	private static volatile State state = State.DISABLED;
	private static volatile String error;
	private static volatile String token;
	private static volatile WebSocket socket;
	/** steigt bei jedem Verbindungsversuch: alte Verbindungen erkennen sich daran */
	private static volatile int generation;
	private static int attempt;
	private static ScheduledFuture<?> retry;

	private static volatile List<Friend> friends = List.of();
	private static volatile List<Request> incoming = List.of();
	private static volatile List<Request> outgoing = List.of();

	private static final Map<UUID, Lookup> LOOKUP = new ConcurrentHashMap<>();
	private static final Set<UUID> PENDING = ConcurrentHashMap.newKeySet();
	private static int tickCounter;

	private static volatile String statusMode = "menu";
	private static volatile String statusServer;

	private Social() {
	}

	// ======================================================================================
	// Start, Zustand
	// ======================================================================================

	public static void init() {
		// erst im ersten Client-Tick verbinden: dann gibt es Minecraft und das angemeldete Konto sicher
		ClientEvents.TICK_END.register(Social::tick);
		ClientEvents.TICK_END.register(BadgeDisplay::tick);
		NET.scheduleAtFixedRate(Social::ping, 30, 30, TimeUnit.SECONDS);
	}

	private static boolean started;

	/** Adresse des Dienstes: Einstellung, sonst vom Launcher (-Dheldixclient.service) */
	public static String baseUrl() {
		String configured = HeldixConfig.get().serviceUrl;
		String url = configured != null && !configured.isBlank() ? configured : System.getProperty("heldixclient.service", "");
		url = url.trim();
		while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
		return url;
	}

	/** Nur für automatische Tests: Anmeldung ohne Mojang (der Dienst muss im Entwicklungsmodus laufen) */
	private static boolean devAuth() {
		return Boolean.getBoolean("heldixclient.service.dev");
	}

	public static State state() {
		return state;
	}

	public static String error() {
		return error;
	}

	public static boolean online() {
		return state == State.ONLINE;
	}

	/** Anmeldung beim Dienst für den Sprachkanal (VoiceLink); null ohne Verbindung. Nie loggen oder weitergeben. */
	public static String serviceToken() {
		return state == State.ONLINE ? token : null;
	}

	/** Ist der Spieler ein Freund? (laut Freundesliste des Dienstes) */
	public static boolean isFriend(UUID uuid) {
		for (Friend friend : friends) if (friend.uuid().equals(uuid)) return true;
		return false;
	}

	public static List<Friend> friends() {
		return friends;
	}

	public static List<Request> incoming() {
		return incoming;
	}

	public static List<Request> outgoing() {
		return outgoing;
	}

	/** Verbindung (neu) aufbauen, z. B. nach dem Start oder einem Fehler */
	public static synchronized void connect() {
		int gen = ++generation;
		if (retry != null) retry.cancel(false);
		retry = null;
		closeSocket();
		token = null;
		if (baseUrl().isEmpty()) {
			state = State.DISABLED;
			return;
		}
		if (!HeldixConfig.get().socialEnabled) {
			goOffline(State.OFF);
			return;
		}
		User user = Minecraft.getInstance().getUser();
		String accessToken = user.getAccessToken();
		if (!devAuth() && (accessToken == null || accessToken.isBlank() || accessToken.equals("0") || accessToken.indexOf('.') < 0)) {
			state = State.OFFLINE_ACCOUNT;
			return;
		}
		state = State.CONNECTING;
		error = null;
		NET.execute(() -> {
			try {
				login(user);
				if (gen != generation) return;
				fetchCosmetics();
				syncProfile();
				openSocket(gen);
			} catch (Exception e) {
				if (gen != generation) return;
				fail(e);
			}
		});
	}

	/** Verbindung beenden und alles vergessen, was vom Dienst kam */
	private static synchronized void goOffline(State newState) {
		++generation;
		if (retry != null) retry.cancel(false);
		retry = null;
		closeSocket();
		token = null;
		friends = List.of();
		incoming = List.of();
		outgoing = List.of();
		LOOKUP.clear();
		Messages.reset();
		state = newState;
	}

	/** wie oft im Spiel das Konto gewechselt wurde (für den Autotest) */
	private static volatile int accountChanges;
	/** Konto, für das nach dem letzten Wechsel neu angemeldet wurde */
	private static volatile UUID accountChangedTo;

	/**
	 * Konto im Spiel gewechselt (dev.heldixclient.account): alles vom alten Konto vergessen – Anmeldung beim Dienst,
	 * Freunde, Anfragen, Nachrichten, nachgeschlagene Spieler – und mit dem neuen Konto neu anmelden.
	 */
	public static synchronized void accountChanged() {
		accountChanges++;
		accountChangedTo = Minecraft.getInstance().getUser().getProfileId();
		attempt = 0;
		goOffline(State.CONNECTING);
		connect();
	}

	public static int accountChanges() {
		return accountChanges;
	}

	public static UUID accountChangedTo() {
		return accountChangedTo;
	}

	/** Heldix-Dienst ein- oder ausschalten (Heldix-Menü → Freunde) */
	public static void setEnabled(boolean enabled) {
		HeldixConfig.get().socialEnabled = enabled;
		HeldixConfig.save();
		if (enabled) connect();
		else goOffline(State.OFF);
	}

	/**
	 * Alles löschen, was der Dienst über diesen Spieler gespeichert hat (DELETE /v1/me), und den Dienst danach
	 * ausschalten – sonst würde die nächste Anmeldung sofort ein neues Konto anlegen.
	 */
	public static CompletableFuture<Void> deleteAccount() {
		CompletableFuture<Void> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			try {
				call("DELETE", "/v1/me", null, true);
				dev.heldixclient.cosmetic.Cosmetics.forgetMine();
				HeldixConfig.get().socialEnabled = false;
				HeldixConfig.save();
				goOffline(State.OFF);
				result.complete(null);
			} catch (Exception e) {
				result.completeExceptionally(e instanceof ServiceException ? e : new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	private static synchronized void fail(Exception e) {
		state = State.ERROR;
		error = e instanceof ServiceException ? e.getMessage() : "Dienst nicht erreichbar";
		if (!(e instanceof ServiceException)) HeldixClient.LOGGER.info("Heldix-Dienst: {}", e.toString());
		else HeldixClient.LOGGER.info("Heldix-Dienst: {}", e.getMessage());
		scheduleRetry();
	}

	private static synchronized void scheduleRetry() {
		if (retry != null) retry.cancel(false);
		long delay = Math.min(120, 5L << Math.min(attempt, 5));
		attempt++;
		int gen = generation;
		retry = NET.schedule(() -> {
			if (gen == generation) connect();
		}, delay, TimeUnit.SECONDS);
	}

	// ======================================================================================
	// Anmeldung und Profil
	// ======================================================================================

	private static void login(User user) throws Exception {
		JsonObject result;
		if (devAuth()) {
			JsonObject body = new JsonObject();
			body.addProperty("name", user.getName());
			body.addProperty("uuid", compact(user.getProfileId()));
			result = call("POST", "/v1/auth/dev", body, false);
		} else {
			String serverId = call("POST", "/v1/auth/challenge", null, false).get("serverId").getAsString();
			// wie beim Betreten eines Servers: Mojang bestätigt dem Dienst, wem diese UUID gehört
			Minecraft.getInstance().services().sessionService().joinServer(user.getProfileId(), user.getAccessToken(), serverId);
			JsonObject body = new JsonObject();
			body.addProperty("name", user.getName());
			body.addProperty("serverId", serverId);
			result = call("POST", "/v1/auth/login", body, false);
		}
		token = result.get("token").getAsString();
	}

	/** Eigene Auswahl an Cosmetics und ob man Team-Cosmetics wählen darf (GET /v1/me/cosmetics, ab Dienst 1.6.0) */
	private static void fetchCosmetics() {
		try {
			dev.heldixclient.cosmetic.Cosmetics.applyMine(call("GET", "/v1/me/cosmetics", null, true));
		} catch (Exception e) {
			HeldixClient.LOGGER.info("Heldix-Dienst: Cosmetics nicht geladen ({})", e.getMessage());
		}
	}

	/** Cosmetic im Slot anlegen oder ablegen (PUT /v1/me/cosmetics); Ergebnis: MyCosmetics des Dienstes */
	public static CompletableFuture<JsonObject> putCosmetic(String slot, String id) {
		CompletableFuture<JsonObject> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			try {
				JsonObject body = new JsonObject();
				body.addProperty("slot", slot);
				if (id == null) body.add("id", com.google.gson.JsonNull.INSTANCE);
				else body.addProperty("id", id);
				result.complete(call("PUT", "/v1/me/cosmetics", body, true));
			} catch (Exception e) {
				result.completeExceptionally(e instanceof ServiceException ? e : new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	/** Eigene Einstellungen (Cape, Sichtbarkeit) an den Dienst schicken – die lokale Einstellung gilt. */
	private static void syncProfile() throws Exception {
		HeldixConfig.Data config = HeldixConfig.get();
		JsonObject body = new JsonObject();
		// eigene Bilder bleiben auf dem PC: nur Heldix-Capes gehen an den Dienst. Ein Katalog-Cape nur, wenn es im
		// geprüften Katalog steht (und man es wählen darf) – sonst bleibt die Auswahl beim Dienst, wie sie ist.
		String capeId = config.cape == null ? "" : config.cape;
		if (capeId.isEmpty() || Capes.isBuiltin(capeId)) body.addProperty("cape", capeId);
		else if (capeId.startsWith("datei:")) body.addProperty("cape", "");
		else {
			dev.heldixclient.cosmetic.CosmeticCatalog.Item item = dev.heldixclient.cosmetic.CosmeticCatalog.item(capeId, "cape");
			if (item != null && (!item.teamOnly() || dev.heldixclient.cosmetic.Cosmetics.team())) body.addProperty("cape", capeId);
		}
		body.addProperty("visible", config.socialVisible);
		body.addProperty("presence", config.socialPresence);
		body.addProperty("showServer", config.socialShowServer);
		body.addProperty("messages", config.socialMessages);
		call("PUT", "/v1/me", body, true);
	}

	/** Cape oder Sichtbarkeit geändert: im Hintergrund an den Dienst melden */
	public static void profileChanged() {
		if (!online()) return;
		NET.execute(() -> {
			try {
				syncProfile();
				// eigene Rolle beim nächsten Nachschlagen neu holen (z. B. nach „Für andere erkennbar“ an)
				LOOKUP.remove(Minecraft.getInstance().getUser().getProfileId());
			} catch (Exception e) {
				HeldixClient.LOGGER.info("Heldix-Dienst: Profil nicht gespeichert ({})", e.getMessage());
			}
		});
	}

	// ======================================================================================
	// Echtzeit (WebSocket)
	// ======================================================================================

	private static void openSocket(int gen) throws Exception {
		String url = baseUrl().replaceFirst("^http", "ws") + "/v1/ws";
		WebSocket ws = HTTP.newWebSocketBuilder()
				.header("Authorization", "Bearer " + token)
				.connectTimeout(Duration.ofSeconds(10))
				.buildAsync(URI.create(url), new Listener(gen))
				.get(15, TimeUnit.SECONDS);
		synchronized (Social.class) {
			if (gen != generation) {
				ws.abort();
				return;
			}
			socket = ws;
			state = State.ONLINE;
			error = null;
			attempt = 0;
		}
		HeldixClient.LOGGER.info("Heldix-Dienst verbunden");
		sendStatus();
	}

	private static void closeSocket() {
		WebSocket ws = socket;
		socket = null;
		if (ws != null) ws.abort();
	}

	private static void send(JsonObject message) {
		WebSocket ws = socket;
		if (ws == null) return;
		try {
			// immer nacheinander (Netzwerk-Thread), sonst lehnt WebSocket gleichzeitiges Senden ab
			ws.sendText(message.toString(), true).get(10, TimeUnit.SECONDS);
		} catch (Exception e) {
			HeldixClient.LOGGER.info("Heldix-Dienst: Senden fehlgeschlagen ({})", e.toString());
		}
	}

	private static void ping() {
		if (socket == null) return;
		JsonObject ping = new JsonObject();
		ping.addProperty("type", "ping");
		send(ping);
	}

	/** Neuer Status (Hauptmenü, Einzelspieler, Server …) – aufgerufen vom StatusReporter */
	public static void statusChanged(String mode, String server) {
		statusMode = mode;
		statusServer = server;
		NET.execute(Social::sendStatus);
	}

	private static void sendStatus() {
		JsonObject status = new JsonObject();
		status.addProperty("type", "status");
		status.addProperty("state", statusMode);
		String server = statusServer;
		if (server != null) {
			// mit Port (Freunde können so beitreten); ob die Adresse öffentlich ist, prüft der Dienst
			status.addProperty("server", server.trim().toLowerCase(java.util.Locale.ROOT));
		} else {
			status.add("server", null);
		}
		send(status);
	}

	private static final class Listener implements WebSocket.Listener {
		private final int gen;
		private final StringBuilder buffer = new StringBuilder();

		Listener(int gen) {
			this.gen = gen;
		}

		@Override
		public void onOpen(WebSocket webSocket) {
			webSocket.request(1);
		}

		@Override
		public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
			buffer.append(data);
			if (last) {
				String text = buffer.toString();
				buffer.setLength(0);
				try {
					handle(JsonParser.parseString(text).getAsJsonObject());
				} catch (RuntimeException e) {
					HeldixClient.LOGGER.warn("Heldix-Dienst: unlesbare Nachricht", e);
				}
			}
			webSocket.request(1);
			return null;
		}

		@Override
		public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
			lost();
			return null;
		}

		@Override
		public void onError(WebSocket webSocket, Throwable error) {
			lost();
		}

		private void lost() {
			synchronized (Social.class) {
				if (gen != generation) return;
				socket = null;
				state = State.ERROR;
				error = "Verbindung zum Dienst unterbrochen";
				scheduleRetry();
			}
		}
	}

	private static void handle(JsonObject message) {
		String type = string(message, "type");
		if (type == null) return;
		HeldixConfig.Data config = HeldixConfig.get();
		switch (type) {
			case "friends" -> applyFriends(message);
			case "message" -> Messages.onMessage(message);
			case "support" -> {
				if (config.socialNotifications) {
					String subject = string(message, "subject");
					Notifications.show("support-" + string(message, "id"), "Antwort vom HeldixClient-Team",
							subject != null ? subject + " · Heldix-Menü → Einstellungen → Info" : "Heldix-Menü → Einstellungen → Info", null);
				}
			}
			case "read" -> Messages.onRead(message);
			case "friend" -> {
				Friend friend = friend(message.getAsJsonObject("friend"));
				if (friend == null) return;
				List<Friend> list = new ArrayList<>(friends);
				Friend before = null;
				for (int i = 0; i < list.size(); i++) {
					if (list.get(i).uuid().equals(friend.uuid())) {
						before = list.get(i);
						list.set(i, friend);
					}
				}
				if (before == null) list.add(friend);
				friends = sorted(list);
				if (config.socialNotifications && friend.online() && (before == null || !before.online())) {
					Notifications.show("freund-" + friend.uuid(), friend.name() + " ist online", friend.activity(), null);
				}
			}
			case "request" -> {
				JsonObject from = message.getAsJsonObject("from");
				if (from != null && config.socialNotifications) {
					Notifications.show("anfrage", "Freundschaftsanfrage", string(from, "name") + " möchte mit dir befreundet sein", null);
				}
			}
			case "accepted" -> {
				Friend friend = friend(message.getAsJsonObject("friend"));
				if (friend != null && config.socialNotifications) {
					Notifications.show("anfrage", "Neuer Freund", friend.name() + " hat deine Anfrage angenommen", null);
				}
			}
			default -> {
				// pong und Unbekanntes
			}
		}
	}

	private static void applyFriends(JsonObject json) {
		List<Friend> list = new ArrayList<>();
		for (JsonElement element : array(json, "friends")) {
			Friend friend = friend(element.getAsJsonObject());
			if (friend != null) list.add(friend);
		}
		friends = sorted(list);
		incoming = requests(array(json, "incoming"));
		outgoing = requests(array(json, "outgoing"));
		Messages.applyUnread(json);
	}

	/** Freundesliste neu holen (im Netzwerk-Thread, z. B. nach dem Blockieren) */
	static void refreshFriends() throws Exception {
		applyFriends(call("GET", "/v1/friends", null, true));
	}

	private static List<Friend> sorted(List<Friend> list) {
		list.sort((a, b) -> a.online() != b.online() ? (a.online() ? -1 : 1) : a.name().compareToIgnoreCase(b.name()));
		return List.copyOf(list);
	}

	private static List<Request> requests(JsonArray array) {
		List<Request> list = new ArrayList<>();
		for (JsonElement element : array) {
			JsonObject object = element.getAsJsonObject();
			UUID uuid = uuid(string(object, "uuid"));
			if (uuid != null) list.add(new Request(uuid, string(object, "name"), object.has("at") ? object.get("at").getAsLong() : 0));
		}
		return List.copyOf(list);
	}

	private static Friend friend(JsonObject object) {
		if (object == null) return null;
		UUID uuid = uuid(string(object, "uuid"));
		if (uuid == null) return null;
		return new Friend(uuid, string(object, "name"), object.has("online") && object.get("online").getAsBoolean(),
				string(object, "state"), string(object, "server"), object.has("since") ? object.get("since").getAsLong() : 0);
	}

	// ======================================================================================
	// Freunde (für das Heldix-Menü)
	// ======================================================================================

	/** Anfrage an einen Spielernamen; das Ergebnis enthält bei Fehlern den Text für den Spieler */
	public static CompletableFuture<Void> sendRequest(String name) {
		JsonObject body = new JsonObject();
		body.addProperty("name", name.strip());
		return friendsCall("POST", "/v1/friends/requests", body);
	}

	public static CompletableFuture<Void> accept(UUID uuid) {
		return friendsCall("POST", "/v1/friends/requests/" + compact(uuid) + "/accept", null);
	}

	/** Anfrage ablehnen oder eigene zurückziehen */
	public static CompletableFuture<Void> cancelRequest(UUID uuid) {
		return friendsCall("DELETE", "/v1/friends/requests/" + compact(uuid), null);
	}

	/**
	 * Einmal-Link zur Webseite (POST /v1/web/link): öffnet heldixclient.com schon angemeldet, ohne Passwort.
	 * Ergebnis: die Adresse (2 Minuten gültig, nur einmal nutzbar).
	 */
	public static CompletableFuture<String> webLink() {
		return webLink(null);
	}

	/** wie {@link #webLink()}, öffnet nach der Anmeldung einen Bereich (z. B. "support") */
	public static CompletableFuture<String> webLink(String target) {
		CompletableFuture<String> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			try {
				JsonObject body = null;
				if (target != null) {
					body = new JsonObject();
					body.addProperty("target", target);
				}
				String url = string(call("POST", "/v1/web/link", body, true), "url");
				URI uri = url == null ? null : URI.create(url);
				boolean local = uri != null && "http".equals(uri.getScheme()) && ("127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost()));
				if (uri == null || !("https".equals(uri.getScheme()) || local)) throw new ServiceException("Der Heldix-Dienst hat einen ungültigen Link geliefert");
				result.complete(url);
			} catch (Exception e) {
				result.completeExceptionally(e instanceof ServiceException ? e : new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	/** Neuigkeit des HeldixClient-Teams (GET /v1/news) */
	public record News(String title, String text, long at, String author) {
	}

	private static volatile List<News> news = List.of();
	private static volatile long newsLoadedAt;

	/** zuletzt geladene Neuigkeiten (leer, solange nichts geladen ist) */
	public static List<News> news() {
		return news;
	}

	/** Neuigkeiten neu laden, höchstens alle zehn Minuten; braucht keine Anmeldung */
	public static void refreshNews() {
		if (baseUrl().isEmpty() || System.currentTimeMillis() - newsLoadedAt < 10 * 60_000) return;
		newsLoadedAt = System.currentTimeMillis();
		NET.execute(() -> {
			try {
				List<News> list = new ArrayList<>();
				for (JsonElement element : array(call("GET", "/v1/news?limit=2", null, false), "news")) {
					JsonObject object = element.getAsJsonObject();
					String title = string(object, "title");
					String text = string(object, "text");
					if (title == null || text == null) continue;
					list.add(new News(title, text, object.has("at") ? object.get("at").getAsLong() : 0, string(object, "author")));
				}
				news = List.copyOf(list);
			} catch (Exception e) {
				HeldixClient.LOGGER.debug("Heldix-Dienst: keine Neuigkeiten ({})", e.toString());
			}
		});
	}

	/** Adresse der Webseite (api.example.de → https://example.de), null ohne Dienst */
	public static String websiteUrl() {
		String base = baseUrl();
		if (base.isEmpty()) return null;
		URI uri = URI.create(base);
		String host = uri.getHost();
		if (host == null) return null;
		if (host.startsWith("api.")) host = host.substring(4);
		return ("127.0.0.1".equals(host) || "localhost".equals(host) ? "http" : "https") + "://" + host;
	}

	public static CompletableFuture<Void> removeFriend(UUID uuid) {
		return friendsCall("DELETE", "/v1/friends/" + compact(uuid), null);
	}

	private static CompletableFuture<Void> friendsCall(String method, String path, JsonObject body) {
		CompletableFuture<Void> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			try {
				applyFriends(call(method, path, body, true));
				result.complete(null);
			} catch (Exception e) {
				result.completeExceptionally(e instanceof ServiceException ? e : new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	// ======================================================================================
	// Andere Spieler: Heldix-Symbol (mit Rolle) und Capes
	// ======================================================================================

	private static void tick(Minecraft mc) {
		if (!started) {
			started = true;
			connect();
		}
		if (++tickCounter % 20 != 0 || !online()) return;
		ClientPacketListener connection = mc.getConnection();
		if (connection == null) return;
		long now = System.currentTimeMillis();
		UUID own = mc.getUser().getProfileId();
		Set<UUID> wanted = new LinkedHashSet<>();
		for (PlayerInfo info : connection.getOnlinePlayers()) wanted.add(info.getProfile().id());
		if (mc.level != null) for (AbstractClientPlayer player : mc.level.players()) wanted.add(player.getUUID());
		// sich selbst nur nachschlagen, wenn man erkennbar ist: dann meldet der Dienst auch die eigene Rolle
		boolean ownVisible = HeldixConfig.get().socialVisible;
		List<UUID> batch = new ArrayList<>();
		for (UUID uuid : wanted) {
			if (uuid == null || (uuid.equals(own) && !ownVisible) || PENDING.contains(uuid)) continue;
			Lookup lookup = LOOKUP.get(uuid);
			if (lookup != null && now - lookup.at() < (lookup.heldix() ? LOOKUP_POSITIVE_MS : LOOKUP_NEGATIVE_MS)) continue;
			batch.add(uuid);
			if (batch.size() >= LOOKUP_BATCH) break;
		}
		if (batch.isEmpty()) return;
		PENDING.addAll(batch);
		NET.execute(() -> {
			try {
				JsonObject body = new JsonObject();
				JsonArray uuids = new JsonArray();
				for (UUID uuid : batch) uuids.add(compact(uuid));
				body.add("uuids", uuids);
				JsonObject players = call("POST", "/v1/players/lookup", body, true).getAsJsonObject("players");
				long at = System.currentTimeMillis();
				for (UUID uuid : batch) {
					JsonObject entry = players != null && players.has(compact(uuid)) ? players.getAsJsonObject(compact(uuid)) : null;
					LOOKUP.put(uuid, lookupOf(entry, at));
				}
			} catch (Exception e) {
				HeldixClient.LOGGER.debug("Heldix-Dienst: Spieler nicht nachschlagbar ({})", e.toString());
			} finally {
				PENDING.removeAll(batch);
			}
		});
	}

	/** Eintrag aus der Antwort von /v1/players/lookup (null = kein erkennbarer HeldixClient-Spieler) */
	private static Lookup lookupOf(JsonObject entry, long at) {
		if (entry == null) return new Lookup(false, null, null, Map.of(), at);
		Map<String, String> cosmetics = new java.util.HashMap<>();
		JsonElement worn = entry.get("cosmetics");
		if (worn != null && worn.isJsonObject()) {
			for (String slot : dev.heldixclient.cosmetic.Cosmetics.WORN_SLOTS) {
				// null (nichts, ausgeblendet, gelöscht) und Unsinn zählen als nichts
				JsonElement value = worn.getAsJsonObject().get(slot);
				String id = value != null && value.isJsonPrimitive() ? value.getAsString() : null;
				if (id != null && dev.heldixclient.cosmetic.CosmeticFormat.ID_RE.matcher(id).matches()) cosmetics.put(slot, id);
			}
		}
		return new Lookup(true, blankToNull(string(entry, "cape")), Badge.Role.of(string(entry, "badge")), Map.copyOf(cosmetics), at);
	}

	/**
	 * Cosmetic eines anderen Spielers im Slot (head, back, aura, companion), wie der Dienst es meldet; null = nichts oder
	 * unbekannt. Nur aus dem Zwischenspeicher, darf in jedem Bild aufgerufen werden.
	 */
	public static String cosmeticOf(UUID uuid, String slot) {
		if (uuid == null) return null;
		Lookup lookup = LOOKUP.get(uuid);
		return lookup != null && lookup.heldix() ? lookup.cosmetics().get(slot) : null;
	}

	/** Nutzt dieser Spieler HeldixClient (und will erkennbar sein)? */
	public static boolean isHeldix(UUID uuid) {
		return roleOf(uuid) != null;
	}

	/**
	 * Rolle fürs Heldix-Symbol: null = kein (erkennbarer) HeldixClient-Spieler. Nur aus dem Zwischenspeicher, nie eine
	 * Anfrage – darf also in jedem Bild aufgerufen werden.
	 */
	public static Badge.Role roleOf(UUID uuid) {
		if (uuid == null) return null;
		Lookup lookup = LOOKUP.get(uuid);
		if (uuid.equals(Minecraft.getInstance().getUser().getProfileId())) {
			// sich selbst: die eigene Einstellung gilt sofort, die Rolle kommt vom Dienst, sobald nachgeschlagen
			if (!online() || !HeldixConfig.get().socialVisible) return null;
			return lookup != null && lookup.heldix() ? lookup.role() : Badge.Role.PLAYER;
		}
		return lookup != null && lookup.heldix() ? lookup.role() : null;
	}

	/** Heldix-Cape eines anderen Spielers (null = keins oder unbekannt) */
	public static String capeOf(UUID uuid) {
		if (uuid == null || !HeldixConfig.get().socialCapes) return null;
		Lookup lookup = LOOKUP.get(uuid);
		return lookup != null && lookup.heldix() ? lookup.cape() : null;
	}

	/** Cape eines anderen Spielers laut Nachschlagen, unabhängig von der Einstellung „Capes anderer Spieler“ (Addon-API) */
	public static String lookupCape(UUID uuid) {
		Lookup lookup = uuid == null ? null : LOOKUP.get(uuid);
		return lookup != null && lookup.heldix() ? lookup.cape() : null;
	}

	/** Für Tests und nach dem Verlassen eines Servers */
	public static void forgetPlayers() {
		LOOKUP.clear();
	}

	/**
	 * Nur für automatische Tests: ein Ergebnis des Nachschlagens vorgeben, als hätte der Dienst {@code entry} für diesen
	 * Spieler gemeldet (null = kein HeldixClient-Spieler). Läuft durch dieselbe Auswertung wie echte Antworten und wird
	 * nicht neu nachgeschlagen, bis {@link #forgetPlayers()} oder ein Trennen vom Dienst es löscht.
	 */
	public static void testLookup(UUID uuid, JsonObject entry) {
		LOOKUP.put(uuid, lookupOf(entry, Long.MAX_VALUE / 2));
	}

	// ======================================================================================
	// HTTP
	// ======================================================================================

	/** Fehler mit Text für den Spieler (vom Dienst) */
	public static final class ServiceException extends Exception {
		public ServiceException(String message) {
			super(message);
		}
	}

	static JsonObject call(String method, String path, JsonObject body, boolean auth) throws IOException, InterruptedException, ServiceException {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl() + path))
				.timeout(Duration.ofSeconds(15))
				.header("Accept", "application/json")
				.header("User-Agent", HeldixClient.NAME + "/" + HeldixClient.version);
		if (auth) {
			String current = token;
			if (current == null) throw new ServiceException("Nicht angemeldet");
			request.header("Authorization", "Bearer " + current);
		}
		if (body != null) {
			request.header("Content-Type", "application/json");
			request.method(method, HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
		} else {
			request.method(method, HttpRequest.BodyPublishers.noBody());
		}
		HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		JsonObject json = parse(response.body());
		if (response.statusCode() == 401 && auth) {
			// Anmeldung beim Dienst abgelaufen: neu anmelden
			NET.execute(Social::connect);
		}
		if (response.statusCode() >= 400) {
			String message = string(json, "error");
			throw new ServiceException(message != null ? message : "Fehler beim Dienst (" + response.statusCode() + ")");
		}
		return json;
	}

	private static JsonObject parse(String text) {
		try {
			JsonElement element = JsonParser.parseString(text == null || text.isBlank() ? "{}" : text);
			return element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
		} catch (RuntimeException e) {
			return new JsonObject();
		}
	}

	static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || object.get(key).isJsonNull()) return null;
		return object.get(key).getAsString();
	}

	private static JsonArray array(JsonObject object, String key) {
		return object != null && object.has(key) && object.get(key).isJsonArray() ? object.getAsJsonArray(key) : new JsonArray();
	}

	private static String blankToNull(String value) {
		return value == null || value.isBlank() ? null : value;
	}

	/** UUID ohne Bindestriche, klein geschrieben (Format des Dienstes) */
	public static String compact(UUID uuid) {
		return uuid.toString().replace("-", "").toLowerCase(java.util.Locale.ROOT);
	}

	public static UUID uuid(String compact) {
		if (compact == null || compact.length() != 32) return null;
		try {
			return UUID.fromString(compact.substring(0, 8) + "-" + compact.substring(8, 12) + "-" + compact.substring(12, 16) + "-"
					+ compact.substring(16, 20) + "-" + compact.substring(20));
		} catch (IllegalArgumentException e) {
			return null;
		}
	}

	/** Nur zum Lesen für Tests */
	public static Map<UUID, Boolean> knownPlayers() {
		Map<UUID, Boolean> map = new java.util.HashMap<>();
		LOOKUP.forEach((uuid, lookup) -> map.put(uuid, lookup.heldix()));
		return Collections.unmodifiableMap(map);
	}
}
