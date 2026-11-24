package dev.heldixclient.loader.api.event;

import net.minecraft.client.Minecraft;

/** Betreten und Verlassen einer Welt bzw. eines Servers. */
public final class WorldEvents {
	@FunctionalInterface
	public interface Join {
		void onJoin(Minecraft minecraft);
	}

	@FunctionalInterface
	public interface Leave {
		void onLeave(Minecraft minecraft);
	}

	/** Welt oder Server betreten (Einzelspieler und Mehrspieler). */
	public static final Event<Join> JOIN = new Event<>();

	/** Welt oder Server verlassen. */
	public static final Event<Leave> LEAVE = new Event<>();

	private WorldEvents() {
	}
}
