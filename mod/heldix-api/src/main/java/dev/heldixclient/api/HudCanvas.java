package dev.heldixclient.api;

import java.nio.file.Path;

/**
 * Zeichenfläche für ein HUD-Element. Koordinaten sind relativ zur linken oberen Ecke des Elements;
 * der Spieler kann das Element im HUD-Editor frei verschieben und skalieren.
 * Farben sind ARGB-Werte, z. B. 0xFFFFFFFF für deckendes Weiß (siehe {@link HeldixColors}).
 */
public interface HudCanvas {
	/** Breite eines Textes in GUI-Pixeln (Minecraft-Schrift). */
	int textWidth(String text);

	/** Zeilenhöhe der Minecraft-Schrift in GUI-Pixeln. */
	int lineHeight();

	/** Text in der Minecraft-Schrift mit Schatten. */
	void text(String text, int x, int y, int color);

	void rect(int x, int y, int width, int height, int color);

	/** Fertige Box im Heldix-Stil: farbiger Streifen, Label in Akzentfarbe, Wert in Weiß. */
	void labelValue(String label, String value);

	/** Mehrzeilige Box im Heldix-Stil, jeweils {label, wert}. */
	void labelValues(String[][] rows);

	int screenWidth();

	int screenHeight();

	// --- ab API 2 ---------------------------------------------------------------------------

	/**
	 * Schriftschnitte der Heldix-Oberfläche (Inter). {@link #MINECRAFT} ist die normale Spielschrift mit Schatten.
	 *
	 * @since 2
	 */
	enum TextStyle {
		MINECRAFT(9),
		/** klein, z. B. für Zeiten und Nebeninfos */
		SMALL(8),
		/** normaler Text */
		BODY(9),
		/** halbfett, z. B. für einen Titel in einer Zeile */
		BOLD(9),
		/** groß und fett */
		TITLE(12);

		/** Zeilenhöhe in GUI-Pixeln */
		public final int height;

		TextStyle(int height) {
			this.height = height;
		}
	}

	/** @since 2 */
	int textWidth(String text, TextStyle style);

	/** @since 2 */
	void text(String text, int x, int y, int color, TextStyle style);

	/**
	 * Kürzt den Text mit „…“, bis er in maxWidth passt.
	 *
	 * @since 2
	 */
	String ellipsize(String text, int maxWidth, TextStyle style);

	/**
	 * Abgerundete, kantengeglättete Fläche. Auch halbe Pixel sind möglich (z. B. für Fortschrittsbalken).
	 *
	 * @since 2
	 */
	void roundedRect(float x, float y, float width, float height, float radius, int color);

	/**
	 * Rahmen einer abgerundeten Fläche (eine Bildschirmpixel-Linie).
	 *
	 * @since 2
	 */
	void roundedOutline(float x, float y, float width, float height, float radius, int color);

	/**
	 * Zeichnet ein PNG-Bild. Es wird beim ersten Mal geladen und zwischengespeichert; ändert sich die Datei,
	 * wird sie neu geladen. Abgerundete Ecken o. Ä. am besten schon im Bild selbst anlegen.
	 *
	 * @return false, wenn die Datei fehlt oder kein gültiges PNG ist
	 * @since 2
	 */
	boolean image(Path png, int x, int y, int width, int height);

	/**
	 * Icon aus dem Heldix-Icon-Set, z. B. "play", "pause", "skip-next", "skip-previous", "music", "clock".
	 * Unbekannte Namen zeichnen nichts.
	 *
	 * @since 2
	 */
	void icon(String name, int x, int y, int size, int color);

	/**
	 * true im HUD-Editor: Das Element soll dann auch ohne echte Daten etwas Sinnvolles zeigen,
	 * damit man es anordnen kann.
	 *
	 * @since 2
	 */
	boolean isPreview();
}
