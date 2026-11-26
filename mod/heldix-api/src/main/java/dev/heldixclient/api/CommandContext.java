package dev.heldixclient.api;

import java.util.List;

/**
 * Ein getippter Chat-Befehl, z. B. „.spotify next“. Wird vom HeldixClient bereitgestellt.
 *
 * @since 3
 */
public interface CommandContext {
	/** Name, unter dem der Befehl aufgerufen wurde (ohne Punkt, klein geschrieben), z. B. "spotify" */
	String name();

	/** Wörter nach dem Namen, z. B. bei „.spotify next“ → ["next"] (leer, wenn nichts folgt) */
	List<String> args();

	/** Wort an dieser Stelle, klein geschrieben, oder "" (praktisch für Unterbefehle) */
	String arg(int index);

	/** alles nach dem Namen als ein Text, so wie getippt (z. B. für Nachrichten mit Leerzeichen) */
	String argsText();

	/** Antwort nur im eigenen Chat (wie {@link HeldixApi#chat(String)}) */
	void reply(String message);
}
