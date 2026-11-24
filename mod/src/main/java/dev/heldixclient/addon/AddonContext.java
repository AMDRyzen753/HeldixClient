package dev.heldixclient.addon;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.api.AddonConfig;
import dev.heldixclient.api.AddonInfo;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixEvents;
import dev.heldixclient.api.HeldixLogger;
import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.api.PlayerInfo;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.ui.Theme;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.TextColor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;

/** Die HeldixApi, wie sie ein einzelnes Addon sieht. */
final class AddonContext implements HeldixApi {
	private final LoadedAddon addon;
	private final AddonInfo info;
	private final Logger log;
	private final HeldixLogger logger;
	private final HeldixEvents events;
	private AddonConfigImpl config;

	AddonContext(LoadedAddon addon) {
		this.addon = addon;
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
}
