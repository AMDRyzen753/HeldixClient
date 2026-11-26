package dev.heldixclient.screen;

import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.client.sounds.SoundManager;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;

/**
 * Eintrag der Navigation oben: ein Bereich in der oberen Leiste (Icon und Name, aktiv als blaue Pille) oder eine Seite
 * in der Leiste darunter (Icon, Name und ggf. eine Zahl; aktiv hell mit blauem Strich, den {@link ShellScreen}
 * zeichnet, damit er beim Wechsel hinübergleiten kann). In schmalen Fenstern nur das Icon (mit Tooltip).
 */
public class ShellNavButton extends AbstractButton {
	public enum Kind {
		CATEGORY,
		PAGE
	}

	private static final int ICON = 10;

	private final Kind kind;
	private final Shell.Section section;
	/** Ziel des Klicks (beim Bereich: dessen zuletzt offene Seite) */
	private final Shell.Page page;
	private final boolean selected;
	private final boolean showIcon;
	private final boolean showLabel;
	private final Runnable action;
	private float hover;

	private ShellNavButton(Kind kind, int x, int y, int width, int height, Shell.Section section, Shell.Page page, boolean selected,
			boolean showIcon, boolean showLabel, Runnable action) {
		super(x, y, width, height, Component.literal(kind == Kind.CATEGORY ? section.label : page.title()));
		this.kind = kind;
		this.section = section;
		this.page = page;
		this.selected = selected;
		this.showIcon = showIcon;
		this.showLabel = showLabel;
		this.action = action;
	}

	/** Bereich in der oberen Leiste ({@code labels} = mit Namen, sonst nur Icon) */
	public static ShellNavButton category(int x, int y, int width, int height, Shell.Section section, Shell.Page target, boolean selected,
			boolean labels, Runnable action) {
		return new ShellNavButton(Kind.CATEGORY, x, y, width, height, section, target, selected, true, labels, action);
	}

	/** Seite in der Leiste darunter */
	public static ShellNavButton page(int x, int y, int width, int height, Shell.Page page, boolean selected, boolean icons, Runnable action) {
		return new ShellNavButton(Kind.PAGE, x, y, width, height, page.section, page, selected, icons, true, action);
	}

	/** Breite eines Bereichs */
	public static int categoryWidth(Shell.Section section, boolean label) {
		return label ? Ui.width(section.label, Ui.Font.LABEL) + ICON + 5 + 18 : ICON + 14;
	}

	/** Breite einer Seite: Name, Icon und Zahl */
	public static int pageWidth(Shell.Page page, boolean icon, int padding) {
		int w = Ui.width(page.title(), Ui.Font.LABEL) + padding * 2;
		if (icon) w += ICON + 5;
		String badge = Shell.badge(page);
		if (badge != null) w += badgeWidth(badge) + 5;
		return w;
	}

	private static int badgeWidth(String badge) {
		return Math.max(13, Ui.width(badge, Ui.Font.SMALL) + 8);
	}

	public Kind kind() {
		return kind;
	}

	public Shell.Section section() {
		return section;
	}

	/** Ziel des Klicks */
	public Shell.Page page() {
		return page;
	}

	public boolean selected() {
		return selected;
	}

	/** wie ein Klick (Strg+Tab) */
	public void activate() {
		if (!selected) action.run();
	}

	@Override
	public void onPress(InputWithModifiers input) {
		if (!selected) action.run();
	}

	@Override
	public void playDownSound(SoundManager soundManager) {
		soundManager.play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		boolean hovered = active && isHoveredOrFocused();
		hover += ((hovered && !selected ? 1f : 0f) - hover) * 0.35f;
		if (kind == Kind.CATEGORY) drawCategory(g, mouseX, mouseY, hovered);
		else drawPage(g, mouseX, mouseY, hovered);
		if (Ui.keyboardFocus(isFocused())) Ui.focusRing(g, getX(), getY(), getWidth(), getHeight(), 7, alpha);
	}

	private void drawCategory(GuiGraphicsExtractor g, int mouseX, int mouseY, boolean hovered) {
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		float r = h / 2f;
		if (selected) {
			Ui.rect(g, x, y, w, h, r, Ui.withAlpha(Ui.ACCENT_SOFT, alpha));
			Ui.outline(g, x, y, w, h, r, Ui.withAlpha(0x403B82F6, alpha));
		} else if (hover > 0.01f) {
			Ui.rect(g, x, y, w, h, r, Ui.withAlpha(Ui.SURFACE_HOVER, hover * alpha));
		}
		int color = selected ? Ui.TEXT : Ui.lerp(Ui.MUTED, Ui.TEXT, hover);
		int iconColor = selected ? Ui.ACCENT_TEXT : color;
		String badge = Shell.badge(section, Minecraft.getInstance().level != null);
		float iy = y + (h - ICON) / 2f;
		if (!showLabel) {
			float ix = x + (w - ICON) / 2f;
			Ui.icon(g, section.icon, ix, iy, ICON, Ui.withAlpha(iconColor, alpha));
			if (badge != null) Ui.circle(g, ix + ICON, iy, 2.5f, Ui.withAlpha(Ui.ACCENT, alpha));
			if (isHovered()) Ui.requestTooltip(section.label + (badge != null ? " (" + badge + ")" : ""), mouseX, mouseY);
			return;
		}
		int ix = x + 9;
		Ui.icon(g, section.icon, ix, iy, ICON, Ui.withAlpha(iconColor, alpha));
		Ui.text(g, section.label, ix + ICON + 5, y + (h - 8) / 2, Ui.withAlpha(color, alpha), Ui.Font.LABEL);
		// Hinweis auf Neues im Bereich (z. B. Anfragen): kleiner Punkt am Icon
		if (badge != null) {
			Ui.circle(g, ix + ICON, iy, 3, Ui.withAlpha(0xFF0F1420, alpha));
			Ui.circle(g, ix + ICON, iy, 2.2f, Ui.withAlpha(Ui.ACCENT, alpha));
		}
	}

	private void drawPage(GuiGraphicsExtractor g, int mouseX, int mouseY, boolean hovered) {
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		boolean danger = page == Shell.Page.QUIT;
		if (hover > 0.01f) Ui.rect(g, x + 1, y + 2, w - 2, h - 5, 6, Ui.withAlpha(Ui.SURFACE_HOVER, hover * alpha));
		int color = selected ? Ui.TEXT : hovered ? (danger ? Ui.DANGER : Ui.TEXT) : Ui.MUTED;
		int iconColor = selected ? Ui.ACCENT_TEXT : color;
		String label = page.title();
		String badge = Shell.badge(page);
		int content = Ui.width(label, Ui.Font.LABEL) + (showIcon ? ICON + 5 : 0) + (badge != null ? badgeWidth(badge) + 5 : 0);
		int cx = x + Math.max(4, (w - content) / 2);
		int textY = y + (h - 8) / 2 - 1;
		if (showIcon) {
			Ui.icon(g, page.icon, cx, textY - 1, ICON, Ui.withAlpha(iconColor, alpha));
			cx += ICON + 5;
		}
		int room = x + w - cx - (badge != null ? badgeWidth(badge) + 9 : 4);
		String shown = Ui.ellipsize(label, room, Ui.Font.LABEL);
		Ui.text(g, shown, cx, textY, Ui.withAlpha(color, alpha), Ui.Font.LABEL);
		cx += Ui.width(shown, Ui.Font.LABEL) + 5;
		if (badge != null) {
			int bw = badgeWidth(badge);
			Ui.rect(g, cx, textY - 1, bw, 11, 5.5f, Ui.withAlpha(Ui.ACCENT, alpha));
			Ui.textCentered(g, badge, cx + bw / 2, textY + 1, Ui.withAlpha(0xFFFFFFFF, alpha), Ui.Font.SMALL);
		}
		if (!shown.equals(label) && isHovered()) Ui.requestTooltip(label, mouseX, mouseY);
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
