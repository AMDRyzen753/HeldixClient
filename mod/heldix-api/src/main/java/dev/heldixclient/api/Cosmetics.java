package dev.heldixclient.api;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Heldix-Cosmetics ({@link HeldixApi#cosmetics()}): Hüte, Flügel, Partikel, Begleiter und Capes aus dem Katalog des
 * HeldixClient-Teams. Die Spieler wählen sie im Heldix-Menü, im Launcher oder auf der Webseite; alle
 * HeldixClient-Spieler sehen sie.
 *
 * <p>Ein Addon kann den Katalog und die Auswahl lesen, ein Cosmetic <b>nur für sich</b> als Vorschau zeigen und kurze
 * Effekte am eigenen Cosmetic auslösen. Die Auswahl ändern, andere Spieler beeinflussen oder Cosmetics an andere senden
 * kann es nicht – das bleibt beim Spieler und beim Heldix-Dienst. Ohne Heldix-Dienst ist der Katalog leer.
 *
 * <p>Alle Methoden dürfen aus jedem Thread aufgerufen werden. Wird vom HeldixClient bereitgestellt, nicht selbst
 * implementieren.
 *
 * @since 4
 */
public interface Cosmetics {
	/** Die Plätze für Cosmetics (wie beim Heldix-Dienst: head, back, aura, companion, cape). */
	enum Slot {
		/** Hüte &amp; Kopf: sitzt auf dem Kopf und folgt dem Blick */
		HEAD("head"),
		/** Flügel &amp; Rücken: am Rumpf auf Schulterhöhe */
		BACK("back"),
		/** Partikel rund um den Spieler */
		AURA("aura"),
		/** Begleiter, der neben dem Spieler schwebt */
		COMPANION("companion"),
		/** Cape (die eingebauten Heldix-Capes und die aus dem Katalog) */
		CAPE("cape");

		private final String id;

		Slot(String id) {
			this.id = id;
		}

		/** Name beim Heldix-Dienst, z. B. "head" */
		public String id() {
			return id;
		}

		/** Slot zum Namen beim Heldix-Dienst, z. B. "back" → {@link #BACK}; leer bei unbekannten Namen */
		public static Optional<Slot> of(String id) {
			for (Slot slot : values()) if (slot.id.equals(id)) return Optional.of(slot);
			return Optional.empty();
		}
	}

	/**
	 * Alle Cosmetics im Katalog, die HeldixClient geladen und geprüft hat (Signatur des Teams, alle Regeln des Formats),
	 * sortiert nach Slot und Name. Leer, solange der Katalog lädt oder ohne Heldix-Dienst. Die eingebauten Capes stehen
	 * nicht darin (ihre IDs: heldix, mitternacht, aurora, glut, kristall, neon, sakura, gewitter, galaxie, matrix,
	 * matrix_rot, matrix_tuerkis, sakura_orange).
	 */
	List<CosmeticInfo> catalog();

	/**
	 * Was ein Spieler in einem Slot trägt (die ID, z. B. "krone"). Für dich selbst deine Auswahl; für andere, was der
	 * Heldix-Dienst beim Nachschlagen gemeldet hat (nur HeldixClient-Spieler in der Nähe oder in der Tab-Liste, die
	 * „Für andere erkennbar“ an haben). Leer = nichts oder unbekannt. Beim Cape auch eingebaute Capes.
	 */
	Optional<String> worn(UUID player, Slot slot);

	/** Deine eigene Auswahl je Slot (nur belegte Slots; ohne Vorschauen). Ein eigenes Cape-Bild zählt nicht. */
	Map<Slot, String> mine();

	/**
	 * Zeigt ein Cosmetic nur bei dir, z. B. als Vorschau in einem Addon-Menü: an deinem Spieler in der
	 * Third-Person-Ansicht, im Inventar und an den Figuren im Heldix-Menü. Niemand sonst sieht es, und deine Auswahl beim
	 * Dienst bleibt, wie sie ist. Die Vorschau endet nach {@code duration} (höchstens eine Stunde), mit
	 * {@link Registration#cancel()} oder wenn das Addon abgeschaltet wird. Laufen mehrere Vorschauen im selben Slot, gilt
	 * die jüngste.
	 *
	 * @param id ID aus {@link #catalog()} für diesen Slot; beim Cape auch ein eingebautes Cape
	 * @throws IllegalArgumentException wenn es das Cosmetic in diesem Slot nicht gibt oder die Dauer nicht positiv ist
	 */
	Registration preview(Slot slot, String id, Duration duration);

	/**
	 * Kurzer Effekt (etwa 1,6 Sekunden) an deinem eigenen Cosmetic, nur bei dir zu sehen:
	 * <ul>
	 *   <li>{@code "flap"} – Flügel schlagen doppelt so schnell ({@link Slot#BACK})</li>
	 *   <li>{@code "spin"} – einmal um die Hochachse drehen ({@link Slot#HEAD}, {@link Slot#BACK}, {@link Slot#COMPANION})</li>
	 *   <li>{@code "bounce"} – kurz hüpfen ({@link Slot#HEAD}, {@link Slot#BACK}, {@link Slot#COMPANION})</li>
	 *   <li>{@code "burst"} – ein Schwall zusätzlicher Partikel ({@link Slot#AURA}, höchstens 64 gleichzeitig)</li>
	 * </ul>
	 * Ein neuer Effekt im selben Slot ersetzt den laufenden. Trägst du in dem Slot nichts, passiert nichts.
	 *
	 * @throws IllegalArgumentException bei einem unbekannten Effekt oder einem, den es für diesen Slot nicht gibt
	 */
	void animate(Slot slot, String animation);

	/**
	 * Listener für Änderungen deiner eigenen Auswahl (im Heldix-Menü, im Launcher oder auf der Webseite gewählt – letztere
	 * kommen beim nächsten Abgleich mit dem Dienst an). Läuft im Haupt-Thread; Fehler zählen wie alle Addon-Fehler.
	 * Vorschauen lösen keine Änderung aus.
	 *
	 * @return zum Abmelden
	 */
	Registration onChange(Consumer<CosmeticChange> listener);
}
