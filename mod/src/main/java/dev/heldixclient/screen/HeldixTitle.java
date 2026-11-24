package dev.heldixclient.screen;

import com.mojang.authlib.minecraft.BanDetails;
import com.mojang.realmsclient.RealmsMainScreen;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import dev.heldixclient.ui.WidgetStyle;
import net.minecraft.ChatFormatting;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.CommonButtons;
import net.minecraft.client.gui.components.PlainTextButton;
import net.minecraft.client.gui.components.PlayerFaceExtractor;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.CreditsAndAttributionScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.multiplayer.SafetyScreen;
import net.minecraft.client.gui.screens.options.AccessibilityOptionsScreen;
import net.minecraft.client.gui.screens.options.LanguageSelectScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.PlayerSkin;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/** Aufbau und Aussehen des HeldixClient-Hauptmenüs (eingebaut über HeldixPatches/Hooks). */
public class HeldixTitle {
	private static final String[] TIPS = {
			"Rechte Umschalttaste öffnet im Spiel das Heldix-Menü.",
			"Halte C zum Zoomen, mit dem Mausrad änderst du die Stärke.",
			"Im HUD-Editor rasten Elemente an Rändern und aneinander ein.",
			"Mit R setzt du im HUD-Editor alle Positionen zurück.",
			"Das Menü-Design lässt sich im Heldix-Menü umschalten.",
			"Keystrokes zeigen dir live, welche Tasten du drückst.",
	};
	private static final int NAV_H = 20;
	private static final int NAV_GAP = 3;

	private final Minecraft minecraft;
	private final long openedAt = System.nanoTime();
	private final String tip = TIPS[ThreadLocalRandom.current().nextInt(TIPS.length)];
	private final Supplier<PlayerSkin> skin;
	private final List<AbstractWidget> widgets = new ArrayList<>();
	private int sidebar = 160;

	public HeldixTitle(Minecraft minecraft) {
		this.minecraft = minecraft;
		this.skin = minecraft.getSkinManager().createLookup(minecraft.getGameProfile(), false);
	}

	public static boolean shouldReplace(Minecraft minecraft) {
		return minecraft != null && WidgetStyle.enabled() && !minecraft.isDemo();
	}

	private float fade() {
		return Draw.easeOut((System.nanoTime() - openedAt) / 450_000_000f);
	}

	// ---------- Buttons ----------

	public List<AbstractWidget> createWidgets(Screen screen, int width, int height) {
		widgets.clear();
		sidebar = Math.clamp(width * 3 / 10, 150, 200);
		int navW = sidebar - 24;
		int x = 12;
		int y = Math.max(70, (height - 6 * (NAV_H + NAV_GAP)) / 2 + 10);

		nav(x, y, navW, "Einzelspieler", false, () -> minecraft.gui.setScreen(new SelectWorldScreen(screen)));
		y += NAV_H + NAV_GAP;
		HeldixNavButton multiplayer = nav(x, y, navW, "Mehrspieler", false, () -> minecraft.gui.setScreen(
				minecraft.options.skipMultiplayerWarning ? new JoinMultiplayerScreen(screen) : new SafetyScreen(screen)));
		Component disabled = multiplayerDisabledReason();
		if (disabled != null) {
			multiplayer.active = false;
			multiplayer.setTooltip(Tooltip.create(disabled));
		}
		y += NAV_H + NAV_GAP;
		nav(x, y, navW, "Realms", false, () -> minecraft.gui.setScreen(new RealmsMainScreen(screen)));
		y += NAV_H + NAV_GAP;
		nav(x, y, navW, "Heldix-Menü", false, () -> minecraft.gui.setScreen(new HeldixMenuScreen(screen)));
		y += NAV_H + NAV_GAP;
		nav(x, y, navW, "Optionen", false, () -> minecraft.gui.setScreen(new OptionsScreen(screen, minecraft.options)));
		y += NAV_H + NAV_GAP;
		nav(x, y, navW, "Beenden", true, minecraft::stop);

		AbstractWidget language = CommonButtons.language(20, b -> minecraft.gui.setScreen(
				new LanguageSelectScreen(screen, minecraft.options, minecraft.getLanguageManager())), true);
		language.setPosition(12, height - 30);
		widgets.add(language);
		AbstractWidget accessibility = CommonButtons.accessibility(20, b -> minecraft.gui.setScreen(
				new AccessibilityOptionsScreen(screen, minecraft.options)), true);
		accessibility.setPosition(36, height - 30);
		widgets.add(accessibility);

		Component copyright = Component.literal("Copyright Mojang AB. Do not distribute!");
		int copyrightWidth = minecraft.font.width(copyright);
		widgets.add(new PlainTextButton(width - copyrightWidth - 6, height - 12, copyrightWidth, 10, copyright,
				b -> minecraft.gui.setScreen(new CreditsAndAttributionScreen(screen)), minecraft.font));
		return widgets;
	}

	private HeldixNavButton nav(int x, int y, int width, String label, boolean danger, Runnable action) {
		HeldixNavButton button = new HeldixNavButton(x, y, width, NAV_H, Component.literal(label), danger, action);
		widgets.add(button);
		return button;
	}

	private Component multiplayerDisabledReason() {
		if (minecraft.allowsMultiplayer()) return null;
		if (minecraft.isNameBanned()) return Component.translatable("title.multiplayer.disabled.banned.name");
		BanDetails ban = minecraft.multiplayerBan();
		if (ban != null) {
			return Component.translatable(ban.expires() != null
					? "title.multiplayer.disabled.banned.temporary"
					: "title.multiplayer.disabled.banned.permanent");
		}
		return Component.translatable("title.multiplayer.disabled");
	}

	// ---------- Zeichnen ----------

	/** Über dem Panorama: leichte Blautönung, die Seitenleiste als schwebende Glaskarte. */
	public void extractBackground(GuiGraphicsExtractor g, int width, int height) {
		g.fill(0, 0, width, height, 0x30061226);
		g.fillGradient(0, height / 2, width, height, 0x00030A18, 0xAA030A18);
		Draw.rounded2(g, 6, 9, sidebar - 6, height - 12, 0x30000814);
		Draw.glass(g, 6, 6, sidebar - 6, height - 12, 0xA60B1830);
	}

	/** Logo, Begrüßung, Tipp, Profil und Versionszeile. */
	public void extractDecorations(GuiGraphicsExtractor g, Font font, int width, int height) {
		float t = fade();
		for (AbstractWidget widget : widgets) widget.setAlpha(t);

		// Logo oben in der Seitenleiste (gleitet beim Öffnen herein)
		g.pose().pushMatrix();
		g.pose().translate(Math.round((1 - t) * -18), 0);
		int lx = 14;
		int ly = 18;
		g.pose().pushMatrix();
		g.pose().translate(lx, ly);
		g.pose().scale(2f, 2f);
		Draw.badge(g, font, 0, 0, 12);
		g.pose().popMatrix();
		Component wordmark = Component.literal("HELDIX").withStyle(ChatFormatting.BOLD);
		g.pose().pushMatrix();
		g.pose().translate(lx + 31, ly + 1);
		g.pose().scale(1.5f, 1.5f);
		g.text(font, wordmark, 0, 0, Draw.withAlpha(Theme.TEXT, t), false);
		g.pose().popMatrix();
		g.text(font, "C L I E N T", lx + 32, ly + 15, Draw.withAlpha(Theme.ACCENT_LIGHT, t), false);
		g.fill(lx, ly + 34, sidebar - 14, ly + 35, Draw.withAlpha(Theme.BORDER, t));
		g.pose().popMatrix();

		// Begrüßung im rechten Bereich, auf einer Glaskarte
		int rx = sidebar + 30;
		int cy = height / 2 - 34;
		String name = minecraft.getUser().getName();
		int tipWidth = Math.max(120, Math.min(260, width - rx - 40));
		int tipLines = font.split(Component.literal(tip), tipWidth).size();
		int cardW = Math.max(tipWidth, font.width(name) * 2 + 4) + 28;
		int cardH = 58 + tipLines * font.lineHeight + 26;
		Draw.rounded2(g, rx - 14, cy - 11, cardW, cardH, Draw.withAlpha(0x30000814, t));
		Draw.glass(g, rx - 14, cy - 14, cardW, cardH, Draw.withAlpha(0x990B1830, t));
		g.text(font, "Willkommen zurück,", rx, cy, Draw.withAlpha(Theme.MUTED, t), true);
		g.pose().pushMatrix();
		g.pose().translate(rx, cy + 13);
		g.pose().scale(2f, 2f);
		g.text(font, Component.literal(name).withStyle(ChatFormatting.BOLD), 0, 0, Draw.withAlpha(Theme.TEXT, t), true);
		g.pose().popMatrix();
		Draw.accentLine(g, rx, cy + 36, 48, 2);
		g.text(font, "Tipp", rx, cy + 46, Draw.withAlpha(Theme.ACCENT_LIGHT, t), true);
		g.textWithWordWrap(font, Component.literal(tip), rx, cy + 58, tipWidth, Draw.withAlpha(0xFFD6E4F5, t), true);

		// Profil-Chip oben rechts
		int chipW = 16 + 10 + font.width(name) + 10;
		int chipX = width - chipW - 10;
		int chipY = 10;
		Draw.glass(g, chipX, chipY, chipW, 22, Draw.withAlpha(0xA60B1830, t));
		PlayerFaceExtractor.extractRenderState(g, skin.get(), chipX + 4, chipY + 3, 16);
		g.text(font, name, chipX + 26, chipY + 7, Draw.withAlpha(Theme.TEXT, t), false);
		g.fill(chipX + chipW - 7, chipY + 9, chipX + chipW - 4, chipY + 12, Draw.withAlpha(0xFF34D399, t));

		// Versionszeile unten rechts (darunter der Copyright-Link als Button)
		String version = "Minecraft " + SharedConstants.getCurrentVersion().name() + "  ·  HeldixClient " + HeldixClient.version;
		g.text(font, version, width - font.width(version) - 6, height - 24, Draw.withAlpha(Theme.FAINT, t), false);
		long addons = AddonManager.activeCount();
		int mods = HeldixLoader.mods().size();
		String loader = "Heldix Loader " + HeldixLoader.version() + "  ·  " + mods + (mods == 1 ? " Mod" : " Mods") + "  ·  " + addons + (addons == 1 ? " Addon aktiv" : " Addons aktiv");
		g.text(font, loader, width - font.width(loader) - 6, height - 36, Draw.withAlpha(0xFF67E8F9, t), false);
	}
}
