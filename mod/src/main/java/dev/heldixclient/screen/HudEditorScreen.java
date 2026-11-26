package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.hud.HudAnchor;
import dev.heldixclient.hud.HudStyles;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.ContextMenu;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * HUD-Editor: Elemente verschieben (Einrasten an Rändern, Mitte, anderen Elementen und dem Raster, mit Hilfslinien),
 * mehrere auswählen (Umschalt+Klick oder Rahmen ziehen) und zusammen bewegen, über die Ecke oder das Mausrad skalieren,
 * mit den Pfeiltasten verschieben, rückgängig machen und wiederholen. Rechtsklick öffnet ein Menü: auf einem Element
 * Ausrichtung, Größe, Aussehen, Ebene und mehr, auf freier Fläche Elemente hinzufügen und Ansicht/Stil.
 */
public class HudEditorScreen extends Screen {
	private static final int SNAP = 5;
	private static final int EDGE = 2;
	/** Abstand beim Anlegen an ein anderes Element */
	private static final int NEIGHBOR_GAP = 2;
	public static final int GRID = 16;
	private static final int HANDLE = 6;
	private static final int PAD = 5;
	private static final int GAP = 4;
	private static final int BUTTON_H = 20;
	private static final int LIST_W = 176;
	private static final int LIST_HEAD = 26;
	private static final int LIST_ROW = 20;
	private static final int UNDO_LIMIT = 64;
	private static final String TITLE = "HUD-Editor";
	private static final List<Integer> SCALES = List.of(50, 75, 100, 125, 150, 200);
	private static final List<Integer> OPACITIES = List.of(25, 50, 75, 100);
	private static final String[] ANCHOR_NAMES = {"oben links", "oben mittig", "oben rechts", "Mitte links", "Mitte", "Mitte rechts", "unten links",
			"unten mittig", "unten rechts"};

	/** Stand aller HUD-Elemente und des globalen Stils für Rückgängig/Wiederholen */
	private record Snapshot(Map<HudModule, HeldixConfig.ModuleState> modules, int style, float opacity, float scale, int accent, boolean background) {
	}

	/** Hilfslinie: senkrecht bei pos (von–bis in y) oder waagrecht */
	public record Guide(boolean vertical, float pos, float from, float to) {
	}

	private final Screen parent;
	private final Deque<Snapshot> undo = new ArrayDeque<>();
	private final Deque<Snapshot> redo = new ArrayDeque<>();
	/** Zustand vor dem laufenden Ziehen/Skalieren bzw. vor einer Menü-Aktion */
	private Snapshot pending;
	private Snapshot pendingMenu;

	private final Set<HudModule> selection = new LinkedHashSet<>();
	private HudModule primary;
	private boolean dragging;
	private double dragStartX;
	private double dragStartY;
	private final Map<HudModule, int[]> dragOrigins = new HashMap<>();
	private HudModule resizing;
	private float resizeScale;
	private int resizeW;
	private int resizeH;
	private int resizeX;
	private int resizeY;
	private boolean marquee;
	private double marqueeX0;
	private double marqueeY0;
	private double marqueeX1;
	private double marqueeY1;
	private Set<HudModule> marqueeBase = Set.of();
	private final List<Guide> guides = new ArrayList<>();

	private final ContextMenu menu = new ContextMenu(this::beforeMenuChange, this::afterMenuChange);
	/** Stelle des Rechtsklicks auf freier Fläche (dort erscheint „Widget hinzufügen“) */
	private int menuX;
	private int menuY;
	/** gerade hinzugefügtes Element: nach dem ersten Zeichnen (dann ist seine Größe bekannt) genau an die Stelle setzen */
	private HudModule placeAfterDraw;

	private boolean listOpen;
	private double listScroll;
	private final List<ActionButton> toolbar = new ArrayList<>();
	private ActionButton listButton;
	private ActionButton gridButton;
	private ActionButton snapButton;
	private ActionButton undoButton;
	private ActionButton redoButton;
	private boolean showTitle;
	private int barX;
	private int barY;
	private int barW;
	private int barH;

	public HudEditorScreen(Screen parent) {
		super(Component.literal(TITLE));
		this.parent = parent;
	}

	private static HeldixConfig.Data config() {
		return HeldixConfig.get();
	}

	// ======================================================================================
	// Aufbau
	// ======================================================================================

	@Override
	protected void init() {
		toolbar.clear();
		menu.close();
		listButton = tool("list", "Elemente", () -> {
			listOpen = !listOpen;
			listScroll = 0;
		});
		gridButton = tool("grid", "Raster (G)", () -> {
			config().hudGrid = !config().hudGrid;
			HeldixConfig.save();
		});
		snapButton = tool("magnet", "Einrasten", () -> {
			config().hudSnap = !config().hudSnap;
			HeldixConfig.save();
		});
		undoButton = tool("undo", "Rückgängig (Strg+Z)", this::undo);
		redoButton = tool("refresh", "Wiederholen (Strg+Y)", this::redo);
		tool("reset", "Standard: alle Positionen und Größen", this::resetAll);
		String done = "Fertig";
		ActionButton finish = new ActionButton(0, 0, ActionButton.widthFor(done, "check"), BUTTON_H, done, true, this::onClose).withIcon("check");
		toolbar.add(finish);
		addRenderableWidget(finish);
		layoutToolbar();
	}

	/** Werkzeug als Icon-Knopf; der Name erscheint als Tooltip */
	private ActionButton tool(String icon, String label, Runnable action) {
		ActionButton button = ActionButton.icon(0, 0, BUTTON_H, icon, label, action);
		toolbar.add(button);
		addRenderableWidget(button);
		return button;
	}

	/** Werkzeugleiste mittig an einer Stelle ohne HUD-Elemente; bei schmalen Fenstern zweizeilig. */
	private void layoutToolbar() {
		int maxW = width - 16 - PAD * 2;
		int titleW = Ui.width(TITLE, Ui.Font.LABEL) + 30;
		int total = -GAP;
		for (ActionButton button : toolbar) total += button.getWidth() + GAP;
		showTitle = total + titleW <= maxW;

		List<List<ActionButton>> rows = new ArrayList<>();
		List<ActionButton> row = new ArrayList<>();
		int rowW = showTitle ? titleW : 0;
		int widest = 0;
		for (ActionButton button : toolbar) {
			int add = (row.isEmpty() ? 0 : GAP) + button.getWidth();
			if (!row.isEmpty() && rowW + add > maxW) {
				rows.add(row);
				widest = Math.max(widest, rowW);
				row = new ArrayList<>();
				rowW = 0;
				add = button.getWidth();
			}
			row.add(button);
			rowW += add;
		}
		rows.add(row);
		widest = Math.max(widest, rowW);

		barW = widest + PAD * 2;
		barH = rows.size() * (BUTTON_H + GAP) - GAP + PAD * 2;
		int[] position = freeBarPosition(barW, barH);
		barX = position[0];
		barY = position[1];
		for (int r = 0; r < rows.size(); r++) {
			int x = barX + PAD + (r == 0 && showTitle ? titleW : 0);
			int y = barY + PAD + r * (BUTTON_H + GAP);
			for (ActionButton button : rows.get(r)) {
				button.setX(x);
				button.setY(y);
				x += button.getWidth() + GAP;
			}
		}
	}

	/**
	 * Stelle der Werkzeugleiste, an der sie kein HUD-Element verdeckt (mit Platz für die Hinweiszeile):
	 * bevorzugt oben, über der Schnellleiste oder neben der Mitte, jeweils mittig, rechts oder links;
	 * sonst die erste freie Höhe von oben. Ist nirgends frei, die Stelle mit der kleinsten Überdeckung.
	 */
	private int[] freeBarPosition(int w, int h) {
		int lowest = Math.max(6, height - h - 17 - (minecraft.level != null ? 40 : 0));
		List<Integer> rows = new ArrayList<>(List.of(6, height - h - 50, height / 2 + 30, height / 2 - h - 30));
		for (int y = 6; y <= lowest; y += 4) rows.add(y);
		int[] columns = {(width - w) / 2, width - w - 6, 6};
		int[] best = {columns[0], 6};
		long bestOverlap = Long.MAX_VALUE;
		for (int y : rows) {
			if (y < 6 || y > lowest) continue;
			for (int x : columns) {
				long overlap = overlap(x, y - 13, w, h + 26);
				if (overlap == 0) return new int[] {x, y};
				if (overlap < bestOverlap) {
					bestOverlap = overlap;
					best = new int[] {x, y};
				}
			}
		}
		return best;
	}

	/** Fläche, mit der das Rechteck sichtbare HUD-Elemente überdeckt (gezogene zählen nicht). */
	private long overlap(int x, int y, int w, int h) {
		long total = 0;
		for (HudModule module : ModuleManager.hud()) {
			if (!module.isEnabled() || (dragging && selection.contains(module)) || module == resizing) continue;
			int ox = Math.min(x + w, module.x() + module.width() + 2) - Math.max(x, module.x() - 2);
			int oy = Math.min(y + h, module.y() + module.height() + 2) - Math.max(y, module.y() - 2);
			if (ox > 0 && oy > 0) total += (long) ox * oy;
		}
		return total;
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (minecraft.level == null) {
			if (config().heldixBackground) {
				Ui.background(g, width, height, 1f);
			} else {
				extractPanorama(g, delta);
			}
			g.fill(0, 0, width, height, 0x99060A13);
		} else {
			g.fill(0, 0, width, height, 0x2E060A13);
		}
		if (config().hudGrid) {
			for (int x = GRID; x < width; x += GRID) Ui.vline(g, x, 0, height, 0x0EFFFFFF);
			for (int y = GRID; y < height; y += GRID) Ui.hline(g, 0, width, y, 0x0EFFFFFF);
		}
		if (config().hudGrid || config().hudGuides) {
			Ui.vline(g, width / 2f, 0, height, 0x553B82F6);
			Ui.hline(g, 0, width, height / 2f, 0x553B82F6);
		}
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		selection.removeIf(module -> !module.isEnabled());
		if (primary != null && !selection.contains(primary)) primary = selection.isEmpty() ? null : selection.iterator().next();
		boolean overUi = menu.isOpen() || overList(mouseX, mouseY) || overToolbar(mouseX, mouseY);
		HudModule hovered = dragging ? null : overUi ? null : moduleAt(mouseX, mouseY);

		// Elemente in der Reihenfolge der Ebenen, darüber die Rahmen
		List<HudModule> ordered = ModuleManager.hudByLayer();
		for (HudModule module : ordered) {
			if (module.isEnabled()) module.extractPreview(g, minecraft);
		}
		if (HudModule.takeMigrated()) HeldixConfig.save();
		if (placeAfterDraw != null) {
			HudModule module = placeAfterDraw;
			placeAfterDraw = null;
			module.setPosition(Math.clamp(menuX, 0, Math.max(0, width - module.width())), Math.clamp(menuY, 0, Math.max(0, height - module.height())));
			HeldixConfig.save();
		}
		// beim Skalieren über die Ecke bleibt die linke obere Ecke stehen
		if (resizing != null) resizing.setPosition(resizeX, resizeY);
		for (HudModule module : ordered) {
			if (!module.isEnabled()) continue;
			boolean selected = selection.contains(module);
			int color = selected ? Ui.ACCENT : module == hovered ? 0xB3FFFFFF : 0x40FFFFFF;
			Ui.outline(g, module.x() - 2, module.y() - 2, module.width() + 4, module.height() + 4, 4, color);
			if (selected) Ui.rect(g, module.x() - 2, module.y() - 2, module.width() + 4, module.height() + 4, 4, 0x143B82F6);
		}
		if (primary != null && !dragging) drawAnchor(g, primary);
		if (dragging || resizing != null) {
			for (Guide guide : guides) {
				if (guide.vertical()) Ui.vline(g, guide.pos(), guide.from(), guide.to(), Ui.ACCENT_TEXT);
				else Ui.hline(g, guide.from(), guide.to(), guide.pos(), Ui.ACCENT_TEXT);
			}
		}
		if (marquee) {
			float x0 = (float) Math.min(marqueeX0, marqueeX1);
			float y0 = (float) Math.min(marqueeY0, marqueeY1);
			float w = (float) Math.abs(marqueeX1 - marqueeX0);
			float h = (float) Math.abs(marqueeY1 - marqueeY0);
			Ui.rect(g, x0, y0, w, h, 2, 0x263B82F6);
			Ui.outline(g, x0, y0, w, h, 2, Ui.ACCENT_LINE);
		}
		if (primary != null && selection.size() == 1) drawHandle(g, primary, mouseX, mouseY);
		if (hovered != null && !selection.contains(hovered)) nameTag(g, hovered, hovered.name(), 0xF01B2232);
		if (primary != null) {
			String tag = selection.size() > 1 ? selection.size() + " Elemente" : primary.name() + (resizing != null ? "  " + percent(primary.scale()) : "");
			nameTag(g, primary, tag, Ui.ACCENT);
		}

		// Werkzeugleiste
		listButton.setPrimary(listOpen);
		gridButton.setPrimary(config().hudGrid);
		snapButton.setPrimary(config().hudSnap);
		undoButton.active = !undo.isEmpty();
		redoButton.active = !redo.isEmpty();
		layoutToolbar();
		Ui.shadow(g, barX, barY, barW, barH, 0.45f);
		Ui.rect(g, barX, barY, barW, barH, 10, 0xF20F1420);
		Ui.outline(g, barX, barY, barW, barH, 10, Ui.LINE_STRONG);
		if (showTitle) {
			Ui.icon(g, "hud", barX + PAD + 5, barY + (barH - 11) / 2f, 11, Ui.ACCENT_TEXT);
			Ui.text(g, TITLE, barX + PAD + 21, barY + (barH - 8) / 2, Ui.TEXT, Ui.Font.LABEL);
		}
		drawHelp(g);

		super.extractRenderState(g, menu.isOpen() ? -1 : mouseX, menu.isOpen() ? -1 : mouseY, delta);
		if (listOpen) {
			g.nextStratum();
			drawList(g, mouseX, mouseY);
		}
		menu.render(g, mouseX, mouseY);
		if (!menu.isOpen()) Ui.drawTooltip(g, width, height);
	}

	private static String percent(float scale) {
		return Math.round(scale * 100) + " %";
	}

	private static String anchorName(HudAnchor anchor) {
		return ANCHOR_NAMES[anchor.ordinal()];
	}

	private void nameTag(GuiGraphicsExtractor g, HudModule module, String text, int color) {
		int tagW = Ui.width(text, Ui.Font.SMALL) + 22;
		int tagX = Math.clamp(module.x() - 2, 0, Math.max(0, width - tagW));
		int tagY = module.y() - 16 >= 0 ? module.y() - 16 : module.y() + module.height() + 5;
		Ui.rect(g, tagX, tagY, tagW, 12, 6, color);
		Ui.icon(g, module.icon(), tagX + 4, tagY + 2, 8, 0xFFFFFFFF);
		Ui.text(g, text, tagX + 15, tagY + 2, Ui.TEXT, Ui.Font.SMALL);
	}

	/** Bezugspunkt am Bildschirmrand und Linie zum Element (zeigt, woran das Element „hängt“) */
	private void drawAnchor(GuiGraphicsExtractor g, HudModule module) {
		HudAnchor anchor = module.anchor();
		float ax = Math.clamp(anchor.screenX(width), 3, width - 3);
		float ay = Math.clamp(anchor.screenY(height), 3, height - 3);
		HudStyles.Resolved style = HudStyles.resolve(module);
		float rx = module.x() + HudAnchor.fraction(style.alignIndex()) * module.width();
		float ry = module.y() + HudAnchor.fraction(anchor.row) * module.height();
		int line = 0x663B82F6;
		if (Math.abs(rx - ax) > 1) Ui.hline(g, Math.min(ax, rx), Math.max(ax, rx), ay, line);
		if (Math.abs(ry - ay) > 1) Ui.vline(g, rx, Math.min(ay, ry), Math.max(ay, ry), line);
		Ui.circle(g, ax, ay, 2.5f, Ui.ACCENT);
		Ui.circle(g, rx, ry, 2f, 0xFFFFFFFF);
	}

	/** Griff unten rechts am ausgewählten Element zum Skalieren */
	private void drawHandle(GuiGraphicsExtractor g, HudModule module, int mouseX, int mouseY) {
		float cx = module.x() + module.width() + 2;
		float cy = module.y() + module.height() + 2;
		boolean active = resizing == module || onHandle(module, mouseX, mouseY);
		Ui.circle(g, cx, cy, active ? 5 : 4, Ui.ACCENT);
		Ui.circle(g, cx, cy, active ? 3 : 2.5f, 0xFFFFFFFF);
	}

	private boolean onHandle(HudModule module, double mouseX, double mouseY) {
		int hx = module.x() + module.width() + 2 - HANDLE / 2;
		int hy = module.y() + module.height() + 2 - HANDLE / 2;
		return Ui.inside(mouseX, mouseY, hx - 3, hy - 3, HANDLE + 6, HANDLE + 6);
	}

	/** Hinweiszeile unter (bzw. über) der Werkzeugleiste */
	private void drawHelp(GuiGraphicsExtractor g) {
		String help;
		if (selection.size() > 1) {
			help = selection.size() + " Elemente  ·  ziehen oder Pfeile: zusammen verschieben  ·  Rechtsklick: Menü";
		} else if (primary != null) {
			help = primary.name() + "  ·  " + anchorName(primary.anchor()) + "  ·  X " + primary.x() + "  Y " + primary.y() + "  ·  " + percent(primary.scale())
					+ "  ·  Rechtsklick: Menü";
		} else {
			help = "Ziehen: verschieben · Umschalt/Rahmen: mehrere · Rechtsklick: Menü";
		}
		// nicht breiter als die Leiste, damit keine Elemente verdeckt werden
		help = Ui.ellipsize(help, Math.max(barW - 12, 120), Ui.Font.SMALL);
		int hw = Ui.width(help, Ui.Font.SMALL);
		int hx = Math.clamp(barX + (barW - hw) / 2, 12, Math.max(12, width - 12 - hw));
		int hy = barY < height / 2 ? barY + barH + 5 : barY - 15;
		Ui.rect(g, hx - 6, hy - 2, hw + 12, 12, 6, 0xB3060A13);
		Ui.text(g, help, hx, hy + 1, Ui.MUTED, Ui.Font.SMALL);
	}

	// --- Elemente-Liste -------------------------------------------------------------------

	private int listX() {
		return width - LIST_W - 8;
	}

	private int listY() {
		return barY < height / 2 ? barY + barH + 22 : 8;
	}

	private int listH() {
		int bottom = barY < height / 2 ? height - 8 : barY - 22;
		return Math.max(LIST_HEAD + LIST_ROW, Math.min(LIST_HEAD + ModuleManager.hud().size() * LIST_ROW + 6, bottom - listY()));
	}

	private int listMaxScroll() {
		return Math.max(0, LIST_HEAD + ModuleManager.hud().size() * LIST_ROW + 6 - listH());
	}

	private boolean overList(double mouseX, double mouseY) {
		return listOpen && Ui.inside(mouseX, mouseY, listX(), listY(), LIST_W, listH());
	}

	private boolean overToolbar(double mouseX, double mouseY) {
		return Ui.inside(mouseX, mouseY, barX, barY, barW, barH);
	}

	private void drawList(GuiGraphicsExtractor g, int mouseX, int mouseY) {
		int x = listX();
		int y = listY();
		int h = listH();
		List<HudModule> modules = ModuleManager.hud();
		Ui.shadow(g, x, y, LIST_W, h, 0.5f);
		Ui.rect(g, x, y, LIST_W, h, 10, 0xF50F1420);
		Ui.outline(g, x, y, LIST_W, h, 10, Ui.LINE_STRONG);
		long visible = modules.stream().filter(HudModule::isEnabled).count();
		Ui.text(g, "Elemente", x + 10, y + 9, Ui.TEXT, Ui.Font.LABEL);
		Ui.textRight(g, visible + " von " + modules.size() + " sichtbar", x + LIST_W - 10, y + 10, Ui.FAINT, Ui.Font.SMALL);
		Ui.hline(g, x + 1, x + LIST_W - 1, y + LIST_HEAD - 3, Ui.LINE);

		g.enableScissor(x, y + LIST_HEAD - 2, x + LIST_W, y + h - 3);
		int rowY = y + LIST_HEAD - (int) listScroll;
		for (HudModule module : modules) {
			boolean hover = !menu.isOpen() && Ui.inside(mouseX, mouseY, x + 4, rowY, LIST_W - 8, LIST_ROW - 2) && mouseY < y + h - 3 && mouseY >= y + LIST_HEAD - 2;
			if (selection.contains(module)) Ui.rect(g, x + 4, rowY, LIST_W - 8, LIST_ROW - 2, 6, Ui.ACCENT_SOFT);
			else if (hover) Ui.rect(g, x + 4, rowY, LIST_W - 8, LIST_ROW - 2, 6, Ui.SURFACE_HOVER);
			Ui.toggle(g, x + 9, rowY + 4, module.isEnabled() ? 1f : 0f);
			Ui.icon(g, module.icon(), x + 33, rowY + 4, 10, module.isEnabled() ? Ui.ACCENT_TEXT : Ui.FAINT);
			String name = Ui.ellipsize(module.name(), LIST_W - 48 - 24, Ui.Font.BODY);
			Ui.text(g, name, x + 48, rowY + 5, module.isEnabled() ? Ui.TEXT : Ui.FAINT, Ui.Font.BODY);
			boolean gearHover = hover && mouseX >= x + LIST_W - 24;
			if (gearHover) Ui.rect(g, x + LIST_W - 24, rowY + 1, 16, 16, 5, Ui.SURFACE_STRONG);
			Ui.icon(g, "options", x + LIST_W - 21, rowY + 4, 10, gearHover ? Ui.TEXT : Ui.FAINT);
			rowY += LIST_ROW;
		}
		g.disableScissor();
	}

	private void listClick(double mouseX, double mouseY) {
		int x = listX();
		int y = listY();
		if (mouseY < y + LIST_HEAD - 2 || mouseY >= y + listH() - 2) return;
		int index = (int) ((mouseY - (y + LIST_HEAD) + listScroll) / LIST_ROW);
		List<HudModule> modules = ModuleManager.hud();
		if (index < 0 || index >= modules.size()) return;
		HudModule module = modules.get(index);
		click();
		if (mouseX >= x + LIST_W - 24) {
			openSettings(module);
		} else if (mouseX < x + 32) {
			pushUndo(capture());
			module.setEnabled(!module.isEnabled());
		} else {
			if (!module.isEnabled()) {
				pushUndo(capture());
				module.setEnabled(true);
			}
			selectOnly(module);
		}
	}

	// ======================================================================================
	// Auswahl
	// ======================================================================================

	private HudModule moduleAt(double mouseX, double mouseY) {
		List<HudModule> ordered = ModuleManager.hudByLayer();
		for (int i = ordered.size() - 1; i >= 0; i--) {
			HudModule module = ordered.get(i);
			if (module.isEnabled() && Ui.inside(mouseX, mouseY, module.x() - 2, module.y() - 2, module.width() + 4, module.height() + 4)) {
				return module;
			}
		}
		return null;
	}

	private void selectOnly(HudModule module) {
		selection.clear();
		primary = module;
		if (module != null) selection.add(module);
	}

	private List<HudModule> visibleModules() {
		return ModuleManager.hud().stream().filter(HudModule::isEnabled).toList();
	}

	private void openSettings(HudModule module) {
		selectOnly(module);
		menu.close();
		minecraft.gui.setScreen(new HeldixMenuScreen(this, Shell.Page.MODULES, module));
	}

	private void click() {
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	// ======================================================================================
	// Rechtsklick-Menü
	// ======================================================================================

	private void beforeMenuChange() {
		pendingMenu = capture();
	}

	private void afterMenuChange() {
		if (pendingMenu != null && !pendingMenu.equals(capture())) pushUndo(pendingMenu);
		pendingMenu = null;
		HeldixConfig.save();
	}

	/** Menü für die Auswahl (an der Maus oder, mit der Tastatur, am Element) */
	private void openWidgetMenu(int x, int y, boolean keyboard) {
		menu.open(widgetItems(), x, y, width, height);
		if (keyboard) menu.selectFirst();
	}

	private void openSpaceMenu(int x, int y, boolean keyboard) {
		menuX = x;
		menuY = y;
		menu.open(spaceItems(), x, y, width, height);
		if (keyboard) menu.selectFirst();
	}

	/** Wert für alle ausgewählten Elemente setzen */
	private void forSelection(Consumer<HudModule> action) {
		for (HudModule module : List.copyOf(selection)) action.accept(module);
	}

	private boolean allSelected(Function<HudModule, Boolean> test) {
		return !selection.isEmpty() && selection.stream().allMatch(test::apply);
	}

	private List<ContextMenu.Item> widgetItems() {
		HudModule main = primary;
		List<ContextMenu.Item> items = new ArrayList<>();
		items.add(new ContextMenu.Header(selection.size() > 1 ? selection.size() + " Elemente" : main.name(), selection.size() > 1 ? "hud" : main.icon()));

		items.add(new ContextMenu.Submenu("Ausrichtung", "list", () -> alignLabel(main.styleValue(HudStyles.ALIGN)), () -> {
			List<ContextMenu.Item> list = new ArrayList<>();
			for (String align : HudStyles.ALIGNS) {
				list.add(new ContextMenu.Radio(alignLabel(align), () -> allSelected(m -> align.equals(Objects.requireNonNullElse(m.styleValue(HudStyles.ALIGN), "auto"))),
						() -> forSelection(m -> {
							int x = m.x();
							int y = m.y();
							m.setStyleValue(HudStyles.ALIGN, align.equals("auto") ? null : align);
							m.setPosition(x, y);
						})));
			}
			return list;
		}));
		items.add(new ContextMenu.Submenu("Skalierung", "zoom", () -> percent(main.scale()), () -> {
			List<ContextMenu.Item> list = new ArrayList<>();
			for (int percent : SCALES) {
				list.add(new ContextMenu.Radio(percent + " %", () -> allSelected(m -> Math.round(m.scale() * 100) == percent),
						() -> forSelection(m -> m.setScale(percent / 100.0))));
			}
			list.add(new ContextMenu.Separator());
			list.add(new ContextMenu.Radio("Kleiner (−5 %)", () -> false, () -> forSelection(m -> m.setScale(m.scale() - 0.05))));
			list.add(new ContextMenu.Radio("Größer (+5 %)", () -> false, () -> forSelection(m -> m.setScale(m.scale() + 0.05))));
			return list;
		}));
		items.add(new ContextMenu.Toggle("Hintergrund", "image", () -> HudStyles.resolve(main).background() != 0 || hasOwnBackground(main),
				value -> forSelection(m -> m.setStyleValue(HudStyles.BG, value == HudStyles.defaultBackground(HudStyles.kind()) ? null : value.toString()))));
		items.add(new ContextMenu.Submenu("Deckkraft", "eye", () -> main.styleValue(HudStyles.OPACITY) == null ? "Global"
				: percent(HudStyles.resolve(main).opacity()), () -> {
			List<ContextMenu.Item> list = new ArrayList<>();
			list.add(new ContextMenu.Radio("Wie global (" + percent(config().hudOpacity) + ")", () -> allSelected(m -> m.styleValue(HudStyles.OPACITY) == null),
					() -> forSelection(m -> m.setStyleValue(HudStyles.OPACITY, null))));
			for (int percent : OPACITIES) {
				list.add(new ContextMenu.Radio(percent + " %", () -> allSelected(m -> m.styleValue(HudStyles.OPACITY) != null
						&& Math.round(HudStyles.resolve(m).opacity() * 100) == percent), () -> forSelection(m -> {
					m.setStyleValue(HudStyles.OPACITY, String.valueOf(percent / 100.0));
					// Deckkraft ohne Hintergrund wäre unsichtbar: Hintergrund dann einschalten
					if (HudStyles.resolve(m).background() == 0) m.setStyleValue(HudStyles.BG, "true");
				})));
			}
			return list;
		}));
		items.add(new ContextMenu.Submenu("Farben", "palette", () -> HudStyles.colorValue(HudStyles.resolve(main).accent()), () -> {
			List<ContextMenu.Item> list = new ArrayList<>();
			list.add(new ContextMenu.Header("Akzentfarbe", null));
			list.add(new ContextMenu.Radio("Wie global", () -> allSelected(m -> m.styleValue(HudStyles.ACCENT) == null),
					() -> forSelection(m -> m.setStyleValue(HudStyles.ACCENT, null))));
			list.add(new ContextMenu.Palette(Setting.Color.PALETTE, () -> ownColor(main, HudStyles.ACCENT),
					color -> forSelection(m -> m.setStyleValue(HudStyles.ACCENT, HudStyles.colorValue(color | 0xFF000000)))));
			list.add(new ContextMenu.Separator());
			list.add(new ContextMenu.Header("Textfarbe", null));
			list.add(new ContextMenu.Radio("Wie global", () -> allSelected(m -> m.styleValue(HudStyles.TEXT) == null),
					() -> forSelection(m -> m.setStyleValue(HudStyles.TEXT, null))));
			list.add(new ContextMenu.Palette(Setting.Color.PALETTE, () -> ownColor(main, HudStyles.TEXT),
					color -> forSelection(m -> m.setStyleValue(HudStyles.TEXT, HudStyles.colorValue(color | 0xFF000000)))));
			return list;
		}));
		items.add(new ContextMenu.Toggle("Schatten", "lightbulb", () -> HudStyles.resolve(main).shadow(),
				value -> forSelection(m -> m.setStyleValue(HudStyles.SHADOW, value.toString()))));
		items.add(new ContextMenu.Toggle("Rahmen", "cube", () -> HudStyles.resolve(main).border(),
				value -> forSelection(m -> m.setStyleValue(HudStyles.BORDER, value.toString()))));
		items.add(new ContextMenu.Separator());
		items.add(new ContextMenu.Submenu("Ebene", "list", () -> layerLabel(main), () -> List.of(
				new ContextMenu.Radio("Ganz nach vorn", () -> false, () -> forSelection(m -> m.setLayer(maxLayer(m) + 1))),
				new ContextMenu.Radio("Eine Ebene nach vorn", () -> false, () -> forSelection(m -> m.setLayer(m.layer() + 1))),
				new ContextMenu.Radio("Eine Ebene nach hinten", () -> false, () -> forSelection(m -> m.setLayer(m.layer() - 1))),
				new ContextMenu.Radio("Ganz nach hinten", () -> false, () -> forSelection(m -> m.setLayer(minLayer(m) - 1))))));
		items.add(new ContextMenu.Action("An Raster einrasten", "grid", this::snapSelectionToGrid));
		List<Setting> options = main.styleOptions();
		if (selection.size() == 1 && !options.isEmpty()) {
			items.add(new ContextMenu.Submenu("Optionen: " + main.name(), "options", () -> "", () -> styleOptionItems(options)));
		}
		items.add(new ContextMenu.Separator());
		items.add(new ContextMenu.Action("Einstellungen öffnen", "options", null, selection.size() == 1, false, () -> openSettings(main)));
		items.add(new ContextMenu.Action("Zurücksetzen", "reset", () -> forSelection(HudModule::resetLayout)));
		items.add(new ContextMenu.Action("Ausblenden", "eye-off", "Entf", true, true, () -> forSelection(m -> m.setEnabled(false))));
		return items;
	}

	private static boolean hasOwnBackground(HudModule module) {
		return "true".equals(module.styleValue(HudStyles.BG));
	}

	private static int ownColor(HudModule module, String key) {
		String value = module.styleValue(key);
		if (value == null || !value.matches("#[0-9A-Fa-f]{8}")) return 0;
		return (int) Long.parseLong(value.substring(1), 16);
	}

	private static String alignLabel(String align) {
		return switch (align == null ? "auto" : align) {
			case "left" -> "Links";
			case "center" -> "Mitte";
			case "right" -> "Rechts";
			default -> "Automatisch";
		};
	}

	private static String layerLabel(HudModule module) {
		int layer = module.layer();
		return layer == 0 ? "" : layer > 0 ? "+" + layer : Integer.toString(layer);
	}

	private static int maxLayer(HudModule except) {
		return ModuleManager.hud().stream().filter(m -> m != except).mapToInt(HudModule::layer).max().orElse(0);
	}

	private static int minLayer(HudModule except) {
		return ModuleManager.hud().stream().filter(m -> m != except).mapToInt(HudModule::layer).min().orElse(0);
	}

	/** Eigene Stil-Optionen des Elements (eingebaut oder vom Addon) als Menüeinträge */
	private static List<ContextMenu.Item> styleOptionItems(List<Setting> options) {
		List<ContextMenu.Item> list = new ArrayList<>();
		for (Setting setting : options) {
			switch (setting) {
				case Setting.Toggle toggle -> list.add(new ContextMenu.Toggle(toggle.label(), null, toggle.get(), toggle.set()));
				case Setting.Choice choice -> list.add(new ContextMenu.Submenu(choice.label(), null, choice::current, () -> {
					List<ContextMenu.Item> radios = new ArrayList<>();
					for (int i = 0; i < choice.options().size(); i++) {
						int index = i;
						radios.add(new ContextMenu.Radio(choice.options().get(i), () -> choice.get().getAsInt() == index, () -> choice.set().accept(index)));
					}
					return radios;
				}));
				case Setting.Color color -> list.add(new ContextMenu.Submenu(color.label(), null, () -> HudStyles.colorValue(color.get().getAsInt()),
						() -> List.of(new ContextMenu.Palette(color.palette(), color.get(), color.set()))));
				default -> {
				}
			}
		}
		return list;
	}

	private List<ContextMenu.Item> spaceItems() {
		List<ContextMenu.Item> items = new ArrayList<>();
		items.add(new ContextMenu.Header("HUD", "hud"));
		items.add(new ContextMenu.Submenu("Widget hinzufügen", "plus", () -> "", () -> {
			List<ContextMenu.Item> list = new ArrayList<>();
			for (HudModule module : ModuleManager.hud()) {
				if (module.isEnabled()) continue;
				list.add(new ContextMenu.Action(module.name(), module.icon(), module.source(), true, false, () -> {
					module.setEnabled(true);
					module.setPosition(Math.clamp(menuX, 0, Math.max(0, width - module.width())), Math.clamp(menuY, 0, Math.max(0, height - module.height())));
					placeAfterDraw = module;
					selectOnly(module);
				}));
			}
			if (list.isEmpty()) list.add(new ContextMenu.Action("Alle Elemente sind sichtbar", "check", null, false, false, () -> {
			}));
			return list;
		}));
		items.add(new ContextMenu.Submenu("HUD-Stil", "palette", () -> HudStyles.NAMES.get(HudStyles.kind()), () -> {
			List<ContextMenu.Item> list = new ArrayList<>();
			for (int i = 0; i < HudStyles.NAMES.size(); i++) {
				int kind = i;
				list.add(new ContextMenu.Radio(HudStyles.NAMES.get(i), () -> HudStyles.kind() == kind, () -> config().hudStyle = kind));
			}
			return list;
		}));
		items.add(new ContextMenu.Toggle("Raster", "grid", () -> config().hudGrid, value -> config().hudGrid = value));
		items.add(new ContextMenu.Toggle("Hilfslinien", "crosshair", () -> config().hudGuides, value -> config().hudGuides = value));
		items.add(new ContextMenu.Toggle("Einrasten", "magnet", () -> config().hudSnap, value -> config().hudSnap = value));
		items.add(new ContextMenu.Separator());
		items.add(new ContextMenu.Action("Alles auswählen", "check", "Strg+A", !visibleModules().isEmpty(), false, this::selectAll));
		items.add(new ContextMenu.Action("Rückgängig", "undo", "Strg+Z", !undo.isEmpty(), false, this::undo));
		items.add(new ContextMenu.Action("Wiederholen", "refresh", "Strg+Y", !redo.isEmpty(), false, this::redo));
		items.add(new ContextMenu.Separator());
		items.add(new ContextMenu.Action("Alles zurücksetzen", "reset", null, true, true, this::resetEverything));
		return items;
	}

	private void selectAll() {
		selection.clear();
		selection.addAll(visibleModules());
		primary = selection.isEmpty() ? null : selection.iterator().next();
	}

	private void snapSelectionToGrid() {
		forSelection(m -> {
			int x = Math.round(m.x() / (float) GRID) * GRID;
			int y = Math.round(m.y() / (float) GRID) * GRID;
			m.setPosition(Math.clamp(x, 0, Math.max(0, width - m.width())), Math.clamp(y, 0, Math.max(0, height - m.height())));
		});
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	@Override
	public void mouseMoved(double mouseX, double mouseY) {
		if (menu.isOpen()) menu.mouseMoved(mouseX, mouseY);
		super.mouseMoved(mouseX, mouseY);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		double mx = event.x();
		double my = event.y();
		if (menu.isOpen()) {
			boolean inside = menu.mouseClicked(mx, my);
			// Rechtsklick daneben: gleich ein neues Menü an der neuen Stelle
			if (!(event.button() == InputConstants.MOUSE_BUTTON_RIGHT && !menu.isOpen())) return inside;
		}
		if (super.mouseClicked(event, doubleClick)) return true;
		if (overList(mx, my)) {
			if (event.button() == InputConstants.MOUSE_BUTTON_LEFT) listClick(mx, my);
			return true;
		}
		if (event.button() == InputConstants.MOUSE_BUTTON_LEFT && primary != null && selection.size() == 1 && onHandle(primary, mx, my)) {
			pending = capture();
			resizing = primary;
			resizeScale = primary.scale();
			resizeW = Math.max(1, primary.width());
			resizeH = Math.max(1, primary.height());
			resizeX = primary.x();
			resizeY = primary.y();
			return true;
		}
		if (overToolbar(mx, my)) return true;

		if (event.button() == InputConstants.MOUSE_BUTTON_LEFT) {
			HudModule module = moduleAt(mx, my);
			if (module != null) {
				if (event.hasShiftDown()) {
					if (!selection.remove(module)) selection.add(module);
					primary = selection.contains(module) ? module : selection.isEmpty() ? null : selection.iterator().next();
					if (!selection.contains(module)) return true;
				} else if (!selection.contains(module)) {
					selectOnly(module);
				} else {
					primary = module;
				}
				startDrag(mx, my);
				return true;
			}
			// freie Fläche: Rahmen ziehen
			if (!event.hasShiftDown()) selectOnly(null);
			marquee = true;
			marqueeX0 = marqueeX1 = mx;
			marqueeY0 = marqueeY1 = my;
			marqueeBase = new LinkedHashSet<>(selection);
			return true;
		}
		if (event.button() == InputConstants.MOUSE_BUTTON_RIGHT) {
			HudModule module = moduleAt(mx, my);
			click();
			if (module != null) {
				if (!selection.contains(module)) selectOnly(module);
				else primary = module;
				openWidgetMenu((int) mx, (int) my, false);
			} else {
				openSpaceMenu((int) mx, (int) my, false);
			}
			return true;
		}
		return false;
	}

	private void startDrag(double mx, double my) {
		pending = capture();
		dragging = true;
		dragStartX = mx;
		dragStartY = my;
		dragOrigins.clear();
		for (HudModule module : selection) dragOrigins.put(module, new int[] {module.x(), module.y()});
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
		if (menu.isOpen()) return true;
		if (resizing != null) {
			double ratio = Math.max((event.x() - resizeX) / resizeW, (event.y() - resizeY) / resizeH);
			resizing.setScale(resizeScale * ratio);
			return true;
		}
		if (marquee) {
			marqueeX1 = event.x();
			marqueeY1 = event.y();
			updateMarquee();
			return true;
		}
		if (!dragging) return super.mouseDragged(event, dragX, dragY);
		int dx = (int) Math.round(event.x() - dragStartX);
		int dy = (int) Math.round(event.y() - dragStartY);
		// Rahmen der ganzen Auswahl an der Startstelle
		int x0 = Integer.MAX_VALUE;
		int y0 = Integer.MAX_VALUE;
		int x1 = Integer.MIN_VALUE;
		int y1 = Integer.MIN_VALUE;
		for (Map.Entry<HudModule, int[]> entry : dragOrigins.entrySet()) {
			x0 = Math.min(x0, entry.getValue()[0]);
			y0 = Math.min(y0, entry.getValue()[1]);
			x1 = Math.max(x1, entry.getValue()[0] + entry.getKey().width());
			y1 = Math.max(y1, entry.getValue()[1] + entry.getKey().height());
		}
		if (dragOrigins.isEmpty()) return true;
		int w = x1 - x0;
		int h = y1 - y0;
		int x = Math.clamp(x0 + dx, 0, Math.max(0, width - w));
		int y = Math.clamp(y0 + dy, 0, Math.max(0, height - h));
		// frei platzieren: Strg oder Alt gedrückt halten
		boolean free = event.hasControlDown() || event.hasAltDown();
		int[] snapped = snap(x, y, w, h, free);
		int moveX = snapped[0] - x0;
		int moveY = snapped[1] - y0;
		for (Map.Entry<HudModule, int[]> entry : dragOrigins.entrySet()) {
			HudModule module = entry.getKey();
			int mx = Math.clamp(entry.getValue()[0] + moveX, 0, Math.max(0, width - module.width()));
			int my = Math.clamp(entry.getValue()[1] + moveY, 0, Math.max(0, height - module.height()));
			module.setPosition(mx, my);
		}
		return true;
	}

	/** Auswahl aus dem Rahmen: alle Elemente, die er berührt (mit Umschalt zur bisherigen Auswahl dazu) */
	private void updateMarquee() {
		double x0 = Math.min(marqueeX0, marqueeX1);
		double y0 = Math.min(marqueeY0, marqueeY1);
		double x1 = Math.max(marqueeX0, marqueeX1);
		double y1 = Math.max(marqueeY0, marqueeY1);
		selection.clear();
		selection.addAll(marqueeBase);
		for (HudModule module : visibleModules()) {
			if (module.x() < x1 && module.x() + module.width() > x0 && module.y() < y1 && module.y() + module.height() > y0) selection.add(module);
		}
		primary = selection.isEmpty() ? null : selection.iterator().next();
	}

	/**
	 * Rastet den Rahmen (x, y, w, h) an Bildschirmrändern und -mitte, an Kanten und Mitten anderer Elemente (bündig oder
	 * mit kleinem Abstand daneben) und – mit Raster – an den Rasterlinien ein. Füllt {@link #guides}.
	 */
	private int[] snap(int x, int y, int w, int h, boolean free) {
		guides.clear();
		if (free || !config().hudSnap) return new int[] {x, y};
		record Candidate(int value, Guide guide, int priority) {
		}
		List<Candidate> xs = new ArrayList<>();
		List<Candidate> ys = new ArrayList<>();
		xs.add(new Candidate(EDGE, new Guide(true, EDGE, 0, height), 0));
		xs.add(new Candidate(width - w - EDGE, new Guide(true, width - EDGE, 0, height), 0));
		xs.add(new Candidate((width - w) / 2, new Guide(true, width / 2f, 0, height), 0));
		ys.add(new Candidate(EDGE, new Guide(false, EDGE, 0, width), 0));
		ys.add(new Candidate(height - h - EDGE, new Guide(false, height - EDGE, 0, width), 0));
		ys.add(new Candidate((height - h) / 2, new Guide(false, height / 2f, 0, width), 0));
		for (HudModule other : visibleModules()) {
			if (selection.contains(other)) continue;
			int ox = other.x();
			int oy = other.y();
			int ow = other.width();
			int oh = other.height();
			float top = Math.min(y, oy) - 4;
			float bottom = Math.max(y + h, oy + oh) + 4;
			float left = Math.min(x, ox) - 4;
			float right = Math.max(x + w, ox + ow) + 4;
			xs.add(new Candidate(ox, new Guide(true, ox, top, bottom), 1));
			xs.add(new Candidate(ox + ow - w, new Guide(true, ox + ow, top, bottom), 1));
			xs.add(new Candidate(ox + (ow - w) / 2, new Guide(true, ox + ow / 2f, top, bottom), 1));
			xs.add(new Candidate(ox + ow + NEIGHBOR_GAP, new Guide(true, ox + ow + NEIGHBOR_GAP / 2f, top, bottom), 1));
			xs.add(new Candidate(ox - w - NEIGHBOR_GAP, new Guide(true, ox - NEIGHBOR_GAP / 2f, top, bottom), 1));
			ys.add(new Candidate(oy, new Guide(false, oy, left, right), 1));
			ys.add(new Candidate(oy + oh - h, new Guide(false, oy + oh, left, right), 1));
			ys.add(new Candidate(oy + (oh - h) / 2, new Guide(false, oy + oh / 2f, left, right), 1));
			ys.add(new Candidate(oy + oh + NEIGHBOR_GAP, new Guide(false, oy + oh + NEIGHBOR_GAP / 2f, left, right), 1));
			ys.add(new Candidate(oy - h - NEIGHBOR_GAP, new Guide(false, oy - NEIGHBOR_GAP / 2f, left, right), 1));
		}
		if (config().hudGrid) {
			int gx = Math.round(x / (float) GRID) * GRID;
			int gy = Math.round(y / (float) GRID) * GRID;
			xs.add(new Candidate(gx, null, 2));
			ys.add(new Candidate(gy, null, 2));
		}
		int[] result = {x, y};
		for (int axis = 0; axis < 2; axis++) {
			List<Candidate> candidates = axis == 0 ? xs : ys;
			int value = axis == 0 ? x : y;
			Candidate best = null;
			for (Candidate c : candidates) {
				int distance = Math.abs(c.value() - value);
				if (distance > SNAP) continue;
				if (best == null || c.priority() < best.priority() || (c.priority() == best.priority() && distance < Math.abs(best.value() - value))) best = c;
			}
			if (best == null) continue;
			int limit = axis == 0 ? Math.max(0, width - w) : Math.max(0, height - h);
			result[axis] = Math.clamp(best.value(), 0, limit);
			if (best.guide() != null && config().hudGuides) guides.add(best.guide());
		}
		return result;
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		if (dragging || resizing != null || marquee) {
			if (resizing != null) resizing.setPosition(resizeX, resizeY);
			dragging = false;
			resizing = null;
			marquee = false;
			guides.clear();
			dragOrigins.clear();
			if (pending != null && !pending.equals(capture())) pushUndo(pending);
			pending = null;
			HeldixConfig.save();
			return true;
		}
		return super.mouseReleased(event);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (menu.isOpen()) return menu.mouseScrolled(mouseX, mouseY, scrollY);
		if (overList(mouseX, mouseY)) {
			listScroll = Math.clamp(listScroll - scrollY * LIST_ROW, 0, listMaxScroll());
			return true;
		}
		HudModule module = moduleAt(mouseX, mouseY);
		if (module != null && scrollY != 0) {
			Snapshot before = capture();
			module.setScale(module.scale() + (scrollY > 0 ? 0.05 : -0.05));
			if (!before.equals(capture())) pushUndo(before);
			if (!selection.contains(module)) selectOnly(module);
			HeldixConfig.save();
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (menu.isOpen()) {
			if (menu.keyPressed(key)) return true;
			return true;
		}
		if (event.hasControlDown() && key == InputConstants.KEY_Z) {
			if (event.hasShiftDown()) redo();
			else undo();
			return true;
		}
		if (event.hasControlDown() && key == InputConstants.KEY_Y) {
			redo();
			return true;
		}
		if (event.hasControlDown() && key == InputConstants.KEY_A) {
			selectAll();
			return true;
		}
		if (key == InputConstants.KEY_G) {
			config().hudGrid = !config().hudGrid;
			HeldixConfig.save();
			return true;
		}
		if (key == InputConstants.KEY_R && !event.hasControlDown()) {
			resetAll();
			return true;
		}
		if (key == InputConstants.KEY_TAB) {
			selectNext(event.hasShiftDown() ? -1 : 1);
			return true;
		}
		// Menü mit der Tastatur: Enter oder Umschalt+F10
		if (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER || (key == InputConstants.KEY_F10 && event.hasShiftDown())) {
			if (primary != null) openWidgetMenu(primary.x() + primary.width() / 2, primary.y() + primary.height() / 2, true);
			else openSpaceMenu(width / 2, height / 2, true);
			return true;
		}
		if (key == InputConstants.KEY_ESCAPE && !selection.isEmpty()) {
			selectOnly(null);
			return true;
		}
		if (!selection.isEmpty()) {
			int step = event.hasShiftDown() ? 10 : 1;
			int dx = event.isLeft() ? -step : event.isRight() ? step : 0;
			int dy = event.isUp() ? -step : event.isDown() ? step : 0;
			if (dx != 0 || dy != 0) {
				Snapshot before = capture();
				// die Auswahl bewegt sich zusammen und bleibt auf dem Bildschirm
				int minX = selection.stream().mapToInt(HudModule::x).min().orElse(0);
				int minY = selection.stream().mapToInt(HudModule::y).min().orElse(0);
				int maxX = selection.stream().mapToInt(m -> m.x() + m.width()).max().orElse(0);
				int maxY = selection.stream().mapToInt(m -> m.y() + m.height()).max().orElse(0);
				int moveX = Math.clamp(dx, -minX, Math.max(0, width - maxX));
				int moveY = Math.clamp(dy, -minY, Math.max(0, height - maxY));
				forSelection(m -> m.setPosition(m.x() + moveX, m.y() + moveY));
				if (!before.equals(capture())) pushUndo(before);
				HeldixConfig.save();
				return true;
			}
			if (key == InputConstants.KEY_DELETE || key == InputConstants.KEY_BACKSPACE) {
				pushUndo(capture());
				forSelection(m -> m.setEnabled(false));
				selectOnly(null);
				return true;
			}
		}
		return super.keyPressed(event);
	}

	/** Auswahl mit Tab der Reihe nach durch die sichtbaren Elemente */
	private void selectNext(int direction) {
		List<HudModule> visible = visibleModules();
		if (visible.isEmpty()) return;
		int index = primary == null ? (direction > 0 ? -1 : 0) : visible.indexOf(primary);
		selectOnly(visible.get(Math.floorMod(index + direction, visible.size())));
	}

	// --- Rückgängig / Wiederholen ---------------------------------------------------------

	private Snapshot capture() {
		Map<HudModule, HeldixConfig.ModuleState> states = new LinkedHashMap<>();
		for (HudModule module : ModuleManager.hud()) states.put(module, module.snapshot());
		HeldixConfig.Data c = config();
		return new Snapshot(states, c.hudStyle, c.hudOpacity, c.hudScale, c.hudAccent, c.hudBackground);
	}

	private void apply(Snapshot snapshot) {
		for (Map.Entry<HudModule, HeldixConfig.ModuleState> entry : snapshot.modules().entrySet()) {
			HudModule module = entry.getKey();
			// ein wieder eingeblendetes Element gleich auswählen
			boolean reappears = entry.getValue().enabled && !module.isEnabled();
			module.restore(entry.getValue());
			if (reappears) selectOnly(module);
		}
		HeldixConfig.Data c = config();
		c.hudStyle = snapshot.style();
		c.hudOpacity = snapshot.opacity();
		c.hudScale = snapshot.scale();
		c.hudAccent = snapshot.accent();
		c.hudBackground = snapshot.background();
		selection.removeIf(module -> !module.isEnabled());
		HeldixConfig.save();
	}

	private void pushUndo(Snapshot snapshot) {
		if (!undo.isEmpty() && undo.peek().equals(snapshot)) return;
		undo.push(snapshot);
		redo.clear();
		while (undo.size() > UNDO_LIMIT) undo.removeLast();
	}

	private void undo() {
		Snapshot snapshot = undo.poll();
		if (snapshot == null) return;
		redo.push(capture());
		apply(snapshot);
	}

	private void redo() {
		Snapshot snapshot = redo.poll();
		if (snapshot == null) return;
		undo.push(capture());
		apply(snapshot);
	}

	/** Alle Elemente an ihre Standardstelle und auf normale Größe */
	private void resetAll() {
		pushUndo(capture());
		for (HudModule module : ModuleManager.hud()) {
			module.resetPosition();
			module.setScale(1.0);
		}
		HeldixConfig.save();
	}

	/** Alles zurück: Position, Größe, Aussehen und Ebene jedes Elements sowie der globale Stil */
	private void resetEverything() {
		for (HudModule module : ModuleManager.hud()) module.resetLayout();
		HeldixConfig.Data defaults = new HeldixConfig.Data();
		HeldixConfig.Data c = config();
		c.hudStyle = defaults.hudStyle;
		c.hudOpacity = defaults.hudOpacity;
		c.hudScale = defaults.hudScale;
		c.hudAccent = defaults.hudAccent;
		c.hudBackground = defaults.hudBackground;
	}

	// --- Autotest -------------------------------------------------------------------------

	/** Name des ausgewählten Elements (null = keins) */
	public String selectedName() {
		return primary == null ? null : primary.name();
	}

	/** IDs aller ausgewählten Elemente */
	public List<String> selectedIds() {
		return selection.stream().map(HudModule::id).toList();
	}

	public int undoSize() {
		return undo.size();
	}

	public int redoSize() {
		return redo.size();
	}

	public ContextMenu contextMenu() {
		return menu;
	}

	/** Hilfslinien des laufenden Ziehens */
	public List<Guide> guides() {
		return List.copyOf(guides);
	}

	/** Liegt hier nichts (kein Element mit Rand, keine Werkzeugleiste, keine Liste, kein Menü)? */
	public boolean isFree(double x, double y) {
		return !menu.isOpen() && !overToolbar(x, y) && !overList(x, y) && moduleAt(x, y) == null && x >= 0 && y >= 0 && x < width && y < height;
	}

	/** Nächste freie Stelle um (x, y) (Suche in Ringen), null = keine */
	public int[] freePointNear(int x, int y) {
		for (int r = 0; r < Math.max(width, height); r += 3) {
			for (int dx = -r; dx <= r; dx += 3) {
				for (int dy : new int[] {-r, r}) {
					if (isFree(x + dx, y + dy)) return new int[] {x + dx, y + dy};
					if (isFree(x + dy, y + dx)) return new int[] {x + dy, y + dx};
				}
			}
		}
		return null;
	}

	/** Mitte des Skalier-Griffs am ausgewählten Element */
	public int[] handleCenter() {
		if (primary == null) throw new IllegalStateException("Kein Element ausgewählt");
		return new int[] {primary.x() + primary.width() + 2, primary.y() + primary.height() + 2};
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		HeldixConfig.save();
		minecraft.gui.setScreen(parent);
	}
}
