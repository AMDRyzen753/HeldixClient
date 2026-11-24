package dev.heldixclient.render;

import dev.heldixclient.config.HeldixConfig;
import net.minecraft.client.CloudStatus;
import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;
import net.minecraft.server.level.ParticleStatus;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Leistungsfunktionen von HeldixClient, die ohne eigenen Renderer möglich sind:
 * <ul>
 *   <li>Hintergrund-FPS: Ist das Fenster nicht im Vordergrund, zeichnet Minecraft höchstens
 *       {@code backgroundFpsLimit} Bilder pro Sekunde (spart Grafikkarte, CPU und Strom).</li>
 *   <li>FPS-Boost: stellt teure Grafikoptionen auf schnelle Werte und merkt sich die alten,
 *       damit Ausschalten alles wiederherstellt.</li>
 * </ul>
 * Dazu kommen außerhalb der Mod: Vulkan als Grafik-API und abgestimmte JVM-Einstellungen (Launcher).
 */
public final class Performance {
	/** Eine Grafikoption, ihr schneller Wert und wie sie als Text gespeichert wird. */
	private record Tweak<T>(String name, Function<Options, OptionInstance<T>> option, T fast, Function<String, T> parse) {
		String read(Options options) {
			Object value = option.apply(options).get();
			return value instanceof Enum<?> constant ? constant.name() : String.valueOf(value);
		}

		void apply(Options options) {
			option.apply(options).set(fast);
		}

		void restore(Options options, String value) {
			try {
				option.apply(options).set(parse.apply(value));
			} catch (RuntimeException ignored) {
				// Wert aus einer anderen Minecraft-Version: dann bleibt der aktuelle
			}
		}
	}

	private static final List<Tweak<?>> TWEAKS = List.of(
			new Tweak<>("improvedTransparency", Options::improvedTransparency, false, Boolean::valueOf),
			new Tweak<>("cloudStatus", Options::cloudStatus, CloudStatus.FAST, CloudStatus::valueOf),
			new Tweak<>("entityShadows", Options::entityShadows, false, Boolean::valueOf),
			new Tweak<>("particles", Options::particles, ParticleStatus.DECREASED, ParticleStatus::valueOf),
			new Tweak<>("biomeBlendRadius", Options::biomeBlendRadius, 1, Integer::valueOf),
			new Tweak<>("weatherRadius", Options::weatherRadius, 5, Integer::valueOf),
			new Tweak<>("chunkSectionFadeInTime", Options::chunkSectionFadeInTime, 0.0, Double::valueOf),
			new Tweak<>("enableVsync", Options::enableVsync, false, Boolean::valueOf));

	private Performance() {
	}

	// --- Hintergrund-FPS --------------------------------------------------------------------

	/** FramerateLimitTracker.getFramerateLimit: im Hintergrund weniger Bilder zeichnen. */
	public static int framerateLimit(int limit) {
		HeldixConfig.Data config = HeldixConfig.get();
		if (!config.backgroundFps) return limit;
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft == null || minecraft.getWindow() == null || minecraft.isWindowActive()) return limit;
		return Math.min(limit, Math.max(5, config.backgroundFpsLimit));
	}

	// --- FPS-Boost --------------------------------------------------------------------------

	public static boolean boostEnabled() {
		return HeldixConfig.get().fpsBoost != null;
	}

	public static void setBoost(boolean enabled) {
		Options options = Minecraft.getInstance().options;
		HeldixConfig.Data config = HeldixConfig.get();
		if (enabled && config.fpsBoost == null) {
			Map<String, String> previous = new LinkedHashMap<>();
			for (Tweak<?> tweak : TWEAKS) {
				previous.put(tweak.name(), tweak.read(options));
				tweak.apply(options);
			}
			config.fpsBoost = previous;
		} else if (!enabled && config.fpsBoost != null) {
			for (Tweak<?> tweak : TWEAKS) {
				String value = config.fpsBoost.get(tweak.name());
				if (value != null) tweak.restore(options, value);
			}
			config.fpsBoost = null;
		}
		options.save();
		HeldixConfig.save();
	}
}
