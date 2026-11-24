package dev.heldixclient.module.impl;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.Module;
import net.minecraft.client.Minecraft;

/** Zoom auf Tastendruck (Standard: C). Das Mausrad ändert die Zoomstärke, solange gezoomt wird. */
public class ZoomModule extends Module {
	private static final float MIN_FACTOR = 1.5f;
	private static final float MAX_FACTOR = 50f;

	private boolean zooming;
	private float scrollFactor;
	private float current = 1f;
	private long lastFrame = System.nanoTime();
	private boolean savedSmoothCamera;

	public ZoomModule() {
		super("zoom", "Zoom", "Taste C, Mausrad", true, 0, 0);
	}

	@Override
	public void tick(Minecraft mc) {
		boolean wantZoom = isEnabled() && HeldixClient.zoomKey.isDown() && mc.gui.screen() == null;
		if (wantZoom && !zooming) start(mc);
		else if (!wantZoom && zooming) stop(mc);
	}

	private void start(Minecraft mc) {
		zooming = true;
		scrollFactor = HeldixConfig.get().zoomFactor;
		if (HeldixConfig.get().zoomCinematicCamera) {
			savedSmoothCamera = mc.options.smoothCamera;
			mc.options.smoothCamera = true;
		}
	}

	private void stop(Minecraft mc) {
		zooming = false;
		if (HeldixConfig.get().zoomCinematicCamera) {
			mc.options.smoothCamera = savedSmoothCamera;
		}
	}

	public boolean isZooming() {
		return zooming;
	}

	/** @return true, wenn das Scrollen vom Zoom verbraucht wurde. */
	public boolean onScroll(double amount) {
		if (!zooming || amount == 0) return false;
		scrollFactor *= amount > 0 ? 1.2f : 1 / 1.2f;
		scrollFactor = Math.clamp(scrollFactor, MIN_FACTOR, MAX_FACTOR);
		return true;
	}

	/** Teiler für das Sichtfeld, wird jeden Frame abgefragt (Hooks.fov). */
	public float fovDivisor() {
		float target = zooming ? scrollFactor : 1f;
		long now = System.nanoTime();
		float dt = Math.min((now - lastFrame) / 1_000_000_000f, 0.1f);
		lastFrame = now;
		if (HeldixConfig.get().zoomSmooth) {
			current += (target - current) * (1f - (float) Math.exp(-dt * 14f));
			if (Math.abs(target - current) < 0.001f) current = target;
		} else {
			current = target;
		}
		return current;
	}
}
