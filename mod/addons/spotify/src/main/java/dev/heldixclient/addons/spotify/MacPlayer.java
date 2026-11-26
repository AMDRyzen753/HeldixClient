package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixLogger;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.function.Consumer;

/**
 * macOS: Spotify per JavaScript for Automation ({@code osascript -l JavaScript}), ganz ohne Konto. Ein kleines Skript
 * läuft dauerhaft, fragt Spotify einmal pro Sekunde ab (ohne es zu starten, wenn es zu ist) und schreibt den Zustand
 * zeilenweise. Befehle laufen als eigene kurze osascript-Aufrufe im Hintergrund.
 *
 * <p>Beim ersten Mal fragt macOS, ob Minecraft Spotify steuern darf (Datenschutz → Automation). Cover kommen als
 * https-Adresse und werden über {@link Covers} geladen.
 */
final class MacPlayer extends Player {
	/** Abfrage-Skript: STATE/NONE/OFF/MISSING-Zeilen, siehe parse() */
	private static final String POLL = """
			ObjC.import('Foundation');
			var out = $.NSFileHandle.fileHandleWithStandardOutput;
			function write(line) { out.writeData($(line + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
			function clean(v) { return String(v === undefined || v === null ? '' : v).replace(/[\\t\\r\\n]/g, ' '); }
			function state() {
				var app;
				try { app = Application('Spotify'); } catch (e) { return 'MISSING'; }
				if (!app.running()) return 'OFF';
				var s = app.playerState();
				if (s === 'stopped') return 'NONE';
				var t = app.currentTrack;
				var art = ''; try { art = t.artworkUrl(); } catch (e) {}
				var shuffle = ''; try { shuffle = String(app.shuffling()); } catch (e) {}
				var repeat = ''; try { repeat = String(app.repeating()); } catch (e) {}
				return ['STATE', s, clean(t.name()), clean(t.artist()), clean(t.album()), Math.round(t.duration()),
					Math.round(app.playerPosition() * 1000), clean(art), shuffle, repeat].join('\\t');
			}
			while (true) {
				var line;
				try { line = state(); } catch (e) { line = 'ERROR\\t' + clean(e.message || e); }
				write(line);
				delay(line.indexOf('STATE\\tplaying') === 0 ? 1 : 2);
			}
			""";

	private final Consumer<Runnable> async;
	private final Covers covers;
	private Process process;

	MacPlayer(HeldixLogger logger, Path directory, Feedback feedback, Consumer<Runnable> async) {
		super(logger, directory, feedback);
		this.async = async;
		this.covers = new Covers(directory.resolve("covers"), logger, async);
	}

	@Override
	String idleText() {
		return "Spotify öffnen und Musik starten";
	}

	@Override
	protected void session(int gen) throws Exception {
		Process started = new ProcessBuilder("osascript", "-l", "JavaScript", "-e", POLL).redirectErrorStream(true).start();
		synchronized (this) {
			process = started;
		}
		try (BufferedReader reader = new BufferedReader(new InputStreamReader(started.getInputStream(), StandardCharsets.UTF_8))) {
			started.getOutputStream().close();
			String line;
			while ((line = reader.readLine()) != null && alive(gen)) parse(line);
		} finally {
			synchronized (this) {
				if (process == started) process = null;
			}
			started.destroy();
		}
	}

	@Override
	protected synchronized void disconnect() {
		if (process != null) process.destroy();
	}

	private void parse(String line) {
		String[] f = line.split("\t", -1);
		switch (f[0]) {
			case "STATE" -> {
				if (f.length < 10) return;
				long duration = number(f[5]);
				// ältere Spotify-Versionen melden Sekunden statt Millisekunden
				if (duration > 0 && duration < 10_000) duration *= 1000;
				Boolean shuffle = f[8].isBlank() ? null : Boolean.valueOf("true".equals(f[8]));
				// Spotify kennt per AppleScript nur „Wiederholen an/aus“ (die Liste)
				Track.Repeat repeat = f[9].isBlank() ? null : "true".equals(f[9]) ? Track.Repeat.LIST : Track.Repeat.OFF;
				Track next = new Track("Spotify", "playing".equals(f[1]), Track.clean(f[2]), Track.clean(f[3]), Track.clean(f[4]),
						number(f[6]), duration, System.currentTimeMillis(), covers.cover(f[7]), shuffle, repeat, true);
				update(next);
			}
			case "NONE" -> none(null);
			case "OFF" -> none("Spotify nicht geöffnet");
			case "MISSING" -> none("Spotify ist nicht installiert");
			case "ERROR" -> {
				String message = f.length > 1 ? f[1] : "?";
				// -1743: Zugriff in den Systemeinstellungen nicht erlaubt
				if (message.contains("-1743") || message.toLowerCase().contains("not authorized")) {
					none("Zugriff erlauben: Systemeinstellungen → Datenschutz → Automation");
				} else {
					error(message);
				}
			}
			default -> {
				// Fehlermeldungen von osascript selbst (Skript beendet)
				if (!line.isBlank()) error(Track.clean(line));
			}
		}
	}

	@Override
	protected void send(Command command, long argument) {
		String script = switch (command) {
			case PLAY_PAUSE -> "Application('Spotify').playpause()";
			case NEXT -> "Application('Spotify').nextTrack()";
			case PREVIOUS -> "Application('Spotify').previousTrack()";
			case SEEK -> "Application('Spotify').playerPosition = " + (argument / 1000.0);
			case SHUFFLE -> "var a = Application('Spotify'); a.shuffling = !a.shuffling()";
			case REPEAT -> "var a = Application('Spotify'); a.repeating = !a.repeating()";
		};
		async.accept(() -> {
			try {
				Result result = exec(List.of("osascript", "-l", "JavaScript", "-e", "if (Application('Spotify').running()) { " + script + " }"), 5000);
				if (result.exit() != 0) {
					if (result.err().contains("-1743")) feedback.show("Spotify", "Zugriff erlauben: Systemeinstellungen → Datenschutz → Automation");
					else error("Befehl fehlgeschlagen: " + Track.clean(result.err()));
				}
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			} catch (Exception e) {
				error("Befehl fehlgeschlagen: " + e.getMessage());
			}
		});
	}

	private static long number(String text) {
		try {
			return Long.parseLong(text.trim());
		} catch (NumberFormatException e) {
			try {
				return Math.round(Double.parseDouble(text.trim()));
			} catch (NumberFormatException e2) {
				return 0;
			}
		}
	}
}
