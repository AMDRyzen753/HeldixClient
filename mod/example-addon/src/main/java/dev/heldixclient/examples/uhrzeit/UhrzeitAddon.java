package dev.heldixclient.examples.uhrzeit;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;

import java.time.Duration;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/**
 * Beispiel-Addon für den Heldix Loader:
 * - HUD-Modul "Uhrzeit" (echte Uhrzeit)
 * - HUD-Modul "Spielzeit" (Zeit seit Betreten der Welt)
 * - Modul "Begrüßung" (lokale Chatnachricht beim Betreten einer Welt)
 */
public class UhrzeitAddon implements HeldixAddon {
	private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");

	private long worldJoinedAt;
	private int worldsJoined;

	@Override
	public void onEnable(HeldixApi api) {
		api.registerHudModule(ModuleSpec.of("uhrzeit", "Uhrzeit", "Echte Uhrzeit im HUD").at(4, 190),
				canvas -> canvas.labelValue("Uhr", LocalTime.now().format(TIME)));

		api.registerHudModule(ModuleSpec.of("spielzeit", "Spielzeit", "Zeit in dieser Welt").at(4, 208),
				canvas -> canvas.labelValue("Spielzeit", format(Duration.ofMillis(worldJoinedAt == 0 ? 0 : System.currentTimeMillis() - worldJoinedAt))));

		ModuleHandle greeting = api.registerModule(ModuleSpec.of("begruessung", "Begrüßung", "Gruß beim Welt-Start"));

		api.events().onWorldJoin(() -> {
			worldJoinedAt = System.currentTimeMillis();
			worldsJoined = api.config().getInt("worlds-joined", 0) + 1;
			api.config().set("worlds-joined", String.valueOf(worldsJoined));
			api.config().save();
			if (greeting.isEnabled()) {
				String name = api.player().map(p -> p.name()).orElse("Spieler");
				api.chat("Willkommen, " + name + "! Das ist deine " + worldsJoined + ". Welt mit HeldixClient.");
			}
		});
		api.events().onWorldLeave(() -> worldJoinedAt = 0);

		api.logger().info("Uhrzeit-Addon geladen (Heldix Loader " + api.loaderVersion() + ", Minecraft " + api.minecraftVersion() + ")");
	}

	private static String format(Duration duration) {
		long seconds = duration.toSeconds();
		long h = seconds / 3600;
		long m = (seconds % 3600) / 60;
		long s = seconds % 60;
		return h > 0 ? String.format("%d:%02d:%02d", h, m, s) : String.format("%02d:%02d", m, s);
	}
}
