package dev.heldixclient.api;

import java.util.Set;
import java.util.UUID;

/**
 * Sprachkanal über den Heldix-Dienst für Voice-Chat-Addons: HeldixClient hält die Verbindung, meldet Server, Welt und
 * Position und verteilt die Rahmen deines Addons an HeldixClient-Spieler in der Nähe (gleicher Server, gleiche Welt,
 * innerhalb von {@link #range()} Blöcken; Blockierungen und „Nur Freunde“ gelten) – ab API 7 außerdem an die Mitglieder deiner
 * Gruppe ({@link #setGroup}) auf demselben Server, egal wo sie sind; ab API 9 sind auch Gäste und Spieler im Browser in der
 * Gruppe ({@link #isGuest}, {@link #inBrowser}, {@link #createBrowserLink}). Aufnehmen, Kodieren (z. B. Opus),
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

	// --- ab API 9: Gäste und Browser-Teilnehmer -------------------------------------------------

	/**
	 * Ist dieser Teilnehmer ein Gast – jemand ohne HeldixClient, der über einen Browser-Link deiner Gruppe auf der Webseite
	 * mitredet? Gäste haben statt einer Minecraft-UUID eine zufällige ID, keine Position und gehören immer zu deiner Gruppe
	 * ({@link #groupMembers()}, wie Mitglieder in einer anderen Dimension). Ihren Namen liefert {@link HeldixApi#playerName}.
	 *
	 * @since 9
	 */
	boolean isGuest(UUID participant);

	/**
	 * Spricht dieser Teilnehmer über die Webseite – als Gast oder als angemeldeter Spieler im Browser? Auch angemeldete
	 * Spieler im Browser haben keine Position und sind nur über die Gruppe zu hören.
	 *
	 * @since 9
	 */
	boolean inBrowser(UUID participant);

	/**
	 * Kann der verbundene Heldix-Dienst Gäste und Browser-Links (ab Dienst 1.11.0)? false, solange nicht verbunden.
	 *
	 * @since 9
	 */
	boolean guestsAvailable();

	/**
	 * Einen Gast aus deiner Gruppe entfernen: Der Heldix-Dienst trennt ihn sofort, sein Zugang gilt danach nicht mehr (mit
	 * dem Link kann er neu beitreten, solange der Link gilt). Nur für Gäste deiner Gruppe; sonst passiert nichts. Nur auf
	 * Wunsch des Spielers aufrufen.
	 *
	 * @since 9
	 */
	void removeGuest(UUID guest);

	/**
	 * Web-Link für deine Gruppe auf dem aktuellen Server erzeugen: Wer ihn öffnet, redet im Browser mit (als Gast mit Namen
	 * oder angemeldet mit Minecraft-Konto), 24 Stunden lang, höchstens 4 Gäste gleichzeitig. Für dieselbe Gruppe kommt
	 * derselbe Link zurück, solange er gilt. Nur auf Wunsch des Spielers aufrufen (z. B. Knopf „Browser-Link kopieren“).
	 *
	 * <p>Genau einer der beiden Callbacks läuft, im Haupt-Thread: {@code onLink} mit dem Link (z. B. für
	 * {@link HeldixApi#copyToClipboard}), {@code onError} mit einer deutschen Meldung für den Spieler, z. B. „Du bist in
	 * keiner Voice-Gruppe“ oder „Der Heldix-Dienst kann noch keine Gäste im Browser“.
	 *
	 * @since 9
	 */
	void createBrowserLink(java.util.function.Consumer<String> onLink, java.util.function.Consumer<String> onError);

	@FunctionalInterface
	interface FrameListener {
		void onFrame(UUID sender, int sequence, boolean last, byte[] frame);
	}
}
