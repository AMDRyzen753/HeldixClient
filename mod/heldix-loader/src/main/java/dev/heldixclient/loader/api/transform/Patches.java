package dev.heldixclient.loader.api.transform;

import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

import java.util.ArrayList;
import java.util.List;
import java.util.function.IntFunction;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * Typische Eingriffe in Methoden, ähnlich wie bei Mixin, aber direkt mit ASM:
 * am Anfang einfügen, vor jedem return, Rückgabewert ändern, Aufrufe ersetzen usw.
 *
 * <p>Alle Methoden suchen zuerst ihre Ziele und werfen eine {@link PatchException}, wenn etwas
 * fehlt – dann ist die Methode noch unverändert.
 */
public final class Patches implements Opcodes {
	private Patches() {
	}

	/** Findet eine Methode über Name und Deskriptor, z. B. {@code ("calculateFov", "(F)F")}. */
	public static MethodNode method(ClassNode owner, String name, String desc) {
		for (MethodNode method : owner.methods) {
			if (method.name.equals(name) && method.desc.equals(desc)) return method;
		}
		throw new PatchException("Methode " + owner.name + "." + name + desc + " nicht gefunden");
	}

	/** Fügt Code ganz am Anfang der Methode ein. */
	public static void head(MethodNode method, Code code) {
		method.instructions.insert(code.build());
	}

	/** Am Anfang: {@code if (<condition>) return;} – nur für void-Methoden. */
	public static void cancelAtHead(MethodNode method, Code condition) {
		if (Type.getReturnType(method.desc) != Type.VOID_TYPE) {
			throw new PatchException(method.name + method.desc + ": cancelAtHead geht nur bei void-Methoden");
		}
		head(method, condition.ifTrue(Code.begin().returnVoid()));
	}

	/** Fügt Code vor jedem return ein. Bei Methoden mit Rückgabewert liegt dieser dabei oben auf dem Stack. */
	public static int beforeReturns(MethodNode method, Supplier<Code> code) {
		List<AbstractInsnNode> returns = find(method, insn -> insn.getOpcode() >= IRETURN && insn.getOpcode() <= RETURN);
		if (returns.isEmpty()) throw new PatchException(method.name + method.desc + " hat kein return");
		for (AbstractInsnNode insn : returns) method.instructions.insertBefore(insn, code.get().build());
		return returns.size();
	}

	/** Fügt Code vor dem letzten return der Methode ein (das normale Ende). */
	public static void tail(MethodNode method, Code code) {
		List<AbstractInsnNode> returns = find(method, insn -> insn.getOpcode() >= IRETURN && insn.getOpcode() <= RETURN);
		if (returns.isEmpty()) throw new PatchException(method.name + method.desc + " hat kein return");
		method.instructions.insertBefore(returns.getLast(), code.build());
	}

	/**
	 * Leitet jeden Rückgabewert durch eine statische Methode: {@code return hook(original);}.
	 * Der Hook nimmt den Rückgabetyp und gibt ihn zurück, z. B. {@code (F)F}.
	 */
	public static int modifyReturnValue(MethodNode method, String hookOwner, String hookName, String hookDesc) {
		return beforeReturns(method, () -> Code.begin().invokeStatic(hookOwner, hookName, hookDesc));
	}

	/** Fügt Code direkt nach jedem Aufruf der angegebenen Methode ein. */
	public static int afterCalls(MethodNode method, String owner, String name, String desc, Supplier<Code> code) {
		List<AbstractInsnNode> calls = find(method, isCall(owner, name, desc));
		if (calls.isEmpty()) throw new PatchException(method.name + method.desc + " ruft " + owner + "." + name + desc + " nicht auf");
		for (AbstractInsnNode insn : calls) method.instructions.insert(insn, code.get().build());
		return calls.size();
	}

	/**
	 * Ersetzt Aufrufe einer Methode. {@code replacement} bekommt die Nummer des Aufrufs (0, 1, …)
	 * und liefert Ersatz-Code, der dieselben Werte vom Stack nimmt (oder null = unverändert lassen).
	 */
	public static int replaceCalls(MethodNode method, String owner, String name, String desc, IntFunction<Code> replacement) {
		List<AbstractInsnNode> calls = find(method, isCall(owner, name, desc));
		if (calls.isEmpty()) throw new PatchException(method.name + method.desc + " ruft " + owner + "." + name + desc + " nicht auf");
		int replaced = 0;
		for (int i = 0; i < calls.size(); i++) {
			Code code = replacement.apply(i);
			if (code == null) continue;
			method.instructions.insertBefore(calls.get(i), code.build());
			method.instructions.remove(calls.get(i));
			replaced++;
		}
		return replaced;
	}

	/** Fügt Code vor jedem Schreiben des Feldes ein (PUTFIELD/PUTSTATIC); der neue Wert liegt oben auf dem Stack. */
	public static int beforeFieldWrite(MethodNode method, String owner, String name, Supplier<Code> code) {
		List<AbstractInsnNode> writes = find(method, isFieldWrite(owner, name));
		if (writes.isEmpty()) throw new PatchException(method.name + method.desc + " schreibt " + owner + "." + name + " nicht");
		for (AbstractInsnNode insn : writes) method.instructions.insertBefore(insn, code.get().build());
		return writes.size();
	}

	/** Fügt Code nach dem ersten Schreiben des Feldes ein. */
	public static void afterFirstFieldWrite(MethodNode method, String owner, String name, Code code) {
		List<AbstractInsnNode> writes = find(method, isFieldWrite(owner, name));
		if (writes.isEmpty()) throw new PatchException(method.name + method.desc + " schreibt " + owner + "." + name + " nicht");
		method.instructions.insert(writes.getFirst(), code.build());
	}

	public static List<AbstractInsnNode> find(MethodNode method, Predicate<AbstractInsnNode> filter) {
		List<AbstractInsnNode> result = new ArrayList<>();
		for (AbstractInsnNode insn : method.instructions) {
			if (filter.test(insn)) result.add(insn);
		}
		return result;
	}

	public static Predicate<AbstractInsnNode> isCall(String owner, String name, String desc) {
		return insn -> insn instanceof MethodInsnNode call && call.owner.equals(owner) && call.name.equals(name) && call.desc.equals(desc);
	}

	public static Predicate<AbstractInsnNode> isFieldWrite(String owner, String name) {
		return insn -> insn instanceof FieldInsnNode field && (field.getOpcode() == PUTFIELD || field.getOpcode() == PUTSTATIC)
				&& field.owner.equals(owner) && field.name.equals(name);
	}
}
