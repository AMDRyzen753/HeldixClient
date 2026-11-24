package dev.heldixclient.module.impl;

import com.mojang.blaze3d.platform.InputConstants;

import dev.heldixclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayDeque;

public class CpsModule extends HudModule {
	private static final ArrayDeque<Long> LEFT = new ArrayDeque<>();
	private static final ArrayDeque<Long> RIGHT = new ArrayDeque<>();

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
		return count(LEFT);
	}

	public static int right() {
		return count(RIGHT);
	}

	private static int count(ArrayDeque<Long> clicks) {
		long cutoff = System.currentTimeMillis() - 1000;
		while (!clicks.isEmpty() && clicks.peekFirst() < cutoff) clicks.pollFirst();
		return clicks.size();
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		return drawLabelValue(g, mc.font, x, y, "CPS", left() + " | " + right());
	}
}
