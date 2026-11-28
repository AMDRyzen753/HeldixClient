package dev.heldixclient.share;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.share.HostingService.Hosted;
import dev.heldixclient.share.HostingService.Overview;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Dauerhafte Welten im Spiel (ab Heldix-Dienst 1.13.0): letzter Stand von {@code GET /v1/hosting} (eigene Welten und
 * solche, in denen man Operator ist), angepasst durch die Echtzeit-Nachrichten {@code hosting-state}; Anklopfen an einer
 * dauerhaften Welt ({@code hosting-knock}) mit derselben Einblendung und denselben Tasten wie bei „Welt teilen“
 * ({@link KnockPrompt}); die Freischaltung ({@code hosting-granted}) als Einblendung.
 *
 * <p>Echtzeit kommt auf dem Netzwerk-Thread; der Stand ist unveränderlich und wird nur als Ganzes ersetzt.
 */
public final class Hosting {
	/** Anklopfen an einer dauerhaften Welt (Name, wie ihn das Relay meldet) */
	public record Knock(String worldId, String worldName, String address, String name, long at) {
	}

	/** so lange wartet ein Anklopfen auf Antwort (wie bei Welt teilen) */
	private static final long KNOCK_MS = 120_000;
	private static final int MAX_KNOCKS = 8;

	private static volatile Overview overview;
	private static volatile HostingService.Plus plus;
	private static volatile int changes;
	private static volatile CompletableFuture<Overview> loading;
	private static final List<Knock> KNOCKS = new CopyOnWriteArrayList<>();

	private Hosting() {
	}

	/** letzter Stand (null = noch nicht geladen) */
	public static Overview overview() {
		return overview;
	}

	/** zählt jede Änderung (Heldix-Welten baut sich dann neu auf) */
	public static int changes() {
		return changes;
	}

	/** Stand neu holen; läuft schon eine Abfrage, deren Ergebnis */
	public static synchronized CompletableFuture<Overview> refresh() {
		CompletableFuture<Overview> running = loading;
		if (running != null && !running.isDone()) return running;
		CompletableFuture<Overview> next = HostingService.overview().whenComplete((result, error) -> {
			if (result != null) {
				overview = result;
				changes++;
			}
		});
		loading = next;
		return next;
	}

	/** Echtzeit verbunden: Stand holen (leise) */
	public static void connected() {
		refresh().exceptionally(error -> {
			HeldixClient.LOGGER.debug("Dauerhafte Welten: Stand nicht geladen ({})", WorldService.message(error));
			return null;
		});
	}

	/** dauerhafte Welt (eigene oder als Operator) zur Welt-ID, sonst null */
	public static Hosted find(String id) {
		Overview current = overview;
		if (current == null || id == null) return null;
		for (Hosted world : current.worlds()) if (world.id().equals(id)) return world;
		for (Hosted world : current.operated()) if (world.id().equals(id)) return world;
		return null;
	}

	/** dauerhafte Welt zur Adresse (Vergleich ohne Port), sonst null */
	public static Hosted byAddress(String address) {
		Overview current = overview;
		if (current == null || address == null) return null;
		String wanted = WorldShare.normalizeAddress(address);
		for (Hosted world : current.worlds()) if (world.address() != null && WorldShare.normalizeAddress(world.address()).equals(wanted)) return world;
		for (Hosted world : current.operated()) if (world.address() != null && WorldShare.normalizeAddress(world.address()).equals(wanted)) return world;
		return null;
	}

	/** Stand der Warteliste (null = noch nicht geladen) */
	public static HostingService.Plus plus() {
		return plus;
	}

	public static CompletableFuture<HostingService.Plus> refreshPlus() {
		return HostingService.plus().thenApply(Hosting::rememberPlus);
	}

	/** Auf die Warteliste (true) bzw. herunter (false) */
	public static CompletableFuture<HostingService.Plus> waitlist(boolean join) {
		return HostingService.waitlist(join).thenApply(Hosting::rememberPlus);
	}

	private static HostingService.Plus rememberPlus(HostingService.Plus value) {
		plus = value;
		changes++;
		return value;
	}

	/** Welt angelegt, hochgeladen oder beendet: Stand übernehmen (ohne auf die Echtzeit zu warten) */
	static void remember(Hosted world) {
		if (world != null) apply(world, false);
	}

	// ======================================================================================
	// Echtzeit (Netzwerk-Thread)
	// ======================================================================================

	/** {@code { type: 'hosting-state', world: HostedWorld | { id, state: 'deleted' } }} */
	public static void onState(JsonObject message) {
		JsonElement element = message.get("world");
		if (element == null || !element.isJsonObject()) return;
		JsonObject world = element.getAsJsonObject();
		String id = world.has("id") && world.get("id").isJsonPrimitive() ? world.get("id").getAsString() : null;
		if (id == null || !WorldService.WORLD_ID.matcher(id).matches()) return;
		if ("deleted".equals(world.has("state") && world.get("state").isJsonPrimitive() ? world.get("state").getAsString() : null)) {
			remove(id);
			return;
		}
		Hosted hosted = HostingService.hosted(world);
		if (hosted == null) return;
		if (overview == null) {
			// noch kein Stand: einmal ganz holen
			connected();
			return;
		}
		apply(hosted, true);
	}

	private static synchronized void apply(Hosted world, boolean realtime) {
		Overview current = overview;
		if (current == null) return;
		List<Hosted> own = new ArrayList<>(current.worlds());
		List<Hosted> operated = new ArrayList<>(current.operated());
		own.removeIf(w -> w.id().equals(world.id()));
		operated.removeIf(w -> w.id().equals(world.id()));
		(world.owner() ? own : operated).add(world);
		own.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
		operated.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
		overview = new Overview(current.available(), current.allowed(), current.reason(), current.team(), current.limits(), List.copyOf(own),
				List.copyOf(operated), current.problem());
		changes++;
		if (realtime) HeldixClient.LOGGER.debug("Dauerhafte Welt: neuer Zustand {}", world.state().id);
	}

	private static synchronized void remove(String id) {
		Overview current = overview;
		if (current == null) return;
		overview = new Overview(current.available(), current.allowed(), current.reason(), current.team(), current.limits(),
				current.worlds().stream().filter(w -> !w.id().equals(id)).toList(), current.operated().stream().filter(w -> !w.id().equals(id)).toList(),
				current.problem());
		KNOCKS.removeIf(k -> k.worldId().equals(id));
		changes++;
	}

	/** {@code { type: 'hosting-knock', world: { id, name, address }, name }}: im Spiel mit Einblendung und H/N */
	public static void onKnock(JsonObject message, boolean notify) {
		JsonElement element = message.get("world");
		String name = message.has("name") && message.get("name").isJsonPrimitive() ? message.get("name").getAsString() : null;
		if (element == null || !element.isJsonObject() || name == null || !name.matches("^[A-Za-z0-9_]{1,16}$")) return;
		JsonObject world = element.getAsJsonObject();
		String id = world.has("id") && world.get("id").isJsonPrimitive() ? world.get("id").getAsString() : null;
		if (id == null || !WorldService.WORLD_ID.matcher(id).matches()) return;
		String worldName = WorldService.name(world.has("name") && world.get("name").isJsonPrimitive() ? world.get("name").getAsString() : null);
		String address = world.has("address") && world.get("address").isJsonPrimitive() ? world.get("address").getAsString() : null;
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> {
			KNOCKS.removeIf(k -> k.worldId().equals(id) && k.name().equalsIgnoreCase(name));
			KNOCKS.add(new Knock(id, worldName, address, name, System.currentTimeMillis()));
			while (KNOCKS.size() > MAX_KNOCKS) KNOCKS.removeFirst();
			HeldixClient.LOGGER.info("Dauerhafte Welt: jemand klopft an");
			// im Spiel zeigt KnockPrompt die Einblendung mit den Tasten; im Menü ein Hinweis
			if (notify && (mc.player == null || mc.gui.screen() != null)) {
				WorldShare.toast(mc, name + " möchte in „" + worldName + "“",
						mc.player == null ? "Im Spiel mit " + keys() + " beantworten – oder auf der Webseite (Meine Welten)" : "Menü schließen: " + keys());
			}
		});
	}

	private static String keys() {
		return "[" + HeldixClient.knockAllowKey.getTranslatedKeyMessage().getString() + "] Erlauben / ["
				+ HeldixClient.knockDenyKey.getTranslatedKeyMessage().getString() + "] Ablehnen";
	}

	/** {@code { type: 'hosting-granted', source, label, at, text, pending }}: Einblendung, danach „gesehen“ */
	public static void onGranted(JsonObject message, boolean notify) {
		refresh().exceptionally(error -> null);
		if (!notify) return;
		Minecraft mc = Minecraft.getInstance();
		mc.execute(() -> WorldShare.toast(mc, "Du kannst jetzt dauerhafte Welten anlegen",
				"Heldix-Welten → Deine Welten → „Dauerhaft online stellen“ – läuft auf dem Heldix-Server, auch wenn du offline bist"));
		HostingService.seen().thenAccept(Hosting::rememberPlus).exceptionally(error -> null);
	}

	// ======================================================================================
	// Anklopfen beantworten (Haupt-Thread)
	// ======================================================================================

	/** wartende Anfragen an dauerhaften Welten, älteste zuerst */
	public static List<Knock> knocks() {
		long now = System.currentTimeMillis();
		KNOCKS.removeIf(k -> now - k.at() >= KNOCK_MS);
		return List.copyOf(KNOCKS);
	}

	public static Knock currentKnock() {
		List<Knock> list = knocks();
		return list.isEmpty() ? null : list.getFirst();
	}

	/** Erlauben (wird Mitglied mit der Rolle für Neue) bzw. Ablehnen (10 Minuten) über den Dienst */
	public static void answer(Knock knock, boolean allow) {
		if (knock == null) return;
		KNOCKS.removeIf(k -> k.worldId().equals(knock.worldId()) && k.name().equalsIgnoreCase(knock.name()));
		Minecraft mc = Minecraft.getInstance();
		HostingService.answerKnock(knock.worldId(), knock.name(), allow).whenComplete((ignored, error) -> mc.execute(() -> {
			if (error != null) WorldShare.toast(mc, allow ? "Nicht erlaubt" : "Nicht abgelehnt", WorldService.message(error));
			else if (allow) WorldShare.toast(mc, "Beitritt erlaubt", knock.name() + " kann jetzt in „" + knock.worldName() + "“.");
		}));
	}

	// ======================================================================================
	// Webseite
	// ======================================================================================

	/** Ziel auf der Konto-Seite der Webseite: Meine Welten */
	public static final String WEB_TARGET = "welten";

	/**
	 * „Auf der Webseite verwalten“: Einmal-Link (angemeldet wie die anderen Webseiten-Links) zu Konto → Meine Welten. Der
	 * Dienst kennt das Ziel beim Einmal-Link nicht; die Konto-Seite liest es aber aus dem Fragment ({@code &ziel=welten}).
	 */
	public static CompletableFuture<Void> manageOnWebsite() {
		return Social.webLink().thenAccept(url -> {
			String target = url.contains("#code=") && !url.contains("ziel=") ? url + "&ziel=" + WEB_TARGET : url;
			Minecraft.getInstance().execute(() -> com.mojang.blaze3d.Blaze3D.openUri(java.net.URI.create(target)));
		});
	}

	/** Seite „Heldix+ – bald“ der Webseite im Browser (null = keine Webseite bekannt) */
	public static String openPlusPage() {
		String site = Social.websiteUrl();
		if (site == null) return null;
		com.mojang.blaze3d.Blaze3D.openUri(java.net.URI.create(site + "/plus"));
		return site + "/plus";
	}

	/** Nur für automatische Tests: eine Echtzeit-Nachricht wie vom Dienst verarbeiten */
	public static void testRealtime(JsonObject message) {
		Social.testRealtime(message);
	}
}
