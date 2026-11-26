package dev.heldixclient.api;

/**
 * Legt fest, wie ein gedropptes Item gezeichnet wird ({@link DroppedItems#addRenderer(DroppedItemRenderer)}).
 *
 * @since 4
 */
@FunctionalInterface
public interface DroppedItemRenderer {
	/**
	 * Höhe und Drehung eines Items in diesem Bild.
	 *
	 * <p>Läuft im Haupt-Thread (dort zeichnet Minecraft) einmal pro sichtbarem Item und Bild – bei vielen Items und
	 * hohen FPS also sehr oft. Deshalb hier nur rechnen: nichts laden, nichts speichern, nichts pro Bild loggen.
	 * Werte, die über mehrere Bilder gebraucht werden (z. B. der aktuelle Kippwinkel), gehören in
	 * {@link DroppedItem#memory()}.
	 *
	 * @param item das Item; das Objekt gilt nur während dieses Aufrufs und wird danach für das nächste Item
	 *             wiederverwendet – nicht speichern
	 * @return die Lage, oder null = dieses Item wie gewohnt zeichnen (schweben und drehen)
	 */
	DroppedItemPose pose(DroppedItem item);
}
