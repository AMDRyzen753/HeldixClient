package dev.heldixclient.serverlink;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.ServerInfo;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.hud.ServerHud;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.ui.Language;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;

/**
 * Kanal {@code heldixclient:server} zum Server-Plugin „HeldixClient Server“ (Vertrag A3, Doku docs/server-plugin.md).
 *
 * <p>Ablauf: Beim Betreten eines Servers (jedes {@code ClientboundLoginPacket}, also auch nach einem Serverwechsel hinter
 * Velocity/BungeeCord) vergisst HeldixClient alles vom vorigen Server, meldet im nächsten Tick den Kanal über
 * {@code minecraft:register} an (sonst stellt Paper nichts zu; mit Fabric API übernimmt sie das) und schickt
 * {@code hello}. Der Server antwortet mit {@code welcome} und {@code rules} und darf danach HUD-Elemente und
 * Einblendungen schicken.
 *
 * <p>Jede Nachricht: UTF-8-JSON-Objekt, höchstens 32 KiB, Feld {@code t} (Typ) und {@code v} (Protokollversion, jetzt 1).
 * Unbekannte Typen und Felder werden ignoriert, kaputte Nachrichten verworfen (ein Server kann hier nichts zum Absturz
 * bringen). Texte verlieren §-Codes und Steuerzeichen und werden gekürzt.
 *
 * <p>Alles im Haupt-Thread (Minecraft stellt die Pakete dort zu).
 */
public final class ServerLink {
	public static final int PROTOCOL = 1;
	private static final Pattern ID = Pattern.compile("[a-z0-9_-]{1,24}");
	private static final Pattern PARTNER_ID = Pattern.compile("[a-z0-9-]{3,32}");
	private static final Pattern COLOR = Pattern.compile("#[0-9a-fA-F]{6}");
	private static final long TOAST_MS = 5000;
	private static final long CLICK_MS = 250;

	/** Stand des aktuellen Servers ({@link ServerInfo} für Addons) */
	public record Snapshot(boolean connected, String address, boolean heldix, String name, boolean partner, String partnerName,
			Set<String> disabled) implements ServerInfo {
		@Override
		public boolean allowed(String feature) {
			return feature == null || !disabled.contains(feature.toLowerCase(Locale.ROOT));
		}
	}

	private static final Snapshot NONE = new Snapshot(false, "", false, "", false, "", Set.of());
	private static final List<Runnable> LISTENERS = new CopyOnWriteArrayList<>();

	private static volatile Snapshot snapshot = NONE;
	/** Adresse des betretenen Servers (null = keiner) */
	private static String address;
	private static boolean heldix;
	private static String serverName = "";
	/** {@code welcome.partner} – nur ein Hinweis, entschieden wird über {@link Partners} */
	private static String partnerHint;
	private static boolean pendingHello;
	private static long lastToastAt;
	private static long lastClickAt;
	/** Eingriff in DiscardedPayload aktiv? (null = noch nicht geprüft) */
	private static Boolean patched;
	/** nur Autotest: was HeldixClient zuletzt geschickt hat (Typ der Nachricht) */
	private static final List<String> SENT = new CopyOnWriteArrayList<>();

	private ServerLink() {
	}

	/** Beim Start von HeldixClient */
	public static void init() {
		FabricNetworking.init();
		WorldEvents.JOIN.register(ServerLink::joined);
		WorldEvents.LEAVE.register(minecraft -> left());
	}

	/** Änderungen an {@link #info()} (Haupt-Thread), z. B. für die Addon-API */
	public static void addListener(Runnable listener) {
		LISTENERS.add(listener);
	}

	/** Aktueller Stand – threadsicher */
	public static Snapshot info() {
		return snapshot;
	}

	// ======================================================================================
	// Betreten, Verlassen, Tick
	// ======================================================================================

	private static void joined(Minecraft mc) {
		reset();
		ServerData server = mc.getCurrentServer();
		address = server != null && !mc.isLocalServer() && server.ip != null ? server.ip.strip() : null;
		pendingHello = address != null;
		publish();
	}

	private static void left() {
		reset();
		address = null;
		publish();
	}

	private static void reset() {
		heldix = false;
		serverName = "";
		partnerHint = null;
		pendingHello = false;
		lastToastAt = 0;
		ServerRules.clear();
		ServerHud.clear();
	}

	/** jeden Client-Tick (aus HeldixClient) */
	public static void tick(Minecraft mc) {
		if (Language.update(mc)) {
			// neue Sprache: dem Server erneut Hallo sagen (er antwortet wieder mit welcome und rules)
			if (address != null && mc.getConnection() != null) pendingHello = true;
			languageChanged();
		}
		if (!pendingHello) return;
		if (mc.getConnection() == null || mc.player == null) return;
		pendingHello = false;
		hello(mc);
	}

	private static void hello(Minecraft mc) {
		if (!canSend()) return;
		if (!FabricNetworking.present()) {
			send(mc, ServerPayload.register(ServerPayload.CHANNEL.toString()), "register");
		} else if (!FabricNetworking.registered()) {
			return;
		}
		JsonObject hello = new JsonObject();
		hello.addProperty("t", "hello");
		hello.addProperty("v", PROTOCOL);
		hello.addProperty("client", HeldixClient.NAME);
		hello.addProperty("version", HeldixClient.version);
		hello.addProperty("api", HeldixApi.API_VERSION);
		hello.addProperty("lang", Language.current());
		send(mc, hello);
	}

	/** Klick auf ein Server-Element mit {@code clickable:true} (Aktion des Spielers) */
	public static boolean click(ServerHud.Element element) {
		Minecraft mc = Minecraft.getInstance();
		long now = System.currentTimeMillis();
		if (element == null || !element.clickable() || now - lastClickAt < CLICK_MS) return false;
		lastClickAt = now;
		JsonObject click = new JsonObject();
		click.addProperty("t", "hud_click");
		click.addProperty("v", PROTOCOL);
		click.addProperty("id", element.id());
		return send(mc, click);
	}

	// ======================================================================================
	// Senden
	// ======================================================================================

	/**
	 * Kann HeldixClient auf dem Kanal schreiben? Ohne den Eingriff in {@code DiscardedPayload} (und ohne Fabric API) würde
	 * Minecraft beim Schreiben scheitern und die Verbindung trennen – dann lieber gar nichts senden.
	 */
	static boolean canSend() {
		if (FabricNetworking.registered()) return true;
		if (patched == null) {
			try {
				// Selbsttest: liefert der (veränderte) Codec von Minecraft unseren Codec für den Kanal?
				Object codec = DiscardedPayload.codec(ServerPayload.CHANNEL, 32767);
				patched = codec != null && codec.getClass().getEnclosingClass() == ServerPayload.class;
			} catch (Throwable t) {
				patched = false;
			}
			if (!patched) HeldixClient.LOGGER.warn("Kanal heldixclient:server nicht verfügbar: Eingriff in DiscardedPayload fehlt (Heldix Loader ab 2.5.0 nötig)");
		}
		return patched;
	}

	private static boolean send(Minecraft mc, JsonObject message) {
		byte[] data = message.toString().getBytes(StandardCharsets.UTF_8);
		if (data.length > ServerPayload.MAX_BYTES) return false;
		return send(mc, ServerPayload.message(data), message.get("t").getAsString());
	}

	private static boolean send(Minecraft mc, ServerPayload payload, String what) {
		ClientPacketListener connection = mc.getConnection();
		if (connection == null || !canSend()) return false;
		try {
			connection.send(new ServerboundCustomPayloadPacket(payload));
			SENT.add(what);
			while (SENT.size() > 32) SENT.removeFirst();
			return true;
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.warn("Kanal heldixclient:server: Senden fehlgeschlagen", e);
			return false;
		}
	}

	// ======================================================================================
	// Empfangen
	// ======================================================================================

	/** Nachricht vom Server (Haupt-Thread; aus dem Eingriff in ClientPacketListener bzw. von Fabric API) */
	public static void receive(byte[] data) {
		if (data == null || data.length == 0 || data.length > ServerPayload.MAX_BYTES) return;
		String text;
		try {
			text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
					.decode(ByteBuffer.wrap(data)).toString();
		} catch (CharacterCodingException e) {
			return;
		}
		handle(text);
	}

	/** Nachricht als Text verarbeiten (auch für den Autotest); true = verstanden und angewendet */
	public static boolean handle(String text) {
		JsonObject json;
		try {
			JsonElement element = JsonParser.parseString(text);
			if (!element.isJsonObject()) return false;
			json = element.getAsJsonObject();
		} catch (RuntimeException e) {
			return false;
		}
		String type = string(json, "t");
		if (type == null) return false;
		try {
			return switch (type) {
				case "welcome" -> welcome(json);
				case "rules" -> rules(json);
				case "hud_set" -> hudSet(json);
				case "hud_remove" -> {
					String id = string(json, "id");
					if (id == null || !ID.matcher(id).matches()) yield false;
					ServerHud.remove(id);
					yield true;
				}
				case "hud_clear" -> {
					ServerHud.clear();
					yield true;
				}
				case "toast" -> toast(json);
				default -> false;
			};
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.debug("Kanal heldixclient:server: Nachricht {} nicht lesbar", type, e);
			return false;
		}
	}

	private static boolean welcome(JsonObject json) {
		heldix = true;
		String name = clean(string(json, "server"), 40);
		serverName = name == null ? "" : name;
		String partner = string(json, "partner");
		partnerHint = partner != null && PARTNER_ID.matcher(partner).matches() ? partner : null;
		HeldixClient.LOGGER.info("Server spricht Heldix ({}{})", serverName.isEmpty() ? address : serverName,
				partnerHint != null ? ", meldet Partner " + partnerHint : "");
		publish();
		return true;
	}

	private static boolean rules(JsonObject json) {
		List<String> keys = new ArrayList<>();
		if (json.has("disable") && json.get("disable").isJsonArray()) {
			for (JsonElement element : json.getAsJsonArray("disable")) {
				// nur Texte: Zahlen oder Wahrheitswerte sind keine Regel-Schlüssel (getAsString würde aus 5 „5“ machen)
				if (!element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) continue;
				String key = element.getAsString().strip().toLowerCase(Locale.ROOT);
				if (ServerRules.KEY.matcher(key).matches()) keys.add(key);
			}
		}
		if (ServerRules.set(keys)) {
			publish();
			announceBlocked();
		}
		return true;
	}

	/** Neue Regeln sperren eingeschaltete Module: einmal sagen, warum etwas verschwindet */
	private static void announceBlocked() {
		List<String> names = new ArrayList<>();
		for (Module module : ModuleManager.all()) {
			if (module.isEnabled() && ServerRules.blocks(module) && !names.contains(module.name())) names.add(module.name());
		}
		if (names.isEmpty()) return;
		Notifications.show("server-rules", "Serverregeln", "Auf diesem Server deaktiviert: " + String.join(", ", names), null);
	}

	private static boolean hudSet(JsonObject json) {
		String id = string(json, "id");
		ServerHud.Type type = ServerHud.Type.of(string(json, "type"));
		ServerHud.Anchor anchor = ServerHud.Anchor.of(string(json, "anchor"));
		if (id == null || !ID.matcher(id).matches() || type == null || anchor == null) return false;
		String title = clean(string(json, "title"), 40);
		String text = clean(string(json, "text"), 120);
		List<String> lines = new ArrayList<>();
		if (json.has("lines") && json.get("lines").isJsonArray()) {
			JsonArray array = json.getAsJsonArray("lines");
			for (JsonElement line : array) {
				if (lines.size() >= 10) break;
				if (!line.isJsonPrimitive()) continue;
				String clean = clean(line.getAsString(), 80);
				if (clean != null) lines.add(clean);
			}
		}
		float value = 0;
		if (json.has("value") && json.get("value").isJsonPrimitive() && json.get("value").getAsJsonPrimitive().isNumber()) {
			double raw = json.get("value").getAsDouble();
			value = Double.isFinite(raw) ? (float) Math.clamp(raw, 0, 1) : 0;
		}
		String colorText = string(json, "color");
		Integer color = colorText != null && COLOR.matcher(colorText).matches() ? Integer.parseInt(colorText.substring(1), 16) : null;
		boolean clickable = json.has("clickable") && json.get("clickable").isJsonPrimitive() && json.get("clickable").getAsJsonPrimitive().isBoolean()
				&& json.get("clickable").getAsBoolean();
		ServerHud.Element element = new ServerHud.Element(id, type, anchor, title == null ? "" : title, text == null ? "" : text, List.copyOf(lines),
				value, color, clickable);
		return ServerHud.set(element);
	}

	private static boolean toast(JsonObject json) {
		String title = clean(string(json, "title"), 40);
		String text = clean(string(json, "text"), 120);
		if ((title == null || title.isEmpty()) && (text == null || text.isEmpty())) return false;
		long now = System.currentTimeMillis();
		if (lastToastAt != 0 && now - lastToastAt < TOAST_MS) return false;
		lastToastAt = now;
		if (!dev.heldixclient.config.HeldixConfig.get().serverToasts) return true;
		String fallback = serverName.isEmpty() ? "Server" : serverName;
		Notifications.show("server", title == null || title.isEmpty() ? fallback : title, text == null ? "" : text, null);
		return true;
	}

	// ======================================================================================
	// Stand und Partner
	// ======================================================================================

	/** Partnerliste neu geladen (beliebiger Thread) */
	static void partnerListChanged() {
		Minecraft mc = Minecraft.getInstance();
		if (mc == null) return;
		mc.execute(() -> {
			if (address != null) publish();
		});
	}

	/** Stand neu bilden; geändert → Listener */
	private static void publish() {
		Snapshot next;
		if (address == null) {
			next = NONE;
		} else {
			Partners.Partner partner = Partners.forAddress(address);
			next = new Snapshot(true, address, heldix, heldix ? serverName : "", partner != null, partner != null ? partner.name() : "",
					ServerRules.disabled());
		}
		if (next.equals(snapshot)) return;
		snapshot = next;
		for (Runnable listener : LISTENERS) {
			try {
				listener.run();
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.warn("Server-Info: Listener fehlgeschlagen", e);
			}
		}
	}

	private static final List<Runnable> LANGUAGE_LISTENERS = new CopyOnWriteArrayList<>();

	/** Sprache gewechselt (Haupt-Thread) */
	public static void addLanguageListener(Runnable listener) {
		LANGUAGE_LISTENERS.add(listener);
	}

	private static void languageChanged() {
		for (Runnable listener : LANGUAGE_LISTENERS) {
			try {
				listener.run();
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.warn("Sprache: Listener fehlgeschlagen", e);
			}
		}
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static String string(JsonObject json, String key) {
		if (!json.has(key) || !json.get(key).isJsonPrimitive()) return null;
		return json.get(key).getAsString();
	}

	/**
	 * Text vom Server bereinigen: §-Codes (§ und das Zeichen danach), Steuer- und Formatzeichen (auch Schreibrichtung)
	 * entfernen, Leerraum zusammenfassen, auf {@code max} Zeichen kürzen (ohne ein Zeichenpaar zu teilen). null bleibt null.
	 */
	public static String clean(String text, int max) {
		if (text == null) return null;
		String clean = text.replaceAll("§.?", "").replaceAll("[\\p{Cc}\\p{Cf}\\p{Cs}\\u2028\\u2029]", " ").replaceAll("\\s+", " ").strip();
		if (clean.length() > max) {
			int end = max;
			if (Character.isHighSurrogate(clean.charAt(end - 1))) end--;
			clean = clean.substring(0, end).strip();
		}
		return clean;
	}

	// --- Autotest ---------------------------------------------------------------------------

	/** Was HeldixClient zuletzt auf dem Kanal geschickt hat ("register", "hello", "hud_click") */
	public static List<String> sent() {
		return List.copyOf(SENT);
	}

	/** Wie ein betretener Server mit dieser Adresse (ohne Verbindung) – für Prüfungen im Einzelspieler */
	public static void simulateServer(String testAddress) {
		reset();
		address = testAddress;
		publish();
	}

	/** Simulierten Server wieder verlassen */
	public static void simulateLeave() {
		left();
	}

	/** Ist der Eingriff in DiscardedPayload aktiv (bzw. der Kanal bei Fabric API angemeldet)? */
	public static boolean available() {
		return canSend();
	}
}
