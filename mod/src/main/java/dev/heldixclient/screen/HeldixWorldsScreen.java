package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.share.DiscoverIcons;
import dev.heldixclient.share.HostedJoin;
import dev.heldixclient.share.Hosting;
import dev.heldixclient.share.HostingService;
import dev.heldixclient.share.HostingService.DiscoverEntry;
import dev.heldixclient.share.HostingService.Hosted;
import dev.heldixclient.share.HostingService.State;
import dev.heldixclient.share.HostingTransfer;
import dev.heldixclient.share.WorldBackups;
import dev.heldixclient.share.WorldInvites;
import dev.heldixclient.share.WorldService;
import dev.heldixclient.share.WorldService.Member;
import dev.heldixclient.share.WorldService.Role;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.util.DirectoryLock;
import net.minecraft.util.FormattedCharSequence;

import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Heldix-Welten (Spielen → Heldix-Welten, auch als Kachel auf der Startseite), drei Reiter:
 * <ul>
 *   <li><b>Von Freunden</b>: gerade geöffnete Welten von Freunden mit „Beitreten“ (dazu Einladungen aus der
 *   Echtzeit-Verbindung) und dauerhafte Welten von Freunden bzw. solche, in denen man Operator ist, mit Zustand.</li>
 *   <li><b>Deine Welten</b>: eigene geteilte Welten mit Adresse, Zugang, Mitgliedern und Sicherungen; ab Heldix-Dienst
 *   1.13.0 „Dauerhaft online stellen“ (mit Berechtigung, sonst die Heldix+-Warteliste) und für dauerhafte Welten Zustand,
 *   „Beitreten“, „Auf der Webseite verwalten“ und „Herunterladen“ (als neue Einzelspielerwelt).</li>
 *   <li><b>Entdecken</b>: das öffentliche Weltenverzeichnis ({@code GET /v1/public/discover}) mit Sortierung, Tag-Filter
 *   und Suche; je Eintrag Symbol, Name, Text, Tags, Spieler, Gastgeber, „Beitreten“, „Gefällt mir“ und „Melden“.</li>
 * </ul>
 * Dazu „Adresse eingeben“. Eine eigene Welt öffnet man im Pausemenü mit „Welt teilen“.
 */
public class HeldixWorldsScreen extends ShellScreen {
	public static final String ADDRESS_LABEL = "Adresse eingeben";
	public static final String JOIN_LABEL = "Beitreten";
	public static final String HOST_LABEL = "Dauerhaft online stellen";
	public static final String MANAGE_LABEL = "Auf der Webseite verwalten";
	public static final String DOWNLOAD_LABEL = "Herunterladen als neue Welt";
	public static final String WAITLIST_JOIN = "Auf die Warteliste";
	public static final String WAITLIST_LEAVE = "Von der Warteliste nehmen";
	public static final String REPORT_LABEL = "Melden";
	public static final String LIKE_TOOLTIP = "Gefällt mir";
	/** Hinweis ohne Berechtigung (Heldix+-Warteliste) */
	public static final String PLUS_TEASER = "Dauerhaft online – bald mit Heldix+. Auf die Warteliste?";

	private enum Tab {
		FRIENDS,
		MINE,
		DISCOVER
	}

	private enum Detail {
		NONE,
		ADDRESS,
		MEMBERS,
		BACKUPS,
		/** Heldix+-Warteliste (ohne Berechtigung für dauerhafte Welten) */
		PLUS,
		/** Eintrag aus Entdecken melden */
		REPORT
	}

	/** Eintrag der Liste „Von Freunden“ (geöffnete Welt, Einladung oder dauerhafte Welt) */
	private record Entry(String name, String address, UUID hostUuid, String host, String detail, State hosted) {
	}

	private record Label(int x, int y, int w, String text, int color, Ui.Font font) {
	}

	private static final int ROW = 42;
	private static final int DISCOVER_ROW = 54;
	private static final long DISCOVER_FRESH_MS = 60_000;
	private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy", Locale.GERMANY);
	private static Tab lastTab = Tab.FRIENDS;
	/** Filter in Entdecken bleiben, solange das Spiel läuft */
	private static HostingService.Sort discoverSort = HostingService.Sort.POPULAR;
	private static String discoverTag;
	private static String discoverQuery = "";

	private Tab tab = lastTab;
	private Detail detail = Detail.NONE;
	private WorldService.World current;
	private volatile WorldService.Listing listing;
	private volatile String loadError;
	private volatile boolean loading;
	private volatile List<Member> members = List.of();
	private List<WorldBackups.Backup> backups = List.of();
	private Path localWorld;
	/** Welt-ID → Ordner in saves/ (aus heldix-welt.json, beim Laden der Liste) */
	private Map<String, Path> localIndex = Map.of();
	private final List<Label> labels = new ArrayList<>();
	private final List<Object[]> wrapped = new ArrayList<>();
	/** Flächen der Zeilen (x, y, w, h) zum Zeichnen */
	private final List<int[]> cards = new ArrayList<>();
	/** Hinweis-Karte oben in „Deine Welten“ (x, y, w, h, Farbe) */
	private int[] banner;
	private String bannerIcon;
	private String message;
	private boolean messageError;
	private long messageAt;
	private int scroll;
	private int rowsShown;
	private int rowsTotal;
	private SearchField field;
	private String fieldValue = "";
	private boolean fieldFocused;
	private long loadedAt;
	private int seenChanges = WorldInvites.changes();
	private int seenHosting = Hosting.changes();
	private String seenTransfer = "";

	// Entdecken
	private List<DiscoverEntry> discover;
	private int discoverPage;
	private int discoverPages;
	private int discoverTotal;
	private boolean discoverLoading;
	private String discoverError;
	private long discoverAt;
	private long queryChangedAt;
	/** unveränderte erste Seite (Gerade aktiv): dauerhafte Welten von Freunden für „Von Freunden“ */
	private List<DiscoverEntry> friendPool = List.of();
	private long friendPoolAt;
	/** Gefällt mir: Code → Stand (vom Dienst bzw. nach dem Klick) */
	private final Map<String, HostingService.Like> likes = new HashMap<>();
	private final Set<String> likesAsked = new HashSet<>();
	/** Melden */
	private DiscoverEntry reportEntry;
	private String reportReason = "harassment";
	private boolean busy;

	public HeldixWorldsScreen() {
		super(Component.literal("Heldix-Welten"), Shell.Page.HELDIX_WORLDS);
		reload();
		if (tab == Tab.DISCOVER) loadDiscover(true);
	}

	// ======================================================================================
	// Laden
	// ======================================================================================

	private void reload() {
		if (loading) return;
		loadedAt = System.currentTimeMillis();
		if (!Social.online()) {
			loadError = Social.state() == Social.State.OFFLINE_ACCOUNT ? "Heldix-Welten gibt es nur mit einem Microsoft-Konto."
					: Social.baseUrl().isEmpty() ? "Kein Heldix-Dienst eingetragen." : "Nicht mit dem Heldix-Dienst verbunden.";
			return;
		}
		loading = true;
		WorldService.list().whenComplete((result, error) -> net.minecraft.client.Minecraft.getInstance().execute(() -> {
			loading = false;
			if (error != null) {
				loadError = WorldService.message(error);
			} else {
				listing = result;
				loadError = null;
				WorldInvites.syncOpen(result.friends());
				seenChanges = WorldInvites.changes();
				localIndex = index(result.mine());
				if (current != null) current = result.mine().stream().filter(w -> w.id().equals(current.id())).findFirst().orElse(null);
				if (current == null && (detail == Detail.MEMBERS || detail == Detail.BACKUPS)) detail = Detail.NONE;
			}
			if (minecraft != null && minecraft.gui.screen() == this) rebuildWidgets();
		}));
		// dauerhafte Welten (Dienst 1.13.0): Stand, ohne Berechtigung auch die Warteliste
		Hosting.refresh().whenComplete((overview, error) -> {
			if (overview != null && overview.available() && !overview.allowed()) Hosting.refreshPlus().exceptionally(e -> null);
		});
		if (System.currentTimeMillis() - friendPoolAt > DISCOVER_FRESH_MS) {
			friendPoolAt = System.currentTimeMillis();
			HostingService.discover(HostingService.Sort.ACTIVE, null, null, 1).whenComplete((page, error) -> net.minecraft.client.Minecraft.getInstance().execute(() -> {
				if (page == null) return;
				friendPool = page.entries();
				if (minecraft != null && minecraft.gui.screen() == this && tab == Tab.FRIENDS && detail == Detail.NONE) rebuildWidgets();
			}));
		}
	}

	/** Ordner der eigenen Welten auf diesem PC (heldix-welt.json mit der ID) */
	private Map<String, Path> index(List<WorldService.World> mine) {
		Map<String, Path> map = new HashMap<>();
		if (mine.isEmpty() || minecraft == null) return map;
		Set<String> wanted = new HashSet<>();
		for (WorldService.World world : mine) wanted.add(world.id());
		Path saves = minecraft.getLevelSource().getBaseDir();
		if (!Files.isDirectory(saves)) return map;
		try (DirectoryStream<Path> worlds = Files.newDirectoryStream(saves, Files::isDirectory)) {
			for (Path world : worlds) {
				String id = WorldBackups.readId(world);
				if (id != null && wanted.contains(id) && !map.containsKey(id)) map.put(id, world);
			}
		} catch (Exception e) {
			// nicht lesbar: keine lokalen Welten
		}
		return map;
	}

	/** Entdecken laden: {@code reset} = von vorn (Filter geändert), sonst die nächste Seite anhängen */
	private void loadDiscover(boolean reset) {
		if (discoverLoading) return;
		if (Social.baseUrl().isEmpty()) {
			discoverError = "Kein Heldix-Dienst eingetragen.";
			return;
		}
		int page = reset ? 1 : discoverPage + 1;
		if (!reset && discoverPages > 0 && page > discoverPages) return;
		discoverLoading = true;
		HostingService.Sort sort = discoverSort;
		String tag = discoverTag;
		String query = discoverQuery;
		HostingService.discover(sort, tag, query, page).whenComplete((result, error) -> net.minecraft.client.Minecraft.getInstance().execute(() -> {
			discoverLoading = false;
			discoverAt = System.currentTimeMillis();
			// Filter inzwischen geändert: Ergebnis verwerfen (der neue Stand lädt gleich)
			if (sort != discoverSort || !java.util.Objects.equals(tag, discoverTag) || !query.equals(discoverQuery)) {
				loadDiscover(true);
				return;
			}
			if (error != null) {
				discoverError = WorldService.message(error);
			} else {
				discoverError = null;
				List<DiscoverEntry> list = reset || discover == null ? new ArrayList<>() : new ArrayList<>(discover);
				for (DiscoverEntry entry : result.entries()) {
					if (list.stream().noneMatch(e -> e.code().equals(entry.code()))) list.add(entry);
				}
				discover = List.copyOf(list);
				discoverPage = result.page();
				discoverPages = result.pages();
				discoverTotal = result.total();
				if (reset) scroll = 0;
			}
			if (minecraft != null && minecraft.gui.screen() == this) rebuildWidgets();
		}));
	}

	// ======================================================================================
	// Kopf
	// ======================================================================================

	@Override
	protected List<ShellTab.Spec> subTabs() {
		if (detail != Detail.NONE) return List.of();
		int friends = friendEntries().size();
		int mine = listing == null ? 0 : listing.mine().size();
		return List.of(
				new ShellTab.Spec("welten:freunde", "Von Freunden", "friends", () -> friends > 0 ? Integer.toString(friends) : null, false,
						() -> tab == Tab.FRIENDS, () -> openTab(Tab.FRIENDS)),
				new ShellTab.Spec("welten:eigene", "Deine Welten", "world", () -> mine > 0 ? Integer.toString(mine) : null, false,
						() -> tab == Tab.MINE, () -> openTab(Tab.MINE)),
				new ShellTab.Spec("welten:entdecken", "Entdecken", "compass", () -> null, false,
						() -> tab == Tab.DISCOVER, () -> openTab(Tab.DISCOVER)));
	}

	@Override
	protected boolean detailHeader() {
		return detail != Detail.NONE;
	}

	@Override
	protected Component headerTitle() {
		return Component.literal(switch (detail) {
			case ADDRESS -> ADDRESS_LABEL;
			case MEMBERS -> "Mitglieder · " + (current == null ? "" : current.name());
			case BACKUPS -> "Sicherungen · " + (current == null ? "" : current.name());
			case PLUS -> "Heldix+ – bald";
			case REPORT -> "Melden · " + (reportEntry == null ? "" : reportEntry.name());
			case NONE -> "Heldix-Welten";
		});
	}

	@Override
	protected String headerIcon() {
		return switch (detail) {
			case ADDRESS -> "connect";
			case MEMBERS -> "friends";
			case BACKUPS -> "clock";
			case PLUS -> "sparkles";
			case REPORT -> "flag";
			case NONE -> "lan";
		};
	}

	@Override
	protected String subtitle() {
		return switch (detail) {
			case ADDRESS -> "Adresse einer Heldix-Welt (z. B. abc234.welt.heldixclient.com) oder eines Servers";
			case MEMBERS -> current == null ? null : WorldShare.normalizeAddress(current.address());
			case BACKUPS -> localWorld == null ? "nicht auf diesem PC" : "die letzten " + WorldBackups.KEEP + " vor jedem Teilen";
			case PLUS -> "dauerhafte Welten, mehr Plätze und Speicher – geplant";
			case REPORT -> reportEntry == null ? null : "von " + reportEntry.hostName() + "  ·  " + reportEntry.address();
			case NONE -> null;
		};
	}

	@Override
	protected int toolbarActionsWidth() {
		if (detail == Detail.PLUS) return ActionButton.widthFor("Zurück", "back") + plusActionsWidth();
		return detail != Detail.NONE ? ActionButton.widthFor("Zurück", "back") : ActionButton.widthFor(ADDRESS_LABEL, "connect") + 24;
	}

	/** Warteliste: Knopf „Auf die Warteliste“ bzw. „Von der Warteliste nehmen“ und die Webseite in der Werkzeugzeile */
	private int plusActionsWidth() {
		HostingService.Plus plus = Hosting.plus();
		int w = Social.websiteUrl() != null ? 26 : 0;
		if (plus != null && !plus.granted()) w += ActionButton.widthFor(plus.waiting() ? WAITLIST_LEAVE : WAITLIST_JOIN, "check") + 6;
		return w;
	}

	private void openTab(Tab next) {
		tab = next;
		lastTab = next;
		scroll = 0;
		if (next == Tab.DISCOVER && (discover == null || System.currentTimeMillis() - discoverAt > DISCOVER_FRESH_MS)) loadDiscover(true);
		rebuildWidgets();
	}

	private void openDetail(Detail next, WorldService.World world) {
		detail = next;
		current = world;
		scroll = 0;
		fieldValue = "";
		if (next == Detail.MEMBERS && world != null) loadMembers();
		if (next == Detail.BACKUPS && world != null) {
			localWorld = WorldBackups.findWorld(minecraft.getLevelSource().getBaseDir(), world.id());
			backups = localWorld == null ? List.of() : WorldBackups.list(minecraft.gameDirectory.toPath(), localWorld.getFileName().toString());
		}
		if (next == Detail.PLUS) Hosting.refreshPlus().whenComplete((plus, error) -> minecraft.execute(() -> {
			if (error != null) note(WorldService.message(error), true);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
		rebuildWidgets();
	}

	private void closeDetail() {
		detail = Detail.NONE;
		fieldValue = "";
		rebuildWidgets();
	}

	private void loadMembers() {
		WorldService.World world = current;
		if (world == null) return;
		WorldService.members(world.id()).whenComplete((list, error) -> minecraft.execute(() -> {
			if (error != null) note(WorldService.message(error), true);
			else members = list;
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
	}

	// ======================================================================================
	// Aufbau
	// ======================================================================================

	@Override
	protected void initContent() {
		labels.clear();
		wrapped.clear();
		cards.clear();
		faces.clear();
		icons.clear();
		discoverIcons.clear();
		banner = null;
		emptyIconY = -1;
		field = null;
		rowsShown = 0;
		rowsTotal = 0;
		if (detail != Detail.NONE) {
			int bw = ActionButton.widthFor("Zurück", "back");
			addRenderableWidget(new ActionButton(headerRight() - bw, headerButtonY(), bw, 20, "Zurück", false, this::closeDetail)
					.withIcon("back").withVariant(ActionButton.Variant.GHOST));
		} else {
			int aw = ActionButton.widthFor(ADDRESS_LABEL, "connect");
			addRenderableWidget(new ActionButton(headerRight() - aw, headerButtonY(), aw, 20, ADDRESS_LABEL, true, () -> openDetail(Detail.ADDRESS, null))
					.withIcon("connect"));
			addRenderableWidget(ActionButton.icon(headerRight() - aw - 24, headerButtonY(), 20, "refresh", "Aktualisieren", () -> {
				reload();
				if (tab == Tab.DISCOVER) loadDiscover(true);
			}).withVariant(ActionButton.Variant.SECONDARY));
		}
		switch (detail) {
			case NONE -> {
				switch (tab) {
					case FRIENDS -> buildFriends();
					case MINE -> buildMine();
					case DISCOVER -> buildDiscover();
				}
			}
			case ADDRESS -> buildAddress();
			case MEMBERS -> buildMembers();
			case BACKUPS -> buildBackups();
			case PLUS -> buildPlus();
			case REPORT -> buildReport();
		}
		if (message != null && System.currentTimeMillis() - messageAt < 8000) {
			labels.add(new Label(contentX, contentY + contentH - 10, contentW, message, messageError ? Ui.DANGER : Ui.SUCCESS, Ui.Font.SMALL));
		}
		seenTransfer = transferSignature();
	}

	// --- Von Freunden -----------------------------------------------------------------------

	/** Welten von Freunden: geöffnete (laut Dienst), Einladungen der letzten 30 Minuten und dauerhafte Welten */
	private List<Entry> friendEntries() {
		List<Entry> list = new ArrayList<>();
		List<String> seen = new ArrayList<>();
		// geöffnete Welten laut Echtzeit (world-open/-closed); jedes Laden der Liste gleicht sie mit dem Dienst ab
		List<WorldService.FriendWorld> open = new ArrayList<>(WorldInvites.open());
		open.sort((a, b) -> a.hostName().compareToIgnoreCase(b.hostName()));
		for (WorldService.FriendWorld world : open) {
			String version = world.version() == null ? "" : "  ·  " + world.version();
			list.add(new Entry(world.name(), world.address(), world.hostUuid(), world.hostName(),
					"von " + world.hostName() + (world.hosted() != null ? "  ·  dauerhaft" : "") + "  ·  " + world.players() + "/" + world.maxPlayers()
							+ " Spieler" + version, world.hosted() == null ? null : State.of(world.hosted())));
			seen.add(world.id());
			seen.add(WorldShare.normalizeAddress(world.address()));
		}
		// schlafende dauerhafte Welten von Freunden (laut Dienst): Beitreten weckt sie
		for (WorldService.FriendWorld world : WorldInvites.sleepingHosted()) {
			if (seen.contains(world.id()) || seen.contains(WorldShare.normalizeAddress(world.address()))) continue;
			list.add(new Entry(world.name(), world.address(), world.hostUuid(), world.hostName(),
					"von " + world.hostName() + "  ·  dauerhaft  ·  schläft – Beitreten weckt sie", State.of(world.hosted())));
			seen.add(world.id());
			seen.add(WorldShare.normalizeAddress(world.address()));
		}
		// dauerhafte Welten, in denen man Operator ist (Dienst 1.13.0)
		HostingService.Overview overview = Hosting.overview();
		if (overview != null) {
			for (Hosted world : overview.operated()) {
				if (world.address() == null || seen.contains(WorldShare.normalizeAddress(world.address()))) continue;
				list.add(new Entry(world.name(), world.address(), world.ownerUuid(), world.ownerName(),
						"von " + world.ownerName() + "  ·  dauerhaft  ·  " + world.stateLine(), world.state()));
				seen.add(WorldShare.normalizeAddress(world.address()));
			}
		}
		// dauerhafte Welten von Freunden aus Entdecken
		for (DiscoverEntry entry : friendPool) {
			if (!entry.persistent() || entry.hostUuid() == null || !Social.isFriend(entry.hostUuid()) || seen.contains(entry.address())) continue;
			list.add(new Entry(entry.name(), entry.address(), entry.hostUuid(), entry.hostName(),
					"von " + entry.hostName() + "  ·  dauerhaft  ·  " + discoverState(entry), entry.state()));
			seen.add(entry.address());
		}
		for (WorldInvites.Invite invite : WorldInvites.recent()) {
			if (seen.contains(invite.worldId()) || seen.contains(WorldShare.normalizeAddress(invite.address()))) continue;
			list.add(new Entry(invite.name(), invite.address(), invite.hostUuid(), invite.hostName(), invite.hostName() + " hat dich eingeladen", null));
		}
		return list;
	}

	private void buildFriends() {
		List<Entry> entries = friendEntries();
		if (entries.isEmpty()) {
			empty(loadError != null ? loadError : loading && listing == null ? "Lädt …" : "Gerade hat keiner deiner Freunde eine Welt geöffnet.",
					"Eigene Welt öffnen: im Pausemenü einer Einzelspielerwelt auf „Welt teilen“. Eine Adresse bekommen? Oben „" + ADDRESS_LABEL + "“. "
							+ "Öffentliche Welten findest du unter „Entdecken“.");
			return;
		}
		int y = listStart(entries.size(), contentY, ROW);
		for (int i = 0; i < rowsShown; i++) {
			Entry entry = entries.get(scroll + i);
			int jw = ActionButton.widthFor(JOIN_LABEL, "play");
			cards.add(new int[] {contentX, y, contentW, ROW - 4});
			ActionButton join = new ActionButton(contentX + contentW - jw - 8, y + 9, jw, 20, JOIN_LABEL, true, () -> join(entry.name(), entry.address()))
					.withIcon("play");
			if (entry.hosted() != null) {
				join.active = entry.hosted().joinable();
				join.withTooltip(entry.hosted().waking() ? "Beitreten weckt sie (etwa 30 Sekunden)" : entry.hosted().joinable() ? null : "Gerade nicht erreichbar");
			}
			addRenderableWidget(join);
			int textW = contentW - jw - 70;
			labels.add(new Label(contentX + 40, y + 8, textW, entry.name(), Ui.TEXT, Ui.Font.LABEL));
			labels.add(new Label(contentX + 40, y + 21, textW, entry.detail(), entry.hosted() == State.ERROR ? Ui.DANGER : Ui.MUTED, Ui.Font.SMALL));
			faces.add(new Object[] {entry.hostUuid(), entry.host(), contentX + 10, y + 9});
			y += ROW;
		}
	}

	/** Köpfe der Gastgeber: {uuid, name, x, y} */
	private final List<Object[]> faces = new ArrayList<>();

	// --- Deine Welten -----------------------------------------------------------------------

	private void buildMine() {
		List<WorldService.World> mine = listing == null ? List.of() : listing.mine();
		int top = contentY;
		top = buildBanner(top);
		if (mine.isEmpty()) {
			empty(loadError != null ? loadError : loading && listing == null ? "Lädt …" : "Du hast noch keine Welt geteilt.",
					"Öffne eine Einzelspielerwelt und wähle im Pausemenü „Welt teilen“ – sie behält danach ihre Adresse. Dort kannst du sie auch "
							+ "dauerhaft online stellen.");
			return;
		}
		HostingService.Overview overview = Hosting.overview();
		int y = listStart(mine.size(), top, ROW);
		for (int i = 0; i < rowsShown; i++) {
			WorldService.World world = mine.get(scroll + i);
			Hosted hosted = overview == null ? null : overview.own(world.id());
			if (hosted != null || world.persistent()) hostedRow(world, hosted, y);
			else sharedRow(world, overview, y);
			y += ROW;
		}
	}

	/** Karte oben: Warteliste, Berechtigung oder laufende Übertragung; liefert die y-Position darunter */
	private int buildBanner(int y) {
		HostingService.Overview overview = Hosting.overview();
		HostingTransfer.Job job = HostingTransfer.current();
		String text;
		String icon;
		int color;
		String action = null;
		Runnable run = null;
		if (job != null && (job.running() || job.phase() == HostingTransfer.Phase.FAILED)) {
			text = (job.kind == HostingTransfer.Kind.UPLOAD ? "„" + job.name + "“: " : "„" + job.name + "“ herunterladen: ")
					+ (job.phase() == HostingTransfer.Phase.FAILED ? job.error() : job.line());
			icon = job.kind == HostingTransfer.Kind.UPLOAD ? "server" : "download";
			color = job.phase() == HostingTransfer.Phase.FAILED ? Ui.DANGER : Ui.ACCENT_TEXT;
			action = "Ansehen";
			run = () -> minecraft.gui.setScreen(HostWorldScreen.progress(this));
		} else if (overview == null || !overview.available()) {
			return y;
		} else if (!overview.allowed()) {
			HostingService.Plus plus = Hosting.plus();
			if (plus != null && plus.waiting()) {
				text = "Du stehst seit " + date(plus.since()) + " auf der Heldix+-Warteliste – dauerhaft online kommt bald.";
				action = "Ansehen";
			} else {
				text = PLUS_TEASER;
				action = "Warteliste";
			}
			icon = "sparkles";
			color = Ui.ACCENT_TEXT;
			run = () -> openDetail(Detail.PLUS, null);
		} else {
			int max = overview.limits() == null ? 1 : overview.limits().worlds();
			text = "Dauerhafte Welten: " + overview.worlds().size() + " von " + max + "  ·  laufen auf dem Heldix-Server, auch wenn du offline bist";
			icon = "server";
			color = Ui.MUTED;
		}
		banner = new int[] {contentX, y, contentW, 26, color};
		bannerIcon = icon;
		int aw = action == null ? 0 : ActionButton.widthFor(action) + 4;
		if (action != null) {
			addRenderableWidget(new ActionButton(contentX + contentW - aw - 4, y + 3, aw, 20, action, false, run).withVariant(ActionButton.Variant.SECONDARY));
		}
		labels.add(new Label(contentX + 28, y + 9, contentW - 36 - aw, text, color == Ui.MUTED ? Ui.MUTED : Ui.TEXT, Ui.Font.SMALL));
		return y + 32;
	}

	/** eigene geteilte Welt (nicht dauerhaft): Adresse, Mitglieder, Sicherungen, löschen und ggf. „Dauerhaft online stellen“ */
	private void sharedRow(WorldService.World world, HostingService.Overview overview, int y) {
		cards.add(new int[] {contentX, y, contentW, ROW - 4});
		int bx = contentX + contentW - 8 - 20;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "trash", "Welt beim Dienst löschen", () -> confirmDelete(world, false)));
		bx -= 24;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "clock", "Sicherungen", () -> openDetail(Detail.BACKUPS, world))
				.withVariant(ActionButton.Variant.SECONDARY));
		bx -= 24;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "friends", "Mitglieder", () -> openDetail(Detail.MEMBERS, world))
				.withVariant(ActionButton.Variant.SECONDARY));
		bx -= 24;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "copy", "Adresse kopieren", () -> copy(world.address()))
				.withVariant(ActionButton.Variant.SECONDARY));
		if (overview != null && overview.available()) {
			bx -= 24;
			Path local = localIndex.get(world.id());
			ActionButton host = ActionButton.icon(bx, y + 9, 20, "server", overview.allowed() ? (local == null ? HOST_LABEL + " – die Welt liegt nicht auf diesem PC"
					: HOST_LABEL) : PLUS_TEASER, () -> host(world, local)).withVariant(ActionButton.Variant.SECONDARY);
			host.active = !overview.allowed() || local != null;
			addRenderableWidget(host);
		}
		int textW = bx - 8 - (contentX + 40);
		labels.add(new Label(contentX + 40, y + 8, textW, world.name() + (world.online() ? "  ·  geöffnet" : ""), Ui.TEXT, Ui.Font.LABEL));
		labels.add(new Label(contentX + 40, y + 21, textW, WorldShare.normalizeAddress(world.address()) + "  ·  " + world.access().label + "  ·  bis "
				+ world.maxPlayers() + " Spieler", Ui.MUTED, Ui.Font.SMALL));
		icons.add(new Object[] {world.online() ? "lan" : "world", contentX + 10, y + 9, world.online() ? Ui.SUCCESS : Ui.ACCENT_TEXT});
	}

	/** dauerhafte Welt: Zustand, Beitreten, Webseite, Herunterladen, Mitglieder, Adresse, löschen */
	private void hostedRow(WorldService.World world, Hosted hosted, int y) {
		cards.add(new int[] {contentX, y, contentW, ROW - 4});
		State state = hosted != null ? hosted.state() : State.of(world.hosted());
		int bx = contentX + contentW - 8 - 20;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "trash", "Welt beim Dienst löschen (auch auf dem Heldix-Server)", () -> confirmDelete(world, true)));
		bx -= 24;
		ActionButton download = ActionButton.icon(bx, y + 9, 20, "download", DOWNLOAD_LABEL, () -> download(hosted)).withVariant(ActionButton.Variant.SECONDARY);
		download.active = hosted != null && !hosted.awaitingUpload() && !HostingTransfer.busy();
		addRenderableWidget(download);
		bx -= 24;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "external", MANAGE_LABEL, this::manage).withVariant(ActionButton.Variant.SECONDARY));
		bx -= 24;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "friends", "Mitglieder", () -> openDetail(Detail.MEMBERS, world))
				.withVariant(ActionButton.Variant.SECONDARY));
		bx -= 24;
		addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "copy", "Adresse kopieren", () -> copy(world.address()))
				.withVariant(ActionButton.Variant.SECONDARY));
		boolean awaiting = hosted != null && hosted.awaitingUpload();
		Path local = localIndex.get(world.id());
		if (awaiting && local != null) {
			// angelegt, aber nie fertig hochgeladen: noch einmal hochladen
			int hw = ActionButton.widthFor("Hochladen", "server");
			bx -= hw + 4;
			addRenderableWidget(new ActionButton(bx, y + 9, hw, 20, "Hochladen", true, () -> host(world, local)).withIcon("server"));
		} else {
			boolean roomy = contentW >= 400;
			int jw = roomy ? ActionButton.widthFor(JOIN_LABEL, "play") : 20;
			bx -= jw + 4;
			ActionButton join = roomy ? new ActionButton(bx, y + 9, jw, 20, JOIN_LABEL, true, () -> join(world.name(), world.address())).withIcon("play")
					: ActionButton.icon(bx, y + 9, 20, "play", JOIN_LABEL, () -> join(world.name(), world.address())).withVariant(ActionButton.Variant.PRIMARY);
			join.active = state.joinable();
			if (state.waking()) join.withTooltip("Beitreten weckt sie (etwa 30 Sekunden)");
			addRenderableWidget(join);
		}
		int textW = bx - 8 - (contentX + 40);
		String line = hosted != null ? hosted.stateLine() : state.label;
		labels.add(new Label(contentX + 40, y + 8, textW, world.name() + "  ·  dauerhaft", Ui.TEXT, Ui.Font.LABEL));
		labels.add(new Label(contentX + 40, y + 21, textW, WorldShare.normalizeAddress(world.address()) + "  ·  " + line,
				state == State.ERROR ? Ui.DANGER : Ui.MUTED, Ui.Font.SMALL));
		icons.add(new Object[] {"server", contentX + 10, y + 9, stateColor(state)});
	}

	/** Symbole der eigenen Welten: {Icon, x, y, Farbe} */
	private final List<Object[]> icons = new ArrayList<>();

	// --- Entdecken --------------------------------------------------------------------------

	private void buildDiscover() {
		int y = contentY;
		String sortLabel = discoverSort.label;
		String tagLabel = discoverTag == null ? "Alle Tags" : HostingService.TAGS.get(discoverTag);
		int sw = ActionButton.widthFor(sortLabel, "list");
		int tw = ActionButton.widthFor(tagLabel, "grid");
		int fw = Math.max(80, contentW - sw - tw - 12);
		field = new SearchField(contentX, y, fw, 20, "Welten suchen").withIcon("search").withMaxLength(64).keepOnEscape();
		field.setValue(discoverQuery);
		field.setResponder(value -> {
			discoverQuery = value.strip();
			queryChangedAt = System.currentTimeMillis();
		});
		field.setOnEnter(() -> {
			queryChangedAt = 0;
			loadDiscover(true);
		});
		addRenderableWidget(field);
		if (fieldFocused) setInitialFocus(field);
		addRenderableWidget(new ActionButton(contentX + fw + 6, y, sw, 20, sortLabel, false, () -> {
			discoverSort = discoverSort.next();
			loadDiscover(true);
			rebuildWidgets();
		}).withIcon("list").withTooltip("Sortierung (klicken zum Ändern)"));
		addRenderableWidget(new ActionButton(contentX + fw + 12 + sw, y, tw, 20, tagLabel, false, () -> {
			discoverTag = nextTag(discoverTag);
			loadDiscover(true);
			rebuildWidgets();
		}).withIcon("grid").withTooltip("Nach Tag filtern (klicken zum Ändern)"));
		int top = y + 28;
		List<DiscoverEntry> entries = discover == null ? List.of() : discover;
		if (entries.isEmpty()) {
			boolean filtered = discoverTag != null || !discoverQuery.isEmpty();
			emptyAt(top, discoverError != null ? discoverError : discoverLoading || discover == null ? "Lädt …"
					: filtered ? "Keine Welt passt zu deiner Suche." : "Noch steht keine Welt im Verzeichnis.",
					filtered ? "Anderen Tag wählen oder die Suche leeren." : "Besitzer können ihre offene Welt auf der Webseite unter Konto → Meine Welten "
							+ "„Im Verzeichnis zeigen“. Dauerhafte Welten stehen immer drin, normal geteilte nur, solange sie geöffnet sind.");
			return;
		}
		int rowY = listStart(entries.size(), top, DISCOVER_ROW);
		UUID own = minecraft.getUser().getProfileId();
		String version = SharedConstants.getCurrentVersion().name();
		for (int i = 0; i < rowsShown; i++) {
			DiscoverEntry entry = entries.get(scroll + i);
			discoverRow(entry, rowY, own, version);
			rowY += DISCOVER_ROW;
		}
		// am Ende angekommen: nächste Seite holen
		if (scroll + rowsShown >= entries.size() && discoverPage < discoverPages && !discoverLoading) loadDiscover(false);
		askLikes(entries.subList(scroll, scroll + rowsShown));
	}

	private void discoverRow(DiscoverEntry entry, int y, UUID own, String version) {
		int h = DISCOVER_ROW - 4;
		cards.add(new int[] {contentX, y, contentW, h});
		int by = y + (h - 20) / 2;
		int jw = ActionButton.widthFor(JOIN_LABEL, "play");
		int bx = contentX + contentW - 8 - jw;
		ActionButton join = new ActionButton(bx, by, jw, 20, JOIN_LABEL, true, () -> join(entry.name(), entry.address())).withIcon("play");
		join.active = entry.state().joinable();
		if (entry.state().waking()) join.withTooltip("Beitreten weckt sie (etwa 30 Sekunden)");
		addRenderableWidget(join);
		bx -= 24;
		boolean mine = own != null && own.equals(entry.hostUuid());
		ActionButton report = ActionButton.icon(bx, by, 20, "flag", mine ? "Deine eigene Welt" : REPORT_LABEL, () -> openReport(entry))
				.withVariant(ActionButton.Variant.SECONDARY);
		report.active = Social.online() && !mine;
		addRenderableWidget(report);
		HostingService.Like like = likes.get(entry.code());
		int count = like != null ? like.likes() : entry.likes();
		boolean liked = like != null && like.liked();
		String countText = Integer.toString(count);
		int lw = ActionButton.widthFor(countText, "star");
		bx -= lw + 4;
		ActionButton likeButton = new ActionButton(bx, by, lw, 20, countText, liked, () -> toggleLike(entry))
				.withIcon("star").withTooltip(mine ? "Deine eigene Welt" : !Social.online() ? "Nur angemeldet beim Heldix-Dienst" : liked ? "Gefällt dir – klicken zum Zurücknehmen"
						: LIKE_TOOLTIP);
		if (!liked) likeButton.withVariant(ActionButton.Variant.SECONDARY);
		likeButton.active = Social.online() && !mine && !busy;
		addRenderableWidget(likeButton);
		int textX = contentX + 44;
		int textW = bx - 8 - textX;
		String state = discoverState(entry);
		labels.add(new Label(textX, y + 7, textW, entry.name() + "  ·  " + state, Ui.TEXT, Ui.Font.LABEL));
		if (entry.description() != null) labels.add(new Label(textX, y + 19, textW, entry.description(), Ui.MUTED, Ui.Font.SMALL));
		StringBuilder meta = new StringBuilder();
		for (String tag : entry.tags()) meta.append(HostingService.TAGS.get(tag)).append("  ·  ");
		meta.append(entry.players()).append('/').append(entry.maxPlayers()).append(" Spieler  ·  von ").append(entry.hostName());
		boolean otherVersion = entry.version() != null && !entry.version().equals(version);
		if (entry.version() != null) meta.append("  ·  Minecraft ").append(entry.version());
		faces.add(new Object[] {entry.hostUuid(), entry.hostName(), textX, y + 31, 9});
		labels.add(new Label(textX + 12, y + 32, textW - 12, meta.toString(), otherVersion ? Ui.WARNING : Ui.FAINT, Ui.Font.SMALL));
		discoverIcons.add(new Object[] {entry, contentX + 10, y + (h - 26) / 2, stateColor(entry.state())});
	}

	/** Symbole der Einträge in Entdecken: {Eintrag, x, y, Farbe} */
	private final List<Object[]> discoverIcons = new ArrayList<>();

	private static String discoverState(DiscoverEntry entry) {
		return switch (entry.state()) {
			case ONLINE -> "geöffnet";
			case RUNNING -> "läuft";
			case SLEEPING, STOPPING -> "schläft – Beitreten weckt sie";
			case STARTING -> "startet gerade";
			default -> entry.state().label;
		};
	}

	private static int stateColor(State state) {
		return switch (state) {
			case RUNNING, ONLINE -> Ui.SUCCESS;
			case STARTING, CREATING -> Ui.WARNING;
			case ERROR -> Ui.DANGER;
			default -> Ui.ACCENT_TEXT;
		};
	}

	private static String nextTag(String tag) {
		List<String> ids = new ArrayList<>(HostingService.TAGS.keySet());
		if (tag == null) return ids.getFirst();
		int index = ids.indexOf(tag);
		return index < 0 || index == ids.size() - 1 ? null : ids.get(index + 1);
	}

	/** Gefällt-mir-Stand der sichtbaren Einträge einmal nachfragen (nur angemeldet) */
	private void askLikes(List<DiscoverEntry> visible) {
		if (!Social.online()) return;
		for (DiscoverEntry entry : visible) {
			if (!likesAsked.add(entry.code())) continue;
			HostingService.liked(entry.code()).whenComplete((like, error) -> minecraft.execute(() -> {
				if (like == null) return;
				likes.put(entry.code(), like);
				if (minecraft.gui.screen() == this && tab == Tab.DISCOVER && detail == Detail.NONE) rebuildWidgets();
			}));
		}
	}

	// --- Adresse, Mitglieder, Sicherungen ---------------------------------------------------

	private void buildAddress() {
		int y = contentY + 4;
		int jw = ActionButton.widthFor(JOIN_LABEL, "play");
		field = new SearchField(contentX, y, contentW - jw - 8, 22, "abc234.welt.heldixclient.com").withIcon("connect").withMaxLength(255).keepOnEscape();
		field.setValue(fieldValue);
		field.setResponder(value -> fieldValue = value);
		field.setOnEnter(this::joinTyped);
		addRenderableWidget(field);
		setInitialFocus(field);
		addRenderableWidget(new ActionButton(contentX + contentW - jw, y + 1, jw, 20, JOIN_LABEL, true, this::joinTyped).withIcon("play"));
		paragraph(y + 34, "Heldix-Welten haben feste Adressen. Wer sie kennt, kann sie auch ohne HeldixClient bei Mehrspieler → Server hinzufügen "
				+ "eingeben. Ob du hinein darfst, entscheidet der Gastgeber – sonst klopfst du an.", Ui.MUTED);
	}

	private void buildMembers() {
		int y = contentY;
		int addW = ActionButton.widthFor("Hinzufügen", "plus");
		field = new SearchField(contentX, y + 2, contentW - addW - 8, 20, "Spielername").withIcon("user-plus").withMaxLength(16).keepOnEscape();
		field.setValue(fieldValue);
		field.setResponder(value -> fieldValue = value);
		field.setOnEnter(this::addMember);
		addRenderableWidget(field);
		addRenderableWidget(new ActionButton(contentX + contentW - addW, y + 2, addW, 20, "Hinzufügen", true, this::addMember).withIcon("plus"));
		y += 30;
		if (members.isEmpty()) {
			paragraph(y + 6, "Noch niemand eingetragen. Eingeladene Freunde und Spieler, denen du das Beitreten erlaubst, stehen hier.", Ui.MUTED);
			return;
		}
		int room = Math.max(0, (contentY + contentH - 16 - y) / 26);
		rowsTotal = members.size();
		scroll = Math.clamp(scroll, 0, Math.max(0, rowsTotal - room));
		rowsShown = Math.min(room, rowsTotal - scroll);
		int rw = Math.min(140, contentW / 2);
		for (int i = 0; i < rowsShown; i++) {
			Member member = members.get(scroll + i);
			labels.add(new Label(contentX + 4, y + 8, contentW - rw - 40, member.name(), Ui.TEXT, Ui.Font.BODY));
			Role next = member.role().next();
			addRenderableWidget(new ActionButton(contentX + contentW - rw - 24, y + 2, rw, 20, member.role().label, false,
					() -> memberCall(WorldService.putMember(current.id(), member.name(), next), member.name() + " ist jetzt " + next.label))
					.withIcon("user").withTooltip("Klicken zum Ändern"));
			addRenderableWidget(ActionButton.icon(contentX + contentW - 20, y + 2, 20, "trash", "Entfernen",
					() -> memberCall(WorldService.removeMember(current.id(), member.name()), member.name() + " ist nicht mehr eingetragen")));
			y += 26;
		}
	}

	private void buildBackups() {
		int y = contentY;
		if (localWorld == null) {
			empty("Diese Welt liegt nicht auf diesem PC.", "Sicherungen entstehen auf dem PC, auf dem die Welt geteilt wird.");
			return;
		}
		if (backups.isEmpty()) {
			empty("Noch keine Sicherung.", "Vor jedem „Welt teilen“ legt HeldixClient eine an.");
			return;
		}
		boolean locked = locked(localWorld);
		if (locked) {
			labels.add(new Label(contentX, y, contentW, "Die Welt ist gerade geöffnet – wiederherstellen geht nur bei geschlossener Welt.", Ui.WARNING, Ui.Font.SMALL));
			y += 14;
		}
		int room = Math.max(0, (contentY + contentH - 16 - y) / 30);
		rowsTotal = backups.size();
		scroll = Math.clamp(scroll, 0, Math.max(0, rowsTotal - room));
		rowsShown = Math.min(room, rowsTotal - scroll);
		String restore = "Wiederherstellen";
		int rw = ActionButton.widthFor(restore, "undo");
		for (int i = 0; i < rowsShown; i++) {
			WorldBackups.Backup backup = backups.get(scroll + i);
			cards.add(new int[] {contentX, y, contentW, 26});
			labels.add(new Label(contentX + 10, y + 9, contentW - rw - 120, backup.label(), Ui.TEXT, Ui.Font.BODY));
			labels.add(new Label(contentX + contentW - rw - 90, y + 9, 70, backup.sizeLabel(), Ui.FAINT, Ui.Font.SMALL));
			ActionButton button = new ActionButton(contentX + contentW - rw - 4, y + 3, rw, 20, restore, false, () -> confirmRestore(backup)).withIcon("undo");
			button.active = !locked;
			addRenderableWidget(button);
			y += 30;
		}
	}

	// --- Heldix+-Warteliste -----------------------------------------------------------------

	private void buildPlus() {
		int y = contentY + 2;
		HostingService.Plus plus = Hosting.plus();
		labels.add(new Label(contentX, y, contentW, "Dauerhaft online – bald mit Heldix+", Ui.TEXT, Ui.Font.LABEL));
		y = paragraph(y + 14, "Mit dauerhaften Welten läuft deine Welt auf dem Heldix-Server weiter, auch wenn du offline bist – Freunde treten jederzeit "
				+ "bei. Gerade ist das eine Beta für Tester und das HeldixClient-Team; später gehört es zu Heldix+.", Ui.MUTED) + 6;
		y = paragraph(y, "Heldix+ ist geplant: dauerhafte Welten, mehr Plätze und Speicher, Vorrang beim Start. Preise und Inhalte stehen noch nicht fest "
				+ "– bezahlt wird nichts.", Ui.MUTED) + 8;
		String state;
		int color = Ui.TEXT;
		if (plus == null) {
			state = "Lädt …";
			color = Ui.MUTED;
		} else if (plus.granted()) {
			state = "Du bist freigeschaltet – du kannst dauerhafte Welten anlegen (Deine Welten → „" + HOST_LABEL + "“).";
			color = Ui.SUCCESS;
		} else if (plus.waiting()) {
			state = "Du stehst seit " + date(plus.since()) + " auf der Warteliste. Beta-Plätze werden nach und nach vergeben – du bekommst dann eine "
					+ "Einblendung im Spiel und im Launcher.";
		} else {
			state = "Auf die Warteliste? Wirst du freigeschaltet, bekommst du eine Einblendung im Spiel und im Launcher – keine E-Mail.";
		}
		y = paragraph(y, state, color) + 4;
		if (plus != null && plus.count() != null) paragraph(y, "Schon " + plus.count() + " stehen auf der Warteliste.", Ui.FAINT);
		// Knöpfe in der Werkzeugzeile (links von „Zurück“): so bleiben sie auch in kleinen Fenstern sichtbar
		int x = headerRight() - ActionButton.widthFor("Zurück", "back") - 6;
		if (plus != null && !plus.granted()) {
			String label = plus.waiting() ? WAITLIST_LEAVE : WAITLIST_JOIN;
			int w = ActionButton.widthFor(label, "check");
			x -= w;
			ActionButton button = new ActionButton(x, headerButtonY(), w, 20, label, !plus.waiting(), () -> waitlist(!plus.waiting()))
					.withIcon(plus.waiting() ? "close" : "check");
			button.active = !busy && Social.online();
			addRenderableWidget(button);
			x -= 6;
		}
		if (Social.websiteUrl() != null) {
			x -= 20;
			addRenderableWidget(ActionButton.icon(x, headerButtonY(), 20, "external", "Mehr auf der Webseite (Heldix+)", () -> {
				if (Hosting.openPlusPage() != null) note("Die Seite „Heldix+“ ist im Browser geöffnet.", false);
				rebuildWidgets();
			}).withVariant(ActionButton.Variant.SECONDARY));
		}
	}

	// --- Melden -----------------------------------------------------------------------------

	private void buildReport() {
		DiscoverEntry entry = reportEntry;
		if (entry == null) {
			paragraph(contentY + 4, "Kein Eintrag gewählt – zurück zu Entdecken.", Ui.MUTED);
			return;
		}
		int y = contentY + 2;
		labels.add(new Label(contentX, y, contentW, "„" + entry.name() + "“ von " + entry.hostName() + " melden", Ui.TEXT, Ui.Font.LABEL));
		y += 18;
		int cw = Math.min(230, Math.max(120, contentW / 2));
		labels.add(new Label(contentX, y + 8, contentW - cw - 10, "Grund", Ui.TEXT, Ui.Font.LABEL));
		addRenderableWidget(new ActionButton(contentX + contentW - cw, y + 2, cw, 20, HostingService.REPORT_REASONS.get(reportReason), false, () -> {
			List<String> ids = new ArrayList<>(HostingService.REPORT_REASONS.keySet());
			reportReason = ids.get((ids.indexOf(reportReason) + 1) % ids.size());
			rebuildWidgets();
		}).withIcon("flag").withTooltip("Klicken zum Ändern"));
		y += 28;
		field = new SearchField(contentX, y, contentW, 20, "Notiz für das Team (freiwillig, eine Zeile)").withIcon("edit").withMaxLength(300).keepOnEscape();
		field.setValue(fieldValue);
		field.setResponder(value -> fieldValue = value);
		field.setOnEnter(this::sendReport);
		addRenderableWidget(field);
		y += 30;
		int rw = ActionButton.widthFor(REPORT_LABEL, "flag") + 8;
		ActionButton send = new ActionButton(contentX + contentW - rw, y, rw, 22, REPORT_LABEL, true, this::sendReport).withIcon("flag");
		send.active = !busy && Social.online();
		addRenderableWidget(send);
		y = paragraph(y + 32, "Das HeldixClient-Team sieht sich jede Meldung an und blendet Einträge bei Verstößen aus. Regeln im Verzeichnis: Keine "
				+ "Beleidigungen oder Hetze. Keine Werbung für fremde Dienste. Nichts Jugendgefährdendes.", Ui.MUTED);
	}

	// --- Hilfen für den Aufbau --------------------------------------------------------------

	private static boolean locked(Path world) {
		try {
			return DirectoryLock.isLocked(world);
		} catch (Exception e) {
			return true;
		}
	}

	/** erste Zeile der Liste ab {@code top}; legt fest, wie viele Zeilen passen */
	private int listStart(int total, int top, int row) {
		int room = Math.max(1, (contentY + contentH - 14 - top) / row);
		rowsTotal = total;
		scroll = Math.clamp(scroll, 0, Math.max(0, total - room));
		rowsShown = Math.min(room, total - scroll);
		return top;
	}

	private void empty(String title, String hint) {
		emptyAt(contentY, title, hint);
	}

	private void emptyAt(int top, String title, String hint) {
		int cy = Math.max(top, top + (contentY + contentH - top) / 2 - 40);
		labels.add(new Label(contentX + contentW / 2 - Ui.width(title, Ui.Font.LABEL) / 2, cy + 42, contentW, title, Ui.TEXT, Ui.Font.LABEL));
		List<FormattedCharSequence> lines = Ui.wrap(hint, Math.min(contentW, 380), Ui.Font.SMALL);
		int y = cy + 56;
		for (FormattedCharSequence line : lines) {
			wrapped.add(new Object[] {line, contentX + contentW / 2 - font.width(line) / 2, y, Ui.MUTED});
			y += 10;
		}
		emptyIconY = cy;
	}

	private int emptyIconY = -1;

	private int paragraph(int y, String text, int color) {
		for (FormattedCharSequence line : Ui.wrap(text, contentW, Ui.Font.SMALL)) {
			if (y + 9 > contentY + contentH - 12) break;
			wrapped.add(new Object[] {line, contentX, y, color});
			y += 10;
		}
		return y;
	}

	private void note(String text, boolean error) {
		message = text;
		messageError = error;
		messageAt = System.currentTimeMillis();
	}

	private static String date(long at) {
		return DATE.format(Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()));
	}

	// ======================================================================================
	// Aktionen
	// ======================================================================================

	private void join(String name, String address) {
		HostedJoin.join(minecraft, this, name, address);
	}

	private void joinTyped() {
		String address = fieldValue.strip().toLowerCase(Locale.ROOT);
		if (address.isEmpty() || !net.minecraft.client.multiplayer.resolver.ServerAddress.isValidAddress(address)) {
			note("Das ist keine gültige Adresse", true);
			rebuildWidgets();
			return;
		}
		join(WorldShare.isWorldAddress(address) ? "Heldix-Welt" : address, address);
	}

	private void copy(String address) {
		minecraft.keyboardHandler.setClipboard(WorldShare.normalizeAddress(address));
		note("Adresse kopiert", false);
		rebuildWidgets();
	}

	/** „Dauerhaft online stellen“: mit Berechtigung die Erklärung, sonst die Warteliste */
	private void host(WorldService.World world, Path local) {
		HostingService.Overview overview = Hosting.overview();
		if (overview == null || !overview.available()) return;
		if (!overview.allowed()) {
			openDetail(Detail.PLUS, null);
			return;
		}
		if (local == null) {
			note("Die Welt liegt nicht auf diesem PC – dauerhaft online stellen geht dort, wo sie gespeichert ist.", true);
			rebuildWidgets();
			return;
		}
		Hosted existing = overview.own(world.id());
		if (existing == null && !overview.room()) {
			int max = overview.limits() == null ? 1 : overview.limits().worlds();
			note(max == 1 ? "Du hast schon eine dauerhafte Welt." : "Du hast schon " + max + " dauerhafte Welten.", true);
			rebuildWidgets();
			return;
		}
		minecraft.gui.setScreen(HostWorldScreen.upload(this, local, world.name()));
	}

	private void manage() {
		Hosting.manageOnWebsite().whenComplete((ignored, error) -> minecraft.execute(() -> {
			note(error != null ? WorldService.message(error) : "Meine Welten ist im Browser geöffnet.", error != null);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
	}

	private void download(Hosted hosted) {
		if (hosted == null) return;
		HostingTransfer.Job job = HostingTransfer.download(minecraft, hosted);
		if (job == null) {
			note("Es läuft schon eine Übertragung.", true);
			rebuildWidgets();
			return;
		}
		minecraft.gui.setScreen(HostWorldScreen.progress(this));
	}

	private void waitlist(boolean join) {
		busy = true;
		Hosting.waitlist(join).whenComplete((plus, error) -> minecraft.execute(() -> {
			busy = false;
			if (error != null) note(WorldService.message(error), true);
			else note(join ? "Du stehst jetzt auf der Warteliste." : "Du stehst nicht mehr auf der Warteliste.", false);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
		rebuildWidgets();
	}

	private void toggleLike(DiscoverEntry entry) {
		HostingService.Like now = likes.get(entry.code());
		boolean want = now == null || !now.liked();
		busy = true;
		HostingService.like(entry.code(), want).whenComplete((like, error) -> minecraft.execute(() -> {
			busy = false;
			if (error != null) note(WorldService.message(error), true);
			else likes.put(entry.code(), like);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
		rebuildWidgets();
	}

	private void openReport(DiscoverEntry entry) {
		reportEntry = entry;
		reportReason = "harassment";
		openDetail(Detail.REPORT, null);
	}

	private void sendReport() {
		DiscoverEntry entry = reportEntry;
		if (entry == null || busy) return;
		busy = true;
		String note = fieldValue;
		HostingService.report(entry.code(), reportReason, note).whenComplete((ignored, error) -> minecraft.execute(() -> {
			busy = false;
			if (error != null) {
				note(WorldService.message(error), true);
			} else {
				note("Danke – das Team sieht sich „" + entry.name() + "“ an.", false);
				detail = Detail.NONE;
				fieldValue = "";
			}
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
		rebuildWidgets();
	}

	private void addMember() {
		String name = fieldValue.strip();
		if (current == null) return;
		if (!name.matches("^[A-Za-z0-9_]{3,16}$")) {
			note("Spielernamen haben 3 bis 16 Zeichen (Buchstaben, Ziffern, _)", true);
			rebuildWidgets();
			return;
		}
		fieldValue = "";
		memberCall(WorldService.putMember(current.id(), name, current.defaultRole()), name + " ist eingetragen");
	}

	private void memberCall(CompletableFuture<Void> call, String done) {
		call.whenComplete((ignored, error) -> minecraft.execute(() -> {
			note(error != null ? WorldService.message(error) : done, error != null);
			loadMembers();
		}));
	}

	private void confirmDelete(WorldService.World world, boolean hosted) {
		minecraft.gui.setScreen(new ConfirmScreen(confirmed -> {
			if (!confirmed) {
				minecraft.gui.setScreen(this);
				return;
			}
			minecraft.gui.setScreen(this);
			WorldService.delete(world.id()).whenComplete((ignored, error) -> minecraft.execute(() -> {
				if (error != null) {
					note(WorldService.message(error), true);
				} else {
					Path local = WorldBackups.findWorld(minecraft.getLevelSource().getBaseDir(), world.id());
					if (local != null) WorldBackups.forgetId(local);
					note("„" + world.name() + "“ ist beim Dienst gelöscht", false);
				}
				reload();
				if (minecraft.gui.screen() == this) rebuildWidgets();
			}));
		}, Component.literal("„" + world.name() + "“ beim Heldix-Dienst löschen?"),
				Component.literal(hosted ? "Die dauerhafte Welt auf dem Heldix-Server wird mit gelöscht – samt Plugins und Sicherungen dort (vorher auf der "
						+ "Webseite herunterladen!). Die Adresse " + WorldShare.normalizeAddress(world.address()) + " ist danach weg. Deine Einzelspielerwelt "
						+ "auf diesem PC bleibt."
						: "Die Adresse " + WorldShare.normalizeAddress(world.address()) + " und die Mitgliederliste sind danach weg. Die Welt selbst und "
								+ "ihre Sicherungen bleiben auf deinem PC; beim nächsten Teilen bekommt sie eine neue Adresse."),
				Component.literal("Löschen"), CommonComponents.GUI_CANCEL));
	}

	private void confirmRestore(WorldBackups.Backup backup) {
		Path world = localWorld;
		if (world == null) return;
		minecraft.gui.setScreen(new ConfirmScreen(confirmed -> {
			minecraft.gui.setScreen(this);
			if (!confirmed) return;
			if (locked(world)) {
				note("Die Welt ist gerade geöffnet – erst schließen", true);
				rebuildWidgets();
				return;
			}
			note("Wird wiederhergestellt …", false);
			rebuildWidgets();
			Path game = minecraft.gameDirectory.toPath();
			CompletableFuture.runAsync(() -> {
				try {
					WorldBackups.restore(game, world, backup.file());
				} catch (Exception e) {
					throw new IllegalStateException(e.getMessage(), e);
				}
			}).whenComplete((ignored, error) -> minecraft.execute(() -> {
				if (error != null) note("Wiederherstellen fehlgeschlagen: " + (error.getCause() != null ? error.getCause().getMessage() : error.getMessage()), true);
				else note("Sicherung vom " + backup.label() + " ist wiederhergestellt", false);
				backups = WorldBackups.list(game, world.getFileName().toString());
				if (minecraft.gui.screen() == this) rebuildWidgets();
			}));
		}, Component.literal("Sicherung vom " + backup.label() + " wiederherstellen?"),
				Component.literal("Die Welt wird auf diesen Stand zurückgesetzt. Der jetzige Stand wird vorher selbst gesichert."),
				Component.literal("Wiederherstellen"), CommonComponents.GUI_CANCEL));
	}

	// ======================================================================================
	// Zeichnen, Eingaben
	// ======================================================================================

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (banner != null) {
			Ui.rect(g, banner[0], banner[1], banner[2], banner[3], 8, Ui.SURFACE);
			Ui.outline(g, banner[0], banner[1], banner[2], banner[3], 8, banner[4] == Ui.MUTED ? Ui.LINE : Ui.withAlpha(banner[4], 0.5f));
			Ui.icon(g, bannerIcon, banner[0] + 9, banner[1] + 8, 10, banner[4] == Ui.MUTED ? Ui.ACCENT_TEXT : banner[4]);
		}
		for (int[] card : cards) {
			boolean hover = Ui.inside(mouseX, mouseY, card[0], card[1], card[2], card[3]);
			Ui.rect(g, card[0], card[1], card[2], card[3], 9, hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
			Ui.outline(g, card[0], card[1], card[2], card[3], 9, Ui.LINE);
		}
		for (Object[] face : faces) {
			UUID uuid = (UUID) face[0];
			int x = (int) face[2];
			int y = (int) face[3];
			int size = face.length > 4 ? (int) face[4] : 20;
			if (uuid != null) FriendWidget.face(g, uuid, (String) face[1], x, y, size, 1f);
			else {
				Ui.rect(g, x, y, size, size, Math.max(2, size / 3f), Ui.ACCENT_SOFT);
				Ui.icon(g, "lan", x + size / 4f, y + size / 4f, size / 2f, Ui.ACCENT_TEXT);
			}
		}
		for (Object[] icon : icons) {
			int x = (int) icon[1];
			int y = (int) icon[2];
			int color = (int) icon[3];
			Ui.rect(g, x, y, 20, 20, 6, Ui.withAlpha(color, 0.2f));
			Ui.icon(g, (String) icon[0], x + 5, y + 5, 10, color);
		}
		for (Object[] item : discoverIcons) {
			DiscoverEntry entry = (DiscoverEntry) item[0];
			int x = (int) item[1];
			int y = (int) item[2];
			Identifier texture = DiscoverIcons.icon(entry);
			if (texture != null) {
				Ui.texture(g, texture, x, y, 26, 26, 64, 64);
			} else {
				Ui.rect(g, x, y, 26, 26, 7, Ui.ACCENT_SOFT);
				Ui.icon(g, entry.persistent() ? "server" : "world", x + 7, y + 7, 12, Ui.ACCENT_TEXT);
			}
			// Zustand als Punkt unten rechts
			Ui.circle(g, x + 24, y + 24, 4, 0xFF0F1420);
			Ui.circle(g, x + 24, y + 24, 3, (int) item[3]);
		}
		if (emptyIconY >= 0) {
			int cx = contentX + contentW / 2;
			Ui.rect(g, cx - 16, emptyIconY, 32, 32, 10, Ui.ACCENT_SOFT);
			Ui.icon(g, tab == Tab.DISCOVER && detail == Detail.NONE ? "compass" : "lan", cx - 8, emptyIconY + 8, 16, Ui.ACCENT_TEXT);
		}
		for (Label label : labels) {
			Ui.text(g, Ui.ellipsize(label.text(), Math.max(10, label.w()), label.font()), label.x(), label.y(), label.color(), label.font());
		}
		for (Object[] line : wrapped) g.text(font, (FormattedCharSequence) line[0], (int) line[1], (int) line[2], (int) line[3], false);
		if (rowsTotal > rowsShown && rowsShown > 0) {
			String total = tab == Tab.DISCOVER && detail == Detail.NONE && discoverTotal > rowsTotal ? Integer.toString(discoverTotal) : Integer.toString(rowsTotal);
			Ui.textRight(g, (scroll + 1) + "–" + (scroll + rowsShown) + " von " + total + " · Mausrad blättert", contentX + contentW, contentY + contentH - 10,
					Ui.FAINT, Ui.Font.SMALL);
		}
	}

	private String transferSignature() {
		HostingTransfer.Job job = HostingTransfer.current();
		return job == null ? "" : job.phase() + "|" + job.line();
	}

	@Override
	public void tick() {
		super.tick();
		if (field != null && tab == Tab.DISCOVER && detail == Detail.NONE) fieldFocused = field.isFocused();
		// alle 30 Sekunden neu laden (geöffnete Welten kommen und gehen), bei Echtzeit-Meldungen sofort neu aufbauen
		if (detail == Detail.NONE && System.currentTimeMillis() - loadedAt > 30_000) {
			reload();
			if (tab == Tab.DISCOVER && System.currentTimeMillis() - discoverAt > DISCOVER_FRESH_MS) loadDiscover(true);
		}
		// Suche: kurz nach dem letzten Tippen
		if (queryChangedAt > 0 && System.currentTimeMillis() - queryChangedAt > 450) {
			queryChangedAt = 0;
			loadDiscover(true);
		}
		boolean rebuild = false;
		if (seenChanges != WorldInvites.changes()) {
			seenChanges = WorldInvites.changes();
			rebuild = detail == Detail.NONE;
		}
		if (seenHosting != Hosting.changes()) {
			seenHosting = Hosting.changes();
			rebuild |= detail == Detail.NONE || detail == Detail.PLUS;
		}
		if (tab == Tab.MINE && detail == Detail.NONE && !transferSignature().equals(seenTransfer)) rebuild = true;
		if (message != null && System.currentTimeMillis() - messageAt > 8000) {
			message = null;
			rebuild = true;
		}
		if (rebuild) rebuildWidgets();
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
		if (event.key() == InputConstants.KEY_ESCAPE && detail != Detail.NONE) {
			closeDetail();
			return true;
		}
		return super.keyPressed(event);
	}

	// ======================================================================================
	// Für den Autotest
	// ======================================================================================

	public List<String> describe() {
		List<String> list = new ArrayList<>();
		for (Label label : labels) list.add(label.text());
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

	public boolean loaded() {
		return listing != null || loadError != null;
	}

	public void showMine() {
		openTab(Tab.MINE);
	}

	public void showFriends() {
		openTab(Tab.FRIENDS);
	}

	public void showDiscover() {
		openTab(Tab.DISCOVER);
	}

	/** Entdecken mit Suche (frisch geladen) */
	public void searchDiscover(String query) {
		discoverQuery = query == null ? "" : query.strip();
		discoverTag = null;
		discoverSort = HostingService.Sort.NEW;
		tab = Tab.DISCOVER;
		lastTab = Tab.DISCOVER;
		detail = Detail.NONE;
		loadDiscover(true);
		rebuildWidgets();
	}

	public boolean discoverLoaded() {
		return discover != null || discoverError != null;
	}

	public List<DiscoverEntry> discoverEntries() {
		return discover == null ? List.of() : discover;
	}

	public String discoverError() {
		return discoverError;
	}

	public void showPlus() {
		openDetail(Detail.PLUS, null);
	}

	public void showReport(String code) {
		if (discover == null) return;
		discover.stream().filter(e -> e.code().equals(code)).findFirst().ifPresent(this::openReport);
	}

	public void showBackups(String worldId) {
		if (listing == null) return;
		listing.mine().stream().filter(w -> w.id().equals(worldId)).findFirst().ifPresent(w -> openDetail(Detail.BACKUPS, w));
	}

	/** Ordner der Welt auf diesem PC laut Liste (für den Autotest) */
	public Path localWorld(String worldId) {
		return localIndex.get(worldId);
	}
}
