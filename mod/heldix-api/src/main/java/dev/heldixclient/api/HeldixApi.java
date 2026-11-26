package dev.heldixclient.api;

import java.nio.file.Path;
import java.util.Optional;

/** Alles, was ein Addon vom HeldixClient nutzen kann. Jedes Addon bekommt seine eigene Instanz. */
public interface HeldixApi {
	/**
	 * Version der API. Addons geben in heldix.addon.json an, für welche sie gebaut sind.
	 * Neuere Versionen erweitern die API nur; Addons für eine ältere Version laufen weiter.
	 * Version 2: Tasten, Einblendungen, Modul-Einstellungen, Bilder und Heldix-Schrift im HUD.
	 * Version 3: weitere Events, Spiel- und Spielerdaten, Scheduler, Chat-Befehle, Chat an den Server,
	 * Regler/Farbe/Text als Einstellungen, neue Zeichenhilfen im HUD.
	 * Version 4: Lage und Drehung der gedroppten Items in der Welt ({@link #droppedItems()}), Heldix-Cosmetics lesen,
	 * lokal vorführen und kurz animieren ({@link #cosmetics()}).
	 * Version 5: anklickbare HUD-Elemente ({@link HudRenderer#onClick}, {@link HudCanvas#hotspot}), HUD-Stil lesen
	 * ({@link HudCanvas#style()}), Stil-Optionen im HUD-Editor ({@link ModuleHandle#addStyleToggle}) und weitere
	 * Zeichenhilfen.
	 * Version 6: Tasten im Untermenü eines Moduls ({@link ModuleHandle#addKey}, {@link ModuleHandle#showKey}), andere
	 * Spieler ({@link #nearbyPlayers()}), Spielermenü ({@link #addPlayerMenuEntry}), Symbole am Namensschild
	 * ({@link #playerMarkers()}) und Sprachkanal über den Heldix-Dienst ({@link #voice()}).
	 */
	int API_VERSION = 6;

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

	// --- ab API 3 ---------------------------------------------------------------------------

	/**
	 * Momentaufnahme des Spiels: FPS, Ping, Server, Tageszeit, Wetter, offenes Menü usw. Gibt es immer, auch im
	 * Hauptmenü (dann sind die Werte leer bzw. -1). Aus einem anderen Thread kommt der Stand des letzten Ticks.
	 *
	 * @since 3
	 */
	GameInfo game();

	/**
	 * Ausführliche Momentaufnahme des eigenen Spielers (Blickrichtung, Tempo, Rüstung, Erfahrung, Items in Hand und
	 * Rüstung, Trank-Effekte …), falls gerade eine Welt geladen ist. Aus einem anderen Thread kommt der Stand des
	 * letzten Ticks.
	 *
	 * @since 3
	 */
	Optional<PlayerState> playerState();

	/**
	 * Aufgaben später, wiederholt oder im Hintergrund ausführen. Alles, was noch geplant ist, wird abgebrochen,
	 * wenn das Addon abgeschaltet wird oder das Spiel endet.
	 *
	 * @since 3
	 */
	Scheduler scheduler();

	/**
	 * Eigener Chat-Befehl: Tippt der Spieler „.name …“ in den Chat, läuft der Handler im Haupt-Thread und der Text
	 * geht <b>nicht</b> an den Server. „.hilfe“ listet alle Addon-Befehle, Tab ergänzt den Namen. Belegt schon ein
	 * anderes Addon den Namen, ist der Befehl nur als „.&lt;addon-id&gt;:name“ erreichbar.
	 *
	 * @param name        a-z, 0-9, _ und -, ohne Punkt, z. B. "np"
	 * @param usage       was nach dem Namen kommen kann, z. B. "[teilen]" (leer = nichts); steht in „.hilfe“
	 * @param description kurz, z. B. "Zeigt den laufenden Song"
	 * @return zum Abmelden des Befehls
	 * @since 3
	 */
	Registration registerCommand(String name, String usage, String description, CommandHandler handler);

	/**
	 * Schickt eine Chatnachricht an den Server – alle Spieler sehen sie. Das geht nur als direkte Folge einer
	 * Aktion des Spielers: in einer Taste ({@link #registerKey}), einem Chat-Befehl ({@link #registerCommand}) oder
	 * einem Knopf im Untermenü ({@link ModuleHandle#addAction}), und dort höchstens einmal. Überall sonst (Ticks,
	 * Events, Scheduler, HUD) wirft der Aufruf eine {@link IllegalStateException}, damit Addons nicht spammen können;
	 * der Fehler zählt dann wie jeder Addon-Fehler.
	 *
	 * <p>Befehle mit „/“ sind nicht erlaubt. Farbcodes (§) und Steuerzeichen werden entfernt, höchstens 256 Zeichen.
	 *
	 * @return false, wenn keine Welt geladen ist oder nach dem Bereinigen nichts übrig bleibt
	 * @since 3
	 */
	boolean sendChatMessage(String message);

	// --- ab API 4 ---------------------------------------------------------------------------

	/**
	 * Zeichnen der gedroppten Items in der Welt verändern (Items, die auf dem Boden liegen oder durch die Luft
	 * fliegen), z. B. für „Item Physics“: Ein {@link DroppedItemRenderer} legt für jedes Item in jedem Bild Höhe und
	 * Drehung fest, statt dass es schwebt und sich dreht. Rein optisch und nur auf dem eigenen Client – Hitbox,
	 * Aufsammeln und Spielablauf bleiben gleich.
	 *
	 * @since 4
	 */
	DroppedItems droppedItems();

	/**
	 * Heldix-Cosmetics (Hüte, Flügel, Partikel, Begleiter, Capes aus dem Katalog des Teams): Katalog und Auswahl lesen,
	 * ein Cosmetic nur für dich als Vorschau zeigen, kurze Effekte am eigenen Cosmetic auslösen und auf Änderungen der
	 * eigenen Auswahl hören. Die Auswahl selbst ändert nur der Spieler (Heldix-Menü, Launcher, Webseite).
	 *
	 * @since 4
	 */
	Cosmetics cosmetics();

	// --- ab API 6 ---------------------------------------------------------------------------

	/**
	 * Andere Spieler in der geladenen Welt, nächster zuerst (ohne dich). Ohne Welt leer. Nur im Haupt-Thread aufrufen.
	 *
	 * @since 6
	 */
	java.util.List<NearbyPlayer> nearbyPlayers();

	/**
	 * Sprachkanal über den Heldix-Dienst (für Voice Chat in der Nähe).
	 *
	 * @since 6
	 */
	VoiceChannel voice();

	/**
	 * Symbole am Namensschild über dem Kopf anderer Spieler.
	 *
	 * @since 6
	 */
	PlayerMarkers playerMarkers();

	/**
	 * Eigener Eintrag im Spielermenü (Mausrad-Klick auf einen Spieler). Die Einträge erscheinen in der Reihenfolge der
	 * Anmeldung nach denen von HeldixClient.
	 *
	 * @since 6
	 */
	Registration addPlayerMenuEntry(PlayerMenuEntry entry);
}
