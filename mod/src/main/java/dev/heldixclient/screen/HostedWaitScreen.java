package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.share.HostedJoin;
import dev.heldixclient.share.Hosting;
import dev.heldixclient.share.HostingService;
import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

import java.util.ArrayList;
import java.util.List;

/**
 * Eine dauerhafte Welt wird gerade geweckt (Heldix-Dienst 1.13.0): statt der Trennung „Die Welt startet gerade …“ ein
 * Warten mit Countdown, danach tritt HeldixClient von selbst noch einmal bei ({@link HostedJoin}). „Jetzt versuchen“
 * springt vor, „Abbrechen“ (oder Esc) führt zu Heldix-Welten. Läuft die Welt laut Echtzeit schon, geht es sofort weiter.
 */
public class HostedWaitScreen extends ShellScreen {
	public static final String RETRY_LABEL = "Jetzt versuchen";
	public static final String CANCEL_LABEL = "Abbrechen";

	private final String name;
	private final String address;
	private final int attempt;
	private final long started = System.currentTimeMillis();
	private final long until;
	private boolean done;
	private final List<Object[]> wrapped = new ArrayList<>();
	private int cardY;
	private int cardH;

	public HostedWaitScreen(String name, String address, int attempt) {
		super(Component.literal("Welt startet"), Shell.Page.HELDIX_WORLDS);
		this.name = name == null || name.isBlank() ? "Heldix-Welt" : name;
		this.address = address;
		this.attempt = attempt;
		this.until = started + HostedJoin.delaySeconds(attempt) * 1000L;
	}

	@Override
	protected boolean detailHeader() {
		return true;
	}

	@Override
	protected Component headerTitle() {
		return Component.literal("„" + name + "“ wird geweckt");
	}

	@Override
	protected String headerIcon() {
		return "hourglass";
	}

	@Override
	protected String subtitle() {
		return address;
	}

	@Override
	protected int toolbarActionsWidth() {
		return ActionButton.widthFor(CANCEL_LABEL, "close");
	}

	@Override
	protected void initContent() {
		wrapped.clear();
		int cw = ActionButton.widthFor(CANCEL_LABEL, "close");
		addRenderableWidget(new ActionButton(headerRight() - cw, headerButtonY(), cw, 20, CANCEL_LABEL, false, this::cancel)
				.withIcon("close").withVariant(ActionButton.Variant.GHOST));
		cardY = contentY + 4;
		cardH = 74;
		int rw = ActionButton.widthFor(RETRY_LABEL, "refresh") + 8;
		addRenderableWidget(new ActionButton(contentX + contentW - rw - 12, cardY + cardH - 32, rw, 22, RETRY_LABEL, true, this::retry).withIcon("refresh"));
		int y = cardY + cardH + 12;
		for (FormattedCharSequence line : Ui.wrap("Schläft eine dauerhafte Welt, weckt sie der erste Beitritt. Der Heldix-Server startet sie dann – das dauert "
				+ "meist etwa 30 Sekunden. HeldixClient tritt danach von selbst bei (höchstens " + HostedJoin.MAX_ATTEMPTS + " Versuche).", contentW, Ui.Font.SMALL)) {
			wrapped.add(new Object[] {line, contentX, y});
			y += 10;
		}
	}

	private int secondsLeft() {
		return (int) Math.max(0, Math.ceil((until - System.currentTimeMillis()) / 1000.0));
	}

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		Ui.rect(g, contentX, cardY, contentW, cardH, 10, Ui.SURFACE);
		Ui.outline(g, contentX, cardY, contentW, cardH, 10, Ui.ACCENT_LINE);
		Ui.rect(g, contentX + 12, cardY + 12, 24, 24, 7, Ui.ACCENT_SOFT);
		Ui.icon(g, "server", contentX + 18, cardY + 18, 12, Ui.ACCENT_TEXT);
		int textW = contentW - 60;
		Ui.text(g, Ui.ellipsize("Die Welt startet gerade auf dem Heldix-Server", textW, Ui.Font.LABEL), contentX + 44, cardY + 13, Ui.TEXT, Ui.Font.LABEL);
		int left = secondsLeft();
		String line = done ? "Verbinde …" : left > 0 ? "Neuer Versuch in " + left + " s  ·  Versuch " + attempt + " von " + HostedJoin.MAX_ATTEMPTS : "Verbinde …";
		Ui.text(g, Ui.ellipsize(line, textW, Ui.Font.SMALL), contentX + 44, cardY + 26, Ui.MUTED, Ui.Font.SMALL);
		// Fortschritt bis zum nächsten Versuch
		float total = Math.max(1, until - started);
		float t = Math.clamp((System.currentTimeMillis() - started) / total, 0f, 1f);
		int barW = contentW - 24 - ActionButton.widthFor(RETRY_LABEL, "refresh") - 28;
		Ui.rect(g, contentX + 12, cardY + cardH - 22, Math.max(20, barW), 4, 2, Ui.SURFACE_STRONG);
		Ui.rect(g, contentX + 12, cardY + cardH - 22, Math.max(4, barW * t), 4, 2, Ui.ACCENT);
		for (Object[] wrap : wrapped) g.text(font, (FormattedCharSequence) wrap[0], (int) wrap[1], (int) wrap[2], Ui.MUTED, false);
	}

	@Override
	public void tick() {
		super.tick();
		// nur aus dem Menü von selbst (aus einer offenen Welt heraus entscheidet der Spieler mit „Jetzt versuchen“)
		if (done || minecraft.level != null) return;
		HostingService.Hosted hosted = Hosting.byAddress(address);
		// eigene bzw. betreute Welt: läuft sie laut Echtzeit schon, sofort (aber nicht im ersten Augenblick)
		boolean running = hosted != null && hosted.state() == HostingService.State.RUNNING && System.currentTimeMillis() - started > 3000;
		if (running || System.currentTimeMillis() >= until) retry();
	}

	private void retry() {
		if (done) return;
		done = true;
		HostedJoin.retry(minecraft, name, address);
	}

	private void cancel() {
		done = true;
		HostedJoin.cancel();
		minecraft.gui.setScreen(new HeldixWorldsScreen());
	}

	@Override
	public void onClose() {
		cancel();
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.key() == InputConstants.KEY_ESCAPE) {
			cancel();
			return true;
		}
		return super.keyPressed(event);
	}

	/** Für den Autotest */
	public int attempt() {
		return attempt;
	}

	public String address() {
		return address;
	}
}
