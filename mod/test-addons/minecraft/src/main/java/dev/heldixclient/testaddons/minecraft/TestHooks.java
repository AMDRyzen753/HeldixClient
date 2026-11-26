package dev.heldixclient.testaddons.minecraft;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * Zustand des Test-Addons, vom Autotest per Reflection gelesen (über den Classloader, den der Heldix Loader dem Addon
 * gegeben hat). Gäbe es die Klasse doppelt (zweiter Classloader), sähe der Autotest hier nur Nullen.
 */
public final class TestHooks {
	/** Aufrufe aus Minecraft.tick() – dorthin führt der Eingriff des TickTransformer */
	public static final AtomicInteger TICKS = new AtomicInteger();
	/** clientEntrypoint (HeldixModInitializer) lief */
	public static volatile boolean started;
	/** Classloader, mit dem der clientEntrypoint geladen wurde */
	public static volatile ClassLoader startLoader;
	/** entrypoint (HeldixAddon) lief */
	public static volatile boolean enabled;
	/** Sah onEnable den Zustand des clientEntrypoint (gleiche Klasse, gleicher Classloader)? */
	public static volatile boolean enabledAfterStart;
	/** Classloader, mit dem der entrypoint geladen wurde */
	public static volatile ClassLoader addonLoader;

	private TestHooks() {
	}

	/** Hook am Anfang von Minecraft.tick() */
	public static void tick() {
		TICKS.incrementAndGet();
	}
}
