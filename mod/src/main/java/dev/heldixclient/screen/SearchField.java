package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarratedElementType;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.sounds.SoundManager;
import net.minecraft.network.chat.Component;

import java.util.function.Consumer;

/** Suchfeld im Heldix-Design (Lupe, Platzhalter, eigene Schrift). Geschrieben wird immer am Ende. */
public class SearchField extends AbstractWidget {
	private static final int MAX_LENGTH = 48;

	private final String hint;
	private String value = "";
	private Consumer<String> responder = value -> {
	};
	private float hover;

	public SearchField(int x, int y, int width, int height, String hint) {
		super(x, y, width, height, Component.literal(hint));
		this.hint = hint;
	}

	public String getValue() {
		return value;
	}

	public void setValue(String value) {
		this.value = value == null ? "" : value;
	}

	public void setResponder(Consumer<String> responder) {
		this.responder = responder;
	}

	private void changed(String newValue) {
		if (newValue.length() > MAX_LENGTH) newValue = newValue.substring(0, MAX_LENGTH);
		if (newValue.equals(value)) return;
		value = newValue;
		responder.accept(value);
	}

	@Override
	protected void extractWidgetRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		hover += ((isHovered() || isFocused() ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		float r = h / 2f;
		Ui.rect(g, x, y, w, h, r, Ui.withAlpha(Ui.lerp(0x12FFFFFF, 0x1CFFFFFF, hover), alpha));
		Ui.outline(g, x, y, w, h, r, Ui.withAlpha(isFocused() ? Ui.ACCENT_LINE : Ui.LINE, alpha));
		int icon = 10;
		Ui.icon(g, "search", x + 7, y + (h - icon) / 2f, icon, Ui.withAlpha(isFocused() ? Ui.ACCENT_TEXT : Ui.FAINT, alpha));

		int textX = x + 7 + icon + 5;
		int textW = w - (textX - x) - (value.isEmpty() ? 8 : 18);
		int textY = y + (h - 8) / 2;
		if (value.isEmpty()) {
			Ui.text(g, Ui.ellipsize(hint, textW, Ui.Font.BODY), textX, textY, Ui.withAlpha(Ui.FAINT, alpha), Ui.Font.BODY);
		} else {
			// lange Eingaben: das Ende bleibt sichtbar
			String shown = value;
			while (shown.length() > 1 && Ui.width(shown, Ui.Font.BODY) > textW) shown = shown.substring(1);
			Ui.text(g, shown, textX, textY, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.BODY);
			textX += Ui.width(shown, Ui.Font.BODY);
			// Löschen-Kreuz rechts
			boolean overClear = Ui.inside(mouseX, mouseY, x + w - 16, y, 16, h);
			Ui.icon(g, "close", x + w - 13, y + (h - 8) / 2f, 8, Ui.withAlpha(overClear ? Ui.TEXT : Ui.FAINT, alpha));
		}
		if (isFocused() && (System.currentTimeMillis() / 530) % 2 == 0) {
			Ui.rect(g, textX + 1, textY - 1, 1, 10, 0, Ui.withAlpha(Ui.ACCENT_TEXT, alpha));
		}
	}

	@Override
	public void onClick(MouseButtonEvent event, boolean doubleClick) {
		if (!value.isEmpty() && event.x() >= getX() + getWidth() - 16) changed("");
	}

	@Override
	public void playDownSound(SoundManager soundManager) {
	}

	@Override
	public boolean charTyped(CharacterEvent event) {
		if (!isFocused() || !event.isAllowedChatCharacter()) return false;
		changed(value + event.codepointAsString());
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (!isFocused()) return false;
		int key = event.key();
		if (key == InputConstants.KEY_BACKSPACE) {
			if (value.isEmpty()) return true;
			if (event.hasControlDown()) {
				String trimmed = value.stripTrailing();
				int cut = trimmed.lastIndexOf(' ');
				changed(cut < 0 ? "" : trimmed.substring(0, cut + 1));
			} else {
				changed(value.substring(0, value.offsetByCodePoints(value.length(), -1)));
			}
			return true;
		}
		if (event.isPaste()) {
			String clip = Minecraft.getInstance().keyboardHandler.getClipboard().replaceAll("[\\r\\n\\t]", " ");
			changed(value + clip);
			return true;
		}
		if (key == InputConstants.KEY_ESCAPE && !value.isEmpty()) {
			changed("");
			return true;
		}
		// Zeichen kommen über charTyped; andere Tasten (Pfeile, Enter) gehen an die Seite
		return false;
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		output.add(NarratedElementType.TITLE, Component.literal(hint + (value.isEmpty() ? "" : ": " + value)));
	}
}
