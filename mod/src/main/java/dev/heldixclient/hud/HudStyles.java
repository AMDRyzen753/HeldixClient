package dev.heldixclient.hud;

import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudStyle;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;

import java.util.List;

/**
 * Das gemeinsame Aussehen aller HUD-Elemente: Stil (Heldix, Minimal, Klassisch), Akzentfarbe, Deckkraft, Größe,
 * dazu die Einstellungen einzelner Elemente aus dem Rechtsklick-Menü des HUD-Editors (Schlüssel {@code style.*} in den
 * Optionen des Moduls). Eingebaute Module und Addons zeichnen Fläche und Text über diese Klasse, damit alles
 * zusammenpasst.
 */
public final class HudStyles {
	public static final int HELDIX = 0;
	public static final int MINIMAL = 1;
	public static final int CLASSIC = 2;
	public static final List<String> NAMES = List.of("Heldix", "Minimal", "Klassisch");

	/** Akzent des Heldix-Menüs (Blau) und hell für Beschriftungen */
	private static final int HELDIX_ACCENT = 0xFF3B82F6;
	private static final int HELDIX_LABEL = 0xFF93C5FD;
	private static final int HELDIX_BG = 0x0B111C;
	private static final int HELDIX_TEXT = 0xFFEEF2F8;
	/** Farben bis 0.13 (Himmelblau, Streifen links) */
	private static final int CLASSIC_BG = 0x091526;

	// Schlüssel in den Optionen eines HUD-Moduls (fehlt = wie global bzw. wie der Stil)
	public static final String BG = "style.bg";
	public static final String OPACITY = "style.opacity";
	public static final String ACCENT = "style.accent";
	public static final String TEXT = "style.text";
	public static final String SHADOW = "style.shadow";
	public static final String BORDER = "style.border";
	public static final String ALIGN = "style.align";
	public static final List<String> KEYS = List.of(BG, OPACITY, ACCENT, TEXT, SHADOW, BORDER, ALIGN);
	/** Ausrichtung: auto (folgt dem Bildschirmrand), left, center, right */
	public static final List<String> ALIGNS = List.of("auto", "left", "center", "right");

	private static Resolved current;

	private HudStyles() {
	}

	private static HeldixConfig.Data config() {
		return HeldixConfig.get();
	}

	public static int kind() {
		return Math.clamp(config().hudStyle, 0, 2);
	}

	/** Akzentfarbe des Stils, wenn keine eigene eingestellt ist */
	public static int defaultAccent(int kind) {
		return kind == CLASSIC ? Theme.ACCENT : HELDIX_ACCENT;
	}

	/** Akzentfarbe des HUD insgesamt (eigene oder die des Stils) */
	public static int globalAccent() {
		int accent = config().hudAccent;
		return accent != 0 ? accent | 0xFF000000 : defaultAccent(kind());
	}

	/** Hintergrund standardmäßig an? (Minimal: aus) */
	public static boolean defaultBackground(int kind) {
		return kind != MINIMAL && config().hudBackground;
	}

	/** Heller Ton einer Farbe für Text auf dunklem Grund */
	public static int light(int color) {
		return Draw.lerp(color | 0xFF000000, 0xFFFFFFFF, 0.45f);
	}

	// ======================================================================================
	// Aufgelöster Stil eines Elements
	// ======================================================================================

	/** Stil für genau ein Element (globale Werte mit den Einstellungen des Elements verrechnet) */
	public static final class Resolved implements HudStyle {
		final int kind;
		final int accent;
		final int label;
		final int text;
		final int background;
		final float opacity;
		final boolean border;
		final boolean shadow;
		final Align align;
		final float scale;
		/** Innenabstand links (beim klassischen Stil mit Streifen), rechts, oben/unten */
		public final int padLeft;
		public final int padRight;
		public final int padY;

		Resolved(int kind, int accent, int label, int text, int background, float opacity, boolean border, boolean shadow, Align align, float scale) {
			this.kind = kind;
			this.accent = accent;
			this.label = label;
			this.text = text;
			this.background = background;
			this.opacity = opacity;
			this.border = border;
			this.shadow = shadow;
			this.align = align;
			this.scale = scale;
			boolean box = background != 0 || border;
			if (kind == CLASSIC) {
				padLeft = box ? 2 + 4 : 2;
				padRight = box ? 4 : 2;
				padY = box ? 4 : 2;
			} else if (kind == MINIMAL) {
				padLeft = box ? 4 : 1;
				padRight = box ? 4 : 1;
				padY = box ? 4 : 1;
			} else {
				padLeft = box ? 5 : 1;
				padRight = box ? 5 : 1;
				padY = box ? 4 : 1;
			}
		}

		@Override
		public Kind kind() {
			return kind == MINIMAL ? Kind.MINIMAL : kind == CLASSIC ? Kind.CLASSIC : Kind.HELDIX;
		}

		@Override
		public int accent() {
			return accent;
		}

		@Override
		public int labelColor() {
			return label;
		}

		@Override
		public int textColor() {
			return text;
		}

		@Override
		public int background() {
			return background;
		}

		@Override
		public float opacity() {
			return opacity;
		}

		@Override
		public boolean border() {
			return border;
		}

		@Override
		public int borderColor() {
			return kind == HELDIX ? 0x2EFFFFFF : 0x26FFFFFF;
		}

		@Override
		public boolean shadow() {
			return shadow;
		}

		@Override
		public float radius() {
			return kind == HELDIX ? 4.5f : kind == MINIMAL ? 3 : 1;
		}

		@Override
		public int padding() {
			return padRight;
		}

		@Override
		public Align align() {
			return align;
		}

		@Override
		public float scale() {
			return scale;
		}

		@Override
		public HudCanvas.TextStyle textStyle() {
			return kind == HELDIX ? HudCanvas.TextStyle.BODY : HudCanvas.TextStyle.MINECRAFT;
		}

		/** Heldix-Schrift (Inter) statt der Minecraft-Schrift? */
		public boolean inter() {
			return kind == HELDIX;
		}

		/** Ausrichtung als 0 (links), 1 (Mitte), 2 (rechts) */
		public int alignIndex() {
			return align.ordinal();
		}
	}

	/** Stil eines Elements; null = nur die globalen Werte */
	public static Resolved resolve(HudModule module) {
		HeldixConfig.Data config = config();
		int kind = kind();
		int accent = globalAccent();
		if (module != null) {
			Integer own = color(module.styleValue(ACCENT));
			if (own != null) accent = own | 0xFF000000;
		}
		int label = accent == defaultAccent(kind) ? (kind == CLASSIC ? Theme.ACCENT_LIGHT : HELDIX_LABEL) : light(accent);
		int text = kind == HELDIX ? HELDIX_TEXT : Theme.TEXT;
		boolean background = defaultBackground(kind);
		float opacity = Math.clamp(config.hudOpacity, 0f, 1f);
		boolean border = kind == HELDIX;
		boolean shadow;
		HudStyle.Align align = null;
		if (module != null) {
			Integer ownText = color(module.styleValue(TEXT));
			if (ownText != null) text = ownText | 0xFF000000;
			background = bool(module.styleValue(BG), background);
			opacity = (float) Math.clamp(number(module.styleValue(OPACITY), opacity), 0, 1);
			border = bool(module.styleValue(BORDER), border);
			String a = module.styleValue(ALIGN);
			if ("left".equals(a)) align = HudStyle.Align.LEFT;
			else if ("center".equals(a)) align = HudStyle.Align.CENTER;
			else if ("right".equals(a)) align = HudStyle.Align.RIGHT;
		}
		// ohne Fläche braucht Text einen Schatten, sonst ist er auf hellem Grund kaum zu lesen
		boolean box = background && opacity > 0.05f;
		shadow = kind != HELDIX || !box;
		if (module != null) shadow = bool(module.styleValue(SHADOW), shadow);
		if (align == null) {
			HudAnchor anchor = module != null ? module.anchor() : HudAnchor.TOP_LEFT;
			align = HudStyle.Align.values()[anchor.column];
		}
		int bgRgb = kind == CLASSIC ? CLASSIC_BG : HELDIX_BG;
		int bg = background ? (Math.round(opacity * 255) << 24) | bgRgb : 0;
		if ((bg >>> 24) == 0) bg = 0;
		float scale = module != null ? module.effectiveScale() : Math.clamp(config.hudScale, 0.5f, 2f);
		return new Resolved(kind, accent, label, text, bg, opacity, border, shadow, align, scale);
	}

	/**
	 * Stil für ein HUD-Element vom Server ({@link ServerHud}): die globalen Werte, Ausrichtung nach der Spalte des
	 * Bezugspunkts (0 links, 1 Mitte, 2 rechts) und auf Wunsch die Farbe des Servers als Akzent (Titel, Balken).
	 */
	public static Resolved forServer(int column, Integer color) {
		Resolved global = resolve(null);
		int accent = color != null ? color | 0xFF000000 : global.accent;
		int label = color != null ? light(accent) : global.label;
		HudStyle.Align align = HudStyle.Align.values()[Math.clamp(column, 0, 2)];
		return new Resolved(global.kind, accent, label, global.text, global.background, global.opacity, global.border, global.shadow, align, global.scale);
	}

	/** Stil des Elements, das gerade gezeichnet wird (außerhalb: global) */
	public static Resolved current() {
		return current != null ? current : resolve(null);
	}

	public static Resolved begin(Resolved style) {
		Resolved previous = current;
		current = style;
		return previous;
	}

	public static void end(Resolved previous) {
		current = previous;
	}

	// ======================================================================================
	// Zeichnen im Stil (für eingebaute Module und die Addon-Zeichenfläche)
	// ======================================================================================

	/** Fläche des Elements im aktuellen Stil (ohne Hintergrund nur der Rahmen bzw. nichts) */
	public static void panel(GuiGraphicsExtractor g, float x, float y, float w, float h) {
		Resolved s = current();
		if (w <= 0 || h <= 0) return;
		if (s.kind == CLASSIC) {
			int ix = Math.round(x);
			int iy = Math.round(y);
			int iw = Math.round(w);
			int ih = Math.round(h);
			if (s.background != 0) {
				Draw.rounded(g, ix, iy, iw, ih, s.background);
				g.fill(ix + 1, iy, ix + iw - 1, iy + 1, 0x26FFFFFF);
			}
			if (s.background != 0 || s.border) g.fill(ix, iy + 2, ix + 2, iy + ih - 2, s.accent);
			if (s.border) Draw.outline(g, ix, iy, iw, ih, s.borderColor());
			return;
		}
		if (s.background != 0) Ui.rect(g, x, y, w, h, s.radius(), s.background);
		if (s.border) Ui.outline(g, x, y, w, h, s.radius(), s.borderColor());
	}

	/** Breite eines Textes in der Schrift des Stils (label = halbfett) */
	public static int width(String text, boolean label) {
		if (text == null || text.isEmpty()) return 0;
		Resolved s = current();
		if (s.inter()) return Ui.width(text, label ? Ui.Font.LABEL : Ui.Font.BODY);
		return Minecraft.getInstance().font.width(text);
	}

	public static int width(Component text, boolean label) {
		Resolved s = current();
		Font font = Minecraft.getInstance().font;
		if (s.inter()) return font.width(Ui.styled(text, label ? Ui.Font.LABEL : Ui.Font.BODY));
		return font.width(text);
	}

	/** Text in der Schrift des Stils (mit Schatten, wenn der Stil es will) */
	public static void text(GuiGraphicsExtractor g, String text, int x, int y, int color, boolean label) {
		if (text == null || text.isEmpty()) return;
		Resolved s = current();
		Font font = Minecraft.getInstance().font;
		if (s.inter()) g.text(font, Ui.text(text, label ? Ui.Font.LABEL : Ui.Font.BODY), x, y, color, s.shadow);
		else g.text(font, text, x, y, color, s.shadow);
	}

	public static void text(GuiGraphicsExtractor g, Component text, int x, int y, int color, boolean label) {
		Resolved s = current();
		Font font = Minecraft.getInstance().font;
		if (s.inter()) g.text(font, Ui.styled(text, label ? Ui.Font.LABEL : Ui.Font.BODY), x, y, color, s.shadow);
		else g.text(font, text, x, y, color, s.shadow);
	}

	/** Kleine Nebenschrift (z. B. Zeiten unter Namen): Inter klein bzw. Minecraft-Schrift */
	public static void small(GuiGraphicsExtractor g, String text, int x, int y, int color) {
		if (text == null || text.isEmpty()) return;
		Resolved s = current();
		Font font = Minecraft.getInstance().font;
		if (s.inter()) g.text(font, Ui.text(text, Ui.Font.SMALL), x, y, color, s.shadow);
		else g.text(font, text, x, y, color, s.shadow);
	}

	public static int smallWidth(String text) {
		if (text == null || text.isEmpty()) return 0;
		return current().inter() ? Ui.width(text, Ui.Font.SMALL) : Minecraft.getInstance().font.width(text);
	}

	/** Fortschrittsbalken mit runden Enden (Akzent bzw. eigene Farbe) */
	public static void bar(GuiGraphicsExtractor g, float x, float y, float w, float h, float progress, int color) {
		if (w <= 0 || h <= 0) return;
		Resolved s = current();
		float r = s.kind == CLASSIC ? 0 : h / 2f;
		Ui.rect(g, x, y, w, h, r, 0x40000000 | (s.kind == CLASSIC ? 0x000000 : 0x1F2937));
		float fraction = Float.isNaN(progress) ? 0 : Math.clamp(progress, 0f, 1f);
		if (fraction > 0) Ui.rect(g, x, y, Math.max(s.kind == CLASSIC ? 1 : h, w * fraction), h, r, color);
	}

	// --- Werte aus den Optionen -------------------------------------------------------------

	static Integer color(String value) {
		if (value == null || !value.matches("#[0-9A-Fa-f]{8}")) return null;
		return (int) Long.parseLong(value.substring(1), 16);
	}

	public static String colorValue(int color) {
		return String.format("#%08X", color);
	}

	private static boolean bool(String value, boolean fallback) {
		return value == null ? fallback : Boolean.parseBoolean(value);
	}

	private static double number(String value, double fallback) {
		if (value == null) return fallback;
		try {
			return Double.parseDouble(value);
		} catch (NumberFormatException e) {
			return fallback;
		}
	}
}
