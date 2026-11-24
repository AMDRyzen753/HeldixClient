package dev.heldixclient.api;

/**
 * Tastencodes für {@link HeldixApi#registerKey(String, String, int, Runnable)} (dieselben Werte wie GLFW).
 * Buchstaben und Ziffern entsprechen ihrem Zeichen, z. B. {@code 'K'} oder {@code '7'}.
 *
 * @since 2
 */
public final class HeldixKeys {
	/** keine Standardtaste – der Spieler belegt sie selbst */
	public static final int NONE = -1;

	public static final int SPACE = 32;
	public static final int ENTER = 257;
	public static final int TAB = 258;
	public static final int BACKSPACE = 259;
	public static final int INSERT = 260;
	public static final int DELETE = 261;
	public static final int RIGHT = 262;
	public static final int LEFT = 263;
	public static final int DOWN = 264;
	public static final int UP = 265;
	public static final int PAGE_UP = 266;
	public static final int PAGE_DOWN = 267;
	public static final int HOME = 268;
	public static final int END = 269;
	public static final int PAUSE = 284;

	public static final int F1 = 290;
	public static final int F2 = 291;
	public static final int F3 = 292;
	public static final int F4 = 293;
	public static final int F5 = 294;
	public static final int F6 = 295;
	public static final int F7 = 296;
	public static final int F8 = 297;
	public static final int F9 = 298;
	public static final int F10 = 299;
	public static final int F11 = 300;
	public static final int F12 = 301;

	/** Ziffernblock 0–9: {@code NUMPAD_0 + n} */
	public static final int NUMPAD_0 = 320;
	public static final int NUMPAD_DIVIDE = 331;
	public static final int NUMPAD_MULTIPLY = 332;
	public static final int NUMPAD_SUBTRACT = 333;
	public static final int NUMPAD_ADD = 334;
	public static final int NUMPAD_ENTER = 335;

	public static final int LEFT_SHIFT = 340;
	public static final int LEFT_CONTROL = 341;
	public static final int LEFT_ALT = 342;
	public static final int RIGHT_SHIFT = 344;
	public static final int RIGHT_CONTROL = 345;
	public static final int RIGHT_ALT = 346;

	private HeldixKeys() {
	}
}
