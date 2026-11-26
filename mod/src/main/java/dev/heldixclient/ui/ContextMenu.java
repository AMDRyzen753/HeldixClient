package dev.heldixclient.ui;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/**
 * Rechtsklick-Menü im Heldix-Design mit Untermenüs. Passt immer auf den Bildschirm: öffnet nach links bzw. oben, wenn
 * rechts bzw. unten kein Platz ist, und scrollt, wenn es höher als der Bildschirm ist. Bedienung mit Maus oder
 * Tastatur (Pfeile, Enter/Leertaste, Esc; rechts/links öffnet bzw. schließt ein Untermenü).
 *
 * <p>Aktionen schließen das Menü, Schalter, Auswahlpunkte und Farben lassen es offen (der neue Zustand ist gleich zu
 * sehen). Vor und nach jeder Änderung laufen {@code before}/{@code after} (z. B. für Rückgängig und Speichern).
 */
public final class ContextMenu {
	/** Ein Eintrag im Menü */
	public sealed interface Item permits Action, Toggle, Radio, Submenu, Palette, Separator, Header {
	}

	/** Knopf: führt etwas aus und schließt das Menü; hint steht rechts (z. B. „Strg+Z“) */
	public record Action(String label, String icon, String hint, boolean enabled, boolean danger, Runnable run) implements Item {
		public Action(String label, String icon, Runnable run) {
			this(label, icon, null, true, false, run);
		}
	}

	/** An/Aus-Schalter (Menü bleibt offen) */
	public record Toggle(String label, String icon, BooleanSupplier get, Consumer<Boolean> set) implements Item {
	}

	/** Auswahlpunkt mit Haken, wenn gewählt (Menü bleibt offen) */
	public record Radio(String label, BooleanSupplier selected, Runnable select) implements Item {
	}

	/** Öffnet ein Untermenü; hint zeigt den aktuellen Wert (z. B. „100 %“) */
	public record Submenu(String label, String icon, Supplier<String> hint, Supplier<List<Item>> items) implements Item {
	}

	/** Farbfelder in einem Raster; get = gewählte Farbe (0 = keine) */
	public record Palette(List<Integer> colors, IntSupplier get, IntConsumer set) implements Item {
	}

	public record Separator() implements Item {
	}

	public record Header(String label, String icon) implements Item {
	}

	private static final int ROW = 14;
	private static final int SEPARATOR = 7;
	private static final int HEADER = 16;
	private static final int PAD = 4;
	private static final int MIN_W = 132;
	private static final int MAX_W = 220;
	private static final int SWATCH = 11;
	private static final int SWATCH_GAP = 3;
	private static final int SWATCH_COLUMNS = 8;
	private static final int EDGE = 4;

	private static final class Level {
		final List<Item> items;
		int x;
		int y;
		int w;
		int h;
		/** Höhe ohne Begrenzung */
		int fullH;
		int selected = -1;
		int swatch;
		double scroll;
		/** Mit der Tastatur gewählt (Markierung kräftiger) */
		boolean keyboard;

		Level(List<Item> items) {
			this.items = items;
		}

		int maxScroll() {
			return Math.max(0, fullH - h);
		}
	}

	private final List<Level> levels = new ArrayList<>();
	private final Runnable before;
	private final Runnable after;
	private int screenW;
	private int screenH;

	public ContextMenu(Runnable before, Runnable after) {
		this.before = before != null ? before : () -> {
		};
		this.after = after != null ? after : () -> {
		};
	}

	public boolean isOpen() {
		return !levels.isEmpty();
	}

	public void close() {
		levels.clear();
	}

	/** Öffnet das Menü an der Maus (bzw. an einer Stelle, wenn es dort nicht passt) */
	public void open(List<Item> items, int x, int y, int screenWidth, int screenHeight) {
		levels.clear();
		screenW = screenWidth;
		screenH = screenHeight;
		Level root = new Level(items);
		measure(root);
		root.x = x + 2;
		if (root.x + root.w > screenW - EDGE) root.x = x - root.w - 2;
		root.x = clampX(root.x, root.w);
		fit(root, y + 2, y - 2);
		levels.add(root);
	}

	/** Mit der Tastatur geöffnet: gleich den ersten Eintrag wählen */
	public void selectFirst() {
		if (levels.isEmpty()) return;
		Level level = levels.getLast();
		level.keyboard = true;
		level.selected = next(level, -1, 1);
	}

	private int clampX(int x, int w) {
		return Math.clamp(x, EDGE, Math.max(EDGE, screenW - EDGE - w));
	}

	/** Senkrecht: bevorzugt ab top nach unten, sonst bis bottom nach oben, sonst passend; zu hoch = scrollen */
	private void fit(Level level, int top, int bottom) {
		level.h = Math.min(level.fullH, screenH - EDGE * 2);
		int y = top;
		if (y + level.h > screenH - EDGE) y = bottom - level.h;
		level.y = Math.clamp(y, EDGE, Math.max(EDGE, screenH - EDGE - level.h));
	}

	private void measure(Level level) {
		int w = MIN_W;
		int h = PAD * 2;
		for (Item item : level.items) {
			h += height(item);
			w = Math.max(w, naturalWidth(item));
		}
		level.w = Math.min(MAX_W, Math.min(w, screenW - EDGE * 2));
		level.fullH = h;
	}

	private static int height(Item item) {
		return switch (item) {
			case Separator s -> SEPARATOR;
			case Header h -> HEADER;
			case Palette p -> paletteRows(p) * (SWATCH + SWATCH_GAP) + SWATCH_GAP + 2;
			default -> ROW;
		};
	}

	private static int paletteRows(Palette palette) {
		return (palette.colors().size() + SWATCH_COLUMNS - 1) / SWATCH_COLUMNS;
	}

	private static int naturalWidth(Item item) {
		int iconSpace = 18;
		return switch (item) {
			case Action a -> 10 + iconSpace + Ui.width(a.label(), Ui.Font.BODY) + (a.hint() != null ? 10 + Ui.width(a.hint(), Ui.Font.SMALL) : 0) + 10;
			case Toggle t -> 10 + iconSpace + Ui.width(t.label(), Ui.Font.BODY) + 10 + 18 + 10;
			case Radio r -> 10 + iconSpace + Ui.width(r.label(), Ui.Font.BODY) + 10;
			case Submenu s -> 10 + iconSpace + Ui.width(s.label(), Ui.Font.BODY) + 10 + hintWidth(s) + 18;
			case Header h -> 10 + iconSpace + Ui.width(h.label(), Ui.Font.LABEL) + 10;
			case Palette p -> 8 + SWATCH_COLUMNS * (SWATCH + SWATCH_GAP) + 8;
			case Separator s -> 0;
		};
	}

	private static int hintWidth(Submenu submenu) {
		String hint = submenu.hint() != null ? submenu.hint().get() : null;
		return hint == null || hint.isEmpty() ? 0 : Ui.width(hint, Ui.Font.SMALL) + 6;
	}

	private static boolean selectable(Item item) {
		return switch (item) {
			case Separator s -> false;
			case Header h -> false;
			case Action a -> a.enabled();
			default -> true;
		};
	}

	/** Oberkante eines Eintrags (ohne Scrollen) relativ zur Ebene */
	private static int rowTop(Level level, int index) {
		int y = PAD;
		for (int i = 0; i < index; i++) y += height(level.items.get(i));
		return y;
	}

	private int indexAt(Level level, double mouseX, double mouseY) {
		if (!Ui.inside(mouseX, mouseY, level.x, level.y, level.w, level.h)) return -1;
		double local = mouseY - level.y + level.scroll;
		int y = PAD;
		for (int i = 0; i < level.items.size(); i++) {
			int h = height(level.items.get(i));
			if (local >= y && local < y + h) return i;
			y += h;
		}
		return -1;
	}

	private int levelAt(double mouseX, double mouseY) {
		for (int i = levels.size() - 1; i >= 0; i--) {
			Level level = levels.get(i);
			if (Ui.inside(mouseX, mouseY, level.x, level.y, level.w, level.h)) return i;
		}
		return -1;
	}

	private void openSubmenu(int levelIndex, int itemIndex, boolean keyboard) {
		while (levels.size() > levelIndex + 1) levels.removeLast();
		Level parent = levels.get(levelIndex);
		if (!(parent.items.get(itemIndex) instanceof Submenu submenu)) return;
		Level child = new Level(submenu.items().get());
		measure(child);
		child.x = parent.x + parent.w - 3;
		if (child.x + child.w > screenW - EDGE) child.x = parent.x - child.w + 3;
		child.x = clampX(child.x, child.w);
		int rowY = parent.y + rowTop(parent, itemIndex) - (int) parent.scroll;
		fit(child, rowY - PAD, rowY + ROW + PAD);
		child.keyboard = keyboard;
		if (keyboard) child.selected = next(child, -1, 1);
		levels.add(child);
	}

	private static int next(Level level, int from, int direction) {
		int size = level.items.size();
		for (int step = 1; step <= size; step++) {
			int i = Math.floorMod(from + direction * step, size);
			if (selectable(level.items.get(i))) return i;
		}
		return -1;
	}

	/** Eintrag ausführen; true = Menü bleibt offen */
	private void activate(int levelIndex, int itemIndex, int swatchIndex) {
		Level level = levels.get(levelIndex);
		Item item = level.items.get(itemIndex);
		switch (item) {
			case Action action -> {
				if (!action.enabled()) return;
				close();
				before.run();
				action.run().run();
				after.run();
			}
			case Toggle toggle -> {
				before.run();
				toggle.set().accept(!toggle.get().getAsBoolean());
				after.run();
			}
			case Radio radio -> {
				before.run();
				radio.select().run();
				after.run();
			}
			case Submenu submenu -> openSubmenu(levelIndex, itemIndex, level.keyboard);
			case Palette palette -> {
				if (swatchIndex < 0 || swatchIndex >= palette.colors().size()) return;
				before.run();
				palette.set().accept(palette.colors().get(swatchIndex));
				after.run();
			}
			default -> {
			}
		}
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	/** Maus bewegt: Eintrag unter der Maus markieren, Untermenüs öffnen bzw. schließen */
	public void mouseMoved(double mouseX, double mouseY) {
		int levelIndex = levelAt(mouseX, mouseY);
		if (levelIndex < 0) return;
		Level level = levels.get(levelIndex);
		int index = indexAt(level, mouseX, mouseY);
		if (index < 0 || !selectable(level.items.get(index))) return;
		level.keyboard = false;
		if (level.selected == index && levels.size() > levelIndex + 1) return;
		level.selected = index;
		if (level.items.get(index) instanceof Submenu) {
			openSubmenu(levelIndex, index, false);
		} else {
			while (levels.size() > levelIndex + 1) levels.removeLast();
			if (level.items.get(index) instanceof Palette palette) level.swatch = swatchAt(level, index, palette, mouseX, mouseY);
		}
	}

	/** Klick: true = vom Menü verbraucht (auch ein Klick daneben, der das Menü schließt) */
	public boolean mouseClicked(double mouseX, double mouseY) {
		if (!isOpen()) return false;
		int levelIndex = levelAt(mouseX, mouseY);
		if (levelIndex < 0) {
			close();
			return true;
		}
		Level level = levels.get(levelIndex);
		int index = indexAt(level, mouseX, mouseY);
		if (index < 0 || !selectable(level.items.get(index))) return true;
		level.selected = index;
		int swatch = level.items.get(index) instanceof Palette palette ? swatchAt(level, index, palette, mouseX, mouseY) : -1;
		activate(levelIndex, index, swatch);
		return true;
	}

	private int swatchAt(Level level, int index, Palette palette, double mouseX, double mouseY) {
		int top = level.y + rowTop(level, index) - (int) level.scroll + SWATCH_GAP;
		int left = level.x + 8;
		int column = (int) ((mouseX - left) / (SWATCH + SWATCH_GAP));
		int row = (int) ((mouseY - top) / (SWATCH + SWATCH_GAP));
		if (column < 0 || column >= SWATCH_COLUMNS || row < 0) return -1;
		int i = row * SWATCH_COLUMNS + column;
		return i < palette.colors().size() ? i : -1;
	}

	public boolean mouseScrolled(double mouseX, double mouseY, double amount) {
		int levelIndex = levelAt(mouseX, mouseY);
		if (levelIndex < 0) return isOpen();
		Level level = levels.get(levelIndex);
		level.scroll = Math.clamp(level.scroll - amount * ROW, 0, level.maxScroll());
		while (levels.size() > levelIndex + 1) levels.removeLast();
		return true;
	}

	/** Tastatur; true = verbraucht */
	public boolean keyPressed(int key) {
		if (!isOpen()) return false;
		int levelIndex = levels.size() - 1;
		Level level = levels.get(levelIndex);
		level.keyboard = true;
		Item selected = level.selected >= 0 ? level.items.get(level.selected) : null;
		switch (key) {
			case InputConstants.KEY_DOWN, InputConstants.KEY_UP -> {
				level.selected = next(level, level.selected < 0 && key == InputConstants.KEY_UP ? 0 : level.selected, key == InputConstants.KEY_DOWN ? 1 : -1);
				level.swatch = 0;
				ensureVisible(level);
			}
			case InputConstants.KEY_RIGHT -> {
				if (selected instanceof Palette palette) level.swatch = Math.min(palette.colors().size() - 1, level.swatch + 1);
				else if (selected instanceof Submenu) openSubmenu(levelIndex, level.selected, true);
			}
			case InputConstants.KEY_LEFT -> {
				if (selected instanceof Palette && level.swatch > 0) level.swatch--;
				else if (levels.size() > 1) levels.removeLast();
			}
			case InputConstants.KEY_RETURN, InputConstants.KEY_NUMPADENTER, InputConstants.KEY_SPACE -> {
				if (level.selected >= 0) activate(levelIndex, level.selected, selected instanceof Palette ? level.swatch : -1);
			}
			case InputConstants.KEY_ESCAPE -> {
				if (levels.size() > 1) levels.removeLast();
				else close();
			}
			default -> {
				return false;
			}
		}
		return true;
	}

	private void ensureVisible(Level level) {
		if (level.selected < 0) return;
		int top = rowTop(level, level.selected);
		int bottom = top + height(level.items.get(level.selected));
		if (top - PAD < level.scroll) level.scroll = Math.max(0, top - PAD);
		else if (bottom + PAD > level.scroll + level.h) level.scroll = Math.min(level.maxScroll(), bottom + PAD - level.h);
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	public void render(GuiGraphicsExtractor g, int mouseX, int mouseY) {
		if (!isOpen()) return;
		for (Level level : levels) {
			g.nextStratum();
			drawLevel(g, level, mouseX, mouseY);
		}
	}

	private void drawLevel(GuiGraphicsExtractor g, Level level, int mouseX, int mouseY) {
		Ui.shadow(g, level.x, level.y, level.w, level.h, 0.5f);
		Ui.rect(g, level.x, level.y, level.w, level.h, 7, 0xF7121826);
		Ui.outline(g, level.x, level.y, level.w, level.h, 7, Ui.LINE_STRONG);
		g.enableScissor(level.x, level.y + 1, level.x + level.w, level.y + level.h - 1);
		int y = level.y + PAD - (int) level.scroll;
		for (int i = 0; i < level.items.size(); i++) {
			Item item = level.items.get(i);
			int h = height(item);
			if (y + h >= level.y && y <= level.y + level.h) drawItem(g, level, i, item, level.x, y, level.w, mouseX, mouseY);
			y += h;
		}
		g.disableScissor();
		if (level.maxScroll() > 0) Ui.scrollbar(g, level.x + level.w - 5, level.y + 4, level.h - 8, level.scroll, level.maxScroll());
	}

	private void drawItem(GuiGraphicsExtractor g, Level level, int index, Item item, int x, int y, int w, int mouseX, int mouseY) {
		boolean selected = level.selected == index;
		if (selected && selectable(item) && !(item instanceof Palette)) {
			Ui.rect(g, x + 3, y, w - 6, ROW, 4, level.keyboard ? Ui.ACCENT_SOFT : Ui.SURFACE_STRONG);
			if (level.keyboard) Ui.outline(g, x + 3, y, w - 6, ROW, 4, Ui.ACCENT_LINE);
		}
		int textY = y + 3;
		int iconX = x + 9;
		int labelX = x + 9 + 16;
		switch (item) {
			case Header header -> {
				if (header.icon() != null) Ui.icon(g, header.icon(), iconX, y + 4, 9, Ui.ACCENT_TEXT);
				Ui.text(g, Ui.ellipsize(header.label(), w - 34, Ui.Font.LABEL), labelX, y + 4, Ui.TEXT, Ui.Font.LABEL);
			}
			case Separator separator -> Ui.hline(g, x + 6, x + w - 6, y + SEPARATOR / 2f, Ui.LINE_STRONG);
			case Action action -> {
				int color = !action.enabled() ? Ui.FAINT : action.danger() ? Ui.DANGER : Ui.TEXT;
				if (action.icon() != null) Ui.icon(g, action.icon(), iconX, y + 3, 8, !action.enabled() ? Ui.FAINT : action.danger() ? Ui.DANGER : Ui.MUTED);
				int hintW = action.hint() != null ? Ui.width(action.hint(), Ui.Font.SMALL) + 8 : 0;
				Ui.text(g, Ui.ellipsize(action.label(), w - (labelX - x) - 8 - hintW, Ui.Font.BODY), labelX, textY, color, Ui.Font.BODY);
				if (action.hint() != null) Ui.textRight(g, action.hint(), x + w - 9, y + 4, Ui.FAINT, Ui.Font.SMALL);
			}
			case Toggle toggle -> {
				if (toggle.icon() != null) Ui.icon(g, toggle.icon(), iconX, y + 3, 8, Ui.MUTED);
				Ui.text(g, Ui.ellipsize(toggle.label(), w - (labelX - x) - 32, Ui.Font.BODY), labelX, textY, Ui.TEXT, Ui.Font.BODY);
				Ui.toggle(g, x + w - 9 - 18, y + 2, toggle.get().getAsBoolean() ? 1f : 0f);
			}
			case Radio radio -> {
				boolean on = radio.selected().getAsBoolean();
				if (on) Ui.icon(g, "check", iconX, y + 3, 8, Ui.ACCENT_TEXT);
				Ui.text(g, Ui.ellipsize(radio.label(), w - (labelX - x) - 8, Ui.Font.BODY), labelX, textY, on ? Ui.TEXT : Ui.MUTED, Ui.Font.BODY);
			}
			case Submenu submenu -> {
				if (submenu.icon() != null) Ui.icon(g, submenu.icon(), iconX, y + 3, 8, Ui.MUTED);
				String hint = submenu.hint() != null ? submenu.hint().get() : null;
				int hintW = hint != null && !hint.isEmpty() ? Ui.width(hint, Ui.Font.SMALL) + 6 : 0;
				Ui.text(g, Ui.ellipsize(submenu.label(), w - (labelX - x) - 22 - hintW, Ui.Font.BODY), labelX, textY, Ui.TEXT, Ui.Font.BODY);
				if (hintW > 0) {
					if (hint.startsWith("#") && hint.length() == 9) {
						// Farbe als kleines Feld
						Ui.rect(g, x + w - 26, y + 3, 8, 8, 2, (int) Long.parseLong(hint.substring(1), 16) | 0xFF000000);
					} else {
						Ui.textRight(g, hint, x + w - 20, y + 4, Ui.FAINT, Ui.Font.SMALL);
					}
				}
				Ui.icon(g, "chevron-right", x + w - 15, y + 3, 8, Ui.FAINT);
			}
			case Palette palette -> {
				int current = palette.get().getAsInt();
				int top = y + SWATCH_GAP;
				for (int i = 0; i < palette.colors().size(); i++) {
					int column = i % SWATCH_COLUMNS;
					int row = i / SWATCH_COLUMNS;
					int sx = x + 8 + column * (SWATCH + SWATCH_GAP);
					int sy = top + row * (SWATCH + SWATCH_GAP);
					int color = palette.colors().get(i);
					boolean hover = Ui.inside(mouseX, mouseY, sx, sy, SWATCH, SWATCH);
					boolean focused = selected && level.keyboard && level.swatch == i;
					Ui.rect(g, sx, sy, SWATCH, SWATCH, 3, color | 0xFF000000);
					if ((color | 0xFF000000) == (current | 0xFF000000) && current != 0) Ui.outline(g, sx - 1.5f, sy - 1.5f, SWATCH + 3, SWATCH + 3, 4, 0xFFFFFFFF);
					else if (hover || focused) Ui.outline(g, sx - 1.5f, sy - 1.5f, SWATCH + 3, SWATCH + 3, 4, focused ? Ui.ACCENT_TEXT : 0xAAFFFFFF);
				}
			}
		}
	}

	// --- Autotest -------------------------------------------------------------------------

	public int levelCount() {
		return levels.size();
	}

	/** {x, y, w, h} einer Ebene */
	public int[] bounds(int level) {
		Level l = levels.get(level);
		return new int[] {l.x, l.y, l.w, l.h};
	}

	/** Beschriftungen einer Ebene (Trennlinien als "—", Farben als "Palette") */
	public List<String> labels(int level) {
		List<String> labels = new ArrayList<>();
		for (Item item : levels.get(level).items) {
			labels.add(switch (item) {
				case Action a -> a.label();
				case Toggle t -> t.label();
				case Radio r -> r.label();
				case Submenu s -> s.label();
				case Header h -> h.label();
				case Palette p -> "Palette";
				case Separator s -> "—";
			});
		}
		return labels;
	}

	/** Mitte eines Eintrags (null = nicht da oder weggescrollt) */
	public int[] rowCenter(int level, String label) {
		Level l = levels.get(level);
		List<String> labels = labels(level);
		int index = labels.indexOf(label);
		if (index < 0) return null;
		int top = l.y + rowTop(l, index) - (int) l.scroll;
		if (top < l.y || top + ROW > l.y + l.h) {
			l.scroll = Math.clamp(rowTop(l, index) - PAD, 0, l.maxScroll());
			top = l.y + rowTop(l, index) - (int) l.scroll;
		}
		return new int[] {l.x + l.w / 2, top + ROW / 2};
	}

	/** Mitte eines Farbfelds im ersten Farbraster der Ebene */
	public int[] swatchCenter(int level, int swatch) {
		Level l = levels.get(level);
		for (int i = 0; i < l.items.size(); i++) {
			if (l.items.get(i) instanceof Palette) {
				int top = l.y + rowTop(l, i) - (int) l.scroll + SWATCH_GAP;
				return new int[] {l.x + 8 + (swatch % SWATCH_COLUMNS) * (SWATCH + SWATCH_GAP) + SWATCH / 2,
						top + (swatch / SWATCH_COLUMNS) * (SWATCH + SWATCH_GAP) + SWATCH / 2};
			}
		}
		return null;
	}

	/** Beschriftung des markierten Eintrags der obersten Ebene (null = keiner) */
	public String selectedLabel() {
		if (levels.isEmpty()) return null;
		Level l = levels.getLast();
		return l.selected < 0 ? null : labels(levels.size() - 1).get(l.selected);
	}
}
