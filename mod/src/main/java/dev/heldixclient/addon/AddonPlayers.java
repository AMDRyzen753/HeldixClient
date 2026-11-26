package dev.heldixclient.addon;

import dev.heldixclient.api.PlayerMarkers;
import dev.heldixclient.api.PlayerMenuEntry;
import dev.heldixclient.api.Registration;
import dev.heldixclient.api.VoiceChannel;
import dev.heldixclient.player.PlayerMarkerStore;
import dev.heldixclient.player.PlayerMenu;
import dev.heldixclient.voice.VoiceLink;

import java.time.Duration;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Addon-API 6 rund um andere Spieler: Sprachkanal ({@link VoiceChannel}), Symbole am Namensschild ({@link PlayerMarkers})
 * und Einträge im Spielermenü. Alles läuft unter der Id des Addons und wird beim Abschalten mit {@link #release} entfernt.
 */
final class AddonPlayers {
	private AddonPlayers() {
	}

	/** Addon abgeschaltet oder abgestürzt: Sprachkanal, Symbole und Menü-Einträge freigeben */
	static void release(LoadedAddon addon) {
		String owner = addon.id();
		VoiceLink.forget(owner);
		PlayerMarkerStore.forget(owner);
		PlayerMenu.forget(owner);
	}

	/** Abmeldung, die einmal etwas ausführt */
	private static Registration registration(Runnable cancel) {
		AtomicBoolean active = new AtomicBoolean(true);
		return new Registration() {
			@Override
			public void cancel() {
				if (active.compareAndSet(true, false)) cancel.run();
			}

			@Override
			public boolean isActive() {
				return active.get();
			}
		};
	}

	static Registration addMenuEntry(LoadedAddon addon, PlayerMenuEntry entry) {
		Objects.requireNonNull(entry, "entry");
		PlayerMenu.AddonEntry added = new PlayerMenu.AddonEntry(addon.id(), entry, (where, action) -> {
			if (addon.isActive()) AddonManager.userAction(addon, where, action);
		});
		PlayerMenu.add(added);
		return registration(() -> PlayerMenu.remove(added));
	}

	static PlayerMarkers markers(LoadedAddon addon) {
		return new PlayerMarkers() {
			@Override
			public void show(UUID player, String icon, int color, Duration duration) {
				Objects.requireNonNull(player, "player");
				if (!addon.isActive()) return;
				PlayerMarkerStore.show(addon.id(), player, icon, color, duration == null ? 1000 : duration.toMillis());
			}

			@Override
			public void hide(UUID player) {
				if (player != null) PlayerMarkerStore.hide(addon.id(), player);
			}
		};
	}

	static VoiceChannel voice(LoadedAddon addon) {
		String owner = addon.id();
		return new VoiceChannel() {
			@Override
			public Status status() {
				if (!VoiceLink.isActive(owner)) return Status.OFF;
				return switch (VoiceLink.status()) {
					case OFF -> Status.OFF;
					case UNAVAILABLE -> Status.UNAVAILABLE;
					case CONNECTING -> Status.CONNECTING;
					case CONNECTED -> Status.CONNECTED;
				};
			}

			@Override
			public String statusText() {
				return VoiceLink.isActive(owner) ? VoiceLink.statusText() : "Aus";
			}

			@Override
			public void setActive(boolean active) {
				VoiceLink.setActive(owner, active && addon.isActive());
			}

			@Override
			public boolean isActive() {
				return VoiceLink.isActive(owner);
			}

			@Override
			public void setFriendsOnly(boolean friendsOnly) {
				VoiceLink.setFriendsOnly(owner, friendsOnly);
			}

			@Override
			public int range() {
				return VoiceLink.range();
			}

			@Override
			public int maxFrameSize() {
				return VoiceLink.maxFrameSize();
			}

			@Override
			public boolean send(byte[] frame, int sequence, boolean last) {
				return VoiceLink.isActive(owner) && VoiceLink.send(frame, sequence, last);
			}

			@Override
			public Registration onFrame(FrameListener listener) {
				Objects.requireNonNull(listener, "listener");
				VoiceLink.Sink sink = new VoiceLink.Sink(owner, (sender, sequence, last, frame) -> {
					if (addon.isActive()) listener.onFrame(sender, sequence, last, frame);
				});
				VoiceLink.addSink(sink);
				return registration(() -> VoiceLink.removeSink(sink));
			}

			@Override
			public Set<UUID> peers() {
				return VoiceLink.isActive(owner) ? VoiceLink.peers() : Set.of();
			}
		};
	}
}
