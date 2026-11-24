package dev.heldixclient.addon;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.AddonConfig;
import dev.heldixclient.loader.HeldixLoader;

import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/** Speichert Addon-Einstellungen unter config/heldix-addons/&lt;id&gt;.properties. */
final class AddonConfigImpl implements AddonConfig {
	private final Path file;
	private final Properties properties = new Properties();

	AddonConfigImpl(String addonId) {
		this.file = HeldixLoader.configDir().resolve("heldix-addons").resolve(addonId + ".properties");
		if (Files.exists(file)) {
			try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
				properties.load(reader);
			} catch (Exception e) {
				HeldixClient.LOGGER.warn("Addon-Einstellungen {} nicht lesbar", file, e);
			}
		}
	}

	@Override
	public String get(String key, String defaultValue) {
		return properties.getProperty(key, defaultValue);
	}

	@Override
	public int getInt(String key, int defaultValue) {
		try {
			return Integer.parseInt(properties.getProperty(key, String.valueOf(defaultValue)).trim());
		} catch (NumberFormatException e) {
			return defaultValue;
		}
	}

	@Override
	public boolean getBoolean(String key, boolean defaultValue) {
		return Boolean.parseBoolean(properties.getProperty(key, String.valueOf(defaultValue)).trim());
	}

	@Override
	public void set(String key, String value) {
		properties.setProperty(key, value);
	}

	@Override
	public void save() {
		try {
			Files.createDirectories(file.getParent());
			try (Writer writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
				properties.store(writer, "Heldix-Addon Einstellungen");
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.warn("Addon-Einstellungen {} nicht speicherbar", file, e);
		}
	}
}
