package dev.heldixclient.api;

import java.util.Set;
import java.util.UUID;

/**
 * Sprachkanal über den Heldix-Dienst für Voice-Chat-Addons: HeldixClient hält die Verbindung, meldet Server, Welt und
 * Position und verteilt die Rahmen deines Addons an HeldixClient-Spieler in der Nähe (gleicher Server, gleiche Welt,
 * innerhalb von {@link #range()} Blöcken; Blockierungen und „Nur Freunde“ gelten) – ab API 7 außerdem an die Mitglieder deiner
 * Gruppe ({@link #setGroup}) auf demselben Server, egal wo sie sind. Aufnehmen, Kodieren (z. B. Opus),
 * Mischen und Abspielen macht das Addon selbst. Der Dienst speichert nichts.
 * Wird von HeldixClient bereitgestellt, nicht selbst implementieren.
 *
 * @since 6
 */
public interface VoiceChannel {
	enum Status {
		/** kein Addon hat den Kanal eingeschaltet */
		OFF,
		/** eingeschaltet, aber gerade nicht möglich (siehe {@link #statusText()}), z. B. im Einzelspieler */
		UNAVAILABLE,
		CONNECTING,
		CONNECTED
	}

	Status status();

	/** Erklärung für die Anzeige, z. B. „Nur auf Servern“ oder „Verbunden – 3 Spieler hier“ */
	String statusText();

	/** Kanal verbinden (nur, solange du ihn brauchst, z. B. solange dein Modul an ist) bzw. trennen */
	void setActive(boolean active);

	boolean isActive();

	/** nur mit Freunden sprechen und hören (gilt in beide Richtungen) */
	void setFriendsOnly(boolean friendsOnly);

	/** Reichweite in Blöcken (vom Heldix-Dienst, meist 48) */
	int range();

	/** größte Nutzlast eines Rahmens in Bytes */
	int maxFrameSize();

	/**
	 * Einen Rahmen senden (aus jedem Thread). Kommt die Verbindung nicht hinterher, werden Rahmen verworfen statt
	 * zu warten.
	 *
	 * @param sequence fortlaufende Nummer (0–65535, danach wieder 0), damit Empfänger Lücken erkennen
	 * @param last     letzter Rahmen eines Satzes (Taste losgelassen, Stille)
	 * @return false, wenn nicht verbunden, zu groß oder verworfen
	 */
	boolean send(byte[] frame, int sequence, boolean last);

	/**
	 * Empfangene Rahmen anderer Spieler. Achtung: läuft im Netzwerk-Thread, nicht im Haupt-Thread – schnell
	 * zurückkehren und keine Minecraft-Objekte anfassen.
	 */
	Registration onFrame(FrameListener listener);

	/** andere Spieler mit eingeschaltetem Voice Chat im selben Raum (Server und Welt), unabhängig vom Abstand */
	Set<UUID> peers();

	// --- ab API 7: Status und Gruppen ------------------------------------------------------------

	/**
	 * Eigenen Status an die anderen melden (z. B. für Symbole über deinem Kopf bei ihnen). HeldixClient schickt ihn nach
	 * jedem Verbinden und Raumwechsel erneut. Mit {@code deafened} bekommst du außerdem keine Rahmen mehr.
	 *
	 * @since 7
	 */
	void setState(boolean muted, boolean deafened);

	/**
	 * Hat dieser Spieler (im Raum oder in deiner Gruppe) sein Mikrofon stumm geschaltet?
	 *
	 * @since 7
	 */
	boolean peerMuted(UUID player);

	/**
	 * Hat dieser Spieler den Ton aus (hört niemanden)?
	 *
	 * @since 7
	 */
	boolean peerDeafened(UUID player);

	/**
	 * Gruppe betreten oder verlassen: Alle mit demselben Namen und Passwort auf diesem Server hören sich überall (auch in
	 * anderen Dimensionen, ohne Abstand); Spieler in der Nähe hören dich weiter wie gewohnt. An den Heldix-Dienst geht nur
	 * ein Prüfwert aus Name und Passwort. Groß- und Kleinschreibung zählt beim Namen nicht, beim Passwort schon.
	 *
	 * @param name     leer oder null = keine Gruppe
	 * @param password darf leer sein
	 * @since 7
	 */
	void setGroup(String name, String password);

	/**
	 * Name der eingestellten Gruppe, sonst null.
	 *
	 * @since 7
	 */
	String group();

	/**
	 * Die anderen Mitglieder deiner Gruppe (laut Heldix-Dienst), auch wenn sie weit weg sind.
	 *
	 * @since 7
	 */
	Set<UUID> groupMembers();

	/**
	 * Unterstützt der verbundene Heldix-Dienst Gruppen? (false, solange nicht verbunden)
	 *
	 * @since 7
	 */
	boolean groupsAvailable();

	/**
	 * Warum die Gruppe gerade nicht klappt (z. B. „Gruppe ist voll“), sonst null.
	 *
	 * @since 7
	 */
	String groupProblem();

	@FunctionalInterface
	interface FrameListener {
		void onFrame(UUID sender, int sequence, boolean last, byte[] frame);
	}
}
