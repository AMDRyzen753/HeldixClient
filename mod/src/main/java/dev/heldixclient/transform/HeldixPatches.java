package dev.heldixclient.transform;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Code;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;

import java.util.Set;

/**
 * Die Eingriffe von HeldixClient in Minecraft (ersetzt die früheren Mixins).
 * Die Logik steckt in {@link Hooks}; hier wird nur festgelegt, wo sie aufgerufen wird.
 *
 * <p>Wichtig: Diese Klasse wird vor Minecraft geladen und darf deshalb keine
 * Minecraft-Klassen benutzen – nur deren Namen als Text.
 */
public final class HeldixPatches implements ClassTransformer, Opcodes {
	private static final String HOOKS = "dev/heldixclient/transform/Hooks";

	private static final String CAMERA = "net/minecraft/client/Camera";
	private static final String MINECRAFT = "net/minecraft/client/Minecraft";
	private static final String MOUSE = "net/minecraft/client/MouseHandler";
	private static final String GRAPHICS = "net/minecraft/client/gui/GuiGraphicsExtractor";
	private static final String SELECTION_LIST = "net/minecraft/client/gui/components/AbstractSelectionList";
	private static final String TITLE = "net/minecraft/client/gui/screens/TitleScreen";
	private static final String SCREEN = "net/minecraft/client/gui/screens/Screen";
	private static final String GAME_RENDERER = "net/minecraft/client/renderer/GameRenderer";
	private static final String DEBUG_OVERLAY = "net/minecraft/client/gui/components/DebugScreenOverlay";
	private static final String FRAMERATE = "com/mojang/blaze3d/platform/FramerateLimitTracker";

	private static final String G = "L" + GRAPHICS + ";";
	private static final String L_TITLE = "L" + TITLE + ";";
	private static final String PIPELINE = "Lcom/mojang/renderpearl/api/pipeline/RenderPipeline;";
	private static final String IDENTIFIER = "Lnet/minecraft/resources/Identifier;";

	@Override
	public Set<String> targets() {
		return Set.of(CAMERA, MINECRAFT, MOUSE, GRAPHICS, SELECTION_LIST, TITLE, GAME_RENDERER, DEBUG_OVERLAY, FRAMERATE);
	}

	@Override
	public void transform(String className, ClassNode node) {
		switch (className) {
			// Zoom: berechnetes Sichtfeld durch den Zoomfaktor teilen
			case CAMERA -> Patches.modifyReturnValue(Patches.method(node, "calculateFov", "(F)F"), HOOKS, "fov", "(F)F");
			// Fenstertitel "HeldixClient 0.6.0 | Minecraft 26.3"
			case MINECRAFT -> Patches.modifyReturnValue(Patches.method(node, "createTitle", "()Ljava/lang/String;"),
					HOOKS, "windowTitle", "(Ljava/lang/String;)Ljava/lang/String;");
			case MOUSE -> mouse(node);
			case GRAPHICS -> graphics(node);
			case SELECTION_LIST -> selectionList(node);
			case TITLE -> titleScreen(node);
			// Shader: gewählten Stil zu den Post-Effekten dieses Bildes hinzufügen
			case GAME_RENDERER -> {
				MethodNode update = Patches.method(node, "update", "(Lnet/minecraft/client/DeltaTracker;)V");
				Patches.beforeReturns(update, () -> Code.begin().loadThis()
						.invokeVirtual(GAME_RENDERER, "getRequestedPostEffects", "()Ljava/util/List;")
						.invokeStatic(HOOKS, "postEffects", "(Ljava/util/List;)V"));
			}
			case DEBUG_OVERLAY -> debugOverlay(node);
			// Hintergrund-FPS: Bildrate begrenzen, solange das Fenster nicht im Vordergrund ist
			case FRAMERATE -> Patches.modifyReturnValue(Patches.method(node, "getFramerateLimit", "()I"), HOOKS, "framerateLimit", "(I)I");
			default -> {
			}
		}
	}

	/** Klicks zählen (CPS) und Mausrad beim Zoomen abfangen. */
	private static void mouse(ClassNode node) {
		MethodNode button = Patches.method(node, "onButton", "(JLnet/minecraft/client/input/MouseButtonInfo;I)V");
		MethodNode scroll = Patches.method(node, "onScroll", "(JDD)V");
		Patches.head(button, Code.begin().loadArgs(button, 1, 2)
				.invokeStatic(HOOKS, "mouseButton", "(Lnet/minecraft/client/input/MouseButtonInfo;I)V"));
		Patches.cancelAtHead(scroll, Code.begin().loadArg(scroll, 2).invokeStatic(HOOKS, "mouseScroll", "(D)Z"));
	}

	/**
	 * Zentrale Stellen, an denen Minecraft Widget-Grafiken zeichnet: Buttons, Textfelder, Schieberegler,
	 * Scrollbalken, Menü-Hintergründe und Trennlinien bekommen hier das Heldix-Design.
	 * Die übrigen blit/blitSprite-Varianten leiten alle auf diese beiden weiter.
	 */
	private static void graphics(ClassNode node) {
		MethodNode sprite = Patches.method(node, "blitSprite", "(" + PIPELINE + IDENTIFIER + "IIIII)V");
		MethodNode texture = Patches.method(node, "blit", "(" + PIPELINE + IDENTIFIER + "IIFFIIIIIII)V");
		// blitSprite(pipeline, sprite, x, y, width, height, color)
		Patches.cancelAtHead(sprite, Code.begin().loadThis().loadArgs(sprite, 1, 2, 3, 4, 5, 6)
				.invokeStatic(HOOKS, "sprite", "(" + G + IDENTIFIER + "IIIII)Z"));
		// blit(pipeline, texture, x, y, u, v, width, height, …)
		Patches.cancelAtHead(texture, Code.begin().loadThis().loadArgs(texture, 1, 2, 3, 6, 7)
				.invokeStatic(HOOKS, "texture", "(" + G + IDENTIFIER + "IIII)Z"));
	}

	/** F3-Menü: Zeilenhintergründe (fill mit Grau) im Heldix-Design zeichnen. */
	private static void debugOverlay(ClassNode node) {
		MethodNode lines = Patches.method(node, "extractLines", "(" + G + "Ljava/util/List;ZI)V");
		// fill(x1, y1, x2, y2, color) -> Hooks.debugLine(g, x1, y1, x2, y2, color, left)
		Patches.replaceCalls(lines, GRAPHICS, "fill", "(IIIII)V",
				call -> Code.begin().loadArg(lines, 2).invokeStatic(HOOKS, "debugLine", "(" + G + "IIIIIZ)V"));
	}

	/** Ausgewählter Listeneintrag: Vanilla zeichnet Rahmen (1. fill) und schwarze Innenfläche (2. fill). */
	private static void selectionList(ClassNode node) {
		MethodNode method = Patches.method(node, "extractSelection",
				"(" + G + "Lnet/minecraft/client/gui/components/AbstractSelectionList$Entry;I)V");
		Patches.replaceCalls(method, GRAPHICS, "fill", "(IIIII)V", call -> switch (call) {
			case 0 -> Code.begin().invokeStatic(HOOKS, "selectionFrame", "(" + G + "IIIII)V");
			case 1 -> Code.begin().invokeStatic(HOOKS, "selectionInner", "(" + G + "IIIII)V");
			default -> null;
		});
	}

	/**
	 * Hauptmenü: Aufbau und Aussehen durch das HeldixClient-Hauptmenü ersetzen.
	 * Die Klasse bleibt ein TitleScreen, damit Minecraft und andere Mods ihn weiterhin erkennen.
	 */
	private static void titleScreen(ClassNode node) {
		MethodNode init = Patches.method(node, "init", "()V");
		MethodNode background = Patches.method(node, "extractBackground", "(" + G + "IIF)V");
		MethodNode render = Patches.method(node, "extractRenderState", "(" + G + "IIF)V");

		// if (Hooks.titleInit(this)) return;
		Patches.cancelAtHead(init, Code.begin().loadThis().invokeStatic(HOOKS, "titleInit", "(" + L_TITLE + ")Z"));

		// if (Hooks.titleActive(this)) { extractPanorama(g, delta); Hooks.titleBackground(this, g); return; }
		Patches.head(background, Code.begin().loadThis().invokeStatic(HOOKS, "titleActive", "(" + L_TITLE + ")Z")
				.ifTrue(Code.begin()
						.loadThis().loadArgs(background, 0, 3).invokeVirtual(TITLE, "extractPanorama", "(" + G + "F)V")
						.loadThis().loadArg(background, 0).invokeStatic(HOOKS, "titleBackground", "(" + L_TITLE + G + ")V")
						.returnVoid()));

		// Vanilla-Menü (Design aus): Heldix-Abzeichen am Ende zeichnen
		Patches.beforeReturns(render, () -> Code.begin().loadThis().loadArg(render, 0)
				.invokeStatic(HOOKS, "titleAfterRender", "(" + L_TITLE + G + ")V"));
		// if (Hooks.titleActive(this)) { Hooks.titleDecorations(this, g); super.extractRenderState(…); return; }
		Patches.head(render, Code.begin().loadThis().invokeStatic(HOOKS, "titleActive", "(" + L_TITLE + ")Z")
				.ifTrue(Code.begin()
						.loadThis().loadArg(render, 0).invokeStatic(HOOKS, "titleDecorations", "(" + L_TITLE + G + ")V")
						.loadThis().loadArgs(render, 0, 1, 2, 3).invokeSpecial(SCREEN, "extractRenderState", "(" + G + "IIF)V")
						.returnVoid()));
	}
}
