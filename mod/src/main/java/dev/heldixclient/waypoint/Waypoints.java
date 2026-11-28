package dev.heldixclient.waypoint;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.HeldixLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.storage.LevelResource;

import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Gespeicherte Wegpunkte, getrennt nach Welt bzw. Server (config/heldixclient-waypoints.json).
 * Alle Aufrufe im Hauptthread.
 */
public final class Waypoints {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path FILE = HeldixLoader.configDir().resolve(HeldixClient.MOD_ID + "-waypoints.json");
	/** Farben zum Durchschalten (ARGB) */
	public static final int[] COLORS = {0xFF38BDF8, 0xFF34D399, 0xFFFBBF24, 0xFFF472B6, 0xFFA78BFA, 0xFFF87171, 0xFFFFFFFF};
	public static final String DEATH_NAME = "Todespunkt";

	/** Ein Wegpunkt; Felder öffentlich für Gson */
	public static final class Waypoint {
		public String name;
		public int x;
		public int y;
		public int z;
		/** z. B. minecraft:overworld */
		public String dimension;
		public int color;
		public boolean visible = true;
		public boolean death;
		public long created;

		public Waypoint() {
		}

		Waypoint(String name, BlockPos pos, String dimension, int color, boolean death) {
			this.name = name;
			this.x = pos.getX();
			this.y = pos.getY();
			this.z = pos.getZ();
			this.dimension = dimension;
			this.color = color;
			this.death = death;
			this.created = System.currentTimeMillis();
		}

		public String coordinates() {
			return x + " / " + y + " / " + z;
		}
	}

	private static Map<String, List<Waypoint>> worlds;

	private Waypoints() {
	}

	private static Map<String, List<Waypoint>> data() {
		if (worlds == null) {
			worlds = new LinkedHashMap<>();
			if (Files.exists(FILE)) {
				try (Reader reader = Files.newBufferedReader(FILE)) {
					Map<String, List<Waypoint>> loaded = GSON.fromJson(reader, new TypeToken<LinkedHashMap<String, List<Waypoint>>>() {
					}.getType());
					if (loaded != null) {
						loaded.values().removeIf(list -> list == null);
						loaded.values().forEach(list -> list.removeIf(w -> w == null || w.name == null || w.dimension == null));
						worlds.putAll(loaded);
					}
				} catch (Exception e) {
					HeldixClient.LOGGER.warn("Wegpunkte konnten nicht gelesen werden", e);
				}
			}
		}
		return worlds;
	}

	public static void save() {
		try {
			Files.createDirectories(FILE.getParent());
			try (Writer writer = Files.newBufferedWriter(FILE)) {
				GSON.toJson(data(), writer);
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Wegpunkte konnten nicht gespeichert werden", e);
		}
	}

	/** Schlüssel der aktuellen Welt: Ordnername im Einzelspieler, Adresse auf Servern (null = keine Welt) */
	public static String worldKey(Minecraft mc) {
		if (mc.level == null) return null;
		IntegratedServer local = mc.getSingleplayerServer();
		if (local != null) {
			Path root = local.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize();
			return "welt:" + root.getFileName();
		}
		ServerData server = mc.getCurrentServer();
		if (server == null) return "unbekannt";
		if (server.isRealm()) return "realms:" + server.name;
		return "server:" + server.ip.toLowerCase(Locale.ROOT).trim();
	}

	/** Anzeigename der aktuellen Welt */
	public static String worldName(Minecraft mc) {
		IntegratedServer local = mc.getSingleplayerServer();
		if (local != null) return local.getWorldData().getLevelName();
		ServerData server = mc.getCurrentServer();
		return server == null ? "Unbekannte Welt" : server.isRealm() ? server.name : server.ip;
	}

	public static String dimension(Minecraft mc) {
		return mc.level == null ? "" : mc.level.dimension().identifier().toString();
	}

	/** Alle Wegpunkte der aktuellen Welt (alle Dimensionen), änderbare Liste */
	public static List<Waypoint> current(Minecraft mc) {
		String key = worldKey(mc);
		if (key == null) return new ArrayList<>();
		return data().computeIfAbsent(key, k -> new ArrayList<>());
	}

	/** Wegpunkte, die gerade sichtbar sein sollen (aktuelle Welt und Dimension) */
	public static List<Waypoint> visibleHere(Minecraft mc) {
		String key = worldKey(mc);
		if (key == null) return List.of();
		List<Waypoint> list = data().get(key);
		if (list == null || list.isEmpty()) return List.of();
		String dimension = dimension(mc);
		List<Waypoint> visible = new ArrayList<>();
		for (Waypoint waypoint : list) {
			if (waypoint.visible && dimension.equals(waypoint.dimension)) visible.add(waypoint);
		}
		return visible;
	}

	/** Neuer Wegpunkt an der Position des Spielers; leerer Name = "Wegpunkt N" */
	public static Waypoint add(Minecraft mc, String name) {
		if (mc.player == null || mc.level == null) return null;
		// Server mit dem Plugin „HeldixClient Server“ kann Wegpunkte per Regel abschalten (Hinweis statt Wegpunkt)
		if (!dev.heldixclient.serverlink.ServerRules.allowedOrNotify("waypoints")) return null;
		List<Waypoint> list = current(mc);
		String clean = name == null ? "" : name.strip();
		if (clean.isEmpty()) clean = "Wegpunkt " + (list.stream().filter(w -> !w.death).count() + 1);
		if (clean.length() > 32) clean = clean.substring(0, 32);
		Waypoint waypoint = new Waypoint(clean, mc.player.blockPosition(), dimension(mc), COLORS[list.size() % (COLORS.length - 1)], false);
		list.add(waypoint);
		save();
		return waypoint;
	}

	/** Todespunkt setzen (ersetzt den vorigen dieser Welt) */
	public static Waypoint death(Minecraft mc) {
		if (mc.player == null || mc.level == null || !dev.heldixclient.serverlink.ServerRules.allowed("waypoints")) return null;
		List<Waypoint> list = current(mc);
		list.removeIf(w -> w.death);
		Waypoint waypoint = new Waypoint(DEATH_NAME, mc.player.blockPosition(), dimension(mc), 0xFFF87171, true);
		list.add(waypoint);
		save();
		return waypoint;
	}

	public static void remove(Minecraft mc, Waypoint waypoint) {
		if (current(mc).remove(waypoint)) save();
	}

	public static void toggleVisible(Waypoint waypoint) {
		waypoint.visible = !waypoint.visible;
		save();
	}

	public static void nextColor(Waypoint waypoint) {
		int index = 0;
		for (int i = 0; i < COLORS.length; i++) {
			if (COLORS[i] == waypoint.color) index = i;
		}
		waypoint.color = COLORS[(index + 1) % COLORS.length];
		save();
	}

	/** Lesbarer Name einer Dimension */
	public static String dimensionName(String dimension) {
		return switch (dimension) {
			case "minecraft:overworld" -> "Oberwelt";
			case "minecraft:the_nether" -> "Nether";
			case "minecraft:the_end" -> "Ende";
			default -> dimension.substring(dimension.indexOf(':') + 1);
		};
	}

	/** Für Tests: Speicher neu einlesen */
	public static void reload() {
		worlds = null;
	}
}
