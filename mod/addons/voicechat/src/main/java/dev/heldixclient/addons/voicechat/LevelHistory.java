package dev.heldixclient.addons.voicechat;

import java.util.Arrays;

/**
 * Lautstärke-Verlauf eines Sprechers für Meldungen (ab 1.3.0): je Sekunde Effektivwert und Spitze in dBFS, die letzten 600
 * Sekunden – nur der Pegel, kein Inhalt. Gemessen nach dem Dekodieren, vor dem Lautstärke-Schutz. Sekunden, in denen nichts
 * zu hören war, bleiben leer ({@code NaN}). Threadsicher (Wiedergabe-Thread schreibt, Haupt-Thread liest).
 */
final class LevelHistory {
	static final int SECONDS = 600;

	/** Verlauf: Ende der letzten Sekunde (ms), Werte älteste zuerst */
	record Snapshot(long end, float[] rms, float[] peak) {
	}

	private final long[] second = new long[SECONDS];
	private final float[] rms = new float[SECONDS];
	private final float[] peak = new float[SECONDS];
	private long current = -1;
	private double sum;
	private double max;
	private long count;
	private long lastHeard;

	LevelHistory() {
		Arrays.fill(second, -1);
	}

	/** Einen dekodierten Rahmen messen */
	synchronized void add(short[] pcm, int length, long now) {
		long sec = now / 1000;
		if (sec != current) {
			flush();
			current = sec;
		}
		for (int i = 0; i < length; i++) {
			double sample = pcm[i] / 32768.0;
			sum += sample * sample;
			max = Math.max(max, Math.abs(sample));
		}
		count += length;
		lastHeard = now;
	}

	private void flush() {
		if (current < 0 || count == 0) return;
		int slot = (int) (current % SECONDS);
		second[slot] = current;
		rms[slot] = db(Math.sqrt(sum / count));
		peak[slot] = db(max);
		sum = 0;
		max = 0;
		count = 0;
	}

	private static float db(double linear) {
		return linear > 1e-5 ? (float) Math.max(-100, 20 * Math.log10(linear)) : -100f;
	}

	/** Verlauf bis jetzt (höchstens 600 Sekunden, ab der ersten Sekunde mit Ton); null = nichts gehört */
	synchronized Snapshot snapshot(long now) {
		long last = now / 1000;
		long first = -1;
		for (long s = last - SECONDS + 1; s <= last; s++) {
			if (has(s)) {
				first = s;
				break;
			}
		}
		if (first < 0) return null;
		int length = (int) (last - first + 1);
		float[] outRms = new float[length];
		float[] outPeak = new float[length];
		for (int i = 0; i < length; i++) {
			long s = first + i;
			if (s == current && count > 0) {
				outRms[i] = db(Math.sqrt(sum / count));
				outPeak[i] = db(max);
			} else if (second[(int) (s % SECONDS)] == s) {
				outRms[i] = rms[(int) (s % SECONDS)];
				outPeak[i] = peak[(int) (s % SECONDS)];
			} else {
				outRms[i] = Float.NaN;
				outPeak[i] = Float.NaN;
			}
		}
		return new Snapshot((last + 1) * 1000, outRms, outPeak);
	}

	private boolean has(long s) {
		return s == current && count > 0 || s >= 0 && second[(int) (s % SECONDS)] == s;
	}

	synchronized long lastHeard() {
		return lastHeard;
	}
}
