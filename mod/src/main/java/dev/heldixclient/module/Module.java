package dev.heldixclient.module;

import dev.heldixclient.config.HeldixConfig;
import net.minecraft.client.Minecraft;

/** Basis für alle Client-Features, die man im Heldix-Menü an- und ausschalten kann. */
public abstract class Module {
	private final String id;
	private final String name;
	private final String description;
	protected final HeldixConfig.ModuleState state;

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
}
