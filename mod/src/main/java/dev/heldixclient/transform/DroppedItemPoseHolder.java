package dev.heldixclient.transform;

import dev.heldixclient.api.DroppedItemPose;

/**
 * Zusatzfeld am Renderzustand eines gedroppten Items ({@code ItemEntityRenderState}): die Lage, die ein Addon für
 * dieses Bild festgelegt hat (API 4, {@link dev.heldixclient.api.DroppedItems}).
 *
 * <p>{@link DroppedItemPatches} hängt diese Schnittstelle samt Feld beim Laden an die Minecraft-Klasse an; sie benutzt
 * deshalb keine Minecraft-Typen. Fehlt sie (Patch gescheitert), prüfen die Hooks das mit {@code instanceof} und
 * zeichnen wie Minecraft.
 */
public interface DroppedItemPoseHolder {
	/** Lage für dieses Bild, null = wie Minecraft (schweben und drehen) */
	DroppedItemPose heldix$droppedItemPose();

	void heldix$setDroppedItemPose(DroppedItemPose pose);
}
