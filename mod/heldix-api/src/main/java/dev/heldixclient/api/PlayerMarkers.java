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

	/** Symbol deines Addons für diesen Spieler sofort entfernen */
	void hide(UUID player);
}
