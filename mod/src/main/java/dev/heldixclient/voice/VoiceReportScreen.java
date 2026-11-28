package dev.heldixclient.voice;

import dev.heldixclient.screen.ActionButton;
import dev.heldixclient.screen.SearchField;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Melde-Dialog von HeldixClient für den Voice Chat (API 10, Heldix-Dienst 1.13.0): Grund (Beleidigung, Belästigung, Hassrede,
 * Anschreien/Lärm, Sonstiges), Notiz (höchstens 300 Zeichen) und – nur wenn Aufnahmen aktiv sind und etwas gepuffert ist –
 * der Schalter „Die letzten X Minuten seiner Stimme werden angehängt“. Was sonst mitgeht (Kontext, Lautstärke-Verlauf), steht
 * im Dialog. Abschicken übernimmt {@link VoiceReports}; das Ergebnis erscheint als Einblendung im Spiel.
 */
public final class VoiceReportScreen extends Screen {
	public static final String SEND = "Melden";
	public static final String CANCEL = "Abbrechen";
	private static final String CLOSE = "Schließen";

	private final Screen parent;
	private final VoiceReports.Request request;
	private final long buffered;
	private final boolean clipsOn;
	private String reason;
	private boolean withClip = true;
	private boolean sending;
	private String status;
	private String note = "";
	private SearchField noteField;
	private ActionButton sendButton;
	private final List<ActionButton> reasonButtons = new ArrayList<>();
	private int boxX;
	private int boxY;
	private int boxW;
	private int boxH;
	private int clipY;
	private int contextY;
	/** Abstand der Gründe von oben (für die Überschrift „Grund“) */
	private int reasonsTop;

	VoiceReportScreen(Screen parent, VoiceReports.Request request) {
		super(Component.literal("Melden"));
		this.parent = parent;
		this.request = request;
		this.clipsOn = VoiceModeration.clipsActive();
		this.buffered = clipsOn ? request.bufferedMillis() : 0;
	}

	/** Was außer Grund und Notiz mitgeht (steht im Dialog) */
	private static final String CONTEXT_TEXT = "Dazu gehen mit: Server, Dimension, Zeitpunkt, wer in Hörweite war, ob ihr in einer Gruppe wart, "
			+ "und der Lautstärke-Verlauf (nur der Pegel je Sekunde, kein Inhalt).";
	private static final int PAD = 14;
	private static final int CLIP_ROW = 30;

	/**
	 * Abstände von oben im Dialog: Gründe, Notiz, Text „Dazu gehen mit“, Zeile „Aufnahme anhängen“, Knöpfe, Höhe. Alles folgt
	 * aufeinander, damit sich nichts überlappt; bei wenig Platz (kleines Fenster) mit engeren Abständen.
	 */
	private record Layout(int reasons, int note, int context, int clip, int buttons, int height) {
		static Layout of(boolean compact, int reasonRows, int contextLines, boolean clipRow) {
			int reasons = compact ? 54 : 58;
			int note = reasons + (reasonRows - 1) * 24 + 20 + (compact ? 8 : 14);
			int context = note + 20 + (compact ? 6 : 8);
			int clip = context + contextLines * 10 + (compact ? 4 : 8);
			int buttons = (clipRow ? clip + CLIP_ROW : clip) + (compact ? 6 : 10);
			return new Layout(reasons, note, context, clip, buttons, buttons + 28);
		}
	}

	/** Zeilen der Grund-Knöpfe bei dieser Breite (wie sie in init() umbrechen) */
	private static int reasonRows(int innerW) {
		int rows = 1;
		int rowX = 0;
		for (String label : VoiceReports.REASONS.values()) {
			int w = ActionButton.widthFor(label) + 4;
			if (rowX + w > innerW) {
				rows++;
				rowX = 0;
			}
			rowX += w + 5;
		}
		return rows;
	}

	@Override
	protected void init() {
		boxW = Math.min(400, width - 24);
		int pad = PAD;
		int innerW = boxW - pad * 2;
		int rows = reasonRows(innerW);
		int contextLines = Math.max(1, Ui.wrap(CONTEXT_TEXT, innerW, Ui.Font.SMALL).size());
		Layout layout = Layout.of(false, rows, contextLines, clipsOn);
		if (layout.height() > height - 16) layout = Layout.of(true, rows, contextLines, clipsOn);
		boxH = layout.height();
		reasonsTop = layout.reasons();
		boxX = (width - boxW) / 2;
		boxY = Math.max(4, (height - boxH) / 2);
		int x = boxX + pad;

		// Gründe als Knöpfe (umbrechend)
		reasonButtons.clear();
		int y = boxY + layout.reasons();
		int rowX = x;
		for (Map.Entry<String, String> entry : VoiceReports.REASONS.entrySet()) {
			int w = ActionButton.widthFor(entry.getValue()) + 4;
			if (rowX + w > x + innerW) {
				rowX = x;
				y += 24;
			}
			String key = entry.getKey();
			ActionButton button = new ActionButton(rowX, y, w, 20, entry.getValue(), key.equals(reason), () -> {
				reason = key;
				for (ActionButton other : reasonButtons) other.setPrimary(other == current(key));
			});
			button.active = !sending;
			reasonButtons.add(button);
			addRenderableWidget(button);
			rowX += w + 5;
		}
		noteField = new SearchField(x, boxY + layout.note(), innerW, 20, "Notiz (optional, höchstens " + VoiceReports.NOTE_MAX + " Zeichen)")
				.withIcon("edit").withMaxLength(VoiceReports.NOTE_MAX).keepOnEscape();
		noteField.setValue(note);
		noteField.setResponder(value -> note = value);
		noteField.active = !sending;
		addRenderableWidget(noteField);
		contextY = boxY + layout.context();
		clipY = boxY + layout.clip();

		int buttonY = boxY + layout.buttons();
		int right = boxX + boxW - pad;
		int sendW = ActionButton.widthFor(SEND, "flag") + 10;
		sendButton = new ActionButton(right - sendW, buttonY, sendW, 20, sending ? "Sende …" : SEND, true, this::send).withIcon("flag");
		sendButton.active = reason != null && !sending;
		addRenderableWidget(sendButton);
		int cancelW = ActionButton.widthFor(CANCEL) + 6;
		ActionButton cancel = new ActionButton(right - sendW - 6 - cancelW, buttonY, cancelW, 20, sending ? CLOSE : CANCEL, false, this::onClose);
		addRenderableWidget(cancel);
	}

	private ActionButton current(String key) {
		int index = new ArrayList<>(VoiceReports.REASONS.keySet()).indexOf(key);
		return index >= 0 && index < reasonButtons.size() ? reasonButtons.get(index) : null;
	}

	@Override
	public void tick() {
		if (sendButton != null) sendButton.active = reason != null && !sending;
	}

	private void send() {
		if (sending || reason == null) return;
		sending = true;
		status = "Die Meldung wird gesendet …";
		rebuildWidgets();
		VoiceReports.submit(request, reason, note, withClip && buffered > 0, message -> {
			// Ergebnis steht in der Einblendung; der Dialog geht zu
			if (minecraft.gui.screen() == this) minecraft.gui.setScreen(parent);
		});
	}

	@Override
	public void onClose() {
		// auch während des Sendens: es läuft im Hintergrund weiter, das Ergebnis kommt als Einblendung
		if (minecraft.gui.screen() == this) minecraft.gui.setScreen(parent);
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
		int pad = 14;
		int x = boxX + pad;
		int innerW = boxW - pad * 2;
		Ui.shadow(g, boxX, boxY, boxW, boxH, 0.6f);
		Ui.rect(g, boxX, boxY, boxW, boxH, 12, 0xF50F1420);
		Ui.outline(g, boxX, boxY, boxW, boxH, 12, Ui.LINE_STRONG);
		Ui.icon(g, "flag", x, boxY + 13, 14, Ui.DANGER);
		Ui.text(g, Ui.ellipsize(request.name() + " melden", boxW - 48, Ui.Font.TITLE), x + 20, boxY + 13, Ui.TEXT, Ui.Font.TITLE);
		Ui.text(g, Ui.ellipsize("Die Meldung geht an das Team von HeldixClient und wird dort geprüft.", innerW - 20, Ui.Font.SMALL), x + 20, boxY + 28,
				Ui.FAINT, Ui.Font.SMALL);
		Ui.text(g, "Grund", x, boxY + reasonsTop - 12, Ui.MUTED, Ui.Font.LABEL);

		// was mitgeht
		int y = contextY;
		for (FormattedCharSequence part : Ui.wrap(CONTEXT_TEXT, innerW, Ui.Font.SMALL)) {
			g.text(font, part, x, y, Ui.FAINT, false);
			y += 10;
		}

		if (clipsOn) {
			int rowH = CLIP_ROW;
			boolean hover = buffered > 0 && !sending && Ui.inside(mouseX, mouseY, x, clipY, innerW, rowH);
			Ui.rect(g, x, clipY, innerW, rowH, 7, hover ? 0x1CFFFFFF : 0x0DFFFFFF);
			if (buffered > 0) {
				Ui.toggle(g, x + 8, clipY + 10, withClip ? 1f : 0f);
				Ui.text(g, Ui.ellipsize(clipText(), innerW - 40, Ui.Font.BODY), x + 34, clipY + 5, Ui.TEXT, Ui.Font.BODY);
				Ui.text(g, Ui.ellipsize("Nur das Team kann sie anhören; gelöscht spätestens 90 Tage nach dem Hochladen.", innerW - 40, Ui.Font.SMALL), x + 34,
						clipY + 17, Ui.FAINT, Ui.Font.SMALL);
			} else {
				Ui.icon(g, "info", x + 8, clipY + 10, 10, Ui.FAINT);
				Ui.text(g, Ui.ellipsize("Von seiner Stimme ist gerade nichts aufgenommen – es geht keine Aufnahme mit.", innerW - 34, Ui.Font.SMALL), x + 24,
						clipY + 11, Ui.MUTED, Ui.Font.SMALL);
			}
		}

		if (status != null) Ui.text(g, Ui.ellipsize(status, innerW - 150, Ui.Font.SMALL), x, boxY + boxH - 22, Ui.MUTED, Ui.Font.SMALL);
		else if (reason == null) Ui.text(g, "Wähle zuerst einen Grund.", x, boxY + boxH - 22, Ui.FAINT, Ui.Font.SMALL);
		super.extractRenderState(g, mouseX, mouseY, delta);
		Ui.drawTooltip(g, width, height);
	}

	/** „Die letzten 4 Minuten seiner Stimme werden angehängt“ (unter einer Minute in Sekunden) */
	private String clipText() {
		if (!withClip) return "Ohne Aufnahme melden (Schalter an: seine Stimme anhängen)";
		long seconds = Math.max(1, Math.min(600, Math.round(buffered / 1000.0)));
		long minutes = Math.round(seconds / 60.0);
		if (seconds < 60) return "Die letzten " + seconds + " Sekunden seiner Stimme werden angehängt";
		if (minutes <= 1) return "Die letzte Minute seiner Stimme wird angehängt";
		return "Die letzten " + minutes + " Minuten seiner Stimme werden angehängt";
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		// Knöpfe und Notiz zuerst: Der Schalter „Aufnahme anhängen“ darf nie einen Klick auf „Melden“ schlucken
		if (super.mouseClicked(event, doubleClick)) return true;
		int x = boxX + PAD;
		if (clipsOn && buffered > 0 && !sending && Ui.inside(event.x(), event.y(), x, clipY, boxW - PAD * 2, CLIP_ROW)) {
			withClip = !withClip;
			return true;
		}
		return false;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	// ======================================================================================
	// Für den Autotest
	// ======================================================================================

	public String target() {
		return request.name();
	}

	/** Schalter „Aufnahme anhängen“ sichtbar (Aufnahmen aktiv und etwas gepuffert)? */
	public boolean clipOffered() {
		return clipsOn && buffered > 0;
	}

	public boolean clipSelected() {
		return clipOffered() && withClip;
	}

	public boolean sending() {
		return sending;
	}
}
