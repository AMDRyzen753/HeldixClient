package dev.heldixclient.screen;

import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

/** Eintrag der Seitenleiste: Icon und Text; aktiv mit blauer Fläche, beim Hovern hell. Schmal nur das Icon (mit Tooltip). */
public class ShellNavButton extends AbstractButton {
	private final Shell.Page page;
	private final boolean selected;
	private final boolean compact;
	private final Runnable action;
	private float hover;

	public ShellNavButton(int x, int y, int width, int height, Shell.Page page, boolean selected, boolean compact, Runnable action) {
		super(x, y, width, height, Component.literal(page.label));
		this.page = page;
		this.selected = selected;
		this.compact = compact;
		this.action = action;
	}

	public Shell.Page page() {
		return page;
	}

	@Override
	public void onPress(InputWithModifiers input) {
		if (!selected) action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		boolean hovered = active && isHoveredOrFocused();
		hover += ((hovered ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		boolean danger = page == Shell.Page.QUIT;

		if (selected) {
			Ui.rect(g, x, y, w, h, 6, Ui.withAlpha(Ui.ACCENT_SOFT, alpha));
			Ui.rect(g, x, y + 3, 2, h - 6, 1, Ui.withAlpha(Ui.ACCENT, alpha));
		} else if (hover > 0.01f) {
			Ui.rect(g, x, y, w, h, 6, Ui.withAlpha(Ui.SURFACE_HOVER, hover * alpha));
		}

		int color;
		if (selected) color = Ui.TEXT;
		else if (hovered) color = danger ? Ui.DANGER : Ui.TEXT;
		else color = Ui.MUTED;
		int iconColor = selected ? Ui.ACCENT_TEXT : color;
		int iconSize = h >= 15 ? 11 : 10;
		float iy = y + (h - iconSize) / 2f;
		if (compact) {
			Ui.icon(g, page.icon, x + (w - iconSize) / 2f, iy, iconSize, Ui.withAlpha(iconColor, alpha));
			if (hovered && isHovered()) Ui.requestTooltip(page.label, mouseX, mouseY);
			return;
		}
		Ui.icon(g, page.icon, x + 8, iy, iconSize, Ui.withAlpha(iconColor, alpha));
		Ui.text(g, page.label, x + 9 + iconSize + 7, y + (h - 8) / 2, Ui.withAlpha(color, alpha), Ui.Font.BODY);
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
