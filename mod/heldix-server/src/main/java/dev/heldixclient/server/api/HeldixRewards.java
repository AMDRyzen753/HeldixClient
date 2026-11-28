package dev.heldixclient.server.api;

import org.bukkit.entity.Player;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Belohnungs-Cosmetics (nur mit Partner-Schlüssel): Ein Spieler bekommt ein Cosmetic aus dem Katalog von HeldixClient
 * freigeschaltet – nur solche, die das Team für diesen Partner freigegeben hat ({@code access: "partner"}). Wirkt wie eine
 * Freischaltung; der Spieler trägt es dann im Heldix-Menü, im Launcher oder auf der Webseite. Der Dienst erlaubt höchstens
 * 600 Belohnungen je Stunde und Partner.
 *
 * <pre>{@code
 * heldix.rewards().grant(player, "sieger-krone").thenAccept(result -> {
 *     if (result.granted()) player.sendMessage(result.already() ? "Du hast die Krone schon." : "Neu: die Sieger-Krone!");
 *     else getLogger().warning("Belohnung nicht vergeben: " + result.error());
 * });
 * }</pre>
 */
public interface HeldixRewards {
	/** Ergebnis im Hauptthread des Servers; scheitert nie mit einer Ausnahme (Fehler stehen in {@link RewardResult#error()}) */
	CompletableFuture<RewardResult> grant(UUID player, String cosmeticId);

	default CompletableFuture<RewardResult> grant(Player player, String cosmeticId) {
		return grant(player.getUniqueId(), cosmeticId);
	}
}
