package dev.heldixclient.autotest;

import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.Registration;
import dev.heldixclient.api.ServerInfo;
import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.hud.ServerHud;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.serverlink.FabricNetworking;
import dev.heldixclient.serverlink.Partners;
import dev.heldixclient.serverlink.ServerLink;
import dev.heldixclient.serverlink.ServerPayload;
import dev.heldixclient.serverlink.ServerRules;
import dev.heldixclient.social.Party;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Language;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.voice.VoiceLink;
import dev.heldixclient.waypoint.Waypoints;
import io.netty.buffer.Unpooled;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.Identifier;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Server-Schnittstelle (HeldixClient 0.14.1, Addon-API 11, Plugin „HeldixClient Server“ 1.0.0) und „Im Launcher“.
 *
 * <ol>
 *   <li>{@link #inWorld}: in der Testwelt, ohne Server – Codec-Eingriff (Rundreise in beide Richtungen, andere Kanäle wie bei
 *   Minecraft), dann ein simulierter Server, der die Client-Logik direkt mit Nachrichten füttert: welcome, rules (Module
 *   gesperrt, Hinweis, API 11 mit Ereignis), hud_set/remove/clear (Grenzen, §-Codes, anklickbar mit hud_click), toast
 *   (1 je 5 s), kaputte und zu große Nachrichten; Partnerliste (Domains, Subdomains, Ports), Sprache, Server-Gruppe im
 *   Sprachkanal und Freunde bzw. Party-Mitglieder „Im Launcher“.</li>
 *   <li>{@link #realServer}: mit echtem Paper-Server samt Plugin, wenn {@code HELDIX_AUTOTEST_PAPER} (Paper-Jar 26.3) und
 *   {@code HELDIX_AUTOTEST_PLUGIN} (HeldixClient-Server-1.0.0.jar) gesetzt sind: Server starten (offline-mode, eigener
 *   Port), beitreten, register/hello → welcome/rules aus der config.yml, {@code /heldix test-hud} in der Konsole → HUD und
 *   Einblendung, Klick, verlassen, Server stoppen.</li>
 * </ol>
 */
final class ServerLinkTests {
	private static final String TEST_ADDRESS = "play.heldix-test.example";

	private ServerLinkTests() {
	}

	// ======================================================================================
	// 1. In der Testwelt: Codec und Client-Logik
	// ======================================================================================

	static void inWorld(TestContext t) {
		List<String> problems = HeldixLoader.problems();
		t.check("Server-Kanal: Eingriffe ohne Problem beim Loader", problems.stream().noneMatch(p -> p.contains("ServerLinkPatches") || p.contains("DiscardedPayload")));
		t.check("Server-Kanal: verfügbar (Eingriff in DiscardedPayload aktiv" + (FabricNetworking.registered() ? ", bei Fabric API angemeldet" : "") + ")",
				t.compute(mc -> ServerLink.available()));
		codec(t);

		HeldixApi api = t.compute(mc -> AddonManager.addons().stream().filter(LoadedAddon::isActive).map(LoadedAddon::api)
				.filter(java.util.Objects::nonNull).findFirst().orElse(null));
		AtomicInteger changes = new AtomicInteger();
		CopyOnWriteArrayList<ServerInfo> seen = new CopyOnWriteArrayList<>();
		Registration listener = api == null ? null : t.compute(mc -> api.events().onServerInfoChange(info -> {
			changes.incrementAndGet();
			seen.add(info);
		}));
		t.check("API 11: Stufe 11", HeldixApi.API_VERSION == 11);

		// --- simulierter Server ---------------------------------------------------------------
		t.run(mc -> ServerLink.simulateServer(TEST_ADDRESS));
		t.check("Server: betreten, noch kein Heldix", t.compute(mc -> ServerLink.info().connected() && !ServerLink.info().heldix()));
		t.check("welcome: verstanden", t.compute(mc -> ServerLink.handle("{\"t\":\"welcome\",\"v\":1,\"server\":\"§aTest§r-Server\",\"partner\":\"test-partner\"}")));
		t.check("welcome: Server spricht Heldix, Name ohne §-Codes", t.compute(mc -> ServerLink.info().heldix() && "Test-Server".equals(ServerLink.info().name())));
		t.check("welcome: Partner-Hinweis allein macht keinen Partner", t.compute(mc -> !ServerLink.info().partner()));

		// Module, die gleich gesperrt werden, einschalten (Einstellung des Spielers bleibt)
		Module coordinates = module(t, "coordinates");
		Module freelook = module(t, "freelook");
		Module waypoints = module(t, "waypoints");
		boolean coordinatesWas = t.compute(mc -> coordinates.isEnabled());
		boolean freelookWas = t.compute(mc -> freelook.isEnabled());
		boolean zoomWas = t.compute(mc -> ModuleManager.zoom.isEnabled());
		t.run(mc -> {
			coordinates.setEnabled(true);
			freelook.setEnabled(true);
			ModuleManager.zoom.setEnabled(true);
			Notifications.clear();
		});
		t.check("rules: verstanden", t.compute(mc -> ServerLink.handle(
				"{\"t\":\"rules\",\"v\":1,\"disable\":[\"freelook\",\"zoom\",\"coordinates\",\"waypoints\",\"minimap\",\"Mein.Addon-Regel\",\"ungültig!\",5],\"neu\":true}")));
		t.check("rules: bekannte und eigene Schlüssel (klein), ungültige verworfen (" + t.compute(mc -> ServerRules.disabled()) + ")",
				t.compute(mc -> ServerRules.disabled().containsAll(List.of("freelook", "zoom", "coordinates", "waypoints", "minimap", "mein.addon-regel"))
						&& ServerRules.disabled().size() == 6));
		t.check("rules: Einblendung nennt gesperrte, eingeschaltete Module", t.compute(mc -> Notifications.current().stream()
				.anyMatch(n -> n.startsWith("Serverregeln") && n.contains("Koordinaten") && n.contains("Freelook"))));
		t.check("rules: Koordinaten gesperrt, Einstellung bleibt an", t.compute(mc -> coordinates.isEnabled() && coordinates.blockedByServer() && !coordinates.activeHere()));
		Module minimap = module(t, "minimap:minimap");
		if (minimap != null) t.check("rules: Minimap-Modul gesperrt (fest zugeordnet und followServerRule)", t.compute(mc -> minimap.blockedByServer()));

		// Zoom: Taste halten → kein Zoom, Hinweis
		t.run(mc -> {
			Notifications.clear();
			HeldixClient.zoomKey.setDown(true);
		});
		t.waitTicks(4);
		boolean zooming = t.compute(mc -> ModuleManager.zoom.isZooming());
		t.run(mc -> HeldixClient.zoomKey.setDown(false));
		t.check("rules: Zoom gesperrt", !zooming);
		t.check("rules: Hinweis „Auf diesem Server deaktiviert“", t.compute(mc -> Notifications.current().stream().anyMatch(n -> n.contains(ServerRules.BLOCKED_TEXT))));
		// Freelook: Taste halten → nicht aktiv
		t.run(mc -> HeldixClient.freelookKey.setDown(true));
		t.waitTicks(4);
		boolean freelooking = t.compute(mc -> ModuleManager.freelook.isActive());
		t.run(mc -> HeldixClient.freelookKey.setDown(false));
		t.check("rules: Freelook gesperrt", !freelooking);
		// Wegpunkte: setzen geht nicht, Addons sehen keine
		t.check("rules: Wegpunkt setzen gesperrt", t.compute(mc -> Waypoints.add(mc, "Gesperrt") == null));
		if (api != null) {
			t.check("API 11: server() mit Regeln", t.compute(mc -> api.server().heldix() && !api.server().allowed("Freelook") && !api.server().allowed("mein.addon-regel")
					&& api.server().allowed("chat") && api.server().disabled().contains("minimap")));
			t.check("API 11: Wegpunkte für Addons leer", t.compute(mc -> api.waypoints().isEmpty()));
			t.check("API 11: Welt von oben aus, solange Minimap und Weltkarte gesperrt sind", t.compute(mc -> {
				ServerLink.handle("{\"t\":\"rules\",\"v\":1,\"disable\":[\"minimap\",\"worldmap\",\"coordinates\"]}");
				boolean off = !api.worldMap().available();
				ServerLink.handle("{\"t\":\"rules\",\"v\":1,\"disable\":[\"freelook\",\"zoom\",\"coordinates\",\"waypoints\",\"minimap\"]}");
				return off && api.worldMap().available();
			}));
			t.check("API 11: onServerInfoChange gemeldet (" + changes.get() + "×)", changes.get() >= 3 && seen.getLast().disabled().contains("freelook"));
			t.check("API 11: language() = " + t.compute(mc -> api.language()), t.compute(mc -> api.language().equals(Language.current())
					&& (api.language().equals("de") || api.language().equals("en"))));
		}
		t.check("Sprache: de_de → de, en_us → en, leer → de", "de".equals(Language.of("de_de")) && "de".equals(Language.of("de_at"))
				&& "en".equals(Language.of("en_us")) && "en".equals(Language.of("fr_fr")) && "de".equals(Language.of(null)));

		// --- HUD-Elemente --------------------------------------------------------------------------
		t.check("hud_set: Text", t.compute(mc -> ServerLink.handle(
				"{\"t\":\"hud_set\",\"v\":1,\"id\":\"runde\",\"type\":\"text\",\"anchor\":\"top_right\",\"title\":\"§cRunde 2\",\"text\":\"Noch drei Minuten bis zum Ende der Runde – viel Glück!\",\"clickable\":true}")));
		t.check("hud_set: Fortschritt", t.compute(mc -> ServerLink.handle(
				"{\"t\":\"hud_set\",\"v\":1,\"id\":\"tore\",\"type\":\"progress\",\"anchor\":\"top\",\"title\":\"Rot gegen Blau\",\"text\":\"3 : 2\",\"value\":0.6,\"color\":\"#22c55e\"}")));
		t.check("hud_set: Liste", t.compute(mc -> ServerLink.handle(
				"{\"t\":\"hud_set\",\"v\":1,\"id\":\"team\",\"type\":\"list\",\"anchor\":\"right\",\"title\":\"Team Rot\",\"lines\":[\"Alex\",\"Steve\",\"Kai\"]}")));
		t.check("hud_set: ungültige ID, Art oder Stelle abgelehnt", t.compute(mc -> !ServerLink.handle("{\"t\":\"hud_set\",\"id\":\"Groß!\",\"type\":\"text\",\"anchor\":\"top\"}")
				&& !ServerLink.handle("{\"t\":\"hud_set\",\"id\":\"x\",\"type\":\"bild\",\"anchor\":\"top\"}")
				&& !ServerLink.handle("{\"t\":\"hud_set\",\"id\":\"x\",\"type\":\"text\",\"anchor\":\"bottom\"}")));
		t.check("hud_set: §-Codes entfernt, Wert begrenzt", t.compute(mc -> {
			List<ServerHud.Element> elements = ServerHud.elements();
			return elements.size() == 3 && "Runde 2".equals(elements.getFirst().title()) && Math.abs(elements.get(1).value() - 0.6f) < 1e-4
					&& elements.get(1).color() == 0x22C55E && elements.get(2).lines().size() == 3;
		}));
		t.waitTicks(10);
		t.screenshot("heldix-server-hud");
		// anklickbar: Chat offen, Klick auf das Element → hud_click
		t.setScreen(() -> new ChatScreen("", false));
		t.waitTicks(5);
		int[] area = t.compute(mc -> ServerHud.areaOf(ServerHud.elements().getFirst()));
		t.check("hud_set: anklickbares Element gezeichnet", area != null);
		if (area != null) {
			t.run(mc -> HudInteraction.clearLastAction());
			t.click(area[0] + area[2] / 2.0, area[1] + area[3] / 2.0);
			t.check("hud_click: Klick erkannt (" + t.compute(mc -> HudInteraction.lastAction()) + ")", t.compute(mc -> "server:runde".equals(HudInteraction.lastAction())));
			t.check("hud_click: an den Server geschickt", t.compute(mc -> ServerLink.sent().contains("hud_click")));
		}
		t.setScreen(() -> null);
		// höchstens 8 Elemente
		t.run(mc -> {
			for (int i = 0; i < 6; i++) ServerLink.handle("{\"t\":\"hud_set\",\"id\":\"e" + i + "\",\"type\":\"text\",\"anchor\":\"left\",\"text\":\"Element " + i + "\"}");
		});
		t.check("hud_set: höchstens 8 Elemente", t.compute(mc -> ServerHud.elements().size() == 8));
		t.check("hud_set: gleiche ID ersetzt auch bei 8", t.compute(mc -> ServerLink.handle("{\"t\":\"hud_set\",\"id\":\"e0\",\"type\":\"text\",\"anchor\":\"left\",\"text\":\"neu\"}")
				&& ServerHud.elements().size() == 8));
		t.check("hud_remove: Element weg", t.compute(mc -> ServerLink.handle("{\"t\":\"hud_remove\",\"id\":\"e0\"}") && ServerHud.elements().size() == 7));
		t.check("Server-HUD ausgeschaltet: nichts gezeichnet", t.compute(mc -> {
			dev.heldixclient.config.HeldixConfig.get().serverHud = false;
			return true;
		}));
		t.waitTicks(3);
		t.check("Server-HUD ausgeschaltet: keine anklickbare Fläche", t.compute(mc -> ServerHud.areaOf(ServerHud.elements().getFirst()) == null));
		t.run(mc -> dev.heldixclient.config.HeldixConfig.get().serverHud = true);
		t.check("hud_clear: alles weg", t.compute(mc -> ServerLink.handle("{\"t\":\"hud_clear\",\"v\":1}") && ServerHud.elements().isEmpty()));

		// --- Einblendungen und kaputte Nachrichten ---------------------------------------------
		t.run(mc -> Notifications.clear());
		t.check("toast: erste angenommen", t.compute(mc -> ServerLink.handle("{\"t\":\"toast\",\"v\":1,\"title\":\"Willkommen\",\"text\":\"Schön, dass du da bist.\"}")));
		t.check("toast: als Heldix-Einblendung", t.compute(mc -> Notifications.current().contains("Willkommen: Schön, dass du da bist.")));
		t.check("toast: zweite innerhalb von 5 s verworfen", t.compute(mc -> !ServerLink.handle("{\"t\":\"toast\",\"title\":\"Noch eine\",\"text\":\"zu schnell\"}")));
		t.check("Kaputte Nachrichten verworfen", t.compute(mc -> !ServerLink.handle("kein json") && !ServerLink.handle("[1,2]") && !ServerLink.handle("{\"v\":1}")
				&& !ServerLink.handle("{\"t\":\"unbekannt\",\"v\":1}")));
		t.check("Zu große Nachricht verworfen", t.compute(mc -> {
			byte[] big = ("{\"t\":\"hud_set\",\"id\":\"gross\",\"type\":\"text\",\"anchor\":\"top\",\"text\":\"" + "x".repeat(40_000) + "\"}").getBytes(StandardCharsets.UTF_8);
			ServerLink.receive(big);
			return ServerHud.elements().isEmpty();
		}));

		// --- Partnerliste -----------------------------------------------------------------------------
		t.run(mc -> Partners.setForTest(List.of(new Partners.Partner("test-partner", "Testpartner", "Ein Server zum Testen", null,
				List.of("heldix-test.example", "port.example:25570"), true))));
		t.check("Partner: Subdomain passt", Partners.isPartner(TEST_ADDRESS) && Partners.isPartner("HELDIX-TEST.example.:25565") && Partners.isPartner("heldix-test.example"));
		t.check("Partner: fremde Domains passen nicht", !Partners.isPartner("heldix-test.example.evil.net") && !Partners.isPartner("notheldix-test.example")
				&& !Partners.isPartner("localhost"));
		t.check("Partner: Eintrag mit Port nur für diesen Port", Partners.isPartner("mc.port.example:25570") && !Partners.isPartner("port.example"));
		t.check("Partner: Server-Info zeigt Partner", t.compute(mc -> ServerLink.info().partner() && "Testpartner".equals(ServerLink.info().partnerName())));

		// --- Server-Gruppe im Sprachkanal (Dienst 1.14.0) ------------------------------------------
		t.run(mc -> VoiceLink.testMessage("{\"type\":\"serverGroup\",\"group\":\"rot\",\"partner\":\"Testpartner\"}"));
		t.check("Voice: Server-Gruppe gemeldet", t.compute(mc -> "rot".equals(VoiceLink.serverGroup()) && "Testpartner".equals(VoiceLink.serverGroupPartner())));
		t.run(mc -> VoiceLink.testMessage("{\"t\":\"serverGroup\",\"group\":\"blau\",\"partner\":\"Testpartner\"}"));
		t.check("Voice: Server-Gruppe auch mit Feld „t“ (Vertrag)", t.compute(mc -> "blau".equals(VoiceLink.serverGroup())));
		t.run(mc -> VoiceLink.testMessage("{\"type\":\"serverGroup\",\"group\":\"Rot Team!\"}"));
		t.check("Voice: ungültiger Gruppenname = keine Gruppe", t.compute(mc -> VoiceLink.serverGroup() == null && VoiceLink.serverGroupPartner().isEmpty()));
		t.run(mc -> VoiceLink.testMessage("{\"type\":\"serverGroup\",\"group\":null}"));

		// --- verlassen ---------------------------------------------------------------------------------
		int before = changes.get();
		t.run(mc -> ServerLink.simulateLeave());
		t.check("Verlassen: Regeln weg, alles erlaubt", t.compute(mc -> ServerRules.disabled().isEmpty() && !coordinates.blockedByServer() && !ServerLink.info().connected()));
		if (api != null) t.check("Verlassen: onServerInfoChange mit leerem Stand", changes.get() > before && seen.getLast().disabled().isEmpty() && !seen.getLast().connected());
		t.run(mc -> {
			Partners.setForTest(null);
			coordinates.setEnabled(coordinatesWas);
			freelook.setEnabled(freelookWas);
			ModuleManager.zoom.setEnabled(zoomWas);
			if (listener != null) listener.cancel();
			Notifications.clear();
		});

		launcherPresence(t);
	}

	/** Rundreise durch Minecrafts Codecs: unser Kanal kommt an, andere Kanäle bleiben verworfen wie bei Minecraft */
	private static void codec(TestContext t) {
		byte[] data = "{\"t\":\"hello\"}".getBytes(StandardCharsets.UTF_8);
		t.check("Codec: Client → Server behält die Bytes", t.compute(mc -> {
			FriendlyByteBuf buffer = new FriendlyByteBuf(Unpooled.buffer());
			ServerboundCustomPayloadPacket.STREAM_CODEC.encode(buffer, new ServerboundCustomPayloadPacket(ServerPayload.message(data)));
			CustomPacketPayload back = ServerboundCustomPayloadPacket.STREAM_CODEC.decode(buffer).payload();
			return back instanceof ServerPayload payload && Arrays.equals(payload.data(), data);
		}));
		t.check("Codec: Server → Client kommt als ServerPayload an", t.compute(mc -> {
			RegistryFriendlyByteBuf buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), mc.level.registryAccess());
			ClientboundCustomPayloadPacket.GAMEPLAY_STREAM_CODEC.encode(buffer, new ClientboundCustomPayloadPacket(ServerPayload.message(data)));
			CustomPacketPayload back = ClientboundCustomPayloadPacket.GAMEPLAY_STREAM_CODEC.decode(buffer).payload();
			return back instanceof ServerPayload payload && Arrays.equals(payload.data(), data);
		}));
		if (dev.heldixclient.serverlink.FabricNetworking.present()) {
			// Fabric API hat für minecraft:register einen eigenen Payload-Typ und schickt die Anmeldung selbst – HeldixClient
			// schreibt dort keine eigene (sonst ClassCastException im Codec von Fabric API)
			t.check("Codec: mit Fabric API meldet Fabric API den Kanal an (" + t.compute(mc -> dev.heldixclient.serverlink.FabricNetworking.registered()) + ")",
					t.compute(mc -> dev.heldixclient.serverlink.FabricNetworking.registered()));
		} else {
			t.check("Codec: minecraft:register wird geschrieben (Kanalname)", t.compute(mc -> {
				FriendlyByteBuf buffer = new FriendlyByteBuf(Unpooled.buffer());
				ServerboundCustomPayloadPacket.STREAM_CODEC.encode(buffer, new ServerboundCustomPayloadPacket(ServerPayload.register("heldixclient:server")));
				return new String(buffer.array(), buffer.arrayOffset(), buffer.writerIndex(), StandardCharsets.UTF_8).contains("heldixclient:server");
			}));
		}
		t.check("Codec: andere Kanäle wie bei Minecraft verworfen", t.compute(mc -> {
			FriendlyByteBuf buffer = new FriendlyByteBuf(Unpooled.buffer());
			buffer.writeIdentifier(Identifier.fromNamespaceAndPath("fremd", "kanal"));
			buffer.writeBytes(new byte[] {1, 2, 3});
			return ServerboundCustomPayloadPacket.STREAM_CODEC.decode(buffer).payload() instanceof DiscardedPayload;
		}));
	}

	/** „Im Launcher“ (Dienst 1.14.0): Zustand, Text, Farbe, Reihenfolge; Party-Mitglied im Launcher */
	private static void launcherPresence(TestContext t) {
		UUID inGame = UUID.randomUUID();
		UUID inLauncher = UUID.randomUUID();
		UUID offline = UUID.randomUUID();
		UUID busy = UUID.randomUUID();
		t.run(mc -> {
			Social.testRealtime(friendMessage(inGame, "AutotestImSpiel", true, false, false));
			Social.testRealtime(friendMessage(offline, "AutotestOffline", false, false, false));
			Social.testRealtime(friendMessage(inLauncher, "AutotestLauncher", false, true, false));
			Social.testRealtime(friendMessage(busy, "AutotestBeschaeftigt", false, true, true));
		});
		Social.Friend launcher = t.compute(mc -> Social.friend(inLauncher));
		Social.Friend game = t.compute(mc -> Social.friend(inGame));
		Social.Friend off = t.compute(mc -> Social.friend(offline));
		Social.Friend dnd = t.compute(mc -> Social.friend(busy));
		t.check("Im Launcher: eigener Zustand", launcher != null && launcher.inLauncher() && !launcher.online() && launcher.reachable());
		t.check("Im Launcher: Untertitel „" + (launcher == null ? "?" : launcher.activity()) + "“", launcher != null && Social.LAUNCHER_TEXT.equals(launcher.activity()));
		t.check("Im Launcher: Heldix-Türkis statt Grün", launcher != null && launcher.presenceColor() == Ui.LAUNCHER && game != null && game.presenceColor() == Ui.SUCCESS
				&& off != null && off.presenceColor() == Ui.FAINT);
		t.check("Im Launcher: „Nicht stören“ hat Vorrang (gelb, „Im Launcher · Nicht stören“ wie in Launcher und Webseite)", dnd != null && dnd.dnd() && dnd.presenceColor() == Ui.WARNING
				&& "Im Launcher · Nicht stören".equals(dnd.activity()));
		List<UUID> order = t.compute(mc -> Social.friends().stream().map(Social.Friend::uuid).filter(id -> List.of(inGame, inLauncher, offline).contains(id)).toList());
		t.check("Im Launcher: nach „im Spiel“, vor „offline“", order.equals(List.of(inGame, inLauncher, offline)));
		t.check("Im Launcher: kein „zuletzt online“", launcher != null && launcher.lastOnlineText() == null);
		Party.Member member = new Party.Member(inLauncher, "AutotestLauncher", false, false, false, 0, null, null, 0, true);
		t.check("Party: Mitglied im Launcher", member.inLauncher() && Social.LAUNCHER_TEXT.equals(member.where()) && member.presenceColor() == Ui.LAUNCHER);
		t.run(mc -> {
			for (UUID id : List.of(inGame, inLauncher, offline, busy)) Social.testForgetFriend(id);
			Notifications.clear();
		});
	}

	private static JsonObject friendMessage(UUID uuid, String name, boolean online, boolean launcher, boolean dnd) {
		JsonObject friend = new JsonObject();
		friend.addProperty("uuid", Social.compact(uuid));
		friend.addProperty("name", name);
		friend.addProperty("online", online);
		friend.addProperty("launcher", launcher);
		friend.addProperty("dnd", dnd);
		friend.addProperty("lastOnline", System.currentTimeMillis() - 60_000);
		JsonObject message = new JsonObject();
		message.addProperty("type", "friend");
		message.add("friend", friend);
		return message;
	}

	private static Module module(TestContext t, String id) {
		return t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null));
	}

	// ======================================================================================
	// 2. Mit echtem Paper-Server samt Plugin
	// ======================================================================================

	/** Nach dem Verlassen der Testwelt (Hauptmenü). Ohne die beiden Umgebungsvariablen übersprungen. */
	static void realServer(TestContext t) throws Exception {
		String paperJar = System.getenv("HELDIX_AUTOTEST_PAPER");
		String pluginJar = System.getenv("HELDIX_AUTOTEST_PLUGIN");
		if (paperJar == null || paperJar.isBlank() || pluginJar == null || pluginJar.isBlank()) {
			t.log("Ohne HELDIX_AUTOTEST_PAPER (Paper-Jar 26.3) und HELDIX_AUTOTEST_PLUGIN (HeldixClient-Server-Jar): Test mit echtem Paper-Server übersprungen");
			return;
		}
		Path paper = Path.of(paperJar.strip());
		Path plugin = Path.of(pluginJar.strip());
		t.check("Paper-Server: Jars vorhanden", Files.isRegularFile(paper) && Files.isRegularFile(plugin));
		Path dir = t.compute(mc -> mc.gameDirectory.toPath()).resolve("heldix-autotest-paper");
		Files.createDirectories(dir.resolve("plugins/HeldixClient-Server"));
		int port;
		try (ServerSocket socket = new ServerSocket(0)) {
			port = socket.getLocalPort();
		}
		// nur für diesen lokalen Testserver: EULA, offline-mode (der Test-Client meldet sich nicht bei Mojang an), flache Welt,
		// ohne Whitelist (Paper 26.x schaltet sie für neue Server ein: „You are not whitelisted“)
		Files.writeString(dir.resolve("eula.txt"), "eula=true\n");
		Files.writeString(dir.resolve("server.properties"), String.join("\n", "server-port=" + port, "server-ip=127.0.0.1", "online-mode=false",
				"enforce-secure-profile=false", "level-type=minecraft\\:flat", "generate-structures=false", "spawn-protection=0", "view-distance=4",
				"simulation-distance=4", "gamemode=creative", "motd=Heldix Autotest", "max-players=4",
				"white-list=false", "enforce-whitelist=false") + "\n");
		Files.copy(plugin, dir.resolve("plugins/HeldixClient-Server.jar"), StandardCopyOption.REPLACE_EXISTING);
		Files.writeString(dir.resolve("plugins/HeldixClient-Server/config.yml"),
				"partner-key: \"\"\nserver-name: \"Autotest-Server\"\nserver-address: \"\"\nrules:\n  disable: [freelook, coordinates]\napi-url: \"https://api.heldixclient.com\"\n");
		String javaPath = ProcessHandle.current().info().command().orElse("java");
		if (javaPath.endsWith("javaw.exe")) {
			Path consoleJava = Path.of(javaPath).resolveSibling("java.exe");
			if (Files.isRegularFile(consoleJava)) javaPath = consoleJava.toString();
		}
		List<String> log = new CopyOnWriteArrayList<>();
		Process process = new ProcessBuilder(javaPath, "-Xms512M", "-Xmx1536M", "-jar", paper.toAbsolutePath().toString(), "--nogui")
				.directory(dir.toFile()).redirectErrorStream(true).start();
		Thread reader = new Thread(() -> {
			try (BufferedReader in = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
				String line;
				while ((line = in.readLine()) != null) {
					log.add(line);
					if (line.contains("HeldixClient") || line.contains("Done (") || line.contains("ERROR")) AutoTest.LOG.info("PAPER {}", line);
				}
			} catch (Exception e) {
				// Prozess beendet
			}
		}, "Heldix-Autotest Paper");
		reader.setDaemon(true);
		reader.start();
		PrintWriter console = new PrintWriter(new java.io.OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8), true);
		try {
			// beim ersten Mal lädt Paper die Minecraft-Server-Jar und Bibliotheken: großzügig warten
			long deadline = System.currentTimeMillis() + 15 * 60_000L;
			while (log.stream().noneMatch(l -> l.contains("Done ("))) {
				if (!process.isAlive()) throw new AssertionError("Paper-Server beendet sich beim Start (Log: " + dir.resolve("logs/latest.log") + ")");
				if (System.currentTimeMillis() > deadline) throw new AssertionError("Paper-Server startet nicht in 15 Minuten");
				TestContext.sleep(500);
			}
			t.check("Paper-Server: Plugin geladen", log.stream().anyMatch(l -> l.contains("HeldixClient Server 1.0.0 bereit")));
			String address = "127.0.0.1:" + port;
			t.run(mc -> ConnectScreen.startConnecting(new TitleScreen(), mc, ServerAddress.parseString(address),
					new ServerData("Heldix Autotest Paper", address, ServerData.Type.OTHER), false, null));
			t.waitFor("Paper-Server betreten", mc -> mc.level != null && mc.player != null, 180);
			t.waitFor("welcome vom Plugin", mc -> ServerLink.info().heldix(), 30);
			t.check("Paper: Anmeldung und hello geschickt (" + t.compute(mc -> ServerLink.sent()) + ")", t.compute(mc -> ServerLink.sent().contains("hello")
					&& (FabricNetworking.present() || ServerLink.sent().contains("register"))));
			t.check("Paper: welcome mit Namen aus der config.yml", t.compute(mc -> "Autotest-Server".equals(ServerLink.info().name())));
			t.waitFor("Regeln vom Plugin", mc -> ServerRules.disabled().contains("freelook"), 10);
			t.check("Paper: Regeln aus der config.yml", t.compute(mc -> ServerRules.disabled().equals(java.util.Set.of("freelook", "coordinates"))));
			String name = t.compute(mc -> mc.getUser().getName());
			console.println("heldix status");
			console.println("heldix test-hud " + name);
			t.waitFor("Test-HUD vom Plugin", mc -> ServerHud.elements().size() >= 3, 20);
			t.check("Paper: Test-Einblendung", t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("HeldixClient Server")), 5));
			t.check("Paper: /heldix status nennt den Spieler", t.waitSoft(mc -> log.stream().anyMatch(l -> l.contains(name + " (" + HeldixClient.version)), 10));
			t.waitTicks(40);
			t.screenshot("heldix-server-paper-hud");
			t.check("Paper: Fortschritt wird hochgezählt", t.waitSoft(mc -> ServerHud.elements().stream()
					.anyMatch(e -> e.id().equals("heldix-test-progress") && e.value() > 0.05f), 10));
			// anklickbares Test-Element
			t.setScreen(() -> new ChatScreen("", false));
			t.waitTicks(5);
			int[] area = t.compute(mc -> ServerHud.elements().stream().filter(ServerHud.Element::clickable).findFirst().map(ServerHud::areaOf).orElse(null));
			if (area != null) {
				t.click(area[0] + area[2] / 2.0, area[1] + area[3] / 2.0);
				t.check("Paper: hud_click geschickt", t.compute(mc -> ServerLink.sent().contains("hud_click")));
			}
			t.setScreen(() -> null);
			t.check("Paper: Test-HUD nach 15 s wieder weg", t.waitSoft(mc -> ServerHud.elements().isEmpty(), 25));
			t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
			t.waitFor("Paper-Server verlassen", mc -> mc.level == null, 60);
			t.check("Paper: nach dem Verlassen keine Regeln mehr", t.compute(mc -> ServerRules.disabled().isEmpty() && !ServerLink.info().connected()));
		} finally {
			console.println("stop");
			if (!process.waitFor(60, TimeUnit.SECONDS)) process.destroyForcibly();
			t.run(mc -> {
				if (!(mc.gui.screen() instanceof TitleScreen)) mc.gui.setScreen(new TitleScreen());
			});
			t.waitTicks(10);
		}
	}
}
