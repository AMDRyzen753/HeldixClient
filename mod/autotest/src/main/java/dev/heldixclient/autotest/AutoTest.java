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
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.HeldixNavButton;
import dev.heldixclient.screen.HudEditorScreen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.client.gui.screens.worldselection.WorldCreationUiState;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
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
		ClientEvents.TICK_END.register(minecraft -> test.tick());
		WorldEvents.JOIN.register(minecraft -> joined = true);
		WorldEvents.LEAVE.register(minecraft -> left = true);
		ChatEvents.RECEIVE.register((message, fromPlayer) -> CHAT.add((fromPlayer ? "[Spieler] " : "[System] ") + message.getString()));

		Thread thread = new Thread(() -> {
			try {
				scenario(test);
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
		t.log("Mods " + mods + ", Probleme " + problems);
		t.check("Loader hat HeldixClient geladen", mods.contains(HeldixClient.MOD_ID));
		t.check("Loader hat den Autotest geladen", mods.contains("heldix-autotest"));
		t.check("Fabric-Mod im mods-Ordner wird erkannt und übersprungen", problems.stream().anyMatch(p -> p.contains("Fabric-Mod")));
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
		t.check("Hauptmenü ist das Heldix-Hauptmenü",
				t.compute(mc -> mc.gui.screen().children().stream().anyMatch(child -> child instanceof HeldixNavButton)));

		// --- Heldix-Addons ----------------------------------------------------------------
		String addons = t.compute(mc -> AddonManager.addons().stream()
				.map(a -> a.name() + "=" + a.state() + (a.error() != null ? " (" + a.error() + ")" : ""))
				.toList().toString());
		t.log("Addons " + addons);
		t.check("Uhrzeit-Addon aktiv", addons.contains("Uhrzeit & Spielzeit=ACTIVE"));
		t.check("Kaputtes Addon als Fehler erkannt", addons.contains("Kaputtes Test-Addon=FAILED"));
		t.check("Module des Uhrzeit-Addons vorhanden",
				t.compute(mc -> ModuleManager.all().stream().anyMatch(m -> "uhrzeit:uhrzeit".equals(m.id()))));

		int[] multiplayer = t.widgetCenter(w -> w.getMessage().getString().equals("Mehrspieler"), "Mehrspieler");
		t.moveMouse(multiplayer[0], multiplayer[1]);
		t.screenshot("heldix-01-hauptmenue");

		// Weg 1: Hauptmenü → "Heldix-Menü" → Karte anklicken
		t.clickWidget("Heldix-Menü");
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

		// Weg 3: Button im Pausemenü (kommt über ScreenEvents.AFTER_INIT des Loaders)
		t.setScreen(() -> new PauseScreen(true));
		t.waitTicks(5);
		t.clickWidget("Heldix-Menü");
		t.waitTicks(10);
		clickTest(t, "Pausemenü");

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

		t.setScreen(() -> new PauseScreen(true));
		t.waitTicks(5);
		t.screenshot("heldix-05-pausemenue");
		t.setScreen(() -> null);

		// Zoom mit Bezugsobjekt in Blickrichtung (Süden)
		t.serverCommand("fill -3 -60 40 3 -50 40 minecraft:purple_concrete");
		t.serverCommand("fill -1 -50 40 1 -48 40 minecraft:amethyst_block");
		t.waitTicks(40);
		t.run(mc -> HeldixClient.zoomKey.setDown(true));
		t.waitTicks(20);
		float fov = t.compute(mc -> mc.gameRenderer.mainCamera().getFov());
		t.check("Zoom wirkt (Sichtfeld " + fov + ")", fov < 30f);
		t.screenshot("heldix-06-zoom");
		t.run(mc -> HeldixClient.zoomKey.setDown(false));

		// Welt verlassen
		t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
		t.waitFor("Welt verlassen", mc -> mc.level == null && mc.gui.screen() instanceof TitleScreen, 60);
		t.check("Welt-verlassen-Event", left);

		// Die übrigen Menüs im Heldix-Design
		Screen titleScreen = t.compute(mc -> mc.gui.screen());
		t.setScreen(() -> new SelectWorldScreen(titleScreen));
		t.waitTicks(20);
		int[] size = t.compute(mc -> new int[] {mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight()});
		t.click(size[0] / 2.0, 67);
		int[] create = t.widgetCenter(w -> w.getMessage().getContents() instanceof net.minecraft.network.chat.contents.TranslatableContents c && c.getKey().equals("selectWorld.create"), "selectWorld.create");
		t.moveMouse(create[0], create[1]);
		t.waitTicks(5);
		t.screenshot("heldix-07-einzelspieler");

		t.setScreen(() -> new JoinMultiplayerScreen(titleScreen));
		t.waitTicks(10);
		t.screenshot("heldix-08-mehrspieler");

		t.setScreen(() -> new OptionsScreen(titleScreen, Minecraft.getInstance().options));
		t.waitTicks(10);
		t.screenshot("heldix-09-optionen");
		t.setScreen(() -> titleScreen);
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
