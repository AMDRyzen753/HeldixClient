package dev.heldixclient.share;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.share.WorldService.Access;
import dev.heldixclient.share.WorldService.Member;
import dev.heldixclient.share.WorldService.Role;
import dev.heldixclient.social.Social;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.server.players.NameAndId;
import net.minecraft.server.players.PlayerList;
import net.minecraft.util.HttpUtil;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.storage.LevelResource;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * „Welt teilen“ (ab Heldix-Dienst 1.12.0): eine Einzelspielerwelt über den Heldix-Dienst für Freunde öffnen – ohne
 * Portfreigabe. Ablauf beim Start: Welt speichern, Sicherung (ZIP, {@link WorldBackups}), Welt beim Dienst anlegen bzw.
 * die ID aus {@code heldix-welt.json} nutzen, intern als LAN öffnen (freier lokaler Port), Tunnel zum Dienst
 * ({@link WorldTunnel}). Danach entscheidet der Gastgeber mit der echten UUID (Online-Modus des eingebauten Servers),
 * wer hinein darf (Mitglied / Freund / offen), und wendet die Rolle an: Besucher = Abenteuer, Mitspieler = Spielmodus der
 * Welt, Operator = Spielmodus der Welt und Befehle; der Gastgeber hat immer Befehle. Wer nicht darf, klopft an:
 * Einblendung „… möchte beitreten“ mit Erlauben/Ablehnen ({@link KnockPrompt}, Tasten oder Klick im Pausemenü).
 *
 * <p>Zustand und Aufrufe aus der Oberfläche im Haupt-Thread; die Prüfungen ({@link #loginDenied}, {@link #permissions},
 * {@link #playerJoined}, {@link #maxPlayers}) kommen vom Server-Thread über die Eingriffe in WorldSharePatches und lesen
 * nur unveränderliche Stände.
 */
public final class WorldShare {
	public enum State {
		OFF,
		/** Speichern, Sicherung, Adresse holen */
		STARTING,
		/** LAN offen, Steuerverbindung wird aufgebaut */
		CONNECTING,
		ONLINE,
		/** Steuerverbindung weg, neuer Versuch läuft (Spieler bleiben, solange ihr Datenstrom hält) */
		RECONNECTING
	}

	/** Einstellungen der geteilten Welt; Spielmodus und Cheats gehören zur Welt selbst */
	public record Settings(Access access, Role defaultRole, int maxPlayers, GameType gameMode, boolean cheats) {
		public Settings {
			maxPlayers = Math.clamp(maxPlayers, 1, 20);
		}

		public Settings withAccess(Access value) {
			return new Settings(value, defaultRole, maxPlayers, gameMode, cheats);
		}

		public Settings withDefaultRole(Role value) {
			return new Settings(access, value, maxPlayers, gameMode, cheats);
		}

		public Settings withMaxPlayers(int value) {
			return new Settings(access, defaultRole, value, gameMode, cheats);
		}

		public Settings withGameMode(GameType value) {
			return new Settings(access, defaultRole, maxPlayers, value, cheats);
		}

		public Settings withCheats(boolean value) {
			return new Settings(access, defaultRole, maxPlayers, gameMode, value);
		}
	}

	/** Anklopfen; local = vom eigenen Server (nicht vom Dienst), z. B. direkt über das Heimnetz */
	public record Knock(String name, long at, boolean local) {
	}

	/** Spieler in der geteilten Welt (aus der Tab-Liste) */
	public record Player(UUID uuid, String name, Role role, boolean host) {
	}

	/** Adresse einer Heldix-Welt: {@code <code>.welt.<Domain>} (optional mit Port) */
	private static final Pattern WORLD_ADDRESS = Pattern.compile("(?i)^[a-hjkmnp-z2-9]{6}\\.welt\\.[a-z0-9.-]+(:\\d{1,5})?$");
	/** so lange wartet ein Anklopfen auf Antwort */
	private static final long KNOCK_MS = 120_000;
	private static final int MAX_KNOCKS = 8;

	private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Welt-Sicherung");
		thread.setDaemon(true);
		return thread;
	});

	/** Eine laufende Freigabe (eine je Spiel) */
	private static final class Session {
		final IntegratedServer server;
		final Path world;
		final String hostName;
		volatile Settings settings;
		volatile String worldId;
		volatile String address;
		volatile int lanPort;
		volatile boolean publishedByUs;
		volatile WorldTunnel tunnel;
		volatile Path backup;

		Session(IntegratedServer server, Path world, String hostName, Settings settings) {
			this.server = server;
			this.world = world;
			this.hostName = hostName;
			this.settings = settings;
		}
	}

	private static volatile Session session;
	private static volatile State state = State.OFF;
	private static volatile String step;
	private static volatile String error;
	private static volatile String notice;
	private static volatile List<Member> members = List.of();
	private static final List<Knock> KNOCKS = new CopyOnWriteArrayList<>();
	/** zuletzt beim Dienst durchgereichte Logins (Name klein → Zeit): Mitglieder dann frisch holen */
	private static final Map<String, Long> LOGINS = new java.util.concurrent.ConcurrentHashMap<>();
	private static int lastPlayers = -1;
	private static int tickCounter;
	/** letzte Sicherung (auch nach dem Beenden, für Anzeige und Autotest) */
	private static volatile Path lastBackup;

	private WorldShare() {
	}

	// ======================================================================================
	// Zustand für die Oberfläche
	// ======================================================================================

	public static State state() {
		return state;
	}

	/** wird gerade geteilt (auch während Start und neuem Versuch)? */
	public static boolean active() {
		return session != null;
	}

	/** Teilen ist offen und der Dienst hat die Adresse bestätigt (bzw. versucht gerade neu zu verbinden) */
	public static boolean online() {
		return session != null && (state == State.ONLINE || state == State.RECONNECTING);
	}

	/** Fortschritt beim Start (deutsch), sonst null */
	public static String step() {
		return state == State.STARTING || state == State.CONNECTING ? step : null;
	}

	/** letzter Fehler (deutsch) oder null; bleibt nach dem Beenden für den Dialog stehen */
	public static String error() {
		return error;
	}

	public static void clearError() {
		error = null;
	}

	/** Hinweis zur Verbindung (z. B. „neuer Versuch“), sonst null */
	public static String notice() {
		return state == State.RECONNECTING ? notice : null;
	}

	public static String address() {
		Session s = session;
		return s == null ? null : s.address;
	}

	public static String worldId() {
		Session s = session;
		return s == null ? null : s.worldId;
	}

	public static Settings settings() {
		Session s = session;
		return s == null ? null : s.settings;
	}

	public static int lanPort() {
		Session s = session;
		return s == null ? -1 : s.lanPort;
	}

	public static boolean tunnelReady() {
		Session s = session;
		return s != null && s.tunnel != null && s.tunnel.ready();
	}

	public static Path lastBackup() {
		return lastBackup;
	}

	public static List<Member> members() {
		return members;
	}

	/** wartende Anfragen, älteste zuerst */
	public static List<Knock> knocks() {
		long now = System.currentTimeMillis();
		return KNOCKS.stream().filter(k -> now - k.at() < KNOCK_MS).toList();
	}

	/** die Anfrage, um die es gerade geht (älteste), sonst null */
	public static Knock currentKnock() {
		List<Knock> list = knocks();
		return list.isEmpty() ? null : list.getFirst();
	}

	/** Spieler in der geteilten Welt mit Rolle (Haupt-Thread, aus der Tab-Liste), Gastgeber zuerst */
	public static List<Player> players(Minecraft mc) {
		Session s = session;
		if (s == null || mc.getConnection() == null) return List.of();
		UUID own = mc.getUser().getProfileId();
		List<Player> list = new ArrayList<>();
		for (PlayerInfo info : mc.getConnection().getOnlinePlayers()) {
			UUID id = info.getProfile().id();
			String name = info.getProfile().name();
			boolean host = id.equals(own);
			Role role = host ? Role.OPERATOR : roleOf(s, new NameAndId(id, name));
			list.add(new Player(id, name, role == null ? s.settings.defaultRole() : role, host));
		}
		list.sort((a, b) -> a.host() != b.host() ? (a.host() ? -1 : 1) : a.name().compareToIgnoreCase(b.name()));
		return list;
	}

	/** Ist das die Adresse einer Heldix-Welt ({@code <code>.welt.<Domain>})? */
	public static boolean isWorldAddress(String address) {
		return address != null && WORLD_ADDRESS.matcher(address.trim()).matches();
	}

	/** Adresse einer Heldix-Welt ohne den Standard-Port, klein geschrieben (für Voice-Räume und Anzeige) */
	public static String normalizeAddress(String address) {
		String clean = address.trim().toLowerCase(Locale.ROOT);
		return clean.endsWith(":25565") ? clean.substring(0, clean.length() - 6) : clean;
	}

	/** Raum-Server für den Voice Chat: die Weltadresse, solange geteilt (Gastgeber und Mitspieler im selben Raum) */
	public static String voiceServer() {
		Session s = session;
		return s != null && s.address != null && (state == State.ONLINE || state == State.RECONNECTING) ? normalizeAddress(s.address) : null;
	}

	/** Für die Statuszeile: {@code { address, host: true, players, max }} beim Gastgeber, sonst null */
	public static com.google.gson.JsonObject hostStatus() {
		Session s = session;
		if (s == null || s.address == null || !(state == State.ONLINE || state == State.RECONNECTING)) return null;
		com.google.gson.JsonObject world = new com.google.gson.JsonObject();
		world.addProperty("address", normalizeAddress(s.address));
		world.addProperty("host", true);
		world.addProperty("players", Math.max(1, s.server.getPlayerCount()));
		world.addProperty("max", s.settings.maxPlayers());
		return world;
	}

	/** Voreinstellungen für den Dialog: Zugang nur Eingeladene, Mitspieler, 8 Spieler, Spielmodus und Cheats der Welt */
	public static Settings defaults(Minecraft mc) {
		IntegratedServer server = mc.getSingleplayerServer();
		GameType mode = server == null ? GameType.SURVIVAL : server.getDefaultGameType();
		boolean cheats = server != null && server.getWorldData().isAllowCommands();
		return new Settings(Access.INVITED, Role.PLAYER, 8, mode, cheats);
	}

	/** Eingestellte Werte der Welt beim Dienst (wenn sie schon einmal geteilt war), sonst null */
	public static CompletableFuture<WorldService.World> existing(Minecraft mc) {
		IntegratedServer server = mc.getSingleplayerServer();
		if (server == null || !Social.online()) return CompletableFuture.completedFuture(null);
		String id = WorldBackups.readId(worldFolder(server));
		if (id == null) return CompletableFuture.completedFuture(null);
		return WorldService.list().handle((listing, failure) -> failure != null ? null
				: listing.mine().stream().filter(w -> w.id().equals(id)).findFirst().orElse(null));
	}

	/** Warum Teilen gerade nicht geht (deutsch), sonst null */
	public static String problem(Minecraft mc) {
		if (mc.getSingleplayerServer() == null || mc.level == null) return "Teilen geht nur in einer Einzelspielerwelt.";
		if (mc.isDemo()) return "In der Demo geht Teilen nicht.";
		if (Social.baseUrl().isEmpty()) return "Kein Heldix-Dienst eingetragen.";
		if (Social.state() == Social.State.OFFLINE_ACCOUNT) return "Teilen geht nur mit einem Microsoft-Konto.";
		if (!Social.online()) return "Nicht mit dem Heldix-Dienst verbunden.";
		return null;
	}

	private static Path worldFolder(IntegratedServer server) {
		return server.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize();
	}

	// ======================================================================================
	// Start und Ende (Haupt-Thread)
	// ======================================================================================

	/**
	 * „Teilen starten“: Speichern, Sicherung, Welt beim Dienst, LAN, Tunnel. {@code done} läuft im Haupt-Thread mit
	 * null (läuft, Adresse kommt) oder einer Fehlermeldung.
	 */
	public static void start(Minecraft mc, Settings wanted, Consumer<String> done) {
		if (session != null) return;
		String problem = problem(mc);
		if (problem != null) {
			error = problem;
			if (done != null) done.accept(problem);
			return;
		}
		IntegratedServer server = mc.getSingleplayerServer();
		Path world = worldFolder(server);
		String hostName = mc.getUser().getName();
		String levelName = server.getWorldData().getLevelName();
		Session s = new Session(server, world, hostName, wanted);
		session = s;
		state = State.STARTING;
		step = "Welt wird gespeichert …";
		error = null;
		notice = null;
		members = List.of();
		KNOCKS.clear();
		LOGINS.clear();
		lastPlayers = -1;
		Path gameDirectory = mc.gameDirectory.toPath();

		// 1. speichern und während der Sicherung nicht mehr speichern (wie save-off), damit das ZIP stimmig ist
		Map<ServerLevel, Boolean> saving = new HashMap<>();
		server.submit(() -> {
			server.saveEverything(true, true, true);
			for (ServerLevel level : server.getAllLevels()) {
				saving.put(level, level.noSave);
				level.noSave = true;
			}
		}).thenRunAsync(() -> {
			// 2. Sicherung
			if (session != s) return;
			step = "Sicherung wird angelegt …";
			try {
				s.backup = WorldBackups.create(gameDirectory, world, false);
				lastBackup = s.backup;
			} catch (Exception e) {
				throw new IllegalStateException("Sicherung fehlgeschlagen – Teilen abgebrochen (" + e.getMessage() + ")", e);
			} finally {
				server.execute(() -> saving.forEach((level, value) -> level.noSave = value));
			}
			// 3. Welt beim Dienst (feste Adresse über heldix-welt.json)
			if (session != s) return;
			step = "Adresse wird geholt …";
			WorldService.World remote = remoteWorld(s, world, levelName);
			s.worldId = remote.id();
			s.address = remote.address();
			try {
				members = WorldService.members(remote.id()).get(20, TimeUnit.SECONDS);
			} catch (Exception e) {
				HeldixClient.LOGGER.info("Welt teilen: Mitglieder nicht geladen ({})", WorldService.message(e));
			}
		}, WORKER).whenComplete((ignored, failure) -> mc.execute(() -> {
			if (session != s) return;
			if (failure != null) {
				Throwable cause = failure.getCause() != null ? failure.getCause() : failure;
				failStart(s, cause instanceof IllegalStateException && cause.getMessage() != null ? cause.getMessage() : WorldService.message(cause), done);
				return;
			}
			open(mc, s, done);
		}));
	}

	/** Welt beim Dienst: vorhandene (ID aus heldix-welt.json, Einstellungen angleichen) oder neue */
	private static WorldService.World remoteWorld(Session s, Path world, String levelName) {
		Settings settings = s.settings;
		try {
			String id = WorldBackups.readId(world);
			WorldService.World existing = null;
			if (id != null) {
				WorldService.Listing listing = WorldService.list().get(20, TimeUnit.SECONDS);
				existing = listing.mine().stream().filter(w -> w.id().equals(id)).findFirst().orElse(null);
			}
			if (existing == null) {
				WorldService.World created = WorldService.create(levelName, settings.access(), settings.maxPlayers(), settings.defaultRole()).get(20, TimeUnit.SECONDS);
				WorldBackups.writeId(world, created.id());
				return created;
			}
			if (existing.access() != settings.access() || existing.maxPlayers() != settings.maxPlayers() || existing.defaultRole() != settings.defaultRole()
					|| !existing.name().equals(WorldService.name(levelName))) {
				WorldService.World updated = WorldService.update(existing.id(), levelName, settings.access(), settings.maxPlayers(), settings.defaultRole())
						.get(20, TimeUnit.SECONDS);
				if (updated != null) return updated;
			}
			return existing;
		} catch (java.util.concurrent.ExecutionException e) {
			throw new IllegalStateException(WorldService.message(e.getCause()), e);
		} catch (java.io.IOException e) {
			throw new IllegalStateException("heldix-welt.json nicht geschrieben (" + e.getMessage() + ")", e);
		} catch (Exception e) {
			throw new IllegalStateException("Heldix-Dienst antwortet nicht", e);
		}
	}

	/** 4. als LAN öffnen (freier Port) und den Tunnel aufbauen */
	private static void open(Minecraft mc, Session s, Consumer<String> done) {
		IntegratedServer server = s.server;
		if (mc.getSingleplayerServer() != server) {
			failStart(s, "Die Welt wurde inzwischen verlassen.", done);
			return;
		}
		int port;
		if (server.isPublished()) {
			port = server.getPort();
		} else {
			port = HttpUtil.getAvailablePort();
			// ohne Befehle für Gäste: Befehle gibt es über die Rolle Operator
			if (!server.publishServer(MinecraftServer.MultiplayerScope.LAN, false, port)) {
				failStart(s, "Die Welt konnte nicht geöffnet werden.", done);
				return;
			}
			s.publishedByUs = true;
		}
		s.lanPort = port;
		applyWorldSettings(server, s.settings);
		refreshPermissions(server);
		state = State.CONNECTING;
		step = "Verbinde mit dem Heldix-Dienst …";
		WorldTunnel tunnel = new WorldTunnel(s.worldId, port, SharedConstants.getCurrentVersion().name(), SharedConstants.getProtocolVersion(),
				server.getMotd(), new TunnelEvents(mc, s));
		s.tunnel = tunnel;
		tunnel.start();
		HeldixClient.LOGGER.info("Welt teilen: Welt intern geöffnet, verbinde mit dem Heldix-Dienst");
		if (done != null) done.accept(null);
	}

	private static void failStart(Session s, String message, Consumer<String> done) {
		error = message;
		Minecraft mc = Minecraft.getInstance();
		close(mc, s, null);
		toast(mc, "Welt nicht geteilt", message);
		if (done != null) done.accept(message);
	}

	/** „Teilen beenden“ (Haupt-Thread): Gäste mit Meldung trennen, LAN wieder zu (wenn wir es geöffnet haben), Tunnel zu */
	public static void stop() {
		Session s = session;
		if (s == null) return;
		Minecraft mc = Minecraft.getInstance();
		close(mc, s, "Der Gastgeber hat das Teilen beendet.");
		toast(mc, "Teilen beendet", "Die Welt ist wieder nur für dich.");
	}

	private static void close(Minecraft mc, Session s, String reason) {
		close(mc, s, reason, true);
	}

	/** {@code touchServer}: Gäste trennen und LAN schließen (nicht beim Verlassen der Welt – der Server fährt dann ohnehin herunter) */
	private static void close(Minecraft mc, Session s, String reason, boolean touchServer) {
		if (session != s) return;
		session = null;
		state = State.OFF;
		step = null;
		notice = null;
		members = List.of();
		KNOCKS.clear();
		LOGINS.clear();
		lastPlayers = -1;
		if (s.tunnel != null) s.tunnel.close();
		IntegratedServer server = s.server;
		if (touchServer && mc.getSingleplayerServer() == server && server != null && server.isRunning()) {
			try {
				if (s.publishedByUs && server.isPublished()) {
					Component message = Component.literal(reason != null ? reason : "Der Gastgeber hat das Teilen beendet.");
					for (ServerPlayer player : List.copyOf(server.getPlayerList().getPlayers())) {
						if (!server.isSingleplayerOwner(player.nameAndId())) player.connection.disconnect(message);
					}
					server.unpublishServer();
				}
				refreshPermissions(server);
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.warn("Welt teilen: Beenden nicht ganz geklappt", e);
			}
		}
		dev.heldixclient.status.StatusReporter.refresh(mc);
	}

	/** Welt verlassen oder Spiel beendet: alles schließen, ohne Meldung */
	public static void leftWorld(Minecraft mc) {
		Session s = session;
		if (s != null) close(mc, s, null, false);
	}

	/** Spielmodus und Cheats der Welt wie im Dialog (Haupt-Thread, wie Minecrafts Welt-Optionen) */
	private static void applyWorldSettings(IntegratedServer server, Settings settings) {
		if (settings.gameMode() != null && server.getDefaultGameType() != settings.gameMode() && !server.isHardcore()) server.setWorldGameType(settings.gameMode());
		if (server.getWorldData().isAllowCommands() != settings.cheats()) server.setWorldAllowCommands(settings.cheats());
	}

	/** Berechtigungen aller Spieler neu schicken (nach Start, Ende oder Rollenwechsel) */
	private static void refreshPermissions(IntegratedServer server) {
		server.execute(() -> {
			PlayerList list = server.getPlayerList();
			for (ServerPlayer player : list.getPlayers()) list.sendPlayerPermissionLevel(player);
		});
	}

	// ======================================================================================
	// Tunnel-Ereignisse (Netzwerk-Threads → Haupt-Thread)
	// ======================================================================================

	private record TunnelEvents(Minecraft mc, Session s) implements WorldTunnel.Events {
		@Override
		public void ready(String address, String code) {
			mc.execute(() -> {
				if (session != s) return;
				boolean first = state != State.ONLINE && state != State.RECONNECTING;
				s.address = address;
				state = State.ONLINE;
				notice = null;
				lastPlayers = -1;
				if (first) {
					Notifications.show("welt-teilen", "Welt geteilt", "Adresse: " + normalizeAddress(address), null);
					HeldixClient.LOGGER.info("Welt teilen: Welt ist geöffnet");
				}
				dev.heldixclient.status.StatusReporter.refresh(mc);
			});
		}

		@Override
		public void rejected(String message) {
			mc.execute(() -> {
				if (session != s) return;
				error = message;
				close(mc, s, "Die Welt ist nicht mehr geteilt.");
				toast(mc, "Welt nicht mehr geteilt", message);
			});
		}

		@Override
		public void lost(int code, boolean retrying) {
			mc.execute(() -> {
				if (session != s) return;
				if (!retrying) {
					error = switch (code) {
						case 4001 -> "Dein Heldix-Konto wurde gelöscht – Teilen beendet.";
						case 4003 -> "Dein Heldix-Konto ist gesperrt – Teilen beendet.";
						case 4010 -> "Die Welt wurde beim Heldix-Dienst gelöscht.";
						case 4011 -> "Der Heldix-Dienst hat das Teilen beendet.";
						default -> "Die Welt wurde in einem anderen Spiel geteilt – hier beendet.";
					};
					close(mc, s, "Der Gastgeber hat das Teilen beendet.");
					toast(mc, "Welt nicht mehr geteilt", error);
					return;
				}
				if (state == State.ONLINE) state = State.RECONNECTING;
				notice = "Verbindung zum Heldix-Dienst unterbrochen – neuer Versuch …";
			});
		}

		@Override
		public void knock(String name) {
			mc.execute(() -> {
				if (session == s) addKnock(name, false);
			});
		}

		@Override
		public void members(com.google.gson.JsonElement list) {
			List<Member> parsed = WorldService.parseMembers(list);
			mc.execute(() -> {
				if (session != s) return;
				members = parsed;
				applyRoles(s);
			});
		}

		@Override
		public void settings(com.google.gson.JsonElement json) {
			WorldService.World world = WorldService.world(json);
			if (world == null) return;
			mc.execute(() -> {
				if (session != s || !world.id().equals(s.worldId)) return;
				Settings old = s.settings;
				Settings next = new Settings(world.access(), world.defaultRole(), world.maxPlayers(), old.gameMode(), old.cheats());
				if (next.equals(old)) return;
				s.settings = next;
				applyRoles(s);
				dev.heldixclient.status.StatusReporter.refresh(mc);
			});
		}

		@Override
		public void stream(String kind, String name) {
			if (!"login".equals(kind) || name == null) return;
			LOGINS.put(name.toLowerCase(Locale.ROOT), System.currentTimeMillis());
			// den Namen kennt der Dienst als zugelassen: kennen wir ihn nicht, Mitglieder frisch holen (bevor Mojang fertig prüft)
			if (memberByName(name) == null) refreshMembers();
		}
	}

	// ======================================================================================
	// Jeder Tick (Haupt-Thread)
	// ======================================================================================

	public static void tick(Minecraft mc) {
		// Tasten fürs Anklopfen (nur im Spiel ohne offenes Menü zählt Minecraft Tastendrücke); klopft niemand an, gehören
		// sie der Einblendung der Party (Einladung annehmen/ablehnen, dem Leiter folgen)
		while (HeldixClient.knockAllowKey.consumeClick()) {
			Knock knock = currentKnock();
			if (knock != null) allow(knock.name());
			else dev.heldixclient.social.Party.promptYes(mc);
		}
		while (HeldixClient.knockDenyKey.consumeClick()) {
			Knock knock = currentKnock();
			if (knock != null) deny(knock.name());
			else dev.heldixclient.social.Party.promptNo(mc);
		}
		Session s = session;
		if (s == null) return;
		if (mc.getSingleplayerServer() != s.server) {
			close(mc, s, null, false);
			return;
		}
		if (++tickCounter % 20 != 0) return;
		if (s.lanPort > 0 && !s.server.isPublished()) {
			// in den Welt-Optionen „Im LAN öffnen“ ausgeschaltet: ohne LAN kein Tunnel
			error = "Die Welt ist nicht mehr im LAN geöffnet – Teilen beendet.";
			close(mc, s, null);
			toast(mc, "Teilen beendet", error);
			return;
		}
		long now = System.currentTimeMillis();
		KNOCKS.removeIf(k -> now - k.at() >= KNOCK_MS);
		LOGINS.values().removeIf(at -> now - at > 60_000);
		int count = s.server.getPlayerCount();
		if (count != lastPlayers && s.tunnel != null && s.tunnel.ready()) {
			lastPlayers = count;
			com.google.gson.JsonObject players = new com.google.gson.JsonObject();
			players.addProperty("type", "players");
			players.addProperty("count", count);
			s.tunnel.send(players);
			dev.heldixclient.status.StatusReporter.refresh(mc);
		}
	}

	// ======================================================================================
	// Anklopfen
	// ======================================================================================

	/** neue Anfrage (Haupt-Thread); dieselbe Person ersetzt ihre frühere */
	private static void addKnock(String name, boolean local) {
		boolean fromService = !local;
		for (Knock knock : KNOCKS) {
			if (knock.name().equalsIgnoreCase(name)) {
				KNOCKS.remove(knock);
				// kam sie schon vom Dienst, bleibt sie eine Anfrage des Dienstes
				fromService |= !knock.local();
			}
		}
		KNOCKS.add(new Knock(name, System.currentTimeMillis(), !fromService));
		while (KNOCKS.size() > MAX_KNOCKS) KNOCKS.removeFirst();
		HeldixClient.LOGGER.info("Welt teilen: jemand klopft an");
	}

	/** Erlauben: Mitglied mit der Rolle für Neue (über den Dienst) */
	public static void allow(String name) {
		Session s = session;
		Knock knock = takeKnock(name);
		if (s == null || s.worldId == null) return;
		if (knock != null && !knock.local() && s.tunnel != null && s.tunnel.ready()) {
			com.google.gson.JsonObject message = new com.google.gson.JsonObject();
			message.addProperty("type", "allow");
			message.addProperty("name", name);
			s.tunnel.send(message);
		} else {
			WorldService.putMember(s.worldId, name, s.settings.defaultRole()).exceptionally(e -> {
				Minecraft.getInstance().execute(() -> toast(Minecraft.getInstance(), "Nicht erlaubt", WorldService.message(e)));
				return null;
			});
		}
		// sofort zulassen (der Dienst trägt das Mitglied gleich ein), danach den echten Stand holen
		List<Member> list = new ArrayList<>(members);
		if (memberByName(name) == null) list.add(new Member(name, null, s.settings.defaultRole(), System.currentTimeMillis()));
		members = List.copyOf(list);
		refreshMembersLater();
		toast(Minecraft.getInstance(), "Beitritt erlaubt", name + " kann jetzt in deine Welt.");
	}

	public static void deny(String name) {
		Session s = session;
		Knock knock = takeKnock(name);
		if (s == null || knock == null || knock.local() || s.tunnel == null) return;
		com.google.gson.JsonObject message = new com.google.gson.JsonObject();
		message.addProperty("type", "deny");
		message.addProperty("name", name);
		s.tunnel.send(message);
	}

	private static Knock takeKnock(String name) {
		Knock found = null;
		for (Knock knock : KNOCKS) {
			if (knock.name().equalsIgnoreCase(name)) {
				KNOCKS.remove(knock);
				found = knock;
			}
		}
		return found;
	}

	// ======================================================================================
	// Mitglieder, Einladungen, Einstellungen
	// ======================================================================================

	/** Mitglieder neu vom Dienst holen (im Hintergrund) */
	public static CompletableFuture<Void> refreshMembers() {
		Session s = session;
		if (s == null || s.worldId == null) return CompletableFuture.completedFuture(null);
		return WorldService.members(s.worldId).thenAccept(list -> {
			if (session != s) return;
			members = list;
			Minecraft.getInstance().execute(() -> applyRoles(s));
		});
	}

	private static void refreshMembersLater() {
		Session s = session;
		if (s == null) return;
		CompletableFuture.delayedExecutor(1500, TimeUnit.MILLISECONDS).execute(() -> {
			if (session == s) refreshMembers();
		});
	}

	/** Freunde einladen: Echtzeit-Einladung, sie werden Mitglied mit der Rolle für Neue */
	public static CompletableFuture<Void> invite(List<UUID> friends) {
		Session s = session;
		if (s == null || s.worldId == null) return CompletableFuture.failedFuture(new Social.ServiceException("Die Welt ist nicht geteilt"));
		return WorldService.invite(s.worldId, friends).thenCompose(ignored -> refreshMembers());
	}

	/** Mitglied hinzufügen oder Rolle ändern; gilt sofort auch für Spieler in der Welt */
	public static CompletableFuture<Void> putMember(String name, Role role) {
		Session s = session;
		if (s == null || s.worldId == null) return CompletableFuture.failedFuture(new Social.ServiceException("Die Welt ist nicht geteilt"));
		return WorldService.putMember(s.worldId, name, role).thenCompose(ignored -> refreshMembers());
	}

	public static CompletableFuture<Void> removeMember(String name) {
		Session s = session;
		if (s == null || s.worldId == null) return CompletableFuture.failedFuture(new Social.ServiceException("Die Welt ist nicht geteilt"));
		return WorldService.removeMember(s.worldId, name).thenCompose(ignored -> refreshMembers()).thenRun(() -> kickIfUnlisted(s, name));
	}

	/** Entferntes Mitglied, das gerade in der Welt ist und nicht mehr hinein dürfte: trennen */
	private static void kickIfUnlisted(Session s, String name) {
		IntegratedServer server = s.server;
		server.execute(() -> {
			if (session != s) return;
			ServerPlayer player = server.getPlayerList().getPlayerByName(name);
			if (player == null || server.isSingleplayerOwner(player.nameAndId()) || roleOf(s, player.nameAndId()) != null) return;
			player.connection.disconnect(Component.literal("Du bist in dieser Welt nicht mehr eingetragen."));
		});
	}

	/** Einstellungen während des Teilens ändern: beim Dienst speichern, Spielmodus/Cheats der Welt, Rollen anwenden */
	public static CompletableFuture<Void> update(Minecraft mc, Settings settings) {
		Session s = session;
		if (s == null || s.worldId == null) return CompletableFuture.failedFuture(new Social.ServiceException("Die Welt ist nicht geteilt"));
		return WorldService.update(s.worldId, null, settings.access(), settings.maxPlayers(), settings.defaultRole()).thenAccept(world -> mc.execute(() -> {
			if (session != s) return;
			s.settings = settings;
			applyWorldSettings(s.server, settings);
			applyRoles(s);
			dev.heldixclient.status.StatusReporter.refresh(mc);
		}));
	}

	/** Rollen aller Gäste neu anwenden (Spielmodus und Befehle) */
	private static void applyRoles(Session s) {
		IntegratedServer server = s.server;
		if (Minecraft.getInstance().getSingleplayerServer() != server) return;
		server.execute(() -> {
			if (session != s) return;
			PlayerList list = server.getPlayerList();
			for (ServerPlayer player : List.copyOf(list.getPlayers())) {
				if (server.isSingleplayerOwner(player.nameAndId())) continue;
				// nicht (mehr) gelistet: Rolle für Neue – getrennt wird nur beim Entfernen (kickIfUnlisted)
				Role role = roleOf(s, player.nameAndId());
				player.setGameMode(gameModeFor(s, role == null ? s.settings.defaultRole() : role));
				list.sendPlayerPermissionLevel(player);
			}
		});
	}

	// ======================================================================================
	// Prüfungen vom Server-Thread (Eingriffe in WorldSharePatches)
	// ======================================================================================

	/** Rolle eines Spielers: Mitglied, sonst Freund (bei „Freunde“) bzw. jeder (bei „offen“) mit der Rolle für Neue; null = nicht zugelassen */
	private static Role roleOf(Session s, NameAndId who) {
		Member member = member(who);
		if (member != null) return member.role();
		Settings settings = s.settings;
		if (settings.access() == Access.OPEN) return settings.defaultRole();
		if (settings.access() == Access.FRIENDS && Social.isFriend(who.id())) return settings.defaultRole();
		return null;
	}

	/** Mitglied per UUID; Einträge ohne UUID per Name (Groß-/Kleinschreibung egal) */
	private static Member member(NameAndId who) {
		for (Member member : members) {
			if (member.uuid() != null) {
				if (member.uuid().equals(who.id())) return member;
			} else if (member.name().equalsIgnoreCase(who.name())) {
				return member;
			}
		}
		return null;
	}

	private static Member memberByName(String name) {
		for (Member member : members) if (member.name().equalsIgnoreCase(name)) return member;
		return null;
	}

	private static GameType gameModeFor(Session s, Role role) {
		if (role == Role.VISITOR) return GameType.ADVENTURE;
		GameType mode = s.settings.gameMode();
		return mode != null ? mode : s.server.getDefaultGameType();
	}

	/** Login (nach der Prüfung durch Mojang): null = darf hinein, sonst Grund fürs Trennen. Klopft dabei an. */
	public static Component loginDenied(IntegratedServer server, NameAndId who) {
		Session s = session;
		if (s == null || s.server != server || who == null) return null;
		if (server.isSingleplayerOwner(who)) return null;
		if (roleOf(s, who) != null) return null;
		String name = who.name();
		Minecraft.getInstance().execute(() -> {
			if (session == s) addKnock(name, true);
		});
		return Component.literal("Du bist noch nicht eingeladen – " + s.hostName + " wurde gefragt. Versuch es gleich noch einmal.");
	}

	/** Berechtigungen: Gastgeber immer mit allen Befehlen, Operatoren mit Befehlen (Stufe 2), sonst wie Minecraft */
	public static LevelBasedPermissionSet permissions(LevelBasedPermissionSet vanilla, IntegratedServer server, NameAndId who) {
		Session s = session;
		if (s == null || s.server != server || who == null) return vanilla;
		if (server.isSingleplayerOwner(who)) return LevelBasedPermissionSet.OWNER;
		if (roleOf(s, who) == Role.OPERATOR && vanilla != LevelBasedPermissionSet.ADMIN && vanilla != LevelBasedPermissionSet.OWNER) {
			return LevelBasedPermissionSet.GAMEMASTER;
		}
		return vanilla;
	}

	/** Neuer Spieler ist in der Welt: Spielmodus nach Rolle */
	public static void playerJoined(PlayerList list, ServerPlayer player) {
		Session s = session;
		if (s == null || s.server != list.getServer() || player == null) return;
		if (s.server.isSingleplayerOwner(player.nameAndId())) return;
		Role role = roleOf(s, player.nameAndId());
		player.setGameMode(gameModeFor(s, role == null ? s.settings.defaultRole() : role));
	}

	/** Höchstspieler, solange geteilt (Minecraft: fest 8) */
	public static int maxPlayers(int vanilla, IntegratedServer server) {
		Session s = session;
		return s != null && s.server == server ? s.settings.maxPlayers() : vanilla;
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	static void toast(Minecraft mc, String title, String message) {
		if (mc.level != null) Notifications.show("welt-teilen", title, message, null);
		else dev.heldixclient.social.Invites.toast(mc, title, message);
	}
}
