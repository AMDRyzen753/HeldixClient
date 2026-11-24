package dev.heldixclient.loader.api.event;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Zeichnen ins HUD. */
public final class HudEvents {
	@FunctionalInterface
	public interface Render {
		void render(GuiGraphicsExtractor graphics, DeltaTracker delta);
	}

	/** Nach dem Vanilla-HUD (über Hotbar, Chat usw.). Nicht, wenn das HUD mit F1 ausgeblendet ist. */
	public static final Event<Render> RENDER = new Event<>();

	private HudEvents() {
	}
}
