package dev.heldixclient.loader.impl;

import net.minecraft.network.chat.Component;
import net.minecraft.server.packs.FilePackResources;
import net.minecraft.server.packs.PackLocationInfo;
import net.minecraft.server.packs.PackSelectionConfig;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.Pack;
import net.minecraft.server.packs.repository.PackSource;
import net.minecraft.server.packs.repository.RepositorySource;

import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;

/**
 * Ressourcen aus Mods: Jede Mod-JAR mit einer pack.mcmeta wird als eingebautes Ressourcenpaket
 * geladen (Texturen, Sounds, Shader, Post-Effekte, Sprachdateien …). Die Pakete sind immer aktiv
 * und liegen unter den Ressourcenpaketen des Spielers – der kann Mod-Inhalte also weiter überschreiben.
 */
final class ModResourcePacks implements RepositorySource {
	record ModPack(String id, String name, Path file) {
	}

	private final List<ModPack> packs;

	ModResourcePacks(List<ModPack> packs) {
		this.packs = List.copyOf(packs);
	}

	@Override
	public void loadPacks(Consumer<Pack> consumer) {
		for (ModPack mod : packs) {
			try {
				PackLocationInfo location = new PackLocationInfo("heldix:" + mod.id(), Component.literal(mod.name()), PackSource.BUILT_IN, Optional.empty());
				Pack pack = Pack.readMetaAndCreate(location, new FilePackResources.FileResourcesSupplier(mod.file()), PackType.CLIENT_RESOURCES,
						new PackSelectionConfig(true, Pack.Position.BOTTOM, false));
				if (pack != null) consumer.accept(pack);
				else LoaderCore.problem(mod.name() + ": pack.mcmeta ist ungültig – Ressourcen der Mod fehlen");
			} catch (Throwable t) {
				LoaderCore.problem(mod.name() + ": Ressourcen konnten nicht geladen werden (" + LoaderCore.describe(t) + ")");
			}
		}
	}

	/** Hängt die Mod-Ressourcen an die Paketquellen von Minecraft an. */
	static RepositorySource[] append(RepositorySource[] vanilla, List<ModPack> packs) {
		if (packs.isEmpty()) return vanilla;
		RepositorySource[] all = Arrays.copyOf(vanilla, vanilla.length + 1);
		all[vanilla.length] = new ModResourcePacks(packs);
		return all;
	}
}
