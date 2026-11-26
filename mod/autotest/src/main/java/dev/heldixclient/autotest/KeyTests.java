package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.screen.HeldixMenuScreen;
import net.minecraft.client.KeyMapping;

import java.util.List;

/**
 * Autotest der Tasten im Untermenü der Module: Ein/Aus-Taste für jedes Modul, eigene Tasten eingebauter Module (Zoom),
 * Belegen per Klick und Tastendruck (Esc bricht ab, Entf löscht, ↺ setzt den Standard), Wirkung im Spiel und die
 * Addon-API (addKey bei der Uhrzeit, showKey bei Spotify, zu späte Tasten).
 */
final class KeyTests {
	private KeyTests() {
	}

	private static Module module(TestContext t, String id) {
		Module module = t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null));
		if (module == null) throw new AssertionError("Modul " + id + " fehlt");
		return module;
	}

	private static List<String> keyLabels(TestContext t, Module module) {
		return t.compute(mc -> module.keys().stream().map(Setting::label).toList());
	}

	private static int[] chip(TestContext t, String label) {
		int[] center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).keyChipCenter(label));
		if (center == null) throw new AssertionError("Tasten-Chip „" + label + "“ nicht im Bild");
		return center;
	}

	static void run(TestContext t) {
		t.check("Tasten: jedes Modul hat eine Ein/Aus-Taste", t.compute(mc -> ModuleManager.all().stream().allMatch(m -> m.toggleKey() != null)));
		Module zoom = module(t, "zoom");
		t.check("Tasten: Zoom zeigt seine Taste und Ein/Aus (" + keyLabels(t, zoom) + ")", keyLabels(t, zoom).equals(List.of("Zoom", "Ein/Aus")));

		// Untermenü FPS: Ein/Aus-Taste per Klick und Tastendruck belegen
		Module fps = module(t, "fps");
		KeyMapping fpsKey = t.compute(mc -> fps.toggleKey());
		t.setScreen(() -> HeldixMenuScreen.moduleSettings(null, fps, "Ein/Aus"));
		t.waitTicks(10);
		int[] center = chip(t, "Ein/Aus");
		t.click(center[0], center[1]);
		t.check("Tasten: Klick auf den Chip wartet auf eine Taste", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).capturingKey()));
		t.screenshot("tasten-01-warten");
		t.pressKey(InputConstants.KEY_J);
		t.check("Tasten: J belegt („" + t.compute(mc -> fpsKey.saveString()) + "“)", t.compute(mc -> fpsKey.saveString()).equals("key.keyboard.j")
				&& !t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).capturingKey()));
		t.moveMouse(5, 5);
		t.screenshot("tasten-02-belegt");

		// im Spiel: J schaltet FPS um
		t.setScreen(() -> null);
		t.waitTicks(3);
		boolean before = t.compute(mc -> fps.isEnabled());
		t.pressKey(InputConstants.KEY_J);
		t.waitTicks(3);
		t.check("Tasten: J schaltet FPS im Spiel um", t.compute(mc -> fps.isEnabled()) != before);
		t.pressKey(InputConstants.KEY_J);
		t.waitTicks(3);
		t.check("Tasten: noch einmal J schaltet zurück", t.compute(mc -> fps.isEnabled()) == before);

		// Esc bricht ab, Entf löscht die Belegung
		t.setScreen(() -> HeldixMenuScreen.moduleSettings(null, fps, "Ein/Aus"));
		t.waitTicks(10);
		center = chip(t, "Ein/Aus");
		t.click(center[0], center[1]);
		t.pressKey(InputConstants.KEY_ESCAPE);
		t.check("Tasten: Esc bricht ab, Menü bleibt offen, J bleibt", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu && !menu.capturingKey())
				&& t.compute(mc -> fpsKey.saveString()).equals("key.keyboard.j"));
		center = chip(t, "Ein/Aus");
		t.click(center[0], center[1]);
		t.pressKey(InputConstants.KEY_DELETE);
		t.check("Tasten: Entf löscht die Belegung", t.compute(fpsKeyUnbound(fpsKey)));

		// Zoom auf K umlegen, dann mit ↺ zurück auf den Standard (C)
		t.setScreen(() -> HeldixMenuScreen.moduleSettings(null, zoom, "Zoom"));
		t.waitTicks(10);
		center = chip(t, "Zoom");
		t.click(center[0], center[1]);
		t.pressKey(InputConstants.KEY_K);
		t.check("Tasten: Zoom auf K", t.compute(mc -> HeldixClient.zoomKey.saveString()).equals("key.keyboard.k"));
		t.waitTicks(3);
		int[] reset = chip(t, "Zoom#reset");
		t.click(reset[0], reset[1]);
		t.check("Tasten: ↺ setzt Zoom zurück auf den Standard", t.compute(mc -> HeldixClient.zoomKey.isDefault()));

		// Addon-API: addKey (Uhrzeit), showKey (Spotify), zu späte Tasten
		Module clock = module(t, "uhrzeit:uhrzeit");
		t.check("Addon-API: addKey – „Uhrzeit im Chat“ im Untermenü (" + keyLabels(t, clock) + ")", keyLabels(t, clock).contains("Uhrzeit im Chat"));
		Module spotify = module(t, "spotify:spotify");
		t.check("Addon-API: showKey – Spotify zeigt seine Musik-Tasten", keyLabels(t, spotify).containsAll(List.of("Abspielen/Pause", "Nächster Song", "Song im Chat teilen")));
		t.check("Addon-API: addKey nach dem Start wird abgelehnt", t.compute(mc -> {
			try {
				((ModuleHandle) clock).addKey("spaet", "Zu spät", "", HeldixKeys.NONE, () -> {
				});
				return false;
			} catch (IllegalStateException expected) {
				return true;
			}
		}));
		t.setScreen(() -> HeldixMenuScreen.moduleSettings(null, clock, "Uhrzeit im Chat"));
		t.waitTicks(10);
		t.screenshot("tasten-03-addon-uhrzeit");
		KeyMapping tell = t.compute(mc -> ((Setting.Key) clock.keys().stream().filter(k -> k.label().equals("Uhrzeit im Chat")).findFirst().orElseThrow()).mapping());
		t.run(mc -> {
			tell.setKey(InputConstants.Type.KEYBOARD.getOrCreate(InputConstants.KEY_U));
			KeyMapping.resetMapping();
		});
		t.setScreen(() -> null);
		t.waitTicks(3);
		t.pressKey(InputConstants.KEY_U);
		t.waitTicks(5);
		// api.chat schreibt nur in den eigenen Chat (neueste Nachricht oben)
		List<String> newest = HudTests.chat(t, 3);
		t.check("Addon-API: Taste „Uhrzeit im Chat“ wirkt im Spiel (" + newest + ")", newest.stream().anyMatch(m -> m.contains("Es ist")));
		t.run(mc -> {
			tell.setKey(InputConstants.UNKNOWN);
			KeyMapping.resetMapping();
			mc.options.save();
		});
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(5);
	}

	private static java.util.function.Function<net.minecraft.client.Minecraft, Boolean> fpsKeyUnbound(KeyMapping key) {
		return mc -> key.isUnbound();
	}
}
