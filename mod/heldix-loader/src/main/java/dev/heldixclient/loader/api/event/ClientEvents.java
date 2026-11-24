package dev.heldixclient.loader.api.event;

import net.minecraft.client.Minecraft;

/** Ereignisse des Clients: Tick und Beenden. */
public final class ClientEvents {
	@FunctionalInterface
	public interface Tick {
		void onTick(Minecraft minecraft);
	}

	@FunctionalInterface
	public interface Stopping {
		void onStopping(Minecraft minecraft);
	}

	/** Am Ende jedes Client-Ticks (20-mal pro Sekunde, im Hauptthread). */
	public static final Event<Tick> TICK_END = new Event<>();

	/** Minecraft wird beendet (Fenster geschlossen oder "Spiel beenden"). */
	public static final Event<Stopping> STOPPING = new Event<>();

	private ClientEvents() {
	}
}
