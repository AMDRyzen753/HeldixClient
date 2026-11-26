package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixLogger;

import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * Cover für macOS und Linux: Die Player melden dort nur eine Adresse (https bzw. file://). Das Bild wird einmal im
 * Hintergrund geladen (höchstens 2 MB, nur https oder lokale Dateien), auf 128×128 mit runden Ecken gebracht und als
 * PNG im Addon-Ordner abgelegt (höchstens 30 Stück). Bis es da ist, gibt {@link #cover(String)} null zurück.
 */
final class Covers {
	private static final int SIZE = 128;
	private static final int MAX_BYTES = 2 * 1024 * 1024;
	private static final int KEEP = 30;

	private final Path directory;
	private final HeldixLogger logger;
	private final Consumer<Runnable> async;
	private final Map<String, Path> done = new ConcurrentHashMap<>();
	private final Set<String> loading = ConcurrentHashMap.newKeySet();
	/** fehlgeschlagene Adressen (nicht dauernd neu versuchen) */
	private final Set<String> failed = ConcurrentHashMap.newKeySet();
	private HttpClient http;

	Covers(Path directory, HeldixLogger logger, Consumer<Runnable> async) {
		this.directory = directory;
		this.logger = logger;
		this.async = async;
	}

	/** PNG zur Adresse, falls schon geladen; sonst wird das Laden angestoßen und null zurückgegeben */
	Path cover(String url) {
		if (url == null || url.isBlank()) return null;
		String address = url.strip();
		Path ready = done.get(address);
		if (ready != null) return ready;
		if (failed.contains(address) || !allowed(address)) return null;
		Path file = directory.resolve("url-" + hash(address) + ".png");
		if (Files.isRegularFile(file)) {
			done.put(address, file);
			return file;
		}
		if (loading.add(address)) {
			async.accept(() -> {
				try {
					load(address, file);
					done.put(address, file);
				} catch (Exception | LinkageError e) {
					// LinkageError: Java ohne Bild-Bibliothek (java.desktop) – dann eben ohne Cover
					if (failed.size() > 200) failed.clear();
					failed.add(address);
					logger.warn("Cover nicht ladbar (" + e.getMessage() + ")");
				} finally {
					loading.remove(address);
				}
			});
		}
		return null;
	}

	private static boolean allowed(String address) {
		String lower = address.toLowerCase(java.util.Locale.ROOT);
		return lower.startsWith("https://") || lower.startsWith("file:/");
	}

	private void load(String address, Path target) throws Exception {
		byte[] bytes;
		if (address.toLowerCase(java.util.Locale.ROOT).startsWith("file:")) {
			Path local = Path.of(URI.create(address));
			if (Files.size(local) > MAX_BYTES) throw new IOException("Bild zu groß");
			bytes = Files.readAllBytes(local);
		} else {
			bytes = download(address);
		}
		BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
		if (image == null) throw new IOException("kein Bild");
		BufferedImage rounded = square(image);
		Files.createDirectories(directory);
		Path temp = target.resolveSibling(target.getFileName() + ".tmp");
		ImageIO.write(rounded, "png", temp.toFile());
		Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
		cleanUp();
	}

	private synchronized HttpClient http() {
		// Weiterleitungen nur von https zu https (NORMAL leitet nie auf http um)
		if (http == null) http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NORMAL).build();
		return http;
	}

	private byte[] download(String address) throws Exception {
		HttpRequest request = HttpRequest.newBuilder(URI.create(address)).timeout(Duration.ofSeconds(10))
				.header("User-Agent", "HeldixClient-Spotify-Addon").GET().build();
		HttpResponse<InputStream> response = http().send(request, HttpResponse.BodyHandlers.ofInputStream());
		try (InputStream in = response.body()) {
			if (response.statusCode() != 200) throw new IOException("HTTP " + response.statusCode());
			if (!"https".equalsIgnoreCase(response.uri().getScheme())) throw new IOException("nur https");
			byte[] bytes = in.readNBytes(MAX_BYTES + 1);
			if (bytes.length > MAX_BYTES) throw new IOException("Bild zu groß");
			return bytes;
		}
	}

	/** mittiges Quadrat, 128×128, abgerundete Ecken (wie die Cover unter Windows) */
	private static BufferedImage square(BufferedImage image) {
		int side = Math.min(image.getWidth(), image.getHeight());
		int sx = (image.getWidth() - side) / 2;
		int sy = (image.getHeight() - side) / 2;
		BufferedImage scaled = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = scaled.createGraphics();
		g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
		g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
		g.drawImage(image, 0, 0, SIZE, SIZE, sx, sy, sx + side, sy + side, null);
		g.dispose();
		BufferedImage result = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
		Graphics2D r = result.createGraphics();
		r.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
		r.fill(new RoundRectangle2D.Float(0, 0, SIZE, SIZE, 40, 40));
		r.setComposite(AlphaComposite.SrcIn);
		r.drawImage(scaled, 0, 0, null);
		r.dispose();
		return result;
	}

	private void cleanUp() {
		try (Stream<Path> files = Files.list(directory)) {
			files.filter(p -> p.getFileName().toString().startsWith("url-") && p.getFileName().toString().endsWith(".png"))
					.sorted((a, b) -> Long.compare(modified(b), modified(a)))
					.skip(KEEP)
					.forEach(p -> {
						try {
							Files.deleteIfExists(p);
							done.values().remove(p);
						} catch (IOException ignored) {
						}
					});
		} catch (IOException ignored) {
		}
	}

	private static long modified(Path path) {
		try {
			return Files.getLastModifiedTime(path).toMillis();
		} catch (IOException e) {
			return 0;
		}
	}

	private static String hash(String text) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-1").digest(text.getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(digest, 0, 8);
		} catch (Exception e) {
			return Integer.toHexString(text.hashCode());
		}
	}
}
