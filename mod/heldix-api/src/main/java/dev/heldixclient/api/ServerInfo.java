package dev.heldixclient.api;

import java.util.Set;

/**
 * Der Server, auf dem der Spieler gerade spielt ({@link HeldixApi#server()}). Wird vom HeldixClient bereitgestellt, nicht
 * selbst implementieren – spätere API-Versionen können weitere Werte ergänzen.
 *
 * <p>Server mit dem Plugin „HeldixClient Server“ sprechen Heldix: Sie können dem Client sagen, welche Funktionen auf
 * ihnen aus sind (Kanal {@code heldixclient:server}, Nachricht {@code rules}, siehe docs/server-plugin.md). Bekannte
 * Schlüssel sind {@code freelook}, {@code zoom}, {@code minimap}, {@code worldmap}, {@code waypoints},
 * {@code coordinates}, {@code fullbright} und {@code togglesprint}; ein Server darf auch eigene Schlüssel schicken
 * (a-z, 0-9, „_“, „-“ und „.“, höchstens 32 Zeichen), die ein Addon dann mit {@link #allowed} abfragen kann.
 *
 * <p>Ohne Server (Hauptmenü, Einzelspieler) und auf Servern ohne das Plugin ist alles erlaubt. Die Regeln gelten bis
 * zum Verlassen des Servers oder bis der Server neue schickt.
 *
 * @since 11
 */
public interface ServerInfo {
	/** Ist gerade ein Server betreten (Mehrspieler, auch LAN und geteilte Welten als Gast)? */
	boolean connected();

	/** Adresse des Servers, wie sie in der Serverliste steht, z. B. "play.example.net" ("" ohne Server) */
	String address();

	/** Spricht der Server Heldix (Plugin „HeldixClient Server“ hat sich gemeldet)? */
	boolean heldix();

	/** Anzeigename, den der Server mitgeschickt hat ("" ohne bzw. wenn der Server nicht Heldix spricht) */
	String name();

	/**
	 * Ist der Server ein Partner-Server von HeldixClient? Entscheidet allein die öffentliche Partnerliste des
	 * Heldix-Dienstes (Adresse passt), nicht der Server selbst.
	 */
	boolean partner();

	/** Name des Partners laut Partnerliste ("" wenn kein Partner) */
	String partnerName();

	/**
	 * Ist diese Funktion auf dem Server erlaubt? false nur, wenn der Server sie mit seinen Regeln abgeschaltet hat.
	 *
	 * @param feature Schlüssel, z. B. "minimap", "waypoints" oder "coordinates" (Groß-/Kleinschreibung egal)
	 */
	boolean allowed(String feature);

	/** Alle Schlüssel, die der Server gerade abgeschaltet hat (klein geschrieben; leer = alles erlaubt) */
	Set<String> disabled();
}
