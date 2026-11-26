package dev.heldixclient.account;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Ein Konto aus dem Launcher (accounts.list) – ohne Tokens.
 *
 * @param id       Konto-ID des Launchers (UUID-Text), für accounts.session und accounts.setActive
 * @param type     "microsoft" oder "offline" (Offline-Konten nur mit der Entwicklungsversion des Launchers)
 * @param active   im Launcher aktiv (damit startet der nächste Start) – nicht unbedingt das Konto im Spiel
 * @param skinUrl  Adresse des Skins laut Launcher, sonst null
 */
public record LauncherAccount(String id, String name, UUID uuid, String type, boolean active, String skinUrl) {
	private static final Pattern ID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
	private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_]{1,16}");
	private static final Pattern COMPACT_UUID = Pattern.compile("[0-9a-fA-F]{32}");

	public boolean offline() {
		return "offline".equals(type);
	}

	/** Eintrag aus der Antwort des Launchers prüfen; unbrauchbare Einträge: leer */
	static Optional<LauncherAccount> fromJson(JsonElement element) {
		if (element == null || !element.isJsonObject()) return Optional.empty();
		JsonObject json = element.getAsJsonObject();
		String id = string(json, "id");
		String name = string(json, "name");
		String uuid = string(json, "uuid");
		String type = string(json, "type");
		if (id == null || !ID.matcher(id).matches()) return Optional.empty();
		if (name == null || !NAME.matcher(name).matches()) return Optional.empty();
		if (uuid == null || !COMPACT_UUID.matcher(uuid).matches()) return Optional.empty();
		if (!"microsoft".equals(type) && !"offline".equals(type)) return Optional.empty();
		JsonElement active = json.get("active");
		boolean isActive = active != null && active.isJsonPrimitive() && active.getAsJsonPrimitive().isBoolean() && active.getAsBoolean();
		String skin = string(json, "skinUrl");
		if (skin != null && !(skin.startsWith("https://") || skin.startsWith("http://"))) skin = null;
		return Optional.of(new LauncherAccount(id.toLowerCase(), name, parseUuid(uuid), type, isActive, skin));
	}

	static UUID parseUuid(String compact) {
		String hex = compact.toLowerCase();
		return UUID.fromString(hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" + hex.substring(16, 20) + "-" + hex.substring(20));
	}

	static String string(JsonObject json, String key) {
		JsonElement value = json.get(key);
		return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString() ? value.getAsString() : null;
	}
}
