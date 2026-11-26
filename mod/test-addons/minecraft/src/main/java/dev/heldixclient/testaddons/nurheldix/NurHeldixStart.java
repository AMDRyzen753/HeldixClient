package dev.heldixclient.testaddons.nurheldix;

import dev.heldixclient.loader.api.HeldixModInitializer;

/** clientEntrypoint ohne Heldix-API (das Addon hat keinen entrypoint) */
public final class NurHeldixStart implements HeldixModInitializer {
	public static volatile boolean started;

	@Override
	public void onInitialize() {
		started = true;
	}
}
