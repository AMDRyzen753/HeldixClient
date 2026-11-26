package dev.heldixclient.loader.fabric.mixin;

import dev.heldixclient.loader.fabric.Targets;
import org.spongepowered.asm.mixin.Mixin;

/**
 * Leerer Mixin: Er fügt nichts hinzu, sorgt aber dafür, dass Mixin für jede dieser Klassen
 * {@code HeldixMixinPlugin.postApply} aufruft – dort laufen die Heldix-Transformer.
 * Höchste Priorität, damit die Mixins anderer Mods (Sodium, Iris, Fabric API) vorher angewendet sind.
 *
 * <p>Neue Ziel-Klassen von Heldix-Patches gehören in {@link Targets} und hierher; fehlende meldet der Loader beim Start.
 */
@Mixin(targets = {
		Targets.MINECRAFT,
		Targets.OPTIONS,
		Targets.CLIENT_LANGUAGE,
		Targets.HUD,
		Targets.SCREEN,
		Targets.CHAT_LISTENER,
		Targets.CLIENT_PACKET_LISTENER,
		Targets.CAMERA,
		Targets.MOUSE_HANDLER,
		Targets.GUI_GRAPHICS_EXTRACTOR,
		Targets.ABSTRACT_SELECTION_LIST,
		Targets.TITLE_SCREEN,
		Targets.GAME_RENDERER,
		Targets.DEBUG_SCREEN_OVERLAY,
		Targets.FRAMERATE_LIMIT_TRACKER,
		Targets.LOADING_OVERLAY,
		Targets.GUI,
		Targets.ABSTRACT_CLIENT_PLAYER,
		Targets.CAPE_LAYER,
		Targets.ENTITY,
		Targets.KEYBOARD_INPUT,
		Targets.CHAT_COMPONENT,
		Targets.CHAT_SCREEN,
		Targets.PLAYER_TAB_OVERLAY,
		Targets.ENTITY_RENDERER,
		Targets.LEVEL_LOADING_SCREEN,
		Targets.CONNECT_SCREEN,
		Targets.ITEM_ENTITY_RENDERER,
		Targets.ITEM_ENTITY_RENDER_STATE,
}, priority = 100000)
public abstract class TransformTargets {
}
