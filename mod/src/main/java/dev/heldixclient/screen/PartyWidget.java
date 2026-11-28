package dev.heldixclient.screen;

import dev.heldixclient.social.Party;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

/**
 * Party-Abschnitt der Freunde-Leiste (Freunde-Karte im Pausemenü, Tafel „Freunde“ im Hauptmenü): „Party · 3 von 8“ mit
 * den Köpfen der Mitglieder und darunter der Leiter bzw. wohin er gegangen ist; ohne Party eine offene Einladung. Klick
 * öffnet die Seite Freunde → Party (dort Annehmen, Beitreten, Chat). Unsichtbar ohne Party und ohne Einladung.
 */
public class PartyWidget extends AbstractButton {
	private final Runnable action;
	private float hover;

	public PartyWidget(int x, int y, int width, int height, Runnable action) {
		super(x, y, width, height, Component.literal("Party"));
		this.action = action;
	}

	/** Gibt es etwas zu zeigen? (Party oder Einladung) */
	public static boolean hasContent() {
		return Party.active() || !Party.invites().isEmpty();
	}

	@Override
	public void onPress(InputWithModifiers input) {
		if (hasContent()) action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// Sichtbarkeit setzt der Bildschirm (Neuaufbau bzw. jedes Bild); hier nur nichts zeigen, wenn es nichts gibt
		active = hasContent();
		if (!active) return;
		Party.State party = Party.party();
		hover += ((isHoveredOrFocused() ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		Ui.rect(g, x, y, w, h, 8, Ui.withAlpha(Ui.lerp(0x1A3B82F6, 0x333B82F6, hover), alpha));
		Ui.outline(g, x, y, w, h, 8, Ui.withAlpha(Ui.ACCENT_LINE, alpha * (0.5f + 0.5f * hover)));
		int size = Math.min(18, h - 10);
		int fy = y + (h - size) / 2;
		Ui.rect(g, x + 6, fy, size, size, 5, Ui.withAlpha(Ui.ACCENT_SOFT, alpha));
		Ui.icon(g, "headphones", x + 6 + (size - 10) / 2f, fy + (size - 10) / 2f, 10, Ui.withAlpha(Ui.ACCENT_TEXT, alpha));
		int textX = x + 6 + size + 8;
		String title;
		String detail;
		int detailColor = Ui.MUTED;
		int faces = 0;
		if (party != null) {
			faces = Math.min(4, party.members().size());
			title = "Party · " + party.members().size() + " von " + party.max();
			Party.Location target = Party.leaderTarget();
			Party.Member leader = party.leaderMember();
			if (target != null && leader != null) {
				detail = leader.name() + " ist " + (target.world() ? "in der " + target.shown() : "auf " + target.title()) + " · Beitreten";
				detailColor = Ui.ACCENT_TEXT;
			} else {
				int unread = Party.unreadChat();
				detail = unread > 0 ? unread + (unread == 1 ? " neue Nachricht" : " neue Nachrichten") : "Leiter: " + (leader != null ? leader.name() : "?");
				if (unread > 0) detailColor = Ui.ACCENT_TEXT;
			}
		} else {
			Party.Invite invite = Party.invites().getLast();
			title = invite.fromName() + " lädt dich ein";
			detail = "In die Party · Annehmen";
			detailColor = Ui.ACCENT_TEXT;
		}
		int facesW = faces == 0 ? 0 : 12 + (faces - 1) * 9 + 6;
		int textW = w - (textX - x) - 8 - facesW;
		for (int i = 0; i < faces; i++) {
			Party.Member member = party.members().get(i);
			FriendWidget.face(g, member.uuid(), member.name(), x + w - 8 - 12 - (faces - 1 - i) * 9, y + (h - 12) / 2, 12, alpha * (member.online() ? 1f : 0.5f));
		}
		Ui.text(g, Ui.ellipsize(title, textW, Ui.Font.LABEL), textX, y + h / 2 - 10, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(detail, textW, Ui.Font.SMALL), textX, y + h / 2 + 2, Ui.withAlpha(detailColor, alpha), Ui.Font.SMALL);
		setMessage(Component.literal(title + ", " + detail));
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
