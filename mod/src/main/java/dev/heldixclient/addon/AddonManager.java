package dev.heldixclient.addon;

import com.google.gson.Gson;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.event.ChatEvents;
import dev.heldixclient.loader.api.event.ClientEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;

import java.io.InputStreamReader;
import java.io.Reader;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.stream.Stream;

/**
 * Lädt Heldix-Addons aus dem Ordner heldix-addons/ der Instanz.
 *
 * Addons sind einfacher als Mods: sie sehen nur die stabile Heldix-API (keine Minecraft-Klassen)
 * und bekommen je einen eigenen Classloader. Fehler in einem Addon werden abgefangen; nach
 * mehreren Fehlern wird das Addon deaktiviert, das Spiel läuft weiter.
 */
public final class AddonManager {
	public static final String ADDON_DIR = "heldix-addons";
	public static final String METADATA_FILE = "heldix.addon.json";
	private static final int MAX_ERRORS = 3;
	private static final Gson GSON = new Gson();

	record Listener<T>(LoadedAddon addon, T callback) {
	}

	/** Taste eines Addons (API 2) */
	record Key(LoadedAddon addon, net.minecraft.client.KeyMapping mapping, Runnable onPress) {
	}

	private static final List<LoadedAddon> ADDONS = new ArrayList<>();
	static final List<Listener<Runnable>> TICK = new ArrayList<>();
	static final List<Listener<Runnable>> WORLD_JOIN = new ArrayList<>();
	static final List<Listener<Runnable>> WORLD_LEAVE = new ArrayList<>();
	static final List<Listener<Consumer<String>>> CHAT = new ArrayList<>();
	static final List<Key> KEYS = new ArrayList<>();
	/** älteste API-Version, für die gebaute Addons noch laufen */
	public static final int MIN_API = 1;

	private AddonManager() {
	}

	public static Path addonDirectory() {
		return HeldixLoader.gameDir().resolve(ADDON_DIR);
	}

	public static List<LoadedAddon> addons() {
		return Collections.unmodifiableList(ADDONS);
	}

	public static long activeCount() {
		return ADDONS.stream().filter(LoadedAddon::isActive).count();
	}

	/** Sucht und lädt alle Addons. Wird einmal beim Start des Clients aufgerufen. */
	public static void init() {
		Path dir = addonDirectory();
		List<Path> jars = new ArrayList<>();
		try {
			Files.createDirectories(dir);
			try (Stream<Path> files = Files.list(dir)) {
				files.filter(p -> p.getFileName().toString().endsWith(".jar")).sorted().forEach(jars::add);
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.error("Heldix-Addons: Ordner {} nicht lesbar", dir, e);
		}

		// erst alle Beschreibungen lesen: liegt ein Addon in mehreren Versionen da, gewinnt die neueste
		java.util.Map<String, LoadedAddon> newest = new java.util.HashMap<>();
		for (Path jar : jars) {
			LoadedAddon addon = new LoadedAddon(jar);
			ADDONS.add(addon);
			try {
				addon.metadata = readMetadata(jar);
				String id = addon.metadata.id;
				if (id != null) {
					LoadedAddon other = newest.get(id);
					if (other == null || compareVersions(addon.metadata.version, other.metadata.version) > 0) newest.put(id, addon);
				}
			} catch (Throwable t) {
				deactivate(addon, describe(t));
				HeldixClient.LOGGER.error("Heldix-Addon {} konnte nicht gelesen werden", addon.fileName(), t);
			}
		}

		Set<String> ids = new HashSet<>();
		for (LoadedAddon addon : ADDONS) {
			if (addon.metadata == null) continue;
			LoadedAddon chosen = addon.metadata.id != null ? newest.get(addon.metadata.id) : null;
			if (chosen != null && chosen != addon) {
				boolean older = compareVersions(addon.metadata.version, chosen.metadata.version) < 0;
				deactivate(addon, older
						? "Ältere Version – genutzt wird " + chosen.metadata.version + " (" + chosen.fileName() + ")"
						: "Doppelt installiert – genutzt wird " + chosen.fileName());
				HeldixClient.LOGGER.warn("Heldix-Addon {} übersprungen: {}", addon.fileName(), addon.error());
				continue;
			}
			load(addon, ids);
		}
		registerEvents();
		HeldixClient.LOGGER.info("Heldix-Addons: {} von {} aktiv", activeCount(), ADDONS.size());
	}

	private static void load(LoadedAddon addon, Set<String> ids) {
		try {
			AddonMetadata meta = addon.metadata;
			if (meta.id == null || !meta.id.matches("[a-z0-9_-]+")) throw new IllegalStateException("Ungültige Addon-ID: " + meta.id);
			if (!ids.add(meta.id)) throw new IllegalStateException("Addon-ID \"" + meta.id + "\" ist doppelt installiert");
			if (meta.api < MIN_API || meta.api > HeldixApi.API_VERSION) {
				throw new IllegalStateException(meta.api > HeldixApi.API_VERSION
						? "Braucht Heldix-API " + meta.api + ", dieser HeldixClient kann bis API " + HeldixApi.API_VERSION + " – bitte HeldixClient aktualisieren"
						: "Gebaut für die veraltete Heldix-API " + meta.api + ", unterstützt wird ab API " + MIN_API);
			}
			if (meta.entrypoint == null || meta.entrypoint.isBlank()) throw new IllegalStateException("\"entrypoint\" fehlt");

			URL url = addon.file.toUri().toURL();
			addon.classLoader = new URLClassLoader("heldix-addon-" + meta.id, new URL[] {url}, AddonManager.class.getClassLoader());
			Class<?> type = Class.forName(meta.entrypoint, true, addon.classLoader);
			if (!HeldixAddon.class.isAssignableFrom(type)) {
				throw new IllegalStateException(meta.entrypoint + " implementiert HeldixAddon nicht");
			}
			addon.instance = (HeldixAddon) type.getDeclaredConstructor().newInstance();
			addon.context = new AddonContext(addon);
			addon.state = LoadedAddon.State.ACTIVE;
			addon.instance.onEnable(addon.context);
			HeldixClient.LOGGER.info("Heldix-Addon {} {} geladen", meta.displayName(), meta.version);
		} catch (Throwable t) {
			deactivate(addon, describe(t));
			HeldixClient.LOGGER.error("Heldix-Addon {} konnte nicht geladen werden", addon.fileName(), t);
		}
	}

	/** Vergleicht Versionen wie "1.2.0" zahlenweise; Text dahinter (z. B. "-beta") zählt nicht. */
	static int compareVersions(String a, String b) {
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

	private static AddonMetadata readMetadata(Path jar) throws Exception {
		try (JarFile file = new JarFile(jar.toFile())) {
			JarEntry entry = file.getJarEntry(METADATA_FILE);
			if (entry == null) throw new IllegalStateException(METADATA_FILE + " fehlt in der JAR");
			try (Reader reader = new InputStreamReader(file.getInputStream(entry), StandardCharsets.UTF_8)) {
				AddonMetadata meta = GSON.fromJson(reader, AddonMetadata.class);
				if (meta == null) throw new IllegalStateException(METADATA_FILE + " ist leer");
				return meta;
			}
		}
	}

	private static String describe(Throwable t) {
		Throwable root = t;
		while (root.getCause() != null && root.getCause() != root) root = root.getCause();
		String message = root.getMessage();
		return message != null ? message : root.getClass().getSimpleName();
	}

	/** Schaltet ein Addon ab: Module entfernen, Listener werden ab jetzt übersprungen. */
	static void deactivate(LoadedAddon addon, String reason) {
		addon.state = LoadedAddon.State.FAILED;
		addon.error = reason;
		for (Module module : addon.modules) ModuleManager.removeModule(module);
	}

	/** Fehler eines Addons zur Laufzeit melden; nach MAX_ERRORS wird es abgeschaltet. */
	static void reportError(LoadedAddon addon, String where, Throwable t) {
		addon.errorCount++;
		HeldixClient.LOGGER.error("Heldix-Addon {} – Fehler in {}", addon.name(), where, t);
		if (addon.errorCount >= MAX_ERRORS && addon.isActive()) {
			deactivate(addon, "Abgeschaltet nach " + MAX_ERRORS + " Fehlern: " + describe(t));
			HeldixClient.LOGGER.error("Heldix-Addon {} wurde abgeschaltet", addon.name());
		}
	}

	private static void runAll(List<Listener<Runnable>> listeners, String where) {
		for (Listener<Runnable> listener : List.copyOf(listeners)) {
			if (!listener.addon().isActive()) continue;
			try {
				listener.callback().run();
			} catch (Throwable t) {
				reportError(listener.addon(), where, t);
			}
		}
	}

	private static void registerEvents() {
		ClientEvents.TICK_END.register(minecraft -> {
			keys();
			runAll(TICK, "onTick");
		});
		WorldEvents.JOIN.register(minecraft -> runAll(WORLD_JOIN, "onWorldJoin"));
		WorldEvents.LEAVE.register(minecraft -> runAll(WORLD_LEAVE, "onWorldLeave"));
		ChatEvents.RECEIVE.register((message, fromPlayer) -> chat(message.getString()));
		ClientEvents.STOPPING.register(minecraft -> {
			for (LoadedAddon addon : ADDONS) {
				if (!addon.isActive()) continue;
				try {
					addon.instance.onDisable();
				} catch (Throwable t) {
					HeldixClient.LOGGER.warn("Heldix-Addon {}: Fehler in onDisable", addon.name(), t);
				}
			}
		});
	}

	private static void keys() {
		for (Key key : KEYS) {
			while (key.mapping().consumeClick()) {
				if (!key.addon().isActive()) continue;
				try {
					key.onPress().run();
				} catch (Throwable t) {
					reportError(key.addon(), "Taste " + key.mapping().getName(), t);
				}
			}
		}
	}

	private static void chat(String text) {
		for (Listener<Consumer<String>> listener : List.copyOf(CHAT)) {
			if (!listener.addon().isActive()) continue;
			try {
				listener.callback().accept(text);
			} catch (Throwable t) {
				reportError(listener.addon(), "onChatMessage", t);
			}
		}
	}
}
