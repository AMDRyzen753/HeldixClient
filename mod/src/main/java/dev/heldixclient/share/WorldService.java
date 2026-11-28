package dev.heldixclient.share;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.social.Social;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.regex.Pattern;

/**
 * Welten beim Heldix-Dienst (ab 1.12.0, Protokoll in docs/dienst.md „Welt teilen“): eigene Welten anlegen, ändern,
 * löschen, Mitglieder verwalten, Freunde einladen und die geöffneten Welten der Freunde abrufen. Alles läuft im
 * Netzwerk-Thread von {@link Social}; Fehler kommen als {@link Social.ServiceException} mit Text für den Spieler.
 */
public final class WorldService {
	/** Welt-ID des Dienstes: 32 Hex-Zeichen */
	public static final Pattern WORLD_ID = Pattern.compile("^[0-9a-f]{32}$");
	/** Code einer Welt: 6 Zeichen ohne i, l, o, 0 und 1 */
	public static final Pattern WORLD_CODE = Pattern.compile("^[a-hjkmnp-z2-9]{6}$");
	/** Meldung, wenn der Dienst noch keine Welten kennt (vor 1.12.0: 404) */
	public static final String WORLDS_MISSING = "Welt teilen gibt es erst ab Heldix-Dienst 1.12.0 – der verbundene Dienst ist älter.";

	/** Wer in die Welt darf */
	public enum Access {
		INVITED("invited", "Nur Eingeladene"),
		FRIENDS("friends", "Freunde und Eingeladene"),
		OPEN("open", "Jeder mit der Adresse");

		public final String id;
		public final String label;

		Access(String id, String label) {
			this.id = id;
			this.label = label;
		}

		public static Access of(String id) {
			for (Access access : values()) if (access.id.equals(id)) return access;
			return INVITED;
		}
	}

	/** Rolle eines Spielers in der Welt */
	public enum Role {
		VISITOR("visitor", "Besucher", "Abenteuer-Modus, baut nichts ab"),
		PLAYER("player", "Mitspieler", "Spielmodus der Welt"),
		OPERATOR("operator", "Operator", "Spielmodus der Welt und Befehle");

		public final String id;
		public final String label;
		public final String hint;

		Role(String id, String label, String hint) {
			this.id = id;
			this.label = label;
			this.hint = hint;
		}

		public static Role of(String id) {
			for (Role role : values()) if (role.id.equals(id)) return role;
			return PLAYER;
		}

		public Role next() {
			return values()[(ordinal() + 1) % values().length];
		}
	}

	/**
	 * Eigene Welt, wie der Dienst sie speichert. {@code hosted} (ab Dienst 1.13.0): Zustand, wenn sie dauerhaft auf dem
	 * Heldix-Server läuft (creating, sleeping, starting, running, stopping, error), sonst null – dann ist {@code online}
	 * „läuft“ und {@code players} die Spieler auf dem Server.
	 */
	public record World(String id, String code, String address, String name, Access access, int maxPlayers, Role defaultRole, long created,
			long lastOnline, boolean online, int players, String hosted) {
		/** läuft sie dauerhaft auf dem Heldix-Server? (dann geht „Welt teilen“ mit ihr nicht) */
		public boolean persistent() {
			return hosted != null;
		}
	}

	/**
	 * Gerade geöffnete Welt eines Freundes (oder eine, in der man Mitglied ist). Ab Dienst 1.13.0 auch dauerhafte Welten:
	 * {@code hosted} ist dann ihr Zustand (z. B. "running", "sleeping"), {@code online} sagt, ob der Server gerade läuft.
	 */
	public record FriendWorld(String id, String name, String address, UUID hostUuid, String hostName, int players, int maxPlayers, String version,
			String hosted, boolean online) {
		/** Geöffnet im Sinne von „jetzt drin spielen“: geteilte Welt oder laufende dauerhafte Welt */
		public boolean open() {
			return hosted == null || online;
		}
	}

	/** Mitglied einer Welt; uuid ist null, solange der Dienst nur den Namen kennt */
	public record Member(String name, UUID uuid, Role role, long added) {
	}

	public record Listing(List<World> mine, List<FriendWorld> friends) {
	}

	private WorldService() {
	}

	/** {@code GET /v1/worlds}: eigene Welten und gerade geöffnete Welten von Freunden */
	public static CompletableFuture<Listing> list() {
		return call("GET", "/v1/worlds", null).thenApply(json -> {
			JsonObject object = json.isJsonObject() ? json.getAsJsonObject() : new JsonObject();
			List<World> mine = new ArrayList<>();
			for (JsonElement element : array(object, "mine")) {
				World world = world(element);
				if (world != null) mine.add(world);
			}
			List<FriendWorld> friends = new ArrayList<>();
			for (JsonElement element : array(object, "friends")) {
				FriendWorld world = friendWorld(element);
				if (world != null) friends.add(world);
			}
			return new Listing(List.copyOf(mine), List.copyOf(friends));
		});
	}

	/** {@code POST /v1/worlds}: neue Welt mit fester Adresse */
	public static CompletableFuture<World> create(String name, Access access, int maxPlayers, Role defaultRole) {
		return call("POST", "/v1/worlds", settings(name, access, maxPlayers, defaultRole)).thenApply(WorldService::requireWorld);
	}

	/** {@code PATCH /v1/worlds/<id>}: Name, Zugang, Höchstspieler, Rolle für Neue (null = unverändert) */
	public static CompletableFuture<World> update(String id, String name, Access access, int maxPlayers, Role defaultRole) {
		return call("PATCH", "/v1/worlds/" + id, settings(name, access, maxPlayers, defaultRole)).thenApply(json -> {
			World world = world(json.isJsonObject() && json.getAsJsonObject().has("world") ? json.getAsJsonObject().get("world") : json);
			return world;
		});
	}

	/** {@code DELETE /v1/worlds/<id>}: Welt beim Dienst löschen (die Adresse ist danach weg) */
	public static CompletableFuture<Void> delete(String id) {
		return call("DELETE", "/v1/worlds/" + id, null).thenApply(json -> null);
	}

	/** {@code GET /v1/worlds/<id>/members} */
	public static CompletableFuture<List<Member>> members(String id) {
		return call("GET", "/v1/worlds/" + id + "/members", null).thenApply(WorldService::parseMembers);
	}

	/** Mitgliederliste aus {@code [{ name, uuid|null, role, added }]} bzw. {@code { members: [...] }} (REST und Steuerverbindung) */
	static List<Member> parseMembers(JsonElement json) {
		JsonArray list = json == null ? new JsonArray() : json.isJsonArray() ? json.getAsJsonArray()
				: array(json.isJsonObject() ? json.getAsJsonObject() : null, "members");
		List<Member> members = new ArrayList<>();
		for (JsonElement element : list) {
			if (!element.isJsonObject()) continue;
			JsonObject object = element.getAsJsonObject();
			String name = string(object, "name");
			if (name == null || !name.matches("^[A-Za-z0-9_]{1,16}$")) continue;
			members.add(new Member(name, Social.uuid(string(object, "uuid")), Role.of(string(object, "role")), number(object, "added")));
		}
		members.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
		return List.copyOf(members);
	}

	/** {@code PUT /v1/worlds/<id>/members/<name>}: Mitglied hinzufügen oder seine Rolle ändern */
	public static CompletableFuture<Void> putMember(String id, String name, Role role) {
		JsonObject body = new JsonObject();
		body.addProperty("role", role.id);
		return call("PUT", "/v1/worlds/" + id + "/members/" + encode(name), body).thenApply(json -> null);
	}

	/** {@code DELETE /v1/worlds/<id>/members/<name>} */
	public static CompletableFuture<Void> removeMember(String id, String name) {
		return call("DELETE", "/v1/worlds/" + id + "/members/" + encode(name), null).thenApply(json -> null);
	}

	/** {@code POST /v1/worlds/<id>/invite}: Freunde einladen (sie werden Mitglied mit der Rolle für Neue) */
	public static CompletableFuture<Void> invite(String id, Collection<UUID> friends) {
		JsonObject body = new JsonObject();
		JsonArray uuids = new JsonArray();
		for (UUID uuid : friends) uuids.add(Social.compact(uuid));
		body.add("uuids", uuids);
		return call("POST", "/v1/worlds/" + id + "/invite", body).thenApply(json -> null);
	}

	private static CompletableFuture<JsonElement> call(String method, String path, JsonObject body) {
		return Social.request(method, path, body, true).handle((json, error) -> {
			if (error == null) return json;
			// CompletionException (join, thenApply) und ExecutionException (get) auspacken
		Throwable cause = error;
		while ((cause instanceof CompletionException || cause instanceof java.util.concurrent.ExecutionException) && cause.getCause() != null) cause = cause.getCause();
			if (cause instanceof Social.ServiceException service && service.status() == 404 && path.equals("/v1/worlds")) {
				throw new CompletionException(new Social.ServiceException(WORLDS_MISSING, 404));
			}
			throw cause instanceof CompletionException completion ? completion : new CompletionException(cause);
		});
	}

	/** Text eines Fehlers für den Spieler */
	public static String message(Throwable error) {
		// CompletionException (join, thenApply) und ExecutionException (get) auspacken
		Throwable cause = error;
		while ((cause instanceof CompletionException || cause instanceof java.util.concurrent.ExecutionException) && cause.getCause() != null) cause = cause.getCause();
		return cause instanceof Social.ServiceException && cause.getMessage() != null ? cause.getMessage() : "Dienst nicht erreichbar";
	}

	private static JsonObject settings(String name, Access access, int maxPlayers, Role defaultRole) {
		JsonObject body = new JsonObject();
		if (name != null) body.addProperty("name", name(name));
		if (access != null) body.addProperty("access", access.id);
		if (maxPlayers > 0) body.addProperty("maxPlayers", Math.clamp(maxPlayers, 1, 20));
		if (defaultRole != null) body.addProperty("defaultRole", defaultRole.id);
		return body;
	}

	private static World requireWorld(JsonElement json) {
		World world = world(json.isJsonObject() && json.getAsJsonObject().has("world") ? json.getAsJsonObject().get("world") : json);
		if (world == null) throw new CompletionException(new Social.ServiceException("Der Heldix-Dienst hat eine ungültige Welt geliefert"));
		return world;
	}

	static World world(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		String id = string(object, "id");
		String address = string(object, "address");
		if (id == null || !WORLD_ID.matcher(id).matches() || address == null || !isAddress(address)) return null;
		String code = string(object, "code");
		JsonObject hostedInfo = object.has("hosted") && object.get("hosted").isJsonObject() ? object.getAsJsonObject("hosted") : null;
		String hosted = hostedInfo == null ? null : string(hostedInfo, "state");
		if (hosted != null && !hosted.matches("^[a-z]{1,16}$")) hosted = "error";
		return new World(id, code, address.toLowerCase(Locale.ROOT), name(string(object, "name")), Access.of(string(object, "access")),
				maxPlayers(object), Role.of(string(object, "defaultRole")), number(object, "created"),
				number(object, "lastOnline"), bool(object, "online"), (int) Math.max(0, number(object, "players")), hostedInfo == null ? null : hosted == null ? "error" : hosted);
	}

	static FriendWorld friendWorld(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		String id = string(object, "id");
		String address = string(object, "address");
		if (id == null || !WORLD_ID.matcher(id).matches() || address == null || !isAddress(address)) return null;
		JsonObject host = object.has("host") && object.get("host").isJsonObject() ? object.getAsJsonObject("host") : new JsonObject();
		String hostName = name(string(host, "name"));
		JsonObject hostedInfo = object.has("hosted") && object.get("hosted").isJsonObject() ? object.getAsJsonObject("hosted") : null;
		String hosted = hostedInfo == null ? null : string(hostedInfo, "state");
		if (hostedInfo != null && (hosted == null || !hosted.matches("^[a-z]{1,16}$"))) hosted = "error";
		// ohne hosted (geteilte Welt) gilt sie als offen, wie bisher
		boolean online = hostedInfo == null || bool(object, "online");
		return new FriendWorld(id, name(string(object, "name")), address.toLowerCase(Locale.ROOT), Social.uuid(string(host, "uuid")), hostName,
				(int) Math.max(0, number(object, "players")), maxPlayers(object), string(object, "version"), hosted, online);
	}

	/** Höchstspieler 1–20 (fehlt die Angabe: 8 wie bei Minecraft) */
	private static int maxPlayers(JsonObject object) {
		long max = number(object, "maxPlayers");
		return max <= 0 ? 8 : Math.clamp(max, 1, 20);
	}

	/** Adresse einer Welt: Hostname (mit optionalem Port), ohne Leerzeichen, höchstens 255 Zeichen */
	private static boolean isAddress(String address) {
		return address.length() <= 255 && address.matches("(?i)^[a-z0-9.-]+(:\\d{1,5})?$");
	}

	/** Name ohne Steuerzeichen und §, höchstens 32 Zeichen (wie beim Dienst) */
	static String name(String raw) {
		if (raw == null) return "Welt";
		String clean = raw.replaceAll("[\\p{Cc}\\p{Cf}§]", "").strip();
		if (clean.codePointCount(0, clean.length()) > 32) clean = clean.substring(0, clean.offsetByCodePoints(0, 32));
		return clean.isEmpty() ? "Welt" : clean;
	}

	private static String encode(String name) {
		return URLEncoder.encode(name.strip(), StandardCharsets.UTF_8).replace("+", "%20");
	}

	private static JsonArray array(JsonObject object, String key) {
		return object != null && object.has(key) && object.get(key).isJsonArray() ? object.getAsJsonArray(key) : new JsonArray();
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}

	private static long number(JsonObject object, String key) {
		JsonElement value = object == null ? null : object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsLong() : 0;
	}

	private static boolean bool(JsonObject object, String key) {
		JsonElement value = object == null ? null : object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() && value.getAsBoolean();
	}
}
