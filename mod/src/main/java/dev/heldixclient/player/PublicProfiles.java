package dev.heldixclient.player;

import dev.heldixclient.social.Social;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Öffentliche Spielerprofile (ab Heldix-Dienst 1.14.0, Vertrag C): Hat ein Spieler sein Profil öffentlich gemacht, zeigt das
 * Spielermenü „Profil im Browser“ ({@code <webseite>/spieler/<name>}). Ob es öffentlich ist, sagt
 * {@code GET /v1/public/players/<uuid32>} (404 = nicht öffentlich, auch bei älteren Diensten). Ergebnisse gelten zehn
 * Minuten; gefragt wird erst, wenn das Spielermenü für den Spieler aufgeht.
 */
public final class PublicProfiles {
	public enum State { UNKNOWN, PUBLIC, PRIVATE }

	private record Entry(State state, long at) {
	}

	private static final long TTL_MS = 10 * 60 * 1000L;
	private static final int MAX = 200;
	private static final Map<UUID, Entry> CACHE = new ConcurrentHashMap<>();
	private static final Map<UUID, Boolean> LOADING = new ConcurrentHashMap<>();

	private PublicProfiles() {
	}

	/** Stand für diesen Spieler; unbekannt bzw. veraltet → im Hintergrund nachfragen (nie blockierend) */
	public static State state(UUID player) {
		if (player == null || Social.baseUrl().isEmpty()) return State.PRIVATE;
		Entry entry = CACHE.get(player);
		long now = System.currentTimeMillis();
		if (entry != null && now - entry.at() < TTL_MS) return entry.state();
		if (LOADING.putIfAbsent(player, Boolean.TRUE) == null) {
			if (CACHE.size() >= MAX) CACHE.clear();
			Social.request("GET", "/v1/public/players/" + Social.compact(player), null, false).whenComplete((json, error) -> {
				LOADING.remove(player);
				boolean visible = error == null && json != null && json.isJsonObject() && json.getAsJsonObject().has("uuid");
				CACHE.put(player, new Entry(visible ? State.PUBLIC : State.PRIVATE, System.currentTimeMillis()));
			});
		}
		return entry != null ? entry.state() : State.UNKNOWN;
	}

	/** Adresse der Profilseite oder null (keine Webseite bekannt) */
	public static String url(String name) {
		String site = Social.websiteUrl();
		if (site == null || name == null || !name.matches("[A-Za-z0-9_]{1,16}")) return null;
		return site + "/spieler/" + name;
	}
}
