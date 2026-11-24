package dev.heldixclient.loader.impl;

/**
 * Versionsvergleich für heldix.mod.json. Erlaubte Angaben:
 * {@code *}, {@code 1.2.3}, {@code 26.x}, {@code >=2.0.0}, {@code >1.0 <2.0} (alle müssen passen)
 * und {@code 26.2 || 26.3} (eine der Alternativen).
 */
final class Versions {
	private Versions() {
	}

	static boolean matches(String version, String range) {
		if (range == null || range.isBlank()) return true;
		for (String alternative : range.split("\\|\\|")) {
			if (allMatch(version, alternative.trim())) return true;
		}
		return false;
	}

	private static boolean allMatch(String version, String spec) {
		for (String part : spec.split("\\s+")) {
			if (!single(version, part)) return false;
		}
		return true;
	}

	private static boolean single(String version, String constraint) {
		if (constraint.isEmpty() || constraint.equals("*")) return true;
		String op = "";
		for (String candidate : new String[] {">=", "<=", ">", "<", "="}) {
			if (constraint.startsWith(candidate)) {
				op = candidate;
				break;
			}
		}
		String target = constraint.substring(op.length()).trim();
		if (op.isEmpty() && (target.endsWith(".x") || target.endsWith(".*"))) {
			String prefix = target.substring(0, target.length() - 2);
			return core(version).equals(prefix) || core(version).startsWith(prefix + ".");
		}
		int cmp = compare(version, target);
		return switch (op) {
			case ">=" -> cmp >= 0;
			case "<=" -> cmp <= 0;
			case ">" -> cmp > 0;
			case "<" -> cmp < 0;
			default -> cmp == 0;
		};
	}

	/** Vergleicht Versionen teilweise numerisch: 1.10 > 1.9, 26.3 == 26.3.0. */
	static int compare(String a, String b) {
		String[] left = core(a).split("[.\\-]");
		String[] right = core(b).split("[.\\-]");
		for (int i = 0; i < Math.max(left.length, right.length); i++) {
			String x = i < left.length ? left[i] : "0";
			String y = i < right.length ? right[i] : "0";
			int cmp;
			if (x.matches("\\d+") && y.matches("\\d+")) cmp = Long.compare(Long.parseLong(x), Long.parseLong(y));
			else cmp = x.compareTo(y);
			if (cmp != 0) return cmp;
		}
		return 0;
	}

	/** Version ohne Build-Angabe hinter "+". */
	private static String core(String version) {
		int plus = version.indexOf('+');
		return (plus >= 0 ? version.substring(0, plus) : version).trim();
	}
}
