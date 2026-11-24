package dev.heldixclient.loader.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Inhalt der heldix.mod.json einer Mod.
 * <pre>{@code
 * {
 *   "id": "meinemod",
 *   "name": "Meine Mod",
 *   "version": "1.0.0",
 *   "description": "…",
 *   "authors": ["Ich"],
 *   "minecraft": "26.3",
 *   "loader": ">=2.0.0",
 *   "entrypoints": { "client": ["meine.mod.MeineMod"] },
 *   "transformers": ["meine.mod.MeinTransformer"],
 *   "depends": { "heldixclient": ">=0.6.0" }
 * }
 * }</pre>
 */
final class ModMetadata {
	String id;
	String name;
	String version = "0.0.0";
	String description = "";
	List<String> authors = List.of();
	/** Unterstützte Minecraft-Version(en), z. B. "26.3", "26.x" oder ">=26.1" */
	String minecraft;
	/** Benötigte Loader-Version, z. B. ">=2.0.0" */
	String loader;
	Map<String, List<String>> entrypoints = new LinkedHashMap<>();
	List<String> transformers = List.of();
	Map<String, String> depends = new LinkedHashMap<>();

	ModMetadata() {
	}

	String displayName() {
		return name != null && !name.isBlank() ? name : id;
	}

	List<String> clientEntrypoints() {
		if (entrypoints == null) return List.of();
		List<String> client = entrypoints.get("client");
		return client != null ? client : List.of();
	}

	List<String> transformers() {
		return transformers != null ? transformers : List.of();
	}

	Map<String, String> depends() {
		return depends != null ? depends : Map.of();
	}
}
