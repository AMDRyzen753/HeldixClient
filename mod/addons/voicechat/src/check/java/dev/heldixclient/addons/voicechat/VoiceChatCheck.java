package dev.heldixclient.addons.voicechat;

import dev.heldixclient.api.VoiceChannel;

import java.util.List;
import java.util.UUID;

/**
 * Prüfstand des Voice Chats (nicht Teil des Addons, läuft mit {@code gradlew build} als {@code checkVoiceChat}): Lautstärke-
 * Schutz an Testsignalen ({@link VolumeGuard#verify()} und Grenzfälle), Ringpuffer mit allen Grenzen (Alter, Bytes je
 * Sprecher, Zahl der Sprecher, Bytes zusammen, Verdrängen der am längsten nicht Gehörten) und Lautstärke-Verlauf (je Sekunde,
 * Lücken, höchstens 600). Ohne Mikrofon, Lautsprecher und Minecraft.
 */
public final class VoiceChatCheck {
	private static int failures;
	private static int passed;

	private static void check(boolean ok, String label) {
		System.out.println((ok ? "OK   " : "FEHLER ") + label);
		if (ok) passed++;
		else failures++;
	}

	public static void main(String[] args) {
		guard();
		clipBuffer();
		levels();
		System.out.println(passed + " Prüfungen bestanden, " + failures + " fehlgeschlagen");
		if (failures > 0) System.exit(1);
	}

	// ======================================================================================
	// Lautstärke-Schutz
	// ======================================================================================

	private static void guard() {
		String problem = VolumeGuard.verify();
		check(problem == null, "Lautstärke-Schutz: leise unverändert, Grenze -3 dBFS, Kompression, Attack, Dauerlärm, Erholung"
				+ (problem != null ? " – " + problem : ""));
		// Kennlinie: unter dem Knie nichts, darüber 4:1
		check(VolumeGuard.gainDb(-40) == 0 && VolumeGuard.gainDb(-22) == 0, "Kompressor: unter -21 dBFS keine Absenkung");
		check(Math.abs(VolumeGuard.gainDb(-6) - -9) < 1e-9, "Kompressor: -6 dBFS → 9 dB leiser (4:1 über -18)");
		check(VolumeGuard.gainDb(-18) < 0 && VolumeGuard.gainDb(-18) > -1, "Kompressor: weiches Knie um -18 dBFS");
		// Extremwerte: keine Ausreißer bei Vollausschlag mit Rechteck (Kurzschluss-Knacken)
		VolumeGuard guard = new VolumeGuard(VoiceEngine.RATE);
		short[] square = new short[VoiceEngine.FRAME];
		boolean within = true;
		for (int frame = 0; frame < 20; frame++) {
			for (int i = 0; i < square.length; i++) square[i] = (i / 24) % 2 == 0 ? Short.MAX_VALUE : Short.MIN_VALUE;
			guard.process(square, square.length);
			for (short sample : square) within &= Math.abs(sample) <= Math.round(Math.pow(10, VolumeGuard.CEILING_DB / 20) * 32767) + 1;
		}
		check(within, "Grenze hält auch bei Rechteck mit Vollausschlag");
		// Stille bleibt Stille
		short[] silence = new short[VoiceEngine.FRAME];
		guard.process(silence, silence.length);
		boolean quiet = true;
		for (short sample : silence) quiet &= sample == 0;
		check(quiet, "Stille bleibt Stille");
	}

	// ======================================================================================
	// Ringpuffer
	// ======================================================================================

	private static void clipBuffer() {
		UUID a = new UUID(1, 1);
		UUID b = new UUID(2, 2);
		long start = 1_764_400_000_000L;

		// Alter: älter als 10 Minuten fällt weg
		ClipBuffer buffer = new ClipBuffer();
		for (int i = 0; i < 100; i++) buffer.add(a, start + i * 20L, i, false, new byte[60]);
		check(buffer.bufferedMillis(a, start + 2_000) == 2_000, "Ringpuffer: 100 Pakete = 2 s");
		buffer.add(a, start + ClipBuffer.MAX_AGE_MS + 1_000, 100, true, new byte[60]);
		List<VoiceChannel.ReceivedPacket> left = buffer.snapshot(a, start + ClipBuffer.MAX_AGE_MS + 1_000);
		check(left.size() == 51 && left.getFirst().sequence() == 50 && left.getLast().last(), "Ringpuffer: älter als 10 Minuten fällt weg (" + left.size() + ")");
		check(buffer.snapshot(a, start + ClipBuffer.MAX_AGE_MS * 3).isEmpty(), "Ringpuffer: nach 30 Minuten leer");

		// Bytes je Sprecher: höchstens 3 MiB, älteste zuerst weg
		buffer = new ClipBuffer();
		int packets = 4 * 1024 * 1024 / 1000;
		for (int i = 0; i < packets; i++) buffer.add(a, start + i, i & 0xFFFF, false, new byte[1000 - ClipBuffer.OVERHEAD]);
		List<VoiceChannel.ReceivedPacket> kept = buffer.snapshot(a, start + packets);
		check(buffer.bytesOf(a) <= ClipBuffer.MAX_SPEAKER_BYTES && buffer.bytesOf(a) > ClipBuffer.MAX_SPEAKER_BYTES - 1000,
				"Ringpuffer: je Sprecher höchstens 3 MiB (" + buffer.bytesOf(a) + ")");
		check(kept.getLast().sequence() == ((packets - 1) & 0xFFFF) && kept.getFirst().receivedAt() > start, "Ringpuffer: das Neueste bleibt, das Älteste geht");

		// Zahl der Sprecher: höchstens 32, verdrängt wird, wer am längsten nicht zu hören war
		buffer = new ClipBuffer();
		for (int s = 0; s < ClipBuffer.MAX_SPEAKERS; s++) buffer.add(new UUID(10, s), start + s * 1000L, 0, false, new byte[50]);
		buffer.add(new UUID(10, 0), start + 40_000, 1, false, new byte[50]);
		buffer.add(b, start + 41_000, 0, false, new byte[50]);
		check(buffer.speakerCount() == ClipBuffer.MAX_SPEAKERS, "Ringpuffer: höchstens 32 Sprecher (" + buffer.speakerCount() + ")");
		check(buffer.contains(new UUID(10, 0)) && !buffer.contains(new UUID(10, 1)) && buffer.contains(b),
				"Ringpuffer: der am längsten nicht Gehörte wird verdrängt (nicht der gerade Gehörte)");

		// zusammen höchstens 48 MiB
		buffer = new ClipBuffer();
		int per = (int) (ClipBuffer.MAX_SPEAKER_BYTES / 1000);
		for (int s = 0; s < 20; s++) {
			UUID speaker = new UUID(20, s);
			for (int i = 0; i < per; i++) buffer.add(speaker, start + s * 10_000L + i, i & 0xFFFF, false, new byte[1000 - ClipBuffer.OVERHEAD]);
		}
		check(buffer.totalBytes() <= ClipBuffer.MAX_TOTAL_BYTES, "Ringpuffer: zusammen höchstens 48 MiB (" + buffer.totalBytes() / (1024 * 1024) + " MiB)");
		check(!buffer.contains(new UUID(20, 0)) && buffer.contains(new UUID(20, 19)), "Ringpuffer: bei 48 MiB gehen die zuerst Gehörten");
		long total = 0;
		for (int s = 0; s < 20; s++) total += buffer.bytesOf(new UUID(20, s));
		check(total == buffer.totalBytes(), "Ringpuffer: Summe stimmt nach dem Verdrängen");

		// leeren und Kopien
		buffer.clear();
		check(buffer.isEmpty() && buffer.totalBytes() == 0, "Ringpuffer: leeren");
		buffer.add(a, start, 5, true, new byte[] {1, 2, 3});
		List<VoiceChannel.ReceivedPacket> copy = buffer.snapshot(a, start);
		buffer.clear();
		check(copy.size() == 1 && copy.getFirst().sequence() == 5 && copy.getFirst().receivedAt() == start, "Ringpuffer: Kopie bleibt nach dem Leeren");
		buffer.add(a, start, 0, false, new byte[0]);
		buffer.add(a, start, 0, false, new byte[5000]);
		check(buffer.isEmpty(), "Ringpuffer: leere und zu große Pakete werden nicht gepuffert");
		buffer.add(a, start, 0, false, new byte[10]);
		buffer.expire(start + ClipBuffer.MAX_AGE_MS + 1);
		check(buffer.isEmpty(), "Ringpuffer: abgelaufene Sprecher werden vergessen");
	}

	// ======================================================================================
	// Lautstärke-Verlauf
	// ======================================================================================

	private static void levels() {
		LevelHistory history = new LevelHistory();
		long start = 1_764_400_000_000L;
		check(history.snapshot(start) == null, "Verlauf: ohne Ton nichts");
		short[] loud = new short[VoiceEngine.FRAME];
		for (int i = 0; i < loud.length; i++) loud[i] = (short) Math.round(Math.sin(2 * Math.PI * 440 * i / VoiceEngine.RATE) * 16384);
		// Sekunde 0 und 2 mit Ton, Sekunde 1 still
		for (int f = 0; f < 50; f++) history.add(loud, loud.length, start + f * 20L);
		for (int f = 0; f < 50; f++) history.add(loud, loud.length, start + 2000 + f * 20L);
		LevelHistory.Snapshot snapshot = history.snapshot(start + 2999);
		check(snapshot != null && snapshot.rms().length == 3, "Verlauf: drei Sekunden (" + (snapshot == null ? 0 : snapshot.rms().length) + ")");
		if (snapshot != null && snapshot.rms().length == 3) {
			check(Math.abs(snapshot.peak()[0] - -6) < 0.2 && Math.abs(snapshot.rms()[0] - -9) < 0.3, "Verlauf: Spitze -6 dBFS, Effektivwert -9 dBFS");
			check(Float.isNaN(snapshot.rms()[1]) && Float.isNaN(snapshot.peak()[1]), "Verlauf: stille Sekunde ist leer");
			check(!Float.isNaN(snapshot.rms()[2]), "Verlauf: laufende Sekunde zählt mit");
			check(snapshot.end() == (start / 1000 + 3) * 1000, "Verlauf: Ende der letzten Sekunde");
		}
		// höchstens 600 Sekunden
		for (int s = 0; s < 700; s++) history.add(loud, loud.length, start + 3000 + s * 1000L);
		LevelHistory.Snapshot full = history.snapshot(start + 3000 + 699 * 1000L);
		check(full != null && full.rms().length == LevelHistory.SECONDS, "Verlauf: höchstens 600 Sekunden (" + (full == null ? 0 : full.rms().length) + ")");
	}
}
