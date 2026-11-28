package dev.heldixclient.autotest;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.mojang.authlib.GameProfile;
import dev.heldixclient.cosmetic.CosmeticCatalog;
import dev.heldixclient.cosmetic.CosmeticFormat;
import dev.heldixclient.cosmetic.CosmeticRenderer;
import dev.heldixclient.cosmetic.CosmeticRig;
import dev.heldixclient.cosmetic.Cosmetics;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.loader.api.event.HudEvents;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.RemotePlayer;
import net.minecraft.server.level.ParticleStatus;
import net.minecraft.world.entity.Entity;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * Cosmetics im Format 2 (Meshes mit Knochen und Keyframe-Animationen, 0.13.8) im echten Spiel, nach den Prüfungen von
 * {@link CosmeticTests}:
 * <ul>
 *   <li>Prüfung des Formats ohne Dienst (ein kleines Manifest, das der Test selbst baut, und kaputte Abwandlungen mit
 *       denselben Meldungen wie service/src/cosmetics-format.ts).</li>
 *   <li>Mit Dienst: die 26 umgewandelten Cosmetics im Katalog (8 Flügel, 12 Begleiter, 6 Auren), je Slot eines angelegt
 *       und gezeichnet, Anker (Flügel am Rücken, Begleiter an der Schulter, Aura um die Füße), Zustandswechsel (schleichen,
 *       springen, landen, Schaden, Abheben, Jubeln, Emote, AFK, An-/Ablegen), Partikel an Knochen, ein anderer Spieler,
 *       die Vorschau im Cosmetics-Menü und eine Messung mit 20 Spielern.</li>
 * </ul>
 * Die Prüfungen im Spiel brauchen die umgewandelten, signierten Umschläge im lokalen Dev-Dienst; fehlen sie, überspringt
 * der Test diesen Teil mit einer klaren Meldung.
 */
final class Format2Tests {
	private static final List<String> BACK = List.of("seraphfluegel", "daemonenfluegel", "morphofluegel", "mechfluegel", "lohenfluegel",
			"amethystfaecher", "abgrund-tentakel", "farnwedel");
	private static final List<String> COMPANION = List.of("ember", "wisp", "bolt", "mochi", "mochi-tuxedo", "mochi-silber", "mochi-schnee", "jelly",
			"orbit", "pip", "lumi", "sprout");
	private static final List<String> AURA = List.of("runenkreis", "flammenkreis", "eiskranz", "leere-spirale", "bluetensturm", "gewitterwolke");
	/** Höhe des Hals-Pivots über den Füßen eines stehenden Spielers (Modell 0,9375-fach) */
	private static final double NECK = 1.501 * 0.9375;
	private static final String EMOTE_PROPERTY = "heldix.emote.lokal";
	private static final List<String> FAILED = new CopyOnWriteArrayList<>();

	private Format2Tests() {
	}

	/** fehlgeschlagene Prüfungen: der Test läuft weiter, am Ende schlägt er fehl (zeigt alle Probleme auf einmal) */
	private static void check(TestContext t, String what, boolean ok) {
		if (ok) t.check(what, true);
		else {
			FAILED.add(what);
			AutoTest.LOG.error("AUTOTEST [FEHLER] {}", what);
		}
	}

	static void run(TestContext t) {
		FAILED.clear();
		try {
			parser(t);
		} catch (Exception | AssertionError e) {
			AutoTest.LOG.error("Format 2: Prüfung des Formats fehlgeschlagen", e);
			FAILED.add("Ausnahme beim Prüfen des Formats: " + e);
		}
		if (t.compute(mc -> Social.state()) == Social.State.DISABLED) {
			t.log("Format 2: Heldix-Dienst nicht eingerichtet (--service fehlt), Prüfungen im Spiel übersprungen");
			finish(t);
			return;
		}
		t.waitSoft(mc -> Social.online(), 20);
		t.waitSoft(mc -> CosmeticCatalog.status() == CosmeticCatalog.Status.READY, 40);
		List<CosmeticCatalog.Item> rigs = t.compute(mc -> CosmeticCatalog.items().stream().filter(i -> i.rig() != null).toList());
		if (rigs.isEmpty()) {
			t.log("Format 2: Keine Cosmetics im Format 2 im Katalog – die umgewandelten Umschläge (cosmetics/<id>/) sind noch nicht signiert und im "
					+ "Dev-Dienst veröffentlicht. Prüfungen im Spiel übersprungen (verworfen: " + t.compute(mc -> CosmeticCatalog.rejected()) + ")");
			finish(t);
			return;
		}
		List<RemotePlayer> remotes = new ArrayList<>();
		Map<String, String> before = new LinkedHashMap<>(t.compute(mc -> Cosmetics.mine()));
		List<dev.heldixclient.module.HudModule> hudOn = t.compute(mc -> dev.heldixclient.module.ModuleManager.hud().stream()
				.filter(dev.heldixclient.module.HudModule::isEnabled).toList());
		net.minecraft.world.entity.player.ChatVisiblity chat = t.compute(mc -> mc.options.chatVisibility().get());
		ParticleStatus particles = t.compute(mc -> mc.options.particles().get());
		t.run(mc -> {
			hudOn.forEach(m -> m.setEnabled(false));
			mc.options.chatVisibility().set(net.minecraft.world.entity.player.ChatVisiblity.HIDDEN);
			mc.options.particles().set(ParticleStatus.ALL);
		});
		try {
			catalog(t, rigs);
			Map<String, CosmeticCatalog.Item> worn = wear(t, rigs);
			own(t, worn);
			states(t, worn);
			particles(t, worn);
			other(t, worn, remotes);
			menu(t, rigs, worn);
			performance(t, rigs, remotes);
		} catch (Exception | AssertionError e) {
			AutoTest.LOG.error("Format 2: Test fehlgeschlagen", e);
			FAILED.add("Ausnahme: " + e);
		} finally {
			System.setProperty(EMOTE_PROPERTY, "");
			t.run(mc -> {
				for (RemotePlayer remote : remotes) mc.level.removeEntity(remote.getId(), Entity.RemovalReason.DISCARDED);
				Social.forgetPlayers();
				Cosmetics.clearLocal();
				CosmeticRenderer.testAfk(false);
				mc.options.keyShift.setDown(false);
				mc.options.particles().set(particles);
				hudOn.forEach(m -> m.setEnabled(true));
				mc.options.chatVisibility().set(chat);
				mc.options.setCameraType(CameraType.FIRST_PERSON);
				mc.gui.setScreen(null);
			});
			for (String slot : List.of("head", "back", "aura", "companion")) {
				try {
					String id = before.get(slot);
					if (!java.util.Objects.equals(id, t.compute(mc -> Cosmetics.mine(slot)))) {
						t.compute(mc -> Cosmetics.choose(slot, id)).get(10, TimeUnit.SECONDS);
					}
				} catch (Exception e) {
					t.log("Format 2: Auswahl im Slot " + slot + " nicht zurückgesetzt (" + e + ")");
				}
			}
			t.serverCommand("effect clear @p");
			t.serverCommand("gamemode creative @p");
		}
		finish(t);
	}

	private static void finish(TestContext t) {
		t.check("Format 2: alle Prüfungen bestanden" + (FAILED.isEmpty() ? "" : " – fehlgeschlagen: " + FAILED), FAILED.isEmpty());
	}

	// ======================================================================================
	// Format (ohne Dienst): ein kleines Manifest und kaputte Abwandlungen
	// ======================================================================================

	private static void parser(TestContext t) {
		JsonObject manifest = sample();
		String error = ruleError(manifest);
		check(t, "Format 2: Test-Manifest erfüllt alle Regeln" + (error.isEmpty() ? "" : " (" + error + ")"), error.isEmpty());
		try {
			CosmeticFormat.Manifest parsed = CosmeticFormat.parseManifest(manifest.toString());
			CosmeticFormat.Rig rig = parsed.rig();
			check(t, "Format 2: gelesen (4 Vertices, 2 Dreiecke, 2 Knochen, 3 Animationen, 1 Partikel, Leucht-Streifen mit 2 Bildern)", parsed.format() == 2
					&& rig != null && rig.vertexCount() == 4 && rig.triangleCount() == 2 && rig.bones().size() == 2 && rig.animations().size() == 3
					&& rig.particles().size() == 1 && rig.particles().getFirst().particle().equals("end_rod") && rig.emissive().frames() == 2
					&& rig.states().get("jump").equals("Flap") && Math.abs(rig.blendSeconds() - 0.2) < 1e-9 && parsed.model() == null);
			CosmeticFormat.Channel rot = rig.animations().get("Idle").tracks().getFirst().rot();
			check(t, "Format 2: Keys und Quaternionen dekodiert", rot.keys().length == 2 && rot.keys()[1] == 12 && Math.abs(rot.values()[7] - Math.sqrt(0.5)) < 1e-3);
		} catch (CosmeticFormat.InvalidCosmeticException e) {
			check(t, "Format 2: Test-Manifest gelesen (" + e.getMessage() + ")", false);
		}

		expect(t, "unbekanntes Feld", manifest, m -> m.addProperty("skript", "x"), "„skript“ ist kein bekanntes Feld (Format 2)", true);
		expect(t, "unbekanntes Format", manifest, m -> m.addProperty("format", 3), "„format“ muss 1 oder 2 sein", true);
		expect(t, "Slot cape", manifest, m -> m.addProperty("slot", "cape"), "„slot“ muss eins von head, back, aura, companion sein", true);
		expect(t, "ohne idle", manifest, m -> m.getAsJsonObject("states").remove("idle"), "„states.idle“ fehlt", true);
		expect(t, "ohne blendSeconds", manifest, m -> m.getAsJsonObject("states").remove("blendSeconds"), "„states.blendSeconds“ fehlt", true);
		expect(t, "Zustand ohne Animation", manifest, m -> m.getAsJsonObject("states").addProperty("walk", "Laufen"),
				"„states.walk“ muss der Name einer Animation sein (Idle, Flap, Land)", true);
		expect(t, "unbekannter Zustand", manifest, m -> m.getAsJsonObject("states").addProperty("tanzen", "Idle"), "„states.tanzen“ ist kein bekanntes Feld (Format 2)", true);
		expect(t, "verbotener Partikel", manifest, m -> m.getAsJsonArray("particles").get(0).getAsJsonObject().addProperty("particle", "minecraft:barrier"),
				"„particles[0].particle“ ist kein erlaubter Partikel (", false);
		expect(t, "Farbe nur bei dust", manifest, m -> m.getAsJsonArray("particles").get(0).getAsJsonObject().addProperty("color", "#ff0000"),
				"„particles[0].color“ gibt es nur beim Partikel dust", true);
		expect(t, "Dreieck mit fehlendem Vertex", manifest, m -> m.getAsJsonObject("mesh").addProperty("triangles", u16(0, 1, 2, 0, 2, 9)),
				"„mesh.triangles“: Dreieck 1 nennt den Vertex 9, es gibt nur 4 (0 bis 3)", true);
		expect(t, "Vertex mit fehlendem Knochen", manifest, m -> m.getAsJsonObject("mesh").addProperty("bones", u8(0, 0, 1, 7)),
				"„mesh.bones“: Vertex 3 nennt den Knochen 7, es gibt nur 2 (0 bis 1)", true);
		expect(t, "zu wenige Positionen", manifest, m -> m.getAsJsonObject("mesh").addProperty("positions", "AAAA"),
				"„mesh.positions“ muss genau 12 Int16-Werte (3 je Vertex, 4 Vertices) als Base64 enthalten (32 Zeichen, nicht 4)", true);
		expect(t, "Leucht-Streifen zu klein", manifest, m -> m.getAsJsonObject("emissive").addProperty("frames", 3),
				"„glow“ muss 16 × 48 Pixel groß sein (so breit wie „texture“, 3 Bilder zu je 16 Pixel untereinander; ist 16 × 32)", true);
		expect(t, "glow ohne emissive", manifest, m -> m.remove("emissive"), "„emissive“ fehlt (Pflicht mit „glow“)", true);
		expect(t, "Puls min über max", manifest, m -> {
			JsonObject p = m.getAsJsonObject("emissive").getAsJsonObject("pulse");
			p.addProperty("min", 0.9);
			p.addProperty("max", 0.5);
		},
				"„emissive.pulse.min“ darf nicht größer sein als „emissive.pulse.max“", true);
		expect(t, "Textur keine Zweierpotenz", manifest, m -> m.addProperty("texture", CosmeticFormat.PNG_DATA_URL_PREFIX + png(24, 16, 1)),
				"„texture“ muss je eine Zweierpotenz von 16 bis 512 Pixel breit und hoch sein (ist 24 × 16)", true);
		expect(t, "attach nur beim Begleiter", manifest, m -> m.add("attach", new JsonObject()), "„attach“ gibt es nur beim Slot companion (nicht beim Slot back)", true);
		expect(t, "Keys ohne Frame 0", manifest, m -> track(m).getAsJsonObject("rot").addProperty("keys", u16(1, 12)),
				"„animations.Idle.tracks[0].rot.keys“ muss mit Frame 0 beginnen (ist 1)", true);
		expect(t, "Key nach dem Ende", manifest, m -> track(m).getAsJsonObject("rot").addProperty("keys", u16(0, 24)),
				"„animations.Idle.tracks[0].rot.keys“: Frame 24 liegt nicht in der Animation (0 bis 23)", true);
		expect(t, "Quaternion nicht normiert", manifest, m -> track(m).getAsJsonObject("rot").addProperty("values", i16(0, 0, 0, 16000, 0, 0, 23170, 23170)),
				"„animations.Idle.tracks[0].rot.values“: Das Quaternion von Key 0 hat die Länge 0.488 (erlaubt 0.99 bis 1.01)", true);
		expect(t, "Knochen mit späterem Eltern-Knochen", manifest, m -> m.getAsJsonArray("bones").get(1).getAsJsonObject().addProperty("parent", 1),
				"„bones[1].parent“ muss -1 (kein Eltern-Knochen) oder der Index eines Knochens davor sein (0 bis 0)", true);
		expect(t, "Knochenname doppelt", manifest, m -> m.getAsJsonArray("bones").get(1).getAsJsonObject().addProperty("name", "wurzel"),
				"„bones[1].name“: Den Knochen „wurzel“ gibt es schon", true);
		expect(t, "Gewichte ohne Summe 255", manifest, m -> {
			m.getAsJsonObject("mesh").addProperty("joints", u8(0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0));
			m.getAsJsonObject("mesh").addProperty("weights", u8(200, 55, 0, 0, 100, 100, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0));
		}, "„mesh.weights“: Die Gewichte von Vertex 1 ergeben 200 statt 255", true);
		expect(t, "weiche Haut", manifest, m -> {
			m.getAsJsonObject("mesh").addProperty("joints", u8(0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0));
			m.getAsJsonObject("mesh").addProperty("weights", u8(200, 55, 0, 0, 155, 100, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0));
		}, "", true);
		// Größe: Format 1 höchstens 160 KB, Format 2 bis 512 KB (dann scheitert es erst am unbekannten Feld)
		JsonObject big1 = new JsonObject();
		big1.addProperty("type", "heldix-cosmetic");
		big1.addProperty("format", 1);
		big1.addProperty("x", "a".repeat(170 * 1024));
		check(t, "Format 2: Format 1 über 160 KB abgelehnt (" + ruleError(big1) + ")", ruleError(big1).equals("„manifest“ ist zu groß (höchstens 160 KB bei Format 1)"));
		JsonObject big2 = manifest.deepCopy();
		big2.addProperty("x", "a".repeat(300 * 1024));
		check(t, "Format 2: Manifest mit 300 KB passt in die Grenze von Format 2 (" + ruleError(big2) + ")", ruleError(big2).equals("„x“ ist kein bekanntes Feld (Format 2)"));
		big2.addProperty("x", "a".repeat(520 * 1024));
		check(t, "Format 2: über 512 KB abgelehnt (" + ruleError(big2) + ")", ruleError(big2).equals("„manifest“ ist zu groß (höchstens 512 KB bei Format 2)"));
	}

	/** Abwandlung des Manifests muss genau (bzw. mit diesem Anfang) diese Meldung ergeben; "" = muss gelten */
	private static void expect(TestContext t, String what, JsonObject manifest, Consumer<JsonObject> change, String message, boolean exact) {
		JsonObject copy = manifest.deepCopy();
		change.accept(copy);
		String error = ruleError(copy);
		boolean ok = exact ? error.equals(message) : error.startsWith(message);
		check(t, "Format 2: " + what + (message.isEmpty() ? " gültig" : " abgelehnt") + " (" + (error.isEmpty() ? "angenommen" : error) + ")", ok);
	}

	private static JsonObject track(JsonObject m) {
		return m.getAsJsonObject("animations").getAsJsonObject("Idle").getAsJsonArray("tracks").get(0).getAsJsonObject();
	}

	private static String ruleError(JsonObject manifest) {
		try {
			CosmeticFormat.parseManifest(manifest.toString());
			return "";
		} catch (CosmeticFormat.InvalidCosmeticException e) {
			return e.getMessage();
		}
	}

	/** Kleines, gültiges Manifest: ein Viereck an zwei Knochen, drei Animationen, ein Partikel, Leucht-Streifen mit zwei Bildern */
	private static JsonObject sample() {
		JsonObject m = new JsonObject();
		m.addProperty("type", "heldix-cosmetic");
		m.addProperty("format", 2);
		m.addProperty("id", "format2-test");
		m.addProperty("version", 1);
		m.addProperty("slot", "back");
		m.addProperty("name", "Format-2-Test");
		m.addProperty("description", "Ein Viereck an zwei Knochen");
		m.addProperty("access", "all");
		m.addProperty("date", "2026-11-27T12:00:00.000Z");
		m.addProperty("texture", CosmeticFormat.PNG_DATA_URL_PREFIX + png(16, 16, 1));
		m.addProperty("glow", CosmeticFormat.PNG_DATA_URL_PREFIX + png(16, 16, 2));
		JsonObject emissive = new JsonObject();
		emissive.addProperty("frames", 2);
		emissive.addProperty("frametimeTicks", 3);
		JsonObject pulse = new JsonObject();
		pulse.addProperty("period", 2);
		pulse.addProperty("min", 0.6);
		pulse.addProperty("max", 1);
		emissive.add("pulse", pulse);
		m.add("emissive", emissive);
		JsonObject mesh = new JsonObject();
		mesh.addProperty("vertexCount", 4);
		mesh.addProperty("triangleCount", 2);
		// Viereck hinter dem Rücken (z = 3 px), 8 × 8 Pixel, Positionen in 1/32 Pixel
		mesh.addProperty("positions", i16(-128, 0, 96, 128, 0, 96, 128, 256, 96, -128, 256, 96));
		mesh.addProperty("normals", i8(0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127));
		mesh.addProperty("uvs", u16(0, 0, 65535, 0, 65535, 65535, 0, 65535));
		mesh.addProperty("bones", u8(0, 0, 1, 1));
		mesh.addProperty("triangles", u16(0, 1, 2, 0, 2, 3));
		m.add("mesh", mesh);
		JsonArray bones = new JsonArray();
		bones.add(bone("wurzel", -1, 0, 0, 3, 0, 4, 3));
		bones.add(bone("spitze.L", 0, 0, 4, 3, 0, 8, 3));
		m.add("bones", bones);
		JsonObject animations = new JsonObject();
		animations.add("Idle", clip(24, 24, true, u16(0, 12), i16(0, 0, 0, 32767, 0, 0, 23170, 23170)));
		animations.add("Flap", clip(24, 12, true, u16(0), i16(0, 0, 23170, 23170)));
		animations.add("Land", clip(24, 10, false, u16(0, 9), i16(0, 0, 0, 32767, 0, 0, 0, 32767)));
		m.add("animations", animations);
		JsonObject states = new JsonObject();
		states.addProperty("idle", "Idle");
		states.addProperty("jump", "Flap");
		states.addProperty("land", "Land");
		states.addProperty("blendSeconds", 0.2);
		m.add("states", states);
		JsonArray particles = new JsonArray();
		JsonObject particle = new JsonObject();
		particle.addProperty("bone", 1);
		particle.addProperty("at", "tail");
		particle.addProperty("particle", "minecraft:end_rod");
		particle.addProperty("perSecond", 2);
		JsonArray only = new JsonArray();
		only.add("Idle");
		particle.add("states", only);
		particles.add(particle);
		m.add("particles", particles);
		return m;
	}

	private static JsonObject bone(String name, int parent, double px, double py, double pz, double tx, double ty, double tz) {
		JsonObject b = new JsonObject();
		b.addProperty("name", name);
		b.addProperty("parent", parent);
		JsonArray pivot = new JsonArray();
		pivot.add(px);
		pivot.add(py);
		pivot.add(pz);
		JsonArray tail = new JsonArray();
		tail.add(tx);
		tail.add(ty);
		tail.add(tz);
		b.add("pivot", pivot);
		b.add("tail", tail);
		return b;
	}

	private static JsonObject clip(int fps, int frames, boolean loop, String keys, String values) {
		JsonObject c = new JsonObject();
		c.addProperty("fps", fps);
		c.addProperty("frames", frames);
		c.addProperty("loop", loop);
		JsonArray tracks = new JsonArray();
		JsonObject track = new JsonObject();
		track.addProperty("bone", 1);
		JsonObject rot = new JsonObject();
		rot.addProperty("keys", keys);
		rot.addProperty("values", values);
		track.add("rot", rot);
		tracks.add(track);
		c.add("tracks", tracks);
		return c;
	}

	private static String i16(int... values) {
		ByteBuffer buffer = ByteBuffer.allocate(values.length * 2).order(ByteOrder.LITTLE_ENDIAN);
		for (int v : values) buffer.putShort((short) v);
		return Base64.getEncoder().encodeToString(buffer.array());
	}

	private static String u16(int... values) {
		return i16(values);
	}

	private static String i8(int... values) {
		byte[] bytes = new byte[values.length];
		for (int i = 0; i < values.length; i++) bytes[i] = (byte) values[i];
		return Base64.getEncoder().encodeToString(bytes);
	}

	private static String u8(int... values) {
		return i8(values);
	}

	/** Ein kleines RGBA-PNG (Bilder untereinander, je Bild eine andere Farbe), als Base64 */
	private static String png(int width, int height, int frames) {
		try {
			ByteArrayOutputStream raw = new ByteArrayOutputStream();
			int h = height * frames;
			for (int y = 0; y < h; y++) {
				raw.write(0);
				for (int x = 0; x < width; x++) {
					raw.write((x * 16) & 0xFF);
					raw.write(y / height == 0 ? 200 : 90);
					raw.write(255 - (x * 8 & 0xFF));
					raw.write(255);
				}
			}
			java.util.zip.Deflater deflater = new java.util.zip.Deflater();
			deflater.setInput(raw.toByteArray());
			deflater.finish();
			ByteArrayOutputStream zipped = new ByteArrayOutputStream();
			byte[] buffer = new byte[4096];
			while (!deflater.finished()) zipped.write(buffer, 0, deflater.deflate(buffer));
			ByteArrayOutputStream out = new ByteArrayOutputStream();
			out.write(new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A});
			ByteBuffer ihdr = ByteBuffer.allocate(13).putInt(width).putInt(h).put((byte) 8).put((byte) 6).put((byte) 0).put((byte) 0).put((byte) 0);
			chunk(out, "IHDR", ihdr.array());
			chunk(out, "IDAT", zipped.toByteArray());
			chunk(out, "IEND", new byte[0]);
			return Base64.getEncoder().encodeToString(out.toByteArray());
		} catch (java.io.IOException e) {
			throw new IllegalStateException(e);
		}
	}

	private static void chunk(ByteArrayOutputStream out, String type, byte[] data) throws java.io.IOException {
		out.write(ByteBuffer.allocate(4).putInt(data.length).array());
		byte[] name = type.getBytes(StandardCharsets.US_ASCII);
		out.write(name);
		out.write(data);
		java.util.zip.CRC32 crc = new java.util.zip.CRC32();
		crc.update(name);
		crc.update(data);
		out.write(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
	}

	// ======================================================================================
	// Katalog
	// ======================================================================================

	private static void catalog(TestContext t, List<CosmeticCatalog.Item> rigs) {
		List<String> ids = rigs.stream().map(CosmeticCatalog.Item::id).toList();
		t.log("Format 2 im Katalog (" + rigs.size() + "): " + rigs.stream().map(i -> i.id() + "(" + i.slot() + ", " + i.rig().vertexCount() + " Vertices, "
				+ i.rig().boneCount() + " Knochen, " + i.rig().quadCount() + "/" + i.rig().glowQuadCount() + " Vierecke)").toList());
		Map<String, String> rejected = t.compute(mc -> CosmeticCatalog.rejected());
		check(t, "Format 2: 26 Cosmetics im Format 2 im Katalog (" + rigs.size() + "), keins verworfen (" + rejected + ")", rigs.size() == 26 && rejected.isEmpty());
		String[][] slots = {{"back", "8"}, {"companion", "12"}, {"aura", "6"}};
		List<List<String>> expected = List.of(BACK, COMPANION, AURA);
		for (int i = 0; i < slots.length; i++) {
			String slot = slots[i][0];
			List<String> missing = expected.get(i).stream().filter(id -> !ids.contains(id) || !slot.equals(t.compute(mc -> CosmeticCatalog.item(id)).slot())).toList();
			check(t, "Format 2: " + slots[i][1] + " im Slot " + slot + (missing.isEmpty() ? "" : " – fehlen: " + missing), missing.isEmpty());
		}
		check(t, "Format 2: alle mit Animation idle, Vorschaubild und Textur", t.compute(mc -> rigs.stream().allMatch(i -> i.rig().clipFor("idle") != null
				&& i.icon() != null && i.texture() != null && i.animated())));
		check(t, "Format 2: Dreiecke paarweise zu Vierecken (höchstens so viele Vierecke wie Dreiecke)", rigs.stream()
				.allMatch(i -> i.rig().quadCount() <= i.manifest().rig().triangleCount() && i.rig().quadCount() * 2 >= i.manifest().rig().triangleCount()));
		check(t, "Format 2: Begleiter haben attach (Ursprung im Body-Raum)", rigs.stream().filter(i -> i.slot().equals("companion")).allMatch(i -> i.rig().origin() != null));
		check(t, "Format 2: Leuchtebene umgerechnet (deckendes Schwarz wird durchsichtig, Farbe · Alpha bleibt die Quellfarbe)", t.compute(mc -> glowConversion()));
	}

	/**
	 * {@link CosmeticRig#glowToAlpha}: Minecraft mischt die Leuchtebene transparent, die Quellen sind additiv gedacht (deckend,
	 * Schwarz = aus). Ohne Umrechnung übermalte das Schwarz die Textur – die Cosmetics waren im Spiel dunkel und fleckig.
	 */
	private static boolean glowConversion() {
		int[] source = {0xFF000000, 0xFFFF4C08, 0xFF163C3F, 0x80FFFFFF, 0x00FFFFFF, 0xFF050505};
		try (com.mojang.blaze3d.platform.NativeImage image = new com.mojang.blaze3d.platform.NativeImage(source.length, 1, false)) {
			for (int i = 0; i < source.length; i++) image.setPixel(i, 0, source[i]);
			CosmeticRig.glowToAlpha(image);
			for (int i = 0; i < source.length; i++) {
				int in = source[i];
				int out = image.getPixel(i, 0);
				for (int shift = 0; shift <= 16; shift += 8) {
					// Beitrag beim Mischen: Quelle additiv (Farbe · Quell-Alpha), Ergebnis transparent (Farbe · Alpha)
					float want = ((in >> shift) & 0xFF) * (in >>> 24) / 255f;
					float got = ((out >> shift) & 0xFF) * (out >>> 24) / 255f;
					if (Math.abs(want - got) > 2) return false;
				}
			}
			return image.getPixel(0, 0) == 0 && image.getPixel(1, 0) == 0xFFFF4C08 && (image.getPixel(2, 0) >>> 24) == 0x3F;
		}
	}

	/** Je Slot ein Cosmetic im Format 2 anlegen (bevorzugt die bekannten aus der Übernahme) */
	private static Map<String, CosmeticCatalog.Item> wear(TestContext t, List<CosmeticCatalog.Item> rigs) throws Exception {
		Map<String, CosmeticCatalog.Item> worn = new LinkedHashMap<>();
		Map<String, List<String>> preferred = Map.of("back", List.of("seraphfluegel"), "companion", List.of("mochi", "bolt"), "aura", List.of("runenkreis"),
				"head", List.of());
		for (String slot : List.of("back", "companion", "aura", "head")) {
			CosmeticCatalog.Item item = null;
			for (String id : preferred.get(slot)) {
				CosmeticCatalog.Item found = rigs.stream().filter(i -> i.id().equals(id) && i.slot().equals(slot)).findFirst().orElse(null);
				if (found != null && Cosmetics.lockReason(found) == null) {
					item = found;
					break;
				}
			}
			if (item == null) item = rigs.stream().filter(i -> i.slot().equals(slot) && Cosmetics.lockReason(i) == null).findFirst().orElse(null);
			if (item == null) {
				t.log("Format 2: kein Cosmetic im Format 2 im Slot " + slot + " – übersprungen");
				continue;
			}
			choose(t, slot, item.id());
			check(t, "Format 2: " + item.id() + " im Slot " + slot + " angelegt", item.id().equals(t.compute(mc -> Cosmetics.mine(slot))));
			worn.put(slot, item);
		}
		return worn;
	}

	private static void choose(TestContext t, String slot, String id) throws Exception {
		t.compute(mc -> Cosmetics.choose(slot, id)).get(10, TimeUnit.SECONDS);
		t.waitSoft(mc -> java.util.Objects.equals(id, Cosmetics.mine(slot)), 10);
	}

	// ======================================================================================
	// Eigener Spieler: zeichnen und Anker
	// ======================================================================================

	private static void own(TestContext t, Map<String, CosmeticCatalog.Item> worn) {
		UUID own = t.compute(mc -> mc.player.getUUID());
		t.run(mc -> {
			mc.player.getAbilities().flying = false;
			mc.player.onUpdateAbilities();
		});
		t.waitSoft(mc -> mc.player.onGround(), 10);
		t.serverCommand("tp @p ~ ~ ~ 0 0");
		t.run(mc -> {
			face(mc, 0f);
			CosmeticRenderer.testAfk(false);
			mc.options.setCameraType(CameraType.THIRD_PERSON_FRONT);
		});
		t.waitTicks(40);
		t.run(mc -> face(mc, 0f));
		t.waitTicks(3);
		double[] feet = t.compute(mc -> new double[] {mc.player.getX(), mc.player.getY(), mc.player.getZ()});
		for (Map.Entry<String, CosmeticCatalog.Item> entry : worn.entrySet()) {
			String slot = entry.getKey();
			CosmeticCatalog.Item item = entry.getValue();
			CosmeticRig rig = item.rig();
			check(t, "Format 2: " + item.id() + " wird gezeichnet", rendering(t, own, slot));
			CosmeticRenderer.RigProbe p = probe(t, own, slot);
			t.log("Format 2: " + item.id() + " – Zustand " + p.state() + ", Animation " + p.clip() + ", Anker " + fmt(p.anchor()) + ", erster Knochen " + fmt(p.rootPivot())
					+ ", Füße " + fmt(feet));
			check(t, "Format 2: " + item.id() + " spielt idle (" + p.clip() + ")", p.clip().equals(rig.clipFor("idle")) || p.oneShot());
			switch (slot) {
				case "back" -> {
					check(t, "Format 2: Flügel am Rücken – Anker am Hals (" + fmt(p.anchor()) + ")", near(p.anchor(), feet[0], feet[1] + NECK, feet[2], 0.12));
					double[] root = expected(feet, 0f, rig.pivot(0), null, false);
					check(t, "Format 2: Flügel hinter dem Spieler (erster Knochen " + fmt(p.rootPivot()) + ", erwartet " + fmt(root) + ")",
							near(p.rootPivot(), root[0], root[1], root[2], 0.25) && p.rootPivot()[2] < feet[2] + 0.02);
				}
				case "companion" -> {
					float[] origin = rig.origin();
					double[] anchor = expected(feet, 0f, new float[3], origin, rig.mirrored());
					double side = p.anchor()[0] - feet[0];
					check(t, "Format 2: Begleiter an der Schulter (Anker " + fmt(p.anchor()) + ", erwartet " + fmt(anchor) + ")",
							near(p.anchor(), anchor[0], anchor[1], anchor[2], 0.12) && Math.abs(side) > 0.2 && Math.abs(side) < 1.5
									&& p.anchor()[1] - feet[1] > 0.9 && p.anchor()[1] - feet[1] < 2.4);
				}
				case "aura" -> check(t, "Format 2: Aura um die Füße (Anker " + fmt(p.anchor()) + ")", near(p.anchor(), feet[0], feet[1], feet[2], 0.06));
				default -> check(t, "Format 2: Kopf-Cosmetic über dem Hals (" + fmt(p.anchor()) + ")", near(p.anchor(), feet[0], feet[1] + NECK, feet[2], 0.15));
			}
		}
		t.screenshot("heldix-f2-01-vorn");
		t.run(mc -> mc.options.setCameraType(CameraType.THIRD_PERSON_BACK));
		t.waitTicks(10);
		t.screenshot("heldix-f2-02-hinten");
		// bewegt sich
		for (String slot : worn.keySet()) {
			float a = probe(t, own, slot).pose();
			t.waitTicks(8);
			float b = probe(t, own, slot).pose();
			check(t, "Format 2: " + worn.get(slot).id() + " ist animiert (" + a + " → " + b + ")", Math.abs(a - b) > 1e-3);
		}
		// unsichtbar, Zuschauer, F1: nichts
		t.serverCommand("effect give @p minecraft:invisibility 30 0 true");
		check(t, "Format 2: unsichtbar ohne Cosmetics", worn.keySet().stream().noneMatch(slot -> rendering(t, own, slot)));
		t.serverCommand("effect clear @p");
		t.run(mc -> mc.gui.hud.toggle());
		check(t, "Format 2: mit F1 ausgeblendet", worn.keySet().stream().noneMatch(slot -> rendering(t, own, slot)));
		t.run(mc -> mc.gui.hud.toggle());
		check(t, "Format 2: wieder sichtbar", worn.keySet().stream().allMatch(slot -> rendering(t, own, slot)));
	}

	/**
	 * Erwartete Weltlage eines Punktes im Body-Raum (Pixel) eines stehenden Spielers mit Body-Yaw {@code yaw}: wie das
	 * Spielermodell (Drehung 180° − Yaw, Spiegelung, 0,9375-fach, Hals 1,501 Blöcke über den Füßen im Modell).
	 */
	private static double[] expected(double[] feet, float yaw, float[] point, float[] origin, boolean mirrored) {
		double x = point[0] + (origin == null ? 0 : origin[0]);
		double y = point[1] + (origin == null ? 0 : origin[1]);
		double z = point[2] + (origin == null ? 0 : origin[2]);
		if (mirrored) x = -x;
		double mx = -x / 16;
		double my = -(y / 16 - 1.501);
		double mz = z / 16;
		double a = Math.toRadians(180 - yaw);
		double wx = mx * Math.cos(a) + mz * Math.sin(a);
		double wz = -mx * Math.sin(a) + mz * Math.cos(a);
		return new double[] {feet[0] + wx * 0.9375, feet[1] + my * 0.9375, feet[2] + wz * 0.9375};
	}

	// ======================================================================================
	// Zustände
	// ======================================================================================

	private static void states(TestContext t, Map<String, CosmeticCatalog.Item> worn) throws Exception {
		UUID own = t.compute(mc -> mc.player.getUUID());
		CosmeticCatalog.Item wings = worn.get("back");
		CosmeticCatalog.Item companion = worn.get("companion");
		CosmeticCatalog.Item aura = worn.get("aura");
		t.run(mc -> {
			mc.options.setCameraType(CameraType.THIRD_PERSON_FRONT);
			face(mc, 0f);
		});
		if (wings != null) {
			CosmeticRig rig = wings.rig();
			// schleichen → sneak (Flügel: Fold)
			t.run(mc -> mc.options.keyShift.setDown(true));
			boolean sneak = t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("sneak")) && "sneak".equals(state(own, "back")), 4);
			check(t, "Format 2: schleichen → " + rig.clipFor("sneak") + " (" + state(t, own, "back") + " / " + clip(t, own, "back") + ")", sneak);
			double[] auraSneak = aura != null ? probe(t, own, "aura").anchor() : null;
			t.waitTicks(10);
			t.screenshot("heldix-f2-03-schleichen");
			t.run(mc -> mc.options.keyShift.setDown(false));
			t.waitSoft(mc -> "idle".equals(state(own, "back")), 4);
			if (aura != null) {
				double[] auraStand = probe(t, own, "aura").anchor();
				check(t, "Format 2: Aura kippt beim Schleichen nicht mit (Füße " + fmt(auraStand) + " / schleichend " + fmt(auraSneak) + ")",
						distance(auraSneak, auraStand[0], auraStand[1], auraStand[2]) < 0.03);
			}
			// Überblenden: nach dem Wechsel kurz übergeblendet, dann wieder idle
			check(t, "Format 2: zurück zu idle (" + clip(t, own, "back") + ")", t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("idle")), 3));

			// springen → jump (Flap)
			t.run(mc -> mc.player.jumpFromGround());
			boolean jump = t.waitSoft(mc -> "jump".equals(state(own, "back")) && clip(own, "back").equals(rig.clipFor("jump")), 2);
			check(t, "Format 2: springen → " + rig.clipFor("jump") + " (" + state(t, own, "back") + " / " + clip(t, own, "back") + ")", jump);
			t.waitSoft(mc -> mc.player.onGround(), 5);
			t.waitTicks(20);

			// fallen und landen → fall, dann land (einmalig)
			t.serverCommand("tp @p ~ ~8 ~");
			boolean fall = t.waitSoft(mc -> "fall".equals(state(own, "back")), 3);
			check(t, "Format 2: fallen → " + rig.clipFor("fall") + " (" + state(t, own, "back") + ")", fall);
			if (rig.has("land")) {
				boolean land = t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("land")), 5);
				check(t, "Format 2: landen → " + rig.clipFor("land") + " einmalig (" + clip(t, own, "back") + ")", land && oneShot(t, own, "back"));
				check(t, "Format 2: nach dem Landen zurück zu idle", t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("idle")),
						(int) Math.ceil(rig.clipSeconds(rig.clipFor("land")) + 2)));
			}

			// Schaden → hurt (im Überlebensmodus)
			if (rig.has("hurt")) {
				t.serverCommand("gamemode survival @p");
				t.serverCommand("damage @p 1 minecraft:generic");
				boolean hurt = t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("hurt")), 3);
				check(t, "Format 2: Schaden → " + rig.clipFor("hurt") + " (" + clip(t, own, "back") + ")", hurt);
				t.serverCommand("effect give @p minecraft:instant_health 1 1 true");
				t.serverCommand("gamemode creative @p");
				t.waitTicks(30);
			}

			// Jubeln (wie bei einem neuen Fortschritt): einmalig, läuft zu Ende und kehrt zurück
			if (rig.has("celebrate")) {
				t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("idle")), 3);
				t.run(mc -> CosmeticRenderer.testCelebrate());
				boolean celebrate = t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("celebrate")), 2);
				check(t, "Format 2: Jubeln → " + rig.clipFor("celebrate") + " (" + clip(t, own, "back") + ")", celebrate && oneShot(t, own, "back"));
				t.waitTicks(6);
				t.screenshot("heldix-f2-04-jubeln");
				int seconds = (int) Math.ceil(rig.clipSeconds(rig.clipFor("celebrate")) + 1.5);
				check(t, "Format 2: einmalige Animation läuft zu Ende und kehrt zu idle zurück", t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("idle")), seconds));
			}

			// Emote des Emote-Rads → emote
			if (rig.has("emote")) {
				System.setProperty(EMOTE_PROPERTY, "WINKEN;1.000");
				boolean emote = t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("emote")), 2);
				check(t, "Format 2: Emote → " + rig.clipFor("emote") + " (" + clip(t, own, "back") + ")", emote);
				t.waitTicks(20);
				t.screenshot("heldix-f2-05-emote");
				System.setProperty(EMOTE_PROPERTY, "");
				check(t, "Format 2: Emote vorbei → idle", t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("idle")), 3));
			}

			// Creative-Flug: start_flying (einmalig), dann creative_fly
			// Auf dem eingebauten Server in einem Schritt anheben und den Flug einschalten: Der Client bekommt erst die neue
			// Position und dann die Fähigkeiten – so steht er nie mit „fliegen“ am Boden (dort beendet Minecraft den Flug sofort)
			t.run(mc -> {
				java.util.UUID self = mc.player.getUUID();
				net.minecraft.client.server.IntegratedServer server = mc.getSingleplayerServer();
				server.execute(() -> {
					net.minecraft.server.level.ServerPlayer sp = server.getPlayerList().getPlayer(self);
					if (sp == null) return;
					sp.teleportTo(sp.getX(), sp.getY() + 3, sp.getZ());
					sp.getAbilities().flying = true;
					sp.onUpdateAbilities();
				});
			});
			t.waitSoft(mc -> mc.player.getAbilities().flying, 3);
			if (rig.has("start_flying")) {
				boolean start = t.waitSoft(mc -> clip(own, "back").equals(rig.clipFor("start_flying")), 3);
				check(t, "Format 2: Abheben → " + rig.clipFor("start_flying") + " (" + clip(t, own, "back") + ")", start);
			}
			boolean fly = t.waitSoft(mc -> "creative_fly".equals(state(own, "back")) && clip(own, "back").equals(rig.clipFor("creative_fly")),
					(int) Math.ceil(rig.clipSeconds(rig.clipFor("start_flying")) + 3));
			check(t, "Format 2: Creative-Flug → " + rig.clipFor("creative_fly") + " (" + state(t, own, "back") + " / " + clip(t, own, "back") + ")", fly);
			t.waitTicks(10);
			t.screenshot("heldix-f2-06-fliegen");
			t.run(mc -> {
				java.util.UUID self = mc.player.getUUID();
				net.minecraft.client.server.IntegratedServer server = mc.getSingleplayerServer();
				server.execute(() -> {
					net.minecraft.server.level.ServerPlayer sp = server.getPlayerList().getPlayer(self);
					if (sp == null) return;
					sp.getAbilities().flying = false;
					sp.onUpdateAbilities();
				});
			});
			t.waitSoft(mc -> mc.player.onGround(), 8);
			t.waitTicks(40);
		}

		// AFK (eigener Spieler, 30 s ohne Eingabe) → afk (Begleiter: Sleep)
		if (companion != null && companion.rig().has("afk")) {
			CosmeticRig rig = companion.rig();
			t.run(mc -> CosmeticRenderer.testAfk(true));
			boolean afk = t.waitSoft(mc -> "afk".equals(state(own, "companion")) && clip(own, "companion").equals(rig.clipFor("afk")), 4);
			check(t, "Format 2: AFK → " + rig.clipFor("afk") + " (" + state(t, own, "companion") + " / " + clip(t, own, "companion") + ")", afk);
			t.waitTicks(20);
			t.screenshot("heldix-f2-07-afk");
			t.run(mc -> CosmeticRenderer.testAfk(false));
			check(t, "Format 2: nach einer Eingabe nicht mehr AFK", t.waitSoft(mc -> !"afk".equals(state(own, "companion")), 3));
		}

		// Ablegen und Anlegen: Aura disable/enable, Begleiter summon
		if (aura != null && aura.rig().has("disable")) {
			CosmeticRig rig = aura.rig();
			choose(t, "aura", null);
			boolean leaving = t.waitSoft(mc -> {
				CosmeticRenderer.RigProbe p = CosmeticRenderer.rigProbe(own, "aura");
				return p != null && p.leaving() && p.clip().equals(rig.clipFor("disable"));
			}, 2);
			check(t, "Format 2: Aura ablegen → " + rig.clipFor("disable") + ", danach weg", leaving
					&& t.waitSoft(mc -> CosmeticRenderer.rigProbe(own, "aura") == null, (int) Math.ceil(rig.clipSeconds(rig.clipFor("disable")) + 2)));
			choose(t, "aura", aura.id());
			if (rig.has("enable")) {
				check(t, "Format 2: Aura anlegen → " + rig.clipFor("enable"), t.waitSoft(mc -> rig.clipFor("enable").equals(clip(own, "aura")), 3));
			}
		}
		if (companion != null && companion.rig().has("summon")) {
			CosmeticRig rig = companion.rig();
			choose(t, "companion", null);
			t.waitSoft(mc -> CosmeticRenderer.rigProbe(own, "companion") == null, 4);
			choose(t, "companion", companion.id());
			boolean summon = t.waitSoft(mc -> rig.clipFor("summon").equals(clip(own, "companion")), 3);
			check(t, "Format 2: Begleiter anlegen → " + rig.clipFor("summon") + " (" + clip(t, own, "companion") + ")", summon);
			t.waitTicks(10);
			t.screenshot("heldix-f2-08-herbeirufen");
		}
	}

	// ======================================================================================
	// Partikel
	// ======================================================================================

	private static void particles(TestContext t, Map<String, CosmeticCatalog.Item> worn) {
		UUID own = t.compute(mc -> mc.player.getUUID());
		t.run(mc -> {
			face(mc, 0f);
			mc.options.setCameraType(CameraType.THIRD_PERSON_FRONT);
		});
		// in idle laufen nicht immer Partikel: notfalls mit dem Emote (die meisten haben dort welche)
		boolean idle = worn.values().stream().anyMatch(i -> i.rig().particlesIn("idle") > 0);
		boolean emote = !idle && worn.values().stream().anyMatch(i -> i.rig().has("emote") && i.rig().particlesIn("emote") > 0);
		if (!idle && !emote) {
			t.log("Format 2: Die getragenen Cosmetics haben weder in idle noch im Emote Partikel – Prüfung übersprungen");
			return;
		}
		if (emote) System.setProperty(EMOTE_PROPERTY, "WINKEN;1.000");
		t.waitTicks(10);
		long first = spawned(t, own, worn);
		t.waitTicks(60);
		long second = spawned(t, own, worn);
		check(t, "Format 2: Partikel an Knochen (" + (second - first) + " in 3 s" + (emote ? ", im Emote" : "") + ")", second > first);
		t.screenshot("heldix-f2-09-partikel");
		t.run(mc -> mc.options.particles().set(ParticleStatus.MINIMAL));
		t.waitTicks(5);
		long third = spawned(t, own, worn);
		t.waitTicks(40);
		long fourth = spawned(t, own, worn);
		check(t, "Format 2: Partikel-Einstellung „Minimal“ – keine (" + (fourth - third) + ")", fourth == third);
		t.run(mc -> mc.options.particles().set(ParticleStatus.ALL));
		// im Inventar (Menüfigur) keine Partikel
		t.serverCommand("gamemode survival @p");
		t.run(mc -> {
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			mc.gui.setScreen(new net.minecraft.client.gui.screens.inventory.InventoryScreen(mc.player));
		});
		t.waitTicks(20);
		long fifth = spawned(t, own, worn);
		t.waitTicks(40);
		long sixth = spawned(t, own, worn);
		t.screenshot("heldix-f2-10-inventar");
		check(t, "Format 2: im Inventar keine Partikel (" + (sixth - fifth) + ")", sixth == fifth);
		t.setScreen(() -> null);
		t.serverCommand("gamemode creative @p");
		System.setProperty(EMOTE_PROPERTY, "");
	}

	private static long spawned(TestContext t, UUID uuid, Map<String, CosmeticCatalog.Item> worn) {
		return t.compute(mc -> {
			long sum = 0;
			for (String slot : worn.keySet()) {
				CosmeticRenderer.RigProbe p = CosmeticRenderer.rigProbe(uuid, slot);
				if (p != null) sum += p.particles();
			}
			return sum;
		});
	}

	// ======================================================================================
	// Anderer Spieler
	// ======================================================================================

	private static JsonObject lookup(String head, String back, String aura, String companion) {
		JsonObject entry = new JsonObject();
		entry.addProperty("cape", "");
		entry.add("badge", JsonNull.INSTANCE);
		JsonObject cosmetics = new JsonObject();
		String[] slots = {"head", "back", "aura", "companion"};
		String[] ids = {head, back, aura, companion};
		for (int i = 0; i < 4; i++) {
			if (ids[i] == null) cosmetics.add(slots[i], JsonNull.INSTANCE);
			else cosmetics.add(slots[i], new JsonPrimitive(ids[i]));
		}
		entry.add("cosmetics", cosmetics);
		return entry;
	}

	private static void other(TestContext t, Map<String, CosmeticCatalog.Item> worn, List<RemotePlayer> remotes) {
		UUID uuid = UUID.nameUUIDFromBytes("HeldixFormat2:Freund".getBytes(StandardCharsets.UTF_8));
		String back = worn.containsKey("back") ? worn.get("back").id() : null;
		String aura = worn.containsKey("aura") ? worn.get("aura").id() : null;
		String companion = worn.containsKey("companion") ? worn.get("companion").id() : null;
		t.run(mc -> {
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			face(mc, 0f);
			mc.player.setXRot(12f);
			mc.player.xRotO = 12f;
			Social.testLookup(uuid, lookup(null, back, aura, companion));
			RemotePlayer remote = new RemotePlayer(mc.level, new GameProfile(uuid, "Format2"));
			remote.setId(-4700);
			remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3.2, 180f, 0f);
			remote.yBodyRot = 180f;
			remote.yHeadRot = 180f;
			mc.level.addEntity(remote);
			remotes.add(remote);
		});
		RemotePlayer remote = remotes.getLast();
		t.waitTicks(30);
		double[] feet = t.compute(mc -> new double[] {remote.getX(), remote.getY(), remote.getZ()});
		for (Map.Entry<String, CosmeticCatalog.Item> entry : worn.entrySet()) {
			String slot = entry.getKey();
			if (slot.equals("head")) continue;
			check(t, "Format 2: anderer Spieler – " + entry.getValue().id() + " gezeichnet", rendering(t, uuid, slot));
			CosmeticRenderer.RigProbe p = probe(t, uuid, slot);
			if (slot.equals("aura")) check(t, "Format 2: anderer Spieler – Aura an den Füßen (" + fmt(p.anchor()) + ")", near(p.anchor(), feet[0], feet[1], feet[2], 0.06));
			if (slot.equals("back")) check(t, "Format 2: anderer Spieler – Flügel am Hals (" + fmt(p.anchor()) + ")", near(p.anchor(), feet[0], feet[1] + NECK, feet[2], 0.12));
			if (slot.equals("companion")) {
				CosmeticRig rig = entry.getValue().rig();
				double[] anchor = expected(feet, 180f, new float[3], rig.origin(), rig.mirrored());
				check(t, "Format 2: anderer Spieler – Begleiter an der Schulter (" + fmt(p.anchor()) + ", erwartet " + fmt(anchor) + ")",
						near(p.anchor(), anchor[0], anchor[1], anchor[2], 0.12));
			}
		}
		t.screenshot("heldix-f2-11-anderer");
		// je Cosmetic im Format 2 ein Bild aus der Nähe (Flügel von hinten, Begleiter von der Seite, Auren von vorn)
		List<CosmeticCatalog.Item> all = t.compute(mc -> CosmeticCatalog.items().stream().filter(i -> i.rig() != null).toList());
		for (CosmeticCatalog.Item item : all) {
			float yaw = switch (item.slot()) {
				case "back" -> 20f;
				case "companion" -> 150f;
				default -> 180f;
			};
			t.run(mc -> {
				Social.testLookup(uuid, lookup(item.slot().equals("head") ? item.id() : null, item.slot().equals("back") ? item.id() : null,
						item.slot().equals("aura") ? item.id() : null, item.slot().equals("companion") ? item.id() : null));
				remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 2.6, yaw, 0f);
				remote.yBodyRot = yaw;
				remote.yBodyRotO = yaw;
				remote.yHeadRot = yaw;
				remote.yHeadRotO = yaw;
			});
			t.waitTicks(25);
			t.screenshot("heldix-f2-slot-" + item.slot() + "-" + item.id());
		}
		// Partikel anderer nur in der Nähe
		t.run(mc -> {
			Social.testLookup(uuid, lookup(null, back, aura, companion));
			remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 52, 180f, 0f);
		});
		t.waitTicks(10);
		if (worn.containsKey("back") && rendering(t, uuid, "back")) {
			long a = spawned(t, uuid, worn);
			t.waitTicks(40);
			long b = spawned(t, uuid, worn);
			check(t, "Format 2: anderer Spieler in 52 Blöcken – keine Partikel (" + (b - a) + ")", a == b);
		} else t.log("Format 2: Spieler in 52 Blöcken wird nicht gezeichnet (Sichtweite) – Prüfung der Partikel-Entfernung übersprungen");
		t.run(mc -> remote.snapTo(mc.player.getX(), mc.player.getY(), mc.player.getZ() + 3.2, 180f, 0f));
	}

	// ======================================================================================
	// Cosmetics-Menü
	// ======================================================================================

	private static void menu(TestContext t, List<CosmeticCatalog.Item> rigs, Map<String, CosmeticCatalog.Item> worn) {
		// Im kleinen Testfenster passen Figur und Kacheln nicht gleichzeitig auf die Seite (die Figur scrollt weg):
		// für diesen Teil größer und mit fester GUI-Skalierung 2.
		int[] window = t.compute(mc -> new int[] {mc.getWindow().getScreenWidth(), mc.getWindow().getScreenHeight()});
		int scale = t.compute(mc -> mc.options.guiScale().get());
		t.run(mc -> {
			mc.options.guiScale().set(2);
			mc.getWindow().setWindowed(window[0] + 600, window[1] + 420);
		});
		boolean resized = t.waitSoft(mc -> mc.getWindow().getScreenWidth() != window[0], 5);
		t.waitTicks(6);
		try {
			if (!resized) t.log("Format 2: Fenster ließ sich nicht vergrößern – Menü-Vorschau im kleinen Fenster");
			menuChecks(t, rigs, worn);
		} finally {
			t.run(mc -> {
				mc.getWindow().setWindowed(window[0], window[1]);
				mc.options.guiScale().set(scale);
			});
			t.waitSoft(mc -> mc.getWindow().getScreenWidth() == window[0], 5);
			t.waitTicks(6);
		}
	}

	private static void menuChecks(TestContext t, List<CosmeticCatalog.Item> rigs, Map<String, CosmeticCatalog.Item> worn) {
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.COSMETICS));
		t.waitTicks(10);
		for (String slot : List.of("back", "companion", "aura")) {
			CosmeticCatalog.Item hover = rigs.stream().filter(i -> i.slot().equals(slot) && (worn.get(slot) == null || !i.id().equals(worn.get(slot).id())))
					.findFirst().orElse(null);
			if (hover == null) continue;
			openTab(t, slot);
			// Die Kacheln können sich nach dem Reiterwechsel noch verschieben (Katalog, Bilder): Mitte neu lesen und höchstens
			// dreimal hinfahren, bis die richtige Kachel unter der Maus liegt
			boolean onTile = false;
			for (int attempt = 0; attempt < 3 && !onTile; attempt++) {
				int index = index(t, slot, hover.id());
				int[] center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticCenter(index));
				t.moveMouse(center[0], center[1]);
				t.waitTicks(8);
				onTile = hover.id().equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticHovered()));
			}
			check(t, "Format 2: Kachel " + hover.id() + " im Slot " + slot + " unter der Maus", onTile);
			String expectedClip = hover.rig().clipFor("emote");
			boolean emote = t.waitSoft(mc -> {
				String[] shown = CosmeticRenderer.menuRig(slot);
				return shown != null && shown[0].equals(hover.id()) && shown[1].equals(expectedClip);
			}, 3);
			String[] shown = t.compute(mc -> CosmeticRenderer.menuRig(slot));
			check(t, "Format 2: Vorschau beim Darüberfahren spielt " + expectedClip + " (" + (shown == null ? "keine Figur" : String.join(" / ", shown)) + ")", emote);
			t.waitTicks(20);
			t.screenshot("heldix-f2-12-menue-" + slot);
			t.moveMouse(5, 5);
			t.waitTicks(10);
			if (worn.get(slot) != null) {
				CosmeticCatalog.Item own = worn.get(slot);
				boolean idle = t.waitSoft(mc -> {
					String[] s = CosmeticRenderer.menuRig(slot);
					return s != null && s[0].equals(own.id()) && s[1].equals(own.rig().clipFor("idle"));
				}, 3);
				check(t, "Format 2: Vorschau ohne Maus zeigt das getragene " + own.id() + " in idle", idle);
			}
		}
		t.setScreen(() -> null);
	}

	/** Reiter der Seite Cosmetics anklicken */
	private static void openTab(TestContext t, String slot) {
		String id = "cosmetics:" + slot.toUpperCase(Locale.ROOT);
		for (int i = 0; i < 3 && !slot.equals(t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).cosmeticTab())); i++) {
			int[] center = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).tabCenter(id));
			t.click(center[0], center[1]);
			t.waitTicks(3);
		}
	}

	/** Index der Kachel (0 = Ohne) */
	private static int index(TestContext t, String slot, String id) {
		List<CosmeticCatalog.Item> items = t.compute(mc -> CosmeticCatalog.items(slot));
		for (int i = 0; i < items.size(); i++) if (items.get(i).id().equals(id)) return i + 1;
		throw new AssertionError("Kein Cosmetic " + id + " im Slot " + slot);
	}

	// ======================================================================================
	// Leistung: 20 Spieler mit Cosmetics im Format 2
	// ======================================================================================

	private static void performance(TestContext t, List<CosmeticCatalog.Item> rigs, List<RemotePlayer> remotes) {
		List<String> backs = rigs.stream().filter(i -> i.slot().equals("back")).map(CosmeticCatalog.Item::id).toList();
		List<String> auras = rigs.stream().filter(i -> i.slot().equals("aura")).map(CosmeticCatalog.Item::id).toList();
		List<String> companions = rigs.stream().filter(i -> i.slot().equals("companion")).map(CosmeticCatalog.Item::id).toList();
		t.run(mc -> {
			mc.options.setCameraType(CameraType.FIRST_PERSON);
			face(mc, 0f);
			mc.player.setXRot(10f);
			for (int i = 0; i < 20; i++) {
				UUID uuid = UUID.nameUUIDFromBytes(("HeldixFormat2:Menge" + i).getBytes(StandardCharsets.UTF_8));
				Social.testLookup(uuid, lookup(null, backs.isEmpty() ? null : backs.get(i % backs.size()), auras.isEmpty() ? null : auras.get(i % auras.size()),
						companions.isEmpty() ? null : companions.get(i % companions.size())));
				RemotePlayer remote = new RemotePlayer(mc.level, new GameProfile(uuid, "F2Menge" + i));
				remote.setId(-4800 - i);
				double x = mc.player.getX() + (i % 5 - 2) * 1.8;
				double z = mc.player.getZ() + 5 + (i / 5) * 2.2;
				float yaw = 150f + (i * 23) % 60;
				remote.snapTo(x, mc.player.getY(), z, yaw, 0f);
				remote.yBodyRot = yaw;
				remote.yHeadRot = yaw;
				mc.level.addEntity(remote);
				remotes.add(remote);
			}
		});
		t.waitTicks(40);
		t.screenshot("heldix-f2-13-20-spieler");
		AtomicLong frames = new AtomicLong();
		HudEvents.RENDER.register((g, delta) -> frames.incrementAndGet());
		t.waitTicks(10);
		t.run(mc -> {
			CosmeticRenderer.submitNanos = 0;
			CosmeticRenderer.emitNanos = 0;
			CosmeticRenderer.emittedVertices = 0;
		});
		long start = frames.get();
		t.waitTicks(60);
		long count = frames.get() - start;
		long[] with = t.compute(mc -> new long[] {CosmeticRenderer.submitNanos, CosmeticRenderer.emitNanos, CosmeticRenderer.emittedVertices});
		double submit = with[0] / 1000.0 / Math.max(1, count);
		double emit = with[1] / 1000.0 / Math.max(1, count);
		double vertices = (double) with[2] / Math.max(1, count);
		t.log(String.format(Locale.ROOT, "Format 2: Leistung mit 20 Spielern: %d Bilder in 3 s; je Bild %.1f µs Einreichen + %.1f µs Vertices (%.0f Vertices)",
				count, submit, emit, vertices));
		// mit Iris-Shaderpack zeichnet der Schatten-Durchgang alle Spieler ein zweites Mal
		boolean iris = t.compute(mc -> dev.heldixclient.render.IrisCompat.shaderPackActive());
		int limit = iris ? 16 : 8;
		check(t, "Format 2: 20 Spieler mit Meshes kosten weniger als " + limit + " ms je Bild" + (iris ? " (mit Iris-Schatten)" : "") + " ("
				+ Math.round(submit + emit) + " µs)", submit + emit < limit * 1000);
	}

	// ======================================================================================
	// Hilfen
	// ======================================================================================

	private static void face(Minecraft mc, float yaw) {
		mc.player.setYRot(yaw);
		mc.player.yRotO = yaw;
		mc.player.setYBodyRot(yaw);
		mc.player.yBodyRotO = yaw;
		mc.player.setYHeadRot(yaw);
		mc.player.yHeadRotO = yaw;
		mc.player.setXRot(0f);
		mc.player.xRotO = 0f;
	}

	private static CosmeticRenderer.RigProbe probe(TestContext t, UUID uuid, String slot) {
		t.waitTicks(3);
		CosmeticRenderer.RigProbe probe = t.compute(mc -> CosmeticRenderer.rigProbe(uuid, slot));
		if (probe == null) throw new AssertionError("Keine Messwerte (Format 2) für " + uuid + " im Slot " + slot);
		return probe;
	}

	/** Aktuelle Animation (Render-Thread), "" = keine */
	private static String clip(UUID uuid, String slot) {
		CosmeticRenderer.RigProbe p = CosmeticRenderer.rigProbe(uuid, slot);
		return p == null ? "" : p.clip();
	}

	private static String clip(TestContext t, UUID uuid, String slot) {
		return t.compute(mc -> clip(uuid, slot));
	}

	private static String state(UUID uuid, String slot) {
		CosmeticRenderer.RigProbe p = CosmeticRenderer.rigProbe(uuid, slot);
		return p == null ? "" : p.state();
	}

	private static String state(TestContext t, UUID uuid, String slot) {
		return t.compute(mc -> state(uuid, slot));
	}

	private static boolean oneShot(TestContext t, UUID uuid, String slot) {
		return t.compute(mc -> {
			CosmeticRenderer.RigProbe p = CosmeticRenderer.rigProbe(uuid, slot);
			return p != null && p.oneShot();
		});
	}

	/** Wird das Cosmetic im Slot gerade in der Welt gezeichnet? (Zeitstempel ändert sich über einige Bilder) */
	private static boolean rendering(TestContext t, UUID uuid, String slot) {
		t.waitTicks(4);
		long first = t.compute(mc -> {
			CosmeticRenderer.RigProbe p = CosmeticRenderer.rigProbe(uuid, slot);
			return p == null ? 0L : p.frame();
		});
		t.waitTicks(6);
		long second = t.compute(mc -> {
			CosmeticRenderer.RigProbe p = CosmeticRenderer.rigProbe(uuid, slot);
			return p == null ? 0L : p.frame();
		});
		return second > first;
	}

	private static boolean near(double[] p, double x, double y, double z, double tolerance) {
		return p != null && distance(p, x, y, z) <= tolerance;
	}

	private static double distance(double[] p, double x, double y, double z) {
		if (p == null) return Double.MAX_VALUE;
		return Math.sqrt((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) + (p[2] - z) * (p[2] - z));
	}

	private static String fmt(double[] p) {
		return p == null ? "–" : String.format(Locale.ROOT, "(%.3f, %.3f, %.3f)", p[0], p[1], p[2]);
	}
}
