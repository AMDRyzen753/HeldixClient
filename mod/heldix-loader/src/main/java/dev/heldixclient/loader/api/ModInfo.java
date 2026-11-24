package dev.heldixclient.loader.api;

import java.nio.file.Path;
import java.util.List;

/** Beschreibung einer geladenen Heldix-Mod (aus ihrer heldix.mod.json). */
public record ModInfo(String id, String name, String version, String description, List<String> authors, Path file) {
	public ModInfo {
		authors = List.copyOf(authors);
	}
}
