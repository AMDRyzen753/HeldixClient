package dev.heldixclient.api;

/**
 * Klick auf ein HUD-Element im Spiel. Das geht nur, solange der Spieler das HUD mit der Maus bedient: bei offenem
 * Chat oder mit der Taste „HUD bedienen“ – nie beim normalen Spielen, und der Klick erreicht das Spiel nicht (kein
 * Angreifen, kein Platzieren). Läuft im Haupt-Thread und gilt als Aktion des Spielers
 * ({@link HeldixApi#sendChatMessage(String)} ist einmal erlaubt).
 *
 * @see HudRenderer#onClick(HudClick)
 * @since 5
 */
public interface HudClick {
	int LEFT = 0;
	int RIGHT = 1;
	int MIDDLE = 2;

	/** Stelle des Klicks relativ zur linken oberen Ecke des Elements, in den Koordinaten der {@link HudCanvas} */
	float x();

	float y();

	/** {@link #LEFT}, {@link #RIGHT} oder {@link #MIDDLE} */
	int button();

	boolean shift();

	boolean control();

	boolean alt();

	/** ID des Bereichs unter dem Mauszeiger ({@link HudCanvas#hotspot}), "" = keiner */
	String hotspot();

	/** true, wenn der Chat offen ist (sonst über die Taste „HUD bedienen“) */
	boolean chatOpen();

	/**
	 * Fügt Text an der Schreibmarke ins Eingabefeld des Chats ein, z. B. Koordinaten.
	 *
	 * @return false, wenn der Chat nicht offen ist
	 */
	boolean insertIntoChat(String text);

	/** Kopiert Text in die Zwischenablage */
	void copyToClipboard(String text);
}
