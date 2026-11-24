package dev.heldixclient.loader.api.event;

import net.minecraft.network.chat.Component;

/** Empfangene Chat-Nachrichten. */
public final class ChatEvents {
	@FunctionalInterface
	public interface Receive {
		/**
		 * @param message    die Nachricht
		 * @param fromPlayer true bei Spieler-Chat, false bei System-/Servernachrichten
		 */
		void onMessage(Component message, boolean fromPlayer);
	}

	/** Eine Nachricht kommt im Chat an (nicht für Actionbar-Texte und nicht für eigene Client-Meldungen). */
	public static final Event<Receive> RECEIVE = new Event<>();

	private ChatEvents() {
	}
}
