package dev.heldixclient.ui;

import com.mojang.realmsclient.RealmsMainScreen;
import dev.heldixclient.account.AccountSwitcher;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.screen.ActionButton;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.HudEditorScreen;
import dev.heldixclient.screen.PauseMenuScreen;
import dev.heldixclient.screen.ProfileButton;
import dev.heldixclient.screen.QuickSearchScreen;
import dev.heldixclient.screen.ServersScreen;
import dev.heldixclient.screen.ShellNavButton;
import dev.heldixclient.screen.WorldsScreen;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.SafetyScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.world.entity.player.PlayerSkin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Die gemeinsame Oberfläche von HeldixClient: ein mittiges Fenster mit zwei Leisten oben und dem Inhalt darunter.
 * Die obere Leiste zeigt Logo, die vier Bereiche (Spielen, Heldix, Profil, System), Suche, Profil und Schließen;
 * die Leiste darunter die Seiten des offenen Bereichs. Hat eine Seite mehrere Unterseiten, stehen sie als Reiter im
 * Kopf des Inhalts. Einzelspieler, Mehrspieler, Pausemenü, Heldix-Menü und Einstellungen sind Seiten dieses Fensters;
 * beim Wechsel zwischen ihnen bleibt das Fenster stehen, nur der Inhalt blendet weich über.
 */
public final class Shell {
	/**
	 * Ziele der Oberfläche. Ober-Seiten stehen in der Seitenleiste ihres Bereichs (in dieser Reihenfolge);
	 * Unterseiten (mit {@code parent}) erscheinen als Reiter im Kopf ihrer Ober-Seite.
	 */
	public enum Page {
		RESUME("Zurück zum Spiel", "play", Section.PLAY),
		PAUSE("Pausemenü", "pause", Section.PLAY),
		START("Start", "home", Section.PLAY),
		WORLDS("Einzelspieler", "world", Section.PLAY),
		SERVERS("Mehrspieler", "server", Section.PLAY),
		/** geteilte Welten von Freunden und eigene (ab Heldix-Dienst 1.12.0) */
		HELDIX_WORLDS("Heldix-Welten", "lan", Section.PLAY),
		REALMS("Realms", "realms", Section.PLAY),
		OVERVIEW("Übersicht", "home", Section.HELDIX),
		MODULES("Module", "modules", Section.HELDIX),
		SHADER("Shader", "shader", Section.HELDIX, "Grafik"),
		PERFORMANCE("Leistung", "performance", SHADER),
		WAYPOINTS("Wegpunkte", "pin", Section.HELDIX),
		ADDONS("Installiert", "addons", Section.HELDIX, "Mods & Addons"),
		STORE("Store", "download", ADDONS),
		CAPE("Cape", "cape", Section.PROFILE),
		COSMETICS("Cosmetics", "sparkles", Section.PROFILE),
		FRIENDS("Freunde", "friends", Section.PROFILE),
		/** Party mit Freunden: Mitglieder, Einladungen, Folgen, Party-Chat (ab Heldix-Dienst 1.12.0) */
		PARTY("Party", "headphones", FRIENDS),
		MESSAGES("Nachrichten", "chat", FRIENDS),
		REQUESTS("Anfragen", "user-plus", FRIENDS),
		PRIVACY("Privatsphäre", "shield", FRIENDS),
		/** Konten des Launchers (nur vom HeldixClient-Launcher gestartet und dort erlaubt) */
		ACCOUNTS("Konten", "user", Section.PROFILE),
		SETTINGS("Allgemein", "settings", Section.SYSTEM, "Einstellungen"),
		INFO("Info", "info", SETTINGS),
		/** eigener Bildschirm, nicht in der Navigation (Knöpfe bei Module, Übersicht, Einstellungen, Suche) */
		HUD("HUD-Editor", "hud", Section.SYSTEM),
		OPTIONS("Minecraft-Optionen", "options", Section.SYSTEM),
		QUIT("Beenden", "quit", Section.SYSTEM);

		/** Name als Reiter (bzw. in der Navigation, wenn es kein eigener Name der Ober-Seite ist) */
		public final String label;
		public final String icon;
		public final Section section;
		/** Ober-Seite (null = selbst eine) */
		private final Page parent;
		/** Name der Ober-Seite, wenn er vom Namen des ersten Reiters abweicht (Grafik → Shader) */
		private final String categoryName;

		Page(String label, String icon, Section section) {
			this(label, icon, section, null);
		}

		Page(String label, String icon, Section section, String categoryName) {
			this.label = label;
			this.icon = icon;
			this.section = section;
			this.parent = null;
			this.categoryName = categoryName;
		}

		Page(String label, String icon, Page parent) {
			this.label = label;
			this.icon = icon;
			this.section = parent.section;
			this.parent = parent;
			this.categoryName = null;
		}

		/** die Ober-Seite (für Unterseiten der Eintrag in der Navigation) */
		public Page head() {
			return parent == null ? this : parent;
		}

		/** Name der Ober-Seite: in der Navigation und als Titel */
		public String title() {
			Page head = head();
			return head.categoryName != null ? head.categoryName : head.label;
		}

		/** alle Seiten der Ober-Seite, als Reiter (eine Seite allein: keine Reiter) */
		public List<Page> group() {
			List<Page> list = new ArrayList<>();
			for (Page page : values()) if (page.head() == head()) list.add(page);
			return list;
		}

		/** Seiten, die es nur im Hauptmenü bzw. nur im Spiel gibt. */
		public boolean visible(boolean inGame) {
			return switch (this) {
				case RESUME, PAUSE -> inGame;
				case START, WORLDS, SERVERS, HELDIX_WORLDS, REALMS, QUIT -> !inGame;
				case ACCOUNTS -> accountsVisible();
				default -> true;
			};
		}

		/** Eintrag in der Navigation? */
		boolean inNav(boolean inGame) {
			return parent == null && this != HUD && visible(inGame);
		}

		/** öffnet einen eigenen Bildschirm statt einer Seite im Fenster (Titelbild, Optionen, Realms …) */
		public boolean leavesShell() {
			return this == RESUME || this == START || this == REALMS || this == OPTIONS || this == QUIT || this == HUD;
		}
	}

	/** Die vier Bereiche der oberen Leiste */
	public enum Section {
		PLAY("Spielen", "play"),
		HELDIX("Heldix", "sparkles"),
		PROFILE("Profil", "user"),
		SYSTEM("System", "settings");

		public final String label;
		public final String icon;

		Section(String label, String icon) {
			this.label = label;
			this.icon = icon;
		}
	}

	/** Rechteck in GUI-Pixeln */
	public record Rect(int x, int y, int w, int h) {
		public int right() {
			return x + w;
		}

		public int bottom() {
			return y + h;
		}
	}

	/** Vanilla-Menüs, die der Spieler ausdrücklich geöffnet hat ("Klassische Ansicht"); werden nie ersetzt */
	private static final Set<Screen> VANILLA = Collections.newSetFromMap(new WeakHashMap<>());
	/** zuletzt offene Seite je Bereich: ein Klick auf den Bereich führt dorthin zurück */
	private static final Map<Section, Page> LAST = new EnumMap<>(Section.class);
	private static long lastFrame;
	private static Supplier<PlayerSkin> skin;

	private Shell() {
	}

	// ======================================================================================
	// Layout
	// ======================================================================================

	/** Das Fenster: mittig, mit Rand; in großen Fenstern begrenzt, damit nichts verloren wirkt. */
	public static Rect window(int screenWidth, int screenHeight) {
		int margin = screenWidth < 520 || screenHeight < 300 ? 6 : 16;
		int w = Math.min(screenWidth - margin * 2, 720);
		int h = Math.min(screenHeight - margin * 2, 430);
		return new Rect((screenWidth - w) / 2, (screenHeight - h) / 2, w, h);
	}

	/** niedriges Fenster (große GUI-Skalierung): flachere Leisten */
	public static boolean low(Rect window) {
		return window.h() < 300;
	}

	/** schmales Fenster: Bereiche nur als Icons, Suche und Profil ohne Text */
	public static boolean compact(Rect window) {
		return window.w() < 460;
	}

	public static int topBarHeight(Rect window) {
		return low(window) ? 24 : 30;
	}

	public static int pageBarHeight(Rect window) {
		return low(window) ? 20 : 24;
	}

	/** Höhe beider Leisten zusammen */
	public static int navHeight(Rect window) {
		return topBarHeight(window) + pageBarHeight(window);
	}

	/** Innenabstand links und rechts (Leisten und Inhalt) */
	public static int pad(Rect window) {
		return window.w() < 360 ? 10 : 16;
	}

	/** Inhaltsbereich unter den Leisten (ganze Breite des Fensters) */
	public static Rect content(Rect window) {
		int nav = navHeight(window);
		return new Rect(window.x(), window.y() + nav, window.w(), window.h() - nav);
	}

	/** Lage der Teile der oberen Leiste */
	private record TopBar(int buttonY, int buttonH, boolean wordmark, int categoriesX, boolean labels,
			int searchX, int searchW, boolean searchLabel, int profileX, int profileW, boolean profileName, int closeX) {
	}

	private static TopBar topBar(Rect win, boolean inGame) {
		int top = topBarHeight(win);
		int pad = pad(win);
		int bh = low(win) ? 18 : 20;
		int by = win.y() + (top - bh) / 2;
		boolean compact = compact(win);
		int closeX = win.right() - pad - bh + 3;
		String name = Minecraft.getInstance().getUser().getName();
		boolean profileName = !compact;
		int profileW = profileName ? Math.min(120, 8 + 12 + 6 + Ui.width(name, Ui.Font.LABEL) + 9) : bh + 2;
		int profileX = closeX - 6 - profileW;
		boolean searchLabel = win.w() >= 560;
		int searchW = searchLabel ? ActionButton.widthFor("Suchen", "search") : bh;
		int searchX = profileX - 6 - searchW;
		boolean wordmark = win.w() >= 520;
		int categoriesX = win.x() + pad + 15 + (wordmark ? 5 + Ui.width("Heldix Client", Ui.Font.LABEL) : 0) + 14;
		int room = searchX - 8 - categoriesX;
		int withLabels = 0;
		for (Section section : sections(inGame)) withLabels += ShellNavButton.categoryWidth(section, true) + 2;
		return new TopBar(by, bh, wordmark, categoriesX, withLabels <= room, searchX, searchW, searchLabel, profileX, profileW, profileName, closeX);
	}

	// ======================================================================================
	// Bereiche und Seiten
	// ======================================================================================

	/** Seiten eines Bereichs in der Navigation */
	public static List<Page> pages(Section section, boolean inGame) {
		List<Page> list = new ArrayList<>();
		for (Page page : Page.values()) if (page.section == section && page.inNav(inGame)) list.add(page);
		return list;
	}

	/** alle Seiten, die die Navigation anbietet (über alle Bereiche) */
	public static List<Page> navPages(boolean inGame) {
		List<Page> list = new ArrayList<>();
		for (Page page : Page.values()) if (page.inNav(inGame)) list.add(page);
		return list;
	}

	/** Bereiche mit mindestens einer Seite */
	public static List<Section> sections(boolean inGame) {
		List<Section> list = new ArrayList<>();
		for (Section section : Section.values()) if (!pages(section, inGame).isEmpty()) list.add(section);
		return list;
	}

	/** Seite als zuletzt offene ihres Bereichs merken (nur Seiten im Fenster) */
	public static void remember(Page page) {
		if (!page.leavesShell()) LAST.put(page.section, page);
	}

	/** Ziel beim Klick auf einen Bereich: die dort zuletzt offene Seite, sonst die erste */
	public static Page target(Section section, boolean inGame) {
		Page last = LAST.get(section);
		if (last != null && last.visible(inGame) && last.head().visible(inGame)) return last;
		return switch (section) {
			case PLAY -> inGame ? Page.PAUSE : Page.WORLDS;
			case HELDIX -> Page.OVERVIEW;
			case PROFILE -> Page.CAPE;
			case SYSTEM -> Page.SETTINGS;
		};
	}

	// ======================================================================================
	// Navigation
	// ======================================================================================

	/**
	 * Legt die Bedienelemente beider Leisten als Widgets an: Bereiche, Suche, Profil und Schließen oben, die Seiten des
	 * aktiven Bereichs darunter. Zurück kommen die Knöpfe der Bereiche und Seiten.
	 */
	public static List<ShellNavButton> createNav(Screen screen, Page active, boolean inGame, Consumer<AbstractWidget> add) {
		List<ShellNavButton> buttons = new ArrayList<>();
		Minecraft minecraft = Minecraft.getInstance();
		Rect win = window(screen.width, screen.height);
		TopBar bar = topBar(win, inGame);
		Section current = active.section;

		// Bereiche
		int x = bar.categoriesX();
		for (Section section : sections(inGame)) {
			int w = ShellNavButton.categoryWidth(section, bar.labels());
			Page target = target(section, inGame);
			ShellNavButton button = ShellNavButton.category(x, bar.buttonY(), w, bar.buttonH(), section, target, section == current, bar.labels(),
					() -> open(minecraft, target(section, inGame), screen));
			buttons.add(button);
			add.accept(button);
			x += w + 2;
		}

		// Suche, Profil, Schließen
		ActionButton search = bar.searchLabel()
				? new ActionButton(bar.searchX(), bar.buttonY(), bar.searchW(), bar.buttonH(), "Suchen", false, () -> QuickSearchScreen.open(screen))
						.withIcon("search").withVariant(ActionButton.Variant.GHOST).withTooltip("Schnellsuche (Strg+K)")
				: ActionButton.icon(bar.searchX(), bar.buttonY(), bar.buttonH(), "search", "Schnellsuche (Strg+K)", () -> QuickSearchScreen.open(screen));
		add.accept(search);
		add.accept(new ProfileButton(bar.profileX(), bar.buttonY(), bar.profileW(), bar.buttonH(), bar.buttonH() / 2f,
				() -> {
					if (active != Page.ACCOUNTS) open(minecraft, Page.ACCOUNTS, screen);
				}));
		add.accept(ActionButton.icon(bar.closeX(), bar.buttonY(), bar.buttonH(), "close", inGame ? "Zurück zum Spiel (Esc)" : "Schließen (Esc)", screen::onClose));

		// Seiten des aktiven Bereichs
		List<Page> pages = pages(current, inGame);
		int pad = pad(win);
		int py = win.y() + topBarHeight(win);
		int ph = pageBarHeight(win);
		int left = win.x() + pad - 7;
		int room = win.right() - pad + 7 - left;
		boolean icons = true;
		int padding = 7;
		if (pagesWidth(pages, true, padding) > room) icons = false;
		if (pagesWidth(pages, icons, padding) > room) padding = 4;
		int total = pagesWidth(pages, icons, padding);
		// passt es immer noch nicht: alle gleich schmal, Namen gekürzt
		int even = total > room ? room / Math.max(1, pages.size()) : 0;
		x = left;
		for (Page page : pages) {
			int w = even > 0 ? even : ShellNavButton.pageWidth(page, icons, padding);
			ShellNavButton button = ShellNavButton.page(x, py + 1, w, ph - 2, page, page == active.head(), icons,
					() -> open(minecraft, page, screen));
			buttons.add(button);
			add.accept(button);
			x += w;
		}
		return buttons;
	}

	private static int pagesWidth(List<Page> pages, boolean icons, int padding) {
		int total = 0;
		for (Page page : pages) total += ShellNavButton.pageWidth(page, icons, padding);
		return total;
	}

	/** Konten in der Navigation und Profil anklickbar? (vom Launcher gestartet und dort erlaubt) */
	public static boolean accountsVisible() {
		return AccountSwitcher.available();
	}

	/**
	 * Zahl neben einer Seite bzw. einem Reiter, sonst null: Freunde = offene Anfragen und ungelesene Nachrichten,
	 * Anfragen bzw. Nachrichten jeweils für sich; Mods & Addons = Updates.
	 */
	public static String badge(Page page) {
		if (page == Page.ADDONS || page == Page.STORE) {
			int updates = dev.heldixclient.addon.AddonStore.updateCount();
			return updates > 0 ? Integer.toString(Math.min(updates, 99)) : null;
		}
		if (!Social.online()) return null;
		int count = switch (page) {
			case FRIENDS -> Social.incoming().size() + dev.heldixclient.social.Messages.unreadTotal() + dev.heldixclient.social.Party.invites().size()
					+ dev.heldixclient.social.Party.unreadChat();
			case PARTY -> dev.heldixclient.social.Party.invites().size() + dev.heldixclient.social.Party.unreadChat();
			case REQUESTS -> Social.incoming().size();
			case MESSAGES -> dev.heldixclient.social.Messages.unreadTotal();
			default -> 0;
		};
		return count > 0 ? Integer.toString(Math.min(count, 99)) : null;
	}

	/** Zahl an einem Bereich: Summe seiner Seiten (z. B. Profil = Anfragen und Nachrichten) */
	public static String badge(Section section, boolean inGame) {
		int sum = 0;
		for (Page page : pages(section, inGame)) {
			String badge = badge(page);
			if (badge != null) sum += Integer.parseInt(badge);
		}
		return sum > 0 ? Integer.toString(Math.min(sum, 99)) : null;
	}

	/** Fenster mit Schatten, obere Leiste (Logo, Profil), Trennlinien der Leisten. */
	public static void drawWindow(GuiGraphicsExtractor g, int screenWidth, int screenHeight, boolean inGame, float alpha) {
		Rect win = window(screenWidth, screenHeight);
		int top = topBarHeight(win);
		int nav = navHeight(win);
		Ui.shadow(g, win.x(), win.y(), win.w(), win.h(), 0.55f * alpha);
		Ui.rect(g, win.x(), win.y(), win.w(), win.h(), 12, Ui.withAlpha(Ui.WINDOW, alpha));
		// obere Leiste etwas dunkler, mit feinem Licht an der Oberkante
		g.enableScissor(win.x(), win.y(), win.right(), win.y() + top);
		Ui.rect(g, win.x(), win.y(), win.w(), top + 14, 12, Ui.withAlpha(Ui.SIDEBAR, alpha));
		g.disableScissor();
		Ui.hline(g, win.x() + 12, win.right() - 12, win.y() + 1, Ui.withAlpha(0x0FFFFFFF, alpha));
		Ui.hline(g, win.x() + 1, win.right() - 1, win.y() + top, Ui.withAlpha(Ui.LINE, alpha));
		Ui.hline(g, win.x() + 1, win.right() - 1, win.y() + nav, Ui.withAlpha(Ui.LINE, alpha));
		Ui.outline(g, win.x(), win.y(), win.w(), win.h(), 12, Ui.withAlpha(Ui.LINE, alpha));

		// Logo
		TopBar bar = topBar(win, inGame);
		int lx = win.x() + pad(win);
		Ui.logo(g, lx, win.y() + (top - 15) / 2f, 15, alpha);
		if (bar.wordmark()) {
			int ty = win.y() + (top - 8) / 2;
			Ui.text(g, "Heldix", lx + 20, ty, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
			Ui.text(g, "Client", lx + 20 + Ui.width("Heldix ", Ui.Font.LABEL), ty, Ui.withAlpha(Ui.ACCENT_TEXT, alpha), Ui.Font.LABEL);
		}

		// Profil oben rechts: Kopf und Name (die Fläche darüber ist der ProfileButton)
		Minecraft minecraft = Minecraft.getInstance();
		int px = bar.profileX();
		int py = bar.buttonY();
		int ph = bar.buttonH();
		Ui.rect(g, px, py, bar.profileW(), ph, ph / 2f, Ui.withAlpha(Ui.SURFACE, alpha));
		Ui.outline(g, px, py, bar.profileW(), ph, ph / 2f, Ui.withAlpha(Ui.LINE, alpha));
		int head = 12;
		int hx = bar.profileName() ? px + 6 : px + (bar.profileW() - head) / 2;
		PlayerFaceExtractor.extractRenderState(g, skin(minecraft).get(), hx, py + (ph - head) / 2, head);
		if (Social.online()) {
			Ui.circle(g, hx + head, py + (ph - head) / 2f + head, 3, Ui.withAlpha(0xFF0F1420, alpha));
			Ui.circle(g, hx + head, py + (ph - head) / 2f + head, 2, Ui.withAlpha(Ui.SUCCESS, alpha));
		}
		if (bar.profileName()) {
			String name = Ui.ellipsize(minecraft.getUser().getName(), bar.profileW() - head - 20, Ui.Font.LABEL);
			Ui.text(g, name, hx + head + 6, py + (ph - 8) / 2, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		}
	}

	/** Skin des angemeldeten Kontos (auch im Hauptmenü ohne Welt) */
	public static Supplier<PlayerSkin> skin(Minecraft minecraft) {
		if (skin == null) skin = minecraft.getSkinManager().createLookup(minecraft.getGameProfile(), false);
		return skin;
	}

	/** Konto gewechselt: Skin beim nächsten Bild für das neue Konto laden */
	public static void forgetSkin() {
		skin = null;
	}

	/**
	 * Hintergrund hinter dem Fenster: im Hauptmenü das Heldix-Motiv (oder das Minecraft-Panorama, wenn eingestellt,
	 * dann zeichnet es der Aufrufer vorher), im Spiel die verschwommene Welt; darüber eine Abdunkelung.
	 */
	public static void drawBackdrop(GuiGraphicsExtractor g, int width, int height, boolean inGame, float alpha) {
		if (!inGame && HeldixConfig.get().heldixBackground) Ui.background(g, width, height, 1f);
		g.fillGradient(0, 0, width, height, Ui.withAlpha(0x8C060A13, alpha), Ui.withAlpha(0xC0060A13, alpha));
	}

	// ======================================================================================
	// Seiten öffnen
	// ======================================================================================

	/** Öffnet eine Seite. {@code from} ist die aktuelle Seite (für "Zurück" in Vanilla-Unterseiten). */
	public static void open(Minecraft minecraft, Page page, Screen from) {
		Screen back = minecraft.level == null ? new TitleScreen() : null;
		switch (page) {
			case RESUME -> minecraft.gui.setScreen(null);
			case START -> minecraft.gui.setScreen(new TitleScreen());
			case WORLDS -> minecraft.gui.setScreen(new WorldsScreen());
			case SERVERS -> minecraft.gui.setScreen(minecraft.options.skipMultiplayerWarning ? new ServersScreen() : new SafetyScreen(from));
			case HELDIX_WORLDS -> minecraft.gui.setScreen(new dev.heldixclient.screen.HeldixWorldsScreen());
			case REALMS -> minecraft.gui.setScreen(new RealmsMainScreen(from));
			case OVERVIEW, MODULES, CAPE, COSMETICS, FRIENDS, PARTY, MESSAGES, REQUESTS, PRIVACY, ACCOUNTS, WAYPOINTS, SHADER, PERFORMANCE, ADDONS, STORE, SETTINGS, INFO ->
					minecraft.gui.setScreen(new HeldixMenuScreen(back, page));
			case HUD -> minecraft.gui.setScreen(new HudEditorScreen(from));
			case OPTIONS -> minecraft.gui.setScreen(new OptionsScreen(from, minecraft.options));
			case PAUSE -> minecraft.gui.setScreen(new PauseMenuScreen());
			case QUIT -> minecraft.stop();
		}
	}

	/** Zurück aus einer Shell-Seite: im Spiel zurück ins Spiel, sonst zur Startseite. */
	public static void close(Minecraft minecraft) {
		minecraft.gui.setScreen(minecraft.level == null ? new TitleScreen() : null);
	}

	/** Öffnet eine Vanilla-Seite, die nie ersetzt wird (Knopf "Klassische Ansicht"). */
	public static void openVanilla(Minecraft minecraft, Screen vanilla) {
		VANILLA.add(vanilla);
		minecraft.gui.setScreen(vanilla);
	}

	/** Gui.setScreen: Einzel- und Mehrspieler-Liste von Minecraft durch die Heldix-Seiten ersetzen. */
	public static Screen replace(Screen screen) {
		if (screen == null) return null;
		if (VANILLA.contains(screen)) return screen;
		Minecraft minecraft = Minecraft.getInstance();
		if (!WidgetStyle.enabled() || minecraft.isDemo()) return screen;
		if (screen.getClass() == net.minecraft.client.gui.screens.worldselection.SelectWorldScreen.class) return new WorldsScreen();
		if (screen.getClass() == net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen.class) return new ServersScreen();
		if (screen.getClass() == PauseScreen.class && ((PauseScreen) screen).showsPauseMenu() && minecraft.level != null) return new PauseMenuScreen();
		return screen;
	}

	// ======================================================================================
	// Animation
	// ======================================================================================

	/**
	 * Einblenden: nur, wenn vorher keine Shell-Seite zu sehen war. Wechsel zwischen Shell-Seiten
	 * (z. B. von Start zu Einzelspieler) zeigen das Fenster sofort; nur der Inhalt blendet über.
	 */
	public static long openedAt() {
		long now = System.nanoTime();
		return now - lastFrame < 400_000_000L ? now - 1_000_000_000L : now;
	}

	/** jedes Bild aufrufen: merkt sich, dass gerade eine Shell-Seite sichtbar ist */
	public static float frame(long openedAt) {
		lastFrame = System.nanoTime();
		return Draw.easeOut((lastFrame - openedAt) / 260_000_000f);
	}
}
