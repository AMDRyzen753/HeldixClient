package dev.heldixclient.api;

import java.util.Set;
import java.util.UUID;

/**
 * Sprachkanal über den Heldix-Dienst für Voice-Chat-Addons: HeldixClient hält die Verbindung, meldet Server, Welt und
 * Position und verteilt die Rahmen deines Addons an HeldixClient-Spieler in der Nähe (gleicher Server, gleiche Welt,
 * innerhalb von {@link #range()} Blöcken; Blockierungen und „Nur Freunde“ gelten). Aufnehmen, Kodieren (z. B. Opus),
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

	@FunctionalInterface
	interface FrameListener {
		void onFrame(UUID sender, int sequence, boolean last, byte[] frame);
	}
}
