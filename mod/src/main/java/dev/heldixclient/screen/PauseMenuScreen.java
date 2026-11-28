package dev.heldixclient.screen;

import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.module.Module;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.social.Invites;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.voice.VoiceLink;
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
 * Links die gewohnten Knöpfe, darunter (am unteren Rand, über „Verbindung trennen“) die Voice-Schalter – mit verbundenem
 * Voice Chat – und die Schnellschalter für Module; die Knöpfe wachsen in den übrigen Platz, damit keine Lücke bleibt.
 * Rechts (in breiten Fenstern) Karten für die Sitzung (Spielzeit, Position, Ping, Spieler; Server-Adresse kopieren),
 * Freunde (mit „Freunde einladen“ und Party im Fuß der Karte) und Wegpunkte. In schmalen Fenstern eine Schnellzeile.
 * Das Vanilla-Pausemenü mit Knöpfen anderer Mods bleibt über "Klassisches Pausemenü" erreichbar.
 */
public class PauseMenuScreen extends ShellScreen {
	private static final int CARD_HEAD = 26;
	private static final int SESSION_H = CARD_HEAD + 2 * 24 + 4;
	private static final int WAYPOINTS_H = CARD_HEAD + 26;
	private static final int TOGGLE_ROW = 24;
	/** Fuß der Freunde-Karte (Einladen, Browser-Link, Party) */
	private static final int FRIENDS_FOOT = 28;
	private static final int MAX_QUICK_ROWS = 6;
	/** so hoch dürfen die Knöpfe links höchstens werden, wenn sie den freien Platz füllen */
	private static final int MAX_ROW_H = 34;
	private static final String VOICE_ADDON = "voicechat";

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
	/** Knopf für den Browser-Link der Voice-Gruppe da? */
	private boolean inviteVoice;
	private int friendsHeaderRight;
	/** Voice-Schalter (Mikrofon, Ton) beim Aufbau gezeigt? */
	private boolean voiceShown;

	/** Beschriftung des Knopfs im Fuß der Freunde-Karte (Einladungslink kopieren), auch für den Autotest */
	public static final String INVITE_BUTTON = "Freunde einladen";
	public static final String BROWSER_LINK_BUTTON = "Browser-Link für die Voice-Gruppe kopieren (24 Std.)";
	public static final String PARTY_BUTTON = "Party";
	public static final String COPY_ADDRESS_BUTTON = "Server-Adresse kopieren";
	/** Voice-Schalter links (nur mit verbundenem Voice Chat) */
	public static final String VOICE_MIC = "Mikrofon";
	public static final String VOICE_SOUND = "Ton";
	/** Knopf „Welt teilen“ (Einzelspieler) und die Knöpfe der Karte „Welt geteilt“ */
	public static final String SHARE_BUTTON = "Welt teilen";
	public static final String SHARE_COPY_BUTTON = "Adresse kopieren";
	public static final String SHARE_MANAGE_BUTTON = "Verwalten";
	/** Stand der Karte „Welt geteilt“ beim Aufbau (ändert er sich, wird neu aufgebaut) */
	private String shareSignature;
	private boolean shareCard;
	private String waypointMessage;
	private long waypointMessageAt;
	private long addressCopiedAt;
	private boolean quickRow;
	private int leftGap;
	private boolean rowsCapped;
	private final List<ToggleChip> toggles = new ArrayList<>();
	private final List<ToggleChip> voiceToggles = new ArrayList<>();

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

	/** Server im Mehrspieler (nicht Einzelspieler), sonst null */
	private ServerData currentServer() {
		ServerData server = minecraft.getCurrentServer();
		return server != null && !minecraft.isLocalServer() ? server : null;
	}

	/** Voice Chat verbunden und seine Tasten für Mikrofon und Ton da? */
	private static boolean voiceAvailable() {
		return VoiceLink.status() == VoiceLink.Status.CONNECTED && AddonManager.hasKey(VOICE_ADDON, "mute") && AddonManager.hasKey(VOICE_ADDON, "deafen");
	}

	@Override
	protected void initContent() {
		toggles.clear();
		voiceToggles.clear();
		voiceShown = false;
		quickH = 0;
		boolean small = contentH < 190;
		int bigH = small ? 24 : 30;
		int rowH = small ? 22 : 26;
		int gap = small ? 6 : 8;
		boolean twoColumns = contentW >= 400 && contentH >= 170;
		int x = contentX;
		int w = twoColumns ? (contentW - 12) * 56 / 100 : contentW;
		int y = contentY;
		// Ping wie in der Serverliste, falls der Server in der Tab-Liste keinen meldet
		ServerData server = currentServer();
		if (server != null) ServerPing.request(server);

		addRenderableWidget(new ActionButton(x, y, w, bigH, "Zurück zum Spiel", true, this::resume).withIcon("play"));
		y += bigH + gap;

		List<Entry> entries = new ArrayList<>();
		entries.add(new Entry("Fortschritte", "star", () -> open(() -> new AdvancementsScreen(minecraft.player.connection.getAdvancements(), this))));
		entries.add(new Entry("Statistiken", "list", () -> open(() -> new StatsScreen(this, minecraft.player.getStats()))));
		entries.add(new Entry("Optionen", "options", () -> open(() -> new OptionsScreen(this, minecraft.options))));
		if (minecraft.isLocalServer()) {
			entries.add(new Entry("Welt-Optionen", "world", () -> open(() -> new WorldOptionsScreen(this, minecraft.level))));
			// Welt teilen über den Heldix-Dienst (neben „Im LAN öffnen“ in den Welt-Optionen)
			entries.add(new Entry(SHARE_BUTTON, "lan", () -> open(ShareWorldScreen::new)));
		} else {
			entries.add(new Entry("Spieler", "user", () -> open(() -> new SocialInteractionsScreen(this))));
		}
		entries.add(new Entry("Module", "modules", () -> open(() -> new HeldixMenuScreen(this, Shell.Page.MODULES))));
		entries.add(new Entry("HUD-Editor", "hud", () -> open(() -> new HudEditorScreen(this))));

		int bottom = contentY + contentH;
		int leaveTop = bottom - rowH;
		// bis über den Verlassen-Knopf; die letzte Reihe braucht keinen Abstand nach unten
		int rowsAvailable = Math.max(1, (leaveTop - gap - y + gap) / (rowH + gap));
		quickRow = false;
		if (!twoColumns) {
			// schmale Fenster: die neuen Bereiche als Schnellzeile (Schalter, Wegpunkt, Freunde) unter den Knöpfen –
			// passt sie nicht, als zwei weitere Knöpfe
			int baseRows = (entries.size() + 1) / 2;
			int quickRowY = y + baseRows * (rowH + gap);
			quickRow = quickRowY + 22 <= leaveTop - gap;
			if (quickRow) {
				buildQuickRow(x, quickRowY, w);
			} else {
				entries.add(new Entry("Freunde", "friends", () -> open(() -> new HeldixMenuScreen(this, Shell.Page.FRIENDS))));
				entries.add(new Entry("Wegpunkte", "pin", () -> open(() -> new HeldixMenuScreen(this, Shell.Page.WAYPOINTS))));
			}
		}
		// passen nicht alle Knöpfe in zwei Spalten (z. B. „Welt teilen“ in kleinen Fenstern), dann drei
		int columns = entries.size() > rowsAvailable * 2 && (w - 2 * gap) / 3 >= 100 ? 3 : 2;
		// zweispaltig mit mehr als sechs Knöpfen (Einzelspieler): drei nebeneinander, damit unten mehr Schnellschalter passen
		if (twoColumns && entries.size() > 6 && (w - 2 * gap) / 3 >= 110) columns = 3;
		int shown = Math.min(entries.size(), rowsAvailable * columns);
		int gridRows = (shown + columns - 1) / columns;
		int cellH = rowH;

		if (twoColumns) {
			// unten (über „Verbindung trennen“): Schnellschalter, darüber die Voice-Schalter; die Knöpfe füllen den Rest
			int above = leaveTop - gap;
			int gridH = gridRows * rowH + (gridRows - 1) * gap;
			int free = above - (y + gridH + gap);
			boolean voice = voiceAvailable() && free >= 22;
			if (voice) free -= 22 + gap;
			int quickRows = Math.clamp((free - 4 - CARD_HEAD - 4) / TOGGLE_ROW, 0, MAX_QUICK_ROWS);
			List<Module> modules = quickModules(quickRows * 2);
			quickRows = modules.isEmpty() ? 0 : (modules.size() + 1) / 2;
			int quickCardH = quickRows > 0 ? CARD_HEAD + quickRows * TOGGLE_ROW + 4 : 0;
			int quickTop = above - quickCardH;
			int voiceY = (quickRows > 0 ? quickTop - gap : above) - 22;
			int gridLimit = voice ? voiceY - gap : quickRows > 0 ? quickTop - gap - 4 : above;
			cellH = Math.clamp((gridLimit - y - (gridRows - 1) * gap) / Math.max(1, gridRows), rowH, MAX_ROW_H);
			int gridBottom = y + gridRows * cellH + (gridRows - 1) * gap;
			leftGap = (voice ? voiceY : quickRows > 0 ? quickTop : leaveTop) - gridBottom;
			rowsCapped = cellH == MAX_ROW_H;
			if (voice) buildVoiceRow(x, voiceY, w);
			if (quickRows > 0) buildQuickCard(x, quickTop, w, modules);
		}

		int cellW = (w - (columns - 1) * gap) / columns;
		for (int i = 0; i < shown; i++) {
			Entry entry = entries.get(i);
			int column = i % columns;
			int bx = x + column * (cellW + gap);
			int by = y + (i / columns) * (cellH + gap);
			// letzte Spalte bis zum Rand; der letzte Knopf füllt seine Reihe
			int bw = column == columns - 1 || i == shown - 1 ? x + w - bx : cellW;
			addRenderableWidget(new ActionButton(bx, by, bw, cellH, entry.label(), false, entry.action()).withIcon(entry.icon()));
		}

		String leave = minecraft.isLocalServer() ? "Speichern und zum Hauptmenü" : "Verbindung trennen";
		disconnect = new ActionButton(x, leaveTop, w, rowH, leave, false, this::leave).withIcon("quit").withVariant(ActionButton.Variant.DANGER);
		addRenderableWidget(disconnect);

		String classic = "Klassisches Pausemenü";
		int cw = ActionButton.widthFor(classic, "external");
		addRenderableWidget(new ActionButton(headerRight() - cw, headerButtonY(), cw, 20, classic, false,
				() -> Shell.openVanilla(minecraft, new PauseScreen(true))).withIcon("external").withVariant(ActionButton.Variant.GHOST));

		sideW = twoColumns ? contentW - w - 12 : 0;
		if (twoColumns) buildSide(x + w + 12, bottom);
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

	/** Voice-Schalter: Mikrofon und Ton (lösen die Tasten des Voice Chats aus, wie ein Tastendruck) */
	private void buildVoiceRow(int x, int y, int w) {
		voiceShown = true;
		int half = (w - 6) / 2;
		ToggleChip mic = new ToggleChip(x, y, half, 22, VOICE_MIC, "mic", () -> !VoiceLink.selfMuted(), on -> {
			if (on == VoiceLink.selfMuted()) AddonManager.runKey(VOICE_ADDON, "mute");
		});
		ToggleChip sound = new ToggleChip(x + half + 6, y, w - half - 6, 22, VOICE_SOUND, "volume", () -> !VoiceLink.selfDeafened(), on -> {
			if (on == VoiceLink.selfDeafened()) AddonManager.runKey(VOICE_ADDON, "deafen");
		});
		voiceToggles.add(mic);
		voiceToggles.add(sound);
		addRenderableWidget(mic);
		addRenderableWidget(sound);
	}

	/** Karte Schnell umschalten (je zwei Schalter pro Reihe) */
	private void buildQuickCard(int x, int y, int w, List<Module> modules) {
		int rows = (modules.size() + 1) / 2;
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
		if (friendsH < CARD_HEAD + FRIENDS_FOOT + 34) {
			sessionH = 0;
			friendsY = contentY;
			friendsH = waypointsY - gap - friendsY;
		}
		// geteilte Welt: statt der Sitzung die Karte „Welt geteilt“ (Adresse, Anklopfen, Verwalten)
		shareCard = WorldShare.active() && sessionH > 0;
		shareSignature = shareSignature();
		if (shareCard) buildShareCard();
		else if (sessionH > 0 && currentServer() != null && !currentServer().isRealm()) {
			// Server-Adresse kopieren (für Freunde ohne HeldixClient)
			addRenderableWidget(ActionButton.icon(sideX + sideW - 24, sessionY + 4, 18, "copy", COPY_ADDRESS_BUTTON, this::copyAddress));
		}

		// Freunde: Liste, leerer Zustand oder Hinweis zum Dienst; im Fuß Einladen, Browser-Link und Party
		friendsMode = friendsMode();
		Runnable openFriends = () -> open(() -> new HeldixMenuScreen(this, Shell.Page.FRIENDS));
		partyShown = PartyWidget.hasContent();
		boolean foot = Social.online();
		int listBottom = friendsY + friendsH - (foot ? FRIENDS_FOOT + 2 : 4);
		if (friendsMode == FriendsMode.LIST) {
			int rows = Math.max(0, (listBottom - friendsY - CARD_HEAD) / 32);
			// Party (ab Heldix-Dienst 1.12.0) als erste Zeile der Freunde-Karte
			int first = 0;
			if (partyShown && rows > 1) {
				addRenderableWidget(new PartyWidget(sideX + 4, friendsY + CARD_HEAD, sideW - 8, 30, () -> open(() -> new HeldixMenuScreen(this, Shell.Page.PARTY))));
				first = 1;
			}
			for (int i = first; i < rows; i++) {
				int index = i - first;
				addRenderableWidget(new FriendWidget(sideX + 4, friendsY + CARD_HEAD + i * 32, sideW - 8, 30, () -> friendAt(index), openFriends));
			}
		}
		String all = "Alle";
		int aw = ActionButton.widthFor(all, "chevron-right") - 4;
		int bx = sideX + sideW - 6 - aw;
		addRenderableWidget(new ActionButton(bx, friendsY + 4, aw, 18, all, false, openFriends)
				.withIcon("chevron-right").withVariant(ActionButton.Variant.GHOST));
		friendsHeaderRight = bx;
		inviteVoice = Invites.browserLinkAvailable();
		if (foot) buildFriendsFoot(openFriends);

		// Wegpunkte: hier setzen, verwalten
		int half = (sideW - 16 - 6) / 2;
		addRenderableWidget(new ActionButton(sideX + 8, waypointsY + CARD_HEAD - 2, half, 20, "Hier setzen", true, this::setWaypoint).withIcon("plus"));
		addRenderableWidget(new ActionButton(sideX + 8 + half + 6, waypointsY + CARD_HEAD - 2, sideW - 16 - half - 6, 20, "Verwalten", false,
				() -> open(() -> new HeldixMenuScreen(this, Shell.Page.WAYPOINTS))).withIcon("pin"));
	}

	/**
	 * Fuß der Freunde-Karte: „Freunde einladen“ (Einladungslink; im Mehrspieler mit diesem Server), in einer Voice-Gruppe der
	 * Browser-Link, und die Party. Ohne Freunde statt der Party „Freund hinzufügen“.
	 */
	private void buildFriendsFoot(Runnable openFriends) {
		int y = friendsY + friendsH - FRIENDS_FOOT + 2;
		int x = sideX + 8;
		int right = sideX + sideW - 8;
		String server = Invites.currentServer(minecraft);
		String tooltip = server != null ? "Einladungslink kopieren – Freunde holen sich HeldixClient und kommen direkt auf " + ServersScreen.shortAddress(server)
				: "Einladungslink kopieren – Freunde holen sich HeldixClient, danach seid ihr befreundet";
		boolean noFriends = friendsMode == FriendsMode.EMPTY;
		ActionButton second = noFriends
				? ActionButton.icon(right - 22, y, 22, "user-plus", "Freund hinzufügen", openFriends)
				: ActionButton.icon(right - 22, y, 22, "party", PARTY_BUTTON, () -> open(() -> new HeldixMenuScreen(this, Shell.Page.PARTY)));
		second.withVariant(ActionButton.Variant.SECONDARY);
		addRenderableWidget(second);
		right -= 26;
		if (inviteVoice) {
			addRenderableWidget(ActionButton.icon(right - 22, y, 22, "headphones", BROWSER_LINK_BUTTON, () -> Invites.copyBrowserLink(minecraft, null))
					.withVariant(ActionButton.Variant.SECONDARY));
			right -= 26;
		}
		addRenderableWidget(new ActionButton(x, y, right - x, 22, INVITE_BUTTON, true, () -> Invites.copyInvite(minecraft, null))
				.withIcon("user-plus").withTooltip(tooltip));
	}

	/** Karte „Welt geteilt“: oben Adresse (Kopieren) bzw. wer anklopft, darunter Erlauben/Ablehnen bzw. Einladen, Verwalten, Beenden */
	private void buildShareCard() {
		int x = sideX + 8;
		int w = sideW - 16;
		int row1 = sessionY + CARD_HEAD - 2;
		int row2 = row1 + 24;
		WorldShare.Knock knock = WorldShare.currentKnock();
		if (knock != null) {
			String name = knock.name();
			int half = (w - 6) / 2;
			addRenderableWidget(new ActionButton(x, row2, half, 20, ShareWorldScreen.ALLOW_LABEL, true, () -> {
				WorldShare.allow(name);
				rebuildWidgets();
			}).withIcon("check"));
			addRenderableWidget(new ActionButton(x + half + 6, row2, w - half - 6, 20, ShareWorldScreen.DENY_LABEL, false, () -> {
				WorldShare.deny(name);
				rebuildWidgets();
			}).withIcon("close"));
			return;
		}
		if (WorldShare.address() != null && WorldShare.online()) {
			addRenderableWidget(ActionButton.icon(x + w - 18, row1 + 1, 18, "copy", SHARE_COPY_BUTTON, () -> {
				minecraft.keyboardHandler.setClipboard(WorldShare.normalizeAddress(WorldShare.address()));
				Notifications.show("welt-teilen", "Adresse kopiert", WorldShare.normalizeAddress(WorldShare.address()), null);
			}));
		}
		int stopW = ActionButton.widthFor("Beenden", "quit");
		int third = (w - stopW - 12) / 2;
		boolean text = third >= 64;
		if (text) {
			addRenderableWidget(new ActionButton(x, row2, third, 20, "Einladen", false, () -> open(() -> new ShareWorldScreen(ShareWorldScreen.Mode.INVITE)))
					.withIcon("user-plus").withTooltip(ShareWorldScreen.INVITE_LABEL));
			addRenderableWidget(new ActionButton(x + third + 6, row2, third, 20, SHARE_MANAGE_BUTTON, false, () -> open(ShareWorldScreen::new)).withIcon("settings"));
		} else {
			addRenderableWidget(ActionButton.icon(x, row2, 20, "user-plus", ShareWorldScreen.INVITE_LABEL,
					() -> open(() -> new ShareWorldScreen(ShareWorldScreen.Mode.INVITE))).withVariant(ActionButton.Variant.SECONDARY));
			addRenderableWidget(ActionButton.icon(x + 24, row2, 20, "settings", SHARE_MANAGE_BUTTON, () -> open(ShareWorldScreen::new))
					.withVariant(ActionButton.Variant.SECONDARY));
		}
		addRenderableWidget(new ActionButton(x + w - stopW, row2, stopW, 20, "Beenden", false, () -> {
			WorldShare.stop();
			rebuildWidgets();
		}).withIcon("quit").withVariant(ActionButton.Variant.DANGER).withTooltip(ShareWorldScreen.STOP_LABEL));
	}

	private static String shareSignature() {
		WorldShare.Knock knock = WorldShare.currentKnock();
		return WorldShare.active() + "|" + WorldShare.state() + "|" + WorldShare.address() + "|" + (knock == null ? "" : knock.name());
	}

	private static FriendsMode friendsMode() {
		if (!Social.online()) return FriendsMode.HINT;
		return Social.friends().isEmpty() ? FriendsMode.EMPTY : FriendsMode.LIST;
	}

	@Override
	public void tick() {
		super.tick();
		ServerPing.tick();
		// Dienst verbunden, erster Freund, Voice-Gruppe oder Voice Chat verbunden/getrennt: neu aufbauen
		if (sideW > 0 && (friendsMode != friendsMode() || inviteVoice != Invites.browserLinkAvailable() || !shareSignature().equals(shareSignature)
				|| partyShown != PartyWidget.hasContent() || voiceShown != voiceAvailable())) {
			rebuildWidgets();
		}
	}

	/** Freund Nummer index: online zuerst (innerhalb: Favoriten zuerst, wie die Liste des Dienstes sortiert ist) */
	private static Social.Friend friendAt(int index) {
		if (!Social.online()) return null;
		List<Social.Friend> friends = new ArrayList<>(Social.friends());
		friends.sort(java.util.Comparator.comparingInt(Social.Friend::presenceRank));
		return index < friends.size() ? friends.get(index) : null;
	}

	/** Party-Zeile in der Freunde-Karte (beim Aufbau): ändert es sich, wird neu aufgebaut */
	private boolean partyShown;

	private void setWaypoint() {
		Waypoints.Waypoint waypoint = Waypoints.add(minecraft, "");
		if (waypoint == null) return;
		waypointMessage = "„" + waypoint.name + "“ gesetzt";
		waypointMessageAt = System.currentTimeMillis();
		Notifications.show("waypoint", "Wegpunkt gesetzt", waypoint.name + " · " + waypoint.coordinates(), null);
	}

	private void copyAddress() {
		ServerData server = currentServer();
		if (server == null) return;
		minecraft.keyboardHandler.setClipboard(ServersScreen.shortAddress(server.ip));
		addressCopiedAt = System.currentTimeMillis();
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

	/** Abzeichen „Partner“ hinter dem Server, wenn seine Adresse in der Partnerliste des Heldix-Dienstes steht */
	@Override
	protected String subtitleBadge() {
		ServerData server = currentServer();
		return server != null && !server.isRealm() && dev.heldixclient.serverlink.Partners.isPartner(server.ip) ? "Partner" : null;
	}

	@Override
	protected String subtitle() {
		ServerData server = currentServer();
		if (server != null) {
			// Server mit Minecrafts Standardnamen zeigen ihre Adresse; sonst Name und Adresse
			String name = ServersScreen.displayName(server);
			String address = ServersScreen.shortAddress(server.ip);
			if (server.isRealm() || address.isBlank() || name.equalsIgnoreCase(address)) return (server.isRealm() ? "Realms  ·  " : "Mehrspieler  ·  ") + name;
			return "Mehrspieler  ·  " + name + "  ·  " + address;
		}
		if (minecraft.getSingleplayerServer() != null) {
			String world = minecraft.getSingleplayerServer().getWorldData().getLevelName();
			if (WorldShare.online()) return "Einzelspieler  ·  " + world + "  ·  geteilt über den Heldix-Dienst";
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
		// Welt geteilt (statt der Sitzung)
		if (shareCard) {
			drawShareCard(g);
		} else if (sessionH > 0) {
			String extra = System.currentTimeMillis() - addressCopiedAt < 3000 ? "Adresse kopiert" : null;
			card(g, sideX, sessionY, sideW, sessionH, "clock", "Sitzung", extra, sideX + sideW - 28);
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
		card(g, sideX, friendsY, sideW, friendsH, "friends", "Freunde", friends.isEmpty() ? null : online + " von " + friends.size() + " online",
				friendsHeaderRight - 4);
		if (friendsMode != FriendsMode.LIST) {
			String text = friendsMode == FriendsMode.EMPTY ? "Noch keine Freunde. Lade jemanden ein – mit dem Link holt er sich HeldixClient, und ihr seid gleich befreundet."
					: FriendWidget.serviceHint();
			if (text != null) {
				List<FormattedCharSequence> lines = Ui.wrap(text, sideW - 32, Ui.Font.SMALL);
				int areaTop = friendsY + CARD_HEAD;
				int areaBottom = friendsY + friendsH - (Social.online() ? FRIENDS_FOOT + 4 : 4);
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
		} else if (online == 0 && Social.online()) {
			// alle offline: Hinweis über dem Fuß, wenn unter den Zeilen Platz ist
			int listBottom = friendsY + friendsH - FRIENDS_FOOT - 2;
			int used = friendsY + CARD_HEAD + Math.min(friends.size() + (partyShown ? 1 : 0), Math.max(0, (listBottom - friendsY - CARD_HEAD) / 32)) * 32;
			if (listBottom - used >= 22) {
				String hint = Ui.ellipsize("Gerade ist niemand online – lade weitere Freunde ein.", sideW - 24, Ui.Font.SMALL);
				Ui.text(g, hint, sideX + (sideW - Ui.width(hint, Ui.Font.SMALL)) / 2, listBottom - 14, Ui.FAINT, Ui.Font.SMALL);
			}
		}
		// Wegpunkte
		int count = Waypoints.current(minecraft).size();
		String detail = waypointMessage != null && System.currentTimeMillis() - waypointMessageAt < 5000 ? waypointMessage
				: count == 0 ? "noch keine" : count + " in dieser Welt";
		card(g, sideX, waypointsY, sideW, WAYPOINTS_H, "pin", "Wegpunkte", detail);
	}

	private void drawShareCard(GuiGraphicsExtractor g) {
		WorldShare.Settings settings = WorldShare.settings();
		int players = minecraft.getSingleplayerServer() == null ? 1 : minecraft.getSingleplayerServer().getPlayerCount();
		String extra = WorldShare.online() ? players + "/" + (settings == null ? 8 : settings.maxPlayers()) + " Spieler" : "wird geöffnet …";
		card(g, sideX, sessionY, sideW, sessionH, "lan", "Welt geteilt", extra);
		int x = sideX + 10;
		int y = sessionY + CARD_HEAD + 4;
		int w = sideW - 20;
		WorldShare.Knock knock = WorldShare.currentKnock();
		if (knock != null) {
			Ui.text(g, Ui.ellipsize(knock.name() + " möchte beitreten", w, Ui.Font.LABEL), x, y, Ui.ACCENT_TEXT, Ui.Font.LABEL);
			return;
		}
		String line = WorldShare.notice() != null ? WorldShare.notice() : WorldShare.online() && WorldShare.address() != null
				? WorldShare.normalizeAddress(WorldShare.address()) : WorldShare.step() != null ? WorldShare.step() : "Wird geöffnet …";
		int color = WorldShare.notice() != null ? Ui.WARNING : WorldShare.online() ? Ui.TEXT : Ui.MUTED;
		Ui.text(g, Ui.ellipsize(line, w - 22, Ui.Font.LABEL), x, y, color, Ui.Font.LABEL);
	}

	/** Werte der Karte Sitzung: {Icon, Bezeichnung, Wert} */
	private String[][] sessionStats() {
		String time = "–";
		if (sessionStart > 0) {
			long minutes = (System.currentTimeMillis() - sessionStart) / 60_000;
			time = minutes < 60 ? minutes + " min" : minutes / 60 + " h " + String.format("%02d", minutes % 60) + " min";
		}
		String position = minecraft.player == null ? "–"
				// Regel „coordinates“ des Servers (Plugin „HeldixClient Server“)
				: !dev.heldixclient.serverlink.ServerRules.allowed("coordinates") ? "Auf diesem Server aus"
				: minecraft.player.getBlockX() + ", " + minecraft.player.getBlockY() + ", " + minecraft.player.getBlockZ();
		String[] third;
		String[] fourth;
		if (minecraft.isLocalServer() || minecraft.getConnection() == null) {
			third = new String[] {"world", "Dimension", Waypoints.dimensionName(Waypoints.dimension(minecraft))};
			String mode = minecraft.gameMode == null ? "–" : minecraft.gameMode.getPlayerMode().getShortDisplayName().getString();
			fourth = new String[] {"user", "Spielmodus", mode};
		} else {
			third = new String[] {"signal", "Ping", ping()};
			fourth = new String[] {"friends", "Spieler", Integer.toString(minecraft.getConnection().getOnlinePlayers().size())};
		}
		return new String[][] {{"clock", "Spielzeit", time}, {"compass", "Position", position}, third, fourth};
	}

	/**
	 * Ping: was der Server in der Tab-Liste meldet; melden ihn viele Netzwerke nicht (0 ms), der gemessene Wert der
	 * Server-Abfrage wie in der Serverliste.
	 */
	private String ping() {
		PlayerInfo info = minecraft.player == null ? null : minecraft.getConnection().getPlayerInfo(minecraft.player.getUUID());
		if (info != null && info.getLatency() > 0) return info.getLatency() + " ms";
		ServerData server = currentServer();
		ServerPing.Result result = server == null ? null : ServerPing.result(server.ip);
		if (result != null && result.ok() && result.ping() > 0) return result.ping() + " ms";
		return result != null && result.state() == ServerData.State.PINGING ? "wird gemessen …" : "–";
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
		card(g, x, y, w, h, icon, title, extra, x + w - 50);
	}

	/** wie oben; der Zusatz endet vor {@code extraRight} (Knöpfe im Kopf der Karte) */
	private void card(GuiGraphicsExtractor g, int x, int y, int w, int h, String icon, String title, String extra, int extraRight) {
		Ui.rect(g, x, y, w, h, 10, Ui.SURFACE);
		Ui.outline(g, x, y, w, h, 10, Ui.LINE);
		Ui.rect(g, x + 8, y + 6, 14, 14, 4, Ui.ACCENT_SOFT);
		Ui.icon(g, icon, x + 10.5f, y + 8.5f, 9, Ui.ACCENT_TEXT);
		Ui.text(g, title, x + 28, y + 9, Ui.TEXT, Ui.Font.LABEL);
		if (extra != null) {
			int ex = x + 34 + Ui.width(title, Ui.Font.LABEL);
			if (extraRight - ex > 12) Ui.text(g, Ui.ellipsize(extra, extraRight - ex, Ui.Font.SMALL), ex, y + 10, Ui.FAINT, Ui.Font.SMALL);
		}
	}

	/** Für den Autotest: Schnellschalter im Pausemenü */
	public List<ToggleChip> toggles() {
		return toggles;
	}

	/** Für den Autotest: Voice-Schalter (Mikrofon, Ton) – leer ohne verbundenen Voice Chat */
	public List<ToggleChip> voiceToggles() {
		return voiceToggles;
	}

	/** Für den Autotest: Abstand links zwischen den Knöpfen und dem Nächsten darunter (-1 = einspaltig) */
	public int leftGap() {
		return sideW > 0 ? leftGap : -1;
	}

	/** Für den Autotest: Knöpfe links schon so hoch wie erlaubt (dann darf eine Lücke bleiben) */
	public boolean rowsCapped() {
		return rowsCapped;
	}

	@Override
	public void onClose() {
		resume();
	}
}
