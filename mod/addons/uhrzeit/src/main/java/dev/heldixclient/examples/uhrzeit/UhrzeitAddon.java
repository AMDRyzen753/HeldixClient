package dev.heldixclient.examples.uhrzeit;

import dev.heldixclient.api.CommandContext;
import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixColors;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudClick;
import dev.heldixclient.api.HudHover;
import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.HudStyle;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;

import java.time.Duration;
import java.time.LocalTime;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/**
 * Beispiel-Addon für den Heldix Loader:
 * - HUD-Modul "Uhrzeit" (echte Uhrzeit; im Untermenü Sekunden, Farbe und Beschriftung; ab API 5 im HUD-Stil, mit Datum im
 *   Tooltip und anklickbar: Klick zeigt Uhr- und Spielzeit im Chat, Umschalt+Klick fügt die Uhrzeit in die Chat-Eingabe ein)
 * - HUD-Modul "Spielzeit" (Zeit seit Betreten der Welt; im Untermenü eine Pausen-Erinnerung)
 * - Modul "Begrüßung" (lokale Chatnachricht beim Betreten einer Welt)
 * - Chat-Befehl ".uhr" (nur für dich) und ".uhr teilen" (an alle im Chat)
 */
public class UhrzeitAddon implements HeldixAddon {
	private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");
	private static final DateTimeFormatter TIME_SHORT = DateTimeFormatter.ofPattern("HH:mm");
	private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("EEEE, d. MMMM yyyy", Locale.GERMAN);
	private static final DateTimeFormatter DATE_SHORT = DateTimeFormatter.ofPattern("EE d.M.", Locale.GERMAN);

	private BooleanSupplier showSeconds = () -> true;
	private BooleanSupplier showDate = () -> false;
	private IntSupplier color = () -> HeldixColors.ACCENT_LIGHT;
	private Supplier<String> label = () -> "Uhr";
	private DoubleSupplier breakMinutes = () -> 0;
	private HeldixApi api;

	private long worldJoinedAt;
	private int worldsJoined;
	/** nach so vielen Minuten in der Welt kommt die nächste Pausen-Erinnerung */
	private long nextBreak;

	@Override
	public void onEnable(HeldixApi api) {
		this.api = api;
		// ab API 5: ein HudRenderer mit onClick/onHover macht das Element anklickbar (bei offenem Chat)
		ModuleHandle clock = api.registerHudModule(ModuleSpec.of("uhrzeit", "Uhrzeit", "Echte Uhrzeit im HUD").at(4, 190).withIcon("clock"),
				new ClockRenderer());
		// Einstellungen im Untermenü des Moduls (Heldix-Menü → Zahnrad), werden automatisch gespeichert;
		// ab API 5 als Stil-Option zusätzlich im Rechtsklick-Menü des HUD-Editors
		showSeconds = clock.addStyleToggle("seconds", "Sekunden", true);
		// ab API 3: Farbwahl und Textfeld
		color = clock.addColor("color", "Farbe", "Farbe der Beschriftung", HeldixColors.ACCENT_LIGHT);
		label = clock.addText("label", "Beschriftung", "Text vor der Uhrzeit (leer = keiner)", "Uhr", 16);
		// ab API 5: noch eine Stil-Option (Datum vor der Uhrzeit)
		showDate = clock.addStyleToggle("date", "Datum", false);
		// ab API 6: eigene Taste im Untermenü des Moduls (dort und unter Optionen → Steuerung umbelegbar), ab Werk frei
		clock.addKey("tell-time", "Uhrzeit im Chat", "Zeigt Uhr- und Spielzeit nur dir im Chat", HeldixKeys.NONE, () -> api.chat(clockText()));

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

	/**
	 * Box im eingestellten HUD-Stil (ab API 5: Fläche, Schrift und Schatten wie die eingebauten Elemente), Beschriftung in
	 * der gewählten Farbe. Bei offenem Chat: Tooltip mit Datum, Klick zeigt Uhr- und Spielzeit im Chat.
	 */
	private final class ClockRenderer implements HudRenderer {
		@Override
		public void render(HudCanvas canvas) {
			HudStyle style = canvas.style();
			HudCanvas.TextStyle font = style.textStyle();
			String text = label.get().strip();
			String time = now();
			if (showDate.getAsBoolean()) time = LocalDate.now().format(DATE_SHORT) + "  " + time;
			int accent = color.getAsInt();
			// beim klassischen Stil zeichnet panel() links einen Streifen: Platz dafür lassen
			int left = style.kind() == HudStyle.Kind.CLASSIC ? 6 : style.padding();
			int labelWidth = text.isEmpty() ? 0 : canvas.textWidth(text, font) + 4;
			int width = left + labelWidth + canvas.textWidth(time, font) + style.padding();
			int height = 16;
			canvas.panel(0, 0, width, height);
			if (!text.isEmpty()) canvas.text(text, left, 4, accent, font, style.shadow());
			canvas.text(time, left + labelWidth, 4, style.textColor(), font, style.shadow());
		}

		@Override
		public void onHover(HudHover hover) {
			hover.tooltip(LocalDate.now().format(DATE), "Es ist " + LocalTime.now().format(TIME) + " Uhr",
					hover.chatOpen() ? "Klick: im Chat anzeigen · Umschalt+Klick: in die Eingabe" : "Klick: im Chat anzeigen");
			hover.cursor(HudHover.Cursor.HAND);
		}

		@Override
		public boolean onClick(HudClick click) {
			if (click.button() != HudClick.LEFT) return false;
			if (click.shift() && click.insertIntoChat(LocalTime.now().format(TIME_SHORT) + " Uhr")) return true;
			api.chat(clockText());
			return true;
		}
	}

	/** „Es ist 14:03:12 Uhr, du bist seit 12:30 in dieser Welt.“ */
	private String clockText() {
		String played = worldJoinedAt == 0 ? "" : ", du bist seit " + format(played()) + " in dieser Welt";
		return "Es ist " + now() + " Uhr" + played + ".";
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
		command.reply(clockText());
	}

	private static String format(Duration duration) {
		long seconds = duration.toSeconds();
		long h = seconds / 3600;
		long m = (seconds % 3600) / 60;
		long s = seconds % 60;
		return h > 0 ? String.format("%d:%02d:%02d", h, m, s) : String.format("%02d:%02d", m, s);
	}
}
