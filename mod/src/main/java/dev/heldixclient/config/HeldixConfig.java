package dev.heldixclient.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.HeldixLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Einfache JSON-Konfiguration unter config/heldixclient.json. */
public final class HeldixConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path FILE = HeldixLoader.configDir().resolve(HeldixClient.MOD_ID + ".json");

	private static Data data = new Data();

	public static final class ModuleState {
		public boolean enabled;
		/** zuletzt gezeichnete Position (GUI-Pixel, linke obere Ecke); bis 0.13.1 die einzige Angabe */
		public int x;
		public int y;
		/**
		 * HUD-Elemente: Bezugspunkt am Bildschirm ("top-left", "top-center", … "bottom-right", siehe HudAnchor) und
		 * Abstand dazu in GUI-Pixeln. null = noch alte Angabe (x/y), wird beim ersten Zeichnen umgerechnet.
		 */
		public String anchor;
		public int anchorX;
		public int anchorY;
		/** Einstellungen des Moduls (Untermenü), als Text gespeichert */
		public Map<String, String> options = new LinkedHashMap<>();

		public ModuleState() {
		}

		public ModuleState(boolean enabled, int x, int y) {
			this.enabled = enabled;
			this.x = x;
			this.y = y;
		}

		/** Tiefe Kopie (Rückgängig im HUD-Editor) */
		public ModuleState copy() {
			ModuleState copy = new ModuleState(enabled, x, y);
			copy.anchor = anchor;
			copy.anchorX = anchorX;
			copy.anchorY = anchorY;
			copy.options = new LinkedHashMap<>(options);
			return copy;
		}

		/** Zustand aus einer Kopie übernehmen (ohne die Kopie selbst zu teilen) */
		public void restore(ModuleState from) {
			enabled = from.enabled;
			x = from.x;
			y = from.y;
			anchor = from.anchor;
			anchorX = from.anchorX;
			anchorY = from.anchorY;
			options = new LinkedHashMap<>(from.options);
		}

		@Override
		public boolean equals(Object other) {
			return other instanceof ModuleState s && s.enabled == enabled && s.x == x && s.y == y && java.util.Objects.equals(s.anchor, anchor)
					&& s.anchorX == anchorX && s.anchorY == anchorY && s.options.equals(options);
		}

		@Override
		public int hashCode() {
			return java.util.Objects.hash(enabled, x, y, anchor, anchorX, anchorY, options);
		}
	}

	public static final class Data {
		public Map<String, ModuleState> modules = new LinkedHashMap<>();
		public float zoomFactor = 4.0f;
		public boolean zoomSmooth = true;
		public boolean zoomCinematicCamera = true;
		/** HUD: Hintergrund hinter den Elementen (einzelne Elemente können das im HUD-Editor ändern) */
		public boolean hudBackground = true;
		/** HUD-Stil: 0 = Heldix, 1 = Minimal, 2 = Klassisch (siehe HudStyles) */
		public int hudStyle;
		/** Deckkraft des HUD-Hintergrunds (0 bis 1) */
		public float hudOpacity = 0.72f;
		/** Größe aller HUD-Elemente (mit der Größe des einzelnen Elements multipliziert) */
		public float hudScale = 1f;
		/** Akzentfarbe des HUD (ARGB), 0 = die des Stils */
		public int hudAccent;
		/** Größen so runden, dass Schrift und Kanten auf ganzen Bildschirmpixeln liegen */
		public boolean hudCrisp = true;
		/** HUD-Elemente ausblenden, solange das F3-Menü offen ist */
		public boolean hudHideDebug = true;
		/** HUD-Elemente ausblenden, solange der Chat offen ist (dann nur mit der Taste „HUD bedienen“ klickbar) */
		public boolean hudHideChat;
		/** HUD-Elemente bei offenem Chat anklickbar (Aktionen, Tooltips) */
		public boolean hudClickable = true;
		/** Heldix-Design für Hauptmenü, Buttons, Listen und Hintergründe (false = Vanilla) */
		public boolean customMenus = true;
		/** Aktiver Shader-Stil (siehe ShaderPreset), "aus" = keiner */
		public String shader = "aus";
		/** FPS begrenzen, solange das Fenster nicht im Vordergrund ist */
		public boolean backgroundFps = true;
		public int backgroundFpsLimit = 30;
		/** FPS-Boost aktiv: die vorherigen Werte der geänderten Grafikoptionen (null = aus) */
		public Map<String, String> fpsBoost;
		/** F3-Zeilen von HeldixClient wurden einmalig eingeschaltet (danach entscheidet der Spieler) */
		public boolean debugEntrySeeded;
		/** Ladebildschirm im Heldix-Design */
		public boolean customLoadingScreen = true;
		/** F3-Menü im Heldix-Design */
		public boolean customDebugScreen = true;
		/** Hauptmenü und Heldix-Seiten: eigener Hintergrund statt des Minecraft-Panoramas */
		public boolean heldixBackground = true;
		/** HUD-Editor: Raster anzeigen und an Rändern/anderen Elementen einrasten */
		public boolean hudGrid = true;
		public boolean hudSnap = true;
		/** HUD-Editor: Hilfslinien beim Ziehen (Mitte, Ränder, Kanten anderer Elemente) */
		public boolean hudGuides = true;
		/** Cape des eigenen Spielers: ID eines Heldix-Capes, "datei:<name>.png" für ein eigenes Bild, "" = keins */
		public String cape = "heldix";
		/** Elytra im Design des Capes */
		public boolean capeElytra = true;
		/** Capes bewegen sich (animierte Motive) */
		public boolean capeAnimation = true;
		/** leuchtende Teile der Capes (auch im Dunkeln hell) */
		public boolean capeGlow = true;
		/** Capes als wehender Stoff zeichnen statt als starre Platte (für alle Spieler) */
		public boolean capeCloth = true;
		/** Heldix-Dienst nutzen (aus = keine Verbindung, z. B. nach dem Löschen der Daten) */
		public boolean socialEnabled = true;
		/** Adresse des Heldix-Dienstes (leer = die vom Launcher, -Dheldixclient.service) */
		public String serviceUrl;
		/** Für andere als HeldixClient-Spieler erkennbar (Symbol in der Tab-Liste, Cape) */
		public boolean socialVisible = true;
		/** Freunde sehen den Online-Status */
		public boolean socialPresence = true;
		/** Freunde sehen den Server */
		public boolean socialShowServer = true;
		/** Einblendungen bei Anfragen und wenn Freunde online kommen */
		public boolean socialNotifications = true;
		/** Heldix-Capes anderer Spieler zeigen */
		public boolean socialCapes = true;
		/** Cosmetics anderer HeldixClient-Spieler zeigen (Hüte, Flügel, Begleiter, Partikel) */
		public boolean cosmeticsOthers = true;
		/** Partikel (Aura) anderer Spieler zeigen */
		public boolean cosmeticParticlesOthers = true;
		/** Hüte und Kopf-Cosmetics über einem Helm zeigen (aus: mit Helm ausblenden) */
		public boolean cosmeticHatOverHelmet = true;
		/** zuletzt bekannte eigene Auswahl an Cosmetics (Slot → ID), vom Heldix-Dienst; gilt sofort nach dem Start */
		public Map<String, String> cosmetics = new LinkedHashMap<>();
		/** Heldix-Symbol (mit Rolle) vor Namen in der Tab-Liste, dazu die Zeile „HeldixClient: … Spieler hier“ */
		public boolean badgeTabList = true;
		/** Heldix-Symbol (mit Rolle) im Namensschild über den Köpfen anderer Spieler */
		public boolean badgeNameTags = true;
		/** Nachrichten von Freunden annehmen */
		public boolean socialMessages = true;
		/** Party: dem Leiter automatisch folgen – nur aus dem Hauptmenü bzw. Menüs ohne Welt, nie aus einer Welt */
		public boolean partyAutoFollow;
		/**
		 * Freundesvorschläge aus der Nähe: HeldixClient-Spieler, mit denen man mindestens 10 Minuten in der Nähe gespielt hat
		 * (nur auf diesem PC, 30 Tage, heldixclient-nearby.json); aus = nichts merken, Gemerktes löschen
		 */
		public boolean nearbySuggestions = true;
		/** Schnellschalter auf der Übersicht und im Pausemenü (Modul-Ids); null = Standardauswahl */
		public java.util.List<String> quickModules;
		/** zuletzt betretener Server (für "Weiterspielen" im Hauptmenü) */
		public String lastServerIp;
		public String lastServerName;
		/** Zeitpunkt (ms) des letzten Server-Besuchs */
		public long lastServerAt;
		/** Heldix Shader-Engine: Stärke der Effekte (0 = aus, 1 = voll) */
		public float bloom;
		public float depthOfField;
		public float fog;
		public float ambientOcclusion;
	}

	private HeldixConfig() {
	}

	public static Data get() {
		return data;
	}

	public static ModuleState module(String id, boolean defaultEnabled, int defaultX, int defaultY) {
		return data.modules.computeIfAbsent(id, k -> new ModuleState(defaultEnabled, defaultX, defaultY));
	}

	public static void load() {
		if (Files.exists(FILE)) {
			try (Reader reader = Files.newBufferedReader(FILE)) {
				Data loaded = GSON.fromJson(reader, Data.class);
				if (loaded != null) {
					if (loaded.modules == null) loaded.modules = new LinkedHashMap<>();
					for (ModuleState state : loaded.modules.values()) {
						if (state.options == null) state.options = new LinkedHashMap<>();
					}
					data = loaded;
				}
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Konfiguration konnte nicht gelesen werden, nutze Standardwerte", e);
			}
		}
	}

	public static void save() {
		try {
			Files.createDirectories(FILE.getParent());
			try (Writer writer = Files.newBufferedWriter(FILE)) {
				GSON.toJson(data, writer);
			}
		} catch (IOException e) {
			HeldixClient.LOGGER.warn("Konfiguration konnte nicht gespeichert werden", e);
		}
	}
}
