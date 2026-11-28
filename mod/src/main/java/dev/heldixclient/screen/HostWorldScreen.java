package dev.heldixclient.screen;

import com.mojang.blaze3d.Blaze3D;
import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.share.HostedJoin;
import dev.heldixclient.share.Hosting;
import dev.heldixclient.share.HostingService;
import dev.heldixclient.share.HostingTransfer;
import dev.heldixclient.share.WorldShare;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * „Dauerhaft online stellen“ (Heldix-Dienst 1.13.0): erst die Erklärung (läuft auf dem Heldix-Server, schläft, wenn leer,
 * Verwaltung auf der Webseite, die Einzelspielerwelt bleibt, Minecraft-EULA), dann der Fortschritt von
 * {@link HostingTransfer} (Sicherung, Upload in Teilen mit Abbrechen, Prüfung) und zum Schluss Adresse, „Beitreten“ und
 * „Auf der Webseite verwalten“. Zeigt auch den Fortschritt beim Herunterladen einer dauerhaften Welt als neue Welt.
 */
public class HostWorldScreen extends ShellScreen {
	public static final String UPLOAD_LABEL = "Hochladen und online stellen";
	public static final String CANCEL_LABEL = "Abbrechen";
	public static final String JOIN_LABEL = "Beitreten";
	public static final String MANAGE_LABEL = "Auf der Webseite verwalten";
	public static final String PLAY_LABEL = "Jetzt spielen";
	public static final String DONE_LABEL = "Fertig";
	public static final String EULA_LABEL = "EULA ansehen";

	private enum Mode {
		/** Erklärung vor dem Hochladen */
		INFO,
		/** Übertragung läuft bzw. ist fertig (Ergebnis aus HostingTransfer.current()) */
		JOB
	}

	private record Label(int x, int y, int w, String text, int color, Ui.Font font) {
	}

	private final Screen back;
	private final Path world;
	private final String worldName;
	private Mode mode;
	private final List<Label> labels = new ArrayList<>();
	private final List<Object[]> wrapped = new ArrayList<>();
	/** Symbole vor den Erklärungen: {Icon, x, y} */
	private final List<Object[]> icons = new ArrayList<>();
	private int cardY = -1;
	private int cardH;
	private int barY = -1;
	private String message;
	private boolean messageError;
	private String signature = "";
	/** Erklärung einzeilig (kleines Fenster) */
	private boolean compact;
	/** rechts freizuhaltende Breite beim aktuellen Punkt (Knopf „EULA ansehen“) */
	private int eulaWidth;

	private HostWorldScreen(Screen back, Path world, String worldName, Mode mode) {
		super(Component.literal("Dauerhaft online"), Minecraft.getInstance().level != null ? Shell.Page.PAUSE : Shell.Page.HELDIX_WORLDS);
		this.back = back;
		this.world = world;
		this.worldName = worldName;
		this.mode = mode;
	}

	/** Erklärung und „Hochladen“ für eine Welt aus saves/ (läuft schon eine Übertragung: deren Fortschritt) */
	public static HostWorldScreen upload(Screen back, Path world, String worldName) {
		return new HostWorldScreen(back, world, worldName, HostingTransfer.busy() ? Mode.JOB : Mode.INFO);
	}

	/** Fortschritt der laufenden (bzw. letzten) Übertragung */
	public static HostWorldScreen progress(Screen back) {
		return new HostWorldScreen(back, null, null, Mode.JOB);
	}

	public boolean showingJob() {
		return mode == Mode.JOB;
	}

	// ======================================================================================
	// Kopf
	// ======================================================================================

	@Override
	protected boolean detailHeader() {
		return true;
	}

	@Override
	protected Component headerTitle() {
		HostingTransfer.Job job = HostingTransfer.current();
		if (mode == Mode.JOB && job != null && job.kind == HostingTransfer.Kind.DOWNLOAD) return Component.literal("Herunterladen · " + job.name);
		return Component.literal("Dauerhaft online stellen" + (name() != null ? " · " + name() : ""));
	}

	@Override
	protected String headerIcon() {
		HostingTransfer.Job job = HostingTransfer.current();
		return mode == Mode.JOB && job != null && job.kind == HostingTransfer.Kind.DOWNLOAD ? "download" : "server";
	}

	@Override
	protected String subtitle() {
		return mode == Mode.INFO ? "läuft auf dem Heldix-Server – auch wenn du offline bist" : null;
	}

	private String name() {
		HostingTransfer.Job job = HostingTransfer.current();
		return worldName != null ? worldName : job != null ? job.name : null;
	}

	@Override
	protected int toolbarActionsWidth() {
		int w = ActionButton.widthFor("Zurück", "back");
		if (mode == Mode.INFO) w += ActionButton.widthFor(UPLOAD_LABEL, "server") + 6;
		return w;
	}

	// ======================================================================================
	// Aufbau
	// ======================================================================================

	@Override
	protected void initContent() {
		labels.clear();
		wrapped.clear();
		icons.clear();
		cardY = -1;
		barY = -1;
		int bw = ActionButton.widthFor("Zurück", "back");
		addRenderableWidget(new ActionButton(headerRight() - bw, headerButtonY(), bw, 20, "Zurück", false, this::onClose)
				.withIcon("back").withVariant(ActionButton.Variant.GHOST));
		if (mode == Mode.INFO) buildInfo(bw);
		else buildJob();
		if (message != null) labels.add(new Label(contentX, contentY + contentH - 10, contentW, message, messageError ? Ui.DANGER : Ui.SUCCESS, Ui.Font.SMALL));
		signature = signature();
	}

	private void buildInfo(int backW) {
		HostingService.Overview overview = Hosting.overview();
		String problem = overview == null ? null : !overview.available() ? (overview.problem() != null ? overview.problem() : "Dauerhafte Welten sind auf diesem Heldix-Dienst nicht eingerichtet.")
				: !overview.allowed() ? "Dauerhafte Welten sind gerade in der Beta – bald mit Heldix+." : null;
		int uw = ActionButton.widthFor(UPLOAD_LABEL, "server");
		ActionButton go = new ActionButton(headerRight() - backW - 6 - uw, headerButtonY(), uw, 20, UPLOAD_LABEL, true, this::start).withIcon("server");
		go.active = problem == null && world != null && !HostingTransfer.busy();
		addRenderableWidget(go);
		if (overview == null) Hosting.refresh().whenComplete((ignored, error) -> minecraft.execute(() -> {
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));

		int y = contentY + 2;
		// kleine Fenster: je Punkt nur eine (gekürzte) Zeile
		compact = contentH < 250;
		y = point(y, "server", "Läuft auf dem Heldix-Server", "Auch wenn du offline bist. Freunde treten über dieselbe Adresse bei wie bisher – Mitglieder, Rollen "
				+ "und Anklopfen bleiben.");
		y = point(y, "hourglass", "Schläft, wenn niemand drin ist", "Nach ein paar Minuten ohne Spieler hält sie an. Wer beitritt, weckt sie – das dauert etwa "
				+ "30 Sekunden.");
		y = point(y, "external", "Verwalten auf der Webseite", "Plugins, Konsole, Einstellungen und Sicherungen findest du unter Konto → Meine Welten.");
		y = point(y, "world", "Deine Einzelspielerwelt bleibt", "Auf diesem PC ändert sich nichts. Was auf dem Server passiert, holst du später mit "
				+ "„Herunterladen“ als neue Welt zurück.");
		int eulaY = y;
		int ew = ActionButton.widthFor(EULA_LABEL, "external");
		eulaWidth = ew + 8;
		y = point(y, "shield", "Minecraft-EULA", "Mit dem Hochladen gilt für den Server die Minecraft-EULA von Mojang.");
		eulaWidth = 0;
		// Knopf rechts neben dem Punkt zur EULA (passt immer, auch im kleinen Fenster)
		addRenderableWidget(new ActionButton(contentX + contentW - ew, eulaY, ew, 20, EULA_LABEL, false, this::openEula).withIcon("external")
				.withVariant(ActionButton.Variant.SECONDARY));
		if (WorldShare.active()) y = paragraph(y, "Teilst du die Welt gerade, endet das Teilen dabei – danach tritt jeder über den Heldix-Server bei.", Ui.WARNING);
		if (problem != null) paragraph(y, problem, Ui.DANGER);
		else if (world == null) paragraph(y, "Diese Welt liegt nicht auf diesem PC.", Ui.DANGER);
	}

	/** Erklärung mit Symbol: Titel und umbrochener Text (kompakt: eine Zeile); liefert die nächste y-Position */
	private int point(int y, String icon, String title, String text) {
		int textW = contentW - 24 - eulaWidth;
		icons.add(new Object[] {icon, contentX, y + 1});
		labels.add(new Label(contentX + 24, y, textW, title, Ui.TEXT, Ui.Font.LABEL));
		if (compact) {
			labels.add(new Label(contentX + 24, y + 11, textW, text, Ui.MUTED, Ui.Font.SMALL));
			return y + 24;
		}
		int line = y + 12;
		for (FormattedCharSequence part : Ui.wrap(text, textW, Ui.Font.SMALL)) {
			if (line + 9 > contentY + contentH - 12) break;
			wrapped.add(new Object[] {part, contentX + 24, line, Ui.MUTED});
			line += 10;
		}
		return line + 6;
	}

	private void buildJob() {
		HostingTransfer.Job job = HostingTransfer.current();
		if (job == null) {
			paragraph(contentY + 10, "Gerade wird nichts übertragen.", Ui.MUTED);
			return;
		}
		cardY = contentY + 2;
		cardH = 64;
		boolean upload = job.kind == HostingTransfer.Kind.UPLOAD;
		int textW = contentW - 60;
		String title = switch (job.phase()) {
			case DONE -> upload ? "„" + job.name + "“ läuft jetzt dauerhaft" : "„" + job.importedName() + "“ ist angelegt";
			case FAILED -> upload ? "Nicht online gestellt" : "Nicht heruntergeladen";
			case CANCELLED -> "Abgebrochen";
			default -> upload ? "„" + job.name + "“ wird online gestellt" : "„" + job.name + "“ wird heruntergeladen";
		};
		labels.add(new Label(contentX + 44, cardY + 12, textW, title, Ui.TEXT, Ui.Font.LABEL));
		String line;
		int color = Ui.MUTED;
		HostingService.Hosted result = job.result();
		if (job.phase() == HostingTransfer.Phase.DONE && upload && result != null) {
			line = (result.address() != null ? WorldShare.normalizeAddress(result.address()) + "  ·  " : "") + result.stateLine();
		} else if (job.phase() == HostingTransfer.Phase.DONE) {
			line = "Neue Einzelspielerwelt – " + (minecraft.level == null ? "gleich spielen oder unter Einzelspieler" : "im Hauptmenü unter Einzelspieler");
		} else if (job.phase() == HostingTransfer.Phase.FAILED) {
			line = job.error() != null ? job.error() : "Unbekannter Fehler";
			color = Ui.DANGER;
		} else if (job.phase() == HostingTransfer.Phase.CANCELLED) {
			line = upload ? "Der Upload ist verworfen. Deine Einzelspielerwelt ist unverändert." : "Es wurde keine Welt angelegt.";
		} else {
			line = job.line();
		}
		labels.add(new Label(contentX + 44, cardY + 26, textW, line, color, Ui.Font.SMALL));
		if (job.running()) barY = cardY + cardH - 16;

		int by = cardY + cardH + 10;
		if (job.running()) {
			int cw = ActionButton.widthFor(CANCEL_LABEL, "close") + 8;
			addRenderableWidget(new ActionButton(contentX + contentW - cw, by, cw, 22, CANCEL_LABEL, false, job::cancel)
					.withIcon("close").withVariant(ActionButton.Variant.DANGER));
			paragraph(by + 30, upload ? "Du kannst diese Seite verlassen – das Hochladen läuft im Hintergrund weiter (Heldix-Welten zeigt den Stand)."
					: "Du kannst diese Seite verlassen – das Herunterladen läuft im Hintergrund weiter.", Ui.MUTED);
			return;
		}
		int x = contentX;
		if (job.phase() == HostingTransfer.Phase.DONE && upload && result != null) {
			int jw = ActionButton.widthFor(JOIN_LABEL, "play");
			ActionButton join = new ActionButton(x, by, jw, 22, JOIN_LABEL, true, () -> join(result)).withIcon("play");
			join.active = result.address() != null;
			addRenderableWidget(join);
			x += jw + 6;
			int mw = ActionButton.widthFor(MANAGE_LABEL, "external");
			addRenderableWidget(new ActionButton(x, by, mw, 22, MANAGE_LABEL, false, this::manage).withIcon("external"));
			x += mw + 6;
			paragraph(by + 32, minecraft.level != null ? "Beitreten verlässt diese Welt (sie wird gespeichert). Die Welt auf dem Server schläft gerade – "
					+ "Beitreten weckt sie (etwa 30 Sekunden)." : "Die Welt schläft gerade – Beitreten weckt sie (etwa 30 Sekunden).", Ui.MUTED);
		} else if (job.phase() == HostingTransfer.Phase.DONE && job.imported() != null && minecraft.level == null) {
			int pw = ActionButton.widthFor(PLAY_LABEL, "play");
			Path folder = job.imported();
			addRenderableWidget(new ActionButton(x, by, pw, 22, PLAY_LABEL, true, () -> {
				HostingTransfer.forget();
				minecraft.createWorldOpenFlows().openWorld(folder.getFileName().toString(), () -> minecraft.gui.setScreen(new WorldsScreen()));
			}).withIcon("play"));
			x += pw + 6;
		} else if (job.phase() == HostingTransfer.Phase.FAILED && upload && world != null) {
			int rw = ActionButton.widthFor("Erneut versuchen", "refresh");
			addRenderableWidget(new ActionButton(x, by, rw, 22, "Erneut versuchen", true, () -> {
				HostingTransfer.forget();
				mode = Mode.INFO;
				rebuildWidgets();
			}).withIcon("refresh"));
			x += rw + 6;
		}
		int dw = ActionButton.widthFor(DONE_LABEL, "check");
		addRenderableWidget(new ActionButton(contentX + contentW - dw, by, dw, 22, DONE_LABEL, job.phase() != HostingTransfer.Phase.DONE || !upload, this::finish)
				.withIcon("check"));
	}

	private int paragraph(int y, String text, int color) {
		for (FormattedCharSequence line : Ui.wrap(text, contentW, Ui.Font.SMALL)) {
			if (y + 9 > contentY + contentH - 12) break;
			wrapped.add(new Object[] {line, contentX, y, color});
			y += 10;
		}
		return y + 4;
	}

	// ======================================================================================
	// Aktionen
	// ======================================================================================

	private void start() {
		if (world == null || HostingTransfer.busy()) return;
		HostingTransfer.Job job = HostingTransfer.upload(minecraft, world, worldName);
		if (job == null) {
			note("Es läuft schon eine Übertragung.", true);
		} else {
			mode = Mode.JOB;
			message = null;
		}
		rebuildWidgets();
	}

	private void join(HostingService.Hosted result) {
		if (result.address() == null) return;
		HostingTransfer.forget();
		HostedJoin.join(minecraft, new HeldixWorldsScreen(), result.name(), result.address());
	}

	private void manage() {
		Hosting.manageOnWebsite().whenComplete((ignored, error) -> minecraft.execute(() -> {
			note(error != null ? dev.heldixclient.share.WorldService.message(error) : "Die Webseite ist im Browser geöffnet.", error != null);
			if (minecraft.gui.screen() == this) rebuildWidgets();
		}));
	}

	private void openEula() {
		HostingService.Overview overview = Hosting.overview();
		String eula = overview != null && overview.limits() != null ? overview.limits().eula() : "https://www.minecraft.net/eula";
		Blaze3D.openUri(java.net.URI.create(eula));
	}

	private void finish() {
		HostingTransfer.forget();
		onClose();
	}

	private void note(String text, boolean error) {
		message = text;
		messageError = error;
	}

	@Override
	public void onClose() {
		minecraft.gui.setScreen(back);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.key() == InputConstants.KEY_ESCAPE) {
			onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	// ======================================================================================
	// Zeichnen, Aktualisieren
	// ======================================================================================

	private String signature() {
		HostingTransfer.Job job = HostingTransfer.current();
		if (mode == Mode.INFO) return "info|" + (Hosting.overview() == null) + "|" + HostingTransfer.busy() + "|" + Hosting.changes();
		return job == null ? "keiner" : job.phase() + "|" + job.line() + "|" + job.error();
	}

	@Override
	public void tick() {
		super.tick();
		if (!signature().equals(signature)) rebuildWidgets();
	}

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		if (cardY >= 0) {
			HostingTransfer.Job job = HostingTransfer.current();
			boolean failed = job != null && job.phase() == HostingTransfer.Phase.FAILED;
			boolean done = job != null && job.phase() == HostingTransfer.Phase.DONE;
			Ui.rect(g, contentX, cardY, contentW, cardH, 10, Ui.SURFACE);
			Ui.outline(g, contentX, cardY, contentW, cardH, 10, failed ? Ui.withAlpha(Ui.DANGER, 0.6f) : done ? Ui.withAlpha(Ui.SUCCESS, 0.6f) : Ui.ACCENT_LINE);
			Ui.rect(g, contentX + 12, cardY + 12, 24, 24, 7, failed ? 0x33F87171 : done ? 0x3334D399 : Ui.ACCENT_SOFT);
			String icon = failed ? "warning" : done ? "check" : job != null && job.kind == HostingTransfer.Kind.DOWNLOAD ? "download" : "server";
			Ui.icon(g, icon, contentX + 18, cardY + 18, 12, failed ? Ui.DANGER : done ? Ui.SUCCESS : Ui.ACCENT_TEXT);
			if (barY >= 0 && job != null) {
				int bx = contentX + 12;
				int bw = contentW - 24;
				Ui.rect(g, bx, barY, bw, 4, 2, Ui.SURFACE_STRONG);
				double progress = job.progress();
				if (progress >= 0) {
					Ui.rect(g, bx, barY, (float) Math.max(4, bw * progress), 4, 2, Ui.ACCENT);
				} else {
					// unbestimmt: wandernder Abschnitt
					float t = (System.currentTimeMillis() % 1600) / 1600f;
					float w = bw * 0.25f;
					Ui.rect(g, bx + (bw - w) * t, barY, w, 4, 2, Ui.ACCENT);
				}
			}
		}
		for (Object[] icon : icons) {
			int x = (int) icon[1];
			int y = (int) icon[2];
			Ui.rect(g, x, y, 16, 16, 5, Ui.ACCENT_SOFT);
			Ui.icon(g, (String) icon[0], x + 3, y + 3, 10, Ui.ACCENT_TEXT);
		}
		for (Label label : labels) {
			Ui.text(g, Ui.ellipsize(label.text(), Math.max(10, label.w()), label.font()), label.x(), label.y(), label.color(), label.font());
		}
		for (Object[] line : wrapped) g.text(font, (FormattedCharSequence) line[0], (int) line[1], (int) line[2], (int) line[3], false);
	}

	// ======================================================================================
	// Für den Autotest
	// ======================================================================================

	public List<String> describe() {
		List<String> list = new ArrayList<>();
		for (Label label : labels) list.add(label.text());
		for (Object[] line : wrapped) {
			StringBuilder text = new StringBuilder();
			((FormattedCharSequence) line[0]).accept((index, style, codePoint) -> {
				text.appendCodePoint(codePoint);
				return true;
			});
			list.add(text.toString());
		}
		return list;
	}
}
