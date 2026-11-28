package dev.heldixclient.server.api;

import org.bukkit.entity.Player;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Voice-Gruppen für den Voice Chat von HeldixClient (nur mit Partner-Schlüssel). Ein Spieler mit Server-Gruppe hört in der
 * Nähe nur Spieler derselben Gruppe, und seine Gruppe im Voice Chat ist die Server-Gruppe (jede Entfernung, nur auf diesem
 * Server). Spieler ohne Server-Gruppe hören nur Spieler ohne Server-Gruppe.
 *
 * <p>Das Plugin schickt Änderungen gesammelt (nach einer halben Sekunde) und alle 2 Minuten den ganzen Stand an den
 * Heldix-Dienst; der Dienst vergisst Gruppen nach 10 Minuten ohne Erneuerung. Verlässt ein Spieler den Server, fällt seine
 * Gruppe weg. Gruppen-Namen: {@code [a-z0-9_-]{1,24}}.
 */
public interface HeldixVoiceGroups {
	/** Mit gültigem Partner-Schlüssel? Ohne gehen die Gruppen nicht an den Dienst. */
	boolean available();

	/** Gruppe setzen (null entfernt). Wirft bei einem ungültigen Namen. */
	void set(UUID player, String group);

	default void set(Player player, String group) {
		set(player.getUniqueId(), group);
	}

	void remove(UUID player);

	default void remove(Player player) {
		remove(player.getUniqueId());
	}

	/** Alle Gruppen dieses Servers leeren (auch beim Dienst) */
	void clear();

	/** Gruppe eines Spielers */
	Optional<String> of(UUID player);

	/** Alle gesetzten Gruppen (Kopie) */
	Map<UUID, String> all();

	/**
	 * Den ganzen Stand sofort an den Dienst schicken (sonst spätestens nach 2 Minuten). Ergebnis im Hauptthread: true =
	 * angenommen.
	 */
	CompletableFuture<Boolean> sync();
}
