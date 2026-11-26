package dev.heldixclient.module.impl;

import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.hud.HudPointer;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.List;

/** Bilder pro Sekunde, farbig nach Wert; Klick (bei offenem Chat) öffnet die Leistungs-Einstellungen. */
public class FpsModule extends HudModule {
	static final int GOOD = 0xFF86EFAC;
	static final int OK = 0xFFFDE68A;
	static final int BAD = 0xFFFCA5A5;
	private static final List<String> FORMATS = List.of("FPS 144", "144 FPS");

	public FpsModule() {
		super("fps", "FPS", "Bilder pro Sekunde", true, 4, 4);
	}

	/** Farbe nach Bildrate: grün ab 120, gelb ab 60 (bei einer Grenze darunter: ab 90 % der Grenze grün) */
	static int color(int fps, int limit) {
		int good = limit > 0 && limit < 120 ? (int) (limit * 0.9) : 120;
		int ok = Math.min(60, good);
		return fps >= good ? GOOD : fps >= ok ? OK : BAD;
	}

	private static int limit(Minecraft mc) {
		int limit = mc.getFramerateLimitTracker().getFramerateLimit();
		return limit >= 260 ? 0 : limit;
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		int fps = mc.getFps();
		String value = Integer.toString(fps);
		boolean colored = option("colored", true);
		if ((int) option("format", 0.0) == 1) {
			return colored ? drawLabelValue(g, mc.font, x, y, "", value + " FPS", color(fps, limit(mc)))
					: drawLabelValue(g, mc.font, x, y, "", value + " FPS");
		}
		return colored ? drawLabelValue(g, mc.font, x, y, "FPS", value, color(fps, limit(mc))) : drawLabelValue(g, mc.font, x, y, "FPS", value);
	}

	@Override
	public void onHover(Minecraft mc, HudPointer pointer) {
		int limit = limit(mc);
		pointer.tooltip(mc.getFps() + " Bilder pro Sekunde",
				"Grenze: " + (limit > 0 ? limit + " FPS" : "unbegrenzt") + (mc.options.enableVsync().get() ? " · VSync an" : ""),
				"Klick: Leistung und FPS-Boost");
		pointer.cursor(dev.heldixclient.api.HudHover.Cursor.HAND);
	}

	@Override
	public boolean onClick(Minecraft mc, HudPointer pointer) {
		if (pointer.button() != 0) return false;
		HudInteraction.action("fps:performance");
		mc.gui.setScreen(new HeldixMenuScreen(mc.gui.screen(), Shell.Page.PERFORMANCE));
		return true;
	}

	@Override
	public List<Setting> styleOptions() {
		List<Setting> options = super.styleOptions();
		options.add(choice("format", "Darstellung", "", FORMATS, 0));
		options.add(toggle("colored", "Farbe nach Wert", "Grün ab 120, gelb ab 60, sonst rot", true));
		return options;
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.addFirst(choice("format", "Darstellung", "Beschriftung vor oder hinter der Zahl", FORMATS, 0));
		settings.addFirst(toggle("colored", "Farbe nach Wert", "Grün ab 120, gelb ab 60, sonst rot", true));
		return settings;
	}
}
