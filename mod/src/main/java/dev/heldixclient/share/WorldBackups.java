package dev.heldixclient.share;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Sicherungen geteilter Welten: vor jedem „Welt teilen“ ein ZIP des Weltordners unter
 * {@code <Instanz>/heldix-sicherungen/<Weltordner>/<Datum>.zip}; die letzten {@value #KEEP} bleiben. Wiederherstellen
 * geht nur bei geschlossener Welt (Heldix-Welten im Hauptmenü) und sichert vorher den jetzigen Stand.
 *
 * <p>Außerdem die Datei {@code heldix-welt.json} im Weltordner ({@code { "id": "…" }}): Mit ihr behält eine Welt beim
 * nächsten Teilen ihre Adresse.
 */
public final class WorldBackups {
	public static final int KEEP = 5;
	/** Datei im Weltordner mit der Welt-ID des Dienstes */
	public static final String ID_FILE = "heldix-welt.json";
	private static final String FOLDER = "heldix-sicherungen";
	private static final DateTimeFormatter NAME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss", Locale.ROOT);
	private static final DateTimeFormatter SHOWN = DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm", Locale.GERMANY);

	/** Eine Sicherung: Datei, Zeitpunkt (aus dem Namen, sonst Änderungszeit), Größe in Bytes */
	public record Backup(Path file, LocalDateTime at, long size, boolean beforeRestore) {
		public String label() {
			return SHOWN.format(at) + (beforeRestore ? " (vor dem Wiederherstellen)" : "");
		}

		public String sizeLabel() {
			double mb = size / (1024.0 * 1024.0);
			return mb < 0.1 ? "< 0,1 MB" : String.format(Locale.GERMANY, "%.1f MB", mb);
		}
	}

	private WorldBackups() {
	}

	/** Ordner der Sicherungen einer Welt (Ordnername der Welt in saves/) */
	public static Path directory(Path gameDirectory, String worldFolder) {
		return gameDirectory.resolve(FOLDER).resolve(safeName(worldFolder));
	}

	/**
	 * ZIP des Weltordners anlegen (ohne session.lock) und ältere über {@value #KEEP} löschen. Läuft in einem
	 * Hintergrund-Thread; die Welt muss vorher gespeichert sein (und sollte währenddessen nicht speichern).
	 */
	public static Path create(Path gameDirectory, Path world, boolean beforeRestore) throws IOException {
		Path dir = directory(gameDirectory, world.getFileName().toString());
		Files.createDirectories(dir);
		String base = NAME.format(LocalDateTime.now()) + (beforeRestore ? "-vor-wiederherstellen" : "");
		// mehrere in derselben Sekunde: immer der nächsthöhere Zähler (nie ein Name, den das Aufräumen gerade frei gemacht hat)
		int next = 1;
		try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, base + "*.zip")) {
			for (Path file : files) {
				String name = file.getFileName().toString();
				String rest = name.substring(base.length(), name.length() - 4);
				if (rest.isEmpty()) next = Math.max(next, 2);
				else if (rest.matches("-\\d{1,4}")) next = Math.max(next, Integer.parseInt(rest.substring(1)) + 1);
			}
		}
		Path target = dir.resolve(next == 1 ? base + ".zip" : base + "-" + next + ".zip");
		Path part = target.resolveSibling(target.getFileName() + ".part");
		try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(Files.newOutputStream(part), 1 << 16))) {
			Path root = world;
			Files.walkFileTree(root, new SimpleFileVisitor<>() {
				@Override
				public FileVisitResult preVisitDirectory(Path directory, BasicFileAttributes attributes) throws IOException {
					if (!directory.equals(root)) {
						zip.putNextEntry(new ZipEntry(entryName(root, directory) + "/"));
						zip.closeEntry();
					}
					return FileVisitResult.CONTINUE;
				}

				@Override
				public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) throws IOException {
					// gesperrt, solange die Welt offen ist – und beim Wiederherstellen unnötig
					if (file.getParent().equals(root) && file.getFileName().toString().equals("session.lock")) return FileVisitResult.CONTINUE;
					ZipEntry entry = new ZipEntry(entryName(root, file));
					entry.setTime(attributes.lastModifiedTime().toMillis());
					zip.putNextEntry(entry);
					Files.copy(file, zip);
					zip.closeEntry();
					return FileVisitResult.CONTINUE;
				}
			});
		} catch (IOException | RuntimeException e) {
			Files.deleteIfExists(part);
			throw e;
		}
		Files.move(part, target, StandardCopyOption.ATOMIC_MOVE);
		prune(dir, target);
		return target;
	}

	/** Sicherungen einer Welt, neueste zuerst */
	public static List<Backup> list(Path gameDirectory, String worldFolder) {
		Path dir = directory(gameDirectory, worldFolder);
		List<Backup> list = new ArrayList<>();
		if (!Files.isDirectory(dir)) return list;
		try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "*.zip")) {
			for (Path file : files) {
				try {
					list.add(new Backup(file, timeOf(file), Files.size(file), file.getFileName().toString().contains("-vor-wiederherstellen")));
				} catch (IOException e) {
					// verschwunden oder gesperrt: weglassen
				}
			}
		} catch (IOException e) {
			HeldixClient.LOGGER.info("Sicherungen nicht lesbar ({})", e.toString());
		}
		list.sort(Comparator.comparing(Backup::file, NEWEST_FIRST));
		return list;
	}

	/** ältere über {@value #KEEP} löschen; die gerade angelegte Sicherung bleibt immer */
	private static void prune(Path dir, Path created) {
		List<Path> files = new ArrayList<>();
		try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.zip")) {
			for (Path file : stream) files.add(file);
		} catch (IOException e) {
			return;
		}
		files.sort(NEWEST_FIRST);
		if (files.remove(created)) files.addFirst(created);
		for (int i = KEEP; i < files.size(); i++) {
			try {
				Files.deleteIfExists(files.get(i));
			} catch (IOException e) {
				HeldixClient.LOGGER.info("Alte Sicherung nicht gelöscht ({})", e.toString());
			}
		}
	}

	/**
	 * Sicherung wiederherstellen (Welt geschlossen!): erst entpacken, dann den jetzigen Stand sichern, dann die Ordner
	 * tauschen. Die Welt-ID (heldix-welt.json) des jetzigen Stands bleibt, damit die Adresse gleich bleibt.
	 */
	public static void restore(Path gameDirectory, Path world, Path backup) throws IOException {
		if (!Files.isDirectory(world)) throw new IOException("Weltordner fehlt");
		String id = readId(world);
		Path parent = world.getParent();
		String folder = world.getFileName().toString();
		Path staging = parent.resolve(folder + ".heldix-wiederherstellen");
		Path old = parent.resolve(folder + ".heldix-alt");
		deleteTree(staging);
		deleteTree(old);
		extract(backup, staging);
		create(gameDirectory, world, true);
		Files.move(world, old);
		try {
			Files.move(staging, world);
		} catch (IOException e) {
			Files.move(old, world);
			deleteTree(staging);
			throw e;
		}
		if (id != null) writeId(world, id);
		else Files.deleteIfExists(world.resolve(ID_FILE));
		deleteTree(old);
	}

	private static void extract(Path zipFile, Path target) throws IOException {
		Files.createDirectories(target);
		Path root = target.toAbsolutePath().normalize();
		try (InputStream in = Files.newInputStream(zipFile); ZipInputStream zip = new ZipInputStream(in, StandardCharsets.UTF_8)) {
			ZipEntry entry;
			while ((entry = zip.getNextEntry()) != null) {
				Path out = root.resolve(entry.getName()).normalize();
				// nichts außerhalb des Zielordners schreiben
				if (!out.startsWith(root) || out.equals(root)) continue;
				if (entry.isDirectory()) {
					Files.createDirectories(out);
				} else {
					Files.createDirectories(out.getParent());
					try (OutputStream file = Files.newOutputStream(out)) {
						zip.transferTo(file);
					}
				}
			}
		}
	}

	private static void deleteTree(Path dir) throws IOException {
		if (!Files.exists(dir)) return;
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
	}

	// --- heldix-welt.json --------------------------------------------------------------------

	/** Welt-ID aus heldix-welt.json im Weltordner, sonst null */
	public static String readId(Path world) {
		Path file = world.resolve(ID_FILE);
		if (!Files.isRegularFile(file)) return null;
		try {
			JsonObject json = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
			String id = json.has("id") && json.get("id").isJsonPrimitive() ? json.get("id").getAsString() : null;
			return id != null && WorldService.WORLD_ID.matcher(id).matches() ? id : null;
		} catch (IOException | RuntimeException e) {
			return null;
		}
	}

	public static void writeId(Path world, String id) throws IOException {
		JsonObject json = new JsonObject();
		json.addProperty("id", id);
		Path file = world.resolve(ID_FILE);
		Path part = world.resolve(ID_FILE + ".part");
		Files.writeString(part, json + "\n", StandardCharsets.UTF_8);
		Files.move(part, file, StandardCopyOption.REPLACE_EXISTING);
	}

	public static void forgetId(Path world) {
		try {
			Files.deleteIfExists(world.resolve(ID_FILE));
		} catch (IOException e) {
			HeldixClient.LOGGER.info("{} nicht gelöscht ({})", ID_FILE, e.toString());
		}
	}

	/** Weltordner in saves/, dessen heldix-welt.json diese ID hat (null = keiner auf diesem PC) */
	public static Path findWorld(Path saves, String id) {
		if (id == null || !Files.isDirectory(saves)) return null;
		try (DirectoryStream<Path> worlds = Files.newDirectoryStream(saves, Files::isDirectory)) {
			for (Path world : worlds) {
				if (id.equals(readId(world))) return world;
			}
		} catch (IOException e) {
			return null;
		}
		return null;
	}

	// --- Hilfen ------------------------------------------------------------------------------

	private static String entryName(Path root, Path file) {
		return root.relativize(file).toString().replace('\\', '/');
	}

	/** neueste zuerst: Zeit aus dem Namen, bei Gleichstand (dieselbe Sekunde) die Änderungszeit der Datei */
	private static final Comparator<Path> NEWEST_FIRST = Comparator.comparing(WorldBackups::timeOf).thenComparingInt(WorldBackups::counter)
			.thenComparingLong(WorldBackups::modified).reversed();

	/** Zähler am Ende des Namens („…-2.zip“ bei mehreren Sicherungen in derselben Sekunde), sonst 1 */
	private static int counter(Path file) {
		String name = file.getFileName().toString();
		if (name.length() < 23 || !name.endsWith(".zip")) return 1;
		String rest = name.substring(19, name.length() - 4).replace("-vor-wiederherstellen", "");
		return rest.matches("-\\d{1,4}") ? Integer.parseInt(rest.substring(1)) : 1;
	}

	private static long modified(Path file) {
		try {
			return Files.getLastModifiedTime(file).toMillis();
		} catch (IOException e) {
			return 0;
		}
	}

	private static LocalDateTime timeOf(Path file) {
		String name = file.getFileName().toString();
		if (name.length() >= 19) {
			try {
				return LocalDateTime.parse(name.substring(0, 19), NAME);
			} catch (RuntimeException e) {
				// eigener Name: Änderungszeit
			}
		}
		try {
			return LocalDateTime.ofInstant(Files.getLastModifiedTime(file).toInstant(), java.time.ZoneId.systemDefault());
		} catch (IOException e) {
			return LocalDateTime.MIN;
		}
	}

	/** Ordnername ohne Zeichen, die in Pfaden Ärger machen */
	private static String safeName(String folder) {
		String clean = folder.replaceAll("[\\\\/:*?\"<>|\\p{Cc}]", "_").strip();
		return clean.isEmpty() || clean.equals(".") || clean.equals("..") ? "welt" : clean;
	}
}
