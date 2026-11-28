package dev.heldixclient.serverlink;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.social.Social;

import java.net.IDN;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Partner-Server von HeldixClient: öffentliche Liste des Heldix-Dienstes ({@code GET /v1/public/partners}, ab Dienst
 * 1.14.0), im Arbeitsspeicher eine Stunde zwischengespeichert. Ob ein Server Partner ist, entscheidet allein diese Liste –
 * nicht der Server selbst ({@code welcome.partner} ist nur ein Hinweis).
 *
 * <p>Passt eine Adresse? Beide Seiten werden wie {@code normalizeServer} im Dienst vereinheitlicht (klein, Punkt am Ende
 * weg, IDN als Punycode, Port 25565 weg). Ein Eintrag passt auf seine Domain und alle Subdomains; mit Port nur auf genau
 * diesen Port, ohne Port auf jeden.
 */
public final class Partners {
	/** Ein Partner aus der Liste */
	public record Partner(String id, String name, String description, String website, List<String> servers, boolean featured) {
	}

	private static final long CACHE_MS = 60 * 60 * 1000L;
	/** nach einem Fehler früher neu versuchen */
	private static final long RETRY_MS = 5 * 60 * 1000L;

	private static volatile List<Partner> partners = List.of();
	private static volatile long loadedAt;
	private static volatile long nextTryAt;
	private static volatile boolean loading;
	/** nur Autotest: feste Liste, kein Abruf */
	private static volatile boolean testList;

	private Partners() {
	}

	/** Aktuelle Liste (lädt im Hintergrund nach, wenn sie älter als eine Stunde ist) */
	public static List<Partner> all() {
		refreshIfStale();
		return partners;
	}

	/** Partner, zu dem die Adresse passt, sonst null. Stößt das Laden an, falls nötig (nie blockierend). */
	public static Partner forAddress(String address) {
		refreshIfStale();
		String[] wanted = normalize(address);
		if (wanted == null) return null;
		for (Partner partner : partners) {
			for (String server : partner.servers()) {
				String[] entry = normalize(server);
				if (entry != null && matches(entry, wanted)) return partner;
			}
		}
		return null;
	}

	public static boolean isPartner(String address) {
		return forAddress(address) != null;
	}

	/** [host, port oder ""] – wie normalizeServer im Dienst, null bei unbrauchbarer Adresse */
	static String[] normalize(String value) {
		if (value == null) return null;
		String host = value.strip();
		if (host.isEmpty() || host.length() > 300) return null;
		String port = "";
		int colon = host.lastIndexOf(':');
		if (colon > 0 && host.indexOf(':') == colon) {
			String digits = host.substring(colon + 1);
			if (!digits.matches("\\d{1,5}")) return null;
			int number = Integer.parseInt(digits);
			if (number < 1 || number > 65535) return null;
			host = host.substring(0, colon);
			port = number == 25565 ? "" : String.valueOf(number);
		}
		if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
		if (host.isEmpty()) return null;
		try {
			host = IDN.toASCII(host, IDN.ALLOW_UNASSIGNED).toLowerCase(Locale.ROOT);
		} catch (IllegalArgumentException e) {
			return null;
		}
		if (!host.matches("[a-z0-9.-]+")) return null;
		return new String[] {host, port};
	}

	private static boolean matches(String[] entry, String[] address) {
		boolean host = address[0].equals(entry[0]) || address[0].endsWith("." + entry[0]);
		return host && (entry[1].isEmpty() || entry[1].equals(address[1]));
	}

	private static void refreshIfStale() {
		if (testList || loading) return;
		long now = System.currentTimeMillis();
		if (now < nextTryAt) return;
		if (loadedAt != 0 && now - loadedAt < CACHE_MS) return;
		if (Social.baseUrl().isEmpty()) return;
		loading = true;
		nextTryAt = now + RETRY_MS;
		Social.request("GET", "/v1/public/partners", null, false).whenComplete((json, error) -> {
			loading = false;
			if (error != null) {
				// älterer Dienst (404) oder nicht erreichbar: ohne Partner weiter, später neu versuchen
				HeldixClient.LOGGER.debug("Partnerliste nicht geladen: {}", error.getMessage());
				return;
			}
			List<Partner> list = parse(json);
			partners = List.copyOf(list);
			loadedAt = System.currentTimeMillis();
			nextTryAt = loadedAt + CACHE_MS;
			ServerLink.partnerListChanged();
		});
	}

	static List<Partner> parse(JsonElement json) {
		List<Partner> list = new ArrayList<>();
		if (json == null || !json.isJsonObject()) return list;
		JsonObject root = json.getAsJsonObject();
		if (!root.has("partners") || !root.get("partners").isJsonArray()) return list;
		for (JsonElement element : root.getAsJsonArray("partners")) {
			if (!element.isJsonObject() || list.size() >= 500) continue;
			JsonObject o = element.getAsJsonObject();
			String id = text(o, "id", 32);
			String name = text(o, "name", 40);
			if (id.isEmpty() || name.isEmpty()) continue;
			List<String> servers = new ArrayList<>();
			if (o.has("servers") && o.get("servers").isJsonArray()) {
				JsonArray array = o.getAsJsonArray("servers");
				for (JsonElement server : array) {
					if (server.isJsonPrimitive() && servers.size() < 10) servers.add(server.getAsString());
				}
			}
			boolean featured = o.has("featured") && o.get("featured").isJsonPrimitive() && o.get("featured").getAsBoolean();
			list.add(new Partner(id, name, text(o, "description", 300), text(o, "website", 300), List.copyOf(servers), featured));
		}
		return list;
	}

	private static String text(JsonObject o, String key, int max) {
		if (!o.has(key) || !o.get(key).isJsonPrimitive()) return "";
		String value = ServerLink.clean(o.get(key).getAsString(), max);
		return value == null ? "" : value;
	}

	// --- Autotest ---------------------------------------------------------------------------

	/** Feste Liste setzen (null = wieder vom Dienst laden) */
	public static void setForTest(List<Partner> list) {
		testList = list != null;
		partners = list == null ? List.of() : List.copyOf(list);
		loadedAt = 0;
		nextTryAt = 0;
		ServerLink.partnerListChanged();
	}
}
