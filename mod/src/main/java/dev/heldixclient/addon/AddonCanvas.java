package dev.heldixclient.addon;

import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.module.HudModule;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** HudCanvas für Addons: zeichnet relativ zur Position des HUD-Elements und merkt sich die belegte Größe. */
final class AddonCanvas implements HudCanvas {
	private final GuiGraphicsExtractor g;
	private final Font font;
	private final int originX;
	private final int originY;
	private int width;
	private int height;

	AddonCanvas(GuiGraphicsExtractor g, Font font, int originX, int originY) {
		this.g = g;
		this.font = font;
		this.originX = originX;
		this.originY = originY;
	}

	int width() {
		return width;
	}

	int height() {
		return height;
	}

	private void grow(int right, int bottom) {
		width = Math.max(width, right);
		height = Math.max(height, bottom);
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
}
