package dev.heldixclient.api;

/**
 * Eine mit {@link HeldixApi#registerKey(String, String, int, Runnable)} angelegte Taste.
 *
 * @since 2
 */
public interface KeyHandle {
	/** Wird die Taste gerade gehalten? */
	boolean isDown();

	/** Name der aktuell belegten Taste, z. B. "Pos1" (leer, wenn nicht belegt). */
	String keyName();
}
