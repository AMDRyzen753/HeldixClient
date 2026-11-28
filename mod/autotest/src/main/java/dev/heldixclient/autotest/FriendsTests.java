package dev.heldixclient.autotest;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.social.Messages;
import dev.heldixclient.social.Party;
import dev.heldixclient.social.PartyPrompt;
import dev.heldixclient.social.Social;
import dev.heldixclient.social.Suggestions;
import dev.heldixclient.status.StatusReporter;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.voice.VoiceLink;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

/**
 * Freunde 2.0 im Client (Heldix-Dienst 1.12.0, Client 0.13.8) mit einer zweiten Spielerin über die Schnittstelle
 * (HTTP und Echtzeit-WebSocket wie in InviteTests/WorldShareTests):
 * <ol>
 *   <li>Favorit (Rechtsklick-Menü), Spitzname und Notiz (nur für dich), eigener Statustext und „Nicht stören“ (die Freundin
 *   sieht beides, keine Einblendung bei „Nicht stören“).</li>
 *   <li>Party: Einladung der Freundin (Einblendung mit Tasten, Ablehnen per Taste, Annehmen auf der Seite Freunde),
 *   Statuszeile {@code party}, Party-Chat in beide Richtungen, Folgen (Einblendung „… ist auf …“, Beitreten per Taste,
 *   „Automatisch folgen“ nie aus einer Welt), Party-Voice (Gruppen-Prüfwert vom Dienst), Leitung übergeben, Entfernen,
 *   Einladen über die Seite Party.</li>
 *   <li>Nachrichten: Beitreten-Karte empfangen (Beitreten mit Bestätigung) und senden, Reaktionen in beide Richtungen,
 *   Antworten (Bezug), Löschen (für beide), „schreibt …“ (gedrosselt).</li>
 *   <li>Profilkarte mit gemeinsamen Freunden, Vorschläge (Freunde von Freunden und aus der Nähe), „zuletzt online“.</li>
 * </ol>
 * Beitreten wird nur gezählt ({@code Party.testNoConnect}), die Testwelt bleibt offen. Die Voice-Gruppe wird nur mit
 * {@code -Dheldixclient.voicechat.testAudio} im Voice Chat geprüft (sonst nur der Prüfwert vom Dienst). Tokens werden nicht
 * geloggt. Ohne Dienst 1.12.0 endet der Test mit der Meldung.
 */
final class FriendsTests {
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
	/** Raum des Autotests im Einzelspieler (-Dheldixclient.voice.testServer, wie in VoiceTests) */
	private static final String TEST_SERVER = "autotest.heldixclient.com";

	private FriendsTests() {
	}

	/** zweite Spielerin über die Schnittstelle, mit Echtzeit-Verbindung (zählt als „im Spiel“) */
	private static final class Player {
		UUID uuid;
		String name;
		String token;
		WebSocket socket;
		final List<JsonObject> messages = new CopyOnWriteArrayList<>();
	}

	static void run(TestContext t) throws Exception {
		if (!t.compute(mc -> Social.online())) {
			t.log("Heldix-Dienst nicht verbunden: Freunde 2.0 übersprungen");
			return;
		}
		if (!t.compute(mc -> Social.friends2())) {
			t.log("Heldix-Dienst ohne Freunde 2.0 (vor 1.12.0): Party, Favoriten, Karten und Vorschläge übersprungen");
			return;
		}
		String base = t.compute(mc -> Social.baseUrl());
		HeldixConfig.Data config = HeldixConfig.get();
		boolean notifications = t.compute(mc -> config.socialNotifications);
		boolean autoFollow = t.compute(mc -> config.partyAutoFollow);
		t.run(mc -> {
			config.socialNotifications = true;
			config.partyAutoFollow = false;
			Party.testNoConnect(true);
		});
		Player lena = null;
		Player vor = null;
		UUID nearby = UUID.nameUUIDFromBytes("OfflinePlayer:Nah_Test".getBytes(StandardCharsets.UTF_8));
		try {
			lena = player(base, "Lena_" + ThreadLocalRandom.current().nextInt(10_000, 100_000));
			befriend(t, base, lena);
			ownInfo(t, base, lena);
			party(t, base, lena);
			messages(t, base, lena);
			vor = player(base, "Vor_" + ThreadLocalRandom.current().nextInt(10_000, 100_000));
			suggestions(t, base, lena, vor, nearby);
			profile(t, lena, vor);
			lastOnline(t, lena);
		} finally {
			Player a = lena;
			Player b = vor;
			t.run(mc -> {
				config.socialNotifications = notifications;
				config.partyAutoFollow = autoFollow;
				Party.testNoConnect(false);
				Suggestions.testForget(nearby);
				Suggestions.testForget(UUID.nameUUIDFromBytes("OfflinePlayer:Kurz_Test".getBytes(StandardCharsets.UTF_8)));
				mc.gui.setScreen(null);
			});
			try {
				if (t.compute(mc -> Party.active())) t.compute(mc -> Party.leave()).get(10, TimeUnit.SECONDS);
			} catch (Exception e) {
				t.log("Freunde 2.0: Party nicht verlassen (" + e + ")");
			}
			try {
				if (t.compute(mc -> Social.me().statusText() != null)) t.run(mc -> Social.setStatusText("", null));
				if (t.compute(mc -> Social.me().dnd())) t.compute(mc -> Social.updateMe("dnd", new com.google.gson.JsonPrimitive(false))).get(10, TimeUnit.SECONDS);
			} catch (Exception e) {
				t.log("Freunde 2.0: Status nicht zurückgesetzt (" + e + ")");
			}
			// eigenen Status wieder wie im Spiel melden (der Test hat einen Server vorgegeben)
			t.run(StatusReporter::refresh);
			for (Player player : new Player[] {a, b}) {
				if (player == null) continue;
				if (player.socket != null) player.socket.abort();
				UUID id = player.uuid;
				try {
					if (t.compute(mc -> Social.isFriend(id))) t.compute(mc -> Social.removeFriend(id)).get(10, TimeUnit.SECONDS);
					else if (t.compute(mc -> Social.outgoing().stream().anyMatch(r -> r.uuid().equals(id)))) t.compute(mc -> Social.cancelRequest(id)).get(10, TimeUnit.SECONDS);
				} catch (Exception e) {
					t.log("Freunde 2.0: Freundschaft nicht gelöst (" + e + ")");
				}
			}
		}
	}

	// ======================================================================================
	// Freundin, Favorit, Spitzname, Notiz, eigener Status, „Nicht stören“
	// ======================================================================================

	private static void befriend(TestContext t, String base, Player player) throws Exception {
		JsonObject friendRequest = new JsonObject();
		String ownName = t.compute(mc -> mc.getUser().getName());
		friendRequest.addProperty("name", ownName);
		request(base, "POST", "/v1/friends/requests", friendRequest, player.token);
		UUID id = player.uuid;
		t.waitSoft(mc -> Social.incoming().stream().anyMatch(r -> r.uuid().equals(id)), 10);
		t.compute(mc -> Social.accept(id)).get(10, TimeUnit.SECONDS);
		t.waitSoft(mc -> Social.friend(id) != null && Social.friend(id).online(), 10);
		t.check("Freunde 2.0: " + player.name + " ist befreundet und online", t.compute(mc -> Social.friend(id) != null && Social.friend(id).online()));
	}

	private static void ownInfo(TestContext t, String base, Player lena) throws Exception {
		UUID id = lena.uuid;
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
		// Rechtsklick-Menü auf der Seite Freunde: Profil, Party, Favorit
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.FRIENDS));
		t.waitTicks(6);
		t.check("Freunde 2.0: Reiter Freunde, Party, Nachrichten, Anfragen, Privatsphäre",
				t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabIds()).equals(List.of("FRIENDS", "PARTY", "MESSAGES", "REQUESTS", "PRIVACY")));
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).openFriendMenuFor(id));
		t.waitTicks(3);
		List<String> labels = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).menuLabels());
		t.check("Rechtsklick-Menü: Profil, In Party einladen, Favorit (" + labels + ")", labels.contains(HeldixMenuScreen.MENU_PROFILE)
				&& labels.contains(HeldixMenuScreen.MENU_PARTY_INVITE) && labels.contains(HeldixMenuScreen.MENU_FAVORITE));
		t.screenshot("freunde2-01-menue");
		int[] favorite = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).menuEntryCenter(HeldixMenuScreen.MENU_FAVORITE));
		t.click(favorite[0], favorite[1]);
		t.waitSoft(mc -> Social.friend(id) != null && Social.friend(id).favorite(), 10);
		t.check("Favorit: gesetzt und oben sortiert", t.compute(mc -> Social.friend(id).favorite() && Social.friends().getFirst().uuid().equals(id)));
		t.check("Favorit: Abschnitt „Favoriten“ auf der Seite Freunde", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows().contains("Section:Favoriten")));

		// Spitzname und Notiz: nur für dich – die Freundin sieht bei sich nichts davon
		t.compute(mc -> Social.setNickname(id, "Lenchen")).get(10, TimeUnit.SECONDS);
		t.compute(mc -> Social.setNote(id, "Kennen uns vom Bauserver")).get(10, TimeUnit.SECONDS);
		t.check("Spitzname und Notiz gespeichert (" + t.compute(mc -> Social.friend(id).shownName()) + ")",
				t.compute(mc -> "Lenchen".equals(Social.friend(id).shownName()) && "Kennen uns vom Bauserver".equals(Social.friend(id).note())));
		JsonObject own = friendEntry(base, lena, ownId);
		t.check("Spitzname/Notiz/Favorit sieht nur man selbst (bei der Freundin leer)", own != null && isNull(own, "nickname") && isNull(own, "note")
				&& !(own.has("favorite") && own.get("favorite").getAsBoolean()));
		t.moveMouse(5, 5);
		t.screenshot("freunde2-02-favorit");

		// eigener Statustext (geht nach einer Sekunde an den Dienst) und „Nicht stören“
		t.run(mc -> Social.setStatusText("Baut eine Burg", null));
		long until = System.currentTimeMillis() + 10_000;
		JsonObject seen = null;
		while (System.currentTimeMillis() < until) {
			seen = friendEntry(base, lena, ownId);
			if (seen != null && "Baut eine Burg".equals(string(seen, "statusText"))) break;
			TestContext.sleep(300);
		}
		t.check("Statustext: die Freundin sieht „Baut eine Burg“", seen != null && "Baut eine Burg".equals(string(seen, "statusText")));
		t.compute(mc -> Social.updateMe("dnd", new com.google.gson.JsonPrimitive(true))).get(10, TimeUnit.SECONDS);
		JsonObject dnd = friendEntry(base, lena, ownId);
		t.check("Nicht stören: bei der Freundin dnd = true", dnd != null && dnd.has("dnd") && dnd.get("dnd").getAsBoolean());
		t.run(mc -> Notifications.clear());
		JsonObject quiet = new JsonObject();
		quiet.addProperty("text", "Psst, nur eine Nachricht");
		request(base, "POST", "/v1/messages/" + Social.compact(ownId), quiet, lena.token);
		t.waitSoft(mc -> Messages.unread(id) >= 1, 10);
		t.waitTicks(10);
		t.check("Nicht stören: Nachricht kommt an, aber ohne Einblendung (" + t.compute(mc -> Notifications.current()) + ")",
				t.compute(mc -> Messages.unread(id) >= 1 && Notifications.current().stream().noneMatch(n -> n.startsWith("Nachricht von"))));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.PRIVACY));
		t.waitTicks(6);
		t.check("Privatsphäre: „Nicht stören“ und „Ist online“-Einblendungen da", t.compute(mc ->
				((HeldixMenuScreen) mc.gui.screen()).describeRows().contains("Section:Dein Status")));
		t.moveMouse(5, 5);
		t.screenshot("freunde2-03-privatsphaere");
		t.compute(mc -> Social.updateMe("dnd", new com.google.gson.JsonPrimitive(false))).get(10, TimeUnit.SECONDS);
		t.run(mc -> Messages.markRead(id));
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Party
	// ======================================================================================

	private static void party(TestContext t, String base, Player lena) throws Exception {
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
		UUID id = lena.uuid;
		JsonObject me = new JsonObject();
		me.addProperty("uuid", Social.compact(ownId));

		// 1. Die Freundin lädt ein: Einblendung mit Tasten im Spiel, Ablehnen per Taste
		t.setScreen(() -> null);
		request(base, "POST", "/v1/party/invite", me, lena.token);
		t.waitSoft(mc -> !Party.invites().isEmpty(), 10);
		t.check("Party: Einladung kommt in Echtzeit an", t.compute(mc -> !Party.invites().isEmpty()));
		t.waitSoft(PartyPrompt::visible, 5);
		t.check("Party: Einblendung „… lädt dich in die Party ein“ mit Tasten", t.compute(PartyPrompt::visible));
		t.screenshot("freunde2-04-party-einladung");
		// Tasten auf den Standard setzen (eine ältere options.txt der Testinstanz kann eine andere Belegung haben)
		t.run(mc -> {
			HeldixClient.knockAllowKey.setKey(HeldixClient.knockAllowKey.getDefaultKey());
			HeldixClient.knockDenyKey.setKey(HeldixClient.knockDenyKey.getDefaultKey());
			net.minecraft.client.KeyMapping.resetMapping();
		});
		int deny = t.compute(mc -> HeldixClient.knockDenyKey.getDefaultKey().getValue());
		t.pressKey(deny);
		t.waitSoft(mc -> Party.invites().isEmpty(), 10);
		t.check("Party: Ablehnen per Taste", t.compute(mc -> Party.invites().isEmpty() && !Party.active()));

		// 2. erneut eingeladen: Annehmen auf der Seite Freunde
		request(base, "POST", "/v1/party/invite", me, lena.token);
		t.waitSoft(mc -> !Party.invites().isEmpty(), 10);
		String partyId = t.compute(mc -> Party.invites().isEmpty() ? null : Party.invites().getLast().party());
		t.check("Party: zweite Einladung da", partyId != null);
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.FRIENDS));
		t.waitTicks(6);
		int[] accept = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).targetCenter("party-accept:" + partyId));
		t.check("Party: Einladung auf der Seite Freunde mit „Annehmen“", accept != null);
		t.click(accept[0], accept[1]);
		t.waitSoft(mc -> Party.active() && Party.party().members().size() == 2, 10);
		t.check("Party: angenommen – zu zweit, Leiterin " + lena.name, t.compute(mc -> Party.active() && Party.party().members().size() == 2
				&& Party.party().leader().equals(id) && !Party.isLeader()));
		t.moveMouse(5, 5);
		t.waitTicks(4);
		t.screenshot("freunde2-05-freunde-mit-party");

		// Statuszeile: party { size, max, leader }
		t.run(StatusReporter::testReport);
		String line = t.compute(mc -> StatusReporter.lastLine());
		t.check("Statuszeile: party mit size 2, max 8, leader false (" + line + ")", line != null && line.contains("\"party\":{\"size\":2,\"max\":8,\"leader\":false}"));

		// 3. Party-Chat in beide Richtungen
		JsonObject hello = new JsonObject();
		hello.addProperty("text", "Hallo Party!");
		request(base, "POST", "/v1/party/chat", hello, lena.token);
		t.waitSoft(mc -> Party.chat().stream().anyMatch(m -> m.text().equals("Hallo Party!")), 10);
		t.check("Party-Chat: Nachricht der Leiterin kommt an", t.compute(mc -> Party.chat().stream().anyMatch(m -> m.text().equals("Hallo Party!"))));
		t.compute(mc -> Party.sendChat("Bin dabei")).get(10, TimeUnit.SECONDS);
		t.check("Party-Chat: eigene Nachricht kommt bei der Leiterin an", waitMessage(lena, m -> "party-chat".equals(string(m, "type"))
				&& m.toString().contains("Bin dabei"), 10));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.PARTY));
		t.waitTicks(6);
		t.check("Seite Party: Mitglieder und Party-Chat", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows().contains("Section:Party-Chat")));
		t.moveMouse(5, 5);
		t.screenshot("freunde2-06-party");
		t.setScreen(() -> null);

		// 4. Folgen: die Leiterin geht auf einen Server – Einblendung, Beitreten per Taste (nur gezählt)
		int joins = t.compute(mc -> Party.testJoins());
		status(lena, "multiplayer", "play.example.net");
		t.waitSoft(mc -> Party.follow() != null, 10);
		t.check("Folgen: party-follow kommt an (" + t.compute(mc -> Party.follow() == null ? "nichts" : Party.follow().target().address()) + ")",
				t.compute(mc -> Party.follow() != null && "play.example.net".equals(Party.follow().target().address())));
		t.waitSoft(PartyPrompt::visible, 5);
		t.check("Folgen: Einblendung „" + lena.name + " ist auf play.example.net“ mit Taste", t.compute(PartyPrompt::visible));
		t.screenshot("freunde2-07-folgen");
		int allow = t.compute(mc -> HeldixClient.knockAllowKey.getDefaultKey().getValue());
		t.pressKey(allow);
		t.waitSoft(mc -> Party.testJoins() > joins, 5);
		t.check("Folgen: Taste tritt bei (" + t.compute(mc -> Party.testLastJoin()) + ")",
				t.compute(mc -> Party.testJoins() == joins + 1 && "play.example.net".equals(Party.testLastJoin())));
		// „Automatisch folgen“ an: aus einer Welt heraus trotzdem nicht von selbst
		t.run(mc -> HeldixConfig.get().partyAutoFollow = true);
		status(lena, "multiplayer", "mc.example.org");
		t.waitSoft(mc -> Party.follow() != null && "mc.example.org".equals(Party.follow().target().address()), 10);
		t.waitTicks(10);
		t.check("Automatisch folgen: nie mitten aus einer Welt (Einblendung statt Beitreten)", t.compute(mc -> Party.testJoins() == joins + 1
				&& Party.follow() != null && !Party.canAutoFollow(mc)));
		t.run(mc -> HeldixConfig.get().partyAutoFollow = false);

		// 5. Party-Voice: beide am selben Ort → Gruppen-Prüfwert vom Dienst
		t.run(mc -> Social.statusChanged("multiplayer", TEST_SERVER));
		status(lena, "multiplayer", TEST_SERVER);
		t.waitSoft(mc -> Party.active() && Party.party().voiceGroup() != null, 10);
		String group = t.compute(mc -> Party.active() ? Party.party().voiceGroup() : null);
		t.check("Party-Voice: Gruppen-Prüfwert vom Dienst (64 Hex, " + (group == null ? "fehlt" : "da") + ")", group != null && group.matches("[0-9a-f]{64}")
				&& group.equals(t.compute(mc -> Party.voiceGroup(TEST_SERVER))));
		if (Boolean.getBoolean("heldixclient.voicechat.testAudio") && t.compute(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED)) {
			t.waitSoft(mc -> group.equals(VoiceLink.joinedGroup()), 10);
			t.check("Party-Voice: Voice Chat nimmt die Gruppe der Party", group.equals(t.compute(mc -> VoiceLink.joinedGroup())));
		} else {
			t.log("Party-Voice: Voice Chat aus – nur der Prüfwert geprüft");
		}

		// 6. Leitung übergeben (die Leiterin gibt sie dir), dann entfernst du sie über die Seite Party
		JsonObject promote = new JsonObject();
		promote.addProperty("uuid", Social.compact(ownId));
		request(base, "POST", "/v1/party/leader", promote, lena.token);
		t.waitSoft(mc -> Party.isLeader(), 10);
		t.check("Party: Leitung übergeben – du leitest", t.compute(mc -> Party.isLeader()));
		t.run(StatusReporter::testReport);
		t.check("Statuszeile: leader true", String.valueOf(t.<String>compute(mc -> StatusReporter.lastLine())).contains("\"leader\":true"));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.PARTY));
		t.waitTicks(6);
		String lenaName = lena.name;
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToPlayer(lenaName));
		t.waitTicks(3);
		int[] kick = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).targetCenter("party-member:Entfernen:" + lenaName));
		t.check("Seite Party: „Entfernen“ bei der Freundin (als Leiter)", kick != null);
		t.click(kick[0], kick[1]);
		t.waitSoft(mc -> !Party.active(), 10);
		t.check("Party: entfernt – die Party löst sich auf", t.compute(mc -> !Party.active()));
		t.check("Party-Voice: ohne Party keine Gruppe mehr", t.compute(mc -> Party.voiceGroup(TEST_SERVER) == null));
		t.check("Party: die Freundin erfährt es (party: null)", waitMessage(lena, m -> "party".equals(string(m, "type")) && isNull(m, "party"), 10));

		// 7. Einladen über die Seite Party (ohne Party: du wirst Leiter), die Freundin lehnt ab
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToPlayer(lenaName));
		t.waitTicks(4);
		int[] invite = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).targetCenter("party-invite:" + lenaName));
		t.check("Seite Party: Freundin mit „Einladen“", invite != null);
		t.click(invite[0], invite[1]);
		t.waitSoft(mc -> Party.active() && Party.party().pending(id), 10);
		t.check("Party: eingeladen über die Seite Party (du leitest, Einladung offen)", t.compute(mc -> Party.isLeader() && Party.party().pending(id)));
		t.check("Party: Einladung kommt bei der Freundin an", waitMessage(lena, m -> "party-invite".equals(string(m, "type")) && m.has("invite")
				&& m.get("invite").isJsonObject(), 10));
		JsonObject state = request(base, "GET", "/v1/party", null, lena.token);
		String invitedTo = state.has("invites") && !state.getAsJsonArray("invites").isEmpty() ? string(state.getAsJsonArray("invites").get(0).getAsJsonObject(), "party") : null;
		if (invitedTo != null) request(base, "POST", "/v1/party/" + invitedTo + "/decline", new JsonObject(), lena.token);
		t.waitSoft(mc -> !Party.active(), 10);
		t.check("Party: abgelehnt – ohne Mitglieder löst sie sich auf", t.compute(mc -> !Party.active()));
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Nachrichten: Karten, Reaktionen, Antworten, Löschen, „schreibt …“
	// ======================================================================================

	private static void messages(TestContext t, String base, Player lena) throws Exception {
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
		UUID id = lena.uuid;
		String path = "/v1/messages/" + Social.compact(ownId);
		t.setScreen(() -> new HeldixMenuScreen(null, id, lena.name));
		t.waitSoft(mc -> !Messages.loading(id), 10);

		// Karte empfangen
		JsonObject cardMessage = new JsonObject();
		cardMessage.addProperty("text", "Komm auf play.example.net");
		JsonObject card = new JsonObject();
		card.addProperty("kind", "server");
		card.addProperty("target", "play.example.net");
		card.addProperty("title", "Beispiel-Server");
		cardMessage.add("card", card);
		long cardId = request(base, "POST", path, cardMessage, lena.token).getAsJsonObject("message").get("id").getAsLong();
		t.waitSoft(mc -> Messages.find(id, cardId) != null, 10);
		Messages.Message received = t.compute(mc -> Messages.find(id, cardId));
		t.check("Karte: kommt mit Art, Ziel und Titel an", received != null && received.card() != null && "server".equals(received.card().kind())
				&& "play.example.net".equals(received.card().target()) && "Beispiel-Server".equals(received.card().title()));
		t.moveMouse(5, 5);
		t.waitTicks(4);
		int[] join = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).targetCenter("card:" + cardId));
		t.check("Karte: Knopf „Beitreten“", join != null);
		int joins = t.compute(mc -> Party.testJoins());
		t.click(join[0], join[1]);
		t.check("Karte: in einer Welt erst bestätigen", t.compute(mc -> Party.testJoins() == joins));
		// Der Knopf zeigt jetzt die Rückfrage (andere Breite) – Position neu holen
		t.waitTicks(3);
		int[] confirm = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).targetCenter("card:" + cardId));
		t.click(confirm[0], confirm[1]);
		t.waitSoft(mc -> Party.testJoins() > joins, 3);
		t.check("Karte: zweiter Klick tritt bei (" + t.compute(mc -> Party.testLastJoin()) + ")",
				t.compute(mc -> Party.testJoins() == joins + 1 && "play.example.net".equals(Party.testLastJoin())));

		// Karte senden („Server/Welt teilen“ ohne Server: Hinweis; per Schnittstelle mit Karte)
		t.clickWidget(HeldixMenuScreen.SHARE_LOCATION_LABEL);
		t.check("Karte senden: im Einzelspieler ohne Teilen ein Hinweis", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows().stream()
				.anyMatch(r -> r.contains("keinem Server"))));
		t.compute(mc -> Messages.send(id, "Komm in meine Welt", 0, new Messages.Card("world", "abcdef", "Insel"))).get(10, TimeUnit.SECONDS);
		JsonObject chat = request(base, "GET", path, null, lena.token);
		t.check("Karte senden: kommt bei der Freundin mit Karte an", chat.toString().contains("\"kind\":\"world\"") && chat.toString().contains("\"target\":\"abcdef\""));

		// Reaktionen in beide Richtungen
		t.compute(mc -> Messages.react(id, cardId, "love")).get(10, TimeUnit.SECONDS);
		t.check("Reaktion: eigene „love“ gesetzt", "love".equals(t.compute(mc -> Messages.ownReaction(Messages.find(id, cardId)))));
		t.check("Reaktion: kommt bei der Freundin an", waitMessage(lena, m -> "reaction".equals(string(m, "type")) && m.toString().contains("love"), 10));
		long mineId = t.compute(mc -> Messages.history(id).stream().filter(Messages.Message::mine).mapToLong(Messages.Message::id).max().orElse(0));
		JsonObject fire = new JsonObject();
		fire.addProperty("reaction", "fire");
		request(base, "PUT", path + "/" + mineId + "/reaction", fire, lena.token);
		t.waitSoft(mc -> Messages.find(id, mineId) != null && "fire".equals(Messages.find(id, mineId).reactions().get(id)), 10);
		t.check("Reaktion der Freundin auf deine Nachricht kommt in Echtzeit", t.compute(mc -> "fire".equals(Messages.find(id, mineId).reactions().get(id))));

		// Antworten: die Freundin antwortet (Bezug), du antwortest über die Leiste und Enter
		JsonObject answer = new JsonObject();
		answer.addProperty("text", "Gern, bin gleich da");
		answer.addProperty("replyTo", mineId);
		long answerId = request(base, "POST", path, answer, lena.token).getAsJsonObject("message").get("id").getAsLong();
		t.waitSoft(mc -> Messages.find(id, answerId) != null, 10);
		t.check("Antwort: Bezug auf deine Nachricht", t.compute(mc -> Messages.find(id, answerId).replyTo() != null && Messages.find(id, answerId).replyTo().id() == mineId));
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).replyToMessage(answerId));
		t.check("Antworten: Leiste „Antwort an …“", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).replying()));
		t.run(mc -> mc.keyboardHandler.textInput(mc.getWindow().handle(), "Super!"));
		t.pressKey(com.mojang.blaze3d.platform.InputConstants.KEY_RETURN);
		t.waitSoft(mc -> Messages.history(id).stream().anyMatch(m -> m.mine() && "Super!".equals(m.text()) && m.replyTo() != null), 10);
		t.check("Antworten: gesendet mit Bezug", t.compute(mc -> Messages.history(id).stream().anyMatch(m -> m.mine() && "Super!".equals(m.text())
				&& m.replyTo() != null && m.replyTo().id() == answerId)));

		// „schreibt …“: Anzeige 6 s, eigenes Senden gedrosselt (höchstens alle 3 s)
		JsonObject typing = new JsonObject();
		typing.addProperty("type", "typing");
		typing.addProperty("to", Social.compact(ownId));
		lena.socket.sendText(typing.toString(), true).get(5, TimeUnit.SECONDS);
		t.waitSoft(mc -> Messages.typing(id), 5);
		t.check("„schreibt …“ der Freundin wird angezeigt", t.compute(mc -> Messages.typing(id)));
		t.moveMouse(5, 5);
		t.screenshot("freunde2-08-chat");
		t.run(mc -> Messages.typed(id));
		long sentAt = t.compute(mc -> Messages.typingSentAt(id));
		t.run(mc -> Messages.typed(id));
		t.check("„schreibt …“ senden: höchstens alle 3 Sekunden", sentAt > 0 && t.compute(mc -> Messages.typingSentAt(id)) == sentAt);
		t.check("„schreibt …“ kommt bei der Freundin an", waitMessage(lena, m -> "typing".equals(string(m, "type")) && Social.compact(ownId).equals(string(m, "from")), 10));

		// Löschen: eigene für beide; die der Freundin verschwindet in Echtzeit
		t.compute(mc -> Messages.delete(id, mineId)).get(10, TimeUnit.SECONDS);
		t.check("Löschen: eigene Nachricht weg", t.compute(mc -> Messages.find(id, mineId) == null));
		t.check("Löschen: die Freundin bekommt message-deleted", waitMessage(lena, m -> "message-deleted".equals(string(m, "type")), 10));
		t.check("Löschen: der Bezug der Antwort zeigt „gelöscht“", t.compute(mc -> Messages.find(id, answerId) != null && Messages.find(id, answerId).replyTo().deleted()));
		request(base, "DELETE", path + "/" + answerId, null, lena.token);
		t.waitSoft(mc -> Messages.find(id, answerId) == null, 10);
		t.check("Löschen: Nachricht der Freundin verschwindet in Echtzeit", t.compute(mc -> Messages.find(id, answerId) == null));
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Vorschläge, Profilkarte, zuletzt online
	// ======================================================================================

	private static void suggestions(TestContext t, String base, Player lena, Player vor, UUID nearby) throws Exception {
		// Vor ist mit Lena befreundet und erscheint in Vorschlägen
		JsonObject toLena = new JsonObject();
		toLena.addProperty("name", lena.name);
		request(base, "POST", "/v1/friends/requests", toLena, vor.token);
		request(base, "POST", "/v1/friends/requests/" + Social.compact(vor.uuid) + "/accept", new JsonObject(), lena.token);
		JsonObject suggestable = new JsonObject();
		suggestable.addProperty("suggestable", true);
		request(base, "PUT", "/v1/me", suggestable, vor.token);
		t.compute(mc -> Suggestions.load()).get(10, TimeUnit.SECONDS);
		t.check("Vorschläge: " + vor.name + " mit 1 gemeinsamen Freund", t.compute(mc -> Suggestions.server().stream()
				.anyMatch(s -> s.uuid().equals(vor.uuid) && s.mutual() == 1)));
		// aus der Nähe (nur lokal): mindestens 10 Minuten
		t.run(mc -> Suggestions.testNearby(nearby, "Nah_Test", 12));
		t.check("Vorschläge aus der Nähe: ab 10 Minuten", t.compute(mc -> Suggestions.nearby().stream().anyMatch(n -> n.uuid().equals(nearby))));
		t.run(mc -> Suggestions.testNearby(UUID.nameUUIDFromBytes("OfflinePlayer:Kurz_Test".getBytes(StandardCharsets.UTF_8)), "Kurz_Test", 4));
		t.check("Vorschläge aus der Nähe: unter 10 Minuten nicht", t.compute(mc -> Suggestions.nearby().stream().noneMatch(n -> n.name().equals("Kurz_Test"))));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.FRIENDS));
		t.waitTicks(6);
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToEnd());
		t.moveMouse(5, 5);
		t.waitTicks(4);
		t.check("Seite Freunde: Abschnitt „Vorschläge“", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows().contains("Section:Vorschläge")));
		t.screenshot("freunde2-09-vorschlaege");
		// Anfrage an den Vorschlag (Knopf), Vor nimmt an → gemeinsamer Freund mit Lena
		String vorName = vor.name;
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToPlayer(vorName));
		t.waitTicks(3);
		int[] send = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).targetCenter("suggestion:" + vorName));
		t.check("Vorschlag: Knopf „Anfrage senden“", send != null);
		t.click(send[0], send[1]);
		UUID vorId = vor.uuid;
		t.waitSoft(mc -> Social.outgoing().stream().anyMatch(r -> r.uuid().equals(vorId)), 10);
		t.check("Vorschlag: Anfrage gesendet", t.compute(mc -> Social.outgoing().stream().anyMatch(r -> r.uuid().equals(vorId))));
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
		request(base, "POST", "/v1/friends/requests/" + Social.compact(ownId) + "/accept", new JsonObject(), vor.token);
		t.waitSoft(mc -> Social.isFriend(vorId), 10);
		t.check("Vorschlag: angenommen, jetzt befreundet", t.compute(mc -> Social.isFriend(vorId)));
		t.setScreen(() -> null);
	}

	private static void profile(TestContext t, Player lena, Player vor) throws Exception {
		UUID id = lena.uuid;
		Social.Profile profile = t.compute(mc -> Social.profile(id)).get(10, TimeUnit.SECONDS);
		t.check("Profilkarte: gemeinsame Freunde (" + profile.mutual().stream().map(Social.Mutual::name).toList() + ")",
				profile.mutual().stream().anyMatch(m -> m.uuid().equals(vor.uuid)));
		t.check("Profilkarte: befreundet seit", profile.friend().since() > 0);
		t.setScreen(() -> HeldixMenuScreen.profile(null, id));
		t.waitTicks(10);
		t.check("Profilkarte offen mit Aktionen (Nachricht, Party, Favorit)", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu
				&& id.equals(menu.openProfileId()) && menu.targetCenter("profile:Nachricht") != null && menu.targetCenter("profile:In Party einladen") != null));
		t.moveMouse(5, 5);
		t.screenshot("freunde2-10-profil");
		t.setScreen(() -> null);
	}

	private static void lastOnline(TestContext t, Player lena) throws Exception {
		UUID id = lena.uuid;
		lena.socket.abort();
		lena.socket = null;
		t.waitSoft(mc -> Social.friend(id) != null && !Social.friend(id).online(), 15);
		t.waitSoft(mc -> Social.friend(id) != null && Social.friend(id).lastOnline() > 0, 5);
		// kam es nicht mit der Echtzeit-Meldung: die Profilkarte holt den Stand des Dienstes
		if (!t.compute(mc -> Social.friend(id) != null && Social.friend(id).lastOnline() > 0)) t.compute(mc -> Social.profile(id)).get(10, TimeUnit.SECONDS);
		String text = t.compute(mc -> Social.friend(id) == null ? null : Social.friend(id).lastOnlineText());
		t.check("Zuletzt online: „" + text + "“", text != null && text.startsWith("zuletzt online vor "));
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static Player player(String base, String name) throws Exception {
		Player player = new Player();
		player.name = name;
		player.uuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
		JsonObject login = new JsonObject();
		login.addProperty("name", name);
		login.addProperty("uuid", Social.compact(player.uuid));
		player.token = request(base, "POST", "/v1/auth/dev", login, null).get("token").getAsString();
		player.socket = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + player.token)
				.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/ws"), new WebSocket.Listener() {
					private final StringBuilder buffer = new StringBuilder();

					@Override
					public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
						buffer.append(data);
						if (last) {
							try {
								JsonElement element = JsonParser.parseString(buffer.toString());
								if (element.isJsonObject()) player.messages.add(element.getAsJsonObject());
							} catch (RuntimeException ignored) {
								// unlesbar: für den Test egal
							}
							buffer.setLength(0);
						}
						webSocket.request(1);
						return null;
					}
				}).get(10, TimeUnit.SECONDS);
		status(player, "menu", null);
		return player;
	}

	/** Status der Spielerin wie aus dem Spiel ({@code { type: 'status', state, server }}) */
	private static void status(Player player, String state, String server) throws Exception {
		JsonObject status = new JsonObject();
		status.addProperty("type", "status");
		status.addProperty("state", state);
		if (server == null) status.add("server", com.google.gson.JsonNull.INSTANCE);
		else status.addProperty("server", server);
		player.socket.sendText(status.toString(), true).get(5, TimeUnit.SECONDS);
	}

	/** Eintrag eines Spielers in der Freundesliste der Spielerin (GET /v1/friends mit ihrem Token) */
	private static JsonObject friendEntry(String base, Player player, UUID friend) throws Exception {
		JsonObject list = request(base, "GET", "/v1/friends", null, player.token);
		if (!list.has("friends") || !list.get("friends").isJsonArray()) return null;
		for (JsonElement element : list.getAsJsonArray("friends")) {
			if (element.isJsonObject() && Social.compact(friend).equals(string(element.getAsJsonObject(), "uuid"))) return element.getAsJsonObject();
		}
		return null;
	}

	/** Wartet auf eine Echtzeit-Nachricht bei der Spielerin */
	private static boolean waitMessage(Player player, Predicate<JsonObject> match, int seconds) {
		long until = System.currentTimeMillis() + seconds * 1000L;
		while (System.currentTimeMillis() < until) {
			for (JsonObject message : player.messages) if (match.test(message)) return true;
			TestContext.sleep(100);
		}
		return false;
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}

	private static boolean isNull(JsonObject object, String key) {
		return object != null && (!object.has(key) || object.get(key).isJsonNull());
	}

	/** Anfrage an den Dienst; Fehler mit Status, ohne Token im Text */
	private static JsonObject request(String base, String method, String path, JsonObject body, String token) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10))
				.header("Content-Type", "application/json")
				.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
		if (token != null) request.header("Authorization", "Bearer " + token);
		HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		if (response.statusCode() >= 400) throw new IllegalStateException(method + " " + path + ": " + response.statusCode() + " " + response.body());
		String text = response.body();
		if (text == null || text.isBlank()) return new JsonObject();
		JsonElement element = JsonParser.parseString(text);
		return element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
	}
}
