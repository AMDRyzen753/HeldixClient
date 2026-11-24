package dev.heldixclient.loader.api;

/**
 * Einstiegspunkt einer Heldix-Mod. In der heldix.mod.json eintragen:
 * <pre>"entrypoints": { "client": ["meine.mod.MeineMod"] }</pre>
 */
@FunctionalInterface
public interface HeldixModInitializer {
	/**
	 * Wird einmal beim Start im Hauptthread aufgerufen, direkt nachdem Minecraft erzeugt wurde –
	 * vor Optionen, Ressourcen und Fenster-Inhalten. Hier Tasten, Events und Module registrieren.
	 */
	void onInitialize();
}
