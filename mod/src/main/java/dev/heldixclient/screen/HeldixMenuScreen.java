package dev.heldixclient.screen;

import com.mojang.blaze3d.Blaze3D;
import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.device.GpuDevice;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
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
import dev.heldixclient.social.Social;
import dev.heldixclient.waypoint.Waypoints;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
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
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.DoubleSupplier;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

/**
 * Heldix-Bereiche der gemeinsamen Oberfläche: Module, Shader, Leistung, Addons und Einstellungen.
 * Module erscheinen als Kacheln mit Icon; das Regler-Symbol öffnet die Einstellungen eines Moduls.
 * Im Spiel öffnet die Rechte Umschalttaste diese Seite.
 */
public class HeldixMenuScreen extends ShellScreen {
	private static final int GAP = 8;
	private static final int TILE_H = 66;
	private static final int TILE_MIN_W = 118;
	private static final int CHIP_H = 22;
	private static final int ADDON_H = 46;

	/** Filter auf der Seite Module */
	private enum Filter {
		ALL("Alle"),
		HUD("HUD"),
		FEATURES("Funktionen"),
		ADDONS("Addons");

		final String label;

		Filter(String label) {
			this.label = label;
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
	private List<Row> rows = List.of();

	private Setting.Slider dragging;
	private float dragX;
	private float dragW;

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

	private int bodyX;
	private int bodyW;
	private int bodyY;
	private int bodyH;

	public HeldixMenuScreen(Screen parent) {
		this(parent, Shell.Page.MODULES);
	}

	public HeldixMenuScreen(Screen parent, Shell.Page page) {
		this(parent, page, null);
	}

	/** Mit geöffnetem Untermenü eines Moduls (z. B. aus dem HUD-Editor per Rechtsklick). */
	public HeldixMenuScreen(Screen parent, Shell.Page page, Module module) {
		super(Component.literal(page.label), page);
		this.parent = parent;
		this.openModule = module;
		this.directSubmenu = module != null;
	}

	// ======================================================================================
	// Layout
	// ======================================================================================

	private void layout() {
		bodyX = contentX;
		bodyW = contentW - 8;
		bodyY = contentY;
		bodyH = contentH;
		rows = buildRows();
		scroll = Math.clamp(scroll, 0, maxScroll());
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

	/** Mitte eines Eintrags der Seitenleiste (MODULES, SHADER, PERFORMANCE, ADDONS, SETTINGS; INFO = SETTINGS). */
	public int[] tabCenter(String name) {
		Shell.Page target = name.equals("INFO") ? Shell.Page.SETTINGS : Shell.Page.valueOf(name);
		for (ShellNavButton button : nav) {
			if (button.page() == target) return new int[] {button.getX() + button.getWidth() / 2, button.getY() + button.getHeight() / 2};
		}
		throw new IllegalStateException("Kein Eintrag " + name + " in der Seitenleiste");
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

	/** ID des Moduls, dessen Untermenü offen ist (null = keins). */
	public String openModuleId() {
		return openModule == null ? null : openModule.id();
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

	@Override
	protected void initContent() {
		layout();
		search = null;
		pageInput = null;
		pageButton = null;
		if (openModule != null) {
			String back = "Zurück";
			int w = ActionButton.widthFor(back, "back");
			addRenderableWidget(new ActionButton(headerRight() - w, headerButtonY(), w, 20, back, false, this::closeSubmenu).withIcon("back"));
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
		} else if (page == Shell.Page.FRIENDS && Social.state() != Social.State.DISABLED && Social.state() != Social.State.OFFLINE_ACCOUNT
				&& Social.state() != Social.State.OFF) {
			addPageInput("Anfrage senden", "user-plus", "Spielername", "user", this::sendFriendRequest);
		} else if (page == Shell.Page.WAYPOINTS && minecraft.level != null) {
			addPageInput("Hier setzen", "plus", "Name (optional)", "pin", this::addWaypointHere);
		}
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
			return 8;
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
	protected Component headerTitle() {
		return openModule != null ? Component.literal(openModule.name()) : super.headerTitle();
	}

	@Override
	protected String headerIcon() {
		return openModule != null ? openModule.icon() : super.headerIcon();
	}

	@Override
	protected String subtitle() {
		if (openModule != null) return openModule.source() != null ? "Addon: " + openModule.source() : "Einstellungen des Moduls";
		return switch (page) {
			case MODULES -> {
				long on = ModuleManager.all().stream().filter(Module::isEnabled).count();
				yield on + " von " + ModuleManager.all().size() + " Modulen aktiv";
			}
			case CAPE -> "Dein Cape in der Third-Person-Ansicht (F5)";
			case FRIENDS -> switch (Social.state()) {
				case ONLINE -> {
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
			case ADDONS -> AddonManager.addons().size() + (AddonManager.addons().size() == 1 ? " Addon installiert" : " Addons installiert");
			case SETTINGS -> "Design, HUD, Tasten und Versionen";
			default -> null;
		};
	}

	private List<Row> buildRows() {
		List<Row> list = new ArrayList<>();
		if (openModule != null) {
			list.add(new ModuleHeader(openModule));
			List<Setting> settings = openModule.settings();
			if (!settings.isEmpty()) list.add(new Section("Einstellungen", null));
			for (Setting setting : settings) list.add(new SettingRow(setting));
			return list;
		}
		switch (page) {
			case MODULES -> {
				boolean anyAddon = ModuleManager.all().stream().anyMatch(m -> m.source() != null);
				List<Filter> filters = new ArrayList<>(List.of(Filter.ALL, Filter.HUD, Filter.FEATURES));
				if (anyAddon) filters.add(Filter.ADDONS);
				if (!filters.contains(filter)) filter = Filter.ALL;
				list.add(new Filters(filters));
				List<Module> modules = new ArrayList<>();
				String query = searchText.trim().toLowerCase(Locale.ROOT);
				for (Module module : ModuleManager.all()) {
					if (!filter.matches(module)) continue;
					if (query.isEmpty() || module.name().toLowerCase(Locale.ROOT).contains(query)
							|| module.description().toLowerCase(Locale.ROOT).contains(query)) {
						modules.add(module);
					}
				}
				if (modules.isEmpty()) list.add(new Text(query.isEmpty() ? "Keine Module in diesem Bereich." : "Kein Modul passt zu „" + searchText.trim() + "“.", Ui.MUTED));
				else list.add(new ModuleGrid(modules));
			}
			case CAPE -> buildCapeRows(list);
			case FRIENDS -> buildFriendRows(list);
			case WAYPOINTS -> buildWaypointRows(list);
			case SHADER -> buildShaderRows(list);
			case PERFORMANCE -> buildPerformanceRows(list);
			case ADDONS -> buildAddonRows(list);
			case SETTINGS -> {
				buildSettingsRows(list);
				buildInfoRows(list);
			}
			default -> {
			}
		}
		return list;
	}

	/** Seite Cape: großer Vorschau-Bereich, Auswahl der Heldix-Capes und eigener Bilder */
	private void buildCapeRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new CapeShowcase());
		list.add(new Section("Heldix-Capes", Capes.builtin().size() + " Motive"));
		List<Object> builtin = new ArrayList<>();
		builtin.add(NO_CAPE);
		builtin.addAll(Capes.builtin());
		list.add(new CapeGrid(builtin));

		List<Capes.Cape> custom = Capes.custom();
		list.add(new Section("Eigene Capes", custom.isEmpty() ? null : custom.size() + (custom.size() == 1 ? " Bild" : " Bilder")));
		if (capeMessage != null && System.currentTimeMillis() - capeMessageAt < 8000) {
			list.add(new Notice(capeMessageOk ? "check" : "warning", capeMessage, capeMessageOk ? Ui.SUCCESS : Ui.WARNING));
		}
		if (!custom.isEmpty()) list.add(new CapeGrid(new ArrayList<>(custom)));
		list.add(new Text("Zieh ein PNG-Bild ins Fenster oder leg es in den Ordner " + Capes.DIRECTORY
				+ ". Cape-Vorlagen (64 × 32 oder größer im selben Format) werden direkt übernommen, andere Bilder kommen auf die Rückseite.", Ui.MUTED));
		list.add(new SettingRow(new Setting.Action("Ordner " + Capes.DIRECTORY, "Im Spielordner dieser Instanz", "Öffnen", () -> {
			try {
				java.nio.file.Files.createDirectories(Capes.directory());
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Cape-Ordner nicht anlegbar", e);
			}
			Blaze3D.openPath(Capes.directory());
		})));
		list.add(new SettingRow(new Setting.Action("Neu einlesen", "Nach dem Hinzufügen oder Löschen von Bildern", "Aktualisieren", () -> {
			Capes.reloadCustom();
			int count = Capes.custom().size();
			capeMessage = count == 0 ? "Keine Bilder im Ordner gefunden" : count + (count == 1 ? " eigenes Cape gefunden" : " eigene Capes gefunden");
			capeMessageOk = count > 0;
			capeMessageAt = System.currentTimeMillis();
		})));

		list.add(new Section("Optionen", null));
		list.add(new SettingRow(configToggle("Wehender Stoff", "Das Cape weht und wirft Wellen wie Stoff, statt als starre Platte zu schwingen (für alle Capes)",
				() -> config.capeCloth, v -> config.capeCloth = v)));
		list.add(new SettingRow(configToggle("Animation", "Die Heldix-Capes bewegen sich (Flammen, Sterne, Polarlicht …)",
				() -> config.capeAnimation, v -> config.capeAnimation = v)));
		list.add(new SettingRow(configToggle("Leuchtende Details", "Funken, Sterne und Neon leuchten auch im Dunkeln",
				() -> config.capeGlow, v -> config.capeGlow = v)));
		list.add(new SettingRow(configToggle("Elytra im Cape-Design", "Die Flügel zeigen dasselbe Motiv wie das Cape",
				() -> config.capeElytra, v -> config.capeElytra = v)));
		String who = Social.state() == Social.State.DISABLED || Social.state() == Social.State.OFFLINE_ACCOUNT || Social.state() == Social.State.OFF
				? "Das Cape siehst nur du, z. B. in der Third-Person-Ansicht (F5) und im Inventar. "
				: "Andere HeldixClient-Spieler sehen dein Heldix-Cape (einstellbar unter Freunde → Privatsphäre); eigene Bilder siehst nur du. ";
		list.add(new Notice("info", who + "Unter Optionen → Skin-Anpassung muss „Umhang“ eingeschaltet sein.", Ui.ACCENT_TEXT));
	}

	/** Seite Freunde: Anfragen, Freunde (online zuerst), gesendete Anfragen und Privatsphäre */
	private void buildFriendRows(List<Row> list) {
		Social.State state = Social.state();
		switch (state) {
			case DISABLED -> {
				list.add(new Notice("info", "Der Heldix-Dienst ist in dieser Installation nicht eingerichtet. Freunde, Capes für andere Spieler "
						+ "und das Heldix-Symbol in der Tab-Liste brauchen ihn.", Ui.ACCENT_TEXT));
				return;
			}
			case OFFLINE_ACCOUNT -> {
				list.add(new Notice("warning", "Freunde gibt es nur mit einem Microsoft-Konto. Mit einem Offline-Konto bleibt der Heldix-Dienst aus.", Ui.WARNING));
				return;
			}
			case OFF -> {
				if (pageMessage != null && System.currentTimeMillis() - pageMessageAt < 8000) {
					list.add(new Notice(pageMessageOk ? "check" : "warning", pageMessage, pageMessageOk ? Ui.SUCCESS : Ui.WARNING));
				}
				list.add(new Notice("info", "Der Heldix-Dienst ist ausgeschaltet: keine Freunde, keine Capes anderer Spieler und kein Heldix-Symbol. "
						+ "Es werden keine Daten an den Dienst geschickt.", Ui.ACCENT_TEXT));
				list.add(new SettingRow(new Setting.Toggle("Heldix-Dienst nutzen", "Freunde, Capes für alle und das Heldix-Symbol in der Tab-Liste",
						() -> HeldixConfig.get().socialEnabled, Social::setEnabled)));
				return;
			}
			case CONNECTING -> list.add(new Notice("refresh", "Verbinde mit dem Heldix-Dienst …", Ui.ACCENT_TEXT));
			case ERROR -> {
				list.add(new Notice("warning", (Social.error() != null ? Social.error() : "Keine Verbindung")
						+ ". HeldixClient versucht es gleich noch einmal.", Ui.WARNING));
				list.add(new SettingRow(new Setting.Action("Verbindung", "Nicht warten, sondern sofort neu verbinden", "Verbinden", Social::connect)));
			}
			case ONLINE -> {
			}
		}
		if (pageInput != null) list.add(inputRow);
		if (pageMessage != null && System.currentTimeMillis() - pageMessageAt < 8000) {
			list.add(new Notice(pageMessageOk ? "check" : "warning", pageMessage, pageMessageOk ? Ui.SUCCESS : Ui.WARNING));
		}
		List<Social.Request> incoming = Social.incoming();
		if (!incoming.isEmpty()) {
			list.add(new Section("Anfragen", Integer.toString(incoming.size())));
			for (Social.Request request : incoming) list.add(new RequestRow(request, true));
		}
		List<Social.Friend> friends = Social.friends();
		List<Social.Friend> online = friends.stream().filter(Social.Friend::online).toList();
		List<Social.Friend> offline = friends.stream().filter(f -> !f.online()).toList();
		if (!online.isEmpty()) {
			list.add(new Section("Online", Integer.toString(online.size())));
			for (Social.Friend friend : online) list.add(new FriendRow(friend));
		}
		if (!offline.isEmpty()) {
			list.add(new Section("Offline", Integer.toString(offline.size())));
			for (Social.Friend friend : offline) list.add(new FriendRow(friend));
		}
		if (friends.isEmpty() && incoming.isEmpty() && state == Social.State.ONLINE) {
			list.add(new Text("Noch keine Freunde. Gib oben den Namen eines Spielers ein und sende eine Anfrage – er muss HeldixClient "
					+ "nutzen und schon einmal damit online gewesen sein.", Ui.MUTED));
		}
		List<Social.Request> outgoing = Social.outgoing();
		if (!outgoing.isEmpty()) {
			list.add(new Section("Gesendet", Integer.toString(outgoing.size())));
			for (Social.Request request : outgoing) list.add(new RequestRow(request, false));
		}

		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new Section("Privatsphäre", null));
		list.add(new SettingRow(socialToggle("Für andere erkennbar", "Heldix-Symbol in der Tab-Liste und dein Heldix-Cape für andere HeldixClient-Spieler",
				() -> config.socialVisible, v -> config.socialVisible = v)));
		list.add(new SettingRow(socialToggle("Online-Status für Freunde", "Freunde sehen, ob du online bist und ob du im Menü oder in einer Welt bist",
				() -> config.socialPresence, v -> config.socialPresence = v)));
		list.add(new SettingRow(socialToggle("Server für Freunde sichtbar", "Freunde sehen, auf welchem Server du spielst (nur öffentliche Adressen)",
				() -> config.socialShowServer, v -> config.socialShowServer = v)));
		list.add(new SettingRow(new Setting.Toggle("Heldix-Dienst nutzen", "Aus: keine Verbindung und keine Daten an den Dienst",
				() -> HeldixConfig.get().socialEnabled, Social::setEnabled)));
		boolean confirming = confirmDeleteAt > 0 && System.currentTimeMillis() - confirmDeleteAt < 5000;
		list.add(new SettingRow(new Setting.Action("Daten beim Dienst löschen", confirming
				? "Wirklich? Freunde, Anfragen und Einstellungen beim Dienst sind danach weg, der Dienst wird ausgeschaltet."
				: "Löscht alles, was der Heldix-Dienst über dich gespeichert hat", confirming ? "Endgültig löschen" : "Löschen", () -> {
			if (System.currentTimeMillis() - confirmDeleteAt < 5000) {
				confirmDeleteAt = 0;
				report(Social.deleteAccount(), "Deine Daten beim Heldix-Dienst sind gelöscht. Der Dienst ist jetzt ausgeschaltet.");
			} else {
				confirmDeleteAt = System.currentTimeMillis();
			}
		})));
		list.add(new Section("Anzeige", null));
		list.add(new SettingRow(configToggle("Einblendungen", "Bei Anfragen und wenn Freunde online kommen",
				() -> config.socialNotifications, v -> config.socialNotifications = v)));
		list.add(new SettingRow(configToggle("Capes anderer Spieler", "Heldix-Capes anderer HeldixClient-Spieler zeigen",
				() -> config.socialCapes, v -> config.socialCapes = v)));
	}

	private Setting.Toggle socialToggle(String label, String description, BooleanSupplier get, Consumer<Boolean> set) {
		return new Setting.Toggle(label, description, get, value -> {
			set.accept(value);
			HeldixConfig.save();
			Social.profileChanged();
		});
	}

	/** Seite Wegpunkte: Wegpunkte der aktuellen Welt, Optionen des Moduls */
	private void buildWaypointRows(List<Row> list) {
		Module module = ModuleManager.waypoints;
		if (minecraft.level == null) {
			list.add(new Notice("info", "Wegpunkte gehören zu einer Welt bzw. einem Server. Betritt eine Welt, um sie zu sehen und zu setzen.", Ui.ACCENT_TEXT));
		} else {
			if (pageInput != null) list.add(inputRow);
			if (pageMessage != null && System.currentTimeMillis() - pageMessageAt < 8000) {
				list.add(new Notice(pageMessageOk ? "check" : "warning", pageMessage, pageMessageOk ? Ui.SUCCESS : Ui.WARNING));
			}
			List<Waypoints.Waypoint> waypoints = Waypoints.current(minecraft);
			list.add(new Section("In dieser Welt", waypoints.isEmpty() ? null : waypoints.size() + (waypoints.size() == 1 ? " Wegpunkt" : " Wegpunkte")));
			if (waypoints.isEmpty()) {
				list.add(new Text("Noch keine Wegpunkte. Oben „Hier setzen“ oder im Spiel die Taste "
						+ HeldixClient.waypointKey.getTranslatedKeyMessage().getString() + " drücken.", Ui.MUTED));
			}
			for (Waypoints.Waypoint waypoint : waypoints) list.add(new WaypointRow(waypoint));
			list.add(new Text("Klick auf den Farbpunkt wechselt die Farbe, das Auge blendet einen Wegpunkt aus.", Ui.FAINT));
		}
		if (module != null) {
			list.add(new Section("Optionen", null));
			list.add(new SettingRow(new Setting.Toggle("Wegpunkte im Spiel", "Markierungen mit Name und Entfernung, auch durch Wände", module::isEnabled, module::setEnabled)));
			for (Setting setting : module.settings()) list.add(new SettingRow(setting));
		}
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
		list.add(new SettingRow(engineSlider("Leuchten (Bloom)", "Helle Stellen strahlen", () -> config.bloom, v -> config.bloom = v)));
		list.add(new SettingRow(engineSlider("Tiefenunschärfe", "Ferne Dinge werden weich", () -> config.depthOfField, v -> config.depthOfField = v)));
		list.add(new SettingRow(engineSlider("Nebel", "Dunst in der Ferne", () -> config.fog, v -> config.fog = v)));
		list.add(new SettingRow(engineSlider("Umgebungsverdeckung", "Schatten in Ecken und Spalten (SSAO)",
				() -> config.ambientOcclusion, v -> config.ambientOcclusion = v)));
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
		list.add(new SettingRow(new Setting.Toggle("FPS-Boost", "Teure Grafik-Effekte aus; ausschalten stellt alles wieder her",
				Performance::boostEnabled, Performance::setBoost)));
		list.add(new SettingRow(configToggle("Hintergrund-FPS", "Weniger Bilder, solange das Fenster nicht aktiv ist",
				() -> config.backgroundFps, v -> config.backgroundFps = v)));
		list.add(new SettingRow(new Setting.Slider("Grenze im Hintergrund", "", 5, 60, 5, () -> config.backgroundFpsLimit, value -> {
			config.backgroundFpsLimit = (int) value;
			HeldixConfig.save();
		}, value -> Math.round(value) + " FPS")));
		list.add(new Section("Grafik", null));
		list.add(new Info("Grafik-API", DebugOverlay.backend()));
		list.add(new Info("Grafikkarte", gpuName()));
		list.add(new Notice("info", "Die Grafik-API stellst du im Launcher um (Einstellungen → Leistung).", Ui.ACCENT_TEXT));
	}

	private void buildAddonRows(List<Row> list) {
		List<LoadedAddon> addons = AddonManager.addons();
		list.add(new Section("Installiert", addons.size() + (addons.size() == 1 ? " Addon" : " Addons")));
		if (addons.isEmpty()) {
			list.add(new Text("Keine Addons installiert. Lege Heldix-Addons (.jar) in den Ordner " + AddonManager.ADDON_DIR
					+ " deiner Instanz oder installiere sie im Launcher.", Ui.MUTED));
		}
		for (LoadedAddon addon : addons) list.add(new AddonCard(addon));
		list.add(new Text("Heldix Loader " + HeldixLoader.version() + "  ·  Addon-API " + HeldixApi.API_VERSION, Ui.FAINT));
	}

	private void buildSettingsRows(List<Row> list) {
		HeldixConfig.Data config = HeldixConfig.get();
		list.add(new Section("Design", null));
		list.add(new SettingRow(configToggle("Heldix-Design für Menüs", "Startseite, Einzel- und Mehrspieler sowie Knöpfe im Heldix-Stil",
				() -> config.customMenus, v -> config.customMenus = v)));
		list.add(new SettingRow(configToggle("Heldix-Hintergrund", "Eigenes Motiv statt des Minecraft-Panoramas",
				() -> config.heldixBackground, v -> config.heldixBackground = v)));
		list.add(new SettingRow(configToggle("Ladebildschirm", "Heldix-Logo statt Mojang beim Laden",
				() -> config.customLoadingScreen, v -> config.customLoadingScreen = v)));
		list.add(new SettingRow(configToggle("F3-Menü im Heldix-Design", "Dunkle Zeilen mit Akzentlinie",
				() -> config.customDebugScreen, v -> config.customDebugScreen = v)));
		list.add(new SettingRow(configToggle("HUD-Hintergrund", "Dunkle Box hinter den HUD-Elementen",
				() -> config.hudBackground, v -> config.hudBackground = v)));
		list.add(new Section("HUD", null));
		list.add(new SettingRow(new Setting.Action("HUD-Editor", "Elemente verschieben, vergrößern, ein- und ausblenden", "Öffnen",
				() -> minecraft.gui.setScreen(new HudEditorScreen(this)))));
		list.add(new SettingRow(new Setting.Action("Positionen", "Alle Elemente an ihre Standardstelle", "Zurücksetzen", () -> {
			ModuleManager.hud().forEach(HudModule::resetPosition);
			HeldixConfig.save();
		})));
		list.add(new Section("Tasten", null));
		list.add(new Info("Heldix-Menü", HeldixClient.menuKey.getTranslatedKeyMessage().getString()));
		list.add(new Info("Zoom", HeldixClient.zoomKey.getTranslatedKeyMessage().getString()));
		list.add(new Text("Ändern unter Optionen → Steuerung → HeldixClient.", Ui.FAINT));
	}

	private Setting.Toggle configToggle(String label, String description, BooleanSupplier get, Consumer<Boolean> set) {
		return new Setting.Toggle(label, description, get, value -> {
			set.accept(value);
			HeldixConfig.save();
		});
	}

	private void buildInfoRows(List<Row> list) {
		list.add(new Section("Version", null));
		list.add(new Info("HeldixClient", HeldixClient.version));
		list.add(new Info("Heldix Loader", HeldixLoader.version()));
		list.add(new Info("Minecraft", HeldixLoader.minecraftVersion()));
		list.add(new Info("Java", System.getProperty("java.version")));
		list.add(new Info("Grafik", DebugOverlay.backend() + " · " + gpuName()));
		list.add(new Section("Mods", HeldixLoader.mods().size() + " geladen"));
		for (ModInfo mod : HeldixLoader.mods()) list.add(new Info(mod.name(), mod.version()));
		List<String> problems = HeldixLoader.problems();
		if (!problems.isEmpty()) {
			list.add(new Section("Hinweise beim Start", Integer.toString(problems.size())));
			for (String problem : problems) list.add(new Text(problem, Ui.DANGER));
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

		/** Abstand zur nächsten Zeile */
		default int gapAfter() {
			return 6;
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

	/** Hinweis mit Icon in einer getönten Fläche */
	private final class Notice implements Row {
		private final String icon;
		private final String text;
		private final int color;

		Notice(String icon, String text, int color) {
			this.icon = icon;
			this.text = text;
			this.color = color;
		}

		@Override
		public int height(int width) {
			return Ui.wrap(text, width - 34, Ui.Font.BODY).size() * 11 + 14;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			Ui.rect(g, x, y, w, h, 8, (color & 0xFFFFFF) | 0x14000000);
			Ui.outline(g, x, y, w, h, 8, (color & 0xFFFFFF) | 0x33000000);
			Ui.icon(g, icon, x + 10, y + 7, 11, color);
			int lineY = y + 8;
			for (FormattedCharSequence line : Ui.wrap(text, w - 34, Ui.Font.BODY)) {
				g.text(font, line, x + 28, lineY, 0xFFD5DCE8, false);
				lineY += 11;
			}
		}
	}

	/** "Bezeichnung …… Wert" */
	private final class Info implements Row {
		private final String label;
		private final String value;

		Info(String label, String value) {
			this.label = label;
			this.value = value == null ? "-" : value;
		}

		@Override
		public int height(int width) {
			return 16;
		}

		@Override
		public int gapAfter() {
			return 0;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			String shownLabel = Ui.ellipsize(label, w / 2, Ui.Font.BODY);
			Ui.text(g, shownLabel, x + 2, y + 4, Ui.MUTED, Ui.Font.BODY);
			String shown = Ui.ellipsize(value, w - Ui.width(shownLabel, Ui.Font.BODY) - 16, Ui.Font.BODY);
			Ui.textRight(g, shown, x + w - 2, y + 4, Ui.TEXT, Ui.Font.BODY);
			Ui.hline(g, x, x + w, y + 15, Ui.LINE);
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

	/** Eine Einstellung: Schalter, Regler, Auswahl oder Knopf. */
	private final class SettingRow implements Row {
		private final Setting setting;

		SettingRow(Setting setting) {
			this.setting = setting;
		}

		private boolean hasDescription() {
			return setting.description() != null && !setting.description().isEmpty();
		}

		@Override
		public int height(int width) {
			if (setting instanceof Setting.Slider) return hasDescription() ? 44 : 34;
			return hasDescription() ? 34 : 26;
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
				case Setting.Slider slider -> 0;
			};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int h = height(w);
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, h);
			float t = animate(this, hover ? 1f : 0f);
			Ui.rect(g, x, y, w, h, 9, Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, t));
			Ui.outline(g, x, y, w, h, 9, Ui.LINE);
			boolean slider = setting instanceof Setting.Slider;
			int textW = slider ? w - 80 : w - 24 - controlWidth() - 8;
			int labelY = hasDescription() ? y + 8 : y + (h - 8) / 2;
			if (slider) labelY = y + 8;
			Ui.text(g, Ui.ellipsize(setting.label(), textW, Ui.Font.LABEL), x + 12, labelY, Ui.TEXT, Ui.Font.LABEL);
			if (hasDescription()) {
				Ui.text(g, Ui.ellipsize(setting.description(), slider ? w - 24 : textW, Ui.Font.SMALL), x + 12, labelY + 12, Ui.MUTED, Ui.Font.SMALL);
			}
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

	/** Filter der Modulliste als Pillen in einer Reihe */
	private final class Filters implements Row {
		private final List<Filter> filters;

		Filters(List<Filter> filters) {
			this.filters = filters;
		}

		private String label(Filter f) {
			long count = ModuleManager.all().stream().filter(f::matches).count();
			return f.label + "  " + count;
		}

		@Override
		public int height(int width) {
			return 20;
		}

		@Override
		public int gapAfter() {
			return 10;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			int fx = x;
			for (Filter f : filters) {
				String label = label(f);
				int fw = Ui.width(label, Ui.Font.LABEL) + 18;
				boolean on = f == filter;
				boolean hover = Ui.inside(mouseX, mouseY, fx, y, fw, 20);
				Ui.rect(g, fx, y, fw, 20, 10, on ? Ui.ACCENT : hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
				if (!on) Ui.outline(g, fx, y, fw, 20, 10, Ui.LINE);
				Ui.text(g, label, fx + 9, y + 6, on ? 0xFFFFFFFF : Ui.MUTED, Ui.Font.LABEL);
				fx += fw + 6;
			}
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int fx = x;
			for (Filter f : filters) {
				int fw = Ui.width(label(f), Ui.Font.LABEL) + 18;
				if (Ui.inside(mouseX, mouseY, fx, y, fw, 20)) {
					HeldixMenuScreen.this.click();
					filter = f;
					scroll = 0;
					return true;
				}
				fx += fw + 6;
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
					if (cape.glows() && HeldixConfig.get().capeGlow) {
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
				Capes.select(entry instanceof Capes.Cape cape ? cape : null);
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

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean ok = addon.isActive();
			int color = ok ? Ui.SUCCESS : Ui.DANGER;
			Ui.rect(g, x, y, w, ADDON_H, 10, Ui.SURFACE);
			Ui.outline(g, x, y, w, ADDON_H, 10, (color & 0xFFFFFF) | 0x44000000);
			Ui.rect(g, x + 10, y + 10, 26, 26, 8, (color & 0xFFFFFF) | 0x33000000);
			Ui.icon(g, ok ? addon.icon() : "warning", x + 16, y + 16, 14, color);

			String status = ok ? "Aktiv · " + addon.moduleCount() + (addon.moduleCount() == 1 ? " Modul" : " Module") : "Fehler";
			int statusW = Ui.width(status, Ui.Font.SMALL) + 14;
			int statusX = x + w - statusW - 10;
			Ui.rect(g, statusX, y + 9, statusW, 14, 7, (color & 0xFFFFFF) | 0x2A000000);
			Ui.text(g, status, statusX + 7, y + 12, color, Ui.Font.SMALL);

			int textX = x + 46;
			String title = addon.name();
			Ui.text(g, Ui.ellipsize(title, statusX - textX - 40, Ui.Font.LABEL), textX, y + 11, Ui.TEXT, Ui.Font.LABEL);
			int titleW = Math.min(Ui.width(title, Ui.Font.LABEL), statusX - textX - 40);
			Ui.text(g, addon.version(), textX + titleW + 6, y + 12, Ui.FAINT, Ui.Font.SMALL);
			String line = ok ? addon.description() : addon.error();
			Ui.text(g, Ui.ellipsize(line == null ? "" : line, w - 56, Ui.Font.SMALL), textX, y + 26, ok ? Ui.MUTED : Ui.DANGER, Ui.Font.SMALL);
		}
	}

	/** Ein Freund: Anfangsbuchstabe, Name, was er gerade macht; rechts Entfernen (mit Bestätigung) */
	private final class FriendRow implements Row {
		private final Social.Friend friend;

		FriendRow(Social.Friend friend) {
			this.friend = friend;
		}

		@Override
		public int height(int width) {
			return 36;
		}

		@Override
		public int gapAfter() {
			return 4;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 36);
			Ui.rect(g, x, y, w, 36, 9, hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
			avatar(g, friend.name(), x + 8, y + 7, friend.online());
			int textW = w - 40 - 120;
			Ui.text(g, Ui.ellipsize(friend.name(), textW, Ui.Font.LABEL), x + 38, y + 8, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(friend.activity(), textW, Ui.Font.SMALL), x + 38, y + 21, friend.online() ? Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);
			boolean confirming = friend.uuid().equals(confirmRemove) && System.currentTimeMillis() - confirmAt < 4000;
			boolean overRemove = Ui.inside(mouseX, mouseY, x + w - 30, y, 30, 36);
			if (confirming) {
				Ui.textRight(g, "Nochmal klicken zum Entfernen", x + w - 30, y + 14, Ui.DANGER, Ui.Font.SMALL);
			}
			Ui.icon(g, "trash", x + w - 22, y + 12, 12, confirming || overRemove ? Ui.DANGER : Ui.FAINT);
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			if (mouseX < x + w - 30) return false;
			if (friend.uuid().equals(confirmRemove) && System.currentTimeMillis() - confirmAt < 4000) {
				confirmRemove = null;
				HeldixMenuScreen.this.click();
				report(Social.removeFriend(friend.uuid()), friend.name() + " ist nicht mehr dein Freund");
			} else {
				confirmRemove = friend.uuid();
				confirmAt = System.currentTimeMillis();
			}
			return true;
		}
	}

	/** Eingehende (Annehmen/Ablehnen) oder gesendete Anfrage (Zurückziehen) */
	private final class RequestRow implements Row {
		private final Social.Request request;
		private final boolean incoming;

		RequestRow(Social.Request request, boolean incoming) {
			this.request = request;
			this.incoming = incoming;
		}

		@Override
		public int height(int width) {
			return 36;
		}

		@Override
		public int gapAfter() {
			return 4;
		}

		private int[] buttons(int x, int w) {
			int accept = Ui.width("Annehmen", Ui.Font.SMALL) + 16;
			int decline = Ui.width(incoming ? "Ablehnen" : "Zurückziehen", Ui.Font.SMALL) + 16;
			int declineX = x + w - 8 - decline;
			int acceptX = declineX - 6 - accept;
			return new int[] {acceptX, accept, declineX, decline};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Ui.rect(g, x, y, w, 36, 9, incoming ? (Ui.ACCENT & 0xFFFFFF) | 0x14000000 : Ui.SURFACE);
			avatar(g, request.name(), x + 8, y + 7, false);
			int[] b = buttons(x, w);
			int textW = (incoming ? b[0] : b[2]) - x - 46;
			Ui.text(g, Ui.ellipsize(request.name(), textW, Ui.Font.LABEL), x + 38, y + 8, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(incoming ? "möchte mit dir befreundet sein" : "Anfrage gesendet, wartet auf Antwort", textW, Ui.Font.SMALL),
					x + 38, y + 21, Ui.MUTED, Ui.Font.SMALL);
			if (incoming) pill(g, "Annehmen", b[0], y + 10, b[1], true, Ui.inside(mouseX, mouseY, b[0], y + 10, b[1], 16));
			pill(g, incoming ? "Ablehnen" : "Zurückziehen", b[2], y + 10, b[3], false, Ui.inside(mouseX, mouseY, b[2], y + 10, b[3], 16));
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
			return false;
		}
	}

	/** Ein Wegpunkt: Farbpunkt (Klick wechselt die Farbe), Name, Koordinaten, Entfernung; rechts Auge und Löschen */
	private final class WaypointRow implements Row {
		private final Waypoints.Waypoint waypoint;

		WaypointRow(Waypoints.Waypoint waypoint) {
			this.waypoint = waypoint;
		}

		@Override
		public int height(int width) {
			return 36;
		}

		@Override
		public int gapAfter() {
			return 4;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean hover = Ui.inside(mouseX, mouseY, x, y, w, 36);
			Ui.rect(g, x, y, w, 36, 9, hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
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

	/** Kreis mit Anfangsbuchstabe (Farbe aus dem Namen), grüner Punkt = online */
	private void avatar(GuiGraphicsExtractor g, String name, int x, int y, boolean online) {
		String shown = name == null || name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase(Locale.ROOT);
		float hue = Math.floorMod(name == null ? 0 : name.hashCode(), 360) / 360f;
		int color = 0xFF000000 | java.awt.Color.HSBtoRGB(hue, 0.45f, 0.62f) & 0xFFFFFF;
		Ui.circle(g, x + 11, y + 11, 11, color);
		Ui.text(g, shown, x + 11 - Ui.width(shown, Ui.Font.LABEL) / 2, y + 7, 0xFFFFFFFF, Ui.Font.LABEL);
		if (online) {
			Ui.circle(g, x + 19, y + 19, 4, Ui.WINDOW | 0xFF000000);
			Ui.circle(g, x + 19, y + 19, 3, Ui.SUCCESS);
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
		layout();

		g.enableScissor(bodyX - 2, bodyY, bodyX + bodyW + 2, bodyY + bodyH);
		boolean inBody = Ui.inside(mouseX, mouseY, bodyX, bodyY, bodyW, bodyH);
		int y = bodyY - (int) scroll;
		if (pageInput != null) {
			pageInput.visible = false;
			pageButton.visible = false;
		}
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
		g.disableScissor();
		Ui.scrollbar(g, bodyX + bodyW + 4, bodyY, bodyH, scroll, maxScroll());
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
	// Eingaben
	// ======================================================================================

	private void openSubmenu(Module module) {
		openModule = module;
		scroll = 0;
		rebuildWidgets();
	}

	private void closeSubmenu() {
		if (directSubmenu) {
			onClose();
			return;
		}
		openModule = null;
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
		if (maxScroll() > 0) {
			scroll = Math.clamp(scroll - scrollY * 20, 0, maxScroll());
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		if (search != null && !search.isMouseOver(event.x(), event.y())) {
			search.setFocused(false);
			if (getFocused() == search) setFocused(null);
		}
		if (pageInput != null && !pageInput.isMouseOver(event.x(), event.y())) {
			pageInput.setFocused(false);
			if (getFocused() == pageInput) setFocused(null);
		}
		if (event.button() != InputConstants.MOUSE_BUTTON_LEFT) return false;
		layout();
		double mx = event.x();
		double my = event.y();
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
		boolean typing = (search != null && search.isFocused()) || (pageInput != null && pageInput.isFocused());
		if (!typing && HeldixClient.menuKey.matches(event)) {
			onClose();
			return true;
		}
		if (!typing && openModule != null && event.key() == InputConstants.KEY_BACKSPACE) {
			closeSubmenu();
			return true;
		}
		return super.keyPressed(event);
	}

	/** Bilder ins Fenster gezogen: auf der Seite Cape als eigenes Cape übernehmen */
	@Override
	public void onFilesDrop(List<java.nio.file.Path> files) {
		if (page != Shell.Page.CAPE || openModule != null) {
			super.onFilesDrop(files);
			return;
		}
		Capes.Cape cape = Capes.importFiles(files);
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
		if (page == Shell.Page.CAPE) Capes.trim();
	}

	@Override
	public void onClose() {
		HeldixConfig.save();
		if (parent != null) minecraft.gui.setScreen(parent);
		else Shell.close(minecraft);
	}
}
