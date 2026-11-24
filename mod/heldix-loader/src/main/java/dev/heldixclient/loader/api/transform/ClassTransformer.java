package dev.heldixclient.loader.api.transform;

import org.objectweb.asm.tree.ClassNode;

import java.util.Set;

/**
 * Verändert Minecraft-Klassen beim Laden (Bytecode mit ASM). In der heldix.mod.json eintragen:
 * <pre>"transformers": ["meine.mod.MeinTransformer"]</pre>
 *
 * <p>Wichtig: Transformer werden erzeugt, bevor Minecraft startet. Die Klasse selbst darf
 * deshalb keine Minecraft-Klassen benutzen, sondern nur deren Namen als Text. Die eigentliche
 * Logik gehört in statische "Hook"-Methoden, die der veränderte Code aufruft.
 * Hilfen dafür: {@link Patches} und {@link Code}.
 */
public interface ClassTransformer {
	/** Interne Namen der Zielklassen, z. B. {@code "net/minecraft/client/Camera"}. */
	Set<String> targets();

	/**
	 * Verändert eine Zielklasse. Schlägt ein Patch fehl (Exception), bleibt die Klasse
	 * unverändert und der Fehler wird gemeldet.
	 */
	void transform(String className, ClassNode node);
}
