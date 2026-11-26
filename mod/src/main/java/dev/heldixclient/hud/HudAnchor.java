package dev.heldixclient.hud;

/**
 * Bezugspunkt eines HUD-Elements am Bildschirm: Ecke, Kantenmitte oder Mitte. Gespeichert wird der Abstand des
 * Elements zu diesem Punkt (in GUI-Pixeln) – so bleibt ein Element rechts unten auch nach einer anderen
 * Fenstergröße oder GUI-Skalierung rechts unten, ein mittiges bleibt mittig.
 *
 * <p>Welcher Punkt des Elements den Abstand hält, folgt waagrecht der Ausrichtung des Elements (bei „Automatisch“
 * der Spalte des Bezugspunkts: links → linke Kante, Mitte → Mitte, rechts → rechte Kante) und senkrecht der Zeile.
 * Wird ein Element breiter, wächst es deshalb vom Rand weg.
 */
public enum HudAnchor {
	TOP_LEFT("top-left", 0, 0),
	TOP_CENTER("top-center", 1, 0),
	TOP_RIGHT("top-right", 2, 0),
	MIDDLE_LEFT("middle-left", 0, 1),
	CENTER("center", 1, 1),
	MIDDLE_RIGHT("middle-right", 2, 1),
	BOTTOM_LEFT("bottom-left", 0, 2),
	BOTTOM_CENTER("bottom-center", 1, 2),
	BOTTOM_RIGHT("bottom-right", 2, 2);

	public final String id;
	/** 0 = links, 1 = Mitte, 2 = rechts */
	public final int column;
	/** 0 = oben, 1 = Mitte, 2 = unten */
	public final int row;

	HudAnchor(String id, int column, int row) {
		this.id = id;
		this.column = column;
		this.row = row;
	}

	public static HudAnchor byId(String id) {
		if (id != null) {
			for (HudAnchor anchor : values()) {
				if (anchor.id.equals(id)) return anchor;
			}
		}
		return null;
	}

	public static HudAnchor of(int column, int row) {
		return values()[Math.clamp(row, 0, 2) * 3 + Math.clamp(column, 0, 2)];
	}

	/** Punkt am Bildschirm (GUI-Pixel) */
	public int screenX(int screenWidth) {
		return column == 0 ? 0 : column == 1 ? screenWidth / 2 : screenWidth;
	}

	public int screenY(int screenHeight) {
		return row == 0 ? 0 : row == 1 ? screenHeight / 2 : screenHeight;
	}

	/**
	 * Bezugspunkt, der am nächsten an einem Element an (x, y) mit Größe w × h liegt: der Bildschirm wird in Drittel
	 * geteilt, es zählt die Mitte des Elements.
	 */
	public static HudAnchor nearest(int x, int y, int w, int h, int screenWidth, int screenHeight) {
		return of(third(x + w / 2.0, screenWidth), third(y + h / 2.0, screenHeight));
	}

	private static int third(double center, int size) {
		if (size <= 0) return 0;
		double t = center / size;
		return t < 1 / 3.0 ? 0 : t > 2 / 3.0 ? 2 : 1;
	}

	/** Anteil (0, 0,5 oder 1) der Breite, an dem ein Element mit dieser Spalte bzw. Ausrichtung seinen Abstand hält */
	public static float fraction(int columnOrAlign) {
		return columnOrAlign == 0 ? 0f : columnOrAlign == 1 ? 0.5f : 1f;
	}
}
