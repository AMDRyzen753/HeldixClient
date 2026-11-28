package dev.heldixclient.server;

import org.bukkit.configuration.file.FileConfiguration;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Inhalt der {@code config.yml} (geprüft). Fehlerhafte Werte werden mit Warnung im Log ersetzt, nie still übernommen.
 *
 * @param partnerKey    Partner-Schlüssel ({@code hxp_} + 40 Zeichen) oder "" (ohne Partner-Funktionen)
 * @param serverName    Name, den HeldixClient-Spieler sehen ("" = aus der MOTD)
 * @param serverAddress Adresse für Voice-Gruppen ("" = erste Adresse des Partners beim Dienst)
 * @param rules         global abgeschaltete Funktionen
 * @param apiUrl        Heldix-Dienst ohne „/“ am Ende
 */
record Settings(String partnerKey, String serverName, String serverAddress, Set<String> rules, String apiUrl) {
	static final String DEFAULT_API = "https://api.heldixclient.com";
	static final Pattern KEY = Pattern.compile("hxp_[A-Za-z0-9]{40}");
	static final Pattern RULE = Pattern.compile("[a-z0-9_.-]{1,32}");

	static Settings read(FileConfiguration config, Logger log) {
		String key = config.getString("partner-key", "").strip();
		if (!key.isEmpty() && !KEY.matcher(key).matches()) {
			log.warning("partner-key sieht nicht wie ein Partner-Schlüssel aus (hxp_ und 40 Zeichen) – Partner-Funktionen bleiben aus.");
			key = "";
		}
		String name = dev.heldixclient.server.api.Texts.clean(config.getString("server-name", ""), 40);
		String address = config.getString("server-address", "").strip().toLowerCase(Locale.ROOT);
		Set<String> rules = rules(config.getStringList("rules.disable"), log);
		String api = config.getString("api-url", DEFAULT_API).strip();
		while (api.endsWith("/")) api = api.substring(0, api.length() - 1);
		if (!api.startsWith("https://") && !api.startsWith("http://")) {
			log.warning("api-url muss mit https:// beginnen – nutze " + DEFAULT_API + ".");
			api = DEFAULT_API;
		}
		return new Settings(key, name, address, rules, api);
	}

	/** Regel-Schlüssel prüfen (klein, [a-z0-9_.-]{1,32}, höchstens 64) */
	static Set<String> rules(List<String> raw, Logger log) {
		Set<String> rules = new LinkedHashSet<>();
		List<String> invalid = new ArrayList<>();
		if (raw != null) {
			for (String value : raw) {
				String key = value == null ? "" : value.strip().toLowerCase(Locale.ROOT);
				if (RULE.matcher(key).matches() && rules.size() < 64) rules.add(key);
				else invalid.add(String.valueOf(value));
			}
		}
		if (!invalid.isEmpty() && log != null) log.warning("Ungültige Regel-Schlüssel ignoriert: " + String.join(", ", invalid));
		return Set.copyOf(rules);
	}

	boolean hasPartnerKey() {
		return !partnerKey.isEmpty();
	}
}
