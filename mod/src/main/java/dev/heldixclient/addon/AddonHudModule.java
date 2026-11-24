package dev.heldixclient.addon;

import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayList;
import java.util.List;

/** HUD-Modul aus einem Addon. */
final class AddonHudModule extends HudModule implements ModuleHandle {
	private final LoadedAddon addon;
	private final HudRenderer renderer;
	private final List<ToggleListener> listeners = new ArrayList<>();

	AddonHudModule(LoadedAddon addon, ModuleSpec spec, HudRenderer renderer) {
		super(addon.metadata.id + ":" + spec.id(), spec.name(), spec.description(), spec.enabledByDefault(), spec.defaultX(), spec.defaultY());
		this.addon = addon;
		this.renderer = renderer;
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
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		AddonCanvas canvas = new AddonCanvas(g, mc.font, x, y);
		try {
			renderer.render(canvas);
		} catch (Throwable t) {
			AddonManager.reportError(addon, "HUD-Modul " + name(), t);
		}
		return size(Math.max(canvas.width(), 4), Math.max(canvas.height(), 4));
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
