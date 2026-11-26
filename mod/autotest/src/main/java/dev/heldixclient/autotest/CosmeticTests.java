package dev.heldixclient.autotest;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.authlib.GameProfile;
import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.CosmeticChange;
import dev.heldixclient.api.CosmeticInfo;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.Registration;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.cosmetic.Capes;
import dev.heldixclient.cosmetic.CosmeticCatalog;
import dev.heldixclient.cosmetic.CosmeticFormat;
import dev.heldixclient.cosmetic.CosmeticRenderer;
import dev.heldixclient.cosmetic.Cosmetics;
import dev.heldixclient.loader.api.event.HudEvents;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.player.RemotePlayer;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.world.entity.Entity;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;

/**
 * Heldix-Cosmetics im echten Spiel (braucht den Heldix-Dienst mit dem Startsatz im Katalog, siehe docs/dienst.md):
 * Katalog laden und prüfen (auch ein veränderter Umschlag im Zwischenspeicher), Seite Cosmetics im Heldix-Menü mit
 * Auswahl über den Dienst, jedes Slot am eigenen Spieler (Anker, Animation, Begleiter folgt, Partikel begrenzt),
 * Cosmetics eines anderen Spielers aus dem Nachschlagen, Katalog-Capes, Inventar, Einstellungen, F1/Unsichtbar/Zuschauer,
 * die Addon-API (Vorschau, Effekte, Änderungen) und eine Messung mit 20 Spielern.
 */
final class CosmeticTests {
	private static final HttpClient HTTP = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
	/** Höhe der Anker über den Füßen eines stehenden Spielers (Modell 0,9375-fach): Kopf-Oberseite und Schulter */
	private static final double HEAD_TOP = 2.001 * 0.9375;
	private static final double SHOULDER = 1.501 * 0.9375;
	private static final List<String> SLOTS = List.of("head", "back", "aura", "companion");

	private CosmeticTests() {
	}

	/** fehlgeschlagene Prüfungen: der Test läuft weiter, am Ende schlägt er fehl (zeigt alle Probleme auf einmal) */
	private static final List<String> FAILED = new CopyOnWriteArrayList<>();

	private static void check(TestContext t, String what, boolean ok) {
		if (ok) t.check(what, true);
		else {
			FAILED.add(what);
			AutoTest.LOG.error("AUTOTEST [FEHLER] {}", what);
		}
	}

	static void run(TestContext t) {
		FAILED.clear();
		if (t.compute(mc -> Social.state()) == Social.State.DISABLED) {
			t.log("Cosmetics: Heldix-Dienst nicht eingerichtet (--service fehlt), Test übersprungen");
			return;
		}
		List<RemotePlayer> remotes = new ArrayList<>();
		// für saubere Bilder: HUD-Module und Chat aus (F1 ginge nicht – damit sind auch die Cosmetics aus)
		List<dev.heldixclient.module.HudModule> hudOn = t.compute(mc -> dev.heldixclient.module.ModuleManager.hud().stream()
				.filter(dev.heldixclient.module.HudModule::isEnabled).toList());
		net.minecraft.world.entity.player.ChatVisiblity chat = t.compute(mc -> mc.options.chatVisibility().get());
		t.run(mc -> {
			hudOn.forEach(m -> m.setEnabled(false));
			mc.options.chatVisibility().set(net.minecraft.world.entity.player.ChatVisiblity.HIDDEN);
		});
		try {
			t.waitSoft(mc -> Social.online(), 20);
			check(t, "Cosmetics: Heldix-Dienst verbunden", t.compute(mc -> Social.online()));
			catalog(t);
			menu(t);
			own(t);
			other(t, remotes);
			api(t);
			performance(t, remotes);
		} catch (Exception | AssertionError e) {
			AutoTest.LOG.error("Cosmetics-Test fehlgeschlagen", e);
			FAILED.add("Ausnahme: " + e);
		} finally {
			t.run(mc -> {
				for (RemotePlayer remote : remotes) mc.level.removeEntity(remote.getId(), Entity.RemovalReason.DISCARDED);
				Social.forgetPlayers();
				Cosmetics.clearLocal();
				HeldixConfig.Data config = HeldixConfig.get();
				config.cosmeticsOthers = true;
				config.cosmeticParticlesOthers = true;
				config.cosmeticHatOverHelmet = true;
				if (mc.gui.hud.isHidden()) mc.gui.hud.toggle();
				hudOn.forEach(m -> m.setEnabled(true));
				mc.options.chatVisibility().set(chat);
				mc.options.setCameraType(CameraType.FIRST_PERSON);
				mc.gui.setScreen(null);
			});
			t.serverCommand("effect clear @p");
			t.serverCommand("item replace entity @p armor.head with minecraft:air");
			t.serverCommand("gamemode creative @p");
		}
		t.check("Cosmetics: alle Prüfungen bestanden" + (FAILED.isEmpty() ? "" : " – fehlgeschlagen: " + FAILED), FAILED.isEmpty());
	}

	// ======================================================================================
	// Katalog: laden, prüfen, Zwischenspeicher
	// ======================================================================================

	private static void catalog(TestContext t) throws Exception {
		t.waitSoft(mc -> CosmeticCatalog.status() == CosmeticCatalog.Status.READY && CosmeticCatalog.items().size() >= 15, 40);
		List<CosmeticCatalog.Item> items = t.compute(mc -> CosmeticCatalog.items());
		t.log("Cosmetics im Katalog: " + items.stream().map(i -> i.id() + "(" + i.slot() + ")").toList() + ", verworfen " + CosmeticCatalog.rejected());
		check(t, "Cosmetics: Katalog geladen und geprüft (" + items.size() + ")", items.size() == 15 && CosmeticCatalog.rejected().isEmpty());
		for (String slot : List.of("head", "back", "aura", "companion", "cape")) {
			int expected = switch (slot) {
				case "head" -> 5;
				case "back", "aura" -> 3;
				default -> 2;
			};
			check(t, "Cosmetics: " + expected + " im Slot " + slot, t.compute(mc -> CosmeticCatalog.items(slot).size()) == expected);
		}
		check(t, "Cosmetics: Team-Krone nur fürs Team", t.compute(mc -> CosmeticCatalog.item("team-krone").teamOnly() && !CosmeticCatalog.item("krone").teamOnly()));
		check(t, "Cosmetics: Modelle mit Bones und Flächen (Engelsflügel: 4 Bones, Ebenen mit zwei Seiten)", t.compute(mc -> {
			CosmeticCatalog.Item wings = CosmeticCatalog.item("engelsfluegel");
			return wings.mesh().boneCount() == 4 && wings.mesh().vertexCount() == 4 * 2 * 4 && wings.mesh().flaps();
		}));

		// Zwischenspeicher: je Umschlag eine Datei <sha256>.json
		Path dir = CosmeticCatalog.cacheDir();
		long files;
		try (Stream<Path> list = Files.list(dir)) {
			files = list.filter(p -> p.getFileName().toString().endsWith(".json")).count();
		}
		check(t, "Cosmetics: Umschläge im Zwischenspeicher (" + files + " in " + dir.getFileName() + ")", files == 15);

		// Signatur: echter Umschlag gilt, verändertes Manifest oder verändertes Signatur-Byte nicht
		CosmeticCatalog.Item krone = t.compute(mc -> CosmeticCatalog.item("krone"));
		Path kroneFile = dir.resolve(krone.sha256() + ".json");
		String envelope = Files.readString(kroneFile, StandardCharsets.UTF_8);
		check(t, "Cosmetics: echter Umschlag besteht die Prüfung", "krone".equals(CosmeticCatalog.verify(envelope).id()));
		JsonObject json = JsonParser.parseString(envelope).getAsJsonObject();
		String manifest = json.get("manifest").getAsString();
		JsonObject changed = json.deepCopy();
		changed.addProperty("manifest", manifest.replace("\"Krone\"", "\"Gefälschte Krone\""));
		check(t, "Cosmetics: verändertes Manifest abgelehnt (" + rejection(changed.toString()) + ")", rejection(changed.toString()).contains("Signatur passt nicht"));
		String signature = json.get("signature").getAsString();
		JsonObject badSignature = json.deepCopy();
		badSignature.addProperty("signature", (signature.charAt(0) == 'A' ? "B" : "A") + signature.substring(1));
		check(t, "Cosmetics: veränderte Signatur abgelehnt", rejection(badSignature.toString()).contains("Signatur passt nicht"));
		check(t, "Cosmetics: kein Umschlag ohne Signatur", rejection("{\"manifest\":\"{}\"}").contains("„signature“ fehlt"));

		// Regeln des Formats (wie service/src/cosmetics-format.ts, gleiche Meldungen)
		JsonObject parsed = JsonParser.parseString(manifest).getAsJsonObject();
		JsonObject extra = parsed.deepCopy();
		extra.addProperty("skript", "alert(1)");
		check(t, "Cosmetics: unbekanntes Feld abgelehnt", ruleError(extra).equals("„skript“ ist kein bekanntes Feld (Format 1)"));
		JsonObject builtin = parsed.deepCopy();
		builtin.addProperty("id", "glut");
		check(t, "Cosmetics: ID eines eingebauten Capes abgelehnt", ruleError(builtin).startsWith("„id“ darf nicht die ID eines eingebauten Capes sein"));
		JsonObject tooBig = parsed.deepCopy();
		tooBig.getAsJsonObject("model").getAsJsonArray("bones").get(0).getAsJsonObject().getAsJsonArray("cubes").get(0).getAsJsonObject()
				.getAsJsonArray("size").set(0, new com.google.gson.JsonPrimitive(40));
		check(t, "Cosmetics: zu große Würfelkante abgelehnt (" + ruleError(tooBig) + ")", ruleError(tooBig).endsWith("muss eine Liste aus drei Zahlen von 0 bis 32 sein"));
		JsonObject longName = parsed.deepCopy();
		longName.addProperty("name", "x".repeat(41));
		check(t, "Cosmetics: zu langer Name abgelehnt", ruleError(longName).equals("„name“ ist zu lang (höchstens 40 Zeichen)"));
		JsonObject badPng = parsed.deepCopy();
		badPng.addProperty("texture", CosmeticFormat.PNG_DATA_URL_PREFIX + "iVBORw0KGgo=");
		check(t, "Cosmetics: kaputtes PNG abgelehnt (" + ruleError(badPng) + ")", ruleError(badPng).startsWith("„texture“ ist beschädigt"));
		check(t, "Cosmetics: echtes Manifest erfüllt alle Regeln", ruleError(parsed).isEmpty());

		// Palette-PNG (Farbtyp 3 mit tRNS): dekodiert und mit sichtbaren Pixeln
		check(t, "Cosmetics: Krone ist ein Palette-PNG", (krone.manifest().texture()[25] & 0xFF) == 3);
		int opaque = t.compute(mc -> {
			DynamicTexture texture = (DynamicTexture) mc.getTextureManager().getTexture(krone.texture());
			NativeImage image = texture.getPixels();
			int count = 0;
			for (int y = 0; y < image.getHeight(); y++) for (int x = 0; x < image.getWidth(); x++) if ((image.getPixel(x, y) >>> 24) > 200) count++;
			return count;
		});
		check(t, "Cosmetics: Palette-PNG dekodiert (" + opaque + " deckende Pixel)", opaque > 100);

		// veränderter Umschlag im Zwischenspeicher: wird verworfen und neu geladen
		Files.writeString(kroneFile, changed.toString(), StandardCharsets.UTF_8);
		t.run(mc -> CosmeticCatalog.forgetForTest());
		t.run(mc -> CosmeticCatalog.refresh(true));
		t.waitSoft(mc -> CosmeticCatalog.status() == CosmeticCatalog.Status.READY && CosmeticCatalog.items().size() == 15, 30);
		String restored = Files.readString(kroneFile, StandardCharsets.UTF_8);
		check(t, "Cosmetics: veränderter Zwischenspeicher verworfen und neu geladen", t.compute(mc -> CosmeticCatalog.items().size()) == 15
				&& restored.equals(envelope) && CosmeticCatalog.rejected().isEmpty());
	}

	private static String rejection(String envelope) {
		try {
			CosmeticCatalog.verify(envelope);
			return "angenommen";
		} catch (CosmeticFormat.InvalidCosmeticException e) {
			return e.getMessage();
		}
	}

	private static String ruleError(JsonObject manifest) {
		try {
			CosmeticFormat.parseManifest(manifest.toString());
			return "";
		} catch (CosmeticFormat.InvalidCosmeticException e) {
			return e.getMessage();
		}
	}

	// ======================================================================================
	// Heldix-Menü: Seite Cosmetics, Auswahl über den Dienst
	// ======================================================================================

	private static void menu(TestContext t) throws Exception {
		// frisch: nichts gewählt
		for (String slot : SLOTS) {
			if (t.compute(mc -> Cosmetics.mine(slot)) != null) t.compute(mc -> Cosmetics.choose(slot, null)).get(10, java.util.concurrent.TimeUnit.SECONDS);
		}
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.COSMETICS));
		t.waitTicks(10);
		check(t, "Cosmetics: Seite im Heldix-Menü", "COSMETICS".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).currentTab())));
		List<String> tabIds = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabIds());
		check(t, "Cosmetics: Reiter je Slot und Optionen (" + tabIds + ")", tabIds.equals(List.of("cosmetics:HEAD", "cosmetics:BACK", "cosmetics:AURA", "cosmetics:COMPANION", "cosmetics:OPTIONS")));

		chooseInMenu(t, "head", "krone", "heldix-40-cosmetics-kopf");
		chooseInMenu(t, "back", "engelsfluegel", "heldix-40b-cosmetics-ruecken");
		chooseInMenu(t, "aura", "herzen", "heldix-40c-cosmetics-partikel");
		chooseInMenu(t, "companion", "mini-drache", "heldix-40d-cosmetics-begleiter");

		// beim Dienst gespeichert (eigene Anmeldung als derselbe Spieler im Entwicklungsmodus)
		JsonObject mine = request("GET", "/v1/me/cosmetics", null, token(t));
		check(t, "Cosmetics: Auswahl beim Dienst gespeichert (" + mine + ")", "krone".equals(mine.get("head").getAsString())
				&& "engelsfluegel".equals(mine.get("back").getAsString()) && "herzen".equals(mine.get("aura").getAsString())
				&& "mini-drache".equals(mine.get("companion").getAsString()) && !mine.get("team").getAsBoolean());
		check(t, "Cosmetics: Auswahl gemerkt (Konfiguration)", t.compute(mc -> "krone".equals(HeldixConfig.get().cosmetics.get("head"))));

		// Team-Krone: markiert, für Nicht-Mitglieder nicht wählbar (weder im Menü noch über den Dienst)
		openTab(t, "head");
		int teamIndex = index(t, "head", "team-krone");
		int[] team = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticCenter(teamIndex));
		t.moveMouse(team[0], team[1]);
		t.waitTicks(4);
		t.screenshot("heldix-40e-cosmetics-team");
		t.click(team[0], team[1]);
		t.waitTicks(10);
		check(t, "Cosmetics: Team-Krone im Menü nicht wählbar", "krone".equals(t.compute(mc -> Cosmetics.mine("head")))
				&& t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows()).stream().anyMatch(r -> r.contains("nur für das HeldixClient-Team")));
		String teamError;
		try {
			t.compute(mc -> Cosmetics.choose("head", "team-krone")).get(10, java.util.concurrent.TimeUnit.SECONDS);
			teamError = "angenommen";
		} catch (java.util.concurrent.ExecutionException e) {
			teamError = e.getCause().getMessage();
		}
		check(t, "Cosmetics: Team-Krone über die API abgelehnt (" + teamError + ")", teamError.contains("nur für das HeldixClient-Team"));
		JsonObject put = new JsonObject();
		put.addProperty("slot", "head");
		put.addProperty("id", "team-krone");
		String serviceAnswer;
		try {
			request("PUT", "/v1/me/cosmetics", put, token(t));
			serviceAnswer = "angenommen";
		} catch (IllegalStateException e) {
			serviceAnswer = e.getMessage();
		}
		check(t, "Cosmetics: Dienst lehnt Team-Krone ab (" + serviceAnswer + ")", serviceAnswer.contains(" 403 "));

		// Optionen
		openTab(t, "options");
		t.moveMouse(5, 5);
		t.waitTicks(4);
		t.screenshot("heldix-40f-cosmetics-optionen");
		check(t, "Cosmetics: Optionen mit drei Schaltern", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows()).stream()
				.filter(r -> r.startsWith("Group")).count() == 1);

		// ohne Verbindung: klare Meldung (Offline-Konto, Dienst aus) – im Menü und bei der Auswahl
		check(t, "Cosmetics: Meldung für Offline-Konten", Cosmetics.problemFor(Social.State.OFFLINE_ACCOUNT).contains("Microsoft-Konto"));
		t.run(mc -> Social.setEnabled(false));
		t.waitSoft(mc -> Social.state() == Social.State.OFF, 5);
		String offError;
		try {
			t.compute(mc -> Cosmetics.choose("head", "zylinder")).get(10, java.util.concurrent.TimeUnit.SECONDS);
			offError = "angenommen";
		} catch (java.util.concurrent.ExecutionException e) {
			offError = e.getCause().getMessage();
		}
		check(t, "Cosmetics: Dienst aus – Auswahl mit Meldung abgelehnt (" + offError + ")", offError.contains("ausgeschaltet"));
		openTab(t, "head");
		int zylinderIndex = index(t, "head", "zylinder");
		int[] zylinder = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticCenter(zylinderIndex));
		t.click(zylinder[0], zylinder[1]);
		t.waitTicks(6);
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToTop());
		t.moveMouse(5, 5);
		t.waitTicks(4);
		t.screenshot("heldix-40g-cosmetics-ohne-dienst");
		check(t, "Cosmetics: Dienst aus – Hinweis im Menü, Auswahl bleibt", "krone".equals(t.compute(mc -> Cosmetics.mine("head")))
				&& t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows()).stream().anyMatch(r -> r.startsWith("Notice:") && r.contains("ausgeschaltet")));
		t.run(mc -> Social.setEnabled(true));
		t.waitSoft(mc -> Social.online(), 20);
		check(t, "Cosmetics: Dienst wieder verbunden", t.compute(mc -> Social.online()));
		t.setScreen(() -> null);
	}

	private static void chooseInMenu(TestContext t, String slot, String id, String screenshot) {
		openTab(t, slot);
		int index = index(t, slot, id);
		int[] center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticCenter(index));
		t.moveMouse(center[0], center[1]);
		t.waitTicks(6);
		check(t, "Cosmetics: Kachel " + id + " unter der Maus zeigt die Vorschau", id.equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticHovered())));
		t.screenshot(screenshot);
		t.click(center[0], center[1]);
		t.waitSoft(mc -> id.equals(Cosmetics.mine(slot)), 10);
		check(t, "Cosmetics: Klick legt " + id + " an (über den Dienst)", id.equals(t.compute(mc -> Cosmetics.mine(slot))));
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToTop());
		t.moveMouse(5, 5);
		t.waitTicks(8);
		t.screenshot(screenshot + "-figur");
	}

	/** Reiter der Seite Cosmetics anklicken: Slot oder "options" */
	private static void openTab(TestContext t, String slot) {
		String id = "cosmetics:" + (slot.equals("options") ? "OPTIONS" : slot.toUpperCase(java.util.Locale.ROOT));
		for (int i = 0; i < 3 && !slot.equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticTab())); i++) {
			int[] center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabCenter(id));
			t.click(center[0], center[1]);
			t.waitTicks(3);
		}
		check(t, "Cosmetics: Reiter " + slot + " ist offen", slot.equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticTab())));
	}

	/** Index der Kachel (0 = Ohne) */
	private static int index(TestContext t, String slot, String id) {
		List<CosmeticCatalog.Item> items = t.compute(mc -> CosmeticCatalog.items(slot));
		for (int i = 0; i < items.size(); i++) if (items.get(i).id().equals(id)) return i + 1;
		throw new AssertionError("Kein Cosmetic " + id + " im Slot " + slot);
	}

	// ======================================================================================
	// Eigener Spieler: Third-Person-Ansicht und Inventar
	// ======================================================================================

	private static void own(TestContext t) {
		UUID own = t.compute(mc -> mc.player.getUUID());
		t.serverCommand("tp @p ~ ~ ~ 0 0");
		t.run(mc -> {
			face(mc, 0f);
			mc.options.setCameraType(CameraType.THIRD_PERSON_FRONT);
		});
		t.waitTicks(30);
		CosmeticRenderer.Probe probe = probe(t, own);
		double[] feet = t.compute(mc -> new double[] {mc.player.getX(), mc.player.getY(), mc.player.getZ()});
		t.log("Anker eigener Spieler: Füße " + fmt(feet) + ", Kopf " + fmt(probe.head()) + ", Rücken " + fmt(probe.back()) + ", Begleiter " + fmt(probe.companion())
				+ ", Partikel " + probe.particles());
		check(t, "Cosmetics: Krone sitzt auf der Kopf-Oberseite (" + fmt(probe.head()) + ")", near(probe.head(), feet[0], feet[1] + HEAD_TOP, feet[2], 0.12));
		check(t, "Cosmetics: Flügel am Rücken auf Schulterhöhe (" + fmt(probe.back()) + ")", near(probe.back(), feet[0], feet[1] + SHOULDER, feet[2], 0.12));
		// Blick nach Süden (+z): rechte Seite = -x, offset (0,8 | 1,45 | -0,3)
		check(t, "Cosmetics: Begleiter schwebt rechts neben dem Spieler (" + fmt(probe.companion()) + ")",
				near(probe.companion(), feet[0] - 0.8, feet[1] + 1.45, feet[2] - 0.3, 0.15));
		check(t, "Cosmetics: Aura-Partikel um den Spieler (" + probe.particles() + ")", probe.particles() > 0 && probe.particles() <= CosmeticRenderer.MAX_PARTICLES);
		t.screenshot("heldix-41-cosmetics-f5-vorn");

		// Animation: Flügel und Begleiter bewegen sich
		CosmeticRenderer.Probe later = probe(t, own, 8);
		check(t, "Cosmetics: Flügel schlagen (Pose ändert sich: " + probe.backPose() + " → " + later.backPose() + ")", Math.abs(probe.backPose() - later.backPose()) > 1e-3);
		check(t, "Cosmetics: Begleiter ist animiert", Math.abs(probe.companionPose() - later.companionPose()) > 1e-3);

		// im freien Fall schlagen die Flügel schneller (bis doppelt so schnell)
		t.run(mc -> mc.player.getAbilities().flying = false);
		t.serverCommand("tp @p ~ ~30 ~");
		t.waitTicks(12);
		double falling = probe(t, own, 1).flapFactor();
		check(t, "Cosmetics: im Fall schlagen die Flügel schneller (Faktor " + round(falling) + ")", falling > 1.4 && falling <= 2.0);
		t.waitSoft(mc -> mc.player.onGround(), 10);
		t.waitTicks(30);
		check(t, "Cosmetics: am Boden wieder normal (Faktor " + round(probe(t, own).flapFactor()) + ")", probe(t, own).flapFactor() < 1.2);

		// von hinten: Flügel
		t.run(mc -> mc.options.setCameraType(CameraType.THIRD_PERSON_BACK));
		t.waitTicks(10);
		t.screenshot("heldix-41b-cosmetics-f5-hinten");

		// Begleiter folgt weich: nach einem Sprung erst hinterher, dann wieder neben dem Spieler
		double[] moved = t.compute(mc -> {
			mc.player.setPos(mc.player.getX() + 3, mc.player.getY(), mc.player.getZ());
			mc.player.xo = mc.player.getX();
			mc.player.xOld = mc.player.getX();
			return new double[] {mc.player.getX(), mc.player.getY(), mc.player.getZ()};
		});
		CosmeticRenderer.Probe lagging = probe(t, own, 1);
		double lag = distance(lagging.companion(), moved[0] - 0.8, moved[1] + 1.45, moved[2] - 0.3);
		t.waitTicks(50);
		CosmeticRenderer.Probe caught = probe(t, own);
		double after = distance(caught.companion(), moved[0] - 0.8, moved[1] + 1.45, moved[2] - 0.3);
		check(t, "Cosmetics: Begleiter folgt weich (Abstand " + Math.round(lag * 100) / 100.0 + " → " + Math.round(after * 100) / 100.0 + " Blöcke)", lag > 0.4 && after < 0.15);

		// Helm: Hut sitzt einen Pixel höher; Option aus: mit Helm kein Hut
		double headY = probe(t, own).head()[1];
		t.serverCommand("item replace entity @p armor.head with minecraft:diamond_helmet");
		t.waitTicks(6);
		double helmetY = probe(t, own).head()[1];
		check(t, "Cosmetics: Hut über dem Helm (" + Math.round((helmetY - headY) * 1000) / 1000.0 + " Blöcke höher)", Math.abs(helmetY - headY - 0.9375 / 16) < 0.01);
		t.run(mc -> HeldixConfig.get().cosmeticHatOverHelmet = false);
		check(t, "Cosmetics: „Hut über Helm zeigen“ aus: mit Helm kein Hut", !rendering(t, own, "head"));
		t.run(mc -> HeldixConfig.get().cosmeticHatOverHelmet = true);
		t.serverCommand("item replace entity @p armor.head with minecraft:air");

		// F1, unsichtbar, Zuschauer: nichts
		t.run(mc -> mc.gui.hud.toggle());
		check(t, "Cosmetics: mit F1 ausgeblendet", !rendering(t, own, "head") && !rendering(t, own, "companion"));
		t.run(mc -> mc.gui.hud.toggle());
		check(t, "Cosmetics: ohne F1 wieder da", rendering(t, own, "head"));
		t.serverCommand("effect give @p minecraft:invisibility 30 0 true");
		check(t, "Cosmetics: unsichtbar ohne Cosmetics", !rendering(t, own, "head") && !rendering(t, own, "back") && !rendering(t, own, "companion"));
		t.serverCommand("effect clear @p");
		t.serverCommand("gamemode spectator @p");
		check(t, "Cosmetics: Zuschauer ohne Cosmetics", !rendering(t, own, "back") && !rendering(t, own, "aura"));
		t.serverCommand("gamemode creative @p");
		check(t, "Cosmetics: wieder sichtbar", rendering(t, own, "back"));

		// Katalog-Cape am eigenen Spieler (über die bestehende Cape-Technik, mit Animation)
		t.run(mc -> Capes.select(Capes.byId("ozean")));
		t.waitSoft(mc -> mc.player.getSkin().cape() != null && mc.player.getSkin().cape().texturePath().getPath().contains("cape/katalog/ozean/"), 15);
		String capePath = t.compute(mc -> mc.player.getSkin().cape() == null ? "" : mc.player.getSkin().cape().texturePath().getPath());
		check(t, "Cosmetics: Katalog-Cape „Ozean“ am eigenen Spieler (" + capePath + ")", capePath.contains("cape/katalog/ozean/"));
		t.waitTicks(4);
		String capeLater = t.compute(mc -> mc.player.getSkin().cape().texturePath().getPath());
		check(t, "Cosmetics: Katalog-Cape ist animiert (" + capePath + " → " + capeLater + ")", !capeLater.equals(capePath));
		t.run(mc -> {
			Cosmetics.choose("back", null);
			face(mc, 180f);
		});
		t.waitTicks(20);
		t.screenshot("heldix-41c-cosmetics-katalog-cape");
		// Cape-Seite: Katalog-Capes unter den eingebauten
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.CAPE));
		t.waitTicks(10);
		check(t, "Cosmetics: Cape-Seite zeigt die Katalog-Capes", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows()).contains("Section:Aus dem Katalog"));
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToEnd());
		t.moveMouse(5, 5);
		t.waitTicks(40);
		t.screenshot("heldix-46-cape-katalog");
		t.setScreen(() -> null);
		JsonObject meProfile = request("GET", "/v1/me", null, token(t));
		check(t, "Cosmetics: Katalog-Cape beim Dienst (" + meProfile.get("cape") + ")", "ozean".equals(meProfile.get("cape").getAsString()));
		t.run(mc -> Cosmetics.choose("back", "engelsfluegel"));
		t.waitSoft(mc -> "engelsfluegel".equals(Cosmetics.mine("back")), 10);

		// Inventar: Figur mit Cosmetics (Überlebensmodus zeigt das normale Inventar)
		t.serverCommand("gamemode survival @p");
		t.run(mc -> {
			face(mc, 0f);
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			mc.gui.setScreen(new InventoryScreen(mc.player));
		});
		t.waitTicks(20);
		t.moveMouse(t.compute(mc -> mc.getWindow().getGuiScaledWidth() / 2 - 40), t.compute(mc -> mc.getWindow().getGuiScaledHeight() / 2 - 60));
		t.waitTicks(10);
		t.screenshot("heldix-43-cosmetics-inventar");
		check(t, "Cosmetics: Inventar zeigt die eigenen Cosmetics (Partikel in der Figur: " + t.compute(mc -> CosmeticRenderer.guiParticles(own)) + ")",
				t.compute(mc -> CosmeticRenderer.guiParticles(own)) > 0);
		t.setScreen(() -> null);
		t.serverCommand("gamemode creative @p");
		t.run(mc -> Capes.select(Capes.byId("heldix")));
	}

	// ======================================================================================
	// Anderer Spieler: Cosmetics aus dem Nachschlagen
	// ======================================================================================

	private static JsonObject lookup(String cape, String head, String back, String aura, String companion) {
		JsonObject entry = new JsonObject();
		entry.addProperty("cape", cape);
		entry.add("badge", JsonNull.INSTANCE);
		JsonObject cosmetics = new JsonObject();
		String[] slots = {"head", "back", "aura", "companion"};
		String[] ids = {head, back, aura, companion};
		for (int i = 0; i < 4; i++) {
			if (ids[i] == null) cosmetics.add(slots[i], JsonNull.INSTANCE);
			else cosmetics.addProperty(slots[i], ids[i]);
		}
		entry.add("cosmetics", cosmetics);
		return entry;
	}

	private static void other(TestContext t, List<RemotePlayer> remotes) {
		UUID uuid = UUID.nameUUIDFromBytes("HeldixCosmetics:Freund".getBytes(StandardCharsets.UTF_8));
		t.run(mc -> {
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			face(mc, 0f);
			mc.player.setXRot(12f);
			mc.player.xRotO = 12f;
			Social.testLookup(uuid, lookup("pixelregen", "zylinder", "drachenfluegel", "funken", "gluehwuermchen-geist"));
			RemotePlayer remote = new RemotePlayer(mc.level, new GameProfile(uuid, "Kosmetiker"));
			remote.setId(-4500);
			showAllParts(remote);
			remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3.2, 180f, 0f);
			remote.yBodyRot = 180f;
			remote.yHeadRot = 180f;
			mc.level.addEntity(remote);
			remotes.add(remote);
		});
		RemotePlayer remote = remotes.getFirst();
		t.waitTicks(30);
		CosmeticRenderer.Probe probe = probe(t, uuid);
		double[] feet = t.compute(mc -> new double[] {remote.getX(), remote.getY(), remote.getZ()});
		t.log("Anker anderer Spieler: Füße " + fmt(feet) + ", Kopf " + fmt(probe.head()) + ", Rücken " + fmt(probe.back()) + ", Begleiter " + fmt(probe.companion()));
		check(t, "Cosmetics: anderer Spieler – Zylinder auf dem Kopf", near(probe.head(), feet[0], feet[1] + HEAD_TOP, feet[2], 0.12));
		check(t, "Cosmetics: anderer Spieler – Drachenflügel am Rücken", near(probe.back(), feet[0], feet[1] + SHOULDER, feet[2], 0.12));
		// Blick nach Norden (−z): rechte Seite = +x, offset (−0,75 | 1,7 | −0,2) → links (−x), hinten (+z)
		check(t, "Cosmetics: anderer Spieler – Geist schwebt links neben ihm (" + fmt(probe.companion()) + ")",
				near(probe.companion(), feet[0] - 0.75, feet[1] + 1.7, feet[2] + 0.2, 0.15));
		check(t, "Cosmetics: anderer Spieler – Funken (" + probe.particles() + ")", probe.particles() > 0 && probe.particles() <= CosmeticRenderer.MAX_PARTICLES);
		t.waitSoft(mc -> remote.getSkin().cape() != null && remote.getSkin().cape().texturePath().getPath().contains("cape/katalog/pixelregen/"), 15);
		check(t, "Cosmetics: anderer Spieler – Katalog-Cape „Pixelregen“", t.compute(mc -> remote.getSkin().cape() != null
				&& remote.getSkin().cape().texturePath().getPath().contains("cape/katalog/pixelregen/")));
		t.screenshot("heldix-42-cosmetics-anderer-vorn");

		// je Slot ein Bild aus der Nähe
		String[][] shots = {
				{"heldix-42a-slot-kopf-krone", "krone", null, null, null, "180"},
				{"heldix-42b-slot-kopf-heiligenschein", "heiligenschein", null, null, null, "200"},
				{"heldix-42c-slot-ruecken-engel", null, "engelsfluegel", null, null, "20"},
				{"heldix-42d-slot-ruecken-drache", null, "drachenfluegel", null, null, "-20"},
				{"heldix-42e-slot-ruecken-schwert", null, "schwert-ruecken", null, null, "35"},
				{"heldix-42f-slot-begleiter-drache", null, null, null, "mini-drache", "150"},
				{"heldix-42g-slot-begleiter-geist", null, null, null, "gluehwuermchen-geist", "210"},
				{"heldix-42h-slot-aura-herzen", null, null, "herzen", null, "180"},
				{"heldix-42i-slot-aura-blaetter", null, null, "blaetter", null, "180"},
				{"heldix-42j-slot-kopf-partyhut", "partyhut", null, null, null, "160"},
				{"heldix-42k-slot-kopf-teamkrone", "team-krone", null, null, null, "180"},
				{"heldix-42l-slot-cape-pixelregen", null, null, null, null, "10"}};
		for (String[] shot : shots) {
			float yaw = Float.parseFloat(shot[5]);
			t.run(mc -> {
				Social.testLookup(uuid, lookup("pixelregen", shot[1], shot[2], shot[3], shot[4]));
				remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 2.4, yaw, 0f);
				remote.yBodyRot = yaw;
				remote.yBodyRotO = yaw;
				remote.yHeadRot = yaw;
				remote.yHeadRotO = yaw;
			});
			t.waitTicks(shot[3] != null ? 70 : 25);
			t.screenshot(shot[0]);
		}

		// Einstellungen: Cosmetics bzw. Partikel anderer aus
		t.run(mc -> {
			Social.testLookup(uuid, lookup("pixelregen", "zylinder", "drachenfluegel", "funken", "gluehwuermchen-geist"));
			remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3.2, 180f, 0f);
			remote.yBodyRot = 180f;
			remote.yHeadRot = 180f;
		});
		t.waitTicks(10);
		t.run(mc -> HeldixConfig.get().cosmeticParticlesOthers = false);
		check(t, "Cosmetics: „Partikel anderer zeigen“ aus", !rendering(t, uuid, "aura") && rendering(t, uuid, "head"));
		t.run(mc -> HeldixConfig.get().cosmeticsOthers = false);
		check(t, "Cosmetics: „Cosmetics anderer zeigen“ aus", !rendering(t, uuid, "head") && !rendering(t, uuid, "companion"));
		t.run(mc -> {
			HeldixConfig.get().cosmeticsOthers = true;
			HeldixConfig.get().cosmeticParticlesOthers = true;
		});
		check(t, "Cosmetics: wieder an", rendering(t, uuid, "head") && rendering(t, uuid, "aura"));

		// Dienst meldet null (ausgeblendet/gelöscht): nichts
		t.run(mc -> Social.testLookup(uuid, lookup("", null, null, null, null)));
		check(t, "Cosmetics: null vom Dienst – nichts", !rendering(t, uuid, "head") && !rendering(t, uuid, "back") && !rendering(t, uuid, "companion"));
		// unbekannte oder unpassende IDs (nicht im Katalog bzw. falscher Slot): nichts
		t.run(mc -> Social.testLookup(uuid, lookup("", "engelsfluegel", "gibt-es-nicht", null, null)));
		check(t, "Cosmetics: ID im falschen Slot oder unbekannt – nichts", !rendering(t, uuid, "head") && !rendering(t, uuid, "back"));
		t.run(mc -> Social.testLookup(uuid, lookup("pixelregen", "zylinder", "drachenfluegel", "funken", "gluehwuermchen-geist")));

		// Partikel anderer nur in der Nähe
		t.run(mc -> remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 52, 180f, 0f));
		t.waitTicks(10);
		if (rendering(t, uuid, "head")) check(t, "Cosmetics: Partikel in 52 Blöcken Entfernung nicht gezeichnet", !rendering(t, uuid, "aura"));
		else t.log("Spieler in 52 Blöcken wird nicht gezeichnet (Sichtweite) – Prüfung der Partikel-Entfernung übersprungen");
		t.run(mc -> remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3.2, 180f, 0f));
	}

	// ======================================================================================
	// Addon-API
	// ======================================================================================

	private static void api(TestContext t) throws Exception {
		LoadedAddon uhrzeit = t.compute(mc -> AddonManager.addons().stream().filter(a -> "uhrzeit".equals(a.id())).findFirst().orElseThrow());
		HeldixApi api = uhrzeit.api();
		dev.heldixclient.api.Cosmetics cosmetics = api.cosmetics();
		UUID own = t.compute(mc -> mc.player.getUUID());
		UUID other = UUID.nameUUIDFromBytes("HeldixCosmetics:Freund".getBytes(StandardCharsets.UTF_8));
		t.run(mc -> {
			Entity friend = mc.level.getEntity(-4500);
			if (friend != null) friend.snapTo(mc.player.getX() + 8, mc.player.getY(), mc.player.getZ() + 8, 180f, 0f);
		});

		List<CosmeticInfo> catalog = cosmetics.catalog();
		check(t, "API: catalog() mit 15 Cosmetics", catalog.size() == 15);
		check(t, "API: Engelsflügel im Slot BACK", catalog.stream().anyMatch(c -> c.id().equals("engelsfluegel") && c.slot() == dev.heldixclient.api.Cosmetics.Slot.BACK
				&& c.name().equals("Engelsflügel") && !c.teamOnly()));
		check(t, "API: Team-Krone teamOnly", catalog.stream().anyMatch(c -> c.id().equals("team-krone") && c.teamOnly()));
		Map<dev.heldixclient.api.Cosmetics.Slot, String> mine = cosmetics.mine();
		check(t, "API: mine() (" + mine + ")", "krone".equals(mine.get(dev.heldixclient.api.Cosmetics.Slot.HEAD))
				&& "engelsfluegel".equals(mine.get(dev.heldixclient.api.Cosmetics.Slot.BACK)) && "heldix".equals(mine.get(dev.heldixclient.api.Cosmetics.Slot.CAPE)));
		check(t, "API: worn() für dich und andere", cosmetics.worn(own, dev.heldixclient.api.Cosmetics.Slot.HEAD).orElse("").equals("krone")
				&& cosmetics.worn(other, dev.heldixclient.api.Cosmetics.Slot.BACK).orElse("").equals("drachenfluegel")
				&& cosmetics.worn(other, dev.heldixclient.api.Cosmetics.Slot.CAPE).orElse("").equals("pixelregen")
				&& cosmetics.worn(UUID.randomUUID(), dev.heldixclient.api.Cosmetics.Slot.HEAD).isEmpty());

		// Vorschau: nur lokal, endet mit cancel() und nach der Dauer
		Registration preview = cosmetics.preview(dev.heldixclient.api.Cosmetics.Slot.HEAD, "partyhut", Duration.ofSeconds(30));
		check(t, "API: preview() zeigt den Partyhut lokal", "partyhut".equals(t.compute(mc -> Cosmetics.own("head"))) && "krone".equals(t.compute(mc -> Cosmetics.mine("head")))
				&& preview.isActive());
		t.run(mc -> {
			mc.options.setCameraType(CameraType.THIRD_PERSON_FRONT);
			face(mc, 0f);
			mc.player.setXRot(0f);
			mc.player.xRotO = 0f;
		});
		t.waitTicks(10);
		t.screenshot("heldix-44-cosmetics-api-vorschau");
		JsonObject service = request("GET", "/v1/me/cosmetics", null, token(t));
		check(t, "API: Vorschau ändert nichts beim Dienst", "krone".equals(service.get("head").getAsString()));
		preview.cancel();
		check(t, "API: cancel() beendet die Vorschau", "krone".equals(t.compute(mc -> Cosmetics.own("head"))) && !preview.isActive());
		Registration shortPreview = cosmetics.preview(dev.heldixclient.api.Cosmetics.Slot.COMPANION, "gluehwuermchen-geist", Duration.ofMillis(400));
		t.waitTicks(20);
		check(t, "API: Vorschau endet nach der Dauer", !shortPreview.isActive() && "mini-drache".equals(t.compute(mc -> Cosmetics.own("companion"))));
		check(t, "API: preview() mit unbekanntem Cosmetic wirft", throwsIllegal(() -> cosmetics.preview(dev.heldixclient.api.Cosmetics.Slot.HEAD, "engelsfluegel", Duration.ofSeconds(1))));
		check(t, "API: preview() eines Capes", cosmetics.preview(dev.heldixclient.api.Cosmetics.Slot.CAPE, "pixelregen", Duration.ofSeconds(5)).isActive());
		t.waitSoft(mc -> mc.player.getSkin().cape() != null && mc.player.getSkin().cape().texturePath().getPath().contains("cape/katalog/pixelregen/"), 10);
		check(t, "API: Cape-Vorschau am eigenen Spieler", t.compute(mc -> mc.player.getSkin().cape() != null
				&& mc.player.getSkin().cape().texturePath().getPath().contains("cape/katalog/pixelregen/")));
		t.run(mc -> Cosmetics.clearLocal());

		// Effekte: Flügel schneller, Partikel-Schwall (höchstens 64)
		double before = probe(t, own).flapFactor();
		cosmetics.animate(dev.heldixclient.api.Cosmetics.Slot.BACK, "flap");
		t.waitTicks(10);
		double during = probe(t, own).flapFactor();
		check(t, "API: animate(BACK, flap) – Flügel schlagen schneller (" + round(before) + " → " + round(during) + ")", during > 1.5 && during > before + 0.3);
		for (int i = 0; i < 12; i++) {
			cosmetics.animate(dev.heldixclient.api.Cosmetics.Slot.AURA, "burst");
			t.waitTicks(1);
		}
		int particles = probe(t, own).particles();
		check(t, "API: animate(AURA, burst) – höchstens 64 Partikel (" + particles + ")", particles > 16 && particles <= CosmeticRenderer.MAX_PARTICLES);
		cosmetics.animate(dev.heldixclient.api.Cosmetics.Slot.HEAD, "spin");
		t.waitTicks(10);
		t.screenshot("heldix-44b-cosmetics-api-effekt");
		check(t, "API: Effekt, den es für den Slot nicht gibt, wirft", throwsIllegal(() -> cosmetics.animate(dev.heldixclient.api.Cosmetics.Slot.HEAD, "burst"))
				&& throwsIllegal(() -> cosmetics.animate(dev.heldixclient.api.Cosmetics.Slot.BACK, "tanzen")));

		// onChange: eigene Auswahl ändert sich (im Haupt-Thread gemeldet)
		List<CosmeticChange> changes = new CopyOnWriteArrayList<>();
		List<Boolean> mainThread = new CopyOnWriteArrayList<>();
		Registration listener = cosmetics.onChange(change -> {
			changes.add(change);
			mainThread.add(Minecraft.getInstance().isSameThread());
		});
		t.compute(mc -> Cosmetics.choose("head", "zylinder")).get(10, java.util.concurrent.TimeUnit.SECONDS);
		t.waitSoft(mc -> !changes.isEmpty(), 5);
		check(t, "API: onChange meldet krone → zylinder", changes.size() == 1 && changes.getFirst().slot() == dev.heldixclient.api.Cosmetics.Slot.HEAD
				&& changes.getFirst().previous().orElse("").equals("krone") && changes.getFirst().current().orElse("").equals("zylinder") && mainThread.getFirst());
		listener.cancel();
		t.compute(mc -> Cosmetics.choose("head", "krone")).get(10, java.util.concurrent.TimeUnit.SECONDS);
		t.waitTicks(5);
		check(t, "API: nach cancel() keine Meldungen mehr", changes.size() == 1 && !listener.isActive());
	}

	// ======================================================================================
	// Leistung: 20 Spieler mit allen Cosmetics
	// ======================================================================================

	private static void performance(TestContext t, List<RemotePlayer> remotes) {
		String[] heads = {"krone", "zylinder", "heiligenschein", "partyhut"};
		String[] backs = {"engelsfluegel", "drachenfluegel", "schwert-ruecken"};
		String[] auras = {"funken", "herzen", "blaetter"};
		String[] companions = {"mini-drache", "gluehwuermchen-geist"};
		t.run(mc -> {
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			face(mc, 0f);
			mc.player.setXRot(10f);
			for (int i = 0; i < 20; i++) {
				UUID uuid = UUID.nameUUIDFromBytes(("HeldixCosmetics:Menge" + i).getBytes(StandardCharsets.UTF_8));
				Social.testLookup(uuid, lookup(i % 2 == 0 ? "pixelregen" : "glut", heads[i % 4], backs[i % 3], auras[i % 3], companions[i % 2]));
				RemotePlayer remote = new RemotePlayer(mc.level, new GameProfile(uuid, "Menge" + i));
				remote.setId(-4600 - i);
				showAllParts(remote);
				double x = mc.player.getX() + (i % 5 - 2) * 1.8;
				double z = mc.player.getZ() + 5 + (i / 5) * 2.2;
				float yaw = 150f + (i * 23) % 60;
				remote.snapTo(x, mc.player.getY(), z, yaw, 0f);
				remote.yBodyRot = yaw;
				remote.yHeadRot = yaw;
				mc.level.addEntity(remote);
				remotes.add(remote);
			}
		});
		t.waitTicks(40);
		t.screenshot("heldix-45-cosmetics-20-spieler");
		AtomicLong frames = new AtomicLong();
		HudEvents.RENDER.register((g, delta) -> frames.incrementAndGet());
		long[] with = measure(t, frames);
		t.run(mc -> HeldixConfig.get().cosmeticsOthers = false);
		long[] without = measure(t, frames);
		t.run(mc -> HeldixConfig.get().cosmeticsOthers = true);
		double perFrame = with[1] / 1000.0 / Math.max(1, with[0]);
		double perFrameEmit = with[2] / 1000.0 / Math.max(1, with[0]);
		double vertices = (double) with[3] / Math.max(1, with[0]);
		t.log(String.format(java.util.Locale.ROOT, "Leistung mit 20 Spielern: %d Bilder in 3 s mit Cosmetics, %d ohne; je Bild %.1f µs Einreichen + %.1f µs Vertices (%.0f Vertices)",
				with[0], without[0], perFrame, perFrameEmit, vertices));
		check(t, "Cosmetics: 20 Spieler kosten weniger als 1,5 ms je Bild (" + Math.round(perFrame + perFrameEmit) + " µs)", perFrame + perFrameEmit < 1500);
	}

	/** {Bilder, Nanosekunden Einreichen, Nanosekunden Vertices, Vertices} in drei Sekunden */
	private static long[] measure(TestContext t, AtomicLong frames) {
		t.waitTicks(10);
		t.run(mc -> {
			CosmeticRenderer.submitNanos = 0;
			CosmeticRenderer.emitNanos = 0;
			CosmeticRenderer.emittedVertices = 0;
		});
		long start = frames.get();
		t.waitTicks(60);
		long count = frames.get() - start;
		return t.compute(mc -> new long[] {count, CosmeticRenderer.submitNanos, CosmeticRenderer.emitNanos, CosmeticRenderer.emittedVertices});
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	/** Hautschichten und Cape zeigen (Spieler nur auf dem Client haben sonst alle Teile aus) */
	private static void showAllParts(RemotePlayer remote) {
		try {
			java.lang.reflect.Field field = net.minecraft.world.entity.Avatar.class.getDeclaredField("DATA_PLAYER_MODE_CUSTOMISATION");
			field.setAccessible(true);
			@SuppressWarnings("unchecked")
			net.minecraft.network.syncher.EntityDataAccessor<Byte> accessor = (net.minecraft.network.syncher.EntityDataAccessor<Byte>) field.get(null);
			remote.getEntityData().set(accessor, (byte) 0x7F);
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException("Modellteile nicht einstellbar", e);
		}
	}

	private static void face(Minecraft mc, float yaw) {
		mc.player.setYRot(yaw);
		mc.player.yRotO = yaw;
		mc.player.setYBodyRot(yaw);
		mc.player.yBodyRotO = yaw;
		mc.player.setYHeadRot(yaw);
		mc.player.yHeadRotO = yaw;
		mc.player.setXRot(0f);
		mc.player.xRotO = 0f;
	}

	private static CosmeticRenderer.Probe probe(TestContext t, UUID uuid) {
		return probe(t, uuid, 3);
	}

	private static CosmeticRenderer.Probe probe(TestContext t, UUID uuid, int waitTicks) {
		t.waitTicks(waitTicks);
		CosmeticRenderer.Probe probe = t.compute(mc -> CosmeticRenderer.probe(uuid));
		if (probe == null) throw new AssertionError("Keine Messwerte für " + uuid + " (nie gezeichnet)");
		return probe;
	}

	/** Wird das Cosmetic im Slot gerade in der Welt gezeichnet? (Zeitstempel ändert sich über einige Bilder) */
	private static boolean rendering(TestContext t, UUID uuid, String slot) {
		t.waitTicks(4);
		long first = frame(t.compute(mc -> CosmeticRenderer.probe(uuid)), slot);
		t.waitTicks(6);
		long second = frame(t.compute(mc -> CosmeticRenderer.probe(uuid)), slot);
		return second > first;
	}

	private static long frame(CosmeticRenderer.Probe probe, String slot) {
		if (probe == null) return 0;
		return switch (slot) {
			case "head" -> probe.headFrame();
			case "back" -> probe.backFrame();
			case "companion" -> probe.companionFrame();
			default -> probe.auraFrame();
		};
	}

	private static boolean near(double[] p, double x, double y, double z, double tolerance) {
		return distance(p, x, y, z) <= tolerance;
	}

	private static double distance(double[] p, double x, double y, double z) {
		return Math.sqrt((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) + (p[2] - z) * (p[2] - z));
	}

	private static String fmt(double[] p) {
		return String.format(java.util.Locale.ROOT, "(%.3f, %.3f, %.3f)", p[0], p[1], p[2]);
	}

	private static double round(double v) {
		return Math.round(v * 100) / 100.0;
	}

	private static boolean throwsIllegal(Runnable action) {
		try {
			action.run();
			return false;
		} catch (IllegalArgumentException e) {
			return true;
		}
	}

	private static String tokenCache;

	/** Anmeldung beim Dienst als derselbe Spieler (Entwicklungsmodus), um die gespeicherte Auswahl zu prüfen */
	private static String token(TestContext t) {
		if (tokenCache != null) return tokenCache;
		try {
			JsonObject login = new JsonObject();
			String name = t.compute(mc -> mc.getUser().getName());
			login.addProperty("name", name);
			login.addProperty("uuid", Social.compact(t.compute(mc -> mc.getUser().getProfileId())));
			tokenCache = request("POST", "/v1/auth/dev", login, null).get("token").getAsString();
			return tokenCache;
		} catch (Exception e) {
			throw new IllegalStateException("Anmeldung beim Dienst fehlgeschlagen", e);
		}
	}

	private static JsonObject request(String method, String path, JsonObject body, String token) {
		try {
			HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(Social.baseUrl() + path)).timeout(Duration.ofSeconds(10))
					.header("Content-Type", "application/json")
					.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
			if (token != null) request.header("Authorization", "Bearer " + token);
			HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
			if (response.statusCode() >= 400) throw new IllegalStateException(method + " " + path + ": " + response.statusCode() + " " + response.body());
			return response.body().isBlank() ? new JsonObject() : JsonParser.parseString(response.body()).getAsJsonObject();
		} catch (IllegalStateException e) {
			throw e;
		} catch (Exception e) {
			throw new IllegalStateException(method + " " + path + " fehlgeschlagen", e);
		}
	}
}
