package dev.heldixclient.addons.voicechat;

import dev.heldixclient.api.HeldixLogger;
import dev.heldixclient.api.VoiceChannel;
import io.github.jaredmdobson.concentus.OpusApplication;
import io.github.jaredmdobson.concentus.OpusDecoder;
import io.github.jaredmdobson.concentus.OpusEncoder;
import io.github.jaredmdobson.concentus.OpusException;
import io.github.jaredmdobson.concentus.OpusSignal;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.Mixer;
import javax.sound.sampled.SourceDataLine;
import javax.sound.sampled.TargetDataLine;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Ton des Voice Chats: ein Thread nimmt das Mikrofon auf (20-ms-Rahmen, 48 kHz mono), filtert tiefes Brummen und leises
 * Rauschen weg, entscheidet über Push-to-Talk bzw. Sprachaktivierung, kodiert mit Opus und schickt die Rahmen über den
 * Sprachkanal; ein zweiter Thread dekodiert die Rahmen der anderen (kleiner Puffer gegen Schwankungen, Lücken überbrückt
 * Opus), mischt sie nach Abstand und Richtung in Stereo (die eigene Gruppe ohne Abstand), mischt Signaltöne dazu und
 * spielt alles ab. Beide laufen nur, solange das Modul an und der Kanal verbunden ist (oder der Test läuft).
 */
final class VoiceEngine {
	static final int RATE = 48_000;
	/** 20 ms */
	static final int FRAME = 960;
	/** Rahmen im Puffer, bevor ein Sprecher zu hören ist (60 ms gegen Schwankungen im Netz) */
	private static final int PREFILL = 3;
	private static final int MAX_QUEUE = 25;
	/** Ab hier leiser werdend; am Rand der Reichweite still */
	private static final double FULL_VOLUME_DISTANCE = 4;
	/** Tiefpass-Grenze des Brummfilters (Hochpass) in Hz */
	private static final double HIGH_PASS_HZ = 90;

	/** Einstellungen (vom Haupt-Thread gesetzt, von den Ton-Threads gelesen) */
	record Settings(boolean pushToTalk, double thresholdDb, int device, double micGain, double volume, boolean stereo, boolean muted,
			boolean deafened, boolean test, boolean noiseFilter, boolean tones) {
	}

	/** Lage eines anderen Spielers von dir aus */
	record Position(double distance, float direction, String name) {
	}

	/** Signaltöne (nur bei dir zu hören) */
	enum Cue {
		TALK_START(620, 880, 70),
		TALK_STOP(880, 620, 70),
		MUTE(520, 330, 110),
		UNMUTE(330, 520, 110);

		final double from;
		final double to;
		final int millis;

		Cue(double from, double to, int millis) {
			this.from = from;
			this.to = to;
			this.millis = millis;
		}
	}

	/** Woher der Ton kommt (Mikrofon oder Testton) */
	interface Source extends AutoCloseable {
		/** einen Rahmen lesen (wartet etwa 20 ms); false = nichts da */
		boolean read(short[] pcm);

		@Override
		void close();
	}

	/** Wohin der Ton geht (Lautsprecher oder nirgends) */
	interface Sink extends AutoCloseable {
		void write(byte[] stereo);

		@Override
		void close();
	}

	private final VoiceChatAddon addon;
	private final VoiceChannel channel;
	private final HeldixLogger log;
	private final Map<UUID, Stream> streams = new ConcurrentHashMap<>();
	private final ConcurrentLinkedQueue<byte[]> loopback = new ConcurrentLinkedQueue<>();
	private final ConcurrentLinkedQueue<short[]> cues = new ConcurrentLinkedQueue<>();

	private volatile Settings settings = new Settings(true, -40, 0, 1, 1, true, false, false, false, true, true);
	private volatile Map<UUID, Position> positions = Map.of();
	private volatile Set<UUID> group = Set.of();
	private volatile int range = 48;
	private volatile boolean running;
	private volatile float level;
	private volatile boolean transmitting;
	private volatile String micProblem;
	private volatile String speakerProblem;
	private volatile int framesSent;
	private volatile int framesPlayed;
	private volatile int cuesPlayed;
	private Thread capture;
	private Thread playback;

	VoiceEngine(VoiceChatAddon addon, VoiceChannel channel, HeldixLogger log) {
		this.addon = addon;
		this.channel = channel;
		this.log = log;
	}

	// ======================================================================================
	// Steuerung (Haupt-Thread)
	// ======================================================================================

	void update(Settings settings, Map<UUID, Position> positions, Set<UUID> group, boolean run, int range) {
		this.settings = settings;
		this.positions = positions;
		this.group = group;
		this.range = Math.max(8, range);
		if (run && !running) start();
		else if (!run && running) stop();
	}

	private void start() {
		running = true;
		capture = new Thread(this::captureLoop, "Voice Chat – Mikrofon");
		playback = new Thread(this::playbackLoop, "Voice Chat – Wiedergabe");
		capture.setDaemon(true);
		playback.setDaemon(true);
		capture.start();
		playback.start();
	}

	void stop() {
		running = false;
		if (capture != null) capture.interrupt();
		if (playback != null) playback.interrupt();
		capture = null;
		playback = null;
		streams.clear();
		loopback.clear();
		cues.clear();
		transmitting = false;
		level = 0;
	}

	boolean running() {
		return running;
	}

	/** Pegel des Mikrofons (0–1) für die Anzeige */
	float level() {
		return level;
	}

	boolean transmitting() {
		return transmitting;
	}

	/** Problem mit Mikrofon oder Lautsprecher für die Anzeige, sonst null */
	String problem() {
		return micProblem != null ? micProblem : speakerProblem;
	}

	int framesSent() {
		return framesSent;
	}

	int framesPlayed() {
		return framesPlayed;
	}

	int cuesPlayed() {
		return cuesPlayed;
	}

	/** Signalton abspielen (wenn die Signaltöne an sind und der Ton läuft) */
	void cue(Cue cue) {
		if (!running || !settings.tones() || cues.size() > 4) return;
		cues.add(tone(cue));
	}

	/** Wer gerade spricht (zuletzt vor höchstens 250 ms ein Rahmen) */
	List<UUID> speaking() {
		long now = System.currentTimeMillis();
		List<UUID> list = new ArrayList<>();
		for (Stream stream : streams.values()) if (stream.speakingUntil > now) list.add(stream.uuid);
		return list;
	}

	/** Lautstärke eines Sprechers gerade (0–1), 0 = still */
	float levelOf(UUID player) {
		Stream stream = streams.get(player);
		return stream == null || stream.speakingUntil <= System.currentTimeMillis() ? 0 : stream.level;
	}

	/** Empfangener Rahmen (Netzwerk-Thread) */
	void receive(UUID sender, int sequence, boolean last, byte[] frame) {
		if (!running) return;
		Settings current = settings;
		if (current.deafened() || addon.isMuted(sender)) return;
		streams.computeIfAbsent(sender, Stream::new).push(sequence, last, frame);
	}

	// ======================================================================================
	// Aufnahme
	// ======================================================================================

	private void captureLoop() {
		OpusEncoder encoder;
		try {
			encoder = new OpusEncoder(RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP);
			encoder.setBitrate(24_000);
			encoder.setComplexity(5);
			encoder.setSignalType(OpusSignal.OPUS_SIGNAL_VOICE);
			encoder.setUseInbandFEC(true);
			encoder.setPacketLossPercent(5);
		} catch (OpusException e) {
			log.error("Opus-Encoder nicht verfügbar", e);
			micProblem = "Opus nicht verfügbar";
			return;
		}
		short[] pcm = new short[FRAME];
		double[] samples = new double[FRAME];
		byte[] out = new byte[1024];
		HighPass highPass = new HighPass(HIGH_PASS_HZ);
		NoiseGate gate = new NoiseGate();
		int sequence = 0;
		long hangUntil = 0;
		boolean wasSending = false;
		Source source = null;
		int device = -1;
		while (running) {
			Settings current = settings;
			if (source == null || device != current.device()) {
				if (source != null) source.close();
				device = current.device();
				source = openSource(device);
				if (source == null) {
					sleep(2000);
					continue;
				}
			}
			if (!source.read(pcm)) {
				sleep(20);
				continue;
			}
			// Verstärkung, Brummfilter, Pegel
			double gain = current.micGain();
			double sum = 0;
			for (int i = 0; i < FRAME; i++) {
				double sample = pcm[i] * gain;
				if (current.noiseFilter()) sample = highPass.process(sample);
				samples[i] = sample;
				sum += sample * sample;
			}
			double rms = Math.sqrt(sum / FRAME) / Short.MAX_VALUE;
			double db = rms > 0 ? 20 * Math.log10(rms) : -100;
			// leises Rauschen zwischen den Worten dämpfen (nach dem Pegel, damit die Sprachaktivierung unbeeinflusst bleibt)
			if (current.noiseFilter()) gate.process(samples, db);
			for (int i = 0; i < FRAME; i++) pcm[i] = (short) Math.clamp(Math.round(samples[i]), Short.MIN_VALUE, Short.MAX_VALUE);
			level = (float) Math.clamp((db + 60) / 60, 0, 1);
			long now = System.currentTimeMillis();
			boolean voice;
			if (current.pushToTalk()) {
				voice = addon.pushToTalkDown();
			} else {
				if (db > current.thresholdDb()) hangUntil = now + 300;
				voice = now < hangUntil;
			}
			boolean send = voice && !current.muted() && !current.deafened();
			if (current.pushToTalk() && send != wasSending && !current.test()) cue(send ? Cue.TALK_START : Cue.TALK_STOP);
			if (send || wasSending) {
				try {
					int length = encoder.encode(pcm, 0, FRAME, out, 0, out.length);
					byte[] frame = Arrays.copyOf(out, length);
					if (current.test()) {
						if (loopback.size() < MAX_QUEUE) loopback.add(frame);
					} else if (channel.send(frame, sequence, !send)) {
						framesSent++;
					}
					sequence = (sequence + 1) & 0xFFFF;
				} catch (OpusException e) {
					log.warn("Opus: Rahmen nicht kodiert (" + e.getMessage() + ")");
				}
			}
			transmitting = send;
			wasSending = send;
		}
		if (source != null) source.close();
		transmitting = false;
	}

	/** Hochpass 2. Ordnung (Butterworth): nimmt Brummen, Trittschall und Wind unter etwa 90 Hz weg */
	private static final class HighPass {
		private final double b0;
		private final double b1;
		private final double b2;
		private final double a1;
		private final double a2;
		private double x1;
		private double x2;
		private double y1;
		private double y2;

		HighPass(double cutoff) {
			double w0 = 2 * Math.PI * cutoff / RATE;
			double alpha = Math.sin(w0) / (2 * Math.sqrt(0.5));
			double cos = Math.cos(w0);
			double a0 = 1 + alpha;
			b0 = (1 + cos) / 2 / a0;
			b1 = -(1 + cos) / a0;
			b2 = (1 + cos) / 2 / a0;
			a1 = -2 * cos / a0;
			a2 = (1 - alpha) / a0;
		}

		double process(double x) {
			double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
			x2 = x1;
			x1 = x;
			y2 = y1;
			y1 = y;
			return y;
		}
	}

	/**
	 * Dämpft gleichmäßiges Rauschen (Lüfter, Tastatur aus der Ferne): merkt sich den Grundpegel (sinkt sofort, steigt
	 * langsam) und lässt nur durch, was deutlich lauter ist. Schnell auf, langsam zu, damit Wortenden nicht abreißen.
	 */
	private static final class NoiseGate {
		private static final double OPEN_ABOVE_FLOOR_DB = 9;
		private static final double CLOSED_GAIN = 0.2;
		private double floorDb = -60;
		private double gain = 1;
		private int hold;

		void process(double[] samples, double db) {
			if (db < floorDb) floorDb = db;
			else floorDb = Math.min(floorDb + 0.04, -25);
			boolean open = db > floorDb + OPEN_ABOVE_FLOOR_DB;
			if (open) hold = 10;
			else if (hold > 0) hold--;
			double target = open || hold > 0 ? 1 : CLOSED_GAIN;
			double step = target > gain ? (target - gain) / 48.0 : (target - gain) / 960.0;
			for (int i = 0; i < samples.length; i++) {
				if (Math.abs(target - gain) > Math.abs(step)) gain += step;
				else gain = target;
				samples[i] *= gain;
			}
		}
	}

	private Source openSource(int device) {
		if (Boolean.getBoolean("heldixclient.voicechat.testAudio")) {
			micProblem = null;
			return new TestTone();
		}
		try {
			AudioFormat format = new AudioFormat(RATE, 16, 1, true, false);
			DataLine.Info info = new DataLine.Info(TargetDataLine.class, format);
			Mixer.Info mixer = device > 0 ? VoiceChatAddon.microphone(device - 1) : null;
			TargetDataLine line = (TargetDataLine) (mixer != null ? AudioSystem.getMixer(mixer).getLine(info) : AudioSystem.getLine(info));
			line.open(format, FRAME * 2 * 6);
			line.start();
			micProblem = null;
			return new Microphone(line);
		} catch (Exception | LinkageError e) {
			if (micProblem == null) log.warn("Mikrofon nicht nutzbar: " + e);
			micProblem = "Kein Mikrofon nutzbar";
			return null;
		}
	}

	/** Mikrofon über javax.sound */
	private static final class Microphone implements Source {
		private final TargetDataLine line;
		private final byte[] bytes = new byte[FRAME * 2];

		Microphone(TargetDataLine line) {
			this.line = line;
		}

		@Override
		public boolean read(short[] pcm) {
			int read = 0;
			while (read < bytes.length) {
				int n = line.read(bytes, read, bytes.length - read);
				if (n <= 0) return false;
				read += n;
			}
			for (int i = 0; i < FRAME; i++) pcm[i] = (short) ((bytes[2 * i] & 0xFF) | (bytes[2 * i + 1] << 8));
			return true;
		}

		@Override
		public void close() {
			line.stop();
			line.close();
		}
	}

	/** Testton statt Mikrofon (für den Autotest: es wird nie das echte Mikrofon geöffnet) */
	private static final class TestTone implements Source {
		private long next = System.nanoTime();
		private int phase;

		@Override
		public boolean read(short[] pcm) {
			next += 20_000_000L;
			long wait = next - System.nanoTime();
			if (wait > 0) {
				try {
					Thread.sleep(wait / 1_000_000L, (int) (wait % 1_000_000L));
				} catch (InterruptedException e) {
					Thread.currentThread().interrupt();
					return false;
				}
			}
			for (int i = 0; i < FRAME; i++) {
				pcm[i] = (short) (Math.sin(2 * Math.PI * 440 * phase / RATE) * 8000);
				phase = (phase + 1) % RATE;
			}
			return true;
		}

		@Override
		public void close() {
		}
	}

	// ======================================================================================
	// Wiedergabe
	// ======================================================================================

	private void playbackLoop() {
		Sink sink = null;
		int[] mix = new int[FRAME * 2];
		short[] pcm = new short[FRAME];
		byte[] bytes = new byte[FRAME * 4];
		Stream self = new Stream(new UUID(0, 0));
		short[] cue = null;
		int cueAt = 0;
		while (running) {
			if (sink == null) {
				sink = openSink();
				if (sink == null) {
					sleep(2000);
					continue;
				}
			}
			Arrays.fill(mix, 0);
			Settings current = settings;
			Map<UUID, Position> where = positions;
			Set<UUID> members = group;
			long now = System.currentTimeMillis();
			boolean any = false;
			for (Stream stream : streams.values()) {
				if (!stream.next(pcm)) {
					// kurze Lücke im Netz: Anzeige nur langsam sinken lassen (ob jemand spricht, entscheidet speakingUntil)
					stream.level *= 0.9f;
					if (now - stream.lastPacketAt > 10_000) streams.remove(stream.uuid, stream);
					continue;
				}
				any = true;
				stream.level = Math.max(peak(pcm), stream.level * 0.82f);
				float gain = (float) (current.volume() * addon.volumeOf(stream.uuid));
				float pan = 0;
				Position position = where.get(stream.uuid);
				boolean inGroup = members.contains(stream.uuid);
				if (position != null) {
					// die eigene Gruppe überall gleich laut, nur die Richtung zählt
					if (!inGroup) gain *= (float) falloff(position.distance());
					if (current.stereo()) pan = (float) Math.sin(Math.toRadians(position.direction())) * (inGroup ? 0.6f : 1f);
					if (!inGroup && Math.abs(position.direction()) > 90) gain *= 0.85f;
				} else if (!inGroup) {
					// nicht in der geladenen Welt (z. B. unsichtbar oder gerade erst angekommen): leiser, in der Mitte
					gain *= 0.6f;
				}
				add(mix, pcm, gain, pan);
			}
			// Test: die eigenen Rahmen gleich wieder abspielen
			byte[] own = current.test() ? loopback.poll() : null;
			if (own != null) self.push(0, false, own);
			if (current.test() && self.next(pcm)) {
				any = true;
				add(mix, pcm, 1f, 0f);
			}
			// Signaltöne
			if (cue == null) {
				cue = cues.poll();
				cueAt = 0;
				if (cue != null) cuesPlayed++;
			}
			if (cue != null) {
				for (int i = 0; i < FRAME && cueAt < cue.length; i++, cueAt++) {
					mix[2 * i] += cue[cueAt];
					mix[2 * i + 1] += cue[cueAt];
				}
				if (cueAt >= cue.length) cue = null;
			}
			for (int i = 0; i < mix.length; i++) {
				int value = Math.clamp(mix[i], Short.MIN_VALUE, Short.MAX_VALUE);
				bytes[2 * i] = (byte) value;
				bytes[2 * i + 1] = (byte) (value >> 8);
			}
			if (any) framesPlayed++;
			sink.write(bytes);
		}
		if (sink != null) sink.close();
	}

	/** Lautheit eines Rahmens (0–1) für die Anzeige: Effektivwert in dB, -50 dB = 0, -10 dB = 1 */
	private static float peak(short[] pcm) {
		double sum = 0;
		for (short sample : pcm) sum += (double) sample * sample;
		double rms = Math.sqrt(sum / pcm.length) / Short.MAX_VALUE;
		double db = rms > 0 ? 20 * Math.log10(rms) : -100;
		return (float) Math.clamp((db + 50) / 40, 0, 1);
	}

	/** kurzer Gleitton mit weichem Ein- und Ausblenden */
	private static short[] tone(Cue cue) {
		int length = RATE * cue.millis / 1000;
		short[] out = new short[length];
		double phase = 0;
		int fade = Math.min(length / 3, RATE / 200);
		for (int i = 0; i < length; i++) {
			double t = (double) i / length;
			double frequency = cue.from + (cue.to - cue.from) * t;
			phase += 2 * Math.PI * frequency / RATE;
			double envelope = Math.min(1, Math.min(i, length - 1 - i) / (double) Math.max(1, fade));
			out[i] = (short) Math.round(Math.sin(phase) * 2600 * envelope);
		}
		return out;
	}

	private static void add(int[] mix, short[] pcm, float gain, float pan) {
		// gleich laute Mitte, nach links bzw. rechts verschoben (konstante Leistung)
		double angle = (pan + 1) * Math.PI / 4;
		float left = (float) (Math.cos(angle) * Math.sqrt(2)) * gain;
		float right = (float) (Math.sin(angle) * Math.sqrt(2)) * gain;
		for (int i = 0; i < FRAME; i++) {
			mix[2 * i] += Math.round(pcm[i] * left);
			mix[2 * i + 1] += Math.round(pcm[i] * right);
		}
	}

	/** Lautstärke nach Abstand: bis 4 Blöcke voll, am Rand der Reichweite still */
	private double falloff(double distance) {
		if (distance <= FULL_VOLUME_DISTANCE) return 1;
		if (distance >= range) return 0;
		double t = (distance - FULL_VOLUME_DISTANCE) / (range - FULL_VOLUME_DISTANCE);
		return Math.pow(1 - t, 1.6);
	}

	private Sink openSink() {
		if (Boolean.getBoolean("heldixclient.voicechat.testAudio")) {
			speakerProblem = null;
			return new Sink() {
				private long next = System.nanoTime();

				@Override
				public void write(byte[] stereo) {
					next += 20_000_000L;
					long wait = next - System.nanoTime();
					if (wait > 0) sleep(wait / 1_000_000L);
				}

				@Override
				public void close() {
				}
			};
		}
		try {
			AudioFormat format = new AudioFormat(RATE, 16, 2, true, false);
			SourceDataLine line = AudioSystem.getSourceDataLine(format);
			line.open(format, FRAME * 4 * 4);
			line.start();
			speakerProblem = null;
			return new Sink() {
				@Override
				public void write(byte[] stereo) {
					line.write(stereo, 0, stereo.length);
				}

				@Override
				public void close() {
					line.stop();
					line.close();
				}
			};
		} catch (Exception | LinkageError e) {
			if (speakerProblem == null) log.warn("Lautsprecher nicht nutzbar: " + e);
			speakerProblem = "Keine Tonausgabe nutzbar";
			return null;
		}
	}

	private static void sleep(long millis) {
		try {
			Thread.sleep(Math.max(1, millis));
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}

	// ======================================================================================
	// Ein Sprecher: Puffer und Opus-Decoder
	// ======================================================================================

	private record Packet(int sequence, boolean last, byte[] data) {
	}

	private static final class Stream {
		private final UUID uuid;
		private final ArrayDeque<Packet> queue = new ArrayDeque<>();
		private OpusDecoder decoder;
		private boolean buffering = true;
		/** so viele fehlende Rahmen noch mit Opus überbrücken */
		private int concealLeft;
		private volatile long lastPacketAt = System.currentTimeMillis();
		private volatile long speakingUntil;
		/** Lautheit für Anzeige und Symbol (nur der Wiedergabe-Thread schreibt) */
		private volatile float level;

		Stream(UUID uuid) {
			this.uuid = uuid;
		}

		synchronized void push(int sequence, boolean last, byte[] data) {
			if (queue.size() >= MAX_QUEUE) queue.pollFirst();
			queue.addLast(new Packet(sequence, last, data));
			long now = System.currentTimeMillis();
			lastPacketAt = now;
			speakingUntil = last ? now : now + 250;
		}

		/** nächster Rahmen als PCM; false = gerade nichts zu hören */
		synchronized boolean next(short[] pcm) {
			try {
				if (decoder == null) decoder = new OpusDecoder(RATE, 1);
				if (buffering) {
					boolean ends = queue.stream().anyMatch(Packet::last);
					if (queue.size() < PREFILL && !ends) return false;
					buffering = false;
				}
				Packet packet = queue.pollFirst();
				if (packet == null) {
					if (concealLeft > 0) {
						concealLeft--;
						decoder.decode(null, 0, 0, pcm, 0, FRAME, false);
						return true;
					}
					buffering = true;
					return false;
				}
				int samples = decoder.decode(packet.data(), 0, packet.data().length, pcm, 0, FRAME, false);
				if (samples < FRAME) Arrays.fill(pcm, Math.max(0, samples), FRAME, (short) 0);
				if (packet.last()) {
					buffering = true;
					concealLeft = 0;
				} else {
					concealLeft = 3;
				}
				return true;
			} catch (OpusException | RuntimeException e) {
				// kaputter Rahmen: auslassen
				return false;
			}
		}
	}

	/** Für Tests: aktuelle Sprecher-Puffer */
	Set<UUID> streamIds() {
		return Set.copyOf(streams.keySet());
	}
}
