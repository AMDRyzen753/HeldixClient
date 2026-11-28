package dev.heldixclient.hud;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * HUD-Elemente vom Server (Nachrichten {@code hud_set}, {@code hud_remove}, {@code hud_clear} auf
 * {@code heldixclient:server}, siehe {@link dev.heldixclient.serverlink.ServerLink}): Text, Fortschritt oder Liste an
 * einem Bezugspunkt, gezeichnet im HUD-Stil von HeldixClient (Stil, Deckkraft, HUD-Größe, Akzentfarbe). Höchstens
 * {@link #MAX_ELEMENTS} je Server; der Spieler kann Server-HUD unter Einstellungen → HUD ausschalten.
 *
 * <p>Elemente an derselben Stelle stehen untereinander (unten: übereinander) in der Reihenfolge, in der der Server sie
 * zuerst gesetzt hat. Nur Haupt-Thread.
 */
public final class ServerHud {
	public static final int MAX_ELEMENTS = 8;
	private static final int MARGIN = 4;
	private static final int GAP = 4;
	private static final int MIN_WIDTH = 64;
	private static final int MAX_WIDTH = 180;

	/** Bezugspunkte aus dem Protokoll */
	public enum Anchor {
		TOP_LEFT("top_left", 0, 0),
		TOP("top", 1, 0),
		TOP_RIGHT("top_right", 2, 0),
		LEFT("left", 0, 1),
		RIGHT("right", 2, 1),
		BOTTOM_LEFT("bottom_left", 0, 2),
		BOTTOM_RIGHT("bottom_right", 2, 2);

		public final String id;
		final int column;
		final int row;

		Anchor(String id, int column, int row) {
			this.id = id;
			this.column = column;
			this.row = row;
		}

		public static Anchor of(String id) {
			for (Anchor anchor : values()) if (anchor.id.equals(id)) return anchor;
			return null;
		}
	}

	public enum Type {
		TEXT, PROGRESS, LIST;

		public static Type of(String id) {
			return switch (id == null ? "" : id) {
				case "text" -> TEXT;
				case "progress" -> PROGRESS;
				case "list" -> LIST;
				default -> null;
			};
		}
	}

	/** Ein Element, wie es der Server geschickt hat (Texte schon bereinigt und gekürzt) */
	public record Element(String id, Type type, Anchor anchor, String title, String text, List<String> lines, float value, Integer color,
			boolean clickable) {
	}

	private static final Map<String, Element> ELEMENTS = new LinkedHashMap<>();
	/** zuletzt gezeichnete Flächen (GUI-Pixel) der anklickbaren Elemente */
	private static final List<Object[]> AREAS = new ArrayList<>();
	private static java.lang.reflect.Field bossEvents;
	private static boolean bossLookupFailed;

	private ServerHud() {
	}

	/**
	 * Element setzen bzw. ersetzen (gleiche ID). false, wenn schon {@link #MAX_ELEMENTS} andere da sind – dann wird es
	 * verworfen.
	 */
	public static boolean set(Element element) {
		if (!ELEMENTS.containsKey(element.id()) && ELEMENTS.size() >= MAX_ELEMENTS) return false;
		ELEMENTS.put(element.id(), element);
		return true;
	}

	public static void remove(String id) {
		ELEMENTS.remove(id);
	}

	public static void clear() {
		ELEMENTS.clear();
		AREAS.clear();
	}

	/** Für Autotest und Doku: die Elemente in Reihenfolge */
	public static List<Element> elements() {
		return List.copyOf(ELEMENTS.values());
	}

	/** Ist Server-HUD gerade sichtbar (Einstellung an, HUD sichtbar)? */
	public static boolean enabled() {
		return HeldixConfig.get().serverHud;
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	/** Aus {@link HudRenderer#extract} (nur wenn die HUD-Elemente sichtbar sind) */
	static void render(GuiGraphicsExtractor g, Minecraft mc) {
		AREAS.clear();
		if (ELEMENTS.isEmpty() || !enabled()) return;
		HudStyles.Resolved style = HudStyles.resolve(null);
		int gui = Math.max(1, mc.getWindow().getGuiScale());
		float scale = style.scale();
		int pixels = Math.max(1, Math.round(gui * scale));
		float factor = HeldixConfig.get().hudCrisp ? pixels / (float) gui : scale;
		int screenW = g.guiWidth();
		int screenH = g.guiHeight();
		// Platz je Bezugspunkt (in GUI-Pixeln, schon belegt)
		Map<Anchor, Integer> used = new LinkedHashMap<>();
		for (Element element : ELEMENTS.values()) {
			HudStyles.Resolved own = HudStyles.forServer(element.anchor().column, element.color());
			HudStyles.Resolved previous = HudStyles.begin(own);
			int previousScale = Ui.pushScale(pixels);
			try {
				int[] size = measure(element);
				int w = Math.round(size[0] * factor);
				int h = Math.round(size[1] * factor);
				int offset = used.getOrDefault(element.anchor(), 0);
				int x = switch (element.anchor().column) {
					case 0 -> MARGIN;
					case 1 -> (screenW - w) / 2;
					default -> screenW - MARGIN - w;
				};
				int y = switch (element.anchor().row) {
					case 0 -> topStart(mc, element.anchor()) + offset;
					case 1 -> (screenH - h) / 2 + offset;
					default -> screenH - MARGIN - h - offset;
				};
				used.put(element.anchor(), offset + h + GAP);
				g.pose().pushMatrix();
				try {
					g.pose().translate(x, y);
					if (factor != 1f) g.pose().scale(factor, factor);
					draw(g, element, size[0], size[1]);
				} finally {
					g.pose().popMatrix();
				}
				if (element.clickable()) AREAS.add(new Object[] {element, new int[] {x, y, w, h}});
			} finally {
				Ui.popScale(previousScale);
				HudStyles.end(previous);
			}
		}
	}

	/** oben: unter den Bossleisten des Servers (Mitte) bzw. am Rand */
	private static int topStart(Minecraft mc, Anchor anchor) {
		if (anchor != Anchor.TOP) return MARGIN;
		int bosses = bossBars(mc);
		return bosses == 0 ? MARGIN : 12 + bosses * 19;
	}

	private static int bossBars(Minecraft mc) {
		if (bossLookupFailed) return 0;
		try {
			if (bossEvents == null) {
				bossEvents = net.minecraft.client.gui.components.BossHealthOverlay.class.getDeclaredField("events");
				bossEvents.setAccessible(true);
			}
			Object events = bossEvents.get(mc.gui.hud.getBossOverlay());
			return events instanceof Map<?, ?> map ? Math.min(map.size(), 6) : 0;
		} catch (ReflectiveOperationException | RuntimeException e) {
			bossLookupFailed = true;
			return 0;
		}
	}

	/** Breite und Höhe in lokalen (ungeskalierten) Koordinaten */
	private static int[] measure(Element element) {
		HudStyles.Resolved s = HudStyles.current();
		int inner = 0;
		int height = 0;
		if (!element.title().isEmpty()) {
			inner = Math.max(inner, HudStyles.width(element.title(), true));
			height += 10;
		}
		for (String line : bodyLines(element)) {
			inner = Math.max(inner, HudStyles.width(line, false));
			height += 10;
		}
		if (element.type() == Type.PROGRESS) {
			inner = Math.max(inner, 100);
			height += (height > 0 ? 2 : 0) + 4;
		}
		if (height == 0) height = 8;
		else height -= element.type() == Type.PROGRESS ? 0 : 2;
		int width = Math.clamp(s.padLeft + inner + s.padRight, MIN_WIDTH, MAX_WIDTH);
		return new int[] {width, s.padY * 2 + height};
	}

	/** Zeilen unter dem Titel: Text (umbrochen, höchstens drei Zeilen) bzw. die Liste */
	private static List<String> bodyLines(Element element) {
		HudStyles.Resolved s = HudStyles.current();
		int max = MAX_WIDTH - s.padLeft - s.padRight;
		List<String> out = new ArrayList<>();
		if (element.type() == Type.LIST) {
			for (String line : element.lines()) out.add(ellipsize(line, max));
			return out;
		}
		if (element.text().isEmpty()) return out;
		// nach Wörtern umbrechen, höchstens drei Zeilen; was nicht passt, endet in der dritten mit „…“
		String[] words = element.text().split(" ");
		StringBuilder line = new StringBuilder();
		int i = 0;
		for (; i < words.length; i++) {
			String next = line.isEmpty() ? words[i] : line + " " + words[i];
			if (!line.isEmpty() && HudStyles.width(next, false) > max) {
				out.add(line.toString());
				line = new StringBuilder(words[i]);
				if (out.size() == 2) {
					i++;
					break;
				}
			} else {
				line = new StringBuilder(next);
			}
		}
		StringBuilder rest = new StringBuilder(line);
		for (; i < words.length; i++) rest.append(' ').append(words[i]);
		if (!rest.isEmpty()) out.add(ellipsize(rest.toString().strip(), max));
		return out;
	}

	private static String ellipsize(String text, int max) {
		if (HudStyles.width(text, false) <= max) return text;
		String cut = text;
		while (!cut.isEmpty() && HudStyles.width(cut + "…", false) > max) cut = cut.substring(0, cut.length() - 1);
		return cut + "…";
	}

	private static void draw(GuiGraphicsExtractor g, Element element, int w, int h) {
		HudStyles.Resolved s = HudStyles.current();
		HudStyles.panel(g, 0, 0, w, h);
		int innerW = w - s.padLeft - s.padRight;
		int y = s.padY;
		int align = s.alignIndex();
		if (!element.title().isEmpty()) {
			text(g, element.title(), s.padLeft, y, innerW, align, s.labelColor(), true);
			y += 10;
		}
		for (String line : bodyLines(element)) {
			text(g, line, s.padLeft, y, innerW, align, s.textColor(), false);
			y += 10;
		}
		if (element.type() == Type.PROGRESS) {
			if (y > s.padY) y += 2;
			HudStyles.bar(g, s.padLeft, y, innerW, 4, element.value(), s.accent());
		}
	}

	private static void text(GuiGraphicsExtractor g, String text, int x, int y, int innerW, int align, int color, boolean label) {
		int width = HudStyles.width(text, label);
		int dx = align == 1 ? (innerW - width) / 2 : align == 2 ? innerW - width : 0;
		HudStyles.text(g, text, x + Math.max(0, dx), y, color, label);
	}

	// ======================================================================================
	// Klicks (nur Elemente mit clickable:true, bei offenem Chat bzw. „HUD bedienen“)
	// ======================================================================================

	/** Anklickbares Element an dieser Stelle (GUI-Pixel) aus dem letzten Bild, sonst null */
	public static Element clickableAt(double mouseX, double mouseY) {
		for (int i = AREAS.size() - 1; i >= 0; i--) {
			Object[] area = AREAS.get(i);
			int[] r = (int[]) area[1];
			if (mouseX >= r[0] && mouseX < r[0] + r[2] && mouseY >= r[1] && mouseY < r[1] + r[3]) return (Element) area[0];
		}
		return null;
	}

	/** Fläche eines Elements aus dem letzten Bild (für die Hervorhebung), sonst null */
	public static int[] areaOf(Element element) {
		for (Object[] area : AREAS) if (area[0] == element) return (int[]) area[1];
		return null;
	}
}
