package dev.heldixclient.server.api;

/**
 * Was HeldixClient beim Betreten des Servers meldet (Nachricht {@code hello}).
 *
 * @param version  Version von HeldixClient, z. B. "0.14.1"
 * @param api      Stufe der Addon-API, z. B. 11
 * @param language Sprache des Spielers: "de" oder "en"
 */
public record HeldixClientInfo(String version, int api, String language) {
}
