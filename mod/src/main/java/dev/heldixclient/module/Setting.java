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

	/** Prozentanzeige für Regler von 0 bis 1. */
	static String percent(double value) {
		return Math.round(value * 100) + " %";
	}
}
