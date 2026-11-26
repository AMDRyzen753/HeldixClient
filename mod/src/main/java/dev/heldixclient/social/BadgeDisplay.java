package dev.heldixclient.social;

import dev.heldixclient.config.HeldixConfig;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

/**
 * Wo das Heldix-Symbol erscheint: vor Namen in der Tab-Liste (mit einer Zeile „HeldixClient: … Spieler hier“ in der
 * Fußzeile) und im Namensschild über den Köpfen anderer Spieler. Alles kommt aus dem Zwischenspeicher von
 * {@link Social} – kein Bild löst eine Anfrage an den Dienst aus.
 *
 * <p>Das Namensschild bleibt das von Minecraft: Schleichen (blasser), Unsichtbarkeit, F1 und Server, die Namensschilder
 * über Teams ausblenden, gelten für das Symbol genauso.
 */
public final class BadgeDisplay {
	/** Zeile für die Fußzeile der Tab-Liste (null = keine); wird nur im Client-Tick neu berechnet */
	private static Component footerLine;
	private static int footerCount;
	private static int tickCounter;
	private static Component lastFooterIn;
	private static Component lastFooterLine;
	private static Component lastFooterOut;

	private BadgeDisplay() {
	}

	/**
	 * Im Client-Tick (Hauptthread): Spieler mit Heldix-Symbol in der Tab-Liste zählen, zweimal pro Sekunde. So bleibt
	 * die Zeile innerhalb eines Bildes gleich – Minecraft liest die Fußzeile pro Bild zweimal.
	 */
	static void tick(Minecraft mc) {
		if (++tickCounter % 10 != 0) return;
		int count = count(mc);
		if (count == footerCount && (count == 0) == (footerLine == null)) return;
		footerCount = count;
		footerLine = count > 0 ? Component.empty().append(Badge.symbol())
				.append(Component.literal(" HeldixClient: " + count + " Spieler hier").withStyle(ChatFormatting.GRAY)) : null;
	}

	private static int count(Minecraft mc) {
		if (!HeldixConfig.get().badgeTabList || !Social.online()) return 0;
		ClientPacketListener connection = mc.getConnection();
		if (connection == null) return 0;
		int count = 0;
		for (PlayerInfo info : connection.getListedOnlinePlayers()) {
			if (Social.roleOf(info.getProfile().id()) != null) count++;
		}
		return count;
	}

	/** Wie viele Spieler in der Tab-Liste gerade ein Heldix-Symbol haben (Stand des letzten Zählens) */
	public static int tabListCount() {
		return footerCount;
	}

	/** Gleich neu zählen (Tests, nach dem Umschalten der Einstellung) */
	public static void refresh() {
		tickCounter = 9;
		tick(Minecraft.getInstance());
	}

	/** PlayerTabOverlay.getNameForDisplay: Symbol der Rolle vor dem Namen. */
	public static Component tabName(Component name, PlayerInfo info) {
		if (name == null || info == null || !HeldixConfig.get().badgeTabList) return name;
		Badge.Role role = Social.roleOf(info.getProfile().id());
		return role == null ? name : Badge.prefix(name, role);
	}

	/**
	 * Fußzeile der Tab-Liste: unter der Fußzeile des Servers (oder allein, wenn er keine hat) die Zeile
	 * „HeldixClient: 3 Spieler hier“. Gleiche Eingabe gibt dasselbe Objekt zurück.
	 */
	public static Component tabFooter(Component footer) {
		Component line = footerLine;
		if (line == null || !HeldixConfig.get().badgeTabList) return footer;
		if (footer == lastFooterIn && line == lastFooterLine && lastFooterOut != null) return lastFooterOut;
		Component combined = footer == null ? line : Component.empty().append(footer).append(Component.literal("\n")).append(line);
		lastFooterIn = footer;
		lastFooterLine = line;
		lastFooterOut = combined;
		return combined;
	}

	/** Nur für Tests: die zuletzt gezeichnete Fußzeile mit Heldix-Zeile (null = noch keine) */
	public static Component lastFooter() {
		return lastFooterOut;
	}

	/**
	 * EntityRenderer.getNameTag: Symbol der Rolle vor dem Namen im Namensschild anderer Spieler. Mit F1 nie – Minecraft
	 * selbst zeigt die Schilder von Spielern in einem Team (Sichtbarkeit „immer“) auch dann noch.
	 */
	public static Component nameTag(Component name, Entity entity) {
		if (name == null || !(entity instanceof Player player)) return name;
		if (Minecraft.getInstance().gui.hud.isHidden()) return name;
		Component result = name;
		if (HeldixConfig.get().badgeNameTags) {
			Badge.Role role = Social.roleOf(player.getUUID());
			if (role != null) result = Badge.prefix(name, role);
		}
		// Symbole der Addons hinter dem Namen (z. B. „spricht“ im Voice Chat)
		return dev.heldixclient.player.PlayerMarkerStore.decorate(result, player.getUUID());
	}
}
