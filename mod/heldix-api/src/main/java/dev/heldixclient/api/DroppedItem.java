package dev.heldixclient.api;

/**
 * Ein gedropptes Item, wie es gerade gezeichnet wird ({@link DroppedItemRenderer#pose(DroppedItem)}). Nur zum Lesen.
 *
 * <p>Gilt nur während des Aufrufs von {@code pose}: HeldixClient nutzt dasselbe Objekt für das nächste Item. Wird vom
 * HeldixClient bereitgestellt, nicht selbst implementieren – spätere API-Versionen können weitere Werte ergänzen.
 *
 * <p>Maße sind Blöcke, Zeiten Ticks (20 pro Sekunde). Die Modell-Box beschreibt das Modell, wie Minecraft es am Boden
 * zeichnet, vor jeder Drehung: x nach rechts, y nach oben, z durch das Item hindurch (bei flachen Items die Dicke).
 *
 * @since 4
 */
public interface DroppedItem {
	/** Nummer des Items in der aktuellen Welt. Bleibt gleich, solange das Item existiert. */
	int entityId();

	/** Art des Items, z. B. "minecraft:diamond". */
	String itemId();

	/** Wie viele Items der Stapel hat (1 bis 99). */
	int stackSize();

	/**
	 * Wie viele Modelle Minecraft für den Stapel zeichnet (1 bis 5). Flache Items liegen dabei dicht hintereinander
	 * (in z-Richtung, je 1,5-fache Dicke), Blöcke leicht verstreut (bis zu 0,15 Blöcke).
	 */
	int count();

	/** Alter des Items in Ticks, mit dem Bruchteil des laufenden Ticks – steigt also auch zwischen zwei Ticks gleichmäßig. */
	float ageTicks();

	/** Liegt das Item auf dem Boden? */
	boolean onGround();

	/** Ist das Item im Wasser? */
	boolean inWater();

	/** Geschwindigkeit in Blöcken pro Tick (0 = liegt still). */
	double speed();

	/** Senkrechte Geschwindigkeit in Blöcken pro Tick (negativ = fällt). */
	double verticalSpeed();

	/**
	 * true = flaches Item, z. B. ein Diamant oder ein Schwert (Modell höchstens 1/16 Block dick); false = Block oder
	 * anderes 3D-Modell. Dieselbe Regel nutzt Minecraft für Stapel.
	 */
	boolean flat();

	/**
	 * Zufälliger, fester Wert je Item von 0 bis 2π. Minecraft nimmt ihn, damit nicht alle Items gleichzeitig schweben
	 * und sich gleich drehen – gut für eine feste, zufällige Ausrichtung.
	 */
	float bobOffset();

	/** Modell-Box: linke Kante */
	float minX();

	/** Modell-Box: rechte Kante */
	float maxX();

	/** Modell-Box: Unterkante (meist negativ, das Modell sitzt um 0 herum) */
	float minY();

	/** Modell-Box: Oberkante */
	float maxY();

	/** Modell-Box: Rückseite */
	float minZ();

	/** Modell-Box: Vorderseite */
	float maxZ();

	/**
	 * Eigener Speicher für dieses Item: 8 Zahlen, anfangs alle 0. Was das Addon hineinschreibt, ist im nächsten Bild
	 * wieder da, solange das Item existiert – z. B. der aktuelle Kippwinkel und das Alter beim letzten Bild. Wechselt
	 * der zeichnende Renderer, beginnt der Speicher wieder bei 0.
	 */
	float[] memory();
}
