package dev.heldixclient.ui;

import dev.heldixclient.config.HeldixConfig;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.resources.Identifier;

/**
 * Ersetzt Minecrafts Widget-Grafiken (Buttons, Textfelder, Schieberegler, Scrollbalken,
 * Menü-Hintergründe, Listen und Trennlinien) durch das Heldix-Design.
 * Wird über HeldixPatches/Hooks aus GuiGraphicsExtractor aufgerufen und gilt damit für alle Menüs.
 */
public final class WidgetStyle {
	private static final String MINECRAFT = "minecraft";

	private WidgetStyle() {
	}

	public static boolean enabled() {
		return HeldixConfig.get().customMenus;
	}

	/** @return true, wenn das Sprite ersetzt wurde und Vanilla nichts mehr zeichnen soll */
	public static boolean sprite(GuiGraphicsExtractor g, Identifier id, int x, int y, int w, int h, int color) {
		if (!enabled() || !MINECRAFT.equals(id.getNamespace())) return false;
		String path = id.getPath();
		if (!path.startsWith("widget/")) return false;
		float a = ((color >>> 24) & 0xFF) / 255f;
		switch (path) {
			case "widget/button" -> button(g, x, y, w, h, a, false, true);
			case "widget/button_highlighted" -> button(g, x, y, w, h, a, true, true);
			case "widget/button_disabled" -> button(g, x, y, w, h, a, false, false);
			case "widget/text_field" -> field(g, x, y, w, h, a, false);
			case "widget/text_field_highlighted" -> field(g, x, y, w, h, a, true);
			case "widget/slider" -> field(g, x, y, w, h, a, false);
			case "widget/slider_highlighted" -> field(g, x, y, w, h, a, true);
			case "widget/slider_handle" -> handle(g, x, y, w, h, a, false);
			case "widget/slider_handle_highlighted" -> handle(g, x, y, w, h, a, true);
			case "widget/scroller_background" -> g.fill(x + w / 2 - 1, y, x + w / 2 + 1, y + h, Draw.withAlpha(0x26FFFFFF, a));
			case "widget/scroller" -> Draw.rounded(g, x + 1, y, Math.max(2, w - 2), h, Draw.withAlpha(0xA0FFFFFF, a));
			default -> {
				return false;
			}
		}
		return true;
	}

	/** @return true, wenn die Textur ersetzt wurde */
	public static boolean texture(GuiGraphicsExtractor g, Identifier id, int x, int y, int w, int h) {
		if (!enabled() || !MINECRAFT.equals(id.getNamespace())) return false;
		switch (id.getPath()) {
			case "textures/gui/menu_background.png" -> menuBackground(g, x, y, w, h);
			case "textures/gui/inworld_menu_background.png" -> g.fillGradient(x, y, x + w, y + h, 0x400A1628, 0x90050B16);
			case "textures/gui/menu_list_background.png", "textures/gui/inworld_menu_list_background.png" ->
					g.fill(x, y, x + w, y + h, 0x12FFFFFF);
			case "textures/gui/header_separator.png", "textures/gui/inworld_header_separator.png" -> {
				g.fill(x, y + h - 1, x + w, y + h, 0x30FFFFFF);
				Draw.accentLine(g, x + w / 4, y + h - 1, w / 2, 1);
			}
			case "textures/gui/footer_separator.png", "textures/gui/inworld_footer_separator.png" ->
					g.fill(x, y, x + w, y + 1, 0x30FFFFFF);
			default -> {
				return false;
			}
		}
		return true;
	}

	public static void selection(GuiGraphicsExtractor g, int x, int y, int w, int h, boolean focused) {
		Draw.rounded2(g, x, y, w, h, 0x2A38BDF8);
		Draw.outline2(g, x, y, w, h, focused ? Theme.ACCENT_LIGHT : 0x907DD3FC);
		g.fill(x + 3, y + 1, x + w - 3, y + 2, 0x30FFFFFF);
	}

	/** Hauptmenüs: Minecraft hat das Panorama bereits verschwommen, darüber eine leichte Blautönung. */
	private static void menuBackground(GuiGraphicsExtractor g, int x, int y, int w, int h) {
		g.fillGradient(x, y, x + w, y + h, 0x33081A3A, 0x99030A18);
	}

	private static void button(GuiGraphicsExtractor g, int x, int y, int w, int h, float a, boolean hovered, boolean enabled) {
		if (!enabled) {
			Draw.rounded2(g, x, y, w, h, Draw.withAlpha(0x12FFFFFF, a));
			Draw.outline2(g, x, y, w, h, Draw.withAlpha(0x1CFFFFFF, a));
			return;
		}
		Draw.rounded2(g, x, y, w, h, Draw.withAlpha(hovered ? 0x40FFFFFF : 0x24FFFFFF, a));
		g.fill(x + 3, y + 1, x + w - 3, y + 2, Draw.withAlpha(hovered ? 0x66FFFFFF : 0x3AFFFFFF, a));
		Draw.outline2(g, x, y, w, h, Draw.withAlpha(hovered ? Theme.ACCENT_LIGHT : 0x40FFFFFF, a));
		if (hovered && w > 12) {
			g.fill(x + 6, y + h - 2, x + w - 6, y + h - 1, Draw.withAlpha(0xC038BDF8, a));
		}
	}

	private static void field(GuiGraphicsExtractor g, int x, int y, int w, int h, float a, boolean focused) {
		Draw.rounded2(g, x, y, w, h, Draw.withAlpha(0x70040C1C, a));
		Draw.outline2(g, x, y, w, h, Draw.withAlpha(focused ? Theme.ACCENT_LIGHT : 0x40FFFFFF, a));
	}

	private static void handle(GuiGraphicsExtractor g, int x, int y, int w, int h, float a, boolean hovered) {
		Draw.rounded2(g, x, y, w, h, Draw.withAlpha(hovered ? 0xFFFFFFFF : 0xFFE0F2FE, a));
		Draw.outline2(g, x, y, w, h, Draw.withAlpha(hovered ? Theme.ACCENT : 0x9038BDF8, a));
	}
}
