package dev.heldixclient.api;

/**
 * Zeichnet ein HUD-Element. Die Größe ergibt sich automatisch aus dem, was gezeichnet wird.
 *
 * <p>Ab API 5 kann das Element auf die Maus reagieren, solange der Spieler das HUD bedient (Chat offen oder Taste
 * „HUD bedienen“): Bereiche mit {@link HudCanvas#hotspot} anmelden und {@link #onClick(HudClick)} bzw.
 * {@link #onHover(HudHover)} überschreiben. Ein Lambda ({@code canvas -> …}) zeichnet weiterhin nur.
 */
@FunctionalInterface
public interface HudRenderer {
	void render(HudCanvas canvas);

	/**
	 * Klick auf das Element (nur, solange der Spieler das HUD bedient). Ein Rechtsklick, den das Addon nicht
	 * verbraucht, öffnet die Einstellungen des Moduls.
	 *
	 * @return true = Klick verbraucht
	 * @since 5
	 */
	default boolean onClick(HudClick click) {
		return false;
	}

	/**
	 * Mauszeiger über dem Element (nur, solange der Spieler das HUD bedient): Tooltip und Form des Mauszeigers.
	 * Ohne Überschreiben gilt, was beim {@link HudCanvas#hotspot} angegeben ist.
	 *
	 * @since 5
	 */
	default void onHover(HudHover hover) {
	}
}
