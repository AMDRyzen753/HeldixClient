package dev.heldixclient.api;

import java.util.Optional;

/**
 * Deine Auswahl in einem Slot hat sich geändert ({@link Cosmetics#onChange}). Wird vom HeldixClient bereitgestellt.
 *
 * @since 4
 */
public interface CosmeticChange {
	Cosmetics.Slot slot();

	/** ID vorher (leer = nichts) */
	Optional<String> previous();

	/** ID jetzt (leer = abgelegt) */
	Optional<String> current();
}
