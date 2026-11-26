package dev.heldixclient.screen;

import dev.heldixclient.account.AccountSwitcher;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

/**
 * Unsichtbare Fläche über dem eigenen Profil (unten in der Seitenleiste, oben rechts auf der Startseite): Klick öffnet
 * die Konten. Aktiv nur, wenn der Launcher den Kontowechsel anbietet; beim Hovern leicht hervorgehoben.
 */
public class ProfileButton extends AbstractButton {
	private final float radius;
	private final Runnable action;
	private float hover;

	public ProfileButton(int x, int y, int width, int height, float radius, Runnable action) {
		super(x, y, width, height, Component.literal("Konto wechseln"));
		this.radius = radius;
		this.action = action;
	}

	@Override
	public void onPress(InputWithModifiers input) {
		if (AccountSwitcher.available()) action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// der Launcher kann den Wechsel jederzeit an- oder ausschalten
		active = AccountSwitcher.available();
		if (!active) {
			hover = 0;
			return;
		}
		boolean hovered = isHoveredOrFocused();
		hover += ((hovered ? 1f : 0f) - hover) * 0.35f;
		if (hover > 0.01f) {
			Ui.rect(g, getX(), getY(), getWidth(), getHeight(), radius, Ui.withAlpha(0x14FFFFFF, hover * alpha));
			Ui.outline(g, getX(), getY(), getWidth(), getHeight(), radius, Ui.withAlpha(Ui.LINE_STRONG, hover * alpha));
		}
		if (hovered && isHovered()) Ui.requestTooltip("Konto wechseln", mouseX, mouseY);
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
