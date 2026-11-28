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

	// --- ab API 5: Stil-Optionen für das Rechtsklick-Menü im HUD-Editor ------------------------

	/**
	 * Schalter für das Aussehen des Elements: erscheint im HUD-Editor im Rechtsklick-Menü des Elements (und im
	 * Untermenü des Moduls). Gespeichert wird wie bei {@link #addToggle}; der Schlüssel teilt sich den Namensraum mit
	 * den übrigen Einstellungen des Moduls. Bei Modulen ohne HUD-Element nur im Untermenü.
	 *
	 * @return liefert jederzeit den aktuellen Wert
	 * @since 5
	 */
	BooleanSupplier addStyleToggle(String key, String label, boolean defaultValue);

	/**
	 * Auswahl für das Aussehen (z. B. „Kompakt“/„Groß“), im Rechtsklick-Menü als Liste zum Anklicken.
	 *
	 * @return liefert jederzeit den Index der gewählten Möglichkeit
	 * @since 5
	 */
	IntSupplier addStyleChoice(String key, String label, List<String> options, int defaultIndex);

	/**
	 * Farbe für das Aussehen, im Rechtsklick-Menü als Palette (Heldix-Farben, die Standardfarbe ist immer dabei).
	 *
	 * @return liefert jederzeit die gewählte Farbe (ARGB)
	 * @since 5
	 */
	IntSupplier addStyleColor(String key, String label, int defaultColor);

	// --- ab API 6: Tasten im Untermenü des Moduls ---------------------------------------------

	/**
	 * Taste für dieses Modul. Sie steht im Untermenü des Moduls unter „Tasten“, wo der Spieler sie per Klick und
	 * Tastendruck umbelegt (Entf = nicht belegt), und wie jede Addon-Taste unter Optionen → Steuerung → Heldix-Addons.
	 * Wie {@link HeldixApi#registerKey} nur in {@link HeldixAddon#onEnable(HeldixApi)} aufrufen.
	 *
	 * @param key         eindeutig innerhalb des Addons, z. B. "show-date" (a-z, 0-9, _ und -)
	 * @param label       Name im Untermenü und in der Steuerung, z. B. "Datum zeigen"
	 * @param description kurze Erklärung im Untermenü, darf leer sein
	 * @param defaultKey  Standardtaste, siehe {@link HeldixKeys} ({@link HeldixKeys#NONE} = nicht belegt)
	 * @param onPress     läuft im Haupt-Thread bei jedem Druck im Spiel (nicht in Menüs), auch wenn das Modul aus ist –
	 *                    prüfe dafür {@link #isEnabled()}; ein Druck gilt als Aktion des Spielers
	 * @since 6
	 */
	KeyHandle addKey(String key, String label, String description, int defaultKey, Runnable onPress);

	/**
	 * Eine mit {@link HeldixApi#registerKey} angelegte Taste zusätzlich im Untermenü dieses Moduls zeigen, damit der
	 * Spieler sie dort umbelegen kann (z. B. die Musik-Tasten im Modul Spotify).
	 *
	 * @param key         Rückgabe von {@link HeldixApi#registerKey}
	 * @param label       Name im Untermenü
	 * @param description kurze Erklärung, darf leer sein
	 * @since 6
	 */
	void showKey(KeyHandle key, String label, String description);

	/**
	 * Das Modul folgt einer Server-Regel ({@link ServerInfo#allowed}): Hat der Server diesen Schlüssel abgeschaltet,
	 * zeichnet HeldixClient das HUD-Element nicht (bei HUD-Modulen), die Karte im Heldix-Menü zeigt „Auf diesem Server
	 * deaktiviert“ und Einschalten zeigt denselben Hinweis. Die Einstellung des Spielers bleibt dabei erhalten. Bei
	 * Modulen ohne HUD prüft das Addon die Regel selbst (z. B. in {@link HeldixEvents#onServerInfoChange}). Mehrfach
	 * aufrufen = mehrere Regeln (jede sperrt).
	 *
	 * @param rule Schlüssel, z. B. "minimap" (a-z, 0-9, „_“, „-“ und „.“, höchstens 32 Zeichen)
	 * @since 11
	 */
	void followServerRule(String rule);

	@FunctionalInterface
	interface ToggleListener {
		void onToggle(boolean enabled);
	}
}
