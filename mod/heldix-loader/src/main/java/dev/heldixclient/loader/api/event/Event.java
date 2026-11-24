package dev.heldixclient.loader.api.event;

import java.util.List;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * Ein Ereignis, für das sich Mods mit {@link #register} anmelden.
 * Listener werden in Reihenfolge der Anmeldung aufgerufen.
 */
public final class Event<T> {
	private final List<T> listeners = new CopyOnWriteArrayList<>();

	public T register(T listener) {
		listeners.add(Objects.requireNonNull(listener, "listener"));
		return listener;
	}

	public boolean unregister(T listener) {
		return listeners.remove(listener);
	}

	public boolean hasListeners() {
		return !listeners.isEmpty();
	}

	/** Ruft alle Listener auf (wird vom Loader benutzt). */
	public void invoke(Consumer<? super T> call) {
		for (T listener : listeners) call.accept(listener);
	}
}
