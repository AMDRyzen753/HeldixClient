package dev.heldixclient.addons.minimap;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixColors;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudImage;
import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.HudStyle;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.api.WaypointInfo;
import dev.heldixclient.api.WorldMap;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;

/**
 * Minimap für HeldixClient (Heldix-API 8): Die Oberfläche um den Spieler kommt chunkweise aus {@link WorldMap} (im Tick,
 * mit Budget, ältere Chunks werden nach und nach neu gelesen), daraus entsteht ein Fenster aus schattierten Farben um den
 * Spieler. Jedes Bild tastet dieses Fenster gedreht und gezoomt ab, schneidet es rund oder eckig zu und zeichnet es als
 * {@link HudImage}; darüber Rand, Himmelsrichtungen, Wegpunkte und der Pfeil des Spielers.
 *
 * <p>Fair Play: Auf Servern nur die Oberfläche. Höhlenansicht und Nether gibt es nur in Einzelspieler-Welten (das
 * erzwingt auch die API). Keine Spieler, keine Mobs.
 *
 * <p>Ab 1.1.0 (Heldix-API 11): Server mit dem Plugin „HeldixClient Server“ können die Minimap (Regel „minimap“), die
 * Wegpunkte auf der Karte („waypoints“) und die Koordinaten darunter („coordinates“) abschalten. Die Minimap folgt der
 * Regel über {@code followServerRule} – HeldixClient blendet sie dann aus und zeigt „Auf diesem Server deaktiviert“.
 */
public final class MinimapAddon implements HeldixAddon {
	private static final int[] SIZES = {72, 96, 128};
	private static final double MIN_VIEW = 16;
	private static final double MAX_VIEW = 512;
	private static final int UNLOADED = 0xFF141A26;
	private static final int OUTLINE = 0xFF0B0F17;
	private static final int NORTH = 0xFFF87171;
	/** Oberfläche (sonst: Höhe, ab der nach unten gesucht wird) */
	private static final int SURFACE = Integer.MAX_VALUE;
	/** keine Karte (Nether auf einem Server) */
	private static final int NO_MAP = Integer.MIN_VALUE;
	/** neue bzw. aufzufrischende Chunks je Tick */
	private static final int NEW_PER_TICK = 12;
	private static final int REFRESH_PER_TICK = 4;
	private static final int MAX_IMAGE = 256;

	private HeldixApi api;
	private WorldMap world;
	private ModuleHandle module;
	private IntSupplier shape;
	private IntSupplier size;
	private IntSupplier colorMode;
	private BooleanSupplier rotate;
	private BooleanSupplier relief;
	private BooleanSupplier showWaypoints;
	private BooleanSupplier compass;
	private BooleanSupplier coordinates;
	private BooleanSupplier caves;
	private DoubleSupplier viewSetting;
	private double zoom;
	private double lastSetting = Double.NaN;

	// Chunks: Farben, Höhen und Wasser von oben
	private final Map<Long, Tile> tiles = new HashMap<>();
	private String tileDimension = "";
	private int tileMode = -1;
	private int layer = SURFACE;

	// Fenster: schattierte Farben um den Spieler (im Tick gebaut)
	private int[] window = new int[0];
	private int windowSize;
	private int windowMinX;
	private int windowMinZ;
	private boolean windowDirty = true;
	private int windowVersion;

	// Bild
	private HudImage image;
	private int[] pixels = new int[0];
	private float[] mask = new float[0];
	private int maskSize;
	private int maskShape = -1;
	private String drawnKey = "";
	private int frames;

	private static final class Tile {
		final int[] colors = new int[256];
		final int[] heights = new int[256];
		final int[] water = new int[256];
		long sampledAt;
		int layer;
		int loaded;
	}

	@Override
	public void onEnable(HeldixApi api) {
		this.api = api;
		this.world = api.worldMap();
		module = api.registerHudModule(ModuleSpec.of("minimap", "Minimap", "Karte deiner Umgebung").at(9999, 4).withIcon("map"), new Hud());
		// API 11: auf Servern mit der Regel „minimap“ (Plugin „HeldixClient Server“) blendet HeldixClient die Karte aus
		module.followServerRule("minimap");
		shape = module.addStyleChoice("shape", "Form", List.of("Rund", "Eckig"), 0);
		size = module.addStyleChoice("size", "Größe", List.of("Klein", "Mittel", "Groß"), 1);
		rotate = module.addStyleToggle("rotate", "Karte dreht sich mit", true);
		compass = module.addStyleToggle("compass", "Himmelsrichtungen", true);
		coordinates = module.addStyleToggle("coordinates", "Koordinaten darunter", true);
		viewSetting = module.addSlider("view", "Sichtweite", "Wie viele Blöcke die Karte von Rand zu Rand zeigt (mit Plus und Minus auf dem Ziffernblock zoomst du im Spiel)",
				32, 256, 16, 96, value -> Math.round(value) + " Blöcke");
		colorMode = module.addChoice("colors", "Farben", "Texturen: wie die Welt aussieht (auch mit Ressourcenpaketen) · Kartenfarben: wie die Karten in Minecraft",
				List.of("Texturen", "Kartenfarben"), 0);
		relief = module.addToggle("relief", "Höhen schattieren", "Hänge und Klippen werden heller oder dunkler", true);
		showWaypoints = module.addToggle("waypoints", "Wegpunkte zeigen", "Deine Wegpunkte und dein Todespunkt (liegen sie außerhalb, zeigt ein Punkt am Rand die Richtung)", true);
		caves = module.addToggle("caves", "Höhlenansicht", "Unter Tage und im Nether zeigt die Karte deine Ebene – nur in Einzelspieler-Welten (Fair Play)", true);
		module.addKey("zoom-in", "Hereinzoomen", "Weniger Blöcke, mehr Einzelheiten", HeldixKeys.NUMPAD_ADD, () -> zoomBy(1 / 1.5));
		module.addKey("zoom-out", "Herauszoomen", "Mehr Blöcke, weiter Überblick", HeldixKeys.NUMPAD_SUBTRACT, () -> zoomBy(1.5));

		zoom = parse(api.config().get("zoom", ""), Double.NaN);
		api.events().onTick(this::tick);
	}

	@Override
	public void onDisable() {
		tiles.clear();
		if (image != null) image.close();
		image = null;
	}

	private static double parse(String text, double fallback) {
		try {
			return text.isBlank() ? fallback : Double.parseDouble(text);
		} catch (NumberFormatException e) {
			return fallback;
		}
	}

	// ======================================================================================
	// Zoom
	// ======================================================================================

	/** Sichtweite in Blöcken (Regler, mit den Tasten verändert; den Regler bewegen setzt zurück) */
	double viewBlocks() {
		double setting = viewSetting.getAsDouble();
		if (setting != lastSetting) {
			if (!Double.isNaN(lastSetting) || Double.isNaN(zoom)) zoom = setting;
			lastSetting = setting;
		}
		return Math.clamp(zoom, MIN_VIEW, MAX_VIEW);
	}

	private void zoomBy(double factor) {
		if (!module.isEnabled()) return;
		zoom = Math.clamp(viewBlocks() * factor, MIN_VIEW, MAX_VIEW);
		zoom = Math.round(zoom / 4) * 4.0;
		api.config().set("zoom", Double.toString(zoom));
		api.config().save();
		windowDirty = true;
		api.notify("Minimap", Math.round(zoom) + " Blöcke");
	}

	// ======================================================================================
	// Jeder Tick: Chunks lesen, Fenster bauen
	// ======================================================================================

	private void tick() {
		if (!module.isEnabled() || !world.available() || !api.server().allowed("minimap")) {
			if (!tiles.isEmpty()) clearTiles();
			return;
		}
		WorldMap.View view = world.view();
		if (view == null) return;
		int mode = colorMode.getAsInt();
		String dimension = world.dimension();
		int wanted = layerFor(view);
		boolean surfaceSwitch = (wanted == SURFACE) != (layer == SURFACE) || (wanted == NO_MAP) != (layer == NO_MAP);
		if (!dimension.equals(tileDimension) || mode != tileMode || surfaceSwitch) {
			clearTiles();
			tileDimension = dimension;
			tileMode = mode;
		}
		layer = wanted;
		if (layer == NO_MAP) return;

		double viewBlocks = viewBlocks();
		int playerChunkX = (int) Math.floor(view.x()) >> 4;
		int playerChunkZ = (int) Math.floor(view.z()) >> 4;
		int radius = (int) Math.ceil(viewBlocks * 0.75 / 16) + 1;
		long now = System.currentTimeMillis();
		int fresh = NEW_PER_TICK;
		int refresh = REFRESH_PER_TICK;
		boolean changed = false;
		for (int r = 0; r <= radius && (fresh > 0 || refresh > 0); r++) {
			for (int dz = -r; dz <= r; dz++) {
				for (int dx = -r; dx <= r; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) != r) continue;
					int cx = playerChunkX + dx;
					int cz = playerChunkZ + dz;
					Tile tile = tiles.get(key(cx, cz));
					if (tile == null) {
						if (fresh <= 0) continue;
						fresh--;
						sample(cx, cz, mode, now);
						changed = true;
					} else if (refresh > 0 && stale(tile, r, now)) {
						refresh--;
						sample(cx, cz, mode, now);
						changed = true;
					}
				}
			}
		}
		// weit entfernte Chunks vergessen
		Iterator<Map.Entry<Long, Tile>> it = tiles.entrySet().iterator();
		while (it.hasNext()) {
			long k = it.next().getKey();
			int cx = (int) (k >> 32);
			int cz = (int) k;
			if (Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ)) > radius + 3) it.remove();
		}
		if (changed) windowDirty = true;
		buildWindow(view, viewBlocks);
	}

	/** Oberfläche, Höhe für die Höhlenansicht oder gar keine Karte */
	private int layerFor(WorldMap.View view) {
		boolean underground = caves.getAsBoolean() && world.undergroundAllowed();
		int head = (int) Math.floor(view.y()) + 1;
		if (world.hasCeiling()) return underground ? head + 1 : NO_MAP;
		if (!underground) return SURFACE;
		int surface = world.surfaceY((int) Math.floor(view.x()), (int) Math.floor(view.z()));
		// deutlich unter der Oberfläche: Höhle (auf 4 Blöcke gerundet, damit nicht jeder Schritt alles neu liest)
		if (surface != Integer.MIN_VALUE && head < surface - 4) return Math.floorDiv(head, 4) * 4 + 3;
		return SURFACE;
	}

	private boolean stale(Tile tile, int ring, long now) {
		if (tile.layer != layer) return true;
		long age = now - tile.sampledAt;
		if (tile.loaded < 256) return age > 1000;
		return age > (ring <= 2 ? 2000 : 8000);
	}

	private void sample(int cx, int cz, int mode, long now) {
		Tile tile = tiles.computeIfAbsent(key(cx, cz), k -> new Tile());
		WorldMap.Colors colors = mode == 1 ? WorldMap.Colors.MAP : WorldMap.Colors.TEXTURE;
		tile.loaded = layer == SURFACE
				? world.sampleSurface(cx << 4, cz << 4, 16, 16, colors, tile.colors, tile.heights, tile.water)
				: world.sampleBelow(cx << 4, cz << 4, 16, 16, layer, colors, tile.colors, tile.heights, tile.water);
		tile.layer = layer;
		tile.sampledAt = now;
	}

	private void clearTiles() {
		tiles.clear();
		windowDirty = true;
	}

	private static long key(int cx, int cz) {
		return (long) cx << 32 | (cz & 0xFFFFFFFFL);
	}

	/** Schattierte Farben für alle Blöcke, die das Bild gerade brauchen kann (auch gedreht) */
	private void buildWindow(WorldMap.View view, double viewBlocks) {
		int size = (int) Math.ceil(viewBlocks * 1.45) + 4;
		int minX = (int) Math.floor(view.x()) - size / 2;
		int minZ = (int) Math.floor(view.z()) - size / 2;
		if (!windowDirty && size == windowSize && minX == windowMinX && minZ == windowMinZ) return;
		int[] heights = new int[size * size];
		int[] colors = new int[size * size];
		int[] water = new int[size * size];
		for (int z = 0; z < size; z++) {
			int wz = minZ + z;
			Tile tile = null;
			int tileX = Integer.MIN_VALUE;
			for (int x = 0; x < size; x++) {
				int wx = minX + x;
				if (wx >> 4 != tileX) {
					tileX = wx >> 4;
					tile = tiles.get(key(tileX, wz >> 4));
				}
				int i = z * size + x;
				if (tile == null) {
					colors[i] = 0;
					heights[i] = Integer.MIN_VALUE;
					continue;
				}
				int j = (wz & 15) * 16 + (wx & 15);
				colors[i] = tile.colors[j];
				heights[i] = tile.heights[j];
				water[i] = tile.water[j];
			}
		}
		boolean shade = relief.getAsBoolean();
		int[] result = new int[size * size];
		for (int z = 0; z < size; z++) {
			for (int x = 0; x < size; x++) {
				int i = z * size + x;
				int color = colors[i];
				if (color == 0) {
					result[i] = UNLOADED;
					continue;
				}
				float factor = 1f;
				int h = heights[i];
				if (water[i] > 0) {
					factor = Math.clamp(1.05f - water[i] * 0.035f, 0.6f, 1f);
				} else if (shade && x > 0 && z > 0) {
					// Licht von Nordwesten
					int north = heights[i - size - 1];
					if (north != Integer.MIN_VALUE) factor = Math.clamp(1f + (h - north) * 0.08f, 0.7f, 1.25f);
				}
				if (layer != SURFACE && h != Integer.MIN_VALUE) factor *= Math.clamp(1f - (layer - h) * 0.03f, 0.55f, 1f);
				result[i] = scale(color, factor);
			}
		}
		window = result;
		windowSize = size;
		windowMinX = minX;
		windowMinZ = minZ;
		windowDirty = false;
		windowVersion++;
	}

	private static int scale(int argb, float factor) {
		int r = Math.min(255, Math.round(((argb >> 16) & 0xFF) * factor));
		int g = Math.min(255, Math.round(((argb >> 8) & 0xFF) * factor));
		int b = Math.min(255, Math.round((argb & 0xFF) * factor));
		return 0xFF000000 | r << 16 | g << 8 | b;
	}

	// ======================================================================================
	// HUD
	// ======================================================================================

	private final class Hud implements HudRenderer {
		@Override
		public void render(HudCanvas canvas) {
			HudStyle style = canvas.style();
			int size = SIZES[Math.clamp(MinimapAddon.this.size.getAsInt(), 0, SIZES.length - 1)];
			boolean round = shape.getAsInt() == 0;
			WorldMap.View view = world.view();
			if (view == null || !module.isEnabled() && !canvas.isPreview()) {
				placeholder(canvas, style, size, round, "Minimap");
				return;
			}
			if (layer == NO_MAP) {
				placeholder(canvas, style, size, round, "Im Nether nur im Einzelspieler");
				coordinates(canvas, style, size, view);
				return;
			}
			double viewBlocks = viewBlocks();
			int resolution = Math.clamp(Math.round(size * canvas.pixelScale()), 48, MAX_IMAGE);
			ensureImage(resolution, round);
			boolean turn = rotate.getAsBoolean();
			// Blick: vorne (f) und rechts (r) in Weltkoordinaten; ohne Drehen ist Norden oben
			double yaw = Math.toRadians(turn ? view.yaw() : 180);
			double fx = -Math.sin(yaw);
			double fz = Math.cos(yaw);
			double rx = -Math.cos(yaw);
			double rz = -Math.sin(yaw);
			String key = resolution + "|" + round + "|" + windowVersion + "|" + Math.round(view.x() * 32) + "|" + Math.round(view.z() * 32) + "|"
					+ Math.round(yaw * 2000) + "|" + Math.round(viewBlocks);
			if (!key.equals(drawnKey)) {
				drawnKey = key;
				fill(view, viewBlocks, resolution, fx, fz, rx, rz);
				image.setPixels(pixels);
				frames++;
			}
			canvas.image(image, 0, 0, size, size);
			border(canvas, size, round);
			float center = size / 2f;
			double scale = size / viewBlocks;
			if (showWaypoints.getAsBoolean() && api.server().allowed("waypoints")) waypoints(canvas, view, size, round, scale, fx, fz, rx, rz);
			if (compass.getAsBoolean()) compassLetters(canvas, style, size, round, fx, fz, rx, rz);
			arrow(canvas, center, center, turn ? 0 : -Math.sin(Math.toRadians(view.yaw())), turn ? -1 : Math.cos(Math.toRadians(view.yaw())));
			coordinates(canvas, style, size, view);
		}

		private void ensureImage(int resolution, boolean round) {
			if (image == null || image.width() != resolution) {
				if (image != null) image.close();
				image = api.createImage(resolution, resolution);
				pixels = new int[resolution * resolution];
				drawnKey = "";
			}
			int shapeId = round ? 0 : 1;
			if (maskSize != resolution || maskShape != shapeId) {
				mask = mask(resolution, round);
				maskSize = resolution;
				maskShape = shapeId;
				drawnKey = "";
			}
		}

		/** Bild aus dem Fenster abtasten: gedreht, gezoomt, zugeschnitten */
		private void fill(WorldMap.View view, double viewBlocks, int resolution, double fx, double fz, double rx, double rz) {
			double perPixel = viewBlocks / resolution;
			double half = resolution / 2.0;
			int[] source = window;
			int size = windowSize;
			int minX = windowMinX;
			int minZ = windowMinZ;
			for (int py = 0; py < resolution; py++) {
				double up = (half - py - 0.5) * perPixel;
				for (int px = 0; px < resolution; px++) {
					int i = py * resolution + px;
					float alpha = mask[i];
					if (alpha <= 0f) {
						pixels[i] = 0;
						continue;
					}
					double right = (px + 0.5 - half) * perPixel;
					double wx = view.x() + right * rx + up * fx;
					double wz = view.z() + right * rz + up * fz;
					int bx = (int) Math.floor(wx) - minX;
					int bz = (int) Math.floor(wz) - minZ;
					int color = bx >= 0 && bz >= 0 && bx < size && bz < size ? source[bz * size + bx] : UNLOADED;
					pixels[i] = alpha >= 1f ? color : (Math.round(alpha * 255) << 24) | (color & 0xFFFFFF);
				}
			}
		}

		/** Deckkraft je Pixel: Kreis bzw. Quadrat mit runden Ecken, mit weicher Kante */
		private float[] mask(int resolution, boolean round) {
			float[] result = new float[resolution * resolution];
			double half = resolution / 2.0;
			double corner = resolution * 0.08;
			for (int y = 0; y < resolution; y++) {
				for (int x = 0; x < resolution; x++) {
					double dx = x + 0.5 - half;
					double dy = y + 0.5 - half;
					double outside;
					if (round) {
						outside = Math.sqrt(dx * dx + dy * dy) - half;
					} else {
						double qx = Math.max(Math.abs(dx) - (half - corner), 0);
						double qy = Math.max(Math.abs(dy) - (half - corner), 0);
						outside = Math.sqrt(qx * qx + qy * qy) - corner;
					}
					result[y * resolution + x] = (float) Math.clamp(0.5 - outside, 0, 1);
				}
			}
			return result;
		}

		private void border(HudCanvas canvas, int size, boolean round) {
			float radius = round ? size / 2f : size * 0.08f;
			canvas.roundedOutline(-1, -1, size + 2, size + 2, radius + 1, OUTLINE);
			canvas.roundedOutline(0, 0, size, size, radius, 0x40FFFFFF);
		}

		private void placeholder(HudCanvas canvas, HudStyle style, int size, boolean round, String text) {
			float radius = round ? size / 2f : size * 0.08f;
			canvas.roundedRect(0, 0, size, size, radius, UNLOADED);
			border(canvas, size, round);
			canvas.icon("map", size / 2 - 8, size / 2 - 14, 16, HeldixColors.MUTED);
			HudCanvas.TextStyle small = HudCanvas.TextStyle.SMALL;
			List<String> lines = canvas.wrap(text, size - 12, small);
			float y = size / 2f + 6;
			for (String line : lines) {
				canvas.text(line, (size - canvas.textWidth(line, small)) / 2f, y, HeldixColors.MUTED, small, false);
				y += canvas.lineHeight(small) + 1;
			}
		}

		/** Bildschirm-Lage (GUI-Pixel ab Mitte) eines Weltversatzes in Blöcken */
		private float[] toScreen(double dx, double dz, double scale, double fx, double fz, double rx, double rz) {
			double right = dx * rx + dz * rz;
			double up = dx * fx + dz * fz;
			return new float[] {(float) (right * scale), (float) (-up * scale)};
		}

		private void waypoints(HudCanvas canvas, WorldMap.View view, int size, boolean round, double scale, double fx, double fz, double rx, double rz) {
			String dimension = world.dimension();
			float center = size / 2f;
			float limit = center - 5;
			for (WaypointInfo waypoint : api.waypoints()) {
				if (!dimension.equals(waypoint.dimension())) continue;
				float[] at = toScreen(waypoint.x() + 0.5 - view.x(), waypoint.z() + 0.5 - view.z(), scale, fx, fz, rx, rz);
				float distance = round ? (float) Math.hypot(at[0], at[1]) : Math.max(Math.abs(at[0]), Math.abs(at[1]));
				boolean edge = distance > limit;
				if (edge) {
					at[0] *= limit / distance;
					at[1] *= limit / distance;
				}
				float x = center + at[0];
				float y = center + at[1];
				int color = 0xFF000000 | waypoint.color();
				if (waypoint.death()) {
					canvas.circle(x, y, 4.5f, OUTLINE);
					canvas.icon("close", Math.round(x - 3.5f), Math.round(y - 3.5f), 7, NORTH);
				} else {
					canvas.circle(x, y, edge ? 3f : 4f, OUTLINE);
					canvas.circle(x, y, edge ? 2f : 3f, color);
				}
			}
		}

		private void compassLetters(HudCanvas canvas, HudStyle style, int size, boolean round, double fx, double fz, double rx, double rz) {
			String[] letters = {"N", "O", "S", "W"};
			double[][] directions = {{0, -1}, {1, 0}, {0, 1}, {-1, 0}};
			float center = size / 2f;
			HudCanvas.TextStyle small = HudCanvas.TextStyle.SMALL;
			for (int i = 0; i < 4; i++) {
				float[] at = toScreen(directions[i][0], directions[i][1], 1, fx, fz, rx, rz);
				float reach = center - 6;
				if (!round) {
					// am Rand des Quadrats entlang
					float m = Math.max(Math.abs(at[0]), Math.abs(at[1]));
					reach = (center - 6) / Math.max(0.0001f, m);
				}
				float x = center + at[0] * reach;
				float y = center + at[1] * reach;
				canvas.circle(x, y, 5f, 0xC00B0F17);
				String letter = letters[i];
				canvas.text(letter, x - canvas.textWidth(letter, small) / 2f, y - canvas.lineHeight(small) / 2f + 0.5f, i == 0 ? NORTH : 0xFFE5E7EB, small, false);
			}
		}

		/** Pfeil des Spielers in der Mitte, Spitze in Richtung (dx, dy) auf dem Bildschirm */
		private void arrow(HudCanvas canvas, float cx, float cy, double dx, double dy) {
			double length = Math.hypot(dx, dy);
			if (length < 1e-6) return;
			dx /= length;
			dy /= length;
			double nx = -dy;
			double ny = dx;
			float tipX = (float) (cx + dx * 6.5);
			float tipY = (float) (cy + dy * 6.5);
			float leftX = (float) (cx - dx * 4.5 + nx * 4.5);
			float leftY = (float) (cy - dy * 4.5 + ny * 4.5);
			float rightX = (float) (cx - dx * 4.5 - nx * 4.5);
			float rightY = (float) (cy - dy * 4.5 - ny * 4.5);
			float notchX = (float) (cx - dx * 2);
			float notchY = (float) (cy - dy * 2);
			// dunkler Rand, dann weiß gefüllt (Linien von der Spitze zur Rückseite)
			float[][] edges = {{tipX, tipY, leftX, leftY}, {leftX, leftY, notchX, notchY}, {notchX, notchY, rightX, rightY}, {rightX, rightY, tipX, tipY}};
			for (float[] e : edges) canvas.line(e[0], e[1], e[2], e[3], 3f, OUTLINE);
			for (int i = 0; i <= 8; i++) {
				float t = i / 8f;
				float bx = i <= 4 ? lerp(leftX, notchX, t * 2) : lerp(notchX, rightX, (t - 0.5f) * 2);
				float by = i <= 4 ? lerp(leftY, notchY, t * 2) : lerp(notchY, rightY, (t - 0.5f) * 2);
				canvas.line(tipX, tipY, bx, by, 1.4f, 0xFFFFFFFF);
			}
			for (float[] e : edges) canvas.line(e[0], e[1], e[2], e[3], 1.1f, 0xFFFFFFFF);
		}

		private static float lerp(float a, float b, float t) {
			return a + (b - a) * t;
		}

		private void coordinates(HudCanvas canvas, HudStyle style, int size, WorldMap.View view) {
			// Regel „coordinates“ des Servers: keine Koordinaten unter der Karte
			if (!coordinates.getAsBoolean() || !api.server().allowed("coordinates")) return;
			String text = String.format(Locale.ROOT, "%d  %d  %d", (int) Math.floor(view.x()), (int) Math.floor(view.y()), (int) Math.floor(view.z()));
			HudCanvas.TextStyle small = HudCanvas.TextStyle.SMALL;
			float width = canvas.textWidth(text, small) + 8;
			float x = (size - width) / 2f;
			float y = size + 3;
			canvas.roundedRect(x, y, width, canvas.lineHeight(small) + 4, 3, 0xB30B0F17);
			canvas.text(text, x + 4, y + 2, style.textColor(), small, false);
		}
	}

	// ======================================================================================
	// Für den Autotest (über Reflexion)
	// ======================================================================================

	public int tileCount() {
		return tiles.size();
	}

	public int loadedColumns() {
		int sum = 0;
		for (Tile tile : tiles.values()) sum += tile.loaded;
		return sum;
	}

	public int framesDrawn() {
		return frames;
	}

	public double currentView() {
		return viewBlocks();
	}

	public int currentLayer() {
		return layer;
	}

	/** Farbe im Fenster an einer Weltstelle (0 = nicht im Fenster) */
	public int windowColor(int x, int z) {
		int bx = x - windowMinX;
		int bz = z - windowMinZ;
		return bx >= 0 && bz >= 0 && bx < windowSize && bz < windowSize ? window[bz * windowSize + bx] : 0;
	}
}
