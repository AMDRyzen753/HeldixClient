package dev.heldixclient.api;

/**
 * Ein aktiver Trank-Effekt des eigenen Spielers.
 *
 * @param id            z. B. "minecraft:speed"
 * @param name          angezeigter Name, z. B. "Schnelligkeit"
 * @param amplifier     Stärke ab 0 (0 = Stufe I)
 * @param durationTicks verbleibende Dauer in Ticks (-1 = unendlich)
 * @param harmful       schädlicher Effekt (z. B. Gift)?
 * @since 3
 */
public record EffectInfo(String id, String name, int amplifier, int durationTicks, boolean harmful) {
	/** Stufe wie im Spiel (1 = I, 2 = II …) */
	public int level() {
		return amplifier + 1;
	}

	public boolean isInfinite() {
		return durationTicks < 0;
	}

	/** verbleibende Dauer in Sekunden (-1 = unendlich) */
	public int durationSeconds() {
		return durationTicks < 0 ? -1 : durationTicks / 20;
	}
}
