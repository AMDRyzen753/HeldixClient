package dev.heldixclient.share;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/**
 * Einblendung im Spiel, solange jemand an die geteilte Welt anklopft: „<Name> möchte beitreten“ mit den Tasten für
 * Erlauben und Ablehnen (Standard H und N, in der Steuerung änderbar). Im Pausemenü gibt es dieselben Knöpfe zum Klicken.
 * Ab Heldix-Dienst 1.13.0 auch für dauerhafte Welten (Besitzer und Operatoren): „<Name> möchte in „<Welt>““.
 * Sitzt mittig über der Schnellleiste, damit sie nicht mit den Einblendungen oben rechts kollidiert.
 */
public final class KnockPrompt {
	private static final int HEIGHT = 36;

	private KnockPrompt() {
	}

	public static void render(GuiGraphicsExtractor g) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null || mc.gui.screen() != null) return;
		// zuerst die eigene geteilte Welt, dann dauerhafte Welten (Dienst 1.13.0) – dieselben Tasten
		WorldShare.Knock knock = WorldShare.currentKnock();
		Hosting.Knock hosted = knock == null ? Hosting.currentKnock() : null;
		if (knock == null && hosted == null) return;
		int count = WorldShare.knocks().size() + Hosting.knocks().size();
		String title = knock != null ? knock.name() + " möchte beitreten" : hosted.name() + " möchte in „" + hosted.worldName() + "“";
		String keys = "[" + HeldixClient.knockAllowKey.getTranslatedKeyMessage().getString() + "] Erlauben   ["
				+ HeldixClient.knockDenyKey.getTranslatedKeyMessage().getString() + "] Ablehnen";
		String more = count > 1 ? "  ·  +" + (count - 1) + " weitere" : "";
		long at = knock != null ? knock.at() : hosted.at();
		int textW = Math.max(Ui.width(title, Ui.Font.LABEL), Ui.width(keys + more, Ui.Font.SMALL));
		int w = Math.clamp(34 + textW + 12, 180, Math.max(180, g.guiWidth() - 20));
		int x = (g.guiWidth() - w) / 2;
		int y = g.guiHeight() - 59 - 18 - HEIGHT;
		long age = System.currentTimeMillis() - at;
		float in = Math.clamp(age / 200f, 0f, 1f);
		float alpha = 0.4f + 0.6f * in;
		Ui.shadow(g, x, y, w, HEIGHT, 0.45f * alpha);
		Ui.rect(g, x, y, w, HEIGHT, 9, Ui.withAlpha(0xF2121826, alpha));
		Ui.outline(g, x, y, w, HEIGHT, 9, Ui.withAlpha(Ui.ACCENT_LINE, alpha));
		Ui.rect(g, x + 7, y + 7, 22, 22, 6, Ui.withAlpha(Ui.ACCENT_SOFT, alpha));
		Ui.icon(g, "user-plus", x + 12, y + 12, 12, Ui.withAlpha(Ui.ACCENT_TEXT, alpha));
		Ui.text(g, Ui.ellipsize(title, w - 46, Ui.Font.LABEL), x + 36, y + 8, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(keys + more, w - 46, Ui.Font.SMALL), x + 36, y + 21, Ui.withAlpha(Ui.MUTED, alpha), Ui.Font.SMALL);
		// verbleibende Zeit als feine Linie unten
		float remaining = Math.clamp(1f - age / 120_000f, 0f, 1f);
		Ui.rect(g, x + 9, y + HEIGHT - 2.5f, (w - 18) * remaining, 1f, 0.5f, Ui.withAlpha(Ui.ACCENT_LINE, alpha));
	}

	/** Für den Autotest: wird die Einblendung gerade gezeigt? */
	public static boolean visible(Minecraft mc) {
		return mc.player != null && mc.gui.screen() == null && !mc.gui.hud.isHidden() && (WorldShare.currentKnock() != null || Hosting.currentKnock() != null);
	}
}
