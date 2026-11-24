package dev.heldixclient.ui;

/** Farben des HeldixClient-Designs "Glas" (ARGB), passend zum Launcher. */
public final class Theme {
	// Akzente: Blau → Himmelblau → Cyan
	public static final int ACCENT = 0xFF38BDF8;
	public static final int ACCENT_LIGHT = 0xFF7DD3FC;
	public static final int ACCENT_SOFT = 0xFFBAE6FD;
	/** Kräftiges Blau, Anfang des Farbverlaufs (Name aus älteren Versionen beibehalten) */
	public static final int INDIGO = 0xFF2563EB;
	public static final int CYAN = 0xFF22D3EE;
	/** Zweitfarbe für Module aus Addons */
	public static final int ADDON = 0xFF34D399;

	public static final int TEXT = 0xFFFFFFFF;
	public static final int MUTED = 0xFFB9CBE6;
	public static final int FAINT = 0xFF8095B5;

	// Glasflächen: halbtransparent über dem verschwommenen Hintergrund
	public static final int PANEL = 0x990B1830;
	public static final int CARD = 0x1CFFFFFF;
	public static final int CARD_HOVER = 0x2EFFFFFF;
	public static final int CARD_ACTIVE = 0x3338BDF8;
	public static final int CARD_ACTIVE_HOVER = 0x4838BDF8;
	public static final int BORDER = 0x33FFFFFF;
	public static final int BORDER_ACCENT = 0xC07DD3FC;
	/** helle Lichtkante oben an Glasflächen */
	public static final int HIGHLIGHT = 0x44FFFFFF;
	public static final int SWITCH_OFF = 0x40FFFFFF;

	/** Hintergrund der HUD-Elemente im Spiel */
	public static final int HUD_BG = 0x99091526;

	private Theme() {
	}
}
