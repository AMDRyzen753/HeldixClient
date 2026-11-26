package dev.heldixclient.testaddons.nurheldix;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldNode;

import java.util.Set;

/**
 * Hängt an InventoryScreen ein Feld an. InventoryScreen steht nicht in der Liste der Fabric-Brücke (Targets), deshalb
 * läuft dieses Addon nur in Heldix-Instanzen; in Fabric wird es gar nicht geladen.
 */
public final class InventoryTransformer implements ClassTransformer {
	public static final String FIELD = "HELDIX_NUR_HELDIX";

	@Override
	public Set<String> targets() {
		return Set.of("net/minecraft/client/gui/screens/inventory/InventoryScreen");
	}

	@Override
	public void transform(String className, ClassNode node) {
		node.fields.add(new FieldNode(Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC | Opcodes.ACC_FINAL, FIELD, "Ljava/lang/String;", null, "ja"));
	}
}
