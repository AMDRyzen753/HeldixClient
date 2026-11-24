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

	private static final List<LoadedAddon> ADDONS = new ArrayList<>();
	static final List<Listener<Runnable>> TICK = new ArrayList<>();
	static final List<Listener<Runnable>> WORLD_JOIN = new ArrayList<>();
	static final List<Listener<Runnable>> WORLD_LEAVE = new ArrayList<>();
	static final List<Listener<Consumer<String>>> CHAT = new ArrayList<>();

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

		Set<String> ids = new HashSet<>();
		for (Path jar : jars) {
			LoadedAddon addon = new LoadedAddon(jar);
			ADDONS.add(addon);
			load(addon, ids);
		}
		registerEvents();
		HeldixClient.LOGGER.info("Heldix-Addons: {} von {} aktiv", activeCount(), ADDONS.size());
	}

	private static void load(LoadedAddon addon, Set<String> ids) {
		try {
			addon.metadata = readMetadata(addon.file);
			AddonMetadata meta = addon.metadata;
			if (meta.id == null || !meta.id.matches("[a-z0-9_-]+")) throw new IllegalStateException("Ungültige Addon-ID: " + meta.id);
			if (!ids.add(meta.id)) throw new IllegalStateException("Addon-ID \"" + meta.id + "\" ist doppelt installiert");
			if (meta.api != HeldixApi.API_VERSION) {
				throw new IllegalStateException("Gebaut für Heldix-API " + meta.api + ", unterstützt wird API " + HeldixApi.API_VERSION);
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
		ClientEvents.TICK_END.register(minecraft -> runAll(TICK, "onTick"));
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
