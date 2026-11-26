package dev.heldixclient.addon;

import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.hud.HudPointer;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleFunction;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/** HUD-Modul aus einem Addon. */
final class AddonHudModule extends HudModule implements ModuleHandle {
	private final LoadedAddon addon;
	private final HudRenderer renderer;
	private final List<ToggleListener> listeners = new ArrayList<>();
	private final List<Setting> custom = new ArrayList<>();
	/** Stil-Optionen (API 5): im Rechtsklick-Menü des HUD-Editors */
	private final List<Setting> style = new ArrayList<>();
	private final String icon;

	AddonHudModule(LoadedAddon addon, ModuleSpec spec, HudRenderer renderer) {
		super(addon.metadata.id + ":" + spec.id(), spec.name(), spec.description(), spec.enabledByDefault(), spec.defaultX(), spec.defaultY());
		this.addon = addon;
		this.renderer = renderer;
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
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		AddonCanvas canvas = new AddonCanvas(g, mc.font, x, y, isPreviewing(), this);
		try {
			renderer.render(canvas);
		} catch (Throwable t) {
			AddonManager.reportError(addon, "HUD-Modul " + name(), t);
		} finally {
			canvas.finish();
		}
		return size(Math.max(canvas.width(), 4), Math.max(canvas.height(), 4));
	}

	// --- Bedienen (API 5) ---------------------------------------------------------------------

	boolean canvasInteractive() {
		return interactive();
	}

	boolean canvasHovered(float x, float y, float w, float h) {
		return hovered(x, y, w, h);
	}

	@Override
	public void onHover(Minecraft mc, HudPointer pointer) {
		if (!addon.isActive()) return;
		try {
			renderer.onHover(pointer);
		} catch (Throwable t) {
			AddonManager.reportError(addon, "Tooltip von " + name(), t);
		}
	}

	@Override
	public boolean onClick(Minecraft mc, HudPointer pointer) {
		if (!addon.isActive()) return false;
		boolean[] consumed = {false};
		// ein Klick ist eine Aktion des Spielers: Chat an den Server ist einmal erlaubt
		AddonManager.userAction(addon, "Klick auf " + name(), () -> consumed[0] = renderer.onClick(pointer));
		if (consumed[0]) HudInteraction.action(id() + ":" + (pointer.hotspot().isEmpty() ? "click" : pointer.hotspot()));
		return consumed[0];
	}

	@Override
	public List<Setting> styleOptions() {
		List<Setting> options = super.styleOptions();
		options.addAll(style);
		return options;
	}

	@Override
	public BooleanSupplier addStyleToggle(String key, String label, boolean defaultValue) {
		Setting.Toggle toggle = toggle(AddonSettings.key(key), label, "", defaultValue);
		custom.add(toggle);
		style.add(toggle);
		return toggle.get();
	}

	@Override
	public IntSupplier addStyleChoice(String key, String label, List<String> options, int defaultIndex) {
		AddonSettings.checkOptions(options);
		Setting.Choice choice = choice(AddonSettings.key(key), label, "", List.copyOf(options), Math.clamp(defaultIndex, 0, options.size() - 1));
		custom.add(choice);
		style.add(choice);
		return AddonSettings.clamped(choice, options.size());
	}

	@Override
	public IntSupplier addStyleColor(String key, String label, int defaultColor) {
		Setting.Color color = color(AddonSettings.key(key), label, "", defaultColor);
		custom.add(color);
		style.add(color);
		return color.get();
	}

	// --- Tasten im Untermenü (API 6) -------------------------------------------------------------

	private final List<Setting> keys = new ArrayList<>();

	@Override
	public dev.heldixclient.api.KeyHandle addKey(String key, String label, String description, int defaultKey, Runnable onPress) {
		AddonContext.AddonKey handle = AddonContext.createKey(addon, addon.name(), key, label, defaultKey, onPress);
		keys.add(new Setting.Key(label == null || label.isBlank() ? key : label, AddonSettings.text(description), handle.mapping()));
		return handle;
	}

	@Override
	public void showKey(dev.heldixclient.api.KeyHandle key, String label, String description) {
		if (!(key instanceof AddonContext.AddonKey handle)) throw new IllegalArgumentException("showKey braucht eine Taste aus api.registerKey");
		keys.add(new Setting.Key(label == null || label.isBlank() ? handle.mapping().getName() : label, AddonSettings.text(description), handle.mapping()));
	}

	@Override
	public List<Setting> keys() {
		List<Setting> list = new ArrayList<>(keys);
		list.addAll(super.keys());
		return list;
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

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.addAll(0, custom);
		return settings;
	}
}
