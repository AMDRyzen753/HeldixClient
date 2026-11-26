package dev.heldixclient.social;

import dev.heldixclient.HeldixClient;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

/**
 * Das Heldix-Symbol als Schriftzeichen in der Schrift heldixclient:badge (erzeugt von
 * launcher/scripts/render-ui-assets.mjs). Als Text funktioniert es überall, wo Minecraft Namen zeigt: Tab-Liste und
 * Namensschild über dem Kopf. Je Rolle ein eigenes Zeichen: gleiche Sechseck-Form, eigene Farbe und eigenes Zeichen
 * darin.
 */
public final class Badge {
	/** Heldix-Symbol für alle HeldixClient-Spieler (blau, „H“) */
	public static final String CHAR = "";
	private static final FontDescription FONT = new FontDescription.Resource(HeldixClient.id("badge"));

	/** Rolle, die der Heldix-Dienst beim Nachschlagen meldet ({@code badge}) */
	public enum Role {
		/** HeldixClient-Spieler ohne besondere Rolle */
		PLAYER("", null, "HeldixClient-Spieler"),
		/** Team-Admin (nur mit öffentlichem Teamprofil): rot, Krone */
		ADMIN("", "admin", "Team-Admin"),
		/** Moderator (nur mit öffentlichem Teamprofil): grün, Schild */
		MODERATOR("", "moderator", "Moderator"),
		/** hat ein veröffentlichtes Community-Addon im Addon-Store: violett, „</>“ */
		DEVELOPER("", "developer", "Addon-Entwickler");

		private final String glyph;
		private final String key;
		private final String label;

		Role(String glyph, String key, String label) {
			this.glyph = glyph;
			this.key = key;
			this.label = label;
		}

		/** Zeichen in der Schrift heldixclient:badge */
		public String glyph() {
			return glyph;
		}

		/** Bezeichnung für Spieler, z. B. „Moderator“ */
		public String label() {
			return label;
		}

		/** Wert von {@code badge} aus der Antwort des Dienstes; null oder Unbekanntes = normaler HeldixClient-Spieler */
		public static Role of(String badge) {
			if (badge != null) {
				for (Role role : values()) {
					if (badge.equals(role.key)) return role;
				}
			}
			return PLAYER;
		}
	}

	private Badge() {
	}

	/** Das normale Heldix-Symbol allein */
	public static MutableComponent symbol() {
		return symbol(Role.PLAYER);
	}

	/**
	 * Das Symbol einer Rolle allein: weiß (das Bild bringt seine Farben selbst mit), damit Teamfarben von Servern es
	 * nicht einfärben. Durchsichtigkeit (z. B. beim Schleichen) kommt weiter von Minecraft.
	 */
	public static MutableComponent symbol(Role role) {
		return Component.literal(role.glyph()).withStyle(Style.EMPTY.withFont(FONT).withColor(0xFFFFFF));
	}

	/** Symbol + Leerzeichen + Name */
	public static Component prefix(Component name) {
		return prefix(name, Role.PLAYER);
	}

	/**
	 * Symbol der Rolle + Leerzeichen + Name. Der Name bleibt unverändert (Teamfarbe, Präfix des Servers); das Symbol
	 * steht davor, außerhalb seiner Formatierung.
	 */
	public static Component prefix(Component name, Role role) {
		return Component.empty().append(symbol(role)).append(Component.literal(" ")).append(name);
	}

	/** Steht das Heldix-Symbol (einer beliebigen Rolle) am Anfang dieses Textes? */
	public static Role roleAtStart(Component text) {
		if (text == null) return null;
		String plain = text.getString();
		if (plain.isEmpty()) return null;
		String first = plain.substring(0, 1);
		for (Role role : Role.values()) {
			if (role.glyph().equals(first)) return role;
		}
		return null;
	}
}
