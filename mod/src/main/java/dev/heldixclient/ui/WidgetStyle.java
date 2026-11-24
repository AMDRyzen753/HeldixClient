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
			case "widget/scroller" -> Ui.rect(g, x + 1, y, Math.max(2, w - 2), h, Math.max(1, (w - 2) / 2f), Draw.withAlpha(0x88FFFFFF, a));
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
		Ui.rect(g, x, y, w, h, 6, 0x1F3B82F6);
		Ui.outline(g, x, y, w, h, 6, focused ? Ui.ACCENT : Ui.ACCENT_LINE);
	}

	/** Menüs ohne Welt: Heldix-Hintergrund (falls eingestellt), darüber eine Abdunkelung. */
	private static void menuBackground(GuiGraphicsExtractor g, int x, int y, int w, int h) {
		if (dev.heldixclient.config.HeldixConfig.get().heldixBackground && net.minecraft.client.Minecraft.getInstance().level == null) {
			Ui.background(g, g.guiWidth(), g.guiHeight(), 1f);
		}
		g.fillGradient(x, y, x + w, y + h, 0x8C060A13, 0xC7060A13);
	}

	private static void button(GuiGraphicsExtractor g, int x, int y, int w, int h, float a, boolean hovered, boolean enabled) {
		float r = Math.min(6, h / 2f);
		if (!enabled) {
			Ui.rect(g, x, y, w, h, r, Draw.withAlpha(0x0CFFFFFF, a));
			Ui.outline(g, x, y, w, h, r, Draw.withAlpha(0x12FFFFFF, a));
			return;
		}
		Ui.rect(g, x, y, w, h, r, Draw.withAlpha(hovered ? 0x2EFFFFFF : 0x1AFFFFFF, a));
		Ui.outline(g, x, y, w, h, r, Draw.withAlpha(hovered ? Ui.ACCENT_LINE : Ui.LINE_STRONG, a));
	}

	private static void field(GuiGraphicsExtractor g, int x, int y, int w, int h, float a, boolean focused) {
		float r = Math.min(6, h / 2f);
		Ui.rect(g, x, y, w, h, r, Draw.withAlpha(0x99060A13, a));
		Ui.outline(g, x, y, w, h, r, Draw.withAlpha(focused ? Ui.ACCENT_LINE : Ui.LINE_STRONG, a));
	}

	private static void handle(GuiGraphicsExtractor g, int x, int y, int w, int h, float a, boolean hovered) {
		// nur Flächen (ohne Ecken-Grafik), damit der Text des Reglers darüber bleibt
		Ui.rect(g, x + 1, y, w - 2, h, 0, Draw.withAlpha(hovered ? 0xFFFFFFFF : 0xFFDCE6F5, a));
		Ui.rect(g, x, y + 1, w, h - 2, 0, Draw.withAlpha(hovered ? 0xFFFFFFFF : 0xFFDCE6F5, a));
	}
}
