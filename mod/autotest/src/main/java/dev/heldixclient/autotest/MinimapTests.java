package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.addon.AddonImages;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.WaypointInfo;
import dev.heldixclient.api.WorldMap;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.waypoint.Waypoints;

import java.util.List;

/**
 * Autotest des Minimap-Addons und der Addon-API 8 im Einzelspieler: Oberfläche aus {@code worldMap()} (Kartenfarben und
 * Texturfarben, Höhen), Höhlenansicht nur im Einzelspieler, eigenes Bild im HUD ({@code createImage}), Wegpunkte lesen,
 * Zoom per Taste. Am Ende ist das Modul wieder aus (spätere Aufnahmen bleiben unverändert).
 */
final class MinimapTests {

	private MinimapTests() {
	}

	private static Module module(TestContext t, String id) {
		return t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null));
	}

	static void run(TestContext t) {
		LoadedAddon addon = t.compute(mc -> AddonManager.addons().stream().filter(a -> a.id().equals("minimap")).findFirst().orElse(null));
		Module minimap = module(t, "minimap:minimap");
		t.check("Minimap: Addon aktiv (API 8)", addon != null && addon.isActive() && minimap != null);
		if (addon == null || minimap == null) return;
		HeldixApi api = t.compute(mc -> addon.api());
		Object instance = t.compute(mc -> addon.instance());
		t.setScreen(() -> null);

		// --- API: Oberfläche von oben ---------------------------------------------------------
		int[] player = t.compute(mc -> new int[] {mc.player.getBlockX(), mc.player.getBlockY(), mc.player.getBlockZ()});
		WorldMap world = api.worldMap();
		t.check("Welt von oben: Welt geladen (" + t.compute(mc -> world.dimension()) + ")", t.compute(mc -> world.available() && !world.dimension().isEmpty()));
		int surface = t.compute(mc -> world.surfaceY(player[0], player[2]));
		t.check("Welt von oben: Oberfläche unter dem Spieler (" + surface + ", Spieler " + player[1] + ")", surface != Integer.MIN_VALUE
				&& surface < player[1] && player[1] - surface <= 12);
		int[] map = new int[32 * 32];
		int[] heights = new int[32 * 32];
		int[] water = new int[32 * 32];
		int loaded = t.compute(mc -> world.sampleSurface(player[0] - 16, player[2] - 16, 32, 32, WorldMap.Colors.MAP, map, heights, water));
		t.check("Welt von oben: 32×32 Spalten gelesen (" + loaded + ")", loaded == 32 * 32);
		int center = 16 * 32 + 16;
		t.check("Welt von oben: Farbe und Höhe unter dem Spieler (" + Integer.toHexString(map[center]) + ", y " + heights[center] + ")",
				(map[center] >>> 24) == 0xFF && heights[center] == surface);
		// Texturfarben: das Budget je Tick kann beim ersten Mal noch Kartenfarben liefern – ein paar Ticks lang lesen
		int[] texture = new int[32 * 32];
		for (int i = 0; i < 6; i++) {
			t.compute(mc -> world.sampleSurface(player[0] - 16, player[2] - 16, 32, 32, WorldMap.Colors.TEXTURE, texture, null, null));
			t.waitTicks(1);
		}
		int tex = texture[center];
		t.log("Minimap Farben unter dem Spieler: Karte " + Integer.toHexString(map[center]) + ", Textur " + Integer.toHexString(tex));
		t.check("Welt von oben: Texturfarbe anders als Kartenfarbe", (tex >>> 24) == 0xFF && tex != map[center]);
		boolean grassy = ((map[center] >> 8) & 0xFF) > ((map[center] >> 16) & 0xFF);
		if (grassy) t.check("Welt von oben: Gras ist in Texturfarben grün", ((tex >> 8) & 0xFF) > ((tex >> 16) & 0xFF) && ((tex >> 8) & 0xFF) > (tex & 0xFF));
		t.check("Welt von oben: Höhlenansicht im Einzelspieler erlaubt", t.compute(mc -> world.undergroundAllowed()));
		int below = t.compute(mc -> world.sampleBelow(player[0] - 8, player[2] - 8, 16, 16, player[1] - 2, WorldMap.Colors.MAP, new int[256], null, null));
		t.check("Welt von oben: unter einer Höhe gelesen (" + below + ")", below > 0);
		boolean rejected;
		try {
			t.compute(mc -> world.sampleSurface(0, 0, 16, 16, WorldMap.Colors.MAP, new int[10], null, null));
			rejected = false;
		} catch (RuntimeException e) {
			rejected = true;
		}
		t.check("Welt von oben: zu kleines Feld abgelehnt", rejected);

		// --- API: Wegpunkte lesen ----------------------------------------------------------------
		Waypoints.Waypoint added = t.compute(mc -> Waypoints.add(mc, "Minimap-Test"));
		List<WaypointInfo> waypoints = t.compute(mc -> api.waypoints());
		t.check("Wegpunkte lesen: „Minimap-Test“ dabei", waypoints.stream().anyMatch(w -> w.name().equals("Minimap-Test") && w.x() == player[0]));

		// --- Minimap im HUD ------------------------------------------------------------------------
		t.run(mc -> minimap.setEnabled(true));
		t.waitSoft(mc -> ((Number) invoke(instance, "loadedColumns")).intValue() > 256 * 9, 10);
		t.waitSoft(mc -> ((Number) invoke(instance, "framesDrawn")).intValue() > 0, 5);
		int tiles = ((Number) invoke(instance, "tileCount")).intValue();
		t.check("Minimap: Chunks gelesen (" + tiles + " Chunks, " + invoke(instance, "loadedColumns") + " Spalten)", tiles >= 9);
		t.check("Minimap: Bild im HUD gezeichnet (" + invoke(instance, "framesDrawn") + ")", ((Number) invoke(instance, "framesDrawn")).intValue() > 0);
		t.check("Minimap: eigenes Bild angelegt (createImage)", AddonImages.open("minimap") >= 1);
		int windowColor = ((Number) invoke(instance, "windowColor", player[0], player[2])).intValue();
		t.check("Minimap: Farbe unter dem Spieler im Kartenfenster", (windowColor >>> 24) == 0xFF && windowColor != 0xFF141A26);
		t.waitTicks(10);
		t.screenshot("minimap-01");

		// Zoom per Taste (Plus auf dem Ziffernblock); vorher über den Regler auf 96 zurück (der Zoom bleibt sonst gespeichert)
		resetZoom(t, minimap);
		double before = ((Number) invoke(instance, "currentView")).doubleValue();
		t.pressKey(InputConstants.KEY_ADD);
		t.waitTicks(2);
		double after = ((Number) invoke(instance, "currentView")).doubleValue();
		t.check("Minimap: Hereinzoomen per Taste (" + Math.round(before) + " → " + Math.round(after) + " Blöcke)", after < before);

		// Eckig, Norden oben, Kartenfarben
		choice(t, minimap, "Form", 1);
		toggle(t, minimap, "Karte dreht sich mit", false);
		choice(t, minimap, "Farben", 1);
		int framesBefore = ((Number) invoke(instance, "framesDrawn")).intValue();
		t.waitTicks(20);
		t.check("Minimap: eckig mit Kartenfarben neu gezeichnet", ((Number) invoke(instance, "framesDrawn")).intValue() > framesBefore);
		t.screenshot("minimap-02-eckig");
		choice(t, minimap, "Form", 0);
		toggle(t, minimap, "Karte dreht sich mit", true);
		choice(t, minimap, "Farben", 0);

		// aufräumen: Zoom zurück, Modul aus, Wegpunkt weg
		resetZoom(t, minimap);
		t.run(mc -> minimap.setEnabled(false));
		if (added != null) t.run(mc -> Waypoints.remove(mc, added));
		t.check("Minimap: Modul aus", t.compute(mc -> !minimap.isEnabled()));
	}

	/** Regler „Sichtweite“ kurz verstellen und zurück: Das setzt einen mit Tasten geänderten Zoom auf 96 Blöcke zurück */
	private static void resetZoom(TestContext t, Module module) {
		Setting.Slider view = t.compute(mc -> module.settings().stream().filter(s -> s.label().equals("Sichtweite")).map(s -> (Setting.Slider) s).findFirst().orElseThrow());
		t.run(mc -> view.set().accept(112));
		t.waitTicks(3);
		t.run(mc -> view.set().accept(96));
		t.waitTicks(3);
	}

	private static void choice(TestContext t, Module module, String label, int value) {
		t.run(mc -> module.settings().stream().filter(s -> s.label().equals(label)).map(s -> (Setting.Choice) s).findFirst().orElseThrow().set().accept(value));
	}

	private static void toggle(TestContext t, Module module, String label, boolean value) {
		t.run(mc -> module.settings().stream().filter(s -> s.label().equals(label)).map(s -> (Setting.Toggle) s).findFirst().orElseThrow().set().accept(value));
	}

	/** Methode des Addons über Reflexion (eigener Klassenlader) */
	private static Object invoke(Object target, String name, Object... args) {
		try {
			for (var method : target.getClass().getMethods()) {
				if (method.getName().equals(name) && method.getParameterCount() == args.length) return method.invoke(target, args);
			}
			throw new IllegalStateException("Methode " + name + " fehlt");
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}
}
