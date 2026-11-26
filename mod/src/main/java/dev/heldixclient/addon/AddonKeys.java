package dev.heldixclient.addon;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HeldixKeys;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Übersetzt die Tastencodes der Heldix-API ({@link HeldixKeys}, feste GLFW-Werte) in die Tasten des laufenden
 * Minecraft. Seit 26.x nimmt Minecraft SDL-Scancodes (Pos1 = 74 statt 268, „keine Taste“ = 0 statt -1) – über die
 * gleich gebliebenen Namen ("key.keyboard.home") bleibt die API davon unberührt.
 */
final class AddonKeys {
	private AddonKeys() {
	}

	/** GLFW-Code → Name der Taste ohne "key.keyboard." */
	private static final Map<Integer, String> NAMES = new HashMap<>();

	static {
		NAMES.put(32, "space");
		NAMES.put(39, "apostrophe");
		NAMES.put(44, "comma");
		NAMES.put(45, "minus");
		NAMES.put(46, "period");
		NAMES.put(47, "slash");
		for (int i = 0; i <= 9; i++) NAMES.put('0' + i, String.valueOf(i));
		NAMES.put(59, "semicolon");
		NAMES.put(61, "equal");
		for (char c = 'A'; c <= 'Z'; c++) {
			String name = String.valueOf(Character.toLowerCase(c));
			NAMES.put((int) c, name);
			NAMES.put((int) Character.toLowerCase(c), name);
		}
		NAMES.put(91, "left.bracket");
		NAMES.put(92, "backslash");
		NAMES.put(93, "right.bracket");
		NAMES.put(96, "grave.accent");
		NAMES.put(256, "escape");
		NAMES.put(HeldixKeys.ENTER, "enter");
		NAMES.put(HeldixKeys.TAB, "tab");
		NAMES.put(HeldixKeys.BACKSPACE, "backspace");
		NAMES.put(HeldixKeys.INSERT, "insert");
		NAMES.put(HeldixKeys.DELETE, "delete");
		NAMES.put(HeldixKeys.RIGHT, "right");
		NAMES.put(HeldixKeys.LEFT, "left");
		NAMES.put(HeldixKeys.DOWN, "down");
		NAMES.put(HeldixKeys.UP, "up");
		NAMES.put(HeldixKeys.PAGE_UP, "page.up");
		NAMES.put(HeldixKeys.PAGE_DOWN, "page.down");
		NAMES.put(HeldixKeys.HOME, "home");
		NAMES.put(HeldixKeys.END, "end");
		NAMES.put(280, "caps.lock");
		NAMES.put(281, "scroll.lock");
		NAMES.put(282, "num.lock");
		NAMES.put(283, "print.screen");
		NAMES.put(HeldixKeys.PAUSE, "pause");
		for (int i = 0; i < 24; i++) NAMES.put(HeldixKeys.F1 + i, "f" + (i + 1));
		for (int i = 0; i <= 9; i++) NAMES.put(HeldixKeys.NUMPAD_0 + i, "keypad." + i);
		NAMES.put(330, "keypad.decimal");
		NAMES.put(HeldixKeys.NUMPAD_DIVIDE, "keypad.divide");
		NAMES.put(HeldixKeys.NUMPAD_MULTIPLY, "keypad.multiply");
		NAMES.put(HeldixKeys.NUMPAD_SUBTRACT, "keypad.subtract");
		NAMES.put(HeldixKeys.NUMPAD_ADD, "keypad.add");
		NAMES.put(HeldixKeys.NUMPAD_ENTER, "keypad.enter");
		NAMES.put(336, "keypad.equal");
		NAMES.put(HeldixKeys.LEFT_SHIFT, "left.shift");
		NAMES.put(HeldixKeys.LEFT_CONTROL, "left.control");
		NAMES.put(HeldixKeys.LEFT_ALT, "left.alt");
		NAMES.put(343, "left.win");
		NAMES.put(HeldixKeys.RIGHT_SHIFT, "right.shift");
		NAMES.put(HeldixKeys.RIGHT_CONTROL, "right.control");
		NAMES.put(HeldixKeys.RIGHT_ALT, "right.alt");
		NAMES.put(347, "right.win");
		NAMES.put(348, "menu");
	}

	/** Taste zum API-Code ({@link HeldixKeys#NONE} oder unbekannt = keine Taste) */
	static InputConstants.Key toMinecraft(int code) {
		String name = NAMES.get(code);
		if (name == null) {
			if (code != HeldixKeys.NONE) HeldixClient.LOGGER.warn("Heldix-Addons: Tastencode {} ist unbekannt – Taste bleibt frei", code);
			return InputConstants.UNKNOWN;
		}
		try {
			return InputConstants.getKey("key.keyboard." + name);
		} catch (RuntimeException e) {
			return InputConstants.UNKNOWN;
		}
	}

	/**
	 * Bis HeldixClient 0.13 landeten die GLFW-Codes ungeprüft in Minecraft (z. B. Pos1 als Scancode 268, „keine Taste“
	 * als -1, das beim nächsten Mausfang abstürzt). Steht so eine Taste noch in options.txt, wird sie einmal durch die
	 * richtige Standardtaste ersetzt.
	 */
	static void migrate(List<AddonManager.Key> keys) {
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft == null || minecraft.options == null) return;
		boolean changed = false;
		for (AddonManager.Key key : keys) {
			KeyMapping mapping = key.mapping();
			int raw = key.apiCode();
			InputConstants.Key wrong = raw == HeldixKeys.NONE ? null : InputConstants.Type.KEYBOARD.getOrCreate(raw);
			InputConstants.Key current;
			try {
				current = InputConstants.getKey(mapping.saveString());
			} catch (RuntimeException e) {
				current = null;
			}
			boolean invalid = current == null || (current.getType() == InputConstants.Type.KEYBOARD && current.getValue() < 0);
			boolean old = wrong != null && !wrong.equals(mapping.getDefaultKey()) && mapping.matches(wrong);
			if (invalid || old) {
				mapping.setKey(mapping.getDefaultKey());
				changed = true;
			}
		}
		if (changed) {
			KeyMapping.resetMapping();
			minecraft.options.save();
			HeldixClient.LOGGER.info("Heldix-Addons: alte Tastenbelegung auf die richtigen Standardtasten gesetzt");
		}
	}
}
