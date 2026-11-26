package dev.heldixclient.module;

import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.DoubleConsumer;
import java.util.function.DoubleFunction;
import java.util.function.DoubleSupplier;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

/**
 * Eine Einstellung im Heldix-Menü (Untermenü eines Moduls oder ein Reiter). Wert lesen und schreiben
 * übernehmen Lambdas; gespeichert wird beim Schreiben (siehe {@link Module#toggle(String, String, String, boolean)} usw.).
 */
public sealed interface Setting {
	String label();

	/** kurze Erklärung, darf leer sein */
	String description();

	/** An/Aus-Schalter */
	record Toggle(String label, String description, BooleanSupplier get, Consumer<Boolean> set) implements Setting {
	}

	/** Regler zwischen min und max in Schritten von step; format macht aus dem Wert den angezeigten Text. */
	record Slider(String label, String description, double min, double max, double step, DoubleSupplier get, DoubleConsumer set,
			DoubleFunction<String> format) implements Setting {
		public double snap(double value) {
			double snapped = Math.round((value - min) / step) * step + min;
			return Math.clamp(snapped, min, max);
		}
	}

	/** Auswahl aus festen Möglichkeiten (Klick schaltet weiter). */
	record Choice(String label, String description, List<String> options, IntSupplier get, IntConsumer set) implements Setting {
		public String current() {
			int index = get.getAsInt();
			return index >= 0 && index < options.size() ? options.get(index) : "?";
		}
	}

	/** Knopf, der etwas auslöst (z. B. Position zurücksetzen). */
	record Action(String label, String description, String button, Runnable run) implements Setting {
	}

	/** Farbe (ARGB): Klick klappt eine Palette auf; die Standardfarbe steht immer darin. */
	record Color(String label, String description, int defaultColor, IntSupplier get, IntConsumer set) implements Setting {
		/** Heldix-Farben und ein paar kräftige Töne (deckend) */
		public static final List<Integer> PALETTE = List.of(0xFF3B82F6, 0xFF93C5FD, 0xFF22D3EE, 0xFF2DD4BF, 0xFF34D399, 0xFF1DB954,
				0xFFA3E635, 0xFFFBBF24, 0xFFFB923C, 0xFFF87171, 0xFFF472B6, 0xFFC084FC, 0xFF8B5CF6, 0xFFFFFFFF, 0xFF9BA6B8, 0xFF4B5563);

		/** Palette mit der Standardfarbe vorne (falls sie nicht ohnehin darin vorkommt) */
		public List<Integer> palette() {
			if (PALETTE.contains(defaultColor)) return PALETTE;
			List<Integer> colors = new java.util.ArrayList<>(PALETTE.size() + 1);
			colors.add(defaultColor);
			colors.addAll(PALETTE);
			return colors;
		}
	}

	/** Eine Zeile Text (Eingabefeld unter der Beschriftung). */
	record Text(String label, String description, int maxLength, java.util.function.Supplier<String> get, Consumer<String> set) implements Setting {
	}

	/**
	 * Taste (eine Tastenbelegung von Minecraft): Klick, dann die neue Taste drücken; Entf oder Rücktaste = nicht belegt,
	 * Esc bricht ab. Dieselbe Belegung steht unter Optionen → Steuerung; geändert wird sie an beiden Stellen.
	 */
	record Key(String label, String description, net.minecraft.client.KeyMapping mapping) implements Setting {
	}

	/** Prozentanzeige für Regler von 0 bis 1. */
	static String percent(double value) {
		return Math.round(value * 100) + " %";
	}
}
