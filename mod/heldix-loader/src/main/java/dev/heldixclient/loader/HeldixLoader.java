package dev.heldixclient.loader;

import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.loader.impl.LoaderCore;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

/**
 * Öffentlicher Zugang zum Heldix Loader für Mods: Version, Ordner und geladene Mods.
 *
 * <p>Der Heldix Loader ist ein eigenständiger Mod-Loader. Er startet als Java-Agent vor
 * Minecraft, verändert Minecraft-Klassen beim Laden (ASM) und lädt Heldix-Mods
 * (Datei {@code heldix.mod.json} in der JAR) aus dem Ordner {@code mods/}.
 */
public final class HeldixLoader {
	private HeldixLoader() {
	}

	/** Version des Loaders, z. B. "2.0.0". */
	public static String version() {
		return LoaderCore.version();
	}

	/** Minecraft-Version des laufenden Spiels, z. B. "26.3". */
	public static String minecraftVersion() {
		return LoaderCore.minecraftVersion();
	}

	/** Wie der Loader läuft: "heldix" (eigenständig, Java-Agent) oder "fabric" (als Fabric-Mod). */
	public static String platform() {
		return LoaderCore.platform();
	}

	/** Spielordner der Instanz. */
	public static Path gameDir() {
		return LoaderCore.gameDir();
	}

	/** Ordner für Einstellungen von Mods ({@code <Spielordner>/config}). */
	public static Path configDir() {
		return LoaderCore.gameDir().resolve("config");
	}

	/** Ordner, aus dem die Mods geladen werden ({@code <Spielordner>/mods}). */
	public static Path modsDir() {
		return LoaderCore.modsDir();
	}

	/** Alle geladenen Mods (ohne Minecraft und den Loader selbst). */
	public static List<ModInfo> mods() {
		return LoaderCore.mods();
	}

	public static Optional<ModInfo> mod(String id) {
		return LoaderCore.mods().stream().filter(m -> m.id().equals(id)).findFirst();
	}

	public static boolean isLoaded(String id) {
		return mod(id).isPresent();
	}

	/**
	 * Probleme beim Start: übersprungene Mods (z. B. Fabric-Mods, falsche Minecraft-Version,
	 * fehlende Abhängigkeiten) und fehlgeschlagene Klassen-Patches. Leer, wenn alles geklappt hat.
	 */
	public static List<String> problems() {
		return LoaderCore.problems();
	}
}
