package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** HUD-Elemente mit der Maus verschieben, mit Einrasten an Rändern, Mitte und anderen Elementen. */
public class HudEditorScreen extends Screen {
	private static final int SNAP = 5;
	private static final int MARGIN = 2;
	private static final int GRID = 16;

	private final Screen parent;
	private HudModule dragging;
	private int offsetX;
	private int offsetY;
	private int guideX = -1;
	private int guideY = -1;

	public HudEditorScreen(Screen parent) {
		super(Component.literal("HUD bearbeiten"));
		this.parent = parent;
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		g.fill(0, 0, width, height, 0x40030A18);
		for (int x = GRID; x < width; x += GRID) g.fill(x, 0, x + 1, height, 0x0DFFFFFF);
		for (int y = GRID; y < height; y += GRID) g.fill(0, y, width, y + 1, 0x0DFFFFFF);
		g.fill(width / 2, 0, width / 2 + 1, height, 0x4038BDF8);
		g.fill(0, height / 2, width, height / 2 + 1, 0x4038BDF8);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		super.extractRenderState(g, mouseX, mouseY, delta);

		HudModule hovered = dragging != null ? dragging : moduleAt(mouseX, mouseY);
		for (HudModule module : ModuleManager.hud()) {
			if (!module.isEnabled()) continue;
			module.extract(g, minecraft);
			boolean active = module == hovered;
			Draw.outline(g, module.x() - 2, module.y() - 2, module.width() + 4, module.height() + 4, active ? Theme.ACCENT_LIGHT : 0x45FFFFFF);
		}

		if (dragging != null) {
			if (guideX >= 0) g.fill(guideX, 0, guideX + 1, height, Theme.CYAN);
			if (guideY >= 0) g.fill(0, guideY, width, guideY + 1, Theme.CYAN);
		}

		if (hovered != null) {
			String name = hovered.name();
			int tagW = font.width(name) + 8;
			int tagX = Math.clamp(hovered.x() - 2, 0, width - tagW);
			int tagY = hovered.y() - 15 >= 0 ? hovered.y() - 15 : hovered.y() + hovered.height() + 4;
			Draw.rounded(g, tagX, tagY, tagW, 12, Theme.ACCENT);
			g.text(font, name, tagX + 4, tagY + 2, Theme.TEXT, false);
		}

		// Hinweisleiste an einer freien Stelle (oben, unten oder Mitte)
		String title = "HUD-Editor";
		String help = "  Ziehen · R: Zurücksetzen · ESC: Fertig";
		int barW = font.width(title) + font.width(help) + 16;
		int barX = (width - barW) / 2;
		int barY = freeBarY(barX, barW, 18);
		Draw.rounded2(g, barX, barY, barW, 18, Theme.PANEL);
		Draw.outline(g, barX, barY, barW, 18, Theme.BORDER);
		Draw.accentLine(g, barX + 2, barY, barW - 4, 1);
		g.text(font, title, barX + 8, barY + 5, Theme.ACCENT_LIGHT, false);
		g.text(font, help, barX + 8 + font.width(title), barY + 5, Theme.MUTED, false);
	}

	private int freeBarY(int barX, int barW, int barH) {
		int[] candidates = {6, height - barH - 52, height / 2 + 24, height / 2 - barH - 24};
		for (int y : candidates) {
			boolean free = true;
			for (HudModule module : ModuleManager.hud()) {
				if (!module.isEnabled()) continue;
				boolean overlapX = barX < module.x() + module.width() + 2 && barX + barW > module.x() - 2;
				boolean overlapY = y < module.y() + module.height() + 2 && y + barH > module.y() - 2;
				if (overlapX && overlapY) {
					free = false;
					break;
				}
			}
			if (free) return y;
		}
		return candidates[0];
	}

	private HudModule moduleAt(double mouseX, double mouseY) {
		for (HudModule module : ModuleManager.hud().reversed()) {
			if (module.isEnabled() && Draw.inside(mouseX, mouseY, module.x(), module.y(), module.width(), module.height())) {
				return module;
			}
		}
		return null;
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (event.button() == InputConstants.MOUSE_BUTTON_LEFT) {
			HudModule module = moduleAt(event.x(), event.y());
			if (module != null) {
				dragging = module;
				offsetX = (int) event.x() - module.x();
				offsetY = (int) event.y() - module.y();
				return true;
			}
		}
		return super.mouseClicked(event, doubleClick);
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
		if (dragging == null) return super.mouseDragged(event, dragX, dragY);
		int w = dragging.width();
		int h = dragging.height();
		int x = Math.clamp((int) event.x() - offsetX, 0, Math.max(0, width - w));
		int y = Math.clamp((int) event.y() - offsetY, 0, Math.max(0, height - h));
		guideX = -1;
		guideY = -1;

		// Bildschirmränder und Mitte
		int[] snapX = snapAxis(x, new int[] {MARGIN, width - w - MARGIN, (width - w) / 2}, new int[] {-1, -1, width / 2});
		x = snapX[0];
		guideX = snapX[1];
		int[] snapY = snapAxis(y, new int[] {MARGIN, height - h - MARGIN, (height - h) / 2}, new int[] {-1, -1, height / 2});
		y = snapY[0];
		guideY = snapY[1];

		// An anderen Elementen ausrichten (bündig links/rechts, direkt darunter/darüber)
		for (HudModule other : ModuleManager.hud()) {
			if (other == dragging || !other.isEnabled()) continue;
			if (guideX < 0) {
				int[] r = snapAxis(x, new int[] {other.x(), other.x() + other.width() - w}, new int[] {other.x(), other.x() + other.width()});
				if (r[0] != x || r[1] >= 0) {
					x = r[0];
					guideX = r[1];
				}
			}
			if (guideY < 0) {
				int[] r = snapAxis(y, new int[] {other.y() + other.height() + 2, other.y() - h - 2, other.y()},
						new int[] {other.y() + other.height() + 1, other.y() - 1, other.y()});
				if (r[0] != y || r[1] >= 0) {
					y = r[0];
					guideY = r[1];
				}
			}
		}
		dragging.setPosition(x, y);
		return true;
	}

	/** Rastet value an einem der Ziele ein, wenn es nahe genug ist. Rückgabe: {Wert, Hilfslinie oder -1}. */
	private static int[] snapAxis(int value, int[] targets, int[] guides) {
		for (int i = 0; i < targets.length; i++) {
			if (Math.abs(value - targets[i]) <= SNAP) return new int[] {targets[i], guides[i]};
		}
		return new int[] {value, -1};
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		if (dragging != null) {
			dragging = null;
			guideX = -1;
			guideY = -1;
			HeldixConfig.save();
			return true;
		}
		return super.mouseReleased(event);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.key() == InputConstants.KEY_R) {
			for (HudModule module : ModuleManager.hud()) module.resetPosition();
			HeldixConfig.save();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		HeldixConfig.save();
		minecraft.gui.setScreen(parent);
	}
}
