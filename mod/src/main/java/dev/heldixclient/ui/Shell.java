package dev.heldixclient.ui;

import com.mojang.realmsclient.RealmsMainScreen;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.HudEditorScreen;
import dev.heldixclient.screen.PauseMenuScreen;
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
import java.util.List;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Die gemeinsame Oberfläche von HeldixClient: ein mittiges Fenster mit Seitenleiste (Ober-Kategorien mit Icons) und Inhalt;
 * Kategorien mit mehreren Seiten zeigen ihre Unterseiten als Reiter unter dem Seitenkopf.
 * Einzelspieler, Mehrspieler, Heldix-Menü und Einstellungen sind Seiten dieses Fensters;
 * beim Wechsel zwischen ihnen gibt es keine neue Einblend-Animation.
 */
public final class Shell {
	/**
	 * Ziele der Oberfläche. Ober-Kategorien stehen in der Seitenleiste (in dieser Reihenfolge, nach Abschnitten);
	 * Unterseiten (mit {@code parent}) erscheinen als Reiter unter dem Kopf ihrer Kategorie.
	 */
	public enum Page {
		RESUME("Zurück zum Spiel", "play", Section.PLAY),
		PAUSE("Pausemenü", "pause", Section.PLAY),
		START("Start", "home", Section.PLAY),
		WORLDS("Einzelspieler", "world", Section.PLAY),
		SERVERS("Mehrspieler", "server", Section.PLAY),
		REALMS("Realms", "realms", Section.PLAY),
		OVERVIEW("Übersicht", "sparkles", Section.HELDIX),
		MODULES("Module", "modules", Section.HELDIX),
		SHADER("Shader", "shader", Section.HELDIX, "Grafik"),
		PERFORMANCE("Leistung", "performance", SHADER),
		WAYPOINTS("Wegpunkte", "pin", Section.HELDIX),
		ADDONS("Installiert", "addons", Section.HELDIX, "Addons"),
		STORE("Addon-Store", "download", ADDONS),
		CAPE("Cape", "cape", Section.PROFILE),
		FRIENDS("Freunde", "friends", Section.PROFILE),
		MESSAGES("Nachrichten", "chat", FRIENDS),
		REQUESTS("Anfragen", "user-plus", FRIENDS),
		PRIVACY("Privatsphäre", "shield", FRIENDS),
		SETTINGS("Allgemein", "settings", Section.SYSTEM, "Einstellungen"),
		INFO("Info", "info", SETTINGS),
		/** eigener Bildschirm, nicht in der Seitenleiste (Knöpfe bei Module, Übersicht, Einstellungen) */
		HUD("HUD-Editor", "hud", Section.SYSTEM),
		OPTIONS("Optionen", "options", Section.SYSTEM),
		QUIT("Beenden", "quit", Section.SYSTEM);

		/** Name als Reiter (bzw. in der Seitenleiste, wenn es kein eigener Kategoriename ist) */
		public final String label;
		public final String icon;
		final Section section;
		/** Ober-Kategorie (null = selbst eine) */
		private final Page parent;
		/** Name der Kategorie, wenn er vom Namen des ersten Reiters abweicht (Grafik → Shader) */
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

		/** die Ober-Kategorie (für Unterseiten der Eintrag in der Seitenleiste) */
		public Page head() {
			return parent == null ? this : parent;
		}

		/** Name der Kategorie: in der Seitenleiste und als Seitentitel */
		public String title() {
			Page head = head();
			return head.categoryName != null ? head.categoryName : head.label;
		}

		/** alle Seiten der Kategorie, als Reiter (eine Seite allein: keine Reiter) */
		public List<Page> group() {
			List<Page> list = new ArrayList<>();
			for (Page page : values()) if (page.head() == head()) list.add(page);
			return list;
		}

		/** Seiten, die es nur im Hauptmenü bzw. nur im Spiel gibt. */
		boolean visible(boolean inGame) {
			return switch (this) {
				case RESUME, PAUSE -> inGame;
				case START, WORLDS, SERVERS, REALMS, QUIT -> !inGame;
				default -> true;
			};
		}

		/** Eintrag in der Seitenleiste? */
		boolean inSidebar(boolean inGame) {
			return parent == null && this != HUD && visible(inGame);
		}
	}

	enum Section {
		PLAY("Spielen"),
		HELDIX("Heldix"),
		PROFILE("Profil"),
		SYSTEM("System");

		final String label;

		Section(String label) {
			this.label = label;
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
		int w = Math.min(screenWidth - margin * 2, 700);
		int h = Math.min(screenHeight - margin * 2, 420);
		return new Rect((screenWidth - w) / 2, (screenHeight - h) / 2, w, h);
	}

	public static int sidebarWidth(Rect window) {
		return window.w() < 380 ? 30 : window.w() < 540 ? 118 : 138;
	}

	public static boolean compact(Rect window) {
		return sidebarWidth(window) < 60;
	}

	/** Inhaltsbereich rechts neben der Seitenleiste (ganze Höhe des Fensters) */
	public static Rect content(Rect window) {
		int side = sidebarWidth(window);
		return new Rect(window.x() + side, window.y(), window.w() - side, window.h());
	}

	private record NavLayout(int itemH, int captionH, boolean footer, int top) {
	}

	/** Einträge der Seitenleiste: nur die Ober-Kategorien */
	private static List<Page> pages(boolean inGame) {
		List<Page> list = new ArrayList<>();
		for (Page page : Page.values()) if (page.inSidebar(inGame)) list.add(page);
		return list;
	}

	private static int sections(List<Page> pages) {
		int count = 0;
		Section section = null;
		for (Page page : pages) {
			if (page.section != section) {
				section = page.section;
				count++;
			}
		}
		return count;
	}

	/** Zeilenhöhen so wählen, dass alles auch in kleinen Fenstern passt. */
	private static NavLayout navLayout(Rect window, boolean inGame) {
		List<Page> pages = pages(inGame);
		int items = pages.size();
		int captions = sections(pages);
		int top = window.y() + 40;
		int roomWithFooter = window.bottom() - 34 - top;
		if (items * 20 + captions * 15 <= roomWithFooter) return new NavLayout(20, 15, true, top);
		if (items * 18 + captions * 13 <= roomWithFooter) return new NavLayout(18, 13, true, top);
		if (items * 16 + captions * 12 <= roomWithFooter) return new NavLayout(16, 12, true, top);
		int room = window.bottom() - 6 - top;
		if (items * 15 + captions * 10 <= room) return new NavLayout(15, 10, false, top);
		// eng: Abschnitte nur als feine Linie zwischen den Gruppen
		if (items * 15 + (captions - 1) * 7 <= room) return new NavLayout(15, 7, false, top);
		return new NavLayout(Math.max(12, Math.min(16, (room - (captions - 1) * 5) / items)), 5, false, top);
	}

	/** Abschnittstitel als Text (sonst nur eine Linie zwischen den Abschnitten) */
	private static boolean captionText(NavLayout layout) {
		return layout.captionH() >= 10;
	}

	// ======================================================================================
	// Seitenleiste
	// ======================================================================================

	/** Legt die Einträge der Seitenleiste als Widgets an; aktiv ist die Kategorie der offenen Seite. */
	public static List<ShellNavButton> createNav(Screen screen, Page active, boolean inGame, Consumer<AbstractWidget> add) {
		List<ShellNavButton> buttons = new ArrayList<>();
		Rect window = window(screen.width, screen.height);
		NavLayout layout = navLayout(window, inGame);
		boolean compact = compact(window);
		int x = window.x() + (compact ? 3 : 8);
		int w = sidebarWidth(window) - (compact ? 6 : 16);
		int y = layout.top();
		Section section = null;
		for (Page page : pages(inGame)) {
			if (page.section != section) {
				if (section != null || captionText(layout)) y += layout.captionH();
				section = page.section;
			}
			ShellNavButton button = new ShellNavButton(x, y, w, layout.itemH() - 2, page, page == active.head(), compact,
					() -> open(Minecraft.getInstance(), page, screen));
			buttons.add(button);
			add.accept(button);
			y += layout.itemH();
		}
		return buttons;
	}

	/**
	 * Zahl neben einem Eintrag der Seitenleiste bzw. einem Reiter, sonst null:
	 * Freunde = offene Anfragen und ungelesene Nachrichten, Anfragen bzw. Nachrichten jeweils für sich.
	 */
	public static String badge(Page page) {
		if (page == Page.ADDONS || page == Page.STORE) {
			int updates = dev.heldixclient.addon.AddonStore.updateCount();
			return updates > 0 ? Integer.toString(Math.min(updates, 99)) : null;
		}
		if (!Social.online()) return null;
		int count = switch (page) {
			case FRIENDS -> Social.incoming().size() + dev.heldixclient.social.Messages.unreadTotal();
			case REQUESTS -> Social.incoming().size();
			case MESSAGES -> dev.heldixclient.social.Messages.unreadTotal();
			default -> 0;
		};
		return count > 0 ? Integer.toString(Math.min(count, 99)) : null;
	}

	/** Fenster mit Schatten, Seitenleiste (Logo, Abschnitte, Profil) und Trennlinie. */
	public static void drawWindow(GuiGraphicsExtractor g, int screenWidth, int screenHeight, boolean inGame, float alpha) {
		Rect win = window(screenWidth, screenHeight);
		int side = sidebarWidth(win);
		boolean compact = compact(win);
		Ui.shadow(g, win.x(), win.y(), win.w(), win.h(), 0.55f * alpha);
		Ui.rect(g, win.x(), win.y(), win.w(), win.h(), 12, Ui.withAlpha(Ui.WINDOW, alpha));
		g.enableScissor(win.x(), win.y(), win.x() + side, win.bottom());
		Ui.rect(g, win.x(), win.y(), side + 14, win.h(), 12, Ui.withAlpha(Ui.SIDEBAR, alpha));
		g.disableScissor();
		Ui.vline(g, win.x() + side, win.y() + 1, win.bottom() - 1, Ui.withAlpha(Ui.LINE, alpha));
		Ui.outline(g, win.x(), win.y(), win.w(), win.h(), 12, Ui.withAlpha(Ui.LINE, alpha));

		// Logo
		if (compact) {
			Ui.logo(g, win.x() + (side - 16) / 2f, win.y() + 11, 16, alpha);
		} else {
			int lx = win.x() + 12;
			int ly = win.y() + 11;
			Ui.logo(g, lx, ly, 17, alpha);
			Ui.text(g, "Heldix", lx + 23, ly, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
			Ui.text(g, "Client", lx + 23 + Ui.width("Heldix ", Ui.Font.LABEL), ly, Ui.withAlpha(Ui.ACCENT_TEXT, alpha), Ui.Font.LABEL);
			Ui.text(g, "Version " + HeldixClient.version, lx + 23, ly + 10, Ui.withAlpha(Ui.FAINT, alpha), Ui.Font.SMALL);
		}

		// Abschnittstitel
		NavLayout layout = navLayout(win, inGame);
		if (layout.captionH() > 0) {
			int y = layout.top();
			Section section = null;
			for (Page page : pages(inGame)) {
				if (page.section != section) {
					boolean text = captionText(layout);
					if (text || section != null) {
						if (text && !compact) {
							Ui.text(g, page.section.label.toUpperCase(java.util.Locale.ROOT), win.x() + 14, y + layout.captionH() - 10,
									Ui.withAlpha(Ui.FAINT, alpha), Ui.Font.SMALL);
						} else if (section != null) {
							int lineY = y + layout.captionH() / 2 - 1;
							Ui.hline(g, win.x() + (compact ? 6 : 14), win.x() + side - (compact ? 6 : 14), lineY, Ui.withAlpha(Ui.LINE, alpha));
						}
						y += layout.captionH();
					}
					section = page.section;
				}
				y += layout.itemH();
			}
		}

		// Profil unten
		if (layout.footer() && !compact) {
			Minecraft minecraft = Minecraft.getInstance();
			int fy = win.bottom() - 30;
			Ui.hline(g, win.x() + 10, win.x() + side - 10, fy, Ui.withAlpha(Ui.LINE, alpha));
			PlayerFaceExtractor.extractRenderState(g, skin(minecraft).get(), win.x() + 12, fy + 8, 14);
			String name = Ui.ellipsize(minecraft.getUser().getName(), side - 46, Ui.Font.LABEL);
			Ui.text(g, name, win.x() + 32, fy + 6, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
			String status = inGame ? (minecraft.getCurrentServer() != null ? "Online" : "Einzelspieler") : "Hauptmenü";
			Ui.text(g, status, win.x() + 32, fy + 16, Ui.withAlpha(Ui.FAINT, alpha), Ui.Font.SMALL);
			Ui.circle(g, win.x() + side - 14, fy + 15, 2.5f, Ui.withAlpha(Ui.SUCCESS, alpha));
		}
	}

	/** Skin des angemeldeten Kontos (auch im Hauptmenü ohne Welt) */
	public static Supplier<PlayerSkin> skin(Minecraft minecraft) {
		if (skin == null) skin = minecraft.getSkinManager().createLookup(minecraft.getGameProfile(), false);
		return skin;
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
	// Navigation
	// ======================================================================================

	/** Öffnet eine Seite. {@code from} ist die aktuelle Seite (für "Zurück" in Vanilla-Unterseiten). */
	public static void open(Minecraft minecraft, Page page, Screen from) {
		Screen back = minecraft.level == null ? new TitleScreen() : null;
		switch (page) {
			case RESUME -> minecraft.gui.setScreen(null);
			case START -> minecraft.gui.setScreen(new TitleScreen());
			case WORLDS -> minecraft.gui.setScreen(new WorldsScreen());
			case SERVERS -> minecraft.gui.setScreen(minecraft.options.skipMultiplayerWarning ? new ServersScreen() : new SafetyScreen(from));
			case REALMS -> minecraft.gui.setScreen(new RealmsMainScreen(from));
			case OVERVIEW, MODULES, CAPE, FRIENDS, MESSAGES, REQUESTS, PRIVACY, WAYPOINTS, SHADER, PERFORMANCE, ADDONS, STORE, SETTINGS, INFO ->
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
	 * (z. B. von Start zu Einzelspieler) sind sofort da.
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
