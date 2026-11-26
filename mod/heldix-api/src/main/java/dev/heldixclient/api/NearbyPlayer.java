package dev.heldixclient.api;

import java.util.UUID;

/**
 * Ein anderer Spieler in der geladenen Welt, von dir aus gesehen (Momentaufnahme aus {@link HeldixApi#nearbyPlayers()}
 * bzw. das Ziel im Spielermenü). Wird von HeldixClient bereitgestellt, nicht selbst implementieren.
 *
 * @since 6
 */
public interface NearbyPlayer {
	UUID uuid();

	String name();

	double x();

	double y();

	double z();

	/** Abstand zum eigenen Spieler in Blöcken */
	double distance();

	/**
	 * Waagerechte Richtung von dir aus in Grad, bezogen auf deine Blickrichtung: 0 = geradeaus, negativ = links,
	 * positiv = rechts, ±180 = hinter dir. Für Stereo (z. B. Voice Chat).
	 */
	float direction();

	/** Nutzt der Spieler HeldixClient? (laut Heldix-Dienst; ohne Verbindung zum Dienst false) */
	boolean heldixPlayer();
}
