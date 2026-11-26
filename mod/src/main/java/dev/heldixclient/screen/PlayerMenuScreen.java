package dev.heldixclient.screen;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.cosmetic.CosmeticCatalog;
import dev.heldixclient.player.NearbyPlayers;
import dev.heldixclient.player.PlayerMenu;
import dev.heldixclient.social.Badge;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.entity.player.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Kreismenü für einen Spieler unter dem Fadenkreuz (siehe {@link PlayerMenu}): in der Mitte Kopf, Name, HeldixClient-Rolle
 * und Abstand, rundherum die Aktionen. Maus oder Zahlen 1–9 wählen, Esc, Rechtsklick oder die Taste noch einmal
 * schließen. Das Spiel läuft weiter (keine Pause).
 */
public class PlayerMenuScreen extends Screen {
	/** halbe Größe einer Aktion (abgerundetes Quadrat) */
	private static final float ITEM_R = 17;
	/** halbe Breite bzw. Höhe der Karte in der Mitte */
	private static final float CENTER_W = 48;
	private static final float CENTER_H = 37;
	private static final float CENTER_R = CENTER_H;

	private final UUID target;
	private final long openedAt = System.nanoTime();
	private NearbyPlayers.Snapshot snapshot;
	private AbstractClientPlayer player;
	private List<PlayerMenu.Action> actions = List.of();
	private final List<Float> hover = new ArrayList<>();
	private int hovered = -1;
	private int ticks;

	public PlayerMenuScreen(UUID target) {
		super(Component.literal("Spielermenü"));
		this.target = target;
	}

	@Override
	protected void init() {
		refresh();
	}

	/** Stand des Spielers und der Aktionen neu lesen (z. B. nach „Freund hinzufügen“) */
	private void refresh() {
		Player found = minecraft.level == null ? null : minecraft.level.getPlayerByUUID(target);
		if (!(found instanceof AbstractClientPlayer client) || minecraft.player == null) {
			snapshot = null;
			player = null;
			return;
		}
		player = client;
		snapshot = NearbyPlayers.of(minecraft, client);
		actions = PlayerMenu.actions(minecraft, snapshot);
		while (hover.size() < actions.size()) hover.add(0f);
	}

	@Override
	public void tick() {
		if (++ticks % 10 == 0) refresh();
		// Spieler weg (ausgeloggt, Welt gewechselt): Menü zu
		if (snapshot == null) onClose();
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	// ======================================================================================
	// Lage
	// ======================================================================================

	private float ringRadius() {
		return Math.clamp(Math.min(width, height) * 0.3f, 72, 104);
	}

	private float[] itemCenter(int index) {
		int count = Math.max(1, actions.size());
		double angle = Math.toRadians(-90 + index * 360.0 / count);
		float r = ringRadius() * appear();
		return new float[] {width / 2f + (float) Math.cos(angle) * r, height / 2f + (float) Math.sin(angle) * r};
	}

	private float appear() {
		return Draw.easeOut((System.nanoTime() - openedAt) / 150_000_000f);
	}

	/** Eintrag unter der Maus: nach dem Winkel um die Mitte (außerhalb der Mitte), sonst -1 */
	private int itemAt(double mouseX, double mouseY) {
		if (actions.isEmpty()) return -1;
		double dx = mouseX - width / 2.0;
		double dy = mouseY - height / 2.0;
		double distance = Math.sqrt(dx * dx + dy * dy);
		if (distance < CENTER_R - 4 || distance > ringRadius() + ITEM_R + 46) return -1;
		double angle = Math.toDegrees(Math.atan2(dy, dx)) + 90;
		double step = 360.0 / actions.size();
		int index = (int) Math.round(angle / step);
		return Math.floorMod(index, actions.size());
	}

	// ======================================================================================
	// Zeichnen
	// ======================================================================================

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		// die Welt bleibt sichtbar, nur leicht abgedunkelt
		g.fill(0, 0, width, height, Ui.withAlpha(0x66060A13, appear()));
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		super.extractRenderState(g, mouseX, mouseY, delta);
		if (snapshot == null || player == null) return;
		float t = appear();
		int cx = width / 2;
		int cy = height / 2;
		hovered = itemAt(mouseX, mouseY);

		// Mitte: Kopf, Name, Rolle und Abstand (Karte)
		Ui.shadow(g, cx - CENTER_W, cy - CENTER_H, CENTER_W * 2, CENTER_H * 2, 0.55f * t);
		Ui.rect(g, cx - CENTER_W, cy - CENTER_H, CENTER_W * 2, CENTER_H * 2, 12, Ui.withAlpha(0xF20F1420, t));
		Ui.outline(g, cx - CENTER_W, cy - CENTER_H, CENTER_W * 2, CENTER_H * 2, 12, Ui.withAlpha(Ui.LINE_STRONG, t));
		PlayerFaceExtractor.extractRenderState(g, player.getSkin(), cx - 9, cy - 28, 18);
		Badge.Role role = Social.roleOf(target);
		String name = Ui.ellipsize(snapshot.name(), (int) (CENTER_W * 2 - 12), Ui.Font.LABEL);
		Ui.textCentered(g, name, cx, cy - 4, Ui.withAlpha(Ui.TEXT, t), Ui.Font.LABEL);
		String sub = role != null ? role.label() : "Kein HeldixClient";
		Ui.textCentered(g, Ui.ellipsize(sub, (int) (CENTER_W * 2 - 12), Ui.Font.SMALL), cx, cy + 8, Ui.withAlpha(role != null ? Ui.ACCENT_TEXT : Ui.FAINT, t), Ui.Font.SMALL);
		Ui.textCentered(g, Math.round(snapshot.distance()) + " m", cx, cy + 20, Ui.withAlpha(Ui.FAINT, t), Ui.Font.SMALL);

		// Aktionen rundherum
		for (int i = 0; i < actions.size(); i++) {
			PlayerMenu.Action action = actions.get(i);
			float target = i == hovered && action.enabled() ? 1f : 0f;
			float h = hover.get(i) + (target - hover.get(i)) * 0.35f;
			hover.set(i, h);
			float[] c = itemCenter(i);
			float r = ITEM_R + h * 1.5f;
			Ui.shadow(g, c[0] - r, c[1] - r, r * 2, r * 2, 0.45f * t);
			int fill = !action.enabled() ? 0xD9141A26 : Ui.lerp(0xF21A2233, Ui.ACCENT, h);
			Ui.rect(g, c[0] - r, c[1] - r, r * 2, r * 2, 10, Ui.withAlpha(fill, t));
			Ui.outline(g, c[0] - r, c[1] - r, r * 2, r * 2, 10, Ui.withAlpha(action.enabled() ? Ui.LINE_STRONG : Ui.LINE, t));
			if (i == hovered && action.enabled()) Ui.focusRing(g, c[0] - r, c[1] - r, r * 2, r * 2, 10, t);
			int iconColor = !action.enabled() ? Ui.FAINT : Ui.lerp(Ui.ACCENT_TEXT, 0xFFFFFFFF, h);
			Ui.icon(g, action.icon(), c[0] - 7, c[1] - 7, 14, Ui.withAlpha(iconColor, t));
			// Nummer für die Tastatur
			if (i < 9) Ui.text(g, Integer.toString(i + 1), Math.round(c[0] + r - 8), Math.round(c[1] - r + 3), Ui.withAlpha(Ui.FAINT, t), Ui.Font.SMALL);
			// Name außen am Kreis
			String label = action.label();
			int lw = Ui.width(label, Ui.Font.SMALL) + 10;
			double angle = Math.atan2(c[1] - cy, c[0] - cx);
			float lx = c[0] + (float) Math.cos(angle) * (r + 6 + lw / 2f) - lw / 2f;
			float ly = c[1] + (float) Math.sin(angle) * (r + 10) - 6;
			lx = Math.clamp(lx, 4, width - lw - 4);
			Ui.rect(g, lx, ly, lw, 13, 6.5f, Ui.withAlpha(i == hovered ? 0xF23B82F6 : 0xE60F1420, t));
			Ui.text(g, label, Math.round(lx + 5), Math.round(ly + 3), Ui.withAlpha(action.enabled() ? Ui.TEXT : Ui.FAINT, t), Ui.Font.SMALL);
		}

		// unten: Hinweis zur gewählten Aktion bzw. zur Bedienung, darunter getragene Cosmetics
		String worn = worn();
		int bottom = Math.min(Math.round(cy + ringRadius() + ITEM_R + 22), height - (worn != null ? 34 : 20));
		String hint = hovered >= 0 && actions.get(hovered).hint() != null ? actions.get(hovered).hint() : "Klick oder 1–9 wählt · Esc schließt";
		int hw = Ui.width(hint, Ui.Font.BODY) + 16;
		Ui.rect(g, cx - hw / 2f, bottom, hw, 16, 8, Ui.withAlpha(0xE60F1420, t));
		Ui.textCentered(g, hint, cx, bottom + 4, Ui.withAlpha(Ui.MUTED, t), Ui.Font.BODY);
		if (worn != null) Ui.textCentered(g, Ui.ellipsize(worn, width - 40, Ui.Font.SMALL), cx, bottom + 22, Ui.withAlpha(Ui.FAINT, t), Ui.Font.SMALL);
	}

	/** „Trägt: Krone · Engelsflügel“ aus den Cosmetics, die der Dienst für den Spieler meldet */
	private String worn() {
		List<String> names = new ArrayList<>();
		for (String slot : List.of("head", "back", "aura", "companion")) {
			String id = Social.cosmeticOf(target, slot);
			if (id == null) continue;
			CosmeticCatalog.Item item = CosmeticCatalog.item(id);
			names.add(item != null ? item.name() : id);
		}
		return names.isEmpty() ? null : "Trägt: " + String.join(" · ", names);
	}

	// ======================================================================================
	// Eingaben
	// ======================================================================================

	private void activate(int index) {
		if (index < 0 || index >= actions.size()) return;
		PlayerMenu.Action action = actions.get(index);
		if (!action.enabled()) return;
		minecraft.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1.0f));
		boolean keep = action.keepOpen();
		if (!keep) onClose();
		action.run().run();
		if (keep) refresh();
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (event.button() == InputConstants.MOUSE_BUTTON_LEFT) {
			activate(itemAt(event.x(), event.y()));
			return true;
		}
		// Rechts- oder Mausrad-Klick: schließen
		onClose();
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (key >= InputConstants.KEY_1 && key <= InputConstants.KEY_9) {
			activate(key - InputConstants.KEY_1);
			return true;
		}
		if (HeldixClient.playerMenuKey.matches(event)) {
			onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public void onClose() {
		if (minecraft.gui.screen() == this) minecraft.gui.setScreen(null);
	}

	// ======================================================================================
	// Für den Autotest
	// ======================================================================================

	public List<String> actionLabels() {
		return actions.stream().map(PlayerMenu.Action::label).toList();
	}

	public List<String> actionIds() {
		return actions.stream().map(PlayerMenu.Action::id).toList();
	}

	/** Mitte der Aktion {@code index} auf dem Bildschirm */
	public int[] actionCenter(int index) {
		float[] c = itemCenter(index);
		return new int[] {Math.round(c[0]), Math.round(c[1])};
	}

	public UUID target() {
		return target;
	}
}
