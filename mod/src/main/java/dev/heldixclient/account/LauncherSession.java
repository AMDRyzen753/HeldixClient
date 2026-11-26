package dev.heldixclient.account;

import com.google.gson.JsonObject;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Sitzung vom Launcher (accounts.session): alles, was Minecraft für {@code User} braucht. Nie ein Refresh-Token.
 * {@link #toString()} lässt das Zugangs-Token weg – Sitzungen dürfen nie im Log landen.
 *
 * @param userType "msa" (Microsoft) oder "legacy" (Offline-Konto, nur Entwicklung; Token "0")
 */
public record LauncherSession(String name, UUID uuid, String accessToken, String xuid, String userType) {
	private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_]{1,16}");
	private static final Pattern COMPACT_UUID = Pattern.compile("[0-9a-fA-F]{32}");
	private static final Pattern TOKEN = Pattern.compile("[\\x21-\\x7e]{1,8192}");
	private static final Pattern XUID = Pattern.compile("\\d{1,20}");

	public boolean offline() {
		return "legacy".equals(userType);
	}

	@Override
	public String toString() {
		return "LauncherSession[name=" + name + ", uuid=" + uuid + ", userType=" + userType + "]";
	}

	/** Antwort prüfen: muss zum angefragten Konto gehören */
	static LauncherSession fromJson(JsonObject json, LauncherAccount expected) throws LauncherException {
		String name = LauncherAccount.string(json, "name");
		String uuid = LauncherAccount.string(json, "uuid");
		String token = LauncherAccount.string(json, "accessToken");
		String userType = LauncherAccount.string(json, "userType");
		String xuid = LauncherAccount.string(json, "xuid");
		if (name == null || !NAME.matcher(name).matches() || uuid == null || !COMPACT_UUID.matcher(uuid).matches()
				|| token == null || !TOKEN.matcher(token).matches() || (!"msa".equals(userType) && !"legacy".equals(userType))) {
			throw new LauncherException("bad_response", "Der Launcher hat eine unvollständige Sitzung geschickt.");
		}
		UUID id = LauncherAccount.parseUuid(uuid);
		if (!id.equals(expected.uuid())) throw new LauncherException("bad_response", "Die Sitzung passt nicht zu diesem Konto.");
		if ("legacy".equals(userType) && !expected.offline()) throw new LauncherException("bad_response", "Die Sitzung passt nicht zu diesem Konto.");
		return new LauncherSession(name, id, token, xuid != null && XUID.matcher(xuid).matches() ? xuid : null, userType);
	}
}
