package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.NativeImage;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.ui.Ui;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.FaviconTexture;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.gui.screens.worldselection.EditWorldScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.world.level.storage.LevelStorageSource;
import net.minecraft.world.level.storage.LevelSummary;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Einzelspieler: Welten als Karten, mit Suche, Spielen per Doppelklick, Bearbeiten und Löschen. */
public class WorldsScreen extends ShellScreen {
	private static final int ROW_H = 40;
	private static final int GAP = 6;
	private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm", Locale.GERMANY).withZone(ZoneId.systemDefault());

	private List<LevelSummary> worlds;
	private String error;
	private String status;
	private final Map<String, FaviconTexture> icons = new HashMap<>();
	private String selected;
	private double scroll;
	private SearchField search;
	private String query = "";
	private long lastClickAt;
	private String lastClickId;

	public WorldsScreen() {
		super(Component.literal("Einzelspieler"), Shell.Page.WORLDS);
	}

	// ---------- Laden ----------

	private void load() {
		LevelStorageSource source = minecraft.getLevelSource();
		LevelStorageSource.LevelCandidates candidates;
		try {
			candidates = source.findLevelCandidates();
		} catch (Exception e) {
			error = "Welten konnten nicht gelesen werden: " + e.getMessage();
			worlds = List.of();
			return;
		}
		if (candidates.isEmpty()) {
			worlds = List.of();
			return;
		}
		source.loadLevelSummaries(candidates).whenCompleteAsync((list, failure) -> {
			if (failure != null) {
				error = "Welten konnten nicht gelesen werden: " + failure.getMessage();
				worlds = List.of();
				return;
			}
			worlds = new ArrayList<>(list);
			for (LevelSummary summary : worlds) loadIcon(summary);
			if (selected == null && !worlds.isEmpty()) selected = worlds.getFirst().getLevelId();
		}, minecraft);
	}

	private void loadIcon(LevelSummary summary) {
		Path file = summary.getIcon();
		if (file == null || !Files.isRegularFile(file) || icons.containsKey(summary.getLevelId())) return;
		FaviconTexture texture = FaviconTexture.forWorld(minecraft.getTextureManager(), summary.getLevelId());
		try (InputStream in = Files.newInputStream(file)) {
			texture.upload(NativeImage.read(in));
			icons.put(summary.getLevelId(), texture);
		} catch (Exception e) {
			texture.close();
		}
	}

	private List<LevelSummary> visible() {
		if (worlds == null) return List.of();
		String q = query.trim().toLowerCase(Locale.ROOT);
		if (q.isEmpty()) return worlds;
		List<LevelSummary> result = new ArrayList<>();
		for (LevelSummary summary : worlds) {
			if (summary.getLevelName().toLowerCase(Locale.ROOT).contains(q) || summary.getLevelId().toLowerCase(Locale.ROOT).contains(q)) result.add(summary);
		}
		return result;
	}

	private LevelSummary selectedSummary() {
		for (LevelSummary summary : visible()) if (summary.getLevelId().equals(selected)) return summary;
		return null;
	}

	/** Anzahl der geladenen Welten (für den Autotest), -1 solange geladen wird. */
	public int worldCount() {
		return worlds == null ? -1 : worlds.size();
	}

	public List<String> worldNames() {
		return worlds == null ? List.of() : worlds.stream().map(LevelSummary::getLevelName).toList();
	}

	// ---------- Aufbau ----------

	@Override
	protected void initContent() {
		String label = "Neue Welt";
		int w = ActionButton.widthFor(label, "plus");
		addRenderableWidget(new ActionButton(headerRight() - w, headerButtonY(), w, 20, label, true, this::createWorld).withIcon("plus"));

		search = new SearchField(contentX, contentY, Math.min(220, contentW / 2), 20, "Welten suchen");
		search.setValue(query);
		search.setResponder(text -> {
			query = text;
			scroll = 0;
		});
		addRenderableWidget(search);

		String classic = "Klassische Ansicht";
		int cw = ActionButton.widthFor(classic, "external");
		addRenderableWidget(new ActionButton(contentX + contentW - cw, contentY + contentH - 18, cw, 18, classic, false,
				() -> Shell.openVanilla(minecraft, new SelectWorldScreen(this))).withIcon("external").withVariant(ActionButton.Variant.GHOST));

		if (worlds == null) load();
	}

	@Override
	protected String subtitle() {
		if (worlds == null) return "Welten werden geladen …";
		return worlds.size() + (worlds.size() == 1 ? " Welt" : " Welten") + " auf diesem PC";
	}

	private int listY() {
		return contentY + 28;
	}

	private int listH() {
		return contentY + contentH - 24 - listY();
	}

	private int maxScroll() {
		int rows = visible().size();
		return Math.max(0, rows * (ROW_H + GAP) - GAP - listH());
	}

	/** Knöpfe in der ausgewählten Zeile: Löschen, Bearbeiten (nur Icon), Spielen – von rechts nach links Spielen zuerst */
	private int[][] rowButtons(int rowY) {
		int y = rowY + (ROW_H - 20) / 2;
		int right = contentX + contentW - 10;
		int playW = ActionButton.widthFor("Spielen", "play");
		int[] play = {right - playW, y, playW, 20};
		int[] edit = {play[0] - 24, y, 20, 20};
		int[] delete = {edit[0] - 24, y, 20, 20};
		return new int[][] {delete, edit, play};
	}

	// ---------- Zeichnen ----------

	@Override
	protected void drawContent(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		int x = contentX;
		int w = contentW;
		if (worlds == null) {
			Ui.text(g, "Lade Welten …", x + 2, listY() + 8, Ui.MUTED, Ui.Font.BODY);
			return;
		}
		if (error != null) Ui.text(g, error, x + 2, listY() + 8, Ui.DANGER, Ui.Font.BODY);
		List<LevelSummary> list = visible();
		if (list.isEmpty() && error == null) {
			int cy = listY() + listH() / 2 - 26;
			Ui.rect(g, x + w / 2f - 16, cy, 32, 32, 10, Ui.ACCENT_SOFT);
			Ui.icon(g, "world", x + w / 2f - 8, cy + 8, 16, Ui.ACCENT_TEXT);
			String title = query.isBlank() ? "Noch keine Welten" : "Keine Welt passt zu „" + query.trim() + "“";
			Ui.textCentered(g, title, x + w / 2, cy + 42, Ui.TEXT, Ui.Font.LABEL);
			if (query.isBlank()) Ui.textCentered(g, "Leg mit „Neue Welt“ oben rechts deine erste Welt an.", x + w / 2, cy + 55, Ui.MUTED, Ui.Font.SMALL);
		}

		scroll = Math.clamp(scroll, 0, maxScroll());
		g.enableScissor(x - 2, listY(), x + w + 2, listY() + listH());
		boolean inList = Ui.inside(mouseX, mouseY, x, listY(), w, listH());
		for (int i = 0; i < list.size(); i++) {
			int y = listY() + i * (ROW_H + GAP) - (int) scroll;
			if (y + ROW_H < listY() || y > listY() + listH()) continue;
			drawRow(g, list.get(i), x, y, w, inList ? mouseX : -1000, inList ? mouseY : -1000);
		}
		g.disableScissor();
		Ui.scrollbar(g, x + w + 3, listY(), listH(), scroll, maxScroll());

		String hint = status != null ? status : "Doppelklick spielt · Entf löscht · Pfeiltasten wählen";
		Ui.text(g, Ui.ellipsize(hint, w - 130, Ui.Font.SMALL), x + 2, contentY + contentH - 12, status != null ? Ui.WARNING : Ui.FAINT, Ui.Font.SMALL);
	}

	private void drawRow(GuiGraphicsExtractor g, LevelSummary summary, int x, int y, int w, int mouseX, int mouseY) {
		boolean isSelected = summary.getLevelId().equals(selected);
		boolean hover = Ui.inside(mouseX, mouseY, x, y, w, ROW_H);
		Ui.rect(g, x, y, w, ROW_H, 9, isSelected ? 0x1F3B82F6 : hover ? Ui.SURFACE_HOVER : Ui.SURFACE);
		Ui.outline(g, x, y, w, ROW_H, 9, isSelected ? Ui.ACCENT_LINE : Ui.LINE);

		// Symbol: Welt-Vorschau oder Platzhalter
		int iconX = x + 6;
		int iconY = y + 6;
		int size = ROW_H - 12;
		FaviconTexture icon = icons.get(summary.getLevelId());
		if (icon != null) {
			g.blit(RenderPipelines.GUI_TEXTURED, icon.textureLocation(), iconX, iconY, 0, 0, size, size, 64, 64, 64, 64);
		} else {
			Ui.rect(g, iconX, iconY, size, size, 7, 0x1AFFFFFF);
			Ui.icon(g, summary.isHardcore() ? "warning" : "world", iconX + (size - 14) / 2f, iconY + (size - 14) / 2f, 14, Ui.MUTED);
		}

		int textX = iconX + size + 10;
		int textRight = isSelected ? rowButtons(y)[0][0] - 8 : x + w - 10;
		int textW = textRight - textX;
		Ui.text(g, Ui.ellipsize(summary.getLevelName(), textW, Ui.Font.LABEL), textX, y + 9, Ui.TEXT, Ui.Font.LABEL);
		String played = summary.getLastPlayed() > 0 ? DATE.format(Instant.ofEpochMilli(summary.getLastPlayed())) : "noch nie";
		String info = mode(summary) + "  ·  " + played + "  ·  " + summary.getWorldVersionName().getString();
		if (summary.hasCommands() && !summary.isHardcore()) info += "  ·  Cheats";
		if (summary.isLocked()) info = "Gerade geöffnet – erst schließen";
		else if (!summary.primaryActionActive() || summary.isDisabled()) info = summary.getInfo().getString();
		Ui.text(g, Ui.ellipsize(info, textW, Ui.Font.SMALL), textX, y + 23, summary.isHardcore() ? 0xFFFCA5A5 : Ui.MUTED, Ui.Font.SMALL);

		if (isSelected) {
			int[][] buttons = rowButtons(y);
			boolean[] enabled = {summary.canDelete(), summary.canEdit(), summary.primaryActionActive()};
			String[] icons = {"trash", "edit", "play"};
			String[] tips = {"Löschen", "Bearbeiten", "Spielen"};
			for (int i = 0; i < buttons.length; i++) {
				int[] b = buttons[i];
				boolean over = enabled[i] && Ui.inside(mouseX, mouseY, b[0], b[1], b[2], b[3]);
				if (i == 2) {
					Ui.rect(g, b[0], b[1], b[2], b[3], 7, !enabled[i] ? 0x14FFFFFF : over ? Ui.ACCENT_HOVER : Ui.ACCENT);
					Ui.icon(g, "play", b[0] + 9, b[1] + 5, 10, enabled[i] ? 0xFFFFFFFF : Ui.FAINT);
					Ui.text(g, "Spielen", b[0] + 24, b[1] + 6, enabled[i] ? 0xFFFFFFFF : Ui.FAINT, Ui.Font.LABEL);
				} else {
					int fill = !enabled[i] ? 0x0AFFFFFF : over ? (i == 0 ? 0x40F87171 : Ui.SURFACE_STRONG) : 0x12FFFFFF;
					Ui.rect(g, b[0], b[1], b[2], b[3], 7, fill);
					int color = !enabled[i] ? Ui.FAINT : over && i == 0 ? 0xFFFCA5A5 : over ? Ui.TEXT : Ui.MUTED;
					Ui.icon(g, icons[i], b[0] + 5, b[1] + 5, 10, color);
					if (over) Ui.requestTooltip(tips[i], mouseX, mouseY);
				}
			}
		}
	}

	private static String mode(LevelSummary summary) {
		if (summary.isHardcore()) return "Hardcore";
		return switch (summary.getGameMode()) {
			case SURVIVAL -> "Überleben";
			case CREATIVE -> "Kreativ";
			case ADVENTURE -> "Abenteuer";
			case SPECTATOR -> "Zuschauer";
		};
	}

	// ---------- Aktionen ----------

	private void createWorld() {
		CreateWorldScreen.openFresh(minecraft, () -> minecraft.gui.setScreen(new WorldsScreen()));
	}

	/** Welt öffnen; Sonderfälle (Umwandlung, Sicherung, ältere Version) übernimmt die klassische Ansicht mit ihren Abfragen. */
	public void play(LevelSummary summary) {
		if (summary == null) return;
		if (summary.isLocked()) {
			status = "„" + summary.getLevelName() + "“ ist gerade in einem anderen Fenster geöffnet.";
			return;
		}
		if (!summary.primaryActionActive() || summary.requiresManualConversion() || summary.shouldBackup() || summary.isDowngrade()) {
			Shell.openVanilla(minecraft, new SelectWorldScreen(this));
			return;
		}
		minecraft.createWorldOpenFlows().openWorld(summary.getLevelId(), () -> minecraft.gui.setScreen(new WorldsScreen()));
	}

	private void edit(LevelSummary summary) {
		try {
			LevelStorageSource.LevelStorageAccess access = minecraft.getLevelSource().createAccess(summary.getLevelId());
			minecraft.gui.setScreen(EditWorldScreen.create(minecraft, access, changed -> {
				access.safeClose();
				minecraft.gui.setScreen(new WorldsScreen());
			}));
		} catch (Exception e) {
			status = "Welt kann nicht bearbeitet werden: " + e.getMessage();
			HeldixClient.LOGGER.warn("Welt {} kann nicht bearbeitet werden", summary.getLevelId(), e);
		}
	}

	private void delete(LevelSummary summary) {
		minecraft.gui.setScreen(new ConfirmScreen(confirmed -> {
			if (confirmed) {
				try (LevelStorageSource.LevelStorageAccess access = minecraft.getLevelSource().createAccess(summary.getLevelId())) {
					access.deleteLevel();
				} catch (Exception e) {
					HeldixClient.LOGGER.warn("Welt {} konnte nicht gelöscht werden", summary.getLevelId(), e);
				}
			}
			minecraft.gui.setScreen(new WorldsScreen());
		}, Component.translatable("selectWorld.deleteQuestion"),
				Component.translatable("selectWorld.deleteWarning", summary.getLevelName()),
				Component.translatable("selectWorld.deleteButton"), CommonComponents.GUI_CANCEL));
	}

	// ---------- Eingaben ----------

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (super.mouseClicked(event, doubleClick)) return true;
		if (event.button() != InputConstants.MOUSE_BUTTON_LEFT) return false;
		double mx = event.x();
		double my = event.y();
		if (!Ui.inside(mx, my, contentX, listY(), contentW, listH())) return false;
		List<LevelSummary> list = visible();
		for (int i = 0; i < list.size(); i++) {
			int y = listY() + i * (ROW_H + GAP) - (int) scroll;
			if (!Ui.inside(mx, my, contentX, y, contentW, ROW_H)) continue;
			LevelSummary summary = list.get(i);
			if (summary.getLevelId().equals(selected)) {
				int[][] buttons = rowButtons(y);
				if (inside(buttons[2], mx, my) && summary.primaryActionActive()) {
					play(summary);
					return true;
				}
				if (inside(buttons[1], mx, my) && summary.canEdit()) {
					edit(summary);
					return true;
				}
				if (inside(buttons[0], mx, my) && summary.canDelete()) {
					delete(summary);
					return true;
				}
			}
			long now = System.currentTimeMillis();
			boolean twice = summary.getLevelId().equals(lastClickId) && now - lastClickAt < 350;
			selected = summary.getLevelId();
			lastClickId = selected;
			lastClickAt = now;
			status = null;
			if (twice) play(summary);
			return true;
		}
		return false;
	}

	private static boolean inside(int[] r, double x, double y) {
		return Ui.inside(x, y, r[0], r[1], r[2], r[3]);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (maxScroll() > 0 && Ui.inside(mouseX, mouseY, contentX, listY(), contentW, listH())) {
			scroll = Math.clamp(scroll - scrollY * 20, 0, maxScroll());
			return true;
		}
		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		boolean typing = search != null && search.isFocused();
		if (!typing) {
			List<LevelSummary> list = visible();
			int index = -1;
			for (int i = 0; i < list.size(); i++) if (list.get(i).getLevelId().equals(selected)) index = i;
			switch (event.key()) {
				case InputConstants.KEY_RETURN -> {
					play(selectedSummary());
					return true;
				}
				case InputConstants.KEY_DELETE -> {
					LevelSummary summary = selectedSummary();
					if (summary != null && summary.canDelete()) delete(summary);
					return true;
				}
				case InputConstants.KEY_DOWN, InputConstants.KEY_UP -> {
					if (list.isEmpty()) return true;
					int next = Math.clamp(index + (event.key() == InputConstants.KEY_DOWN ? 1 : -1), 0, list.size() - 1);
					selected = list.get(next).getLevelId();
					int top = next * (ROW_H + GAP);
					if (top < scroll) scroll = top;
					if (top + ROW_H > scroll + listH()) scroll = top + ROW_H - listH();
					return true;
				}
				default -> {
				}
			}
		}
		return super.keyPressed(event);
	}

	@Override
	public void removed() {
		for (FaviconTexture icon : icons.values()) icon.close();
		icons.clear();
		super.removed();
	}
}
