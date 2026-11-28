package dev.heldixclient.screen;

import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;

import java.util.List;

/**
 * Schmale Zeile „● 2 Freunde online“ mit den Köpfen der Freunde – für Fenster, in denen keine Freunde-Tafel Platz hat.
 * Klick öffnet die Seite Freunde. Sichtbar nur mit Verbindung zum Heldix-Dienst und mindestens einem Freund.
 */
public class FriendsStrip extends AbstractButton {
	private final Runnable action;
	private float hover;

	public FriendsStrip(int x, int y, int width, int height, Runnable action) {
		super(x, y, width, height, Component.literal("Freunde"));
		this.action = action;
	}

	/** Gibt es etwas zu zeigen? */
	public static boolean hasContent() {
		return Social.online() && !Social.friends().isEmpty();
	}

	@Override
	public void onPress(InputWithModifiers input) {
		// hat ein Freund eine Welt geöffnet: direkt zu Heldix-Welten (dort „Beitreten“)
		net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
		if (mc.level == null && Social.online() && !dev.heldixclient.share.WorldInvites.open().isEmpty()) {
			dev.heldixclient.ui.Shell.open(mc, dev.heldixclient.ui.Shell.Page.HELDIX_WORLDS, mc.gui.screen());
			return;
		}
		action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		List<Social.Friend> friends = Social.online() ? Social.friends() : List.of();
		List<Social.Friend> online = friends.stream().filter(Social.Friend::online).toList();
		hover += ((isHoveredOrFocused() ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int h = getHeight();
		String text = online.isEmpty() ? "Keine Freunde online" : online.size() == 1 ? online.getFirst().shownName() + " ist online"
				: online.size() + " Freunde online";
		// Party (ab Heldix-Dienst 1.12.0) bzw. eine Einladung vorne
		dev.heldixclient.social.Party.State party = dev.heldixclient.social.Party.party();
		if (party != null) text = "Party " + party.members().size() + "/" + party.max() + "  ·  " + text;
		else if (!dev.heldixclient.social.Party.invites().isEmpty()) text = dev.heldixclient.social.Party.invites().getLast().fromName() + " lädt dich in die Party ein  ·  " + text;
		// geteilte Welt eines Freundes: „In Welt von X · Beitreten“
		List<dev.heldixclient.share.WorldService.FriendWorld> worlds = Social.online() ? dev.heldixclient.share.WorldInvites.open() : List.of();
		if (!worlds.isEmpty()) {
			text = worlds.size() == 1 ? "In Welt von " + worlds.getFirst().hostName() + "  ·  Beitreten" : worlds.size() + " Welten von Freunden offen  ·  Beitreten";
		}
		int faces = Math.min(4, online.size());
		int facesW = faces == 0 ? 0 : 12 + (faces - 1) * 9 + 6;
		int w = 22 + facesW + Ui.width(text, Ui.Font.SMALL) + 18;
		// mittig in der Fläche des Widgets
		int bx = x + (getWidth() - w) / 2;
		Ui.rect(g, bx, y, w, h, h / 2f, Ui.withAlpha(Ui.lerp(0xB30F1420, 0xD9182033, hover), alpha));
		Ui.outline(g, bx, y, w, h, h / 2f, Ui.withAlpha(Ui.LINE_STRONG, alpha));
		Ui.circle(g, bx + 11, y + h / 2f, 3f, Ui.withAlpha(online.isEmpty() ? Ui.FAINT : Ui.SUCCESS, alpha));
		int fx = bx + 20;
		for (int i = 0; i < faces; i++) {
			Social.Friend friend = online.get(i);
			FriendWidget.face(g, friend.uuid(), friend.name(), fx + i * 9, y + (h - 12) / 2, 12, alpha);
		}
		Ui.text(g, text, bx + 20 + facesW, y + (h - 8) / 2, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.SMALL);
		Ui.icon(g, "chevron-right", bx + w - 14, y + (h - 8) / 2f, 8, Ui.withAlpha(Ui.FAINT, alpha));
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}
}
