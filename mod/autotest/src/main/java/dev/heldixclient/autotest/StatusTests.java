package dev.heldixclient.autotest;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.heldixclient.status.StatusReporter;
import dev.heldixclient.voice.VoiceLink;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.Level;

import java.util.Locale;

/**
 * Statuszeile für den Discord-Status („HELDIX-STATUS {…}“, Felder ab 0.13.8): {@code dimension}, {@code gameMode},
 * {@code worldName} im Einzelspieler (keine Spielerzahl), {@code voice} nur mit verbundenem Voice Chat; eine neue Zeile
 * nur bei Änderung und höchstens alle 2 Sekunden; {@code afk} über den Test-Schalter nach kurzer Zeit ohne Eingabe,
 * eine Mausbewegung nimmt es wieder weg. Zum Schluss Spielmodus und Ort wie vorher.
 */
final class StatusTests {
	private static final long MIN_INTERVAL_MS = 2_000;

	private StatusTests() {
	}

	static void run(TestContext t) {
		String name = t.compute(mc -> mc.player.getName().getString());
		double[] start = t.compute(mc -> new double[] {mc.player.getX(), mc.player.getY(), mc.player.getZ(), mc.player.getYRot(), mc.player.getXRot()});
		String modeBefore = t.compute(mc -> mc.gameMode.getPlayerMode().getName());
		try {
			basics(t, modeBefore);
			dimension(t, name, start);
			gameMode(t, name);
			afk(t);
		} catch (Exception e) {
			AutoTest.LOG.error("Test der Statuszeile fehlgeschlagen", e);
			t.check("Test der Statuszeile ohne Fehler (" + e + ")", false);
		} finally {
			t.run(mc -> StatusReporter.testAfkAfter(0));
			t.serverCommand("gamemode " + modeBefore + " " + name);
			t.serverCommand(String.format(Locale.ROOT, "execute in minecraft:overworld run tp %s %.3f %.3f %.3f %.1f %.1f", name, start[0], start[1], start[2], start[3], start[4]));
			t.waitFor("zurück in der Oberwelt", mc -> mc.level != null && mc.level.dimension() == Level.OVERWORLD && mc.gui.screen() == null, 60);
		}
	}

	/** Erste Zeile: Einzelspieler mit Dimension, Spielmodus und Weltname, ohne Spielerzahl; voice nur, wenn verbunden */
	private static void basics(TestContext t, String modeBefore) {
		t.run(mc -> {
			mc.gui.setScreen(null);
			StatusReporter.testReport(mc);
		});
		JsonObject line = line(t);
		t.log("Statuszeile: " + line);
		t.check("Statuszeile: mode singleplayer", "singleplayer".equals(string(line, "mode")));
		t.check("Statuszeile: dimension overworld", "overworld".equals(string(line, "dimension")));
		t.check("Statuszeile: gameMode " + modeBefore + " (" + string(line, "gameMode") + ")", modeBefore.equals(string(line, "gameMode")));
		String world = t.compute(mc -> mc.getSingleplayerServer().getWorldData().getLevelName());
		t.check("Statuszeile: worldName = Name der Welt („" + string(line, "worldName") + "“) – zeigen oder nicht entscheidet der Launcher",
				world.equals(string(line, "worldName")));
		t.check("Statuszeile: keine Spielerzahl im Einzelspieler", !line.has("players") && !line.has("maxPlayers"));
		t.check("Statuszeile: nicht abwesend", !line.has("afk"));
		boolean voice = t.compute(mc -> VoiceLink.status() == VoiceLink.Status.CONNECTED);
		if (voice) {
			JsonObject v = line.has("voice") && line.get("voice").isJsonObject() ? line.getAsJsonObject("voice") : null;
			t.check("Statuszeile: voice { inGroup, others } bei verbundenem Voice Chat (" + v + ")", v != null && v.has("inGroup") && v.has("others"));
		} else {
			t.check("Statuszeile: kein voice ohne verbundenen Voice Chat", !line.has("voice"));
			// ohne Änderung keine neue Zeile
			long at = t.compute(mc -> StatusReporter.lastWrittenAt());
			t.waitTicks(70);
			t.check("Statuszeile: ohne Änderung keine neue Zeile", t.compute(mc -> StatusReporter.lastWrittenAt()) == at);
		}
		t.check("Dimensionen: overworld, nether, end, sonst die ID",
				"overworld".equals(StatusReporter.dimension(Identifier.withDefaultNamespace("overworld")))
						&& "nether".equals(StatusReporter.dimension(Identifier.withDefaultNamespace("the_nether")))
						&& "end".equals(StatusReporter.dimension(Identifier.withDefaultNamespace("the_end")))
						&& "heldix:testwelt".equals(StatusReporter.dimension(Identifier.fromNamespaceAndPath("heldix", "testwelt"))));
	}

	/** In den Nether und zurück (im Kreativmodus, damit nichts passiert) */
	private static void dimension(TestContext t, String name, double[] start) {
		t.serverCommand("gamemode creative " + name);
		t.serverCommand("execute in minecraft:the_nether run tp " + name + " 0 100 0");
		t.waitFor("Nether geladen", mc -> mc.level != null && mc.level.dimension() == Level.NETHER && mc.player != null && mc.gui.screen() == null, 60);
		boolean nether = t.waitSoft(mc -> "nether".equals(string(parse(StatusReporter.lastLine()), "dimension")), 8);
		t.check("Statuszeile nach Dimensionswechsel: dimension nether (" + StatusReporter.lastLine() + ")", nether);
		t.serverCommand(String.format(Locale.ROOT, "execute in minecraft:overworld run tp %s %.3f %.3f %.3f", name, start[0], start[1], start[2]));
		t.waitFor("Oberwelt geladen", mc -> mc.level != null && mc.level.dimension() == Level.OVERWORLD && mc.player != null && mc.gui.screen() == null, 60);
		boolean overworld = t.waitSoft(mc -> "overworld".equals(string(parse(StatusReporter.lastLine()), "dimension")), 8);
		t.check("Statuszeile zurück in der Oberwelt: dimension overworld", overworld);
	}

	/** Spielmodus wechseln; die neue Zeile kommt frühestens 2 Sekunden nach der vorigen */
	private static void gameMode(TestContext t, String name) {
		t.run(StatusReporter::testReport);
		long before = t.compute(mc -> StatusReporter.lastWrittenAt());
		t.serverCommand("gamemode survival " + name);
		boolean survival = t.waitSoft(mc -> "survival".equals(string(parse(StatusReporter.lastLine()), "gameMode")), 8);
		long after = t.compute(mc -> StatusReporter.lastWrittenAt());
		t.check("Statuszeile nach /gamemode survival: gameMode survival", survival);
		t.check("Statuszeile höchstens alle 2 Sekunden (Abstand " + (after - before) + " ms)", after - before >= MIN_INTERVAL_MS);
		t.serverCommand("gamemode adventure " + name);
		boolean adventure = t.waitSoft(mc -> "adventure".equals(string(parse(StatusReporter.lastLine()), "gameMode")), 8);
		t.check("Statuszeile nach /gamemode adventure: gameMode adventure", adventure);
		t.serverCommand("gamemode spectator " + name);
		boolean spectator = t.waitSoft(mc -> "spectator".equals(string(parse(StatusReporter.lastLine()), "gameMode")), 8);
		t.check("Statuszeile nach /gamemode spectator: gameMode spectator", spectator);
		t.serverCommand("gamemode creative " + name);
		boolean creative = t.waitSoft(mc -> "creative".equals(string(parse(StatusReporter.lastLine()), "gameMode")), 8);
		t.check("Statuszeile nach /gamemode creative: gameMode creative", creative);
	}

	/** Abwesend: Test-Schalter 1,5 s, keine Eingabe → afk; Maus bewegt → wieder da */
	private static void afk(TestContext t) {
		t.run(mc -> {
			mc.gui.setScreen(null);
			mc.options.keyPlayerList.setDown(false);
			StatusReporter.testAfkAfter(1_500);
		});
		boolean away = t.waitSoft(mc -> isAfk(StatusReporter.lastLine()), 10);
		t.check("Statuszeile: afk nach der Zeit ohne Eingabe (" + StatusReporter.lastLine() + ")", away);
		// Vor der Bewegung die Frist wieder lang machen: sonst wäre man nach 1,5 s schon wieder abwesend, bevor die
		// gedrosselte Statuszeile (höchstens alle 2 s) den Wechsel zurück schreiben kann.
		t.run(mc -> StatusReporter.testAfkAfter(60_000));
		t.moveMouse(37, 41);
		boolean back = t.waitSoft(mc -> !isAfk(StatusReporter.lastLine()), 8);
		t.check("Statuszeile: afk weg nach einer Mausbewegung (" + StatusReporter.lastLine() + ")", back);
		t.run(mc -> StatusReporter.testAfkAfter(0));
	}

	// --- Hilfen ---------------------------------------------------------------------------

	private static JsonObject line(TestContext t) {
		JsonObject json = parse(t.compute(mc -> StatusReporter.lastLine()));
		if (json == null) throw new AssertionError("Keine Statuszeile");
		return json;
	}

	private static JsonObject parse(String line) {
		if (line == null) return null;
		JsonElement element = JsonParser.parseString(line);
		return element.isJsonObject() ? element.getAsJsonObject() : null;
	}

	private static String string(JsonObject json, String key) {
		if (json == null || !json.has(key) || !json.get(key).isJsonPrimitive()) return null;
		return json.get(key).getAsString();
	}

	private static boolean isAfk(String line) {
		JsonObject json = parse(line);
		return json != null && json.has("afk") && json.get("afk").getAsBoolean();
	}
}
