package dev.heldixclient.screen;

import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.client.sounds.SoundManager;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;

/**
 * Reiter unter dem Seitenkopf (Unter-Menü einer Kategorie): Icon, Name und ggf. eine Zahl.
 * Den blauen Strich unter dem aktiven Reiter zeichnet {@link ShellScreen}, damit er beim Wechsel hinübergleiten kann.
 */
public class ShellTab extends AbstractButton {
	/** Anzeige eines Reiters; {@code badge} und {@code selected} werden jedes Bild neu abgefragt */
	public record Spec(String id, String label, String icon, java.util.function.Supplier<String> badge, boolean alert,
			java.util.function.BooleanSupplier selected, Runnable action) {
	}

	static final int ICON = 10;

	private final Spec spec;
	private final boolean showIcon;
	private float hover;

	public ShellTab(int x, int y, int width, int height, Spec spec, boolean showIcon) {
		super(x, y, width, height, Component.literal(spec.label()));
		this.spec = spec;
		this.showIcon = showIcon && spec.icon() != null;
	}

	/** Breite für Name, Icon und Zahl */
	static int widthFor(Spec spec, boolean showIcon, int padding) {
		int w = Ui.width(spec.label(), Ui.Font.LABEL) + padding * 2;
		if (showIcon && spec.icon() != null) w += ICON + 5;
		String badge = spec.badge() == null ? null : spec.badge().get();
		if (badge != null) w += badgeWidth(badge) + 5;
		return w;
	}

	private static int badgeWidth(String badge) {
		return Math.max(13, Ui.width(badge, Ui.Font.SMALL) + 8);
	}

	public Spec spec() {
		return spec;
	}

	public String id() {
		return spec.id();
	}

	public boolean selected() {
		return spec.selected().getAsBoolean();
	}

	@Override
	public void onPress(InputWithModifiers input) {
		if (!selected()) spec.action().run();
	}

	@Override
	public void playDownSound(SoundManager soundManager) {
		soundManager.play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		boolean on = selected();
		hover += ((isHoveredOrFocused() && !on ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		if (hover > 0.01f) Ui.rect(g, x + 1, y + 2, w - 2, h - 6, 6, Ui.withAlpha(Ui.SURFACE_HOVER, hover * alpha));
		int color = on ? Ui.TEXT : Ui.lerp(Ui.MUTED, Ui.TEXT, hover);
		String badge = spec.badge() == null ? null : spec.badge().get();
		int content = Ui.width(spec.label(), Ui.Font.LABEL) + (showIcon ? ICON + 5 : 0) + (badge != null ? badgeWidth(badge) + 5 : 0);
		int cx = x + Math.max(4, (w - content) / 2);
		int textY = y + (h - 8) / 2 - 1;
		if (showIcon) {
			Ui.icon(g, spec.icon(), cx, textY - 1, ICON, Ui.withAlpha(on ? Ui.ACCENT_TEXT : color, alpha));
			cx += ICON + 5;
		}
		int room = x + w - cx - (badge != null ? badgeWidth(badge) + 9 : 4);
		String label = Ui.ellipsize(spec.label(), room, Ui.Font.LABEL);
		Ui.text(g, label, cx, textY, Ui.withAlpha(color, alpha), Ui.Font.LABEL);
		cx += Ui.width(label, Ui.Font.LABEL) + 5;
		if (badge != null) {
			int bw = badgeWidth(badge);
			int fill = spec.alert() ? Ui.ACCENT : on ? Ui.ACCENT_SOFT : Ui.SURFACE_STRONG;
			Ui.rect(g, cx, textY - 1, bw, 11, 5.5f, Ui.withAlpha(fill, alpha));
			Ui.textCentered(g, badge, cx + bw / 2, textY + 1, Ui.withAlpha(spec.alert() ? 0xFFFFFFFF : on ? Ui.ACCENT_TEXT : Ui.MUTED, alpha), Ui.Font.SMALL);
		}
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
