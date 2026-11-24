package dev.heldixclient.screen;

import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

import java.util.function.Supplier;

/** Zeile „Zuletzt gespielt“ auf der Startseite: Vorschaubild oder Icon, Name, Detail; Klick startet. */
public class RecentRow extends AbstractButton {
	/** Inhalt einer Zeile; image (optional) ist ein 64×64-Bild (Welt-Vorschau, Server-Icon) */
	public record Entry(String title, String detail, String icon, Identifier image, Runnable action) {
	}

	private final Supplier<Entry> entry;
	private float hover;

	public RecentRow(int x, int y, int width, int height, Supplier<Entry> entry) {
		super(x, y, width, height, Component.empty());
		this.entry = entry;
	}

	@Override
	public void onPress(InputWithModifiers input) {
		Entry now = entry.get();
		if (now != null) now.action().run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		Entry now = entry.get();
		active = now != null;
		if (now == null) return;
		setMessage(Component.literal(now.title()));
		boolean hovered = isHoveredOrFocused();
		hover += ((hovered ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		if (hover > 0.01f) Ui.rect(g, x, y, w, h, 8, Ui.withAlpha(Ui.SURFACE_HOVER, hover * alpha));

		int size = Math.min(24, h - 8);
		int ix = x + 6;
		int iy = y + (h - size) / 2;
		if (now.image() != null) {
			g.blit(RenderPipelines.GUI_TEXTURED, now.image(), ix, iy, 0, 0, size, size, 64, 64, 64, 64, Ui.withAlpha(0xFFFFFFFF, alpha));
			Ui.outline(g, ix, iy, size, size, 3, Ui.withAlpha(Ui.LINE_STRONG, alpha));
		} else {
			Ui.rect(g, ix, iy, size, size, 6, Ui.withAlpha(0x1AFFFFFF, alpha));
			Ui.icon(g, now.icon(), ix + (size - 12) / 2f, iy + (size - 12) / 2f, 12, Ui.withAlpha(Ui.MUTED, alpha));
		}

		int textX = ix + size + 9;
		int textW = w - (textX - x) - 20;
		Ui.text(g, Ui.ellipsize(now.title(), textW, Ui.Font.LABEL), textX, y + h / 2 - 10, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(now.detail(), textW, Ui.Font.SMALL), textX, y + h / 2 + 2, Ui.withAlpha(Ui.FAINT, alpha), Ui.Font.SMALL);
		if (hover > 0.01f) {
			Ui.icon(g, "play", x + w - 16, y + (h - 9) / 2f, 9, Ui.withAlpha(Ui.ACCENT_TEXT, hover * alpha));
		}
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
