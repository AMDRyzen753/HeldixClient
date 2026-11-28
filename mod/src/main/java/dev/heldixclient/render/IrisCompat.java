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
	private static Method shadow;

	private IrisCompat() {
	}

	private static void check() {
		if (checked) return;
		checked = true;
		try {
			Class<?> type = Class.forName("net.irisshaders.iris.api.v0.IrisApi", false, IrisCompat.class.getClassLoader());
			api = type.getMethod("getInstance").invoke(null);
			inUse = type.getMethod("isShaderPackInUse");
			shadow = type.getMethod("isRenderingShadowPass");
		} catch (Throwable ignored) {
			// kein Iris installiert
		}
	}

	public static boolean shaderPackActive() {
		check();
		if (api == null) return false;
		try {
			return (boolean) inUse.invoke(api);
		} catch (Throwable e) {
			return false;
		}
	}

	/**
	 * Zeichnet Iris gerade den Schatten-Durchgang? Dort werden Spieler ein zweites Mal eingereicht – aus Sicht der Sonne,
	 * auch der eigene in der Ich-Perspektive. Lagen und Partikel dürfen daraus nicht gemessen werden.
	 */
	public static boolean shadowPass() {
		check();
		if (api == null || shadow == null) return false;
		try {
			return (boolean) shadow.invoke(api);
		} catch (Throwable e) {
			return false;
		}
	}
}
