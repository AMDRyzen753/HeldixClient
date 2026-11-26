package dev.heldixclient.hud;

import dev.heldixclient.api.HudClick;
import dev.heldixclient.api.HudHover;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Maus über bzw. Klick auf ein HUD-Element: lokale Stelle, Taste, Modifikatoren und der Bereich darunter.
 * Dient eingebauten Modulen und Addons ({@link HudClick}, {@link HudHover}) gleichermaßen.
 */
public final class HudPointer implements HudClick, HudHover {
	private static final int MAX_LINES = 12;

	private final float x;
	private final float y;
	private final int button;
	private final int modifiers;
	private final String hotspot;
	private final boolean chatOpen;
	private List<String> tooltip = List.of();
	private Cursor cursor = Cursor.DEFAULT;

	HudPointer(float x, float y, int button, int modifiers, String hotspot, boolean chatOpen) {
		this.x = x;
		this.y = y;
		this.button = button;
		this.modifiers = modifiers;
		this.hotspot = hotspot == null ? "" : hotspot;
		this.chatOpen = chatOpen;
	}

	@Override
	public float x() {
		return x;
	}

	@Override
	public float y() {
		return y;
	}

	@Override
	public int button() {
		return button;
	}

	@Override
	public boolean shift() {
		return (modifiers & 0x3) != 0;
	}

	@Override
	public boolean control() {
		return (modifiers & 0xC0) != 0;
	}

	@Override
	public boolean alt() {
		return (modifiers & 0x300) != 0;
	}

	@Override
	public String hotspot() {
		return hotspot;
	}

	@Override
	public boolean chatOpen() {
		return chatOpen;
	}

	@Override
	public boolean insertIntoChat(String text) {
		if (text == null) return false;
		if (!(Minecraft.getInstance().gui.screen() instanceof ChatScreen chat)) return false;
		chat.insertText(text, false);
		return true;
	}

	@Override
	public void copyToClipboard(String text) {
		if (text != null) Minecraft.getInstance().keyboardHandler.setClipboard(text);
	}

	@Override
	public void tooltip(List<String> lines) {
		List<String> clean = new ArrayList<>();
		if (lines != null) {
			for (String line : lines) {
				if (clean.size() >= MAX_LINES) break;
				if (line != null) clean.add(line.length() > 120 ? line.substring(0, 120) + "…" : line);
			}
		}
		tooltip = List.copyOf(clean);
	}

	@Override
	public void tooltip(String... lines) {
		tooltip(lines == null ? List.of() : Arrays.asList(lines));
	}

	@Override
	public void cursor(Cursor cursor) {
		this.cursor = cursor == null ? Cursor.DEFAULT : cursor;
	}

	public List<String> tooltipLines() {
		return tooltip;
	}

	public Cursor cursorType() {
		return cursor;
	}
}
