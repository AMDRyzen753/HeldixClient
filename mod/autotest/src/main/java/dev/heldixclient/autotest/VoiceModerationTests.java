package dev.heldixclient.autotest;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.player.PlayerMarkerStore;
import dev.heldixclient.player.PlayerMenu;
import dev.heldixclient.screen.PlayerMenuScreen;
import dev.heldixclient.social.Party;
import dev.heldixclient.social.Social;
import dev.heldixclient.status.StatusReporter;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.voice.VoiceDialogs;
import dev.heldixclient.voice.VoiceLink;
import dev.heldixclient.voice.VoiceModeration;
import dev.heldixclient.voice.VoiceReportScreen;
import dev.heldixclient.voice.VoiceReports;
import dev.heldixclient.voice.VoiceRulesScreen;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.player.RemotePlayer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Autotest der Voice-Moderation (HeldixClient 0.14.0, Addon-API 10, Voice Chat 1.3.0, Heldix-Dienst 1.13.0) gegen den lokalen
 * Dienst im Entwicklungsmodus:
 * <ol>
 *   <li>Lautstärke-Schutz an Testsignalen (im echten Addon, ohne Dienst).</li>
 *   <li>Regeln-Dialog von HeldixClient: öffnet sich, lädt den Text ({@code GET /v1/public/voice/rules}).</li>
 *   <li>Mit Entwicklungs-Routen ({@code /v1/dev/voice/…}, siehe {@link Team}): Regeln veröffentlichen → Close 4012 → das Addon
 *   öffnet den Dialog von selbst → bis zum Ende lesen, „Annehmen“ schickt {@code POST /v1/voice/rules/accept} → sofort neu
 *   verbunden, Aufnahmen aktiv.</li>
 *   <li>Zweite Spielerin über einen Test-WebSocket (wie in {@link VoiceTests}) spricht; ihre Pakete landen im Ringpuffer und im
 *   Lautstärke-Verlauf; Melden über das Spielermenü öffnet den Melde-Dialog, „Melden“ schickt die Meldung und (mit Aufnahmen)
 *   den Clip (Ogg/Opus, vom Dienst geprüft).</li>
 *   <li>Party-Leiter schaltet sie über das Spielermenü für alle stumm: sie bekommt {@code moderated}, wir sehen sie in
 *   {@code peers.silenced} (Symbol über dem Kopf), ihre Rahmen kommen nicht mehr an; danach aufheben.</li>
 *   <li>Mit Entwicklungs-Routen: Sperre durch das Team → {@code banned} und Close 4013 → Hinweis und Statustext; nach dem
 *   Aufheben verbindet der Voice Chat wieder.</li>
 * </ol>
 * Ohne Dienst 1.13.0 (Feature {@code moderation}) endet der Test nach Schritt 1, ohne Entwicklungs-Routen entfallen 3 und 6
 * (Meldung dann ohne Aufnahme). Tokens und Clip-Inhalte werden nicht geloggt.
 */
final class VoiceModerationTests {
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
	/** Raum des Autotests im Einzelspieler (-Dheldixclient.voice.testServer, wie in VoiceTests) */
	private static final String TEST_SERVER = "autotest.heldixclient.com";

	private VoiceModerationTests() {
	}

	/**
	 * Team-Aktionen für den Test über Entwicklungs-Routen des lokalen Dienstes (nur mit HELDIX_DIENST_DEV=1 und nur von diesem
	 * Rechner, wie {@code POST /v1/auth/dev}). Gibt es sie nicht (404), entfallen die Schritte mit Team.
	 */
	private static final class Team {
		private final String base;

		Team(String base) {
			this.base = base;
		}

		/** Regeln veröffentlichen (mit Aufnahmen an/aus) bzw. zurückziehen; liefert die Fassung (0 = keine) */
		int rules(boolean publish, boolean clips) throws Exception {
			JsonObject body = new JsonObject();
			body.addProperty("publish", publish);
			body.addProperty("clips", clips);
			JsonObject answer = request(base, "POST", "/v1/dev/voice/rules", body, null);
			return answer.has("version") && answer.get("version").isJsonPrimitive() ? answer.get("version").getAsInt() : 0;
		}

		void ban(UUID player, int minutes, String reason) throws Exception {
			JsonObject body = new JsonObject();
			body.addProperty("uuid", Social.compact(player));
			body.addProperty("minutes", minutes);
			body.addProperty("reason", reason);
			request(base, "POST", "/v1/dev/voice/ban", body, null);
		}

		void unban(UUID player) throws Exception {
			request(base, "DELETE", "/v1/dev/voice/ban/" + Social.compact(player), null, null);
		}
	}

	/** zweite Spielerin über die Schnittstelle: Echtzeit-Verbindung (online) und Sprachkanal */
	private static final class Voice {
		UUID uuid;
		String name;
		String token;
		WebSocket presence;
		WebSocket socket;
		final ConcurrentLinkedQueue<String> texts = new ConcurrentLinkedQueue<>();
		final ConcurrentLinkedQueue<JsonObject> realtime = new ConcurrentLinkedQueue<>();
		final ConcurrentLinkedQueue<byte[]> fromUs = new ConcurrentLinkedQueue<>();
		final AtomicInteger heard = new AtomicInteger();
		int sequence;
	}

	static void run(TestContext t) throws Exception {
		if (!t.compute(mc -> Social.online())) {
			t.log("Heldix-Dienst nicht verbunden: Voice-Moderation übersprungen");
			return;
		}
		LoadedAddon addon = t.compute(mc -> AddonManager.addons().stream().filter(a -> a.id().equals("voicechat")).findFirst().orElse(null));
		Module module = t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals("voicechat:voicechat")).findFirst().orElse(null));
		if (addon == null || module == null || !addon.isActive()) {
			t.log("Voice Chat nicht geladen: Voice-Moderation übersprungen");
			return;
		}
		Object instance = t.compute(mc -> addon.instance());

		// 1. Lautstärke-Schutz im echten Addon (Begrenzer, Kompression, Dauerlärm, Erholung)
		String guard = (String) invoke(instance, "guardSelfTest");
		t.check("Voice-Moderation: Lautstärke-Schutz an Testsignalen" + (guard == null ? "" : " – " + guard), guard == null);

		String base = t.compute(mc -> Social.baseUrl());
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
		Team team = new Team(base);
		boolean devRoutes;
		try {
			team.rules(false, false);
			devRoutes = true;
		} catch (IllegalStateException e) {
			devRoutes = false;
			t.log("Voice-Moderation: keine Entwicklungs-Routen /v1/dev/voice/… im Dienst – Regeln veröffentlichen, Aufnahme und Sperre übersprungen");
		}
		if (devRoutes) {
			try {
				team.unban(ownId);
			} catch (IllegalStateException e) {
				// keine Sperre: in Ordnung
			}
		}

		t.setScreen(() -> null);
		// Sprachaktivierung (der Testton ist laut genug) – wie in VoiceTests, damit der Test auch allein läuft
		t.run(mc -> module.settings().stream().filter(s -> s.label().equals("Sprechen")).map(s -> (Setting.Choice) s).findFirst()
				.ifPresent(choice -> choice.set().accept(1)));
		t.run(mc -> module.setEnabled(false));
		t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.OFF, 5);
		t.run(mc -> {
			module.setEnabled(true);
			VoiceLink.retryNow();
		});
		t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED, 15);
		if (!t.compute(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED && VoiceLink.features().contains("moderation"))) {
			t.log("Voice-Moderation: Dienst ohne Moderation (vor 1.13.0) oder nicht verbunden (" + t.compute(mc -> VoiceLink.statusText()) + ") – übersprungen");
			t.run(mc -> module.setEnabled(false));
			return;
		}
		t.check("Voice-Moderation: Dienst meldet „moderation“", true);

		Voice her = null;
		RemotePlayer[] remote = new RemotePlayer[1];
		boolean published = false;
		try {
			rulesDialogUnpublished(t);
			if (devRoutes) {
				published = rulesPublished(t, team);
			}
			her = voice(t, base, "Stimme_" + ThreadLocalRandom.current().nextInt(10_000, 100_000), published);
			hearHer(t, her, ownId, remote, instance);
			report(t, her, instance);
			partyMute(t, base, her, ownId, remote[0], instance);
			if (devRoutes) ban(t, team, ownId);
		} finally {
			Voice last = her;
			if (last != null) {
				if (last.socket != null) last.socket.abort();
				if (last.presence != null) last.presence.abort();
			}
			try {
				if (t.compute(mc -> Party.active())) t.compute(mc -> Party.leave()).get(10, TimeUnit.SECONDS);
				if (last != null && t.compute(mc -> Social.isFriend(last.uuid))) t.compute(mc -> Social.removeFriend(last.uuid)).get(10, TimeUnit.SECONDS);
			} catch (Exception e) {
				t.log("Voice-Moderation: Party/Freundschaft nicht gelöst (" + e + ")");
			}
			if (devRoutes) {
				try {
					team.unban(ownId);
					// zurückziehen, damit spätere Tests ohne Zustimmung laufen
					team.rules(false, false);
				} catch (Exception e) {
					t.log("Voice-Moderation: Aufräumen beim Dienst fehlgeschlagen (" + e.getMessage() + ")");
				}
			}
			t.run(mc -> {
				mc.gui.setScreen(null);
				if (remote[0] != null) mc.level.removeEntity(remote[0].getId(), net.minecraft.world.entity.Entity.RemovalReason.DISCARDED);
				StatusReporter.refresh(mc);
				module.setEnabled(false);
			});
		}
	}

	// ======================================================================================
	// Regeln
	// ======================================================================================

	/** Dialog ohne veröffentlichte Regeln: lädt den Standardtext, nur „Schließen“ */
	private static void rulesDialogUnpublished(TestContext t) {
		AtomicReference<Boolean> answer = new AtomicReference<>();
		t.run(mc -> VoiceDialogs.showRules(true, answer::set));
		t.waitSoft(mc -> mc.gui.screen() instanceof VoiceRulesScreen rules && rules.loaded(), 10);
		t.check("Regeln-Dialog: öffnet sich und lädt den Text", t.compute(mc -> mc.gui.screen() instanceof VoiceRulesScreen rules && rules.loaded()
				&& rules.lineCount() > 5));
		t.check("Regeln-Dialog: Text sichtbar (Zeilen im Textbereich, deckende Farbe)", t.compute(mc -> ((VoiceRulesScreen) mc.gui.screen()).linesVisible()));
		t.check("Regeln-Dialog: ohne Veröffentlichung keine Fassung", t.compute(mc -> ((VoiceRulesScreen) mc.gui.screen()).shownVersion() == 0));
		t.moveMouse(5, 5);
		t.screenshot("voice-regeln-01-unveroeffentlicht");
		t.clickWidget(VoiceRulesScreen.CLOSE);
		t.waitSoft(mc -> answer.get() != null, 3);
		t.check("Regeln-Dialog: „Schließen“ ohne Pflicht = true", Boolean.TRUE.equals(answer.get()) && t.compute(mc -> mc.gui.screen() == null));
	}

	/** Regeln veröffentlichen: Close 4012, Dialog von selbst (Voice Chat 1.3.0), bis zum Ende lesen, „Annehmen“, neu verbunden */
	private static boolean rulesPublished(TestContext t, Team team) throws Exception {
		int version = team.rules(true, true);
		t.check("Regeln: veröffentlicht (Fassung " + version + ")", version > 0);
		t.waitSoft(mc -> mc.gui.screen() instanceof VoiceRulesScreen rules && rules.loaded() && rules.shownVersion() == version, 15);
		t.check("Regeln: 4012 → der Voice Chat öffnet den Dialog von selbst (" + t.compute(mc -> VoiceLink.statusText()) + ")",
				t.compute(mc -> mc.gui.screen() instanceof VoiceRulesScreen rules && rules.shownVersion() == version));
		t.check("Regeln: ohne Zustimmung keine Verbindung", t.compute(mc -> VoiceLink.status() != VoiceLink.Status.CONNECTED && VoiceModeration.rulesRequired()));
		t.check("Regeln: veröffentlichter Text sichtbar (Zeilen im Textbereich, deckende Farbe)", t.compute(mc -> ((VoiceRulesScreen) mc.gui.screen()).linesVisible()));
		boolean longText = t.compute(mc -> !((VoiceRulesScreen) mc.gui.screen()).canAccept());
		if (longText) t.log("Regeln: „Annehmen“ erst nach dem Lesen bis zum Ende");
		t.moveMouse(5, 5);
		t.screenshot("voice-regeln-02-zustimmung");
		t.run(mc -> ((VoiceRulesScreen) mc.gui.screen()).scrollToEnd());
		t.waitTicks(2);
		t.check("Regeln: bis zum Ende gelesen – „Annehmen“ geht", t.compute(mc -> ((VoiceRulesScreen) mc.gui.screen()).canAccept()));
		t.clickWidget(VoiceRulesScreen.ACCEPT);
		t.waitSoft(mc -> VoiceModeration.rulesAccepted() == version && !VoiceModeration.rulesRequired(), 10);
		t.check("Regeln: „Annehmen“ schickt accept (Fassung " + t.compute(mc -> VoiceModeration.rulesAccepted()) + ")",
				t.compute(mc -> VoiceModeration.rulesAccepted() == version && !VoiceModeration.rulesRequired()));
		t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED, 15);
		t.check("Regeln: danach sofort neu verbunden", t.compute(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED));
		t.waitSoft(mc -> VoiceModeration.clipsActive(), 5);
		t.check("Regeln: Aufnahmen für Meldungen aktiv (ready.clips)", t.compute(mc -> VoiceModeration.clipsActive()));
		return true;
	}

	// ======================================================================================
	// Zweite Spielerin, Ringpuffer, Melden
	// ======================================================================================

	private static Voice voice(TestContext t, String base, String name, boolean rules) throws Exception {
		Voice her = new Voice();
		her.name = name;
		her.uuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
		JsonObject login = new JsonObject();
		login.addProperty("name", name);
		login.addProperty("uuid", Social.compact(her.uuid));
		her.token = request(base, "POST", "/v1/auth/dev", login, null).get("token").getAsString();
		if (rules) {
			int version = t.compute(mc -> VoiceModeration.rulesVersion());
			JsonObject accept = new JsonObject();
			accept.addProperty("version", version);
			request(base, "POST", "/v1/voice/rules/accept", accept, her.token);
		}
		her.presence = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + her.token)
				.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/ws"), new WebSocket.Listener() {
					private final StringBuilder buffer = new StringBuilder();

					@Override
					public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
						buffer.append(data);
						if (last) {
							try {
								JsonElement element = JsonParser.parseString(buffer.toString());
								if (element.isJsonObject()) her.realtime.add(element.getAsJsonObject());
							} catch (RuntimeException ignored) {
								// unlesbar: für den Test egal
							}
							buffer.setLength(0);
						}
						webSocket.request(1);
						return null;
					}
				}).get(10, TimeUnit.SECONDS);
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
		her.socket = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + her.token)
				.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/voice"), new WebSocket.Listener() {
					private final java.io.ByteArrayOutputStream binary = new java.io.ByteArrayOutputStream();
					private final StringBuilder text = new StringBuilder();

					@Override
					public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
						text.append(data);
						if (last) {
							her.texts.add(text.toString());
							text.setLength(0);
						}
						webSocket.request(1);
						return null;
					}

					@Override
					public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
						byte[] chunk = new byte[data.remaining()];
						data.get(chunk);
						binary.write(chunk, 0, chunk.length);
						if (last) {
							byte[] frame = binary.toByteArray();
							binary.reset();
							ByteBuffer header = ByteBuffer.wrap(frame, 4, 16);
							if (frame.length > 20 && new UUID(header.getLong(), header.getLong()).equals(ownId)) {
								her.heard.incrementAndGet();
								if (her.fromUs.size() < 300) her.fromUs.add(java.util.Arrays.copyOfRange(frame, 20, frame.length));
							}
						}
						webSocket.request(1);
						return null;
					}
				}).get(10, TimeUnit.SECONDS);
		return her;
	}

	/** Sie steht drei Blöcke vor uns, ist im Raum und spricht (unsere eigenen Opus-Rahmen zurück) */
	private static void hearHer(TestContext t, Voice her, UUID ownId, RemotePlayer[] remote, Object instance) throws Exception {
		t.setScreen(() -> null);
		t.run(mc -> {
			RemotePlayer player = new RemotePlayer(mc.level, new GameProfile(her.uuid, her.name));
			player.setId(-4545);
			player.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3, 180f, 0f);
			mc.level.addEntity(player);
			remote[0] = player;
			mc.player.setYRot(0f);
			mc.player.setXRot(0f);
		});
		double[] pos = t.compute(mc -> new double[] {mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3});
		String dimension = t.compute(mc -> mc.level.dimension().identifier().toString());
		her.socket.sendText("{\"type\":\"join\",\"server\":\"" + TEST_SERVER + "\",\"dimension\":\"" + dimension + "\",\"mode\":\"all\"}", true).get(5, TimeUnit.SECONDS);
		her.socket.sendText("{\"type\":\"pos\",\"x\":" + pos[0] + ",\"y\":" + pos[1] + ",\"z\":" + pos[2] + "}", true).get(5, TimeUnit.SECONDS);
		t.waitSoft(mc -> VoiceLink.peers().contains(her.uuid), 10);
		t.waitSoft(mc -> Social.isHeldix(her.uuid), 10);
		t.check("Voice-Moderation: " + her.name + " ist im selben Raum", t.compute(mc -> VoiceLink.peers().contains(her.uuid)));
		t.check("Voice-Moderation: ihre Antwort „room“ hat voice on", her.texts.stream().anyMatch(m -> m.contains("\"room\"") && m.contains("\"on\"")));
		long until = System.currentTimeMillis() + 10_000;
		while (her.fromUs.size() < 80 && System.currentTimeMillis() < until) TestContext.sleep(100);
		t.check("Voice-Moderation: unser Testton kommt bei ihr an (" + her.heard.get() + ")", her.fromUs.size() >= 50);
		speak(her, 75);
		TestContext.sleep(300);
		t.check("Voice-Moderation: Lautstärke-Verlauf misst sie (" + invoke(instance, "levelSecondsOf", her.uuid) + " s)",
				((Number) invoke(instance, "levelSecondsOf", her.uuid)).intValue() >= 1);
		if (t.compute(mc -> VoiceModeration.clipsActive())) {
			long buffered = ((Number) invoke(instance, "bufferedMillisOf", her.uuid)).longValue();
			t.check("Voice-Moderation: Ringpuffer hält ihre Pakete (" + buffered + " ms)", buffered >= 1000);
		} else {
			t.check("Voice-Moderation: ohne Aufnahmen kein Ringpuffer", ((Number) invoke(instance, "clipSpeakers")).intValue() == 0);
		}
	}

	/** Sie spricht {@code frames} Rahmen (20 ms) aus unseren eigenen Opus-Rahmen; der letzte schließt den Satz */
	private static void speak(Voice her, int frames) throws Exception {
		for (int i = 0; i < frames && !her.fromUs.isEmpty(); i++) {
			byte[] payload = her.fromUs.poll();
			ByteBuffer frame = ByteBuffer.allocate(4 + payload.length);
			frame.put((byte) 1).put((byte) (i == frames - 1 || her.fromUs.isEmpty() ? 1 : 0)).putShort((short) her.sequence++).put(payload).flip();
			her.socket.sendBinary(frame, true).get(5, TimeUnit.SECONDS);
			TestContext.sleep(20);
		}
	}

	/** Spielermenü → „Melden …“ → Dialog von HeldixClient → Grund, „Melden“: Meldung (mit Aufnahme, wenn aktiv) beim Dienst */
	private static void report(TestContext t, Voice her, Object instance) {
		boolean clips = t.compute(mc -> VoiceModeration.clipsActive());
		VoiceReports.Result before = t.compute(mc -> VoiceReports.lastResult());
		List<String> labels = openMenu(t, her);
		t.check("Spielermenü: „Melden …“ (" + labels + ")", labels.contains("Melden …"));
		t.pressKey(InputConstants.KEY_1 + labels.indexOf("Melden …"));
		t.waitSoft(mc -> mc.gui.screen() instanceof VoiceReportScreen, 5);
		t.check("Melden: Dialog von HeldixClient für " + her.name, t.compute(mc -> mc.gui.screen() instanceof VoiceReportScreen report
				&& her.name.equals(report.target())));
		t.check("Melden: Schalter „Aufnahme anhängen“ " + (clips ? "da und an" : "nicht da (Aufnahmen aus)"), t.compute(mc ->
				((VoiceReportScreen) mc.gui.screen()).clipOffered() == clips && ((VoiceReportScreen) mc.gui.screen()).clipSelected() == clips));
		t.clickWidget("Anschreien/Lärm");
		t.moveMouse(5, 5);
		t.screenshot("voice-melden-01-dialog");
		t.clickWidget(VoiceReportScreen.SEND);
		t.waitSoft(mc -> VoiceReports.lastResult() != null && VoiceReports.lastResult() != before, 45);
		VoiceReports.Result result = t.compute(mc -> VoiceReports.lastResult());
		if (result != null && result != before && result.status() == 429) {
			t.log("Melden: Grenze für Voice-Meldungen erreicht (" + result.message() + ") – Prüfung übersprungen");
			return;
		}
		t.check("Melden: Meldung beim Dienst (" + (result == null ? "keine Antwort" : result.message()) + ")", result != null && result != before && result.id() > 0);
		if (clips) {
			t.check("Melden: Clip hochgeladen (Ogg/Opus, " + result.clipMs() + " ms, " + result.clipBytes() + " Byte)", result.clip() && result.clipMs() > 0);
		} else {
			t.check("Melden: ohne Aufnahmen kein Clip", !result.clip());
		}
		t.check("Melden: Einblendung im Spiel", t.compute(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Voice-Meldung"))));
		t.check("Melden: Dialog geschlossen", t.compute(mc -> !(mc.gui.screen() instanceof VoiceReportScreen)));
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Party-Leiter schaltet stumm
	// ======================================================================================

	private static void partyMute(TestContext t, String base, Voice her, UUID ownId, RemotePlayer remote, Object instance) throws Exception {
		// befreundet, sie lädt in die Party ein, wir nehmen an, sie übergibt die Leitung
		JsonObject friendRequest = new JsonObject();
		friendRequest.addProperty("name", t.<String>compute(mc -> mc.getUser().getName()));
		request(base, "POST", "/v1/friends/requests", friendRequest, her.token);
		t.waitSoft(mc -> Social.incoming().stream().anyMatch(r -> r.uuid().equals(her.uuid)), 10);
		t.compute(mc -> Social.accept(her.uuid)).get(10, TimeUnit.SECONDS);
		JsonObject me = new JsonObject();
		me.addProperty("uuid", Social.compact(ownId));
		request(base, "POST", "/v1/party/invite", me, her.token);
		t.waitSoft(mc -> !Party.invites().isEmpty(), 10);
		String partyId = t.compute(mc -> Party.invites().isEmpty() ? null : Party.invites().getLast().party());
		t.check("Party: Einladung von " + her.name, partyId != null);
		t.compute(mc -> Party.accept(partyId)).get(10, TimeUnit.SECONDS);
		request(base, "POST", "/v1/party/leader", me, her.token);
		t.waitSoft(mc -> Party.active() && Party.isLeader(), 10);
		t.check("Party: wir leiten", t.compute(mc -> Party.active() && Party.isLeader()));
		// beide am selben Ort → Voice-Gruppe der Party
		t.run(mc -> Social.statusChanged("multiplayer", TEST_SERVER));
		JsonObject status = new JsonObject();
		status.addProperty("type", "status");
		status.addProperty("state", "multiplayer");
		status.addProperty("server", TEST_SERVER);
		her.presence.sendText(status.toString(), true).get(5, TimeUnit.SECONDS);
		t.waitSoft(mc -> Party.voiceGroup(TEST_SERVER) != null, 10);
		String group = t.compute(mc -> Party.voiceGroup(TEST_SERVER));
		t.check("Party-Voice: Gruppen-Prüfwert da", group != null);
		// sie geht in den Nether: dann hören wir sie nur über die Party-Gruppe (Stummschalten gilt dort)
		her.socket.sendText("{\"type\":\"join\",\"server\":\"" + TEST_SERVER + "\",\"dimension\":\"minecraft:the_nether\",\"mode\":\"all\",\"group\":\"" + group + "\"}", true)
				.get(5, TimeUnit.SECONDS);
		t.waitSoft(mc -> VoiceLink.inPartyGroup() && VoiceLink.groupMembers().contains(her.uuid) && VoiceModeration.partyLeader(), 10);
		t.check("Party-Voice: beide in der Gruppe, room.party.leader", t.compute(mc -> VoiceLink.inPartyGroup() && VoiceLink.groupMembers().contains(her.uuid)
				&& VoiceModeration.partyLeader()));
		t.check("Rechte: wir dürfen sie moderieren", t.compute(mc -> VoiceModeration.canModerate(her.uuid)));

		// Spielermenü → „Für alle stummschalten“
		List<String> labels = openMenu(t, her);
		t.check("Spielermenü: „Für alle stummschalten“ (" + labels + ")", labels.contains("Für alle stummschalten"));
		her.texts.clear();
		t.pressKey(InputConstants.KEY_1 + labels.indexOf("Für alle stummschalten"));
		long until = System.currentTimeMillis() + 8000;
		while (her.texts.stream().noneMatch(m -> m.contains("\"moderated\"") && m.contains("\"muted\"")) && System.currentTimeMillis() < until) TestContext.sleep(100);
		t.check("Stummschalten: sie bekommt „moderated“ (muted, party)", her.texts.stream().anyMatch(m -> m.contains("\"moderated\"") && m.contains("\"muted\"")
				&& m.contains("\"party\"")));
		t.waitSoft(mc -> VoiceModeration.isSilenced(her.uuid), 8);
		t.check("Stummschalten: sie steht in peers.silenced", t.compute(mc -> VoiceModeration.isSilenced(her.uuid)));
		t.check("Stummschalten: Hinweis „mod“ an uns", t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Voice Chat – " + her.name)), 5));
		t.waitSoft(mc -> PlayerMarkerStore.aboveIcon("voicechat", her.uuid) == Ui.iconIndex("volume-off"), 3);
		t.check("Stummschalten: Symbol über ihrem Kopf", t.compute(mc -> PlayerMarkerStore.aboveIcon("voicechat", her.uuid) == Ui.iconIndex("volume-off")));
		t.screenshot("voice-moderation-01-stumm-fuer-alle");
		int played = ((Number) invoke(instance, "framesPlayed")).intValue();
		TestContext.sleep(300);
		long refill = System.currentTimeMillis() + 5000;
		while (her.fromUs.size() < 30 && System.currentTimeMillis() < refill) TestContext.sleep(100);
		speak(her, 30);
		TestContext.sleep(500);
		t.check("Stummschalten: ihre Rahmen kommen nicht mehr an", ((Number) invoke(instance, "framesPlayed")).intValue() <= played + 3);

		// aufheben
		labels = openMenu(t, her);
		t.check("Spielermenü: „Stumm für alle aufheben“", labels.contains("Stumm für alle aufheben"));
		her.texts.clear();
		t.pressKey(InputConstants.KEY_1 + labels.indexOf("Stumm für alle aufheben"));
		until = System.currentTimeMillis() + 8000;
		while (her.texts.stream().noneMatch(m -> m.contains("\"moderated\"") && m.contains("\"unmuted\"")) && System.currentTimeMillis() < until) TestContext.sleep(100);
		t.check("Aufheben: sie bekommt „moderated“ (unmuted)", her.texts.stream().anyMatch(m -> m.contains("\"moderated\"") && m.contains("\"unmuted\"")));
		t.waitSoft(mc -> !VoiceModeration.isSilenced(her.uuid), 8);
		t.check("Aufheben: nicht mehr in peers.silenced", t.compute(mc -> !VoiceModeration.isSilenced(her.uuid)));
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Sperre durch das Team
	// ======================================================================================

	private static void ban(TestContext t, Team team, UUID ownId) throws Exception {
		t.run(mc -> Notifications.clear());
		team.ban(ownId, 60, "Autotest");
		t.waitSoft(mc -> VoiceModeration.state().banned() && VoiceLink.status() != VoiceLink.Status.CONNECTED, 10);
		t.check("Sperre: banned + 4013 – getrennt (" + t.compute(mc -> VoiceLink.statusText()) + ")", t.compute(mc -> VoiceModeration.state().banned()
				&& VoiceLink.status() != VoiceLink.Status.CONNECTED));
		t.check("Sperre: Statustext nennt die Sperre", t.compute(mc -> VoiceLink.statusText().contains("gesperrt")));
		t.check("Sperre: Grund im Moderations-Stand", "Autotest".equals(t.compute(mc -> VoiceModeration.state().banReason())));
		t.check("Sperre: Hinweis im Spiel", t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Voice Chat gesperrt")), 5));
		TestContext.sleep(6000);
		t.check("Sperre: kein Neuverbinden vor dem Ende der Sperre", t.compute(mc -> VoiceLink.status() == VoiceLink.Status.UNAVAILABLE));
		t.screenshot("voice-moderation-02-gesperrt");
		team.unban(ownId);
		t.run(mc -> VoiceLink.retryNow());
		t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED, 15);
		t.check("Sperre aufgehoben: wieder verbunden (GET /v1/voice/me ohne Sperre)", t.compute(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED
				&& !VoiceModeration.state().banned()));
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	/** Fadenkreuz auf sie, Mausrad-Klick: Einträge des Spielermenüs */
	private static List<String> openMenu(TestContext t, Voice her) {
		t.setScreen(() -> null);
		t.run(mc -> {
			mc.player.setYRot(0f);
			mc.player.setXRot(0f);
		});
		t.waitSoft(mc -> PlayerMenu.targetedPlayer(mc) != null && PlayerMenu.targetedPlayer(mc).getUUID().equals(her.uuid), 5);
		t.run(mc -> KeyMapping.click(InputConstants.Type.MOUSE.getOrCreate(InputConstants.MOUSE_BUTTON_MIDDLE)));
		t.waitTicks(3);
		return t.compute(mc -> mc.gui.screen() instanceof PlayerMenuScreen menu ? menu.actionLabels() : List.of());
	}

	/** Anfrage an den Dienst; Fehler mit Status (ohne Token), 404 → IllegalStateException */
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

	/** Methode des Addons über Reflexion (eigener Klassenlader) */
	private static Object invoke(Object target, String name, Object... args) {
		try {
			for (var method : target.getClass().getMethods()) {
				if (method.getName().equals(name) && method.getParameterCount() == args.length) return method.invoke(target, args);
			}
			throw new IllegalStateException("Methode " + name + " fehlt");
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}
}
