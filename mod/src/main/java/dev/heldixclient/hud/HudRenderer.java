package dev.heldixclient.hud;

import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.screen.HudEditorScreen;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

public final class HudRenderer {
	private HudRenderer() {
	}

	public static void extract(GuiGraphicsExtractor g, DeltaTracker deltaTracker) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null) return;
		if (mc.getDebugOverlay().showDebugScreen()) return;
		if (mc.gui.screen() instanceof HudEditorScreen) return; // der Editor zeichnet selbst

		for (HudModule module : ModuleManager.hud()) {
			if (module.isEnabled()) module.extract(g, mc);
		}
		Notifications.render(g);
	}
}
