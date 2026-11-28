package dev.heldixclient.share;

import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;

import java.io.InputStream;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Symbole der Welten in Entdecken ({@code GET /v1/public/discover/<code>/icon.png}, 64×64 mit Heldix-Plakette): einmal
 * laden, als Textur ablegen, danach aus dem Speicher. Höchstens 64 KB je Bild, höchstens 200 Symbole; fehlt eines, zeichnet
 * die Liste das Welt-Symbol.
 */
public final class DiscoverIcons {
	private static final int MAX_BYTES = 64 * 1024;
	private static final int MAX_ICONS = 200;
	/** Code → Textur; {@link #MISSING} = gibt es nicht bzw. nicht ladbar, {@link #LOADING} = wird geladen */
	private static final Map<String, Identifier> ICONS = new ConcurrentHashMap<>();
	private static final Identifier LOADING = HeldixClient.id("discover/laedt");
	private static final Identifier MISSING = HeldixClient.id("discover/fehlt");

	private DiscoverIcons() {
	}

	/** Textur des Symbols oder null (dann das Welt-Symbol zeichnen); lädt beim ersten Mal im Hintergrund */
	public static Identifier icon(HostingService.DiscoverEntry entry) {
		if (entry == null || entry.icon() == null) return null;
		Identifier known = ICONS.get(entry.code());
		if (known != null) return known == LOADING || known == MISSING ? null : known;
		if (ICONS.size() >= MAX_ICONS) return null;
		ICONS.put(entry.code(), LOADING);
		String code = entry.code();
		Social.transfer("GET", entry.icon(), null, Duration.ofSeconds(15), false).whenComplete((response, error) -> {
			byte[] bytes = null;
			if (error == null && response.statusCode() == 200) {
				try (InputStream in = response.body()) {
					bytes = in.readNBytes(MAX_BYTES + 1);
				} catch (Exception e) {
					bytes = null;
				}
			} else if (response != null) {
				try {
					response.body().close();
				} catch (Exception e) {
					// egal
				}
			}
			byte[] png = bytes != null && bytes.length <= MAX_BYTES ? bytes : null;
			Minecraft.getInstance().execute(() -> register(code, png));
		});
		return null;
	}

	private static void register(String code, byte[] png) {
		if (png == null) {
			ICONS.put(code, MISSING);
			return;
		}
		try {
			NativeImage image = NativeImage.read(png);
			if (image.getWidth() > 256 || image.getHeight() > 256) {
				image.close();
				ICONS.put(code, MISSING);
				return;
			}
			Identifier id = HeldixClient.id("discover/" + code);
			Ui.registerLinear(id, image);
			ICONS.put(code, id);
		} catch (Exception e) {
			ICONS.put(code, MISSING);
		}
	}
}
