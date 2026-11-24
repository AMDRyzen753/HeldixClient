package dev.heldixclient.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.HeldixLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Einfache JSON-Konfiguration unter config/heldixclient.json. */
public final class HeldixConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path FILE = HeldixLoader.configDir().resolve(HeldixClient.MOD_ID + ".json");

	private static Data data = new Data();

	public static final class ModuleState {
		public boolean enabled;
		public int x;
		public int y;

		public ModuleState() {
		}

		public ModuleState(boolean enabled, int x, int y) {
			this.enabled = enabled;
			this.x = x;
			this.y = y;
		}
	}

	public static final class Data {
		public Map<String, ModuleState> modules = new LinkedHashMap<>();
		public float zoomFactor = 4.0f;
		public boolean zoomSmooth = true;
		public boolean zoomCinematicCamera = true;
		public boolean hudBackground = true;
		/** Heldix-Design für Hauptmenü, Buttons, Listen und Hintergründe (false = Vanilla) */
		public boolean customMenus = true;
	}

	private HeldixConfig() {
	}

	public static Data get() {
		return data;
	}

	public static ModuleState module(String id, boolean defaultEnabled, int defaultX, int defaultY) {
		return data.modules.computeIfAbsent(id, k -> new ModuleState(defaultEnabled, defaultX, defaultY));
	}

	public static void load() {
		if (Files.exists(FILE)) {
			try (Reader reader = Files.newBufferedReader(FILE)) {
				Data loaded = GSON.fromJson(reader, Data.class);
				if (loaded != null) {
					if (loaded.modules == null) loaded.modules = new LinkedHashMap<>();
					data = loaded;
				}
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Konfiguration konnte nicht gelesen werden, nutze Standardwerte", e);
			}
		}
	}

	public static void save() {
		try {
			Files.createDirectories(FILE.getParent());
			try (Writer writer = Files.newBufferedWriter(FILE)) {
				GSON.toJson(data, writer);
			}
		} catch (IOException e) {
			HeldixClient.LOGGER.warn("Konfiguration konnte nicht gespeichert werden", e);
		}
	}
}
