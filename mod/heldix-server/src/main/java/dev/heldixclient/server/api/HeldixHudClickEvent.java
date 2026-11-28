package dev.heldixclient.server.api;

import org.bukkit.entity.Player;
import org.bukkit.event.HandlerList;
import org.bukkit.event.player.PlayerEvent;

/**
 * Ein Spieler hat ein HUD-Element mit {@link HudElement#clickable(boolean) clickable(true)} angeklickt (bei offenem Chat
 * bzw. mit der Taste „HUD bedienen“). Höchstens vier je Sekunde und Spieler, im Hauptthread. Nur für Elemente, die dieser
 * Spieler gerade hat.
 */
public class HeldixHudClickEvent extends PlayerEvent {
	private static final HandlerList HANDLERS = new HandlerList();
	private final String elementId;

	public HeldixHudClickEvent(Player player, String elementId) {
		super(player);
		this.elementId = elementId;
	}

	/** ID des angeklickten Elements */
	public String elementId() {
		return elementId;
	}

	@Override
	public HandlerList getHandlers() {
		return HANDLERS;
	}

	public static HandlerList getHandlerList() {
		return HANDLERS;
	}
}
