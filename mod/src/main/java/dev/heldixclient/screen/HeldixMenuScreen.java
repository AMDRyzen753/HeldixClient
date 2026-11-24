package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.render.DebugOverlay;
import dev.heldixclient.render.Performance;
import dev.heldixclient.render.ShaderPreset;
import dev.heldixclient.render.Shaders;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Hauptmenü des Clients (Standard-Taste: Rechte Umschalttaste). Komplett selbst gezeichnet. */
public class HeldixMenuScreen extends Screen {
	private static final int PAD = 12;
	private static final int GAP = 6;
	private static final int CARD_H = 36;
	private static final int ADDON_H = 40;
	private static final int HEADER_H = 30;
	private static final int TAB_H = 18;
	private static final int BUTTON_H = 20;
	private static final int SMALL_BUTTON_W = 96;
	private static final int ADDON_DARK = 0xFF065F46;
	private static final int CHIP_H = 22;
	private static final int SECTION_H = 14;
	private static final int SECTION_GAP = 10;

	private enum Tab { MODULES, ADDONS, GRAPHICS }

	/** Schalter im Reiter Grafik */
	private enum GraphicsToggle { FPS_BOOST, BACKGROUND_FPS }

	private final Screen parent;
	private final long openedAt = System.nanoTime();
	private final Map<Module, Float> switchAnim = new HashMap<>();
	private final Map<GraphicsToggle, Float> toggleAnim = new HashMap<>();
	private long lastFrame = System.nanoTime();
	private Tab tab = Tab.MODULES;
	private double scroll;

	private int panelX;
	private int panelY;
	private int panelW;
	private int panelH;
	private int cols;
	private int cardW;
	private int contentY;
	private int contentH;

	public HeldixMenuScreen(Screen parent) {
		super(Component.literal(HeldixClient.NAME));
		this.parent = parent;
	}

	// ---------- Layout ----------

	private void layout() {
		panelW = Math.min(430, width - 24);
		cols = panelW >= 340 ? 2 : 1;
		cardW = (panelW - PAD * 2 - GAP * (cols - 1)) / cols;
		int chrome = PAD + HEADER_H + TAB_H + 8 + 12 + BUTTON_H + PAD;
		int maxContent = Math.max(CARD_H, height - 8 - chrome);
		contentH = Math.min(desiredContentHeight(), maxContent);
		contentH = Math.max(contentH, Math.min(3 * (CARD_H + GAP) - GAP, maxContent));
		panelH = chrome + contentH;
		panelX = (width - panelW) / 2;
		panelY = Math.max(4, (height - panelH) / 2);
		contentY = panelY + PAD + HEADER_H + TAB_H + 8;
		scroll = Math.clamp(scroll, 0, maxScroll());
	}

	private int desiredContentHeight() {
		if (tab == Tab.MODULES) {
			int rows = (ModuleManager.all().size() + cols - 1) / cols;
			return rows * (CARD_H + GAP) - GAP;
		}
		if (tab == Tab.GRAPHICS) return graphicsHeight();
		int rows = Math.max(1, AddonManager.addons().size());
		return rows * (ADDON_H + GAP) - GAP + 16;
	}

	// ---------- Layout: Reiter Grafik ----------

	private int chipCols() {
		return panelW >= 340 ? 3 : 2;
	}

	private int chipW() {
		return (panelW - PAD * 2 - GAP * (chipCols() - 1)) / chipCols();
	}

	private int chipRows() {
		return (ShaderPreset.values().length + chipCols() - 1) / chipCols();
	}

	private int chipX(int index) {
		return panelX + PAD + (index % chipCols()) * (chipW() + GAP);
	}

	private int chipY(int index) {
		return contentY - (int) scroll + SECTION_H + (index / chipCols()) * (CHIP_H + GAP);
	}

	/** Oberkante der Leistungs-Schalter */
	private int performanceY() {
		return contentY - (int) scroll + SECTION_H + chipRows() * (CHIP_H + GAP) - GAP + SECTION_GAP + SECTION_H;
	}

	private int toggleY(GraphicsToggle toggle) {
		return performanceY() + (toggle.ordinal() / cols) * (CARD_H + GAP);
	}

	private int graphicsHeight() {
		int toggleRows = (GraphicsToggle.values().length + cols - 1) / cols;
		return SECTION_H + chipRows() * (CHIP_H + GAP) - GAP + SECTION_GAP + SECTION_H + toggleRows * (CARD_H + GAP) - GAP + SECTION_GAP + 10;
	}

	private int maxScroll() {
		return Math.max(0, desiredContentHeight() - contentH);
	}

	private int cardX(int index) {
		return panelX + PAD + (index % cols) * (cardW + GAP);
	}

	private int cardY(int index) {
		return contentY + (index / cols) * (CARD_H + GAP) - (int) scroll;
	}

	private int footerY() {
		return panelY + panelH - PAD - BUTTON_H;
	}

	private int editButtonX() {
		return panelX + PAD;
	}

	private int backgroundButtonX() {
		return editButtonX() + 104 + GAP;
	}

	private int designButtonX() {
		return backgroundButtonX() + SMALL_BUTTON_W + GAP;
	}

	private int closeX() {
		return panelX + panelW - PAD - 12;
	}

	private int tabX(Tab t) {
		int x = panelX + PAD;
		for (Tab before : Tab.values()) {
			if (before == t) break;
			x += tabWidth(before) + 4;
		}
		return x;
	}

	private int tabWidth(Tab t) {
		return font.width(tabLabel(t)) + 16;
	}

	private String tabLabel(Tab t) {
		return switch (t) {
			case MODULES -> "Module  " + ModuleManager.all().size();
			case ADDONS -> "Addons  " + AddonManager.addons().size();
			case GRAPHICS -> "Grafik";
		};
	}

	private int tabY() {
		return panelY + PAD + HEADER_H;
	}

	private boolean insideContent(double mx, double my) {
		return mx >= panelX + PAD && mx < panelX + panelW - PAD && my >= contentY && my < contentY + contentH;
	}

	/** Mitte der Modul-Karte Nummer {@code index} in GUI-Koordinaten (für den Autotest). */
	public int[] cardCenter(int index) {
		layout();
		return new int[] {cardX(index) + cardW / 2, cardY(index) + CARD_H / 2};
	}

	/** Mitte des Reiters "Addons" in GUI-Koordinaten (für den Autotest). */
	public int[] addonsTabCenter() {
		layout();
		return new int[] {tabX(Tab.ADDONS) + tabWidth(Tab.ADDONS) / 2, tabY() + TAB_H / 2};
	}

	/** Mitte eines Reiters (MODULES, ADDONS, GRAPHICS) in GUI-Koordinaten (für den Autotest). */
	public int[] tabCenter(String name) {
		layout();
		Tab t = Tab.valueOf(name);
		return new int[] {tabX(t) + tabWidth(t) / 2, tabY() + TAB_H / 2};
	}

	/** Mitte der Shader-Kachel Nummer {@code index} im Reiter Grafik (für den Autotest). */
	public int[] shaderCenter(int index) {
		layout();
		return new int[] {chipX(index) + chipW() / 2, chipY(index) + CHIP_H / 2};
	}

	@Override
	protected void init() {
		layout();
	}

	// ---------- Zeichnen ----------

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// Glas-Effekt: Welt bzw. Panorama verschwimmt hinter dem Menü (Minecrafts eingebauter Blur)
		if (minecraft.level == null) extractPanorama(g, delta);
		extractBlurredBackground(g);
		float open = Draw.easeOut((System.nanoTime() - openedAt) / 200_000_000f);
		g.fillGradient(0, 0, width, height, Draw.lerp(0x00061226, 0x40061226, open), Draw.lerp(0x00030A18, 0x99030A18, open));
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		super.extractRenderState(g, mouseX, mouseY, delta);
		layout();
		long now = System.nanoTime();
		float dt = Math.min((now - lastFrame) / 1_000_000_000f, 0.1f);
		lastFrame = now;
		float open = Draw.easeOut((now - openedAt) / 220_000_000f);
		int offset = Math.round((1 - open) * 14);
		int my = mouseY - offset;

		g.pose().pushMatrix();
		g.pose().translate(0, offset);

		// Glas-Panel mit weichem Schatten
		Draw.rounded2(g, panelX - 2, panelY + 4, panelW + 4, panelH + 2, 0x40000814);
		Draw.glass(g, panelX, panelY, panelW, panelH, Theme.PANEL);

		// Kopfzeile
		int headY = panelY + PAD;
		Draw.badge(g, font, panelX + PAD, headY, 16);
		Component title = Component.literal("HELDIX").withStyle(ChatFormatting.BOLD);
		int titleX = panelX + PAD + 22;
		g.text(font, title, titleX, headY + 4, Theme.TEXT, false);
		g.text(font, "CLIENT", titleX + font.width(title) + 4, headY + 4, Theme.ACCENT_LIGHT, false);
		String version = "v" + HeldixClient.version;
		g.text(font, version, closeX() - 8 - font.width(version), headY + 4, Theme.FAINT, false);
		boolean closeHover = Draw.inside(mouseX, my, closeX() - 2, headY + 1, 14, 14);
		if (closeHover) Draw.rounded(g, closeX() - 2, headY + 1, 14, 14, Theme.CARD_HOVER);
		g.text(font, "×", closeX() + 2, headY + 4, closeHover ? Theme.TEXT : Theme.MUTED, false);
		g.fill(panelX + PAD, headY + 22, panelX + panelW - PAD, headY + 23, Theme.BORDER);

		// Reiter
		for (Tab t : Tab.values()) drawTab(g, t, mouseX, my);

		// Inhalt (scrollbar, abgeschnitten auf den Inhaltsbereich)
		g.enableScissor(panelX + PAD - 1, contentY + offset, panelX + panelW - PAD + 1, contentY + contentH + offset);
		if (tab == Tab.MODULES) {
			List<Module> modules = ModuleManager.all();
			for (int i = 0; i < modules.size(); i++) {
				drawCard(g, modules.get(i), cardX(i), cardY(i), mouseX, insideContent(mouseX, my) ? my : -1000, dt);
			}
		} else if (tab == Tab.GRAPHICS) {
			drawGraphics(g, mouseX, insideContent(mouseX, my) ? my : -1000, dt);
		} else {
			drawAddons(g);
		}
		g.disableScissor();
		drawScrollbar(g);

		// Fußzeile
		int fy = footerY();
		Draw.button(g, font, editButtonX(), fy, 104, BUTTON_H, "HUD bearbeiten", true, Draw.inside(mouseX, my, editButtonX(), fy, 104, BUTTON_H));
		String bgLabel = "HUD-Box: " + (HeldixConfig.get().hudBackground ? "An" : "Aus");
		Draw.button(g, font, backgroundButtonX(), fy, SMALL_BUTTON_W, BUTTON_H, bgLabel, false,
				Draw.inside(mouseX, my, backgroundButtonX(), fy, SMALL_BUTTON_W, BUTTON_H));
		String designLabel = "Design: " + (HeldixConfig.get().customMenus ? "Heldix" : "Vanilla");
		Draw.button(g, font, designButtonX(), fy, SMALL_BUTTON_W, BUTTON_H, designLabel, false,
				Draw.inside(mouseX, my, designButtonX(), fy, SMALL_BUTTON_W, BUTTON_H));
		String hint = "ESC schließt";
		if (designButtonX() + SMALL_BUTTON_W + 8 + font.width(hint) < panelX + panelW - PAD) {
			g.text(font, hint, panelX + panelW - PAD - font.width(hint), fy + 6, Theme.FAINT, false);
		}

		g.pose().popMatrix();
	}

	private void drawTab(GuiGraphicsExtractor g, Tab t, int mouseX, int mouseY) {
		int x = tabX(t);
		int y = tabY();
		int w = tabWidth(t);
		boolean active = tab == t;
		boolean hover = Draw.inside(mouseX, mouseY, x, y, w, TAB_H);
		if (active) Draw.glass(g, x, y, w, TAB_H, Theme.CARD_ACTIVE);
		else if (hover) Draw.rounded2(g, x, y, w, TAB_H, Theme.CARD_HOVER);
		g.text(font, tabLabel(t), x + 8, y + 5, active ? Theme.TEXT : Theme.MUTED, false);
		if (active) g.fill(x + 6, y + TAB_H - 2, x + w - 6, y + TAB_H - 1, Theme.ACCENT_LIGHT);
	}

	private void drawCard(GuiGraphicsExtractor g, Module module, int x, int y, int mouseX, int mouseY, float dt) {
		boolean on = module.isEnabled();
		boolean hover = Draw.inside(mouseX, mouseY, x, y, cardW, CARD_H);
		float t = switchAnim.getOrDefault(module, on ? 1f : 0f);
		t += ((on ? 1f : 0f) - t) * Math.min(1f, dt * 16f);
		switchAnim.put(module, t);
		boolean fromAddon = module.source() != null;

		int bg = on ? (hover ? Theme.CARD_ACTIVE_HOVER : Theme.CARD_ACTIVE) : (hover ? Theme.CARD_HOVER : Theme.CARD);
		Draw.rounded2(g, x, y, cardW, CARD_H, bg);
		Draw.outline2(g, x, y, cardW, CARD_H, Draw.lerp(Theme.BORDER, fromAddon ? 0x9034D399 : Theme.BORDER_ACCENT, t));
		g.fill(x + 3, y + 1, x + cardW - 3, y + 2, Theme.HIGHLIGHT);

		// Symbol: Anfangsbuchstabe; Addon-Module in Cyan
		int iconX = x + 8;
		int iconY = y + (CARD_H - 20) / 2;
		int iconOn = fromAddon ? Theme.ADDON : Theme.ACCENT;
		int iconOff = fromAddon ? ADDON_DARK : 0x33FFFFFF;
		Draw.rounded2(g, iconX, iconY, 20, 20, Draw.lerp(iconOff, iconOn, t));
		Component letter = Component.literal(module.name().substring(0, 1)).withStyle(ChatFormatting.BOLD);
		g.text(font, letter, iconX + (20 - font.width(letter)) / 2 + 1, iconY + 6, Theme.TEXT, false);

		int textX = iconX + 28;
		int textWidth = cardW - (textX - x) - 32;
		g.text(font, ellipsize(module.name(), textWidth), textX, y + 8, Theme.TEXT, false);
		String description = fromAddon ? module.source() : module.description();
		g.text(font, ellipsize(description, textWidth), textX, y + 20, fromAddon ? 0xFF6EE7B7 : Theme.MUTED, false);

		Draw.toggle(g, x + cardW - 28, y + (CARD_H - 10) / 2, t);
	}

	private void drawGraphics(GuiGraphicsExtractor g, int mouseX, int mouseY, float dt) {
		int x = panelX + PAD;
		int w = panelW - PAD * 2;
		ShaderPreset current = Shaders.current();

		// Shader-Stile
		Component shaderHead = Component.literal("SHADER").withStyle(ChatFormatting.BOLD);
		int headY = contentY - (int) scroll;
		g.text(font, shaderHead, x, headY + 2, Theme.ACCENT_LIGHT, false);
		int descX = x + font.width(shaderHead) + 8;
		g.text(font, ellipsize(current.label() + ": " + current.description(), x + w - descX), descX, headY + 2, Theme.MUTED, false);
		ShaderPreset[] presets = ShaderPreset.values();
		for (int i = 0; i < presets.length; i++) {
			int cx = chipX(i);
			int cy = chipY(i);
			boolean active = presets[i] == current;
			boolean hover = Draw.inside(mouseX, mouseY, cx, cy, chipW(), CHIP_H);
			Draw.rounded2(g, cx, cy, chipW(), CHIP_H,
					active ? (hover ? Theme.CARD_ACTIVE_HOVER : Theme.CARD_ACTIVE) : (hover ? Theme.CARD_HOVER : Theme.CARD));
			Draw.outline2(g, cx, cy, chipW(), CHIP_H, active ? Theme.BORDER_ACCENT : Theme.BORDER);
			String label = ellipsize(presets[i].label(), chipW() - 12);
			g.text(font, label, cx + (chipW() - font.width(label)) / 2, cy + 7, active ? Theme.TEXT : Theme.MUTED, false);
		}

		// Leistung
		int perfHeadY = performanceY() - SECTION_H;
		g.text(font, Component.literal("LEISTUNG").withStyle(ChatFormatting.BOLD), x, perfHeadY + 2, Theme.ACCENT_LIGHT, false);
		for (GraphicsToggle toggle : GraphicsToggle.values()) {
			drawToggle(g, toggle, cardX(toggle.ordinal()), toggleY(toggle), mouseX, mouseY, dt);
		}

		// Grafik-API (wird im Launcher eingestellt)
		GraphicsToggle[] toggles = GraphicsToggle.values();
		int infoY = toggleY(toggles[toggles.length - 1]) + CARD_H + SECTION_GAP;
		String info = "Grafik-API: " + DebugOverlay.backend() + "  ·  umstellen im Launcher (Einstellungen)  ·  Details mit F3";
		g.text(font, ellipsize(info, w), x, infoY, Theme.FAINT, false);
	}

	private boolean toggleOn(GraphicsToggle toggle) {
		return switch (toggle) {
			case FPS_BOOST -> Performance.boostEnabled();
			case BACKGROUND_FPS -> HeldixConfig.get().backgroundFps;
		};
	}

	private void drawToggle(GuiGraphicsExtractor g, GraphicsToggle toggle, int x, int y, int mouseX, int mouseY, float dt) {
		boolean on = toggleOn(toggle);
		boolean hover = Draw.inside(mouseX, mouseY, x, y, cardW, CARD_H);
		float t = toggleAnim.getOrDefault(toggle, on ? 1f : 0f);
		t += ((on ? 1f : 0f) - t) * Math.min(1f, dt * 16f);
		toggleAnim.put(toggle, t);

		Draw.rounded2(g, x, y, cardW, CARD_H, on ? (hover ? Theme.CARD_ACTIVE_HOVER : Theme.CARD_ACTIVE) : (hover ? Theme.CARD_HOVER : Theme.CARD));
		Draw.outline2(g, x, y, cardW, CARD_H, Draw.lerp(Theme.BORDER, Theme.BORDER_ACCENT, t));
		g.fill(x + 3, y + 1, x + cardW - 3, y + 2, Theme.HIGHLIGHT);
		boolean boost = toggle == GraphicsToggle.FPS_BOOST;
		String title = boost ? "FPS-Boost" : "Hintergrund-FPS";
		String description = boost
				? "Teure Grafik-Effekte aus"
				: HeldixConfig.get().backgroundFpsLimit + " FPS im Hintergrund";
		int iconX = x + 8;
		int iconY = y + (CARD_H - 20) / 2;
		Draw.rounded2(g, iconX, iconY, 20, 20, Draw.lerp(0x33FFFFFF, Theme.ACCENT, t));
		Component letter = Component.literal(boost ? "F" : "H").withStyle(ChatFormatting.BOLD);
		g.text(font, letter, iconX + (20 - font.width(letter)) / 2 + 1, iconY + 6, Theme.TEXT, false);
		int textX = iconX + 28;
		int textWidth = cardW - (textX - x) - 32;
		g.text(font, ellipsize(title, textWidth), textX, y + 8, Theme.TEXT, false);
		g.text(font, ellipsize(description, textWidth), textX, y + 20, Theme.MUTED, false);
		Draw.toggle(g, x + cardW - 28, y + (CARD_H - 10) / 2, t);
	}

	private void drawAddons(GuiGraphicsExtractor g) {
		List<LoadedAddon> addons = AddonManager.addons();
		int x = panelX + PAD;
		int w = panelW - PAD * 2;
		int y = contentY - (int) scroll;
		if (addons.isEmpty()) {
			g.centeredText(font, "Keine Addons installiert", panelX + panelW / 2, contentY + 14, Theme.TEXT);
			g.centeredText(font, "Lege Heldix-Addons (.jar) in den Ordner heldix-addons", panelX + panelW / 2, contentY + 30, Theme.MUTED);
			g.centeredText(font, "deiner Instanz oder installiere sie im Launcher.", panelX + panelW / 2, contentY + 42, Theme.MUTED);
		}
		for (LoadedAddon addon : addons) {
			boolean ok = addon.isActive();
			Draw.rounded2(g, x, y, w, ADDON_H, Theme.CARD);
			Draw.outline2(g, x, y, w, ADDON_H, ok ? 0x5034D399 : 0x70FB7185);
			g.fill(x + 3, y + 1, x + w - 3, y + 2, Theme.HIGHLIGHT);
			Draw.rounded2(g, x + 8, y + 10, 20, 20, ok ? Theme.ADDON : 0xFF9F1239);
			Component letter = Component.literal(addon.name().substring(0, 1).toUpperCase()).withStyle(ChatFormatting.BOLD);
			g.text(font, letter, x + 8 + (20 - font.width(letter)) / 2 + 1, y + 16, Theme.TEXT, false);

			String status = ok ? "Aktiv · " + addon.moduleCount() + (addon.moduleCount() == 1 ? " Modul" : " Module") : "Fehler";
			int statusW = font.width(status) + 12;
			int statusX = x + w - statusW - 8;
			Draw.rounded2(g, statusX, y + 8, statusW, 13, ok ? 0x3034D399 : 0x30FB7185);
			g.text(font, status, statusX + 6, y + 11, ok ? 0xFF6EE7B7 : 0xFFFDA4AF, false);

			int textX = x + 36;
			int textW = statusX - textX - 8;
			String headline = addon.name() + "  " + addon.version();
			g.text(font, ellipsize(headline, textW), textX, y + 9, Theme.TEXT, false);
			String line = ok ? addon.description() : addon.error();
			g.text(font, ellipsize(line == null ? "" : line, w - 44), textX, y + 23, ok ? Theme.MUTED : 0xFFFDA4AF, false);
			y += ADDON_H + GAP;
		}
		String footer = "Heldix Loader " + HeldixLoader.version() + "  ·  Addon-API " + HeldixApi.API_VERSION + "  ·  Ordner: " + AddonManager.ADDON_DIR;
		g.text(font, ellipsize(footer, w), x, Math.max(y, contentY + 58) - 2, Theme.FAINT, false);
	}

	private void drawScrollbar(GuiGraphicsExtractor g) {
		int max = maxScroll();
		if (max <= 0) return;
		int trackX = panelX + panelW - PAD + 4;
		int barH = Math.max(16, contentH * contentH / (contentH + max));
		int barY = contentY + (int) ((contentH - barH) * (scroll / max));
		g.fill(trackX, contentY, trackX + 2, contentY + contentH, 0x18FFFFFF);
		g.fill(trackX, barY, trackX + 2, barY + barH, Theme.ACCENT_LIGHT);
	}

	private String ellipsize(String text, int maxWidth) {
		if (font.width(text) <= maxWidth) return text;
		return font.plainSubstrByWidth(text, Math.max(0, maxWidth - font.width("…"))) + "…";
	}

	// ---------- Eingaben ----------

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (maxScroll() > 0) {
			scroll = Math.clamp(scroll - scrollY * 18, 0, maxScroll());
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (event.button() != InputConstants.MOUSE_BUTTON_LEFT) return super.mouseClicked(event, doubleClick);
		double mx = event.x();
		double my = event.y();

		if (Draw.inside(mx, my, closeX() - 2, panelY + PAD + 1, 14, 14)) {
			click();
			onClose();
			return true;
		}
		for (Tab t : Tab.values()) {
			if (Draw.inside(mx, my, tabX(t), tabY(), tabWidth(t), TAB_H)) {
				if (tab != t) {
					click();
					tab = t;
					scroll = 0;
				}
				return true;
			}
		}
		if (tab == Tab.MODULES && insideContent(mx, my)) {
			List<Module> modules = ModuleManager.all();
			for (int i = 0; i < modules.size(); i++) {
				if (Draw.inside(mx, my, cardX(i), cardY(i), cardW, CARD_H)) {
					click();
					modules.get(i).toggle();
					return true;
				}
			}
		}
		if (tab == Tab.GRAPHICS && insideContent(mx, my)) {
			ShaderPreset[] presets = ShaderPreset.values();
			for (int i = 0; i < presets.length; i++) {
				if (Draw.inside(mx, my, chipX(i), chipY(i), chipW(), CHIP_H)) {
					click();
					Shaders.select(presets[i]);
					return true;
				}
			}
			for (GraphicsToggle toggle : GraphicsToggle.values()) {
				if (Draw.inside(mx, my, cardX(toggle.ordinal()), toggleY(toggle), cardW, CARD_H)) {
					click();
					if (toggle == GraphicsToggle.FPS_BOOST) {
						Performance.setBoost(!Performance.boostEnabled());
					} else {
						HeldixConfig.get().backgroundFps = !HeldixConfig.get().backgroundFps;
						HeldixConfig.save();
					}
					return true;
				}
			}
		}
		int fy = footerY();
		if (Draw.inside(mx, my, editButtonX(), fy, 104, BUTTON_H)) {
			click();
			minecraft.gui.setScreen(new HudEditorScreen(this));
			return true;
		}
		if (Draw.inside(mx, my, backgroundButtonX(), fy, SMALL_BUTTON_W, BUTTON_H)) {
			click();
			HeldixConfig.get().hudBackground = !HeldixConfig.get().hudBackground;
			HeldixConfig.save();
			return true;
		}
		if (Draw.inside(mx, my, designButtonX(), fy, SMALL_BUTTON_W, BUTTON_H)) {
			click();
			HeldixConfig.get().customMenus = !HeldixConfig.get().customMenus;
			HeldixConfig.save();
			return true;
		}
		return super.mouseClicked(event, doubleClick);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (HeldixClient.menuKey.matches(event)) {
			onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	private void click() {
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
	}

	@Override
	public void onClose() {
		HeldixConfig.save();
		minecraft.gui.setScreen(parent);
	}
}
