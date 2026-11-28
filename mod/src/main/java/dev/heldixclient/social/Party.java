package dev.heldixclient.social;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.hud.Notifications;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;

/**
 * Party mit Freunden (ab Heldix-Dienst 1.12.0, Protokoll in docs/dienst.md „Party“): bis zu 8 Freunde, ein Leiter. Die
 * Party lebt nur im Speicher des Dienstes; hier steht der zuletzt gemeldete Stand ({@code party}, {@code party-invite},
 * {@code party-chat}, {@code party-follow} über die Echtzeit-Verbindung, beim Verbinden {@code GET /v1/party}).
 *
 * <p>Folgen: Wechselt der Leiter den Ort, meldet der Dienst {@code party-follow}. Im Spiel erscheint „<Leiter> ist auf
 * <Ziel>“ mit der Taste zum Beitreten ({@link PartyPrompt}); mit „Automatisch folgen“ geht es von selbst – aber nur aus
 * dem Hauptmenü bzw. den Menüs ohne Welt, nie mitten aus einer Welt (dort bleibt es bei der Einblendung, die Taste ist die
 * Bestätigung). Party-Voice: Den Gruppen-Prüfwert des Dienstes ({@code party.voice}) nimmt der Voice Chat, solange keine
 * eigene Gruppe gesetzt ist ({@link dev.heldixclient.voice.VoiceLink}).
 *
 * <p>Echtzeit-Nachrichten kommen im Netzwerk-Thread, die Oberfläche liest im Haupt-Thread: alles unveränderlich bzw.
 * threadsicher; Aktionen mit Folgen in Minecraft (Beitreten) laufen über {@code mc.execute}.
 */
public final class Party {
	/** höchstens so viele Mitglieder (Dienst: partyMaxMembers) und Zeichen im Party-Chat */
	public static final int MAX_MEMBERS = 8;
	public static final int CHAT_MAX = 500;
	/** Einblendungen im Spiel: so lange sichtbar (die Einladung selbst gilt 10 Minuten) */
	private static final long PROMPT_MS = 30_000;
	/** so lange gilt ein „Folgen“, auf das man noch reagieren kann */
	private static final long FOLLOW_MS = 5 * 60_000;
	private static final Pattern PARTY_ID = Pattern.compile("^[0-9a-f]{32}$");
	private static final Pattern GROUP = Pattern.compile("^[0-9a-f]{64}$");
	private static final Pattern ADDRESS = Pattern.compile("(?i)^[a-z0-9.-]{1,253}(:\\d{1,5})?$");

	/** Ort eines Mitglieds bzw. Ziel des Leiters: kind "server" oder "world"; address zum Beitreten; gleiche address = gleicher Ort */
	public record Location(String kind, String target, String address, String title) {
		public boolean world() {
			return "world".equals(kind);
		}

		/** „mc.example.de“ bzw. „Welt „Insel““ */
		public String shown() {
			return world() ? "Welt „" + title + "“" : title;
		}
	}

	public record Member(UUID uuid, String name, boolean leader, boolean online, boolean away, long awayUntil, String state, Location location, long joined) {
		/** Wo das Mitglied ist, für die Anzeige */
		public String where() {
			if (away) return "Kurz weg";
			if (!online) return "Nicht im Spiel";
			if (location != null) return location.world() ? "In der Welt „" + location.title() + "“" : "Auf " + location.title();
			if (state == null) return "Im Spiel";
			return switch (state) {
				case "menu" -> "Im Hauptmenü";
				case "singleplayer" -> "Einzelspieler";
				case "multiplayer" -> "Auf einem Server";
				case "realms" -> "Auf Realms";
				case "lan" -> "Im LAN";
				default -> "Im Spiel";
			};
		}
	}

	/** Offene Einladung in die eigene Party (sieht jedes Mitglied; zurückziehen kann der Leiter) */
	public record Pending(UUID uuid, String name, UUID by, long at, long expires) {
	}

	/** Stand der Party; voiceGroup/voiceServer nur, wenn ein anderes Mitglied am selben Ort ist (sonst null) */
	public record State(String id, UUID leader, long created, int max, List<Member> members, List<Pending> invites, Location target,
			String voiceGroup, String voiceServer) {
		public Member member(UUID uuid) {
			for (Member member : members) if (member.uuid().equals(uuid)) return member;
			return null;
		}

		public Member leaderMember() {
			return member(leader);
		}

		public boolean pending(UUID uuid) {
			for (Pending pending : invites) if (pending.uuid().equals(uuid)) return true;
			return false;
		}
	}

	/** Einladung an dich; quiet = ohne Einblendung (bei „Nicht stören“) */
	public record Invite(String party, UUID fromUuid, String fromName, UUID leaderUuid, String leaderName, int members, long at, long expires,
			boolean quiet) {
	}

	public record ChatMessage(long id, UUID from, String name, String text, long at) {
		public boolean mine() {
			return from != null && from.equals(Minecraft.getInstance().getUser().getProfileId());
		}
	}

	/** Der Leiter ist an einen neuen Ort gewechselt */
	public record Follow(String party, UUID leaderUuid, String leaderName, Location target, long at) {
	}

	/** Einblendung im Spiel: entweder Folgen oder eine Einladung */
	public record Prompt(Follow follow, Invite invite) {
	}

	private static volatile State party;
	private static volatile List<Invite> invites = List.of();
	private static final List<ChatMessage> CHAT = new CopyOnWriteArrayList<>();
	private static volatile Follow follow;
	/** Einladungen/Folgen, die man mit Taste oder Klick ausgeblendet hat (Party-ID bzw. Folgen) */
	private static volatile String dismissedInvite;
	private static volatile Follow dismissedFollow;
	/** neueste Einladung mit Einblendung: wann sie kam */
	private static volatile long inviteShownAt;
	private static volatile int unreadChat;
	private static volatile boolean viewingChat;
	/** Dienst kennt keine Party (vor 1.12.0: 404) */
	private static volatile boolean missing;
	/** man hat selbst „Verlassen“ gedrückt: kein Hinweis „Du bist nicht mehr in der Party“ */
	private static volatile boolean leaving;
	/** zählt jede Änderung (zum Neuaufbau der Oberfläche) */
	private static volatile int changes;
	/** Autotest: wie oft automatisch gefolgt bzw. beigetreten wurde, mit Ziel */
	private static volatile int joins;
	private static volatile String lastJoin;
	/** Autotest: Beitreten nur zählen, nicht wirklich verbinden */
	private static volatile boolean testNoConnect;

	private Party() {
	}

	// ======================================================================================
	// Für die Oberfläche
	// ======================================================================================

	/** Gibt es die Party beim Dienst? (Dienst verbunden, ab 1.12.0) */
	public static boolean available() {
		return Social.friends2() && !missing;
	}

	public static State party() {
		return party;
	}

	public static boolean active() {
		return party != null;
	}

	public static List<Invite> invites() {
		long now = System.currentTimeMillis();
		return invites.stream().filter(i -> i.expires() <= 0 || i.expires() > now).toList();
	}

	public static List<ChatMessage> chat() {
		return List.copyOf(CHAT);
	}

	public static int unreadChat() {
		return unreadChat;
	}

	public static int changes() {
		return changes;
	}

	/** Bin ich der Leiter? */
	public static boolean isLeader() {
		State p = party;
		return p != null && p.leader().equals(self());
	}

	/** Ist dieser Spieler in der Party bzw. eingeladen? */
	public static boolean contains(UUID uuid) {
		State p = party;
		return p != null && (p.member(uuid) != null || p.pending(uuid));
	}

	/** Darf ich diesen Freund einladen? (keine Party = ich werde Leiter; sonst nur als Leiter, nicht voll, noch nicht dabei) */
	public static boolean canInvite(UUID friend) {
		if (!available() || friend == null) return false;
		State p = party;
		if (p == null) return true;
		return p.leader().equals(self()) && !contains(friend) && p.members().size() < p.max();
	}

	/** Party-Chat ist offen: neue Nachrichten gelten als gelesen */
	public static void setViewingChat(boolean viewing) {
		viewingChat = viewing;
		if (viewing) unreadChat = 0;
	}

	/** Das letzte „Folgen“ (Ziel des Leiters), solange man nicht schon dort ist */
	public static Follow follow() {
		Follow f = follow;
		if (f == null || System.currentTimeMillis() - f.at() > FOLLOW_MS) return null;
		return atLocation(f.target()) ? null : f;
	}

	/** Ziel des Leiters, wenn man nicht selbst dort ist (für „Zum Leiter“), sonst null */
	public static Location leaderTarget() {
		State p = party;
		if (p == null || p.target() == null || p.leader().equals(self())) return null;
		return atLocation(p.target()) ? null : p.target();
	}

	/** Bin ich schon an diesem Ort? (eigener Ort laut Dienst bzw. der Server, auf dem man gerade ist) */
	public static boolean atLocation(Location location) {
		if (location == null) return false;
		State p = party;
		Member me = p == null ? null : p.member(self());
		if (me != null && me.location() != null && me.location().address().equalsIgnoreCase(location.address())) return true;
		String here = currentAddress(Minecraft.getInstance());
		return here != null && here.equals(normalize(location.address()));
	}

	/** Voice-Gruppe der Party für diesen Raum-Server (64 Hex-Zeichen), sonst null */
	public static String voiceGroup(String server) {
		State p = party;
		if (p == null || p.voiceGroup() == null || server == null) return null;
		if (p.voiceServer() != null && !normalize(p.voiceServer()).equals(normalize(server))) return null;
		return p.voiceGroup();
	}

	/** Für die Statuszeile: {@code { size, max, leader }} (leader = du bist Leiter), sonst null */
	public static JsonObject statusJson() {
		State p = party;
		if (p == null) return null;
		JsonObject json = new JsonObject();
		json.addProperty("size", p.members().size());
		json.addProperty("max", p.max());
		json.addProperty("leader", p.leader().equals(self()));
		return json;
	}

	/** Gerade gezeigte Einblendung (Folgen vor Einladung), sonst null */
	public static Prompt prompt() {
		long now = System.currentTimeMillis();
		Follow f = follow();
		if (f != null && f != dismissedFollow && now - f.at() < PROMPT_MS && !Social.quiet()) return new Prompt(f, null);
		List<Invite> open = invites();
		if (!open.isEmpty()) {
			Invite newest = open.getLast();
			if (!newest.quiet() && !Social.quiet() && !newest.party().equals(dismissedInvite) && now - inviteShownAt < PROMPT_MS) {
				return new Prompt(null, newest);
			}
		}
		return null;
	}

	/** Taste „annehmen“ (ohne Anklopfen): Folgen bzw. Einladung annehmen – die Taste ist die Bestätigung */
	public static boolean promptYes(Minecraft mc) {
		Prompt prompt = prompt();
		if (prompt == null) return false;
		if (prompt.follow() != null) {
			dismissedFollow = prompt.follow();
			join(mc, prompt.follow().target());
		} else {
			dismissedInvite = prompt.invite().party();
			accept(prompt.invite().party()).whenComplete((ok, error) -> mc.execute(() -> {
				if (error != null) notify(mc, "Party", Invites.message(error));
				else notify(mc, "Party beigetreten", "Du bist jetzt in der Party von " + prompt.invite().leaderName() + ".");
			}));
		}
		return true;
	}

	/** Taste „ablehnen“: Einladung ablehnen bzw. Folgen ausblenden */
	public static boolean promptNo(Minecraft mc) {
		Prompt prompt = prompt();
		if (prompt == null) return false;
		if (prompt.follow() != null) dismissedFollow = prompt.follow();
		else {
			dismissedInvite = prompt.invite().party();
			decline(prompt.invite().party());
		}
		return true;
	}

	// ======================================================================================
	// Anfragen an den Dienst
	// ======================================================================================

	/** Stand holen ({@code GET /v1/party}): Party mit den letzten 50 Chat-Nachrichten und Einladungen */
	static void load() {
		try {
			JsonObject json = Social.call("GET", "/v1/party", null, true);
			missing = false;
			applyParty(json.get("party"), null, true);
			applyInvites(json);
			JsonElement element = json.get("party");
			if (element != null && element.isJsonObject()) {
				List<ChatMessage> list = new ArrayList<>();
				for (JsonElement entry : Social.array(element.getAsJsonObject(), "chat")) {
					ChatMessage message = chatMessage(entry);
					if (message != null) list.add(message);
				}
				CHAT.clear();
				CHAT.addAll(list.size() > 50 ? list.subList(list.size() - 50, list.size()) : list);
			}
			changes++;
		} catch (Social.ServiceException e) {
			if (e.status() == 404) missing = true;
			HeldixClient.LOGGER.info("Heldix-Dienst: Party nicht geladen ({})", e.getMessage());
		} catch (Exception e) {
			HeldixClient.LOGGER.info("Heldix-Dienst: Party nicht geladen ({})", e.toString());
		}
	}

	/** Neu laden (im Hintergrund), z. B. beim Öffnen der Seite Party */
	public static CompletableFuture<Void> refresh() {
		return run(Party::load);
	}

	/** Freund einladen ({@code POST /v1/party/invite}); ohne Party entsteht eine, du bist Leiter */
	public static CompletableFuture<Void> invite(UUID friend) {
		JsonObject body = new JsonObject();
		body.addProperty("uuid", Social.compact(friend));
		return run(() -> applyParty(Social.call("POST", "/v1/party/invite", body, true).get("party"), null, false));
	}

	/** Einladung zurückziehen (Leiter) */
	public static CompletableFuture<Void> revoke(UUID friend) {
		return run(() -> applyParty(Social.call("DELETE", "/v1/party/invites/" + Social.compact(friend), null, true).get("party"), null, false));
	}

	/** Einladung annehmen: eine alte Party wird dabei verlassen; danach den Chat der neuen holen */
	public static CompletableFuture<Void> accept(String partyId) {
		if (!PARTY_ID.matcher(partyId).matches()) return CompletableFuture.failedFuture(new Social.ServiceException("Ungültige Party"));
		return run(() -> {
			applyParty(Social.call("POST", "/v1/party/" + partyId + "/accept", new JsonObject(), true).get("party"), null, false);
			invites = invites.stream().filter(i -> !i.party().equals(partyId)).toList();
			load();
		});
	}

	public static CompletableFuture<Void> decline(String partyId) {
		if (!PARTY_ID.matcher(partyId).matches()) return CompletableFuture.failedFuture(new Social.ServiceException("Ungültige Party"));
		return run(() -> applyInvites(Social.call("POST", "/v1/party/" + partyId + "/decline", new JsonObject(), true)));
	}

	public static CompletableFuture<Void> leave() {
		leaving = true;
		return run(() -> {
			try {
				Social.call("POST", "/v1/party/leave", new JsonObject(), true);
				applyParty(null, "left", false);
			} finally {
				leaving = false;
			}
		});
	}

	/** Mitglied entfernen (Leiter) */
	public static CompletableFuture<Void> kick(UUID member) {
		return run(() -> applyParty(Social.call("DELETE", "/v1/party/members/" + Social.compact(member), null, true).get("party"), null, false));
	}

	/** Leitung übergeben (Leiter) */
	public static CompletableFuture<Void> promote(UUID member) {
		JsonObject body = new JsonObject();
		body.addProperty("uuid", Social.compact(member));
		return run(() -> applyParty(Social.call("POST", "/v1/party/leader", body, true).get("party"), null, false));
	}

	/** Nachricht in den Party-Chat (höchstens 500 Zeichen; zählt zur Grenze von 20 Nachrichten je Minute) */
	public static CompletableFuture<Void> sendChat(String text) {
		JsonObject body = new JsonObject();
		body.addProperty("text", text.strip());
		return run(() -> {
			ChatMessage message = chatMessage(Social.call("POST", "/v1/party/chat", body, true).get("message"));
			if (message != null) addChat(message);
		});
	}

	// ======================================================================================
	// Echtzeit (Netzwerk-Thread)
	// ======================================================================================

	/** {@code { type: 'party', party }} bzw. {@code { type: 'party', party: null, reason }} */
	static void onParty(JsonObject message) {
		missing = false;
		applyParty(message.get("party"), Social.string(message, "reason"), true);
	}

	/** {@code { type: 'party-invite', invite: PartyInvite|null, invites }}: neue Einladung → Einblendung (außer quiet) */
	static void onInvite(JsonObject message) {
		missing = false;
		applyInvites(message);
		JsonElement element = message.get("invite");
		Invite invite = element != null && element.isJsonObject() ? invite(element.getAsJsonObject()) : null;
		if (invite == null || invite.quiet() || Social.quiet()) return;
		inviteShownAt = System.currentTimeMillis();
		dismissedInvite = null;
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> {
			// im Spiel zeigt PartyPrompt die Einladung mit den Tasten; in Menüs ohne Welt ein Toast
			if (mc.level == null) {
				Invites.toast(mc, invite.fromName() + " lädt dich in die Party ein",
						invite.members() + (invite.members() == 1 ? " Mitglied" : " Mitglieder") + " · Annehmen: Heldix-Menü → Freunde → Party");
			}
		});
	}

	/** {@code { type: 'party-chat', party, message }} (auch die eigenen) */
	static void onChat(JsonObject message) {
		State p = party;
		String id = Social.string(message, "party");
		ChatMessage chat = chatMessage(message.get("message"));
		if (chat == null || p == null || !p.id().equals(id)) return;
		if (!addChat(chat) || chat.mine()) return;
		if (!viewingChat) unreadChat++;
		if (!viewingChat && !Social.quiet()) {
			Minecraft mc = Minecraft.getInstance();
			mc.execute(() -> {
				if (mc.level != null) Notifications.show("party-chat", "Party · " + chat.name(), chat.text(), null);
			});
		}
	}

	/** {@code { type: 'party-follow', party, leader, target }}: der Leiter ist an einem neuen Ort */
	static void onFollow(JsonObject message) {
		State p = party;
		String id = Social.string(message, "party");
		JsonObject leader = message.has("leader") && message.get("leader").isJsonObject() ? message.getAsJsonObject("leader") : new JsonObject();
		Location target = location(message.get("target"));
		if (p == null || !p.id().equals(id) || target == null) return;
		Follow next = new Follow(id, Social.uuid(Social.string(leader, "uuid")), name(Social.string(leader, "name")), target, System.currentTimeMillis());
		follow = next;
		changes++;
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> {
			if (atLocation(target)) return;
			if (HeldixConfig.get().partyAutoFollow && canAutoFollow(mc)) {
				dismissedFollow = next;
				join(mc, target);
				return;
			}
			if (mc.level == null && !Social.quiet()) {
				Invites.toast(mc, next.leaderName() + " ist " + (target.world() ? "in der " + target.shown() : "auf " + target.title()),
						"Beitreten: Heldix-Menü → Freunde → Party");
			}
		});
	}

	// ======================================================================================
	// Folgen und Beitreten (Haupt-Thread)
	// ======================================================================================

	/**
	 * „Automatisch folgen“ nur ohne Welt aus einem Menü (Hauptmenü, Heldix-Seiten, Server- und Weltlisten) – nie aus einer
	 * Welt, nicht während einer Verbindung oder eines Ladebildschirms.
	 */
	public static boolean canAutoFollow(Minecraft mc) {
		if (mc.level != null || mc.player != null) return false;
		Screen screen = mc.gui.screen();
		return screen instanceof TitleScreen || screen instanceof dev.heldixclient.screen.ShellScreen
				|| screen instanceof net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
	}

	/** An den Ort gehen (Server bzw. geteilte Welt über ihre Adresse); aus einer Welt heraus wird diese vorher verlassen */
	public static void join(Minecraft mc, Location target) {
		String address = target == null ? null : target.address();
		if (address == null || !ADDRESS.matcher(address).matches() || !ServerAddress.isValidAddress(address)) {
			notify(mc, "Beitreten nicht möglich", "Die Adresse ist ungültig.");
			return;
		}
		joins++;
		lastJoin = address.toLowerCase(Locale.ROOT);
		HeldixClient.LOGGER.info("Party: Beitreten ({})", target.world() ? "geteilte Welt" : "Server");
		if (testNoConnect) return;
		ServerData data = new ServerData(target.title() == null ? address : target.title(), address, ServerData.Type.OTHER);
		if (mc.level != null) mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE);
		ConnectScreen.startConnecting(new TitleScreen(), mc, ServerAddress.parseString(address), data, false, null);
	}

	/** Jeden Tick: abgelaufene Einladungen und altes Folgen vergessen */
	static void tick(Minecraft mc) {
		Follow f = follow;
		if (f != null && System.currentTimeMillis() - f.at() > FOLLOW_MS) follow = null;
	}

	// ======================================================================================
	// Auswertung
	// ======================================================================================

	static void reset() {
		party = null;
		invites = List.of();
		CHAT.clear();
		follow = null;
		unreadChat = 0;
		missing = false;
		changes++;
	}

	/** Neuer Stand; reason (left, removed, dissolved) nur, wenn die Party weg ist; notify = Hinweise zeigen */
	private static void applyParty(JsonElement element, String reason, boolean notify) {
		State before = party;
		State next = element != null && element.isJsonObject() ? state(element.getAsJsonObject()) : null;
		party = next;
		changes++;
		if (next == null) {
			CHAT.clear();
			follow = null;
			unreadChat = 0;
			if (before != null && notify && !leaving && !Social.quiet()) {
				String text = switch (reason == null ? "" : reason) {
					case "removed" -> "Du wurdest aus der Party entfernt.";
					case "dissolved" -> "Die Party hat sich aufgelöst.";
					default -> "Du bist nicht mehr in der Party.";
				};
				notifyAsync("Party beendet", text);
			}
			return;
		}
		if (before == null || !before.id().equals(next.id())) {
			// neue Party: alter Chat und altes Folgen gelten nicht mehr
			CHAT.clear();
			follow = null;
			unreadChat = 0;
			return;
		}
		if (!notify || Social.quiet()) return;
		UUID self = self();
		for (Member member : next.members()) {
			if (before.member(member.uuid()) == null && !member.uuid().equals(self)) notifyAsync("Party", member.name() + " ist der Party beigetreten.");
		}
		if (!before.leader().equals(next.leader()) && next.leader().equals(self)) notifyAsync("Party", "Du leitest jetzt die Party.");
	}

	private static void applyInvites(JsonObject json) {
		if (json == null || !json.has("invites") || !json.get("invites").isJsonArray()) return;
		List<Invite> list = new ArrayList<>();
		for (JsonElement element : json.getAsJsonArray("invites")) {
			if (!element.isJsonObject()) continue;
			Invite invite = invite(element.getAsJsonObject());
			if (invite != null) list.add(invite);
		}
		list.sort(java.util.Comparator.comparingLong(Invite::at));
		invites = List.copyOf(list);
		changes++;
	}

	/** Nachricht anhängen (doppelte nicht), höchstens 50; false = war schon da */
	private static boolean addChat(ChatMessage message) {
		for (ChatMessage known : CHAT) if (known.id() == message.id()) return false;
		CHAT.add(message);
		while (CHAT.size() > 50) CHAT.removeFirst();
		changes++;
		return true;
	}

	private static State state(JsonObject json) {
		String id = Social.string(json, "id");
		UUID leader = Social.uuid(Social.string(json, "leader"));
		if (id == null || !PARTY_ID.matcher(id).matches() || leader == null) return null;
		List<Member> members = new ArrayList<>();
		for (JsonElement element : Social.array(json, "members")) {
			if (!element.isJsonObject()) continue;
			JsonObject object = element.getAsJsonObject();
			UUID uuid = Social.uuid(Social.string(object, "uuid"));
			if (uuid == null) continue;
			members.add(new Member(uuid, name(Social.string(object, "name")), uuid.equals(leader), bool(object, "online"), bool(object, "away"),
					number(object, "awayUntil"), Social.string(object, "state"), location(object.get("location")), number(object, "joined")));
		}
		List<Pending> pending = new ArrayList<>();
		for (JsonElement element : Social.array(json, "invites")) {
			if (!element.isJsonObject()) continue;
			JsonObject object = element.getAsJsonObject();
			UUID uuid = Social.uuid(Social.string(object, "uuid"));
			if (uuid != null) pending.add(new Pending(uuid, name(Social.string(object, "name")), Social.uuid(Social.string(object, "by")),
					number(object, "at"), number(object, "expires")));
		}
		String group = null;
		String server = null;
		JsonElement voice = json.get("voice");
		if (voice != null && voice.isJsonObject()) {
			String value = Social.string(voice.getAsJsonObject(), "group");
			if (value != null && GROUP.matcher(value).matches()) {
				group = value;
				server = Social.string(voice.getAsJsonObject(), "server");
			}
		}
		int max = json.has("max") && json.get("max").isJsonPrimitive() ? Math.clamp(json.get("max").getAsInt(), 2, 64) : MAX_MEMBERS;
		return new State(id, leader, number(json, "created"), max, List.copyOf(members), List.copyOf(pending), location(json.get("target")), group, server);
	}

	private static Invite invite(JsonObject object) {
		String id = Social.string(object, "party");
		if (id == null || !PARTY_ID.matcher(id).matches()) return null;
		JsonObject from = object.has("from") && object.get("from").isJsonObject() ? object.getAsJsonObject("from") : new JsonObject();
		JsonObject leader = object.has("leader") && object.get("leader").isJsonObject() ? object.getAsJsonObject("leader") : from;
		int members = object.has("members") && object.get("members").isJsonPrimitive() ? object.get("members").getAsInt() : 1;
		return new Invite(id, Social.uuid(Social.string(from, "uuid")), name(Social.string(from, "name")), Social.uuid(Social.string(leader, "uuid")),
				name(Social.string(leader, "name")), members, number(object, "at"), number(object, "expires"), bool(object, "quiet"));
	}

	private static Location location(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		String kind = Social.string(object, "kind");
		String address = Social.string(object, "address");
		if (!("server".equals(kind) || "world".equals(kind)) || address == null || !ADDRESS.matcher(address).matches()) return null;
		String target = Social.oneLine(Social.string(object, "target"), 253);
		String title = Social.oneLine(Social.string(object, "title"), 64);
		return new Location(kind, target == null ? address : target, address.toLowerCase(Locale.ROOT), title == null ? address : title);
	}

	private static ChatMessage chatMessage(JsonElement element) {
		if (element == null || !element.isJsonObject()) return null;
		JsonObject object = element.getAsJsonObject();
		String text = Social.string(object, "text");
		if (text == null || !object.has("id")) return null;
		return new ChatMessage(number(object, "id"), Social.uuid(Social.string(object, "from")), name(Social.string(object, "name")),
				Messages.clean(text), number(object, "at"));
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static UUID self() {
		return Minecraft.getInstance().getUser().getProfileId();
	}

	/** Adresse, an der man gerade spielt (klein, ohne :25565), sonst null */
	static String currentAddress(Minecraft mc) {
		if (mc.level == null) return null;
		if (mc.isLocalServer()) {
			String shared = dev.heldixclient.share.WorldShare.voiceServer();
			return shared == null ? null : normalize(shared);
		}
		ServerData server = mc.getCurrentServer();
		return server == null || server.ip == null ? null : normalize(server.ip);
	}

	private static String normalize(String address) {
		String clean = address.trim().toLowerCase(Locale.ROOT);
		return clean.endsWith(":25565") ? clean.substring(0, clean.length() - 6) : clean;
	}

	private static String name(String name) {
		String clean = Social.oneLine(name, 16);
		return clean == null ? "?" : clean;
	}

	private static boolean bool(JsonObject object, String key) {
		JsonElement value = object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() && value.getAsBoolean();
	}

	private static long number(JsonObject object, String key) {
		JsonElement value = object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsLong() : 0;
	}

	private static void notifyAsync(String title, String text) {
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> notify(mc, title, text));
	}

	/** Hinweis: in einer Welt als Einblendung, sonst als Toast (Haupt-Thread) */
	static void notify(Minecraft mc, String title, String text) {
		if (mc.level != null) Notifications.show("party", title, text, null);
		else Invites.toast(mc, title, text);
	}

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
			} catch (Social.ServiceException e) {
				result.completeExceptionally(e.status() == 404 && missing ? new Social.ServiceException(Social.FRIENDS2_MISSING, 404) : e);
			} catch (Exception e) {
				result.completeExceptionally(new Social.ServiceException("Dienst nicht erreichbar"));
			}
		});
		return result;
	}

	// --- für den Autotest ------------------------------------------------------------------------

	/** Test: Beitreten nur zählen statt verbinden (Folgen prüfen, ohne die Testwelt zu verlassen) */
	public static void testNoConnect(boolean value) {
		testNoConnect = value;
	}

	public static int testJoins() {
		return joins;
	}

	public static String testLastJoin() {
		return lastJoin;
	}

	/** Test: Einblendungen wieder zeigen (Folgen und Einladung nicht mehr ausgeblendet) */
	public static void testResetPrompts() {
		dismissedFollow = null;
		dismissedInvite = null;
		inviteShownAt = System.currentTimeMillis();
	}
}
