package dev.heldixclient.addon;

import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Ui;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleFunction;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/** Modul ohne HUD aus einem Addon (an/aus, ab API 2 mit eigenen Einstellungen). */
final class AddonToggleModule extends Module implements ModuleHandle {
	private final LoadedAddon addon;
	private final List<ToggleListener> listeners = new ArrayList<>();
	private final List<Setting> custom = new ArrayList<>();
	private final String icon;

	AddonToggleModule(LoadedAddon addon, ModuleSpec spec) {
		super(addon.metadata.id + ":" + spec.id(), spec.name(), spec.description(), spec.enabledByDefault(), 0, 0);
		this.addon = addon;
		this.icon = spec.icon();
	}

	@Override
	public String source() {
		return addon.name();
	}

	@Override
	public String icon() {
		return icon != null && Ui.hasIcon(icon) ? icon : super.icon();
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
		AddonSettings.notifyToggle(addon, name(), listeners, true);
	}

	@Override
	protected void onDisable() {
		AddonSettings.notifyToggle(addon, name(), listeners, false);
	}

	// --- Einstellungen (API 2) ----------------------------------------------------------------

	@Override
	public BooleanSupplier addToggle(String key, String label, String description, boolean defaultValue) {
		Setting.Toggle toggle = toggle(AddonSettings.key(key), label, AddonSettings.text(description), defaultValue);
		custom.add(toggle);
		return toggle.get();
	}

	@Override
	public IntSupplier addChoice(String key, String label, String description, List<String> options, int defaultIndex) {
		AddonSettings.checkOptions(options);
		Setting.Choice choice = choice(AddonSettings.key(key), label, AddonSettings.text(description), List.copyOf(options), defaultIndex);
		custom.add(choice);
		return AddonSettings.clamped(choice, options.size());
	}

	@Override
	public void addAction(String label, String description, String button, Runnable action) {
		custom.add(AddonSettings.action(addon, name(), label, description, button, action));
	}

	// --- Einstellungen (API 3) ----------------------------------------------------------------

	@Override
	public DoubleSupplier addSlider(String key, String label, String description, double min, double max, double step, double defaultValue) {
		return addSlider(key, label, description, min, max, step, defaultValue, null);
	}

	@Override
	public DoubleSupplier addSlider(String key, String label, String description, double min, double max, double step, double defaultValue,
			DoubleFunction<String> format) {
		AddonSettings.checkRange(min, max, step);
		Setting.Slider slider = slider(AddonSettings.key(key), label, AddonSettings.text(description), min, max, step, Math.clamp(defaultValue, min, max),
				AddonSettings.format(addon, name(), label, step, format));
		custom.add(slider);
		return AddonSettings.snapped(slider);
	}

	@Override
	public IntSupplier addColor(String key, String label, String description, int defaultColor) {
		Setting.Color color = color(AddonSettings.key(key), label, AddonSettings.text(description), defaultColor);
		custom.add(color);
		return color.get();
	}

	@Override
	public Supplier<String> addText(String key, String label, String description, String defaultValue, int maxLength) {
		Setting.Text text = text(AddonSettings.key(key), label, AddonSettings.text(description), AddonSettings.text(defaultValue),
				AddonSettings.maxLength(maxLength));
		custom.add(text);
		return text.get();
	}

	// --- Stil-Optionen (API 5): ohne HUD-Element nur im Untermenü ------------------------------

	@Override
	public BooleanSupplier addStyleToggle(String key, String label, boolean defaultValue) {
		return addToggle(key, label, "", defaultValue);
	}

	@Override
	public IntSupplier addStyleChoice(String key, String label, List<String> options, int defaultIndex) {
		return addChoice(key, label, "", options, defaultIndex);
	}

	@Override
	public IntSupplier addStyleColor(String key, String label, int defaultColor) {
		return addColor(key, label, "", defaultColor);
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.addAll(custom);
		return settings;
	}
}
