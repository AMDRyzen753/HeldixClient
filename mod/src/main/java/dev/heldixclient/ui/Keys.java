package dev.heldixclient.ui;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.util.Util;

/**
 * Tastenkürzel so, wie das System sie schreibt und meint. Windows und Linux: „Strg+K“, „Strg+Klick“; macOS: „⌘K“,
 * „⌘-Klick“, „⇧⌘Z“ (Reihenfolge wie bei Apple: ⌃ ⌥ ⇧ ⌘).
 *
 * <p>Auf dem Mac ist ⌘ die Kürzel-Taste: Minecraft meldet sie in {@link InputWithModifiers#hasControlDownWithQuirk()}
 * (InputQuirks.EDIT_SHORTCUT_KEY_MODIFIER), während {@code hasControlDown()} dort nur die echte Ctrl-Taste (⌃) prüft.
 * Ctrl+Klick wird auf dem Mac außerdem zum Rechtsklick (Option „Ctrl+Klick = Rechtsklick“), deshalb kopiert dort
 * ⌘-Klick. Ausnahme ⌃Tab: ⌘Tab gehört auf dem Mac dem System (Programmwechsel), der Reiterwechsel bleibt bei ⌃.
 *
 * <p>Die Texte gibt es auch mit ausdrücklichem System ({@code mac}-Parameter), damit sie ohne Mac prüfbar sind.
 */
public final class Keys {
	/** Läuft das Spiel auf einem Mac? (einmal beim Laden ermittelt) */
	public static final boolean MAC = Util.getPlatform() == Util.OS.OSX;

	private Keys() {
	}

	/** Kürzel mit der Kürzel-Taste: „Strg+K“ bzw. „⌘K“ */
	public static String shortcut(String key) {
		return shortcut(key, MAC);
	}

	public static String shortcut(String key, boolean mac) {
		return mac ? "⌘" + key : "Strg+" + key;
	}

	/** mit Umschalt: „Strg+Umschalt+Z“ bzw. „⇧⌘Z“ */
	public static String shortcutShift(String key) {
		return shortcutShift(key, MAC);
	}

	public static String shortcutShift(String key, boolean mac) {
		return mac ? "⇧⌘" + key : "Strg+Umschalt+" + key;
	}

	/** echte Ctrl-Taste (auch auf dem Mac): „Strg+Tab“ bzw. „⌃Tab“ */
	public static String control(String key) {
		return control(key, MAC);
	}

	public static String control(String key, boolean mac) {
		return mac ? "⌃" + key : "Strg+" + key;
	}

	/** Wiederholen: „Strg+Y“ bzw. „⇧⌘Z“ (so wie auf dem jeweiligen System üblich; beides funktioniert überall) */
	public static String redo() {
		return MAC ? shortcutShift("Z", true) : shortcut("Y", false);
	}

	/** „Strg+Klick“ bzw. „⌘-Klick“ */
	public static String click() {
		return click(MAC);
	}

	public static String click(boolean mac) {
		return mac ? "⌘-Klick" : "Strg+Klick";
	}

	/** Name der Kürzel-Taste im Satz: „Strg-Taste“ bzw. „⌘-Taste“ */
	public static String modifierKey() {
		return MAC ? "⌘-Taste" : "Strg-Taste";
	}

	/** Alt-Taste: „Alt“ bzw. „⌥“ */
	public static String alt() {
		return MAC ? "⌥" : "Alt";
	}

	/**
	 * Kürzel-Taste im Ereignis gedrückt? Mac: ⌘ (oder ⌃), sonst Strg. Für Tastenkürzel wie Rückgängig – so funktionieren
	 * auf dem Mac sowohl ⌘Z als auch ⌃Z, auf Windows und Linux nur Strg+Z.
	 */
	public static boolean shortcutDown(InputWithModifiers event) {
		return event.hasControlDownWithQuirk() || event.hasControlDown();
	}

	/**
	 * Kürzel-Taste gerade gehalten (ohne Ereignis, z. B. beim Zeichnen oder in einem Klick-Hook)? Mac: ⌘ (die Ctrl-Taste
	 * macht dort aus dem Klick einen Rechtsklick), sonst Strg.
	 */
	public static boolean shortcutHeld() {
		if (MAC) return InputConstants.isKeyDown(InputConstants.KEY_LGUI) || InputConstants.isKeyDown(InputConstants.KEY_RGUI);
		return Minecraft.getInstance().hasControlDown();
	}

	/** Klick mit der Kürzel-Taste (⌘-Klick bzw. Strg+Klick)? Mac nimmt ⌘ aus den Modifikatoren des Klicks. */
	public static boolean shortcutClick(InputWithModifiers event) {
		return MAC ? event.hasControlDownWithQuirk() : event.hasControlDown();
	}
}
