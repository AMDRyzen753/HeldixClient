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
	/** Skins nach UUID, sobald das Profil mit den Skin-Daten da ist */
	private static final Map<UUID, Supplier<PlayerSkin>> SKINS = new java.util.concurrent.ConcurrentHashMap<>();
	/** bis dahin: Standard-Skin passend zur UUID */
	private static final Map<UUID, Supplier<PlayerSkin>> FALLBACK = new HashMap<>();
	/** wann ein Profil zuletzt angefragt wurde (fehlgeschlagen: nach fünf Minuten noch einmal) */
	private static final Map<UUID, Long> REQUESTED = new java.util.concurrent.ConcurrentHashMap<>();
	private static final java.util.concurrent.ExecutorService PROFILES = java.util.concurrent.Executors.newSingleThreadExecutor(runnable -> {
		Thread thread = new Thread(runnable, "Heldix-Skins");
		thread.setDaemon(true);
		return thread;
	});

	private final Supplier<Social.Friend> friend;
	private final Runnable action;
	private float hover;

	public FriendWidget(int x, int y, int width, int height, Supplier<Social.Friend> friend, Runnable action) {
		super(x, y, width, height, Component.empty());
		this.friend = friend;
		this.action = action;
	}

	/**
	 * Kopf eines Spielers. Eine UUID allein reicht Minecraft nicht für den Skin: Das Profil mit den Skin-Daten
	 * holen wir einmal im Hintergrund (wie bei Köpfen von Spielern), bis dahin erscheint der Standard-Skin.
	 */
	public static void face(GuiGraphicsExtractor g, UUID uuid, String name, int x, int y, int size, float alpha) {
		PlayerFaceExtractor.extractRenderState(g, skinOf(uuid, name), x, y, size, Ui.withAlpha(0xFFFFFFFF, alpha));
	}

	/** Skin eines Spielers per UUID (Standard-Skin, bis das Profil geladen ist) */
	public static PlayerSkin skinOf(UUID uuid, String name) {
		Supplier<PlayerSkin> skin = SKINS.get(uuid);
		if (skin == null) {
			skin = FALLBACK.computeIfAbsent(uuid, id -> Minecraft.getInstance().getSkinManager().createLookup(new GameProfile(id, name == null ? "" : name), false));
			requestProfile(uuid);
		}
		return skin.get();
	}

	private static void requestProfile(UUID uuid) {
		long now = System.currentTimeMillis();
		Long last = REQUESTED.get(uuid);
		if (last != null && now - last < 5 * 60_000) return;
		REQUESTED.put(uuid, now);
		Minecraft minecraft = Minecraft.getInstance();
		PROFILES.execute(() -> {
			try {
				java.util.Optional<GameProfile> profile = minecraft.services().profileResolver().fetchById(uuid);
				profile.ifPresent(found -> minecraft.execute(() -> SKINS.put(uuid, minecraft.getSkinManager().createLookup(found, false))));
			} catch (RuntimeException e) {
				dev.heldixclient.HeldixClient.LOGGER.debug("Skin von {} nicht ladbar ({})", uuid, e.toString());
			}
		});
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
		setMessage(Component.literal(now.shownName() + ", " + now.activity()));
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
		// Spitzname (nur für dich), Favorit mit Stern; „Nicht stören“ gelb
		String name = Ui.ellipsize(now.shownName(), textW - (now.favorite() ? 12 : 0), Ui.Font.LABEL);
		Ui.text(g, name, textX, y + h / 2 - 10, Ui.withAlpha(Ui.TEXT, alpha), Ui.Font.LABEL);
		if (now.favorite()) Ui.icon(g, "star", textX + Ui.width(name, Ui.Font.LABEL) + 4, y + h / 2 - 10, 8, Ui.withAlpha(0xFFFACC15, alpha));
		String line = now.statusText() != null && now.online() ? now.activity() + " · „" + now.statusText() + "“" : now.activity();
		Ui.text(g, Ui.ellipsize(line, textW, Ui.Font.SMALL), textX, y + h / 2 + 2,
				Ui.withAlpha(now.online() ? now.dnd() ? Ui.WARNING : Ui.SUCCESS : Ui.FAINT, alpha), Ui.Font.SMALL);
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
