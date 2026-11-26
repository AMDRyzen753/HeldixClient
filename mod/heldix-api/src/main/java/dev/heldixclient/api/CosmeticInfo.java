package dev.heldixclient.api;

/**
 * Ein Cosmetic aus dem Katalog ({@link Cosmetics#catalog()}). Nur lesen; wird vom HeldixClient bereitgestellt.
 *
 * @since 4
 */
public interface CosmeticInfo {
	/** eindeutige ID, z. B. "engelsfluegel" (a–z, 0–9 und -) */
	String id();

	Cosmetics.Slot slot();

	/** Anzeigename, z. B. „Engelsflügel“ */
	String name();

	/** kurze Beschreibung (kann leer sein) */
	String description();

	/** nur Mitglieder des HeldixClient-Teams dürfen es wählen (alle sehen es an ihnen) */
	boolean teamOnly();
}
