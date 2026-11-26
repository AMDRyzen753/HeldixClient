package dev.heldixclient.loader.impl;

import dev.heldixclient.loader.api.AddonManifest;
import dev.heldixclient.loader.api.LoaderAddon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * Findet im Ordner heldix-addons/ die Addons mit Zugriff auf Minecraft (clientEntrypoint oder transformers).
 *
 * <p>Wie HeldixClient (AddonManager) gilt: nur Dateien auf {@code .jar}, abgeschaltete heißen {@code .jar.disabled}
 * (wie im Launcher) und werden übersprungen; liegt ein Addon mehrfach da, zählt die neueste Version. Vorher erledigt
 * der Loader, was im Spiel nur vorgemerkt werden konnte (unter Windows sind geladene JARs bis zum Spielende gesperrt):
 * Ersatz-JARs ({@code .jar.neu}), Löschungen ({@code .entfernen}) und Abschaltungen ({@code .ausschalten}).
 */
final class AddonDiscovery {
	static final String DIR = "heldix-addons";
	static final String DISABLED = ".disabled";
	/** Ersatz für eine gesperrte JAR gleichen Namens (Update aus dem Addon-Store im Spiel) */
	static final String REPLACEMENT = ".neu";
	/** im Spiel entfernte JARs, eine pro Zeile */
	static final String PENDING_REMOVAL = ".entfernen";
	/** im Spiel ausgeschaltete JARs, eine pro Zeile: werden beim Start zu .jar.disabled */
	static final String PENDING_DISABLE = ".ausschalten";

	private AddonDiscovery() {
	}

	/** Beim Start, bevor etwas geladen ist: vorgemerkte Änderungen aus dem Spiel erledigen. */
	static void applyPending(Path dir) {
		if (!Files.isDirectory(dir)) return;
		try (Stream<Path> files = Files.list(dir)) {
			for (Path file : files.filter(p -> p.getFileName().toString().endsWith(".jar" + REPLACEMENT)).toList()) {
				String name = file.getFileName().toString();
				try {
					Files.move(file, dir.resolve(name.substring(0, name.length() - REPLACEMENT.length())), StandardCopyOption.REPLACE_EXISTING);
				} catch (IOException e) {
					LoaderCore.LOG.warn("Heldix-Addons: {} nicht eingesetzt", name, e);
				}
			}
		} catch (IOException e) {
			LoaderCore.LOG.warn("Heldix-Addons: Ordner {} nicht lesbar", dir, e);
		}
		Set<String> left = new LinkedHashSet<>();
		for (String name : readList(dir, PENDING_REMOVAL)) {
			try {
				Files.deleteIfExists(dir.resolve(name));
			} catch (IOException e) {
				left.add(name);
			}
		}
		writeList(dir, PENDING_REMOVAL, left);
		left.clear();
		for (String name : readList(dir, PENDING_DISABLE)) {
			if (name.endsWith(DISABLED)) continue;
			Path file = dir.resolve(name);
			try {
				if (Files.exists(file)) Files.move(file, dir.resolve(name + DISABLED), StandardCopyOption.REPLACE_EXISTING);
			} catch (IOException e) {
				left.add(name);
			}
		}
		writeList(dir, PENDING_DISABLE, left);
	}

	/**
	 * Alle Addons mit Zugriff auf Minecraft, die geladen werden sollen (je ID die neueste Version, auch wenn eine
	 * andere Version nur die Heldix-API nutzt). Was hier fehlt, lädt HeldixClient selbst oder zeigt es als Fehler.
	 */
	static List<LoaderAddon> discover(Path dir) {
		List<LoaderAddon> result = new ArrayList<>();
		if (!Files.isDirectory(dir)) return result;
		List<Path> jars;
		try (Stream<Path> files = Files.list(dir)) {
			jars = files.filter(p -> p.getFileName().toString().endsWith(".jar")).sorted().toList();
		} catch (IOException e) {
			LoaderCore.problem("Ordner " + dir + " nicht lesbar: " + e.getMessage());
			return result;
		}
		// wie AddonManager: die erste Datei gewinnt, eine spätere nur mit höherer Version
		Map<String, LoaderAddon> newest = new LinkedHashMap<>();
		for (Path jar : jars) {
			AddonManifest manifest;
			try {
				manifest = AddonManifest.read(jar);
			} catch (Exception e) {
				continue; // zeigt HeldixClient als Fehler
			}
			if (manifest.id() == null) continue;
			LoaderAddon other = newest.get(manifest.id());
			if (other == null || compare(manifest.version(), other.version()) > 0) newest.put(manifest.id(), new LoaderAddon(jar, manifest));
		}
		for (LoaderAddon addon : newest.values()) {
			if (addon.manifest().minecraftAccess()) result.add(addon);
		}
		return result;
	}

	/** Gleicher Vergleich wie AddonManager.compareVersions: zahlenweise, Text hinter einer Zahl zählt nicht. */
	static int compare(String a, String b) {
		String[] x = (a != null ? a : "").split("[.+-]");
		String[] y = (b != null ? b : "").split("[.+-]");
		for (int i = 0; i < Math.max(x.length, y.length); i++) {
			int diff = Integer.compare(number(x, i), number(y, i));
			if (diff != 0) return diff;
		}
		return 0;
	}

	private static int number(String[] parts, int index) {
		if (index >= parts.length) return 0;
		try {
			return Integer.parseInt(parts[index].replaceAll("\\D.*", ""));
		} catch (NumberFormatException e) {
			return 0;
		}
	}

	/** Liste im Addon-Ordner lesen: nur einfache Dateinamen auf .jar bzw. .jar.disabled */
	static Set<String> readList(Path dir, String file) {
		Set<String> names = new LinkedHashSet<>();
		try {
			for (String line : Files.readAllLines(dir.resolve(file), StandardCharsets.UTF_8)) {
				String name = line.strip();
				if (!name.isEmpty() && !name.contains("/") && !name.contains("\\") && !name.contains("..") && name.matches(".+\\.jar(\\.disabled)?")) {
					names.add(name);
				}
			}
		} catch (IOException ignored) {
			// keine Datei = nichts vorgemerkt
		}
		return names;
	}

	static void writeList(Path dir, String file, Set<String> names) {
		try {
			if (names.isEmpty()) Files.deleteIfExists(dir.resolve(file));
			else Files.writeString(dir.resolve(file), String.join("\n", names) + "\n", StandardCharsets.UTF_8);
		} catch (IOException e) {
			LoaderCore.LOG.warn("Heldix-Addons: {} nicht schreibbar", file, e);
		}
	}
}
