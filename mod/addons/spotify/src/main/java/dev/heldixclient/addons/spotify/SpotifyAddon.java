package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.CommandContext;
import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;

import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import java.util.function.BooleanSupplier;
import java.util.function.IntSupplier;

/**
 * Spotify-Addon für HeldixClient (API 6):
 * <ul>
 *   <li>HUD-Element in drei Darstellungen (Kompakt, Groß mit Cover, Nur Titel) mit Fortschritt und Akzentfarbe,
 *   im HUD-Stil und bei offenem Chat bedienbar (Knöpfe, Zeitleiste, Titel)</li>
 *   <li>Tasten für Abspielen/Pause, Songwechsel, Spulen, Zufallswiedergabe, Wiederholen und Teilen</li>
 *   <li>Chat-Befehle {@code .np} und {@code .spotify …}</li>
 *   <li>Einblendung bei jedem Songwechsel (einstellbar)</li>
 * </ul>
 * Die Daten kommen vom System (Windows-Mediensteuerung, AppleScript, MPRIS) – siehe {@link Player}. Keine Anmeldung.
 */
public final class SpotifyAddon implements HeldixAddon {
	static final int GREEN = 0xFF1DB954;
	/** Spulen per Taste und Befehl */
	private static final long SEEK_MS = 10_000;
	/** „Bei Pause ausblenden“: so lange pausiert, bis das Element verschwindet */
	static final long HIDE_PAUSED_MS = 10_000;

	HeldixApi api;
	Player player;
	Player.Os os;
	ModuleHandle module;

	IntSupplier layout;
	BooleanSupplier showHud;
	BooleanSupplier showCover;
	BooleanSupplier showProgress;
	IntSupplier accentMode;
	IntSupplier accentColor;
	IntSupplier overflow;
	BooleanSupplier hideIdle;
	BooleanSupplier hidePaused;
	BooleanSupplier announce;
	BooleanSupplier announceHiddenOnly;
	BooleanSupplier onlySpotify;

	/** seit wann pausiert (0 = spielt bzw. kein Song) */
	volatile long pausedSince;
	/** Songwechsel erkennen (erst nach der ersten Antwort, damit beim Start keine Einblendung kommt) */
	private boolean primed;
	private String lastKey;
	private String announcedKey;
	private Path announcedCover;
	private long announcedAt;
	private SpotifyHud hud;

	@Override
	public void onEnable(HeldixApi api) {
		this.api = api;
		this.os = Player.Os.current();
		this.player = Player.create(os, api.logger(), api.dataDirectory(), api::notify, task -> api.scheduler().runAsync(task));
		this.hud = new SpotifyHud(this);

		module = api.registerHudModule(ModuleSpec.of("spotify", "Spotify", "Song im HUD, Musik per Taste").at(4, 140).withIcon("music"), hud);
		// ab API 5: Stil-Optionen erscheinen auch im Rechtsklick-Menü des HUD-Editors
		layout = module.addStyleChoice("layout", "Darstellung", List.of("Kompakt", "Groß mit Cover", "Nur Titel"), 0);
		showHud = module.addToggle("show-hud", "Im HUD anzeigen", "Aus: nur Tasten und Einblendungen, kein HUD-Element", true);
		showCover = module.addStyleToggle("cover", "Cover anzeigen", true);
		showProgress = module.addStyleToggle("progress", "Fortschritt anzeigen", true);
		accentMode = module.addStyleChoice("accent", "Akzentfarbe", List.of("Spotify-Grün", "Aus dem Cover", "Eigene Farbe", "Wie das HUD"), 0);
		accentColor = module.addStyleColor("accent-color", "Eigene Farbe", GREEN);
		overflow = module.addChoice("overflow", "Lange Titel", "Laufschrift oder mit „…“ abkürzen", List.of("Laufschrift", "Abkürzen"), 0);
		hideIdle = module.addToggle("hide-idle", "Ohne Musik ausblenden", "HUD-Element nur zeigen, wenn ein Song geladen ist", false);
		hidePaused = module.addToggle("hide-paused", "Bei Pause ausblenden", "Nach 10 Sekunden Pause verschwindet das HUD-Element", false);
		announce = module.addToggle("announce", "Songwechsel einblenden", "Kurze Einblendung mit Cover oben rechts bei jedem neuen Song", true);
		announceHiddenOnly = module.addToggle("announce-hidden-only", "Einblendung nur ohne HUD-Element",
				"Nur einblenden, wenn das HUD-Element aus oder ausgeblendet ist (auch mit F1)", false);
		onlySpotify = module.addToggle("only-spotify", "Nur Spotify", "Aus: auch andere Player steuern, z. B. Browser oder VLC", true);
		module.addAction("Abspielen / Pause", "", "Umschalten", this::playPause);
		module.addAction("Nächster Song", "", "Weiter", () -> command(() -> player.next()));
		module.addAction("Vorheriger Song", "", "Zurück", () -> command(() -> player.previous()));
		module.addAction("Player wechseln", "Wenn mehrere Player laufen (Windows, „Nur Spotify“ aus)", "Wechseln", () -> command(() -> player.nextPlayer()));

		// ab API 6: die Tasten stehen zusätzlich im Untermenü des Moduls unter „Tasten“ (dort umbelegbar)
		module.showKey(api.registerKey("play-pause", "Abspielen/Pause", HeldixKeys.HOME, this::playPause), "Abspielen/Pause", "");
		module.showKey(api.registerKey("next", "Nächster Song", HeldixKeys.PAGE_DOWN, () -> command(() -> player.next())), "Nächster Song", "");
		module.showKey(api.registerKey("previous", "Vorheriger Song", HeldixKeys.PAGE_UP, () -> command(() -> player.previous())), "Vorheriger Song", "");
		module.showKey(api.registerKey("seek-forward", "10 Sekunden vor", HeldixKeys.NONE, () -> seek(SEEK_MS)), "10 Sekunden vor", "");
		module.showKey(api.registerKey("seek-back", "10 Sekunden zurück", HeldixKeys.NONE, () -> seek(-SEEK_MS)), "10 Sekunden zurück", "");
		module.showKey(api.registerKey("shuffle", "Zufallswiedergabe", HeldixKeys.NONE, this::shuffle), "Zufallswiedergabe", "");
		module.showKey(api.registerKey("repeat", "Wiederholen", HeldixKeys.NONE, this::repeat), "Wiederholen", "");
		module.showKey(api.registerKey("share", "Song im Chat teilen", HeldixKeys.NONE, this::share), "Song im Chat teilen", "");

		api.registerCommand("np", "[teilen]", "Zeigt den laufenden Song (teilen: für alle im Chat)", this::nowPlaying);
		api.registerCommand("spotify", "play|pause|next|prev|+10|-10|shuffle|repeat|player", "Musik steuern", this::spotifyCommand);

		module.onToggle(enabled -> {
			if (enabled) startPlayer();
			else if (player != null) player.stop();
		});
		api.events().onTick(this::tick);
		if (module.isEnabled()) startPlayer();

		if (player == null) api.logger().warn("Das Spotify-Addon läuft nur unter Windows, macOS und Linux und ist auf diesem System inaktiv.");
	}

	@Override
	public void onDisable() {
		if (player != null) player.stop();
	}

	private void startPlayer() {
		if (player == null) return;
		player.setAnyPlayer(!onlySpotify.getAsBoolean());
		player.start();
	}

	// --- Zustand ------------------------------------------------------------------------------

	/** aktueller Song oder null */
	Track track() {
		return player != null && module.isEnabled() ? player.track() : null;
	}

	boolean playing(Track track, long now) {
		return player != null && player.playing(track, now);
	}

	long position(Track track, long now) {
		return player != null ? player.position(track, now) : track.positionMs();
	}

	/** Text, wenn kein Song angezeigt werden kann */
	String idleMessage() {
		if (player == null) return "Nur unter Windows, macOS und Linux (mit playerctl)";
		if (!module.isEnabled()) return "Spotify-Modul ist aus";
		String problem = player.problem();
		if (problem != null) return problem;
		if (player.failures() >= 2) {
			return switch (os) {
				case WINDOWS -> "Windows-Mediensteuerung nicht erreichbar";
				case MAC -> "Spotify-Steuerung nicht erreichbar";
				default -> "playerctl antwortet nicht";
			};
		}
		if (!player.connected()) return "Verbinde …";
		return player.idleText();
	}

	/** Wird das HUD-Element gerade gezeigt? (für „Einblendung nur ohne HUD-Element“ und Rückmeldungen) */
	boolean hudVisible(Track track, long now) {
		if (!module.isEnabled() || !showHud.getAsBoolean() || api.game().hudHidden()) return false;
		if (track == null) return !hideIdle.getAsBoolean();
		return !(hidePaused.getAsBoolean() && pausedSince > 0 && now - pausedSince > HIDE_PAUSED_MS);
	}

	// --- Steuerung ----------------------------------------------------------------------------

	private boolean ready() {
		if (player == null) {
			api.notify("Spotify", "Nur unter Windows, macOS und Linux (mit playerctl)");
			return false;
		}
		if (!module.isEnabled()) {
			api.notify("Spotify ist aus", "Im Heldix-Menü unter Module einschalten");
			return false;
		}
		return true;
	}

	/** Befehl, der einen geladenen Song braucht */
	private boolean command(Runnable action) {
		if (!ready()) return false;
		if (player.track() == null) {
			api.notify("Spotify", idleMessage());
			return false;
		}
		action.run();
		return true;
	}

	void playPause() {
		if (!ready()) return;
		Track track = player.track();
		if (track == null) {
			api.notify("Spotify", idleMessage());
			return;
		}
		long now = System.currentTimeMillis();
		boolean willPlay = !player.playing(track, now);
		player.playPause();
		// ohne sichtbares HUD-Element ist die Einblendung die einzige Rückmeldung
		if (!hudVisible(track, now)) api.notify(willPlay ? "Wiedergabe" : "Pausiert", track.title(), track.cover());
	}

	void seek(long delta) {
		command(() -> player.seek(delta));
	}

	void next() {
		command(() -> player.next());
	}

	void previous() {
		command(() -> player.previous());
	}

	/** Laufenden Song nur im eigenen Chat zeigen (Klick auf den Titel im HUD, wie „.np“) */
	void showNowPlaying() {
		Track track = track();
		if (track == null) {
			api.chat("Gerade läuft nichts – " + idleMessage());
			return;
		}
		long now = System.currentTimeMillis();
		String time = track.durationMs() > 0 ? " (" + SpotifyHud.time(position(track, now)) + " / " + SpotifyHud.time(track.durationMs()) + ")" : "";
		api.chat("♪ " + track.line() + time + (playing(track, now) ? "" : " – pausiert"));
	}

	private void shuffle() {
		command(() -> {
			Track track = player.track();
			player.toggleShuffle();
			if (track.shuffle() != null) api.notify(track.shuffle() ? "Zufallswiedergabe aus" : "Zufallswiedergabe an", track.title(), track.cover());
		});
	}

	private void repeat() {
		command(() -> {
			Track track = player.track();
			player.cycleRepeat();
			if (track.repeat() != null) api.notify(track.repeat().next(os != Player.Os.MAC).label(), track.title(), track.cover());
		});
	}

	/** „🎵 Titel – Künstler“ an alle im Chat (nur als Aktion des Spielers erlaubt) */
	private void share() {
		Track track = track();
		if (track == null) {
			api.notify("Spotify", "Gerade läuft kein Song");
			return;
		}
		if (!api.sendChatMessage("🎵 " + track.line())) api.notify("Spotify", "Teilen geht nur in einer Welt");
	}

	// --- Chat-Befehle (API 3) ------------------------------------------------------------------

	private void nowPlaying(CommandContext command) {
		Track track = track();
		if (track == null) {
			command.reply("Gerade läuft nichts – " + idleMessage());
			return;
		}
		if (command.arg(0).equals("teilen") || command.arg(0).equals("share")) {
			if (!api.sendChatMessage("🎵 " + track.line())) command.reply("Teilen geht nur in einer Welt");
			return;
		}
		long now = System.currentTimeMillis();
		String time = track.durationMs() > 0 ? " (" + SpotifyHud.time(position(track, now)) + " / " + SpotifyHud.time(track.durationMs()) + ")" : "";
		String app = "Spotify".equals(track.app()) ? "" : " · " + track.app();
		command.reply("♪ " + track.line() + time + (playing(track, now) ? "" : " – pausiert") + app);
	}

	private void spotifyCommand(CommandContext command) {
		String what = command.arg(0);
		if (what.isEmpty() || what.equals("hilfe") || what.equals("help")) {
			command.reply("So geht's: .spotify play | pause | next | prev | +10 | -10 | shuffle | repeat | player");
			return;
		}
		if (!ready()) return;
		Track track = player.track();
		long now = System.currentTimeMillis();
		switch (what) {
			case "play", "pause" -> {
				if (track == null) {
					command.reply(idleMessage());
					return;
				}
				boolean playing = player.playing(track, now);
				if (playing == what.equals("play")) {
					command.reply(playing ? "Läuft schon" : "Ist schon pausiert");
					return;
				}
				player.playPause();
				command.reply((playing ? "Pausiert: " : "Weiter: ") + track.line());
			}
			case "next", "weiter" -> reply(command, () -> player.next(), "Nächster Song");
			case "prev", "previous", "zurück", "zurueck" -> reply(command, () -> player.previous(), "Vorheriger Song");
			case "+10", "vor" -> reply(command, () -> player.seek(SEEK_MS), "10 Sekunden vor");
			case "-10" -> reply(command, () -> player.seek(-SEEK_MS), "10 Sekunden zurück");
			case "shuffle", "zufall" -> shuffle();
			case "repeat", "wiederholen" -> repeat();
			case "player" -> player.nextPlayer();
			default -> command.reply("Unbekannt: „" + what + "“. So geht's: .spotify play | pause | next | prev | +10 | -10 | shuffle | repeat | player");
		}
	}

	private void reply(CommandContext command, Runnable action, String done) {
		if (command(action)) command.reply(done);
	}

	// --- Songwechsel ----------------------------------------------------------------------------

	private void tick() {
		if (player == null || !module.isEnabled() || !player.running()) return;
		player.setAnyPlayer(!onlySpotify.getAsBoolean());
		if (!player.connected()) return;

		Track track = player.track();
		long now = System.currentTimeMillis();
		if (track == null || player.playing(track, now)) pausedSince = 0;
		else if (pausedSince == 0) pausedSince = now;

		String key = track != null ? track.key() : null;
		if (!Objects.equals(key, lastKey)) {
			if (primed && track != null && announce.getAsBoolean() && !(announceHiddenOnly.getAsBoolean() && hudVisible(track, now))) {
				announce(track, now);
			}
			lastKey = key;
		} else if (track != null && key.equals(announcedKey) && now - announcedAt < 4000 && !Objects.equals(track.cover(), announcedCover)) {
			// Das Cover kommt oft erst kurz nach dem Titel: Einblendung damit auffrischen
			announce(track, announcedAt);
		}
		primed = true;
	}

	private void announce(Track track, long at) {
		api.notify(track.title(), track.byline(), track.cover());
		announcedKey = track.key();
		announcedCover = track.cover();
		announcedAt = at;
	}
}
