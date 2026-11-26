package dev.heldixclient.testaddons.minecraft;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;

/** entrypoint (Heldix-API): HeldixClient lädt ihn über denselben Classloader wie der Heldix Loader den clientEntrypoint. */
public final class TestAddon implements HeldixAddon {
	@Override
	public void onEnable(HeldixApi api) {
		TestHooks.addonLoader = TestAddon.class.getClassLoader();
		TestHooks.enabledAfterStart = TestHooks.started;
		TestHooks.enabled = true;
		api.logger().info("Minecraft-Test-Addon: clientEntrypoint " + (TestHooks.started ? "lief vorher" : "fehlt") + ", Ticks bisher " + TestHooks.TICKS.get());
	}
}
