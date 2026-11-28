package dev.heldixclient.addons.emoterad.test;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/**
 * Emote-Rad: Taste gedrückt halten, Maus in eine Richtung, loslassen = Emote. Ein kurzer Tipp lässt das Rad
 * offen, dann wählt ein Klick; Esc oder die Taste schließt. Das Spiel läuft weiter (kein Pausenbildschirm).
 * Richtungen: oben Sitzen, rechts Winken, unten Verbeugen, links Krallen zeigen.
 */
final class EmoteWheelScreen extends Screen {
	private static final int RADIUS = 78;
	private static final int DEAD_ZONE = 20;
	private static final long TAP_MS = 250;
	/** Reihenfolge der Felder: oben, rechts, unten, links */
	private static final Emotes.Emote[] SLOTS = {Emotes.Emote.SIT, Emotes.Emote.WAVE, Emotes.Emote.BOW, Emotes.Emote.FLARE};
	private static final int BACK = 0xB0101418;
	private static final int HOVER = 0xD05B6CF0;
	private static final int LINE = 0x40FFFFFF;

	private final Emotes emotes;
	private final KeyMapping key;
	private final long opened = System.currentTimeMillis();
	private int mouseX;
	private int mouseY;

	/** @param key die frei belegbare Taste des Rads (null = nur Klick-Bedienung) */
	EmoteWheelScreen(Emotes emotes, KeyMapping key) {
		super(Component.literal("Emotes"));
		this.emotes = emotes;
		this.key = key;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// kein Abdunkeln und keine Unschärfe: die Welt bleibt sichtbar
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		this.mouseX = mouseX;
		this.mouseY = mouseY;
		int cx = width / 2;
		int cy = height / 2;
		int hover = slotAt(mouseX, mouseY);

		// Scheibe zeilenweise; das Feld unter der Maus hervorgehoben, Mitte frei (Abbrechen)
		for (int dy = -RADIUS; dy <= RADIUS; dy++) {
			int half = (int) Math.sqrt((double) RADIUS * RADIUS - dy * dy);
			int runStart = -half;
			int runColor = color(-half, dy, hover);
			for (int dx = -half + 1; dx <= half + 1; dx++) {
				int c = dx > half ? 0 : color(dx, dy, hover);
				if (c != runColor) {
					if (runColor != 0) g.fill(cx + runStart, cy + dy, cx + dx, cy + dy + 1, runColor);
					runStart = dx;
					runColor = c;
				}
			}
		}
		// Trennlinien zwischen den Feldern (diagonal)
		for (int i = DEAD_ZONE; i < RADIUS; i++) {
			int d = (int) Math.round(i * Math.sqrt(0.5));
			g.fill(cx + d, cy + d, cx + d + 1, cy + d + 1, LINE);
			g.fill(cx - d, cy + d, cx - d + 1, cy + d + 1, LINE);
			g.fill(cx + d, cy - d, cx + d + 1, cy - d + 1, LINE);
			g.fill(cx - d, cy - d, cx - d + 1, cy - d + 1, LINE);
		}
		// Beschriftungen
		int[][] offsets = {{0, -1}, {1, 0}, {0, 1}, {-1, 0}};
		int labelRadius = (RADIUS + DEAD_ZONE) / 2 + 4;
		for (int i = 0; i < SLOTS.length; i++) {
			String label = SLOTS[i].label;
			int lx = cx + offsets[i][0] * labelRadius - font.width(label) / 2;
			int ly = cy + offsets[i][1] * labelRadius - 4;
			g.text(font, label, lx, ly, hover == i ? 0xFFFFFFFF : 0xFFD8DCE8, true);
		}
		String hint = key != null ? "Maus in eine Richtung, Taste loslassen" : "Klick auf ein Feld";
		g.text(font, hint, cx - font.width(hint) / 2, cy + RADIUS + 8, 0xFFB8BCC8, true);
		g.text(font, "×", cx - font.width("×") / 2, cy - 4, hover < 0 ? 0xFFFFFFFF : 0x80FFFFFF, true);
	}

	/** Farbe eines Punkts der Scheibe (0 = nicht zeichnen) */
	private static int color(int dx, int dy, int hover) {
		int d2 = dx * dx + dy * dy;
		if (d2 > RADIUS * RADIUS) return 0;
		if (d2 < DEAD_ZONE * DEAD_ZONE) return 0x60101418;
		return hover >= 0 && slotOf(dx, dy) == hover ? HOVER : BACK;
	}

	/** Feld unter der Maus: 0 oben, 1 rechts, 2 unten, 3 links, -1 Mitte oder außerhalb */
	private int slotAt(double x, double y) {
		int dx = (int) Math.round(x - width / 2.0);
		int dy = (int) Math.round(y - height / 2.0);
		int d2 = dx * dx + dy * dy;
		if (d2 < DEAD_ZONE * DEAD_ZONE || d2 > (RADIUS + 30) * (RADIUS + 30)) return -1;
		return slotOf(dx, dy);
	}

	private static int slotOf(int dx, int dy) {
		if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 0 : 2;
		return dx > 0 ? 1 : 3;
	}

	private void choose(int slot) {
		if (slot >= 0) emotes.play(SLOTS[slot]);
		onClose();
	}

	@Override
	public boolean keyReleased(KeyEvent event) {
		if (key != null && key.matches(event)) {
			int slot = slotAt(mouseX, mouseY);
			// kurzer Tipp ohne Richtung: Rad bleibt offen, dann per Klick wählen
			if (slot < 0 && System.currentTimeMillis() - opened < TAP_MS) return true;
			choose(slot);
			return true;
		}
		return super.keyReleased(event);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (key != null && key.matches(event) && System.currentTimeMillis() - opened >= TAP_MS) {
			onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		choose(slotAt(event.x(), event.y()));
		return true;
	}
}
