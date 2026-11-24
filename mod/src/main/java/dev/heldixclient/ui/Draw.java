package dev.heldixclient.ui;

import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;

/** Kleine Zeichenhilfen für das HeldixClient-Design. */
public final class Draw {
	private Draw() {
	}

	/** Fläche mit 1 px abgeschnittenen Ecken (wirkt leicht abgerundet). Überlappungsfrei, daher auch mit Transparenz sauber. */
	public static void rounded(GuiGraphicsExtractor g, int x, int y, int w, int h, int color) {
		if (w < 3 || h < 3) {
			g.fill(x, y, x + w, y + h, color);
			return;
		}
		g.fill(x + 1, y, x + w - 1, y + h, color);
		g.fill(x, y + 1, x + 1, y + h - 1, color);
		g.fill(x + w - 1, y + 1, x + w, y + h - 1, color);
	}

	/** Fläche mit 2 px Eckenradius. */
	public static void rounded2(GuiGraphicsExtractor g, int x, int y, int w, int h, int color) {
		if (w < 5 || h < 5) {
			rounded(g, x, y, w, h, color);
			return;
		}
		g.fill(x + 2, y, x + w - 2, y + h, color);
		g.fill(x + 1, y + 1, x + 2, y + h - 1, color);
		g.fill(x, y + 2, x + 1, y + h - 2, color);
		g.fill(x + w - 2, y + 1, x + w - 1, y + h - 1, color);
		g.fill(x + w - 1, y + 2, x + w, y + h - 2, color);
	}

	/** 1 px Rahmen mit abgeschnittenen Ecken. */
	public static void outline(GuiGraphicsExtractor g, int x, int y, int w, int h, int color) {
		g.fill(x + 1, y, x + w - 1, y + 1, color);
		g.fill(x + 1, y + h - 1, x + w - 1, y + h, color);
		g.fill(x, y + 1, x + 1, y + h - 1, color);
		g.fill(x + w - 1, y + 1, x + w, y + h - 1, color);
	}

	/** 1 px Rahmen passend zu {@link #rounded2} (2 px Eckenradius). */
	public static void outline2(GuiGraphicsExtractor g, int x, int y, int w, int h, int color) {
		if (w < 5 || h < 5) {
			outline(g, x, y, w, h, color);
			return;
		}
		g.fill(x + 2, y, x + w - 2, y + 1, color);
		g.fill(x + 2, y + h - 1, x + w - 2, y + h, color);
		g.fill(x, y + 2, x + 1, y + h - 2, color);
		g.fill(x + w - 1, y + 2, x + w, y + h - 2, color);
		g.fill(x + 1, y + 1, x + 2, y + 2, color);
		g.fill(x + w - 2, y + 1, x + w - 1, y + 2, color);
		g.fill(x + 1, y + h - 2, x + 2, y + h - 1, color);
		g.fill(x + w - 2, y + h - 2, x + w - 1, y + h - 1, color);
	}

	/** Multipliziert den Alphakanal einer Farbe (für Ein- und Ausblenden). */
	public static int withAlpha(int color, float factor) {
		if (factor >= 1f) return color;
		int alpha = Math.round(((color >>> 24) & 0xFF) * Math.clamp(factor, 0f, 1f));
		return (alpha << 24) | (color & 0x00FFFFFF);
	}

	/** Horizontale Linie mit Farbverlauf Blau → Himmelblau → Cyan. */
	public static void accentLine(GuiGraphicsExtractor g, int x, int y, int w, int h) {
		int segments = Math.max(1, w / 4);
		for (int i = 0; i < segments; i++) {
			float t = i / (float) Math.max(1, segments - 1);
			int color = t < 0.5f ? lerp(Theme.INDIGO, Theme.ACCENT, t / 0.5f) : lerp(Theme.ACCENT, Theme.CYAN, (t - 0.5f) / 0.5f);
			int x1 = x + i * w / segments;
			int x2 = x + (i + 1) * w / segments;
			g.fill(x1, y, x2, y + h, color);
		}
	}

	/** Glasfläche: halbtransparente Füllung, heller Rand und Lichtkante oben. */
	public static void glass(GuiGraphicsExtractor g, int x, int y, int w, int h, int fill) {
		rounded2(g, x, y, w, h, fill);
		outline2(g, x, y, w, h, Theme.BORDER);
		g.fill(x + 3, y + 1, x + w - 3, y + 2, Theme.HIGHLIGHT);
	}

	/** Fläche mit vertikalem Farbverlauf Blau → Cyan (für Logo und Haupt-Buttons). */
	public static void brandFill(GuiGraphicsExtractor g, int x, int y, int w, int h, float brightness) {
		int top = lerp(0xFF2F74F0, 0xFF5BA8FF, brightness);
		int bottom = lerp(0xFF0EA5E9, 0xFF38D9F5, brightness);
		rounded2(g, x, y, w, h, top);
		g.fillGradient(x + 1, y + 2, x + w - 1, y + h - 1, top, bottom);
		g.fill(x + 3, y + 1, x + w - 3, y + 2, 0x66FFFFFF);
	}

	/** Schalter (20×10). t = 0 aus, 1 an; Zwischenwerte für die Animation. */
	public static void toggle(GuiGraphicsExtractor g, int x, int y, float t) {
		rounded2(g, x, y, 20, 10, lerp(Theme.SWITCH_OFF, Theme.ACCENT, t));
		int knobX = x + 2 + Math.round(10 * t);
		rounded(g, knobX, y + 2, 6, 6, lerp(0xFFD7E3F4, 0xFFFFFFFF, t));
	}

	/** Kleines Logo-Abzeichen: Glas-Kachel mit Farbverlauf und "H". */
	public static void badge(GuiGraphicsExtractor g, Font font, int x, int y, int size) {
		brandFill(g, x, y, size, size, 0f);
		Component h = Component.literal("H").withStyle(ChatFormatting.BOLD);
		g.text(font, h, x + (size - font.width(h)) / 2 + 1, y + (size - 8) / 2 + 1, Theme.TEXT, false);
	}

	/** Button im Heldix-Stil. */
	public static void button(GuiGraphicsExtractor g, Font font, int x, int y, int w, int h, String label, boolean primary, boolean hovered) {
		if (primary) {
			brandFill(g, x, y, w, h, hovered ? 0.6f : 0f);
		} else {
			rounded2(g, x, y, w, h, hovered ? Theme.CARD_HOVER : Theme.CARD);
			outline2(g, x, y, w, h, hovered ? Theme.BORDER_ACCENT : Theme.BORDER);
			g.fill(x + 3, y + 1, x + w - 3, y + 2, Theme.HIGHLIGHT);
		}
		g.text(font, label, x + (w - font.width(label)) / 2, y + (h - 8) / 2, Theme.TEXT, false);
	}

	public static int lerp(int from, int to, float t) {
		t = Math.clamp(t, 0f, 1f);
		int a = Math.round(((from >>> 24) & 0xFF) + (((to >>> 24) & 0xFF) - ((from >>> 24) & 0xFF)) * t);
		int r = Math.round(((from >> 16) & 0xFF) + (((to >> 16) & 0xFF) - ((from >> 16) & 0xFF)) * t);
		int gr = Math.round(((from >> 8) & 0xFF) + (((to >> 8) & 0xFF) - ((from >> 8) & 0xFF)) * t);
		int b = Math.round((from & 0xFF) + ((to & 0xFF) - (from & 0xFF)) * t);
		return (a << 24) | (r << 16) | (gr << 8) | b;
	}

	public static boolean inside(double mouseX, double mouseY, int x, int y, int w, int h) {
		return mouseX >= x && mouseX < x + w && mouseY >= y && mouseY < y + h;
	}

	/** Ease-out für Animationen (0..1). */
	public static float easeOut(float t) {
		t = Math.clamp(t, 0f, 1f);
		return 1 - (1 - t) * (1 - t) * (1 - t);
	}
}
