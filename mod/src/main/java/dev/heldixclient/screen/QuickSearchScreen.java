package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.AddonStore;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.waypoint.Waypoints;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Schnellsuche (Strg+K oder die Lupe oben): eine Suche über Seiten, Module und ihre Einstellungen, die Heldix-
 * Einstellungen, Addons, den Addon-Store, Freunde und Wegpunkte. Pfeile wählen, Enter springt hin – Einstellungen
 * werden dort kurz hervorgehoben. Die Seite darunter bleibt sichtbar; Esc führt zu ihr zurück.
 */
public class QuickSearchScreen extends Screen {
	/** Ein Treffer: Titel, wo er liegt, Icon, Art und was Enter macht */
	public record Hit(String key, String title, String path, String icon, Kind kind, String keywords, Runnable action) {
	}

	public enum Kind {
		PAGE("Seite"),
		MODULE("Modul"),
		SETTING("Einstellung"),
		ADDON("Addon"),
		STORE("Store"),
		FRIEND("Freund"),
		WAYPOINT("Wegpunkt");

		final String label;

		Kind(String label) {
			this.label = label;
		}
	}

	private static final int ROW_H = 26;
	/** zuletzt geöffnete Treffer (Schlüssel), neueste zuerst */
	private static final List<String> RECENT = new ArrayList<>();

	private final ShellScreen parent;
	private final long openedAt = System.nanoTime();
	private List<Hit> all;
	private List<Hit> results = List.of();
	private SearchField field;
	private String query = "";
	private int selected;
	private double scroll;
	private int panelX;
	private int panelY;
	private int panelW;
	private int panelH;
	private int listY;
	private int listH;
	private double lastMouseX = Double.NaN;
	private double lastMouseY = Double.NaN;

	private QuickSearchScreen(ShellScreen parent) {
		super(Component.literal("Schnellsuche"));
		this.parent = parent;
	}

	/** Öffnet die Suche über einer Seite der Oberfläche */
	public static void open(Screen from) {
		if (from instanceof ShellScreen shell) Minecraft.getInstance().gui.setScreen(new QuickSearchScreen(shell));
	}

	@Override
	protected void init() {
		if (parent.width != width || parent.height != height) parent.resize(width, height);
		if (all == null) all = index(minecraft, parent);
		panelW = Math.min(460, width - 24);
		panelX = (width - panelW) / 2;
		panelY = Math.max(8, Math.min(height / 6, 70));
		int maxRows = Math.max(3, Math.min(9, (height - panelY - 70) / ROW_H));
		listY = panelY + 40;
		listH = maxRows * ROW_H;
		panelH = 40 + listH + 22;
		field = new SearchField(panelX + 10, panelY + 10, panelW - 20, 22, "Seiten, Module, Einstellungen, Freunde …").keepOnEscape();
		field.setValue(query);
		field.setResponder(text -> {
			query = text;
			filter();
		});
		field.setOnEnter(this::activate);
		addRenderableWidget(field);
		setInitialFocus(field);
		filter();
	}

	// ======================================================================================
	// Suchen
	// ======================================================================================

	/** Kleinbuchstaben, ohne Akzente (ä → a), ß → ss: „grosse“ findet „Größe“ */
	static String normalize(String text) {
		if (text == null) return "";
		String lower = text.toLowerCase(Locale.ROOT).replace("ß", "ss");
		return Normalizer.normalize(lower, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
	}

	/** Punkte für einen Treffer: Titel vorn > Wortanfang > im Titel > im Pfad/Stichworten; 0 = passt nicht */
	static int score(Hit hit, String query) {
		String title = normalize(hit.title());
		if (title.equals(query)) return 100;
		if (title.startsWith(query)) return 90;
		for (String word : title.split("[\\s/&·(),.-]+")) if (word.startsWith(query)) return 80;
		if (title.contains(query)) return 70;
		String rest = normalize(hit.path() + " " + hit.keywords());
		for (String word : rest.split("[\\s/&·(),.-]+")) if (word.startsWith(query)) return 45;
		if (rest.contains(query)) return 35;
		String[] tokens = query.split("\\s+");
		if (tokens.length > 1) {
			String everything = title + " " + rest;
			for (String token : tokens) if (!everything.contains(token)) return 0;
			return 30;
		}
		return 0;
	}

	private void filter() {
		String q = normalize(query.strip());
		List<Hit> list = new ArrayList<>();
		if (q.isEmpty()) {
			// ohne Eingabe: zuletzt geöffnet, dann alle Seiten
			for (String key : RECENT) for (Hit hit : all) if (hit.key().equals(key)) list.add(hit);
			for (Hit hit : all) if (hit.kind() == Kind.PAGE && !list.contains(hit)) list.add(hit);
		} else {
			record Scored(Hit hit, int score) {
			}
			List<Scored> scored = new ArrayList<>();
			for (Hit hit : all) {
				int score = score(hit, q);
				if (score > 0) scored.add(new Scored(hit, score + (RECENT.contains(hit.key()) ? 5 : 0)));
			}
			scored.sort(Comparator.comparingInt((Scored s) -> -s.score()).thenComparingInt(s -> s.hit().kind().ordinal()));
			for (Scored s : scored.subList(0, Math.min(60, scored.size()))) list.add(s.hit());
		}
		results = list;
		selected = 0;
		scroll = 0;
	}

	/** Für den Autotest: Titel der Treffer zur aktuellen Eingabe */
	public List<String> resultTitles() {
		return results.stream().map(Hit::title).toList();
	}

	/** Für den Autotest: Eingabe setzen */
	public void type(String text) {
		field.setValue(text);
		query = text;
		filter();
	}

	private void activate() {
		if (selected < 0 || selected >= results.size()) return;
		Hit hit = results.get(selected);
		RECENT.remove(hit.key());
		RECENT.addFirst(hit.key());
		while (RECENT.size() > 5) RECENT.removeLast();
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
		hit.action().run();
	}

	// ======================================================================================
	// Was es zu finden gibt
	// ======================================================================================

	/** Stichworte, unter denen Seiten zusätzlich gefunden werden */
	private static String pageKeywords(Shell.Page page) {
		return switch (page) {
			case OVERVIEW -> "start dashboard schnellschalter hinweise";
			case MODULES -> "funktionen hud widgets";
			case SHADER -> "grafik farben bloom tiefenschärfe";
			case PERFORMANCE -> "fps leistung performance ruckeln";
			case WAYPOINTS -> "koordinaten markierung";
			case ADDONS -> "mods addons installiert";
			case STORE -> "addon store herunterladen installieren";
			case CAPE -> "umhang";
			case COSMETICS -> "hut hüte flügel aura partikel begleiter";
			case FRIENDS -> "freundesliste online favoriten vorschläge profil";
			case PARTY -> "party gruppe leiter folgen beitreten voice";
			case MESSAGES -> "chat schreiben";
			case REQUESTS -> "freundschaftsanfrage";
			case PRIVACY -> "datenschutz sichtbar blockiert";
			case ACCOUNTS -> "konto wechseln account microsoft";
			case SETTINGS -> "einstellungen design hud tasten";
			case INFO -> "version mods geladen";
			case HUD -> "hud editor widgets verschieben anordnen";
			case OPTIONS -> "minecraft optionen steuerung tasten video sound sprache";
			case WORLDS -> "welt einzelspieler singleplayer";
			case SERVERS -> "server mehrspieler multiplayer";
			case HELDIX_WORLDS -> "welt teilen freunde beitreten adresse sicherung";
			case PAUSE -> "pause";
			case RESUME -> "weiterspielen";
			case QUIT -> "spiel beenden schließen";
			default -> "";
		};
	}

	/** Alle Treffer, für diese Suche einmal zusammengestellt */
	static List<Hit> index(Minecraft minecraft, ShellScreen from) {
		boolean inGame = minecraft.level != null;
		List<Hit> hits = new ArrayList<>();
		Screen back = inGame ? null : new TitleScreen();

		// Seiten (auch Unterseiten), HUD-Editor und Aktionen
		for (Shell.Page page : Shell.Page.values()) {
			if (!page.visible(inGame) || !page.head().visible(inGame)) continue;
			boolean head = page.head() == page;
			String title = head ? page.title() : page.label;
			String path = head ? page.section.label : page.section.label + " › " + page.title();
			Runnable action = () -> Shell.open(minecraft, page, from);
			hits.add(new Hit("page:" + page.name(), title, path, page.icon, Kind.PAGE, pageKeywords(page), action));
		}

		// Module und ihre Einstellungen
		for (Module module : ModuleManager.all()) {
			String where = module.source() != null ? "Module › Addon " + module.source() : "Module";
			hits.add(new Hit("module:" + module.id(), module.name(), where + " · " + (module.isEnabled() ? "an" : "aus"), module.icon(), Kind.MODULE,
					module.description(), () -> minecraft.gui.setScreen(HeldixMenuScreen.moduleSettings(back, module, null))));
			for (Setting key : module.keys()) {
				String title = key.label().equals("Ein/Aus") ? module.name() + " ein/aus (Taste)" : key.label() + " (Taste)";
				hits.add(new Hit("module:" + module.id() + ":key:" + key.label(), title, "Module › " + module.name() + " › Tasten", "keyboard",
						Kind.SETTING, "taste tastenbelegung keybind " + key.description(), () -> minecraft.gui.setScreen(HeldixMenuScreen.moduleSettings(back, module, key.label()))));
			}
			for (Setting setting : module.settings()) {
				hits.add(new Hit("module:" + module.id() + ":" + setting.label(), setting.label(), "Module › " + module.name(), module.icon(),
						Kind.SETTING, setting.description(), () -> minecraft.gui.setScreen(HeldixMenuScreen.moduleSettings(back, module, setting.label()))));
			}
		}

		// Einstellungen der Heldix-Seiten
		for (HeldixMenuScreen.SettingEntry entry : HeldixMenuScreen.searchableSettings()) {
			String path = entry.page().section.label + " › " + entry.page().title() + (entry.group() != null ? " › " + entry.group() : "");
			hits.add(new Hit("setting:" + entry.page().name() + ":" + entry.label(), entry.label(), path, entry.page().icon, Kind.SETTING,
					entry.description(), () -> minecraft.gui.setScreen(HeldixMenuScreen.highlighted(back, entry.page(), entry.tab(), "setting:" + entry.label()))));
		}

		// installierte Addons und der Store
		for (LoadedAddon addon : AddonManager.addons()) {
			hits.add(new Hit("addon:" + addon.id(), addon.name(), "Mods & Addons › Installiert · " + addon.version(), addon.icon(), Kind.ADDON,
					addon.description(), () -> minecraft.gui.setScreen(HeldixMenuScreen.highlighted(back, Shell.Page.ADDONS, null, "addon:" + addon.id()))));
		}
		if (AddonStore.status() == AddonStore.Status.READY) {
			for (AddonStore.Entry entry : AddonStore.entries()) {
				hits.add(new Hit("store:" + entry.id(), entry.name(), "Mods & Addons › Store", "download", Kind.STORE, entry.summary(),
						() -> minecraft.gui.setScreen(HeldixMenuScreen.highlighted(back, Shell.Page.STORE, null, "store:" + entry.id()))));
			}
		}

		// Freunde (Enter öffnet den Chat) und Wegpunkte dieser Welt
		if (Social.online()) {
			for (Social.Friend friend : Social.friends()) {
				hits.add(new Hit("friend:" + friend.uuid(), friend.name(), "Freunde · " + friend.activity(), "user", Kind.FRIEND, "nachricht chat",
						() -> minecraft.gui.setScreen(new HeldixMenuScreen(back, friend.uuid(), friend.name()))));
			}
		}
		if (inGame) {
			for (Waypoints.Waypoint waypoint : Waypoints.current(minecraft)) {
				hits.add(new Hit("waypoint:" + waypoint.name, waypoint.name, "Wegpunkte · " + waypoint.coordinates(), "pin", Kind.WAYPOINT, "",
						() -> Shell.open(minecraft, Shell.Page.WAYPOINTS, from)));
			}
		}
		return hits;
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		parent.extractBackground(g, -1, -1, delta);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		parent.extractRenderState(g, -1, -1, delta);
		g.nextStratum();
		float t = Draw.easeOut((System.nanoTime() - openedAt) / 160_000_000f);
		g.fill(0, 0, width, height, Ui.withAlpha(0x99060A13, t));
		int offset = Math.round((1 - t) * 6);
		Ui.shadow(g, panelX, panelY + offset, panelW, panelH, 0.7f * t);
		Ui.rect(g, panelX, panelY + offset, panelW, panelH, 12, Ui.withAlpha(0xF7111724, t));
		Ui.outline(g, panelX, panelY + offset, panelW, panelH, 12, Ui.withAlpha(Ui.LINE_STRONG, t));
		super.extractRenderState(g, mouseX, mouseY, delta);

		// Maus bewegt: Treffer unter der Maus wählen
		boolean moved = !Double.isNaN(lastMouseX) && (Math.abs(mouseX - lastMouseX) > 0.5 || Math.abs(mouseY - lastMouseY) > 0.5);
		lastMouseX = mouseX;
		lastMouseY = mouseY;
		if (moved && Ui.inside(mouseX, mouseY, panelX, listY, panelW, listH)) {
			int index = (int) ((mouseY - listY + scroll) / ROW_H);
			if (index >= 0 && index < results.size()) selected = index;
		}

		g.enableScissor(panelX + 1, listY, panelX + panelW - 1, listY + listH);
		if (results.isEmpty()) {
			Ui.textCentered(g, query.isBlank() ? "Tippe, um zu suchen" : "Nichts gefunden für „" + Ui.ellipsize(query.strip(), panelW - 140, Ui.Font.BODY) + "“",
					panelX + panelW / 2, listY + 18, Ui.MUTED, Ui.Font.BODY);
		}
		String heading = query.isBlank() ? (RECENT.isEmpty() ? null : "ZULETZT") : null;
		int y = listY - (int) scroll;
		for (int i = 0; i < results.size(); i++) {
			if (y + ROW_H >= listY && y <= listY + listH) drawRow(g, results.get(i), i, y);
			y += ROW_H;
		}
		g.disableScissor();
		if (heading != null && scroll < 1) Ui.text(g, heading, panelX + 14, listY - 9, Ui.FAINT, Ui.Font.SMALL);
		Ui.scrollbar(g, panelX + panelW - 6, listY, listH, scroll, maxScroll());

		// Fußzeile mit den Tasten
		int fy = panelY + panelH - 15;
		Ui.hline(g, panelX + 1, panelX + panelW - 1, fy - 6, Ui.LINE);
		String keys = "↑↓ wählen  ·  Enter öffnen  ·  Esc zurück";
		Ui.text(g, Ui.ellipsize(keys, panelW - 90, Ui.Font.SMALL), panelX + 12, fy, Ui.FAINT, Ui.Font.SMALL);
		String count = results.size() == 1 ? "1 Treffer" : results.size() + " Treffer";
		if (!query.isBlank()) Ui.textRight(g, count, panelX + panelW - 12, fy, Ui.FAINT, Ui.Font.SMALL);
		Ui.drawTooltip(g, width, height);
	}

	private void drawRow(GuiGraphicsExtractor g, Hit hit, int index, int y) {
		int x = panelX + 6;
		int w = panelW - 12;
		boolean on = index == selected;
		if (on) {
			Ui.rect(g, x, y + 1, w, ROW_H - 2, 7, 0x333B82F6);
			Ui.outline(g, x, y + 1, w, ROW_H - 2, 7, 0x553B82F6);
		}
		Ui.rect(g, x + 6, y + 5, 16, 16, 5, on ? 0x553B82F6 : Ui.SURFACE_STRONG);
		Ui.icon(g, Ui.hasIcon(hit.icon()) ? hit.icon() : "search", x + 9, y + 8, 10, on ? 0xFFFFFFFF : Ui.ACCENT_TEXT);
		String kind = hit.kind().label;
		int kindW = Ui.width(kind, Ui.Font.SMALL) + 10;
		int textW = w - 34 - kindW - 10;
		String title = Ui.ellipsize(hit.title(), textW, Ui.Font.LABEL);
		Ui.text(g, title, x + 30, y + 5, Ui.TEXT, Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(hit.path(), textW, Ui.Font.SMALL), x + 30, y + 15, on ? Ui.MUTED : Ui.FAINT, Ui.Font.SMALL);
		int kx = x + w - 8 - kindW;
		Ui.rect(g, kx, y + 8, kindW, 11, 5.5f, on ? 0x333B82F6 : 0x10FFFFFF);
		Ui.textCentered(g, kind, kx + kindW / 2, y + 10, on ? Ui.ACCENT_TEXT : Ui.FAINT, Ui.Font.SMALL);
	}

	private int maxScroll() {
		return Math.max(0, results.size() * ROW_H - listH);
	}

	/** gewählten Treffer ins Bild holen */
	private void reveal() {
		int top = selected * ROW_H;
		if (top < scroll) scroll = top;
		else if (top + ROW_H > scroll + listH) scroll = top + ROW_H - listH;
		scroll = Math.clamp(scroll, 0, maxScroll());
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (key == InputConstants.KEY_DOWN || key == InputConstants.KEY_TAB && !event.hasShiftDown()) {
			if (!results.isEmpty()) selected = Math.min(results.size() - 1, selected + 1);
			reveal();
			return true;
		}
		if (key == InputConstants.KEY_UP || key == InputConstants.KEY_TAB) {
			selected = Math.max(0, selected - 1);
			reveal();
			return true;
		}
		if (key == InputConstants.KEY_PAGEDOWN) {
			selected = Math.min(results.size() - 1, selected + listH / ROW_H);
			reveal();
			return true;
		}
		if (key == InputConstants.KEY_PAGEUP) {
			selected = Math.max(0, selected - listH / ROW_H);
			reveal();
			return true;
		}
		if (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) {
			activate();
			return true;
		}
		if ((event.hasControlDown() || event.hasControlDownWithQuirk()) && key == InputConstants.KEY_K) {
			onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		if (Ui.inside(event.x(), event.y(), panelX, listY, panelW, listH)) {
			int index = (int) ((event.y() - listY + scroll) / ROW_H);
			if (index >= 0 && index < results.size()) {
				selected = index;
				activate();
			}
			return true;
		}
		if (!Ui.inside(event.x(), event.y(), panelX, panelY, panelW, panelH)) {
			onClose();
			return true;
		}
		return false;
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		scroll = Math.clamp(scroll - scrollY * ROW_H, 0, maxScroll());
		return true;
	}

	@Override
	public void onClose() {
		minecraft.gui.setScreen(parent);
	}

	@Override
	public boolean isPauseScreen() {
		return parent.isPauseScreen();
	}
}
