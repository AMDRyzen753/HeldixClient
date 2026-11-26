package dev.heldixclient.screen;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/**
 * Taste „HUD bedienen“: gibt die Maus frei, ohne den Chat zu öffnen. HUD-Elemente zeigen dann Tooltips und reagieren
 * auf Klicks. Kurz drücken: bleibt offen bis zum nächsten Druck oder Esc; gedrückt halten: endet beim Loslassen.
 * Klicks gehen nie ans Spiel (kein Angreifen, kein Platzieren). Das Spiel läuft weiter (kein Pausemenü).
 */
public class HudInteractScreen extends Screen {
	/** So lange gedrückt gilt als „halten“ (Loslassen beendet dann) */
	private static final long HOLD_MS = 350;
	private final long openedAt = System.currentTimeMillis();

	public HudInteractScreen() {
		super(Component.literal("HUD bedienen"));
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// kein Abdunkeln und keine Unschärfe: das Spiel bleibt zu sehen
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		super.extractRenderState(g, mouseX, mouseY, delta);
		String key = HeldixClient.hudKey.isUnbound() ? "Esc" : HeldixClient.hudKey.getTranslatedKeyMessage().getString() + " oder Esc";
		String hint = "HUD bedienen · Klicke auf ein Element · " + key + ": zurück";
		hint = Ui.ellipsize(hint, width - 40, Ui.Font.SMALL);
		int w = Ui.width(hint, Ui.Font.SMALL) + 26;
		int x = (width - w) / 2;
		int y = 6;
		Ui.rect(g, x, y, w, 14, 7, 0xD90F1420);
		Ui.outline(g, x, y, w, 14, 7, Ui.LINE_STRONG);
		Ui.icon(g, "mouse", x + 6, y + 3, 8, Ui.ACCENT_TEXT);
		Ui.text(g, hint, x + 18, y + 3, Ui.MUTED, Ui.Font.SMALL);
		HudInteraction.render(g);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		HudInteraction.click(event);
		// alles schlucken: nichts davon erreicht das Spiel
		return true;
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (HeldixClient.hudKey.matches(event) && System.currentTimeMillis() - openedAt > 120) {
			onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public boolean keyReleased(KeyEvent event) {
		if (HeldixClient.hudKey.matches(event) && System.currentTimeMillis() - openedAt >= HOLD_MS) {
			onClose();
			return true;
		}
		return super.keyReleased(event);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}
}
