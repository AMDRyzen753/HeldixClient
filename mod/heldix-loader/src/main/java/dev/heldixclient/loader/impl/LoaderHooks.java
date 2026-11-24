package dev.heldixclient.loader.impl;

import dev.heldixclient.loader.api.KeyMappings;
import dev.heldixclient.loader.api.event.ChatEvents;
import dev.heldixclient.loader.api.event.ClientEvents;
import dev.heldixclient.loader.api.event.HudEvents;
import dev.heldixclient.loader.api.event.ScreenEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Statische Methoden, die der von {@link BuiltinPatches} veränderte Minecraft-Code aufruft.
 * Sie verteilen die Aufrufe an die Events der Loader-API.
 */
public final class LoaderHooks {
	private static boolean inWorld;

	private LoaderHooks() {
	}

	/** Minecraft-Konstruktor, direkt nachdem der Spielordner gesetzt ist. */
	public static void initMods() {
		LoaderCore.initMods();
	}

	/** Options-Konstruktor: Tasten der Mods an die Vanilla-Tasten anhängen. */
	public static KeyMapping[] keyMappings(KeyMapping[] vanilla) {
		List<KeyMapping> modded = KeyMappings.registered();
		if (modded.isEmpty()) return vanilla;
		KeyMapping[] all = Arrays.copyOf(vanilla, vanilla.length + modded.size());
		for (int i = 0; i < modded.size(); i++) all[vanilla.length + i] = modded.get(i);
		return all;
	}

	public static void tickEnd(Minecraft minecraft) {
		ClientEvents.TICK_END.invoke(listener -> listener.onTick(minecraft));
	}

	public static void stopping(Minecraft minecraft) {
		ClientEvents.STOPPING.invoke(listener -> listener.onStopping(minecraft));
	}

	public static void hud(boolean hidden, GuiGraphicsExtractor graphics, DeltaTracker delta) {
		if (hidden) return;
		HudEvents.RENDER.invoke(listener -> listener.render(graphics, delta));
	}

	public static void screenInit(Screen screen) {
		Minecraft minecraft = Minecraft.getInstance();
		ScreenEvents.AFTER_INIT.invoke(listener -> listener.afterInit(minecraft, screen, screen.width, screen.height));
	}

	public static void worldJoin() {
		inWorld = true;
		Minecraft minecraft = Minecraft.getInstance();
		WorldEvents.JOIN.invoke(listener -> listener.onJoin(minecraft));
	}

	/** Verbindung wird getrennt – zählt nur, wenn vorher eine Welt betreten wurde. */
	public static void worldLeave() {
		if (!inWorld) return;
		inWorld = false;
		Minecraft minecraft = Minecraft.getInstance();
		WorldEvents.LEAVE.invoke(listener -> listener.onLeave(minecraft));
	}

	/**
	 * ChatListener.handleSystemMessage. Seit 26.x heißt der boolean "vom Server"; Actionbar-Texte
	 * laufen getrennt über handleOverlay und kommen hier gar nicht an.
	 */
	public static void systemChat(Component message, boolean fromServer) {
		ChatEvents.RECEIVE.invoke(listener -> listener.onMessage(message, false));
	}

	public static void playerChat(Component message) {
		ChatEvents.RECEIVE.invoke(listener -> listener.onMessage(message, true));
	}

	/** ClientLanguage.loadFrom: welche Sprachen gerade geladen werden. */
	public static void languages(List<String> languages) {
		ModTranslations.select(languages);
	}

	/** ClientLanguage.getOrDefault: Mod-Text, falls Ressourcenpakete den Schlüssel nicht haben, sonst null. */
	public static String translate(Map<String, String> storage, String key) {
		if (storage.containsKey(key)) return null;
		return ModTranslations.get(key);
	}

	/** ClientLanguage.has: true, wenn eine Mod den Schlüssel übersetzt. */
	public static boolean hasModTranslation(String key) {
		return ModTranslations.get(key) != null;
	}
}
