package dev.heldixclient.player;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.ui.Ui;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Symbole hinter dem Namen im Namensschild anderer Spieler (Addon-API {@code playerMarkers()}), z. B. „spricht“ im
 * Voice Chat. Je Spieler und Addon eines, mit Ablaufzeit. Gezeichnet als Schriftzeichen der Schrift
 * heldixclient:marker (alle Heldix-Icons, U+E100 + Nummer), damit Minecraft sie wie den Namen behandelt.
 */
public final class PlayerMarkerStore {
	private record Marker(int glyph, int color, long until) {
	}

	private static final FontDescription FONT = new FontDescription.Resource(HeldixClient.id("marker"));
	/** Spieler → Addon → Symbol (Addons in fester Reihenfolge, damit die Symbole nicht springen) */
	private static final Map<UUID, Map<String, Marker>> MARKERS = new ConcurrentHashMap<>();

	private PlayerMarkerStore() {
	}

	public static void show(String owner, UUID player, String icon, int color, long millis) {
		int index = Ui.iconIndex(icon);
		if (index < 0) index = Math.max(0, Ui.iconIndex("star"));
		long until = System.currentTimeMillis() + Math.clamp(millis, 50, 60_000);
		MARKERS.computeIfAbsent(player, key -> new ConcurrentHashMap<>()).put(owner, new Marker(0xE100 + index, color & 0xFFFFFF, until));
	}

	public static void hide(String owner, UUID player) {
		Map<String, Marker> map = MARKERS.get(player);
		if (map != null) {
			map.remove(owner);
			if (map.isEmpty()) MARKERS.remove(player);
		}
	}

	/** Addon abgeschaltet: alle seine Symbole weg */
	public static void forget(String owner) {
		for (UUID player : MARKERS.keySet()) hide(owner, player);
	}

	/** Für den Autotest: Anzahl gerade sichtbarer Symbole an diesem Spieler */
	public static int count(UUID player) {
		Map<String, Marker> map = MARKERS.get(player);
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
			result.append(Component.literal(Character.toString(marker.glyph())).withStyle(Style.EMPTY.withFont(FONT).withColor(marker.color())));
		}
		if (map.isEmpty()) MARKERS.remove(player, map);
		return result == null ? name : result;
	}
}
