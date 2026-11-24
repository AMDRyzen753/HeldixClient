package dev.heldixclient.api;

/** Einfache Schlüssel-Wert-Einstellungen, gespeichert unter config/heldix-addons/&lt;addon-id&gt;.properties. */
public interface AddonConfig {
	String get(String key, String defaultValue);

	int getInt(String key, int defaultValue);

	boolean getBoolean(String key, boolean defaultValue);

	void set(String key, String value);

	/** Schreibt die Einstellungen auf die Festplatte. */
	void save();
}
