package dev.heldixclient.screen;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Basis für alle Seiten der Heldix-Oberfläche: Fenster mit Seitenleiste links, Kopfzeile und Inhalt rechts.
 * Unterklassen legen in {@link #initContent()} ihre Widgets an und zeichnen in {@link #drawContent}.
 */
public abstract class ShellScreen extends Screen {
	protected static final int PAD = 16;
	protected static final int HEADER_H = 42;

	protected final Shell.Page page;
	protected final long openedAt = Shell.openedAt();
	protected List<ShellNavButton> nav = new ArrayList<>();
	/** Fenster und Inhaltsbereich unter der Kopfzeile */
	protected Shell.Rect window;
	protected int contentX;
	protected int contentY;
	protected int contentW;
	protected int contentH;
	protected float fade = 1f;

	protected ShellScreen(Component title, Shell.Page page) {
		super(title);
		this.page = page;
	}

	protected boolean inGame() {
		return minecraft != null && minecraft.level != null;
	}

	@Override
	protected final void init() {
		window = Shell.window(width, height);
		nav = Shell.createNav(this, page, inGame(), this::addRenderableWidget);
		Shell.Rect content = Shell.content(window);
		int pad = content.w() < 260 ? 10 : PAD;
		contentX = content.x() + pad;
		contentW = content.w() - pad * 2;
		contentY = window.y() + HEADER_H + 8;
		contentH = window.bottom() - 10 - contentY;
		initContent();
	}

	/** Widgets der Seite anlegen (Inhaltsbereich ist berechnet). */
	protected abstract void initContent();

	/** Seitentitel in der Kopfzeile (Standard: Titel der Seite) */
	protected Component headerTitle() {
		return getTitle();
	}

	/** Untertitel unter dem Seitentitel, z. B. "3 Welten" */
	protected String subtitle() {
		return null;
	}

	/** Icon vor dem Seitentitel (Standard: Icon der Seite) */
	protected String headerIcon() {
		return page.icon;
	}

	/** Eigene Zeichnung im Inhaltsbereich (unter den Widgets). */
	protected abstract void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta);

	/** rechte Kante der Kopfzeile für eigene Knöpfe */
	protected int headerRight() {
		return contentX + contentW;
	}

	/** obere Kante eines 20 px hohen Knopfs in der Kopfzeile */
	protected int headerButtonY() {
		return window.y() + (HEADER_H - 20) / 2 + 1;
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (minecraft.level != null) {
			extractBlurredBackground(g);
		} else if (!HeldixConfig.get().heldixBackground) {
			extractPanorama(g, delta);
			extractBlurredBackground(g);
		}
		Shell.drawBackdrop(g, width, height, minecraft.level != null, fade);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		fade = Shell.frame(openedAt);
		for (ShellNavButton button : nav) button.setAlpha(fade);
		Shell.drawWindow(g, width, height, inGame(), fade);

		// Kopfzeile: Icon, Titel, Untertitel, Trennlinie
		Shell.Rect content = Shell.content(window);
		int x = contentX;
		String sub = subtitle();
		int titleY = sub != null ? window.y() + 11 : window.y() + (HEADER_H - 12) / 2 + 1;
		String icon = headerIcon();
		if (icon != null) {
			Ui.rect(g, x, window.y() + (HEADER_H - 22) / 2f + 1, 22, 22, 6, Ui.withAlpha(Ui.ACCENT_SOFT, fade));
			Ui.icon(g, icon, x + 5.5f, window.y() + (HEADER_H - 11) / 2f + 1, 11, Ui.withAlpha(Ui.ACCENT_TEXT, fade));
			x += 30;
		}
		Ui.text(g, headerTitle().getString(), x, titleY, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.TITLE);
		if (sub != null) Ui.text(g, sub, x, titleY + 14, Ui.withAlpha(Ui.FAINT, fade), Ui.Font.SMALL);
		Ui.hline(g, content.x() + 1, content.right() - 1, window.y() + HEADER_H, Ui.withAlpha(Ui.LINE, fade));

		// Inhalt gleitet beim ersten Öffnen leicht herein
		int offset = Math.round((1 - fade) * 8);
		g.pose().pushMatrix();
		g.pose().translate(0, offset);
		drawContent(g, mouseX, mouseY - offset, delta);
		g.pose().popMatrix();
		super.extractRenderState(g, mouseX, mouseY, delta);
		drawOverlay(g, mouseX, mouseY, delta);
		Ui.drawTooltip(g, width, height);
	}

	/** Zeichnung über den Widgets (z. B. Aufklapplisten) */
	protected void drawOverlay(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
	}

	@Override
	public boolean isPauseScreen() {
		return true;
	}

	@Override
	public void onClose() {
		Shell.close(minecraft);
	}
}
