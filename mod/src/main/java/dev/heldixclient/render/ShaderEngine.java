package dev.heldixclient.render;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.device.GpuDevice;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.material.FogType;
import org.joml.Vector4f;

import java.util.List;

/**
 * Heldix Shader-Engine: Bloom, Tiefenunschärfe, Nebel und Umgebungsverdeckung (SSAO) als Post-Effekt
 * {@code heldixclient:engine} (assets/heldixclient/post_effect/engine.json). Läuft mit Vulkan und OpenGL.
 *
 * <p>Post-Effekte kennen nur feste Werte aus ihrer JSON. Die Regler, die Sichtweite und die Nebelfarbe
 * kommen deshalb über eine 8×1-Pixel-Textur in den Shader, die hier jedes Bild neu gefüllt wird:
 * <pre>
 * Pixel 0: Bloom, Tiefenunschärfe, Nebel, SSAO (je 0–255)
 * Pixel 1: Sichtweite × 16 (16 Bit in R/G), B = Tiefe 0..1 (Vulkan) statt -1..1, A = unter Wasser/in Lava
 * Pixel 2: Nebelfarbe (RGB)
 * Pixel 3: tan(Sichtfeld/2) × 16384 (16 Bit in R/G), Ende des Sichtweiten-Nebels × 16 (16 Bit in B/A)
 * </pre>
 */
public final class ShaderEngine {
	public static final Identifier EFFECT = Identifier.fromNamespaceAndPath(HeldixClient.MOD_ID, "engine");
	/** Die JSON nennt "heldixclient:engine_params"; Minecraft sucht Texturen dafür unter textures/effect/…png */
	private static final Identifier PARAMS = Identifier.fromNamespaceAndPath(HeldixClient.MOD_ID, "textures/effect/engine_params.png");

	/** Stufen im Menü: Bloom, Tiefenunschärfe, Nebel, SSAO */
	private static final float[][] LEVELS = {
			{0f, 0f, 0f, 0f},
			{0.35f, 0f, 0.25f, 0.45f},
			{0.7f, 0.45f, 0.45f, 0.8f},
	};

	private static DynamicTexture params;

	private ShaderEngine() {
	}

	public static boolean enabled() {
		HeldixConfig.Data c = HeldixConfig.get();
		return c.bloom > 0 || c.depthOfField > 0 || c.fog > 0 || c.ambientOcclusion > 0;
	}

	/** Index der Stufe (Aus, Dezent, Kräftig), die genau den Reglern entspricht; sonst -1. */
	public static int currentLevel() {
		HeldixConfig.Data c = HeldixConfig.get();
		float[] now = {c.bloom, c.depthOfField, c.fog, c.ambientOcclusion};
		for (int i = 0; i < LEVELS.length; i++) {
			boolean same = true;
			for (int j = 0; j < now.length; j++) same &= Math.abs(LEVELS[i][j] - now[j]) < 0.01f;
			if (same) return i;
		}
		return -1;
	}

	public static void applyLevel(int level) {
		float[] values = LEVELS[Math.clamp(level, 0, LEVELS.length - 1)];
		HeldixConfig.Data c = HeldixConfig.get();
		c.bloom = values[0];
		c.depthOfField = values[1];
		c.fog = values[2];
		c.ambientOcclusion = values[3];
		changed();
	}

	/** Nach Änderungen an den Reglern speichern (die Textur wird ohnehin jedes Bild neu gefüllt). */
	public static void changed() {
		HeldixConfig.save();
	}

	/** GameRenderer.update: Engine vor dem Farbstil anfordern und die Parameter für dieses Bild schreiben. */
	static void request(List<Identifier> requested) {
		if (!enabled() || Minecraft.getInstance().level == null || requested.contains(EFFECT)) return;
		try {
			writeParams();
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.warn("Heldix Shader-Engine: Parameter konnten nicht geschrieben werden", e);
			return;
		}
		requested.add(0, EFFECT);
	}

	public static boolean isApplied() {
		var renderer = Minecraft.getInstance().gameRenderer;
		return renderer != null && renderer.getAppliedPostEffects().contains(EFFECT);
	}

	private static void writeParams() {
		Minecraft minecraft = Minecraft.getInstance();
		if (params == null) {
			params = new DynamicTexture(() -> "Heldix Shader-Engine", 8, 1, true);
			// vor dem ersten Laden des Effekts registrieren, sonst sucht Minecraft eine PNG-Datei
			minecraft.getTextureManager().register(PARAMS, params);
		}
		HeldixConfig.Data c = HeldixConfig.get();
		CameraRenderState camera = minecraft.gameRenderer.gameRenderState().levelRenderState.cameraRenderState;
		float far = camera.depthFar > 0 ? camera.depthFar : minecraft.options.renderDistance().get() * 16f * 4f;
		GpuDevice device = RenderSystem.getDevice();
		boolean zeroToOne = device.getDeviceInfo().isZZeroToOne();
		boolean underwater = camera.fogType != null && camera.fogType != FogType.NONE;
		float tanHalfFov = camera.projectionMatrix != null && camera.projectionMatrix.m11() != 0 ? 1f / camera.projectionMatrix.m11() : 0.6f;
		Vector4f fog = camera.fogData != null && camera.fogData.color != null ? camera.fogData.color : new Vector4f(0.7f, 0.8f, 1f, 1f);

		NativeImage pixels = params.getPixels();
		pixels.setPixel(0, 0, argb(unit(c.ambientOcclusion), unit(c.bloom), unit(c.depthOfField), unit(c.fog)));
		int farBits = Math.clamp(Math.round(far * 16f), 0, 65535);
		pixels.setPixel(1, 0, argb(underwater ? 255 : 0, farBits >> 8, farBits & 0xFF, zeroToOne ? 255 : 0));
		pixels.setPixel(2, 0, argb(255, unit(fog.x()), unit(fog.y()), unit(fog.z())));
		int fovBits = Math.clamp(Math.round(tanHalfFov * 16384f), 1, 65535);
		// bis hier blendet Minecraft die Landschaft in den Nebel; dahinter dürfen die Effekte nichts mehr sichtbar machen
		float fogEnd = camera.fogData != null && camera.fogData.renderDistanceEnd > 0 ? camera.fogData.renderDistanceEnd
				: minecraft.options.renderDistance().get() * 16f;
		int fogBits = Math.clamp(Math.round(Math.min(fogEnd, far) * 16f), 16, 65535);
		pixels.setPixel(3, 0, argb(fogBits & 0xFF, fovBits >> 8, fovBits & 0xFF, fogBits >> 8));
		params.upload();
	}

	private static int unit(float value) {
		return Math.clamp(Math.round(value * 255f), 0, 255);
	}

	private static int argb(int a, int r, int g, int b) {
		return (a << 24) | (r << 16) | (g << 8) | b;
	}
}
