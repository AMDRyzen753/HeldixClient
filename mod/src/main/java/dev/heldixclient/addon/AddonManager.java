package dev.heldixclient.addon;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixEvents;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.AddonManifest;
import dev.heldixclient.loader.api.LoaderAddon;
import dev.heldixclient.loader.api.event.ChatEvents;
import dev.heldixclient.loader.api.event.ClientEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.player.LocalPlayer;

import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * Lädt Heldix-Addons aus dem Ordner heldix-addons/ der Instanz.
 *
 * Reine API-Addons sehen nur die stabile Heldix-API (keine Minecraft-Klassen) und bekommen je einen eigenen
 * Classloader. Addons mit Zugriff auf Minecraft (clientEntrypoint oder transformers in der heldix.addon.json) hat der
 * Heldix Loader schon beim Start geladen; ihr entrypoint kommt hier über dessen Classloader. Fehler in einem Addon
 * werden abgefangen; nach mehreren Fehlern wird das Addon deaktiviert, das Spiel läuft weiter.
 */
public final class AddonManager {
	public static final String ADDON_DIR = "heldix-addons";
	public static final String METADATA_FILE = "heldix.addon.json";
	private static final int MAX_ERRORS = 3;

	record Listener<T>(LoadedAddon addon, T callback) {
	}

	/** Taste eines Addons (API 2); id = Tasten-ID des Addons, apiCode = Standardtaste als Code aus HeldixKeys */
	record Key(LoadedAddon addon, String id, net.minecraft.client.KeyMapping mapping, Runnable onPress, int apiCode) {
	}

	/** Falsch übersetzte Tasten aus options.txt einmal nach dem Laden der Optionen reparieren */
	private static boolean keysMigrated;

	private static final List<LoadedAddon> ADDONS = new ArrayList<>();
	static final List<Listener<Runnable>> TICK = new ArrayList<>();
	static final List<Listener<Runnable>> WORLD_JOIN = new ArrayList<>();
	static final List<Listener<Runnable>> WORLD_LEAVE = new ArrayList<>();
	static final List<Listener<Consumer<String>>> CHAT = new ArrayList<>();
	static final List<Key> KEYS = new ArrayList<>();
	// API 3: abmeldbar (Registration), deshalb thread-sicher
	static final List<Listener<Consumer<String>>> SERVER_JOIN = new CopyOnWriteArrayList<>();
	static final List<Listener<Consumer<String>>> SERVER_LEAVE = new CopyOnWriteArrayList<>();
	static final List<Listener<Consumer<String>>> SCREEN_OPEN = new CopyOnWriteArrayList<>();
	static final List<Listener<Consumer<String>>> SCREEN_CLOSE = new CopyOnWriteArrayList<>();
	static final List<Listener<Runnable>> DEATH = new CopyOnWriteArrayList<>();
	static final List<Listener<Runnable>> RESPAWN = new CopyOnWriteArrayList<>();
	static final List<Listener<Consumer<String>>> DIMENSION = new CopyOnWriteArrayList<>();
	static final List<Listener<HeldixEvents.HealthListener>> HEALTH = new CopyOnWriteArrayList<>();

	/** Zustand aus dem letzten Tick, um Änderungen zu erkennen (nur Haupt-Thread) */
	private static Screen lastScreen;
	private static String lastScreenKind = "";
	private static boolean wasDead;
	private static String lastDimension;
	private static float lastHealth = -1;
	private static String serverAddress;

	/** Addon, dessen Taste, Befehl oder Knopf gerade läuft (Chat an den Server erlaubt), sonst null */
	private static LoadedAddon actionAddon;
	private static int actionMessages;
	/** älteste API-Version, für die gebaute Addons noch laufen */
	public static final int MIN_API = 1;

	private AddonManager() {
	}

	public static Path addonDirectory() {
		return HeldixLoader.gameDir().resolve(ADDON_DIR);
	}

	public static List<LoadedAddon> addons() {
		return Collections.unmodifiableList(ADDONS);
	}

	public static long activeCount() {
		return ADDONS.stream().filter(LoadedAddon::isActive).count();
	}

	/** Sucht und lädt alle Addons. Wird einmal beim Start des Clients aufgerufen. */
	public static void init() {
		Path dir = addonDirectory();
		List<Path> jars = new ArrayList<>();
		try {
			Files.createDirectories(dir);
			// im Addon-Store entfernte bzw. ersetzte JARs (unter Windows waren sie bis zum Spielende gesperrt);
			// meist hat das der Heldix Loader beim Start schon erledigt
			AddonStore.applyPendingRemovals(dir);
			try (Stream<Path> files = Files.list(dir)) {
				// abgeschaltete (.jar.disabled, wie im Launcher) nur anzeigen, nicht laden
				files.filter(p -> p.getFileName().toString().endsWith(".jar") || p.getFileName().toString().endsWith(".jar" + AddonFiles.DISABLED))
						.sorted().forEach(jars::add);
			}
		} catch (Exception e) {
			HeldixClient.LOGGER.error("Heldix-Addons: Ordner {} nicht lesbar", dir, e);
		}

		// erst alle Beschreibungen lesen: liegt ein Addon in mehreren Versionen da, gewinnt die neueste
		java.util.Map<String, LoadedAddon> newest = new java.util.HashMap<>();
		for (Path jar : jars) {
			LoadedAddon addon = new LoadedAddon(jar);
			ADDONS.add(addon);
			if (jar.getFileName().toString().endsWith(AddonFiles.DISABLED)) {
				addon.state = LoadedAddon.State.DISABLED;
				try {
					addon.metadata = readMetadata(jar);
				} catch (Throwable t) {
					addon.error = describe(t);
				}
				continue;
			}
			try {
				addon.metadata = readMetadata(jar);
				String id = addon.metadata.id;
				if (id != null) {
					LoadedAddon other = newest.get(id);
					if (other == null || compareVersions(addon.metadata.version, other.metadata.version) > 0) newest.put(id, addon);
				}
			} catch (Throwable t) {
				deactivate(addon, describe(t));
				HeldixClient.LOGGER.error("Heldix-Addon {} konnte nicht gelesen werden", addon.fileName(), t);
			}
		}

		Set<String> ids = new HashSet<>();
		for (LoadedAddon addon : ADDONS) {
			if (addon.metadata == null || addon.state == LoadedAddon.State.DISABLED) continue;
			LoadedAddon chosen = addon.metadata.id != null ? newest.get(addon.metadata.id) : null;
			if (chosen != null && chosen != addon) {
				boolean older = compareVersions(addon.metadata.version, chosen.metadata.version) < 0;
				deactivate(addon, older
						? "Ältere Version – genutzt wird " + chosen.metadata.version + " (" + chosen.fileName() + ")"
						: "Doppelt installiert – genutzt wird " + chosen.fileName());
				HeldixClient.LOGGER.warn("Heldix-Addon {} übersprungen: {}", addon.fileName(), addon.error());
				continue;
			}
			load(addon, ids);
		}
		registerEvents();
		HeldixClient.LOGGER.info("Heldix-Addons: {} von {} aktiv", activeCount(), ADDONS.size());
	}

	private static void load(LoadedAddon addon, Set<String> ids) {
		try {
			AddonMetadata meta = addon.metadata;
			if (meta.id == null || !meta.id.matches("[a-z0-9_-]+")) throw new IllegalStateException("Ungültige Addon-ID: " + meta.id);
			if (!ids.add(meta.id)) throw new IllegalStateException("Addon-ID \"" + meta.id + "\" ist doppelt installiert");
			// die API-Stufe zählt nur mit entrypoint (ein Addon nur mit Eingriffen in Minecraft nutzt die Heldix-API nicht)
			if (meta.entrypoint != null && (meta.api < MIN_API || meta.api > HeldixApi.API_VERSION)) {
				throw new IllegalStateException(meta.api > HeldixApi.API_VERSION
						? "Braucht Heldix-API " + meta.api + ", dieser HeldixClient kann bis API " + HeldixApi.API_VERSION + " – bitte HeldixClient aktualisieren"
						: "Gebaut für die veraltete Heldix-API " + meta.api + ", unterstützt wird ab API " + MIN_API);
			}
			if (!meta.problems().isEmpty()) throw new IllegalStateException(meta.problems().getFirst());
			String loaderProblem = meta.loaderProblem(HeldixLoader.version());
			if (loaderProblem != null) throw new IllegalStateException(loaderProblem);

			if (meta.minecraftAccess()) {
				// Zugriff auf Minecraft: Der Heldix Loader hat die JAR schon beim Start geladen (Transformer, clientEntrypoint);
				// der entrypoint kommt über genau dessen Classloader, damit es keine Klasse doppelt gibt
				LoaderAddon status = loaderStatus(addon.file);
				if (status == null) throw new IllegalStateException("Vom Heldix Loader nicht geladen – bitte das Spiel neu starten");
				addon.loaderAddon = status;
				if (!status.active()) throw new IllegalStateException(status.problem() != null ? status.problem() : "Vom Heldix Loader nicht geladen");
				addon.classLoader = status.classLoader();
			} else {
				// "minecraft" und "loaders" sind bei reinen API-Addons freiwillig, gelten aber genauso
				String version = meta.manifest != null ? meta.manifest.minecraftProblem(HeldixLoader.minecraftVersion()) : null;
				if (version != null) throw new IllegalStateException(version);
				String platform = meta.manifest != null ? meta.manifest.platformProblem(HeldixLoader.platform()) : null;
				if (platform != null) throw new IllegalStateException(platform);
				URL url = addon.file.toUri().toURL();
				addon.classLoader = new URLClassLoader("heldix-addon-" + meta.id, new URL[] {url}, AddonManager.class.getClassLoader());
			}
			if (meta.entrypoint == null) {
				// nur Eingriffe in Minecraft (Transformer, clientEntrypoint) – das hat der Loader schon erledigt
				addon.state = LoadedAddon.State.ACTIVE;
				HeldixClient.LOGGER.info("Heldix-Addon {} {} geladen (greift in Minecraft ein, ohne Heldix-API)", meta.displayName(), meta.version);
				return;
			}
			Class<?> type = Class.forName(meta.entrypoint, true, addon.classLoader);
			if (!HeldixAddon.class.isAssignableFrom(type)) {
				throw new IllegalStateException(meta.entrypoint + " implementiert HeldixAddon nicht");
			}
			addon.instance = (HeldixAddon) type.getDeclaredConstructor().newInstance();
			addon.context = new AddonContext(addon);
			addon.state = LoadedAddon.State.ACTIVE;
			addon.instance.onEnable(addon.context);
			HeldixClient.LOGGER.info("Heldix-Addon {} {} geladen{}", meta.displayName(), meta.version, meta.minecraftAccess() ? " (greift in Minecraft ein)" : "");
		} catch (Throwable t) {
			deactivate(addon, describe(t));
			HeldixClient.LOGGER.error("Heldix-Addon {} konnte nicht geladen werden", addon.fileName(), t);
		}
	}

	/** Vergleicht Versionen wie "1.2.0" zahlenweise; Text dahinter (z. B. "-beta") zählt nicht. */
	public static int compareVersions(String a, String b) {
		String[] x = (a != null ? a : "").split("[.+-]");
		String[] y = (b != null ? b : "").split("[.+-]");
		for (int i = 0; i < Math.max(x.length, y.length); i++) {
			int diff = Integer.compare(number(x, i), number(y, i));
			if (diff != 0) return diff;
		}
		return 0;
	}

	private static int number(String[] parts, int index) {
		if (index >= parts.length) return 0;
		try {
			return Integer.parseInt(parts[index].replaceAll("\\D.*", ""));
		} catch (NumberFormatException e) {
			return 0;
		}
	}

	/** Liest die heldix.addon.json (Version 2, geprüft nach den Regeln des Heldix Loaders); Fehler stehen in problems(). */
	static AddonMetadata readMetadata(Path jar) throws Exception {
		return AddonMetadata.of(AddonManifest.read(jar));
	}

	/** Für den Autotest und die Fehlersuche: Manifest aus Text lesen und prüfen (Fehler auf Deutsch, leer = in Ordnung). */
	public static List<String> manifestProblems(String json) {
		return AddonManifest.parse(json).problems();
	}

	/** Das Addon, wie es der Heldix Loader beim Start gesehen hat (nur Addons mit Zugriff auf Minecraft), sonst null */
	private static LoaderAddon loaderStatus(Path file) {
		Path wanted = file.toAbsolutePath().normalize();
		for (LoaderAddon addon : HeldixLoader.addons()) {
			if (addon.file().toAbsolutePath().normalize().equals(wanted)) return addon;
		}
		return null;
	}

	// ======================================================================================
	// An/aus im Heldix-Menü
	// ======================================================================================

	/**
	 * Schalter im Heldix-Menü (Mods &amp; Addons → Installiert). Gespeichert wird wie im Launcher (Datei .jar.disabled).
	 * Ausschalten wirkt bei reinen API-Addons sofort; Addons, die in Minecraft eingreifen, laufen bis zum Neustart
	 * weiter (Transformer lassen sich nicht zurücknehmen). Einschalten wirkt immer nach dem Neustart, weil Addons ihre
	 * Tasten beim Start anlegen. Im Menü steht dann „Wirkt nach dem Neustart“.
	 *
	 * @return false, wenn die Datei nicht geändert werden konnte
	 */
	public static boolean setEnabled(LoadedAddon addon, boolean on) {
		if (!AddonFiles.setSwitchedOn(addon, on)) return false;
		if (!on && addon.state != LoadedAddon.State.DISABLED && !addon.runsInMinecraft()) {
			stop(addon);
			HeldixClient.LOGGER.info("Heldix-Addon {} im Heldix-Menü ausgeschaltet", addon.name());
		} else {
			HeldixClient.LOGGER.info("Heldix-Addon {} im Heldix-Menü {}geschaltet – wirkt nach dem Neustart", addon.name(), on ? "ein" : "aus");
		}
		return true;
	}

	/** Sofort ausschalten (reine API-Addons): onDisable, Module weg, Aufgaben abbrechen, Listener werden übersprungen */
	private static void stop(LoadedAddon addon) {
		boolean wasActive = addon.isActive();
		addon.state = LoadedAddon.State.DISABLED;
		addon.error = null;
		if (wasActive && addon.instance != null) {
			try {
				addon.instance.onDisable();
			} catch (Throwable t) {
				HeldixClient.LOGGER.warn("Heldix-Addon {}: Fehler in onDisable", addon.name(), t);
			}
		}
		for (Module module : addon.modules) ModuleManager.removeModule(module);
		if (addon.scheduler != null) addon.scheduler.shutdown();
		AddonPlayers.release(addon);
		AddonImages.release(addon);
	}

	private static String describe(Throwable t) {
		Throwable root = t;
		while (root.getCause() != null && root.getCause() != root) root = root.getCause();
		String message = root.getMessage();
		return message != null ? message : root.getClass().getSimpleName();
	}

	/** Schaltet ein Addon ab: Module entfernen, geplante Aufgaben abbrechen, Listener werden ab jetzt übersprungen. */
	static void deactivate(LoadedAddon addon, String reason) {
		addon.state = LoadedAddon.State.FAILED;
		addon.error = reason;
		for (Module module : addon.modules) ModuleManager.removeModule(module);
		if (addon.scheduler != null) addon.scheduler.shutdown();
		AddonPlayers.release(addon);
		AddonImages.release(addon);
	}

	/** Fehler eines Addons zur Laufzeit melden; nach MAX_ERRORS wird es abgeschaltet. Nur im Haupt-Thread. */
	static void reportError(LoadedAddon addon, String where, Throwable t) {
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft != null && !minecraft.isSameThread()) {
			minecraft.execute(() -> reportError(addon, where, t));
			return;
		}
		addon.errorCount++;
		HeldixClient.LOGGER.error("Heldix-Addon {} – Fehler in {}", addon.name(), where, t);
		if (addon.errorCount >= MAX_ERRORS && addon.isActive()) {
			deactivate(addon, "Abgeschaltet nach " + MAX_ERRORS + " Fehlern: " + describe(t));
			HeldixClient.LOGGER.error("Heldix-Addon {} wurde abgeschaltet", addon.name());
		}
	}

	private static void runAll(List<Listener<Runnable>> listeners, String where) {
		for (Listener<Runnable> listener : List.copyOf(listeners)) {
			if (!listener.addon().isActive()) continue;
			try {
				listener.callback().run();
			} catch (Throwable t) {
				reportError(listener.addon(), where, t);
			}
		}
	}

	/** API 3: Listener aufrufen; Fehler zählen wie alle Addon-Fehler */
	static <T> void dispatch(List<Listener<T>> listeners, String where, Consumer<T> call) {
		if (listeners.isEmpty()) return;
		for (Listener<T> listener : List.copyOf(listeners)) {
			if (!listener.addon().isActive()) continue;
			try {
				call.accept(listener.callback());
			} catch (Throwable t) {
				reportError(listener.addon(), where, t);
			}
		}
	}

	private static void registerEvents() {
		ClientEvents.TICK_END.register(minecraft -> {
			AddonSnapshots.tick();
			if (!keysMigrated) {
				keysMigrated = true;
				try {
					AddonKeys.migrate(KEYS);
				} catch (RuntimeException e) {
					HeldixClient.LOGGER.warn("Heldix-Addons: Tastenbelegung nicht prüfbar", e);
				}
			}
			keys();
			for (LoadedAddon addon : ADDONS) {
				if (addon.scheduler != null && addon.isActive()) addon.scheduler.tick();
			}
			AddonDroppedItems.tick();
			try {
				watch(minecraft);
			} catch (RuntimeException e) {
				// Fehler der Addons fängt dispatch ab; das hier wäre ein Fehler von HeldixClient selbst
				HeldixClient.LOGGER.warn("Heldix-Addons: Events nicht prüfbar", e);
			}
			runAll(TICK, "onTick");
		});
		WorldEvents.JOIN.register(minecraft -> {
			lastDimension = null;
			lastHealth = -1;
			wasDead = false;
			runAll(WORLD_JOIN, "onWorldJoin");
			ServerData server = minecraft.getCurrentServer();
			serverAddress = server != null && !minecraft.isLocalServer() ? server.ip : null;
			if (serverAddress != null) {
				String address = serverAddress;
				dispatch(SERVER_JOIN, "onServerJoin", listener -> listener.accept(address));
			}
		});
		WorldEvents.LEAVE.register(minecraft -> {
			AddonDroppedItems.clear();
			runAll(WORLD_LEAVE, "onWorldLeave");
			if (serverAddress != null) {
				String address = serverAddress;
				serverAddress = null;
				dispatch(SERVER_LEAVE, "onServerLeave", listener -> listener.accept(address));
			}
		});
		ChatEvents.RECEIVE.register((message, fromPlayer) -> chat(message.getString()));
		ClientEvents.STOPPING.register(minecraft -> {
			for (LoadedAddon addon : ADDONS) {
				if (!addon.isActive() || addon.instance == null) continue;
				try {
					addon.instance.onDisable();
				} catch (Throwable t) {
					HeldixClient.LOGGER.warn("Heldix-Addon {}: Fehler in onDisable", addon.name(), t);
				}
			}
			for (LoadedAddon addon : ADDONS) {
				if (addon.scheduler != null) addon.scheduler.shutdown();
			}
		});
	}

	/** API 3: Menüs, Tod und Wiederbeleben, Dimension und Leben einmal pro Tick vergleichen */
	private static void watch(Minecraft mc) {
		Screen screen = mc.gui.screen();
		if (screen != lastScreen) {
			String closed = lastScreenKind;
			boolean hadScreen = lastScreen != null;
			lastScreen = screen;
			lastScreenKind = AddonSnapshots.screenKind(screen);
			if (hadScreen) dispatch(SCREEN_CLOSE, "onScreenClose", listener -> listener.accept(closed));
			String opened = lastScreenKind;
			if (screen != null) dispatch(SCREEN_OPEN, "onScreenOpen", listener -> listener.accept(opened));
		}

		LocalPlayer player = mc.player;
		if (player == null || mc.level == null) {
			wasDead = false;
			lastDimension = null;
			lastHealth = -1;
			return;
		}
		boolean dead = player.isDeadOrDying();
		if (dead != wasDead) {
			wasDead = dead;
			if (dead) dispatch(DEATH, "onDeath", Runnable::run);
			else dispatch(RESPAWN, "onRespawn", Runnable::run);
		}
		String dimension = mc.level.dimension().identifier().getPath();
		if (lastDimension != null && !dimension.equals(lastDimension)) {
			dispatch(DIMENSION, "onDimensionChange", listener -> listener.accept(dimension));
		}
		lastDimension = dimension;
		float health = player.getHealth();
		if (lastHealth >= 0 && Math.abs(health - lastHealth) > 1e-4f) {
			float previous = lastHealth;
			dispatch(HEALTH, "onHealthChange", listener -> listener.onChange(previous, health));
		}
		lastHealth = health;
	}

	private static void keys() {
		for (Key key : KEYS) {
			while (key.mapping().consumeClick()) {
				if (!key.addon().isActive()) continue;
				userAction(key.addon(), "Taste " + key.mapping().getName(), key.onPress());
			}
		}
	}

	/** Gibt es die Taste {@code keyId} des aktiven Addons {@code addonId}? (z. B. Voice Chat → „mute“) */
	public static boolean hasKey(String addonId, String keyId) {
		return findKey(addonId, keyId) != null;
	}

	/**
	 * Löst die Taste eines aktiven Addons aus wie ein Tastendruck des Spielers (Knöpfe im Pausemenü, z. B. Mikrofon stumm im
	 * Voice Chat). Nur im Haupt-Thread. false, wenn es Addon oder Taste nicht (aktiv) gibt.
	 */
	public static boolean runKey(String addonId, String keyId) {
		Key key = findKey(addonId, keyId);
		if (key == null) return false;
		userAction(key.addon(), "Knopf " + key.mapping().getName(), key.onPress());
		return true;
	}

	private static Key findKey(String addonId, String keyId) {
		for (Key key : KEYS) {
			if (key.addon().isActive() && key.addon().id().equals(addonId) && key.id().equals(keyId)) return key;
		}
		return null;
	}

	// --- Aktionen des Spielers (API 3): nur hier darf ein Addon an den Server chatten ----------

	/** Führt eine Taste, einen Befehl oder einen Knopf eines Addons aus; Fehler zählen als Addon-Fehler */
	static void userAction(LoadedAddon addon, String where, Runnable action) {
		LoadedAddon previousAddon = actionAddon;
		int previousMessages = actionMessages;
		actionAddon = addon;
		actionMessages = 0;
		try {
			action.run();
		} catch (Throwable t) {
			reportError(addon, where, t);
		} finally {
			actionAddon = previousAddon;
			actionMessages = previousMessages;
		}
	}

	/** Vor dem Senden: wirft, wenn gerade keine Aktion des Spielers für dieses Addon läuft */
	static void requireUserAction(LoadedAddon addon) {
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft == null || !minecraft.isSameThread() || actionAddon != addon) {
			throw new IllegalStateException("Chat an den Server nur direkt nach einer Aktion des Spielers (Taste, Chat-Befehl oder Knopf)");
		}
		if (actionMessages >= 1) throw new IllegalStateException("Höchstens eine Chatnachricht an den Server pro Aktion");
		actionMessages++;
	}

	/** ChatScreen.handleChatInput: Addon-Befehl („.np“) statt Nachricht an den Server? */
	public static boolean handleChatInput(String message, boolean addToHistory) {
		return AddonCommands.handle(message, addToHistory);
	}

	private static void chat(String text) {
		for (Listener<Consumer<String>> listener : List.copyOf(CHAT)) {
			if (!listener.addon().isActive()) continue;
			try {
				listener.callback().accept(text);
			} catch (Throwable t) {
				reportError(listener.addon(), "onChatMessage", t);
			}
		}
	}
}
