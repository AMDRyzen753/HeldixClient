package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.ui.Keys;
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
	private int maxLength = 48;

	private final String hint;
	private String value = "";
	private Consumer<String> responder = value -> {
	};
	private float hover;
	private String icon = "search";
	private Runnable onEnter;
	private boolean clearOnEscape = true;

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

	/** anderes Icon links (Standard: Lupe) */
	public SearchField withIcon(String icon) {
		this.icon = icon;
		return this;
	}

	/** höchstens so viele Zeichen (Standard 48) */
	public SearchField withMaxLength(int maxLength) {
		this.maxLength = maxLength;
		return this;
	}

	/** Esc leert das Feld nicht (z. B. für gespeicherte Einstellungen) */
	public SearchField keepOnEscape() {
		this.clearOnEscape = false;
		return this;
	}

	/** Enter im Feld löst das aus (z. B. „Anfrage senden“) */
	public void setOnEnter(Runnable onEnter) {
		this.onEnter = onEnter;
	}

	private void changed(String newValue) {
		if (newValue.length() > maxLength) newValue = newValue.substring(0, maxLength);
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
		int iconSize = 10;
		Ui.icon(g, icon, x + 7, y + (h - iconSize) / 2f, iconSize, Ui.withAlpha(isFocused() ? Ui.ACCENT_TEXT : Ui.FAINT, alpha));

		int textX = x + 7 + iconSize + 5;
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

	/**
	 * Seit Minecraft 26.x kommen getippte Zeichen nur an, wenn ein Feld die Texteingabe beim Fenster anmeldet
	 * (wie EditBox). Ohne das bleibt das Feld stumm, obwohl es ausgewählt aussieht.
	 */
	@Override
	public void setFocused(boolean focused) {
		if (!isFocused() && !focused) return;
		super.setFocused(focused);
		Minecraft.getInstance().onTextInputFocusChange(this, focused);
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
			// Mac: ⌘⌫ löscht alles, ⌥⌫ das letzte Wort; sonst Strg+Rück das letzte Wort
			if (Keys.MAC && event.hasControlDownWithQuirk()) {
				changed("");
			} else if (event.hasControlDown() || (Keys.MAC && event.hasAltDown())) {
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
		if ((key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) && onEnter != null) {
			onEnter.run();
			return true;
		}
		if (key == InputConstants.KEY_ESCAPE && !value.isEmpty() && clearOnEscape) {
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
