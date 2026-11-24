package dev.heldixclient.api;

import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.IntSupplier;

/** Zugriff auf ein registriertes Modul. */
public interface ModuleHandle {
	boolean isEnabled();

	void setEnabled(boolean enabled);

	/** Wird aufgerufen, wenn der Spieler das Modul im Heldix-Menü umschaltet. */
	void onToggle(ToggleListener listener);

	// --- ab API 2: Einstellungen im Untermenü des Moduls (Heldix-Menü → Zahnrad an der Karte) --

	/**
	 * An/Aus-Schalter im Untermenü. Der Wert wird gespeichert.
	 *
	 * @param key eindeutig innerhalb des Moduls, z. B. "show-cover"
	 * @return liefert jederzeit den aktuellen Wert
	 * @since 2
	 */
	BooleanSupplier addToggle(String key, String label, String description, boolean defaultValue);

	/**
	 * Auswahl aus festen Möglichkeiten (Klick schaltet weiter). Der Wert wird gespeichert.
	 *
	 * @return liefert jederzeit den Index der gewählten Möglichkeit
	 * @since 2
	 */
	IntSupplier addChoice(String key, String label, String description, List<String> options, int defaultIndex);

	/**
	 * Knopf im Untermenü, z. B. „Weiter“. Die Aktion läuft im Haupt-Thread.
	 *
	 * @param button Text auf dem Knopf
	 * @since 2
	 */
	void addAction(String label, String description, String button, Runnable action);

	@FunctionalInterface
	interface ToggleListener {
		void onToggle(boolean enabled);
	}
}
