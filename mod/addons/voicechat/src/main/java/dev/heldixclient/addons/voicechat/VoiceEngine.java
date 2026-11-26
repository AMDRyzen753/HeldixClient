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
 * Ton des Voice Chats: ein Thread nimmt das Mikrofon auf (20-ms-Rahmen, 48 kHz mono), entscheidet über Push-to-Talk bzw.
 * Sprachaktivierung, kodiert mit Opus und schickt die Rahmen über den Sprachkanal; ein zweiter Thread dekodiert die
 * Rahmen der anderen (kleiner Puffer gegen Schwankungen, Lücken überbrückt Opus), mischt sie nach Abstand und Richtung in
 * Stereo und spielt sie ab. Beide laufen nur, solange das Modul an und der Kanal verbunden ist (oder der Test läuft).
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

	/** Einstellungen (vom Haupt-Thread gesetzt, von den Ton-Threads gelesen) */
	record Settings(boolean pushToTalk, double thresholdDb, int device, double micGain, double volume, boolean stereo, boolean muted,
			boolean deafened, boolean test) {
	}

	/** Lage eines anderen Spielers von dir aus */
	record Position(double distance, float direction, String name) {
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

	private volatile Settings settings = new Settings(true, -40, 0, 1, 1, true, false, false, false);
	private volatile Map<UUID, Position> positions = Map.of();
	private volatile int range = 48;
	private volatile boolean running;
	private volatile float level;
	private volatile boolean transmitting;
	private volatile String micProblem;
	private volatile String speakerProblem;
	private volatile int framesSent;
	private volatile int framesPlayed;
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

	void update(Settings settings, Map<UUID, Position> positions, boolean run, int range) {
		this.settings = settings;
		this.positions = positions;
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

	/** Wer gerade spricht (zuletzt vor höchstens 250 ms ein Rahmen) */
	List<UUID> speaking() {
		long now = System.currentTimeMillis();
		List<UUID> list = new ArrayList<>();
		for (Stream stream : streams.values()) if (stream.speakingUntil > now) list.add(stream.uuid);
		return list;
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
		byte[] out = new byte[1024];
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
			// Verstärkung und Pegel
			double sum = 0;
			double gain = current.micGain();
			for (int i = 0; i < FRAME; i++) {
				int sample = (int) Math.round(pcm[i] * gain);
				sample = Math.clamp(sample, Short.MIN_VALUE, Short.MAX_VALUE);
				pcm[i] = (short) sample;
				sum += (double) sample * sample;
			}
			double rms = Math.sqrt(sum / FRAME) / Short.MAX_VALUE;
			double db = rms > 0 ? 20 * Math.log10(rms) : -100;
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
			long now = System.currentTimeMillis();
			boolean any = false;
			for (Stream stream : streams.values()) {
				if (!stream.next(pcm)) {
					if (now - stream.lastPacketAt > 10_000) streams.remove(stream.uuid, stream);
					continue;
				}
				any = true;
				float gain = (float) (current.volume() * addon.volumeOf(stream.uuid));
				float pan = 0;
				Position position = where.get(stream.uuid);
				if (position != null) {
					gain *= (float) falloff(position.distance());
					if (current.stereo()) pan = (float) Math.sin(Math.toRadians(position.direction()));
					if (Math.abs(position.direction()) > 90) gain *= 0.85f;
				} else {
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
