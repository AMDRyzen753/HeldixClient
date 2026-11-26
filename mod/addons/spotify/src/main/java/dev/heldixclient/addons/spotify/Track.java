package dev.heldixclient.addons.spotify;

import java.nio.file.Path;

/**
 * Ein Song, wie ihn das System meldet. Positionen in Millisekunden.
 *
 * @param app       Name des Players, z. B. "Spotify" oder "Chrome"
 * @param updatedAt Zeitpunkt (System.currentTimeMillis), zu dem positionMs galt
 * @param cover     PNG-Datei des Covers oder null
 * @param shuffle   Zufallswiedergabe an? (null = unbekannt bzw. kann der Player nicht)
 * @param repeat    Wiederholen (null = unbekannt bzw. kann der Player nicht)
 * @param canSeek   lässt sich die Position ändern (Vor-/Zurückspulen)?
 */
record Track(String app, boolean playing, String title, String artist, String album, long positionMs, long durationMs, long updatedAt,
		Path cover, Boolean shuffle, Repeat repeat, boolean canSeek) {

	enum Repeat {
		OFF, LIST, TRACK;

		/** Reihenfolge beim Umschalten: aus → Liste → Titel → aus */
		Repeat next(boolean trackSupported) {
			return switch (this) {
				case OFF -> LIST;
				case LIST -> trackSupported ? TRACK : OFF;
				case TRACK -> OFF;
			};
		}

		String label() {
			return switch (this) {
				case OFF -> "Wiederholen aus";
				case LIST -> "Wiederholt die Liste";
				case TRACK -> "Wiederholt den Song";
			};
		}
	}

	/** erkennt einen Songwechsel */
	String key() {
		return title + '\u0000' + artist + '\u0000' + album;
	}

	/** aktuelle Position: das System meldet sie nur ab und zu, dazwischen wird hochgezählt */
	long position(long now) {
		long position = positionMs;
		if (playing && updatedAt > 0) position += Math.max(0, now - updatedAt);
		return durationMs > 0 ? Math.min(position, durationMs) : Math.max(0, position);
	}

	/** „Künstler“, sonst Album, sonst Player */
	String byline() {
		if (!artist.isEmpty()) return artist;
		if (!album.isEmpty()) return album;
		return app;
	}

	/** „Titel – Künstler“ */
	String line() {
		return artist.isEmpty() ? title : title + " – " + artist;
	}

	Track withCover(Path newCover) {
		return new Track(app, playing, title, artist, album, positionMs, durationMs, updatedAt, newCover, shuffle, repeat, canSeek);
	}

	/** Text aus Skript-Ausgaben ohne Tabs und Zeilenumbrüche */
	static String clean(String text) {
		return text == null ? "" : text.replaceAll("[\\t\\r\\n]", " ").strip();
	}
}
