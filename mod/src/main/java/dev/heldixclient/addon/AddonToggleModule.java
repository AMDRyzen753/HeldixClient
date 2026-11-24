package dev.heldixclient.addon;

import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.module.Module;

import java.util.ArrayList;
import java.util.List;

/** Modul ohne HUD aus einem Addon (nur an/aus). */
final class AddonToggleModule extends Module implements ModuleHandle {
	private final LoadedAddon addon;
	private final List<ToggleListener> listeners = new ArrayList<>();

	AddonToggleModule(LoadedAddon addon, ModuleSpec spec) {
		super(addon.metadata.id + ":" + spec.id(), spec.name(), spec.description(), spec.enabledByDefault(), 0, 0);
		this.addon = addon;
	}

	@Override
	public String source() {
		return addon.name();
	}

	@Override
	public boolean isEnabled() {
		return addon.isActive() && super.isEnabled();
	}

	@Override
	public void onToggle(ToggleListener listener) {
		listeners.add(listener);
	}

	@Override
	protected void onEnable() {
		notifyListeners(true);
	}

	@Override
	protected void onDisable() {
		notifyListeners(false);
	}

	private void notifyListeners(boolean enabled) {
		for (ToggleListener listener : listeners) {
			try {
				listener.onToggle(enabled);
			} catch (Throwable t) {
				AddonManager.reportError(addon, "onToggle " + name(), t);
			}
		}
	}
}
