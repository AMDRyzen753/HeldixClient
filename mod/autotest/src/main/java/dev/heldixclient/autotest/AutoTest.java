package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.config.HeldixConfig;
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
	private static final List<String> CHAT = new CopyOnWriteArrayList<>();

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
		t.waitTicks(20);
		t.log(t.compute(mc -> "Fenster " + mc.getWindow().getScreenWidth() + "x" + mc.getWindow().getScreenHeight()
				+ ", GUI " + mc.getWindow().getGuiScaledWidth() + "x" + mc.getWindow().getGuiScaledHeight()
				+ ", Skalierung " + mc.getWindow().getGuiScale()));

		// --- Heldix Loader ----------------------------------------------------------------
		List<String> mods = HeldixLoader.mods().stream().map(ModInfo::id).toList();
		List<String> problems = HeldixLoader.problems();
		boolean fabric = "fabric".equals(HeldixLoader.platform());
		t.log("Plattform " + HeldixLoader.platform() + ", Mods " + mods + ", Probleme " + problems);
		t.check("Loader hat HeldixClient geladen", mods.contains(HeldixClient.MOD_ID));
		t.check("Loader hat den Autotest geladen", mods.contains("heldix-autotest"));
		if (fabric) {
			t.check("Heldix Loader läuft als Fabric-Mod", fabricModLoaded("heldixloader"));
		} else {
			t.check("Fabric-Mod im mods-Ordner wird erkannt und übersprungen", problems.stream().anyMatch(p -> p.contains("Fabric-Mod")));
		}
		t.check("Keine fehlgeschlagenen Patches", problems.stream().noneMatch(p -> p.contains("Patch") || p.contains("nicht verändert")));
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
				t.compute(mc -> mc.gui.screen().children().stream().filter(child -> child instanceof StartCard).count() == 4));

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

		// Weg 1: Hauptmenü → Seitenleiste "Module" → Karte anklicken
		t.clickWidget("Module");
		t.waitTicks(10);
		clickTest(t, "Hauptmenü");
		t.setScreen(TitleScreen::new);
		t.waitForScreen(TitleScreen.class, 10);

		// --- Welt ---------------------------------------------------------------------------
		createFlatWorld(t);
		t.check("Welt-betreten-Event", joined);
		t.run(mc -> ModuleManager.all().forEach(m -> m.setEnabled(true)));
		t.run(mc -> mc.options.keyUp.setDown(true));
		t.waitTicks(10);
		t.screenshot("heldix-02-hud");
		t.run(mc -> mc.options.keyUp.setDown(false));

		t.serverCommand("tellraw @a \"Heldix-Autotest System\"");
		t.serverCommand("say Heldix-Autotest Say");
		t.waitSoft(mc -> CHAT.size() >= 2, 5);
		t.log("Chat " + CHAT);
		t.check("Chat-Event (Systemnachricht)", CHAT.stream().anyMatch(s -> s.startsWith("[System]") && s.contains("Heldix-Autotest System")));
		t.check("Chat-Event (/say)", CHAT.stream().anyMatch(s -> s.contains("Heldix-Autotest Say")));

		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(10);
		t.screenshot("heldix-03-heldix-menue");
		clickTest(t, "direkt geöffnet");

		int[] addonsTab = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).addonsTabCenter());
		t.click(addonsTab[0], addonsTab[1]);
		t.moveMouse(350, 235);
		t.waitTicks(5);
		t.screenshot("heldix-03b-addons");

		// Weg 2: im Spiel mit der Rechten Umschalttaste
		t.setScreen(() -> null);
		t.waitTicks(5);
		t.pressKey(InputConstants.KEY_RSHIFT);
		t.waitTicks(10);
		clickTest(t, "Rechte Umschalttaste");

		// Weg 3: Heldix-Pausemenü (ersetzt Minecrafts Pausemenü) → Seitenleiste "Module"
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
		t.waitTicks(5);
		t.screenshot("heldix-05-pausemenue");
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

		// Welt verlassen
		t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
		t.waitFor("Welt verlassen", mc -> mc.level == null && mc.gui.screen() instanceof TitleScreen, 60);
		t.check("Welt-verlassen-Event", left);

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
		t.setScreen(() -> titleScreen);
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
		t.waitTicks(5);
		t.check("Rechtsklick öffnet die Einstellungen des Elements", first.id().equals(t.compute(mc ->
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

	/** Shader-Stile, F3-Menü, FPS-Boost und Hintergrund-FPS in der Testwelt. */
	private static void graphicsTest(TestContext t) {
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(5);
		// Untermenü eines Moduls über das Regler-Symbol (erste Karte: FPS)
		int[] gear = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).settingsIconCenter(0));
		t.click(gear[0], gear[1]);
		t.check("Regler-Symbol öffnet das Untermenü des Moduls", "fps".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).openModuleId())));
		t.moveMouse(gear[0], gear[1]);
		t.waitTicks(5);
		t.screenshot("heldix-03e-untermenue");

		// HUD-Größe über die Einstellung des Moduls
		int normalWidth = t.compute(mc -> ModuleManager.hud().getFirst().width());
		t.run(mc -> sliderOf(ModuleManager.hud().getFirst(), "Größe").set().accept(1.5));
		t.setScreen(() -> null);
		t.waitTicks(3);
		int bigWidth = t.compute(mc -> ModuleManager.hud().getFirst().width());
		t.check("Größe des HUD-Elements (" + normalWidth + " → " + bigWidth + " px)", bigWidth >= normalWidth * 1.4);
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
		for (String name : new String[] {"PERFORMANCE", "SETTINGS"}) {
			int[] other = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabCenter(name));
			t.click(other[0], other[1]);
			t.moveMouse(other[0], other[1]);
			t.waitTicks(4);
			t.screenshot("heldix-03d-" + name.toLowerCase(java.util.Locale.ROOT));
		}
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
		int[] fps = t.compute(mc -> new int[] {Performance.framerateLimit(260), mc.isWindowActive() ? 1 : 0, mc.getFramerateLimitTracker().getFramerateLimit()});
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

	/** Klickt im offenen Heldix-Menü auf die erste Modul-Karte und prüft, dass sie umschaltet (und schaltet zurück). */
	private static void clickTest(TestContext t, String way) {
		String screen = t.compute(mc -> String.valueOf(mc.gui.screen()));
		t.check(way + ": Heldix-Menü ist offen", screen.contains("HeldixMenuScreen"));
		boolean before = t.compute(mc -> ModuleManager.all().getFirst().isEnabled());
		int[] card = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cardCenter(0));
		t.click(card[0], card[1]);
		boolean after = t.compute(mc -> ModuleManager.all().getFirst().isEnabled());
		t.check(way + ": Klick auf Karte schaltet das Modul um", before != after);
		t.click(card[0], card[1]);
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
		t.waitFor("Welt geladen", mc -> mc.level != null && mc.player != null && mc.gui.screen() == null, 180);
		if (!t.waitSoft(mc -> mc.levelRenderer.hasRenderedAllSections(), 30)) t.log("Nicht alle Chunks gezeichnet, mache trotzdem weiter");
		t.waitTicks(20);
		for (Module module : t.compute(mc -> ModuleManager.all())) t.log("Modul " + module.id());
	}
}
