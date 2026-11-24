package dev.heldixclient.loader.api.transform;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.JumpInsnNode;
import org.objectweb.asm.tree.LabelNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

/**
 * Kleiner Baukasten für Bytecode, der in Minecraft-Methoden eingefügt wird.
 *
 * <pre>{@code
 * // if (MeineHooks.zoom(this, partialTick)) return;
 * Code.begin().loadThis().loadArg(method, 0)
 *     .invokeStatic("meine/mod/MeineHooks", "zoom", "(Lnet/minecraft/client/Camera;F)Z")
 *     .ifTrue(Code.begin().returnVoid());
 * }</pre>
 * Stack-Map-Frames rechnet der Loader beim Schreiben der Klasse selbst aus.
 */
public final class Code implements Opcodes {
	private final InsnList insns = new InsnList();

	private Code() {
	}

	public static Code begin() {
		return new Code();
	}

	/** Lädt {@code this} (nur in nicht-statischen Methoden). */
	public Code loadThis() {
		return add(new VarInsnNode(ALOAD, 0));
	}

	/** Lädt den Parameter Nummer {@code index} (0 = erster Parameter, ohne {@code this}). */
	public Code loadArg(MethodNode method, int index) {
		Type[] args = Type.getArgumentTypes(method.desc);
		if (index < 0 || index >= args.length) {
			throw new PatchException(method.name + method.desc + " hat keinen Parameter " + index);
		}
		int slot = (method.access & ACC_STATIC) != 0 ? 0 : 1;
		for (int i = 0; i < index; i++) slot += args[i].getSize();
		return add(new VarInsnNode(args[index].getOpcode(ILOAD), slot));
	}

	public Code loadArgs(MethodNode method, int... indices) {
		for (int index : indices) loadArg(method, index);
		return this;
	}

	public Code getField(String owner, String name, String desc) {
		return add(new FieldInsnNode(GETFIELD, owner, name, desc));
	}

	public Code invokeStatic(String owner, String name, String desc) {
		return add(new MethodInsnNode(INVOKESTATIC, owner, name, desc, false));
	}

	public Code invokeVirtual(String owner, String name, String desc) {
		return add(new MethodInsnNode(INVOKEVIRTUAL, owner, name, desc, false));
	}

	/** Ruft eine Methode ohne virtuelle Auflösung auf, z. B. die Implementierung der Oberklasse. */
	public Code invokeSpecial(String owner, String name, String desc) {
		return add(new MethodInsnNode(INVOKESPECIAL, owner, name, desc, false));
	}

	public Code insn(int opcode) {
		return add(new InsnNode(opcode));
	}

	public Code returnVoid() {
		return insn(RETURN);
	}

	/** Nimmt einen boolean vom Stack; ist er true, läuft {@code then} (sollte mit einem return enden). */
	public Code ifTrue(Code then) {
		LabelNode skip = new LabelNode();
		add(new JumpInsnNode(IFEQ, skip));
		add(then.build());
		return add(skip);
	}

	/** Nimmt ein Objekt vom Stack; ist es nicht null, wird es zurückgegeben, sonst läuft der Originalcode weiter. */
	public Code returnIfNonNull() {
		LabelNode skip = new LabelNode();
		add(new InsnNode(DUP));
		add(new JumpInsnNode(IFNULL, skip));
		add(new InsnNode(ARETURN));
		add(skip);
		return insn(POP);
	}

	public Code add(AbstractInsnNode node) {
		insns.add(node);
		return this;
	}

	public Code add(InsnList list) {
		insns.add(list);
		return this;
	}

	/** Die fertigen Befehle. Ein Code-Objekt kann nur einmal eingefügt werden. */
	public InsnList build() {
		return insns;
	}
}
