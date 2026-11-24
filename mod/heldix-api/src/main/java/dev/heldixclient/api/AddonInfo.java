package dev.heldixclient.api;

import java.util.List;

/** Metadaten eines Addons aus seiner heldix.addon.json. */
public record AddonInfo(String id, String name, String version, String description, List<String> authors) {
}
