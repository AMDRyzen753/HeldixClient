package dev.heldixclient.screen;

import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

/**
 * Knopf im Heldix-Design: blau (primär), Fläche (sekundär), nur Text (dezent) oder rot (gefährlich),
 * wahlweise mit Icon oder nur als Icon mit Tooltip.
 */
public class ActionButton extends AbstractButton {
	public enum Variant {
		PRIMARY,
		SECONDARY,
		GHOST,
		DANGER,
		/** dunkle, deckende Fläche (über Hintergrundbildern) */
		SOLID
	}

	private Variant variant;
	/** Variante ohne Hervorhebung (für setPrimary(false)) */
	private Variant base;
	private final Runnable action;
	private String icon;
	private String tooltip;
	private float hover;

	public ActionButton(int x, int y, int width, int height, String label, boolean primary, Runnable action) {
		super(x, y, width, height, Component.literal(label));
		this.variant = primary ? Variant.PRIMARY : Variant.SECONDARY;
		this.base = variant;
		this.action = action;
	}

	/** Knopf nur mit Icon; der Text erscheint als Tooltip (und für die Bildschirmausgabe). */
	public static ActionButton icon(int x, int y, int size, String icon, String label, Runnable action) {
		ActionButton button = new ActionButton(x, y, size, size, label, false, action);
		button.icon = icon;
		button.tooltip = label;
		button.variant = Variant.GHOST;
		button.base = Variant.GHOST;
		return button;
	}

	/** Breite passend zum Text */
	public static int widthFor(String label) {
		return Ui.width(label, Ui.Font.LABEL) + 20;
	}

	/** Breite passend zu Icon und Text */
	public static int widthFor(String label, String icon) {
		return widthFor(label) + (icon != null ? 14 : 0);
	}

	public ActionButton withIcon(String icon) {
		this.icon = icon;
		return this;
	}

	public ActionButton withVariant(Variant variant) {
		this.variant = variant;
		this.base = variant;
		return this;
	}

	public ActionButton withTooltip(String tooltip) {
		this.tooltip = tooltip;
		return this;
	}

	/** Blau hervorheben (z. B. für eingeschaltete Optionen) */
	public void setPrimary(boolean primary) {
		variant = primary ? Variant.PRIMARY : base;
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
		float r = Math.min(7, h / 2f);

		int fill;
		int text;
		int border = 0;
		if (!active) {
			fill = 0x0AFFFFFF;
			text = Ui.FAINT;
		} else {
			switch (variant) {
				case PRIMARY -> {
					fill = Ui.lerp(Ui.ACCENT, Ui.ACCENT_HOVER, hover);
					text = 0xFFFFFFFF;
				}
				case DANGER -> {
					fill = Ui.lerp(0x24F87171, 0x40F87171, hover);
					text = 0xFFFCA5A5;
				}
				case SOLID -> {
					fill = Ui.lerp(0xD90F1420, 0xE61A2233, hover);
					text = Ui.lerp(0xFFD5DCE8, Ui.TEXT, hover);
					border = Ui.LINE_STRONG;
				}
				case GHOST -> {
					fill = Ui.withAlpha(Ui.SURFACE_HOVER, hover);
					text = Ui.lerp(Ui.MUTED, Ui.TEXT, hover);
				}
				default -> {
					fill = Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, hover);
					text = Ui.lerp(0xFFD5DCE8, Ui.TEXT, hover);
					border = Ui.LINE;
				}
			}
		}
		Ui.rect(g, x, y, w, h, r, Ui.withAlpha(fill, alpha));
		if (border != 0) Ui.outline(g, x, y, w, h, r, Ui.withAlpha(border, alpha));

		String label = getMessage().getString();
		boolean iconOnly = icon != null && tooltip != null && tooltip.equals(label);
		int iconSize = h >= 18 ? 11 : 10;
		if (iconOnly) {
			Ui.icon(g, icon, x + (w - iconSize) / 2f, y + (h - iconSize) / 2f, iconSize, Ui.withAlpha(text, alpha));
		} else {
			int textW = Ui.width(label, Ui.Font.LABEL);
			int contentW = textW + (icon != null ? iconSize + 5 : 0);
			int cx = x + (w - contentW) / 2;
			if (icon != null) {
				Ui.icon(g, icon, cx, y + (h - iconSize) / 2f, iconSize, Ui.withAlpha(text, alpha));
				cx += iconSize + 5;
			}
			Ui.text(g, Ui.ellipsize(label, w - 8, Ui.Font.LABEL), cx, y + (h - 8) / 2, Ui.withAlpha(text, alpha), Ui.Font.LABEL);
		}
		if (tooltip != null && isHovered()) Ui.requestTooltip(tooltip, mouseX, mouseY);
		if (Ui.keyboardFocus(isFocused())) Ui.focusRing(g, x, y, w, h, r, alpha);
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
