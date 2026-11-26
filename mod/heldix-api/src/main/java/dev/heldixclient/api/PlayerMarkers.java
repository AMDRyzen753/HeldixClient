package dev.heldixclient.api;

import java.time.Duration;
import java.util.UUID;

/**
 * Symbole am Namensschild über dem Kopf anderer Spieler, z. B. „spricht gerade“ im Voice Chat. Das Symbol steht hinter
 * dem Namen; Minecraft blendet es wie das Schild selbst aus (F1, Schleichen, Unsichtbarkeit, Teams).
 * Wird von HeldixClient bereitgestellt, nicht selbst implementieren.
 *
 * @since 6
 */
public interface PlayerMarkers {
	/**
	 * Symbol für einen Spieler zeigen; ein neues Symbol deines Addons für denselben Spieler ersetzt das alte.
	 *
	 * @param icon     Name aus dem Heldix-Icon-Set (z. B. "mic", "volume", "mic-off"; unbekannt = "star")
	 * @param color    Farbe (RGB, z. B. 0x34D399)
	 * @param duration so lange sichtbar (höchstens 1 Minute), danach verschwindet es von selbst – z. B. kurz halten und
	 *                 beim Sprechen immer wieder erneuern
	 */
	void show(UUID player, String icon, int color, Duration duration);

	/** Symbol deines Addons für diesen Spieler sofort entfernen (hinter dem Namen und über dem Kopf) */
	void hide(UUID player);

	/**
	 * Größeres Symbol über dem Namensschild (über dem Kopf): auf einer runden, dunklen Fläche mit Rand in der Farbe des
	 * Symbols – gut lesbar vor Himmel und Landschaft. Erscheint nur, wenn Minecraft das Namensschild zeigt (F1, Unsichtbarkeit, Teams), beim Schleichen
	 * blasser und nicht durch Wände. Symbole mehrerer Addons stehen nebeneinander. Ein neues Symbol deines Addons für
	 * denselben Spieler ersetzt das alte – zum Animieren (z. B. Schallwellen beim Sprechen) einfach jeden Tick neu zeigen.
	 *
	 * @param icon     Name aus dem Heldix-Icon-Set, z. B. "volume-1" bis "volume-3", "mic-off", "headphones-off"
	 * @param color    Farbe (RGB)
	 * @param duration so lange sichtbar (höchstens 1 Minute)
	 * @since 7
	 */
	void showAbove(UUID player, String icon, int color, Duration duration);
}
