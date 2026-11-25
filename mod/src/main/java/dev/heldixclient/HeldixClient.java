package dev.heldixclient;

import com.mojang.blaze3d.platform.InputConstants;
import dev.heldixclient.addon.AddonManager;
import dev.heldixclient.config.HeldixConfig;
import dev.heldixclient.hud.HudRenderer;
import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.HeldixModInitializer;
import dev.heldixclient.loader.api.KeyMappings;
import dev.heldixclient.loader.api.ModInfo;
import dev.heldixclient.loader.api.event.ClientEvents;
import dev.heldixclient.loader.api.event.HudEvents;
import dev.heldixclient.loader.api.event.ScreenEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import dev.heldixclient.module.ModuleManager;
import dev.heldixclient.render.DebugOverlay;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.status.StatusReporter;
import dev.heldixclient.ui.Draw;
import dev.heldixclient.ui.Theme;
import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * HeldixClient – läuft als Mod auf dem Heldix Loader.
 * Eingriffe in Minecraft selbst stehen in {@link dev.heldixclient.transform.HeldixPatches}.
 */
public class HeldixClient implements HeldixModInitializer {
	public static final String MOD_ID = "heldixclient";
	public static final String NAME = "HeldixClient";
	public static final Logger LOGGER = LoggerFactory.getLogger(NAME);

	public static String version = "dev";

	public static KeyMapping menuKey;
	public static KeyMapping zoomKey;
	public static KeyMapping freelookKey;
	public static KeyMapping waypointKey;

	@Override
	public void onInitialize() {
		version = HeldixLoader.mod(MOD_ID).map(ModInfo::version).orElse("dev");

		HeldixConfig.load();
		ModuleManager.init();
		AddonManager.init();

		KeyMapping.Category category = KeyMapping.Category.register(id("main"));
		menuKey = KeyMappings.register(new KeyMapping("key.heldixclient.menu", InputConstants.Type.KEYBOARD, InputConstants.KEY_RSHIFT, category));
		zoomKey = KeyMappings.register(new KeyMapping("key.heldixclient.zoom", InputConstants.Type.KEYBOARD, InputConstants.KEY_C, category));
		freelookKey = KeyMappings.register(new KeyMapping("key.heldixclient.freelook", InputConstants.Type.KEYBOARD, InputConstants.KEY_LALT, category));
		waypointKey = KeyMappings.register(new KeyMapping("key.heldixclient.waypoint", InputConstants.Type.KEYBOARD, InputConstants.KEY_B, category));

		HudEvents.RENDER.register(HudRenderer::extract);
		ClientEvents.TICK_END.register(HeldixClient::onTick);
		StatusReporter.init();
		// Heldix-Dienst: Capes anderer Spieler, Heldix-Symbol, Freunde (nur mit eingetragener Adresse)
		dev.heldixclient.social.Social.init();
		// F3: eigener Eintrag – vor dem Laden der F3-Einstellungen, damit Minecraft ihn kennt
		DebugOverlay.register();

		// zuletzt besuchten Server merken (Startseite: "Weiterspielen" bzw. Mehrspieler-Karte)
		WorldEvents.JOIN.register(HeldixClient::rememberServer);
		// Spielzeit der Sitzung für das Pausemenü
		dev.heldixclient.screen.PauseMenuScreen.trackSession();

		// Pausemenü: direkter Zugang zum Heldix-Menü
		ScreenEvents.AFTER_INIT.register((minecraft, screen, width, height) -> {
			if (screen instanceof PauseScreen pause && pause.showsPauseMenu()) {
				ScreenEvents.addWidget(screen, Button.builder(Component.literal("Heldix-Menü"),
								button -> minecraft.gui.setScreen(new HeldixMenuScreen(screen)))
						.bounds(6, 6, 86, 20)
						.build());
			}
		});

		LOGGER.info("{} {} geladen (Heldix Loader {})", NAME, version, HeldixLoader.version());
	}

	/** Kleines Abzeichen "[H] HELDIX CLIENT v…" oben links im Vanilla-Hauptmenü. */
	public static void drawBranding(GuiGraphicsExtractor g, Font font) {
		Component heldix = Component.literal("HELDIX").withStyle(ChatFormatting.BOLD);
		String client = "CLIENT";
		String ver = "v" + version;
		int x = 4;
		int y = 4;
		int w = 4 + 14 + 6 + font.width(heldix) + 4 + font.width(client) + 6 + font.width(ver) + 7;
		Draw.glass(g, x, y, w, 22, 0xB00B1830);
		dev.heldixclient.ui.Ui.logo(g, x + 4, y + 4, 14, 1f);
		int textX = x + 24;
		g.text(font, heldix, textX, y + 7, Theme.TEXT, false);
		textX += font.width(heldix) + 4;
		g.text(font, client, textX, y + 7, Theme.ACCENT_LIGHT, false);
		textX += font.width(client) + 6;
		g.text(font, ver, textX, y + 7, Theme.FAINT, false);
	}

	private static void rememberServer(Minecraft mc) {
		ServerData server = mc.getCurrentServer();
		if (server == null || server.isLan() || server.isRealm()) return;
		HeldixConfig.Data config = HeldixConfig.get();
		config.lastServerIp = server.ip;
		config.lastServerName = server.name;
		config.lastServerAt = System.currentTimeMillis();
		HeldixConfig.save();
	}

	private static void onTick(Minecraft mc) {
		while (menuKey.consumeClick()) {
			if (mc.gui.screen() == null) {
				mc.gui.setScreen(new HeldixMenuScreen(null));
			}
		}
		ModuleManager.tick(mc);
		DebugOverlay.seed(mc);
	}

	public static Identifier id(String path) {
		return Identifier.fromNamespaceAndPath(MOD_ID, path);
	}
}
