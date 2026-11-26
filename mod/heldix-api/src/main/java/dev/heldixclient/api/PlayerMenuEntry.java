package dev.heldixclient.api;

/**
 * Eintrag im Spielermenü: Zielt der Spieler mit dem Fadenkreuz auf einen anderen Spieler und klickt mit dem Mausrad
 * (genauer: der Taste „Block auswählen“), öffnet sich ein Kreismenü mit Aktionen für ihn – Freund hinzufügen, Name
 * kopieren und die Einträge der Addons. Anmelden mit {@link HeldixApi#addPlayerMenuEntry}.
 *
 * @since 6
 */
public interface PlayerMenuEntry {
	/** Name im Menü für diesen Spieler (z. B. „Stummschalten“ oder „Stumm aufheben“); null = Eintrag fehlt hier */
	String label(NearbyPlayer player);

	/** Icon aus dem Heldix-Icon-Set */
	default String icon(NearbyPlayer player) {
		return "addons";
	}

	/** Gewählt: läuft im Haupt-Thread als Aktion des Spielers */
	void select(NearbyPlayer player);

	/** Menü nach der Auswahl offen lassen (z. B. für „Lauter“), Standard: schließen */
	default boolean keepOpen() {
		return false;
	}
}
