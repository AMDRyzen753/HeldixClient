package dev.heldixclient.voice;

import dev.heldixclient.screen.PlayerMenuScreen;
import dev.heldixclient.screen.ShellScreen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Öffnet die Dialoge der Voice-Moderation von HeldixClient (API 10): „Voice-Regeln“ ({@link VoiceRulesScreen}) und „Melden“
 * ({@link VoiceReportScreen}). Auf Wunsch des Spielers sofort; der Regeln-Dialog von selbst (z. B. wenn der Dienst die
 * Zustimmung verlangt) erst, wenn gerade kein anderes Fenster offen ist – nie mitten in Chat oder Inventar. Nur Haupt-Thread.
 */
public final class VoiceDialogs {
	/** wartet auf einen freien Bildschirm (von selbst geöffnet) */
	private static final List<Consumer<Boolean>> WAITING = new ArrayList<>();

	private VoiceDialogs() {
	}

	/**
	 * Regeln-Dialog zeigen. {@code now}: auf Wunsch des Spielers sofort; sonst, sobald kein anderes Fenster offen ist (und nur,
	 * solange die Zustimmung noch nötig ist). {@code onDone} läuft genau einmal im Haupt-Thread.
	 */
	public static void showRules(boolean now, Consumer<Boolean> onDone) {
		Minecraft minecraft = Minecraft.getInstance();
		if (minecraft.gui.screen() instanceof VoiceRulesScreen open) {
			open.addCallback(onDone);
			return;
		}
		if (now) {
			List<Consumer<Boolean>> callbacks = new ArrayList<>(WAITING);
			WAITING.clear();
			callbacks.add(onDone);
			minecraft.gui.setScreen(new VoiceRulesScreen(parentFor(minecraft.gui.screen()), callbacks));
			return;
		}
		WAITING.add(onDone);
	}

	/** Melde-Dialog öffnen (immer auf Wunsch des Spielers) */
	public static void openReport(VoiceReports.Request request) {
		Minecraft minecraft = Minecraft.getInstance();
		minecraft.gui.setScreen(new VoiceReportScreen(parentFor(minecraft.gui.screen()), request));
	}

	/** jeden Tick (aus {@link VoiceLink#tick}) */
	static void tick(Minecraft minecraft) {
		if (WAITING.isEmpty()) return;
		Screen screen = minecraft.gui.screen();
		if (screen instanceof VoiceRulesScreen open) {
			for (Consumer<Boolean> callback : WAITING) open.addCallback(callback);
			WAITING.clear();
			return;
		}
		if (!VoiceModeration.rulesRequired()) {
			// inzwischen angenommen (z. B. auf der Webseite) oder nicht mehr nötig
			answer(true);
			return;
		}
		boolean free = screen == null ? minecraft.level != null : screen instanceof PauseScreen || screen instanceof ShellScreen;
		if (!free) return;
		List<Consumer<Boolean>> callbacks = new ArrayList<>(WAITING);
		WAITING.clear();
		minecraft.gui.setScreen(new VoiceRulesScreen(screen, callbacks));
	}

	private static void answer(boolean value) {
		List<Consumer<Boolean>> callbacks = new ArrayList<>(WAITING);
		WAITING.clear();
		for (Consumer<Boolean> callback : callbacks) callback.accept(value);
	}

	/** Wohin nach dem Dialog? Spielermenü und Chat schließen dabei (zurück ins Spiel), sonst zurück zum offenen Menü */
	private static Screen parentFor(Screen screen) {
		if (screen == null || screen instanceof PlayerMenuScreen || screen instanceof ChatScreen) return null;
		if (screen instanceof VoiceRulesScreen || screen instanceof VoiceReportScreen) return null;
		return screen;
	}
}
