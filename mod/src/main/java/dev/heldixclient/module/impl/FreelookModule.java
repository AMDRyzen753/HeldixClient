package dev.heldixclient.module.impl;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.Setting;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;

import java.util.List;
import java.util.Locale;

/**
 * Freelook: Solange die Taste gedrückt ist (Standard: Linke Alt), dreht die Maus nur die Kamera – der Spieler
 * läuft und schaut weiter in seine Richtung. Dazu fangen Hooks die Mausbewegung ab (Entity.turn) und geben der
 * Kamera eigene Winkel (Camera.alignWithEntity).
 */
public class FreelookModule extends Module {
	private static final List<String> MODES = List.of("Halten", "Umschalten");
	/** Server, deren Regeln Freelook nicht erlauben: dort bleibt es aus */
	private static final List<String> BLOCKED_SERVERS = List.of("hypixel.net");

	private boolean active;
	private boolean toggled;
	private float yaw;
	private float pitch;
	/** Kameraperspektive vor dem Freelook (null = nicht umgestellt) */
	private CameraType savedCamera;
	private String blockedNoticeFor;

	public FreelookModule() {
		super("freelook", "Freelook", "Frei umschauen ohne die Laufrichtung zu ändern", false, 0, 0);
	}

	@Override
	public void tick(Minecraft mc) {
		boolean hold = (int) option("mode", 0) == 0;
		while (HeldixClient.freelookKey.consumeClick()) {
			if (!hold && isEnabled()) toggled = !toggled;
		}
		if (hold) toggled = false;
		boolean want = isEnabled() && mc.player != null
				&& (hold ? HeldixClient.freelookKey.isDown() && mc.gui.screen() == null : toggled);
		if (want && blockedServer(mc) != null) {
			String server = blockedServer(mc);
			if (!server.equals(blockedNoticeFor)) {
				blockedNoticeFor = server;
				Notifications.show("freelook", "Freelook", "Auf " + server + " ist Freelook abgeschaltet (Serverregeln).", null);
			}
			want = false;
			toggled = false;
		}
		if (want && !active) start(mc);
		else if (!want && active) stop(mc);
	}

	private void start(Minecraft mc) {
		active = true;
		yaw = mc.player.getYRot();
		pitch = mc.player.getXRot();
		if (option("thirdPerson", true) && mc.options.getCameraType().isFirstPerson()) {
			savedCamera = mc.options.getCameraType();
			mc.options.setCameraType(CameraType.THIRD_PERSON_BACK);
		}
	}

	private void stop(Minecraft mc) {
		active = false;
		if (savedCamera != null) {
			mc.options.setCameraType(savedCamera);
			savedCamera = null;
		}
	}

	@Override
	protected void onDisable() {
		toggled = false;
		if (active) stop(Minecraft.getInstance());
	}

	/** Name des Servers, auf dem Freelook nicht erlaubt ist (null = erlaubt) */
	private static String blockedServer(Minecraft mc) {
		ServerData server = mc.getCurrentServer();
		if (server == null || server.ip == null) return null;
		String host = server.ip.toLowerCase(Locale.ROOT).trim();
		int colon = host.lastIndexOf(':');
		if (colon > 0 && host.indexOf(':') == colon) host = host.substring(0, colon);
		if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
		for (String blocked : BLOCKED_SERVERS) {
			if (host.equals(blocked) || host.endsWith("." + blocked)) return blocked;
		}
		return null;
	}

	public boolean isActive() {
		return active;
	}

	/** Hook Entity.turn: Mausbewegung dreht nur die Kamera. true = Vanilla überspringen. */
	public boolean turn(Entity entity, double yawDelta, double pitchDelta) {
		if (!active || entity != Minecraft.getInstance().player) return false;
		yaw += (float) yawDelta * 0.15f;
		pitch = Mth.clamp(pitch + (float) pitchDelta * 0.15f, -90f, 90f);
		return true;
	}

	/** Hook Camera.alignWithEntity: Blickwinkel der Kamera */
	public float cameraYaw(Entity entity, float partialTick) {
		return active && entity == Minecraft.getInstance().player ? yaw : entity.getViewYRot(partialTick);
	}

	public float cameraPitch(Entity entity, float partialTick) {
		return active && entity == Minecraft.getInstance().player ? pitch : entity.getViewXRot(partialTick);
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(choice("mode", "Taste", "Halten oder einmal drücken zum Ein- und Ausschalten", MODES, 0));
		settings.add(toggle("thirdPerson", "Dritte Person", "Beim Umschauen von hinten auf den Spieler sehen", true));
		return settings;
	}
}
