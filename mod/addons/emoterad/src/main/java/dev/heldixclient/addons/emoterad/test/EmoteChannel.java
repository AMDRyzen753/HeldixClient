package dev.heldixclient.addons.emoterad.test;

import java.util.Locale;

/**
 * Meldet das laufende Emote des eigenen Spielers an andere Addons (z. B. Krallen). Addons laufen in getrennten
 * Classloadern und können keine Klassen teilen; deshalb geht die Meldung über die Java-Systemeigenschaft {@value #KEY}
 * im Format {@code NAME;STÄRKE} (z. B. {@code SIT;0.83}, Namen wie {@link Emotes.Emote}), leer = kein Emote.
 * Geschrieben wird nur, wenn sich der Wert ändert.
 */
final class EmoteChannel {
	static final String KEY = "heldix.emote.lokal";
	private static String last = "";

	private EmoteChannel() {
	}

	static void publish(Emotes.Emote emote, float blend) {
		String value = emote == null || blend <= 0f ? "" : emote.name() + ';' + String.format(Locale.ROOT, "%.3f", blend);
		if (value.equals(last)) return;
		last = value;
		System.setProperty(KEY, value);
	}

	static void clear() {
		last = "";
		System.setProperty(KEY, "");
	}
}
