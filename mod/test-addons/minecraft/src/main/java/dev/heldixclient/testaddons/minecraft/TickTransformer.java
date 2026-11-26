package dev.heldixclient.testaddons.minecraft;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Code;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.tree.ClassNode;

import java.util.Set;

/** Ruft am Anfang von Minecraft.tick() TestHooks.tick() auf – Minecraft-Klassen sehen so Klassen des Addons. */
public final class TickTransformer implements ClassTransformer {
	@Override
	public Set<String> targets() {
		return Set.of("net/minecraft/client/Minecraft");
	}

	@Override
	public void transform(String className, ClassNode node) {
		Patches.head(Patches.method(node, "tick", "()V"), Code.begin().invokeStatic("dev/heldixclient/testaddons/minecraft/TestHooks", "tick", "()V"));
	}
}
