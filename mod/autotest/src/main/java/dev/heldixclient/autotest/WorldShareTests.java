package dev.heldixclient.autotest;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.screen.HeldixWorldsScreen;
import dev.heldixclient.screen.PauseMenuScreen;
import dev.heldixclient.screen.ShareWorldScreen;
import dev.heldixclient.screen.ToggleChip;
import dev.heldixclient.share.KnockPrompt;
import dev.heldixclient.share.WorldBackups;
import dev.heldixclient.share.WorldService;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.social.Social;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.world.level.storage.LevelResource;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * „Welt teilen“ (Heldix-Dienst 1.12.0, Client 0.13.8) in der Testwelt:
 * <ol>
 *   <li>Pausemenü → „Welt teilen“ → „Teilen starten“: Sicherung entsteht, heldix-welt.json mit der ID, Adresse
 *   {@code <code>.welt.<Domain>}, Steuerverbindung bereit, Statuszeile und Voice-Raum mit der Weltadresse.</li>
 *   <li>Eine Freundin (über die Schnittstelle) wird über „Freunde einladen“ eingeladen: Mitglied, Echtzeit
 *   {@code world-invite} bei ihr, die Welt steht in ihrer Liste.</li>
 *   <li>Ein Test-Client spricht per TCP mit dem Relay des lokalen Dienstes ({@code -Dheldixclient.welt.testPort}): Status
 *   mit unserem MOTD und der Spielerzahl, ein nicht Eingeladener wird getrennt und klopft an (Einblendung beim Gastgeber),
 *   Erlauben per Taste macht ihn zum Mitglied, danach reicht der Dienst seinen Login zu uns durch (Verschlüsselungsanfrage
 *   des eingebauten Servers); Ablehnen per Taste.</li>
 *   <li>Einladung in eine fremde Welt (Echtzeit), Seite Heldix-Welten (eigene Welten, Sicherungen), „Teilen beenden“:
 *   Status „nicht geöffnet“ über das Relay. Zum Schluss wird die Welt beim Dienst gelöscht.</li>
 * </ol>
 * Ohne Dienst bzw. ohne Welt-Funktion beim Dienst endet der Test mit der Meldung; ohne Test-Port fehlt nur der
 * Relay-Teil. Ein vollständiger zweiter Minecraft-Client ist nicht möglich (Login braucht Mojang).
 */
final class WorldShareTests {
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
	private static final Pattern ADDRESS = Pattern.compile("^[a-hjkmnp-z2-9]{6}\\.welt\\.[a-z0-9.-]+$");

	private WorldShareTests() {
	}

	static void run(TestContext t) throws Exception {
		if (!t.compute(mc -> Social.online())) {
			t.log("Heldix-Dienst nicht verbunden: Welt teilen übersprungen");
			return;
		}
		if (!t.compute(mc -> mc.getSingleplayerServer() != null)) {
			t.log("Keine Einzelspielerwelt: Welt teilen übersprungen");
			return;
		}
		String base = t.compute(mc -> Social.baseUrl());
		boolean notifications = t.compute(mc -> config().socialNotifications);
		t.run(mc -> config().socialNotifications = true);
		Friend friend = null;
		String worldId = null;
		try {
			friend = friend(t, base);
			worldId = start(t);
			if (worldId == null) return;
			invite(t, base, friend, worldId);
			int port = Integer.getInteger("heldixclient.welt.testPort", 0);
			if (port > 0) relay(t, port);
			else t.log("Ohne -Dheldixclient.welt.testPort: Relay-Teil (Status, Anklopfen, Erlauben) übersprungen");
			invited(t);
			worldsPage(t, worldId);
			stop(t, port);
		} finally {
			t.run(mc -> {
				if (WorldShare.active()) WorldShare.stop();
				config().socialNotifications = notifications;
				mc.gui.setScreen(null);
			});
			if (worldId != null) {
				try {
					WorldService.delete(worldId).get(10, TimeUnit.SECONDS);
					t.log("Welt teilen: Testwelt beim Dienst gelöscht");
				} catch (Exception e) {
					t.log("Welt teilen: Testwelt nicht gelöscht (" + e + ")");
				}
			}
			if (friend != null) {
				if (friend.socket != null) friend.socket.abort();
				UUID id = friend.uuid;
				try {
					t.compute(mc -> Social.removeFriend(id)).get(10, TimeUnit.SECONDS);
				} catch (Exception e) {
					t.log("Welt teilen: Freundschaft nicht gelöst (" + e + ")");
				}
			}
		}
	}

	private static dev.heldixclient.config.HeldixConfig.Data config() {
		return dev.heldixclient.config.HeldixConfig.get();
	}

	// ======================================================================================
	// Start
	// ======================================================================================

	/** Pausemenü → Welt teilen → Teilen starten; ID der Welt beim Dienst oder null (Dienst ohne Welt teilen) */
	private static String start(TestContext t) throws Exception {
		t.setScreen(() -> new PauseScreen(true));
		t.waitTicks(5);
		t.check("Welt teilen: Heldix-Pausemenü offen", t.compute(mc -> mc.gui.screen() instanceof PauseMenuScreen));
		if (t.compute(mc -> hasWidget(mc, PauseMenuScreen.SHARE_BUTTON))) {
			t.clickWidget(PauseMenuScreen.SHARE_BUTTON);
		} else {
			t.log("Pausemenü ohne Platz für „Welt teilen“ (kleines Fenster): Dialog direkt geöffnet");
			t.setScreen(ShareWorldScreen::new);
		}
		t.waitTicks(5);
		t.check("Welt teilen: Dialog mit den Einstellungen", t.compute(mc -> mc.gui.screen() instanceof ShareWorldScreen screen
				&& screen.mode() == ShareWorldScreen.Mode.SETUP && hasWidget(mc, ShareWorldScreen.START_LABEL)));
		List<String> texts = t.compute(mc -> ((ShareWorldScreen) mc.gui.screen()).describe());
		t.check("Welt teilen: Zugang, Rolle für Neue, Höchstspieler, Spielmodus, Cheats (" + texts + ")", texts.contains("Wer darf rein")
				&& texts.contains("Rolle für Neue") && texts.contains("Höchstspieler") && texts.contains("Spielmodus der Welt") && texts.contains("Cheats")
				&& t.compute(mc -> hasWidget(mc, "Nur Eingeladene") && hasWidget(mc, "Mitspieler")));
		t.moveMouse(5, 5);
		t.screenshot("welt-01-einstellungen");

		Path world = t.compute(mc -> mc.getSingleplayerServer().getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize());
		t.clickWidget(ShareWorldScreen.START_LABEL);
		t.waitSoft(mc -> WorldShare.state() == WorldShare.State.ONLINE || !WorldShare.active(), 60);
		String error = t.compute(mc -> WorldShare.error());
		if (!t.compute(mc -> WorldShare.active())) {
			if (error != null && (error.contains("1.12.0") || error.contains("nicht eingerichtet"))) {
				t.check("Welt teilen: Dienst ohne Welt teilen – verständliche Meldung (" + error + ")", true);
				t.log("Heldix-Dienst ohne Welt teilen: Rest übersprungen");
				return null;
			}
			t.check("Welt teilen: Teilen gestartet (" + error + ")", false);
		}
		t.check("Welt teilen: geöffnet, Steuerverbindung bereit (" + t.compute(mc -> WorldShare.state()) + ")",
				t.compute(mc -> WorldShare.state() == WorldShare.State.ONLINE && WorldShare.tunnelReady()));
		String address = t.compute(mc -> WorldShare.normalizeAddress(WorldShare.address()));
		t.check("Welt teilen: Adresse <code>.welt.<Domain> (" + address + ")", ADDRESS.matcher(address).matches());
		String worldId = t.compute(mc -> WorldShare.worldId());
		t.check("Welt teilen: heldix-welt.json im Weltordner mit der ID", worldId != null && worldId.equals(WorldBackups.readId(world)));

		// Sicherung vor dem Teilen: ZIP unter heldix-sicherungen/<Weltordner>/ mit level.dat, ohne session.lock
		Path backup = t.compute(mc -> WorldShare.lastBackup());
		Path folder = t.compute(mc -> WorldBackups.directory(mc.gameDirectory.toPath(), world.getFileName().toString()));
		t.check("Welt teilen: Sicherung entstanden (" + (backup == null ? "keine" : folder.getParent().getFileName() + "/" + folder.getFileName() + "/"
				+ backup.getFileName()) + ")", backup != null && Files.isRegularFile(backup) && backup.getParent().equals(folder) && Files.size(backup) > 0);
		List<String> entries = zipEntries(backup);
		t.check("Welt teilen: Sicherung enthält level.dat, aber nicht session.lock", entries.contains("level.dat") && !entries.contains("session.lock"));
		t.check("Welt teilen: höchstens " + WorldBackups.KEEP + " Sicherungen", t.compute(mc -> WorldBackups.list(mc.gameDirectory.toPath(),
				world.getFileName().toString()).size()) <= WorldBackups.KEEP);

		// intern als LAN offen, Statuszeile und Voice-Raum mit der Weltadresse
		t.check("Welt teilen: eingebauter Server offen auf einem lokalen Port (" + t.compute(mc -> WorldShare.lanPort()) + ")",
				t.compute(mc -> mc.getSingleplayerServer().isPublished() && WorldShare.lanPort() > 0));
		JsonObject status = t.compute(mc -> WorldShare.hostStatus());
		t.check("Welt teilen: Statuszeile world { address, host, players, max } (" + status + ")", status != null && address.equals(string(status, "address"))
				&& status.get("host").getAsBoolean() && status.get("players").getAsInt() == 1 && status.get("max").getAsInt() == 8);
		t.check("Welt teilen: Voice-Raum ist die Weltadresse", address.equals(t.compute(mc -> WorldShare.voiceServer())));

		// öffentlich (wie die Webseite): online, Gastgeber, Zugang geschlossen (nur Eingeladene)
		String code = address.substring(0, 6);
		JsonObject info = request("GET", t.compute(mc -> Social.baseUrl()) + "/v1/public/worlds/" + code, null, null);
		JsonObject host = info.has("host") && info.get("host").isJsonObject() ? info.getAsJsonObject("host") : new JsonObject();
		String ownName = t.compute(mc -> mc.getUser().getName());
		t.check("Welt teilen: öffentliche Angaben (online, Gastgeber, geschlossen)", info.has("online") && info.get("online").getAsBoolean()
				&& ownName.equals(string(host, "name")) && "closed".equals(string(info, "access")));

		t.waitTicks(4);
		t.moveMouse(5, 5);
		t.screenshot("welt-02-geteilt");
		return worldId;
	}

	// ======================================================================================
	// Freundin einladen
	// ======================================================================================

	private static final class Friend {
		UUID uuid;
		String name;
		String token;
		WebSocket socket;
		final List<String> messages = new CopyOnWriteArrayList<>();
	}

	/** zweite Spielerin über die Schnittstelle, befreundet und mit Echtzeit-Verbindung */
	private static Friend friend(TestContext t, String base) throws Exception {
		Friend friend = new Friend();
		friend.name = "Welt_" + ThreadLocalRandom.current().nextInt(10_000, 100_000);
		friend.uuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + friend.name).getBytes(StandardCharsets.UTF_8));
		JsonObject login = new JsonObject();
		login.addProperty("name", friend.name);
		login.addProperty("uuid", Social.compact(friend.uuid));
		friend.token = request("POST", base + "/v1/auth/dev", login, null).get("token").getAsString();
		friend.socket = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + friend.token)
				.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/ws"), new WebSocket.Listener() {
					private final StringBuilder buffer = new StringBuilder();

					@Override
					public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
						buffer.append(data);
						if (last) {
							friend.messages.add(buffer.toString());
							buffer.setLength(0);
						}
						webSocket.request(1);
						return null;
					}
				}).get(10, TimeUnit.SECONDS);
		JsonObject friendRequest = new JsonObject();
		String ownName = t.compute(mc -> mc.getUser().getName());
		friendRequest.addProperty("name", ownName);
		request("POST", base + "/v1/friends/requests", friendRequest, friend.token);
		t.waitSoft(mc -> Social.incoming().stream().anyMatch(r -> r.uuid().equals(friend.uuid)), 10);
		UUID id = friend.uuid;
		t.compute(mc -> Social.accept(id)).get(10, TimeUnit.SECONDS);
		t.waitSoft(mc -> Social.friends().stream().anyMatch(f -> f.uuid().equals(id)), 10);
		t.check("Welt teilen: Testfreundin ist befreundet", t.compute(mc -> Social.friends().stream().anyMatch(f -> f.uuid().equals(id))));
		return friend;
	}

	/** „Freunde einladen“ im Dialog: Freundin wird Mitglied, bekommt world-invite, sieht die Welt */
	private static void invite(TestContext t, String base, Friend friend, String worldId) throws Exception {
		t.setScreen(() -> new ShareWorldScreen(ShareWorldScreen.Mode.INVITE));
		t.waitTicks(5);
		int[] chip = t.widgetCenter(w -> w instanceof ToggleChip && w.getMessage().getString().startsWith(friend.name), "Freundin " + friend.name);
		t.click(chip[0], chip[1]);
		t.waitTicks(3);
		t.screenshot("welt-03-einladen");
		t.clickWidget("Einladen (1)");
		UUID id = friend.uuid;
		t.waitSoft(mc -> WorldShare.members().stream().anyMatch(m -> m.name().equalsIgnoreCase(friend.name)), 10);
		List<WorldService.Member> members = WorldService.members(worldId).get(10, TimeUnit.SECONDS);
		t.check("Welt teilen: eingeladene Freundin ist Mitglied (" + members.stream().map(WorldService.Member::name).toList() + ")",
				members.stream().anyMatch(m -> m.name().equalsIgnoreCase(friend.name) || id.equals(m.uuid())));
		long until = System.currentTimeMillis() + 10_000;
		while (System.currentTimeMillis() < until && friend.messages.stream().noneMatch(m -> m.contains("\"world-invite\""))) TestContext.sleep(100);
		JsonObject message = friend.messages.stream().filter(m -> m.contains("\"world-invite\"")).map(m -> JsonParser.parseString(m).getAsJsonObject())
				.findFirst().orElse(null);
		JsonObject world = message != null && message.has("world") && message.get("world").isJsonObject() ? message.getAsJsonObject("world") : null;
		t.check("Welt teilen: Freundin bekommt world-invite in Echtzeit", world != null && worldId.equals(string(world, "id")));
		JsonObject list = request("GET", base + "/v1/worlds", null, friend.token);
		boolean listed = false;
		if (list.has("friends") && list.get("friends").isJsonArray()) {
			for (JsonElement element : list.getAsJsonArray("friends")) {
				listed |= element.isJsonObject() && worldId.equals(string(element.getAsJsonObject(), "id"));
			}
		}
		t.check("Welt teilen: die Welt steht bei der Freundin unter „Von Freunden“", listed);
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Relay: Test-Client per TCP
	// ======================================================================================

	private static void relay(TestContext t, int port) throws Exception {
		String address = t.compute(mc -> WorldShare.normalizeAddress(WorldShare.address()));
		String motd = t.compute(mc -> mc.getSingleplayerServer().getMotd());
		int protocol = SharedConstants.getProtocolVersion();

		// Serverliste: Status kommt durch den Tunnel von unserem eingebauten Server
		JsonObject status = McClient.status(port, address, protocol);
		JsonObject players = status.has("players") && status.get("players").isJsonObject() ? status.getAsJsonObject("players") : new JsonObject();
		String description = text(status.get("description"));
		t.check("Relay: Status mit unserem MOTD (" + description + ")", !description.isBlank() && description.contains(motd));
		// Werbung in der Serverliste: Beschreibung mit Welt und „Geteilt mit HeldixClient“, Symbol mit Heldix-Logo
		String worldName = t.compute(mc -> mc.getSingleplayerServer().getWorldData().getLevelName());
		// ohne Minecraft-Farbcodes (§x) vergleichen
		String plain = description.replaceAll("§.", "");
		t.check("Serverliste: Beschreibung „… von <Gastgeber>“ und „Geteilt mit HeldixClient“ (" + plain.replace('\n', '/') + ")",
				plain.contains("Geteilt mit HeldixClient") && plain.contains(" von ")
						&& plain.contains(worldName.length() > 22 ? worldName.substring(0, 10) : worldName));
		String favicon = status.has("favicon") && status.get("favicon").isJsonPrimitive() ? status.get("favicon").getAsString() : "";
		int[] icon = {0, 0, 0};
		if (favicon.startsWith("data:image/png;base64,")) {
			byte[] png = java.util.Base64.getMimeDecoder().decode(favicon.substring("data:image/png;base64,".length()));
			try (com.mojang.blaze3d.platform.NativeImage image = com.mojang.blaze3d.platform.NativeImage.read(png)) {
				icon[0] = image.getWidth();
				icon[1] = image.getHeight();
				// oberer Rand der Plakette unten rechts: Heldix-Blau
				icon[2] = image.getWidth() == 64 ? image.getPixel(49, 36) : 0;
			}
		}
		int badge = icon[2];
		t.check("Serverliste: Symbol 64×64 mit Heldix-Plakette (" + icon[0] + "×" + icon[1] + ", Rand " + Integer.toHexString(badge) + ")",
				icon[0] == 64 && icon[1] == 64 && (badge & 0xFF) > ((badge >> 16) & 0xFF) + 40);
		t.check("Relay: Spielerzahl 1/8 (" + players + ")", players.has("online") && players.get("online").getAsInt() == 1
				&& players.has("max") && players.get("max").getAsInt() == 8);

		// nicht eingeladen: getrennt mit Meldung, beim Gastgeber klopft es an
		t.run(mc -> mc.gui.setScreen(null));
		t.waitTicks(3);
		String stranger = "Gast_" + ThreadLocalRandom.current().nextInt(10_000, 100_000);
		McClient.Answer answer = McClient.login(port, address, protocol, stranger);
		t.check("Relay: nicht Eingeladener wird getrennt (" + answer.text() + ")", answer.id() == 0x00 && answer.text().contains("noch nicht eingeladen"));
		t.waitSoft(mc -> WorldShare.knocks().stream().anyMatch(k -> k.name().equals(stranger)), 10);
		t.check("Relay: Anklopfen kommt beim Gastgeber an", t.compute(mc -> WorldShare.knocks().stream().anyMatch(k -> k.name().equals(stranger))));
		t.check("Relay: Einblendung „… möchte beitreten“ im Spiel", t.compute(mc -> KnockPrompt.visible(mc)));
		t.screenshot("welt-04-anklopfen");

		// Erlauben per Taste: wird Mitglied, danach reicht der Dienst den Login zu uns durch.
		// Tasten auf den Standard setzen – eine ältere options.txt der Testinstanz kann eine frühere Belegung enthalten.
		t.run(mc -> {
			HeldixClient.knockAllowKey.setKey(HeldixClient.knockAllowKey.getDefaultKey());
			HeldixClient.knockDenyKey.setKey(HeldixClient.knockDenyKey.getDefaultKey());
			net.minecraft.client.KeyMapping.resetMapping();
		});
		int allowKey = t.compute(mc -> HeldixClient.knockAllowKey.getDefaultKey().getValue());
		t.pressKey(allowKey);
		t.waitSoft(mc -> WorldShare.knocks().isEmpty(), 5);
		t.check("Relay: Taste „Erlauben“ beantwortet das Anklopfen", t.compute(mc -> WorldShare.knocks().stream().noneMatch(k -> k.name().equals(stranger))));
		String worldId = t.compute(mc -> WorldShare.worldId());
		boolean member = false;
		for (int i = 0; i < 20 && !member; i++) {
			member = WorldService.members(worldId).get(10, TimeUnit.SECONDS).stream().anyMatch(m -> m.name().equalsIgnoreCase(stranger));
			if (!member) TestContext.sleep(250);
		}
		t.check("Relay: Erlauben macht " + stranger + " zum Mitglied", member);
		McClient.Answer again = McClient.login(port, address, protocol, stranger);
		t.check("Relay: Login des Mitglieds kommt bei unserem Server an (Verschlüsselungsanfrage, Paket " + again.id() + ")", again.id() == 0x01);

		// Ablehnen per Taste
		String other = "Gast_" + ThreadLocalRandom.current().nextInt(10_000, 100_000);
		McClient.login(port, address, protocol, other);
		t.waitSoft(mc -> WorldShare.knocks().stream().anyMatch(k -> k.name().equals(other)), 10);
		int denyKey = t.compute(mc -> HeldixClient.knockDenyKey.getDefaultKey().getValue());
		t.pressKey(denyKey);
		t.waitSoft(mc -> WorldShare.knocks().isEmpty(), 5);
		t.check("Relay: Taste „Ablehnen“ beantwortet das Anklopfen, kein Mitglied", t.compute(mc -> WorldShare.knocks().isEmpty())
				&& WorldService.members(worldId).get(10, TimeUnit.SECONDS).stream().noneMatch(m -> m.name().equalsIgnoreCase(other)));
	}

	// ======================================================================================
	// Einladung in eine fremde Welt, Seite Heldix-Welten, Beenden
	// ======================================================================================

	private static void invited(TestContext t) {
		t.run(mc -> Notifications.clear());
		t.run(mc -> dev.heldixclient.share.WorldInvites.testInvite(JsonParser.parseString("{\"type\":\"world-invite\",\"world\":{\"id\":\"" + "ab".repeat(16)
				+ "\",\"name\":\"Inselwelt\",\"address\":\"k7m2xq.welt.test\",\"host\":{\"uuid\":\"" + "cd".repeat(16) + "\",\"name\":\"Testfreund\"}}}")
				.getAsJsonObject()));
		t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.contains("lädt dich in seine Welt ein")), 5);
		t.check("Einladung in eine Welt: Einblendung „Testfreund lädt dich in seine Welt ein“", t.compute(mc -> Notifications.current().stream()
				.anyMatch(n -> n.startsWith("Testfreund lädt dich in seine Welt ein"))));
	}

	private static void worldsPage(TestContext t, String worldId) {
		t.setScreen(HeldixWorldsScreen::new);
		t.waitFor("Heldix-Welten geladen", mc -> mc.gui.screen() instanceof HeldixWorldsScreen screen && screen.loaded(), 15);
		List<String> friends = t.compute(mc -> ((HeldixWorldsScreen) mc.gui.screen()).describe());
		t.check("Heldix-Welten: Einladung „Inselwelt“ unter „Von Freunden“ mit Beitreten", friends.contains("Inselwelt")
				&& t.compute(mc -> hasWidget(mc, HeldixWorldsScreen.JOIN_LABEL)));
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).showMine());
		t.waitTicks(3);
		String name = t.compute(mc -> mc.getSingleplayerServer().getWorldData().getLevelName());
		List<String> mine = t.compute(mc -> ((HeldixWorldsScreen) mc.gui.screen()).describe());
		t.check("Heldix-Welten: eigene Welt mit Adresse (" + mine + ")", mine.stream().anyMatch(s -> s.startsWith(name))
				&& mine.stream().anyMatch(s -> s.contains(".welt.")));
		t.moveMouse(5, 5);
		t.screenshot("welt-05-heldix-welten");
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).showBackups(worldId));
		t.waitTicks(3);
		List<String> backups = t.compute(mc -> ((HeldixWorldsScreen) mc.gui.screen()).describe());
		t.check("Heldix-Welten: Sicherungen der offenen Welt, Wiederherstellen gesperrt (" + backups + ")",
				backups.stream().anyMatch(s -> s.contains("gerade geöffnet")) && !t.compute(mc -> activeWidget(mc, "Wiederherstellen")));
		t.screenshot("welt-06-sicherungen");
		t.setScreen(() -> null);
	}

	private static void stop(TestContext t, int port) throws Exception {
		String address = t.compute(mc -> WorldShare.normalizeAddress(WorldShare.address()));
		t.setScreen(ShareWorldScreen::new);
		t.waitTicks(5);
		t.check("Welt teilen: Status mit Adresse, Kopieren und Beenden", t.compute(mc -> mc.gui.screen() instanceof ShareWorldScreen screen
				&& screen.mode() == ShareWorldScreen.Mode.STATUS && hasWidget(mc, ShareWorldScreen.COPY_LABEL) && hasWidget(mc, ShareWorldScreen.STOP_LABEL)));
		t.run(mc -> mc.keyboardHandler.setClipboard(""));
		t.clickWidget(ShareWorldScreen.COPY_LABEL);
		t.check("Welt teilen: „Adresse kopieren“ legt die Adresse in die Zwischenablage", address.equals(t.compute(mc -> mc.keyboardHandler.getClipboard().strip())));
		t.clickWidget(ShareWorldScreen.STOP_LABEL);
		t.waitSoft(mc -> !WorldShare.active(), 10);
		t.check("Welt teilen: beendet, LAN wieder zu", t.compute(mc -> !WorldShare.active() && !mc.getSingleplayerServer().isPublished()));
		t.check("Welt teilen: Beschreibung der Welt wieder wie vorher (ohne Werbung)",
				t.compute(mc -> !mc.getSingleplayerServer().getMotd().contains("HeldixClient")));
		if (port <= 0) return;
		String description = "";
		// höchstens 8 Versuche: das Relay lässt je IP nur 20 neue Verbindungen pro Minute zu
		for (int i = 0; i < 8 && !description.contains("nicht geöffnet"); i++) {
			description = text(McClient.status(port, address, SharedConstants.getProtocolVersion()).get("description"));
			if (!description.contains("nicht geöffnet")) TestContext.sleep(500);
		}
		t.check("Relay: nach dem Beenden „nicht geöffnet“ (" + description + ")", description.contains("nicht geöffnet"));
		// Dienst ab 1.12.1: auch die geschlossene Welt wirbt in der Serverliste
		t.check("Relay: geschlossene Welt mit „Geteilt mit HeldixClient“ in der Serverliste", description.contains("Geteilt mit HeldixClient"));
	}

	// ======================================================================================
	// Minecraft-Protokoll (nur Handshake, Status, Login Start)
	// ======================================================================================

	/** auch für HostingTests (Relay der dauerhaften Welten) */
	static final class McClient {
		/** erstes Paket der Antwort: Paket-ID und (bei Trennen/Status) der Text */
		record Answer(int id, String text) {
		}

		static JsonObject status(int port, String address, int protocol) throws IOException {
			try (Socket socket = open(port)) {
				OutputStream out = socket.getOutputStream();
				out.write(packet(0x00, handshake(protocol, address, port, 1)));
				out.write(packet(0x00, new byte[0]));
				out.flush();
				DataInputStream in = new DataInputStream(socket.getInputStream());
				byte[] body = readPacket(in);
				DataInputStream data = new DataInputStream(new java.io.ByteArrayInputStream(body));
				int id = readVarInt(data);
				if (id != 0x00) throw new IOException("Status: Paket " + id + " statt 0");
				return JsonParser.parseString(readString(data)).getAsJsonObject();
			}
		}

		static Answer login(int port, String address, int protocol, String name) throws IOException {
			try (Socket socket = open(port)) {
				OutputStream out = socket.getOutputStream();
				out.write(packet(0x00, handshake(protocol, address, port, 2)));
				ByteArrayOutputStream start = new ByteArrayOutputStream();
				DataOutputStream data = new DataOutputStream(start);
				writeString(data, name);
				UUID uuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
				data.writeLong(uuid.getMostSignificantBits());
				data.writeLong(uuid.getLeastSignificantBits());
				out.write(packet(0x00, start.toByteArray()));
				out.flush();
				DataInputStream in = new DataInputStream(socket.getInputStream());
				byte[] body = readPacket(in);
				DataInputStream answer = new DataInputStream(new java.io.ByteArrayInputStream(body));
				int id = readVarInt(answer);
				String text = id == 0x00 ? text(JsonParser.parseString(readString(answer))) : "";
				return new Answer(id, text);
			}
		}

		private static Socket open(int port) throws IOException {
			Socket socket = new Socket();
			socket.connect(new InetSocketAddress("127.0.0.1", port), 5000);
			socket.setSoTimeout(15_000);
			return socket;
		}

		private static byte[] handshake(int protocol, String address, int port, int intent) throws IOException {
			ByteArrayOutputStream bytes = new ByteArrayOutputStream();
			DataOutputStream data = new DataOutputStream(bytes);
			writeVarInt(data, protocol);
			writeString(data, address);
			data.writeShort(port);
			writeVarInt(data, intent);
			return bytes.toByteArray();
		}

		private static byte[] packet(int id, byte[] body) throws IOException {
			ByteArrayOutputStream inner = new ByteArrayOutputStream();
			DataOutputStream data = new DataOutputStream(inner);
			writeVarInt(data, id);
			data.write(body);
			ByteArrayOutputStream framed = new ByteArrayOutputStream();
			DataOutputStream out = new DataOutputStream(framed);
			writeVarInt(out, inner.size());
			out.write(inner.toByteArray());
			return framed.toByteArray();
		}

		private static byte[] readPacket(DataInputStream in) throws IOException {
			int length = readVarInt(in);
			if (length <= 0 || length > 2 * 1024 * 1024) throw new IOException("Paketlänge " + length);
			byte[] body = new byte[length];
			in.readFully(body);
			return body;
		}

		private static void writeVarInt(DataOutputStream out, int value) throws IOException {
			while ((value & ~0x7F) != 0) {
				out.writeByte((value & 0x7F) | 0x80);
				value >>>= 7;
			}
			out.writeByte(value);
		}

		private static int readVarInt(InputStream in) throws IOException {
			int value = 0;
			for (int i = 0; i < 5; i++) {
				int b = in.read();
				if (b < 0) throw new EOFException("Verbindung zu");
				value |= (b & 0x7F) << (7 * i);
				if ((b & 0x80) == 0) return value;
			}
			throw new IOException("VarInt zu lang");
		}

		private static void writeString(DataOutputStream out, String text) throws IOException {
			byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
			writeVarInt(out, bytes.length);
			out.write(bytes);
		}

		private static String readString(DataInputStream in) throws IOException {
			int length = readVarInt(in);
			if (length < 0 || length > 1 << 20) throw new IOException("Textlänge " + length);
			byte[] bytes = new byte[length];
			in.readFully(bytes);
			return new String(bytes, StandardCharsets.UTF_8);
		}
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	/** Text einer Minecraft-Textkomponente (String, {text, extra} oder Liste) */
	static String text(JsonElement element) {
		if (element == null || element.isJsonNull()) return "";
		if (element.isJsonPrimitive()) return element.getAsString();
		StringBuilder text = new StringBuilder();
		if (element.isJsonArray()) {
			for (JsonElement part : element.getAsJsonArray()) text.append(text(part));
			return text.toString();
		}
		JsonObject object = element.getAsJsonObject();
		if (object.has("text")) text.append(object.get("text").getAsString());
		if (object.has("translate")) text.append(object.get("translate").getAsString());
		if (object.has("extra") && object.get("extra").isJsonArray()) {
			JsonArray extra = object.getAsJsonArray("extra");
			for (JsonElement part : extra) text.append(text(part));
		}
		return text.toString();
	}

	private static List<String> zipEntries(Path zip) throws IOException {
		List<String> names = new java.util.ArrayList<>();
		if (zip == null) return names;
		try (java.util.zip.ZipFile file = new java.util.zip.ZipFile(zip.toFile())) {
			file.stream().forEach(entry -> names.add(entry.getName()));
		}
		return names;
	}

	private static boolean hasWidget(net.minecraft.client.Minecraft mc, String label) {
		if (mc.gui.screen() == null) return false;
		for (GuiEventListener child : mc.gui.screen().children()) {
			if (child instanceof AbstractWidget widget && widget.visible && widget.getMessage().getString().equals(label)) return true;
		}
		return false;
	}

	private static boolean activeWidget(net.minecraft.client.Minecraft mc, String label) {
		if (mc.gui.screen() == null) return false;
		for (GuiEventListener child : mc.gui.screen().children()) {
			if (child instanceof AbstractWidget widget && widget.visible && widget.active && widget.getMessage().getString().equals(label)) return true;
		}
		return false;
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}

	/** Anfrage an den Dienst; Fehler mit Status, ohne Token im Text */
	private static JsonObject request(String method, String url, JsonObject body, String token) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
				.header("Content-Type", "application/json")
				.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
		if (token != null) request.header("Authorization", "Bearer " + token);
		HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
		String shown = URI.create(url).getPath();
		if (response.statusCode() >= 400) throw new IllegalStateException(method + " " + shown + ": " + response.statusCode() + " " + response.body());
		JsonElement json = response.body().isBlank() ? new JsonObject() : JsonParser.parseString(response.body());
		return json.isJsonObject() ? json.getAsJsonObject() : new JsonObject();
	}
}
