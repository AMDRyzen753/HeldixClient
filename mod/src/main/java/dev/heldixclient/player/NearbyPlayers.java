package dev.heldixclient.player;

import dev.heldixclient.api.NearbyPlayer;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.world.entity.player.Player;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/** Andere Spieler in der geladenen Welt, von dir aus gesehen (Addon-API {@code nearbyPlayers()} und Spielermenü) */
public final class NearbyPlayers {
	private NearbyPlayers() {
	}

	/** Momentaufnahme eines Spielers (unveränderlich) */
	public record Snapshot(UUID uuid, String name, double x, double y, double z, double distance, float direction, boolean heldixPlayer)
			implements NearbyPlayer {
	}

	/** Alle anderen Spieler, nächster zuerst; ohne Welt leer. Haupt-Thread. */
	public static List<NearbyPlayer> all(Minecraft mc) {
		if (mc.level == null || mc.player == null) return List.of();
		List<Snapshot> list = new ArrayList<>();
		for (AbstractClientPlayer other : mc.level.players()) {
			if (other == mc.player) continue;
			list.add(of(mc, other));
		}
		list.sort(Comparator.comparingDouble(Snapshot::distance));
		return List.copyOf(list);
	}

	public static Snapshot of(Minecraft mc, Player other) {
		Player self = mc.player;
		double dx = other.getX() - self.getX();
		double dy = other.getY() - self.getY();
		double dz = other.getZ() - self.getZ();
		double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
		// Minecraft: Gierwinkel 0 = Süden (+z), 90 = Westen (-x); Richtung zum anderen im selben System
		float toOther = (float) Math.toDegrees(Math.atan2(-dx, dz));
		float direction = wrap(toOther - self.getYRot());
		return new Snapshot(other.getUUID(), other.getGameProfile().name(), other.getX(), other.getY(), other.getZ(), distance, direction,
				Social.isHeldix(other.getUUID()));
	}

	/** Name zu einer UUID: Spieler in der Welt, Tab-Liste des Servers, Freundesliste; sonst null. Haupt-Thread. */
	public static String nameOf(Minecraft mc, UUID uuid) {
		if (uuid == null) return null;
		if (mc.level != null) {
			Player player = mc.level.getPlayerByUUID(uuid);
			if (player != null) return player.getGameProfile().name();
		}
		if (mc.getConnection() != null) {
			net.minecraft.client.multiplayer.PlayerInfo info = mc.getConnection().getPlayerInfo(uuid);
			if (info != null) return info.getProfile().name();
		}
		for (Social.Friend friend : Social.friends()) {
			if (friend.uuid().equals(uuid)) return friend.name();
		}
		return null;
	}

	private static float wrap(float degrees) {
		float value = degrees % 360f;
		if (value >= 180f) value -= 360f;
		if (value < -180f) value += 360f;
		return value;
	}
}
