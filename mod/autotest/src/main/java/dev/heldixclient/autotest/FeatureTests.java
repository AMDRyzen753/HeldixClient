package dev.heldixclient.autotest;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.impl.ArmorStatusModule;
import dev.heldixclient.module.impl.ChatModule;
import dev.heldixclient.module.impl.WaypointsModule;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.social.Badge;
import dev.heldixclient.social.Messages;
import dev.heldixclient.social.Social;
import dev.heldixclient.transform.Hooks;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.waypoint.Waypoints;
import net.minecraft.client.CameraType;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.chat.GuiMessage;
import net.minecraft.client.player.RemotePlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;

import java.lang.reflect.Field;
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
import java.util.concurrent.TimeUnit;

/** Autotest der Module Rüstung, Trank-Effekte, Dauersprint, Freelook, Fadenkreuz, Chat, Wegpunkte und des Heldix-Dienstes. */
final class FeatureTests {
	private FeatureTests() {
	}

	private static <T extends Module> T module(TestContext t, String id) {
		@SuppressWarnings("unchecked")
		T module = (T) t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null));
		t.check("Modul „" + id + "“ vorhanden", module != null);
		if (module != null) t.run(mc -> module.setEnabled(true));
		return module;
	}

	static void modules(TestContext t) {
		t.setScreen(() -> null);
		t.run(mc -> mc.options.setCameraType(CameraType.FIRST_PERSON));
		// keine Schleime (Flachwelt) vor der Kamera
		t.serverCommand("difficulty peaceful");
		t.serverCommand("kill @e[type=!minecraft:player]");
		t.serverCommand("tp @a 0 -60 0 0 0");
		t.waitTicks(10);

		// --- Rüstung und Trank-Effekte ------------------------------------------------------
		HudModule armor = module(t, "armor");
		HudModule effects = module(t, "effects");
		module(t, "crosshair");
		t.serverCommand("item replace entity @a armor.head with minecraft:diamond_helmet");
		t.serverCommand("item replace entity @a armor.chest with minecraft:iron_chestplate[minecraft:damage=180]");
		t.serverCommand("item replace entity @a weapon.mainhand with minecraft:diamond_sword[minecraft:damage=1400]");
		t.serverCommand("effect give @a minecraft:speed 120 1");
		t.serverCommand("effect give @a minecraft:strength 6 0");
		t.waitTicks(10);
		t.check("Rüstungsanzeige zeigt drei Items (Höhe " + armor.height() + ")", t.compute(mc -> armor.height()) >= 50);
		String swordLabel = t.compute(mc -> ArmorStatusModule.label(mc.player.getItemBySlot(EquipmentSlot.MAINHAND), 0));
		t.check("Haltbarkeit des Schwerts (" + swordLabel + ")", "161".equals(swordLabel));
		t.check("Trank-Effekte zeigen zwei Einträge (Höhe " + effects.height() + ")", t.compute(mc -> effects.height()) >= 40);
		t.check("Vanilla-Effektsymbole ausgeblendet", t.compute(mc -> Hooks.hideVanillaEffects()));
		t.log("Objekte in der Nähe: " + t.compute(mc -> { StringBuilder b = new StringBuilder(); for (Entity e : mc.level.entitiesForRendering()) if (e.distanceTo(mc.player) < 40) b.append(e.getType().toShortString()).append("@").append(e.blockPosition().toShortString()).append(" "); return b.toString(); }));
		t.screenshot("heldix-20-ruestung-effekte-fadenkreuz");

		// --- Dauersprint und Dauerschleichen -------------------------------------------------
		Module sprint = module(t, "togglesprint");
		for (int i = 0; i < 20; i++) {
			t.run(mc -> mc.options.keyUp.setDown(true));
			t.waitTicks(1);
		}
		t.check("Dauersprint: läuft ohne Sprinttaste", t.compute(mc -> mc.player.isSprinting()));
		t.run(mc -> mc.options.keyUp.setDown(false));
		t.waitTicks(5);
		t.run(mc -> setToggle(sprint, "Schleichen umschalten", true));
		t.pressKey(InputConstants.KEY_LSHIFT);
		t.waitTicks(6);
		t.check("Dauerschleichen: ein Druck auf Schleichen", t.compute(mc -> mc.player.isShiftKeyDown()));
		t.screenshot("heldix-21-dauerschleichen");
		t.pressKey(InputConstants.KEY_LSHIFT);
		t.waitTicks(6);
		t.check("Dauerschleichen: zweiter Druck beendet es", t.compute(mc -> !mc.player.isShiftKeyDown()));
		t.run(mc -> setToggle(sprint, "Schleichen umschalten", false));

		// --- Freelook ------------------------------------------------------------------------
		module(t, "freelook");
		float yawBefore = t.compute(mc -> mc.player.getYRot());
		for (int i = 0; i < 4; i++) {
			t.run(mc -> HeldixClient.freelookKey.setDown(true));
			t.waitTicks(1);
		}
		t.check("Freelook aktiv in der dritten Person", t.compute(mc -> ModuleManager.freelook.isActive() && mc.options.getCameraType() == CameraType.THIRD_PERSON_BACK));
		t.run(mc -> {
			HeldixClient.freelookKey.setDown(true);
			mc.player.turn(400, -100);
		});
		t.waitTicks(2);
		t.run(mc -> HeldixClient.freelookKey.setDown(true));
		float cameraYaw = t.compute(mc -> mc.gameRenderer.mainCamera().yRot());
		float yawDuring = t.compute(mc -> mc.player.getYRot());
		t.check("Freelook dreht nur die Kamera (Spieler " + yawBefore + " → " + yawDuring + ", Kamera " + cameraYaw + ")",
				Math.abs(yawDuring - yawBefore) < 0.01f && Math.abs(cameraYaw - yawBefore) > 30f);
		t.screenshot("heldix-22-freelook");
		t.run(mc -> HeldixClient.freelookKey.setDown(false));
		t.waitTicks(3);
		t.check("Freelook beendet: erste Person, Blickrichtung unverändert", t.compute(mc -> !ModuleManager.freelook.isActive()
				&& mc.options.getCameraType() == CameraType.FIRST_PERSON && Math.abs(mc.player.getYRot() - yawBefore) < 0.01f));

		// --- Chat ----------------------------------------------------------------------------
		module(t, "chat");
		t.run(mc -> {
			ChatComponent chat = mc.gui.hud.getChat();
			for (int i = 0; i < 3; i++) chat.addClientSystemMessage(Component.literal("Stapeltest"));
			chat.addClientSystemMessage(Component.literal("Kopiertest mit Umlauten äöü"));
		});
		List<String> newest = t.compute(mc -> newestMessages(mc.gui.hud.getChat(), 2));
		t.log("Chat: " + newest);
		t.check("Chat: Uhrzeit vor der Nachricht", newest.size() == 2 && newest.get(0).matches("^\\[\\d{2}:\\d{2}] Kopiertest.*"));
		t.check("Chat: gleiche Nachrichten gestapelt", newest.size() == 2 && newest.get(1).endsWith("Stapeltest (3×)"));
		t.setScreen(() -> new ChatScreen("", false));
		t.waitTicks(5);
		String copied = t.compute(mc -> {
			int height = mc.getWindow().getGuiScaledHeight();
			for (int y = height - 1; y > height / 3; y--) {
				String text = ChatModule.messageAt(6, y);
				if (text != null) return text;
			}
			return null;
		});
		t.check("Chat: Nachricht unter dem Mauszeiger gefunden (" + copied + ")", "Kopiertest mit Umlauten äöü".equals(copied));
		t.screenshot("heldix-23-chat");
		t.setScreen(() -> null);

		// --- Wegpunkte -----------------------------------------------------------------------
		module(t, "waypoints");
		t.run(mc -> {
			Waypoints.current(mc).removeIf(w -> true);
			Waypoints.Waypoint ahead = Waypoints.add(mc, "Vorne");
			ahead.z += 14;
			Waypoints.Waypoint high = Waypoints.add(mc, "Oben");
			high.z += 14;
			high.y += 5;
			Waypoints.Waypoint behind = Waypoints.add(mc, "Hinten");
			behind.z -= 20;
			Waypoints.save();
		});
		t.waitTicks(4);
		List<float[]> markers = t.compute(mc -> WaypointsModule.lastMarkers);
		int[] size = t.compute(mc -> new int[] {mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight()});
		t.log("Markierungen: " + markers.stream().map(m -> Math.round(m[0]) + "/" + Math.round(m[1])).toList() + " bei " + size[0] + "×" + size[1]);
		t.check("Wegpunkte: zwei vorn sichtbar, der hintere nicht", markers.size() == 2);
		if (markers.size() == 2) {
			// sortiert: fern zuerst (Oben), dann Vorne
			float[] up = markers.get(0);
			float[] ahead = markers.get(1);
			t.check("Wegpunkt vorn liegt mittig", Math.abs(ahead[0] - size[0] / 2f) < size[0] * 0.08f && Math.abs(ahead[1] - size[1] / 2f) < size[1] * 0.2f);
			t.check("Höherer Wegpunkt erscheint weiter oben", up[1] < ahead[1] - 20);
		}
		t.screenshot("heldix-24-wegpunkte");
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.WAYPOINTS));
		t.waitTicks(6);
		t.check("Seite Wegpunkte ist offen", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu && "WAYPOINTS".equals(menu.currentTab())));
		t.screenshot("heldix-25-wegpunkte-seite");
		t.setScreen(() -> null);
		t.serverCommand("kill @a");
		t.waitSoft(mc -> mc.player != null && mc.player.isDeadOrDying(), 5);
		t.waitTicks(3);
		t.check("Todespunkt gespeichert", t.compute(mc -> Waypoints.current(mc).stream().anyMatch(w -> w.death)));
		t.run(mc -> mc.player.respawn());
		t.waitFor("Wiederbelebt", mc -> mc.player != null && !mc.player.isDeadOrDying(), 20);
		t.setScreen(() -> null);
		t.run(mc -> {
			Waypoints.current(mc).removeIf(w -> true);
			Waypoints.save();
		});
		t.waitTicks(10);
	}

	/** Ist die Texteingabe des Fensters gerade an? (Minecraft hat dafür keinen Getter) */
	private static boolean textInputEnabled(net.minecraft.client.Minecraft mc) {
		try {
			Field field = mc.textInputManager().getClass().getDeclaredField("textInputEnabled");
			field.setAccessible(true);
			return field.getBoolean(mc.textInputManager());
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}

	private static void setToggle(Module module, String label, boolean value) {
		module.settings().stream()
				.filter(s -> s instanceof dev.heldixclient.module.Setting.Toggle && s.label().equals(label))
				.map(s -> (dev.heldixclient.module.Setting.Toggle) s)
				.findFirst()
				.orElseThrow(() -> new IllegalStateException(module.id() + " hat keinen Schalter " + label))
				.set().accept(value);
	}

	@SuppressWarnings("unchecked")
	private static List<String> newestMessages(ChatComponent chat, int count) {
		try {
			Field field = ChatComponent.class.getDeclaredField("allMessages");
			field.setAccessible(true);
			List<GuiMessage> messages = (List<GuiMessage>) field.get(chat);
			return messages.stream().limit(count).map(m -> m.content().getString()).toList();
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}

	// ======================================================================================
	// Heldix-Dienst: zweite Spielerin über die Schnittstelle, Freundschaft, Status, Cape, Symbol
	// ======================================================================================

	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();

	static void social(TestContext t) {
		if (t.compute(mc -> Social.state()) == Social.State.DISABLED) {
			t.log("Heldix-Dienst nicht eingerichtet (--service fehlt), Test übersprungen");
			return;
		}
		t.waitSoft(mc -> Social.online(), 20);
		t.check("Heldix-Dienst verbunden (" + t.compute(mc -> Social.state()) + ", " + t.compute(mc -> Social.error()) + ")", t.compute(mc -> Social.online()));
		if (!t.compute(mc -> Social.online())) return;

		String base = t.compute(mc -> Social.baseUrl());
		UUID friendId = UUID.nameUUIDFromBytes("OfflinePlayer:Freundin".getBytes(StandardCharsets.UTF_8));
		WebSocket friendSocket = null;
		RemotePlayer[] remote = new RemotePlayer[1];
		try {
			JsonObject login = new JsonObject();
			login.addProperty("name", "Freundin");
			login.addProperty("uuid", Social.compact(friendId));
			String token = request(base, "POST", "/v1/auth/dev", login, null).get("token").getAsString();
			JsonObject me = new JsonObject();
			me.addProperty("cape", "glut");
			request(base, "PUT", "/v1/me", me, token);
			friendSocket = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + token)
					.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/ws"), new WebSocket.Listener() {
						@Override
						public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
							webSocket.request(1);
							return null;
						}
					}).get(10, TimeUnit.SECONDS);
			JsonObject friendRequest = new JsonObject();
			String ownName = t.compute(mc -> mc.getUser().getName());
			friendRequest.addProperty("name", ownName);
			request(base, "POST", "/v1/friends/requests", friendRequest, token);

			t.waitSoft(mc -> Social.incoming().stream().anyMatch(r -> r.uuid().equals(friendId)), 10);
			t.check("Freundschaftsanfrage kommt in Echtzeit an", t.compute(mc -> Social.incoming().stream().anyMatch(r -> r.uuid().equals(friendId))));
			t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.FRIENDS));
			t.waitTicks(8);
			t.check("Freunde: Reiter Freunde, Anfragen, Privatsphäre",
					t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabIds()).equals(List.of("FRIENDS", "MESSAGES", "REQUESTS", "PRIVACY")));
			t.check("Seitenleiste zeigt die offene Anfrage", "1".equals(t.compute(mc -> Shell.badge(Shell.Page.FRIENDS))));
			t.screenshot("heldix-26a-freunde-hinweis");
			AutoTest.openPage(t, "REQUESTS");
			t.moveMouse(5, 5);
			t.waitTicks(4);
			t.screenshot("heldix-26-freunde-anfrage");
			t.run(mc -> Social.accept(friendId));
			t.waitSoft(mc -> Social.friends().stream().anyMatch(f -> f.uuid().equals(friendId) && f.online()), 10);
			t.check("Anfrage angenommen: Freundin ist online", t.compute(mc -> Social.friends().stream().anyMatch(f -> f.uuid().equals(friendId) && f.online())));

			JsonObject status = new JsonObject();
			status.addProperty("type", "status");
			status.addProperty("state", "multiplayer");
			status.addProperty("server", "hypixel.net");
			friendSocket.sendText(status.toString(), true).get(5, TimeUnit.SECONDS);
			t.waitSoft(mc -> Social.friends().stream().anyMatch(f -> "Spielt auf hypixel.net".equals(f.activity())), 10);
			t.check("Status der Freundin: Spielt auf hypixel.net", t.compute(mc -> Social.friends().stream().anyMatch(f -> "Spielt auf hypixel.net".equals(f.activity()))));

			// Server mit eigenem Port: der Port bleibt erhalten (zum Beitreten nötig)
			status.addProperty("server", "mc.heldix-test.de:25570");
			friendSocket.sendText(status.toString(), true).get(5, TimeUnit.SECONDS);
			t.waitSoft(mc -> Social.friends().stream().anyMatch(f -> "mc.heldix-test.de:25570".equals(f.server())), 10);
			t.check("Server mit Port: mc.heldix-test.de:25570", t.compute(mc -> Social.friends().stream().anyMatch(f -> "mc.heldix-test.de:25570".equals(f.server()))));
			status.addProperty("server", "hypixel.net");
			friendSocket.sendText(status.toString(), true).get(5, TimeUnit.SECONDS);
			t.waitSoft(mc -> Social.friends().stream().anyMatch(f -> "hypixel.net".equals(f.server())), 10);
			t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.FRIENDS));
			t.waitTicks(8);
			// Köpfe in Listen: echter Skin per UUID (öffentliches Profil von Notch), nicht der Standard-Skin
			UUID notch = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");
			String standard = t.compute(mc -> dev.heldixclient.screen.FriendWidget.skinOf(notch, "Notch").body().texturePath().toString());
			t.waitSoft(mc -> !dev.heldixclient.screen.FriendWidget.skinOf(notch, "Notch").body().texturePath().toString().equals(standard), 20);
			String loaded = t.compute(mc -> dev.heldixclient.screen.FriendWidget.skinOf(notch, "Notch").body().texturePath().toString());
			t.check("Kopf mit echtem Skin (" + standard + " → " + loaded + ")", !loaded.equals(standard) && !loaded.contains("entity/player/"));
			t.check("Knopf „Beitreten“ bei der Freundin (hypixel.net)", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).canJoin(friendId)));
			t.screenshot("heldix-27-freunde");
			AutoTest.openPage(t, "PRIVACY");
			t.moveMouse(5, 5);
			t.waitTicks(4);
			t.screenshot("heldix-27b-privatsphaere");

			// Nachrichten: Freundin schreibt, ungelesen in der Seitenleiste, Chat öffnen, antworten, melden
			UUID ownId = t.compute(mc -> mc.getUser().getProfileId());
			JsonObject hello = new JsonObject();
			hello.addProperty("text", "Hallo! Kommst du mit auf hypixel.net?");
			request(base, "POST", "/v1/messages/" + Social.compact(ownId), hello, token);
			t.waitSoft(mc -> Messages.unread(friendId) >= 1, 10);
			t.check("Nachricht kommt in Echtzeit an (ungelesen)", t.compute(mc -> Messages.unread(friendId)) == 1);
			t.check("Reiter Nachrichten zeigt die ungelesene Nachricht", "1".equals(t.compute(mc -> Shell.badge(Shell.Page.MESSAGES))));
			t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.MESSAGES));
			t.waitSoft(mc -> Messages.conversationsLoaded() && !Messages.conversations().isEmpty(), 10);
			t.check("Unterhaltung in der Liste", t.compute(mc -> Messages.conversations().stream().anyMatch(c -> c.uuid().equals(friendId))));
			t.moveMouse(5, 5);
			t.waitTicks(4);
			t.screenshot("heldix-27c-nachrichten");
			t.setScreen(() -> new HeldixMenuScreen(null, friendId, "Freundin"));
			t.waitSoft(mc -> !Messages.history(friendId).isEmpty(), 10);
			t.waitSoft(mc -> Messages.unread(friendId) == 0, 5);
			t.check("Offener Chat gilt als gelesen", t.compute(mc -> Messages.unread(friendId)) == 0);
			// Tippen wie mit der Tastatur: das Feld muss die Texteingabe anmelden (Minecraft 26.x), sonst kommt nichts an
			t.check("Chat-Feld meldet die Texteingabe an", t.compute(FeatureTests::textInputEnabled));
			t.run(mc -> mc.keyboardHandler.textInput(mc.getWindow().handle(), "Getippt im Chat"));
			t.pressKey(InputConstants.KEY_RETURN);
			t.waitSoft(mc -> Messages.history(friendId).stream().anyMatch(m -> m.text().equals("Getippt im Chat")), 10);
			t.check("Getippte Nachricht mit Enter gesendet", t.compute(mc -> Messages.history(friendId).stream().anyMatch(m -> m.text().equals("Getippt im Chat"))));
			java.util.concurrent.CompletableFuture<Void> sent = t.compute(mc -> Messages.send(friendId, "Klar, bin gleich da!"));
			sent.get(10, TimeUnit.SECONDS);
			t.waitSoft(mc -> Messages.history(friendId).size() >= 2, 10);
			JsonObject chat = request(base, "GET", "/v1/messages/" + Social.compact(ownId), null, token);
			t.check("Antwort kommt bei der Freundin an", chat.toString().contains("Klar, bin gleich da!"));
			JsonObject link = new JsonObject();
			link.addProperty("text", "Super! Die Neuigkeiten stehen hier: https://heldixclient.com/neuigkeiten");
			request(base, "POST", "/v1/messages/" + Social.compact(ownId), link, token);
			t.waitSoft(mc -> Messages.history(friendId).stream().anyMatch(m -> m.text().contains("heldixclient.com/neuigkeiten")), 10);
			t.moveMouse(5, 5);
			t.waitTicks(6);
			t.screenshot("heldix-27d-chat");
			java.util.concurrent.CompletableFuture<Void> reported = t.compute(mc -> Messages.report(friendId, "other", "Autotest"));
			String reportResult;
			try {
				reported.get(10, TimeUnit.SECONDS);
				reportResult = "ok";
			} catch (Exception e) {
				reportResult = String.valueOf(e.getCause() != null ? e.getCause().getMessage() : e.getMessage());
			}
			t.check("Melden geht (" + reportResult + ")", "ok".equals(reportResult));

			// Heldix-Symbol vor dem eigenen Namen in der Tab-Liste
			t.setScreen(() -> null);
			boolean badge = t.compute(mc -> {
				PlayerInfo info = mc.getConnection().getPlayerInfo(mc.getUser().getProfileId());
				return info != null && Hooks.tabName(Component.literal(mc.getUser().getName()), info).getString().startsWith(Badge.CHAR);
			});
			t.check("Heldix-Symbol vor dem eigenen Namen in der Tab-Liste", badge);
			for (int i = 0; i < 6; i++) {
				t.run(mc -> mc.options.keyPlayerList.setDown(true));
				t.waitTicks(1);
			}
			t.screenshot("heldix-28-tabliste");
			t.run(mc -> mc.options.keyPlayerList.setDown(false));

			// Cape einer anderen HeldixClient-Spielerin: Spielerin nur auf dem Client vor uns hinstellen
			t.run(mc -> {
				RemotePlayer player = new RemotePlayer(mc.level, new GameProfile(friendId, "Freundin"));
				player.setId(-4242); // nur auf dem Client: eigene, freie Nummer
				player.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3.5, 0f, 0f);
				player.yBodyRot = 0f;
				player.yHeadRot = 0f;
				mc.level.addEntity(player);
				remote[0] = player;
			});
			t.waitSoft(mc -> "glut".equals(Social.capeOf(friendId)), 10);
			t.check("Dienst meldet das Cape der Freundin", "glut".equals(t.compute(mc -> Social.capeOf(friendId))));
			t.waitSoft(mc -> remote[0].getSkin().cape() != null && remote[0].getSkin().cape().texturePath().getPath().contains("cape/glut"), 10);
			t.check("Freundin trägt ihr Heldix-Cape", t.compute(mc -> remote[0].getSkin().cape() != null
					&& remote[0].getSkin().cape().texturePath().getPath().contains("cape/glut")));
			t.waitTicks(10);
			t.screenshot("heldix-29-cape-anderer-spieler");

			// Blockieren: Freundschaft und Chat weg, Freundin kann keine Anfrage mehr schicken; dann freigeben
			t.run(mc -> Messages.block(friendId));
			t.waitSoft(mc -> Social.friends().isEmpty() && Messages.blocked().stream().anyMatch(b -> b.uuid().equals(friendId)), 10);
			t.check("Blockiert: Freundschaft weg, Freundin in der Liste der Blockierten",
					t.compute(mc -> Social.friends().isEmpty() && Messages.blocked().stream().anyMatch(b -> b.uuid().equals(friendId))));
			String blockedReply;
			try {
				request(base, "POST", "/v1/friends/requests", friendRequest, token);
				blockedReply = "angenommen";
			} catch (IllegalStateException e) {
				blockedReply = e.getMessage();
			}
			t.check("Blockierte Spielerin kann keine Anfrage schicken (" + blockedReply + ")", blockedReply.contains(": 404 "));
			String chatAfterBlock;
			try {
				chatAfterBlock = request(base, "GET", "/v1/messages/" + Social.compact(ownId), null, token).toString();
			} catch (IllegalStateException e) {
				chatAfterBlock = e.getMessage();
			}
			t.check("Chat nach dem Blockieren gelöscht", !chatAfterBlock.contains("Klar, bin gleich da!"));
			t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.PRIVACY));
			t.waitTicks(8);
			t.screenshot("heldix-27e-blockiert");
			t.run(mc -> Messages.unblock(friendId));
			t.waitSoft(mc -> Messages.blocked().isEmpty(), 10);
			t.check("Freigegeben", t.compute(mc -> Messages.blocked().isEmpty()));
			t.setScreen(() -> null);
			t.check("Freundin entfernt", t.compute(mc -> Social.friends().stream().noneMatch(f -> f.uuid().equals(friendId))));

			// Daten beim Dienst löschen: danach ist der Dienst aus und kennt den Spieler nicht mehr
			t.run(mc -> Social.deleteAccount());
			t.waitSoft(mc -> Social.state() == Social.State.OFF, 10);
			t.check("Daten beim Dienst gelöscht, Dienst ausgeschaltet", t.compute(mc -> Social.state() == Social.State.OFF && !HeldixConfig.get().socialEnabled));
			String unknown;
			try {
				request(base, "POST", "/v1/friends/requests", friendRequest, token);
				unknown = "noch bekannt";
			} catch (IllegalStateException e) {
				unknown = e.getMessage();
			}
			t.check("Dienst kennt den Spieler nach dem Löschen nicht mehr (" + unknown + ")", unknown.contains(": 404 "));
			t.run(mc -> Social.setEnabled(true));
			t.waitSoft(mc -> Social.online(), 15);
			t.check("Dienst wieder eingeschaltet", t.compute(mc -> Social.online() && HeldixConfig.get().socialEnabled));
		} catch (Exception e) {
			LOG_FAIL(t, e);
		} finally {
			if (friendSocket != null) friendSocket.abort();
			if (remote[0] != null) t.run(mc -> mc.level.removeEntity(remote[0].getId(), Entity.RemovalReason.DISCARDED));
		}
	}

	private static void LOG_FAIL(TestContext t, Exception e) {
		AutoTest.LOG.error("Heldix-Dienst-Test fehlgeschlagen", e);
		t.check("Heldix-Dienst-Test ohne Fehler (" + e + ")", false);
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
}
