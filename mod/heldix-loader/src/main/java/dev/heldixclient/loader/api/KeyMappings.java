package dev.heldixclient.loader.api;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Eigene Tastenbelegungen. Sie erscheinen unter Optionen → Steuerung und werden wie die
 * Vanilla-Tasten in options.txt gespeichert.
 */
public final class KeyMappings {
	private static final List<KeyMapping> REGISTERED = new CopyOnWriteArrayList<>();

	private KeyMappings() {
	}

	/** Registriert eine Taste. Muss in {@link HeldixModInitializer#onInitialize()} passieren. */
	public static KeyMapping register(KeyMapping mapping) {
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft != null && minecraft.options != null) {
			throw new IllegalStateException("Tasten müssen in onInitialize() registriert werden, die Optionen sind schon geladen");
		}
		REGISTERED.add(mapping);
		return mapping;
	}

	/** Alle von Mods registrierten Tasten (in Reihenfolge der Registrierung). */
	public static List<KeyMapping> registered() {
		return Collections.unmodifiableList(REGISTERED);
	}
}
