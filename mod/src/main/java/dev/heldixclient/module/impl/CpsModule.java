package dev.heldixclient.module.impl;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.hud.HudPointer;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayDeque;
import java.util.List;

/** Klicks pro Sekunde (links, auf Wunsch rechts dazu) mit Rekord der Sitzung im Tooltip. */
public class CpsModule extends HudModule {
	private static final ArrayDeque<Long> LEFT = new ArrayDeque<>();
	private static final ArrayDeque<Long> RIGHT = new ArrayDeque<>();
	private static int bestLeft;
	private static int bestRight;

	public CpsModule() {
		super("cps", "CPS", "Klicks pro Sekunde", true, 4, 22);
	}

	/** Wird bei jedem Maus-Klick im Spiel aufgerufen (Hooks.mouseButton). */
	public static void onClick(int button) {
		long now = System.currentTimeMillis();
		if (button == InputConstants.MOUSE_BUTTON_LEFT) LEFT.addLast(now);
		else if (button == InputConstants.MOUSE_BUTTON_RIGHT) RIGHT.addLast(now);
	}

	public static int left() {
		int count = count(LEFT);
		bestLeft = Math.max(bestLeft, count);
		return count;
	}

	public static int right() {
		int count = count(RIGHT);
		bestRight = Math.max(bestRight, count);
		return count;
	}

	private static int count(ArrayDeque<Long> clicks) {
		long cutoff = System.currentTimeMillis() - 1000;
		while (!clicks.isEmpty() && clicks.peekFirst() < cutoff) clicks.pollFirst();
		return clicks.size();
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		String value = option("right", true) ? left() + " · " + right() : Integer.toString(left());
		return drawLabelValue(g, mc.font, x, y, "CPS", value);
	}

	@Override
	public void onHover(Minecraft mc, HudPointer pointer) {
		pointer.tooltip("Klicks pro Sekunde", "Links " + left() + " · Rechts " + right(), "Rekord: " + bestLeft + " links · " + bestRight + " rechts");
	}

	@Override
	public List<Setting> styleOptions() {
		List<Setting> options = super.styleOptions();
		options.add(toggle("right", "Rechte Maustaste", "", true));
		return options;
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.addFirst(toggle("right", "Rechte Maustaste", "Auch die Klicks der rechten Maustaste zeigen", true));
		return settings;
	}
}
