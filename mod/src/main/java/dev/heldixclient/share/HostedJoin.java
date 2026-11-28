package dev.heldixclient.share;

import dev.heldixclient.HeldixClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.DisconnectedScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

/**
 * Beitreten zu Heldix-Welten mit Rücksicht auf dauerhafte Welten (ab Heldix-Dienst 1.13.0): Schläft die Welt, weckt der
 * erste Login sie und das Relay trennt mit „Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.“ Statt
 * der Trennung zeigt HeldixClient dann {@link dev.heldixclient.screen.HostedWaitScreen} und versucht es nach 30 s
 * (danach alle 20 s, höchstens {@value #MAX_ATTEMPTS}-mal) von selbst noch einmal – sichtbar und mit „Abbrechen“.
 *
 * <p>Die Adresse kommt aus dem Eingriff in {@code ConnectScreen.startConnecting} (WorldSharePatches), gilt also auch für
 * Quick Play aus dem Launcher und die Serverliste. Alles im Haupt-Thread.
 */
public final class HostedJoin {
	public static final int MAX_ATTEMPTS = 8;
	/** so lange nach dem Verbindungsaufbau zählt eine Trennung noch zu diesem Versuch */
	private static final long ATTEMPT_MS = 120_000;

	private record Attempt(String name, String address, long at) {
	}

	private static Attempt last;
	private static String retryAddress;
	private static int attempts;
	private static boolean retrying;

	private HostedJoin() {
	}

	/** ConnectScreen.startConnecting: Name und Adresse merken (nur Heldix-Welten) */
	public static void connecting(ServerData data) {
		if (data == null || !WorldShare.isWorldAddress(data.ip)) {
			last = null;
			return;
		}
		String address = WorldShare.normalizeAddress(data.ip);
		// neuer Beitritt von Hand: von vorn zählen; ein erneuter Versuch aus dem Warte-Bildschirm zählt weiter
		if (!retrying) attempts = 0;
		retrying = false;
		last = new Attempt(data.name, address, System.currentTimeMillis());
	}

	/**
	 * Gui.setScreen (über Shell.replace): Trennung „Die Welt startet gerade …“ nach dem Beitritt zu einer Heldix-Welt →
	 * Warte-Bildschirm mit erneutem Versuch. Alles andere bleibt, wie es ist.
	 */
	public static Screen replace(Screen screen) {
		if (!(screen instanceof DisconnectedScreen)) return screen;
		Attempt attempt = last;
		if (attempt == null || System.currentTimeMillis() - attempt.at() > ATTEMPT_MS) return screen;
		String text = screen.getNarrationMessage().getString();
		if (!text.contains(HostingService.TEXT_STARTING)) return screen;
		last = null;
		int number = attempt.address().equals(retryAddress) ? attempts + 1 : 1;
		retryAddress = attempt.address();
		attempts = number;
		if (number > MAX_ATTEMPTS) {
			attempts = 0;
			return screen;
		}
		HeldixClient.LOGGER.info("Heldix-Welt startet gerade – neuer Versuch gleich (Versuch {})", number);
		return new dev.heldixclient.screen.HostedWaitScreen(attempt.name(), attempt.address(), number);
	}

	/** Sekunden bis zum nächsten Versuch: erst 30 (wie das Relay sagt), danach 20 */
	public static int delaySeconds(int attempt) {
		return attempt <= 1 ? 30 : 20;
	}

	/**
	 * Einer Heldix-Welt beitreten (Heldix-Welten, Entdecken, Pausemenü): ist gerade eine Welt offen, wird sie vorher
	 * verlassen (Einzelspieler: gespeichert und geschlossen).
	 */
	public static void join(Minecraft mc, Screen parent, String name, String address) {
		retrying = false;
		connect(mc, parent, name, address);
	}

	/** neuer Versuch aus dem Warte-Bildschirm (zählt weiter) */
	public static void retry(Minecraft mc, String name, String address) {
		retrying = true;
		connect(mc, new dev.heldixclient.screen.HeldixWorldsScreen(), name, address);
	}

	/** Abbrechen im Warte-Bildschirm */
	public static void cancel() {
		attempts = 0;
		retryAddress = null;
		last = null;
	}

	private static void connect(Minecraft mc, Screen parent, String name, String address) {
		Screen back = parent;
		if (mc.level != null) {
			mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE);
			back = new TitleScreen();
		}
		String clean = WorldShare.normalizeAddress(address);
		ConnectScreen.startConnecting(back, mc, ServerAddress.parseString(clean), new ServerData(name, clean, ServerData.Type.OTHER), false, null);
	}

	/** Für den Autotest: Versuch, wie er beim nächsten Trennen gezählt würde */
	public static int attempts() {
		return attempts;
	}
}
