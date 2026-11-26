package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixColors;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudCanvas.TextStyle;
import dev.heldixclient.api.HudClick;
import dev.heldixclient.api.HudHover;
import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.HudStyle;

import java.nio.file.Path;

/**
 * Das HUD-Element des Spotify-Addons in drei Darstellungen: Kompakt, Groß mit Cover und Nur Titel.
 * Im HUD-Editor erscheint ein Beispielsong, damit man die echte Größe sieht.
 *
 * <p>Ab API 5 passt es sich dem HUD-Stil an (Fläche, Deckkraft, Rahmen, Schrift) und ist bei offenem Chat bzw. mit der
 * Taste „HUD bedienen“ bedienbar: Knöpfe für Zurück, Abspielen/Pause und Weiter, Klick auf die Zeitleiste springt an
 * die Stelle, Klick auf den Titel zeigt den Song im Chat (mit Umschalt: in die Chat-Eingabe einfügen).
 */
final class SpotifyHud implements HudRenderer {
	private static final int TRACK_BG = 0x2EFFFFFF;
	private static final int PAUSED = 0xFF7A8496;
	static final int COMPACT = 0;
	static final int LARGE = 1;
	static final int TITLE_ONLY = 2;
	/** Knöpfe, solange das HUD bedienbar ist */
	static final String PREVIOUS = "previous";
	static final String PLAY_PAUSE = "play-pause";
	static final String NEXT = "next";
	static final String TITLE = "title";
	static final String PROGRESS = "progress";

	private final SpotifyAddon addon;
	/** Akzentfarbe aus dem Cover: je Datei einmal berechnen */
	private Path accentCover;
	private int accentFromCover;
	/** Zeitleiste im letzten Bild {x, Breite} für Klicks */
	private float progressX;
	private float progressWidth;

	SpotifyHud(SpotifyAddon addon) {
		this.addon = addon;
	}

	@Override
	public void render(HudCanvas c) {
		boolean preview = c.isPreview();
		progressWidth = 0;
		if (!addon.showHud.getAsBoolean() && !preview) return;
		long now = System.currentTimeMillis();
		Track track = addon.track();
		boolean sample = false;
		if (track == null && preview) {
			track = new Track("Spotify", true, "Songtitel, der etwas länger ist", "Künstler", "Album", 74_000, 196_000, now, null,
					Boolean.FALSE, Track.Repeat.OFF, true);
			sample = true;
		}
		int layout = addon.layout.getAsInt();
		if (track == null) {
			if (!addon.hideIdle.getAsBoolean()) drawIdle(c, layout);
			return;
		}
		boolean playing = sample || addon.playing(track, now);
		if (!preview && addon.hidePaused.getAsBoolean() && !playing && addon.pausedSince > 0 && now - addon.pausedSince > SpotifyAddon.HIDE_PAUSED_MS) return;
		long position = sample ? track.position(now) % track.durationMs() : addon.position(track, now);
		int accent = accent(c, track);
		switch (layout) {
			case LARGE -> drawLarge(c, track, playing, position, accent, now);
			case TITLE_ONLY -> drawTitleOnly(c, track, playing, position, accent, now);
			default -> drawCompact(c, track, playing, position, accent, now);
		}
	}

	// --- Bedienen (API 5) -----------------------------------------------------------------------

	@Override
	public boolean onClick(HudClick click) {
		if (click.button() != HudClick.LEFT) return false;
		switch (click.hotspot()) {
			case PLAY_PAUSE -> addon.playPause();
			case NEXT -> addon.next();
			case PREVIOUS -> addon.previous();
			case PROGRESS -> {
				Track track = addon.track();
				if (track == null || progressWidth <= 0 || !track.canSeek()) return false;
				float fraction = Math.max(0f, Math.min(1f, (click.x() - progressX) / progressWidth));
				long now = System.currentTimeMillis();
				addon.seek((long) (fraction * track.durationMs()) - addon.position(track, now));
			}
			case TITLE -> {
				Track track = addon.track();
				if (click.shift() && track != null && click.insertIntoChat("🎵 " + track.line())) return true;
				addon.showNowPlaying();
			}
			default -> {
				return false;
			}
		}
		return true;
	}

	@Override
	public void onHover(HudHover hover) {
		if (hover.hotspot().isEmpty()) {
			Track track = addon.track();
			hover.tooltip(track == null ? addon.idleMessage() : track.line(), "Rechtsklick: Einstellungen");
		}
	}

	private String playTooltip(Track track, boolean playing) {
		if (track == null) return "Abspielen/Pause\n" + addon.idleMessage();
		return playing ? "Pause" : "Abspielen";
	}

	/** Zurück, Abspielen/Pause, Weiter nebeneinander ab x; Breite: 3 × size + 2 × gap */
	private void controls(HudCanvas c, float x, float y, float size, Track track, boolean playing, int accent) {
		float gap = 2;
		boolean ready = track != null;
		int color = ready ? c.style().textColor() : HeldixColors.FAINT;
		c.iconButton(PREVIOUS, "skip-previous", x, y, size, color, ready ? "Vorheriger Song" : addon.idleMessage());
		c.iconButton(PLAY_PAUSE, playing ? "pause" : "play", x + size + gap, y, size, ready ? accent : color, playTooltip(track, playing));
		c.iconButton(NEXT, "skip-next", x + 2 * (size + gap), y, size, color, ready ? "Nächster Song" : addon.idleMessage());
	}

	static float controlsWidth(float size) {
		return 3 * size + 4;
	}

	// --- Farben ---------------------------------------------------------------------------------

	private int accent(HudCanvas c, Track track) {
		return switch (addon.accentMode.getAsInt()) {
			case 1 -> {
				Path cover = track.cover();
				if (cover == null) yield SpotifyAddon.GREEN;
				if (!cover.equals(accentCover)) {
					int color = c.imageColor(cover);
					if (color == 0) yield SpotifyAddon.GREEN;
					accentCover = cover;
					accentFromCover = readable(color);
				}
				yield accentFromCover;
			}
			case 2 -> addon.accentColor.getAsInt() | 0xFF000000;
			case 3 -> c.style().accent();
			default -> SpotifyAddon.GREEN;
		};
	}

	/** Coverfarben sind oft dunkel: so weit aufhellen, dass sie auf der dunklen Karte gut zu sehen sind */
	static int readable(int color) {
		int r = (color >> 16) & 0xFF;
		int g = (color >> 8) & 0xFF;
		int b = color & 0xFF;
		double luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
		if (luminance < 0.45) {
			double t = Math.min(0.7, (0.45 - luminance) / (1 - luminance) * 1.4);
			r = (int) Math.round(r + (255 - r) * t);
			g = (int) Math.round(g + (255 - g) * t);
			b = (int) Math.round(b + (255 - b) * t);
		}
		return 0xFF000000 | (r << 16) | (g << 8) | b;
	}

	private static int soft(int color) {
		return (color & 0xFFFFFF) | 0x2E000000;
	}

	/**
	 * Fläche im HUD-Stil; beim Heldix-Stil mit etwas runderen Ecken (Karte). Ohne Hintergrund (z. B. Stil „Minimal“)
	 * bleibt eine leichte, dunkle Fläche: Cover, Zeitleiste und kleine Schrift wären sonst auf hellem Grund kaum zu lesen.
	 */
	private static void card(HudCanvas c, int width, int height, float radius) {
		HudStyle style = c.style();
		if (style.background() == 0) {
			c.roundedRect(0, 0, width, height, style.kind() == HudStyle.Kind.CLASSIC ? 1 : radius, 0x59000000);
			if (style.border()) c.roundedOutline(0, 0, width, height, radius, style.borderColor());
			return;
		}
		if (style.kind() != HudStyle.Kind.HELDIX) {
			c.panel(0, 0, width, height);
			return;
		}
		c.roundedRect(0, 0, width, height, radius, style.background());
		if (style.border()) c.roundedOutline(0, 0, width, height, radius, style.borderColor());
	}

	// --- Texte ----------------------------------------------------------------------------------

	/** langer Titel: Laufschrift oder „…“ je nach Einstellung */
	private void fitText(HudCanvas c, String text, int x, int y, int width, int color, TextStyle style) {
		if (addon.overflow.getAsInt() == 0) c.scrollingText(text, x, y, width, color, style);
		else c.text(c.ellipsize(text, width, style), x, y, color, style);
	}

	static String time(long millis) {
		long seconds = Math.max(0, millis / 1000);
		long hours = seconds / 3600;
		long minutes = (seconds % 3600) / 60;
		long secs = seconds % 60;
		return hours > 0 ? String.format("%d:%02d:%02d", hours, minutes, secs) : String.format("%d:%02d", minutes, secs);
	}

	// --- Darstellungen ----------------------------------------------------------------------------

	private void drawIdle(HudCanvas c, int layout) {
		String message = addon.idleMessage();
		int text = c.style().textColor();
		boolean controls = c.interactive();
		if (layout == TITLE_ONLY) {
			int width = Math.min(200, c.textWidth(message, TextStyle.SMALL) + 30);
			card(c, width, 18, 7);
			c.icon("music", 6, 4, 10, SpotifyAddon.GREEN);
			c.text(c.ellipsize(message, width - 30, TextStyle.SMALL), 21, 5, HeldixColors.MUTED, TextStyle.SMALL);
			c.hotspot("", 0, 0, width, 18, message);
			return;
		}
		int width = layout == LARGE ? 230 : 172;
		int h = 30;
		card(c, width, h, 8);
		c.roundedRect(6, 6, 18, 18, 5, soft(SpotifyAddon.GREEN));
		c.icon("music", 9, 9, 12, SpotifyAddon.GREEN);
		c.text("Spotify", 30, 6, text, TextStyle.BOLD);
		int right = controls ? (int) (width - 8 - controlsWidth(12)) - 4 : width - 8;
		c.text(c.ellipsize(message, right - 30, TextStyle.SMALL), 30, 17, HeldixColors.MUTED, TextStyle.SMALL);
		if (controls) controls(c, width - 8 - controlsWidth(12), 9, 12, null, false, SpotifyAddon.GREEN);
	}

	/** Cover (oder Platzhalter) mit Pause-Symbol darüber */
	private static void cover(HudCanvas c, Track track, int x, int y, int size, boolean playing, int accent) {
		boolean drawn = track.cover() != null && c.image(track.cover(), x, y, size, size);
		if (!drawn) {
			c.roundedRect(x, y, size, size, Math.max(4, size / 6f), soft(accent));
			int icon = size / 2;
			c.icon("music", x + (size - icon) / 2, y + (size - icon) / 2, icon, accent);
		}
		if (!playing) {
			c.roundedRect(x, y, size, size, Math.max(4, size / 6f), 0x99000000);
			int icon = size >= 48 ? 20 : size >= 30 ? 14 : 12;
			c.icon("pause", x + (size - icon) / 2, y + (size - icon) / 2, icon, 0xFFFFFFFF);
		}
	}

	private void drawCompact(HudCanvas c, Track track, boolean playing, long position, int accent, long now) {
		int width = 172;
		boolean cover = addon.showCover.getAsBoolean();
		boolean progress = addon.showProgress.getAsBoolean() && track.durationMs() > 0;
		boolean controls = c.interactive();
		int h = progress ? 44 : 36;
		int coverSize = progress ? 32 : 24;
		card(c, width, h, 9);
		int text = c.style().textColor();

		int tx = 9;
		if (cover) {
			cover(c, track, 6, (h - coverSize) / 2, coverSize, playing, accent);
			tx = 6 + coverSize + 7;
		}
		int titleY = progress ? 7 : 8;
		// rechts oben: Equalizer bzw. (bedienbar) die drei Knöpfe
		int right = width - 8;
		int titleRight;
		if (controls) {
			float size = 12;
			float cx = right - controlsWidth(size);
			controls(c, cx, titleY - 2, size, track, playing, accent);
			titleRight = (int) cx - 4;
		} else {
			int barsX = right - 9;
			equalizer(c, barsX, titleY, playing, now, accent);
			titleRight = barsX - 5;
		}
		fitText(c, track.title(), tx, titleY, titleRight - tx, text, TextStyle.BOLD);
		fitText(c, track.byline(), tx, titleY + 12, (controls ? titleRight : right) - tx, HeldixColors.MUTED, TextStyle.SMALL);
		c.hotspot(TITLE, tx, titleY - 1, titleRight - tx, 22, track.line() + "\nKlick: im Chat anzeigen · Umschalt+Klick: in die Eingabe");
		if (progress) timeline(c, tx, 31, right, position, track, playing, accent);
	}

	private void drawLarge(HudCanvas c, Track track, boolean playing, long position, int accent, long now) {
		int width = 230;
		boolean cover = addon.showCover.getAsBoolean();
		boolean progress = addon.showProgress.getAsBoolean() && track.durationMs() > 0;
		boolean controls = c.interactive();
		int h = progress ? 80 : 64;
		int coverSize = h - 16;
		card(c, width, h, 11);
		int text = c.style().textColor();
		// feine Linie in der Akzentfarbe oben, nach rechts auslaufend
		c.gradientRect(12, 0, width - 24, 1, accent, accent & 0x00FFFFFF, true);

		int tx = 10;
		if (cover) {
			cover(c, track, 8, 8, coverSize, playing, accent);
			tx = 8 + coverSize + 10;
		}
		int right = width - 10;
		// Kopfzeile: Player, rechts Zufall/Wiederholen und Equalizer bzw. (bedienbar) die drei Knöpfe
		int iconsX;
		if (controls) {
			float size = 13;
			iconsX = (int) (right - controlsWidth(size));
			controls(c, iconsX, 4, size, track, playing, accent);
		} else {
			iconsX = right - 9;
			equalizer(c, iconsX, 9, playing, now, accent);
			if (track.repeat() != null) {
				iconsX -= 13;
				int color = track.repeat() == Track.Repeat.OFF ? HeldixColors.FAINT : accent;
				c.icon("refresh", iconsX, 9, 9, color);
				if (track.repeat() == Track.Repeat.TRACK) c.text("1", iconsX + 7, 12, color, TextStyle.SMALL);
			}
			if (track.shuffle() != null) {
				iconsX -= 13;
				shuffleIcon(c, iconsX, 9, 9, track.shuffle() ? accent : HeldixColors.FAINT);
			}
		}
		String app = track.app().isEmpty() ? "Spotify" : track.app();
		c.text(c.ellipsize(app.toUpperCase(java.util.Locale.ROOT), iconsX - 6 - tx, TextStyle.SMALL), tx, 9, HeldixColors.FAINT, TextStyle.SMALL);

		fitText(c, track.title(), tx, 21, right - tx, text, TextStyle.TITLE);
		fitText(c, track.artist().isEmpty() ? track.byline() : track.artist(), tx, 36, right - tx, HeldixColors.MUTED, TextStyle.BODY);
		if (!track.album().isEmpty() && !track.album().equals(track.title())) {
			c.text(c.ellipsize(track.album(), right - tx, TextStyle.SMALL), tx, 48, HeldixColors.FAINT, TextStyle.SMALL);
		}
		c.hotspot(TITLE, tx, 20, right - tx, 36, track.line() + "\nKlick: im Chat anzeigen · Umschalt+Klick: in die Eingabe");
		if (progress) {
			float fraction = Math.max(0f, Math.min(1f, position / (float) track.durationMs()));
			boolean hover = c.hovered(tx, 58, right - tx, 9);
			c.progressBar(tx, hover ? 60.5f : 61, right - tx, hover ? 4 : 3, fraction, TRACK_BG, playing ? accent : PAUSED);
			progressHotspot(c, tx, 57, right - tx, 10, track);
			c.text(time(position), tx, 67, HeldixColors.FAINT, TextStyle.SMALL);
			String total = time(track.durationMs());
			c.text(total, right - c.textWidth(total, TextStyle.SMALL), 67, HeldixColors.FAINT, TextStyle.SMALL);
		}
	}

	private void drawTitleOnly(HudCanvas c, Track track, boolean playing, long position, int accent, long now) {
		boolean progress = addon.showProgress.getAsBoolean() && track.durationMs() > 0;
		boolean controls = c.interactive();
		String text = track.line();
		int textWidth = Math.max(90, Math.min(200, c.textWidth(text, TextStyle.BOLD) + 30));
		int extra = controls ? (int) controlsWidth(11) + 4 : 0;
		int width = textWidth + extra;
		int h = 18;
		card(c, width, h, 7);
		equalizer(c, 7, 5, playing, now, accent);
		fitText(c, text, 21, 5, textWidth - 21 - 7, playing ? c.style().textColor() : HeldixColors.MUTED, TextStyle.BOLD);
		c.hotspot(TITLE, 0, 0, textWidth, h, text + "\nKlick: im Chat anzeigen · Umschalt+Klick: in die Eingabe");
		if (controls) controls(c, textWidth - 2, 3.5f, 11, track, playing, accent);
		if (progress) {
			float fraction = Math.max(0f, Math.min(1f, position / (float) track.durationMs()));
			c.progressBar(7, h - 3, textWidth - 14, 1.5f, fraction, 0x1AFFFFFF, playing ? accent : PAUSED);
		}
	}

	/** Zeitleiste als klickbarer Bereich (nur bei Playern, die spulen können) */
	private void progressHotspot(HudCanvas c, float x, float y, float width, float height, Track track) {
		progressX = x;
		progressWidth = width;
		if (track.canSeek()) c.hotspot(PROGRESS, x, y, width, height, "Klick: an diese Stelle springen");
	}

	/** Zeit links, Balken, Länge rechts */
	private void timeline(HudCanvas c, int x, int y, int right, long position, Track track, boolean playing, int accent) {
		long duration = track.durationMs();
		String elapsed = time(position);
		String total = time(duration);
		int elapsedWidth = c.textWidth(elapsed, TextStyle.SMALL);
		int totalWidth = c.textWidth(total, TextStyle.SMALL);
		c.text(elapsed, x, y, HeldixColors.FAINT, TextStyle.SMALL);
		c.text(total, right - totalWidth, y, HeldixColors.FAINT, TextStyle.SMALL);
		float barX = x + elapsedWidth + 5;
		float barWidth = right - totalWidth - 5 - barX;
		if (barWidth > 8) {
			float fraction = Math.max(0f, Math.min(1f, position / (float) duration));
			boolean hover = c.hovered(barX, y - 1, barWidth, 9);
			c.progressBar(barX, y + (hover ? 2 : 2.5f), barWidth, hover ? 4 : 3, fraction, TRACK_BG, playing ? accent : PAUSED);
			progressHotspot(c, barX, y - 2, barWidth, 11, track);
		}
	}

	/** drei kleine Balken, die sich (ungefähr) im Takt bewegen; bei Pause flach */
	private static void equalizer(HudCanvas c, int x, int y, boolean playing, long now, int accent) {
		int height = 8;
		for (int i = 0; i < 3; i++) {
			float h;
			if (playing) {
				double t = now / 1000.0;
				double wave = Math.sin(t * (5.1 + i * 1.7) + i * 1.9) * 0.5 + Math.sin(t * (2.3 + i * 0.9) + i) * 0.5;
				h = (float) (2.5 + (wave * 0.5 + 0.5) * (height - 2.5));
			} else {
				h = 2;
			}
			c.roundedRect(x + i * 3.5f, y + height - h, 2, h, 1, playing ? accent : HeldixColors.FAINT);
		}
	}

	/** Zufalls-Symbol aus zwei gekreuzten Pfeilen (gibt es im Icon-Set nicht) */
	private static void shuffleIcon(HudCanvas c, float x, float y, float s, int color) {
		float top = y + s * 0.22f;
		float bottom = y + s * 0.78f;
		c.line(x, top, x + s, bottom, 1, color);
		c.line(x, bottom, x + s, top, 1, color);
		float head = s * 0.3f;
		c.line(x + s - head, top, x + s, top, 1, color);
		c.line(x + s, top, x + s, top + head, 1, color);
		c.line(x + s - head, bottom, x + s, bottom, 1, color);
		c.line(x + s, bottom, x + s, bottom - head, 1, color);
	}
}
