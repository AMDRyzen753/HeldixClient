package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.cosmetic.Capes;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.HeldixModInitializer;
import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.loader.api.event.ChatEvents;
import dev.heldixclient.loader.api.event.ClientEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.render.DebugOverlay;
import dev.heldixclient.render.Performance;
import dev.heldixclient.render.ShaderEngine;
import dev.heldixclient.module.Setting;
import dev.heldixclient.render.ShaderPreset;
import dev.heldixclient.render.Shaders;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.HudEditorScreen;
import dev.heldixclient.screen.PauseMenuScreen;
import dev.heldixclient.screen.ServersScreen;
import dev.heldixclient.screen.StartCard;
import dev.heldixclient.screen.WorldsScreen;
import dev.heldixclient.ui.Shell;
import com.mojang.blaze3d.platform.NativeImage;
import net.minecraft.client.CameraType;
import net.minecraft.client.CloudStatus;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.client.gui.screens.worldselection.WorldCreationUiState;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.levelgen.presets.WorldPresets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Automatischer Test im echten Spiel (ersetzt den früheren Fabric-Gametest).
 * Aktiv nur mit {@code -Dheldix.autotest=true}; Ergebnis steht im Log
 * ("HELDIX-AUTOTEST: ERFOLGREICH" bzw. "FEHLGESCHLAGEN"), Bilder unter screenshots/.
 */
public final class AutoTest implements HeldixModInitializer {
	static final Logger LOG = LoggerFactory.getLogger("Heldix Autotest");

	private static volatile boolean joined;
	private static volatile boolean left;
	/** empfangene Chatnachrichten ("[System] …" bzw. "[Spieler] …"), auch für FeatureTests */
	static final List<String> CHAT = new CopyOnWriteArrayList<>();

	@Override
	public void onInitialize() {
		if (!Boolean.getBoolean("heldix.autotest")) {
			LOG.info("Heldix Autotest ist installiert, aber nicht aktiv (-Dheldix.autotest=true)");
			return;
		}
		TestContext test = new TestContext();
		boolean benchmark = Boolean.getBoolean("heldix.benchmark");
		if (benchmark) Benchmark.install();
		ClientEvents.TICK_END.register(minecraft -> test.tick());
		WorldEvents.JOIN.register(minecraft -> joined = true);
		WorldEvents.LEAVE.register(minecraft -> left = true);
		ChatEvents.RECEIVE.register((message, fromPlayer) -> CHAT.add((fromPlayer ? "[Spieler] " : "[System] ") + message.getString()));

		Thread thread = new Thread(() -> {
			try {
				if (benchmark) Benchmark.run(test);
				else scenario(test);
				LOG.info("HELDIX-AUTOTEST: ERFOLGREICH ({} Prüfungen)", test.checks());
			} catch (Throwable t) {
				LOG.error("HELDIX-AUTOTEST: FEHLGESCHLAGEN – {}", t.getMessage(), t);
			} finally {
				TestContext.sleep(1500); // Screenshots fertig schreiben lassen
				Minecraft.getInstance().execute(() -> Minecraft.getInstance().stop());
			}
		}, "Heldix-Autotest");
		thread.setDaemon(true);
		thread.start();
		LOG.info("Heldix Autotest gestartet");
	}

	private static void scenario(TestContext t) throws Exception {
		t.waitFor("Hauptmenü nach dem Laden", mc -> mc.gui.screen() instanceof TitleScreen && mc.gui.overlay() == null, 300);
		// Ohne Fokus (jemand arbeitet nebenher am PC) würde „Hintergrund-FPS“ die Bildrate senken; Prüfungen,
		// die auf ein gezeichnetes Bild warten (Zoom, Freelook, HUD-Größe), liefen dann ins Leere.
		t.run(mc -> HeldixConfig.get().backgroundFps = false);
		// Arbeitet jemand nebenher am PC, dreht eine echte Mausbewegung über dem Spielfenster sonst den Spieler und
		// verfälscht Prüfungen, die auf die Blickrichtung angewiesen sind (Wegpunkte, Cosmetics). Tests drehen selbst.
		t.run(mc -> mc.options.sensitivity().set(0.0));
		t.waitTicks(20);
		// Nur beim Entwickeln: HELDIX_AUTOTEST_ONLY=cosmetics führt nur die Cosmetics-Prüfungen in einer Testwelt aus
		if ("cosmetics".equals(System.getenv("HELDIX_AUTOTEST_ONLY"))) {
			createFlatWorld(t);
			CosmeticTests.run(t);
			t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
			t.waitFor("Welt verlassen", mc -> mc.level == null, 60);
			return;
		}
		// Nur beim Entwickeln: HELDIX_AUTOTEST_ONLY=konten führt nur die Prüfungen zum Kontowechsel aus (mit Testwelt)
		if ("konten".equals(System.getenv("HELDIX_AUTOTEST_ONLY"))) {
			AccountTests.titleScreen(t);
			createFlatWorld(t);
			AccountTests.leaveWorld(t);
			t.waitFor("Welt verlassen", mc -> mc.level == null && mc.gui.screen() instanceof TitleScreen, 60);
			AccountTests.end(t);
			return;
		}
		// Nur beim Entwickeln: HELDIX_AUTOTEST_ONLY=hosting führt nur die Prüfungen zu dauerhaften Welten, Entdecken und der
		// Heldix+-Warteliste in einer Testwelt aus (braucht --service, für den vollen Test --welt-port und eine Freischaltung)
		if ("hosting".equals(System.getenv("HELDIX_AUTOTEST_ONLY"))) {
			createFlatWorld(t);
			HostingTests.run(t);
			t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
			t.waitFor("Welt verlassen", mc -> mc.level == null, 60);
			return;
		}
		// Nur beim Entwickeln: HELDIX_AUTOTEST_ONLY=voice-moderation führt nur die Voice-Moderation in einer Testwelt aus
		// (braucht --service mit Dienst 1.13.0 im Entwicklungsmodus)
		if ("voice-moderation".equals(System.getenv("HELDIX_AUTOTEST_ONLY"))) {
			createFlatWorld(t);
			VoiceModerationTests.run(t);
			t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
			t.waitFor("Welt verlassen", mc -> mc.level == null, 60);
			return;
		}
		// Nur beim Entwickeln: HELDIX_AUTOTEST_ONLY=server führt nur die Prüfungen zur Server-Schnittstelle aus (Testwelt, danach mit
		// HELDIX_AUTOTEST_PAPER und HELDIX_AUTOTEST_PLUGIN ein echter Paper-Server mit dem Plugin „HeldixClient Server“)
		if ("server".equals(System.getenv("HELDIX_AUTOTEST_ONLY"))) {
			createFlatWorld(t);
			ServerLinkTests.inWorld(t);
			t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
			t.waitFor("Welt verlassen", mc -> mc.level == null, 60);
			ServerLinkTests.realServer(t);
			return;
		}
		// Nur beim Entwickeln: HELDIX_AUTOTEST_ONLY=hud führt nur die HUD-Prüfungen in einer Testwelt aus
		if ("hud".equals(System.getenv("HELDIX_AUTOTEST_ONLY"))) {
			createFlatWorld(t);
			t.run(mc -> ModuleManager.all().forEach(m -> m.setEnabled(true)));
			HudTests.run(t, "fabric".equals(HeldixLoader.platform()));
			t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
			t.waitFor("Welt verlassen", mc -> mc.level == null, 60);
			return;
		}
		t.log(t.compute(mc -> "Fenster " + mc.getWindow().getScreenWidth() + "x" + mc.getWindow().getScreenHeight()
				+ ", GUI " + mc.getWindow().getGuiScaledWidth() + "x" + mc.getWindow().getGuiScaledHeight()
				+ ", Skalierung " + mc.getWindow().getGuiScale()));

		// --- Heldix Loader ----------------------------------------------------------------
		List<String> mods = HeldixLoader.mods().stream().map(ModInfo::id).toList();
		List<String> problems = HeldixLoader.problems();
		boolean fabric = "fabric".equals(HeldixLoader.platform());
		// die absichtlich scheiternden Test-Addons nicht wörtlich ins Log (test:launch wertet Zeilen mit „konnte nicht verändert werden“ als Fehler)
		t.log("Plattform " + HeldixLoader.platform() + ", Mods " + mods + ", Probleme " + problems.stream().filter(p -> !MinecraftAddonTests.expectedProblem(p)).toList()
				+ " (+" + problems.stream().filter(MinecraftAddonTests::expectedProblem).count() + " erwartet von Test-Addons)");
		t.check("Loader hat HeldixClient geladen", mods.contains(HeldixClient.MOD_ID));
		t.check("Loader hat den Autotest geladen", mods.contains("heldix-autotest"));
		if (fabric) {
			t.check("Heldix Loader läuft als Fabric-Mod", fabricModLoaded("heldixloader"));
		} else {
			t.check("Fabric-Mod im mods-Ordner wird erkannt und übersprungen", problems.stream().anyMatch(p -> p.contains("Fabric-Mod")));
		}
		// ausgenommen das Test-Addon, dessen Transformer absichtlich scheitert (MinecraftAddonTests)
		t.check("Keine fehlgeschlagenen Patches", problems.stream().filter(p -> !MinecraftAddonTests.expectedProblem(p))
				.noneMatch(p -> p.contains("Patch") || p.contains("nicht verändert")));
		String title = t.compute(mc -> {
			try {
				Method createTitle = Minecraft.class.getDeclaredMethod("createTitle");
				createTitle.setAccessible(true);
				return (String) createTitle.invoke(mc);
			} catch (ReflectiveOperationException e) {
				throw new IllegalStateException(e);
			}
		});
		t.check("Fenstertitel \"" + title + "\"", title.startsWith(HeldixClient.NAME + " "));
		String keyName = t.compute(mc -> Component.translatable("key.heldixclient.menu").getString());
		t.check("Übersetzung aus der Mod (\"" + keyName + "\")", !keyName.equals("key.heldixclient.menu"));
		t.check("Tasten der Mod in den Optionen", t.compute(mc -> Arrays.asList(mc.options.keyMappings).contains(HeldixClient.menuKey)));
		t.check("Hauptmenü ist die Heldix-Startseite",
				t.compute(mc -> mc.gui.screen() instanceof TitleScreen && mc.gui.screen().children().stream().anyMatch(child -> child instanceof StartCard)));
		t.check("Startseite zeigt die Schnellstart-Karten",
				t.compute(mc -> mc.gui.screen().children().stream().filter(child -> child instanceof StartCard).count() == 5));

		// --- Grafik: Ressourcen der Mod, Shader, F3 -----------------------------------------
		// eigenständig lädt der Heldix Loader die Ressourcen als eigenes Paket, in Fabric macht das Fabric API
		if (!fabric) {
			t.check("Ressourcenpaket der Mod ist aktiv",
					t.compute(mc -> mc.getResourcePackRepository().getSelectedIds().contains("heldix:" + HeldixClient.MOD_ID)));
		}
		t.check("Shader-Stile liegen in den Ressourcen", t.compute(mc -> mc.getResourceManager()
				.getResource(Identifier.fromNamespaceAndPath(HeldixClient.MOD_ID, "post_effect/kino.json")).isPresent()));
		t.check("F3-Eintrag von HeldixClient angemeldet", DebugOverlay.isRegistered());
		String backend = t.compute(mc -> DebugOverlay.backend());
		t.log("Grafik-API " + backend);
		String expectedBackend = System.getProperty("heldix.autotest.backend", "");
		if (!expectedBackend.isBlank()) t.check("Grafik-API ist " + expectedBackend + " (" + backend + ")", backend.equalsIgnoreCase(expectedBackend));

		// --- Heldix-Addons ----------------------------------------------------------------
		String addons = t.compute(mc -> AddonManager.addons().stream()
				.map(a -> a.name() + "=" + a.state() + (a.error() != null ? " (" + a.error() + ")" : ""))
				.toList().toString());
		t.log("Addons " + addons);
		t.check("Uhrzeit-Addon aktiv", addons.contains("Uhrzeit & Spielzeit=ACTIVE"));
		t.check("Kaputtes Addon als Fehler erkannt", addons.contains("Kaputtes Test-Addon=FAILED"));
		t.check("Module des Uhrzeit-Addons vorhanden",
				t.compute(mc -> ModuleManager.all().stream().anyMatch(m -> "uhrzeit:uhrzeit".equals(m.id()))));
		// Spotify-Addon nutzt API 6: eigene Einstellungen, Tasten, Chat-Befehle und Knöpfe im HUD
		t.check("Spotify-Addon aktiv (API 6)", addons.contains("Spotify=ACTIVE"));
		t.check("Item-Physics-Addon aktiv (API 4)", addons.contains("Item Physics=ACTIVE"));
		t.check("Spotify-Modul mit eigenen Einstellungen", t.compute(mc -> ModuleManager.all().stream()
				.filter(m -> "spotify:spotify".equals(m.id()))
				.anyMatch(m -> m.settings().stream().anyMatch(s -> s.label().equals("Cover anzeigen")))));
		t.check("Addon-Tasten in der Steuerung", t.compute(mc -> java.util.Arrays.stream(mc.options.keyMappings)
				.anyMatch(k -> k.getName().equals("Spotify – Abspielen/Pause"))));
		// Manifest Version 2 und Addons mit Zugriff auf Minecraft (mod/test-addons/minecraft)
		MinecraftAddonTests.manifests(t);
		MinecraftAddonTests.startup(t, fabric);

		t.run(mc -> mc.reloadResourcePacks());
		t.waitSoft(mc -> mc.gui.overlay() != null, 5);
		t.waitTicks(12);
		boolean loadingShown = t.compute(mc -> mc.gui.overlay() instanceof net.minecraft.client.gui.screens.LoadingOverlay);
		t.screenshot("heldix-00-ladebildschirm");
		t.check("Ladebildschirm erscheint beim Neuladen", loadingShown);
		t.check("Ladebildschirm im Heldix-Design aktiv", t.compute(mc -> dev.heldixclient.screen.LoadingScreen.active()));
		t.waitFor("Neuladen fertig", mc -> mc.gui.overlay() == null && mc.gui.screen() instanceof TitleScreen, 120);
		t.waitTicks(10);

		int[] multiplayer = t.widgetCenter(w -> w.getMessage().getString().equals("Mehrspieler"), "Mehrspieler");
		t.moveMouse(multiplayer[0], multiplayer[1]);
		t.screenshot("heldix-01-hauptmenue");
		t.check("Hauptmenü zeigt die Spielfigur mit Cape", t.compute(mc -> mc.gui.screen().children().stream()
				.anyMatch(w -> w instanceof dev.heldixclient.screen.FigureWidget)));
		t.check("Hauptmenü hat den Knopf Cosmetics", t.compute(mc -> mc.gui.screen().children().stream()
				.anyMatch(w -> w instanceof net.minecraft.client.gui.components.AbstractWidget a && "Cosmetics".equals(a.getMessage().getString()))));
		titleLayoutChecks(t, "854×480");
		bigWindow(t, "Hauptmenü", () -> {
			t.setScreen(TitleScreen::new);
			t.waitForScreen(TitleScreen.class, 10);
			t.waitTicks(10);
			titleLayoutChecks(t, "groß");
			t.screenshot("heldix-01d-hauptmenue-gross");
		});
		t.waitForScreen(TitleScreen.class, 10);
		t.waitTicks(6);

		// Weg 1: Hauptmenü → Knopf "Module" → Karte anklicken
		t.clickWidget("Module");
		t.waitTicks(10);
		clickTest(t, "Hauptmenü");
		t.setScreen(TitleScreen::new);
		t.waitForScreen(TitleScreen.class, 10);

		// Cape-Seite im Hauptmenü: Spielerfigur ohne Welt
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.CAPE));
		// Vorschaubilder werden im Hintergrund geladen
		t.waitTicks(40);
		t.check("Cape-Seite im Hauptmenü", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu && "CAPE".equals(menu.currentTab())));
		t.screenshot("heldix-01c-cape-hauptmenue");
		t.setScreen(TitleScreen::new);
		t.waitForScreen(TitleScreen.class, 10);

		// Kontowechsel im Hauptmenü (mit test:launch als Launcher: zweites Offline-Konto, wechseln und zurück)
		AccountTests.titleScreen(t);

		// --- Welt ---------------------------------------------------------------------------
		createFlatWorld(t);
		t.check("Welt-betreten-Event", joined);
		t.run(mc -> ModuleManager.all().forEach(m -> m.setEnabled(true)));
		t.run(mc -> mc.options.keyUp.setDown(true));
		t.waitTicks(10);
		t.screenshot("heldix-02-hud");
		t.run(mc -> mc.options.keyUp.setDown(false));
		t.run(mc -> dev.heldixclient.hud.Notifications.show("autotest", "Einblendung", "So sehen Addon-Einblendungen aus", null));
		t.waitTicks(8);
		t.screenshot("heldix-02b-einblendung");
		// Minecrafts Hinweis „Chatnachrichten können nicht überprüft werden“ läge als Toast über der Kopfzeile der
		// Heldix-Menüs: mit dem Heldix-Design kommt er als eigene Einblendung
		String unsecureTitle = t.compute(mc -> Component.translatable("multiplayer.unsecureserver.toast.title").getString());
		t.run(mc -> net.minecraft.client.gui.components.toasts.SystemToast.add(mc.gui.toastManager(),
				net.minecraft.client.gui.components.toasts.SystemToast.SystemToastId.UNSECURE_SERVER_WARNING,
				Component.translatable("multiplayer.unsecureserver.toast.title"), Component.translatable("multiplayer.unsecureserver.toast")));
		boolean noticeShown = t.waitSoft(mc -> dev.heldixclient.hud.Notifications.current().stream().anyMatch(n -> n.startsWith(unsecureTitle)), 5);
		t.check("Hinweis „" + unsecureTitle + "“ als Heldix-Einblendung statt Toast über den Menüs", noticeShown);
		t.waitTicks(4);
		t.screenshot("heldix-02c-hinweis-chat");

		t.serverCommand("tellraw @a \"Heldix-Autotest System\"");
		t.serverCommand("say Heldix-Autotest Say");
		t.waitSoft(mc -> CHAT.size() >= 2, 5);
		t.log("Chat " + CHAT);
		t.check("Chat-Event (Systemnachricht)", CHAT.stream().anyMatch(s -> s.startsWith("[System]") && s.contains("Heldix-Autotest System")));
		t.check("Chat-Event (/say)", CHAT.stream().anyMatch(s -> s.contains("Heldix-Autotest Say")));

		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(10);
		t.check("Heldix-Menü öffnet mit der Übersicht", "OVERVIEW".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).currentTab())));
		t.screenshot("heldix-03a-uebersicht");
		clickTest(t, "direkt geöffnet");
		t.screenshot("heldix-03-heldix-menue");

		// Oberfläche: Leisten, Übersicht, Schnellsuche, Tastatur, kleine Fenster
		ShellTests.run(t);
		// Tasten im Untermenü der Module (eingebaut und aus Addons)
		KeyTests.run(t);

		// Unter-Menüs: Einstellungen → Reiter Info; Mods & Addons ist eine eigene Kategorie mit dem Store
		openPage(t, "INFO");
		t.check("Einstellungen haben die Reiter Allgemein und Info",
				t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabIds()).equals(java.util.List.of("SETTINGS", "INFO")));
		openPage(t, "ADDONS");
		t.check("Mods & Addons hat die Reiter Installiert und Store",
				t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabIds()).equals(java.util.List.of("ADDONS", "STORE")));
		t.moveMouse(350, 235);
		t.waitTicks(5);
		t.screenshot("heldix-03b-addons");
		MinecraftAddonTests.menu(t, fabric);

		// Weg 2: im Spiel mit der Rechten Umschalttaste
		t.setScreen(() -> null);
		t.waitTicks(5);
		t.pressKey(InputConstants.KEY_RSHIFT);
		t.waitTicks(10);
		clickTest(t, "Rechte Umschalttaste");

		// Weg 3: Heldix-Pausemenü (ersetzt Minecrafts Pausemenü) → Knopf "Module"
		t.setScreen(() -> new PauseScreen(true));
		t.waitTicks(5);
		t.check("Pausemenü ist das Heldix-Pausemenü", t.compute(mc -> mc.gui.screen() instanceof PauseMenuScreen));
		t.clickWidget("Module");
		t.waitTicks(10);
		clickTest(t, "Pausemenü");

		// Weg 4: klassisches Pausemenü mit dem Knopf "Heldix-Menü" (kommt über ScreenEvents.AFTER_INIT des Loaders)
		t.run(mc -> Shell.openVanilla(mc, new PauseScreen(true)));
		t.waitTicks(5);
		t.check("Klassisches Pausemenü bleibt Vanilla", t.compute(mc -> mc.gui.screen().getClass() == PauseScreen.class));
		t.clickWidget("Heldix-Menü");
		t.waitTicks(10);
		clickTest(t, "klassisches Pausemenü");

		// HUD-Editor und Verschieben eines Elements (von den Standardpositionen aus)
		t.run(mc -> ModuleManager.hud().forEach(HudModule::resetPosition));
		t.setScreen(() -> new HudEditorScreen(null));
		t.waitTicks(5);
		t.screenshot("heldix-04-hud-editor");
		int[] start = t.compute(mc -> {
			HudModule module = ModuleManager.hud().getFirst();
			return new int[] {module.x(), module.y()};
		});
		MouseButtonInfo leftButton = new MouseButtonInfo(TestContext.LEFT, 0);
		t.run(mc -> mc.gui.screen().mouseClicked(new MouseButtonEvent(start[0] + 4, start[1] + 4, leftButton), false));
		for (int i = 1; i <= 10; i++) {
			int step = i;
			t.run(mc -> mc.gui.screen().mouseDragged(new MouseButtonEvent(start[0] + 4 + step * 10, start[1] + 4 + step * 5, leftButton), 10, 5));
			t.waitTicks(1);
		}
		t.run(mc -> mc.gui.screen().mouseReleased(new MouseButtonEvent(start[0] + 104, start[1] + 54, leftButton)));
		int endX = t.compute(mc -> ModuleManager.hud().getFirst().x());
		t.check("HUD-Element verschoben (x " + start[0] + " → " + endX + ")", endX > start[0] + 20);
		t.screenshot("heldix-04b-hud-editor-verschoben");
		t.run(mc -> {
			ModuleManager.hud().forEach(HudModule::resetPosition);
			HeldixConfig.save();
		});
		t.waitTicks(2);
		hudEditorTest(t, start, leftButton);

		t.setScreen(() -> new PauseScreen(true));
		t.waitTicks(8);
		t.screenshot("heldix-05-pausemenue");
		pauseTest(t);
		t.setScreen(() -> null);

		// Zoom mit Bezugsobjekt in Blickrichtung (Süden)
		t.serverCommand("fill -3 -60 40 3 -50 40 minecraft:purple_concrete");
		t.serverCommand("fill -1 -50 40 1 -48 40 minecraft:amethyst_block");
		t.waitTicks(40);
		// jedes Tick neu drücken: ist das Testfenster nicht im Vordergrund, lässt Minecraft alle Tasten los
		for (int i = 0; i < 20; i++) {
			t.run(mc -> HeldixClient.zoomKey.setDown(true));
			t.waitTicks(1);
		}
		float fov = t.compute(mc -> mc.gameRenderer.mainCamera().getFov());
		t.check("Zoom wirkt (Sichtfeld " + fov + ")", fov < 30f);
		t.screenshot("heldix-06-zoom");
		t.run(mc -> HeldixClient.zoomKey.setDown(false));

		graphicsTest(t);
		// Rüstung, Trank-Effekte, Dauersprint, Freelook, Fadenkreuz, Chat, Wegpunkte; Heldix-Dienst (mit --service)
		FeatureTests.modules(t);
		FeatureTests.social(t);
		// Spielermenü (Mausrad-Klick auf einen Spieler) und Voice Chat über den Heldix-Dienst
		VoiceTests.run(t);
		// Einladungen (Freunde-Seite, Pausemenü, Annehmen, Echtzeit) und Gäste im Voice Chat (Dienst 1.11.0, API 9, Voice Chat 1.2.0)
		InviteTests.run(t);
		// Welt teilen (Dienst 1.12.0): Sicherung, Adresse, Freunde einladen, Relay mit Test-Client (Status, Anklopfen, Erlauben), Heldix-Welten
		WorldShareTests.run(t);
		// Dauerhafte Welten, Entdecken, Heldix+-Warteliste (Dienst 1.13.0, mit --service und --welt-port; ohne Hosting übersprungen)
		HostingTests.run(t);
		// Freunde 2.0 (Dienst 1.12.0): Favorit, Spitzname, Status, „Nicht stören“, Party (Einladung, Chat, Folgen, Voice), Karten,
		// Reaktionen, Antworten, Löschen, „schreibt …“, Vorschläge, Profilkarte, zuletzt online
		FriendsTests.run(t);
		// Voice-Moderation (Dienst 1.13.0, API 10, Voice Chat 1.3.0): Lautstärke-Schutz, Regeln-Dialog, Melden mit Clip,
		// Party-Leiter schaltet stumm, Sperre (mit Entwicklungs-Routen /v1/dev/voice/… des Dienstes)
		VoiceModerationTests.run(t);
		// Minimap-Addon (API 8): Welt von oben, eigenes Bild im HUD, Wegpunkte, Zoom
		MinimapTests.run(t);
		// Emote-Rad (Addon mit Zugriff auf Minecraft, von einem externen Entwickler)
		EmoteRadTests.run(t);
		// Heldix-Symbol je Rolle (alle Rollen und Schriften): Tab-Liste (mit Fußzeile) und Namensschilder über Köpfen
		BadgeTests.run(t);
		// Statuszeile für den Discord-Status (0.13.8): Dimension, Spielmodus, Weltname, Mindestabstand, abwesend
		StatusTests.run(t);
		// Heldix-Cosmetics: Katalog (signiert), Seite im Heldix-Menü, alle Slots, andere Spieler, Addon-API (mit --service)
		CosmeticTests.run(t);
		Format2Tests.run(t); // Cosmetics im Format 2 (Meshes mit Keyframe-Animationen, 0.13.8): Format, Katalog, Zustände, Partikel, Menü
		FeatureTests.addonStore(t);
		// Heldix-API 3: Einstellungen (Regler, Farbe, Text), Spotify-Darstellungen, Daten, Scheduler, Befehle, Events
		AddonApiTests.settings(t);
		AddonApiTests.spotifyLayouts(t);
		AddonApiTests.api(t);
		// Heldix-API 4: gedroppte Items (Renderer anmelden, null, Fehler) und das Item-Physics-Addon
		DroppedItemTests.run(t);
		// HUD: Stile, Bezugspunkte, HUD-Editor mit Rechtsklick-Menü, anklickbare Elemente, HUD-API (Stufe 5) mit Spotify
		HudTests.run(t, fabric);

		// Server-Schnittstelle (0.14.1, API 11): Codec, Regeln, Server-HUD, Einblendungen, Partner, Server-Gruppe, „Im Launcher“
		ServerLinkTests.inWorld(t);

		// Welt verlassen – mit Launcher über „Welt verlassen und wechseln“ auf der Seite Konten
		AccountTests.leaveWorld(t);
		t.waitFor("Welt verlassen", mc -> mc.level == null && mc.gui.screen() instanceof TitleScreen, 60);
		t.check("Welt-verlassen-Event", left);
		// Server-Schnittstelle mit echtem Paper-Server und Plugin (nur mit HELDIX_AUTOTEST_PAPER und HELDIX_AUTOTEST_PLUGIN)
		ServerLinkTests.realServer(t);

		// Die übrigen Menüs im Heldix-Design
		Screen titleScreen = t.compute(mc -> mc.gui.screen());
		t.waitTicks(10);
		t.screenshot("heldix-01b-startseite-mit-welt");

		// Vanilla-Einzelspieler wird beim Öffnen durch die Heldix-Seite ersetzt (Gui.setScreen-Patch)
		t.setScreen(() -> new SelectWorldScreen(titleScreen));
		t.waitFor("Weltenliste geladen", mc -> mc.gui.screen() instanceof WorldsScreen worlds && worlds.worldCount() >= 0, 30);
		t.check("Einzelspieler öffnet die Heldix-Seite", t.compute(mc -> mc.gui.screen() instanceof WorldsScreen));
		t.check("Testwelt steht in der Liste", t.compute(mc -> ((WorldsScreen) mc.gui.screen()).worldNames().contains("Heldix Autotest")));
		int[] size = t.compute(mc -> new int[] {mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight()});
		t.moveMouse(size[0] - 20, size[1] - 20);
		t.waitTicks(10);
		// Einblendungen früherer Schritte (z. B. „Konto gewechselt“) nicht mit aufs Bild nehmen
		t.run(mc -> mc.gui.toastManager().clear());
		t.screenshot("heldix-07-einzelspieler");

		t.run(mc -> Shell.openVanilla(mc, new SelectWorldScreen(titleScreen)));
		t.waitTicks(10);
		t.check("Klassische Ansicht bleibt das Vanilla-Menü", t.compute(mc -> mc.gui.screen() instanceof SelectWorldScreen));
		t.screenshot("heldix-07b-einzelspieler-klassisch");

		// Mehrspieler mit einem (nicht erreichbaren) Testserver
		t.run(mc -> {
			ServerList list = new ServerList(mc);
			list.load();
			boolean present = false;
			for (int i = 0; i < list.size(); i++) present |= list.get(i).ip.equals(TEST_SERVER);
			if (!present) {
				list.add(new ServerData("Heldix Testserver", TEST_SERVER, ServerData.Type.OTHER), false);
				list.save();
			}
		});
		t.setScreen(() -> new JoinMultiplayerScreen(titleScreen));
		t.waitTicks(5);
		t.check("Mehrspieler öffnet die Heldix-Seite", t.compute(mc -> mc.gui.screen() instanceof ServersScreen));
		t.check("Testserver steht in der Liste", t.compute(mc -> ((ServersScreen) mc.gui.screen()).serverCount() >= 1));
		t.moveMouse(size[0] - 20, size[1] - 20);
		t.waitTicks(40);
		t.screenshot("heldix-08-mehrspieler");

		// HUD-Editor ohne Welt: Elemente ohne Spieldaten erscheinen als Vorschau
		t.setScreen(() -> new HudEditorScreen(titleScreen));
		t.waitTicks(5);
		t.check("HUD-Editor im Hauptmenü zeigt alle Elemente", t.compute(mc -> ModuleManager.hud().stream()
				.filter(HudModule::isEnabled).allMatch(m -> m.width() > 0 && m.height() > 0)));
		t.screenshot("heldix-04f-hud-editor-hauptmenue");

		t.setScreen(() -> new OptionsScreen(titleScreen, Minecraft.getInstance().options));
		t.waitTicks(10);
		t.screenshot("heldix-09-optionen");
		// an/aus im Spiel zuletzt: das Uhrzeit-Addon bleibt danach bis zum Spielende aus
		MinecraftAddonTests.toggles(t);
		t.setScreen(() -> titleScreen);
		// Kontowechsel zuletzt: zurück zum Startkonto, im Launcher aus/an, dann Launcher weg
		AccountTests.end(t);
	}

	private static final String TEST_SERVER = "localhost:25599";
	private static final int CONTROL = 64; // Strg (Minecraft-Modifikatoren: 64/128 = linke/rechte Strg-Taste)

	/** HUD-Editor: auswählen, über den Griff skalieren, rückgängig, Einstellungen per Rechtsklick, Elemente-Liste. */
	private static void hudEditorTest(TestContext t, int[] start, MouseButtonInfo leftButton) {
		HudModule first = t.compute(mc -> ModuleManager.hud().getFirst());
		t.run(mc -> {
			Screen editor = mc.gui.screen();
			editor.mouseClicked(new MouseButtonEvent(start[0] + 4, start[1] + 4, leftButton), false);
			editor.mouseReleased(new MouseButtonEvent(start[0] + 4, start[1] + 4, leftButton));
		});
		t.waitTicks(2);
		t.check("Klick wählt das HUD-Element aus", first.name().equals(t.compute(mc -> ((HudEditorScreen) mc.gui.screen()).selectedName())));

		int[] handle = t.compute(mc -> ((HudEditorScreen) mc.gui.screen()).handleCenter());
		int width = first.width();
		t.run(mc -> mc.gui.screen().mouseClicked(new MouseButtonEvent(handle[0], handle[1], leftButton), false));
		for (int i = 1; i <= 5; i++) {
			int step = i;
			t.run(mc -> mc.gui.screen().mouseDragged(new MouseButtonEvent(handle[0] + step * width / 10.0, handle[1] + step, leftButton), 0, 0));
			t.waitTicks(1);
		}
		t.run(mc -> mc.gui.screen().mouseReleased(new MouseButtonEvent(handle[0] + width / 2.0, handle[1] + 5, leftButton)));
		t.waitTicks(2);
		float scaled = t.compute(mc -> first.scale());
		t.check("Griff an der Ecke vergrößert das Element (" + Math.round(scaled * 100) + " %)", scaled >= 1.3f);
		t.screenshot("heldix-04c-hud-editor-groesse");

		t.run(mc -> mc.gui.screen().keyPressed(new KeyEvent(InputConstants.KEY_Z, 0, CONTROL)));
		t.check("Strg+Z macht die Größenänderung rückgängig", t.compute(mc -> Math.abs(first.scale() - 1f) < 0.01f));

		t.run(mc -> mc.gui.screen().keyPressed(new KeyEvent(InputConstants.KEY_DELETE, 0, 0)));
		t.check("Entf blendet das Element aus", !t.compute(mc -> first.isEnabled()));
		t.run(mc -> mc.gui.screen().keyPressed(new KeyEvent(InputConstants.KEY_Z, 0, CONTROL)));
		t.check("Strg+Z blendet es wieder ein", t.compute(mc -> first.isEnabled()));
		t.waitTicks(2);

		int[] nudgeFrom = t.compute(mc -> new int[] {first.x(), first.y()});
		t.run(mc -> mc.gui.screen().keyPressed(new KeyEvent(InputConstants.KEY_RIGHT, 0, 0)));
		t.waitTicks(1);
		t.check("Pfeiltaste verschiebt um einen Pixel", t.compute(mc -> first.x() == nudgeFrom[0] + 1));
		t.run(mc -> mc.gui.screen().keyPressed(new KeyEvent(InputConstants.KEY_Z, 0, CONTROL)));

		t.run(mc -> mc.gui.screen().mouseClicked(new MouseButtonEvent(start[0] + 4, start[1] + 4,
				new MouseButtonInfo(InputConstants.MOUSE_BUTTON_RIGHT, 0)), false));
		t.waitTicks(3);
		t.check("Rechtsklick öffnet das Menü des Elements", t.compute(mc -> ((HudEditorScreen) mc.gui.screen()).contextMenu().isOpen()));
		int[] settingsRow = t.compute(mc -> ((HudEditorScreen) mc.gui.screen()).contextMenu().rowCenter(0, "Einstellungen öffnen"));
		t.run(mc -> mc.gui.screen().mouseClicked(new MouseButtonEvent(settingsRow[0], settingsRow[1], leftButton), false));
		t.waitTicks(5);
		t.check("Menü → Einstellungen öffnen zeigt die Einstellungen des Elements", first.id().equals(t.compute(mc ->
				mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.openModuleId() : null)));
		t.screenshot("heldix-04d-hud-einstellungen");
		t.run(mc -> mc.gui.screen().onClose());
		t.waitTicks(3);
		t.check("Schließen führt zurück in den HUD-Editor", t.compute(mc -> mc.gui.screen() instanceof HudEditorScreen));

		t.clickWidget("Elemente");
		t.moveMouse(5, 120);
		t.waitTicks(4);
		t.screenshot("heldix-04e-hud-elemente");
		t.run(mc -> {
			ModuleManager.hud().forEach(module -> {
				module.resetPosition();
				module.setScale(1.0);
			});
			HeldixConfig.save();
		});
	}

	/** Capes: Auswahl über die Kacheln, Skin des eigenen Spielers, eigenes Bild, Ansicht von hinten. */
	private static void capeTest(TestContext t) {
		// Cape-Bilder werden im Hintergrund geladen: kurz warten
		t.waitSoft(mc -> capePathNow(mc).contains("cape/heldix"), 10);
		t.check("Eigener Spieler trägt das Heldix-Cape", capePath(t).contains("cape/heldix"));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.CAPE));
		t.waitTicks(8);
		int[] aurora = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).capeCenter(3));
		t.moveMouse(aurora[0], aurora[1]);
		t.waitTicks(6);
		t.screenshot("heldix-03g-cape");
		t.click(aurora[0], aurora[1]);
		t.waitSoft(mc -> capePathNow(mc).contains("cape/aurora"), 10);
		t.check("Klick auf eine Cape-Kachel wählt das Cape", "aurora".equals(t.compute(mc -> HeldixConfig.get().cape)) && capePath(t).contains("cape/aurora"));
		int[] none = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).capeCenter(0));
		t.click(none[0], none[1]);
		t.waitTicks(2);
		t.check("Kachel Ohne entfernt das Cape", capePath(t).isEmpty());

		// eigenes Bild (kein Cape-Format): wird auf die Rückseite gelegt
		Path dir = Capes.directory();
		Path picture = dir.resolve("autotest-bild.png");
		t.run(mc -> {
			try {
				java.nio.file.Files.createDirectories(dir);
				try (NativeImage image = new NativeImage(90, 60, false)) {
					for (int y = 0; y < 60; y++) {
						for (int x = 0; x < 90; x++) image.setPixel(x, y, 0xFF000000 | (x * 2) << 16 | (y * 4) << 8 | 0xC0);
					}
					image.writeToFile(picture);
				}
			} catch (Exception e) {
				throw new RuntimeException(e);
			}
			Capes.reloadCustom();
		});
		t.check("Eigenes Bild erscheint als Cape", t.compute(mc -> Capes.custom().stream().anyMatch(c -> c.id().equals("datei:autotest-bild.png"))));
		t.run(mc -> Capes.select(Capes.byId("datei:autotest-bild.png")));
		t.waitTicks(4);
		t.check("Eigenes Cape am Spieler", capePath(t).contains("cape/custom/"));
		t.moveMouse(4, 4);
		t.waitTicks(3);
		t.screenshot("heldix-03h-cape-eigenes");

		// Ansicht von hinten: erst mit dem eigenen Bild, dann mit dem Heldix-Cape
		t.run(mc -> {
			mc.gui.setScreen(null);
			mc.options.setCameraType(CameraType.THIRD_PERSON_BACK);
		});
		t.waitTicks(10);
		t.screenshot("heldix-03i-cape-f5-eigenes");
		t.run(mc -> Capes.select(Capes.byId("heldix")));
		t.waitSoft(mc -> capePathNow(mc).contains("cape/heldix"), 10);
		t.waitTicks(5);
		t.screenshot("heldix-03i-cape-f5");
		// beim Laufen weht der Stoff stärker
		t.run(mc -> mc.options.keyUp.setDown(true));
		t.waitTicks(14);
		t.screenshot("heldix-03k-cape-laufen");
		t.run(mc -> mc.options.keyUp.setDown(false));

		// Animation: das Bild der Animation wechselt mit der Zeit; Leuchten gehört zum aktuellen Bild
		String first = capePath(t);
		t.waitTicks(5);
		String later = capePath(t);
		t.check("Cape ist animiert (" + first + " → " + later + ")", !first.equals(later));
		t.check("Heldix-Cape hat leuchtende Teile", t.compute(mc -> {
			var cape = mc.player.getSkin().cape();
			return cape != null && Capes.glowFor(cape.texturePath()) != null;
		}));

		// nachts: Glut-Cape mit leuchtenden Flammen und Funken
		t.serverCommand("time set 18000");
		t.run(mc -> Capes.select(Capes.byId("glut")));
		t.waitSoft(mc -> capePathNow(mc).contains("cape/glut"), 10);
		t.waitTicks(10);
		t.screenshot("heldix-03j-cape-nacht");
		t.serverCommand("time set 1000");
		t.run(mc -> Capes.select(Capes.byId("heldix")));
		t.run(mc -> {
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			try {
				java.nio.file.Files.deleteIfExists(picture);
			} catch (Exception e) {
				LOG.warn("Testbild nicht löschbar", e);
			}
			Capes.reloadCustom();
		});
		t.waitSoft(mc -> capePathNow(mc).contains("cape/heldix"), 10);
		t.check("Heldix-Cape wieder angelegt", capePath(t).contains("cape/heldix"));
		// Cape-Fix (ruhig, ohne schwarze Ränder, Elytra-Formen) und die neuen Capes mit Team-Sperre
		CapeFixTests.run(t);
	}

	/** Pfad der Cape-Textur des eigenen Spielers ("" = kein Cape) */
	private static String capePath(TestContext t) {
		return t.compute(AutoTest::capePathNow);
	}

	private static String capePathNow(Minecraft mc) {
		if (mc.player == null) return "";
		var cape = mc.player.getSkin().cape();
		return cape == null ? "" : cape.texturePath().getPath();
	}

	/** Shader-Stile, F3-Menü, FPS-Boost und Hintergrund-FPS in der Testwelt. */
	private static void graphicsTest(TestContext t) {
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.MODULES));
		t.waitTicks(5);
		// Untermenü eines Moduls über das Regler-Symbol (erste Karte: FPS)
		int[] gear = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).settingsIconCenter(0));
		t.click(gear[0], gear[1]);
		t.check("Regler-Symbol öffnet das Untermenü des Moduls", "fps".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).openModuleId())));
		t.moveMouse(gear[0], gear[1]);
		t.waitTicks(5);
		t.screenshot("heldix-03e-untermenue");

		// Untermenü eines Addon-Moduls (API 2): eigene Schalter und Knöpfe des Spotify-Addons
		Module spotify = t.compute(mc -> ModuleManager.all().stream().filter(m -> "spotify:spotify".equals(m.id())).findFirst().orElse(null));
		if (spotify != null) {
			t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.MODULES, spotify));
			t.waitTicks(5);
			t.check("Untermenü eines Addon-Moduls", "spotify:spotify".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).openModuleId())));
			t.check("Addon-Modul hat eigenes Icon", "music".equals(spotify.icon()));
			t.screenshot("heldix-03f-addon-einstellungen");
		}
		capeTest(t);

		// HUD-Größe über die Einstellung des Moduls
		int normalWidth = t.compute(mc -> ModuleManager.hud().getFirst().width());
		t.run(mc -> sliderOf(ModuleManager.hud().getFirst(), "Größe").set().accept(1.5));
		t.setScreen(() -> null);
		t.waitTicks(3);
		int bigWidth = t.compute(mc -> ModuleManager.hud().getFirst().width());
		t.check("Größe des HUD-Elements (" + normalWidth + " → " + bigWidth + " px)", bigWidth >= normalWidth * 1.25); // FPS-Ziffern können sich dazwischen ändern
		t.run(mc -> sliderOf(ModuleManager.hud().getFirst(), "Größe").set().accept(1.0));

		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(5);
		int[] tab = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabCenter("SHADER"));
		t.click(tab[0], tab[1]);
		t.check("Reiter Shader ist offen", "SHADER".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).currentTab())));
		int[] chip = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).shaderCenter(ShaderPreset.KINO.ordinal()));
		t.click(chip[0], chip[1]);
		t.check("Klick auf Shader-Kachel wählt „Kino“", t.compute(mc -> Shaders.current() == ShaderPreset.KINO));
		t.moveMouse(chip[0], chip[1]);
		t.waitTicks(5);
		t.screenshot("heldix-03c-shader");
		for (String name : new String[] {"PERFORMANCE", "SETTINGS", "INFO"}) {
			openPage(t, name);
			t.moveMouse(5, 5);
			t.waitTicks(4);
			t.screenshot("heldix-03d-" + name.toLowerCase(java.util.Locale.ROOT));
		}
		// Reiter der Seite Module filtern die Kacheln
		openPage(t, "MODULES");
		int[] hudTab = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabCenter("filter:HUD"));
		t.click(hudTab[0], hudTab[1]);
		t.waitTicks(3);
		t.moveMouse(5, 5);
		t.waitTicks(4);
		t.screenshot("heldix-03e-module-hud");
		t.setScreen(() -> null);

		// Iris-Shaderpack aktiv (Fabric-Instanz mit z. B. BSL): Heldix-Shader müssen pausieren
		if (t.compute(mc -> dev.heldixclient.render.IrisCompat.shaderPackActive())) {
			t.log("Iris-Shaderpack aktiv");
			t.run(mc -> {
				Shaders.select(ShaderPreset.KINO);
				ShaderEngine.applyLevel(2);
			});
			t.waitTicks(10);
			t.check("Heldix-Shader pausieren, solange ein Iris-Shaderpack aktiv ist", t.compute(mc -> !Shaders.isApplied() && !ShaderEngine.isApplied()));
			t.screenshot("heldix-11-iris-shaderpack");
			t.run(mc -> ShaderEngine.applyLevel(0));
		} else {
			// Shader-Engine (Bloom, Tiefenunschärfe, Nebel, SSAO) muss sich übersetzen lassen und gezeichnet werden
			t.run(mc -> Shaders.select(ShaderPreset.OFF));
			t.run(mc -> ShaderEngine.applyLevel(2));
			t.waitSoft(mc -> ShaderEngine.isApplied(), 10);
			t.check("Shader-Engine wird gezeichnet", t.compute(mc -> ShaderEngine.isApplied()));
			t.waitTicks(3);
			t.screenshot("heldix-12-shader-engine");
			t.run(mc -> ShaderEngine.applyLevel(0));
			t.waitTicks(3);
			t.check("Shader-Engine aus", t.compute(mc -> !ShaderEngine.isApplied()));

			// Jeder Stil muss sich übersetzen lassen und gezeichnet werden (Vulkan und OpenGL)
			for (ShaderPreset preset : ShaderPreset.values()) {
				if (preset == ShaderPreset.OFF) continue;
				t.run(mc -> Shaders.select(preset));
				t.waitSoft(mc -> Shaders.isApplied(), 10);
				t.check("Shader „" + preset.label() + "“ wird gezeichnet", t.compute(mc -> Shaders.isApplied()));
				if (preset == ShaderPreset.KINO || preset == ShaderPreset.SCHWARZWEISS || preset == ShaderPreset.RETRO) {
					t.waitTicks(3);
					t.screenshot("heldix-11-shader-" + preset.key());
				}
			}
		}
		t.run(mc -> Shaders.select(ShaderPreset.OFF));
		t.waitTicks(3);
		t.check("Shader aus: kein HeldixClient-Effekt mehr", t.compute(mc -> mc.gameRenderer.getAppliedPostEffects().stream()
				.noneMatch(id -> id.getNamespace().equals(HeldixClient.MOD_ID))));

		// F3-Menü mit den Zeilen von HeldixClient
		t.run(mc -> mc.debugEntries.setOverlayVisible(true));
		t.waitTicks(5);
		t.check("F3 zeigt die HeldixClient-Zeilen", t.compute(mc -> mc.debugEntries.isCurrentlyEnabled(DebugOverlay.ENTRY)));
		t.screenshot("heldix-10-f3");
		t.run(mc -> mc.debugEntries.setOverlayVisible(false));

		// FPS-Boost: schnelle Werte an, danach exakt die alten Werte zurück
		t.run(mc -> {
			mc.options.cloudStatus().set(CloudStatus.FANCY);
			mc.options.entityShadows().set(true);
		});
		t.run(mc -> Performance.setBoost(true));
		t.check("FPS-Boost stellt schnelle Optionen ein", t.compute(mc -> Performance.boostEnabled()
				&& mc.options.cloudStatus().get() == CloudStatus.FAST && !mc.options.entityShadows().get()));
		t.run(mc -> Performance.setBoost(false));
		t.check("FPS-Boost aus stellt die Optionen wieder her", t.compute(mc -> !Performance.boostEnabled()
				&& mc.options.cloudStatus().get() == CloudStatus.FANCY && mc.options.entityShadows().get()));

		// Hintergrund-FPS: hängt davon ab, ob das Testfenster gerade im Vordergrund ist
		// (der Test schaltet Hintergrund-FPS am Anfang aus, damit Bilder auch ohne Fokus kommen: nur für die Messung an)
		int[] fps = t.compute(mc -> {
			HeldixConfig.get().backgroundFps = true;
			int limit = Performance.framerateLimit(260);
			HeldixConfig.get().backgroundFps = false;
			return new int[] {limit, mc.isWindowActive() ? 1 : 0, mc.getFramerateLimitTracker().getFramerateLimit()};
		});
		boolean active = fps[1] == 1;
		t.log("Bildrate: Fenster " + (active ? "aktiv" : "im Hintergrund") + ", Grenze laut Minecraft " + fps[2]);
		t.check("Hintergrund-FPS (" + (active ? "Fenster aktiv" : "Fenster inaktiv") + " → " + fps[0] + ")", active ? fps[0] == 260 : fps[0] == 30);
	}

	/** Fragt Fabric per Reflection (der Autotest läuft auch ohne Fabric). */
	private static boolean fabricModLoaded(String id) {
		try {
			Class<?> loader = Class.forName("net.fabricmc.loader.api.FabricLoader", false, AutoTest.class.getClassLoader());
			Object instance = loader.getMethod("getInstance").invoke(null);
			return (boolean) loader.getMethod("isModLoaded", String.class).invoke(instance, id);
		} catch (ReflectiveOperationException e) {
			return false;
		}
	}

	/** Regler eines Moduls aus seinem Untermenü (nach Beschriftung). */
	private static Setting.Slider sliderOf(dev.heldixclient.module.Module module, String label) {
		return module.settings().stream()
				.filter(s -> s instanceof Setting.Slider && s.label().equals(label))
				.map(s -> (Setting.Slider) s)
				.findFirst()
				.orElseThrow(() -> new IllegalStateException(module.id() + " hat keinen Regler " + label));
	}

	/** Öffnet im Heldix-Menü eine Seite wie ein Spieler: Bereich oben, Seite in der Leiste darunter, dann der Reiter. */
	static void openPage(TestContext t, String name) {
		for (int i = 0; i < 4 && !name.equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).currentTab())); i++) {
			int[] center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabCenter(name));
			t.click(center[0], center[1]);
			t.waitTicks(3);
		}
		t.check("Seite " + name + " ist offen", name.equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).currentTab())));
	}

	/** Klickt im offenen Heldix-Menü auf die erste Modul-Karte und prüft, dass sie umschaltet (und schaltet zurück). */
	private static void clickTest(TestContext t, String way) {
		String screen = t.compute(mc -> String.valueOf(mc.gui.screen()));
		t.check(way + ": Heldix-Menü ist offen", screen.contains("HeldixMenuScreen"));
		if (!"MODULES".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).currentTab()))) {
			int[] modules = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabCenter("MODULES"));
			t.click(modules[0], modules[1]);
			t.waitTicks(3);
		}
		boolean before = t.compute(mc -> ModuleManager.all().getFirst().isEnabled());
		int[] card = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cardCenter(0));
		t.click(card[0], card[1]);
		boolean after = t.compute(mc -> ModuleManager.all().getFirst().isEnabled());
		t.check(way + ": Klick auf Karte schaltet das Modul um", before != after);
		t.click(card[0], card[1]);
	}

	/** Pausemenü: im kleinen Testfenster einspaltig; dann groß mit Karten (Freunde, Wegpunkte, Schnellschalter) */
	private static void pauseTest(TestContext t) {
		t.check("Pausemenü ist das Heldix-Pausemenü (neu)", t.compute(mc -> mc.gui.screen() instanceof PauseMenuScreen));
		java.util.List<dev.heldixclient.screen.ToggleChip> small = t.compute(mc -> ((PauseMenuScreen) mc.gui.screen()).toggles());
		if (small.isEmpty()) t.log("Pausemenü ohne Schnellschalter (kleines Fenster)");
		else pauseChecks(t, small);
		bigWindow(t, "Pausemenü", () -> {
			t.setScreen(() -> new PauseScreen(true));
			t.waitTicks(8);
			int gap = t.compute(mc -> ((PauseMenuScreen) mc.gui.screen()).leftGap());
			boolean capped = t.compute(mc -> ((PauseMenuScreen) mc.gui.screen()).rowsCapped());
			t.check("Pausemenü groß: zwei Spalten mit Karten", gap >= 0);
			t.check("Pausemenü groß: links keine Lücke unter den Knöpfen (" + gap + " px" + (capped ? ", Knöpfe schon maximal hoch" : "") + ")",
					gap >= 0 && (gap <= 16 || capped));
			if (t.compute(mc -> dev.heldixclient.social.Social.online())) {
				t.check("Pausemenü groß: „" + PauseMenuScreen.INVITE_BUTTON + "“ im Fuß der Freunde-Karte", t.compute(mc -> mc.gui.screen().children().stream()
						.anyMatch(w -> w instanceof net.minecraft.client.gui.components.AbstractWidget a && a.visible
								&& PauseMenuScreen.INVITE_BUTTON.equals(a.getMessage().getString()))));
			}
			java.util.List<dev.heldixclient.screen.ToggleChip> big = t.compute(mc -> ((PauseMenuScreen) mc.gui.screen()).toggles());
			if (small.isEmpty()) pauseChecks(t, big);
			t.screenshot("heldix-05c-pausemenue-gross");
		});
		t.setScreen(() -> new PauseScreen(true));
		t.waitTicks(6);
	}

	/**
	 * Fenster für {@code body} vergrößern (GUI-Skalierung 2), danach zurück. Im kleinen Testfenster sind Pausemenü und
	 * Hauptmenü einspaltig; die Karten-Ansicht gibt es nur in größeren Fenstern.
	 */
	static void bigWindow(TestContext t, String what, Runnable body) {
		int[] window = t.compute(mc -> new int[] {mc.getWindow().getScreenWidth(), mc.getWindow().getScreenHeight()});
		int scale = t.compute(mc -> mc.options.guiScale().get());
		t.run(mc -> {
			mc.options.guiScale().set(2);
			mc.getWindow().setWindowed(window[0] + 600, window[1] + 420);
		});
		boolean resized = t.waitSoft(mc -> mc.getWindow().getScreenWidth() != window[0], 5);
		t.waitTicks(6);
		try {
			if (!resized) t.log(what + ": Fenster ließ sich nicht vergrößern");
			body.run();
		} finally {
			t.run(mc -> {
				mc.getWindow().setWindowed(window[0], window[1]);
				mc.options.guiScale().set(scale);
			});
			t.waitSoft(mc -> mc.getWindow().getScreenWidth() == window[0], 5);
			t.waitTicks(6);
		}
	}

	/** Hauptmenü: Namen der Kacheln und der Heldix-Knöpfe ganz lesbar, Spielfigur groß genug */
	private static void titleLayoutChecks(TestContext t, String size) {
		String tiles = t.compute(mc -> mc.gui.screen().children().stream()
				.filter(c -> c instanceof StartCard card && !"Weiterspielen".equals(card.getMessage().getString()))
				.map(c -> (StartCard) c)
				.map(card -> {
					String label = card.getMessage().getString();
					boolean fits = card.isCentered() ? dev.heldixclient.ui.Ui.width(label, dev.heldixclient.ui.Ui.Font.LABEL) <= card.getWidth() - 8
							: StartCard.inlineWidth(label) <= card.getWidth();
					return label + (fits ? "" : " abgeschnitten");
				}).toList().toString());
		t.check("Hauptmenü " + size + ": Namen der Kacheln passen ganz " + tiles, !tiles.contains("abgeschnitten") && tiles.split(",").length == 4);
		java.util.List<String> labels = java.util.List.of("Module", "Cosmetics", "Grafik", "HUD-Editor", "Einstellungen");
		String pills = t.compute(mc -> labels.stream().map(label -> mc.gui.screen().children().stream()
				.filter(c -> c instanceof dev.heldixclient.screen.ActionButton b && label.equals(b.getMessage().getString()))
				.map(c -> (dev.heldixclient.screen.ActionButton) c)
				.findFirst()
				.map(b -> label + ((b.stacked() ? dev.heldixclient.ui.Ui.width(label, dev.heldixclient.ui.Ui.Font.SMALL) <= b.getWidth() - 6
						: dev.heldixclient.ui.Ui.width(label, dev.heldixclient.ui.Ui.Font.LABEL) + 24 <= b.getWidth()) ? "" : " abgeschnitten"))
				.orElse(label + " fehlt")).toList().toString());
		t.check("Hauptmenü " + size + ": Heldix-Knöpfe ganz beschriftet " + pills, !pills.contains("abgeschnitten") && !pills.contains("fehlt"));
		int[] figure = t.compute(mc -> {
			dev.heldixclient.screen.FigureWidget fig = null;
			StartCard hero = null;
			for (var child : mc.gui.screen().children()) {
				if (child instanceof dev.heldixclient.screen.FigureWidget f) fig = f;
				if (child instanceof StartCard card && "Weiterspielen".equals(card.getMessage().getString())) hero = card;
			}
			if (fig == null || hero == null) return new int[] {0, 0};
			return new int[] {fig.getHeight(), fig.getX() >= hero.getX() + hero.getWidth() ? 1 : 0};
		});
		t.check("Hauptmenü " + size + ": Spielfigur groß genug (" + figure[0] + " px, " + (figure[1] == 1 ? "neben" : "über") + " der Karte)",
				figure[0] >= (figure[1] == 1 ? 60 : 40));
	}

	/** Schnellschalter und „Wegpunkt hier setzen“ im Pausemenü */
	private static void pauseChecks(TestContext t, java.util.List<dev.heldixclient.screen.ToggleChip> toggles) {
		t.check("Pausemenü: mindestens vier Schnellschalter (" + toggles.size() + ")", toggles.size() >= 4);
		dev.heldixclient.screen.ToggleChip first = toggles.getFirst();
		boolean before = first.isOn();
		t.click(first.getX() + first.getWidth() / 2.0, first.getY() + first.getHeight() / 2.0);
		t.check("Schnellschalter schaltet das Modul um", first.isOn() != before);
		t.click(first.getX() + first.getWidth() / 2.0, first.getY() + first.getHeight() / 2.0);
		int count = t.compute(mc -> dev.heldixclient.waypoint.Waypoints.current(mc).size());
		int[] setHere = t.widgetCenter(w -> w.getMessage().getString().equals("Hier setzen") || w.getMessage().getString().equals("Wegpunkt"), "Wegpunkt setzen");
		t.click(setHere[0], setHere[1]);
		t.check("Pausemenü: Wegpunkt hier setzen", t.compute(mc -> dev.heldixclient.waypoint.Waypoints.current(mc).size()) == count + 1);
		t.run(mc -> {
			java.util.List<dev.heldixclient.waypoint.Waypoints.Waypoint> list = dev.heldixclient.waypoint.Waypoints.current(mc);
			list.removeLast();
			dev.heldixclient.waypoint.Waypoints.save();
		});
		t.waitTicks(3);
		t.screenshot("heldix-05b-pausemenue-karten");
	}

	private static void createFlatWorld(TestContext t) {
		t.run(mc -> CreateWorldScreen.openFresh(mc, () -> mc.gui.setScreen(new TitleScreen())));
		t.waitForScreen(CreateWorldScreen.class, 60);
		t.waitTicks(5);
		t.run(mc -> {
			WorldCreationUiState state = ((CreateWorldScreen) mc.gui.screen()).getUiState();
			state.setName("Heldix Autotest");
			state.setGameMode(WorldCreationUiState.SelectedGameMode.CREATIVE);
			state.setWorldType(new WorldCreationUiState.WorldTypeEntry(
					state.getSettings().worldgenLoadContext().lookupOrThrow(Registries.WORLD_PRESET).getOrThrow(WorldPresets.FLAT)));
		});
		t.waitTicks(2);
		t.clickTranslatable("selectWorld.create");
		if (t.waitSoft(mc -> mc.gui.screen() instanceof net.minecraft.client.gui.screens.LevelLoadingScreen, 20)) {
			t.waitTicks(4);
			t.screenshot("heldix-01d-welt-laden");
		}
		t.waitFor("Welt geladen", mc -> mc.level != null && mc.player != null && mc.gui.screen() == null, 180);
		if (!t.waitSoft(mc -> mc.levelRenderer.hasRenderedAllSections(), 30)) t.log("Nicht alle Chunks gezeichnet, mache trotzdem weiter");
		t.waitTicks(20);
		for (Module module : t.compute(mc -> ModuleManager.all())) t.log("Modul " + module.id());
	}
}
