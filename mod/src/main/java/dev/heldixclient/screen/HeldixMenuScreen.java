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
import dev.heldixclient.social.Messages;
import dev.heldixclient.social.Social;
import dev.heldixclient.waypoint.Waypoints;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
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
	private String reportReason = "spam";
	/** umbrochene Zeilen der Sprechblasen (je Nachricht und Breite) */
	private final Map<Long, List<FormattedCharSequence>> bubbleLines = new HashMap<>();

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

	/** Mit geöffnetem Untermenü eines Moduls (z. B. aus dem HUD-Editor per Rechtsklick). */
	public HeldixMenuScreen(Screen parent, Shell.Page page, Module module) {
		super(Component.literal(page.title()), page);
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
		bodyH = contentH - (openChat != null ? 30 : 0);
		rows = buildRows();
		if (openChat != null && chatToTop) {
			chatFromBottom = maxScroll();
			chatToTop = false;
		}
		if (openChat != null) scroll = Math.max(0, maxScroll() - chatFromBottom);
		else scroll = Math.clamp(scroll, 0, maxScroll());
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

	/**
	 * Mitte des Reiters {@code name} (Unterseite wie PERFORMANCE, ADDONS, REQUESTS oder Reiter wie "filter:HUD");
	 * ist er nicht zu sehen, die Mitte seiner Kategorie in der Seitenleiste (danach ist der Reiter da).
	 */
	public int[] tabCenter(String name) {
		for (ShellTab tab : tabs) {
			if (tab.id().equals(name)) return new int[] {tab.getX() + tab.getWidth() / 2, tab.getY() + tab.getHeight() / 2};
		}
		Shell.Page target = Shell.Page.valueOf(name);
		for (ShellNavButton button : nav) {
			if (button.page() == target.head()) return new int[] {button.getX() + button.getWidth() / 2, button.getY() + button.getHeight() / 2};
		}
		throw new IllegalStateException("Kein Eintrag " + name + " in der Seitenleiste");
	}

	/** Ids der sichtbaren Reiter (für den Autotest) */
	public List<String> tabIds() {
		return tabs.stream().map(ShellTab::id).toList();
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

	@Override
	protected void initContent() {
		search = null;
		pageInput = null;
		pageButton = null;
		chatInput = null;
		layout();
		if (openChat != null) {
			initChat();
			return;
		}
		if (page == Shell.Page.MESSAGES) Messages.loadConversations();
		if (page == Shell.Page.PRIVACY && Social.online()) Messages.loadBlocked();
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
		} else if (wantsPageInput()) {
			if (page == Shell.Page.WAYPOINTS) addPageInput("Hier setzen", "plus", "Name (optional)", "pin", this::addWaypointHere);
			else addPageInput("Anfrage senden", "user-plus", "Spielername", "user", this::sendFriendRequest);
		}
	}

	/** Chat: Zurück, Melden und Blockieren im Kopf, Eingabe und Senden unten */
	private void initChat() {
		Messages.setViewing(openChat);
		Messages.loadHistory(openChat, false);
		int right = headerRight();
		String back = "Zurück";
		int bw = ActionButton.widthFor(back, "back");
		addRenderableWidget(new ActionButton(right - bw, headerButtonY(), bw, 20, back, false, this::closeChat).withIcon("back"));
		right -= bw + 6;
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
		addRenderableWidget(new ActionButton(contentX + contentW - sw, y, sw, 20, send, true, this::sendChat).withIcon("send"));
		chatInput = new SearchField(contentX, y, contentW - sw - 6, 20, "Nachricht an " + openChatName).withIcon("chat").withMaxLength(Messages.MAX_LENGTH);
		chatInput.setValue(chatText);
		chatInput.setResponder(text -> chatText = text);
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
		chatFromBottom = 0;
		click();
		Messages.send(openChat, text).whenComplete((ok, error) -> minecraft.execute(() -> {
			if (error == null) return;
			pageMessage(errorText(error), false);
			// Text nicht verlieren
			if (chatText.isEmpty()) {
				chatText = text;
				if (chatInput != null) chatInput.setValue(text);
			}
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
		rebuildWidgets();
	}

	private void closeChat() {
		Messages.setViewing(null);
		openChat = null;
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
		if (openModule != null || openChat != null) return false;
		if (page == Shell.Page.WAYPOINTS) return minecraft.level != null;
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
	}

	/** Unter-Menü der Kategorie als Reiter unter dem Seitenkopf */
	@Override
	protected List<ShellTab.Spec> subTabs() {
		if (openModule != null || openChat != null) return List.of();
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
			case FRIENDS, MESSAGES, REQUESTS, PRIVACY -> {
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
	protected Component headerTitle() {
		if (openChat != null) return Component.literal(openChatName);
		return openModule != null ? Component.literal(openModule.name()) : super.headerTitle();
	}

	@Override
	protected String headerIcon() {
		if (openChat != null) return "chat";
		return openModule != null ? openModule.icon() : super.headerIcon();
	}

	@Override
	protected String subtitle() {
		if (openModule != null) return openModule.source() != null ? "Addon: " + openModule.source() : "Einstellungen des Moduls";
		if (openChat != null) {
			Social.Friend friend = friendOf(openChat);
			return friend != null ? friend.activity() : "Nicht mehr in deiner Freundesliste";
		}
		return switch (page) {
			case MODULES -> {
				long on = ModuleManager.all().stream().filter(Module::isEnabled).count();
				yield on + " von " + ModuleManager.all().size() + " Modulen aktiv";
			}
			case OVERVIEW -> "Alles auf einen Blick";
			case CAPE -> "Dein Cape in der Third-Person-Ansicht (F5)";
			case FRIENDS, MESSAGES, REQUESTS, PRIVACY -> switch (Social.state()) {
				case ONLINE -> {
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
			case ADDONS -> AddonManager.addons().size() + (AddonManager.addons().size() == 1 ? " Addon installiert" : " Addons installiert");
			case INFO -> "Versionen und geladene Mods";
			default -> null;
		};
	}

	private List<Row> buildRows() {
		List<Row> list = new ArrayList<>();
		if (openChat != null) {
			buildChatRows(list);
			return list;
		}
		if (openModule != null) {
			list.add(new ModuleHeader(openModule));
			List<Setting> settings = openModule.settings();
			if (!settings.isEmpty()) {
				list.add(new Section("Einstellungen", null));
				list.add(new Group(settings.stream().<Row>map(SettingRow::new).toList()));
			}
			return list;
		}
		switch (page) {
			case MODULES -> buildModuleRows(list);
			case OVERVIEW -> buildOverviewRows(list);
			case CAPE -> buildCapeRows(list);
			case FRIENDS -> buildFriendRows(list);
			case MESSAGES -> buildMessageRows(list);
			case REQUESTS -> buildRequestRows(list);
			case PRIVACY -> buildPrivacyRows(list);
			case WAYPOINTS -> buildWaypointRows(list);
			case SHADER -> buildShaderRows(list);
			case PERFORMANCE -> buildPerformanceRows(list);
			case SETTINGS -> buildSettingsRows(list);
			case ADDONS -> buildAddonRows(list);
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
				list.add(new Section("Heldix-Capes", Capes.builtin().size() + " Motive"));
				list.add(new CapeGrid(builtin));
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

	/** Seite Übersicht: Spielfigur, dann Karten für Freunde, Wegpunkte, aktive Module und Tasten */
	private void buildOverviewRows(List<Row> list) {
		list.add(new OverviewHero());

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

	private Group keysCard() {
		return new Group("keyboard", "Tasten", "ändern unter Optionen → Steuerung", List.of(
				new Info("Heldix-Menü", HeldixClient.menuKey.getTranslatedKeyMessage().getString()),
				new Info("Zoom", HeldixClient.zoomKey.getTranslatedKeyMessage().getString()),
				new Info("Freelook", HeldixClient.freelookKey.getTranslatedKeyMessage().getString()),
				new Info("Wegpunkt setzen", HeldixClient.waypointKey.getTranslatedKeyMessage().getString())));
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
						+ "und das Heldix-Symbol in der Tab-Liste brauchen ihn.", Ui.ACCENT_TEXT));
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
				list.add(new Group(List.of(new SettingRow(new Setting.Toggle("Heldix-Dienst nutzen", "Freunde, Capes für alle und das Heldix-Symbol in der Tab-Liste",
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
		List<Social.Friend> friends = Social.friends();
		List<Social.Friend> online = friends.stream().filter(Social.Friend::online).toList();
		List<Social.Friend> offline = friends.stream().filter(f -> !f.online()).toList();
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
		java.time.LocalDate lastDay = null;
		Messages.Message previous = null;
		for (Messages.Message message : history) {
			java.time.LocalDate day = day(message.at());
			if (!day.equals(lastDay)) {
				list.add(new DayRow(dayLabel(day)));
				lastDay = day;
				previous = null;
			}
			boolean continued = previous != null && previous.from().equals(message.from()) && message.at() - previous.at() < 5 * 60_000;
			list.add(new Bubble(message, continued));
			previous = message;
		}
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
				new SettingRow(socialToggle("Für andere erkennbar", "Heldix-Symbol in der Tab-Liste und dein Heldix-Cape für andere HeldixClient-Spieler",
						() -> config.socialVisible, v -> config.socialVisible = v)),
				new SettingRow(socialToggle("Online-Status für Freunde", "Freunde sehen, ob du online bist und ob du im Menü oder in einer Welt bist",
						() -> config.socialPresence, v -> config.socialPresence = v)),
				new SettingRow(socialToggle("Server für Freunde sichtbar", "Freunde sehen, auf welchem Server du spielst, und können beitreten (nur öffentliche Adressen)",
						() -> config.socialShowServer, v -> config.socialShowServer = v)),
				new SettingRow(socialToggle("Nachrichten von Freunden", "Freunde können dir schreiben; aus: niemand kann dir Nachrichten schicken",
						() -> config.socialMessages, v -> config.socialMessages = v)))));
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
						() -> config.socialCapes, v -> config.socialCapes = v)))));
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

	private void buildAddonRows(List<Row> list) {
		List<LoadedAddon> addons = AddonManager.addons();
		if (addons.isEmpty()) {
			list.add(new EmptyState("addons", "Keine Addons installiert", "Lege Heldix-Addons (.jar) in den Ordner " + AddonManager.ADDON_DIR
					+ " deiner Instanz oder installiere sie im Launcher."));
		} else {
			list.add(new Section("Installiert", addons.size() + (addons.size() == 1 ? " Addon" : " Addons")));
			for (LoadedAddon addon : addons) list.add(new AddonCard(addon));
		}
		list.add(new Text("Heldix Loader " + HeldixLoader.version() + "  ·  Addon-API " + HeldixApi.API_VERSION, Ui.FAINT));
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
				new SettingRow(configToggle("HUD-Hintergrund", "Dunkle Box hinter den HUD-Elementen",
						() -> config.hudBackground, v -> config.hudBackground = v)),
				new SettingRow(new Setting.Action("Positionen", "Alle Elemente an ihre Standardstelle", "Zurücksetzen", () -> {
					ModuleManager.hud().forEach(HudModule::resetPosition);
					HeldixConfig.save();
				})))));
		list.add(new Section("Tasten", "ändern unter Optionen → Steuerung → HeldixClient"));
		list.add(new Group(List.of(
				new Info("Heldix-Menü", HeldixClient.menuKey.getTranslatedKeyMessage().getString()),
				new Info("Zoom", HeldixClient.zoomKey.getTranslatedKeyMessage().getString()),
				new Info("Freelook", HeldixClient.freelookKey.getTranslatedKeyMessage().getString()),
				new Info("Wegpunkt setzen", HeldixClient.waypointKey.getTranslatedKeyMessage().getString()))));
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

		/** Abstand zur nächsten Zeile */
		default int gapAfter() {
			return 6;
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
			return (hasDescription() ? 34 : 26) + extra;
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
			if (grouped) {
				if (t > 0.01f) Ui.rect(g, x + 3, y + 2, w - 6, h - 4, 7, Ui.withAlpha(Ui.SURFACE, t));
			} else {
				Ui.rect(g, x, y, w, h, 9, Ui.lerp(Ui.SURFACE, Ui.SURFACE_HOVER, t));
				Ui.outline(g, x, y, w, h, 9, Ui.LINE);
			}
			boolean slider = setting instanceof Setting.Slider;
			int textW = slider ? w - 80 : w - 24 - controlWidth() - 8;
			int labelY = hasDescription() ? y + (h - 20) / 2 : y + (h - 8) / 2;
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
			Ui.text(g, Ui.ellipsize(friend.name(), textW, Ui.Font.LABEL), x + 38, y + 8, Ui.TEXT, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(friend.activity(), textW, Ui.Font.SMALL), x + 38, y + 21, friend.online() ? Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);
			boolean overRemove = Ui.inside(mouseX, mouseY, x + w - 30, y, 30, 36);
			if (confirmingRemove) {
				Ui.textRight(g, "Nochmal klicken zum Entfernen", x + w - 30, y + 14, Ui.DANGER, Ui.Font.SMALL);
			}
			Ui.icon(g, "trash", x + w - 22, y + 12, 12, confirmingRemove || overRemove ? Ui.DANGER : Ui.FAINT);
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
		private static final int H = 124;

		@Override
		public int height(int width) {
			return H;
		}

		@Override
		public int gapAfter() {
			return 12;
		}

		private int figureW() {
			return 76;
		}

		/** Knöpfe unten rechts: {x, Breite} für Cape und HUD-Editor */
		private int[][] buttons(int x, int y, int w) {
			int capeW = Ui.width("Cape ändern", Ui.Font.SMALL) + 26;
			int hudW = Ui.width("HUD-Editor", Ui.Font.SMALL) + 26;
			int bx = x + figureW() + 18;
			return new int[][] {{bx, capeW}, {bx + capeW + 6, hudW}};
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			Ui.rect(g, x, y, w, H, 12, 0x1A3B82F6);
			Ui.outline(g, x, y, w, H, 12, 0x333B82F6);
			// Figur links auf einem leuchtenden Podest
			int fx = x + 10;
			Ui.rect(g, fx + 6, y + H - 14, figureW() - 12, 7, 3, 0x3D3B82F6);
			float seconds = (System.nanoTime() - created) / 1_000_000_000f;
			Capes.drawShowcase(g, Shell.skin(minecraft).get(), Capes.selected(), fx, y + 8, fx + figureW(), y + H - 10, seconds);

			int tx = x + figureW() + 18;
			int tw = w - (tx - x) - 12;
			Ui.text(g, greeting() + ",", tx, y + 16, Ui.MUTED, Ui.Font.BODY);
			Ui.text(g, Ui.ellipsize(minecraft.getUser().getName(), tw, Ui.Font.TITLE), tx, y + 28, Ui.TEXT, Ui.Font.TITLE);
			Capes.Cape cape = Capes.selected();
			String status = (cape == null ? "Ohne Heldix-Cape" : "Cape: " + cape.name()) + "  ·  " + place();
			Ui.text(g, Ui.ellipsize(status, tw, Ui.Font.SMALL), tx, y + 48, Ui.MUTED, Ui.Font.SMALL);
			String service = FriendWidget.serviceHint();
			boolean ok = service == null;
			Ui.circle(g, tx + 3, y + 64, 2.5f, ok ? Ui.SUCCESS : Ui.FAINT);
			Ui.text(g, Ui.ellipsize(ok ? "Mit dem Heldix-Dienst verbunden" : service, tw - 10, Ui.Font.SMALL), tx + 10, y + 60, ok ? Ui.SUCCESS : Ui.FAINT, Ui.Font.SMALL);

			int[][] b = buttons(x, y, w);
			pill(g, "Cape ändern", b[0][0], y + H - 30, b[0][1], true, Ui.inside(mouseX, mouseY, b[0][0], y + H - 30, b[0][1], 16));
			pill(g, "HUD-Editor", b[1][0], y + H - 30, b[1][1], false, Ui.inside(mouseX, mouseY, b[1][0], y + H - 30, b[1][1], 16));
		}

		@Override
		public boolean click(double mouseX, double mouseY, int x, int y, int w) {
			int[][] b = buttons(x, y, w);
			if (Ui.inside(mouseX, mouseY, x, y, figureW() + 14, H) || Ui.inside(mouseX, mouseY, b[0][0], y + H - 30, b[0][1], 16)) {
				HeldixMenuScreen.this.click();
				go(Shell.Page.CAPE);
				return true;
			}
			if (Ui.inside(mouseX, mouseY, b[1][0], y + H - 30, b[1][1], 16)) {
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
			Ui.text(g, Ui.ellipsize(friend.name(), textW, Ui.Font.LABEL), x + 38, y + 8, Ui.TEXT, Ui.Font.LABEL);
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
			Ui.text(g, Ui.ellipsize(conversation.name(), textW, Ui.Font.LABEL), x + 40, y + 9, Ui.TEXT, Ui.Font.LABEL);
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
			Ui.text(g, Ui.ellipsize(friend.name(), textW, Ui.Font.LABEL), x + 38, y + 8, Ui.TEXT, Ui.Font.LABEL);
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

	/** Eine Nachricht als Sprechblase: eigene rechts in Blau, die des Freundes links */
	private final class Bubble implements Row {
		private final Messages.Message message;
		/** direkt nach einer Nachricht desselben Absenders: weniger Abstand */
		private final boolean continued;

		Bubble(Messages.Message message, boolean continued) {
			this.message = message;
			this.continued = continued;
		}

		private int maxWidth(int w) {
			return Math.min(w * 3 / 4, 320);
		}

		private List<FormattedCharSequence> lines(int w) {
			int maxW = maxWidth(w) - 18;
			long key = message.id() * 4096 + maxW;
			return bubbleLines.computeIfAbsent(key, k -> Ui.wrap(Messages.clean(message.text()), maxW, Ui.Font.BODY));
		}

		@Override
		public int height(int width) {
			return (continued ? 0 : 4) + 8 + lines(width).size() * 11 + 11;
		}

		@Override
		public int gapAfter() {
			return 3;
		}

		@Override
		public void draw(GuiGraphicsExtractor g, int x, int y, int w, int mouseX, int mouseY) {
			boolean mine = message.mine();
			List<FormattedCharSequence> lines = lines(w);
			String time = clock(message.at());
			int textW = Ui.width(time, Ui.Font.SMALL);
			for (FormattedCharSequence line : lines) textW = Math.max(textW, font.width(line));
			int bw = textW + 18;
			int bh = 8 + lines.size() * 11 + 11;
			int by = y + (continued ? 0 : 4);
			int bx = mine ? x + w - bw - 2 : x + 2;
			Ui.rect(g, bx, by, bw, bh, 9, mine ? Ui.ACCENT : 0x24FFFFFF);
			int ly = by + 6;
			for (FormattedCharSequence line : lines) {
				g.text(font, line, bx + 9, ly, mine ? 0xFFFFFFFF : Ui.TEXT, false);
				ly += 11;
			}
			Ui.textRight(g, time, bx + bw - 8, by + bh - 9, mine ? 0xC8FFFFFF : Ui.FAINT, Ui.Font.SMALL);
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
			if (openChat != null) chatFromBottom = maxScroll() - scroll;
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
		boolean typing = (search != null && search.isFocused()) || (pageInput != null && pageInput.isFocused()) || (chatInput != null && chatInput.isFocused());
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
		if (openChat != null) Messages.setViewing(null);
		if (page == Shell.Page.CAPE) Capes.trim();
	}

	@Override
	public void onClose() {
		HeldixConfig.save();
		if (parent != null) minecraft.gui.setScreen(parent);
		else Shell.close(minecraft);
	}
}
