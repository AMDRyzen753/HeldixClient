package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.ui.Shell;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.DirectJoinServerScreen;
import net.minecraft.client.gui.screens.FaviconTexture;
import net.minecraft.client.gui.screens.ManageServerScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.client.multiplayer.ServerStatusPinger;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.network.EventLoopGroupHolder;
import net.minecraft.util.FormattedCharSequence;

import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Mehrspieler: Server als Karten mit Ping, Spielerzahl und Icon; Beitreten per Doppelklick. */
public class ServersScreen extends ShellScreen {
	private static final int ROW_H = 46;
	private static final int GAP = 6;
	/** Server gleichzeitig anpingen (wie Minecraft: eigener kleiner Thread-Pool) */
	private static final ExecutorService PING_POOL = Executors.newFixedThreadPool(5, runnable -> {
		Thread thread = new Thread(runnable, "Heldix Server-Ping");
		thread.setDaemon(true);
		return thread;
	});

	private final ServerStatusPinger pinger = new ServerStatusPinger();
	private ServerList servers;
	private final Map<ServerData, FaviconTexture> icons = new HashMap<>();
	private final Map<ServerData, byte[]> iconBytes = new HashMap<>();
	private ServerData selected;
	private double scroll;
	private long lastClickAt;
	private ServerData lastClick;

	public ServersScreen() {
		super(Component.literal("Mehrspieler"), Shell.Page.SERVERS);
	}

	public int serverCount() {
		return servers == null ? 0 : servers.size();
	}

	// ---------- Aufbau ----------

	@Override
	protected int toolbarActionsWidth() {
		return (contentW >= 340 ? ActionButton.widthFor("Server hinzufügen", "plus") : 20) + 48;
	}

	@Override
	protected void initContent() {
		if (servers == null) {
			servers = new ServerList(minecraft);
			servers.load();
			if (servers.size() > 0) selected = servers.get(0);
		}
		String add = "Server hinzufügen";
		// schmale Fenster: alle drei Knöpfe nur als Icons, damit der Titel Platz hat
		boolean roomy = contentW >= 340;
		int aw = roomy ? ActionButton.widthFor(add, "plus") : 20;
		int x = headerRight() - aw;
		addRenderableWidget(roomy ? new ActionButton(x, headerButtonY(), aw, 20, add, true, this::addServer).withIcon("plus")
				: ActionButton.icon(x, headerButtonY(), 20, "plus", add, this::addServer).withVariant(ActionButton.Variant.PRIMARY));
		x -= 24;
		addRenderableWidget(ActionButton.icon(x, headerButtonY(), 20, "connect", "Direkt verbinden", this::directJoin)
				.withVariant(ActionButton.Variant.SECONDARY));
		x -= 24;
		addRenderableWidget(ActionButton.icon(x, headerButtonY(), 20, "refresh", "Aktualisieren", this::refresh)
				.withVariant(ActionButton.Variant.SECONDARY));

		String classic = "LAN & klassische Ansicht";
		int cw = ActionButton.widthFor(classic, "lan");
		addRenderableWidget(new ActionButton(contentX + contentW - cw, contentY + contentH - 18, cw, 18, classic, false,
				() -> Shell.openVanilla(minecraft, new JoinMultiplayerScreen(this))).withIcon("lan").withVariant(ActionButton.Variant.GHOST));
	}

	@Override
	protected String subtitle() {
		if (servers == null) return null;
		long online = 0;
		long players = 0;
		for (int i = 0; i < servers.size(); i++) {
			ServerData server = servers.get(i);
			if (server.state() != ServerData.State.SUCCESSFUL) continue;
			online++;
			if (server.players != null) players += server.players.online();
		}
		String text = servers.size() + " Server  ·  " + online + " erreichbar";
		return players > 0 ? text + "  ·  " + String.format(java.util.Locale.GERMANY, "%,d", players) + " Spieler online" : text;
	}

	private int listY() {
		return contentY;
	}

	private int listH() {
		return contentY + contentH - 24 - listY();
	}

	private int maxScroll() {
		return Math.max(0, serverCount() * (ROW_H + GAP) - GAP - listH());
	}

	/** Knöpfe in der ausgewählten Zeile unten rechts: Löschen, Bearbeiten (nur Icon), Beitreten */
	private int[][] rowButtons(int rowY) {
		int y = rowY + ROW_H - 24;
		int right = contentX + contentW - 10;
		int joinW = ActionButton.widthFor("Beitreten", "play");
		int[] join = {right - joinW, y, joinW, 18};
		int[] edit = {join[0] - 22, y, 18, 18};
		int[] delete = {edit[0] - 22, y, 18, 18};
		return new int[][] {delete, edit, join};
	}

	// ---------- Ping ----------

	private void ping(ServerData server) {
		if (server.state() != ServerData.State.INITIAL) return;
		server.setState(ServerData.State.PINGING);
		server.motd = CommonComponents.EMPTY;
		server.status = CommonComponents.EMPTY;
		PING_POOL.submit(() -> {
			try {
				pinger.pingServer(server, () -> minecraft.execute(() -> {}), () -> server.setState(
						server.protocol == SharedConstants.getProtocolVersion() ? ServerData.State.SUCCESSFUL : ServerData.State.INCOMPATIBLE),
						EventLoopGroupHolder.remote(minecraft.options.useNativeTransport()));
			} catch (UnknownHostException e) {
				server.setState(ServerData.State.UNREACHABLE);
				server.motd = Component.literal("Adresse nicht gefunden");
			} catch (Exception e) {
				server.setState(ServerData.State.UNREACHABLE);
				server.motd = Component.literal("Keine Verbindung");
			}
		});
	}

	private void refresh() {
		minecraft.gui.setScreen(new ServersScreen());
	}

	@Override
	public void tick() {
		super.tick();
		pinger.tick();
	}

	private FaviconTexture icon(ServerData server) {
		byte[] bytes = server.getIconBytes();
		if (bytes == null) return null;
		if (!Arrays.equals(bytes, iconBytes.get(server))) {
			FaviconTexture texture = icons.computeIfAbsent(server, s -> FaviconTexture.forServer(minecraft.getTextureManager(), s.ip));
			try {
				texture.upload(NativeImage.read(bytes));
			} catch (Exception e) {
				texture.clear();
			}
			iconBytes.put(server, bytes);
		}
		return icons.get(server);
	}

	// ---------- Zeichnen ----------

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		int x = contentX;
		int w = contentW;
		if (serverCount() == 0) {
			int cy = listY() + listH() / 2 - 26;
			Ui.rect(g, x + w / 2f - 16, cy, 32, 32, 10, Ui.ACCENT_SOFT);
			Ui.icon(g, "server", x + w / 2f - 8, cy + 8, 16, Ui.ACCENT_TEXT);
			Ui.textCentered(g, "Noch keine Server", x + w / 2, cy + 42, Ui.TEXT, Ui.Font.LABEL);
			Ui.textCentered(g, "Füge mit „Server hinzufügen“ oben rechts deinen ersten Server hinzu.", x + w / 2, cy + 55, Ui.MUTED, Ui.Font.SMALL);
		}
		scroll = Math.clamp(scroll, 0, maxScroll());
		g.enableScissor(x - 2, listY(), x + w + 2, listY() + listH());
		boolean inList = Ui.inside(mouseX, mouseY, x, listY(), w, listH());
		for (int i = 0; i < serverCount(); i++) {
			int y = listY() + i * (ROW_H + GAP) - (int) scroll;
			ServerData server = servers.get(i);
			ping(server);
			if (y + ROW_H < listY() || y > listY() + listH()) continue;
			drawRow(g, server, x, y, w, inList ? mouseX : -1000, inList ? mouseY : -1000);
		}
		g.disableScissor();
		Ui.scrollbar(g, x + w + 3, listY(), listH(), scroll, maxScroll());
		Ui.text(g, Ui.ellipsize("Doppelklick tritt bei · Entf löscht · Pfeiltasten wählen", w - 150, Ui.Font.SMALL), x + 2, contentY + contentH - 12,
				Ui.FAINT, Ui.Font.SMALL);
	}

	private void drawRow(GuiGraphicsExtractor g, ServerData server, int x, int y, int w, int mouseX, int mouseY) {
		boolean isSelected = server == selected;
		boolean hover = Ui.inside(mouseX, mouseY, x, y, w, ROW_H);
		Ui.rect(g, x, y, w, ROW_H, 9, isSelected ? 0x1F3B82F6 : hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
		Ui.outline(g, x, y, w, ROW_H, 9, isSelected ? Ui.ACCENT_LINE : Ui.LINE);

		int iconX = x + 7;
		int iconY = y + 7;
		int size = 32;
		FaviconTexture icon = icon(server);
		if (icon != null) {
			g.blit(RenderPipelines.GUI_TEXTURED, icon.textureLocation(), iconX, iconY, 0, 0, size, size, 64, 64, 64, 64);
		} else {
			Ui.rect(g, iconX, iconY, size, size, 8, 0x1AFFFFFF);
			Ui.icon(g, "server", iconX + 9, iconY + 9, 14, Ui.MUTED);
		}

		// rechts oben: Spieler, Ping, Empfang
		String right = statusText(server);
		int rightW = Ui.width(right, Ui.Font.SMALL);
		int signalX = x + w - 10 - 15;
		drawSignal(g, server, signalX, y + 8);
		Ui.text(g, right, signalX - 6 - rightW, y + 9, statusColor(server), Ui.Font.SMALL);
		// Spielerliste (soweit der Server sie schickt) als Hinweis über der Spielerzahl
		if (Ui.inside(mouseX, mouseY, signalX - 6 - rightW, y + 4, rightW + 26, 16)) {
			String tooltip = playersTooltip(server);
			if (tooltip != null) Ui.requestTooltip(tooltip, mouseX, mouseY);
		}

		int textX = iconX + size + 10;
		int nameW = signalX - 12 - rightW - textX;
		Ui.text(g, Ui.ellipsize(displayName(server), nameW, Ui.Font.LABEL), textX, y + 8, Ui.TEXT, Ui.Font.LABEL);
		int motdRight = isSelected ? rowButtons(y)[0][0] - 8 : x + w - 10;
		Component motd = server.motd == null ? Component.empty() : Ui.styled(server.motd, Ui.Font.SMALL);
		List<FormattedCharSequence> lines = font.split(motd, Math.max(10, motdRight - textX));
		if (!lines.isEmpty()) g.text(font, lines.getFirst(), textX, y + 21, Ui.MUTED, false);
		if (lines.size() > 1 && !isSelected) g.text(font, lines.get(1), textX, y + 31, Ui.MUTED, false);
		if (isSelected) Ui.text(g, Ui.ellipsize(server.ip, motdRight - textX, Ui.Font.SMALL), textX, y + 32, Ui.FAINT, Ui.Font.SMALL);

		if (isSelected) {
			int[][] buttons = rowButtons(y);
			String[] icons = {"trash", "edit"};
			String[] tips = {"Löschen", "Bearbeiten"};
			for (int i = 0; i < 2; i++) {
				int[] b = buttons[i];
				boolean over = Ui.inside(mouseX, mouseY, b[0], b[1], b[2], b[3]);
				Ui.rect(g, b[0], b[1], b[2], b[3], 6, over ? (i == 0 ? 0x40F87171 : Ui.SURFACE_STRONG) : 0x12FFFFFF);
				Ui.icon(g, icons[i], b[0] + 4, b[1] + 4, 10, over && i == 0 ? 0xFFFCA5A5 : over ? Ui.TEXT : Ui.MUTED);
				if (over) Ui.requestTooltip(tips[i], mouseX, mouseY);
			}
			int[] b = buttons[2];
			boolean over = Ui.inside(mouseX, mouseY, b[0], b[1], b[2], b[3]);
			Ui.rect(g, b[0], b[1], b[2], b[3], 6, over ? Ui.ACCENT_HOVER : Ui.ACCENT);
			Ui.icon(g, "play", b[0] + 8, b[1] + 4, 10, 0xFFFFFFFF);
			Ui.text(g, "Beitreten", b[0] + 23, b[1] + 5, 0xFFFFFFFF, Ui.Font.LABEL);
		}
	}

	private static String statusText(ServerData server) {
		return switch (server.state()) {
			case INITIAL, PINGING -> "pingt …";
			case UNREACHABLE -> "nicht erreichbar";
			case INCOMPATIBLE -> server.version != null ? server.version.getString() : "andere Version";
			case SUCCESSFUL -> {
				String players = server.players != null ? server.players.online() + "/" + server.players.max() : "?";
				yield players + "  ·  " + server.ping + " ms";
			}
		};
	}

	private static int statusColor(ServerData server) {
		return switch (server.state()) {
			case UNREACHABLE -> 0xFFFCA5A5;
			case INCOMPATIBLE -> 0xFFFDE68A;
			case SUCCESSFUL -> Ui.MUTED;
			default -> Ui.FAINT;
		};
	}

	/** Empfangsbalken in Heldix-Farben */
	private static void drawSignal(GuiGraphicsExtractor g, ServerData server, int x, int y) {
		int bars = 0;
		int color = Ui.SUCCESS;
		if (server.state() == ServerData.State.SUCCESSFUL) {
			long ping = server.ping;
			bars = ping < 0 ? 0 : ping < 150 ? 4 : ping < 300 ? 3 : ping < 600 ? 2 : 1;
			if (bars <= 1) color = Ui.DANGER;
			else if (bars == 2) color = Ui.WARNING;
		}
		for (int i = 0; i < 4; i++) {
			float h = 3 + i * 2.5f;
			Ui.rect(g, x + i * 4, y + 10 - h, 2.5f, h, 1.2f, i < bars ? color : 0x33FFFFFF);
		}
	}

	// ---------- Aktionen ----------

	public void join(ServerData server) {
		if (server == null) return;
		ConnectScreen.startConnecting(this, minecraft, ServerAddress.parseString(server.ip), server, false, null);
	}

	private void addServer() {
		ServerData data = new ServerData(I18n.get("selectServer.defaultName"), "", ServerData.Type.OTHER);
		minecraft.gui.setScreen(new ManageServerScreen(this, Component.translatable("manageServer.add.title"), confirmed -> {
			if (confirmed) {
				ServerData hidden = servers.unhide(data.ip);
				if (hidden != null) hidden.copyNameIconFrom(data);
				else servers.add(data, false);
				servers.save();
			}
			minecraft.gui.setScreen(new ServersScreen());
		}, data));
	}

	private void edit(ServerData server) {
		ServerData editing = new ServerData(server.name, server.ip, ServerData.Type.OTHER);
		editing.copyFrom(server);
		minecraft.gui.setScreen(new ManageServerScreen(this, Component.translatable("manageServer.edit.title"), confirmed -> {
			if (confirmed) {
				server.name = editing.name;
				server.ip = editing.ip;
				server.copyFrom(editing);
				servers.save();
			}
			minecraft.gui.setScreen(new ServersScreen());
		}, editing));
	}

	private void delete(ServerData server) {
		minecraft.gui.setScreen(new ConfirmScreen(confirmed -> {
			if (confirmed) {
				servers.remove(server);
				servers.save();
			}
			minecraft.gui.setScreen(new ServersScreen());
		}, Component.translatable("selectServer.deleteQuestion"), Component.translatable("selectServer.deleteWarning", server.name),
				Component.translatable("selectServer.deleteButton"), CommonComponents.GUI_CANCEL));
	}

	private void directJoin() {
		ServerData data = new ServerData(I18n.get("selectServer.defaultName"), "", ServerData.Type.OTHER);
		minecraft.gui.setScreen(new DirectJoinServerScreen(this, confirmed -> {
			if (!confirmed) {
				minecraft.gui.setScreen(new ServersScreen());
				return;
			}
			ServerData existing = servers.unhide(data.ip);
			if (existing != null) {
				existing.copyNameIconFrom(data);
				servers.save();
				join(existing);
			} else {
				servers.add(data, true);
				servers.save();
				join(data);
			}
		}, data));
	}

	// ---------- Eingaben ----------

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		if (event.button() != InputConstants.MOUSE_BUTTON_LEFT) return false;
		double mx = event.x();
		double my = event.y();
		if (!Ui.inside(mx, my, contentX, listY(), contentW, listH())) return false;
		for (int i = 0; i < serverCount(); i++) {
			int y = listY() + i * (ROW_H + GAP) - (int) scroll;
			if (!Ui.inside(mx, my, contentX, y, contentW, ROW_H)) continue;
			ServerData server = servers.get(i);
			if (server == selected) {
				int[][] buttons = rowButtons(y);
				if (Ui.inside(mx, my, buttons[2][0], buttons[2][1], buttons[2][2], buttons[2][3])) {
					join(server);
					return true;
				}
				if (Ui.inside(mx, my, buttons[1][0], buttons[1][1], buttons[1][2], buttons[1][3])) {
					edit(server);
					return true;
				}
				if (Ui.inside(mx, my, buttons[0][0], buttons[0][1], buttons[0][2], buttons[0][3])) {
					delete(server);
					return true;
				}
			}
			long now = System.currentTimeMillis();
			boolean twice = server == lastClick && now - lastClickAt < 350;
			selected = server;
			lastClick = server;
			lastClickAt = now;
			if (twice) join(server);
			return true;
		}
		return false;
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (maxScroll() > 0 && Ui.inside(mouseX, mouseY, contentX, listY(), contentW, listH())) {
			scroll = Math.clamp(scroll - scrollY * 20, 0, maxScroll());
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (serverCount() > 0 && !widgetKeyFocus()) {
			int index = 0;
			for (int i = 0; i < serverCount(); i++) if (servers.get(i) == selected) index = i;
			switch (event.key()) {
				case InputConstants.KEY_RETURN -> {
					join(selected);
					return true;
				}
				case InputConstants.KEY_DELETE -> {
					if (selected != null) delete(selected);
					return true;
				}
				case InputConstants.KEY_DOWN, InputConstants.KEY_UP -> {
					int next = Math.clamp(index + (event.key() == InputConstants.KEY_DOWN ? 1 : -1), 0, serverCount() - 1);
					selected = servers.get(next);
					int top = next * (ROW_H + GAP);
					if (top < scroll) scroll = top;
					if (top + ROW_H > scroll + listH()) scroll = top + ROW_H - listH();
					return true;
				}
				default -> {
				}
			}
		}
		return super.keyPressed(event);
	}

	@Override
	public void removed() {
		pinger.removeAll();
		for (FaviconTexture icon : icons.values()) icon.close();
		icons.clear();
		super.removed();
	}

	/** Anzeigename: Server mit Minecrafts Standardnamen („Minecraft Server“) zeigen ihre Adresse. */
	public static String displayName(ServerData server) {
		String name = server.name == null ? "" : server.name.trim();
		String fallback = Component.translatable("selectServer.defaultName").getString();
		if (name.isEmpty() || name.equalsIgnoreCase(fallback) || name.matches("(?i)minecraft[ -]?server")) return shortAddress(server.ip);
		return name;
	}

	/** Adresse ohne den Standard-Port */
	public static String shortAddress(String ip) {
		return ip == null ? "" : ip.trim().replaceFirst(":25565$", "");
	}

	/** „Spieler: a, b, c …“ aus der Liste, die der Server beim Ping mitschickt (null = keine) */
	private static String playersTooltip(ServerData server) {
		if (server.state() != ServerData.State.SUCCESSFUL || server.playerList == null || server.playerList.isEmpty()) return null;
		List<String> names = server.playerList.stream().map(Component::getString).filter(s -> !s.isBlank()).limit(8).toList();
		if (names.isEmpty()) return null;
		String text = String.join(", ", names);
		return server.playerList.size() > names.size() || (server.players != null && server.players.online() > names.size()) ? text + " …" : text;
	}

	/** Zuletzt besuchter Server (für die Startseite), sonst der erste der Liste. */
	public static ServerData lastServer(net.minecraft.client.Minecraft minecraft) {
		ServerList list = new ServerList(minecraft);
		list.load();
		String ip = dev.heldixclient.config.HeldixConfig.get().lastServerIp;
		if (ip != null) {
			for (int i = 0; i < list.size(); i++) if (list.get(i).ip.equalsIgnoreCase(ip)) return list.get(i);
			String name = dev.heldixclient.config.HeldixConfig.get().lastServerName;
			return new ServerData(name == null ? ip : name, ip, ServerData.Type.OTHER);
		}
		return list.size() > 0 ? list.get(0) : null;
	}

}
