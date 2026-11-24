package dev.heldixclient.loader.impl;

import java.lang.instrument.Instrumentation;

/**
 * Startpunkt des Heldix Loaders. Die JVM ruft {@link #premain} auf, bevor Minecraft startet,
 * wenn das Spiel mit {@code -javaagent:heldix-loader.jar} gestartet wird.
 */
public final class HeldixAgent {
	private HeldixAgent() {
	}

	public static void premain(String args, Instrumentation instrumentation) {
		LoaderCore.boot(args, instrumentation);
	}
}
