package dev.heldixclient.autotest;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.player.PlayerMarkerStore;
import dev.heldixclient.player.PlayerMenu;
import dev.heldixclient.screen.PlayerMenuScreen;
import dev.heldixclient.social.Social;
import dev.heldixclient.voice.VoiceLink;
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
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Autotest des Spielermenüs (Mausrad-Klick auf einen Spieler) und des Voice-Chat-Addons über den Heldix-Dienst: eine
 * zweite Spielerin („Stimme“) steht vor uns, meldet sich über die Schnittstelle beim Sprachkanal an, empfängt unseren
 * Testton und schickt ihn zurück. Echte Mikrofone und Lautsprecher bleiben aus (-Dheldixclient.voicechat.testAudio).
 */
final class VoiceTests {
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();

	private VoiceTests() {
	}

	private static JsonObject request(String base, String method, String path, JsonObject body, String token) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10))
				.header("Content-Type", "application/json")
				.method(method, HttpRequest.BodyPublishers.ofString(body == null ? "" : body.toString(), StandardCharsets.UTF_8));
		if (token != null) request.header("Authorization", "Bearer " + token);
		HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		if (response.statusCode() >= 400) throw new IllegalStateException(method + " " + path + ": " + response.statusCode() + " " + response.body());
		return response.body().isBlank() ? new JsonObject() : JsonParser.parseString(response.body()).getAsJsonObject();
	}

	private static Module module(TestContext t, String id) {
		return t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null));
	}

	/** Mausrad-Klick (die Taste „Spielermenü“) wie im Spiel */
	private static void middleClick(TestContext t) {
		t.run(mc -> KeyMapping.click(InputConstants.Type.MOUSE.getOrCreate(InputConstants.MOUSE_BUTTON_MIDDLE)));
		t.waitTicks(3);
	}

	static void run(TestContext t) throws Exception {
		if (!t.compute(mc -> Social.online())) {
			t.log("Heldix-Dienst nicht verbunden: Spielermenü und Voice Chat übersprungen");
			return;
		}
		String base = t.compute(mc -> Social.baseUrl());
		UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
		UUID voiceId = UUID.nameUUIDFromBytes("OfflinePlayer:Stimme".getBytes(StandardCharsets.UTF_8));
		JsonObject login = new JsonObject();
		login.addProperty("name", "Stimme");
		login.addProperty("uuid", Social.compact(voiceId));
		String token = request(base, "POST", "/v1/auth/dev", login, null).get("token").getAsString();
		// einmal online gewesen: erst dann kennt der Dienst sie als HeldixClient-Spielerin (Anfragen, Heldix-Symbol)
		WebSocket presence = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + token)
				.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/ws"), new WebSocket.Listener() {
					@Override
					public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
						webSocket.request(1);
						return null;
					}
				}).get(10, TimeUnit.SECONDS);
		try {
			runWith(t, base, token, ownId, voiceId);
		} finally {
			presence.abort();
		}
	}

	private static void runWith(TestContext t, String base, String token, UUID ownId, UUID voiceId) throws Exception {

		// Spielerin „Stimme“ drei Blöcke vor uns, wir schauen sie an
		RemotePlayer[] remote = new RemotePlayer[1];
		t.setScreen(() -> null);
		t.run(mc -> {
			RemotePlayer player = new RemotePlayer(mc.level, new GameProfile(voiceId, "Stimme"));
			player.setId(-4343);
			player.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3, 180f, 0f);
			mc.level.addEntity(player);
			remote[0] = player;
			mc.player.setYRot(0f);
			mc.player.setXRot(0f);
		});
		t.waitSoft(mc -> Social.isHeldix(voiceId), 10);
		t.waitSoft(mc -> PlayerMenu.targetedPlayer(mc) == remote[0], 5);
		t.check("Spielermenü: Fadenkreuz auf „Stimme“", t.compute(mc -> PlayerMenu.targetedPlayer(mc) == remote[0]));

		// Mausrad-Klick öffnet das Kreismenü
		middleClick(t);
		t.check("Spielermenü: Mausrad-Klick öffnet das Menü für „Stimme“", t.compute(mc -> mc.gui.screen() instanceof PlayerMenuScreen menu
				&& menu.target().equals(voiceId)));
		List<String> labels = t.compute(mc -> mc.gui.screen() instanceof PlayerMenuScreen menu ? menu.actionLabels() : List.of());
		t.log("Spielermenü " + labels);
		t.check("Spielermenü: Freund hinzufügen und Name kopieren", labels.size() >= 2 && labels.get(0).equals("Freund hinzufügen")
				&& labels.get(1).equals("Name kopieren"));
		t.moveMouse(5, 5);
		t.screenshot("spielermenue-01");
		// Taste 2: Name kopieren, Menü schließt
		t.pressKey(InputConstants.KEY_2);
		t.check("Spielermenü: „Name kopieren“ legt „Stimme“ in die Zwischenablage", "Stimme".equals(t.compute(mc -> mc.keyboardHandler.getClipboard()))
				&& t.compute(mc -> mc.gui.screen() == null));
		// Freund hinzufügen per Klick
		middleClick(t);
		int[] friend = t.compute(mc -> ((PlayerMenuScreen) mc.gui.screen()).actionCenter(0));
		t.click(friend[0], friend[1]);
		t.waitSoft(mc -> Social.outgoing().stream().anyMatch(r -> r.uuid().equals(voiceId)), 10);
		t.check("Spielermenü: Anfrage an „Stimme“ gesendet", t.compute(mc -> Social.outgoing().stream().anyMatch(r -> r.uuid().equals(voiceId))));
		middleClick(t);
		t.check("Spielermenü: danach „Anfrage gesendet“", t.compute(mc -> mc.gui.screen() instanceof PlayerMenuScreen menu
				&& menu.actionLabels().getFirst().equals("Anfrage gesendet")));
		t.pressKey(InputConstants.KEY_ESCAPE);

		// --- Voice Chat ---------------------------------------------------------------------------
		LoadedAddon addon = t.compute(mc -> AddonManager.addons().stream().filter(a -> a.id().equals("voicechat")).findFirst().orElse(null));
		Module voice = module(t, "voicechat:voicechat");
		t.check("Voice Chat: Addon aktiv (API 6)", addon != null && addon.isActive() && voice != null);
		if (addon == null || voice == null) return;
		Object instance = t.compute(mc -> addon.instance());
		// Sprachaktivierung (der Testton ist laut genug), dann einschalten
		t.run(mc -> voice.settings().stream().filter(s -> s.label().equals("Sprechen")).map(s -> (Setting.Choice) s).findFirst().orElseThrow()
				.set().accept(1));
		// frühere Schritte schalten alle Module an: erst aus – dann ist der Kanal zu
		t.run(mc -> voice.setEnabled(false));
		t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.OFF, 5);
		t.check("Voice Chat: Modul aus, kein Kanal", t.compute(mc -> VoiceLink.status()) == VoiceLink.Status.OFF);
		t.run(mc -> voice.setEnabled(true));
		t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED, 15);
		t.check("Voice Chat: mit dem Heldix-Dienst verbunden (" + t.compute(mc -> VoiceLink.statusText()) + ")",
				t.compute(mc -> VoiceLink.status()) == VoiceLink.Status.CONNECTED);

		// „Stimme“ meldet sich beim Sprachkanal an: gleicher Raum, gleiche Stelle
		ConcurrentLinkedQueue<byte[]> received = new ConcurrentLinkedQueue<>();
		AtomicInteger fromUs = new AtomicInteger();
		WebSocket socket = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + token)
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
							ByteBuffer header = ByteBuffer.wrap(frame, 4, 16);
							if (frame.length > 20 && new UUID(header.getLong(), header.getLong()).equals(ownId)) {
								fromUs.incrementAndGet();
								if (received.size() < 200) received.add(java.util.Arrays.copyOfRange(frame, 20, frame.length));
							}
						}
						webSocket.request(1);
						return null;
					}
				}).get(10, TimeUnit.SECONDS);
		try {
			double[] pos = t.compute(mc -> new double[] {mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3});
			String dimension = t.compute(mc -> mc.level.dimension().identifier().toString());
			socket.sendText("{\"type\":\"join\",\"server\":\"autotest.heldixclient.com\",\"dimension\":\"" + dimension + "\",\"mode\":\"all\"}", true)
					.get(5, TimeUnit.SECONDS);
			socket.sendText("{\"type\":\"pos\",\"x\":" + pos[0] + ",\"y\":" + pos[1] + ",\"z\":" + pos[2] + "}", true).get(5, TimeUnit.SECONDS);
			t.waitSoft(mc -> VoiceLink.peers().contains(voiceId), 10);
			t.check("Voice Chat: „Stimme“ ist im selben Raum", t.compute(mc -> VoiceLink.peers().contains(voiceId)));

			// unser Testton kommt bei ihr an
			long until = System.currentTimeMillis() + 10_000;
			while (fromUs.get() < 25 && System.currentTimeMillis() < until) TestContext.sleep(100);
			t.check("Voice Chat: unser Testton kommt bei „Stimme“ an (" + fromUs.get() + " Rahmen, Opus)", fromUs.get() >= 25);
			t.check("Voice Chat: Addon zählt gesendete Rahmen", ((Number) invoke(instance, "framesSent")).intValue() > 0);

			// sie schickt ihn zurück: wir hören sie, Symbol über ihrem Kopf
			int sequence = 0;
			for (int i = 0; i < 40 && !received.isEmpty(); i++) {
				byte[] payload = received.poll();
				ByteBuffer frame = ByteBuffer.allocate(4 + payload.length);
				frame.put((byte) 1).put((byte) 0).putShort((short) sequence++).put(payload).flip();
				socket.sendBinary(frame, true).get(5, TimeUnit.SECONDS);
				TestContext.sleep(20);
				if (i == 20) {
					@SuppressWarnings("unchecked")
					List<UUID> speaking = (List<UUID>) invoke(instance, "speakingNow");
					t.check("Voice Chat: „Stimme“ spricht gerade", speaking.contains(voiceId));
					t.check("Voice Chat: Symbol über ihrem Kopf", t.compute(mc -> PlayerMarkerStore.count(voiceId)) > 0);
					t.screenshot("voicechat-01-spricht");
				}
			}
			t.check("Voice Chat: ihre Rahmen werden dekodiert und gemischt (" + invoke(instance, "framesPlayed") + ")",
					((Number) invoke(instance, "framesPlayed")).intValue() > 10);

			// Spielermenü: Voice-Einträge, Stummschalten wirkt
			t.setScreen(() -> null);
			t.run(mc -> {
				mc.player.setYRot(0f);
				mc.player.setXRot(0f);
			});
			t.waitSoft(mc -> PlayerMenu.targetedPlayer(mc) == remote[0], 5);
			middleClick(t);
			List<String> withVoice = t.compute(mc -> mc.gui.screen() instanceof PlayerMenuScreen menu ? menu.actionLabels() : List.of());
			t.log("Spielermenü mit Voice Chat " + withVoice);
			t.check("Spielermenü: Voice-Einträge Stummschalten, Lauter, Leiser (Addon-API)", withVoice.contains("Stummschalten")
					&& withVoice.stream().anyMatch(l -> l.startsWith("Lauter (100")) && withVoice.stream().anyMatch(l -> l.startsWith("Leiser (100")));
			t.screenshot("spielermenue-02-voice");
			int mute = withVoice.indexOf("Stummschalten");
			t.pressKey(InputConstants.KEY_1 + mute);
			t.check("Voice Chat: „Stimme“ stumm geschaltet", Boolean.TRUE.equals(invoke(instance, "mutedPlayer", voiceId)));
			int playedBefore = ((Number) invoke(instance, "framesPlayed")).intValue();
			TestContext.sleep(400);
			for (int i = 0; i < 15; i++) {
				ByteBuffer frame = ByteBuffer.allocate(24);
				frame.put((byte) 1).put((byte) 0).putShort((short) sequence++).put(new byte[20]).flip();
				socket.sendBinary(frame, true).get(5, TimeUnit.SECONDS);
			}
			TestContext.sleep(500);
			t.check("Voice Chat: stumm geschaltete Spielerin bleibt still", ((Number) invoke(instance, "framesPlayed")).intValue() <= playedBefore + 3);
			// wieder hörbar machen (für spätere Läufe)
			middleClick(t);
			int unmute = t.compute(mc -> ((PlayerMenuScreen) mc.gui.screen()).actionLabels().indexOf("Stumm aufheben"));
			t.pressKey(InputConstants.KEY_1 + unmute);
		} finally {
			socket.abort();
			t.run(mc -> voice.setEnabled(false));
			t.run(mc -> mc.level.removeEntity(remote[0].getId(), net.minecraft.world.entity.Entity.RemovalReason.DISCARDED));
		}
		t.waitSoft(mc -> VoiceLink.status() == VoiceLink.Status.OFF, 5);
		t.check("Voice Chat: Modul aus, Kanal getrennt", t.compute(mc -> VoiceLink.status()) == VoiceLink.Status.OFF
				&& !Boolean.TRUE.equals(invoke(instance, "engineRunning")));
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
