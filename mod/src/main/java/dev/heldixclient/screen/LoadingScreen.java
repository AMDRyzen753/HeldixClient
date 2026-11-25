package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.renderpearl.api.textures.FilterMode;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.LoadingOverlay;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.client.renderer.texture.TextureManager;
import net.minecraft.resources.Identifier;
import net.minecraft.util.ARGB;

import java.io.InputStream;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;
import java.util.function.IntSupplier;

/**
 * Ladebildschirm im Heldix-Design (beim Start und beim Neuladen der Ressourcen) statt des Mojang-Logos.
 * Beim Start ist noch keine Schrift geladen; Logo und Leuchten sind deshalb Bilder aus der Mod-JAR,
 * die schon vor den Ressourcenpaketen registriert werden. Abschaltbar im Heldix-Menü (Einstellungen → Ladebildschirm).
 */
public final class LoadingScreen {
	private static final Identifier LOGO = HeldixClient.id("loading/logo");
	private static final Identifier GLOW = HeldixClient.id("loading/glow");
	private static final int LOGO_W = 1024;
	private static final int LOGO_H = 263;
	private static final int GLOW_SIZE = 256;
	private static final int BACKGROUND = 0xFF050B18;
	private static final int TOP = 0x0B1A36;
	private static final int BOTTOM = 0x02060F;
	private static final VarHandle PROGRESS = progressHandle();

	private static boolean texturesReady;
	/** Schriften geladen (erst nach dem ersten Start): dann zeigt der Ladebildschirm einen Tipp */
	public static volatile boolean fontsReady;
	private static float shownProgress;

	private LoadingScreen() {
	}

	private static VarHandle progressHandle() {
		try {
			return MethodHandles.privateLookupIn(LoadingOverlay.class, MethodHandles.lookup())
					.findVarHandle(LoadingOverlay.class, "currentProgress", float.class);
		} catch (ReflectiveOperationException e) {
			HeldixClient.LOGGER.warn("Ladefortschritt nicht lesbar, Ladebalken bleibt leer", e);
			return null;
		}
	}

	public static boolean active() {
		return texturesReady && HeldixConfig.get().customLoadingScreen;
	}

	/** LoadingOverlay.registerTextures: eigene Bilder direkt aus der JAR laden (Ressourcen gibt es noch nicht). */
	public static void registerTextures(TextureManager textures) {
		try {
			textures.register(LOGO, smoothTexture("logo", "/assets/heldixclient/textures/gui/loading_logo.png"));
			textures.register(GLOW, smoothTexture("glow", "/assets/heldixclient/textures/gui/loading_glow.png"));
			texturesReady = true;
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Bilder für den Ladebildschirm fehlen, nutze den von Mojang", e);
		}
	}

	private static DynamicTexture smoothTexture(String name, String path) throws Exception {
		try (InputStream in = LoadingScreen.class.getResourceAsStream(path)) {
			if (in == null) throw new IllegalStateException(path + " fehlt");
			NativeImage image = NativeImage.read(in);
			return new DynamicTexture(() -> "HeldixClient " + name, image) {
				{
					// weich skalieren statt pixelig
					sampler = RenderSystem.getSamplerCache().getClampToEdge(FilterMode.LINEAR);
				}
			};
		}
	}

	/** Hintergrundfarbe (füllt den Bildschirm und dient als Löschfarbe). */
	public static int background(IntSupplier vanilla) {
		return active() ? BACKGROUND : vanilla.getAsInt();
	}

	private static int logoWidth(GuiGraphicsExtractor g) {
		return Math.round(Math.min(g.guiWidth() * 0.6f, Math.min(420, g.guiHeight() * 1.5f)));
	}

	private static int logoY(GuiGraphicsExtractor g, int logoH) {
		return Math.round(g.guiHeight() * 0.45f) - logoH / 2;
	}

	/**
	 * Ersetzt die erste Hälfte des Mojang-Logos: Verlauf, Leuchten und Heldix-Logo.
	 * {@code color} enthält die Deckkraft der Ein-/Ausblendung.
	 */
	public static void logo(GuiGraphicsExtractor g, int color) {
		int w = g.guiWidth();
		int h = g.guiHeight();
		int alpha = ARGB.alpha(color);
		g.fillGradient(0, 0, w, h, (alpha << 24) | TOP, (alpha << 24) | BOTTOM);

		int logoW = logoWidth(g);
		int logoH = logoW * LOGO_H / LOGO_W;
		int logoX = (w - logoW) / 2;
		int logoY = logoY(g, logoH);

		// langsames "Atmen" des Leuchtens
		float pulse = 0.85f + 0.15f * (float) Math.sin(System.currentTimeMillis() / 700.0);
		int glowSize = Math.round(logoW * 1.5f);
		int glowAlpha = Math.round(alpha * pulse);
		g.blit(RenderPipelines.GUI_TEXTURED, GLOW, (w - glowSize) / 2, logoY + logoH / 2 - glowSize / 2, 0, 0, glowSize, glowSize,
				GLOW_SIZE, GLOW_SIZE, GLOW_SIZE, GLOW_SIZE, ARGB.color(glowAlpha, 255, 255, 255));
		g.blit(RenderPipelines.GUI_TEXTURED, LOGO, logoX, logoY, 0, 0, logoW, logoH, LOGO_W, LOGO_H, LOGO_W, LOGO_H, color);
	}

	/** Ladebalken unter dem Logo, mit Glanz, der über den gefüllten Teil wandert. */
	public static void progress(LoadingOverlay overlay, GuiGraphicsExtractor g, float opacity) {
		float target = PROGRESS == null ? 0 : (float) PROGRESS.get(overlay);
		shownProgress += (target - shownProgress) * 0.2f;
		if (target < shownProgress) shownProgress = target; // neues Laden beginnt wieder bei 0

		int logoW = logoWidth(g);
		int logoH = logoW * LOGO_H / LOGO_W;
		int barW = Math.round(logoW * 0.62f);
		int barH = 4;
		int x = (g.guiWidth() - barW) / 2;
		int y = logoY(g, logoH) + logoH + Math.max(8, Math.round(g.guiHeight() * 0.05f));
		int alpha = Math.round(Math.clamp(opacity, 0f, 1f) * 255);
		if (alpha <= 4) return;

		Draw.rounded(g, x, y, barW, barH, Draw.withAlpha(0x33FFFFFF, alpha / 255f));
		int fill = Math.round(barW * Math.clamp(shownProgress, 0f, 1f));
		if (fill >= 2) {
			Draw.rounded(g, x, y, fill, barH, Draw.withAlpha(Theme.ACCENT, alpha / 255f));
			g.fill(x + 1, y, x + fill - 1, y + 1, Draw.withAlpha(0x80FFFFFF, alpha / 255f));
			int shine = Math.max(6, barW / 8);
			int shineX = x + (int) ((System.currentTimeMillis() / 4) % (fill + shine)) - shine;
			int from = Math.max(x, shineX);
			int to = Math.min(x + fill, shineX + shine);
			if (to > from) g.fill(from, y, to, y + barH, Draw.withAlpha(0x66E0F2FE, alpha / 255f));
		}
		// beim Neuladen (Schriften da): Tipp unter dem Balken
		if (fontsReady) {
			dev.heldixclient.ui.Tips.Tip tip = dev.heldixclient.ui.Tips.rotating(6);
			String text = dev.heldixclient.ui.Ui.ellipsize(tip.text(), Math.max(120, g.guiWidth() - 40), dev.heldixclient.ui.Ui.Font.SMALL);
			int tw = dev.heldixclient.ui.Ui.width(text, dev.heldixclient.ui.Ui.Font.SMALL) + 14;
			int tx = (g.guiWidth() - tw) / 2;
			int ty = y + barH + 12;
			float a = alpha / 255f;
			dev.heldixclient.ui.Ui.icon(g, tip.icon(), tx, ty - 1, 9, Draw.withAlpha(Theme.ACCENT_LIGHT, a));
			dev.heldixclient.ui.Ui.text(g, text, tx + 14, ty, Draw.withAlpha(0xFFB9CBE6, a), dev.heldixclient.ui.Ui.Font.SMALL);
		}
	}
}
