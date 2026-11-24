package dev.heldixclient.addon;

import java.util.List;

/** Inhalt der heldix.addon.json eines Addons (wird von Gson befüllt). */
public final class AddonMetadata {
	public String id;
	public String name;
	public String version = "?";
	public String description = "";
	public List<String> authors = List.of();
	public String entrypoint;
	public int api;

	public String displayName() {
		return name != null && !name.isBlank() ? name : id;
	}
}
