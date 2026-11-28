package dev.heldixclient.player;

import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.NearbyPlayer;
import dev.heldixclient.api.PlayerMenuEntry;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.PlayerMenuScreen;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.EntityHitResult;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Spielermenü: Zielt der Spieler mit dem Fadenkreuz auf einen anderen Spieler und drückt die Taste „Spielermenü“
 * (ab Werk Mausrad-Klick, wie „Block auswählen“ – auf Spielern macht das in Minecraft nichts), öffnet sich ein Kreismenü
 * mit Aktionen: Freund hinzufügen bzw. Nachricht schreiben, Name kopieren und die Einträge der Addons.
 */
public final class PlayerMenu {
	/** Eintrag eines Addons */
	public record AddonEntry(String owner, PlayerMenuEntry entry, java.util.function.BiConsumer<String, Runnable> runner) {
	}

	/** Eine Aktion im Menü für diesen Spieler */
	public record Action(String id, String label, String icon, boolean enabled, String hint, boolean keepOpen, Runnable run) {
	}

	private static final CopyOnWriteArrayList<AddonEntry> ENTRIES = new CopyOnWriteArrayList<>();

	private PlayerMenu() {
	}

	public static void add(AddonEntry entry) {
		ENTRIES.add(entry);
	}

	public static void remove(AddonEntry entry) {
		ENTRIES.remove(entry);
	}

	/** Addon abgeschaltet: seine Einträge weg */
	public static void forget(String owner) {
		ENTRIES.removeIf(entry -> entry.owner().equals(owner));
	}

	/** jeden Client-Tick: Taste gedrückt und Fadenkreuz auf einem Spieler? */
	public static void tick(Minecraft mc) {
		while (HeldixClient.playerMenuKey.consumeClick()) {
			if (mc.gui.screen() != null || mc.player == null) continue;
			Player target = targetedPlayer(mc);
			if (target != null) mc.gui.setScreen(new PlayerMenuScreen(target.getUUID()));
		}
	}

	/** Spieler unter dem Fadenkreuz (nicht du selbst), sonst null */
	public static Player targetedPlayer(Minecraft mc) {
		if (mc.hitResult instanceof EntityHitResult hit && hit.getEntity() instanceof Player player && player != mc.player) return player;
		return null;
	}

	/** Aktionen für diesen Spieler: zuerst die von HeldixClient, dann die der Addons */
	public static List<Action> actions(Minecraft mc, NearbyPlayer target) {
		List<Action> list = new ArrayList<>();
		list.add(friendAction(mc, target));
		list.add(new Action("copy-name", "Name kopieren", "copy", true, null, false, () -> {
			mc.keyboardHandler.setClipboard(target.name());
			Notifications.show("player-menu", "Name kopiert", target.name(), null);
		}));
		// öffentliches Profil (ab Heldix-Dienst 1.14.0): nur wenn der Spieler es öffentlich gemacht hat
		String profile = target.heldixPlayer() ? PublicProfiles.url(target.name()) : null;
		if (profile != null && PublicProfiles.state(target.uuid()) == PublicProfiles.State.PUBLIC) {
			list.add(new Action("profile", "Profil im Browser", "external", true, null, false, () -> {
				com.mojang.blaze3d.Blaze3D.openUri(java.net.URI.create(profile));
				Notifications.show("player-menu", "Profil geöffnet", "Das Profil von " + target.name() + " ist im Browser geöffnet.", null);
			}));
		}
		for (AddonEntry addon : ENTRIES) {
			String label;
			String icon;
			try {
				label = addon.entry().label(target);
				icon = addon.entry().icon(target);
			} catch (Throwable t) {
				HeldixClient.LOGGER.warn("Spielermenü: Eintrag von {} fehlerhaft", addon.owner(), t);
				continue;
			}
			if (label == null || label.isBlank()) continue;
			list.add(new Action("addon:" + addon.owner() + ":" + list.size(), label, icon == null ? "addons" : icon, true, null, addon.entry().keepOpen(),
					() -> addon.runner().accept("Spielermenü " + label, () -> addon.entry().select(target))));
		}
		return list;
	}

	/** Freund hinzufügen bzw. annehmen, Nachricht schreiben – je nach Stand beim Heldix-Dienst */
	private static Action friendAction(Minecraft mc, NearbyPlayer target) {
		if (!Social.online()) return new Action("friend", "Freund hinzufügen", "user-plus", false, "Braucht den Heldix-Dienst", false, () -> {
		});
		if (Social.isFriend(target.uuid())) {
			return new Action("friend", "Nachricht", "chat", true, "Ihr seid befreundet", false,
					() -> mc.gui.setScreen(new HeldixMenuScreen(null, target.uuid(), target.name())));
		}
		for (Social.Request request : Social.incoming()) {
			if (request.uuid().equals(target.uuid())) {
				return new Action("friend", "Anfrage annehmen", "check", true, target.name() + " möchte mit dir befreundet sein", false,
						() -> report(Social.accept(target.uuid()), "Ihr seid jetzt befreundet", target.name()));
			}
		}
		for (Social.Request request : Social.outgoing()) {
			if (request.uuid().equals(target.uuid())) return new Action("friend", "Anfrage gesendet", "clock", false, "Wartet auf Antwort", false, () -> {
			});
		}
		if (!target.heldixPlayer()) {
			return new Action("friend", "Freund hinzufügen", "user-plus", false, "Nutzt kein HeldixClient", false, () -> {
			});
		}
		return new Action("friend", "Freund hinzufügen", "user-plus", true, null, false,
				() -> report(Social.sendRequest(target.name()), "Anfrage gesendet", target.name()));
	}

	/** Ergebnis einer Anfrage an den Dienst als Einblendung */
	private static void report(CompletableFuture<Void> call, String success, String name) {
		call.whenComplete((ok, error) -> Minecraft.getInstance().execute(() -> {
			if (error == null) {
				Notifications.show("player-menu", success, name, null);
			} else {
				Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
				Notifications.show("player-menu", "Das hat nicht geklappt", String.valueOf(cause.getMessage()), null);
			}
		}));
	}
}
