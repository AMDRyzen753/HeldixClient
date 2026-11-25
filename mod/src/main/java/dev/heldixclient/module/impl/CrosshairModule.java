package dev.heldixclient.module.impl;

import dev.heldixclient.module.Module;
import dev.heldixclient.module.Setting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.phys.HitResult;

import java.util.List;

/**
 * Eigenes Fadenkreuz: Form, Farbe, Größe, Dicke, Lücke und Umrandung. Ersetzt nur das Bild des Fadenkreuzes –
 * wann es zu sehen ist (erste Person, nicht im F3-3D-Modus …) und die Angriffsanzeige bleiben bei Minecraft.
 */
public class CrosshairModule extends Module {
	static final List<String> SHAPES = List.of("Kreuz", "Kreuz mit Punkt", "Punkt", "Kreis", "Kreis mit Punkt", "Winkel");
	static final List<String> COLORS = List.of("Weiß", "Rot", "Grün", "Blau", "Gelb", "Pink", "Cyan", "Schwarz");
	private static final int[] RGB = {0xFFFFFF, 0xFF4D4D, 0x4ADE80, 0x60A5FA, 0xFDE047, 0xF472B6, 0x22D3EE, 0x111111};

	public CrosshairModule() {
		super("crosshair", "Fadenkreuz", "Form, Farbe und Größe einstellen", false, 0, 0);
	}

	/** Hook: zeichnet das Fadenkreuz mittig. */
	public void draw(GuiGraphicsExtractor g, Minecraft mc) {
		int shape = (int) option("shape", 1);
		int size = (int) option("size", 5);
		int thickness = (int) option("thickness", 1);
		int gap = (int) option("gap", 2);
		boolean outline = option("outline", true);
		int alpha = (int) Math.round(option("opacity", 1.0) * 255) << 24;
		int color = alpha | RGB[Math.clamp((int) option("color", 0), 0, RGB.length - 1)];
		if (option("targetColor", true) && mc.hitResult != null && mc.hitResult.getType() == HitResult.Type.ENTITY) {
			color = alpha | 0xFF3B3B;
		}
		int shadow = (alpha >>> 1 & 0xFF000000) | 0x000000;
		int cx = g.guiWidth() / 2;
		int cy = g.guiHeight() / 2;
		draw(g, cx, cy, shape, size, thickness, gap, outline ? shadow : 0, color);
	}

	/** Zeichnet die Form um (cx, cy); outlineColor 0 = ohne Umrandung. Auch für die Vorschau im Menü. */
	public static void draw(GuiGraphicsExtractor g, int cx, int cy, int shape, int size, int thickness, int gap, int outlineColor, int color) {
		int half = thickness / 2;
		int x0 = cx - half;
		int y0 = cy - half;
		switch (shape) {
			case 0, 1 -> { // Kreuz (mit Punkt)
				cross(g, x0, y0, size, thickness, gap, outlineColor, color, false);
				if (shape == 1) box(g, x0, y0, thickness, thickness, outlineColor, color);
			}
			case 2 -> { // Punkt
				int d = Math.max(thickness, Math.max(2, size / 2));
				box(g, cx - d / 2, cy - d / 2, d, d, outlineColor, color);
			}
			case 3, 4 -> { // Kreis (mit Punkt)
				ring(g, cx, cy, Math.max(2, size), thickness, outlineColor, color);
				if (shape == 4) box(g, x0, y0, thickness, thickness, outlineColor, color);
			}
			default -> { // Winkel: nur die untere Hälfte des Kreuzes und links/rechts
				cross(g, x0, y0, size, thickness, gap, outlineColor, color, true);
				box(g, x0, y0, thickness, thickness, outlineColor, color);
			}
		}
	}

	private static void cross(GuiGraphicsExtractor g, int x0, int y0, int size, int t, int gap, int outline, int color, boolean noTop) {
		// links, rechts, oben, unten
		box(g, x0 - gap - size, y0, size, t, outline, color);
		box(g, x0 + t + gap, y0, size, t, outline, color);
		if (!noTop) box(g, x0, y0 - gap - size, t, size, outline, color);
		box(g, x0, y0 + t + gap, t, size, outline, color);
	}

	private static void box(GuiGraphicsExtractor g, int x, int y, int w, int h, int outline, int color) {
		if (w <= 0 || h <= 0) return;
		if (outline != 0) g.fill(x - 1, y - 1, x + w + 1, y + h + 1, outline);
		g.fill(x, y, x + w, y + h, color);
	}

	/** Kreis aus Pixeln (Mittelpunkt-Verfahren), Dicke nach innen */
	private static void ring(GuiGraphicsExtractor g, int cx, int cy, int radius, int t, int outline, int color) {
		for (int pass = 0; pass < (outline != 0 ? 2 : 1); pass++) {
			boolean drawOutline = outline != 0 && pass == 0;
			int c = drawOutline ? outline : color;
			for (int r = radius; r > radius - t && r > 0; r--) {
				for (int i = 0; i < 360; i += Math.max(1, 90 / Math.max(1, r * 2))) {
					double a = Math.toRadians(i);
					int px = cx + (int) Math.round(Math.cos(a) * r);
					int py = cy + (int) Math.round(Math.sin(a) * r);
					if (drawOutline) g.fill(px - 1, py - 1, px + 2, py + 2, c);
					else g.fill(px, py, px + 1, py + 1, c);
				}
			}
		}
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(choice("shape", "Form", "", SHAPES, 1));
		settings.add(choice("color", "Farbe", "", COLORS, 0));
		settings.add(slider("size", "Größe", "Länge der Striche bzw. Radius", 1, 12, 1, 5, v -> Math.round(v) + " px"));
		settings.add(slider("thickness", "Dicke", "", 1, 4, 1, 1, v -> Math.round(v) + " px"));
		settings.add(slider("gap", "Lücke", "Abstand der Striche zur Mitte", 0, 8, 1, 2, v -> Math.round(v) + " px"));
		settings.add(slider("opacity", "Deckkraft", "", 0.2, 1, 0.05, 1, Setting::percent));
		settings.add(toggle("outline", "Umrandung", "Dunkler Rand, damit es auf hellem Grund sichtbar bleibt", true));
		settings.add(toggle("targetColor", "Rot bei Zielen", "Färbt sich rot, wenn du auf ein Lebewesen zielst", true));
		return settings;
	}
}
