package dev.heldixclient.server.api;

import org.bukkit.entity.Player;
import org.bukkit.event.HandlerList;
import org.bukkit.event.player.PlayerEvent;

/**
 * Ein Spieler mit HeldixClient hat sich auf dem Kanal gemeldet ({@code hello}) – einmal je Betreten des Servers, kurz nach
 * dem {@code PlayerJoinEvent}. Ab jetzt erreichen ihn HUD-Elemente, Einblendungen und Regeln. Im Hauptthread.
 *
 * <pre>{@code
 * @EventHandler
 * public void onHeldix(HeldixPlayerJoinEvent event) {
 *     getLogger().info(event.getPlayer().getName() + " spielt mit HeldixClient " + event.client().version());
 * }
 * }</pre>
 */
public class HeldixPlayerJoinEvent extends PlayerEvent {
	private static final HandlerList HANDLERS = new HandlerList();
	private final HeldixClientInfo client;

	public HeldixPlayerJoinEvent(Player player, HeldixClientInfo client) {
		super(player);
		this.client = client;
	}

	/** Version, API-Stufe und Sprache des Clients */
	public HeldixClientInfo client() {
		return client;
	}

	@Override
	public HandlerList getHandlers() {
		return HANDLERS;
	}

	public static HandlerList getHandlerList() {
		return HANDLERS;
	}
}
