package dev.heldixclient.module.impl;

import dev.heldixclient.api.HudHover;
import dev.heldixclient.hud.HudInteraction;
import dev.heldixclient.hud.HudPointer;
import dev.heldixclient.module.HudModule;
import dev.heldixclient.module.Setting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;

import java.util.List;

/** Latenz zum Server in ms, farbig nach Wert; im Einzelspieler „lokal“. Klick öffnet die Einstellungen. */
public class PingModule extends HudModule {
	public PingModule() {
		super("ping", "Ping", "Latenz zum Server", false, 4, 40);
	}

	/** Latenz in ms, -1 = unbekannt, -2 = Einzelspieler */
	static int latency(Minecraft mc) {
		if (mc.player == null) return -1;
		if (mc.isLocalServer()) return -2;
		ClientPacketListener connection = mc.getConnection();
		if (connection == null) return -1;
		PlayerInfo info = connection.getPlayerInfo(mc.player.getUUID());
		return info != null ? info.getLatency() : -1;
	}

	static String quality(int ms) {
		return ms <= 60 ? "gut" : ms <= 150 ? "mittel" : "hoch";
	}

	@Override
	protected long draw(GuiGraphicsExtractor g, Minecraft mc, int x, int y) {
		int ms = latency(mc);
		if (ms == -1 && isPreviewing()) ms = 42;
		String value = ms == -2 ? "lokal" : ms < 0 ? "–" : ms + " ms";
		if (option("colored", true) && ms >= 0) {
			int color = ms <= 60 ? FpsModule.GOOD : ms <= 150 ? FpsModule.OK : FpsModule.BAD;
			return drawLabelValue(g, mc.font, x, y, "Ping", value, color);
		}
		return drawLabelValue(g, mc.font, x, y, "Ping", value);
	}

	@Override
	public void onHover(Minecraft mc, HudPointer pointer) {
		int ms = latency(mc);
		ServerData server = mc.getCurrentServer();
		String where = mc.isLocalServer() ? "Einzelspieler (kein Netzwerk)" : server != null ? "Server: " + server.ip : "Kein Server";
		String value = ms >= 0 ? ms + " ms (" + quality(ms) + ")" : ms == -2 ? "lokal" : "unbekannt";
		pointer.tooltip("Ping " + value, where, "Klick: Einstellungen des Moduls");
		pointer.cursor(HudHover.Cursor.HAND);
	}

	@Override
	public boolean onClick(Minecraft mc, HudPointer pointer) {
		if (pointer.button() != 0) return false;
		HudInteraction.openSettings(mc, this);
		return true;
	}

	@Override
	public List<Setting> styleOptions() {
		List<Setting> options = super.styleOptions();
		options.add(toggle("colored", "Farbe nach Wert", "", true));
		return options;
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.addFirst(toggle("colored", "Farbe nach Wert", "Grün bis 60 ms, gelb bis 150 ms, sonst rot", true));
		return settings;
	}
}
