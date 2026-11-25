package dev.heldixclient.social;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.hud.Notifications;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Direktnachrichten zwischen Freunden, Blockieren und Melden über den Heldix-Dienst (siehe docs/dienst.md).
 * Nachrichten liegen höchstens 30 Tage beim Dienst und verschwinden mit der Freundschaft.
 * Verlauf wird erst geladen, wenn ein Chat geöffnet wird; neue Nachrichten kommen über den WebSocket.
 */
public final class Messages {
	/** höchstens so viele Zeichen pro Nachricht (wie beim Dienst) */
	public static final int MAX_LENGTH = 500;

	public record Message(long id, UUID from, UUID to, String text, long at, boolean read) {
		public boolean mine() {
			return from.equals(Minecraft.getInstance().getUser().getProfileId());
		}
	}

	public record Conversation(UUID uuid, String name, Message last, int unread) {
	}

	public record Blocked(UUID uuid, String name, long at) {
	}

	/** Verlauf eines Chats (nur geladene Nachrichten, älteste zuerst) */
	private static final class Chat {
		final List<Message> messages = new ArrayList<>();
		boolean more;
		boolean loaded;
		boolean loading;
	}

	private static final Map<UUID, Chat> CHATS = new ConcurrentHashMap<>();
	private static volatile Map<UUID, Integer> unread = Map.of();
	private static volatile List<Conversation> conversations = List.of();
	private static volatile boolean conversationsLoaded;
	private static volatile List<Blocked> blocked = List.of();
	/** Chat, der gerade offen ist: neue Nachrichten daraus gelten sofort als gelesen */
	private static volatile UUID viewing;

	private Messages() {
	}

	// ======================================================================================
	// Vom Dienst (Social ruft diese Methoden)
	// ======================================================================================

	/** "unread" aus der Freundesliste übernehmen */
	static void applyUnread(JsonObject payload) {
		if (payload == null || !payload.has("unread") || !payload.get("unread").isJsonObject()) return;
		Map<UUID, Integer> map = new HashMap<>();
		for (Map.Entry<String, JsonElement> entry : payload.getAsJsonObject("unread").entrySet()) {
			UUID uuid = Social.uuid(entry.getKey());
			if (uuid != null && entry.getValue().isJsonPrimitive()) map.put(uuid, entry.getValue().getAsInt());
		}
		UUID open = viewing;
		if (open != null) map.remove(open);
		unread = Map.copyOf(map);
	}

	/** Neue Nachricht (auch eigene von einem anderen Gerät) */
	static void onMessage(JsonObject json) {
		Message message = message(json.getAsJsonObject("message"));
		if (message == null) return;
		String name = Social.string(json, "name");
		boolean mine = message.mine();
		UUID partner = mine ? message.to() : message.from();
		Chat chat = CHATS.get(partner);
		if (chat != null) {
			synchronized (chat) {
				if (chat.messages.stream().noneMatch(m -> m.id() == message.id())) chat.messages.add(message);
			}
		}
		updateConversation(partner, name, message);
		if (mine) return;
		if (partner.equals(viewing)) {
			markRead(partner);
			return;
		}
		Map<UUID, Integer> map = new HashMap<>(unread);
		map.merge(partner, 1, Integer::sum);
		unread = Map.copyOf(map);
		if (HeldixConfig.get().socialNotifications) {
			Notifications.show("nachricht-" + partner, "Nachricht von " + (name != null ? name : "einem Freund"), clean(message.text()), null);
		}
	}

	/** Auf einem anderen Gerät gelesen */
	static void onRead(JsonObject json) {
		UUID uuid = Social.uuid(Social.string(json, "uuid"));
		if (uuid == null) return;
		Map<UUID, Integer> map = new HashMap<>(unread);
		map.remove(uuid);
		unread = Map.copyOf(map);
	}

	/** Abgemeldet oder Dienst aus: alles vergessen */
	static void reset() {
		CHATS.clear();
		unread = Map.of();
		conversations = List.of();
		conversationsLoaded = false;
		blocked = List.of();
	}

	private static void updateConversation(UUID partner, String name, Message last) {
		List<Conversation> list = new ArrayList<>(conversations);
		Conversation before = null;
		for (Conversation c : list) if (c.uuid().equals(partner)) before = c;
		if (before != null) list.remove(before);
		String shownName = name != null && !last.mine() ? name : before != null ? before.name() : friendName(partner);
		list.add(new Conversation(partner, shownName, last, 0));
		list.sort(Comparator.comparingLong((Conversation c) -> c.last().at()).reversed());
		conversations = List.copyOf(list);
	}

	private static String friendName(UUID uuid) {
		for (Social.Friend friend : Social.friends()) if (friend.uuid().equals(uuid)) return friend.name();
		return "?";
	}

	// ======================================================================================
	// Für die Oberfläche
	// ======================================================================================

	public static int unreadTotal() {
		int total = 0;
		for (int count : unread.values()) total += count;
		return total;
	}

	public static int unread(UUID uuid) {
		return unread.getOrDefault(uuid, 0);
	}

	public static List<Conversation> conversations() {
		// nur mit aktuellen Freunden (nach dem Entfernen verschwindet der Chat beim Dienst)
		List<Conversation> list = new ArrayList<>();
		for (Conversation c : conversations) {
			if (Social.friends().stream().anyMatch(f -> f.uuid().equals(c.uuid()))) list.add(new Conversation(c.uuid(), c.name(), c.last(), unread(c.uuid())));
		}
		return list;
	}

	public static boolean conversationsLoaded() {
		return conversationsLoaded;
	}

	public static List<Message> history(UUID friend) {
		Chat chat = CHATS.get(friend);
		if (chat == null) return List.of();
		synchronized (chat) {
			return List.copyOf(chat.messages);
		}
	}

	public static boolean hasMore(UUID friend) {
		Chat chat = CHATS.get(friend);
		return chat != null && chat.more;
	}

	public static boolean loading(UUID friend) {
		Chat chat = CHATS.get(friend);
		return chat == null || chat.loading || !chat.loaded;
	}

	public static List<Blocked> blocked() {
		return blocked;
	}

	/** Chat geöffnet (null = keiner): dessen Nachrichten gelten als gelesen */
	public static void setViewing(UUID friend) {
		viewing = friend;
		if (friend != null && unread(friend) > 0) markRead(friend);
	}

	/** Text für die Anzeige: Formatierungszeichen von Minecraft entschärfen */
	public static String clean(String text) {
		return text == null ? "" : text.replace('§', '&');
	}

	// ======================================================================================
	// Anfragen an den Dienst
	// ======================================================================================

	/** Liste der Unterhaltungen (Seite Nachrichten) */
	public static CompletableFuture<Void> loadConversations() {
		return run(() -> {
			JsonObject json = Social.call("GET", "/v1/messages", null, true);
			List<Conversation> list = new ArrayList<>();
			for (JsonElement element : array(json, "conversations")) {
				JsonObject object = element.getAsJsonObject();
				UUID uuid = Social.uuid(Social.string(object, "uuid"));
				Message last = message(object.getAsJsonObject("last"));
				if (uuid == null || last == null) continue;
				list.add(new Conversation(uuid, Social.string(object, "name"), last, object.has("unread") ? object.get("unread").getAsInt() : 0));
			}
			conversations = List.copyOf(list);
			conversationsLoaded = true;
		});
	}

	/** Verlauf laden: die neuesten Nachrichten bzw. ({@code older}) die davor */
	public static CompletableFuture<Void> loadHistory(UUID friend, boolean older) {
		Chat chat = CHATS.computeIfAbsent(friend, id -> new Chat());
		synchronized (chat) {
			if (chat.loading || (older && !chat.more) || (!older && chat.loaded)) return CompletableFuture.completedFuture(null);
			chat.loading = true;
		}
		return run(() -> {
			try {
				String path = "/v1/messages/" + Social.compact(friend) + "?limit=50";
				if (older) {
					synchronized (chat) {
						if (!chat.messages.isEmpty()) path += "&before=" + chat.messages.getFirst().id();
					}
				}
				JsonObject json = Social.call("GET", path, null, true);
				List<Message> page = new ArrayList<>();
				for (JsonElement element : array(json, "messages")) {
					Message message = message(element.getAsJsonObject());
					if (message != null) page.add(message);
				}
				synchronized (chat) {
					for (Message message : page) {
						if (chat.messages.stream().noneMatch(m -> m.id() == message.id())) chat.messages.add(message);
					}
					chat.messages.sort(Comparator.comparingLong(Message::id));
					chat.more = json.has("more") && json.get("more").getAsBoolean();
					chat.loaded = true;
				}
			} finally {
				chat.loading = false;
			}
		});
	}

	public static CompletableFuture<Void> send(UUID friend, String text) {
		JsonObject body = new JsonObject();
		body.addProperty("text", text.strip());
		return run(() -> {
			JsonObject json = Social.call("POST", "/v1/messages/" + Social.compact(friend), body, true);
			Message message = message(json.getAsJsonObject("message"));
			if (message == null) return;
			Chat chat = CHATS.computeIfAbsent(friend, id -> new Chat());
			synchronized (chat) {
				if (chat.messages.stream().noneMatch(m -> m.id() == message.id())) chat.messages.add(message);
			}
			updateConversation(friend, null, message);
		});
	}

	/** Nachrichten eines Freundes als gelesen melden (dem Freund wird das nicht angezeigt) */
	public static void markRead(UUID friend) {
		Map<UUID, Integer> map = new HashMap<>(unread);
		map.remove(friend);
		unread = Map.copyOf(map);
		run(() -> Social.call("POST", "/v1/messages/" + Social.compact(friend) + "/read", null, true));
	}

	public static CompletableFuture<Void> loadBlocked() {
		return run(() -> applyBlocked(Social.call("GET", "/v1/blocks", null, true)));
	}

	/** Spieler blockieren: Freundschaft, Anfragen und Chat sind danach weg */
	public static CompletableFuture<Void> block(UUID uuid) {
		JsonObject body = new JsonObject();
		body.addProperty("uuid", Social.compact(uuid));
		return run(() -> {
			applyBlocked(Social.call("POST", "/v1/blocks", body, true));
			CHATS.remove(uuid);
			conversations = conversations.stream().filter(c -> !c.uuid().equals(uuid)).toList();
			Social.refreshFriends();
		});
	}

	public static CompletableFuture<Void> unblock(UUID uuid) {
		return run(() -> applyBlocked(Social.call("DELETE", "/v1/blocks/" + Social.compact(uuid), null, true)));
	}

	/**
	 * Spieler melden. {@code reason}: spam, harassment, inappropriate oder other. Die letzten Nachrichten des Chats
	 * gehen mit an den Betreiber des Dienstes.
	 */
	public static CompletableFuture<Void> report(UUID uuid, String reason, String note) {
		JsonObject body = new JsonObject();
		body.addProperty("uuid", Social.compact(uuid));
		body.addProperty("reason", reason);
		if (note != null && !note.isBlank()) body.addProperty("note", note.strip());
		return run(() -> Social.call("POST", "/v1/reports", body, true));
	}

	private static void applyBlocked(JsonObject json) {
		List<Blocked> list = new ArrayList<>();
		for (JsonElement element : array(json, "blocked")) {
			JsonObject object = element.getAsJsonObject();
			UUID uuid = Social.uuid(Social.string(object, "uuid"));
			if (uuid != null) list.add(new Blocked(uuid, Social.string(object, "name"), object.has("at") ? object.get("at").getAsLong() : 0));
		}
		blocked = List.copyOf(list);
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private interface Call {
		void run() throws Exception;
	}

	private static CompletableFuture<Void> run(Call call) {
		CompletableFuture<Void> result = new CompletableFuture<>();
		if (!Social.online()) {
			result.completeExceptionally(new Social.ServiceException("Nicht mit dem Heldix-Dienst verbunden"));
			return result;
		}
		Social.NET.execute(() -> {
			try {
				call.run();
				result.complete(null);
			} catch (Exception e) {
				result.completeExceptionally(e instanceof Social.ServiceException ? e : new Social.ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	private static JsonArray array(JsonObject object, String key) {
		return object != null && object.has(key) && object.get(key).isJsonArray() ? object.getAsJsonArray(key) : new JsonArray();
	}

	private static Message message(JsonObject object) {
		if (object == null) return null;
		UUID from = Social.uuid(Social.string(object, "from"));
		UUID to = Social.uuid(Social.string(object, "to"));
		String text = Social.string(object, "text");
		if (from == null || to == null || text == null || !object.has("id")) return null;
		return new Message(object.get("id").getAsLong(), from, to, text, object.has("at") ? object.get("at").getAsLong() : 0,
				object.has("read") && object.get("read").getAsBoolean());
	}
}
