package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.ModuleManager;
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
import java.util.List;

/**
 * HUD-Editor: Elemente verschieben (Einrasten an Rändern, Mitte und anderen Elementen),
 * über die Ecke oder das Mausrad skalieren, ein- und ausblenden und rückgängig machen.
 * Rechtsklick auf ein Element öffnet seine Einstellungen.
 */
public class HudEditorScreen extends Screen {
	private static final int SNAP = 5;
	private static final int EDGE = 2;
	private static final int GRID = 16;
	private static final int HANDLE = 6;
	private static final int PAD = 5;
	private static final int GAP = 4;
	private static final int BUTTON_H = 20;
	private static final int LIST_W = 176;
	private static final int LIST_HEAD = 26;
	private static final int LIST_ROW = 20;
	private static final int UNDO_LIMIT = 64;
	private static final String TITLE = "HUD-Editor";

	/** Zustand eines Elements für "Rückgängig" */
	private record Snapshot(HudModule module, int x, int y, float scale, boolean enabled) {
	}

	private final Screen parent;
	private final Deque<List<Snapshot>> undo = new ArrayDeque<>();
	/** Zustand vor dem laufenden Ziehen/Skalieren */
	private List<Snapshot> pending;

	private HudModule selected;
	private HudModule dragging;
	private HudModule resizing;
	private int offsetX;
	private int offsetY;
	private float resizeScale;
	private int resizeW;
	private int resizeH;
	private int guideX = -1;
	private int guideY = -1;

	private boolean listOpen;
	private double listScroll;
	private final List<ActionButton> toolbar = new ArrayList<>();
	private ActionButton listButton;
	private ActionButton gridButton;
	private ActionButton snapButton;
	private ActionButton undoButton;
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

	/** Fläche, mit der das Rechteck sichtbare HUD-Elemente überdeckt (das gerade gezogene zählt nicht). */
	private long overlap(int x, int y, int w, int h) {
		long total = 0;
		for (HudModule module : ModuleManager.hud()) {
			if (!module.isEnabled() || module == dragging || module == resizing) continue;
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
			Ui.vline(g, width / 2f, 0, height, 0x553B82F6);
			Ui.hline(g, 0, width, height / 2f, 0x553B82F6);
		}
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (selected != null && !selected.isEnabled()) selected = null;
		HudModule hovered = dragging != null ? dragging : overList(mouseX, mouseY) || overToolbar(mouseX, mouseY) ? null : moduleAt(mouseX, mouseY);

		// Elemente mit Rahmen
		for (HudModule module : ModuleManager.hud()) {
			if (!module.isEnabled()) continue;
			module.extractPreview(g, minecraft);
			int color = module == selected ? Ui.ACCENT : module == hovered ? 0xB3FFFFFF : 0x40FFFFFF;
			Ui.outline(g, module.x() - 2, module.y() - 2, module.width() + 4, module.height() + 4, 4, color);
			if (module == selected) Ui.rect(g, module.x() - 2, module.y() - 2, module.width() + 4, module.height() + 4, 4, 0x143B82F6);
		}
		if (dragging != null) {
			if (guideX >= 0) Ui.vline(g, guideX, 0, height, Ui.ACCENT_TEXT);
			if (guideY >= 0) Ui.hline(g, 0, width, guideY, Ui.ACCENT_TEXT);
		}
		if (selected != null) drawHandle(g, selected, mouseX, mouseY);
		if (hovered != null && hovered != selected) nameTag(g, hovered, hovered.name(), 0xF01B2232);
		if (selected != null) {
			String tag = selected.name() + (resizing != null ? "  " + percent(selected.scale()) : "");
			nameTag(g, selected, tag, Ui.ACCENT);
		}

		// Werkzeugleiste
		listButton.setPrimary(listOpen);
		gridButton.setPrimary(config().hudGrid);
		snapButton.setPrimary(config().hudSnap);
		undoButton.active = !undo.isEmpty();
		layoutToolbar();
		Ui.shadow(g, barX, barY, barW, barH, 0.45f);
		Ui.rect(g, barX, barY, barW, barH, 10, 0xF20F1420);
		Ui.outline(g, barX, barY, barW, barH, 10, Ui.LINE_STRONG);
		if (showTitle) {
			Ui.icon(g, "hud", barX + PAD + 5, barY + (barH - 11) / 2f, 11, Ui.ACCENT_TEXT);
			Ui.text(g, TITLE, barX + PAD + 21, barY + (barH - 8) / 2, Ui.TEXT, Ui.Font.LABEL);
		}
		drawHelp(g);

		super.extractRenderState(g, mouseX, mouseY, delta);
		if (listOpen) {
			g.nextStratum();
			drawList(g, mouseX, mouseY);
		}
		Ui.drawTooltip(g, width, height);
	}

	private static String percent(float scale) {
		return Math.round(scale * 100) + " %";
	}

	private void nameTag(GuiGraphicsExtractor g, HudModule module, String text, int color) {
		int tagW = Ui.width(text, Ui.Font.SMALL) + 22;
		int tagX = Math.clamp(module.x() - 2, 0, Math.max(0, width - tagW));
		int tagY = module.y() - 16 >= 0 ? module.y() - 16 : module.y() + module.height() + 5;
		Ui.rect(g, tagX, tagY, tagW, 12, 6, color);
		Ui.icon(g, module.icon(), tagX + 4, tagY + 2, 8, 0xFFFFFFFF);
		Ui.text(g, text, tagX + 15, tagY + 2, Ui.TEXT, Ui.Font.SMALL);
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
		if (selected != null) {
			help = selected.name() + "  ·  X " + selected.x() + "  Y " + selected.y() + "  ·  " + percent(selected.scale())
					+ "  ·  Pfeile, Mausrad, Entf";
		} else {
			help = "Ziehen: verschieben · Ecke: Größe · Rechtsklick: Einstellungen";
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
			boolean hover = Ui.inside(mouseX, mouseY, x + 4, rowY, LIST_W - 8, LIST_ROW - 2) && mouseY < y + h - 3 && mouseY >= y + LIST_HEAD - 2;
			if (module == selected) Ui.rect(g, x + 4, rowY, LIST_W - 8, LIST_ROW - 2, 6, Ui.ACCENT_SOFT);
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
			if (!module.isEnabled() && selected == module) selected = null;
		} else {
			if (!module.isEnabled()) {
				pushUndo(capture());
				module.setEnabled(true);
			}
			selected = module;
		}
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	private HudModule moduleAt(double mouseX, double mouseY) {
		for (HudModule module : ModuleManager.hud().reversed()) {
			if (module.isEnabled() && Ui.inside(mouseX, mouseY, module.x() - 2, module.y() - 2, module.width() + 4, module.height() + 4)) {
				return module;
			}
		}
		return null;
	}

	private void openSettings(HudModule module) {
		selected = module;
		minecraft.gui.setScreen(new HeldixMenuScreen(this, Shell.Page.MODULES, module));
	}

	private void click() {
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		double mx = event.x();
		double my = event.y();
		if (overList(mx, my)) {
			if (event.button() == InputConstants.MOUSE_BUTTON_LEFT) listClick(mx, my);
			return true;
		}
		if (event.button() == InputConstants.MOUSE_BUTTON_LEFT && selected != null && onHandle(selected, mx, my)) {
			pending = capture();
			resizing = selected;
			resizeScale = selected.scale();
			resizeW = Math.max(1, selected.width());
			resizeH = Math.max(1, selected.height());
			return true;
		}
		if (overToolbar(mx, my)) return true;

		if (event.button() == InputConstants.MOUSE_BUTTON_LEFT) {
			HudModule module = moduleAt(mx, my);
			selected = module;
			if (module != null) {
				pending = capture();
				dragging = module;
				offsetX = (int) mx - module.x();
				offsetY = (int) my - module.y();
				return true;
			}
			return false;
		}
		if (event.button() == InputConstants.MOUSE_BUTTON_RIGHT) {
			HudModule module = moduleAt(mx, my);
			if (module != null) {
				click();
				openSettings(module);
				return true;
			}
		}
		return false;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
		if (resizing != null) {
			double ratio = Math.max((event.x() - resizing.x()) / resizeW, (event.y() - resizing.y()) / resizeH);
			resizing.setScale(resizeScale * ratio);
			return true;
		}
		if (dragging == null) return super.mouseDragged(event, dragX, dragY);
		int w = dragging.width();
		int h = dragging.height();
		int x = Math.clamp((int) event.x() - offsetX, 0, Math.max(0, width - w));
		int y = Math.clamp((int) event.y() - offsetY, 0, Math.max(0, height - h));
		guideX = -1;
		guideY = -1;

		if (config().hudSnap && !event.hasShiftDown()) {
			// Bildschirmränder und Mitte
			int[] snapX = snapAxis(x, new int[] {EDGE, width - w - EDGE, (width - w) / 2}, new int[] {-1, -1, width / 2});
			x = snapX[0];
			guideX = snapX[1];
			int[] snapY = snapAxis(y, new int[] {EDGE, height - h - EDGE, (height - h) / 2}, new int[] {-1, -1, height / 2});
			y = snapY[0];
			guideY = snapY[1];

			// An anderen Elementen ausrichten (bündig links/rechts, direkt darunter/darüber)
			for (HudModule other : ModuleManager.hud()) {
				if (other == dragging || !other.isEnabled()) continue;
				if (guideX < 0) {
					int[] r = snapAxis(x, new int[] {other.x(), other.x() + other.width() - w}, new int[] {other.x(), other.x() + other.width()});
					if (r[0] != x || r[1] >= 0) {
						x = r[0];
						guideX = r[1];
					}
				}
				if (guideY < 0) {
					int[] r = snapAxis(y, new int[] {other.y() + other.height() + 2, other.y() - h - 2, other.y()},
							new int[] {other.y() + other.height() + 1, other.y() - 1, other.y()});
					if (r[0] != y || r[1] >= 0) {
						y = r[0];
						guideY = r[1];
					}
				}
			}
		}
		dragging.setPosition(x, y);
		return true;
	}

	/** Rastet value an einem der Ziele ein, wenn es nahe genug ist. Rückgabe: {Wert, Hilfslinie oder -1}. */
	private static int[] snapAxis(int value, int[] targets, int[] guides) {
		for (int i = 0; i < targets.length; i++) {
			if (Math.abs(value - targets[i]) <= SNAP) return new int[] {targets[i], guides[i]};
		}
		return new int[] {value, -1};
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		if (dragging != null || resizing != null) {
			dragging = null;
			resizing = null;
			guideX = -1;
			guideY = -1;
			if (pending != null && !pending.equals(capture())) pushUndo(pending);
			pending = null;
			HeldixConfig.save();
			return true;
		}
		return super.mouseReleased(event);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (overList(mouseX, mouseY)) {
			listScroll = Math.clamp(listScroll - scrollY * LIST_ROW, 0, listMaxScroll());
			return true;
		}
		HudModule module = moduleAt(mouseX, mouseY);
		if (module != null && scrollY != 0) {
			List<Snapshot> before = capture();
			module.setScale(module.scale() + (scrollY > 0 ? 0.05 : -0.05));
			if (!before.equals(capture())) pushUndo(before);
			selected = module;
			HeldixConfig.save();
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (key == InputConstants.KEY_Z && event.hasControlDown()) {
			undo();
			return true;
		}
		if (key == InputConstants.KEY_G) {
			config().hudGrid = !config().hudGrid;
			HeldixConfig.save();
			return true;
		}
		if (key == InputConstants.KEY_R) {
			resetAll();
			return true;
		}
		if (key == InputConstants.KEY_TAB) {
			selectNext(event.hasShiftDown() ? -1 : 1);
			return true;
		}
		if (selected != null) {
			int step = event.hasShiftDown() ? 10 : 1;
			int dx = event.isLeft() ? -step : event.isRight() ? step : 0;
			int dy = event.isUp() ? -step : event.isDown() ? step : 0;
			if (dx != 0 || dy != 0) {
				pushUndo(capture());
				int x = Math.clamp(selected.x() + dx, 0, Math.max(0, width - selected.width()));
				int y = Math.clamp(selected.y() + dy, 0, Math.max(0, height - selected.height()));
				selected.setPosition(x, y);
				HeldixConfig.save();
				return true;
			}
			if (key == InputConstants.KEY_DELETE || key == InputConstants.KEY_BACKSPACE) {
				pushUndo(capture());
				selected.setEnabled(false);
				selected = null;
				return true;
			}
		}
		return super.keyPressed(event);
	}

	/** Auswahl mit Tab der Reihe nach durch die sichtbaren Elemente */
	private void selectNext(int direction) {
		List<HudModule> visible = ModuleManager.hud().stream().filter(HudModule::isEnabled).toList();
		if (visible.isEmpty()) return;
		int index = selected == null ? (direction > 0 ? -1 : 0) : visible.indexOf(selected);
		selected = visible.get(Math.floorMod(index + direction, visible.size()));
	}

	// --- Rückgängig -----------------------------------------------------------------------

	private List<Snapshot> capture() {
		List<Snapshot> list = new ArrayList<>();
		for (HudModule module : ModuleManager.hud()) {
			list.add(new Snapshot(module, module.x(), module.y(), module.scale(), module.isEnabled()));
		}
		return list;
	}

	private void pushUndo(List<Snapshot> snapshot) {
		if (!undo.isEmpty() && undo.peek().equals(snapshot)) return;
		undo.push(snapshot);
		while (undo.size() > UNDO_LIMIT) undo.removeLast();
	}

	private void undo() {
		List<Snapshot> snapshot = undo.poll();
		if (snapshot == null) return;
		for (Snapshot s : snapshot) {
			// ein wieder eingeblendetes Element gleich auswählen
			if (s.enabled() && !s.module().isEnabled()) selected = s.module();
			s.module().setPosition(s.x(), s.y());
			s.module().setScale(s.scale());
			s.module().setEnabled(s.enabled());
		}
		if (selected != null && !selected.isEnabled()) selected = null;
		HeldixConfig.save();
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

	// --- Autotest -------------------------------------------------------------------------

	/** Name des ausgewählten Elements (null = keins) */
	public String selectedName() {
		return selected == null ? null : selected.name();
	}

	public int undoSize() {
		return undo.size();
	}

	/** Mitte des Skalier-Griffs am ausgewählten Element */
	public int[] handleCenter() {
		if (selected == null) throw new IllegalStateException("Kein Element ausgewählt");
		return new int[] {selected.x() + selected.width() + 2, selected.y() + selected.height() + 2};
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
