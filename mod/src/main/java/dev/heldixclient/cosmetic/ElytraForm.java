package dev.heldixclient.cosmetic;

import com.mojang.blaze3d.platform.NativeImage;

/**
 * Flügelform der Elytra für Cape-Bilder (HeldixCapeFix 2). Minecraft zeichnet jeden Elytra-Flügel als flachen Kasten
 * 10 × 20 × 2 von beiden Seiten; seine Form entsteht nur aus durchsichtigen Pixeln. Ist alles deckend, sieht die Elytra
 * aus wie zwei dicke Rechtecke. Vanilla lässt deshalb die Vorderseite (24,2) leer und bemalt nur die Rückseite (36,2)
 * mit den Rändern, beschnitten auf einen Flügelumriss.
 * <p>
 * Die eingebauten Capes bekommen ihre Form schon im Generator ({@code launcher/scripts/render-capes.mjs}, dort auch
 * die Sonderformen). Diese Klasse sichert alles andere ab: Jedes Bild, dessen Vorderseite bemalt ist (alte Bilder,
 * von Hand gemalte, eigene Bilder als Cape), bekommt beim Laden die normale Form. Bilder mit leerer Vorderseite haben
 * schon eine Form und bleiben unverändert.
 */
public final class ElytraForm {
	/**
	 * Normale Form (Umriss der Vanilla-Elytra) im Raster der Cape-Vorlage: Spalten u22…u45, Zeilen v0…v21;
	 * '#' sichtbar, '.' durchsichtig. Gleich wie {@code ELYTRA_FORMS.normal} im Generator.
	 */
	static final String[] NORMAL = {
			".........#########......", "..........##............", "............########....", "............#########...",
			".............#########..", ".............#########..", ".............#########..", ".............##########.",
			".............##########.", ".............##########.", ".............##########.", "#.............##########",
			"#.............##########", "#.............##########", "#.............##########", "#.............##########",
			"#..............#########", "#..............#########", "#..............#########", "#...............########",
			"#...............########", "#................#######",
	};

	private ElytraForm() {
	}

	/** Pixel je Texel bei einem Bild im Seitenverhältnis 2 : 1 der Cape-Vorlage, sonst 0 */
	private static int scale(NativeImage image) {
		int s = image.getWidth() / 64;
		return s >= 1 && image.getWidth() == 64 * s && image.getHeight() == 32 * s ? s : 0;
	}

	/** true, wenn auf der Vorderseite des Flügels (u24…u33, v2…v21) etwas Sichtbares liegt – Rechteck-Flügel */
	public static boolean frontPainted(NativeImage image) {
		int s = scale(image);
		if (s == 0) return false;
		for (int y = 2 * s; y < 22 * s; y++) {
			for (int x = 24 * s; x < 34 * s; x++) {
				if ((image.getPixel(x, y) >>> 24) != 0) return true;
			}
		}
		return false;
	}

	/** Normale Form anwenden: im Elytra-Bereich (u22…u45, v0…v21) alles außerhalb des Umrisses durchsichtig machen */
	public static void applyNormal(NativeImage image) {
		int s = scale(image);
		if (s == 0) return;
		for (int ty = 0; ty < NORMAL.length; ty++) {
			for (int tx = 0; tx < 24; tx++) {
				if (NORMAL[ty].charAt(tx) == '#') continue;
				for (int y = ty * s; y < (ty + 1) * s; y++) {
					for (int x = (22 + tx) * s; x < (23 + tx) * s; x++) image.setPixel(x, y, 0);
				}
			}
		}
	}

	/**
	 * Bilder ohne eigene Flügelform (bemalte Vorderseite) bekommen die normale Form.
	 *
	 * @return true, wenn das Bild geändert wurde
	 */
	public static boolean ensure(NativeImage image) {
		if (!frontPainted(image)) return false;
		applyNormal(image);
		return true;
	}
}
