package dev.heldixclient.api;

/**
 * Beschreibung eines Moduls.
 *
 * @param id               eindeutig innerhalb des Addons, z. B. "uhrzeit"
 * @param name             Anzeigename im Heldix-Menü
 * @param description      kurze Beschreibung (ca. 25 Zeichen passen auf die Karte)
 * @param enabledByDefault beim ersten Start eingeschaltet?
 * @param defaultX         Startposition des HUD-Elements (GUI-Pixel)
 * @param defaultY         Startposition des HUD-Elements (GUI-Pixel)
 */
public record ModuleSpec(String id, String name, String description, boolean enabledByDefault, int defaultX, int defaultY) {
	public ModuleSpec {
		if (id == null || !id.matches("[a-z0-9_-]+")) {
			throw new IllegalArgumentException("Modul-ID darf nur a-z, 0-9, _ und - enthalten: " + id);
		}
	}

	public static ModuleSpec of(String id, String name, String description) {
		return new ModuleSpec(id, name, description, true, 4, 120);
	}

	public ModuleSpec at(int x, int y) {
		return new ModuleSpec(id, name, description, enabledByDefault, x, y);
	}

	public ModuleSpec disabledByDefault() {
		return new ModuleSpec(id, name, description, false, defaultX, defaultY);
	}
}
