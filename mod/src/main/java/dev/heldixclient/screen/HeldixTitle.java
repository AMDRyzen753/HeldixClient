package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.realmsclient.RealmsMainScreen;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.account.AccountSwitcher;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Tips;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.ui.WidgetStyle;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.CreditsAndAttributionScreen;
import net.minecraft.client.gui.screens.FaviconTexture;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.multiplayer.SafetyScreen;
import net.minecraft.client.gui.screens.options.AccessibilityOptionsScreen;
import net.minecraft.client.gui.screens.options.LanguageSelectScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.level.storage.LevelSummary;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Startseite im Hauptmenü von Minecraft (eingebaut über HeldixPatches/Hooks, die Klasse bleibt ein TitleScreen):
 * oben Logo, Profil und System-Knöpfe, in der Mitte Begrüßung mit der eigenen Spielfigur (mit Cape), "Weiterspielen",
 * die drei Spielarten und die Heldix-Bereiche; in breiten Fenstern rechts daneben „Zuletzt gespielt“ und „Freunde“;
 * unten Versionen und Copyright.
 */
public class HeldixTitle {
	private static final int GAP = 6;
	private static final int SIDE_GAP = 14;
	private static final int ROW_H = 34;
	/** Höhe des Kopfes einer Tafel rechts (Icon und Titel) */
	private static final int PANEL_HEAD = 30;
	private static final int REALMS = 0xFF8B5CF6;
	private static final int SERVERS = 0xFF22D3EE;
	private static final int WORLDS = 0xFF34D399;
	private static final int HELDIX_WORLDS = 0xFF3B82F6;

	private final Minecraft minecraft;
	private final long openedAt = Shell.openedAt();
	private final Tips.Tip tip = Tips.random();
	private final List<AbstractWidget> widgets = new ArrayList<>();
	private float fade = 1f;
	private Layout layout;
	private Screen screen;
	/** zuletzt gespielte Welten, neueste zuerst (wird im Hintergrund geladen) */
	private volatile List<LevelSummary> worlds = List.of();
	private volatile int worldCount = -1;
	private final List<ServerData> servers = new ArrayList<>();
	private final ServerData lastServer;
	/** Vorschaubilder: Welt-ID bzw. Server-Adresse → Textur */
	private final Map<String, Identifier> images = new HashMap<>();
	private volatile List<RecentRow.Entry> recent = List.of();
	private Supplier<PlayerSkin> skin;
	/** Fläche über dem Profil oben rechts: öffnet die Konten */
	private ProfileButton chipButton;
	/** schmale Fenster: „2 Freunde online“ unter den Knöpfen (statt der Tafel rechts) */
	private FriendsStrip friendsStrip;

	/**
	 * Maße der Startseite (GUI-Pixel); sideW = 0: keine rechte Spalte; figH = 0: keine Spielfigur.
	 * Rechts zwei Tafeln: „Zuletzt gespielt“ (recentY, recentH) und „Freunde“ (friendsY, friendsH).
	 * centeredTiles: schmale Kacheln mit Icon über dem Namen; stackedPills: Knöpfe mit Icon über kleiner Beschriftung;
	 * figBeside: die Spielfigur steht rechts neben Karte und Kacheln (kleine Fenster) statt über der Karte.
	 */
	private record Layout(int edge, int columnX, int columnW, boolean compact, int greetY, int heroY, int heroH, int tilesY, int tileH,
			int pillsY, int pillH, int tipY, int stripY, int sideX, int sideW, int recentY, int recentH, int friendsY, int friendsH,
			int figX, int figY, int figW, int figH, boolean centeredTiles, boolean stackedPills, boolean figBeside) {
	}

	private static final String[] TILE_LABELS = {"Einzelspieler", "Mehrspieler", "Heldix-Welten", "Realms"};
	/** Heldix-Bereiche unter den Kacheln: Name, Icon (die Seiten stehen in {@link #PILL_PAGES}) */
	private static final String[][] PILLS = {{"Module", "modules"}, {"Cosmetics", "sparkles"}, {"Grafik", "shader"}, {"HUD-Editor", "hud"},
			{"Einstellungen", "settings"}};
	private static final Shell.Page[] PILL_PAGES = {Shell.Page.MODULES, Shell.Page.COSMETICS, Shell.Page.SHADER, Shell.Page.HUD, Shell.Page.SETTINGS};

	/** Breite der Heldix-Knöpfe mit Icon und Text nebeneinander (samt Abständen) */
	private static int pillsInlineWidth() {
		int sum = (PILLS.length - 1) * GAP;
		for (String[] pill : PILLS) sum += Ui.width(pill[0], Ui.Font.LABEL) + 30;
		return sum;
	}

	public HeldixTitle(Minecraft minecraft) {
		this.minecraft = minecraft;
		ServerList list = new ServerList(minecraft);
		list.load();
		for (int i = 0; i < list.size(); i++) servers.add(list.get(i));
		this.lastServer = ServersScreen.lastServer(minecraft);
		// zuletzt besuchten Server nach vorn
		if (lastServer != null) {
			servers.removeIf(s -> s.ip.equalsIgnoreCase(lastServer.ip));
			servers.addFirst(lastServer);
		}
		for (ServerData server : servers.subList(0, Math.min(3, servers.size()))) loadServerIcon(server);
		// Live-Stand des zuletzt besuchten Servers für „Weiterspielen“ (wie in der Serverliste; höchstens einmal je Minute)
		if (lastServer != null && minecraft.allowsMultiplayer()) ServerPing.request(lastServer);
		buildRecent();
		loadWorlds();
	}

	public static boolean shouldReplace(Minecraft minecraft) {
		return minecraft != null && WidgetStyle.enabled() && !minecraft.isDemo();
	}

	private void loadWorlds() {
		try {
			var candidates = minecraft.getLevelSource().findLevelCandidates();
			if (candidates.isEmpty()) {
				worldCount = 0;
				return;
			}
			minecraft.getLevelSource().loadLevelSummaries(candidates).whenComplete((list, failure) -> minecraft.execute(() -> {
				List<LevelSummary> sorted = list == null ? List.of()
						: list.stream().sorted(Comparator.comparingLong(LevelSummary::getLastPlayed).reversed()).toList();
				for (LevelSummary summary : sorted.subList(0, Math.min(3, sorted.size()))) loadWorldIcon(summary);
				worlds = sorted;
				worldCount = sorted.size();
				buildRecent();
			}));
		} catch (Exception e) {
			worldCount = 0;
		}
	}

	private void loadWorldIcon(LevelSummary summary) {
		Path file = summary.getIcon();
		if (file == null || !Files.isRegularFile(file)) return;
		FaviconTexture texture = FaviconTexture.forWorld(minecraft.getTextureManager(), summary.getLevelId());
		try (InputStream in = Files.newInputStream(file)) {
			texture.upload(NativeImage.read(in));
			images.put("world:" + summary.getLevelId(), texture.textureLocation());
		} catch (Exception e) {
			texture.close();
		}
	}

	private void loadServerIcon(ServerData server) {
		byte[] bytes = server.getIconBytes();
		if (bytes == null) return;
		FaviconTexture texture = FaviconTexture.forServer(minecraft.getTextureManager(), server.ip);
		try {
			texture.upload(NativeImage.read(bytes));
			images.put("server:" + server.ip, texture.textureLocation());
		} catch (Exception e) {
			texture.close();
		}
	}

	/** „Zuletzt gespielt“: bis zu vier Einträge, Welten und Server gemischt */
	private void buildRecent() {
		List<LevelSummary> worldList = worlds.stream().filter(w -> !w.isLocked()).toList();
		int serverSlots = Math.min(servers.size(), Math.max(2, 4 - worldList.size()));
		int worldSlots = Math.min(worldList.size(), 4 - serverSlots);
		List<RecentRow.Entry> entries = new ArrayList<>();
		for (LevelSummary world : worldList.subList(0, worldSlots)) {
			entries.add(new RecentRow.Entry(world.getLevelName(), "Einzelspieler · " + ago(world.getLastPlayed()), "world",
					images.get("world:" + world.getLevelId()), () -> playWorld(world)));
		}
		for (ServerData server : servers.subList(0, serverSlots)) {
			entries.add(new RecentRow.Entry(ServersScreen.displayName(server), "Server · " + ServersScreen.shortAddress(server.ip), "server",
					images.get("server:" + server.ip), () -> joinServer(server)));
		}
		recent = entries;
	}

	private static Layout layout(int width, int height) {
		int edge = width < 520 || height < 300 ? 8 : 16;
		boolean compact = height < 330;
		int columnW = Math.min(width - edge * 2, Math.max(330, Math.min(470, width * 40 / 100)));
		// breite Fenster: rechts eine Spalte „Zuletzt gespielt“
		int sideW = !compact && width - edge * 2 >= columnW + SIDE_GAP + 250 ? Math.min(300, width - edge * 2 - columnW - SIDE_GAP) : 0;
		// kleine Fenster ohne rechte Spalte: die Spielfigur rechts neben Karte und Kacheln (über der Karte ist dort kein Platz);
		// die Spalte darf dafür bis auf 300 Pixel schmaler werden
		int besideW = 0;
		if (compact && sideW == 0) {
			int want = 62;
			int free = width - edge * 2 - columnW;
			if (free < want + SIDE_GAP) columnW = Math.max(300, columnW - (want + SIDE_GAP - free));
			free = width - edge * 2 - columnW;
			if (free >= 44 + SIDE_GAP) besideW = Math.min(want, free - SIDE_GAP);
		}
		int total = columnW + (sideW > 0 ? SIDE_GAP + sideW : besideW > 0 ? SIDE_GAP + besideW : 0);
		int columnX = (width - total) / 2;

		// Kacheln: passt ein Name nicht neben sein Icon, stehen Icon und Name untereinander (mittig)
		int tileW = (columnW - 3 * GAP) / 4;
		int inline = 0;
		for (String label : TILE_LABELS) inline = Math.max(inline, StartCard.inlineWidth(label));
		boolean centeredTiles = tileW < inline;
		// Heldix-Knöpfe: Icon und Text nebeneinander, sonst Icon über kleiner Beschriftung
		boolean stackedPills = pillsInlineWidth() > columnW;

		int greetH = compact ? 14 : 34;
		int greetGap = compact ? 8 : 10;
		int heroH = compact ? 36 : 46;
		int tileH = compact ? (centeredTiles ? 50 : 40) : 64;
		int pillH = stackedPills ? 30 : 20;
		int tipH = compact ? 0 : 22;
		// ohne rechte Spalte: Freunde-Zeile unter den Knöpfen (in großen Fenstern an Stelle des Tipps)
		int stripH = compact && sideW == 0 ? 26 : 0;
		int blockH = greetH + greetGap + heroH + GAP + 2 + tileH + GAP + 2 + pillH + tipH + stripH;
		int top = edge + 28;
		int bottom = height - edge - 16;
		int y = top + Math.max(0, (bottom - top - blockH) * 45 / 100);
		int heroY = y + greetH + greetGap;
		int tilesY = heroY + heroH + GAP + 2;
		int pillsY = tilesY + tileH + GAP + 2;
		int tipY = compact ? -1 : pillsY + pillH + 12;
		int stripY = tipY >= 0 ? tipY - 5 : pillsY + pillH + 8;
		// rechte Spalte so hoch wie die linke (mit Tipp): oben Zuletzt gespielt, unten Freunde
		int sideBottom = tipY >= 0 ? tipY + 10 : pillsY + pillH;
		int half = (sideBottom - y - GAP) / 2;

		int figX;
		int figY;
		int figW;
		int figH;
		if (besideW > 0) {
			// neben Karte und Kacheln, von der Begrüßung bis zum Ende der Kacheln
			figH = Math.min(Math.round(besideW / 0.62f), tilesY + tileH - y);
			figW = Math.round(figH * 0.62f);
			figX = columnX + columnW + SIDE_GAP + (besideW - figW) / 2;
			figY = tilesY + tileH - figH;
		} else {
			// steht rechts auf der Karte „Weiterspielen“, so hoch, wie über der Begrüßung Platz ist
			figH = Math.min(112, heroY + 4 - (top + 4));
			if (figH < 40) figH = 0;
			figW = Math.round(figH * 0.62f);
			figX = columnX + columnW - figW - 6;
			figY = heroY + 4 - figH;
		}
		return new Layout(edge, columnX, columnW, compact, y, heroY, heroH, tilesY, tileH, pillsY, pillH, tipY, stripY,
				columnX + columnW + SIDE_GAP, sideW, y, half, y + half + GAP, sideBottom - y - half - GAP,
				figX, figY, figW, figH, centeredTiles, stackedPills, besideW > 0);
	}

	// ---------- Widgets ----------

	public List<AbstractWidget> createWidgets(Screen screen, int width, int height) {
		this.screen = screen;
		widgets.clear();
		layout = layout(width, height);
		Layout l = layout;

		// Weiterspielen
		widgets.add(new StartCard(l.columnX(), l.heroY(), l.columnW(), l.heroH(), StartCard.Style.HERO, "Weiterspielen", "play", Ui.ACCENT,
				this::heroContent, this::continuePlaying));

		// Einzelspieler, Mehrspieler, Heldix-Welten, Realms
		int tileW = (l.columnW() - 3 * GAP) / 4;
		boolean centered = l.centeredTiles();
		widgets.add(new StartCard(l.columnX(), l.tilesY(), tileW, l.tileH(), StartCard.Style.TILE, "Einzelspieler", "world", WORLDS,
				() -> new StartCard.Content("Einzelspieler", worldCount < 0 ? "Lädt …" : count(worldCount, "Welt", "Welten"), true),
				() -> minecraft.gui.setScreen(new WorldsScreen())).centered(centered));
		widgets.add(new StartCard(l.columnX() + tileW + GAP, l.tilesY(), tileW, l.tileH(), StartCard.Style.TILE, "Mehrspieler", "server", SERVERS,
				this::serversContent, () -> Shell.open(minecraft, Shell.Page.SERVERS, screen)).centered(centered));
		widgets.add(new StartCard(l.columnX() + 2 * (tileW + GAP), l.tilesY(), tileW, l.tileH(), StartCard.Style.TILE, "Heldix-Welten", "lan", HELDIX_WORLDS,
				() -> heldixWorldsContent(centered), () -> Shell.open(minecraft, Shell.Page.HELDIX_WORLDS, screen)).centered(centered));
		widgets.add(new StartCard(l.columnX() + 3 * (tileW + GAP), l.tilesY(), l.columnW() - 3 * (tileW + GAP), l.tileH(), StartCard.Style.TILE,
				"Realms", "realms", REALMS, () -> new StartCard.Content("Realms", centered ? "Mojang" : "Welten von Mojang", true),
				() -> minecraft.gui.setScreen(new RealmsMainScreen(screen))).centered(centered));

		// eigene Spielfigur mit Cape (Klick: Cape-Auswahl)
		if (l.figH() > 0) {
			widgets.add(new FigureWidget(l.figX(), l.figY(), l.figW(), l.figH(), () -> Shell.open(minecraft, Shell.Page.CAPE, screen)));
		}

		// Heldix-Bereiche: immer beschriftet – Icon und Text nebeneinander (Breite nach Text, übriger Platz gleichmäßig
		// verteilt) oder, wenn das nicht passt, gleich breite Knöpfe mit Icon über kleiner Beschriftung
		int sum = pillsInlineWidth();
		int extra = l.stackedPills() ? 0 : (l.columnW() - sum) / PILLS.length;
		int px = l.columnX();
		for (int i = 0; i < PILLS.length; i++) {
			Shell.Page page = PILL_PAGES[i];
			int w = l.stackedPills() ? (l.columnW() - (PILLS.length - 1) * GAP) / PILLS.length : Ui.width(PILLS[i][0], Ui.Font.LABEL) + 30 + extra;
			if (i == PILLS.length - 1) w = l.columnX() + l.columnW() - px;
			ActionButton pill = new ActionButton(px, l.pillsY(), w, l.pillH(), PILLS[i][0], false, () -> Shell.open(minecraft, page, screen))
					.withIcon(PILLS[i][1]).withVariant(ActionButton.Variant.SOLID);
			if (l.stackedPills()) pill.withStackedLabel();
			px += w + GAP;
			widgets.add(pill);
		}

		// schmale Fenster: Freunde als Zeile unter den Knöpfen (anstelle des Tipps)
		friendsStrip = null;
		if (l.sideW() == 0 && l.stripY() + 18 <= height - l.edge() - 12) {
			friendsStrip = new FriendsStrip(l.columnX(), l.stripY(), l.columnW(), 18, () -> Shell.open(minecraft, Shell.Page.FRIENDS, screen));
			widgets.add(friendsStrip);
		}

		// rechts: Zuletzt gespielt und Freunde
		if (l.sideW() > 0) {
			int recentRows = Math.clamp((l.recentH() - PANEL_HEAD - 4) / (ROW_H + 2), 1, 3);
			for (int i = 0; i < recentRows; i++) {
				int index = i;
				widgets.add(new RecentRow(l.sideX() + 6, l.recentY() + PANEL_HEAD + i * (ROW_H + 2), l.sideW() - 12, ROW_H,
						() -> index < recent.size() ? recent.get(index) : null));
			}
			int friendRows = Math.clamp((l.friendsH() - PANEL_HEAD - 4) / (ROW_H + 2), 1, 3);
			// Party (ab Heldix-Dienst 1.12.0): erste Zeile, solange es eine Party oder Einladung gibt; die Freunde rücken dann nach
			boolean partyRow = friendRows >= 2;
			if (partyRow) {
				widgets.add(new PartyWidget(l.sideX() + 6, l.friendsY() + PANEL_HEAD, l.sideW() - 12, ROW_H,
						() -> Shell.open(minecraft, Shell.Page.PARTY, screen)));
			}
			for (int i = 0; i < friendRows; i++) {
				int index = i;
				widgets.add(new FriendWidget(l.sideX() + 6, l.friendsY() + PANEL_HEAD + i * (ROW_H + 2), l.sideW() - 12, ROW_H,
						() -> friendAt(partyRow && PartyWidget.hasContent() ? index - 1 : index), () -> Shell.open(minecraft, Shell.Page.FRIENDS, screen)));
			}
			String all = "Alle";
			int aw = ActionButton.widthFor(all, "chevron-right") - 4;
			widgets.add(new ActionButton(l.sideX() + l.sideW() - 8 - aw, l.friendsY() + 6, aw, 18, all, false,
					() -> Shell.open(minecraft, Shell.Page.FRIENDS, screen)).withIcon("chevron-right").withVariant(ActionButton.Variant.GHOST));
		}

		// oben rechts: Optionen, Sprache, Barrierefreiheit, Beenden
		int bx = width - l.edge() - 20;
		int by = l.edge();
		widgets.add(ActionButton.icon(bx, by, 20, "quit", "Beenden", minecraft::stop).withVariant(ActionButton.Variant.GHOST));
		bx -= 24;
		widgets.add(ActionButton.icon(bx, by, 20, "accessibility", "Barrierefreiheit",
				() -> minecraft.gui.setScreen(new AccessibilityOptionsScreen(screen, minecraft.options))));
		bx -= 24;
		widgets.add(ActionButton.icon(bx, by, 20, "language", "Sprache",
				() -> minecraft.gui.setScreen(new LanguageSelectScreen(screen, minecraft.options, minecraft.getLanguageManager()))));
		bx -= 24;
		widgets.add(ActionButton.icon(bx, by, 20, "options", "Optionen", () -> minecraft.gui.setScreen(new OptionsScreen(screen, minecraft.options))));
		// Profil daneben: Lage und Breite setzt extractDecorations (hängen am Namen)
		chipButton = new ProfileButton(bx - 4, by, 0, 20, 10, () -> Shell.open(minecraft, Shell.Page.ACCOUNTS, screen));
		chipButton.visible = false;
		widgets.add(chipButton);

		// Copyright (Pflicht im Hauptmenü)
		String copyright = "Copyright Mojang AB. Do not distribute!";
		int cw = Ui.width(copyright, Ui.Font.SMALL);
		widgets.add(new TextLink(width - l.edge() - cw, height - l.edge() - 9, cw, 10, copyright,
				() -> minecraft.gui.setScreen(new CreditsAndAttributionScreen(screen))));
		return widgets;
	}

	/** Freund Nummer index für die Tafel: online zuerst (die Liste ist schon so sortiert) */
	private static Social.Friend friendAt(int index) {
		if (!Social.online() || index < 0) return null;
		List<Social.Friend> friends = Social.friends();
		return index < friends.size() ? friends.get(index) : null;
	}

	private static String count(int n, String one, String many) {
		return n + " " + (n == 1 ? one : many);
	}

	private LevelSummary lastWorld() {
		List<LevelSummary> list = worlds;
		return list.isEmpty() ? null : list.getFirst();
	}

	/** Server zuletzt besucht und nach der letzten Welt? Dann führt "Weiterspielen" dorthin. */
	private boolean serverIsNewer() {
		HeldixConfig.Data config = HeldixConfig.get();
		if (lastServer == null || config.lastServerIp == null) return false;
		LevelSummary world = lastWorld();
		return world == null || config.lastServerAt > world.getLastPlayed();
	}

	private StartCard.Content heroContent() {
		if (serverIsNewer()) {
			return new StartCard.Content(ServersScreen.displayName(lastServer), serverDetail(lastServer), minecraft.allowsMultiplayer(), null,
					images.get("server:" + lastServer.ip));
		}
		if (worldCount < 0) return new StartCard.Content("Lädt …", "", false);
		LevelSummary world = lastWorld();
		if (world == null) return new StartCard.Content("Erste Welt erstellen", "Überleben, Kreativ oder Hardcore", true, "plus");
		if (world.isLocked()) return new StartCard.Content(world.getLevelName(), "Gerade in einem anderen Fenster geöffnet", false);
		return new StartCard.Content(world.getLevelName(), "Einzelspieler  ·  zuletzt " + ago(world.getLastPlayed()), true, null,
				images.get("world:" + world.getLevelId()));
	}

	/**
	 * Zeile unter dem Servernamen: „Mehrspieler“, die Adresse nur, wenn sie nicht schon der Name ist, und der Live-Stand
	 * („153 online · 24 ms“ bzw. „gerade nicht erreichbar“). Eine andere Protokollnummer verschweigt sie: Viele Netzwerke
	 * melden ihre Grundversion und lassen trotzdem jede Version herein.
	 */
	static String serverDetail(ServerData server) {
		String address = ServersScreen.shortAddress(server.ip);
		String detail = ServersScreen.displayName(server).equalsIgnoreCase(address) ? "Mehrspieler" : "Mehrspieler  ·  " + address;
		ServerPing.Result result = ServerPing.result(server.ip);
		if (result == null || result.state() == ServerData.State.PINGING) return detail;
		if (result.state() == ServerData.State.UNREACHABLE) return detail + "  ·  gerade nicht erreichbar";
		String summary = ServerPing.summary(result);
		return summary == null ? detail : detail + "  ·  " + summary;
	}

	/** Heldix-Welten: Einladungen von Freunden zählen, sonst ein kurzer Hinweis (in schmalen Kacheln kürzer) */
	private StartCard.Content heldixWorldsContent(boolean narrow) {
		int invites = dev.heldixclient.share.WorldInvites.recent().size();
		if (invites > 0) return new StartCard.Content("Heldix-Welten", count(invites, "Einladung", "Einladungen"), true);
		String hint = Social.online() ? (narrow ? "Von Freunden" : "Welten von Freunden") : (narrow ? "Heldix-Dienst" : "Mit Heldix-Dienst");
		return new StartCard.Content("Heldix-Welten", hint, true);
	}

	private StartCard.Content serversContent() {
		if (!minecraft.allowsMultiplayer()) return new StartCard.Content("Mehrspieler", "Für dieses Konto gesperrt", false);
		return new StartCard.Content("Mehrspieler", servers.isEmpty() ? "Server hinzufügen" : count(servers.size(), "Server", "Server"), true);
	}

	private static String ago(long millis) {
		if (millis <= 0) return "noch nie";
		long minutes = (System.currentTimeMillis() - millis) / 60_000;
		if (minutes < 1) return "gerade eben";
		if (minutes < 60) return "vor " + minutes + " Min.";
		long hours = minutes / 60;
		if (hours < 24) return "vor " + hours + (hours == 1 ? " Stunde" : " Stunden");
		long days = hours / 24;
		return "vor " + days + (days == 1 ? " Tag" : " Tagen");
	}

	private void continuePlaying() {
		if (serverIsNewer()) {
			joinServer(lastServer);
			return;
		}
		LevelSummary world = lastWorld();
		if (world == null) {
			CreateWorldScreen.openFresh(minecraft, () -> minecraft.gui.setScreen(new WorldsScreen()));
			return;
		}
		playWorld(world);
	}

	private void playWorld(LevelSummary world) {
		WorldsScreen worldsScreen = new WorldsScreen();
		minecraft.gui.setScreen(worldsScreen);
		worldsScreen.play(world);
	}

	private void joinServer(ServerData server) {
		if (!minecraft.options.skipMultiplayerWarning) {
			minecraft.gui.setScreen(new SafetyScreen(screen));
			return;
		}
		ConnectScreen.startConnecting(new ServersScreen(), minecraft, ServerAddress.parseString(server.ip), server, false, null);
	}

	// ---------- Zeichnen ----------

	/** Hintergrund: Heldix-Motiv (oder das schon gezeichnete Panorama) und eine Abdunkelung nach unten. */
	public void extractBackground(GuiGraphicsExtractor g, int width, int height) {
		fade = Shell.frame(openedAt);
		if (HeldixConfig.get().heldixBackground) Ui.background(g, width, height, 1f);
		g.fillGradient(0, 0, width, height, Ui.withAlpha(0x59060A13, fade), Ui.withAlpha(0xC7060A13, fade));
	}

	/** Logo, Profil, Begrüßung, Zuletzt gespielt, Tipp und Versionen; Karten und Knöpfe zeichnen sich als Widgets selbst. */
	public void extractDecorations(GuiGraphicsExtractor g, Font font, int width, int height) {
		for (AbstractWidget widget : widgets) {
			widget.setAlpha(fade);
			// Party-Zeile nach Stand; Freunde-Zeilen blenden sich selbst aus, wenn es den Freund nicht (mehr) gibt
			if (widget instanceof PartyWidget) widget.visible = PartyWidget.hasContent();
			else if (widget instanceof FriendWidget) widget.visible = true;
		}
		Layout l = layout != null ? layout : layout(width, height);
		int edge = l.edge();
		// Abfrage des letzten Servers weiterlaufen lassen
		ServerPing.tick();

		// Logo oben links
		Ui.logo(g, edge, edge + 1, 18, fade);
		Ui.text(g, "Heldix", edge + 24, edge + 6, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.LABEL);
		Ui.text(g, "Client", edge + 24 + Ui.width("Heldix ", Ui.Font.LABEL), edge + 6, Ui.withAlpha(Ui.ACCENT_TEXT, fade), Ui.Font.LABEL);

		// Profil oben rechts, links neben den Knöpfen; mit Kontowechsel (vom Launcher angeboten) anklickbar
		String name = minecraft.getUser().getName();
		int nameW = Ui.width(name, Ui.Font.LABEL);
		boolean switchable = AccountSwitcher.available();
		int chipW = nameW + (switchable ? 42 : 32);
		int chipX = width - edge - 4 * 24 - 4 - chipW;
		boolean chipShown = chipX > edge + 110;
		if (chipShown) {
			Ui.rect(g, chipX, edge, chipW, 20, 10, Ui.withAlpha(0xCC0F1420, fade));
			Ui.outline(g, chipX, edge, chipW, 20, 10, Ui.withAlpha(Ui.LINE_STRONG, fade));
			if (skin == null) skin = minecraft.getSkinManager().createLookup(minecraft.getGameProfile(), false);
			PlayerFaceExtractor.extractRenderState(g, skin.get(), chipX + 5, edge + 4, 12);
			Ui.text(g, name, chipX + 22, edge + 6, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.LABEL);
			if (switchable) Ui.icon(g, "chevron-down", chipX + chipW - 17, edge + 6, 8, Ui.withAlpha(Ui.MUTED, fade));
		}
		if (chipButton != null) {
			chipButton.setX(chipX);
			chipButton.setWidth(chipW);
			chipButton.visible = chipShown;
		}

		// Begrüßung
		int hour = LocalTime.now().getHour();
		String greeting = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend";
		// steht die Figur über der Karte, endet die Begrüßung vor ihr
		int figureW = l.figH() > 0 && !l.figBeside() ? l.figW() + 14 : 0;
		if (l.compact()) {
			int greetW = Ui.width(greeting + ", ", Ui.Font.TITLE);
			int compactNameW = l.columnW() - greetW - figureW;
			Ui.text(g, greeting + ", ", l.columnX(), l.greetY(), Ui.withAlpha(Ui.MUTED, fade), Ui.Font.TITLE);
			Ui.text(g, Ui.ellipsize(name, compactNameW, Ui.Font.TITLE), l.columnX() + greetW, l.greetY(), Ui.withAlpha(Ui.TEXT, fade), Ui.Font.TITLE);
		} else {
			int greetNameW = l.columnW() - figureW;
			Ui.text(g, greeting + ",", l.columnX() + 1, l.greetY(), Ui.withAlpha(Ui.MUTED, fade), Ui.Font.BODY);
			Ui.text(g, Ui.ellipsize(name, greetNameW, Ui.Font.HERO), l.columnX(), l.greetY() + 11, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.HERO);
		}

		// rechte Spalte: Zuletzt gespielt und Freunde
		if (l.sideW() > 0) {
			panel(g, l, l.recentY(), l.recentH(), "clock", "Zuletzt gespielt", null);
			if (recent.isEmpty()) {
				String empty = worldCount < 0 ? "Lädt …" : "Deine Welten und Server erscheinen hier.";
				Ui.text(g, Ui.ellipsize(empty, l.sideW() - 24, Ui.Font.SMALL), l.sideX() + 12, l.recentY() + PANEL_HEAD + 8,
						Ui.withAlpha(Ui.FAINT, fade), Ui.Font.SMALL);
			}
			List<Social.Friend> friends = Social.online() ? Social.friends() : List.of();
			long online = friends.stream().filter(Social.Friend::online).count();
			panel(g, l, l.friendsY(), l.friendsH(), "friends", "Freunde", friends.isEmpty() ? null : online + " von " + friends.size() + " online");
			String hint = FriendWidget.serviceHint();
			if (hint == null && friends.isEmpty()) hint = "Noch keine Freunde – unter „Alle“ fügst du welche hinzu.";
			if (hint != null) {
				int ty = l.friendsY() + PANEL_HEAD + 8;
				for (net.minecraft.util.FormattedCharSequence line : Ui.wrap(hint, l.sideW() - 24, Ui.Font.SMALL)) {
					g.text(font, line, l.sideX() + 12, ty, Ui.withAlpha(Ui.FAINT, fade), false);
					ty += 10;
				}
			}
		}

		// Freunde-Zeile nur mit Freunden; sonst an ihrer Stelle der Tipp
		boolean strip = friendsStrip != null && FriendsStrip.hasContent();
		if (friendsStrip != null) friendsStrip.visible = strip;

		// Tipp unter den Knöpfen
		if (!strip && l.tipY() >= 0 && l.tipY() + 10 < height - edge - 16) {
			String text = Ui.ellipsize(tip.text(), l.columnW() - 20, Ui.Font.SMALL);
			int tw = Ui.width(text, Ui.Font.SMALL) + 14;
			int tx = l.columnX() + (l.columnW() - tw) / 2;
			Ui.icon(g, tip.icon(), tx, l.tipY() - 1, 9, Ui.withAlpha(Ui.WARNING, fade));
			Ui.text(g, text, tx + 14, l.tipY(), Ui.withAlpha(Ui.MUTED, fade), Ui.Font.SMALL);
		}

		// Versionen unten links
		String version = "Minecraft " + SharedConstants.getCurrentVersion().name() + "  ·  HeldixClient " + HeldixClient.version
				+ "  ·  Heldix Loader " + HeldixLoader.version();
		Ui.text(g, version, edge, height - edge - 9, Ui.withAlpha(Ui.FAINT, fade), Ui.Font.SMALL);
	}

	/** Tafel rechts: Fläche, Icon, Titel und optional ein Zusatz rechts daneben */
	private void panel(GuiGraphicsExtractor g, Layout l, int top, int height, String icon, String title, String extra) {
		Ui.shadow(g, l.sideX(), top, l.sideW(), height, 0.3f * fade);
		Ui.rect(g, l.sideX(), top, l.sideW(), height, 12, Ui.withAlpha(0xD90F1420, fade));
		Ui.outline(g, l.sideX(), top, l.sideW(), height, 12, Ui.withAlpha(Ui.LINE_STRONG, fade));
		Ui.rect(g, l.sideX() + 10, top + 8, 16, 16, 5, Ui.withAlpha(Ui.ACCENT_SOFT, fade));
		Ui.icon(g, icon, l.sideX() + 13, top + 11, 10, Ui.withAlpha(Ui.ACCENT_TEXT, fade));
		Ui.text(g, title, l.sideX() + 32, top + 12, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.LABEL);
		if (extra != null) {
			Ui.text(g, extra, l.sideX() + 38 + Ui.width(title, Ui.Font.LABEL), top + 13, Ui.withAlpha(Ui.FAINT, fade), Ui.Font.SMALL);
		}
	}

	/** Nach den Widgets: Tooltips der Knöpfe */
	public void afterRender(GuiGraphicsExtractor g, int width, int height) {
		Ui.drawTooltip(g, width, height);
	}

	/** Klickbarer Text (Copyright → Mitwirkende) */
	private static final class TextLink extends AbstractButton {
		private final Runnable action;

		TextLink(int x, int y, int width, int height, String text, Runnable action) {
			super(x, y, width, height, Component.literal(text));
			this.action = action;
		}

		@Override
		public void onPress(InputWithModifiers input) {
			action.run();
		}

		@Override
		protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
			int color = isHoveredOrFocused() ? Ui.TEXT : Ui.FAINT;
			Ui.text(g, getMessage().getString(), getX(), getY() + 1, Ui.withAlpha(color, alpha), Ui.Font.SMALL);
			if (isHoveredOrFocused()) Ui.hline(g, getX(), getX() + getWidth(), getY() + 10, Ui.withAlpha(color, alpha));
		}

		@Override
		protected void updateWidgetNarration(NarrationElementOutput output) {
			defaultButtonNarrationText(output);
		}
	}
}
