package dev.heldixclient.server.api;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.RegisteredServiceProvider;

import java.util.Collection;
import java.util.Optional;

/**
 * Schnittstelle des Plugins „HeldixClient Server“ für andere Plugins. Holen über den ServicesManager von Bukkit:
 *
 * <pre>{@code
 * HeldixServer heldix = HeldixServer.get();            // null, wenn das Plugin fehlt
 * if (heldix != null && heldix.isHeldix(player)) {
 *     heldix.hud(player).set(HudElement.ofText("runde").anchor(HudAnchor.TOP_RIGHT).title("Runde 2").text("Noch 3 Minuten"));
 *     heldix.toast(player, "Willkommen", "Viel Spaß auf unserem Server!");
 * }
 * }</pre>
 *
 * <p>Alle Methoden im Hauptthread des Servers aufrufen (wie fast alles in Bukkit). Aufrufe an den Heldix-Dienst
 * (Voice-Gruppen, Belohnungen) laufen immer im Hintergrund; ihre Ergebnisse kommen im Hauptthread zurück.
 *
 * <p>HUD-Elemente, Einblendungen und Regeln erreichen nur Spieler mit HeldixClient ({@link #isHeldix}); für alle anderen
 * passiert nichts. Voice-Gruppen und Belohnungen brauchen einen Partner-Schlüssel ({@link #partner()}).
 */
public interface HeldixServer {
	/** Plugin-Messaging-Kanal zwischen Server und HeldixClient */
	String CHANNEL = "heldixclient:server";
	/** Protokollversion auf dem Kanal */
	int PROTOCOL = 1;

	/** Die Schnittstelle des geladenen Plugins oder null, wenn „HeldixClient Server“ nicht installiert bzw. aus ist. */
	static HeldixServer get() {
		RegisteredServiceProvider<HeldixServer> provider = Bukkit.getServicesManager().getRegistration(HeldixServer.class);
		return provider == null ? null : provider.getProvider();
	}

	/** Version des Plugins, z. B. "1.0.0" */
	String version();

	/** Spielt der Spieler mit HeldixClient (hat sich auf dem Kanal mit {@code hello} gemeldet)? */
	boolean isHeldix(Player player);

	/** Version von HeldixClient, z. B. "0.14.1" (leer ohne HeldixClient) */
	Optional<String> clientVersion(Player player);

	/** Alles, was HeldixClient beim Betreten gemeldet hat (leer ohne HeldixClient) */
	Optional<HeldixClientInfo> client(Player player);

	/** Alle Spieler mit HeldixClient, die gerade online sind */
	Collection<Player> heldixPlayers();

	/** HUD-Elemente dieses Spielers (höchstens 8 je Spieler). Gilt bis zum Verlassen des Servers. */
	HeldixHud hud(Player player);

	/**
	 * Kurze Einblendung oben rechts im Heldix-Stil (Titel ≤ 40, Text ≤ 120 Zeichen, §-Codes werden entfernt). Höchstens eine je
	 * 5 Sekunden und Spieler.
	 *
	 * @return false, wenn der Spieler kein HeldixClient hat oder die letzte Einblendung weniger als 5 s her ist
	 */
	boolean toast(Player player, String title, String text);

	/** Server-Regeln: Funktionen von HeldixClient, die auf diesem Server aus sind (global oder je Spieler) */
	HeldixRules rules();

	/** Voice-Gruppen für den Voice Chat von HeldixClient (nur mit Partner-Schlüssel) */
	HeldixVoiceGroups voiceGroups();

	/** Belohnungs-Cosmetics vergeben (nur mit Partner-Schlüssel, nur vom Team freigegebene Partner-Cosmetics) */
	HeldixRewards rewards();

	/** Ist ein gültiger Partner-Schlüssel eingetragen (vom Heldix-Dienst bestätigt)? */
	boolean partner();

	/** Name des Partners laut Heldix-Dienst (leer ohne gültigen Schlüssel) */
	Optional<String> partnerName();
}
