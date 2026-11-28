package dev.heldixclient.autotest;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudClick;
import dev.heldixclient.api.HudHover;
import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.HudStyle;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.hud.HudAnchor;
import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.hud.HudStyles;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.module.impl.ChatModule;
import dev.heldixclient.module.impl.WaypointsModule;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.HudEditorScreen;
import dev.heldixclient.screen.HudInteractScreen;
import dev.heldixclient.ui.ContextMenu;
import dev.heldixclient.waypoint.Waypoints;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.multiplayer.chat.GuiMessage;
import net.minecraft.network.chat.Component;
import net.minecraft.world.phys.HitResult;

import java.lang.reflect.Field;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.IntSupplier;

/**
 * Autotest des überarbeiteten HUD: Stile, Bezugspunkte über GUI-Skalierungen und Fenstergrößen, HUD-Editor (Einrasten
 * mit Hilfslinien, Mehrfachauswahl, Rahmen, Pfeiltasten, Rückgängig/Wiederholen, Rechtsklick-Menü mit allen Optionen,
 * Umklappen am Rand, Tastatur), anklickbare Elemente im Spiel (Chat, Taste „HUD bedienen“, nie beim Spielen) und die
 * neue HUD-API (Stufe 5) mit einem Test-Element und dem Spotify-Addon.
 *
 * <p>Wie bei AddonApiTests: Die echte Musik wird nie gesteuert (kein Abspielen/Pause/Weiter).
 */
final class HudTests {
	private static final int LEFT = InputConstants.MOUSE_BUTTON_LEFT;
	private static final int RIGHT = InputConstants.MOUSE_BUTTON_RIGHT;
	private static final int SHIFT = 1;
	private static final int CONTROL = 64;

	private HudTests() {
	}

	static void run(TestContext t, boolean fabric) {
		t.setScreen(() -> null);
		t.serverCommand("tp @a 0 -60 0 0 0");
		t.serverCommand("item replace entity @a armor.head with minecraft:diamond_helmet");
		t.serverCommand("item replace entity @a armor.chest with minecraft:iron_chestplate[minecraft:damage=180]");
		t.serverCommand("item replace entity @a weapon.mainhand with minecraft:diamond_sword[minecraft:damage=1400]");
		t.serverCommand("effect give @a minecraft:speed 120 1");
		t.serverCommand("effect give @a minecraft:night_vision 30 0");
		t.run(mc -> {
			for (HudModule module : ModuleManager.hud()) {
				module.resetLayout();
				// alle Elemente an – außer der Minimap (eigene Tests in MinimapTests): Mit ihr (oben rechts, fast 100 × 110)
				// wäre der kleine Testbildschirm (427 × 240) so voll, dass sie die Trank-Effekte und die Werkzeugleiste des
				// HUD-Editors verdeckt
				module.setEnabled(!module.id().equals("minimap:minimap"));
			}
			HeldixConfig.save();
		});
		t.waitTicks(10);
		styles(t);
		anchors(t);
		editor(t);
		contextMenu(t);
		clickable(t);
		api(t);
		spotify(t);
		t.run(mc -> {
			HeldixConfig.Data c = HeldixConfig.get();
			c.hudStyle = HudStyles.HELDIX;
			for (HudModule module : ModuleManager.hud()) module.resetLayout();
			HeldixConfig.save();
		});
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static HudModule hud(TestContext t, String id) {
		HudModule module = t.compute(mc -> ModuleManager.hud().stream().filter(m -> m.id().equals(id)).findFirst().orElse(null));
		if (module == null) throw new AssertionError("HUD-Modul " + id + " fehlt");
		return module;
	}

	private static int[] screen(TestContext t) {
		return t.compute(mc -> new int[] {mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight()});
	}

	private static int[] box(TestContext t, HudModule m) {
		return t.compute(mc -> new int[] {m.x(), m.y(), m.width(), m.height()});
	}

	private static int[] center(TestContext t, HudModule m) {
		int[] b = box(t, m);
		return new int[] {b[0] + b[2] / 2, b[1] + b[3] / 2};
	}

	/** Alle sichtbaren Elemente liegen ganz auf dem Bildschirm */
	private static boolean allInside(TestContext t) {
		return t.compute(mc -> {
			int w = mc.getWindow().getGuiScaledWidth();
			int h = mc.getWindow().getGuiScaledHeight();
			return ModuleManager.hud().stream().filter(HudModule::isEnabled)
					.allMatch(m -> m.x() >= 0 && m.y() >= 0 && m.x() + m.width() <= w + 1 && m.y() + m.height() <= h + 1);
		});
	}

	private static void press(TestContext t, double x, double y, int button, int modifiers) {
		t.run(mc -> mc.gui.screen().mouseClicked(new MouseButtonEvent(x, y, new MouseButtonInfo(button, modifiers)), false));
	}

	private static void drag(TestContext t, double x, double y, int modifiers) {
		t.run(mc -> mc.gui.screen().mouseDragged(new MouseButtonEvent(x, y, new MouseButtonInfo(LEFT, modifiers)), 0, 0));
		t.waitTicks(1);
	}

	private static void release(TestContext t, double x, double y) {
		t.run(mc -> mc.gui.screen().mouseReleased(new MouseButtonEvent(x, y, new MouseButtonInfo(LEFT, 0))));
		t.waitTicks(1);
	}

	private static void key(TestContext t, int key, int modifiers) {
		t.run(mc -> mc.gui.screen().keyPressed(new KeyEvent(key, 0, modifiers)));
		t.waitTicks(1);
	}

	private static void hover(TestContext t, double x, double y) {
		t.moveMouse(x, y);
		t.run(mc -> mc.gui.screen().mouseMoved(x, y));
		t.waitTicks(2);
	}

	/** Mitte eines Bereichs eines Elements in GUI-Koordinaten */
	private static int[] hotspotCenter(TestContext t, HudModule m, String id) {
		int[] center = t.compute(mc -> {
			for (HudModule.Hotspot h : m.hotspots()) {
				if (h.id().equals(id)) {
					float s = m.drawScale();
					return new int[] {Math.round(m.x() + (h.x() + h.w() / 2) * s), Math.round(m.y() + (h.y() + h.h() / 2) * s)};
				}
			}
			return null;
		});
		if (center == null) throw new AssertionError(m.id() + " hat keinen Bereich „" + id + "“ (" + t.compute(mc -> m.hotspots().stream().map(HudModule.Hotspot::id).toList()) + ")");
		return center;
	}

	private static HudEditorScreen openEditor(TestContext t) {
		t.setScreen(() -> new HudEditorScreen(null));
		t.waitTicks(4);
		return t.compute(mc -> (HudEditorScreen) mc.gui.screen());
	}

	/** Menü des offenen HUD-Editors (nur im Haupt-Thread, also in t.compute) */
	private static ContextMenu menuOf(Minecraft mc) {
		return ((HudEditorScreen) mc.gui.screen()).contextMenu();
	}

	private static int[] row(TestContext t, int level, String label) {
		int[] center = t.compute(mc -> menuOf(mc).levelCount() > level ? menuOf(mc).rowCenter(level, label) : null);
		if (center == null) throw new AssertionError("Menüeintrag „" + label + "“ (Ebene " + level + ") fehlt: "
				+ t.compute(mc -> menuOf(mc).levelCount() > level ? menuOf(mc).labels(level).toString() : "Ebene nicht offen"));
		return center;
	}

	/** Eintrag im Menü anklicken (vorher wie mit der Maus darüberfahren, damit sich Untermenüs öffnen) */
	private static void choose(TestContext t, int level, String label) {
		int[] c = row(t, level, label);
		hover(t, c[0], c[1]);
		press(t, c[0], c[1], LEFT, 0);
		t.waitTicks(2);
	}

	private static void openMenuOn(TestContext t, HudModule module) {
		int[] c = center(t, module);
		press(t, c[0], c[1], RIGHT, 0);
		t.waitTicks(2);
	}

	private static List<String> labels(TestContext t, int level) {
		return t.compute(mc -> menuOf(mc).labels(level));
	}

	private static boolean menuFits(TestContext t) {
		return t.compute(mc -> {
			ContextMenu menu = menuOf(mc);
			int w = mc.getWindow().getGuiScaledWidth();
			int h = mc.getWindow().getGuiScaledHeight();
			for (int i = 0; i < menu.levelCount(); i++) {
				int[] b = menu.bounds(i);
				if (b[0] < 0 || b[1] < 0 || b[0] + b[2] > w || b[1] + b[3] > h) return false;
			}
			return menu.levelCount() > 0;
		});
	}

	private static EditBox input(Minecraft mc) {
		try {
			Field field = ChatScreen.class.getDeclaredField("input");
			field.setAccessible(true);
			return (EditBox) field.get(mc.gui.screen());
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}

	@SuppressWarnings("unchecked")
	static List<String> chat(TestContext t, int count) {
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

	private static void openChat(TestContext t) {
		t.setScreen(() -> new ChatScreen("", false));
		t.waitTicks(4);
	}

	// ======================================================================================
	// Stile
	// ======================================================================================

	private static void styles(TestContext t) {
		HudModule fps = hud(t, "fps");
		HudModule coordinates = hud(t, "coordinates");
		String[] names = {"heldix", "minimal", "klassisch"};
		for (int kind = 0; kind < 3; kind++) {
			int k = kind;
			t.run(mc -> HeldixConfig.get().hudStyle = k);
			t.waitTicks(6);
			t.screenshot("heldix-hud-01-stil-" + names[kind]);
			HudStyles.Resolved style = t.compute(mc -> HudStyles.resolve(fps));
			t.check("HUD-Stil " + HudStyles.NAMES.get(kind) + " aufgelöst (" + style.kind() + ")", style.kind().ordinal() == kind);
			t.check("HUD-Stil " + HudStyles.NAMES.get(kind) + ": alle Elemente auf dem Bildschirm", allInside(t));
		}
		t.check("Heldix: Fläche mit Rahmen, Heldix-Schrift", t.compute(mc -> {
			HeldixConfig.get().hudStyle = HudStyles.HELDIX;
			HudStyles.Resolved s = HudStyles.resolve(fps);
			return s.background() != 0 && s.border() && s.textStyle() == HudCanvas.TextStyle.BODY && !s.shadow();
		}));
		t.check("Minimal: ohne Fläche, Text mit Schatten", t.compute(mc -> {
			HeldixConfig.get().hudStyle = HudStyles.MINIMAL;
			HudStyles.Resolved s = HudStyles.resolve(fps);
			return s.background() == 0 && s.shadow() && s.textStyle() == HudCanvas.TextStyle.MINECRAFT;
		}));
		t.check("Klassisch: Minecraft-Schrift, Akzent wie bisher", t.compute(mc -> {
			HeldixConfig.get().hudStyle = HudStyles.CLASSIC;
			HudStyles.Resolved s = HudStyles.resolve(fps);
			return s.textStyle() == HudCanvas.TextStyle.MINECRAFT && s.accent() == dev.heldixclient.ui.Theme.ACCENT;
		}));
		t.run(mc -> HeldixConfig.get().hudStyle = HudStyles.HELDIX);
		// Deckkraft und Akzent global
		int alpha = t.compute(mc -> {
			HeldixConfig.get().hudOpacity = 0.3f;
			int a = HudStyles.resolve(fps).background() >>> 24;
			HeldixConfig.get().hudOpacity = 0.72f;
			return a;
		});
		t.check("Deckkraft 30 % → Alpha " + alpha, Math.abs(alpha - 77) <= 2);
		int accent = t.compute(mc -> {
			HeldixConfig.get().hudAccent = 0xFFF472B6;
			int a = HudStyles.resolve(fps).accent();
			HeldixConfig.get().hudAccent = 0;
			return a;
		});
		t.check("Eigene Akzentfarbe gilt für alle Elemente", accent == 0xFFF472B6);
		// HUD-Größe insgesamt und scharfe Schrift (ganze Bildschirmpixel)
		int normal = t.compute(mc -> coordinates.width());
		t.run(mc -> HeldixConfig.get().hudScale = 1.5f);
		t.waitTicks(4);
		int big = t.compute(mc -> coordinates.width());
		t.check("HUD-Größe 150 % (" + normal + " → " + big + " px)", big >= normal * 1.3);
		t.run(mc -> {
			HeldixConfig.get().hudScale = 1f;
			fps.setScale(1.3);
		});
		t.waitTicks(4);
		float pixels = t.compute(mc -> fps.drawScale() * mc.getWindow().getGuiScale());
		t.check("Scharfe Schrift: Größe auf ganze Bildschirmpixel gerundet (" + pixels + ")", Math.abs(pixels - Math.round(pixels)) < 0.001f);
		t.run(mc -> fps.setScale(1.0));
		t.waitTicks(3);
	}

	// ======================================================================================
	// Bezugspunkte: GUI-Skalierung, Fenstergröße, alte Positionen
	// ======================================================================================

	private static void anchors(TestContext t) {
		HudModule fps = hud(t, "fps");
		HudModule coordinates = hud(t, "coordinates");
		HudModule effects = hud(t, "effects");
		int[] size = screen(t);
		t.check("Standard: FPS hängt oben links", t.compute(mc -> fps.anchor()) == HudAnchor.TOP_LEFT);
		t.check("Standard: Trank-Effekte hängen oben rechts", t.compute(mc -> effects.anchor()) == HudAnchor.TOP_RIGHT);
		int[] e = box(t, effects);
		t.check("Trank-Effekte am rechten Rand (" + (e[0] + e[2]) + " von " + size[0] + ")", Math.abs(e[0] + e[2] - (size[0] - HudModule.MARGIN)) <= 1);

		int[] f = box(t, fps);
		t.run(mc -> fps.setPosition(size[0] - f[2] - 10, size[1] - f[3] - 10));
		t.waitTicks(3);
		t.check("Unten rechts abgelegt: Bezugspunkt unten rechts (" + t.compute(mc -> fps.anchor()) + ", " + t.compute(mc -> fps.anchorOffsetX()) + "/"
				+ t.compute(mc -> fps.anchorOffsetY()) + ")", t.compute(mc -> fps.anchor() == HudAnchor.BOTTOM_RIGHT && fps.anchorOffsetX() == -10 && fps.anchorOffsetY() == -10));
		int[] c = box(t, coordinates);
		t.run(mc -> coordinates.setPosition((size[0] - c[2]) / 2, (size[1] - c[3]) / 2));
		t.waitTicks(3);
		t.check("Mittig abgelegt: Bezugspunkt Mitte", t.compute(mc -> coordinates.anchor()) == HudAnchor.CENTER);
		// andere Fenstergrößen (gerechnet): Abstand zum Rand bzw. Mitte bleibt
		for (int[] other : new int[][] {{size[0] * 2, size[1] * 2}, {size[0] / 2 + 60, size[1] / 2 + 40}, {960, 540}}) {
			int[] p = t.compute(mc -> fps.positionFor(other[0], other[1]));
			int[] q = t.compute(mc -> coordinates.positionFor(other[0], other[1]));
			int fw = box(t, fps)[2];
			int cw = box(t, coordinates)[2];
			t.check("Fenster " + other[0] + "×" + other[1] + ": FPS 10 px vom Rand unten rechts, Koordinaten mittig",
					p[0] + fw == other[0] - 10 && Math.abs(q[0] + cw / 2 - other[0] / 2) <= 1);
		}

		// echte GUI-Skalierung ändern
		int scale = t.compute(mc -> mc.getWindow().getGuiScale());
		int otherScale = scale >= 2 ? 1 : 2;
		t.run(mc -> mc.options.guiScale().set(otherScale));
		t.waitSoft(mc -> mc.getWindow().getGuiScale() == otherScale, 5);
		t.waitTicks(5);
		int[] scaled = screen(t);
		t.log("GUI-Skalierung " + scale + " → " + t.compute(mc -> mc.getWindow().getGuiScale()) + ", GUI " + scaled[0] + "×" + scaled[1]);
		if (t.compute(mc -> mc.getWindow().getGuiScale()) == otherScale) {
			int[] g = box(t, fps);
			int[] k = box(t, coordinates);
			t.check("GUI-Skalierung " + otherScale + ": FPS bleibt unten rechts (" + (g[0] + g[2]) + "/" + (g[1] + g[3]) + " bei " + scaled[0] + "×" + scaled[1] + ")",
					Math.abs(g[0] + g[2] - (scaled[0] - 10)) <= 3 && Math.abs(g[1] + g[3] - (scaled[1] - 10)) <= 3);
			t.check("GUI-Skalierung " + otherScale + ": Koordinaten bleiben mittig", Math.abs(k[0] + k[2] / 2 - scaled[0] / 2) <= 2);
			t.check("GUI-Skalierung " + otherScale + ": alle Elemente auf dem Bildschirm", allInside(t));
			// Minecraft baut den Item-Zwischenspeicher nach dem Wechsel neu auf: ein paar Bilder warten
			t.waitTicks(20);
			t.screenshot("heldix-hud-02-gui-skalierung-" + otherScale);
		}
		t.run(mc -> mc.options.guiScale().set(0));
		t.waitSoft(mc -> mc.getWindow().getGuiScale() == scale, 5);
		t.waitTicks(5);

		// echte Fenstergröße ändern (geht nicht überall; dann nur Hinweis)
		int[] window = t.compute(mc -> new int[] {mc.getWindow().getScreenWidth(), mc.getWindow().getScreenHeight()});
		t.run(mc -> mc.getWindow().setWindowed(window[0] + 300, window[1] + 160));
		boolean resized = t.waitSoft(mc -> mc.getWindow().getScreenWidth() != window[0], 5);
		t.waitTicks(6);
		if (resized) {
			int[] bigger = screen(t);
			int[] g = box(t, fps);
			t.check("Größeres Fenster (" + bigger[0] + "×" + bigger[1] + "): FPS bleibt unten rechts",
					Math.abs(g[0] + g[2] - (bigger[0] - 10)) <= 3 && Math.abs(g[1] + g[3] - (bigger[1] - 10)) <= 3);
			t.check("Größeres Fenster: alle Elemente auf dem Bildschirm", allInside(t));
			t.run(mc -> mc.getWindow().setWindowed(window[0], window[1]));
			t.waitSoft(mc -> mc.getWindow().getScreenWidth() == window[0], 5);
			t.waitTicks(6);
		} else {
			t.log("Fenstergröße ließ sich hier nicht ändern – nur gerechnet geprüft");
		}

		// nie außerhalb: Abstand weit über den Rand hinaus
		t.run(mc -> fps.setPosition(size[0] + 400, -300));
		t.waitTicks(3);
		t.check("Element bleibt auf dem Bildschirm, auch mit Abstand über den Rand", allInside(t));

		// alte Konfiguration (bis 0.13.1: nur x/y) wird beim ersten Zeichnen umgerechnet
		t.run(mc -> {
			HeldixConfig.ModuleState old = fps.snapshot();
			old.anchor = null;
			old.x = 9999;
			old.y = 50;
			fps.restore(old);
		});
		t.waitTicks(4);
		int[] migrated = box(t, fps);
		int[] now = screen(t);
		t.check("Alte Position umgerechnet (" + t.compute(mc -> fps.anchor()) + ", x " + migrated[0] + ")",
				t.compute(mc -> fps.anchor().column == 2) && migrated[0] + migrated[2] == now[0] && migrated[1] == 50);
		t.run(mc -> {
			fps.resetLayout();
			coordinates.resetLayout();
			HeldixConfig.save();
		});
		t.waitTicks(3);
	}

	// ======================================================================================
	// HUD-Editor: Einrasten, Hilfslinien, Mehrfachauswahl, Rahmen, Pfeiltasten, Rückgängig
	// ======================================================================================

	private static void editor(TestContext t) {
		HudModule fps = hud(t, "fps");
		HudModule cps = hud(t, "cps");
		HudModule coordinates = hud(t, "coordinates");
		// übersichtlich: nur drei Elemente sichtbar
		t.run(mc -> {
			for (HudModule m : ModuleManager.hud()) {
				m.resetLayout();
				m.setEnabled(m == fps || m == cps || m == coordinates);
			}
		});
		HudEditorScreen editor = openEditor(t);
		int[] size = screen(t);

		// Koordinaten 3 px neben die Mitte ziehen: rastet in der Mitte ein, Hilfslinie senkrecht durch die Mitte
		int[] c = box(t, coordinates);
		int targetX = (size[0] - c[2]) / 2 + 3;
		int targetY = size[1] / 2 + 24;
		press(t, c[0] + 3, c[1] + 3, LEFT, 0);
		for (int i = 1; i <= 6; i++) drag(t, c[0] + 3 + (targetX - c[0]) * i / 6.0, c[1] + 3 + (targetY - c[1]) * i / 6.0, 0);
		int x = t.compute(mc -> coordinates.x());
		List<HudEditorScreen.Guide> guides = t.compute(mc -> editor.guides());
		t.check("Einrasten in der Mitte (x " + x + ", erwartet " + (size[0] - c[2]) / 2 + ")", x == (size[0] - c[2]) / 2);
		t.check("Hilfslinie senkrecht durch die Mitte (" + guides + ")", guides.stream().anyMatch(g -> g.vertical() && Math.abs(g.pos() - size[0] / 2f) < 1));
		t.screenshot("heldix-hud-03-editor-hilfslinien");
		release(t, targetX, targetY);
		int undoAfterDrag = t.compute(mc -> editor.undoSize());
		t.check("Ziehen lässt sich rückgängig machen (" + undoAfterDrag + ")", undoAfterDrag >= 1);

		// CPS unter die Koordinaten: bündig links und mit 2 px Abstand darunter
		c = box(t, coordinates);
		int[] p = box(t, cps);
		int wantX = c[0];
		int wantY = c[1] + c[3] + 2;
		press(t, p[0] + 2, p[1] + 2, LEFT, 0);
		for (int i = 1; i <= 6; i++) drag(t, p[0] + 2 + (wantX + 3 - p[0]) * i / 6.0, p[1] + 2 + (wantY + 4 - p[1]) * i / 6.0, 0);
		int[] snapped = box(t, cps);
		guides = t.compute(mc -> editor.guides());
		t.check("An anderem Element eingerastet (" + snapped[0] + "/" + snapped[1] + ", erwartet " + wantX + "/" + wantY + ")",
				snapped[0] == wantX && snapped[1] == wantY);
		t.check("Hilfslinie an der linken Kante des anderen Elements", guides.stream().anyMatch(g -> g.vertical() && Math.abs(g.pos() - wantX) < 1));
		release(t, wantX + 3, wantY + 4);
		// mit Strg frei platzieren
		p = box(t, cps);
		press(t, p[0] + 2, p[1] + 2, LEFT, 0);
		drag(t, p[0] + 5, p[1] + 2, CONTROL);
		t.check("Mit Strg frei platziert (ohne Einrasten)", t.compute(mc -> cps.x()) == p[0] + 3 && t.compute(mc -> editor.guides()).isEmpty());
		release(t, p[0] + 5, p[1] + 2);

		// Mehrfachauswahl: Umschalt+Klick nimmt FPS dazu, beide bewegen sich zusammen
		int[] fc = center(t, fps);
		press(t, fc[0], fc[1], LEFT, SHIFT);
		release(t, fc[0], fc[1]);
		List<String> selected = t.compute(mc -> editor.selectedIds());
		t.check("Umschalt+Klick: zwei Elemente ausgewählt (" + selected + ")", selected.size() == 2 && selected.containsAll(List.of("fps", "cps")));
		int[] fBefore = box(t, fps);
		int[] cBefore = box(t, cps);
		press(t, fc[0], fc[1], LEFT, 0);
		drag(t, fc[0] + 20, fc[1] + 12, CONTROL);
		release(t, fc[0] + 20, fc[1] + 12);
		int[] fAfter = box(t, fps);
		int[] cAfter = box(t, cps);
		t.check("Auswahl bewegt sich zusammen (FPS " + (fAfter[0] - fBefore[0]) + "/" + (fAfter[1] - fBefore[1]) + ", CPS " + (cAfter[0] - cBefore[0]) + "/"
				+ (cAfter[1] - cBefore[1]) + ")", fAfter[0] - fBefore[0] == 20 && cAfter[0] - cBefore[0] == 20 && fAfter[1] - fBefore[1] == 12
				&& cAfter[1] - cBefore[1] == 12);
		// Pfeiltasten: 1 px, mit Umschalt 10 px – für die ganze Auswahl
		key(t, InputConstants.KEY_RIGHT, 0);
		key(t, InputConstants.KEY_DOWN, SHIFT);
		t.check("Pfeiltasten verschieben die Auswahl (1 px rechts, 10 px runter)", box(t, fps)[0] == fAfter[0] + 1 && box(t, cps)[0] == cAfter[0] + 1
				&& box(t, fps)[1] == fAfter[1] + 10 && box(t, cps)[1] == cAfter[1] + 10);
		// Rückgängig und Wiederholen
		key(t, InputConstants.KEY_Z, CONTROL);
		t.check("Strg+Z: 10 px wieder hoch", box(t, fps)[1] == fAfter[1] && box(t, cps)[1] == cAfter[1]);
		key(t, InputConstants.KEY_Z, CONTROL);
		t.check("Strg+Z: 1 px wieder links", box(t, fps)[0] == fAfter[0]);
		t.check("Wiederholen möglich (" + t.compute(mc -> editor.redoSize()) + ")", t.compute(mc -> editor.redoSize()) == 2);
		key(t, InputConstants.KEY_Y, CONTROL);
		t.check("Strg+Y wiederholt den Schritt", box(t, fps)[0] == fAfter[0] + 1);
		key(t, InputConstants.KEY_Z, CONTROL | SHIFT);
		t.check("Strg+Umschalt+Z wiederholt ebenfalls", box(t, fps)[1] == fAfter[1] + 10);

		// Rahmen ziehen: wählt alle berührten Elemente
		key(t, InputConstants.KEY_ESCAPE, 0);
		t.check("Esc hebt die Auswahl auf (Editor bleibt offen)", t.compute(mc -> editor.selectedIds().isEmpty() && mc.gui.screen() == editor));
		int[] a = box(t, fps);
		int[] b = box(t, cps);
		int[] start = t.compute(mc -> editor.freePointNear(Math.max(a[0], b[0]) + Math.max(a[2], b[2]) + 8, Math.max(a[1], b[1]) + Math.max(a[3], b[3]) + 6));
		t.check("Freie Stelle für den Rahmen gefunden", start != null);
		press(t, start[0], start[1], LEFT, 0);
		int endX = Math.min(a[0], b[0]) + 4;
		int endY = Math.min(a[1], b[1]) + 3;
		for (int i = 1; i <= 4; i++) drag(t, start[0] + (endX - start[0]) * i / 4.0, start[1] + (endY - start[1]) * i / 4.0, 0);
		t.screenshot("heldix-hud-04-editor-rahmen");
		release(t, endX, endY);
		selected = t.compute(mc -> editor.selectedIds());
		t.check("Rahmen wählt FPS und CPS (" + selected + ")", selected.containsAll(List.of("fps", "cps")));
		key(t, InputConstants.KEY_A, CONTROL);
		t.check("Strg+A wählt alle sichtbaren", t.compute(mc -> editor.selectedIds().size()) == 3);
		key(t, InputConstants.KEY_ESCAPE, 0);
		t.run(mc -> {
			for (HudModule m : ModuleManager.hud()) {
				m.resetLayout();
				m.setEnabled(!m.id().equals("minimap:minimap"));
			}
			HeldixConfig.save();
		});
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Rechtsklick-Menü
	// ======================================================================================

	private static void contextMenu(TestContext t) {
		HudModule fps = hud(t, "fps");
		HudModule ping = hud(t, "ping");
		t.run(mc -> {
			for (HudModule m : ModuleManager.hud()) m.resetLayout();
		});
		HudEditorScreen editor = openEditor(t);
		int[] size = screen(t);

		openMenuOn(t, fps);
		t.check("Rechtsklick auf ein Element öffnet das Menü", t.compute(mc -> menuOf(mc).isOpen()));
		List<String> root = labels(t, 0);
		t.log("Menü: " + root);
		t.check("Menü hat alle Optionen", root.containsAll(List.of("FPS", "Ausrichtung", "Skalierung", "Hintergrund", "Deckkraft", "Farben", "Schatten", "Rahmen",
				"Ebene", "An Raster einrasten", "Optionen: FPS", "Einstellungen öffnen", "Zurücksetzen", "Ausblenden")));
		t.check("Menü passt auf den Bildschirm", menuFits(t));
		// Untermenü öffnet sich beim Überfahren
		int[] align = row(t, 0, "Ausrichtung");
		hover(t, align[0], align[1]);
		t.check("Überfahren öffnet das Untermenü Ausrichtung", t.compute(mc -> menuOf(mc).levelCount()) == 2
				&& labels(t, 1).equals(List.of("Automatisch", "Links", "Mitte", "Rechts")));
		t.screenshot("heldix-hud-05-editor-kontextmenue");

		int[] before = box(t, fps);
		choose(t, 1, "Rechts");
		t.check("Ausrichtung rechts gesetzt, Element bleibt stehen", "right".equals(t.compute(mc -> fps.styleValue(HudStyles.ALIGN)))
				&& Math.abs(box(t, fps)[0] - before[0]) <= 1);
		t.check("Menü bleibt nach einer Auswahl offen", t.compute(mc -> menuOf(mc).isOpen()));
		choose(t, 0, "Skalierung");
		choose(t, 1, "150 %");
		t.check("Skalierung 150 %", Math.abs(t.compute(mc -> fps.scale()) - 1.5f) < 0.01f);
		choose(t, 1, "Größer (+5 %)");
		t.check("Größer (+5 %) → 155 %", Math.abs(t.compute(mc -> fps.scale()) - 1.55f) < 0.01f);
		boolean background = t.compute(mc -> HudStyles.resolve(fps).background() != 0);
		choose(t, 0, "Hintergrund");
		t.check("Hintergrund umgeschaltet", t.compute(mc -> HudStyles.resolve(fps).background() != 0) != background);
		choose(t, 0, "Hintergrund");
		choose(t, 0, "Deckkraft");
		choose(t, 1, "50 %");
		t.check("Deckkraft 50 % (eigene)", Math.abs(t.compute(mc -> HudStyles.resolve(fps).opacity()) - 0.5f) < 0.01f
				&& t.compute(mc -> HudStyles.resolve(fps).background() >>> 24) == 128);
		choose(t, 0, "Farben");
		int[] swatch = t.compute(mc -> menuOf(mc).swatchCenter(1, Setting.Color.PALETTE.indexOf(0xFFF472B6)));
		hover(t, swatch[0], swatch[1]);
		press(t, swatch[0], swatch[1], LEFT, 0);
		t.waitTicks(2);
		t.check("Akzentfarbe aus der Palette (Pink)", t.compute(mc -> HudStyles.resolve(fps).accent()) == 0xFFF472B6);
		boolean shadow = t.compute(mc -> HudStyles.resolve(fps).shadow());
		choose(t, 0, "Schatten");
		t.check("Schatten umgeschaltet", t.compute(mc -> HudStyles.resolve(fps).shadow()) != shadow);
		boolean border = t.compute(mc -> HudStyles.resolve(fps).border());
		choose(t, 0, "Rahmen");
		t.check("Rahmen umgeschaltet", t.compute(mc -> HudStyles.resolve(fps).border()) != border);
		choose(t, 0, "Ebene");
		choose(t, 1, "Ganz nach vorn");
		t.check("Ebene ganz nach vorn", t.compute(mc -> ModuleManager.hudByLayer().getLast()) == fps);
		choose(t, 1, "Eine Ebene nach hinten");
		t.check("Eine Ebene nach hinten", t.compute(mc -> fps.layer()) == 0);
		t.waitTicks(3);
		t.screenshot("heldix-hud-06-editor-element-angepasst");
		choose(t, 0, "Optionen: FPS");
		t.check("Eigene Optionen des Elements im Menü (" + labels(t, 1) + ")", labels(t, 1).containsAll(List.of("Darstellung", "Farbe nach Wert")));
		choose(t, 1, "Darstellung");
		choose(t, 2, "144 FPS");
		t.check("Option des Elements über das Menü gesetzt", t.compute(mc -> fps.settings().stream().filter(s -> s instanceof Setting.Choice c && c.label().equals("Darstellung"))
				.map(s -> ((Setting.Choice) s).get().getAsInt()).findFirst().orElse(-1)) == 1);
		choose(t, 0, "An Raster einrasten");
		t.check("An Raster einrasten schließt das Menü", !t.compute(mc -> menuOf(mc).isOpen()));
		int[] grid = box(t, fps);
		t.check("Am Raster eingerastet (" + grid[0] + "/" + grid[1] + ")", (grid[0] % HudEditorScreen.GRID == 0 || grid[0] + grid[2] >= size[0] - 1)
				&& (grid[1] % HudEditorScreen.GRID == 0 || grid[1] + grid[3] >= size[1] - 1));
		int undo = t.compute(mc -> editor.undoSize());
		t.check("Menü-Änderungen landen im Rückgängig-Verlauf (" + undo + ")", undo >= 10);

		openMenuOn(t, fps);
		choose(t, 0, "Zurücksetzen");
		t.check("Zurücksetzen: Aussehen, Größe und Ebene wie Standard", t.compute(mc -> HudStyles.KEYS.stream().allMatch(k -> fps.styleValue(k) == null)
				&& Math.abs(fps.scale() - 1f) < 0.01f && fps.layer() == 0 && fps.anchor() == HudAnchor.TOP_LEFT));
		t.run(mc -> fps.settings().stream().filter(s -> s instanceof Setting.Choice c && c.label().equals("Darstellung"))
				.forEach(s -> ((Setting.Choice) s).set().accept(0)));
		openMenuOn(t, fps);
		choose(t, 0, "Ausblenden");
		t.check("Ausblenden über das Menü", !t.compute(mc -> fps.isEnabled()));
		key(t, InputConstants.KEY_Z, CONTROL);
		t.check("Strg+Z blendet es wieder ein", t.compute(mc -> fps.isEnabled()));
		t.waitTicks(2);

		// Einstellungen öffnen und zurück
		openMenuOn(t, fps);
		choose(t, 0, "Einstellungen öffnen");
		t.check("„Einstellungen öffnen“ zeigt das Untermenü des Elements", "fps".equals(t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.openModuleId() : null)));
		t.run(mc -> mc.gui.screen().onClose());
		t.waitTicks(3);
		t.check("Zurück im HUD-Editor", t.compute(mc -> mc.gui.screen() == editor));

		// Am Rand: klappt nach links/oben, Untermenü öffnet links
		int[] corner = t.compute(mc -> editor.freePointNear(size[0] - 6, size[1] - 6));
		press(t, corner[0], corner[1], RIGHT, 0);
		t.waitTicks(2);
		int[] bounds = t.compute(mc -> menuOf(mc).bounds(0));
		t.check("Menü an der Ecke klappt nach links und oben (" + bounds[0] + "/" + bounds[1] + ", Maus " + corner[0] + "/" + corner[1] + ")",
				bounds[0] + bounds[2] <= corner[0] + 1 && bounds[1] + bounds[3] <= size[1] && menuFits(t));
		t.check("Menü auf freier Fläche (" + labels(t, 0) + ")", labels(t, 0).containsAll(List.of("Widget hinzufügen", "HUD-Stil", "Raster", "Hilfslinien",
				"Einrasten", "Alles auswählen", "Rückgängig", "Wiederholen", "Alles zurücksetzen")));
		choose(t, 0, "HUD-Stil");
		int[] sub = t.compute(mc -> menuOf(mc).bounds(1));
		t.check("Untermenü am rechten Rand öffnet nach links (" + sub[0] + " < " + bounds[0] + ")", sub[0] < bounds[0] && menuFits(t));
		t.screenshot("heldix-hud-07-editor-menue-rand");
		choose(t, 1, "Minimal");
		t.check("HUD-Stil über das Menü: Minimal", t.compute(mc -> HeldixConfig.get().hudStyle) == HudStyles.MINIMAL);
		choose(t, 1, "Heldix");
		boolean gridOn = t.compute(mc -> HeldixConfig.get().hudGrid);
		choose(t, 0, "Raster");
		t.check("Raster über das Menü umgeschaltet", t.compute(mc -> HeldixConfig.get().hudGrid) != gridOn);
		choose(t, 0, "Raster");
		boolean guidesOn = t.compute(mc -> HeldixConfig.get().hudGuides);
		choose(t, 0, "Hilfslinien");
		t.check("Hilfslinien über das Menü umgeschaltet", t.compute(mc -> HeldixConfig.get().hudGuides) != guidesOn);
		choose(t, 0, "Hilfslinien");
		key(t, InputConstants.KEY_ESCAPE, 0);
		t.check("Esc schließt das Menü (Editor bleibt)", !t.compute(mc -> menuOf(mc).isOpen()) && t.compute(mc -> mc.gui.screen() == editor));

		// Widget hinzufügen: ausgeblendetes Element an der Stelle des Rechtsklicks
		t.run(mc -> ping.setEnabled(false));
		int[] free = t.compute(mc -> editor.freePointNear(size[0] / 2, size[1] / 2 + 20));
		press(t, free[0], free[1], RIGHT, 0);
		t.waitTicks(2);
		choose(t, 0, "Widget hinzufügen");
		t.check("Widget hinzufügen listet ausgeblendete Elemente (" + labels(t, 1) + ")", labels(t, 1).contains("Ping"));
		choose(t, 1, "Ping");
		t.waitTicks(3);
		int[] added = box(t, ping);
		t.check("Ping eingeblendet an der Stelle des Klicks (" + added[0] + "/" + added[1] + " bei " + free[0] + "/" + free[1] + ")",
				t.compute(mc -> ping.isEnabled()) && Math.abs(added[0] - Math.min(free[0], size[0] - added[2])) <= 2 && Math.abs(added[1] - Math.min(free[1], size[1] - added[3])) <= 2);

		// Tastatur: Enter öffnet das Menü des ausgewählten Elements, Pfeile, Enter, links, Esc
		int[] fc = center(t, fps);
		press(t, fc[0], fc[1], LEFT, 0);
		release(t, fc[0], fc[1]);
		key(t, InputConstants.KEY_RETURN, 0);
		t.check("Enter öffnet das Menü mit dem ersten Eintrag markiert (" + t.compute(mc -> menuOf(mc).selectedLabel()) + ")",
				t.compute(mc -> menuOf(mc).isOpen()) && "Ausrichtung".equals(t.compute(mc -> menuOf(mc).selectedLabel())));
		key(t, InputConstants.KEY_DOWN, 0);
		t.check("Pfeil runter: Skalierung", "Skalierung".equals(t.compute(mc -> menuOf(mc).selectedLabel())));
		key(t, InputConstants.KEY_RIGHT, 0);
		t.check("Pfeil rechts öffnet das Untermenü (" + t.compute(mc -> menuOf(mc).selectedLabel()) + ")", t.compute(mc -> menuOf(mc).levelCount()) == 2
				&& "50 %".equals(t.compute(mc -> menuOf(mc).selectedLabel())));
		key(t, InputConstants.KEY_DOWN, 0);
		key(t, InputConstants.KEY_DOWN, 0);
		key(t, InputConstants.KEY_DOWN, 0);
		key(t, InputConstants.KEY_RETURN, 0);
		t.check("Enter wählt 125 %", Math.abs(t.compute(mc -> fps.scale()) - 1.25f) < 0.01f);
		key(t, InputConstants.KEY_LEFT, 0);
		t.check("Pfeil links schließt das Untermenü", t.compute(mc -> menuOf(mc).levelCount()) == 1);
		key(t, InputConstants.KEY_ESCAPE, 0);
		t.check("Esc schließt das Menü", !t.compute(mc -> menuOf(mc).isOpen()));

		// alles zurücksetzen über das Menü (und wieder zurückholen)
		int[] free2 = t.compute(mc -> editor.freePointNear(size[0] / 2, size[1] / 2));
		press(t, free2[0], free2[1], RIGHT, 0);
		choose(t, 0, "Alles zurücksetzen");
		t.check("Alles zurücksetzen", t.compute(mc -> ModuleManager.hud().stream().allMatch(m -> Math.abs(m.scale() - 1f) < 0.01f)));
		key(t, InputConstants.KEY_Z, CONTROL);
		t.check("… lässt sich rückgängig machen", Math.abs(t.compute(mc -> fps.scale()) - 1.25f) < 0.01f);
		t.run(mc -> {
			for (HudModule m : ModuleManager.hud()) m.resetLayout();
			HeldixConfig.save();
		});
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Anklickbare Elemente im Spiel
	// ======================================================================================

	private static void clickable(TestContext t) {
		HudModule coordinates = hud(t, "coordinates");
		HudModule fps = hud(t, "fps");
		HudModule ping = hud(t, "ping");
		HudModule armor = hud(t, "armor");
		HudModule effects = hud(t, "effects");
		t.run(mc -> {
			for (HudModule m : ModuleManager.hud()) {
				m.resetLayout();
				m.setEnabled(!m.id().equals("minimap:minimap"));
			}
			HudInteraction.clearLastAction();
		});
		// nach oben schauen: ein Klick im Spiel trifft keinen Block
		t.serverCommand("tp @a 0 -60 0 0 -90");
		t.setScreen(() -> null);
		t.waitTicks(5);

		// beim normalen Spielen: nicht bedienbar, Klick geht ans Spiel und löst nichts am HUD aus
		t.check("Beim Spielen ist das HUD nicht bedienbar", !t.compute(mc -> HudInteraction.active()));
		int[] cc = center(t, coordinates);
		t.check("Blick in den Himmel (kein Block im Visier)", t.compute(mc -> mc.hitResult == null || mc.hitResult.getType() == HitResult.Type.MISS));
		t.click(cc[0], cc[1]);
		t.check("Klick beim Spielen löst keine HUD-Aktion aus", t.compute(mc -> HudInteraction.lastAction()).isEmpty() && t.compute(mc -> mc.gui.screen() == null));

		// Chat offen: Hervorhebung, Tooltip, Hand, Klick fügt die Koordinaten ein
		openChat(t);
		t.check("Bei offenem Chat ist das HUD bedienbar", t.compute(mc -> HudInteraction.active()));
		cc = center(t, coordinates);
		t.moveMouse(cc[0], cc[1]);
		t.waitTicks(3);
		t.check("Maus über den Koordinaten erkannt (" + t.compute(mc -> HudInteraction.hoveredId()) + ")", "coordinates".equals(t.compute(mc -> HudInteraction.hoveredId())));
		List<String> tooltip = t.compute(mc -> HudInteraction.lastTooltip());
		t.check("Tooltip der Koordinaten (" + tooltip + ")", tooltip.size() >= 3 && tooltip.stream().anyMatch(l -> l.startsWith("Biom")));
		t.check("Mauszeiger wird zur Hand (" + t.compute(mc -> HudInteraction.lastCursor()) + ")", "HAND".equals(t.compute(mc -> HudInteraction.lastCursor())));
		t.screenshot("heldix-hud-08-chat-hover-koordinaten");
		t.click(cc[0], cc[1]);
		String inserted = t.compute(mc -> input(mc).getValue());
		String block = t.compute(mc -> mc.player.blockPosition().getX() + " " + mc.player.blockPosition().getY() + " " + mc.player.blockPosition().getZ());
		t.check("Klick fügt die Koordinaten in den Chat ein („" + inserted + "“)", inserted.contains(block) && "coordinates:chat".equals(t.compute(mc -> HudInteraction.lastAction())));
		t.check("Chat bleibt offen", t.compute(mc -> mc.gui.screen() instanceof ChatScreen));
		int[] shiftAt = cc;
		t.run(mc -> HudInteraction.click(new MouseButtonEvent(shiftAt[0], shiftAt[1], new MouseButtonInfo(LEFT, SHIFT))));
		t.check("Umschalt+Klick kopiert die Koordinaten", "coordinates:copy".equals(t.compute(mc -> HudInteraction.lastAction()))
				&& t.compute(mc -> mc.keyboardHandler.getClipboard()).contains(block));

		// anklickbarer Chattext (z. B. ein Link) hat Vorrang vor Elementen darunter, normaler Text nicht
		t.run(mc -> {
			ChatComponent chat = mc.gui.hud.getChat();
			for (int i = 0; i < 3; i++) {
				chat.addClientSystemMessage(Component.literal("Vorrangtest " + i + " mit Link")
						.withStyle(style -> style.withClickEvent(new net.minecraft.network.chat.ClickEvent.SuggestCommand("/help"))));
			}
		});
		t.waitTicks(3);
		int[] link = t.compute(mc -> {
			int height = mc.getWindow().getGuiScaledHeight();
			for (int y = height - 16; y > height / 3; y--) {
				if (ChatModule.messageAt(6, y) == null) continue;
				for (int x = 2; x < 300; x += 2) {
					net.minecraft.client.gui.ActiveTextCollector.ClickableStyleFinder finder = new net.minecraft.client.gui.ActiveTextCollector.ClickableStyleFinder(mc.font, x, y);
					mc.gui.hud.getChat().captureClickableText(finder, height, mc.gui.hud.getGuiTicks(), ChatComponent.DisplayMode.FOREGROUND);
					if (finder.result() != null) return new int[] {x, y};
				}
			}
			return null;
		});
		t.check("Anklickbare Chatzeile gefunden", link != null);
		t.run(mc -> {
			// ganz nach vorn: links unten liegen sonst Addon-Elemente darüber
			coordinates.setLayer(50);
			coordinates.setPosition(Math.max(0, link[0] - 10), link[1] - 4);
			HudInteraction.clearLastAction();
		});
		t.waitTicks(3);
		t.check("Koordinaten liegen über dem Link", t.compute(mc -> HudInteraction.moduleAt(link[0], link[1])) == coordinates);
		boolean consumed = t.compute(mc -> HudInteraction.chatClick(null, new MouseButtonEvent(link[0], link[1], new MouseButtonInfo(LEFT, 0))));
		t.check("Klick auf anklickbaren Chattext geht an den Chat, nicht ans Element", !consumed && t.compute(mc -> HudInteraction.lastAction()).isEmpty());
		t.run(mc -> coordinates.resetLayout());
		t.waitTicks(3);

		// FPS → Leistung, Ping → Einstellungen, Rechtsklick → Einstellungen
		int[] fc = center(t, fps);
		t.click(fc[0], fc[1]);
		t.waitTicks(3);
		t.check("Klick auf FPS öffnet Leistung", "PERFORMANCE".equals(t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.currentTab() : null)));
		t.run(mc -> mc.gui.screen().onClose());
		t.waitTicks(3);
		t.check("Zurück im Chat", t.compute(mc -> mc.gui.screen() instanceof ChatScreen));
		int[] pc = center(t, ping);
		t.click(pc[0], pc[1]);
		t.waitTicks(3);
		t.check("Klick auf Ping öffnet seine Einstellungen", "ping".equals(t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.openModuleId() : null)));
		t.run(mc -> mc.gui.screen().onClose());
		t.waitTicks(3);
		HudModule cps = hud(t, "cps");
		int[] cpsAt = center(t, cps);
		t.run(mc -> HudInteraction.click(new MouseButtonEvent(cpsAt[0], cpsAt[1], new MouseButtonInfo(RIGHT, 0))));
		t.waitTicks(3);
		t.check("Rechtsklick auf ein Element öffnet seine Einstellungen", "cps".equals(t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.openModuleId() : null)));
		t.run(mc -> mc.gui.screen().onClose());
		t.waitTicks(3);

		// Rüstung und Effekte: Details im Tooltip
		int[] item = hotspotCenter(t, armor, "item:0");
		t.moveMouse(item[0], item[1]);
		t.waitTicks(3);
		tooltip = t.compute(mc -> HudInteraction.lastTooltip());
		t.check("Tooltip der Rüstung mit Haltbarkeit (" + tooltip + ")", tooltip.stream().anyMatch(l -> l.startsWith("Haltbarkeit")));
		t.screenshot("heldix-hud-09-chat-tooltip-ruestung");
		int[] effect = hotspotCenter(t, effects, "effect:0");
		t.moveMouse(effect[0], effect[1]);
		t.waitTicks(3);
		tooltip = t.compute(mc -> HudInteraction.lastTooltip());
		t.check("Tooltip der Effekte mit Restzeit (" + tooltip + ")", tooltip.stream().anyMatch(l -> l.startsWith("Restzeit")));
		t.screenshot("heldix-hud-10-chat-tooltip-effekte");

		// Wegpunkt-Markierung: Tooltip und Klick öffnet die Wegpunkte
		t.serverCommand("tp @a 0 -60 0 0 0");
		t.run(mc -> {
			// anklickbare Namen in Server-Meldungen hätten in der Bildmitte Vorrang: Chat leeren
			mc.gui.hud.getChat().clearMessages(false);
			Waypoints.current(mc).removeIf(w -> true);
			Waypoints.Waypoint ahead = Waypoints.add(mc, "Testpunkt");
			ahead.z += 12;
			Waypoints.save();
		});
		t.waitTicks(5);
		List<float[]> markers = t.compute(mc -> WaypointsModule.lastMarkers);
		t.check("Wegpunkt-Markierung sichtbar", markers.size() == 1);
		if (markers.size() == 1) {
			float[] marker = markers.getFirst();
			int mx = Math.round(marker[0]);
			int my = Math.round(marker[1]) - 20;
			t.moveMouse(mx, my);
			t.waitTicks(3);
			t.log("Markierung bei " + mx + "/" + my + ": Treffer " + t.compute(mc -> ModuleManager.waypoints.markerAt(mx, my)) + ", Element "
					+ t.compute(mc -> HudInteraction.moduleAt(mx, my)) + ", bedienbar " + t.compute(mc -> HudInteraction.active()) + ", Maus "
					+ t.compute(mc -> mc.mouseHandler.getScaledXPos(mc.getWindow()) + "/" + mc.mouseHandler.getScaledYPos(mc.getWindow())));
			t.check("Maus über der Wegpunkt-Markierung (" + t.compute(mc -> HudInteraction.hoveredId()) + ", " + t.compute(mc -> HudInteraction.lastTooltip()) + ")",
					"waypoint".equals(t.compute(mc -> HudInteraction.hoveredId())) && t.compute(mc -> HudInteraction.lastTooltip()).contains("Testpunkt"));
			t.click(mx, my);
			t.waitTicks(3);
			t.check("Klick auf die Markierung öffnet die Wegpunkte", "WAYPOINTS".equals(t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.currentTab() : null)));
			t.run(mc -> mc.gui.screen().onClose());
			t.waitTicks(3);
		}
		t.run(mc -> {
			Waypoints.current(mc).removeIf(w -> true);
			Waypoints.save();
		});

		// Im Chat ausblenden: dann nicht bedienbar
		t.run(mc -> HeldixConfig.get().hudHideChat = true);
		t.waitTicks(3);
		t.check("Im Chat ausgeblendet: keine Elemente, nicht bedienbar", !t.compute(mc -> dev.heldixclient.hud.HudRenderer.widgetsVisible(mc)) && !t.compute(mc -> HudInteraction.active()));
		t.run(mc -> HeldixConfig.get().hudHideChat = false);
		t.setScreen(() -> null);
		t.waitTicks(3);
		// F3: ausblenden
		t.run(mc -> mc.debugEntries.setOverlayVisible(true));
		t.waitTicks(3);
		t.check("Mit F3 ausgeblendet", !t.compute(mc -> dev.heldixclient.hud.HudRenderer.widgetsVisible(mc)));
		t.run(mc -> mc.debugEntries.setOverlayVisible(false));
		t.waitTicks(3);

		// Taste „HUD bedienen“ (ohne Standardtaste): Maus frei, ohne Chat
		t.check("Taste „HUD bedienen“ hat keine Standardbelegung", t.compute(mc -> HeldixClient.hudKey.getDefaultKey().equals(InputConstants.UNKNOWN)));
		t.run(mc -> {
			HeldixClient.hudKey.setKey(InputConstants.Type.KEYBOARD.getOrCreate(InputConstants.KEY_Y));
			KeyMapping.resetMapping();
			HudInteraction.clearLastAction();
		});
		t.pressKey(InputConstants.KEY_Y);
		t.waitTicks(3);
		t.check("Kurz drücken öffnet „HUD bedienen“ (Maus frei, kein Chat)", t.compute(mc -> mc.gui.screen() instanceof HudInteractScreen && !mc.mouseHandler.isMouseGrabbed()));
		cc = center(t, coordinates);
		t.moveMouse(cc[0], cc[1]);
		t.waitTicks(3);
		t.check("„HUD bedienen“: Tooltip über den Koordinaten", t.compute(mc -> HudInteraction.lastTooltip()).stream().anyMatch(l -> l.equals("Klick: kopieren")));
		t.screenshot("heldix-hud-11-hud-bedienen");
		t.click(cc[0], cc[1]);
		t.check("„HUD bedienen“: Klick kopiert die Koordinaten", "coordinates:copy".equals(t.compute(mc -> HudInteraction.lastAction())));
		t.check("Klick erreicht das Spiel nicht (kein Schlag)", t.compute(mc -> !mc.player.isSwinging()));
		int[] emptySpot = {screen(t)[0] / 2, screen(t)[1] / 2};
		t.click(emptySpot[0], emptySpot[1]);
		t.check("Klick daneben bleibt im HUD-Modus", t.compute(mc -> mc.gui.screen() instanceof HudInteractScreen && !mc.player.isSwinging()));
		t.pressKey(InputConstants.KEY_Y);
		t.waitTicks(2);
		t.check("Nochmal drücken beendet „HUD bedienen“", t.compute(mc -> mc.gui.screen() == null));
		// gedrückt halten: endet beim Loslassen
		t.run(mc -> mc.keyboardHandler.keyPress(mc.getWindow().handle(), InputConstants.PRESS, new KeyEvent(InputConstants.KEY_Y, 0, 0)));
		t.waitTicks(3);
		t.check("Halten öffnet „HUD bedienen“", t.compute(mc -> mc.gui.screen() instanceof HudInteractScreen));
		t.waitTicks(10);
		t.run(mc -> mc.keyboardHandler.keyPress(mc.getWindow().handle(), InputConstants.RELEASE, new KeyEvent(InputConstants.KEY_Y, 0, 0)));
		t.waitTicks(2);
		t.check("Loslassen nach dem Halten beendet es", t.compute(mc -> mc.gui.screen() == null));
		t.run(mc -> {
			HeldixClient.hudKey.setKey(InputConstants.UNKNOWN);
			KeyMapping.resetMapping();
		});
		t.serverCommand("tp @a 0 -60 0 0 0");
	}

	// ======================================================================================
	// HUD-API (Stufe 5): eigenes Test-Element mit Klick, Tooltip, Stil-Optionen, neuen Zeichenhilfen
	// ======================================================================================

	private static void api(TestContext t) {
		LoadedAddon addon = t.compute(mc -> AddonManager.addons().stream().filter(a -> "uhrzeit".equals(a.id()) && a.isActive()).findFirst().orElse(null));
		t.check("Uhrzeit-Addon für den API-Test aktiv", addon != null);
		HeldixApi api = addon.api();
		int errors = t.compute(mc -> addon.errorCount());
		List<HudClick> clicks = new CopyOnWriteArrayList<>();
		AtomicReference<HudStyle> seenStyle = new AtomicReference<>();
		AtomicReference<String> seen = new AtomicReference<>("");
		AtomicInteger interactiveFrames = new AtomicInteger();
		AtomicReference<Boolean> sent = new AtomicReference<>();
		HudRenderer renderer = new HudRenderer() {
			@Override
			public void render(HudCanvas c) {
				HudStyle style = c.style();
				seenStyle.set(style);
				c.panel(0, 0, 120, 40);
				c.text("API-Test", style.padding(), 4, style.labelColor(), style.textStyle(), style.shadow());
				List<String> lines = c.wrap("Ein Text, der umbricht", 60, HudCanvas.TextStyle.SMALL);
				c.clippedText("abgeschnittener langer Text", 4, 15, 40, style.textColor(), HudCanvas.TextStyle.SMALL);
				c.pushClip(0, 0, 120, 40);
				c.progressBar(4, 28, 60, 3, 0.6f, 0x33FFFFFF, style.accent());
				c.popClip();
				c.hotspot("feld", 70, 14, 20, 20, "Testfeld\nzweite Zeile");
				boolean hovered = c.iconButton("knopf", "star", 96, 14, 18, style.textColor(), "Knopf");
				if (c.interactive()) interactiveFrames.incrementAndGet();
				seen.set("wrap=" + lines.size() + " lh=" + c.lineHeight(HudCanvas.TextStyle.TITLE) + " icon=" + c.hasIcon("star") + "/" + c.hasIcon("gibtsnicht")
						+ " hover=" + (hovered || c.hovered(96, 14, 18, 18)));
			}

			@Override
			public boolean onClick(HudClick click) {
				clicks.add(click);
				if (click.button() == HudClick.RIGHT) return false;
				if ("knopf".equals(click.hotspot())) sent.set(api.sendChatMessage("API-Test Klick"));
				if ("feld".equals(click.hotspot())) click.insertIntoChat("[feld]");
				return true;
			}

			@Override
			public void onHover(HudHover hover) {
				if ("knopf".equals(hover.hotspot())) {
					hover.tooltip("Knopf aus onHover", "x " + Math.round(hover.x()));
					hover.cursor(HudHover.Cursor.CROSSHAIR);
				}
			}
		};
		ModuleHandle handle = t.compute(mc -> api.registerHudModule(ModuleSpec.of("api-test", "API-Test", "Autotest der HUD-API").at(150, 70).withIcon("star"), renderer));
		BooleanSupplier compact = t.compute(mc -> handle.addStyleToggle("compact", "Kompakt", false));
		IntSupplier variant = t.compute(mc -> handle.addStyleChoice("variant", "Variante", List.of("Eins", "Zwei"), 0));
		IntSupplier tint = t.compute(mc -> handle.addStyleColor("tint", "Tönung", 0xFF34D399));
		HudModule module = hud(t, "uhrzeit:api-test");
		t.run(mc -> {
			module.setEnabled(true);
			module.resetLayout();
		});
		t.setScreen(() -> null);
		t.waitTicks(4);
		t.check("Test-Element gezeichnet (" + module.width() + "×" + module.height() + ")", t.compute(mc -> module.width() >= 120 && module.height() >= 40));
		t.check("canvas.style() liefert den HUD-Stil", seenStyle.get() != null && seenStyle.get().kind() == HudStyle.Kind.HELDIX && seenStyle.get().background() != 0);
		t.check("Neue Zeichenhilfen ohne Fehler (" + seen.get() + ")", seen.get().startsWith("wrap=2 lh=12 icon=true/false") && t.compute(mc -> addon.errorCount()) == errors);
		t.check("Beim Spielen nicht interactive()", interactiveFrames.get() == 0);
		t.check("Stil-Optionen im Rechtsklick-Menü und im Untermenü", t.compute(mc -> module.styleOptions().stream().map(Setting::label).toList()
				.equals(List.of("Kompakt", "Variante", "Tönung")) && module.settings().stream().anyMatch(s -> s.label().equals("Tönung"))));

		openChat(t);
		t.check("Bei offenem Chat interactive()", interactiveFrames.get() > 0);
		int[] knopf = hotspotCenter(t, module, "knopf");
		t.moveMouse(knopf[0], knopf[1]);
		t.waitTicks(3);
		t.check("onHover setzt Tooltip und Mauszeiger (" + t.compute(mc -> HudInteraction.lastTooltip()) + ", " + t.compute(mc -> HudInteraction.lastCursor()) + ")",
				t.compute(mc -> HudInteraction.lastTooltip()).contains("Knopf aus onHover") && "CROSSHAIR".equals(t.compute(mc -> HudInteraction.lastCursor())));
		t.check("canvas.hovered() über dem Knopf", seen.get().endsWith("hover=true"));
		int[] feld = hotspotCenter(t, module, "feld");
		t.moveMouse(feld[0], feld[1]);
		t.waitTicks(3);
		// Unter Last kommt der neue Tooltip manchmal erst ein paar Bilder später an.
		t.waitSoft(mc -> HudInteraction.lastTooltip().equals(List.of("Testfeld", "zweite Zeile")) && "HAND".equals(HudInteraction.lastCursor()), 3);
		t.check("Tooltip aus dem Bereich (zwei Zeilen) und Hand (" + t.compute(mc -> HudInteraction.lastTooltip()) + ", " + t.compute(mc -> HudInteraction.lastCursor()) + ")",
				t.compute(mc -> HudInteraction.lastTooltip()).equals(List.of("Testfeld", "zweite Zeile")) && "HAND".equals(t.compute(mc -> HudInteraction.lastCursor())));
		t.screenshot("heldix-hud-12-api-hover");
		t.click(feld[0], feld[1]);
		t.check("onClick mit Bereich, lokaler Stelle und Taste", clicks.size() == 1 && "feld".equals(clicks.getFirst().hotspot()) && clicks.getFirst().button() == HudClick.LEFT
				&& clicks.getFirst().chatOpen() && Math.abs(clicks.getFirst().x() - 80) <= 2 && Math.abs(clicks.getFirst().y() - 24) <= 2);
		t.check("insertIntoChat fügt Text in die Eingabe ein", t.compute(mc -> input(mc).getValue()).contains("[feld]"));
		t.click(knopf[0], knopf[1]);
		t.check("Klick gilt als Aktion des Spielers: sendChatMessage erlaubt", Boolean.TRUE.equals(sent.get()));
		t.waitSoft(mc -> AutoTest.CHAT.stream().anyMatch(s -> s.contains("API-Test Klick")), 5);
		t.check("Nachricht vom Klick kam beim Server an", AutoTest.CHAT.stream().anyMatch(s -> s.contains("API-Test Klick")));
		int[] at = center(t, module);
		t.run(mc -> HudInteraction.click(new MouseButtonEvent(at[0], at[1], new MouseButtonInfo(RIGHT, SHIFT))));
		t.waitTicks(3);
		t.check("Rechtsklick (vom Addon nicht verbraucht) öffnet die Einstellungen; Umschalt wird gemeldet",
				"uhrzeit:api-test".equals(t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu ? menu.openModuleId() : null))
						&& clicks.getLast().button() == HudClick.RIGHT && clicks.getLast().shift());
		t.run(mc -> mc.gui.setScreen(null));

		// Stil-Optionen im HUD-Editor (dort nie bedienbar)
		HudEditorScreen editor = openEditor(t);
		int framesBefore = interactiveFrames.get();
		t.waitTicks(4);
		t.check("Im HUD-Editor nicht interactive()", interactiveFrames.get() == framesBefore);
		openMenuOn(t, module);
		choose(t, 0, "Optionen: API-Test");
		t.check("Addon-Optionen im Menü (" + labels(t, 1) + ")", labels(t, 1).equals(List.of("Kompakt", "Variante", "Tönung")));
		choose(t, 1, "Kompakt");
		t.check("Stil-Schalter aus dem Menü gesetzt", compact.getAsBoolean());
		choose(t, 1, "Variante");
		choose(t, 2, "Zwei");
		t.check("Stil-Auswahl aus dem Menü gesetzt", variant.getAsInt() == 1);
		key(t, InputConstants.KEY_LEFT, 0);
		choose(t, 1, "Tönung");
		int[] swatch = t.compute(mc -> menuOf(mc).swatchCenter(2, Setting.Color.PALETTE.indexOf(0xFFFBBF24)));
		hover(t, swatch[0], swatch[1]);
		press(t, swatch[0], swatch[1], LEFT, 0);
		t.check("Stil-Farbe aus dem Menü gesetzt", tint.getAsInt() == 0xFFFBBF24);
		key(t, InputConstants.KEY_ESCAPE, 0);
		key(t, InputConstants.KEY_ESCAPE, 0);
		key(t, InputConstants.KEY_ESCAPE, 0);
		t.check("Keine Addon-Fehler durch die HUD-API (" + t.compute(mc -> addon.errorCount()) + ")", t.compute(mc -> addon.errorCount()) == errors);
		t.run(mc -> module.setEnabled(false));
		t.setScreen(() -> null);
	}

	// ======================================================================================
	// Spotify: bedienbar bei offenem Chat (ohne die echte Musik zu steuern)
	// ======================================================================================

	private static void spotify(TestContext t) {
		Module found = t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals("spotify:spotify")).findFirst().orElse(null));
		LoadedAddon addon = t.compute(mc -> AddonManager.addons().stream().filter(a -> "spotify".equals(a.id()) && a.isActive()).findFirst().orElse(null));
		t.check("Spotify-Addon ab 2.2.0 aktiv (" + (addon == null ? "fehlt" : addon.version()) + ")", found instanceof HudModule && addon != null
				&& TestContext.versionAtLeast(addon.version(), "2.2.0"));
		HudModule spotify = (HudModule) found;
		int errors = t.compute(mc -> addon.errorCount());
		Setting.Choice layout = t.compute(mc -> (Setting.Choice) spotify.settings().stream().filter(s -> s instanceof Setting.Choice && s.label().equals("Darstellung"))
				.findFirst().orElseThrow());
		t.run(mc -> {
			spotify.setEnabled(true);
			spotify.resetLayout();
			layout.set().accept(0);
		});
		t.setScreen(() -> null);
		t.waitTicks(4);
		Set<String> playing = new HashSet<>(t.compute(mc -> spotify.hotspots().stream().map(HudModule.Hotspot::id).toList()));
		t.check("Beim Spielen keine Spotify-Knöpfe (" + playing + ")", !playing.contains("play-pause"));
		openChat(t);
		String[] names = {"kompakt", "gross", "titel"};
		for (int i = 0; i < 3; i++) {
			int choice = i;
			t.run(mc -> layout.set().accept(choice));
			t.waitTicks(4);
			Set<String> ids = new HashSet<>(t.compute(mc -> spotify.hotspots().stream().map(HudModule.Hotspot::id).toList()));
			t.check("Spotify " + names[i] + " bei offenem Chat mit Knöpfen (" + ids + ")", ids.containsAll(List.of("previous", "play-pause", "next")));
			int[] play = hotspotCenter(t, spotify, "play-pause");
			t.moveMouse(play[0], play[1]);
			t.waitTicks(3);
			List<String> tooltip = t.compute(mc -> HudInteraction.lastTooltip());
			t.check("Tooltip am Knopf Abspielen/Pause (" + tooltip + ")", !tooltip.isEmpty() && "HAND".equals(t.compute(mc -> HudInteraction.lastCursor())));
			t.screenshot("heldix-hud-13-spotify-" + names[i] + "-bedienbar");
		}
		t.run(mc -> layout.set().accept(0));
		t.waitTicks(4);
		// Klick auf den Titel: Song (oder Hinweis) nur im eigenen Chat – steuert keine Musik
		boolean hasTrack = t.compute(mc -> spotify.hotspots().stream().anyMatch(h -> h.id().equals("title")));
		if (hasTrack) {
			int[] title = hotspotCenter(t, spotify, "title");
			t.click(title[0], title[1]);
			t.waitTicks(3);
			List<String> newest = chat(t, 1);
			t.check("Klick auf den Titel zeigt den Song im Chat (" + newest + ")", !newest.isEmpty() && newest.getFirst().contains("♪"));
		} else {
			int[] card = center(t, spotify);
			t.moveMouse(card[0], card[1]);
			t.waitTicks(3);
			t.check("Ohne Song: Tooltip mit Hinweis (" + t.compute(mc -> HudInteraction.lastTooltip()) + ")", !t.compute(mc -> HudInteraction.lastTooltip()).isEmpty());
		}
		t.setScreen(() -> null);

		// Stil-Optionen des Addons im Rechtsklick-Menü
		openEditor(t);
		openMenuOn(t, spotify);
		choose(t, 0, "Optionen: Spotify");
		t.check("Spotify-Optionen im Menü (" + labels(t, 1) + ")", labels(t, 1).containsAll(List.of("Darstellung", "Cover anzeigen", "Fortschritt anzeigen", "Akzentfarbe")));
		choose(t, 1, "Darstellung");
		choose(t, 2, "Groß mit Cover");
		t.check("Darstellung über das Menü gewechselt", t.compute(mc -> layout.get().getAsInt()) == 1);
		t.waitTicks(3);
		t.screenshot("heldix-hud-14-spotify-menue");
		key(t, InputConstants.KEY_ESCAPE, 0);
		key(t, InputConstants.KEY_ESCAPE, 0);
		key(t, InputConstants.KEY_ESCAPE, 0);
		t.run(mc -> layout.set().accept(0));
		t.check("Spotify ohne Addon-Fehler (" + t.compute(mc -> addon.errorCount()) + ")", t.compute(mc -> addon.errorCount()) == errors);
		t.setScreen(() -> null);
	}
}
