package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.cosmetic.CapeCloth;
import dev.heldixclient.cosmetic.Capes;
import dev.heldixclient.cosmetic.Cosmetics;
import dev.heldixclient.cosmetic.ElytraForm;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;

import java.io.InputStream;
import java.util.List;

/**
 * Cape-Fix eines externen Entwicklers (ruhiges Cape, keine schwarzen Ränder, Elytra-Formen) und die neuen Capes
 * (Matrix für alle; Matrix Rot, Matrix Türkis und Sakura Orange nur fürs Team): Liste und Team-Sperre im Client,
 * Flügelform der Elytra in den Bildern und beim Laden, {@code bleed} für durchsichtige Pixel, Aufnahmen von hinten.
 */
final class CapeFixTests {
	private CapeFixTests() {
	}

	static void run(TestContext t) {
		// --- neue Capes und Team-Sperre -------------------------------------------------------------
		List<String> ids = t.compute(mc -> Capes.builtin().stream().map(Capes.Cape::id).toList());
		t.check("Capes: 13 eingebaute, darunter Matrix und die drei Team-Capes (" + ids.size() + ")", ids.size() == 13
				&& ids.containsAll(List.of("matrix", "matrix_rot", "matrix_tuerkis", "sakura_orange")));
		t.check("Capes: Matrix für alle, Matrix Rot/Türkis und Sakura Orange nur fürs Team", t.compute(mc -> !Capes.byId("matrix").teamOnly()
				&& Capes.byId("matrix_rot").teamOnly() && Capes.byId("matrix_tuerkis").teamOnly() && Capes.byId("sakura_orange").teamOnly()
				&& !Capes.byId("heldix").teamOnly()));
		boolean team = t.compute(mc -> Cosmetics.team());
		String before = t.compute(mc -> HeldixConfig.get().cape);
		t.run(mc -> HeldixConfig.get().cape = "matrix_rot");
		Capes.Cape shown = t.compute(mc -> Capes.selected());
		t.check("Capes: Team-Cape " + (team ? "im Team getragen" : "ohne Team nicht getragen (Einstellung bleibt)"),
				team ? shown != null && shown.id().equals("matrix_rot") : shown == null && "matrix_rot".equals(t.compute(mc -> HeldixConfig.get().cape)));
		t.run(mc -> HeldixConfig.get().cape = before);

		// --- Elytra-Formen in den Bildern ------------------------------------------------------------
		for (String id : List.of("heldix", "aurora", "matrix", "sakura_orange")) {
			boolean[] result = t.compute(mc -> frontEmpty(mc, id));
			t.check("Elytra: " + id + " hat eine Flügelform (Vorderseite leer, Rückseite bemalt)", result[0] && result[1]);
		}
		// alte Rechteck-Bilder bekommen beim Laden die normale Form
		boolean shaped = t.compute(mc -> {
			try (NativeImage image = new NativeImage(64, 32, false)) {
				for (int y = 0; y < 32; y++) for (int x = 0; x < 64; x++) image.setPixel(x, y, 0xFF3366CC);
				boolean changed = ElytraForm.ensure(image);
				return changed && !ElytraForm.frontPainted(image) && (image.getPixel(22, 0) >>> 24) == 0 && (image.getPixel(40, 10) >>> 24) != 0;
			}
		});
		t.check("Elytra: Rechteck-Bild bekommt die normale Form", shaped);

		// --- bleed: durchsichtige Pixel bekommen die Farbe der Nachbarn, bleiben aber durchsichtig ----------
		int[] argb = new int[4 * 4];
		argb[5] = 0xFFFF0000;
		boolean changed = CapeCloth.bleed(argb, 4, 4);
		t.check("Cape-Fix: durchsichtige Pixel ohne Schwarz (bleed)", changed && (argb[0] >>> 24) == 0 && (argb[0] & 0xFFFFFF) == 0xFF0000
				&& argb[5] == 0xFFFF0000);

		// --- Aufnahmen: Matrix von hinten, mit Elytra ----------------------------------------------------
		t.run(mc -> {
			mc.gui.setScreen(null);
			mc.options.setCameraType(CameraType.THIRD_PERSON_BACK);
			Capes.select(Capes.byId("matrix"));
		});
		t.waitTicks(20);
		t.screenshot("heldix-03l-cape-matrix");
		t.serverCommand("item replace entity @p armor.chest with minecraft:elytra");
		t.run(mc -> HeldixConfig.get().capeElytra = true);
		t.waitTicks(10);
		t.screenshot("heldix-03m-cape-elytra");
		t.serverCommand("item replace entity @p armor.chest with minecraft:air");
		t.run(mc -> {
			Capes.select(Capes.byId(before == null || before.isEmpty() ? "heldix" : before));
			mc.options.setCameraType(CameraType.FIRST_PERSON);
		});
		t.waitTicks(2);
	}

	/** {Vorderseite des Flügels leer, Rückseite bemalt} im ersten Bild eines eingebauten Capes (aus den Ressourcen) */
	private static boolean[] frontEmpty(Minecraft mc, String id) {
		Identifier file = Identifier.fromNamespaceAndPath("heldixclient", "textures/cape/" + id + ".png");
		try (InputStream in = mc.getResourceManager().open(file); NativeImage strip = NativeImage.read(in)) {
			int width = strip.getWidth();
			int frameHeight = width / 2;
			try (NativeImage frame = new NativeImage(width, frameHeight, false)) {
				for (int y = 0; y < frameHeight; y++) for (int x = 0; x < width; x++) frame.setPixel(x, y, strip.getPixel(x, y));
				int s = width / 64;
				boolean back = false;
				for (int y = 2 * s; y < 22 * s && !back; y++) {
					for (int x = 36 * s; x < 46 * s; x++) {
						if ((frame.getPixel(x, y) >>> 24) != 0) {
							back = true;
							break;
						}
					}
				}
				return new boolean[] {!ElytraForm.frontPainted(frame), back};
			}
		} catch (Exception e) {
			return new boolean[] {false, false};
		}
	}
}
