package dev.heldixclient.transform;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Code;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;

import java.util.Set;

/**
 * Eingriffe für den Kanal {@code heldixclient:server} zum Server-Plugin „HeldixClient Server“
 * ({@link dev.heldixclient.serverlink.ServerLink}). Die Logik steckt in {@link ServerLinkHooks}.
 *
 * <ul>
 *   <li>{@code DiscardedPayload.codec(Identifier, int)} (am Anfang): Seit 1.20.5 verwirft Minecraft unbekannte
 *       Custom-Payloads schon beim Lesen. Für {@code heldixclient:server} (lesen und schreiben) und
 *       {@code minecraft:register} (schreiben) liefert der Hook einen eigenen Codec; für alle anderen Kanäle null, dann läuft
 *       Minecrafts Code unverändert weiter.</li>
 *   <li>{@code ClientPacketListener.handleCustomPayload(CustomPacketPayload)} (am Anfang, Haupt-Thread): eine Nachricht
 *       auf dem Kanal geht an {@link dev.heldixclient.serverlink.ServerLink} statt in Minecrafts Warnung „Unknown custom
 *       packet payload“.</li>
 * </ul>
 *
 * <p>In Fabric braucht {@code DiscardedPayload} den Heldix Loader 2.5.0 (Ziel in {@code Targets}); ist Fabric API da,
 * läuft der Kanal stattdessen über deren Schnittstelle ({@link dev.heldixclient.serverlink.FabricNetworking}).
 *
 * <p>Wichtig: Diese Klasse wird vor Minecraft geladen und benutzt keine Minecraft-Klassen, nur deren Namen als Text.
 * Beide Methoden werden gesucht, bevor etwas geändert wird.
 */
public final class ServerLinkPatches implements ClassTransformer, Opcodes {
	private static final String HOOKS = "dev/heldixclient/transform/ServerLinkHooks";

	static final String DISCARDED = "net/minecraft/network/protocol/common/custom/DiscardedPayload";
	static final String PACKETS = "net/minecraft/client/multiplayer/ClientPacketListener";
	private static final String IDENTIFIER = "Lnet/minecraft/resources/Identifier;";
	private static final String STREAM_CODEC = "Lnet/minecraft/network/codec/StreamCodec;";
	private static final String PAYLOAD = "Lnet/minecraft/network/protocol/common/custom/CustomPacketPayload;";

	@Override
	public Set<String> targets() {
		return Set.of(DISCARDED, PACKETS);
	}

	@Override
	public void transform(String className, ClassNode node) {
		switch (className) {
			case DISCARDED -> {
				// StreamCodec c = ServerLinkHooks.codec(id, max); if (c != null) return c;
				MethodNode codec = Patches.method(node, "codec", "(" + IDENTIFIER + "I)" + STREAM_CODEC);
				Patches.head(codec, Code.begin().loadArgs(codec, 0, 1)
						.invokeStatic(HOOKS, "codec", "(" + IDENTIFIER + "I)" + STREAM_CODEC)
						.returnIfNonNull());
			}
			case PACKETS -> {
				// if (ServerLinkHooks.payload(payload)) return;
				MethodNode handle = Patches.method(node, "handleCustomPayload", "(" + PAYLOAD + ")V");
				Patches.cancelAtHead(handle, Code.begin().loadArg(handle, 0).invokeStatic(HOOKS, "payload", "(" + PAYLOAD + ")Z"));
			}
			default -> {
			}
		}
	}
}
