package dev.heldixclient.cosmetic;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.event.ClientEvents;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;

import java.io.IOException;
import java.io.InputStream;
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
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Cosmetics-Katalog des Heldix-Dienstes (docs/dienst.md, „Cosmetics-Katalog“): Mit eingeschaltetem Dienst lädt der
 * Client beim Start und danach alle 30 Minuten die Liste ({@code GET /v1/cosmetics}), holt nur neue oder geänderte
 * Umschläge ({@code GET /v1/cosmetics/<id>?v=<sha256>}) und legt sie unter config/heldixclient-cosmetics/&lt;sha256&gt;.json ab.
 *
 * <p>Jeder Umschlag wird vor der Nutzung geprüft – auch aus dem Zwischenspeicher: SHA-256 wie im Katalog,
 * Ed25519-Signatur über {@code "heldix-cosmetic\n" + manifest} mit dem Update-Schlüssel (derselbe wie für den
 * Addon-Store, heldix-store-key.pem) und alle Regeln des Formats ({@link CosmeticFormat}). Was durchfällt, wird verworfen
 * und erscheint nirgends. Netzwerk und Dekodieren laufen im eigenen Thread, Texturen entstehen beim ersten Zeichnen.
 */
public final class CosmeticCatalog {
	public enum Status {
		/** Dienst aus oder nicht eingerichtet */
		OFF,
		LOADING,
		READY,
		ERROR
	}

	/** Eintrag der Liste {@code GET /v1/cosmetics} */
	public record Entry(String id, String slot, int version, String name, String description, boolean teamOnly, String sha256, long size, String date) {
	}

	/** Ein geprüftes Cosmetic mit Modell und (später) Texturen. */
	public static final class Item {
		private final Entry entry;
		private final CosmeticFormat.Manifest manifest;
		private final CosmeticMesh mesh;
		/** Format 2: Mesh mit Knochen und Keyframe-Animationen */
		private final CosmeticRig rig;
		/** dekodierte Bilder bis zum Hochladen (Besitz geht an die Textur über) */
		private NativeImage textureImage;
		private NativeImage glowImage;
		private NativeImage iconImage;
		private Identifier texture;
		private Identifier glow;
		private Identifier icon;
		private boolean uploaded;

		Item(Entry entry, CosmeticFormat.Manifest manifest, NativeImage textureImage, NativeImage glowImage) {
			this.entry = entry;
			this.manifest = manifest;
			this.mesh = manifest.model() != null ? new CosmeticMesh(manifest.model(), manifest.animations()) : null;
			// Format 2: Leuchten ist additiv gedacht, Minecraft mischt transparent → einmal umrechnen (vor Rig und Vorschaubild)
			if (manifest.rig() != null && glowImage != null) CosmeticRig.glowToAlpha(glowImage);
			this.rig = manifest.rig() != null ? new CosmeticRig(manifest, glowImage) : null;
			this.textureImage = textureImage;
			this.glowImage = glowImage;
			// Vorschaubild für die Kacheln im Heldix-Menü (einmal, im Hintergrund)
			if (textureImage != null) {
				if (mesh != null) iconImage = CosmeticIcons.model(mesh, textureImage, glowImage, manifest.slot().equals("back"));
				else if (rig != null) iconImage = CosmeticIcons.rig(rig, textureImage, glowImage, manifest.slot());
				else if (manifest.particles() != null) iconImage = CosmeticIcons.particles(textureImage, manifest.particles());
			}
		}

		/** Vorschaubild ({@link CosmeticIcons#SIZE} Pixel im Quadrat) oder null (Capes); nur im Render-Thread */
		public Identifier icon() {
			upload();
			return icon;
		}

		public String id() {
			return manifest.id();
		}

		public String slot() {
			return manifest.slot();
		}

		public String name() {
			return manifest.name();
		}

		public String description() {
			return manifest.description();
		}

		public boolean teamOnly() {
			return manifest.teamOnly();
		}

		/** nur für Spieler, die es freigeschaltet haben (access "unlock", Belohnung für Einladungen) */
		public boolean unlockOnly() {
			return manifest.unlockOnly();
		}

		public int version() {
			return manifest.version();
		}

		public String sha256() {
			return entry.sha256();
		}

		public CosmeticFormat.Manifest manifest() {
			return manifest;
		}

		/** Modell (head, back, companion), sonst null */
		public CosmeticMesh mesh() {
			return mesh;
		}

		/** Format 2: Mesh mit Knochen und Animationen (head, back, aura, companion), sonst null */
		public CosmeticRig rig() {
			return rig;
		}

		/** Format des Manifests (1 = Quader und einfache Animationen, 2 = Mesh mit Knochen und Keyframes) */
		public int format() {
			return manifest.format();
		}

		/** Bewegt es sich? (Format 1: Animationen oder Partikel, Format 2: immer) */
		public boolean animated() {
			return rig != null || !manifest.animations().isEmpty() || manifest.particles() != null;
		}

		/** Textur (nur im Render-Thread); beim ersten Aufruf hochgeladen. null bei Capes (die laufen über {@link Capes}). */
		public Identifier texture() {
			upload();
			return texture;
		}

		/** Leuchtebene oder null */
		public Identifier glow() {
			upload();
			return glow;
		}

		private void upload() {
			if (uploaded) return;
			uploaded = true;
			String base = "cosmetic/" + manifest.id() + "/" + entry.sha256().substring(0, 12);
			if (textureImage != null) {
				texture = HeldixClient.id(base);
				Minecraft.getInstance().getTextureManager().register(texture, new DynamicTexture(texture::toString, textureImage));
				textureImage = null;
			}
			if (glowImage != null) {
				glow = HeldixClient.id(base + "/glow");
				Minecraft.getInstance().getTextureManager().register(glow, new DynamicTexture(glow::toString, glowImage));
				glowImage = null;
			}
			if (iconImage != null) {
				icon = HeldixClient.id(base + "/icon");
				dev.heldixclient.ui.Ui.registerLinear(icon, iconImage);
				iconImage = null;
			}
		}

		/** Texturen freigeben (im Render-Thread), z. B. wenn eine neue Version kommt */
		void release() {
			if (textureImage != null) textureImage.close();
			if (glowImage != null) glowImage.close();
			if (iconImage != null) iconImage.close();
			textureImage = null;
			glowImage = null;
			iconImage = null;
			if (texture != null) Minecraft.getInstance().getTextureManager().release(texture);
			if (glow != null) Minecraft.getInstance().getTextureManager().release(glow);
			if (icon != null) Minecraft.getInstance().getTextureManager().release(icon);
			texture = null;
			glow = null;
			icon = null;
		}
	}

	private static final long REFRESH_MS = 30 * 60_000L;
	private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
			.connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
	private static final ExecutorService NET = Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Cosmetics");
		thread.setDaemon(true);
		thread.setPriority(Thread.NORM_PRIORITY - 1);
		return thread;
	});

	private static volatile Status status = Status.LOADING;
	private static volatile String error;
	/** geprüfte Cosmetics nach ID, in der Reihenfolge des Katalogs */
	private static volatile Map<String, Item> items = Map.of();
	/** Cosmetics, die bei der letzten Prüfung durchgefallen sind: ID → Grund */
	private static volatile Map<String, String> rejected = Map.of();
	private static volatile long loadedAt;
	private static volatile boolean loading;
	private static volatile int generation;
	private static String etag;
	private static PublicKey key;
	private static int ticks;

	private CosmeticCatalog() {
	}

	/** Beim Start: mit eingeschaltetem Dienst laden, danach alle 30 Minuten neu */
	public static void init() {
		ClientEvents.TICK_END.register(minecraft -> {
			// ohne Dienst keine Anfragen; schon Geladenes bleibt
			if (++ticks % 20 != 0 || !available() || loading) return;
			if (loadedAt == 0 || System.currentTimeMillis() - loadedAt > REFRESH_MS) refresh(false);
		});
	}

	/** Darf der Katalog den Heldix-Dienst fragen? (eingerichtet und nicht ausgeschaltet) */
	public static boolean available() {
		return !Social.baseUrl().isEmpty() && HeldixConfig.get().socialEnabled;
	}

	public static Status status() {
		if (!available() && items.isEmpty()) return Status.OFF;
		return status;
	}

	public static String error() {
		return error;
	}

	/** Alle geprüften Cosmetics in der Reihenfolge des Katalogs (Slot, dann Name) */
	public static List<Item> items() {
		return List.copyOf(items.values());
	}

	/** Geprüfte Cosmetics eines Slots */
	public static List<Item> items(String slot) {
		List<Item> list = new ArrayList<>();
		for (Item item : items.values()) if (item.slot().equals(slot)) list.add(item);
		return list;
	}

	/** Cosmetic nach ID (null = unbekannt, durchgefallen oder noch nicht geladen); jeder Thread */
	public static Item item(String id) {
		return id == null ? null : items.get(id);
	}

	/** Cosmetic nach ID, nur wenn es zum Slot passt */
	public static Item item(String id, String slot) {
		Item item = item(id);
		return item != null && item.slot().equals(slot) ? item : null;
	}

	/** Bei der letzten Prüfung verworfene Cosmetics (ID → Grund), für Tests und Fehlersuche */
	public static Map<String, String> rejected() {
		return rejected;
	}

	public static long loadedAt() {
		return loadedAt;
	}

	/** Ordner des Zwischenspeichers */
	public static Path cacheDir() {
		return HeldixLoader.configDir().resolve(HeldixClient.MOD_ID + "-cosmetics");
	}

	/**
	 * Katalog neu laden (im Hintergrund). Mit {@code force} auch, wenn er gerade erst geladen wurde, und ohne ETag.
	 *
	 * @return fertig, wenn geladen (oder fehlgeschlagen – siehe {@link #status()})
	 */
	public static synchronized CompletableFuture<Void> refresh(boolean force) {
		if (!available()) return CompletableFuture.completedFuture(null);
		if (force) etag = null;
		else if (loading) return CompletableFuture.completedFuture(null);
		loading = true;
		if (status != Status.READY) status = Status.LOADING;
		int gen = ++generation;
		return CompletableFuture.runAsync(() -> {
			try {
				load(gen);
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Cosmetics: Katalog nicht geladen: {}", e.toString());
				error = e instanceof IOException && e.getMessage() != null ? e.getMessage() : "Der Cosmetics-Katalog ist gerade nicht erreichbar.";
				if (items.isEmpty()) status = Status.ERROR;
				// später erneut versuchen (nicht erst nach 30 Minuten)
				loadedAt = System.currentTimeMillis() - REFRESH_MS + 60_000L;
			} finally {
				loading = false;
			}
		}, NET);
	}

	private static void load(int gen) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(Social.baseUrl() + "/v1/cosmetics"))
				.timeout(Duration.ofSeconds(20))
				.header("Accept", "application/json")
				.header("User-Agent", HeldixClient.NAME + "/" + HeldixClient.version);
		String previousEtag = etag;
		if (previousEtag != null && !items.isEmpty()) request.header("If-None-Match", previousEtag);
		HttpResponse<String> response = HTTP.send(request.GET().build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		if (response.statusCode() == 304) {
			loadedAt = System.currentTimeMillis();
			status = Status.READY;
			return;
		}
		if (response.statusCode() != 200) throw new IOException("Der Cosmetics-Katalog antwortet nicht richtig (" + response.statusCode() + ").");
		JsonObject body = JsonParser.parseString(response.body()).getAsJsonObject();
		JsonArray list = body.has("cosmetics") && body.get("cosmetics").isJsonArray() ? body.getAsJsonArray("cosmetics") : new JsonArray();
		List<Entry> entries = new ArrayList<>();
		for (JsonElement element : list) {
			Entry entry = entry(element);
			if (entry != null) entries.add(entry);
		}

		Map<String, Item> before = items;
		Map<String, Item> next = new LinkedHashMap<>();
		Map<String, String> failed = new LinkedHashMap<>();
		Path dir = cacheDir();
		Files.createDirectories(dir);
		for (Entry entry : entries) {
			Item known = before.get(entry.id());
			if (known != null && known.sha256().equals(entry.sha256())) {
				next.put(entry.id(), known);
				continue;
			}
			try {
				next.put(entry.id(), fetch(entry, dir));
			} catch (Exception e) {
				String reason = e.getMessage() != null ? e.getMessage() : e.toString();
				failed.put(entry.id(), reason);
				HeldixClient.LOGGER.warn("Cosmetics: „{}“ verworfen: {}", entry.id(), reason);
			}
		}
		if (gen != generation) {
			// ein neueres Laden hat übernommen: eigene neue Objekte wieder freigeben
			for (Item item : next.values()) if (before.get(item.id()) != item) discard(item);
			return;
		}
		Map<String, Item> published = java.util.Collections.unmodifiableMap(next);
		items = published;
		rejected = Map.copyOf(failed);
		etag = response.headers().firstValue("ETag").orElse(null);
		loadedAt = System.currentTimeMillis();
		error = null;
		status = Status.READY;
		// alte Versionen freigeben und Dateien aufräumen, die zu keinem Eintrag mehr gehören
		for (Item old : before.values()) if (published.get(old.id()) != old) discard(old);
		prune(dir, entries);
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft != null) minecraft.execute(Cosmetics::catalogChanged);
		HeldixClient.LOGGER.info("Cosmetics: {} im Katalog{}", published.size(), failed.isEmpty() ? "" : ", " + failed.size() + " verworfen");
	}

	private static Entry entry(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject o = element.getAsJsonObject();
		try {
			String id = o.get("id").getAsString();
			String slot = o.get("slot").getAsString();
			String sha256 = o.get("sha256").getAsString();
			long size = o.get("size").getAsLong();
			if (!CosmeticFormat.ID_RE.matcher(id).matches() || !CosmeticFormat.SLOTS.contains(slot) || !SHA256.matcher(sha256).matches()
					|| size <= 0 || size > CosmeticFormat.MAX_ENVELOPE_BYTES) {
				// (Format 2 darf größer sein – welches Format es ist, zeigt erst der Umschlag)
				return null;
			}
			return new Entry(id, slot, o.get("version").getAsInt(), string(o, "name"), string(o, "description"),
					"team".equals(string(o, "access")), sha256, size, string(o, "date"));
		} catch (RuntimeException e) {
			return null;
		}
	}

	private static String string(JsonObject o, String key) {
		return o.has(key) && o.get(key).isJsonPrimitive() ? o.get(key).getAsString() : "";
	}

	/** Umschlag aus dem Zwischenspeicher oder vom Dienst, vollständig geprüft */
	private static Item fetch(Entry entry, Path dir) throws Exception {
		Path file = dir.resolve(entry.sha256() + ".json");
		byte[] bytes = null;
		if (Files.isRegularFile(file)) {
			byte[] cached = Files.readAllBytes(file);
			if (cached.length == entry.size() && sha256(cached).equals(entry.sha256())) bytes = cached;
			else {
				// beschädigt oder verändert: verwerfen und neu holen
				HeldixClient.LOGGER.warn("Cosmetics: Zwischenspeicher für „{}“ passt nicht zur Prüfsumme, lade neu", entry.id());
				Files.deleteIfExists(file);
			}
		}
		boolean downloaded = false;
		if (bytes == null) {
			bytes = download(entry);
			downloaded = true;
		}
		CosmeticFormat.Manifest manifest = verify(new String(bytes, StandardCharsets.UTF_8));
		if (!manifest.id().equals(entry.id()) || !manifest.slot().equals(entry.slot()) || manifest.version() != entry.version()) {
			throw new CosmeticFormat.InvalidCosmeticException("Das Manifest passt nicht zum Eintrag im Katalog (" + manifest.id() + " " + manifest.version() + ")");
		}
		if (downloaded) {
			Path part = dir.resolve(entry.sha256() + ".part");
			Files.write(part, bytes);
			Files.move(part, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
		}
		NativeImage texture = null;
		NativeImage glow = null;
		// Capes zerlegt Capes.java erst bei Bedarf; Modelle und Partikel sind klein und werden gleich dekodiert
		if (!manifest.slot().equals("cape")) {
			texture = NativeImage.read(manifest.texture());
			if (manifest.glow() != null) {
				try {
					glow = NativeImage.read(manifest.glow());
				} catch (IOException e) {
					texture.close();
					throw e;
				}
			}
		}
		return new Item(entry, manifest, texture, glow);
	}

	private static byte[] download(Entry entry) throws Exception {
		String url = Social.baseUrl() + "/v1/cosmetics/" + URLEncoder.encode(entry.id(), StandardCharsets.UTF_8) + "?v=" + entry.sha256();
		HttpRequest request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30))
				.header("User-Agent", HeldixClient.NAME + "/" + HeldixClient.version).GET().build();
		HttpResponse<InputStream> response = HTTP.send(request, HttpResponse.BodyHandlers.ofInputStream());
		try (InputStream in = response.body()) {
			if (response.statusCode() != 200) throw new IOException("Dienst antwortet mit " + response.statusCode());
			byte[] bytes = in.readNBytes((int) entry.size() + 1);
			if (bytes.length != entry.size()) throw new IOException("Größe stimmt nicht (" + bytes.length + " statt " + entry.size() + " Byte)");
			if (!sha256(bytes).equals(entry.sha256())) throw new IOException("Prüfsumme stimmt nicht");
			return bytes;
		}
	}

	/** Prüft einen Umschlag vollständig (Form, Signatur mit dem Update-Schlüssel, alle Regeln). */
	public static CosmeticFormat.Manifest verify(String envelopeText) throws CosmeticFormat.InvalidCosmeticException {
		PublicKey publicKey;
		try {
			publicKey = publicKey();
		} catch (Exception e) {
			throw new CosmeticFormat.InvalidCosmeticException("Kein Update-Schlüssel in der Mod");
		}
		return CosmeticFormat.verifyEnvelope(envelopeText, publicKey);
	}

	private static synchronized PublicKey publicKey() throws Exception {
		if (key != null) return key;
		try (InputStream in = CosmeticCatalog.class.getResourceAsStream("/heldix-store-key.pem")) {
			if (in == null) throw new IllegalStateException("Kein Store-Schlüssel in der Mod");
			String pem = new String(in.readAllBytes(), StandardCharsets.US_ASCII)
					.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", "");
			key = KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(pem)));
			return key;
		}
	}

	private static String sha256(byte[] bytes) throws Exception {
		return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
	}

	/** Dateien im Zwischenspeicher löschen, die zu keinem aktuellen Eintrag gehören */
	private static void prune(Path dir, List<Entry> entries) {
		java.util.Set<String> keep = new java.util.HashSet<>();
		for (Entry entry : entries) keep.add(entry.sha256() + ".json");
		try (Stream<Path> files = Files.list(dir)) {
			for (Path file : files.toList()) {
				String name = file.getFileName().toString();
				if ((name.endsWith(".json") || name.endsWith(".part")) && !keep.contains(name)) Files.deleteIfExists(file);
			}
		} catch (IOException e) {
			HeldixClient.LOGGER.debug("Cosmetics: Zwischenspeicher nicht aufgeräumt ({})", e.toString());
		}
	}

	private static void discard(Item item) {
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft == null) return;
		minecraft.execute(() -> {
			item.release();
			Capes.forgetCatalog(item);
		});
	}

	/** Nur für Tests: Katalog vergessen (der nächste Tick lädt neu) */
	public static void forgetForTest() {
		Map<String, Item> before = items;
		items = Map.of();
		etag = null;
		loadedAt = 0;
		status = Status.LOADING;
		for (Item item : before.values()) discard(item);
	}
}
