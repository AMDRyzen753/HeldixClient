package dev.heldixclient.ui;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.textures.FilterMode;
import dev.heldixclient.HeldixClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.resources.Identifier;
import net.minecraft.util.FormattedCharSequence;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Zeichnen im neuen Heldix-Design: eigene Schrift (Inter), kantengeglättete abgerundete Flächen,
 * weiche Schatten und ein eigenes Icon-Set. Formen werden in echten Bildschirmpixeln gezeichnet
 * (nicht in GUI-Pixeln), dadurch wirken sie unabhängig von der GUI-Skalierung glatt.
 *
 * <p>Die Grafiken erzeugt {@code launcher/scripts/render-ui-assets.mjs}.
 */
public final class Ui {
	// --- Farben (ARGB) ---------------------------------------------------------------------
	public static final int SCRIM = 0xA6060A13;
	public static final int WINDOW = 0xEE0F1420;
	public static final int SIDEBAR = 0x5C05080F;
	public static final int SURFACE = 0x0DFFFFFF;
	public static final int SURFACE_HOVER = 0x18FFFFFF;
	public static final int SURFACE_STRONG = 0x22FFFFFF;
	public static final int LINE = 0x16FFFFFF;
	public static final int LINE_STRONG = 0x2AFFFFFF;
	public static final int TEXT = 0xFFEEF2F8;
	public static final int MUTED = 0xFF9BA6B8;
	public static final int FAINT = 0xFF667186;
	public static final int ACCENT = 0xFF3B82F6;
	public static final int ACCENT_HOVER = 0xFF5A97F8;
	public static final int ACCENT_SOFT = 0x2B3B82F6;
	public static final int ACCENT_LINE = 0x993B82F6;
	public static final int ACCENT_TEXT = 0xFF93C5FD;
	public static final int SUCCESS = 0xFF34D399;
	public static final int WARNING = 0xFFFBBF24;
	public static final int DANGER = 0xFFF87171;

	// --- Grafiken ---------------------------------------------------------------------------
	private static final Identifier SHAPES = tex("shapes.png");
	private static final Identifier SHADOW = tex("shadow.png");
	private static final Identifier ICONS = tex("icons.png");
	private static final Identifier ICONS_SMALL = tex("icons_small.png");
	private static final Identifier BACKGROUND = tex("background.png");
	private static final Identifier LOGO = tex("logo.png");
	private static final int MAX_R = 40;
	private static final int SHAPES_W = MAX_R * (MAX_R + 1) / 2;
	private static final int SHAPES_H = MAX_R * 12;

	private static final Set<Identifier> LINEAR = new HashSet<>();
	private static Map<String, Integer> iconIndex;
	private static int iconCell = 64;
	private static int iconColumns = 8;
	private static int iconRows = 1;

	// --- Tooltip (wird am Ende des Bildes gezeichnet) ---------------------------------------
	private static String tooltip;
	private static int tooltipX;
	private static int tooltipY;

	private Ui() {
	}

	private static Identifier tex(String name) {
		return HeldixClient.id("textures/gui/heldix/" + name);
	}

	public static int scale() {
		return Math.max(1, Minecraft.getInstance().getWindow().getGuiScale());
	}

	// ======================================================================================
	// Schrift
	// ======================================================================================

	/** Schriftschnitte der Oberfläche (Inter) */
	public enum Font {
		SMALL("small", 8),
		BODY("body", 9),
		LABEL("label", 9),
		TITLE("title", 12),
		HERO("hero", 22);

		final String key;
		/** Zeilenhöhe in GUI-Pixeln (für das Layout) */
		public final int height;

		Font(String key, int height) {
			this.key = key;
			this.height = height;
		}
	}

	private static final Map<Font, FontDescription[]> FONTS = new EnumMap<>(Font.class);

	private static FontDescription font(Font style) {
		FontDescription[] perScale = FONTS.computeIfAbsent(style, s -> new FontDescription[7]);
		int s = Math.clamp(scale(), 1, 6);
		if (perScale[s] == null) perScale[s] = new FontDescription.Resource(HeldixClient.id("ui_" + style.key + "_" + s));
		return perScale[s];
	}

	public static Component text(String text, Font style) {
		FontDescription font = font(style);
		return Component.literal(text).withStyle(s -> s.withFont(font));
	}

	/** Vorhandenen Text (z. B. Server-Beschreibung mit Farben) in der Heldix-Schrift darstellen */
	public static Component styled(Component text, Font style) {
		FontDescription font = font(style);
		return Component.empty().append(text).withStyle(s -> s.withFont(font));
	}

	public static void text(GuiGraphicsExtractor g, String text, int x, int y, int color, Font style) {
		if (text == null || text.isEmpty()) return;
		g.text(Minecraft.getInstance().font, text(text, style), x, y, color, false);
	}

	public static void textCentered(GuiGraphicsExtractor g, String text, int centerX, int y, int color, Font style) {
		text(g, text, centerX - width(text, style) / 2, y, color, style);
	}

	public static void textRight(GuiGraphicsExtractor g, String text, int right, int y, int color, Font style) {
		text(g, text, right - width(text, style), y, color, style);
	}

	public static int width(String text, Font style) {
		return Minecraft.getInstance().font.width(text(text, style));
	}

	public static String ellipsize(String text, int maxWidth, Font style) {
		if (text == null) return "";
		if (maxWidth <= 0) return "";
		if (width(text, style) <= maxWidth) return text;
		int dots = width("…", style);
		int end = text.length();
		while (end > 0 && width(text.substring(0, end), style) + dots > maxWidth) end--;
		return text.substring(0, end).stripTrailing() + "…";
	}

	/** Zeilenumbruch nach Breite */
	public static List<FormattedCharSequence> wrap(String text, int maxWidth, Font style) {
		return Minecraft.getInstance().font.split(text(text, style), Math.max(1, maxWidth));
	}

	// ======================================================================================
	// Formen (in Bildschirmpixeln)
	// ======================================================================================

	/** Abgerundete Fläche; x/y/w/h/r in GUI-Pixeln, auch halbe Werte. */
	public static void rect(GuiGraphicsExtractor g, float x, float y, float w, float h, float r, int color) {
		if (w <= 0 || h <= 0 || (color >>> 24) == 0) return;
		int s = scale();
		int x0 = Math.round(x * s);
		int y0 = Math.round(y * s);
		int x1 = Math.round((x + w) * s);
		int y1 = Math.round((y + h) * s);
		int pr = Math.min(Math.round(r * s), Math.min(MAX_R, Math.min(x1 - x0, y1 - y0) / 2));
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		if (pr <= 0) {
			g.fill(x0, y0, x1, y1, color);
		} else {
			g.fill(x0 + pr, y0, x1 - pr, y1, color);
			g.fill(x0, y0 + pr, x0 + pr, y1 - pr, color);
			g.fill(x1 - pr, y0 + pr, x1, y1 - pr, color);
			corner(g, 0, 0, pr, x0, y0, color);
			corner(g, 0, 1, pr, x1 - pr, y0, color);
			corner(g, 0, 2, pr, x0, y1 - pr, color);
			corner(g, 0, 3, pr, x1 - pr, y1 - pr, color);
		}
		g.pose().popMatrix();
	}

	/** Rahmen einer abgerundeten Fläche (1 Bildschirmpixel, ab GUI-Skalierung 3 zwei) */
	public static void outline(GuiGraphicsExtractor g, float x, float y, float w, float h, float r, int color) {
		if (w <= 0 || h <= 0 || (color >>> 24) == 0) return;
		int s = scale();
		int t = s >= 3 ? 2 : 1;
		int x0 = Math.round(x * s);
		int y0 = Math.round(y * s);
		int x1 = Math.round((x + w) * s);
		int y1 = Math.round((y + h) * s);
		int pr = Math.min(Math.round(r * s), Math.min(MAX_R, Math.min(x1 - x0, y1 - y0) / 2));
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		if (pr < t) {
			g.fill(x0, y0, x1, y0 + t, color);
			g.fill(x0, y1 - t, x1, y1, color);
			g.fill(x0, y0 + t, x0 + t, y1 - t, color);
			g.fill(x1 - t, y0 + t, x1, y1 - t, color);
		} else {
			g.fill(x0 + pr, y0, x1 - pr, y0 + t, color);
			g.fill(x0 + pr, y1 - t, x1 - pr, y1, color);
			g.fill(x0, y0 + pr, x0 + t, y1 - pr, color);
			g.fill(x1 - t, y0 + pr, x1, y1 - pr, color);
			corner(g, t, 0, pr, x0, y0, color);
			corner(g, t, 1, pr, x1 - pr, y0, color);
			corner(g, t, 2, pr, x0, y1 - pr, color);
			corner(g, t, 3, pr, x1 - pr, y1 - pr, color);
		}
		g.pose().popMatrix();
	}

	private static void corner(GuiGraphicsExtractor g, int kind, int corner, int r, int x, int y, int color) {
		int u = r * (r - 1) / 2;
		int v = (kind * 4 + corner) * MAX_R;
		g.blit(RenderPipelines.GUI_TEXTURED, SHAPES, x, y, u, v, r, r, r, r, SHAPES_W, SHAPES_H, color);
	}

	/** Kreis (z. B. Schalterknopf, Punkte) */
	public static void circle(GuiGraphicsExtractor g, float cx, float cy, float radius, int color) {
		rect(g, cx - radius, cy - radius, radius * 2, radius * 2, radius, color);
	}

	/** Linie von 1 Bildschirmpixel (waagrecht) */
	public static void hline(GuiGraphicsExtractor g, float x0, float x1, float y, int color) {
		int s = scale();
		int t = s >= 3 ? 2 : 1;
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		int py = Math.round(y * s);
		g.fill(Math.round(x0 * s), py, Math.round(x1 * s), py + t, color);
		g.pose().popMatrix();
	}

	/** Linie von 1 Bildschirmpixel (senkrecht) */
	public static void vline(GuiGraphicsExtractor g, float x, float y0, float y1, int color) {
		int s = scale();
		int t = s >= 3 ? 2 : 1;
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		int px = Math.round(x * s);
		g.fill(px, Math.round(y0 * s), px + t, Math.round(y1 * s), color);
		g.pose().popMatrix();
	}

	/** Weicher Schatten unter einer Fläche (Ausdehnung etwa 12 GUI-Pixel, leicht nach unten versetzt) */
	public static void shadow(GuiGraphicsExtractor g, float x, float y, float w, float h, float strength) {
		if (strength <= 0) return;
		linear(SHADOW);
		int s = scale();
		float texel = 12f * s / 32f;
		int e = Math.round(32 * texel);
		int c = Math.round(40 * texel);
		int x0 = Math.round(x * s) - e;
		int y0 = Math.round((y + 3) * s) - e;
		int x1 = Math.round((x + w) * s) + e;
		int y1 = Math.round((y + h + 3) * s) + e;
		int color = Math.round(Math.clamp(strength, 0f, 1f) * 255) << 24;
		int midW = x1 - x0 - 2 * c;
		int midH = y1 - y0 - 2 * c;
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x0, y0, 0, 0, c, c, 40, 40, 96, 96, color);
		g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x1 - c, y0, 56, 0, c, c, 40, 40, 96, 96, color);
		g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x0, y1 - c, 0, 56, c, c, 40, 40, 96, 96, color);
		g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x1 - c, y1 - c, 56, 56, c, c, 40, 40, 96, 96, color);
		if (midW > 0) {
			g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x0 + c, y0, 40, 0, midW, c, 16, 40, 96, 96, color);
			g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x0 + c, y1 - c, 40, 56, midW, c, 16, 40, 96, 96, color);
		}
		if (midH > 0) {
			g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x0, y0 + c, 0, 40, c, midH, 40, 16, 96, 96, color);
			g.blit(RenderPipelines.GUI_TEXTURED, SHADOW, x1 - c, y0 + c, 56, 40, c, midH, 40, 16, 96, 96, color);
		}
		g.pose().popMatrix();
	}

	// ======================================================================================
	// Bedienelemente
	// ======================================================================================

	/** Schalter (18×10), t = 0 aus … 1 an */
	public static void toggle(GuiGraphicsExtractor g, float x, float y, float t, float alpha) {
		rect(g, x, y, 18, 10, 5, withAlpha(lerp(0x3DFFFFFF, ACCENT, t), alpha));
		circle(g, x + 5 + t * 8, y + 5, 3.5f, withAlpha(0xFFFFFFFF, alpha));
	}

	public static void toggle(GuiGraphicsExtractor g, float x, float y, float t) {
		toggle(g, x, y, t, 1f);
	}

	/** Dünne Bildlaufleiste rechts */
	public static void scrollbar(GuiGraphicsExtractor g, int x, int y, int h, double scroll, int max) {
		if (max <= 0) return;
		int barH = Math.max(18, h * h / (h + max));
		float barY = y + (float) ((h - barH) * (scroll / max));
		rect(g, x, y, 3, h, 1.5f, 0x0FFFFFFF);
		rect(g, x, barY, 3, barH, 1.5f, 0x55FFFFFF);
	}

	// ======================================================================================
	// Icons
	// ======================================================================================

	/** Zeichnet ein Icon aus dem Heldix-Icon-Set (weiß, mit Farbe eingefärbt). Unbekannte Namen: Würfel. */
	public static void icon(GuiGraphicsExtractor g, String name, float x, float y, float size, int color) {
		loadIconIndex();
		Integer index = iconIndex.get(name);
		if (index == null) index = iconIndex.getOrDefault("cube", 0);
		int s = scale();
		int ps = Math.round(size * s);
		boolean small = ps <= 36;
		Identifier atlas = small ? ICONS_SMALL : ICONS;
		int cell = small ? iconCell / 2 : iconCell;
		linear(atlas);
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		g.blit(RenderPipelines.GUI_TEXTURED, atlas, Math.round(x * s), Math.round(y * s), (index % iconColumns) * cell, (index / iconColumns) * cell,
				ps, ps, cell, cell, iconColumns * cell, iconRows * cell, color);
		g.pose().popMatrix();
	}

	public static boolean hasIcon(String name) {
		loadIconIndex();
		return iconIndex.containsKey(name);
	}

	private static void loadIconIndex() {
		if (iconIndex != null) return;
		iconIndex = new HashMap<>();
		try (InputStream in = Minecraft.getInstance().getResourceManager().open(tex("icons.json"));
				InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
			JsonObject json = JsonParser.parseReader(reader).getAsJsonObject();
			iconCell = json.get("cell").getAsInt();
			iconColumns = json.get("columns").getAsInt();
			JsonArray names = json.getAsJsonArray("names");
			for (int i = 0; i < names.size(); i++) iconIndex.put(names.get(i).getAsString(), i);
			iconRows = (names.size() + iconColumns - 1) / iconColumns;
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Icons der Oberfläche fehlen", e);
		}
	}

	// ======================================================================================
	// Bilder: Logo und Hintergrund
	// ======================================================================================

	public static void logo(GuiGraphicsExtractor g, float x, float y, float size, float alpha) {
		linear(LOGO);
		int s = scale();
		int ps = Math.round(size * s);
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		g.blit(RenderPipelines.GUI_TEXTURED, LOGO, Math.round(x * s), Math.round(y * s), 0, 0, ps, ps, 128, 128, 128, 128, withAlpha(0xFFFFFFFF, alpha));
		g.pose().popMatrix();
	}

	/** Hintergrundbild des Hauptmenüs, füllt den Bildschirm (Seitenverhältnis bleibt) */
	public static void background(GuiGraphicsExtractor g, int width, int height, float alpha) {
		linear(BACKGROUND);
		int s = scale();
		int w = width * s;
		int h = height * s;
		float fit = Math.max(w / 1600f, h / 1000f);
		int dw = Math.round(1600 * fit);
		int dh = Math.round(1000 * fit);
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		g.blit(RenderPipelines.GUI_TEXTURED, BACKGROUND, (w - dw) / 2, (h - dh) / 2, 0, 0, dw, dh, 1600, 1000, 1600, 1000, withAlpha(0xFFFFFFFF, alpha));
		g.pose().popMatrix();
	}

	// ======================================================================================
	// Bilder aus Dateien (z. B. Album-Cover eines Addons)
	// ======================================================================================

	private static final int MAX_FILE_TEXTURES = 24;
	/** Wie oft geprüft wird, ob sich eine Datei geändert hat */
	private static final long FILE_CHECK_MS = 2000;

	private static final class FileTexture {
		final Identifier id;
		final long modified;
		final int width;
		final int height;
		/** typische Farbe des Bildes (für Akzentfarben), 0 = unbekannt */
		int color;
		long checkedAt;

		FileTexture(Identifier id, long modified, int width, int height) {
			this.id = id;
			this.modified = modified;
			this.width = width;
			this.height = height;
		}
	}

	/** zuletzt benutzte zuerst raus (access order) */
	private static final LinkedHashMap<Path, FileTexture> FILE_TEXTURES = new LinkedHashMap<>(16, 0.75f, true);
	/** Dateien, die nicht ladbar waren (Pfad → Änderungszeit beim Fehlschlag) */
	private static final Map<Path, Long> FILE_FAILED = new HashMap<>();
	private static int fileTextureCounter;

	/** Zeichnet ein PNG aus einer Datei, weich skaliert. @return false, wenn die Datei fehlt oder ungültig ist */
	public static boolean image(GuiGraphicsExtractor g, Path file, float x, float y, float w, float h, float alpha) {
		FileTexture texture = fileTexture(file);
		if (texture == null) return false;
		int s = scale();
		int x0 = Math.round(x * s);
		int y0 = Math.round(y * s);
		int x1 = Math.round((x + w) * s);
		int y1 = Math.round((y + h) * s);
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		g.blit(RenderPipelines.GUI_TEXTURED, texture.id, x0, y0, 0, 0, x1 - x0, y1 - y0, texture.width, texture.height,
				texture.width, texture.height, withAlpha(0xFFFFFFFF, alpha));
		g.pose().popMatrix();
		return true;
	}

	/** Typische Farbe eines PNG aus einer Datei (lädt es wie {@link #image}); 0, wenn es fehlt oder ungültig ist */
	public static int imageColor(Path file) {
		FileTexture texture = fileTexture(file);
		return texture == null ? 0 : texture.color;
	}

	/**
	 * Durchschnittsfarbe, bei der kräftige Farben viel mehr zählen als Grau, Schwarz und Weiß – so wird ein Cover
	 * mit dunklem Hintergrund und rotem Schriftzug „rot“ und nicht „dunkelgrau“. Liest höchstens 32×32 Punkte.
	 */
	private static int typicalColor(NativeImage image) {
		int w = image.getWidth();
		int h = image.getHeight();
		if (w <= 0 || h <= 0) return 0;
		int stepX = Math.max(1, w / 32);
		int stepY = Math.max(1, h / 32);
		double r = 0, gr = 0, b = 0, weight = 0;
		double pr = 0, pg = 0, pb = 0, plain = 0;
		for (int y = stepY / 2; y < h; y += stepY) {
			for (int x = stepX / 2; x < w; x += stepX) {
				int argb = image.getPixel(x, y);
				if ((argb >>> 24) < 128) continue;
				int cr = (argb >> 16) & 0xFF;
				int cg = (argb >> 8) & 0xFF;
				int cb = argb & 0xFF;
				int max = Math.max(cr, Math.max(cg, cb));
				int min = Math.min(cr, Math.min(cg, cb));
				double saturation = max == 0 ? 0 : (max - min) / (double) max;
				double value = max / 255.0;
				double wgt = saturation * saturation * (value < 0.2 ? value * 2 : 1) + 0.002;
				r += cr * wgt;
				gr += cg * wgt;
				b += cb * wgt;
				weight += wgt;
				pr += cr;
				pg += cg;
				pb += cb;
				plain++;
			}
		}
		if (plain == 0) return 0;
		if (weight < plain * 0.01) {
			// fast ohne Farbe: einfacher Durchschnitt
			r = pr;
			gr = pg;
			b = pb;
			weight = plain;
		}
		return 0xFF000000 | ((int) Math.round(r / weight) << 16) | ((int) Math.round(gr / weight) << 8) | (int) Math.round(b / weight);
	}

	private static FileTexture fileTexture(Path file) {
		if (file == null) return null;
		long now = System.currentTimeMillis();
		FileTexture cached = FILE_TEXTURES.get(file);
		if (cached != null && now - cached.checkedAt < FILE_CHECK_MS) return cached;
		long modified;
		try {
			modified = Files.getLastModifiedTime(file).toMillis();
		} catch (Exception e) {
			return null;
		}
		if (cached != null && cached.modified == modified) {
			cached.checkedAt = now;
			return cached;
		}
		Long failed = FILE_FAILED.get(file);
		if (failed != null && failed == modified) return null;
		if (cached != null) {
			FILE_TEXTURES.remove(file);
			Minecraft.getInstance().getTextureManager().release(cached.id);
		}
		try (InputStream in = Files.newInputStream(file)) {
			NativeImage image = NativeImage.read(in);
			Identifier id = HeldixClient.id("dynamic/file_" + (++fileTextureCounter));
			FileTexture texture = new FileTexture(id, modified, image.getWidth(), image.getHeight());
			texture.color = typicalColor(image);
			Minecraft.getInstance().getTextureManager().register(id, new LinearTexture(id, image));
			texture.checkedAt = now;
			FILE_TEXTURES.put(file, texture);
			while (FILE_TEXTURES.size() > MAX_FILE_TEXTURES) {
				Map.Entry<Path, FileTexture> eldest = FILE_TEXTURES.entrySet().iterator().next();
				FILE_TEXTURES.remove(eldest.getKey());
				Minecraft.getInstance().getTextureManager().release(eldest.getValue().id);
			}
			return texture;
		} catch (Exception e) {
			if (FILE_FAILED.size() > 64) FILE_FAILED.clear();
			FILE_FAILED.put(file, modified);
			HeldixClient.LOGGER.warn("Bild {} nicht ladbar: {}", file, e.toString());
			return null;
		}
	}

	/**
	 * Ausschnitt einer Textur, weich skaliert in Bildschirmpixeln. u/v/uw/vh beziehen sich auf eine gedachte Größe
	 * texW × texH – so funktioniert derselbe Aufruf für jede Auflösung mit gleichem Seitenverhältnis (z. B. Capes).
	 */
	public static void region(GuiGraphicsExtractor g, Identifier texture, float x, float y, float w, float h,
			float u, float v, int uw, int vh, int texW, int texH, float alpha) {
		int s = scale();
		int x0 = Math.round(x * s);
		int y0 = Math.round(y * s);
		int x1 = Math.round((x + w) * s);
		int y1 = Math.round((y + h) * s);
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		g.blit(RenderPipelines.GUI_TEXTURED, texture, x0, y0, u, v, x1 - x0, y1 - y0, uw, vh, texW, texH, withAlpha(0xFFFFFFFF, alpha));
		g.pose().popMatrix();
	}

	/** Grafik aus den Ressourcen mit weicher Filterung registrieren (einmalig, danach kostenlos) */
	public static void linearTexture(Identifier id) {
		linear(id);
	}

	/** Eigenes Bild unter einer ID mit weicher Filterung registrieren (ersetzt eine vorhandene Textur) */
	public static void registerLinear(Identifier id, NativeImage image) {
		Minecraft.getInstance().getTextureManager().register(id, new LinearTexture(id, image));
	}

	/**
	 * Bild mit Mipmaps registrieren: weich beim Vergrößern und ohne Flimmern beim Verkleinern (z. B. ein Cape aus der
	 * Entfernung). Das NativeImage gehört danach der Textur und wird mit ihr geschlossen.
	 */
	public static void registerMipmapped(Identifier id, NativeImage image) {
		Minecraft.getInstance().getTextureManager().register(id, new MipTexture(id, image));
	}

	private static final class MipTexture extends net.minecraft.client.renderer.texture.AbstractTexture {
		/** Bilder aller Stufen: das Hochladen kann verzögert passieren, deshalb erst mit der Textur freigeben */
		private final List<NativeImage> levels = new java.util.ArrayList<>();

		MipTexture(Identifier id, NativeImage image) {
			int levels = 1;
			while (levels < 7 && (image.getWidth() >> levels) >= 8 && (image.getHeight() >> levels) >= 4) levels++;
			com.mojang.renderpearl.api.device.GpuDevice device = RenderSystem.getDevice();
			this.texture = device.createTexture(id::toString, 5, com.mojang.renderpearl.api.GpuFormat.RGBA8_UNORM,
					image.getWidth(), image.getHeight(), 1, levels);
			this.textureView = device.createTextureView(this.texture);
			this.sampler = RenderSystem.getSamplerCache().getClampToEdge(FilterMode.LINEAR, true);
			com.mojang.renderpearl.api.commands.CommandEncoder encoder = device.createCommandEncoder();
			NativeImage level = image;
			for (int i = 0; i < levels; i++) {
				if (i > 0) level = halve(level);
				this.levels.add(level);
				encoder.writeToTexture(this.texture, level, i, 0, 0, 0);
			}
		}

		@Override
		public void close() {
			for (NativeImage level : levels) level.close();
			levels.clear();
			super.close();
		}

		/** halbe Größe, je 2 × 2 Pixel gemittelt */
		private static NativeImage halve(NativeImage source) {
			int w = Math.max(1, source.getWidth() / 2);
			int h = Math.max(1, source.getHeight() / 2);
			NativeImage out = new NativeImage(w, h, false);
			for (int y = 0; y < h; y++) {
				for (int x = 0; x < w; x++) {
					int a = 0;
					int r = 0;
					int g = 0;
					int b = 0;
					for (int dy = 0; dy < 2; dy++) {
						for (int dx = 0; dx < 2; dx++) {
							int argb = source.getPixel(Math.min(source.getWidth() - 1, x * 2 + dx), Math.min(source.getHeight() - 1, y * 2 + dy));
							a += argb >>> 24;
							r += (argb >> 16) & 0xFF;
							g += (argb >> 8) & 0xFF;
							b += argb & 0xFF;
						}
					}
					out.setPixel(x, y, (a / 4) << 24 | (r / 4) << 16 | (g / 4) << 8 | b / 4);
				}
			}
			return out;
		}
	}

	/** Lädt ein Bild mit linearer Filterung (weich beim Skalieren), statt der pixeligen Minecraft-Filterung. */
	private static void linear(Identifier id) {
		if (!LINEAR.add(id)) return;
		Minecraft minecraft = Minecraft.getInstance();
		try (InputStream in = minecraft.getResourceManager().open(id)) {
			NativeImage image = NativeImage.read(in);
			minecraft.getTextureManager().register(id, new LinearTexture(id, image));
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Grafik {} fehlt", id, e);
		}
	}

	/** Neu laden nach einem Ressourcen-Neuladen (F3+T) */
	public static void reload() {
		LINEAR.clear();
		iconIndex = null;
	}

	private static final class LinearTexture extends DynamicTexture {
		LinearTexture(Identifier id, NativeImage image) {
			super(id::toString, image);
			this.sampler = RenderSystem.getSamplerCache().getClampToEdge(FilterMode.LINEAR);
		}
	}

	// ======================================================================================
	// Tooltip
	// ======================================================================================

	/** Merkt einen Tooltip für dieses Bild vor; gezeichnet wird er mit {@link #drawTooltip}. */
	public static void requestTooltip(String text, int mouseX, int mouseY) {
		tooltip = text;
		tooltipX = mouseX;
		tooltipY = mouseY;
	}

	public static void drawTooltip(GuiGraphicsExtractor g, int screenWidth, int screenHeight) {
		String text = tooltip;
		tooltip = null;
		if (text == null) return;
		g.nextStratum();
		int w = width(text, Font.BODY) + 12;
		int h = 16;
		int x = Math.clamp(tooltipX + 8, 2, Math.max(2, screenWidth - w - 2));
		int y = tooltipY - h - 6 >= 2 ? tooltipY - h - 6 : tooltipY + 14;
		shadow(g, x, y, w, h, 0.35f);
		rect(g, x, y, w, h, 5, 0xF51B2232);
		outline(g, x, y, w, h, 5, LINE_STRONG);
		text(g, text, x + 6, y + 4, TEXT, Font.BODY);
	}

	// ======================================================================================
	// Farben
	// ======================================================================================

	public static int withAlpha(int color, float factor) {
		int a = Math.round(((color >>> 24) & 0xFF) * Math.clamp(factor, 0f, 1f));
		return (a << 24) | (color & 0xFFFFFF);
	}

	public static int lerp(int from, int to, float t) {
		return Draw.lerp(from, to, t);
	}

	public static boolean inside(double mouseX, double mouseY, float x, float y, float w, float h) {
		return mouseX >= x && mouseX < x + w && mouseY >= y && mouseY < y + h;
	}
}
