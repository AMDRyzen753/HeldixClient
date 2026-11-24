package dev.heldixclient.render;

import dev.heldixclient.config.HeldixConfig;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.resources.Identifier;

import java.util.List;

/**
 * Shader-Unterstützung von HeldixClient: Der gewählte Stil wird jedes Bild als Post-Effekt angefordert
 * (wie die Effekte beim Zuschauen als Creeper oder Spinne). Minecraft lädt, übersetzt und zeichnet ihn
 * selbst – mit Vulkan genauso wie mit OpenGL. HUD und Menüs bleiben unverändert, weil Post-Effekte
 * vor der Oberfläche angewendet werden.
 *
 * <p>Shaderpacks für OptiFine oder Iris werden nicht unterstützt; die brauchen einen eigenen Renderer.
 */
public final class Shaders {
	private Shaders() {
	}

	public static ShaderPreset current() {
		return ShaderPreset.byKey(HeldixConfig.get().shader);
	}

	public static void select(ShaderPreset preset) {
		HeldixConfig.get().shader = preset.key();
		HeldixConfig.save();
	}

	/** Nächster Stil (für Tastenkürzel und Autotest). */
	public static ShaderPreset cycle() {
		ShaderPreset[] all = ShaderPreset.values();
		ShaderPreset next = all[(current().ordinal() + 1) % all.length];
		select(next);
		return next;
	}

	/** GameRenderer.update: hängt den Stil an die angeforderten Post-Effekte dieses Bildes. */
	public static void request(List<Identifier> requested) {
		// Iris-Shaderpack aktiv (Fabric-Instanz): Heldix-Shader pausieren
		if (IrisCompat.shaderPackActive()) return;
		Identifier effect = current().effect();
		if (effect != null && Minecraft.getInstance().level != null && !requested.contains(effect)) {
			// zuerst: Effekte von Minecraft (z. B. Zuschauen als Creeper) liegen danach darüber
			requested.add(0, effect);
		}
		// Shader-Engine davor: Licht- und Tiefeneffekte zuerst, danach der Farbstil
		ShaderEngine.request(requested);
	}

	/** true, wenn der gewählte Stil im letzten Bild tatsächlich gezeichnet wurde. */
	public static boolean isApplied() {
		Identifier effect = current().effect();
		GameRenderer renderer = Minecraft.getInstance().gameRenderer;
		if (effect == null || renderer == null) return false;
		return renderer.getAppliedPostEffects().contains(effect);
	}

	/** Kurzer Zustand für F3: "Kino", "Kino (nicht aktiv)" oder "Aus". */
	public static String describe() {
		ShaderPreset preset = current();
		if (IrisCompat.shaderPackActive()) return "pausiert (Iris-Shaderpack aktiv)";
		if (preset == ShaderPreset.OFF) return "Aus";
		if (Minecraft.getInstance().level == null) return preset.label();
		return isApplied() ? preset.label() : preset.label() + " (nicht aktiv)";
	}
}
