package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.share.Hosting;
import dev.heldixclient.share.HostingService;
import dev.heldixclient.share.WorldBackups;
import dev.heldixclient.share.WorldService;
import dev.heldixclient.share.WorldService.Access;
import dev.heldixclient.share.WorldService.Member;
import dev.heldixclient.share.WorldService.Role;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.world.level.GameType;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * „Welt teilen“ aus dem Pausemenü einer Einzelspielerwelt: vor dem Teilen die Einstellungen (Zugang, Rolle für Neue,
 * Höchstspieler, Spielmodus, Cheats) und „Teilen starten“; danach Adresse mit „Kopieren“, wer anklopft (Erlauben /
 * Ablehnen), die Spieler mit ihren Rollen und „Teilen beenden“. Unterseiten: Freunde einladen, Mitglieder verwalten,
 * Einstellungen ändern. Die Arbeit macht {@link WorldShare}.
 */
public class ShareWorldScreen extends ShellScreen {
	/** Beschriftungen der Knöpfe (auch für den Autotest) */
	public static final String START_LABEL = "Teilen starten";
	public static final String STOP_LABEL = "Teilen beenden";
	public static final String COPY_LABEL = "Adresse kopieren";
	public static final String INVITE_LABEL = "Freunde einladen";
	public static final String MEMBERS_LABEL = "Mitglieder";
	public static final String SETTINGS_LABEL = "Einstellungen";
	public static final String ALLOW_LABEL = "Erlauben";
	public static final String DENY_LABEL = "Ablehnen";
	public static final String APPLY_LABEL = "Übernehmen";
	/** dauerhafte Welten (Dienst 1.13.0) */
	public static final String HOST_LABEL = "Dauerhaft online stellen";
	public static final String HOSTED_JOIN_LABEL = "Dort beitreten";

	public enum Mode {
		/** vor dem Teilen: Einstellungen und „Teilen starten“ (während des Starts: Fortschritt) */
		SETUP,
		/** geteilt: Adresse, Anklopfen, Spieler */
		STATUS,
		INVITE,
		MEMBERS,
		/** Einstellungen während des Teilens */
		SETTINGS
	}

	private static final int ROW = 24;
	private static final int GAP = 4;
	private static final GameType[] MODES = {GameType.SURVIVAL, GameType.CREATIVE, GameType.ADVENTURE, GameType.SPECTATOR};

	/** Text an fester Stelle (beim Aufbau berechnet, in drawContent gezeichnet) */
	private record Label(int x, int y, int w, String text, int color, Ui.Font font) {
	}

	private Mode mode;
	private WorldShare.Settings draft;
	private boolean draftFromService;
	private final List<Label> labels = new ArrayList<>();
	private final Set<UUID> selected = new HashSet<>();
	private int scroll;
	private int rowsShown;
	private int rowsTotal;
	private String message;
	private boolean messageError;
	private long messageAt;
	private boolean busy;
	private SearchField nameField;
	private String nameValue = "";
	private String signature;
	/** Karte mit der Adresse (STATUS) */
	private int cardY = -1;
	private int cardH;
	/** Adresse, wenn die Welt laut Dienst dauerhaft auf dem Heldix-Server läuft (Dienst 1.13.0), sonst null */
	private String existingHosted;
	private String existingHostedName;
	private boolean hostingAsked;

	public ShareWorldScreen() {
		this(null);
	}

	public ShareWorldScreen(Mode mode) {
		super(Component.literal("Welt teilen"), Shell.Page.PAUSE);
		this.mode = mode != null ? mode : WorldShare.active() ? Mode.STATUS : Mode.SETUP;
	}

	public Mode mode() {
		return mode;
	}

	private void show(Mode next) {
		mode = next;
		scroll = 0;
		if (next == Mode.SETTINGS) draft = WorldShare.settings();
		if (next == Mode.MEMBERS) WorldShare.refreshMembers();
		rebuildWidgets();
	}

	@Override
	protected boolean detailHeader() {
		return true;
	}

	@Override
	protected Component headerTitle() {
		return Component.literal(switch (mode) {
			case SETUP, STATUS -> "Welt teilen";
			case INVITE -> "Freunde einladen";
			case MEMBERS -> "Mitglieder";
			case SETTINGS -> "Einstellungen der geteilten Welt";
		});
	}

	@Override
	protected String headerIcon() {
		return switch (mode) {
			case INVITE -> "user-plus";
			case MEMBERS -> "friends";
			case SETTINGS -> "settings";
			default -> "lan";
		};
	}

	@Override
	protected String subtitle() {
		if (minecraft == null || minecraft.getSingleplayerServer() == null) return null;
		String world = minecraft.getSingleplayerServer().getWorldData().getLevelName();
		if (mode == Mode.SETUP) return WorldShare.active() ? world + "  ·  wird geöffnet …" : world + "  ·  für Freunde öffnen, ohne Portfreigabe";
		String address = WorldShare.address();
		return world + (address != null ? "  ·  " + WorldShare.normalizeAddress(address) : "");
	}

	/** Ansicht an den Stand anpassen: geteilt → Status, nicht (mehr) geteilt → Einstellungen */
	private void syncMode() {
		if (WorldShare.active() && mode == Mode.SETUP && WorldShare.online()) mode = Mode.STATUS;
		if (!WorldShare.active() && mode != Mode.SETUP) mode = Mode.SETUP;
	}

	@Override
	protected int toolbarActionsWidth() {
		syncMode();
		String primary = primaryLabel();
		return ActionButton.widthFor("Zurück", "back") + (primary != null ? ActionButton.widthFor(primary, "play") + 6 : 0) + (hostButton() ? 26 : 0);
	}

	/** Hauptknopf in der Werkzeugzeile (Einstellungen vor bzw. während des Teilens), sonst null */
	private String primaryLabel() {
		if (mode == Mode.SETTINGS) return APPLY_LABEL;
		if (mode == Mode.SETUP && !WorldShare.active() && hostedAddress() == null) return START_LABEL;
		return null;
	}

	/** Adresse der dauerhaften Welt, wenn diese Welt dauerhaft auf dem Heldix-Server läuft, sonst null */
	private String hostedAddress() {
		if (WorldShare.hostedAddress() != null) return WorldShare.hostedAddress();
		if (existingHosted != null) return existingHosted;
		if (minecraft == null || minecraft.getSingleplayerServer() == null) return null;
		HostingService.Hosted hosted = Hosting.find(worldId());
		return hosted != null && hosted.owner() && hosted.address() != null ? WorldShare.normalizeAddress(hosted.address()) : null;
	}

	private String worldIdCache;

	private String worldId() {
		if (worldIdCache == null && minecraft != null && minecraft.getSingleplayerServer() != null) {
			worldIdCache = WorldBackups.readId(worldFolder());
			if (worldIdCache == null) worldIdCache = "";
		}
		return worldIdCache == null || worldIdCache.isEmpty() ? null : worldIdCache;
	}

	private java.nio.file.Path worldFolder() {
		return minecraft.getSingleplayerServer().getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT).toAbsolutePath().normalize();
	}

	/** Knopf „Dauerhaft online stellen“ (Dienst 1.13.0): vor dem Teilen, wenn der Dienst dauerhafte Welten kann */
	private boolean hostButton() {
		HostingService.Overview overview = Hosting.overview();
		return mode == Mode.SETUP && !WorldShare.active() && hostedAddress() == null && overview != null && overview.available()
				&& minecraft != null && minecraft.getSingleplayerServer() != null;
	}

	// ======================================================================================
	// Aufbau
	// ======================================================================================

	@Override
	protected void initContent() {
		labels.clear();
		wrapped.clear();
		cardY = -1;
		rowsShown = 0;
		rowsTotal = 0;
		// Welt-ID neu lesen (z. B. nach „Dauerhaft online stellen“ steht sie erst jetzt in heldix-welt.json)
		worldIdCache = null;
		syncMode();
		if (draft == null) {
			draft = WorldShare.active() ? WorldShare.settings() : WorldShare.defaults(minecraft);
			if (!WorldShare.active()) loadExisting();
		}
		int bw = ActionButton.widthFor("Zurück", "back");
		addRenderableWidget(new ActionButton(headerRight() - bw, headerButtonY(), bw, 20, "Zurück", false, this::back)
				.withIcon("back").withVariant(ActionButton.Variant.GHOST));
		if (Hosting.overview() == null && Social.online() && !hostingAsked) {
			hostingAsked = true;
			Hosting.refresh().whenComplete((ignored, error) -> minecraft.execute(() -> {
				if (minecraft.gui.screen() == this) rebuildWidgets();
			}));
		}
		switch (mode) {
			case SETUP -> {
				if (WorldShare.active()) buildStarting();
				else if (hostedAddress() != null) buildHosted();
				else buildSettings(false);
			}
			case SETTINGS -> buildSettings(true);
			case STATUS -> buildStatus();
			case INVITE -> buildInvite();
			case MEMBERS -> buildMembers();
		}
		signature = signature();
	}

	/** Einstellungen der Welt beim Dienst (war sie schon einmal geteilt) in den Dialog übernehmen */
	private void loadExisting() {
		if (draftFromService) return;
		draftFromService = true;
		WorldShare.existing(minecraft).thenAccept(world -> minecraft.execute(() -> {
			if (world == null || WorldShare.active() || mode != Mode.SETUP) return;
			draft = draft.withAccess(world.access()).withDefaultRole(world.defaultRole()).withMaxPlayers(world.maxPlayers());
			if (world.persistent()) {
				// läuft dauerhaft auf dem Heldix-Server: Teilen gesperrt, dort beitreten
				existingHosted = WorldShare.normalizeAddress(world.address());
				existingHostedName = world.name();
			}
			rebuildWidgets();
		}));
	}

	private int controlW() {
		return Math.min(230, Math.max(120, contentW / 2));
	}

	/** Zeile mit Bezeichnung links und Bedienelement rechts; liefert die x-Position des Elements */
	private int row(int y, String label, String hint) {
		int cw = controlW();
		int lw = contentW - cw - 10;
		labels.add(new Label(contentX, y + (hint == null ? 8 : 3), lw, label, Ui.TEXT, Ui.Font.LABEL));
		if (hint != null) labels.add(new Label(contentX, y + 14, lw, hint, Ui.FAINT, Ui.Font.SMALL));
		return contentX + contentW - cw;
	}

	private void buildSettings(boolean live) {
		// niedrige Fenster: Zeilen enger, damit unten noch Platz für Hinweise bleibt
		int gap = contentH < 200 ? 2 : GAP;
		int y = contentY;
		int cw = controlW();
		WorldShare.Settings s = draft;

		int x = row(y, "Wer darf rein", "Andere klopfen an – du entscheidest");
		addRenderableWidget(cycle(x, y, cw, s.access().label, "shield", () -> draft = draft.withAccess(next(draft.access()))));
		y += ROW + gap;

		x = row(y, "Rolle für Neue", s.defaultRole().hint);
		addRenderableWidget(cycle(x, y, cw, s.defaultRole().label, "user", () -> draft = draft.withDefaultRole(draft.defaultRole().next())));
		y += ROW + gap;

		x = row(y, "Höchstspieler", "mit dir, höchstens 20");
		int players = minecraft.getSingleplayerServer() == null ? 1 : minecraft.getSingleplayerServer().getPlayerCount();
		ActionButton minus = ActionButton.icon(x, y + 2, 20, "chevron-left", "Weniger", () -> {
			draft = draft.withMaxPlayers(draft.maxPlayers() - 1);
			rebuildWidgets();
		});
		minus.active = s.maxPlayers() > Math.max(2, players);
		addRenderableWidget(minus);
		ActionButton plus = ActionButton.icon(x + cw - 20, y + 2, 20, "chevron-right", "Mehr", () -> {
			draft = draft.withMaxPlayers(draft.maxPlayers() + 1);
			rebuildWidgets();
		});
		plus.active = s.maxPlayers() < 20;
		addRenderableWidget(plus);
		labels.add(new Label(x + cw / 2 - Ui.width(s.maxPlayers() + " Spieler", Ui.Font.LABEL) / 2, y + 8, cw, s.maxPlayers() + " Spieler", Ui.TEXT, Ui.Font.LABEL));
		y += ROW + gap;

		boolean hardcore = minecraft.getSingleplayerServer() != null && minecraft.getSingleplayerServer().isHardcore();
		x = row(y, "Spielmodus der Welt", hardcore ? "Hardcore bleibt Hardcore" : "für Mitspieler und Operatoren");
		ActionButton gameMode = cycle(x, y, cw, s.gameMode().getShortDisplayName().getString(), "cube", () -> draft = draft.withGameMode(next(draft.gameMode())));
		gameMode.active = !hardcore;
		addRenderableWidget(gameMode);
		y += ROW + gap;

		x = row(y, "Cheats", "Befehle in der Welt (Gastgeber und Operatoren haben sie immer)");
		addRenderableWidget(new ToggleChip(x, y + 2, cw, 20, "Cheats erlauben", "terminal", () -> draft.cheats(), on -> {
			draft = draft.withCheats(on);
			rebuildWidgets();
		}));
		y += ROW + gap + (gap == GAP ? 4 : 0);

		// Hauptknopf oben in der Werkzeugzeile (links von „Zurück“): so bleibt der Inhalt auch in kleinen Fenstern frei
		String problem = WorldShare.problem(minecraft);
		String primary = live ? APPLY_LABEL : START_LABEL;
		int pw = ActionButton.widthFor(primary, "play");
		int bw = ActionButton.widthFor("Zurück", "back");
		ActionButton go = new ActionButton(headerRight() - bw - 6 - pw, headerButtonY(), pw, 20, primary, true, live ? this::apply : this::start)
				.withIcon(live ? "check" : "play");
		go.active = !busy && (live || problem == null);
		addRenderableWidget(go);
		// Dienst 1.13.0: statt zu teilen dauerhaft auf dem Heldix-Server (auch wenn du offline bist)
		if (!live && hostButton()) {
			HostingService.Overview overview = Hosting.overview();
			ActionButton host = ActionButton.icon(headerRight() - bw - 6 - pw - 26, headerButtonY(), 20, "server",
					overview.allowed() ? HOST_LABEL + " – läuft auf dem Heldix-Server, auch wenn du offline bist" : HeldixWorldsScreen.PLUS_TEASER, this::hostWorld)
					.withVariant(ActionButton.Variant.SECONDARY);
			host.active = !busy && problem == null;
			addRenderableWidget(host);
		}

		// Fehler zuerst (wichtiger als der Hinweis), dann der Hinweis, soweit Platz ist
		String error = message != null && messageError && System.currentTimeMillis() - messageAt < 8000 ? message : problem != null ? problem : live ? null : WorldShare.error();
		if (error != null) y = paragraph(y, error, Ui.DANGER) + 2;
		else drawMessage(contentX, y, contentW);
		String info = live ? "Änderungen gelten sofort, auch für Spieler, die gerade in der Welt sind."
				: "Vorher legt HeldixClient eine Sicherung der Welt an (die letzten " + WorldBackups.KEEP + " bleiben). Freunde treten über eine feste "
						+ "Adresse bei – auch ohne HeldixClient, mit derselben Minecraft-Version.";
		paragraph(error == null && message != null ? y + 12 : y, info, Ui.MUTED);
	}

	/** Die Welt läuft dauerhaft auf dem Heldix-Server (Dienst 1.13.0): Teilen gesperrt, „dort beitreten?“ */
	private void buildHosted() {
		String address = hostedAddress();
		int y = contentY;
		cardY = y;
		cardH = 46;
		HostingService.Hosted hosted = Hosting.find(worldId());
		labels.add(new Label(contentX + 12, y + 9, contentW - 24, WorldShare.HOSTED_QUESTION, Ui.TEXT, Ui.Font.LABEL));
		labels.add(new Label(contentX + 12, y + 27, contentW - 24, address + (hosted != null ? "  ·  " + hosted.stateLine() : ""), Ui.MUTED, Ui.Font.SMALL));
		y += cardH + 8;
		int jw = ActionButton.widthFor(HOSTED_JOIN_LABEL, "play");
		addRenderableWidget(new ActionButton(contentX, y, jw, 22, HOSTED_JOIN_LABEL, true, () -> joinHosted(address)).withIcon("play"));
		int mw = ActionButton.widthFor(HeldixWorldsScreen.MANAGE_LABEL, "external");
		addRenderableWidget(new ActionButton(contentX + jw + 6, y, mw, 22, HeldixWorldsScreen.MANAGE_LABEL, false, () -> Hosting.manageOnWebsite()
				.whenComplete((ignored, error) -> minecraft.execute(() -> {
					note(error != null ? WorldService.message(error) : "Meine Welten ist im Browser geöffnet.", error != null);
					if (minecraft.gui.screen() == this) rebuildWidgets();
				}))).withIcon("external"));
		y += 32;
		drawMessage(contentX, y, contentW);
		paragraph(y + 14, "Die Welt läuft auf dem Heldix-Server weiter, auch wenn du offline bist – teilen musst du sie nicht mehr. Beitreten verlässt "
				+ "diese Einzelspielerwelt (sie wird gespeichert). Deine lokale Kopie bleibt unverändert; den Stand vom Server holst du in Heldix-Welten mit "
				+ "„Herunterladen“.", Ui.MUTED);
	}

	/** Beitritt zur dauerhaften Welt: diese Einzelspielerwelt verlassen, dann verbinden (weckt sie, falls sie schläft) */
	private void joinHosted(String address) {
		if (address == null) return;
		WorldShare.clearError();
		String name = existingHostedName != null ? existingHostedName : WorldShare.hostedName() != null ? WorldShare.hostedName()
				: minecraft.getSingleplayerServer() != null ? minecraft.getSingleplayerServer().getWorldData().getLevelName() : "Heldix-Welt";
		dev.heldixclient.share.HostedJoin.join(minecraft, new HeldixWorldsScreen(), name, address);
	}

	/** „Dauerhaft online stellen“: mit Berechtigung die Erklärung, sonst die Heldix+-Warteliste */
	private void hostWorld() {
		HostingService.Overview overview = Hosting.overview();
		if (overview == null || minecraft.getSingleplayerServer() == null) return;
		if (!overview.allowed()) {
			minecraft.gui.setScreen(new net.minecraft.client.gui.screens.ConfirmScreen(confirmed -> {
				minecraft.gui.setScreen(this);
				if (!confirmed) return;
				Hosting.waitlist(true).whenComplete((plus, error) -> minecraft.execute(() -> {
					note(error != null ? WorldService.message(error) : "Du stehst auf der Warteliste – du bekommst eine Einblendung, sobald du freigeschaltet bist.",
							error != null);
					if (minecraft.gui.screen() == this) rebuildWidgets();
				}));
			}, Component.literal(HeldixWorldsScreen.PLUS_TEASER), Component.literal("Dauerhafte Welten laufen auf dem Heldix-Server weiter, auch wenn du "
					+ "offline bist. Gerade ist das eine Beta; später gehört es zu Heldix+ (geplant – Preise und Inhalte stehen noch nicht fest, bezahlt "
					+ "wird nichts)."), Component.literal(HeldixWorldsScreen.WAITLIST_JOIN), net.minecraft.network.chat.CommonComponents.GUI_CANCEL));
			return;
		}
		if (!overview.room() && overview.own(worldId()) == null) {
			int max = overview.limits() == null ? 1 : overview.limits().worlds();
			note(max == 1 ? "Du hast schon eine dauerhafte Welt." : "Du hast schon " + max + " dauerhafte Welten.", true);
			rebuildWidgets();
			return;
		}
		String name = minecraft.getSingleplayerServer().getWorldData().getLevelName();
		minecraft.gui.setScreen(HostWorldScreen.upload(this, worldFolder(), name));
	}

	private void buildStarting() {
		int y = contentY + 10;
		String step = WorldShare.step();
		labels.add(new Label(contentX, y, contentW, step != null ? step : "Wird geöffnet …", Ui.TEXT, Ui.Font.LABEL));
		y += 16;
		paragraph(y, "Gleich bekommt deine Welt ihre Adresse. Du kannst solange weiterspielen.", Ui.MUTED);
		int bottom = contentY + contentH;
		int sw = ActionButton.widthFor("Abbrechen", "close") + 12;
		addRenderableWidget(new ActionButton(contentX + contentW - sw, bottom - 24, sw, 24, "Abbrechen", false, this::stop)
				.withIcon("close").withVariant(ActionButton.Variant.DANGER));
	}

	private void buildStatus() {
		int y = contentY;
		// Karte: Adresse, Zustand, Kopieren
		cardY = y;
		cardH = 46;
		String address = WorldShare.address();
		int copyW = ActionButton.widthFor(COPY_LABEL, "copy");
		boolean roomy = contentW - 24 - copyW > 160;
		ActionButton copy = roomy ? new ActionButton(contentX + contentW - 10 - copyW, y + 13, copyW, 20, COPY_LABEL, true, this::copyAddress).withIcon("copy")
				: ActionButton.icon(contentX + contentW - 30, y + 13, 20, "copy", COPY_LABEL, this::copyAddress).withVariant(ActionButton.Variant.PRIMARY);
		copy.active = address != null;
		addRenderableWidget(copy);
		int textW = contentW - 30 - (roomy ? copyW : 20);
		labels.add(new Label(contentX + 12, y + 9, textW, address != null ? WorldShare.normalizeAddress(address) : "Adresse kommt gleich …", Ui.TEXT, Ui.Font.TITLE));
		String state = WorldShare.notice() != null ? WorldShare.notice() : stateLine();
		labels.add(new Label(contentX + 12, y + 27, textW, state, WorldShare.notice() != null ? Ui.WARNING : Ui.MUTED, Ui.Font.SMALL));
		y += cardH + 8;

		int bottom = contentY + contentH - 24 - 8;
		// wer anklopft
		for (WorldShare.Knock knock : WorldShare.knocks()) {
			if (y + ROW > bottom) break;
			int aw = ActionButton.widthFor(ALLOW_LABEL, "check");
			int dw = ActionButton.widthFor(DENY_LABEL, "close");
			String name = knock.name();
			addRenderableWidget(new ActionButton(contentX + contentW - aw - dw - 6, y + 2, aw, 20, ALLOW_LABEL, true, () -> {
				WorldShare.allow(name);
				rebuildWidgets();
			}).withIcon("check"));
			addRenderableWidget(new ActionButton(contentX + contentW - dw, y + 2, dw, 20, DENY_LABEL, false, () -> {
				WorldShare.deny(name);
				rebuildWidgets();
			}).withIcon("close"));
			labels.add(new Label(contentX + 4, y + 8, contentW - aw - dw - 20, name + " möchte beitreten", Ui.ACCENT_TEXT, Ui.Font.LABEL));
			y += ROW + GAP;
		}

		// Spieler mit Rolle; Gäste: Rolle per Klick ändern (wird Mitglied mit dieser Rolle)
		List<WorldShare.Player> players = WorldShare.players(minecraft);
		labels.add(new Label(contentX, y + 2, contentW, "Spieler in der Welt (" + players.size() + ")", Ui.FAINT, Ui.Font.SMALL));
		y += 14;
		int room = Math.max(0, (bottom - y) / (ROW + 2));
		rowsTotal = players.size();
		scroll = Math.clamp(scroll, 0, Math.max(0, rowsTotal - room));
		rowsShown = Math.min(room, rowsTotal - scroll);
		int rw = Math.min(140, controlW());
		for (int i = 0; i < rowsShown; i++) {
			WorldShare.Player player = players.get(scroll + i);
			labels.add(new Label(contentX + 4, y + 8, contentW - rw - 16, player.name() + (player.host() ? "  ·  Gastgeber" : ""), Ui.TEXT, Ui.Font.BODY));
			if (player.host()) {
				labels.add(new Label(contentX + contentW - rw, y + 8, rw, "Alle Rechte", Ui.FAINT, Ui.Font.SMALL));
			} else {
				Role role = player.role();
				addRenderableWidget(cycle(contentX + contentW - rw, y, rw, role.label, "user", () -> changeRole(player.name(), role.next())));
			}
			y += ROW + 2;
		}

		// unten: Einladen, Mitglieder, Einstellungen, Beenden
		int by = contentY + contentH - 24;
		String[] names = {INVITE_LABEL, MEMBERS_LABEL, SETTINGS_LABEL};
		String[] icons = {"user-plus", "friends", "settings"};
		Mode[] targets = {Mode.INVITE, Mode.MEMBERS, Mode.SETTINGS};
		int stopW = ActionButton.widthFor(STOP_LABEL, "quit");
		int x = contentX;
		int each = (contentW - stopW - 8 - 3 * 6) / 3;
		boolean text = each >= 70;
		for (int i = 0; i < 3; i++) {
			Mode target = targets[i];
			int w = text ? Math.min(each, ActionButton.widthFor(names[i], icons[i])) : 24;
			ActionButton button = text ? new ActionButton(x, by, w, 24, names[i], false, () -> show(target)).withIcon(icons[i])
					: ActionButton.icon(x, by, 24, icons[i], names[i], () -> show(target)).withVariant(ActionButton.Variant.SECONDARY);
			button.active = WorldShare.worldId() != null && (target != Mode.INVITE || Social.online());
			addRenderableWidget(button);
			x += w + 6;
		}
		addRenderableWidget(new ActionButton(contentX + contentW - stopW, by, stopW, 24, STOP_LABEL, false, this::stop)
				.withIcon("quit").withVariant(ActionButton.Variant.DANGER));
		drawMessage(contentX, by - 14, contentW);
	}

	private void buildInvite() {
		int y = contentY;
		List<Social.Friend> friends = new ArrayList<>(Social.friends());
		friends.sort((a, b) -> a.presenceRank() != b.presenceRank() ? Integer.compare(a.presenceRank(), b.presenceRank()) : a.name().compareToIgnoreCase(b.name()));
		if (friends.isEmpty()) {
			paragraph(y + 10, Social.online() ? "Noch keine Freunde. Füge zuerst Freunde hinzu (Profil → Freunde)." : "Nicht mit dem Heldix-Dienst verbunden.", Ui.MUTED);
		}
		int bottom = contentY + contentH - 24 - 8;
		int room = Math.max(0, (bottom - y) / (ROW + 2));
		rowsTotal = friends.size();
		scroll = Math.clamp(scroll, 0, Math.max(0, rowsTotal - room));
		rowsShown = Math.min(room, rowsTotal - scroll);
		for (int i = 0; i < rowsShown; i++) {
			Social.Friend friend = friends.get(scroll + i);
			boolean member = WorldShare.members().stream().anyMatch(m -> friend.uuid().equals(m.uuid()) || m.name().equalsIgnoreCase(friend.name()));
			String label = friend.name() + (member ? "  ·  schon eingetragen" : friend.online() ? "  ·  online" : friend.inLauncher() ? "  ·  im Launcher" : "");
			addRenderableWidget(new ToggleChip(contentX, y, contentW, ROW - 2, label, "user", () -> selected.contains(friend.uuid()), on -> {
				if (on) selected.add(friend.uuid());
				else selected.remove(friend.uuid());
				rebuildWidgets();
			}));
			y += ROW + 2;
		}
		int by = contentY + contentH - 24;
		String go = selected.isEmpty() ? "Einladen" : "Einladen (" + selected.size() + ")";
		int gw = ActionButton.widthFor(go, "send") + 12;
		ActionButton invite = new ActionButton(contentX + contentW - gw, by, gw, 24, go, true, this::sendInvites).withIcon("send");
		invite.active = !selected.isEmpty() && !busy;
		addRenderableWidget(invite);
		drawMessage(contentX, by + 8, contentW - gw - 10);
	}

	private void buildMembers() {
		int y = contentY;
		int addW = ActionButton.widthFor("Hinzufügen", "plus");
		nameField = new SearchField(contentX, y + 2, contentW - addW - 8, 20, "Spielername").withIcon("user-plus").withMaxLength(16).keepOnEscape();
		nameField.setValue(nameValue);
		nameField.setResponder(value -> nameValue = value);
		nameField.setOnEnter(this::addMember);
		addRenderableWidget(nameField);
		addRenderableWidget(new ActionButton(contentX + contentW - addW, y + 2, addW, 20, "Hinzufügen", true, this::addMember).withIcon("plus"));
		y += ROW + 6;
		List<Member> members = WorldShare.members();
		if (members.isEmpty()) paragraph(y + 6, "Noch niemand eingetragen. Eingeladene Freunde und erlaubte Spieler stehen hier.", Ui.MUTED);
		int bottom = contentY + contentH - 16;
		int room = Math.max(0, (bottom - y) / (ROW + 2));
		rowsTotal = members.size();
		scroll = Math.clamp(scroll, 0, Math.max(0, rowsTotal - room));
		rowsShown = Math.min(room, rowsTotal - scroll);
		int rw = Math.min(140, controlW());
		for (int i = 0; i < rowsShown; i++) {
			Member member = members.get(scroll + i);
			labels.add(new Label(contentX + 4, y + 8, contentW - rw - 40, member.name(), Ui.TEXT, Ui.Font.BODY));
			addRenderableWidget(cycle(contentX + contentW - rw - 24, y, rw, member.role().label, "user", () -> changeRole(member.name(), member.role().next())));
			addRenderableWidget(ActionButton.icon(contentX + contentW - 20, y + 2, 20, "trash", "Entfernen", () -> removeMember(member.name())));
			y += ROW + 2;
		}
		drawMessage(contentX, contentY + contentH - 10, contentW);
	}

	/** Knopf, der einen Wert weiterschaltet (Beschriftung = aktueller Wert) */
	private ActionButton cycle(int x, int y, int w, String value, String icon, Runnable change) {
		ActionButton button = new ActionButton(x, y + 2, w, 20, value, false, () -> {
			change.run();
			rebuildWidgets();
		}).withIcon(icon).withTooltip("Klicken zum Ändern");
		return button;
	}

	/** umbrochener Absatz (kleine Schrift) ab y; liefert die Unterkante */
	private int paragraph(int y, String text, int color) {
		for (FormattedCharSequence line : Ui.wrap(text, contentW, Ui.Font.SMALL)) {
			// nur, was in den Inhalt passt (kleine Fenster)
			if (y + 9 > contentY + contentH) break;
			wrapped.add(new Object[] {line, contentX, y, color});
			y += 10;
		}
		return y;
	}

	/** umbrochene Absätze: {Zeile, x, y, Farbe} */
	private final List<Object[]> wrapped = new ArrayList<>();

	private void drawMessage(int x, int y, int w) {
		if (message == null || System.currentTimeMillis() - messageAt > 8000) return;
		labels.add(new Label(x, y, w, message, messageError ? Ui.DANGER : Ui.SUCCESS, Ui.Font.SMALL));
	}

	private void note(String text, boolean error) {
		message = text;
		messageError = error;
		messageAt = System.currentTimeMillis();
	}

	private String stateLine() {
		WorldShare.Settings settings = WorldShare.settings();
		int players = minecraft.getSingleplayerServer() == null ? 1 : minecraft.getSingleplayerServer().getPlayerCount();
		String state = switch (WorldShare.state()) {
			case ONLINE -> "Geöffnet";
			case RECONNECTING -> "Verbindet neu";
			case CONNECTING -> "Verbindet …";
			default -> "Wird geöffnet …";
		};
		return state + "  ·  " + players + "/" + (settings == null ? 8 : settings.maxPlayers()) + " Spieler  ·  " + (settings == null ? "" : settings.access().label);
	}

	private static Access next(Access access) {
		return Access.values()[(access.ordinal() + 1) % Access.values().length];
	}

	private static GameType next(GameType mode) {
		for (int i = 0; i < MODES.length; i++) if (MODES[i] == mode) return MODES[(i + 1) % MODES.length];
		return GameType.SURVIVAL;
	}

	// ======================================================================================
	// Aktionen
	// ======================================================================================

	private void start() {
		busy = true;
		WorldShare.clearError();
		WorldShare.start(minecraft, draft, error -> {
			busy = false;
			if (error != null) note(error, true);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		});
		rebuildWidgets();
	}

	private void stop() {
		WorldShare.stop();
		minecraft.gui.setScreen(new PauseMenuScreen());
	}

	private void apply() {
		busy = true;
		WorldShare.Settings wanted = draft;
		WorldShare.update(minecraft, wanted).whenComplete((ignored, error) -> minecraft.execute(() -> {
			busy = false;
			if (error != null) note(WorldService.message(error), true);
			else {
				note("Gespeichert", false);
				mode = Mode.STATUS;
			}
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
		rebuildWidgets();
	}

	private void copyAddress() {
		String address = WorldShare.address();
		if (address == null) return;
		minecraft.keyboardHandler.setClipboard(WorldShare.normalizeAddress(address));
		note("Adresse kopiert – Freunde geben sie bei Mehrspieler als Server ein", false);
		rebuildWidgets();
	}

	private void sendInvites() {
		if (selected.isEmpty()) return;
		busy = true;
		int count = selected.size();
		WorldShare.invite(new ArrayList<>(selected)).whenComplete((ignored, error) -> minecraft.execute(() -> {
			busy = false;
			if (error != null) {
				note(WorldService.message(error), true);
			} else {
				selected.clear();
				note(count == 1 ? "Einladung verschickt" : count + " Einladungen verschickt", false);
			}
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
		rebuildWidgets();
	}

	private void addMember() {
		String name = nameValue.strip();
		if (!name.matches("^[A-Za-z0-9_]{3,16}$")) {
			note("Spielernamen haben 3 bis 16 Zeichen (Buchstaben, Ziffern, _)", true);
			rebuildWidgets();
			return;
		}
		WorldShare.Settings settings = WorldShare.settings();
		WorldShare.putMember(name, settings == null ? Role.PLAYER : settings.defaultRole()).whenComplete((ignored, error) -> minecraft.execute(() -> {
			if (error != null) note(WorldService.message(error), true);
			else {
				note(name + " ist eingetragen", false);
				nameValue = "";
			}
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
	}

	private void changeRole(String name, Role role) {
		WorldShare.putMember(name, role).whenComplete((ignored, error) -> minecraft.execute(() -> {
			note(error != null ? WorldService.message(error) : name + " ist jetzt " + role.label, error != null);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
	}

	private void removeMember(String name) {
		WorldShare.removeMember(name).whenComplete((ignored, error) -> minecraft.execute(() -> {
			note(error != null ? WorldService.message(error) : name + " ist nicht mehr eingetragen", error != null);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
	}

	private void back() {
		if (mode == Mode.INVITE || mode == Mode.MEMBERS || mode == Mode.SETTINGS) show(Mode.STATUS);
		else minecraft.gui.setScreen(new PauseMenuScreen());
	}

	@Override
	public void onClose() {
		back();
	}

	// ======================================================================================
	// Zeichnen und Aktualisieren
	// ======================================================================================

	/** Stand, nach dem sich der Aufbau richtet (ändert er sich, werden die Widgets neu angelegt) */
	private String signature() {
		StringBuilder text = new StringBuilder().append(WorldShare.state()).append('|').append(WorldShare.address()).append('|')
				.append(WorldShare.step()).append('|').append(WorldShare.notice()).append('|').append(WorldShare.error()).append('|')
				.append(mode == Mode.SETUP ? hostedAddress() + "|" + Hosting.changes() : "").append('|');
		for (WorldShare.Knock knock : WorldShare.knocks()) text.append(knock.name()).append(',');
		text.append('|');
		if (mode == Mode.STATUS) for (WorldShare.Player player : WorldShare.players(minecraft)) text.append(player.name()).append(player.role()).append(',');
		if (mode == Mode.MEMBERS || mode == Mode.INVITE) for (Member member : WorldShare.members()) text.append(member.name()).append(member.role()).append(',');
		if (mode == Mode.INVITE) text.append(Social.friends().size());
		if (message != null && System.currentTimeMillis() - messageAt > 8000) text.append("alt");
		return text.toString();
	}

	@Override
	public void tick() {
		super.tick();
		if (!signature().equals(signature)) {
			if (nameField != null) nameValue = nameField.getValue();
			rebuildWidgets();
		}
	}

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (cardY >= 0) {
			Ui.rect(g, contentX, cardY, contentW, cardH, 10, Ui.SURFACE);
			Ui.outline(g, contentX, cardY, contentW, cardH, 10, WorldShare.state() == WorldShare.State.ONLINE ? Ui.ACCENT_LINE : Ui.LINE);
		}
		for (Label label : labels) {
			if (label.text() == null) continue;
			Ui.text(g, Ui.ellipsize(label.text(), Math.max(10, label.w()), label.font()), label.x(), label.y(), label.color(), label.font());
		}
		for (Object[] line : wrapped) {
			g.text(font, (FormattedCharSequence) line[0], (int) line[1], (int) line[2], (int) line[3], false);
		}
		if (rowsTotal > rowsShown && rowsShown > 0) {
			String more = (scroll + 1) + "–" + (scroll + rowsShown) + " von " + rowsTotal + " · Mausrad blättert";
			Ui.textRight(g, more, contentX + contentW, contentY + contentH - (mode == Mode.MEMBERS ? 10 : 38), Ui.FAINT, Ui.Font.SMALL);
		}
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (rowsTotal > rowsShown) {
			int before = scroll;
			scroll = Math.clamp(scroll - (int) Math.signum(scrollY), 0, rowsTotal - rowsShown);
			if (scroll != before) rebuildWidgets();
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.key() == InputConstants.KEY_ESCAPE && (nameField == null || !nameField.isFocused())) {
			back();
			return true;
		}
		return super.keyPressed(event);
	}

	// ======================================================================================
	// Für den Autotest
	// ======================================================================================

	/** sichtbare Texte (Bezeichnungen, Absätze) */
	public List<String> describe() {
		List<String> list = new ArrayList<>();
		for (Label label : labels) if (label.text() != null) list.add(label.text());
		for (Object[] line : wrapped) {
			StringBuilder text = new StringBuilder();
			((FormattedCharSequence) line[0]).accept((index, style, codePoint) -> {
				text.appendCodePoint(codePoint);
				return true;
			});
			list.add(text.toString());
		}
		return list;
	}
}
