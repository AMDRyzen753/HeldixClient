package dev.heldixclient.serverlink;

import dev.heldixclient.hud.Notifications;
import dev.heldixclient.module.Module;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Server-Regeln (Nachricht {@code rules} auf {@code heldixclient:server}): Funktionen, die der Server abgeschaltet hat.
 * Gelten bis zum Verlassen des Servers oder bis zur nächsten {@code rules}-Nachricht. Ohne Server ist alles erlaubt.
 *
 * <p>Bekannte Schlüssel ({@link #KNOWN}) setzt HeldixClient selbst durch – auch gegen ältere Versionen der offiziellen
 * Addons (das Minimap-Modul ist fest zugeordnet). Unbekannte Schlüssel bleiben gespeichert, damit Addons sie mit
 * {@code api.server().allowed(…)} abfragen können; HeldixClient selbst ignoriert sie.
 */
public final class ServerRules {
	/** Hinweis beim Versuch, eine gesperrte Funktion zu nutzen */
	public static final String BLOCKED_TEXT = "Auf diesem Server deaktiviert";

	/** Schlüssel, die HeldixClient kennt und durchsetzt (Doku: docs/server-plugin.md) */
	public static final Map<String, String> KNOWN = Map.of(
			"freelook", "Freelook",
			"zoom", "Zoom",
			"minimap", "Minimap",
			"worldmap", "Weltkarte",
			"waypoints", "Wegpunkte",
			"coordinates", "Koordinaten",
			"fullbright", "Fullbright",
			"togglesprint", "Dauersprint");

	/** Module → Regel, die sie sperrt (eingebaute und die offiziellen Addons, auch in älteren Versionen) */
	private static final Map<String, String> MODULES = Map.of(
			"freelook", "freelook",
			"zoom", "zoom",
			"coordinates", "coordinates",
			"waypoints", "waypoints",
			"togglesprint", "togglesprint",
			"minimap:minimap", "minimap");

	static final Pattern KEY = Pattern.compile("[a-z0-9_.-]{1,32}");
	private static final int MAX_KEYS = 64;
	/** Hinweis je Schlüssel höchstens alle 3 s (Taste gehalten, mehrfach gedrückt) */
	private static final long NOTICE_MS = 3000;

	private static volatile Set<String> disabled = Set.of();
	/** von Addons angemeldet: Modul-ID → Regeln ({@code ModuleHandle.followServerRule}) */
	private static final Map<String, Set<String>> FOLLOWED = new java.util.concurrent.ConcurrentHashMap<>();
	private static final Map<String, Long> NOTICES = new java.util.HashMap<>();

	private ServerRules() {
	}

	/** Ist die Funktion erlaubt? false nur, wenn der aktuelle Server sie abgeschaltet hat. Threadsicher. */
	public static boolean allowed(String key) {
		if (key == null) return true;
		return !disabled.contains(key.toLowerCase(Locale.ROOT));
	}

	/** Alle abgeschalteten Schlüssel (klein geschrieben) */
	public static Set<String> disabled() {
		return disabled;
	}

	/**
	 * Wie {@link #allowed}, zeigt aber bei einer Sperre die Einblendung „Auf diesem Server deaktiviert“ (Haupt-Thread) –
	 * für den Versuch des Spielers, die Funktion zu nutzen.
	 */
	public static boolean allowedOrNotify(String key) {
		if (allowed(key)) return true;
		notifyBlocked(key);
		return false;
	}

	public static void notifyBlocked(String key) {
		long now = System.currentTimeMillis();
		Long last = NOTICES.get(key);
		if (last != null && now - last < NOTICE_MS) return;
		NOTICES.put(key, now);
		String name = KNOWN.getOrDefault(key, key);
		Notifications.show("server-rules", name, BLOCKED_TEXT, null);
	}

	/** Sperrt der aktuelle Server dieses Modul? (fest zugeordnete und von Addons angemeldete Regeln) */
	public static boolean blocks(Module module) {
		if (disabled.isEmpty()) return false;
		return blockingRule(module) != null;
	}

	/** Die Regel, die das Modul gerade sperrt, sonst null */
	public static String blockingRule(Module module) {
		if (disabled.isEmpty() || module == null) return null;
		String rule = MODULES.get(module.id());
		if (rule != null && disabled.contains(rule)) return rule;
		Set<String> followed = FOLLOWED.get(module.id());
		if (followed != null) {
			for (String key : followed) if (disabled.contains(key)) return key;
		}
		return null;
	}

	/** Addon-Modul folgt einer Regel (API 11) */
	public static void follow(String moduleId, String rule) {
		String key = rule == null ? "" : rule.toLowerCase(Locale.ROOT).strip();
		if (!KEY.matcher(key).matches()) throw new IllegalArgumentException("Regel-Schlüssel nur a-z, 0-9, _, - und ., höchstens 32 Zeichen: " + rule);
		FOLLOWED.computeIfAbsent(moduleId, id -> java.util.concurrent.ConcurrentHashMap.newKeySet()).add(key);
	}

	/** Neue Regeln vom Server (Liste aus der Nachricht, schon geprüft); true = geändert */
	static boolean set(List<String> keys) {
		Set<String> next = new LinkedHashSet<>();
		for (String key : keys) {
			if (next.size() >= MAX_KEYS) break;
			next.add(key);
		}
		if (next.equals(disabled)) return false;
		disabled = Set.copyOf(next);
		return true;
	}

	/** Server verlassen: alles wieder erlaubt; true = geändert */
	static boolean clear() {
		NOTICES.clear();
		if (disabled.isEmpty()) return false;
		disabled = Set.of();
		return true;
	}

	/** Bekannte, gerade gesperrte Funktionen als Namen (für den Hinweis beim Betreten) */
	static List<String> blockedNames() {
		List<String> names = new ArrayList<>();
		for (String key : disabled) if (KNOWN.containsKey(key)) names.add(KNOWN.get(key));
		return names;
	}
}
