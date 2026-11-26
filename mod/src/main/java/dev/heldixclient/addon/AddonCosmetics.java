package dev.heldixclient.addon;

import dev.heldixclient.api.CosmeticChange;
import dev.heldixclient.api.CosmeticInfo;
import dev.heldixclient.api.Cosmetics;
import dev.heldixclient.api.Registration;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.cosmetic.CosmeticCatalog;
import dev.heldixclient.cosmetic.CosmeticFormat;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Heldix-Cosmetics für Addons (API 4, {@link Cosmetics}): lesen, lokale Vorschau, kurze Effekte, Änderungen der eigenen
 * Auswahl. Ändern kann ein Addon nichts beim Dienst. Vorschauen und Listener enden mit dem Addon.
 */
final class AddonCosmetics implements Cosmetics {
	/** erlaubte Effekte je Slot */
	private static final Map<Slot, Set<String>> EFFECTS = Map.of(
			Slot.HEAD, Set.of("spin", "bounce"),
			Slot.BACK, Set.of("flap", "spin", "bounce"),
			Slot.COMPANION, Set.of("spin", "bounce"),
			Slot.AURA, Set.of("burst"),
			Slot.CAPE, Set.of());

	private final LoadedAddon addon;

	private AddonCosmetics(LoadedAddon addon) {
		this.addon = addon;
	}

	static Cosmetics forAddon(LoadedAddon addon) {
		return new AddonCosmetics(addon);
	}

	private record Info(String id, Slot slot, String name, String description, boolean teamOnly) implements CosmeticInfo {
	}

	private record Change(Slot slot, Optional<String> previous, Optional<String> current) implements CosmeticChange {
	}

	@Override
	public List<CosmeticInfo> catalog() {
		List<CosmeticInfo> list = new ArrayList<>();
		for (CosmeticCatalog.Item item : CosmeticCatalog.items()) {
			Slot.of(item.slot()).ifPresent(slot -> list.add(new Info(item.id(), slot, item.name(), item.description(), item.teamOnly())));
		}
		return Collections.unmodifiableList(list);
	}

	@Override
	public Optional<String> worn(UUID player, Slot slot) {
		Objects.requireNonNull(player, "player");
		Objects.requireNonNull(slot, "slot");
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft != null && player.equals(minecraft.getGameProfile().id())) return Optional.ofNullable(mine().get(slot));
		if (slot == Slot.CAPE) return Optional.ofNullable(Social.lookupCape(player));
		return Optional.ofNullable(Social.cosmeticOf(player, slot.id()));
	}

	@Override
	public Map<Slot, String> mine() {
		Map<Slot, String> map = new EnumMap<>(Slot.class);
		for (Map.Entry<String, String> entry : dev.heldixclient.cosmetic.Cosmetics.mine().entrySet()) {
			Slot.of(entry.getKey()).ifPresent(slot -> map.put(slot, entry.getValue()));
		}
		String cape = HeldixConfig.get().cape;
		if (cape != null && !cape.isEmpty() && !cape.startsWith("datei:")) map.put(Slot.CAPE, cape);
		return Collections.unmodifiableMap(map);
	}

	@Override
	public Registration preview(Slot slot, String id, Duration duration) {
		Objects.requireNonNull(slot, "slot");
		Objects.requireNonNull(id, "id");
		Objects.requireNonNull(duration, "duration");
		if (duration.isNegative() || duration.isZero()) throw new IllegalArgumentException("Die Dauer der Vorschau muss positiv sein");
		boolean known = slot == Slot.CAPE ? CosmeticFormat.BUILTIN_CAPE_IDS.contains(id) || CosmeticCatalog.item(id, "cape") != null
				: CosmeticCatalog.item(id, slot.id()) != null;
		if (!known) throw new IllegalArgumentException("Das Cosmetic „" + id + "“ gibt es im Slot " + slot.id() + " nicht (oder der Katalog ist noch nicht geladen)");
		double seconds = Math.min(3600.0, duration.toMillis() / 1000.0);
		dev.heldixclient.cosmetic.Cosmetics.PreviewHandle handle = dev.heldixclient.cosmetic.Cosmetics.preview(slot.id(), id, seconds, addon::isActive);
		return new Registration() {
			@Override
			public void cancel() {
				handle.cancel();
			}

			@Override
			public boolean isActive() {
				return handle.isActive();
			}
		};
	}

	@Override
	public void animate(Slot slot, String animation) {
		Objects.requireNonNull(slot, "slot");
		Objects.requireNonNull(animation, "animation");
		if (!dev.heldixclient.cosmetic.Cosmetics.EFFECTS.contains(animation)) {
			throw new IllegalArgumentException("Unbekannter Effekt „" + animation + "“ (flap, spin, bounce, burst)");
		}
		if (!EFFECTS.get(slot).contains(animation)) {
			throw new IllegalArgumentException("Den Effekt „" + animation + "“ gibt es für den Slot " + slot.id() + " nicht");
		}
		dev.heldixclient.cosmetic.Cosmetics.animate(slot.id(), animation);
	}

	@Override
	public Registration onChange(Consumer<CosmeticChange> listener) {
		Objects.requireNonNull(listener, "listener");
		boolean[] cancelled = {false};
		Runnable[] remove = new Runnable[1];
		remove[0] = dev.heldixclient.cosmetic.Cosmetics.addListener(change -> {
			if (cancelled[0] || !addon.isActive()) return;
			Optional<Slot> slot = Slot.of(change.slot());
			if (slot.isEmpty()) return;
			try {
				listener.accept(new Change(slot.get(), Optional.ofNullable(change.oldId()), Optional.ofNullable(change.newId())));
			} catch (Throwable t) {
				AddonManager.reportError(addon, "Cosmetics.onChange", t);
			}
		});
		return new Registration() {
			@Override
			public void cancel() {
				cancelled[0] = true;
				remove[0].run();
			}

			@Override
			public boolean isActive() {
				return !cancelled[0] && addon.isActive();
			}
		};
	}
}
