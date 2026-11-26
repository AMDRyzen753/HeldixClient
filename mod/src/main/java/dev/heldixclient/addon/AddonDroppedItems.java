package dev.heldixclient.addon;

import dev.heldixclient.api.DroppedItem;
import dev.heldixclient.api.DroppedItemPose;
import dev.heldixclient.api.DroppedItemRenderer;
import dev.heldixclient.api.DroppedItems;
import dev.heldixclient.api.Registration;
import dev.heldixclient.transform.DroppedItemPoseHolder;
import dev.heldixclient.transform.DroppedItemPoseRenderer;
import it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap;
import net.minecraft.client.renderer.entity.ItemEntityRenderer;
import net.minecraft.client.renderer.entity.state.ItemEntityRenderState;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.Item;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.lang.ref.WeakReference;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Renderer der Addons für gedroppte Items (API 4, {@link DroppedItems}). Aufgerufen aus
 * {@link dev.heldixclient.transform.DroppedItemHooks#extract} im Haupt-Thread, einmal pro Item und Bild.
 *
 * <p>Es zeichnet nur der zuletzt angemeldete Renderer, dessen Addon noch aktiv ist. Fehler zählen wie alle Addon-Fehler
 * (nach drei wird das Addon abgeschaltet, dann übernimmt der vorige Renderer bzw. Minecraft).
 */
public final class AddonDroppedItems {
	/** Ab dieser Modelltiefe gilt ein Item als Block/3D (derselbe Wert wie in Minecraft 26.3) */
	private static final double FLAT_ITEM_DEPTH = 0.0625;
	/** Höhe höchstens so weit von der Position des Items weg (Blöcke) */
	private static final float MAX_LIFT = 2f;
	/** Winkel darüber werden auf 0 bis 360 Grad gebracht (Genauigkeit von float) */
	private static final float MAX_ANGLE = 3600f;
	private static final int MEMORY_SIZE = 8;
	/** Speicher entfernter Items alle so viele Ticks aufräumen */
	private static final int CLEANUP_TICKS = 40;

	private static final List<Renderer> RENDERERS = new CopyOnWriteArrayList<>();
	/** der zeichnende Renderer (null = Minecraft) */
	private static volatile Renderer current;
	private static volatile Boolean supported;

	/** Speicher je Item, nach Entity-ID (nur Haupt-Thread) */
	private static final Int2ObjectOpenHashMap<Memory> MEMORY = new Int2ObjectOpenHashMap<>();
	private static final View VIEW = new View();
	private static int ticks;

	private AddonDroppedItems() {
	}

	/** Die Schnittstelle, wie ein Addon sie sieht */
	static DroppedItems forAddon(LoadedAddon addon) {
		return new DroppedItems() {
			@Override
			public Registration addRenderer(DroppedItemRenderer renderer) {
				Objects.requireNonNull(renderer, "renderer");
				Renderer entry = new Renderer(addon, renderer);
				RENDERERS.add(entry);
				refresh();
				return entry;
			}

			@Override
			public boolean isSupported() {
				return supported();
			}
		};
	}

	/** Wurden Renderzustand und Renderer der Items verändert? (Klassen werden dafür nur geladen, nicht gestartet) */
	public static boolean supported() {
		Boolean result = supported;
		if (result == null) {
			result = DroppedItemPoseHolder.class.isAssignableFrom(ItemEntityRenderState.class)
					&& DroppedItemPoseRenderer.class.isAssignableFrom(ItemEntityRenderer.class);
			supported = result;
		}
		return result;
	}

	/** Addon, dessen Renderer gerade zeichnet (null = Minecraft); für den Autotest */
	public static String activeAddon() {
		Renderer renderer = current;
		return renderer != null && renderer.isActive() ? renderer.addon.id() : null;
	}

	/** Lage eines Items für dieses Bild, null = wie Minecraft. Nur im Haupt-Thread. */
	public static DroppedItemPose pose(ItemEntity entity, ItemEntityRenderState state, float partialTick) {
		Renderer renderer = current;
		if (renderer == null) return null;
		if (!renderer.isActive()) {
			renderer = refresh();
			if (renderer == null) return null;
		}
		if (state.item.isEmpty()) return null;
		VIEW.set(entity, state, memory(entity, renderer));
		DroppedItemPose pose;
		try {
			pose = renderer.renderer.pose(VIEW);
		} catch (Throwable t) {
			AddonManager.reportError(renderer.addon, "Item-Renderer", t);
			return null;
		}
		return sanitize(pose);
	}

	/**
	 * Werte prüfen: lift auf ±2 Blöcke begrenzen, große Winkel auf 0 bis 360 Grad bringen. Nicht endliche Teile bleiben
	 * stehen (die Hooks zeichnen diesen Teil dann wie Minecraft); ist gar nichts gültig, gilt Minecraft (null).
	 */
	static DroppedItemPose sanitize(DroppedItemPose pose) {
		if (pose == null) return null;
		boolean lift = pose.hasLift();
		boolean rotation = pose.hasRotation();
		if (!lift && !rotation) return null;
		boolean liftOk = !lift || Math.abs(pose.lift()) <= MAX_LIFT;
		boolean rotationOk = !rotation || (Math.abs(pose.yaw()) <= MAX_ANGLE && Math.abs(pose.pitch()) <= MAX_ANGLE && Math.abs(pose.roll()) <= MAX_ANGLE);
		if (liftOk && rotationOk) return pose;
		return new DroppedItemPose(lift ? Math.clamp(pose.lift(), -MAX_LIFT, MAX_LIFT) : DroppedItemPose.VANILLA,
				rotation ? wrap(pose.yaw()) : DroppedItemPose.VANILLA,
				rotation ? wrap(pose.pitch()) : DroppedItemPose.VANILLA,
				rotation ? wrap(pose.roll()) : DroppedItemPose.VANILLA);
	}

	private static float wrap(float angle) {
		float wrapped = angle % 360f;
		return wrapped < 0f ? wrapped + 360f : wrapped;
	}

	/** zuletzt angemeldeten, aktiven Renderer suchen */
	private static synchronized Renderer refresh() {
		Renderer found = null;
		for (int i = RENDERERS.size() - 1; i >= 0 && found == null; i--) {
			Renderer renderer = RENDERERS.get(i);
			if (renderer.isActive()) found = renderer;
		}
		current = found;
		return found;
	}

	private static Memory memory(ItemEntity entity, Renderer renderer) {
		int id = entity.getId();
		Memory memory = MEMORY.get(id);
		if (memory == null || memory.entity.get() != entity) {
			memory = new Memory(entity);
			MEMORY.put(id, memory);
		}
		if (memory.owner != renderer) {
			Arrays.fill(memory.values, 0f);
			memory.owner = renderer;
		}
		return memory;
	}

	/** Jeden Tick: ab und zu den Speicher entfernter Items freigeben */
	static void tick() {
		if (++ticks < CLEANUP_TICKS) return;
		ticks = 0;
		if (current == null) {
			MEMORY.clear();
			return;
		}
		MEMORY.values().removeIf(memory -> {
			ItemEntity entity = memory.entity.get();
			return entity == null || entity.isRemoved();
		});
	}

	/** Beim Verlassen der Welt: Speicher und letzte Werte loslassen */
	static void clear() {
		MEMORY.clear();
		VIEW.set(null, null, null);
	}

	/** Anzahl Items mit Speicher (für den Autotest) */
	public static int memorySize() {
		return MEMORY.size();
	}

	private static final class Renderer implements Registration {
		final LoadedAddon addon;
		final DroppedItemRenderer renderer;
		volatile boolean cancelled;

		Renderer(LoadedAddon addon, DroppedItemRenderer renderer) {
			this.addon = addon;
			this.renderer = renderer;
		}

		@Override
		public void cancel() {
			cancelled = true;
			RENDERERS.remove(this);
			refresh();
		}

		@Override
		public boolean isActive() {
			return !cancelled && addon.isActive();
		}
	}

	private static final class Memory {
		final WeakReference<ItemEntity> entity;
		final float[] values = new float[MEMORY_SIZE];
		Renderer owner;
		Item item;
		String itemId = "";

		Memory(ItemEntity entity) {
			this.entity = new WeakReference<>(entity);
		}
	}

	/** Das Item, wie der Renderer es sieht; ein Objekt für alle Items (Haupt-Thread) */
	private static final class View implements DroppedItem {
		private ItemEntity entity;
		private ItemEntityRenderState state;
		private Memory memory;
		private float minX, maxX, minY, maxY, minZ, maxZ;
		private boolean flat;

		void set(ItemEntity entity, ItemEntityRenderState state, Memory memory) {
			this.entity = entity;
			this.state = state;
			this.memory = memory;
			if (state != null) {
				AABB box = state.item.getModelBoundingBox();
				minX = (float) box.minX;
				maxX = (float) box.maxX;
				minY = (float) box.minY;
				maxY = (float) box.maxY;
				minZ = (float) box.minZ;
				maxZ = (float) box.maxZ;
				flat = box.getZsize() <= FLAT_ITEM_DEPTH;
			}
		}

		@Override
		public int entityId() {
			return entity.getId();
		}

		@Override
		public String itemId() {
			Item item = entity.getItem().getItem();
			if (memory.item != item) {
				memory.item = item;
				memory.itemId = BuiltInRegistries.ITEM.getKey(item).toString();
			}
			return memory.itemId;
		}

		@Override
		public int stackSize() {
			return entity.getItem().getCount();
		}

		@Override
		public int count() {
			return state.count;
		}

		@Override
		public float ageTicks() {
			return state.ageInTicks;
		}

		@Override
		public boolean onGround() {
			return entity.onGround();
		}

		@Override
		public boolean inWater() {
			return entity.isInWater();
		}

		@Override
		public double speed() {
			return entity.getDeltaMovement().length();
		}

		@Override
		public double verticalSpeed() {
			Vec3 motion = entity.getDeltaMovement();
			return motion.y;
		}

		@Override
		public boolean flat() {
			return flat;
		}

		@Override
		public float bobOffset() {
			return state.bobOffset;
		}

		@Override
		public float minX() {
			return minX;
		}

		@Override
		public float maxX() {
			return maxX;
		}

		@Override
		public float minY() {
			return minY;
		}

		@Override
		public float maxY() {
			return maxY;
		}

		@Override
		public float minZ() {
			return minZ;
		}

		@Override
		public float maxZ() {
			return maxZ;
		}

		@Override
		public float[] memory() {
			return memory.values;
		}
	}
}
