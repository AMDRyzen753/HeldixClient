package dev.heldixclient.transform;

import dev.heldixclient.addons.itemphysics.ItemPhysicsMath;
import dev.heldixclient.loader.api.transform.PatchException;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;
import org.objectweb.asm.util.CheckClassAdapter;

import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/**
 * Prüfstand (nicht Teil der Mod, läuft mit {@code gradlew build}): wendet {@link DroppedItemPatches} auf die echten
 * Klassen aus der Minecraft-JAR an, schreibt sie mit Frame-Berechnung neu und prüft sie mit dem ASM-Verifier. Prüft
 * außerdem, dass eine umgebaute Minecraft-Klasse ganz unverändert bleibt, und rechnet die Formeln des
 * Item-Physics-Addons nach. Spielverhalten prüft der Autotest im echten Spiel.
 */
public final class TransformCheck {
	private static int failures;

	public static void main(String[] args) throws Exception {
		Path out = Path.of(args[0]);
		ClassLoader loader = TransformCheck.class.getClassLoader();
		DroppedItemPatches patches = new DroppedItemPatches();
		check(patches.targets().size() == 2, "zwei Ziel-Klassen: " + patches.targets());

		for (String target : patches.targets()) {
			ClassNode node = read(loader, target);
			patches.transform(target, node);
			byte[] patched = write(node, loader);
			StringWriter errors = new StringWriter();
			CheckClassAdapter.verify(new ClassReader(patched), loader, false, new PrintWriter(errors));
			Path file = out.resolve(target + ".class");
			Files.createDirectories(file.getParent());
			Files.write(file, patched);
			check(errors.toString().isBlank(), target + " Verifier: " + (errors.toString().isBlank() ? "ok" : "\n" + errors));

			ClassNode result = new ClassNode();
			new ClassReader(patched).accept(result, 0);
			if (target.equals(DroppedItemPatches.STATE)) {
				check(result.interfaces.contains("dev/heldixclient/transform/DroppedItemPoseHolder"), "Renderzustand hat DroppedItemPoseHolder");
				check(result.fields.stream().anyMatch(f -> f.name.equals("heldix$droppedItemPose")), "Renderzustand hat das Feld für die Lage");
			} else {
				check(result.interfaces.contains("dev/heldixclient/transform/DroppedItemPoseRenderer"), "Renderer ist markiert");
				MethodNode submit = result.methods.stream().filter(m -> m.name.equals("submit") && m.desc.contains("ItemEntityRenderState")).findFirst().orElseThrow();
				check(calls(submit, "com/mojang/blaze3d/vertex/PoseStack", "translate") == 0 && calls(submit, "com/mojang/blaze3d/vertex/PoseStack", "rotate") == 0,
						"submit ruft translate/rotate nur noch über die Hooks auf");
				check(calls(submit, "dev/heldixclient/transform/DroppedItemHooks", "translate") == 1
						&& calls(submit, "dev/heldixclient/transform/DroppedItemHooks", "rotate") == 1, "submit ruft beide Hooks genau einmal auf");
				MethodNode extract = result.methods.stream().filter(m -> m.name.equals("extractRenderState") && m.desc.contains("ItemEntity;")).findFirst().orElseThrow();
				check(calls(extract, "dev/heldixclient/transform/DroppedItemHooks", "extract") == 1, "extractRenderState ruft den Hook am Ende auf");
			}
			// zweimal anwenden (z. B. Klasse wird neu geladen) ändert nichts mehr
			ClassNode again = new ClassNode();
			new ClassReader(patched).accept(again, ClassReader.SKIP_FRAMES);
			patches.transform(target, again);
			check(again.interfaces.size() == result.interfaces.size() && again.fields.size() == result.fields.size()
					&& again.methods.size() == result.methods.size(), target + ": zweites Anwenden ändert nichts");
		}

		// Hat Minecraft den Code umgebaut (hier: submit dreht zweimal), bleibt die Klasse ganz unverändert
		ClassNode changed = read(loader, DroppedItemPatches.RENDERER);
		MethodNode submit = changed.methods.stream().filter(m -> m.name.equals("submit") && m.desc.contains("ItemEntityRenderState")).findFirst().orElseThrow();
		MethodInsnNode rotate = (MethodInsnNode) Arrays.stream(submit.instructions.toArray())
				.filter(i -> i instanceof MethodInsnNode call && call.name.equals("rotate")).findFirst().orElseThrow();
		// am Anfang zusätzlich pose.rotate(Axis.YP, 0) – gültiger Code, aber nicht mehr genau ein rotate-Aufruf
		InsnList extra = new InsnList();
		extra.add(new VarInsnNode(Opcodes.ALOAD, 2));
		extra.add(new FieldInsnNode(Opcodes.GETSTATIC, "com/mojang/math/Axis", "YP", "Lcom/mojang/math/Axis;"));
		extra.add(new InsnNode(Opcodes.FCONST_0));
		extra.add(new MethodInsnNode(rotate.getOpcode(), rotate.owner, rotate.name, rotate.desc, rotate.itf));
		submit.instructions.insert(extra);
		byte[] before = write(changed, loader);
		boolean refused = false;
		try {
			patches.transform(DroppedItemPatches.RENDERER, changed);
		} catch (PatchException expected) {
			refused = true;
			System.out.println("     (erwartet) " + expected.getMessage());
		}
		check(refused && Arrays.equals(before, write(changed, loader)), "umgebaute Minecraft-Klasse: Patch abgelehnt, Klasse unverändert");

		worldShareChecks(out, loader);
		serverLinkChecks(out, loader);
		mathChecks();

		System.out.println(failures == 0 ? "ALLE PRUEFUNGEN BESTANDEN" : failures + " PRUEFUNG(EN) FEHLGESCHLAGEN");
		if (failures > 0) System.exit(1);
	}

	/** Eingriffe für „Welt teilen“ (WorldSharePatches): an den echten Server-Klassen anwenden und prüfen */
	private static void worldShareChecks(Path out, ClassLoader loader) throws Exception {
		WorldSharePatches patches = new WorldSharePatches();
		check(patches.targets().size() == 4, "Welt teilen: vier Ziel-Klassen: " + patches.targets());
		String hooks = "dev/heldixclient/transform/WorldShareHooks";
		for (String target : patches.targets()) {
			ClassNode node = read(loader, target);
			patches.transform(target, node);
			byte[] patched = write(node, loader);
			StringWriter errors = new StringWriter();
			CheckClassAdapter.verify(new ClassReader(patched), loader, false, new PrintWriter(errors));
			Path file = out.resolve(target + ".class");
			Files.createDirectories(file.getParent());
			Files.write(file, patched);
			check(errors.toString().isBlank(), target + " Verifier: " + (errors.toString().isBlank() ? "ok" : "\n" + errors));
			ClassNode result = new ClassNode();
			new ClassReader(patched).accept(result, 0);
			switch (target) {
				case WorldSharePatches.INTEGRATED_PLAYER_LIST -> {
					MethodNode login = result.methods.stream().filter(m -> m.name.equals("canPlayerLogin")).findFirst().orElseThrow();
					long returns = Arrays.stream(login.instructions.toArray()).filter(i -> i.getOpcode() == Opcodes.ARETURN).count();
					check(calls(login, hooks, "canPlayerLogin") == returns && returns > 0, "canPlayerLogin: Hook vor jedem return (" + returns + ")");
				}
				case WorldSharePatches.INTEGRATED_SERVER -> {
					MethodNode permissions = result.methods.stream().filter(m -> m.name.equals("getProfilePermissions")).findFirst().orElseThrow();
					MethodNode max = result.methods.stream().filter(m -> m.name.equals("getMaxPlayers") && m.desc.equals("()I")).findFirst().orElseThrow();
					check(calls(permissions, hooks, "permissions") >= 1, "getProfilePermissions geht durch den Hook");
					check(calls(max, hooks, "maxPlayers") == 1, "getMaxPlayers geht durch den Hook");
				}
				case WorldSharePatches.CONNECT_SCREEN -> {
					MethodNode start = result.methods.stream().filter(m -> m.name.equals("startConnecting")).findFirst().orElseThrow();
					check(calls(start, hooks, "connecting") == 1, "ConnectScreen.startConnecting ruft den Hook genau einmal auf");
				}
				default -> {
					MethodNode place = result.methods.stream().filter(m -> m.name.equals("placeNewPlayer")).findFirst().orElseThrow();
					check(calls(place, hooks, "playerJoined") == 1, "placeNewPlayer ruft den Hook am Ende genau einmal auf");
				}
			}
		}
	}

	/** Kanal heldixclient:server (ServerLinkPatches): DiscardedPayload.codec und ClientPacketListener.handleCustomPayload */
	private static void serverLinkChecks(Path out, ClassLoader loader) throws Exception {
		ServerLinkPatches patches = new ServerLinkPatches();
		check(patches.targets().size() == 2, "Server-Kanal: zwei Ziel-Klassen: " + patches.targets());
		String hooks = "dev/heldixclient/transform/ServerLinkHooks";
		for (String target : patches.targets()) {
			ClassNode node = read(loader, target);
			patches.transform(target, node);
			byte[] patched = write(node, loader);
			StringWriter errors = new StringWriter();
			CheckClassAdapter.verify(new ClassReader(patched), loader, false, new PrintWriter(errors));
			Path file = out.resolve(target + ".class");
			Files.createDirectories(file.getParent());
			Files.write(file, patched);
			check(errors.toString().isBlank(), target + " Verifier: " + (errors.toString().isBlank() ? "ok" : "\n" + errors));
			ClassNode result = new ClassNode();
			new ClassReader(patched).accept(result, 0);
			if (target.equals(ServerLinkPatches.DISCARDED)) {
				MethodNode codec = result.methods.stream().filter(m -> m.name.equals("codec") && m.desc.startsWith("(Lnet/minecraft/resources/Identifier;I)")).findFirst().orElseThrow();
				check(calls(codec, hooks, "codec") == 1, "DiscardedPayload.codec fragt zuerst den Hook (eigener Codec für heldixclient:server)");
			} else {
				MethodNode handle = result.methods.stream().filter(m -> m.name.equals("handleCustomPayload")
						&& m.desc.equals("(Lnet/minecraft/network/protocol/common/custom/CustomPacketPayload;)V")).findFirst().orElseThrow();
				check(calls(handle, hooks, "payload") == 1, "ClientPacketListener.handleCustomPayload gibt Nachrichten des Kanals an den Hook");
			}
		}
	}

	/** Rechnungen des Item-Physics-Addons (wie im Prüfstand der ursprünglichen Mod) */
	private static void mathChecks() {
		// Höhe: flaches Item 0,5 hoch, 1/16 tief
		approx(ItemPhysicsMath.lift(-0.25, 0.25, -0.03125, 0.03125, 1, true, 0.0F), 0.25 + 0.005, "flach, aufrecht");
		approx(ItemPhysicsMath.lift(-0.25, 0.25, -0.03125, 0.03125, 1, true, 90.0F), 0.03125 + 0.005, "flach, liegend");
		approx(ItemPhysicsMath.lift(-0.25, 0.25, -0.03125, 0.03125, 1, true, 270.0F), 0.03125 + 0.005, "flach, Rückseite oben");
		// 3 Stück: Tiefe 0,0625, Abstand 1,5·0,0625, Stapel ±0,0625 → halbe Höhe 0,03125 + 0,09375
		approx(ItemPhysicsMath.lift(-0.25, 0.25, -0.03125, 0.03125, 3, true, 90.0F), 0.125 + 0.005, "flach, Stapel 3");
		// Block 0,25 Kante, auf der Seite
		approx(ItemPhysicsMath.lift(-0.125, 0.125, -0.125, 0.125, 1, false, 90.0F), 0.125 + 0.005, "Block, gekippt");
		approx(ItemPhysicsMath.lift(-0.125, 0.125, -0.125, 0.125, 2, false, 0.0F), 0.125 + 0.155, "Block, Stapel");
		// Winkel
		approx(ItemPhysicsMath.nearest(100.0F, 180.0F, 90.0F), 90.0, "nearest 100 -> 90");
		approx(ItemPhysicsMath.nearest(200.0F, 180.0F, 90.0F), 270.0, "nearest 200 -> 270");
		approx(ItemPhysicsMath.nearest(359.0F, 180.0F, 90.0F), 270.0, "nearest 359 -> 270 (89° statt 91° bis 450)");
		approx(ItemPhysicsMath.nearest(5.0F, 180.0F, 90.0F), 90.0, "nearest 5 -> 90");
		approx(ItemPhysicsMath.nearest(46.0F, 90.0F, 0.0F), 90.0, "nearest 46 -> 90");
		approx(ItemPhysicsMath.wrap(450.0F), 90.0, "wrap 450");
		approx(ItemPhysicsMath.wrap(-10.0F), 350.0, "wrap -10");
		// Hinlegen: 0,25 s = 18° pro Tick wie in der Mod; aufrecht → flach in 5 Ticks
		float speed = ItemPhysicsMath.settleSpeed(0.25);
		approx(speed, 18.0, "Hinlegen 0,25 s = 18°/Tick");
		float pitch = 0.0F;
		for (int i = 0; i < 5; i++) pitch = ItemPhysicsMath.tilt(pitch, 1.0F, true, true, true, speed, 1.0F, 0.0);
		approx(pitch, 90.0, "flaches Item liegt nach 5 Ticks flach");
		approx(ItemPhysicsMath.tilt(pitch, 1.0F, true, true, true, speed, 1.0F, 0.0), 90.0, "liegendes Item bleibt still");
		approx(ItemPhysicsMath.tilt(30.0F, 0.0F, true, true, true, Float.POSITIVE_INFINITY, 1.0F, 0.0), 90.0, "„Sofort“ legt ohne Zeit hin");
		approx(ItemPhysicsMath.tilt(50.0F, 1.0F, true, false, true, speed, 1.0F, 0.0), 68.0, "Block kippt zur nächsten Seite (90°)");
		approx(ItemPhysicsMath.tilt(30.0F, 1.0F, false, false, false, speed, 1.0F, 0.5), 12.0, "Block ohne Kippen richtet sich auf");
		// In der Luft: 8° + 60° je Block/Tick, Faktor aus der Einstellung
		approx(ItemPhysicsMath.tilt(0.0F, 1.0F, false, true, true, speed, 1.0F, 0.5), 38.0, "Luft: 8 + 0,5·60 = 38°/Tick");
		approx(ItemPhysicsMath.tilt(0.0F, 1.0F, false, true, true, speed, 0.0F, 0.5), 0.0, "Luft: Drehung aus");
		approx(ItemPhysicsMath.tilt(350.0F, 1.0F, false, true, true, speed, 2.0F, 0.0), 6.0, "Luft: doppelt, über 360° hinaus");
	}

	private static ClassNode read(ClassLoader loader, String name) throws Exception {
		byte[] original;
		try (InputStream in = loader.getResourceAsStream(name + ".class")) {
			if (in == null) throw new IllegalStateException(name + " nicht in der Minecraft-JAR");
			original = in.readAllBytes();
		}
		ClassNode node = new ClassNode();
		new ClassReader(original).accept(node, ClassReader.SKIP_FRAMES);
		return node;
	}

	private static byte[] write(ClassNode node, ClassLoader loader) {
		ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_FRAMES) {
			@Override
			protected ClassLoader getClassLoader() {
				return loader;
			}
		};
		node.accept(writer);
		return writer.toByteArray();
	}

	private static long calls(MethodNode method, String owner, String name) {
		return Arrays.stream(method.instructions.toArray()).filter(i -> i instanceof MethodInsnNode call && call.owner.equals(owner) && call.name.equals(name)).count();
	}

	private static void approx(double actual, double expected, String label) {
		check(Math.abs(actual - expected) < 1.0E-4, label + ": " + actual + " (erwartet " + expected + ")");
	}

	private static void check(boolean ok, String message) {
		if (!ok) failures++;
		System.out.println((ok ? "OK   " : "FEHL ") + message);
	}
}
