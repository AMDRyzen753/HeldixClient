package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.addon.AddonCommands;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.GameInfo;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.PlayerState;
import dev.heldixclient.api.Registration;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.HudEditorScreen;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.multiplayer.chat.GuiMessage;

import java.lang.reflect.Field;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Autotest der Heldix-API 3 mit den echten Addons (Uhrzeit und Spotify): neue Einstellungen im Untermenü, die drei
 * Spotify-Darstellungen im HUD-Editor, Spiel- und Spielerdaten, Scheduler, Chat-Befehle (gehen nicht an den Server),
 * die Regel „Chat an den Server nur als Aktion des Spielers“ und die neuen Events.
 *
 * <p>Wichtig: Der Test steuert nie die echte Musik (kein Abspielen/Pause/Weiter) – auf dem Testrechner kann Spotify laufen.
 */
final class AddonApiTests {
	private AddonApiTests() {
	}

	private static LoadedAddon addon(TestContext t, String id) {
		LoadedAddon addon = t.compute(mc -> AddonManager.addons().stream().filter(a -> id.equals(a.id()) && a.isActive()).findFirst().orElse(null));
		t.check("Addon „" + id + "“ aktiv", addon != null && addon.api() != null);
		return addon;
	}

	private static Module module(TestContext t, String id) {
		Module module = t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null));
		t.check("Modul „" + id + "“ vorhanden", module != null);
		return module;
	}

	@SuppressWarnings("unchecked")
	private static <T extends Setting> T setting(Module module, Class<T> type, String label) {
		return (T) module.settings().stream().filter(s -> type.isInstance(s) && s.label().equals(label)).findFirst()
				.orElseThrow(() -> new AssertionError(module.id() + " hat keine Einstellung „" + label + "“ (" + type.getSimpleName() + ")"));
	}

	// ======================================================================================
	// Einstellungen: Regler, Farbe, Text (Uhrzeit-Addon)
	// ======================================================================================

	static void settings(TestContext t) {
		Module clock = module(t, "uhrzeit:uhrzeit");
		Module playtime = module(t, "uhrzeit:spielzeit");
		Setting.Color color = t.compute(mc -> setting(clock, Setting.Color.class, "Farbe"));
		Setting.Text label = t.compute(mc -> setting(clock, Setting.Text.class, "Beschriftung"));
		Setting.Slider pause = t.compute(mc -> setting(playtime, Setting.Slider.class, "Pausen-Erinnerung"));
		t.check("Regler mit eigenem Text (0 → „" + pause.format().apply(0) + "“, 30 → „" + pause.format().apply(30) + "“)",
				"Aus".equals(pause.format().apply(0)) && "30 min".equals(pause.format().apply(30)));
		t.check("Textfeld mit Standardwert „Uhr“", "Uhr".equals(t.compute(mc -> label.get().get())));
		int defaultColor = color.defaultColor();

		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.MODULES, clock));
		t.waitTicks(5);
		t.check("Untermenü der Uhrzeit offen", "uhrzeit:uhrzeit".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).openModuleId())));
		// Farbe: Klick klappt die Palette auf, Klick auf ein Feld wählt die Farbe
		int[] swatchControl = center(t, "Farbe");
		t.click(swatchControl[0], swatchControl[1]);
		t.waitTicks(3);
		int red = 0xFFF87171;
		int index = color.palette().indexOf(red);
		int[] swatch = center(t, "Farbe#" + index);
		t.moveMouse(swatch[0], swatch[1]);
		t.waitTicks(3);
		t.screenshot("heldix-api3-01-farbe");
		t.click(swatch[0], swatch[1]);
		t.check("Farbe aus der Palette gewählt", t.compute(mc -> color.get().getAsInt()) == red);

		// Text: im kleinen Testfenster erst die Zeile ins Bild scrollen, dann ins Feld klicken, „Uhr“ löschen, „Zeit“ tippen
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToSetting("Beschriftung"));
		t.waitTicks(3);
		int[] field = center(t, "Beschriftung");
		t.click(field[0], field[1]);
		t.log("Textfeld bei " + field[0] + "," + field[1] + " fokussiert: " + t.compute(mc -> String.valueOf(mc.gui.screen().getFocused())));
		t.screenshot("heldix-api3-01b-textfeld");
		for (int i = 0; i < 3; i++) t.pressKey(InputConstants.KEY_BACKSPACE);
		for (char c : "Zeit".toCharArray()) {
			t.run(mc -> mc.keyboardHandler.charTyped(mc.getWindow().handle(), new CharacterEvent(c)));
			t.waitTicks(1);
		}
		t.waitTicks(3);
		t.check("Textfeld: getippter Text gespeichert („" + t.compute(mc -> label.get().get()) + "“)", "Zeit".equals(t.compute(mc -> label.get().get())));
		t.check("Rücktaste im Textfeld schließt das Untermenü nicht", "uhrzeit:uhrzeit".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).openModuleId())));
		t.screenshot("heldix-api3-02-text");

		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.MODULES, playtime));
		t.waitTicks(5);
		int[] slider = center(t, "Pausen-Erinnerung");
		t.click(slider[0], slider[1]);
		t.waitTicks(2);
		double value = t.compute(mc -> pause.get().getAsDouble());
		t.check("Regler per Klick gesetzt (" + value + ")", value > 0 && value <= 120 && value % 15 == 0);
		t.screenshot("heldix-api3-03-regler");

		// HUD mit roter Uhr und eigener Beschriftung, danach alles zurück
		t.setScreen(() -> null);
		t.waitTicks(5);
		t.screenshot("heldix-api3-04-hud-uhr");
		t.run(mc -> {
			color.set().accept(defaultColor);
			label.set().accept("Uhr");
			pause.set().accept(0);
		});
	}

	private static int[] center(TestContext t, String label) {
		int[] center = t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.settingCenter(label) : null);
		if (center == null) throw new AssertionError("Einstellung „" + label + "“ ist nicht zu sehen");
		return center;
	}

	// ======================================================================================
	// Spotify: drei Darstellungen im HUD-Editor
	// ======================================================================================

	static void spotifyLayouts(TestContext t) {
		LoadedAddon spotify = addon(t, "spotify");
		Module module = module(t, "spotify:spotify");
		int errors = t.compute(mc -> spotify.errorCount());
		Setting.Choice layout = t.compute(mc -> setting(module, Setting.Choice.class, "Darstellung"));
		Setting.Choice accent = t.compute(mc -> setting(module, Setting.Choice.class, "Akzentfarbe"));
		t.check("Spotify: drei Darstellungen", layout.options().equals(List.of("Kompakt", "Groß mit Cover", "Nur Titel")));
		// HeldixKeys (GLFW-Codes) werden in die SDL-Tasten von 26.x übersetzt; NONE = frei (früher Absturz)
		String playKey = t.compute(mc -> java.util.Arrays.stream(mc.options.keyMappings).filter(k -> k.getName().equals("Spotify – Abspielen/Pause"))
				.map(k -> k.getDefaultKey().getName() + "/" + k.saveString()).findFirst().orElse("-"));
		t.check("Spotify-Taste Abspielen/Pause ist Pos1 (" + playKey + ")", "key.keyboard.home/key.keyboard.home".equals(playKey));
		t.check("Neue Spotify-Tasten sind frei", t.compute(mc -> java.util.Arrays.stream(mc.options.keyMappings)
				.filter(k -> k.getName().startsWith("Spotify – ") && List.of("10 Sekunden vor", "10 Sekunden zurück", "Zufallswiedergabe", "Wiederholen",
						"Song im Chat teilen").contains(k.getName().substring("Spotify – ".length())))
				.filter(net.minecraft.client.KeyMapping::isUnbound).count()) == 5);
		t.run(mc -> module.setEnabled(true));
		t.setScreen(() -> new HudEditorScreen(null));
		t.waitTicks(5);
		HudModule hud = (HudModule) module;
		int[][] sizes = new int[3][];
		String[] names = {"kompakt", "gross", "titel"};
		for (int i = 0; i < 3; i++) {
			int choice = i;
			t.run(mc -> layout.set().accept(choice));
			if (i == 1) t.run(mc -> accent.set().accept(1));
			t.waitTicks(6);
			sizes[i] = t.compute(mc -> new int[] {hud.width(), hud.height()});
			t.log("Spotify " + names[i] + ": " + sizes[i][0] + "x" + sizes[i][1] + " (" + t.compute(mc -> layout.current()) + ")");
			t.screenshot("heldix-api3-1" + i + "-spotify-" + names[i]);
		}
		t.run(mc -> {
			layout.set().accept(0);
			accent.set().accept(0);
		});
		t.check("Spotify-Darstellungen ohne Fehler (" + t.compute(mc -> spotify.errorCount()) + " Fehler)",
				t.compute(mc -> spotify.errorCount()) == errors && t.compute(mc -> spotify.isActive()));
		t.check("Groß ist höher als Kompakt (" + sizes[1][1] + " > " + sizes[0][1] + ")", sizes[1][1] > sizes[0][1]);
		t.check("Nur Titel ist eine Zeile (" + sizes[2][1] + " px)", sizes[2][1] < sizes[0][1] && sizes[2][1] > 0);
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Daten, Scheduler, Chat-Befehle, Chat an den Server, Events
	// ======================================================================================

	static void api(TestContext t) {
		t.setScreen(() -> null);
		LoadedAddon uhrzeit = addon(t, "uhrzeit");
		HeldixApi api = uhrzeit.api();
		t.check("Heldix-API " + HeldixApi.API_VERSION + " (mindestens 1)", HeldixApi.API_VERSION >= 11 && AddonManager.MIN_API == 1);
		int errorsBefore = t.compute(mc -> uhrzeit.errorCount());

		// --- Spiel- und Spielerdaten ------------------------------------------------------
		t.serverCommand("item replace entity @p weapon.mainhand with minecraft:diamond_sword");
		t.serverCommand("effect give @p minecraft:speed 60 1");
		t.waitTicks(10);
		GameInfo game = t.compute(mc -> api.game());
		t.log("game(): fps " + game.fps() + ", ping " + game.ping() + ", Zeit " + game.timeOfDay() + ", Wetter " + game.weather() + ", Menü „" + game.screen() + "“");
		t.check("game(): Einzelspieler-Welt", game.inWorld() && game.singleplayer() && !game.multiplayer() && game.serverAddress().isEmpty());
		t.check("game(): Tageszeit und Wetter", game.timeOfDay() >= 0 && game.timeOfDay() < 24000 && List.of("clear", "rain", "thunder").contains(game.weather()));
		t.check("game(): kein Menü offen, HUD sichtbar", game.screen().isEmpty() && !game.hudHidden() && game.fps() >= 0);
		PlayerState state = t.compute(mc -> api.playerState().orElse(null));
		t.check("playerState() in der Welt", state != null);
		t.log("playerState(): " + state.name() + " " + state.gameMode() + ", Hand " + state.mainHand() + ", Effekte " + state.effects()
				+ ", Blick " + state.facing() + " " + Math.round(state.yaw()) + "°, Tempo " + state.speed());
		t.check("playerState(): Name, Spielmodus, Leben", "HeldixTester".equals(state.name()) && "creative".equals(state.gameMode())
				&& state.maxHealth() == 20f && state.uuid().length() == 36);
		t.check("playerState(): Item in der Hand mit Haltbarkeit", "minecraft:diamond_sword".equals(state.mainHand().id())
				&& state.mainHand().hasDurability() && state.offHand().isEmpty());
		t.check("playerState(): Trank-Effekt Schnelligkeit II", state.effects().stream().anyMatch(e -> e.id().equals("minecraft:speed") && e.level() == 2));
		t.check("playerState(): Rüstung als vier Slots, Himmelsrichtung", state.armorItems().size() == 4
				&& List.of("north", "east", "south", "west").contains(state.facing()));
		t.check("game() aus einem anderen Thread (Stand des letzten Ticks)", api.game().inWorld() && api.playerState().isPresent());

		// --- Scheduler -----------------------------------------------------------------------
		AtomicInteger later = new AtomicInteger();
		AtomicInteger repeat = new AtomicInteger();
		AtomicReference<String> asyncThread = new AtomicReference<>();
		AtomicBoolean backOnMain = new AtomicBoolean();
		Registration laterTask = api.scheduler().runLater(10, later::incrementAndGet);
		Registration repeating = api.scheduler().runRepeating(0, 2, repeat::incrementAndGet);
		api.scheduler().runAsync(() -> {
			asyncThread.set(Thread.currentThread().getName());
			api.scheduler().runOnMainThread(() -> backOnMain.set(api.scheduler().isMainThread()));
		});
		t.waitTicks(4);
		t.check("runLater wartet noch", later.get() == 0 && laterTask.isActive());
		t.waitTicks(12);
		t.check("runLater nach 10 Ticks genau einmal", later.get() == 1 && !laterTask.isActive());
		int counted = repeat.get();
		t.check("runRepeating alle 2 Ticks (" + counted + "×)", counted >= 5);
		repeating.cancel();
		t.waitTicks(6);
		t.check("runRepeating abgebrochen", repeat.get() <= counted + 1 && !repeating.isActive());
		t.waitSoft(mc -> backOnMain.get(), 5);
		t.check("runAsync im Hintergrund-Thread („" + asyncThread.get() + "“)", asyncThread.get() != null && asyncThread.get().startsWith("Heldix-Addon-"));
		t.check("runOnMainThread im Haupt-Thread", backOnMain.get());

		// --- Chat an den Server nur als Aktion des Spielers -------------------------------
		t.check("sendChatMessage im Haupt-Thread ohne Aktion abgelehnt", rejected(() -> t.run(mc -> api.sendChatMessage("Heldix-Autotest unerlaubt 1"))));
		t.check("sendChatMessage aus einem anderen Thread abgelehnt", rejected(() -> api.sendChatMessage("Heldix-Autotest unerlaubt 2")));
		api.scheduler().runLater(0, () -> api.sendChatMessage("Heldix-Autotest unerlaubt 3"));
		t.waitTicks(10);
		t.check("Chat aus dem Scheduler abgelehnt und als Addon-Fehler gezählt (" + t.compute(mc -> uhrzeit.errorCount()) + ")",
				t.compute(mc -> uhrzeit.errorCount()) == errorsBefore + 1 && t.compute(mc -> uhrzeit.isActive()));
		t.check("Nichts Unerlaubtes kam beim Server an", AutoTest.CHAT.stream().noneMatch(s -> s.contains("Heldix-Autotest unerlaubt")));

		// --- Chat-Befehle --------------------------------------------------------------------
		List<String> names = t.compute(mc -> AddonCommands.names());
		t.log("Addon-Befehle " + names);
		t.check("Befehle .np, .spotify und .uhr registriert", names.containsAll(List.of("np", "spotify", "uhr")));
		submit(t, ".uhr");
		t.check(".uhr antwortet im eigenen Chat", local(t, 6).stream().anyMatch(s -> s.contains("[Uhrzeit & Spielzeit] Es ist")));
		t.check(".uhr geht nicht an den Server", AutoTest.CHAT.stream().noneMatch(s -> s.contains(".uhr")));
		t.check(".uhr steht im Chat-Verlauf (Pfeil hoch)", t.compute(mc -> mc.gui.hud.getChat().getRecentChat().contains(".uhr")));
		submit(t, ".hilfe");
		List<String> help = local(t, 12);
		t.check(".hilfe listet die Addon-Befehle", help.stream().anyMatch(s -> s.contains("Addon-Befehle"))
				&& help.stream().anyMatch(s -> s.contains(".np [teilen]")) && help.stream().anyMatch(s -> s.contains(".uhr [teilen]")));
		submit(t, ".np");
		t.check(".np antwortet nur lokal", local(t, 4).stream().anyMatch(s -> s.contains("[Spotify] ")) && AutoTest.CHAT.stream().noneMatch(s -> s.contains(".np")));

		// Tab ergänzt, Vorschläge über dem Eingabefeld
		t.setScreen(() -> new ChatScreen("", false));
		t.waitTicks(3);
		setInput(t, ".sp");
		t.pressKey(InputConstants.KEY_TAB);
		t.check("Tab ergänzt „.sp“ zu „.spotify“ (" + input(t) + ")", ".spotify".equals(input(t)));
		setInput(t, ".");
		t.waitTicks(3);
		t.screenshot("heldix-api3-20-befehle");
		t.setScreen(() -> null);

		// Text mit Punkt, der kein Befehl ist, geht ganz normal an den Server
		submit(t, ".kein-befehl Heldix-Autotest");
		t.waitSoft(mc -> AutoTest.CHAT.stream().anyMatch(s -> s.contains(".kein-befehl Heldix-Autotest")), 5);
		t.check("Kein Addon-Befehl: Text geht an den Server", AutoTest.CHAT.stream().anyMatch(s -> s.contains(".kein-befehl Heldix-Autotest")));
		// Befehl als Aktion des Spielers: darf genau eine Nachricht senden
		submit(t, ".uhr teilen");
		t.waitSoft(mc -> AutoTest.CHAT.stream().anyMatch(s -> s.contains("Bei mir ist es")), 5);
		t.check(".uhr teilen schickt die Uhrzeit an den Server", AutoTest.CHAT.stream().anyMatch(s -> s.contains("Bei mir ist es")));
		AtomicBoolean first = new AtomicBoolean();
		AtomicBoolean secondBlocked = new AtomicBoolean();
		Registration twice = t.compute(mc -> api.registerCommand("autotest-zweimal", "", "nur für den Autotest", command -> {
			first.set(api.sendChatMessage("Heldix-Autotest eins"));
			try {
				api.sendChatMessage("Heldix-Autotest zwei");
			} catch (IllegalStateException expected) {
				secondBlocked.set(true);
			}
		}));
		submit(t, ".autotest-zweimal");
		t.waitSoft(mc -> AutoTest.CHAT.stream().anyMatch(s -> s.contains("Heldix-Autotest eins")), 5);
		t.waitTicks(10);
		t.check("Pro Aktion höchstens eine Nachricht an den Server", first.get() && secondBlocked.get()
				&& AutoTest.CHAT.stream().anyMatch(s -> s.contains("Heldix-Autotest eins")) && AutoTest.CHAT.stream().noneMatch(s -> s.contains("Heldix-Autotest zwei")));
		twice.cancel();
		t.check("Befehl abgemeldet", !t.compute(mc -> AddonCommands.names()).contains("autotest-zweimal") && !twice.isActive());

		// --- Events --------------------------------------------------------------------------
		List<String> events = new CopyOnWriteArrayList<>();
		List<Registration> listeners = t.compute(mc -> List.of(
				api.events().onScreenOpen(kind -> events.add("open:" + kind)),
				api.events().onScreenClose(kind -> events.add("close:" + kind)),
				api.events().onDeath(() -> events.add("death")),
				api.events().onRespawn(() -> events.add("respawn")),
				api.events().onDimensionChange(dimension -> events.add("dimension:" + dimension)),
				api.events().onHealthChange((previous, current) -> events.add(current < previous ? "damage" : "heal")),
				api.events().onServerJoin(address -> events.add("server:" + address))));
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(3);
		t.setScreen(() -> new ChatScreen("", false));
		t.waitTicks(3);
		t.check("game().screen() bei offenem Chat", "chat".equals(t.compute(mc -> api.game().screen())));
		t.setScreen(() -> null);
		t.waitTicks(3);
		t.log("Events " + events);
		t.check("onScreenOpen/onScreenClose (heldix, chat)", events.containsAll(List.of("open:heldix", "close:heldix", "open:chat", "close:chat"))
				&& events.indexOf("close:heldix") < events.indexOf("open:chat"));

		t.serverCommand("gamemode survival @p");
		t.waitTicks(5);
		t.serverCommand("damage @p 4 minecraft:generic");
		t.waitSoft(mc -> events.contains("damage"), 5);
		t.check("onHealthChange bei Schaden", events.contains("damage"));
		t.serverCommand("kill @p");
		t.waitSoft(mc -> events.contains("death"), 10);
		t.check("onDeath", events.contains("death"));
		t.waitSoft(mc -> "death".equals(api.game().screen()), 5);
		t.check("Todesbildschirm als Menü „death“", events.contains("open:death"));
		t.run(mc -> mc.player.respawn());
		t.waitSoft(mc -> events.contains("respawn"), 15);
		t.check("onRespawn", events.contains("respawn"));
		t.run(mc -> mc.gui.setScreen(null));
		t.serverCommand("gamemode creative @p");
		t.waitTicks(5);

		t.serverCommand("execute in minecraft:the_nether run tp HeldixTester 0 100 0");
		t.waitSoft(mc -> events.contains("dimension:the_nether"), 30);
		t.check("onDimensionChange (Nether)", events.contains("dimension:the_nether"));
		t.waitFor("Nether geladen", mc -> mc.level != null && mc.player != null && mc.gui.screen() == null, 60);
		t.serverCommand("execute in minecraft:overworld run tp HeldixTester 0 -60 0");
		t.waitSoft(mc -> events.contains("dimension:overworld"), 30);
		t.check("onDimensionChange (zurück in die Oberwelt)", events.contains("dimension:overworld"));
		t.waitFor("Oberwelt geladen", mc -> mc.level != null && mc.player != null && mc.gui.screen() == null, 60);
		t.check("onServerJoin kommt im Einzelspieler nicht", events.stream().noneMatch(s -> s.startsWith("server:")));

		// abmelden: danach kommt nichts mehr an
		listeners.forEach(Registration::cancel);
		events.clear();
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(3);
		t.setScreen(() -> null);
		t.waitTicks(3);
		t.check("Abgemeldete Listener bekommen nichts mehr", events.isEmpty() && listeners.stream().noneMatch(Registration::isActive));
		t.check("Keine weiteren Addon-Fehler (" + t.compute(mc -> uhrzeit.errorCount()) + ")", t.compute(mc -> uhrzeit.errorCount()) == errorsBefore + 1);
	}

	private static boolean rejected(Runnable action) {
		try {
			action.run();
			return false;
		} catch (IllegalStateException expected) {
			return true;
		}
	}

	// --- Chat ----------------------------------------------------------------------------------

	/** Text wie ein Spieler eintippen und mit Enter abschicken (echter Weg über ChatScreen.keyPressed) */
	private static void submit(TestContext t, String text) {
		t.setScreen(() -> new ChatScreen("", false));
		t.waitTicks(2);
		setInput(t, text);
		t.pressKey(InputConstants.KEY_RETURN);
		t.waitTicks(8);
		t.run(mc -> {
			if (mc.gui.screen() instanceof ChatScreen) mc.gui.setScreen(null);
		});
		t.waitTicks(2);
	}

	private static EditBox inputBox(Minecraft mc) {
		try {
			Field field = ChatScreen.class.getDeclaredField("input");
			field.setAccessible(true);
			return (EditBox) field.get(mc.gui.screen());
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}

	private static void setInput(TestContext t, String text) {
		t.run(mc -> inputBox(mc).setValue(text));
		t.waitTicks(1);
	}

	private static String input(TestContext t) {
		return t.compute(mc -> inputBox(mc).getValue());
	}

	/** die neuesten Zeilen im eigenen Chat (auch lokale Meldungen der Addons) */
	@SuppressWarnings("unchecked")
	private static List<String> local(TestContext t, int count) {
		return t.compute(mc -> {
			try {
				Field field = ChatComponent.class.getDeclaredField("allMessages");
				field.setAccessible(true);
				List<GuiMessage> messages = (List<GuiMessage>) field.get(mc.gui.hud.getChat());
				return messages.stream().limit(count).map(m -> m.content().getString()).toList();
			} catch (ReflectiveOperationException e) {
				throw new IllegalStateException(e);
			}
		});
	}
}
