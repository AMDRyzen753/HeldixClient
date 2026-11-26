package dev.heldixclient.autotest;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import dev.heldixclient.addon.AddonDroppedItems;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.addon.AddonMetadata;
import dev.heldixclient.addon.LoadedAddon;
import dev.heldixclient.api.DroppedItem;
import dev.heldixclient.api.DroppedItemPose;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.Registration;
import dev.heldixclient.module.Module;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.module.Setting;
import dev.heldixclient.transform.DroppedItemHooks;
import dev.heldixclient.transform.DroppedItemPoseHolder;
import dev.heldixclient.transform.DroppedItemPoseRenderer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.entity.ItemEntityRenderer;
import net.minecraft.client.renderer.entity.state.ItemEntityRenderState;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.ItemEntity;
import org.joml.Matrix4f;
import org.joml.Vector3f;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Autotest der Heldix-API 4 (gedroppte Items) und des Item-Physics-Addons im echten Spiel: Patches an
 * {@code ItemEntityRenderer}/{@code ItemEntityRenderState}, Anmelden und Abmelden von Renderern („zuletzt angemeldet
 * gewinnt“), null = Minecraft, Prüfung der Werte, Fehler eines Renderers bleiben bei seinem Addon – und Item Physics
 * selbst: Items am Boden liegen nach kurzer Zeit flach und still, in der Luft überschlagen sie sich.
 */
final class DroppedItemTests {
	private static final String PHYSICS = "itemphysics";
	/** unendlich lange liegen lassen und nicht aufsammeln */
	private static final String KEEP = "PickupDelay:32767,Age:-32768,Motion:[0.0d,0.0d,0.0d]";

	private DroppedItemTests() {
	}

	static void run(TestContext t) {
		t.setScreen(() -> null);
		LoadedAddon physics = t.compute(mc -> AddonManager.addons().stream().filter(a -> PHYSICS.equals(a.id()) && a.isActive()).findFirst().orElse(null));
		t.check("Item-Physics-Addon aktiv (API 4)", physics != null && physics.api() != null);
		HeldixApi api = physics.api();
		Module module = t.compute(mc -> ModuleManager.all().stream().filter(m -> m.id().equals("itemphysics:itemphysics")).findFirst().orElse(null));
		t.check("Modul „Item Physics“ an", module != null && t.compute(mc -> module.isEnabled()));
		t.check("API 4: droppedItems().isSupported()", api.droppedItems().isSupported());
		t.check("Renderzustand und Renderer der Items sind verändert", DroppedItemPoseHolder.class.isAssignableFrom(ItemEntityRenderState.class)
				&& DroppedItemPoseRenderer.class.isAssignableFrom(ItemEntityRenderer.class));
		t.check("Item Physics zeichnet die Items (" + AddonDroppedItems.activeAddon() + ")", PHYSICS.equals(AddonDroppedItems.activeAddon()));
		t.check("Item Physics: Einstellungen im Untermenü", t.compute(mc -> module.settings().stream().map(Setting::label).toList())
				.containsAll(java.util.List.of("Drehung in der Luft", "Hinlegen", "Blöcke kippen")));
		String key = t.compute(mc -> Arrays.stream(mc.options.keyMappings).filter(k -> k.getName().equals("Item Physics – Ein/Aus"))
				.map(k -> k.isUnbound() ? "frei" : k.saveString()).findFirst().orElse("-"));
		t.check("Taste „Item Physics – Ein/Aus“ vorhanden und ab Werk frei (" + key + ")", "frei".equals(key));
		int physicsErrors = t.compute(mc -> physics.errorCount());

		// --- Szene: Items vor dem Spieler, Blick schräg nach unten (Süden) ------------------------
		boolean hudWasHidden = t.compute(mc -> mc.gui.hud.isHidden());
		t.run(mc -> {
			if (!mc.gui.hud.isHidden()) mc.gui.hud.toggle();
		});
		t.serverCommand("kill @e[type=minecraft:item]");
		t.serverCommand("time set 1000");
		t.serverCommand("tp @p 0.5 -60 0.5 0 38");
		summon(t, "diamond", 1, -0.6, 2.4);
		summon(t, "iron_sword", 1, 0.5, 2.0);
		summon(t, "stone", 1, 1.4, 2.6);
		summon(t, "diamond", 5, -0.2, 3.3);
		summon(t, "grass_block", 1, 0.6, 3.4);
		summon(t, "oak_log", 20, 1.6, 3.6);
		summon(t, "gold_ingot", 1, -1.4, 3.0);
		t.waitTicks(50);
		t.check("Items liegen in der Welt", t.compute(mc -> items(mc).size()) >= 7);

		// gleich nach dem Landen und eine halbe Sekunde später: flach bzw. auf einer Seite, still, gleiche Ausrichtung
		Map<String, DroppedItemPose> first = samples(t);
		long applied = DroppedItemHooks.applied();
		t.waitTicks(10);
		Map<String, DroppedItemPose> later = samples(t);
		t.log("Lagen am Boden " + first);
		for (String name : new String[] {"diamond", "iron_sword", "gold_ingot", "diamond×5"}) {
			DroppedItemPose pose = first.get(name);
			t.check("Item Physics: " + name + " liegt flach (" + pose + ")", pose != null && near(pose.pitch() % 180f, 90f, 0.01f)
					&& pose.lift() > 0.01f && pose.lift() < 0.2f);
		}
		for (String name : new String[] {"stone", "grass_block", "oak_log×20"}) {
			DroppedItemPose pose = first.get(name);
			t.check("Item Physics: " + name + " liegt auf einer Seite (" + pose + ")", pose != null && near(pose.pitch() % 90f, 0f, 0.01f)
					&& pose.lift() > -0.3f && pose.lift() < 0.6f);
		}
		// Einzelne Items: die tiefste Ecke des gedrehten Modells liegt knapp (0,005) über dem Boden
		for (String name : new String[] {"diamond", "iron_sword", "gold_ingot", "stone", "grass_block"}) {
			float bottom = t.compute(mc -> bottom(mc, name));
			t.check("Item Physics: " + name + " liegt auf dem Boden auf (Unterkante " + bottom + ")", near(bottom, 0.005f, 0.002f));
		}
		boolean still = first.keySet().stream().allMatch(name -> later.get(name) != null && near(first.get(name).lift(), later.get(name).lift(), 1e-4f)
				&& near(first.get(name).pitch(), later.get(name).pitch(), 1e-3f) && near(first.get(name).yaw(), later.get(name).yaw(), 1e-3f));
		t.check("Item Physics: Items liegen still (keine Bewegung in 10 Ticks)", still);
		t.check("submit wendet die Lagen in echten Bildern an (" + (DroppedItemHooks.applied() - applied) + "×)", DroppedItemHooks.applied() > applied);
		t.screenshot("itemphysics-01-am-boden");

		// Zum Vergleich Minecraft: Modul aus → Renderer gibt null zurück, Items schweben und drehen sich
		t.run(mc -> module.setEnabled(false));
		t.waitTicks(3);
		t.check("Modul aus: Items wie in Minecraft (keine Lage)", samples(t).values().stream().allMatch(pose -> pose == null));
		t.screenshot("itemphysics-02-vanilla");
		t.run(mc -> module.setEnabled(true));

		// In der Luft (ohne Schwerkraft auf Augenhöhe): überschlägt sich, je Tick mindestens 8°
		summon(t, "emerald", 1, -0.4, 1.8, -59.3, "NoGravity:1b,");
		t.waitTicks(5);
		DroppedItemPose air1 = samples(t).get("emerald");
		t.waitTicks(10);
		DroppedItemPose air2 = samples(t).get("emerald");
		float turned = air1 == null || air2 == null ? 0f : ((air2.pitch() - air1.pitch()) % 360f + 360f) % 360f;
		t.log("In der Luft: " + air1 + " → " + air2 + " (" + turned + "°)");
		t.check("Item Physics: in der Luft dreht sich das Item (" + turned + "° in 10 Ticks)", turned > 30f);
		t.check("Item Physics: in der Luft nicht auf dem Boden", t.compute(mc -> find(mc, "emerald").map(e -> !e.onGround()).orElse(false)));
		t.screenshot("itemphysics-03-in-der-luft");
		// nur das schwebende Item (die anderen liegen tiefer)
		t.serverCommand("kill @e[type=minecraft:item,x=-5,y=-59.5,z=-5,dx=10,dy=4,dz=10]");
		t.waitTicks(3);
		t.check("Schwebendes Item entfernt, die anderen liegen noch", t.compute(mc -> find(mc, "emerald").isEmpty() && items(mc).size() >= 7));

		api(t);

		t.check("Item Physics ohne Fehler (" + t.compute(mc -> physics.errorCount()) + ")", t.compute(mc -> physics.errorCount()) == physicsErrors && physics.isActive());
		t.serverCommand("kill @e[type=minecraft:item]");
		t.run(mc -> {
			if (mc.gui.hud.isHidden() != hudWasHidden) mc.gui.hud.toggle();
		});
	}

	// ======================================================================================
	// API 4 mit einem Test-Addon: Anmelden, zuletzt gewinnt, null, ungültige Werte, Fehler, Abmelden
	// ======================================================================================

	private static void api(TestContext t) {
		LoadedAddon fake = t.compute(mc -> fakeAddon("autotest-renderer"));
		HeldixApi api = fake.api();
		Map<String, Object> seen = new ConcurrentHashMap<>();
		AtomicInteger calls = new AtomicInteger();

		Registration fixed = api.droppedItems().addRenderer(item -> {
			calls.incrementAndGet();
			if (item.itemId().equals("minecraft:diamond") && item.stackSize() == 5) remember(seen, item);
			return DroppedItemPose.of(0.5f, 45f, 90f);
		});
		t.check("Renderer angemeldet: zuletzt angemeldeter zeichnet (" + AddonDroppedItems.activeAddon() + ")",
				"autotest-renderer".equals(AddonDroppedItems.activeAddon()) && fixed.isActive());
		ItemEntityRenderState state = t.compute(mc -> state(mc, "diamond×5"));
		DroppedItemPose pose = ((DroppedItemPoseHolder) state).heldix$droppedItemPose();
		t.check("Lage liegt am Renderzustand (" + pose + ")", DroppedItemPose.of(0.5f, 45f, 90f).equals(pose));
		t.log("DroppedItem " + seen);
		t.check("DroppedItem: Art, Stapel, Modelle, flach, am Boden", "minecraft:diamond".equals(seen.get("itemId")) && Integer.valueOf(5).equals(seen.get("stackSize"))
				&& Integer.valueOf(2).equals(seen.get("count")) && Boolean.TRUE.equals(seen.get("flat")) && Boolean.TRUE.equals(seen.get("onGround"))
				&& Boolean.FALSE.equals(seen.get("inWater")));
		t.check("DroppedItem: Alter, Zufallswert, Modell-Box, Entity-ID", (float) seen.get("ageTicks") > 40f && (float) seen.get("bobOffset") >= 0f
				&& (float) seen.get("bobOffset") <= 6.2832f && (float) seen.get("minY") < 0f && (float) seen.get("maxY") > 0f
				&& (float) seen.get("maxZ") - (float) seen.get("minZ") <= 0.0625f + 1e-6f
				&& seen.get("entityId").equals(t.compute(mc -> find(mc, "diamond×5").map(Entity::getId).orElse(-1))));

		// Hooks in submit: Höhe statt Schweben, Drehung Y-X statt Minecrafts Drehung
		PoseStack moved = new PoseStack();
		DroppedItemHooks.translate(moved, 0f, 0.3f, 0f, state);
		Vector3f translation = moved.last().pose().getTranslation(new Vector3f());
		t.check("translate-Hook hebt um lift (" + translation.y + ")", near(translation.y, 0.5f, 1e-5f) && near(translation.x, 0f, 1e-6f));
		PoseStack turned = new PoseStack();
		DroppedItemHooks.rotate(turned, Axis.YP, 1.0f, state);
		PoseStack expected = new PoseStack();
		expected.rotateDegrees(Axis.YP, 45f);
		expected.rotateDegrees(Axis.XP, 90f);
		t.check("rotate-Hook dreht um yaw und pitch", turned.last().pose().equals(expected.last().pose(), 1e-5f));
		long applied = DroppedItemHooks.applied();
		t.waitTicks(5);
		t.check("Renderer wird in echten Bildern aufgerufen (" + calls.get() + "×) und angewendet", calls.get() > 7 && DroppedItemHooks.applied() > applied);

		// Speicher je Item bleibt über Bilder erhalten
		AtomicInteger memoryValue = new AtomicInteger();
		Registration counting = api.droppedItems().addRenderer(item -> {
			item.memory()[3]++;
			if (item.itemId().equals("minecraft:stone")) memoryValue.set((int) item.memory()[3]);
			return null;
		});
		t.waitTicks(1);
		int memory1 = t.compute(mc -> {
			state(mc, "stone");
			return memoryValue.get();
		});
		t.waitTicks(5);
		int memory2 = t.compute(mc -> {
			state(mc, "stone");
			return memoryValue.get();
		});
		t.check("memory(): bleibt je Item erhalten (" + memory1 + " → " + memory2 + ", " + AddonDroppedItems.memorySize() + " Items)",
				memory1 >= 1 && memory2 > memory1 && AddonDroppedItems.memorySize() >= 7);

		// null = Minecraft: kein Feld gesetzt, Hooks rufen die Originalmethoden mit den Originalwerten auf
		ItemEntityRenderState vanilla = t.compute(mc -> state(mc, "diamond×5"));
		t.check("Renderer gibt null zurück: keine Lage", ((DroppedItemPoseHolder) vanilla).heldix$droppedItemPose() == null);
		PoseStack vanillaMove = new PoseStack();
		DroppedItemHooks.translate(vanillaMove, 0f, 0.3f, 0f, vanilla);
		PoseStack vanillaTurn = new PoseStack();
		DroppedItemHooks.rotate(vanillaTurn, Axis.YP, 1.0f, vanilla);
		PoseStack vanillaExpected = new PoseStack();
		vanillaExpected.rotate(Axis.YP, 1.0f);
		t.check("null: translate und rotate wie in Minecraft", near(vanillaMove.last().pose().getTranslation(new Vector3f()).y, 0.3f, 1e-6f)
				&& vanillaTurn.last().pose().equals(vanillaExpected.last().pose(), 1e-6f));
		counting.cancel();
		t.check("Abgemeldet: der vorige Renderer zeichnet wieder", !counting.isActive()
				&& DroppedItemPose.of(0.5f, 45f, 90f).equals(((DroppedItemPoseHolder) t.compute(mc -> state(mc, "diamond×5"))).heldix$droppedItemPose()));

		// ungültige Werte: lift begrenzt, Winkel auf 0..360, NaN = dieser Teil wie Minecraft
		Registration odd = api.droppedItems().addRenderer(item -> new DroppedItemPose(100f, 7290f, -90f, Float.POSITIVE_INFINITY));
		DroppedItemPose clamped = ((DroppedItemPoseHolder) t.compute(mc -> state(mc, "diamond×5"))).heldix$droppedItemPose();
		t.check("lift auf 2 Blöcke begrenzt, ungültiger Winkel = Drehung wie Minecraft (" + clamped + ")",
				clamped != null && clamped.lift() == 2f && !clamped.hasRotation());
		odd.cancel();
		Registration wrapped = api.droppedItems().addRenderer(item -> new DroppedItemPose(Float.NaN, 7290f, -3690f, 0f));
		ItemEntityRenderState wrappedState = t.compute(mc -> state(mc, "diamond×5"));
		DroppedItemPose wrappedPose = ((DroppedItemPoseHolder) wrappedState).heldix$droppedItemPose();
		PoseStack nanMove = new PoseStack();
		DroppedItemHooks.translate(nanMove, 0f, 0.3f, 0f, wrappedState);
		t.check("große Winkel auf 0 bis 360° gebracht, lift NaN = Schweben wie Minecraft (" + wrappedPose + ")", wrappedPose != null
				&& near(wrappedPose.yaw(), 90f, 1e-3f) && near(wrappedPose.pitch(), 270f, 1e-3f) && !wrappedPose.hasLift()
				&& near(nanMove.last().pose().getTranslation(new Vector3f()).y, 0.3f, 1e-6f));
		Registration nothing = api.droppedItems().addRenderer(item -> new DroppedItemPose(Float.NaN, Float.NaN, 0f, 0f));
		t.check("nichts Gültiges = wie Minecraft", ((DroppedItemPoseHolder) t.compute(mc -> state(mc, "diamond×5"))).heldix$droppedItemPose() == null);
		nothing.cancel();
		wrapped.cancel();

		// Fehler: dieses Item wird normal gezeichnet, der Fehler zählt beim Addon des Renderers; nach drei ist es aus.
		// Geworfen wird nur, solange „fail“ gesetzt ist – das passiert nur im Haupt-Thread, für genau einen Aufruf.
		AtomicBoolean fail = new AtomicBoolean();
		Registration broken = api.droppedItems().addRenderer(item -> {
			if (fail.get()) throw new IllegalStateException("Absichtlicher Fehler im Autotest");
			return DroppedItemPose.of(0.25f, 0f, 0f);
		});
		ItemEntityRenderState failed = t.compute(mc -> {
			fail.set(true);
			try {
				return state(mc, "diamond×5");
			} finally {
				fail.set(false);
			}
		});
		t.check("Fehler im Renderer: Item wie Minecraft, Fehler gezählt, Addon bleibt an (" + t.compute(mc -> fake.errorCount()) + ")",
				((DroppedItemPoseHolder) failed).heldix$droppedItemPose() == null && t.compute(mc -> fake.errorCount()) == 1 && t.compute(mc -> fake.isActive()));
		t.check("nach dem Fehler zeichnet der Renderer weiter", DroppedItemPose.of(0.25f, 0f, 0f)
				.equals(((DroppedItemPoseHolder) t.compute(mc -> state(mc, "diamond×5"))).heldix$droppedItemPose()));
		fail.set(true);
		t.waitTicks(5);
		t.log("Test-Addon: " + t.compute(mc -> fake.state() + " " + fake.error()));
		t.check("Nach drei Fehlern ist das Test-Addon abgeschaltet", t.compute(mc -> !fake.isActive() && fake.errorCount() >= 3) && !broken.isActive() && !fixed.isActive());
		t.check("Danach zeichnet wieder Item Physics (" + AddonDroppedItems.activeAddon() + ")", PHYSICS.equals(t.compute(mc -> {
			state(mc, "diamond×5");
			return AddonDroppedItems.activeAddon();
		})));
		t.waitTicks(10);
		DroppedItemPose back = ((DroppedItemPoseHolder) t.compute(mc -> state(mc, "diamond×5"))).heldix$droppedItemPose();
		t.check("Item Physics legt das Item wieder flach (" + back + ")", back != null && near(back.pitch() % 180f, 90f, 0.01f));
		broken.cancel();
		fixed.cancel();
	}

	private static void remember(Map<String, Object> seen, DroppedItem item) {
		seen.put("entityId", item.entityId());
		seen.put("itemId", item.itemId());
		seen.put("stackSize", item.stackSize());
		seen.put("count", item.count());
		seen.put("ageTicks", item.ageTicks());
		seen.put("onGround", item.onGround());
		seen.put("inWater", item.inWater());
		seen.put("speed", item.speed());
		seen.put("flat", item.flat());
		seen.put("bobOffset", item.bobOffset());
		seen.put("minY", item.minY());
		seen.put("maxY", item.maxY());
		seen.put("minZ", item.minZ());
		seen.put("maxZ", item.maxZ());
	}

	// --- Hilfen ---------------------------------------------------------------------------------

	private static void summon(TestContext t, String item, int count, double x, double z) {
		summon(t, item, count, x, z, -59.2, "");
	}

	private static void summon(TestContext t, String item, int count, double x, double z, double y, String extra) {
		t.serverCommand("summon minecraft:item " + x + " " + y + " " + z + " {" + extra + "Item:{id:\"minecraft:" + item + "\",count:" + count + "}," + KEEP + "}");
	}

	private static java.util.List<ItemEntity> items(Minecraft mc) {
		java.util.List<ItemEntity> items = new java.util.ArrayList<>();
		if (mc.level == null) return items;
		for (Entity entity : mc.level.entitiesForRendering()) {
			if (entity instanceof ItemEntity item && !item.isRemoved()) items.add(item);
		}
		return items;
	}

	/** Name wie in den Prüfungen: Item-ID ohne „minecraft:“, bei Stapeln mit „×Anzahl“ */
	private static String name(ItemEntity item) {
		String id = BuiltInRegistries.ITEM.getKey(item.getItem().getItem()).getPath();
		return item.getItem().getCount() > 1 ? id + "×" + item.getItem().getCount() : id;
	}

	private static java.util.Optional<ItemEntity> find(Minecraft mc, String name) {
		return items(mc).stream().filter(item -> name(item).equals(name)).findFirst();
	}

	/** Renderzustand wie in einem Bild auslesen (ruft den Hook und den Renderer des Addons auf) */
	private static ItemEntityRenderState state(Minecraft mc, String name) {
		ItemEntity item = find(mc, name).orElseThrow(() -> new AssertionError("Item " + name + " nicht in der Welt"));
		return (ItemEntityRenderState) mc.getEntityRenderDispatcher().extractEntity(item, 1f);
	}

	/** Höhe der tiefsten Ecke des Modells über dem Boden, nach Anheben und Kippen (wie submit es zeichnet) */
	private static float bottom(Minecraft mc, String name) {
		ItemEntityRenderState state = state(mc, name);
		DroppedItemPose pose = ((DroppedItemPoseHolder) state).heldix$droppedItemPose();
		if (pose == null) return Float.NaN;
		net.minecraft.world.phys.AABB box = state.item.getModelBoundingBox();
		PoseStack stack = new PoseStack();
		DroppedItemHooks.translate(stack, 0f, 0f, 0f, state);
		DroppedItemHooks.rotate(stack, Axis.YP, 0f, state);
		Matrix4f matrix = stack.last().pose();
		float lowest = Float.POSITIVE_INFINITY;
		for (double x : new double[] {box.minX, box.maxX}) {
			for (double y : new double[] {box.minY, box.maxY}) {
				for (double z : new double[] {box.minZ, box.maxZ}) {
					lowest = Math.min(lowest, matrix.transformPosition(new Vector3f((float) x, (float) y, (float) z)).y);
				}
			}
		}
		return lowest;
	}

	/** Lage aller Items wie im nächsten Bild, nach Name */
	private static Map<String, DroppedItemPose> samples(TestContext t) {
		return t.compute(mc -> {
			Map<String, DroppedItemPose> poses = new java.util.TreeMap<>();
			for (ItemEntity item : items(mc)) {
				ItemEntityRenderState state = (ItemEntityRenderState) mc.getEntityRenderDispatcher().extractEntity(item, 1f);
				poses.put(name(item), state instanceof DroppedItemPoseHolder holder ? holder.heldix$droppedItemPose() : null);
			}
			return poses;
		});
	}

	private static boolean near(float a, float b, float delta) {
		return Math.abs(a - b) <= delta;
	}

	/**
	 * Ein Addon nur für den Test (ohne JAR), damit seine Fehler kein echtes Addon abschalten. Über Reflection, weil
	 * HeldixClient dafür bewusst keine öffentliche Methode hat.
	 */
	private static LoadedAddon fakeAddon(String id) {
		try {
			Constructor<LoadedAddon> constructor = LoadedAddon.class.getDeclaredConstructor(Path.class);
			constructor.setAccessible(true);
			LoadedAddon addon = constructor.newInstance(Path.of("heldix-addon-" + id + ".jar"));
			AddonMetadata meta = new AddonMetadata();
			meta.id = id;
			meta.name = "Autotest-Renderer";
			meta.version = "1.0.0";
			meta.api = HeldixApi.API_VERSION;
			set(addon, "metadata", meta);
			set(addon, "state", LoadedAddon.State.ACTIVE);
			Constructor<?> context = Class.forName("dev.heldixclient.addon.AddonContext").getDeclaredConstructor(LoadedAddon.class);
			context.setAccessible(true);
			set(addon, "context", context.newInstance(addon));
			return addon;
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException("Test-Addon nicht anlegbar", e);
		}
	}

	private static void set(Object target, String name, Object value) throws ReflectiveOperationException {
		Field field = target.getClass().getDeclaredField(name);
		field.setAccessible(true);
		field.set(target, value);
	}
}
