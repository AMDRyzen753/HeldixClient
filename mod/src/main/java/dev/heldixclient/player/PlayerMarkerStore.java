package dev.heldixclient.player;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.LightCoordsUtil;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Symbole anderer Spieler (Addon-API {@code playerMarkers()}), z. B. „spricht“ im Voice Chat. Je Spieler und Addon eines,
 * mit Ablaufzeit, an zwei Stellen:
 * <ul>
 * <li>hinter dem Namen im Namensschild (API 6) – als Schriftzeichen im Namen, Minecraft behandelt es wie den Namen;</li>
 * <li>über dem Kopf (API 7) – als runde Plakette über dem Namensschild: dunkle Fläche (Zeichen „disc“), farbiger Rand
 * („ring“) und das Symbol; gezeichnet am Anfang von EntityRenderer.submit, nur wenn Minecraft das Namensschild zeigt.</li>
 * </ul>
 * Beide nutzen die Schrift heldixclient:marker (alle Heldix-Icons, U+E100 + Nummer).
 */
public final class PlayerMarkerStore {
	private record Marker(int glyph, int color, long until, long since) {
	}

	private static final FontDescription FONT = new FontDescription.Resource(HeldixClient.id("marker"));
	/** Spieler → Addon → Symbol hinter dem Namen (Addons in fester Reihenfolge, damit die Symbole nicht springen) */
	private static final Map<UUID, Map<String, Marker>> MARKERS = new ConcurrentHashMap<>();
	/** Spieler → Addon → Symbol über dem Kopf */
	private static final Map<UUID, Map<String, Marker>> ABOVE = new ConcurrentHashMap<>();

	/** Durchmesser der runden Fläche über dem Kopf und Größe des Symbols darin (Pixel des Namensschilds, Name = 9) */
	private static final float BADGE = 15f;
	private static final float ICON = 9.5f;
	/** Abstand zwischen Namensschild und Fläche bzw. zwischen zwei Flächen */
	private static final float ABOVE_GAP = 2.5f;
	private static final float BADGE_GAP = 2f;
	/** kurzes Aufploppen, wenn ein Symbol erscheint */
	private static final long POP_MILLIS = 140;
	private static final int BADGE_COLOR = 0x0B0F17;

	private PlayerMarkerStore() {
	}

	public static void show(String owner, UUID player, String icon, int color, long millis) {
		put(MARKERS, owner, player, icon, color, millis);
	}

	public static void showAbove(String owner, UUID player, String icon, int color, long millis) {
		put(ABOVE, owner, player, icon, color, millis);
	}

	private static void put(Map<UUID, Map<String, Marker>> store, String owner, UUID player, String icon, int color, long millis) {
		int index = Ui.iconIndex(icon);
		if (index < 0) index = Math.max(0, Ui.iconIndex("star"));
		long now = System.currentTimeMillis();
		long until = now + Math.clamp(millis, 50, 60_000);
		Map<String, Marker> map = store.computeIfAbsent(player, key -> new ConcurrentHashMap<>());
		Marker old = map.get(owner);
		// gerade sichtbar: Erscheinen nicht neu starten (sonst ploppt ein jeden Tick erneuertes Symbol dauernd)
		long since = old != null && old.until() > now ? old.since() : now;
		map.put(owner, new Marker(0xE100 + index, color & 0xFFFFFF, until, since));
	}

	public static void hide(String owner, UUID player) {
		remove(MARKERS, owner, player);
		remove(ABOVE, owner, player);
	}

	private static void remove(Map<UUID, Map<String, Marker>> store, String owner, UUID player) {
		Map<String, Marker> map = store.get(player);
		if (map != null) {
			map.remove(owner);
			if (map.isEmpty()) store.remove(player, map);
		}
	}

	/** Addon abgeschaltet: alle seine Symbole weg */
	public static void forget(String owner) {
		for (UUID player : MARKERS.keySet()) remove(MARKERS, owner, player);
		for (UUID player : ABOVE.keySet()) remove(ABOVE, owner, player);
	}

	/** Für den Autotest: Anzahl gerade sichtbarer Symbole hinter dem Namen dieses Spielers */
	public static int count(UUID player) {
		return count(MARKERS, player);
	}

	/** Für den Autotest: Anzahl gerade sichtbarer Symbole über dem Kopf dieses Spielers */
	public static int countAbove(UUID player) {
		return count(ABOVE, player);
	}

	/** Für den Autotest: Icon-Nummer des Symbols eines Addons über dem Kopf, sonst -1 */
	public static int aboveIcon(String owner, UUID player) {
		Map<String, Marker> map = ABOVE.get(player);
		Marker marker = map == null ? null : map.get(owner);
		return marker == null || marker.until() <= System.currentTimeMillis() ? -1 : marker.glyph() - 0xE100;
	}

	private static int count(Map<UUID, Map<String, Marker>> store, UUID player) {
		Map<String, Marker> map = store.get(player);
		if (map == null) return 0;
		long now = System.currentTimeMillis();
		return (int) map.values().stream().filter(marker -> marker.until() > now).count();
	}

	/** Namensschild: Symbole hinter den Namen hängen (abgelaufene räumt das gleich mit auf) */
	public static Component decorate(Component name, UUID player) {
		Map<String, Marker> map = MARKERS.get(player);
		if (map == null || map.isEmpty()) return name;
		long now = System.currentTimeMillis();
		MutableComponent result = null;
		for (Map.Entry<String, Marker> entry : new TreeMap<>(map).entrySet()) {
			Marker marker = entry.getValue();
			if (marker.until() <= now) {
				map.remove(entry.getKey(), marker);
				continue;
			}
			if (result == null) result = Component.empty().append(name);
			result.append(Component.literal(" "));
			result.append(glyph(marker));
		}
		if (map.isEmpty()) MARKERS.remove(player, map);
		return result == null ? name : result;
	}

	/** ein Zeichen der Schrift heldixclient:marker (Icon Nummer index) in dieser Farbe */
	private static FormattedCharSequence glyphText(int index, int color) {
		return Component.literal(Character.toString(0xE100 + Math.max(0, index))).withStyle(Style.EMPTY.withFont(FONT).withColor(color & 0xFFFFFF))
				.getVisualOrderText();
	}

	/** ein Zeichen mittig um den Ursprung, size Pixel groß (die Zeichen der Schrift sind 8 Pixel) */
	private static void badge(SubmitNodeCollector collector, PoseStack pose, float size, FormattedCharSequence glyph, Font.DisplayMode mode,
			int light, int color) {
		pose.pushPose();
		pose.scale(size / 8f, size / 8f, 1f);
		collector.submitText(pose, -4f, -4f, glyph, false, mode, light, color, 0, 0);
		pose.popPose();
	}

	private static MutableComponent glyph(Marker marker) {
		return Component.literal(Character.toString(marker.glyph())).withStyle(Style.EMPTY.withFont(FONT).withColor(marker.color()));
	}

	// ======================================================================================
	// Über dem Kopf (EntityRenderer.submit, Anfang)
	// ======================================================================================

	/**
	 * Symbole über dem Namensschild eines Spielers einreichen. Gleiche Lage und Drehung wie das Namensschild von
	 * Minecraft (Anheftpunkt + 0,5, zur Kamera gedreht, 0,025 je Pixel), nur höher und größer.
	 */
	public static void submitAbove(EntityRenderState entityState, PoseStack pose, SubmitNodeCollector collector, CameraRenderState camera) {
		if (ABOVE.isEmpty() || !(entityState instanceof AvatarRenderState state)) return;
		// Menüfiguren (keine Kamera) und Spieler ohne Namensschild (F1, unsichtbar, Teams, zu weit weg): nichts
		if (camera == null || !camera.initialized || camera.pos == null || state.nameTag == null || state.nameTagAttachment == null) return;
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null || mc.gui.hud.isHidden()) return;
		Entity entity = mc.level.getEntity(state.id);
		if (!(entity instanceof Player player)) return;
		Map<String, Marker> map = ABOVE.get(player.getUUID());
		if (map == null || map.isEmpty()) return;

		long now = System.currentTimeMillis();
		List<Marker> badges = new ArrayList<>();
		for (Map.Entry<String, Marker> entry : new TreeMap<>(map).entrySet()) {
			Marker marker = entry.getValue();
			if (marker.until() <= now) map.remove(entry.getKey(), marker);
			else badges.add(marker);
		}
		if (map.isEmpty()) ABOVE.remove(player.getUUID(), map);
		if (badges.isEmpty()) return;

		// Oberkante des Namens: 0,5 über dem Anheftpunkt; mit Punktestand darunter rückt der Name eine Zeile hoch
		Vec3 at = state.nameTagAttachment;
		double nameTop = 0.5 + (state.scoreText != null ? 9 * 1.15f * 0.025f : 0) + 0.025;
		pose.pushPose();
		pose.translate(at.x, at.y + nameTop + ABOVE_GAP * 0.025, at.z);
		pose.rotate(camera.orientation);
		pose.scale(0.025f, -0.025f, 0.025f);
		int light = LightCoordsUtil.FULL_BRIGHT;
		FormattedCharSequence disc = glyphText(Ui.iconIndex("disc"), BADGE_COLOR);
		for (int i = 0; i < badges.size(); i++) {
			Marker marker = badges.get(i);
			// Aufploppen: von 70 % auf 100 % (weich auslaufend)
			float pop = Math.clamp((now - marker.since()) / (float) POP_MILLIS, 0f, 1f);
			float grow = 0.7f + 0.3f * (1f - (1f - pop) * (1f - pop));
			float centerX = (i - (badges.size() - 1) / 2f) * (BADGE + BADGE_GAP);
			pose.pushPose();
			pose.translate(centerX, -BADGE / 2f, 0);
			FormattedCharSequence icon = glyphText(marker.glyph() - 0xE100, marker.color());
			FormattedCharSequence ring = glyphText(Ui.iconIndex("ring"), marker.color());
			if (state.isDiscrete) {
				// Schleichen: wie das Namensschild blass und nicht durch Wände
				badge(collector, pose, BADGE * grow, disc, Font.DisplayMode.NORMAL, light, 0x70FFFFFF);
				badge(collector, pose, BADGE * grow, ring, Font.DisplayMode.POLYGON_OFFSET, light, 0x50FFFFFF);
				badge(collector, pose, ICON * grow, icon, Font.DisplayMode.POLYGON_OFFSET, light, 0x90FFFFFF);
			} else {
				// schwach auch durch Wände (wie Namensschilder), darüber die runde Fläche mit farbigem Rand und Symbol
				badge(collector, pose, ICON * grow, icon, Font.DisplayMode.SEE_THROUGH, light, 0x48FFFFFF);
				badge(collector, pose, BADGE * grow, disc, Font.DisplayMode.NORMAL, light, 0xC8FFFFFF);
				badge(collector, pose, BADGE * grow, ring, Font.DisplayMode.POLYGON_OFFSET, light, 0xB0FFFFFF);
				badge(collector, pose, ICON * grow, icon, Font.DisplayMode.POLYGON_OFFSET, light, 0xFFFFFFFF);
			}
			pose.popPose();
		}
		pose.popPose();
	}
}
