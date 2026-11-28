package dev.heldixclient.api;

import java.util.Set;
import java.util.UUID;

/**
 * Sprachkanal über den Heldix-Dienst für Voice-Chat-Addons: HeldixClient hält die Verbindung, meldet Server, Welt und
 * Position und verteilt die Rahmen deines Addons an HeldixClient-Spieler in der Nähe (gleicher Server, gleiche Welt,
 * innerhalb von {@link #range()} Blöcken; Blockierungen und „Nur Freunde“ gelten) – ab API 7 außerdem an die Mitglieder deiner
 * Gruppe ({@link #setGroup}) auf demselben Server, egal wo sie sind; ab API 9 sind auch Gäste und Spieler im Browser in der
 * Gruppe ({@link #isGuest}, {@link #inBrowser}, {@link #createBrowserLink}); ab API 10 kommen Moderation (Sperren, Gastgeber
 * und Party-Leiter, {@link #moderation()}, {@link #moderate}), Melden ({@link #openReport}) und Voice-Regeln
 * ({@link #showRules}) dazu – Zustimmung und Melden laufen über Dialoge von HeldixClient. Aufnehmen, Kodieren (z. B. Opus),
 * Mischen und Abspielen macht das Addon selbst. Der Dienst speichert keine Sprache (außer einer Aufnahme, die ein Spieler
 * beim Melden anhängt).
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

	// --- ab API 10: Moderation, Melden, Voice-Regeln ---------------------------------------------

	/**
	 * Eigener Moderations-Stand im Sprachkanal (Momentaufnahme): Sperre durch das Team, Server ohne Voice, stumm geschaltet
	 * oder entfernt durch Gastgeber bzw. Party-Leiter, Voice-Regeln offen. Bei älteren Diensten ({@link Moderation#available()}
	 * false) und solange dein Addon den Kanal nicht eingeschaltet hat, ist alles leer. Nur im Haupt-Thread aufrufen.
	 *
	 * @since 10
	 */
	Moderation moderation();

	/**
	 * Änderungen am Moderations-Stand, jeweils mit fertigem deutschen Text für den Spieler (z. B. für
	 * {@link HeldixApi#notify}). Läuft im Haupt-Thread.
	 *
	 * @since 10
	 */
	Registration onModeration(java.util.function.Consumer<ModerationEvent> listener);

	/**
	 * Deine Rechte im aktuellen Voice-Raum: Gastgeber oder Operator einer Heldix-Welt, Leiter der Party. Nur im Haupt-Thread.
	 *
	 * @since 10
	 */
	RoomRights rights();

	/**
	 * Hat ein Gastgeber, Operator oder Party-Leiter diesen Teilnehmer im geltenden Bereich für alle stumm geschaltet? Seine
	 * Stimme leitet der Heldix-Dienst dort nicht weiter (z. B. für ein Symbol über dem Kopf).
	 *
	 * @since 10
	 */
	boolean isSilenced(UUID participant);

	/**
	 * Einen Teilnehmer für alle stummschalten, entfernen (10 Minuten kein Zutritt) oder das wieder aufheben. Den Bereich
	 * wählt HeldixClient: Ist der Teilnehmer in der Voice-Gruppe deiner Party und du leitest sie, gilt es für die Party,
	 * sonst für die Heldix-Welt. Nur auf Wunsch des Spielers aufrufen – in einer Taste, einem Befehl, einem Knopf, einem
	 * Klick im HUD oder einem Eintrag im Spielermenü; überall sonst wirft der Aufruf eine {@link IllegalStateException}.
	 *
	 * @param onResult läuft genau einmal im Haupt-Thread, mit einer deutschen Meldung für den Spieler (Erfolg oder Grund)
	 * @since 10
	 */
	void moderate(UUID participant, ModerationAction action, java.util.function.Consumer<String> onResult);

	/**
	 * Stand der Voice-Regeln (Version, angenommen, nötig, Aufnahmen aktiv). Nur im Haupt-Thread.
	 *
	 * @since 10
	 */
	Rules rules();

	/**
	 * Zeigt den Dialog „Voice-Regeln“ von HeldixClient: den aktuellen Text vom Heldix-Dienst (scrollbar), den Hinweis auf
	 * die Aufnahme der letzten 10 Minuten und „Annehmen“/„Ablehnen“. Zustimmen kann der Spieler nur dort – ein Addon kann
	 * die Regeln nicht selbst annehmen. Nach dem Annehmen verbindet HeldixClient den Sprachkanal sofort neu.
	 *
	 * <p>Ohne Aktion des Spielers (Taste, Knopf, Klick, Befehl) öffnet sich der Dialog nur, solange die Regeln nötig sind,
	 * und höchstens einmal je Version, nachdem dein Addon den Kanal eingeschaltet hat – z. B. bei
	 * {@link ModerationEvent.Kind#RULES_REQUIRED}. Sonst kommt sofort der aktuelle Stand zurück. Nur im Haupt-Thread aufrufen.
	 *
	 * @param onDone läuft genau einmal im Haupt-Thread: true = angenommen bzw. keine Zustimmung nötig, false = abgelehnt
	 *               oder nicht möglich
	 * @since 10
	 */
	void showRules(java.util.function.Consumer<Boolean> onDone);

	/**
	 * Öffnet den Melde-Dialog von HeldixClient für einen Teilnehmer: Grund, Notiz und – nur bei aktiven Aufnahmen – ein
	 * Schalter, ob die letzten Minuten seiner Stimme angehängt werden. HeldixClient fügt den Kontext hinzu (Server, Dimension,
	 * Zeitpunkt, Gruppe, wer in Hörweite war) und schickt die Meldung an den Heldix-Dienst. Erst wenn der Spieler auf
	 * „Melden“ klickt, fragt HeldixClient dein Addon nach den Anhängen. Nur auf Wunsch des Spielers aufrufen (wie
	 * {@link #moderate}); Gäste lassen sich nicht melden.
	 *
	 * @param attachments liefert Lautstärke-Verlauf und gepufferte Pakete; null = keine Anhänge
	 * @param onResult    läuft höchstens einmal im Haupt-Thread mit einer deutschen Meldung, wenn die Meldung abgeschickt
	 *                    wurde oder gescheitert ist (nicht beim Abbrechen)
	 * @since 10
	 */
	void openReport(UUID participant, ReportAttachments attachments, java.util.function.Consumer<String> onResult);

	/**
	 * Sind Aufnahmen für Meldungen gerade aktiv (Voice-Regeln veröffentlicht, Aufnahmen beim Dienst an, verbunden)? Nur dann
	 * darf ein Addon empfangene Pakete anderer puffern – nur im Arbeitsspeicher, je Sprecher höchstens 10 Minuten, nie die
	 * eigene Stimme. Wird es false, den Puffer sofort leeren.
	 *
	 * @since 10
	 */
	boolean clipsActive();

	/**
	 * Server-Gruppe: Ein Partner-Server mit dem Plugin „HeldixClient Server“ kann Spieler in Gruppen einteilen (z. B. je
	 * Team einer Runde). Solange du in einer Server-Gruppe bist, hörst du in der Nähe nur Spieler derselben Server-Gruppe,
	 * und deine Gruppe ({@link #groupMembers()}) ist die Server-Gruppe – auf diesem Server, in jeder Entfernung. Deine eigene
	 * Gruppe ({@link #setGroup}) und die Gruppe der Party sind dort so lange aus. Den Namen meldet der Heldix-Dienst über
	 * den Sprachkanal (ab Dienst 1.14.0).
	 *
	 * @return Name der Server-Gruppe (a-z, 0-9, „_“, „-“, höchstens 24 Zeichen) oder null, wenn keine gilt
	 * @since 11
	 */
	String serverGroup();

	/**
	 * Name des Partner-Servers, der die {@link #serverGroup() Server-Gruppe} gesetzt hat ("" ohne Server-Gruppe).
	 *
	 * @since 11
	 */
	String serverGroupPartner();

	/** Moderations-Aktion für {@link #moderate}. @since 10 */
	enum ModerationAction {
		/** für alle stummschalten (der Dienst leitet die Stimme im Bereich nicht weiter) */
		MUTE,
		UNMUTE,
		/** aus dem Voice des Bereichs entfernen, 10 Minuten kein Zutritt */
		KICK,
		/** Entfernen vorzeitig aufheben */
		UNKICK
	}

	/** Eigener Moderations-Stand, siehe {@link #moderation()}. Wird von HeldixClient bereitgestellt. @since 10 */
	interface Moderation {
		/** Kann der verbundene Heldix-Dienst Moderation (ab Dienst 1.13.0)? false, solange es niemand weiß */
		boolean available();

		/** Vom Team für den Voice Chat gesperrt? */
		boolean banned();

		/** Ende der Sperre in Millisekunden seit 1970; 0 = dauerhaft bzw. keine Sperre */
		long bannedUntil();

		/** Grund der Sperre, sonst null */
		String banReason();

		/** fertiger Text, z. B. „Du bist bis 29.11.2026, 14:00 Uhr vom Voice Chat gesperrt. Grund: …“, sonst null */
		String banMessage();

		/** wie man Einspruch einlegt, sonst null */
		String banAppeal();

		/** Voice ist auf diesem Server aus (auf Wunsch des Server-Betreibers): kein Raum, keine Gruppe */
		boolean serverOff();

		/** Name dessen, der dich im geltenden Bereich für alle stumm geschaltet hat, sonst null */
		String mutedBy();

		/** aus dem Voice dieser Welt bzw. der Party-Gruppe entfernt bis (ms seit 1970), 0 = nicht entfernt */
		long kickedUntil();

		/** Voice-Regeln müssen (neu) angenommen werden, sonst gibt es keine Verbindung ({@link #showRules}) */
		boolean rulesRequired();
	}

	/** Änderung am Moderations-Stand, siehe {@link #onModeration}. Wird von HeldixClient bereitgestellt. @since 10 */
	interface ModerationEvent {
		enum Kind {
			/** vom Team gesperrt (Verbindung getrennt, neuer Versuch erst nach der Sperre) */
			BANNED,
			/** von Gastgeber, Operator oder Party-Leiter für alle stumm geschaltet */
			MUTED,
			UNMUTED,
			/** aus dem Voice der Welt bzw. der Party-Gruppe entfernt (meist 10 Minuten) */
			KICKED,
			UNKICKED,
			/** Voice ist auf diesem Server aus (auf Wunsch des Server-Betreibers) */
			SERVER_OFF,
			/** Voice-Regeln (neu) annehmen, sonst keine Verbindung – {@link #showRules} */
			RULES_REQUIRED,
			/** Aufnahmen für Meldungen ein- oder ausgeschaltet ({@link #clipsActive()}); aus = Puffer sofort leeren */
			CLIPS_CHANGED
		}

		Kind kind();

		/** fertiger deutscher Text für den Spieler, z. B. „Tom hat dich in dieser Welt stummgeschaltet.“ */
		String message();

		/** "world" oder "party" (bei MUTED, UNMUTED, KICKED, UNKICKED), sonst null */
		String scope();

		/** Name dessen, der es getan hat (Gastgeber, Leiter), sonst null */
		String byName();

		/** bis wann es gilt (ms seit 1970), 0 = dauerhaft bzw. ohne Ende */
		long until();
	}

	/** Rechte im aktuellen Voice-Raum, siehe {@link #rights()}. Wird von HeldixClient bereitgestellt. @since 10 */
	interface RoomRights {
		/** Name der Heldix-Welt, auf der du gerade bist, sonst null */
		String worldName();

		/** eigene Rolle in der Heldix-Welt: "host", "operator" oder "player"; null = keine Heldix-Welt */
		String worldRole();

		/** Leitest du die Party, deren Voice-Gruppe du gerade nutzt? */
		boolean partyLeader();

		/**
		 * Darfst du diesen Teilnehmer stummschalten bzw. entfernen (für Knöpfe)? Gäste nie. Ob es klappt, entscheidet der
		 * Dienst (Operatoren können z. B. den Gastgeber nicht moderieren).
		 */
		boolean canModerate(UUID participant);
	}

	/** Stand der Voice-Regeln, siehe {@link #rules()}. Wird von HeldixClient bereitgestellt. @since 10 */
	interface Rules {
		/** veröffentlichte Version (ab 1), 0 = keine Regeln veröffentlicht oder noch unbekannt */
		int version();

		/** von dir angenommene Version, 0 = keine */
		int accepted();

		/** muss die aktuelle Version noch angenommen werden? */
		boolean required();

		/** Aufnahmen für Meldungen beim Dienst an (wie {@link VoiceChannel#clipsActive()}, auch ohne Verbindung) */
		boolean clipsActive();
	}

	/**
	 * Anhänge einer Meldung, die dein Addon liefert ({@link #openReport}). HeldixClient ruft {@link #collect} im Haupt-Thread
	 * auf, wenn der Spieler auf „Melden“ klickt. @since 10
	 */
	interface ReportAttachments {
		/**
		 * @param includeClip true = Aufnahmen sind aktiv und der Spieler will die Aufnahme anhängen; nur dann Pakete liefern
		 * @return Lautstärke-Verlauf und (nur mit includeClip) gepufferte Pakete; null = nichts
		 */
		ReportData collect(UUID participant, boolean includeClip);

		/** wie viele Millisekunden seiner Stimme gerade gepuffert sind (für den Hinweis im Dialog), 0 = nichts */
		default long bufferedMillis(UUID participant) {
			return 0;
		}
	}

	/**
	 * Anhänge einer Meldung.
	 *
	 * @param levelsEnd Ende der letzten Sekunde des Verlaufs (ms seit 1970)
	 * @param rms       Effektivwert je Sekunde in dBFS (-100 bis 0), älteste zuerst, höchstens 600; {@code Float.NaN} = nichts
	 *                  gehört. Gemessen nach dem Dekodieren, vor jeder Lautstärke-Begrenzung; null = kein Verlauf
	 * @param peak      Spitzenwert je Sekunde in dBFS, gleich lang wie rms
	 * @param packets   empfangene Opus-Pakete des Gemeldeten, älteste zuerst (nur mit includeClip, sonst leer)
	 * @since 10
	 */
	record ReportData(long levelsEnd, float[] rms, float[] peak, java.util.List<ReceivedPacket> packets) {
	}

	/**
	 * Ein empfangenes Opus-Paket (20 ms, wie es über {@link #onFrame} kam).
	 *
	 * @param receivedAt Empfangszeit (ms seit 1970)
	 * @since 10
	 */
	record ReceivedPacket(long receivedAt, int sequence, boolean last, byte[] data) {
	}

	@FunctionalInterface
	interface FrameListener {
		void onFrame(UUID sender, int sequence, boolean last, byte[] frame);
	}
}
