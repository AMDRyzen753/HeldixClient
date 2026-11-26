package dev.heldixclient.transform;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Code;
import dev.heldixclient.loader.api.transform.Patches;
import dev.heldixclient.loader.api.transform.PatchException;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

import java.util.List;
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
	private static final String LOADING = "net/minecraft/client/gui/screens/LoadingOverlay";
	private static final String GUI = "net/minecraft/client/gui/Gui";
	private static final String CLIENT_PLAYER = "net/minecraft/client/player/AbstractClientPlayer";
	private static final String PLAYER_SKIN = "Lnet/minecraft/world/entity/player/PlayerSkin;";
	private static final String CAPE_LAYER = "net/minecraft/client/renderer/entity/layers/CapeLayer";
	private static final String COLLECTOR = "net/minecraft/client/renderer/SubmitNodeCollector";
	private static final String SUBMIT_MODEL = "(Lnet/minecraft/client/model/Model;Ljava/lang/Object;Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/rendertype/RenderType;III)V";

	private static final String HUD = "net/minecraft/client/gui/Hud";
	private static final String ENTITY = "net/minecraft/world/entity/Entity";
	private static final String KEYBOARD_INPUT = "net/minecraft/client/player/KeyboardInput";
	private static final String KEY_MAPPING = "net/minecraft/client/KeyMapping";
	private static final String CHAT = "net/minecraft/client/gui/components/ChatComponent";
	private static final String CHAT_SCREEN = "net/minecraft/client/gui/screens/ChatScreen";
	private static final String TAB_LIST = "net/minecraft/client/gui/components/PlayerTabOverlay";
	private static final String ENTITY_RENDERER = "net/minecraft/client/renderer/entity/EntityRenderer";
	private static final String COMPONENT = "Lnet/minecraft/network/chat/Component;";
	private static final String EDIT_BOX = "Lnet/minecraft/client/gui/components/EditBox;";
	private static final String LEVEL_LOADING = "net/minecraft/client/gui/screens/LevelLoadingScreen";
	private static final String CONNECT = "net/minecraft/client/gui/screens/ConnectScreen";
	private static final String DELTA = "Lnet/minecraft/client/DeltaTracker;";

	private static final String G = "L" + GRAPHICS + ";";
	private static final String L_TITLE = "L" + TITLE + ";";
	private static final String PIPELINE = "Lcom/mojang/renderpearl/api/pipeline/RenderPipeline;";
	private static final String IDENTIFIER = "Lnet/minecraft/resources/Identifier;";

	@Override
	public Set<String> targets() {
		return Set.of(CAMERA, MINECRAFT, MOUSE, GRAPHICS, SELECTION_LIST, TITLE, GAME_RENDERER, DEBUG_OVERLAY, FRAMERATE, LOADING, GUI, CLIENT_PLAYER, CAPE_LAYER,
				HUD, ENTITY, KEYBOARD_INPUT, CHAT, CHAT_SCREEN, TAB_LIST, ENTITY_RENDERER, LEVEL_LOADING, CONNECT);
	}

	@Override
	public void transform(String className, ClassNode node) {
		switch (className) {
			case CAMERA -> camera(node);
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
			case LOADING -> loadingOverlay(node);
			// Hintergrund-FPS: Bildrate begrenzen, solange das Fenster nicht im Vordergrund ist
			case FRAMERATE -> Patches.modifyReturnValue(Patches.method(node, "getFramerateLimit", "()I"), HOOKS, "framerateLimit", "(I)I");
			// Einzel- und Mehrspieler-Menü durch die Heldix-Seiten ersetzen (auch wenn andere Mods sie öffnen)
			case GUI -> {
				MethodNode setScreen = Patches.method(node, "setScreen", "(L" + SCREEN + ";)V");
				Patches.head(setScreen, Code.begin().loadArg(setScreen, 0)
						.invokeStatic(HOOKS, "replaceScreen", "(L" + SCREEN + ";)L" + SCREEN + ";")
						.add(new VarInsnNode(ASTORE, 1)));
			}
			// Cape: der Skin des eigenen Spielers bekommt das gewählte Heldix-Cape
			case CLIENT_PLAYER -> {
				MethodNode getSkin = Patches.method(node, "getSkin", "()" + PLAYER_SKIN);
				Patches.beforeReturns(getSkin, () -> Code.begin().loadThis()
						.invokeStatic(HOOKS, "playerSkin", "(" + PLAYER_SKIN + "L" + CLIENT_PLAYER + ";)" + PLAYER_SKIN));
			}
			// Cape: leuchtende Teile der Heldix-Capes als zweiter Durchgang
			case CAPE_LAYER -> {
				MethodNode submit = Patches.method(node, "submit", "(Lcom/mojang/blaze3d/vertex/PoseStack;L" + COLLECTOR
						+ ";ILnet/minecraft/client/renderer/entity/state/AvatarRenderState;FF)V");
				Patches.replaceCalls(submit, COLLECTOR, "submitModel", SUBMIT_MODEL,
						i -> Code.begin().invokeStatic(HOOKS, "capeModel", "(L" + COLLECTOR + ";" + SUBMIT_MODEL.substring(1)));
			}
			case HUD -> hud(node);
			// Ladebildschirme (Welt laden, verbinden): Tipp-Karte mit Spielfigur
			case LEVEL_LOADING, CONNECT -> {
				MethodNode render = Patches.method(node, "extractRenderState", "(" + G + "IIF)V");
				Patches.beforeReturns(render, () -> Code.begin().loadThis().loadArg(render, 0)
						.invokeStatic(HOOKS, "loadingTips", "(L" + SCREEN + ";" + G + ")V"));
			}
			// Freelook: Mausbewegung dreht nur die Kamera
			case ENTITY -> {
				MethodNode turn = Patches.method(node, "turn", "(DD)V");
				Patches.cancelAtHead(turn, Code.begin().loadThis().loadArgs(turn, 0, 1).invokeStatic(HOOKS, "turn", "(L" + ENTITY + ";DD)Z"));
			}
			// Dauersprint / Dauerschleichen: Sprint- (7. Taste) und Schleichtaste (6.) gelten als gedrückt
			case KEYBOARD_INPUT -> Patches.replaceCalls(Patches.method(node, "tick", "()V"), KEY_MAPPING, "isDown", "()Z", call -> switch (call) {
				case 5 -> Code.begin().invokeStatic(HOOKS, "sneakKey", "(L" + KEY_MAPPING + ";)Z");
				case 6 -> Code.begin().invokeStatic(HOOKS, "sprintKey", "(L" + KEY_MAPPING + ";)Z");
				default -> null;
			});
			// Chat: Uhrzeit und gestapelte Nachrichten (neuer Inhalt für addMessage)
			case CHAT -> {
				MethodNode add = Patches.method(node, "addMessage", "(" + COMPONENT + "Lnet/minecraft/network/chat/MessageSignature;"
						+ "Lnet/minecraft/client/multiplayer/chat/GuiMessageSource;Lnet/minecraft/client/multiplayer/chat/GuiMessageTag;)V");
				Patches.head(add, Code.begin().loadThis().loadArg(add, 0)
						.invokeStatic(HOOKS, "chatMessage", "(L" + CHAT + ";" + COMPONENT + ")" + COMPONENT)
						.add(new VarInsnNode(ASTORE, 1)));
			}
			// Chat: Strg+Klick kopiert eine Nachricht; Addon-Befehle („.np“) statt Senden, Tab und Vorschläge dafür
			case CHAT_SCREEN -> {
				MethodNode click = Patches.method(node, "mouseClicked", "(Lnet/minecraft/client/input/MouseButtonEvent;Z)Z");
				Patches.head(click, Code.begin().loadArg(click, 0)
						.invokeStatic(HOOKS, "chatClick", "(Lnet/minecraft/client/input/MouseButtonEvent;)Z")
						.ifTrue(Code.begin().insn(ICONST_1).insn(IRETURN)));
				MethodNode input = Patches.method(node, "handleChatInput", "(Ljava/lang/String;Z)V");
				Patches.cancelAtHead(input, Code.begin().loadArgs(input, 0, 1).invokeStatic(HOOKS, "chatInput", "(Ljava/lang/String;Z)Z"));
				MethodNode key = Patches.method(node, "keyPressed", "(Lnet/minecraft/client/input/KeyEvent;)Z");
				Patches.head(key, Code.begin().loadThis().getField(CHAT_SCREEN, "input", EDIT_BOX).loadArg(key, 0)
						.invokeStatic(HOOKS, "chatKey", "(" + EDIT_BOX + "Lnet/minecraft/client/input/KeyEvent;)Z")
						.ifTrue(Code.begin().insn(ICONST_1).insn(IRETURN)));
				MethodNode render = Patches.method(node, "extractRenderState", "(" + G + "IIF)V");
				Patches.tail(render, Code.begin().loadThis().getField(CHAT_SCREEN, "input", EDIT_BOX).loadArg(render, 0)
						.invokeStatic(HOOKS, "chatHints", "(" + EDIT_BOX + G + ")V"));
			}
			case TAB_LIST -> tabList(node);
			// Namensschild über dem Kopf: Heldix-Symbol vor dem Namen. getNameTag wird nur gefragt, wenn Minecraft das
			// Schild überhaupt zeigt (nicht unsichtbar, nicht vom Server über Teams ausgeblendet); mit F1 lässt der Hook
			// das Symbol weg. Schleichen macht Minecraft das ganze Schild blass, das Symbol eingeschlossen.
			case ENTITY_RENDERER -> {
				MethodNode nameTag = Patches.method(node, "getNameTag", "(L" + ENTITY + ";)" + COMPONENT);
				Patches.beforeReturns(nameTag, () -> Code.begin().loadArg(nameTag, 0)
						.invokeStatic(HOOKS, "nameTag", "(" + COMPONENT + "L" + ENTITY + ";)" + COMPONENT));
			}
			default -> {
			}
		}
	}

	/**
	 * Tab-Liste: Heldix-Symbol vor dem Namen von HeldixClient-Spielern und die Zeile „HeldixClient: … Spieler hier“
	 * unter der Fußzeile des Servers (jedes Lesen von {@code footer} beim Zeichnen geht durch den Hook).
	 */
	private static void tabList(ClassNode node) {
		MethodNode name = Patches.method(node, "getNameForDisplay", "(Lnet/minecraft/client/multiplayer/PlayerInfo;)" + COMPONENT);
		Patches.beforeReturns(name, () -> Code.begin().loadArg(name, 0)
				.invokeStatic(HOOKS, "tabName", "(" + COMPONENT + "Lnet/minecraft/client/multiplayer/PlayerInfo;)" + COMPONENT));
		MethodNode render = Patches.method(node, "extractRenderState",
				"(" + G + "ILnet/minecraft/world/scores/Scoreboard;Lnet/minecraft/world/scores/Objective;)V");
		List<AbstractInsnNode> reads = Patches.find(render, insn -> insn instanceof FieldInsnNode field && field.getOpcode() == GETFIELD
				&& field.owner.equals(TAB_LIST) && field.name.equals("footer"));
		if (reads.isEmpty()) throw new PatchException(TAB_LIST + ".extractRenderState liest footer nicht");
		for (AbstractInsnNode read : reads) {
			render.instructions.insert(read, Code.begin().invokeStatic(HOOKS, "tabFooter", "(" + COMPONENT + ")" + COMPONENT).build());
		}
	}

	/** Zoom (Sichtfeld) und Freelook (Blickwinkel der Kamera). */
	private static void camera(ClassNode node) {
		// Zoom: berechnetes Sichtfeld durch den Zoomfaktor teilen
		Patches.modifyReturnValue(Patches.method(node, "calculateFov", "(F)F"), HOOKS, "fov", "(F)F");
		// Freelook: Kamera übernimmt eigene Winkel statt der des Spielers
		MethodNode align = Patches.method(node, "alignWithEntity", "(F)V");
		Patches.replaceCalls(align, ENTITY, "getViewYRot", "(F)F", call -> Code.begin().invokeStatic(HOOKS, "cameraYaw", "(L" + ENTITY + ";F)F"));
		Patches.replaceCalls(align, ENTITY, "getViewXRot", "(F)F", call -> Code.begin().invokeStatic(HOOKS, "cameraPitch", "(L" + ENTITY + ";F)F"));
	}

	/** Fadenkreuz (nur das Bild, Bedingungen bleiben Vanilla) und Trank-Symbole oben rechts. */
	private static void hud(ClassNode node) {
		MethodNode crosshair = Patches.method(node, "extractCrosshair", "(" + G + DELTA + ")V");
		String blit = "(" + PIPELINE + IDENTIFIER + "IIII)V";
		Patches.replaceCalls(crosshair, GRAPHICS, "blitSprite", blit,
				call -> call == 0 ? Code.begin().invokeStatic(HOOKS, "crosshair", "(" + G + blit.substring(1)) : null);
		MethodNode effects = Patches.method(node, "extractEffects", "(" + G + DELTA + ")V");
		Patches.cancelAtHead(effects, Code.begin().invokeStatic(HOOKS, "hideVanillaEffects", "()Z"));
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

	/**
	 * Ladebildschirm: Hintergrundfarbe, Mojang-Logo und Ladebalken durch das Heldix-Design ersetzen.
	 * Die Logik (und der Rückfall auf Vanilla bei "Design: Vanilla") steckt in LoadingScreen.
	 */
	private static void loadingOverlay(ClassNode node) {
		MethodNode register = Patches.method(node, "registerTextures", "(Lnet/minecraft/client/renderer/texture/TextureManager;)V");
		MethodNode extract = Patches.method(node, "extractRenderState", "(" + G + "IIF)V");
		MethodNode bar = Patches.method(node, "extractProgressBar", "(" + G + "IIIIF)V");
		Patches.tail(register, Code.begin().loadArg(register, 0)
				.invokeStatic(HOOKS, "loadingTextures", "(Lnet/minecraft/client/renderer/texture/TextureManager;)V"));
		// BRAND_BACKGROUND.getAsInt() -> Hooks.loadingBackground(BRAND_BACKGROUND)
		Patches.replaceCalls(extract, "java/util/function/IntSupplier", "getAsInt", "()I",
				call -> Code.begin().invokeStatic(HOOKS, "loadingBackground", "(Ljava/util/function/IntSupplier;)I"));
		// die zwei Hälften des Mojang-Logos
		String blit = "(" + PIPELINE + IDENTIFIER + "IIFFIIIIIII)V";
		Patches.replaceCalls(extract, GRAPHICS, "blit", blit,
				call -> Code.begin().invokeStatic(HOOKS, call == 0 ? "loadingLogo" : "loadingLogoSecondHalf", "(" + G + blit.substring(1)));
		// if (Hooks.loadingProgress(this, g, opacity)) return;
		Patches.cancelAtHead(bar, Code.begin().loadThis().loadArg(bar, 0).loadArg(bar, 5)
				.invokeStatic(HOOKS, "loadingProgress", "(L" + LOADING + ";" + G + "F)Z"));
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
		// if (Hooks.titleActive(this)) { Hooks.titleDecorations(this, g); super.extractRenderState(…); Hooks.titleAfterRender(this, g); return; }
		Patches.head(render, Code.begin().loadThis().invokeStatic(HOOKS, "titleActive", "(" + L_TITLE + ")Z")
				.ifTrue(Code.begin()
						.loadThis().loadArg(render, 0).invokeStatic(HOOKS, "titleDecorations", "(" + L_TITLE + G + ")V")
						.loadThis().loadArgs(render, 0, 1, 2, 3).invokeSpecial(SCREEN, "extractRenderState", "(" + G + "IIF)V")
						.loadThis().loadArg(render, 0).invokeStatic(HOOKS, "titleAfterRender", "(" + L_TITLE + G + ")V")
						.returnVoid()));
	}
}
