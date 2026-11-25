package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixColors;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudCanvas.TextStyle;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;

import java.nio.file.Path;
import java.util.Locale;
import java.util.Objects;
import java.util.function.BooleanSupplier;

/**
 * Spotify-Addon für HeldixClient:
 * <ul>
 *   <li>HUD-Element mit Cover, Titel, Künstler und Fortschritt des laufenden Songs</li>
 *   <li>Tasten für Abspielen/Pause, nächsten und vorherigen Song (Pos1, Bild ab, Bild auf)</li>
 *   <li>kurze Einblendung bei jedem Songwechsel</li>
 * </ul>
 * Die Daten kommen aus der Windows-Mediensteuerung (siehe {@link MediaBridge}) – keine Anmeldung nötig.
 */
public final class SpotifyAddon implements HeldixAddon {
	static final int GREEN = 0xFF1DB954;
	private static final int GREEN_SOFT = 0x2E1DB954;
	private static final int CARD = 0xDC0E131E;
	private static final int WIDTH = 172;
	private static final int COVER = 32;

	private HeldixApi api;
	private MediaBridge bridge;
	private ModuleHandle module;
	private boolean windows;

	private BooleanSupplier onlySpotify;
	private BooleanSupplier showHud;
	private BooleanSupplier showCover;
	private BooleanSupplier showProgress;
	private BooleanSupplier announce;
	private BooleanSupplier hideIdle;

	/** Songwechsel erkennen (erst nach der ersten Antwort, damit beim Start keine Einblendung kommt) */
	private boolean primed;
	private String lastKey;
	private String announcedKey;
	private Path announcedCover;
	private long announcedAt;

	@Override
	public void onEnable(HeldixApi api) {
		this.api = api;
		this.windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows");
		this.bridge = new MediaBridge(api.logger(), api.dataDirectory());

		module = api.registerHudModule(ModuleSpec.of("spotify", "Spotify", "Song im HUD, Musik per Taste").at(4, 140).withIcon("music"), this::render);
		showHud = module.addToggle("show-hud", "Im HUD anzeigen", "Aus: nur Tasten und Einblendungen, kein HUD-Element", true);
		showCover = module.addToggle("cover", "Cover anzeigen", "Album-Cover links im HUD-Element", true);
		showProgress = module.addToggle("progress", "Fortschritt anzeigen", "Zeitleiste mit Spielzeit und Länge des Songs", true);
		announce = module.addToggle("announce", "Songwechsel einblenden", "Kurze Einblendung oben rechts bei jedem neuen Song", true);
		hideIdle = module.addToggle("hide-idle", "Ohne Musik ausblenden", "HUD-Element nur zeigen, wenn ein Song geladen ist", false);
		onlySpotify = module.addToggle("only-spotify", "Nur Spotify", "Aus: auch andere Player steuern, z. B. Browser oder VLC", true);
		module.addAction("Abspielen / Pause", "Standardtaste: Pos1", "Umschalten", this::playPause);
		module.addAction("Nächster Song", "Standardtaste: Bild ab", "Weiter", () -> command(bridge::next));
		module.addAction("Vorheriger Song", "Standardtaste: Bild auf", "Zurück", () -> command(bridge::previous));

		api.registerKey("play-pause", "Abspielen/Pause", HeldixKeys.HOME, this::playPause);
		api.registerKey("next", "Nächster Song", HeldixKeys.PAGE_DOWN, () -> command(bridge::next));
		api.registerKey("previous", "Vorheriger Song", HeldixKeys.PAGE_UP, () -> command(bridge::previous));

		module.onToggle(enabled -> {
			if (enabled) startBridge(); else bridge.stop();
		});
		api.events().onTick(this::tick);
		if (module.isEnabled()) startBridge();

		if (!windows) api.logger().warn("Das Spotify-Addon braucht die Windows-Mediensteuerung und ist auf diesem System inaktiv.");
	}

	@Override
	public void onDisable() {
		if (bridge != null) bridge.stop();
	}

	private void startBridge() {
		if (!windows) return;
		bridge.setAnyPlayer(!onlySpotify.getAsBoolean());
		bridge.start();
	}

	// --- Steuerung ----------------------------------------------------------------------------

	private void playPause() {
		if (!ready()) return;
		MediaBridge.Track track = bridge.track();
		if (track == null) {
			api.notify("Spotify", "Spotify öffnen und einen Song starten");
			return;
		}
		boolean willPlay = !bridge.playing(track, System.currentTimeMillis());
		bridge.playPause();
		// ohne HUD-Element ist die Einblendung die einzige Rückmeldung
		if (!showHud.getAsBoolean()) api.notify(willPlay ? "Wiedergabe" : "Pausiert", track.title(), track.cover());
	}

	private void command(Runnable action) {
		if (!ready()) return;
		if (bridge.track() == null) {
			api.notify("Spotify", "Spotify öffnen und einen Song starten");
			return;
		}
		action.run();
	}

	private boolean ready() {
		if (!windows) {
			api.notify("Spotify", "Nur unter Windows verfügbar");
			return false;
		}
		if (!module.isEnabled()) {
			api.notify("Spotify ist aus", "Im Heldix-Menü unter Module einschalten");
			return false;
		}
		return true;
	}

	private void tick() {
		if (!module.isEnabled() || !bridge.running()) return;
		bridge.setAnyPlayer(!onlySpotify.getAsBoolean());
		if (!bridge.connected()) return;

		MediaBridge.Track track = bridge.track();
		String key = track != null ? track.key() : null;
		long now = System.currentTimeMillis();
		if (!Objects.equals(key, lastKey)) {
			if (primed && track != null && announce.getAsBoolean()) announce(track, now);
			lastKey = key;
		} else if (track != null && key.equals(announcedKey) && now - announcedAt < 4000 && !Objects.equals(track.cover(), announcedCover)) {
			// Windows liefert das Cover oft erst kurz nach dem Titel: Einblendung damit auffrischen
			announce(track, announcedAt);
		}
		primed = true;
	}

	private void announce(MediaBridge.Track track, long at) {
		api.notify(track.title(), byline(track), track.cover());
		announcedKey = track.key();
		announcedCover = track.cover();
		announcedAt = at;
	}

	private static String byline(MediaBridge.Track track) {
		if (!track.artist().isEmpty()) return track.artist();
		if (!track.album().isEmpty()) return track.album();
		return track.app();
	}

	// --- HUD ----------------------------------------------------------------------------------

	private void render(HudCanvas canvas) {
		boolean preview = canvas.isPreview();
		if (!showHud.getAsBoolean() && !preview) return;
		long now = System.currentTimeMillis();
		MediaBridge.Track track = windows ? bridge.track() : null;
		if (track == null && preview) {
			// Beispiel im HUD-Editor, damit man die echte Größe sieht
			track = new MediaBridge.Track("Spotify", "Playing", "Songtitel", "Künstler", "Album", 74_000, 196_000, now, null);
		}
		if (track == null) {
			if (!hideIdle.getAsBoolean()) drawIdle(canvas);
			return;
		}
		drawTrack(canvas, track, now, preview);
	}

	private void drawIdle(HudCanvas c) {
		String message;
		if (!windows) {
			message = "Nur unter Windows verfügbar";
		} else if (bridge.failures() >= 2) {
			message = "Windows-Mediensteuerung nicht erreichbar";
		} else if (!bridge.connected()) {
			message = "Verbinde …";
		} else if (onlySpotify.getAsBoolean()) {
			// ohne laufende Sitzung kann Windows Spotify nicht fernsteuern: erst in Spotify selbst starten
			message = "Spotify öffnen und Musik starten";
		} else {
			message = "Kein Player aktiv";
		}
		int h = 30;
		c.roundedRect(0, 0, WIDTH, h, 8, CARD);
		c.roundedOutline(0, 0, WIDTH, h, 8, HeldixColors.LINE);
		c.roundedRect(6, 6, 18, 18, 5, GREEN_SOFT);
		c.icon("music", 9, 9, 12, GREEN);
		c.text("Spotify", 30, 6, HeldixColors.TEXT, TextStyle.BOLD);
		c.text(c.ellipsize(message, WIDTH - 30 - 8, TextStyle.SMALL), 30, 17, HeldixColors.MUTED, TextStyle.SMALL);
	}

	private void drawTrack(HudCanvas c, MediaBridge.Track track, long now, boolean preview) {
		boolean playing = preview && bridge.track() == null || bridge.playing(track, now);
		boolean cover = showCover.getAsBoolean();
		boolean progress = showProgress.getAsBoolean() && track.durationMs() > 0;
		int h = progress ? 44 : 36;
		int coverSize = progress ? COVER : 24;
		c.roundedRect(0, 0, WIDTH, h, 9, CARD);
		c.roundedOutline(0, 0, WIDTH, h, 9, HeldixColors.LINE);

		int tx = 9;
		if (cover) {
			int cy = (h - coverSize) / 2;
			boolean drawn = track.cover() != null && c.image(track.cover(), 6, cy, coverSize, coverSize);
			if (!drawn) {
				c.roundedRect(6, cy, coverSize, coverSize, 5, GREEN_SOFT);
				int icon = coverSize / 2;
				c.icon("music", 6 + (coverSize - icon) / 2, cy + (coverSize - icon) / 2, icon, GREEN);
			}
			if (!playing) {
				c.roundedRect(6, cy, coverSize, coverSize, 5, 0x99000000);
				int icon = coverSize >= 30 ? 14 : 12;
				c.icon("pause", 6 + (coverSize - icon) / 2, cy + (coverSize - icon) / 2, icon, 0xFFFFFFFF);
			}
			tx = 6 + coverSize + 7;
		}

		// Equalizer-Balken rechts oben: bewegen sich, solange Musik läuft
		int barsX = WIDTH - 8 - 9;
		equalizer(c, barsX, progress ? 7 : 8, playing, now);
		int textWidth = barsX - 5 - tx;
		int titleY = progress ? 7 : 8;
		c.text(c.ellipsize(track.title(), textWidth, TextStyle.BOLD), tx, titleY, HeldixColors.TEXT, TextStyle.BOLD);
		c.text(c.ellipsize(byline(track), WIDTH - 8 - tx, TextStyle.SMALL), tx, titleY + 12, HeldixColors.MUTED, TextStyle.SMALL);

		if (progress) {
			long position = bridge.track() == null ? track.positionMs() : bridge.position(track, now);
			String elapsed = time(position);
			String total = time(track.durationMs());
			int elapsedWidth = c.textWidth(elapsed, TextStyle.SMALL);
			int totalWidth = c.textWidth(total, TextStyle.SMALL);
			int y = 31;
			c.text(elapsed, tx, y, HeldixColors.FAINT, TextStyle.SMALL);
			c.text(total, WIDTH - 8 - totalWidth, y, HeldixColors.FAINT, TextStyle.SMALL);
			float barX = tx + elapsedWidth + 5;
			float barWidth = WIDTH - 8 - totalWidth - 5 - barX;
			if (barWidth > 8) {
				float fraction = Math.max(0f, Math.min(1f, position / (float) track.durationMs()));
				c.roundedRect(barX, y + 2.5f, barWidth, 3, 1.5f, 0x2EFFFFFF);
				if (fraction > 0) c.roundedRect(barX, y + 2.5f, Math.max(3, barWidth * fraction), 3, 1.5f, playing ? GREEN : 0xFF7A8496);
			}
		}
	}

	/** drei kleine Balken, die sich im Takt (ungefähr) bewegen; bei Pause flach */
	private static void equalizer(HudCanvas c, int x, int y, boolean playing, long now) {
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
			c.roundedRect(x + i * 3.5f, y + height - h, 2, h, 1, playing ? GREEN : HeldixColors.FAINT);
		}
	}

	private static String time(long millis) {
		long seconds = Math.max(0, millis / 1000);
		long hours = seconds / 3600;
		long minutes = (seconds % 3600) / 60;
		long secs = seconds % 60;
		return hours > 0 ? String.format("%d:%02d:%02d", hours, minutes, secs) : String.format("%d:%02d", minutes, secs);
	}
}
