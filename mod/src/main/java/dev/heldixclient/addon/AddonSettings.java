package dev.heldixclient.addon;

import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.module.Setting;

import java.util.List;
import java.util.function.IntSupplier;

/** Gemeinsame Hilfen für die Einstellungen der Addon-Module (API 2). */
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

	static Setting.Action action(LoadedAddon addon, String module, String label, String description, String button, Runnable action) {
		return new Setting.Action(label, text(description), button, () -> {
			if (!addon.isActive()) return;
			try {
				action.run();
			} catch (Throwable t) {
				AddonManager.reportError(addon, "Einstellung „" + label + "“ in " + module, t);
			}
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
}
