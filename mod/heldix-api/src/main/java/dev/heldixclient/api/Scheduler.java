package dev.heldixclient.api;

/**
 * Aufgaben später, wiederholt oder im Hintergrund ausführen ({@link HeldixApi#scheduler()}).
 * Zeiten sind Ticks (20 pro Sekunde). Alle Methoden dürfen aus jedem Thread aufgerufen werden.
 *
 * <p>Was noch geplant ist oder im Hintergrund läuft, wird abgebrochen, wenn das Addon abgeschaltet wird
 * oder das Spiel endet. Fehler in Aufgaben zählen wie alle Addon-Fehler (nach drei wird das Addon abgeschaltet).
 *
 * @since 3
 */
public interface Scheduler {
	/** Einmal im Haupt-Thread, nach ticks Ticks (0 = beim nächsten Tick). */
	Registration runLater(int ticks, Runnable task);

	/** Wiederholt im Haupt-Thread: zuerst nach delayTicks, danach alle periodTicks (mindestens 1). */
	Registration runRepeating(int delayTicks, int periodTicks, Runnable task);

	/**
	 * Im Hintergrund, z. B. für Downloads oder externe Programme. Jedes Addon hat dafür zwei eigene Threads;
	 * weitere Aufgaben warten, bis einer frei ist (höchstens 64 in der Warteschlange). Hier keine Spieldaten
	 * anfassen – Ergebnisse mit {@link #runOnMainThread(Runnable)} zurückgeben. Abbrechen unterbricht den Thread.
	 */
	Registration runAsync(Runnable task);

	/** So bald wie möglich im Haupt-Thread (noch vor dem nächsten Bild). */
	Registration runOnMainThread(Runnable task);

	/** true, wenn der Aufruf gerade im Haupt-Thread des Spiels läuft. */
	boolean isMainThread();
}
