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
			GUI);

	private Targets() {
	}
}
