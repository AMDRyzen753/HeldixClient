package dev.heldixclient.cosmetic;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/**
 * Cosmetics des eigenen Spielers: Auswahl je Slot (beim Heldix-Dienst gespeichert, {@code GET/PUT /v1/me/cosmetics}),
 * ob man Team-Cosmetics wählen darf, lokale Vorschauen und kurze Effekte der Addon-API und Meldungen über Änderungen.
 *
 * <p>Slots: head (Hüte &amp; Kopf), back (Flügel &amp; Rücken), aura (Partikel), companion (Begleiter). Das Cape bleibt bei
 * {@link Capes} (eingebaute, eigene und Katalog-Capes); Änderungen daran meldet {@link #capeChanged} trotzdem hier.
 * Die zuletzt bekannte Auswahl steht in der Konfiguration, damit sie nach dem Start sofort sichtbar ist.
 */
public final class Cosmetics {
	/** Slots mit Modell oder Partikeln (das Cape hat seinen eigenen Weg) */
	public static final List<String> WORN_SLOTS = List.of("head", "back", "aura", "companion");
	/** alle Slots wie beim Dienst */
	public static final List<String> SLOTS = List.of("head", "back", "aura", "companion", "cape");

	/** Änderung der eigenen Auswahl (oldId/newId null = nichts) */
	public record Change(String slot, String oldId, String newId) {
	}

	/** Was eine Spielerfigur in den Menüs trägt (null = nichts); vom Menü selbst gesetzt */
	public static final class Dress {
		public String head;
		public String back;
		public String aura;
		public String companion;

		public String get(String slot) {
			return switch (slot) {
				case "head" -> head;
				case "back" -> back;
				case "aura" -> aura;
				case "companion" -> companion;
				default -> null;
			};
		}

		public void set(String slot, String id) {
			switch (slot) {
				case "head" -> head = id;
				case "back" -> back = id;
				case "aura" -> aura = id;
				case "companion" -> companion = id;
				default -> {
				}
			}
		}

		/** übernimmt die eigene Auswahl (mit Vorschauen) */
		public Dress copyOwn() {
			for (String slot : WORN_SLOTS) set(slot, own(slot));
			return this;
		}
	}

	/** Lokale Vorschau (Addon-API): zeigt ein Cosmetic eine Zeit lang am eigenen Spieler */
	private static final class Preview {
		final String slot;
		final String id;
		final long until;
		final BooleanSupplier alive;
		volatile boolean cancelled;

		Preview(String slot, String id, long until, BooleanSupplier alive) {
			this.slot = slot;
			this.id = id;
			this.until = until;
			this.alive = alive;
		}

		boolean active(long now) {
			return !cancelled && now < until && alive.getAsBoolean();
		}
	}

	/** Effekt aus {@link #animate}: Art und Startzeit (System.nanoTime) */
	public record Effect(String kind, long start) {
		/** Länge eines Effekts in Sekunden */
		public static final double SECONDS = 1.6;

		public double progress(long now) {
			return (now - start) / 1e9 / SECONDS;
		}
	}

	/** Namen der Effekte für {@link #animate} */
	public static final List<String> EFFECTS = List.of("flap", "spin", "bounce", "burst");

	private static volatile Map<String, String> mine = Map.of();
	private static volatile boolean team;
	private static final List<Preview> PREVIEWS = new CopyOnWriteArrayList<>();
	private static final Map<String, Effect> EFFECTS_BY_SLOT = new java.util.concurrent.ConcurrentHashMap<>();
	private static final List<Consumer<Change>> LISTENERS = new CopyOnWriteArrayList<>();

	private Cosmetics() {
	}

	/** Beim Start: letzte bekannte Auswahl aus der Konfiguration, Katalog laden */
	public static void init() {
		Map<String, String> stored = HeldixConfig.get().cosmetics;
		Map<String, String> map = new LinkedHashMap<>();
		if (stored != null) {
			for (String slot : WORN_SLOTS) {
				String id = stored.get(slot);
				if (id != null && CosmeticFormat.ID_RE.matcher(id).matches()) map.put(slot, id);
			}
		}
		mine = Map.copyOf(map);
		CosmeticCatalog.init();
	}

	/** Name eines Slots für die Anzeige */
	public static String slotName(String slot) {
		return switch (slot) {
			case "head" -> "Hüte & Kopf";
			case "back" -> "Flügel & Rücken";
			case "aura" -> "Partikel";
			case "companion" -> "Begleiter";
			case "cape" -> "Capes";
			default -> slot;
		};
	}

	// ======================================================================================
	// Eigene Auswahl
	// ======================================================================================

	/** Gewähltes Cosmetic im Slot (ohne Vorschauen), null = nichts */
	public static String mine(String slot) {
		return mine.get(slot);
	}

	/** Die eigene Auswahl je Slot (ohne Vorschauen), nur belegte Slots */
	public static Map<String, String> mine() {
		return mine;
	}

	/** Darf dieser Spieler Cosmetics nur fürs Team wählen? (vom Dienst, {@code team} in /v1/me/cosmetics) */
	public static boolean team() {
		return team;
	}

	/** Was der eigene Spieler im Slot gerade zeigt: jüngste aktive Vorschau, sonst die Auswahl */
	public static String own(String slot) {
		if (!PREVIEWS.isEmpty()) {
			long now = System.nanoTime();
			for (int i = PREVIEWS.size() - 1; i >= 0; i--) {
				Preview preview = PREVIEWS.get(i);
				if (!preview.active(now)) {
					PREVIEWS.remove(preview);
					continue;
				}
				if (preview.slot.equals(slot)) return preview.id;
			}
		}
		return mine.get(slot);
	}

	/** Cape-ID einer aktiven Vorschau (Addon-API), sonst null */
	public static String capePreview() {
		return PREVIEWS.isEmpty() ? null : ownPreviewOnly("cape");
	}

	private static String ownPreviewOnly(String slot) {
		long now = System.nanoTime();
		for (int i = PREVIEWS.size() - 1; i >= 0; i--) {
			Preview preview = PREVIEWS.get(i);
			if (preview.active(now) && preview.slot.equals(slot)) return preview.id;
		}
		return null;
	}

	/**
	 * Antwort von {@code GET/PUT /v1/me/cosmetics} übernehmen (jeder Thread). Meldet Änderungen an die Listener (im
	 * Haupt-Thread) und merkt die Auswahl in der Konfiguration.
	 */
	public static void applyMine(JsonObject json) {
		if (json == null) return;
		Map<String, String> next = new LinkedHashMap<>();
		for (String slot : WORN_SLOTS) {
			JsonElement value = json.get(slot);
			if (value != null && value.isJsonPrimitive()) {
				String id = value.getAsString();
				if (!id.isEmpty() && CosmeticFormat.ID_RE.matcher(id).matches()) next.put(slot, id);
			}
		}
		if (json.has("team") && json.get("team").isJsonPrimitive()) team = json.get("team").getAsBoolean();
		setMine(next);
	}

	private static void setMine(Map<String, String> next) {
		Map<String, String> before = mine;
		mine = Map.copyOf(next);
		List<Change> changes = new ArrayList<>();
		for (String slot : WORN_SLOTS) {
			if (!Objects.equals(before.get(slot), next.get(slot))) changes.add(new Change(slot, before.get(slot), next.get(slot)));
		}
		if (changes.isEmpty()) return;
		Minecraft minecraft = Minecraft.getInstance();
		Runnable notify = () -> {
			HeldixConfig.get().cosmetics = new LinkedHashMap<>(mine);
			HeldixConfig.save();
			for (Change change : changes) fire(change);
		};
		if (minecraft == null || minecraft.isSameThread()) notify.run();
		else minecraft.execute(notify);
	}

	/** Daten beim Dienst gelöscht: auch die gemerkte Auswahl vergessen */
	public static void forgetMine() {
		team = false;
		setMine(Map.of());
	}

	/** Das eigene Cape wurde gewechselt (Capes.select): an die Listener melden */
	public static void capeChanged(String oldId, String newId) {
		if (Objects.equals(oldId, newId)) return;
		fire(new Change("cape", oldId, newId));
	}

	private static void fire(Change change) {
		for (Consumer<Change> listener : LISTENERS) {
			try {
				listener.accept(change);
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.warn("Cosmetics: Fehler in einem Listener", e);
			}
		}
	}

	/** Listener für Änderungen der eigenen Auswahl (im Haupt-Thread aufgerufen) */
	public static Runnable addListener(Consumer<Change> listener) {
		LISTENERS.add(listener);
		return () -> LISTENERS.remove(listener);
	}

	/**
	 * Cosmetic im Slot anlegen ({@code id}) oder ablegen ({@code null}) – über den Heldix-Dienst. Ohne Verbindung oder mit
	 * Offline-Konto schlägt das mit einer deutschen Meldung fehl ({@link Social.ServiceException}).
	 */
	public static CompletableFuture<Void> choose(String slot, String id) {
		CompletableFuture<Void> result = new CompletableFuture<>();
		String problem = serviceProblem();
		if (problem != null) {
			result.completeExceptionally(new Social.ServiceException(problem));
			return result;
		}
		if (!WORN_SLOTS.contains(slot)) {
			result.completeExceptionally(new Social.ServiceException("Unbekannter Slot „" + slot + "“"));
			return result;
		}
		CosmeticCatalog.Item item = id == null ? null : CosmeticCatalog.item(id, slot);
		if (id != null && item == null) {
			result.completeExceptionally(new Social.ServiceException("Dieses Cosmetic gibt es nicht."));
			return result;
		}
		if (item != null && item.teamOnly() && !team) {
			result.completeExceptionally(new Social.ServiceException("Dieses Cosmetic gibt es nur für das HeldixClient-Team."));
			return result;
		}
		Social.putCosmetic(slot, id).whenComplete((json, error) -> {
			if (error != null) {
				Throwable cause = error instanceof java.util.concurrent.CompletionException && error.getCause() != null ? error.getCause() : error;
				result.completeExceptionally(cause);
				return;
			}
			applyMine(json);
			result.complete(null);
		});
		return result;
	}

	/** Warum gerade nichts gewählt werden kann (deutsch), null = es geht */
	public static String serviceProblem() {
		return problemFor(Social.state());
	}

	/** Meldung für einen Zustand des Heldix-Dienstes (null = verbunden) */
	public static String problemFor(Social.State state) {
		return switch (state) {
			case ONLINE -> null;
			case OFFLINE_ACCOUNT -> "Cosmetics gibt es nur mit einem Microsoft-Konto. Mit einem Offline-Konto kann dich der Heldix-Dienst nicht anmelden.";
			case DISABLED -> "Der Heldix-Dienst ist in dieser Installation nicht eingerichtet – ohne ihn gibt es keine Cosmetics.";
			case OFF -> "Der Heldix-Dienst ist ausgeschaltet. Schalte ihn unter Freunde → Privatsphäre ein, um Cosmetics zu wählen.";
			case CONNECTING -> "Verbinde gerade mit dem Heldix-Dienst – versuch es gleich noch einmal.";
			case ERROR -> "Keine Verbindung zum Heldix-Dienst – versuch es gleich noch einmal.";
		};
	}

	// ======================================================================================
	// Vorschauen und Effekte (lokal, Addon-API)
	// ======================================================================================

	/** Eine laufende Vorschau */
	public interface PreviewHandle {
		void cancel();

		boolean isActive();
	}

	/**
	 * Zeigt ein Cosmetic lokal am eigenen Spieler, bis {@code seconds} vorbei sind, {@code cancel} läuft oder
	 * {@code alive} false wird (z. B. Addon abgeschaltet). Höchstens eine Stunde.
	 */
	public static PreviewHandle preview(String slot, String id, double seconds, BooleanSupplier alive) {
		long until = System.nanoTime() + (long) (Math.clamp(seconds, 0, 3600) * 1e9);
		Preview preview = new Preview(slot, id, until, alive);
		PREVIEWS.add(preview);
		return new PreviewHandle() {
			@Override
			public void cancel() {
				preview.cancelled = true;
				PREVIEWS.remove(preview);
			}

			@Override
			public boolean isActive() {
				return preview.active(System.nanoTime());
			}
		};
	}

	/** Kurzer Effekt am eigenen Cosmetic im Slot (flap, spin, bounce, burst) */
	public static void animate(String slot, String kind) {
		EFFECTS_BY_SLOT.put(slot, new Effect(kind, System.nanoTime()));
	}

	/** Laufender Effekt im Slot (null = keiner) */
	public static Effect effect(String slot) {
		Effect effect = EFFECTS_BY_SLOT.get(slot);
		if (effect == null) return null;
		if (effect.progress(System.nanoTime()) >= 1) {
			EFFECTS_BY_SLOT.remove(slot, effect);
			return null;
		}
		return effect;
	}

	/** Katalog neu geladen: im Haupt-Thread aufgerufen */
	static void catalogChanged() {
		CosmeticRenderer.catalogChanged();
		// ein gewähltes Katalog-Cape kennt syncProfile erst jetzt: dem Dienst noch einmal melden
		String cape = HeldixConfig.get().cape;
		if (cape != null && !cape.isEmpty() && !cape.startsWith("datei:") && !Capes.isBuiltin(cape)) Social.profileChanged();
	}

	/** Für Tests: alle Vorschauen und Effekte beenden */
	public static void clearLocal() {
		for (Preview preview : PREVIEWS) preview.cancelled = true;
		PREVIEWS.clear();
		EFFECTS_BY_SLOT.clear();
	}

	/** Anzahl aktiver Vorschauen (für Tests) */
	public static int previewCount() {
		long now = System.nanoTime();
		int count = 0;
		for (Preview preview : PREVIEWS) if (preview.active(now)) count++;
		return count;
	}
}
