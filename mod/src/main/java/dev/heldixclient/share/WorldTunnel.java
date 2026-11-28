package dev.heldixclient.share;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.social.Social;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * Tunnel einer geteilten Welt zum Heldix-Dienst (Protokoll in docs/dienst.md „Welt teilen“):
 * <ul>
 *   <li>Steuerverbindung {@code /v1/worlds/host} (Bearer): {@code open} → {@code ready}; der Dienst meldet {@code stream},
 *   {@code knock} und {@code status}; wir melden {@code players}, {@code allow}/{@code deny}, alle 20 s {@code ping} und
 *   zum Schluss {@code close}. Bei Netzfehlern wird mit wachsender Pause neu verbunden – nicht bei 4002 (eine neuere
 *   Verbindung desselben Spielers hat diese ersetzt) und nicht nach {@code error}.</li>
 *   <li>Je {@code stream} ein Daten-WebSocket {@code /v1/worlds/streams/<id>} (binär) ↔ ein TCP-Socket zu
 *   {@code 127.0.0.1:<LAN-Port>}: Lesen und Schreiben auf eigenen Threads, mit Gegendruck in beide Richtungen
 *   (der nächste Rahmen wird erst angefordert bzw. gelesen, wenn der vorige geschrieben bzw. gesendet ist).</li>
 * </ul>
 * Tokens und Inhalte werden nie geloggt; Fehler beenden nur den betroffenen Datenstrom.
 */
final class WorldTunnel {
	/** Ereignisse für {@link WorldShare}; kommen auf Netzwerk-Threads */
	interface Events {
		void ready(String address, String code);

		/** Dienst lehnt ab (z. B. andere Welt schon offen): kein neuer Versuch */
		void rejected(String message);

		/** Verbindung weg; {@code retrying} = es wird neu verbunden */
		void lost(int code, boolean retrying);

		void knock(String name);

		/** neuer Datenstrom (kind status oder login, name aus Login Start oder null) */
		void stream(String kind, String name);

		/** Mitgliederliste vom Dienst (nach ready und bei jeder Änderung) */
		void members(JsonElement list);

		/** Einstellungen der Welt geändert (z. B. über die Webseite): Welt wie bei GET /v1/worlds */
		void settings(JsonElement world);
	}

	private static final Pattern STREAM_ID = Pattern.compile("^[0-9a-f]{32}$");
	/** höchstens so viele Datenströme gleichzeitig (Status-Abfragen und Spieler) */
	private static final int MAX_STREAMS = 48;
	private static final int BUFFER = 32 * 1024;

	private final String worldId;
	private final int lanPort;
	private final String version;
	private final int protocol;
	private final String motd;
	private final Events events;

	private final ExecutorService threads = Executors.newCachedThreadPool(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Welt-Strom");
		thread.setDaemon(true);
		return thread;
	});
	/** Steuerverbindung: Senden immer nacheinander, Ping und neue Versuche */
	private final ScheduledExecutorService control = Executors.newSingleThreadScheduledExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Welt");
		thread.setDaemon(true);
		return thread;
	});
	private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10))
			.executor(threads).build();
	private final Map<String, Stream> streams = new ConcurrentHashMap<>();

	private volatile WebSocket socket;
	private volatile boolean closed;
	private volatile boolean ready;
	/** war schon einmal bereit (danach wird bei Netzfehlern immer neu versucht) */
	private volatile boolean everReady;
	/** steigt mit jedem Verbindungsversuch: Ereignisse alter Verbindungen werden ignoriert */
	private final AtomicInteger generation = new AtomicInteger();
	private int attempt;
	private ScheduledFuture<?> ping;

	WorldTunnel(String worldId, int lanPort, String version, int protocol, String motd, Events events) {
		this.worldId = worldId;
		this.lanPort = lanPort;
		this.version = version;
		this.protocol = protocol;
		this.motd = motd;
		this.events = events;
	}

	boolean ready() {
		return ready && socket != null;
	}

	int streamCount() {
		return streams.size();
	}

	void start() {
		control.execute(this::connect);
		ping = control.scheduleAtFixedRate(() -> {
			JsonObject message = new JsonObject();
			message.addProperty("type", "ping");
			sendNow(message);
		}, 20, 20, TimeUnit.SECONDS);
	}

	/** Nachricht über die Steuerverbindung (jeder Thread; geht nacheinander raus) */
	void send(JsonObject message) {
		if (closed) return;
		control.execute(() -> sendNow(message));
	}

	/** Tunnel beenden: {@code close} an den Dienst, alle Datenströme zu */
	void close() {
		if (closed) return;
		closed = true;
		ready = false;
		generation.incrementAndGet();
		if (ping != null) ping.cancel(false);
		control.execute(() -> {
			WebSocket ws = socket;
			socket = null;
			if (ws != null) {
				try {
					JsonObject message = new JsonObject();
					message.addProperty("type", "close");
					ws.sendText(message.toString(), true).get(3, TimeUnit.SECONDS);
					ws.sendClose(WebSocket.NORMAL_CLOSURE, "").get(3, TimeUnit.SECONDS);
				} catch (Exception e) {
					// Dienst nicht mehr erreichbar: einfach schließen
				}
				ws.abort();
			}
			control.shutdown();
			threads.shutdown();
		});
		for (Stream stream : streams.values()) stream.close();
		streams.clear();
	}

	// ======================================================================================
	// Steuerverbindung
	// ======================================================================================

	private void connect() {
		if (closed) return;
		int gen = generation.incrementAndGet();
		String token = Social.serviceToken();
		if (token == null) {
			// Dienst gerade getrennt (z. B. neue Anmeldung): gleich noch einmal
			retry(gen, 0);
			return;
		}
		String url = Social.baseUrl().replaceFirst("^http", "ws") + "/v1/worlds/host";
		try {
			WebSocket ws = http.newWebSocketBuilder()
					.header("Authorization", "Bearer " + token)
					.connectTimeout(Duration.ofSeconds(10))
					.buildAsync(URI.create(url), new ControlListener(gen))
					.get(15, TimeUnit.SECONDS);
			if (closed || gen != generation.get()) {
				ws.abort();
				return;
			}
			socket = ws;
			JsonObject open = new JsonObject();
			open.addProperty("type", "open");
			open.addProperty("world", worldId);
			open.addProperty("version", version);
			open.addProperty("protocol", protocol);
			open.addProperty("motd", motd);
			open.addProperty("lanReady", true);
			sendNow(open);
		} catch (Exception e) {
			HeldixClient.LOGGER.info("Welt teilen: keine Verbindung zum Heldix-Dienst ({})", e.getClass().getSimpleName());
			retry(gen, -1);
		}
	}

	/** Neuer Versuch mit wachsender Pause (2 s bis 30 s) */
	private void retry(int gen, int code) {
		if (closed || gen != generation.get()) return;
		ready = false;
		socket = null;
		if (!everReady && attempt >= 3) {
			// kam nie zustande: aufgeben statt endlos zu warten (LAN macht WorldShare wieder zu)
			generation.incrementAndGet();
			events.rejected(code > 0 ? "Der Heldix-Dienst hat die Verbindung für die Welt beendet (" + code + ")."
					: "Keine Verbindung zum Heldix-Dienst – Teilen abgebrochen.");
			return;
		}
		long delay = Math.min(30, 2L << Math.min(attempt, 4));
		attempt++;
		events.lost(code, true);
		try {
			control.schedule(this::connect, delay, TimeUnit.SECONDS);
		} catch (java.util.concurrent.RejectedExecutionException e) {
			// gerade beendet
		}
	}

	private void sendNow(JsonObject message) {
		WebSocket ws = socket;
		if (ws == null) return;
		try {
			ws.sendText(message.toString(), true).get(10, TimeUnit.SECONDS);
		} catch (Exception e) {
			HeldixClient.LOGGER.debug("Welt teilen: Senden fehlgeschlagen ({})", e.getClass().getSimpleName());
		}
	}

	private final class ControlListener implements WebSocket.Listener {
		private final int gen;
		private final StringBuilder buffer = new StringBuilder();

		ControlListener(int gen) {
			this.gen = gen;
		}

		@Override
		public void onOpen(WebSocket webSocket) {
			webSocket.request(1);
		}

		@Override
		public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
			buffer.append(data);
			if (buffer.length() > 64 * 1024) buffer.setLength(0);
			if (last) {
				String text = buffer.toString();
				buffer.setLength(0);
				if (gen == generation.get() && !closed) {
					try {
						JsonElement element = JsonParser.parseString(text);
						if (element.isJsonObject()) handle(webSocket, element.getAsJsonObject());
					} catch (RuntimeException e) {
						HeldixClient.LOGGER.debug("Welt teilen: unlesbare Nachricht vom Dienst");
					}
				}
			}
			webSocket.request(1);
			return null;
		}

		@Override
		public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
			lost(statusCode);
			return null;
		}

		@Override
		public void onError(WebSocket webSocket, Throwable error) {
			lost(-1);
		}

		private void lost(int code) {
			if (gen != generation.get() || closed) return;
			ready = false;
			socket = null;
			HeldixClient.LOGGER.info("Welt teilen: Steuerverbindung getrennt ({})", code);
			// 4001 Konto gelöscht, 4002 neue Verbindung (in einem anderen Spiel geöffnet), 4003 gesperrt, 4010 Welt gelöscht,
			// 4011 Fehler: kein neuer Versuch
			if (code == 4001 || code == 4002 || code == 4003 || code == 4010 || code == 4011) {
				events.lost(code, false);
				return;
			}
			try {
				control.execute(() -> retry(gen, code));
			} catch (java.util.concurrent.RejectedExecutionException e) {
				// gerade beendet
			}
		}
	}

	private void handle(WebSocket webSocket, JsonObject message) {
		String type = string(message, "type");
		if (type == null) return;
		switch (type) {
			case "ready" -> {
				String address = string(message, "address");
				if (address == null) return;
				ready = true;
				everReady = true;
				attempt = 0;
				events.ready(address.trim().toLowerCase(java.util.Locale.ROOT), string(message, "code"));
			}
			case "error" -> {
				String text = string(message, "message");
				// kein neuer Versuch: das Schließen gehört schon nicht mehr zu einer aktuellen Verbindung
				ready = false;
				socket = null;
				generation.incrementAndGet();
				webSocket.abort();
				events.rejected(text != null && !text.isBlank() ? text : "Der Heldix-Dienst hat das Teilen abgelehnt");
			}
			case "stream" -> {
				String id = string(message, "id");
				if (id == null || !STREAM_ID.matcher(id).matches()) return;
				String kind = string(message, "kind");
				String name = string(message, "name");
				events.stream(kind, name);
				openStream(id);
			}
			case "knock" -> {
				String name = string(message, "name");
				if (name != null && name.matches("^[A-Za-z0-9_]{1,16}$")) events.knock(name);
			}
			case "members" -> events.members(message.get("members"));
			case "settings" -> events.settings(message.get("world"));
			default -> {
				// pong, status und Unbekanntes
			}
		}
	}

	// ======================================================================================
	// Datenströme
	// ======================================================================================

	private void openStream(String id) {
		if (closed || streams.size() >= MAX_STREAMS || streams.containsKey(id)) return;
		Stream stream = new Stream(id);
		streams.put(id, stream);
		try {
			threads.execute(stream::open);
		} catch (java.util.concurrent.RejectedExecutionException e) {
			streams.remove(id);
		}
	}

	/** Ein Datenstrom: Daten-WebSocket ↔ TCP-Socket zum LAN-Port des eingebauten Servers */
	private final class Stream implements WebSocket.Listener {
		private final String id;
		private final Socket tcp = new Socket();
		private final AtomicBoolean done = new AtomicBoolean();
		private volatile WebSocket ws;
		private volatile OutputStream toGame;

		Stream(String id) {
			this.id = id;
		}

		void open() {
			try {
				tcp.setTcpNoDelay(true);
				tcp.connect(new InetSocketAddress("127.0.0.1", lanPort), 5000);
				toGame = tcp.getOutputStream();
				String token = Social.serviceToken();
				if (token == null) throw new IOException("nicht angemeldet");
				String url = Social.baseUrl().replaceFirst("^http", "ws") + "/v1/worlds/streams/" + id;
				ws = http.newWebSocketBuilder()
						.header("Authorization", "Bearer " + token)
						.connectTimeout(Duration.ofSeconds(10))
						.buildAsync(URI.create(url), this)
						.get(15, TimeUnit.SECONDS);
				if (done.get() || closed) {
					close();
					return;
				}
				pumpToService();
			} catch (Exception e) {
				if (!done.get()) HeldixClient.LOGGER.debug("Welt teilen: Datenstrom nicht geöffnet ({})", e.getClass().getSimpleName());
				close();
			}
		}

		/** Spiel → Dienst: lesen, senden, auf das Senden warten (Gegendruck) */
		private void pumpToService() {
			byte[] buffer = new byte[BUFFER];
			try {
				InputStream in = tcp.getInputStream();
				int read;
				while (!done.get() && (read = in.read(buffer)) >= 0) {
					if (read == 0) continue;
					WebSocket current = ws;
					if (current == null) break;
					// erst weiterlesen, wenn der Rahmen raus ist (danach gehört der Puffer wieder uns)
					current.sendBinary(ByteBuffer.wrap(buffer, 0, read), true).get(30, TimeUnit.SECONDS);
				}
				// Spiel hat die Verbindung beendet: sauber schließen
				WebSocket current = ws;
				if (current != null && !done.get()) current.sendClose(WebSocket.NORMAL_CLOSURE, "").get(5, TimeUnit.SECONDS);
			} catch (Exception e) {
				// Spieler weg oder Dienst getrennt
			} finally {
				close();
			}
		}

		@Override
		public void onOpen(WebSocket webSocket) {
			webSocket.request(1);
		}

		/** Dienst → Spiel: schreiben, erst danach den nächsten Rahmen anfordern (Gegendruck) */
		@Override
		public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
			OutputStream out = toGame;
			try {
				if (out == null) throw new IOException("kein Socket");
				byte[] chunk = new byte[data.remaining()];
				data.get(chunk);
				out.write(chunk);
				out.flush();
				webSocket.request(1);
			} catch (IOException e) {
				close();
			}
			return null;
		}

		@Override
		public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
			// Datenströme sind binär; Text wird ignoriert
			webSocket.request(1);
			return null;
		}

		@Override
		public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
			close();
			return null;
		}

		@Override
		public void onError(WebSocket webSocket, Throwable error) {
			close();
		}

		void close() {
			if (!done.compareAndSet(false, true)) return;
			streams.remove(id);
			try {
				tcp.close();
			} catch (IOException e) {
				// schon zu
			}
			WebSocket current = ws;
			if (current != null) current.abort();
		}
	}

	private static String string(JsonObject object, String key) {
		if (object == null || !object.has(key) || !object.get(key).isJsonPrimitive()) return null;
		return object.get(key).getAsString();
	}
}
