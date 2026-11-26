package dev.heldixclient.examples.uhrzeit;

import dev.heldixclient.api.CommandContext;
import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixColors;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;

import java.time.Duration;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/**
 * Beispiel-Addon für den Heldix Loader:
 * - HUD-Modul "Uhrzeit" (echte Uhrzeit; im Untermenü Sekunden, Farbe und Beschriftung)
 * - HUD-Modul "Spielzeit" (Zeit seit Betreten der Welt; im Untermenü eine Pausen-Erinnerung)
 * - Modul "Begrüßung" (lokale Chatnachricht beim Betreten einer Welt)
 * - Chat-Befehl ".uhr" (nur für dich) und ".uhr teilen" (an alle im Chat)
 */
public class UhrzeitAddon implements HeldixAddon {
	private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");
	private static final DateTimeFormatter TIME_SHORT = DateTimeFormatter.ofPattern("HH:mm");

	private BooleanSupplier showSeconds = () -> true;
	private IntSupplier color = () -> HeldixColors.ACCENT_LIGHT;
	private Supplier<String> label = () -> "Uhr";
	private DoubleSupplier breakMinutes = () -> 0;

	private long worldJoinedAt;
	private int worldsJoined;
	/** nach so vielen Minuten in der Welt kommt die nächste Pausen-Erinnerung */
	private long nextBreak;

	@Override
	public void onEnable(HeldixApi api) {
		ModuleHandle clock = api.registerHudModule(ModuleSpec.of("uhrzeit", "Uhrzeit", "Echte Uhrzeit im HUD").at(4, 190).withIcon("clock"),
				this::drawClock);
		// Einstellungen im Untermenü des Moduls (Heldix-Menü → Zahnrad), werden automatisch gespeichert
		showSeconds = clock.addToggle("seconds", "Sekunden", "Uhrzeit mit Sekunden anzeigen", true);
		// ab API 3: Farbwahl und Textfeld
		color = clock.addColor("color", "Farbe", "Farbe der Beschriftung und des Streifens", HeldixColors.ACCENT_LIGHT);
		label = clock.addText("label", "Beschriftung", "Text vor der Uhrzeit (leer = keiner)", "Uhr", 16);

		ModuleHandle playtime = api.registerHudModule(ModuleSpec.of("spielzeit", "Spielzeit", "Zeit in dieser Welt").at(4, 208).withIcon("hourglass"),
				canvas -> canvas.labelValue("Spielzeit", format(played())));
		// ab API 3: Regler mit eigenem Text für den Wert
		breakMinutes = playtime.addSlider("break", "Pausen-Erinnerung", "Nach so vielen Minuten in einer Welt erinnert eine Einblendung an eine Pause",
				0, 120, 15, 0, value -> value == 0 ? "Aus" : (int) value + " min");

		ModuleHandle greeting = api.registerModule(ModuleSpec.of("begruessung", "Begrüßung", "Gruß beim Welt-Start").withIcon("chat"));

		api.events().onWorldJoin(() -> {
			worldJoinedAt = System.currentTimeMillis();
			nextBreak = 0;
			worldsJoined = api.config().getInt("worlds-joined", 0) + 1;
			api.config().set("worlds-joined", String.valueOf(worldsJoined));
			api.config().save();
			if (greeting.isEnabled()) {
				String name = api.player().map(p -> p.name()).orElse("Spieler");
				api.chat("Willkommen, " + name + "! Das ist deine " + worldsJoined + ". Welt mit HeldixClient.");
			}
		});
		api.events().onWorldLeave(() -> worldJoinedAt = 0);

		// ab API 3: Scheduler – einmal pro Sekunde nachsehen, ob eine Pause fällig ist
		api.scheduler().runRepeating(20, 20, () -> remindBreak(api, playtime));

		// ab API 3: Chat-Befehl ".uhr" bzw. ".uhr teilen" (der Text geht nicht an den Server)
		api.registerCommand("uhr", "[teilen]", "Uhrzeit und Spielzeit", command -> clockCommand(api, command));

		api.logger().info("Uhrzeit-Addon geladen (Heldix Loader " + api.loaderVersion() + ", Minecraft " + api.minecraftVersion() + ")");
	}

	private String now() {
		return LocalTime.now().format(showSeconds.getAsBoolean() ? TIME : TIME_SHORT);
	}

	private Duration played() {
		return Duration.ofMillis(worldJoinedAt == 0 ? 0 : System.currentTimeMillis() - worldJoinedAt);
	}

	/** Box im Heldix-Stil, selbst gezeichnet: Streifen und Beschriftung in der gewählten Farbe */
	private void drawClock(HudCanvas canvas) {
		String text = label.get().strip();
		String time = now();
		int accent = color.getAsInt();
		int labelWidth = text.isEmpty() ? 0 : canvas.textWidth(text) + 5;
		int width = 2 + 4 + labelWidth + canvas.textWidth(time) + 4;
		int height = 4 + canvas.lineHeight() + 3;
		canvas.roundedRect(0, 0, width, height, 3, HeldixColors.BACKGROUND);
		canvas.rect(0, 2, 2, height - 4, accent);
		if (!text.isEmpty()) canvas.text(text, 6, 4, accent);
		canvas.text(time, 6 + labelWidth, 4, HeldixColors.TEXT);
	}

	private void remindBreak(HeldixApi api, ModuleHandle playtime) {
		int every = (int) breakMinutes.getAsDouble();
		if (every <= 0 || worldJoinedAt == 0 || !playtime.isEnabled()) return;
		long minutes = played().toMinutes();
		if (nextBreak == 0) nextBreak = every;
		if (minutes >= nextBreak) {
			api.notify("Zeit für eine Pause?", "Du spielst schon " + minutes + " Minuten in dieser Welt");
			nextBreak = minutes + every;
		}
	}

	private void clockCommand(HeldixApi api, CommandContext command) {
		if (command.arg(0).equals("teilen")) {
			// an den Server: nur in Befehlen, Tasten und Knöpfen erlaubt (Aktion des Spielers)
			if (!api.sendChatMessage("Bei mir ist es " + LocalTime.now().format(TIME_SHORT) + " Uhr.")) command.reply("Teilen geht nur in einer Welt");
			return;
		}
		String played = worldJoinedAt == 0 ? "" : ", du bist seit " + format(played()) + " in dieser Welt";
		command.reply("Es ist " + now() + " Uhr" + played + ".");
	}

	private static String format(Duration duration) {
		long seconds = duration.toSeconds();
		long h = seconds / 3600;
		long m = (seconds % 3600) / 60;
		long s = seconds % 60;
		return h > 0 ? String.format("%d:%02d:%02d", h, m, s) : String.format("%02d:%02d", m, s);
	}
}
