package dev.heldixclient.addons.itemphysics;

import dev.heldixclient.api.DroppedItem;
import dev.heldixclient.api.DroppedItemPose;
import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;

import java.util.Locale;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;

/**
 * Item Physics (Idee und Rechnungen: Kxyuzu): gedroppte Items liegen flach und still auf dem Boden, statt zu schweben
 * und sich zu drehen.
 * <ul>
 *   <li>In der Luft überschlagen sich Items beim Fallen – je schneller, desto mehr.</li>
 *   <li>Am Boden und im Wasser legen sie sich in kurzer Zeit hin: flache Items flach, Blöcke auf eine Seite. Jedes Item
 *       hat eine feste, zufällige Ausrichtung.</li>
 *   <li>Stapel liegen übereinander (flache Items) oder verstreut (Blöcke), wie in Minecraft.</li>
 * </ul>
 * Rein optisch und nur auf dem eigenen Client. Braucht nur die Heldix-API 4 ({@link HeldixApi#droppedItems()}).
 */
public final class ItemPhysicsAddon implements HeldixAddon {
	/** Plätze im Speicher je Item ({@link DroppedItem#memory()}) */
	private static final int STARTED = 0;
	private static final int PITCH = 1;
	private static final int LAST_AGE = 2;
	/** Zeit seit dem letzten Bild höchstens so viele Ticks (nach Pausen oder Chunk-Wechseln springt nichts) */
	private static final float MAX_STEP = 4.0F;

	private ModuleHandle module;
	private DoubleSupplier airSpin = () -> 100;
	private DoubleSupplier settleSeconds = () -> 0.25;
	private BooleanSupplier blocksTumble = () -> true;
	private boolean warned;

	@Override
	public void onEnable(HeldixApi api) {
		module = api.registerModule(ModuleSpec.of("itemphysics", "Item Physics", "Items liegen flach am Boden").withIcon("cube"));
		airSpin = module.addSlider("air-spin", "Drehung in der Luft", "Wie stark sich Items beim Fallen überschlagen", 0, 200, 10, 100,
				value -> value == 0 ? "Aus" : (int) value + " %");
		settleSeconds = module.addSlider("settle", "Hinlegen", "So lange braucht ein Item am Boden, bis es liegt", 0, 1, 0.05, 0.25,
				value -> value == 0 ? "Sofort" : String.format(Locale.GERMANY, "%.2f s", value));
		blocksTumble = module.addToggle("blocks-tumble", "Blöcke kippen",
				"Blöcke überschlagen sich in der Luft und landen auf einer Seite (aus: Blöcke bleiben aufrecht)", true);

		// ab Werk nicht belegt, wie in der ursprünglichen Mod; umbelegbar unter Optionen → Steuerung → Heldix-Addons
		api.registerKey("toggle", "Ein/Aus", HeldixKeys.NONE, () -> {
			module.setEnabled(!module.isEnabled());
			api.notify("Item Physics", module.isEnabled() ? "An – Items liegen flach am Boden" : "Aus – Items schweben wie gewohnt");
		});

		api.droppedItems().addRenderer(this::pose);
		api.events().onWorldJoin(() -> {
			if (warned || api.droppedItems().isSupported()) return;
			warned = true;
			api.logger().warn("HeldixClient kann das Zeichnen der Items in Minecraft " + api.minecraftVersion() + " nicht verändern – Items schweben wie gewohnt.");
			if (module.isEnabled()) api.notify("Item Physics", "Wirkt in dieser Minecraft-Version nicht");
		});
	}

	/** Lage eines Items in diesem Bild (Haupt-Thread, einmal pro Item und Bild) */
	private DroppedItemPose pose(DroppedItem item) {
		if (!module.isEnabled()) return null;
		boolean flat = item.flat();
		boolean resting = item.onGround() || item.inWater();
		float age = item.ageTicks();
		float[] memory = item.memory();
		if (memory[STARTED] == 0F) {
			memory[STARTED] = 1F;
			// Liegt ein Item schon, wenn es zum ersten Mal gezeichnet wird, liegt es gleich flach (kein Umkippen)
			memory[PITCH] = resting && flat ? 90.0F : 0.0F;
			memory[LAST_AGE] = age;
		}
		float dt = Math.clamp(age - memory[LAST_AGE], 0.0F, MAX_STEP);
		memory[LAST_AGE] = age;

		float pitch = ItemPhysicsMath.tilt(memory[PITCH], dt, resting, flat, flat || blocksTumble.getAsBoolean(),
				ItemPhysicsMath.settleSpeed(settleSeconds.getAsDouble()), (float) (airSpin.getAsDouble() / 100.0), item.speed());
		memory[PITCH] = pitch;
		// bobOffset ist je Item zufällig (0 bis 2π) – ergibt eine feste Ausrichtung
		float yaw = (float) Math.toDegrees(item.bobOffset());
		float lift = ItemPhysicsMath.lift(item.minY(), item.maxY(), item.minZ(), item.maxZ(), item.count(), flat, pitch);
		return DroppedItemPose.of(lift, yaw, pitch);
	}
}
