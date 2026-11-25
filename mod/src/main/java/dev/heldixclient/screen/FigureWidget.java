package dev.heldixclient.screen;

import dev.heldixclient.cosmetic.Capes;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

/**
 * Die eigene Spielfigur mit Heldix-Cape, langsam drehend, auf einem leuchtenden Podest (wie im Launcher).
 * Klick öffnet die Cape-Auswahl.
 */
public class FigureWidget extends AbstractButton {
	private final Runnable action;
	private final long start = System.nanoTime();
	private float hover;

	public FigureWidget(int x, int y, int width, int height, Runnable action) {
		super(x, y, width, height, Component.literal("Cape ändern"));
		this.action = action;
	}

	@Override
	public void onPress(InputWithModifiers input) {
		action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		hover += ((isHoveredOrFocused() ? 1f : 0f) - hover) * 0.3f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		float seconds = (System.nanoTime() - start) / 1_000_000_000f;

		// Podest: weiches Leuchten unter den Füßen
		int podW = Math.round(w * 0.9f);
		int podX = x + (w - podW) / 2;
		int podY = y + h - 7;
		Ui.rect(g, podX, podY, podW, 8, 4, Ui.withAlpha(0x3D3B82F6, alpha * (0.8f + 0.2f * hover)));
		Ui.rect(g, podX + podW / 6f, podY + 2, podW * 2 / 3f, 4, 2, Ui.withAlpha(0x5C60A5FA, alpha));

		if (alpha > 0.05f) {
			Capes.drawShowcase(g, Shell.skin(Minecraft.getInstance()).get(), Capes.selected(), x, y, x + w, y + h - 3, seconds);
		}
		if (hover > 0.05f) {
			String label = "Cape ändern";
			int lw = Ui.width(label, Ui.Font.SMALL) + 12;
			int lx = x + (w - lw) / 2;
			Ui.rect(g, lx, y - 15, lw, 13, 6, Ui.withAlpha(0xE60F1420, hover * alpha));
			Ui.text(g, label, lx + 6, y - 12, Ui.withAlpha(Ui.ACCENT_TEXT, hover * alpha), Ui.Font.SMALL);
		}
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
