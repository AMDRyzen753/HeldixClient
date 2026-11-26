package dev.heldixclient.api;

import java.util.List;

/**
 * Mauszeiger über einem HUD-Element, während der Spieler das HUD bedient (Chat offen oder Taste „HUD bedienen“).
 * Vorbelegt sind Tooltip und Mauszeiger des Bereichs unter dem Zeiger ({@link HudCanvas#hotspot}); in
 * {@link HudRenderer#onHover(HudHover)} kann das Addon beides ändern. Läuft im Haupt-Thread, jedes Bild.
 *
 * @since 5
 */
public interface HudHover {
	/** Form des Mauszeigers */
	enum Cursor {
		DEFAULT,
		/** Hand: hier kann man klicken */
		HAND,
		TEXT,
		CROSSHAIR,
		MOVE,
		NOT_ALLOWED
	}

	/** Mauszeiger relativ zur linken oberen Ecke des Elements, in den Koordinaten der {@link HudCanvas} */
	float x();

	float y();

	/** ID des Bereichs unter dem Mauszeiger ({@link HudCanvas#hotspot}), "" = keiner */
	String hotspot();

	/** true, wenn der Chat offen ist (sonst über die Taste „HUD bedienen“) */
	boolean chatOpen();

	/** Tooltip neben dem Mauszeiger, eine Zeile je Eintrag (höchstens 12); keine Zeilen = kein Tooltip */
	void tooltip(List<String> lines);

	void tooltip(String... lines);

	void cursor(Cursor cursor);
}
