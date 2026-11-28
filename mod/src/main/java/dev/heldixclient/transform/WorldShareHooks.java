package dev.heldixclient.transform;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.share.WorldShare;
import net.minecraft.client.server.IntegratedPlayerList;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.server.players.NameAndId;
import net.minecraft.server.players.PlayerList;

/**
 * Wird von den durch {@link WorldSharePatches} veränderten Server-Klassen aufgerufen (Server-Thread). Fehler fallen
 * auf das Verhalten von Minecraft zurück – außer beim Login: Klappt die Prüfung nicht, darf niemand Fremdes hinein.
 */
public final class WorldShareHooks {
	private static boolean errorLogged;

	private WorldShareHooks() {
	}

	/** IntegratedPlayerList.canPlayerLogin: null = darf hinein (Minecraft hat nichts dagegen und die Welt lässt ihn) */
	public static Component canPlayerLogin(Component vanilla, IntegratedPlayerList list, NameAndId who) {
		if (vanilla != null) return vanilla;
		try {
			return WorldShare.loginDenied(list.getServer(), who);
		} catch (RuntimeException e) {
			logOnce(e);
			return WorldShare.active() ? Component.literal("Die Welt kann dich gerade nicht prüfen. Versuch es gleich noch einmal.") : null;
		}
	}

	public static LevelBasedPermissionSet permissions(LevelBasedPermissionSet vanilla, IntegratedServer server, NameAndId who) {
		try {
			return WorldShare.permissions(vanilla, server, who);
		} catch (RuntimeException e) {
			logOnce(e);
			return vanilla;
		}
	}

	public static int maxPlayers(int vanilla, IntegratedServer server) {
		try {
			return WorldShare.maxPlayers(vanilla, server);
		} catch (RuntimeException e) {
			logOnce(e);
			return vanilla;
		}
	}

	/** PlayerList.placeNewPlayer (am Ende) */
	public static void playerJoined(PlayerList list, ServerPlayer player) {
		try {
			WorldShare.playerJoined(list, player);
		} catch (RuntimeException e) {
			logOnce(e);
		}
	}

	private static void logOnce(RuntimeException e) {
		if (errorLogged) return;
		errorLogged = true;
		HeldixClient.LOGGER.error("Welt teilen: Prüfung im eingebauten Server fehlgeschlagen", e);
	}
}
