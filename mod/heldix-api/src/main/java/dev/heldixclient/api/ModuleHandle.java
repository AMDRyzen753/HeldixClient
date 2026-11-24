package dev.heldixclient.api;

/** Zugriff auf ein registriertes Modul. */
public interface ModuleHandle {
	boolean isEnabled();

	void setEnabled(boolean enabled);

	/** Wird aufgerufen, wenn der Spieler das Modul im Heldix-Menü umschaltet. */
	void onToggle(ToggleListener listener);

	@FunctionalInterface
	interface ToggleListener {
		void onToggle(boolean enabled);
	}
}
