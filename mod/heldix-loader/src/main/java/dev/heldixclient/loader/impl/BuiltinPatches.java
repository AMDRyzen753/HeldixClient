package dev.heldixclient.loader.impl;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Code;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;

import java.util.Set;

/**
 * Die Eingriffe des Loaders selbst in Minecraft: Mods starten, Tasten, Übersetzungen und die
 * Events der Loader-API (Tick, HUD, Menüs, Welt, Chat, Beenden).
 *
 * <p>Jeder Eingriff wird einzeln angewendet; schlägt einer fehl (z. B. weil sich Minecraft
 * geändert hat), fehlt nur diese Funktion und der Fehler erscheint in {@code HeldixLoader.problems()}.
 */
final class BuiltinPatches implements ClassTransformer, Opcodes {
	private static final String HOOKS = "dev/heldixclient/loader/impl/LoaderHooks";

	private static final String MINECRAFT = "net/minecraft/client/Minecraft";
	private static final String OPTIONS = "net/minecraft/client/Options";
	private static final String LANGUAGE = "net/minecraft/client/resources/language/ClientLanguage";
	private static final String HUD = "net/minecraft/client/gui/Hud";
	private static final String SCREEN = "net/minecraft/client/gui/screens/Screen";
	private static final String CHAT = "net/minecraft/client/multiplayer/chat/ChatListener";
	private static final String PACKETS = "net/minecraft/client/multiplayer/ClientPacketListener";

	private static final String L_MINECRAFT = "L" + MINECRAFT + ";";
	private static final String L_SCREEN = "L" + SCREEN + ";";
	private static final String L_GRAPHICS = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;";
	private static final String L_DELTA = "Lnet/minecraft/client/DeltaTracker;";
	private static final String L_COMPONENT = "Lnet/minecraft/network/chat/Component;";
	private static final String L_KEYS = "[Lnet/minecraft/client/KeyMapping;";
	private static final String PACK_REPOSITORY = "net/minecraft/server/packs/repository/PackRepository";
	private static final String L_SOURCES = "[Lnet/minecraft/server/packs/repository/RepositorySource;";

	@Override
	public Set<String> targets() {
		return Set.of(MINECRAFT, OPTIONS, LANGUAGE, HUD, SCREEN, CHAT, PACKETS);
	}

	@Override
	public void transform(String className, ClassNode node) {
		switch (className) {
			case MINECRAFT -> minecraft(node);
			case OPTIONS -> options(node);
			case LANGUAGE -> language(node);
			case HUD -> hud(node);
			case SCREEN -> screen(node);
			case CHAT -> chat(node);
			case PACKETS -> packets(node);
			default -> {
			}
		}
	}

	private static void minecraft(ClassNode node) {
		patch("Mods starten", () -> Patches.afterFirstFieldWrite(
				Patches.method(node, "<init>", "(Lnet/minecraft/client/main/GameConfig;)V"), MINECRAFT, "gameDirectory",
				Code.begin().invokeStatic(HOOKS, "initMods", "()V")));
		patch("Ressourcen der Mods", () -> Patches.replaceCalls(
				Patches.method(node, "<init>", "(Lnet/minecraft/client/main/GameConfig;)V"), PACK_REPOSITORY, "<init>", "(" + L_SOURCES + ")V",
				call -> Code.begin()
						.invokeStatic(HOOKS, "packSources", "(" + L_SOURCES + ")" + L_SOURCES)
						.invokeSpecial(PACK_REPOSITORY, "<init>", "(" + L_SOURCES + ")V")));
		patch("Tick-Event", () -> Patches.beforeReturns(Patches.method(node, "tick", "()V"),
				() -> Code.begin().loadThis().invokeStatic(HOOKS, "tickEnd", "(" + L_MINECRAFT + ")V")));
		patch("Beenden-Event", () -> Patches.head(Patches.method(node, "close", "()V"),
				Code.begin().loadThis().invokeStatic(HOOKS, "stopping", "(" + L_MINECRAFT + ")V")));
		patch("Welt-verlassen-Event", () -> {
			MethodNode disconnect = Patches.method(node, "disconnect", "(" + L_SCREEN + "ZZ)V");
			MethodNode clearLevel = Patches.method(node, "clearClientLevel", "(" + L_SCREEN + ")V");
			Patches.head(disconnect, Code.begin().invokeStatic(HOOKS, "worldLeave", "()V"));
			Patches.head(clearLevel, Code.begin().invokeStatic(HOOKS, "worldLeave", "()V"));
		});
	}

	private static void options(ClassNode node) {
		patch("Tastenbelegungen", () -> Patches.beforeFieldWrite(
				Patches.method(node, "<init>", "(" + L_MINECRAFT + "Ljava/io/File;)V"), OPTIONS, "keyMappings",
				() -> Code.begin().invokeStatic(HOOKS, "keyMappings", "(" + L_KEYS + ")" + L_KEYS)));
	}

	private static void language(ClassNode node) {
		patch("Übersetzungen der Mods", () -> {
			MethodNode load = Patches.method(node, "loadFrom",
					"(Lnet/minecraft/server/packs/resources/ResourceManager;Ljava/util/List;Z)L" + LANGUAGE + ";");
			MethodNode get = Patches.method(node, "getOrDefault", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;");
			MethodNode has = Patches.method(node, "has", "(Ljava/lang/String;)Z");
			Patches.head(load, Code.begin().loadArg(load, 1).invokeStatic(HOOKS, "languages", "(Ljava/util/List;)V"));
			Patches.head(get, Code.begin().loadThis().getField(LANGUAGE, "storage", "Ljava/util/Map;").loadArg(get, 0)
					.invokeStatic(HOOKS, "translate", "(Ljava/util/Map;Ljava/lang/String;)Ljava/lang/String;")
					.returnIfNonNull());
			Patches.head(has, Code.begin().loadArg(has, 0).invokeStatic(HOOKS, "hasModTranslation", "(Ljava/lang/String;)Z")
					.ifTrue(Code.begin().insn(ICONST_1).insn(IRETURN)));
		});
	}

	private static void hud(ClassNode node) {
		patch("HUD-Event", () -> {
			MethodNode extract = Patches.method(node, "extractRenderState", "(" + L_GRAPHICS + L_DELTA + ")V");
			Patches.tail(extract, Code.begin().loadThis().invokeVirtual(HUD, "isHidden", "()Z").loadArgs(extract, 0, 1)
					.invokeStatic(HOOKS, "hud", "(Z" + L_GRAPHICS + L_DELTA + ")V"));
		});
	}

	private static void screen(ClassNode node) {
		patch("Menü-Event", () -> {
			MethodNode init = Patches.method(node, "init", "(II)V");
			MethodNode rebuild = Patches.method(node, "rebuildWidgets", "()V");
			for (MethodNode method : new MethodNode[] {init, rebuild}) {
				Patches.afterCalls(method, SCREEN, "init", "()V",
						() -> Code.begin().loadThis().invokeStatic(HOOKS, "screenInit", "(" + L_SCREEN + ")V"));
			}
		});
	}

	private static void chat(ClassNode node) {
		patch("Chat-Event", () -> {
			MethodNode system = Patches.method(node, "handleSystemMessage", "(" + L_COMPONENT + "Z)V");
			MethodNode player = Patches.method(node, "showMessageToPlayer",
					"(Lnet/minecraft/network/chat/ChatType$Bound;Lnet/minecraft/network/chat/PlayerChatMessage;" + L_COMPONENT
							+ "Lcom/mojang/authlib/GameProfile;ZLjava/time/Instant;)Z");
			MethodNode disguised = Patches.method(node, "handleDisguisedChatMessage", "(" + L_COMPONENT + "Lnet/minecraft/network/chat/ChatType$Bound;)V");
			Patches.head(system, Code.begin().loadArgs(system, 0, 1).invokeStatic(HOOKS, "systemChat", "(" + L_COMPONENT + "Z)V"));
			Patches.head(player, Code.begin().loadArg(player, 2).invokeStatic(HOOKS, "playerChat", "(" + L_COMPONENT + ")V"));
			Patches.head(disguised, Code.begin().loadArg(disguised, 0).invokeStatic(HOOKS, "playerChat", "(" + L_COMPONENT + ")V"));
		});
	}

	private static void packets(ClassNode node) {
		// Läuft erst im Hauptthread bis zum Ende (im Netzwerk-Thread bricht ensureRunningOnSameThread ab)
		patch("Welt-betreten-Event", () -> Patches.beforeReturns(
				Patches.method(node, "handleLogin", "(Lnet/minecraft/network/protocol/game/ClientboundLoginPacket;)V"),
				() -> Code.begin().invokeStatic(HOOKS, "worldJoin", "()V")));
	}

	private static void patch(String name, Runnable patch) {
		try {
			patch.run();
		} catch (RuntimeException e) {
			LoaderCore.problem("Patch \"" + name + "\" fehlgeschlagen: " + e.getMessage());
			LoaderCore.LOG.error("Heldix Loader: Patch \"{}\" fehlgeschlagen", name, e);
		}
	}
}
