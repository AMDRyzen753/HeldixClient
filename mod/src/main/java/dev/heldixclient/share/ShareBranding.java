package dev.heldixclient.share;

import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.social.Social;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.network.protocol.status.ServerStatus;
import net.minecraft.server.MinecraftServer;

import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

/**
 * Werbung für HeldixClient in der Serverliste: Solange eine Welt geteilt ist, zeigt ihr Eintrag bei den Mitspielern
 * (auch bei Spielern ohne HeldixClient) eine eigene Beschreibung – Name der Welt und Gastgeber, darunter „Geteilt mit
 * HeldixClient · heldixclient.com“ – und als Symbol das Bild der Welt mit dem Heldix-Logo in der Ecke (ohne Bild das Logo).
 * Beim Beenden kommen Beschreibung und Symbol der Welt zurück. Das Symbol setzt die Klasse über Reflexion auf das Feld
 * {@code statusIcon} des Servers; klappt das nicht, bleibt das Symbol der Welt und nur die Beschreibung ändert sich.
 */
public final class ShareBranding {
	/** Was vor dem Teilen galt (zum Zurücksetzen) */
	public record Original(String motd, ServerStatus.Favicon icon, boolean iconChanged) {
	}

	private static final int SIZE = 64;
	private static final int BACKGROUND = 0xFF0F1420;
	private static final int ACCENT = 0xFF3B82F6;

	private ShareBranding() {
	}

	/** Beschreibung (zwei Zeilen mit Minecraft-Farbcodes): „Welt · von Gastgeber“ und „Geteilt mit HeldixClient · Webseite“ */
	public static String motd(String world, String host, String site) {
		String name = world == null || world.isBlank() ? "Welt" : world.strip();
		if (name.length() > 22) name = name.substring(0, 21).strip() + "…";
		String line1 = "§f" + name + " §8· §7von §f" + host;
		String line2 = "§3Geteilt mit §bHeldixClient" + (site == null || site.isBlank() ? "" : " §8· §7" + site);
		return line1 + "\n" + line2;
	}

	/** Webseite ohne https:// für die zweite Zeile (null ohne Heldix-Dienst) */
	static String site() {
		String url = Social.websiteUrl();
		return url == null ? null : url.replaceFirst("^https?://", "");
	}

	/** Beim Teilen: Beschreibung und Symbol setzen; liefert, was vorher galt */
	public static Original apply(IntegratedServer server, String host) {
		String motd = server.getMotd();
		String world = server.getWorldData().getLevelName();
		server.setMotd(motd(world, host, site()));
		ServerStatus.Favicon before = null;
		boolean iconChanged = false;
		try {
			Field field = iconField();
			before = (ServerStatus.Favicon) field.get(server);
			byte[] png = favicon(server.getWorldScreenshotFile());
			if (png != null) {
				field.set(server, new ServerStatus.Favicon(png));
				iconChanged = true;
			}
		} catch (Exception | LinkageError e) {
			HeldixClient.LOGGER.debug("Welt teilen: Symbol in der Serverliste bleibt das der Welt ({})", e.toString());
		}
		server.invalidateStatus();
		return new Original(motd, before, iconChanged);
	}

	/** Beim Beenden: Beschreibung und Symbol der Welt zurück */
	public static void restore(IntegratedServer server, Original original) {
		if (original == null) return;
		if (original.motd() != null) server.setMotd(original.motd());
		if (original.iconChanged()) {
			try {
				iconField().set(server, original.icon());
			} catch (Exception | LinkageError e) {
				HeldixClient.LOGGER.debug("Welt teilen: Symbol nicht zurückgesetzt ({})", e.toString());
			}
		}
		server.invalidateStatus();
	}

	private static Field iconField() throws NoSuchFieldException {
		Field field = MinecraftServer.class.getDeclaredField("statusIcon");
		field.setAccessible(true);
		return field;
	}

	/**
	 * Symbol 64×64 als PNG: das Bild der Welt mit dem Heldix-Logo unten rechts auf dunklem Grund; ohne Bild der Welt das
	 * Logo groß auf dunklem Grund. null, wenn das Logo fehlt.
	 */
	public static byte[] favicon(Optional<Path> worldIcon) {
		try (NativeImage logo = logo()) {
			if (logo == null) return null;
			NativeImage world = null;
			if (worldIcon.isPresent() && Files.isRegularFile(worldIcon.get())) {
				try (InputStream in = Files.newInputStream(worldIcon.get())) {
					world = NativeImage.read(in);
				} catch (Exception e) {
					world = null;
				}
			}
			try (NativeImage out = new NativeImage(SIZE, SIZE, true)) {
				if (world != null && world.getWidth() > 0 && world.getHeight() > 0) {
					drawScaled(out, world, 0, 0, SIZE, false);
					// Plakette unten rechts: dunkle Fläche mit blauem Rand, darin das Logo
					roundRect(out, 36, 36, 26, 26, 7, 0xF20F1420);
					roundOutline(out, 36, 36, 26, 26, 7, ACCENT);
					drawScaled(out, logo, 40, 40, 18, true);
				} else {
					roundRect(out, 0, 0, SIZE, SIZE, 10, BACKGROUND);
					drawScaled(out, logo, 12, 12, 40, true);
				}
				if (world != null) world.close();
				Path file = Files.createTempFile("heldix-welt-symbol", ".png");
				try {
					out.writeToFile(file);
					return Files.readAllBytes(file);
				} finally {
					Files.deleteIfExists(file);
				}
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.debug("Welt teilen: Symbol nicht erzeugt ({})", e.toString());
			return null;
		}
	}

	private static NativeImage logo() {
		try (InputStream in = ShareBranding.class.getResourceAsStream("/assets/heldixclient/icon.png")) {
			return in == null ? null : NativeImage.read(in);
		} catch (Exception e) {
			return null;
		}
	}

	/** Bild in ein Quadrat (x, y, size) zeichnen, bilinear; blend: mit Alpha über den Inhalt legen */
	private static void drawScaled(NativeImage out, NativeImage src, int x, int y, int size, boolean blend) {
		int sw = src.getWidth();
		int sh = src.getHeight();
		for (int dy = 0; dy < size; dy++) {
			for (int dx = 0; dx < size; dx++) {
				float sx = (dx + 0.5f) * sw / size - 0.5f;
				float sy = (dy + 0.5f) * sh / size - 0.5f;
				int color = sample(src, sx, sy);
				int px = x + dx;
				int py = y + dy;
				if (px < 0 || py < 0 || px >= out.getWidth() || py >= out.getHeight()) continue;
				out.setPixel(px, py, blend ? over(out.getPixel(px, py), color) : color | 0xFF000000);
			}
		}
	}

	/** bilinear abtasten (ARGB, Ränder festgehalten) */
	private static int sample(NativeImage src, float x, float y) {
		int x0 = Math.clamp((int) Math.floor(x), 0, src.getWidth() - 1);
		int y0 = Math.clamp((int) Math.floor(y), 0, src.getHeight() - 1);
		int x1 = Math.min(x0 + 1, src.getWidth() - 1);
		int y1 = Math.min(y0 + 1, src.getHeight() - 1);
		float fx = Math.clamp(x - x0, 0f, 1f);
		float fy = Math.clamp(y - y0, 0f, 1f);
		int c00 = src.getPixel(x0, y0);
		int c10 = src.getPixel(x1, y0);
		int c01 = src.getPixel(x0, y1);
		int c11 = src.getPixel(x1, y1);
		int result = 0;
		for (int shift = 0; shift <= 24; shift += 8) {
			float top = ((c00 >>> shift) & 0xFF) * (1 - fx) + ((c10 >>> shift) & 0xFF) * fx;
			float bottom = ((c01 >>> shift) & 0xFF) * (1 - fx) + ((c11 >>> shift) & 0xFF) * fx;
			result |= Math.round(top * (1 - fy) + bottom * fy) << shift;
		}
		return result;
	}

	/** Farbe (ARGB) mit Alpha über eine andere legen */
	private static int over(int below, int above) {
		float a = (above >>> 24) / 255f;
		if (a <= 0f) return below;
		float b = (below >>> 24) / 255f;
		float outA = a + b * (1 - a);
		int result = Math.round(outA * 255) << 24;
		for (int shift = 0; shift <= 16; shift += 8) {
			float ca = ((above >>> shift) & 0xFF) * a;
			float cb = ((below >>> shift) & 0xFF) * b * (1 - a);
			result |= Math.clamp(Math.round(outA > 0 ? (ca + cb) / outA : 0), 0, 255) << shift;
		}
		return result;
	}

	/** gefülltes Rechteck mit runden Ecken (weiche Kante), über den Inhalt gelegt */
	private static void roundRect(NativeImage out, int x, int y, int w, int h, int r, int color) {
		for (int py = y; py < y + h; py++) {
			for (int px = x; px < x + w; px++) {
				float coverage = coverage(px + 0.5f - x, py + 0.5f - y, w, h, r);
				if (coverage <= 0) continue;
				int alpha = Math.round((color >>> 24) * coverage);
				out.setPixel(px, py, over(out.getPixel(px, py), (alpha << 24) | (color & 0xFFFFFF)));
			}
		}
	}

	/** Rand (1 Pixel) eines Rechtecks mit runden Ecken */
	private static void roundOutline(NativeImage out, int x, int y, int w, int h, int r, int color) {
		for (int py = y; py < y + h; py++) {
			for (int px = x; px < x + w; px++) {
				float outer = coverage(px + 0.5f - x, py + 0.5f - y, w, h, r);
				float inner = coverage(px + 0.5f - x - 1, py + 0.5f - y - 1, w - 2, h - 2, Math.max(0, r - 1));
				float ring = Math.clamp(outer - inner, 0f, 1f);
				if (ring <= 0) continue;
				int alpha = Math.round((color >>> 24) * ring);
				out.setPixel(px, py, over(out.getPixel(px, py), (alpha << 24) | (color & 0xFFFFFF)));
			}
		}
	}

	/** Anteil eines Pixels (Mitte px, py relativ zur Ecke) innerhalb des abgerundeten Rechtecks */
	private static float coverage(float px, float py, int w, int h, int r) {
		if (px < 0 || py < 0 || px > w || py > h) return 0;
		float cx = Math.clamp(px, r, w - r);
		float cy = Math.clamp(py, r, h - r);
		float dist = (float) Math.hypot(px - cx, py - cy);
		return Math.clamp(r + 0.5f - dist, 0f, 1f);
	}
}
