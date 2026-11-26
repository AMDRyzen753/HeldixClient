package dev.heldixclient.api;

import java.util.List;

/**
 * Ausführliche Momentaufnahme des eigenen Spielers ({@link HeldixApi#playerState()}), ergänzt {@link PlayerInfo}.
 * Wird vom HeldixClient bereitgestellt, nicht selbst implementieren – spätere API-Versionen können weitere
 * Werte ergänzen.
 *
 * @since 3
 */
public interface PlayerState {
	String name();

	/** UUID mit Bindestrichen */
	String uuid();

	double x();

	double y();

	double z();

	/** Drehung nach links/rechts in Grad (0 = Süden, 90 = Westen, 180 = Norden, 270 = Osten), 0 bis 360 */
	float yaw();

	/** Blick nach oben/unten in Grad (-90 = ganz nach oben, 90 = ganz nach unten) */
	float pitch();

	/** Himmelsrichtung des Blicks: "north", "east", "south" oder "west" */
	String facing();

	/** Tempo in Blöcken pro Sekunde (waagrecht) */
	double speed();

	float health();

	float maxHealth();

	/** zusätzliche (gelbe) Herzen, z. B. vom Goldenen Apfel */
	float absorption();

	int food();

	float saturation();

	/** Rüstungspunkte (0 bis 20 und mehr) */
	int armorPoints();

	int xpLevel();

	/** Fortschritt zum nächsten Level von 0 bis 1 */
	float xpProgress();

	/** "survival", "creative", "adventure" oder "spectator" */
	String gameMode();

	boolean sprinting();

	boolean sneaking();

	boolean flying();

	boolean onGround();

	boolean inWater();

	/** z. B. "overworld", "the_nether", "the_end" */
	String dimension();

	/** z. B. "plains" */
	String biome();

	/** gewählter Platz in der Schnellleiste (0 bis 8) */
	int selectedSlot();

	ItemInfo mainHand();

	ItemInfo offHand();

	/** Rüstung in der Reihenfolge Kopf, Brust, Beine, Füße (leere Slots als {@link ItemInfo#EMPTY}) */
	List<ItemInfo> armorItems();

	/** aktive Trank-Effekte */
	List<EffectInfo> effects();
}
