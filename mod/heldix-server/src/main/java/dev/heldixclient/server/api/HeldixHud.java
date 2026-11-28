package dev.heldixclient.server.api;

import java.util.List;

/**
 * HUD-Elemente eines Spielers ({@link HeldixServer#hud}). Höchstens 8 je Spieler; gleiche ID ersetzt. Auch vor dem
 * {@code hello} des Clients setzbar – das Plugin schickt sie, sobald sich HeldixClient meldet. Der Spieler kann Server-HUD in
 * HeldixClient ausschalten.
 */
public interface HeldixHud {
	/** Höchstzahl der Elemente je Spieler */
	int MAX_ELEMENTS = 8;

	/**
	 * Element setzen oder (gleiche ID) ersetzen.
	 *
	 * @return false, wenn schon 8 andere Elemente gesetzt sind
	 */
	boolean set(HudElement element);

	/** Element entfernen; false, wenn es keins mit dieser ID gab */
	boolean remove(String id);

	/** Alle Elemente dieses Spielers entfernen */
	void clear();

	/** Die gesetzten Elemente in Reihenfolge */
	List<HudElement> elements();
}
