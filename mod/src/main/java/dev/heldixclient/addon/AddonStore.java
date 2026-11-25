package dev.heldixclient.addon;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.social.Social;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Addon-Store im Spiel: Liste vom Heldix-Dienst (GET /v1/addons), Installieren, Aktualisieren und Entfernen.
 *
 * Jede Addon-Version ist vom HeldixClient-Team mit dem Update-Schlüssel signiert (über "heldix-addon\n" + Manifest);
 * der öffentliche Schlüssel liegt als heldix-store-key.pem in der Mod. Geprüft werden Signatur, Größe, SHA-256 und die
 * heldix.addon.json der JAR. Änderungen wirken beim nächsten Start, weil Addons ihre Tasten beim Start anlegen.
 * Unter Windows sind geladene JARs gesperrt – sie landen in heldix-addons/.entfernen und werden beim Start gelöscht.
 */
public final class AddonStore {
	public static final String SIGNATURE_PREFIX = "heldix-addon\n";
	public static final String PENDING_FILE = ".entfernen";
	/** Ersatz für eine gesperrte JAR gleichen Namens, wird beim nächsten Start eingesetzt */
	public static final String REPLACEMENT = ".neu";
	private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9_-]{0,39}");
	private static final Pattern VERSION = Pattern.compile("\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?");
	private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
	private static final Pattern ICON = Pattern.compile("[a-z0-9-]{1,30}");
	private static final Set<String> CATEGORIES = Set.of("hud", "musik", "chat", "werkzeuge", "sonstiges");
	private static final Set<String> PLATFORMS = Set.of("windows", "mac", "linux");
	private static final long MAX_SIZE = 50L * 1024 * 1024;
	/** Liste höchstens so lange wiederverwenden, ohne neu zu fragen */
	private static final long FRESH_MS = 5 * 60 * 1000L;

	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
			.connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
	private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Addon-Store");
		thread.setDaemon(true);
		return thread;
	});

	/** Ein Addon aus dem Store (nur aus dem geprüften, signierten Manifest) */
	public record Entry(String id, String name, String version, String summary, String description, List<String> authors, int api,
			String icon, String category, List<String> platforms, String file, long size, String sha256, String date, List<String> notes,
			long downloads) {
		/** Warum es hier nicht läuft, sonst null */
		public String problem() {
			if (api > HeldixApi.API_VERSION) return "Braucht einen neueren HeldixClient";
			if (!platforms.isEmpty() && !platforms.contains(platform())) return "Nur für " + platformList(platforms);
			return null;
		}

		public String categoryLabel() {
			return switch (category) {
				case "hud" -> "HUD";
				case "musik" -> "Musik & Medien";
				case "chat" -> "Chat & Freunde";
				case "werkzeuge" -> "Werkzeuge";
				default -> "Sonstiges";
			};
		}
	}

	/** Ein installiertes Addon auf der Festplatte (ohne vorgemerkte Löschungen) */
	public record Installed(String id, String version, List<Path> files) {
	}

	public enum Status { IDLE, LOADING, READY, ERROR }

	private static volatile Status status = Status.IDLE;
	private static volatile String error;
	private static volatile List<Entry> entries = List.of();
	private static volatile long loadedAt;
	private static volatile Map<String, Installed> installed = Map.of();
	private static volatile boolean scanned;
	/** laufende Downloads: Addon-ID → Fortschritt 0..1 */
	private static final Map<String, Float> PROGRESS = new ConcurrentHashMap<>();
	/** letzter Fehler je Addon */
	private static final Map<String, String> FAILED = new ConcurrentHashMap<>();
	/** in dieser Sitzung geändert: Addon-ID → "installiert", "aktualisiert" oder "entfernt" */
	private static final Map<String, String> CHANGED = new ConcurrentHashMap<>();
	private static PublicKey key;

	private AddonStore() {
	}

	// ======================================================================================
	// Zustand für die Oberfläche
	// ======================================================================================

	public static Status status() {
		return status;
	}

	public static String error() {
		return error;
	}

	public static List<Entry> entries() {
		return entries;
	}

	/** Installierte Version (ohne die zum Entfernen vorgemerkten Dateien), sonst null */
	public static String installedVersion(String id) {
		if (!scanned) rescan();
		Installed found = installed.get(id);
		return found != null ? found.version() : null;
	}

	/** Fortschritt eines Downloads 0..1, null = keiner läuft */
	public static Float progress(String id) {
		return PROGRESS.get(id);
	}

	public static String failure(String id) {
		return FAILED.get(id);
	}

	/** Was sich in dieser Sitzung geändert hat (Addon-ID → Aktion); wirkt erst nach einem Neustart */
	public static Map<String, String> changes() {
		return Map.copyOf(CHANGED);
	}

	/** Anzahl der Addons mit Update im Store (für das Abzeichen in der Seitenleiste) */
	public static int updateCount() {
		if (status != Status.READY) return 0;
		int count = 0;
		for (Entry entry : entries) {
			String version = installedVersion(entry.id());
			if (version != null && entry.problem() == null && !PROGRESS.containsKey(entry.id()) && AddonManager.compareVersions(entry.version(), version) > 0) count++;
		}
		return count;
	}

	/** Darf der Store den Heldix-Dienst fragen? (eingerichtet und nicht ausgeschaltet) */
	public static boolean available() {
		return !Social.baseUrl().isEmpty() && HeldixConfig.get().socialEnabled;
	}

	public static String platform() {
		String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
		return os.contains("win") ? "windows" : os.contains("mac") || os.contains("darwin") ? "mac" : "linux";
	}

	static String platformList(List<String> platforms) {
		List<String> names = new ArrayList<>();
		for (String p : platforms) names.add(switch (p) {
			case "windows" -> "Windows";
			case "mac" -> "macOS";
			default -> "Linux";
		});
		return String.join(" und ", names);
	}

	// ======================================================================================
	// Liste laden
	// ======================================================================================

	/** Liste (neu) laden; ohne force nur, wenn sie älter als fünf Minuten ist. */
	public static void refresh(boolean force) {
		if (!available() || status == Status.LOADING) return;
		if (!force && status == Status.READY && System.currentTimeMillis() - loadedAt < FRESH_MS) return;
		status = Status.LOADING;
		run(() -> {
			try {
				entries = load();
				error = null;
				loadedAt = System.currentTimeMillis();
				status = Status.READY;
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Addon-Store: Liste nicht geladen: {}", e.toString());
				error = message(e, "Der Addon-Store ist gerade nicht erreichbar.");
				status = Status.ERROR;
			}
			rescan();
		});
	}

	private static List<Entry> load() throws Exception {
		HttpRequest request = HttpRequest.newBuilder(URI.create(Social.baseUrl() + "/v1/addons"))
				.timeout(Duration.ofSeconds(20))
				.header("Accept", "application/json")
				.header("User-Agent", HeldixClient.NAME + "/" + HeldixClient.version)
				.GET().build();
		HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		if (response.statusCode() != 200) throw new IOException("Der Addon-Store antwortet nicht richtig (" + response.statusCode() + ").");
		JsonObject body = JsonParser.parseString(response.body()).getAsJsonObject();
		List<Entry> result = new ArrayList<>();
		JsonArray list = body.has("addons") && body.get("addons").isJsonArray() ? body.getAsJsonArray("addons") : new JsonArray();
		for (JsonElement element : list) {
			try {
				JsonObject item = element.getAsJsonObject();
				long downloads = item.has("downloads") && item.get("downloads").isJsonPrimitive() ? item.get("downloads").getAsLong() : 0;
				result.add(verify(item.get("manifest").getAsString(), item.get("signature").getAsString(), downloads));
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Addon-Store: Eintrag verworfen: {}", e.getMessage());
			}
		}
		return List.copyOf(result);
	}

	/** Prüft Signatur und Felder eines Manifests (gleiche Regeln wie Launcher und Dienst); wirft bei Fehlern. */
	public static Entry verify(String manifest, String signature, long downloads) throws Exception {
		Signature check = Signature.getInstance("Ed25519");
		check.initVerify(publicKey());
		check.update((SIGNATURE_PREFIX + manifest).getBytes(StandardCharsets.UTF_8));
		if (!check.verify(Base64.getDecoder().decode(signature))) throw new SecurityException("Signatur stimmt nicht");

		JsonObject m = JsonParser.parseString(manifest).getAsJsonObject();
		if (!"heldix-addon".equals(text(m, "type", 1, 20))) throw new IllegalArgumentException("Kein Addon-Manifest");
		String id = text(m, "id", 1, 40);
		String version = text(m, "version", 1, 64);
		if (!ID.matcher(id).matches() || !VERSION.matcher(version).matches()) throw new IllegalArgumentException("ID oder Version ungültig");
		String file = text(m, "file", 1, 200);
		if (!file.equals("heldix-addon-" + id + "-" + version + ".jar")) throw new IllegalArgumentException("Dateiname passt nicht");
		long size = m.get("size").getAsLong();
		if (size < 1 || size > MAX_SIZE) throw new IllegalArgumentException("Größe ungültig");
		String sha256 = text(m, "sha256", 64, 64);
		if (!SHA256.matcher(sha256).matches()) throw new IllegalArgumentException("SHA-256 ungültig");
		int api = m.get("api").getAsInt();
		String category = m.has("category") ? m.get("category").getAsString() : "sonstiges";
		if (!CATEGORIES.contains(category)) category = "sonstiges";
		String icon = m.has("icon") ? m.get("icon").getAsString() : "addons";
		if (!ICON.matcher(icon).matches()) icon = "addons";
		List<String> platforms = strings(m, "platforms", 3, 10);
		if (!PLATFORMS.containsAll(platforms)) throw new IllegalArgumentException("Systeme ungültig");
		return new Entry(id, text(m, "name", 1, 40), version, text(m, "summary", 1, 200),
				m.has("description") ? text(m, "description", 0, 4000) : "", strings(m, "authors", 5, 40), api, icon, category,
				platforms, file, size, sha256, m.has("date") ? text(m, "date", 1, 40) : "", strings(m, "notes", 20, 300), downloads);
	}

	private static String text(JsonObject object, String key, int min, int max) {
		if (!object.has(key) || !object.get(key).isJsonPrimitive()) throw new IllegalArgumentException("„" + key + "“ fehlt");
		String value = object.get(key).getAsString();
		if (value.strip().length() < min || value.length() > max) throw new IllegalArgumentException("„" + key + "“ ungültig");
		return value;
	}

	private static List<String> strings(JsonObject object, String key, int maxCount, int maxLength) {
		if (!object.has(key) || !object.get(key).isJsonArray()) return List.of();
		List<String> list = new ArrayList<>();
		for (JsonElement element : object.getAsJsonArray(key)) {
			String value = element.getAsString();
			if (value.isBlank() || value.length() > maxLength) throw new IllegalArgumentException("„" + key + "“ ungültig");
			list.add(value);
		}
		if (list.size() > maxCount) throw new IllegalArgumentException("„" + key + "“ ungültig");
		return List.copyOf(list);
	}

	private static synchronized PublicKey publicKey() throws Exception {
		if (key != null) return key;
		try (InputStream in = AddonStore.class.getResourceAsStream("/heldix-store-key.pem")) {
			if (in == null) throw new IllegalStateException("Kein Store-Schlüssel in der Mod");
			String pem = new String(in.readAllBytes(), StandardCharsets.US_ASCII)
					.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", "");
			key = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(pem)));
			return key;
		}
	}

	// ======================================================================================
	// Installieren, Aktualisieren, Entfernen
	// ======================================================================================

	/** Lädt die Version aus dem Store in heldix-addons/ (ältere Versionen werden ersetzt bzw. zum Entfernen vorgemerkt). */
	public static void install(Entry entry) {
		if (entry.problem() != null || PROGRESS.putIfAbsent(entry.id(), 0f) != null) return;
		FAILED.remove(entry.id());
		run(() -> {
			try {
				boolean update = installedVersion(entry.id()) != null;
				download(entry);
				CHANGED.put(entry.id(), update ? "aktualisiert" : "installiert");
				HeldixClient.LOGGER.info("Addon-Store: {} {} {}", entry.name(), entry.version(), update ? "aktualisiert" : "installiert");
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Addon-Store: {} nicht installiert", entry.id(), e);
				FAILED.put(entry.id(), message(e, "Installieren fehlgeschlagen."));
			} finally {
				rescan();
				PROGRESS.remove(entry.id());
			}
		});
	}

	private static void download(Entry entry) throws Exception {
		Path dir = AddonManager.addonDirectory();
		Files.createDirectories(dir);
		Path target = dir.resolve(entry.file());
		// liegt genau diese Datei schon da (z. B. entfernt und gleich wieder installiert): nur die Löschung zurücknehmen
		if (Files.isRegularFile(target) && Files.size(target) == entry.size() && sha256(target).equals(entry.sha256())) {
			unmarkPending(entry.file());
			removeOtherVersions(entry, target);
			return;
		}
		Path part = dir.resolve(entry.file() + ".part");
		String url = Social.baseUrl() + "/v1/addons/" + encode(entry.id()) + "/files/" + encode(entry.file());
		HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofMinutes(3))
				.header("User-Agent", HeldixClient.NAME + "/" + HeldixClient.version).GET().build();
		HttpResponse<InputStream> response = HTTP.send(request, HttpResponse.BodyHandlers.ofInputStream());
		MessageDigest digest = MessageDigest.getInstance("SHA-256");
		long total = 0;
		try (InputStream in = response.body()) {
			if (response.statusCode() != 200) throw new IOException("Download fehlgeschlagen (" + response.statusCode() + ").");
			try (OutputStream out = Files.newOutputStream(part)) {
				byte[] buffer = new byte[64 * 1024];
				int read;
				while ((read = in.read(buffer)) > 0) {
					total += read;
					if (total > entry.size()) throw new IOException("Die Datei ist größer als angegeben.");
					digest.update(buffer, 0, read);
					out.write(buffer, 0, read);
					PROGRESS.put(entry.id(), Math.min(1f, total / (float) entry.size()));
				}
			}
			if (total != entry.size() || !HexFormat.of().formatHex(digest.digest()).equals(entry.sha256())) {
				throw new IOException("Die Datei ist beschädigt oder wurde verändert (Prüfsumme stimmt nicht).");
			}
			AddonMetadata meta = AddonManager.readMetadata(part);
			if (!entry.id().equals(meta.id) || !entry.version().equals(meta.version)) {
				throw new IOException("Die JAR passt nicht zum Store-Eintrag (ID oder Version weichen ab).");
			}
		} catch (Exception e) {
			Files.deleteIfExists(part);
			throw e;
		}
		removeOtherVersions(entry, target);
		try {
			Files.move(part, target, StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException locked) {
			// gleicher Dateiname, alte JAR ist geladen (Windows): beim nächsten Start einsetzen
			Files.move(part, dir.resolve(entry.file() + REPLACEMENT), StandardCopyOption.REPLACE_EXISTING);
		}
		unmarkPending(entry.file());
	}

	private static void removeOtherVersions(Entry entry, Path keep) {
		Installed current = scan().get(entry.id());
		if (current == null) return;
		for (Path file : current.files()) {
			if (!file.equals(keep)) deleteOrMark(file);
		}
	}

	/** Entfernt alle Dateien eines Addons (geladene erst beim nächsten Start). */
	public static void remove(String id) {
		if (PROGRESS.containsKey(id)) return;
		run(() -> {
			Installed current = scan().get(id);
			if (current != null) {
				for (Path file : current.files()) deleteOrMark(file);
				CHANGED.put(id, "entfernt");
				FAILED.remove(id);
			}
			rescan();
		});
	}

	private static void deleteOrMark(Path file) {
		try {
			Files.deleteIfExists(file);
		} catch (IOException e) {
			// unter Windows hält der Classloader geladene JARs offen
			markPending(file.getFileName().toString());
		}
	}

	// ======================================================================================
	// Vorgemerkte Löschungen (heldix-addons/.entfernen, eine Datei pro Zeile)
	// ======================================================================================

	/** Beim Start, bevor Addons geladen werden: vorgemerkte Dateien löschen und Ersatz-JARs einsetzen. */
	static void applyPendingRemovals(Path dir) {
		try (Stream<Path> list = Files.list(dir)) {
			for (Path file : list.filter(p -> p.getFileName().toString().endsWith(".jar" + REPLACEMENT)).toList()) {
				String name = file.getFileName().toString();
				Path target = dir.resolve(name.substring(0, name.length() - REPLACEMENT.length()));
				try {
					Files.move(file, target, StandardCopyOption.REPLACE_EXISTING);
					HeldixClient.LOGGER.info("Heldix-Addons: {} aus dem Addon-Store eingesetzt", target.getFileName());
				} catch (IOException e) {
					HeldixClient.LOGGER.warn("Heldix-Addons: {} nicht eingesetzt", name, e);
				}
			}
		} catch (IOException ignored) {
			// kein Ordner
		}
		Set<String> pending = readPending(dir);
		if (pending.isEmpty()) return;
		Set<String> left = new LinkedHashSet<>();
		for (String name : pending) {
			try {
				Files.deleteIfExists(dir.resolve(name));
				HeldixClient.LOGGER.info("Heldix-Addons: {} entfernt (vorgemerkt im Addon-Store)", name);
			} catch (IOException e) {
				left.add(name);
			}
		}
		writePending(dir, left);
	}

	private static volatile Set<String> pendingCache;

	/** Ist die Datei zum Entfernen beim nächsten Start vorgemerkt? (zwischengespeichert, für die Oberfläche) */
	public static boolean pendingRemoval(String fileName) {
		Set<String> cache = pendingCache;
		if (cache == null) pendingCache = cache = Set.copyOf(readPending(AddonManager.addonDirectory()));
		return cache.contains(fileName);
	}

	private static synchronized void markPending(String name) {
		Path dir = AddonManager.addonDirectory();
		Set<String> pending = readPending(dir);
		if (pending.add(name)) writePending(dir, pending);
	}

	private static synchronized void unmarkPending(String name) {
		Path dir = AddonManager.addonDirectory();
		Set<String> pending = readPending(dir);
		if (pending.remove(name)) writePending(dir, pending);
	}

	private static Set<String> readPending(Path dir) {
		Set<String> names = new LinkedHashSet<>();
		try {
			for (String line : Files.readAllLines(dir.resolve(PENDING_FILE), StandardCharsets.UTF_8)) {
				String name = line.strip();
				// nur einfache Dateinamen im Addon-Ordner
				if (!name.isEmpty() && !name.contains("/") && !name.contains("\\") && !name.contains("..") && name.matches(".+\\.jar(\\.disabled)?")) names.add(name);
			}
		} catch (IOException ignored) {
			// keine Datei = nichts vorgemerkt
		}
		return names;
	}

	private static void writePending(Path dir, Set<String> names) {
		pendingCache = Set.copyOf(names);
		try {
			if (names.isEmpty()) Files.deleteIfExists(dir.resolve(PENDING_FILE));
			else Files.writeString(dir.resolve(PENDING_FILE), String.join("\n", names) + "\n", StandardCharsets.UTF_8);
		} catch (IOException e) {
			HeldixClient.LOGGER.warn("Heldix-Addons: {} nicht schreibbar", PENDING_FILE, e);
		}
	}

	// ======================================================================================
	// Installierte Addons auf der Festplatte
	// ======================================================================================

	private static void rescan() {
		installed = scan();
		scanned = true;
	}

	private static Map<String, Installed> scan() {
		Path dir = AddonManager.addonDirectory();
		Set<String> pending = readPending(dir);
		Map<String, List<Path>> files = new HashMap<>();
		Map<String, String> newest = new HashMap<>();
		try (Stream<Path> list = Files.list(dir)) {
			List<Path> all = list.sorted(Comparator.naturalOrder()).toList();
			for (Path file : all) {
				String name = file.getFileName().toString();
				// Ersatz-JAR (.jar.neu) zählt statt der gesperrten JAR gleichen Namens
				boolean replacement = name.endsWith(".jar" + REPLACEMENT);
				if (!replacement && (!name.endsWith(".jar") || pending.contains(name) || all.contains(dir.resolve(name + REPLACEMENT)))) continue;
				try {
					AddonMetadata meta = AddonManager.readMetadata(file);
					if (meta.id == null) continue;
					files.computeIfAbsent(meta.id, k -> new ArrayList<>()).add(file);
					String best = newest.get(meta.id);
					if (best == null || AddonManager.compareVersions(meta.version, best) > 0) newest.put(meta.id, meta.version);
				} catch (Exception ignored) {
					// kaputte JARs zeigt die Liste "Installiert"
				}
			}
		} catch (IOException ignored) {
			// kein Ordner = nichts installiert
		}
		Map<String, Installed> result = new HashMap<>();
		files.forEach((id, paths) -> result.put(id, new Installed(id, newest.get(id), List.copyOf(paths))));
		return Map.copyOf(result);
	}

	// ======================================================================================

	private static String sha256(Path file) throws Exception {
		MessageDigest digest = MessageDigest.getInstance("SHA-256");
		try (InputStream in = Files.newInputStream(file)) {
			byte[] buffer = new byte[64 * 1024];
			int read;
			while ((read = in.read(buffer)) > 0) digest.update(buffer, 0, read);
		}
		return HexFormat.of().formatHex(digest.digest());
	}

	private static String encode(String value) {
		return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
	}

	private static String message(Exception e, String fallback) {
		if (e instanceof java.net.ConnectException || e instanceof java.net.http.HttpTimeoutException
				|| e instanceof java.nio.channels.UnresolvedAddressException) return fallback;
		String text = e.getMessage();
		return text != null && !text.isBlank() && text.length() < 160 ? text : fallback;
	}

	private static final java.util.concurrent.atomic.AtomicInteger QUEUED = new java.util.concurrent.atomic.AtomicInteger();

	private static void run(Runnable task) {
		QUEUED.incrementAndGet();
		WORKER.execute(() -> {
			try {
				task.run();
			} finally {
				QUEUED.decrementAndGet();
			}
		});
	}

	/** Läuft gerade etwas (Liste laden, Download, Entfernen)? Für den Autotest. */
	public static boolean busy() {
		return QUEUED.get() > 0;
	}
}
