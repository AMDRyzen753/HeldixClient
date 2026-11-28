package dev.heldixclient.share;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Einladungen in Welten von Freunden (Echtzeit-Nachricht {@code world-invite} ab Heldix-Dienst 1.12.0): Toast bzw.
 * Einblendung „<Name> lädt dich in seine Welt ein“ und die Liste für „Heldix-Welten“ im Hauptmenü (dort mit
 * „Beitreten“). Gilt 30 Minuten, höchstens zehn.
 */
public final class WorldInvites {
	/** Einladung: Welt (ID, Name, Adresse) und Gastgeber */
	public record Invite(String worldId, String name, String address, UUID hostUuid, String hostName, long at) {
	}

	private static final long KEEP_MS = 30 * 60_000;
	private static final int MAX = 10;
	private static final List<Invite> RECENT = new CopyOnWriteArrayList<>();
	/** gerade geöffnete Welten von Freunden laut Echtzeit ({@code world-open} / {@code world-closed}), nach ID */
	private static final java.util.Map<String, WorldService.FriendWorld> OPEN = new java.util.concurrent.ConcurrentHashMap<>();
	private static volatile int changes;

	private WorldInvites() {
	}

	/** gerade geöffnete Welten von Freunden (Echtzeit, abgeglichen mit {@code GET /v1/worlds}) */
	public static List<WorldService.FriendWorld> open() {
		return List.copyOf(OPEN.values());
	}

	/** zählt jede Änderung an geöffneten Welten und Einladungen (zum Neuladen von Heldix-Welten) */
	public static int changes() {
		return changes;
	}

	/** Stand von {@code GET /v1/worlds} übernehmen (Echtzeit-Meldungen können bei einer Trennung fehlen) */
	public static void syncOpen(List<WorldService.FriendWorld> worlds) {
		OPEN.clear();
		for (WorldService.FriendWorld world : worlds) OPEN.put(world.id(), world);
	}

	/** {@code { type: 'world-open', world: { id, name, address, host, players, maxPlayers, version } }} (Netzwerk-Thread) */
	public static void onOpen(JsonObject message, boolean notify) {
		WorldService.FriendWorld world = WorldService.friendWorld(message.get("world"));
		if (world == null) return;
		boolean fresh = OPEN.put(world.id(), world) == null;
		changes++;
		if (!fresh || !notify) return;
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> WorldShare.toast(mc, world.hostName() + " hat eine Welt geöffnet",
				"„" + world.name() + "“ · " + (mc.level == null ? "Spielen → Heldix-Welten" : "Hauptmenü → Heldix-Welten")));
	}

	/** {@code { type: 'world-closed', world: { id } }} */
	public static void onClosed(JsonObject message) {
		JsonElement element = message.get("world");
		String id = element != null && element.isJsonObject() ? string(element.getAsJsonObject(), "id") : null;
		if (id != null && OPEN.remove(id) != null) changes++;
	}

	/** Einladungen der letzten 30 Minuten, neueste zuerst */
	public static List<Invite> recent() {
		long now = System.currentTimeMillis();
		RECENT.removeIf(invite -> now - invite.at() > KEEP_MS);
		return List.copyOf(RECENT);
	}

	public static void forget(String worldId) {
		RECENT.removeIf(invite -> invite.worldId().equals(worldId));
	}

	/** Echtzeit {@code { type: 'world-invite', world: { id, name, address, host: { uuid, name } } }} (Netzwerk-Thread) */
	public static void onInvite(JsonObject message, boolean notify) {
		JsonElement element = message.get("world");
		if (element == null || !element.isJsonObject()) return;
		JsonObject world = element.getAsJsonObject();
		String id = string(world, "id");
		String address = string(world, "address");
		if (id == null || !WorldService.WORLD_ID.matcher(id).matches() || address == null || !address.matches("(?i)^[a-z0-9.-]{1,250}(:\\d{1,5})?$")) return;
		JsonObject host = world.has("host") && world.get("host").isJsonObject() ? world.getAsJsonObject("host") : new JsonObject();
		String hostName = WorldService.name(string(host, "name"));
		Invite invite = new Invite(id, WorldService.name(string(world, "name")), address.toLowerCase(Locale.ROOT), Social.uuid(string(host, "uuid")), hostName,
				System.currentTimeMillis());
		RECENT.removeIf(old -> old.worldId().equals(id));
		RECENT.addFirst(invite);
		while (RECENT.size() > MAX) RECENT.removeLast();
		changes++;
		if (!notify) return;
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> WorldShare.toast(mc, hostName + " lädt dich in seine Welt ein",
				mc.level == null ? "Beitreten: Spielen → Heldix-Welten" : "Beitreten: Hauptmenü → Heldix-Welten"));
	}

	/** Nur für automatische Tests: eine Einladung wie vom Dienst verarbeiten */
	public static void testInvite(JsonObject message) {
		onInvite(message, true);
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}
}
