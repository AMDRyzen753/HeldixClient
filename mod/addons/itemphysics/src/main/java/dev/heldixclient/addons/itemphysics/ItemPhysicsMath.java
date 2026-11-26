package dev.heldixclient.addons.itemphysics;

/**
 * Die Rechnungen von Item Physics, ohne Spielobjekte (testbar, siehe mod/src/transformCheck).
 * Winkel in Grad, Zeiten in Ticks, Maße in Blöcken.
 */
public final class ItemPhysicsMath {
	/** Mindestdrehung pro Tick in der Luft, in Grad */
	public static final float AIR_SPIN_BASE = 8.0F;
	/** Zusätzliche Drehung pro Tick je Block/Tick Geschwindigkeit, in Grad */
	public static final float AIR_SPIN_PER_SPEED = 60.0F;
	/** Kleiner Abstand zum Boden gegen Flimmern */
	public static final float GROUND_GAP = 0.005F;
	/** Blöcke im Stapel streut Minecraft um bis zu so viel */
	public static final float BLOCK_STACK_SPREAD = 0.15F;

	private ItemPhysicsMath() {
	}

	/**
	 * Kippwinkel nach {@code dt} Ticks.
	 *
	 * @param pitch       bisheriger Winkel (0 = aufrecht, 90 = flach hingelegt)
	 * @param resting     liegt auf dem Boden oder ist im Wasser
	 * @param flat        flaches Item (Sprite) statt Block
	 * @param tumble      darf sich überschlagen (flache Items immer, Blöcke nach Einstellung); sonst richtet es sich auf
	 * @param settleSpeed Grad pro Tick beim Hinlegen ({@link Float#POSITIVE_INFINITY} = sofort)
	 * @param airSpin     Faktor für das Überschlagen in der Luft (0 = gar nicht, 1 = normal)
	 * @param speed       Geschwindigkeit in Blöcken pro Tick
	 * @return neuer Winkel von 0 bis unter 360 Grad
	 */
	public static float tilt(float pitch, float dt, boolean resting, boolean flat, boolean tumble, float settleSpeed, float airSpin, double speed) {
		if (resting || !tumble) {
			// flach: 90° oder 270° (Vorder- oder Rückseite oben), Block: nächste volle Vierteldrehung; ohne Kippen aufrecht
			float target = !tumble ? nearest(pitch, 360.0F, 0.0F) : flat ? nearest(pitch, 180.0F, 90.0F) : nearest(pitch, 90.0F, 0.0F);
			if (Float.isInfinite(settleSpeed)) {
				pitch = target;
			} else {
				float step = Math.max(0.0F, settleSpeed) * dt;
				pitch += Math.clamp(target - pitch, -step, step);
			}
		} else {
			pitch += dt * airSpin * (AIR_SPIN_BASE + (float) speed * AIR_SPIN_PER_SPEED);
		}
		return wrap(pitch);
	}

	/**
	 * Wie weit das Modell angehoben werden muss, damit sein tiefster Punkt nach dem Kippen auf dem Boden liegt.
	 * Berücksichtigt Stapel: flache Items liegen in Minecraft hintereinander (z-Richtung, 1,5-fache Tiefe Abstand),
	 * Blöcke streuen um bis zu 0,15 Blöcke.
	 */
	public static float lift(double minY, double maxY, double minZ, double maxZ, int count, boolean flat, float pitchDegrees) {
		float extra = GROUND_GAP;
		if (count > 1) {
			if (flat) {
				double spread = (maxZ - minZ) * 1.5 * (count - 1) / 2.0;
				minZ -= spread;
				maxZ += spread;
			} else {
				extra += BLOCK_STACK_SPREAD;
			}
		}
		double rad = Math.toRadians(pitchDegrees);
		double cos = Math.cos(rad);
		double sin = Math.sin(rad);
		// Drehung um +X: y' = y·cos − z·sin; gesucht ist das kleinste y' der vier Kanten
		double lowest = Math.min(
				Math.min(minY * cos - minZ * sin, minY * cos - maxZ * sin),
				Math.min(maxY * cos - minZ * sin, maxY * cos - maxZ * sin));
		return (float) -lowest + extra;
	}

	/** Nächster Winkel der Form offset + k·step zu {@code angle}. */
	public static float nearest(float angle, float step, float offset) {
		return offset + Math.round((angle - offset) / step) * step;
	}

	/** Winkel auf 0 bis unter 360 Grad bringen. */
	public static float wrap(float angle) {
		float wrapped = angle % 360.0F;
		return wrapped < 0.0F ? wrapped + 360.0F : wrapped;
	}

	/** Grad pro Tick, damit ein Item in {@code seconds} Sekunden um 90° kippt (0 = sofort) */
	public static float settleSpeed(double seconds) {
		return seconds <= 0 ? Float.POSITIVE_INFINITY : (float) (90.0 / (seconds * 20.0));
	}
}
