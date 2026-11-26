package dev.heldixclient.api;

/**
 * Momentaufnahme des Spiels ({@link HeldixApi#game()}). Ohne Welt (z. B. im Hauptmenü) sind die Werte
 * leer bzw. -1. Wird vom HeldixClient bereitgestellt, nicht selbst implementieren – spätere API-Versionen
 * können weitere Werte ergänzen.
 *
 * @since 3
 */
public interface GameInfo {
	/** Bilder pro Sekunde */
	int fps();

	/** Ping zum Server in Millisekunden (-1 = unbekannt bzw. keine Welt) */
	int ping();

	/** Ist eine Welt geladen (Einzelspieler oder Server)? */
	boolean inWorld();

	/** Einzelspieler-Welt (auch wenn sie im LAN geöffnet ist) */
	boolean singleplayer();

	/** auf einem Server (inkl. LAN und Realms) */
	boolean multiplayer();

	/** Adresse des Servers, z. B. "play.example.net" ("" im Einzelspieler und ohne Welt) */
	String serverAddress();

	/** Tageszeit der Welt von 0 bis 23999 (0 = Sonnenaufgang, 6000 = Mittag; -1 ohne Welt) */
	long timeOfDay();

	/** "clear", "rain" oder "thunder" ("" ohne Welt) */
	String weather();

	/** Ist das Spiel pausiert (Einzelspieler mit offenem Pausemenü)? */
	boolean paused();

	/** Ist das HUD ausgeblendet (F1)? */
	boolean hudHidden();

	/**
	 * Art des offenen Menüs ("" = keins), z. B. "chat", "inventory", "pause"
	 * (alle Arten siehe {@link HeldixEvents#onScreenOpen}).
	 */
	String screen();
}
