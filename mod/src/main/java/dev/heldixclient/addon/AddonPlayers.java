package dev.heldixclient.addon;

import dev.heldixclient.api.PlayerMarkers;
import dev.heldixclient.api.PlayerMenuEntry;
import dev.heldixclient.api.Registration;
import dev.heldixclient.api.VoiceChannel;
import dev.heldixclient.player.PlayerMarkerStore;
import dev.heldixclient.player.PlayerMenu;
import dev.heldixclient.voice.VoiceDialogs;
import dev.heldixclient.voice.VoiceLink;
import dev.heldixclient.voice.VoiceModeration;
import dev.heldixclient.voice.VoiceReports;
import net.minecraft.client.Minecraft;

import java.time.Duration;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Addon-API 6/7/9/10 rund um andere Spieler: Sprachkanal ({@link VoiceChannel}, ab 7 mit Status und Gruppen, ab 9 mit Gästen
 * und Browser-Link, ab 10 mit Moderation, Melden und Voice-Regeln über Dialoge von HeldixClient), Symbole am
 * Namensschild und über dem Kopf ({@link PlayerMarkers}) und Einträge im Spielermenü. Alles läuft unter der Id des Addons und wird beim Abschalten mit {@link #release} entfernt.
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

			@Override
			public void showAbove(UUID player, String icon, int color, Duration duration) {
				Objects.requireNonNull(player, "player");
				if (!addon.isActive()) return;
				PlayerMarkerStore.showAbove(addon.id(), player, icon, color, duration == null ? 1000 : duration.toMillis());
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

			@Override
			public void setState(boolean muted, boolean deafened) {
				if (addon.isActive()) VoiceLink.setState(muted, deafened);
			}

			@Override
			public boolean peerMuted(UUID player) {
				return VoiceLink.isActive(owner) && VoiceLink.peerMuted(player);
			}

			@Override
			public boolean peerDeafened(UUID player) {
				return VoiceLink.isActive(owner) && VoiceLink.peerDeafened(player);
			}

			@Override
			public void setGroup(String name, String password) {
				if (addon.isActive()) VoiceLink.setGroup(owner, name, password);
			}

			@Override
			public String group() {
				return VoiceLink.isActive(owner) ? VoiceLink.groupName() : null;
			}

			@Override
			public Set<UUID> groupMembers() {
				return VoiceLink.isActive(owner) ? VoiceLink.groupMembers() : Set.of();
			}

			// --- API 11: Server-Gruppe (Partner-Server mit dem Plugin „HeldixClient Server“) ---

			@Override
			public String serverGroup() {
				return VoiceLink.isActive(owner) ? VoiceLink.serverGroup() : null;
			}

			@Override
			public String serverGroupPartner() {
				return VoiceLink.isActive(owner) ? VoiceLink.serverGroupPartner() : "";
			}

			@Override
			public boolean groupsAvailable() {
				return VoiceLink.isActive(owner) && VoiceLink.groupsAvailable();
			}

			@Override
			public String groupProblem() {
				return VoiceLink.isActive(owner) ? VoiceLink.groupProblem() : null;
			}

			// --- API 9: Gäste und Browser-Teilnehmer ---

			@Override
			public boolean isGuest(UUID participant) {
				return VoiceLink.isActive(owner) && VoiceLink.isGuest(participant);
			}

			@Override
			public boolean inBrowser(UUID participant) {
				return VoiceLink.isActive(owner) && VoiceLink.inBrowser(participant);
			}

			@Override
			public boolean guestsAvailable() {
				return VoiceLink.isActive(owner) && VoiceLink.guestsAvailable();
			}

			@Override
			public void removeGuest(UUID guest) {
				if (addon.isActive() && VoiceLink.isActive(owner) && guest != null) VoiceLink.removeGuest(guest);
			}

			@Override
			public void createBrowserLink(Consumer<String> onLink, Consumer<String> onError) {
				Objects.requireNonNull(onLink, "onLink");
				Objects.requireNonNull(onError, "onError");
				if (!addon.isActive()) return;
				Minecraft minecraft = Minecraft.getInstance();
				if (!VoiceLink.isActive(owner)) {
					deliver(addon, minecraft, "createBrowserLink", onError, "Voice Chat ist aus – schalte ihn zuerst ein");
					return;
				}
				if (!LINKS.add(owner)) {
					deliver(addon, minecraft, "createBrowserLink", onError, "Der Link wird gerade erstellt …");
					return;
				}
				VoiceLink.createBrowserLink().whenComplete((invite, error) -> {
					LINKS.remove(owner);
					if (error == null) {
						deliver(addon, minecraft, "createBrowserLink", onLink, invite.url());
						return;
					}
					Throwable cause = error instanceof java.util.concurrent.CompletionException && error.getCause() != null ? error.getCause() : error;
					deliver(addon, minecraft, "createBrowserLink", onError,
							cause instanceof dev.heldixclient.social.Social.ServiceException && cause.getMessage() != null ? cause.getMessage() : "Dienst nicht erreichbar");
				});
			}

			// --- API 10: Moderation, Melden, Voice-Regeln ---

			@Override
			public Moderation moderation() {
				return VoiceLink.isActive(owner) ? VoiceModeration.state() : VoiceModeration.EMPTY;
			}

			@Override
			public Registration onModeration(Consumer<ModerationEvent> listener) {
				Objects.requireNonNull(listener, "listener");
				Consumer<ModerationEvent> wrapped = event -> {
					if (!addon.isActive() || !VoiceLink.isActive(owner)) return;
					try {
						listener.accept(event);
					} catch (Throwable t) {
						AddonManager.reportError(addon, "onModeration", t);
					}
				};
				VoiceModeration.addListener(owner, wrapped);
				return registration(() -> VoiceModeration.removeListener(owner, wrapped));
			}

			@Override
			public RoomRights rights() {
				return VoiceModeration.rights();
			}

			@Override
			public boolean isSilenced(UUID participant) {
				return VoiceLink.isActive(owner) && VoiceModeration.isSilenced(participant);
			}

			@Override
			public void moderate(UUID participant, ModerationAction action, Consumer<String> onResult) {
				Objects.requireNonNull(participant, "participant");
				Objects.requireNonNull(action, "action");
				Objects.requireNonNull(onResult, "onResult");
				if (!addon.isActive()) return;
				requireUserAction("moderate()");
				Minecraft minecraft = Minecraft.getInstance();
				if (!VoiceLink.isActive(owner)) {
					deliver(addon, minecraft, "moderate", onResult, "Voice Chat ist aus – schalte ihn zuerst ein");
					return;
				}
				VoiceModeration.moderate(participant, action, message -> deliver(addon, minecraft, "moderate", onResult, message));
			}

			@Override
			public Rules rules() {
				return VoiceModeration.rules();
			}

			@Override
			public void showRules(Consumer<Boolean> onDone) {
				Objects.requireNonNull(onDone, "onDone");
				if (!addon.isActive()) return;
				Minecraft minecraft = Minecraft.getInstance();
				if (!minecraft.isSameThread()) throw new IllegalStateException("showRules() nur im Haupt-Thread aufrufen");
				Consumer<Boolean> answer = accepted -> deliver(addon, minecraft, "showRules", onDone, accepted);
				if (AddonManager.inUserAction(addon)) {
					VoiceDialogs.showRules(true, answer);
				} else if (VoiceLink.isActive(owner) && VoiceModeration.allowAutoRules(owner)) {
					// ohne Aktion des Spielers nur, solange die Zustimmung nötig ist, und einmal je Fassung
					VoiceDialogs.showRules(false, answer);
				} else {
					answer.accept(!VoiceModeration.rulesRequired());
				}
			}

			@Override
			public void openReport(UUID participant, ReportAttachments attachments, Consumer<String> onResult) {
				Objects.requireNonNull(participant, "participant");
				Objects.requireNonNull(onResult, "onResult");
				if (!addon.isActive()) return;
				requireUserAction("openReport()");
				Minecraft minecraft = Minecraft.getInstance();
				String problem = !VoiceLink.isActive(owner) ? "Voice Chat ist aus – schalte ihn zuerst ein"
						: !VoiceModeration.available() ? "Der Heldix-Dienst kann noch keine Voice-Meldungen (ab Dienst 1.13.0)"
						: VoiceLink.isGuest(participant) ? "Gäste im Browser lassen sich nicht melden – entferne sie mit dem × in der Anzeige"
						: participant.equals(minecraft.getUser().getProfileId()) ? "Dich selbst kannst du nicht melden" : null;
				if (problem != null) {
					deliver(addon, minecraft, "openReport", onResult, problem);
					return;
				}
				String name = dev.heldixclient.player.NearbyPlayers.nameOf(minecraft, participant);
				VoiceDialogs.openReport(new VoiceReports.Request(owner, participant, name != null ? name : "Spieler", attachments,
						message -> deliver(addon, minecraft, "openReport", onResult, message), (where, error) -> AddonManager.reportError(addon, where, error)));
			}

			@Override
			public boolean clipsActive() {
				return VoiceLink.isActive(owner) && VoiceModeration.clipsActive();
			}

			/** Moderieren und Melden nur als direkte Folge einer Aktion des Spielers */
			private void requireUserAction(String what) {
				if (!AddonManager.inUserAction(addon)) {
					throw new IllegalStateException(what + " nur auf Wunsch des Spielers (Taste, Knopf, Klick im HUD, Befehl oder Spielermenü)");
				}
			}
		};
	}

	/** Addons, für die gerade ein Browser-Link erstellt wird (höchstens einer gleichzeitig je Addon) */
	private static final Set<String> LINKS = java.util.concurrent.ConcurrentHashMap.newKeySet();

	/** Ergebnis im Haupt-Thread an das Addon geben (nur, solange es aktiv ist; Fehler zählen als Addon-Fehler) */
	private static <T> void deliver(LoadedAddon addon, Minecraft minecraft, String where, Consumer<T> callback, T value) {
		minecraft.execute(() -> {
			if (!addon.isActive()) return;
			try {
				callback.accept(value);
			} catch (Throwable t) {
				AddonManager.reportError(addon, where, t);
			}
		});
	}
}
