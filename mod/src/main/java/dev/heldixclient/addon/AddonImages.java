package dev.heldixclient.addon;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HudImage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Selbst gefüllte Bilder der Addons (API 8, {@code createImage}): je Bild eine {@link DynamicTexture}, die beim nächsten
 * Zeichnen hochgeladen wird, wenn sich Pixel geändert haben. Beim Abschalten des Addons werden alle freigegeben.
 */
public final class AddonImages {
	public static final int MAX_SIZE = 512;
	/** so viele Bilder höchstens je Addon gleichzeitig */
	private static final int MAX_PER_ADDON = 16;

	private static final Map<String, List<Image>> BY_ADDON = new HashMap<>();
	private static int counter;

	private AddonImages() {
	}

	static HudImage create(LoadedAddon addon, int width, int height) {
		Minecraft mc = Minecraft.getInstance();
		if (!mc.isSameThread()) throw new IllegalStateException("createImage() nur im Haupt-Thread aufrufen");
		if (width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) {
			throw new IllegalArgumentException("Bildgröße: 1 bis " + MAX_SIZE + " Pixel je Seite");
		}
		List<Image> list = BY_ADDON.computeIfAbsent(addon.id(), key -> new ArrayList<>());
		list.removeIf(image -> image.closed);
		if (list.size() >= MAX_PER_ADDON) throw new IllegalStateException("Höchstens " + MAX_PER_ADDON + " Bilder je Addon – nicht mehr gebrauchte mit close() freigeben");
		String clean = addon.id().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.-]", "_");
		Identifier id = HeldixClient.id("addon_image/" + clean + "_" + (++counter));
		DynamicTexture texture = new DynamicTexture(id::toString, width, height, true);
		mc.getTextureManager().register(id, texture);
		Image image = new Image(id, texture, width, height);
		list.add(image);
		return image;
	}

	/** Addon abgeschaltet: alle seine Bilder freigeben */
	static void release(LoadedAddon addon) {
		List<Image> list = BY_ADDON.remove(addon.id());
		if (list == null) return;
		Minecraft mc = Minecraft.getInstance();
		Runnable close = () -> list.forEach(Image::close);
		if (mc.isSameThread()) close.run();
		else mc.execute(close);
	}

	/** Für den Autotest: offene Bilder eines Addons */
	public static int open(String addonId) {
		List<Image> list = BY_ADDON.get(addonId);
		return list == null ? 0 : (int) list.stream().filter(image -> !image.closed).count();
	}

	public static final class Image implements HudImage {
		private final Identifier id;
		private final DynamicTexture texture;
		private final int width;
		private final int height;
		private boolean dirty = true;
		private boolean closed;
		/** wie oft hochgeladen (für den Autotest) */
		private int uploads;

		private Image(Identifier id, DynamicTexture texture, int width, int height) {
			this.id = id;
			this.texture = texture;
			this.width = width;
			this.height = height;
		}

		@Override
		public int width() {
			return width;
		}

		@Override
		public int height() {
			return height;
		}

		@Override
		public void setPixels(int[] argb) {
			Objects.requireNonNull(argb, "argb");
			if (argb.length < width * height) throw new IllegalArgumentException("argb braucht " + width * height + " Einträge");
			if (closed) return;
			var pixels = texture.getPixels();
			if (pixels == null) return;
			for (int y = 0, i = 0; y < height; y++) {
				for (int x = 0; x < width; x++, i++) pixels.setPixel(x, y, argb[i]);
			}
			dirty = true;
		}

		@Override
		public void setPixel(int x, int y, int argb) {
			if (closed || x < 0 || y < 0 || x >= width || y >= height) return;
			var pixels = texture.getPixels();
			if (pixels == null) return;
			pixels.setPixel(x, y, argb);
			dirty = true;
		}

		@Override
		public void close() {
			if (closed) return;
			closed = true;
			Minecraft.getInstance().getTextureManager().release(id);
		}

		/** vor dem Zeichnen: geänderte Pixel hochladen; null = freigegeben */
		public Identifier prepare() {
			if (closed) return null;
			if (dirty) {
				texture.upload();
				dirty = false;
				uploads++;
			}
			return id;
		}

		public int uploads() {
			return uploads;
		}
	}
}
