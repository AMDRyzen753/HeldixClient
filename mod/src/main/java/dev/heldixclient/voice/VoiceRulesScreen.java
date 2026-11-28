package dev.heldixclient.voice;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.screen.ActionButton;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletionException;
import java.util.function.Consumer;

/**
 * Dialog „Voice-Regeln“ von HeldixClient (API 10, Heldix-Dienst 1.13.0): lädt den aktuellen Text
 * ({@code GET /v1/public/voice/rules}), zeigt ihn eigenständig und scrollbar mit dem Hinweis auf die Aufnahme der letzten
 * 10 Minuten beim Melden und fragt „Annehmen“/„Ablehnen“. „Annehmen“ geht erst, wenn der Text bis zum Ende gelesen ist, und
 * schickt {@code POST /v1/voice/rules/accept {version}}; danach verbindet der Voice Chat sofort neu. Nur hier kann man den
 * Regeln zustimmen – kein Addon kann das selbst. Textformat: „# “ Überschrift, „- “ Listenpunkt, Leerzeile neuer Absatz.
 */
public final class VoiceRulesScreen extends Screen {
	public static final String ACCEPT = "Annehmen";
	public static final String DECLINE = "Ablehnen";
	public static final String CLOSE = "Schließen";
	public static final String RETRY = "Erneut versuchen";
	private static final int MAX_TEXT = 12_000;
	private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy");

	private enum Phase {
		LOADING,
		READY,
		ERROR,
		SENDING
	}

	/** Eine Zeile des Texts: Reihenfolge wie beim Anlegen in {@link #layoutText()} (x, Farbe, y). */
	private record Line(FormattedCharSequence text, int x, int color, int y, boolean bullet) {
	}

	private final Screen parent;
	private final List<Consumer<Boolean>> callbacks;
	private Phase phase = Phase.LOADING;
	private boolean published;
	private int version;
	private long publishedAt;
	private boolean clips;
	private String text = "";
	private String error;
	private String notice;
	private boolean noticeError;
	private boolean answered;
	private boolean readToEnd;
	private double scroll;
	private int maxScroll;
	private int loads;
	private ActionButton acceptButton;
	private final List<Line> lines = new ArrayList<>();
	private int boxX;
	private int boxY;
	private int boxW;
	private int boxH;
	private int textX;
	private int textY;
	private int textW;
	private int textH;
	private int contentH;

	VoiceRulesScreen(Screen parent, List<Consumer<Boolean>> callbacks) {
		super(Component.literal("Voice-Regeln"));
		this.parent = parent;
		this.callbacks = new ArrayList<>(callbacks);
	}

	void addCallback(Consumer<Boolean> callback) {
		if (answered) callback.accept(answerNow());
		else callbacks.add(callback);
	}

	@Override
	public void added() {
		if (loads == 0) load();
	}

	// ======================================================================================
	// Laden und Annehmen
	// ======================================================================================

	private void load() {
		int load = ++loads;
		phase = Phase.LOADING;
		error = null;
		Social.request("GET", "/v1/public/voice/rules", null, false).whenComplete((json, failure) -> minecraft.execute(() -> {
			if (load != loads || answered) return;
			if (failure != null || json == null || !json.isJsonObject()) {
				phase = Phase.ERROR;
				error = "Die Voice-Regeln ließen sich nicht laden (" + reason(failure) + ").";
			} else {
				apply(json.getAsJsonObject());
				phase = Phase.READY;
			}
			rebuildWidgets();
		}));
		// eigener Stand (welche Fassung schon angenommen ist), nur angemeldet
		if (Social.online()) {
			Social.request("GET", "/v1/voice/me", null, true).whenComplete((json, failure) -> {
				if (failure == null && json != null && json.isJsonObject()) VoiceModeration.applyMe(json.getAsJsonObject());
				minecraft.execute(() -> {
					if (load == loads && !answered && phase == Phase.READY) rebuildWidgets();
				});
			});
		}
	}

	private void apply(JsonObject json) {
		published = json.has("published") && json.get("published").isJsonPrimitive() && json.get("published").getAsBoolean();
		version = (int) VoiceModeration.number(json, "version", 0);
		publishedAt = VoiceModeration.number(json, "publishedAt", 0);
		clips = json.has("clips") && json.get("clips").isJsonPrimitive() && json.get("clips").getAsBoolean();
		JsonElement raw = json.get("text");
		String value = raw != null && raw.isJsonPrimitive() ? raw.getAsString() : "";
		// nur Zeilenumbrüche behalten, keine Steuer- und Farbzeichen
		value = value.replace("\r\n", "\n").replaceAll("[\\p{Cc}&&[^\\n]]|\\p{Cf}|§", "");
		text = value.length() > MAX_TEXT ? value.substring(0, MAX_TEXT) : value;
		scroll = 0;
		readToEnd = false;
	}

	private boolean acceptedCurrent() {
		return published && version > 0 && VoiceModeration.rulesAccepted() == version;
	}

	/** braucht es noch eine Zustimmung? */
	private boolean needsConsent() {
		return phase == Phase.READY || phase == Phase.SENDING ? published && !acceptedCurrent() : VoiceModeration.rulesRequired();
	}

	private void accept() {
		if (phase != Phase.READY || !readToEnd || !needsConsent()) return;
		phase = Phase.SENDING;
		notice = null;
		rebuildWidgets();
		int accepted = version;
		VoiceModeration.accept(accepted).whenComplete((ok, failure) -> minecraft.execute(() -> {
			if (answered) return;
			if (failure == null) {
				Notifications.show("heldix-voice-rules", "Voice-Regeln", "Angenommen – der Voice Chat verbindet sich.", null);
				finish(true, true);
				return;
			}
			Throwable cause = failure instanceof CompletionException && failure.getCause() != null ? failure.getCause() : failure;
			String code = cause instanceof Social.ServiceException service ? service.code() : null;
			if ("voice-rules-version".equals(code)) {
				notice = "Die Voice-Regeln wurden gerade geändert – bitte lies die neue Fassung.";
				noticeError = false;
				load();
				rebuildWidgets();
				return;
			}
			if ("voice-rules-none".equals(code)) {
				// nichts veröffentlicht: es gibt nichts anzunehmen
				finish(true, true);
				return;
			}
			phase = Phase.READY;
			notice = "Nicht gespeichert: " + reason(failure);
			noticeError = true;
			rebuildWidgets();
		}));
	}

	private static String reason(Throwable failure) {
		Throwable cause = failure instanceof CompletionException && failure.getCause() != null ? failure.getCause() : failure;
		if (cause instanceof Social.ServiceException && cause.getMessage() != null) return cause.getMessage();
		return "Dienst nicht erreichbar";
	}

	/** Antwort für die Addons, wenn der Dialog ohne Entscheidung zugeht */
	private boolean answerNow() {
		return !needsConsent();
	}

	private void finish(boolean value, boolean navigate) {
		if (answered) return;
		answered = true;
		if (navigate && minecraft.gui.screen() == this) minecraft.gui.setScreen(parent);
		for (Consumer<Boolean> callback : callbacks) callback.accept(value);
		callbacks.clear();
	}

	@Override
	public void onClose() {
		finish(answerNow(), true);
	}

	@Override
	public void removed() {
		// ersetzt durch ein anderes Fenster (z. B. Verbindung getrennt): ohne Zustimmung beantworten
		finish(answerNow(), false);
	}

	// ======================================================================================
	// Lage und Knöpfe
	// ======================================================================================

	@Override
	protected void init() {
		boxW = Math.min(460, width - 24);
		boxH = Math.min(360, height - 20);
		boxX = (width - boxW) / 2;
		boxY = (height - boxH) / 2;
		int pad = 14;
		textX = boxX + pad;
		textW = boxW - pad * 2 - 6;
		int top = boxY + 44;
		if (phase == Phase.READY && published) top += noticeHeight() + 8;
		textY = top;
		textH = Math.max(30, boxY + boxH - 56 - top);
		layoutText();

		int buttonY = boxY + boxH - 28;
		int right = boxX + boxW - pad;
		if (phase == Phase.READY && needsConsent() || phase == Phase.SENDING) {
			int acceptW = ActionButton.widthFor(ACCEPT, "check") + 10;
			acceptButton = new ActionButton(right - acceptW, buttonY, acceptW, 20, phase == Phase.SENDING ? "Speichere …" : ACCEPT, true, this::accept)
					.withIcon("check");
			acceptButton.active = phase == Phase.READY && readToEnd;
			addRenderableWidget(acceptButton);
			int declineW = ActionButton.widthFor(DECLINE) + 6;
			ActionButton decline = new ActionButton(right - acceptW - 6 - declineW, buttonY, declineW, 20, DECLINE, false, () -> finish(false, true));
			decline.active = phase == Phase.READY;
			addRenderableWidget(decline);
		} else {
			acceptButton = null;
			int closeW = ActionButton.widthFor(CLOSE) + 10;
			addRenderableWidget(new ActionButton(right - closeW, buttonY, closeW, 20, CLOSE, phase != Phase.ERROR, () -> finish(answerNow(), true)));
			if (phase == Phase.ERROR) {
				int retryW = ActionButton.widthFor(RETRY, "refresh") + 6;
				addRenderableWidget(new ActionButton(right - closeW - 6 - retryW, buttonY, retryW, 20, RETRY, true, this::load).withIcon("refresh"));
			}
		}
	}

	private int noticeHeight() {
		return 12 + Ui.wrap(noticeText(), boxW - 28 - 24, Ui.Font.SMALL).size() * 10;
	}

	private String noticeText() {
		return "Wichtig: Meldet dich jemand, können die letzten 10 Minuten deiner Stimme angehängt werden. Dein Spiel hält die Stimmen "
				+ "der anderen dafür höchstens 10 Minuten im Arbeitsspeicher – nie auf der Festplatte, nie die eigene."
				+ (clips ? "" : " (Aufnahmen sind beim Heldix-Dienst gerade aus.)");
	}

	/** Text in Zeilen umbrechen (Überschriften, Listenpunkte, Absätze) */
	private void layoutText() {
		lines.clear();
		int y = 0;
		boolean first = true;
		int gap = 0;
		for (String raw : text.split("\n", -1)) {
			String line = raw.strip();
			if (line.isEmpty()) {
				gap = Math.max(gap, 5);
				continue;
			}
			if (line.startsWith("# ")) {
				y += first ? 0 : Math.max(gap, 9);
				for (FormattedCharSequence part : Ui.wrap(line.substring(2).strip(), textW, Ui.Font.LABEL)) {
					lines.add(new Line(part, 0, Ui.TEXT, y, false));
					y += 12;
				}
				y += 2;
			} else if (line.startsWith("- ")) {
				y += Math.max(gap, 2);
				boolean bullet = true;
				for (FormattedCharSequence part : Ui.wrap(line.substring(2).strip(), textW - 10, Ui.Font.BODY)) {
					lines.add(new Line(part, 10, 0xFFD5DCE8, y, bullet));
					bullet = false;
					y += 11;
				}
			} else {
				y += first ? 0 : Math.max(gap, 3);
				for (FormattedCharSequence part : Ui.wrap(line, textW, Ui.Font.BODY)) {
					lines.add(new Line(part, 0, 0xFFC9D2E0, y, false));
					y += 11;
				}
			}
			gap = 0;
			first = false;
		}
		contentH = y + 4;
		maxScroll = Math.max(0, contentH - textH);
		scroll = Math.clamp(scroll, 0, maxScroll);
		if (maxScroll == 0 && phase == Phase.READY) readToEnd = true;
	}

	@Override
	public void tick() {
		if (acceptButton != null) acceptButton.active = phase == Phase.READY && readToEnd;
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (minecraft.level != null) {
			extractBlurredBackground(g);
			g.fill(0, 0, width, height, 0x99060A13);
		} else {
			Ui.background(g, width, height, 1f);
		}
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		Ui.shadow(g, boxX, boxY, boxW, boxH, 0.6f);
		Ui.rect(g, boxX, boxY, boxW, boxH, 12, 0xF50F1420);
		Ui.outline(g, boxX, boxY, boxW, boxH, 12, Ui.LINE_STRONG);
		Ui.icon(g, "shield", boxX + 14, boxY + 13, 14, Ui.ACCENT_TEXT);
		Ui.text(g, "Voice-Regeln", boxX + 34, boxY + 13, Ui.TEXT, Ui.Font.TITLE);
		Ui.text(g, Ui.ellipsize(subtitle(), boxW - 48, Ui.Font.SMALL), boxX + 34, boxY + 28, Ui.FAINT, Ui.Font.SMALL);

		switch (phase) {
			case LOADING -> Ui.textCentered(g, "Lade die Voice-Regeln …", boxX + boxW / 2, boxY + boxH / 2 - 10, Ui.MUTED, Ui.Font.BODY);
			case ERROR -> {
				int y = boxY + boxH / 2 - 14;
				for (FormattedCharSequence part : Ui.wrap(error == null ? "Fehler" : error, boxW - 40, Ui.Font.BODY)) {
					g.text(font, part, boxX + (boxW - font.width(part)) / 2, y, Ui.DANGER, false);
					y += 11;
				}
			}
			default -> drawRules(g);
		}

		// Fußzeile: Hinweis bzw. Fehler beim Speichern
		String hint = footer();
		if (hint != null) {
			int color = notice != null && noticeError ? Ui.DANGER : Ui.FAINT;
			int y = boxY + boxH - 50;
			for (FormattedCharSequence part : Ui.wrap(hint, boxW - 28, Ui.Font.SMALL)) {
				if (y > boxY + boxH - 32) break;
				g.text(font, part, boxX + 14, y, color, false);
				y += 10;
			}
		}
		super.extractRenderState(g, mouseX, mouseY, delta);
		Ui.drawTooltip(g, width, height);
	}

	private String subtitle() {
		if (phase == Phase.LOADING) return "Wird geladen …";
		if (phase == Phase.ERROR) return "Nicht geladen";
		if (!published) return "Noch nicht veröffentlicht – Voice läuft ohne Pflicht-Zustimmung und ohne Aufnahmen";
		String date = publishedAt > 0 ? " · veröffentlicht am " + DATE.format(Instant.ofEpochMilli(publishedAt).atZone(ZoneId.systemDefault())) : "";
		return "Fassung " + version + date + (acceptedCurrent() ? " · von dir angenommen" : "");
	}

	private String footer() {
		if (notice != null) return notice;
		if (phase == Phase.SENDING) return "Deine Zustimmung wird gespeichert …";
		if (phase != Phase.READY) return null;
		if (!published) return "Sobald das Team die Regeln veröffentlicht, fragt dich HeldixClient nach deiner Zustimmung.";
		if (acceptedCurrent()) return "Widerrufen kannst du deine Zustimmung jederzeit in deinem Konto auf der Webseite – dann ist der Voice Chat für dich aus.";
		if (!readToEnd) return "Lies die Regeln bis zum Ende, dann kannst du sie annehmen. Ohne Zustimmung bleibt der Voice Chat aus.";
		return "Mit „Annehmen“ stimmst du den Regeln zu – auch der Aufnahme beim Melden. Widerrufen jederzeit im Konto auf der Webseite.";
	}

	private void drawRules(GuiGraphicsExtractor g) {
		if (published) {
			// Hinweis auf die Aufnahme der letzten 10 Minuten, deutlich abgesetzt
			int noticeY = boxY + 44;
			int noticeH = noticeHeight();
			Ui.rect(g, boxX + 14, noticeY, boxW - 28, noticeH, 7, 0x26FBBF24);
			Ui.outline(g, boxX + 14, noticeY, boxW - 28, noticeH, 7, 0x66FBBF24);
			Ui.icon(g, "mic", boxX + 21, noticeY + 7, 10, Ui.WARNING);
			int y = noticeY + 6;
			for (FormattedCharSequence part : Ui.wrap(noticeText(), boxW - 28 - 24, Ui.Font.SMALL)) {
				g.text(font, part, boxX + 36, y, 0xFFFDE68A, false);
				y += 10;
			}
		}
		Ui.rect(g, textX - 6, textY - 4, textW + 18, textH + 8, 7, 0x0DFFFFFF);
		g.enableScissor(textX - 4, textY - 2, textX + textW + 4, textY + textH + 2);
		int offset = (int) Math.round(scroll);
		for (Line line : lines) {
			int y = textY + line.y() - offset;
			if (y < textY - 12 || y > textY + textH) continue;
			if (line.bullet()) Ui.text(g, "•", textX + 2, y, Ui.ACCENT_TEXT, Ui.Font.BODY);
			g.text(font, line.text(), textX + line.x(), y, line.color(), false);
		}
		g.disableScissor();
		Ui.scrollbar(g, textX + textW + 6, textY, textH, scroll, maxScroll);
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		scrollBy(-scrollY * 22);
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (key == com.mojang.blaze3d.platform.InputConstants.KEY_DOWN) scrollBy(22);
		else if (key == com.mojang.blaze3d.platform.InputConstants.KEY_UP) scrollBy(-22);
		else if (key == com.mojang.blaze3d.platform.InputConstants.KEY_PAGEDOWN || key == com.mojang.blaze3d.platform.InputConstants.KEY_SPACE) scrollBy(textH - 20);
		else if (key == com.mojang.blaze3d.platform.InputConstants.KEY_PAGEUP) scrollBy(-(textH - 20));
		else if (key == com.mojang.blaze3d.platform.InputConstants.KEY_END) scrollBy(contentH);
		else if (key == com.mojang.blaze3d.platform.InputConstants.KEY_HOME) scrollBy(-contentH);
		else return super.keyPressed(event);
		return true;
	}

	private void scrollBy(double amount) {
		scroll = Math.clamp(scroll + amount, 0, maxScroll);
		if (scroll >= maxScroll - 2 && phase == Phase.READY) readToEnd = true;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	// ======================================================================================
	// Für den Autotest
	// ======================================================================================

	/** Text geladen (oder Fehler)? */
	public boolean loaded() {
		return phase == Phase.READY || phase == Phase.ERROR;
	}

	/** angezeigte Fassung, 0 = keine veröffentlicht */
	public int shownVersion() {
		return published ? version : 0;
	}

	/** Zeilen des Texts (für Prüfungen) */
	public int lineCount() {
		return lines.size();
	}

	/**
	 * Werden alle Zeilen sichtbar gezeichnet? Jede Zeile liegt im Textbereich (0 ≤ y &lt; Gesamthöhe), hat eine deckende
	 * Farbe und Text, und die erste Zeile steht ganz oben – fängt vertauschte Felder ab (0.14.0 zeigte eine leere Fläche).
	 */
	public boolean linesVisible() {
		if (lines.isEmpty() || lines.get(0).y() != 0) return false;
		for (Line line : lines) {
			if (line.y() < 0 || line.y() >= contentH || (line.color() >>> 24) < 0x80 || font.width(line.text()) <= 0) return false;
		}
		return true;
	}

	/** bis zum Ende scrollen (wie mit der Taste Ende) */
	public void scrollToEnd() {
		scrollBy(contentH);
	}

	/** kann man jetzt annehmen? */
	public boolean canAccept() {
		return acceptButton != null && phase == Phase.READY && readToEnd;
	}
}
