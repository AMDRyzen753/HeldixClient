package dev.heldixclient.module.impl;

import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Theme;
import java.util.List;

import dev.heldixclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

public class FpsModule extends HudModule {
	public FpsModule() {
		super("fps", "FPS", "Bilder pro Sekunde", true, 4, 4);
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		int fps = mc.getFps();
		int color = !option("colored", true) ? Theme.TEXT : fps >= 120 ? 0xFF86EFAC : fps >= 60 ? 0xFFFDE68A : 0xFFFCA5A5;
		return drawLabelValue(g, mc.font, x, y, "FPS", Integer.toString(fps), color);
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.addFirst(toggle("colored", "Farbe nach Wert", "Grün ab 120, gelb ab 60, sonst rot", true));
		return settings;
	}
}
