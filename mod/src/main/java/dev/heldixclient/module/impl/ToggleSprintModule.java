package dev.heldixclient.module.impl;

import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.player.LocalPlayer;

import java.util.List;

/**
 * Dauersprint und Dauerschleichen. Statt selbst zu sprinten, meldet der Hook in KeyboardInput die Sprint- bzw.
 * Schleichtaste als gedrückt – so entscheidet Minecraft wie gewohnt, ob gerade gesprintet werden darf
 * (Hunger, Gegenstand benutzen, Blindheit …), und es gehen keine zusätzlichen Pakete an den Server.
 */
public class ToggleSprintModule extends HudModule {
	/** Dauersprint gerade an (Sprinttaste schaltet um) */
	private boolean sprint = true;
	/** Dauerschleichen gerade an (Schleichtaste schaltet um, nur mit Option) */
	private boolean sneak;

	public ToggleSprintModule() {
		super("togglesprint", "Dauersprint", "Sprinten ohne Taste, Schleichen umschalten", false, 4, 9999);
	}

	@Override
	protected void onEnable() {
		sprint = true;
		sneak = false;
		// alte Tastendrücke aus der Zeit, als das Modul aus war, verwerfen (sonst schaltet es sofort um)
		Minecraft mc = Minecraft.getInstance();
		while (mc.options.keySprint.consumeClick()) {
			// verwerfen
		}
		while (mc.options.keyShift.consumeClick()) {
			// verwerfen
		}
	}

	@Override
	public void tick(Minecraft mc) {
		if (!isEnabled() || mc.player == null) {
			sneak = false;
			return;
		}
		// Tastendrücke schalten um; KeyMapping zählt sie mit, auch wenn wir die Taste als gedrückt melden
		while (mc.options.keySprint.consumeClick()) sprint = !sprint;
		boolean sneakToggle = option("sneak", false);
		while (mc.options.keyShift.consumeClick()) {
			if (sneakToggle && canSneakToggle(mc.player)) sneak = !sneak;
		}
		if (!sneakToggle || !canSneakToggle(mc.player)) sneak = false;
	}

	/** Beim Reiten heißt Schleichen absteigen, beim Fliegen sinken – dort kein Dauerschleichen */
	private static boolean canSneakToggle(LocalPlayer player) {
		return !player.isPassenger() && !player.getAbilities().flying;
	}

	/** Hook: Sprinttaste in KeyboardInput.tick */
	public boolean sprintDown(KeyMapping key) {
		return key.isDown() || (isEnabled() && sprint);
	}

	/** Hook: Schleichtaste in KeyboardInput.tick */
	public boolean sneakDown(KeyMapping key) {
		return key.isDown() || (isEnabled() && sneak);
	}

	public boolean sprintActive() {
		return isEnabled() && sprint;
	}

	public boolean sneakActive() {
		return isEnabled() && sneak;
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		if (!option("hud", true) && !isPreviewing()) return size(0, 0);
		if (sneak) return drawLabelValue(g, mc.font, x, y, "Schleichen", "umgeschaltet");
		if (sprint) {
			boolean running = mc.player != null && mc.player.isSprinting();
			return drawLabelValue(g, mc.font, x, y, "Sprint", running ? "Dauersprint" : "bereit");
		}
		return isPreviewing() ? drawLabelValue(g, mc.font, x, y, "Sprint", "aus") : size(0, 0);
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(0, toggle("sneak", "Schleichen umschalten", "Schleichtaste einmal drücken statt halten (nicht beim Reiten und Fliegen)", false));
		settings.add(1, toggle("hud", "Anzeige im HUD", "Zeigt, ob Dauersprint oder Dauerschleichen gerade an ist", true));
		return settings;
	}
}
