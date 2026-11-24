package dev.heldixclient.api;

import java.util.Optional;

/** Alles, was ein Addon vom HeldixClient nutzen kann. Jedes Addon bekommt seine eigene Instanz. */
public interface HeldixApi {
	/** Hauptversion der API. Addons geben in heldix.addon.json an, für welche sie gebaut sind. */
	int API_VERSION = 1;

	/** Informationen über das eigene Addon (aus heldix.addon.json). */
	AddonInfo addon();

	/** Version des HeldixClient, z. B. "0.4.0". */
	String clientVersion();

	/** Version des Heldix Loaders, z. B. "1.0.0". */
	String loaderVersion();

	/** Minecraft-Version, z. B. "26.3". */
	String minecraftVersion();

	/** Logger mit dem Namen des Addons. */
	HeldixLogger logger();

	/** Event-Listener (Tick, Welt betreten/verlassen, Chat). */
	HeldixEvents events();

	/** Modul ohne HUD-Element, das im Heldix-Menü an- und ausgeschaltet werden kann. */
	ModuleHandle registerModule(ModuleSpec spec);

	/** Modul mit verschiebbarem HUD-Element. Der Renderer wird jeden Frame aufgerufen, solange das Modul an ist. */
	ModuleHandle registerHudModule(ModuleSpec spec, HudRenderer renderer);

	/** Der eigene Spieler, falls gerade eine Welt geladen ist. */
	Optional<PlayerInfo> player();

	/** Zeigt eine Nachricht nur lokal im eigenen Chat an (wird nicht an den Server gesendet). */
	void chat(String message);

	/** Einfache, dauerhaft gespeicherte Einstellungen des Addons. */
	AddonConfig config();
}
