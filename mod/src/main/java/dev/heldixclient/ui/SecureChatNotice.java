package dev.heldixclient.ui;

import dev.heldixclient.hud.Notifications;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.toasts.SystemToast;
import net.minecraft.network.chat.Component;

/**
 * Minecrafts Hinweis „Chatnachrichten können nicht überprüft werden“ (Server ohne Chat-Signaturen) erscheint als Toast oben
 * rechts – über allen Menüs, auch über der Kopfzeile der Heldix-Menüs (Suche). Mit dem Heldix-Design zeigt HeldixClient
 * denselben Text als eigene Einblendung im Spiel und blendet den Toast aus; ohne Heldix-Design bleibt alles wie bei Minecraft.
 */
public final class SecureChatNotice {
	/** zuletzt ersetzter Toast (er blendet sich nach forceHide noch kurz aus und ist so lange weiter auffindbar) */
	private static java.lang.ref.WeakReference<SystemToast> replaced = new java.lang.ref.WeakReference<>(null);

	private SecureChatNotice() {
	}

	/** Jeden Tick: liegt der Toast an, durch die Einblendung ersetzen */
	public static void tick(Minecraft mc) {
		if (!WidgetStyle.enabled()) return;
		SystemToast toast = mc.gui.toastManager().getToast(SystemToast.class, SystemToast.SystemToastId.UNSECURE_SERVER_WARNING);
		if (toast == null || toast == replaced.get()) return;
		replaced = new java.lang.ref.WeakReference<>(toast);
		toast.forceHide();
		Notifications.show("sicherer-chat", Component.translatable("multiplayer.unsecureserver.toast.title").getString(),
				Component.translatable("multiplayer.unsecureserver.toast").getString(), null);
	}
}
