package dev.heldixclient.voice;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.VoiceChannel;
import dev.heldixclient.social.Party;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * Voice-Moderation (Heldix-Dienst 1.13.0, Feature {@code moderation}, Protokoll „Voice-Moderation“): Sperren durch das
 * Team ({@code banned}, Close 4013), Voice-Regeln ({@code rules}, Close 4012, {@code GET /v1/voice/me},
 * {@code POST /v1/voice/rules/accept}), Rechte im Raum ({@code room}), Stummschalten und Entfernen durch Gastgeber,
 * Operatoren und Party-Leiter ({@code mod}, {@code moderated}, {@code peers.silenced}, {@code group: kicked}) und der
 * Schalter für Aufnahmen ({@code ready.clips}, {@code clips}). {@link VoiceLink} reicht die Nachrichten hierher (Netzwerk-
 * Thread); Ereignisse gehen im Haupt-Thread an die Addons (API 10). Gespeichert wird nichts – alles nur für diese Sitzung.
 */
public final class VoiceModeration {
	private static final DateTimeFormatter UNTIL = DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm 'Uhr'", Locale.GERMANY);
	/** dauerhafte Sperre: frühestens nach so langer Zeit wieder versuchen */
	private static final long PERMANENT_RETRY_MS = 30 * 60_000L;
	/** Regeln nicht angenommen: so selten nachsehen, ob sie inzwischen (z. B. auf der Webseite) angenommen sind */
	private static final long RULES_RETRY_MS = 10 * 60_000L;
	/** gleiche Hinweise (z. B. „… hat dich stummgeschaltet“ nach dem Wiederverbinden) so lange nicht wiederholen */
	private static final long REPEAT_MS = 10 * 60_000L;
	private static final long MOD_TIMEOUT_MS = 10_000;

	/** Sperre durch das Team; until 0 = dauerhaft; exact = Ende vom Dienst bekannt (sonst nur geschätzt) */
	record Ban(long until, String reason, String message, String appeal, boolean exact) {
		boolean active(long now) {
			return until == 0 || until > now;
		}
	}

	/** stumm geschaltet bzw. entfernt durch Gastgeber/Leiter; scope "world" oder "party" */
	record Restriction(String scope, String byName, long until, String message) {
	}

	/** Grenzen für Aufnahmen (aus {@code ready.clips} bzw. {@code clips}) */
	record Clips(long maxMs, int maxBytes) {
	}

	/** Ergebnis der Vorprüfung vor dem Verbinden */
	enum Verdict {
		OK,
		BANNED,
		RULES
	}

	private record Listener(String owner, Consumer<VoiceChannel.ModerationEvent> consumer) {
	}

	private record Pending(Consumer<String> callback, long until) {
	}

	/** Ereignis für die Addons */
	record Event(VoiceChannel.ModerationEvent.Kind kind, String message, String scope, String byName, long until)
			implements VoiceChannel.ModerationEvent {
	}

	private static final CopyOnWriteArrayList<Listener> LISTENERS = new CopyOnWriteArrayList<>();
	private static final Map<String, Pending> PENDING = new ConcurrentHashMap<>();
	private static final Map<String, Long> NOTIFIED = new ConcurrentHashMap<>();
	/** Addons, denen der Regeln-Dialog für eine Version schon automatisch gezeigt wurde ("owner|version") */
	private static final Set<String> AUTO_SHOWN = ConcurrentHashMap.newKeySet();

	private static volatile boolean available;
	private static volatile Ban ban;
	private static volatile boolean serverOff;
	private static volatile String serverOffMessage;
	private static volatile String roomServer;
	private static volatile String worldName;
	private static volatile String worldRole;
	private static volatile boolean partyLeader;
	private static volatile Restriction muted;
	private static volatile Restriction kicked;
	private static volatile Set<UUID> silenced = Set.of();
	private static volatile int rulesVersion;
	private static volatile int rulesAccepted;
	private static volatile boolean rulesRequired;
	private static volatile Clips clips;
	/** Aufnahmen laut {@code /v1/voice/me} bzw. Regeln (auch ohne Verbindung) */
	private static volatile boolean clipsService;
	/** Vorprüfung: zuletzt ohne Befund (ms), älterer Dienst ohne {@code /v1/voice/me} (ms) */
	private static volatile long checkedOkAt;
	private static volatile long noModerationAt;

	private VoiceModeration() {
	}

	// ======================================================================================
	// Stand (für VoiceLink, AddonPlayers, Dialoge)
	// ======================================================================================

	public static boolean available() {
		return available;
	}

	static Ban ban() {
		Ban current = ban;
		return current != null && current.active(System.currentTimeMillis()) ? current : null;
	}

	public static boolean serverOff() {
		return serverOff;
	}

	public static boolean isSilenced(UUID participant) {
		return participant != null && silenced.contains(participant);
	}

	public static Set<UUID> silenced() {
		return silenced;
	}

	public static boolean rulesRequired() {
		return rulesRequired;
	}

	public static int rulesVersion() {
		return rulesVersion;
	}

	public static int rulesAccepted() {
		return rulesAccepted;
	}

	/** Aufnahmen gerade aktiv: verbunden, Dienst mit Moderation und {@code clips} nicht null */
	public static boolean clipsActive() {
		return clips != null && available && VoiceLink.status() == VoiceLink.Status.CONNECTED;
	}

	static Clips clipLimits() {
		return clips;
	}

	public static String worldRole() {
		return worldRole;
	}

	public static boolean partyLeader() {
		return partyLeader && VoiceLink.inPartyGroup();
	}

	/** Momentaufnahme für die Addon-API */
	public static VoiceChannel.Moderation state() {
		Ban current = ban();
		Restriction mute = muted;
		Restriction kick = kicked;
		long now = System.currentTimeMillis();
		boolean kickActive = kick != null && (kick.until() == 0 || kick.until() > now);
		// ohne Ende vom Dienst: wie üblich 10 Minuten
		long kickedUntil = kickActive ? (kick.until() > 0 ? kick.until() : now + 600_000) : 0;
		return new State(available, current != null, current != null ? current.until() : 0, current != null ? current.reason() : null,
				current != null ? current.message() : null, current != null ? current.appeal() : null, serverOff,
				mute != null ? (mute.byName() != null ? mute.byName() : "Jemand") : null, kickedUntil, rulesRequired);
	}

	private record State(boolean available, boolean banned, long bannedUntil, String banReason, String banMessage, String banAppeal,
			boolean serverOff, String mutedBy, long kickedUntil, boolean rulesRequired) implements VoiceChannel.Moderation {
	}

	public static final VoiceChannel.Moderation EMPTY = new State(false, false, 0, null, null, null, false, null, 0, false);

	public static VoiceChannel.Rules rules() {
		return new RulesState(rulesVersion, rulesAccepted, rulesRequired, clipsService || clips != null);
	}

	private record RulesState(int version, int accepted, boolean required, boolean clipsActive) implements VoiceChannel.Rules {
	}

	/** Rechte im Raum für die Addon-API */
	public static VoiceChannel.RoomRights rights() {
		String role = worldRole;
		return new Rights(worldName, role, partyLeader());
	}

	private record Rights(String worldName, String worldRole, boolean partyLeader) implements VoiceChannel.RoomRights {
		@Override
		public boolean canModerate(UUID participant) {
			return VoiceModeration.canModerate(participant);
		}
	}

	/** Darf man diesen Teilnehmer stummschalten bzw. entfernen? (Knöpfe; entscheiden tut der Dienst) */
	public static boolean canModerate(UUID participant) {
		if (participant == null || !available || VoiceLink.status() != VoiceLink.Status.CONNECTED || VoiceLink.isGuest(participant)) return false;
		if (participant.equals(self())) return false;
		return scopeFor(participant) != null;
	}

	/** Bereich für eine Moderation: Party (Ziel in der Party, man leitet sie, Party-Gruppe aktiv), sonst Welt mit Rechten */
	private static String scopeFor(UUID participant) {
		if (partyLeader() && Party.contains(participant)) return "party";
		String role = worldRole;
		if ("host".equals(role) || "operator".equals(role)) return "world";
		return null;
	}

	/** kurzer Statustext, solange eine Sperre oder fehlende Zustimmung die Verbindung verhindert, sonst null */
	static String blockText() {
		Ban current = ban();
		if (current != null) {
			if (!current.exact()) return "Vom Voice Chat gesperrt";
			return current.until() == 0 ? "Dauerhaft vom Voice Chat gesperrt" : "Vom Voice Chat gesperrt bis " + formatUntil(current.until());
		}
		if (rulesRequired) return "Voice-Regeln noch nicht angenommen";
		return null;
	}

	/** wann nach einer Sperre bzw. fehlender Zustimmung frühestens neu verbunden wird */
	static long retryAfterBlock(long now) {
		Ban current = ban();
		if (current != null) return current.until() == 0 ? now + PERMANENT_RETRY_MS : Math.max(now + 5_000, current.until() + 1_000);
		return now + RULES_RETRY_MS;
	}

	static String formatUntil(long at) {
		return UNTIL.format(Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()));
	}

	private static UUID self() {
		Minecraft minecraft = Minecraft.getInstance();
		return minecraft == null || minecraft.getUser() == null ? null : minecraft.getUser().getProfileId();
	}

	// ======================================================================================
	// Addons: Ereignisse, Regeln-Dialog
	// ======================================================================================

	public static void addListener(String owner, Consumer<VoiceChannel.ModerationEvent> consumer) {
		LISTENERS.add(new Listener(owner, consumer));
	}

	public static void removeListener(String owner, Consumer<VoiceChannel.ModerationEvent> consumer) {
		LISTENERS.removeIf(listener -> listener.owner().equals(owner) && listener.consumer() == consumer);
	}

	/** Addon abgeschaltet oder entladen */
	static void forget(String owner) {
		LISTENERS.removeIf(listener -> listener.owner().equals(owner));
		AUTO_SHOWN.removeIf(key -> key.startsWith(owner + "|"));
	}

	/** Ein Addon hat den Kanal (wieder) eingeschaltet: der Regeln-Dialog darf sich wieder einmal von selbst öffnen */
	static void activated(String owner) {
		AUTO_SHOWN.removeIf(key -> key.startsWith(owner + "|"));
	}

	/** Darf sich der Regeln-Dialog für dieses Addon jetzt ohne Aktion des Spielers öffnen? (höchstens einmal je Version) */
	public static boolean allowAutoRules(String owner) {
		return rulesRequired && AUTO_SHOWN.add(owner + "|" + rulesVersion);
	}

	private static void fire(VoiceChannel.ModerationEvent.Kind kind, String message, String scope, String byName, long until) {
		Event event = new Event(kind, message == null ? "" : message, scope, byName, until);
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft == null) return;
		minecraft.execute(() -> {
			for (Listener listener : LISTENERS) listener.consumer().accept(event);
		});
	}

	/** wie {@link #fire}, aber derselbe Hinweis höchstens einmal in {@link #REPEAT_MS} */
	private static void fireOnce(String key, VoiceChannel.ModerationEvent.Kind kind, String message, String scope, String byName, long until) {
		long now = System.currentTimeMillis();
		Long last = NOTIFIED.get(key);
		if (last != null && now - last < REPEAT_MS) return;
		NOTIFIED.put(key, now);
		if (NOTIFIED.size() > 64) NOTIFIED.entrySet().removeIf(entry -> now - entry.getValue() > REPEAT_MS);
		fire(kind, message, scope, byName, until);
	}

	// ======================================================================================
	// Nachrichten des Dienstes (Netzwerk-Thread)
	// ======================================================================================

	/** {@code ready}: Feature "moderation", {@code rules} und {@code clips} */
	static void ready(JsonObject json, Set<String> features) {
		available = features.contains("moderation");
		if (!available) {
			clips = null;
			return;
		}
		// verbunden = nicht gesperrt und die aktuelle Fassung (falls es eine gibt) ist angenommen
		ban = null;
		rulesRequired = false;
		JsonObject rules = object(json, "rules");
		rulesVersion = rules != null ? (int) number(rules, "version", 0) : 0;
		if (rulesVersion > 0) rulesAccepted = rulesVersion;
		clips = clipsOf(object(json, "clips"));
		clipsService = clips != null;
		checkedOkAt = System.currentTimeMillis();
	}

	/** {@code peers}: wer im geltenden Bereich für alle stumm ist ({@code silenced}, ab Dienst 1.13.0) */
	static void peers(JsonObject json) {
		Set<UUID> set = new HashSet<>();
		if (json.has("silenced") && json.get("silenced").isJsonArray()) {
			for (JsonElement element : json.getAsJsonArray("silenced")) {
				if (!element.isJsonPrimitive()) continue;
				UUID uuid = Social.uuid(element.getAsString());
				if (uuid != null) set.add(uuid);
				if (set.size() >= 256) break;
			}
		}
		silenced = Set.copyOf(set);
	}

	/** Nachrichten der Moderation; true = erkannt */
	static boolean handle(String type, JsonObject json) {
		switch (type) {
			case "rules" -> {
				int version = (int) number(json, "version", 0);
				if (version > 0) rulesVersion = version;
				boolean wasRequired = rulesRequired;
				rulesRequired = true;
				checkedOkAt = 0;
				if (!wasRequired) fire(VoiceChannel.ModerationEvent.Kind.RULES_REQUIRED,
						"Bitte lies die Voice-Regeln und nimm sie an – ohne Zustimmung bleibt der Voice Chat aus.", null, null, 0);
			}
			case "banned" -> {
				applyBan(json);
				Ban current = ban;
				if (current != null) fire(VoiceChannel.ModerationEvent.Kind.BANNED, current.message(), null, null, current.until());
			}
			case "room" -> room(json);
			case "moderated" -> moderated(json);
			case "mod" -> modResult(json);
			case "clips" -> {
				Clips before = clips;
				clips = clipsOf(object(json, "clips"));
				clipsService = clips != null;
				if ((before == null) != (clips == null)) {
					fire(VoiceChannel.ModerationEvent.Kind.CLIPS_CHANGED, clips != null
							? "Meldungen im Voice Chat können ab jetzt die letzten 10 Minuten enthalten."
							: "Aufnahmen für Meldungen sind aus.", null, null, 0);
				}
			}
			default -> {
				return false;
			}
		}
		return true;
	}

	/** {@code group} mit {@code status: "kicked"}: aus der Voice-Gruppe der Party entfernt */
	static void groupKicked(JsonObject json) {
		long until = number(json, "until", 0);
		String message = string(json, "message");
		kicked = new Restriction("party", null, until, message);
		fireOnce("kicked|party|" + until / 60_000, VoiceChannel.ModerationEvent.Kind.KICKED,
				message != null ? message : "Du bist aus dem Voice der Party entfernt (10 Minuten).", "party", null, until);
	}

	private static void applyBan(JsonObject json) {
		long until = number(json, "until", 0);
		String reason = string(json, "reason");
		String message = string(json, "message");
		if (message == null) {
			message = until == 0 ? "Du bist dauerhaft vom Voice Chat gesperrt." : "Du bist bis " + formatUntil(until) + " vom Voice Chat gesperrt.";
			if (reason != null) message += " Grund: " + reason;
		}
		ban = new Ban(until, reason, message, string(json, "appeal"), true);
	}

	private static void room(JsonObject json) {
		String server = string(json, "server");
		if (server != null && !server.equals(roomServer)) {
			// anderer Server: Stummschaltung und Entfernen der Welt enden mit dem Verlassen
			Restriction mute = muted;
			if (mute != null && "world".equals(mute.scope())) muted = null;
			Restriction kick = kicked;
			if (kick != null && "world".equals(kick.scope())) kicked = null;
			serverOff = false;
			roomServer = server;
		}
		String voice = string(json, "voice");
		String message = string(json, "message");
		if ("off".equals(voice)) {
			if (!serverOff) {
				serverOff = true;
				serverOffMessage = message != null ? message : "Voice ist auf diesem Server aus (auf Wunsch des Server-Betreibers).";
				fireOnce("off|" + server, VoiceChannel.ModerationEvent.Kind.SERVER_OFF, serverOffMessage, null, null, 0);
			}
		} else {
			serverOff = false;
			serverOffMessage = null;
		}
		if ("kicked".equals(voice)) {
			long until = number(json, "until", 0);
			Restriction kick = kicked;
			if (kick == null || !"world".equals(kick.scope())) {
				kicked = new Restriction("world", null, until, message);
				fireOnce("kicked|world|" + server, VoiceChannel.ModerationEvent.Kind.KICKED,
						message != null ? message : "Du bist aus dem Voice dieser Welt entfernt.", "world", null, until);
			}
		} else if ("on".equals(voice)) {
			Restriction kick = kicked;
			if (kick != null && "world".equals(kick.scope())) kicked = null;
		}
		JsonObject world = object(json, "world");
		worldName = world != null ? clean(string(world, "name"), 48) : null;
		String role = world != null ? string(world, "role") : null;
		worldRole = "host".equals(role) || "operator".equals(role) || "player".equals(role) ? role : world != null ? "player" : null;
		JsonObject party = object(json, "party");
		partyLeader = party != null && party.has("leader") && party.get("leader").isJsonPrimitive() && party.get("leader").getAsBoolean();
	}

	private static void moderated(JsonObject json) {
		String action = string(json, "action");
		String scope = "party".equals(string(json, "scope")) ? "party" : "world";
		JsonObject by = object(json, "by");
		String byName = by != null ? clean(string(by, "name"), 24) : null;
		long until = number(json, "until", 0);
		String message = string(json, "message");
		if (action == null) return;
		switch (action) {
			case "muted" -> {
				muted = new Restriction(scope, byName, until, message);
				fireOnce("muted|" + scope + "|" + byName, VoiceChannel.ModerationEvent.Kind.MUTED,
						message != null ? message : (byName != null ? byName : "Jemand") + " hat dich hier stummgeschaltet.", scope, byName, until);
			}
			case "unmuted" -> {
				muted = null;
				NOTIFIED.keySet().removeIf(key -> key.startsWith("muted|"));
				fire(VoiceChannel.ModerationEvent.Kind.UNMUTED, message != null ? message : "Deine Stummschaltung ist aufgehoben.", scope, byName, 0);
			}
			case "kicked" -> {
				kicked = new Restriction(scope, byName, until, message);
				fireOnce("kicked|" + scope + "|" + byName + "|" + until / 60_000, VoiceChannel.ModerationEvent.Kind.KICKED,
						message != null ? message : "Du bist aus dem Voice entfernt (10 Minuten).", scope, byName, until);
			}
			case "unkicked" -> {
				kicked = null;
				NOTIFIED.keySet().removeIf(key -> key.startsWith("kicked|"));
				fire(VoiceChannel.ModerationEvent.Kind.UNKICKED, message != null ? message : "Du darfst wieder in den Voice.", scope, byName, 0);
			}
			default -> {
			}
		}
	}

	/** Antwort an den Moderierenden: {@code { type: "mod", status, action, uuid, scope, message }} */
	private static void modResult(JsonObject json) {
		String key = string(json, "action") + "|" + string(json, "uuid");
		Pending pending = PENDING.remove(key);
		if (pending == null) return;
		String message = string(json, "message");
		String status = string(json, "status");
		if (message == null) {
			message = "ok".equals(status) ? "Erledigt." : "denied".equals(status) ? "Dazu hast du hier keine Rechte." : "Das geht bei diesem Spieler nicht.";
		}
		pending.callback().accept(message);
	}

	/** Verbindung getrennt bzw. neu: Raum, Rechte und Stummschaltungen vergessen (der Dienst schickt sie neu) */
	static void clearRoom() {
		silenced = Set.of();
		worldName = null;
		worldRole = null;
		partyLeader = false;
		muted = null;
		serverOff = false;
		Restriction kick = kicked;
		if (kick != null && kick.until() > 0 && kick.until() <= System.currentTimeMillis()) kicked = null;
		// offene Moderations-Anfragen beantworten, damit kein Callback hängen bleibt
		for (Iterator<Map.Entry<String, Pending>> it = PENDING.entrySet().iterator(); it.hasNext(); ) {
			Pending pending = it.next().getValue();
			it.remove();
			pending.callback().accept("Die Verbindung zum Voice Chat ist getrennt – versuch es gleich noch einmal.");
		}
	}

	/** Ist ein Entfernen (Welt oder Party-Gruppe) gerade abgelaufen? Dann einmal true – VoiceLink meldet den Raum neu */
	static boolean takeExpiredKick(long now) {
		Restriction kick = kicked;
		if (kick == null || kick.until() == 0 || kick.until() > now) return false;
		kicked = null;
		return true;
	}

	/** Haupt-Thread, jeden Tick: Zeitüberschreitungen der Moderations-Anfragen */
	static void tick(long now) {
		if (PENDING.isEmpty()) return;
		for (Iterator<Map.Entry<String, Pending>> it = PENDING.entrySet().iterator(); it.hasNext(); ) {
			Pending pending = it.next().getValue();
			if (pending.until() > now) continue;
			it.remove();
			pending.callback().accept("Keine Antwort vom Heldix-Dienst – versuch es gleich noch einmal.");
		}
	}

	// ======================================================================================
	// Moderieren (Gastgeber, Operatoren, Party-Leiter)
	// ======================================================================================

	/**
	 * Schickt {@code { type: "mod", action, uuid, scope }}; die Antwort ({@code mod}) geht an {@code onResult}
	 * (Netzwerk- oder Haupt-Thread – der Aufrufer leitet weiter).
	 */
	public static void moderate(UUID participant, VoiceChannel.ModerationAction action, Consumer<String> onResult) {
		if (VoiceLink.status() != VoiceLink.Status.CONNECTED) {
			onResult.accept("Voice Chat ist nicht verbunden.");
			return;
		}
		if (!available) {
			onResult.accept("Der Heldix-Dienst kann das noch nicht (ab Dienst 1.13.0).");
			return;
		}
		if (participant.equals(self())) {
			onResult.accept("Dich selbst kannst du so nicht stummschalten – nimm dafür „Mikrofon stumm“.");
			return;
		}
		if (VoiceLink.isGuest(participant)) {
			onResult.accept("Gäste entfernst du mit dem × in der Voice-Anzeige.");
			return;
		}
		String scope = scopeFor(participant);
		if (scope == null) {
			onResult.accept("Das dürfen nur Gastgeber und Operatoren einer Heldix-Welt und der Leiter einer Party.");
			return;
		}
		String name = action.name().toLowerCase(Locale.ROOT);
		String uuid = Social.compact(participant);
		String key = name + "|" + uuid;
		if (PENDING.putIfAbsent(key, new Pending(onResult, System.currentTimeMillis() + MOD_TIMEOUT_MS)) != null) {
			onResult.accept("Läuft schon …");
			return;
		}
		if (PENDING.size() > 16) {
			PENDING.remove(key);
			onResult.accept("Zu viele Anfragen auf einmal – warte kurz.");
			return;
		}
		JsonObject message = new JsonObject();
		message.addProperty("type", "mod");
		message.addProperty("action", name);
		message.addProperty("uuid", uuid);
		message.addProperty("scope", scope);
		VoiceLink.sendJson(message);
	}

	// ======================================================================================
	// Vorprüfung vor dem Verbinden und Voice-Regeln (HTTP)
	// ======================================================================================

	/**
	 * Vor dem Verbinden {@code GET /v1/voice/me}: gesperrt oder Regeln offen → gar nicht erst verbinden (sonst schließt der
	 * Dienst sofort wieder, und der Client würde immer neu verbinden). Ältere Dienste (404) und Netzfehler: verbinden.
	 */
	static CompletableFuture<Verdict> precheck() {
		long now = System.currentTimeMillis();
		if (now - noModerationAt < PERMANENT_RETRY_MS || now - checkedOkAt < 30_000) return CompletableFuture.completedFuture(Verdict.OK);
		return Social.request("GET", "/v1/voice/me", null, true).handle((json, error) -> {
			if (error != null) {
				Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
				if (cause instanceof Social.ServiceException service && service.status() == 404) {
					// Dienst vor 1.13.0: keine Moderation
					noModerationAt = System.currentTimeMillis();
					available = false;
				}
				return Verdict.OK;
			}
			if (!json.isJsonObject()) return Verdict.OK;
			applyMe(json.getAsJsonObject());
			if (ban() != null) return Verdict.BANNED;
			if (rulesRequired) return Verdict.RULES;
			checkedOkAt = System.currentTimeMillis();
			return Verdict.OK;
		});
	}

	/** Antwort von {@code GET /v1/voice/me} bzw. {@code POST /v1/voice/rules/accept} übernehmen */
	static void applyMe(JsonObject json) {
		available = true;
		noModerationAt = 0;
		JsonObject rules = object(json, "rules");
		boolean wasRequired = rulesRequired;
		if (rules != null) {
			rulesVersion = (int) number(rules, "version", 0);
			rulesAccepted = (int) number(rules, "accepted", 0);
			rulesRequired = rules.has("required") && rules.get("required").isJsonPrimitive() && rules.get("required").getAsBoolean();
		}
		clipsService = json.has("clips") && json.get("clips").isJsonPrimitive() && json.get("clips").getAsBoolean();
		JsonObject banJson = object(json, "ban");
		if (banJson != null) {
			Ban before = ban;
			applyBan(banJson);
			Ban current = ban;
			if (current != null && current.active(System.currentTimeMillis()) && (before == null || before.until() != current.until())) {
				fire(VoiceChannel.ModerationEvent.Kind.BANNED, current.message(), null, null, current.until());
			}
		} else {
			ban = null;
		}
		if (rulesRequired && !wasRequired) {
			fire(VoiceChannel.ModerationEvent.Kind.RULES_REQUIRED, "Bitte lies die Voice-Regeln und nimm sie an – ohne Zustimmung bleibt der Voice Chat aus.",
					null, null, 0);
		}
	}

	/**
	 * Regeln annehmen ({@code POST /v1/voice/rules/accept}), nur aus dem Regeln-Dialog. Danach sofort neu verbinden. Fehler
	 * als {@link Social.ServiceException} (409 {@code voice-rules-version}: andere Fassung aktuell).
	 */
	static CompletableFuture<Void> accept(int version) {
		JsonObject body = new JsonObject();
		body.addProperty("version", version);
		return Social.request("POST", "/v1/voice/rules/accept", body, true).thenAccept(json -> {
			if (json.isJsonObject()) applyMe(json.getAsJsonObject());
			rulesAccepted = Math.max(rulesAccepted, version);
			if (rulesVersion <= version) rulesRequired = false;
			checkedOkAt = System.currentTimeMillis();
			HeldixClient.LOGGER.info("Voice Chat: Voice-Regeln (Fassung {}) angenommen", version);
			VoiceLink.retryNow();
		});
	}

	/** Verbindung mit 4012 geschlossen (Regeln nicht angenommen) */
	static void rulesClosed() {
		checkedOkAt = 0;
		if (!rulesRequired) {
			rulesRequired = true;
			fire(VoiceChannel.ModerationEvent.Kind.RULES_REQUIRED, "Bitte lies die Voice-Regeln und nimm sie an – ohne Zustimmung bleibt der Voice Chat aus.",
					null, null, 0);
		}
	}

	/** Verbindung mit 4013 geschlossen (Sperre); ohne vorherige {@code banned}-Nachricht: als Sperre ohne Ende merken, bis /me mehr weiß */
	static void bannedClosed() {
		checkedOkAt = 0;
		if (ban() == null) ban = new Ban(System.currentTimeMillis() + PERMANENT_RETRY_MS, null, "Du bist vom Voice Chat gesperrt.", null, false);
	}

	// ======================================================================================
	// JSON
	// ======================================================================================

	private static Clips clipsOf(JsonObject json) {
		if (json == null) return null;
		long maxMs = Math.clamp(number(json, "maxMs", OggOpus.MAX_MS), 1_000, OggOpus.MAX_MS);
		int maxBytes = (int) Math.clamp(number(json, "maxBytes", OggOpus.MAX_BYTES), 1_024, OggOpus.MAX_BYTES);
		return new Clips(maxMs, maxBytes);
	}

	static JsonObject object(JsonObject json, String key) {
		return json != null && json.has(key) && json.get(key).isJsonObject() ? json.getAsJsonObject(key) : null;
	}

	static String string(JsonObject json, String key) {
		if (json == null || !json.has(key) || !json.get(key).isJsonPrimitive()) return null;
		String value = json.get(key).getAsString();
		return value.isBlank() ? null : clean(value, 600);
	}

	static long number(JsonObject json, String key, long fallback) {
		if (json == null || !json.has(key) || !json.get(key).isJsonPrimitive() || !json.get(key).getAsJsonPrimitive().isNumber()) return fallback;
		try {
			return json.get(key).getAsLong();
		} catch (RuntimeException e) {
			return fallback;
		}
	}

	/** Text vom Dienst für die Anzeige: ohne Steuerzeichen und §, gekürzt */
	static String clean(String text, int max) {
		if (text == null) return null;
		String value = text.replaceAll("[\\p{Cc}\\p{Cf}§]", " ").strip();
		return value.length() > max ? value.substring(0, max - 1) + "…" : value;
	}
}
