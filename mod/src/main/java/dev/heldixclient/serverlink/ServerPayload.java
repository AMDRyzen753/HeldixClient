package dev.heldixclient.serverlink;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.Identifier;

/**
 * Rohe Bytes eines Plugin-Kanals: {@code heldixclient:server} (Kanal zum Server-Plugin „HeldixClient Server“) und zum
 * Senden {@code minecraft:register} (Anmeldung des Kanals, sonst stellt Paper nichts zu).
 *
 * <p>Seit Minecraft 1.20.5 verwirft der Client unbekannte Custom-Payloads schon beim Lesen ({@link DiscardedPayload}). Der
 * Eingriff in {@code DiscardedPayload.codec} ({@link dev.heldixclient.transform.ServerLinkPatches}) liefert für diese
 * beiden Kanäle {@link #codec} statt des verwerfenden Codecs. Alle anderen Kanäle bleiben genau wie bei Minecraft.
 */
public record ServerPayload(CustomPacketPayload.Type<ServerPayload> type, byte[] data) implements CustomPacketPayload {
	public static final Identifier CHANNEL = Identifier.fromNamespaceAndPath("heldixclient", "server");
	public static final Identifier REGISTER = Identifier.fromNamespaceAndPath("minecraft", "register");
	public static final CustomPacketPayload.Type<ServerPayload> TYPE = new CustomPacketPayload.Type<>(CHANNEL);
	public static final CustomPacketPayload.Type<ServerPayload> REGISTER_TYPE = new CustomPacketPayload.Type<>(REGISTER);
	/** höchstens 32 KiB je Nachricht (Vertrag A3) */
	public static final int MAX_BYTES = 32 * 1024;

	public static ServerPayload message(byte[] data) {
		return new ServerPayload(TYPE, data);
	}

	/** Anmeldung der Kanäle: Namen durch das Nullzeichen getrennt (wie bei Bukkit/Paper, Fabric und Forge) */
	public static ServerPayload register(String... channels) {
		return new ServerPayload(REGISTER_TYPE, String.join("\0", channels).getBytes(java.nio.charset.StandardCharsets.UTF_8));
	}

	/**
	 * Codec für einen der beiden Kanäle (sonst null). Lesen: {@code heldixclient:server} als {@link ServerPayload} mit den
	 * Bytes, {@code minecraft:register} wie bei Minecraft verworfen. Schreiben: die Bytes eines {@link ServerPayload}.
	 *
	 * @param max Grenze, die Minecraft für diese Richtung vorgibt (Server → Client 1 MiB, Client → Server 32767)
	 */
	public static StreamCodec<FriendlyByteBuf, CustomPacketPayload> codec(Identifier id, int max) {
		if (CHANNEL.equals(id)) return new Codec(id, max, true);
		if (REGISTER.equals(id)) return new Codec(id, max, false);
		return null;
	}

	/** Codec für Fabric API (PayloadTypeRegistry): liest und schreibt immer einen {@link ServerPayload} */
	public static StreamCodec<FriendlyByteBuf, ServerPayload> fabricCodec() {
		return new StreamCodec<>() {
			@Override
			public ServerPayload decode(FriendlyByteBuf buffer) {
				int length = buffer.readableBytes();
				if (length > 1024 * 1024) throw new IllegalArgumentException("Nachricht auf heldixclient:server zu groß (" + length + " Bytes)");
				byte[] data = new byte[length];
				buffer.readBytes(data);
				return message(data);
			}

			@Override
			public void encode(FriendlyByteBuf buffer, ServerPayload payload) {
				buffer.writeBytes(payload.data());
			}
		};
	}

	private record Codec(Identifier id, int max, boolean keep) implements StreamCodec<FriendlyByteBuf, CustomPacketPayload> {
		@Override
		public CustomPacketPayload decode(FriendlyByteBuf buffer) {
			int length = buffer.readableBytes();
			// wie DiscardedPayload: zu große Nachrichten sind ein Fehler im Protokoll
			if (length < 0 || length > max) throw new IllegalArgumentException("Payload may not be larger than " + max + " bytes");
			if (!keep) {
				buffer.skipBytes(length);
				return new DiscardedPayload(id);
			}
			byte[] data = new byte[length];
			buffer.readBytes(data);
			return new ServerPayload(TYPE, data);
		}

		@Override
		public void encode(FriendlyByteBuf buffer, CustomPacketPayload payload) {
			// DiscardedPayload schreibt bei Minecraft nichts – genauso
			if (payload instanceof ServerPayload raw) buffer.writeBytes(raw.data());
		}
	}
}
