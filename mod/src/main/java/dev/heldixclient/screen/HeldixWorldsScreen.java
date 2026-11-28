package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.share.WorldBackups;
import dev.heldixclient.share.WorldInvites;
import dev.heldixclient.share.WorldService;
import dev.heldixclient.share.WorldService.Member;
import dev.heldixclient.share.WorldService.Role;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.util.DirectoryLock;
import net.minecraft.util.FormattedCharSequence;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Heldix-Welten (Spielen → Heldix-Welten, auch als Kachel auf der Startseite): gerade geöffnete Welten von Freunden mit
 * „Beitreten“ (dazu Einladungen aus der Echtzeit-Verbindung), die eigenen geteilten Welten mit Adresse, Zugang,
 * Mitgliedern und Sicherungen (wiederherstellen nur bei geschlossener Welt, mit Rückfrage) sowie „Adresse eingeben“.
 * Eine eigene Welt öffnet man im Pausemenü mit „Welt teilen“.
 */
public class HeldixWorldsScreen extends ShellScreen {
	public static final String ADDRESS_LABEL = "Adresse eingeben";
	public static final String JOIN_LABEL = "Beitreten";

	private enum Tab {
		FRIENDS,
		MINE
	}

	private enum Detail {
		NONE,
		ADDRESS,
		MEMBERS,
		BACKUPS
	}

	/** Eintrag der Liste „Von Freunden“ (geöffnete Welt oder Einladung) */
	private record Entry(String name, String address, UUID hostUuid, String host, String detail) {
	}

	private record Label(int x, int y, int w, String text, int color, Ui.Font font) {
	}

	private static final int ROW = 42;
	private static Tab lastTab = Tab.FRIENDS;

	private Tab tab = lastTab;
	private Detail detail = Detail.NONE;
	private WorldService.World current;
	private volatile WorldService.Listing listing;
	private volatile String loadError;
	private volatile boolean loading;
	private volatile List<Member> members = List.of();
	private List<WorldBackups.Backup> backups = List.of();
	private Path localWorld;
	private final List<Label> labels = new ArrayList<>();
	private final List<Object[]> wrapped = new ArrayList<>();
	/** Flächen der Zeilen (x, y, w, h) zum Zeichnen */
	private final List<int[]> cards = new ArrayList<>();
	private String message;
	private boolean messageError;
	private long messageAt;
	private int scroll;
	private int rowsShown;
	private int rowsTotal;
	private SearchField field;
	private String fieldValue = "";
	private long loadedAt;
	private int seenChanges = WorldInvites.changes();

	public HeldixWorldsScreen() {
		super(Component.literal("Heldix-Welten"), Shell.Page.HELDIX_WORLDS);
		reload();
	}

	// ======================================================================================
	// Laden
	// ======================================================================================

	private void reload() {
		if (loading) return;
		if (!Social.online()) {
			loadError = Social.state() == Social.State.OFFLINE_ACCOUNT ? "Heldix-Welten gibt es nur mit einem Microsoft-Konto."
					: Social.baseUrl().isEmpty() ? "Kein Heldix-Dienst eingetragen." : "Nicht mit dem Heldix-Dienst verbunden.";
			return;
		}
		loading = true;
		loadedAt = System.currentTimeMillis();
		WorldService.list().whenComplete((result, error) -> net.minecraft.client.Minecraft.getInstance().execute(() -> {
			loading = false;
			if (error != null) {
				loadError = WorldService.message(error);
			} else {
				listing = result;
				loadError = null;
				WorldInvites.syncOpen(result.friends());
				seenChanges = WorldInvites.changes();
				if (current != null) current = result.mine().stream().filter(w -> w.id().equals(current.id())).findFirst().orElse(null);
				if (current == null && detail != Detail.ADDRESS) detail = Detail.NONE;
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
						() -> tab == Tab.MINE, () -> openTab(Tab.MINE)));
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
			case NONE -> "Heldix-Welten";
		});
	}

	@Override
	protected String headerIcon() {
		return switch (detail) {
			case ADDRESS -> "connect";
			case MEMBERS -> "friends";
			case BACKUPS -> "clock";
			case NONE -> "lan";
		};
	}

	@Override
	protected String subtitle() {
		return switch (detail) {
			case ADDRESS -> "Adresse einer Heldix-Welt (z. B. abc234.welt.heldixclient.com) oder eines Servers";
			case MEMBERS -> current == null ? null : WorldShare.normalizeAddress(current.address());
			case BACKUPS -> localWorld == null ? "nicht auf diesem PC" : "die letzten " + WorldBackups.KEEP + " vor jedem Teilen";
			case NONE -> null;
		};
	}

	@Override
	protected int toolbarActionsWidth() {
		return detail != Detail.NONE ? ActionButton.widthFor("Zurück", "back") : ActionButton.widthFor(ADDRESS_LABEL, "connect") + 24;
	}

	private void openTab(Tab next) {
		tab = next;
		lastTab = next;
		scroll = 0;
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
		emptyIconY = -1;
		field = null;
		rowsShown = 0;
		rowsTotal = 0;
		if (detail != Detail.NONE) {
			int bw = ActionButton.widthFor("Zurück", "back");
			addRenderableWidget(new ActionButton(headerRight() - bw, headerButtonY(), bw, 20, "Zurück", false, () -> {
				detail = Detail.NONE;
				rebuildWidgets();
			}).withIcon("back").withVariant(ActionButton.Variant.GHOST));
		} else {
			int aw = ActionButton.widthFor(ADDRESS_LABEL, "connect");
			addRenderableWidget(new ActionButton(headerRight() - aw, headerButtonY(), aw, 20, ADDRESS_LABEL, true, () -> openDetail(Detail.ADDRESS, null))
					.withIcon("connect"));
			addRenderableWidget(ActionButton.icon(headerRight() - aw - 24, headerButtonY(), 20, "refresh", "Aktualisieren", this::reload)
					.withVariant(ActionButton.Variant.SECONDARY));
		}
		switch (detail) {
			case NONE -> {
				if (tab == Tab.FRIENDS) buildFriends();
				else buildMine();
			}
			case ADDRESS -> buildAddress();
			case MEMBERS -> buildMembers();
			case BACKUPS -> buildBackups();
		}
		if (message != null && System.currentTimeMillis() - messageAt < 8000) {
			labels.add(new Label(contentX, contentY + contentH - 10, contentW, message, messageError ? Ui.DANGER : Ui.SUCCESS, Ui.Font.SMALL));
		}
	}

	/** Welten von Freunden: geöffnete (laut Dienst) und Einladungen der letzten 30 Minuten */
	private List<Entry> friendEntries() {
		List<Entry> list = new ArrayList<>();
		List<String> seen = new ArrayList<>();
		// geöffnete Welten laut Echtzeit (world-open/-closed); jedes Laden der Liste gleicht sie mit dem Dienst ab
		List<WorldService.FriendWorld> open = new ArrayList<>(WorldInvites.open());
		open.sort((a, b) -> a.hostName().compareToIgnoreCase(b.hostName()));
		for (WorldService.FriendWorld world : open) {
			String version = world.version() == null ? "" : "  ·  " + world.version();
			list.add(new Entry(world.name(), world.address(), world.hostUuid(), world.hostName(),
					"von " + world.hostName() + "  ·  " + world.players() + "/" + world.maxPlayers() + " Spieler" + version));
			seen.add(world.id());
		}
		for (WorldInvites.Invite invite : WorldInvites.recent()) {
			if (seen.contains(invite.worldId())) continue;
			list.add(new Entry(invite.name(), invite.address(), invite.hostUuid(), invite.hostName(), invite.hostName() + " hat dich eingeladen"));
		}
		return list;
	}

	private void buildFriends() {
		List<Entry> entries = friendEntries();
		if (entries.isEmpty()) {
			empty(loadError != null ? loadError : loading && listing == null ? "Lädt …" : "Gerade hat keiner deiner Freunde eine Welt geöffnet.",
					"Eigene Welt öffnen: im Pausemenü einer Einzelspielerwelt auf „Welt teilen“. Eine Adresse bekommen? Oben „" + ADDRESS_LABEL + "“.");
			return;
		}
		int y = listStart(entries.size());
		for (int i = 0; i < rowsShown; i++) {
			Entry entry = entries.get(scroll + i);
			int jw = ActionButton.widthFor(JOIN_LABEL, "play");
			cards.add(new int[] {contentX, y, contentW, ROW - 4});
			addRenderableWidget(new ActionButton(contentX + contentW - jw - 8, y + 9, jw, 20, JOIN_LABEL, true, () -> join(entry.name(), entry.address()))
					.withIcon("play"));
			int textW = contentW - jw - 70;
			labels.add(new Label(contentX + 40, y + 8, textW, entry.name(), Ui.TEXT, Ui.Font.LABEL));
			labels.add(new Label(contentX + 40, y + 21, textW, entry.detail(), Ui.MUTED, Ui.Font.SMALL));
			faces.add(new Object[] {entry.hostUuid(), entry.host(), contentX + 10, y + 9});
			y += ROW;
		}
	}

	/** Köpfe der Gastgeber: {uuid, name, x, y} */
	private final List<Object[]> faces = new ArrayList<>();

	private void buildMine() {
		List<WorldService.World> mine = listing == null ? List.of() : listing.mine();
		if (mine.isEmpty()) {
			empty(loadError != null ? loadError : loading && listing == null ? "Lädt …" : "Du hast noch keine Welt geteilt.",
					"Öffne eine Einzelspielerwelt und wähle im Pausemenü „Welt teilen“ – sie behält danach ihre Adresse.");
			return;
		}
		int y = listStart(mine.size());
		for (int i = 0; i < rowsShown; i++) {
			WorldService.World world = mine.get(scroll + i);
			cards.add(new int[] {contentX, y, contentW, ROW - 4});
			int bx = contentX + contentW - 8 - 20;
			addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "trash", "Welt beim Dienst löschen", () -> confirmDelete(world)));
			bx -= 24;
			addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "clock", "Sicherungen", () -> openDetail(Detail.BACKUPS, world))
					.withVariant(ActionButton.Variant.SECONDARY));
			bx -= 24;
			addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "friends", "Mitglieder", () -> openDetail(Detail.MEMBERS, world))
					.withVariant(ActionButton.Variant.SECONDARY));
			bx -= 24;
			addRenderableWidget(ActionButton.icon(bx, y + 9, 20, "copy", "Adresse kopieren", () -> {
				minecraft.keyboardHandler.setClipboard(WorldShare.normalizeAddress(world.address()));
				note("Adresse kopiert", false);
				rebuildWidgets();
			}).withVariant(ActionButton.Variant.SECONDARY));
			int textW = bx - 8 - (contentX + 40);
			labels.add(new Label(contentX + 40, y + 8, textW, world.name() + (world.online() ? "  ·  geöffnet" : ""), Ui.TEXT, Ui.Font.LABEL));
			labels.add(new Label(contentX + 40, y + 21, textW, WorldShare.normalizeAddress(world.address()) + "  ·  " + world.access().label + "  ·  bis "
					+ world.maxPlayers() + " Spieler", Ui.MUTED, Ui.Font.SMALL));
			icons.add(new Object[] {world.online() ? "lan" : "world", contentX + 10, y + 9, world.online()});
			y += ROW;
		}
	}

	/** Symbole der eigenen Welten: {Icon, x, y, geöffnet} */
	private final List<Object[]> icons = new ArrayList<>();

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

	private static boolean locked(Path world) {
		try {
			return DirectoryLock.isLocked(world);
		} catch (Exception e) {
			return true;
		}
	}

	/** erste Zeile der Liste; legt fest, wie viele Zeilen passen */
	private int listStart(int total) {
		int y = contentY;
		int room = Math.max(1, (contentY + contentH - 14 - y) / ROW);
		rowsTotal = total;
		scroll = Math.clamp(scroll, 0, Math.max(0, total - room));
		rowsShown = Math.min(room, total - scroll);
		return y;
	}

	private void empty(String title, String hint) {
		int cy = contentY + contentH / 2 - 30;
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

	private void paragraph(int y, String text, int color) {
		for (FormattedCharSequence line : Ui.wrap(text, contentW, Ui.Font.SMALL)) {
			wrapped.add(new Object[] {line, contentX, y, color});
			y += 10;
		}
	}

	private void note(String text, boolean error) {
		message = text;
		messageError = error;
		messageAt = System.currentTimeMillis();
	}

	// ======================================================================================
	// Aktionen
	// ======================================================================================

	private void join(String name, String address) {
		ConnectScreen.startConnecting(this, minecraft, ServerAddress.parseString(address), new ServerData(name, address, ServerData.Type.OTHER), false, null);
	}

	private void joinTyped() {
		String address = fieldValue.strip().toLowerCase(Locale.ROOT);
		if (address.isEmpty() || !ServerAddress.isValidAddress(address)) {
			note("Das ist keine gültige Adresse", true);
			rebuildWidgets();
			return;
		}
		join(WorldShare.isWorldAddress(address) ? "Heldix-Welt" : address, address);
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

	private void confirmDelete(WorldService.World world) {
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
				Component.literal("Die Adresse " + WorldShare.normalizeAddress(world.address()) + " und die Mitgliederliste sind danach weg. Die Welt selbst und "
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
		for (int[] card : cards) {
			boolean hover = Ui.inside(mouseX, mouseY, card[0], card[1], card[2], card[3]);
			Ui.rect(g, card[0], card[1], card[2], card[3], 9, hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
			Ui.outline(g, card[0], card[1], card[2], card[3], 9, Ui.LINE);
		}
		for (Object[] face : faces) {
			UUID uuid = (UUID) face[0];
			int x = (int) face[2];
			int y = (int) face[3];
			if (uuid != null) FriendWidget.face(g, uuid, (String) face[1], x, y, 20, 1f);
			else {
				Ui.rect(g, x, y, 20, 20, 6, Ui.ACCENT_SOFT);
				Ui.icon(g, "lan", x + 5, y + 5, 10, Ui.ACCENT_TEXT);
			}
		}
		for (Object[] icon : icons) {
			int x = (int) icon[1];
			int y = (int) icon[2];
			boolean online = (boolean) icon[3];
			Ui.rect(g, x, y, 20, 20, 6, online ? 0x3334D399 : Ui.ACCENT_SOFT);
			Ui.icon(g, (String) icon[0], x + 5, y + 5, 10, online ? Ui.SUCCESS : Ui.ACCENT_TEXT);
		}
		if (emptyIconY >= 0) {
			int cx = contentX + contentW / 2;
			Ui.rect(g, cx - 16, emptyIconY, 32, 32, 10, Ui.ACCENT_SOFT);
			Ui.icon(g, "lan", cx - 8, emptyIconY + 8, 16, Ui.ACCENT_TEXT);
		}
		for (Label label : labels) {
			Ui.text(g, Ui.ellipsize(label.text(), Math.max(10, label.w()), label.font()), label.x(), label.y(), label.color(), label.font());
		}
		for (Object[] line : wrapped) g.text(font, (FormattedCharSequence) line[0], (int) line[1], (int) line[2], (int) line[3], false);
		if (rowsTotal > rowsShown && rowsShown > 0) {
			Ui.textRight(g, (scroll + 1) + "–" + (scroll + rowsShown) + " von " + rowsTotal + " · Mausrad blättert", contentX + contentW, contentY + contentH - 10,
					Ui.FAINT, Ui.Font.SMALL);
		}
	}

	@Override
	public void tick() {
		super.tick();
		// alle 30 Sekunden neu laden (geöffnete Welten kommen und gehen), bei Echtzeit-Meldungen sofort neu aufbauen
		if (detail == Detail.NONE && System.currentTimeMillis() - loadedAt > 30_000) reload();
		if (seenChanges != WorldInvites.changes()) {
			seenChanges = WorldInvites.changes();
			if (detail == Detail.NONE) rebuildWidgets();
		}
		if (message != null && System.currentTimeMillis() - messageAt > 8000) {
			message = null;
			rebuildWidgets();
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
		if (event.key() == InputConstants.KEY_ESCAPE && detail != Detail.NONE) {
			detail = Detail.NONE;
			rebuildWidgets();
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

	public void showBackups(String worldId) {
		if (listing == null) return;
		listing.mine().stream().filter(w -> w.id().equals(worldId)).findFirst().ifPresent(w -> openDetail(Detail.BACKUPS, w));
	}
}
