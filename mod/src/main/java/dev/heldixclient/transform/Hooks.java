package dev.heldixclient.transform;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.api.event.ScreenEvents;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.impl.CpsModule;
import dev.heldixclient.module.impl.ZoomModule;
import dev.heldixclient.render.DebugOverlay;
import dev.heldixclient.render.Performance;
import dev.heldixclient.render.Shaders;
import dev.heldixclient.screen.HeldixTitle;
import dev.heldixclient.screen.LoadingScreen;
import com.mojang.renderpearl.api.pipeline.RenderPipeline;
import net.minecraft.client.gui.screens.LoadingOverlay;
import net.minecraft.client.renderer.texture.TextureManager;
import java.util.function.IntSupplier;
import dev.heldixclient.ui.WidgetStyle;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.resources.Identifier;

import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

/** Wird vom durch {@link HeldixPatches} veränderten Minecraft-Code aufgerufen. Alles im Hauptthread. */
public final class Hooks {
	/** Heldix-Hauptmenü je TitleScreen (eigene Einblend-Animation pro Menü) */
	private static final Map<TitleScreen, HeldixTitle> TITLES = new WeakHashMap<>();

	private Hooks() {
	}

	// --- Kamera / Fenster -------------------------------------------------------------------

	public static float fov(float fov) {
		ZoomModule zoom = ModuleManager.zoom;
		if (zoom == null) return fov;
		float divisor = zoom.fovDivisor();
		return divisor != 1f ? fov / divisor : fov;
	}

	public static String windowTitle(String vanilla) {
		return HeldixClient.NAME + " " + HeldixClient.version + " | " + vanilla;
	}

	// --- Ladebildschirm ---------------------------------------------------------------------

	public static void loadingTextures(TextureManager textures) {
		LoadingScreen.registerTextures(textures);
	}

	public static int loadingBackground(IntSupplier vanilla) {
		return LoadingScreen.background(vanilla);
	}

	/** Erste Hälfte des Mojang-Logos: im Heldix-Design Hintergrund, Leuchten und Heldix-Logo. */
	public static void loadingLogo(GuiGraphicsExtractor g, RenderPipeline pipeline, Identifier texture, int x, int y, float u, float v,
			int width, int height, int regionWidth, int regionHeight, int textureWidth, int textureHeight, int color) {
		if (LoadingScreen.active()) LoadingScreen.logo(g, color);
		else g.blit(pipeline, texture, x, y, u, v, width, height, regionWidth, regionHeight, textureWidth, textureHeight, color);
	}

	public static void loadingLogoSecondHalf(GuiGraphicsExtractor g, RenderPipeline pipeline, Identifier texture, int x, int y, float u, float v,
			int width, int height, int regionWidth, int regionHeight, int textureWidth, int textureHeight, int color) {
		if (!LoadingScreen.active()) g.blit(pipeline, texture, x, y, u, v, width, height, regionWidth, regionHeight, textureWidth, textureHeight, color);
	}

	/** true = eigener Ladebalken gezeichnet, Vanilla überspringen. */
	public static boolean loadingProgress(LoadingOverlay overlay, GuiGraphicsExtractor g, float opacity) {
		if (!LoadingScreen.active()) return false;
		LoadingScreen.progress(overlay, g, opacity);
		return true;
	}

	// --- Grafik ----------------------------------------------------------------------------

	/** GameRenderer.update: Shader-Stil als Post-Effekt anfordern. */
	public static void postEffects(List<Identifier> requested) {
		Shaders.request(requested);
	}

	/** FramerateLimitTracker.getFramerateLimit: weniger FPS im Hintergrund. */
	public static int framerateLimit(int limit) {
		return Performance.framerateLimit(limit);
	}

	/** DebugScreenOverlay.extractLines: Hintergrund einer F3-Zeile. */
	public static void debugLine(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int color, boolean left) {
		DebugOverlay.line(g, x1, y1, x2, y2, color, left);
	}

	// --- Maus -------------------------------------------------------------------------------

	/** Zählt Klicks für das CPS-Modul (nur im Spiel, nicht in Menüs). */
	public static void mouseButton(MouseButtonInfo info, int action) {
		if (action == InputConstants.PRESS && Minecraft.getInstance().gui.screen() == null) {
			CpsModule.onClick(info.button());
		}
	}

	/** Mausrad ändert beim Zoomen die Zoomstärke statt den Hotbar-Slot. true = Vanilla überspringen. */
	public static boolean mouseScroll(double yOffset) {
		ZoomModule zoom = ModuleManager.zoom;
		return zoom != null && Minecraft.getInstance().gui.screen() == null && zoom.onScroll(yOffset);
	}

	// --- Widget-Design ----------------------------------------------------------------------

	public static boolean sprite(GuiGraphicsExtractor g, Identifier sprite, int x, int y, int width, int height, int color) {
		return WidgetStyle.sprite(g, sprite, x, y, width, height, color);
	}

	public static boolean texture(GuiGraphicsExtractor g, Identifier texture, int x, int y, int width, int height) {
		return WidgetStyle.texture(g, texture, x, y, width, height);
	}

	/** Rahmen des ausgewählten Listeneintrags (Vanilla: Weiß wenn fokussiert, sonst Grau). */
	public static void selectionFrame(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int color) {
		if (!WidgetStyle.enabled()) {
			g.fill(x1, y1, x2, y2, color);
			return;
		}
		WidgetStyle.selection(g, x1, y1, x2 - x1, y2 - y1, color == -1);
	}

	/** Schwarze Innenfläche des ausgewählten Eintrags – im Heldix-Design entfällt sie. */
	public static void selectionInner(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int color) {
		if (!WidgetStyle.enabled()) g.fill(x1, y1, x2, y2, color);
	}

	// --- Hauptmenü --------------------------------------------------------------------------

	/** Ersetzt den Aufbau des Hauptmenüs. true = Vanilla-init überspringen. */
	public static boolean titleInit(TitleScreen screen) {
		Minecraft minecraft = Minecraft.getInstance();
		if (!HeldixTitle.shouldReplace(minecraft)) return false;
		HeldixTitle title = TITLES.computeIfAbsent(screen, s -> new HeldixTitle(minecraft));
		for (AbstractWidget widget : title.createWidgets(screen, screen.width, screen.height)) {
			ScreenEvents.addWidget(screen, widget);
		}
		return true;
	}

	public static boolean titleActive(TitleScreen screen) {
		return TITLES.containsKey(screen) && HeldixTitle.shouldReplace(Minecraft.getInstance());
	}

	public static void titleBackground(TitleScreen screen, GuiGraphicsExtractor g) {
		TITLES.get(screen).extractBackground(g, screen.width, screen.height);
	}

	public static void titleDecorations(TitleScreen screen, GuiGraphicsExtractor g) {
		TITLES.get(screen).extractDecorations(g, Minecraft.getInstance().font, screen.width, screen.height);
	}

	/** Vanilla-Hauptmenü (Heldix-Design aus): kleines Abzeichen oben links. */
	public static void titleAfterRender(TitleScreen screen, GuiGraphicsExtractor g) {
		if (!titleActive(screen)) HeldixClient.drawBranding(g, Minecraft.getInstance().font);
		else TITLES.get(screen).afterRender(g, screen.width, screen.height);
	}

	// --- Menüs -----------------------------------------------------------------------------

	/** Gui.setScreen: Einzel- und Mehrspieler-Menü durch die Heldix-Seiten ersetzen. */
	public static Screen replaceScreen(Screen screen) {
		try {
			return Shell.replace(screen);
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.error("Menü konnte nicht ersetzt werden", e);
			return screen;
		}
	}
}
