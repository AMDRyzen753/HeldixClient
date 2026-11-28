package dev.heldixclient.addons.emoterad.test;

import dev.heldixclient.loader.api.HeldixModInitializer;

/**
 * Einstieg mit Zugriff auf Minecraft (clientEntrypoint): Das Addon greift über Reflexion in die Spieler-Renderer von
 * Minecraft 26.3 ein. Beim Start prüfen, ob es die Felder dort gibt – fehlt eins, steht der Grund im Log und das Addon
 * zeichnet nichts (Minecraft bleibt unverändert).
 */
public final class Start implements HeldixModInitializer {
	static volatile String problem;

	@Override
	public void onInitialize() {
		problem = missingField(net.minecraft.client.renderer.entity.EntityRenderDispatcher.class, "playerRenderers");
		if (problem == null) problem = missingField(net.minecraft.client.renderer.entity.LivingEntityRenderer.class, "model");
	}

	private static String missingField(Class<?> type, String name) {
		for (Class<?> c = type; c != null; c = c.getSuperclass()) {
			try {
				c.getDeclaredField(name);
				return null;
			} catch (NoSuchFieldException ignored) {
				// in der Oberklasse weitersuchen
			}
		}
		return type.getSimpleName() + "." + name + " fehlt in dieser Minecraft-Version";
	}
}
