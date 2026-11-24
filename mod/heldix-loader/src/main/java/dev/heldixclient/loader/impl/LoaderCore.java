package dev.heldixclient.loader.impl;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.loader.api.HeldixModInitializer;
import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.loader.api.transform.ClassTransformer;
import org.objectweb.asm.tree.ClassNode;
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
import java.util.function.Predicate;
import java.util.jar.JarFile;

/**
 * Zustand und Startablauf des Heldix Loaders. Er startet auf zwei Wegen:
 *
 * <ul>
 *   <li><b>Eigenständig</b> ({@link #boot}): als Java-Agent noch vor Minecraft. Mods im Ordner mods/ finden und prüfen,
 *       ihre JARs auf den Classpath legen und alle Klassen-Transformer über {@link Instrumentation} anmelden.</li>
 *   <li><b>In Fabric</b> ({@link #bootEmbedded}): als Fabric-Mod "heldixloader". Fabric lädt die JARs selbst;
 *       die Transformer laufen über ein Mixin-Plugin ({@link #transformEmbedded}), nachdem Fabric-Mixins angewendet sind.</li>
 * </ul>
 *
 * Danach ruft der veränderte Minecraft-Konstruktor {@link #initMods} auf (eingefügt durch {@link BuiltinPatches}).
 */
public final class LoaderCore {
	public static final String ID = "heldixloader";
	public static final Logger LOG = LoggerFactory.getLogger("Heldix Loader");

	private record LoadedMod(ModMetadata meta, ModInfo info) {
	}

	private static String version = "dev";
	private static String minecraftVersion = "unbekannt";
	/** "heldix" (eigenständig) oder "fabric" */
	private static String platform = "heldix";
	private static ClassLoader modClassLoader = ClassLoader.getSystemClassLoader();
	private static Path gameDir = Path.of("").toAbsolutePath();
	private static Path modsDir = gameDir.resolve("mods");
	private static final List<LoadedMod> LOADED = new ArrayList<>();
	private static final List<ModInfo> MODS = new ArrayList<>();
	private static final List<String> PROBLEMS = new CopyOnWriteArrayList<>();
	/** Mods mit eigenen Ressourcen (pack.mcmeta in der JAR) – nur eigenständig, in Fabric lädt Fabric API sie */
	private static final List<ModResourcePacks.ModPack> RESOURCE_PACKS = new ArrayList<>();
	/** Transformer, wenn der Loader in Fabric läuft */
	private static TransformerChain embeddedChain;
	private static boolean booted;
	private static boolean initialized;

	private LoaderCore() {
	}

	/** Eigenständiger Start als Java-Agent. */
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
		register(found, jar -> {
			try {
				instrumentation.appendToSystemClassLoaderSearch(new JarFile(jar.toFile()));
				return true;
			} catch (Exception e) {
				return false;
			}
		}, chain);
		instrumentation.addTransformer(chain, false);
		logSummary();
	}

	/**
	 * Start als Fabric-Mod: Fabric hat die JARs schon auf seinem Classpath. {@code jars} sind die JARs aller
	 * Fabric-Mods mit heldix.mod.json, {@code loader} ist Fabrics Classloader.
	 */
	public static synchronized void bootEmbedded(String platformName, Path game, String minecraft, List<Path> jars, ClassLoader loader) {
		if (booted) return;
		booted = true;
		platform = platformName;
		modClassLoader = loader;
		version = readLoaderVersion();
		gameDir = game.toAbsolutePath().normalize();
		modsDir = gameDir.resolve("mods");
		minecraftVersion = minecraft;
		LOG.info("Heldix Loader {} startet in {} (Minecraft {}, Java {})", version, platformName, minecraftVersion, Runtime.version().feature());

		TransformerChain chain = new TransformerChain(dumpDir());
		chain.add(new BuiltinPatches(), ID);
		register(ModDiscovery.read(jars, LoaderCore::problem), jar -> true, chain);
		embeddedChain = chain;
		logSummary();
	}

	/** In Fabric: Transformer auf eine Klasse anwenden (aus dem Mixin-Plugin, nach allen Mixins). */
	public static void transformEmbedded(String internalName, ClassNode node) {
		TransformerChain chain = embeddedChain;
		if (chain != null) chain.apply(internalName, node);
	}

	/** Klassennamen (intern, mit /), die Transformer verändern wollen. */
	public static java.util.Set<String> embeddedTargets() {
		return embeddedChain == null ? java.util.Set.of() : embeddedChain.targets();
	}

	/** Gemeinsam für beide Starts: Mods prüfen, registrieren, Übersetzungen lesen, Transformer laden. */
	private static void register(List<ModDiscovery.Candidate> found, Predicate<Path> addToClasspath, TransformerChain chain) {
		for (ModDiscovery.Candidate candidate : ModDiscovery.resolve(found, version, minecraftVersion, LoaderCore::problem)) {
			ModMetadata meta = candidate.meta();
			if (!addToClasspath.test(candidate.file())) {
				problem(meta.displayName() + ": JAR konnte nicht geladen werden");
				continue;
			}
			ModInfo info = new ModInfo(meta.id, meta.displayName(), meta.version, meta.description == null ? "" : meta.description,
					meta.authors == null ? List.of() : meta.authors, candidate.file());
			LOADED.add(new LoadedMod(meta, info));
			MODS.add(info);
			ModTranslations.load(candidate.file());
			if (isStandalone() && hasPackMeta(candidate.file())) {
				RESOURCE_PACKS.add(new ModResourcePacks.ModPack(meta.id, meta.displayName(), candidate.file()));
			}
		}

		// Transformer der Mods (nach denen des Loaders)
		for (LoadedMod mod : LOADED) {
			for (String name : mod.meta().transformers()) {
				try {
					Object instance = Class.forName(name, true, modClassLoader).getDeclaredConstructor().newInstance();
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
	}

	private static void logSummary() {
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
					Object instance = Class.forName(entrypoint, true, modClassLoader).getDeclaredConstructor().newInstance();
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

	public static String platform() {
		return platform;
	}

	static boolean isStandalone() {
		return "heldix".equals(platform);
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

	static List<ModResourcePacks.ModPack> resourcePacks() {
		return Collections.unmodifiableList(RESOURCE_PACKS);
	}

	private static boolean hasPackMeta(Path jar) {
		try (JarFile archive = new JarFile(jar.toFile())) {
			return archive.getJarEntry("pack.mcmeta") != null;
		} catch (Exception e) {
			return false;
		}
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
