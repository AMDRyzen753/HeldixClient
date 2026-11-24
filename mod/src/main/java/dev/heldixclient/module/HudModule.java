package dev.heldixclient.module;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Ein Modul, das ein verschiebbares Element im HUD zeichnet. */
public abstract class HudModule extends Module {
	protected static final int PADDING = 4;
	/** Breite des blauen Streifens links an jedem HUD-Element */
	protected static final int BAR = 2;

	private final int defaultX;
	private final int defaultY;
	private int lastX;
	private int lastY;
	private int lastWidth = 40;
	private int lastHeight = 16;

	protected HudModule(String id, String name, String description, boolean defaultEnabled, int defaultX, int defaultY) {
		super(id, name, description, defaultEnabled, defaultX, defaultY);
		this.defaultX = defaultX;
		this.defaultY = defaultY;
	}

	/** Position, an der das Element zuletzt tatsächlich gezeichnet wurde (auf den Bildschirm begrenzt). */
	public int x() {
		return lastX;
	}

	public int y() {
		return lastY;
	}

	public int width() {
		return lastWidth;
	}

	public int height() {
		return lastHeight;
	}

	public void setPosition(int x, int y) {
		state.x = x;
		state.y = y;
		lastX = x;
		lastY = y;
	}

	public void resetPosition() {
		setPosition(defaultX, defaultY);
	}

	/** Größe des Elements (Untermenü "Größe"), 1 = normal */
	public float scale() {
		return (float) Math.clamp(option("scale", 1.0), MIN_SCALE, MAX_SCALE);
	}

	public static final double MIN_SCALE = 0.5;
	public static final double MAX_SCALE = 2.0;

	/** Größe setzen (auf 5 % gerundet); gespeichert wird mit {@link HeldixConfig#save()}. */
	public void setScale(double scale) {
		double snapped = Math.round(Math.clamp(scale, MIN_SCALE, MAX_SCALE) * 20) / 20.0;
		state.options.put("scale", String.valueOf(snapped));
	}

	/** Zeichnet das Element und merkt sich Position und Größe (für den HUD-Editor). */
	public final void extract(GuiGraphicsExtractor g, Minecraft mc) {
		extract(g, mc, false);
	}

	/**
	 * Zeichnet das Element im HUD-Editor: fehlen Spieldaten (z. B. im Hauptmenü ohne Welt),
	 * erscheint ein Platzhalter mit dem Namen, damit man es trotzdem anordnen kann.
	 */
	public final void extractPreview(GuiGraphicsExtractor g, Minecraft mc) {
		extract(g, mc, true);
	}

	private void extract(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
		lastX = Math.clamp(state.x, 0, Math.max(0, g.guiWidth() - lastWidth));
		lastY = Math.clamp(state.y, 0, Math.max(0, g.guiHeight() - lastHeight));
		float scale = scale();
		long size;
		if (scale == 1f) {
			size = drawSafely(g, mc, lastX, lastY, preview);
		} else {
			g.pose().pushMatrix();
			g.pose().translate(lastX, lastY);
			g.pose().scale(scale, scale);
			size = drawSafely(g, mc, 0, 0, preview);
			g.pose().popMatrix();
		}
		lastWidth = Math.round((int) (size >> 32) * scale);
		lastHeight = Math.round((int) size * scale);
	}

	private long drawSafely(GuiGraphicsExtractor g, Minecraft mc, int x, int y, boolean preview) {
		if (!preview) return draw(g, mc, x, y);
		long size;
		try {
			size = draw(g, mc, x, y);
		} catch (RuntimeException e) {
			size = 0;
		}
		if ((int) (size >> 32) <= 0 || (int) size <= 0) {
			size = drawLabelValue(g, mc.font, x, y, name(), "Vorschau", Theme.FAINT);
		}
		return size;
	}

	@Override
	public java.util.List<Setting> settings() {
		java.util.List<Setting> settings = super.settings();
		settings.add(slider("scale", "Größe", "Wie groß das Element im HUD ist", 0.5, 2.0, 0.1, 1.0, Setting::percent));
		settings.add(new Setting.Action("Position", "Zurück an die Standardstelle", "Zurücksetzen", () -> {
			resetPosition();
			HeldixConfig.save();
		}));
		return settings;
	}

	/**
	 * Zeichnet das Element an (x, y).
	 * @return Breite und Höhe, gepackt mit {@link #size(int, int)}
	 */
	protected abstract long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y);

	protected static long size(int width, int height) {
		return ((long) width << 32) | (height & 0xFFFFFFFFL);
	}

	/** Hintergrund im Heldix-Stil: dunkle Glasfläche mit blauem Streifen links. */
	protected static void background(GuiGraphicsExtractor g, int x, int y, int width, int height) {
		if (!HeldixConfig.get().hudBackground) return;
		Draw.rounded(g, x, y, width, height, Theme.HUD_BG);
		g.fill(x + 1, y, x + width - 1, y + 1, 0x26FFFFFF);
		g.fill(x, y + 2, x + BAR, y + height - 2, Theme.ACCENT);
	}

	/** Standard-Darstellung: "Label Wert" in einer kleinen Box. */
	public static long drawLabelValue(GuiGraphicsExtractor g, Font font, int x, int y, String label, String value) {
		return drawLabelValue(g, font, x, y, label, value, Theme.TEXT);
	}

	/** Wie {@link #drawLabelValue(GuiGraphicsExtractor, Font, int, int, String, String)}, mit eigener Farbe für den Wert. */
	public static long drawLabelValue(GuiGraphicsExtractor g, Font font, int x, int y, String label, String value, int valueColor) {
		int labelWidth = font.width(label);
		int width = BAR + PADDING * 2 + labelWidth + 5 + font.width(value);
		int height = PADDING * 2 + font.lineHeight - 1;
		background(g, x, y, width, height);
		int textX = x + BAR + PADDING;
		g.text(font, label, textX, y + PADDING, Theme.ACCENT_LIGHT, true);
		g.text(font, value, textX + labelWidth + 5, y + PADDING, valueColor, true);
		return size(width, height);
	}

	/** Mehrzeilige Box: jede Zeile {label, wert}, Werte bündig untereinander. */
	public static long drawLabelValues(GuiGraphicsExtractor g, Font font, int x, int y, String[][] rows) {
		int labelWidth = 0;
		int valueWidth = 0;
		for (String[] row : rows) {
			labelWidth = Math.max(labelWidth, font.width(row[0]));
			valueWidth = Math.max(valueWidth, font.width(row[1]));
		}
		int lineHeight = font.lineHeight + 2;
		int width = BAR + PADDING * 2 + labelWidth + 6 + valueWidth;
		int height = PADDING * 2 + rows.length * lineHeight - 3;
		background(g, x, y, width, height);
		int textX = x + BAR + PADDING;
		int lineY = y + PADDING;
		for (String[] row : rows) {
			g.text(font, row[0], textX, lineY, Theme.ACCENT_LIGHT, true);
			g.text(font, row[1], textX + labelWidth + 6, lineY, Theme.TEXT, true);
			lineY += lineHeight;
		}
		return size(width, height);
	}
}
