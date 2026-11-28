package dev.heldixclient.api;

import java.util.function.Consumer;

/**
 * Ereignisse, auf die ein Addon reagieren kann. Alle Listener laufen im Haupt-Thread des Spiels.
 * Ab API 3 geben die Methoden eine {@link Registration} zurück, mit der man den Listener wieder abmeldet.
 */
public interface HeldixEvents {
	/** 20-mal pro Sekunde (jeden Client-Tick). */
	void onTick(Runnable listener);

	/** Beim Betreten einer Welt oder eines Servers. */
	void onWorldJoin(Runnable listener);

	/** Beim Verlassen einer Welt oder eines Servers. */
	void onWorldLeave(Runnable listener);

	/** Bei jeder empfangenen Chat- oder Systemnachricht (als reiner Text). */
	void onChatMessage(Consumer<String> listener);

	// --- ab API 3 ---------------------------------------------------------------------------

	/**
	 * Beim Betreten eines Servers (nicht im Einzelspieler), mit seiner Adresse, z. B. "play.example.net".
	 * Kommt direkt nach {@link #onWorldJoin(Runnable)}.
	 *
	 * @since 3
	 */
	Registration onServerJoin(Consumer<String> listener);

	/**
	 * Beim Verlassen eines Servers, mit seiner Adresse. Kommt direkt nach {@link #onWorldLeave(Runnable)}.
	 *
	 * @since 3
	 */
	Registration onServerLeave(Consumer<String> listener);

	/**
	 * Ein Menü geht auf, mit seiner Art: "chat", "inventory" (eigenes Inventar, auch Kreativ), "container" (Truhe,
	 * Ofen …), "pause", "death", "options", "title" (Hauptmenü), "worlds", "servers", "loading", "heldix"
	 * (Heldix-Menü, HUD-Editor) oder "other". Geprüft wird einmal pro Tick; wechselt ein Menü direkt in ein
	 * anderes, kommt erst {@link #onScreenClose} für das alte.
	 *
	 * @since 3
	 */
	Registration onScreenOpen(Consumer<String> listener);

	/**
	 * Ein Menü geht zu, mit seiner Art (siehe {@link #onScreenOpen}).
	 *
	 * @since 3
	 */
	Registration onScreenClose(Consumer<String> listener);

	/**
	 * Der eigene Spieler ist gestorben.
	 *
	 * @since 3
	 */
	Registration onDeath(Runnable listener);

	/**
	 * Der eigene Spieler ist nach dem Tod wieder da.
	 *
	 * @since 3
	 */
	Registration onRespawn(Runnable listener);

	/**
	 * Wechsel in eine andere Dimension (nicht beim Betreten der Welt), z. B. "the_nether".
	 *
	 * @since 3
	 */
	Registration onDimensionChange(Consumer<String> listener);

	/**
	 * Das Leben des eigenen Spielers ändert sich (Schaden, Heilung, Wiederbeleben). Schaden: current &lt; previous.
	 *
	 * @since 3
	 */
	Registration onHealthChange(HealthListener listener);

	/** @since 3 */
	@FunctionalInterface
	interface HealthListener {
		void onChange(float previous, float current);
	}

	// --- ab API 11 --------------------------------------------------------------------------

	/**
	 * Server-Info oder Server-Regeln haben sich geändert ({@link HeldixApi#server()}): Der Server hat sich als Heldix-Server
	 * gemeldet, neue Regeln geschickt, die Partnerliste hat ihn erkannt – oder der Spieler hat den Server verlassen (dann
	 * ist wieder alles erlaubt). Bekommt den neuen Stand.
	 *
	 * @since 11
	 */
	Registration onServerInfoChange(Consumer<ServerInfo> listener);

	/**
	 * Die Sprache für Addons hat gewechselt ({@link HeldixApi#language()}), mit der neuen: "de" oder "en".
	 *
	 * @since 11
	 */
	Registration onLanguageChange(Consumer<String> listener);
}
