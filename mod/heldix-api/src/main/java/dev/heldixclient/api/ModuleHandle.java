package dev.heldixclient.api;

import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleFunction;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

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
	 * Knopf im Untermenü, z. B. „Weiter“. Die Aktion läuft im Haupt-Thread. Ab API 3 gilt sie als Aktion des
	 * Spielers ({@link HeldixApi#sendChatMessage(String)} ist dort erlaubt).
	 *
	 * @param button Text auf dem Knopf
	 * @since 2
	 */
	void addAction(String label, String description, String button, Runnable action);

	// --- ab API 3 ---------------------------------------------------------------------------

	/**
	 * Schieberegler im Untermenü. Der Wert wird auf step gerundet und gespeichert. Rechts daneben steht die Zahl
	 * (mit so vielen Nachkommastellen wie step hat).
	 *
	 * @param key eindeutig innerhalb des Moduls
	 * @return liefert jederzeit den aktuellen Wert
	 * @since 3
	 */
	DoubleSupplier addSlider(String key, String label, String description, double min, double max, double step, double defaultValue);

	/**
	 * Wie {@link #addSlider(String, String, String, double, double, double, double)}, mit eigenem Text für den Wert,
	 * z. B. {@code v -> v == 0 ? "Aus" : (int) v + " min"}.
	 *
	 * @since 3
	 */
	DoubleSupplier addSlider(String key, String label, String description, double min, double max, double step, double defaultValue,
			DoubleFunction<String> format);

	/**
	 * Farbwahl im Untermenü: Ein Klick öffnet eine Palette mit den Heldix-Farben (die Standardfarbe ist immer dabei).
	 *
	 * @param defaultColor ARGB, z. B. {@link HeldixColors#ACCENT}
	 * @return liefert jederzeit die gewählte Farbe (ARGB)
	 * @since 3
	 */
	IntSupplier addColor(String key, String label, String description, int defaultColor);

	/**
	 * Textfeld im Untermenü (eine Zeile, z. B. für eine eigene Beschriftung). Gespeichert wird beim Tippen.
	 *
	 * @param maxLength höchstens so viele Zeichen (1 bis 256)
	 * @return liefert jederzeit den aktuellen Text
	 * @since 3
	 */
	Supplier<String> addText(String key, String label, String description, String defaultValue, int maxLength);

	@FunctionalInterface
	interface ToggleListener {
		void onToggle(boolean enabled);
	}
}
