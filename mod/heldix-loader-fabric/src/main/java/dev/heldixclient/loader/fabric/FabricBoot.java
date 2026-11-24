package dev.heldixclient.loader.fabric;

import dev.heldixclient.loader.impl.LoaderCore;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.entrypoint.PreLaunchEntrypoint;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Startet den Heldix Loader in Fabric – vor Minecraft (preLaunch). Heldix-Mods sind JARs mit heldix.mod.json
 * und zusätzlich einer fabric.mod.json; Fabric hat sie deshalb schon geladen, hier werden sie nur eingesammelt.
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
		LoaderCore.bootEmbedded("fabric", fabric.getGameDir(), minecraft, jars, FabricBoot.class.getClassLoader());
		booted = true;
		reportMissingTargets();
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
