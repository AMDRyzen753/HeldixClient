package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixLogger;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Windows-Mediensteuerung (System Media Transport Controls) über ein kleines PowerShell-Skript
 * ({@code heldix-media.ps1}). Windows kennt den laufenden Song jedes Players, der sich dort anmeldet – Spotify tut
 * das immer. Das Skript schreibt einmal pro Sekunde den Zustand (eine Tab-getrennte Zeile) und nimmt Befehle
 * zeilenweise über die Standardeingabe an.
 */
final class WindowsPlayer extends Player {
	private static final String SCRIPT = "heldix-media.ps1";

	private Process process;
	private Writer input;
	private volatile List<String> players = List.of();
	private volatile int playerIndex = -1;

	WindowsPlayer(HeldixLogger logger, Path directory, Feedback feedback) {
		super(logger, directory, feedback);
	}

	@Override
	String idleText() {
		// ohne laufende Sitzung kann Windows Spotify nicht fernsteuern: erst in Spotify selbst starten
		return anyPlayer ? "Kein Player aktiv" : "Spotify nicht geöffnet";
	}

	@Override
	List<String> players() {
		return players;
	}

	int playerIndex() {
		return playerIndex;
	}

	@Override
	protected void modeChanged() {
		write(anyPlayer ? "mode any" : "mode spotify");
	}

	@Override
	void nextPlayer() {
		if (!anyPlayer) {
			feedback.show("Player wechseln", "Erst „Nur Spotify“ in den Einstellungen ausschalten");
			return;
		}
		if (players.size() < 2) {
			feedback.show("Player wechseln", players.isEmpty() ? "Kein Player aktiv" : "Nur " + players.getFirst() + " ist aktiv");
			return;
		}
		write("player next");
	}

	@Override
	protected void send(Command command, long argument) {
		write(switch (command) {
			case PLAY_PAUSE -> "playpause";
			case NEXT -> "next";
			case PREVIOUS -> "previous";
			case SEEK -> "position " + argument;
			case SHUFFLE -> "shuffle";
			case REPEAT -> "repeat";
		});
	}

	private synchronized void write(String line) {
		if (input == null) return;
		try {
			input.write(line + "\n");
			input.flush();
		} catch (IOException e) {
			// Skript ist beendet; der Hintergrund-Thread startet es neu
		}
	}

	@Override
	protected void disconnect() {
		write("quit");
		Process current;
		synchronized (this) {
			current = process;
		}
		if (current != null) {
			CompletableFuture.delayedExecutor(800, TimeUnit.MILLISECONDS).execute(() -> {
				if (current.isAlive()) current.destroy();
			});
		}
	}

	@Override
	protected void session(int gen) throws Exception {
		Path script = extractScript();
		Path covers = directory.resolve("covers");
		Files.createDirectories(covers);
		ProcessBuilder builder = new ProcessBuilder(powershell(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
				"-File", script.toString(), "-CoverDir", covers.toString(), "-Mode", anyPlayer ? "any" : "spotify");
		// Fehlerausgabe von PowerShell landet in einer kleinen Logdatei (wird bei 256 KB geleert)
		Path errors = directory.resolve("bridge-errors.log");
		if (Files.exists(errors) && Files.size(errors) > 256 * 1024) Files.delete(errors);
		builder.redirectError(ProcessBuilder.Redirect.appendTo(errors.toFile()));
		Process started = builder.start();
		synchronized (this) {
			process = started;
			input = new OutputStreamWriter(started.getOutputStream(), StandardCharsets.UTF_8);
		}
		try (BufferedReader reader = new BufferedReader(new InputStreamReader(started.getInputStream(), StandardCharsets.UTF_8))) {
			String line;
			while ((line = reader.readLine()) != null && alive(gen)) handle(line);
		} finally {
			synchronized (this) {
				if (process == started) {
					process = null;
					input = null;
				}
			}
			started.destroy();
		}
	}

	private void handle(String line) {
		String[] f = line.split("\t", -1);
		switch (f[0]) {
			case "STATE" -> {
				if (f.length < 10) return;
				long now = System.currentTimeMillis();
				long updated = number(f[8]);
				// LastUpdatedTime liegt manchmal in der Zukunft (andere Uhr) – dann gilt „jetzt“
				if (updated <= 0 || updated > now + 1000) updated = now;
				Boolean shuffle = f.length > 10 && !f[10].isBlank() ? Boolean.valueOf(f[10].equalsIgnoreCase("true")) : null;
				Track.Repeat repeat = f.length > 11 ? repeat(f[11]) : null;
				boolean canSeek = f.length > 12 && f[12].equalsIgnoreCase("true");
				if (f.length > 14) {
					playerIndex = (int) number(f[13]);
					players = f[14].isBlank() ? List.of() : List.of(f[14].split("\\|"));
				}
				update(new Track(f[1], "Playing".equals(f[2]), Track.clean(f[3]), Track.clean(f[4]), Track.clean(f[5]), number(f[6]),
						number(f[7]), updated, f[9].isBlank() ? null : Path.of(f[9]), shuffle, repeat, canSeek));
			}
			case "NONE" -> {
				players = List.of();
				playerIndex = -1;
				none(null);
			}
			case "RESULT" -> {
				if (f.length < 3) return;
				if ("unsupported".equals(f[2])) feedback.show(title(f[1]), "Wird von diesem Player nicht unterstützt");
				else if ("failed".equals(f[2])) feedback.show(title(f[1]), "Hat nicht geklappt");
				else if ("player".equals(f[1]) && f.length > 3) feedback.show("Player gewechselt", f[3]);
			}
			case "ERROR" -> error(f.length > 1 ? f[1] : "?");
			default -> {
			}
		}
	}

	private static String title(String command) {
		return switch (command) {
			case "shuffle" -> "Zufallswiedergabe";
			case "repeat" -> "Wiederholen";
			case "position" -> "Spulen";
			case "player" -> "Player wechseln";
			default -> "Spotify";
		};
	}

	private static Track.Repeat repeat(String text) {
		return switch (text) {
			case "None" -> Track.Repeat.OFF;
			case "List" -> Track.Repeat.LIST;
			case "Track" -> Track.Repeat.TRACK;
			default -> null;
		};
	}

	private static long number(String text) {
		try {
			return Long.parseLong(text.trim());
		} catch (NumberFormatException e) {
			return 0;
		}
	}

	private static String powershell() {
		String root = System.getenv("SystemRoot");
		if (root != null) {
			Path path = Path.of(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
			if (Files.isRegularFile(path)) return path.toString();
		}
		return "powershell.exe";
	}

	/** Skript aus dem Addon in den Addon-Ordner legen (mit UTF-8-BOM, sonst liest PowerShell 5 es als ANSI) */
	private Path extractScript() throws IOException {
		byte[] content;
		try (InputStream in = WindowsPlayer.class.getResourceAsStream("/" + SCRIPT)) {
			if (in == null) throw new IOException(SCRIPT + " fehlt im Addon");
			content = in.readAllBytes();
		}
		if (content.length < 3 || (content[0] & 0xFF) != 0xEF || (content[1] & 0xFF) != 0xBB || (content[2] & 0xFF) != 0xBF) {
			byte[] withBom = new byte[content.length + 3];
			withBom[0] = (byte) 0xEF;
			withBom[1] = (byte) 0xBB;
			withBom[2] = (byte) 0xBF;
			System.arraycopy(content, 0, withBom, 3, content.length);
			content = withBom;
		}
		Path target = directory.resolve(SCRIPT);
		if (!Files.exists(target) || !Arrays.equals(Files.readAllBytes(target), content)) {
			Files.createDirectories(directory);
			Files.write(target, content);
		}
		return target;
	}
}
