package dev.heldixclient.autotest;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.screen.ActionButton;
import dev.heldixclient.screen.HeldixWorldsScreen;
import dev.heldixclient.screen.HostWorldScreen;
import dev.heldixclient.screen.HostedWaitScreen;
import dev.heldixclient.screen.ShareWorldScreen;
import dev.heldixclient.share.HostedJoin;
import dev.heldixclient.share.Hosting;
import dev.heldixclient.share.HostingService;
import dev.heldixclient.share.HostingTransfer;
import dev.heldixclient.share.KnockPrompt;
import dev.heldixclient.share.WorldBackups;
import dev.heldixclient.share.WorldService;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.social.Social;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.DisconnectedScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.storage.LevelResource;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Dauerhafte Welten, Entdecken und die Heldix+-Warteliste (Heldix-Dienst 1.13.0, Client 0.14.0) gegen den lokalen
 * Dienst im Entwicklungsmodus mit dem ProcessRunner (echtes Paper, siehe docs/entwicklung.md):
 * <ol>
 *   <li>Berechtigung aus {@code GET /v1/hosting}. Ohne Hosting beim Dienst (älterer Dienst, „off“) endet der Test sauber.</li>
 *   <li>Ohne Berechtigung (Konto nicht im Team, keine Freischaltung): Heldix-Welten zeigt „Dauerhaft online – bald mit
 *   Heldix+“, die Warteliste geht über die Seite (eintragen, Stand, austragen); Entdecken mit einer Testwelt; Ende.</li>
 *   <li>Mit Berechtigung: Warteliste einer zweiten Spielerin über die Schnittstelle; Pausemenü → Welt teilen →
 *   „Dauerhaft online stellen“ → Erklärung → Hochladen (Sicherung, Teile, SHA-256) → schläft; „Welt teilen“ ist danach
 *   gesperrt („dort beitreten?“); die lokale Welt bleibt unverändert.</li>
 *   <li>Relay ({@code --welt-port}): Status „schläft“, Login weckt („startet gerade“), danach läuft Paper (Status und
 *   Verschlüsselungsanfrage über das Relay), Anklopfen eines Fremden mit Einblendung und Taste „Ablehnen“.</li>
 *   <li>Warte-Bildschirm bei „startet gerade“ (erneuter Versuch, Abbrechen), Einblendung zu {@code hosting-granted}.</li>
 *   <li>Entdecken: eigene Welt listen (Zugang „offen“), Liste mit Suche, Gefällt mir einer zweiten Spielerin; eine Welt
 *   der zweiten Spielerin (offener Tunnel) im Spiel mit „Gefällt mir“ und „Melden“.</li>
 *   <li>Herunterladen als neue Einzelspielerwelt „… (vom Heldix-Server)“ (ohne heldix-welt.json). Zum Schluss wird alles
 *   beim Dienst gelöscht.</li>
 * </ol>
 */
final class HostingTests {
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
	private static final Pattern ADDRESS = Pattern.compile("^[a-hjkmnp-z2-9]{6}\\.welt\\.[a-z0-9.-]+$");
	/** Paper lädt beim ersten Mal sein Jar und wandelt die Welt um: großzügig */
	private static final int UPLOAD_SECONDS = 900;
	private static final int START_SECONDS = 300;

	private HostingTests() {
	}

	/** zweite Spielerin über die Entwickler-Anmeldung des Dienstes */
	private static final class Player {
		UUID uuid;
		String name;
		String token;
		WebSocket host;
		final List<String> hostMessages = new CopyOnWriteArrayList<>();
		String worldId;
	}

	static void run(TestContext t) throws Exception {
		if (!t.compute(mc -> Social.online())) {
			t.log("Heldix-Dienst nicht verbunden: dauerhafte Welten übersprungen");
			return;
		}
		if (!t.compute(mc -> mc.getSingleplayerServer() != null)) {
			t.log("Keine Einzelspielerwelt: dauerhafte Welten übersprungen");
			return;
		}
		String base = t.compute(mc -> Social.baseUrl());
		HostingService.Overview overview;
		try {
			overview = Hosting.refresh().get(20, TimeUnit.SECONDS);
		} catch (Exception e) {
			t.log("Dauerhafte Welten: Stand nicht ladbar (" + WorldService.message(e) + ") – übersprungen");
			return;
		}
		if (!overview.available()) {
			t.check("Dauerhafte Welten: Dienst ohne Hosting – verständlich „aus“ (" + overview.problem() + ")", overview.limits() == null);
			t.log("Heldix-Dienst ohne dauerhafte Welten (kein Runner bzw. älter als 1.13.0): Rest übersprungen");
			return;
		}
		t.check("Dauerhafte Welten: Grenzen vom Dienst (Teile " + (overview.limits() == null ? "?" : overview.limits().chunkBytes()) + " Byte)",
				overview.limits() != null && overview.limits().chunkBytes() > 0 && overview.limits().eula().startsWith("https://"));
		// Test-Dienst im Entwicklungsmodus: Beta-Freischaltung über die Dev-Route setzen (POST /v1/dev/hosting/grant), damit der
		// volle Ablauf (Hochladen, Paper über das Relay, Herunterladen) läuft; ohne Dev-Route bleibt es beim Teil ohne Berechtigung
		if (!overview.allowed() && "beta".equals(overview.reason()) && !"0".equals(System.getenv("HELDIX_AUTOTEST_HOSTING_GRANT"))) {
			try {
				JsonObject body = new JsonObject();
				String ownName = t.compute(mc -> mc.getUser().getName());
				body.addProperty("name", ownName);
				request("POST", base + "/v1/dev/hosting/grant", body, null);
				overview = Hosting.refresh().get(20, TimeUnit.SECONDS);
				t.log("Dauerhafte Welten: Beta-Freischaltung über die Dev-Route gesetzt (allowed=" + overview.allowed() + ")");
			} catch (Exception e) {
				t.log("Dauerhafte Welten: Dev-Route zum Freischalten nicht verfügbar (" + e.getMessage() + ")");
			}
		}
		boolean notifications = t.compute(mc -> dev.heldixclient.config.HeldixConfig.get().socialNotifications);
		t.run(mc -> dev.heldixclient.config.HeldixConfig.get().socialNotifications = true);
		Player other = null;
		String hostedId = null;
		Path imported = null;
		try {
			other = player(base, "Plus_");
			if (!overview.allowed()) {
				// ohne Berechtigung: Warteliste im Spiel, Entdecken ohne eigene dauerhafte Welt
				t.check("Dauerhafte Welten: ohne Berechtigung „beta“ (" + overview.reason() + ")", "beta".equals(overview.reason()));
				waitlistInGame(t);
				discoverForeign(t, base, other);
				t.log("Konto " + t.compute(mc -> mc.getUser().getName()) + " ohne Berechtigung: Hochladen, Relay und Herunterladen übersprungen. "
						+ "Für den vollen Test die Beta-Freischaltung setzen (docs/entwicklung.md → Dauerhafte Welten im Client).");
				return;
			}
			t.check("Dauerhafte Welten: Berechtigung (Team oder Freischaltung)", overview.allowed());
			waitlistApi(t, base, other);
			granted(t);
			hostedId = upload(t);
			if (hostedId == null) return;
			int port = Integer.getInteger("heldixclient.welt.testPort", 0);
			if (port > 0) relay(t, port, hostedId);
			else t.log("Ohne -Dheldixclient.welt.testPort (--welt-port): Relay-Teil (Wecken, Paper, Anklopfen) übersprungen");
			waitScreen(t, hostedId);
			discoverOwn(t, base, other, hostedId);
			discoverForeign(t, base, other);
			imported = download(t, hostedId);
		} finally {
			String id = hostedId;
			Path copy = imported;
			Player player = other;
			t.run(mc -> {
				HostingTransfer.Job job = HostingTransfer.current();
				if (job != null) job.cancel();
				HostingTransfer.forget();
				dev.heldixclient.config.HeldixConfig.get().socialNotifications = notifications;
				mc.gui.setScreen(null);
			});
			if (id != null) {
				try {
					Social.request("DELETE", "/v1/worlds/" + id + "/listing", null, true).get(10, TimeUnit.SECONDS);
				} catch (Exception e) {
					// war nicht gelistet
				}
				try {
					// löscht die geteilte Welt samt dauerhafter Welt beim Dienst (Server, Daten, Sicherungen)
					WorldService.delete(id).get(30, TimeUnit.SECONDS);
					t.log("Dauerhafte Welten: Testwelt beim Dienst gelöscht");
				} catch (Exception e) {
					t.log("Dauerhafte Welten: Testwelt nicht gelöscht (" + WorldService.message(e) + ")");
				}
			}
			if (copy != null) deleteTree(copy);
			if (player != null) closePlayer(base, player);
		}
	}

	// ======================================================================================
	// Warteliste
	// ======================================================================================

	/** ohne Berechtigung: Heldix-Welten → Deine Welten zeigt die Warteliste, eintragen und austragen über die Seite */
	private static void waitlistInGame(TestContext t) throws Exception {
		HostingService.Plus before = Hosting.refreshPlus().get(10, TimeUnit.SECONDS);
		t.check("Warteliste: GET /v1/plus ohne Freischaltung (granted=false)", !before.granted());
		if (before.waiting()) Hosting.waitlist(false).get(10, TimeUnit.SECONDS);
		t.setScreen(HeldixWorldsScreen::new);
		t.waitFor("Heldix-Welten geladen", mc -> mc.gui.screen() instanceof HeldixWorldsScreen screen && screen.loaded(), 15);
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).showMine());
		t.waitSoft(mc -> describe(mc).contains(HeldixWorldsScreen.PLUS_TEASER), 10);
		t.check("Warteliste: „Deine Welten“ zeigt „" + HeldixWorldsScreen.PLUS_TEASER + "“", t.compute(mc -> describe(mc).contains(HeldixWorldsScreen.PLUS_TEASER)));
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).showPlus());
		t.waitSoft(mc -> hasWidget(mc, HeldixWorldsScreen.WAITLIST_JOIN), 10);
		List<String> texts = t.compute(HostingTests::describe);
		t.check("Warteliste: Seite „Heldix+ – bald“ mit „geplant, Preise und Inhalte stehen noch nicht fest“ (" + texts + ")",
				texts.stream().anyMatch(s -> s.contains("Dauerhaft online – bald mit Heldix+")) && joined(texts).contains("stehen noch nicht fest"));
		t.moveMouse(5, 5);
		t.screenshot("hosting-01-warteliste");
		t.clickWidget(HeldixWorldsScreen.WAITLIST_JOIN);
		t.waitSoft(mc -> Hosting.plus() != null && Hosting.plus().waiting() && hasWidget(mc, HeldixWorldsScreen.WAITLIST_LEAVE), 10);
		HostingService.Plus joined = HostingService.plus().get(10, TimeUnit.SECONDS);
		t.check("Warteliste: eingetragen (PUT /v1/plus/waitlist, seit " + joined.since() + ")", joined.waiting());
		t.check("Warteliste: Seite zeigt „Du stehst seit … auf der Warteliste“", t.compute(mc -> joined(describe(mc)).contains("auf der Warteliste")));
		t.screenshot("hosting-02-warteliste-eingetragen");
		t.clickWidget(HeldixWorldsScreen.WAITLIST_LEAVE);
		t.waitSoft(mc -> Hosting.plus() != null && !Hosting.plus().waiting(), 10);
		t.check("Warteliste: ausgetragen (DELETE /v1/plus/waitlist)", !HostingService.plus().get(10, TimeUnit.SECONDS).waiting());
		t.setScreen(() -> null);
	}

	/** mit Berechtigung: die zweite Spielerin (ohne Berechtigung) trägt sich über die Schnittstelle ein und wieder aus */
	private static void waitlistApi(TestContext t, String base, Player other) throws Exception {
		JsonObject hosting = request("GET", base + "/v1/hosting", null, other.token);
		t.check("Warteliste: Spielerin ohne Freischaltung → allowed=false, reason=beta (" + hosting.get("reason") + ")",
				!hosting.get("allowed").getAsBoolean() && "beta".equals(string(hosting, "reason")));
		JsonObject plus = request("PUT", base + "/v1/plus/waitlist", null, other.token);
		t.check("Warteliste: eingetragen mit Zeitpunkt", plus.has("waitlist") && plus.get("waitlist").isJsonObject()
				&& plus.getAsJsonObject("waitlist").get("since").getAsLong() > 0 && !plus.get("granted").getAsBoolean());
		JsonObject again = request("PUT", base + "/v1/plus/waitlist", null, other.token);
		t.check("Warteliste: zweites Eintragen behält „seit“", again.getAsJsonObject("waitlist").get("since").getAsLong()
				== plus.getAsJsonObject("waitlist").get("since").getAsLong());
		JsonObject left = request("DELETE", base + "/v1/plus/waitlist", null, other.token);
		t.check("Warteliste: ausgetragen", left.get("waitlist") == null || left.get("waitlist").isJsonNull());
		HostingService.Plus mine = HostingService.plus().get(10, TimeUnit.SECONDS);
		t.check("Warteliste: eigenes Konto „granted“ (darf dauerhafte Welten nutzen)", mine.granted());
	}

	/** Echtzeit hosting-granted: Einblendung „Du kannst jetzt dauerhafte Welten anlegen“ */
	private static void granted(TestContext t) {
		t.run(mc -> Notifications.clear());
		t.run(mc -> Hosting.testRealtime(JsonParser.parseString("{\"type\":\"hosting-granted\",\"source\":\"beta\",\"label\":\"Beta: Dauerhafte Welten\","
				+ "\"at\":" + System.currentTimeMillis() + ",\"text\":\"Du bist freigeschaltet.\",\"pending\":false}").getAsJsonObject()));
		t.waitSoft(mc -> Notifications.current().stream().anyMatch(n -> n.contains("dauerhafte Welten anlegen")), 5);
		t.check("Echtzeit hosting-granted: Einblendung „Du kannst jetzt dauerhafte Welten anlegen“",
				t.compute(mc -> Notifications.current().stream().anyMatch(n -> n.startsWith("Du kannst jetzt dauerhafte Welten anlegen"))));
	}

	// ======================================================================================
	// Dauerhaft online stellen
	// ======================================================================================

	private static String upload(TestContext t) throws Exception {
		Path world = t.compute(mc -> mc.getSingleplayerServer().getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize());
		String name = t.compute(mc -> mc.getSingleplayerServer().getWorldData().getLevelName());
		// Rest eines abgebrochenen Laufs: alte dauerhafte Welt dieser Testwelt erst entfernen
		String oldId = WorldBackups.readId(world);
		HostingService.Overview overview = Hosting.refresh().get(20, TimeUnit.SECONDS);
		if (oldId != null && overview.own(oldId) != null) {
			HostingService.delete(oldId).get(30, TimeUnit.SECONDS);
			overview = Hosting.refresh().get(20, TimeUnit.SECONDS);
			t.log("Dauerhafte Welten: Rest eines früheren Laufs entfernt");
		}
		if (!overview.room()) {
			t.log("Dauerhafte Welten: schon so viele dauerhafte Welten wie erlaubt – Hochladen übersprungen");
			return null;
		}
		if (t.compute(mc -> WorldShare.active())) t.run(mc -> WorldShare.stop());
		t.run(mc -> WorldShare.clearError());

		// Pausemenü → Welt teilen → „Dauerhaft online stellen“
		t.setScreen(ShareWorldScreen::new);
		t.waitSoft(mc -> hasWidgetStarting(mc, ShareWorldScreen.HOST_LABEL), 15);
		t.check("Welt teilen: Knopf „Dauerhaft online stellen“", t.compute(mc -> hasWidgetStarting(mc, ShareWorldScreen.HOST_LABEL)));
		int[] host = t.widgetCenter(w -> w.getMessage().getString().startsWith(ShareWorldScreen.HOST_LABEL), ShareWorldScreen.HOST_LABEL);
		t.click(host[0], host[1]);
		t.waitFor("Erklärung „Dauerhaft online stellen“", mc -> mc.gui.screen() instanceof HostWorldScreen screen && !screen.showingJob(), 10);
		t.waitSoft(mc -> activeWidget(mc, HostWorldScreen.UPLOAD_LABEL), 10);
		List<String> info = t.compute(HostingTests::describe);
		t.check("Erklärung: Heldix-Server, schläft, Webseite, Einzelspielerwelt bleibt, EULA (" + info + ")", info.contains("Läuft auf dem Heldix-Server")
				&& info.contains("Schläft, wenn niemand drin ist") && info.contains("Verwalten auf der Webseite") && info.contains("Deine Einzelspielerwelt bleibt")
				&& info.contains("Minecraft-EULA") && t.compute(mc -> hasWidget(mc, HostWorldScreen.EULA_LABEL)));
		t.moveMouse(5, 5);
		t.screenshot("hosting-03-erklaerung");
		long levelBefore = Files.getLastModifiedTime(world.resolve("level.dat")).toMillis();
		t.clickWidget(HostWorldScreen.UPLOAD_LABEL);
		t.waitSoft(mc -> HostingTransfer.current() != null && HostingTransfer.current().phase() == HostingTransfer.Phase.UPLOADING, 60);
		t.screenshot("hosting-04-hochladen");
		t.waitSoft(mc -> HostingTransfer.current() != null && !HostingTransfer.current().running(), UPLOAD_SECONDS);
		HostingTransfer.Job job = t.compute(mc -> HostingTransfer.current());
		t.check("Hochladen: fertig (" + (job == null ? "kein Auftrag" : job.phase() + (job.error() != null ? ": " + job.error() : "")) + ")",
				job != null && job.phase() == HostingTransfer.Phase.DONE && job.result() != null);
		HostingService.Hosted hosted = job.result();
		String id = hosted.id();
		t.check("Hochladen: Welt schläft danach, Adresse <code>.welt.<Domain> (" + hosted.state() + ", " + hosted.address() + ")",
				hosted.state() == HostingService.State.SLEEPING && hosted.address() != null && ADDRESS.matcher(WorldShare.normalizeAddress(hosted.address())).matches()
						&& !hosted.awaitingUpload());
		t.check("Hochladen: Sicherung als ZIP entstanden", t.compute(mc -> WorldBackups.list(mc.gameDirectory.toPath(), world.getFileName().toString()).size()) > 0);
		t.check("Hochladen: heldix-welt.json mit der ID der dauerhaften Welt", id.equals(WorldBackups.readId(world)));
		t.check("Hochladen: Einzelspielerwelt nicht verändert (level.dat noch da)", Files.isRegularFile(world.resolve("level.dat"))
				&& Files.getLastModifiedTime(world.resolve("level.dat")).toMillis() >= levelBefore);
		List<String> done = t.compute(HostingTests::describe);
		t.check("Hochladen: „läuft jetzt dauerhaft“ mit Beitreten und Webseite", done.stream().anyMatch(s -> s.contains("läuft jetzt dauerhaft"))
				&& t.compute(mc -> hasWidget(mc, HostWorldScreen.JOIN_LABEL) && hasWidget(mc, HostWorldScreen.MANAGE_LABEL)));
		t.screenshot("hosting-05-online");
		JsonObject detail = Social.request("GET", "/v1/hosting/worlds/" + id, null, true).get(10, TimeUnit.SECONDS).getAsJsonObject();
		t.check("Hochladen: kein offener Upload mehr beim Dienst", detail.get("upload") == null || detail.get("upload").isJsonNull());
		WorldService.Listing listing = WorldService.list().get(10, TimeUnit.SECONDS);
		t.check("GET /v1/worlds: die Welt ist dauerhaft (hosted.state)", listing.mine().stream().anyMatch(w -> w.id().equals(id) && w.persistent()));
		t.run(mc -> HostingTransfer.forget());

		// „Welt teilen“ derselben Welt ist jetzt gesperrt
		t.setScreen(ShareWorldScreen::new);
		t.waitSoft(mc -> hasWidget(mc, ShareWorldScreen.HOSTED_JOIN_LABEL), 15);
		t.check("Welt teilen: gesperrt mit „" + WorldShare.HOSTED_QUESTION + "“ und „Dort beitreten“", t.compute(mc -> describe(mc).contains(WorldShare.HOSTED_QUESTION)
				&& hasWidget(mc, ShareWorldScreen.HOSTED_JOIN_LABEL) && !hasWidget(mc, ShareWorldScreen.START_LABEL)));
		t.moveMouse(5, 5);
		t.screenshot("hosting-06-teilen-gesperrt");
		t.setScreen(() -> null);

		// Heldix-Welten: dauerhafte Welt mit Zustand und den Knöpfen
		t.setScreen(HeldixWorldsScreen::new);
		t.waitFor("Heldix-Welten geladen", mc -> mc.gui.screen() instanceof HeldixWorldsScreen screen && screen.loaded(), 15);
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).showMine());
		t.waitSoft(mc -> describe(mc).stream().anyMatch(s -> s.contains("dauerhaft")), 10);
		List<String> mine = t.compute(HostingTests::describe);
		t.check("Heldix-Welten: „" + name + " · dauerhaft“ mit Zustand (" + mine + ")", mine.stream().anyMatch(s -> s.startsWith(name) && s.contains("dauerhaft"))
				&& mine.stream().anyMatch(s -> s.contains("schläft") || s.contains("läuft")));
		t.check("Heldix-Welten: Beitreten, Webseite und Herunterladen", t.compute(mc -> hasWidget(mc, HeldixWorldsScreen.JOIN_LABEL)
				&& hasWidget(mc, HeldixWorldsScreen.MANAGE_LABEL) && hasWidget(mc, HeldixWorldsScreen.DOWNLOAD_LABEL)));
		t.moveMouse(5, 5);
		t.screenshot("hosting-07-heldix-welten");
		t.setScreen(() -> null);
		return id;
	}

	// ======================================================================================
	// Relay: wecken, Paper, Anklopfen
	// ======================================================================================

	private static void relay(TestContext t, int port, String id) throws Exception {
		HostingService.Hosted hosted = Hosting.find(id);
		String address = WorldShare.normalizeAddress(hosted.address());
		int protocol = SharedConstants.getProtocolVersion();
		String own = t.compute(mc -> mc.getUser().getName());

		String sleeping = WorldShareTests.text(WorldShareTests.McClient.status(port, address, protocol).get("description")).replaceAll("§.", "");
		t.check("Relay: schlafende Welt in der Serverliste „schläft – zum Aufwecken einfach beitreten“ (" + sleeping.replace('\n', '/') + ")",
				sleeping.contains("schläft") && sleeping.contains("Geteilt mit HeldixClient"));
		WorldShareTests.McClient.Answer wake = WorldShareTests.McClient.login(port, address, protocol, own);
		t.check("Relay: Login weckt die Welt („" + wake.text() + "“)", wake.id() == 0x00 && wake.text().contains(HostingService.TEXT_STARTING));
		t.waitSoft(mc -> stateOf(id) == HostingService.State.STARTING || stateOf(id) == HostingService.State.RUNNING, 20);
		t.check("Echtzeit hosting-state: Zustand „startet“ bzw. „läuft“ (" + stateOf(id) + ")", stateOf(id) == HostingService.State.STARTING
				|| stateOf(id) == HostingService.State.RUNNING);
		boolean running = t.waitSoft(mc -> stateOf(id) == HostingService.State.RUNNING, START_SECONDS);
		if (!running) {
			Hosting.refresh().get(20, TimeUnit.SECONDS);
			running = stateOf(id) == HostingService.State.RUNNING;
		}
		t.check("Paper läuft auf dem Heldix-Server (" + stateOf(id) + ")", running);
		JsonObject status = WorldShareTests.McClient.status(port, address, protocol);
		String description = WorldShareTests.text(status.get("description")).replaceAll("§.", "");
		JsonObject version = status.has("version") && status.get("version").isJsonObject() ? status.getAsJsonObject("version") : new JsonObject();
		t.check("Relay: Status kommt vom Server (" + string(version, "name") + ", " + description.replace('\n', '/') + ")",
				description.contains("Geteilt mit HeldixClient") && !"HeldixClient".equals(string(version, "name")));
		WorldShareTests.McClient.Answer login = WorldShareTests.McClient.login(port, address, protocol, own);
		t.check("Relay: Login des Besitzers geht per TCP an den Server (Verschlüsselungsanfrage, Paket " + login.id() + ")", login.id() == 0x01);

		// Fremder klopft an: Einblendung mit Tasten, „Ablehnen“
		t.run(mc -> mc.gui.setScreen(null));
		t.waitTicks(3);
		String stranger = "Gast_" + ThreadLocalRandom.current().nextInt(10_000, 100_000);
		WorldShareTests.McClient.Answer knock = WorldShareTests.McClient.login(port, address, protocol, stranger);
		t.check("Relay: Fremder wird getrennt und klopft an (" + knock.text() + ")", knock.id() == 0x00 && knock.text().contains("noch nicht eingeladen"));
		t.waitSoft(mc -> Hosting.knocks().stream().anyMatch(k -> k.name().equalsIgnoreCase(stranger)), 10);
		t.check("Echtzeit hosting-knock: Anklopfen kommt beim Besitzer an", t.compute(mc -> Hosting.knocks().stream().anyMatch(k -> k.name().equalsIgnoreCase(stranger))));
		t.check("Anklopfen: Einblendung „… möchte in „…““ im Spiel", t.compute(KnockPrompt::visible));
		t.screenshot("hosting-08-anklopfen");
		t.run(mc -> {
			HeldixClient.knockDenyKey.setKey(HeldixClient.knockDenyKey.getDefaultKey());
			net.minecraft.client.KeyMapping.resetMapping();
		});
		t.pressKey(t.compute(mc -> HeldixClient.knockDenyKey.getDefaultKey().getValue()));
		t.waitSoft(mc -> Hosting.knocks().isEmpty(), 5);
		t.check("Anklopfen: Taste „Ablehnen“ beantwortet es (POST …/knocks/<name>)", t.compute(mc -> Hosting.knocks().isEmpty()));
		TestContext.sleep(1000);
		List<WorldService.Member> members = WorldService.members(id).get(10, TimeUnit.SECONDS);
		t.check("Anklopfen: abgelehnt → kein Mitglied", members.stream().noneMatch(m -> m.name().equalsIgnoreCase(stranger)));
	}

	private static HostingService.State stateOf(String id) {
		HostingService.Hosted world = Hosting.find(id);
		return world == null ? null : world.state();
	}

	// ======================================================================================
	// Warte-Bildschirm „startet gerade“
	// ======================================================================================

	/** Trennung „Die Welt startet gerade …“ nach einem Beitritt → Warte-Bildschirm mit Countdown und Abbrechen */
	private static void waitScreen(TestContext t, String id) {
		String address = WorldShare.normalizeAddress(Hosting.find(id).address());
		t.run(mc -> {
			HostedJoin.connecting(new ServerData("Testwelt", address, ServerData.Type.OTHER));
			mc.gui.setScreen(new DisconnectedScreen(new TitleScreen(), Component.literal("Verbindung fehlgeschlagen"),
					Component.literal("Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.")));
		});
		t.waitTicks(3);
		t.check("Wecken: statt der Trennung der Warte-Bildschirm (Versuch 1)", t.compute(mc -> mc.gui.screen() instanceof HostedWaitScreen screen
				&& screen.attempt() == 1 && address.equals(screen.address()) && hasWidget(mc, HostedWaitScreen.RETRY_LABEL) && hasWidget(mc, HostedWaitScreen.CANCEL_LABEL)));
		t.moveMouse(5, 5);
		t.screenshot("hosting-09-wecken");
		t.clickWidget(HostedWaitScreen.CANCEL_LABEL);
		t.waitTicks(3);
		t.check("Wecken: „Abbrechen“ führt zu Heldix-Welten", t.compute(mc -> mc.gui.screen() instanceof HeldixWorldsScreen));
		// andere Trennungen bleiben, wie sie sind
		t.run(mc -> {
			HostedJoin.connecting(new ServerData("Testwelt", address, ServerData.Type.OTHER));
			mc.gui.setScreen(new DisconnectedScreen(new TitleScreen(), Component.literal("Verbindung fehlgeschlagen"), Component.literal("Die Welt ist voll.")));
		});
		t.waitTicks(3);
		t.check("Wecken: andere Trennung bleibt die Meldung von Minecraft", t.compute(mc -> mc.gui.screen() instanceof DisconnectedScreen));
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Entdecken
	// ======================================================================================

	/** eigene dauerhafte Welt ins Verzeichnis (Zugang offen), Liste im Spiel, Gefällt mir einer anderen Spielerin */
	private static void discoverOwn(TestContext t, String base, Player other, String id) throws Exception {
		WorldService.update(id, null, WorldService.Access.OPEN, 0, null).get(10, TimeUnit.SECONDS);
		String name = t.compute(mc -> mc.getSingleplayerServer().getWorldData().getLevelName());
		JsonObject listing = new JsonObject();
		listing.addProperty("listed", true);
		listing.addProperty("description", "Autotest: dauerhafte Welt im Verzeichnis");
		com.google.gson.JsonArray tags = new com.google.gson.JsonArray();
		tags.add("survival");
		tags.add("bauen");
		listing.add("tags", tags);
		listing.addProperty("lang", "de");
		listing.addProperty("rulesAccepted", true);
		JsonObject own = Social.request("PUT", "/v1/worlds/" + id + "/listing", listing, true).get(10, TimeUnit.SECONDS).getAsJsonObject();
		t.check("Entdecken: eigene Welt gelistet (" + own.get("problem") + ")", own.get("listed").getAsBoolean() && (own.get("problem") == null || own.get("problem").isJsonNull()));
		String code = WorldShare.normalizeAddress(Hosting.find(id).address()).substring(0, 6);
		JsonObject entry = request("GET", base + "/v1/public/discover/" + code, null, null);
		t.check("Entdecken: öffentlicher Eintrag dauerhaft, mit Tags und Gastgeber", entry.get("persistent").getAsBoolean()
				&& entry.getAsJsonArray("tags").size() == 2 && entry.has("host") && entry.getAsJsonObject("host").has("head"));
		JsonObject liked = request("PUT", base + "/v1/discover/" + code + "/like", null, other.token);
		t.check("Entdecken: Gefällt mir einer anderen Spielerin", liked.get("liked").getAsBoolean() && liked.get("likes").getAsInt() == 1);

		t.setScreen(HeldixWorldsScreen::new);
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).searchDiscover("Autotest: dauerhafte Welt"));
		t.waitSoft(mc -> mc.gui.screen() instanceof HeldixWorldsScreen screen && screen.discoverEntries().stream().anyMatch(e -> e.code().equals(code)), 15);
		List<HostingService.DiscoverEntry> entries = t.compute(mc -> ((HeldixWorldsScreen) mc.gui.screen()).discoverEntries());
		HostingService.DiscoverEntry mineEntry = entries.stream().filter(e -> e.code().equals(code)).findFirst().orElse(null);
		t.check("Entdecken im Spiel: eigene dauerhafte Welt in der Liste (" + entries.size() + " Einträge)", mineEntry != null && mineEntry.persistent()
				&& mineEntry.likes() == 1 && mineEntry.tags().contains("survival"));
		List<String> texts = t.compute(HostingTests::describe);
		t.check("Entdecken im Spiel: Karte mit Name, Text, Tags, Spieler, Gastgeber (" + texts + ")", texts.stream().anyMatch(s -> s.startsWith(name))
				&& texts.contains("Autotest: dauerhafte Welt im Verzeichnis") && texts.stream().anyMatch(s -> s.contains("Survival") && s.contains("Spieler") && s.contains("von ")));
		t.check("Entdecken im Spiel: Beitreten; Gefällt mir bei der eigenen Welt gesperrt", t.compute(mc -> hasWidget(mc, HeldixWorldsScreen.JOIN_LABEL)
				&& hasWidgetWhere(mc, w -> w instanceof ActionButton && "1".equals(w.getMessage().getString()) && !w.active)));
		t.moveMouse(5, 5);
		t.screenshot("hosting-10-entdecken");
		t.setScreen(() -> null);
	}

	/**
	 * Welt einer anderen Spielerin (normal geteilt, Tunnel offen, Zugang offen, gelistet): im Spiel „Gefällt mir“ und
	 * „Melden“.
	 */
	private static void discoverForeign(TestContext t, String base, Player other) throws Exception {
		String worldName = "Autotest Fremd " + ThreadLocalRandom.current().nextInt(1000, 10_000);
		JsonObject create = new JsonObject();
		create.addProperty("name", worldName);
		create.addProperty("access", "open");
		JsonObject world = request("POST", base + "/v1/worlds", create, other.token);
		if (world.has("world") && world.get("world").isJsonObject()) world = world.getAsJsonObject("world");
		other.worldId = string(world, "id");
		String code = string(world, "code");
		t.check("Entdecken: Welt der anderen Spielerin angelegt", other.worldId != null && code != null);
		openTunnel(base, other);
		t.check("Entdecken: Tunnel der anderen Spielerin offen", other.hostMessages.stream().anyMatch(m -> m.contains("\"ready\"")));
		JsonObject listing = new JsonObject();
		listing.addProperty("description", "Autotest: Welt zum Liken und Melden");
		listing.add("tags", JsonParser.parseString("[\"kreativ\"]"));
		listing.addProperty("lang", "de");
		listing.addProperty("rulesAccepted", true);
		request("PUT", base + "/v1/worlds/" + other.worldId + "/listing", listing, other.token);

		t.setScreen(HeldixWorldsScreen::new);
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).searchDiscover(worldName));
		t.waitSoft(mc -> mc.gui.screen() instanceof HeldixWorldsScreen screen && screen.discoverEntries().stream().anyMatch(e -> e.code().equals(code)), 15);
		HostingService.DiscoverEntry entry = t.compute(mc -> ((HeldixWorldsScreen) mc.gui.screen()).discoverEntries().stream()
				.filter(e -> e.code().equals(code)).findFirst().orElse(null));
		t.check("Entdecken: geöffnete Welt der anderen Spielerin („geöffnet“)", entry != null && entry.state() == HostingService.State.ONLINE && !entry.persistent());
		// Gefällt mir: Knopf mit der Zahl (0) und dem Stern
		t.waitSoft(mc -> hasWidgetWhere(mc, w -> w instanceof ActionButton && "0".equals(w.getMessage().getString()) && w.active), 10);
		int[] like = t.widgetCenter(w -> w instanceof ActionButton && "0".equals(w.getMessage().getString()) && w.active, "Gefällt mir (0)");
		t.click(like[0], like[1]);
		t.waitSoft(mc -> hasWidgetWhere(mc, w -> w instanceof ActionButton && "1".equals(w.getMessage().getString())), 10);
		JsonObject liked = Social.request("GET", "/v1/discover/" + code + "/like", null, true).get(10, TimeUnit.SECONDS).getAsJsonObject();
		t.check("Entdecken: „Gefällt mir“ im Spiel (liked, 1)", liked.get("liked").getAsBoolean() && liked.get("likes").getAsInt() == 1);
		t.screenshot("hosting-11-gefaellt-mir");
		// Melden
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).showReport(code));
		t.waitSoft(mc -> hasWidget(mc, HeldixWorldsScreen.REPORT_LABEL), 5);
		t.check("Melden: Seite mit Grund, Notiz und Regeln", t.compute(mc -> joined(describe(mc)).contains("Keine Werbung für fremde Dienste")));
		t.moveMouse(5, 5);
		t.screenshot("hosting-12-melden");
		t.clickWidget(HeldixWorldsScreen.REPORT_LABEL);
		t.waitSoft(mc -> describe(mc).stream().anyMatch(s -> s.startsWith("Danke")), 10);
		t.check("Melden: angenommen („Danke …“)", t.compute(mc -> describe(mc).stream().anyMatch(s -> s.startsWith("Danke"))));
		String again;
		try {
			HostingService.report(code, "spam", null).get(10, TimeUnit.SECONDS);
			again = "angenommen";
		} catch (Exception e) {
			again = WorldService.message(e);
		}
		t.check("Melden: zweites Mal abgelehnt (" + again + ")", again.contains("schon gemeldet"));
		t.setScreen(() -> null);
	}

	/** Tunnel der anderen Spielerin (nur die Steuerverbindung: die Welt gilt als geöffnet) */
	private static void openTunnel(String base, Player player) throws Exception {
		player.host = HTTP.newWebSocketBuilder().header("Authorization", "Bearer " + player.token)
				.buildAsync(URI.create(base.replaceFirst("^http", "ws") + "/v1/worlds/host"), new WebSocket.Listener() {
					private final StringBuilder buffer = new StringBuilder();

					@Override
					public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
						buffer.append(data);
						if (last) {
							player.hostMessages.add(buffer.toString());
							buffer.setLength(0);
						}
						webSocket.request(1);
						return null;
					}
				}).get(10, TimeUnit.SECONDS);
		JsonObject open = new JsonObject();
		open.addProperty("type", "open");
		open.addProperty("world", player.worldId);
		open.addProperty("version", SharedConstants.getCurrentVersion().name());
		open.addProperty("protocol", SharedConstants.getProtocolVersion());
		open.addProperty("motd", "Autotest");
		open.addProperty("lanReady", true);
		player.host.sendText(open.toString(), true).get(10, TimeUnit.SECONDS);
		long until = System.currentTimeMillis() + 10_000;
		while (System.currentTimeMillis() < until && player.hostMessages.stream().noneMatch(m -> m.contains("\"ready\""))) TestContext.sleep(100);
	}

	// ======================================================================================
	// Herunterladen als neue Welt
	// ======================================================================================

	private static Path download(TestContext t, String id) throws Exception {
		t.setScreen(HeldixWorldsScreen::new);
		t.waitFor("Heldix-Welten geladen", mc -> mc.gui.screen() instanceof HeldixWorldsScreen screen && screen.loaded(), 15);
		t.run(mc -> ((HeldixWorldsScreen) mc.gui.screen()).showMine());
		t.waitSoft(mc -> activeWidget(mc, HeldixWorldsScreen.DOWNLOAD_LABEL), 10);
		t.clickWidget(HeldixWorldsScreen.DOWNLOAD_LABEL);
		t.waitFor("Fortschritt beim Herunterladen", mc -> mc.gui.screen() instanceof HostWorldScreen screen && screen.showingJob(), 10);
		t.waitSoft(mc -> HostingTransfer.current() != null && !HostingTransfer.current().running(), 600);
		HostingTransfer.Job job = t.compute(mc -> HostingTransfer.current());
		t.check("Herunterladen: fertig (" + (job == null ? "kein Auftrag" : job.phase() + (job.error() != null ? ": " + job.error() : "")) + ")",
				job != null && job.phase() == HostingTransfer.Phase.DONE && job.imported() != null);
		Path folder = job.imported();
		t.check("Herunterladen: neue Einzelspielerwelt „… (vom Heldix-Server)“ (" + folder.getFileName() + ")",
				folder.getFileName().toString().contains("(vom Heldix-Server)") && job.importedName().endsWith(HostingTransfer.IMPORT_SUFFIX));
		t.check("Herunterladen: level.dat da, ohne heldix-welt.json und session.lock", Files.isRegularFile(folder.resolve("level.dat"))
				&& !Files.exists(folder.resolve(WorldBackups.ID_FILE)) && !Files.exists(folder.resolve("session.lock")));
		t.check("Herunterladen: Nether und End wieder im Einzelspieler-Format (kein world_nether)", !Files.exists(folder.resolve("world_nether")));
		t.moveMouse(5, 5);
		t.screenshot("hosting-13-heruntergeladen");
		t.run(mc -> HostingTransfer.forget());
		t.setScreen(() -> null);
		return folder;
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static Player player(String base, String prefix) throws Exception {
		Player player = new Player();
		player.name = prefix + ThreadLocalRandom.current().nextInt(10_000, 100_000);
		player.uuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + player.name).getBytes(StandardCharsets.UTF_8));
		JsonObject login = new JsonObject();
		login.addProperty("name", player.name);
		login.addProperty("uuid", Social.compact(player.uuid));
		player.token = request("POST", base + "/v1/auth/dev", login, null).get("token").getAsString();
		return player;
	}

	private static void closePlayer(String base, Player player) {
		try {
			if (player.host != null) {
				player.host.sendText("{\"type\":\"close\"}", true).get(3, TimeUnit.SECONDS);
				player.host.abort();
			}
		} catch (Exception e) {
			// schon zu
		}
		if (player.worldId != null) {
			try {
				request("DELETE", base + "/v1/worlds/" + player.worldId, null, player.token);
			} catch (Exception e) {
				// egal
			}
		}
	}

	private static List<String> describe(net.minecraft.client.Minecraft mc) {
		if (mc.gui.screen() instanceof HeldixWorldsScreen screen) return screen.describe();
		if (mc.gui.screen() instanceof HostWorldScreen screen) return screen.describe();
		if (mc.gui.screen() instanceof ShareWorldScreen screen) return screen.describe();
		return List.of();
	}

	/** umbrochene Zeilen wieder als ein Text (Leerzeichen zusammengefasst) */
	private static String joined(List<String> texts) {
		return String.join(" ", texts).replaceAll("\\s+", " ");
	}

	private static boolean hasWidget(net.minecraft.client.Minecraft mc, String label) {
		return hasWidgetWhere(mc, w -> w.getMessage().getString().equals(label));
	}

	private static boolean hasWidgetStarting(net.minecraft.client.Minecraft mc, String label) {
		return hasWidgetWhere(mc, w -> w.getMessage().getString().startsWith(label));
	}

	private static boolean activeWidget(net.minecraft.client.Minecraft mc, String label) {
		return hasWidgetWhere(mc, w -> w.active && w.getMessage().getString().equals(label));
	}

	private static boolean hasWidgetWhere(net.minecraft.client.Minecraft mc, java.util.function.Predicate<AbstractWidget> filter) {
		if (mc.gui.screen() == null) return false;
		for (GuiEventListener child : mc.gui.screen().children()) {
			if (child instanceof AbstractWidget widget && widget.visible && filter.test(widget)) return true;
		}
		return false;
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}

	private static void deleteTree(Path dir) {
		try {
			if (!Files.exists(dir)) return;
			Files.walkFileTree(dir, new SimpleFileVisitor<>() {
				@Override
				public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) throws java.io.IOException {
					Files.delete(file);
					return FileVisitResult.CONTINUE;
				}

				@Override
				public FileVisitResult postVisitDirectory(Path directory, java.io.IOException error) throws java.io.IOException {
					Files.delete(directory);
					return FileVisitResult.CONTINUE;
				}
			});
		} catch (Exception e) {
			// bleibt liegen
		}
	}

	/** Anfrage an den Dienst; Fehler mit Status, ohne Token im Text */
	private static JsonObject request(String method, String url, JsonObject body, String token) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20))
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
