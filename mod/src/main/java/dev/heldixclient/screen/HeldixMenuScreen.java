package dev.heldixclient.screen;

import com.mojang.blaze3d.Blaze3D;
import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.device.GpuDevice;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.account.AccountSwitcher;
import dev.heldixclient.account.LauncherAccount;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.AddonStore;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.cosmetic.Capes;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.render.DebugOverlay;
import dev.heldixclient.render.Performance;
import dev.heldixclient.render.ShaderEngine;
import dev.heldixclient.render.ShaderPreset;
import dev.heldixclient.render.Shaders;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.social.Badge;
import dev.heldixclient.social.BadgeDisplay;
import dev.heldixclient.social.Messages;
import dev.heldixclient.social.Party;
import dev.heldixclient.social.Social;
import dev.heldixclient.social.Suggestions;
import dev.heldixclient.waypoint.Waypoints;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.FormattedCharSequence;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.DoubleSupplier;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

/**
 * Heldix-Bereiche der gemeinsamen Oberfläche: Übersicht, Module, Grafik, Wegpunkte, Cape, Freunde und Einstellungen.
 * Jede Kategorie hat ihre Unter-Menüs als Reiter unter dem Seitenkopf (z. B. Freunde: Freunde, Anfragen, Privatsphäre);
 * Einstellungen stehen in Gruppen-Karten. Module erscheinen als Kacheln mit Icon; das Regler-Symbol öffnet die
 * Einstellungen eines Moduls. Im Spiel öffnet die Rechte Umschalttaste dieses Menü.
 */
public class HeldixMenuScreen extends ShellScreen {
	private static final int GAP = 8;
	private static final int TILE_H = 66;
	private static final int TILE_MIN_W = 118;
	private static final int CHIP_H = 22;
	private static final int ADDON_H = 46;

	/** Reiter der Seite Module */
	private enum Filter {
		ALL("Alle", "modules"),
		HUD("HUD", "hud"),
		FEATURES("Funktionen", "sparkles"),
		ADDONS("Addons", "addons");

		final String label;
		final String icon;

		Filter(String label, String icon) {
			this.label = label;
			this.icon = icon;
		}

		boolean matches(Module module) {
			return switch (this) {
				case ALL -> true;
				case HUD -> module instanceof HudModule && module.source() == null;
				case FEATURES -> !(module instanceof HudModule) && module.source() == null;
				case ADDONS -> module.source() != null;
			};
		}
	}

	/** Reiter der Seite Cape */
	private enum CapeTab {
		HELDIX("Heldix-Capes", "cape"),
		CUSTOM("Eigene Capes", "image"),
		OPTIONS("Optionen", "options");

		final String label;
		final String icon;

		CapeTab(String label, String icon) {
			this.label = label;
			this.icon = icon;
		}
	}

	/** Reiter der Seite Cosmetics: je Slot einer, dazu Optionen */
	private enum CosmeticTab {
		HEAD("Kopf", "star", "head"),
		BACK("Rücken", "cape", "back"),
		AURA("Aura", "sparkles", "aura"),
		COMPANION("Begleiter", "user", "companion"),
		OPTIONS("Optionen", "options", null);

		final String label;
		final String icon;
		/** Slot beim Heldix-Dienst (null = Optionen) */
		final String slot;

		CosmeticTab(String label, String icon, String slot) {
			this.label = label;
			this.icon = icon;
			this.slot = slot;
		}
	}

	/** Reiter der Seite Wegpunkte */
	private enum WaypointTab {
		LIST("Wegpunkte", "pin"),
		DISPLAY("Anzeige", "eye");

		final String label;
		final String icon;

		WaypointTab(String label, String icon) {
			this.label = label;
			this.icon = icon;
		}
	}

	private final Screen parent;
	/** direkt mit Untermenü geöffnet (z. B. aus dem HUD-Editor): "Zurück" führt dorthin zurück */
	private final boolean directSubmenu;
	/** Animationswerte (Schalter, Hover) je Objekt */
	private final Map<Object, Float> anim = new HashMap<>();
	private long lastFrame = System.nanoTime();
	private float frameDt;
	/** geöffnetes Untermenü (Einstellungen eines Moduls), sonst null */
	private Module openModule;
	private double scroll;
	private SearchField search;
	private String searchText = "";
	private Filter filter = Filter.ALL;
	private CapeTab capeTab = CapeTab.HELDIX;
	private WaypointTab waypointTab = WaypointTab.LIST;
	/** Addon-Store: aufgeklappte Karte und Bestätigung für Entfernen */
	private String storeOpen;
	private String storeConfirmRemove;
	private long storeConfirmAt;
	private List<Row> rows = List.of();

	private Setting.Slider dragging;
	private float dragX;
	private float dragW;
	/** Untermenü: Eingabefelder der Text-Einstellungen (nach Beschriftung), sie folgen ihrer Zeile beim Scrollen */
	private final Map<String, SearchField> textFields = new HashMap<>();
	/** Untermenü: Farbeinstellung, deren Palette gerade aufgeklappt ist (Beschriftung) */
	private String colorOpen;
	/** Palette gerade aufgeklappt: beim nächsten Zeichnen ganz ins Bild holen */
	private boolean revealPalette;
	/** Taste, die gerade auf einen neuen Tastendruck wartet (Einstellung „Taste“), sonst null */
	private KeyMapping keyCapture;
	/** im laufenden Klick abgebrochenes Warten (damit derselbe Chip es nicht gleich neu startet) */
	private KeyMapping captureCancelled;
	/** Mitte der Bedienelemente aus dem letzten Bild (für den Autotest) */
	private final Map<String, int[]> settingCenters = new HashMap<>();

	/** Seite Cape: Kachel unter der Maus (aus dem letzten Bild) für die Vorschau */
	private static final Object NO_HOVER = new Object();
	/** Kachel "Ohne" */
	private static final Object NO_CAPE = new Object();
	private Object capeHover = NO_HOVER;
	private Object capeHoverShown = NO_HOVER;
	private final long capeStart = System.nanoTime();
	private String capeMessage;
	private boolean capeMessageOk;
	private long capeMessageAt;

	/** Seite Cosmetics: Reiter, Kachel unter der Maus (Vorschau an der Figur), laufende Anfrage, Kleidung der Figur */
	private CosmeticTab cosmeticTab = CosmeticTab.HEAD;
	private Object cosmeticHover = NO_HOVER;
	private Object cosmeticHoverShown = NO_HOVER;
	/** "slot:id" (bzw. "slot:" zum Ablegen), solange die Anfrage beim Dienst läuft */
	private String cosmeticPending;
	private final dev.heldixclient.cosmetic.Cosmetics.Dress cosmeticDress = new dev.heldixclient.cosmetic.Cosmetics.Dress();

	/** Eingabefeld im Kopf der Seiten Freunde (Spielername) und Wegpunkte (Name) */
	private SearchField pageInput;
	private String pageInputText = "";
	private String pageMessage;
	private boolean pageMessageOk;
	private long pageMessageAt;
	/** Zeitpunkt des ersten Klicks auf „Daten beim Dienst löschen“ (0 = keiner) */
	private long confirmDeleteAt;
	/** Freund, dessen Entfernen gerade bestätigt werden muss (zweiter Klick) */
	private java.util.UUID confirmRemove;
	private long confirmAt;
	/** Freund, dessen Server beim zweiten Klick betreten wird (in einer Welt: erst bestätigen) */
	private UUID confirmJoin;
	private long confirmJoinAt;

	/** offener Chat (Seite Nachrichten), sonst null */
	private UUID openChat;
	private String openChatName;
	private SearchField chatInput;
	private String chatText = "";
	/** Abstand des sichtbaren Bereichs vom Ende des Chats (0 = die neuesten Nachrichten bleiben im Blick) */
	private double chatFromBottom;
	private boolean reporting;
	private boolean confirmingBlock;
	/** nach "Melden"/"Blockieren": zum Anfang des Chats, wo die Bestätigung steht */
	private boolean chatToTop;
	/** eigene Nachrichten, die gerade gesendet werden oder nicht ankamen */
	private final List<PendingMessage> pendingMessages = new ArrayList<>();
	/** ungelesene Nachrichten beim Öffnen des Chats (für die Linie „Neue Nachrichten“) */
	private int unreadAtOpen;
	private UUID chatOpenedFor;
	/** Anzahl Nachrichten, als der Verlauf zuletzt ganz unten war (neue darunter: Knopf „Neue Nachricht“) */
	private int seenMessages;
	/** Liste der Unterhaltungen links neben dem Chat (breite Fenster) */
	private double listScroll;
	private static final int LIST_ITEM = 32;
	private String reportReason = "spam";
	/** umbrochene Zeilen der Sprechblasen (je Nachricht und Breite) */
	private final Map<Long, List<FormattedCharSequence>> bubbleLines = new HashMap<>();
	/** offener Chat: Antwort auf diese Nachricht (Leiste über der Eingabe), sonst null */
	private Messages.Message replyTo;
	/** eigene Nachricht, deren Löschen gerade bestätigt werden muss (zweiter Klick) */
	private long confirmDeleteMessage;
	private long confirmDeleteMessageAt;

	/** Profilkarte eines Freundes (Seite Freunde), sonst null */
	private UUID openProfile;
	private Social.Profile profile;
	private String profileError;
	/** Profil: Aktion, die gerade bestätigt werden muss ("remove", "block"), mit Zeitpunkt */
	private String profileConfirm;
	private long profileConfirmAt;
	/** Spitzname und Notiz: Entwurf und wann zuletzt getippt (gespeichert wird nach kurzer Pause in tick) */
	private String nicknameDraft;
	private String noteDraft;
	private long draftChangedAt;
	/** Rechtsklick-Menü (Freunde, Nachrichten) */
	private final dev.heldixclient.ui.ContextMenu menu = new dev.heldixclient.ui.ContextMenu(null, null);
	/** Beitreten (Party-Ziel, Karte im Chat) aus einer Welt heraus: zweiter Klick innerhalb von 4 Sekunden bestätigt */
	private String confirmAddress;
	private long confirmAddressAt;

	private int bodyX;
	private int bodyW;
	private int bodyY;
	private int bodyH;

	public HeldixMenuScreen(Screen parent) {
		this(parent, Shell.Page.OVERVIEW);
	}

	public HeldixMenuScreen(Screen parent, Shell.Page page) {
		this(parent, page, null);
	}

	/** Seite Nachrichten mit offenem Chat (z. B. aus der Freundesliste) */
	public HeldixMenuScreen(Screen parent, UUID chatWith, String name) {
		this(parent, Shell.Page.MESSAGES, null);
		this.openChat = chatWith;
		this.openChatName = name;
	}

	/** Profilkarte eines Freundes (Seite Freunde; „Zurück“ führt zur Liste) */
	public static HeldixMenuScreen profile(Screen parent, UUID friend) {
		HeldixMenuScreen screen = new HeldixMenuScreen(parent, Shell.Page.FRIENDS);
		screen.openProfile = friend;
		return screen;
	}

	/** Chat mit gleich geöffnetem „Melden“ (aus der Profilkarte) */
	public static HeldixMenuScreen chatReport(Screen parent, UUID friend, String name) {
		HeldixMenuScreen screen = new HeldixMenuScreen(parent, friend, name);
		screen.reporting = true;
		screen.chatToTop = true;
		return screen;
	}

	/** Mit geöffnetem Untermenü eines Moduls (z. B. aus dem HUD-Editor per Rechtsklick). */
	public HeldixMenuScreen(Screen parent, Shell.Page page, Module module) {
		super(Component.literal(page.title()), page);
		this.parent = parent;
		this.openModule = module;
		this.directSubmenu = module != null;
	}

	/** Schnellsuche: Einstellungen eines Moduls öffnen („Zurück“ führt zur Liste der Module), optional eine hervorheben */
	public static HeldixMenuScreen moduleSettings(Screen parent, Module module, String setting) {
		HeldixMenuScreen screen = new HeldixMenuScreen(parent, Shell.Page.MODULES);
		screen.openModule = module;
		if (setting != null) screen.highlight("setting:" + setting);
		return screen;
	}

	/**
	 * Schnellsuche: Seite öffnen, optional mit Reiter ({@code "cape:OPTIONS"}, {@code "waypoints:DISPLAY"} …) und
	 * einer hervorgehobenen Zeile ({@code "setting:Beschriftung"}, {@code "addon:id"}, {@code "store:id"}).
	 */
	public static HeldixMenuScreen highlighted(Screen parent, Shell.Page page, String tab, String key) {
		HeldixMenuScreen screen = new HeldixMenuScreen(parent, page);
		if (tab != null) screen.selectTab(tab);
		if (key != null) {
			screen.highlight(key);
			if (key.startsWith("store:")) screen.storeOpen = key.substring(6);
		}
		return screen;
	}

	/** Einstellung einer Heldix-Seite für die Schnellsuche */
	public record SettingEntry(Shell.Page page, String tab, String label, String description, String group) {
	}

	/**
	 * Alle Einstellungen der Seiten Einstellungen, Leistung, Shader, Privatsphäre, Wegpunkte (Anzeige), Cape und Cosmetics
	 * (Optionen): die Seiten werden dafür einmal aufgebaut, aber nicht angezeigt.
	 */
	public static List<SettingEntry> searchableSettings() {
		List<SettingEntry> list = new ArrayList<>();
		Object[][] sources = {{Shell.Page.SETTINGS, null}, {Shell.Page.PERFORMANCE, null}, {Shell.Page.SHADER, null}, {Shell.Page.PRIVACY, null}, {Shell.Page.PARTY, null},
				{Shell.Page.WAYPOINTS, "waypoints:DISPLAY"}, {Shell.Page.CAPE, "cape:OPTIONS"}, {Shell.Page.COSMETICS, "cosmetics:OPTIONS"}};
		for (Object[] source : sources) {
			Shell.Page page = (Shell.Page) source[0];
			String tab = (String) source[1];
			try {
				HeldixMenuScreen screen = new HeldixMenuScreen(null, page);
				if (tab != null) screen.selectTab(tab);
				screen.bodyW = 400;
				for (Row row : screen.buildRows()) collectSettings(row, null, page, tab, list);
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.debug("Schnellsuche: Seite {} nicht durchsuchbar", page, e);
			}
		}
		return list;
	}

	private static void collectSettings(Row row, String group, Shell.Page page, String tab, List<SettingEntry> list) {
		switch (row) {
			case Group card -> {
				for (Row child : card.rows) collectSettings(child, card.title != null ? card.title : group, page, tab, list);
			}
			case Columns columns -> {
				collectSettings(columns.left, group, page, tab, list);
				collectSettings(columns.right, group, page, tab, list);
			}
			case SettingRow setting -> list.add(new SettingEntry(page, tab, setting.setting.label(), setting.setting.description(), group));
			default -> {
			}
		}
	}

	/** Reiter einer Seite setzen ("filter:HUD", "cape:OPTIONS", "cosmetics:OPTIONS", "waypoints:DISPLAY") */
	private void selectTab(String tab) {
		int colon = tab.indexOf(':');
		if (colon < 0) return;
		String value = tab.substring(colon + 1);
		try {
			switch (tab.substring(0, colon)) {
				case "filter" -> filter = Filter.valueOf(value);
				case "cape" -> capeTab = CapeTab.valueOf(value);
				case "cosmetics" -> cosmeticTab = CosmeticTab.valueOf(value);
				case "waypoints" -> waypointTab = WaypointTab.valueOf(value);
				default -> {
				}
			}
		} catch (IllegalArgumentException ignored) {
			// unbekannter Reiter: Standard bleibt
		}
	}

	// ======================================================================================
	// Hervorheben (Schnellsuche)
	// ======================================================================================

	/** hervorgehobene Zeile ("setting:…", "addon:…", "store:…"), sonst null */
	private String highlight;
	private long highlightAt;
	/** beim nächsten Aufbau zur hervorgehobenen Zeile scrollen */
	private boolean highlightScroll;

	private void highlight(String key) {
		highlight = key;
		highlightAt = System.nanoTime();
		highlightScroll = true;
	}

	private boolean highlighted(Row row) {
		if (highlight == null) return false;
		return switch (row) {
			case SettingRow setting -> highlight.equals("setting:" + setting.setting.label());
			case AddonCard card -> highlight.equals("addon:" + card.addon.id());
			case StoreCard card -> highlight.equals("store:" + card.entry.id());
			default -> false;
		};
	}

	/** Lage der hervorgehobenen Zeile {x, y, Breite, Höhe} relativ zum Anfang des Inhalts, sonst null */
	private int[] highlightRect() {
		if (highlight == null) return null;
		int y = 0;
		for (Row row : rows) {
			int[] found = row.find(this::highlighted, bodyW);
			if (found != null) return new int[] {found[0], y + found[1], found[2], found[3]};
			y += row.height(bodyW) + row.gapAfter();
		}
		return null;
	}

	/** Zeile einer Einstellung ins Bild scrollen (oben, mit etwas Abstand) */
	public void scrollToSetting(String label) {
		layout();
		int y = 0;
		for (Row row : rows) {
			int[] found = row.find(r -> r instanceof SettingRow setting && setting.setting.label().equals(label), bodyW);
			if (found != null) {
				scroll = Math.clamp(y + found[1] - 10, 0, maxScroll());
				return;
			}
			y += row.height(bodyW) + row.gapAfter();
		}
	}

	/** Für den Autotest: Schnellschalter der Übersicht ins Bild scrollen */
	public void revealQuickToggles() {
		layout();
		int y = 0;
		for (Row row : rows) {
			int[] found = row.find(r -> r instanceof QuickToggles, bodyW);
			if (found != null) {
				scroll = Math.clamp(y + found[1] - 30, 0, maxScroll());
				return;
			}
			y += row.height(bodyW) + row.gapAfter();
		}
	}

	/** Für den Autotest: Mitte des Schnellschalters Nummer {@code index} auf der Übersicht (aus dem letzten Bild) */
	public int[] quickToggleCenter(int index) {
		return settingCenters.get("quick:" + index);
	}

	/** Für den Autotest: hervorgehobene Zeile (oder null) */
	public String highlightKey() {
		return highlight;
	}

	// ======================================================================================
	// Bedienung mit der Tastatur (Pfeile, Enter, Leertaste)
	// ======================================================================================

	/** Ziel im Inhalt mit eigener Bedienung (Einstellungen): Enter/Leertaste und Pfeil links/rechts */
	private record KeyTarget(float x, float y, float w, float h, Runnable activate, IntConsumer adjust) {
	}

	/** Ziele aus dem letzten Bild (Bildschirm-Koordinaten): gesammelte Hover-Flächen und eigene */
	private List<float[]> frameTargets = List.of();
	private List<KeyTarget> frameKeyTargets = List.of();
	private final List<float[]> collecting = new ArrayList<>();
	private final List<KeyTarget> collectingKeys = new ArrayList<>();
	/** gewähltes Ziel in Inhalts-Koordinaten (y ohne Scrollen), sonst null */
	private float[] keyFocus;
	/** Tastatur-Modus: Hover und Fokusrahmen folgen dem gewählten Ziel statt der Maus */
	private boolean keyMode;
	private double lastMouseX = Double.NaN;
	private double lastMouseY = Double.NaN;
	/** nach dem Scrollen im nächsten Bild noch einmal in diese Richtung gehen (0 = nein) */
	private int pendingMoveX;
	private int pendingMoveY;

	/** Einstellungen melden sich hier als Ziel (statt nur über ihre Hover-Fläche) */
	private void keyTarget(float x, float y, float w, float h, Runnable activate, IntConsumer adjust) {
		collectingKeys.add(new KeyTarget(x, y, w, h, activate, adjust));
	}

	/** gewähltes Ziel auf dem Bildschirm {x, y, w, h} */
	private float[] focusOnScreen() {
		return keyFocus == null ? null : new float[] {keyFocus[0], keyFocus[1] - (float) scroll, keyFocus[2], keyFocus[3]};
	}

	private void setKeyFocus(float[] screenRect) {
		keyFocus = new float[] {screenRect[0], screenRect[1] + (float) scroll, screenRect[2], screenRect[3]};
		keyMode = true;
		// ganz ins Bild holen
		float top = screenRect[1];
		float bottom = screenRect[1] + screenRect[3];
		if (top < bodyY + 2) scroll = Math.clamp(scroll - (bodyY + 2 - top) - 6, 0, maxScroll());
		else if (bottom > bodyY + bodyH - 2) scroll = Math.clamp(scroll + (bottom - bodyY - bodyH + 2) + 6, 0, maxScroll());
	}

	/** Alle Ziele dieses Bilds: eigene der Einstellungen, dazu Hover-Flächen, die nicht in einer davon liegen */
	private List<float[]> allTargets() {
		List<float[]> list = new ArrayList<>();
		for (KeyTarget target : frameKeyTargets) list.add(new float[] {target.x(), target.y(), target.w(), target.h()});
		float area = bodyW * (float) bodyH;
		outer:
		for (float[] t : frameTargets) {
			if (t[2] * t[3] > area * 0.6f) continue;
			if (t[1] + t[3] <= bodyY || t[1] >= bodyY + bodyH) continue;
			float cx = t[0] + t[2] / 2;
			float cy = t[1] + t[3] / 2;
			for (KeyTarget k : frameKeyTargets) if (Ui.inside(cx, cy, k.x(), k.y(), k.w(), k.h())) continue outer;
			for (float[] o : list) if (Math.abs(o[0] - t[0]) < 1 && Math.abs(o[1] - t[1]) < 1 && Math.abs(o[2] - t[2]) < 1 && Math.abs(o[3] - t[3]) < 1) continue outer;
			list.add(t);
		}
		return list;
	}

	/** eigenes Ziel (Einstellung) unter dem Fokus, sonst null */
	private KeyTarget focusedKeyTarget() {
		float[] f = focusOnScreen();
		if (f == null) return null;
		for (KeyTarget k : frameKeyTargets) {
			if (Math.abs(k.x() - f[0]) < 1 && Math.abs(k.y() - f[1]) < 1 && Math.abs(k.w() - f[2]) < 1 && Math.abs(k.h() - f[3]) < 1) return k;
		}
		return null;
	}

	/** Fokus in eine Richtung bewegen (dx, dy je -1/0/1); am Rand wird weitergescrollt */
	private void moveFocus(int dx, int dy) {
		List<float[]> list = allTargets();
		float[] current = focusOnScreen();
		if (current == null || !keyMode) {
			float[] first = null;
			for (float[] t : list) {
				if (t[1] < bodyY || t[1] + t[3] > bodyY + bodyH) continue;
				if (first == null || t[1] < first[1] - 2 || Math.abs(t[1] - first[1]) <= 2 && t[0] < first[0]) first = t;
			}
			if (first != null) setKeyFocus(first);
			return;
		}
		float cx = current[0] + current[2] / 2;
		float cy = current[1] + current[3] / 2;
		float[] best = null;
		float bestScore = Float.MAX_VALUE;
		for (float[] t : list) {
			boolean nested = Ui.inside(t[0] + t[2] / 2, t[1] + t[3] / 2, current[0], current[1], current[2], current[3])
					|| Ui.inside(cx, cy, t[0], t[1], t[2], t[3]);
			// hoch/runter überspringt Flächen in bzw. um das gewählte Ziel (z. B. Zahnrad in einer Kachel)
			if (dy != 0 && nested) continue;
			float tx = t[0] + t[2] / 2;
			float ty = t[1] + t[3] / 2;
			float primary = dy != 0 ? (ty - cy) * dy : (tx - cx) * dx;
			if (primary <= 2) continue;
			float orthogonal = dy != 0 ? Math.abs(tx - cx) : Math.abs(ty - cy);
			float score = primary + orthogonal * 2.5f;
			if (score < bestScore) {
				bestScore = score;
				best = t;
			}
		}
		if (best != null) {
			setKeyFocus(best);
			return;
		}
		// nichts mehr in dieser Richtung zu sehen: weiterscrollen und im nächsten Bild noch einmal versuchen
		if (dy != 0) {
			double before = scroll;
			scroll = Math.clamp(scroll + dy * 48, 0, maxScroll());
			if (scroll != before) {
				pendingMoveX = dx;
				pendingMoveY = dy;
			} else if (dy < 0) {
				// ganz oben: zurück zu den Reitern bzw. der Navigation
				keyMode = false;
				keyFocus = null;
				net.minecraft.client.gui.components.AbstractWidget up = null;
				for (ShellTab tab : tabs) if (tab.selected()) up = tab;
				if (up == null) for (ShellNavButton button : nav) if (button.kind() == ShellNavButton.Kind.PAGE && button.selected()) up = button;
				if (up != null) keyFocusWidget(up);
			}
		}
	}

	/** Enter/Leertaste auf dem gewählten Ziel: eigene Aktion bzw. ein Klick in seine Mitte */
	private void activateFocus() {
		KeyTarget own = focusedKeyTarget();
		if (own != null) {
			if (own.activate() != null) own.activate().run();
			return;
		}
		float[] f = focusOnScreen();
		if (f == null) return;
		var button = new net.minecraft.client.input.MouseButtonInfo(InputConstants.MOUSE_BUTTON_LEFT, 0);
		MouseButtonEvent event = new MouseButtonEvent(f[0] + f[2] / 2, f[1] + f[3] / 2, button);
		mouseClicked(event, false);
		mouseReleased(event);
	}

	/** Für den Autotest: Tastatur-Fokus {x, y, w, h} auf dem Bildschirm, sonst null */
	public float[] keyFocusRect() {
		return keyMode ? focusOnScreen() : null;
	}

	// ======================================================================================
	// Layout
	// ======================================================================================

	/** Chat mit Liste der Unterhaltungen daneben? (breite Fenster) */
	private boolean chatSplit() {
		return openChat != null && contentW >= 470;
	}

	private int chatListW() {
		return Math.clamp(contentW * 30 / 100, 150, 200);
	}

	/** linke Kante und Breite des Chats */
	private int chatX() {
		return chatSplit() ? contentX + chatListW() + 10 : contentX;
	}

	private int chatW() {
		return chatSplit() ? contentW - chatListW() - 10 : contentW;
	}

	private void layout() {
		bodyX = openChat != null ? chatX() : contentX;
		bodyW = (openChat != null ? chatW() : contentW) - 8;
		bodyY = contentY;
		// offener Chat: unten die Eingabe, beim Antworten darüber die Leiste mit dem Bezug
		bodyH = contentH - (openChat != null ? 30 + (replyTo != null ? 18 : 0) : 0);
		rows = buildRows();
		if (openChat != null && chatToTop) {
			chatFromBottom = maxScroll();
			chatToTop = false;
		}
		if (openChat != null) scroll = Math.max(0, maxScroll() - chatFromBottom);
		else scroll = Math.clamp(scroll, 0, maxScroll());
		// aus der Schnellsuche: zur hervorgehobenen Zeile scrollen (Store: sobald er geladen ist, höchstens 5 Sekunden)
		if (highlightScroll && openChat == null) {
			int[] found = highlightRect();
			if (found != null) {
				scroll = Math.clamp(found[1] - bodyH / 4.0, 0, maxScroll());
				highlightScroll = false;
				highlightAt = System.nanoTime();
			} else if (System.nanoTime() - highlightAt > 5_000_000_000L) {
				highlightScroll = false;
			}
		}
	}

	private int contentHeight() {
		int total = 0;
		for (Row row : rows) total += row.height(bodyW) + row.gapAfter();
		return Math.max(0, total);
	}

	private int maxScroll() {
		return Math.max(0, contentHeight() - bodyH);
	}

	/** Y-Position einer Zeile (für Klicks und den Autotest). */
	private int rowY(Row target) {
		int y = bodyY - (int) scroll;
		for (Row row : rows) {
			if (row == target) return y;
			y += row.height(bodyW) + row.gapAfter();
		}
		return y;
	}

	// ======================================================================================
	// Autotest-Hilfen
	// ======================================================================================

	/** Details einer Karte im Addon-Store aufklappen (für den Autotest) */
	public void showStoreDetails(String id) {
		storeOpen = id;
	}

	/** Ids der sichtbaren Reiter (für den Autotest) */
	public List<String> tabIds() {
		return tabs.stream().map(ShellTab::id).toList();
	}

	/**
	 * Zeilen der Seite in Kurzform (für den Autotest): "Section:<Titel>", "Addon:<id>", "Mod:<id>", "Notice:<Text>",
	 * sonst der Name der Zeilenart.
	 */
	public List<String> describeRows() {
		layout();
		List<String> result = new ArrayList<>();
		for (Row row : rows) {
			result.add(switch (row) {
				case Section section -> "Section:" + section.title;
				case AddonCard card -> "Addon:" + card.addon.id();
				case HeldixModCard card -> "Mod:" + card.mod.id();
				case Notice notice -> "Notice:" + notice.text;
				default -> row.getClass().getSimpleName();
			});
		}
		return result;
	}

	/** Konten der Seite Konten in Kurzform (für den Autotest): „Name[:im-spiel][:aktiv][:wechseln|:welt-verlassen]“ */
	public List<String> describeAccounts() {
		layout();
		List<String> result = new ArrayList<>();
		for (Row row : rows) {
			if (!(row instanceof Group group)) continue;
			for (Row child : group.rows) if (child instanceof AccountRow account) result.add(account.describe());
		}
		return result;
	}

	/** Seite Konten so scrollen, dass die Zeile des Kontos zu sehen ist (für den Autotest; Knopf-Mitte ab dem nächsten Bild) */
	public void scrollToAccount(String name) {
		layout();
		for (Row row : rows) {
			if (!(row instanceof Group group)) continue;
			int cy = rowY(group) + group.head();
			for (Row child : group.rows) {
				int ch = group.childHeight(child, bodyW);
				if (child instanceof AccountRow account && account.account.name().equals(name)) {
					scroll = Math.clamp(cy + scroll - bodyY - (bodyH - ch) / 2.0, 0, maxScroll());
					settingCenters.remove("account:" + name);
					return;
				}
				cy += ch;
			}
		}
	}

	/** Mitte des Knopfs „Wechseln“ bzw. „Welt verlassen und wechseln“ eines Kontos (wie zuletzt gezeichnet), null = keiner */
	public int[] accountButtonCenter(String name) {
		return settingCenters.get("account:" + name);
	}

	/** Mitte des Schalters eines Addons auf der Seite Installiert (wie zuletzt gezeichnet), null = nicht zu sehen */
	public int[] addonSwitchCenter(String id) {
		return settingCenters.get("addon:" + id);
	}

	/** Seite so weit scrollen, dass die Karte des Addons oben steht (für den Autotest) */
	public void scrollToAddon(String id) {
		layout();
		for (Row row : rows) {
			if (row instanceof AddonCard card && id.equals(card.addon.id())) {
				scroll = Math.clamp(rowY(row) + scroll - bodyY - 4, 0, maxScroll());
				settingCenters.remove("addon:" + id);
				return;
			}
		}
	}

	/** ganz nach oben scrollen (für den Autotest) */
	public void scrollToTop() {
		scroll = 0;
	}

	/** ganz nach unten scrollen (für den Autotest) */
	public void scrollToEnd() {
		layout();
		scroll = maxScroll();
	}

	/** Mitte des Eintrags Addons (älterer Name, gleich {@code tabCenter("ADDONS")}). */
	public int[] addonsTabCenter() {
		return tabCenter("ADDONS");
	}

	/** Mitte der Modul-Kachel Nummer {@code index} (Seite Module). Ein Klick dort schaltet das Modul um. */
	public int[] cardCenter(int index) {
		layout();
		ModuleGrid grid = first(ModuleGrid.class);
		int[] cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		return new int[] {cell[0] + cell[2] / 2, cell[1] + TILE_H / 2 + 4};
	}

	/** Mitte des Regler-Symbols der Modul-Kachel Nummer {@code index} (öffnet das Untermenü). */
	public int[] settingsIconCenter(int index) {
		layout();
		ModuleGrid grid = first(ModuleGrid.class);
		int[] cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		return new int[] {cell[0] + cell[2] - 16, cell[1] + 17};
	}

	/** Mitte der Kachel Nummer {@code index} in der ersten Kachelreihe (Seite Shader: Farbstile). */
	public int[] shaderCenter(int index) {
		layout();
		Chips chips = first(Chips.class);
		int[] cell = chips.cell(index, bodyX, rowY(chips), bodyW);
		return new int[] {cell[0] + cell[2] / 2, cell[1] + CHIP_H / 2};
	}

	/** Mitte der Cape-Kachel Nummer {@code index} in der ersten Cape-Reihe (0 = "Ohne", dann die Heldix-Capes). */
	public int[] capeCenter(int index) {
		layout();
		CapeGrid grid = first(CapeGrid.class);
		// Kachel in den sichtbaren Bereich scrollen (kleine Fenster)
		int[] cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		if (cell[1] < bodyY || cell[1] + CapeGrid.TILE > bodyY + bodyH) {
			scroll = Math.clamp(scroll + cell[1] - bodyY - (bodyH - CapeGrid.TILE) / 2.0, 0, maxScroll());
			cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		}
		return new int[] {cell[0] + cell[2] / 2, cell[1] + CapeGrid.TILE / 2};
	}

	/** Mitte der Kachel Nummer {@code index} auf der Seite Cosmetics (0 = "Ohne", dann die Cosmetics des Reiters). */
	public int[] cosmeticCenter(int index) {
		layout();
		CosmeticGrid grid = first(CosmeticGrid.class);
		int[] cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		if (cell[1] < bodyY || cell[1] + CosmeticGrid.TILE > bodyY + bodyH) {
			scroll = Math.clamp(scroll + cell[1] - bodyY - (bodyH - CosmeticGrid.TILE) / 2.0, 0, maxScroll());
			cell = grid.cell(index, bodyX, rowY(grid), bodyW);
		}
		return new int[] {cell[0] + cell[2] / 2, cell[1] + CosmeticGrid.TILE / 2};
	}

	/** Reiter der Seite Cosmetics wählen (für den Autotest): head, back, aura, companion oder null = Optionen */
	public void showCosmeticTab(String slot) {
		for (CosmeticTab tab : CosmeticTab.values()) {
			if (java.util.Objects.equals(tab.slot, slot)) cosmeticTab = tab;
		}
		scroll = 0;
	}

	/** Offener Reiter der Seite Cosmetics: Slot oder "options" (für den Autotest) */
	public String cosmeticTab() {
		return cosmeticTab.slot != null ? cosmeticTab.slot : "options";
	}

	/** Kachel unter der Maus aus dem letzten Bild (ID, "" = Ohne, null = keine); für den Autotest */
	public String cosmeticHovered() {
		return cosmeticHoverShown instanceof dev.heldixclient.cosmetic.CosmeticCatalog.Item item ? item.id() : cosmeticHoverShown == NO_CAPE ? "" : null;
	}

	/** Läuft gerade eine Anfrage zum Anlegen/Ablegen? (für den Autotest) */
	public boolean cosmeticPending() {
		return cosmeticPending != null;
	}

	/**
	 * Mitte des Bedienelements der Einstellung {@code label} im offenen Untermenü (wie zuletzt gezeichnet);
	 * mit {@code label + "#" + n} die n-te Farbe der aufgeklappten Palette. null = gerade nicht zu sehen.
	 */
	public int[] settingCenter(String label) {
		return settingCenters.get(label);
	}

	/** ID des Moduls, dessen Untermenü offen ist (null = keins). */
	public String openModuleId() {
		return openModule == null ? null : openModule.id();
	}

	/** Für den Autotest: Zeigt die Freundesliste bei diesem Freund „Beitreten“? */
	public boolean canJoin(UUID friend) {
		Social.Friend found = friendOf(friend);
		return found != null && joinable(found);
	}

	public String currentTab() {
		return page.name();
	}

	private <T extends Row> T first(Class<T> type) {
		for (Row row : rows) {
			if (type.isInstance(row)) return type.cast(row);
		}
		throw new IllegalStateException("Keine " + type.getSimpleName() + " auf der Seite " + page);
	}

	// ======================================================================================
	// Aufbau
	// ======================================================================================

	/** Untermenü: je Text-Einstellung ein Eingabefeld (unsichtbar, bis seine Zeile gezeichnet wird) */
	private void addTextFields() {
		addTextFields(openModule.settings());
	}

	@Override
	protected void initContent() {
		AddonStore.refresh(false);
		search = null;
		pageInput = null;
		pageButton = null;
		chatInput = null;
		textFields.clear();
		menu.close();
		layout();
		if (openChat != null) {
			initChat();
			return;
		}
		if (openProfile != null) {
			initProfile();
			return;
		}
		if (page == Shell.Page.MESSAGES) Messages.loadConversations();
		if (page == Shell.Page.PRIVACY && Social.online()) {
			Messages.loadBlocked();
			Social.refreshMe();
			addTextFields(statusSettings());
		}
		// Freunde 2.0: Vorschläge vom Dienst; Party-Chat gilt als gelesen, solange die Seite Party offen ist
		if (page == Shell.Page.FRIENDS && Social.friends2()) dev.heldixclient.social.Suggestions.load();
		dev.heldixclient.social.Party.setViewingChat(page == Shell.Page.PARTY);
		if (page == Shell.Page.PARTY && Social.friends2()) dev.heldixclient.social.Party.refresh();
		if (page == Shell.Page.ACCOUNTS) {
			// alter Fehler (z. B. aus einer Welt heraus versucht) gilt beim neuen Öffnen nicht mehr
			AccountSwitcher.clearStatus();
			if (AccountSwitcher.available()) AccountSwitcher.refresh();
		}
		if (openModule != null) {
			String back = "Zurück";
			int w = ActionButton.widthFor(back, "back");
			addRenderableWidget(new ActionButton(headerRight() - w, headerButtonY(), w, 20, back, false, this::closeSubmenu).withIcon("back"));
			addTextFields();
		} else if (page == Shell.Page.MODULES) {
			String hud = "HUD-Editor";
			int hw = ActionButton.widthFor(hud, "hud");
			boolean roomy = contentW >= 300;
			if (roomy) {
				addRenderableWidget(new ActionButton(headerRight() - hw, headerButtonY(), hw, 20, hud, true,
						() -> minecraft.gui.setScreen(new HudEditorScreen(this))).withIcon("hud"));
			}
			int w = Math.min(150, contentW / 3);
			int right = roomy ? headerRight() - hw - 6 : headerRight();
			search = new SearchField(right - w, headerButtonY(), w, 20, "Module suchen");
			search.setValue(searchText);
			search.setResponder(text -> {
				searchText = text;
				scroll = 0;
			});
			addRenderableWidget(search);
		} else if (wantsPageInput()) {
			if (page == Shell.Page.WAYPOINTS) addPageInput("Hier setzen", "plus", "Name (optional)", "pin", this::addWaypointHere);
			else if (page == Shell.Page.PARTY) {
				addPageInput("Senden", "send", "Nachricht an die Party", "chat", this::sendPartyChat);
				pageInput.withMaxLength(dev.heldixclient.social.Party.CHAT_MAX);
			} else addPageInput("Anfrage senden", "user-plus", "Spielername", "user", this::sendFriendRequest);
		}
	}

	/** Untermenü bzw. Seite: je Text-Einstellung ein Eingabefeld (unsichtbar, bis seine Zeile gezeichnet wird) */
	private void addTextFields(List<Setting> settings) {
		for (Setting setting : settings) {
			if (!(setting instanceof Setting.Text text) || textFields.containsKey(text.label())) continue;
			SearchField field = new SearchField(0, 0, 120, 20, "Text eingeben").withIcon("edit").withMaxLength(text.maxLength()).keepOnEscape();
			field.setValue(text.get().get());
			field.setResponder(value -> text.set().accept(value));
			field.setOnEnter(() -> {
				field.setFocused(false);
				if (getFocused() == field) setFocused(null);
			});
			field.visible = false;
			addRenderableWidget(field);
			textFields.put(text.label(), field);
		}
	}

	/** Profilkarte: Zurück, Felder für Spitzname und Notiz; das Profil (gemeinsame Freunde) im Hintergrund laden */
	private void initProfile() {
		int bw = ActionButton.widthFor("Zurück", "back");
		addRenderableWidget(new ActionButton(headerRight() - bw, headerButtonY(), bw, 20, "Zurück", false, this::closeProfile).withIcon("back"));
		Social.Friend friend = friendOf(openProfile);
		if (friend != null) {
			if (nicknameDraft == null) nicknameDraft = friend.nickname() == null ? "" : friend.nickname();
			if (noteDraft == null) noteDraft = friend.note() == null ? "" : friend.note();
		}
		addTextFields(profileSettings());
		if (profile == null || !profile.friend().uuid().equals(openProfile)) loadProfile();
	}

	private void loadProfile() {
		UUID id = openProfile;
		profileError = null;
		Social.profile(id).whenComplete((result, error) -> minecraft.execute(() -> {
			if (!id.equals(openProfile)) return;
			if (error != null) profileError = errorText(error);
			else profile = result;
		}));
	}

	/** Profilkarte öffnen (Seite Freunde) */
	private void openProfile(UUID friend) {
		if (page != Shell.Page.FRIENDS || openChat != null) {
			minecraft.gui.setScreen(profile(parent, friend));
			return;
		}
		saveProfileDrafts();
		openProfile = friend;
		profile = null;
		profileConfirm = null;
		nicknameDraft = null;
		noteDraft = null;
		scroll = 0;
		rebuildWidgets();
	}

	private void closeProfile() {
		saveProfileDrafts();
		openProfile = null;
		profile = null;
		nicknameDraft = null;
		noteDraft = null;
		scroll = 0;
		rebuildWidgets();
	}

	/** Spitzname und Notiz speichern, wenn sie sich geändert haben (gleich, ohne auf die Pause zu warten) */
	private void saveProfileDrafts() {
		if (openProfile == null || draftChangedAt == 0) return;
		draftChangedAt = 0;
		Social.Friend friend = friendOf(openProfile);
		if (friend == null) return;
		String nickname = nicknameDraft == null ? "" : nicknameDraft.strip();
		String note = noteDraft == null ? "" : noteDraft.strip();
		if (!nickname.equals(friend.nickname() == null ? "" : friend.nickname())) {
			Social.setNickname(friend.uuid(), nickname).exceptionally(e -> {
				minecraft.execute(() -> pageMessage(errorText(e), false));
				return null;
			});
		}
		if (!note.equals(friend.note() == null ? "" : friend.note())) {
			Social.setNote(friend.uuid(), note).exceptionally(e -> {
				minecraft.execute(() -> pageMessage(errorText(e), false));
				return null;
			});
		}
	}

	/** Einstellungen „Nur für dich“ der Profilkarte (Spitzname, Notiz) */
	private List<Setting> profileSettings() {
		return List.of(
				new Setting.Text("Spitzname", "Steht in deinen Listen statt des Namens – nur du siehst ihn", Social.NICKNAME_MAX,
						() -> nicknameDraft == null ? "" : nicknameDraft, value -> {
							nicknameDraft = value;
							draftChangedAt = System.currentTimeMillis();
						}),
				new Setting.Text("Notiz", "Nur für dich, z. B. woher ihr euch kennt", Social.NOTE_MAX,
						() -> noteDraft == null ? "" : noteDraft, value -> {
							noteDraft = value;
							draftChangedAt = System.currentTimeMillis();
						}));
	}

	/** Eigener Statustext (Seite Privatsphäre): geht nach einer Sekunde ohne Tippen an den Dienst */
	private List<Setting> statusSettings() {
		return List.of(new Setting.Text("Statustext", "Sehen deine Freunde neben deinem Namen (höchstens 40 Zeichen, leer = keiner)", Social.STATUS_MAX,
				() -> Social.me().statusText() == null ? "" : Social.me().statusText(),
				value -> Social.setStatusText(value, message -> pageMessage(message, false))));
	}

	/** Seite Party: Nachricht aus dem Eingabefeld in den Party-Chat */
	private void sendPartyChat() {
		String text = pageInputText.strip();
		if (text.isEmpty() || !dev.heldixclient.social.Party.active()) return;
		click();
		pageInputText = "";
		if (pageInput != null) pageInput.setValue("");
		dev.heldixclient.social.Party.sendChat(text).exceptionally(e -> {
			minecraft.execute(() -> {
				pageMessage(errorText(e), false);
				pageInputText = text;
				if (pageInput != null) pageInput.setValue(text);
			});
			return null;
		});
	}

	/** Chat: Zurück, Melden und Blockieren im Kopf, Eingabe und Senden unten */
	private void initChat() {
		if (!openChat.equals(chatOpenedFor)) {
			chatOpenedFor = openChat;
			unreadAtOpen = Messages.unread(openChat);
			seenMessages = 0;
		}
		Messages.setViewing(openChat);
		Messages.loadHistory(openChat, false);
		if (chatSplit()) Messages.loadConversations();
		int right = headerRight();
		String back = "Zurück";
		int bw = ActionButton.widthFor(back, "back");
		addRenderableWidget(new ActionButton(right - bw, headerButtonY(), bw, 20, back, false, this::closeChat).withIcon("back"));
		right -= bw + 6;
		Social.Friend friend = friendOf(openChat);
		if (friend != null && joinable(friend) && contentW >= 360) {
			String join = "Beitreten";
			int jw = ActionButton.widthFor(join, "play");
			addRenderableWidget(new ActionButton(right - jw, headerButtonY(), jw, 20, join, true, () -> {
				// aus einer Welt heraus: erst bestätigen (wie in der Freundesliste)
				if (minecraft.level != null && !(friend.uuid().equals(confirmJoin) && System.currentTimeMillis() - confirmJoinAt < 4000)) {
					confirmJoin = friend.uuid();
					confirmJoinAt = System.currentTimeMillis();
					pageMessage("Nochmal „Beitreten“ klicken: Du verlässt deine Welt und gehst auf " + friend.server() + ".", true);
					return;
				}
				joinFriend(friend);
			}).withIcon("play").withTooltip("Auf " + friend.server() + " mitspielen"));
			right -= jw + 6;
		}
		addRenderableWidget(ActionButton.icon(right - 20, headerButtonY(), 20, "ban", openChatName + " blockieren", () -> {
			confirmingBlock = true;
			reporting = false;
			chatToTop = true;
		}));
		right -= 24;
		addRenderableWidget(ActionButton.icon(right - 20, headerButtonY(), 20, "flag", openChatName + " melden", () -> {
			reporting = true;
			confirmingBlock = false;
			chatToTop = true;
		}));

		String send = "Senden";
		int sw = ActionButton.widthFor(send, "send");
		int y = contentY + contentH - 20;
		int cx = chatX();
		int cw = chatW();
		addRenderableWidget(new ActionButton(cx + cw - sw, y, sw, 20, send, true, this::sendChat).withIcon("send"));
		// ab Dienst 1.12.0: Server bzw. geteilte Welt als Beitreten-Karte schicken
		int share = 0;
		if (Social.friends2()) {
			share = 24;
			addRenderableWidget(ActionButton.icon(cx + cw - sw - 24, y, 20, "server", SHARE_LOCATION_LABEL, this::shareLocation));
		}
		chatInput = new SearchField(cx, y, cw - sw - 6 - share, 20, "Nachricht an " + openChatName).withIcon("chat").withMaxLength(Messages.MAX_LENGTH);
		chatInput.setValue(chatText);
		chatInput.setResponder(text -> {
			// „schreibt …“ höchstens alle 3 Sekunden an den Freund (nur wenn sich wirklich etwas ändert)
			if (!text.isBlank() && !text.equals(chatText)) Messages.typed(openChat);
			chatText = text;
		});
		chatInput.setOnEnter(this::sendChat);
		addRenderableWidget(chatInput);
		setFocused(chatInput);
		chatInput.setFocused(true);
	}

	private void sendChat() {
		String text = chatText.strip();
		if (text.isEmpty() || openChat == null) return;
		chatText = "";
		if (chatInput != null) chatInput.setValue("");
		click();
		sendText(text);
	}

	/** Nachricht senden: erscheint sofort (blass), ist sie angekommen, steht sie im Verlauf; sonst rot mit „erneut senden“ */
	private void sendText(String text) {
		sendText(text, replyTo != null ? replyTo.id() : 0, null);
		replyTo = null;
	}

	private void sendText(String text, long reply, Messages.Card card) {
		PendingMessage pending = new PendingMessage(openChat, text, reply, card);
		pendingMessages.add(pending);
		chatFromBottom = 0;
		unreadAtOpen = 0;
		Messages.send(openChat, text, reply, card).whenComplete((ok, error) -> minecraft.execute(() -> {
			if (error == null) {
				pendingMessages.remove(pending);
				return;
			}
			pending.failed = true;
			pending.error = errorText(error);
		}));
	}

	/** Chat auf der Seite Nachrichten öffnen */
	private void openChat(UUID uuid, String name) {
		if (page != Shell.Page.MESSAGES) {
			minecraft.gui.setScreen(new HeldixMenuScreen(parent, uuid, name));
			return;
		}
		openChat = uuid;
		openChatName = name;
		chatText = "";
		chatFromBottom = 0;
		reporting = false;
		confirmingBlock = false;
		chatOpenedFor = null;
		replyTo = null;
		rebuildWidgets();
	}

	private void closeChat() {
		Messages.setViewing(null);
		openChat = null;
		chatOpenedFor = null;
		replyTo = null;
		reporting = false;
		confirmingBlock = false;
		scroll = 0;
		rebuildWidgets();
	}

	/** Server eines Freundes betreten (aus einer Welt heraus: diese vorher verlassen) */
	private void joinFriend(Social.Friend friend) {
		String address = friend.server();
		if (address == null || !ServerAddress.isValidAddress(address)) {
			pageMessage("Die Server-Adresse von " + friend.name() + " ist ungültig.", false);
			return;
		}
		ServerData data = new ServerData(address, address, ServerData.Type.OTHER);
		if (minecraft.level != null) minecraft.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE);
		ConnectScreen.startConnecting(new TitleScreen(), minecraft, ServerAddress.parseString(address), data, false, null);
	}

	/** Beschriftung des Knopfs im Chat, der den eigenen Server bzw. die geteilte Welt als Karte schickt */
	public static final String SHARE_LOCATION_LABEL = "Server/Welt teilen";

	/**
	 * „Server/Welt teilen“ im Chat: Beitreten-Karte mit dem Server, auf dem man spielt, bzw. der geteilten Welt (eigene oder
	 * als Mitspieler). Der Text bleibt für ältere Clients lesbar („Komm auf …“).
	 */
	private void shareLocation() {
		if (openChat == null) return;
		Messages.Card card = locationCard();
		if (card == null) {
			pageMessage("Du bist gerade auf keinem Server und in keiner geteilten Welt.", false);
			return;
		}
		String text = switch (card.kind()) {
			case "world" -> "Komm in " + (card.title() != null ? "meine Welt „" + card.title() + "“" : "meine Welt") + ": "
					+ (WorldShare.address() != null && WorldShare.online() ? WorldShare.normalizeAddress(WorldShare.address()) : card.target());
			default -> "Komm auf " + card.target();
		};
		click();
		sendText(text, replyTo != null ? replyTo.id() : 0, card);
		replyTo = null;
	}

	/** Karte für den aktuellen Ort: geteilte Welt (Gastgeber oder Mitspieler) bzw. öffentlicher Server; sonst null */
	private Messages.Card locationCard() {
		if (minecraft.level == null) return null;
		String own = WorldShare.online() ? WorldShare.address() : null;
		if (own != null && WorldShare.isWorldAddress(own)) {
			String title = minecraft.getSingleplayerServer() != null ? minecraft.getSingleplayerServer().getWorldData().getLevelName() : null;
			return new Messages.Card("world", worldCode(own), title == null ? null : title.length() > 60 ? title.substring(0, 60) : title);
		}
		ServerData server = minecraft.getCurrentServer();
		if (minecraft.isLocalServer() || server == null || server.isLan() || server.isRealm() || server.ip == null) return null;
		String address = WorldShare.normalizeAddress(server.ip);
		if (WorldShare.isWorldAddress(address)) return new Messages.Card("world", worldCode(address), null);
		String title = server.name != null && !server.name.isBlank() && !server.name.equals(net.minecraft.client.resources.language.I18n.get("selectServer.defaultName"))
				? server.name.strip() : null;
		if (title != null && title.length() > 60) title = title.substring(0, 60);
		return new Messages.Card("server", address, title);
	}

	/** Code einer Heldix-Welt aus ihrer Adresse ({@code <code>.welt.<Domain>}) */
	private static String worldCode(String address) {
		String clean = WorldShare.normalizeAddress(address);
		return clean.substring(0, clean.indexOf('.'));
	}

	/**
	 * Beitreten-Karte aus dem Chat: Server direkt, Welt über ihre Adresse beim Dienst ({@code GET /v1/public/worlds/<code>}),
	 * Einladung annehmen ({@code POST /v1/invites/<code>/accept}). Aus einer Welt heraus erst nach einem zweiten Klick.
	 */
	private void useCard(Messages.Card card) {
		switch (card.kind()) {
			case "server" -> joinAddress(card.target(), card.shownTitle());
			case "world" -> {
				if (!confirmLeave("welt:" + card.target())) return;
				Social.request("GET", "/v1/public/worlds/" + card.target(), null, false).whenComplete((json, error) -> minecraft.execute(() -> {
					String address = error == null && json.isJsonObject() && json.getAsJsonObject().has("address")
							? json.getAsJsonObject().get("address").getAsString() : null;
					if (address == null) {
						pageMessage(error != null ? errorText(error) : "Diese Welt gibt es nicht (mehr).", false);
						return;
					}
					boolean open = json.getAsJsonObject().has("online") && json.getAsJsonObject().get("online").getAsBoolean();
					if (!open) {
						pageMessage("Die Welt ist gerade nicht geöffnet.", false);
						return;
					}
					dev.heldixclient.social.Party.join(minecraft, new dev.heldixclient.social.Party.Location("world", card.target(), address, card.shownTitle()));
				}));
			}
			case "invite" -> Social.request("POST", "/v1/invites/" + card.target() + "/accept", new com.google.gson.JsonObject(), true)
					.whenComplete((json, error) -> minecraft.execute(() -> {
						if (error != null) {
							pageMessage(errorText(error), false);
							return;
						}
						String friend = json.isJsonObject() && json.getAsJsonObject().has("friend") ? json.getAsJsonObject().get("friend").getAsString() : "";
						pageMessage(switch (friend) {
							case "new" -> "Einladung angenommen – ihr seid jetzt befreundet.";
							case "already" -> "Ihr seid schon befreundet.";
							case "self" -> "Das ist deine eigene Einladung.";
							case "limit" -> "Deine Freundesliste ist voll.";
							default -> "Einladung angenommen.";
						}, !"limit".equals(friend));
					}));
			default -> {
			}
		}
	}

	/** In einer Welt: true erst beim zweiten Klick innerhalb von 4 Sekunden (vorher Hinweis); ohne Welt sofort true */
	private boolean confirmLeave(String key) {
		if (minecraft.level == null) return true;
		if (key.equals(confirmAddress) && System.currentTimeMillis() - confirmAddressAt < 4000) {
			confirmAddress = null;
			return true;
		}
		confirmAddress = key;
		confirmAddressAt = System.currentTimeMillis();
		pageMessage("Nochmal klicken: Du verlässt dafür deine Welt.", true);
		return false;
	}

	/** Server bzw. Ort betreten (aus einer Welt heraus mit Bestätigung) */
	private void joinAddress(String address, String title) {
		if (address == null || !ServerAddress.isValidAddress(address)) {
			pageMessage("Die Adresse ist ungültig.", false);
			return;
		}
		if (!confirmLeave("server:" + address)) return;
		dev.heldixclient.social.Party.join(minecraft, new dev.heldixclient.social.Party.Location(
				WorldShare.isWorldAddress(address) ? "world" : "server", address, address, title == null ? address : title));
	}

	/** Kann man diesem Freund folgen? (spielt auf einem öffentlichen Server, auf dem man nicht selbst ist) */
	private boolean joinable(Social.Friend friend) {
		if (!friend.online() || !"multiplayer".equals(friend.state()) || friend.server() == null) return false;
		ServerData current = minecraft.getCurrentServer();
		if (current == null || minecraft.isLocalServer()) return true;
		String own = current.ip.trim().toLowerCase(Locale.ROOT).replaceFirst(":25565$", "");
		return !own.equals(friend.server());
	}

	/** Öffentliche Seite von heldixclient.com im Browser öffnen */
	private void openWebsite(String page) {
		String site = Social.websiteUrl();
		if (site != null) Blaze3D.openUri(java.net.URI.create(site + "/" + page));
	}

	/** Neuigkeit in der Übersicht: Titel, Datum, Anfang des Textes; Klick öffnet die Neuigkeiten im Browser */
	private final class NewsRow implements Row, Groupable {
		private final Social.News news;

		NewsRow(Social.News news) {
			this.news = news;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 40;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 40);
			if (hover) Ui.rect(g, x + 3, y + 2, w - 6, 36, 7, Ui.SURFACE);
			String date = news.at() > 0 ? java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy")
					.format(java.time.Instant.ofEpochMilli(news.at()).atZone(java.time.ZoneId.systemDefault())) : "";
			int dateW = Ui.width(date, Ui.Font.SMALL);
			Ui.text(g, Ui.ellipsize(Messages.clean(news.title()), w - 36 - dateW, Ui.Font.LABEL), x + 12, y + 8, Ui.TEXT, Ui.Font.LABEL);
			Ui.textRight(g, date, x + w - 12, y + 9, Ui.FAINT, Ui.Font.SMALL);
			String preview = Messages.clean(news.text()).replaceAll("\\s+", " ");
			Ui.text(g, Ui.ellipsize(preview, w - 24, Ui.Font.SMALL), x + 12, y + 23, Ui.MUTED, Ui.Font.SMALL);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			openWebsite("neuigkeiten");
			return true;
		}
	}

	/** Text einer fehlgeschlagenen Anfrage an den Dienst */
	private static String errorText(Throwable error) {
		Throwable cause = error instanceof java.util.concurrent.CompletionException && error.getCause() != null ? error.getCause() : error;
		return cause.getMessage() != null ? cause.getMessage() : "Dienst nicht erreichbar";
	}

	/** Eingabefeld oben im Inhalt: Freunde und Anfragen (mit Verbindung), Wegpunkte (in einer Welt) */
	private boolean wantsPageInput() {
		if (openModule != null || openChat != null || openProfile != null) return false;
		if (page == Shell.Page.WAYPOINTS) return minecraft.level != null;
		// Seite Party: Eingabe für den Party-Chat, solange man in einer Party ist
		if (page == Shell.Page.PARTY) return Party.active();
		if (page != Shell.Page.FRIENDS && page != Shell.Page.REQUESTS) return false;
		Social.State state = Social.state();
		return state != Social.State.DISABLED && state != Social.State.OFFLINE_ACCOUNT && state != Social.State.OFF;
	}

	@Override
	public void tick() {
		super.tick();
		// Dienst ein- oder ausgeschaltet bzw. Welt betreten: Eingabefeld passend anlegen
		if (openChat == null && wantsPageInput() != (pageInput != null)) rebuildWidgets();
		if (bubbleLines.size() > 2000) bubbleLines.clear();
		// Spitzname und Notiz nach einer kurzen Pause beim Tippen speichern
		if (draftChangedAt > 0 && System.currentTimeMillis() - draftChangedAt > 1200) saveProfileDrafts();
		// Freund entfernt bzw. blockiert: Profilkarte schließen
		if (openProfile != null && friendOf(openProfile) == null && Social.online()) closeProfile();
	}

	/** Unter-Menü der Kategorie als Reiter unter dem Seitenkopf */
	@Override
	protected List<ShellTab.Spec> subTabs() {
		if (openModule != null || openChat != null || openProfile != null) return List.of();
		List<ShellTab.Spec> specs = new ArrayList<>();
		switch (page) {
			case MODULES -> {
				for (Filter f : filters()) {
					specs.add(new ShellTab.Spec("filter:" + f.name(), f.label, f.icon,
							() -> Long.toString(ModuleManager.all().stream().filter(f::matches).count()), false,
							() -> filter == f, () -> {
								filter = f;
								scroll = 0;
							}));
				}
			}
			case CAPE -> {
				for (CapeTab tab : CapeTab.values()) {
					specs.add(new ShellTab.Spec("cape:" + tab.name(), tab.label, tab.icon,
							tab == CapeTab.CUSTOM ? () -> Capes.custom().isEmpty() ? null : Integer.toString(Capes.custom().size()) : null, false,
							() -> capeTab == tab, () -> {
								capeTab = tab;
								scroll = 0;
							}));
				}
			}
			case COSMETICS -> {
				for (CosmeticTab tab : CosmeticTab.values()) {
					specs.add(new ShellTab.Spec("cosmetics:" + tab.name(), tab.label, tab.icon, null, false,
							() -> cosmeticTab == tab, () -> {
								cosmeticTab = tab;
								scroll = 0;
							}));
				}
			}
			case WAYPOINTS -> {
				for (WaypointTab tab : WaypointTab.values()) {
					specs.add(new ShellTab.Spec("waypoints:" + tab.name(), tab.label, tab.icon,
							tab == WaypointTab.LIST && minecraft.level != null ? () -> {
								int count = Waypoints.current(minecraft).size();
								return count == 0 ? null : Integer.toString(count);
							} : null, false,
							() -> waypointTab == tab, () -> {
								waypointTab = tab;
								scroll = 0;
							}));
				}
			}
			case FRIENDS, PARTY, MESSAGES, REQUESTS, PRIVACY -> {
				Social.State state = Social.state();
				if (state != Social.State.DISABLED && state != Social.State.OFFLINE_ACCOUNT) specs.addAll(pageTabs(this::go));
			}
			default -> specs.addAll(pageTabs(this::go));
		}
		return specs;
	}

	/** Andere Seite des Heldix-Menüs öffnen (behält, wohin "Zurück" führt) */
	private void go(Shell.Page target) {
		minecraft.gui.setScreen(new HeldixMenuScreen(parent, target));
	}

	private List<Filter> filters() {
		List<Filter> filters = new ArrayList<>(List.of(Filter.ALL, Filter.HUD, Filter.FEATURES));
		if (ModuleManager.all().stream().anyMatch(m -> m.source() != null)) filters.add(Filter.ADDONS);
		return filters;
	}

	/** Eingabefeld und Knopf als erste Zeile des Inhalts (Position setzt drawContent über die InputRow) */
	private void addPageInput(String button, String buttonIcon, String hint, String fieldIcon, Runnable action) {
		int bw = ActionButton.widthFor(button, buttonIcon);
		pageButton = new ActionButton(0, 0, bw, 20, button, true, action).withIcon(buttonIcon);
		pageButton.visible = false;
		addRenderableWidget(pageButton);
		pageInput = new SearchField(0, 0, 120, 20, hint).withIcon(fieldIcon);
		pageInput.visible = false;
		pageInput.setValue(pageInputText);
		pageInput.setResponder(text -> pageInputText = text);
		pageInput.setOnEnter(action);
		addRenderableWidget(pageInput);
	}

	/** Platzhalter-Zeile für Eingabefeld und Knopf; die Widgets folgen ihr beim Scrollen */
	private final class InputRow implements Row {
		@Override
		public int height(int width) {
			return 22;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			// die Widgets zeichnen sich selbst
		}
	}

	private final InputRow inputRow = new InputRow();
	private ActionButton pageButton;

	private void pageMessage(String message, boolean ok) {
		pageMessage = message;
		pageMessageOk = ok;
		pageMessageAt = System.currentTimeMillis();
	}

	/** Hinweis nach einer Aktion (8 Sekunden lang) */
	private void addPageMessage(List<Row> list) {
		if (pageMessage != null && System.currentTimeMillis() - pageMessageAt < 8000) {
			list.add(new Notice(pageMessageOk ? "check" : "warning", pageMessage, pageMessageOk ? Ui.SUCCESS : Ui.WARNING));
		}
	}

	/** Ergebnis einer Anfrage an den Dienst als Hinweis auf der Seite zeigen */
	private void report(java.util.concurrent.CompletableFuture<Void> call, String success) {
		call.whenComplete((ok, error) -> minecraft.execute(() -> {
			if (error == null) pageMessage(success, true);
			else pageMessage(error instanceof java.util.concurrent.CompletionException && error.getCause() != null
					? error.getCause().getMessage() : error.getMessage(), false);
		}));
	}

	private void sendFriendRequest() {
		String name = pageInputText.strip();
		if (!name.matches("[A-Za-z0-9_]{1,16}")) {
			pageMessage("Bitte einen Minecraft-Namen eingeben (1–16 Zeichen, Buchstaben, Zahlen und _).", false);
			return;
		}
		click();
		report(Social.sendRequest(name), "Anfrage an " + name + " gesendet");
		pageInputText = "";
		if (pageInput != null) pageInput.setValue("");
	}

	private void addWaypointHere() {
		Waypoints.Waypoint waypoint = Waypoints.add(minecraft, pageInputText);
		if (waypoint == null) return;
		click();
		pageMessage("„" + waypoint.name + "“ gesetzt bei " + waypoint.coordinates(), true);
		pageInputText = "";
		if (pageInput != null) pageInput.setValue("");
	}

	@Override
	protected boolean detailHeader() {
		return openModule != null || openChat != null || openProfile != null;
	}

	/** Platz der Knöpfe rechts in der Werkzeugzeile (wie in initContent bzw. initChat angelegt) */
	@Override
	protected int toolbarActionsWidth() {
		int back = ActionButton.widthFor("Zurück", "back");
		if (openProfile != null) return back;
		if (openChat != null) {
			Social.Friend friend = friendOf(openChat);
			int join = friend != null && joinable(friend) && contentW >= 360 ? ActionButton.widthFor("Beitreten", "play") + 6 : 0;
			return back + 6 + join + 44;
		}
		if (openModule != null) return back;
		if (page == Shell.Page.MODULES) {
			int search = Math.min(150, contentW / 3);
			return contentW >= 300 ? search + 6 + ActionButton.widthFor("HUD-Editor", "hud") : search;
		}
		return 0;
	}

	@Override
	protected Component headerTitle() {
		if (openChat != null) {
			Social.Friend friend = friendOf(openChat);
			return Component.literal(friend != null ? friend.shownName() : openChatName);
		}
		if (openProfile != null) {
			Social.Friend friend = friendOf(openProfile);
			return Component.literal(friend != null ? friend.shownName() : "Profil");
		}
		return openModule != null ? Component.literal(openModule.name()) : super.headerTitle();
	}

	@Override
	protected boolean drawHeaderImage(GuiGraphicsExtractor g, int x, int y, int size) {
		UUID shown = openChat != null ? openChat : openProfile;
		if (shown == null) return false;
		Social.Friend friend = friendOf(shown);
		FriendWidget.face(g, shown, friend != null ? friend.name() : openChatName, x, y, size, fade);
		if (friend != null && friend.online()) {
			Ui.circle(g, x + size, y + size, 4, Ui.withAlpha(0xFF0F1420, fade));
			Ui.circle(g, x + size, y + size, 3, Ui.withAlpha(Ui.SUCCESS, fade));
		}
		return true;
	}

	@Override
	protected String headerIcon() {
		if (openChat != null) return "chat";
		if (openProfile != null) return "user";
		return openModule != null ? openModule.icon() : super.headerIcon();
	}

	@Override
	protected String subtitle() {
		if (openModule != null) return openModule.source() != null ? "Addon: " + openModule.source() : "Einstellungen des Moduls";
		if (openChat != null) {
			Social.Friend friend = friendOf(openChat);
			if (friend == null) return "Nicht mehr in deiner Freundesliste";
			// „schreibt …“ (ab Dienst 1.12.0) statt des Status
			return Messages.typing(openChat) ? "schreibt …" : friend.activity();
		}
		if (openProfile != null) {
			Social.Friend friend = friendOf(openProfile);
			return friend == null ? "Nicht mehr in deiner Freundesliste" : friend.nickname() != null ? friend.name() + " · " + friend.activity() : friend.activity();
		}
		return switch (page) {
			case MODULES -> {
				long on = ModuleManager.all().stream().filter(Module::isEnabled).count();
				yield on + " von " + ModuleManager.all().size() + " Modulen aktiv";
			}
			case OVERVIEW -> null;
			case CAPE -> "Dein Cape in der Third-Person-Ansicht (F5)";
			case COSMETICS -> dev.heldixclient.cosmetic.Cosmetics.serviceProblem() == null ? "Hüte, Flügel, Partikel und Begleiter – für alle HeldixClient-Spieler"
					: Social.state() == Social.State.OFFLINE_ACCOUNT ? "Nur mit Microsoft-Konto" : "Braucht den Heldix-Dienst";
			case FRIENDS, PARTY, MESSAGES, REQUESTS, PRIVACY -> switch (Social.state()) {
				case ONLINE -> {
					if (page == Shell.Page.PARTY) {
						Party.State party = Party.party();
						if (party == null) yield Party.invites().isEmpty() ? "Spielt zusammen mit bis zu 8 Freunden" : Party.invites().size() == 1
								? "1 Einladung" : Party.invites().size() + " Einladungen";
						Party.Member leader = party.leaderMember();
						yield party.members().size() + " von " + party.max() + " · Leiter: " + (leader != null ? leader.name() : "?");
					}
					if (page == Shell.Page.MESSAGES) {
						int unread = Messages.unreadTotal();
						yield unread == 0 ? "Mit deinen Freunden schreiben" : unread == 1 ? "1 ungelesene Nachricht" : unread + " ungelesene Nachrichten";
					}
					if (page == Shell.Page.REQUESTS) {
						int open = Social.incoming().size() + Social.outgoing().size();
						yield open == 0 ? "Keine offenen Anfragen" : open == 1 ? "1 offene Anfrage" : open + " offene Anfragen";
					}
					if (page == Shell.Page.PRIVACY) yield "Was andere HeldixClient-Spieler von dir sehen";
					long online = Social.friends().stream().filter(Social.Friend::online).count();
					yield Social.friends().isEmpty() ? "Mit dem Heldix-Dienst verbunden" : online + " von " + Social.friends().size() + " Freunden online";
				}
				case CONNECTING -> "Verbinde …";
				case ERROR -> "Keine Verbindung zum Heldix-Dienst";
				case OFFLINE_ACCOUNT -> "Nur mit Microsoft-Konto";
				case OFF -> "Heldix-Dienst ausgeschaltet";
				case DISABLED -> "Heldix-Dienst nicht eingerichtet";
			};
			case WAYPOINTS -> minecraft.level == null ? "In einer Welt oder auf einem Server" : Waypoints.worldName(minecraft);
			case SHADER -> "Farbstile und Shader-Engine";
			case PERFORMANCE -> "Mehr FPS, weniger Last";
			case SETTINGS -> "Design, HUD und Tasten";
			case ADDONS -> installedSummary();
			case STORE -> switch (AddonStore.status()) {
				case READY -> AddonStore.entries().size() == 1 ? "1 Addon im Store" : AddonStore.entries().size() + " Addons im Store";
				case ERROR -> "Store nicht erreichbar";
				default -> AddonStore.available() ? "Lade …" : "Braucht den Heldix-Dienst";
			};
			case INFO -> "Versionen und geladene Mods";
			case ACCOUNTS -> AccountSwitcher.available() ? "Du spielst als " + minecraft.getUser().getName()
					: dev.heldixclient.account.LauncherLink.ready() ? "Im Launcher ausgeschaltet" : "Nur mit dem HeldixClient-Launcher";
			default -> null;
		};
	}

	private List<Row> buildRows() {
		List<Row> list = new ArrayList<>();
		if (openChat != null) {
			buildChatRows(list);
			return list;
		}
		if (openProfile != null) {
			buildProfileRows(list);
			return list;
		}
		if (openModule != null) {
			list.add(new ModuleHeader(openModule));
			List<Setting> settings = openModule.settings();
			if (!settings.isEmpty()) {
				list.add(new Section("Einstellungen", null));
				list.add(new Group(settings.stream().<Row>map(SettingRow::new).toList()));
			}
			List<Setting> keys = openModule.keys();
			if (!keys.isEmpty()) {
				list.add(new Section("Tasten", "Klick, dann die neue Taste drücken"));
				list.add(new Group(keys.stream().<Row>map(SettingRow::new).toList()));
			}
			Module module = openModule;
			list.add(new Section("Schnellzugriff", null));
			list.add(new Group(List.of(new SettingRow(new Setting.Toggle("In den Schnellschaltern", "Auf der Übersicht und im Pausemenü direkt umschalten",
					() -> dev.heldixclient.module.QuickModules.contains(module), on -> dev.heldixclient.module.QuickModules.set(module, on))))));
			return list;
		}
		switch (page) {
			case MODULES -> buildModuleRows(list);
			case OVERVIEW -> buildOverviewRows(list);
			case CAPE -> buildCapeRows(list);
			case COSMETICS -> buildCosmeticRows(list);
			case FRIENDS -> buildFriendRows(list);
			case PARTY -> buildPartyRows(list);
			case MESSAGES -> buildMessageRows(list);
			case REQUESTS -> buildRequestRows(list);
			case PRIVACY -> buildPrivacyRows(list);
			case ACCOUNTS -> buildAccountRows(list);
			case WAYPOINTS -> buildWaypointRows(list);
			case SHADER -> buildShaderRows(list);
			case PERFORMANCE -> buildPerformanceRows(list);
			case SETTINGS -> buildSettingsRows(list);
			case ADDONS -> buildAddonRows(list);
			case STORE -> buildStoreRows(list);
			case INFO -> buildInfoRows(list);
			default -> {
			}
		}
		return list;
	}

	/** Seite Module: Kacheln des gewählten Reiters, gefiltert über das Suchfeld im Kopf */
	private void buildModuleRows(List<Row> list) {
		if (!filters().contains(filter)) filter = Filter.ALL;
		List<Module> modules = new ArrayList<>();
		String query = searchText.trim().toLowerCase(Locale.ROOT);
		for (Module module : ModuleManager.all()) {
			if (!filter.matches(module)) continue;
			if (query.isEmpty() || module.name().toLowerCase(Locale.ROOT).contains(query)
					|| module.description().toLowerCase(Locale.ROOT).contains(query)) {
				modules.add(module);
			}
		}
		if (modules.isEmpty()) {
			list.add(query.isEmpty() ? new EmptyState("modules", "Keine Module", "In diesem Bereich gibt es noch keine Module.")
					: new EmptyState("search", "Nichts gefunden", "Kein Modul passt zu „" + searchText.trim() + "“."));
		} else {
			list.add(new ModuleGrid(modules));
		}
	}

	/** Seite Cape: Reiter Heldix-Capes, Eigene Capes und Optionen; oben jeweils die Vorschau */
	private void buildCapeRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		if (capeTab != CapeTab.OPTIONS) list.add(new CapeShowcase());
		switch (capeTab) {
			case HELDIX -> {
				List<Object> builtin = new ArrayList<>();
				builtin.add(NO_CAPE);
				builtin.addAll(Capes.builtin());
				if (capeMessage != null && !capeMessageOk && System.currentTimeMillis() - capeMessageAt < 8000) {
					list.add(new Notice("warning", capeMessage, Ui.WARNING));
				}
				list.add(new Section("Heldix-Capes", Capes.builtin().size() + " Motive"));
				list.add(new CapeGrid(builtin));
				// weitere Capes aus dem Cosmetics-Katalog des Heldix-Dienstes (signiert, für alle sichtbar)
				List<Capes.Cape> catalog = Capes.catalog();
				if (!catalog.isEmpty()) {
					list.add(new Section("Aus dem Katalog", catalog.size() + (catalog.size() == 1 ? " Cape" : " Capes")));
					list.add(new CapeGrid(new ArrayList<>(catalog)));
				}
			}
			case CUSTOM -> {
				List<Capes.Cape> custom = Capes.custom();
				if (capeMessage != null && System.currentTimeMillis() - capeMessageAt < 8000) {
					list.add(new Notice(capeMessageOk ? "check" : "warning", capeMessage, capeMessageOk ? Ui.SUCCESS : Ui.WARNING));
				}
				if (custom.isEmpty()) {
					list.add(new EmptyState("image", "Noch keine eigenen Capes", "Zieh ein PNG-Bild ins Fenster oder leg es in den Ordner " + Capes.DIRECTORY + "."));
				} else {
					list.add(new Section("Eigene Capes", custom.size() + (custom.size() == 1 ? " Bild" : " Bilder")));
					list.add(new CapeGrid(new ArrayList<>(custom)));
				}
				list.add(new Section("Bilder", null));
				list.add(new Group(List.of(
						new SettingRow(new Setting.Action("Ordner " + Capes.DIRECTORY, "Im Spielordner dieser Instanz", "Öffnen", () -> {
							try {
								java.nio.file.Files.createDirectories(Capes.directory());
							} catch (Exception e) {
								HeldixClient.LOGGER.warn("Cape-Ordner nicht anlegbar", e);
							}
							Blaze3D.openPath(Capes.directory());
						})),
						new SettingRow(new Setting.Action("Neu einlesen", "Nach dem Hinzufügen oder Löschen von Bildern", "Aktualisieren", () -> {
							Capes.reloadCustom();
							int count = Capes.custom().size();
							capeMessage = count == 0 ? "Keine Bilder im Ordner gefunden" : count + (count == 1 ? " eigenes Cape gefunden" : " eigene Capes gefunden");
							capeMessageOk = count > 0;
							capeMessageAt = System.currentTimeMillis();
						})))));
				list.add(new Text("Cape-Vorlagen (64 × 32 oder größer im selben Format) werden direkt übernommen, andere Bilder kommen auf die Rückseite. "
						+ "Eigene Bilder siehst nur du.", Ui.FAINT));
			}
			case OPTIONS -> {
				list.add(new Section("Darstellung", "für alle Capes"));
				list.add(new Group(List.of(
						new SettingRow(configToggle("Wehender Stoff", "Das Cape weht und wirft Wellen wie Stoff, statt als starre Platte zu schwingen",
								() -> config.capeCloth, v -> config.capeCloth = v)),
						new SettingRow(configToggle("Animation", "Die Heldix-Capes bewegen sich (Flammen, Sterne, Polarlicht …)",
								() -> config.capeAnimation, v -> config.capeAnimation = v)),
						new SettingRow(configToggle("Leuchtende Details", "Funken, Sterne und Neon leuchten auch im Dunkeln",
								() -> config.capeGlow, v -> config.capeGlow = v)),
						new SettingRow(configToggle("Elytra im Cape-Design", "Die Flügel zeigen dasselbe Motiv wie das Cape",
								() -> config.capeElytra, v -> config.capeElytra = v)))));
				String who = Social.state() == Social.State.DISABLED || Social.state() == Social.State.OFFLINE_ACCOUNT || Social.state() == Social.State.OFF
						? "Das Cape siehst nur du, z. B. in der Third-Person-Ansicht (F5) und im Inventar. "
						: "Andere HeldixClient-Spieler sehen dein Heldix-Cape (einstellbar unter Freunde → Privatsphäre); eigene Bilder siehst nur du. ";
				list.add(new Notice("info", who + "Unter Optionen → Skin-Anpassung muss „Umhang“ eingeschaltet sein.", Ui.ACCENT_TEXT));
			}
		}
	}

	/** Seite Cosmetics: je Slot Vorschau an der Figur und Kacheln aus dem Katalog; Optionen für die Anzeige */
	private void buildCosmeticRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		if (cosmeticTab == CosmeticTab.OPTIONS) {
			list.add(new Section("Anzeige", "für alle Cosmetics"));
			list.add(new Group(List.of(
					new SettingRow(configToggle("Cosmetics anderer zeigen", "Hüte, Flügel, Begleiter und Partikel anderer HeldixClient-Spieler",
							() -> config.cosmeticsOthers, v -> config.cosmeticsOthers = v)),
					new SettingRow(configToggle("Auren anderer zeigen", "Auren anderer Spieler; deine eigenen siehst du immer",
							() -> config.cosmeticParticlesOthers, v -> config.cosmeticParticlesOthers = v)),
					new SettingRow(configToggle("Hut über Helm zeigen", "Mit Helm sitzt dein Hut darüber; aus: mit Helm wird er ausgeblendet",
							() -> config.cosmeticHatOverHelmet, v -> config.cosmeticHatOverHelmet = v)))));
			list.add(new Notice("info", "Andere HeldixClient-Spieler sehen deine Cosmetics, solange unter Freunde → Privatsphäre „Für andere erkennbar“ "
					+ "an ist. Du selbst siehst sie in der Third-Person-Ansicht (F5) und im Inventar; mit F1 sind sie ausgeblendet.", Ui.ACCENT_TEXT));
			return;
		}
		String slot = cosmeticTab.slot;
		list.add(new CosmeticShowcase(slot));
		addPageMessage(list);
		String problem = dev.heldixclient.cosmetic.Cosmetics.serviceProblem();
		if (problem != null) {
			Notice notice = new Notice("warning", problem, Ui.WARNING);
			if (Social.state() == Social.State.OFF) notice.action("Einschalten", () -> Social.setEnabled(true));
			list.add(notice);
		}
		List<dev.heldixclient.cosmetic.CosmeticCatalog.Item> items = dev.heldixclient.cosmetic.CosmeticCatalog.items(slot);
		switch (dev.heldixclient.cosmetic.CosmeticCatalog.status()) {
			case LOADING -> {
				if (items.isEmpty()) list.add(new Notice("refresh", "Lade den Cosmetics-Katalog …", Ui.ACCENT_TEXT));
			}
			case ERROR -> list.add(new Notice("warning", dev.heldixclient.cosmetic.CosmeticCatalog.error() != null ? dev.heldixclient.cosmetic.CosmeticCatalog.error()
					: "Der Cosmetics-Katalog ist gerade nicht erreichbar.", Ui.DANGER).action("Erneut versuchen", () -> dev.heldixclient.cosmetic.CosmeticCatalog.refresh(true)));
			default -> {
			}
		}
		if (items.isEmpty()) {
			if (dev.heldixclient.cosmetic.CosmeticCatalog.status() == dev.heldixclient.cosmetic.CosmeticCatalog.Status.READY) {
				list.add(new EmptyState("sparkles", "Noch nichts im Katalog", "Für „" + dev.heldixclient.cosmetic.Cosmetics.slotName(slot) + "“ hat das HeldixClient-Team noch keine Cosmetics veröffentlicht."));
			}
			return;
		}
		list.add(new Section(dev.heldixclient.cosmetic.Cosmetics.slotName(slot), items.size() + (items.size() == 1 ? " Cosmetic" : " Cosmetics")));
		List<Object> entries = new ArrayList<>();
		entries.add(NO_CAPE);
		entries.addAll(items);
		list.add(new CosmeticGrid(slot, entries));
		list.add(new Text("Fahr mit der Maus über eine Kachel, um sie an deiner Figur zu sehen; ein Klick legt sie an. "
				+ "Deine Auswahl gilt auch im Launcher und auf der Webseite.", Ui.FAINT));
	}

	/** Hinweis, wenn eine gesperrte Belohnung (access "unlock") gewählt wird – mit dem Weg zu den Einladungen */
	private static String unlockText(String name) {
		return "„" + name + "“ ist eine " + dev.heldixclient.cosmetic.Cosmetics.UNLOCK_HINT
				+ ": Lade Freunde zu HeldixClient ein (Freunde → Freunde einladen), dann schaltest du es frei.";
	}

	/** Cosmetic anlegen (item) oder ablegen (null) – über den Heldix-Dienst, mit Hinweis auf der Seite */
	private void chooseCosmetic(String slot, dev.heldixclient.cosmetic.CosmeticCatalog.Item item) {
		String id = item == null ? null : item.id();
		if (java.util.Objects.equals(dev.heldixclient.cosmetic.Cosmetics.mine(slot), id) || cosmeticPending != null) return;
		if (item != null && item.teamOnly() && !dev.heldixclient.cosmetic.Cosmetics.team()) {
			pageMessage("„" + item.name() + "“ gibt es nur für das HeldixClient-Team.", false);
			return;
		}
		if (item != null && dev.heldixclient.cosmetic.Cosmetics.lockReason(item) != null) {
			pageMessage(unlockText(item.name()), false);
			return;
		}
		String problem = dev.heldixclient.cosmetic.Cosmetics.serviceProblem();
		if (problem != null) {
			pageMessage(problem, false);
			return;
		}
		cosmeticPending = slot + ":" + (id == null ? "" : id);
		dev.heldixclient.cosmetic.Cosmetics.choose(slot, id).whenComplete((ok, error) -> minecraft.execute(() -> {
			cosmeticPending = null;
			if (error != null) pageMessage(errorText(error), false);
			else pageMessage(item == null ? "Abgelegt – in diesem Bereich trägst du jetzt nichts." : "„" + item.name() + "“ angelegt.", true);
		}));
	}

	/** Seite Übersicht: Spielfigur, dann Karten für Freunde, Wegpunkte, aktive Module und Tasten */
	/**
	 * Übersicht: Begrüßung mit Figur und Ort, Schnellschalter für die gewählten Module, Hinweise (Updates, Anfragen,
	 * Probleme), Freunde, Wegpunkte bzw. Tasten und Neuigkeiten.
	 */
	private void buildOverviewRows(List<Row> list) {
		list.add(new OverviewHero());

		List<Module> quick = dev.heldixclient.module.QuickModules.list(dev.heldixclient.module.QuickModules.MAX);
		long quickOn = quick.stream().filter(Module::isEnabled).count();
		Group quickCard = new Group("star", "Schnellschalter", quick.isEmpty() ? null : quickOn + " von " + quick.size() + " an",
				List.of(quick.isEmpty() ? new Text("Noch keine gewählt: im Untermenü eines Moduls „In den Schnellschaltern“ einschalten.", Ui.MUTED)
						: new QuickToggles(quick)))
				.link("Module", () -> go(Shell.Page.MODULES));
		list.add(new Columns(quickCard, noticesCard()));

		List<Social.Friend> friends = Social.online() ? sortedFriends() : List.of();
		long online = friends.stream().filter(Social.Friend::online).count();
		List<Row> friendRows = new ArrayList<>();
		String hint = FriendWidget.serviceHint();
		if (hint != null) friendRows.add(new Text(hint, Ui.MUTED));
		else if (friends.isEmpty()) friendRows.add(new Text("Noch keine Freunde. Unter „Alle“ schickst du eine Anfrage.", Ui.MUTED));
		else for (Social.Friend friend : friends.subList(0, Math.min(4, friends.size()))) friendRows.add(new OverviewFriend(friend));
		Group friendCard = new Group("friends", "Freunde", friends.isEmpty() ? null : online + " von " + friends.size() + " online", friendRows)
				.link("Alle", () -> go(Shell.Page.FRIENDS));

		Row second;
		if (minecraft.level != null) {
			List<Waypoints.Waypoint> waypoints = Waypoints.current(minecraft);
			List<Row> rows = new ArrayList<>();
			for (Waypoints.Waypoint waypoint : waypoints.subList(0, Math.min(3, waypoints.size()))) rows.add(new WaypointRow(waypoint));
			rows.add(new SettingRow(new Setting.Action("Hier setzen", "An deiner Position", "Setzen", () -> {
				Waypoints.Waypoint waypoint = Waypoints.add(minecraft, "");
				if (waypoint != null) dev.heldixclient.hud.Notifications.show("waypoint", "Wegpunkt gesetzt", waypoint.name + " · " + waypoint.coordinates(), null);
			})));
			second = new Group("pin", "Wegpunkte", waypoints.isEmpty() ? "noch keine" : waypoints.size() + " in dieser Welt", rows)
					.link("Verwalten", () -> go(Shell.Page.WAYPOINTS));
		} else {
			second = keysCard();
		}
		list.add(new Columns(friendCard, second));

		Social.refreshNews();
		List<Social.News> news = Social.news();
		if (!news.isEmpty()) {
			list.add(new Group("news", "Neuigkeiten", "vom HeldixClient-Team", news.stream().<Row>map(NewsRow::new).toList())
					.link("Alle", () -> openWebsite("neuigkeiten")));
		}

		List<Module> active = ModuleManager.all().stream().filter(Module::isEnabled).toList();
		list.add(new Group("modules", "Aktive Module", active.size() + " von " + ModuleManager.all().size(),
				List.of(active.isEmpty() ? new Text("Kein Modul ist an.", Ui.MUTED) : new ModuleChips(active)))
				.link("Alle", () -> go(Shell.Page.MODULES)));
		if (minecraft.level != null) list.add(keysCard());
	}

	/** Karte Hinweise auf der Übersicht: was Aufmerksamkeit braucht, jeweils mit Sprung zur Seite */
	private Group noticesCard() {
		List<Row> rows = new ArrayList<>();
		int updates = AddonStore.updateCount();
		if (updates > 0) {
			rows.add(new NoticeLine("download", updates == 1 ? "1 Addon-Update verfügbar" : updates + " Addon-Updates verfügbar", Ui.ACCENT_TEXT,
					"Anzeigen", () -> go(Shell.Page.STORE)));
		}
		long broken = AddonManager.addons().stream().filter(addon -> addon.error() != null).count();
		if (broken > 0) {
			rows.add(new NoticeLine("warning", broken == 1 ? "1 Addon hat einen Fehler" : broken + " Addons haben Fehler", Ui.WARNING,
					"Ansehen", () -> go(Shell.Page.ADDONS)));
		}
		if (Social.online()) {
			int requests = Social.incoming().size();
			if (requests > 0) {
				rows.add(new NoticeLine("user-plus", requests == 1 ? "1 Freundschaftsanfrage" : requests + " Freundschaftsanfragen", Ui.ACCENT_TEXT,
						"Anzeigen", () -> go(Shell.Page.REQUESTS)));
			}
			int unread = Messages.unreadTotal();
			if (unread > 0) {
				rows.add(new NoticeLine("chat", unread == 1 ? "1 ungelesene Nachricht" : unread + " ungelesene Nachrichten", Ui.ACCENT_TEXT,
						"Lesen", () -> go(Shell.Page.MESSAGES)));
			}
		} else if (Social.state() == Social.State.ERROR) {
			rows.add(new NoticeLine("warning", "Keine Verbindung zum Heldix-Dienst", Ui.WARNING, "Verbinden", Social::connect));
		}
		int problems = HeldixLoader.problems().size();
		if (problems > 0) {
			rows.add(new NoticeLine("info", problems == 1 ? "1 Hinweis beim Laden" : problems + " Hinweise beim Laden", Ui.WARNING,
					"Info", () -> go(Shell.Page.INFO)));
		}
		boolean ok = rows.isEmpty();
		if (ok) rows.add(new NoticeLine("check", "Alles in Ordnung", Ui.SUCCESS, null, null));
		return new Group("lightbulb", "Hinweise", ok ? null : rows.size() == 1 ? "1 neu" : rows.size() + " neu", rows);
	}

	/** Zeile in der Karte Hinweise: Icon, Text, optional ein Knopf rechts */
	private final class NoticeLine implements Row, Groupable {
		private static final int H = 28;
		private final String icon;
		private final String text;
		private final int color;
		private final String button;
		private final Runnable action;

		NoticeLine(String icon, String text, int color, String button, Runnable action) {
			this.icon = icon;
			this.text = text;
			this.color = color;
			this.button = button;
			this.action = action;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return H;
		}

		private int buttonWidth() {
			return button == null ? 0 : Ui.width(button, Ui.Font.SMALL) + 20;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Ui.circle(g, x + 20, y + H / 2f, 8, (color & 0xFFFFFF) | 0x24000000);
			Ui.icon(g, icon, x + 15, y + H / 2f - 5, 10, color);
			int bw = buttonWidth();
			Ui.text(g, Ui.ellipsize(text, w - 44 - (bw > 0 ? bw + 8 : 0), Ui.Font.BODY), x + 34, y + (H - 8) / 2, Ui.TEXT, Ui.Font.BODY);
			if (button != null) {
				int bx = x + w - 10 - bw;
				int by = y + (H - 16) / 2;
				pill(g, button, bx, by, bw, false, Ui.inside(mouseX, mouseY, bx, by, bw, 16));
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (button == null) return false;
			int bw = buttonWidth();
			if (!Ui.inside(mouseX, mouseY, x + w - 10 - bw, y + (H - 16) / 2, bw, 16)) return false;
			HeldixMenuScreen.this.click();
			action.run();
			return true;
		}
	}

	/** Schnellschalter: Module als Kacheln mit Schalter, in Spalten (Klick schaltet um) */
	private final class QuickToggles implements Row {
		private static final int CHIP_H = 24;
		private static final int GAP = 6;
		private final List<Module> modules;

		QuickToggles(List<Module> modules) {
			this.modules = modules;
		}

		private int columns(int w) {
			return Math.clamp((w + GAP) / (110 + GAP), 1, 4);
		}

		@Override
		public int height(int width) {
			int rows = (modules.size() + columns(width) - 1) / columns(width);
			return rows * (CHIP_H + GAP) - GAP;
		}

		private int[] cell(int index, int x, int y, int w) {
			int cols = columns(w);
			int cw = (w - (cols - 1) * GAP) / cols;
			return new int[] {x + (index % cols) * (cw + GAP), y + (index / cols) * (CHIP_H + GAP), cw};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			for (int i = 0; i < modules.size(); i++) {
				Module module = modules.get(i);
				int[] c = cell(i, x, y, w);
				settingCenters.put("quick:" + i, new int[] {c[0] + c[2] / 2, c[1] + CHIP_H / 2});
				boolean over = Ui.inside(mouseX, mouseY, c[0], c[1], c[2], CHIP_H);
				float on = animate(module.id() + "#quick", module.isEnabled() ? 1f : 0f);
				float hover = animate(module.id() + "#quickHover", over ? 1f : 0f);
				Ui.rect(g, c[0], c[1], c[2], CHIP_H, 8, Ui.lerp(Ui.lerp(0x0AFFFFFF, Ui.SURFACE_HOVER, hover), 0x223B82F6, on));
				Ui.outline(g, c[0], c[1], c[2], CHIP_H, 8, Ui.lerp(Ui.LINE, Ui.ACCENT_LINE, on * 0.8f));
				Ui.icon(g, module.icon(), c[0] + 8, c[1] + (CHIP_H - 10) / 2f, 10, Ui.lerp(Ui.FAINT, Ui.ACCENT_TEXT, on));
				String name = Ui.ellipsize(dev.heldixclient.module.QuickModules.shortName(module), c[2] - 54, Ui.Font.LABEL);
				Ui.text(g, name, c[0] + 23, c[1] + (CHIP_H - 8) / 2, Ui.TEXT, Ui.Font.LABEL);
				Ui.toggle(g, c[0] + c[2] - 26, c[1] + (CHIP_H - 10) / 2f, on);
				if (over) Ui.requestTooltip(module.name() + (module.isEnabled() ? ": an" : ": aus") + " · Klick schaltet um", mouseX, mouseY);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (int i = 0; i < modules.size(); i++) {
				int[] c = cell(i, x, y, w);
				if (!Ui.inside(mouseX, mouseY, c[0], c[1], c[2], CHIP_H)) continue;
				HeldixMenuScreen.this.click();
				modules.get(i).toggle();
				return true;
			}
			return false;
		}
	}

	private Group keysCard() {
		return new Group("keyboard", "Tasten", "zum Ändern anklicken", List.of(
				new SettingRow(new Setting.Key("Heldix-Menü", null, HeldixClient.menuKey)),
				new SettingRow(new Setting.Key("Zoom", null, HeldixClient.zoomKey)),
				new SettingRow(new Setting.Key("Freelook", null, HeldixClient.freelookKey)),
				new SettingRow(new Setting.Key("Wegpunkt setzen", null, HeldixClient.waypointKey))));
	}

	/** Freunde, online zuerst */
	private static List<Social.Friend> sortedFriends() {
		List<Social.Friend> friends = new ArrayList<>(Social.friends());
		friends.sort(java.util.Comparator.comparing((Social.Friend f) -> !f.online()));
		return friends;
	}

	/**
	 * Stand des Heldix-Dienstes als Hinweis über den Seiten Freunde und Anfragen.
	 * false = keine Verbindung möglich, die Seite zeigt nur den Hinweis.
	 */
	private boolean addServiceState(List<Row> list) {
		switch (Social.state()) {
			case DISABLED -> {
				list.add(new Notice("info", "Der Heldix-Dienst ist in dieser Installation nicht eingerichtet. Freunde, Capes für andere Spieler "
						+ "und das Heldix-Symbol brauchen ihn.", Ui.ACCENT_TEXT));
				return false;
			}
			case OFFLINE_ACCOUNT -> {
				list.add(new Notice("warning", "Freunde gibt es nur mit einem Microsoft-Konto. Mit einem Offline-Konto bleibt der Heldix-Dienst aus.", Ui.WARNING));
				return false;
			}
			case OFF -> {
				addPageMessage(list);
				list.add(new EmptyState("friends", "Heldix-Dienst ist aus", "Ohne ihn gibt es keine Freunde, keine Capes anderer Spieler und kein "
						+ "Heldix-Symbol. Es werden keine Daten an den Dienst geschickt."));
				list.add(new Group(List.of(new SettingRow(new Setting.Toggle("Heldix-Dienst nutzen", "Freunde, Capes für alle und das Heldix-Symbol",
						() -> HeldixConfig.get().socialEnabled, Social::setEnabled)))));
				return false;
			}
			case CONNECTING -> list.add(new Notice("refresh", "Verbinde mit dem Heldix-Dienst …", Ui.ACCENT_TEXT));
			case ERROR -> list.add(new Notice("warning", (Social.error() != null ? Social.error() : "Keine Verbindung")
					+ ". HeldixClient versucht es gleich noch einmal.", Ui.WARNING).action("Verbinden", Social::connect));
			case ONLINE -> {
			}
		}
		return true;
	}

	/** Seite Freunde: Spielername eingeben, Hinweis auf neue Anfragen, Freunde online und offline */
	private void buildFriendRows(List<Row> list) {
		if (!addServiceState(list)) return;
		if (pageInput != null) list.add(inputRow);
		addPageMessage(list);
		List<Social.Request> incoming = Social.incoming();
		if (!incoming.isEmpty()) {
			String text = incoming.size() == 1 ? incoming.getFirst().name() + " möchte mit dir befreundet sein."
					: incoming.size() + " Spieler möchten mit dir befreundet sein.";
			list.add(new Notice("user-plus", text, Ui.ACCENT_TEXT).action("Anzeigen", () -> go(Shell.Page.REQUESTS)));
		}
		// Freunde 2.0 (ab Dienst 1.12.0): Party-Einladungen und die eigene Party oben
		List<Party.Invite> partyInvites = Party.invites();
		if (!partyInvites.isEmpty()) {
			list.add(new Section("Party-Einladungen", Integer.toString(partyInvites.size())));
			list.add(new Group(partyInvites.stream().<Row>map(PartyInviteRow::new).toList()));
		}
		if (Party.active()) list.add(new Group(List.of(new PartySummaryRow())));
		if (Social.online()) addInviteRows(list);
		List<Social.Friend> friends = Social.friends();
		List<Social.Friend> favorites = friends.stream().filter(Social.Friend::favorite).toList();
		List<Social.Friend> online = friends.stream().filter(f -> f.online() && !f.favorite()).toList();
		List<Social.Friend> offline = friends.stream().filter(f -> !f.online() && !f.favorite()).toList();
		if (!favorites.isEmpty()) {
			list.add(new Section("Favoriten", Integer.toString(favorites.size())));
			list.add(new Group(favorites.stream().<Row>map(FriendRow::new).toList()));
		}
		if (!online.isEmpty()) {
			list.add(new Section("Online", Integer.toString(online.size())));
			list.add(new Group(online.stream().<Row>map(FriendRow::new).toList()));
		}
		if (!offline.isEmpty()) {
			list.add(new Section("Offline", Integer.toString(offline.size())));
			list.add(new Group(offline.stream().<Row>map(FriendRow::new).toList()));
		}
		if (friends.isEmpty() && Social.state() == Social.State.ONLINE) {
			list.add(new EmptyState("friends", "Noch keine Freunde", "Gib oben den Namen eines Spielers ein und sende eine Anfrage. "
					+ "Er muss HeldixClient nutzen und schon einmal damit online gewesen sein."));
		}
		if (!friends.isEmpty() && Social.friends2()) {
			list.add(new Text("Klick auf einen Freund öffnet sein Profil, Rechtsklick zeigt alle Aktionen (Party, Favorit, Spitzname …).", Ui.FAINT));
		}
		addSuggestionRows(list);
	}

	/** Vorschläge: Freunde von Freunden (Dienst) und Spieler aus der Nähe (nur lokal) */
	private void addSuggestionRows(List<Row> list) {
		if (!Social.online()) return;
		List<Row> rows = new ArrayList<>();
		if (Social.friends2() && Social.me().showSuggestions()) {
			for (Suggestions.Suggestion suggestion : Suggestions.server()) rows.add(new SuggestionRow(suggestion.uuid(), suggestion.name(),
					suggestion.mutual() == 1 ? "1 gemeinsamer Freund" : suggestion.mutual() + " gemeinsame Freunde", false));
		}
		if (Suggestions.nearbyEnabled()) {
			for (Suggestions.Nearby nearby : Suggestions.nearby()) {
				long minutes = nearby.nearMs() / 60_000;
				String time = minutes >= 120 ? (minutes / 60) + " Std." : minutes + " Min.";
				rows.add(new SuggestionRow(nearby.uuid(), nearby.name(), time + " in deiner Nähe gespielt · " + Social.ago(nearby.lastSeen()), true));
			}
		}
		if (rows.isEmpty()) return;
		list.add(new Section("Vorschläge", Integer.toString(rows.size())));
		list.add(new Group(rows));
		list.add(new Text("Spieler aus der Nähe merkt sich nur dieser PC (30 Tage). Ein- und ausschalten unter Privatsphäre.", Ui.FAINT));
	}

	/**
	 * Seite Party (ab Heldix-Dienst 1.12.0): Einladungen an dich, die Party mit Mitgliedern (Ort, Leiter, Verlassen,
	 * Entfernen, Leitung übergeben), „Zum Leiter“, Party-Chat mit Eingabe, Freunde einladen und „Automatisch folgen“.
	 */
	private void buildPartyRows(List<Row> list) {
		if (!addServiceState(list)) return;
		if (Social.online() && !Party.available()) {
			list.add(new Notice("info", "Die Party " + Social.FRIENDS2_MISSING.substring(4), Ui.ACCENT_TEXT));
			return;
		}
		addPageMessage(list);
		List<Party.Invite> invites = Party.invites();
		if (!invites.isEmpty()) {
			list.add(new Section("Einladungen", Integer.toString(invites.size())));
			list.add(new Group(invites.stream().<Row>map(PartyInviteRow::new).toList()));
		}
		Party.State party = Party.party();
		if (party == null) {
			list.add(new EmptyState("headphones", "Noch keine Party", "Lade unten Freunde ein – du bist dann der Leiter. In einer Party seid ihr "
					+ "am selben Ort automatisch in einer Voice-Gruppe, und wohin der Leiter geht, könnt ihr mit einem Klick folgen."));
			addPartyInviteFriends(list);
			addPartySettings(list, false);
			return;
		}
		Party.Location target = Party.leaderTarget();
		Party.Member leader = party.leaderMember();
		if (target != null && leader != null) {
			boolean confirming = ("party:" + target.address()).equals(confirmAddress) && System.currentTimeMillis() - confirmAddressAt < 4000;
			list.add(new Notice("play", leader.name() + (target.world() ? " ist in der " + target.shown() + "." : " ist auf " + target.title() + "."), Ui.ACCENT_TEXT)
					.action(confirming ? "Welt verlassen?" : "Beitreten", () -> {
						if (confirmLeave("party:" + target.address())) Party.join(minecraft, target);
					}));
		}
		boolean lead = Party.isLeader();
		list.add(new Section("Mitglieder", party.members().size() + " von " + party.max()));
		List<Row> members = new ArrayList<>();
		for (Party.Member member : party.members()) members.add(new PartyMemberRow(member, lead));
		for (Party.Pending pending : party.invites()) members.add(new PartyPendingRow(pending, lead));
		list.add(new Group(members));
		if (party.voiceGroup() != null) {
			list.add(new Text(dev.heldixclient.voice.VoiceLink.inPartyGroup() ? "Voice: Du bist in der Voice-Gruppe der Party."
					: dev.heldixclient.voice.VoiceLink.groupName() != null ? "Voice: Deine eigene Voice-Gruppe hat Vorrang vor der Gruppe der Party."
					: "Voice: Schalte den Voice Chat ein – wer am selben Ort ist, ist dann in der Gruppe der Party.", Ui.FAINT));
		}
		list.add(new Section("Party-Chat", Party.chat().isEmpty() ? null : Integer.toString(Party.chat().size())));
		List<Party.ChatMessage> chat = Party.chat();
		if (chat.isEmpty()) list.add(new Text("Noch keine Nachrichten. Der Party-Chat liegt nur im Speicher des Dienstes (die letzten 50).", Ui.MUTED));
		else {
			List<Row> lines = new ArrayList<>();
			for (Party.ChatMessage message : chat) lines.add(new PartyChatRow(message));
			list.add(new Group(lines));
		}
		if (pageInput != null) list.add(inputRow);
		if (lead) addPartyInviteFriends(list);
		addPartySettings(list, true);
	}

	/** Freunde zum Einladen (online zuerst); nur ohne Party oder als Leiter */
	private void addPartyInviteFriends(List<Row> list) {
		List<Social.Friend> candidates = sortedFriends().stream().filter(f -> !Party.contains(f.uuid())).toList();
		if (candidates.isEmpty()) return;
		list.add(new Section("Freunde einladen", null));
		list.add(new Group(candidates.stream().<Row>map(PartyInviteFriendRow::new).toList()));
	}

	private void addPartySettings(List<Row> list, boolean inParty) {
		HeldixConfig.Data config = HeldixConfig.get();
		List<Row> rows = new ArrayList<>();
		rows.add(new SettingRow(configToggle(AUTO_FOLLOW_LABEL, "Wechselt der Leiter den Server bzw. die Welt, gehst du mit – nur aus dem Hauptmenü, nie mitten aus einer Welt",
				() -> config.partyAutoFollow, v -> config.partyAutoFollow = v)));
		if (inParty) {
			rows.add(new SettingRow(new Setting.Action(LEAVE_PARTY_LABEL, Party.isLeader() ? "Die Leitung geht an den, der am längsten dabei ist"
					: "Du kannst jederzeit wieder eingeladen werden", "Verlassen", () -> report(Party.leave(), "Du hast die Party verlassen."))));
		}
		list.add(new Section("Einstellungen", null));
		list.add(new Group(rows));
	}

	/** Beschriftungen der Party (auch für den Autotest: {@link #settingCenter}) */
	public static final String AUTO_FOLLOW_LABEL = "Automatisch folgen";
	public static final String LEAVE_PARTY_LABEL = "Party verlassen";

	/**
	 * Profilkarte eines Freundes: Kopf, Name (Spitzname), Abzeichen, Status, befreundet seit, zuletzt online, gemeinsame
	 * Freunde; Aktionen (Nachricht, Party, Beitreten, Favorit), „Nur für dich“ (Spitzname, Notiz) und Entfernen, Blockieren,
	 * Melden.
	 */
	private void buildProfileRows(List<Row> list) {
		Social.Friend friend = friendOf(openProfile);
		if (friend == null) {
			list.add(new EmptyState("user", "Kein Freund mehr", "Dieser Spieler ist nicht mehr in deiner Freundesliste."));
			return;
		}
		addPageMessage(list);
		list.add(new ProfileHero(friend));
		List<Row> about = new ArrayList<>();
		if (friend.since() > 0) about.add(new Info("Befreundet seit", date(friend.since())));
		about.add(new Info(friend.online() ? "Gerade" : "Zuletzt online", friend.online() ? friend.activity()
				: friend.lastOnline() > 0 ? Social.ago(friend.lastOnline()) : "nicht sichtbar"));
		Badge.Role role = friend.badge() != null ? friend.badge() : Badge.Role.PLAYER;
		about.add(new Info("Abzeichen", role.label() + (role.group() != Badge.Group.PLAYER ? " · " + role.group().label() : "")));
		if (profile != null && profile.friend().uuid().equals(friend.uuid())) {
			about.add(new Info("Gemeinsame Freunde", Integer.toString(profile.mutual().size())));
		}
		list.add(new Group("info", "Über " + friend.shownName(), null, about));
		if (profileError != null) list.add(new Notice("warning", profileError, Ui.WARNING).action("Erneut", this::loadProfile));
		else if (profile == null) list.add(new Text("Lade Profil …", Ui.MUTED));
		else if (!profile.mutual().isEmpty()) {
			list.add(new Section("Gemeinsame Freunde", Integer.toString(profile.mutual().size())));
			list.add(new Group(profile.mutual().stream().<Row>map(MutualRow::new).toList()));
		}
		List<Row> own = new ArrayList<>();
		for (Setting setting : profileSettings()) own.add(new SettingRow(setting));
		own.add(new SettingRow(new Setting.Toggle("Favorit", "Steht oben in deiner Freundesliste; „Ist online“ wahlweise nur für Favoriten",
				() -> friendOf(friend.uuid()) != null && friendOf(friend.uuid()).favorite(), on -> Social.setFavorite(friend.uuid(), on).exceptionally(e -> {
					minecraft.execute(() -> pageMessage(errorText(e), false));
					return null;
				}))));
		list.add(new Group("edit", "Nur für dich", "der Freund sieht das nicht", own));
		boolean confirmRemoveNow = "remove".equals(profileConfirm) && System.currentTimeMillis() - profileConfirmAt < 5000;
		boolean confirmBlockNow = "block".equals(profileConfirm) && System.currentTimeMillis() - profileConfirmAt < 5000;
		list.add(new Group("shield", "Aktionen", null, List.of(
				new SettingRow(new Setting.Action("Entfernen", confirmRemoveNow ? "Wirklich? Euer Chat wird dabei gelöscht."
						: "Ihr seid danach nicht mehr befreundet", confirmRemoveNow ? "Endgültig entfernen" : "Entfernen", () -> {
					if (confirmRemoveNow) {
						profileConfirm = null;
						report(Social.removeFriend(friend.uuid()), friend.name() + " ist nicht mehr dein Freund");
					} else {
						profileConfirm = "remove";
						profileConfirmAt = System.currentTimeMillis();
					}
				})),
				new SettingRow(new Setting.Action("Blockieren", confirmBlockNow ? "Wirklich? Freundschaft und Chat werden gelöscht, keine Anfragen mehr."
						: "Freigeben geht unter Privatsphäre", confirmBlockNow ? "Endgültig blockieren" : "Blockieren", () -> {
					if (confirmBlockNow) {
						profileConfirm = null;
						report(Messages.block(friend.uuid()), friend.name() + " ist blockiert");
					} else {
						profileConfirm = "block";
						profileConfirmAt = System.currentTimeMillis();
					}
				})),
				new SettingRow(new Setting.Action("Melden", "Mit der Meldung gehen die letzten Nachrichten eures Chats an den Betreiber", "Melden",
						() -> minecraft.gui.setScreen(chatReport(parent, friend.uuid(), friend.name())))))));
	}

	private static String date(long at) {
		return java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy").format(java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()));
	}

	/** Beschriftungen der Einladungs-Zeilen (auch für den Autotest: {@link #settingCenter}) */
	public static final String INVITE_LABEL = "Freunde einladen";
	public static final String BROWSER_LINK_LABEL = "Browser-Link für die Voice-Gruppe";

	/**
	 * Freunde einladen (ab Heldix-Dienst 1.11.0): Einladungslink kopieren – im Mehrspieler mit dem Server – und, wenn du in
	 * einer Voice-Gruppe bist und der Dienst Gäste kann, den Browser-Link für die Gruppe (24 Std.).
	 */
	private void addInviteRows(List<Row> list) {
		String server = dev.heldixclient.social.Invites.currentServer(minecraft);
		boolean busy = dev.heldixclient.social.Invites.busy();
		List<Row> rows = new ArrayList<>();
		rows.add(new SettingRow(new Setting.Action(INVITE_LABEL, server != null
				? "Link mit Download und deinem Server " + server + " – wer ihn annimmt, ist danach mit dir befreundet"
				: "Link mit Download für Freunde ohne HeldixClient – wer ihn annimmt, ist danach mit dir befreundet",
				busy ? "Erstellt …" : "Link kopieren",
				() -> dev.heldixclient.social.Invites.copyInvite(minecraft, result -> pageMessage(result.message(), result.ok())))));
		String group = dev.heldixclient.voice.VoiceLink.groupName();
		if (group != null && dev.heldixclient.voice.VoiceLink.guestsAvailable()) {
			rows.add(new SettingRow(new Setting.Action(BROWSER_LINK_LABEL,
					"Kopieren (24 Std. gültig): Freunde reden ohne HeldixClient im Browser in „" + group + "“ mit",
					busy ? "Erstellt …" : "Kopieren",
					() -> dev.heldixclient.social.Invites.copyBrowserLink(minecraft, result -> pageMessage(result.message(), result.ok())))));
		}
		list.add(new Group("user-plus", "Freunde einladen", null, rows));
		list.add(new Text("Für Freunde, die du einlädst, gibt es Belohnungen (Partikel und ein Cape) – den Fortschritt siehst du im Launcher "
				+ "und auf der Webseite.", Ui.FAINT));
	}

	/** Seite Nachrichten: Unterhaltungen (neueste zuerst) und Freunde, denen man schreiben kann */
	private void buildMessageRows(List<Row> list) {
		if (!addServiceState(list)) return;
		addPageMessage(list);
		if (!HeldixConfig.get().socialMessages) {
			list.add(new Notice("info", "Du nimmst gerade keine Nachrichten an. Einschalten unter Privatsphäre.", Ui.ACCENT_TEXT)
					.action("Privatsphäre", () -> go(Shell.Page.PRIVACY)));
		}
		List<Messages.Conversation> conversations = Messages.conversations();
		if (!conversations.isEmpty()) {
			int unread = Messages.unreadTotal();
			list.add(new Section("Unterhaltungen", unread > 0 ? unread + " ungelesen" : null));
			list.add(new Group(conversations.stream().<Row>map(ConversationRow::new).toList()));
		} else if (!Messages.conversationsLoaded() && Social.state() == Social.State.ONLINE) {
			list.add(new Text("Lade Unterhaltungen …", Ui.MUTED));
		}
		Set<UUID> withChat = new java.util.HashSet<>();
		for (Messages.Conversation c : conversations) withChat.add(c.uuid());
		List<Social.Friend> others = sortedFriends().stream().filter(f -> !withChat.contains(f.uuid())).toList();
		if (!others.isEmpty()) {
			list.add(new Section(conversations.isEmpty() ? "Schreib einem Freund" : "Neue Unterhaltung", null));
			list.add(new Group(others.stream().<Row>map(StartChatRow::new).toList()));
		}
		if (Social.friends().isEmpty() && Social.state() == Social.State.ONLINE) {
			list.add(new EmptyState("chat", "Noch keine Freunde", "Nachrichten gibt es zwischen Freunden. Unter „Freunde“ schickst du eine Anfrage."));
		}
		list.add(new Text("Nachrichten liegen höchstens 30 Tage beim Heldix-Dienst und sind nicht Ende-zu-Ende verschlüsselt. "
				+ "Entfernst du einen Freund, ist auch der Chat gelöscht.", Ui.FAINT));
	}

	/** Offener Chat: Verlauf mit Datum, oben ggf. Melden/Blockieren bestätigen */
	private void buildChatRows(List<Row> list) {
		if (!Social.online()) {
			list.add(new Notice("warning", FriendWidget.serviceHint() != null ? FriendWidget.serviceHint() : "Keine Verbindung", Ui.WARNING));
			return;
		}
		if (reporting) list.add(new ConfirmBar(true));
		if (confirmingBlock) list.add(new ConfirmBar(false));
		if (friendOf(openChat) == null) {
			list.add(new EmptyState("chat", "Kein Freund mehr", openChatName + " ist nicht mehr in deiner Freundesliste. Damit ist auch der Chat gelöscht."));
			return;
		}
		List<Messages.Message> history = Messages.history(openChat);
		if (history.isEmpty() && Messages.loading(openChat)) {
			list.add(new Text("Lade Nachrichten …", Ui.MUTED));
			return;
		}
		if (Messages.hasMore(openChat)) list.add(new LoadOlderRow());
		else if (history.isEmpty()) {
			list.add(new EmptyState("chat", "Noch keine Nachrichten", "Schreib unten die erste Nachricht an " + openChatName
					+ ". Nachrichten liegen höchstens 30 Tage beim Heldix-Dienst und sind nicht Ende-zu-Ende verschlüsselt."));
		}
		// erste ungelesene Nachricht beim Öffnen: die n-letzte des Freundes
		long firstUnread = Long.MAX_VALUE;
		if (unreadAtOpen > 0) {
			int seen = 0;
			for (int i = history.size() - 1; i >= 0; i--) {
				if (history.get(i).mine()) continue;
				firstUnread = history.get(i).id();
				if (++seen >= unreadAtOpen) break;
			}
		}
		java.time.LocalDate lastDay = null;
		Messages.Message previous = null;
		for (int i = 0; i < history.size(); i++) {
			Messages.Message message = history.get(i);
			java.time.LocalDate day = day(message.at());
			if (!day.equals(lastDay)) {
				list.add(new DayRow(dayLabel(day)));
				lastDay = day;
				previous = null;
			}
			if (message.id() == firstUnread) {
				list.add(new NewDivider());
				previous = null;
			}
			Messages.Message next = i + 1 < history.size() ? history.get(i + 1) : null;
			boolean continued = previous != null && previous.from().equals(message.from()) && message.at() - previous.at() < 5 * 60_000;
			boolean last = next == null || !next.from().equals(message.from()) || next.at() - message.at() >= 5 * 60_000
					|| !day(next.at()).equals(day) || next.id() == firstUnread;
			list.add(new Bubble(message, continued, last));
			previous = message;
		}
		boolean afterMine = previous != null && previous.mine();
		for (PendingMessage pending : pendingMessages) {
			if (!pending.to.equals(openChat)) continue;
			list.add(new Bubble(pending, afterMine));
			afterMine = true;
		}
		// „schreibt …“ (ab Dienst 1.12.0, 6 Sekunden nach dem letzten Tippen weg)
		if (Messages.typing(openChat)) list.add(new TypingRow());
		// Hinweise (z. B. Senden fehlgeschlagen) unten, direkt über der Eingabe
		addPageMessage(list);
	}

	/** Seite Anfragen: erhaltene (annehmen, ablehnen) und gesendete (zurückziehen) */
	private void buildRequestRows(List<Row> list) {
		if (!addServiceState(list)) return;
		if (pageInput != null) list.add(inputRow);
		addPageMessage(list);
		List<Social.Request> incoming = Social.incoming();
		List<Social.Request> outgoing = Social.outgoing();
		if (!incoming.isEmpty()) {
			list.add(new Section("Erhalten", Integer.toString(incoming.size())));
			list.add(new Group(incoming.stream().<Row>map(r -> new RequestRow(r, true)).toList()));
		}
		if (!outgoing.isEmpty()) {
			list.add(new Section("Gesendet", Integer.toString(outgoing.size())));
			list.add(new Group(outgoing.stream().<Row>map(r -> new RequestRow(r, false)).toList()));
		}
		if (incoming.isEmpty() && outgoing.isEmpty() && Social.state() == Social.State.ONLINE) {
			list.add(new EmptyState("user-plus", "Keine offenen Anfragen", "Schickt dir jemand eine Anfrage, erscheint sie hier. "
					+ "Oben kannst du selbst eine senden."));
		}
	}

	/** Seite Privatsphäre: was andere sehen, Einblendungen, der Heldix-Dienst selbst */
	private void buildPrivacyRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		addPageMessage(list);
		list.add(new Section("Sichtbarkeit", null));
		list.add(new Group(List.of(
				new SettingRow(socialToggle("Für andere erkennbar", "Dein Heldix-Symbol (Tab-Liste, über deinem Kopf) und dein Heldix-Cape für andere HeldixClient-Spieler",
						() -> config.socialVisible, v -> config.socialVisible = v)),
				new SettingRow(socialToggle("Online-Status für Freunde", "Freunde sehen, ob du online bist und ob du im Menü oder in einer Welt bist",
						() -> config.socialPresence, v -> config.socialPresence = v)),
				new SettingRow(socialToggle("Server für Freunde sichtbar", "Freunde sehen, auf welchem Server du spielst, und können beitreten (nur öffentliche Adressen)",
						() -> config.socialShowServer, v -> config.socialShowServer = v)),
				new SettingRow(socialToggle("Nachrichten von Freunden", "Freunde können dir schreiben; aus: niemand kann dir Nachrichten schicken",
						() -> config.socialMessages, v -> config.socialMessages = v)))));
		// Freunde 2.0 (ab Dienst 1.12.0): diese Angaben gelten beim Dienst (auch Launcher und Webseite ändern sie)
		if (Social.friends2()) {
			List<Row> status = new ArrayList<>();
			for (Setting setting : statusSettings()) status.add(new SettingRow(setting));
			status.add(new SettingRow(meToggle(DND_LABEL, "Keine Einblendungen und Töne; Nachrichten kommen trotzdem an, Party-Einladungen landen still in der Liste",
					() -> Social.me().dnd(), "dnd")));
			list.add(new Section("Dein Status", null));
			list.add(new Group(status));
			list.add(new Section("Freunde", null));
			list.add(new Group(List.of(
					new SettingRow(meToggle("Zuletzt online zeigen", "Freunde sehen, wann du zuletzt online warst (gerundet), solange dein Online-Status sichtbar ist",
							() -> Social.me().showLastOnline(), "showLastOnline")),
					new SettingRow(meToggle("In Vorschlägen erscheinen", "Freunde deiner Freunde bekommen dich vorgeschlagen (ohne zu sehen, über wen)",
							() -> Social.me().suggestable(), "suggestable")),
					new SettingRow(meToggle("Vorschläge zeigen", "Freunde von Freunden auf der Seite Freunde vorschlagen",
							() -> Social.me().showSuggestions(), "showSuggestions")),
					new SettingRow(new Setting.Choice(ONLINE_NOTIFY_LABEL, "Einblendung, wenn ein Freund online kommt",
							List.of("Alle Freunde", "Nur Favoriten", "Keine"), () -> switch (Social.me().onlineNotify()) {
								case "favorites" -> 1;
								case "none" -> 2;
								default -> 0;
							}, index -> Social.updateMe("onlineNotify", new com.google.gson.JsonPrimitive(index == 1 ? "favorites" : index == 2 ? "none" : "all"))
									.exceptionally(e -> {
										minecraft.execute(() -> pageMessage(errorText(e), false));
										return null;
									}))))));
		}
		list.add(new Section("Vorschläge aus der Nähe", null));
		int remembered = Suggestions.nearbyCount();
		list.add(new Group(List.of(
				new SettingRow(new Setting.Toggle(NEARBY_LABEL, "HeldixClient-Spieler, mit denen du mindestens 10 Minuten in der Nähe gespielt hast – nur auf diesem PC, 30 Tage",
						Suggestions::nearbyEnabled, Suggestions::setNearbyEnabled)),
				new SettingRow(new Setting.Action("Gemerkte Spieler löschen", remembered == 0 ? "Gerade ist niemand gemerkt"
						: remembered == 1 ? "1 Spieler gemerkt" : remembered + " Spieler gemerkt", "Löschen", () -> {
					Suggestions.clearNearby();
					pageMessage("Gemerkte Spieler aus der Nähe sind gelöscht.", true);
				})))));
		if (Social.online()) {
			List<Messages.Blocked> blocked = Messages.blocked();
			list.add(new Section("Blockiert", blocked.isEmpty() ? null : Integer.toString(blocked.size())));
			if (blocked.isEmpty()) list.add(new Text("Du hast niemanden blockiert. Blockieren geht im Chat und bei Anfragen.", Ui.MUTED));
			else list.add(new Group(blocked.stream().<Row>map(BlockedRow::new).toList()));
		}
		list.add(new Section("Anzeige", null));
		list.add(new Group(List.of(
				new SettingRow(configToggle("Einblendungen", "Bei Anfragen, Nachrichten und wenn Freunde online kommen",
						() -> config.socialNotifications, v -> config.socialNotifications = v)),
				new SettingRow(configToggle("Capes anderer Spieler", "Heldix-Capes anderer HeldixClient-Spieler zeigen",
						() -> config.socialCapes, v -> config.socialCapes = v)),
				new SettingRow(configToggle("Heldix-Symbol in der Tab-Liste", "Vor den Namen von HeldixClient-Spielern und unten, wie viele hier sind",
						() -> config.badgeTabList, v -> {
							config.badgeTabList = v;
							BadgeDisplay.refresh();
						})),
				new SettingRow(configToggle("Heldix-Symbol über Köpfen", "Im Namensschild über dem Kopf anderer HeldixClient-Spieler",
						() -> config.badgeNameTags, v -> config.badgeNameTags = v)))));
		list.add(new Section("Heldix-Dienst", null));
		boolean confirming = confirmDeleteAt > 0 && System.currentTimeMillis() - confirmDeleteAt < 5000;
		String status = switch (Social.state()) {
			case ONLINE -> "Verbunden";
			case CONNECTING -> "Verbinde …";
			case ERROR -> "Nicht erreichbar";
			case OFF -> "Ausgeschaltet";
			case OFFLINE_ACCOUNT -> "Nur mit Microsoft-Konto";
			case DISABLED -> "Nicht eingerichtet";
		};
		list.add(new Group(List.of(
				new Info("Status", status),
				new SettingRow(new Setting.Action("Auf heldixclient.com", "Profil, Freunde und Nachrichten im Browser – ohne Passwort", "Im Browser anmelden",
						() -> Social.webLink().whenComplete((url, error) -> minecraft.execute(() -> {
							if (error != null) {
								pageMessage(errorText(error), false);
								return;
							}
							Blaze3D.openUri(java.net.URI.create(url));
							pageMessage("heldixclient.com ist im Browser geöffnet.", true);
						})))),
				new SettingRow(new Setting.Toggle("Heldix-Dienst nutzen", "Aus: keine Verbindung und keine Daten an den Dienst",
						() -> HeldixConfig.get().socialEnabled, Social::setEnabled)),
				new SettingRow(new Setting.Action("Daten beim Dienst löschen", confirming
						? "Wirklich? Freunde, Anfragen und Einstellungen beim Dienst sind danach weg, der Dienst wird ausgeschaltet."
						: "Löscht alles, was der Heldix-Dienst über dich gespeichert hat", confirming ? "Endgültig löschen" : "Löschen", () -> {
					if (System.currentTimeMillis() - confirmDeleteAt < 5000) {
						confirmDeleteAt = 0;
						report(Social.deleteAccount(), "Deine Daten beim Heldix-Dienst sind gelöscht. Der Dienst ist jetzt ausgeschaltet.");
					} else {
						confirmDeleteAt = System.currentTimeMillis();
					}
				})))));
	}

	/**
	 * Seite Konten: die Konten des Launchers (das im Spiel zuerst), wechseln bzw. in einer Welt „Welt verlassen und
	 * wechseln“, neues Konto über die Anmeldung im Launcher. Nur vom HeldixClient-Launcher gestartet und dort erlaubt.
	 */
	private void buildAccountRows(List<Row> list) {
		String reason = AccountSwitcher.unavailableReason();
		if (reason != null) {
			list.add(new EmptyState("user", "Kontowechsel nicht verfügbar", reason));
			return;
		}
		String status = AccountSwitcher.status();
		if (status != null) {
			boolean error = AccountSwitcher.statusError();
			boolean running = AccountSwitcher.phase() != AccountSwitcher.Phase.IDLE;
			list.add(new Notice(error ? "warning" : running ? "refresh" : "check", status, error ? Ui.WARNING : running ? Ui.ACCENT_TEXT : Ui.SUCCESS));
		}
		if (!AccountSwitcher.loaded()) {
			list.add(new Text("Lade Konten aus dem Launcher …", Ui.MUTED));
		} else {
			List<LauncherAccount> accounts = new ArrayList<>(AccountSwitcher.accounts());
			accounts.sort(java.util.Comparator.comparing((LauncherAccount a) -> !AccountSwitcher.isCurrent(a)));
			if (accounts.stream().noneMatch(AccountSwitcher::isCurrent)) {
				list.add(new Notice("info", "Du spielst als " + minecraft.getUser().getName() + " – dieses Konto steht nicht (mehr) im Launcher.", Ui.ACCENT_TEXT));
			}
			list.add(new Section("Konten im Launcher", Integer.toString(accounts.size())));
			if (accounts.isEmpty()) list.add(new Text("Im Launcher ist kein Konto angemeldet.", Ui.MUTED));
			else list.add(new Group(accounts.stream().<Row>map(AccountRow::new).toList()));
		}
		if (!AccountSwitcher.canSwitchHere() && minecraft.level != null) {
			list.add(new Notice("info", "Gewechselt wird außerhalb einer Welt: „Welt verlassen und wechseln“ speichert deine Welt "
					+ "bzw. trennt die Verbindung zum Server und wechselt dann.", Ui.ACCENT_TEXT));
		}
		boolean signingIn = AccountSwitcher.phase() == AccountSwitcher.Phase.SIGNING_IN;
		list.add(new Group(List.of(new SettingRow(new Setting.Action("Konto hinzufügen",
				signingIn ? "Melde dich im Fenster von Microsoft an, das der Launcher geöffnet hat" : "Microsoft-Anmeldung im Fenster des Launchers",
				signingIn ? "Läuft …" : "Hinzufügen", () -> AccountSwitcher.addAccount(true))))));
		list.add(new Text("Beim ersten Wechsel zu einem Konto fragt der Launcher zur Sicherheit nach. Das gewählte Konto nutzt auch "
				+ "der nächste Start aus dem Launcher.", Ui.FAINT));
	}

	/** Beschriftungen der Privatsphäre ab Freunde 2.0 (auch für den Autotest) */
	public static final String DND_LABEL = "Nicht stören";
	public static final String ONLINE_NOTIFY_LABEL = "„Ist online“-Einblendungen";
	public static final String NEARBY_LABEL = "Spieler in der Nähe merken";

	/** Schalter für eine Angabe beim Dienst ({@code PUT /v1/me}); beim Fehler zurück und Hinweis */
	private Setting.Toggle meToggle(String label, String description, BooleanSupplier get, String field) {
		return new Setting.Toggle(label, description, get, value -> Social.updateMe(field, new com.google.gson.JsonPrimitive(value)).exceptionally(e -> {
			minecraft.execute(() -> pageMessage(errorText(e), false));
			return null;
		}));
	}

	private Setting.Toggle socialToggle(String label, String description, BooleanSupplier get, Consumer<Boolean> set) {
		return new Setting.Toggle(label, description, get, value -> {
			set.accept(value);
			HeldixConfig.save();
			Social.profileChanged();
		});
	}

	/** Seite Wegpunkte: Reiter Wegpunkte (der aktuellen Welt) und Anzeige (Optionen des Moduls) */
	private void buildWaypointRows(List<Row> list) {
		Module module = ModuleManager.waypoints;
		if (waypointTab == WaypointTab.DISPLAY) {
			if (module == null) return;
			list.add(new Section("Im Spiel", null));
			List<Row> rows = new ArrayList<>();
			rows.add(new SettingRow(new Setting.Toggle("Wegpunkte im Spiel", "Markierungen mit Name und Entfernung, auch durch Wände", module::isEnabled, module::setEnabled)));
			for (Setting setting : module.settings()) rows.add(new SettingRow(setting));
			list.add(new Group(rows));
			return;
		}
		if (minecraft.level == null) {
			list.add(new EmptyState("pin", "Keine Welt geladen", "Wegpunkte gehören zu einer Welt bzw. einem Server. Betritt eine Welt, um sie zu sehen und zu setzen."));
			return;
		}
		if (pageInput != null) list.add(inputRow);
		addPageMessage(list);
		List<Waypoints.Waypoint> waypoints = Waypoints.current(minecraft);
		if (waypoints.isEmpty()) {
			list.add(new EmptyState("pin", "Noch keine Wegpunkte", "Oben „Hier setzen“ oder im Spiel die Taste "
					+ HeldixClient.waypointKey.getTranslatedKeyMessage().getString() + " drücken."));
			return;
		}
		list.add(new Section("In dieser Welt", waypoints.size() + (waypoints.size() == 1 ? " Wegpunkt" : " Wegpunkte")));
		list.add(new Group(waypoints.stream().<Row>map(WaypointRow::new).toList()));
		list.add(new Text("Klick auf den Farbpunkt wechselt die Farbe, das Auge blendet einen Wegpunkt aus.", Ui.FAINT));
	}

	private void buildShaderRows(List<Row> list) {
		if (dev.heldixclient.render.IrisCompat.shaderPackActive()) {
			list.add(new Notice("warning", "Ein Iris-Shaderpack ist aktiv. Die Heldix-Shader sind so lange pausiert; ändern unter Optionen → Grafik → Shaderpacks.", Ui.WARNING));
		}
		ShaderPreset current = Shaders.current();
		list.add(new Section("Farbstil", current.label() + ": " + current.description()));
		ShaderPreset[] presets = ShaderPreset.values();
		List<String> labels = new ArrayList<>();
		for (ShaderPreset preset : presets) labels.add(preset.label());
		list.add(new Chips(labels, 4, () -> Shaders.current().ordinal(), index -> Shaders.select(presets[index])));

		list.add(new Section("Shader-Engine", "Effekte mit Tiefeninformation"));
		list.add(new Chips(List.of("Aus", "Dezent", "Kräftig"), 3, ShaderEngine::currentLevel, ShaderEngine::applyLevel));
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new Group(List.of(
				new SettingRow(engineSlider("Leuchten (Bloom)", "Helle Stellen strahlen", () -> config.bloom, v -> config.bloom = v)),
				new SettingRow(engineSlider("Tiefenunschärfe", "Ferne Dinge werden weich", () -> config.depthOfField, v -> config.depthOfField = v)),
				new SettingRow(engineSlider("Nebel", "Dunst in der Ferne", () -> config.fog, v -> config.fog = v)),
				new SettingRow(engineSlider("Umgebungsverdeckung", "Schatten in Ecken und Spalten (SSAO)",
						() -> config.ambientOcclusion, v -> config.ambientOcclusion = v)))));
		list.add(new Notice("info", "Shaderpacks wie BSL laufen über Iris in Fabric-Instanzen (Launcher → Instanz → Shader).", Ui.ACCENT_TEXT));
	}

	private Setting.Slider engineSlider(String label, String description, DoubleSupplier get, Consumer<Float> set) {
		return new Setting.Slider(label, description, 0, 1, 0.05, get, value -> {
			set.accept((float) value);
			ShaderEngine.changed();
		}, Setting::percent);
	}

	private void buildPerformanceRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new Section("Bildrate", null));
		list.add(new Group(List.of(
				new SettingRow(new Setting.Toggle("FPS-Boost", "Teure Grafik-Effekte aus; ausschalten stellt alles wieder her",
						Performance::boostEnabled, Performance::setBoost)),
				new SettingRow(configToggle("Hintergrund-FPS", "Weniger Bilder, solange das Fenster nicht aktiv ist",
						() -> config.backgroundFps, v -> config.backgroundFps = v)),
				new SettingRow(new Setting.Slider("Grenze im Hintergrund", "", 5, 60, 5, () -> config.backgroundFpsLimit, value -> {
					config.backgroundFpsLimit = (int) value;
					HeldixConfig.save();
				}, value -> Math.round(value) + " FPS")))));
		list.add(new Section("Grafik", null));
		list.add(new Group(List.of(new Info("Grafik-API", DebugOverlay.backend()), new Info("Grafikkarte", gpuName()))));
		list.add(new Notice("info", "Die Grafik-API stellst du im Launcher um (Einstellungen → Leistung).", Ui.ACCENT_TEXT));
	}

	/** Bisherige Heldix-Mods aus mods/ (ohne HeldixClient selbst): erscheinen unter Mods &amp; Addons als Addons, nur zur Info */
	private static List<ModInfo> heldixMods() {
		return HeldixLoader.mods().stream().filter(mod -> !HeldixClient.MOD_ID.equals(mod.id())).toList();
	}

	/** Untertitel der Seite Installiert, z. B. „4 Addons · 1 Heldix-Mod · 12 Fabric-Mods“ */
	private static String installedSummary() {
		int addons = AddonManager.addons().size();
		int mods = heldixMods().size();
		int fabric = HeldixLoader.platformMods().size();
		List<String> parts = new ArrayList<>();
		parts.add(addons == 1 ? "1 Addon" : addons + " Addons");
		if (mods > 0) parts.add(mods == 1 ? "1 Heldix-Mod" : mods + " Heldix-Mods");
		if (fabric > 0) parts.add(fabric == 1 ? "1 Fabric-Mod" : fabric + " Fabric-Mods");
		return String.join(" · ", parts) + " installiert";
	}

	/**
	 * Seite Mods &amp; Addons → Installiert: Heldix-Addons (auch die, die in Minecraft eingreifen) mit Schalter, bisherige
	 * Heldix-Mods aus mods/ und – in Fabric-Instanzen, nur zur Info – die Fabric-Mods.
	 */
	private void buildAddonRows(List<Row> list) {
		List<LoadedAddon> addons = new ArrayList<>(AddonManager.addons());
		addons.sort(java.util.Comparator.comparing(a -> a.name().toLowerCase(Locale.ROOT)));
		List<ModInfo> mods = heldixMods();
		List<ModInfo> fabric = HeldixLoader.platformMods();
		Map<String, String> changes = AddonStore.changes();
		if (!changes.isEmpty()) list.add(new Notice("refresh", restartText(changes), Ui.WARNING));
		List<String> switched = addons.stream().filter(LoadedAddon::restartNeeded).map(LoadedAddon::name).toList();
		if (!switched.isEmpty()) {
			list.add(new Notice("refresh", String.join(", ", switched) + " – an/aus wirkt nach dem Neustart des Spiels.", Ui.WARNING));
		}
		if (addons.isEmpty() && mods.isEmpty()) {
			list.add(new EmptyState("addons", "Keine Addons installiert", "Addons wie Spotify oder Uhrzeit & Spielzeit findest du im Store."));
			list.add(new Notice("download", "Geprüfte Addons mit einem Klick installieren.", Ui.ACCENT_TEXT).action("Zum Store", () -> go(Shell.Page.STORE)));
		} else {
			String count = addons.size() + (addons.size() == 1 ? " Addon" : " Addons") + (mods.isEmpty() ? "" : " · " + mods.size() + (mods.size() == 1 ? " Heldix-Mod" : " Heldix-Mods"));
			list.add(new Section("Installiert", count));
			for (LoadedAddon addon : addons) list.add(new AddonCard(addon));
			for (ModInfo mod : mods) list.add(new HeldixModCard(mod));
		}
		if (!fabric.isEmpty()) {
			list.add(new Section("Fabric-Mods", fabric.size() + " · nur zur Info"));
			list.add(new Group(fabric.stream().<Row>map(mod -> new Info(mod.name(), mod.version())).toList()));
			list.add(new Text("Fabric-Mods schaltest und aktualisierst du im Launcher unter Instanz → Mods & Addons.", Ui.FAINT));
		}
		list.add(new Text("Heldix Loader " + HeldixLoader.version() + " (" + ("fabric".equals(HeldixLoader.platform()) ? "in Fabric" : "eigenständig") + ")  ·  Addon-API "
				+ HeldixApi.API_VERSION, Ui.FAINT));
	}

	/** Hinweis nach Änderungen im Store: wirken erst nach einem Neustart (Addons legen beim Start ihre Tasten an) */
	private static String restartText(Map<String, String> changes) {
		List<String> parts = new ArrayList<>();
		changes.forEach((id, action) -> {
			String name = AddonStore.entries().stream().filter(e -> e.id().equals(id)).map(AddonStore.Entry::name).findFirst().orElse(id);
			parts.add(name + " " + action);
		});
		parts.sort(String::compareTo);
		return String.join(", ", parts) + " – wirkt nach einem Neustart des Spiels.";
	}

	/** Seite Addon-Store: Liste vom Heldix-Dienst, signiert vom Team */
	private void buildStoreRows(List<Row> list) {
		if (!AddonStore.available()) {
			list.add(new EmptyState("download", "Addon-Store nicht verfügbar", Social.baseUrl().isEmpty()
					? "Der Heldix-Dienst ist in dieser Installation nicht eingerichtet."
					: "Der Store lädt die Liste vom Heldix-Dienst. Einschalten unter Freunde → Privatsphäre → „Heldix-Dienst nutzen“."));
			return;
		}
		AddonStore.refresh(false);
		Map<String, String> changes = AddonStore.changes();
		if (!changes.isEmpty()) list.add(new Notice("refresh", restartText(changes), Ui.WARNING));
		List<AddonStore.Entry> entries = AddonStore.entries();
		switch (AddonStore.status()) {
			case IDLE, LOADING -> {
				if (entries.isEmpty()) list.add(new Notice("refresh", "Lade den Addon-Store …", Ui.ACCENT_TEXT));
			}
			case ERROR -> list.add(new Notice("warning", AddonStore.error(), Ui.DANGER).action("Erneut versuchen", () -> AddonStore.refresh(true)));
			case READY -> {
				if (entries.isEmpty()) list.add(new EmptyState("download", "Noch keine Addons", "Im Addon-Store gibt es gerade keine Addons."));
			}
		}
		List<AddonStore.Entry> sorted = new ArrayList<>(entries);
		sorted.sort(java.util.Comparator.comparingInt(this::storeOrder).thenComparing(e -> -e.downloads()).thenComparing(AddonStore.Entry::name));
		for (AddonStore.Entry entry : sorted) list.add(new StoreCard(entry));
		if (!entries.isEmpty()) {
			list.add(new Text("Alle Addons sind vom HeldixClient-Team geprüft und signiert. Installieren, Aktualisieren und Entfernen wirken nach einem Neustart des Spiels.", Ui.FAINT));
		}
	}

	/** Reihenfolge im Store: Updates, nicht installiert, installiert, nicht passend */
	private int storeOrder(AddonStore.Entry entry) {
		if (entry.problem() != null) return 3;
		String installed = AddonStore.installedVersion(entry.id());
		if (installed == null) return 1;
		return AddonManager.compareVersions(entry.version(), installed) > 0 ? 0 : 2;
	}

	private void buildSettingsRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new Section("Design", null));
		list.add(new Group(List.of(
				new SettingRow(configToggle("Heldix-Design für Menüs", "Startseite, Einzel- und Mehrspieler sowie Knöpfe im Heldix-Stil",
						() -> config.customMenus, v -> config.customMenus = v)),
				new SettingRow(configToggle("Heldix-Hintergrund", "Eigenes Motiv statt des Minecraft-Panoramas",
						() -> config.heldixBackground, v -> config.heldixBackground = v)),
				new SettingRow(configToggle("Ladebildschirm", "Heldix-Logo statt Mojang beim Laden",
						() -> config.customLoadingScreen, v -> config.customLoadingScreen = v)),
				new SettingRow(configToggle("F3-Menü im Heldix-Design", "Dunkle Zeilen mit Akzentlinie",
						() -> config.customDebugScreen, v -> config.customDebugScreen = v)))));
		list.add(new Section("HUD", null));
		list.add(new Group(List.of(
				new SettingRow(new Setting.Action("HUD-Editor", "Elemente verschieben, vergrößern, ein- und ausblenden", "Öffnen",
						() -> minecraft.gui.setScreen(new HudEditorScreen(this)))),
				new SettingRow(new Setting.Choice("HUD-Stil", "Heldix wie das Menü, Minimal ohne Fläche, Klassisch wie früher", dev.heldixclient.hud.HudStyles.NAMES,
						() -> config.hudStyle, v -> {
							config.hudStyle = v;
							HeldixConfig.save();
						})),
				new SettingRow(new Setting.Slider("Deckkraft", "Hintergrund der HUD-Elemente", 0, 1, 0.05, () -> config.hudOpacity, v -> {
					config.hudOpacity = (float) v;
					HeldixConfig.save();
				}, Setting::percent)),
				new SettingRow(new Setting.Slider("HUD-Größe", "Alle Elemente zusammen (einzelne im HUD-Editor)", 0.5, 2, 0.05, () -> config.hudScale, v -> {
					config.hudScale = (float) v;
					HeldixConfig.save();
				}, Setting::percent)),
				new SettingRow(new Setting.Color("Akzentfarbe", "Beschriftungen, Balken und Symbole im HUD",
						dev.heldixclient.hud.HudStyles.defaultAccent(dev.heldixclient.hud.HudStyles.kind()), dev.heldixclient.hud.HudStyles::globalAccent, v -> {
							config.hudAccent = v;
							HeldixConfig.save();
						})),
				new SettingRow(configToggle("HUD-Hintergrund", "Dunkle Box hinter den HUD-Elementen",
						() -> config.hudBackground, v -> config.hudBackground = v)),
				new SettingRow(configToggle("Scharfe Schrift", "Größen so runden, dass Schrift und Kanten auf ganzen Bildschirmpixeln liegen",
						() -> config.hudCrisp, v -> config.hudCrisp = v)),
				new SettingRow(configToggle("Mit F3 ausblenden", "HUD-Elemente verschwinden, solange das F3-Menü offen ist",
						() -> config.hudHideDebug, v -> config.hudHideDebug = v)),
				new SettingRow(configToggle("Im Chat ausblenden", "HUD-Elemente verschwinden, solange der Chat offen ist",
						() -> config.hudHideChat, v -> config.hudHideChat = v)),
				new SettingRow(configToggle("Im Chat anklickbar", "Bei offenem Chat zeigen Elemente Tooltips und reagieren auf Klicks",
						() -> config.hudClickable, v -> config.hudClickable = v)),
				new SettingRow(new Setting.Action("Positionen", "Alle Elemente an ihre Standardstelle", "Zurücksetzen", () -> {
					ModuleManager.hud().forEach(HudModule::resetPosition);
					HeldixConfig.save();
				})))));
		list.add(new Section("Tasten", "Klick, dann die neue Taste drücken · Tasten der Module in ihrem Untermenü"));
		list.add(new Group(List.of(
				new SettingRow(new Setting.Key("Heldix-Menü öffnen", "Im Spiel", HeldixClient.menuKey)),
				new SettingRow(new Setting.Key("Zoom", "Halten zum Heranzoomen", HeldixClient.zoomKey)),
				new SettingRow(new Setting.Key("Freelook", "Halten zum Umschauen", HeldixClient.freelookKey)),
				new SettingRow(new Setting.Key("Wegpunkt setzen", "An deiner Position", HeldixClient.waypointKey)),
				new SettingRow(new Setting.Key("HUD bedienen", "Maus frei, um HUD-Elemente anzuklicken", HeldixClient.hudKey)),
				new SettingRow(new Setting.Key("Spielermenü", "Auf einen Spieler zielen und drücken: Freund hinzufügen, Name kopieren …", HeldixClient.playerMenuKey)))));
	}

	private Setting.Toggle configToggle(String label, String description, BooleanSupplier get, Consumer<Boolean> set) {
		return new Setting.Toggle(label, description, get, value -> {
			set.accept(value);
			HeldixConfig.save();
		});
	}

	private void buildInfoRows(List<Row> list) {
		addPageMessage(list);
		if (Social.websiteUrl() != null) {
			list.add(new Section("Hilfe", null));
			List<Row> help = new ArrayList<>();
			if (Social.online()) {
				help.add(new SettingRow(new Setting.Action("Hilfe & Support", "Frag das HeldixClient-Team; die Antwort kommt hier als Einblendung", "Im Browser öffnen",
						() -> Social.webLink("support").whenComplete((url, error) -> minecraft.execute(() -> {
							if (error != null) {
								pageMessage(errorText(error), false);
								return;
							}
							Blaze3D.openUri(java.net.URI.create(url));
							pageMessage("Support ist im Browser geöffnet.", true);
						})))));
			}
			help.add(new SettingRow(new Setting.Action("Hilfe-Center", "Anleitungen und Lösungen zu Anmeldung, Grafik, Modulen und mehr", "Öffnen", () -> openWebsite("hilfe"))));
			help.add(new SettingRow(new Setting.Action("Neuigkeiten und Versionen", "Was in jeder Version neu ist", "Öffnen", () -> openWebsite("neuigkeiten"))));
			help.add(new SettingRow(new Setting.Action("Das Team", "Wer hinter HeldixClient steht", "Öffnen", () -> openWebsite("das-team"))));
			list.add(new Group(help));
		}
		list.add(new Section("Version", null));
		list.add(new Group(List.of(
				new Info("HeldixClient", HeldixClient.version),
				new Info("Heldix Loader", HeldixLoader.version()),
				new Info("Minecraft", HeldixLoader.minecraftVersion()),
				new Info("Java", System.getProperty("java.version")),
				new Info("Grafik", DebugOverlay.backend() + " · " + gpuName()))));
		list.add(new Section("Mods", HeldixLoader.mods().size() + " geladen"));
		list.add(new Group(HeldixLoader.mods().stream().<Row>map(mod -> new Info(mod.name(), mod.version())).toList()));
		List<String> problems = HeldixLoader.problems();
		if (!problems.isEmpty()) {
			list.add(new Section("Hinweise beim Start", Integer.toString(problems.size())));
			for (String problem : problems) list.add(new Notice("warning", problem, Ui.DANGER));
		}
		list.add(new Text("Schrift: Inter (SIL Open Font License 1.1)", Ui.FAINT));
	}

	private static String gpuName() {
		GpuDevice device = RenderSystem.tryGetDevice();
		return device == null ? "?" : device.getDeviceInfo().name();
	}

	// ======================================================================================
	// Zeilen
	// ======================================================================================

	/** Ein Element im Inhaltsbereich; Position und Breite werden beim Zeichnen übergeben. */
	private interface Row {
		int height(int width);

		void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY);

		default boolean click(double mouseX, double mouseY, int x, int y, int w) {
			return false;
		}

		/** Rechtsklick (z. B. Nachricht kopieren) */
		default boolean secondaryClick(double mouseX, double mouseY, int x, int y, int w) {
			return false;
		}

		/** Abstand zur nächsten Zeile */
		default int gapAfter() {
			return 6;
		}

		/** Lage einer passenden Zeile in dieser (auch verschachtelt): {x, y, Breite, Höhe} relativ zu dieser, sonst null */
		default int[] find(java.util.function.Predicate<Row> match, int width) {
			return match.test(this) ? new int[] {0, 0, width, height(width)} : null;
		}
	}

	/** Zeile, die in einer {@link Group} ohne eigene Fläche gezeichnet wird (die Karte zieht Trennlinien) */
	private interface Groupable {
		void grouped();
	}

	/**
	 * Karte mit mehreren Zeilen, getrennt durch feine Linien; optional mit Kopf (Icon, Titel, Zusatz und Link rechts).
	 * Zeilen, die nicht {@link Groupable} sind (Text, Chips), bekommen einen Innenabstand.
	 */
	private final class Group implements Row {
		private static final int HEAD = 28;
		private final String icon;
		private final String title;
		private final String hint;
		private final List<Row> rows;
		private String link;
		private Runnable linkAction;
		/** von {@link Columns} gesetzt: so hoch wie die Nachbarkarte */
		private int stretch;

		Group(List<Row> rows) {
			this(null, null, null, rows);
		}

		Group(String icon, String title, String hint, List<Row> rows) {
			this.icon = icon;
			this.title = title;
			this.hint = hint;
			this.rows = rows;
			for (Row row : rows) if (row instanceof Groupable groupable) groupable.grouped();
		}

		Group link(String label, Runnable action) {
			this.link = label;
			this.linkAction = action;
			return this;
		}

		private int head() {
			return title == null ? 0 : HEAD;
		}

		private int childHeight(Row row, int w) {
			return row instanceof Groupable ? row.height(w) : row.height(w - 24) + 14;
		}

		@Override
		public int height(int width) {
			int h = head();
			for (Row row : rows) h += childHeight(row, width);
			return Math.max(h, stretch);
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		private int linkWidth() {
			return link == null ? 0 : Ui.width(link, Ui.Font.SMALL) + 22;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			Ui.rect(g, x, y, w, h, 10, Ui.SURFACE);
			Ui.outline(g, x, y, w, h, 10, Ui.LINE);
			int cy = y;
			if (title != null) {
				Ui.rect(g, x + 10, y + 7, 15, 15, 4, Ui.ACCENT_SOFT);
				Ui.icon(g, icon, x + 13, y + 10, 9, Ui.ACCENT_TEXT);
				int lw = linkWidth();
				Ui.text(g, Ui.ellipsize(title, w - 50 - lw, Ui.Font.LABEL), x + 32, y + 11, Ui.TEXT, Ui.Font.LABEL);
				if (hint != null) {
					int hx = x + 32 + Ui.width(title, Ui.Font.LABEL) + 7;
					int room = x + w - 12 - lw - hx;
					if (room > 24) Ui.text(g, Ui.ellipsize(hint, room, Ui.Font.SMALL), hx, y + 12, Ui.FAINT, Ui.Font.SMALL);
				}
				if (link != null) {
					int lx = x + w - 8 - lw;
					boolean over = Ui.inside(mouseX, mouseY, lx, y + 5, lw, 18);
					if (over) Ui.rect(g, lx, y + 5, lw, 18, 6, Ui.SURFACE_HOVER);
					Ui.text(g, link, lx + 7, y + 11, over ? Ui.TEXT : Ui.MUTED, Ui.Font.SMALL);
					Ui.icon(g, "chevron-right", lx + lw - 13, y + 10, 8, over ? Ui.TEXT : Ui.FAINT);
				}
				cy += HEAD;
				if (!rows.isEmpty()) Ui.hline(g, x + 1, x + w - 1, cy, Ui.LINE);
			}
			for (int i = 0; i < rows.size(); i++) {
				Row row = rows.get(i);
				int rh = childHeight(row, w);
				if (i > 0) Ui.hline(g, x + 12, x + w - 12, cy, Ui.LINE);
				if (row instanceof Groupable) row.draw(g, x, cy, w, mouseX, mouseY);
				else row.draw(g, x + 12, cy + 7, w - 24, mouseX, mouseY);
				cy += rh;
			}
		}

		@Override
		public int[] find(java.util.function.Predicate<Row> match, int w) {
			if (match.test(this)) return new int[] {0, 0, w, height(w)};
			int cy = head();
			for (Row row : rows) {
				int rh = childHeight(row, w);
				if (row instanceof Groupable) {
					int[] found = row.find(match, w);
					if (found != null) return new int[] {found[0], cy + found[1], found[2], found[3]};
				} else {
					int[] found = row.find(match, w - 24);
					if (found != null) return new int[] {12 + found[0], cy + 7 + found[1], found[2], found[3]};
				}
				cy += rh;
			}
			return null;
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (link != null && Ui.inside(mouseX, mouseY, x + w - 8 - linkWidth(), y + 5, linkWidth(), 18)) {
				HeldixMenuScreen.this.click();
				linkAction.run();
				return true;
			}
			int cy = y + head();
			for (Row row : rows) {
				int rh = childHeight(row, w);
				if (mouseY >= cy && mouseY < cy + rh) {
					return row instanceof Groupable ? row.click(mouseX, mouseY, x, cy, w) : row.click(mouseX, mouseY, x + 12, cy + 7, w - 24);
				}
				cy += rh;
			}
			return false;
		}
	}

	/** Zwei Karten nebeneinander (gleich hoch); in schmalen Fenstern untereinander */
	private final class Columns implements Row {
		private static final int MIN_W = 430;
		private static final int SPACE = 10;
		private final Row left;
		private final Row right;

		Columns(Row left, Row right) {
			this.left = left;
			this.right = right;
		}

		private boolean split(int w) {
			return w >= MIN_W;
		}

		private int columnW(int w) {
			return (w - SPACE) / 2;
		}

		@Override
		public int height(int width) {
			if (!split(width)) return left.height(width) + left.gapAfter() + right.height(width);
			int cw = columnW(width);
			return Math.max(left.height(cw), right.height(width - cw - SPACE));
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (!split(w)) {
				left.draw(g, x, y, w, mouseX, mouseY);
				right.draw(g, x, y + left.height(w) + left.gapAfter(), w, mouseX, mouseY);
				return;
			}
			int cw = columnW(w);
			int h = height(w);
			if (left instanceof Group group) group.stretch = h;
			if (right instanceof Group group) group.stretch = h;
			left.draw(g, x, y, cw, mouseX, mouseY);
			right.draw(g, x + cw + SPACE, y, w - cw - SPACE, mouseX, mouseY);
			if (left instanceof Group group) group.stretch = 0;
			if (right instanceof Group group) group.stretch = 0;
		}

		@Override
		public int[] find(java.util.function.Predicate<Row> match, int w) {
			if (match.test(this)) return new int[] {0, 0, w, height(w)};
			if (!split(w)) {
				int[] found = left.find(match, w);
				if (found != null) return found;
				found = right.find(match, w);
				int dy = left.height(w) + left.gapAfter();
				return found == null ? null : new int[] {found[0], dy + found[1], found[2], found[3]};
			}
			int cw = columnW(w);
			int[] found = left.find(match, cw);
			if (found != null) return found;
			found = right.find(match, w - cw - SPACE);
			return found == null ? null : new int[] {cw + SPACE + found[0], found[1], found[2], found[3]};
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (!split(w)) {
				int lh = left.height(w);
				if (mouseY < y + lh) return left.click(mouseX, mouseY, x, y, w);
				return right.click(mouseX, mouseY, x, y + lh + left.gapAfter(), w);
			}
			int cw = columnW(w);
			if (mouseX < x + cw) return left.click(mouseX, mouseY, x, y, cw);
			if (mouseX >= x + cw + SPACE) return right.click(mouseX, mouseY, x + cw + SPACE, y, w - cw - SPACE);
			return false;
		}
	}

	/** Leerer Zustand: Icon im Kreis, Titel und eine kurze Erklärung, mittig */
	private final class EmptyState implements Row {
		private final String icon;
		private final String title;
		private final String text;

		EmptyState(String icon, String title, String text) {
			this.icon = icon;
			this.title = title;
			this.text = text;
		}

		private List<FormattedCharSequence> lines(int w) {
			return Ui.wrap(text, Math.min(w - 32, 300), Ui.Font.BODY);
		}

		@Override
		public int height(int width) {
			return 18 + 30 + 10 + 12 + 4 + lines(width).size() * 11 + 16;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			Ui.rect(g, x, y, w, h, 12, 0x08FFFFFF);
			Ui.outline(g, x, y, w, h, 12, Ui.LINE);
			int cx = x + w / 2;
			Ui.circle(g, cx, y + 33, 15, Ui.ACCENT_SOFT);
			Ui.icon(g, icon, cx - 7, y + 26, 14, Ui.ACCENT_TEXT);
			Ui.textCentered(g, title, cx, y + 58, Ui.TEXT, Ui.Font.LABEL);
			int ly = y + 74;
			for (FormattedCharSequence line : lines(w)) {
				g.text(font, line, cx - font.width(line) / 2, ly, Ui.MUTED, false);
				ly += 11;
			}
		}
	}

	/** Überschrift eines Abschnitts mit optionalem Hinweis daneben. */
	private final class Section implements Row {
		private final String title;
		private final String hint;

		Section(String title, String hint) {
			this.title = title;
			this.hint = hint;
		}

		@Override
		public int height(int width) {
			return 18;
		}

		@Override
		public int gapAfter() {
			return 4;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			String head = title.toUpperCase(Locale.ROOT);
			Ui.text(g, head, x + 2, y + 8, Ui.FAINT, Ui.Font.SMALL);
			if (hint != null) {
				int hx = x + 2 + Ui.width(head, Ui.Font.SMALL) + 8;
				Ui.text(g, Ui.ellipsize(hint, x + w - hx, Ui.Font.SMALL), hx, y + 8, Ui.MUTED, Ui.Font.SMALL);
			}
		}
	}

	/** Mehrzeiliger Text (umgebrochen). */
	private final class Text implements Row {
		private final String text;
		private final int color;

		Text(String text, int color) {
			this.text = text;
			this.color = color;
		}

		@Override
		public int height(int width) {
			return Ui.wrap(text, width - 4, Ui.Font.BODY).size() * 11 + 2;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int lineY = y + 2;
			for (FormattedCharSequence line : Ui.wrap(text, w - 4, Ui.Font.BODY)) {
				g.text(font, line, x + 2, lineY, color, false);
				lineY += 11;
			}
		}
	}

	/** Hinweis mit Icon in einer getönten Fläche, optional mit einem Knopf rechts */
	private final class Notice implements Row {
		private final String icon;
		private final String text;
		private final int color;
		private String button;
		private Runnable action;

		Notice(String icon, String text, int color) {
			this.icon = icon;
			this.text = text;
			this.color = color;
		}

		Notice action(String button, Runnable action) {
			this.button = button;
			this.action = action;
			return this;
		}

		private int buttonWidth() {
			return button == null ? 0 : Ui.width(button, Ui.Font.SMALL) + 20;
		}

		private int textWidth(int w) {
			return w - 34 - (button == null ? 0 : buttonWidth() + 10);
		}

		@Override
		public int height(int width) {
			return Math.max(button == null ? 0 : 28, Ui.wrap(text, textWidth(width), Ui.Font.BODY).size() * 11 + 14);
		}

		@Override
		public int gapAfter() {
			return 8;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			Ui.rect(g, x, y, w, h, 8, (color & 0xFFFFFF) | 0x14000000);
			Ui.outline(g, x, y, w, h, 8, (color & 0xFFFFFF) | 0x33000000);
			List<FormattedCharSequence> lines = Ui.wrap(text, textWidth(w), Ui.Font.BODY);
			int lineY = y + (h - lines.size() * 11) / 2 + 1;
			Ui.icon(g, icon, x + 10, lineY - 1, 11, color);
			for (FormattedCharSequence line : lines) {
				g.text(font, line, x + 28, lineY, 0xFFD5DCE8, false);
				lineY += 11;
			}
			if (button != null) {
				int bw = buttonWidth();
				int bx = x + w - 8 - bw;
				int by = y + (h - 16) / 2;
				pill(g, button, bx, by, bw, true, Ui.inside(mouseX, mouseY, bx, by, bw, 16));
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (button == null) return false;
			int bw = buttonWidth();
			int h = height(w);
			if (!Ui.inside(mouseX, mouseY, x + w - 8 - bw, y + (h - 16) / 2, bw, 16)) return false;
			HeldixMenuScreen.this.click();
			action.run();
			return true;
		}
	}

	/** "Bezeichnung …… Wert"; in einer Karte mit Innenabstand (Trennlinien zieht die Karte) */
	private final class Info implements Row, Groupable {
		private final String label;
		private final String value;
		private boolean grouped;

		Info(String label, String value) {
			this.label = label;
			this.value = value == null ? "-" : value;
		}

		@Override
		public void grouped() {
			grouped = true;
		}

		@Override
		public int height(int width) {
			return grouped ? 24 : 16;
		}

		@Override
		public int gapAfter() {
			return 0;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int pad = grouped ? 12 : 2;
			int ty = grouped ? y + 8 : y + 4;
			String shownLabel = Ui.ellipsize(label, w / 2, Ui.Font.BODY);
			Ui.text(g, shownLabel, x + pad, ty, Ui.MUTED, Ui.Font.BODY);
			String shown = Ui.ellipsize(value, w - Ui.width(shownLabel, Ui.Font.BODY) - 16 - pad * 2, Ui.Font.BODY);
			Ui.textRight(g, shown, x + w - pad, ty, Ui.TEXT, Ui.Font.BODY);
			if (!grouped) Ui.hline(g, x, x + w, y + 15, Ui.LINE);
		}
	}

	/** Kopf eines Untermenüs: großes Icon, Name, Beschreibung und Hauptschalter */
	private final class ModuleHeader implements Row {
		private final Module module;

		ModuleHeader(Module module) {
			this.module = module;
		}

		@Override
		public int height(int width) {
			return 48;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean on = module.isEnabled();
			float t = animate(module, on ? 1f : 0f);
			int accent = module.source() != null ? Ui.SUCCESS : Ui.ACCENT;
			Ui.rect(g, x, y, w, 48, 10, Ui.lerp(Ui.SURFACE, (accent & 0xFFFFFF) | 0x1A000000, t));
			Ui.outline(g, x, y, w, 48, 10, Ui.lerp(Ui.LINE, (accent & 0xFFFFFF) | 0x66000000, t));
			Ui.rect(g, x + 10, y + 9, 30, 30, 8, Ui.lerp(0x1AFFFFFF, accent, t));
			Ui.icon(g, module.icon(), x + 17, y + 16, 16, Ui.lerp(Ui.MUTED, 0xFFFFFFFF, t));
			int textW = w - 50 - 70;
			Ui.text(g, Ui.ellipsize(module.name(), textW, Ui.Font.LABEL), x + 50, y + 12, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(module.description(), textW, Ui.Font.SMALL), x + 50, y + 26, Ui.MUTED, Ui.Font.SMALL);
			String state = on ? "Aktiv" : "Aus";
			Ui.textRight(g, state, x + w - 36, y + 20, on ? Ui.ACCENT_TEXT : Ui.FAINT, Ui.Font.SMALL);
			Ui.toggle(g, x + w - 30, y + 19, t);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			module.toggle();
			return true;
		}

		@Override
		public int gapAfter() {
			return 10;
		}
	}

	/** Eine Einstellung: Schalter, Regler, Auswahl oder Knopf. In einer Karte ohne eigene Fläche. */
	private final class SettingRow implements Row, Groupable {
		private final Setting setting;
		private boolean grouped;

		SettingRow(Setting setting) {
			this.setting = setting;
		}

		@Override
		public void grouped() {
			grouped = true;
		}

		private boolean hasDescription() {
			return setting.description() != null && !setting.description().isEmpty();
		}

		@Override
		public int height(int width) {
			int extra = grouped ? 2 : 0;
			if (setting instanceof Setting.Slider) return (hasDescription() ? 44 : 34) + extra;
			if (setting instanceof Setting.Text) return (hasDescription() ? 54 : 44) + extra;
			int base = (hasDescription() ? 34 : 26) + extra;
			if (setting instanceof Setting.Color color && color.label().equals(colorOpen)) base += paletteHeight(color, width) + 6;
			return base;
		}

		/** Breite des Bedienelements rechts */
		private int controlWidth() {
			return switch (setting) {
				case Setting.Toggle toggle -> 18;
				case Setting.Choice choice -> {
					int max = 0;
					for (String option : choice.options()) max = Math.max(max, Ui.width(option, Ui.Font.LABEL));
					yield max + 34;
				}
				case Setting.Action action -> Ui.width(action.button(), Ui.Font.LABEL) + 20;
				case Setting.Color color -> 40;
				case Setting.Slider slider -> 0;
				case Setting.Text text -> 0;
				case Setting.Key key -> keyChipWidth(key) + (key.mapping().isDefault() ? 0 : 24);
			};
		}

		// --- Taste (Chip mit der Belegung, Klick = neue Taste drücken) ---

		private int keyChipWidth(Setting.Key key) {
			return Math.max(64, Ui.width(keyText(key), Ui.Font.LABEL) + 22);
		}

		private void drawKey(GuiGraphicsExtractor g, Setting.Key key, int x, int y, int w, int h, int mouseX, int mouseY) {
			KeyMapping mapping = key.mapping();
			boolean capturing = mapping == keyCapture;
			int cw = keyChipWidth(key);
			int cx = x + w - 12 - cw;
			int cy = y + (h - 18) / 2;
			boolean over = Ui.inside(mouseX, mouseY, cx, cy, cw, 18);
			String conflict = keyConflict(mapping);
			float pulse = capturing ? 0.5f + 0.5f * (float) Math.sin(System.nanoTime() / 160_000_000.0) : 0f;
			int fill = capturing ? Ui.withAlpha(0x553B82F6, 0.6f + 0.4f * pulse) : over ? Ui.SURFACE_STRONG : 0x14FFFFFF;
			Ui.rect(g, cx, cy, cw, 18, 6, fill);
			Ui.outline(g, cx, cy, cw, 18, 6, capturing ? Ui.ACCENT : conflict != null ? (Ui.WARNING & 0xFFFFFF) | 0x99000000 : Ui.LINE_STRONG);
			int textColor = capturing ? 0xFFFFFFFF : mapping.isUnbound() ? Ui.FAINT : Ui.TEXT;
			if (conflict != null && !capturing) {
				Ui.icon(g, "warning", cx + 6, cy + 4, 10, Ui.WARNING);
				Ui.text(g, keyText(key), cx + 19, cy + 5, textColor, Ui.Font.LABEL);
			} else {
				Ui.textCentered(g, keyText(key), cx + cw / 2, cy + 5, textColor, Ui.Font.LABEL);
			}
			if (over) {
				Ui.requestTooltip(capturing ? "Neue Taste drücken · Entf = nicht belegt · Esc = abbrechen"
						: conflict != null ? "Auch belegt: " + conflict + " · Klick zum Ändern" : "Klick, dann die neue Taste drücken", mouseX, mouseY);
			}
			// zurück auf die Standardtaste
			if (!mapping.isDefault() && !capturing) {
				int rx = cx - 22;
				boolean overReset = Ui.inside(mouseX, mouseY, rx, cy, 18, 18);
				if (overReset) {
					Ui.rect(g, rx, cy, 18, 18, 6, Ui.SURFACE_STRONG);
					Ui.requestTooltip("Standard: " + defaultKeyText(mapping), mouseX, mouseY);
				}
				Ui.icon(g, "reset", rx + 4, cy + 4, 10, overReset ? Ui.TEXT : Ui.MUTED);
			}
			settingCenters.put(key.label() + "#reset", new int[] {cx - 13, cy + 9});
		}

		/** Klick auf den Chip startet bzw. beendet das Warten auf eine Taste; Klick auf ↺ setzt die Standardtaste */
		private boolean clickKey(Setting.Key key, double mouseX, double mouseY, int x, int y, int w, int h) {
			KeyMapping mapping = key.mapping();
			int cw = keyChipWidth(key);
			int cx = x + w - 12 - cw;
			int cy = y + (h - 18) / 2;
			if (!mapping.isDefault() && mapping != keyCapture && Ui.inside(mouseX, mouseY, cx - 22, cy, 18, 18)) {
				bindKey(mapping, mapping.getDefaultKey());
				return true;
			}
			if (mapping == captureCancelled) return true;
			HeldixMenuScreen.this.click();
			keyCapture = mapping == keyCapture ? null : mapping;
			return true;
		}

		// --- Farbpalette (aufgeklappt unter der Zeile) ---

		private static final int SWATCH = 16;
		private static final int SWATCH_GAP = 6;

		private int paletteColumns(int w) {
			return Math.max(1, (w - 24 + SWATCH_GAP) / (SWATCH + SWATCH_GAP));
		}

		private int paletteHeight(Setting.Color color, int w) {
			int rows = (color.palette().size() + paletteColumns(w) - 1) / paletteColumns(w);
			return rows * (SWATCH + SWATCH_GAP) - SWATCH_GAP;
		}

		/** obere Kante der Palette: unter der normalen Zeile */
		private int paletteY(int y) {
			return y + (hasDescription() ? 34 : 26) + (grouped ? 2 : 0);
		}

		private int[] swatch(int index, int x, int y, int w) {
			int columns = paletteColumns(w);
			return new int[] {x + 12 + (index % columns) * (SWATCH + SWATCH_GAP), paletteY(y) + (index / columns) * (SWATCH + SWATCH_GAP)};
		}

		/** Höhe der normalen Zeile (ohne aufgeklappte Palette) */
		private int rowHeight(int w) {
			return setting instanceof Setting.Color ? (hasDescription() ? 34 : 26) + (grouped ? 2 : 0) : height(w);
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, h);
			float t = animate(this, hover ? 1f : 0f);
			if (grouped) {
				if (t > 0.01f) Ui.rect(g, x + 3, y + 2, w - 6, h - 4, 7, Ui.withAlpha(Ui.SURFACE, t));
			} else {
				Ui.rect(g, x, y, w, h, 9, Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, t));
				Ui.outline(g, x, y, w, h, 9, Ui.LINE);
			}
			// Regler und Textfeld: Beschriftung oben, Bedienelement darunter über die ganze Breite
			boolean wide = setting instanceof Setting.Slider || setting instanceof Setting.Text;
			int rh = rowHeight(w);
			int textW = setting instanceof Setting.Slider ? w - 80 : wide ? w - 24 : w - 24 - controlWidth() - 8;
			int labelY = hasDescription() ? y + (rh - 20) / 2 : y + (rh - 8) / 2;
			if (wide) labelY = y + 8;
			Ui.text(g, Ui.ellipsize(setting.label(), textW, Ui.Font.LABEL), x + 12, labelY, Ui.TEXT, Ui.Font.LABEL);
			if (hasDescription()) {
				Ui.text(g, Ui.ellipsize(setting.description(), wide ? w - 24 : textW, Ui.Font.SMALL), x + 12, labelY + 12, Ui.MUTED, Ui.Font.SMALL);
			}
			settingCenters.put(setting.label(), switch (setting) {
				case Setting.Toggle toggle -> new int[] {x + w - 21, y + h / 2};
				case Setting.Slider s -> new int[] {x + w / 2, y + h - 9};
				case Setting.Text text -> new int[] {x + w / 2, y + h - 16 - (grouped ? 2 : 0)};
				default -> new int[] {x + w - 12 - controlWidth() / 2, y + rh / 2};
			});
			// Tastatur: die Zeile ist ein Ziel; Enter/Leertaste wie ein Klick, Pfeil links/rechts für Regler und Auswahl
			keyTarget(x, y, w, rh, switch (setting) {
				case Setting.Toggle toggle -> () -> {
					toggle.set().accept(!toggle.get().getAsBoolean());
					HeldixMenuScreen.this.click();
				};
				case Setting.Choice choice -> () -> {
					choice.set().accept(Math.floorMod(choice.get().getAsInt() + 1, choice.options().size()));
					HeldixMenuScreen.this.click();
				};
				case Setting.Action action -> () -> {
					HeldixMenuScreen.this.click();
					action.run().run();
				};
				case Setting.Color color -> () -> {
					HeldixMenuScreen.this.click();
					colorOpen = color.label().equals(colorOpen) ? null : color.label();
					revealPalette = colorOpen != null;
				};
				case Setting.Text text -> () -> {
					SearchField field = textFields.get(text.label());
					if (field != null && field.visible) {
						keyMode = false;
						setFocused(field);
						field.setFocused(true);
					}
				};
				case Setting.Slider slider -> null;
				case Setting.Key key -> () -> {
					HeldixMenuScreen.this.click();
					keyCapture = key.mapping() == keyCapture ? null : key.mapping();
				};
			}, switch (setting) {
				case Setting.Slider slider -> direction -> {
					double step = Math.max(slider.step(), (slider.max() - slider.min()) / 20);
					double value = slider.snap(slider.get().getAsDouble() + direction * step);
					if (value != slider.get().getAsDouble()) {
						slider.set().accept(value);
						HeldixConfig.save();
					}
				};
				case Setting.Choice choice -> direction -> {
					choice.set().accept(Math.floorMod(choice.get().getAsInt() + direction, choice.options().size()));
					HeldixMenuScreen.this.click();
				};
				default -> null;
			});
			switch (setting) {
				case Setting.Toggle toggle -> {
					float on = animate(setting.label() + "#toggle", toggle.get().getAsBoolean() ? 1f : 0f);
					Ui.toggle(g, x + w - 30, y + (h - 10) / 2f, on);
				}
				case Setting.Slider s -> drawSlider(g, s, x, y, w, h, mouseX, mouseY);
				case Setting.Choice choice -> {
					int cw = controlWidth();
					int cx = x + w - 12 - cw;
					int cy = y + (h - 18) / 2;
					boolean over = Ui.inside(mouseX, mouseY, cx, cy, cw, 18);
					Ui.rect(g, cx, cy, cw, 18, 9, over ? Ui.SURFACE_STRONG : 0x14FFFFFF);
					Ui.icon(g, "chevron-left", cx + 4, cy + 4, 10, Ui.ACCENT_TEXT);
					Ui.icon(g, "chevron-right", cx + cw - 14, cy + 4, 10, Ui.ACCENT_TEXT);
					String value = choice.current();
					Ui.textCentered(g, value, cx + cw / 2, cy + 5, Ui.TEXT, Ui.Font.LABEL);
				}
				case Setting.Action action -> {
					int bw = controlWidth();
					int bx = x + w - 12 - bw;
					int by = y + (h - 18) / 2;
					boolean over = Ui.inside(mouseX, mouseY, bx, by, bw, 18);
					Ui.rect(g, bx, by, bw, 18, 9, over ? Ui.ACCENT_HOVER : Ui.ACCENT);
					Ui.textCentered(g, action.button(), bx + bw / 2, by + 5, 0xFFFFFFFF, Ui.Font.LABEL);
				}
				case Setting.Color color -> drawColor(g, color, x, y, w, rh, mouseX, mouseY);
				case Setting.Key key -> drawKey(g, key, x, y, w, h, mouseX, mouseY);
				case Setting.Text text -> {
					SearchField field = textFields.get(text.label());
					if (field != null) {
						int fy = y + h - 26 - (grouped ? 2 : 0);
						field.setX(x + 12);
						field.setY(fy);
						field.setWidth(w - 24);
						// nur ganz sichtbare Felder zeigen (Widgets zeichnen über dem Inhalt, ohne Ausschnitt)
						field.visible = fy >= bodyY && fy + 20 <= bodyY + bodyH;
						if (!field.isFocused() && !field.getValue().equals(text.get().get())) field.setValue(text.get().get());
					}
				}
			}
		}

		/** Farbfeld rechts (Klick klappt die Palette auf) und darunter die Palette */
		private void drawColor(GuiGraphicsExtractor g, Setting.Color color, int x, int y, int w, int rh, int mouseX, int mouseY) {
			// gerade aufgeklappt: Palette ganz ins Bild holen
			if (color.label().equals(colorOpen) && revealPalette) {
				revealPalette = false;
				int bottom = y + height(w);
				if (bottom > bodyY + bodyH) scroll = Math.clamp(scroll + bottom - (bodyY + bodyH) + 6, 0, maxScroll());
			}
			int current = color.get().getAsInt();
			int cw = controlWidth();
			int cx = x + w - 12 - cw;
			int cy = y + (rh - 18) / 2;
			boolean open = color.label().equals(colorOpen);
			boolean over = Ui.inside(mouseX, mouseY, cx, cy, cw, 18);
			Ui.rect(g, cx, cy, cw, 18, 9, over || open ? Ui.SURFACE_STRONG : 0x14FFFFFF);
			Ui.rect(g, cx + 4, cy + 3, 18, 12, 6, current | 0xFF000000);
			Ui.outline(g, cx + 4, cy + 3, 18, 12, 6, Ui.LINE_STRONG);
			Ui.icon(g, open ? "chevron-down" : "chevron-right", cx + cw - 15, cy + 4, 10, Ui.ACCENT_TEXT);
			if (!open) return;
			List<Integer> palette = color.palette();
			for (int i = 0; i < palette.size(); i++) {
				int[] s = swatch(i, x, y, w);
				settingCenters.put(color.label() + "#" + i, new int[] {s[0] + SWATCH / 2, s[1] + SWATCH / 2});
				int value = palette.get(i);
				boolean selected = (value | 0xFF000000) == (current | 0xFF000000);
				boolean hover = Ui.inside(mouseX, mouseY, s[0], s[1], SWATCH, SWATCH);
				if (selected) Ui.rect(g, s[0] - 2, s[1] - 2, SWATCH + 4, SWATCH + 4, (SWATCH + 4) / 2f, 0xFFFFFFFF);
				else if (hover) Ui.rect(g, s[0] - 2, s[1] - 2, SWATCH + 4, SWATCH + 4, (SWATCH + 4) / 2f, Ui.LINE_STRONG);
				Ui.circle(g, s[0] + SWATCH / 2f, s[1] + SWATCH / 2f, SWATCH / 2f, value | 0xFF000000);
				// Punkt in der Mitte: Standardfarbe
				if (value == color.defaultColor()) Ui.circle(g, s[0] + SWATCH / 2f, s[1] + SWATCH / 2f, 2, 0x99000000);
			}
		}

		private void drawSlider(GuiGraphicsExtractor g, Setting.Slider slider, int x, int y, int w, int h, int mouseX, int mouseY) {
			double value = slider.get().getAsDouble();
			String shown = slider.format().apply(value);
			Ui.textRight(g, shown, x + w - 12, y + 8, Ui.ACCENT_TEXT, Ui.Font.LABEL);
			float tx = x + 12;
			float tw = w - 24;
			float ty = y + h - 11;
			float t = (float) ((value - slider.min()) / (slider.max() - slider.min()));
			Ui.rect(g, tx, ty, tw, 4, 2, 0x24FFFFFF);
			float fill = tw * Math.clamp(t, 0f, 1f);
			if (fill > 0) Ui.rect(g, tx, ty, fill, 4, 2, Ui.ACCENT);
			boolean active = dragging == slider || Ui.inside(mouseX, mouseY, tx - 3, ty - 6, tw + 6, 16);
			float knob = active ? 5.5f : 4.5f;
			Ui.circle(g, tx + fill, ty + 2, knob + 1, 0x55000000);
			Ui.circle(g, tx + fill, ty + 2, knob, 0xFFFFFFFF);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int h = height(w);
			switch (setting) {
				case Setting.Toggle toggle -> {
					toggle.set().accept(!toggle.get().getAsBoolean());
					HeldixMenuScreen.this.click();
					return true;
				}
				case Setting.Slider slider -> {
					float tx = x + 12;
					float tw = w - 24;
					float ty = y + h - 11;
					if (!Ui.inside(mouseX, mouseY, tx - 6, ty - 9, tw + 12, 20)) return false;
					dragging = slider;
					dragX = tx;
					dragW = tw;
					dragTo(mouseX);
					return true;
				}
				case Setting.Choice choice -> {
					int cw = controlWidth();
					boolean back = mouseX < x + w - 12 - cw / 2.0 && mouseX >= x + w - 12 - cw;
					int size = choice.options().size();
					choice.set().accept(Math.floorMod(choice.get().getAsInt() + (back ? -1 : 1), size));
					HeldixMenuScreen.this.click();
					return true;
				}
				case Setting.Action action -> {
					int bw = controlWidth();
					if (!Ui.inside(mouseX, mouseY, x + w - 12 - bw, y, bw, h)) return false;
					HeldixMenuScreen.this.click();
					action.run().run();
					return true;
				}
				case Setting.Color color -> {
					if (color.label().equals(colorOpen) && mouseY >= y + rowHeight(w)) {
						List<Integer> palette = color.palette();
						for (int i = 0; i < palette.size(); i++) {
							int[] s = swatch(i, x, y, w);
							if (Ui.inside(mouseX, mouseY, s[0] - 2, s[1] - 2, SWATCH + 4, SWATCH + 4)) {
								HeldixMenuScreen.this.click();
								color.set().accept(palette.get(i));
								colorOpen = null;
								return true;
							}
						}
						return false;
					}
					HeldixMenuScreen.this.click();
					colorOpen = color.label().equals(colorOpen) ? null : color.label();
					revealPalette = colorOpen != null;
					return true;
				}
				case Setting.Key key -> {
					return clickKey(key, mouseX, mouseY, x, y, w, h);
				}
				case Setting.Text text -> {
					// Klick neben das Feld: Zeile ganz ins Bild holen und das Feld auswählen
					SearchField field = textFields.get(text.label());
					if (field == null) return false;
					if (y + h > bodyY + bodyH) scroll = Math.clamp(scroll + (y + h - bodyY - bodyH), 0, maxScroll());
					else if (y < bodyY) scroll = Math.clamp(scroll - (bodyY - y), 0, maxScroll());
					setFocused(field);
					field.setFocused(true);
					return true;
				}
			}
		}
	}

	/** Kacheln zum Auswählen (Shader-Stile, Stufen). */
	private final class Chips implements Row {
		private final List<String> labels;
		private final int cols;
		private final IntSupplier active;
		private final IntConsumer select;

		Chips(List<String> labels, int cols, IntSupplier active, IntConsumer select) {
			this.labels = labels;
			this.cols = cols;
			this.active = active;
			this.select = select;
		}

		private int columns(int w) {
			return Math.max(1, Math.min(cols, (w + 6) / (76 + 6)));
		}

		int[] cell(int index, int x, int y, int w) {
			int c = columns(w);
			int cw = (w - 6 * (c - 1)) / c;
			return new int[] {x + (index % c) * (cw + 6), y + (index / c) * (CHIP_H + 6), cw};
		}

		@Override
		public int height(int width) {
			int c = columns(width);
			return (labels.size() + c - 1) / c * (CHIP_H + 6) - 6;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int current = active.getAsInt();
			for (int i = 0; i < labels.size(); i++) {
				int[] cell = cell(i, x, y, w);
				boolean on = i == current;
				boolean hover = Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], CHIP_H);
				Ui.rect(g, cell[0], cell[1], cell[2], CHIP_H, 8, on ? Ui.ACCENT_SOFT : hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
				Ui.outline(g, cell[0], cell[1], cell[2], CHIP_H, 8, on ? Ui.ACCENT_LINE : Ui.LINE);
				String label = Ui.ellipsize(labels.get(i), cell[2] - 10, Ui.Font.LABEL);
				Ui.textCentered(g, label, cell[0] + cell[2] / 2, cell[1] + 7, on ? Ui.TEXT : Ui.MUTED, Ui.Font.LABEL);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (int i = 0; i < labels.size(); i++) {
				int[] cell = cell(i, x, y, w);
				if (Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], CHIP_H)) {
					HeldixMenuScreen.this.click();
					select.accept(i);
					return true;
				}
			}
			return false;
		}
	}

	/** Module als Kacheln: Klick schaltet um, das Regler-Symbol öffnet das Untermenü. */
	private final class ModuleGrid implements Row {
		private final List<Module> modules;

		ModuleGrid(List<Module> modules) {
			this.modules = modules;
		}

		private int columns(int w) {
			return Math.clamp((w + GAP) / (TILE_MIN_W + GAP), 1, 5);
		}

		int[] cell(int index, int x, int y, int w) {
			int c = columns(w);
			int cw = (w - GAP * (c - 1)) / c;
			return new int[] {x + (index % c) * (cw + GAP), y + (index / c) * (TILE_H + GAP), cw};
		}

		@Override
		public int height(int width) {
			int c = columns(width);
			return (modules.size() + c - 1) / c * (TILE_H + GAP) - GAP;
		}

		private boolean onSettings(Module module, double mouseX, double mouseY, int[] cell) {
			return !module.settings().isEmpty() && Ui.inside(mouseX, mouseY, cell[0] + cell[2] - 26, cell[1] + 7, 20, 20);
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			for (int i = 0; i < modules.size(); i++) {
				Module module = modules.get(i);
				int[] cell = cell(i, x, y, w);
				int cx = cell[0];
				int cy = cell[1];
				int cw = cell[2];
				boolean on = module.isEnabled();
				boolean hover = Ui.inside(mouseX, mouseY, cx, cy, cw, TILE_H);
				float t = animate(module, on ? 1f : 0f);
				float h = animate("hover#" + module.id(), hover ? 1f : 0f);
				int accent = module.source() != null ? Ui.SUCCESS : Ui.ACCENT;

				int base = Ui.lerp(Ui.SURFACE, (accent & 0xFFFFFF) | 0x17000000, t);
				Ui.rect(g, cx, cy, cw, TILE_H, 10, Ui.lerp(base, Ui.lerp(Ui.SURFACE_HOVER, (accent & 0xFFFFFF) | 0x26000000, t), h));
				Ui.outline(g, cx, cy, cw, TILE_H, 10, Ui.lerp(Ui.LINE, (accent & 0xFFFFFF) | 0x80000000, t));

				// Icon
				Ui.rect(g, cx + 10, cy + 10, 26, 26, 8, Ui.lerp(0x16FFFFFF, accent, t));
				Ui.icon(g, module.icon(), cx + 16, cy + 16, 14, Ui.lerp(Ui.MUTED, 0xFFFFFFFF, t));

				// Regler-Symbol
				boolean hasSettings = !module.settings().isEmpty();
				if (hasSettings) {
					boolean overGear = onSettings(module, mouseX, mouseY, cell);
					if (overGear) Ui.rect(g, cx + cw - 26, cy + 7, 20, 20, 6, Ui.SURFACE_STRONG);
					Ui.icon(g, "options", cx + cw - 21, cy + 12, 10, overGear ? Ui.TEXT : Ui.FAINT);
					if (overGear) Ui.requestTooltip("Einstellungen", mouseX, mouseY);
				}

				// Name, Beschreibung, Schalter
				int textW = cw - 20 - 24;
				Ui.text(g, Ui.ellipsize(module.name(), textW, Ui.Font.LABEL), cx + 10, cy + 42, Ui.TEXT, Ui.Font.LABEL);
				String description = module.source() != null ? module.source() : module.description();
				Ui.text(g, Ui.ellipsize(description, cw - 20, Ui.Font.SMALL), cx + 10, cy + 54, module.source() != null ? 0xFF6EE7B7 : Ui.MUTED, Ui.Font.SMALL);
				Ui.toggle(g, cx + cw - 28, cy + 41, t);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (int i = 0; i < modules.size(); i++) {
				int[] cell = cell(i, x, y, w);
				if (!Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], TILE_H)) continue;
				Module module = modules.get(i);
				HeldixMenuScreen.this.click();
				if (onSettings(module, mouseX, mouseY, cell)) openSubmenu(module);
				else module.toggle();
				return true;
			}
			return false;
		}
	}

	/** Vorschau des Capes: Spielerfigur von hinten, Name und Beschreibung */
	private final class CapeShowcase implements Row {
		private static final int H = 124;

		@Override
		public int height(int width) {
			return H;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Capes.Cape selected = Capes.selected();
			Object shown = capeHoverShown != NO_HOVER ? capeHoverShown : selected == null ? NO_CAPE : selected;
			Capes.Cape cape = shown instanceof Capes.Cape c ? c : null;
			boolean preview = capeHoverShown != NO_HOVER && cape != selected;

			int pw = Math.clamp(w / 3, 84, 128);
			Ui.rect(g, x, y, pw, H, 12, 0x12FFFFFF);
			Ui.outline(g, x, y, pw, H, 12, Ui.LINE);
			Ui.rect(g, x + pw / 2f - 24, y + H - 17, 48, 7, 3.5f, 0x30000000);
			Capes.drawPlayer(g, Shell.skin(minecraft).get(), cape, x + 4, y + 6, x + pw - 4, y + H - 8, (System.nanoTime() - capeStart) / 1e9f);

			int tx = x + pw + 14;
			int tw = w - pw - 14;
			Ui.text(g, preview ? "VORSCHAU" : "DEIN CAPE", tx, y + 6, preview ? Ui.ACCENT_TEXT : Ui.FAINT, Ui.Font.SMALL);
			String name = cape != null ? cape.name() : "Kein Cape";
			Ui.text(g, Ui.ellipsize(name, tw, Ui.Font.TITLE), tx, y + 25, Ui.TEXT, Ui.Font.TITLE);
			String description = cape != null ? cape.description()
					: "Ohne Heldix-Cape. Ein Cape deines Minecraft-Kontos bleibt sichtbar.";
			int ly = y + 45;
			List<FormattedCharSequence> lines = Ui.wrap(description, tw, Ui.Font.BODY);
			for (int i = 0; i < Math.min(3, lines.size()); i++) {
				g.text(minecraft.font, lines.get(i), tx, ly, Ui.MUTED, false);
				ly += 11;
			}
			if (preview) Ui.text(g, "Klicken zum Auswählen", tx, ly + 3, Ui.FAINT, Ui.Font.SMALL);

			// Hinweise als Pillen unten
			int px = tx;
			int py = y + H - 20;
			HeldixConfig.Data config = HeldixConfig.get();
			List<String[]> pills = new ArrayList<>();
			boolean shared = cape != null && !cape.custom() && Social.online() && config.socialVisible;
			pills.add(new String[] {"eye", shared ? "Andere Heldix-Spieler sehen es" : "Nur für dich sichtbar"});
			if (cape != null && cape.glows() && config.capeGlow) pills.add(new String[] {"sparkles", "Leuchtet im Dunkeln"});
			if (cape != null && cape.animated() && config.capeAnimation) pills.add(new String[] {"play", "Animiert"});
			if (cape != null && config.capeElytra) pills.add(new String[] {"check", "Auch auf der Elytra"});
			for (String[] p : pills) {
				int pillW = Ui.width(p[1], Ui.Font.SMALL) + 24;
				if (px + pillW > x + w) break;
				px += pill(g, px, py, p[0], p[1]) + 6;
			}
		}

		private int pill(GuiGraphicsExtractor g, int x, int y, String icon, String text) {
			int pw = Ui.width(text, Ui.Font.SMALL) + 24;
			Ui.rect(g, x, y, pw, 16, 8, Ui.SURFACE);
			Ui.outline(g, x, y, pw, 16, 8, Ui.LINE);
			Ui.icon(g, icon, x + 6, y + 4, 8, Ui.MUTED);
			Ui.text(g, text, x + 17, y + 5, Ui.MUTED, Ui.Font.SMALL);
			return pw;
		}
	}

	/** Capes als Kacheln mit der Außenseite des Capes; Klick legt es an. */
	private final class CapeGrid implements Row {
		private static final int MIN_W = 58;
		private static final int TILE = 84;
		private final List<Object> capes;

		CapeGrid(List<Object> capes) {
			this.capes = capes;
		}

		private int columns(int w) {
			return Math.clamp((w + GAP) / (MIN_W + GAP), 3, 8);
		}

		int[] cell(int index, int x, int y, int w) {
			int c = columns(w);
			int cw = (w - GAP * (c - 1)) / c;
			return new int[] {x + (index % c) * (cw + GAP), y + (index / c) * (TILE + GAP), cw};
		}

		@Override
		public int height(int width) {
			int c = columns(width);
			return (capes.size() + c - 1) / c * (TILE + GAP) - GAP;
		}

		private boolean isSelected(Object entry, Capes.Cape selected) {
			return entry == NO_CAPE ? selected == null : entry == selected;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Capes.Cape selected = Capes.selected();
			for (int i = 0; i < capes.size(); i++) {
				Object entry = capes.get(i);
				int[] cell = cell(i, x, y, w);
				int cx = cell[0];
				int cy = cell[1];
				int cw = cell[2];
				boolean on = isSelected(entry, selected);
				boolean hover = Ui.inside(mouseX, mouseY, cx, cy, cw, TILE);
				float t = animate(entry, on ? 1f : 0f);
				float hv = animate("cape-hover#" + System.identityHashCode(entry), hover ? 1f : 0f);
				if (hover) capeHover = entry;

				Ui.rect(g, cx, cy, cw, TILE, 10, Ui.lerp(Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, hv), Ui.ACCENT_SOFT, t));
				Ui.outline(g, cx, cy, cw, TILE, 10, Ui.lerp(Ui.LINE, Ui.ACCENT_LINE, t));

				float ih = 46;
				float iw = ih * 10 / 16;
				float ix = cx + (cw - iw) / 2f;
				float iy = cy + 9 - hv * 1.5f;
				String name;
				if (entry instanceof Capes.Cape cape) {
					Ui.shadow(g, ix, iy, iw, ih, 0.35f);
					Capes.drawFront(g, cape, ix, iy, iw, ih, 1f);
					Ui.outline(g, ix, iy, iw, ih, 0, 0x33000000);
					name = cape.name();
					if (hover && cape.custom()) Ui.requestTooltip(cape.description(), mouseX, mouseY);
					if (cape.teamOnly()) {
						boolean locked = !dev.heldixclient.cosmetic.Cosmetics.team();
						Ui.circle(g, cx + 10, cy + 10, 6, 0x66000000);
						Ui.icon(g, locked ? "lock" : "shield", cx + 5, cy + 5, 10, locked ? Ui.WARNING : 0xFFFDE68A);
						if (hover) Ui.requestTooltip(locked ? "Nur für das HeldixClient-Team" : "Nur fürs Team – du darfst es tragen", mouseX, mouseY);
					} else if (cape.unlockOnly()) {
						// Belohnung für Einladungen: gesperrt bis freigeschaltet
						boolean locked = cape.lockReason() != null;
						Ui.circle(g, cx + 10, cy + 10, 6, 0x66000000);
						Ui.icon(g, locked ? "lock" : "star", cx + 5, cy + 5, 10, locked ? Ui.WARNING : 0xFFFDE68A);
						if (hover) Ui.requestTooltip(locked ? dev.heldixclient.cosmetic.Cosmetics.UNLOCK_HINT + " – lade Freunde ein (Freunde → Freunde einladen)"
								: dev.heldixclient.cosmetic.Cosmetics.UNLOCK_HINT + " – freigeschaltet", mouseX, mouseY);
					} else if (cape.glows() && HeldixConfig.get().capeGlow) {
						Ui.circle(g, cx + 10, cy + 10, 6, 0x66000000);
						Ui.icon(g, "sparkles", cx + 5, cy + 5, 10, 0xFFFDE68A);
					}
				} else {
					Ui.outline(g, ix, iy, iw, ih, 4, Ui.LINE_STRONG);
					Ui.icon(g, "close", ix + iw / 2f - 6, iy + ih / 2f - 6, 12, Ui.FAINT);
					name = "Ohne";
				}
				Ui.textCentered(g, Ui.ellipsize(name, cw - 8, Ui.Font.SMALL), cx + cw / 2, cy + TILE - 18, on ? Ui.TEXT : Ui.MUTED, Ui.Font.SMALL);
				if (t > 0.01f) {
					Ui.circle(g, cx + cw - 10, cy + 10, 6, Ui.withAlpha(Ui.ACCENT, t));
					Ui.icon(g, "check", cx + cw - 14, cy + 6, 8, Ui.withAlpha(0xFFFFFFFF, t));
				}
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (int i = 0; i < capes.size(); i++) {
				int[] cell = cell(i, x, y, w);
				if (!Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], TILE)) continue;
				HeldixMenuScreen.this.click();
				Object entry = capes.get(i);
				if (entry instanceof Capes.Cape cape && cape.teamOnly() && !dev.heldixclient.cosmetic.Cosmetics.team()) {
					capeMessage = "„" + cape.name() + "“ gibt es nur für das HeldixClient-Team.";
					capeMessageOk = false;
					capeMessageAt = System.currentTimeMillis();
					return true;
				}
				if (entry instanceof Capes.Cape cape && cape.lockReason() != null) {
					capeMessage = unlockText(cape.name());
					capeMessageOk = false;
					capeMessageAt = System.currentTimeMillis();
					return true;
				}
				Capes.select(entry instanceof Capes.Cape cape ? cape : null);
				return true;
			}
			return false;
		}
	}

	/** Seite Cosmetics: Figur mit der Auswahl (oder der Kachel unter der Maus), Name, Beschreibung und Hinweise */
	private final class CosmeticShowcase implements Row {
		private static final int H = 150;
		private final String slot;

		CosmeticShowcase(String slot) {
			this.slot = slot;
		}

		@Override
		public int height(int width) {
			return H;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			String chosen = dev.heldixclient.cosmetic.Cosmetics.mine(slot);
			dev.heldixclient.cosmetic.CosmeticCatalog.Item selected = dev.heldixclient.cosmetic.CosmeticCatalog.item(chosen, slot);
			boolean hovering = cosmeticHoverShown != NO_HOVER;
			dev.heldixclient.cosmetic.CosmeticCatalog.Item item = hovering
					? (cosmeticHoverShown instanceof dev.heldixclient.cosmetic.CosmeticCatalog.Item hovered ? hovered : null) : selected;
			boolean preview = hovering && item != selected;

			// Figur: eigene Auswahl in allen Slots, in diesem Slot das gezeigte Cosmetic
			cosmeticDress.copyOwn();
			cosmeticDress.set(slot, item == null ? null : item.id());
			int pw = Math.clamp(w * 2 / 5, 104, slot.equals("companion") ? 190 : 150);
			Ui.rect(g, x, y, pw, H, 12, 0x12FFFFFF);
			Ui.outline(g, x, y, pw, H, 12, Ui.LINE);
			Ui.rect(g, x + pw / 2f - 26, y + H - 17, 52, 7, 3.5f, 0x30000000);
			float seconds = (System.nanoTime() - capeStart) / 1e9f;
			float bodyRot = switch (slot) {
				case "back" -> (float) Math.sin(seconds * 0.6) * 38f;
				case "aura" -> 180f + seconds * 24f % 360f;
				case "companion" -> 215f + (float) Math.sin(seconds * 0.5) * 15f;
				default -> 180f + 28f + (float) Math.sin(seconds * 0.6) * 30f;
			};
			float zoom = slot.equals("companion") ? 0.72f : slot.equals("head") ? 0.92f : 0.9f;
			float focus = slot.equals("companion") ? 1.2f : slot.equals("head") ? 1.05f : -1f;
			Capes.drawFigure(g, Shell.skin(minecraft).get(), Capes.own(), cosmeticDress, x + 4, y + 6, x + pw - 4, y + H - 8, seconds, bodyRot, zoom, focus);

			int tx = x + pw + 14;
			int tw = w - pw - 14;
			Ui.text(g, preview ? "VORSCHAU" : "DU TRÄGST", tx, y + 6, preview ? Ui.ACCENT_TEXT : Ui.FAINT, Ui.Font.SMALL);
			String name = item != null ? item.name() : hovering ? "Ohne" : "Nichts gewählt";
			Ui.text(g, Ui.ellipsize(name, tw, Ui.Font.TITLE), tx, y + 25, Ui.TEXT, Ui.Font.TITLE);
			String description = item != null ? (item.description().isEmpty() ? dev.heldixclient.cosmetic.Cosmetics.slotName(slot) : item.description())
					: "In „" + dev.heldixclient.cosmetic.Cosmetics.slotName(slot) + "“ trägst du nichts.";
			int ly = y + 45;
			List<FormattedCharSequence> lines = Ui.wrap(description, tw, Ui.Font.BODY);
			for (int i = 0; i < Math.min(4, lines.size()); i++) {
				g.text(minecraft.font, lines.get(i), tx, ly, Ui.MUTED, false);
				ly += 11;
			}
			if (preview) {
				String lock = dev.heldixclient.cosmetic.Cosmetics.lockReason(item);
				Ui.text(g, lock != null ? lock : "Klicken zum Anlegen", tx, ly + 3, lock != null ? Ui.WARNING : Ui.FAINT, Ui.Font.SMALL);
			}

			int px = tx;
			int py = y + H - 20;
			HeldixConfig.Data config = HeldixConfig.get();
			List<String[]> pills = new ArrayList<>();
			boolean shared = Social.online() && config.socialVisible;
			if (item != null) {
				pills.add(new String[] {"eye", shared ? "Andere Heldix-Spieler sehen es" : "Nur für dich sichtbar"});
				if (item.teamOnly()) pills.add(new String[] {"lock", "Nur fürs Team"});
				if (item.unlockOnly()) pills.add(new String[] {dev.heldixclient.cosmetic.Cosmetics.unlocked(item.id()) ? "star" : "lock", "Belohnung"});
				if (item.manifest().glow() != null) pills.add(new String[] {"sparkles", "Leuchtet"});
				if (item.animated()) pills.add(new String[] {"play", "Animiert"});
			}
			for (String[] p : pills) {
				int pillW = Ui.width(p[1], Ui.Font.SMALL) + 24;
				if (px + pillW > x + w) break;
				Ui.rect(g, px, py, pillW, 16, 8, Ui.SURFACE);
				Ui.outline(g, px, py, pillW, 16, 8, Ui.LINE);
				Ui.icon(g, p[0], px + 6, py + 4, 8, Ui.MUTED);
				Ui.text(g, p[1], px + 17, py + 5, Ui.MUTED, Ui.Font.SMALL);
				px += pillW + 6;
			}
		}
	}

	/** Cosmetics eines Slots als Kacheln mit Vorschaubild; Klick legt an (über den Heldix-Dienst) */
	private final class CosmeticGrid implements Row {
		private static final int MIN_W = 64;
		private static final int TILE = 90;
		private final String slot;
		private final List<Object> entries;

		CosmeticGrid(String slot, List<Object> entries) {
			this.slot = slot;
			this.entries = entries;
		}

		private int columns(int w) {
			return Math.clamp((w + GAP) / (MIN_W + GAP), 3, 8);
		}

		int[] cell(int index, int x, int y, int w) {
			int c = columns(w);
			int cw = (w - GAP * (c - 1)) / c;
			return new int[] {x + (index % c) * (cw + GAP), y + (index / c) * (TILE + GAP), cw};
		}

		@Override
		public int height(int width) {
			int c = columns(width);
			return (entries.size() + c - 1) / c * (TILE + GAP) - GAP;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			String chosen = dev.heldixclient.cosmetic.Cosmetics.mine(slot);
			for (int i = 0; i < entries.size(); i++) {
				Object entry = entries.get(i);
				dev.heldixclient.cosmetic.CosmeticCatalog.Item item = entry instanceof dev.heldixclient.cosmetic.CosmeticCatalog.Item it ? it : null;
				String id = item == null ? null : item.id();
				int[] cell = cell(i, x, y, w);
				int cx = cell[0];
				int cy = cell[1];
				int cw = cell[2];
				boolean on = java.util.Objects.equals(chosen, id);
				String lock = dev.heldixclient.cosmetic.Cosmetics.lockReason(item);
				boolean locked = lock != null;
				boolean pending = cosmeticPending != null && cosmeticPending.equals(slot + ":" + (id == null ? "" : id));
				boolean hover = Ui.inside(mouseX, mouseY, cx, cy, cw, TILE);
				float t = animate("cosmetic:" + slot + ":" + id, on ? 1f : 0f);
				float hv = animate("cosmetic-hover:" + slot + ":" + id, hover ? 1f : 0f);
				if (hover) cosmeticHover = entry;

				Ui.rect(g, cx, cy, cw, TILE, 10, Ui.lerp(Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, hv), Ui.ACCENT_SOFT, t));
				Ui.outline(g, cx, cy, cw, TILE, 10, Ui.lerp(Ui.LINE, Ui.ACCENT_LINE, t));
				float size = 54;
				float ix = cx + (cw - size) / 2f;
				float iy = cy + 7 - hv * 1.5f;
				String name;
				if (item != null) {
					net.minecraft.resources.Identifier icon = item.icon();
					if (icon != null) {
						Ui.region(g, icon, ix, iy, size, size, 0, 0, dev.heldixclient.cosmetic.CosmeticIcons.SIZE, dev.heldixclient.cosmetic.CosmeticIcons.SIZE,
								dev.heldixclient.cosmetic.CosmeticIcons.SIZE, dev.heldixclient.cosmetic.CosmeticIcons.SIZE, locked ? 0.45f : 1f);
					}
					name = item.name();
					if (locked) {
						Ui.circle(g, cx + 10, cy + 10, 6, 0x66000000);
						Ui.icon(g, "lock", cx + 5, cy + 5, 10, Ui.WARNING);
						if (hover) Ui.requestTooltip(item.unlockOnly() && !item.teamOnly() ? lock + " – lade Freunde ein (Freunde → Freunde einladen)" : lock,
								mouseX, mouseY);
					} else if (item.teamOnly()) {
						Ui.circle(g, cx + 10, cy + 10, 6, 0x66000000);
						Ui.icon(g, "shield", cx + 5, cy + 5, 10, 0xFFFDE68A);
						if (hover) Ui.requestTooltip("Nur fürs Team – du darfst es tragen", mouseX, mouseY);
					} else if (item.unlockOnly()) {
						Ui.circle(g, cx + 10, cy + 10, 6, 0x66000000);
						Ui.icon(g, "star", cx + 5, cy + 5, 10, 0xFFFDE68A);
						if (hover) Ui.requestTooltip(dev.heldixclient.cosmetic.Cosmetics.UNLOCK_HINT + " – freigeschaltet", mouseX, mouseY);
					} else if (item.manifest().glow() != null) {
						Ui.circle(g, cx + 10, cy + 10, 6, 0x66000000);
						Ui.icon(g, "sparkles", cx + 5, cy + 5, 10, 0xFFFDE68A);
					}
				} else {
					Ui.outline(g, ix + 8, iy + 8, size - 16, size - 16, 6, Ui.LINE_STRONG);
					Ui.icon(g, "close", ix + size / 2f - 6, iy + size / 2f - 6, 12, Ui.FAINT);
					name = "Ohne";
				}
				Ui.textCentered(g, Ui.ellipsize(pending ? "Speichert …" : name, cw - 8, Ui.Font.SMALL), cx + cw / 2, cy + TILE - 18,
						on ? Ui.TEXT : locked ? Ui.FAINT : Ui.MUTED, Ui.Font.SMALL);
				if (t > 0.01f) {
					Ui.circle(g, cx + cw - 10, cy + 10, 6, Ui.withAlpha(Ui.ACCENT, t));
					Ui.icon(g, "check", cx + cw - 14, cy + 6, 8, Ui.withAlpha(0xFFFFFFFF, t));
				}
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (int i = 0; i < entries.size(); i++) {
				int[] cell = cell(i, x, y, w);
				if (!Ui.inside(mouseX, mouseY, cell[0], cell[1], cell[2], TILE)) continue;
				HeldixMenuScreen.this.click();
				Object entry = entries.get(i);
				chooseCosmetic(slot, entry instanceof dev.heldixclient.cosmetic.CosmeticCatalog.Item item ? item : null);
				return true;
			}
			return false;
		}
	}

	/** Ein Heldix-Addon mit Status. */
	private final class AddonCard implements Row {
		private final LoadedAddon addon;

		AddonCard(LoadedAddon addon) {
			this.addon = addon;
		}

		@Override
		public int height(int width) {
			return ADDON_H;
		}

		/** Schalter rechts (nicht bei Addons, die der Store gerade entfernt) */
		private boolean switchable() {
			return !addon.pendingRemoval() && addon.id() != null;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean removing = addon.pendingRemoval();
			boolean restart = !removing && addon.restartNeeded();
			boolean disabled = addon.state() == LoadedAddon.State.DISABLED;
			List<String> loaderProblems = addon.loaderProblems();
			boolean problem = addon.state() == LoadedAddon.State.FAILED || (addon.isActive() && !loaderProblems.isEmpty());
			int color = removing || restart ? Ui.WARNING : disabled ? Ui.FAINT : problem ? Ui.DANGER : Ui.SUCCESS;
			Ui.rect(g, x, y, w, ADDON_H, 10, Ui.SURFACE);
			Ui.outline(g, x, y, w, ADDON_H, 10, (color & 0xFFFFFF) | 0x44000000);
			Ui.rect(g, x + 10, y + 10, 26, 26, 8, (color & 0xFFFFFF) | 0x33000000);
			Ui.icon(g, problem && !restart ? "warning" : addon.icon(), x + 16, y + 16, 14, color);

			int right = x + w - 10;
			if (switchable()) {
				boolean on = addon.switchedOn();
				float t = animate(addon, on ? 1f : 0f);
				Ui.toggle(g, right - 20, y + 18, t);
				settingCenters.put("addon:" + addon.id(), new int[] {right - 11, y + 23});
				if (Ui.inside(mouseX, mouseY, right - 24, y + 11, 28, 24)) {
					Ui.requestTooltip(on ? (addon.minecraftAccess() ? "Ausschalten – wirkt nach dem Neustart" : "Ausschalten") : "Einschalten – wirkt nach dem Neustart", mouseX, mouseY);
				}
				right -= 28;
			}
			String status = removing ? "Wird entfernt"
					: restart ? "Wirkt nach dem Neustart"
					: disabled ? "Ausgeschaltet"
					: addon.state() == LoadedAddon.State.FAILED ? (addon.loaderAddon() != null && !addon.loaderAddon().loaded() ? "Nicht geladen" : "Fehler")
					: problem ? "Problem"
					: addon.moduleCount() == 0 ? "Aktiv" : "Aktiv · " + addon.moduleCount() + (addon.moduleCount() == 1 ? " Modul" : " Module");
			int statusW = Ui.width(status, Ui.Font.SMALL) + 14;
			int statusX = right - statusW;
			Ui.rect(g, statusX, y + 9, statusW, 14, 7, (color & 0xFFFFFF) | 0x2A000000);
			Ui.text(g, status, statusX + 7, y + 12, color, Ui.Font.SMALL);

			int textX = x + 46;
			int room = statusX - textX - 8;
			String title = addon.name();
			int versionW = Ui.width(addon.version(), Ui.Font.SMALL) + 6;
			int titleW = Math.min(Ui.width(title, Ui.Font.LABEL), Math.max(20, room - versionW));
			Ui.text(g, Ui.ellipsize(title, titleW, Ui.Font.LABEL), textX, y + 11, disabled ? Ui.MUTED : Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(addon.version(), Math.max(0, room - titleW - 6), Ui.Font.SMALL), textX + titleW + 6, y + 12, Ui.FAINT, Ui.Font.SMALL);
			// zweite Zeile: Chip „Greift in Minecraft ein“, dann Beschreibung, Fehler oder Hinweis
			int lineX = addon.minecraftAccess() ? textX + minecraftChip(g, MINECRAFT_CHIP, textX, y + 23) + 6 : textX;

			String line;
			int lineColor;
			if (removing) {
				line = "Im Addon-Store entfernt – verschwindet beim nächsten Start";
				lineColor = Ui.WARNING;
			} else if (restart) {
				line = addon.switchedOn() ? "Wird beim nächsten Start geladen"
						: "Wird beim nächsten Start ausgeschaltet – Eingriffe in Minecraft lassen sich nicht im laufenden Spiel abschalten";
				lineColor = Ui.WARNING;
			} else if (addon.state() == LoadedAddon.State.FAILED) {
				line = addon.error();
				lineColor = Ui.DANGER;
			} else if (problem) {
				line = loaderProblems.getFirst();
				lineColor = Ui.DANGER;
			} else {
				line = addon.description();
				lineColor = disabled ? Ui.FAINT : Ui.MUTED;
			}
			String shown = Ui.ellipsize(line == null ? "" : line, Math.max(0, right - lineX - 4), Ui.Font.SMALL);
			Ui.text(g, shown, lineX, y + 26, lineColor, Ui.Font.SMALL);
			if (line != null && !shown.equals(line) && Ui.inside(mouseX, mouseY, lineX, y + 24, right - lineX, 12)) Ui.requestTooltip(line, mouseX, mouseY);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (!switchable() || !Ui.inside(mouseX, mouseY, x + w - 34, y + 11, 28, 24)) return false;
			HeldixMenuScreen.this.click();
			AddonManager.setEnabled(addon, !addon.switchedOn());
			return true;
		}
	}

	private static final String MINECRAFT_CHIP = "Greift in Minecraft ein";

	/** Chip wie „Greift in Minecraft ein“; gibt die Breite zurück */
	private static int minecraftChip(GuiGraphicsExtractor g, String text, int x, int y) {
		int w = Ui.width(text, Ui.Font.SMALL) + 12;
		Ui.rect(g, x, y, w, 13, 6.5f, Ui.ACCENT_SOFT);
		Ui.text(g, text, x + 6, y + 3, Ui.ACCENT_TEXT, Ui.Font.SMALL);
		return w;
	}

	/** Bisherige Heldix-Mod aus mods/ (heldix.mod.json): läuft wie bisher, hier nur zur Info – ohne Schalter */
	private final class HeldixModCard implements Row {
		private final ModInfo mod;

		HeldixModCard(ModInfo mod) {
			this.mod = mod;
		}

		@Override
		public int height(int width) {
			return ADDON_H;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int color = Ui.SUCCESS;
			Ui.rect(g, x, y, w, ADDON_H, 10, Ui.SURFACE);
			Ui.outline(g, x, y, w, ADDON_H, 10, (color & 0xFFFFFF) | 0x44000000);
			Ui.rect(g, x + 10, y + 10, 26, 26, 8, (color & 0xFFFFFF) | 0x33000000);
			Ui.icon(g, "modules", x + 16, y + 16, 14, color);
			String status = "Aktiv · Heldix-Mod";
			int statusW = Ui.width(status, Ui.Font.SMALL) + 14;
			int statusX = x + w - statusW - 10;
			Ui.rect(g, statusX, y + 9, statusW, 14, 7, (color & 0xFFFFFF) | 0x2A000000);
			Ui.text(g, status, statusX + 7, y + 12, color, Ui.Font.SMALL);

			int textX = x + 46;
			int room = statusX - textX - 8;
			int versionW = Ui.width(mod.version(), Ui.Font.SMALL) + 6;
			int titleW = Math.min(Ui.width(mod.name(), Ui.Font.LABEL), Math.max(20, room - versionW));
			Ui.text(g, Ui.ellipsize(mod.name(), titleW, Ui.Font.LABEL), textX, y + 11, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(mod.version(), Math.max(0, room - titleW - 6), Ui.Font.SMALL), textX + titleW + 6, y + 12, Ui.FAINT, Ui.Font.SMALL);
			int lineX = textX + minecraftChip(g, MINECRAFT_CHIP, textX, y + 23) + 6;
			String line = "Heldix-Mod aus dem Ordner mods, nur zur Info" + (mod.description().isBlank() ? "" : " · " + mod.description());
			String shown = Ui.ellipsize(line, Math.max(0, x + w - 10 - lineX), Ui.Font.SMALL);
			Ui.text(g, shown, lineX, y + 26, Ui.MUTED, Ui.Font.SMALL);
			if (!shown.equals(line) && Ui.inside(mouseX, mouseY, lineX, y + 24, x + w - 10 - lineX, 12)) Ui.requestTooltip(line, mouseX, mouseY);
		}
	}

	/** Eine Zeile in den Details einer Store-Karte (null = kleiner Abstand) */
	private record StoreLine(FormattedCharSequence text, int color) {
	}

	/** Ein Addon im Addon-Store: Icon, Name, Kurzbeschreibung; rechts Installieren/Aktualisieren/Installiert; Klick klappt Details auf */
	private final class StoreCard implements Row {
		private static final int HEAD_H = 58;
		private final AddonStore.Entry entry;

		StoreCard(AddonStore.Entry entry) {
			this.entry = entry;
		}

		private boolean open() {
			return entry.id().equals(storeOpen);
		}

		private List<StoreLine> details(int w) {
			List<StoreLine> lines = new ArrayList<>();
			int width = Math.max(60, w - 50 - 14);
			for (String paragraph : entry.description().split("\n\\s*\n")) {
				boolean any = false;
				for (String raw : paragraph.split("\n")) {
					String line = raw.strip();
					if (line.isEmpty()) continue;
					for (FormattedCharSequence part : Ui.wrap(line.startsWith("- ") ? "•  " + line.substring(2) : line, width, Ui.Font.SMALL)) {
						lines.add(new StoreLine(part, Ui.MUTED));
					}
					any = true;
				}
				if (any) lines.add(new StoreLine(null, 0));
			}
			if (!entry.notes().isEmpty()) {
				for (FormattedCharSequence part : Ui.wrap("Neu in " + entry.version() + ": " + String.join(" · ", entry.notes()), width, Ui.Font.SMALL)) {
					lines.add(new StoreLine(part, Ui.TEXT));
				}
				lines.add(new StoreLine(null, 0));
			}
			String meta = "von " + String.join(", ", entry.authors()) + " · Addon-API " + entry.api() + " · " + sizeText(entry.size());
			if (entry.minecraftAccess()) meta += " · Greift in Minecraft ein";
			if (!entry.minecraft().isEmpty()) meta += " · Minecraft " + dev.heldixclient.loader.api.AddonManifest.versionList(entry.minecraft());
			meta += entry.loaders().containsAll(List.of("heldix", "fabric")) ? " · Heldix- und Fabric-Instanzen"
					: entry.loaders().contains("fabric") ? " · Nur Fabric-Instanzen" : " · Nur Heldix-Instanzen";
			for (FormattedCharSequence part : Ui.wrap(meta, width, Ui.Font.SMALL)) lines.add(new StoreLine(part, Ui.FAINT));
			return lines;
		}

		private int detailsHeight(List<StoreLine> lines) {
			int h = 0;
			for (StoreLine line : lines) h += line.text() == null ? 5 : 10;
			return h;
		}

		@Override
		public int height(int width) {
			return open() ? HEAD_H + 4 + detailsHeight(details(width)) + 10 : HEAD_H;
		}

		private String installed() {
			return AddonStore.installedVersion(entry.id());
		}

		private boolean update() {
			String installed = installed();
			return installed != null && entry.problem() == null && AddonManager.compareVersions(entry.version(), installed) > 0;
		}

		/** Beschriftung und Icon des Knopfs rechts; null-Icon = kein Knopf zum Klicken */
		private String label() {
			Float progress = AddonStore.progress(entry.id());
			if (progress != null) return "Lädt … " + Math.round(progress * 100) + " %";
			if (entry.problem() != null) return "Nicht verfügbar";
			if (installed() == null) return "Installieren";
			return update() ? "Aktualisieren" : "Installiert";
		}

		private boolean actionable() {
			return AddonStore.progress(entry.id()) == null && entry.problem() == null && (installed() == null || update());
		}

		/** {x, Breite} des Knopfs */
		private int[] button(int x, int w) {
			int bw = Ui.width(label(), Ui.Font.SMALL) + 30;
			return new int[] {x + w - 12 - bw, bw};
		}

		private boolean removable() {
			return installed() != null && AddonStore.progress(entry.id()) == null;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			boolean update = update();
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, HEAD_H);
			Ui.rect(g, x, y, w, h, 10, hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
			Ui.outline(g, x, y, w, h, 10, update ? Ui.ACCENT_LINE : hover ? Ui.LINE_STRONG : Ui.LINE);
			Ui.rect(g, x + 10, y + 14, 30, 30, 8, Ui.ACCENT_SOFT);
			Ui.icon(g, Ui.hasIcon(entry.icon()) ? entry.icon() : "addons", x + 17, y + 21, 16, Ui.ACCENT_TEXT);

			int[] button = button(x, w);
			int by = y + (HEAD_H - 20) / 2;
			Float progress = AddonStore.progress(entry.id());
			boolean overButton = Ui.inside(mouseX, mouseY, button[0], by, button[1], 20);
			String label = label();
			if (progress != null) {
				Ui.rect(g, button[0], by, button[1], 20, 10, Ui.ACCENT_SOFT);
				Ui.rect(g, button[0], by, Math.max(20, button[1] * progress), 20, 10, Ui.ACCENT_LINE);
				Ui.icon(g, "download", button[0] + 9, by + 6, 8, Ui.TEXT);
				Ui.text(g, label, button[0] + 21, by + 6, Ui.TEXT, Ui.Font.SMALL);
			} else if (entry.problem() != null) {
				Ui.rect(g, button[0], by, button[1], 20, 10, 0x14FFFFFF);
				Ui.icon(g, "ban", button[0] + 9, by + 6, 8, Ui.FAINT);
				Ui.text(g, label, button[0] + 21, by + 6, Ui.FAINT, Ui.Font.SMALL);
				if (overButton) Ui.requestTooltip(entry.problem(), mouseX, mouseY);
			} else if (actionable()) {
				Ui.rect(g, button[0], by, button[1], 20, 10, overButton ? Ui.ACCENT_HOVER : Ui.ACCENT);
				Ui.icon(g, update ? "refresh" : "download", button[0] + 9, by + 6, 8, 0xFFFFFFFF);
				Ui.text(g, label, button[0] + 21, by + 6, 0xFFFFFFFF, Ui.Font.SMALL);
			} else {
				Ui.outline(g, button[0], by, button[1], 20, 10, (Ui.SUCCESS & 0xFFFFFF) | 0x66000000);
				Ui.icon(g, "check", button[0] + 9, by + 6, 8, Ui.SUCCESS);
				Ui.text(g, label, button[0] + 21, by + 6, Ui.SUCCESS, Ui.Font.SMALL);
			}
			int right = button[0] - 8;
			boolean confirming = entry.id().equals(storeConfirmRemove) && System.currentTimeMillis() - storeConfirmAt < 4000;
			if (removable()) {
				boolean overTrash = Ui.inside(mouseX, mouseY, right - 20, by, 20, 20);
				Ui.icon(g, "trash", right - 15, by + 5, 10, confirming || overTrash ? Ui.DANGER : Ui.FAINT);
				if (overTrash && !confirming) Ui.requestTooltip(entry.name() + " entfernen", mouseX, mouseY);
				right -= 24;
			}

			int textX = x + 50;
			int textW = right - textX;
			String version = entry.version();
			int titleW = Math.min(Ui.width(entry.name(), Ui.Font.LABEL), Math.max(20, textW - Ui.width(version, Ui.Font.SMALL) - 8));
			Ui.text(g, Ui.ellipsize(entry.name(), titleW, Ui.Font.LABEL), textX, y + 10, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(version, textW - titleW - 6, Ui.Font.SMALL), textX + titleW + 6, y + 11, update ? Ui.ACCENT_TEXT : Ui.FAINT, Ui.Font.SMALL);
			Ui.text(g, Ui.ellipsize(entry.summary(), textW, Ui.Font.SMALL), textX, y + 24, Ui.MUTED, Ui.Font.SMALL);
			String failure = AddonStore.failure(entry.id());
			String change = AddonStore.changes().get(entry.id());
			String third;
			int thirdColor;
			if (confirming) {
				third = "Nochmal klicken zum Entfernen";
				thirdColor = Ui.DANGER;
			} else if (failure != null) {
				third = failure;
				thirdColor = Ui.DANGER;
			} else if (change != null) {
				third = (change.substring(0, 1).toUpperCase(Locale.ROOT) + change.substring(1)) + " – aktiv nach einem Neustart";
				thirdColor = Ui.WARNING;
			} else {
				List<String> chips = new ArrayList<>();
				if (update) chips.add("Update von " + installed());
				chips.add(entry.origin());
				if (entry.minecraftAccess()) chips.add("Greift in Minecraft ein");
				if (entry.ratingText() != null) chips.add(entry.ratingText());
				chips.add(entry.categoryLabel());
				if (entry.problem() != null) chips.add(entry.problem());
				else if (!entry.minecraft().isEmpty()) chips.add("Minecraft " + dev.heldixclient.loader.api.AddonManifest.versionList(entry.minecraft()));
				else if (!entry.platforms().isEmpty() && !entry.platforms().containsAll(List.of("windows", "mac", "linux"))) chips.add("Nur " + platformNames(entry.platforms()));
				chips.add(entry.downloads() == 1 ? "1 Download" : entry.downloads() + " Downloads");
				chips.add(open() ? "Weniger" : "Details");
				third = String.join("  ·  ", chips);
				thirdColor = update ? Ui.ACCENT_TEXT : Ui.FAINT;
			}
			Ui.text(g, Ui.ellipsize(third, textW, Ui.Font.SMALL), textX, y + 38, thirdColor, Ui.Font.SMALL);
			if (failure != null && hover && Ui.inside(mouseX, mouseY, textX, y + 36, textW, 12)) Ui.requestTooltip(failure, mouseX, mouseY);

			if (open()) {
				int ly = y + HEAD_H + 4;
				Ui.rect(g, textX, y + HEAD_H - 2, w - 50 - 12, 1, 0, Ui.LINE);
				for (StoreLine line : details(w)) {
					if (line.text() == null) {
						ly += 5;
						continue;
					}
					g.text(font, line.text(), textX, ly, line.color(), false);
					ly += 10;
				}
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (!Ui.inside(mouseX, mouseY, x, y, w, height(w))) return false;
			int[] button = button(x, w);
			int by = y + (HEAD_H - 20) / 2;
			if (Ui.inside(mouseX, mouseY, button[0], by, button[1], 20)) {
				if (actionable()) {
					HeldixMenuScreen.this.click();
					AddonStore.install(entry);
				}
				return true;
			}
			if (removable() && Ui.inside(mouseX, mouseY, button[0] - 28, by, 20, 20)) {
				HeldixMenuScreen.this.click();
				boolean confirmed = entry.id().equals(storeConfirmRemove) && System.currentTimeMillis() - storeConfirmAt < 4000;
				if (confirmed) {
					storeConfirmRemove = null;
					AddonStore.remove(entry.id());
				} else {
					storeConfirmRemove = entry.id();
					storeConfirmAt = System.currentTimeMillis();
				}
				return true;
			}
			HeldixMenuScreen.this.click();
			storeOpen = open() ? null : entry.id();
			return true;
		}
	}

	private static String platformNames(List<String> platforms) {
		List<String> names = new ArrayList<>();
		for (String p : platforms) names.add(switch (p) {
			case "windows" -> "Windows";
			case "mac" -> "macOS";
			default -> "Linux";
		});
		return String.join(" und ", names);
	}

	private static String sizeText(long bytes) {
		if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024.0)) + " KB";
		return String.format(Locale.GERMANY, "%.1f MB", bytes / 1024.0 / 1024.0);
	}

	/** Ein Freund in einer Karte: Kopf des Skins, Name, was er gerade macht; rechts Entfernen (mit Bestätigung) */
	private final class FriendRow implements Row, Groupable {
		private final Social.Friend friend;

		FriendRow(Social.Friend friend) {
			this.friend = friend;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 36;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 36);
			if (hover) Ui.rect(g, x + 3, y + 2, w - 6, 32, 7, Ui.SURFACE);
			avatar(g, friend, x + 9, y + 7);
			int[] join = joinPill(x, w);
			int textW = (join != null ? join[0] : x + w - 60) - x - 46;
			boolean confirmingRemove = friend.uuid().equals(confirmRemove) && System.currentTimeMillis() - confirmAt < 4000;
			if (hover && !confirmingRemove && mouseX < (join != null ? join[0] : x + w - 56)) {
				Ui.requestTooltip(Social.friends2() ? "Klick: Profil · Rechtsklick: Aktionen" : friend.name(), mouseX, mouseY);
			}
			if (!confirmingRemove) {
				boolean overChat = Ui.inside(mouseX, mouseY, x + w - 56, y, 26, 36);
				Ui.icon(g, "chat", x + w - 49, y + 12, 12, overChat ? Ui.ACCENT_TEXT : Ui.FAINT);
				if (overChat) Ui.requestTooltip("Nachricht an " + friend.name(), mouseX, mouseY);
				int unread = Messages.unread(friend.uuid());
				if (unread > 0) Ui.circle(g, x + w - 37, y + 12, 3, Ui.ACCENT);
				if (join != null) {
					boolean confirming = friend.uuid().equals(confirmJoin) && System.currentTimeMillis() - confirmJoinAt < 4000;
					boolean over = Ui.inside(mouseX, mouseY, join[0], y + 10, join[1], 16);
					String label = confirming ? "Welt verlassen?" : "Beitreten";
					int fill = confirming ? (over ? 0xFFFCD34D : Ui.WARNING) : over ? Ui.ACCENT_HOVER : Ui.ACCENT;
					Ui.rect(g, join[0], y + 10, join[1], 16, 8, fill);
					Ui.icon(g, "play", join[0] + 7, y + 14, 8, confirming ? 0xFF111111 : 0xFFFFFFFF);
					Ui.text(g, label, join[0] + 19, y + 14, confirming ? 0xFF111111 : 0xFFFFFFFF, Ui.Font.SMALL);
					if (over && !confirming) Ui.requestTooltip("Auf " + friend.server() + " mitspielen", mouseX, mouseY);
				}
			}
			int nameEnd = friendName(g, friend, x + 38, y + 8, textW);
			if (Party.contains(friend.uuid()) && nameEnd + 34 < x + 38 + textW) tag(g, "Party", nameEnd + 5, y + 7, Ui.ACCENT_SOFT, Ui.ACCENT_TEXT);
			int statusColor = friend.online() ? friend.dnd() ? Ui.WARNING : Ui.SUCCESS : Ui.FAINT;
			String line = friend.statusText() != null ? friend.activity() + " · „" + Messages.clean(friend.statusText()) + "“" : friend.activity();
			Ui.text(g, Ui.ellipsize(line, textW, Ui.Font.SMALL), x + 38, y + 21, statusColor, Ui.Font.SMALL);
			boolean overRemove = Ui.inside(mouseX, mouseY, x + w - 30, y, 30, 36);
			if (confirmingRemove) {
				Ui.textRight(g, "Nochmal klicken zum Entfernen", x + w - 30, y + 14, Ui.DANGER, Ui.Font.SMALL);
				Ui.icon(g, "trash", x + w - 22, y + 12, 12, Ui.DANGER);
			} else {
				// „mehr“: alle Aktionen (wie Rechtsklick)
				Ui.icon(g, "more", x + w - 22, y + 12, 12, overRemove ? Ui.TEXT : Ui.FAINT);
				if (overRemove) Ui.requestTooltip("Aktionen", mouseX, mouseY);
			}
		}

		/** Knopf "Beitreten": {x, Breite}, null = Freund spielt nicht auf einem Server, dem man folgen kann */
		private int[] joinPill(int x, int w) {
			if (!joinable(friend)) return null;
			boolean confirming = friend.uuid().equals(confirmJoin) && System.currentTimeMillis() - confirmJoinAt < 4000;
			int pw = Ui.width(confirming ? "Welt verlassen?" : "Beitreten", Ui.Font.SMALL) + 27;
			return new int[] {x + w - 62 - pw, pw};
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int[] join = joinPill(x, w);
			if (join != null && Ui.inside(mouseX, mouseY, join[0], y + 8, join[1], 20)) {
				HeldixMenuScreen.this.click();
				boolean confirmed = friend.uuid().equals(confirmJoin) && System.currentTimeMillis() - confirmJoinAt < 4000;
				if (minecraft.level != null && !confirmed) {
					confirmJoin = friend.uuid();
					confirmJoinAt = System.currentTimeMillis();
				} else {
					confirmJoin = null;
					joinFriend(friend);
				}
				return true;
			}
			if (Ui.inside(mouseX, mouseY, x + w - 56, y, 26, 36)) {
				HeldixMenuScreen.this.click();
				openChat(friend.uuid(), friend.name());
				return true;
			}
			if (mouseX < x + w - 30) {
				// Klick auf den Freund: Profilkarte (ab Dienst 1.12.0)
				if (!Social.friends2()) return false;
				HeldixMenuScreen.this.click();
				openProfile(friend.uuid());
				return true;
			}
			if (friend.uuid().equals(confirmRemove) && System.currentTimeMillis() - confirmAt < 4000) {
				confirmRemove = null;
				HeldixMenuScreen.this.click();
				report(Social.removeFriend(friend.uuid()), friend.name() + " ist nicht mehr dein Freund");
			} else {
				HeldixMenuScreen.this.click();
				openFriendMenu(friend, (int) mouseX, (int) mouseY);
			}
			return true;
		}

		@Override
		public boolean secondaryClick(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			openFriendMenu(friend, (int) mouseX, (int) mouseY);
			return true;
		}
	}

	/**
	 * Name eines Freundes in einer Zeile: Spitzname bzw. Name, gelber Stern bei Favoriten, Abzeichen der Rolle (ohne das
	 * normale Heldix-Symbol). Rückgabe: rechte Kante.
	 */
	private int friendName(GuiGraphicsExtractor g, Social.Friend friend, int x, int y, int maxW) {
		boolean star = friend.favorite();
		Badge.Role role = friend.badge() != null && friend.badge() != Badge.Role.PLAYER ? friend.badge() : null;
		int extra = (star ? 12 : 0) + (role != null ? 11 : 0);
		String name = Ui.ellipsize(friend.shownName(), Math.max(20, maxW - extra), Ui.Font.LABEL);
		Ui.text(g, name, x, y, Ui.TEXT, Ui.Font.LABEL);
		int cx = x + Ui.width(name, Ui.Font.LABEL) + 4;
		if (role != null) {
			g.text(font, Badge.symbol(role), cx, y, 0xFFFFFFFF, false);
			if (Ui.inside(lastMouseX, lastMouseY, cx, y - 1, 9, 10)) Ui.requestTooltip(role.label() + " · " + role.group().label(), (int) lastMouseX, (int) lastMouseY);
			cx += 11;
		}
		if (star) {
			Ui.icon(g, "star", cx, y, 8, 0xFFFACC15);
			cx += 12;
		}
		return cx;
	}

	/** Kleine Marke („Party“, „Leiter“) */
	private void tag(GuiGraphicsExtractor g, String label, int x, int y, int fill, int color) {
		int tw = Ui.width(label, Ui.Font.SMALL) + 8;
		Ui.rect(g, x, y, tw, 11, 5.5f, fill);
		Ui.text(g, label, x + 4, y + 2, color, Ui.Font.SMALL);
	}

	/** Rechtsklick-Menü eines Freundes: Profil, Nachricht, Party, Beitreten, Favorit, Spitzname, Entfernen, Blockieren */
	private void openFriendMenu(Social.Friend friend, int x, int y) {
		List<dev.heldixclient.ui.ContextMenu.Item> items = new ArrayList<>();
		items.add(new dev.heldixclient.ui.ContextMenu.Header(friend.shownName(), "user"));
		boolean v2 = Social.friends2();
		if (v2) items.add(new dev.heldixclient.ui.ContextMenu.Action(MENU_PROFILE, "user", () -> openProfile(friend.uuid())));
		items.add(new dev.heldixclient.ui.ContextMenu.Action("Nachricht schreiben", "chat", () -> openChat(friend.uuid(), friend.name())));
		if (v2 && Party.available()) {
			boolean member = Party.contains(friend.uuid());
			items.add(new dev.heldixclient.ui.ContextMenu.Action(member ? "Schon in der Party" : MENU_PARTY_INVITE, "headphones", null,
					!member && Party.canInvite(friend.uuid()), false, () -> report(Party.invite(friend.uuid()), friend.name() + " ist in die Party eingeladen")));
		}
		// im Menü ist der Klick selbst die Bestätigung – die Beschriftung sagt, dass die Welt verlassen wird
		if (joinable(friend)) items.add(new dev.heldixclient.ui.ContextMenu.Action(minecraft.level != null ? "Welt verlassen und beitreten" : "Beitreten",
				"play", friend.server(), true, false, () -> joinFriend(friend)));
		if (v2) {
			items.add(new dev.heldixclient.ui.ContextMenu.Separator());
			items.add(new dev.heldixclient.ui.ContextMenu.Action(friend.favorite() ? "Favorit entfernen" : MENU_FAVORITE, "star",
					() -> Social.setFavorite(friend.uuid(), !friend.favorite()).exceptionally(e -> {
						minecraft.execute(() -> pageMessage(errorText(e), false));
						return null;
					})));
			items.add(new dev.heldixclient.ui.ContextMenu.Action("Spitzname und Notiz …", "edit", () -> openProfile(friend.uuid())));
		}
		items.add(new dev.heldixclient.ui.ContextMenu.Separator());
		items.add(new dev.heldixclient.ui.ContextMenu.Action("Entfernen …", "trash", null, true, true, () -> {
			confirmRemove = friend.uuid();
			confirmAt = System.currentTimeMillis();
		}));
		if (v2) items.add(new dev.heldixclient.ui.ContextMenu.Action("Blockieren …", "ban", null, true, true, () -> {
			openProfile(friend.uuid());
			profileConfirm = "block";
			profileConfirmAt = System.currentTimeMillis();
		}));
		menu.open(items, x, y, width, height);
	}

	/** Einträge des Rechtsklick-Menüs (auch für den Autotest) */
	public static final String MENU_PROFILE = "Profil anzeigen";
	public static final String MENU_PARTY_INVITE = "In Party einladen";
	public static final String MENU_FAVORITE = "Als Favorit markieren";

	// ======================================================================================
	// Freunde 2.0: Party, Vorschläge, Profilkarte
	// ======================================================================================

	/** Einladung in eine Party: von wem, wie viele dabei; Annehmen / Ablehnen */
	private final class PartyInviteRow implements Row, Groupable {
		private final Party.Invite invite;

		PartyInviteRow(Party.Invite invite) {
			this.invite = invite;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 36;
		}

		private int[] buttons(int x, int w) {
			int accept = Ui.width("Annehmen", Ui.Font.SMALL) + 16;
			int decline = Ui.width("Ablehnen", Ui.Font.SMALL) + 16;
			int declineX = x + w - 10 - decline;
			return new int[] {declineX - 6 - accept, accept, declineX, decline};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (Ui.inside(mouseX, mouseY, x, y, w, 36)) Ui.rect(g, x + 3, y + 2, w - 6, 32, 7, Ui.SURFACE);
			if (invite.fromUuid() != null) FriendWidget.face(g, invite.fromUuid(), invite.fromName(), x + 11, y + 9, 18, 1f);
			int[] b = buttons(x, w);
			int textW = b[0] - x - 46;
			Ui.text(g, Ui.ellipsize(invite.fromName() + " lädt dich in die Party ein", textW, Ui.Font.LABEL), x + 38, y + 8, Ui.TEXT, Ui.Font.LABEL);
			String detail = (invite.members() == 1 ? "1 Mitglied" : invite.members() + " Mitglieder") + " · Leiter: " + invite.leaderName()
					+ (invite.expires() > 0 ? " · noch " + Math.max(1, (invite.expires() - System.currentTimeMillis()) / 60_000) + " Min." : "");
			Ui.text(g, Ui.ellipsize(detail, textW, Ui.Font.SMALL), x + 38, y + 21, Ui.MUTED, Ui.Font.SMALL);
			pill(g, "Annehmen", b[0], y + 10, b[1], true, Ui.inside(mouseX, mouseY, b[0], y + 10, b[1], 16));
			pill(g, "Ablehnen", b[2], y + 10, b[3], false, Ui.inside(mouseX, mouseY, b[2], y + 10, b[3], 16));
			settingCenters.put("party-accept:" + invite.party(), new int[] {b[0] + b[1] / 2, y + 18});
			settingCenters.put("party-decline:" + invite.party(), new int[] {b[2] + b[3] / 2, y + 18});
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int[] b = buttons(x, w);
			if (Ui.inside(mouseX, mouseY, b[0], y + 10, b[1], 16)) {
				HeldixMenuScreen.this.click();
				report(Party.accept(invite.party()), "Du bist jetzt in der Party von " + invite.leaderName() + ".");
				return true;
			}
			if (Ui.inside(mouseX, mouseY, b[2], y + 10, b[3], 16)) {
				HeldixMenuScreen.this.click();
				report(Party.decline(invite.party()), "Einladung abgelehnt");
				return true;
			}
			return false;
		}
	}

	/** Seite Freunde: die eigene Party in einer Zeile (Köpfe, Größe, Leiter); Klick öffnet die Seite Party */
	private final class PartySummaryRow implements Row, Groupable {
		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 34;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Party.State party = Party.party();
			if (party == null) return;
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 34);
			if (hover) Ui.rect(g, x + 3, y + 2, w - 6, 30, 7, Ui.SURFACE);
			Ui.rect(g, x + 10, y + 8, 18, 18, 5, Ui.ACCENT_SOFT);
			Ui.icon(g, "headphones", x + 14, y + 12, 10, Ui.ACCENT_TEXT);
			int fx = x + w - 30;
			int shown = Math.min(5, party.members().size());
			for (int i = 0; i < shown; i++) {
				Party.Member member = party.members().get(i);
				FriendWidget.face(g, member.uuid(), member.name(), fx - (shown - 1 - i) * 13, y + 11, 12, member.online() ? 1f : 0.5f);
			}
			Party.Member leader = party.leaderMember();
			int textW = w - 40 - shown * 13 - 30;
			Ui.text(g, Ui.ellipsize("Party · " + party.members().size() + " von " + party.max(), textW, Ui.Font.LABEL), x + 36, y + 7, Ui.TEXT, Ui.Font.LABEL);
			Party.Location target = Party.leaderTarget();
			String detail = target != null && leader != null ? leader.name() + " ist " + (target.world() ? "in der " + target.shown() : "auf " + target.title()) + " · Beitreten auf der Seite Party"
					: "Leiter: " + (leader != null ? leader.name() : "?") + (Party.unreadChat() > 0 ? " · " + Party.unreadChat() + " neue Nachrichten" : "");
			Ui.text(g, Ui.ellipsize(detail, textW, Ui.Font.SMALL), x + 36, y + 20, target != null ? Ui.ACCENT_TEXT : Ui.MUTED, Ui.Font.SMALL);
			Ui.icon(g, "chevron-right", x + w - 16, y + 13, 8, hover ? Ui.TEXT : Ui.FAINT);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			go(Shell.Page.PARTY);
			return true;
		}
	}

	/** Mitglied der Party: Kopf, Name, Leiter, Ort; Leiter: Leitung übergeben, Entfernen; du selbst: Verlassen */
	private final class PartyMemberRow implements Row, Groupable {
		private final Party.Member member;
		private final boolean lead;

		PartyMemberRow(Party.Member member, boolean lead) {
			this.member = member;
			this.lead = lead;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 36;
		}

		private boolean self() {
			return member.uuid().equals(minecraft.getUser().getProfileId());
		}

		/** Knöpfe rechts: {Beschriftung, x, Breite} */
		private List<Object[]> buttons(int x, int w) {
			List<String> labels = new ArrayList<>();
			if (self()) labels.add("Verlassen");
			else if (lead) {
				labels.add("Leitung geben");
				labels.add("Entfernen");
			}
			List<Object[]> result = new ArrayList<>();
			int right = x + w - 10;
			for (int i = labels.size() - 1; i >= 0; i--) {
				int bw = Ui.width(labels.get(i), Ui.Font.SMALL) + 16;
				right -= bw;
				result.addFirst(new Object[] {labels.get(i), right, bw});
				right -= 6;
			}
			return result;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (Ui.inside(mouseX, mouseY, x, y, w, 36)) Ui.rect(g, x + 3, y + 2, w - 6, 32, 7, Ui.SURFACE);
			FriendWidget.face(g, member.uuid(), member.name(), x + 10, y + 8, 20, member.online() ? 1f : 0.45f);
			if (member.online() && !member.away()) {
				Ui.circle(g, x + 30, y + 28, 4, 0xFF161C28);
				Ui.circle(g, x + 30, y + 28, 3, Ui.SUCCESS);
			}
			List<Object[]> buttons = buttons(x, w);
			int left = buttons.isEmpty() ? x + w - 10 : (int) buttons.getFirst()[1];
			int textW = left - x - 46;
			Social.Friend friend = friendOf(member.uuid());
			String name = self() ? member.name() + " (du)" : friend != null ? friend.shownName() : member.name();
			name = Ui.ellipsize(name, textW - (member.leader() ? 40 : 0), Ui.Font.LABEL);
			Ui.text(g, name, x + 40, y + 8, Ui.TEXT, Ui.Font.LABEL);
			if (member.leader()) tag(g, "Leiter", x + 44 + Ui.width(name, Ui.Font.LABEL), y + 7, 0x33FACC15, 0xFFFACC15);
			Ui.text(g, Ui.ellipsize(member.where(), textW, Ui.Font.SMALL), x + 40, y + 21, member.away() ? Ui.WARNING : Ui.MUTED, Ui.Font.SMALL);
			for (Object[] b : buttons) {
				int bx = (int) b[1];
				int bw = (int) b[2];
				pill(g, (String) b[0], bx, y + 10, bw, false, Ui.inside(mouseX, mouseY, bx, y + 10, bw, 16));
				settingCenters.put("party-member:" + b[0] + ":" + member.name(), new int[] {bx + bw / 2, y + 18});
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (Object[] b : buttons(x, w)) {
				if (!Ui.inside(mouseX, mouseY, (int) b[1], y + 10, (int) b[2], 16)) continue;
				HeldixMenuScreen.this.click();
				switch ((String) b[0]) {
					case "Verlassen" -> report(Party.leave(), "Du hast die Party verlassen.");
					case "Leitung geben" -> report(Party.promote(member.uuid()), member.name() + " leitet jetzt die Party.");
					case "Entfernen" -> report(Party.kick(member.uuid()), member.name() + " ist nicht mehr in der Party.");
					default -> {
					}
				}
				return true;
			}
			return false;
		}
	}

	/** Offene Einladung in die eigene Party; der Leiter kann sie zurückziehen */
	private final class PartyPendingRow implements Row, Groupable {
		private final Party.Pending pending;
		private final boolean lead;

		PartyPendingRow(Party.Pending pending, boolean lead) {
			this.pending = pending;
			this.lead = lead;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 32;
		}

		private int pillWidth() {
			return Ui.width("Zurückziehen", Ui.Font.SMALL) + 16;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			FriendWidget.face(g, pending.uuid(), pending.name(), x + 12, y + 8, 16, 0.55f);
			int pw = lead ? pillWidth() : 0;
			int textW = w - 48 - pw - 10;
			Ui.text(g, Ui.ellipsize(pending.name(), textW, Ui.Font.LABEL), x + 40, y + 6, Ui.MUTED, Ui.Font.LABEL);
			String left = pending.expires() > 0 ? " · noch " + Math.max(1, (pending.expires() - System.currentTimeMillis()) / 60_000) + " Min." : "";
			Ui.text(g, Ui.ellipsize("eingeladen, wartet auf Antwort" + left, textW, Ui.Font.SMALL), x + 40, y + 18, Ui.FAINT, Ui.Font.SMALL);
			if (lead) {
				int px = x + w - 10 - pw;
				pill(g, "Zurückziehen", px, y + 8, pw, false, Ui.inside(mouseX, mouseY, px, y + 8, pw, 16));
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (!lead) return false;
			int pw = pillWidth();
			if (!Ui.inside(mouseX, mouseY, x + w - 10 - pw, y + 8, pw, 16)) return false;
			HeldixMenuScreen.this.click();
			report(Party.revoke(pending.uuid()), "Einladung an " + pending.name() + " zurückgezogen");
			return true;
		}
	}

	/** Freund, den man in die Party einladen kann (Seite Party) */
	private final class PartyInviteFriendRow implements Row, Groupable {
		private final Social.Friend friend;

		PartyInviteFriendRow(Social.Friend friend) {
			this.friend = friend;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 34;
		}

		private int pillWidth() {
			return Ui.width("Einladen", Ui.Font.SMALL) + 28;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (Ui.inside(mouseX, mouseY, x, y, w, 34)) Ui.rect(g, x + 3, y + 2, w - 6, 30, 7, Ui.SURFACE);
			avatar(g, friend, x + 10, y + 6);
			int pw = pillWidth();
			int textW = w - 40 - pw - 16;
			friendName(g, friend, x + 38, y + 8, textW);
			Ui.text(g, Ui.ellipsize(friend.activity(), textW, Ui.Font.SMALL), x + 38, y + 20, friend.online() ? Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);
			int px = x + w - 10 - pw;
			boolean can = Party.canInvite(friend.uuid());
			boolean over = can && Ui.inside(mouseX, mouseY, px, y + 9, pw, 16);
			Ui.rect(g, px, y + 9, pw, 16, 8, !can ? Ui.SURFACE : over ? Ui.ACCENT_HOVER : Ui.ACCENT);
			Ui.icon(g, "headphones", px + 7, y + 12.5f, 9, can ? 0xFFFFFFFF : Ui.FAINT);
			Ui.text(g, "Einladen", px + 20, y + 13, can ? 0xFFFFFFFF : Ui.FAINT, Ui.Font.SMALL);
			settingCenters.put("party-invite:" + friend.name(), new int[] {px + pw / 2, y + 17});
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int pw = pillWidth();
			if (!Party.canInvite(friend.uuid()) || !Ui.inside(mouseX, mouseY, x + w - 10 - pw, y + 9, pw, 16)) return false;
			HeldixMenuScreen.this.click();
			report(Party.invite(friend.uuid()), friend.name() + " ist in die Party eingeladen");
			return true;
		}
	}

	/** Nachricht im Party-Chat: Kopf, Name, Uhrzeit, Text (umbrochen) */
	private final class PartyChatRow implements Row, Groupable {
		private final Party.ChatMessage message;

		PartyChatRow(Party.ChatMessage message) {
			this.message = message;
		}

		@Override
		public void grouped() {
		}

		private List<FormattedCharSequence> lines(int w) {
			return Ui.wrap(message.text(), w - 52, Ui.Font.BODY);
		}

		@Override
		public int height(int width) {
			return 20 + lines(width).size() * 11;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (message.from() != null) FriendWidget.face(g, message.from(), message.name(), x + 12, y + 7, 14, 1f);
			Ui.text(g, message.mine() ? message.name() + " (du)" : message.name(), x + 34, y + 6, message.mine() ? Ui.ACCENT_TEXT : Ui.TEXT, Ui.Font.LABEL);
			Ui.textRight(g, clock(message.at()), x + w - 12, y + 7, Ui.FAINT, Ui.Font.SMALL);
			int ly = y + 17;
			for (FormattedCharSequence line : lines(w)) {
				g.text(font, line, x + 34, ly, 0xFFD5DCE8, false);
				ly += 11;
			}
		}
	}

	/** Vorschlag: Kopf, Name, warum (gemeinsame Freunde bzw. in der Nähe), „Anfrage senden“; aus der Nähe auch Ausblenden */
	private final class SuggestionRow implements Row, Groupable {
		private final UUID uuid;
		private final String name;
		private final String why;
		private final boolean nearby;

		SuggestionRow(UUID uuid, String name, String why, boolean nearby) {
			this.uuid = uuid;
			this.name = name;
			this.why = why;
			this.nearby = nearby;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 34;
		}

		private int pillWidth() {
			return Ui.width("Anfrage senden", Ui.Font.SMALL) + 16;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (Ui.inside(mouseX, mouseY, x, y, w, 34)) Ui.rect(g, x + 3, y + 2, w - 6, 30, 7, Ui.SURFACE);
			FriendWidget.face(g, uuid, name, x + 11, y + 8, 18, 1f);
			int pw = pillWidth();
			int px = x + w - 10 - pw - (nearby ? 24 : 0);
			int textW = px - x - 46;
			Ui.text(g, Ui.ellipsize(name, textW, Ui.Font.LABEL), x + 38, y + 7, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(why, textW, Ui.Font.SMALL), x + 38, y + 20, Ui.MUTED, Ui.Font.SMALL);
			pill(g, "Anfrage senden", px, y + 9, pw, true, Ui.inside(mouseX, mouseY, px, y + 9, pw, 16));
			settingCenters.put("suggestion:" + name, new int[] {px + pw / 2, y + 17});
			if (nearby) {
				boolean over = Ui.inside(mouseX, mouseY, x + w - 30, y, 26, 34);
				Ui.icon(g, "close", x + w - 24, y + 11, 11, over ? Ui.TEXT : Ui.FAINT);
				if (over) Ui.requestTooltip("Nicht mehr vorschlagen", mouseX, mouseY);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int pw = pillWidth();
			int px = x + w - 10 - pw - (nearby ? 24 : 0);
			if (Ui.inside(mouseX, mouseY, px, y + 9, pw, 16)) {
				HeldixMenuScreen.this.click();
				report(nearby ? Social.sendRequest(name) : Suggestions.request(uuid), "Anfrage an " + name + " gesendet");
				return true;
			}
			if (nearby && Ui.inside(mouseX, mouseY, x + w - 30, y, 26, 34)) {
				HeldixMenuScreen.this.click();
				Suggestions.dismiss(uuid);
				return true;
			}
			return false;
		}
	}

	/** Kopf der Profilkarte: großer Kopf, Name, Abzeichen, Status; darunter die wichtigsten Aktionen */
	private final class ProfileHero implements Row {
		private final Social.Friend friend;

		ProfileHero(Social.Friend friend) {
			this.friend = friend;
		}

		@Override
		public int height(int width) {
			return 86;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		/** Knöpfe: {Beschriftung, Icon, x, Breite} */
		private List<Object[]> actions(int x, int y) {
			List<String[]> list = new ArrayList<>();
			list.add(new String[] {"Nachricht", "chat"});
			if (Party.available()) list.add(new String[] {Party.contains(friend.uuid()) ? "In der Party" : "In Party einladen", "headphones"});
			if (joinable(friend)) list.add(new String[] {"Beitreten", "play"});
			list.add(new String[] {friend.favorite() ? "Favorit" : "Als Favorit", "star"});
			List<Object[]> result = new ArrayList<>();
			int bx = x + 12;
			for (String[] entry : list) {
				int bw = Ui.width(entry[0], Ui.Font.SMALL) + 30;
				result.add(new Object[] {entry[0], entry[1], bx, bw});
				bx += bw + 6;
			}
			return result;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Ui.rect(g, x, y, w, 86, 12, Ui.SURFACE);
			Ui.outline(g, x, y, w, 86, 12, Ui.LINE);
			FriendWidget.face(g, friend.uuid(), friend.name(), x + 12, y + 10, 36, friend.online() ? 1f : 0.6f);
			if (friend.online()) {
				Ui.circle(g, x + 48, y + 46, 5, 0xFF161C28);
				Ui.circle(g, x + 48, y + 46, 4, friend.dnd() ? Ui.WARNING : Ui.SUCCESS);
			}
			int tx = x + 58;
			int textW = w - 70;
			Ui.text(g, Ui.ellipsize(friend.shownName(), textW - 30, Ui.Font.TITLE), tx, y + 10, Ui.TEXT, Ui.Font.TITLE);
			int nx = tx + Ui.width(Ui.ellipsize(friend.shownName(), textW - 30, Ui.Font.TITLE), Ui.Font.TITLE) + 5;
			Badge.Role role = friend.badge() != null ? friend.badge() : Badge.Role.PLAYER;
			g.text(font, Badge.symbol(role), nx, y + 12, 0xFFFFFFFF, false);
			if (Ui.inside(mouseX, mouseY, nx, y + 10, 10, 11)) Ui.requestTooltip(role.label() + " · " + role.group().label(), mouseX, mouseY);
			String second = (friend.nickname() != null ? friend.name() + " · " : "") + friend.activity();
			Ui.text(g, Ui.ellipsize(second, textW, Ui.Font.SMALL), tx, y + 25, friend.online() ? friend.dnd() ? Ui.WARNING : Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);
			if (friend.statusText() != null) {
				Ui.text(g, Ui.ellipsize("„" + Messages.clean(friend.statusText()) + "“", textW, Ui.Font.BODY), tx, y + 37, Ui.MUTED, Ui.Font.BODY);
			}
			for (Object[] action : actions(x, y)) {
				int bx = (int) action[2];
				int bw = (int) action[3];
				int by = y + 60;
				boolean disabled = "In der Party".equals(action[0]) || ("In Party einladen".equals(action[0]) && !Party.canInvite(friend.uuid()));
				boolean over = !disabled && Ui.inside(mouseX, mouseY, bx, by, bw, 18);
				boolean primary = "Nachricht".equals(action[0]);
				Ui.rect(g, bx, by, bw, 18, 9, disabled ? 0x0FFFFFFF : primary ? (over ? Ui.ACCENT_HOVER : Ui.ACCENT) : over ? Ui.SURFACE_STRONG : Ui.SURFACE_HOVER);
				int color = disabled ? Ui.FAINT : primary ? 0xFFFFFFFF : Ui.TEXT;
				Ui.icon(g, (String) action[1], bx + 8, by + 4.5f, 9, "star".equals(action[1]) && friend.favorite() ? 0xFFFACC15 : color);
				Ui.text(g, (String) action[0], bx + 21, by + 5, color, Ui.Font.SMALL);
				settingCenters.put("profile:" + action[0], new int[] {bx + bw / 2, by + 9});
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			for (Object[] action : actions(x, y)) {
				if (!Ui.inside(mouseX, mouseY, (int) action[2], y + 60, (int) action[3], 18)) continue;
				String label = (String) action[0];
				HeldixMenuScreen.this.click();
				switch (label) {
					case "Nachricht" -> {
						saveProfileDrafts();
						minecraft.gui.setScreen(new HeldixMenuScreen(parent, friend.uuid(), friend.name()));
					}
					case "In Party einladen" -> {
						if (Party.canInvite(friend.uuid())) report(Party.invite(friend.uuid()), friend.name() + " ist in die Party eingeladen");
					}
					case "Beitreten" -> {
						if (minecraft.level == null || (friend.uuid().equals(confirmJoin) && System.currentTimeMillis() - confirmJoinAt < 4000)) joinFriend(friend);
						else {
							confirmJoin = friend.uuid();
							confirmJoinAt = System.currentTimeMillis();
							pageMessage("Nochmal „Beitreten“ klicken: Du verlässt deine Welt und gehst auf " + friend.server() + ".", true);
						}
					}
					case "Favorit", "Als Favorit" -> Social.setFavorite(friend.uuid(), !friend.favorite()).exceptionally(e -> {
						minecraft.execute(() -> pageMessage(errorText(e), false));
						return null;
					});
					default -> {
					}
				}
				return true;
			}
			return false;
		}
	}

	/** Gemeinsamer Freund (Profilkarte): Klick öffnet dessen Profil */
	private final class MutualRow implements Row, Groupable {
		private final Social.Mutual mutual;

		MutualRow(Social.Mutual mutual) {
			this.mutual = mutual;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 28;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 28);
			if (hover) Ui.rect(g, x + 3, y + 2, w - 6, 24, 7, Ui.SURFACE);
			FriendWidget.face(g, mutual.uuid(), mutual.name(), x + 12, y + 7, 14, 1f);
			Social.Friend friend = friendOf(mutual.uuid());
			Ui.text(g, Ui.ellipsize(friend != null ? friend.shownName() : mutual.name(), w - 60, Ui.Font.LABEL), x + 34, y + 10, Ui.TEXT, Ui.Font.LABEL);
			if (friend != null) Ui.icon(g, "chevron-right", x + w - 16, y + 10, 8, hover ? Ui.TEXT : Ui.FAINT);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (friendOf(mutual.uuid()) == null) return false;
			HeldixMenuScreen.this.click();
			openProfile(mutual.uuid());
			return true;
		}
	}

	/** „<Name> schreibt …“ unter dem Verlauf (ab Dienst 1.12.0) */
	private final class TypingRow implements Row {
		@Override
		public int height(int width) {
			return 14;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Social.Friend friend = friendOf(openChat);
			int dots = (int) (System.currentTimeMillis() / 350 % 3);
			for (int i = 0; i < 3; i++) Ui.circle(g, x + HEAD_X + 6 + i * 5, y + 7, 1.6f, i == dots ? Ui.ACCENT_TEXT : Ui.FAINT);
			Ui.text(g, (friend != null ? friend.shownName() : openChatName) + " schreibt …", x + HEAD_X + 24, y + 3, Ui.FAINT, Ui.Font.SMALL);
		}
	}

	private static final int HEAD_X = 18;

	/** Eingehende (Annehmen/Ablehnen) oder gesendete Anfrage (Zurückziehen) */
	private final class RequestRow implements Row, Groupable {
		private final Social.Request request;
		private final boolean incoming;

		RequestRow(Social.Request request, boolean incoming) {
			this.request = request;
			this.incoming = incoming;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 36;
		}

		private int[] buttons(int x, int w) {
			int accept = Ui.width("Annehmen", Ui.Font.SMALL) + 16;
			int decline = Ui.width(incoming ? "Ablehnen" : "Zurückziehen", Ui.Font.SMALL) + 16;
			// eingehend: rechts daneben das Symbol zum Blockieren
			int declineX = x + w - 8 - decline - (incoming ? 26 : 0);
			int acceptX = declineX - 6 - accept;
			return new int[] {acceptX, accept, declineX, decline};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (Ui.inside(mouseX, mouseY, x, y, w, 36)) Ui.rect(g, x + 3, y + 2, w - 6, 32, 7, Ui.SURFACE);
			FriendWidget.face(g, request.uuid(), request.name(), x + 11, y + 9, 18, 1f);
			int[] b = buttons(x, w);
			int textW = (incoming ? b[0] : b[2]) - x - 46;
			Ui.text(g, Ui.ellipsize(request.name(), textW, Ui.Font.LABEL), x + 38, y + 8, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(incoming ? "möchte mit dir befreundet sein" : "Anfrage gesendet, wartet auf Antwort", textW, Ui.Font.SMALL),
					x + 38, y + 21, Ui.MUTED, Ui.Font.SMALL);
			if (incoming) pill(g, "Annehmen", b[0], y + 10, b[1], true, Ui.inside(mouseX, mouseY, b[0], y + 10, b[1], 16));
			pill(g, incoming ? "Ablehnen" : "Zurückziehen", b[2], y + 10, b[3], false, Ui.inside(mouseX, mouseY, b[2], y + 10, b[3], 16));
			if (incoming) {
				boolean over = Ui.inside(mouseX, mouseY, x + w - 30, y, 26, 36);
				Ui.icon(g, "ban", x + w - 24, y + 12, 12, over ? Ui.DANGER : Ui.FAINT);
				if (over) Ui.requestTooltip(request.name() + " blockieren (lehnt ab, keine weiteren Anfragen)", mouseX, mouseY);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int[] b = buttons(x, w);
			if (incoming && Ui.inside(mouseX, mouseY, b[0], y + 10, b[1], 16)) {
				HeldixMenuScreen.this.click();
				report(Social.accept(request.uuid()), request.name() + " ist jetzt dein Freund");
				return true;
			}
			if (Ui.inside(mouseX, mouseY, b[2], y + 10, b[3], 16)) {
				HeldixMenuScreen.this.click();
				report(Social.cancelRequest(request.uuid()), incoming ? "Anfrage abgelehnt" : "Anfrage zurückgezogen");
				return true;
			}
			if (incoming && Ui.inside(mouseX, mouseY, x + w - 30, y, 26, 36)) {
				HeldixMenuScreen.this.click();
				report(Messages.block(request.uuid()), request.name() + " ist blockiert");
				return true;
			}
			return false;
		}
	}

	/** Konto, bei dem „Welt verlassen und wechseln“ gerade bestätigt werden muss (zweiter Klick) */
	private String confirmLeave;
	private long confirmLeaveAt;

	/**
	 * Ein Konto des Launchers: Kopf, Name, Marken „Im Spiel“ und „Aktiv im Launcher“, Art des Kontos; rechts „Wechseln“
	 * bzw. in einer Welt „Welt verlassen und wechseln“ (zweiter Klick bestätigt).
	 */
	private final class AccountRow implements Row, Groupable {
		private final LauncherAccount account;

		AccountRow(LauncherAccount account) {
			this.account = account;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 40;
		}

		private boolean current() {
			return AccountSwitcher.isCurrent(account);
		}

		private boolean confirming() {
			return account.id().equals(confirmLeave) && System.currentTimeMillis() - confirmLeaveAt < 4000;
		}

		/** Beschriftung des Knopfs, null = keiner (das Konto im Spiel) */
		private String buttonLabel() {
			if (current()) return null;
			if (AccountSwitcher.canSwitchHere()) return "Wechseln";
			return confirming() ? "Wirklich verlassen?" : "Welt verlassen und wechseln";
		}

		/** {x, Breite} des Knopfs */
		private int[] button(int x, int w) {
			String label = buttonLabel();
			if (label == null) return null;
			int bw = Ui.width(label, Ui.Font.SMALL) + 16;
			return new int[] {x + w - 10 - bw, bw};
		}

		/** Kurzform für den Autotest: Name, Marken und Knopf */
		String describe() {
			String label = buttonLabel();
			return account.name() + (current() ? ":im-spiel" : "") + (account.active() ? ":aktiv" : "")
					+ (label == null ? "" : label.equals("Wechseln") ? ":wechseln" : confirming() ? ":welt-verlassen-bestaetigen" : ":welt-verlassen");
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean current = current();
			if (current) Ui.rect(g, x + 3, y + 2, w - 6, 36, 7, (Ui.ACCENT & 0xFFFFFF) | 0x12000000);
			else if (Ui.inside(mouseX, mouseY, x, y, w, 40)) Ui.rect(g, x + 3, y + 2, w - 6, 36, 7, Ui.SURFACE);
			FriendWidget.face(g, account.uuid(), account.name(), x + 11, y + 11, 18, 1f);
			int[] b = button(x, w);
			int right = b != null ? b[0] - 8 : x + w - 10;
			Ui.text(g, Ui.ellipsize(account.name(), right - x - 38, Ui.Font.LABEL), x + 38, y + 9, Ui.TEXT, Ui.Font.LABEL);
			// Marken und Art des Kontos
			int mx = x + 38;
			int my = y + 22;
			if (current) mx = marker(g, "Im Spiel", mx, my, Ui.ACCENT, 0xFFFFFFFF);
			if (account.active()) mx = marker(g, "Aktiv im Launcher", mx, my, Ui.SURFACE_STRONG, Ui.TEXT);
			String kind = account.offline() ? "Offline-Konto (Entwicklung)" : "Microsoft-Konto";
			if (mx + 20 < right) Ui.text(g, Ui.ellipsize(kind, right - mx, Ui.Font.SMALL), mx, my + 2, Ui.FAINT, Ui.Font.SMALL);
			if (b == null) return;
			boolean busy = AccountSwitcher.phase() != AccountSwitcher.Phase.IDLE;
			boolean over = !busy && Ui.inside(mouseX, mouseY, b[0], y + 12, b[1], 16);
			boolean leave = !AccountSwitcher.canSwitchHere();
			boolean confirm = confirming();
			int fill = busy ? Ui.SURFACE_HOVER : confirm ? (over ? 0xFFFCD34D : Ui.WARNING) : leave ? (over ? Ui.SURFACE_STRONG : Ui.SURFACE_HOVER)
					: over ? Ui.ACCENT_HOVER : Ui.ACCENT;
			int text = busy ? Ui.FAINT : confirm ? 0xFF111111 : leave ? Ui.TEXT : 0xFFFFFFFF;
			String label = buttonLabel();
			Ui.rect(g, b[0], y + 12, b[1], 16, 8, fill);
			Ui.text(g, label, b[0] + (b[1] - Ui.width(label, Ui.Font.SMALL)) / 2, y + 16, text, Ui.Font.SMALL);
			settingCenters.put("account:" + account.name(), new int[] {b[0] + b[1] / 2, y + 20});
			if (over && !leave && AccountSwitcher.needsConfirmation(account)) {
				Ui.requestTooltip("Beim ersten Wechsel zu " + account.name() + " fragt der Launcher nach", mouseX, mouseY);
			}
		}

		/** kleine Marke; gibt die x-Position dahinter zurück */
		private int marker(GuiGraphicsExtractor g, String label, int x, int y, int fill, int color) {
			int mw = Ui.width(label, Ui.Font.SMALL) + 10;
			Ui.rect(g, x, y, mw, 12, 6, fill);
			Ui.text(g, label, x + 5, y + 2, color, Ui.Font.SMALL);
			return x + mw + 5;
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int[] b = button(x, w);
			if (b == null || !Ui.inside(mouseX, mouseY, b[0], y + 10, b[1], 20)) return false;
			if (AccountSwitcher.phase() != AccountSwitcher.Phase.IDLE) return true;
			HeldixMenuScreen.this.click();
			if (AccountSwitcher.canSwitchHere()) {
				AccountSwitcher.switchTo(account);
			} else if (confirming()) {
				confirmLeave = null;
				AccountSwitcher.leaveWorldAndSwitch(account);
			} else {
				confirmLeave = account.id();
				confirmLeaveAt = System.currentTimeMillis();
			}
			return true;
		}
	}

	/** Ein Wegpunkt: Farbpunkt (Klick wechselt die Farbe), Name, Koordinaten, Entfernung; rechts Auge und Löschen */
	private final class WaypointRow implements Row, Groupable {
		private final Waypoints.Waypoint waypoint;

		WaypointRow(Waypoints.Waypoint waypoint) {
			this.waypoint = waypoint;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 36;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 36);
			if (hover) Ui.rect(g, x + 3, y + 2, w - 6, 32, 7, Ui.SURFACE);
			int dot = waypoint.visible ? waypoint.color : Ui.withAlpha(waypoint.color, 0.35f);
			Ui.circle(g, x + 18, y + 18, 7, dot);
			if (Ui.inside(mouseX, mouseY, x + 8, y + 8, 20, 20)) Ui.circle(g, x + 18, y + 18, 3, 0x66FFFFFF);
			int textW = w - 40 - 60;
			Ui.text(g, Ui.ellipsize(waypoint.name, textW, Ui.Font.LABEL), x + 36, y + 8, waypoint.visible ? Ui.TEXT : Ui.FAINT, Ui.Font.LABEL);
			StringBuilder line = new StringBuilder(waypoint.coordinates()).append("  ·  ").append(Waypoints.dimensionName(waypoint.dimension));
			if (minecraft.player != null && waypoint.dimension.equals(Waypoints.dimension(minecraft))) {
				double dx = waypoint.x + 0.5 - minecraft.player.getX();
				double dy = waypoint.y - minecraft.player.getY();
				double dz = waypoint.z + 0.5 - minecraft.player.getZ();
				line.append("  ·  ").append(dev.heldixclient.module.impl.WaypointsModule.formatDistance(Math.sqrt(dx * dx + dy * dy + dz * dz)));
			}
			Ui.text(g, Ui.ellipsize(line.toString(), textW, Ui.Font.SMALL), x + 36, y + 21, Ui.MUTED, Ui.Font.SMALL);
			boolean overEye = Ui.inside(mouseX, mouseY, x + w - 56, y, 26, 36);
			boolean overTrash = Ui.inside(mouseX, mouseY, x + w - 30, y, 30, 36);
			Ui.icon(g, waypoint.visible ? "eye" : "eye-off", x + w - 49, y + 12, 12, overEye ? Ui.TEXT : Ui.FAINT);
			Ui.icon(g, "trash", x + w - 22, y + 12, 12, overTrash ? Ui.DANGER : Ui.FAINT);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (Ui.inside(mouseX, mouseY, x + 8, y + 8, 20, 20)) {
				HeldixMenuScreen.this.click();
				Waypoints.nextColor(waypoint);
				return true;
			}
			if (Ui.inside(mouseX, mouseY, x + w - 56, y, 26, 36)) {
				HeldixMenuScreen.this.click();
				Waypoints.toggleVisible(waypoint);
				return true;
			}
			if (Ui.inside(mouseX, mouseY, x + w - 30, y, 30, 36)) {
				HeldixMenuScreen.this.click();
				Waypoints.remove(minecraft, waypoint);
				return true;
			}
			return false;
		}
	}

	/** Übersicht oben: Spielfigur mit Cape (Klick: Cape-Auswahl), Name, Status und Knöpfe */
	private final class OverviewHero implements Row {
		/** niedrige Fenster: flacher, mit kleinerer Figur */
		private boolean compactHero() {
			return bodyH < 300;
		}

		private int heroH() {
			return compactHero() ? 92 : 124;
		}

		@Override
		public int height(int width) {
			return heroH();
		}

		@Override
		public int gapAfter() {
			return 12;
		}

		private int figureW() {
			return compactHero() ? 56 : 76;
		}

		/** Hauptknopf: im Spiel zurück ins Spiel, im Hauptmenü zu den Welten */
		private String primary() {
			return minecraft.level != null ? "Zurück zum Spiel" : "Spielen";
		}

		/** Knöpfe unten: {x, Breite} für Hauptknopf, Cape und HUD-Editor (Breite 0 = passt nicht) */
		private int[][] buttons(int x, int y, int w) {
			int playW = Ui.width(primary(), Ui.Font.SMALL) + 26;
			int capeW = Ui.width("Cape ändern", Ui.Font.SMALL) + 26;
			int hudW = Ui.width("HUD-Editor", Ui.Font.SMALL) + 26;
			int bx = x + figureW() + 18;
			int room = x + w - 12 - bx;
			if (playW + 6 + capeW + 6 + hudW > room) capeW = 0;
			if (playW + 6 + hudW > room) hudW = 0;
			return new int[][] {{bx, playW}, {bx + playW + 6, capeW}, {bx + playW + 6 + (capeW > 0 ? capeW + 6 : 0), hudW}};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Ui.rect(g, x, y, w, heroH(), 12, 0x1A3B82F6);
			Ui.outline(g, x, y, w, heroH(), 12, 0x333B82F6);
			// Figur links auf einem leuchtenden Podest
			int fx = x + 10;
			Ui.rect(g, fx + 6, y + heroH() - 14, figureW() - 12, 7, 3, 0x3D3B82F6);
			float seconds = (System.nanoTime() - created) / 1_000_000_000f;
			Capes.drawShowcase(g, Shell.skin(minecraft).get(), Capes.selected(), fx, y + 8, fx + figureW(), y + heroH() - 10, seconds);

			int tx = x + figureW() + 18;
			int tw = w - (tx - x) - 12;
			int top = compactHero() ? -6 : 0;
			Ui.text(g, greeting() + ",", tx, y + 16 + top, Ui.MUTED, Ui.Font.BODY);
			Ui.text(g, Ui.ellipsize(minecraft.getUser().getName(), tw, Ui.Font.TITLE), tx, y + 28 + top, Ui.TEXT, Ui.Font.TITLE);
			Capes.Cape cape = Capes.selected();
			String status = (cape == null ? "Ohne Heldix-Cape" : "Cape: " + cape.name()) + "  ·  " + place();
			Ui.text(g, Ui.ellipsize(status, tw, Ui.Font.SMALL), tx, y + 48 + top, Ui.MUTED, Ui.Font.SMALL);
			String service = FriendWidget.serviceHint();
			boolean ok = service == null;
			if (!compactHero()) Ui.circle(g, tx + 3, y + 64, 2.5f, ok ? Ui.SUCCESS : Ui.FAINT);
			if (!compactHero()) Ui.text(g, Ui.ellipsize(ok ? "Mit dem Heldix-Dienst verbunden" : service, tw - 10, Ui.Font.SMALL), tx + 10, y + 60, ok ? Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);

			int[][] b = buttons(x, y, w);
			int by = y + heroH() - 30;
			pill(g, primary(), b[0][0], by, b[0][1], true, Ui.inside(mouseX, mouseY, b[0][0], by, b[0][1], 16));
			if (b[1][1] > 0) pill(g, "Cape ändern", b[1][0], by, b[1][1], false, Ui.inside(mouseX, mouseY, b[1][0], by, b[1][1], 16));
			if (b[2][1] > 0) pill(g, "HUD-Editor", b[2][0], by, b[2][1], false, Ui.inside(mouseX, mouseY, b[2][0], by, b[2][1], 16));
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int[][] b = buttons(x, y, w);
			int by = y + heroH() - 30;
			if (Ui.inside(mouseX, mouseY, b[0][0], by, b[0][1], 16)) {
				HeldixMenuScreen.this.click();
				HeldixConfig.save();
				if (minecraft.level != null) minecraft.gui.setScreen(null);
				else Shell.open(minecraft, Shell.Page.WORLDS, HeldixMenuScreen.this);
				return true;
			}
			if (Ui.inside(mouseX, mouseY, x, y, figureW() + 14, heroH()) || b[1][1] > 0 && Ui.inside(mouseX, mouseY, b[1][0], by, b[1][1], 16)) {
				HeldixMenuScreen.this.click();
				go(Shell.Page.CAPE);
				return true;
			}
			if (b[2][1] > 0 && Ui.inside(mouseX, mouseY, b[2][0], by, b[2][1], 16)) {
				HeldixMenuScreen.this.click();
				minecraft.gui.setScreen(new HudEditorScreen(HeldixMenuScreen.this));
				return true;
			}
			return false;
		}
	}

	private final long created = System.nanoTime();

	private static String greeting() {
		int hour = java.time.LocalTime.now().getHour();
		return hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend";
	}

	/** Wo der Spieler gerade ist */
	private String place() {
		if (minecraft.level == null) return "im Hauptmenü";
		if (minecraft.getSingleplayerServer() != null) return "Einzelspieler: " + minecraft.getSingleplayerServer().getWorldData().getLevelName();
		var server = minecraft.getCurrentServer();
		return server == null ? "Mehrspieler" : "auf " + server.name;
	}

	/** Aktive Module als Chips (Klick öffnet die Einstellungen des Moduls) */
	private final class ModuleChips implements Row {
		private final List<Module> modules;

		ModuleChips(List<Module> modules) {
			this.modules = modules;
		}

		private List<int[]> cells(int x, int w) {
			List<int[]> cells = new ArrayList<>();
			int cx = x;
			int cy = 0;
			for (int i = 0; i < modules.size(); i++) {
				String label = modules.get(i).name();
				int cw = Ui.width(label, Ui.Font.SMALL) + 28;
				if (cx + cw > x + w && cx > x) {
					cx = x;
					cy += 24;
				}
				cells.add(new int[] {cx, cy, cw});
				cx += cw + 6;
			}
			return cells;
		}

		@Override
		public int height(int width) {
			List<int[]> cells = cells(0, width);
			return cells.getLast()[1] + 20;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			List<int[]> cells = cells(x, w);
			for (int i = 0; i < cells.size(); i++) {
				int[] c = cells.get(i);
				boolean hover = Ui.inside(mouseX, mouseY, c[0], y + c[1], c[2], 20);
				Ui.rect(g, c[0], y + c[1], c[2], 20, 10, hover ? 0x403B82F6 : 0x263B82F6);
				Ui.icon(g, modules.get(i).icon(), c[0] + 8, y + c[1] + 5, 10, Ui.ACCENT_TEXT);
				Ui.text(g, modules.get(i).name(), c[0] + 22, y + c[1] + 6, Ui.TEXT, Ui.Font.SMALL);
				if (hover) Ui.requestTooltip("Einstellungen von " + modules.get(i).name(), mouseX, mouseY);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			List<int[]> cells = cells(x, w);
			for (int i = 0; i < cells.size(); i++) {
				int[] c = cells.get(i);
				if (!Ui.inside(mouseX, mouseY, c[0], y + c[1], c[2], 20)) continue;
				HeldixMenuScreen.this.click();
				openSubmenu(modules.get(i));
				return true;
			}
			return false;
		}
	}

	/** Freund in der Übersicht: Kopf, Name, was er macht; Klick öffnet die Seite Freunde */
	private final class OverviewFriend implements Row, Groupable {
		private final Social.Friend friend;

		OverviewFriend(Social.Friend friend) {
			this.friend = friend;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 34;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 34);
			if (hover) Ui.rect(g, x + 3, y + 2, w - 6, 30, 7, Ui.SURFACE);
			avatar(g, friend, x + 10, y + 7);
			int textW = w - 46;
			friendName(g, friend, x + 38, y + 8, textW);
			Ui.text(g, Ui.ellipsize(friend.activity(), textW, Ui.Font.SMALL), x + 38, y + 20, friend.online() ? Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			go(Shell.Page.FRIENDS);
			return true;
		}
	}

	// ======================================================================================
	// Nachrichten
	// ======================================================================================

	/** Unterhaltung in der Liste: Kopf, Name, letzte Nachricht, Zeit und ungelesene */
	private final class ConversationRow implements Row, Groupable {
		private final Messages.Conversation conversation;

		ConversationRow(Messages.Conversation conversation) {
			this.conversation = conversation;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 38;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			if (Ui.inside(mouseX, mouseY, x, y, w, 38)) Ui.rect(g, x + 3, y + 2, w - 6, 34, 7, Ui.SURFACE);
			Social.Friend friend = friendOf(conversation.uuid());
			FriendWidget.face(g, conversation.uuid(), conversation.name(), x + 10, y + 9, 20, 1f);
			if (friend != null && friend.online()) {
				Ui.circle(g, x + 30, y + 29, 4, 0xFF161C28);
				Ui.circle(g, x + 30, y + 29, 3, Ui.SUCCESS);
			}
			String time = shortTime(conversation.last().at());
			int timeW = Ui.width(time, Ui.Font.SMALL);
			int unread = conversation.unread();
			int textW = w - 40 - Math.max(timeW, unread > 0 ? 20 : 0) - 16;
			Ui.text(g, Ui.ellipsize(friend != null ? friend.shownName() : conversation.name(), textW, Ui.Font.LABEL), x + 40, y + 9, Ui.TEXT, Ui.Font.LABEL);
			String preview = (conversation.last().mine() ? "Du: " : "") + Messages.clean(conversation.last().text());
			Ui.text(g, Ui.ellipsize(preview, textW, Ui.Font.SMALL), x + 40, y + 22, unread > 0 ? Ui.TEXT : Ui.MUTED, Ui.Font.SMALL);
			Ui.textRight(g, time, x + w - 12, y + 10, unread > 0 ? Ui.ACCENT_TEXT : Ui.FAINT, Ui.Font.SMALL);
			if (unread > 0) {
				String count = Integer.toString(Math.min(unread, 99));
				int bw = Math.max(13, Ui.width(count, Ui.Font.SMALL) + 8);
				Ui.rect(g, x + w - 12 - bw, y + 21, bw, 11, 5.5f, Ui.ACCENT);
				Ui.textCentered(g, count, x + w - 12 - bw / 2, y + 23, 0xFFFFFFFF, Ui.Font.SMALL);
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			openChat(conversation.uuid(), conversation.name());
			return true;
		}
	}

	/** Freund ohne Unterhaltung: Klick beginnt einen Chat */
	private final class StartChatRow implements Row, Groupable {
		private final Social.Friend friend;

		StartChatRow(Social.Friend friend) {
			this.friend = friend;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 34;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 34);
			if (hover) Ui.rect(g, x + 3, y + 2, w - 6, 30, 7, Ui.SURFACE);
			avatar(g, friend, x + 10, y + 6);
			int pw = Ui.width("Schreiben", Ui.Font.SMALL) + 30;
			int textW = w - 40 - pw - 16;
			friendName(g, friend, x + 38, y + 8, textW);
			Ui.text(g, Ui.ellipsize(friend.activity(), textW, Ui.Font.SMALL), x + 38, y + 20, friend.online() ? Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);
			int px = x + w - 10 - pw;
			Ui.rect(g, px, y + 9, pw, 16, 8, hover ? Ui.SURFACE_STRONG : Ui.SURFACE_HOVER);
			Ui.icon(g, "chat", px + 7, y + 12.5f, 9, Ui.ACCENT_TEXT);
			Ui.text(g, "Schreiben", px + 20, y + 13, Ui.TEXT, Ui.Font.SMALL);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			HeldixMenuScreen.this.click();
			openChat(friend.uuid(), friend.name());
			return true;
		}
	}

	/**
	 * Eine Nachricht als Sprechblase: eigene rechts in Blau, die des Freundes links mit seinem Kopf neben der letzten
	 * Blase einer Gruppe. Uhrzeit nur an der letzten Blase einer Gruppe (sonst als Tooltip). Links lassen sich öffnen.
	 * Ab Dienst 1.12.0: Bezug einer Antwort oben in der Blase, Beitreten-Karte (Server, Welt, Einladung) unter dem Text,
	 * Reaktionen darunter (Klick setzt bzw. entfernt die eigene); beim Darüberfahren daneben Antworten, Reagieren und
	 * (eigene) Löschen. Rechtsklick öffnet ein Menü (Antworten, Reagieren, Kopieren, Löschen). Ausstehende oder
	 * fehlgeschlagene eigene Nachrichten erscheinen blass bzw. rot.
	 */
	private final class Bubble implements Row {
		private static final int HEAD = 14;
		private static final int QUOTE_H = 22;
		private static final int CARD_H = 34;
		private static final int REACTIONS_H = 16;
		private final long key;
		private final String text;
		private final long at;
		private final boolean mine;
		/** direkt nach einer Nachricht desselben Absenders: weniger Abstand */
		private final boolean continued;
		/** letzte Blase der Gruppe: Uhrzeit und (beim Freund) Kopf */
		private final boolean last;
		/** null = gesendet; sonst die ausstehende/fehlgeschlagene Nachricht */
		private final PendingMessage pending;
		/** die Nachricht selbst (null bei ausstehenden) */
		private final Messages.Message message;
		private final Messages.Reply reply;
		private final Messages.Card card;
		private final String link;

		Bubble(Messages.Message message, boolean continued, boolean last) {
			this(message.id(), message.text(), message.at(), message.mine(), continued, last, null, message, message.replyTo(), message.card());
		}

		Bubble(PendingMessage pending, boolean continued) {
			this(-pending.localId, pending.text, pending.at, true, continued, true, pending, null, pending.replyPreview(), pending.card);
		}

		private Bubble(long key, String text, long at, boolean mine, boolean continued, boolean last, PendingMessage pending, Messages.Message message,
				Messages.Reply reply, Messages.Card card) {
			this.key = key;
			this.text = Messages.clean(text);
			this.at = at;
			this.mine = mine;
			this.continued = continued;
			this.last = last;
			this.pending = pending;
			this.message = message;
			this.reply = reply;
			this.card = card;
			java.util.regex.Matcher matcher = LINK.matcher(this.text);
			this.link = card == null && matcher.find() ? matcher.group() : null;
		}

		/** Breite für Text: höchstens drei Viertel der Fläche, links Platz für den Kopf */
		private int maxText(int w) {
			return Math.min((w - HEAD - 6) * 3 / 4, 340) - 18;
		}

		private List<FormattedCharSequence> lines(int w) {
			int maxW = maxText(w);
			long cacheKey = key * 4096 + maxW;
			return bubbleLines.computeIfAbsent(cacheKey, k -> Ui.wrap(text, maxW, Ui.Font.BODY));
		}

		/** Fußzeile in der Blase: Uhrzeit, "wird gesendet …", Fehler, Link */
		private String footer() {
			if (pending != null) return pending.failed ? "Nicht gesendet · klicken zum erneut Senden" : "wird gesendet …";
			if (link != null) return (last ? clock(at) + "  ·  " : "") + "Link öffnen";
			return last ? clock(at) : null;
		}

		private int bubbleHeight(int w) {
			int h = 8 + lines(w).size() * 11 + (footer() != null ? 10 : 2);
			if (reply != null) h += QUOTE_H;
			if (card != null) h += CARD_H + 4;
			return h;
		}

		private Map<UUID, String> reactions() {
			return message == null ? Map.of() : message.reactions();
		}

		@Override
		public int height(int width) {
			return (continued ? 0 : 5) + bubbleHeight(width) + (reactions().isEmpty() ? 0 : REACTIONS_H);
		}

		@Override
		public int gapAfter() {
			return last ? 4 : 2;
		}

		/** {x, y, Breite, Höhe} der Blase */
		private int[] box(int x, int y, int w) {
			List<FormattedCharSequence> lines = lines(w);
			String footer = footer();
			int textW = footer != null ? Ui.width(footer, Ui.Font.SMALL) : 0;
			for (FormattedCharSequence line : lines) textW = Math.max(textW, font.width(line));
			if (reply != null) textW = Math.max(textW, Math.min(maxText(w), Ui.width(replyText(), Ui.Font.SMALL) + 8));
			if (card != null) textW = Math.max(textW, Math.min(maxText(w), 190));
			int bw = textW + 18;
			int bh = bubbleHeight(w);
			int by = y + (continued ? 0 : 5);
			int bx = mine ? x + w - bw - 2 : x + HEAD + 6;
			return new int[] {bx, by, bw, bh};
		}

		/** Name und Anfang der Nachricht, auf die geantwortet wird */
		private String replyName() {
			if (reply.deleted()) return "Gelöschte Nachricht";
			if (reply.from() != null && reply.from().equals(minecraft.getUser().getProfileId())) return "Du";
			Social.Friend friend = reply.from() == null ? null : friendOf(reply.from());
			return friend != null ? friend.shownName() : openChatName;
		}

		private String replyText() {
			return reply.deleted() ? "Diese Nachricht gibt es nicht mehr" : reply.text();
		}

		/** Knöpfe beim Darüberfahren neben der Blase: {Aktion, x, y} */
		private List<Object[]> hoverActions(int[] b) {
			List<Object[]> list = new ArrayList<>();
			if (message == null || !Social.friends2()) return list;
			List<String> actions = new ArrayList<>(List.of("reply", "react"));
			if (mine) actions.add("delete");
			int ay = b[1] + Math.min(4, b[3] / 2 - 7);
			for (int i = 0; i < actions.size(); i++) {
				int ax = mine ? b[0] - 18 - i * 17 : b[0] + b[2] + 4 + i * 17;
				list.add(new Object[] {actions.get(i), ax, ay});
			}
			return list;
		}

		/** Reaktionen unter der Blase: {ID, x, Breite, Anzahl} */
		private List<Object[]> reactionChips(int[] b) {
			Map<String, Integer> counts = new java.util.LinkedHashMap<>();
			for (String id : Messages.REACTIONS) {
				int n = 0;
				for (String value : reactions().values()) if (value.equals(id)) n++;
				if (n > 0) counts.put(id, n);
			}
			List<Object[]> chips = new ArrayList<>();
			int total = 0;
			for (Map.Entry<String, Integer> entry : counts.entrySet()) total += 22 + (entry.getValue() > 1 ? Ui.width(Integer.toString(entry.getValue()), Ui.Font.SMALL) + 2 : 0) + 3;
			int cx = mine ? b[0] + b[2] - total + 3 : b[0];
			for (Map.Entry<String, Integer> entry : counts.entrySet()) {
				int cw = 22 + (entry.getValue() > 1 ? Ui.width(Integer.toString(entry.getValue()), Ui.Font.SMALL) + 2 : 0);
				chips.add(new Object[] {entry.getKey(), cx, cw, entry.getValue()});
				cx += cw + 3;
			}
			return chips;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int[] b = box(x, y, w);
			int rowH = height(w);
			boolean hover = Ui.inside(mouseX, mouseY, b[0], b[1], b[2], b[3]);
			boolean rowHover = mouseY >= y && mouseY < y + rowH && Ui.inside(mouseX, mouseY, x, y, w, rowH);
			boolean failed = pending != null && pending.failed;
			int fill;
			if (failed) fill = (Ui.DANGER & 0xFFFFFF) | 0x2E000000;
			else if (mine) fill = pending != null ? Ui.withAlpha(Ui.ACCENT, 0.55f) : hover ? Ui.ACCENT_HOVER : Ui.ACCENT;
			else fill = hover ? 0x30FFFFFF : 0x24FFFFFF;
			Ui.rect(g, b[0], b[1], b[2], b[3], 9, fill);
			if (failed) Ui.outline(g, b[0], b[1], b[2], b[3], 9, (Ui.DANGER & 0xFFFFFF) | 0x99000000);
			int ly = b[1] + 6;
			int color = mine && !failed ? 0xFFFFFFFF : Ui.TEXT;
			// Bezug der Antwort: Strich, Name, Anfang der Nachricht
			if (reply != null) {
				Ui.rect(g, b[0] + 7, ly, 2, QUOTE_H - 4, 1, mine ? 0x99FFFFFF : Ui.ACCENT_LINE);
				Ui.text(g, Ui.ellipsize(replyName(), b[2] - 26, Ui.Font.SMALL), b[0] + 13, ly + 1, mine ? 0xE6FFFFFF : Ui.ACCENT_TEXT, Ui.Font.SMALL);
				Ui.text(g, Ui.ellipsize(replyText(), b[2] - 26, Ui.Font.SMALL), b[0] + 13, ly + 10, mine ? 0xB3FFFFFF : Ui.MUTED, Ui.Font.SMALL);
				ly += QUOTE_H;
			}
			for (FormattedCharSequence line : lines(w)) {
				g.text(font, line, b[0] + 9, ly, color, false);
				ly += 11;
			}
			if (card != null) drawCard(g, b[0] + 6, ly + 2, b[2] - 12, mouseX, mouseY);
			String footer = footer();
			if (footer != null) {
				int footerColor = failed ? Ui.DANGER : mine ? 0xC8FFFFFF : link != null ? Ui.ACCENT_TEXT : Ui.FAINT;
				Ui.textRight(g, footer, b[0] + b[2] - 8, b[1] + b[3] - 10, footerColor, Ui.Font.SMALL);
			}
			// Kopf des Freundes neben der letzten Blase seiner Gruppe
			if (!mine && last && openChat != null) FriendWidget.face(g, openChat, openChatName, x + 2, b[1] + b[3] - HEAD, HEAD, 1f);
			// Reaktionen unter der Blase
			String own = message == null ? null : Messages.ownReaction(message);
			for (Object[] chip : reactionChips(b)) {
				int cx = (int) chip[1];
				int cw = (int) chip[2];
				int cy = b[1] + b[3] + 2;
				boolean ownChip = chip[0].equals(own);
				boolean over = Ui.inside(mouseX, mouseY, cx, cy, cw, 13);
				Ui.rect(g, cx, cy, cw, 13, 6.5f, ownChip ? Ui.ACCENT_SOFT : over ? Ui.SURFACE_STRONG : Ui.SURFACE_HOVER);
				if (ownChip) Ui.outline(g, cx, cy, cw, 13, 6.5f, Ui.ACCENT_LINE);
				dev.heldixclient.ui.ReactionIcons.draw(g, (String) chip[0], cx + 4, cy + 1.5f, 10, 1f);
				if ((int) chip[3] > 1) Ui.text(g, Integer.toString((int) chip[3]), cx + 16, cy + 3, Ui.TEXT, Ui.Font.SMALL);
				if (over) Ui.requestTooltip(Messages.reactionLabel((String) chip[0]) + " · " + reactionNames((String) chip[0])
						+ (ownChip ? " · Klick entfernt deine" : " · Klick: auch reagieren"), mouseX, mouseY);
				settingCenters.put("reaction:" + key + ":" + chip[0], new int[] {cx + cw / 2, cy + 6});
			}
			// beim Darüberfahren: Antworten, Reagieren, Löschen
			if (rowHover && !menu.isOpen()) {
				boolean confirming = confirmDeleteMessage == key && System.currentTimeMillis() - confirmDeleteMessageAt < 4000;
				for (Object[] action : hoverActions(b)) {
					int ax = (int) action[1];
					int ay = (int) action[2];
					boolean over = Ui.inside(mouseX, mouseY, ax, ay, 15, 15);
					String id = (String) action[0];
					boolean danger = "delete".equals(id);
					Ui.rect(g, ax, ay, 15, 15, 5, over ? (danger && confirming ? Ui.DANGER : Ui.SURFACE_STRONG) : Ui.SURFACE_HOVER);
					String icon = switch (id) {
						case "reply" -> "back";
						case "react" -> "sparkles";
						default -> "trash";
					};
					Ui.icon(g, icon, ax + 3, ay + 3, 9, danger ? (confirming ? 0xFFFFFFFF : Ui.DANGER) : over ? Ui.TEXT : Ui.MUTED);
					if (over) Ui.requestTooltip(switch (id) {
						case "reply" -> "Antworten";
						case "react" -> "Reagieren";
						default -> confirming ? "Nochmal klicken: für beide löschen" : "Löschen (für beide)";
					}, mouseX, mouseY);
				}
			}
			for (Object[] action : hoverActions(b)) settingCenters.put("bubble:" + action[0] + ":" + key, new int[] {(int) action[1] + 7, (int) action[2] + 7});
			if (card != null) settingCenters.put("card:" + key, new int[] {b[0] + b[2] - 12 - cardButtonWidth() / 2, ly + 2 + CARD_H / 2});
			if (hover) {
				String when = java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm").format(java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()));
				Ui.requestTooltip(failed && pending.error != null ? pending.error : when + (link != null ? " · Klick öffnet den Link" : "")
						+ (Social.friends2() ? " · Rechtsklick: Antworten, Reagieren …" : " · Rechtsklick kopiert"), mouseX, mouseY);
			}
		}

		/** Namen derer, die so reagiert haben (für den Tooltip) */
		private String reactionNames(String id) {
			List<String> names = new ArrayList<>();
			for (Map.Entry<UUID, String> entry : reactions().entrySet()) {
				if (!entry.getValue().equals(id)) continue;
				if (entry.getKey().equals(minecraft.getUser().getProfileId())) names.add("du");
				else {
					Social.Friend friend = friendOf(entry.getKey());
					names.add(friend != null ? friend.shownName() : openChatName);
				}
			}
			return String.join(", ", names);
		}

		private int cardButtonWidth() {
			String label = cardButtonLabel();
			return label == null ? 0 : Ui.width(label, Ui.Font.SMALL) + 16;
		}

		/** Knopf der Karte: „Beitreten“ bzw. „Annehmen“ (bei eigenen Karten keiner) */
		private String cardButtonLabel() {
			if (mine || card == null) return null;
			return "invite".equals(card.kind()) ? "Annehmen" : "Beitreten";
		}

		/** Beitreten-Karte: Symbol, Titel, Art, Knopf */
		private void drawCard(GuiGraphicsExtractor g, int cx, int cy, int cw, int mouseX, int mouseY) {
			Ui.rect(g, cx, cy, cw, CARD_H, 7, mine ? 0x33000000 : 0x1AFFFFFF);
			Ui.outline(g, cx, cy, cw, CARD_H, 7, mine ? 0x40FFFFFF : Ui.LINE);
			String icon = switch (card.kind()) {
				case "world" -> "lan";
				case "invite" -> "user-plus";
				default -> "server";
			};
			Ui.rect(g, cx + 6, cy + 7, 20, 20, 6, mine ? 0x33FFFFFF : Ui.ACCENT_SOFT);
			Ui.icon(g, icon, cx + 11, cy + 12, 10, mine ? 0xFFFFFFFF : Ui.ACCENT_TEXT);
			String button = cardButtonLabel();
			int bw = cardButtonWidth();
			int textW = cw - 40 - (button != null ? bw + 8 : 0);
			Ui.text(g, Ui.ellipsize(card.shownTitle(), textW, Ui.Font.LABEL), cx + 32, cy + 7, mine ? 0xFFFFFFFF : Ui.TEXT, Ui.Font.LABEL);
			String detail = card.kindLabel() + ("server".equals(card.kind()) && card.title() != null ? " · " + card.target() : "");
			Ui.text(g, Ui.ellipsize(detail, textW, Ui.Font.SMALL), cx + 32, cy + 20, mine ? 0xC8FFFFFF : Ui.MUTED, Ui.Font.SMALL);
			if (button != null) {
				int bx = cx + cw - 6 - bw;
				int by = cy + 9;
				boolean confirming = confirmAddress != null && System.currentTimeMillis() - confirmAddressAt < 4000
						&& (confirmAddress.equals("server:" + card.target()) || confirmAddress.equals("welt:" + card.target()));
				String label = confirming ? "Sicher?" : button;
				pill(g, label, bx, by, bw, true, Ui.inside(mouseX, mouseY, bx, by, bw, 16));
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int[] b = box(x, y, w);
			// Knöpfe neben der Blase
			for (Object[] action : hoverActions(b)) {
				if (!Ui.inside(mouseX, mouseY, (int) action[1], (int) action[2], 15, 15)) continue;
				HeldixMenuScreen.this.click();
				switch ((String) action[0]) {
					case "reply" -> startReply(message);
					case "react" -> openReactionMenu(message, (int) mouseX, (int) mouseY);
					default -> deleteMessage(message, key);
				}
				return true;
			}
			// Reaktionen: eigene entfernen bzw. dieselbe setzen
			String own = message == null ? null : Messages.ownReaction(message);
			for (Object[] chip : reactionChips(b)) {
				if (!Ui.inside(mouseX, mouseY, (int) chip[1], b[1] + b[3] + 2, (int) chip[2], 13)) continue;
				HeldixMenuScreen.this.click();
				react(message, chip[0].equals(own) ? null : (String) chip[0]);
				return true;
			}
			if (!Ui.inside(mouseX, mouseY, b[0], b[1], b[2], b[3])) return false;
			if (pending != null && pending.failed) {
				HeldixMenuScreen.this.click();
				pendingMessages.remove(pending);
				sendText(pending.text, pending.reply, pending.card);
				return true;
			}
			// Karte: Beitreten bzw. Einladung annehmen
			if (card != null && cardButtonLabel() != null) {
				int bw = cardButtonWidth();
				int cardY = b[1] + 6 + (reply != null ? QUOTE_H : 0) + lines(w).size() * 11 + 2;
				if (Ui.inside(mouseX, mouseY, b[0] + b[2] - 12 - bw, cardY + 9, bw, 16)) {
					HeldixMenuScreen.this.click();
					useCard(card);
					return true;
				}
			}
			if (link != null) {
				try {
					java.net.URI uri = java.net.URI.create(link);
					HeldixMenuScreen.this.click();
					net.minecraft.client.gui.screens.ConfirmLinkScreen.confirmLinkNow(HeldixMenuScreen.this, uri);
					return true;
				} catch (IllegalArgumentException e) {
					return false;
				}
			}
			return false;
		}

		@Override
		public boolean secondaryClick(double mouseX, double mouseY, int x, int y, int w) {
			int[] b = box(x, y, w);
			if (!Ui.inside(mouseX, mouseY, b[0], b[1], b[2], b[3])) return false;
			HeldixMenuScreen.this.click();
			if (message == null || !Social.friends2()) {
				minecraft.keyboardHandler.setClipboard(text);
				pageMessage("Nachricht kopiert", true);
				return true;
			}
			openMessageMenu(message, text, (int) mouseX, (int) mouseY);
			return true;
		}
	}

	/** Antworten: Leiste über der Eingabe, Fokus ins Feld */
	private void startReply(Messages.Message message) {
		if (message == null) return;
		replyTo = message;
		if (chatInput != null) {
			setFocused(chatInput);
			chatInput.setFocused(true);
		}
	}

	/** Eigene Nachricht löschen: zweiter Klick innerhalb von 4 Sekunden (für beide weg) */
	private void deleteMessage(Messages.Message message, long key) {
		if (message == null || !message.mine()) return;
		if (confirmDeleteMessage != key || System.currentTimeMillis() - confirmDeleteMessageAt >= 4000) {
			confirmDeleteMessage = key;
			confirmDeleteMessageAt = System.currentTimeMillis();
			return;
		}
		confirmDeleteMessage = 0;
		if (replyTo != null && replyTo.id() == message.id()) replyTo = null;
		Messages.delete(openChat, message.id()).whenComplete((ok, error) -> minecraft.execute(() -> {
			if (error != null) pageMessage(errorText(error), false);
		}));
	}

	/** Reaktion setzen bzw. entfernen (null) */
	private void react(Messages.Message message, String reaction) {
		if (message == null || openChat == null) return;
		Messages.react(openChat, message.id(), reaction).whenComplete((ok, error) -> minecraft.execute(() -> {
			if (error != null) pageMessage(errorText(error), false);
		}));
	}

	/** Menü mit den 8 Reaktionen (die eigene mit Haken; nochmal wählen entfernt sie) */
	private void openReactionMenu(Messages.Message message, int x, int y) {
		menu.open(reactionItems(message), x, y, width, height);
	}

	private List<dev.heldixclient.ui.ContextMenu.Item> reactionItems(Messages.Message message) {
		List<dev.heldixclient.ui.ContextMenu.Item> items = new ArrayList<>();
		String own = Messages.ownReaction(message);
		for (String id : Messages.REACTIONS) {
			items.add(new dev.heldixclient.ui.ContextMenu.Radio(Messages.reactionLabel(id), () -> id.equals(Messages.ownReaction(message)), () -> {
				react(message, id.equals(own) ? null : id);
				menu.close();
			}));
		}
		if (own != null) {
			items.add(new dev.heldixclient.ui.ContextMenu.Separator());
			items.add(new dev.heldixclient.ui.ContextMenu.Action("Reaktion entfernen", "close", () -> react(message, null)));
		}
		return items;
	}

	/** Rechtsklick auf eine Nachricht: Antworten, Reagieren, Kopieren, (eigene) Löschen */
	private void openMessageMenu(Messages.Message message, String text, int x, int y) {
		List<dev.heldixclient.ui.ContextMenu.Item> items = new ArrayList<>();
		items.add(new dev.heldixclient.ui.ContextMenu.Action("Antworten", "back", () -> startReply(message)));
		items.add(new dev.heldixclient.ui.ContextMenu.Submenu("Reagieren", "sparkles", () -> {
			String own = Messages.ownReaction(message);
			return own == null ? null : Messages.reactionLabel(own);
		}, () -> reactionItems(message)));
		items.add(new dev.heldixclient.ui.ContextMenu.Action("Text kopieren", "copy", () -> {
			minecraft.keyboardHandler.setClipboard(text);
			pageMessage("Nachricht kopiert", true);
		}));
		if (message.mine()) {
			items.add(new dev.heldixclient.ui.ContextMenu.Separator());
			items.add(new dev.heldixclient.ui.ContextMenu.Action("Für beide löschen", "trash", null, true, true, () -> {
				confirmDeleteMessage = message.id();
				confirmDeleteMessageAt = System.currentTimeMillis();
				deleteMessage(message, message.id());
			}));
		}
		menu.open(items, x, y, width, height);
	}

	/** https://… bzw. http://… in einer Nachricht */
	private static final java.util.regex.Pattern LINK = java.util.regex.Pattern.compile("https?://[^\\s]+");

	/** Eigene Nachricht, die gerade gesendet wird oder nicht ankam (mit Bezug und Karte) */
	private static final class PendingMessage {
		private static long next = 1;
		final long localId = next++;
		final UUID to;
		final String text;
		final long reply;
		final Messages.Card card;
		final long at = System.currentTimeMillis();
		boolean failed;
		String error;

		PendingMessage(UUID to, String text, long reply, Messages.Card card) {
			this.to = to;
			this.text = text;
			this.reply = reply;
			this.card = card;
		}

		/** Bezug für die Anzeige aus dem geladenen Verlauf */
		Messages.Reply replyPreview() {
			if (reply <= 0) return null;
			Messages.Message original = Messages.find(to, reply);
			if (original == null) return new Messages.Reply(reply, null, null);
			String shown = Messages.clean(original.text());
			return new Messages.Reply(reply, original.from(), shown.length() > 100 ? shown.substring(0, 100) + "…" : shown);
		}
	}

	/** Linie „Neue Nachrichten“ vor der ersten ungelesenen Nachricht */
	private final class NewDivider implements Row {
		@Override
		public int height(int width) {
			return 16;
		}

		@Override
		public int gapAfter() {
			return 2;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			String label = "Neue Nachrichten";
			int lw = Ui.width(label, Ui.Font.SMALL) + 14;
			Ui.hline(g, x + 4, x + w - lw - 8, y + 8, Ui.ACCENT_LINE);
			Ui.rect(g, x + w - lw - 4, y + 2, lw, 12, 6, Ui.ACCENT_SOFT);
			Ui.textCentered(g, label, x + w - lw / 2 - 4, y + 4, Ui.ACCENT_TEXT, Ui.Font.SMALL);
		}
	}

	/** Datum zwischen den Nachrichten ("Heute", "Gestern", "24.11.2026") */
	private final class DayRow implements Row {
		private final String label;

		DayRow(String label) {
			this.label = label;
		}

		@Override
		public int height(int width) {
			return 18;
		}

		@Override
		public int gapAfter() {
			return 2;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int lw = Ui.width(label, Ui.Font.SMALL) + 16;
			int cx = x + w / 2;
			Ui.hline(g, x + 8, cx - lw / 2f - 4, y + 9, Ui.LINE);
			Ui.hline(g, cx + lw / 2f + 4, x + w - 8, y + 9, Ui.LINE);
			Ui.rect(g, cx - lw / 2f, y + 3, lw, 13, 6.5f, Ui.SURFACE);
			Ui.textCentered(g, label, cx, y + 6, Ui.FAINT, Ui.Font.SMALL);
		}
	}

	/** Knopf "Ältere Nachrichten laden" über dem Chat */
	private final class LoadOlderRow implements Row {
		@Override
		public int height(int width) {
			return 18;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean loading = Messages.loading(openChat);
			String label = loading ? "Lade …" : "Ältere Nachrichten laden";
			boolean hover = !loading && Ui.inside(mouseX, mouseY, x, y, w, 18);
			Ui.textCentered(g, label, x + w / 2, y + 5, hover ? Ui.TEXT : Ui.ACCENT_TEXT, Ui.Font.SMALL);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (Messages.loading(openChat)) return false;
			HeldixMenuScreen.this.click();
			Messages.loadHistory(openChat, true);
			return true;
		}
	}

	/** Leiste über dem Chat: blockieren bzw. melden bestätigen */
	private final class ConfirmBar implements Row {
		private static final String[][] REASONS = {{"spam", "Spam"}, {"harassment", "Belästigung"}, {"inappropriate", "Unangemessen"}, {"other", "Sonstiges"}};
		private final boolean report;

		ConfirmBar(boolean report) {
			this.report = report;
		}

		private String text() {
			return report
					? openChatName + " melden? Mit der Meldung gehen die letzten 20 Nachrichten dieses Chats an den Betreiber des Heldix-Dienstes, damit er sie prüfen kann."
					: openChatName + " blockieren? Freundschaft und Chat werden gelöscht, und " + openChatName + " kann dir keine Anfragen mehr schicken. Freigeben geht unter Privatsphäre.";
		}

		private List<FormattedCharSequence> lines(int w) {
			return Ui.wrap(text(), w - 34, Ui.Font.BODY);
		}

		/** Kacheln der Gründe: {x, Breite} */
		private int[][] chips(int x) {
			int[][] cells = new int[REASONS.length][];
			int cx = x + 28;
			for (int i = 0; i < REASONS.length; i++) {
				int cw = Ui.width(REASONS[i][1], Ui.Font.SMALL) + 18;
				cells[i] = new int[] {cx, cw};
				cx += cw + 5;
			}
			return cells;
		}

		private int chipsY(int y, int w) {
			return y + 10 + lines(w).size() * 11 + 4;
		}

		private int buttonsY(int y, int w) {
			return report ? chipsY(y, w) + 24 : chipsY(y, w);
		}

		/** {x, Breite} für Bestätigen und Abbrechen */
		private int[][] buttons(int x) {
			String ok = report ? "Melden" : "Blockieren";
			int okW = Ui.width(ok, Ui.Font.SMALL) + 24;
			int cancelW = Ui.width("Abbrechen", Ui.Font.SMALL) + 24;
			return new int[][] {{x + 28, okW}, {x + 28 + okW + 6, cancelW}};
		}

		@Override
		public int height(int width) {
			return buttonsY(0, width) + 16 + 10;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			int color = report ? Ui.WARNING : Ui.DANGER;
			Ui.rect(g, x, y, w, h, 10, (color & 0xFFFFFF) | 0x14000000);
			Ui.outline(g, x, y, w, h, 10, (color & 0xFFFFFF) | 0x40000000);
			Ui.icon(g, report ? "flag" : "ban", x + 10, y + 9, 11, color);
			int ly = y + 10;
			for (FormattedCharSequence line : lines(w)) {
				g.text(font, line, x + 28, ly, 0xFFD5DCE8, false);
				ly += 11;
			}
			if (report) {
				int[][] cells = chips(x);
				int cy = chipsY(y, w);
				for (int i = 0; i < REASONS.length; i++) {
					boolean on = REASONS[i][0].equals(reportReason);
					boolean hover = Ui.inside(mouseX, mouseY, cells[i][0], cy, cells[i][1], 18);
					Ui.rect(g, cells[i][0], cy, cells[i][1], 18, 9, on ? Ui.ACCENT_SOFT : hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
					Ui.outline(g, cells[i][0], cy, cells[i][1], 18, 9, on ? Ui.ACCENT_LINE : Ui.LINE);
					Ui.textCentered(g, REASONS[i][1], cells[i][0] + cells[i][1] / 2, cy + 6, on ? Ui.TEXT : Ui.MUTED, Ui.Font.SMALL);
				}
			}
			int by = buttonsY(y, w);
			int[][] b = buttons(x);
			boolean overOk = Ui.inside(mouseX, mouseY, b[0][0], by, b[0][1], 16);
			Ui.rect(g, b[0][0], by, b[0][1], 16, 8, overOk ? Ui.lerp(color, 0xFFFFFFFF, 0.15f) : color);
			Ui.textCentered(g, report ? "Melden" : "Blockieren", b[0][0] + b[0][1] / 2, by + 4, 0xFF111111, Ui.Font.SMALL);
			pill(g, "Abbrechen", b[1][0], by, b[1][1], false, Ui.inside(mouseX, mouseY, b[1][0], by, b[1][1], 16));
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (report) {
				int[][] cells = chips(x);
				int cy = chipsY(y, w);
				for (int i = 0; i < REASONS.length; i++) {
					if (Ui.inside(mouseX, mouseY, cells[i][0], cy, cells[i][1], 18)) {
						HeldixMenuScreen.this.click();
						reportReason = REASONS[i][0];
						return true;
					}
				}
			}
			int by = buttonsY(y, w);
			int[][] b = buttons(x);
			if (Ui.inside(mouseX, mouseY, b[1][0], by, b[1][1], 16)) {
				HeldixMenuScreen.this.click();
				reporting = false;
				confirmingBlock = false;
				return true;
			}
			if (!Ui.inside(mouseX, mouseY, b[0][0], by, b[0][1], 16)) return false;
			HeldixMenuScreen.this.click();
			UUID target = openChat;
			String name = openChatName;
			if (report) {
				reporting = false;
				Messages.report(target, reportReason, null).whenComplete((ok, error) -> minecraft.execute(() -> {
					if (error == null) pageMessage("Meldung gesendet. Danke! Über das Symbol oben kannst du " + name + " zusätzlich blockieren.", true);
					else pageMessage(errorText(error), false);
				}));
			} else {
				confirmingBlock = false;
				Messages.block(target).whenComplete((ok, error) -> minecraft.execute(() -> {
					if (error == null) {
						closeChat();
						pageMessage(name + " ist blockiert.", true);
					} else {
						pageMessage(errorText(error), false);
					}
				}));
			}
			return true;
		}
	}

	/** Blockierter Spieler (Privatsphäre): Name, seit wann, Freigeben */
	private final class BlockedRow implements Row, Groupable {
		private final Messages.Blocked blocked;

		BlockedRow(Messages.Blocked blocked) {
			this.blocked = blocked;
		}

		@Override
		public void grouped() {
		}

		@Override
		public int height(int width) {
			return 32;
		}

		private int pillWidth() {
			return Ui.width("Freigeben", Ui.Font.SMALL) + 20;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			FriendWidget.face(g, blocked.uuid(), blocked.name(), x + 11, y + 8, 16, 0.6f);
			int pw = pillWidth();
			int textW = w - 40 - pw - 16;
			Ui.text(g, Ui.ellipsize(blocked.name(), textW, Ui.Font.LABEL), x + 36, y + 7, Ui.TEXT, Ui.Font.LABEL);
			String since = blocked.at() > 0 ? "blockiert am " + java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy")
					.format(java.time.Instant.ofEpochMilli(blocked.at()).atZone(java.time.ZoneId.systemDefault())) : "blockiert";
			Ui.text(g, since, x + 36, y + 19, Ui.FAINT, Ui.Font.SMALL);
			int px = x + w - 10 - pw;
			pill(g, "Freigeben", px, y + 8, pw, false, Ui.inside(mouseX, mouseY, px, y + 8, pw, 16));
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int pw = pillWidth();
			if (!Ui.inside(mouseX, mouseY, x + w - 10 - pw, y + 8, pw, 16)) return false;
			HeldixMenuScreen.this.click();
			report(Messages.unblock(blocked.uuid()), blocked.name() + " ist freigegeben");
			return true;
		}
	}

	private Social.Friend friendOf(UUID uuid) {
		for (Social.Friend friend : Social.friends()) if (friend.uuid().equals(uuid)) return friend;
		return null;
	}

	private static String clock(long at) {
		return java.time.format.DateTimeFormatter.ofPattern("HH:mm").format(java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()));
	}

	private static java.time.LocalDate day(long at) {
		return java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()).toLocalDate();
	}

	private static String dayLabel(java.time.LocalDate day) {
		java.time.LocalDate today = java.time.LocalDate.now();
		if (day.equals(today)) return "Heute";
		if (day.equals(today.minusDays(1))) return "Gestern";
		return java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy").format(day);
	}

	/** Zeit in der Liste: heute die Uhrzeit, sonst das Datum */
	private static String shortTime(long at) {
		java.time.LocalDate day = day(at);
		if (day.equals(java.time.LocalDate.now())) return clock(at);
		if (day.equals(java.time.LocalDate.now().minusDays(1))) return "Gestern";
		return java.time.format.DateTimeFormatter.ofPattern("dd.MM.").format(day);
	}

	/** Kopf des Skins (20 px), offline blasser; grüner Punkt = online */
	private void avatar(GuiGraphicsExtractor g, Social.Friend friend, int x, int y) {
		FriendWidget.face(g, friend.uuid(), friend.name(), x, y + 1, 20, friend.online() ? 1f : 0.45f);
		if (friend.online()) {
			Ui.circle(g, x + 20, y + 21, 4, 0xFF161C28);
			Ui.circle(g, x + 20, y + 21, 3, Ui.SUCCESS);
		}
	}

	/** kleiner Knopf in einer Zeile */
	private void pill(GuiGraphicsExtractor g, String label, int x, int y, int w, boolean primary, boolean hover) {
		int fill = primary ? (hover ? Ui.ACCENT_HOVER : Ui.ACCENT) : (hover ? Ui.SURFACE_STRONG : Ui.SURFACE_HOVER);
		Ui.rect(g, x, y, w, 16, 8, fill);
		Ui.text(g, label, x + (w - Ui.width(label, Ui.Font.SMALL)) / 2, y + 4, primary ? 0xFFFFFFFF : Ui.TEXT, Ui.Font.SMALL);
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		long now = System.nanoTime();
		frameDt = Math.min((now - lastFrame) / 1_000_000_000f, 0.1f);
		lastFrame = now;
		capeHoverShown = capeHover;
		capeHover = NO_HOVER;
		cosmeticHoverShown = cosmeticHover;
		cosmeticHover = NO_HOVER;
		layout();

		// Tastatur: solange ein Ziel gewählt ist, zeigen Hover und Tooltips dort statt an der Maus; Mausbewegung beendet das
		if (!Double.isNaN(lastMouseX) && (Math.abs(mouseX - lastMouseX) > 1 || Math.abs(mouseY - lastMouseY) > 1)) keyMode = false;
		lastMouseX = mouseX;
		lastMouseY = mouseY;
		float[] focus = keyMode ? focusOnScreen() : null;
		if (focus != null) {
			mouseX = Math.round(focus[0] + focus[2] / 2);
			mouseY = Math.round(focus[1] + focus[3] / 2);
		}

		g.enableScissor(bodyX - 2, bodyY, bodyX + bodyW + 2, bodyY + bodyH);
		// offenes Rechtsklick-Menü: darunter nichts hervorheben
		boolean inBody = Ui.inside(mouseX, mouseY, bodyX, bodyY, bodyW, bodyH) && !menu.isOpen();
		collecting.clear();
		collectingKeys.clear();
		Ui.collectTargets(collecting);
		int y = bodyY - (int) scroll;
		if (pageInput != null) {
			pageInput.visible = false;
			pageButton.visible = false;
		}
		// Textfelder der Einstellungen zeigt erst ihre Zeile (beim Zeichnen) wieder
		for (SearchField field : textFields.values()) field.visible = false;
		settingCenters.clear();
		for (Row row : rows) {
			int h = row.height(bodyW);
			if (row == inputRow && pageInput != null) {
				int bw = pageButton.getWidth();
				boolean inside = y >= bodyY && y + 21 <= bodyY + bodyH;
				pageButton.setX(bodyX + bodyW - bw);
				pageButton.setY(y + 1);
				pageInput.setX(bodyX);
				pageInput.setY(y + 1);
				pageInput.setWidth(bodyW - bw - 6);
				pageInput.visible = inside;
				pageButton.visible = inside;
			}
			if (y + h >= bodyY && y <= bodyY + bodyH) row.draw(g, bodyX, y, bodyW, mouseX, inBody ? mouseY : -1000);
			y += h + row.gapAfter();
		}
		Ui.collectTargets(null);
		frameTargets = List.copyOf(collecting);
		frameKeyTargets = List.copyOf(collectingKeys);
		drawHighlight(g);
		g.disableScissor();
		Ui.scrollbar(g, bodyX + bodyW + 4, bodyY, bodyH, scroll, maxScroll());
		if (keyMode) drawKeyFocus(g);
		if (openChat != null) drawChatExtras(g, mouseX, mouseY);
		if (pendingMoveX != 0 || pendingMoveY != 0) {
			int dx = pendingMoveX;
			int dy = pendingMoveY;
			pendingMoveX = 0;
			pendingMoveY = 0;
			moveFocus(dx, dy);
		}
	}

	/** Hervorhebung aus der Schnellsuche: pulsiert zweimal und blendet aus */
	private void drawHighlight(GuiGraphicsExtractor g) {
		if (highlight == null || highlightScroll) return;
		float t = (System.nanoTime() - highlightAt) / 1_000_000_000f;
		if (t > 2.6f) return;
		int[] r = highlightRect();
		if (r == null) return;
		float x = bodyX + r[0];
		float y = bodyY - (float) scroll + r[1];
		float pulse = 0.5f + 0.5f * (float) Math.cos(t * Math.PI * 2 / 1.3);
		float alpha = Math.min(1f, (2.6f - t) / 0.6f);
		Ui.rect(g, x, y, r[2], r[3], 9, Ui.withAlpha(0x403B82F6, alpha * (0.35f + 0.65f * pulse)));
		Ui.outline(g, x, y, r[2], r[3], 9, Ui.withAlpha(Ui.ACCENT, alpha));
	}

	/** Fokusrahmen um das gewählte Ziel; folgt kleinen Verschiebungen (Animationen, neu aufgebaute Zeilen) */
	private void drawKeyFocus(GuiGraphicsExtractor g) {
		float[] f = focusOnScreen();
		if (f == null) return;
		float[] near = null;
		float best = 16;
		for (float[] t : allTargets()) {
			if (Math.abs(t[2] - f[2]) > 1.5f || Math.abs(t[3] - f[3]) > 1.5f) continue;
			float d = Math.abs(t[0] - f[0]) + Math.abs(t[1] - f[1]);
			if (d < best) {
				best = d;
				near = t;
			}
		}
		if (near != null) {
			keyFocus = new float[] {near[0], near[1] + (float) scroll, near[2], near[3]};
			f = near;
		}
		g.enableScissor(bodyX - 5, bodyY - 3, bodyX + bodyW + 5, bodyY + bodyH + 3);
		Ui.focusRing(g, f[0], f[1], f[2], f[3], Math.min(9, f[3] / 2f), 1f);
		g.disableScissor();
	}

	/** Liste der Unterhaltungen links (breite Fenster), „Neue Nachricht ↓“, Zeichenzähler */
	private void drawChatExtras(GuiGraphicsExtractor g, int mouseX, int mouseY) {
		int count = Messages.history(openChat).size();
		if (chatFromBottom < 2) seenMessages = count;
		if (chatSplit()) drawChatList(g, mouseX, mouseY);
		// Knopf zum Ende des Chats, wenn hochgescrollt
		if (chatFromBottom > 30) {
			boolean fresh = count > seenMessages;
			String label = fresh ? "Neue Nachricht" : null;
			int[] b = downButton();
			boolean over = Ui.inside(mouseX, mouseY, b[0], b[1], b[2], b[3]);
			Ui.shadow(g, b[0], b[1], b[2], b[3], 0.4f);
			Ui.rect(g, b[0], b[1], b[2], b[3], b[3] / 2f, fresh ? (over ? Ui.ACCENT_HOVER : Ui.ACCENT) : (over ? 0xFF2A3244 : 0xFF202736));
			if (label != null) Ui.text(g, label, b[0] + 10, b[1] + 6, 0xFFFFFFFF, Ui.Font.SMALL);
			Ui.icon(g, "chevron-down", b[0] + b[2] - 16, b[1] + 5, 10, fresh ? 0xFFFFFFFF : Ui.TEXT);
		}
		// Antwort: Leiste mit dem Bezug über der Eingabe, × bricht ab
		if (replyTo != null && chatInput != null) {
			int[] r = replyBar();
			Ui.rect(g, r[0], r[1], r[2], r[3], 6, Ui.SURFACE);
			Ui.rect(g, r[0] + 4, r[1] + 3, 2, r[3] - 6, 1, Ui.ACCENT);
			Social.Friend friend = friendOf(replyTo.from());
			String who = replyTo.mine() ? "dich" : friend != null ? friend.shownName() : openChatName;
			String label = "Antwort an " + who + ": " + Messages.clean(replyTo.text()).replaceAll("\\s+", " ");
			Ui.text(g, Ui.ellipsize(label, r[2] - 34, Ui.Font.SMALL), r[0] + 11, r[1] + 4, Ui.MUTED, Ui.Font.SMALL);
			boolean over = Ui.inside(mouseX, mouseY, r[0] + r[2] - 18, r[1], 18, r[3]);
			Ui.icon(g, "close", r[0] + r[2] - 13, r[1] + 3, 9, over ? Ui.TEXT : Ui.FAINT);
			if (over) Ui.requestTooltip("Antwort abbrechen", mouseX, mouseY);
		}
		// Zeichenzähler kurz vor der Grenze
		if (chatText.length() >= Messages.MAX_LENGTH - 100 && chatInput != null) {
			String counter = chatText.length() + "/" + Messages.MAX_LENGTH;
			Ui.textRight(g, counter, chatInput.getX() + chatInput.getWidth() - 4, chatInput.getY() - 10,
					chatText.length() >= Messages.MAX_LENGTH ? Ui.WARNING : Ui.FAINT, Ui.Font.SMALL);
		}
	}

	/** {x, y, Breite, Höhe} der Leiste „Antwort an …“ über der Eingabe */
	private int[] replyBar() {
		return new int[] {chatX(), contentY + contentH - 20 - 18, chatW(), 15};
	}

	/** {x, y, Breite, Höhe} des Knopfs „nach unten“ */
	private int[] downButton() {
		boolean fresh = Messages.history(openChat).size() > seenMessages;
		int w = fresh ? Ui.width("Neue Nachricht", Ui.Font.SMALL) + 34 : 22;
		return new int[] {bodyX + bodyW - w - 4, bodyY + bodyH - 26, w, 20};
	}

	/** Einträge der Liste links: Unterhaltungen, dann Freunde ohne Unterhaltung */
	private List<UUID[]> chatListEntries() {
		List<UUID[]> entries = new ArrayList<>();
		Set<UUID> seen = new java.util.HashSet<>();
		for (Messages.Conversation c : Messages.conversations()) {
			entries.add(new UUID[] {c.uuid()});
			seen.add(c.uuid());
		}
		for (Social.Friend friend : sortedFriends()) if (seen.add(friend.uuid())) entries.add(new UUID[] {friend.uuid()});
		return entries;
	}

	private void drawChatList(GuiGraphicsExtractor g, int mouseX, int mouseY) {
		int x = contentX;
		int w = chatListW();
		int y = contentY;
		int h = contentH;
		Ui.rect(g, x, y, w, h, 10, Ui.SURFACE);
		Ui.outline(g, x, y, w, h, 10, Ui.LINE);
		Ui.text(g, "UNTERHALTUNGEN", x + 10, y + 9, Ui.FAINT, Ui.Font.SMALL);
		List<UUID[]> entries = chatListEntries();
		int top = y + 24;
		int room = h - 28;
		double max = Math.max(0, entries.size() * LIST_ITEM - room);
		listScroll = Math.clamp(listScroll, 0, max);
		g.enableScissor(x + 1, top, x + w - 1, top + room);
		int iy = top - (int) listScroll;
		Map<UUID, Messages.Conversation> byUuid = new HashMap<>();
		for (Messages.Conversation c : Messages.conversations()) byUuid.put(c.uuid(), c);
		for (UUID[] entry : entries) {
			UUID uuid = entry[0];
			if (iy + LIST_ITEM >= top && iy <= top + room) {
				Social.Friend friend = friendOf(uuid);
				Messages.Conversation conversation = byUuid.get(uuid);
				String name = friend != null ? friend.shownName() : conversation != null ? conversation.name() : "?";
				boolean selected = uuid.equals(openChat);
				boolean over = Ui.inside(mouseX, mouseY, x + 4, iy, w - 8, LIST_ITEM - 2) && mouseY >= top && mouseY < top + room;
				if (selected) Ui.rect(g, x + 4, iy, w - 8, LIST_ITEM - 2, 7, Ui.ACCENT_SOFT);
				else if (over) Ui.rect(g, x + 4, iy, w - 8, LIST_ITEM - 2, 7, Ui.SURFACE_HOVER);
				FriendWidget.face(g, uuid, name, x + 10, iy + 7, 16, friend != null && friend.online() ? 1f : 0.55f);
				if (friend != null && friend.online()) {
					Ui.circle(g, x + 26, iy + 23, 3.5f, 0xFF161C28);
					Ui.circle(g, x + 26, iy + 23, 2.5f, Ui.SUCCESS);
				}
				int unread = selected ? 0 : Messages.unread(uuid);
				int textW = w - 44 - (unread > 0 ? 18 : 0);
				Ui.text(g, Ui.ellipsize(name, textW, Ui.Font.LABEL), x + 34, iy + 6, selected ? Ui.TEXT : Ui.TEXT, Ui.Font.LABEL);
				String preview = conversation != null ? (conversation.last().mine() ? "Du: " : "") + Messages.clean(conversation.last().text())
						: friend != null ? friend.activity() : "";
				Ui.text(g, Ui.ellipsize(preview, textW, Ui.Font.SMALL), x + 34, iy + 18, unread > 0 ? Ui.TEXT : Ui.FAINT, Ui.Font.SMALL);
				if (unread > 0) {
					String label = Integer.toString(Math.min(unread, 99));
					int bw = Math.max(12, Ui.width(label, Ui.Font.SMALL) + 7);
					Ui.rect(g, x + w - 12 - bw, iy + 10, bw, 11, 5.5f, Ui.ACCENT);
					Ui.textCentered(g, label, x + w - 12 - bw / 2, iy + 12, 0xFFFFFFFF, Ui.Font.SMALL);
				}
			}
			iy += LIST_ITEM;
		}
		g.disableScissor();
		if (entries.isEmpty()) Ui.text(g, "Noch keine Freunde", x + 10, top + 6, Ui.MUTED, Ui.Font.SMALL);
	}

	/** Klick in die Liste links: anderen Chat öffnen */
	private boolean clickChatList(double mx, double my) {
		int x = contentX;
		int w = chatListW();
		int top = contentY + 24;
		int room = contentH - 28;
		if (!Ui.inside(mx, my, x, top, w, room)) return false;
		int index = (int) ((my - top + listScroll) / LIST_ITEM);
		List<UUID[]> entries = chatListEntries();
		if (index < 0 || index >= entries.size()) return true;
		UUID uuid = entries.get(index)[0];
		if (uuid.equals(openChat)) return true;
		Social.Friend friend = friendOf(uuid);
		String name = friend != null ? friend.name() : "?";
		for (Messages.Conversation c : Messages.conversations()) if (c.uuid().equals(uuid)) name = c.name();
		click();
		Messages.setViewing(null);
		openChat(uuid, name);
		return true;
	}

	/** Weicher Übergang zum Zielwert (für Schalter und Hover). */
	private float animate(Object key, float target) {
		float value = anim.getOrDefault(key, target);
		value += (target - value) * Math.min(1f, frameDt * 16f);
		if (Math.abs(target - value) < 0.002f) value = target;
		anim.put(key, value);
		return value;
	}

	private void click() {
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	// ======================================================================================
	// Tasten umbelegen (Einstellung „Taste“)
	// ======================================================================================

	private String keyText(Setting.Key key) {
		if (key.mapping() == keyCapture) return "Taste drücken …";
		return key.mapping().isUnbound() ? "Nicht belegt" : key.mapping().getTranslatedKeyMessage().getString();
	}

	private static String defaultKeyText(KeyMapping mapping) {
		InputConstants.Key key = mapping.getDefaultKey();
		return key.equals(InputConstants.UNKNOWN) ? "nicht belegt" : key.getDisplayName().getString();
	}

	/** Name einer anderen Belegung mit derselben Taste, sonst null */
	private String keyConflict(KeyMapping mapping) {
		if (mapping.isUnbound()) return null;
		for (KeyMapping other : minecraft.options.keyMappings) {
			if (other == mapping || !other.same(mapping)) continue;
			// gewollt: das Spielermenü teilt sich die Taste mit „Block auswählen“ (wirkt nur auf Spielern)
			if (mapping == HeldixClient.playerMenuKey && other == minecraft.options.keyPickItem
					|| other == HeldixClient.playerMenuKey && mapping == minecraft.options.keyPickItem) continue;
			return Component.translatable(other.getName()).getString();
		}
		return null;
	}

	/** Neue Taste übernehmen und wie Minecraft in options.txt speichern */
	private void bindKey(KeyMapping mapping, InputConstants.Key key) {
		mapping.setKey(key);
		KeyMapping.resetMapping();
		minecraft.options.save();
		keyCapture = null;
		click();
	}

	/** Für den Autotest: wartet gerade eine Taste auf einen Tastendruck? */
	public boolean capturingKey() {
		return keyCapture != null;
	}

	/** Für den Autotest: Mitte des Tasten-Chips einer Einstellung bzw. ihres Knopfs „Standard“ (Beschriftung + "#reset") */
	public int[] keyChipCenter(String label) {
		return settingCenters.get(label);
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	private void openSubmenu(Module module) {
		openModule = module;
		colorOpen = null;
		scroll = 0;
		rebuildWidgets();
	}

	private void closeSubmenu() {
		if (directSubmenu) {
			onClose();
			return;
		}
		openModule = null;
		colorOpen = null;
		scroll = 0;
		rebuildWidgets();
	}

	private void dragTo(double mouseX) {
		if (dragging == null) return;
		double t = Math.clamp((mouseX - dragX) / Math.max(1, dragW), 0, 1);
		double value = dragging.snap(dragging.min() + t * (dragging.max() - dragging.min()));
		if (value != dragging.get().getAsDouble()) dragging.set().accept(value);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (menu.isOpen()) return menu.mouseScrolled(mouseX, mouseY, scrollY);
		if (chatSplit() && Ui.inside(mouseX, mouseY, contentX, contentY, chatListW(), contentH)) {
			listScroll = Math.max(0, listScroll - scrollY * 20);
			return true;
		}
		if (maxScroll() > 0) {
			scroll = Math.clamp(scroll - scrollY * 20, 0, maxScroll());
			if (openChat != null) chatFromBottom = maxScroll() - scroll;
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public void mouseMoved(double mouseX, double mouseY) {
		if (menu.isOpen()) menu.mouseMoved(mouseX, mouseY);
		super.mouseMoved(mouseX, mouseY);
	}

	/** Rechtsklick-Menü im Heldix-Design (über allem, auch über den Widgets) */
	@Override
	protected void drawOverlay(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		super.drawOverlay(g, mouseX, mouseY, delta);
		menu.render(g, mouseX, mouseY);
	}

	/** Für den Autotest: Einträge des offenen Rechtsklick-Menüs (oberste Ebene), leer = keins offen */
	public List<String> menuLabels() {
		return menu.isOpen() ? menu.labels(0) : List.of();
	}

	/** Für den Autotest: Mitte eines Eintrags im offenen Rechtsklick-Menü (Ebene 0), null = nicht da */
	public int[] menuEntryCenter(String label) {
		return menu.isOpen() ? menu.rowCenter(0, label) : null;
	}

	/** Für den Autotest: Mitte eines Knopfs aus dem letzten Bild (z. B. "party-accept:<id>", "profile:Nachricht"), null = nicht zu sehen */
	public int[] targetCenter(String key) {
		return settingCenters.get(key);
	}

	/**
	 * Für den Autotest: so scrollen, dass die Zeile dieses Spielers (Freund, Party-Mitglied, Einladen, Vorschlag) zu sehen
	 * ist; die Knopf-Mitten stehen ab dem nächsten Bild in {@link #targetCenter}
	 */
	public void scrollToPlayer(String name) {
		layout();
		java.util.function.Predicate<Row> match = row -> switch (row) {
			case FriendRow r -> r.friend.name().equals(name);
			case PartyMemberRow r -> r.member.name().equals(name);
			case PartyInviteFriendRow r -> r.friend.name().equals(name);
			case SuggestionRow r -> r.name.equals(name);
			default -> false;
		};
		int y = 0;
		for (Row row : rows) {
			int[] found = row.find(match, bodyW);
			if (found != null) {
				scroll = Math.clamp(y + found[1] - (bodyH - found[3]) / 2.0, 0, maxScroll());
				return;
			}
			y += row.height(bodyW) + row.gapAfter();
		}
	}

	/** Für den Autotest: offene Profilkarte (null = keine) */
	public UUID openProfileId() {
		return openProfile;
	}

	/** Für den Autotest: Rechtsklick-Menü eines Freundes öffnen (wie ein Rechtsklick auf seine Zeile) */
	public boolean openFriendMenuFor(UUID friend) {
		Social.Friend found = friendOf(friend);
		if (found == null) return false;
		openFriendMenu(found, width / 2 - 60, height / 3);
		return true;
	}

	/** Für den Autotest: auf diese Nachricht antworten bzw. Leiste „Antwort an …“ offen? */
	public void replyToMessage(long id) {
		if (openChat != null) startReply(Messages.find(openChat, id));
	}

	public boolean replying() {
		return replyTo != null;
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		// Rechtsklick-Menü offen: jeder Klick gehört ihm (daneben schließt es)
		if (menu.isOpen()) {
			menu.mouseClicked(event.x(), event.y());
			return true;
		}
		// wartet eine Taste: Mausrad- und Seitentasten werden zur Belegung, Links- und Rechtsklick brechen ab
		if (keyCapture != null && event.button() != InputConstants.MOUSE_BUTTON_LEFT && event.button() != InputConstants.MOUSE_BUTTON_RIGHT) {
			bindKey(keyCapture, InputConstants.Type.MOUSE.getOrCreate(event.button()));
			return true;
		}
		captureCancelled = null;
		if (keyCapture != null) {
			// Links- oder Rechtsklick beendet das Warten; ein Klick auf denselben Chip startet es nicht neu
			captureCancelled = keyCapture;
			keyCapture = null;
			if (event.button() == InputConstants.MOUSE_BUTTON_RIGHT) return true;
		}
		if (super.mouseClicked(event, doubleClick)) return true;
		if (search != null && !search.isMouseOver(event.x(), event.y())) {
			search.setFocused(false);
			if (getFocused() == search) setFocused(null);
		}
		if (pageInput != null && !pageInput.isMouseOver(event.x(), event.y())) {
			pageInput.setFocused(false);
			if (getFocused() == pageInput) setFocused(null);
		}
		for (SearchField field : textFields.values()) {
			if (field.isFocused() && !(field.visible && field.isMouseOver(event.x(), event.y()))) {
				field.setFocused(false);
				if (getFocused() == field) setFocused(null);
			}
		}
		layout();
		double mx = event.x();
		double my = event.y();
		// Rechtsklick in den Inhalt: Zeile entscheidet (Nachricht: Menü bzw. kopieren, Freund: Aktionen)
		if (event.button() == InputConstants.MOUSE_BUTTON_RIGHT && Ui.inside(mx, my, bodyX, bodyY, bodyW, bodyH)) {
			int ry = bodyY - (int) scroll;
			for (Row row : rows) {
				int h = row.height(bodyW);
				if (my >= ry && my < ry + h && row.secondaryClick(mx, my, bodyX, ry, bodyW)) return true;
				ry += h + row.gapAfter();
			}
			return false;
		}
		if (event.button() != InputConstants.MOUSE_BUTTON_LEFT) return false;
		if (openChat != null) {
			if (replyTo != null) {
				int[] r = replyBar();
				if (Ui.inside(mx, my, r[0] + r[2] - 18, r[1], 18, r[3])) {
					click();
					replyTo = null;
					return true;
				}
			}
			if (chatSplit() && clickChatList(mx, my)) return true;
			if (chatFromBottom > 30) {
				int[] b = downButton();
				if (Ui.inside(mx, my, b[0], b[1], b[2], b[3])) {
					click();
					chatFromBottom = 0;
					return true;
				}
			}
		}
		if (Ui.inside(mx, my, bodyX, bodyY, bodyW, bodyH)) {
			int y = bodyY - (int) scroll;
			for (Row row : rows) {
				int h = row.height(bodyW);
				if (my >= y && my < y + h && row.click(mx, my, bodyX, y, bodyW)) return true;
				y += h + row.gapAfter();
			}
		}
		return false;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
		if (dragging != null) {
			dragTo(event.x());
			return true;
		}
		return super.mouseDragged(event, dragX, dragY);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		if (dragging != null) {
			dragging = null;
			HeldixConfig.save();
			return true;
		}
		return super.mouseReleased(event);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		// Rechtsklick-Menü offen: Pfeile, Enter, Esc gehören ihm
		if (menu.isOpen() && menu.keyPressed(event.key())) return true;
		// eine Taste wartet auf ihre neue Belegung: jeder Tastendruck gehört ihr (Esc bricht ab, Entf/Rücktaste = keine)
		if (keyCapture != null) {
			int key = event.key();
			if (key == InputConstants.KEY_ESCAPE) keyCapture = null;
			else if (key == InputConstants.KEY_BACKSPACE || key == InputConstants.KEY_DELETE) bindKey(keyCapture, InputConstants.UNKNOWN);
			else bindKey(keyCapture, InputConstants.getKey(event));
			return true;
		}
		boolean typing = (search != null && search.isFocused()) || (pageInput != null && pageInput.isFocused()) || (chatInput != null && chatInput.isFocused())
				|| textFields.values().stream().anyMatch(SearchField::isFocused);
		if (!typing && HeldixClient.menuKey.matches(event)) {
			onClose();
			return true;
		}
		if (!typing && openModule != null && event.key() == InputConstants.KEY_BACKSPACE) {
			closeSubmenu();
			return true;
		}
		if (!typing && openChat != null && event.key() == InputConstants.KEY_BACKSPACE) {
			closeChat();
			return true;
		}
		// Esc beim Antworten: erst die Antwort abbrechen
		if (openChat != null && replyTo != null && event.key() == InputConstants.KEY_ESCAPE) {
			replyTo = null;
			return true;
		}
		if (!typing && openProfile != null && event.key() == InputConstants.KEY_BACKSPACE) {
			closeProfile();
			return true;
		}
		if (!typing && openChat == null && !event.hasControlDown() && !event.hasAltDown() && contentKey(event)) return true;
		return super.keyPressed(event);
	}

	/**
	 * Tastatur im Inhalt: Pfeile wählen Kacheln, Zeilen und Knöpfe (am Rand wird gescrollt), Enter/Leertaste löst aus,
	 * Pfeil links/rechts ändert Regler und Auswahlen. Tab bleibt bei den Widgets (Leisten, Reiter, Knöpfe); von dort
	 * führt Pfeil runter in den Inhalt, vom obersten Ziel Pfeil hoch zurück.
	 */
	private boolean contentKey(KeyEvent event) {
		int key = event.key();
		if (key == InputConstants.KEY_TAB) {
			keyMode = false;
			keyFocus = null;
			return false;
		}
		int dx = event.isLeft() ? -1 : event.isRight() ? 1 : 0;
		int dy = event.isUp() ? -1 : event.isDown() ? 1 : 0;
		if (dx != 0 || dy != 0) {
			if (widgetKeyFocus() && !keyMode) {
				// erst zwischen den Widgets; geht es dort nicht weiter nach unten, in den Inhalt
				var before = getFocused();
				super.keyPressed(event);
				if (dy > 0 && getFocused() == before) {
					setFocused(null);
					moveFocus(0, 1);
					return true;
				}
				return true;
			}
			KeyTarget own = keyMode ? focusedKeyTarget() : null;
			if (dx != 0 && own != null && own.adjust() != null) {
				own.adjust().accept(dx);
				return true;
			}
			setFocused(null);
			moveFocus(dx, dy);
			return true;
		}
		if (keyMode && keyFocus != null && (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER || key == InputConstants.KEY_SPACE)) {
			activateFocus();
			return true;
		}
		if (getFocused() == null || keyMode) {
			double page = Math.max(40, bodyH * 0.8);
			double target = switch (key) {
				case InputConstants.KEY_PAGEDOWN -> scroll + page;
				case InputConstants.KEY_PAGEUP -> scroll - page;
				case InputConstants.KEY_HOME -> 0;
				case InputConstants.KEY_END -> maxScroll();
				default -> Double.NaN;
			};
			if (!Double.isNaN(target)) {
				scroll = Math.clamp(target, 0, maxScroll());
				keyMode = false;
				return true;
			}
		}
		return false;
	}

	/** Bilder ins Fenster gezogen: auf der Seite Cape als eigenes Cape übernehmen */
	@Override
	public void onFilesDrop(List<java.nio.file.Path> files) {
		if (page != Shell.Page.CAPE || openModule != null) {
			super.onFilesDrop(files);
			return;
		}
		Capes.Cape cape = Capes.importFiles(files);
		capeTab = CapeTab.CUSTOM;
		if (cape != null) {
			Capes.select(cape);
			capeMessage = "„" + cape.name() + "“ hinzugefügt und angelegt";
			capeMessageOk = true;
		} else {
			capeMessage = "Nur PNG-Bilder lassen sich als Cape übernehmen";
			capeMessageOk = false;
		}
		capeMessageAt = System.currentTimeMillis();
	}

	/** Beim Verlassen der Cape-Seite nur das gewählte Cape im Grafikspeicher behalten */
	@Override
	public void removed() {
		super.removed();
		keyCapture = null;
		menu.close();
		if (openChat != null) Messages.setViewing(null);
		if (page == Shell.Page.PARTY) Party.setViewingChat(false);
		saveProfileDrafts();
		if (page == Shell.Page.CAPE) Capes.trim();
	}

	@Override
	public void onClose() {
		HeldixConfig.save();
		if (parent != null) minecraft.gui.setScreen(parent);
		else Shell.close(minecraft);
	}
}
