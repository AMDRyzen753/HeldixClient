package dev.heldixclient.testaddons.minecraft;

import dev.heldixclient.loader.api.HeldixModInitializer;

/** clientEntrypoint: läuft beim Spielstart, zur selben Zeit wie die Einstiegspunkte der Heldix-Mods. */
public final class TestStart implements HeldixModInitializer {
	@Override
	public void onInitialize() {
		TestHooks.startLoader = TestStart.class.getClassLoader();
		TestHooks.started = true;
	}
}
