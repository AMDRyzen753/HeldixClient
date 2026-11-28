package dev.heldixclient.world;

import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.WorldMap;
import net.minecraft.client.Minecraft;
import net.minecraft.client.color.block.BlockTintSource;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.BiomeColors;
import net.minecraft.client.renderer.block.BlockStateModelSet;
import net.minecraft.client.renderer.block.dispatch.BlockStateModel;
import net.minecraft.client.renderer.block.dispatch.BlockStateModelPart;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import net.minecraft.client.resources.model.geometry.BakedQuad;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.tags.FluidTags;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.material.MapColor;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Oberfläche der Welt von oben für die Addon-API {@code worldMap()} (Minimaps, Karten): je Spalte die Farbe des obersten
 * sichtbaren Blocks, seine Höhe und die Wassertiefe. Farben wahlweise wie Minecraft-Karten ({@link MapColor}) oder aus
 * der Textur der Oberseite: Durchschnitt der Pixel (aus dem Ressourcenpaket gelesen, je Textur einmal) mal Biom-Färbung
 * für Gras, Laub und Wasser. Unter die Oberfläche geht es nur in Einzelspieler-Welten (Fair Play auf Servern).
 */
public final class WorldSampler implements WorldMap {
	public static final WorldSampler INSTANCE = new WorldSampler();

	/** so viele neue Texturen höchstens je Tick lesen (danach vorerst Kartenfarbe) */
	private static final int NEW_TEXTURES_PER_TICK = 24;
	/** so tief höchstens durch Glas, Luft und Wasser bzw. unter topY suchen */
	private static final int MAX_SCAN = 48;
	private static final int VOID_COLOR = 0xFF0B0D12;
	private static final Identifier WATER = Identifier.withDefaultNamespace("block/water_still");
	private static final Identifier LAVA = Identifier.withDefaultNamespace("block/lava_still");

	/** Oberseite eines Blockzustands: Farbe der Textur (deckend) und Index der Färbung (-1 = keine) */
	private record TopFace(int color, int tintIndex) {
	}

	private final Map<BlockState, TopFace> faces = new IdentityHashMap<>();
	private final Map<Identifier, Integer> sprites = new HashMap<>();
	private final BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
	private Object modelSet;
	private long budgetTick = -1;
	private int budget;

	private WorldSampler() {
	}

	private static ClientLevel level() {
		return Minecraft.getInstance().level;
	}

	@Override
	public boolean available() {
		return level() != null && !mapsBlocked();
	}

	/** Server (Plugin „HeldixClient Server“) hat Minimap und Weltkarte abgeschaltet: keine Welt von oben für Addons */
	private static boolean mapsBlocked() {
		return !dev.heldixclient.serverlink.ServerRules.allowed("minimap") && !dev.heldixclient.serverlink.ServerRules.allowed("worldmap");
	}

	@Override
	public String dimension() {
		ClientLevel level = level();
		return level == null ? "" : level.dimension().identifier().toString();
	}

	@Override
	public View view() {
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null || mc.player == null) return null;
		float partial = mc.getDeltaTracker().getGameTimeDeltaPartialTick(true);
		var position = mc.player.getPosition(partial);
		float yaw = (float) Math.floorMod((long) Math.round(mc.player.getViewYRot(partial) * 100), 36000L) / 100f;
		return new View(position.x, position.y, position.z, yaw);
	}

	@Override
	public boolean hasCeiling() {
		ClientLevel level = level();
		return level != null && level.dimensionType().hasCeiling();
	}

	@Override
	public int minY() {
		ClientLevel level = level();
		return level == null ? 0 : level.getMinY();
	}

	@Override
	public int maxY() {
		ClientLevel level = level();
		return level == null ? 0 : level.getMaxY();
	}

	@Override
	public int surfaceY(int x, int z) {
		ClientLevel level = level();
		if (level == null) return Integer.MIN_VALUE;
		LevelChunk chunk = level.getChunkSource().getChunkNow(x >> 4, z >> 4);
		return chunk == null ? Integer.MIN_VALUE : chunk.getHeight(Heightmap.Types.WORLD_SURFACE, x & 15, z & 15);
	}

	@Override
	public boolean undergroundAllowed() {
		Minecraft mc = Minecraft.getInstance();
		return mc.level != null && mc.isLocalServer();
	}

	@Override
	public int sampleSurface(int minX, int minZ, int width, int depth, Colors mode, int[] colors, int[] heights, int[] waterDepths) {
		if (mapsBlocked()) {
			check(width, depth, colors, heights, waterDepths);
			java.util.Arrays.fill(colors, 0, width * depth, 0);
			return 0;
		}
		return sample(minX, minZ, width, depth, Integer.MAX_VALUE, mode, colors, heights, waterDepths);
	}

	@Override
	public int sampleBelow(int minX, int minZ, int width, int depth, int topY, Colors mode, int[] colors, int[] heights, int[] waterDepths) {
		if (!undergroundAllowed() || mapsBlocked()) {
			check(width, depth, colors, heights, waterDepths);
			java.util.Arrays.fill(colors, 0, width * depth, 0);
			return 0;
		}
		return sample(minX, minZ, width, depth, topY, mode, colors, heights, waterDepths);
	}

	private static void check(int width, int depth, int[] colors, int[] heights, int[] waterDepths) {
		if (width <= 0 || depth <= 0 || width > 4096 || depth > 4096) throw new IllegalArgumentException("width/depth: 1 bis 4096");
		int size = width * depth;
		if (colors == null || colors.length < size) throw new IllegalArgumentException("colors ist zu klein");
		if (heights != null && heights.length < size) throw new IllegalArgumentException("heights ist zu klein");
		if (waterDepths != null && waterDepths.length < size) throw new IllegalArgumentException("waterDepths ist zu klein");
	}

	/** topY = Integer.MAX_VALUE: Oberfläche; sonst der oberste nicht leere Block ab topY abwärts */
	private int sample(int minX, int minZ, int width, int depth, int topY, Colors mode, int[] colors, int[] heights, int[] waterDepths) {
		check(width, depth, colors, heights, waterDepths);
		Minecraft mc = Minecraft.getInstance();
		if (!mc.isSameThread()) throw new IllegalStateException("worldMap() nur im Haupt-Thread aufrufen");
		ClientLevel level = mc.level;
		if (level == null) {
			java.util.Arrays.fill(colors, 0, width * depth, 0);
			return 0;
		}
		refreshCaches(mc, level);
		int bottom = level.getMinY();
		int loaded = 0;
		LevelChunk chunk = null;
		int chunkX = Integer.MIN_VALUE;
		int chunkZ = Integer.MIN_VALUE;
		for (int dz = 0; dz < depth; dz++) {
			int z = minZ + dz;
			for (int dx = 0; dx < width; dx++) {
				int x = minX + dx;
				int index = dz * width + dx;
				if (x >> 4 != chunkX || z >> 4 != chunkZ) {
					chunkX = x >> 4;
					chunkZ = z >> 4;
					chunk = level.getChunkSource().getChunkNow(chunkX, chunkZ);
				}
				if (chunk == null) {
					colors[index] = 0;
					if (heights != null) heights[index] = Integer.MIN_VALUE;
					if (waterDepths != null) waterDepths[index] = 0;
					continue;
				}
				// getHeight liefert schon die Höhe des obersten Blocks (Heightmap minus 1)
				int surface = chunk.getHeight(Heightmap.Types.WORLD_SURFACE, x & 15, z & 15);
				int y = Math.min(surface, topY);
				boolean below = topY != Integer.MAX_VALUE;
				int stop = Math.max(bottom, y - MAX_SCAN);
				BlockState state = null;
				// Luft, Glas und Ähnliches (keine Kartenfarbe) überspringen
				for (; y >= stop; y--) {
					state = chunk.getBlockState(pos.set(x, y, z));
					if (!state.isAir() && state.getMapColor(level, pos) != MapColor.NONE) break;
				}
				if (y < stop || state == null) {
					// Leere (Ende) oder unter topY nichts gefunden
					if (below) {
						colors[index] = 0;
						if (heights != null) heights[index] = Integer.MIN_VALUE;
						if (waterDepths != null) waterDepths[index] = 0;
						continue;
					}
					colors[index] = VOID_COLOR;
					if (heights != null) heights[index] = bottom;
					if (waterDepths != null) waterDepths[index] = 0;
					loaded++;
					continue;
				}
				int top = y;
				int water = 0;
				if (state.getFluidState().is(FluidTags.WATER)) {
					// Wassertiefe bis zum Grund (wie bei Karten)
					while (y - 1 >= stop && chunk.getBlockState(pos.set(x, y - 1, z)).getFluidState().is(FluidTags.WATER)) y--;
					water = top - y + 1;
					pos.set(x, top, z);
					colors[index] = mode == Colors.MAP ? 0xFF000000 | MapColor.WATER.col : waterColor(mc, level, pos);
				} else {
					pos.set(x, top, z);
					colors[index] = mode == Colors.MAP ? 0xFF000000 | state.getMapColor(level, pos).col : textureColor(mc, level, state, pos);
				}
				if (heights != null) heights[index] = top;
				if (waterDepths != null) waterDepths[index] = water;
				loaded++;
			}
		}
		return loaded;
	}

	// ======================================================================================
	// Farben aus Texturen
	// ======================================================================================

	/** Ressourcen neu geladen (anderes Ressourcenpaket): alle Farben neu bestimmen; Budget je Tick zurücksetzen */
	private void refreshCaches(Minecraft mc, ClientLevel level) {
		BlockStateModelSet set = mc.getModelManager().getBlockStateModelSet();
		if (set != modelSet) {
			modelSet = set;
			faces.clear();
			sprites.clear();
		}
		long tick = level.getGameTime();
		if (tick != budgetTick) {
			budgetTick = tick;
			budget = NEW_TEXTURES_PER_TICK;
		}
	}

	private int waterColor(Minecraft mc, ClientLevel level, BlockPos at) {
		Integer base = sprite(mc, WATER);
		if (base == null) return 0xFF000000 | MapColor.WATER.col;
		return 0xFF000000 | multiply(base, level.getBlockTint(at, BiomeColors.WATER_COLOR_RESOLVER));
	}

	private int textureColor(Minecraft mc, ClientLevel level, BlockState state, BlockPos at) {
		TopFace face = faces.get(state);
		if (face == null) {
			face = topFace(mc, state);
			if (face == null) return 0xFF000000 | state.getMapColor(level, at).col;
			faces.put(state, face);
		}
		if (face.tintIndex() < 0) return face.color();
		BlockTintSource source = mc.getBlockColors().getTintSource(state, face.tintIndex());
		if (source == null) return face.color();
		return 0xFF000000 | multiply(face.color(), source.colorInWorld(state, level, at));
	}

	/** Textur und Färbung der Oberseite (sonst der ersten Fläche ohne Richtung, z. B. bei Pflanzen); null = später nochmal */
	private TopFace topFace(Minecraft mc, BlockState state) {
		if (state.getFluidState().is(FluidTags.LAVA)) {
			Integer lava = sprite(mc, LAVA);
			return lava == null ? null : new TopFace(lava, -1);
		}
		BlockStateModel model = mc.getModelManager().getBlockStateModelSet().get(state);
		if (model == null) return null;
		List<BlockStateModelPart> parts = new ArrayList<>();
		model.collectParts(RandomSource.create(42L), parts);
		BakedQuad quad = null;
		for (BlockStateModelPart part : parts) {
			List<BakedQuad> up = part.getQuads(Direction.UP);
			if (!up.isEmpty()) {
				quad = up.getFirst();
				break;
			}
		}
		if (quad == null) {
			for (BlockStateModelPart part : parts) {
				List<BakedQuad> loose = part.getQuads(null);
				if (!loose.isEmpty()) {
					quad = loose.getFirst();
					break;
				}
			}
		}
		TextureAtlasSprite sprite = quad != null ? quad.materialInfo().sprite() : model.particleMaterial().sprite();
		Integer color = sprite(mc, sprite.contents().name());
		if (color == null) return null;
		int tint = quad != null && quad.materialInfo().isTinted() ? quad.materialInfo().tintIndex() : -1;
		return new TopFace(color, tint);
	}

	/** Durchschnittsfarbe einer Textur (deckende Pixel), einmal je Textur gelesen; null = Budget aufgebraucht */
	private Integer sprite(Minecraft mc, Identifier name) {
		Integer cached = sprites.get(name);
		if (cached != null) return cached;
		if (budget <= 0) return null;
		budget--;
		int color = 0xFF808080;
		Identifier file = Identifier.fromNamespaceAndPath(name.getNamespace(), "textures/" + name.getPath() + ".png");
		Optional<Resource> resource = mc.getResourceManager().getResource(file);
		if (resource.isPresent()) {
			try (InputStream in = resource.get().open(); NativeImage image = NativeImage.read(in)) {
				color = average(image);
			} catch (Exception e) {
				HeldixClient.LOGGER.debug("Karte: Textur {} nicht lesbar", file, e);
			}
		}
		sprites.put(name, color);
		return color;
	}

	private static int average(NativeImage image) {
		long r = 0, g = 0, b = 0, weight = 0;
		int w = image.getWidth();
		int h = image.getHeight();
		int stepX = Math.max(1, w / 64);
		int stepY = Math.max(1, h / 64);
		for (int y = 0; y < h; y += stepY) {
			for (int x = 0; x < w; x += stepX) {
				int argb = image.getPixel(x, y);
				int alpha = argb >>> 24;
				if (alpha < 16) continue;
				r += (long) ((argb >> 16) & 0xFF) * alpha;
				g += (long) ((argb >> 8) & 0xFF) * alpha;
				b += (long) (argb & 0xFF) * alpha;
				weight += alpha;
			}
		}
		if (weight == 0) return 0xFF808080;
		return 0xFF000000 | (int) (r / weight) << 16 | (int) (g / weight) << 8 | (int) (b / weight);
	}

	private static int multiply(int rgb, int tint) {
		int r = ((rgb >> 16) & 0xFF) * ((tint >> 16) & 0xFF) / 255;
		int g = ((rgb >> 8) & 0xFF) * ((tint >> 8) & 0xFF) / 255;
		int b = (rgb & 0xFF) * (tint & 0xFF) / 255;
		return r << 16 | g << 8 | b;
	}
}
