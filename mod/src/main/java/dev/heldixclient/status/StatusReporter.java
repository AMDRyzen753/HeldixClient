package dev.heldixclient.status;

import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.api.event.ScreenEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;

/**
 * Meldet dem Launcher, wo der Spieler gerade ist – für den Discord-Status.
 * Der Launcher liest die Zeilen "HELDIX-STATUS {…}" aus dem Log; in seiner Konsole erscheinen sie nicht.
 *
 * <p>Modi: menu, singleplayer, multiplayer (mit Serveradresse), realms, lan.
 * Welche Serveradressen in Discord sichtbar werden, entscheidet der Launcher (nur öffentliche Domains).
 */
public final class StatusReporter {
	private static String last;

	private StatusReporter() {
	}

	public static void init() {
		// Hauptmenü erreicht (beim Start und nach dem Verlassen einer Welt)
		ScreenEvents.AFTER_INIT.register((minecraft, screen, width, height) -> {
			if (screen instanceof TitleScreen && minecraft.level == null) report(minecraft);
		});
		WorldEvents.JOIN.register(StatusReporter::report);
		WorldEvents.LEAVE.register(minecraft -> emit("menu", null));
	}

	private static void report(Minecraft minecraft) {
		if (minecraft.level == null) {
			emit("menu", null);
		} else if (minecraft.hasSingleplayerServer()) {
			emit("singleplayer", null);
		} else {
			ServerData server = minecraft.getCurrentServer();
			if (server == null) emit("multiplayer", null);
			else if (server.isRealm()) emit("realms", null);
			else if (server.isLan()) emit("lan", null);
			else emit("multiplayer", server.ip);
		}
	}

	private static void emit(String mode, String server) {
		JsonObject json = new JsonObject();
		json.addProperty("mode", mode);
		if (server != null) json.addProperty("server", server);
		String line = json.toString();
		if (line.equals(last)) return;
		last = line;
		HeldixClient.LOGGER.info("HELDIX-STATUS {}", line);
	}
}
