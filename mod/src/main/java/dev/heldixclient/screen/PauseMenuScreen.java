package dev.heldixclient.screen;

import dev.heldixclient.hud.Notifications;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.waypoint.Waypoints;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.WorldOptionsScreen;
import net.minecraft.client.gui.screens.achievement.StatsScreen;
import net.minecraft.client.gui.screens.advancements.AdvancementsScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.social.SocialInteractionsScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * Pausemenü im Heldix-Design (ersetzt Minecrafts Pausemenü, wenn das Heldix-Design an ist).
 * Links die gewohnten Knöpfe und darunter Schnellschalter für Module; rechts (in breiten Fenstern) Karten für
 * die Sitzung (Spielzeit, Position, Ping), Freunde und Wegpunkte. In schmalen Fenstern eine Schnellzeile.
 * Das Vanilla-Pausemenü mit Knöpfen anderer Mods bleibt über "Klassisches Pausemenü" erreichbar.
 */
public class PauseMenuScreen extends ShellScreen {
	private static final int CARD_HEAD = 26;
	private static final int SESSION_H = CARD_HEAD + 2 * 24 + 4;
	private static final int WAYPOINTS_H = CARD_HEAD + 26;
	private static final int TOGGLE_ROW = 24;

	/** Beginn der Sitzung (Welt bzw. Server betreten), 0 = unbekannt */
	private static long sessionStart;

	private ActionButton disconnect;
	/** Spalte rechts: x, Breite und die Karten (y, Höhe); sideW = 0 = keine Spalte */
	private int sideX;
	private int sideW;
	private int sessionY;
	private int sessionH;
	private int friendsY;
	private int friendsH;
	private int waypointsY;
	/** Karte Schnell umschalten (linke Spalte) */
	private int quickX;
	private int quickW;
	private int quickY;
	private int quickH;
	/** Was die Freunde-Karte zeigt (ändert es sich, werden die Widgets neu angelegt) */
	private FriendsMode friendsMode;
	private String waypointMessage;
	private long waypointMessageAt;
	private boolean quickRow;
	private final List<ToggleChip> toggles = new ArrayList<>();

	private enum FriendsMode {
		LIST,
		EMPTY,
		HINT
	}

	public PauseMenuScreen() {
		super(Component.literal("Pausemenü"), Shell.Page.PAUSE);
	}

	/** Spielzeit der Sitzung mitzählen (einmal beim Start aufrufen) */
	public static void trackSession() {
		WorldEvents.JOIN.register(minecraft -> {
			if (sessionStart == 0) sessionStart = System.currentTimeMillis();
		});
		WorldEvents.LEAVE.register(minecraft -> sessionStart = 0);
	}

	private record Entry(String label, String icon, Runnable action) {
	}

	@Override
	protected int toolbarActionsWidth() {
		return ActionButton.widthFor("Klassisches Pausemenü", "external");
	}

	@Override
	protected void initContent() {
		toggles.clear();
		boolean small = contentH < 190;
		int bigH = small ? 24 : 30;
		int rowH = small ? 22 : 26;
		int gap = small ? 6 : 8;
		boolean twoColumns = contentW >= 400 && contentH >= 170;
		int x = contentX;
		int w = twoColumns ? (contentW - 12) * 56 / 100 : contentW;
		int y = contentY;

		addRenderableWidget(new ActionButton(x, y, w, bigH, "Zurück zum Spiel", true, this::resume).withIcon("play"));
		y += bigH + gap;

		List<Entry> entries = new ArrayList<>();
		entries.add(new Entry("Fortschritte", "star", () -> open(() -> new AdvancementsScreen(minecraft.player.connection.getAdvancements(), this))));
		entries.add(new Entry("Statistiken", "list", () -> open(() -> new StatsScreen(this, minecraft.player.getStats()))));
		entries.add(new Entry("Optionen", "options", () -> open(() -> new OptionsScreen(this, minecraft.options))));
		if (minecraft.isLocalServer()) entries.add(new Entry("Welt-Optionen", "world", () -> open(() -> new WorldOptionsScreen(this, minecraft.level))));
		else entries.add(new Entry("Spieler", "user", () -> open(() -> new SocialInteractionsScreen(this))));
		entries.add(new Entry("Module", "modules", () -> open(() -> new HeldixMenuScreen(this, Shell.Page.MODULES))));
		entries.add(new Entry("HUD-Editor", "hud", () -> open(() -> new HudEditorScreen(this))));
		int colW = (w - gap) / 2;
		int bottom = contentY + contentH;
		// bis über den Verlassen-Knopf; die letzte Reihe braucht keinen Abstand nach unten
		int rowsAvailable = Math.max(1, (bottom - rowH - gap - y + gap) / (rowH + gap));
		quickRow = false;
		if (!twoColumns) {
			// schmale Fenster: die neuen Bereiche als Schnellzeile (Schalter, Wegpunkt, Freunde) unter den Knöpfen –
			// passt sie nicht, als zwei weitere Knöpfe
			int baseRows = (entries.size() + 1) / 2;
			int quickRowY = y + baseRows * (rowH + gap);
			quickRow = quickRowY + 22 <= bottom - rowH - gap;
			if (quickRow) {
				buildQuickRow(x, quickRowY, w);
			} else {
				entries.add(new Entry("Freunde", "friends", () -> open(() -> new HeldixMenuScreen(this, Shell.Page.FRIENDS))));
				entries.add(new Entry("Wegpunkte", "pin", () -> open(() -> new HeldixMenuScreen(this, Shell.Page.WAYPOINTS))));
			}
		}
		int shown = Math.min(entries.size(), rowsAvailable * 2);
		for (int i = 0; i < shown; i++) {
			Entry entry = entries.get(i);
			int bx = x + (i % 2) * (colW + gap);
			int by = y + (i / 2) * (rowH + gap);
			int bw = i % 2 == 0 ? colW : w - colW - gap;
			addRenderableWidget(new ActionButton(bx, by, bw, rowH, entry.label(), false, entry.action()).withIcon(entry.icon()));
		}
		int gridBottom = y + (shown + 1) / 2 * (rowH + gap) - gap;

		String leave = minecraft.isLocalServer() ? "Speichern und zum Hauptmenü" : "Verbindung trennen";
		disconnect = new ActionButton(x, bottom - rowH, w, rowH, leave, false, this::leave).withIcon("quit").withVariant(ActionButton.Variant.DANGER);
		addRenderableWidget(disconnect);

		String classic = "Klassisches Pausemenü";
		int cw = ActionButton.widthFor(classic, "external");
		addRenderableWidget(new ActionButton(headerRight() - cw, headerButtonY(), cw, 20, classic, false,
				() -> Shell.openVanilla(minecraft, new PauseScreen(true))).withIcon("external").withVariant(ActionButton.Variant.GHOST));

		sideW = twoColumns ? contentW - w - 12 : 0;
		quickH = 0;
		if (twoColumns) {
			buildQuickCard(x, gridBottom + gap + 4, w, bottom - rowH - gap - 4);
			buildSide(x + w + 12, bottom);
		}
	}

	/** Schnellzeile (schmale Fenster): vier Modul-Schalter als Icons, Wegpunkt setzen, Freunde */
	private void buildQuickRow(int x, int y, int w) {
		int chip = 24;
		int gap = 4;
		int cx = x;
		for (Module module : quickModules(4)) {
			ToggleChip toggle = new ToggleChip(cx, y, chip, 22, shortName(module), module.icon(), module::isEnabled, module::setEnabled);
			toggles.add(toggle);
			addRenderableWidget(toggle);
			cx += chip + gap;
		}
		int rest = x + w - cx - 2;
		int half = (rest - 6) / 2;
		addRenderableWidget(new ActionButton(cx + 2, y, half, 22, "Wegpunkt", false, this::setWaypoint).withIcon("plus").withTooltip("Wegpunkt hier setzen"));
		addRenderableWidget(new ActionButton(cx + 2 + half + 6, y, x + w - (cx + 2 + half + 6), 22, "Freunde", false,
				() -> open(() -> new HeldixMenuScreen(this, Shell.Page.FRIENDS))).withIcon("friends"));
	}

	/** Karte Schnell umschalten unter den Knöpfen: so viele Reihen (je zwei Schalter), wie Platz haben */
	private void buildQuickCard(int x, int y, int w, int maxBottom) {
		int rows = Math.clamp((maxBottom - y - CARD_HEAD - 6) / TOGGLE_ROW, 0, 4);
		List<Module> modules = quickModules(rows * 2);
		if (rows == 0 || modules.isEmpty()) return;
		rows = (modules.size() + 1) / 2;
		quickX = x;
		quickW = w;
		quickY = y;
		quickH = CARD_HEAD + rows * TOGGLE_ROW + 4;
		int chipW = (w - 16 - 6) / 2;
		for (int i = 0; i < modules.size(); i++) {
			Module module = modules.get(i);
			int cx = x + 8 + (i % 2) * (chipW + 6);
			int cy = y + CARD_HEAD - 2 + (i / 2) * TOGGLE_ROW;
			ToggleChip chip = new ToggleChip(cx, cy, i % 2 == 0 ? chipW : w - 16 - chipW - 6, 20, shortName(module), module.icon(),
					module::isEnabled, module::setEnabled);
			toggles.add(chip);
			addRenderableWidget(chip);
		}
		String all = "Alle";
		int aw = ActionButton.widthFor(all, "chevron-right") - 4;
		addRenderableWidget(new ActionButton(x + w - 6 - aw, y + 4, aw, 18, all, false,
				() -> open(() -> new HeldixMenuScreen(this, Shell.Page.MODULES))).withIcon("chevron-right").withVariant(ActionButton.Variant.GHOST));
	}

	private static List<Module> quickModules(int max) {
		return dev.heldixclient.module.QuickModules.list(max);
	}

	private static String shortName(Module module) {
		return dev.heldixclient.module.QuickModules.shortName(module);
	}

	/** Rechte Spalte: Sitzung oben, Wegpunkte unten, dazwischen Freunde */
	private void buildSide(int sx, int bottom) {
		sideX = sx;
		int gap = 8;
		sessionY = contentY;
		sessionH = SESSION_H;
		waypointsY = bottom - WAYPOINTS_H;
		friendsY = sessionY + sessionH + gap;
		friendsH = waypointsY - gap - friendsY;
		// wenig Platz: Sitzung weglassen, Freunde bekommen die Fläche
		if (friendsH < CARD_HEAD + 44) {
			sessionH = 0;
			friendsY = contentY;
			friendsH = waypointsY - gap - friendsY;
		}

		// Freunde: Liste, leerer Zustand mit Knopf oder Hinweis zum Dienst
		friendsMode = friendsMode();
		Runnable openFriends = () -> open(() -> new HeldixMenuScreen(this, Shell.Page.FRIENDS));
		if (friendsMode == FriendsMode.LIST) {
			int rows = Math.max(0, (friendsH - CARD_HEAD - 4) / 32);
			for (int i = 0; i < rows; i++) {
				int index = i;
				addRenderableWidget(new FriendWidget(sideX + 4, friendsY + CARD_HEAD + i * 32, sideW - 8, 30, () -> friendAt(index), openFriends));
			}
		} else if (friendsMode == FriendsMode.EMPTY && friendsH >= CARD_HEAD + 64) {
			String add = "Freund hinzufügen";
			int bw = Math.min(sideW - 24, ActionButton.widthFor(add, "user-plus"));
			addRenderableWidget(new ActionButton(sideX + (sideW - bw) / 2, friendsY + friendsH - 30, bw, 20, add, true, openFriends).withIcon("user-plus"));
		}
		String all = "Alle";
		int aw = ActionButton.widthFor(all, "chevron-right") - 4;
		addRenderableWidget(new ActionButton(sideX + sideW - 6 - aw, friendsY + 4, aw, 18, all, false, openFriends)
				.withIcon("chevron-right").withVariant(ActionButton.Variant.GHOST));

		// Wegpunkte: hier setzen, verwalten
		int half = (sideW - 16 - 6) / 2;
		addRenderableWidget(new ActionButton(sideX + 8, waypointsY + CARD_HEAD - 2, half, 20, "Hier setzen", true, this::setWaypoint).withIcon("plus"));
		addRenderableWidget(new ActionButton(sideX + 8 + half + 6, waypointsY + CARD_HEAD - 2, sideW - 16 - half - 6, 20, "Verwalten", false,
				() -> open(() -> new HeldixMenuScreen(this, Shell.Page.WAYPOINTS))).withIcon("pin"));
	}

	private static FriendsMode friendsMode() {
		if (!Social.online()) return FriendsMode.HINT;
		return Social.friends().isEmpty() ? FriendsMode.EMPTY : FriendsMode.LIST;
	}

	@Override
	public void tick() {
		super.tick();
		// Dienst verbunden oder erster Freund: Freunde-Karte neu aufbauen
		if (sideW > 0 && friendsMode != friendsMode()) rebuildWidgets();
	}

	private static Social.Friend friendAt(int index) {
		if (!Social.online()) return null;
		List<Social.Friend> friends = new ArrayList<>(Social.friends());
		friends.sort(java.util.Comparator.comparing((Social.Friend f) -> !f.online()));
		return index < friends.size() ? friends.get(index) : null;
	}

	private void setWaypoint() {
		Waypoints.Waypoint waypoint = Waypoints.add(minecraft, "");
		if (waypoint == null) return;
		waypointMessage = "„" + waypoint.name + "“ gesetzt";
		waypointMessageAt = System.currentTimeMillis();
		Notifications.show("waypoint", "Wegpunkt gesetzt", waypoint.name + " · " + waypoint.coordinates(), null);
	}

	private void open(Supplier<Screen> screen) {
		minecraft.gui.setScreen(screen.get());
	}

	private void resume() {
		minecraft.gui.setScreen(null);
		minecraft.mouseHandler.grabMouse();
	}

	/** Speichern und verlassen bzw. Verbindung trennen – wie bei Minecraft (offene Meldungen werden vorher abgefragt) */
	private void leave() {
		disconnect.active = false;
		minecraft.getReportingContext().draftReportHandled(minecraft, this, () -> minecraft.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE), true);
	}

	@Override
	protected String subtitle() {
		ServerData server = minecraft.getCurrentServer();
		if (server != null && !minecraft.isLocalServer()) return "Mehrspieler  ·  " + server.name;
		if (minecraft.getSingleplayerServer() != null) {
			String world = minecraft.getSingleplayerServer().getWorldData().getLevelName();
			return "Einzelspieler  ·  " + world + (minecraft.getSingleplayerServer().isPublished() ? "  ·  im LAN geöffnet" : "");
		}
		return "Spiel pausiert";
	}

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (sideW <= 0) {
			// Hinweis über dem Verlassen-Knopf (nicht, wenn dort die Schnellzeile sitzt)
			if (!quickRow && contentH >= 190 && disconnect != null) {
				Ui.text(g, "Rechte Umschalttaste öffnet im Spiel das Heldix-Menü.", contentX + 2, disconnect.getY() - 14, Ui.FAINT, Ui.Font.SMALL);
			}
			return;
		}
		// Schnell umschalten
		if (quickH > 0) {
			long on = toggles.stream().filter(ToggleChip::isOn).count();
			card(g, quickX, quickY, quickW, quickH, "options", "Schnell umschalten", on + " von " + toggles.size() + " an");
		}
		// Sitzung
		if (sessionH > 0) {
			card(g, sideX, sessionY, sideW, sessionH, "clock", "Sitzung", null);
			String[][] stats = sessionStats();
			int tileW = (sideW - 16 - 6) / 2;
			for (int i = 0; i < stats.length; i++) {
				int tx = sideX + 8 + (i % 2) * (tileW + 6);
				int ty = sessionY + CARD_HEAD - 2 + (i / 2) * 24;
				stat(g, tx, ty, tileW, stats[i][0], stats[i][1], stats[i][2]);
			}
		}
		// Freunde
		List<Social.Friend> friends = Social.online() ? Social.friends() : List.of();
		long online = friends.stream().filter(Social.Friend::online).count();
		card(g, sideX, friendsY, sideW, friendsH, "friends", "Freunde", friends.isEmpty() ? null : online + " von " + friends.size() + " online");
		if (friendsMode != FriendsMode.LIST) {
			String text = friendsMode == FriendsMode.EMPTY ? "Noch keine Freunde. Schick eine Anfrage an jemanden, der HeldixClient nutzt."
					: FriendWidget.serviceHint();
			if (text != null) {
				List<FormattedCharSequence> lines = Ui.wrap(text, sideW - 32, Ui.Font.SMALL);
				boolean button = friendsMode == FriendsMode.EMPTY && friendsH >= CARD_HEAD + 64;
				int areaTop = friendsY + CARD_HEAD;
				int areaBottom = friendsY + friendsH - (button ? 36 : 4);
				int iconSize = areaBottom - areaTop >= 40 + lines.size() * 10 ? 22 : 0;
				int blockH = iconSize + (iconSize > 0 ? 6 : 0) + lines.size() * 10;
				int ty = areaTop + Math.max(4, (areaBottom - areaTop - blockH) / 2);
				int cx = sideX + sideW / 2;
				if (iconSize > 0) {
					Ui.circle(g, cx, ty + iconSize / 2f, iconSize / 2f, Ui.ACCENT_SOFT);
					Ui.icon(g, "friends", cx - 5.5f, ty + iconSize / 2f - 5.5f, 11, Ui.ACCENT_TEXT);
					ty += iconSize + 6;
				}
				for (FormattedCharSequence line : lines) {
					g.text(font, line, cx - font.width(line) / 2, ty, Ui.MUTED, false);
					ty += 10;
				}
			}
		}
		// Wegpunkte
		int count = Waypoints.current(minecraft).size();
		String detail = waypointMessage != null && System.currentTimeMillis() - waypointMessageAt < 5000 ? waypointMessage
				: count == 0 ? "noch keine" : count + " in dieser Welt";
		card(g, sideX, waypointsY, sideW, WAYPOINTS_H, "pin", "Wegpunkte", detail);
	}

	/** Werte der Karte Sitzung: {Icon, Bezeichnung, Wert} */
	private String[][] sessionStats() {
		String time = "–";
		if (sessionStart > 0) {
			long minutes = (System.currentTimeMillis() - sessionStart) / 60_000;
			time = minutes < 60 ? minutes + " min" : minutes / 60 + " h " + String.format("%02d", minutes % 60) + " min";
		}
		String position = minecraft.player == null ? "–"
				: minecraft.player.getBlockX() + ", " + minecraft.player.getBlockY() + ", " + minecraft.player.getBlockZ();
		String[] third;
		String[] fourth;
		if (minecraft.isLocalServer() || minecraft.getConnection() == null) {
			third = new String[] {"world", "Dimension", Waypoints.dimensionName(Waypoints.dimension(minecraft))};
			String mode = minecraft.gameMode == null ? "–" : minecraft.gameMode.getPlayerMode().getShortDisplayName().getString();
			fourth = new String[] {"user", "Spielmodus", mode};
		} else {
			PlayerInfo info = minecraft.player == null ? null : minecraft.getConnection().getPlayerInfo(minecraft.player.getUUID());
			third = new String[] {"signal", "Ping", info == null ? "–" : info.getLatency() + " ms"};
			fourth = new String[] {"friends", "Spieler", Integer.toString(minecraft.getConnection().getOnlinePlayers().size())};
		}
		return new String[][] {{"clock", "Spielzeit", time}, {"compass", "Position", position}, third, fourth};
	}

	/** Kleine Kachel: Icon, Bezeichnung darüber, Wert darunter */
	private void stat(GuiGraphicsExtractor g, int x, int y, int w, String icon, String label, String value) {
		Ui.rect(g, x, y, w, 20, 6, 0x0AFFFFFF);
		Ui.icon(g, icon, x + 6, y + 5.5f, 9, Ui.FAINT);
		Ui.text(g, Ui.ellipsize(label, w - 24, Ui.Font.SMALL), x + 20, y + 2, Ui.FAINT, Ui.Font.SMALL);
		Ui.text(g, Ui.ellipsize(value, w - 24, Ui.Font.SMALL), x + 20, y + 11, Ui.TEXT, Ui.Font.SMALL);
	}

	/** Karte: Fläche, Icon, Titel und ein Zusatz daneben */
	private void card(GuiGraphicsExtractor g, int x, int y, int w, int h, String icon, String title, String extra) {
		Ui.rect(g, x, y, w, h, 10, Ui.SURFACE);
		Ui.outline(g, x, y, w, h, 10, Ui.LINE);
		Ui.rect(g, x + 8, y + 6, 14, 14, 4, Ui.ACCENT_SOFT);
		Ui.icon(g, icon, x + 10.5f, y + 8.5f, 9, Ui.ACCENT_TEXT);
		Ui.text(g, title, x + 28, y + 9, Ui.TEXT, Ui.Font.LABEL);
		if (extra != null) {
			int ex = x + 34 + Ui.width(title, Ui.Font.LABEL);
			Ui.text(g, Ui.ellipsize(extra, x + w - 50 - ex, Ui.Font.SMALL), ex, y + 10, Ui.FAINT, Ui.Font.SMALL);
		}
	}

	/** Für den Autotest: Schnellschalter im Pausemenü */
	public List<ToggleChip> toggles() {
		return toggles;
	}

	@Override
	public void onClose() {
		resume();
	}
}
