package dev.heldixclient.render;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.device.DeviceInfo;
import com.mojang.renderpearl.api.device.GpuDevice;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.ui.Theme;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.debug.DebugScreenDisplayer;
import net.minecraft.client.gui.components.debug.DebugScreenEntries;
import net.minecraft.client.gui.components.debug.DebugScreenEntry;
import net.minecraft.client.gui.components.debug.DebugScreenEntryStatus;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.LevelChunk;

import java.lang.reflect.Method;
import java.util.List;

/**
 * F3-Menü: eigene Zeilen von HeldixClient (Version, Grafik-API, Shader, Leistung) und – mit dem
 * Heldix-Design (abschaltbar) – dunkle Glas-Hintergründe mit Akzentlinie statt der grauen Vanilla-Kästen.
 * Die Zeilen lassen sich wie alle anderen in den F3-Optionen (F3 + F6) ein- und ausschalten.
 */
public final class DebugOverlay {
	public static final Identifier ENTRY = Identifier.fromNamespaceAndPath(HeldixClient.MOD_ID, "client");
	private static final int LINE_BACKGROUND = 0xB0071226;
	private static boolean registered;
	private static String backend;

	private DebugOverlay() {
	}

	/** Meldet den F3-Eintrag bei Minecraft an (vor dem Laden der F3-Einstellungen aufrufen). */
	public static void register() {
		try {
			Method register = DebugScreenEntries.class.getDeclaredMethod("register", Identifier.class, DebugScreenEntry.class);
			register.setAccessible(true);
			register.invoke(null, ENTRY, new Entry());
			registered = true;
		} catch (ReflectiveOperationException | RuntimeException e) {
			HeldixClient.LOGGER.warn("F3-Eintrag von HeldixClient konnte nicht angemeldet werden", e);
		}
	}

	public static boolean isRegistered() {
		return registered && DebugScreenEntries.getEntry(ENTRY) != null;
	}

	/** Beim ersten Start einmal einschalten; danach entscheidet der Spieler in den F3-Optionen. */
	public static void seed(Minecraft minecraft) {
		HeldixConfig.Data config = HeldixConfig.get();
		if (config.debugEntrySeeded || !registered || minecraft.debugEntries == null) return;
		minecraft.debugEntries.setStatus(ENTRY, DebugScreenEntryStatus.IN_OVERLAY);
		config.debugEntrySeeded = true;
		HeldixConfig.save();
	}

	/** Name der Grafik-API, die Minecraft wirklich benutzt ("Vulkan" oder "OpenGL"). */
	public static String backend() {
		if (backend == null) {
			GpuDevice device = RenderSystem.tryGetDevice();
			if (device == null) return "?";
			DeviceInfo info = device.getDeviceInfo();
			backend = info.backendName();
		}
		return backend;
	}

	/** DebugScreenOverlay.extractLines: Hintergrund einer F3-Zeile. */
	public static void line(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int color, boolean left) {
		if (!HeldixConfig.get().customDebugScreen) {
			g.fill(x1, y1, x2, y2, color);
			return;
		}
		g.fill(x1, y1, x2, y2, LINE_BACKGROUND);
		// Akzentlinie am Bildschirmrand (Vanilla lässt dort 1 Pixel frei), 2 Pixel breit
		if (left) g.fill(x1 - 1, y1, x1 + 1, y2, Theme.ACCENT);
		else g.fill(x2 - 1, y1, x2 + 1, y2, Theme.ACCENT);
	}

	private static final class Entry implements DebugScreenEntry {
		@Override
		public void display(DebugScreenDisplayer displayer, Level level, LevelChunk clientChunk, LevelChunk serverChunk) {
			int addons = 0;
			for (LoadedAddon addon : AddonManager.addons()) {
				if (addon.isActive()) addons++;
			}
			HeldixConfig.Data config = HeldixConfig.get();
			String gray = ChatFormatting.GRAY.toString();
			String reset = ChatFormatting.RESET.toString();
			displayer.addToGroup(ENTRY, List.of(
					ChatFormatting.AQUA + "" + ChatFormatting.BOLD + "HeldixClient" + reset + " " + HeldixClient.version
							+ gray + "  ·  Heldix Loader " + HeldixLoader.version(),
					"Grafik-API: " + ChatFormatting.AQUA + backend() + reset + gray + "  ·  " + reset + "Shader: " + Shaders.describe() + (ShaderEngine.enabled() ? " + Engine" + (ShaderEngine.isApplied() ? "" : " (nicht aktiv)") : ""),
					"FPS-Boost: " + (Performance.boostEnabled() ? "an" : "aus")
							+ gray + "  ·  " + reset + "Hintergrund: " + (config.backgroundFps ? config.backgroundFpsLimit + " FPS" : "unbegrenzt")
							+ gray + "  ·  " + reset + HeldixLoader.mods().size() + " Mods, " + addons + " Addons"));
		}
	}
}
