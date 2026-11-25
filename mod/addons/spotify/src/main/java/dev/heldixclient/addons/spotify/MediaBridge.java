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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Verbindung zur Windows-Mediensteuerung (System Media Transport Controls) über ein kleines PowerShell-Skript.
 * Windows kennt den laufenden Song jedes Players, der sich dort anmeldet – Spotify tut das immer.
 * Dadurch braucht das Addon kein Spotify-Konto, keine Anmeldung und keinen API-Schlüssel.
 *
 * <p>Das Skript schreibt einmal pro Sekunde den Zustand (eine Tab-getrennte Zeile) und nimmt Befehle
 * zeilenweise über die Standardeingabe an. Endet es unerwartet, wird es mit wachsender Pause neu gestartet.
 */
final class MediaBridge {
	/** Ein Song, wie ihn Windows meldet. Positionen in Millisekunden. */
	record Track(String app, String status, String title, String artist, String album, long positionMs, long durationMs,
			long updatedAt, Path cover) {
		boolean playing() {
			return "Playing".equals(status);
		}

		String key() {
			return title + '\u0000' + artist + '\u0000' + album;
		}

		/** aktuelle Position: Windows meldet sie nur alle paar Sekunden, dazwischen wird hochgezählt */
		long position(long now) {
			long position = positionMs;
			if (playing() && updatedAt > 0) position += Math.max(0, now - updatedAt);
			return durationMs > 0 ? Math.min(position, durationMs) : position;
		}
	}

	private static final String SCRIPT = "heldix-media.ps1";

	private final HeldixLogger logger;
	private final Path directory;
	private volatile Track track;
	private volatile boolean connected;
	private volatile boolean anyPlayer;
	private volatile boolean running;
	/** Jeder Start bekommt eine neue Nummer; ein Thread aus einem früheren Start beendet sich still */
	private volatile int generation;
	/** Fehlstarts in Folge (0, sobald das Skript antwortet) */
	private volatile int failures;
	private String lastError;

	/** Nach „Abspielen/Pause“ sofort den erwarteten Zustand zeigen, bis Windows ihn bestätigt */
	private static final long EXPECT_MS = 2500;
	private volatile Boolean expectedPlaying;
	private volatile long expectedUntil;
	private volatile long expectedPosition;
	private volatile long expectedSince;

	private Thread thread;
	private Process process;
	private Writer input;

	MediaBridge(HeldixLogger logger, Path directory) {
		this.logger = logger;
		this.directory = directory;
	}

	/** null = nichts läuft bzw. kein Player offen */
	Track track() {
		return track;
	}

	/** true, sobald das Skript läuft und mindestens einmal geantwortet hat */
	boolean connected() {
		return connected;
	}

	boolean running() {
		return running;
	}

	/** Wie oft das Skript in Folge nicht gestartet ist bzw. abgestürzt ist */
	int failures() {
		return failures;
	}

	/** Spielt der Song gerade? Berücksichtigt einen eben gesendeten Abspielen/Pause-Befehl. */
	boolean playing(Track track, long now) {
		Boolean expected = expectedPlaying;
		if (expected != null && now < expectedUntil) return expected;
		return track.playing();
	}

	long position(Track track, long now) {
		Boolean expected = expectedPlaying;
		if (expected != null && now < expectedUntil) {
			if (!expected) return expectedPosition;
			long position = expectedPosition + (now - expectedSince);
			return track.durationMs() > 0 ? Math.min(position, track.durationMs()) : position;
		}
		return track.position(now);
	}

	synchronized void start() {
		if (running) return;
		running = true;
		int gen = ++generation;
		thread = new Thread(() -> loop(gen), "Heldix-Spotify");
		thread.setDaemon(true);
		thread.start();
	}

	/** Beendet das Skript (blockiert nicht: falls es nicht von selbst endet, wird es kurz danach abgebrochen) */
	synchronized void stop() {
		if (!running) return;
		running = false;
		generation++;
		send("quit");
		Process current = process;
		if (current != null) {
			CompletableFuture.delayedExecutor(800, TimeUnit.MILLISECONDS).execute(() -> {
				if (current.isAlive()) current.destroy();
			});
		}
		if (thread != null) thread.interrupt();
		thread = null;
		track = null;
		connected = false;
	}

	/** Nur Spotify oder jeden Player steuern */
	void setAnyPlayer(boolean any) {
		if (anyPlayer == any) return;
		anyPlayer = any;
		send(any ? "mode any" : "mode spotify");
	}

	void playPause() {
		Track current = track;
		if (current != null) {
			long now = System.currentTimeMillis();
			boolean playing = playing(current, now);
			expectedPosition = position(current, now);
			expectedSince = now;
			expectedPlaying = !playing;
			expectedUntil = now + EXPECT_MS;
		}
		send("playpause");
	}

	void next() {
		send("next");
	}

	void previous() {
		send("previous");
	}

	private synchronized void send(String command) {
		if (input == null) return;
		try {
			input.write(command + "\n");
			input.flush();
		} catch (IOException e) {
			// Skript ist beendet; der Lese-Thread startet es neu
		}
	}

	// --- Hintergrund-Thread -------------------------------------------------------------------

	private boolean alive(int gen) {
		return running && generation == gen;
	}

	private void loop(int gen) {
		failures = 0;
		while (alive(gen)) {
			long started = System.currentTimeMillis();
			try {
				Path script = extractScript();
				runOnce(script, gen);
			} catch (Exception e) {
				if (alive(gen)) logger.warn("Mediensteuerung nicht erreichbar: " + e.getMessage());
			}
			if (!alive(gen)) break;
			track = null;
			connected = false;
			// lief es eine Weile stabil, zählt der Absturz nicht als Folgefehler
			failures = System.currentTimeMillis() - started > 60_000 ? 1 : failures + 1;
			int wait = failures;
			try {
				Thread.sleep(Math.min(30_000L, 2_000L * wait));
			} catch (InterruptedException e) {
				break;
			}
		}
	}

	private void runOnce(Path script, int gen) throws IOException {
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
			while ((line = reader.readLine()) != null && alive(gen)) {
				handle(line);
			}
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
		String[] fields = line.split("\t", -1);
		switch (fields[0]) {
			case "STATE" -> {
				if (fields.length < 10) return;
				Track next = new Track(fields[1], fields[2], fields[3], fields[4], fields[5], number(fields[6]), number(fields[7]),
						number(fields[8]), fields[9].isBlank() ? null : Path.of(fields[9]));
				Boolean expected = expectedPlaying;
				if (expected != null && next.playing() == expected) expectedPlaying = null;
				track = next;
				connected = true;
				failures = 0;
				lastError = null;
			}
			case "NONE" -> {
				track = null;
				connected = true;
				failures = 0;
				expectedPlaying = null;
			}
			case "ERROR" -> {
				String message = fields.length > 1 ? fields[1] : "?";
				if (!message.equals(lastError)) logger.warn("Mediensteuerung: " + message);
				lastError = message;
			}
			default -> {
			}
		}
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
		try (InputStream in = MediaBridge.class.getResourceAsStream("/" + SCRIPT)) {
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
