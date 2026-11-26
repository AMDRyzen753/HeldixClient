package dev.heldixclient.account;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * Verbindung zum Launcher, der dieses Spiel gestartet hat – über stdin/stdout, ohne Netzwerk (Protokoll:
 * docs/konto-wechsel.md). Nur aktiv, wenn der Launcher {@code -Dheldixclient.ipc=1} mitgibt; sonst bleibt stdin
 * unberührt und es erscheint nichts auf stdout.
 *
 * <ul>
 *   <li>Anfragen: eine Zeile {@code "\u0001heldix-ipc {json}\n"} direkt auf den Datei-Deskriptor von stdout – an
 *   {@code System.out} vorbei, das Minecraft ins Log umleitet (die Zeile soll nie in latest.log landen). Der
 *   Launcher schneidet sie aus der Ausgabe.</li>
 *   <li>Antworten und Ereignisse: JSON-Zeilen auf stdin, gelesen von einem eigenen Daemon-Thread.</li>
 * </ul>
 *
 * <p>Antworten können Zugangs-Tokens enthalten (accounts.session): Zeilen werden deshalb nie geloggt, nur Operation
 * und Fehlercode.
 */
public final class LauncherLink {
	public static final String MARKER = "\u0001heldix-ipc ";
	public static final int PROTOCOL = 1;
	static final String PROPERTY = "heldixclient.ipc";
	/** Ereignis an die Zuhörer, sobald hello beantwortet ist */
	public static final String EVENT_READY = "link.ready";
	/** Ereignis an die Zuhörer, wenn der Launcher weg ist (stdin zu) */
	public static final String EVENT_CLOSED = "link.closed";

	/** so lang darf eine Anfrage sein (wie im Launcher) */
	private static final int MAX_REQUEST = 4096;
	/** längste Zeile vom Launcher (Kontenliste, Sitzung) */
	private static final int MAX_LINE = 256 * 1024;
	private static final Duration HELLO_TIMEOUT = Duration.ofSeconds(5);

	public enum State {
		/** ohne Launcher gestartet (oder alter Launcher): kein Konto-Wechsel */
		OFF,
		CONNECTING,
		READY,
		/** Launcher beendet oder hat nicht geantwortet */
		CLOSED
	}

	private record Pending(String op, CompletableFuture<JsonObject> future) {
	}

	private static volatile State state = State.OFF;
	private static volatile boolean offlineAllowed;
	private static volatile boolean allowed = true;
	private static volatile String launcherVersion = "";
	private static boolean started;
	private static OutputStream out;
	private static final Object WRITE_LOCK = new Object();

	private static final AtomicInteger NEXT_ID = new AtomicInteger();
	private static final Map<Integer, Pending> PENDING = new ConcurrentHashMap<>();
	private static final List<Consumer<String>> LISTENERS = new CopyOnWriteArrayList<>();
	private static final ScheduledExecutorService TIMER = Executors.newSingleThreadScheduledExecutor(daemon("Heldix-Launcher-Zeitgeber"));
	/** schreibt nacheinander (ein voller Puffer beim Launcher soll nie den Render-Thread anhalten) */
	private static final ExecutorService WRITER = Executors.newSingleThreadExecutor(daemon("Heldix-Launcher-Senden"));

	private LauncherLink() {
	}

	private static java.util.concurrent.ThreadFactory daemon(String name) {
		return runnable -> {
			Thread thread = new Thread(runnable, name);
			thread.setDaemon(true);
			return thread;
		};
	}

	/** Einmal beim Start der Mod: verbinden, wenn der Launcher es anbietet. */
	public static synchronized void start() {
		if (started) return;
		started = true;
		if (!String.valueOf(PROTOCOL).equals(System.getProperty(PROPERTY))) return;
		state = State.CONNECTING;
		out = new FileOutputStream(FileDescriptor.out);
		Thread reader = new Thread(LauncherLink::readLoop, "Heldix-Launcher-Empfang");
		reader.setDaemon(true);
		reader.start();
		request("hello", null, HELLO_TIMEOUT).whenComplete((result, error) -> {
			if (error != null) {
				HeldixClient.LOGGER.info("Launcher-Verbindung: keine Antwort auf hello ({}) – Konto-Wechsel aus", LauncherException.describe(error));
				close();
				return;
			}
			JsonElement protocol = result.get("protocol");
			if (protocol == null || !protocol.isJsonPrimitive() || !protocol.getAsJsonPrimitive().isNumber() || protocol.getAsInt() != PROTOCOL) {
				HeldixClient.LOGGER.info("Launcher-Verbindung: anderes Protokoll – Konto-Wechsel aus");
				close();
				return;
			}
			JsonElement offline = result.get("offline");
			offlineAllowed = offline != null && offline.isJsonPrimitive() && offline.getAsJsonPrimitive().isBoolean() && offline.getAsBoolean();
			updateAllowed(result);
			JsonElement version = result.get("launcher");
			launcherVersion = version != null && version.isJsonPrimitive() ? version.getAsString() : "";
			state = State.READY;
			HeldixClient.LOGGER.info("Launcher-Verbindung bereit (Launcher {})", launcherVersion);
			fire(EVENT_READY);
		});
	}

	public static State state() {
		return state;
	}

	/** Verbindung steht: vom Launcher gestartet und hello beantwortet (ob gewechselt werden darf: {@link #allowed()}) */
	public static boolean ready() {
		return state == State.READY;
	}

	/** Einstellung „Kontowechsel im Spiel erlauben“ im Launcher (kommt mit hello und jeder Kontenliste) */
	public static boolean allowed() {
		return allowed;
	}

	/** {@code allowed} aus einer Antwort übernehmen (fehlt es, gilt die letzte Angabe; ältere Launcher: erlaubt) */
	static void updateAllowed(JsonObject result) {
		JsonElement value = result.get("allowed");
		if (value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean()) allowed = value.getAsBoolean();
	}

	/** Absage not_allowed: der Launcher hat den Wechsel inzwischen ausgeschaltet */
	static void markNotAllowed() {
		allowed = false;
	}

	/** Entwicklungsversion des Launchers: Offline-Konten erlaubt */
	public static boolean offlineAllowed() {
		return offlineAllowed;
	}

	public static String launcherVersion() {
		return launcherVersion;
	}

	/**
	 * Ereignisse vom Launcher ({@code accounts.changed}) und der Verbindung ({@link #EVENT_READY}, {@link #EVENT_CLOSED}).
	 * Läuft auf dem Empfangs-Thread – für Minecraft also mit {@code Minecraft.execute} weitergeben. Rückgabe: abmelden.
	 */
	public static Runnable onEvent(Consumer<String> listener) {
		LISTENERS.add(listener);
		return () -> LISTENERS.remove(listener);
	}

	/**
	 * Anfrage an den Launcher. Das Ergebnis kommt auf dem Empfangs-Thread (oder dem Zeitgeber bei Zeitüberschreitung);
	 * Fehler sind immer {@link LauncherException}.
	 */
	public static CompletableFuture<JsonObject> request(String op, JsonObject params, Duration timeout) {
		CompletableFuture<JsonObject> future = new CompletableFuture<>();
		State current = state;
		if (current != State.CONNECTING && current != State.READY) {
			future.completeExceptionally(LauncherException.unavailable());
			return future;
		}
		int id = NEXT_ID.updateAndGet(n -> n >= Integer.MAX_VALUE - 1 ? 1 : n + 1);
		JsonObject request = new JsonObject();
		request.addProperty("v", PROTOCOL);
		request.addProperty("id", id);
		request.addProperty("op", op);
		if (params != null && !params.isEmpty()) request.add("params", params);
		String json = request.toString();
		if (json.length() > MAX_REQUEST || json.indexOf('\n') >= 0) {
			future.completeExceptionally(new LauncherException("bad_request", "Anfrage zu lang"));
			return future;
		}
		PENDING.put(id, new Pending(op, future));
		ScheduledFuture<?> timer = TIMER.schedule(() -> {
			if (PENDING.remove(id) != null) future.completeExceptionally(LauncherException.timeout());
		}, timeout.toMillis(), TimeUnit.MILLISECONDS);
		future.whenComplete((result, error) -> timer.cancel(false));
		WRITER.execute(() -> {
			try {
				write(json);
			} catch (IOException e) {
				if (PENDING.remove(id) != null) future.completeExceptionally(LauncherException.unavailable());
				close();
			}
		});
		return future;
	}

	private static void write(String json) throws IOException {
		byte[] line = (MARKER + json + "\n").getBytes(StandardCharsets.UTF_8);
		// ein Schreibvorgang für die ganze Zeile: Log-Ausgabe anderer Threads landet davor oder danach
		synchronized (WRITE_LOCK) {
			out.write(line);
			out.flush();
		}
	}

	private static void readLoop() {
		try {
			InputStream in = new BufferedInputStream(new FileInputStream(FileDescriptor.in), 16 * 1024);
			ByteArrayOutputStream line = new ByteArrayOutputStream(512);
			boolean skipping = false;
			int b;
			while ((b = in.read()) != -1) {
				if (b == '\n') {
					if (!skipping) handleLine(line.toString(StandardCharsets.UTF_8));
					line.reset();
					skipping = false;
				} else if (!skipping) {
					if (line.size() >= MAX_LINE) {
						// nicht puffern, nicht loggen (könnte ein Token enthalten)
						line.reset();
						skipping = true;
						HeldixClient.LOGGER.warn("Launcher-Verbindung: zu lange Zeile verworfen");
					} else {
						line.write(b);
					}
				}
			}
		} catch (IOException | RuntimeException e) {
			HeldixClient.LOGGER.info("Launcher-Verbindung: Lesen beendet ({})", e.getClass().getSimpleName());
		}
		close();
	}

	private static void handleLine(String text) {
		String trimmed = text.strip();
		if (trimmed.isEmpty()) return;
		JsonObject message;
		try {
			JsonElement element = JsonParser.parseString(trimmed);
			if (!element.isJsonObject()) return;
			message = element.getAsJsonObject();
		} catch (RuntimeException e) {
			return;
		}
		JsonElement event = message.get("event");
		if (event != null) {
			if (event.isJsonPrimitive() && event.getAsString().length() <= 64 && !event.getAsString().startsWith("link.")) fire(event.getAsString());
			return;
		}
		JsonElement id = message.get("id");
		if (id == null || id.isJsonNull()) {
			// Absage ohne ID: der Launcher konnte eine Anfrage nicht lesen (Fehler in dieser Mod)
			HeldixClient.LOGGER.warn("Launcher-Verbindung: Anfrage abgelehnt ({})", errorCode(message));
			return;
		}
		if (!id.isJsonPrimitive() || !id.getAsJsonPrimitive().isNumber()) return;
		Pending pending = PENDING.remove(id.getAsInt());
		if (pending == null) return;
		JsonElement ok = message.get("ok");
		if (ok != null && ok.isJsonPrimitive() && ok.getAsJsonPrimitive().isBoolean() && ok.getAsBoolean()) {
			JsonElement result = message.get("result");
			pending.future().complete(result != null && result.isJsonObject() ? result.getAsJsonObject() : new JsonObject());
		} else {
			String code = errorCode(message);
			JsonObject error = message.has("error") && message.get("error").isJsonObject() ? message.getAsJsonObject("error") : new JsonObject();
			JsonElement messageText = error.get("message");
			String userText = messageText != null && messageText.isJsonPrimitive() ? messageText.getAsString() : "Der Launcher hat die Anfrage abgelehnt.";
			if (!"cancelled".equals(code)) HeldixClient.LOGGER.info("Launcher-Verbindung: {} abgelehnt ({})", pending.op(), code);
			if ("not_allowed".equals(code) && !"accounts.setActive".equals(pending.op())) markNotAllowed();
			pending.future().completeExceptionally(new LauncherException(code, userText));
		}
	}

	private static String errorCode(JsonObject message) {
		JsonElement error = message.get("error");
		if (error == null || !error.isJsonObject()) return "internal";
		JsonElement code = error.getAsJsonObject().get("code");
		return code != null && code.isJsonPrimitive() && code.getAsString().matches("[a-z_]{1,32}") ? code.getAsString() : "internal";
	}

	private static void fire(String event) {
		for (Consumer<String> listener : LISTENERS) {
			try {
				listener.accept(event);
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.warn("Launcher-Verbindung: Fehler beim Ereignis {}", event, e);
			}
		}
	}

	private static synchronized void close() {
		State before = state;
		if (before == State.CLOSED || before == State.OFF) return;
		state = State.CLOSED;
		for (Integer id : List.copyOf(PENDING.keySet())) {
			Pending pending = PENDING.remove(id);
			if (pending != null) pending.future().completeExceptionally(LauncherException.unavailable());
		}
		fire(EVENT_CLOSED);
	}
}
