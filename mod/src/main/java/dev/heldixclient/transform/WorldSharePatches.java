package dev.heldixclient.transform;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Code;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;

import java.util.Set;

/**
 * Eingriffe für „Welt teilen“ ({@link dev.heldixclient.share.WorldShare}) in den eingebauten Server von Minecraft.
 * Die Logik steckt in {@link WorldShareHooks}; ohne geteilte Welt geben die Hooks genau die Werte von Minecraft zurück.
 *
 * <ul>
 *   <li>{@code IntegratedPlayerList.canPlayerLogin}: Zugang mit der echten UUID (nach der Prüfung durch Mojang) – wer
 *       nicht darf, wird mit deutscher Meldung getrennt und klopft an.</li>
 *   <li>{@code IntegratedServer.getProfilePermissions}: Gastgeber immer mit allen Befehlen, Rolle Operator mit Befehlen.</li>
 *   <li>{@code IntegratedServer.getMaxPlayers}: Höchstspieler der geteilten Welt statt fest 8.</li>
 *   <li>{@code PlayerList.placeNewPlayer} (am Ende): Spielmodus nach Rolle.</li>
 *   <li>{@code ConnectScreen.startConnecting} (am Anfang): Adresse merken – weckt der Beitritt eine schlafende dauerhafte
 *       Welt (Dienst 1.13.0), versucht {@link dev.heldixclient.share.HostedJoin} es nach 30 s von selbst noch einmal.</li>
 * </ul>
 *
 * <p>Wichtig: Diese Klasse wird vor Minecraft geladen und benutzt keine Minecraft-Klassen, nur deren Namen als Text.
 * Alle Methoden werden gesucht, bevor etwas geändert wird: Fehlt eine, bleibt die Klasse ganz unverändert.
 */
public final class WorldSharePatches implements ClassTransformer, Opcodes {
	private static final String HOOKS = "dev/heldixclient/transform/WorldShareHooks";

	static final String INTEGRATED_SERVER = "net/minecraft/client/server/IntegratedServer";
	static final String INTEGRATED_PLAYER_LIST = "net/minecraft/client/server/IntegratedPlayerList";
	static final String PLAYER_LIST = "net/minecraft/server/players/PlayerList";
	static final String CONNECT_SCREEN = "net/minecraft/client/gui/screens/ConnectScreen";
	private static final String SERVER_DATA = "Lnet/minecraft/client/multiplayer/ServerData;";
	private static final String START_CONNECTING = "(Lnet/minecraft/client/gui/screens/Screen;Lnet/minecraft/client/Minecraft;"
			+ "Lnet/minecraft/client/multiplayer/resolver/ServerAddress;" + SERVER_DATA + "ZLnet/minecraft/client/multiplayer/TransferState;)V";
	private static final String NAME_AND_ID = "Lnet/minecraft/server/players/NameAndId;";
	private static final String COMPONENT = "Lnet/minecraft/network/chat/Component;";
	private static final String PERMISSIONS = "Lnet/minecraft/server/permissions/LevelBasedPermissionSet;";
	private static final String SERVER_PLAYER = "Lnet/minecraft/server/level/ServerPlayer;";
	private static final String PLACE_DESC = "(Lnet/minecraft/network/Connection;" + SERVER_PLAYER + "Lnet/minecraft/server/network/CommonListenerCookie;)V";

	@Override
	public Set<String> targets() {
		return Set.of(INTEGRATED_SERVER, INTEGRATED_PLAYER_LIST, PLAYER_LIST, CONNECT_SCREEN);
	}

	@Override
	public void transform(String className, ClassNode node) {
		switch (className) {
			case INTEGRATED_PLAYER_LIST -> {
				// return WorldShareHooks.canPlayerLogin(<Ergebnis>, this, nameAndId);
				MethodNode login = Patches.method(node, "canPlayerLogin", "(Ljava/net/SocketAddress;" + NAME_AND_ID + ")" + COMPONENT);
				Patches.beforeReturns(login, () -> Code.begin().loadThis().loadArg(login, 1)
						.invokeStatic(HOOKS, "canPlayerLogin", "(" + COMPONENT + "L" + INTEGRATED_PLAYER_LIST + ";" + NAME_AND_ID + ")" + COMPONENT));
			}
			case INTEGRATED_SERVER -> {
				MethodNode permissions = Patches.method(node, "getProfilePermissions", "(" + NAME_AND_ID + ")" + PERMISSIONS);
				MethodNode maxPlayers = Patches.method(node, "getMaxPlayers", "()I");
				Patches.beforeReturns(permissions, () -> Code.begin().loadThis().loadArg(permissions, 0)
						.invokeStatic(HOOKS, "permissions", "(" + PERMISSIONS + "L" + INTEGRATED_SERVER + ";" + NAME_AND_ID + ")" + PERMISSIONS));
				Patches.beforeReturns(maxPlayers, () -> Code.begin().loadThis()
						.invokeStatic(HOOKS, "maxPlayers", "(IL" + INTEGRATED_SERVER + ";)I"));
			}
			case PLAYER_LIST -> {
				MethodNode place = Patches.method(node, "placeNewPlayer", PLACE_DESC);
				Patches.tail(place, Code.begin().loadThis().loadArg(place, 1)
						.invokeStatic(HOOKS, "playerJoined", "(L" + PLAYER_LIST + ";" + SERVER_PLAYER + ")V"));
			}
			case CONNECT_SCREEN -> {
				// statisch: Parameter 3 ist ServerData (Name und Adresse)
				MethodNode start = Patches.method(node, "startConnecting", START_CONNECTING);
				Patches.head(start, Code.begin().loadArg(start, 3).invokeStatic(HOOKS, "connecting", "(" + SERVER_DATA + ")V"));
			}
			default -> {
			}
		}
	}
}
