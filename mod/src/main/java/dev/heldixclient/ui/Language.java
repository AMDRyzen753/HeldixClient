package dev.heldixclient.ui;

import net.minecraft.client.Minecraft;

import java.util.Locale;

/**
 * Sprache für Texte an den Spieler: „de“ oder „en“. Folgt der Sprache von Minecraft (de_de, de_at, de_ch … → „de“, alles
 * andere → „en“). HeldixClient 0.14.1 spricht selbst noch Deutsch; Addons (API 11) und Server-Plugins (Nachricht
 * {@code hello}) bekommen die Sprache schon jetzt, damit die englische Fassung später keine neue API braucht.
 */
public final class Language {
	private static volatile String current = "de";

	private Language() {
	}

	/** "de" oder "en" (Stand des letzten Ticks; vor dem Laden der Optionen "de") */
	public static String current() {
		return current;
	}

	/**
	 * Jeden Tick im Haupt-Thread: aus der Minecraft-Sprache neu bestimmen.
	 *
	 * @return true, wenn sich die Sprache geändert hat
	 */
	public static boolean update(Minecraft mc) {
		if (mc.options == null) return false;
		String language = of(mc.options.languageCode);
		// erster Stand nach dem Laden der Optionen ist kein Wechsel
		if (!known) {
			known = true;
			current = language;
			return false;
		}
		if (language.equals(current)) return false;
		current = language;
		return true;
	}

	private static boolean known;

	/** Minecraft-Sprachcode → "de"/"en" */
	public static String of(String minecraftCode) {
		if (minecraftCode == null || minecraftCode.isBlank()) return "de";
		return minecraftCode.toLowerCase(Locale.ROOT).startsWith("de") ? "de" : "en";
	}
}
