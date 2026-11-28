package dev.heldixclient.social;

import dev.heldixclient.hud.Notifications;
import dev.heldixclient.voice.VoiceLink;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.toasts.SystemToast;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;

import java.util.Locale;
import java.util.function.Consumer;

/**
 * „Freunde einladen“ im Spiel (ab Heldix-Dienst 1.11.0): Einladungslink (mit dem aktuellen Server, wenn du auf einem
 * spielst) und Browser-Link für die Voice-Gruppe in die Zwischenablage legen, mit kurzem Hinweis als Toast. Bedient von der
 * Seite Freunde im Heldix-Menü und der Freunde-Karte im Pausemenü; die Links selbst erzeugt der Dienst
 * ({@link Social#createInvite}).
 */
public final class Invites {
	/** Toast der Einladungen: ein neuer ersetzt den vorigen, 8 Sekunden sichtbar */
	private static final SystemToast.SystemToastId TOAST = new SystemToast.SystemToastId(8000L);

	/** Ergebnis für die Anzeige (im Haupt-Thread): ok = Link liegt in der Zwischenablage, message = Text für den Spieler */
	public record Result(boolean ok, String message, String url) {
	}

	private static volatile boolean busy;

	private Invites() {
	}

	/** Server für „Komm auf meinen Server“: Adresse im Mehrspieler (nicht Realms, LAN, Einzelspieler), sonst null */
	public static String currentServer(Minecraft mc) {
		if (mc.level == null || mc.isLocalServer()) return null;
		ServerData server = mc.getCurrentServer();
		if (server == null || server.isRealm() || server.isLan() || server.ip == null || server.ip.isBlank()) return null;
		return server.ip.trim().toLowerCase(Locale.ROOT);
	}

	/** Gibt es gerade einen Browser-Link für die Voice-Gruppe? (Voice Chat verbunden, Gruppe, Dienst kann Gäste) */
	public static boolean browserLinkAvailable() {
		return VoiceLink.browserLinkProblem() == null;
	}

	/** Läuft gerade eine Anfrage? (dann nicht noch eine) */
	public static boolean busy() {
		return busy;
	}

	/**
	 * Einladungslink erzeugen (bzw. den offenen wiederverwenden) und in die Zwischenablage legen. Im Mehrspieler mit dem
	 * aktuellen Server, sonst ohne. {@code done} läuft im Haupt-Thread.
	 */
	public static void copyInvite(Minecraft mc, Consumer<Result> done) {
		if (busy) return;
		String server = currentServer(mc);
		busy = true;
		Social.createInvite(server, null).whenComplete((invite, error) -> mc.execute(() -> {
			busy = false;
			if (error != null) {
				finish(done, failed("Einladung nicht erstellt", error));
				return;
			}
			mc.keyboardHandler.setClipboard(invite.url());
			String message = invite.server() != null
					? "Mit dem Link holen sich Freunde HeldixClient, ihr seid befreundet und sie kommen auf " + invite.server() + "."
					: "Mit dem Link holen sich Freunde HeldixClient – danach seid ihr befreundet.";
			toast(mc, "Einladungslink kopiert", message);
			finish(done, new Result(true, "Einladungslink kopiert. " + message, invite.url()));
		}));
	}

	/**
	 * Browser-Link für die aktuelle Voice-Gruppe (24 Stunden) erzeugen und in die Zwischenablage legen: Wer ihn öffnet, redet
	 * im Browser mit – auch ohne HeldixClient. {@code done} läuft im Haupt-Thread.
	 */
	public static void copyBrowserLink(Minecraft mc, Consumer<Result> done) {
		if (busy) return;
		busy = true;
		String group = VoiceLink.groupName();
		VoiceLink.createBrowserLink().whenComplete((invite, error) -> mc.execute(() -> {
			busy = false;
			if (error != null) {
				finish(done, failed("Browser-Link nicht erstellt", error));
				return;
			}
			mc.keyboardHandler.setClipboard(invite.url());
			String message = "Wer ihn öffnet, redet im Browser in „" + (group == null ? "deiner Gruppe" : group) + "“ mit – 24 Std. gültig, höchstens 4 Gäste.";
			toast(mc, "Browser-Link kopiert", message);
			finish(done, new Result(true, "Browser-Link kopiert. " + message, invite.url()));
		}));
	}

	private static Result failed(String title, Throwable error) {
		String message = message(error);
		toast(Minecraft.getInstance(), title, message);
		return new Result(false, message, null);
	}

	/** Text einer fehlgeschlagenen Anfrage an den Dienst (deutsch) */
	public static String message(Throwable error) {
		Throwable cause = error instanceof java.util.concurrent.CompletionException && error.getCause() != null ? error.getCause() : error;
		return cause instanceof Social.ServiceException && cause.getMessage() != null ? cause.getMessage() : "Dienst nicht erreichbar";
	}

	private static void finish(Consumer<Result> done, Result result) {
		if (done != null) done.accept(result);
	}

	/** Toast oben rechts (auch über Menüs); im Haupt-Thread */
	public static void toast(Minecraft mc, String title, String message) {
		SystemToast.addOrUpdate(mc.gui.toastManager(), TOAST, Component.literal(title), Component.literal(message));
	}

	/**
	 * Hinweis zu Einladungen und Belohnungen aus der Echtzeit-Verbindung (jeder Thread): in einer Welt als Heldix-Einblendung,
	 * in Menüs ohne Welt als Toast (dort gibt es keine Einblendungen).
	 */
	static void notify(String source, String title, String message) {
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> {
			if (mc.level != null) Notifications.show(source, title, message, null);
			else toast(mc, title, message);
		});
	}
}
