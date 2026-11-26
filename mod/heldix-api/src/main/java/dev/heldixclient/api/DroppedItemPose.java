package dev.heldixclient.api;

/**
 * Lage eines gedroppten Items in einem Bild (Rückgabe von {@link DroppedItemRenderer#pose(DroppedItem)}).
 *
 * <p>Ersetzt das Schweben und Drehen von Minecraft: Der Mittelpunkt des Modells (Ursprung der Modell-Box aus
 * {@link DroppedItem}) wird um {@code lift} über die Position des Items gehoben – am Boden ist das die Oberkante des
 * Blocks darunter. Danach wird das Modell um diesen Punkt gedreht, erst um die Hochachse ({@code yaw}), dann um die
 * Querachse ({@code pitch}), dann um die Längsachse ({@code roll}). Bei {@code pitch} = 90 liegt ein flaches Item flach
 * auf dem Boden.
 *
 * <p>Damit die tiefste Ecke genau auf dem Boden liegt, rechnet man {@code lift} aus der Modell-Box und den Winkeln aus
 * (Minecraft selbst hebt das Modell um {@code -minY + 0,0625} plus Schweben).
 *
 * <p>Ungültige Werte: Ist {@code lift} keine endliche Zahl ({@link Float#NaN}, unendlich), schwebt das Item wie gewohnt;
 * ist einer der Winkel keine endliche Zahl, dreht es sich wie gewohnt. {@code lift} wird auf ±2 Blöcke begrenzt.
 *
 * @param lift  Höhe des Modell-Mittelpunkts über der Position des Items, in Blöcken
 * @param yaw   Drehung um die Hochachse in Grad (z. B. eine feste, zufällige Ausrichtung)
 * @param pitch Kippen um die Querachse in Grad (90 = flach hingelegt)
 * @param roll  Kippen um die Längsachse in Grad
 * @since 4
 */
public record DroppedItemPose(float lift, float yaw, float pitch, float roll) {
	/** Wert für {@code lift} bzw. die Winkel: diesen Teil wie in Minecraft lassen (Schweben bzw. Drehen). */
	public static final float VANILLA = Float.NaN;

	/** Höhe, Drehung und Kippen, ohne {@code roll}. */
	public static DroppedItemPose of(float lift, float yaw, float pitch) {
		return new DroppedItemPose(lift, yaw, pitch, 0f);
	}

	/** Nur die Höhe festlegen; das Item dreht sich weiter wie gewohnt. */
	public static DroppedItemPose liftOnly(float lift) {
		return new DroppedItemPose(lift, VANILLA, VANILLA, VANILLA);
	}

	/** Nur die Drehung festlegen; das Item schwebt weiter wie gewohnt. */
	public static DroppedItemPose rotationOnly(float yaw, float pitch, float roll) {
		return new DroppedItemPose(VANILLA, yaw, pitch, roll);
	}

	/** Wird die Höhe festgelegt (endliche Zahl)? */
	public boolean hasLift() {
		return Float.isFinite(lift);
	}

	/** Wird die Drehung festgelegt (alle drei Winkel endliche Zahlen)? */
	public boolean hasRotation() {
		return Float.isFinite(yaw) && Float.isFinite(pitch) && Float.isFinite(roll);
	}
}
