package dev.heldixclient.screen;

import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

import java.util.Locale;
import java.util.function.Supplier;

/**
 * Karte auf der Startseite: {@link Style#HERO} ist die große blaue "Weiterspielen"-Karte,
 * {@link Style#TILE} eine Kachel mit Icon (Einzelspieler, Mehrspieler, Realms).
 */
public class StartCard extends AbstractButton {
	public enum Style {
		HERO,
		TILE
	}

	/** Inhalt der Karte; icon (optional) ersetzt das feste Icon, image (optional) zeigt ein 64×64-Bild (z. B. Welt-Vorschau) */
	public record Content(String title, String detail, boolean ready, String icon, Identifier image) {
		public Content(String title, String detail, boolean ready) {
			this(title, detail, ready, null, null);
		}

		public Content(String title, String detail, boolean ready, String icon) {
			this(title, detail, ready, icon, null);
		}
	}

	private final Style style;
	private final String label;
	private final String icon;
	private final int accent;
	private final Supplier<Content> content;
	private final Runnable action;
	/** Kachel: Icon und Text mittig untereinander (schmale Kacheln, damit die Namen nicht abgeschnitten werden) */
	private boolean centered;
	private float hover;

	/** Kachel mittig gestalten (Icon oben, Name und Detail darunter) */
	public StartCard centered(boolean centered) {
		this.centered = centered;
		return this;
	}

	public boolean isCentered() {
		return centered;
	}

	/** Breite, die eine Kachel nebeneinander (Icon links, Text rechts) für diesen Namen braucht */
	public static int inlineWidth(String label) {
		return 10 + 18 + 8 + Ui.width(label, Ui.Font.LABEL) + 8;
	}

	public StartCard(int x, int y, int width, int height, Style style, String label, String icon, int accent, Supplier<Content> content,
			Runnable action) {
		super(x, y, width, height, Component.literal(label));
		this.style = style;
		this.label = label;
		this.icon = icon;
		this.accent = accent;
		this.content = content;
		this.action = action;
	}

	@Override
	public void onPress(InputWithModifiers input) {
		if (content.get().ready()) action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		Content now = content.get();
		boolean hovered = isHoveredOrFocused() && now.ready();
		hover += ((hovered ? 1f : 0f) - hover) * 0.3f;
		if (style == Style.HERO) hero(g, now);
		else tile(g, now);
	}

	/** Große Karte: blaue Fläche, Icon im hellen Kreis, Titel und Detail, Pfeil rechts */
	private void hero(GuiGraphicsExtractor g, Content now) {
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		Ui.shadow(g, x, y, w, h, 0.35f * alpha);
		Ui.rect(g, x, y, w, h, 10, Ui.withAlpha(Ui.lerp(accent, Ui.ACCENT_HOVER, hover), alpha));
		Ui.hline(g, x + 10, x + w - 10, y + 0.5f, Ui.withAlpha(0x40FFFFFF, alpha));

		int circle = h - 16;
		if (now.image() != null) {
			// Vorschaubild der Welt bzw. Server-Icon, darüber ein kleiner Spielen-Knopf
			g.blit(RenderPipelines.GUI_TEXTURED, now.image(), x + 8, y + 8, 0, 0, circle, circle, 64, 64, 64, 64, Ui.withAlpha(0xFFFFFFFF, alpha));
			Ui.outline(g, x + 8, y + 8, circle, circle, 4, Ui.withAlpha(0x66FFFFFF, alpha));
			float r = Math.max(6, circle / 4f);
			float cx = x + 8 + circle - r + 2;
			float cy = y + 8 + circle - r + 2;
			Ui.circle(g, cx, cy, r, Ui.withAlpha(0xFFFFFFFF, alpha));
			Ui.icon(g, "play", cx - r * 0.55f + 0.5f, cy - r * 0.55f, r * 1.1f, Ui.withAlpha(accent, alpha));
		} else {
			Ui.circle(g, x + 8 + circle / 2f, y + h / 2f, circle / 2f, Ui.withAlpha(0x33FFFFFF, alpha));
			int iconSize = Math.max(10, circle / 2);
			String shown = now.icon() != null ? now.icon() : icon;
			Ui.icon(g, shown, x + 8 + (circle - iconSize) / 2f + (shown.equals("play") ? 1 : 0), y + (h - iconSize) / 2f, iconSize,
					Ui.withAlpha(0xFFFFFFFF, alpha));
		}

		int textX = x + 8 + circle + 10;
		int textW = w - (textX - x) - 24;
		boolean tall = h >= 40;
		int top = y + (h - (tall ? 32 : 22)) / 2;
		if (tall) {
			Ui.text(g, label.toUpperCase(Locale.ROOT), textX, top, Ui.withAlpha(0xCCFFFFFF, alpha), Ui.Font.SMALL);
			top += 10;
		}
		Ui.text(g, Ui.ellipsize(now.title(), textW, Ui.Font.LABEL), textX, top, Ui.withAlpha(0xFFFFFFFF, alpha), Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(now.detail(), textW, Ui.Font.SMALL), textX, top + 12, Ui.withAlpha(0xD9FFFFFF, alpha), Ui.Font.SMALL);
		if (now.ready()) {
			Ui.icon(g, "chevron-right", x + w - 20 + hover * 2, y + (h - 10) / 2f, 10, Ui.withAlpha(0xFFFFFFFF, alpha));
		}
	}

	/** Kachel: Glasfläche, farbiges Icon, Beschriftung und Detail */
	private void tile(GuiGraphicsExtractor g, Content now) {
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		// dunkle, fast deckende Fläche: der Hintergrund scheint nicht unruhig durch
		Ui.rect(g, x, y, w, h, 10, Ui.withAlpha(Ui.lerp(0xD90F1420, 0xE6161D2C, hover), alpha));
		Ui.outline(g, x, y, w, h, 10, Ui.withAlpha(Ui.lerp(Ui.LINE_STRONG, Ui.withAlpha(accent, 0.7f), hover), alpha));

		int box = h >= 56 ? 22 : 18;
		int iconSize = box >= 22 ? 12 : 10;
		// hoch genug: Icon oben, Text unten; mittig, wenn die Kachel schmal ist
		boolean vertical = h >= (centered ? 48 : 56);
		int bx = vertical && centered ? x + (w - box) / 2 : x + 10;
		int by = vertical ? y + (centered && h < 56 ? 7 : 10) : y + (h - box) / 2;
		Ui.rect(g, bx, by, box, box, 6, Ui.withAlpha((accent & 0xFFFFFF) | 0x33000000, alpha));
		Ui.icon(g, icon, bx + (box - iconSize) / 2f, by + (box - iconSize) / 2f, iconSize, Ui.withAlpha(Ui.lerp(0xFFFFFFFF, accent, 0.25f), alpha));

		if (vertical && centered) {
			int textW = w - 8;
			int labelY = y + h - (h < 56 ? 21 : 27);
			String name = Ui.ellipsize(label, textW, Ui.Font.LABEL);
			String detail = Ui.ellipsize(now.detail(), textW, Ui.Font.SMALL);
			Ui.text(g, name, x + (w - Ui.width(name, Ui.Font.LABEL)) / 2, labelY, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
			Ui.text(g, detail, x + (w - Ui.width(detail, Ui.Font.SMALL)) / 2, labelY + 11, Ui.withAlpha(Ui.MUTED, alpha), Ui.Font.SMALL);
			return;
		}
		int textX = vertical ? x + 10 : bx + box + 8;
		int textW = w - (textX - x) - 8;
		int labelY = vertical ? y + h - 27 : y + h / 2 - 10;
		Ui.text(g, Ui.ellipsize(label, textW, Ui.Font.LABEL), textX, labelY, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(now.detail(), textW, Ui.Font.SMALL), textX, labelY + 12, Ui.withAlpha(Ui.MUTED, alpha), Ui.Font.SMALL);
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
