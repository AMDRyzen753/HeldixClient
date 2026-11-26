package dev.heldixclient.addon;

import dev.heldixclient.loader.api.AddonManifest;

import java.util.List;

/**
 * Inhalt der heldix.addon.json eines Addons (Version 2). Gelesen und geprüft wird sie vom Heldix Loader
 * ({@link AddonManifest}, gleiche Regeln für Loader und HeldixClient); hier stehen die Werte für HeldixClient.
 */
public final class AddonMetadata {
	public String id;
	public String name;
	public String version = "?";
	public String description = "";
	public List<String> authors = List.of();
	/** HeldixAddon (Heldix-API); ab Version 2 optional */
	public String entrypoint;
	public int api;
	/** Version 2: HeldixModInitializer (Loader-API), läuft beim Spielstart */
	public String clientEntrypoint;
	/** Version 2: ClassTransformer (Loader-API) */
	public List<String> transformers = List.of();
	/** Version 2: Minecraft-Versionen (Pflicht mit clientEntrypoint oder transformers) */
	public List<String> minecraft = List.of();
	/** Version 2: benötigte Version des Heldix Loaders, z. B. ">=2.4.0" */
	public String loader;
	/** das gelesene Manifest (null bei Addons, die nur im Test angelegt werden) */
	AddonManifest manifest;

	public AddonMetadata() {
	}

	static AddonMetadata of(AddonManifest manifest) {
		AddonMetadata meta = new AddonMetadata();
		meta.manifest = manifest;
		meta.id = manifest.id();
		meta.name = manifest.name();
		meta.version = manifest.version();
		meta.description = manifest.description();
		meta.authors = manifest.authors();
		meta.entrypoint = manifest.entrypoint();
		meta.api = manifest.api();
		meta.clientEntrypoint = manifest.clientEntrypoint();
		meta.transformers = manifest.transformers();
		meta.minecraft = manifest.minecraft();
		meta.loader = manifest.loader();
		return meta;
	}

	public String displayName() {
		return name != null && !name.isBlank() ? name : id;
	}

	/** Greift das Addon direkt in Minecraft ein (clientEntrypoint oder transformers)? Dann lädt es der Heldix Loader. */
	public boolean minecraftAccess() {
		return clientEntrypoint != null || (transformers != null && !transformers.isEmpty());
	}

	/** "minecraft" oder "api" (abgeleitet, steht nicht im Manifest) */
	public String access() {
		return minecraftAccess() ? AddonManifest.ACCESS_MINECRAFT : AddonManifest.ACCESS_API;
	}

	/** Fehler im Manifest, auf Deutsch (leer = in Ordnung) */
	public List<String> problems() {
		return manifest != null ? manifest.problems() : List.of();
	}

	/** Passt die Angabe "loader" zum laufenden Heldix Loader? null = ja, sonst der Grund */
	public String loaderProblem(String installed) {
		return AddonManifest.loaderProblem(loader, installed);
	}
}
