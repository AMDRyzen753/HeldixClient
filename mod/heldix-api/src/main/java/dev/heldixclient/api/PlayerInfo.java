package dev.heldixclient.api;

/**
 * Momentaufnahme des eigenen Spielers.
 *
 * @param dimension z. B. "overworld", "the_nether", "the_end"
 * @param biome     z. B. "plains"
 */
public record PlayerInfo(String name, double x, double y, double z, float health, int food, String dimension, String biome) {
}
