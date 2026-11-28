package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixLogger;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * macOS: Spotify und – mit ausgeschaltetem „Nur Spotify“ – Apple Music (Music.app) per JavaScript for Automation
 * ({@code osascript -l JavaScript}), ganz ohne Konto. Ein kleines Skript läuft dauerhaft, fragt die Player einmal pro
 * Sekunde ab (ohne sie zu starten, wenn sie zu sind) und schreibt den Zustand zeilenweise. Laufen beide, zeigt es den,
 * der gerade spielt (sonst den zuletzt gezeigten, der noch einen Song geladen hat). Befehle gehen als eigene kurze
 * osascript-Aufrufe im Hintergrund an diesen Player.
 *
 * <p>Beim ersten Mal fragt macOS je Player, ob Minecraft ihn steuern darf (Datenschutz & Sicherheit → Automation).
 * Spotify meldet sein Cover als https-Adresse ({@link Covers}); Apple Music hat keine Adresse – das Cover holt ein
 * kurzes AppleScript („raw data of artwork 1“) als Datei, die {@link Covers} dann wie eine lokale Datei liest.
 */
final class MacPlayer extends Player {
	/** Name der App für AppleScript bzw. die Anzeige */
	static final String SPOTIFY = "Spotify";
	static final String MUSIC = "Music";
	static final String MUSIC_LABEL = "Apple Music";

	/**
	 * Abfrage-Skript. Zeilen: {@code STATE app zustand titel künstler album dauer(ms) position(ms) cover zufall wiederholen},
	 * {@code NONE app} (geöffnet, nichts geladen), {@code OFF app|*} (zu), {@code MISSING app}, {@code ERROR app meldung}.
	 * {@code %ANY%} setzt Java vor dem Start (true = auch Apple Music).
	 */
	private static final String POLL = """
			ObjC.import('Foundation');
			var ANY = %ANY%;
			var out = $.NSFileHandle.fileHandleWithStandardOutput;
			function write(line) { out.writeData($(line + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
			function clean(v) { return String(v === undefined || v === null ? '' : v).replace(/[\\t\\r\\n]/g, ' '); }
			function read(name) {
				var app;
				try { app = Application(name); } catch (e) { return { name: name, missing: true }; }
				try {
					if (!app.running()) return { name: name, off: true };
					var s = app.playerState();
					if (s === 'stopped') return { name: name, stopped: true };
					var t = app.currentTrack;
					var info = { name: name, state: s === 'playing' ? 'playing' : 'paused', title: clean(t.name()), artist: clean(t.artist()),
						album: clean(t.album()), position: Math.round(app.playerPosition() * 1000), art: '', shuffle: '', repeat: '' };
					if (name === 'Spotify') {
						info.duration = Math.round(t.duration());
						try { info.art = clean(t.artworkUrl()); } catch (e) {}
						try { info.shuffle = String(app.shuffling()); } catch (e) {}
						try { info.repeat = String(app.repeating()); } catch (e) {}
					} else {
						info.duration = Math.round(t.duration() * 1000);
						try { info.shuffle = String(app.shuffleEnabled()); } catch (e) {}
						try { info.repeat = String(app.songRepeat()); } catch (e) {}
					}
					return info;
				} catch (e) {
					var message = clean(e.message || e);
					// -1728: kein Song (z. B. Radio ohne Titel) – wie gestoppt
					if (message.indexOf('-1728') >= 0) return { name: name, stopped: true };
					return { name: name, error: message };
				}
			}
			var last = '';
			function choose() {
				var list = ANY ? [read('Spotify'), read('Music')] : [read('Spotify')];
				var i;
				for (i = 0; i < list.length; i++) if (list[i].state === 'playing') { last = list[i].name; return list[i]; }
				for (i = 0; i < list.length; i++) if (list[i].state && list[i].name === last) return list[i];
				for (i = 0; i < list.length; i++) if (list[i].state) { last = list[i].name; return list[i]; }
				for (i = 0; i < list.length; i++) if (list[i].error) return list[i];
				for (i = 0; i < list.length; i++) if (list[i].stopped) return list[i];
				if (!ANY) return list[0];
				return { name: '*', off: true };
			}
			function line(x) {
				if (x.state) return ['STATE', x.name, x.state, x.title, x.artist, x.album, x.duration, x.position, x.art, x.shuffle, x.repeat].join('\\t');
				if (x.error) return 'ERROR\\t' + x.name + '\\t' + x.error;
				if (x.missing) return 'MISSING\\t' + x.name;
				if (x.stopped) return 'NONE\\t' + x.name;
				return 'OFF\\t' + x.name;
			}
			while (true) {
				var text;
				try { text = line(choose()); } catch (e) { text = 'ERROR\\t\\t' + clean(e.message || e); }
				write(text);
				delay(text.indexOf('\\tplaying\\t') > 0 ? 1 : 2);
			}
			""";

	/** Cover aus Apple Music als Datei (Argument: Zieldatei); Ausgabe ok, none oder error … */
	private static final List<String> MUSIC_ARTWORK = List.of(
			"on run argv",
			"set target to item 1 of argv",
			"if application \"Music\" is not running then return \"none\"",
			"tell application \"Music\"",
			"if player state is stopped then return \"none\"",
			"try",
			"set raw to raw data of artwork 1 of current track",
			"on error",
			"return \"none\"",
			"end try",
			"end tell",
			"set f to open for access (POSIX file target) with write permission",
			"try",
			"set eof f to 0",
			"write raw to f",
			"close access f",
			"on error e",
			"try",
			"close access f",
			"end try",
			"return \"error \" & e",
			"end try",
			"return \"ok\"",
			"end run");

	/** so viele Apple-Music-Cover bleiben als Rohdatei liegen */
	private static final int KEEP_ARTWORK = 6;

	private final Consumer<Runnable> async;
	private final Covers covers;
	private Process process;
	/** App des zuletzt gemeldeten Songs (Ziel der Befehle) */
	private volatile String currentApp = SPOTIFY;
	/** Apple Music: Rohdatei des Covers je Song (Schlüssel = Track.key) */
	private final Map<String, Path> musicArtwork = new ConcurrentHashMap<>();
	/** Apple Music: für diesen Song wird das Cover gerade geholt bzw. wurde es schon versucht */
	private final Map<String, Boolean> musicArtworkTried = new ConcurrentHashMap<>();

	MacPlayer(HeldixLogger logger, Path directory, Feedback feedback, Consumer<Runnable> async) {
		super(logger, directory, feedback);
		this.async = async;
		this.covers = new Covers(directory.resolve("covers"), logger, async);
	}

	@Override
	String idleText() {
		return anyPlayer ? "Spotify oder Apple Music öffnen und Musik starten" : "Spotify öffnen und Musik starten";
	}

	/** Lässt sich die Wiederholung auf einen einzelnen Song stellen? (Apple Music ja, Spotify per AppleScript nicht) */
	static boolean repeatsTrack(Track track) {
		return track != null && MUSIC_LABEL.equals(track.app());
	}

	@Override
	protected void modeChanged() {
		// „Nur Spotify“ umgeschaltet: Abfrage mit dem neuen Modus neu starten
		boolean running;
		synchronized (this) {
			running = process != null;
		}
		if (running) restart();
	}

	@Override
	void nextPlayer() {
		feedback.show("Player wechseln", anyPlayer ? "Auf dem Mac zeigt das Addon den Player, der gerade spielt" : "Erst „Nur Spotify“ in den Einstellungen ausschalten");
	}

	@Override
	protected void session(int gen) throws Exception {
		Process started = new ProcessBuilder("osascript", "-l", "JavaScript", "-e", pollScript(anyPlayer)).redirectErrorStream(true).start();
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

	/** Abfrage-Skript für den Modus (any = auch Apple Music) */
	static String pollScript(boolean any) {
		return POLL.replace("%ANY%", any ? "true" : "false");
	}

	/** AppleScript für das Cover aus Apple Music (eine Zeile je -e) */
	static List<String> musicArtworkScript() {
		return MUSIC_ARTWORK;
	}

	@Override
	protected synchronized void disconnect() {
		if (process != null) process.destroy();
	}

	/** Eine Zeile des Abfrage-Skripts (package-sichtbar für den Test ohne Mac) */
	void parse(String line) {
		String[] f = line.split("\t", -1);
		switch (f[0]) {
			case "STATE" -> {
				if (f.length < 11) return;
				boolean music = MUSIC.equals(f[1]);
				long duration = number(f[6]);
				// ältere Spotify-Versionen melden Sekunden statt Millisekunden
				if (!music && duration > 0 && duration < 10_000) duration *= 1000;
				Boolean shuffle = f[9].isBlank() ? null : Boolean.valueOf("true".equals(f[9]));
				Track.Repeat repeat = repeat(music, f[10]);
				String title = Track.clean(f[3]);
				String artist = Track.clean(f[4]);
				String album = Track.clean(f[5]);
				currentApp = music ? MUSIC : SPOTIFY;
				Path cover = music ? musicCover(title + '\u0000' + artist + '\u0000' + album) : covers.cover(f[8]);
				update(new Track(music ? MUSIC_LABEL : SPOTIFY, "playing".equals(f[2]), title, artist, album,
						number(f[7]), duration, System.currentTimeMillis(), cover, shuffle, repeat, true));
			}
			case "NONE" -> none(null);
			case "OFF" -> none("*".equals(field(f, 1)) ? "Spotify oder Apple Music öffnen" : appLabel(field(f, 1)) + " nicht geöffnet");
			case "MISSING" -> none(appLabel(field(f, 1)) + " ist nicht installiert");
			case "ERROR" -> {
				String app = field(f, 1);
				String message = f.length > 2 ? f[2] : app;
				// -1743: Zugriff in den Systemeinstellungen nicht erlaubt
				if (message.contains("-1743") || message.toLowerCase().contains("not authorized") || message.toLowerCase().contains("not allowed")) {
					none(accessHint(app));
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

	static Track.Repeat repeat(boolean music, String value) {
		if (value == null || value.isBlank()) return null;
		if (!music) return "true".equals(value) ? Track.Repeat.LIST : Track.Repeat.OFF;
		return switch (value) {
			case "off" -> Track.Repeat.OFF;
			case "all" -> Track.Repeat.LIST;
			case "one" -> Track.Repeat.TRACK;
			default -> null;
		};
	}

	static String appLabel(String app) {
		return MUSIC.equals(app) ? MUSIC_LABEL : SPOTIFY;
	}

	static String accessHint(String app) {
		String name = app == null || app.isBlank() || "*".equals(app) ? "" : " auf " + appLabel(app);
		return "Zugriff" + name + " erlauben: Systemeinstellungen → Datenschutz & Sicherheit → Automation";
	}

	private static String field(String[] f, int index) {
		return f.length > index ? f[index] : "";
	}

	/** Befehl als JXA für die App (package-sichtbar für den Test ohne Mac) */
	static String commandScript(String app, Command command, long argument) {
		boolean music = MUSIC.equals(app);
		String target = music ? MUSIC : SPOTIFY;
		String body = switch (command) {
			case PLAY_PAUSE -> "a.playpause()";
			case NEXT -> "a.nextTrack()";
			case PREVIOUS -> "a.previousTrack()";
			case SEEK -> "a.playerPosition = " + (argument / 1000.0);
			case SHUFFLE -> music ? "a.shuffleEnabled = !a.shuffleEnabled()" : "a.shuffling = !a.shuffling()";
			// Apple Music: aus → alle → einer → aus; Spotify kennt nur an/aus
			case REPEAT -> music ? "var r = a.songRepeat(); a.songRepeat = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'" : "a.repeating = !a.repeating()";
		};
		return "var a = Application('" + target + "'); if (a.running()) { " + body + " }";
	}

	@Override
	protected void send(Command command, long argument) {
		String app = currentApp;
		String script = commandScript(app, command, argument);
		async.accept(() -> {
			try {
				Result result = exec(List.of("osascript", "-l", "JavaScript", "-e", script), 5000);
				if (result.exit() != 0) {
					if (result.err().contains("-1743")) feedback.show(appLabel(app), accessHint(app));
					else error("Befehl fehlgeschlagen: " + Track.clean(result.err()));
				}
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			} catch (Exception e) {
				error("Befehl fehlgeschlagen: " + e.getMessage());
			}
		});
	}

	// --- Cover aus Apple Music -----------------------------------------------------------------

	/** PNG des Covers, sobald da; beim ersten Mal je Song wird es im Hintergrund geholt */
	private Path musicCover(String key) {
		Path raw = musicArtwork.get(key);
		if (raw != null) return covers.cover(raw.toUri().toString());
		if (musicArtworkTried.putIfAbsent(key, Boolean.TRUE) == null) {
			if (musicArtworkTried.size() > 200) musicArtworkTried.clear();
			async.accept(() -> fetchMusicArtwork(key));
		}
		return null;
	}

	private void fetchMusicArtwork(String key) {
		try {
			Path dir = directory.resolve("covers");
			Files.createDirectories(dir);
			Path target = dir.resolve("music-" + hash(key) + ".img");
			if (!Files.isRegularFile(target) || Files.size(target) == 0) {
				List<String> command = new ArrayList<>(List.of("osascript"));
				for (String part : MUSIC_ARTWORK) {
					command.add("-e");
					command.add(part);
				}
				command.add(target.toString());
				Result result = exec(command, 8000);
				if (!result.out().strip().equals("ok")) {
					Files.deleteIfExists(target);
					return;
				}
			}
			musicArtwork.put(key, target);
			cleanArtwork(dir);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		} catch (Exception e) {
			error("Cover aus Apple Music nicht lesbar: " + e.getMessage());
		}
	}

	private void cleanArtwork(Path dir) {
		try (Stream<Path> files = Files.list(dir)) {
			List<Path> old = files.filter(p -> p.getFileName().toString().startsWith("music-") && p.getFileName().toString().endsWith(".img"))
					.sorted((a, b) -> Long.compare(modified(b), modified(a)))
					.skip(KEEP_ARTWORK)
					.toList();
			for (Path path : old) {
				Files.deleteIfExists(path);
				musicArtwork.values().remove(path);
			}
		} catch (IOException ignored) {
		}
	}

	private static long modified(Path path) {
		try {
			return Files.getLastModifiedTime(path).toMillis();
		} catch (IOException e) {
			return 0;
		}
	}

	private static String hash(String text) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-1").digest(text.getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(digest, 0, 8);
		} catch (Exception e) {
			return Integer.toHexString(text.hashCode());
		}
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
