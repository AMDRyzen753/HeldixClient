package dev.heldixclient.cosmetic;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.core.ClientAsset;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.player.PlayerSkin;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Stream;

/**
 * Capes von HeldixClient: eigene, animierte Motive mit leuchtenden Teilen (textures/cape/, erzeugt von
 * launcher/scripts/render-capes.mjs) und eigene Bilder aus dem Ordner heldix-capes der Instanz.
 * Das Leuchten zeichnet {@link dev.heldixclient.transform.Hooks#capeModel} als zweiten, voll hellen Durchgang.
 *
 * <p>Das gewählte Cape ersetzt das Cape im Skin des eigenen Spielers ({@link #forPlayer}); Minecraft zeichnet es dann
 * selbst – mit Wehen beim Laufen und auf Wunsch auch auf der Elytra. Andere Spieler sehen es nicht, dafür bräuchte
 * es einen Server, der die Capes verteilt.
 */
public final class Capes {
	/** Ordner für eigene Cape-Bilder im Spielordner der Instanz */
	public static final String DIRECTORY = "heldix-capes";
	private static final int MAX_CUSTOM = 48;
	private static final int MAX_SIZE = 4096;
	private static final Identifier INDEX = HeldixClient.id("textures/cape/capes.json");

	/**
	 * Ein Cape zur Auswahl. Alle Bilder haben das Seitenverhältnis 2:1 der Minecraft-Vorlage.
	 *
	 * @param frames Bilder der Animation (eins bei unbewegten Capes)
	 * @param glow   leuchtende Teile je Bild (leer = leuchtet nicht)
	 * @param fps    Bilder pro Sekunde der Animation
	 */
	public record Cape(String id, String name, String description, List<Identifier> frames, List<Identifier> glow, int fps, boolean custom) {
		/** erstes Bild (z. B. für unbewegte Vorschauen) */
		public Identifier texture() {
			return frames.getFirst();
		}

		public boolean animated() {
			return frames.size() > 1;
		}

		public boolean glows() {
			return !glow.isEmpty();
		}
	}

	private static List<Cape> builtin;
	private static List<Cape> custom;
	private static int customCounter;
	/** geladene eingebaute Capes (IDs) */
	private static final Set<String> LOADED = new HashSet<>();
	/** gerade im Hintergrund geladen ("front:" + ID für die Kachel-Vorschau) */
	private static final Set<String> LOADING = new HashSet<>();
	private static final Set<String> FAILED = new HashSet<>();
	/**
	 * Fertig gelesene Bilder, die noch hochgeladen werden müssen. Das passiert beim Zeichnen ({@link #pump}),
	 * nicht zwischen zwei Bildern – Uploads mit Mipmaps gehen sonst verloren.
	 */
	private static final java.util.concurrent.ConcurrentLinkedQueue<Runnable> PENDING = new java.util.concurrent.ConcurrentLinkedQueue<>();
	/** einzelne Uploads, verteilt auf mehrere Bilder (nur im Render-Thread benutzt) */
	private record Upload(long bytes, Runnable task) {
	}

	private static final java.util.ArrayDeque<Upload> UPLOADS = new java.util.ArrayDeque<>();
	/** höchstens so viele Bytes pro Zeitfenster (etwa ein Bild bei 60 FPS) hochladen */
	private static final long UPLOAD_BUDGET = 2_500_000L;
	/** eigene Threads zum Lesen der Bilder (Minecrafts Hintergrund-Threads sind beim Weltladen ausgelastet) */
	private static final java.util.concurrent.ExecutorService LOADER = java.util.concurrent.Executors.newFixedThreadPool(2, runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Capes");
		thread.setDaemon(true);
		thread.setPriority(Thread.NORM_PRIORITY - 1);
		return thread;
	});
	private static long uploadWindow;
	private static long uploadedInWindow;
	/** Capes, deren Kachel-Vorschau (nur Außenseite) geladen ist */
	private static final Set<String> PREVIEWS = new HashSet<>();
	/** Bild der Animation → passendes Leuchtbild */
	private static final Map<Identifier, Identifier> GLOW = new HashMap<>();

	/** zuletzt berechneter Skin (getSkin wird mehrmals pro Bild aufgerufen) */
	private static PlayerSkin lastInput;
	private static Cape lastCape;
	private static int lastFrame;
	private static boolean lastElytra;
	private static PlayerSkin lastOutput;

	private Capes() {
	}

	/** Eingebaute Capes aus textures/cape/capes.json (beim ersten Aufruf gelesen) */
	public static List<Cape> builtin() {
		if (builtin != null) return builtin;
		List<Cape> list = new ArrayList<>();
		try (InputStream in = Minecraft.getInstance().getResourceManager().open(INDEX);
				InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
			JsonArray capes = JsonParser.parseReader(reader).getAsJsonObject().getAsJsonArray("capes");
			for (int i = 0; i < capes.size(); i++) {
				JsonObject json = capes.get(i).getAsJsonObject();
				String id = json.get("id").getAsString();
				int count = Math.max(1, json.get("frames").getAsInt());
				boolean glows = json.has("glow") && json.get("glow").getAsBoolean();
				List<Identifier> frames = new ArrayList<>();
				List<Identifier> glow = new ArrayList<>();
				for (int f = 0; f < count; f++) {
					frames.add(HeldixClient.id("cape/" + id + "/" + f));
					if (glows) glow.add(HeldixClient.id("cape/" + id + "/glow_" + f));
				}
				list.add(new Cape(id, json.get("name").getAsString(), json.get("description").getAsString(),
						List.copyOf(frames), List.copyOf(glow), Math.max(1, json.get("fps").getAsInt()), false));
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Heldix-Capes nicht lesbar", e);
		}
		builtin = List.copyOf(list);
		return builtin;
	}

	/** Eigene Capes aus dem Ordner heldix-capes (beim ersten Aufruf eingelesen) */
	public static List<Cape> custom() {
		if (custom == null) custom = scan();
		return custom;
	}

	public static Path directory() {
		return HeldixLoader.gameDir().resolve(DIRECTORY);
	}

	public static Cape byId(String id) {
		if (id == null || id.isEmpty()) return null;
		for (Cape cape : builtin()) if (cape.id().equals(id)) return cape;
		if (id.startsWith("datei:")) {
			for (Cape cape : custom()) if (cape.id().equals(id)) return cape;
		}
		return null;
	}

	/** Gewähltes Cape oder null (kein Heldix-Cape) */
	public static Cape selected() {
		return byId(HeldixConfig.get().cape);
	}

	public static void select(Cape cape) {
		HeldixConfig.get().cape = cape == null ? "" : cape.id();
		HeldixConfig.save();
		dev.heldixclient.social.Social.profileChanged();
	}

	// ======================================================================================
	// Bilder und Animation
	// ======================================================================================

	/** Nummer des Bildes, das gerade gezeigt wird (läuft für alle Capes im selben Takt) */
	public static int frame(Cape cape) {
		if (!cape.animated() || !HeldixConfig.get().capeAnimation) return 0;
		return (int) ((System.currentTimeMillis() * cape.fps() / 1000) % cape.frames().size());
	}

	/** Leuchtbild zum gerade gezeichneten Cape-Bild (null = leuchtet nicht oder ausgeschaltet) */
	public static Identifier glowFor(Identifier capeTexture) {
		if (capeTexture == null || !HeldixConfig.get().capeGlow) return null;
		return GLOW.get(capeTexture);
	}

	/** Bilder eines eingebauten Capes, im Hintergrund gelesen und zerlegt */
	private record Decoded(List<NativeImage> frames, List<NativeImage> glow) {
	}

	/**
	 * true, wenn die Bilder des Capes bereit sind. Sonst wird das Laden im Hintergrund angestoßen (Lesen und Zerlegen
	 * der Bildstreifen dauert etwas; das Spiel soll dabei nicht stocken), und das Cape erscheint kurz danach.
	 */
	/**
	 * Fertig gelesene Cape-Bilder hochladen (im Render-Thread). Höchstens wenige Bilder pro Bild-Zeitfenster: Zu viele
	 * Uploads auf einmal überlaufen den Zwischenspeicher der Grafikkarte, dann landen falsche Daten in den Texturen.
	 */
	public static void pump() {
		Runnable task;
		while ((task = PENDING.poll()) != null) task.run();
		long window = System.nanoTime() / 16_000_000L;
		if (window != uploadWindow) {
			uploadWindow = window;
			uploadedInWindow = 0;
		}
		while (!UPLOADS.isEmpty() && (uploadedInWindow == 0 || uploadedInWindow + UPLOADS.peek().bytes() <= UPLOAD_BUDGET)) {
			Upload upload = UPLOADS.poll();
			upload.task().run();
			uploadedInWindow += Math.max(1, upload.bytes());
		}
	}

	private static boolean ensureLoaded(Cape cape) {
		pump();
		if (cape.custom() || LOADED.contains(cape.id())) return true;
		if (FAILED.contains(cape.id()) || !LOADING.add(cape.id())) return false;
		CompletableFuture.supplyAsync(() -> decode(cape), LOADER)
				.whenCompleteAsync((decoded, error) -> {
					if (error != null || decoded == null) {
						LOADING.remove(cape.id());
						FAILED.add(cape.id());
						HeldixClient.LOGGER.warn("Cape {} nicht ladbar", cape.id(), error);
						return;
					}
					for (int i = 0; i < cape.frames().size(); i++) {
						Identifier id = cape.frames().get(i);
						NativeImage image = decoded.frames().get(i);
						UPLOADS.add(new Upload(bytes(image) * 4 / 3, () -> Ui.registerMipmapped(id, image)));
					}
					for (int i = 0; i < decoded.glow().size(); i++) {
						Identifier id = cape.glow().get(i);
						Identifier frame = cape.frames().get(i);
						NativeImage image = decoded.glow().get(i);
						UPLOADS.add(new Upload(bytes(image) * 4 / 3, () -> {
							Ui.registerMipmapped(id, image);
							GLOW.put(frame, id);
						}));
					}
					// erst wenn alles hochgeladen ist, gilt das Cape als geladen (bis dahin kein zweites Laden starten)
					UPLOADS.add(new Upload(0, () -> {
						LOADING.remove(cape.id());
						LOADED.add(cape.id());
						lastInput = null;
					}));
				}, PENDING::add);
		return false;
	}

	private static long bytes(NativeImage image) {
		return (long) image.getWidth() * image.getHeight() * 4;
	}

	private static Decoded decode(Cape cape) {
		List<NativeImage> frames = split(HeldixClient.id("textures/cape/" + cape.id() + ".png"), cape.frames().size(), 2);
		List<NativeImage> glow = cape.glows() ? split(HeldixClient.id("textures/cape/" + cape.id() + "_glow.png"), cape.glow().size(), 2) : List.of();
		return new Decoded(frames, glow);
	}

	/** Bildstreifen in count Bilder zerlegen; aspect = Breite / Höhe eines Bildes */
	private static List<NativeImage> split(Identifier resource, int count, int aspect) {
		try (InputStream in = Minecraft.getInstance().getResourceManager().open(resource); NativeImage strip = NativeImage.read(in)) {
			int w = strip.getWidth();
			int h = w / aspect;
			int available = Math.max(1, strip.getHeight() / h);
			List<NativeImage> frames = new ArrayList<>();
			for (int i = 0; i < count; i++) {
				NativeImage frame = new NativeImage(w, h, false);
				int y = Math.min(i, available - 1) * h;
				// copyRect(Ziel, Quelle x, Quelle y, Ziel x, Ziel y, Breite, Höhe, …)
				strip.copyRect(frame, 0, y, 0, 0, w, h, false, false);
				frames.add(frame);
			}
			return frames;
		} catch (Exception e) {
			throw new IllegalStateException("Cape-Grafik " + resource + " nicht ladbar", e);
		}
	}

	/** Außenseite eines eingebauten Capes für die Kacheln im Menü (null, solange sie noch geladen wird) */
	private static Identifier preview(Cape cape) {
		pump();
		if (PREVIEWS.contains(cape.id())) return HeldixClient.id("cape/" + cape.id() + "/front_" + frame(cape));
		if (FAILED.contains(cape.id()) || !LOADING.add("front:" + cape.id())) return null;
		CompletableFuture.supplyAsync(() -> {
			List<NativeImage> frames = split(HeldixClient.id("textures/cape/" + cape.id() + ".png"), cape.frames().size(), 2);
			List<NativeImage> fronts = new ArrayList<>();
			for (NativeImage frame : frames) {
				int s = frame.getWidth() / 64;
				NativeImage front = new NativeImage(10 * s, 16 * s, false);
				frame.copyRect(front, s, s, 0, 0, 10 * s, 16 * s, false, false);
				frame.close();
				fronts.add(front);
			}
			return fronts;
		}, LOADER).whenCompleteAsync((fronts, error) -> {
			if (error != null || fronts == null) {
				LOADING.remove("front:" + cape.id());
				FAILED.add(cape.id());
				return;
			}
			for (int i = 0; i < fronts.size(); i++) {
				Identifier id = HeldixClient.id("cape/" + cape.id() + "/front_" + i);
				NativeImage image = fronts.get(i);
				UPLOADS.add(new Upload(bytes(image), () -> Ui.registerLinear(id, image)));
			}
			UPLOADS.add(new Upload(0, () -> {
				LOADING.remove("front:" + cape.id());
				PREVIEWS.add(cape.id());
			}));
		}, PENDING::add);
		return null;
	}

	/** Bilder aller eingebauten Capes außer dem gewählten freigeben (nach dem Verlassen der Cape-Auswahl) */
	public static void trim() {
		Cape keep = selected();
		for (Cape cape : builtin()) {
			if (PREVIEWS.remove(cape.id())) {
				for (int i = 0; i < cape.frames().size(); i++) Minecraft.getInstance().getTextureManager().release(HeldixClient.id("cape/" + cape.id() + "/front_" + i));
			}
			if (cape == keep || !LOADED.remove(cape.id())) continue;
			for (Identifier id : cape.frames()) {
				Minecraft.getInstance().getTextureManager().release(id);
				GLOW.remove(id);
			}
			for (Identifier id : cape.glow()) Minecraft.getInstance().getTextureManager().release(id);
		}
		lastInput = null;
	}

	// ======================================================================================
	// Skin des eigenen Spielers
	// ======================================================================================

	/**
	 * Aufgerufen für jeden Spieler (AbstractClientPlayer.getSkin): der eigene bekommt das gewählte Heldix-Cape,
	 * andere HeldixClient-Spieler ihr Heldix-Cape (über den Heldix-Dienst).
	 */
	public static PlayerSkin forPlayer(PlayerSkin skin, AbstractClientPlayer player) {
		if (skin == null || player == null) return skin;
		UUID own = Minecraft.getInstance().getGameProfile().id();
		if (own != null && own.equals(player.getUUID())) return apply(skin, selected());
		String capeId = dev.heldixclient.social.Social.capeOf(player.getUUID());
		Cape cape = capeId == null ? null : byId(capeId);
		if (cape == null || cape.custom()) return skin;
		return applyOther(player.getUUID(), skin, cape);
	}

	/** Zwischenspeicher je fremdem Spieler, damit nicht jedes Bild ein neuer Skin entsteht */
	private record Applied(PlayerSkin input, Cape cape, int frame, boolean elytra, PlayerSkin output) {
	}

	private static final Map<UUID, Applied> OTHERS = new java.util.concurrent.ConcurrentHashMap<>();

	private static PlayerSkin applyOther(UUID uuid, PlayerSkin skin, Cape cape) {
		boolean elytra = HeldixConfig.get().capeElytra;
		int frame = frame(cape);
		Applied cached = OTHERS.get(uuid);
		if (cached != null && cached.input() == skin && cached.cape() == cape && cached.frame() == frame && cached.elytra() == elytra) return cached.output();
		if (!RenderSystem.isOnRenderThread() || !ensureLoaded(cape)) return skin;
		Identifier id = cape.frames().get(frame);
		ClientAsset.Texture texture = new ClientAsset.ResourceTexture(id, id);
		PlayerSkin result = new PlayerSkin(skin.body(), texture, elytra ? texture : skin.elytra(), skin.model(), skin.secure());
		if (OTHERS.size() > 256) OTHERS.clear();
		OTHERS.put(uuid, new Applied(skin, cape, frame, elytra, result));
		return result;
	}

	/** Skin mit dem angegebenen Cape im aktuellen Bild der Animation (null oder noch nicht geladen = unverändert) */
	public static PlayerSkin apply(PlayerSkin skin, Cape cape) {
		if (skin == null || cape == null) return skin;
		boolean elytra = HeldixConfig.get().capeElytra;
		int frame = frame(cape);
		if (skin == lastInput && cape == lastCape && frame == lastFrame && elytra == lastElytra) return lastOutput;
		if (!RenderSystem.isOnRenderThread() || !ensureLoaded(cape)) return skin;
		Identifier id = cape.frames().get(frame);
		ClientAsset.Texture texture = new ClientAsset.ResourceTexture(id, id);
		PlayerSkin result = new PlayerSkin(skin.body(), texture, elytra ? texture : skin.elytra(), skin.model(), skin.secure());
		lastInput = skin;
		lastCape = cape;
		lastFrame = frame;
		lastElytra = elytra;
		lastOutput = result;
		return result;
	}

	// ======================================================================================
	// Eigene Capes
	// ======================================================================================

	/** Ordner neu einlesen (z. B. nach dem Hinzufügen von Bildern) */
	public static void reloadCustom() {
		if (custom != null) {
			for (Cape cape : custom) Minecraft.getInstance().getTextureManager().release(cape.texture());
		}
		custom = null;
		lastInput = null;
	}

	/**
	 * Kopiert Bilder (z. B. per Drag & Drop) in den Cape-Ordner.
	 *
	 * @return das erste neue Cape oder null, wenn keine PNG-Datei dabei war
	 */
	public static Cape importFiles(List<Path> files) {
		Path dir = directory();
		String first = null;
		try {
			Files.createDirectories(dir);
			for (Path file : files) {
				String name = file.getFileName().toString();
				if (!name.toLowerCase(Locale.ROOT).endsWith(".png") || !Files.isRegularFile(file)) continue;
				Path target = dir.resolve(name);
				for (int i = 2; Files.exists(target) && !Files.isSameFile(target, file); i++) {
					target = dir.resolve(name.substring(0, name.length() - 4) + "-" + i + ".png");
				}
				if (!Files.exists(target)) Files.copy(file, target, StandardCopyOption.COPY_ATTRIBUTES);
				if (first == null) first = target.getFileName().toString();
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Cape-Bilder konnten nicht kopiert werden", e);
		}
		reloadCustom();
		return first == null ? null : byId("datei:" + first);
	}

	private static List<Cape> scan() {
		List<Cape> list = new ArrayList<>();
		Path dir = directory();
		try {
			Files.createDirectories(dir);
			List<Path> files;
			try (Stream<Path> stream = Files.list(dir)) {
				files = stream.filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".png"))
						.sorted().limit(MAX_CUSTOM).toList();
			}
			for (Path file : files) {
				Cape cape = load(file);
				if (cape != null) list.add(cape);
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Cape-Ordner {} nicht lesbar", dir, e);
		}
		return List.copyOf(list);
	}

	private static Cape load(Path file) {
		String fileName = file.getFileName().toString();
		String base = fileName.substring(0, fileName.length() - 4);
		try (InputStream in = Files.newInputStream(file)) {
			NativeImage source = NativeImage.read(in);
			int w = source.getWidth();
			int h = source.getHeight();
			if (w > MAX_SIZE || h > MAX_SIZE || w < 8 || h < 8) {
				source.close();
				HeldixClient.LOGGER.warn("Cape-Bild {} übersprungen: {}×{} Pixel", fileName, w, h);
				return null;
			}
			String description;
			NativeImage image;
			if (w == 2 * h && w >= 64) {
				image = source;
				description = "Cape-Vorlage " + w + " × " + h;
			} else if (w * 22 == h * 46) {
				// Vorlage ohne Rand (46 × 22, z. B. von OptiFine): auf 64 × 32 erweitern
				image = expand(source);
				source.close();
				description = "Cape-Vorlage " + w + " × " + h;
			} else {
				image = fromPicture(source);
				source.close();
				description = "Bild " + w + " × " + h + ", auf das Cape gelegt";
			}
			Identifier id = HeldixClient.id("cape/custom/" + (++customCounter));
			Ui.registerMipmapped(id, image);
			return new Cape("datei:" + fileName, base.replace('_', ' '), description, List.of(id), List.of(), 1, true);
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Cape-Bild {} nicht ladbar: {}", fileName, e.toString());
			return null;
		}
	}

	private static NativeImage expand(NativeImage source) {
		int w = source.getWidth() * 64 / 46;
		int h = source.getHeight() * 32 / 22;
		NativeImage image = new NativeImage(w, h, true);
		for (int y = 0; y < source.getHeight(); y++) {
			for (int x = 0; x < source.getWidth(); x++) image.setPixel(x, y, source.getPixel(x, y));
		}
		return image;
	}

	/**
	 * Beliebiges Bild als Cape: auf der Außenseite (zugeschnitten, mittig) und auf beiden Elytra-Flügeln,
	 * Ränder und Innenseite in einer dunklen Farbe aus dem Bild. Ausgabe 256 × 128 (vierfache Vorlage).
	 */
	private static NativeImage fromPicture(NativeImage source) {
		int s = 4;
		NativeImage image = new NativeImage(64 * s, 32 * s, true);
		int average = average(source);
		int edge = shade(average, 0.55f);
		int lining = shade(average, 0.28f);
		fill(image, 0, 0, 22 * s, 17 * s, edge);
		fill(image, 12 * s, s, 10 * s, 16 * s, lining);
		fill(image, 22 * s, 0, 24 * s, 22 * s, edge);
		cover(source, image, s, s, 10 * s, 16 * s);
		cover(source, image, 24 * s, 2 * s, 10 * s, 20 * s);
		cover(source, image, 36 * s, 2 * s, 10 * s, 20 * s);
		return image;
	}

	/** Bild zugeschnitten (wie CSS "cover") in das Rechteck zeichnen, mit 3×3-Abtastung je Pixel */
	private static void cover(NativeImage source, NativeImage target, int tx, int ty, int tw, int th) {
		float sw = source.getWidth();
		float sh = source.getHeight();
		float scale = Math.max(tw / sw, th / sh);
		float ox = (sw - tw / scale) / 2f;
		float oy = (sh - th / scale) / 2f;
		for (int y = 0; y < th; y++) {
			for (int x = 0; x < tw; x++) {
				float r = 0;
				float g = 0;
				float b = 0;
				for (int sy = 0; sy < 3; sy++) {
					for (int sx = 0; sx < 3; sx++) {
						int px = Math.clamp((int) (ox + (x + (sx + 0.5f) / 3f) / scale), 0, (int) sw - 1);
						int py = Math.clamp((int) (oy + (y + (sy + 0.5f) / 3f) / scale), 0, (int) sh - 1);
						int argb = over(source.getPixel(px, py), target.getPixel(tx + x, ty + y));
						r += (argb >> 16) & 0xFF;
						g += (argb >> 8) & 0xFF;
						b += argb & 0xFF;
					}
				}
				target.setPixel(tx + x, ty + y, 0xFF000000 | Math.round(r / 9) << 16 | Math.round(g / 9) << 8 | Math.round(b / 9));
			}
		}
	}

	/** Bildpixel über den Hintergrund legen (Cape-Flächen sind deckend) */
	private static int over(int argb, int background) {
		float a = ((argb >>> 24) & 0xFF) / 255f;
		int r = Math.round(((argb >> 16) & 0xFF) * a + ((background >> 16) & 0xFF) * (1 - a));
		int g = Math.round(((argb >> 8) & 0xFF) * a + ((background >> 8) & 0xFF) * (1 - a));
		int b = Math.round((argb & 0xFF) * a + (background & 0xFF) * (1 - a));
		return 0xFF000000 | r << 16 | g << 8 | b;
	}

	private static int average(NativeImage image) {
		long r = 0;
		long g = 0;
		long b = 0;
		long n = 0;
		int stepX = Math.max(1, image.getWidth() / 32);
		int stepY = Math.max(1, image.getHeight() / 32);
		for (int y = 0; y < image.getHeight(); y += stepY) {
			for (int x = 0; x < image.getWidth(); x += stepX) {
				int argb = image.getPixel(x, y);
				if ((argb >>> 24) < 32) continue;
				r += (argb >> 16) & 0xFF;
				g += (argb >> 8) & 0xFF;
				b += argb & 0xFF;
				n++;
			}
		}
		if (n == 0) return 0xFF1E293B;
		return 0xFF000000 | (int) (r / n) << 16 | (int) (g / n) << 8 | (int) (b / n);
	}

	private static int shade(int argb, float factor) {
		int r = Math.round(((argb >> 16) & 0xFF) * factor);
		int g = Math.round(((argb >> 8) & 0xFF) * factor);
		int b = Math.round((argb & 0xFF) * factor);
		return 0xFF000000 | r << 16 | g << 8 | b;
	}

	private static void fill(NativeImage image, int x, int y, int w, int h, int argb) {
		for (int py = y; py < y + h; py++) {
			for (int px = x; px < x + w; px++) image.setPixel(px, py, argb);
		}
	}

	// ======================================================================================
	// Zeichnen in Menüs
	// ======================================================================================

	/** Außenseite des Capes (Fläche 10 × 16 der Vorlage), z. B. für die Auswahl-Kacheln */
	public static void drawFront(GuiGraphicsExtractor g, Cape cape, float x, float y, float w, float h, float alpha) {
		if (cape.custom()) {
			Ui.region(g, cape.texture(), x, y, w, h, 1, 1, 10, 16, 64, 32, alpha);
			return;
		}
		Identifier front = preview(cape);
		if (front == null) {
			Ui.rect(g, x, y, w, h, 0, Ui.withAlpha(Ui.SURFACE_STRONG, alpha));
			return;
		}
		Ui.region(g, front, x, y, w, h, 0, 0, 10, 16, 10, 16, alpha);
	}

	/**
	 * Spielerfigur von hinten (leicht pendelnd) mit dem angegebenen Cape – funktioniert auch im Hauptmenü ohne Welt.
	 *
	 * @param cape null = ohne Heldix-Cape (ein Cape des Minecraft-Kontos bleibt sichtbar)
	 */
	public static void drawPlayer(GuiGraphicsExtractor g, PlayerSkin baseSkin, Cape cape, int x0, int y0, int x1, int y1, float seconds) {
		// von hinten, langsam hin und her gedreht, damit man das Cape auch etwas von der Seite sieht
		drawFigure(g, baseSkin, cape, x0, y0, x1, y1, seconds, (float) Math.sin(seconds * 0.7) * 32f);
	}

	/**
	 * Spielerfigur, die sich langsam um sich selbst dreht (Gesicht, Seite, Cape …) – für Hauptmenü und Übersicht.
	 *
	 * @param cape null = ohne Heldix-Cape (ein Cape des Minecraft-Kontos bleibt sichtbar)
	 */
	public static void drawShowcase(GuiGraphicsExtractor g, PlayerSkin baseSkin, Cape cape, int x0, int y0, int x1, int y1, float seconds) {
		drawFigure(g, baseSkin, cape, x0, y0, x1, y1, seconds, 180f + seconds * 24f % 360f);
	}

	private static void drawFigure(GuiGraphicsExtractor g, PlayerSkin baseSkin, Cape cape, int x0, int y0, int x1, int y1, float seconds, float bodyRot) {
		PlayerSkin skin = cape == null ? baseSkin : apply(baseSkin, cape);
		AvatarRenderState state = new AvatarRenderState();
		state.entityType = EntityTypes.PLAYER;
		state.skin = skin;
		state.showHat = true;
		state.showJacket = true;
		state.showLeftPants = true;
		state.showRightPants = true;
		state.showLeftSleeve = true;
		state.showRightSleeve = true;
		state.showCape = true;
		state.lightCoords = 0xF000F0;
		state.boundingBoxWidth = 0.6f;
		state.boundingBoxHeight = 1.8f;
		state.eyeHeight = 1.62f;
		state.pose = Pose.STANDING;
		state.ageInTicks = seconds * 20f;
		state.bodyRot = bodyRot;
		state.yRot = 0;
		state.xRot = 0;
		// das Cape weht leicht
		state.capeFlap = 3f + (float) Math.sin(seconds * 1.9) * 3f;
		state.capeLean = 22f + (float) Math.sin(seconds * 1.1) * 10f;
		state.capeLean2 = (float) Math.sin(seconds * 0.8) * 6f;

		int size = Math.round((y1 - y0) / 2.25f);
		Quaternionf camera = new Quaternionf().rotateX((float) Math.toRadians(-8));
		Quaternionf rotation = new Quaternionf().rotateZ((float) Math.PI).mul(camera);
		Vector3f translation = new Vector3f(0f, state.boundingBoxHeight / 2f + 0.0625f, 0f);
		g.entity(state, size, translation, rotation, camera, x0, y0, x1, y1);
	}
}
