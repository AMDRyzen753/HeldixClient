package dev.heldixclient.transform;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.serverlink.ServerLink;
import dev.heldixclient.serverlink.ServerPayload;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * Wird von den durch {@link ServerLinkPatches} veränderten Klassen aufgerufen. Fehler fallen immer auf das Verhalten von
 * Minecraft zurück (verwerfen bzw. Warnung im Log) – der Kanal darf nie eine Verbindung stören.
 */
public final class ServerLinkHooks {
	private static boolean errorLogged;

	private ServerLinkHooks() {
	}

	/** DiscardedPayload.codec (Netzwerk-Thread): eigener Codec für unsere Kanäle, sonst null */
	@SuppressWarnings("rawtypes")
	public static StreamCodec codec(Identifier id, int max) {
		try {
			return ServerPayload.codec(id, max);
		} catch (Throwable t) {
			logOnce(t);
			return null;
		}
	}

	/** ClientPacketListener.handleCustomPayload (Haupt-Thread): true = war eine Nachricht auf heldixclient:server */
	public static boolean payload(CustomPacketPayload payload) {
		if (!(payload instanceof ServerPayload message) || !ServerPayload.CHANNEL.equals(message.type().id())) return false;
		try {
			ServerLink.receive(message.data());
		} catch (Throwable t) {
			logOnce(t);
		}
		return true;
	}

	private static void logOnce(Throwable t) {
		if (errorLogged) return;
		errorLogged = true;
		HeldixClient.LOGGER.error("Kanal heldixclient:server: Fehler beim Lesen", t);
	}
}
