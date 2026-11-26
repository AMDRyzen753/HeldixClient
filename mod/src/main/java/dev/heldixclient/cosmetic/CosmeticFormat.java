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
	public static final List<String> ACCESS = List.of("all", "team");
	public static final List<String> ANIMATION_TYPES = List.of("flap", "sway", "spin", "bob");
	public static final List<String> ANIMATION_AXES = List.of("x", "y", "z");
	public static final List<String> PARTICLE_MOTIONS = List.of("rise", "fall", "orbit", "spark", "float");
	public static final List<String> BUILTIN_CAPE_IDS = List.of("heldix", "mitternacht", "aurora", "glut", "kristall", "neon", "sakura", "gewitter", "galaxie");

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
	private static final int TEXTURE_MAX = 256;
	private static final int TEXTURE_STEP = 8;
	private static final int[] CAPE_WIDTHS = {64, 128, 256};
	private static final int CAPE_FRAMES_MAX = 32;
	private static final int CAPE_FPS_MAX = 20;
	private static final int BONES_MAX = 32;
	private static final int CUBES_MAX = 128;
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

	public record Model(int textureWidth, int textureHeight, List<Bone> bones) {
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

	/** Das geprüfte Manifest; fehlende freiwillige Felder mit Standardwert. texture/glow als PNG-Bytes. */
	public record Manifest(String id, int version, String slot, String name, String description, String access, String date,
			byte[] texture, int width, int height, byte[] glow, Model model, List<Animation> animations, Particles particles, Cape cape,
			Companion companion) {
		public boolean teamOnly() {
			return "team".equals(access);
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
		if (utf8Length(envelopeText) > 2 * ENVELOPE_BYTES) throw new InvalidCosmeticException("Der Umschlag ist zu groß (höchstens " + ENVELOPE_BYTES / 1024 + " KB)");
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
		if (utf8Length(manifest) > MANIFEST_BYTES) throw new InvalidCosmeticException("„manifest“ ist zu groß (höchstens " + MANIFEST_BYTES / 1024 + " KB)");
		if (!SIGNATURE_RE.matcher(signature).matches()) throw new InvalidCosmeticException("„signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen)");
		if (utf8Length("{\"manifest\":" + jsonQuote(manifest) + ",\"signature\":" + jsonQuote(signature) + "}") > ENVELOPE_BYTES) {
			throw new InvalidCosmeticException("Der Umschlag ist zu groß (höchstens " + ENVELOPE_BYTES / 1024 + " KB)");
		}
		return new String[] {manifest, signature};
	}

	private static String stringOrNull(JsonElement element) {
		return element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString() ? element.getAsString() : null;
	}

	/** Manifest-Text lesen und prüfen (der Text muss vorher mit seiner Signatur geprüft sein). */
	public static Manifest parseManifest(String manifest) throws InvalidCosmeticException {
		JsonElement parsed;
		try {
			parsed = parseStrict(manifest);
		} catch (RuntimeException e) {
			throw new InvalidCosmeticException("„manifest“ ist kein gültiges JSON");
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
		for (String key : o.keySet()) {
			if (!allowed.contains(key)) throw fail(q(sub(path, key)) + " ist kein bekanntes Feld (Format " + FORMAT + ")");
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
		onlyKeys(o, "model", List.of("textureSize", "bones"));
		JsonElement textureSize = required(o, "textureSize", "model");
		boolean sizeOk = textureSize != null && textureSize.isJsonArray() && textureSize.getAsJsonArray().size() == 2;
		if (sizeOk) {
			Double tw = num(textureSize.getAsJsonArray().get(0));
			Double th = num(textureSize.getAsJsonArray().get(1));
			sizeOk = tw != null && th != null && tw == width && th == height;
		}
		if (!sizeOk) throw fail("„model.textureSize“ muss genau die Größe der Textur sein ([" + width + ", " + height + "])");
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
			for (int j = 0; j < cubeArray.size(); j++) cubes.add(checkCube(cubeArray.get(j), path + ".cubes[" + j + "]", width, height));
			names.add(name);
			bones.add(new Bone(name, parent, pivot, rotation, List.copyOf(cubes)));
		}
		if (cubeCount == 0) throw fail("„model“ braucht mindestens einen Würfel");
		return new Model(width, height, List.copyOf(bones));
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
		if (format == null || format != FORMAT) throw fail("„format“ muss " + FORMAT + " sein");
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
				cape, companion);
	}
}
