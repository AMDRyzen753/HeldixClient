package dev.heldixclient.addons.voicechat;

/**
 * Lautstärke-Schutz für einen Sprecher (ab 1.3.0): läuft nach dem Dekodieren, vor dem Mischen. Weiche Kompression über etwa
 * -18 dBFS (4:1, weiches Knie 6 dB) mit schneller Attack (2 ms) und langsamer Release (250 ms), dahinter eine harte Grenze bei
 * -3 dBFS (sofort runter, in 80 ms wieder hoch, zur Sicherheit zusätzlich abgeschnitten). Dazu Schutz gegen Dauerlärm: Ist
 * jemand länger als 3 Sekunden sehr laut (Effektivwert über -20 dBFS), senkt der Schutz um bis zu 12 dB weiter ab (3 dB je
 * Sekunde) und gibt erst langsam wieder frei (1,5 dB je Sekunde). Nicht threadsicher – je Sprecher eine Instanz im
 * Wiedergabe-Thread.
 */
final class VolumeGuard {
	static final double THRESHOLD_DB = -18;
	static final double RATIO = 4;
	static final double KNEE_DB = 6;
	static final double CEILING_DB = -3;
	/** ein Rahmen gilt als sehr laut ab diesem Effektivwert (dBFS) */
	static final double LOUD_DB = -20;
	/** so lange sehr laut, bevor der Schutz gegen Dauerlärm greift */
	static final double LOUD_AFTER_MS = 3000;
	static final double MAX_EXTRA_DB = 12;
	private static final double DOWN_DB_PER_S = 3;
	private static final double UP_DB_PER_S = 1.5;
	private static final double CEILING = Math.pow(10, CEILING_DB / 20);

	private final int rate;
	private final double attack;
	private final double release;
	private final double limiterRelease;
	private double envelope;
	private double limiterGain = 1;
	private double loudMs;
	private double extraDb;

	VolumeGuard(int rate) {
		this.rate = rate;
		this.attack = coefficient(0.002, rate);
		this.release = coefficient(0.25, rate);
		this.limiterRelease = coefficient(0.08, rate);
	}

	private static double coefficient(double seconds, int rate) {
		return Math.exp(-1.0 / (seconds * rate));
	}

	/** Einen Rahmen (16 Bit, mono) an Ort und Stelle begrenzen */
	void process(short[] pcm, int length) {
		// Dauerlärm: Effektivwert des Rahmens vor dem Schutz
		double sum = 0;
		for (int i = 0; i < length; i++) sum += (double) pcm[i] * pcm[i];
		double rmsDb = toDb(Math.sqrt(sum / Math.max(1, length)) / 32768.0);
		double frameMs = length * 1000.0 / rate;
		if (rmsDb > LOUD_DB) loudMs = Math.min(loudMs + frameMs, 20_000);
		else loudMs = Math.max(0, loudMs - frameMs * 2);
		double target = loudMs > LOUD_AFTER_MS ? -Math.min(MAX_EXTRA_DB, (loudMs - LOUD_AFTER_MS) / 1000.0 * DOWN_DB_PER_S) : 0;
		if (target < extraDb) extraDb = Math.max(target, extraDb - DOWN_DB_PER_S * frameMs / 1000);
		else extraDb = Math.min(target, extraDb + UP_DB_PER_S * frameMs / 1000);

		for (int i = 0; i < length; i++) {
			double x = pcm[i] / 32768.0;
			double level = Math.abs(x);
			envelope = level > envelope ? attack * envelope + (1 - attack) * level : release * envelope + (1 - release) * level;
			double y = x * Math.pow(10, (gainDb(toDb(envelope)) + extraDb) / 20);
			// harte Grenze: sofort runter, langsam wieder hoch
			double magnitude = Math.abs(y);
			double needed = magnitude > CEILING ? CEILING / magnitude : 1;
			limiterGain = needed < limiterGain ? needed : Math.min(needed, 1 - limiterRelease * (1 - limiterGain));
			y *= limiterGain;
			if (y > CEILING) y = CEILING;
			else if (y < -CEILING) y = -CEILING;
			pcm[i] = (short) Math.round(y * 32767);
		}
	}

	/** Absenkung des Kompressors (dB, ≤ 0) für einen Pegel (dBFS), mit weichem Knie */
	static double gainDb(double levelDb) {
		double over = levelDb - THRESHOLD_DB;
		if (2 * over < -KNEE_DB) return 0;
		if (2 * Math.abs(over) <= KNEE_DB) {
			double t = over + KNEE_DB / 2;
			return (1 / RATIO - 1) * t * t / (2 * KNEE_DB);
		}
		return (1 / RATIO - 1) * over;
	}

	/** aktuelle Zusatz-Absenkung gegen Dauerlärm (dB, ≤ 0) */
	double sustainedDb() {
		return extraDb;
	}

	static double toDb(double linear) {
		return linear > 1e-9 ? 20 * Math.log10(linear) : -180;
	}

	// ======================================================================================
	// Selbstprüfung (Gradle-Prüfung „checkVoiceChat“ und Autotest)
	// ======================================================================================

	/** Prüft das Verhalten an Testsignalen; null = alles in Ordnung, sonst die erste Abweichung (deutsch) */
	static String verify() {
		int rate = VoiceEngine.RATE;
		int frame = VoiceEngine.FRAME;
		// 1. leise Stimme (-30 dBFS) bleibt unverändert
		VolumeGuard guard = new VolumeGuard(rate);
		double[] quiet = run(guard, -30, 50, frame, rate, false);
		if (Math.abs(quiet[0] - -30) > 0.6) return "leise Stimme verändert (" + round(quiet[0]) + " dBFS statt -30)";
		// 2. Vollausschlag: nie über -3 dBFS, auch nicht im ersten Rahmen
		guard = new VolumeGuard(rate);
		double firstPeak = run(guard, 0, 1, frame, rate, false)[0];
		double laterPeak = run(guard, 0, 50, frame, rate, false)[0];
		if (firstPeak > CEILING_DB + 0.05 || laterPeak > CEILING_DB + 0.05) return "Grenze -3 dBFS überschritten (" + round(Math.max(firstPeak, laterPeak)) + ")";
		// 3. laut (-10 dBFS): weich komprimiert auf etwa -16 dBFS (gemessen, nachdem die Attack gegriffen hat)
		guard = new VolumeGuard(rate);
		run(guard, -10, 5, frame, rate, false);
		double loud = run(guard, -10, 45, frame, rate, false)[0];
		if (loud > -13.5 || loud < -19) return "Kompression über -18 dBFS falsch (" + round(loud) + " dBFS aus -10)";
		// 4. schnelle Attack: nach 10 ms Vollausschlag schon deutlich leiser
		guard = new VolumeGuard(rate);
		short[] burst = new short[frame];
		fill(burst, 0, 0, rate);
		guard.process(burst, frame);
		double peakAfter = 0;
		for (int i = rate / 100; i < frame; i++) peakAfter = Math.max(peakAfter, Math.abs(burst[i]) / 32768.0);
		if (toDb(peakAfter) > -10) return "Attack zu langsam (" + round(toDb(peakAfter)) + " dBFS nach 10 ms)";
		// 5. Dauerlärm: nach 8 s deutlich leiser als nach 1 s
		guard = new VolumeGuard(rate);
		double early = run(guard, -6, 50, frame, rate, true)[1];
		run(guard, -6, 300, frame, rate, true);
		double late = run(guard, -6, 50, frame, rate, true)[1];
		if (early - late < 6) return "Schutz gegen Dauerlärm greift nicht (" + round(early) + " → " + round(late) + " dB)";
		// 6. danach langsam erholen: nach 2 s noch abgesenkt, nach 15 s wieder normal
		double soon = run(guard, -30, 100, frame, rate, false)[0];
		if (soon > -32) return "erholt sich zu schnell (" + round(soon) + " dBFS nach 2 s)";
		run(guard, -30, 650, frame, rate, false);
		double recovered = run(guard, -30, 50, frame, rate, false)[0];
		if (Math.abs(recovered - -30) > 1) return "erholt sich nicht (" + round(recovered) + " dBFS nach 16 s)";
		return null;
	}

	/** Testsignal (Sinus 440 Hz oder Rauschen) mit Spitzenwert levelDb; liefert {Spitze, Effektivwert} der Ausgabe in dBFS */
	private static double[] run(VolumeGuard guard, double levelDb, int frames, int frame, int rate, boolean noise) {
		short[] pcm = new short[frame];
		double peak = 0;
		double sum = 0;
		long count = 0;
		java.util.Random random = new java.util.Random(7);
		for (int f = 0; f < frames; f++) {
			double amplitude = Math.pow(10, levelDb / 20) * 32767;
			for (int i = 0; i < frame; i++) {
				double value = noise ? (random.nextDouble() * 2 - 1) : Math.sin(2 * Math.PI * 440 * (f * frame + i) / rate);
				pcm[i] = (short) Math.round(value * amplitude);
			}
			guard.process(pcm, frame);
			for (int i = 0; i < frame; i++) {
				double sample = pcm[i] / 32768.0;
				peak = Math.max(peak, Math.abs(sample));
				sum += sample * sample;
				count++;
			}
		}
		return new double[] {toDb(peak), toDb(Math.sqrt(sum / Math.max(1, count)))};
	}

	private static void fill(short[] pcm, double levelDb, int offset, int rate) {
		double amplitude = Math.pow(10, levelDb / 20) * 32767;
		for (int i = 0; i < pcm.length; i++) pcm[i] = (short) Math.round(Math.sin(2 * Math.PI * 440 * (offset + i) / rate) * amplitude);
	}

	private static String round(double value) {
		return String.format(java.util.Locale.GERMANY, "%.1f", value);
	}
}
