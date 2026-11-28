package dev.heldixclient.social;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.ui.Ui;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

/**
 * Das Heldix-Symbol (Abzeichen) als Schriftzeichen, erzeugt von launcher/scripts/render-ui-assets.mjs. Als Text
 * funktioniert es überall, wo Minecraft Namen zeigt: Tab-Liste und Namensschild über dem Kopf. Je Rolle ein Zeichen:
 * gleiche Sechseck-Form wie das Logo, eigene Farbe und eigenes Symbol darin.
 *
 * <p>Jede Rolle steht in allen Schriften: {@code heldixclient:badge_1} bis {@code badge_7} sind 8 · n Pixel hoch und
 * passen genau zur GUI-Skalierung n (ein Texel je Bildpunkt, scharf in der Tab-Liste); {@code heldixclient:badge}
 * ist 64 Pixel hoch (Namensschild aus der Nähe). Breite 7, Vorschub 8 – in jeder Schrift gleich.
 */
public final class Badge {
	/** Heldix-Symbol für alle HeldixClient-Spieler (blau, „H“) */
	public static final String CHAR = "";
	/** Größte Stufe: die Schrift heldixclient:badge (64 Pixel hoch) */
	public static final int MAX_SCALE = 8;
	private static final FontDescription[] FONTS = new FontDescription[MAX_SCALE + 1];

	/** Woher eine Rolle kommt (zweite Zeile im Tooltip) */
	public enum Group {
		PLAYER("Spielt mit HeldixClient"),
		TEAM("HeldixClient-Team"),
		COMMUNITY("Community-Abzeichen"),
		ADDON("Hat ein Addon im Heldix-Store");

		private final String label;

		Group(String label) {
			this.label = label;
		}

		public String label() {
			return label;
		}
	}

	/**
	 * Rolle, die der Heldix-Dienst beim Nachschlagen meldet ({@code badge}, siehe docs/dienst.md). Der Dienst meldet
	 * höchstens eine: Team-Rolle (nur mit öffentlichem Teamprofil) vor Community-Abzeichen vor Addon-Entwickler.
	 * Die Namen der Konstanten folgen den Werten; Zeichen und Farben kommen aus render-ui-assets.mjs.
	 */
	public enum Role {
		/** HeldixClient-Spieler ohne besondere Rolle, auch für unbekannte Werte (neuere Dienste): blau, „H“ */
		PLAYER("", null, "HeldixClient-Spieler", Group.PLAYER),
		/** Team-Admin: rot, Krone */
		ADMIN("", "admin", "Team-Admin", Group.TEAM),
		/** Entwickler im Team: Indigo, Zahnrad mit Schraubenschlüssel ({@code developer} ist der Addon-Entwickler) */
		TEAM_DEVELOPER("", "developer-team", "Entwickler", Group.TEAM),
		/** Moderator: grün, Schild */
		MODERATOR("", "moderator", "Moderator", Group.TEAM),
		/** Supporter: himmelblau, Headset */
		SUPPORTER("", "supporter", "Supporter", Group.TEAM),
		/** Designer: pink, Pinsel */
		DESIGNER("", "designer", "Designer", Group.TEAM),
		/** Tester: bernstein, Kolben mit Haken */
		TESTER("", "tester", "Tester", Group.TEAM),
		/** Partner (Community-Abzeichen): türkis, Handschlag */
		PARTNER("", "partner", "Partner", Group.COMMUNITY),
		/** Creator (Community-Abzeichen): orange, Play-Knopf */
		CREATOR("", "creator", "Creator", Group.COMMUNITY),
		/** Botschafter (Community-Abzeichen): gold, Stern */
		AMBASSADOR("", "ambassador", "Botschafter", Group.COMMUNITY),
		/** hat ein veröffentlichtes Community-Addon im Addon-Store: violett, „</>“ */
		DEVELOPER("", "developer", "Addon-Entwickler", Group.ADDON);

		private final String glyph;
		private final String key;
		private final String label;
		private final Group group;
		private Component tooltip;

		Role(String glyph, String key, String label, Group group) {
			this.glyph = glyph;
			this.key = key;
			this.label = label;
			this.group = group;
		}

		/** Zeichen in den Schriften heldixclient:badge* */
		public String glyph() {
			return glyph;
		}

		/** Wert von {@code badge} beim Dienst (null bei PLAYER) */
		public String key() {
			return key;
		}

		/** Bezeichnung für Spieler, z. B. „Moderator“ */
		public String label() {
			return label;
		}

		public Group group() {
			return group;
		}

		/** Tooltip: Bezeichnung und darunter grau, woher sie kommt */
		public Component tooltip() {
			if (tooltip == null) {
				tooltip = Component.literal(label).append(Component.literal("\n" + group.label()).withStyle(ChatFormatting.GRAY));
			}
			return tooltip;
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

	/** Schrift für n Bildpunkte je GUI-Pixel (1–7: heldixclient:badge_n, ab 8: heldixclient:badge) */
	static FontDescription font(int scale) {
		int s = Math.clamp(scale, 1, MAX_SCALE);
		if (FONTS[s] == null) FONTS[s] = new FontDescription.Resource(HeldixClient.id(s == MAX_SCALE ? "badge" : "badge_" + s));
		return FONTS[s];
	}

	/** Das normale Heldix-Symbol allein (passend zur GUI-Skalierung) */
	public static MutableComponent symbol() {
		return symbol(Role.PLAYER);
	}

	/** Symbol einer Rolle allein, passend zur GUI-Skalierung (Tab-Liste und andere Oberflächen) */
	public static MutableComponent symbol(Role role) {
		return symbol(role, Ui.scale());
	}

	/**
	 * Symbol einer Rolle allein in der Schrift für {@code scale} Bildpunkte je Pixel: weiß (das Bild bringt seine Farben
	 * selbst mit), damit Teamfarben von Servern es nicht einfärben. Durchsichtigkeit (z. B. beim Schleichen) kommt
	 * weiter von Minecraft. Wo Minecraft Tooltips von Text zeigt (z. B. im Chat), erscheint die Bezeichnung der Rolle.
	 */
	public static MutableComponent symbol(Role role, int scale) {
		return Component.literal(role.glyph()).withStyle(Style.EMPTY.withFont(font(scale)).withColor(0xFFFFFF)
				.withHoverEvent(new HoverEvent.ShowText(role.tooltip())));
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
		return prefix(name, role, Ui.scale());
	}

	/** Wie {@link #prefix(Component, Role)} mit der Schrift für {@code scale} Bildpunkte je Pixel */
	public static Component prefix(Component name, Role role, int scale) {
		return Component.empty().append(symbol(role, scale)).append(Component.literal(" ")).append(name);
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
