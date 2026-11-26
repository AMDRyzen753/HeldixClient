package dev.heldixclient.loader.fabric;

import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.loader.impl.LoaderCore;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.entrypoint.PreLaunchEntrypoint;
import net.fabricmc.loader.api.metadata.ModMetadata;
import net.fabricmc.loader.api.metadata.ModOrigin;
import net.fabricmc.loader.api.metadata.Person;
import net.fabricmc.loader.impl.launch.FabricLauncherBase;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Startet den Heldix Loader in Fabric – vor Minecraft (preLaunch). Heldix-Mods sind JARs mit heldix.mod.json
 * und zusätzlich einer fabric.mod.json; Fabric hat sie deshalb schon geladen, hier werden sie nur eingesammelt.
 *
 * <p>Heldix-Addons mit Zugriff auf Minecraft (heldix-addons/) kennt Fabric nicht: Der Loader legt ihre JAR auf Fabrics
 * Classpath, aber nur, wenn alle Ziel-Klassen ihrer Transformer in {@link Targets} stehen (nur dort laufen
 * Heldix-Transformer in Fabric). Sonst bleibt das Addon aus („Läuft nur in Heldix-Instanzen“).
 */
public final class FabricBoot implements PreLaunchEntrypoint {
	private static volatile boolean booted;

	public static boolean isBooted() {
		return booted;
	}

	@Override
	public void onPreLaunch() {
		boot();
	}

	static synchronized void boot() {
		if (booted) return;
		FabricLoader fabric = FabricLoader.getInstance();
		String minecraft = fabric.getModContainer("minecraft")
				.map(mod -> mod.getMetadata().getVersion().getFriendlyString())
				.orElse("unbekannt");
		List<Path> jars = new ArrayList<>();
		for (ModContainer mod : fabric.getAllMods()) {
			if (mod.findPath("heldix.mod.json").isEmpty()) continue;
			for (Path path : mod.getOrigin().getPaths()) {
				if (Files.isRegularFile(path)) jars.add(path);
			}
		}
		Set<String> supported = new HashSet<>();
		for (String target : Targets.ALL) supported.add(target.replace('.', '/'));
		LoaderCore.bootEmbedded("fabric", fabric.getGameDir(), minecraft, jars, FabricBoot.class.getClassLoader(), jar -> {
			try {
				// Knot (Fabrics Classloader) lädt dann auch die Klassen des Addons – Minecraft-Klassen sehen so seine Hooks
				FabricLauncherBase.getLauncher().addToClassPath(jar);
				return true;
			} catch (Throwable t) {
				LoaderCore.LOG.error("Heldix Loader: {} nicht auf den Classpath gelegt", jar, t);
				return false;
			}
		}, Set.copyOf(supported));
		try {
			LoaderCore.setPlatformMods(fabricMods(fabric));
		} catch (Throwable t) {
			LoaderCore.LOG.warn("Heldix Loader: Fabric-Mods nicht lesbar", t);
		}
		booted = true;
		reportMissingTargets();
	}

	/** Fabric-Mods aus dem mods-Ordner (ohne eingebettete, ohne Heldix-Mods und ohne den Heldix Loader), nur zur Anzeige */
	private static List<ModInfo> fabricMods(FabricLoader fabric) {
		Path modsDir = fabric.getGameDir().resolve("mods").toAbsolutePath().normalize();
		List<ModInfo> list = new ArrayList<>();
		for (ModContainer mod : fabric.getAllMods()) {
			if (mod.getContainingMod().isPresent() || mod.getOrigin().getKind() != ModOrigin.Kind.PATH) continue;
			if (mod.findPath("heldix.mod.json").isPresent()) continue;
			ModMetadata meta = mod.getMetadata();
			if (LoaderCore.ID.equals(meta.getId())) continue;
			Path file = mod.getOrigin().getPaths().stream().map(p -> p.toAbsolutePath().normalize())
					.filter(p -> p.startsWith(modsDir)).findFirst().orElse(null);
			if (file == null) continue;
			List<String> authors = meta.getAuthors().stream().map(Person::getName).toList();
			list.add(new ModInfo(meta.getId(), meta.getName() == null || meta.getName().isBlank() ? meta.getId() : meta.getName(),
					meta.getVersion().getFriendlyString(), meta.getDescription() == null ? "" : meta.getDescription(), authors, file));
		}
		list.sort(Comparator.comparing(m -> m.name().toLowerCase(java.util.Locale.ROOT)));
		return list;
	}

	/** Klassen, die Heldix-Transformer verändern wollen, für die aber kein Mixin-Ziel eingetragen ist. */
	private static void reportMissingTargets() {
		Set<String> covered = new HashSet<>();
		for (String target : Targets.ALL) covered.add(target.replace('.', '/'));
		for (String target : LoaderCore.embeddedTargets()) {
			if (!covered.contains(target)) {
				LoaderCore.problem("In Fabric kann " + target.replace('/', '.') + " nicht verändert werden (fehlt in TransformTargets)");
			}
		}
	}
}
