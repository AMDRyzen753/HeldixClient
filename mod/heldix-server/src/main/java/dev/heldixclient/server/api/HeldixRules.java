package dev.heldixclient.server.api;

import org.bukkit.entity.Player;

import java.util.Collection;
import java.util.Set;

/**
 * Server-Regeln: Funktionen von HeldixClient, die auf diesem Server aus sind. HeldixClient zeigt beim Versuch, sie zu nutzen,
 * „Auf diesem Server deaktiviert“. Global (aus {@code config.yml}, {@code rules.disable}) oder je Spieler (ersetzt dann die
 * globalen für diesen Spieler, z. B. während einer Runde). Jede Änderung geht sofort an die betroffenen HeldixClient-Spieler.
 *
 * <p>Schlüssel klein, {@code [a-z0-9_.-]{1,32}}. Bekannte Schlüssel: {@link #KNOWN}. Andere Schlüssel sind erlaubt (für
 * Addons, die sie selbst abfragen); HeldixClient selbst ignoriert sie.
 */
public interface HeldixRules {
	/** Schlüssel, die HeldixClient 0.14.1 kennt und durchsetzt */
	Set<String> KNOWN = Set.of("freelook", "zoom", "minimap", "worldmap", "waypoints", "coordinates", "fullbright", "togglesprint");

	/** Globale Regeln (Kopie) */
	Set<String> global();

	/** Globale Regeln ersetzen (gilt für alle Spieler ohne eigene Regeln; nicht in config.yml gespeichert) */
	void setGlobal(Collection<String> disabled);

	/** Regeln, die für diesen Spieler gelten (eigene oder globale) */
	Set<String> of(Player player);

	/** Eigene Regeln für diesen Spieler (ersetzen die globalen), bis {@link #reset} oder zum Verlassen des Servers */
	void set(Player player, Collection<String> disabled);

	/** Spieler bekommt wieder die globalen Regeln */
	void reset(Player player);
}
