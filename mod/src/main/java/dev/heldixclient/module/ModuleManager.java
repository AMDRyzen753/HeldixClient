package dev.heldixclient.module;

import dev.heldixclient.module.impl.CoordinatesModule;
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

	private ModuleManager() {
	}

	public static void init() {
		register(new FpsModule());
		register(new CpsModule());
		register(new PingModule());
		register(new CoordinatesModule());
		register(new KeystrokesModule());
		zoom = register(new ZoomModule());
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
		return module;
	}

	public static List<Module> all() {
		return Collections.unmodifiableList(MODULES);
	}

	public static List<HudModule> hud() {
		return Collections.unmodifiableList(HUD_MODULES);
	}

	public static void tick(Minecraft mc) {
		for (Module module : MODULES) module.tick(mc);
	}
}
