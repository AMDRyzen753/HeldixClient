package dev.heldixclient.api;

/**
 * Ein Item in einem Slot (z. B. in der Hand oder als Rüstung).
 *
 * @param id        z. B. "minecraft:diamond_sword" ("" bei leerem Slot)
 * @param name      angezeigter Name, z. B. "Diamantschwert" bzw. der umbenannte Name
 * @param count     Anzahl (0 bei leerem Slot)
 * @param damage    verbrauchte Haltbarkeit (0 bei Items ohne Haltbarkeit)
 * @param maxDamage volle Haltbarkeit (0 = Item hat keine Haltbarkeit)
 * @since 3
 */
public record ItemInfo(String id, String name, int count, int damage, int maxDamage) {
	/** leerer Slot */
	public static final ItemInfo EMPTY = new ItemInfo("", "", 0, 0, 0);

	public boolean isEmpty() {
		return count <= 0 || id.isEmpty();
	}

	/** Hat das Item eine Haltbarkeit (Werkzeug, Rüstung …)? */
	public boolean hasDurability() {
		return maxDamage > 0;
	}

	/** verbleibende Haltbarkeit (0 bei Items ohne Haltbarkeit) */
	public int durability() {
		return maxDamage > 0 ? Math.max(0, maxDamage - damage) : 0;
	}

	/** verbleibende Haltbarkeit von 0 bis 1 (1 bei Items ohne Haltbarkeit) */
	public float durabilityFraction() {
		return maxDamage > 0 ? durability() / (float) maxDamage : 1f;
	}
}
