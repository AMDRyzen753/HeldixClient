package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixLogger;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Verbindung zum Musik-Player des Systems, ohne Spotify-Konto und ohne API-Schlüssel. Je System eine Unterklasse:
 * Windows-Mediensteuerung ({@link WindowsPlayer}), Spotify und Apple Music per AppleScript ({@link MacPlayer}) und
 * MPRIS über playerctl ({@link LinuxPlayer}).
 *
 * <p>Ein Hintergrund-Thread hält die Verbindung (Prozess oder Abfrage). Bricht sie ab, wird sie mit wachsender
 * Pause (2 s, 4 s … höchstens 30 s) neu aufgebaut. Befehle blockieren den Haupt-Thread nie.
 */
abstract class Player {
	/** Rückmeldung an den Spieler (Einblendung), darf aus jedem Thread kommen */
	interface Feedback {
		void show(String title, String message);
	}

	enum Os {
		WINDOWS, MAC, LINUX, OTHER;

		static Os current() {
			String name = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
			if (name.startsWith("windows")) return WINDOWS;
			if (name.startsWith("mac") || name.contains("darwin")) return MAC;
			if (name.contains("linux") || name.contains("bsd")) return LINUX;
			return OTHER;
		}
	}

	/** Für das jeweilige System; null, wenn es keins gibt */
	static Player create(Os os, HeldixLogger logger, Path directory, Feedback feedback, Consumer<Runnable> async) {
		return switch (os) {
			case WINDOWS -> new WindowsPlayer(logger, directory, feedback);
			case MAC -> new MacPlayer(logger, directory, feedback, async);
			case LINUX -> new LinuxPlayer(logger, directory, feedback, async);
			case OTHER -> null;
		};
	}

	protected final HeldixLogger logger;
	protected final Path directory;
	protected final Feedback feedback;
	protected volatile Track track;
	protected volatile boolean connected;
	protected volatile boolean anyPlayer;
	/** warum gerade nichts angezeigt werden kann, z. B. „Spotify nicht geöffnet“ (null = kein Problem) */
	protected volatile String problem;
	/** Fehlstarts in Folge (0, sobald der Player antwortet) */
	protected volatile int failures;
	private volatile boolean running;
	/** Verbindung soll ohne Pause neu aufgebaut werden (restart), z. B. nach einem Wechsel von „Nur Spotify“ */
	private volatile boolean restarting;
	/** Jeder Start bekommt eine neue Nummer; ein Thread aus einem früheren Start beendet sich still */
	private volatile int generation;
	private Thread thread;
	private String lastError;
	private final Semaphore wake = new Semaphore(0);

	/** Nach einem Befehl sofort den erwarteten Zustand zeigen, bis der Player ihn bestätigt */
	private static final long EXPECT_MS = 2500;
	private volatile Boolean expectedPlaying;
	private volatile long expectedUntil;
	private volatile long expectedPosition;
	private volatile long expectedSince;

	Player(HeldixLogger logger, Path directory, Feedback feedback) {
		this.logger = logger;
		this.directory = directory;
		this.feedback = feedback;
	}

	// --- Zustand -------------------------------------------------------------------------------

	/** null = nichts läuft bzw. kein Player offen */
	Track track() {
		return track;
	}

	/** true, sobald der Player mindestens einmal geantwortet hat */
	boolean connected() {
		return connected;
	}

	boolean running() {
		return running;
	}

	int failures() {
		return failures;
	}

	String problem() {
		return problem;
	}

	/** Text, wenn verbunden, aber kein Song da ist */
	abstract String idleText();

	/** Spielt der Song gerade? Berücksichtigt einen eben gesendeten Befehl. */
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

	/** Neuer Zustand vom Player (aus dem Hintergrund-Thread) */
	protected void update(Track next) {
		Boolean expected = expectedPlaying;
		if (expected != null && next != null && next.playing() == expected && Math.abs(next.position(System.currentTimeMillis())
				- position(next, System.currentTimeMillis())) < 3000) {
			expectedPlaying = null;
		}
		if (next == null) expectedPlaying = null;
		track = next;
		connected = true;
		failures = 0;
		problem = null;
		lastError = null;
	}

	/** Verbunden, aber nichts zu zeigen (z. B. Spotify geschlossen) */
	protected void none(String reason) {
		track = null;
		connected = true;
		failures = 0;
		problem = reason;
		expectedPlaying = null;
	}

	protected void error(String message) {
		if (!message.equals(lastError)) logger.warn("Player: " + message);
		lastError = message;
	}

	private void expect(boolean playing, long position) {
		long now = System.currentTimeMillis();
		expectedPlaying = playing;
		expectedPosition = Math.max(0, position);
		expectedSince = now;
		expectedUntil = now + EXPECT_MS;
	}

	// --- Starten und Beenden ---------------------------------------------------------------------

	synchronized void start() {
		if (running) return;
		running = true;
		int gen = ++generation;
		thread = new Thread(() -> loop(gen), "Heldix-Spotify");
		thread.setDaemon(true);
		thread.start();
	}

	/** Beendet die Verbindung (blockiert nicht) */
	synchronized void stop() {
		if (!running) return;
		running = false;
		generation++;
		disconnect();
		if (thread != null) thread.interrupt();
		thread = null;
		track = null;
		connected = false;
		problem = null;
	}

	/** Nur Spotify oder jeden Player steuern */
	void setAnyPlayer(boolean any) {
		if (anyPlayer == any) return;
		anyPlayer = any;
		modeChanged();
		wakeUp();
	}

	protected void modeChanged() {
	}

	/** Prozess beenden o. Ä. (aus stop(), beliebiger Thread) */
	protected void disconnect() {
	}

	/** Verbindung sofort neu aufbauen (ohne Pause, zählt nicht als Fehler) */
	protected void restart() {
		restarting = true;
		disconnect();
	}

	protected boolean alive(int gen) {
		return running && generation == gen;
	}

	private void loop(int gen) {
		failures = 0;
		while (alive(gen)) {
			long started = System.currentTimeMillis();
			try {
				session(gen);
			} catch (InterruptedException e) {
				break;
			} catch (Exception e) {
				if (alive(gen)) error("nicht erreichbar: " + e.getMessage());
			}
			if (!alive(gen)) break;
			track = null;
			connected = false;
			if (restarting) {
				restarting = false;
				failures = 0;
				continue;
			}
			// lief es eine Weile stabil, zählt der Absturz nicht als Folgefehler
			failures = System.currentTimeMillis() - started > 60_000 ? 1 : failures + 1;
			try {
				Thread.sleep(Math.min(30_000L, 2_000L * failures));
			} catch (InterruptedException e) {
				break;
			}
		}
	}

	/** Eine Verbindung: läuft, bis sie abbricht (Ausnahme oder Rückkehr = neu verbinden) */
	protected abstract void session(int gen) throws Exception;

	/** Warten, bis die Zeit um ist oder ein Befehl sofort eine neue Abfrage braucht */
	protected void pause(long millis) throws InterruptedException {
		if (wake.tryAcquire(millis, TimeUnit.MILLISECONDS)) wake.drainPermits();
	}

	protected void wakeUp() {
		wake.release();
	}

	// --- Befehle (blockieren nie; Rückmeldung über feedback) -------------------------------------

	void playPause() {
		Track current = track;
		if (current != null) {
			long now = System.currentTimeMillis();
			expect(!playing(current, now), position(current, now));
		}
		send(Command.PLAY_PAUSE, 0);
	}

	void next() {
		send(Command.NEXT, 0);
	}

	void previous() {
		send(Command.PREVIOUS, 0);
	}

	/** Um deltaMs vor- oder zurückspulen (Ziel wird auf den Song begrenzt) */
	void seek(long deltaMs) {
		Track current = track;
		if (current == null) return;
		if (!current.canSeek()) {
			feedback.show("Spulen geht nicht", current.app() + " lässt sich nicht vor- oder zurückspulen");
			return;
		}
		long now = System.currentTimeMillis();
		long target = position(current, now) + deltaMs;
		if (current.durationMs() > 0) target = Math.min(target, current.durationMs() - 1000);
		target = Math.max(0, target);
		expect(playing(current, now), target);
		send(Command.SEEK, target);
	}

	void toggleShuffle() {
		Track current = track;
		if (current != null && current.shuffle() == null) {
			feedback.show("Zufallswiedergabe", current.app() + " meldet keine Zufallswiedergabe");
			return;
		}
		send(Command.SHUFFLE, 0);
	}

	void cycleRepeat() {
		Track current = track;
		if (current != null && current.repeat() == null) {
			feedback.show("Wiederholen", current.app() + " meldet kein Wiederholen");
			return;
		}
		send(Command.REPEAT, 0);
	}

	/** Bei mehreren Playern zum nächsten wechseln (nur wo das System mehrere kennt) */
	void nextPlayer() {
		feedback.show("Player wechseln", "Geht nur unter Windows mit ausgeschaltetem „Nur Spotify“");
	}

	/** Namen der Player, zwischen denen man wechseln kann (leer = nur einer) */
	List<String> players() {
		return List.of();
	}

	enum Command { PLAY_PAUSE, NEXT, PREVIOUS, SEEK, SHUFFLE, REPEAT }

	/** Befehl an den Player (darf nicht blockieren) */
	protected abstract void send(Command command, long argument);

	// --- Hilfen für externe Programme ----------------------------------------------------------------

	/** Ergebnis eines Programmaufrufs */
	record Result(int exit, String out, String err) {
	}

	/**
	 * Startet ein Programm, wartet höchstens timeoutMs und liest höchstens 64 KB Ausgabe.
	 *
	 * @throws IOException wenn es fehlt oder zu lange braucht
	 */
	static Result exec(List<String> command, long timeoutMs) throws IOException, InterruptedException {
		Process process = new ProcessBuilder(command).start();
		process.getOutputStream().close();
		try {
			String[] out = {"", ""};
			Thread stdout = reader(process.getInputStream(), text -> out[0] = text);
			Thread stderr = reader(process.getErrorStream(), text -> out[1] = text);
			if (!process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) throw new IOException(command.getFirst() + " antwortet nicht");
			// join: danach sind die gelesenen Texte sichtbar
			stdout.join(1000);
			stderr.join(1000);
			return new Result(process.exitValue(), out[0], out[1]);
		} finally {
			if (process.isAlive()) process.destroyForcibly();
		}
	}

	private static Thread reader(InputStream in, Consumer<String> result) {
		Thread thread = new Thread(() -> result.accept(read(in)), "Heldix-Spotify-Ausgabe");
		thread.setDaemon(true);
		thread.start();
		return thread;
	}

	static String read(InputStream in) {
		try (in) {
			byte[] bytes = in.readNBytes(64 * 1024);
			return new String(bytes, StandardCharsets.UTF_8);
		} catch (IOException e) {
			return "";
		}
	}
}
