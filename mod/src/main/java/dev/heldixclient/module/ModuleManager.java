package dev.heldixclient.module;

import dev.heldixclient.module.impl.ArmorStatusModule;
import dev.heldixclient.module.impl.ChatModule;
import dev.heldixclient.module.impl.CoordinatesModule;
import dev.heldixclient.module.impl.CrosshairModule;
import dev.heldixclient.module.impl.EffectsModule;
import dev.heldixclient.module.impl.FreelookModule;
import dev.heldixclient.module.impl.ToggleSprintModule;
import dev.heldixclient.module.impl.WaypointsModule;
import dev.heldixclient.module.impl.CpsModule;
import dev.heldixclient.module.impl.FpsModule;
import dev.heldixclient.module.impl.KeystrokesModule;
import dev.heldixclient.module.impl.PingModule;
import dev.heldixclient.module.impl.ZoomModule;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class ModuleManager {
	private static final List<Module> MODULES = new ArrayList<>();
	private static final List<HudModule> HUD_MODULES = new ArrayList<>();

	public static ZoomModule zoom;
	public static EffectsModule effects;
	public static ToggleSprintModule toggleSprint;
	public static FreelookModule freelook;
	public static CrosshairModule crosshair;
	public static ChatModule chat;
	public static WaypointsModule waypoints;

	private ModuleManager() {
	}

	public static void init() {
		register(new FpsModule());
		register(new CpsModule());
		register(new PingModule());
		register(new CoordinatesModule());
		register(new KeystrokesModule());
		zoom = register(new ZoomModule());
		register(new ArmorStatusModule());
		effects = register(new EffectsModule());
		toggleSprint = register(new ToggleSprintModule());
		freelook = register(new FreelookModule());
		crosshair = register(new CrosshairModule());
		chat = register(new ChatModule());
		waypoints = register(new WaypointsModule());
	}

	/** Für den Heldix Loader: Module aus Addons hinzufügen bzw. wieder entfernen. */
	public static void addModule(Module module) {
		register(module);
	}

	public static void removeModule(Module module) {
		MODULES.remove(module);
		if (module instanceof HudModule hud) HUD_MODULES.remove(hud);
	}

	private static <T extends Module> T register(T module) {
		MODULES.add(module);
		if (module instanceof HudModule hud) HUD_MODULES.add(hud);
		if (toggleKeys) createToggleKey(module);
		return module;
	}

	// --- Tasten zum Ein- und Ausschalten ------------------------------------------------------

	private static boolean toggleKeys;
	private static net.minecraft.client.KeyMapping.Category keyCategory;

	/**
	 * Nach den Haupttasten von HeldixClient: für jedes Modul eine Taste zum Ein- und Ausschalten anlegen (ab Werk nicht
	 * belegt). Sie steht im Untermenü des Moduls unter „Tasten“ und unter Optionen → Steuerung → Heldix-Module.
	 */
	public static void createToggleKeys() {
		toggleKeys = true;
		for (Module module : MODULES) createToggleKey(module);
	}

	private static void createToggleKey(Module module) {
		if (module.toggleKey() != null) return;
		Minecraft minecraft = Minecraft.getInstance();
		// Tasten kennt Minecraft nur, wenn sie vor dem Laden der Optionen angelegt werden; spätere Module bleiben ohne
		if (minecraft != null && minecraft.options != null) return;
		if (keyCategory == null) keyCategory = net.minecraft.client.KeyMapping.Category.register(dev.heldixclient.HeldixClient.id("modules"));
		// eingebaut: übersetzter Name; aus Addons: Addon und Modul (der Name ist zugleich der Schlüssel in options.txt)
		String name = module.source() == null ? "key.heldixclient.module." + module.id()
				: (module.source() + " – " + module.name() + " an/aus").replace(':', ' ');
		module.setToggleKey(dev.heldixclient.loader.api.KeyMappings.register(new net.minecraft.client.KeyMapping(name,
				com.mojang.blaze3d.platform.InputConstants.Type.KEYBOARD, com.mojang.blaze3d.platform.InputConstants.UNKNOWN.getValue(), keyCategory)));
	}

	/** Jeden Tick: gedrückte Tasten zum Ein- und Ausschalten ausführen (Minecraft zählt sie nur im Spiel, nicht in Menüs) */
	public static void handleToggleKeys() {
		for (Module module : MODULES) {
			net.minecraft.client.KeyMapping key = module.toggleKey();
			if (key == null) continue;
			while (key.consumeClick()) {
				module.toggle();
				dev.heldixclient.hud.Notifications.show("module-key", module.name(), module.isEnabled() ? "Eingeschaltet" : "Ausgeschaltet", null);
			}
		}
	}

	public static List<Module> all() {
		return Collections.unmodifiableList(MODULES);
	}

	public static List<HudModule> hud() {
		return Collections.unmodifiableList(HUD_MODULES);
	}

	/** HUD-Module in Zeichenreihenfolge: niedrige Ebene zuerst, bei gleicher Ebene die Reihenfolge der Module */
	public static List<HudModule> hudByLayer() {
		List<HudModule> sorted = new ArrayList<>(HUD_MODULES);
		sorted.sort(java.util.Comparator.comparingInt(HudModule::layer));
		return sorted;
	}

	public static void tick(Minecraft mc) {
		for (Module module : MODULES) module.tick(mc);
	}
}
