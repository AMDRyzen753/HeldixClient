package dev.heldixclient.module.impl;

import dev.heldixclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

public class FpsModule extends HudModule {
	public FpsModule() {
		super("fps", "FPS", "Bilder pro Sekunde", true, 4, 4);
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		return drawLabelValue(g, mc.font, x, y, "FPS", Integer.toString(mc.getFps()));
	}
}
