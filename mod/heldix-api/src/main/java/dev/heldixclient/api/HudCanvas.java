package dev.heldixclient.api;

/**
 * Zeichenfläche für ein HUD-Element. Koordinaten sind relativ zur linken oberen Ecke des Elements;
 * der Spieler kann das Element im HUD-Editor frei verschieben.
 * Farben sind ARGB-Werte, z. B. 0xFFFFFFFF für deckendes Weiß (siehe {@link HeldixColors}).
 */
public interface HudCanvas {
	/** Breite eines Textes in GUI-Pixeln. */
	int textWidth(String text);

	/** Zeilenhöhe der Schrift in GUI-Pixeln. */
	int lineHeight();

	void text(String text, int x, int y, int color);

	void rect(int x, int y, int width, int height, int color);

	/** Fertige Box im Heldix-Stil: violetter Streifen, Label in Akzentfarbe, Wert in Weiß. */
	void labelValue(String label, String value);

	/** Mehrzeilige Box im Heldix-Stil, jeweils {label, wert}. */
	void labelValues(String[][] rows);

	int screenWidth();

	int screenHeight();
}
