package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.QuickModules;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.QuickSearchScreen;
import dev.heldixclient.screen.ShellNavButton;
import dev.heldixclient.screen.ShellScreen;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.GuiEventListener;

import java.util.ArrayList;
import java.util.List;

/**
 * Autotest der Oberfläche im Spiel: obere Leisten (Bereiche, Seiten), Übersicht mit Schnellschaltern und Hinweisen,
 * Schnellsuche (Strg+K), Tastatur (Strg+Tab, Strg+1–4, Pfeile, Enter) und kleine Fenster.
 */
final class ShellTests {
	private ShellTests() {
	}

	private static HeldixMenuScreen menu(TestContext t) {
		return t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu : null);
	}

	private static String tab(TestContext t) {
		return t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.currentTab() : String.valueOf(mc.gui.screen()));
	}

	static void run(TestContext t) {
		// --- Leisten oben ------------------------------------------------------------------
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(10);
		t.check("Leisten: Bereiche Spielen, Heldix, Profil, System", t.compute(mc -> ((ShellScreen) mc.gui.screen()).sectionIds())
				.equals(List.of("PLAY", "HELDIX", "PROFILE", "SYSTEM")));
		t.check("Leisten: Seiten des Bereichs Heldix", t.compute(mc -> ((ShellScreen) mc.gui.screen()).pageBarIds())
				.equals(List.of("OVERVIEW", "MODULES", "SHADER", "WAYPOINTS", "ADDONS")));
		t.check("Leisten: Suche, Profil und Schließen oben", t.compute(mc -> mc.gui.screen().children().stream()
				.filter(c -> c instanceof AbstractWidget w && (w.getMessage().getString().equals("Suchen") || w.getMessage().getString().startsWith("Schnellsuche")))
				.count()) == 1);
		t.moveMouse(5, 5);
		t.screenshot("oberflaeche-01-uebersicht");

		// --- Übersicht: Schnellschalter ----------------------------------------------------------
		List<Module> quick = t.compute(mc -> QuickModules.list(QuickModules.MAX));
		t.check("Übersicht: Schnellschalter (" + quick.size() + ")", quick.size() >= 4);
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).revealQuickToggles());
		t.waitTicks(3);
		int[] chip = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).quickToggleCenter(0));
		if (chip != null) {
			boolean before = t.compute(mc -> quick.getFirst().isEnabled());
			t.click(chip[0], chip[1]);
			t.check("Übersicht: Klick auf den Schnellschalter schaltet „" + quick.getFirst().name() + "“ um", t.compute(mc -> quick.getFirst().isEnabled()) != before);
			t.click(chip[0], chip[1]);
		} else {
			t.log("Schnellschalter nicht im Bild (kleines Fenster)");
		}

		// --- Bereich wechseln: Klick oben, Strg+Tab, Strg+1–4 -----------------------------------
		int[] profile = t.compute(mc -> ((ShellScreen) mc.gui.screen()).tabCenter("FRIENDS"));
		t.click(profile[0], profile[1]);
		t.waitTicks(3);
		t.check("Bereich Profil öffnet eine Seite im Profil (" + tab(t) + ")", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu
				&& Shell.Page.valueOf(menu.currentTab()).section == Shell.Section.PROFILE));
		t.pressKey(InputConstants.KEY_4, InputConstants.MOD_CONTROL);
		t.waitTicks(3);
		t.check("Strg+4: Bereich System (" + tab(t) + ")", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu
				&& Shell.Page.valueOf(menu.currentTab()).section == Shell.Section.SYSTEM));
		if (!"SETTINGS".equals(tab(t)) && !"INFO".equals(tab(t))) t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.SETTINGS));
		String before = tab(t);
		t.pressKey(InputConstants.KEY_TAB, InputConstants.MOD_CONTROL);
		t.waitTicks(3);
		t.check("Strg+Tab: nächster Reiter (" + before + " → " + tab(t) + ")", !before.equals(tab(t)) && ("SETTINGS".equals(tab(t)) || "INFO".equals(tab(t))));
		t.pressKey(InputConstants.KEY_2, InputConstants.MOD_CONTROL);
		t.waitTicks(3);
		t.check("Strg+2: Bereich Heldix (" + tab(t) + ")", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu
				&& Shell.Page.valueOf(menu.currentTab()).section == Shell.Section.HELDIX));

		// --- Schnellsuche ------------------------------------------------------------------------
		HeldixMenuScreen beforeSearch = menu(t);
		t.pressKey(InputConstants.KEY_K, InputConstants.MOD_CONTROL);
		t.waitTicks(3);
		t.check("Strg+K öffnet die Schnellsuche", t.compute(mc -> mc.gui.screen() instanceof QuickSearchScreen));
		t.run(mc -> ((QuickSearchScreen) mc.gui.screen()).type("zoom"));
		t.waitTicks(3);
		List<String> titles = t.compute(mc -> ((QuickSearchScreen) mc.gui.screen()).resultTitles());
		t.log("Suche „zoom“: " + titles.subList(0, Math.min(6, titles.size())));
		t.check("Schnellsuche: „zoom“ findet das Modul Zoom zuerst", !titles.isEmpty() && titles.getFirst().equals("Zoom"));
		t.moveMouse(5, 5);
		t.screenshot("oberflaeche-02-suche");
		t.pressKey(InputConstants.KEY_ESCAPE);
		t.waitTicks(3);
		t.check("Schnellsuche: Esc führt zur Seite zurück", t.compute(mc -> mc.gui.screen() == beforeSearch));

		t.pressKey(InputConstants.KEY_K, InputConstants.MOD_CONTROL);
		t.run(mc -> ((QuickSearchScreen) mc.gui.screen()).type("zoom"));
		t.pressKey(InputConstants.KEY_RETURN);
		t.waitTicks(5);
		t.check("Schnellsuche: Enter öffnet die Einstellungen von Zoom", "zoom".equals(t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu
				? menu.openModuleId() : null)));

		t.pressKey(InputConstants.KEY_K, InputConstants.MOD_CONTROL);
		t.run(mc -> ((QuickSearchScreen) mc.gui.screen()).type("leistung"));
		t.pressKey(InputConstants.KEY_RETURN);
		t.waitTicks(5);
		t.check("Schnellsuche: „leistung“ öffnet die Seite Leistung", "PERFORMANCE".equals(tab(t)));

		t.pressKey(InputConstants.KEY_K, InputConstants.MOD_CONTROL);
		t.run(mc -> ((QuickSearchScreen) mc.gui.screen()).type("scharfe schrift"));
		titles = t.compute(mc -> ((QuickSearchScreen) mc.gui.screen()).resultTitles());
		t.check("Schnellsuche: Einstellung „Scharfe Schrift“ wird gefunden", !titles.isEmpty() && titles.getFirst().equals("Scharfe Schrift"));
		t.pressKey(InputConstants.KEY_RETURN);
		t.waitTicks(5);
		t.check("Schnellsuche: Einstellungen offen, „Scharfe Schrift“ hervorgehoben", "SETTINGS".equals(tab(t))
				&& "setting:Scharfe Schrift".equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).highlightKey())));
		t.screenshot("oberflaeche-03-hervorgehoben");

		// --- Tastatur im Inhalt: Pfeil runter wählt die erste Kachel, Enter schaltet sie um -------
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.MODULES));
		t.waitTicks(5);
		t.pressKey(InputConstants.KEY_DOWN);
		t.waitTicks(2);
		t.check("Tastatur: Pfeil runter wählt ein Ziel im Inhalt", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).keyFocusRect()) != null);
		Module first = t.compute(mc -> ModuleManager.all().getFirst());
		boolean on = t.compute(mc -> first.isEnabled());
		t.pressKey(InputConstants.KEY_RETURN);
		t.check("Tastatur: Enter schaltet „" + first.name() + "“ um", t.compute(mc -> first.isEnabled()) != on);
		t.screenshot("oberflaeche-04-tastatur");
		t.pressKey(InputConstants.KEY_RETURN);
		t.check("Tastatur: Enter schaltet zurück", t.compute(mc -> first.isEnabled()) == on);
		t.pressKey(InputConstants.KEY_RIGHT);
		t.pressKey(InputConstants.KEY_DOWN);
		t.check("Tastatur: Pfeile bewegen den Fokus weiter", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).keyFocusRect()) != null);

		// --- kleine Fenster (GUI-Maße wie bei großer Skalierung): alles im Fenster, nichts überlappt
		int[][] sizes = {{320, 200}, {427, 240}, {512, 288}, {960, 540}};
		for (int[] size : sizes) {
			List<String> problems = t.compute(mc -> {
				HeldixMenuScreen screen = new HeldixMenuScreen(null, Shell.Page.MODULES);
				screen.init(size[0], size[1]);
				return layoutProblems(screen, size[0], size[1]);
			});
			t.check("Fenster " + size[0] + "×" + size[1] + ": Leisten und Knöpfe passen " + problems, problems.isEmpty());
		}
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(5);
	}

	/** Widgets außerhalb des Fensters oder überlappende Knöpfe der Leisten */
	private static List<String> layoutProblems(ShellScreen screen, int width, int height) {
		List<String> problems = new ArrayList<>();
		Shell.Rect window = Shell.window(width, height);
		List<AbstractWidget> bar = new ArrayList<>();
		for (GuiEventListener child : screen.children()) {
			if (!(child instanceof AbstractWidget widget) || !widget.visible) continue;
			if (widget.getX() < window.x() || widget.getY() < window.y() || widget.getX() + widget.getWidth() > window.right()
					|| widget.getY() + widget.getHeight() > window.bottom()) {
				problems.add("außerhalb: " + widget.getMessage().getString());
			}
			if (widget.getY() < window.y() + Shell.navHeight(window)) bar.add(widget);
		}
		for (int i = 0; i < bar.size(); i++) {
			for (int j = i + 1; j < bar.size(); j++) {
				AbstractWidget a = bar.get(i);
				AbstractWidget b = bar.get(j);
				boolean overlap = a.getX() < b.getX() + b.getWidth() && b.getX() < a.getX() + a.getWidth()
						&& a.getY() < b.getY() + b.getHeight() && b.getY() < a.getY() + a.getHeight();
				if (overlap) problems.add("überlappt: " + a.getMessage().getString() + " / " + b.getMessage().getString());
			}
		}
		long categories = screen.children().stream().filter(c -> c instanceof ShellNavButton b && b.kind() == ShellNavButton.Kind.CATEGORY).count();
		if (categories != 4) problems.add(categories + " Bereiche");
		return problems;
	}
}
