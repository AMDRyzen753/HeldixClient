package dev.heldixclient.screen;

import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

/**
 * Eintrag der Seitenleiste (eine Ober-Kategorie): Icon, Name und ggf. eine Zahl (z. B. offene Anfragen);
 * aktiv mit blauer Fläche, beim Hovern hell. Schmal nur das Icon (mit Tooltip).
 */
public class ShellNavButton extends AbstractButton {
	private final Shell.Page page;
	private final boolean selected;
	private final boolean compact;
	private final Runnable action;
	private float hover;

	public ShellNavButton(int x, int y, int width, int height, Shell.Page page, boolean selected, boolean compact, Runnable action) {
		super(x, y, width, height, Component.literal(page.title()));
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
		String label = page.title();
		String badge = Shell.badge(page);
		if (compact) {
			Ui.icon(g, page.icon, x + (w - iconSize) / 2f, iy, iconSize, Ui.withAlpha(iconColor, alpha));
			if (badge != null) Ui.circle(g, x + (w + iconSize) / 2f, iy, 2.5f, Ui.withAlpha(Ui.ACCENT, alpha));
			if (hovered && isHovered()) Ui.requestTooltip(label + (badge != null ? " (" + badge + ")" : ""), mouseX, mouseY);
			return;
		}
		Ui.icon(g, page.icon, x + 8, iy, iconSize, Ui.withAlpha(iconColor, alpha));
		int textX = x + 9 + iconSize + 7;
		int badgeW = badge == null ? 0 : Math.max(14, Ui.width(badge, Ui.Font.SMALL) + 8);
		Ui.text(g, Ui.ellipsize(label, x + w - textX - (badgeW > 0 ? badgeW + 8 : 4), Ui.Font.BODY), textX, y + (h - 8) / 2, Ui.withAlpha(color, alpha), Ui.Font.BODY);
		if (badge != null) {
			int bx = x + w - 6 - badgeW;
			int bh = 11;
			int by = y + (h - bh) / 2;
			Ui.rect(g, bx, by, badgeW, bh, bh / 2f, Ui.withAlpha(Ui.ACCENT, alpha));
			Ui.textCentered(g, badge, bx + badgeW / 2, by + 2, Ui.withAlpha(0xFFFFFFFF, alpha), Ui.Font.SMALL);
		}
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
