package dev.heldixclient.social;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.share.KnockPrompt;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/**
 * Einblendung im Spiel für die Party (ab Heldix-Dienst 1.12.0): „<Leiter> ist auf <Ziel>“ mit [H] Beitreten / [N]
 * Ausblenden bzw. „<Name> lädt dich in die Party ein“ mit [H] Annehmen / [N] Ablehnen. Es sind dieselben Tasten wie beim
 * Anklopfen an die geteilte Welt (Steuerung: „Einblendung: annehmen“ / „ablehnen“); klopft gerade jemand an, hat das
 * Vorrang und diese Einblendung steht darüber. 30 Sekunden sichtbar, danach bleibt alles auf der Seite Freunde → Party.
 * Bei „Nicht stören“ bzw. ausgeschalteten Einblendungen erscheint nichts (siehe {@link Party#prompt()}).
 */
public final class PartyPrompt {
	private static final int HEIGHT = 36;

	private PartyPrompt() {
	}

	public static void render(GuiGraphicsExtractor g) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null || mc.gui.screen() != null) return;
		Party.Prompt prompt = Party.prompt();
		if (prompt == null) return;
		String title;
		String yes;
		String no;
		long at;
		String icon;
		if (prompt.follow() != null) {
			Party.Follow follow = prompt.follow();
			title = follow.leaderName() + (follow.target().world() ? " ist in der " + follow.target().shown() : " ist auf " + follow.target().title());
			yes = "Beitreten";
			no = "Ausblenden";
			at = follow.at();
			icon = "play";
		} else {
			Party.Invite invite = prompt.invite();
			title = invite.fromName() + " lädt dich in die Party ein";
			yes = "Annehmen";
			no = "Ablehnen";
			at = invite.at() > 0 ? Math.min(invite.at(), System.currentTimeMillis()) : System.currentTimeMillis();
			icon = "friends";
		}
		String keys = "[" + HeldixClient.knockAllowKey.getTranslatedKeyMessage().getString() + "] " + yes + "   ["
				+ HeldixClient.knockDenyKey.getTranslatedKeyMessage().getString() + "] " + no;
		// solange jemand anklopft, nehmen die Tasten das Anklopfen – dann nur als Hinweis
		boolean knock = KnockPrompt.visible(mc);
		if (knock) keys = "Nach dem Anklopfen: " + keys;
		int textW = Math.max(Ui.width(title, Ui.Font.LABEL), Ui.width(keys, Ui.Font.SMALL));
		int w = Math.clamp(34 + textW + 12, 180, Math.max(180, g.guiWidth() - 20));
		int x = (g.guiWidth() - w) / 2;
		int y = g.guiHeight() - 59 - 18 - HEIGHT - (knock ? HEIGHT + 6 : 0);
		long age = Math.max(0, System.currentTimeMillis() - at);
		float in = Math.clamp(age / 200f, 0f, 1f);
		float alpha = (0.4f + 0.6f * in) * (knock ? 0.75f : 1f);
		Ui.shadow(g, x, y, w, HEIGHT, 0.45f * alpha);
		Ui.rect(g, x, y, w, HEIGHT, 9, Ui.withAlpha(0xF2121826, alpha));
		Ui.outline(g, x, y, w, HEIGHT, 9, Ui.withAlpha(Ui.ACCENT_LINE, alpha));
		Ui.rect(g, x + 7, y + 7, 22, 22, 6, Ui.withAlpha(Ui.ACCENT_SOFT, alpha));
		Ui.icon(g, icon, x + 12, y + 12, 12, Ui.withAlpha(Ui.ACCENT_TEXT, alpha));
		Ui.text(g, Ui.ellipsize(title, w - 46, Ui.Font.LABEL), x + 36, y + 8, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(keys, w - 46, Ui.Font.SMALL), x + 36, y + 21, Ui.withAlpha(Ui.MUTED, alpha), Ui.Font.SMALL);
		float remaining = Math.clamp(1f - age / 30_000f, 0f, 1f);
		Ui.rect(g, x + 9, y + HEIGHT - 2.5f, (w - 18) * remaining, 1f, 0.5f, Ui.withAlpha(Ui.ACCENT_LINE, alpha));
	}

	/** Für den Autotest: wird die Einblendung gerade gezeigt? */
	public static boolean visible(Minecraft mc) {
		return mc.player != null && mc.gui.screen() == null && !mc.gui.hud.isHidden() && Party.prompt() != null;
	}
}
