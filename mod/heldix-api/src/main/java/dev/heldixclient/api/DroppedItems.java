package dev.heldixclient.api;

/**
 * Zeichnen der gedroppten Items in der Welt ({@link HeldixApi#droppedItems()}): Items, die auf dem Boden liegen oder
 * durch die Luft fliegen. Normal schweben sie und drehen sich; ein {@link DroppedItemRenderer} kann stattdessen für
 * jedes Item in jedem Bild Höhe und Drehung festlegen (z. B. „Item Physics“: Items fallen, überschlagen sich und liegen
 * dann flach auf dem Boden).
 *
 * <p>Rein optisch und nur auf dem eigenen Client: Hitbox, Aufsammeln und Spielablauf bleiben unverändert, auf Servern
 * ist nichts nötig. Wird vom HeldixClient bereitgestellt, nicht selbst implementieren.
 *
 * @since 4
 */
public interface DroppedItems {
	/**
	 * Meldet einen Renderer an. Er wird ab dem nächsten Bild für jedes sichtbare gedroppte Item aufgerufen.
	 *
	 * <p>Es zeichnet immer nur ein Renderer: der zuletzt angemeldete, der noch aktiv ist (auch über Addons hinweg).
	 * Wird er abgemeldet oder sein Addon abgeschaltet, übernimmt wieder der davor angemeldete bzw. Minecraft selbst
	 * (Schweben und Drehen wie gewohnt). Wirft der Renderer eine Exception, wird dieses Item in diesem Bild normal
	 * gezeichnet und der Fehler zählt wie jeder Addon-Fehler – nach drei Fehlern wird das Addon abgeschaltet.
	 *
	 * <p>Darf aus jedem Thread aufgerufen werden.
	 *
	 * @return zum Abmelden ({@link Registration#cancel()} stellt das normale Zeichnen wieder her)
	 */
	Registration addRenderer(DroppedItemRenderer renderer);

	/**
	 * false, wenn HeldixClient das Zeichnen der Items in dieser Minecraft-Version nicht verändern kann (z. B. weil
	 * Minecraft den Code dafür umgebaut hat). Renderer werden dann nie aufgerufen, die Items schweben wie gewohnt.
	 */
	boolean isSupported();
}
