package dev.heldixclient.ui;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.social.Messages;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;

/**
 * Die 8 Reaktionen im Chat als eigene, farbige Zeichen (Minecraft hat keine Emoji): je ID ein Feld von 64 × 64 Pixeln in
 * {@code textures/gui/heldix/reactions.png} (512 × 64, Reihenfolge wie {@link Messages#REACTIONS}: Daumen hoch, Herz,
 * Lachen, Staunen, Traurig, Party, Feuer, Augen). Gezeichnet mit weicher Filterung wie die Icons, an Bildschirm-Pixeln
 * ausgerichtet. Erzeugt von {@code mod/tools/RenderReactions.java}.
 */
public final class ReactionIcons {
	private static final Identifier ATLAS = HeldixClient.id("textures/gui/heldix/reactions.png");
	private static final int CELL = 64;

	private ReactionIcons() {
	}

	/** Reaktion {@code id} (z. B. "love") auf size × size GUI-Pixeln; unbekannte IDs zeichnen nichts */
	public static void draw(GuiGraphicsExtractor g, String id, float x, float y, float size, float alpha) {
		int index = Messages.REACTIONS.indexOf(id);
		if (index < 0) return;
		Ui.linearTexture(ATLAS);
		int s = Ui.scale();
		int ps = Math.round(size * s);
		g.pose().pushMatrix();
		g.pose().scale(1f / s, 1f / s);
		g.blit(RenderPipelines.GUI_TEXTURED, ATLAS, Math.round(x * s), Math.round(y * s), index * CELL, 0, ps, ps, CELL, CELL,
				CELL * Messages.REACTIONS.size(), CELL, Ui.withAlpha(0xFFFFFFFF, alpha));
		g.pose().popMatrix();
	}
}
