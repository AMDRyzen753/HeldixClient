package dev.heldixclient.render;

import java.lang.reflect.Method;

/**
 * Erkennt Iris (nur in Fabric-Instanzen). Solange ein Iris-Shaderpack wie BSL aktiv ist, pausieren die
 * Heldix-Shader – beides übereinander würde doppelt färben und kostet unnötig FPS.
 */
public final class IrisCompat {
	private static boolean checked;
	private static Object api;
	private static Method inUse;

	private IrisCompat() {
	}

	public static boolean shaderPackActive() {
		if (!checked) {
			checked = true;
			try {
				Class<?> type = Class.forName("net.irisshaders.iris.api.v0.IrisApi", false, IrisCompat.class.getClassLoader());
				api = type.getMethod("getInstance").invoke(null);
				inUse = type.getMethod("isShaderPackInUse");
			} catch (Throwable ignored) {
				// kein Iris installiert
			}
		}
		if (api == null) return false;
		try {
			return (boolean) inUse.invoke(api);
		} catch (Throwable e) {
			return false;
		}
	}
}
