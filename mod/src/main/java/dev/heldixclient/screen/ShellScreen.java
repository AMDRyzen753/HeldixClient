package dev.heldixclient.screen;

import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import com.mojang.blaze3d.platform.InputConstants;

import java.util.ArrayList;
import java.util.List;

/**
 * Basis für alle Seiten der Heldix-Oberfläche: Fenster mit zwei Leisten oben (Bereiche, Seiten), darunter eine
 * Werkzeugzeile (Reiter der Seite bzw. Untertitel links, Knöpfe der Seite rechts) und der Inhalt.
 * Unterklassen legen in {@link #initContent()} ihre Widgets an und zeichnen in {@link #drawContent}.
 * Liefert {@link #subTabs()} Reiter, stehen sie links in der Werkzeugzeile (passen sie nicht neben die Knöpfe,
 * in einer eigenen Zeile darunter). Strg+K öffnet die Schnellsuche, Strg+Tab wechselt den Reiter bzw. die Seite,
 * Strg+1 bis Strg+4 den Bereich.
 */
public abstract class ShellScreen extends Screen {
	/** Höhe der Werkzeugzeile über dem Inhalt */
	protected static final int TOOLBAR_H = 24;
	/** Höhe der Werkzeugzeile in diesem Fenster (niedrige Fenster: etwas flacher) */
	private int toolbarH = TOOLBAR_H;
	/** Höhe der Reiter (Pillen) */
	protected static final int TAB_H = 20;
	/** Strich unter der aktiven Seite: Lage im letzten Bild (gleitet beim Wechsel innerhalb eines Bereichs) */
	private static float lineX = -1;
	private static float lineW;
	private static Shell.Section lineSection;
	/** Pille hinter dem aktiven Reiter (gleitet beim Wechsel, auch über Seiten derselben Ober-Seite hinweg) */
	private static float pillX = -1;
	private static float pillW;
	private static Shell.Page pillHead;
	/** Stand von „Konten“ beim Aufbau der Navigation */
	private boolean accountsInNav;
	/** Reiter stehen in der Werkzeugzeile (sonst in einer eigenen Zeile darunter) */
	private boolean tabsInline;
	/** Werkzeugzeile sichtbar */
	private boolean toolbar;

	protected final Shell.Page page;
	protected final long openedAt = Shell.openedAt();
	/** Zeitpunkt, ab dem der Inhalt dieser Seite einblendet (bei jedem Seitenwechsel) */
	private final long contentAt = System.nanoTime();
	protected List<ShellNavButton> nav = new ArrayList<>();
	protected List<ShellTab> tabs = new ArrayList<>();
	/** obere Kante der Werkzeugzeile */
	protected int toolbarY;
	/** Unterkante des Kopfs (Werkzeugzeile, ggf. mit Reiterzeile) */
	protected int headerBottom;
	/** Fenster und Inhaltsbereich unter dem Kopf */
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
		Shell.remember(page);
		accountsInNav = Shell.accountsVisible();
		nav = Shell.createNav(this, page, inGame(), this::addRenderableWidget);
		Shell.Rect content = Shell.content(window);
		int pad = Shell.pad(window);
		boolean low = Shell.low(window);
		contentX = content.x() + pad;
		contentW = content.w() - pad * 2;
		toolbarY = content.y() + (low ? 4 : 8);
		toolbarH = low ? 22 : TOOLBAR_H;
		tabs = new ArrayList<>();
		tabsInline = false;
		List<ShellTab.Spec> specs = subTabs();
		// Werkzeugzeile nur, wenn etwas darin steht (in niedrigen Fenstern reicht ein Untertitel dafür nicht)
		toolbar = detailHeader() || !specs.isEmpty() || toolbarActionsWidth() > 0 || !low && subtitle() != null;
		headerBottom = toolbar ? toolbarY + toolbarH : content.y();
		if (!specs.isEmpty()) {
			int reserve = toolbarActionsWidth();
			int room = contentW - (reserve > 0 ? reserve + 12 : 0);
			if (!detailHeader() && placeTabs(specs, toolbarY + (toolbarH - TAB_H) / 2, room, true)) {
				tabsInline = true;
			} else {
				placeTabs(specs, headerBottom + 4, contentW, false);
				headerBottom += TAB_H + 6;
			}
		}
		contentY = headerBottom + (low ? 5 : 8);
		contentH = window.bottom() - (low ? 6 : 10) - contentY;
		initContent();
	}

	/**
	 * Reiter nebeneinander ab {@code contentX}: zuerst mit Icons, dann ohne, dann enger. {@code strict}: nur anlegen,
	 * wenn sie ganz in {@code room} passen (sonst false); andernfalls werden zu breite gekürzt.
	 */
	private boolean placeTabs(List<ShellTab.Spec> specs, int y, int room, boolean strict) {
		int[][] tries = {{1, 9}, {0, 9}, {0, 6}};
		int[] chosen = null;
		for (int[] attempt : tries) {
			if (tabsWidth(specs, attempt[0] == 1, attempt[1]) <= room) {
				chosen = attempt;
				break;
			}
		}
		if (chosen == null) {
			if (strict) return false;
			chosen = new int[] {0, 5};
		}
		boolean icons = chosen[0] == 1;
		int padding = chosen[1];
		int x = contentX;
		for (ShellTab.Spec spec : specs) {
			int w = ShellTab.widthFor(spec, icons, padding);
			if (x + w > contentX + room) w = contentX + room - x;
			if (w < 24) break;
			ShellTab tab = new ShellTab(x, y, w, TAB_H, spec, icons);
			tab.setPadding(padding);
			tabs.add(tab);
			addRenderableWidget(tab);
			x += w + 2;
		}
		return true;
	}

	/** Breiten nachführen, wenn sich eine Zahl an einem Reiter ändert (z. B. erstes eigenes Cape) */
	private void relayoutTabs() {
		if (tabs.isEmpty()) return;
		int x = tabs.getFirst().getX();
		int limit = tabsInline ? contentX + contentW - (toolbarActionsWidth() > 0 ? toolbarActionsWidth() + 12 : 0) : contentX + contentW;
		for (ShellTab tab : tabs) {
			int w = ShellTab.widthFor(tab.spec(), tab.showsIcon(), tab.padding());
			if (x + w > limit) w = Math.max(24, limit - x);
			tab.setX(x);
			tab.setWidth(w);
			x += w + 2;
		}
	}

	private static int tabsWidth(List<ShellTab.Spec> specs, boolean icons, int padding) {
		int total = 0;
		for (ShellTab.Spec spec : specs) total += ShellTab.widthFor(spec, icons, padding) + 2;
		return total;
	}

	/** Reiter der Seite (leer = keine); wird bei jedem Aufbau der Widgets abgefragt */
	protected List<ShellTab.Spec> subTabs() {
		return List.of();
	}

	/**
	 * Reiter für die Unterseiten der Ober-Seite (z. B. Grafik: Shader, Leistung). {@code open} öffnet eine andere Unterseite.
	 */
	protected List<ShellTab.Spec> pageTabs(java.util.function.Consumer<Shell.Page> open) {
		List<Shell.Page> group = page.group();
		if (group.size() < 2) return List.of();
		List<ShellTab.Spec> specs = new ArrayList<>();
		for (Shell.Page target : group) {
			// die Zahl der Ober-Seite (z. B. offene Anfragen) steht am Reiter der Unterseite, nicht am ersten Reiter
			specs.add(new ShellTab.Spec(target.name(), target.label, target.icon, () -> target == target.head() ? null : Shell.badge(target), true,
					() -> target == page, () -> open.accept(target)));
		}
		return specs;
	}

	/**
	 * Breite, die die Knöpfe der Seite rechts in der Werkzeugzeile brauchen ({@link #headerRight()},
	 * {@link #headerButtonY()}); danach richtet sich, ob die Reiter daneben passen.
	 */
	protected int toolbarActionsWidth() {
		return 0;
	}

	/**
	 * Detailansicht (z. B. Einstellungen eines Moduls, ein Chat): links in der Werkzeugzeile stehen dann Icon bzw. Bild,
	 * {@link #headerTitle()} und {@link #subtitle()} statt der Reiter.
	 */
	protected boolean detailHeader() {
		return false;
	}

	/** Widgets der Seite anlegen (Inhaltsbereich ist berechnet). */
	protected abstract void initContent();

	/** Titel der Detailansicht (Standard: Titel der Seite) */
	protected Component headerTitle() {
		return getTitle();
	}

	/** Untertitel, z. B. "3 Welten": in der Werkzeugzeile, wenn dort keine Reiter stehen */
	protected String subtitle() {
		return null;
	}

	/** Eigenes Bild statt des Icons in der Detailansicht (z. B. Kopf eines Spielers); true = gezeichnet */
	protected boolean drawHeaderImage(GuiGraphicsExtractor g, int x, int y, int size) {
		return false;
	}

	/** Icon der Detailansicht (Standard: Icon der Seite) */
	protected String headerIcon() {
		return page.head().icon;
	}

	/** Eigene Zeichnung im Inhaltsbereich (unter den Widgets). */
	protected abstract void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta);

	/** rechte Kante der Werkzeugzeile für eigene Knöpfe */
	protected int headerRight() {
		return contentX + contentW;
	}

	/** obere Kante eines 20 px hohen Knopfs in der Werkzeugzeile */
	protected int headerButtonY() {
		return toolbarY + (toolbarH - 20) / 2;
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
		drawNavLine(g);
		drawToolbar(g);

		// Inhalt: beim ersten Öffnen gleitet er herein, bei jedem Seitenwechsel blendet er kurz ein
		float shown = Draw.easeOut((System.nanoTime() - contentAt) / 170_000_000f);
		int offset = Math.round((1 - fade) * 8 + (1 - shown) * 4);
		g.pose().pushMatrix();
		g.pose().translate(0, offset);
		drawContent(g, mouseX, mouseY - offset, delta);
		g.pose().popMatrix();
		super.extractRenderState(g, mouseX, mouseY, delta);
		if (shown < 1 && fade >= 1) {
			Shell.Rect content = Shell.content(window);
			g.enableScissor(content.x() + 1, content.y() + 1, content.right() - 1, content.bottom() - 1);
			Ui.rect(g, window.x(), window.y(), window.w(), window.h(), 12, Ui.withAlpha(Ui.WINDOW, (1 - shown) * 0.85f));
			g.disableScissor();
		}
		drawOverlay(g, mouseX, mouseY, delta);
		Ui.drawTooltip(g, width, height);
	}

	/** blauer Strich unter der aktiven Seite; gleitet innerhalb eines Bereichs zur neuen Seite */
	private void drawNavLine(GuiGraphicsExtractor g) {
		ShellNavButton active = null;
		for (ShellNavButton button : nav) if (button.kind() == ShellNavButton.Kind.PAGE && button.selected()) active = button;
		if (active == null) return;
		float targetX = active.getX() + 7;
		float targetW = active.getWidth() - 14;
		if (lineX < 0 || lineSection != page.section) {
			lineX = targetX;
			lineW = targetW;
		}
		lineSection = page.section;
		lineX += (targetX - lineX) * 0.3f;
		lineW += (targetW - lineW) * 0.3f;
		if (Math.abs(targetX - lineX) < 0.3f) lineX = targetX;
		if (Math.abs(targetW - lineW) < 0.3f) lineW = targetW;
		int y = window.y() + Shell.navHeight(window) - 2;
		Ui.rect(g, lineX, y, lineW, 2, 1, Ui.withAlpha(Ui.ACCENT, fade));
	}

	/** Werkzeugzeile links: Detailkopf, Reiter (mit gleitender Pille) oder Untertitel */
	private void drawToolbar(GuiGraphicsExtractor g) {
		if (!toolbar) return;
		int reserve = toolbarActionsWidth();
		int right = contentX + contentW - (reserve > 0 ? reserve + 12 : 0);
		int cy = toolbarY + toolbarH / 2;
		if (detailHeader()) {
			int x = contentX;
			String icon = headerIcon();
			if (icon != null) {
				int size = 20;
				if (!drawHeaderImage(g, x, cy - size / 2, size)) {
					Ui.rect(g, x, cy - size / 2f, size, size, 6, Ui.withAlpha(Ui.ACCENT_SOFT, fade));
					Ui.icon(g, icon, x + 5, cy - 5, 10, Ui.withAlpha(Ui.ACCENT_TEXT, fade));
				}
				x += size + 8;
			}
			String sub = subtitle();
			String title = Ui.ellipsize(headerTitle().getString(), right - x, Ui.Font.LABEL);
			if (sub == null) {
				Ui.text(g, title, x, cy - 4, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.LABEL);
			} else {
				Ui.text(g, title, x, cy - 10, Ui.withAlpha(Ui.TEXT, fade), Ui.Font.LABEL);
				Ui.text(g, Ui.ellipsize(sub, right - x, Ui.Font.SMALL), x, cy + 2, Ui.withAlpha(Ui.FAINT, fade), Ui.Font.SMALL);
			}
			if (!tabs.isEmpty()) drawTabGroup(g);
			return;
		}
		if (!tabs.isEmpty()) {
			drawTabGroup(g);
			if (!tabsInline) {
				String sub = subtitle();
				if (sub != null) Ui.text(g, Ui.ellipsize(sub, right - contentX, Ui.Font.BODY), contentX, cy - 4, Ui.withAlpha(Ui.MUTED, fade), Ui.Font.BODY);
			}
			return;
		}
		String sub = subtitle();
		if (sub != null) Ui.text(g, Ui.ellipsize(sub, right - contentX, Ui.Font.BODY), contentX, cy - 4, Ui.withAlpha(Ui.MUTED, fade), Ui.Font.BODY);
	}

	/** Fläche hinter den Reitern und die Pille hinter dem aktiven; sie gleitet zum neuen Reiter */
	private void drawTabGroup(GuiGraphicsExtractor g) {
		ShellTab first = tabs.getFirst();
		ShellTab last = tabs.getLast();
		int y = first.getY();
		Ui.rect(g, first.getX() - 2, y - 2, last.getX() + last.getWidth() - first.getX() + 4, TAB_H + 4, (TAB_H + 4) / 2f, Ui.withAlpha(0x0AFFFFFF, fade));
		Ui.outline(g, first.getX() - 2, y - 2, last.getX() + last.getWidth() - first.getX() + 4, TAB_H + 4, (TAB_H + 4) / 2f, Ui.withAlpha(Ui.LINE, fade));
		ShellTab active = null;
		for (ShellTab tab : tabs) if (tab.selected()) active = tab;
		if (active == null) return;
		float targetX = active.getX();
		float targetW = active.getWidth();
		if (pillX < 0 || pillHead != page.head()) {
			pillX = targetX;
			pillW = targetW;
		}
		pillHead = page.head();
		pillX += (targetX - pillX) * 0.3f;
		pillW += (targetW - pillW) * 0.3f;
		if (Math.abs(targetX - pillX) < 0.3f) pillX = targetX;
		if (Math.abs(targetW - pillW) < 0.3f) pillW = targetW;
		Ui.rect(g, pillX, y, pillW, TAB_H, TAB_H / 2f, Ui.withAlpha(0x403B82F6, fade));
		Ui.outline(g, pillX, y, pillW, TAB_H, TAB_H / 2f, Ui.withAlpha(0x663B82F6, fade));
	}

	/** Zeichnung über den Widgets (z. B. Aufklapplisten) */
	protected void drawOverlay(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
	}

	// ======================================================================================
	// Tastatur
	// ======================================================================================

	/** Fokus kam per Tab auf ein Widget: dann gehören Enter und Pfeile ihm (bis zum nächsten Mausklick) */
	private boolean tabbed;

	protected boolean widgetKeyFocus() {
		return tabbed && getFocused() != null;
	}

	/** Widget mit der Tastatur wählen (wie per Tab) */
	protected void keyFocusWidget(net.minecraft.client.gui.components.events.GuiEventListener widget) {
		tabbed = true;
		setFocused(widget);
	}

	@Override
	public boolean mouseClicked(net.minecraft.client.input.MouseButtonEvent event, boolean doubleClick) {
		tabbed = false;
		return super.mouseClicked(event, doubleClick);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.key() == InputConstants.KEY_TAB && !event.hasControlDown()) tabbed = true;
		if ((event.hasControlDown() || event.hasControlDownWithQuirk()) && !event.hasAltDown()) {
			int key = event.key();
			if (key == InputConstants.KEY_K) {
				QuickSearchScreen.open(this);
				return true;
			}
			if (key == InputConstants.KEY_TAB) {
				cycle(event.hasShiftDown() ? -1 : 1);
				return true;
			}
			if (key >= InputConstants.KEY_1 && key <= InputConstants.KEY_4) {
				List<Shell.Section> sections = Shell.sections(inGame());
				int index = key - InputConstants.KEY_1;
				if (index < sections.size() && sections.get(index) != page.section) {
					Shell.open(minecraft, Shell.target(sections.get(index), inGame()), this);
				}
				return true;
			}
		}
		return super.keyPressed(event);
	}

	/** Strg+Tab: nächster Reiter der Seite; ohne Reiter die nächste Seite des Bereichs */
	private void cycle(int direction) {
		if (tabs.size() > 1) {
			int current = 0;
			for (int i = 0; i < tabs.size(); i++) if (tabs.get(i).selected()) current = i;
			tabs.get(Math.floorMod(current + direction, tabs.size())).spec().action().run();
			return;
		}
		List<ShellNavButton> pages = new ArrayList<>();
		for (ShellNavButton button : nav) {
			if (button.kind() == ShellNavButton.Kind.PAGE && !button.page().leavesShell()) pages.add(button);
		}
		if (pages.size() < 2) return;
		int current = 0;
		for (int i = 0; i < pages.size(); i++) if (pages.get(i).selected()) current = i;
		pages.get(Math.floorMod(current + direction, pages.size())).activate();
	}

	@Override
	public boolean isPauseScreen() {
		return true;
	}

	@Override
	public void tick() {
		super.tick();
		// Kontowechsel kam hinzu oder fiel weg (Launcher verbunden, Einstellung im Launcher): Navigation neu aufbauen
		if (Shell.accountsVisible() != accountsInNav) rebuildWidgets();
	}

	@Override
	public void onClose() {
		Shell.close(minecraft);
	}

	// ======================================================================================
	// Für den Autotest
	// ======================================================================================

	/** Seiten, die die Navigation anbietet (über alle Bereiche) */
	public List<String> navIds() {
		return Shell.navPages(inGame()).stream().map(Enum::name).toList();
	}

	/** Bereiche in der oberen Leiste */
	public List<String> sectionIds() {
		return nav.stream().filter(b -> b.kind() == ShellNavButton.Kind.CATEGORY).map(b -> b.section().name()).toList();
	}

	/** Seiten in der Leiste des offenen Bereichs */
	public List<String> pageBarIds() {
		return nav.stream().filter(b -> b.kind() == ShellNavButton.Kind.PAGE).map(b -> b.page().name()).toList();
	}

	/** Reiter stehen in der Werkzeugzeile neben den Knöpfen? */
	public boolean tabsInline() {
		return tabsInline;
	}

	/**
	 * Mitte des Reiters {@code name} (Unterseite wie PERFORMANCE, ADDONS, REQUESTS oder Reiter wie "filter:HUD");
	 * ist er nicht zu sehen, die Mitte seiner Seite in der Leiste, sonst die seines Bereichs (danach ist sie da).
	 */
	public int[] tabCenter(String name) {
		for (ShellTab tab : tabs) {
			if (tab.id().equals(name)) return center(tab);
		}
		Shell.Page target = Shell.Page.valueOf(name);
		for (ShellNavButton button : nav) {
			if (button.kind() == ShellNavButton.Kind.PAGE && button.page() == target.head()) return center(button);
		}
		for (ShellNavButton button : nav) {
			if (button.kind() == ShellNavButton.Kind.CATEGORY && button.section() == target.section) return center(button);
		}
		throw new IllegalStateException("Kein Eintrag " + name + " in der Navigation");
	}

	private static int[] center(AbstractWidget widget) {
		return new int[] {widget.getX() + widget.getWidth() / 2, widget.getY() + widget.getHeight() / 2};
	}
}
