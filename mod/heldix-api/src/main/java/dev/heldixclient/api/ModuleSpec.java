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
 * @param icon             Icon im Heldix-Menü aus dem Heldix-Icon-Set, z. B. "music" (null = Puzzleteil; ab API 2)
 */
public record ModuleSpec(String id, String name, String description, boolean enabledByDefault, int defaultX, int defaultY, String icon) {
	public ModuleSpec {
		if (id == null || !id.matches("[a-z0-9_-]+")) {
			throw new IllegalArgumentException("Modul-ID darf nur a-z, 0-9, _ und - enthalten: " + id);
		}
	}

	/** Konstruktor aus API 1 (ohne Icon) */
	public ModuleSpec(String id, String name, String description, boolean enabledByDefault, int defaultX, int defaultY) {
		this(id, name, description, enabledByDefault, defaultX, defaultY, null);
	}

	public static ModuleSpec of(String id, String name, String description) {
		return new ModuleSpec(id, name, description, true, 4, 120, null);
	}

	public ModuleSpec at(int x, int y) {
		return new ModuleSpec(id, name, description, enabledByDefault, x, y, icon);
	}

	public ModuleSpec disabledByDefault() {
		return new ModuleSpec(id, name, description, false, defaultX, defaultY, icon);
	}

	/**
	 * Icon für Karte und HUD-Editor, z. B. "music", "clock", "chat", "star" (siehe docs/addons.md).
	 *
	 * @since 2
	 */
	public ModuleSpec withIcon(String icon) {
		return new ModuleSpec(id, name, description, enabledByDefault, defaultX, defaultY, icon);
	}
}
