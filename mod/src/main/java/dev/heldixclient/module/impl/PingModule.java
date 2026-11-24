package dev.heldixclient.module.impl;

import dev.heldixclient.module.HudModule;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;

public class PingModule extends HudModule {
	public PingModule() {
		super("ping", "Ping", "Latenz zum Server", false, 4, 40);
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		String value = "-";
		ClientPacketListener connection = mc.getConnection();
		if (connection != null && mc.player != null) {
			PlayerInfo info = connection.getPlayerInfo(mc.player.getUUID());
			if (info != null) value = info.getLatency() + " ms";
		}
		return drawLabelValue(g, mc.font, x, y, "Ping", value);
	}
}
