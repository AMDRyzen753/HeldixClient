package dev.heldixclient.module.impl;

import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Theme;
import java.util.List;

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
		int color = Theme.TEXT;
		if (option("colored", true) && value.endsWith(" ms")) {
			int ms = Integer.parseInt(value.substring(0, value.length() - 3));
			color = ms <= 60 ? 0xFF86EFAC : ms <= 150 ? 0xFFFDE68A : 0xFFFCA5A5;
		}
		return drawLabelValue(g, mc.font, x, y, "Ping", value, color);
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.addFirst(toggle("colored", "Farbe nach Wert", "Grün bis 60 ms, gelb bis 150 ms, sonst rot", true));
		return settings;
	}
}
