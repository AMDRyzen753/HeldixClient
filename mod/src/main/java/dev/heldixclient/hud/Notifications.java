package dev.heldixclient.hud;

import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Kurze Einblendungen oben rechts im Spiel (z. B. „Jetzt läuft …“ aus dem Spotify-Addon).
 * Eine neue Einblendung derselben Quelle ersetzt die vorige; {@link #show} ist threadsicher.
 */
public final class Notifications {
	private static final long SLIDE_MS = 240;
	private static final long HOLD_MS = 4200;
	private static final long FADE_MS = 320;
	/** Einblendungen, die so lange nicht gezeigt werden konnten (z. B. im Hauptmenü), verfallen */
	private static final long STALE_MS = 6000;
	private static final int MAX_VISIBLE = 3;
	private static final int HEIGHT = 34;
	private static final int MIN_WIDTH = 150;
	private static final int MAX_WIDTH = 236;

	private static final class Entry {
		final String source;
		final long createdAt;
		String title;
		String message;
		Path image;
		/** -1 = noch nicht gezeichnet */
		long shownAt = -1;
		long hideAt;

		Entry(String source, String title, String message, Path image, long now) {
			this.source = source;
			this.title = title;
			this.message = message;
			this.image = image;
			this.createdAt = now;
		}

		boolean leaving(long now) {
			return shownAt >= 0 && now >= hideAt;
		}
	}

	private static final List<Entry> ENTRIES = new ArrayList<>();

	private Notifications() {
	}

	public static void show(String source, String title, String message, Path image) {
		long now = System.currentTimeMillis();
		String safeTitle = title != null ? title : "";
		String safeMessage = message != null ? message : "";
		synchronized (ENTRIES) {
			for (Entry entry : ENTRIES) {
				if (entry.source.equals(source) && !entry.leaving(now)) {
					// sichtbare Einblendung derselben Quelle: Inhalt austauschen, ohne erneut hereinzugleiten
					entry.title = safeTitle;
					entry.message = safeMessage;
					entry.image = image;
					if (entry.shownAt >= 0) entry.hideAt = Math.max(entry.hideAt, now + HOLD_MS);
					return;
				}
			}
			ENTRIES.removeIf(entry -> entry.source.equals(source));
			ENTRIES.add(new Entry(source, safeTitle, safeMessage, image, now));
			while (ENTRIES.size() > MAX_VISIBLE) ENTRIES.remove(0);
		}
	}

	public static void clear() {
		synchronized (ENTRIES) {
			ENTRIES.clear();
		}
	}

	/** Für den Autotest: Titel und Text der wartenden bzw. sichtbaren Einblendungen („Titel: Text“) */
	public static List<String> current() {
		synchronized (ENTRIES) {
			return ENTRIES.stream().map(entry -> entry.title + ": " + entry.message).toList();
		}
	}

	static void render(GuiGraphicsExtractor g) {
		long now = System.currentTimeMillis();
		List<Entry> visible;
		synchronized (ENTRIES) {
			ENTRIES.removeIf(entry -> entry.shownAt < 0 ? now - entry.createdAt > STALE_MS : now > entry.hideAt + FADE_MS);
			if (ENTRIES.isEmpty()) return;
			for (Entry entry : ENTRIES) {
				if (entry.shownAt < 0) {
					entry.shownAt = now;
					entry.hideAt = now + SLIDE_MS + HOLD_MS;
				}
			}
			visible = new ArrayList<>(ENTRIES);
		}
		int y = 6;
		for (Entry entry : visible) {
			y += draw(g, entry, now, y) + 4;
		}
	}

	/** @return Höhe, die die Einblendung gerade belegt (schrumpft beim Ausblenden, damit die nächste nachrückt) */
	private static int draw(GuiGraphicsExtractor g, Entry entry, long now, int y) {
		float in = ease(Math.clamp((now - entry.shownAt) / (float) SLIDE_MS, 0f, 1f));
		float out = now > entry.hideAt ? Math.clamp((now - entry.hideAt) / (float) FADE_MS, 0f, 1f) : 0f;
		float alpha = in * (1f - out);
		boolean hasImage = entry.image != null;
		int textX = 34;
		int textWidth = Math.max(Ui.width(entry.title, Ui.Font.LABEL), Ui.width(entry.message, Ui.Font.SMALL));
		int w = Math.clamp(textX + textWidth + 10, MIN_WIDTH, MAX_WIDTH);
		// lange Meldungen in zwei Zeilen (z. B. Minecrafts Hinweis zu nicht überprüfbaren Chatnachrichten)
		String[] lines = lines(entry.message, w - textX - 10);
		int height = HEIGHT + (lines.length > 1 ? 10 : 0);
		if (alpha <= 0.02f) return Math.round(height * (1f - out));
		float x = g.guiWidth() - w - 6 + (1f - in) * (w + 12);

		Ui.shadow(g, x, y, w, height, 0.45f * alpha);
		Ui.rect(g, x, y, w, height, 8, Ui.withAlpha(0xF2121826, alpha));
		Ui.outline(g, x, y, w, height, 8, Ui.withAlpha(Ui.LINE_STRONG, alpha));

		boolean drewImage = hasImage && Ui.image(g, entry.image, x + 6, y + 6, 22, 22, alpha);
		if (!drewImage) {
			Ui.rect(g, x + 6, y + 6, 22, 22, 6, Ui.withAlpha(Ui.ACCENT_SOFT, alpha));
			Ui.icon(g, "info", x + 11, y + 11, 12, Ui.withAlpha(Ui.ACCENT_TEXT, alpha));
		}
		int maxText = w - textX - 10;
		int tx = Math.round(x) + textX;
		Ui.text(g, Ui.ellipsize(entry.title, maxText, Ui.Font.LABEL), tx, y + 7, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		for (int i = 0; i < lines.length; i++) {
			Ui.text(g, lines[i], tx, y + 19 + i * 10, Ui.withAlpha(Ui.MUTED, alpha), Ui.Font.SMALL);
		}

		// verbleibende Anzeigezeit als feine Linie unten
		float remaining = Math.clamp((entry.hideAt - now) / (float) HOLD_MS, 0f, 1f);
		if (remaining > 0) Ui.rect(g, x + 8, y + height - 2.5f, (w - 16) * remaining, 1f, 0.5f, Ui.withAlpha(Ui.ACCENT_LINE, alpha));
		return Math.round(height * (1f - ease(out)));
	}

	/** Meldung in höchstens zwei Zeilen (nach Wörtern umbrochen, die zweite notfalls mit „…“) */
	static String[] lines(String message, int max) {
		if (message == null || message.isEmpty()) return new String[] {""};
		if (Ui.width(message, Ui.Font.SMALL) <= max) return new String[] {message};
		String[] words = message.split(" ");
		String first = "";
		int i = 0;
		for (; i < words.length; i++) {
			String next = first.isEmpty() ? words[i] : first + " " + words[i];
			if (Ui.width(next, Ui.Font.SMALL) > max) break;
			first = next;
		}
		if (first.isEmpty() || i >= words.length) return new String[] {Ui.ellipsize(message, max, Ui.Font.SMALL)};
		String rest = String.join(" ", java.util.Arrays.copyOfRange(words, i, words.length));
		return new String[] {first, Ui.ellipsize(rest, max, Ui.Font.SMALL)};
	}

	private static float ease(float t) {
		float inv = 1f - t;
		return 1f - inv * inv * inv;
	}
}
