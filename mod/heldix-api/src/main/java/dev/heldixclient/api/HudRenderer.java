package dev.heldixclient.api;

/** Zeichnet ein HUD-Element. Die Größe ergibt sich automatisch aus dem, was gezeichnet wird. */
@FunctionalInterface
public interface HudRenderer {
	void render(HudCanvas canvas);
}
