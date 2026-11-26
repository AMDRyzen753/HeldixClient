package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixLogger;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

/**
 * Linux: MPRIS (die Mediensteuerung von Linux-Desktops) über das kleine Programm {@code playerctl}. Spotify meldet
 * sich dort wie die meisten Player an. Abgefragt wird einmal pro Sekunde (ein kurzer Aufruf, kein Dauerprozess).
 * Ohne playerctl zeigt das HUD einen Hinweis, wie man es installiert.
 */
final class LinuxPlayer extends Player {
	/** Felder der Abfrage (Tab-getrennt); Zeiten von MPRIS in Mikrosekunden */
	private static final String FORMAT = String.join("\t", "{{status}}", "{{title}}", "{{artist}}", "{{album}}", "{{mpris:length}}",
			"{{position}}", "{{mpris:artUrl}}", "{{playerName}}", "{{shuffle}}", "{{loop}}");
	/** Spotify-Clients unter Linux (offizieller Client, spotifyd, ncspot) */
	private static final String SPOTIFY = "spotify,spotifyd,ncspot";

	private final Consumer<Runnable> async;
	private final Covers covers;

	LinuxPlayer(HeldixLogger logger, Path directory, Feedback feedback, Consumer<Runnable> async) {
		super(logger, directory, feedback);
		this.async = async;
		this.covers = new Covers(directory.resolve("covers"), logger, async);
	}

	@Override
	String idleText() {
		return anyPlayer ? "Kein Player aktiv" : "Spotify nicht geöffnet";
	}

	private List<String> command(String... args) {
		List<String> command = new ArrayList<>(List.of("playerctl", "--player=" + (anyPlayer ? SPOTIFY + ",%any" : SPOTIFY)));
		command.addAll(List.of(args));
		return command;
	}

	@Override
	protected void session(int gen) throws Exception {
		while (alive(gen)) {
			Result result;
			try {
				result = exec(command("metadata", "--format", FORMAT), 3000);
			} catch (IOException e) {
				if (e.getMessage() != null && e.getMessage().contains("Cannot run program")) {
					// playerctl fehlt: Hinweis zeigen und selten nachsehen, ob es inzwischen installiert ist
					none("playerctl fehlt – bitte installieren (z. B. sudo apt install playerctl)");
					pause(30_000);
					continue;
				}
				throw e;
			}
			boolean playing = parse(result);
			pause(playing ? 1000 : 2000);
		}
	}

	/** @return true, wenn gerade Musik läuft */
	private boolean parse(Result result) {
		String out = result.out().strip();
		if (result.exit() != 0 || out.isEmpty()) {
			// „No players found“ bzw. Spotify nicht offen
			none(null);
			return false;
		}
		String[] f = out.split("\t", -1);
		if (f.length < 8 || f[1].isBlank()) {
			none(null);
			return false;
		}
		String status = f[0].strip();
		if ("Stopped".equalsIgnoreCase(status)) {
			none(null);
			return false;
		}
		Boolean shuffle = f.length > 8 && !f[8].isBlank() ? Boolean.valueOf("true".equalsIgnoreCase(f[8].strip())) : null;
		Track.Repeat repeat = f.length > 9 ? switch (f[9].strip().toLowerCase(Locale.ROOT)) {
			case "none" -> Track.Repeat.OFF;
			case "playlist" -> Track.Repeat.LIST;
			case "track" -> Track.Repeat.TRACK;
			default -> null;
		} : null;
		boolean playing = "Playing".equalsIgnoreCase(status);
		update(new Track(app(f[7]), playing, Track.clean(f[1]), Track.clean(f[2]), Track.clean(f[3]), micros(f[5]), micros(f[4]),
				System.currentTimeMillis(), covers.cover(f[6]), shuffle, repeat, true));
		return playing;
	}

	private static String app(String player) {
		String name = player.strip();
		if (name.toLowerCase(Locale.ROOT).startsWith("spotify") || name.equalsIgnoreCase("ncspot")) return "Spotify";
		if (name.isEmpty()) return "Player";
		return Character.toUpperCase(name.charAt(0)) + name.substring(1);
	}

	private static long micros(String text) {
		try {
			return Math.round(Double.parseDouble(text.strip()) / 1000.0);
		} catch (NumberFormatException e) {
			return 0;
		}
	}

	@Override
	protected void send(Command command, long argument) {
		Track current = track;
		List<String> args = switch (command) {
			case PLAY_PAUSE -> command("play-pause");
			case NEXT -> command("next");
			case PREVIOUS -> command("previous");
			case SEEK -> command("position", String.format(Locale.ROOT, "%.1f", argument / 1000.0));
			case SHUFFLE -> command("shuffle", "Toggle");
			case REPEAT -> {
				Track.Repeat now = current != null && current.repeat() != null ? current.repeat() : Track.Repeat.OFF;
				yield command("loop", switch (now.next(true)) {
					case OFF -> "None";
					case LIST -> "Playlist";
					case TRACK -> "Track";
				});
			}
		};
		async.accept(() -> {
			try {
				Result result = exec(args, 3000);
				if (result.exit() != 0 && !result.err().isBlank()) error("Befehl fehlgeschlagen: " + Track.clean(result.err()));
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			} catch (Exception e) {
				error("Befehl fehlgeschlagen: " + e.getMessage());
			}
			wakeUp();
		});
	}
}
