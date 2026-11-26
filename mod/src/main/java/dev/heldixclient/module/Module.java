package dev.heldixclient.module;

import dev.heldixclient.config.HeldixConfig;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.List;

/** Basis für alle Client-Features, die man im Heldix-Menü an- und ausschalten kann. */
public abstract class Module {
	private final String id;
	private final String name;
	private final String description;
	protected final HeldixConfig.ModuleState state;
	/** Taste zum Ein- und Ausschalten im Spiel (null = keine, z. B. bei einem später geladenen Modul) */
	private net.minecraft.client.KeyMapping toggleKey;

	protected Module(String id, String name, String description, boolean defaultEnabled, int defaultX, int defaultY) {
		this.id = id;
		this.name = name;
		this.description = description;
		this.state = HeldixConfig.module(id, defaultEnabled, defaultX, defaultY);
	}

	public String id() {
		return id;
	}

	public String name() {
		return name;
	}

	public String description() {
		return description;
	}

	/** Name des Addons, aus dem das Modul stammt (null = eingebautes Modul). */
	public String source() {
		return null;
	}

	/** Icon im Heldix-Menü und HUD-Editor (Name aus dem Heldix-Icon-Set, siehe Ui.icon) */
	public String icon() {
		return switch (id) {
			case "fps" -> "fps";
			case "cps" -> "mouse";
			case "ping" -> "signal";
			case "coordinates" -> "compass";
			case "keystrokes" -> "keyboard";
			case "zoom" -> "zoom";
			case "armor" -> "shield";
			case "effects" -> "potion";
			case "togglesprint" -> "sprint";
			case "freelook" -> "eye";
			case "crosshair" -> "crosshair";
			case "chat" -> "chat";
			case "waypoints" -> "pin";
			default -> source() != null ? "addons" : "cube";
		};
	}

	public boolean isEnabled() {
		return state.enabled;
	}

	public void setEnabled(boolean enabled) {
		if (state.enabled == enabled) return;
		state.enabled = enabled;
		if (enabled) onEnable(); else onDisable();
		HeldixConfig.save();
	}

	public void toggle() {
		setEnabled(!isEnabled());
	}

	protected void onEnable() {
	}

	protected void onDisable() {
	}

	/** Wird jeden Client-Tick aufgerufen, auch wenn das Modul deaktiviert ist. */
	public void tick(Minecraft mc) {
	}

	/** Taste zum Ein- und Ausschalten (nicht belegt, bis der Spieler eine wählt); null = keine */
	public net.minecraft.client.KeyMapping toggleKey() {
		return toggleKey;
	}

	void setToggleKey(net.minecraft.client.KeyMapping key) {
		toggleKey = key;
	}

	/**
	 * Tasten für den Abschnitt „Tasten“ im Untermenü: die Tasten des Moduls selbst (z. B. Zoom, bei Addons über
	 * {@code addKey}) und zuletzt die Taste zum Ein- und Ausschalten. Umbelegen geht dort und unter Optionen → Steuerung.
	 */
	public List<Setting> keys() {
		List<Setting> keys = new ArrayList<>();
		if (toggleKey != null) keys.add(new Setting.Key("Ein/Aus", "Schaltet „" + name + "“ im Spiel an und aus", toggleKey));
		return keys;
	}

	/** Einstellungen für das Untermenü des Moduls im Heldix-Menü (leer = kein Untermenü). */
	public List<Setting> settings() {
		return new ArrayList<>();
	}

	// --- gespeicherte Einstellungen des Moduls (config/heldixclient.json, "options") -----------

	protected boolean option(String key, boolean fallback) {
		String value = state.options.get(key);
		return value == null ? fallback : Boolean.parseBoolean(value);
	}

	protected double option(String key, double fallback) {
		try {
			String value = state.options.get(key);
			return value == null ? fallback : Double.parseDouble(value);
		} catch (NumberFormatException e) {
			return fallback;
		}
	}

	protected void setOption(String key, Object value) {
		state.options.put(key, String.valueOf(value));
		HeldixConfig.save();
	}

	protected Setting.Toggle toggle(String key, String label, String description, boolean fallback) {
		return new Setting.Toggle(label, description, () -> option(key, fallback), value -> setOption(key, value));
	}

	protected Setting.Slider slider(String key, String label, String description, double min, double max, double step, double fallback,
			java.util.function.DoubleFunction<String> format) {
		return new Setting.Slider(label, description, min, max, step, () -> option(key, fallback), value -> setOption(key, value), format);
	}

	protected Setting.Choice choice(String key, String label, String description, List<String> options, int fallback) {
		return new Setting.Choice(label, description, options, () -> (int) option(key, (double) fallback),
				value -> setOption(key, value));
	}

	/** Farbe, gespeichert als "#AARRGGBB" */
	protected Setting.Color color(String key, String label, String description, int fallback) {
		return new Setting.Color(label, description, fallback, () -> {
			String value = state.options.get(key);
			if (value == null || !value.matches("#[0-9A-Fa-f]{8}")) return fallback;
			return (int) Long.parseLong(value.substring(1), 16);
		}, value -> setOption(key, String.format("#%08X", value)));
	}

	protected Setting.Text text(String key, String label, String description, String fallback, int maxLength) {
		return new Setting.Text(label, description, maxLength, () -> {
			String value = state.options.get(key);
			return value == null ? fallback : value;
		}, value -> setOption(key, value.length() > maxLength ? value.substring(0, maxLength) : value));
	}
}
