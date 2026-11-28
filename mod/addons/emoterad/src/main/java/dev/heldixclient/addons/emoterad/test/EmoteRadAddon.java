package dev.heldixclient.addons.emoterad.test;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixLogger;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.model.geom.EntityModelSet;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.MapRenderer;
import net.minecraft.client.renderer.PlayerSkinRenderCache;
import net.minecraft.client.renderer.block.BlockModelResolver;
import net.minecraft.client.renderer.entity.EntityRenderDispatcher;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.player.AvatarRenderer;
import net.minecraft.client.renderer.item.ItemModelResolver;
import net.minecraft.client.resources.model.EquipmentAssetManager;
import net.minecraft.client.resources.model.sprite.AtlasManager;
import net.minecraft.client.resources.palette.PalettedTextureManager;
import net.minecraft.world.entity.player.PlayerModelType;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Emote-Rad als Test-Fassung für die Heldix-API 2 (bis 0.11.0 Teil des Krallen-Addons): Rad mit Sitzen, Winken,
 * Verbeugen und „Krallen zeigen“, Taste frei belegbar (Standard J), nur optisch und nur lokal sichtbar. Dafür ersetzt
 * es die Spieler-Renderer durch {@link EmoteAvatarRenderer}, die ohne Emote genau wie Minecraft zeichnen. Andere
 * Addons mit eigener Ebene am Spieler (Krallen, Cyber-Flügel) hängen sich danach beim nächsten Tick wieder ein. Das
 * laufende Emote meldet es über {@link EmoteChannel}. Baut Minecraft die Renderer neu, setzt es sie beim nächsten Tick
 * wieder ein. Modul „Emote-Rad“ ab Werk an; aus = Taste ohne Wirkung, laufendes Emote endet und Minecrafts eigene
 * Spieler-Renderer kommen zurück.
 */
public final class EmoteRadAddon implements HeldixAddon {
	/** Name der Taste in der Steuerung (so legt die Heldix-API ihn an: Addon-Name – Tastenname) */
	static final String WHEEL_KEY = "Emote-Rad – Emote-Rad";

	private final Emotes emotes = new Emotes();
	private ModuleHandle module;
	private HeldixLogger log;
	private boolean failed;
	/** Minecrafts eigene Spieler-Renderer vor dem Ersetzen (zum Zurücksetzen, wenn das Modul aus ist) */
	private Map<PlayerModelType, AvatarRenderer<AbstractClientPlayer>> originals;
	private Map<PlayerModelType, AvatarRenderer<AbstractClientPlayer>> installed;

	@Override
	public void onEnable(HeldixApi api) {
		log = api.logger();
		module = api.registerModule(ModuleSpec.of("emoterad", "Emote-Rad", "Emotes per Rad: Sitzen, Winken, Verbeugen, Krallen zeigen"));
		api.registerKey("emote-rad", "Emote-Rad", 'J', this::openWheel);
		api.events().onTick(() -> {
			if (module.isEnabled()) {
				install();
			} else {
				emotes.stop();
				if (originals != null) EmoteChannel.clear();
				uninstall();
			}
			emotes.tick();
		});
		api.events().onWorldLeave(() -> {
			emotes.stop();
			EmoteChannel.clear();
		});
	}

	@Override
	public void onDisable() {
		emotes.stop();
		EmoteChannel.clear();
		uninstall();
	}

	/** Modul aus oder Addon abgeschaltet: Minecrafts eigene Spieler-Renderer wieder einsetzen (nur, wenn noch unsere drin sind) */
	private void uninstall() {
		if (originals == null) return;
		try {
			EntityRenderDispatcher dispatcher = Minecraft.getInstance().getEntityRenderDispatcher();
			if (dispatcher != null && get(dispatcher, "playerRenderers") == installed) set(dispatcher, "playerRenderers", originals);
		} catch (Throwable t) {
			log.warn("Emote-Rad: Spieler-Renderer nicht zurückgesetzt (" + t + ")");
		}
		originals = null;
		installed = null;
	}

	/** Taste gedrückt (nur im Spiel): Emote-Rad öffnen */
	private void openWheel() {
		if (failed || !module.isEnabled()) return;
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null || mc.gui.screen() != null) return;
		mc.gui.setScreen(new EmoteWheelScreen(emotes, KeyMapping.get(WHEEL_KEY)));
	}

	/** Spieler-Renderer mit Emotes einsetzen, falls Minecraft sie (neu) gebaut hat */
	private void install() {
		if (failed) return;
		Minecraft mc = Minecraft.getInstance();
		EntityRenderDispatcher dispatcher = mc != null ? mc.getEntityRenderDispatcher() : null;
		if (dispatcher == null) return;
		try {
			installEmoteRenderers(mc, dispatcher);
		} catch (Throwable t) {
			failed = true;
			emotes.stop();
			EmoteChannel.clear();
			log.error("Emote-Rad: Emotes nicht möglich – Spieler-Renderer bleiben wie in Minecraft", t);
		}
	}

	private void installEmoteRenderers(Minecraft mc, EntityRenderDispatcher dispatcher) throws ReflectiveOperationException {
		Map<PlayerModelType, AvatarRenderer<AbstractClientPlayer>> players = get(dispatcher, "playerRenderers");
		if (players.isEmpty()) return;
		boolean done = true;
		for (AvatarRenderer<AbstractClientPlayer> renderer : players.values()) done &= renderer instanceof EmoteAvatarRenderer;
		if (done) return;
		Supplier<EntityModelSet> models = get(dispatcher, "entityModels");
		EntityRendererProvider.Context context = new EntityRendererProvider.Context(dispatcher,
				get(dispatcher, "blockModelResolver", BlockModelResolver.class), get(dispatcher, "itemModelResolver", ItemModelResolver.class),
				get(dispatcher, "mapRenderer", MapRenderer.class), mc.getResourceManager(), models.get(),
				get(dispatcher, "equipmentAssets", EquipmentAssetManager.class), get(dispatcher, "atlasManager", AtlasManager.class),
				get(dispatcher, "font", Font.class), get(dispatcher, "playerSkinRenderCache", PlayerSkinRenderCache.class),
				get(dispatcher, "palettedTextures", PalettedTextureManager.class));
		Map<PlayerModelType, AvatarRenderer<AbstractClientPlayer>> copy = new HashMap<>(players);
		for (PlayerModelType type : players.keySet()) {
			copy.put(type, new EmoteAvatarRenderer(context, type == PlayerModelType.SLIM, emotes, log));
		}
		originals = players;
		installed = copy;
		set(dispatcher, "playerRenderers", copy);
		log.info("Emote-Rad: Spieler-Renderer mit Emotes eingesetzt");
	}

	@SuppressWarnings("unchecked")
	static <T> T get(Object owner, String name) throws ReflectiveOperationException {
		return (T) field(owner.getClass(), name).get(owner);
	}

	static <T> T get(Object owner, String name, Class<T> type) throws ReflectiveOperationException {
		return type.cast(field(owner.getClass(), name).get(owner));
	}

	static void set(Object owner, String name, Object value) throws ReflectiveOperationException {
		field(owner.getClass(), name).set(owner, value);
	}

	static Field field(Class<?> type, String name) throws NoSuchFieldException {
		for (Class<?> c = type; c != null; c = c.getSuperclass()) {
			try {
				Field f = c.getDeclaredField(name);
				f.setAccessible(true);
				return f;
			} catch (NoSuchFieldException ignored) {
				// in der Oberklasse weitersuchen
			}
		}
		throw new NoSuchFieldException(type.getName() + "." + name);
	}
}
