package dev.heldixclient.loader.impl;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Übersetzungen aus Mods ({@code assets/<namespace>/lang/<sprache>.json}).
 * Vanilla lädt Sprachdateien nur aus Ressourcenpaketen; der Loader ergänzt die Texte der Mods,
 * wenn ein Schlüssel dort fehlt (Ressourcenpakete können Mod-Texte also weiterhin ändern).
 */
final class ModTranslations {
	private static final Pattern LANG_FILE = Pattern.compile("assets/[^/]+/lang/([a-z0-9_]+)\\.json");
	private static final Map<String, Map<String, String>> BY_LANGUAGE = new HashMap<>();
	private static volatile Map<String, String> active = Map.of();

	private ModTranslations() {
	}

	static synchronized void load(Path jar) {
		try (JarFile archive = new JarFile(jar.toFile())) {
			Enumeration<JarEntry> entries = archive.entries();
			while (entries.hasMoreElements()) {
				JarEntry entry = entries.nextElement();
				Matcher matcher = LANG_FILE.matcher(entry.getName());
				if (!matcher.matches()) continue;
				try (InputStreamReader reader = new InputStreamReader(archive.getInputStream(entry), StandardCharsets.UTF_8)) {
					JsonObject json = JsonParser.parseReader(reader).getAsJsonObject();
					Map<String, String> target = BY_LANGUAGE.computeIfAbsent(matcher.group(1), k -> new HashMap<>());
					for (Map.Entry<String, JsonElement> value : json.entrySet()) {
						if (value.getValue().isJsonPrimitive()) target.put(value.getKey(), value.getValue().getAsString());
					}
				}
			}
		} catch (Exception e) {
			LoaderCore.LOG.warn("Übersetzungen aus {} nicht lesbar", jar.getFileName(), e);
		}
		select(List.of("en_us"));
	}

	/** Wird aufgerufen, wenn Minecraft Sprachen lädt, z. B. ["en_us", "de_de"] (spätere überschreiben frühere). */
	static synchronized void select(List<String> languages) {
		Map<String, String> merged = new HashMap<>(BY_LANGUAGE.getOrDefault("en_us", Map.of()));
		for (String language : languages) merged.putAll(BY_LANGUAGE.getOrDefault(language, Map.of()));
		active = merged;
	}

	static String get(String key) {
		return active.get(key);
	}
}
