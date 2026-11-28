package dev.heldixclient.hud;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.Window;
import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HudClick;
import dev.heldixclient.api.HudHover;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.impl.ChatModule;
import dev.heldixclient.module.impl.WaypointsModule;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.HudInteractScreen;
import dev.heldixclient.ui.Keys;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.waypoint.Waypoints;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.ActiveTextCollector;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.gui.components.CommandSuggestions;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.sounds.SoundEvents;

import java.util.ArrayList;
import java.util.List;

/**
 * Anklickbare HUD-Elemente im Spiel: Solange der Chat offen ist (Maus frei) oder die Taste „HUD bedienen“ gedrückt
 * wurde, zeigen Elemente beim Überfahren einen Rahmen und einen Tooltip und reagieren auf Klicks. Beim normalen
 * Spielen nie – und ein Klick auf ein Element erreicht das Spiel nicht (es ist ja ein Menü offen).
 *
 * <p>Im Chat haben Chatnachrichten (Links, Strg+Klick) und das Eingabefeld Vorrang vor den Elementen.
 */
public final class HudInteraction {
	/** Element unter der Maus im letzten Bild (null = keins) */
	private static HudModule hovered;
	/** Wegpunkt-Markierung unter der Maus im letzten Bild */
	private static WaypointsModule.Marker hoveredMarker;
	/** anklickbares HUD-Element vom Server unter der Maus im letzten Bild */
	private static ServerHud.Element hoveredServer;
	/** Tooltip im letzten Bild (für den Autotest) */
	private static List<String> lastTooltip = List.of();
	private static String lastCursor = "DEFAULT";
	/** zuletzt ausgeführte Aktion, z. B. "coordinates:chat" (für den Autotest) */
	private static String lastAction = "";

	private HudInteraction() {
	}

	private static HeldixConfig.Data config() {
		return HeldixConfig.get();
	}

	/** Bedient der Spieler gerade das HUD mit der Maus? */
	public static boolean active() {
		Minecraft mc = Minecraft.getInstance();
		if (!HudRenderer.widgetsVisible(mc)) return false;
		Screen screen = mc.gui.screen();
		if (screen instanceof HudInteractScreen) return true;
		return screen instanceof ChatScreen && config().hudClickable && !config().hudHideChat;
	}

	public static boolean chatOpen() {
		return Minecraft.getInstance().gui.screen() instanceof ChatScreen;
	}

	private static double[] mouse() {
		Minecraft mc = Minecraft.getInstance();
		Window window = mc.getWindow();
		return new double[] {mc.mouseHandler.getScaledXPos(window), mc.mouseHandler.getScaledYPos(window)};
	}

	/** Mausposition in den lokalen (ungeskalierten) Koordinaten eines Elements, null ohne Maus */
	public static float[] local(HudModule module) {
		double[] mouse = mouse();
		return local(module, mouse[0], mouse[1]);
	}

	private static float[] local(HudModule module, double mouseX, double mouseY) {
		float scale = module.drawScale() <= 0 ? 1 : module.drawScale();
		return new float[] {(float) ((mouseX - module.x()) / scale), (float) ((mouseY - module.y()) / scale)};
	}

	/** Oberstes sichtbares Element an dieser Stelle (GUI-Pixel) */
	public static HudModule moduleAt(double mouseX, double mouseY) {
		List<HudModule> modules = ModuleManager.hudByLayer();
		for (int i = modules.size() - 1; i >= 0; i--) {
			HudModule module = modules.get(i);
			if (module.activeHere() && mouseX >= module.x() && mouseX < module.x() + module.width() && mouseY >= module.y()
					&& mouseY < module.y() + module.height()) {
				return module;
			}
		}
		return null;
	}

	// ======================================================================================
	// Zeichnen: Hervorhebung, Tooltip, Mauszeiger
	// ======================================================================================

	/** Am Ende des Chat-Bildes bzw. im Bildschirm „HUD bedienen“ */
	public static void render(GuiGraphicsExtractor g) {
		hovered = null;
		hoveredMarker = null;
		hoveredServer = null;
		lastTooltip = List.of();
		lastCursor = "DEFAULT";
		if (!active()) return;
		Minecraft mc = Minecraft.getInstance();
		double[] mouse = mouse();
		if (blockedByChat(mouse[0], mouse[1])) return;
		HudModule module = moduleAt(mouse[0], mouse[1]);
		List<String> tooltip = List.of();
		HudHover.Cursor cursor = HudHover.Cursor.DEFAULT;
		if (module != null) {
			hovered = module;
			HudPointer pointer = pointer(module, mouse[0], mouse[1], -1, 0);
			HudModule.Hotspot hotspot = module.hotspotAt(pointer.x(), pointer.y());
			try {
				module.onHover(mc, pointer);
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.debug("Tooltip von {} fehlgeschlagen", module.id(), e);
			}
			tooltip = pointer.tooltipLines();
			cursor = pointer.cursorType();
			g.nextStratum();
			// das Element noch einmal über dem Chat zeichnen, damit es beim Überfahren ganz zu sehen ist
			if (chatOpen()) {
				try {
					module.extract(g, mc);
				} catch (RuntimeException e) {
					HeldixClient.LOGGER.debug("{} nicht über dem Chat zeichenbar", module.id(), e);
				}
			}
			int x = module.x();
			int y = module.y();
			Ui.rect(g, x - 2, y - 2, module.width() + 4, module.height() + 4, 5, 0x1A3B82F6);
			Ui.outline(g, x - 2, y - 2, module.width() + 4, module.height() + 4, 5, Ui.ACCENT);
			if (hotspot != null && hotspot.highlight()) {
				float s = module.drawScale();
				Ui.rect(g, x + hotspot.x() * s, y + hotspot.y() * s, hotspot.w() * s, hotspot.h() * s, 3, 0x1CFFFFFF);
			}
		} else {
			WaypointsModule.Marker marker = ModuleManager.waypoints != null ? ModuleManager.waypoints.markerAt(mouse[0], mouse[1]) : null;
			ServerHud.Element element = marker == null ? ServerHud.clickableAt(mouse[0], mouse[1]) : null;
			if (marker != null) {
				hoveredMarker = marker;
				Waypoints.Waypoint w = marker.waypoint();
				tooltip = List.of(w.name, w.coordinates() + " · " + WaypointsModule.formatDistance(marker.distance()), "Klick: Wegpunkte verwalten");
				cursor = HudHover.Cursor.HAND;
			} else if (element != null) {
				// anklickbares Element vom Server: Rahmen, Hand, kurzer Hinweis
				hoveredServer = element;
				int[] area = ServerHud.areaOf(element);
				if (area != null) {
					Ui.rect(g, area[0] - 2, area[1] - 2, area[2] + 4, area[3] + 4, 5, 0x1A3B82F6);
					Ui.outline(g, area[0] - 2, area[1] - 2, area[2] + 4, area[3] + 4, 5, Ui.ACCENT);
				}
				tooltip = List.of(element.title().isEmpty() ? "Vom Server" : element.title(), "Klick: an den Server melden");
				cursor = HudHover.Cursor.HAND;
			}
		}
		lastTooltip = tooltip;
		lastCursor = cursor.name();
		CursorType type = cursorType(cursor);
		if (type != null) g.requestCursor(type);
		if (!tooltip.isEmpty()) Ui.drawTooltipLines(g, tooltip, (int) mouse[0], (int) mouse[1], g.guiWidth(), g.guiHeight());
	}

	/** Pointer mit vorbelegtem Tooltip und Mauszeiger des Bereichs unter der Maus */
	private static HudPointer pointer(HudModule module, double mouseX, double mouseY, int button, int modifiers) {
		float[] local = local(module, mouseX, mouseY);
		HudModule.Hotspot hotspot = module.hotspotAt(local[0], local[1]);
		HudPointer pointer = new HudPointer(local[0], local[1], button, modifiers, hotspot != null ? hotspot.id() : "", chatOpen());
		if (hotspot != null) {
			pointer.tooltip(hotspot.tooltip());
			pointer.cursor(HudHover.Cursor.HAND);
		}
		return pointer;
	}

	private static CursorType cursorType(HudHover.Cursor cursor) {
		return switch (cursor) {
			case HAND -> CursorTypes.POINTING_HAND;
			case TEXT -> CursorTypes.IBEAM;
			case CROSSHAIR -> CursorTypes.CROSSHAIR;
			case MOVE -> CursorTypes.RESIZE_ALL;
			case NOT_ALLOWED -> CursorTypes.NOT_ALLOWED;
			default -> null;
		};
	}

	/**
	 * Im Chat haben Vorrang: das Eingabefeld, anklickbarer Chattext (Links, Befehle, mit Umschalt Einfügungen – wie bei
	 * Minecraft) und mit der Kürzel-Taste jede Nachricht (Strg+Klick bzw. auf dem Mac ⌘-Klick kopiert sie, Chat-Modul).
	 * Normaler Text darüber blockiert nicht.
	 */
	private static boolean blockedByChat(double mouseX, double mouseY) {
		Minecraft mc = Minecraft.getInstance();
		if (!(mc.gui.screen() instanceof ChatScreen)) return false;
		int height = mc.getWindow().getGuiScaledHeight();
		if (mouseY >= height - 14) return true;
		try {
			ActiveTextCollector.ClickableStyleFinder finder = new ActiveTextCollector.ClickableStyleFinder(mc.font, (int) mouseX, (int) mouseY)
					.includeInsertions(mc.hasShiftDown());
			mc.gui.hud.getChat().captureClickableText(finder, height, mc.gui.hud.getGuiTicks(), ChatComponent.DisplayMode.FOREGROUND);
			if (finder.result() != null) return true;
			return Keys.shortcutHeld() && ChatModule.messageAt(mouseX, mouseY) != null;
		} catch (RuntimeException e) {
			return false;
		}
	}

	// ======================================================================================
	// Klicks
	// ======================================================================================

	/** Hook ChatScreen.mouseClicked (nach Strg+Klick bzw. ⌘-Klick): true = verbraucht */
	public static boolean chatClick(CommandSuggestions suggestions, MouseButtonEvent event) {
		if (!active()) return false;
		// Befehlsvorschläge wie bei Minecraft zuerst
		if (suggestions != null && suggestions.mouseClicked(event)) return true;
		if (blockedByChat(event.x(), event.y())) return false;
		return click(event);
	}

	/** Klick an GUI-Koordinaten; true = ein Element (oder eine Markierung) lag darunter */
	public static boolean click(MouseButtonEvent event) {
		if (!active()) return false;
		Minecraft mc = Minecraft.getInstance();
		int button = button(event.button());
		HudModule module = moduleAt(event.x(), event.y());
		if (module == null) {
			WaypointsModule.Marker marker = ModuleManager.waypoints != null ? ModuleManager.waypoints.markerAt(event.x(), event.y()) : null;
			if (marker == null) {
				// anklickbares HUD-Element vom Server: hud_click an den Server
				ServerHud.Element element = button == HudClick.LEFT ? ServerHud.clickableAt(event.x(), event.y()) : null;
				if (element == null) return false;
				action("server:" + element.id());
				if (dev.heldixclient.serverlink.ServerLink.click(element)) sound(mc);
				return true;
			}
			action("waypoint:open");
			sound(mc);
			mc.gui.setScreen(new HeldixMenuScreen(mc.gui.screen(), Shell.Page.WAYPOINTS));
			return true;
		}
		HudPointer pointer = pointer(module, event.x(), event.y(), button, event.modifiers());
		boolean consumed;
		try {
			consumed = module.onClick(mc, pointer);
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.warn("Klick auf {} fehlgeschlagen", module.id(), e);
			consumed = false;
		}
		if (!consumed && button == HudClick.RIGHT) {
			openSettings(mc, module);
			consumed = true;
		}
		if (consumed) sound(mc);
		return true;
	}

	public static void openSettings(Minecraft mc, HudModule module) {
		action(module.id() + ":settings");
		mc.gui.setScreen(new HeldixMenuScreen(mc.gui.screen(), Shell.Page.MODULES, module));
	}

	/** SDL-Maustaste → {@link HudClick#LEFT}, RIGHT, MIDDLE (sonst -1) */
	public static int button(int sdl) {
		return switch (sdl) {
			case InputConstants.MOUSE_BUTTON_LEFT -> HudClick.LEFT;
			case InputConstants.MOUSE_BUTTON_RIGHT -> HudClick.RIGHT;
			case InputConstants.MOUSE_BUTTON_MIDDLE -> HudClick.MIDDLE;
			default -> -1;
		};
	}

	private static void sound(Minecraft mc) {
		mc.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	/** Aktion merken (Autotest, Log) */
	public static void action(String what) {
		lastAction = what;
		HeldixClient.LOGGER.debug("HUD-Aktion {}", what);
	}

	// --- Autotest -------------------------------------------------------------------------

	public static String lastAction() {
		return lastAction;
	}

	public static void clearLastAction() {
		lastAction = "";
	}

	public static List<String> lastTooltip() {
		return new ArrayList<>(lastTooltip);
	}

	public static String lastCursor() {
		return lastCursor;
	}

	public static String hoveredId() {
		return hovered != null ? hovered.id() : hoveredMarker != null ? "waypoint" : hoveredServer != null ? "server:" + hoveredServer.id() : null;
	}
}
