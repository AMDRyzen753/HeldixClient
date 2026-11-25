package dev.heldixclient.bridge;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Kleiner JSON-Leser und -Schreiber für bridge.json und die Nachrichten an den Launcher (keine Bibliotheken nötig). */
final class Json {
	private final String text;
	private int pos;

	private Json(String text) {
		this.text = text;
	}

	/** Objekt, Liste, String, Double, Boolean oder null */
	static Object parse(String text) {
		Json json = new Json(text);
		Object value = json.value();
		json.space();
		if (json.pos != text.length()) throw json.error("Zeichen nach dem Ende");
		return value;
	}

	@SuppressWarnings("unchecked")
	static Map<String, Object> parseObject(String text) {
		Object value = parse(text);
		if (!(value instanceof Map)) throw new IllegalArgumentException("JSON-Objekt erwartet");
		return (Map<String, Object>) value;
	}

	static String write(Map<String, ?> object) {
		StringBuilder out = new StringBuilder("{");
		boolean first = true;
		for (Map.Entry<String, ?> entry : object.entrySet()) {
			if (!first) out.append(',');
			first = false;
			string(out, entry.getKey());
			out.append(':');
			Object value = entry.getValue();
			if (value == null) out.append("null");
			else if (value instanceof Boolean || value instanceof Number) out.append(value);
			else string(out, value.toString());
		}
		return out.append('}').toString();
	}

	private static void string(StringBuilder out, String value) {
		out.append('"');
		for (int i = 0; i < value.length(); i++) {
			char c = value.charAt(i);
			switch (c) {
				case '"': out.append("\\\""); break;
				case '\\': out.append("\\\\"); break;
				case '\n': out.append("\\n"); break;
				case '\r': out.append("\\r"); break;
				case '\t': out.append("\\t"); break;
				default:
					if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
					else out.append(c);
			}
		}
		out.append('"');
	}

	private Object value() {
		space();
		if (pos >= text.length()) throw error("Ende der Daten");
		char c = text.charAt(pos);
		if (c == '{') return object();
		if (c == '[') return array();
		if (c == '"') return string();
		if (text.startsWith("true", pos)) {
			pos += 4;
			return Boolean.TRUE;
		}
		if (text.startsWith("false", pos)) {
			pos += 5;
			return Boolean.FALSE;
		}
		if (text.startsWith("null", pos)) {
			pos += 4;
			return null;
		}
		return number();
	}

	private Map<String, Object> object() {
		Map<String, Object> map = new LinkedHashMap<>();
		pos++;
		space();
		if (peek() == '}') {
			pos++;
			return map;
		}
		while (true) {
			space();
			if (peek() != '"') throw error("Schlüssel erwartet");
			String key = string();
			space();
			expect(':');
			map.put(key, value());
			space();
			char c = next();
			if (c == '}') return map;
			if (c != ',') throw error("',' oder '}' erwartet");
		}
	}

	private List<Object> array() {
		List<Object> list = new ArrayList<>();
		pos++;
		space();
		if (peek() == ']') {
			pos++;
			return list;
		}
		while (true) {
			list.add(value());
			space();
			char c = next();
			if (c == ']') return list;
			if (c != ',') throw error("',' oder ']' erwartet");
		}
	}

	private String string() {
		StringBuilder out = new StringBuilder();
		pos++;
		while (true) {
			char c = next();
			if (c == '"') return out.toString();
			if (c != '\\') {
				out.append(c);
				continue;
			}
			char e = next();
			switch (e) {
				case 'n': out.append('\n'); break;
				case 'r': out.append('\r'); break;
				case 't': out.append('\t'); break;
				case 'b': out.append('\b'); break;
				case 'f': out.append('\f'); break;
				case 'u':
					if (pos + 4 > text.length()) throw error("unvollständiges \\u");
					out.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
					pos += 4;
					break;
				default: out.append(e);
			}
		}
	}

	private Double number() {
		int start = pos;
		while (pos < text.length() && "+-0123456789.eE".indexOf(text.charAt(pos)) >= 0) pos++;
		if (start == pos) throw error("Wert erwartet");
		return Double.valueOf(text.substring(start, pos));
	}

	private void space() {
		while (pos < text.length() && Character.isWhitespace(text.charAt(pos))) pos++;
	}

	private char peek() {
		if (pos >= text.length()) throw error("Ende der Daten");
		return text.charAt(pos);
	}

	private char next() {
		char c = peek();
		pos++;
		return c;
	}

	private void expect(char c) {
		if (next() != c) throw error("'" + c + "' erwartet");
	}

	private IllegalArgumentException error(String message) {
		return new IllegalArgumentException("Ungültiges JSON (" + message + " bei Zeichen " + pos + ")");
	}
}
