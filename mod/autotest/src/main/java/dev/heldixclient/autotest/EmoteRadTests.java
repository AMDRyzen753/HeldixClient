package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Emote-Rad (Addon eines externen Entwicklers, greift per Reflexion in die Spieler-Renderer von Minecraft 26.3 ein):
 * als Addon mit Zugriff auf Minecraft geladen, eigene Renderer nur bei eingeschaltetem Modul, Rad auf J, ein Emote
 * läuft und wird gemeldet, keine Fehler. Am Ende ist das Modul an (wie ab Werk).
 */
final class EmoteRadTests {
	private EmoteRadTests() {
	}

	static void run(TestContext t) {
		LoadedAddon emotes = t.compute(mc -> AddonManager.addons().stream().filter(a -> a.id().equals("emoterad")).findFirst().orElse(null));
		t.check("Emote-Rad: Addon aktiv, mit Zugriff auf Minecraft", emotes != null && emotes.isActive() && emotes.minecraftAccess());
		if (emotes == null) return;
		Module module = t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals("emoterad:emoterad")).findFirst().orElse(null));
		t.check("Emote-Rad: Modul da", module != null);
		if (module == null) return;
		int errors = t.compute(mc -> emotes.errorCount());

		t.run(mc -> module.setEnabled(false));
		t.waitTicks(3);
		t.check("Emote-Rad aus: Minecrafts eigene Spieler-Renderer", t.compute(mc -> rendererNames(mc).stream().noneMatch(n -> n.endsWith("EmoteAvatarRenderer"))));
		t.run(mc -> module.setEnabled(true));
		t.waitTicks(3);
		t.check("Emote-Rad an: Spieler-Renderer mit Emotes " + t.compute(EmoteRadTests::rendererNames),
				t.compute(mc -> rendererNames(mc).stream().allMatch(n -> n.endsWith("EmoteAvatarRenderer"))));

		// Rad mit J (kurz getippt: bleibt offen), oberes Feld anklicken
		t.setScreen(() -> null);
		t.pressKey(InputConstants.KEY_J);
		t.waitTicks(3);
		String screen = t.compute(mc -> mc.gui.screen() == null ? "keiner" : mc.gui.screen().getClass().getSimpleName());
		t.check("Emote-Rad: Taste J öffnet das Rad (" + screen + ")", screen.equals("EmoteWheelScreen"));
		t.screenshot("addon-emoterad-01");
		int[] top = t.compute(mc -> new int[] {mc.getWindow().getGuiScaledWidth() / 2, mc.getWindow().getGuiScaledHeight() / 2 - 50});
		t.click(top[0], top[1]);
		t.waitTicks(2);
		t.check("Emote-Rad: Klick auf ein Feld schließt das Rad", t.compute(mc -> mc.gui.screen() == null));
		t.run(mc -> mc.options.setCameraType(CameraType.THIRD_PERSON_FRONT));
		t.waitSoft(mc -> !System.getProperty("heldix.emote.lokal", "").isEmpty(), 5);
		String emote = System.getProperty("heldix.emote.lokal", "");
		t.check("Emote-Rad: Emote läuft (" + emote + ")", !emote.isEmpty());
		t.waitTicks(20);
		t.screenshot("addon-emoterad-02-emote");
		// Emote beenden: Modul kurz aus (Renderer zurück, keine Meldung mehr) und wieder an
		t.run(mc -> module.setEnabled(false));
		t.waitTicks(3);
		t.check("Emote-Rad aus: Emote beendet und nicht mehr gemeldet", System.getProperty("heldix.emote.lokal", "").isEmpty());
		t.run(mc -> {
			module.setEnabled(true);
			mc.options.setCameraType(CameraType.FIRST_PERSON);
		});
		t.setScreen(() -> null);
		t.check("Emote-Rad: keine Fehler", t.compute(mc -> emotes.errorCount() == errors && emotes.isActive()));
	}

	@SuppressWarnings("unchecked")
	private static List<String> rendererNames(Minecraft mc) {
		try {
			List<String> names = new ArrayList<>();
			for (Object renderer : ((Map<Object, Object>) field(mc.getEntityRenderDispatcher(), "playerRenderers")).values()) {
				names.add(renderer.getClass().getSimpleName());
			}
			return names;
		} catch (ReflectiveOperationException e) {
			return List.of("Fehler: " + e);
		}
	}

	private static Object field(Object owner, String name) throws ReflectiveOperationException {
		for (Class<?> c = owner.getClass(); c != null; c = c.getSuperclass()) {
			try {
				Field f = c.getDeclaredField(name);
				f.setAccessible(true);
				return f.get(owner);
			} catch (NoSuchFieldException ignored) {
				// in der Oberklasse weitersuchen
			}
		}
		throw new NoSuchFieldException(name);
	}
}
