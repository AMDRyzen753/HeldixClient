package dev.heldixclient.screen;

import dev.heldixclient.cosmetic.Capes;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Tips;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.ui.WidgetStyle;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.util.FormattedCharSequence;

import java.util.List;

/**
 * Tipp-Karte unten auf den Ladebildschirmen (Welt laden, mit Server verbinden): die eigene Spielfigur mit Cape
 * und ein Tipp zu HeldixClient, der alle paar Sekunden wechselt. Nur mit dem Heldix-Design.
 */
public final class LoadingTips {
	private static final long START = System.nanoTime();

	private LoadingTips() {
	}

	/** Hook: am Ende von LevelLoadingScreen/ConnectScreen.extractRenderState */
	public static void draw(Screen screen, GuiGraphicsExtractor g) {
		if (!WidgetStyle.enabled()) return;
		Minecraft mc = Minecraft.getInstance();
		int w = g.guiWidth();
		int h = g.guiHeight();
		if (w < 240 || h < 170) return;
		Tips.Tip tip = Tips.rotating(7);
		int cardW = Math.min(440, w - 24);
		boolean figure = h >= 230;
		int figW = figure ? 46 : 0;
		int textX0 = 14 + (figure ? figW + 6 : 0);
		List<FormattedCharSequence> lines = Ui.wrap(tip.text(), cardW - textX0 - 14, Ui.Font.BODY);
		if (lines.size() > 2) lines = lines.subList(0, 2);
		int cardH = 30 + lines.size() * 11;
		int x = (w - cardW) / 2;
		int y = h - cardH - 14;

		Ui.shadow(g, x, y, cardW, cardH, 0.35f);
		Ui.rect(g, x, y, cardW, cardH, 12, 0xE00F1420);
		Ui.outline(g, x, y, cardW, cardH, 12, Ui.LINE_STRONG);
		if (figure) {
			float seconds = (System.nanoTime() - START) / 1_000_000_000f;
			Ui.rect(g, x + 10, y + cardH - 10, figW - 4, 6, 3, 0x3D3B82F6);
			Capes.drawShowcase(g, Shell.skin(mc).get(), Capes.selected(), x + 8, y - 40, x + 8 + figW, y + cardH - 6, seconds);
		}
		int tx = x + textX0;
		Ui.rect(g, tx, y + 9, 14, 14, 4, Ui.ACCENT_SOFT);
		Ui.icon(g, tip.icon(), tx + 2.5f, y + 11.5f, 9, Ui.ACCENT_TEXT);
		Ui.text(g, "TIPP", tx + 20, y + 13, Ui.ACCENT_TEXT, Ui.Font.SMALL);
		int ly = y + 27;
		for (FormattedCharSequence line : lines) {
			g.text(mc.font, line, tx, ly, Ui.TEXT, false);
			ly += 11;
		}
	}
}
