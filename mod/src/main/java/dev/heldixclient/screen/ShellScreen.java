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
 * Liefert {@link #subTabs()} Reiter, stehen sie als Unter-Menü unter dem Seitentitel.
 */
public abstract class ShellScreen extends Screen {
	protected static final int PAD = 16;
	protected static final int HEADER_H = 42;
	/** Höhe der Reiterzeile unter dem Seitentitel */
	protected static final int TABS_H = 24;
	/** Strich unter dem aktiven Reiter: Lage im letzten Bild (gleitet beim Wechsel, auch über Seiten derselben Kategorie hinweg) */
	private static float lineX = -1;
	private static float lineW;
	private static Shell.Page lineHead;
	private int tabPadding;
	private boolean tabIcons;
	/** Stand von „Konten“ beim Aufbau der Seitenleiste */
	private boolean accountsInNav;

	protected final Shell.Page page;
	protected final long openedAt = Shell.openedAt();
	protected List<ShellNavButton> nav = new ArrayList<>();
	protected List<ShellTab> tabs = new ArrayList<>();
	/** Unterkante des Seitenkopfs (mit Reitern) */
	protected int headerBottom;
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
		accountsInNav = Shell.accountsVisible();
		nav = Shell.createNav(this, page, inGame(), this::addRenderableWidget);
		Shell.Rect content = Shell.content(window);
		int pad = content.w() < 260 ? 10 : PAD;
		contentX = content.x() + pad;
		contentW = content.w() - pad * 2;
		tabs = new ArrayList<>();
		headerBottom = window.y() + HEADER_H;
		List<ShellTab.Spec> specs = subTabs();
		if (!specs.isEmpty()) {
			createTabs(specs, window.y() + HEADER_H - 2);
			headerBottom += TABS_H - 4;
		}
		contentY = headerBottom + 8;
		contentH = window.bottom() - 10 - contentY;
		initContent();
	}

	/** Reiter nebeneinander; reicht der Platz nicht, zuerst ohne Icons, dann enger */
	private void createTabs(List<ShellTab.Spec> specs, int y) {
		int padding = 9;
		boolean icons = true;
		int total = tabsWidth(specs, true, padding);
		if (total > contentW) {
			icons = false;
			total = tabsWidth(specs, false, padding);
		}
		if (total > contentW) padding = 5;
		tabPadding = padding;
		tabIcons = icons;
		int x = contentX - padding + 2;
		for (ShellTab.Spec spec : specs) {
			int w = ShellTab.widthFor(spec, icons, padding);
			if (x + w > contentX + contentW) w = contentX + contentW - x;
			if (w < 24) break;
			ShellTab tab = new ShellTab(x, y, w, TABS_H - 2, spec, icons);
			tabs.add(tab);
			addRenderableWidget(tab);
			x += w;
		}
	}

	/** Breiten nachführen, wenn sich eine Zahl an einem Reiter ändert (z. B. erstes eigenes Cape) */
	private void relayoutTabs() {
		if (tabs.isEmpty()) return;
		int x = tabs.getFirst().getX();
		for (ShellTab tab : tabs) {
			int w = ShellTab.widthFor(tab.spec(), tabIcons, tabPadding);
			if (x + w > contentX + contentW) w = Math.max(24, contentX + contentW - x);
			tab.setX(x);
			tab.setWidth(w);
			x += w;
		}
	}

	private static int tabsWidth(List<ShellTab.Spec> specs, boolean icons, int padding) {
		int total = 0;
		for (ShellTab.Spec spec : specs) total += ShellTab.widthFor(spec, icons, padding);
		return total;
	}

	/** Unter-Menü der Seite (leer = keine Reiter); wird bei jedem Aufbau der Widgets abgefragt */
	protected List<ShellTab.Spec> subTabs() {
		return List.of();
	}

	/**
	 * Reiter für die Unterseiten der Kategorie (z. B. Grafik: Shader, Leistung). {@code open} öffnet eine andere Unterseite.
	 */
	protected List<ShellTab.Spec> pageTabs(java.util.function.Consumer<Shell.Page> open) {
		List<Shell.Page> group = page.group();
		if (group.size() < 2) return List.of();
		List<ShellTab.Spec> specs = new ArrayList<>();
		for (Shell.Page target : group) {
			// die Zahl der Kategorie (z. B. offene Anfragen) steht am Reiter der Unterseite, nicht am ersten Reiter
			specs.add(new ShellTab.Spec(target.name(), target.label, target.icon, () -> target == target.head() ? null : Shell.badge(target), true,
					() -> target == page, () -> open.accept(target)));
		}
		return specs;
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

	/** Eigenes Bild statt des Icons vor dem Seitentitel (z. B. Kopf eines Spielers); true = gezeichnet */
	protected boolean drawHeaderImage(GuiGraphicsExtractor g, int x, int y, int size) {
		return false;
	}

	/** Icon vor dem Seitentitel (Standard: Icon der Kategorie) */
	protected String headerIcon() {
		return page.head().icon;
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
		relayoutTabs();
		for (ShellTab tab : tabs) tab.setAlpha(fade);
		Shell.drawWindow(g, width, height, inGame(), fade);

		// Kopfzeile: Icon, Titel, Untertitel, Trennlinie
		Shell.Rect content = Shell.content(window);
		int x = contentX;
		String sub = subtitle();
		int titleY = sub != null ? window.y() + 11 : window.y() + (HEADER_H - 12) / 2 + 1;
		String icon = headerIcon();
		if (icon != null) {
			if (!drawHeaderImage(g, x, window.y() + (HEADER_H - 22) / 2 + 1, 22)) {
				Ui.rect(g, x, window.y() + (HEADER_H - 22) / 2f + 1, 22, 22, 6, Ui.withAlpha(Ui.ACCENT_SOFT, fade));
				Ui.icon(g, icon, x + 5.5f, window.y() + (HEADER_H - 11) / 2f + 1, 11, Ui.withAlpha(Ui.ACCENT_TEXT, fade));
			}
			x += 30;
		}
		Ui.text(g, headerTitle().getString(), x, titleY, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.TITLE);
		if (sub != null) Ui.text(g, sub, x, titleY + 14, Ui.withAlpha(Ui.FAINT, fade), Ui.Font.SMALL);
		Ui.hline(g, content.x() + 1, content.right() - 1, headerBottom, Ui.withAlpha(Ui.LINE, fade));
		drawTabLine(g);

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

	/** blauer Strich unter dem aktiven Reiter; gleitet zum neuen Reiter */
	private void drawTabLine(GuiGraphicsExtractor g) {
		ShellTab active = null;
		for (ShellTab tab : tabs) if (tab.selected()) active = tab;
		if (active == null) return;
		float targetX = active.getX() + 6;
		float targetW = active.getWidth() - 12;
		if (lineX < 0 || lineHead != page.head()) {
			lineX = targetX;
			lineW = targetW;
		}
		lineHead = page.head();
		lineX += (targetX - lineX) * 0.3f;
		lineW += (targetW - lineW) * 0.3f;
		if (Math.abs(targetX - lineX) < 0.3f) lineX = targetX;
		if (Math.abs(targetW - lineW) < 0.3f) lineW = targetW;
		Ui.rect(g, lineX, headerBottom - 1, lineW, 2, 1, Ui.withAlpha(Ui.ACCENT, fade));
	}

	/** Zeichnung über den Widgets (z. B. Aufklapplisten) */
	protected void drawOverlay(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
	}

	@Override
	public boolean isPauseScreen() {
		return true;
	}

	@Override
	public void tick() {
		super.tick();
		// Kontowechsel kam hinzu oder fiel weg (Launcher verbunden, Einstellung im Launcher): Seitenleiste neu aufbauen
		if (Shell.accountsVisible() != accountsInNav) rebuildWidgets();
	}

	/** Seiten in der Seitenleiste (für den Autotest) */
	public List<String> navIds() {
		return nav.stream().map(button -> button.page().name()).toList();
	}

	@Override
	public void onClose() {
		Shell.close(minecraft);
	}
}
