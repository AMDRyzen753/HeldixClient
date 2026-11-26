package dev.heldixclient.addon;

import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.module.Setting;

import java.util.List;
import java.util.Locale;
import java.util.function.DoubleFunction;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;

/** Gemeinsame Hilfen für die Einstellungen der Addon-Module (API 2 und 3). */
final class AddonSettings {
	private AddonSettings() {
	}

	/** Schlüssel in den Moduloptionen; eigener Präfix, damit z. B. "scale" nicht überschrieben wird */
	static String key(String key) {
		if (key == null || !key.matches("[a-z0-9_.-]+")) {
			throw new IllegalArgumentException("Einstellungs-Schlüssel darf nur a-z, 0-9, _, . und - enthalten: " + key);
		}
		return "addon." + key;
	}

	static String text(String text) {
		return text != null ? text : "";
	}

	static void checkOptions(List<String> options) {
		if (options == null || options.isEmpty()) throw new IllegalArgumentException("Auswahl ohne Möglichkeiten");
	}

	static IntSupplier clamped(Setting.Choice choice, int size) {
		return () -> Math.clamp(choice.get().getAsInt(), 0, size - 1);
	}

	/** Knopf eines Addons: läuft als Aktion des Spielers (Chat an den Server erlaubt) */
	static Setting.Action action(LoadedAddon addon, String module, String label, String description, String button, Runnable action) {
		return new Setting.Action(label, text(description), button, () -> {
			if (!addon.isActive()) return;
			AddonManager.userAction(addon, "Einstellung „" + label + "“ in " + module, action);
		});
	}

	static void notifyToggle(LoadedAddon addon, String module, List<ModuleHandle.ToggleListener> listeners, boolean enabled) {
		for (ModuleHandle.ToggleListener listener : listeners) {
			try {
				listener.onToggle(enabled);
			} catch (Throwable t) {
				AddonManager.reportError(addon, "onToggle " + module, t);
			}
		}
	}

	// --- API 3 --------------------------------------------------------------------------------

	static void checkRange(double min, double max, double step) {
		if (!(min < max) || !(step > 0) || Double.isInfinite(max - min)) {
			throw new IllegalArgumentException("Regler braucht min < max und step > 0: " + min + " … " + max + ", " + step);
		}
	}

	/** gespeicherter Wert, auf Bereich und Schritt gebracht (falls eine neue Addon-Version den Bereich ändert) */
	static DoubleSupplier snapped(Setting.Slider slider) {
		return () -> slider.snap(slider.get().getAsDouble());
	}

	/** Anzeige des Reglerwerts: eigener Text des Addons (Fehler zählen als Addon-Fehler) oder die Zahl */
	static DoubleFunction<String> format(LoadedAddon addon, String module, String label, double step, DoubleFunction<String> custom) {
		DoubleFunction<String> number = number(step);
		if (custom == null) return number;
		return value -> {
			if (addon.isActive()) {
				try {
					String text = custom.apply(value);
					if (text != null) return text;
				} catch (Throwable t) {
					AddonManager.reportError(addon, "Regler „" + label + "“ in " + module, t);
				}
			}
			return number.apply(value);
		};
	}

	/** so viele Nachkommastellen wie der Schritt hat (höchstens drei), deutsches Komma */
	static DoubleFunction<String> number(double step) {
		int decimals = 0;
		double scaled = step;
		while (decimals < 3 && Math.abs(scaled - Math.rint(scaled)) > 1e-9) {
			scaled *= 10;
			decimals++;
		}
		String pattern = "%." + decimals + "f";
		return value -> String.format(Locale.GERMANY, pattern, value);
	}

	static int maxLength(int maxLength) {
		return Math.clamp(maxLength, 1, 256);
	}
}
