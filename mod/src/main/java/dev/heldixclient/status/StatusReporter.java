package dev.heldixclient.status;

import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.api.event.ClientEvents;
import dev.heldixclient.loader.api.event.ScreenEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.voice.VoiceLink;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.ToggleKeyMapping;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.resources.Identifier;

/**
 * Meldet dem Launcher, wo der Spieler gerade ist – für den Discord-Status.
 * Der Launcher liest die Zeilen "HELDIX-STATUS {…}" aus dem Log; in seiner Konsole erscheinen sie nicht.
 *
 * <p>Modi: menu, singleplayer, multiplayer (mit Serveradresse), realms, lan.
 * Welche Serveradressen in Discord sichtbar werden, entscheidet der Launcher (nur öffentliche Domains).
 *
 * <p>Ab 0.13.8 zusätzlich {@code world} bei geteilten Welten: beim Gastgeber (Modus bleibt singleplayer)
 * {@code { address, host: true, players, max }}, bei Mitspielern einer Heldix-Welt ({@code <code>.welt.<Domain>})
 * {@code { address, host: false }}. Ältere Launcher ignorieren das Feld.
 *
 * <p>Ebenfalls ab 0.13.8, jeweils nur, wenn bekannt (ältere Launcher ignorieren auch diese):
 * <ul>
 *   <li>{@code dimension}: {@code overworld}, {@code nether}, {@code end} oder die ID einer anderen Dimension</li>
 *   <li>{@code gameMode}: {@code survival}, {@code creative}, {@code adventure}, {@code spectator}</li>
 *   <li>{@code players} (Einträge der Tab-Liste, man selbst eingeschlossen) und {@code maxPlayers} (aus der
 *       Serverliste, nur wenn der Server dort abgefragt wurde) – nicht im Einzelspieler</li>
 *   <li>{@code worldName}: Name der Einzelspielerwelt – ob er in Discord erscheint, entscheidet der Launcher
 *       (eigene Einstellung, ab Werk aus); Minecraft schreibt ihn ohnehin selbst ins Log</li>
 *   <li>{@code voice: { inGroup, others }}, solange der Voice Chat verbunden ist: in einer Gruppe? und wie viele
 *       andere dabei sind (Gruppe bzw. alle anderen im Raum des Servers)</li>
 *   <li>{@code afk: true} nach 5 Minuten ohne Eingabe (Tasten, Maus, Menüwechsel)</li>
 *   <li>{@code party: { size, max, leader }} in einer Party (Heldix-Dienst ab 1.12.0), auch im Hauptmenü: Mitglieder,
 *       Höchstzahl und ob man selbst Leiter ist ({@code leader} true/false)</li>
 * </ul>
 * Eine neue Zeile kommt nur bei einer Änderung und höchstens alle 2 Sekunden.
 */
public final class StatusReporter {
	/** Mindestabstand zwischen zwei Zeilen */
	static final long MIN_INTERVAL_MS = 2_000;
	/** ohne Eingabe so lange bis „abwesend“ */
	static final long AFK_MS = 5 * 60_000;

	private static long afkAfterMs = AFK_MS;
	/** zuletzt geschriebene Zeile und eine neue, die noch auf den Mindestabstand wartet */
	private static String last;
	private static String pending;
	private static long lastWrittenAt;
	private static String lastPresence;
	private static String lastMode;
	private static int ticks;

	/** Eingabe für „abwesend“ (nur im Haupt-Thread) */
	private static long lastInputAt = System.currentTimeMillis();
	private static double lastMouseX = Double.NaN;
	private static double lastMouseY = Double.NaN;
	private static Screen lastScreen;

	private StatusReporter() {
	}

	public static void init() {
		// Hauptmenü erreicht (beim Start und nach dem Verlassen einer Welt)
		ScreenEvents.AFTER_INIT.register((minecraft, screen, width, height) -> {
			if (screen instanceof TitleScreen && minecraft.level == null) report(minecraft, true);
		});
		WorldEvents.JOIN.register(minecraft -> report(minecraft, true));
		WorldEvents.LEAVE.register(minecraft -> emit("menu", null, null, extras(minecraft, "menu"), true));
		ClientEvents.TICK_END.register(StatusReporter::tick);
	}

	/** Status neu melden (z. B. Welt geteilt, Spielerzahl geändert); doppelte Zeilen fallen weg */
	public static void refresh(Minecraft minecraft) {
		report(minecraft, true);
	}

	/**
	 * Jeden Tick: Eingaben merken, einmal pro Sekunde den Stand neu bestimmen (Dimension, Spielmodus, Spieler, Voice,
	 * abwesend) und eine wartende Zeile schreiben, sobald der Mindestabstand um ist. Vor der ersten Meldung (Start,
	 * Direktstart in eine Welt) nur, wenn schon eine Welt da ist – das Hauptmenü meldet erst der Titelbildschirm.
	 */
	private static void tick(Minecraft minecraft) {
		trackInput(minecraft);
		if (++ticks % 20 == 0 && (minecraft.level != null || "menu".equals(lastMode))) report(minecraft, false);
		flush(false);
	}

	private static void report(Minecraft minecraft, boolean event) {
		if (minecraft.level == null) {
			emit("menu", null, null, extras(minecraft, "menu"), event);
		} else if (minecraft.hasSingleplayerServer()) {
			emit("singleplayer", null, WorldShare.hostStatus(), extras(minecraft, "singleplayer"), event);
		} else {
			ServerData server = minecraft.getCurrentServer();
			if (server == null) emit("multiplayer", null, null, extras(minecraft, "multiplayer"), event);
			else if (server.isRealm()) emit("realms", null, null, extras(minecraft, "realms"), event);
			else if (server.isLan()) emit("lan", null, null, extras(minecraft, "lan"), event);
			else emit("multiplayer", server.ip, guestStatus(server.ip), extras(minecraft, "multiplayer"), event);
		}
	}

	/** Mitspieler einer Heldix-Welt: {@code { address, host: false }}, sonst null */
	private static JsonObject guestStatus(String ip) {
		if (!WorldShare.isWorldAddress(ip)) return null;
		JsonObject world = new JsonObject();
		world.addProperty("address", WorldShare.normalizeAddress(ip));
		world.addProperty("host", false);
		return world;
	}

	/** Felder ab 0.13.8 (siehe oben); im Hauptmenü nur {@code afk} */
	private static JsonObject extras(Minecraft minecraft, String mode) {
		JsonObject json = new JsonObject();
		if (!"menu".equals(mode) && minecraft.level != null) {
			json.addProperty("dimension", dimension(minecraft.level.dimension().identifier()));
			if (minecraft.gameMode != null) json.addProperty("gameMode", minecraft.gameMode.getPlayerMode().getName());
			if ("singleplayer".equals(mode)) {
				IntegratedServer server = minecraft.getSingleplayerServer();
				if (server != null) json.addProperty("worldName", server.getWorldData().getLevelName());
			} else {
				ClientPacketListener connection = minecraft.getConnection();
				if (connection != null) json.addProperty("players", connection.getListedOnlinePlayers().size());
				ServerData server = minecraft.getCurrentServer();
				if (server != null && server.players != null && server.players.max() > 0) json.addProperty("maxPlayers", server.players.max());
			}
			if (VoiceLink.status() == VoiceLink.Status.CONNECTED) {
				boolean inGroup = (VoiceLink.groupName() != null && VoiceLink.groupsAvailable() && VoiceLink.groupProblem() == null) || VoiceLink.inPartyGroup();
				JsonObject voice = new JsonObject();
				voice.addProperty("inGroup", inGroup);
				voice.addProperty("others", inGroup ? VoiceLink.groupMembers().size() : VoiceLink.peers().size());
				json.add("voice", voice);
			}
		}
		// Party (ab Dienst 1.12.0), auch im Hauptmenü
		JsonObject party = dev.heldixclient.social.Party.statusJson();
		if (party != null) json.add("party", party);
		if (System.currentTimeMillis() - lastInputAt >= afkAfterMs) json.addProperty("afk", true);
		return json;
	}

	/** overworld, nether, end – andere Dimensionen mit ihrer ID (z. B. „aether:the_aether“) */
	public static String dimension(Identifier id) {
		if ("minecraft".equals(id.getNamespace())) {
			switch (id.getPath()) {
				case "overworld":
					return "overworld";
				case "the_nether":
					return "nether";
				case "the_end":
					return "end";
				default:
			}
		}
		return id.toString();
	}

	private static void emit(String mode, String server, JsonObject world, JsonObject extras, boolean event) {
		// an den Dienst nur Modus und Server (wie bisher); ein neuer Stand der geteilten Welt allein ändert dort nichts,
		// die Prüfung jede Sekunde (event = false) meldet nur echte Wechsel
		String presence = mode + "|" + server;
		boolean changed = !presence.equals(lastPresence);
		if (event ? world == null || changed : changed) dev.heldixclient.social.Social.statusChanged(mode, server);
		lastPresence = presence;
		lastMode = mode;
		JsonObject json = new JsonObject();
		json.addProperty("mode", mode);
		if (server != null) json.addProperty("server", server);
		if (world != null) json.add("world", world);
		if (extras != null) extras.entrySet().forEach(entry -> json.add(entry.getKey(), entry.getValue()));
		String line = json.toString();
		if (line.equals(last)) {
			pending = null;
			return;
		}
		pending = line;
		flush(false);
	}

	/** Wartende Zeile schreiben – sobald der Mindestabstand um ist (force: sofort, nur für Tests) */
	private static void flush(boolean force) {
		if (pending == null || (!force && System.currentTimeMillis() - lastWrittenAt < MIN_INTERVAL_MS)) return;
		last = pending;
		pending = null;
		lastWrittenAt = System.currentTimeMillis();
		HeldixClient.LOGGER.info("HELDIX-STATUS {}", last);
	}

	/**
	 * Jede Eingabe setzt „abwesend“ zurück: Maus bewegt oder gedrückt, eine Taste von Minecraft gedrückt, neues Menü.
	 * Tippen in einem offenen Menü (z. B. Chat) zählt nicht – dafür reicht jede Mausbewegung.
	 */
	private static void trackInput(Minecraft minecraft) {
		boolean input = false;
		double x = minecraft.mouseHandler.xpos();
		double y = minecraft.mouseHandler.ypos();
		if (x != lastMouseX || y != lastMouseY) {
			input = !Double.isNaN(lastMouseX);
			lastMouseX = x;
			lastMouseY = y;
		}
		if (minecraft.mouseHandler.isLeftPressed() || minecraft.mouseHandler.isRightPressed() || minecraft.mouseHandler.isMiddlePressed()) input = true;
		Screen screen = minecraft.gui.screen();
		if (screen != lastScreen) {
			lastScreen = screen;
			input = true;
		}
		if (!input) {
			for (KeyMapping key : minecraft.options.keyMappings) {
				// Umschalt-Tasten (Schleichen/Sprinten im Modus „Umschalten“) bleiben ohne Eingabe „gedrückt“
				if (key.isDown() && !(key instanceof ToggleKeyMapping)) {
					input = true;
					break;
				}
			}
		}
		if (input) lastInputAt = System.currentTimeMillis();
	}

	// --- für den Autotest ------------------------------------------------------------------------

	/** Zuletzt geschriebene Zeile (JSON ohne „HELDIX-STATUS“), null = noch keine */
	public static String lastLine() {
		return last;
	}

	/** Test-Schalter: „abwesend“ schon nach {@code millis} ohne Eingabe (≤ 0 = wieder 5 Minuten) */
	public static void testAfkAfter(long millis) {
		afkAfterMs = millis > 0 ? millis : AFK_MS;
	}

	/** Test: Stand sofort neu bestimmen und eine geänderte Zeile ohne Mindestabstand schreiben */
	public static void testReport(Minecraft minecraft) {
		report(minecraft, false);
		flush(true);
	}

	/** Test: Zeitpunkt der letzten Zeile (für die Prüfung des Mindestabstands) */
	public static long lastWrittenAt() {
		return lastWrittenAt;
	}
}
