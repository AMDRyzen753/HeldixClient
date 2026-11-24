package dev.heldixclient.screen;

import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

/** Navigationseintrag im Hauptmenü: Text linksbündig, beim Hovern blauer Streifen und Glas-Hintergrund. */
public class HeldixNavButton extends AbstractButton {
	private static final int DANGER = 0xFFFB7185;

	private final Runnable action;
	private final boolean danger;
	private float hover;

	public HeldixNavButton(int x, int y, int width, int height, Component label, boolean danger, Runnable action) {
		super(x, y, width, height, label);
		this.action = action;
		this.danger = danger;
	}

	@Override
	public void onPress(InputWithModifiers input) {
		action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		boolean hovered = active && isHoveredOrFocused();
		hover += ((hovered ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();

		if (hover > 0.01f) {
			Draw.rounded2(g, x, y, w, h, Draw.withAlpha(0x30FFFFFF, hover * alpha));
			g.fill(x + 3, y + 1, x + w - 3, y + 2, Draw.withAlpha(Theme.HIGHLIGHT, hover * alpha));
			g.fill(x, y + 4, x + 2, y + h - 4, Draw.withAlpha(danger ? DANGER : Theme.ACCENT, hover * alpha));
		}

		int color;
		if (!active) color = Theme.FAINT;
		else if (hovered) color = danger ? DANGER : Theme.TEXT;
		else color = 0xFFD6E4F5;
		int textX = x + 10 + Math.round(hover * 4);
		g.text(Minecraft.getInstance().font, getMessage(), textX, y + (h - 8) / 2, Draw.withAlpha(color, alpha), false);

		if (hover > 0.01f) {
			String arrow = "›";
			g.text(Minecraft.getInstance().font, arrow, x + w - 12, y + (h - 8) / 2, Draw.withAlpha(Theme.ACCENT_LIGHT, hover * alpha), false);
		}
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
