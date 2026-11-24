package dev.heldixclient.loader.impl;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ClassWriter, der Stack-Map-Frames neu berechnet, ohne dabei Klassen zu laden.
 *
 * <p>Der Standard-ClassWriter lädt für {@link #getCommonSuperClass} Klassen per Class.forName –
 * mitten im Transformieren würde das Minecraft-Klassen zu früh (und unverändert) laden.
 * Hier wird die Klassenhierarchie stattdessen direkt aus den .class-Dateien gelesen.
 */
final class HierarchyClassWriter extends ClassWriter {
	private record Info(String superName, String[] interfaces, boolean isInterface) {
	}

	private static final String OBJECT = "java/lang/Object";
	private static final Map<String, Info> CACHE = new ConcurrentHashMap<>();
	private final ClassLoader loader;

	HierarchyClassWriter(ClassLoader loader) {
		super(COMPUTE_FRAMES);
		this.loader = loader != null ? loader : ClassLoader.getSystemClassLoader();
	}

	@Override
	protected ClassLoader getClassLoader() {
		return loader;
	}

	@Override
	protected String getCommonSuperClass(String a, String b) {
		if (a.equals(b)) return a;
		if (a.equals(OBJECT) || b.equals(OBJECT)) return OBJECT;
		Info infoA = info(a);
		Info infoB = info(b);
		if (infoA == null || infoB == null) return OBJECT;
		if (isAssignable(a, b)) return a;
		if (isAssignable(b, a)) return b;
		if (infoA.isInterface() || infoB.isInterface()) return OBJECT;
		String current = a;
		while (true) {
			Info info = info(current);
			if (info == null || info.superName() == null) return OBJECT;
			current = info.superName();
			if (isAssignable(current, b)) return current;
		}
	}

	/** Ist {@code type} gleich {@code target} oder ein Untertyp davon? */
	private boolean isAssignable(String target, String type) {
		if (target.equals(type)) return true;
		Info info = info(type);
		if (info == null) return false;
		if (info.superName() != null && isAssignable(target, info.superName())) return true;
		for (String parent : info.interfaces()) {
			if (isAssignable(target, parent)) return true;
		}
		return false;
	}

	private Info info(String name) {
		Info cached = CACHE.get(name);
		if (cached != null) return cached;
		try (InputStream in = loader.getResourceAsStream(name + ".class")) {
			if (in == null) return null;
			ClassReader reader = new ClassReader(in);
			Info info = new Info(reader.getSuperName(), reader.getInterfaces(), (reader.getAccess() & Opcodes.ACC_INTERFACE) != 0);
			CACHE.put(name, info);
			return info;
		} catch (IOException | RuntimeException e) {
			return null;
		}
	}
}
