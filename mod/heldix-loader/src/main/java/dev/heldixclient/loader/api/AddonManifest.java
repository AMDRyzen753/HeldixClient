package dev.heldixclient.loader.api;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.heldixclient.loader.impl.Versions;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.regex.Pattern;

/**
 * Inhalt der {@code heldix.addon.json} eines Addons (Version 2, abwärtskompatibel zu Version 1).
 *
 * <pre>{@code
 * {
 *   "id": "mein-addon", "name": "Mein Addon", "version": "1.0.0", "description": "…", "authors": ["Du"],
 *   "entrypoint": "de.du.MeinAddon",              // HeldixAddon (Heldix-API), optional
 *   "api": 4,                                     // Heldix-API-Stufe, Pflicht mit "entrypoint"
 *   "clientEntrypoint": "de.du.MeinStart",        // HeldixModInitializer (Loader-API), optional
 *   "transformers": ["de.du.MeinTransformer"],    // ClassTransformer (Loader-API), optional
 *   "minecraft": ["26.3"],                        // Pflicht mit "clientEntrypoint" oder "transformers"
 *   "loader": ">=2.4.0",                          // Mindestversion des Heldix Loaders, optional
 *   "loaders": ["heldix", "fabric"]               // wo es laufen soll, optional (Hinweis; fehlt = überall, wo es geht)
 * }
 * }</pre>
 *
 * Mindestens eines von {@code entrypoint}, {@code clientEntrypoint} und {@code transformers} muss da sein. Der
 * <b>Zugriff</b> steht nicht im Manifest, er folgt daraus: {@code minecraft}, sobald {@code clientEntrypoint} oder
 * {@code transformers} gesetzt sind, sonst {@code api}. Ein Addon mit Zugriff {@code minecraft} lädt der Heldix Loader
 * beim Start (wie eine Heldix-Mod), seinen {@code entrypoint} danach HeldixClient über denselben Classloader.
 *
 * <p>Fehler im Manifest sammelt {@link #problems()} als deutsche Sätze; gelesen wird trotzdem so viel wie möglich.
 */
public final class AddonManifest {
	public static final String FILE = "heldix.addon.json";
	/** Zugriff nur auf die Heldix-API */
	public static final String ACCESS_API = "api";
	/** Zugriff auf Minecraft (eigene Transformer und/oder clientEntrypoint) */
	public static final String ACCESS_MINECRAFT = "minecraft";

	private static final Pattern ID = Pattern.compile("[a-z0-9_-]+");
	private static final List<String> LOADERS = List.of("heldix", "fabric");
	private static final Pattern CLASS_NAME = Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*");

	private String id;
	private String name;
	private String version = "?";
	private String description = "";
	private List<String> authors = List.of();
	private String entrypoint;
	private int api;
	private String clientEntrypoint;
	private List<String> transformers = List.of();
	private List<String> minecraft = List.of();
	private String loader;
	private List<String> loaders = List.of();
	private final List<String> problems = new ArrayList<>();

	private AddonManifest() {
	}

	/** Liest die heldix.addon.json einer JAR. Fehlt sie oder ist die JAR nicht lesbar, gibt es eine IOException. */
	public static AddonManifest read(Path jar) throws IOException {
		try (JarFile file = new JarFile(jar.toFile())) {
			JarEntry entry = file.getJarEntry(FILE);
			if (entry == null) throw new IOException(FILE + " fehlt in der JAR");
			try (InputStream in = file.getInputStream(entry)) {
				return parse(new String(in.readAllBytes(), StandardCharsets.UTF_8));
			}
		}
	}

	/** Liest ein Manifest aus Text. Wirft nie; Fehler stehen in {@link #problems()}. */
	public static AddonManifest parse(String json) {
		AddonManifest manifest = new AddonManifest();
		JsonObject object;
		try {
			JsonElement root = JsonParser.parseString(json == null ? "" : json);
			if (!root.isJsonObject()) {
				manifest.problems.add(FILE + " ist leer oder kein JSON-Objekt");
				return manifest;
			}
			object = root.getAsJsonObject();
		} catch (RuntimeException e) {
			manifest.problems.add(FILE + " ist kein gültiges JSON (" + e.getMessage() + ")");
			return manifest;
		}
		manifest.read(object);
		manifest.validate();
		return manifest;
	}

	private void read(JsonObject object) {
		id = text(object, "id");
		name = text(object, "name");
		String v = text(object, "version");
		if (v != null) version = v;
		String d = text(object, "description");
		if (d != null) description = d;
		authors = list(object, "authors", false);
		entrypoint = blankToNull(text(object, "entrypoint"));
		if (object.has("api")) {
			JsonElement value = object.get("api");
			if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) api = value.getAsInt();
			else problems.add("„api“ muss eine Zahl sein (die Stufe der Heldix-API, z. B. 4)");
		}
		clientEntrypoint = blankToNull(text(object, "clientEntrypoint"));
		transformers = list(object, "transformers", false);
		// "minecraft": Liste von Versionen; eine einzelne Angabe als Text geht auch ("26.3")
		minecraft = list(object, "minecraft", true);
		loader = blankToNull(text(object, "loader"));
		loaders = loaders(object);
	}

	/** "loaders": nicht leer, nur "heldix" und "fabric", jedes höchstens einmal */
	private List<String> loaders(JsonObject object) {
		if (!object.has("loaders") || object.get("loaders").isJsonNull()) return List.of();
		JsonElement value = object.get("loaders");
		if (!value.isJsonArray()) {
			problems.add("„loaders“ muss eine Liste sein, z. B. [\"heldix\", \"fabric\"]");
			return List.of();
		}
		List<String> result = new ArrayList<>();
		for (JsonElement element : (JsonArray) value) {
			String name = element instanceof JsonPrimitive primitive && primitive.isString() ? primitive.getAsString().strip() : null;
			if (name == null || !LOADERS.contains(name)) {
				problems.add("„loaders“ darf nur „heldix“ und „fabric“ enthalten");
				return List.of();
			}
			if (result.contains(name)) {
				problems.add("„loaders“ enthält „" + name + "“ doppelt");
				return List.of();
			}
			result.add(name);
		}
		if (result.isEmpty()) problems.add("„loaders“ darf nicht leer sein (weglassen = überall, wo es geht)");
		return List.copyOf(result);
	}

	private void validate() {
		if (entrypoint == null && clientEntrypoint == null && transformers.isEmpty()) {
			problems.add("Kein Einstiegspunkt: „entrypoint“ (Heldix-API), „clientEntrypoint“ oder „transformers“ fehlt");
		}
		className("entrypoint", entrypoint);
		className("clientEntrypoint", clientEntrypoint);
		for (String transformer : transformers) className("transformers", transformer);
		if (minecraftAccess() && minecraft.isEmpty()) {
			problems.add("„minecraft“ fehlt – ein Addon mit „clientEntrypoint“ oder „transformers“ muss angeben, für welche "
					+ "Minecraft-Versionen es gebaut ist (z. B. \"minecraft\": [\"26.3\"])");
		}
	}

	private void className(String field, String value) {
		if (value != null && !CLASS_NAME.matcher(value).matches()) {
			problems.add("„" + field + "“ ist kein gültiger Klassenname: „" + value + "“");
		}
	}

	private String text(JsonObject object, String key) {
		if (!object.has(key) || object.get(key).isJsonNull()) return null;
		JsonElement value = object.get(key);
		if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) return value.getAsString();
		problems.add("„" + key + "“ muss ein Text sein");
		return null;
	}

	private List<String> list(JsonObject object, String key, boolean singleAllowed) {
		if (!object.has(key) || object.get(key).isJsonNull()) return List.of();
		JsonElement value = object.get(key);
		if (singleAllowed && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) {
			String single = value.getAsString().strip();
			return single.isEmpty() ? List.of() : List.of(single);
		}
		if (!value.isJsonArray()) {
			problems.add("„" + key + "“ muss eine Liste sein, z. B. [\"…\"]");
			return List.of();
		}
		Set<String> result = new LinkedHashSet<>();
		for (JsonElement element : (JsonArray) value) {
			if (element instanceof JsonPrimitive primitive && primitive.isString() && !primitive.getAsString().isBlank()) {
				result.add(primitive.getAsString().strip());
			} else {
				problems.add("„" + key + "“ darf nur Texte enthalten");
			}
		}
		return List.copyOf(result);
	}

	private static String blankToNull(String value) {
		return value == null || value.isBlank() ? null : value.strip();
	}

	// ======================================================================================
	// Werte
	// ======================================================================================

	/** ID des Addons (a-z, 0-9, _ und -), null wenn sie fehlt */
	public String id() {
		return id;
	}

	/** Ist die ID gültig? */
	public boolean validId() {
		return id != null && ID.matcher(id).matches();
	}

	public String name() {
		return name;
	}

	/** Name zur Anzeige: name, sonst id */
	public String displayName() {
		return name != null && !name.isBlank() ? name : id;
	}

	public String version() {
		return version;
	}

	public String description() {
		return description;
	}

	public List<String> authors() {
		return authors;
	}

	/** HeldixAddon-Klasse (Heldix-API), null = keine */
	public String entrypoint() {
		return entrypoint;
	}

	/** Stufe der Heldix-API (0 = nicht angegeben) */
	public int api() {
		return api;
	}

	/** HeldixModInitializer-Klasse (Loader-API), null = keine */
	public String clientEntrypoint() {
		return clientEntrypoint;
	}

	/** ClassTransformer-Klassen (Loader-API) */
	public List<String> transformers() {
		return transformers;
	}

	/** Minecraft-Versionen, für die das Addon gebaut ist (je Eintrag wie in heldix.mod.json, z. B. "26.3" oder "26.x") */
	public List<String> minecraft() {
		return minecraft;
	}

	/** Benötigte Version des Heldix Loaders, z. B. ">=2.4.0" (null = jede) */
	public String loader() {
		return loader;
	}

	/** Wo das Addon laufen soll: "heldix" und/oder "fabric" (leer = nicht angegeben, überall, wo es geht) */
	public List<String> loaders() {
		return loaders;
	}

	/** {@link #ACCESS_MINECRAFT}, wenn clientEntrypoint oder transformers gesetzt sind, sonst {@link #ACCESS_API} */
	public String access() {
		return minecraftAccess() ? ACCESS_MINECRAFT : ACCESS_API;
	}

	/** Greift das Addon direkt in Minecraft ein (eigene Transformer oder clientEntrypoint)? */
	public boolean minecraftAccess() {
		return clientEntrypoint != null || !transformers.isEmpty();
	}

	/** Fehler im Manifest (leer = in Ordnung) */
	public List<String> problems() {
		return Collections.unmodifiableList(problems);
	}

	// ======================================================================================
	// Passt es zum laufenden Spiel?
	// ======================================================================================

	/** Warum das Addon nicht zu dieser Minecraft-Version passt („Nur für Minecraft 26.3“), sonst null (leere Liste = jede Version). */
	public String minecraftProblem(String running) {
		return minecraftMatches(minecraft, running) ? null : "Nur für Minecraft " + versionList(minecraft);
	}

	/**
	 * Passt die laufende Minecraft-Version zu einer der Angaben? Jede Angabe ist eine genaue Version ({@code 26.3}, nicht
	 * {@code 26.3.1}) oder eine Regel wie in heldix.mod.json ({@code *}, {@code 26.x}, {@code >=26.2}, {@code 26.2 || 26.3}).
	 * Snapshots (z. B. {@code 26w14a}) passen nur genau. Leere Liste = jede Version. Gleiche Regeln wie im Launcher.
	 */
	public static boolean minecraftMatches(List<String> versions, String running) {
		if (versions == null || versions.isEmpty() || running == null) return true;
		boolean release = RELEASE.matcher(running).matches();
		for (String range : versions) {
			String spec = range.strip();
			if (spec.equals(running) || spec.equals("*")) return true;
			if (release && Versions.matches(running, spec)) return true;
		}
		return false;
	}

	/** „26.3“, „26.2 und 26.3“, „26.1, 26.2 und 26.3“ */
	public static String versionList(List<String> versions) {
		if (versions.size() <= 1) return versions.isEmpty() ? "" : versions.getFirst();
		return String.join(", ", versions.subList(0, versions.size() - 1)) + " und " + versions.getLast();
	}

	/**
	 * Schließt "loaders" die laufende Plattform ({@code heldix} oder {@code fabric}) aus? Dann „Läuft nur in
	 * Heldix-Instanzen“ bzw. „Läuft nur in Fabric-Instanzen“, sonst null.
	 */
	public String platformProblem(String platform) {
		return platformProblem(loaders, platform);
	}

	public static String platformProblem(List<String> loaders, String platform) {
		if (loaders == null || loaders.isEmpty() || platform == null || loaders.contains(platform)) return null;
		if (loaders.contains("heldix")) return "Läuft nur in Heldix-Instanzen";
		if (loaders.contains("fabric")) return "Läuft nur in Fabric-Instanzen";
		return "Läuft hier nicht (nur " + String.join(", ", loaders) + ")";
	}

	/** Warum das Addon nicht zu dieser Version des Heldix Loaders passt („Braucht Heldix Loader 2.4.0 oder neuer“), sonst null. */
	public String loaderProblem(String installed) {
		return loaderProblem(loader, installed);
	}

	/** wie oben für eine beliebige Angabe (z. B. aus dem Store-Manifest) */
	public static String loaderProblem(String range, String installed) {
		if (range == null || range.isBlank() || installed == null || Versions.matches(installed, range)) return null;
		String spec = range.strip();
		if (spec.startsWith(">=") && !spec.contains(" ") && !spec.contains("|")) {
			return "Braucht Heldix Loader " + spec.substring(2).strip() + " oder neuer";
		}
		return "Braucht Heldix Loader " + spec;
	}

	private static final Pattern RELEASE = Pattern.compile("\\d+(\\.\\d+)*");
}
