package dev.heldixclient.transform;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Code;
import dev.heldixclient.loader.api.transform.PatchException;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.FieldNode;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import java.util.Set;

/**
 * Eingriffe für die gedroppten Items (Addon-API 4, {@link dev.heldixclient.api.DroppedItems}): Ein Addon kann
 * festlegen, wie hoch und wie gedreht jedes Item gezeichnet wird, statt dass es schwebt und sich dreht.
 * Die Logik steckt in {@link DroppedItemHooks}; hier wird nur festgelegt, wo sie aufgerufen wird.
 *
 * <ul>
 *   <li>{@code ItemEntityRenderState} bekommt {@link DroppedItemPoseHolder} mit einem Feld für die Lage.</li>
 *   <li>{@code ItemEntityRenderer.extractRenderState}: am Ende fragt {@link DroppedItemHooks#extract} den Renderer des
 *       Addons und legt die Lage am Renderzustand ab.</li>
 *   <li>{@code ItemEntityRenderer.submit}: der eine {@code PoseStack.translate}-Aufruf (Schweben) und der eine
 *       {@code PoseStack.rotate}-Aufruf (Drehen) gehen durch {@link DroppedItemHooks}. Ohne Lage rufen die Hooks genau
 *       die Originalmethoden mit den Originalwerten auf – ohne Addon bleibt alles wie in Minecraft.</li>
 * </ul>
 *
 * <p>Wichtig: Diese Klasse wird vor Minecraft geladen und benutzt keine Minecraft-Klassen, nur deren Namen als Text.
 * Alle Ziele werden geprüft, bevor etwas geändert wird: Hat Minecraft den Code umgebaut, bleibt die Klasse ganz
 * unverändert (auch im Fabric-Weg, wo halbe Änderungen nicht verworfen würden), der Loader meldet das Problem und die
 * Items schweben wie gewohnt.
 */
public final class DroppedItemPatches implements ClassTransformer, Opcodes {
	private static final String HOOKS = "dev/heldixclient/transform/DroppedItemHooks";
	private static final String HOLDER = "dev/heldixclient/transform/DroppedItemPoseHolder";
	private static final String MARKER = "dev/heldixclient/transform/DroppedItemPoseRenderer";
	private static final String POSE_TYPE = "Ldev/heldixclient/api/DroppedItemPose;";
	private static final String POSE_FIELD = "heldix$droppedItemPose";
	private static final String POSE_SETTER = "heldix$setDroppedItemPose";

	static final String RENDERER = "net/minecraft/client/renderer/entity/ItemEntityRenderer";
	static final String STATE = "net/minecraft/client/renderer/entity/state/ItemEntityRenderState";
	private static final String CLUSTER_STATE = "net/minecraft/client/renderer/entity/state/ItemClusterRenderState";
	private static final String POSE_STACK = "com/mojang/blaze3d/vertex/PoseStack";
	private static final String L_STATE = "L" + STATE + ";";
	private static final String L_POSE_STACK = "L" + POSE_STACK + ";";
	private static final String L_AXIS = "Lcom/mojang/math/Axis;";

	private static final String EXTRACT_DESC = "(Lnet/minecraft/world/entity/item/ItemEntity;" + L_STATE + "F)V";
	private static final String SUBMIT_DESC = "(" + L_STATE + L_POSE_STACK
			+ "Lnet/minecraft/client/renderer/SubmitNodeCollector;Lnet/minecraft/client/renderer/state/level/CameraRenderState;)V";
	private static final String TRANSLATE = "(FFF)V";
	private static final String ROTATE = "(" + L_AXIS + "F)V";

	@Override
	public Set<String> targets() {
		return Set.of(RENDERER, STATE);
	}

	@Override
	public void transform(String className, ClassNode node) {
		switch (className) {
			case STATE -> addPoseField(node);
			case RENDERER -> patchRenderer(node);
			default -> {
			}
		}
	}

	/** Hängt {@link DroppedItemPoseHolder} samt Feld, Getter und Setter an den Renderzustand an. */
	private static void addPoseField(ClassNode node) {
		if (node.interfaces.contains(HOLDER)) return;
		if (!CLUSTER_STATE.equals(node.superName)) throw new PatchException(STATE + " erbt nicht mehr von " + CLUSTER_STATE + " (sondern " + node.superName + ")");
		for (FieldNode field : node.fields) {
			if (field.name.equals(POSE_FIELD)) throw new PatchException(STATE + " hat schon ein Feld " + POSE_FIELD);
		}
		for (MethodNode method : node.methods) {
			if (method.name.equals(POSE_FIELD) || method.name.equals(POSE_SETTER)) throw new PatchException(STATE + " hat schon eine Methode " + method.name);
		}

		node.interfaces.add(HOLDER);
		node.fields.add(new FieldNode(ACC_PUBLIC, POSE_FIELD, POSE_TYPE, null, null));

		MethodNode get = new MethodNode(ACC_PUBLIC, POSE_FIELD, "()" + POSE_TYPE, null, null);
		get.instructions.add(new VarInsnNode(ALOAD, 0));
		get.instructions.add(new FieldInsnNode(GETFIELD, node.name, POSE_FIELD, POSE_TYPE));
		get.instructions.add(new InsnNode(ARETURN));
		get.maxStack = 1;
		get.maxLocals = 1;
		node.methods.add(get);

		MethodNode set = new MethodNode(ACC_PUBLIC, POSE_SETTER, "(" + POSE_TYPE + ")V", null, null);
		set.instructions.add(new VarInsnNode(ALOAD, 0));
		set.instructions.add(new VarInsnNode(ALOAD, 1));
		set.instructions.add(new FieldInsnNode(PUTFIELD, node.name, POSE_FIELD, POSE_TYPE));
		set.instructions.add(new InsnNode(RETURN));
		set.maxStack = 2;
		set.maxLocals = 2;
		node.methods.add(set);
	}

	private static void patchRenderer(ClassNode node) {
		if (node.interfaces.contains(MARKER)) return;
		// Erst alles suchen und prüfen, dann ändern: scheitert etwas, ist die Klasse noch ganz unverändert
		MethodNode extract = Patches.method(node, "extractRenderState", EXTRACT_DESC);
		MethodNode submit = Patches.method(node, "submit", SUBMIT_DESC);
		expectOneCall(submit, POSE_STACK, "translate", TRANSLATE);
		expectOneCall(submit, POSE_STACK, "rotate", ROTATE);
		if (Patches.find(extract, insn -> insn.getOpcode() >= IRETURN && insn.getOpcode() <= RETURN).isEmpty()) {
			throw new PatchException(RENDERER + ".extractRenderState hat kein return");
		}

		// Nach dem Auslesen: Lage vom Renderer des Addons holen (gleiche Parameter wie die Methode, ohne this)
		Patches.tail(extract, Code.begin().loadArgs(extract, 0, 1, 2).invokeStatic(HOOKS, "extract", EXTRACT_DESC));
		// Schweben: pose.translate(x, y, z) -> DroppedItemHooks.translate(pose, x, y, z, state)
		Patches.replaceCalls(submit, POSE_STACK, "translate", TRANSLATE, call -> Code.begin().loadArg(submit, 0)
				.invokeStatic(HOOKS, "translate", "(" + L_POSE_STACK + "FFF" + L_STATE + ")V"));
		// Drehen: pose.rotate(axis, angle) -> DroppedItemHooks.rotate(pose, axis, angle, state)
		Patches.replaceCalls(submit, POSE_STACK, "rotate", ROTATE, call -> Code.begin().loadArg(submit, 0)
				.invokeStatic(HOOKS, "rotate", "(" + L_POSE_STACK + L_AXIS + "F" + L_STATE + ")V"));
		node.interfaces.add(MARKER);
	}

	/** Bricht ab (Klasse bleibt unverändert), wenn Minecraft die Methode anders aufbaut als in 26.3. */
	private static void expectOneCall(MethodNode method, String owner, String name, String desc) {
		int calls = Patches.find(method, Patches.isCall(owner, name, desc)).size();
		if (calls != 1) {
			throw new PatchException(RENDERER + "." + method.name + ": erwartet 1 Aufruf von " + name + desc + ", gefunden " + calls);
		}
	}
}
