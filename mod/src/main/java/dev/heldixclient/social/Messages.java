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

	/** Die 8 Reaktionen des Dienstes (REACTIONS in service/src/messages.ts), in dieser Reihenfolge */
	public static final List<String> REACTIONS = List.of("like", "love", "laugh", "wow", "sad", "party", "fire", "eyes");
	/** „schreibt …“: höchstens alle 3 s senden, 6 s nach dem letzten ausblenden (wie beim Dienst) */
	private static final long TYPING_SEND_MS = 3000;
	private static final long TYPING_SHOW_MS = 6000;
	private static final java.util.regex.Pattern WORLD_CODE = java.util.regex.Pattern.compile("^[a-hjkmnp-z2-9]{6}$");
	private static final java.util.regex.Pattern SERVER = java.util.regex.Pattern.compile("(?i)^[a-z0-9.-]{1,253}(:\\d{1,5})?$");

	/** Bezeichnung einer Reaktion (Tooltip, Menü) */
	public static String reactionLabel(String id) {
		return switch (id) {
			case "like" -> "Daumen hoch";
			case "love" -> "Herz";
			case "laugh" -> "Lachen";
			case "wow" -> "Staunen";
			case "sad" -> "Traurig";
			case "party" -> "Party";
			case "fire" -> "Feuer";
			case "eyes" -> "Augen";
			default -> id;
		};
	}

	/** Bezug einer Antwort: Anfang der Nachricht (höchstens 100 Zeichen); gelöscht: from und text null */
	public record Reply(long id, UUID from, String text) {
		public boolean deleted() {
			return text == null;
		}
	}

	/**
	 * Beitreten-Karte: kind "server" (target = Adresse), "world" (Welt-Code, 6 Zeichen) oder "invite" (Einladungs-Code,
	 * 10 Zeichen); title höchstens 60 Zeichen. Der Text der Nachricht bleibt Rückfall für ältere Clients.
	 */
	public record Card(String kind, String target, String title) {
		/** Wie die Karte heißt, wenn kein Titel da ist */
		public String shownTitle() {
			if (title != null && !title.isBlank()) return title;
			return switch (kind) {
				case "world" -> "Heldix-Welt";
				case "invite" -> "Einladung zu HeldixClient";
				default -> target;
			};
		}

		public String kindLabel() {
			return switch (kind) {
				case "world" -> "Geteilte Welt";
				case "invite" -> "Einladung";
				default -> "Server";
			};
		}
	}

	public record Message(long id, UUID from, UUID to, String text, long at, boolean read, Reply replyTo, Card card, Map<UUID, String> reactions) {
		public boolean mine() {
			return from.equals(Minecraft.getInstance().getUser().getProfileId());
		}

		Message withReactions(Map<UUID, String> value) {
			return new Message(id, from, to, text, at, read, replyTo, card, value);
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
	/** „schreibt …“: Freund → bis wann anzeigen; eigene: Freund → zuletzt gesendet */
	private static final Map<UUID, Long> TYPING = new ConcurrentHashMap<>();
	private static final Map<UUID, Long> TYPING_SENT = new ConcurrentHashMap<>();

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
		// neue Nachricht: „schreibt …“ ist vorbei
		TYPING.remove(partner);
		if (partner.equals(viewing)) {
			markRead(partner);
			return;
		}
		Map<UUID, Integer> map = new HashMap<>(unread);
		map.merge(partner, 1, Integer::sum);
		unread = Map.copyOf(map);
		if (!Social.quiet()) {
			Social.Friend friend = Social.friend(partner);
			String shown = friend != null ? friend.shownName() : name != null ? name : "einem Freund";
			String text = message.card() != null ? message.card().kindLabel() + ": " + message.card().shownTitle() : clean(message.text());
			Notifications.show("nachricht-" + partner, "Nachricht von " + shown, text, null);
		}
	}

	/** {@code { type: 'message-deleted', uuid: <Gegenüber>, id }}: für beide weg (auch die Reaktionen) */
	static void onDeleted(JsonObject json) {
		UUID partner = Social.uuid(Social.string(json, "uuid"));
		if (partner == null || !json.has("id") || !json.get("id").isJsonPrimitive()) return;
		removeLocal(partner, json.get("id").getAsLong());
	}

	private static void removeLocal(UUID partner, long id) {
		Chat chat = CHATS.get(partner);
		if (chat != null) {
			synchronized (chat) {
				chat.messages.removeIf(m -> m.id() == id);
				// Antworten darauf zeigen den Bezug als gelöscht
				chat.messages.replaceAll(m -> m.replyTo() != null && m.replyTo().id() == id
						? new Message(m.id(), m.from(), m.to(), m.text(), m.at(), m.read(), new Reply(id, null, null), m.card(), m.reactions()) : m);
			}
		}
		// war es die letzte Nachricht der Unterhaltung: Liste neu laden (dort steht dann die davor)
		for (Conversation c : conversations) {
			if (c.uuid().equals(partner) && c.last().id() == id) {
				loadConversations();
				break;
			}
		}
	}

	/** {@code { type: 'reaction', uuid: <Gegenüber>, id, reactions }} */
	static void onReaction(JsonObject json) {
		UUID partner = Social.uuid(Social.string(json, "uuid"));
		if (partner == null || !json.has("id") || !json.get("id").isJsonPrimitive()) return;
		long id = json.get("id").getAsLong();
		Map<UUID, String> reactions = reactions(json.get("reactions"));
		Chat chat = CHATS.get(partner);
		if (chat == null) return;
		synchronized (chat) {
			chat.messages.replaceAll(m -> m.id() == id ? m.withReactions(reactions) : m);
		}
	}

	/** {@code { type: 'typing', from }}: 6 Sekunden „schreibt …“ zeigen */
	static void onTyping(JsonObject json) {
		UUID from = Social.uuid(Social.string(json, "from"));
		if (from != null) TYPING.put(from, System.currentTimeMillis() + TYPING_SHOW_MS);
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
		TYPING.clear();
		TYPING_SENT.clear();
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
	// „schreibt …“
	// ======================================================================================

	/** Schreibt der Freund gerade (in den letzten 6 Sekunden gemeldet)? */
	public static boolean typing(UUID friend) {
		Long until = friend == null ? null : TYPING.get(friend);
		return until != null && until > System.currentTimeMillis();
	}

	/** Eigenes Tippen melden: höchstens alle 3 Sekunden ({@code { type: 'typing', to }} über die Echtzeit-Verbindung) */
	public static void typed(UUID friend) {
		if (friend == null || !Social.friends2()) return;
		long now = System.currentTimeMillis();
		Long last = TYPING_SENT.get(friend);
		if (last != null && now - last < TYPING_SEND_MS) return;
		JsonObject message = new JsonObject();
		message.addProperty("type", "typing");
		message.addProperty("to", Social.compact(friend));
		if (Social.sendRealtime(message)) TYPING_SENT.put(friend, now);
	}

	/** Nur für automatische Tests: wann zuletzt „schreibt …“ an diesen Freund ging (0 = nie) */
	public static long typingSentAt(UUID friend) {
		return TYPING_SENT.getOrDefault(friend, 0L);
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
		return send(friend, text, 0, null);
	}

	/**
	 * Nachricht senden; {@code replyTo} = ID der Nachricht, auf die geantwortet wird (0 = keine), {@code card} = Beitreten-Karte
	 * (null = keine; ab Dienst 1.12.0). Der Text ist Pflicht und Rückfall für ältere Clients.
	 */
	public static CompletableFuture<Void> send(UUID friend, String text, long replyTo, Card card) {
		JsonObject body = new JsonObject();
		body.addProperty("text", text.strip());
		if (replyTo > 0) body.addProperty("replyTo", replyTo);
		if (card != null) {
			JsonObject object = new JsonObject();
			object.addProperty("kind", card.kind());
			object.addProperty("target", card.target());
			object.addProperty("title", card.title() == null ? "" : card.title());
			body.add("card", object);
		}
		return run(() -> {
			JsonObject json = Social.call("POST", "/v1/messages/" + Social.compact(friend), body, true);
			Message message = message(json.getAsJsonObject("message"));
			if (message == null) return;
			Chat chat = CHATS.computeIfAbsent(friend, id -> new Chat());
			synchronized (chat) {
				if (chat.messages.stream().noneMatch(m -> m.id() == message.id())) chat.messages.add(message);
			}
			updateConversation(friend, null, message);
			TYPING_SENT.remove(friend);
		});
	}

	/** Eigene Nachricht löschen – für beide (ab Dienst 1.12.0) */
	public static CompletableFuture<Void> delete(UUID friend, long id) {
		return run(() -> {
			Social.call("DELETE", "/v1/messages/" + Social.compact(friend) + "/" + id, null, true);
			removeLocal(friend, id);
		});
	}

	/** Reaktion setzen (eine der {@link #REACTIONS}, ersetzt die eigene) bzw. mit null entfernen (ab Dienst 1.12.0) */
	public static CompletableFuture<Void> react(UUID friend, long id, String reaction) {
		JsonObject body = null;
		if (reaction != null) {
			body = new JsonObject();
			body.addProperty("reaction", reaction);
		}
		JsonObject request = body;
		return run(() -> {
			String path = "/v1/messages/" + Social.compact(friend) + "/" + id + "/reaction";
			JsonObject json = Social.call(request != null ? "PUT" : "DELETE", path, request, true);
			Message message = message(json.getAsJsonObject("message"));
			if (message == null) return;
			Chat chat = CHATS.get(friend);
			if (chat == null) return;
			synchronized (chat) {
				chat.messages.replaceAll(m -> m.id() == message.id() ? m.withReactions(message.reactions()) : m);
			}
		});
	}

	/** Eigene Reaktion auf eine Nachricht (null = keine) */
	public static String ownReaction(Message message) {
		return message.reactions().get(Minecraft.getInstance().getUser().getProfileId());
	}

	/** Nachricht im geladenen Verlauf (null = nicht geladen) */
	public static Message find(UUID friend, long id) {
		Chat chat = CHATS.get(friend);
		if (chat == null) return null;
		synchronized (chat) {
			for (Message message : chat.messages) if (message.id() == id) return message;
		}
		return null;
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
				object.has("read") && object.get("read").getAsBoolean(), reply(object.get("replyTo")), card(object.get("card")),
				reactions(object.get("reactions")));
	}

	/** {@code replyTo: { id, from, text } | null} (ab Dienst 1.12.0) */
	private static Reply reply(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		if (!object.has("id") || !object.get("id").isJsonPrimitive()) return null;
		String text = Social.string(object, "text");
		return new Reply(object.get("id").getAsLong(), Social.uuid(Social.string(object, "from")), text == null ? null : clean(text));
	}

	/** {@code card: { kind, target, title } | null} – nur gültige Karten, sonst null (dann bleibt der Text) */
	static Card card(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		String kind = Social.string(object, "kind");
		String target = Social.string(object, "target");
		if (kind == null || target == null) return null;
		target = target.strip().toLowerCase(java.util.Locale.ROOT);
		boolean valid = switch (kind) {
			case "server" -> SERVER.matcher(target).matches();
			case "world" -> WORLD_CODE.matcher(target).matches();
			case "invite" -> Social.INVITE_CODE.matcher(target).matches();
			default -> false;
		};
		if (!valid) return null;
		return new Card(kind, target, Social.oneLine(Social.string(object, "title"), 60));
	}

	/** {@code reactions: { "<uuid>": "<ID>" }} – nur bekannte IDs */
	private static Map<UUID, String> reactions(JsonElement element) {
		if (element == null || !element.isJsonObject()) return Map.of();
		Map<UUID, String> map = new HashMap<>();
		for (Map.Entry<String, JsonElement> entry : element.getAsJsonObject().entrySet()) {
			UUID uuid = Social.uuid(entry.getKey());
			String reaction = entry.getValue().isJsonPrimitive() ? entry.getValue().getAsString() : null;
			if (uuid != null && reaction != null && REACTIONS.contains(reaction)) map.put(uuid, reaction);
		}
		return Map.copyOf(map);
	}
}
