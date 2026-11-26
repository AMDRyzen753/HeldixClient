package dev.heldixclient.api;

/**
 * Aussehen der HUD-Elemente, wie der Spieler es eingestellt hat (Heldix-Menü → Einstellungen → HUD und Rechtsklick
 * auf ein Element im HUD-Editor). Ein Addon-Element, das diese Werte nutzt, sieht aus wie die eingebauten Elemente.
 * Die Werte gelten für das gerade gezeichnete Element: eigene Einstellungen des Elements (z. B. eine andere
 * Akzentfarbe oder kein Hintergrund) sind schon eingerechnet.
 *
 * <p>Am einfachsten: {@link HudCanvas#panel(float, float, float, float)} für die Fläche und
 * {@link HudCanvas#text(String, float, float, int, HudCanvas.TextStyle, boolean)} mit {@link #textStyle()} und
 * {@link #shadow()} für den Text.
 *
 * @since 5
 */
public interface HudStyle {
	/** Grundstil des HUD */
	enum Kind {
		/** dunkle, abgerundete Fläche mit feinem Rahmen und Heldix-Schrift (wie das Heldix-Menü) */
		HELDIX,
		/** ohne Fläche, nur Text mit Schatten */
		MINIMAL,
		/** wie bis HeldixClient 0.13: eckige Fläche mit farbigem Streifen links, Minecraft-Schrift */
		CLASSIC
	}

	/** Ausrichtung des Inhalts (und Richtung, in die das Element wächst) */
	enum Align {
		LEFT,
		CENTER,
		RIGHT
	}

	Kind kind();

	/** Akzentfarbe (ARGB, deckend), z. B. für Balken, Symbole und gefüllte Flächen */
	int accent();

	/** Akzentfarbe für Text (Beschriftungen), auf dem Hintergrund gut lesbar */
	int labelColor();

	/** Farbe für Werte und normalen Text */
	int textColor();

	/** Farbe der Fläche mit eingerechneter Deckkraft; 0 = ohne Hintergrund */
	int background();

	/** Deckkraft der Fläche, 0 bis 1 (auch wenn der Hintergrund aus ist) */
	float opacity();

	/** Rahmen um die Fläche? */
	boolean border();

	/** Farbe des Rahmens (ARGB) */
	int borderColor();

	/** Text mit Schatten? */
	boolean shadow();

	/** Eckenradius der Fläche in GUI-Pixeln */
	float radius();

	/** Innenabstand in GUI-Pixeln */
	int padding();

	/** Ausrichtung des Inhalts: links, mittig oder rechts (rechts am Bildschirmrand meist {@link Align#RIGHT}) */
	Align align();

	/** Größe des Elements insgesamt (HUD-Größe × Größe des Elements, 1 = normal); beim Zeichnen schon eingerechnet */
	float scale();

	/** Schriftschnitt der eingebauten Elemente in diesem Stil ({@link HudCanvas.TextStyle#BODY} oder {@link HudCanvas.TextStyle#MINECRAFT}) */
	HudCanvas.TextStyle textStyle();
}
