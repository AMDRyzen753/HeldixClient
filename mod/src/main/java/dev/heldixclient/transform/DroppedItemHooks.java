package dev.heldixclient.transform;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import dev.heldixclient.addon.AddonDroppedItems;
import dev.heldixclient.api.DroppedItemPose;
import net.minecraft.client.renderer.entity.state.ItemEntityRenderState;
import net.minecraft.world.entity.item.ItemEntity;

/**
 * Wird vom durch {@link DroppedItemPatches} veränderten {@code ItemEntityRenderer} aufgerufen, im Haupt-Thread.
 * Ohne Lage eines Addons (kein Renderer angemeldet, Renderer gibt null zurück, Patch am Renderzustand fehlt) rufen
 * {@link #translate} und {@link #rotate} genau die Originalmethoden mit den Originalwerten auf.
 */
public final class DroppedItemHooks {
	/** Wie oft in submit eine Lage eines Addons angewendet wurde (für den Autotest) */
	private static long applied;

	private DroppedItemHooks() {
	}

	/** Ende von {@code ItemEntityRenderer.extractRenderState}: Lage für dieses Bild am Renderzustand ablegen. */
	public static void extract(ItemEntity entity, ItemEntityRenderState state, float partialTick) {
		if (!(state instanceof DroppedItemPoseHolder holder)) return;
		holder.heldix$setDroppedItemPose(AddonDroppedItems.pose(entity, state, partialTick));
	}

	/** Ersetzt in {@code submit} das Schweben ({@code pose.translate(0, Schweben + Höhe, 0)}). */
	public static void translate(PoseStack pose, float x, float y, float z, ItemEntityRenderState state) {
		DroppedItemPose itemPose = state instanceof DroppedItemPoseHolder holder ? holder.heldix$droppedItemPose() : null;
		if (itemPose != null && itemPose.hasLift()) {
			pose.translate(x, itemPose.lift(), z);
			applied++;
		} else {
			pose.translate(x, y, z);
		}
	}

	/** Ersetzt in {@code submit} das Drehen ({@code pose.rotate(Axis.YP, Drehwinkel)}). */
	public static void rotate(PoseStack pose, Axis axis, float angle, ItemEntityRenderState state) {
		DroppedItemPose itemPose = state instanceof DroppedItemPoseHolder holder ? holder.heldix$droppedItemPose() : null;
		if (itemPose != null && itemPose.hasRotation()) {
			pose.rotateDegrees(Axis.YP, itemPose.yaw());
			pose.rotateDegrees(Axis.XP, itemPose.pitch());
			if (itemPose.roll() != 0f) pose.rotateDegrees(Axis.ZP, itemPose.roll());
			applied++;
		} else {
			pose.rotate(axis, angle);
		}
	}

	/** Anzahl angewendeter Lagen seit dem Start (Höhe und Drehung zählen einzeln; für den Autotest) */
	public static long applied() {
		return applied;
	}
}
