package dev.heldixclient.server.api;

/**
 * Antwort des Heldix-Dienstes auf eine Belohnung.
 *
 * @param granted true = freigeschaltet (auch wenn der Spieler es schon hatte)
 * @param already true = hatte das Cosmetic schon
 * @param error   deutscher Satz vom Dienst bzw. vom Plugin, wenn es nicht geklappt hat (sonst null)
 * @param code    Fehlercode des Dienstes (z. B. für Grenzen), sonst null
 */
public record RewardResult(boolean granted, boolean already, String error, String code) {
	public static RewardResult failed(String error, String code) {
		return new RewardResult(false, false, error, code);
	}
}
