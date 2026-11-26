package dev.heldixclient.loader.impl;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.tree.ClassNode;

import java.lang.instrument.ClassFileTransformer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.ProtectionDomain;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * Wendet beim Laden einer Klasse alle zuständigen Transformer an – in Reihenfolge:
 * erst die des Loaders, dann die der Mods. Schlägt einer fehl, bleibt nur sein Teil weg.
 */
final class TransformerChain implements ClassFileTransformer {
	/** onProblem: Fehler zusätzlich dort melden (z. B. am Addon, dem der Transformer gehört), sonst null */
	private record Entry(ClassTransformer transformer, String source, Consumer<String> onProblem) {
		void failed(String className, Throwable t) {
			String reason = className.replace('/', '.') + " konnte nicht verändert werden – " + t;
			LoaderCore.problem(source + ": " + reason);
			LoaderCore.LOG.error("Transformer von {} ist an {} gescheitert", source, className, t);
			if (onProblem != null) onProblem.accept(reason);
		}
	}

	private final Map<String, List<Entry>> byTarget = new ConcurrentHashMap<>();
	private final Path dumpDir;

	TransformerChain(Path dumpDir) {
		this.dumpDir = dumpDir;
	}

	void add(ClassTransformer transformer, String source) {
		add(transformer, source, null);
	}

	void add(ClassTransformer transformer, String source, Consumer<String> onProblem) {
		for (String target : transformer.targets()) {
			byTarget.computeIfAbsent(target, k -> new ArrayList<>()).add(new Entry(transformer, source, onProblem));
		}
	}

	java.util.Set<String> targets() {
		return java.util.Set.copyOf(byTarget.keySet());
	}

	/**
	 * Wendet die Transformer direkt auf eine schon gelesene Klasse an (Start in Fabric: aus dem Mixin-Plugin,
	 * Mixin schreibt die Klasse danach selbst und berechnet die Frames).
	 */
	void apply(String className, ClassNode node) {
		List<Entry> entries = byTarget.get(className);
		if (entries == null) return;
		for (Entry entry : entries) {
			try {
				entry.transformer().transform(className, node);
			} catch (Throwable t) {
				entry.failed(className, t);
			}
		}
	}

	@Override
	public byte[] transform(ClassLoader loader, String className, Class<?> redefined, ProtectionDomain domain, byte[] original) {
		if (className == null) return null;
		List<Entry> entries = byTarget.get(className);
		if (entries == null) return null;

		byte[] current = original;
		boolean changed = false;
		for (Entry entry : entries) {
			try {
				ClassNode node = new ClassNode();
				new ClassReader(current).accept(node, ClassReader.SKIP_FRAMES);
				entry.transformer().transform(className, node);
				ClassWriter writer = new HierarchyClassWriter(loader);
				node.accept(writer);
				current = writer.toByteArray();
				changed = true;
			} catch (Throwable t) {
				entry.failed(className, t);
			}
		}
		if (changed && dumpDir != null) dump(className, current);
		return changed ? current : null;
	}

	private void dump(String className, byte[] bytes) {
		try {
			Path file = dumpDir.resolve(className + ".class");
			Files.createDirectories(file.getParent());
			Files.write(file, bytes);
		} catch (Exception e) {
			LoaderCore.LOG.warn("Konnte {} nicht speichern", className, e);
		}
	}
}
