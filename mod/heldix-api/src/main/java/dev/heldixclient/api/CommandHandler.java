package dev.heldixclient.api;

/**
 * Führt einen Chat-Befehl aus ({@link HeldixApi#registerCommand}). Läuft im Haupt-Thread, wenn der Spieler
 * „.name …“ in den Chat tippt. Gilt als Aktion des Spielers: {@link HeldixApi#sendChatMessage(String)} ist hier erlaubt.
 *
 * @since 3
 */
@FunctionalInterface
public interface CommandHandler {
	void run(CommandContext command);
}
