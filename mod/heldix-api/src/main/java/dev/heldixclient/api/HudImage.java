package dev.heldixclient.api;

/**
 * Ein Bild, dessen Pixel dein Addon selbst setzt (z. B. eine Minimap), gezeichnet mit
 * {@link HudCanvas#image(HudImage, float, float, float, float)}. Angelegt mit {@link HeldixApi#createImage(int, int)}.
 * Pixel setzen und zeichnen nur im Haupt-Thread; HeldixClient lädt geänderte Pixel beim nächsten Zeichnen hoch.
 * Wird von HeldixClient bereitgestellt, nicht selbst implementieren.
 *
 * @since 8
 */
public interface HudImage {
	int width();

	int height();

	/**
	 * Alle Pixel auf einmal setzen: ARGB (0xAARRGGBB), Zeile für Zeile von oben links, mindestens
	 * {@code width * height} Einträge. Durchsichtige Pixel (Alpha 0) bleiben leer – so werden z. B. runde Karten rund.
	 */
	void setPixels(int[] argb);

	/** Einen Pixel setzen (ARGB) */
	void setPixel(int x, int y, int argb);

	/** Bild freigeben (sonst beim Abschalten des Addons von selbst). Danach zeichnet es nichts mehr. */
	void close();
}
