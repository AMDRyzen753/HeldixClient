package dev.heldixclient.cosmetic;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.google.gson.Strictness;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.security.PublicKey;
import java.security.Signature;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Heldix-Cosmetics (Format 1): signierter Umschlag und strenge Prüfung des Manifests – eine genaue Nachbildung von
 * service/src/cosmetics-format.ts (dieselben Regeln, Grenzen und Meldungen wie Dienst, Launcher und Webseite).
 *
 * <p>Ein Cosmetic ist reine Daten (Modell, Textur, Partikel). Das Team signiert es mit dem Update-Schlüssel: Ed25519 über
 * die UTF-8-Bytes von {@code "heldix-cosmetic\n" + manifest}. Alle Werte stehen hier so, wie JavaScript sie sieht (Zahlen
 * als double, Texte als UTF-16), damit Grenzfälle gleich ausgehen.
 */
public final class CosmeticFormat {
	public static final String SIGNATURE_PREFIX = "heldix-cosmetic\n";
	public static final String TYPE = "heldix-cosmetic";
	public static final int FORMAT = 1;
	public static final List<String> SLOTS = List.of("head", "back", "aura", "companion", "cape");
	public static final List<String> MODEL_SLOTS = List.of("head", "back", "companion");
	/**
	 * Wer ein Cosmetic tragen darf: alle, nur das Team oder (ab 0.13.7) nur, wer es freigeschaltet hat ("unlock",
	 * Belohnungen für Einladungen). HeldixClient bis 0.13.6 kennt "unlock" nicht und verwirft nur diese Einträge.
	 */
	public static final List<String> ACCESS = List.of("all", "team", "unlock");
	public static final List<String> ANIMATION_TYPES = List.of("flap", "sway", "spin", "bob");
	public static final List<String> ANIMATION_AXES = List.of("x", "y", "z");
	public static final List<String> PARTICLE_MOTIONS = List.of("rise", "fall", "orbit", "spark", "float");
	public static final List<String> BUILTIN_CAPE_IDS = List.of("heldix", "mitternacht", "aurora", "glut", "kristall", "neon", "sakura", "gewitter", "galaxie", "matrix", "matrix_rot", "matrix_tuerkis", "sakura_orange");

	public static final Pattern ID_RE = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$");
	private static final Pattern BONE_NAME_RE = Pattern.compile("^[a-z0-9_]{1,24}$");
	private static final Pattern COLOR_RE = Pattern.compile("^#[0-9a-fA-F]{6}$");
	private static final Pattern SIGNATURE_RE = Pattern.compile("^[A-Za-z0-9+/]{85}[AQgw]==$");
	public static final String PNG_DATA_URL_PREFIX = "data:image/png;base64,";
	/** Steuerzeichen (auch Zeilenumbrüche), Zeilen-/Absatztrenner, Schreibrichtung, einzelne Ersatzzeichen */
	private static final Pattern FORBIDDEN_TEXT_RE = Pattern.compile("[\\p{Cc}\\p{Cs}\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]");
	private static final Pattern DATE_RE = Pattern.compile(
			"^(\\d{4})-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.\\d{1,9})?)?(?:Z|[+-](\\d{2}):(\\d{2}))?)?$");
	private static final Pattern BASE64_RE = Pattern.compile("^[A-Za-z0-9+/]*={0,2}$");
	private static final List<String> MANIFEST_KEYS = List.of("type", "format", "id", "version", "slot", "name", "description", "access", "date",
			"texture", "glow", "model", "animations", "particles", "cape", "companion");

	// Grenzen (wie COSMETIC_LIMITS; 1 KB = 1024 Byte)
	public static final int ENVELOPE_BYTES = 192 * 1024;
	public static final int MANIFEST_BYTES = 160 * 1024;
	public static final int PNG_BYTES = 64 * 1024;
	private static final double VERSION_MAX = 2_147_483_647d;
	private static final int NAME_MAX = 40;
	private static final int DESCRIPTION_MAX = 300;
	private static final int TEXTURE_MIN = 8;
	private static final int TEXTURE_MAX = 512;
	private static final int TEXTURE_STEP = 8;
	private static final int[] CAPE_WIDTHS = {64, 128, 256};
	private static final int CAPE_FRAMES_MAX = 32;
	private static final int CAPE_FPS_MAX = 20;
	private static final int BONES_MAX = 64;
	private static final int CUBES_MAX = 128;
	/** Das PNG eines Modells ist model.textureSize mal 1, 2 oder 4 (UV und Box-UV zählen in Texeln von textureSize) */
	private static final int[] TEXTURE_SCALES = {1, 2, 4};
	/** model.scale (freiwillig, fehlt: 1): Größe des ganzen Modells um den Anker */
	private static final double MODEL_SCALE_MIN = 0.25;
	private static final double MODEL_SCALE_MAX = 1.5;
	private static final int CUBE_EDGE_MAX = 32;
	private static final int COORD_MAX = 48;
	private static final int ROTATION_MAX = 180;
	private static final int INFLATE_MAX = 2;
	private static final int ANIMATIONS_MAX = 16;
	private static final int AMPLITUDE_MAX = 90;
	private static final int BOB_AMPLITUDE_MAX = 8;
	private static final int SPEED_MAX = 4;
	private static final int PARTICLE_FRAMES_MAX = 8;
	private static final int RATE_MIN = 1;
	private static final int RATE_MAX = 20;
	private static final int LIFETIME_MIN = 5;
	private static final int LIFETIME_MAX = 80;
	private static final double SIZE_MIN = 0.03;
	private static final double SIZE_MAX = 0.4;
	private static final double RADIUS_MIN = 0.2;
	private static final double RADIUS_MAX = 1.5;
	private static final int OFFSET_XZ_MAX = 2;
	private static final int OFFSET_Y_MIN = 0;
	private static final int OFFSET_Y_MAX = 3;
	private static final double SCALE_MIN = 0.25;
	private static final double SCALE_MAX = 1.5;

	// ---- Format 2: Meshes mit Knochen und Keyframe-Animationen (ab 0.13.8) ----
	public static final int FORMAT_2 = 2;
	/** Slots für Format 2 (Capes bleiben bei Format 1) */
	public static final List<String> RIG_SLOTS = List.of("head", "back", "aura", "companion");
	/** Zustände des Spielers (und Übergänge), denen ein Cosmetic eine Animation zuordnen kann; idle ist Pflicht */
	public static final List<String> STATE_KEYS = List.of("idle", "walk", "sneak", "sit_or_ride", "swim", "sprint", "elytra", "jump", "fall",
			"creative_fly", "start_flying", "land", "hurt", "emote", "celebrate", "afk", "sleep", "enable", "disable", "summon");
	/** Minecraft-Partikel, die ein Cosmetic im Format 2 an Knochen erzeugen darf (ohne „minecraft:“; alle ohne Parameter außer dust) */
	public static final List<String> RIG_PARTICLES = List.of("flame", "small_flame", "soul_fire_flame", "smoke", "end_rod", "electric_spark", "dust",
			"heart", "note", "happy_villager", "cloud", "poof", "snowflake", "spore_blossom_air", "crit", "enchant", "portal", "witch", "glow",
			"falling_water", "dripping_water", "firework", "cherry_leaves", "ash", "white_ash", "soul", "sculk_soul", "lava", "falling_spore_blossom",
			"wax_on", "wax_off", "bubble_pop", "composter", "totem_of_undying", "reverse_portal");
	private static final Pattern CLIP_NAME_RE = Pattern.compile("^[A-Za-z0-9_]{1,24}$");
	/** Knochen in Format 2: 1–32 Zeichen aus A–Z, a–z, 0–9, _, . und - (Blender-Namen wie „wing.L“) */
	private static final Pattern RIG_BONE_NAME_RE = Pattern.compile("^[A-Za-z0-9_.-]{1,32}$");
	private static final List<String> MANIFEST_KEYS_2 = List.of("type", "format", "id", "version", "slot", "name", "description", "access", "date",
			"texture", "glow", "emissive", "mesh", "bones", "animations", "states", "particles", "attach");
	public static final int MANIFEST_BYTES_2 = 512 * 1024;
	public static final int ENVELOPE_BYTES_2 = 544 * 1024;
	private static final int RIG_TEXTURE_MIN = 16;
	private static final int RIG_TEXTURE_MAX = 512;
	private static final int RIG_VERTICES_MAX = 16384;
	private static final int RIG_TRIANGLES_MAX = 16384;
	private static final int RIG_BONES_MAX = 96;
	private static final int RIG_BONE_NAME_MAX = 32;
	/** pivot und tail der Knochen in Pixeln */
	private static final double RIG_COORD_MAX = 1024;
	/** attach.origin (Begleiter) in Pixeln */
	private static final double RIG_ORIGIN_MAX = 64;
	/** weiche Haut: Einflüsse je Vertex (mesh.joints, mesh.weights), Gewichte ÷ 255 */
	public static final int RIG_INFLUENCES = 4;
	private static final int WEIGHT_UNIT = 255;
	private static final int ROTATION_UNIT = 32767;
	/** Länge eines Quaternions (÷ 32767) darf so weit von 1 abweichen */
	private static final double QUATERNION_TOLERANCE = 0.01;
	private static final int RIG_ANIMATIONS_MAX = 16;
	private static final int RIG_FPS_MAX = 60;
	private static final int RIG_FRAMES_MAX = 1200;
	private static final int RIG_PARTICLES_MAX = 16;
	private static final double RIG_PER_SECOND_MIN = 0.1;
	private static final double RIG_PER_SECOND_MAX = 20;
	private static final int GLOW_FRAMES_MAX = 16;
	private static final int FRAMETIME_MAX = 20;
	private static final double PULSE_PERIOD_MIN = 0.1;
	private static final double PULSE_PERIOD_MAX = 20;
	private static final double BLEND_MAX = 1;

	private CosmeticFormat() {
	}

	// ======================================================================================
	// Ergebnis
	// ======================================================================================

	/** Ein Problem mit einem Cosmetic; die Meldung ist deutsch und nennt das Feld. */
	public static final class InvalidCosmeticException extends Exception {
		public InvalidCosmeticException(String message) {
			super(message);
		}
	}

	public record Cube(double[] origin, double[] size, int[] uv, double inflate, boolean mirror) {
	}

	/** parent: Index eines vorher definierten Bones oder -1 */
	public record Bone(String name, int parent, double[] pivot, double[] rotation, List<Cube> cubes) {
	}

	/**
	 * textureWidth/textureHeight: model.textureSize in Texeln (UV-Raum; das PNG in {@link Manifest} ist 1-, 2- oder 4-mal so
	 * groß). scale: Größe des ganzen Modells um den Anker (Ursprung), über den Bone-Matrizen; fehlt es, 1.
	 */
	public record Model(int textureWidth, int textureHeight, double scale, List<Bone> bones) {
	}

	/** axis: 0 = x, 1 = y, 2 = z */
	public record Animation(int bone, String type, int axis, double amplitude, double speed, double phase) {
	}

	public record Particles(int frames, int rate, int lifetime, double size, String motion, double radius, int color, boolean fullbright) {
	}

	public record Cape(int frames, int fps) {
	}

	public record Companion(double[] offset, double scale) {
	}

	// ---- Format 2 ----

	/** Knochen (Format 2): parent = Index eines vorher stehenden Knochens oder -1; pivot und tail in Pixeln (Body-Modellraum) */
	public record RigBone(String name, int parent, float[] pivot, float[] tail) {
	}

	/**
	 * Eine Spur einer Animation: Frame-Nummern (aufsteigend, die erste 0) und Werte je Key – Drehung 4 (x, y, z, w,
	 * normiert), Verschiebung 3 (Pixel), Größe 1 (Faktor).
	 */
	public record Channel(int[] keys, float[] values) {
	}

	/** Spuren eines Knochens in einer Animation (fehlende Spur = Ruhelage) */
	public record Track(int bone, Channel rot, Channel move, Channel scale) {
	}

	public record Clip(String name, int fps, int frames, boolean loop, List<Track> tracks) {
	}

	/** Leucht-Streifen: Bilder untereinander, Ticks je Bild, Puls (Sekunden, Stärke von min bis max) */
	public record Emissive(int frames, int frametimeTicks, double period, double min, double max) {
	}

	/** Partikel an einem Knochen; particle ohne „minecraft:“; color nur bei dust (sonst -1); states leer = immer */
	public record RigParticle(int bone, boolean tail, String particle, double perSecond, int color, List<String> states) {
	}

	/** Anbringen eines Begleiters: Ursprung im Body-Raum (Pixel) und Seite (rechts = an x gespiegelt) */
	public record Attach(double[] origin, boolean right) {
	}

	/**
	 * Mesh, Knochen und Animationen eines Cosmetics im Format 2, wie im Manifest (Base64 schon in Felder gewandelt):
	 * positions Int16 in 1/32 Pixel (×3), normals Int8 ×127 (×3), uvs Uint16 (÷65535, ×2), vertexBones Uint8 (ein Knochen je
	 * Vertex; bei weicher Haut der mit dem größten Gewicht), triangles Uint16 (×3), weiche Haut freiwillig: joints und
	 * weights je 4 Uint8 (Gewichte ÷ 255, Summe 255), sonst null. states: Schlüssel aus {@link #STATE_KEYS} → Name einer
	 * Animation. attach nur beim Begleiter (ohne Angabe: Ursprung 0, links); Positionen, pivot und tail zählen relativ dazu.
	 */
	public record Rig(int vertexCount, int triangleCount, short[] positions, byte[] normals, char[] uvs, byte[] vertexBones, char[] triangles,
			byte[] joints, byte[] weights, List<RigBone> bones, java.util.Map<String, Clip> animations, java.util.Map<String, String> states,
			double blendSeconds, List<RigParticle> particles, Emissive emissive, Attach attach) {
	}

	/**
	 * Das geprüfte Manifest; fehlende freiwillige Felder mit Standardwert. texture/glow als PNG-Bytes. Format 1: model,
	 * animations, particles, cape, companion je nach Slot, rig null. Format 2: nur rig (Mesh, Knochen, Animationen,
	 * Zustände, Partikel), glow ist dann ein Streifen aus emissive.frames Bildern untereinander.
	 */
	public record Manifest(String id, int version, String slot, String name, String description, String access, String date,
			byte[] texture, int width, int height, byte[] glow, Model model, List<Animation> animations, Particles particles, Cape cape,
			Companion companion, int format, Rig rig) {
		public boolean teamOnly() {
			return "team".equals(access);
		}

		/** nur für Spieler, die es freigeschaltet haben (Belohnung für Einladungen) */
		public boolean unlockOnly() {
			return "unlock".equals(access);
		}
	}

	// ======================================================================================
	// Umschlag und Signatur
	// ======================================================================================

	/**
	 * Prüft einen Umschlag vollständig: Form und Größe (wie der Dienst), Ed25519-Signatur über
	 * {@code "heldix-cosmetic\n" + manifest} mit dem öffentlichen Update-Schlüssel, dann alle Regeln des Manifests.
	 *
	 * @param envelopeText Inhalt von {@code GET /v1/cosmetics/<id>} bzw. einer {@code .cosmetic.json}
	 */
	public static Manifest verifyEnvelope(String envelopeText, PublicKey key) throws InvalidCosmeticException {
		if (utf8Length(envelopeText) > 2 * MAX_ENVELOPE_BYTES) throw new InvalidCosmeticException("Der Umschlag ist zu groß (höchstens " + MAX_ENVELOPE_BYTES / 1024 + " KB)");
		JsonElement value;
		try {
			value = parseStrict(envelopeText);
		} catch (RuntimeException e) {
			throw new InvalidCosmeticException("Die Datei ist kein gültiges JSON");
		}
		String[] envelope = checkEnvelope(value);
		boolean ok;
		try {
			Signature check = Signature.getInstance("Ed25519");
			check.initVerify(key);
			check.update((SIGNATURE_PREFIX + envelope[0]).getBytes(StandardCharsets.UTF_8));
			ok = check.verify(java.util.Base64.getDecoder().decode(envelope[1]));
		} catch (Exception e) {
			ok = false;
		}
		if (!ok) throw new InvalidCosmeticException("Die Signatur passt nicht (nicht vom HeldixClient-Team signiert oder verändert)");
		return parseManifest(envelope[0]);
	}

	/** Form eines Umschlags { manifest, signature } (ohne Kryptografie); liefert {manifest, signature}. */
	static String[] checkEnvelope(JsonElement value) throws InvalidCosmeticException {
		if (value == null || !value.isJsonObject()) throw new InvalidCosmeticException("Der Umschlag ist kein JSON-Objekt");
		JsonObject o = value.getAsJsonObject();
		String manifest = stringOrNull(o.get("manifest"));
		String signature = stringOrNull(o.get("signature"));
		if (manifest == null || manifest.isEmpty()) throw new InvalidCosmeticException("„manifest“ fehlt oder ist kein Text");
		if (signature == null || signature.isEmpty()) throw new InvalidCosmeticException("„signature“ fehlt oder ist kein Text");
		if (hasLoneSurrogate(manifest)) throw new InvalidCosmeticException("„manifest“ enthält ungültige Zeichen");
		// hier die größten Grenzen aller Formate; die engeren von Format 1 prüft parseManifest, sobald das Format bekannt ist
		if (utf8Length(manifest) > MAX_MANIFEST_BYTES) throw new InvalidCosmeticException("„manifest“ ist zu groß (höchstens " + MAX_MANIFEST_BYTES / 1024 + " KB)");
		if (!SIGNATURE_RE.matcher(signature).matches()) throw new InvalidCosmeticException("„signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen)");
		if (envelopeLength(manifest, signature) > MAX_ENVELOPE_BYTES) {
			throw new InvalidCosmeticException("Der Umschlag ist zu groß (höchstens " + MAX_ENVELOPE_BYTES / 1024 + " KB)");
		}
		return new String[] {manifest, signature};
	}

	/** Größte Grenzen über alle Formate (bevor das Format bekannt ist) */
	public static final int MAX_MANIFEST_BYTES = Math.max(MANIFEST_BYTES, MANIFEST_BYTES_2);
	public static final int MAX_ENVELOPE_BYTES = Math.max(ENVELOPE_BYTES, ENVELOPE_BYTES_2);

	/** Länge des Umschlags in Byte, wie der Dienst ihn ausliefert (JSON.stringify) */
	private static int envelopeLength(String manifest, String signature) {
		return utf8Length("{\"manifest\":" + jsonQuote(manifest) + ",\"signature\":" + jsonQuote(signature) + "}");
	}

	private static String stringOrNull(JsonElement element) {
		return element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString() ? element.getAsString() : null;
	}

	/**
	 * Manifest-Text lesen und prüfen (der Text muss vorher mit seiner Signatur geprüft sein). Hier kommt auch die
	 * Größengrenze des Formats dazu: Format 1 höchstens 160 KB Manifest bzw. 192 KB Umschlag, Format 2 512 KB bzw. 544 KB.
	 */
	public static Manifest parseManifest(String manifest) throws InvalidCosmeticException {
		JsonElement parsed;
		try {
			parsed = parseStrict(manifest);
		} catch (RuntimeException e) {
			throw new InvalidCosmeticException("„manifest“ ist kein gültiges JSON");
		}
		Double format = parsed != null && parsed.isJsonObject() ? num(parsed.getAsJsonObject().get("format")) : null;
		if (format != null && (format == FORMAT || format == FORMAT_2)) {
			int f = (int) (double) format;
			int manifestMax = f == FORMAT ? MANIFEST_BYTES : MANIFEST_BYTES_2;
			int envelopeMax = f == FORMAT ? ENVELOPE_BYTES : ENVELOPE_BYTES_2;
			if (utf8Length(manifest) > manifestMax) throw fail("„manifest“ ist zu groß (höchstens " + manifestMax / 1024 + " KB bei Format " + f + ")");
			if (envelopeLength(manifest, "A".repeat(88)) > envelopeMax) throw fail("Der Umschlag ist zu groß (höchstens " + envelopeMax / 1024 + " KB bei Format " + f + ")");
		}
		return check(parsed);
	}

	/** JSON wie JSON.parse: streng, genau ein Wert, danach nur Leerraum. */
	static JsonElement parseStrict(String text) {
		JsonReader reader = new JsonReader(new StringReader(text));
		reader.setStrictness(Strictness.STRICT);
		JsonElement element = JsonParser.parseReader(reader);
		try {
			if (reader.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException("Daten nach dem JSON-Wert");
		} catch (java.io.IOException e) {
			throw new IllegalArgumentException(e);
		}
		return element;
	}

	// ======================================================================================
	// Texte, Base64, PNG
	// ======================================================================================

	/** Länge in Byte als UTF-8 (einzelne Ersatzzeichen zählen wie U+FFFD, also 3 Byte). */
	public static int utf8Length(String text) {
		int bytes = 0;
		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);
			if (c < 0x80) bytes += 1;
			else if (c < 0x800) bytes += 2;
			else if (Character.isHighSurrogate(c) && i + 1 < text.length() && Character.isLowSurrogate(text.charAt(i + 1))) {
				bytes += 4;
				i++;
			} else bytes += 3;
		}
		return bytes;
	}

	private static boolean hasLoneSurrogate(String text) {
		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);
			if (Character.isHighSurrogate(c)) {
				if (i + 1 < text.length() && Character.isLowSurrogate(text.charAt(i + 1))) i++;
				else return true;
			} else if (Character.isLowSurrogate(c)) return true;
		}
		return false;
	}

	/** Text als JSON-Zeichenkette wie JSON.stringify (für die Größe des Umschlags, wie der Dienst ihn ausliefert). */
	static String jsonQuote(String text) {
		StringBuilder out = new StringBuilder(text.length() + 16).append('"');
		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);
			switch (c) {
				case '"' -> out.append("\\\"");
				case '\\' -> out.append("\\\\");
				case '\b' -> out.append("\\b");
				case '\f' -> out.append("\\f");
				case '\n' -> out.append("\\n");
				case '\r' -> out.append("\\r");
				case '\t' -> out.append("\\t");
				default -> {
					boolean lone = Character.isSurrogate(c) && !(Character.isHighSurrogate(c) && i + 1 < text.length() && Character.isLowSurrogate(text.charAt(i + 1)))
							&& !(Character.isLowSurrogate(c) && i > 0 && Character.isHighSurrogate(text.charAt(i - 1)));
					if (c < 0x20 || lone) out.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
					else out.append(c);
				}
			}
		}
		return out.append('"').toString();
	}

	/** Strenges Standard-Base64 wie decodeBase64 (atob): Länge ein Vielfaches von 4, „=“ nur am Ende; sonst null. */
	static byte[] decodeBase64(String text) {
		if (text.isEmpty() || text.length() % 4 != 0 || !BASE64_RE.matcher(text).matches()) return null;
		int end = text.length();
		while (end > 0 && text.charAt(end - 1) == '=') end--;
		if (end % 4 == 1) return null;
		byte[] out = new byte[end * 3 / 4];
		int bits = 0;
		int count = 0;
		int pos = 0;
		for (int i = 0; i < end; i++) {
			char c = text.charAt(i);
			int v = c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52 : c == '+' ? 62 : 63;
			bits = bits << 6 | v;
			count += 6;
			if (count >= 8) {
				count -= 8;
				out[pos++] = (byte) (bits >> count);
				bits &= (1 << count) - 1;
			}
		}
		return pos == out.length ? out : java.util.Arrays.copyOf(out, pos);
	}

	private static final int[] CRC_TABLE = new int[256];

	static {
		for (int n = 0; n < 256; n++) {
			int c = n;
			for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
			CRC_TABLE[n] = c;
		}
	}

	private static int crc32(byte[] bytes, int start, int end) {
		int crc = 0xFFFFFFFF;
		for (int i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
		return ~crc;
	}

	private static long u32(byte[] b, int pos) {
		return ((b[pos] & 0xFFL) << 24) | ((b[pos + 1] & 0xFFL) << 16) | ((b[pos + 2] & 0xFFL) << 8) | (b[pos + 3] & 0xFFL);
	}

	private static final byte[] PNG_SIGNATURE = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};

	private static boolean depthAllowed(int color, int depth) {
		return switch (color) {
			case 0 -> depth == 1 || depth == 2 || depth == 4 || depth == 8 || depth == 16;
			case 2, 4, 6 -> depth == 8 || depth == 16;
			case 3 -> depth == 1 || depth == 2 || depth == 4 || depth == 8;
			default -> false;
		};
	}

	/**
	 * Prüft den Aufbau eines PNG ohne es zu dekodieren (wie readPng): Signatur, alle Abschnitte vollständig mit stimmender
	 * Prüfsumme, IHDR zuerst, mindestens ein IDAT, IEND zuletzt und nichts danach. Liefert {Breite, Höhe}.
	 */
	static int[] readPng(byte[] bytes) throws InvalidPng {
		if (bytes.length < 8) throw new InvalidPng("ist kein PNG (die PNG-Signatur fehlt)");
		for (int i = 0; i < 8; i++) if (bytes[i] != PNG_SIGNATURE[i]) throw new InvalidPng("ist kein PNG (die PNG-Signatur fehlt)");
		int pos = 8;
		int[] size = null;
		boolean data = false;
		boolean end = false;
		while (pos < bytes.length) {
			if (end) throw new InvalidPng("hat Daten nach dem Ende (IEND)");
			if (bytes.length - pos < 12) throw new InvalidPng("ist beschädigt (Abschnitt abgeschnitten)");
			long length = u32(bytes, pos);
			if (length > bytes.length - pos - 12) throw new InvalidPng("ist beschädigt (Abschnitt abgeschnitten)");
			StringBuilder type = new StringBuilder(4);
			for (int i = pos + 4; i < pos + 8; i++) {
				int c = bytes[i] & 0xFF;
				if (!((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A))) throw new InvalidPng("ist beschädigt (ungültiger Abschnitt)");
				type.append((char) c);
			}
			int len = (int) length;
			if ((crc32(bytes, pos + 4, pos + 8 + len) & 0xFFFFFFFFL) != u32(bytes, pos + 8 + len)) {
				throw new InvalidPng("ist beschädigt (Prüfsumme von " + type + " stimmt nicht)");
			}
			String t = type.toString();
			if (size == null) {
				if (!t.equals("IHDR") || len != 13) throw new InvalidPng("ist beschädigt (IHDR fehlt am Anfang)");
				long width = u32(bytes, pos + 8);
				long height = u32(bytes, pos + 12);
				int depth = bytes[pos + 16] & 0xFF;
				int color = bytes[pos + 17] & 0xFF;
				if (width == 0 || height == 0 || width > 0x7FFFFFFFL || height > 0x7FFFFFFFL) throw new InvalidPng("hat eine ungültige Größe");
				if (!depthAllowed(color, depth) || bytes[pos + 18] != 0 || bytes[pos + 19] != 0 || (bytes[pos + 20] & 0xFF) > 1) {
					throw new InvalidPng("hat ungültige Werte im Kopf (IHDR: Farbtyp, Bittiefe, Kompression, Filter oder Interlace)");
				}
				size = new int[] {(int) width, (int) height};
			} else if (t.equals("IHDR")) {
				throw new InvalidPng("ist beschädigt (IHDR doppelt)");
			}
			if (t.equals("IDAT")) data = true;
			if (t.equals("IEND")) {
				if (len != 0) throw new InvalidPng("ist beschädigt (IEND nicht leer)");
				end = true;
			}
			pos += 12 + len;
		}
		if (size == null) throw new InvalidPng("ist beschädigt (IHDR fehlt am Anfang)");
		if (!data) throw new InvalidPng("hat keine Bilddaten (IDAT)");
		if (!end) throw new InvalidPng("ist unvollständig (IEND fehlt am Ende)");
		return size;
	}

	static final class InvalidPng extends Exception {
		InvalidPng(String message) {
			super(message);
		}
	}

	// ======================================================================================
	// Prüfung (wie check() in cosmetics-format.ts)
	// ======================================================================================

	private static InvalidCosmeticException fail(String message) {
		return new InvalidCosmeticException(message);
	}

	private static String q(String path) {
		return "„" + path + "“";
	}

	private static String sub(String path, String key) {
		return path.isEmpty() ? key : path + "." + key;
	}

	private static JsonObject object(JsonElement value, String path) throws InvalidCosmeticException {
		if (value == null || !value.isJsonObject()) throw fail(q(path) + " muss ein JSON-Objekt sein");
		return value.getAsJsonObject();
	}

	private static void onlyKeys(JsonObject o, String path, List<String> allowed) throws InvalidCosmeticException {
		onlyKeys(o, path, allowed, FORMAT);
	}

	private static void onlyKeys(JsonObject o, String path, List<String> allowed, int format) throws InvalidCosmeticException {
		for (String key : o.keySet()) {
			if (!allowed.contains(key)) throw fail(q(sub(path, key)) + " ist kein bekanntes Feld (Format " + format + ")");
		}
	}

	private static JsonElement required(JsonObject o, String key, String path) throws InvalidCosmeticException {
		if (!o.has(key)) throw fail(q(sub(path, key)) + " fehlt");
		return o.get(key);
	}

	/** Zahl wie in JavaScript (double); null, wenn es keine JSON-Zahl ist */
	private static Double num(JsonElement value) {
		if (value == null || !value.isJsonPrimitive()) return null;
		JsonPrimitive p = value.getAsJsonPrimitive();
		if (!p.isNumber()) return null;
		try {
			return Double.parseDouble(p.getAsString());
		} catch (NumberFormatException e) {
			return null;
		}
	}

	private static String fmt(double v) {
		if (v == Math.rint(v) && Math.abs(v) < 1e15) return Long.toString((long) v);
		String s = Double.toString(v);
		return s.endsWith(".0") ? s.substring(0, s.length() - 2) : s;
	}

	private static int integer(JsonElement value, String path, double min, double max) throws InvalidCosmeticException {
		Double v = num(value);
		if (v == null || v.isInfinite() || v.isNaN() || v != Math.rint(v) || v < min || v > max) {
			throw fail(q(path) + " muss eine ganze Zahl von " + fmt(min) + " bis " + fmt(max) + " sein");
		}
		return (int) (double) v;
	}

	private static double number(JsonElement value, String path, double min, double max) throws InvalidCosmeticException {
		Double v = num(value);
		if (v == null || v.isInfinite() || v.isNaN() || v < min || v > max) throw fail(q(path) + " muss eine Zahl von " + fmt(min) + " bis " + fmt(max) + " sein");
		return v;
	}

	private static String oneOf(JsonElement value, String path, List<String> list) throws InvalidCosmeticException {
		String s = stringOrNull(value);
		if (s == null || !list.contains(s)) throw fail(q(path) + " muss eins von " + String.join(", ", list) + " sein");
		return s;
	}

	private static boolean bool(JsonElement value, String path) throws InvalidCosmeticException {
		if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) throw fail(q(path) + " muss true oder false sein");
		return value.getAsBoolean();
	}

	private static double[] vec3(JsonElement value, String path, double[][] ranges) throws InvalidCosmeticException {
		boolean ok = value != null && value.isJsonArray() && value.getAsJsonArray().size() == 3;
		double[] out = new double[3];
		if (ok) {
			JsonArray array = value.getAsJsonArray();
			for (int i = 0; i < 3 && ok; i++) {
				Double v = num(array.get(i));
				ok = v != null && !v.isInfinite() && !v.isNaN() && v >= ranges[i][0] && v <= ranges[i][1];
				if (ok) out[i] = v;
			}
		}
		if (!ok) {
			boolean same = ranges[1][0] == ranges[0][0] && ranges[1][1] == ranges[0][1] && ranges[2][0] == ranges[0][0] && ranges[2][1] == ranges[0][1];
			if (same) throw fail(q(path) + " muss eine Liste aus drei Zahlen von " + fmt(ranges[0][0]) + " bis " + fmt(ranges[0][1]) + " sein");
			String[] axes = {"x", "y", "z"};
			List<String> parts = new ArrayList<>();
			for (int i = 0; i < 3; i++) parts.add(axes[i] + " von " + fmt(ranges[i][0]) + " bis " + fmt(ranges[i][1]));
			throw fail(q(path) + " muss eine Liste aus drei Zahlen sein (" + String.join(", ", parts) + ")");
		}
		return out;
	}

	private static double[][] around(double max) {
		return new double[][] {{-max, max}, {-max, max}, {-max, max}};
	}

	/** Leerraum wie String.prototype.trim (ohne die Zeichen, die ohnehin verboten sind) */
	private static boolean isJsWhitespace(char c) {
		return c == ' ' || c == ' ' || c == ' ' || (c >= ' ' && c <= ' ') || c == ' ' || c == ' ' || c == '　'
				|| c == '﻿' || c == '\t' || c == '\n' || c == '\u000B' || c == '\f' || c == '\r' || c == ' ' || c == ' ';
	}

	private static String text(JsonElement value, String path, int min, int max) throws InvalidCosmeticException {
		String s = stringOrNull(value);
		if (s == null) throw fail(q(path) + " fehlt oder ist kein Text");
		if (FORBIDDEN_TEXT_RE.matcher(s).find()) throw fail(q(path) + " enthält Zeichen, die nicht erlaubt sind (auch keine Zeilenumbrüche)");
		if (min > 0) {
			boolean blank = true;
			for (int i = 0; i < s.length() && blank; i++) blank = isJsWhitespace(s.charAt(i));
			if (blank) throw fail(q(path) + " darf nicht leer sein");
		}
		if (s.codePointCount(0, s.length()) > max) throw fail(q(path) + " ist zu lang (höchstens " + max + " Zeichen)");
		return s;
	}

	/** Datum nach ISO 8601, das es wirklich gibt (wie isIsoDate, auch mit dessen Eigenheit: Jahre unter 100 gelten nicht). */
	static boolean isIsoDate(JsonElement value) {
		String s = stringOrNull(value);
		if (s == null) return false;
		var m = DATE_RE.matcher(s);
		if (!m.matches()) return false;
		int year = Integer.parseInt(m.group(1));
		int month = Integer.parseInt(m.group(2));
		int day = Integer.parseInt(m.group(3));
		// Date.UTC zählt Jahre 0–99 als 1900–1999: dann stimmt das Jahr nicht mehr überein
		if (year < 100 || month < 1 || month > 12 || day < 1 || day > java.time.YearMonth.of(year, month).lengthOfMonth()) return false;
		int h = m.group(4) == null ? 0 : Integer.parseInt(m.group(4));
		int mi = m.group(5) == null ? 0 : Integer.parseInt(m.group(5));
		int sec = m.group(6) == null ? 0 : Integer.parseInt(m.group(6));
		int oh = m.group(7) == null ? 0 : Integer.parseInt(m.group(7));
		int om = m.group(8) == null ? 0 : Integer.parseInt(m.group(8));
		return h <= 23 && mi <= 59 && sec <= 59 && oh <= 23 && om <= 59;
	}

	/** PNG als data-URL: Präfix, strenges Base64, höchstens 64 KB, gültiger Aufbau. Liefert die Bytes; size = {w, h}. */
	private static byte[] png(JsonElement value, String path, int[] size) throws InvalidCosmeticException {
		String s = stringOrNull(value);
		if (s == null || !s.startsWith(PNG_DATA_URL_PREFIX)) throw fail(q(path) + " muss eine data-URL „" + PNG_DATA_URL_PREFIX + "…“ sein");
		String base64 = s.substring(PNG_DATA_URL_PREFIX.length());
		String tooLarge = q(path) + " ist zu groß (höchstens " + PNG_BYTES / 1024 + " KB als PNG)";
		if (base64.length() > (int) Math.ceil(PNG_BYTES / 3.0) * 4) throw fail(tooLarge);
		byte[] bytes = decodeBase64(base64);
		if (bytes == null) throw fail(q(path) + " enthält kein gültiges Base64");
		if (bytes.length > PNG_BYTES) throw fail(tooLarge);
		try {
			int[] info = readPng(bytes);
			size[0] = info[0];
			size[1] = info[1];
		} catch (InvalidPng e) {
			throw fail(q(path) + " " + e.getMessage());
		}
		return bytes;
	}

	private static Cape checkCape(JsonElement value) throws InvalidCosmeticException {
		JsonObject o = object(value, "cape");
		onlyKeys(o, "cape", List.of("frames", "fps"));
		int frames = integer(required(o, "frames", "cape"), "cape.frames", 1, CAPE_FRAMES_MAX);
		int fps = integer(required(o, "fps", "cape"), "cape.fps", 1, CAPE_FPS_MAX);
		return new Cape(frames, fps);
	}

	private static Particles checkParticles(JsonElement value) throws InvalidCosmeticException {
		JsonObject o = object(value, "particles");
		onlyKeys(o, "particles", List.of("frames", "rate", "lifetime", "size", "motion", "radius", "color", "fullbright"));
		int frames = integer(required(o, "frames", "particles"), "particles.frames", 1, PARTICLE_FRAMES_MAX);
		int rate = integer(required(o, "rate", "particles"), "particles.rate", RATE_MIN, RATE_MAX);
		int lifetime = integer(required(o, "lifetime", "particles"), "particles.lifetime", LIFETIME_MIN, LIFETIME_MAX);
		double size = number(required(o, "size", "particles"), "particles.size", SIZE_MIN, SIZE_MAX);
		String motion = oneOf(required(o, "motion", "particles"), "particles.motion", PARTICLE_MOTIONS);
		double radius = number(required(o, "radius", "particles"), "particles.radius", RADIUS_MIN, RADIUS_MAX);
		String color = stringOrNull(required(o, "color", "particles"));
		if (color == null || !COLOR_RE.matcher(color).matches()) throw fail("„particles.color“ muss eine Farbe wie #ffcc00 sein");
		boolean fullbright = o.has("fullbright") && bool(o.get("fullbright"), "particles.fullbright");
		return new Particles(frames, rate, lifetime, size, motion, radius, Integer.parseInt(color.substring(1), 16), fullbright);
	}

	private static Companion checkCompanion(JsonElement value) throws InvalidCosmeticException {
		JsonObject o = object(value, "companion");
		onlyKeys(o, "companion", List.of("offset", "scale"));
		double[] offset = vec3(required(o, "offset", "companion"), "companion.offset",
				new double[][] {{-OFFSET_XZ_MAX, OFFSET_XZ_MAX}, {OFFSET_Y_MIN, OFFSET_Y_MAX}, {-OFFSET_XZ_MAX, OFFSET_XZ_MAX}});
		double scale = number(required(o, "scale", "companion"), "companion.scale", SCALE_MIN, SCALE_MAX);
		return new Companion(offset, scale);
	}

	private static Cube checkCube(JsonElement value, String path, int texW, int texH) throws InvalidCosmeticException {
		JsonObject o = object(value, path);
		onlyKeys(o, path, List.of("origin", "size", "uv", "inflate", "mirror"));
		double[] origin = vec3(required(o, "origin", path), sub(path, "origin"), around(COORD_MAX));
		double[] size = vec3(required(o, "size", path), sub(path, "size"), new double[][] {{0, CUBE_EDGE_MAX}, {0, CUBE_EDGE_MAX}, {0, CUBE_EDGE_MAX}});
		if (size[0] == 0 && size[1] == 0 && size[2] == 0) throw fail(q(sub(path, "size")) + ": mindestens eine Kante muss größer als 0 sein");
		JsonElement uvValue = required(o, "uv", path);
		int[] uv = new int[2];
		boolean uvOk = uvValue != null && uvValue.isJsonArray() && uvValue.getAsJsonArray().size() == 2;
		if (uvOk) {
			for (int i = 0; i < 2 && uvOk; i++) {
				Double v = num(uvValue.getAsJsonArray().get(i));
				uvOk = v != null && !v.isInfinite() && !v.isNaN() && v == Math.rint(v) && v >= 0 && v <= 0x7FFFFFFF;
				if (uvOk) uv[i] = (int) (double) v;
			}
		}
		if (!uvOk) throw fail(q(sub(path, "uv")) + " muss eine Liste aus zwei ganzen Zahlen ab 0 sein");
		double inflate = o.has("inflate") ? number(o.get("inflate"), sub(path, "inflate"), 0, INFLATE_MAX) : 0;
		boolean mirror = o.has("mirror") && bool(o.get("mirror"), sub(path, "mirror"));
		for (int axis = 0; axis < 3; axis++) {
			double from = origin[axis] - inflate;
			double to = origin[axis] + size[axis] + inflate;
			if (from < -COORD_MAX || to > COORD_MAX) {
				throw fail(q(path) + " reicht weiter als " + COORD_MAX + " Pixel vom Anker (" + "xyz".charAt(axis) + " von " + fmt(from) + " bis " + fmt(to) + ")");
			}
		}
		double w = size[0];
		double h = size[1];
		double d = size[2];
		double uvWidth = 2 * d + 2 * w;
		double uvHeight = d + h;
		if (uv[0] + uvWidth > texW || uv[1] + uvHeight > texH) {
			throw fail(q(sub(path, "uv")) + ": Die UV-Fläche (" + fmt(uvWidth) + " × " + fmt(uvHeight) + " ab " + uv[0] + ", " + uv[1]
					+ ") passt nicht in die Textur (" + texW + " × " + texH + ")");
		}
		return new Cube(origin, size, uv, inflate, mirror);
	}

	private static Model checkModel(JsonElement value, int width, int height) throws InvalidCosmeticException {
		JsonObject o = object(value, "model");
		onlyKeys(o, "model", List.of("textureSize", "scale", "bones"));
		// textureSize = Größe in Texeln (UV-Raum); das PNG hat die 1-, 2- oder 4-fache Auflösung davon
		JsonElement textureSize = required(o, "textureSize", "model");
		int k = 0;
		if (textureSize != null && textureSize.isJsonArray() && textureSize.getAsJsonArray().size() == 2) {
			Double tw = num(textureSize.getAsJsonArray().get(0));
			Double th = num(textureSize.getAsJsonArray().get(1));
			for (int f : TEXTURE_SCALES) {
				if (tw != null && th != null && tw == (double) width / f && th == (double) height / f) {
					k = f;
					break;
				}
			}
		}
		if (k == 0) {
			List<String> sizes = new ArrayList<>();
			List<String> scales = new ArrayList<>();
			for (int f : TEXTURE_SCALES) {
				sizes.add("[" + fmt((double) width / f) + ", " + fmt((double) height / f) + "]");
				scales.add(String.valueOf(f));
			}
			throw fail("„model.textureSize“ muss die Größe der Textur in Texeln sein (" + String.join(", ", sizes.subList(0, sizes.size() - 1)) + " oder "
					+ sizes.getLast() + ": Textur in " + String.join("-, ", scales.subList(0, scales.size() - 1)) + "- oder " + scales.getLast()
					+ "-facher Auflösung)");
		}
		int texW = width / k;
		int texH = height / k;
		double scale = o.has("scale") ? number(o.get("scale"), "model.scale", MODEL_SCALE_MIN, MODEL_SCALE_MAX) : 1;
		JsonElement rawBones = required(o, "bones", "model");
		if (rawBones == null || !rawBones.isJsonArray() || rawBones.getAsJsonArray().isEmpty() || rawBones.getAsJsonArray().size() > BONES_MAX) {
			throw fail("„model.bones“ muss eine Liste mit 1 bis " + BONES_MAX + " Bones sein");
		}
		List<String> names = new ArrayList<>();
		List<Bone> bones = new ArrayList<>();
		int cubeCount = 0;
		JsonArray array = rawBones.getAsJsonArray();
		for (int i = 0; i < array.size(); i++) {
			String path = "model.bones[" + i + "]";
			JsonObject b = object(array.get(i), path);
			onlyKeys(b, path, List.of("name", "parent", "pivot", "rotation", "cubes"));
			String name = stringOrNull(required(b, "name", path));
			if (name == null || !BONE_NAME_RE.matcher(name).matches()) throw fail(q(sub(path, "name")) + " ist ungültig (1–24 Zeichen aus a–z, 0–9 und _)");
			if (names.contains(name)) throw fail(q(sub(path, "name")) + ": Den Bone „" + name + "“ gibt es schon");
			int parent = -1;
			if (b.has("parent")) {
				String parentName = stringOrNull(b.get("parent"));
				if (parentName == null || !names.contains(parentName)) throw fail(q(sub(path, "parent")) + " muss der Name eines Bones sein, der vorher in der Liste steht");
				parent = names.indexOf(parentName);
			}
			double[] pivot = vec3(required(b, "pivot", path), sub(path, "pivot"), around(COORD_MAX));
			double[] rotation = b.has("rotation") ? vec3(b.get("rotation"), sub(path, "rotation"), around(ROTATION_MAX)) : new double[3];
			JsonElement rawCubes = required(b, "cubes", path);
			if (rawCubes == null || !rawCubes.isJsonArray()) throw fail(q(sub(path, "cubes")) + " muss eine Liste sein");
			JsonArray cubeArray = rawCubes.getAsJsonArray();
			cubeCount += cubeArray.size();
			if (cubeCount > CUBES_MAX) throw fail("„model“ hat zu viele Würfel (höchstens " + CUBES_MAX + " insgesamt)");
			List<Cube> cubes = new ArrayList<>();
			for (int j = 0; j < cubeArray.size(); j++) cubes.add(checkCube(cubeArray.get(j), path + ".cubes[" + j + "]", texW, texH));
			names.add(name);
			bones.add(new Bone(name, parent, pivot, rotation, List.copyOf(cubes)));
		}
		if (cubeCount == 0) throw fail("„model“ braucht mindestens einen Würfel");
		return new Model(texW, texH, scale, List.copyOf(bones));
	}

	private static List<Animation> checkAnimations(JsonElement value, Model model) throws InvalidCosmeticException {
		if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > ANIMATIONS_MAX) {
			throw fail("„animations“ muss eine Liste mit höchstens " + ANIMATIONS_MAX + " Einträgen sein");
		}
		List<String> bones = new ArrayList<>();
		for (Bone bone : model.bones()) bones.add(bone.name());
		List<Animation> result = new ArrayList<>();
		JsonArray array = value.getAsJsonArray();
		for (int i = 0; i < array.size(); i++) {
			String path = "animations[" + i + "]";
			JsonObject a = object(array.get(i), path);
			onlyKeys(a, path, List.of("bone", "type", "axis", "amplitude", "speed", "phase"));
			String bone = stringOrNull(required(a, "bone", path));
			if (bone == null || !bones.contains(bone)) throw fail(q(sub(path, "bone")) + " muss der Name eines Bones im Modell sein");
			String type = oneOf(required(a, "type", path), sub(path, "type"), ANIMATION_TYPES);
			String axis = oneOf(required(a, "axis", path), sub(path, "axis"), ANIMATION_AXES);
			int amplitudeMax = type.equals("bob") ? BOB_AMPLITUDE_MAX : AMPLITUDE_MAX;
			double amplitude = type.equals("spin") && !a.has("amplitude") ? 0
					: number(required(a, "amplitude", path), sub(path, "amplitude"), 0, amplitudeMax);
			double speed = number(required(a, "speed", path), sub(path, "speed"), 0, SPEED_MAX);
			double phase = a.has("phase") ? number(a.get("phase"), sub(path, "phase"), 0, 1) : 0;
			result.add(new Animation(bones.indexOf(bone), type, ANIMATION_AXES.indexOf(axis), amplitude, speed, phase));
		}
		return List.copyOf(result);
	}

	private static void checkTextureSize(String slot, int width, int height, Cape cape, Particles particles) throws InvalidCosmeticException {
		if (cape != null) {
			boolean ok = false;
			for (int w : CAPE_WIDTHS) ok |= w == width;
			if (!ok || (long) height != (long) (width / 2) * cape.frames()) {
				List<String> sizes = new ArrayList<>();
				for (int w : CAPE_WIDTHS) sizes.add(w + " × " + (w / 2) * cape.frames());
				throw fail("„texture“ muss für ein Cape mit " + cape.frames() + " Bildern " + String.join(", ", sizes.subList(0, sizes.size() - 1)) + " oder "
						+ sizes.getLast() + " Pixel groß sein (Breite 64, 128 oder 256, jedes Bild halb so hoch wie breit; ist " + width + " × " + height + ")");
			}
			return;
		}
		if (!fits(width) || !fits(height)) {
			throw fail("„texture“ muss " + TEXTURE_MIN + " bis " + TEXTURE_MAX + " Pixel breit und hoch sein, jeweils ein Vielfaches von " + TEXTURE_STEP
					+ " (ist " + width + " × " + height + ")");
		}
		if (slot.equals("aura") && particles != null && (long) width != (long) height * particles.frames()) {
			throw fail("„texture“ muss " + particles.frames() + " quadratische Bilder nebeneinander enthalten (Breite = Höhe × " + particles.frames()
					+ "; ist " + width + " × " + height + ")");
		}
	}

	private static boolean fits(int v) {
		return v >= TEXTURE_MIN && v <= TEXTURE_MAX && v % TEXTURE_STEP == 0;
	}

	private static Manifest check(JsonElement value) throws InvalidCosmeticException {
		if (value == null || !value.isJsonObject()) throw fail("Das Manifest ist kein JSON-Objekt");
		JsonObject m = value.getAsJsonObject();
		if (!TYPE.equals(stringOrNull(m.get("type")))) throw fail("„type“ muss „" + TYPE + "“ sein");
		Double format = num(m.get("format"));
		if (format != null && format == FORMAT_2) return checkRig(m);
		if (format == null || format != FORMAT) throw fail("„format“ muss " + FORMAT + " oder " + FORMAT_2 + " sein");
		onlyKeys(m, "", MANIFEST_KEYS);
		String id = stringOrNull(m.get("id"));
		if (id == null || !ID_RE.matcher(id).matches()) throw fail("„id“ ist ungültig (1–32 Zeichen aus a–z, 0–9 und -, ohne - am Anfang oder Ende)");
		if (BUILTIN_CAPE_IDS.contains(id)) throw fail("„id“ darf nicht die ID eines eingebauten Capes sein (" + String.join(", ", BUILTIN_CAPE_IDS) + ")");
		int version = integer(m.get("version"), "version", 1, VERSION_MAX);
		String slot = oneOf(m.get("slot"), "slot", SLOTS);
		String name = text(m.get("name"), "name", 1, NAME_MAX);
		String description = text(m.get("description"), "description", 0, DESCRIPTION_MAX);
		String access = oneOf(m.get("access"), "access", ACCESS);
		if (!isIsoDate(m.get("date"))) throw fail("„date“ ist kein gültiges Datum nach ISO 8601 (z. B. 2026-11-26T12:00:00.000Z)");
		String date = m.get("date").getAsString();

		if (!m.has("texture")) throw fail("„texture“ fehlt");
		int[] image = new int[2];
		byte[] texture = png(m.get("texture"), "texture", image);
		byte[] glow = null;
		if (m.has("glow")) {
			int[] glowImage = new int[2];
			glow = png(m.get("glow"), "glow", glowImage);
			if (glowImage[0] != image[0] || glowImage[1] != image[1]) {
				throw fail("„glow“ muss genauso groß sein wie „texture“ (" + image[0] + " × " + image[1] + "; ist " + glowImage[0] + " × " + glowImage[1] + ")");
			}
		}

		boolean needsModel = MODEL_SLOTS.contains(slot);
		boolean needsParticles = slot.equals("aura");
		boolean needsCape = slot.equals("cape");
		boolean needsCompanion = slot.equals("companion");
		String[] keys = {"model", "particles", "cape", "companion"};
		boolean[] needs = {needsModel, needsParticles, needsCape, needsCompanion};
		for (int i = 0; i < keys.length; i++) {
			if (needs[i] && !m.has(keys[i])) throw fail("„" + keys[i] + "“ fehlt (Pflicht für den Slot " + slot + ")");
			if (!needs[i] && m.has(keys[i])) throw fail("„" + keys[i] + "“ gibt es beim Slot " + slot + " nicht");
		}
		if (!needsModel && m.has("animations")) throw fail("„animations“ gibt es nur mit „model“ (nicht beim Slot " + slot + ")");

		Cape cape = needsCape ? checkCape(m.get("cape")) : null;
		Particles particles = needsParticles ? checkParticles(m.get("particles")) : null;
		Companion companion = needsCompanion ? checkCompanion(m.get("companion")) : null;
		checkTextureSize(slot, image[0], image[1], cape, particles);
		Model model = needsModel ? checkModel(m.get("model"), image[0], image[1]) : null;
		List<Animation> animations = model != null && m.has("animations") ? checkAnimations(m.get("animations"), model) : List.of();
		return new Manifest(id, version, slot, name, description, access, date, texture, image[0], image[1], glow, model, animations, particles,
				cape, companion, FORMAT, null);
	}

	// ======================================================================================
	// Format 2: Mesh mit Knochen und Keyframe-Animationen (wie checkFormat2 in cosmetics-format.ts)
	// ======================================================================================

	private static boolean powerOfTwo(int v) {
		return v > 0 && (v & (v - 1)) == 0;
	}

	/** Base64 mit genau {@code count} Werten zu je {@code size} Byte (Länge passend, strenges Base64); liefert die Bytes. */
	private static byte[] packed(JsonElement value, String path, long count, int size, String what) throws InvalidCosmeticException {
		long bytes = count * size;
		long chars = (bytes + 2) / 3 * 4;
		String s = stringOrNull(value);
		if (s == null) throw fail(q(path) + " fehlt oder ist kein Text (Base64)");
		if (s.length() != chars) throw fail(q(path) + " muss genau " + count + " " + what + " als Base64 enthalten (" + chars + " Zeichen, nicht " + s.length() + ")");
		byte[] decoded = decodeBase64(s);
		if (decoded == null || decoded.length != bytes) throw fail(q(path) + " enthält kein gültiges Base64 (erwartet " + bytes + " Byte)");
		return decoded;
	}

	private static short int16(byte[] b, int i) {
		return (short) ((b[2 * i] & 0xFF) | (b[2 * i + 1] << 8));
	}

	private static char uint16(byte[] b, int i) {
		return (char) ((b[2 * i] & 0xFF) | ((b[2 * i + 1] & 0xFF) << 8));
	}

	private static float[] toFloats(double[] v) {
		return new float[] {(float) v[0], (float) v[1], (float) v[2]};
	}

	/** Format 2 (type und format sind schon geprüft). */
	private static Manifest checkRig(JsonObject m) throws InvalidCosmeticException {
		onlyKeys(m, "", MANIFEST_KEYS_2, FORMAT_2);
		String id = stringOrNull(m.get("id"));
		if (id == null || !ID_RE.matcher(id).matches()) throw fail("„id“ ist ungültig (1–32 Zeichen aus a–z, 0–9 und -, ohne - am Anfang oder Ende)");
		if (BUILTIN_CAPE_IDS.contains(id)) throw fail("„id“ darf nicht die ID eines eingebauten Capes sein (" + String.join(", ", BUILTIN_CAPE_IDS) + ")");
		int version = integer(m.get("version"), "version", 1, VERSION_MAX);
		String slot = oneOf(m.get("slot"), "slot", RIG_SLOTS);
		String name = text(m.get("name"), "name", 1, NAME_MAX);
		String description = text(m.get("description"), "description", 0, DESCRIPTION_MAX);
		String access = oneOf(m.get("access"), "access", ACCESS);
		if (!isIsoDate(m.get("date"))) throw fail("„date“ ist kein gültiges Datum nach ISO 8601 (z. B. 2026-11-26T12:00:00.000Z)");
		String date = m.get("date").getAsString();

		if (!m.has("texture")) throw fail("„texture“ fehlt");
		int[] image = new int[2];
		byte[] texture = png(m.get("texture"), "texture", image);
		if (!rigTextureFits(image[0]) || !rigTextureFits(image[1])) {
			throw fail("„texture“ muss je eine Zweierpotenz von " + RIG_TEXTURE_MIN + " bis " + RIG_TEXTURE_MAX + " Pixel breit und hoch sein (ist " + image[0]
					+ " × " + image[1] + ")");
		}
		// Leucht-Streifen: glow und emissive nur zusammen
		if (m.has("glow") != m.has("emissive")) throw fail(m.has("glow") ? "„emissive“ fehlt (Pflicht mit „glow“)" : "„glow“ fehlt (Pflicht mit „emissive“)");
		Emissive emissive = null;
		byte[] glow = null;
		if (m.has("emissive")) {
			emissive = checkEmissive(m.get("emissive"));
			int[] glowImage = new int[2];
			glow = png(m.get("glow"), "glow", glowImage);
			long height = (long) image[1] * emissive.frames();
			if (glowImage[0] != image[0] || glowImage[1] != height) {
				throw fail("„glow“ muss " + image[0] + " × " + height + " Pixel groß sein (so breit wie „texture“, " + emissive.frames() + " Bilder zu je " + image[1]
						+ " Pixel untereinander; ist " + glowImage[0] + " × " + glowImage[1] + ")");
			}
		}

		List<RigBone> bones = checkRigBones(required(m, "bones", ""));
		MeshData mesh = checkMesh(required(m, "mesh", ""), bones.size());
		java.util.Map<String, Clip> clips = checkClips(required(m, "animations", ""), bones.size());
		JsonObject states = object(required(m, "states", ""), "states");
		List<String> stateKeys = new ArrayList<>(STATE_KEYS);
		stateKeys.add("blendSeconds");
		onlyKeys(states, "states", stateKeys, FORMAT_2);
		double blend = number(required(states, "blendSeconds", "states"), "states.blendSeconds", 0, BLEND_MAX);
		java.util.Map<String, String> stateMap = new java.util.LinkedHashMap<>();
		for (String key : STATE_KEYS) {
			if (!states.has(key)) {
				if (key.equals("idle")) throw fail("„states.idle“ fehlt");
				continue;
			}
			String clip = stringOrNull(states.get(key));
			if (clip == null || !clips.containsKey(clip)) throw fail("„states." + key + "“ muss der Name einer Animation sein (" + String.join(", ", clips.keySet()) + ")");
			stateMap.put(key, clip);
		}
		List<RigParticle> particles = m.has("particles") ? checkRigParticles(m.get("particles"), bones.size(), clips) : List.of();
		if (!slot.equals("companion") && m.has("attach")) throw fail("„attach“ gibt es nur beim Slot companion (nicht beim Slot " + slot + ")");
		Attach attach = null;
		if (slot.equals("companion")) {
			JsonObject a = m.has("attach") ? object(m.get("attach"), "attach") : new JsonObject();
			onlyKeys(a, "attach", List.of("origin", "side"), FORMAT_2);
			double[] origin = a.has("origin") ? vec3(a.get("origin"), "attach.origin", around(RIG_ORIGIN_MAX)) : new double[3];
			boolean right = a.has("side") && oneOf(a.get("side"), "attach.side", List.of("left", "right")).equals("right");
			attach = new Attach(origin, right);
		}
		Rig rig = new Rig(mesh.n, mesh.t, mesh.positions, mesh.normals, mesh.uvs, mesh.bones, mesh.triangles, mesh.joints, mesh.weights, bones,
				java.util.Collections.unmodifiableMap(clips), java.util.Collections.unmodifiableMap(stateMap), blend, particles, emissive, attach);
		return new Manifest(id, version, slot, name, description, access, date, texture, image[0], image[1], glow, null, List.of(), null, null, null,
				FORMAT_2, rig);
	}

	private static boolean rigTextureFits(int v) {
		return powerOfTwo(v) && v >= RIG_TEXTURE_MIN && v <= RIG_TEXTURE_MAX;
	}

	private static Emissive checkEmissive(JsonElement value) throws InvalidCosmeticException {
		JsonObject o = object(value, "emissive");
		onlyKeys(o, "emissive", List.of("frames", "frametimeTicks", "pulse"), FORMAT_2);
		int frames = integer(required(o, "frames", "emissive"), "emissive.frames", 1, GLOW_FRAMES_MAX);
		int frametime = integer(required(o, "frametimeTicks", "emissive"), "emissive.frametimeTicks", 1, FRAMETIME_MAX);
		JsonObject p = object(required(o, "pulse", "emissive"), "emissive.pulse");
		onlyKeys(p, "emissive.pulse", List.of("period", "min", "max"), FORMAT_2);
		double period = number(required(p, "period", "emissive.pulse"), "emissive.pulse.period", PULSE_PERIOD_MIN, PULSE_PERIOD_MAX);
		double min = number(required(p, "min", "emissive.pulse"), "emissive.pulse.min", 0, 1);
		double max = number(required(p, "max", "emissive.pulse"), "emissive.pulse.max", 0, 1);
		if (min > max) throw fail("„emissive.pulse.min“ darf nicht größer sein als „emissive.pulse.max“");
		return new Emissive(frames, frametime, period, min, max);
	}

	/** Knochen: Eltern zuerst (parent -1 oder ein kleinerer Index), Namen eindeutig. */
	private static List<RigBone> checkRigBones(JsonElement value) throws InvalidCosmeticException {
		if (value == null || !value.isJsonArray() || value.getAsJsonArray().isEmpty() || value.getAsJsonArray().size() > RIG_BONES_MAX) {
			throw fail("„bones“ muss eine Liste mit 1 bis " + RIG_BONES_MAX + " Knochen sein");
		}
		JsonArray array = value.getAsJsonArray();
		List<RigBone> bones = new ArrayList<>();
		java.util.Set<String> names = new java.util.HashSet<>();
		for (int i = 0; i < array.size(); i++) {
			String path = "bones[" + i + "]";
			JsonObject b = object(array.get(i), path);
			onlyKeys(b, path, List.of("name", "parent", "pivot", "tail"), FORMAT_2);
			String name = stringOrNull(required(b, "name", path));
			if (name == null || !RIG_BONE_NAME_RE.matcher(name).matches()) {
				throw fail(q(sub(path, "name")) + " ist ungültig (1–" + RIG_BONE_NAME_MAX + " Zeichen aus A–Z, a–z, 0–9, _, . und -)");
			}
			if (!names.add(name)) throw fail(q(sub(path, "name")) + ": Den Knochen „" + name + "“ gibt es schon");
			Double parent = num(required(b, "parent", path));
			if (parent == null || parent.isInfinite() || parent.isNaN() || parent != Math.rint(parent) || parent < -1 || parent >= i) {
				throw fail(i == 0 ? q(sub(path, "parent")) + " muss -1 sein (der erste Knochen hat keinen Eltern-Knochen)"
						: q(sub(path, "parent")) + " muss -1 (kein Eltern-Knochen) oder der Index eines Knochens davor sein (0 bis " + (i - 1) + ")");
			}
			float[] pivot = toFloats(vec3(required(b, "pivot", path), sub(path, "pivot"), around(RIG_COORD_MAX)));
			float[] tail = toFloats(vec3(required(b, "tail", path), sub(path, "tail"), around(RIG_COORD_MAX)));
			bones.add(new RigBone(name, (int) (double) parent, pivot, tail));
		}
		return List.copyOf(bones);
	}

	private record MeshData(int n, int t, short[] positions, byte[] normals, char[] uvs, byte[] bones, char[] triangles, byte[] joints, byte[] weights) {
	}

	/** Mesh: Längen passend zu N und T, Indizes < N, Knochen gültig; weiche Haut (joints/weights) freiwillig. */
	private static MeshData checkMesh(JsonElement value, int boneCount) throws InvalidCosmeticException {
		JsonObject o = object(value, "mesh");
		onlyKeys(o, "mesh", List.of("vertexCount", "triangleCount", "positions", "normals", "uvs", "bones", "triangles", "joints", "weights"), FORMAT_2);
		int n = integer(required(o, "vertexCount", "mesh"), "mesh.vertexCount", 1, RIG_VERTICES_MAX);
		int t = integer(required(o, "triangleCount", "mesh"), "mesh.triangleCount", 1, RIG_TRIANGLES_MAX);
		byte[] rawPositions = packed(required(o, "positions", "mesh"), "mesh.positions", 3L * n, 2, "Int16-Werte (3 je Vertex, " + n + " Vertices)");
		byte[] normals = packed(required(o, "normals", "mesh"), "mesh.normals", 3L * n, 1, "Int8-Werte (3 je Vertex, " + n + " Vertices)");
		byte[] rawUvs = packed(required(o, "uvs", "mesh"), "mesh.uvs", 2L * n, 2, "Uint16-Werte (2 je Vertex, " + n + " Vertices)");
		byte[] bones = packed(required(o, "bones", "mesh"), "mesh.bones", n, 1, "Knochen-Indizes (Uint8, 1 je Vertex)");
		for (int v = 0; v < n; v++) {
			int bone = bones[v] & 0xFF;
			if (bone >= boneCount) throw fail("„mesh.bones“: Vertex " + v + " nennt den Knochen " + bone + ", es gibt nur " + boneCount + " (0 bis " + (boneCount - 1) + ")");
		}
		byte[] rawTriangles = packed(required(o, "triangles", "mesh"), "mesh.triangles", 3L * t, 2, "Vertex-Indizes (Uint16, 3 je Dreieck, " + t + " Dreiecke)");
		char[] triangles = new char[3 * t];
		for (int i = 0; i < triangles.length; i++) {
			triangles[i] = uint16(rawTriangles, i);
			if (triangles[i] >= n) {
				throw fail("„mesh.triangles“: Dreieck " + i / 3 + " nennt den Vertex " + (int) triangles[i] + ", es gibt nur " + n + " (0 bis " + (n - 1) + ")");
			}
		}
		byte[] joints = null;
		byte[] weights = null;
		if (o.has("joints") != o.has("weights")) {
			throw fail(o.has("joints") ? "„mesh.weights“ fehlt (Pflicht mit „mesh.joints“)" : "„mesh.joints“ fehlt (Pflicht mit „mesh.weights“)");
		}
		if (o.has("joints")) {
			int k = RIG_INFLUENCES;
			joints = packed(o.get("joints"), "mesh.joints", (long) k * n, 1, "Knochen-Indizes (Uint8, " + k + " je Vertex)");
			weights = packed(o.get("weights"), "mesh.weights", (long) k * n, 1, "Gewichte (Uint8, " + k + " je Vertex)");
			for (int v = 0; v < n; v++) {
				int sum = 0;
				int max = 0;
				for (int i = v * k; i < v * k + k; i++) {
					int joint = joints[i] & 0xFF;
					if (joint >= boneCount) {
						throw fail("„mesh.joints“: Vertex " + v + " nennt den Knochen " + joint + ", es gibt nur " + boneCount + " (0 bis " + (boneCount - 1) + ")");
					}
					sum += weights[i] & 0xFF;
					max = Math.max(max, weights[i] & 0xFF);
				}
				if (sum != WEIGHT_UNIT) throw fail("„mesh.weights“: Die Gewichte von Vertex " + v + " ergeben " + sum + " statt " + WEIGHT_UNIT);
				boolean main = false;
				for (int i = v * k; i < v * k + k; i++) if ((joints[i] & 0xFF) == (bones[v] & 0xFF) && (weights[i] & 0xFF) == max) main = true;
				if (!main) throw fail("„mesh.bones“: Vertex " + v + " muss den Knochen mit dem größten Gewicht aus „mesh.joints“ nennen");
			}
		}
		short[] positions = new short[3 * n];
		for (int i = 0; i < positions.length; i++) positions[i] = int16(rawPositions, i);
		char[] uvs = new char[2 * n];
		for (int i = 0; i < uvs.length; i++) uvs[i] = uint16(rawUvs, i);
		return new MeshData(n, t, positions, normals, uvs, bones, triangles, joints, weights);
	}

	/** Animationen nach Namen: fps, frames, loop und höchstens eine Spur je Knochen. */
	private static java.util.Map<String, Clip> checkClips(JsonElement value, int boneCount) throws InvalidCosmeticException {
		JsonObject o = object(value, "animations");
		if (o.isEmpty() || o.size() > RIG_ANIMATIONS_MAX) throw fail("„animations“ muss 1 bis " + RIG_ANIMATIONS_MAX + " Animationen enthalten");
		java.util.Map<String, Clip> clips = new java.util.LinkedHashMap<>();
		for (String name : o.keySet()) {
			String path = "animations." + name;
			if (!CLIP_NAME_RE.matcher(name).matches()) throw fail(q(path) + ": Der Name ist ungültig (1–24 Zeichen aus A–Z, a–z, 0–9 und _)");
			JsonObject a = object(o.get(name), path);
			onlyKeys(a, path, List.of("fps", "frames", "loop", "tracks"), FORMAT_2);
			int fps = integer(required(a, "fps", path), sub(path, "fps"), 1, RIG_FPS_MAX);
			int frames = integer(required(a, "frames", path), sub(path, "frames"), 1, RIG_FRAMES_MAX);
			boolean loop = bool(required(a, "loop", path), sub(path, "loop"));
			JsonElement rawTracks = required(a, "tracks", path);
			if (rawTracks == null || !rawTracks.isJsonArray() || rawTracks.getAsJsonArray().size() > boneCount) {
				throw fail(q(sub(path, "tracks")) + " muss eine Liste mit höchstens " + boneCount + " Spuren sein (eine je Knochen)");
			}
			JsonArray array = rawTracks.getAsJsonArray();
			boolean[] seen = new boolean[boneCount];
			List<Track> tracks = new ArrayList<>();
			for (int i = 0; i < array.size(); i++) {
				String tp = path + ".tracks[" + i + "]";
				JsonObject tr = object(array.get(i), tp);
				onlyKeys(tr, tp, List.of("bone", "rot", "move", "scale"), FORMAT_2);
				int bone = integer(required(tr, "bone", tp), sub(tp, "bone"), 0, boneCount - 1);
				if (seen[bone]) throw fail(q(sub(tp, "bone")) + ": Für den Knochen " + bone + " gibt es in dieser Animation schon eine Spur");
				seen[bone] = true;
				if (!tr.has("rot") && !tr.has("move") && !tr.has("scale")) throw fail(q(tp) + " braucht mindestens eins von „rot“, „move“ und „scale“");
				Channel rot = tr.has("rot") ? checkKeys(tr.get("rot"), sub(tp, "rot"), frames, 4) : null;
				Channel move = tr.has("move") ? checkKeys(tr.get("move"), sub(tp, "move"), frames, 3) : null;
				Channel scale = tr.has("scale") ? checkKeys(tr.get("scale"), sub(tp, "scale"), frames, 1) : null;
				tracks.add(new Track(bone, rot, move, scale));
			}
			clips.put(name, new Clip(name, fps, frames, loop, List.copyOf(tracks)));
		}
		return clips;
	}

	/** Keys einer Spur: Frame-Nummern (erste 0, streng aufsteigend, &lt; frames) und passend viele Werte (width je Key). */
	private static Channel checkKeys(JsonElement value, String path, int frames, int width) throws InvalidCosmeticException {
		JsonObject o = object(value, path);
		onlyKeys(o, path, List.of("keys", "values"), FORMAT_2);
		String keysPath = sub(path, "keys");
		String keysText = stringOrNull(required(o, "keys", path));
		byte[] keyBytes = keysText == null ? null : decodeBase64(keysText);
		if (keyBytes == null || keyBytes.length % 2 != 0) throw fail(q(keysPath) + " muss Frame-Nummern (Uint16) als Base64 enthalten, mindestens eine");
		int count = keyBytes.length / 2;
		int[] keys = new int[count];
		int previous = -1;
		for (int i = 0; i < count; i++) {
			int frame = uint16(keyBytes, i);
			if (i == 0 && frame != 0) throw fail(q(keysPath) + " muss mit Frame 0 beginnen (ist " + frame + ")");
			if (frame <= previous) throw fail(q(keysPath) + " muss streng aufsteigen (Key " + i + ": Frame " + frame + " nach " + previous + ")");
			if (frame >= frames) throw fail(q(keysPath) + ": Frame " + frame + " liegt nicht in der Animation (0 bis " + (frames - 1) + ")");
			keys[i] = frame;
			previous = frame;
		}
		String what = width == 4 ? "Int16-Werte (x, y, z, w je Key)" : width == 3 ? "Int16-Werte (x, y, z je Key)" : "Uint16-Werte (einer je Key)";
		byte[] raw = packed(required(o, "values", path), sub(path, "values"), (long) width * count, 2, what);
		float[] values = new float[count * width];
		if (width == 4) {
			for (int k = 0; k < count; k++) {
				double square = 0;
				for (int c = 0; c < 4; c++) square += Math.pow(int16(raw, k * 4 + c) / (double) ROTATION_UNIT, 2);
				double length = Math.sqrt(square);
				if (Math.abs(length - 1) > QUATERNION_TOLERANCE) {
					throw fail(q(sub(path, "values")) + ": Das Quaternion von Key " + k + " hat die Länge " + String.format(Locale.ROOT, "%.3f", length) + " (erlaubt "
							+ fmt(1 - QUATERNION_TOLERANCE) + " bis " + fmt(1 + QUATERNION_TOLERANCE) + ")");
				}
				// für die Rechnung genau auf Länge 1
				for (int c = 0; c < 4; c++) values[k * 4 + c] = (float) (int16(raw, k * 4 + c) / (double) ROTATION_UNIT / length);
			}
		} else if (width == 3) {
			for (int i = 0; i < values.length; i++) values[i] = int16(raw, i) / 32f;
		} else {
			for (int i = 0; i < values.length; i++) values[i] = uint16(raw, i) / 1000f;
		}
		return new Channel(keys, values);
	}

	/** Partikel an Knochen: erlaubte IDs, perSecond, color nur bei dust, states = Animationen. */
	private static List<RigParticle> checkRigParticles(JsonElement value, int boneCount, java.util.Map<String, Clip> clips) throws InvalidCosmeticException {
		if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() > RIG_PARTICLES_MAX) {
			throw fail("„particles“ muss eine Liste mit höchstens " + RIG_PARTICLES_MAX + " Einträgen sein");
		}
		JsonArray array = value.getAsJsonArray();
		String clipList = String.join(", ", clips.keySet());
		List<RigParticle> result = new ArrayList<>();
		for (int i = 0; i < array.size(); i++) {
			String path = "particles[" + i + "]";
			JsonObject p = object(array.get(i), path);
			onlyKeys(p, path, List.of("bone", "at", "particle", "perSecond", "color", "states"), FORMAT_2);
			int bone = integer(required(p, "bone", path), sub(path, "bone"), 0, boneCount - 1);
			boolean tail = oneOf(required(p, "at", path), sub(path, "at"), List.of("pivot", "tail")).equals("tail");
			String given = stringOrNull(required(p, "particle", path));
			String particle = given != null && given.startsWith("minecraft:") ? given.substring("minecraft:".length()) : given;
			if (particle == null || !RIG_PARTICLES.contains(particle)) {
				throw fail(q(sub(path, "particle")) + " ist kein erlaubter Partikel (" + String.join(", ", RIG_PARTICLES) + "; mit oder ohne „minecraft:“)");
			}
			double perSecond = number(required(p, "perSecond", path), sub(path, "perSecond"), RIG_PER_SECOND_MIN, RIG_PER_SECOND_MAX);
			int color = -1;
			if (p.has("color")) {
				if (!particle.equals("dust")) throw fail(q(sub(path, "color")) + " gibt es nur beim Partikel dust");
				String c = stringOrNull(p.get("color"));
				if (c == null || !COLOR_RE.matcher(c).matches()) throw fail(q(sub(path, "color")) + " muss eine Farbe wie #ffcc00 sein");
				color = Integer.parseInt(c.substring(1), 16);
			}
			List<String> states = List.of();
			if (p.has("states")) {
				JsonElement raw = p.get("states");
				if (raw == null || !raw.isJsonArray() || raw.getAsJsonArray().isEmpty() || raw.getAsJsonArray().size() > RIG_ANIMATIONS_MAX) {
					throw fail(q(sub(path, "states")) + " muss eine Liste mit 1 bis " + RIG_ANIMATIONS_MAX + " Animationen sein");
				}
				List<String> list = new ArrayList<>();
				JsonArray names = raw.getAsJsonArray();
				for (int j = 0; j < names.size(); j++) {
					String at = path + ".states[" + j + "]";
					String clip = stringOrNull(names.get(j));
					if (clip == null || !clips.containsKey(clip)) throw fail(q(at) + " muss der Name einer Animation sein (" + clipList + ")");
					if (list.contains(clip)) throw fail(q(at) + ": „" + clip + "“ steht doppelt in der Liste");
					list.add(clip);
				}
				states = List.copyOf(list);
			}
			result.add(new RigParticle(bone, tail, particle, perSecond, color, states));
		}
		return List.copyOf(result);
	}
}
