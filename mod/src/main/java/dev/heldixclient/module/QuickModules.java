package dev.heldixclient.module;

import dev.heldixclient.config.HeldixConfig;

import java.util.ArrayList;
import java.util.List;

/**
 * Schnellschalter: Module, die Übersicht und Pausemenü zum direkten An- und Ausschalten zeigen. Der Spieler wählt sie
 * im Untermenü eines Moduls („In den Schnellschaltern“); bis dahin gilt eine Standardauswahl.
 */
public final class QuickModules {
	/** Standardauswahl, wichtigste zuerst, mit kurzen Namen für die Schalter */
	private static final String[][] DEFAULTS = {
			{"togglesprint", "Dauersprint"}, {"freelook", "Freelook"}, {"crosshair", "Fadenkreuz"}, {"waypoints", "Wegpunkte"},
			{"zoom", "Zoom"}, {"fps", "FPS"}, {"coordinates", "Koordinaten"}, {"effects", "Effekte"}};
	/** höchstens so viele Schnellschalter */
	public static final int MAX = 12;

	private QuickModules() {
	}

	private static List<String> ids() {
		List<String> chosen = HeldixConfig.get().quickModules;
		if (chosen != null) return chosen;
		List<String> ids = new ArrayList<>();
		for (String[] entry : DEFAULTS) ids.add(entry[0]);
		return ids;
	}

	/** die gewählten Module (nur vorhandene), höchstens {@code max} */
	public static List<Module> list(int max) {
		List<Module> list = new ArrayList<>();
		for (String id : ids()) {
			if (list.size() >= max) break;
			for (Module module : ModuleManager.all()) {
				if (module.id().equals(id)) {
					list.add(module);
					break;
				}
			}
		}
		return list;
	}

	public static boolean contains(Module module) {
		return ids().contains(module.id());
	}

	/** Modul in die Schnellschalter aufnehmen (hinten) oder entfernen */
	public static void set(Module module, boolean on) {
		List<String> ids = new ArrayList<>();
		for (Module existing : list(MAX)) ids.add(existing.id());
		ids.remove(module.id());
		if (on) {
			if (ids.size() >= MAX) ids.removeFirst();
			ids.add(module.id());
		}
		HeldixConfig.get().quickModules = ids;
		HeldixConfig.save();
	}

	/** kurzer Name für einen Schalter */
	public static String shortName(Module module) {
		for (String[] entry : DEFAULTS) if (entry[0].equals(module.id())) return entry[1];
		return module.name();
	}
}
