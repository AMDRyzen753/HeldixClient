package dev.heldixclient.social;

import dev.heldixclient.HeldixClient;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

/**
 * Das Heldix-Symbol als Schriftzeichen (U+E000 in der Schrift heldixclient:badge, erzeugt von
 * launcher/scripts/render-ui-assets.mjs). Als Text funktioniert es überall, wo Minecraft Namen zeigt.
 */
public final class Badge {
	public static final String CHAR = "";
	private static final FontDescription FONT = new FontDescription.Resource(HeldixClient.id("badge"));

	private Badge() {
	}

	/** Das Symbol allein (weiß, damit es nicht von Teamfarben eingefärbt wird) */
	public static MutableComponent symbol() {
		return Component.literal(CHAR).withStyle(Style.EMPTY.withFont(FONT).withColor(0xFFFFFF));
	}

	/** Symbol + Leerzeichen + Name */
	public static Component prefix(Component name) {
		return Component.empty().append(symbol()).append(Component.literal(" ")).append(name);
	}
}
