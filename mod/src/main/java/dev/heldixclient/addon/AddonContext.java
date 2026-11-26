package dev.heldixclient.addon;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.loader.api.KeyMappings;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.api.AddonConfig;
import dev.heldixclient.api.AddonInfo;
import dev.heldixclient.api.CommandHandler;
import dev.heldixclient.api.DroppedItems;
import dev.heldixclient.api.GameInfo;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixEvents;
import dev.heldixclient.api.HeldixLogger;
import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.KeyHandle;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.api.PlayerInfo;
import dev.heldixclient.api.PlayerState;
import dev.heldixclient.api.Registration;
import dev.heldixclient.api.Scheduler;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.ui.Theme;
import net.minecraft.SharedConstants;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.TextColor;
import net.minecraft.util.StringUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Consumer;

/** Die HeldixApi, wie sie ein einzelnes Addon sieht. */
final class AddonContext implements HeldixApi {
	private final LoadedAddon addon;
	private final AddonInfo info;
	private final Logger log;
	private final HeldixLogger logger;
	private final HeldixEvents events;
	private final DroppedItems droppedItems;
	private final dev.heldixclient.api.Cosmetics cosmetics;
	private AddonConfigImpl config;

	AddonContext(LoadedAddon addon) {
		this.addon = addon;
		this.droppedItems = AddonDroppedItems.forAddon(addon);
		this.cosmetics = AddonCosmetics.forAddon(addon);
		AddonMetadata meta = addon.metadata;
		this.info = new AddonInfo(meta.id, meta.displayName(), meta.version, meta.description,
				meta.authors != null ? List.copyOf(meta.authors) : List.of());
		this.log = LoggerFactory.getLogger("Heldix-Addon/" + meta.displayName());
		this.logger = new HeldixLogger() {
			@Override
			public void info(String message) {
				log.info(message);
			}

			@Override
			public void warn(String message) {
				log.warn(message);
			}

			@Override
			public void error(String message, Throwable error) {
				log.error(message, error);
			}
		};
		this.events = new HeldixEvents() {
			@Override
			public void onTick(Runnable listener) {
				AddonManager.TICK.add(new AddonManager.Listener<>(addon, listener));
			}

			@Override
			public void onWorldJoin(Runnable listener) {
				AddonManager.WORLD_JOIN.add(new AddonManager.Listener<>(addon, listener));
			}

			@Override
			public void onWorldLeave(Runnable listener) {
				AddonManager.WORLD_LEAVE.add(new AddonManager.Listener<>(addon, listener));
			}

			@Override
			public void onChatMessage(Consumer<String> listener) {
				AddonManager.CHAT.add(new AddonManager.Listener<>(addon, listener));
			}

			// --- API 3 ---

			@Override
			public Registration onServerJoin(Consumer<String> listener) {
				return listen(AddonManager.SERVER_JOIN, listener);
			}

			@Override
			public Registration onServerLeave(Consumer<String> listener) {
				return listen(AddonManager.SERVER_LEAVE, listener);
			}

			@Override
			public Registration onScreenOpen(Consumer<String> listener) {
				return listen(AddonManager.SCREEN_OPEN, listener);
			}

			@Override
			public Registration onScreenClose(Consumer<String> listener) {
				return listen(AddonManager.SCREEN_CLOSE, listener);
			}

			@Override
			public Registration onDeath(Runnable listener) {
				return listen(AddonManager.DEATH, listener);
			}

			@Override
			public Registration onRespawn(Runnable listener) {
				return listen(AddonManager.RESPAWN, listener);
			}

			@Override
			public Registration onDimensionChange(Consumer<String> listener) {
				return listen(AddonManager.DIMENSION, listener);
			}

			@Override
			public Registration onHealthChange(HealthListener listener) {
				return listen(AddonManager.HEALTH, listener);
			}
		};
	}

	/** Listener anmelden; die Registration meldet genau diesen wieder ab */
	private <T> Registration listen(List<AddonManager.Listener<T>> list, T callback) {
		Objects.requireNonNull(callback, "listener");
		AddonManager.Listener<T> listener = new AddonManager.Listener<>(addon, callback);
		list.add(listener);
		return new Registration() {
			@Override
			public void cancel() {
				list.removeIf(entry -> entry == listener);
			}

			@Override
			public boolean isActive() {
				return addon.isActive() && list.stream().anyMatch(entry -> entry == listener);
			}
		};
	}

	@Override
	public AddonInfo addon() {
		return info;
	}

	@Override
	public String clientVersion() {
		return HeldixClient.version;
	}

	@Override
	public String loaderVersion() {
		return HeldixLoader.version();
	}

	@Override
	public String minecraftVersion() {
		return SharedConstants.getCurrentVersion().name();
	}

	@Override
	public HeldixLogger logger() {
		return logger;
	}

	@Override
	public HeldixEvents events() {
		return events;
	}

	@Override
	public ModuleHandle registerModule(ModuleSpec spec) {
		AddonToggleModule module = new AddonToggleModule(addon, spec);
		addon.modules.add(module);
		ModuleManager.addModule(module);
		return module;
	}

	@Override
	public ModuleHandle registerHudModule(ModuleSpec spec, HudRenderer renderer) {
		AddonHudModule module = new AddonHudModule(addon, spec, renderer);
		addon.modules.add(module);
		ModuleManager.addModule(module);
		return module;
	}

	@Override
	public Optional<PlayerInfo> player() {
		Minecraft mc = Minecraft.getInstance();
		LocalPlayer player = mc.player;
		if (player == null || mc.level == null) return Optional.empty();
		String dimension = mc.level.dimension().identifier().getPath();
		String biome = mc.level.getBiome(player.blockPosition()).unwrapKey().map(k -> k.identifier().getPath()).orElse("");
		return Optional.of(new PlayerInfo(player.getName().getString(), player.getX(), player.getY(), player.getZ(),
				player.getHealth(), player.getFoodData().getFoodLevel(), dimension, biome));
	}

	@Override
	public void chat(String message) {
		Minecraft mc = Minecraft.getInstance();
		Component prefix = Component.literal("[" + info.name() + "] ")
				.withStyle(style -> style.withColor(TextColor.fromRgb(Theme.ACCENT_LIGHT & 0xFFFFFF)));
		mc.gui.hud.getChat().addClientSystemMessage(Component.empty().append(prefix).append(Component.literal(message)));
	}

	@Override
	public AddonConfig config() {
		if (config == null) config = new AddonConfigImpl(info.id());
		return config;
	}

	// --- API 2 ------------------------------------------------------------------------------

	/** Gruppe „Heldix-Addons“ in der Steuerung (erst angelegt, wenn ein Addon eine Taste registriert) */
	private static KeyMapping.Category keyCategory;

	@Override
	public KeyHandle registerKey(String id, String name, int defaultKey, Runnable onPress) {
		if (id == null || !id.matches("[a-z0-9_-]+")) throw new IllegalArgumentException("Tasten-ID darf nur a-z, 0-9, _ und - enthalten: " + id);
		Objects.requireNonNull(onPress, "onPress");
		if (keyCategory == null) keyCategory = KeyMapping.Category.register(HeldixClient.id("addons"));
		// Der Name ist zugleich der Schlüssel in options.txt; ":" trennt dort Name und Wert
		String label = (info.name() + " – " + (name == null || name.isBlank() ? id : name)).replace(':', ' ');
		// HeldixKeys sind GLFW-Codes; Minecraft nimmt seit 26.x SDL-Scancodes (NONE = -1 würde sonst abstürzen)
		InputConstants.Key key = AddonKeys.toMinecraft(defaultKey);
		KeyMapping mapping = KeyMappings.register(new KeyMapping(label, InputConstants.Type.KEYBOARD, key.getValue(), keyCategory));
		AddonManager.KEYS.add(new AddonManager.Key(addon, mapping, onPress, defaultKey));
		return new KeyHandle() {
			@Override
			public boolean isDown() {
				return mapping.isDown();
			}

			@Override
			public String keyName() {
				return mapping.isUnbound() ? "" : mapping.getTranslatedKeyMessage().getString();
			}
		};
	}

	@Override
	public void notify(String title, String message) {
		notify(title, message, null);
	}

	@Override
	public void notify(String title, String message, Path image) {
		Notifications.show(info.id(), title, message, image);
	}

	@Override
	public Path dataDirectory() {
		Path dir = HeldixLoader.configDir().resolve("heldix-addons").resolve(info.id());
		try {
			Files.createDirectories(dir);
		} catch (Exception e) {
			log.warn("Ordner {} nicht anlegbar", dir, e);
		}
		return dir;
	}

	// --- API 3 ------------------------------------------------------------------------------

	@Override
	public GameInfo game() {
		return AddonSnapshots.game();
	}

	@Override
	public Optional<PlayerState> playerState() {
		return Optional.ofNullable(AddonSnapshots.player());
	}

	@Override
	public synchronized Scheduler scheduler() {
		if (addon.scheduler == null) {
			addon.scheduler = new AddonScheduler(addon);
			if (!addon.isActive() && addon.instance != null) addon.scheduler.shutdown();
		}
		return addon.scheduler;
	}

	@Override
	public Registration registerCommand(String name, String usage, String description, CommandHandler handler) {
		return AddonCommands.register(addon, name, usage, description, handler);
	}

	@Override
	public boolean sendChatMessage(String message) {
		AddonManager.requireUserAction(addon);
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null || mc.player.connection == null || message == null) return false;
		// § und Steuerzeichen würden vom Server mit einem Rauswurf beantwortet
		String text = StringUtil.filterText(message.replace('§', ' ')).strip();
		if (text.startsWith("/")) throw new IllegalArgumentException("Befehle (mit „/“) dürfen Addons nicht senden");
		text = StringUtil.trimChatMessage(text);
		if (!text.isEmpty() && Character.isHighSurrogate(text.charAt(text.length() - 1))) text = text.substring(0, text.length() - 1);
		text = text.strip();
		if (text.isEmpty()) return false;
		log.info("Sendet Chatnachricht an den Server: {}", text);
		mc.player.connection.sendChat(text);
		return true;
	}

	// --- API 4 ------------------------------------------------------------------------------

	@Override
	public DroppedItems droppedItems() {
		return droppedItems;
	}

	@Override
	public dev.heldixclient.api.Cosmetics cosmetics() {
		return cosmetics;
	}
}
