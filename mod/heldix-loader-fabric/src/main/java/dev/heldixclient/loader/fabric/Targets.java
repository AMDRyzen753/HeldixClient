package dev.heldixclient.loader.fabric;

import java.util.List;

/**
 * Minecraft-Klassen, die die Heldix-Transformer in Fabric verändern dürfen (Ziele von {@code mixin.TransformTargets}).
 * Eigene Klasse, weil Mixin-Klassen nicht direkt geladen werden dürfen.
 */
public final class Targets {
	// Heldix Loader (BuiltinPatches)
	public static final String MINECRAFT = "net.minecraft.client.Minecraft";
	public static final String OPTIONS = "net.minecraft.client.Options";
	public static final String CLIENT_LANGUAGE = "net.minecraft.client.resources.language.ClientLanguage";
	public static final String HUD = "net.minecraft.client.gui.Hud";
	public static final String SCREEN = "net.minecraft.client.gui.screens.Screen";
	public static final String CHAT_LISTENER = "net.minecraft.client.multiplayer.chat.ChatListener";
	public static final String CLIENT_PACKET_LISTENER = "net.minecraft.client.multiplayer.ClientPacketListener";
	// HeldixClient (HeldixPatches)
	public static final String CAMERA = "net.minecraft.client.Camera";
	public static final String MOUSE_HANDLER = "net.minecraft.client.MouseHandler";
	public static final String GUI_GRAPHICS_EXTRACTOR = "net.minecraft.client.gui.GuiGraphicsExtractor";
	public static final String ABSTRACT_SELECTION_LIST = "net.minecraft.client.gui.components.AbstractSelectionList";
	public static final String TITLE_SCREEN = "net.minecraft.client.gui.screens.TitleScreen";
	public static final String GAME_RENDERER = "net.minecraft.client.renderer.GameRenderer";
	public static final String DEBUG_SCREEN_OVERLAY = "net.minecraft.client.gui.components.DebugScreenOverlay";
	public static final String FRAMERATE_LIMIT_TRACKER = "com.mojang.blaze3d.platform.FramerateLimitTracker";
	public static final String LOADING_OVERLAY = "net.minecraft.client.gui.screens.LoadingOverlay";
	public static final String GUI = "net.minecraft.client.gui.Gui";
	public static final String ABSTRACT_CLIENT_PLAYER = "net.minecraft.client.player.AbstractClientPlayer";
	public static final String CAPE_LAYER = "net.minecraft.client.renderer.entity.layers.CapeLayer";
	public static final String ENTITY = "net.minecraft.world.entity.Entity";
	public static final String KEYBOARD_INPUT = "net.minecraft.client.player.KeyboardInput";
	public static final String CHAT_COMPONENT = "net.minecraft.client.gui.components.ChatComponent";
	public static final String CHAT_SCREEN = "net.minecraft.client.gui.screens.ChatScreen";
	public static final String PLAYER_TAB_OVERLAY = "net.minecraft.client.gui.components.PlayerTabOverlay";
	public static final String ENTITY_RENDERER = "net.minecraft.client.renderer.entity.EntityRenderer";
	public static final String LEVEL_LOADING_SCREEN = "net.minecraft.client.gui.screens.LevelLoadingScreen";
	public static final String CONNECT_SCREEN = "net.minecraft.client.gui.screens.ConnectScreen";

	public static final List<String> ALL = List.of(
			MINECRAFT,
			OPTIONS,
			CLIENT_LANGUAGE,
			HUD,
			SCREEN,
			CHAT_LISTENER,
			CLIENT_PACKET_LISTENER,
			CAMERA,
			MOUSE_HANDLER,
			GUI_GRAPHICS_EXTRACTOR,
			ABSTRACT_SELECTION_LIST,
			TITLE_SCREEN,
			GAME_RENDERER,
			DEBUG_SCREEN_OVERLAY,
			FRAMERATE_LIMIT_TRACKER,
			LOADING_OVERLAY,
			GUI,
			ABSTRACT_CLIENT_PLAYER,
			CAPE_LAYER,
			ENTITY,
			KEYBOARD_INPUT,
			CHAT_COMPONENT,
			CHAT_SCREEN,
			PLAYER_TAB_OVERLAY,
			ENTITY_RENDERER,
			LEVEL_LOADING_SCREEN,
			CONNECT_SCREEN);

	private Targets() {
	}
}
