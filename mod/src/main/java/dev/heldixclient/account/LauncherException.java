package dev.heldixclient.account;

/**
 * Absage des Launchers (oder der Verbindung) mit Code aus dem Protokoll (docs/konto-wechsel.md) und einem Text für
 * den Spieler. Enthält nie Tokens: Der Launcher schwärzt seine Fehlertexte, die Verbindung schreibt nur eigene Texte.
 */
public final class LauncherException extends Exception {
	private static final long serialVersionUID = 1L;

	/** Codes des Launchers: bad_request, unknown_op, not_found, rate_limited, busy, cancelled, session_failed, sign_in_failed, unavailable, internal */
	private final String code;

	public LauncherException(String code, String message) {
		super(message, null, false, false);
		this.code = code == null ? "internal" : code;
	}

	public String code() {
		return code;
	}

	/** Anmeldung im Microsoft-Fenster abgebrochen */
	public boolean cancelled() {
		return "cancelled".equals(code);
	}

	static LauncherException unavailable() {
		return new LauncherException("unavailable", "Kein Launcher verbunden – starte das Spiel über den HeldixClient-Launcher.");
	}

	static LauncherException timeout() {
		return new LauncherException("timeout", "Der Launcher antwortet nicht.");
	}

	/** Text für den Spieler aus einem beliebigen Fehler (CompletionException auspacken) */
	public static String describe(Throwable error) {
		LauncherException launcher = of(error);
		if (launcher == null) {
			Throwable cause = unwrap(error);
			return "Unerwarteter Fehler (" + cause.getClass().getSimpleName() + ")";
		}
		String message = launcher.getMessage() == null ? "" : launcher.getMessage();
		return switch (launcher.code) {
			case "not_allowed" -> message.contains("Wechsle zuerst") ? message : "Kontowechsel ist im Launcher ausgeschaltet (Einstellungen → Spiel).";
			case "cancelled" -> message.isBlank() ? "Abgebrochen." : message;
			case "busy" -> "Im Launcher wartet schon eine Anmeldung oder Bestätigung – schau ins Launcher-Fenster.";
			case "rate_limited" -> "Zu viele Kontowechsel in kurzer Zeit – versuch es gleich noch einmal.";
			case "session_failed" -> "Sitzung nicht verfügbar: " + message;
			case "sign_in_failed" -> "Anmeldung fehlgeschlagen: " + message;
			case "not_found" -> "Dieses Konto gibt es im Launcher nicht mehr.";
			case "bad_request", "unknown_op", "internal" -> "Der Launcher konnte die Anfrage nicht bearbeiten (" + launcher.code + ").";
			default -> message;
		};
	}

	/** Die LauncherException hinter einem Fehler (sonst null) */
	public static LauncherException of(Throwable error) {
		return unwrap(error) instanceof LauncherException launcher ? launcher : null;
	}

	private static Throwable unwrap(Throwable error) {
		Throwable cause = error;
		while ((cause instanceof java.util.concurrent.CompletionException || cause instanceof java.util.concurrent.ExecutionException) && cause.getCause() != null) {
			cause = cause.getCause();
		}
		return cause;
	}
}
