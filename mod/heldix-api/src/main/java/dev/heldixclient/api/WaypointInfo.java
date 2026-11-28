package dev.heldixclient.api;

/**
 * Ein Wegpunkt des Spielers (Heldix-Modul „Wegpunkte“), nur zum Lesen – z. B. um ihn auf einer Karte zu zeigen.
 *
 * @param dimension z. B. "minecraft:overworld"
 * @param color     ARGB
 * @param death     der automatische Todespunkt
 * @since 8
 */
public record WaypointInfo(String name, int x, int y, int z, String dimension, int color, boolean death) {
}
