package dev.heldixclient.autotest;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.cosmetic.Cosmetics;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.PauseMenuScreen;
import dev.heldixclient.social.Invites;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.voice.VoiceLink;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.PauseScreen;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Einladungen und Gäste im Voice Chat (Heldix-Dienst 1.11.0, Addon-API 9, Voice Chat 1.2.0):
 * <ol>
 *   <li>Seite Freunde → „Freunde einladen“ legt den Web-Link {@code …/einladung#<Code>} in die Zwischenablage, der Knopf in
 *   der Freunde-Karte des Pausemenüs denselben (die offene Einladung wird wiederverwendet).</li>
 *   <li>Eine neue Spielerin nimmt die Einladung an: Freundschaft und Einblendung kommen in Echtzeit.</li>
 *   <li>Echtzeit-Nachrichten "unlock" und "invite" (wie vom Dienst): Freischaltung sofort, Einblendung; Unbekanntes wird
 *   ignoriert.</li>
 *   <li>Voice-Gruppe: Browser-Link über die Seite Freunde, das Addon und die API (derselbe Link). Ein Gast tritt wie die
 *   Webseite bei (HTTP {@code POST /v1/public/invites/<code>/guest}, WebSocket mit den Unterprotokollen
 *   {@code heldix-voice} und {@code gast.<token>} und der Origin der Webseite), hört uns, spricht, ist als Gast gekennzeichnet
 *   und wird mit {@code removeGuest} getrennt (4004).</li>
 * </ol>
 * Braucht den Heldix-Dienst 1.11.0 mit Feature "guests" und eingetragener Webseite; mit älterem Dienst endet der Test nach
 * der Prüfung der Meldung. Mikrofon und Lautsprecher bleiben aus (-Dheldixclient.voicechat.testAudio, sonst kein Voice-Teil).
 * Codes, Links und Tokens werden nicht geloggt.
 */
final class InviteTests {
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
	/** Web-Link einer Einladung: {@code <webseite>/einladung#<Code>} */
	private static final Pattern WEB_LINK = Pattern.compile("^https?://[^\\s#]+/einladung#([a-hjkmnp-z2-9]{10})$");
	/** Raum des Autotests im Einzelspieler (-Dheldixclient.voice.testServer, wie in VoiceTests) */
	private static final String TEST_SERVER = "autotest.heldixclient.com";

	private InviteTests() {
	}

	static void run(TestContext t) throws Exception {
		if (!t.compute(mc -> Social.online())) {
			t.log("Heldix-Dienst nicht verbunden: Einladungen übersprungen");
			return;
		}
		String base = t.compute(mc -> Social.baseUrl());
		boolean notifications = t.compute(mc -> HeldixConfig.get().socialNotifications);
		t.run(mc -> HeldixConfig.get().socialNotifications = true);
		try {
			String code = friendsPage(t);
			if (code == null) return;
			pauseMenu(t, code);
			accepted(t, base, code);
			realtime(t);
			voiceGuest(t, base, code);
		} finally {
			t.run(mc -> {
				HeldixConfig.get().socialNotifications = notifications;
				mc.gui.setScreen(null);
			});
		}
	}

	// ======================================================================================
	// Freunde-Seite und Pausemenü: Einladungslink kopieren
	// ======================================================================================

	/** „Freunde einladen“ auf der Seite Freunde; Code der Einladung oder null (Dienst vor 1.11.0) */
	private static String friendsPage(TestContext t) throws Exception {
		t.run(mc -> mc.keyboardHandler.setClipboard(""));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.FRIENDS));
		t.waitTicks(8);
		int[] button = t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.settingCenter(HeldixMenuScreen.INVITE_LABEL) : null);
		t.check("Einladen: Seite Freunde zeigt „Freunde einladen“", button != null);
		t.moveMouse(5, 5);
		t.screenshot("einladung-01-freunde");
		t.click(button[0], button[1]);
		t.waitTicks(2);
		t.waitSoft(mc -> WEB_LINK.matcher(clipboard(mc)).matches() || !Invites.busy(), 15);
		t.waitTicks(2);
		String link = t.compute(InviteTests::clipboard);
		Matcher matcher = WEB_LINK.matcher(link);
		if (!matcher.matches()) {
			List<String> notices = t.compute(mc -> rows(mc).stream().filter(r -> r.startsWith("Notice:")).toList());
			if (notices.stream().anyMatch(r -> r.contains(Social.INVITES_MISSING))) {
				t.check("Einladen: älterer Heldix-Dienst – verständliche Meldung (" + notices + ")", true);
				t.log("Heldix-Dienst ohne Einladungen (vor 1.11.0): Einladungen und Gäste übersprungen");
				return null;
			}
			t.check("Einladen: Link in der Zwischenablage (" + masked(link) + ", " + notices + ")", false);
		}
		t.check("Einladen: „Freunde einladen“ legt den Web-Link in die Zwischenablage (" + masked(link) + ")", true);
		t.check("Einladen: Hinweis „Einladungslink kopiert“ auf der Seite", t.compute(mc -> rows(mc).stream().anyMatch(r -> r.contains("Einladungslink kopiert"))));
		t.moveMouse(5, 5);
		t.screenshot("einladung-02-kopiert");
		String code = matcher.group(1);

		// öffentlich abrufbar (wie die Webseite): Einladender, im Einzelspieler ohne Server und ohne Voice
		JsonObject invite = request(t, "GET", "/v1/public/invites/" + code, null, null);
		String ownName = t.compute(mc -> mc.getUser().getName());
		JsonObject inviter = invite.has("inviter") && invite.get("inviter").isJsonObject() ? invite.getAsJsonObject("inviter") : new JsonObject();
		t.check("Einladen: öffentliche Einladung nennt dich als Einladenden, ohne Server und Voice",
				ownName.equals(string(inviter, "name")) && isNull(invite, "server") && isNull(invite, "voice"));
		return code;
	}

	/** Knopf „Freunde einladen“ in der Freunde-Karte des Pausemenüs: derselbe Link (die offene Einladung wird wiederverwendet) */
	private static void pauseMenu(TestContext t, String code) {
		t.run(mc -> mc.keyboardHandler.setClipboard(""));
		t.setScreen(() -> new PauseScreen(true));
		t.waitTicks(8);
		t.check("Einladen: Heldix-Pausemenü offen", t.compute(mc -> mc.gui.screen() instanceof PauseMenuScreen));
		if (!t.compute(mc -> hasWidget(mc, PauseMenuScreen.INVITE_BUTTON))) {
			t.log("Pausemenü ohne Freunde-Karte (kleines Fenster): Einladen-Knopf nicht geprüft");
			t.setScreen(() -> null);
			return;
		}
		t.clickWidget(PauseMenuScreen.INVITE_BUTTON);
		t.waitSoft(mc -> WEB_LINK.matcher(clipboard(mc)).matches(), 15);
		Matcher matcher = WEB_LINK.matcher(t.compute(InviteTests::clipboard));
		t.check("Einladen: Knopf im Pausemenü kopiert denselben Link (Einladung wiederverwendet)", matcher.matches() && matcher.group(1).equals(code));
		t.screenshot("einladung-03-pausemenue");
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Annehmen und Echtzeit
	// ======================================================================================

	/** Eine neue Spielerin nimmt die Einladung an: Freundschaft (in Echtzeit), Willkommens-Belohnung für sie, Einblendung bei uns */
	private static void accepted(TestContext t, String base, String code) throws Exception {
		String name = "Neu_" + ThreadLocalRandom.current().nextInt(100_000, 1_000_000);
		UUID id = UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
		JsonObject login = new JsonObject();
		login.addProperty("name", name);
		login.addProperty("uuid", Social.compact(id));
		String token = request(t, "POST", "/v1/auth/dev", login, null).get("token").getAsString();
		t.run(mc -> Notifications.clear());
		JsonObject result = request(t, "POST", "/v1/invites/" + code + "/accept", new JsonObject(), token);
		t.check("Einladung angenommen: neue Freundschaft und Willkommens-Belohnung (" + string(result, "friend") + ", " + string(result, "reward") + ")",
				"new".equals(string(result, "friend")) && "freundesfunken".equals(string(result, "reward")));
		try {
			t.waitSoft(mc -> Social.friends().stream().anyMatch(f -> f.uuid().equals(id)), 10);
			t.check("Einladung angenommen: " + name + " ist sofort in der Freundesliste", t.compute(mc -> Social.friends().stream().anyMatch(f -> f.uuid().equals(id))));
			t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Einladung angenommen")), 10);
			t.check("Einladung angenommen: Einblendung bei dir (" + t.compute(mc -> Notifications.current()) + ")",
					t.compute(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Einladung angenommen") && n.contains(name))));
		} finally {
			// Freundschaft wieder lösen, damit spätere Prüfungen dieselbe Freundesliste sehen
			try {
				t.compute(mc -> Social.removeFriend(id)).get(10, TimeUnit.SECONDS);
			} catch (Exception e) {
				t.log("Einladung: Freundschaft nicht gelöst (" + e + ")");
			}
		}
	}

	/**
	 * Echtzeit-Nachrichten wie vom Dienst: "unlock" schaltet sofort frei und blendet „Neues Cosmetic freigeschaltet“ ein,
	 * "invite" (bestätigt) blendet ein, Unbekanntes bleibt folgenlos. Danach wieder der Stand des Dienstes (gesperrt).
	 */
	private static void realtime(TestContext t) throws Exception {
		t.run(mc -> Notifications.clear());
		t.run(mc -> Social.testRealtime(json("{\"type\":\"unlock\",\"cosmetic\":\"freundesfunken\",\"reason\":\"invite\"}")));
		t.check("Freischaltung: „unlock“ sofort übernommen", t.compute(mc -> Cosmetics.unlocked("freundesfunken")));
		t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Neues Cosmetic freigeschaltet")), 5);
		t.check("Freischaltung: Einblendung „Neues Cosmetic freigeschaltet“ (" + t.compute(mc -> Notifications.current()) + ")",
				t.compute(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Neues Cosmetic freigeschaltet")
						&& n.toLowerCase(Locale.ROOT).contains("freundesfunken"))));
		t.screenshot("einladung-04-freigeschaltet");
		t.run(mc -> Social.testRealtime(json("{\"type\":\"invite\",\"event\":\"confirmed\",\"name\":\"Testfreund\"}")));
		t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Einladung bestätigt")), 5);
		t.check("Einladung bestätigt: Einblendung", t.compute(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Einladung bestätigt")
				&& n.contains("Testfreund"))));
		t.run(mc -> Social.testRealtime(json("{\"type\":\"zukunft-unbekannt\",\"was\":1}")));
		t.check("Echtzeit: unbekannte Nachricht wird ignoriert", t.compute(mc -> Social.online()));
		// Stand des Dienstes zurückholen: das Testkonto hat nichts freigeschaltet
		Social.refreshCosmetics().get(15, TimeUnit.SECONDS);
		t.waitSoft(mc -> !Cosmetics.unlocked("freundesfunken"), 5);
		t.check("Freischaltung: nach dem Neuladen wieder wie beim Dienst (gesperrt)", t.compute(mc -> !Cosmetics.unlocked("freundesfunken")));
		t.run(mc -> Notifications.clear());
	}

	// ======================================================================================
	// Voice-Gruppe: Browser-Link und ein Gast
	// ======================================================================================

	private static void voiceGuest(TestContext t, String base, String generalCode) throws Exception {
		if (!Boolean.getBoolean("heldixclient.voicechat.testAudio")) {
			t.log("Ohne -Dheldixclient.voicechat.testAudio: Gäste im Voice Chat übersprungen (das echte Mikrofon bleibt zu)");
			return;
		}
		LoadedAddon addon = t.compute(mc -> AddonManager.addons().stream().filter(a -> "voicechat".equals(a.id())).findFirst().orElse(null));
		Module voice = t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals("voicechat:voicechat")).findFirst().orElse(null));
		t.check("Voice Chat 1.2.0 aktiv (" + (addon == null ? "fehlt" : addon.version()) + ")", addon != null && addon.isActive() && voice != null
				&& "1.2.0".equals(addon.version()));
		HeldixApi api = addon.api();
		Object instance = t.compute(mc -> addon.instance());
		List<Setting> settings = t.compute(mc -> voice.settings());
		int password = indexOf(settings, s -> s.label().equals("Gruppen-Passwort"));
		int linkIndex = indexOf(settings, s -> s instanceof Setting.Action action && action.button().equals("Browser-Link kopieren"));
		t.check("Voice Chat 1.2.0: Knopf „Browser-Link kopieren“ im Gruppen-Bereich", linkIndex >= 0 && linkIndex == password + 1);
		Setting.Action linkAction = linkIndex >= 0 ? (Setting.Action) settings.get(linkIndex) : null;
		Setting.Text group = (Setting.Text) settings.stream().filter(s -> s.label().equals("Gruppe")).findFirst().orElseThrow();
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());

		// Sprachaktivierung (der Testton ist laut genug), einschalten, Gruppe betreten
		t.run(mc -> settings.stream().filter(s -> s.label().equals("Sprechen")).map(s -> (Setting.Choice) s).findFirst().orElseThrow().set().accept(1));
		t.run(mc -> voice.setEnabled(true));
		WebSocket guestSocket = null;
		try {
			t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED, 15);
			t.run(mc -> group.set().accept("Gast-Test"));
			t.waitSoft(mc -> VoiceLink.browserLinkProblem() == null, 15);
			String problem = t.compute(mc -> VoiceLink.browserLinkProblem());
			t.check("Voice: Gruppe „Gast-Test“ betreten, Dienst kann Gäste (" + (problem == null ? "ok" : problem) + ")", problem == null);
			t.check("API 9: guestsAvailable()", t.compute(mc -> api.voice().guestsAvailable()));
			if (problem != null) return;

			// Browser-Link über die Seite Freunde
			t.run(mc -> mc.keyboardHandler.setClipboard(""));
			t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.FRIENDS));
			t.waitTicks(8);
			int[] button = t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.settingCenter(HeldixMenuScreen.BROWSER_LINK_LABEL) : null);
			t.check("Einladen: Seite Freunde zeigt den Browser-Link für die Voice-Gruppe", button != null);
			t.click(button[0], button[1]);
			t.waitSoft(mc -> WEB_LINK.matcher(clipboard(mc)).matches(), 15);
			String link = t.compute(InviteTests::clipboard);
			Matcher matcher = WEB_LINK.matcher(link);
			t.check("Einladen: Browser-Link der Voice-Gruppe in der Zwischenablage (" + masked(link) + ")", matcher.matches());
			String code = matcher.group(1);
			t.check("Einladen: Browser-Link ist eine eigene Einladung (mit Server und Gruppe)", !code.equals(generalCode));
			t.check("Einladen: Hinweis „Browser-Link kopiert“", t.compute(mc -> rows(mc).stream().anyMatch(r -> r.contains("Browser-Link kopiert"))));
			t.moveMouse(5, 5);
			t.screenshot("einladung-05-browser-link");

			// derselbe Link über den Knopf des Addons und über die API (Einladung wiederverwendet)
			t.run(mc -> mc.keyboardHandler.setClipboard(""));
			t.setScreen(() -> null);
			if (linkAction != null) t.run(mc -> linkAction.run().run());
			t.waitSoft(mc -> WEB_LINK.matcher(clipboard(mc)).matches(), 15);
			Matcher fromAddon = WEB_LINK.matcher(t.compute(InviteTests::clipboard));
			t.check("Voice Chat 1.2.0: „Browser-Link kopieren“ legt denselben Link in die Zwischenablage", fromAddon.matches() && fromAddon.group(1).equals(code));
			AtomicReference<String> apiLink = new AtomicReference<>();
			AtomicReference<String> apiError = new AtomicReference<>();
			t.run(mc -> api.voice().createBrowserLink(apiLink::set, apiError::set));
			t.waitSoft(mc -> apiLink.get() != null || apiError.get() != null, 15);
			t.check("API 9: createBrowserLink liefert denselben Link (" + (apiError.get() != null ? apiError.get() : masked(apiLink.get())) + ")",
					apiLink.get() != null && apiLink.get().endsWith("#" + code));

			// öffentlich (wie die Webseite): Server und Voice mit höchstens 4 Gästen
			JsonObject invite = request(t, "GET", "/v1/public/invites/" + code, null, null);
			JsonObject voiceInfo = invite.has("voice") && invite.get("voice").isJsonObject() ? invite.getAsJsonObject("voice") : null;
			t.check("Einladen: öffentliche Einladung mit Server und Voice (" + string(invite, "server") + ")", TEST_SERVER.equals(string(invite, "server"))
					&& voiceInfo != null && number(voiceInfo, "maxGuests") == 4 && number(voiceInfo, "guests") == 0 && number(voiceInfo, "members") >= 1);

			// ein Gast tritt bei wie die Webseite
			JsonObject body = new JsonObject();
			body.addProperty("name", "Gast Tom");
			JsonObject guest = request(t, "POST", "/v1/public/invites/" + code + "/guest", body, null);
			String guestToken = string(guest, "token");
			UUID guestId = Social.uuid(string(guest, "id"));
			t.check("Gast: Sitzung mit ID und Namen", guestToken != null && guestId != null && "Gast Tom".equals(string(guest, "name")));
			URI web = URI.create(link);
			String origin = web.getScheme() + "://" + web.getHost() + (web.getPort() >= 0 ? ":" + web.getPort() : "");
			ConcurrentLinkedQueue<byte[]> received = new ConcurrentLinkedQueue<>();
			AtomicInteger fromUs = new AtomicInteger();
			AtomicInteger closeCode = new AtomicInteger();
			guestSocket = HTTP.newWebSocketBuilder()
					.subprotocols("heldix-voice", "gast." + guestToken)
					.header("Origin", origin)
					.connectTimeout(Duration.ofSeconds(10))
					.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/voice"), new WebSocket.Listener() {
						private final java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();

						@Override
						public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
							webSocket.request(1);
							return null;
						}

						@Override
						public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
							byte[] chunk = new byte[data.remaining()];
							data.get(chunk);
							buffer.write(chunk, 0, chunk.length);
							if (last) {
								byte[] frame = buffer.toByteArray();
								buffer.reset();
								ByteBuffer header = frame.length > 20 ? ByteBuffer.wrap(frame, 4, 16) : null;
								if (header != null && new UUID(header.getLong(), header.getLong()).equals(ownId)) {
									fromUs.incrementAndGet();
									if (received.size() < 100) received.add(java.util.Arrays.copyOfRange(frame, 20, frame.length));
								}
							}
							webSocket.request(1);
							return null;
						}

						@Override
						public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
							closeCode.set(statusCode);
							return null;
						}
					}).get(10, TimeUnit.SECONDS);
			t.check("Gast: WebSocket mit Unterprotokoll heldix-voice (" + guestSocket.getSubprotocol() + ")", "heldix-voice".equals(guestSocket.getSubprotocol()));
			guestSocket.sendText("{\"type\":\"join\",\"invite\":\"" + code + "\"}", true).get(5, TimeUnit.SECONDS);
			t.waitSoft(mc -> VoiceLink.groupMembers().contains(guestId) && VoiceLink.isGuest(guestId), 10);
			t.check("Gast: „Gast Tom“ ist in unserer Gruppe (peers)", t.compute(mc -> VoiceLink.groupMembers().contains(guestId)));
			t.check("API 9: isGuest und inBrowser für den Gast, nicht für dich", t.compute(mc -> api.voice().isGuest(guestId) && api.voice().inBrowser(guestId)
					&& !api.voice().isGuest(ownId) && !api.voice().inBrowser(ownId)));
			t.check("API 9: playerName liefert den Gastnamen", "Gast Tom".equals(t.compute(mc -> api.playerName(guestId).orElse(""))));
			t.check("Voice Chat 1.2.0: Gast gekennzeichnet", "Gast".equals(invoke(instance, "tagOf", guestId)));

			// Rahmen ohne Raum, nur über die Gruppe: er hört unseren Testton …
			long until = System.currentTimeMillis() + 10_000;
			while (fromUs.get() < 15 && System.currentTimeMillis() < until) TestContext.sleep(100);
			t.check("Gast: hört uns über die Gruppe (" + fromUs.get() + " Rahmen, Opus)", fromUs.get() >= 15);
			// … und spricht selbst: wir hören ihn (seine ID steht im Rahmen)
			int sequence = 0;
			boolean heard = false;
			for (int i = 0; i < 30 && !received.isEmpty(); i++) {
				byte[] payload = received.poll();
				ByteBuffer frame = ByteBuffer.allocate(4 + payload.length);
				frame.put((byte) 1).put((byte) 0).putShort((short) sequence++).put(payload).flip();
				guestSocket.sendBinary(frame, true).get(5, TimeUnit.SECONDS);
				TestContext.sleep(20);
				if (i >= 12 && !heard) {
					@SuppressWarnings("unchecked")
					List<UUID> speaking = (List<UUID>) invoke(instance, "speakingNow");
					heard = speaking.contains(guestId);
				}
			}
			t.check("Gast: wir hören ihn im Spiel", heard);
			// Anzeige mit offenem Chat: Mitglieder der Gruppe mit Kennzeichen „Gast“ und Knopf zum Entfernen
			t.setScreen(() -> new ChatScreen("", false));
			t.waitTicks(6);
			t.screenshot("einladung-06-gast-im-hud");
			t.setScreen(() -> null);

			// entfernen: der Dienst trennt den Gast mit 4004
			t.run(mc -> api.voice().removeGuest(guestId));
			long closeUntil = System.currentTimeMillis() + 8000;
			while (closeCode.get() == 0 && System.currentTimeMillis() < closeUntil) TestContext.sleep(50);
			t.check("Gast: removeGuest trennt ihn (Schließcode " + closeCode.get() + ")", closeCode.get() == 4004);
			t.waitSoft(mc -> !VoiceLink.groupMembers().contains(guestId), 10);
			t.check("Gast: nicht mehr in der Gruppe", t.compute(mc -> !VoiceLink.groupMembers().contains(guestId) && !VoiceLink.isGuest(guestId)));
		} finally {
			if (guestSocket != null) guestSocket.abort();
			t.run(mc -> group.set().accept(""));
			t.waitSoft(mc -> VoiceLink.groupName() == null, 5);
			t.run(mc -> voice.setEnabled(false));
			t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.OFF, 5);
			t.run(mc -> mc.keyboardHandler.setClipboard(""));
		}
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static String clipboard(net.minecraft.client.Minecraft mc) {
		String text = mc.keyboardHandler.getClipboard();
		return text == null ? "" : text.strip();
	}

	/** Zeilen der offenen Seite des Heldix-Menüs (leer, wenn keins offen ist) */
	private static List<String> rows(net.minecraft.client.Minecraft mc) {
		return mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.describeRows() : List.of();
	}

	private static boolean hasWidget(net.minecraft.client.Minecraft mc, String label) {
		if (mc.gui.screen() == null) return false;
		for (GuiEventListener child : mc.gui.screen().children()) {
			if (child instanceof AbstractWidget widget && widget.visible && widget.getMessage().getString().equals(label)) return true;
		}
		return false;
	}

	/** Link ohne Code (Codes kommen nicht ins Log) */
	private static String masked(String link) {
		if (link == null || link.isEmpty()) return "leer";
		int hash = link.indexOf('#');
		return hash < 0 ? "kein Einladungslink" : link.substring(0, hash) + "#…";
	}

	private static int indexOf(List<Setting> settings, java.util.function.Predicate<Setting> match) {
		for (int i = 0; i < settings.size(); i++) if (match.test(settings.get(i))) return i;
		return -1;
	}

	private static JsonObject json(String text) {
		return JsonParser.parseString(text).getAsJsonObject();
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}

	private static boolean isNull(JsonObject object, String key) {
		return object != null && (!object.has(key) || object.get(key).isJsonNull());
	}

	private static double number(JsonObject object, String key) {
		JsonElement value = object == null ? null : object.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsDouble() : Double.NaN;
	}

	/** Anfrage an den Dienst; Fehler mit Status, ohne Token im Text */
	private static JsonObject request(TestContext t, String method, String path, JsonObject body, String token) throws Exception {
		String base = t.compute(mc -> Social.baseUrl());
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10))
				.header("Content-Type", "application/json")
				.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
		if (token != null) request.header("Authorization", "Bearer " + token);
		HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		String shownPath = path.replaceAll("[a-hjkmnp-z2-9]{10}", "<code>");
		if (response.statusCode() >= 400) throw new IllegalStateException(method + " " + shownPath + ": " + response.statusCode() + " " + response.body());
		return response.body().isBlank() ? new JsonObject() : JsonParser.parseString(response.body()).getAsJsonObject();
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
