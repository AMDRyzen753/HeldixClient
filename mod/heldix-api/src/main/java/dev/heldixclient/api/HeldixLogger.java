package dev.heldixclient.api;

/** Schreibt ins Spiel-Log (und damit auch in die Konsole des Launchers). */
public interface HeldixLogger {
	void info(String message);

	void warn(String message);

	void error(String message, Throwable error);
}
