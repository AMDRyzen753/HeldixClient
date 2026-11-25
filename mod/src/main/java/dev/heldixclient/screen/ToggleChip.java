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

import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Kleiner Schalter mit Icon und Name, z. B. um ein Modul im Pausemenü an- und auszuschalten. */
public class ToggleChip extends AbstractButton {
	private final String icon;
	private final BooleanSupplier get;
	private final Consumer<Boolean> set;
	private float hover;
	private float on = -1;

	public ToggleChip(int x, int y, int width, int height, String label, String icon, BooleanSupplier get, Consumer<Boolean> set) {
		super(x, y, width, height, Component.literal(label));
		this.icon = icon;
		this.get = get;
		this.set = set;
	}

	@Override
	public void onPress(InputWithModifiers input) {
		set.accept(!get.getAsBoolean());
	}

	@Override
	public void playDownSound(SoundManager soundManager) {
		soundManager.play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		boolean enabled = get.getAsBoolean();
		if (on < 0) on = enabled ? 1 : 0;
		on += ((enabled ? 1f : 0f) - on) * 0.3f;
		hover += ((isHoveredOrFocused() ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		if (w < 56) {
			// kompakt: nur Icon, an = blau hinterlegt; Name und Zustand als Tooltip
			Ui.rect(g, x, y, w, h, 8, Ui.withAlpha(Ui.lerp(Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, hover), 0x593B82F6, on), alpha));
			Ui.outline(g, x, y, w, h, 8, Ui.withAlpha(Ui.lerp(Ui.LINE, Ui.ACCENT_LINE, on), alpha));
			Ui.icon(g, icon, x + (w - 10) / 2f, y + (h - 10) / 2f, 10, Ui.withAlpha(Ui.lerp(Ui.FAINT, 0xFFFFFFFF, on), alpha));
			if (isHovered()) Ui.requestTooltip(getMessage().getString() + (enabled ? ": an" : ": aus"), mouseX, mouseY);
			return;
		}
		Ui.rect(g, x, y, w, h, 8, Ui.withAlpha(Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, hover), alpha));
		Ui.outline(g, x, y, w, h, 8, Ui.withAlpha(Ui.lerp(Ui.LINE, Ui.ACCENT_LINE, on * 0.7f), alpha));
		Ui.icon(g, icon, x + 8, y + (h - 10) / 2f, 10, Ui.withAlpha(Ui.lerp(Ui.FAINT, Ui.ACCENT_TEXT, on), alpha));
		String label = Ui.ellipsize(getMessage().getString(), w - 52, Ui.Font.LABEL);
		Ui.text(g, label, x + 24, y + (h - 8) / 2, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		Ui.toggle(g, x + w - 26, y + (h - 10) / 2f, on, alpha);
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		output.add(net.minecraft.client.gui.narration.NarratedElementType.TITLE,
				Component.literal(getMessage().getString() + (get.getAsBoolean() ? ": an" : ": aus")));
	}

	/** Für Tests */
	public boolean isOn() {
		return get.getAsBoolean();
	}
}
