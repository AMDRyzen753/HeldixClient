package dev.heldixclient.screen;

import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerStatusPinger;
import net.minecraft.server.network.EventLoopGroupHolder;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Status eines einzelnen Servers wie in der Serverliste (Spieler online, Ping), für die Karte „Weiterspielen“ im Hauptmenü
 * und den Ping im Pausemenü, wenn der Server in der Tab-Liste keinen meldet. Eine Abfrage je Adresse und Minute; das
 * Ergebnis gilt eine Minute. Abgefragt wird eine Kopie der Serverdaten (die Einträge der Serverliste bleiben unverändert).
 */
public final class ServerPing {
	/** Ergebnis einer Abfrage; state: PINGING, SUCCESSFUL, INCOMPATIBLE oder UNREACHABLE */
	public record Result(ServerData.State state, int online, int max, long ping, long at) {
		public boolean ok() {
			return state == ServerData.State.SUCCESSFUL || state == ServerData.State.INCOMPATIBLE;
		}
	}

	private static final long VALID_MS = 60_000;
	private static final long TIMEOUT_MS = 12_000;
	private static final ExecutorService POOL = Executors.newFixedThreadPool(2, runnable -> {
		Thread thread = new Thread(runnable, "Heldix Server-Status");
		thread.setDaemon(true);
		return thread;
	});
	private static final Map<String, Result> RESULTS = new ConcurrentHashMap<>();
	private static final ServerStatusPinger PINGER = new ServerStatusPinger();
	private static long lastTick;

	private ServerPing() {
	}

	private static String key(String ip) {
		return ip == null ? "" : ip.trim().toLowerCase(Locale.ROOT);
	}

	/** Letztes Ergebnis für die Adresse (null = noch nie abgefragt) */
	public static Result result(String ip) {
		return RESULTS.get(key(ip));
	}

	/** Abfrage starten, wenn es kein frisches Ergebnis gibt und keine läuft */
	public static void request(ServerData server) {
		if (server == null || server.ip == null || server.ip.isBlank()) return;
		String key = key(server.ip);
		long now = System.currentTimeMillis();
		Result known = RESULTS.get(key);
		if (known != null && (known.state() == ServerData.State.PINGING ? now - known.at() < TIMEOUT_MS : now - known.at() < VALID_MS)) return;
		RESULTS.put(key, new Result(ServerData.State.PINGING, 0, 0, 0, now));
		ServerData copy = new ServerData(server.name, server.ip, server.type());
		Minecraft minecraft = Minecraft.getInstance();
		POOL.submit(() -> {
			try {
				PINGER.pingServer(copy, () -> {}, () -> {
					ServerData.State state = copy.protocol == SharedConstants.getProtocolVersion() ? ServerData.State.SUCCESSFUL : ServerData.State.INCOMPATIBLE;
					int online = copy.players != null ? copy.players.online() : 0;
					int max = copy.players != null ? copy.players.max() : 0;
					RESULTS.put(key, new Result(state, online, max, copy.ping, System.currentTimeMillis()));
				}, EventLoopGroupHolder.remote(minecraft.options.useNativeTransport()));
			} catch (Exception e) {
				RESULTS.put(key, new Result(ServerData.State.UNREACHABLE, 0, 0, 0, System.currentTimeMillis()));
			}
		});
	}

	/** Verbindungen der Abfragen weiterlaufen lassen (aus dem Zeichnen; höchstens 20-mal je Sekunde) */
	public static void tick() {
		long now = System.currentTimeMillis();
		if (now - lastTick < 50) return;
		lastTick = now;
		PINGER.tick();
		// hängende Abfragen nach der Zeitgrenze als nicht erreichbar werten
		RESULTS.replaceAll((key, result) -> result.state() == ServerData.State.PINGING && now - result.at() > TIMEOUT_MS
				? new Result(ServerData.State.UNREACHABLE, 0, 0, 0, now) : result);
	}

	/** Kurztext wie „153 online · 24 ms“ (null = noch nichts oder nicht erreichbar) */
	public static String summary(Result result) {
		if (result == null || !result.ok()) return null;
		String players = result.online() + " online";
		return result.ping() > 0 ? players + "  ·  " + result.ping() + " ms" : players;
	}
}
