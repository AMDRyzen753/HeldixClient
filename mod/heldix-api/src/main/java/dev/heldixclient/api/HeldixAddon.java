package dev.heldixclient.api;

/**
 * Einstiegspunkt eines Heldix-Addons.
 *
 * <p>Ein Addon ist eine JAR-Datei im Ordner {@code heldix-addons/} einer Instanz mit einer
 * {@code heldix.addon.json}, deren Feld {@code entrypoint} auf eine Klasse zeigt, die dieses
 * Interface implementiert und einen öffentlichen Konstruktor ohne Parameter hat.
 */
public interface HeldixAddon {
	/** Wird einmal beim Spielstart aufgerufen. Hier Module und Event-Listener registrieren. */
	void onEnable(HeldixApi api);

	/** Wird beim Beenden des Spiels aufgerufen. */
	default void onDisable() {
	}
}
