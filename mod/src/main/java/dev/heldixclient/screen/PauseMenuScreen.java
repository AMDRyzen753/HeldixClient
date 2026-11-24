package dev.heldixclient.screen;

import dev.heldixclient.ui.Shell;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.WorldOptionsScreen;
import net.minecraft.client.gui.screens.achievement.StatsScreen;
import net.minecraft.client.gui.screens.advancements.AdvancementsScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.social.SocialInteractionsScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * Pausemenü im Heldix-Design (ersetzt Minecrafts Pausemenü, wenn das Heldix-Design an ist).
 * Das Vanilla-Pausemenü mit Knöpfen anderer Mods bleibt über "Klassisches Pausemenü" erreichbar.
 */
public class PauseMenuScreen extends ShellScreen {
	private ActionButton disconnect;

	public PauseMenuScreen() {
		super(Component.literal("Pausemenü"), Shell.Page.PAUSE);
	}

	private record Entry(String label, String icon, Runnable action) {
	}

	@Override
	protected void initContent() {
		int x = contentX;
		int w = contentW;
		int y = contentY;
		boolean small = contentH < 190;
		int bigH = small ? 24 : 30;
		int rowH = small ? 22 : 26;
		int gap = small ? 6 : 8;

		addRenderableWidget(new ActionButton(x, y, w, bigH, "Zurück zum Spiel", true, this::resume).withIcon("play"));
		y += bigH + gap;

		List<Entry> entries = new ArrayList<>();
		entries.add(new Entry("Fortschritte", "star", () -> open(() -> new AdvancementsScreen(minecraft.player.connection.getAdvancements(), this))));
		entries.add(new Entry("Statistiken", "list", () -> open(() -> new StatsScreen(this, minecraft.player.getStats()))));
		entries.add(new Entry("Optionen", "options", () -> open(() -> new OptionsScreen(this, minecraft.options))));
		entries.add(new Entry("Welt-Optionen", "world", () -> open(() -> new WorldOptionsScreen(this, minecraft.level))));
		if (!minecraft.isLocalServer()) entries.add(new Entry("Spieler", "user", () -> open(() -> new SocialInteractionsScreen(this))));
		entries.add(new Entry("HUD-Editor", "hud", () -> open(() -> new HudEditorScreen(this))));
		if (entries.size() % 2 == 1) entries.add(new Entry("Shader", "shader", () -> open(() -> new HeldixMenuScreen(this, Shell.Page.SHADER))));

		int colW = (w - gap) / 2;
		for (int i = 0; i < entries.size(); i++) {
			Entry entry = entries.get(i);
			int bx = x + (i % 2) * (colW + gap);
			int by = y + (i / 2) * (rowH + gap);
			int bw = i % 2 == 0 ? colW : w - colW - gap;
			addRenderableWidget(new ActionButton(bx, by, bw, rowH, entry.label(), false, entry.action()).withIcon(entry.icon()));
		}

		String leave = minecraft.isLocalServer() ? "Speichern und zum Hauptmenü" : "Verbindung trennen";
		int bottom = contentY + contentH;
		disconnect = new ActionButton(x, bottom - rowH, w, rowH, leave, false, this::leave).withIcon("quit").withVariant(ActionButton.Variant.DANGER);
		addRenderableWidget(disconnect);

		String classic = "Klassisches Pausemenü";
		int cw = ActionButton.widthFor(classic, "external");
		addRenderableWidget(new ActionButton(headerRight() - cw, headerButtonY(), cw, 20, classic, false,
				() -> Shell.openVanilla(minecraft, new PauseScreen(true))).withIcon("external").withVariant(ActionButton.Variant.GHOST));
	}

	private void open(Supplier<Screen> screen) {
		minecraft.gui.setScreen(screen.get());
	}

	private void resume() {
		minecraft.gui.setScreen(null);
		minecraft.mouseHandler.grabMouse();
	}

	/** Speichern und verlassen bzw. Verbindung trennen – wie bei Minecraft (offene Meldungen werden vorher abgefragt) */
	private void leave() {
		disconnect.active = false;
		minecraft.getReportingContext().draftReportHandled(minecraft, this, () -> minecraft.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE), true);
	}

	@Override
	protected String subtitle() {
		ServerData server = minecraft.getCurrentServer();
		if (server != null && !minecraft.isLocalServer()) return "Mehrspieler  ·  " + server.name;
		if (minecraft.getSingleplayerServer() != null) {
			String world = minecraft.getSingleplayerServer().getWorldData().getLevelName();
			return "Einzelspieler  ·  " + world + (minecraft.getSingleplayerServer().isPublished() ? "  ·  im LAN geöffnet" : "");
		}
		return "Spiel pausiert";
	}

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// Hinweis über dem Verlassen-Knopf
		if (contentH >= 190 && disconnect != null) {
			Ui.text(g, "Rechte Umschalttaste öffnet im Spiel das Heldix-Menü.", contentX + 2, disconnect.getY() - 14, Ui.FAINT, Ui.Font.SMALL);
		}
	}

	@Override
	public void onClose() {
		resume();
	}
}
