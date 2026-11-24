package dev.heldixclient.api;

import java.util.function.Consumer;

/** Ereignisse, auf die ein Addon reagieren kann. Alle Listener laufen im Haupt-Thread des Spiels. */
public interface HeldixEvents {
	/** 20-mal pro Sekunde (jeden Client-Tick). */
	void onTick(Runnable listener);

	/** Beim Betreten einer Welt oder eines Servers. */
	void onWorldJoin(Runnable listener);

	/** Beim Verlassen einer Welt oder eines Servers. */
	void onWorldLeave(Runnable listener);

	/** Bei jeder empfangenen Chat- oder Systemnachricht (als reiner Text). */
	void onChatMessage(Consumer<String> listener);
}
