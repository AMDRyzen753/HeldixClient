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
 * der Tab-Liste und über Köpfen, Freunde mit Online-Status und (ab Dienst 1.11.0) Einladungen mit Belohnungen.
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

	/**
	 * Freund laut Dienst. Ab Dienst 1.12.0 (Freunde 2.0) zusätzlich: {@code favorite}, {@code nickname}, {@code note} (nur
	 * die eigenen Angaben, der Freund sieht sie nie), {@code statusText} und {@code dnd} („Nicht stören“, nur online),
	 * {@code lastOnline} (ms, gerundet vom Dienst, 0 = unbekannt oder ausgeblendet) und {@code badge} (Abzeichen, null =
	 * normaler HeldixClient-Spieler). Ältere Dienste schicken diese Felder nicht – dann gelten die Standardwerte.
	 */
	public record Friend(UUID uuid, String name, boolean online, String state, String server, long since,
			boolean favorite, String nickname, String note, String statusText, boolean dnd, long lastOnline, Badge.Role badge) {
		/** Name für Listen: der eigene Spitzname, sonst der Minecraft-Name */
		public String shownName() {
			return nickname != null && !nickname.isBlank() ? nickname : name;
		}

		/** „zuletzt online vor 5 Min.“ (nur offline und wenn der Freund es zeigt), sonst null */
		public String lastOnlineText() {
			if (online || lastOnline <= 0) return null;
			return "zuletzt online " + ago(lastOnline);
		}

		/** Was der Freund gerade macht, für die Anzeige */
		public String activity() {
			if (!online) {
				String last = lastOnlineText();
				return last != null ? "Offline · " + last : "Offline";
			}
			if (dnd) return "Nicht stören";
			if (state == null) return "Online";
			return switch (state) {
				case "menu" -> "Im Hauptmenü";
				case "singleplayer" -> "Spielt Einzelspieler";
				case "multiplayer" -> server != null && dev.heldixclient.share.WorldShare.isWorldAddress(server) ? "In einer Heldix-Welt"
						: server != null ? "Spielt auf " + server : "Spielt auf einem Server";
				case "realms" -> "Spielt auf Realms";
				case "lan" -> "Spielt im LAN";
				default -> "Online";
			};
		}
	}

	/** „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“ (für „zuletzt online“) */
	public static String ago(long at) {
		long minutes = Math.max(1, (System.currentTimeMillis() - at) / 60_000);
		if (minutes < 60) return "vor " + minutes + " Min.";
		long hours = minutes / 60;
		if (hours < 24) return "vor " + hours + " Std.";
		long days = hours / 24;
		return "vor " + days + (days == 1 ? " Tag" : " Tagen");
	}

	public record Request(UUID uuid, String name, long at) {
	}

	/**
	 * Eigene Angaben beim Dienst ab 1.12.0 ({@code GET/PUT /v1/me}): Statustext (höchstens 40 Zeichen), „Nicht stören“,
	 * „Zuletzt online zeigen“, „In Vorschlägen erscheinen“, „Vorschläge zeigen“ und Online-Benachrichtigungen ("all",
	 * "favorites", "none" – wertet nur der Client aus). Gilt beim Dienst: auch Launcher und Webseite ändern sie.
	 */
	public record Me(String statusText, boolean dnd, boolean showLastOnline, boolean suggestable, boolean showSuggestions, String onlineNotify) {
		public static final Me DEFAULT = new Me(null, false, true, false, true, "all");
	}

	/** Gemeinsamer Freund (Profilkarte) */
	public record Mutual(UUID uuid, String name) {
	}

	/** Profilkarte eines Freundes ({@code GET /v1/friends/<uuid>/profile}); cosmetics: Slot → ID (leer, wenn nicht erkennbar) */
	public record Profile(Friend friend, List<Mutual> mutual, String cape, Map<String, String> cosmetics) {
	}

	/** höchstens so viele Zeichen im eigenen Statustext, Spitznamen und in Notizen (wie beim Dienst) */
	public static final int STATUS_MAX = 40;
	public static final int NICKNAME_MAX = 24;
	public static final int NOTE_MAX = 200;
	/** Meldung, wenn der Dienst Freunde 2.0 noch nicht kennt (vor 1.12.0) */
	public static final String FRIENDS2_MISSING = "Das gibt es erst ab Heldix-Dienst 1.12.0 – der verbundene Dienst ist älter.";

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

	/** eigene Angaben beim Dienst (ab 1.12.0); friends2 = der Dienst kennt sie (Antwort von PUT /v1/me hat "dnd") */
	private static volatile Me me = Me.DEFAULT;
	private static volatile boolean friends2;
	/** Statustext, der nach kurzer Pause an den Dienst geht (beim Tippen nicht jede Taste einzeln) */
	private static ScheduledFuture<?> statusTextSave;

	private Social() {
	}

	// ======================================================================================
	// Start, Zustand
	// ======================================================================================

	public static void init() {
		// erst im ersten Client-Tick verbinden: dann gibt es Minecraft und das angemeldete Konto sicher
		ClientEvents.TICK_END.register(Social::tick);
		ClientEvents.TICK_END.register(BadgeDisplay::tick);
		// Freunde 2.0: Spieler in der Nähe merken (lokale Vorschläge), Party (Folgen, Voice)
		ClientEvents.TICK_END.register(Suggestions::tick);
		ClientEvents.TICK_END.register(Party::tick);
		ClientEvents.STOPPING.register(mc -> Suggestions.save());
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

	/** Freund per UUID (null = nicht in der Freundesliste) */
	public static Friend friend(UUID uuid) {
		if (uuid == null) return null;
		for (Friend friend : friends) if (friend.uuid().equals(uuid)) return friend;
		return null;
	}

	/** eigene Angaben beim Dienst (Standardwerte, solange nichts geladen ist) */
	public static Me me() {
		return me;
	}

	/** Kennt der verbundene Dienst Freunde 2.0 (Party, Favoriten, Status, Vorschläge; ab 1.12.0)? */
	public static boolean friends2() {
		return online() && friends2;
	}

	/**
	 * Keine Einblendungen und Töne: Einblendungen ausgeschaltet oder „Nicht stören“ an (Nachrichten kommen trotzdem an,
	 * Party-Einladungen landen still in der Liste).
	 */
	public static boolean quiet() {
		return !HeldixConfig.get().socialNotifications || me.dnd();
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
				// ab Dienst 1.12.0: eigene Party (Einladungen kommen beim Verbinden per Echtzeit)
				if (gen == generation && friends2) Party.load();
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
		Party.reset();
		Suggestions.resetServer();
		me = Me.DEFAULT;
		friends2 = false;
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

	/**
	 * Eigene Auswahl an Cosmetics, ob man Team-Cosmetics wählen darf und (ab Dienst 1.11.0) die freigeschalteten
	 * Belohnungen (GET /v1/me/cosmetics, ab Dienst 1.6.0)
	 */
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
		// geprüften Katalog steht (und man es wählen darf: Team bzw. freigeschaltet) – sonst bleibt die Auswahl beim Dienst,
		// wie sie ist.
		String capeId = config.cape == null ? "" : config.cape;
		if (capeId.isEmpty() || Capes.isBuiltin(capeId)) {
			// eingebautes Team-Cape nur, wenn das Team-Recht schon bekannt ist (sonst lehnt der Dienst mit 403 ab und die
			// Anmeldung scheitert); die Auswahl beim Dienst bleibt dann, wie sie ist
			Capes.Cape cape = Capes.byId(capeId);
			if (cape == null || cape.lockReason() == null) body.addProperty("cape", capeId);
		} else if (capeId.startsWith("datei:")) body.addProperty("cape", "");
		else {
			dev.heldixclient.cosmetic.CosmeticCatalog.Item item = dev.heldixclient.cosmetic.CosmeticCatalog.item(capeId, "cape");
			if (item != null && dev.heldixclient.cosmetic.Cosmetics.lockReason(item) == null) body.addProperty("cape", capeId);
		}
		body.addProperty("visible", config.socialVisible);
		body.addProperty("presence", config.socialPresence);
		body.addProperty("showServer", config.socialShowServer);
		body.addProperty("messages", config.socialMessages);
		// die Angaben ab 1.12.0 (Status, „Nicht stören“, Vorschläge …) gelten beim Dienst: nur lesen, nicht überschreiben
		applyMe(call("PUT", "/v1/me", body, true));
	}

	/** Antwort von GET/PUT /v1/me: die Angaben ab Dienst 1.12.0 übernehmen (ältere Dienste kennen sie nicht) */
	private static void applyMe(JsonObject json) {
		if (json == null || !json.has("dnd")) {
			friends2 = false;
			me = Me.DEFAULT;
			return;
		}
		String notify = string(json, "onlineNotify");
		if (!"all".equals(notify) && !"favorites".equals(notify) && !"none".equals(notify)) notify = "all";
		me = new Me(blankToNull(string(json, "statusText")), bool(json, "dnd", false), bool(json, "showLastOnline", true),
				bool(json, "suggestable", false), bool(json, "showSuggestions", true), notify);
		friends2 = true;
	}

	/**
	 * Eigene Angabe beim Dienst ändern ({@code PUT /v1/me} mit nur diesem Feld): dnd, showLastOnline, suggestable,
	 * showSuggestions (true/false) oder onlineNotify ("all", "favorites", "none"). Sofort sichtbar, beim Fehler zurück.
	 */
	public static CompletableFuture<Void> updateMe(String field, com.google.gson.JsonElement value) {
		CompletableFuture<Void> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		Me before = me;
		me = withField(before, field, value);
		NET.execute(() -> {
			try {
				JsonObject body = new JsonObject();
				body.add(field, value);
				applyMe(call("PUT", "/v1/me", body, true));
				result.complete(null);
			} catch (Exception e) {
				me = before;
				result.completeExceptionally(e instanceof ServiceException ? e : new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	private static Me withField(Me m, String field, com.google.gson.JsonElement value) {
		boolean flag = value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() && value.getAsBoolean();
		String text = value != null && value.isJsonPrimitive() ? value.getAsString() : null;
		return switch (field) {
			case "statusText" -> new Me(blankToNull(text), m.dnd(), m.showLastOnline(), m.suggestable(), m.showSuggestions(), m.onlineNotify());
			case "dnd" -> new Me(m.statusText(), flag, m.showLastOnline(), m.suggestable(), m.showSuggestions(), m.onlineNotify());
			case "showLastOnline" -> new Me(m.statusText(), m.dnd(), flag, m.suggestable(), m.showSuggestions(), m.onlineNotify());
			case "suggestable" -> new Me(m.statusText(), m.dnd(), m.showLastOnline(), flag, m.showSuggestions(), m.onlineNotify());
			case "showSuggestions" -> new Me(m.statusText(), m.dnd(), m.showLastOnline(), m.suggestable(), flag, m.onlineNotify());
			case "onlineNotify" -> new Me(m.statusText(), m.dnd(), m.showLastOnline(), m.suggestable(), m.showSuggestions(), text);
			default -> m;
		};
	}

	/**
	 * Eigenen Statustext setzen (leer = löschen): sofort sichtbar, an den Dienst geht er erst nach einer Sekunde ohne
	 * weitere Änderung (beim Tippen nicht jede Taste). Fehler (zu lang, Zeichen) meldet {@code onError} im Haupt-Thread.
	 */
	public static synchronized void setStatusText(String text, java.util.function.Consumer<String> onError) {
		String clean = text == null ? "" : text.strip();
		if (clean.equals(me.statusText() == null ? "" : me.statusText())) return;
		me = withField(me, "statusText", new com.google.gson.JsonPrimitive(clean));
		if (statusTextSave != null) statusTextSave.cancel(false);
		statusTextSave = NET.schedule(() -> {
			if (!online()) return;
			try {
				JsonObject body = new JsonObject();
				if (clean.isEmpty()) body.add("statusText", com.google.gson.JsonNull.INSTANCE);
				else body.addProperty("statusText", clean);
				applyMe(call("PUT", "/v1/me", body, true));
			} catch (Exception e) {
				String message = e instanceof ServiceException ? e.getMessage() : "Dienst nicht erreichbar";
				if (onError != null) Minecraft.getInstance().execute(() -> onError.accept(message));
			}
		}, 1, TimeUnit.SECONDS);
	}

	/** Eigene Angaben neu vom Dienst holen (z. B. auf der Seite Privatsphäre; Launcher oder Webseite können sie ändern) */
	public static void refreshMe() {
		if (!online()) return;
		NET.execute(() -> {
			try {
				applyMe(call("GET", "/v1/me", null, true));
			} catch (Exception e) {
				HeldixClient.LOGGER.debug("Heldix-Dienst: Profil nicht geladen ({})", e.toString());
			}
		});
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
		// dauerhafte Welten (ab 1.13.0): Stand holen (Zustände der eigenen Welten, Berechtigung)
		dev.heldixclient.share.Hosting.connected();
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

	/** Nachricht über die Echtzeit-Verbindung schicken (z. B. „schreibt …“); false = nicht verbunden */
	static boolean sendRealtime(JsonObject message) {
		if (socket == null || !online()) return false;
		NET.execute(() -> send(message));
		return true;
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
		boolean notify = !quiet();
		switch (type) {
			case "friends" -> applyFriends(message);
			case "message" -> Messages.onMessage(message);
			// ab Dienst 1.12.0: Nachricht gelöscht, Reaktionen geändert, „schreibt …“
			case "message-deleted" -> Messages.onDeleted(message);
			case "reaction" -> Messages.onReaction(message);
			case "typing" -> Messages.onTyping(message);
			// ab Dienst 1.12.0: Party (Stand, Einladungen, Chat, Folgen)
			case "party" -> Party.onParty(message);
			case "party-invite" -> Party.onInvite(message);
			case "party-chat" -> Party.onChat(message);
			case "party-follow" -> Party.onFollow(message);
			case "support" -> {
				if (notify) {
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
				// „ist online“ nach Einstellung: alle, nur Favoriten oder keine (wertet nur der Client aus)
				String onlineNotify = me.onlineNotify();
				boolean wanted = "all".equals(onlineNotify) || ("favorites".equals(onlineNotify) && friend.favorite());
				if (notify && wanted && friend.online() && (before == null || !before.online())) {
					Notifications.show("freund-" + friend.uuid(), friend.shownName() + " ist online", friend.activity(), null);
				}
			}
			case "request" -> {
				JsonObject from = message.getAsJsonObject("from");
				if (from != null && notify) {
					Notifications.show("anfrage", "Freundschaftsanfrage", string(from, "name") + " möchte mit dir befreundet sein", null);
				}
			}
			case "accepted" -> {
				Friend friend = friend(message.getAsJsonObject("friend"));
				if (friend != null && notify) {
					Notifications.show("anfrage", "Neuer Freund", friend.name() + " hat deine Anfrage angenommen", null);
				}
			}
			// ab Dienst 1.11.0: Belohnung für Einladungen freigeschaltet (sofort wählbar) und Neues zu eigenen Einladungen
			case "unlock" -> {
				String cosmetic = string(message, "cosmetic");
				if (cosmetic == null || !dev.heldixclient.cosmetic.CosmeticFormat.ID_RE.matcher(cosmetic).matches()) return;
				if (!dev.heldixclient.cosmetic.Cosmetics.unlock(cosmetic)) return;
				dev.heldixclient.cosmetic.CosmeticCatalog.Item item = dev.heldixclient.cosmetic.CosmeticCatalog.item(cosmetic);
				String where = item != null && "cape".equals(item.slot()) ? "Heldix-Menü → Cape" : "Heldix-Menü → Cosmetics";
				// Name in die zweite Zeile: der Titel bleibt so kurz genug für die Einblendung („Nicht stören“: still)
				if (!me.dnd()) {
					Invites.notify("freischaltung-" + cosmetic, "Neues Cosmetic freigeschaltet",
							"„" + (item != null ? item.name() : cosmetic) + "“ – Belohnung fürs Einladen · " + where);
				}
			}
			// ab Dienst 1.12.0: ein Freund lädt in seine geteilte Welt ein (Heldix-Welten)
			case "world-invite" -> dev.heldixclient.share.WorldInvites.onInvite(message, notify);
			// ab Dienst 1.12.0: Welt eines Freundes geöffnet bzw. geschlossen (für Heldix-Welten und die Freunde-Leiste)
			case "world-open" -> dev.heldixclient.share.WorldInvites.onOpen(message, notify);
			case "world-closed" -> dev.heldixclient.share.WorldInvites.onClosed(message);
			// ab Dienst 1.13.0: dauerhafte Welten – Zustand (Liste in Heldix-Welten), Anklopfen (Einblendung mit H/N) und Freischaltung
			case "hosting-state" -> dev.heldixclient.share.Hosting.onState(message);
			case "hosting-knock" -> dev.heldixclient.share.Hosting.onKnock(message, notify);
			case "hosting-granted" -> dev.heldixclient.share.Hosting.onGranted(message, notify);
			case "invite" -> {
				String name = string(message, "name");
				if (!notify || name == null || name.isBlank()) return;
				String event = string(message, "event");
				if ("accepted".equals(event)) {
					Invites.notify("einladung", "Einladung angenommen", name + " ist jetzt mit dir befreundet");
				} else if ("confirmed".equals(event)) {
					Invites.notify("einladung", "Einladung bestätigt", name + " spielt jetzt HeldixClient – das zählt für deine Belohnungen");
				}
			}
			default -> {
				// pong und Unbekanntes
			}
		}
	}

	/**
	 * Nur für automatische Tests: eine Echtzeit-Nachricht so verarbeiten, als käme sie vom Dienst (z. B. "unlock"). Läuft
	 * durch dieselbe Auswertung wie echte Nachrichten.
	 */
	public static void testRealtime(JsonObject message) {
		handle(message);
	}

	/** Eigene Cosmetics (Auswahl, Team, Freischaltungen) neu vom Dienst holen, im Hintergrund */
	public static CompletableFuture<Void> refreshCosmetics() {
		CompletableFuture<Void> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			fetchCosmetics();
			result.complete(null);
		});
		return result;
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

	/** Favoriten zuerst, dann online, dann nach (Spitz-)Namen */
	private static List<Friend> sorted(List<Friend> list) {
		list.sort((a, b) -> a.favorite() != b.favorite() ? (a.favorite() ? -1 : 1)
				: a.online() != b.online() ? (a.online() ? -1 : 1) : a.shownName().compareToIgnoreCase(b.shownName()));
		return List.copyOf(list);
	}

	/** Freund in der Liste ersetzen (nach PATCH oder Echtzeit {@code friend}) */
	private static void replaceFriend(Friend friend) {
		List<Friend> list = new ArrayList<>(friends);
		boolean found = false;
		for (int i = 0; i < list.size(); i++) {
			if (list.get(i).uuid().equals(friend.uuid())) {
				list.set(i, friend);
				found = true;
			}
		}
		if (found) friends = sorted(list);
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
		boolean online = bool(object, "online", false);
		JsonElement badge = object.get("badge");
		return new Friend(uuid, string(object, "name"), online, string(object, "state"), string(object, "server"), number(object, "since"),
				bool(object, "favorite", false), oneLine(string(object, "nickname"), NICKNAME_MAX), clip(string(object, "note"), NOTE_MAX),
				oneLine(string(object, "statusText"), STATUS_MAX), online && bool(object, "dnd", false), number(object, "lastOnline"),
				badge != null && badge.isJsonPrimitive() ? Badge.Role.of(badge.getAsString()) : null);
	}

	private static boolean bool(JsonObject object, String key, boolean fallback) {
		JsonElement value = object == null ? null : object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() ? value.getAsBoolean() : fallback;
	}

	private static long number(JsonObject object, String key) {
		JsonElement value = object == null ? null : object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsLong() : 0;
	}

	/** Text vom Dienst für eine Zeile: Formatierungs- und Steuerzeichen raus, höchstens {@code max} Zeichen; leer = null */
	static String oneLine(String text, int max) {
		if (text == null) return null;
		String clean = text.replaceAll("[\\p{Cc}\\p{Cf}§]", "").strip();
		if (clean.codePointCount(0, clean.length()) > max) clean = clean.substring(0, clean.offsetByCodePoints(0, max));
		return clean.isEmpty() ? null : clean;
	}

	/** wie {@link #oneLine}, für längere Notizen */
	private static String clip(String text, int max) {
		return oneLine(text, max);
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

	// ======================================================================================
	// Einladungen (ab Dienst 1.11.0)
	// ======================================================================================

	/**
	 * Einladung des Dienstes ({@code POST /v1/invites}): url = Web-Link {@code <webseite>/einladung#<code>}, appUrl =
	 * {@code heldixclient://einladung/<code>}, expires in ms seit 1970 (0 = unbekannt), voice = mit Voice-Gruppe.
	 */
	public record Invite(String code, String url, String appUrl, long expires, String server, boolean voice) {
	}

	/** Code einer Einladung: 10 Zeichen ohne i, l, o, 0 und 1 */
	public static final java.util.regex.Pattern INVITE_CODE = java.util.regex.Pattern.compile("^[a-hjkmnp-z2-9]{10}$");
	/** Meldung, wenn der Dienst noch keine Einladungen kennt (vor 1.11.0: 404) */
	public static final String INVITES_MISSING = "Einladungen gibt es erst ab Heldix-Dienst 1.11.0 – der verbundene Dienst ist älter.";

	/**
	 * Einladung erzeugen bzw. die offene wiederverwenden: {@code server} = Server, auf den eingeladen wird (null = ohne),
	 * {@code voiceGroup} = Prüfwert der Voice-Gruppe (64 Hex-Zeichen, nur mit Server; der Link gilt dann 24 Stunden).
	 * Lehnt der Dienst die Server-Adresse einer allgemeinen Einladung ab (z. B. LAN), gibt es eine Einladung ohne Server.
	 */
	public static CompletableFuture<Invite> createInvite(String server, String voiceGroup) {
		CompletableFuture<Invite> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			try {
				try {
					result.complete(postInvite(server, voiceGroup));
				} catch (ServiceException e) {
					if (e.status() != 400 || server == null || voiceGroup != null) throw e;
					result.complete(postInvite(null, null));
				}
			} catch (ServiceException e) {
				result.completeExceptionally(e.status() == 404 ? new ServiceException(INVITES_MISSING, 404) : e);
			} catch (Exception e) {
				result.completeExceptionally(new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	private static Invite postInvite(String server, String voiceGroup) throws Exception {
		JsonObject body = new JsonObject();
		if (server == null) body.add("server", com.google.gson.JsonNull.INSTANCE);
		else body.addProperty("server", server);
		if (voiceGroup == null) body.add("voice", com.google.gson.JsonNull.INSTANCE);
		else {
			JsonObject voice = new JsonObject();
			voice.addProperty("group", voiceGroup);
			body.add("voice", voice);
		}
		JsonObject json = call("POST", "/v1/invites", body, true);
		String code = string(json, "code");
		if (code == null || !INVITE_CODE.matcher(code).matches()) throw new ServiceException("Der Heldix-Dienst hat eine ungültige Einladung geliefert");
		String url = string(json, "url");
		if (url == null || url.isBlank()) throw new ServiceException("Beim Heldix-Dienst ist keine Webseite eingetragen – ohne sie gibt es keine Einladungslinks.");
		URI uri;
		try {
			uri = URI.create(url);
		} catch (IllegalArgumentException e) {
			throw new ServiceException("Der Heldix-Dienst hat einen ungültigen Link geliefert");
		}
		boolean local = "http".equals(uri.getScheme()) && ("127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost()));
		if (uri.getHost() == null || !("https".equals(uri.getScheme()) || local) || !url.contains(code)) {
			throw new ServiceException("Der Heldix-Dienst hat einen ungültigen Link geliefert");
		}
		long expires = json.has("expires") && json.get("expires").isJsonPrimitive() && json.get("expires").getAsJsonPrimitive().isNumber()
				? json.get("expires").getAsLong() : 0;
		boolean voice = json.has("voice") && json.get("voice").isJsonPrimitive() && json.get("voice").getAsBoolean();
		return new Invite(code, url, string(json, "appUrl"), expires, string(json, "server"), voice);
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

	// ======================================================================================
	// Freunde 2.0 (ab Dienst 1.12.0): Favorit, Spitzname, Notiz, Profilkarte
	// ======================================================================================

	/** Favorit setzen bzw. entfernen (nur für dich; der Freund erfährt davon nichts) */
	public static CompletableFuture<Void> setFavorite(UUID uuid, boolean favorite) {
		JsonObject body = new JsonObject();
		body.addProperty("favorite", favorite);
		return patchFriend(uuid, body);
	}

	/** Spitzname (höchstens 24 Zeichen) bzw. Notiz (höchstens 200) – leer löscht; nur für dich */
	public static CompletableFuture<Void> setNickname(UUID uuid, String nickname) {
		return patchFriend(uuid, textBody("nickname", nickname));
	}

	public static CompletableFuture<Void> setNote(UUID uuid, String note) {
		return patchFriend(uuid, textBody("note", note));
	}

	private static JsonObject textBody(String key, String value) {
		JsonObject body = new JsonObject();
		String clean = value == null ? "" : value.strip();
		if (clean.isEmpty()) body.add(key, com.google.gson.JsonNull.INSTANCE);
		else body.addProperty(key, clean);
		return body;
	}

	/** {@code PATCH /v1/friends/<uuid>}: Antwort { friend } ersetzt den Eintrag in der Liste */
	private static CompletableFuture<Void> patchFriend(UUID uuid, JsonObject body) {
		CompletableFuture<Void> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			try {
				Friend friend = friend(call("PATCH", "/v1/friends/" + compact(uuid), body, true).getAsJsonObject("friend"));
				if (friend != null) replaceFriend(friend);
				result.complete(null);
			} catch (ServiceException e) {
				result.completeExceptionally(e.status() == 404 && !friends2 ? new ServiceException(FRIENDS2_MISSING, 404) : e);
			} catch (Exception e) {
				result.completeExceptionally(new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	/** Profilkarte eines Freundes: Freund (aktuell), gemeinsame Freunde, Cape und Cosmetics (leer, wenn nicht erkennbar) */
	public static CompletableFuture<Profile> profile(UUID uuid) {
		CompletableFuture<Profile> result = new CompletableFuture<>();
		if (!online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		NET.execute(() -> {
			try {
				JsonObject json = call("GET", "/v1/friends/" + compact(uuid) + "/profile", null, true);
				Friend friend = friend(json.getAsJsonObject("friend"));
				if (friend == null) throw new ServiceException("Der Heldix-Dienst hat kein Profil geliefert");
				replaceFriend(friend);
				List<Mutual> mutual = new ArrayList<>();
				for (JsonElement element : array(json, "mutual")) {
					if (!element.isJsonObject()) continue;
					UUID id = uuid(string(element.getAsJsonObject(), "uuid"));
					String name = string(element.getAsJsonObject(), "name");
					if (id != null && name != null) mutual.add(new Mutual(id, name));
				}
				Map<String, String> cosmetics = new java.util.HashMap<>();
				JsonElement worn = json.get("cosmetics");
				if (worn != null && worn.isJsonObject()) {
					for (String slot : dev.heldixclient.cosmetic.Cosmetics.WORN_SLOTS) {
						JsonElement value = worn.getAsJsonObject().get(slot);
						String id = value != null && value.isJsonPrimitive() ? value.getAsString() : null;
						if (id != null && dev.heldixclient.cosmetic.CosmeticFormat.ID_RE.matcher(id).matches()) cosmetics.put(slot, id);
					}
				}
				result.complete(new Profile(friend, List.copyOf(mutual), blankToNull(string(json, "cape")), Map.copyOf(cosmetics)));
			} catch (ServiceException e) {
				result.completeExceptionally(e.status() == 404 && !friends2 ? new ServiceException(FRIENDS2_MISSING, 404) : e);
			} catch (Exception e) {
				result.completeExceptionally(new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	static CompletableFuture<Void> friendsCall(String method, String path, JsonObject body) {
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

	/**
	 * Fehler mit Text für den Spieler (vom Dienst); status = HTTP-Status der Antwort, 0 = keine Antwort des Dienstes.
	 * {@code body} = die Fehlerantwort des Dienstes (ab 1.13.0 teils mit {@code code} und Zusatzfeldern), sonst null.
	 */
	public static final class ServiceException extends Exception {
		private final int status;
		private final transient JsonObject body;

		public ServiceException(String message) {
			this(message, 0);
		}

		public ServiceException(String message, int status) {
			this(message, status, null);
		}

		public ServiceException(String message, int status, JsonObject body) {
			super(message);
			this.status = status;
			this.body = body;
		}

		public int status() {
			return status;
		}

		/** Fehlercode des Dienstes (z. B. "beta", "missing-chunks"), sonst null */
		public String code() {
			return body != null && body.has("code") && body.get("code").isJsonPrimitive() ? body.get("code").getAsString() : null;
		}

		/** ganze Fehlerantwort (für Zusatzfelder wie {@code missing}), sonst null */
		public JsonObject body() {
			return body;
		}
	}

	/**
	 * Große Übertragungen (dauerhafte Welten: Teile hochladen, Welt herunterladen, Bilder aus Entdecken): Anfrage mit
	 * eigener Zeitgrenze, ohne den Netzwerk-Thread des Dienstes zu blockieren. Das Ergebnis ist die rohe Antwort (auch bei
	 * Fehlern, siehe {@link #failure}); Abbrechen über {@code cancel(true)} des Futures. {@code body} = roher Körper
	 * (application/octet-stream) oder null. Ohne Anmeldung bzw. ohne Dienst: sofort ein Fehler.
	 */
	public static CompletableFuture<HttpResponse<java.io.InputStream>> transfer(String method, String path, byte[] body, Duration timeout, boolean auth) {
		return transfer(method, path, body, "application/octet-stream", timeout, auth);
	}

	/** wie {@link #transfer(String, String, byte[], Duration, boolean)}, mit eigenem Inhaltstyp (z. B. JSON mit langer Zeitgrenze) */
	public static CompletableFuture<HttpResponse<java.io.InputStream>> transfer(String method, String path, byte[] body, String contentType, Duration timeout,
			boolean auth) {
		if (baseUrl().isEmpty()) return CompletableFuture.failedFuture(new ServiceException("Kein Heldix-Dienst eingetragen"));
		// nur das Token zählt: ein langer Upload übersteht so eine kurze Unterbrechung der Echtzeit-Verbindung
		String current = token;
		if (auth && current == null) return CompletableFuture.failedFuture(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl() + path))
				.timeout(timeout)
				.header("Accept", "*/*")
				.header("User-Agent", HeldixClient.NAME + "/" + HeldixClient.version);
		if (auth) request.header("Authorization", "Bearer " + current);
		if (body != null) {
			request.header("Content-Type", contentType);
			request.method(method, HttpRequest.BodyPublishers.ofByteArray(body));
		} else {
			request.method(method, HttpRequest.BodyPublishers.noBody());
		}
		return HTTP.sendAsync(request.build(), HttpResponse.BodyHandlers.ofInputStream()).thenApply(response -> {
			if (response.statusCode() == 401 && auth) NET.execute(Social::connect);
			return response;
		});
	}

	/** Fehler einer rohen Antwort ({@link #transfer}) mit dem Text des Dienstes (liest höchstens 64 KB und schließt den Strom) */
	public static ServiceException failure(HttpResponse<java.io.InputStream> response) {
		String text = "";
		try (java.io.InputStream in = response.body()) {
			text = new String(in.readNBytes(64 * 1024), StandardCharsets.UTF_8);
		} catch (IOException e) {
			// ohne Text
		}
		JsonElement json = parse(text);
		JsonObject object = json.isJsonObject() ? json.getAsJsonObject() : null;
		String message = object != null ? string(object, "error") : null;
		return new ServiceException(message != null ? message : "Fehler beim Dienst (" + response.statusCode() + ")", response.statusCode(), object);
	}

	/** Antwort einer rohen Anfrage als JSON (Status unter 400), sonst {@link ServiceException} mit dem Text des Dienstes */
	public static JsonElement json(HttpResponse<java.io.InputStream> response) throws ServiceException {
		if (response.statusCode() >= 400) throw failure(response);
		try (java.io.InputStream in = response.body()) {
			return parse(new String(in.readNBytes(1 << 20), StandardCharsets.UTF_8));
		} catch (IOException e) {
			throw new ServiceException("Antwort des Dienstes unvollständig");
		}
	}

	static JsonObject call(String method, String path, JsonObject body, boolean auth) throws IOException, InterruptedException, ServiceException {
		JsonElement element = callElement(method, path, body, auth);
		return element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
	}

	/**
	 * Anfrage an den Dienst im Netzwerk-Thread, Antwort als JSON (Objekt oder Liste) – für „Welt teilen“
	 * (dev.heldixclient.share). {@code auth}: mit Anmeldung (dann nur, solange verbunden). Fehler kommen als
	 * {@link ServiceException} mit Text für den Spieler und HTTP-Status (0 = keine Antwort).
	 */
	public static CompletableFuture<JsonElement> request(String method, String path, JsonObject body, boolean auth) {
		CompletableFuture<JsonElement> result = new CompletableFuture<>();
		if (auth && !online()) {
			result.completeExceptionally(new ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		if (baseUrl().isEmpty()) {
			result.completeExceptionally(new ServiceException("Kein Heldix-Dienst eingetragen"));
			return result;
		}
		NET.execute(() -> {
			try {
				result.complete(callElement(method, path, body, auth));
			} catch (Exception e) {
				result.completeExceptionally(e instanceof ServiceException ? e : new ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	private static JsonElement callElement(String method, String path, JsonObject body, boolean auth) throws IOException, InterruptedException, ServiceException {
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
		JsonElement json = parse(response.body());
		if (response.statusCode() == 401 && auth) {
			// Anmeldung beim Dienst abgelaufen: neu anmelden
			NET.execute(Social::connect);
		}
		if (response.statusCode() >= 400) {
			String message = json.isJsonObject() ? string(json.getAsJsonObject(), "error") : null;
			throw new ServiceException(message != null ? message : "Fehler beim Dienst (" + response.statusCode() + ")", response.statusCode(),
					json.isJsonObject() ? json.getAsJsonObject() : null);
		}
		return json;
	}

	private static JsonElement parse(String text) {
		try {
			JsonElement element = JsonParser.parseString(text == null || text.isBlank() ? "{}" : text);
			return element.isJsonObject() || element.isJsonArray() ? element : new JsonObject();
		} catch (RuntimeException e) {
			return new JsonObject();
		}
	}

	static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || object.get(key).isJsonNull()) return null;
		return object.get(key).getAsString();
	}

	static JsonArray array(JsonObject object, String key) {
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
