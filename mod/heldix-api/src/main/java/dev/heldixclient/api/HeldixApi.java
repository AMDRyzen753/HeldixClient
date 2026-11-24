package dev.heldixclient.api;

import java.nio.file.Path;
import java.util.Optional;

/** Alles, was ein Addon vom HeldixClient nutzen kann. Jedes Addon bekommt seine eigene Instanz. */
public interface HeldixApi {
	/**
	 * Version der API. Addons geben in heldix.addon.json an, für welche sie gebaut sind.
	 * Neuere Versionen erweitern die API nur; Addons für eine ältere Version laufen weiter.
	 * Version 2: Tasten, Einblendungen, Modul-Einstellungen, Bilder und Heldix-Schrift im HUD.
	 */
	int API_VERSION = 2;

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

	// --- ab API 2 ---------------------------------------------------------------------------

	/**
	 * Eigene Taste. Sie erscheint unter Optionen → Steuerung in der Gruppe „Heldix-Addons“ und kann dort
	 * umbelegt werden. Nur in {@link HeldixAddon#onEnable(HeldixApi)} aufrufen.
	 *
	 * @param id         eindeutig innerhalb des Addons, z. B. "play-pause"
	 * @param name       Anzeigename in der Steuerung, z. B. "Abspielen/Pause" (der Addon-Name wird davorgesetzt)
	 * @param defaultKey Standardtaste, siehe {@link HeldixKeys} ({@link HeldixKeys#NONE} = nicht belegt)
	 * @param onPress    läuft im Haupt-Thread bei jedem Druck (nur im Spiel, nicht in Menüs)
	 * @since 2
	 */
	KeyHandle registerKey(String id, String name, int defaultKey, Runnable onPress);

	/**
	 * Kurze Einblendung oben rechts im Spiel (z. B. „Jetzt läuft …“). Eine neue Einblendung desselben Addons
	 * ersetzt die vorige, solange diese noch sichtbar ist. Darf aus jedem Thread aufgerufen werden.
	 *
	 * @since 2
	 */
	void notify(String title, String message);

	/**
	 * Wie {@link #notify(String, String)}, mit einem quadratischen Bild (PNG) links, z. B. einem Album-Cover.
	 *
	 * @param image PNG-Datei oder null
	 * @since 2
	 */
	void notify(String title, String message, Path image);

	/**
	 * Eigener Ordner des Addons für Dateien und Zwischenspeicher (config/heldix-addons/&lt;addon-id&gt;/).
	 * Wird beim ersten Aufruf angelegt.
	 *
	 * @since 2
	 */
	Path dataDirectory();
}
