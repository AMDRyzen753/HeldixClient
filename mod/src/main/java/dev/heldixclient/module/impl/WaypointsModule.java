package dev.heldixclient.module.impl;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.Setting;
import dev.heldixclient.ui.Theme;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.waypoint.Waypoints;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix4f;
import org.joml.Vector3fc;
import org.joml.Vector4f;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Wegpunkte: Taste B setzt einen an der eigenen Position, im Spiel erscheinen sie als Markierung mit Name und
 * Entfernung (auch durch Wände). Optional wird beim Tod ein Todespunkt gesetzt. Verwalten: Heldix-Menü → Wegpunkte.
 */
public class WaypointsModule extends Module {
	private boolean wasDead;
	/** Bildschirmpositionen der zuletzt gezeichneten Markierungen {x, y} (für den Autotest) */
	public static volatile List<float[]> lastMarkers = List.of();

	public WaypointsModule() {
		super("waypoints", "Wegpunkte", "Orte merken und im Spiel anzeigen, Taste B", true, 0, 0);
	}

	@Override
	public void tick(Minecraft mc) {
		while (HeldixClient.waypointKey.consumeClick()) {
			if (!isEnabled() || mc.player == null) continue;
			Waypoints.Waypoint waypoint = Waypoints.add(mc, "");
			if (waypoint != null) Notifications.show("waypoint", "Wegpunkt gesetzt", waypoint.name + " · " + waypoint.coordinates(), null);
		}
		boolean dead = mc.player != null && mc.player.isDeadOrDying();
		if (dead && !wasDead && isEnabled() && option("death", true)) {
			Waypoints.Waypoint waypoint = Waypoints.death(mc);
			if (waypoint != null) Notifications.show("waypoint", "Todespunkt gespeichert", waypoint.coordinates(), null);
		}
		wasDead = dead;
	}

	/** Markierungen ins HUD zeichnen (HudRenderer, vor den HUD-Elementen). */
	public void render(GuiGraphicsExtractor g, Minecraft mc) {
		lastMarkers = List.of();
		if (!isEnabled() || mc.player == null || mc.level == null) return;
		List<Waypoints.Waypoint> waypoints = Waypoints.visibleHere(mc);
		if (waypoints.isEmpty()) return;
		Camera camera = mc.gameRenderer.mainCamera();
		if (!camera.isInitialized()) return;
		Vec3 cam = camera.position();
		Matrix4f matrix = camera.getViewRotationProjectionMatrix(new Matrix4f());
		int width = g.guiWidth();
		int height = g.guiHeight();
		// Richtung der Bildschirm-Y-Achse je nach Grafik-API: Punkt über der Blickrichtung muss oben landen
		Vector3fc forward = camera.forwardVector();
		Vector3fc up = camera.upVector();
		Vector4f probe = matrix.transform(new Vector4f(forward.x() * 10 + up.x() * 3, forward.y() * 10 + up.y() * 3, forward.z() * 10 + up.z() * 3, 1));
		float yFlip = probe.w > 0 && probe.y / probe.w < 0 ? -1f : 1f;
		double maxDistance = option("maxDistance", 0.0);
		boolean showDistance = option("distance", true);

		record Marker(Waypoints.Waypoint waypoint, float x, float y, double distance) {
		}
		List<Marker> markers = new ArrayList<>();
		for (Waypoints.Waypoint waypoint : waypoints) {
			double dx = waypoint.x + 0.5 - cam.x;
			double dy = waypoint.y + 1.0 - cam.y;
			double dz = waypoint.z + 0.5 - cam.z;
			double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (maxDistance > 0 && distance > maxDistance) continue;
			Vector4f clip = matrix.transform(new Vector4f((float) dx, (float) dy, (float) dz, 1f));
			if (clip.w <= 0.05f) continue;
			float sx = (clip.x / clip.w * 0.5f + 0.5f) * width;
			float sy = (0.5f - yFlip * clip.y / clip.w * 0.5f) * height;
			if (sx < -40 || sx > width + 40 || sy < -40 || sy > height + 40) continue;
			markers.add(new Marker(waypoint, sx, sy, distance));
		}
		// ferne zuerst, damit nahe Markierungen oben liegen
		markers.sort(Comparator.comparingDouble(Marker::distance).reversed());
		lastMarkers = markers.stream().map(m -> new float[] {m.x(), m.y()}).toList();
		for (Marker marker : markers) {
			String label = marker.waypoint().name + (showDistance ? "  " + formatDistance(marker.distance()) : "");
			int textW = mc.font.width(label);
			int x = Math.round(marker.x());
			int y = Math.round(marker.y());
			int color = marker.waypoint().color;
			// Raute als Markierung, darüber eine kleine Box mit Name und Entfernung
			Ui.icon(g, marker.waypoint().death ? "close" : "pin", x - 6, y - 12, 12, color);
			int boxX = x - textW / 2 - 4;
			int boxY = y - 26;
			g.fill(boxX, boxY, boxX + textW + 8, boxY + 12, Theme.HUD_BG);
			g.fill(boxX, boxY + 11, boxX + textW + 8, boxY + 12, color);
			g.text(mc.font, label, boxX + 4, boxY + 2, Theme.TEXT, true);
		}
	}

	public static String formatDistance(double distance) {
		if (distance >= 10000) return String.format(java.util.Locale.ROOT, "%.1f km", distance / 1000);
		return Math.round(distance) + " m";
	}

	@Override
	public List<Setting> settings() {
		List<Setting> settings = super.settings();
		settings.add(toggle("distance", "Entfernung zeigen", "Neben dem Namen der Markierung", true));
		settings.add(toggle("death", "Todespunkt merken", "Beim Tod automatisch einen Wegpunkt setzen", true));
		settings.add(slider("maxDistance", "Sichtweite", "Weiter entfernte Wegpunkte ausblenden (0 = alle zeigen)", 0, 5000, 100, 0,
				v -> v <= 0 ? "alle" : Math.round(v) + " m"));
		return settings;
	}
}
