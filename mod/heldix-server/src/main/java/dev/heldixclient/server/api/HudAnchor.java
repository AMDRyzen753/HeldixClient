package dev.heldixclient.server.api;

/** Stelle eines HUD-Elements am Bildschirm (unten in der Mitte liegt die Hotbar, dort gibt es keinen Platz). */
public enum HudAnchor {
	TOP_LEFT("top_left"),
	/** oben in der Mitte, unter den Bossleisten */
	TOP("top"),
	TOP_RIGHT("top_right"),
	LEFT("left"),
	RIGHT("right"),
	BOTTOM_LEFT("bottom_left"),
	BOTTOM_RIGHT("bottom_right");

	private final String id;

	HudAnchor(String id) {
		this.id = id;
	}

	/** Name im Protokoll, z. B. "top_right" */
	public String id() {
		return id;
	}
}
