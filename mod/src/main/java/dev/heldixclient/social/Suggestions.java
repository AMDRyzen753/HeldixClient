package dev.heldixclient.social;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.HeldixLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;

import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Freundesvorschläge (ab Heldix-Dienst 1.12.0, freiwillig):
 * <ul>
 *   <li>„Freunde von Freunden“ vom Dienst ({@code GET /v1/friends/suggestions}): nur Spieler mit „In Vorschlägen
 *   erscheinen“, mit der Zahl gemeinsamer Freunde (ohne Namen); aus, solange „Vorschläge zeigen“ aus ist.</li>
 *   <li>Aus der Nähe, nur auf diesem PC: HeldixClient-Spieler (Heldix-Symbol über dem Kopf, also erkennbar), mit denen
 *   man insgesamt mindestens 10 Minuten im Umkreis von 32 Blöcken gespielt hat. Gemerkt werden UUID, Name, Zeit in der Nähe
 *   und zuletzt gesehen – 30 Tage lang in {@code config/heldixclient-nearby.json}, löschbar, abschaltbar. Nichts davon
 *   geht an den Dienst.</li>
 * </ul>
 */
public final class Suggestions {
	/** Vorschlag vom Dienst: mutual = Zahl gemeinsamer Freunde */
	public record Suggestion(UUID uuid, String name, int mutual) {
	}

	/** Spieler aus der Nähe (nur lokal) */
	public record Nearby(UUID uuid, String name, long nearMs, long lastSeen) {
	}

	/** ab so viel gemeinsamer Zeit in der Nähe ein Vorschlag */
	public static final long MIN_NEAR_MS = 10 * 60_000;
	/** so lange gemerkt (ab zuletzt gesehen) */
	private static final long KEEP_MS = 30L * 24 * 60 * 60_000;
	private static final double RADIUS = 32;
	private static final int MAX_ENTRIES = 500;
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path FILE = HeldixLoader.configDir().resolve(HeldixClient.MOD_ID + "-nearby.json");

	private static final class Entry {
		String name;
		long nearMs;
		long lastSeen;
		/** „Entfernen“ gedrückt: nicht mehr vorschlagen (bleibt bis zum Ablauf, damit er nicht gleich wiederkommt) */
		boolean dismissed;
	}

	private static final Map<UUID, Entry> NEARBY = new ConcurrentHashMap<>();
	private static volatile boolean loaded;
	private static volatile boolean dirty;
	private static long lastTickAt;
	private static long lastSaveAt;
	private static int ticks;

	private static volatile boolean serverEnabled;
	private static volatile boolean serverLoaded;
	private static volatile List<Suggestion> server = List.of();

	private Suggestions() {
	}

	// ======================================================================================
	// Vom Dienst: Freunde von Freunden
	// ======================================================================================

	/** Liste vom Dienst (leer, solange nicht geladen bzw. „Vorschläge zeigen“ aus) */
	public static List<Suggestion> server() {
		List<Suggestion> list = new ArrayList<>();
		for (Suggestion suggestion : server) {
			if (!Social.isFriend(suggestion.uuid()) && !requested(suggestion.uuid())) list.add(suggestion);
		}
		return list;
	}

	/** Zeigt der Dienst Vorschläge? (false = „Vorschläge zeigen“ aus oder noch nicht geladen) */
	public static boolean serverEnabled() {
		return serverEnabled;
	}

	public static boolean serverLoaded() {
		return serverLoaded;
	}

	/** Neu laden ({@code GET /v1/friends/suggestions}) */
	public static CompletableFuture<Void> load() {
		if (!Social.friends2()) return CompletableFuture.completedFuture(null);
		return Social.request("GET", "/v1/friends/suggestions", null, true).thenAccept(element -> {
			JsonObject json = element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
			List<Suggestion> list = new ArrayList<>();
			for (JsonElement entry : Social.array(json, "suggestions")) {
				if (!entry.isJsonObject()) continue;
				JsonObject object = entry.getAsJsonObject();
				UUID uuid = Social.uuid(Social.string(object, "uuid"));
				String name = Social.oneLine(Social.string(object, "name"), 16);
				int mutual = object.has("mutual") && object.get("mutual").isJsonPrimitive() ? object.get("mutual").getAsInt() : 0;
				if (uuid != null && name != null) list.add(new Suggestion(uuid, name, mutual));
				if (list.size() >= 20) break;
			}
			serverEnabled = json.has("enabled") && json.get("enabled").isJsonPrimitive() && json.get("enabled").getAsBoolean();
			server = List.copyOf(list);
			serverLoaded = true;
		});
	}

	/** Anfrage an einen Vorschlag vom Dienst ({@code POST /v1/friends/suggestions/<uuid>/request}) */
	public static CompletableFuture<Void> request(UUID uuid) {
		return Social.friendsCall("POST", "/v1/friends/suggestions/" + Social.compact(uuid) + "/request", null).thenRun(() ->
				server = server.stream().filter(s -> !s.uuid().equals(uuid)).toList());
	}

	static void resetServer() {
		server = List.of();
		serverEnabled = false;
		serverLoaded = false;
	}

	// ======================================================================================
	// Aus der Nähe (nur lokal)
	// ======================================================================================

	public static boolean nearbyEnabled() {
		return HeldixConfig.get().nearbySuggestions;
	}

	/** Schalter „Spieler in der Nähe merken“; aus = alles Gemerkte löschen */
	public static void setNearbyEnabled(boolean enabled) {
		HeldixConfig.get().nearbySuggestions = enabled;
		HeldixConfig.save();
		if (!enabled) clearNearby();
	}

	/** Vorschläge aus der Nähe: mindestens 10 Minuten, keine Freunde, keine offenen Anfragen, meiste Zeit zuerst (höchstens 10) */
	public static List<Nearby> nearby() {
		ensureLoaded();
		long now = System.currentTimeMillis();
		List<Nearby> list = new ArrayList<>();
		for (Map.Entry<UUID, Entry> entry : NEARBY.entrySet()) {
			Entry value = entry.getValue();
			UUID uuid = entry.getKey();
			if (value.dismissed || value.nearMs < MIN_NEAR_MS || now - value.lastSeen > KEEP_MS) continue;
			if (Social.isFriend(uuid) || requested(uuid)) continue;
			list.add(new Nearby(uuid, value.name, value.nearMs, value.lastSeen));
		}
		list.sort(Comparator.comparingLong(Nearby::nearMs).reversed());
		return list.size() > 10 ? List.copyOf(list.subList(0, 10)) : List.copyOf(list);
	}

	/** Zahl aller gemerkten Spieler (auch unter 10 Minuten) – für „Gemerktes löschen“ */
	public static int nearbyCount() {
		ensureLoaded();
		return NEARBY.size();
	}

	/** Vorschlag ausblenden (bleibt bis zum Ablauf gemerkt, damit er nicht gleich wiederkommt) */
	public static void dismiss(UUID uuid) {
		Entry entry = NEARBY.get(uuid);
		if (entry == null) return;
		entry.dismissed = true;
		dirty = true;
		save();
	}

	/** Alles Gemerkte löschen (auch die Datei) */
	public static void clearNearby() {
		NEARBY.clear();
		dirty = false;
		try {
			Files.deleteIfExists(FILE);
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Vorschläge aus der Nähe: Datei nicht gelöscht ({})", e.toString());
		}
	}

	/** Jeden Tick (Haupt-Thread): einmal pro Sekunde zählen, wer in der Nähe ist; jede Minute speichern */
	static void tick(Minecraft mc) {
		if (++ticks % 20 != 0) return;
		long now = System.currentTimeMillis();
		long elapsed = lastTickAt == 0 ? 0 : Math.min(2000, now - lastTickAt);
		lastTickAt = now;
		if (!nearbyEnabled() || !Social.online()) return;
		if (dirty && now - lastSaveAt > 60_000) save();
		if (mc.level == null || mc.player == null || elapsed <= 0 || mc.isPaused()) return;
		ensureLoaded();
		UUID own = mc.getUser().getProfileId();
		for (AbstractClientPlayer other : mc.level.players()) {
			if (other == mc.player || other.getUUID().equals(own) || other.distanceTo(mc.player) > RADIUS) continue;
			UUID uuid = other.getUUID();
			// nur erkennbare HeldixClient-Spieler (Heldix-Symbol über dem Kopf), keine Freunde
			if (!Social.isHeldix(uuid) || Social.isFriend(uuid)) continue;
			Entry entry = NEARBY.computeIfAbsent(uuid, id -> new Entry());
			entry.name = other.getGameProfile().name();
			entry.nearMs += elapsed;
			entry.lastSeen = now;
			dirty = true;
		}
	}

	/** Gemerktes speichern (abgelaufene fallen weg) */
	public static synchronized void save() {
		if (!dirty) return;
		dirty = false;
		lastSaveAt = System.currentTimeMillis();
		prune();
		if (NEARBY.isEmpty()) {
			clearNearby();
			return;
		}
		Map<String, Entry> out = new LinkedHashMap<>();
		NEARBY.forEach((uuid, entry) -> out.put(Social.compact(uuid), entry));
		try {
			Files.createDirectories(FILE.getParent());
			try (Writer writer = Files.newBufferedWriter(FILE)) {
				GSON.toJson(out, writer);
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Vorschläge aus der Nähe nicht gespeichert ({})", e.toString());
		}
	}

	private static synchronized void ensureLoaded() {
		if (loaded) return;
		loaded = true;
		if (!Files.isRegularFile(FILE)) return;
		try (Reader reader = Files.newBufferedReader(FILE)) {
			Map<String, Entry> in = GSON.fromJson(reader, new TypeToken<Map<String, Entry>>() {
			}.getType());
			if (in == null) return;
			in.forEach((key, entry) -> {
				UUID uuid = Social.uuid(key);
				if (uuid != null && entry != null && entry.name != null) NEARBY.put(uuid, entry);
			});
			prune();
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Vorschläge aus der Nähe nicht lesbar, fange neu an ({})", e.toString());
		}
	}

	/** Älter als 30 Tage weg; höchstens 500 (die zuletzt gesehenen bleiben) */
	private static void prune() {
		long now = System.currentTimeMillis();
		NEARBY.values().removeIf(entry -> now - entry.lastSeen > KEEP_MS);
		if (NEARBY.size() > MAX_ENTRIES) {
			List<Map.Entry<UUID, Entry>> sorted = new ArrayList<>(NEARBY.entrySet());
			sorted.sort(Comparator.comparingLong(e -> e.getValue().lastSeen));
			for (int i = 0; i < sorted.size() - MAX_ENTRIES; i++) NEARBY.remove(sorted.get(i).getKey());
		}
	}

	private static boolean requested(UUID uuid) {
		for (Social.Request request : Social.outgoing()) if (request.uuid().equals(uuid)) return true;
		for (Social.Request request : Social.incoming()) if (request.uuid().equals(uuid)) return true;
		return false;
	}

	/** Nur für automatische Tests: Eintrag ganz vergessen (nichts vom Test bleibt in der Datei) */
	public static void testForget(UUID uuid) {
		if (NEARBY.remove(uuid) == null) return;
		dirty = true;
		save();
	}

	/** Nur für automatische Tests: einen Spieler so eintragen, als wäre er {@code minutes} Minuten in der Nähe gewesen */
	public static void testNearby(UUID uuid, String name, int minutes) {
		ensureLoaded();
		Entry entry = NEARBY.computeIfAbsent(uuid, id -> new Entry());
		entry.name = name;
		entry.nearMs = minutes * 60_000L;
		entry.lastSeen = System.currentTimeMillis();
		entry.dismissed = false;
		dirty = true;
	}
}
