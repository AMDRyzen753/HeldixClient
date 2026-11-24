package dev.heldixclient.loader.impl;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.loader.api.HeldixModInitializer;
import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.loader.api.transform.ClassTransformer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.instrument.Instrumentation;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.jar.JarFile;

/**
 * Zustand und Startablauf des Heldix Loaders.
 *
 * <ol>
 *   <li>{@link #boot}: noch vor Minecraft (Java-Agent). Mods finden und prüfen, ihre JARs auf den
 *       Classpath legen, Übersetzungen lesen, Transformer registrieren.</li>
 *   <li>{@link #initMods}: aus dem Konstruktor von Minecraft (eingefügt durch {@link BuiltinPatches}).
 *       Ruft die Einstiegspunkte der Mods auf.</li>
 * </ol>
 */
public final class LoaderCore {
	public static final String ID = "heldixloader";
	public static final Logger LOG = LoggerFactory.getLogger("Heldix Loader");

	private record LoadedMod(ModMetadata meta, ModInfo info) {
	}

	private static String version = "dev";
	private static String minecraftVersion = "unbekannt";
	private static Path gameDir = Path.of("").toAbsolutePath();
	private static Path modsDir = gameDir.resolve("mods");
	private static final List<LoadedMod> LOADED = new ArrayList<>();
	private static final List<ModInfo> MODS = new ArrayList<>();
	private static final List<String> PROBLEMS = new CopyOnWriteArrayList<>();
	private static boolean booted;
	private static boolean initialized;

	private LoaderCore() {
	}

	static synchronized void boot(String agentArgs, Instrumentation instrumentation) {
		if (booted) return;
		booted = true;
		version = readLoaderVersion();
		gameDir = resolveGameDir(agentArgs);
		modsDir = gameDir.resolve("mods");
		minecraftVersion = detectMinecraftVersion();
		LOG.info("Heldix Loader {} startet (Minecraft {}, Java {})", version, minecraftVersion, Runtime.version().feature());

		TransformerChain chain = new TransformerChain(dumpDir());
		chain.add(new BuiltinPatches(), ID);

		List<ModDiscovery.Candidate> found = ModDiscovery.discover(modsDir, LoaderCore::problem);
		for (ModDiscovery.Candidate candidate : ModDiscovery.resolve(found, version, minecraftVersion, LoaderCore::problem)) {
			ModMetadata meta = candidate.meta();
			try {
				instrumentation.appendToSystemClassLoaderSearch(new JarFile(candidate.file().toFile()));
			} catch (Exception e) {
				problem(meta.displayName() + ": JAR konnte nicht geladen werden (" + e.getMessage() + ")");
				continue;
			}
			ModInfo info = new ModInfo(meta.id, meta.displayName(), meta.version, meta.description == null ? "" : meta.description,
					meta.authors == null ? List.of() : meta.authors, candidate.file());
			LOADED.add(new LoadedMod(meta, info));
			MODS.add(info);
			ModTranslations.load(candidate.file());
		}

		// Transformer der Mods (nach denen des Loaders)
		for (LoadedMod mod : LOADED) {
			for (String name : mod.meta().transformers()) {
				try {
					Object instance = Class.forName(name, true, ClassLoader.getSystemClassLoader()).getDeclaredConstructor().newInstance();
					if (!(instance instanceof ClassTransformer transformer)) {
						throw new IllegalStateException(name + " implementiert ClassTransformer nicht");
					}
					chain.add(transformer, mod.info().id());
				} catch (Throwable t) {
					problem(mod.info().name() + ": Transformer " + name + " konnte nicht geladen werden (" + describe(t) + ")");
					LOG.error("Transformer {} von {} konnte nicht geladen werden", name, mod.info().id(), t);
				}
			}
		}
		instrumentation.addTransformer(chain, false);

		LOG.info("Heldix Loader {}: {} Mod(s) gefunden{}", version, MODS.size(),
				MODS.isEmpty() ? "" : ": " + String.join(", ", MODS.stream().map(m -> m.id() + " " + m.version()).toList()));
		for (String problem : PROBLEMS) LOG.warn("Heldix Loader: {}", problem);
	}

	/** Ruft die Einstiegspunkte aller Mods auf. Ein Fehler beendet das Spiel mit einem klaren Crash-Report. */
	static synchronized void initMods() {
		if (initialized) return;
		initialized = true;
		for (LoadedMod mod : LOADED) {
			for (String entrypoint : mod.meta().clientEntrypoints()) {
				try {
					Object instance = Class.forName(entrypoint, true, ClassLoader.getSystemClassLoader()).getDeclaredConstructor().newInstance();
					if (!(instance instanceof HeldixModInitializer initializer)) {
						throw new IllegalStateException(entrypoint + " implementiert HeldixModInitializer nicht");
					}
					initializer.onInitialize();
				} catch (Throwable t) {
					throw new RuntimeException("Heldix Loader: Mod \"" + mod.info().name() + "\" konnte nicht gestartet werden (" + entrypoint + ")", t);
				}
			}
			LOG.info("Heldix Loader: Mod {} {} geladen", mod.info().name(), mod.info().version());
		}
	}

	public static void problem(String message) {
		PROBLEMS.add(message);
		if (booted && initialized) LOG.warn("Heldix Loader: {}", message);
	}

	public static String version() {
		return version;
	}

	public static String minecraftVersion() {
		return minecraftVersion;
	}

	public static Path gameDir() {
		return gameDir;
	}

	public static Path modsDir() {
		return modsDir;
	}

	public static List<ModInfo> mods() {
		return Collections.unmodifiableList(MODS);
	}

	public static List<String> problems() {
		return Collections.unmodifiableList(PROBLEMS);
	}

	static String describe(Throwable t) {
		Throwable root = t;
		while (root.getCause() != null && root.getCause() != root) root = root.getCause();
		return root.getMessage() != null ? root.getMessage() : root.getClass().getSimpleName();
	}

	private static String readLoaderVersion() {
		try (InputStream in = LoaderCore.class.getResourceAsStream("/heldix-loader.properties")) {
			if (in == null) return "dev";
			Properties properties = new Properties();
			properties.load(in);
			return properties.getProperty("version", "dev");
		} catch (Exception e) {
			return "dev";
		}
	}

	/** Spielordner: -Dheldix.gameDir, sonst Agent-Argument gameDir=…, sonst --gameDir aus der Kommandozeile, sonst Arbeitsordner. */
	private static Path resolveGameDir(String agentArgs) {
		String value = System.getProperty("heldix.gameDir");
		if ((value == null || value.isBlank()) && agentArgs != null && agentArgs.startsWith("gameDir=")) {
			value = agentArgs.substring("gameDir=".length());
		}
		if (value == null || value.isBlank()) {
			String command = System.getProperty("sun.java.command", "");
			String[] parts = command.split(" ");
			for (int i = 0; i < parts.length - 1; i++) {
				if (parts[i].equals("--gameDir")) value = parts[i + 1];
			}
		}
		Path dir = value == null || value.isBlank() ? Path.of("") : Path.of(value);
		return dir.toAbsolutePath().normalize();
	}

	/** Liest die Version aus der version.json in der Minecraft-JAR. */
	private static String detectMinecraftVersion() {
		try {
			String main = "net/minecraft/client/main/Main.class";
			URL mainClass = ClassLoader.getSystemResource(main);
			if (mainClass == null) return "unbekannt";
			URL versionJson = URI.create(mainClass.toString().replace(main, "version.json")).toURL();
			try (InputStreamReader reader = new InputStreamReader(versionJson.openStream(), StandardCharsets.UTF_8)) {
				JsonObject json = JsonParser.parseReader(reader).getAsJsonObject();
				return json.has("id") ? json.get("id").getAsString() : json.get("name").getAsString();
			}
		} catch (Exception e) {
			LOG.warn("Minecraft-Version nicht erkannt", e);
			return "unbekannt";
		}
	}

	/** -Dheldix.dumpClasses=<Ordner>: veränderte Klassen zur Kontrolle dort speichern. */
	private static Path dumpDir() {
		String value = System.getProperty("heldix.dumpClasses");
		return value == null || value.isBlank() ? null : Path.of(value).toAbsolutePath();
	}
}
