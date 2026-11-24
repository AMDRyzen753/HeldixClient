package dev.heldixclient.addon;

import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.nio.file.Path;

/** HudCanvas für Addons: zeichnet relativ zur Position des HUD-Elements und merkt sich die belegte Größe. */
final class AddonCanvas implements HudCanvas {
	private final GuiGraphicsExtractor g;
	private final Font font;
	private final int originX;
	private final int originY;
	private final boolean preview;
	private int width;
	private int height;

	AddonCanvas(GuiGraphicsExtractor g, Font font, int originX, int originY, boolean preview) {
		this.g = g;
		this.font = font;
		this.originX = originX;
		this.originY = originY;
		this.preview = preview;
	}

	int width() {
		return width;
	}

	int height() {
		return height;
	}

	private void grow(float right, float bottom) {
		width = Math.max(width, (int) Math.ceil(right));
		height = Math.max(height, (int) Math.ceil(bottom));
	}

	private static Ui.Font uiFont(TextStyle style) {
		return switch (style) {
			case SMALL -> Ui.Font.SMALL;
			case BOLD -> Ui.Font.LABEL;
			case TITLE -> Ui.Font.TITLE;
			default -> Ui.Font.BODY;
		};
	}

	@Override
	public int textWidth(String text) {
		return font.width(text);
	}

	@Override
	public int lineHeight() {
		return font.lineHeight;
	}

	@Override
	public void text(String text, int x, int y, int color) {
		g.text(font, text, originX + x, originY + y, color, true);
		grow(x + font.width(text), y + font.lineHeight);
	}

	@Override
	public void rect(int x, int y, int width, int height, int color) {
		g.fill(originX + x, originY + y, originX + x + width, originY + y + height, color);
		grow(x + width, y + height);
	}

	@Override
	public void labelValue(String label, String value) {
		long size = HudModule.drawLabelValue(g, font, originX, originY, label, value);
		grow((int) (size >> 32), (int) size);
	}

	@Override
	public void labelValues(String[][] rows) {
		long size = HudModule.drawLabelValues(g, font, originX, originY, rows);
		grow((int) (size >> 32), (int) size);
	}

	@Override
	public int screenWidth() {
		return g.guiWidth();
	}

	@Override
	public int screenHeight() {
		return g.guiHeight();
	}

	// --- API 2 ------------------------------------------------------------------------------

	@Override
	public int textWidth(String text, TextStyle style) {
		if (text == null || text.isEmpty()) return 0;
		if (style == null || style == TextStyle.MINECRAFT) return font.width(text);
		return Ui.width(text, uiFont(style));
	}

	@Override
	public void text(String text, int x, int y, int color, TextStyle style) {
		if (text == null || text.isEmpty()) return;
		if (style == null || style == TextStyle.MINECRAFT) {
			text(text, x, y, color);
			return;
		}
		Ui.text(g, text, originX + x, originY + y, color, uiFont(style));
		grow(x + Ui.width(text, uiFont(style)), y + style.height);
	}

	@Override
	public String ellipsize(String text, int maxWidth, TextStyle style) {
		if (text == null) return "";
		if (style == null || style == TextStyle.MINECRAFT) {
			if (font.width(text) <= maxWidth) return text;
			String dots = "…";
			int end = text.length();
			while (end > 0 && font.width(text.substring(0, end)) + font.width(dots) > maxWidth) end--;
			return text.substring(0, end).stripTrailing() + dots;
		}
		return Ui.ellipsize(text, maxWidth, uiFont(style));
	}

	@Override
	public void roundedRect(float x, float y, float width, float height, float radius, int color) {
		Ui.rect(g, originX + x, originY + y, width, height, radius, color);
		grow(x + width, y + height);
	}

	@Override
	public void roundedOutline(float x, float y, float width, float height, float radius, int color) {
		Ui.outline(g, originX + x, originY + y, width, height, radius, color);
		grow(x + width, y + height);
	}

	@Override
	public boolean image(Path png, int x, int y, int width, int height) {
		grow(x + width, y + height);
		return Ui.image(g, png, originX + x, originY + y, width, height, 1f);
	}

	@Override
	public void icon(String name, int x, int y, int size, int color) {
		if (name == null || !Ui.hasIcon(name)) return;
		Ui.icon(g, name, originX + x, originY + y, size, color);
		grow(x + size, y + size);
	}

	@Override
	public boolean isPreview() {
		return preview;
	}
}
