package dev.heldixclient.api;

/**
 * Die Oberfläche der geladenen Welt von oben, Spalte für Spalte – für Minimaps und Karten. Liefert für jede Spalte
 * (x, z) die Farbe des obersten sichtbaren Blocks, seine Höhe und die Wassertiefe darüber. Nur geladene Chunks; alles
 * nur im Haupt-Thread aufrufen. Wird von HeldixClient bereitgestellt, nicht selbst implementieren.
 *
 * <p><b>Fair Play:</b> Auf Servern gibt es nur die Oberfläche. Unter die Oberfläche schauen
 * ({@link #sampleBelow}, z. B. Höhlen oder der Nether unter seiner Decke) geht nur in Einzelspieler-Welten.
 *
 * @since 8
 */
public interface WorldMap {
	/** Woher die Farben kommen */
	enum Colors {
		/** Durchschnittsfarbe der Block-Textur von oben (mit Biom-Färbung für Gras, Laub und Wasser) – wie die Welt aussieht */
		TEXTURE,
		/** die Farben der Minecraft-Karten (Item „Karte“) */
		MAP
	}

	/**
	 * Position und Blickrichtung des Spielers für das gerade gezeichnete Bild, zwischen zwei Ticks weich
	 * (anders als {@link HeldixApi#playerState()}, das nur jeden Tick neu liest) – damit eine Minimap ruckelfrei läuft.
	 *
	 * @param yaw wie {@link PlayerState#yaw()}: 0 = Süden, 90 = Westen, 180 = Norden, 270 = Osten
	 */
	record View(double x, double y, double z, float yaw) {
	}

	/** Ist gerade eine Welt geladen? */
	boolean available();

	/** Dimension, z. B. "minecraft:overworld"; ohne Welt "" */
	String dimension();

	/** Position und Blickrichtung für das aktuelle Bild; ohne Welt null */
	View view();

	/** Hat die Dimension eine Decke (z. B. der Nether)? Dann zeigt {@link #sampleSurface} nur das Dach. */
	boolean hasCeiling();

	/** Tiefste und höchste mögliche Blockhöhe der Dimension */
	int minY();

	int maxY();

	/** Höhe des obersten Blocks an dieser Spalte, oder {@link Integer#MIN_VALUE}, wenn der Chunk nicht geladen ist */
	int surfaceY(int x, int z);

	/** Darf {@link #sampleBelow} gerade unter die Oberfläche schauen? (nur in Einzelspieler-Welten) */
	boolean undergroundAllowed();

	/**
	 * Oberfläche eines Rechtecks abtasten. Die Felder haben mindestens {@code width * depth} Einträge, Index
	 * {@code dz * width + dx} für die Spalte (minX + dx, minZ + dz).
	 *
	 * @param colors      Farbe (ARGB, deckend) des obersten sichtbaren Blocks; 0 = nicht geladen
	 * @param heights     Höhe dieses Blocks (bei Wasser die Wasseroberfläche); darf null sein
	 * @param waterDepths Wassertiefe in Blöcken (0 = kein Wasser); darf null sein
	 * @return Anzahl der geladenen Spalten
	 */
	int sampleSurface(int minX, int minZ, int width, int depth, Colors mode, int[] colors, int[] heights, int[] waterDepths);

	/**
	 * Wie {@link #sampleSurface}, aber der oberste Block in Höhe {@code topY} oder darunter (bis zu 48 Blöcke tief) –
	 * für Höhlen oder den Nether. Nur, wenn {@link #undergroundAllowed()}; sonst bleiben alle Spalten 0.
	 *
	 * @return Anzahl der gefundenen Spalten
	 */
	int sampleBelow(int minX, int minZ, int width, int depth, int topY, Colors mode, int[] colors, int[] heights, int[] waterDepths);
}
