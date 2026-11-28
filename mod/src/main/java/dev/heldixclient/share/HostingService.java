package dev.heldixclient.share;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.social.Social;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

/**
 * Dauerhafte Welten, Entdecken und die Heldix+-Warteliste beim Heldix-Dienst (ab 1.13.0, Vertrag in docs/dienst.md):
 * reine Anfragen und das Lesen der Antworten. Den Stand für die Oberfläche hält {@link Hosting}, Upload und Download
 * macht {@link HostingTransfer}. Fehler kommen als {@link Social.ServiceException} mit Text für den Spieler.
 */
public final class HostingService {
	/** ältere Dienste kennen die Wege nicht (404) */
	public static final String HOSTING_MISSING = "Dauerhafte Welten gibt es erst ab Heldix-Dienst 1.13.0 – der verbundene Dienst ist älter.";
	public static final String DISCOVER_MISSING = "Entdecken gibt es erst ab Heldix-Dienst 1.13.0 – der verbundene Dienst ist älter.";
	/** Text des Relays, wenn eine schlafende Welt geweckt wird (siehe HostedJoin) */
	public static final String TEXT_STARTING = "Die Welt startet gerade";

	/** Zustand einer dauerhaften Welt bzw. eines Eintrags in Entdecken (online = normal geteilte Welt, gerade geöffnet) */
	public enum State {
		CREATING("creating", "wird eingerichtet"),
		SLEEPING("sleeping", "schläft"),
		STARTING("starting", "startet gerade"),
		RUNNING("running", "läuft"),
		STOPPING("stopping", "hält an"),
		ERROR("error", "hat ein Problem"),
		DELETED("deleted", "beendet"),
		ONLINE("online", "geöffnet");

		public final String id;
		public final String label;

		State(String id, String label) {
			this.id = id;
			this.label = label;
		}

		public static State of(String id) {
			for (State state : values()) if (state.id.equals(id)) return state;
			return ERROR;
		}

		/** Beitreten weckt sie (oder sie wacht gerade auf): dann dauert es etwa 30 Sekunden */
		public boolean waking() {
			return this == SLEEPING || this == STOPPING || this == STARTING;
		}

		/** Beitreten geht (läuft, geöffnet oder weckbar) */
		public boolean joinable() {
			return this == RUNNING || this == ONLINE || waking();
		}
	}

	/** laufender Upload laut Dienst ({@code UploadView}) */
	public record Upload(int chunkSize, int chunks, long size, Set<Integer> received, long maxBytes) {
	}

	/** {@code HostedWorld}: owner = eigene Welt (sonst Operator) */
	public record Hosted(String id, String code, String address, String name, State state, String error, String version, String software,
			int players, int maxPlayers, boolean owner, UUID ownerUuid, String ownerName, String access, boolean awaitingUpload, String notice,
			Upload upload) {
		/** Zeile für Listen: „läuft · 2/8 Spieler“, „schläft – Beitreten weckt sie“ … */
		public String stateLine() {
			return switch (state) {
				case RUNNING -> "läuft  ·  " + players + "/" + maxPlayers + " Spieler";
				case SLEEPING -> "schläft – Beitreten weckt sie";
				case STARTING -> "startet gerade …";
				case STOPPING -> "hält gerade an";
				case CREATING -> awaitingUpload ? "wartet auf den Upload" : "wird eingerichtet …";
				case ERROR -> error != null ? error : "hat gerade ein Problem";
				default -> state.label;
			};
		}

		public Hosted withState(State next) {
			return new Hosted(id, code, address, name, next, error, version, software, players, maxPlayers, owner, ownerUuid, ownerName, access,
					awaitingUpload, notice, upload);
		}
	}

	/** Grenzen aus {@code GET /v1/hosting} (null bei „aus“) */
	public record Limits(int worlds, int used, int chunkBytes, long maxBytes, String eula, int maxPlayers) {
	}

	/**
	 * {@code GET /v1/hosting}: available = der Dienst kann dauerhafte Welten (sonst reason "off" bzw. älterer Dienst),
	 * allowed = der Spieler darf (Team oder Freischaltung), reason "beta" = noch nicht freigeschaltet.
	 */
	public record Overview(boolean available, boolean allowed, String reason, boolean team, Limits limits, List<Hosted> worlds, List<Hosted> operated,
			String problem) {
		public static Overview off(String problem) {
			return new Overview(false, false, "off", false, null, List.of(), List.of(), problem);
		}

		/** eigene dauerhafte Welt zu einer Welt-ID, sonst null */
		public Hosted own(String id) {
			for (Hosted world : worlds) if (world.id().equals(id)) return world;
			return null;
		}

		/** noch Platz für eine weitere dauerhafte Welt? */
		public boolean room() {
			return allowed && limits != null && worlds.size() < limits.worlds();
		}
	}

	/** {@code GET /v1/plus}: since = auf der Warteliste seit (ms) bzw. 0, count = öffentliche Zahl (null unter 50) */
	public record Plus(long since, boolean granted, boolean team, Integer count) {
		public boolean waiting() {
			return since > 0;
		}
	}

	/** Eintrag in Entdecken ({@code DiscoverEntry}) */
	public record DiscoverEntry(String code, String name, String description, List<String> tags, String lang, String version, int players,
			int maxPlayers, State state, boolean persistent, UUID hostUuid, String hostName, String icon, int likes, String address) {
	}

	public record DiscoverPage(String sort, int page, int pages, int total, List<DiscoverEntry> entries) {
	}

	public record Like(boolean liked, int likes) {
	}

	/** Sortierung in Entdecken (Reihenfolge = Weiterschalten) */
	public enum Sort {
		POPULAR("popular", "Beliebt"),
		ACTIVE("active", "Gerade aktiv"),
		NEW("new", "Neu");

		public final String id;
		public final String label;

		Sort(String id, String label) {
			this.id = id;
			this.label = label;
		}

		public Sort next() {
			return values()[(ordinal() + 1) % values().length];
		}
	}

	/** feste Tags des Verzeichnisses (ID → Name), Reihenfolge wie beim Dienst */
	public static final Map<String, String> TAGS = tags();
	/** Gründe beim Melden (ID → Text) */
	public static final Map<String, String> REPORT_REASONS = reasons();

	private static Map<String, String> tags() {
		Map<String, String> map = new LinkedHashMap<>();
		map.put("survival", "Survival");
		map.put("kreativ", "Kreativ");
		map.put("minispiele", "Minispiele");
		map.put("rollenspiel", "Rollenspiel");
		map.put("bauen", "Bauen");
		map.put("parkour", "Parkour");
		map.put("technik", "Technik");
		map.put("entspannt", "Entspannt");
		map.put("hardcore", "Hardcore");
		return java.util.Collections.unmodifiableMap(map);
	}

	private static Map<String, String> reasons() {
		Map<String, String> map = new LinkedHashMap<>();
		map.put("harassment", "Beleidigung oder Hetze");
		map.put("advertising", "Werbung für fremde Dienste");
		map.put("inappropriate", "Nicht jugendfrei");
		map.put("spam", "Spam");
		map.put("other", "Etwas anderes");
		return java.util.Collections.unmodifiableMap(map);
	}

	private HostingService() {
	}

	// ======================================================================================
	// Dauerhafte Welten
	// ======================================================================================

	/** {@code GET /v1/hosting}; älterer Dienst (404): „aus“ mit Hinweis */
	public static CompletableFuture<Overview> overview() {
		return Social.request("GET", "/v1/hosting", null, true).handle((json, error) -> {
			if (error != null) {
				Throwable cause = cause(error);
				if (cause instanceof Social.ServiceException service && service.status() == 404) return Overview.off(HOSTING_MISSING);
				throw new CompletionException(cause);
			}
			return overview(json);
		});
	}

	static Overview overview(JsonElement json) {
		JsonObject object = json != null && json.isJsonObject() ? json.getAsJsonObject() : new JsonObject();
		String reason = string(object, "reason");
		if ("off".equals(reason)) return Overview.off(null);
		Limits limits = null;
		if (object.has("limits") && object.get("limits").isJsonObject()) {
			JsonObject l = object.getAsJsonObject("limits");
			JsonObject upload = l.has("upload") && l.get("upload").isJsonObject() ? l.getAsJsonObject("upload") : new JsonObject();
			long chunk = number(upload, "chunkBytes");
			long max = number(upload, "maxBytes");
			String eula = string(l, "eula");
			limits = new Limits((int) Math.max(1, number(l, "worlds")), (int) Math.max(0, number(l, "used")),
					(int) Math.clamp(chunk <= 0 ? 8L << 20 : chunk, 64 * 1024, 64L << 20), max <= 0 ? 2L << 30 : max,
					eula != null && eula.startsWith("https://") ? eula : "https://www.minecraft.net/eula", (int) Math.clamp(number(l, "maxPlayers"), 1, 100));
		}
		return new Overview(true, bool(object, "allowed"), reason, bool(object, "team"), limits, worlds(array(object, "worlds")),
				worlds(array(object, "operated")), null);
	}

	private static List<Hosted> worlds(JsonArray array) {
		List<Hosted> list = new ArrayList<>();
		for (JsonElement element : array) {
			Hosted world = hosted(element);
			if (world != null) list.add(world);
		}
		list.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
		return List.copyOf(list);
	}

	/** {@code HostedWorld} aus einer Antwort bzw. {@code hosting-state}; ungültig: null */
	public static Hosted hosted(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		if (object.has("world") && object.get("world").isJsonObject() && !object.has("id")) object = object.getAsJsonObject("world");
		String id = string(object, "id");
		if (id == null || !WorldService.WORLD_ID.matcher(id).matches()) return null;
		State state = State.of(string(object, "state"));
		String address = string(object, "address");
		if (address != null && !address.matches("(?i)^[a-z0-9.-]{1,250}(:\\d{1,5})?$")) address = null;
		String code = string(object, "code");
		if (code != null && !WorldService.WORLD_CODE.matcher(code).matches()) code = null;
		JsonObject owner = object.has("owner") && object.get("owner").isJsonObject() ? object.getAsJsonObject("owner") : new JsonObject();
		Upload upload = null;
		if (object.has("upload") && object.get("upload").isJsonObject()) upload = upload(object.getAsJsonObject("upload"));
		long max = number(object, "maxPlayers");
		return new Hosted(id, code, address == null ? null : address.toLowerCase(Locale.ROOT), WorldService.name(string(object, "name")), state,
				oneLine(string(object, "error"), 200), version(string(object, "version")), "vanilla".equals(string(object, "software")) ? "vanilla" : "paper",
				(int) Math.clamp(number(object, "players"), 0, 1000), (int) Math.clamp(max <= 0 ? 8 : max, 1, 100), !"operator".equals(string(object, "role")),
				Social.uuid(string(owner, "uuid")), playerName(string(owner, "name")), string(object, "access"), bool(object, "awaitingUpload"),
				oneLine(string(object, "notice"), 200), upload);
	}

	static Upload upload(JsonObject object) {
		long chunk = number(object, "chunkSize");
		long chunks = number(object, "chunks");
		if (chunk <= 0 || chunks <= 0 || chunks > 1_000_000) return null;
		Set<Integer> received = new TreeSet<>();
		for (JsonElement element : array(object, "received")) {
			if (element.isJsonPrimitive() && element.getAsJsonPrimitive().isNumber()) {
				int index = element.getAsInt();
				if (index >= 0 && index < chunks) received.add(index);
			}
		}
		return new Upload((int) Math.min(chunk, Integer.MAX_VALUE), (int) chunks, number(object, "size"), received, number(object, "maxBytes"));
	}

	/** {@code POST /v1/hosting/worlds { world, version }}: eigene geteilte Welt dauerhaft machen (wartet danach auf den Upload) */
	public static CompletableFuture<Hosted> create(String worldId, String version) {
		JsonObject body = new JsonObject();
		body.addProperty("world", worldId);
		if (version != null && version.matches("^[A-Za-z0-9._-]{1,32}$")) body.addProperty("version", version);
		return Social.request("POST", "/v1/hosting/worlds", body, true).thenApply(HostingService::requireHosted);
	}

	/** {@code GET /v1/hosting/worlds/<id>} */
	public static CompletableFuture<Hosted> get(String id) {
		return Social.request("GET", "/v1/hosting/worlds/" + id, null, true).thenApply(HostingService::requireHosted);
	}

	/** {@code DELETE /v1/hosting/worlds/<id>}: dauerhaft beenden (die geteilte Welt bleibt) */
	public static CompletableFuture<Void> delete(String id) {
		return Social.request("DELETE", "/v1/hosting/worlds/" + id, null, true).thenApply(json -> null);
	}

	/** {@code POST …/upload { size }} */
	public static CompletableFuture<Upload> uploadStart(String id, long size) {
		JsonObject body = new JsonObject();
		body.addProperty("size", size);
		return Social.request("POST", "/v1/hosting/worlds/" + id + "/upload", body, true).thenApply(json -> {
			Upload upload = json.isJsonObject() ? upload(json.getAsJsonObject()) : null;
			if (upload == null) throw new CompletionException(new Social.ServiceException("Der Heldix-Dienst hat den Upload nicht angenommen"));
			return upload;
		});
	}

	/** {@code DELETE …/upload} */
	public static CompletableFuture<Void> uploadCancel(String id) {
		return Social.request("DELETE", "/v1/hosting/worlds/" + id + "/upload", null, true).thenApply(json -> null);
	}

	/** {@code POST …/knocks/<name> { allow }}: Anklopfen an einer dauerhaften Welt beantworten */
	public static CompletableFuture<Void> answerKnock(String id, String name, boolean allow) {
		JsonObject body = new JsonObject();
		body.addProperty("allow", allow);
		return Social.request("POST", "/v1/hosting/worlds/" + id + "/knocks/" + encode(name), body, true).thenApply(json -> null);
	}

	// ======================================================================================
	// Heldix+-Warteliste
	// ======================================================================================

	/** {@code GET /v1/plus} */
	public static CompletableFuture<Plus> plus() {
		return Social.request("GET", "/v1/plus", null, true).thenApply(HostingService::plus);
	}

	/** {@code PUT /v1/plus/waitlist} (true) bzw. {@code DELETE} (false) */
	public static CompletableFuture<Plus> waitlist(boolean join) {
		return Social.request(join ? "PUT" : "DELETE", "/v1/plus/waitlist", null, true).thenApply(HostingService::plus);
	}

	/** {@code POST /v1/plus/seen}: Hinweis zur Freischaltung gesehen */
	public static CompletableFuture<Plus> seen() {
		return Social.request("POST", "/v1/plus/seen", null, true).thenApply(HostingService::plus);
	}

	static Plus plus(JsonElement json) {
		JsonObject object = json != null && json.isJsonObject() ? json.getAsJsonObject() : new JsonObject();
		long since = 0;
		if (object.has("waitlist") && object.get("waitlist").isJsonObject()) since = Math.max(1, number(object.getAsJsonObject("waitlist"), "since"));
		JsonElement count = object.get("count");
		Integer shown = count != null && count.isJsonPrimitive() && count.getAsJsonPrimitive().isNumber() ? Math.max(0, count.getAsInt()) : null;
		return new Plus(since, bool(object, "granted"), bool(object, "team"), shown);
	}

	// ======================================================================================
	// Entdecken
	// ======================================================================================

	/** {@code GET /v1/public/discover?sort=&tag=&q=&page=} (öffentlich, ohne Anmeldung) */
	public static CompletableFuture<DiscoverPage> discover(Sort sort, String tag, String query, int page) {
		StringBuilder path = new StringBuilder("/v1/public/discover?sort=").append(sort.id).append("&page=").append(Math.clamp(page, 1, 500));
		if (tag != null && TAGS.containsKey(tag)) path.append("&tag=").append(tag);
		String q = query == null ? "" : query.strip();
		if (!q.isEmpty()) path.append("&q=").append(encode(q.length() > 64 ? q.substring(0, 64) : q));
		return Social.request("GET", path.toString(), null, false).handle((json, error) -> {
			if (error != null) {
				Throwable cause = cause(error);
				if (cause instanceof Social.ServiceException service && service.status() == 404) {
					throw new CompletionException(new Social.ServiceException(DISCOVER_MISSING, 404));
				}
				throw new CompletionException(cause);
			}
			return page(json);
		});
	}

	static DiscoverPage page(JsonElement json) {
		JsonObject object = json != null && json.isJsonObject() ? json.getAsJsonObject() : new JsonObject();
		List<DiscoverEntry> entries = new ArrayList<>();
		for (JsonElement element : array(object, "entries")) {
			DiscoverEntry entry = entry(element);
			if (entry != null) entries.add(entry);
		}
		return new DiscoverPage(string(object, "sort"), (int) Math.max(1, number(object, "page")), (int) Math.clamp(number(object, "pages"), 1, 500),
				(int) Math.max(0, number(object, "total")), List.copyOf(entries));
	}

	/** {@code DiscoverEntry}; ungültig: null */
	public static DiscoverEntry entry(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		String code = string(object, "code");
		String address = string(object, "address");
		if (code == null || !WorldService.WORLD_CODE.matcher(code).matches() || address == null || !WorldShare.isWorldAddress(address)) return null;
		JsonObject host = object.has("host") && object.get("host").isJsonObject() ? object.getAsJsonObject("host") : new JsonObject();
		List<String> tags = new ArrayList<>();
		for (JsonElement tag : array(object, "tags")) {
			if (tag.isJsonPrimitive() && TAGS.containsKey(tag.getAsString()) && tags.size() < 3) tags.add(tag.getAsString());
		}
		String icon = string(object, "icon");
		if (icon != null && !icon.equals("/v1/public/discover/" + code + "/icon.png")) icon = null;
		long max = number(object, "maxPlayers");
		return new DiscoverEntry(code, WorldService.name(string(object, "name")), oneLine(string(object, "description"), 160), List.copyOf(tags),
				"en".equals(string(object, "lang")) ? "en" : "de", version(string(object, "version")), (int) Math.clamp(number(object, "players"), 0, 1000),
				(int) Math.clamp(max <= 0 ? 8 : max, 1, 100), State.of(string(object, "state")), bool(object, "persistent"),
				Social.uuid(string(host, "uuid")), playerName(string(host, "name")), icon, (int) Math.clamp(number(object, "likes"), 0, 10_000_000),
				WorldShare.normalizeAddress(address));
	}

	/** {@code GET /v1/discover/<code>/like} */
	public static CompletableFuture<Like> liked(String code) {
		return Social.request("GET", "/v1/discover/" + code + "/like", null, true).thenApply(HostingService::like);
	}

	/** {@code PUT} (true) bzw. {@code DELETE} (false) {@code /v1/discover/<code>/like} */
	public static CompletableFuture<Like> like(String code, boolean like) {
		return Social.request(like ? "PUT" : "DELETE", "/v1/discover/" + code + "/like", null, true).thenApply(HostingService::like);
	}

	static Like like(JsonElement json) {
		JsonObject object = json != null && json.isJsonObject() ? json.getAsJsonObject() : new JsonObject();
		return new Like(bool(object, "liked"), (int) Math.clamp(number(object, "likes"), 0, 10_000_000));
	}

	/** {@code POST /v1/discover/<code>/report { reason, note }} */
	public static CompletableFuture<Void> report(String code, String reason, String note) {
		JsonObject body = new JsonObject();
		body.addProperty("reason", REPORT_REASONS.containsKey(reason) ? reason : "other");
		String clean = oneLine(note, 300);
		if (clean != null) body.addProperty("note", clean);
		return Social.request("POST", "/v1/discover/" + code + "/report", body, true).thenApply(json -> null);
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static Hosted requireHosted(JsonElement json) {
		Hosted world = hosted(json);
		if (world == null) throw new CompletionException(new Social.ServiceException("Der Heldix-Dienst hat eine ungültige Welt geliefert"));
		return world;
	}

	static Throwable cause(Throwable error) {
		Throwable cause = error;
		while (cause instanceof CompletionException && cause.getCause() != null) cause = cause.getCause();
		while (cause instanceof java.util.concurrent.ExecutionException && cause.getCause() != null) cause = cause.getCause();
		return cause;
	}

	/** Fehlercode des Dienstes (z. B. "beta") aus einem Fehler, sonst null */
	public static String code(Throwable error) {
		return cause(error) instanceof Social.ServiceException service ? service.code() : null;
	}

	/** Spielername (3–16 Zeichen wie bei Minecraft), sonst „Unbekannt“ */
	static String playerName(String raw) {
		return raw != null && raw.matches("^[A-Za-z0-9_]{1,16}$") ? raw : "Unbekannt";
	}

	private static String version(String raw) {
		return raw != null && raw.matches("^[A-Za-z0-9._+-]{1,32}$") ? raw : null;
	}

	/** Text vom Dienst für eine Zeile: ohne Steuer- und Formatzeichen, gekürzt; leer = null */
	static String oneLine(String text, int max) {
		if (text == null) return null;
		String clean = text.replaceAll("[\\p{Cc}\\p{Cf}§]", " ").replaceAll("\\s+", " ").strip();
		if (clean.codePointCount(0, clean.length()) > max) clean = clean.substring(0, clean.offsetByCodePoints(0, max));
		return clean.isEmpty() ? null : clean;
	}

	private static String encode(String text) {
		return URLEncoder.encode(text.strip(), StandardCharsets.UTF_8).replace("+", "%20");
	}

	private static JsonArray array(JsonObject object, String key) {
		return object != null && object.has(key) && object.get(key).isJsonArray() ? object.getAsJsonArray(key) : new JsonArray();
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}

	private static long number(JsonObject object, String key) {
		JsonElement value = object == null ? null : object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsLong() : 0;
	}

	private static boolean bool(JsonObject object, String key) {
		JsonElement value = object == null ? null : object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() && value.getAsBoolean();
	}
}
