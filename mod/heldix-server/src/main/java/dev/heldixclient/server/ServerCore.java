package dev.heldixclient.server;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.server.api.HeldixClientInfo;
import dev.heldixclient.server.api.HeldixHud;
import dev.heldixclient.server.api.HeldixHudClickEvent;
import dev.heldixclient.server.api.HeldixPlayerJoinEvent;
import dev.heldixclient.server.api.HeldixRewards;
import dev.heldixclient.server.api.HeldixRules;
import dev.heldixclient.server.api.HeldixServer;
import dev.heldixclient.server.api.HeldixVoiceGroups;
import dev.heldixclient.server.api.HudElement;
import dev.heldixclient.server.api.RewardResult;
import dev.heldixclient.server.api.Texts;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.messaging.PluginMessageListener;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Herz des Plugins: Kanal {@code heldixclient:server} (empfangen, senden), Stand je Spieler, Regeln, HUD, Einblendungen,
 * Voice-Gruppen und Belohnungen – zugleich die Schnittstelle {@link HeldixServer} für andere Plugins.
 *
 * <p>Alles im Hauptthread des Servers bis auf die Aufrufe an den Heldix-Dienst ({@link ServiceClient}), deren Ergebnisse
 * mit dem Scheduler zurück in den Hauptthread kommen.
 */
final class ServerCore implements HeldixServer, PluginMessageListener {
	static final int MAX_BYTES = 32 * 1024;
	private static final long TOAST_MS = 5000;
	private static final Pattern GROUP = Pattern.compile("[a-z0-9_-]{1,24}");
	private static final Pattern COSMETIC = Pattern.compile("[a-z0-9_-]{1,64}");
	/** Klicks auf HUD-Elemente: höchstens 4 je Sekunde und Spieler */
	private static final int CLICKS_PER_SECOND = 4;

	/** Stand eines Spielers (auch ohne HeldixClient: HUD-Elemente, die vor dem hello gesetzt wurden) */
	private static final class Session {
		HeldixClientInfo client;
		boolean joinEventFired;
		final LinkedHashMap<String, HudElement> hud = new LinkedHashMap<>();
		/** eigene Regeln (null = globale) */
		Set<String> rules;
		long lastToastAt;
		long clickWindowAt;
		int clicks;
	}

	private final HeldixServerPlugin plugin;
	private final Map<UUID, Session> sessions = new HashMap<>();
	private Set<String> globalRules = Set.of();
	private Settings settings;
	private final ServiceClient service;

	// Partner (aus GET /v1/partner/me)
	private volatile String partnerId;
	private volatile String partnerName;
	private volatile List<String> partnerServers = List.of();
	private volatile String partnerProblem = "Noch nicht geprüft.";

	// Voice-Gruppen
	private final Map<UUID, String> groups = new LinkedHashMap<>();
	/** Änderungen seit dem letzten Senden: UUID → Gruppe ("" = entfernt) */
	private final Map<UUID, String> changes = new LinkedHashMap<>();
	private boolean changeScheduled;
	private volatile String lastSync = "noch nichts gesendet";

	private final HudControl hudControl = new HudControl();
	private final Rules rules = new Rules();
	private final VoiceGroups voiceGroups = new VoiceGroups();
	private final Rewards rewards = new Rewards();

	ServerCore(HeldixServerPlugin plugin, Settings settings) {
		this.plugin = plugin;
		this.settings = settings;
		this.globalRules = settings.rules();
		this.service = new ServiceClient(plugin.getPluginMeta().getVersion(), settings);
	}

	// ======================================================================================
	// Einstellungen und Partner
	// ======================================================================================

	Settings settings() {
		return settings;
	}

	/** Neue config.yml: Regeln an alle schicken, Schlüssel neu prüfen */
	void reload(Settings next) {
		boolean keyChanged = !next.partnerKey().equals(settings.partnerKey()) || !next.apiUrl().equals(settings.apiUrl());
		settings = next;
		service.update(next);
		globalRules = next.rules();
		for (Player player : heldixPlayers()) sendWelcome(player);
		if (keyChanged) checkPartner();
	}

	/** Schlüssel beim Dienst prüfen ({@code GET /v1/partner/me}), Ergebnis ins Log */
	void checkPartner() {
		partnerId = null;
		partnerName = null;
		partnerServers = List.of();
		if (!settings.hasPartnerKey()) {
			partnerProblem = "Kein Partner-Schlüssel eingetragen – Regeln, HUD und Einblendungen gehen trotzdem.";
			return;
		}
		partnerProblem = "Wird geprüft …";
		service.get("/v1/partner/me").thenAccept(response -> plugin.runSync(() -> {
			if (!response.ok()) {
				partnerProblem = response.error();
				plugin.getLogger().warning("Partner-Schlüssel nicht bestätigt: " + response.error());
				return;
			}
			JsonObject json = response.json();
			partnerId = ServiceClient.string(json, "id");
			partnerName = ServiceClient.string(json, "name");
			List<String> servers = new ArrayList<>();
			if (json.has("servers") && json.get("servers").isJsonArray()) {
				for (JsonElement server : json.getAsJsonArray("servers")) if (server.isJsonPrimitive()) servers.add(server.getAsString());
			}
			partnerServers = List.copyOf(servers);
			partnerProblem = null;
			plugin.getLogger().info("Partner bestätigt: " + partnerName + " (" + partnerId + "), Server " + String.join(", ", servers));
			if (voiceServer() == null) plugin.getLogger().warning("Für Voice-Gruppen fehlt die Adresse des Servers (server-address in der config.yml).");
			// Partner-Hinweis im welcome nachreichen
			for (Player player : heldixPlayers()) sendWelcome(player);
			if (!groups.isEmpty()) voiceGroups.sync();
		}));
	}

	String partnerProblem() {
		return partnerProblem;
	}

	List<String> partnerServers() {
		return partnerServers;
	}

	String lastSync() {
		return lastSync;
	}

	/** Adresse für die Voice-Gruppen: aus der config.yml, sonst die erste des Partners */
	String voiceServer() {
		if (!settings.serverAddress().isEmpty()) return settings.serverAddress();
		return partnerServers.isEmpty() ? null : partnerServers.getFirst();
	}

	void close() {
		service.close();
	}

	// ======================================================================================
	// Kanal: empfangen
	// ======================================================================================

	@Override
	public void onPluginMessageReceived(String channel, Player player, byte[] message) {
		if (!CHANNEL.equals(channel) || message == null || message.length == 0 || message.length > MAX_BYTES) return;
		String text;
		try {
			text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
					.decode(ByteBuffer.wrap(message)).toString();
		} catch (CharacterCodingException e) {
			return;
		}
		// Paper stellt Plugin-Nachrichten im Hauptthread zu; sicher ist sicher
		plugin.runSync(() -> handle(player, text));
	}

	private void handle(Player player, String text) {
		if (!player.isOnline()) return;
		JsonObject json;
		try {
			JsonElement element = JsonParser.parseString(text);
			if (!element.isJsonObject()) return;
			json = element.getAsJsonObject();
		} catch (RuntimeException e) {
			return;
		}
		String type = ServiceClient.string(json, "t");
		if ("hello".equals(type)) hello(player, json);
		else if ("hud_click".equals(type)) click(player, ServiceClient.string(json, "id"));
	}

	private void hello(Player player, JsonObject json) {
		String version = Texts.clean(ServiceClient.string(json, "version"), 32);
		int api = 0;
		try {
			api = json.has("api") ? json.get("api").getAsInt() : 0;
		} catch (RuntimeException e) {
			api = 0;
		}
		String language = "en".equals(ServiceClient.string(json, "lang")) ? "en" : "de";
		Session session = session(player);
		session.client = new HeldixClientInfo(version.isEmpty() ? "?" : version, api, language);
		sendWelcome(player);
		// HUD-Elemente, die schon gesetzt waren (auch vor dem hello), noch einmal schicken
		for (HudElement element : session.hud.values()) send(player, hudJson(element));
		if (!session.joinEventFired) {
			session.joinEventFired = true;
			Bukkit.getPluginManager().callEvent(new HeldixPlayerJoinEvent(player, session.client));
		}
	}

	private void click(Player player, String id) {
		Session session = sessions.get(player.getUniqueId());
		if (session == null || session.client == null || id == null) return;
		HudElement element = session.hud.get(id);
		if (element == null || !element.clickable()) return;
		long now = System.currentTimeMillis();
		if (now - session.clickWindowAt >= 1000) {
			session.clickWindowAt = now;
			session.clicks = 0;
		}
		if (++session.clicks > CLICKS_PER_SECOND) return;
		Bukkit.getPluginManager().callEvent(new HeldixHudClickEvent(player, id));
	}

	// ======================================================================================
	// Kanal: senden
	// ======================================================================================

	private void sendWelcome(Player player) {
		JsonObject welcome = message("welcome");
		welcome.addProperty("server", displayName());
		if (partnerId != null) welcome.addProperty("partner", partnerId);
		else welcome.add("partner", com.google.gson.JsonNull.INSTANCE);
		send(player, welcome);
		sendRules(player);
	}

	private void sendRules(Player player) {
		JsonObject message = message("rules");
		JsonArray disable = new JsonArray();
		for (String key : rules.of(player)) disable.add(key);
		message.add("disable", disable);
		send(player, message);
	}

	private String displayName() {
		if (!settings.serverName().isEmpty()) return settings.serverName();
		String motd;
		try {
			motd = net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(Bukkit.motd());
		} catch (RuntimeException | LinkageError e) {
			motd = "";
		}
		String clean = Texts.clean(motd, 40);
		return clean.isEmpty() ? "Server" : clean;
	}

	private static JsonObject message(String type) {
		JsonObject json = new JsonObject();
		json.addProperty("t", type);
		json.addProperty("v", PROTOCOL);
		return json;
	}

	private static JsonObject hudJson(HudElement element) {
		JsonObject json = message("hud_set");
		json.addProperty("id", element.id());
		json.addProperty("type", element.type().id());
		json.addProperty("anchor", element.anchor().id());
		if (!element.title().isEmpty()) json.addProperty("title", element.title());
		if (!element.text().isEmpty()) json.addProperty("text", element.text());
		if (!element.lines().isEmpty()) {
			JsonArray lines = new JsonArray();
			for (String line : element.lines()) lines.add(line);
			json.add("lines", lines);
		}
		if (element.type() == HudElement.Type.PROGRESS) json.addProperty("value", element.value());
		if (element.color() != null) json.addProperty("color", String.format("#%06x", element.color()));
		if (element.clickable()) json.addProperty("clickable", true);
		return json;
	}

	/** Nachricht an einen HeldixClient-Spieler (nur nach seinem hello – vorher hat er den Kanal evtl. nicht angemeldet) */
	private boolean send(Player player, JsonObject message) {
		Session session = sessions.get(player.getUniqueId());
		if (session == null || session.client == null || !player.isOnline()) return false;
		byte[] data = message.toString().getBytes(StandardCharsets.UTF_8);
		if (data.length > MAX_BYTES) return false;
		player.sendPluginMessage(plugin, CHANNEL, data);
		return true;
	}

	private Session session(Player player) {
		return sessions.computeIfAbsent(player.getUniqueId(), id -> new Session());
	}

	/** Spieler hat den Server verlassen */
	void quit(Player player) {
		sessions.remove(player.getUniqueId());
		if (groups.containsKey(player.getUniqueId())) voiceGroups.remove(player.getUniqueId());
	}

	// ======================================================================================
	// HeldixServer
	// ======================================================================================

	@Override
	public String version() {
		return plugin.getPluginMeta().getVersion();
	}

	@Override
	public boolean isHeldix(Player player) {
		Session session = player == null ? null : sessions.get(player.getUniqueId());
		return session != null && session.client != null && player.isOnline();
	}

	@Override
	public Optional<String> clientVersion(Player player) {
		return client(player).map(HeldixClientInfo::version);
	}

	@Override
	public Optional<HeldixClientInfo> client(Player player) {
		Session session = player == null ? null : sessions.get(player.getUniqueId());
		return session == null ? Optional.empty() : Optional.ofNullable(session.client);
	}

	@Override
	public Collection<Player> heldixPlayers() {
		List<Player> list = new ArrayList<>();
		for (Map.Entry<UUID, Session> entry : sessions.entrySet()) {
			if (entry.getValue().client == null) continue;
			Player player = Bukkit.getPlayer(entry.getKey());
			if (player != null && player.isOnline()) list.add(player);
		}
		return list;
	}

	@Override
	public HeldixHud hud(Player player) {
		return hudControl.of(player);
	}

	@Override
	public boolean toast(Player player, String title, String text) {
		if (!isHeldix(player)) return false;
		Session session = session(player);
		long now = System.currentTimeMillis();
		if (session.lastToastAt != 0 && now - session.lastToastAt < TOAST_MS) return false;
		String cleanTitle = Texts.clean(title, 40);
		String cleanText = Texts.clean(text, 120);
		if (cleanTitle.isEmpty() && cleanText.isEmpty()) return false;
		JsonObject toast = message("toast");
		toast.addProperty("title", cleanTitle);
		toast.addProperty("text", cleanText);
		if (!send(player, toast)) return false;
		session.lastToastAt = now;
		return true;
	}

	@Override
	public HeldixRules rules() {
		return rules;
	}

	@Override
	public HeldixVoiceGroups voiceGroups() {
		return voiceGroups;
	}

	@Override
	public HeldixRewards rewards() {
		return rewards;
	}

	@Override
	public boolean partner() {
		return partnerId != null;
	}

	@Override
	public Optional<String> partnerName() {
		return Optional.ofNullable(partnerName);
	}

	// ======================================================================================
	// HUD
	// ======================================================================================

	private final class HudControl {
		HeldixHud of(Player player) {
			UUID id = player.getUniqueId();
			return new HeldixHud() {
				@Override
				public boolean set(HudElement element) {
					if (element == null || !player.isOnline()) return false;
					Session session = session(player);
					if (!session.hud.containsKey(element.id()) && session.hud.size() >= MAX_ELEMENTS) return false;
					session.hud.put(element.id(), element);
					send(player, hudJson(element));
					return true;
				}

				@Override
				public boolean remove(String elementId) {
					Session session = sessions.get(id);
					if (session == null || session.hud.remove(elementId) == null) return false;
					JsonObject remove = message("hud_remove");
					remove.addProperty("id", elementId);
					send(player, remove);
					return true;
				}

				@Override
				public void clear() {
					Session session = sessions.get(id);
					if (session == null) return;
					session.hud.clear();
					send(player, message("hud_clear"));
				}

				@Override
				public List<HudElement> elements() {
					Session session = sessions.get(id);
					return session == null ? List.of() : List.copyOf(session.hud.values());
				}
			};
		}
	}

	// ======================================================================================
	// Regeln
	// ======================================================================================

	private final class Rules implements HeldixRules {
		@Override
		public Set<String> global() {
			return globalRules;
		}

		@Override
		public void setGlobal(Collection<String> disabled) {
			globalRules = Settings.rules(disabled == null ? List.of() : new ArrayList<>(disabled), plugin.getLogger());
			for (Player player : heldixPlayers()) {
				Session session = sessions.get(player.getUniqueId());
				if (session != null && session.rules == null) sendRules(player);
			}
		}

		@Override
		public Set<String> of(Player player) {
			Session session = player == null ? null : sessions.get(player.getUniqueId());
			return session != null && session.rules != null ? session.rules : globalRules;
		}

		@Override
		public void set(Player player, Collection<String> disabled) {
			session(player).rules = Settings.rules(disabled == null ? List.of() : new ArrayList<>(disabled), plugin.getLogger());
			sendRules(player);
		}

		@Override
		public void reset(Player player) {
			Session session = sessions.get(player.getUniqueId());
			if (session == null || session.rules == null) return;
			session.rules = null;
			sendRules(player);
		}
	}

	// ======================================================================================
	// Voice-Gruppen (PUT /v1/partner/voice/groups)
	// ======================================================================================

	/** alle 2 Minuten aus dem Plugin: ganzen Stand erneuern (der Dienst vergisst nach 10 Minuten) */
	void refreshVoiceGroups() {
		if (!groups.isEmpty() && partner()) voiceGroups.sync();
	}

	private final class VoiceGroups implements HeldixVoiceGroups {
		@Override
		public boolean available() {
			return partner() && voiceServer() != null;
		}

		@Override
		public void set(UUID player, String group) {
			if (group == null) {
				remove(player);
				return;
			}
			String clean = group.strip().toLowerCase(java.util.Locale.ROOT);
			if (!GROUP.matcher(clean).matches()) throw new IllegalArgumentException("Gruppen-Name nur a-z, 0-9, _ und -, höchstens 24 Zeichen: " + group);
			if (clean.equals(groups.get(player))) return;
			groups.put(player, clean);
			changed(player, clean);
		}

		@Override
		public void remove(UUID player) {
			if (groups.remove(player) == null) return;
			changed(player, "");
		}

		@Override
		public void clear() {
			groups.clear();
			changes.clear();
			String server = voiceServer();
			if (!partner() || server == null) return;
			service.delete("/v1/partner/voice/groups?server=" + java.net.URLEncoder.encode(server, StandardCharsets.UTF_8))
					.thenAccept(response -> plugin.runSync(() -> lastSync = response.ok() ? "geleert" : "Leeren fehlgeschlagen: " + response.error()));
		}

		@Override
		public Optional<String> of(UUID player) {
			return Optional.ofNullable(groups.get(player));
		}

		@Override
		public Map<UUID, String> all() {
			return Map.copyOf(groups);
		}

		@Override
		public CompletableFuture<Boolean> sync() {
			changes.clear();
			Map<UUID, String> all = new LinkedHashMap<>(groups);
			return push(all);
		}

		private void changed(UUID player, String group) {
			changes.put(player, group);
			if (changeScheduled) return;
			changeScheduled = true;
			// gesammelt nach einer halben Sekunde schicken (viele Änderungen auf einmal, z. B. Teams zu Rundenbeginn)
			Bukkit.getScheduler().runTaskLater(plugin, () -> {
				changeScheduled = false;
				if (changes.isEmpty()) return;
				Map<UUID, String> batch = new LinkedHashMap<>(changes);
				changes.clear();
				push(batch);
			}, 10L);
		}

		/** Einträge in Paketen zu höchstens 500 senden; "" bzw. null = entfernen */
		private CompletableFuture<Boolean> push(Map<UUID, String> entries) {
			CompletableFuture<Boolean> result = new CompletableFuture<>();
			String server = voiceServer();
			if (!partner() || server == null) {
				result.complete(false);
				return result;
			}
			List<Map.Entry<UUID, String>> list = new ArrayList<>(entries.entrySet());
			if (list.isEmpty()) {
				result.complete(true);
				return result;
			}
			List<CompletableFuture<ServiceClient.Response>> calls = new ArrayList<>();
			for (int start = 0; start < list.size(); start += 500) {
				JsonObject body = new JsonObject();
				body.addProperty("server", server);
				JsonObject map = new JsonObject();
				for (Map.Entry<UUID, String> entry : list.subList(start, Math.min(list.size(), start + 500))) {
					String key = entry.getKey().toString().replace("-", "");
					if (entry.getValue() == null || entry.getValue().isEmpty()) map.add(key, com.google.gson.JsonNull.INSTANCE);
					else map.addProperty(key, entry.getValue());
				}
				body.add("groups", map);
				calls.add(service.put("/v1/partner/voice/groups", body));
			}
			CompletableFuture.allOf(calls.toArray(CompletableFuture[]::new)).whenComplete((ignored, error) -> plugin.runSync(() -> {
				String problem = null;
				for (CompletableFuture<ServiceClient.Response> call : calls) {
					ServiceClient.Response response = call.getNow(null);
					if (response == null || !response.ok()) problem = response == null ? "keine Antwort" : response.error();
				}
				lastSync = problem == null ? list.size() + " Einträge gesendet (" + java.time.LocalTime.now().withNano(0) + ")" : "fehlgeschlagen: " + problem;
				if (problem != null) plugin.getLogger().warning("Voice-Gruppen nicht gesendet: " + problem);
				result.complete(problem == null);
			}));
			return result;
		}
	}

	// ======================================================================================
	// Belohnungen (POST /v1/partner/rewards)
	// ======================================================================================

	private final class Rewards implements HeldixRewards {
		@Override
		public CompletableFuture<RewardResult> grant(UUID player, String cosmeticId) {
			CompletableFuture<RewardResult> result = new CompletableFuture<>();
			if (player == null || cosmeticId == null || !COSMETIC.matcher(cosmeticId).matches()) {
				result.complete(RewardResult.failed("Ungültige Cosmetic-ID: " + cosmeticId, null));
				return result;
			}
			if (!partner()) {
				result.complete(RewardResult.failed(partnerProblem != null ? partnerProblem : "Ohne gültigen Partner-Schlüssel gibt es keine Belohnungen.", null));
				return result;
			}
			JsonObject body = new JsonObject();
			body.addProperty("uuid", player.toString().replace("-", ""));
			body.addProperty("cosmetic", cosmeticId);
			service.post("/v1/partner/rewards", body).thenAccept(response -> plugin.runSync(() -> {
				if (!response.ok()) {
					result.complete(RewardResult.failed(response.error(), response.code()));
					return;
				}
				JsonObject json = response.json();
				boolean granted = json.has("granted") && json.get("granted").isJsonPrimitive() && json.get("granted").getAsBoolean();
				boolean already = json.has("already") && json.get("already").isJsonPrimitive() && json.get("already").getAsBoolean();
				result.complete(new RewardResult(granted, already, granted ? null : "Der Heldix-Dienst hat die Belohnung nicht bestätigt.", null));
			}));
			return result;
		}
	}

	/** Stand für /heldix status */
	Map<UUID, HeldixClientInfo> clients() {
		Map<UUID, HeldixClientInfo> map = new LinkedHashMap<>();
		sessions.forEach((id, session) -> {
			if (session.client != null) map.put(id, session.client);
		});
		return map;
	}

	Set<String> knownRules() {
		return new LinkedHashSet<>(HeldixRules.KNOWN);
	}
}
