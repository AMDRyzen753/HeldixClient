package dev.heldixclient.server.api;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Ein HUD-Element für HeldixClient: Text, Fortschrittsbalken oder Liste, gezeichnet im HUD-Stil des Spielers. Unveränderlich;
 * die Methoden geben ein neues Element zurück.
 *
 * <pre>{@code
 * HudElement.ofText("info").anchor(HudAnchor.TOP_RIGHT).title("Event").text("Beginnt in 5 Minuten").color(0x22C55E);
 * HudElement.ofProgress("tore").anchor(HudAnchor.TOP).title("Rot gegen Blau").text("3 : 2").value(0.6);
 * HudElement.ofList("team").anchor(HudAnchor.RIGHT).title("Team Rot").lines(List.of("Alex", "Steve"));
 * }</pre>
 *
 * <p>Grenzen (Vertrag des Kanals): ID {@code [a-z0-9_-]{1,24}}, Titel ≤ 40, Text ≤ 120, höchstens 10 Zeilen zu je ≤ 80
 * Zeichen, Wert 0 bis 1, Farbe als RGB. §-Farbcodes und Steuerzeichen werden entfernt, zu lange Texte gekürzt.
 */
public final class HudElement {
	/** Art des Elements */
	public enum Type {
		TEXT("text"), PROGRESS("progress"), LIST("list");

		private final String id;

		Type(String id) {
			this.id = id;
		}

		public String id() {
			return id;
		}
	}

	private static final Pattern ID = Pattern.compile("[a-z0-9_-]{1,24}");

	private final String id;
	private final Type type;
	private final HudAnchor anchor;
	private final String title;
	private final String text;
	private final List<String> lines;
	private final double value;
	private final Integer color;
	private final boolean clickable;

	private HudElement(String id, Type type, HudAnchor anchor, String title, String text, List<String> lines, double value, Integer color,
			boolean clickable) {
		this.id = id;
		this.type = type;
		this.anchor = anchor;
		this.title = title;
		this.text = text;
		this.lines = lines;
		this.value = value;
		this.color = color;
		this.clickable = clickable;
	}

	private static HudElement create(String id, Type type) {
		if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("ID nur a-z, 0-9, _ und -, höchstens 24 Zeichen: " + id);
		return new HudElement(id, type, HudAnchor.TOP_RIGHT, "", "", List.of(), 0, null, false);
	}

	/** Titel und Text (bis zu drei Zeilen, umbrochen) */
	public static HudElement ofText(String id) {
		return create(id, Type.TEXT);
	}

	/** Titel, optional Text, darunter ein Balken ({@link #value(double)}) */
	public static HudElement ofProgress(String id) {
		return create(id, Type.PROGRESS);
	}

	/** Titel und bis zu 10 Zeilen ({@link #lines(List)}) */
	public static HudElement ofList(String id) {
		return create(id, Type.LIST);
	}

	public HudElement anchor(HudAnchor anchor) {
		return new HudElement(id, type, Objects.requireNonNull(anchor, "anchor"), title, text, lines, value, color, clickable);
	}

	public HudElement title(String title) {
		return new HudElement(id, type, anchor, Texts.clean(title, 40), text, lines, value, color, clickable);
	}

	public HudElement text(String text) {
		return new HudElement(id, type, anchor, title, Texts.clean(text, 120), lines, value, color, clickable);
	}

	public HudElement lines(List<String> lines) {
		List<String> clean = new ArrayList<>();
		if (lines != null) {
			for (String line : lines) {
				if (clean.size() >= 10) break;
				clean.add(Texts.clean(line, 80));
			}
		}
		return new HudElement(id, type, anchor, title, text, List.copyOf(clean), value, color, clickable);
	}

	/** Fortschritt von 0 bis 1 (nur bei {@link Type#PROGRESS}; außerhalb wird begrenzt) */
	public HudElement value(double value) {
		double clamped = Double.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
		return new HudElement(id, type, anchor, title, text, lines, clamped, color, clickable);
	}

	/** Akzentfarbe (Titel, Balken) als RGB, z. B. 0x22C55E */
	public HudElement color(int rgb) {
		return new HudElement(id, type, anchor, title, text, lines, value, rgb & 0xFFFFFF, clickable);
	}

	/** ohne eigene Farbe (die Akzentfarbe des Spielers) */
	public HudElement defaultColor() {
		return new HudElement(id, type, anchor, title, text, lines, value, null, clickable);
	}

	/**
	 * Anklickbar: Bei offenem Chat (oder mit der Taste „HUD bedienen“) kann der Spieler das Element anklicken; das Plugin
	 * meldet das als {@link HeldixHudClickEvent}.
	 */
	public HudElement clickable(boolean clickable) {
		return new HudElement(id, type, anchor, title, text, lines, value, color, clickable);
	}

	public String id() {
		return id;
	}

	public Type type() {
		return type;
	}

	public HudAnchor anchor() {
		return anchor;
	}

	public String title() {
		return title;
	}

	public String text() {
		return text;
	}

	public List<String> lines() {
		return lines;
	}

	public double value() {
		return value;
	}

	/** RGB oder null (Akzentfarbe des Spielers) */
	public Integer color() {
		return color;
	}

	public boolean clickable() {
		return clickable;
	}
}
