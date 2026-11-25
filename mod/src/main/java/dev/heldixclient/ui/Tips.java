package dev.heldixclient.ui;

import dev.heldixclient.HeldixClient;
import net.minecraft.client.KeyMapping;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/**
 * Tipps zu HeldixClient für Hauptmenü und Ladebildschirme. Tasten werden mit ihrer aktuellen Belegung genannt.
 */
public final class Tips {
	/** Ein Tipp: Icon aus dem Heldix-Icon-Set und Text */
	public record Tip(String icon, String text) {
	}

	private static final List<Supplier<Tip>> ALL = List.of(
			() -> new Tip("modules", key(HeldixClient.menuKey) + " öffnet im Spiel das Heldix-Menü mit allen Modulen."),
			() -> new Tip("zoom", "Halte " + key(HeldixClient.zoomKey) + " zum Zoomen, mit dem Mausrad änderst du die Stärke."),
			() -> new Tip("eye", "Halte " + key(HeldixClient.freelookKey) + " für Freelook: frei umschauen, ohne die Laufrichtung zu ändern."),
			() -> new Tip("pin", "Mit " + key(HeldixClient.waypointKey) + " setzt du einen Wegpunkt – er bleibt auch durch Wände sichtbar."),
			() -> new Tip("pin", "Beim Tod merkt sich HeldixClient einen Todespunkt als Wegpunkt."),
			() -> new Tip("chat", "Strg+Klick auf eine Chat-Nachricht kopiert sie (Modul Chat)."),
			() -> new Tip("sprint", "Dauersprint: Du sprintest ohne Taste, die Sprinttaste schaltet ihn an und aus."),
			() -> new Tip("friends", "Unter Freunde siehst du, wer online ist und auf welchem Server."),
			() -> new Tip("cape", "Andere HeldixClient-Spieler sehen dein Heldix-Cape."),
			() -> new Tip("crosshair", "Form und Farbe des Fadenkreuzes stellst du unter Module → Fadenkreuz ein."),
			() -> new Tip("shield", "Das Modul Rüstung zeigt Haltbarkeit von Rüstung und Werkzeug."),
			() -> new Tip("hud", "Im HUD-Editor ziehst du an der Ecke eines Elements, um es zu vergrößern."),
			() -> new Tip("hud", "Rechtsklick auf ein Element im HUD-Editor öffnet seine Einstellungen."),
			() -> new Tip("shader", "Unter Shader findest du Farbstile und die Shader-Engine mit Bloom und SSAO."));

	private Tips() {
	}

	/** zufälliger Tipp */
	public static Tip random() {
		return ALL.get(ThreadLocalRandom.current().nextInt(ALL.size())).get();
	}

	/** Tipp, der alle {@code seconds} Sekunden wechselt (für Ladebildschirme) */
	public static Tip rotating(int seconds) {
		int index = (int) ((System.currentTimeMillis() / 1000 / Math.max(1, seconds)) % ALL.size());
		return ALL.get(index).get();
	}

	private static String key(KeyMapping mapping) {
		return mapping == null ? "?" : mapping.getTranslatedKeyMessage().getString();
	}
}
