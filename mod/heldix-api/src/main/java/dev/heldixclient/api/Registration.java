package dev.heldixclient.api;

/**
 * Eine Anmeldung, die man wieder aufheben kann: ein Listener aus {@link HeldixEvents}, ein Chat-Befehl
 * ({@link HeldixApi#registerCommand}) oder eine geplante Aufgabe ({@link Scheduler}).
 * Wird vom HeldixClient bereitgestellt, nicht selbst implementieren.
 *
 * @since 3
 */
public interface Registration {
	/** Abmelden bzw. abbrechen. Mehrfaches Aufrufen schadet nicht. */
	void cancel();

	/** true, solange der Listener angemeldet bzw. die Aufgabe noch geplant ist oder gerade läuft. */
	boolean isActive();
}
