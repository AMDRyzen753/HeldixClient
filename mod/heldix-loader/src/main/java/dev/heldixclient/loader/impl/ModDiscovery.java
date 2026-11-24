package dev.heldixclient.loader.impl;

import com.google.gson.Gson;

import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** Findet Heldix-Mods im mods-Ordner und prüft Versionen und Abhängigkeiten. */
final class ModDiscovery {
	static final String METADATA = "heldix.mod.json";
	private static final Pattern ID = Pattern.compile("[a-z][a-z0-9_-]{1,63}");
	private static final Set<String> RESERVED = Set.of("minecraft", "java", LoaderCore.ID);
	private static final Gson GSON = new Gson();

	record Candidate(Path file, ModMetadata meta) {
	}

	private ModDiscovery() {
	}

	/** Liest alle JARs im Ordner. Dateien ohne heldix.mod.json werden mit Begründung gemeldet. */
	static List<Candidate> discover(Path dir, Consumer<String> problems) {
		List<Candidate> result = new ArrayList<>();
		if (!Files.isDirectory(dir)) return result;
		List<Path> jars;
		try (Stream<Path> files = Files.list(dir)) {
			jars = files.filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jar")).sorted().toList();
		} catch (Exception e) {
			problems.accept("Ordner " + dir + " nicht lesbar: " + e.getMessage());
			return result;
		}
		for (Path jar : jars) {
			String file = jar.getFileName().toString();
			try (JarFile archive = new JarFile(jar.toFile())) {
				JarEntry entry = archive.getJarEntry(METADATA);
				if (entry == null) {
					if (archive.getJarEntry("fabric.mod.json") != null) {
						problems.accept(file + ": Fabric-Mod – läuft nur in einer Fabric-Instanz, nicht mit dem Heldix Loader");
					} else if (archive.getJarEntry("heldix.addon.json") != null) {
						problems.accept(file + ": Heldix-Addon – gehört in den Ordner heldix-addons, nicht nach mods");
					} else {
						problems.accept(file + ": keine Heldix-Mod (" + METADATA + " fehlt)");
					}
					continue;
				}
				try (Reader reader = new InputStreamReader(archive.getInputStream(entry), StandardCharsets.UTF_8)) {
					ModMetadata meta = GSON.fromJson(reader, ModMetadata.class);
					if (meta == null) throw new IllegalStateException(METADATA + " ist leer");
					result.add(new Candidate(jar, meta));
				}
			} catch (Exception e) {
				problems.accept(file + ": nicht lesbar (" + e.getMessage() + ")");
			}
		}
		return result;
	}

	/** Liest die heldix.mod.json einer JAR (für den Start in Fabric, wo Fabric die JARs schon kennt). */
	static List<Candidate> read(List<Path> jars, Consumer<String> problems) {
		List<Candidate> result = new ArrayList<>();
		for (Path jar : jars) {
			if (!Files.isRegularFile(jar)) continue;
			try (JarFile archive = new JarFile(jar.toFile())) {
				JarEntry entry = archive.getJarEntry(METADATA);
				if (entry == null) continue;
				try (Reader reader = new InputStreamReader(archive.getInputStream(entry), StandardCharsets.UTF_8)) {
					ModMetadata meta = GSON.fromJson(reader, ModMetadata.class);
					if (meta == null) throw new IllegalStateException(METADATA + " ist leer");
					result.add(new Candidate(jar, meta));
				}
			} catch (Exception e) {
				problems.accept(jar.getFileName() + ": nicht lesbar (" + e.getMessage() + ")");
			}
		}
		return result;
	}

	/** Behält nur Mods, die zu Minecraft, Loader und ihren Abhängigkeiten passen – Abhängigkeiten zuerst. */
	static List<Candidate> resolve(List<Candidate> candidates, String loaderVersion, String minecraftVersion, Consumer<String> problems) {
		Map<String, Candidate> byId = new LinkedHashMap<>();
		for (Candidate candidate : candidates) {
			ModMetadata meta = candidate.meta();
			String file = candidate.file().getFileName().toString();
			if (meta.id == null || !ID.matcher(meta.id).matches() || RESERVED.contains(meta.id)) {
				problems.accept(file + ": ungültige Mod-ID \"" + meta.id + "\" (erlaubt: a-z, 0-9, _ und -)");
				continue;
			}
			Candidate existing = byId.get(meta.id);
			if (existing != null) {
				problems.accept(file + ": Mod \"" + meta.id + "\" ist doppelt installiert (auch " + existing.file().getFileName() + ")");
				continue;
			}
			if (!Versions.matches(minecraftVersion, meta.minecraft)) {
				problems.accept(meta.displayName() + ": gebaut für Minecraft " + meta.minecraft + ", gestartet ist " + minecraftVersion);
				continue;
			}
			if (!Versions.matches(loaderVersion, meta.loader)) {
				problems.accept(meta.displayName() + ": braucht Heldix Loader " + meta.loader + ", installiert ist " + loaderVersion);
				continue;
			}
			byId.put(meta.id, candidate);
		}

		// Mods mit fehlenden Abhängigkeiten entfernen, bis sich nichts mehr ändert
		boolean changed = true;
		while (changed) {
			changed = false;
			for (Iterator<Candidate> it = byId.values().iterator(); it.hasNext(); ) {
				Candidate candidate = it.next();
				String missing = missingDependency(candidate.meta(), byId, loaderVersion, minecraftVersion);
				if (missing != null) {
					problems.accept(candidate.meta().displayName() + ": " + missing);
					it.remove();
					changed = true;
				}
			}
		}

		List<Candidate> ordered = new ArrayList<>();
		Set<String> visited = new HashSet<>();
		for (Candidate candidate : byId.values()) visit(candidate, byId, visited, ordered);
		return ordered;
	}

	private static String missingDependency(ModMetadata meta, Map<String, Candidate> mods, String loaderVersion, String minecraftVersion) {
		for (Map.Entry<String, String> dependency : meta.depends().entrySet()) {
			String id = dependency.getKey();
			String range = dependency.getValue();
			String installed = switch (id) {
				case "minecraft" -> minecraftVersion;
				case LoaderCore.ID -> loaderVersion;
				case "java" -> String.valueOf(Runtime.version().feature());
				default -> mods.containsKey(id) ? mods.get(id).meta().version : null;
			};
			if (installed == null) return "braucht die Mod \"" + id + "\"" + (range == null || range.equals("*") ? "" : " " + range);
			if (!Versions.matches(installed, range)) return "braucht " + id + " " + range + ", vorhanden ist " + installed;
		}
		return null;
	}

	private static void visit(Candidate candidate, Map<String, Candidate> mods, Set<String> visited, List<Candidate> ordered) {
		if (!visited.add(candidate.meta().id)) return;
		for (String dependency : candidate.meta().depends().keySet()) {
			Candidate other = mods.get(dependency);
			if (other != null) visit(other, mods, visited, ordered);
		}
		ordered.add(candidate);
	}
}
