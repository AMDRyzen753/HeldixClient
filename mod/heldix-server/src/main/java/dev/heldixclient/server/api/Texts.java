package dev.heldixclient.server.api;

/** Texte für HeldixClient bereinigen – genauso wie der Client es auch tut. */
public final class Texts {
	private Texts() {
	}

	/**
	 * §-Codes (§ und das Zeichen danach), Steuer- und Formatzeichen entfernen, Leerraum zusammenfassen, auf {@code max}
	 * Zeichen kürzen (ohne ein Zeichenpaar zu teilen). null wird "".
	 */
	public static String clean(String text, int max) {
		if (text == null) return "";
		String clean = text.replaceAll("§.?", "").replaceAll("[\\p{Cc}\\p{Cf}\\p{Cs}\\u2028\\u2029]", " ").replaceAll("\\s+", " ").strip();
		if (clean.length() > max) {
			int end = max;
			if (Character.isHighSurrogate(clean.charAt(end - 1))) end--;
			clean = clean.substring(0, end).strip();
		}
		return clean;
	}
}
