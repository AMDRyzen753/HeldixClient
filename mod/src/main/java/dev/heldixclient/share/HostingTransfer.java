package dev.heldixclient.share;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.share.HostingService.Hosted;
import dev.heldixclient.share.HostingService.Overview;
import dev.heldixclient.share.HostingService.State;
import dev.heldixclient.share.HostingService.Upload;
import dev.heldixclient.social.Social;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.DirectoryLock;
import net.minecraft.util.FileUtil;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.level.storage.LevelStorageSource;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;

/**
 * Übertragungen für dauerhafte Welten (ab Heldix-Dienst 1.13.0), immer nur eine auf einmal, im Hintergrund:
 * <ul>
 *   <li><b>Dauerhaft online stellen</b>: Welt beim Dienst (heldix-welt.json, sonst neu anlegen), Sicherung als ZIP
 *   ({@link WorldBackups}, bei offener Welt vorher speichern wie bei „Welt teilen“), dauerhafte Welt anlegen, ZIP in
 *   Teilen hochladen ({@code PUT …/upload/<n>}, wiederholbar), Abschluss mit SHA-256. Die Einzelspielerwelt bleibt
 *   unverändert. Abbrechen verwirft den Upload (und die in diesem Lauf angelegte dauerhafte Welt).</li>
 *   <li><b>Herunterladen</b>: ZIP der Welt vom Heldix-Server, sicher entpacken (keine absoluten Pfade, kein „..“,
 *   Größen- und Dateizahl-Grenze) und als neue Einzelspielerwelt „<Name> (vom Heldix-Server)“ anlegen.</li>
 * </ul>
 * Den Fortschritt liest die Oberfläche ({@link dev.heldixclient.screen.HostWorldScreen}) aus {@link #current()}.
 */
public final class HostingTransfer {
	public enum Kind {
		UPLOAD,
		DOWNLOAD
	}

	public enum Phase {
		PREPARING("Wird vorbereitet …"),
		BACKUP("Sicherung wird angelegt …"),
		CREATING("Wird beim Heldix-Server angelegt …"),
		UPLOADING("Lädt hoch …"),
		FINISHING("Wird geprüft und eingerichtet …"),
		DOWNLOADING("Lädt herunter …"),
		IMPORTING("Wird als neue Welt angelegt …"),
		DONE("Fertig"),
		FAILED("Fehlgeschlagen"),
		CANCELLED("Abgebrochen");

		public final String label;

		Phase(String label) {
			this.label = label;
		}
	}

	/** Zusatz an den Namen der heruntergeladenen Welt */
	public static final String IMPORT_SUFFIX = " (vom Heldix-Server)";
	/** Grenzen beim Entpacken eines Downloads */
	private static final long MAX_IMPORT_BYTES = 16L << 30;
	private static final int MAX_IMPORT_ENTRIES = 400_000;
	private static final Duration CHUNK_TIMEOUT = Duration.ofMinutes(3);
	/** der Abschluss prüft das ZIP und richtet den Server ein (beim ersten Mal mit Laden des Server-Jars) */
	private static final Duration FINISH_TIMEOUT = Duration.ofMinutes(15);
	private static final Duration DOWNLOAD_TIMEOUT = Duration.ofMinutes(30);

	private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Dauerhafte-Welt");
		thread.setDaemon(true);
		return thread;
	});

	/** Eine Übertragung mit Fortschritt (alle Felder von jedem Thread lesbar) */
	public static final class Job {
		public final Kind kind;
		public final String name;
		volatile String worldId;
		volatile Phase phase = Phase.PREPARING;
		volatile long done;
		volatile long total;
		volatile String error;
		volatile Hosted result;
		volatile Path imported;
		volatile String importedName;
		volatile boolean cancelled;
		volatile CompletableFuture<?> request;
		/** in diesem Lauf angelegt: beim Abbrechen bzw. Fehler wieder entfernen */
		volatile boolean created;

		Job(Kind kind, String name, String worldId) {
			this.kind = kind;
			this.name = name;
			this.worldId = worldId;
		}

		public Phase phase() {
			return phase;
		}

		public String worldId() {
			return worldId;
		}

		public String error() {
			return error;
		}

		public Hosted result() {
			return result;
		}

		public Path imported() {
			return imported;
		}

		public String importedName() {
			return importedName;
		}

		/** 0–1 (Upload/Download), sonst -1 */
		public double progress() {
			return total > 0 ? Math.clamp((double) done / total, 0, 1) : -1;
		}

		public long doneBytes() {
			return done;
		}

		public long totalBytes() {
			return total;
		}

		public boolean running() {
			return phase != Phase.DONE && phase != Phase.FAILED && phase != Phase.CANCELLED;
		}

		/** Text für die Anzeige: Schritt und – beim Übertragen – Prozent und MB */
		public String line() {
			if ((phase == Phase.UPLOADING || phase == Phase.DOWNLOADING) && total > 0) {
				return phase.label + "  " + Math.round(progress() * 100) + " %  ·  " + mb(done) + " von " + mb(total);
			}
			if (phase == Phase.DOWNLOADING && done > 0) return phase.label + "  " + mb(done);
			return phase.label;
		}

		/** Abbrechen (wirkt beim nächsten Teil; eine laufende Anfrage wird abgebrochen) */
		public void cancel() {
			if (!running()) return;
			cancelled = true;
			CompletableFuture<?> pending = request;
			if (pending != null) pending.cancel(true);
		}
	}

	private static volatile Job current;

	private HostingTransfer() {
	}

	/** laufende oder zuletzt beendete Übertragung, sonst null */
	public static Job current() {
		return current;
	}

	public static boolean busy() {
		Job job = current;
		return job != null && job.running();
	}

	/** Ergebnis abgeholt: die nächste Übertragung beginnt mit leerer Anzeige */
	public static void forget() {
		Job job = current;
		if (job != null && !job.running()) current = null;
	}

	static String mb(long bytes) {
		double mb = bytes / (1024.0 * 1024.0);
		return mb < 0.1 ? "< 0,1 MB" : String.format(Locale.GERMANY, mb < 100 ? "%.1f MB" : "%.0f MB", mb);
	}

	// ======================================================================================
	// Dauerhaft online stellen
	// ======================================================================================

	/**
	 * Welt {@code world} (Ordner in saves/) dauerhaft online stellen. Läuft schon eine Übertragung, passiert nichts (null).
	 * Ist die Welt gerade in diesem Spiel offen, wird sie vor der Sicherung gespeichert (Haupt-Thread aufrufen).
	 */
	public static Job upload(Minecraft mc, Path world, String levelName) {
		if (busy()) return null;
		Path folder = world.toAbsolutePath().normalize();
		IntegratedServer server = mc.getSingleplayerServer();
		IntegratedServer open = server != null && server.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize().equals(folder) ? server : null;
		Job job = new Job(Kind.UPLOAD, WorldService.name(levelName), WorldBackups.readId(folder));
		current = job;
		Path gameDirectory = mc.gameDirectory.toPath();
		String version = SharedConstants.getCurrentVersion().name();
		WORKER.execute(() -> {
			try {
				runUpload(job, folder, open, gameDirectory, version);
				job.phase = Phase.DONE;
				HeldixClient.LOGGER.info("Dauerhafte Welt: hochgeladen, läuft jetzt auf dem Heldix-Server");
			} catch (Exception e) {
				finishFailed(job, e);
				cleanupUpload(job);
			}
		});
		return job;
	}

	private static void runUpload(Job job, Path folder, IntegratedServer open, Path gameDirectory, String version) throws Exception {
		// 1. Welt beim Dienst (geteilte Welt mit fester Adresse)
		String id = job.worldId;
		if (id != null) {
			WorldService.Listing listing = WorldService.list().get(20, TimeUnit.SECONDS);
			if (listing.mine().stream().noneMatch(w -> w.id().equals(job.worldId))) id = null;
		}
		if (id == null) {
			WorldService.World world = WorldService.create(job.name, WorldService.Access.INVITED, 8, WorldService.Role.PLAYER).get(20, TimeUnit.SECONDS);
			WorldBackups.writeId(folder, world.id());
			id = world.id();
		}
		job.worldId = id;
		checkCancel(job);

		// 2. darf er? (Berechtigung, Platz, Zustand einer schon dauerhaften Welt)
		Overview overview = HostingService.overview().get(20, TimeUnit.SECONDS);
		if (!overview.available()) throw new IllegalStateException(overview.problem() != null ? overview.problem() : "Dauerhafte Welten sind auf diesem Heldix-Dienst nicht eingerichtet.");
		if (!overview.allowed()) throw new IllegalStateException("Dauerhafte Welten sind gerade in der Beta – bald mit Heldix+.");
		Hosted existing = overview.own(id);
		if (existing != null && existing.state() != State.SLEEPING && existing.state() != State.CREATING && existing.state() != State.ERROR) {
			throw new IllegalStateException("Die Welt läuft gerade auf dem Heldix-Server. Zum Ersetzen muss sie schlafen (auf der Webseite anhalten).");
		}
		if (existing == null && !overview.room()) {
			int max = overview.limits() == null ? 1 : overview.limits().worlds();
			throw new IllegalStateException(max == 1 ? "Du hast schon eine dauerhafte Welt." : "Du hast schon " + max + " dauerhafte Welten.");
		}
		long maxBytes = overview.limits() == null ? 2L << 30 : overview.limits().maxBytes();
		checkCancel(job);

		// 3. Sicherung (dasselbe ZIP wie vor „Welt teilen“)
		job.phase = Phase.BACKUP;
		Path zip = backup(open, gameDirectory, folder);
		long size = Files.size(zip);
		if (size > maxBytes) {
			throw new IllegalStateException("Die Welt ist zu groß (" + mb(size) + ", höchstens " + mb(maxBytes) + ").");
		}
		checkCancel(job);

		// 4. dauerhafte Welt anlegen (wartet danach auf den Upload)
		if (existing == null) {
			job.phase = Phase.CREATING;
			Hosted created = HostingService.create(id, version).get(60, TimeUnit.SECONDS);
			job.created = true;
			Hosting.remember(created);
		}
		checkCancel(job);

		// 5. Prüfsumme, dann in Teilen hochladen
		job.phase = Phase.UPLOADING;
		job.total = size;
		job.done = 0;
		String sha256 = sha256(zip, job);
		Upload upload = HostingService.uploadStart(id, size).get(30, TimeUnit.SECONDS);
		sendChunks(job, id, zip, upload, new TreeSet<>(upload.received()));

		// 6. Abschluss; fehlen Teile, diese noch einmal
		job.phase = Phase.FINISHING;
		JsonObject finish = new JsonObject();
		finish.addProperty("sha256", sha256);
		Hosted result = null;
		for (int round = 0; round < 3 && result == null; round++) {
			try {
				result = HostingService.hosted(call(job, Social.transfer("POST", "/v1/hosting/worlds/" + id + "/upload/finish",
						finish.toString().getBytes(StandardCharsets.UTF_8), "application/json", FINISH_TIMEOUT, true)));
				if (result == null) throw new IllegalStateException("Der Heldix-Dienst hat eine ungültige Welt geliefert");
			} catch (Social.ServiceException e) {
				if (!"missing-chunks".equals(e.code()) || round == 2) throw e;
				TreeSet<Integer> missing = new TreeSet<>();
				if (e.body() != null && e.body().has("missing") && e.body().get("missing").isJsonArray()) {
					for (JsonElement element : e.body().getAsJsonArray("missing")) {
						if (element.isJsonPrimitive() && element.getAsJsonPrimitive().isNumber()) missing.add(element.getAsInt());
					}
				}
				job.phase = Phase.UPLOADING;
				sendChunks(job, id, zip, upload, received(upload, missing));
				job.phase = Phase.FINISHING;
			}
		}
		job.result = result;
		job.created = false;
		Hosting.remember(result);
	}

	/** alle Teile außer {@code skip} (bzw. bei einer Liste fehlender genau diese) */
	private static TreeSet<Integer> received(Upload upload, TreeSet<Integer> missing) {
		TreeSet<Integer> skip = new TreeSet<>();
		for (int i = 0; i < upload.chunks(); i++) if (!missing.isEmpty() && !missing.contains(i)) skip.add(i);
		return skip;
	}

	private static void sendChunks(Job job, String id, Path zip, Upload upload, TreeSet<Integer> skip) throws Exception {
		long chunkSize = upload.chunkSize();
		try (RandomAccessFile file = new RandomAccessFile(zip.toFile(), "r")) {
			long size = file.length();
			job.done = Math.min(size, skip.size() * chunkSize);
			for (int index = 0; index < upload.chunks(); index++) {
				if (skip.contains(index)) continue;
				checkCancel(job);
				long offset = index * chunkSize;
				int length = (int) Math.min(chunkSize, size - offset);
				byte[] bytes = new byte[length];
				file.seek(offset);
				file.readFully(bytes);
				putChunk(job, id, index, bytes);
				job.done = Math.min(size, job.done + length);
			}
		}
	}

	/** ein Teil, bei Netzfehlern und 5xx bis zu 3 Versuche; 429 wartet wie verlangt */
	private static void putChunk(Job job, String id, int index, byte[] bytes) throws Exception {
		Exception last = null;
		for (int attempt = 0; attempt < 4; attempt++) {
			checkCancel(job);
			try {
				call(job, Social.transfer("PUT", "/v1/hosting/worlds/" + id + "/upload/" + index, bytes, CHUNK_TIMEOUT, true));
				return;
			} catch (Social.ServiceException e) {
				int status = e.status();
				if (status == 429) {
					TimeUnit.SECONDS.sleep(10);
					last = e;
					continue;
				}
				if (status != 0 && status != 408 && status < 500) throw e;
				last = e;
			} catch (IOException e) {
				last = e;
			}
			TimeUnit.SECONDS.sleep(2L << attempt);
		}
		throw last != null ? last : new IOException("Teil " + index + " nicht hochgeladen");
	}

	/** Anfrage abwarten (abbrechbar), JSON der Antwort; Fehler mit dem Text des Dienstes */
	private static JsonElement call(Job job, CompletableFuture<HttpResponse<InputStream>> future) throws Exception {
		job.request = future;
		try {
			if (job.cancelled) future.cancel(true);
			return Social.json(future.get());
		} catch (CancellationException e) {
			throw new CancellationException("abgebrochen");
		} catch (java.util.concurrent.ExecutionException e) {
			Throwable cause = HostingService.cause(e);
			if (cause instanceof Social.ServiceException service) throw service;
			if (cause instanceof IOException io) throw io;
			throw new IOException(cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage(), cause);
		} finally {
			job.request = null;
		}
	}

	/** Sicherung als ZIP; ist die Welt in diesem Spiel offen, erst speichern und währenddessen nicht speichern */
	private static Path backup(IntegratedServer open, Path gameDirectory, Path folder) throws Exception {
		if (open == null) {
			if (locked(folder)) throw new IllegalStateException("Die Welt ist gerade in einem anderen Spiel geöffnet – dort erst schließen.");
			return WorldBackups.create(gameDirectory, folder, false);
		}
		Map<ServerLevel, Boolean> saving = new HashMap<>();
		open.submit(() -> {
			open.saveEverything(true, true, true);
			for (ServerLevel level : open.getAllLevels()) {
				saving.put(level, level.noSave);
				level.noSave = true;
			}
		}).get(2, TimeUnit.MINUTES);
		try {
			return WorldBackups.create(gameDirectory, folder, false);
		} finally {
			open.execute(() -> saving.forEach((level, value) -> level.noSave = value));
		}
	}

	private static boolean locked(Path world) {
		try {
			return DirectoryLock.isLocked(world);
		} catch (Exception e) {
			return false;
		}
	}

	private static String sha256(Path file, Job job) throws Exception {
		MessageDigest digest = MessageDigest.getInstance("SHA-256");
		try (InputStream in = Files.newInputStream(file)) {
			byte[] buffer = new byte[1 << 16];
			int read;
			while ((read = in.read(buffer)) > 0) {
				digest.update(buffer, 0, read);
				if (job.cancelled) throw new CancellationException("abgebrochen");
			}
		}
		return HexFormat.of().formatHex(digest.digest());
	}

	/** nach Abbruch oder Fehler: Upload verwerfen, eine eben angelegte dauerhafte Welt wieder entfernen */
	private static void cleanupUpload(Job job) {
		String id = job.worldId;
		if (id == null) return;
		try {
			HostingService.uploadCancel(id).get(15, TimeUnit.SECONDS);
		} catch (Exception e) {
			// gab keinen
		}
		if (job.created) {
			try {
				HostingService.delete(id).get(15, TimeUnit.SECONDS);
				job.created = false;
				Hosting.refresh();
			} catch (Exception e) {
				HeldixClient.LOGGER.info("Dauerhafte Welt nicht wieder entfernt ({})", WorldService.message(e));
			}
		}
	}

	// ======================================================================================
	// Herunterladen als neue Einzelspielerwelt
	// ======================================================================================

	/** Welt vom Heldix-Server als neue Einzelspielerwelt anlegen (Haupt-Thread). Läuft schon eine Übertragung: null. */
	public static Job download(Minecraft mc, Hosted world) {
		if (busy() || world == null) return null;
		Job job = new Job(Kind.DOWNLOAD, world.name(), world.id());
		current = job;
		Path gameDirectory = mc.gameDirectory.toPath();
		LevelStorageSource levels = mc.getLevelSource();
		WORKER.execute(() -> {
			Path zip = null;
			try {
				job.phase = Phase.DOWNLOADING;
				Path dir = gameDirectory.resolve("heldix-downloads");
				Files.createDirectories(dir);
				zip = dir.resolve(world.id() + "-" + System.currentTimeMillis() + ".zip");
				fetch(job, "/v1/hosting/worlds/" + world.id() + "/download", zip);
				checkCancel(job);
				job.phase = Phase.IMPORTING;
				importWorld(job, levels, zip, world.name() + IMPORT_SUFFIX);
				job.phase = Phase.DONE;
				HeldixClient.LOGGER.info("Dauerhafte Welt als neue Einzelspielerwelt angelegt");
			} catch (Exception e) {
				finishFailed(job, e);
			} finally {
				if (zip != null) {
					try {
						Files.deleteIfExists(zip);
						Files.deleteIfExists(zip.resolveSibling(zip.getFileName() + ".part"));
					} catch (IOException e) {
						// bleibt liegen
					}
				}
			}
		});
		return job;
	}

	private static void fetch(Job job, String path, Path target) throws Exception {
		CompletableFuture<HttpResponse<InputStream>> future = Social.transfer("GET", path, null, DOWNLOAD_TIMEOUT, true);
		job.request = future;
		HttpResponse<InputStream> response;
		try {
			if (job.cancelled) future.cancel(true);
			response = future.get();
		} catch (CancellationException e) {
			throw new CancellationException("abgebrochen");
		} catch (java.util.concurrent.ExecutionException e) {
			Throwable cause = HostingService.cause(e);
			if (cause instanceof Social.ServiceException service) throw service;
			throw new IOException("Dienst nicht erreichbar", cause);
		} finally {
			job.request = null;
		}
		if (response.statusCode() >= 400) throw Social.failure(response);
		job.total = response.headers().firstValueAsLong("Content-Length").orElse(0);
		Path part = target.resolveSibling(target.getFileName() + ".part");
		try (InputStream in = response.body(); OutputStream out = Files.newOutputStream(part)) {
			byte[] buffer = new byte[1 << 16];
			int read;
			while ((read = in.read(buffer)) > 0) {
				if (job.cancelled) throw new CancellationException("abgebrochen");
				out.write(buffer, 0, read);
				job.done += read;
				if (job.done > MAX_IMPORT_BYTES) throw new IOException("Der Download ist zu groß.");
			}
		}
		Files.move(part, target, StandardCopyOption.REPLACE_EXISTING);
	}

	/** sicher entpacken, Weltordner finden (level.dat ganz oben oder in genau einem Ordner), als neue Welt anlegen */
	private static void importWorld(Job job, LevelStorageSource levels, Path zip, String shownName) throws Exception {
		Path saves = levels.getBaseDir().toAbsolutePath().normalize();
		Files.createDirectories(saves);
		Path staging = saves.resolve(".heldix-import-" + System.currentTimeMillis());
		try {
			extract(zip, staging, job);
			Path root = worldRoot(staging);
			if (root == null) throw new IllegalStateException("Im Download ist keine Welt (level.dat fehlt).");
			// neue, eigene Welt: ohne Welt-ID (sonst gäbe es zwei Welten mit derselben Adresse) und ohne Sperre
			Files.deleteIfExists(root.resolve(WorldBackups.ID_FILE));
			Files.deleteIfExists(root.resolve("session.lock"));
			String folder = FileUtil.findAvailableName(saves, shownName, "");
			Path target = saves.resolve(folder);
			Files.move(root, target);
			try (LevelStorageSource.LevelStorageAccess access = levels.createAccess(folder)) {
				access.renameLevel(shownName);
			}
			// createAccess legt session.lock an (und lässt die Datei nach dem Schließen liegen) – die neue Welt soll ohne sein
			Files.deleteIfExists(target.resolve("session.lock"));
			job.imported = target;
			job.importedName = shownName;
		} finally {
			deleteTree(staging);
		}
	}

	private static void extract(Path zip, Path target, Job job) throws IOException {
		Files.createDirectories(target);
		Path root = target.toAbsolutePath().normalize();
		long total = 0;
		int entries = 0;
		// ZipFile liest das Inhaltsverzeichnis am Ende: kommt auch mit „stored“-Einträgen mit Datendeskriptor zurecht, die
		// ZipInputStream ablehnt („only DEFLATED entries can have EXT descriptor“)
		try (java.util.zip.ZipFile archive = new java.util.zip.ZipFile(zip.toFile(), StandardCharsets.UTF_8)) {
			byte[] buffer = new byte[1 << 16];
			java.util.Enumeration<? extends ZipEntry> all = archive.entries();
			while (all.hasMoreElements()) {
				ZipEntry entry = all.nextElement();
				if (job.cancelled) throw new CancellationException("abgebrochen");
				if (++entries > MAX_IMPORT_ENTRIES) throw new IOException("Zu viele Dateien im Download.");
				String name = entry.getName().replace('\\', '/');
				// keine absoluten Pfade, keine Laufwerke, kein „..“, keine leeren Teile
				if (name.startsWith("/") || name.contains(":") || name.contains("\u0000")) throw new IOException("Ungültiger Pfad im Download.");
				List<String> parts = new ArrayList<>(List.of(name.split("/")));
				if (name.endsWith("/")) parts.removeIf(String::isEmpty);
				if (parts.isEmpty() || parts.stream().anyMatch(p -> p.isEmpty() || p.equals(".") || p.equals(".."))) {
					if (entry.isDirectory()) continue;
					throw new IOException("Ungültiger Pfad im Download.");
				}
				Path out = root.resolve(String.join("/", parts)).normalize();
				if (!out.startsWith(root) || out.equals(root)) throw new IOException("Ungültiger Pfad im Download.");
				if (entry.isDirectory()) {
					Files.createDirectories(out);
					continue;
				}
				Files.createDirectories(out.getParent());
				try (InputStream stream = archive.getInputStream(entry); OutputStream file = Files.newOutputStream(out)) {
					int read;
					while ((read = stream.read(buffer)) > 0) {
						total += read;
						if (total > MAX_IMPORT_BYTES) throw new IOException("Die Welt ist entpackt zu groß.");
						file.write(buffer, 0, read);
					}
				}
			}
		}
	}

	/** Ordner mit level.dat: ganz oben oder in genau einem Unterordner, sonst null */
	private static Path worldRoot(Path staging) throws IOException {
		if (Files.isRegularFile(staging.resolve("level.dat"))) return staging;
		List<Path> found = new ArrayList<>();
		try (DirectoryStream<Path> dirs = Files.newDirectoryStream(staging, Files::isDirectory)) {
			for (Path dir : dirs) if (Files.isRegularFile(dir.resolve("level.dat"))) found.add(dir);
		}
		return found.size() == 1 ? found.getFirst() : null;
	}

	private static void deleteTree(Path dir) {
		if (!Files.exists(dir)) return;
		try {
			Files.walkFileTree(dir, new SimpleFileVisitor<>() {
				@Override
				public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) throws IOException {
					Files.delete(file);
					return FileVisitResult.CONTINUE;
				}

				@Override
				public FileVisitResult postVisitDirectory(Path directory, IOException error) throws IOException {
					Files.delete(directory);
					return FileVisitResult.CONTINUE;
				}
			});
		} catch (IOException e) {
			HeldixClient.LOGGER.info("Zwischenordner nicht gelöscht ({})", e.toString());
		}
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static void checkCancel(Job job) {
		if (job.cancelled) throw new CancellationException("abgebrochen");
	}

	private static void finishFailed(Job job, Exception e) {
		if (job.cancelled || e instanceof CancellationException) {
			job.phase = Phase.CANCELLED;
			job.error = null;
			return;
		}
		Throwable cause = HostingService.cause(e);
		String text;
		if (cause instanceof Social.ServiceException service) text = service.getMessage();
		else if (cause instanceof IllegalStateException state && state.getMessage() != null) text = state.getMessage();
		else if (cause instanceof java.util.concurrent.TimeoutException) text = "Der Heldix-Dienst antwortet nicht.";
		else if (cause instanceof IOException io) text = "Übertragung fehlgeschlagen (" + (io.getMessage() == null ? io.getClass().getSimpleName() : io.getMessage()) + ")";
		else text = WorldService.message(cause);
		job.error = text;
		job.phase = Phase.FAILED;
		HeldixClient.LOGGER.info("Dauerhafte Welt: {} fehlgeschlagen ({})", job.kind == Kind.UPLOAD ? "Hochladen" : "Herunterladen", text);
	}
}
