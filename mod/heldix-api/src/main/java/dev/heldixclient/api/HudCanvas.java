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

	// --- ab API 3 ---------------------------------------------------------------------------

	/**
	 * Fortschrittsbalken mit runden Enden.
	 *
	 * @param progress   von 0 bis 1
	 * @param background Farbe der Bahn, z. B. 0x2EFFFFFF
	 * @param foreground Farbe des gefüllten Teils
	 * @since 3
	 */
	void progressBar(float x, float y, float width, float height, float progress, int background, int foreground);

	/**
	 * Fläche mit Farbverlauf von startColor nach endColor (waagrecht: links → rechts, sonst oben → unten).
	 *
	 * @since 3
	 */
	void gradientRect(int x, int y, int width, int height, int startColor, int endColor, boolean horizontal);

	/**
	 * Gerade Linie von (x1, y1) nach (x2, y2) in beliebiger Richtung.
	 *
	 * @param thickness Dicke in GUI-Pixeln, z. B. 1 oder 1.5
	 * @since 3
	 */
	void line(float x1, float y1, float x2, float y2, float thickness, int color);

	/**
	 * Ausgefüllter, kantengeglätteter Kreis.
	 *
	 * @since 3
	 */
	void circle(float centerX, float centerY, float radius, int color);

	/**
	 * Item-Symbol wie im Inventar, z. B. "minecraft:diamond_sword" (ohne Namensraum gilt "minecraft").
	 *
	 * @param size Kantenlänge in GUI-Pixeln (16 = wie im Inventar)
	 * @return false bei unbekanntem Item (dann wird nichts gezeichnet)
	 * @since 3
	 */
	boolean item(String itemId, int x, int y, int size);

	/**
	 * Kopf (Gesicht) eines Spielers: per Name für Spieler auf dem aktuellen Server bzw. sich selbst, per UUID
	 * für alle (der Skin wird dann im Hintergrund geladen, bis dahin erscheint der Standard-Skin).
	 *
	 * @return false, wenn der Name hier nicht bekannt ist (dann wird nichts gezeichnet)
	 * @since 3
	 */
	boolean playerHead(String nameOrUuid, int x, int y, int size);

	/**
	 * Text in höchstens maxWidth Pixeln: Passt er nicht, läuft er langsam hin und her (Laufschrift) und wird an
	 * den Rändern abgeschnitten. Passt er, wird er ganz normal gezeichnet.
	 *
	 * @since 3
	 */
	void scrollingText(String text, int x, int y, int maxWidth, int color, TextStyle style);

	/**
	 * Typische Farbe eines PNG-Bildes (Durchschnitt, kräftige Farben zählen mehr), z. B. als Akzentfarbe passend
	 * zu einem Album-Cover. Wird mit dem Bild zwischengespeichert.
	 *
	 * @return deckende ARGB-Farbe, 0 wenn das Bild fehlt oder ungültig ist
	 * @since 3
	 */
	int imageColor(Path png);
}
