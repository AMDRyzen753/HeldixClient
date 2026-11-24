package dev.heldixclient.module.impl;

import dev.heldixclient.module.Setting;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

public class KeystrokesModule extends HudModule {
	private static final int KEY = 22;
	private static final int GAP = 2;

	public KeystrokesModule() {
		super("keystrokes", "Keystrokes", "Tasten live anzeigen", false, 4, 100);
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		Options o = mc.options;
		Font font = mc.font;
		int full = KEY * 3 + GAP * 2;
		int half = (full - GAP) / 2;

		key(g, font, o.keyUp, x + KEY + GAP, y, KEY, KEY);
		int row2 = y + KEY + GAP;
		key(g, font, o.keyLeft, x, row2, KEY, KEY);
		key(g, font, o.keyDown, x + KEY + GAP, row2, KEY, KEY);
		key(g, font, o.keyRight, x + (KEY + GAP) * 2, row2, KEY, KEY);
		int bottom = row2 + KEY;
		boolean showCps = option("cps", true);
		if (option("mouse", true)) {
			int row3 = bottom + GAP;
			mouse(g, font, "LMB", CpsModule.left(), o.keyAttack.isDown(), x, row3, half, KEY, showCps);
			mouse(g, font, "RMB", CpsModule.right(), o.keyUse.isDown(), x + half + GAP, row3, full - half - GAP, KEY, showCps);
			bottom = row3 + KEY;
		}
		if (option("space", true)) {
			int row4 = bottom + GAP;
			boolean jump = o.keyJump.isDown();
			box(g, x, row4, full, 10, jump);
			int barWidth = full / 3;
			g.fill(x + (full - barWidth) / 2, row4 + 4, x + (full + barWidth) / 2, row4 + 6, jump ? Theme.TEXT : Theme.ACCENT_LIGHT);
			bottom = row4 + 10;
		}
		return size(full, bottom - y);
	}

	private static void key(GuiGraphicsExtractor g, Font font, KeyMapping mapping, int x, int y, int w, int h) {
		String label = mapping.getTranslatedKeyMessage().getString();
		if (label.length() > 3) label = label.substring(0, 3);
		boolean pressed = mapping.isDown();
		box(g, x, y, w, h, pressed);
		g.text(font, label, x + (w - font.width(label)) / 2, y + (h - 8) / 2, Theme.TEXT, !pressed);
	}

	@Override
	public java.util.List<Setting> settings() {
		java.util.List<Setting> settings = super.settings();
		settings.add(0, toggle("mouse", "Maustasten", "Linke und rechte Maustaste zeigen", true));
		settings.add(1, toggle("cps", "CPS bei den Maustasten", "Klicks pro Sekunde klein unter LMB/RMB", true));
		settings.add(2, toggle("space", "Leertaste", "Sprung-Taste als Balken zeigen", true));
		return settings;
	}

	private static void mouse(GuiGraphicsExtractor g, Font font, String label, int cps, boolean pressed, int x, int y, int w, int h, boolean showCps) {
		box(g, x, y, w, h, pressed);
		if (!showCps) {
			g.text(font, label, x + (w - font.width(label)) / 2, y + (h - 8) / 2, Theme.TEXT, !pressed);
			return;
		}
		String cpsText = cps + " CPS";
		g.text(font, label, x + (w - font.width(label)) / 2, y + 3, Theme.TEXT, !pressed);
		// halbe Schriftgröße für die CPS-Zeile
		g.pose().pushMatrix();
		g.pose().translate(x + w / 2f, y + 14);
		g.pose().scale(0.5f, 0.5f);
		g.text(font, cpsText, -font.width(cpsText) / 2, 0, pressed ? Theme.TEXT : Theme.MUTED, false);
		g.pose().popMatrix();
	}

	private static void box(GuiGraphicsExtractor g, int x, int y, int w, int h, boolean pressed) {
		if (pressed) {
			Draw.rounded(g, x, y, w, h, Theme.ACCENT);
			g.fill(x + 1, y, x + w - 1, y + 1, 0x50FFFFFF);
		} else if (HeldixConfig.get().hudBackground) {
			Draw.rounded(g, x, y, w, h, Theme.HUD_BG);
		}
	}
}
