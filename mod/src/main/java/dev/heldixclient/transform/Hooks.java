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
	/** Skin eines Spielers: der eigene bekommt das gewählte Heldix-Cape */
	public static net.minecraft.world.entity.player.PlayerSkin playerSkin(net.minecraft.world.entity.player.PlayerSkin skin,
			net.minecraft.client.player.AbstractClientPlayer player) {
		return dev.heldixclient.cosmetic.Capes.forPlayer(skin, player);
	}

	/**
	 * Cape zeichnen (ersetzt den Aufruf in CapeLayer.submit): erst normal, dann – bei Heldix-Capes mit Leuchten –
	 * die leuchtenden Teile noch einmal voll hell und additiv darüber (wie die Augen von Spinnen).
	 */
	@SuppressWarnings({"unchecked", "rawtypes"})
	public static void capeModel(net.minecraft.client.renderer.SubmitNodeCollector collector, net.minecraft.client.model.Model model, Object state,
			com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.rendertype.RenderType type, int light, int overlay, int outline) {
		if (state instanceof net.minecraft.client.renderer.entity.state.AvatarRenderState avatar && avatar.skin != null && avatar.skin.cape() != null
				&& dev.heldixclient.config.HeldixConfig.get().capeCloth && dev.heldixclient.cosmetic.CapeCloth.supports(model)) {
			// wehender Stoff statt starrer Platte (für alle Capes)
			Identifier texture = avatar.skin.cape().texturePath();
			dev.heldixclient.cosmetic.CapeCloth.submit(collector, model, avatar, pose, texture, dev.heldixclient.cosmetic.Capes.glowFor(texture), light, overlay);
			return;
		}
		collector.submitModel(model, state, pose, type, light, overlay, outline);
		if (state instanceof net.minecraft.client.renderer.entity.state.AvatarRenderState avatar && avatar.skin != null && avatar.skin.cape() != null) {
			Identifier glow = dev.heldixclient.cosmetic.Capes.glowFor(avatar.skin.cape().texturePath());
			if (glow != null) {
				collector.submitModel(model, state, pose, net.minecraft.client.renderer.rendertype.RenderTypes.eyes(glow), 0xF000F0, overlay, 0);
			}
		}
	}

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
		// ab jetzt sind die Schriften geladen: der Ladebildschirm darf beim nächsten Neuladen Tipps zeigen
		LoadingScreen.fontsReady = true;
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

	// --- Module: Fadenkreuz, Effekte, Dauersprint, Freelook, Chat, Tab-Liste -------------------

	/** Hud.extractCrosshair: eigenes Fadenkreuz statt des Vanilla-Bildes (Bedingungen bleiben Vanilla). */
	public static void crosshair(GuiGraphicsExtractor g, RenderPipeline pipeline, Identifier sprite, int x, int y, int width, int height) {
		dev.heldixclient.module.impl.CrosshairModule module = ModuleManager.crosshair;
		if (module != null && module.isEnabled()) module.draw(g, Minecraft.getInstance());
		else g.blitSprite(pipeline, sprite, x, y, width, height);
	}

	/** Hud.extractEffects: true = Vanilla-Symbole oben rechts ausblenden (Modul Trank-Effekte). */
	public static boolean hideVanillaEffects() {
		return ModuleManager.effects != null && ModuleManager.effects.hidesVanilla();
	}

	public static boolean sprintKey(net.minecraft.client.KeyMapping key) {
		return ModuleManager.toggleSprint != null ? ModuleManager.toggleSprint.sprintDown(key) : key.isDown();
	}

	public static boolean sneakKey(net.minecraft.client.KeyMapping key) {
		return ModuleManager.toggleSprint != null ? ModuleManager.toggleSprint.sneakDown(key) : key.isDown();
	}

	/** Entity.turn: true = Mausbewegung dreht nur die Freelook-Kamera. */
	public static boolean turn(net.minecraft.world.entity.Entity entity, double yaw, double pitch) {
		return ModuleManager.freelook != null && ModuleManager.freelook.turn(entity, yaw, pitch);
	}

	public static float cameraYaw(net.minecraft.world.entity.Entity entity, float partialTick) {
		return ModuleManager.freelook != null ? ModuleManager.freelook.cameraYaw(entity, partialTick) : entity.getViewYRot(partialTick);
	}

	public static float cameraPitch(net.minecraft.world.entity.Entity entity, float partialTick) {
		return ModuleManager.freelook != null ? ModuleManager.freelook.cameraPitch(entity, partialTick) : entity.getViewXRot(partialTick);
	}

	/** ChatComponent.addMessage: Inhalt einer neuen Nachricht (Uhrzeit, Zähler). */
	public static net.minecraft.network.chat.Component chatMessage(net.minecraft.client.gui.components.ChatComponent chat,
			net.minecraft.network.chat.Component content) {
		try {
			return ModuleManager.chat != null ? ModuleManager.chat.process(chat, content) : content;
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.warn("Chat-Verbesserungen fehlgeschlagen", e);
			return content;
		}
	}

	/** ChatScreen.mouseClicked: true = Klick verbraucht (Strg+Klick kopiert). */
	public static boolean chatClick(net.minecraft.client.input.MouseButtonEvent event) {
		return ModuleManager.chat != null && ModuleManager.chat.click(event);
	}

	/** PlayerTabOverlay.getNameForDisplay: Heldix-Symbol vor HeldixClient-Spielern. */
	public static net.minecraft.network.chat.Component tabName(net.minecraft.network.chat.Component name, net.minecraft.client.multiplayer.PlayerInfo info) {
		if (name == null || info == null || !dev.heldixclient.social.Social.isHeldix(info.getProfile().id())) return name;
		return dev.heldixclient.social.Badge.prefix(name);
	}

	/** LevelLoadingScreen/ConnectScreen: Tipp-Karte mit Spielfigur unten. */
	public static void loadingTips(Screen screen, GuiGraphicsExtractor g) {
		try {
			dev.heldixclient.screen.LoadingTips.draw(screen, g);
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.warn("Tipp auf dem Ladebildschirm fehlgeschlagen", e);
		}
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
