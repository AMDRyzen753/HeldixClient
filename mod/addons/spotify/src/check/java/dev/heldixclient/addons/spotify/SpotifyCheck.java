package dev.heldixclient.addons.spotify;

import dev.heldixclient.api.HeldixLogger;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Prüfstand ohne Mac (nicht Teil des Addons, läuft mit {@code gradlew build}): füttert {@link MacPlayer} mit Zeilen,
 * wie sie das Abfrage-Skript auf dem Mac schreibt (Spotify und Apple Music), und prüft Song, Wiederholen, Hinweise und
 * die Befehle an die richtige App. Die Skripte landen zum Ansehen bzw. für eine Syntaxprüfung im Ordner aus args[0].
 * Ob macOS sie wirklich ausführt, zeigt erst ein echter Mac.
 */
public final class SpotifyCheck {
	private static int failures;
	private static int passed;

	private static void check(boolean ok, String label) {
		System.out.println((ok ? "OK   " : "FEHLER ") + label);
		if (ok) passed++;
		else failures++;
	}

	public static void main(String[] args) throws Exception {
		Path out = Path.of(args.length > 0 ? args[0] : "build/spotify-check");
		Path dir = Files.createTempDirectory("heldix-spotify-check");
		List<String> shown = new ArrayList<>();
		HeldixLogger logger = new HeldixLogger() {
			@Override
			public void info(String message) {
			}

			@Override
			public void warn(String message) {
			}

			@Override
			public void error(String message, Throwable error) {
			}
		};
		List<Runnable> background = new ArrayList<>();
		MacPlayer player = new MacPlayer(logger, dir, (title, message) -> shown.add(title + ": " + message), background::add);

		// Spotify (ältere Versionen melden die Dauer in Sekunden)
		player.parse("STATE\tSpotify\tplaying\tSong A\tKünstler A\tAlbum A\t215\t42000\thttps://i.scdn.co/image/x\ttrue\tfalse");
		Track spotify = player.track();
		check(spotify != null && "Spotify".equals(spotify.app()) && spotify.playing() && "Song A".equals(spotify.title()), "Spotify: Song gelesen");
		check(spotify != null && spotify.durationMs() == 215_000 && spotify.positionMs() == 42_000, "Spotify: Dauer in Sekunden → Millisekunden");
		check(spotify != null && Boolean.TRUE.equals(spotify.shuffle()) && spotify.repeat() == Track.Repeat.OFF, "Spotify: Zufall an, Wiederholen aus");
		check(!MacPlayer.repeatsTrack(spotify), "Spotify: kein „Song wiederholen“ per AppleScript");
		check(!background.isEmpty(), "Spotify: Cover wird im Hintergrund geladen");
		background.clear();

		// Apple Music (Dauer schon in Millisekunden, Wiederholen off/all/one)
		player.parse("STATE\tMusic\tpaused\tSong B\tKünstler B\tAlbum B\t187500\t1000\t\tfalse\tone");
		Track music = player.track();
		check(music != null && MacPlayer.MUSIC_LABEL.equals(music.app()) && !music.playing() && music.durationMs() == 187_500, "Apple Music: Song gelesen, pausiert");
		check(music != null && music.repeat() == Track.Repeat.TRACK && Boolean.FALSE.equals(music.shuffle()), "Apple Music: wiederholt den Song");
		check(MacPlayer.repeatsTrack(music), "Apple Music: „Song wiederholen“ möglich");
		check(background.size() == 1, "Apple Music: Cover wird einmal je Song geholt");
		player.parse("STATE\tMusic\tplaying\tSong B\tKünstler B\tAlbum B\t187500\t2000\t\tfalse\tall");
		check(background.size() == 1 && player.track().repeat() == Track.Repeat.LIST, "Apple Music: gleicher Song – kein zweites Holen; „all“ = Liste");
		check(MacPlayer.repeat(true, "off") == Track.Repeat.OFF && MacPlayer.repeat(true, "x") == null && MacPlayer.repeat(false, "") == null, "Wiederholen: off und Unbekanntes");

		// Befehle an die richtige App
		String toMusic = MacPlayer.commandScript(MacPlayer.MUSIC, Player.Command.REPEAT, 0);
		check(toMusic.contains("Application('Music')") && toMusic.contains("songRepeat") && toMusic.contains("a.running()"), "Befehl: Wiederholen an Apple Music (nur wenn offen)");
		check(MacPlayer.commandScript(MacPlayer.MUSIC, Player.Command.SHUFFLE, 0).contains("shuffleEnabled"), "Befehl: Zufall an Apple Music");
		check(MacPlayer.commandScript(MacPlayer.SPOTIFY, Player.Command.SHUFFLE, 0).contains("a.shuffling = !a.shuffling()"), "Befehl: Zufall an Spotify");
		check(MacPlayer.commandScript(MacPlayer.SPOTIFY, Player.Command.SEEK, 61_500).contains("a.playerPosition = 61.5"), "Befehl: Spulen in Sekunden");
		check(MacPlayer.commandScript(MacPlayer.MUSIC, Player.Command.PREVIOUS, 0).contains("a.previousTrack()"), "Befehl: vorheriger Song");

		// Hinweise
		player.parse("OFF\t*");
		check("Spotify oder Apple Music öffnen".equals(player.problem()) && player.track() == null, "Hinweis: beide zu");
		player.parse("OFF\tSpotify");
		check("Spotify nicht geöffnet".equals(player.problem()), "Hinweis: Spotify zu");
		player.parse("MISSING\tSpotify");
		check("Spotify ist nicht installiert".equals(player.problem()), "Hinweis: Spotify fehlt");
		player.parse("ERROR\tMusic\tError: Not authorized to send Apple events to Music. (-1743)");
		check(player.problem() != null && player.problem().contains("auf Apple Music") && player.problem().contains("Automation"), "Hinweis: Zugriff auf Apple Music erlauben");
		player.parse("NONE\tMusic");
		check(player.problem() == null && player.track() == null, "Apple Music offen, aber nichts geladen");

		// Modus: „Nur Spotify“ aus → Abfrage mit Apple Music
		check(player.idleText().startsWith("Spotify öffnen"), "Nur Spotify: Hinweis ohne Apple Music");
		player.setAnyPlayer(true);
		check(player.idleText().contains("Apple Music"), "Auch Apple Music: Hinweis nennt beide");
		String any = MacPlayer.pollScript(true);
		String only = MacPlayer.pollScript(false);
		check(any.contains("var ANY = true;") && only.contains("var ANY = false;") && !any.contains("%ANY%"), "Abfrage-Skript: Modus eingesetzt");
		check(any.contains("read('Music')") && any.contains("state === 'playing'"), "Abfrage-Skript: wählt den Player, der gerade spielt");
		check(String.join("\n", MacPlayer.musicArtworkScript()).contains("if application \"Music\" is not running then return \"none\""), "Cover-Skript startet Apple Music nicht");
		check(SpotifyAddon.macKeyHint("←").equals("Auf MacBook-Tastaturen: fn + ←"), "Hinweis zu Pos1 auf MacBook-Tastaturen");

		Files.createDirectories(out);
		Files.writeString(out.resolve("poll.js"), any, StandardCharsets.UTF_8);
		Files.writeString(out.resolve("music-artwork.applescript"), String.join("\n", MacPlayer.musicArtworkScript()) + "\n", StandardCharsets.UTF_8);

		System.out.println(failures == 0 ? "SPOTIFY: ALLE " + passed + " PRUEFUNGEN BESTANDEN" : "SPOTIFY: " + failures + " PRUEFUNG(EN) FEHLGESCHLAGEN");
		if (failures > 0) System.exit(1);
	}
}
