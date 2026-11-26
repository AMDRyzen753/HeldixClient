package dev.heldixclient.hud;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.screen.HudEditorScreen;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ChatScreen;

/**
 * Zeichnet das HUD im Spiel. Ausgeblendet wird es mit F1 (macht der Loader), solange das F3-Menü offen ist (einstellbar)
 * und auf Wunsch bei offenem Chat; im HUD-Editor zeichnet der Editor selbst.
 */
public final class HudRenderer {
	private HudRenderer() {
	}

	/** Werden die HUD-Elemente gerade gezeichnet? (für „HUD bedienen“ und Addons) */
	public static boolean widgetsVisible(Minecraft mc) {
		if (mc.player == null || mc.gui.hud.isHidden()) return false;
		HeldixConfig.Data config = HeldixConfig.get();
		if (config.hudHideDebug && mc.getDebugOverlay().showDebugScreen()) return false;
		if (mc.gui.screen() instanceof HudEditorScreen) return false;
		return !(config.hudHideChat && mc.gui.screen() instanceof ChatScreen);
	}

	public static void extract(GuiGraphicsExtractor g, DeltaTracker deltaTracker) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null) return;
		if (mc.gui.screen() instanceof HudEditorScreen) return; // der Editor zeichnet selbst

		if (widgetsVisible(mc)) {
			// Wegpunkte unter den HUD-Elementen
			if (ModuleManager.waypoints != null) ModuleManager.waypoints.render(g, mc);
			for (HudModule module : ModuleManager.hudByLayer()) {
				if (module.isEnabled()) module.extract(g, mc);
			}
			if (HudModule.takeMigrated()) HeldixConfig.save();
		} else if (ModuleManager.waypoints != null) {
			ModuleManager.waypoints.clearMarkers();
		}
		// Einblendungen nicht über den F3-Zeilen (wie bisher)
		if (!mc.getDebugOverlay().showDebugScreen()) Notifications.render(g);
	}
}
