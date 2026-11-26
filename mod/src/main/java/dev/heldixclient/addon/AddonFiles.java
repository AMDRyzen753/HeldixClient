package dev.heldixclient.addon;

import dev.heldixclient.HeldixClient;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * An/aus eines Addons auf der Festplatte, gleich wie im Launcher: abgeschaltet heißt die Datei {@code .jar.disabled}.
 *
 * <p>Unter Windows sind geladene JARs bis zum Spielende gesperrt und lassen sich nicht umbenennen. Dann steht der Name in
 * {@code heldix-addons/.ausschalten} (eine Datei pro Zeile); der Heldix Loader benennt sie beim nächsten Start um, bevor
 * er etwas lädt. Der Launcher macht dasselbe, sobald das Spiel beendet ist.
 */
final class AddonFiles {
	static final String DISABLED = ".disabled";
	static final String PENDING_DISABLE = ".ausschalten";
	/** Zustand auf der Festplatte höchstens so lange wiederverwenden (die Liste wird jedes Bild gezeichnet) */
	private static final long FRESH_MS = 1000;

	private static volatile Set<String> pendingCache;
	private static volatile long pendingAt;

	private AddonFiles() {
	}

	/** Name der JAR ohne ".disabled" */
	static String baseName(LoadedAddon addon) {
		String name = addon.fileName();
		return name.endsWith(DISABLED) ? name.substring(0, name.length() - DISABLED.length()) : name;
	}

	private record Cached(boolean on, long at) {
	}

	private static final java.util.Map<Path, Cached> SWITCHES = new java.util.concurrent.ConcurrentHashMap<>();

	/** Wird das Addon beim nächsten Start geladen? (auch, wenn der Launcher die Datei während des Spiels umbenennt) */
	static boolean switchedOn(LoadedAddon addon) {
		Cached cached = SWITCHES.get(addon.file);
		long now = System.currentTimeMillis();
		if (cached != null && now - cached.at() < FRESH_MS) return cached.on();
		Path dir = addon.file.getParent();
		String base = baseName(addon);
		boolean on = Files.exists(dir.resolve(base)) && !pending(dir).contains(base);
		SWITCHES.put(addon.file, new Cached(on, now));
		return on;
	}

	/** Schalter umlegen: Datei umbenennen, gesperrte JARs vormerken. true = geklappt. */
	static synchronized boolean setSwitchedOn(LoadedAddon addon, boolean on) {
		Path dir = addon.file.getParent();
		String base = baseName(addon);
		Path jar = dir.resolve(base);
		Path disabled = dir.resolve(base + DISABLED);
		Set<String> pending = readPending(dir);
		try {
			if (on) {
				if (pending.remove(base)) writePending(dir, pending);
				if (!Files.exists(jar) && Files.exists(disabled)) Files.move(disabled, jar);
				return Files.exists(jar);
			}
			if (!Files.exists(jar)) return true;
			try {
				Files.move(jar, disabled);
			} catch (IOException locked) {
				// unter Windows hält der Classloader geladene JARs offen: beim nächsten Start umbenennen
				if (pending.add(base)) writePending(dir, pending);
			}
			return true;
		} catch (IOException e) {
			HeldixClient.LOGGER.warn("Heldix-Addons: {} nicht {}geschaltet", base, on ? "ein" : "aus", e);
			return false;
		} finally {
			pendingAt = 0;
			SWITCHES.remove(addon.file);
		}
	}

	private static Set<String> pending(Path dir) {
		Set<String> cache = pendingCache;
		if (cache == null || System.currentTimeMillis() - pendingAt > FRESH_MS) {
			pendingCache = cache = Set.copyOf(readPending(dir));
			pendingAt = System.currentTimeMillis();
		}
		return cache;
	}

	static Set<String> readPending(Path dir) {
		Set<String> names = new LinkedHashSet<>();
		try {
			for (String line : Files.readAllLines(dir.resolve(PENDING_DISABLE), StandardCharsets.UTF_8)) {
				String name = line.strip();
				if (!name.isEmpty() && !name.contains("/") && !name.contains("\\") && !name.contains("..") && name.endsWith(".jar")) names.add(name);
			}
		} catch (IOException ignored) {
			// keine Datei = nichts vorgemerkt
		}
		return names;
	}

	private static void writePending(Path dir, Set<String> names) {
		try {
			if (names.isEmpty()) Files.deleteIfExists(dir.resolve(PENDING_DISABLE));
			else Files.writeString(dir.resolve(PENDING_DISABLE), String.join("\n", names) + "\n", StandardCharsets.UTF_8);
		} catch (IOException e) {
			HeldixClient.LOGGER.warn("Heldix-Addons: {} nicht schreibbar", PENDING_DISABLE, e);
		}
	}
}
