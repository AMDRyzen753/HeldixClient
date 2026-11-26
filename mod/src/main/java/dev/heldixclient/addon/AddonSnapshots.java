package dev.heldixclient.addon;

import dev.heldixclient.api.EffectInfo;
import dev.heldixclient.api.GameInfo;
import dev.heldixclient.api.ItemInfo;
import dev.heldixclient.api.PlayerState;
import dev.heldixclient.screen.HudEditorScreen;
import dev.heldixclient.screen.PauseMenuScreen;
import dev.heldixclient.screen.ServersScreen;
import dev.heldixclient.screen.ShellScreen;
import dev.heldixclient.screen.WorldsScreen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.DeathScreen;
import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.LevelLoadingScreen;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.ProgressScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.effect.MobEffectCategory;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.GameType;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Momentaufnahmen für {@link GameInfo} und {@link PlayerState} (API 3). Im Haupt-Thread wird höchstens einmal pro
 * Tick neu gelesen; andere Threads bekommen den letzten Stand, damit sie nie halb geänderte Spieldaten sehen.
 */
final class AddonSnapshots {
	private AddonSnapshots() {
	}

	private record Game(int fps, int ping, boolean inWorld, boolean singleplayer, boolean multiplayer, String serverAddress, long timeOfDay,
			String weather, boolean paused, boolean hudHidden, String screen) implements GameInfo {
	}

	private record Player(String name, String uuid, double x, double y, double z, float yaw, float pitch, String facing, double speed, float health,
			float maxHealth, float absorption, int food, float saturation, int armorPoints, int xpLevel, float xpProgress, String gameMode,
			boolean sprinting, boolean sneaking, boolean flying, boolean onGround, boolean inWater, String dimension, String biome,
			int selectedSlot, ItemInfo mainHand, ItemInfo offHand, List<ItemInfo> armorItems, List<EffectInfo> effects) implements PlayerState {
	}

	static final GameInfo NO_GAME = new Game(0, -1, false, false, false, "", -1, "", false, false, "");
	private static final EquipmentSlot[] ARMOR = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};

	private static volatile GameInfo game = NO_GAME;
	private static volatile PlayerState player;
	private static volatile long tick;
	private static long gameTick = -1;
	private static long playerTick = -1;
	/** zuletzt gefragt (Tick), auch aus anderen Threads */
	private static volatile long gameAsked = Long.MIN_VALUE / 2;
	private static volatile long playerAsked = Long.MIN_VALUE / 2;

	/**
	 * Jeden Client-Tick (Haupt-Thread): Momentaufnahmen gelten ab jetzt als veraltet. Wurde kürzlich danach gefragt,
	 * wird gleich neu gelesen – so sehen auch andere Threads den Stand dieses Ticks.
	 */
	static void tick() {
		tick++;
		Minecraft mc = Minecraft.getInstance();
		if (mc == null) return;
		if (tick - gameAsked < 100) refreshGame(mc);
		if (tick - playerAsked < 100) refreshPlayer(mc);
	}

	static GameInfo game() {
		gameAsked = tick;
		Minecraft mc = Minecraft.getInstance();
		if (mc != null && mc.isSameThread() && gameTick != tick) refreshGame(mc);
		return game;
	}

	static PlayerState player() {
		playerAsked = tick;
		Minecraft mc = Minecraft.getInstance();
		if (mc != null && mc.isSameThread() && playerTick != tick) refreshPlayer(mc);
		return player;
	}

	// Lesen darf nie den Tick des Spiels abbrechen (z. B. mitten im Laden einer Welt): dann bleibt der alte Stand
	private static void refreshGame(Minecraft mc) {
		gameTick = tick;
		try {
			game = readGame(mc);
		} catch (RuntimeException e) {
			dev.heldixclient.HeldixClient.LOGGER.debug("Heldix-Addons: Spieldaten nicht lesbar", e);
		}
	}

	private static void refreshPlayer(Minecraft mc) {
		playerTick = tick;
		try {
			player = readPlayer(mc);
		} catch (RuntimeException e) {
			dev.heldixclient.HeldixClient.LOGGER.debug("Heldix-Addons: Spielerdaten nicht lesbar", e);
		}
	}

	private static GameInfo readGame(Minecraft mc) {
		boolean inWorld = mc.level != null && mc.player != null;
		boolean singleplayer = inWorld && mc.isLocalServer();
		int ping = -1;
		ClientPacketListener connection = mc.getConnection();
		if (inWorld && connection != null) {
			net.minecraft.client.multiplayer.PlayerInfo info = connection.getPlayerInfo(mc.player.getUUID());
			if (info != null) ping = info.getLatency();
		}
		ServerData server = mc.getCurrentServer();
		String address = inWorld && !singleplayer && server != null ? server.ip : "";
		long time = inWorld ? Math.floorMod(mc.level.getDefaultClockTime(), 24000L) : -1;
		String weather = !inWorld ? "" : mc.level.isThundering() ? "thunder" : mc.level.isRaining() ? "rain" : "clear";
		return new Game(mc.getFps(), ping, inWorld, singleplayer, inWorld && !singleplayer, address, time, weather, mc.isPaused(),
				mc.gui.hud.isHidden(), screenKind(mc.gui.screen()));
	}

	private static PlayerState readPlayer(Minecraft mc) {
		LocalPlayer p = mc.player;
		if (p == null || mc.level == null) return null;
		float yaw = (float) Math.floorMod((long) Math.round(p.getYRot() * 100), 36000L) / 100f;
		String facing = switch (Math.round(yaw / 90f) % 4) {
			case 0 -> "south";
			case 1 -> "west";
			case 2 -> "north";
			default -> "east";
		};
		Vec3 motion = p.getDeltaMovement();
		double speed = Math.sqrt(motion.x * motion.x + motion.z * motion.z) * 20;
		GameType mode = mc.gameMode != null ? mc.gameMode.getPlayerMode() : GameType.SURVIVAL;
		String dimension = mc.level.dimension().identifier().getPath();
		String biome = mc.level.getBiome(p.blockPosition()).unwrapKey().map(k -> k.identifier().getPath()).orElse("");
		List<ItemInfo> armor = new ArrayList<>(4);
		for (EquipmentSlot slot : ARMOR) armor.add(item(p.getItemBySlot(slot)));
		List<EffectInfo> effects = new ArrayList<>();
		for (MobEffectInstance effect : p.getActiveEffects()) {
			String id = effect.getEffect().unwrapKey().map(k -> k.identifier().toString()).orElse("");
			effects.add(new EffectInfo(id, effect.getEffect().value().getDisplayName().getString(), effect.getAmplifier(),
					effect.isInfiniteDuration() ? -1 : effect.getDuration(), effect.getEffect().value().getCategory() == MobEffectCategory.HARMFUL));
		}
		return new Player(p.getName().getString(), p.getUUID().toString(), p.getX(), p.getY(), p.getZ(), yaw, p.getXRot(), facing, speed,
				p.getHealth(), p.getMaxHealth(), p.getAbsorptionAmount(), p.getFoodData().getFoodLevel(), p.getFoodData().getSaturationLevel(),
				p.getArmorValue(), p.experienceLevel, p.experienceProgress, mode.getSerializedName().toLowerCase(Locale.ROOT), p.isSprinting(),
				p.isShiftKeyDown(), p.getAbilities().flying, p.onGround(), p.isInWater(), dimension, biome, p.getInventory().getSelectedSlot(),
				item(p.getItemBySlot(EquipmentSlot.MAINHAND)), item(p.getItemBySlot(EquipmentSlot.OFFHAND)), List.copyOf(armor), List.copyOf(effects));
	}

	static ItemInfo item(ItemStack stack) {
		if (stack == null || stack.isEmpty()) return ItemInfo.EMPTY;
		String id = BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
		int max = stack.isDamageableItem() ? stack.getMaxDamage() : 0;
		return new ItemInfo(id, stack.getHoverName().getString(), stack.getCount(), max > 0 ? stack.getDamageValue() : 0, max);
	}

	/** Art eines Menüs für {@code onScreenOpen} und {@link GameInfo#screen()} ("" = kein Menü) */
	static String screenKind(Screen screen) {
		if (screen == null) return "";
		if (screen instanceof ChatScreen) return "chat";
		if (screen instanceof DeathScreen) return "death";
		if (screen instanceof PauseScreen || screen instanceof PauseMenuScreen) return "pause";
		if (screen instanceof InventoryScreen || screen instanceof CreativeModeInventoryScreen) return "inventory";
		if (screen instanceof AbstractContainerScreen<?>) return "container";
		if (screen instanceof TitleScreen) return "title";
		if (screen instanceof WorldsScreen) return "worlds";
		if (screen instanceof ServersScreen) return "servers";
		if (screen instanceof LevelLoadingScreen || screen instanceof ConnectScreen || screen instanceof ProgressScreen
				|| screen instanceof GenericMessageScreen) return "loading";
		if (screen instanceof ShellScreen || screen instanceof HudEditorScreen) return "heldix";
		String name = screen.getClass().getName();
		if (name.startsWith("net.minecraft.client.gui.screens.options.")) return "options";
		if (name.startsWith("net.minecraft.client.gui.screens.worldselection.")) return "worlds";
		if (name.startsWith("net.minecraft.client.gui.screens.multiplayer.")) return "servers";
		return "other";
	}
}
