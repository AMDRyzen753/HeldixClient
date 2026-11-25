package dev.heldixclient.bridge;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.swing.JOptionPane;
import javax.swing.UIManager;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintStream;
import java.io.Writer;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Brücke vom offiziellen Minecraft Launcher zum HeldixClient-Launcher.
 *
 * <p>Der offizielle Launcher startet diese Klasse wie Minecraft (Installation „HeldixClient“) und übergibt dabei die
 * Anmeldung des Spielers ({@code --username}, {@code --uuid}, {@code --accessToken} …). Die Brücke reicht sie über eine
 * lokale Verbindung an den HeldixClient-Launcher weiter, der damit Minecraft selbst startet. Läuft er nicht, startet
 * ihn die Brücke.
 *
 * <p>Die Verbindung (nur 127.0.0.1) ist mit dem Geheimnis aus {@code bridge.json} im Datenordner des Benutzers
 * geschützt: Beide Seiten beweisen per HMAC-SHA256 über Zufallszahlen, dass sie es kennen. Das Token geht erst danach
 * über die Leitung, also nie an ein fremdes Programm, das zufällig auf dem Port lauscht.
 */
public final class Bridge {
	private static final int PROTOCOL = 1;
	private static final long START_TIMEOUT_MS = 90_000;
	private static final SecureRandom RANDOM = new SecureRandom();

	private Bridge() {
	}

	public static void main(String[] args) {
		try {
			// Ausgabe als UTF-8 (landet im Log des Minecraft Launchers), unabhängig von der Codepage des Systems
			System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8"));
			System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, "UTF-8"));
			run(parseArgs(args));
			System.exit(0);
		} catch (BridgeException e) {
			fail(e.getMessage());
		} catch (Throwable t) {
			t.printStackTrace();
			fail("Die Übergabe an HeldixClient ist fehlgeschlagen: " + t);
		}
	}

	private static void run(Map<String, String> options) throws Exception {
		String token = options.get("accessToken");
		if (token == null || token.isEmpty() || token.equals("0") || options.get("username") == null) {
			throw new BridgeException("Der Minecraft Launcher hat keine Anmeldung übergeben. Melde dich dort mit deinem "
					+ "Microsoft-Konto an und drücke noch mal auf „Spielen“.");
		}
		Path file = bridgeFile();
		BridgeInfo info = BridgeInfo.read(file);
		if (info == null) {
			throw new BridgeException("HeldixClient ist auf diesem PC nicht eingerichtet (" + file + " fehlt). "
					+ "Installiere HeldixClient und starte es einmal.");
		}
		System.out.println("[HeldixClient] Gebe die Anmeldung von " + options.get("username") + " an HeldixClient weiter …");

		// 1. Versuch: HeldixClient läuft schon
		Socket socket = connect(info.port);
		if (socket != null) {
			try {
				talk(socket, info.secret, options);
				return;
			} catch (HandshakeException e) {
				// alter Port, auf dem jetzt etwas anderes lauscht: HeldixClient neu starten
				System.out.println("[HeldixClient] " + e.getMessage());
			}
		}

		// 2. HeldixClient starten und warten, bis es bereit ist
		startLauncher(info, file);
		long deadline = System.currentTimeMillis() + START_TIMEOUT_MS;
		while (System.currentTimeMillis() < deadline) {
			Thread.sleep(400);
			BridgeInfo fresh = BridgeInfo.read(file);
			if (fresh == null || fresh.port <= 0) continue;
			socket = connect(fresh.port);
			if (socket == null) continue;
			try {
				talk(socket, fresh.secret, options);
				return;
			} catch (HandshakeException e) {
				// Datei noch vom alten Start: weiter warten
			}
		}
		throw new BridgeException("HeldixClient hat sich nicht gemeldet. Starte HeldixClient selbst und drücke im "
				+ "Minecraft Launcher noch mal auf „Spielen“.");
	}

	/** Gespräch mit dem Launcher: gegenseitiger Nachweis, dann die Anmeldung, dann warten, bis das Spiel endet. */
	private static void talk(Socket socket, String secret, Map<String, String> options) throws Exception {
		try (Socket s = socket) {
			s.setSoTimeout(15_000);
			BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
			Writer out = new OutputStreamWriter(s.getOutputStream(), StandardCharsets.UTF_8);

			String nonce = randomHex(32);
			Map<String, Object> hello = new LinkedHashMap<>();
			hello.put("type", "hello");
			hello.put("version", PROTOCOL);
			hello.put("nonce", nonce);
			Map<String, Object> challenge;
			try {
				send(out, hello);
				challenge = read(in);
			} catch (IOException | IllegalArgumentException e) {
				throw new HandshakeException("Keine Antwort von HeldixClient (" + e.getMessage() + ")");
			}
			if (challenge == null || !"challenge".equals(challenge.get("type"))
					|| !sameHex(hmac(secret, "server|" + nonce), String.valueOf(challenge.get("proof")))) {
				throw new HandshakeException("Die Gegenstelle ist nicht HeldixClient");
			}

			Map<String, Object> session = new LinkedHashMap<>();
			session.put("type", "session");
			session.put("proof", hmac(secret, "client|" + challenge.get("nonce")));
			session.put("name", options.get("username"));
			session.put("uuid", options.get("uuid"));
			session.put("accessToken", options.get("accessToken"));
			session.put("xuid", options.get("xuid"));
			session.put("userType", options.get("userType"));
			send(out, session);

			// HeldixClient prüft die Anmeldung bei Mojang, das kann einen Moment dauern
			s.setSoTimeout(120_000);
			Map<String, Object> reply = read(in);
			if (reply == null) throw new BridgeException("HeldixClient hat die Verbindung ohne Antwort beendet.");
			if ("error".equals(reply.get("type"))) throw new BridgeException(String.valueOf(reply.get("message")));
			if (!"ok".equals(reply.get("type"))) throw new BridgeException("Unerwartete Antwort von HeldixClient.");
			System.out.println("[HeldixClient] Angemeldet als " + reply.get("name") + ". HeldixClient übernimmt.");

			// Solange das Spiel läuft, bleibt die Brücke offen: Der Minecraft Launcher zeigt es als laufend an
			if (Boolean.TRUE.equals(reply.get("hold"))) {
				s.setSoTimeout(0);
				try {
					while (in.readLine() != null) {
						// nichts zu tun, HeldixClient schließt die Verbindung, wenn das Spiel endet
					}
				} catch (IOException ignored) {
					// HeldixClient beendet
				}
			}
		}
	}

	private static Socket connect(int port) {
		if (port <= 0 || port > 65535) return null;
		Socket socket = new Socket();
		try {
			socket.connect(new InetSocketAddress("127.0.0.1", port), 2_000);
			return socket;
		} catch (IOException e) {
			try {
				socket.close();
			} catch (IOException ignored) {
				// egal
			}
			return null;
		}
	}

	/**
	 * Startet den HeldixClient-Launcher. Unter Windows über den Explorer, damit er nicht zum Prozessbaum des
	 * Minecraft Launchers gehört (sonst würde er beim Schließen des Minecraft Launchers mit beendet).
	 */
	private static void startLauncher(BridgeInfo info, Path file) throws IOException {
		if (info.command.isEmpty()) {
			throw new BridgeException("HeldixClient läuft nicht. Starte HeldixClient und drücke im Minecraft Launcher noch mal auf „Spielen“.");
		}
		System.out.println("[HeldixClient] Starte HeldixClient …");
		boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
		List<String> command = new ArrayList<>(info.command);
		if (windows && command.size() == 1) command.add(0, "explorer.exe");
		ProcessBuilder builder = new ProcessBuilder(command);
		File log = file.resolveSibling("bridge-start.log").toFile();
		builder.redirectErrorStream(true);
		builder.redirectOutput(ProcessBuilder.Redirect.appendTo(log));
		builder.start();
	}

	private static void send(Writer out, Map<String, Object> message) throws IOException {
		out.write(Json.write(message));
		out.write('\n');
		out.flush();
	}

	private static Map<String, Object> read(BufferedReader in) throws IOException {
		String line = in.readLine();
		return line == null ? null : Json.parseObject(line);
	}

	/** Wo HeldixClient die bridge.json ablegt: aus der Installation, sonst der Standard-Datenordner */
	static Path bridgeFile() {
		String configured = System.getProperty("heldix.bridge.file");
		if (configured != null && !configured.isEmpty()) return Paths.get(configured);
		String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
		String home = System.getProperty("user.home");
		if (os.contains("win")) {
			String appData = System.getenv("APPDATA");
			Path base = appData != null ? Paths.get(appData) : Paths.get(home, "AppData", "Roaming");
			return base.resolve(".heldixclient").resolve("bridge.json");
		}
		if (os.contains("mac")) return Paths.get(home, "Library", "Application Support", "heldixclient", "bridge.json");
		return Paths.get(home, ".heldixclient", "bridge.json");
	}

	/** --name wert … wie von Minecraft gewohnt; Schalter ohne Wert bekommen "" */
	static Map<String, String> parseArgs(String[] args) {
		Map<String, String> options = new HashMap<>();
		for (int i = 0; i < args.length; i++) {
			if (!args[i].startsWith("--")) continue;
			String key = args[i].substring(2);
			if (i + 1 < args.length && !args[i + 1].startsWith("--")) options.put(key, args[++i]);
			else options.put(key, "");
		}
		return options;
	}

	static String hmac(String secret, String message) throws Exception {
		Mac mac = Mac.getInstance("HmacSHA256");
		mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
		return hex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
	}

	private static boolean sameHex(String expected, String actual) {
		return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
	}

	private static String randomHex(int bytes) {
		byte[] data = new byte[bytes];
		RANDOM.nextBytes(data);
		return hex(data);
	}

	private static String hex(byte[] data) {
		StringBuilder out = new StringBuilder(data.length * 2);
		for (byte b : data) out.append(String.format("%02x", b & 0xff));
		return out.toString();
	}

	private static void fail(String message) {
		System.err.println("[HeldixClient] " + message);
		try {
			UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
			String html = "<html><body style='width: 340px'>" + message.replace("&", "&amp;").replace("<", "&lt;") + "</body></html>";
			JOptionPane.showMessageDialog(null, html, "HeldixClient", JOptionPane.ERROR_MESSAGE);
			System.exit(0);
		} catch (Throwable t) {
			// ohne Bildschirm: der Minecraft Launcher zeigt die Meldung im Absturzbericht
			System.exit(1);
		}
	}

	/** Inhalt von bridge.json, geschrieben vom HeldixClient-Launcher */
	static final class BridgeInfo {
		final int port;
		final String secret;
		final List<String> command;

		private BridgeInfo(int port, String secret, List<String> command) {
			this.port = port;
			this.secret = secret;
			this.command = command;
		}

		static BridgeInfo read(Path file) {
			try {
				Map<String, Object> data = Json.parseObject(new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
				Object port = data.get("port");
				Object secret = data.get("secret");
				List<String> command = new ArrayList<>();
				if (data.get("command") instanceof List) {
					for (Object part : (List<?>) data.get("command")) command.add(String.valueOf(part));
				}
				if (!(secret instanceof String)) return null;
				return new BridgeInfo(port instanceof Number ? ((Number) port).intValue() : 0, (String) secret, command);
			} catch (IOException | IllegalArgumentException e) {
				return null;
			}
		}
	}

	/** Fehler mit verständlicher Meldung für den Spieler */
	static class BridgeException extends RuntimeException {
		BridgeException(String message) {
			super(message);
		}
	}

	/** Gegenstelle antwortet nicht wie HeldixClient (z. B. alter Port) */
	static final class HandshakeException extends BridgeException {
		HandshakeException(String message) {
			super(message);
		}
	}
}
