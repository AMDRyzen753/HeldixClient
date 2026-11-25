package dev.heldixclient.screen;

import com.mojang.authlib.GameProfile;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.InputWithModifiers;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.PlayerSkin;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/** Zeile mit einem Freund: Kopf des Skins, Name, was er gerade macht (grün = online). Klick öffnet die Seite Freunde. */
public class FriendWidget extends AbstractButton {
	/** Skins nach UUID (lädt Minecraft im Hintergrund; bis dahin der Standard-Skin) */
	private static final Map<UUID, Supplier<PlayerSkin>> SKINS = new HashMap<>();

	private final Supplier<Social.Friend> friend;
	private final Runnable action;
	private float hover;

	public FriendWidget(int x, int y, int width, int height, Supplier<Social.Friend> friend, Runnable action) {
		super(x, y, width, height, Component.empty());
		this.friend = friend;
		this.action = action;
	}

	/** Kopf eines Spielers (Skin per UUID, Mojang liefert ihn nach) */
	public static void face(GuiGraphicsExtractor g, UUID uuid, String name, int x, int y, int size, float alpha) {
		Supplier<PlayerSkin> skin = SKINS.computeIfAbsent(uuid,
				id -> Minecraft.getInstance().getSkinManager().createLookup(new GameProfile(id, name == null ? "" : name), false));
		PlayerFaceExtractor.extractRenderState(g, skin.get(), x, y, size, Ui.withAlpha(0xFFFFFFFF, alpha));
	}

	@Override
	public void onPress(InputWithModifiers input) {
		if (friend.get() != null) action.run();
	}

	@Override
	protected void extractContents(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		Social.Friend now = friend.get();
		visible = now != null;
		active = now != null;
		if (now == null) return;
		setMessage(Component.literal(now.name() + ", " + now.activity()));
		hover += ((isHoveredOrFocused() ? 1f : 0f) - hover) * 0.35f;
		int x = getX();
		int y = getY();
		int w = getWidth();
		int h = getHeight();
		if (hover > 0.01f) Ui.rect(g, x, y, w, h, 8, Ui.withAlpha(Ui.SURFACE_HOVER, hover * alpha));
		int size = Math.min(18, h - 10);
		int fx = x + 7;
		int fy = y + (h - size) / 2;
		face(g, now.uuid(), now.name(), fx, fy, size, alpha * (now.online() ? 1f : 0.45f));
		if (now.online()) {
			Ui.circle(g, fx + size, fy + size, 3.5f, Ui.withAlpha(0xFF0F1420, alpha));
			Ui.circle(g, fx + size, fy + size, 2.5f, Ui.withAlpha(Ui.SUCCESS, alpha));
		}
		int textX = fx + size + 9;
		int textW = w - (textX - x) - 8;
		Ui.text(g, Ui.ellipsize(now.name(), textW, Ui.Font.LABEL), textX, y + h / 2 - 10, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		Ui.text(g, Ui.ellipsize(now.activity(), textW, Ui.Font.SMALL), textX, y + h / 2 + 2,
				Ui.withAlpha(now.online() ? Ui.SUCCESS : Ui.FAINT, alpha), Ui.Font.SMALL);
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput output) {
		defaultButtonNarrationText(output);
	}

	/** Kurzer Text zum Stand des Heldix-Dienstes, wenn keine Freunde gezeigt werden können (null = alles gut) */
	public static String serviceHint() {
		return switch (Social.state()) {
			case ONLINE -> null;
			case CONNECTING -> "Verbinde mit dem Heldix-Dienst …";
			case ERROR -> "Heldix-Dienst gerade nicht erreichbar";
			case OFFLINE_ACCOUNT -> "Freunde gibt es mit einem Microsoft-Konto.";
			case OFF -> "Heldix-Dienst ist ausgeschaltet.";
			case DISABLED -> "Heldix-Dienst nicht eingerichtet.";
		};
	}
}
