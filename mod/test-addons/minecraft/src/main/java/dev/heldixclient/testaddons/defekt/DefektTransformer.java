package dev.heldixclient.testaddons.defekt;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.tree.ClassNode;

import java.util.Set;

/** Sucht in Minecraft eine Methode, die es nicht gibt: der Eingriff scheitert, bevor er etwas ändert (PatchException). */
public final class DefektTransformer implements ClassTransformer {
	@Override
	public Set<String> targets() {
		return Set.of("net/minecraft/client/Minecraft");
	}

	@Override
	public void transform(String className, ClassNode node) {
		Patches.method(node, "gibtEsNicht", "()V");
	}
}
