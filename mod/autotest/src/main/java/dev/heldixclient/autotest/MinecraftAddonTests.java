package dev.heldixclient.autotest;

import com.google.gson.JsonParser;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.AddonStore;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.AddonManifest;
import dev.heldixclient.loader.api.LoaderAddon;
import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.Minecraft;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Addons und Mods als ein System (Manifest Version 2): Addons mit Zugriff auf Minecraft aus mod/test-addons/minecraft.
 * Manifest-Regeln, Laden durch den Heldix Loader (Transformer, clientEntrypoint, derselbe Classloader für den
 * entrypoint), falsche Version, abgeschaltete Datei, Fabric ohne unterstütztes Ziel, alte Heldix-Mods, die Seite
 * „Mods &amp; Addons“ und an/aus im Spiel.
 */
final class MinecraftAddonTests {
	static final String TEST = "mctest";
	static final String NUR_HELDIX = "mcnurheldix";
	static final String DEFEKT = "mcdefekt";
	static final String FALSCH = "mcfalsch";
	static final String AUS = "mcaus";
	/** Name des Addons, dessen Transformer absichtlich scheitert (seine Meldung ist kein Fehler von HeldixClient) */
	static final String DEFEKT_NAME = "Defektes Minecraft-Test-Addon";
	private static final String HOOKS = "dev.heldixclient.testaddons.minecraft.TestHooks";

	private MinecraftAddonTests() {
	}

	/** Gehört eine Meldung aus HeldixLoader.problems() zu einem der absichtlich kaputten Test-Addons? */
	static boolean expectedProblem(String problem) {
		return problem.startsWith("Addon " + DEFEKT_NAME + ":");
	}

	// ======================================================================================
	// Manifest Version 2 (direkt am Parser, gleiche Regeln für Loader und HeldixClient)
	// ======================================================================================

	static void manifests(TestContext t) {
		AddonManifest v1 = AddonManifest.parse("{\"id\":\"alt\",\"version\":\"1.0.0\",\"entrypoint\":\"de.du.Alt\",\"api\":3}");
		t.check("Manifest v1 bleibt gültig, Zugriff api", v1.problems().isEmpty() && "api".equals(v1.access()) && !v1.minecraftAccess());
		AddonManifest start = AddonManifest.parse("{\"id\":\"start\",\"clientEntrypoint\":\"de.du.Start\",\"minecraft\":[\"26.3\"]}");
		t.check("Manifest v2: nur clientEntrypoint, Zugriff minecraft, entrypoint optional",
				start.problems().isEmpty() && "minecraft".equals(start.access()) && start.entrypoint() == null && "de.du.Start".equals(start.clientEntrypoint()));
		AddonManifest text = AddonManifest.parse("{\"id\":\"text\",\"transformers\":[\"de.du.T\"],\"minecraft\":\"26.3\",\"loader\":\">=2.4.0\"}");
		t.check("Manifest v2: minecraft als einzelner Text, loader", text.problems().isEmpty() && text.minecraft().equals(List.of("26.3"))
				&& ">=2.4.0".equals(text.loader()) && text.transformers().equals(List.of("de.du.T")));
		problem(t, "{\"id\":\"ohne\",\"transformers\":[\"de.du.T\"]}", "„minecraft“ fehlt");
		problem(t, "{\"id\":\"leer\",\"version\":\"1.0.0\"}", "Kein Einstiegspunkt");
		problem(t, "{\"id\":\"typ\",\"transformers\":\"de.du.T\",\"minecraft\":[\"26.3\"]}", "„transformers“ muss eine Liste sein");
		problem(t, "{\"id\":\"klasse\",\"clientEntrypoint\":\"de du.Start\",\"minecraft\":[\"26.3\"]}", "ist kein gültiger Klassenname");
		problem(t, "{\"id\":\"api\",\"entrypoint\":\"de.du.A\",\"api\":\"vier\"}", "„api“ muss eine Zahl sein");
		problem(t, "{\"id\":\"l1\",\"entrypoint\":\"de.du.A\",\"api\":4,\"loaders\":[\"heldix\",\"quilt\"]}", "„loaders“ darf nur „heldix“ und „fabric“ enthalten");
		problem(t, "{\"id\":\"l2\",\"entrypoint\":\"de.du.A\",\"api\":4,\"loaders\":[]}", "„loaders“ darf nicht leer sein");
		problem(t, "{\"id\":\"l3\",\"entrypoint\":\"de.du.A\",\"api\":4,\"loaders\":[\"heldix\",\"heldix\"]}", "doppelt");
		problem(t, "{kaputt", "kein gültiges JSON");
		String json = "{\"id\":\"gleich\",\"transformers\":[\"de.du.T\"]}";
		t.check("HeldixClient prüft mit denselben Regeln wie der Loader", AddonManager.manifestProblems(json).equals(AddonManifest.parse(json).problems()));

		// Versionen: genau oder Regel wie in heldix.mod.json, Snapshots nur genau, leer = jede
		t.check("Minecraft 26.3 passt zu [26.3], 26.3.1 nicht", AddonManifest.minecraftMatches(List.of("26.3"), "26.3") && !AddonManifest.minecraftMatches(List.of("26.3"), "26.3.1"));
		t.check("Minecraft-Regeln 26.x, >=26.2, 26.2 || 26.3, *, leer", AddonManifest.minecraftMatches(List.of("26.x"), "26.3")
				&& AddonManifest.minecraftMatches(List.of(">=26.2"), "26.3") && AddonManifest.minecraftMatches(List.of("26.2 || 26.3"), "26.3")
				&& AddonManifest.minecraftMatches(List.of("*"), "26.3") && AddonManifest.minecraftMatches(List.of(), "26.3")
				&& !AddonManifest.minecraftMatches(List.of("26.2"), "26.3"));
		t.check("Snapshots passen nur genau", !AddonManifest.minecraftMatches(List.of(">=26.1"), "26w14a") && AddonManifest.minecraftMatches(List.of("26w14a"), "26w14a"));
		AddonManifest two = AddonManifest.parse("{\"id\":\"zwei\",\"clientEntrypoint\":\"de.du.S\",\"minecraft\":[\"26.1\",\"26.2\"],\"loader\":\">=9.0.0\",\"loaders\":[\"heldix\"]}");
		t.check("Grund „" + two.minecraftProblem("26.3") + "“", "Nur für Minecraft 26.1 und 26.2".equals(two.minecraftProblem("26.3")));
		t.check("Grund „" + two.loaderProblem("2.4.0") + "“", "Braucht Heldix Loader 9.0.0 oder neuer".equals(two.loaderProblem("2.4.0")));
		t.check("Grund „" + two.platformProblem("fabric") + "“", "Läuft nur in Heldix-Instanzen".equals(two.platformProblem("fabric")) && two.platformProblem("heldix") == null);
		t.check("loaders [fabric] in einer Heldix-Instanz: „Läuft nur in Fabric-Instanzen“",
				"Läuft nur in Fabric-Instanzen".equals(AddonManifest.platformProblem(List.of("fabric"), "heldix")));

		// Store-Manifest (signiert): alte ohne Felder gelten als api, jede Version, beide Loader
		AddonStore.Compatibility old = AddonStore.Compatibility.of(JsonParser.parseString("{\"api\":3}").getAsJsonObject());
		t.check("Altes Store-Manifest: api, jede Minecraft-Version, Heldix und Fabric",
				"api".equals(old.access()) && old.minecraft().isEmpty() && old.loaders().equals(List.of("heldix", "fabric")));
		AddonStore.Compatibility mc = AddonStore.Compatibility.of(JsonParser.parseString("{\"access\":\"minecraft\",\"minecraft\":[\"26.3\"]}").getAsJsonObject());
		t.check("Store-Manifest mit Zugriff minecraft ohne loaders: nur Heldix", mc.loaders().equals(List.of("heldix")) && mc.minecraft().equals(List.of("26.3")));
		boolean rejected;
		try {
			AddonStore.Compatibility.of(JsonParser.parseString("{\"access\":\"minecraft\",\"minecraft\":[\">=26.2\"]}").getAsJsonObject());
			rejected = false;
		} catch (IllegalArgumentException expected) {
			rejected = true;
		}
		t.check("Store-Manifest: Regeln wie >=26.2 sind dort ungültig", rejected);
		t.check("Store: Reihenfolge API → Minecraft → Loader", "Braucht einen neueren HeldixClient".equals(entry(99, "minecraft", List.of("26.2"), List.of("heldix")).problem("26.3", "heldix"))
				&& "Nur für Minecraft 26.2".equals(entry(4, "minecraft", List.of("26.2"), List.of("heldix")).problem("26.3", "fabric"))
				&& "Läuft nur in Heldix-Instanzen".equals(entry(4, "minecraft", List.of("26.3"), List.of("heldix")).problem("26.3", "fabric"))
				&& entry(4, "minecraft", List.of("26.3"), List.of("heldix", "fabric")).problem("26.3", "fabric") == null
				&& entry(4, "api", List.of(), List.of("heldix", "fabric")).problem("26.3", "heldix") == null);
	}

	private static void problem(TestContext t, String json, String expected) {
		List<String> problems = AddonManifest.parse(json).problems();
		t.check("Manifest-Fehler „" + expected + "“ (" + problems + ")", problems.stream().anyMatch(p -> p.contains(expected)));
	}

	private static AddonStore.Entry entry(int api, String access, List<String> minecraft, List<String> loaders) {
		return new AddonStore.Entry("test", "Test", "1.0.0", "Test", "", List.of("HeldixClient"), api, "addons", "sonstiges", List.of(),
				"heldix-addon-test-1.0.0.jar", 1, "0".repeat(64), "", List.of(), 0, true, null, 0, 0, access, minecraft, loaders);
	}

	// ======================================================================================
	// Beim Start geladen
	// ======================================================================================

	static void startup(TestContext t, boolean fabric) throws Exception {
		t.log("Addons des Loaders: " + HeldixLoader.addons().stream().map(a -> a.id() + (a.loaded() ? " geladen" : " aus") + " (" + a.problems().size() + " Probleme)").toList());
		LoaderAddon test = HeldixLoader.addon(TEST).orElseThrow(() -> new AssertionError("Minecraft-Test-Addon fehlt beim Loader"));
		t.check("Loader hat das Minecraft-Test-Addon geladen (" + test.problems() + ")", test.loaded() && test.active() && test.started());
		ClassLoader loader = test.classLoader();
		ClassLoader game = Minecraft.class.getClassLoader();
		t.check("Addon liegt im Classloader des Spiels (" + loader + ")", loader == game);
		Class<?> hooks = Class.forName(HOOKS, false, loader);
		int ticks = ((AtomicInteger) hooks.getField("TICKS").get(null)).get();
		t.check("Transformer wirkt: Minecraft.tick() ruft das Addon (" + ticks + " mal)", ticks > 20);
		t.check("clientEntrypoint lief beim Start", hooks.getField("started").getBoolean(null));
		t.check("entrypoint (Heldix-API) lief nach dem clientEntrypoint", hooks.getField("enabled").getBoolean(null) && hooks.getField("enabledAfterStart").getBoolean(null));
		Object startLoader = hooks.getField("startLoader").get(null);
		Object addonLoader = hooks.getField("addonLoader").get(null);
		t.check("Derselbe Classloader für Loader, clientEntrypoint und entrypoint", startLoader == loader && addonLoader == loader);
		LoadedAddon card = addon(t, TEST);
		t.check("HeldixClient: Minecraft-Test-Addon aktiv mit Zugriff auf Minecraft (" + card.state() + ", " + card.error() + ")",
				card.isActive() && card.minecraftAccess() && card.loaderAddon() == test);
		t.check("HeldixClient lädt den entrypoint über den Classloader des Loaders (keine doppelten Klassen)",
				card.classLoader() == loader && card.instance() != null && card.instance().getClass().getClassLoader() == loader
						&& Class.forName(HOOKS, false, game) == hooks);

		// falsche Minecraft-Version: nicht geladen, Grund beim Loader und im Menü
		LoaderAddon wrong = HeldixLoader.addon(FALSCH).orElseThrow(() -> new AssertionError("Falsche-Version-Test-Addon fehlt beim Loader"));
		t.check("Falsche Minecraft-Version: nicht geladen (" + wrong.problem() + ")", !wrong.loaded() && "Nur für Minecraft 1.0 und 1.1".equals(wrong.problem()));
		t.check("Falsche Minecraft-Version steht in HeldixLoader.problems()",
				HeldixLoader.problems().contains("Addon Falsche-Version-Test-Addon: Nur für Minecraft 1.0 und 1.1"));
		LoadedAddon wrongCard = addon(t, FALSCH);
		t.check("Falsche Minecraft-Version im Menü als Fehler (" + wrongCard.error() + ")",
				wrongCard.state() == LoadedAddon.State.FAILED && "Nur für Minecraft 1.0 und 1.1".equals(wrongCard.error()));

		// abgeschaltete Datei (.jar.disabled): der Loader fasst sie nicht an, HeldixClient zeigt sie als ausgeschaltet
		t.check("Abgeschaltete JAR übersprungen (kein Eintrag beim Loader, keine Meldung)", HeldixLoader.addon(AUS).isEmpty()
				&& HeldixLoader.problems().stream().noneMatch(p -> p.contains("Ausgeschaltetes Test-Addon")));
		LoadedAddon off = addon(t, AUS);
		t.check("Abgeschaltete JAR im Menü als ausgeschaltet", off.state() == LoadedAddon.State.DISABLED && !off.switchedOn() && !off.restartNeeded());

		// Transformer scheitert: Addon läuft, das Problem steht beim Addon und in HeldixLoader.problems()
		LoaderAddon broken = HeldixLoader.addon(DEFEKT).orElseThrow(() -> new AssertionError("Defektes Test-Addon fehlt beim Loader"));
		t.check("Gescheiterter Transformer: Problem am Addon (" + broken.problems().size() + ")", broken.active()
				&& broken.problems().stream().anyMatch(p -> p.startsWith("net.minecraft.client.Minecraft konnte nicht verändert werden")));
		t.check("Gescheiterter Transformer steht in HeldixLoader.problems()", HeldixLoader.problems().stream().anyMatch(MinecraftAddonTests::expectedProblem));
		LoadedAddon brokenCard = addon(t, DEFEKT);
		t.check("Gescheiterter Transformer im Menü als Problem", brokenCard.isActive() && !brokenCard.loaderProblems().isEmpty() && brokenCard.instance() == null);

		// Ziel, das die Fabric-Brücke nicht verändern kann
		LoaderAddon only = HeldixLoader.addon(NUR_HELDIX).orElseThrow(() -> new AssertionError("Nur-Heldix-Test-Addon fehlt beim Loader"));
		LoadedAddon onlyCard = addon(t, NUR_HELDIX);
		Class<?> inventory = Class.forName("net.minecraft.client.gui.screens.inventory.InventoryScreen", false, game);
		boolean field = java.util.Arrays.stream(inventory.getDeclaredFields()).anyMatch(f -> f.getName().equals("HELDIX_NUR_HELDIX"));
		if (fabric) {
			t.check("Fabric: Addon mit nicht unterstütztem Ziel nicht geladen (" + only.problem() + ")", !only.loaded() && only.heldixOnly()
					&& only.problem() != null && only.problem().startsWith("Läuft nur in Heldix-Instanzen"));
			t.check("Fabric: Grund im Menü „Läuft nur in Heldix-Instanzen“", onlyCard.state() == LoadedAddon.State.FAILED
					&& onlyCard.error() != null && onlyCard.error().startsWith("Läuft nur in Heldix-Instanzen"));
			boolean onClasspath;
			try {
				Class.forName("dev.heldixclient.testaddons.nurheldix.InventoryTransformer", false, game);
				onClasspath = true;
			} catch (ClassNotFoundException expected) {
				onClasspath = false;
			}
			t.check("Fabric: seine Klassen liegen nicht auf dem Classpath, InventoryScreen unverändert", !onClasspath && !field);
		} else {
			t.check("Heldix: Addon ohne entrypoint geladen und gestartet (" + only.problems() + ")", only.active() && only.started()
					&& Class.forName("dev.heldixclient.testaddons.nurheldix.NurHeldixStart", false, game).getField("started").getBoolean(null));
			t.check("Heldix: sein Transformer hat InventoryScreen verändert", field);
			t.check("Heldix: im Menü aktiv ohne Heldix-API", onlyCard.isActive() && onlyCard.instance() == null && onlyCard.minecraftAccess());
		}

		// alte Heldix-Mods (heldix.mod.json in mods/) laufen weiter; Fabric-Mods nur in Fabric, ohne Heldix-Mods
		List<String> platform = HeldixLoader.platformMods().stream().map(ModInfo::id).toList();
		t.log("Fabric-Mods: " + platform);
		if (fabric) {
			t.check("Fabric-Mods der Instanz bekannt (" + platform.size() + "), ohne Heldix-Mods und Heldix Loader",
					platform.contains("fabric-api") && !platform.contains("heldixclient") && !platform.contains("heldix-autotest") && !platform.contains("heldixloader"));
		} else {
			t.check("Heldix-Instanz: keine Fabric-Mods", platform.isEmpty());
		}
	}

	// ======================================================================================
	// Heldix-Menü → Mods & Addons
	// ======================================================================================

	static void menu(TestContext t, boolean fabric) {
		t.check("Kategorie heißt „Mods & Addons“ mit den Reitern Installiert und Store", "Mods & Addons".equals(Shell.Page.ADDONS.title())
				&& "Installiert".equals(Shell.Page.ADDONS.label) && "Store".equals(Shell.Page.STORE.label) && "Mods & Addons".equals(Shell.Page.STORE.title()));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.ADDONS));
		t.waitTicks(5);
		t.check("Seite Mods & Addons offen", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu && "ADDONS".equals(menu.currentTab())
				&& "Mods & Addons".equals(menu.getTitle().getString())));
		List<String> rows = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows());
		t.log("Zeilen: " + rows);
		t.check("Installiert: Addons mit und ohne Zugriff auf Minecraft, abgeschaltete und fehlerhafte", rows.contains("Section:Installiert")
				&& rows.containsAll(List.of("Addon:" + TEST, "Addon:" + AUS, "Addon:" + FALSCH, "Addon:" + DEFEKT, "Addon:" + NUR_HELDIX, "Addon:uhrzeit", "Addon:kaputt")));
		t.check("Installiert: alte Heldix-Mod (Autotest) als Eintrag, HeldixClient selbst nicht", rows.contains("Mod:heldix-autotest") && !rows.contains("Mod:heldixclient"));
		t.check(fabric ? "Fabric: Abschnitt Fabric-Mods (nur Info)" : "Heldix: kein Abschnitt Fabric-Mods", rows.contains("Section:Fabric-Mods") == fabric);
		t.moveMouse(5, 5);
		t.waitTicks(3);
		t.screenshot("heldix-mods-addons-1-installiert");
		t.check("Schalter für Addons gezeichnet", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).addonSwitchCenter(rows.stream()
				.filter(r -> r.startsWith("Addon:")).findFirst().orElseThrow().substring(6)) != null));
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToAddon(TEST));
		t.waitTicks(3);
		t.screenshot("heldix-mods-addons-2-minecraft");
		t.check("Item Physics zeigt sein eigenes Icon (cube) statt des Puzzleteils", "cube".equals(t.compute(mc -> addonOf("itemphysics").icon())));
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToAddon("itemphysics"));
		t.waitTicks(3);
		t.screenshot("heldix-mods-addons-3-item-physics");
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToEnd());
		t.waitTicks(3);
		t.screenshot("heldix-mods-addons-4-mods");
		AutoTest.openPage(t, "STORE");
		t.check("Reiter Store gehört zu Mods & Addons", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabIds()).equals(List.of("ADDONS", "STORE")));
		t.waitTicks(3);
		t.screenshot("heldix-mods-addons-5-store");
	}

	// ======================================================================================
	// An/aus im Spiel (am Ende des Tests: das Uhrzeit-Addon bleibt danach bis zum Spielende aus)
	// ======================================================================================

	static void toggles(TestContext t) throws Exception {
		Path dir = t.compute(mc -> AddonManager.addonDirectory());
		LoadedAddon off = addon(t, AUS);
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.ADDONS));
		t.waitTicks(3);
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToAddon(AUS));
		t.waitTicks(3);
		int[] center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).addonSwitchCenter(AUS));
		t.check("Schalter des abgeschalteten Addons zu sehen", center != null);
		t.click(center[0], center[1]);
		t.waitTicks(3);
		t.check("Einschalten per Klick: Datei wieder .jar, „Wirkt nach dem Neustart“", Files.exists(dir.resolve("heldix-addon-mcaus.jar"))
				&& !Files.exists(dir.resolve("heldix-addon-mcaus.jar.disabled")) && t.compute(mc -> off.switchedOn() && off.restartNeeded()
				&& off.state() == LoadedAddon.State.DISABLED));
		List<String> rows = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeRows());
		t.check("Hinweis „wirkt nach dem Neustart“ oben auf der Seite", rows.stream().anyMatch(r -> r.startsWith("Notice:") && r.contains("Ausgeschaltetes Test-Addon")
				&& r.contains("wirkt nach dem Neustart")));
		t.moveMouse(5, 5);
		t.screenshot("heldix-mods-addons-6-neustart");
		// der Hinweis oben schiebt die Karten nach unten: Schalter neu suchen
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToAddon(AUS));
		t.waitTicks(3);
		center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).addonSwitchCenter(AUS));
		t.check("Schalter nach dem Umschalten wieder zu sehen", center != null);
		t.click(center[0], center[1]);
		t.waitTicks(3);
		t.check("Wieder aus: .jar.disabled, kein Neustart nötig", Files.exists(dir.resolve("heldix-addon-mcaus.jar.disabled"))
				&& !Files.exists(dir.resolve("heldix-addon-mcaus.jar")) && t.compute(mc -> !off.switchedOn() && !off.restartNeeded()));

		// Addon mit Zugriff auf Minecraft: aus heißt „nach dem Neustart“, bis dahin läuft es weiter
		LoadedAddon test = addon(t, TEST);
		Class<?> hooks = Class.forName(HOOKS, false, test.classLoader());
		AtomicInteger ticks = (AtomicInteger) hooks.getField("TICKS").get(null);
		t.check("Minecraft-Addon ausschalten geht", t.compute(mc -> AddonManager.setEnabled(test, false)));
		int before = ticks.get();
		t.waitTicks(5);
		boolean onDisk = !Files.exists(dir.resolve(test.fileName())) || Files.readString(dir.resolve(".ausschalten")).lines().anyMatch(test.fileName()::equals);
		t.check("Minecraft-Addon aus: wirkt nach dem Neustart, läuft bis dahin weiter (" + before + " → " + ticks.get() + ")",
				t.compute(mc -> !test.switchedOn() && test.restartNeeded() && test.isActive()) && ticks.get() > before && onDisk);
		t.check("Minecraft-Addon wieder an: nichts vorgemerkt", t.compute(mc -> AddonManager.setEnabled(test, true) && test.switchedOn() && !test.restartNeeded())
				&& Files.exists(dir.resolve(test.fileName())) && !pendingContains(dir, test.fileName()));

		// reines API-Addon: aus wirkt sofort, an nach dem Neustart
		LoadedAddon clock = addon(t, "uhrzeit");
		t.check("API-Addon ausschalten wirkt sofort", t.compute(mc -> AddonManager.setEnabled(clock, false)
				&& clock.state() == LoadedAddon.State.DISABLED && !clock.restartNeeded()
				&& ModuleManager.all().stream().noneMatch(m -> "uhrzeit:uhrzeit".equals(m.id()))));
		t.check("API-Addon wieder einschalten: wirkt nach dem Neustart", t.compute(mc -> AddonManager.setEnabled(clock, true)
				&& clock.switchedOn() && clock.restartNeeded()) && Files.exists(dir.resolve(clock.fileName())) && !pendingContains(dir, clock.fileName()));
		t.waitTicks(3);
		// von oben: Hinweis auf den Neustart
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.ADDONS));
		t.moveMouse(5, 5);
		t.waitTicks(3);
		t.screenshot("heldix-mods-addons-7-umgeschaltet");
	}

	private static boolean pendingContains(Path dir, String name) throws java.io.IOException {
		Path pending = dir.resolve(".ausschalten");
		return Files.exists(pending) && Files.readString(pending).lines().anyMatch(name::equals);
	}

	private static LoadedAddon addonOf(String id) {
		return AddonManager.addons().stream().filter(a -> id.equals(a.id())).findFirst().orElseThrow(() -> new AssertionError("Addon " + id + " fehlt in der Liste"));
	}

	private static LoadedAddon addon(TestContext t, String id) {
		return t.compute(mc -> AddonManager.addons().stream().filter(a -> id.equals(a.id())).findFirst()
				.orElseThrow(() -> new AssertionError("Addon " + id + " fehlt in der Liste")));
	}
}
