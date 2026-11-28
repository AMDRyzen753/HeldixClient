package dev.heldixclient.voice;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Aufnahme für eine Voice-Meldung als Ogg/Opus-Datei („Clip-Format“ des Heldix-Dienstes 1.13.0): ein logischer Strom mit
 * {@code OpusHead} (Version 1, 1 Kanal, Pre-Skip 0, 48000 Hz, Gain 0, Mapping 0), {@code OpusTags} (Hersteller
 * „HeldixClient“, {@code HELDIX_SPEAKER}, {@code HELDIX_START}, {@code HELDIX_SEGMENTS}) und danach nur den empfangenen
 * 20-ms-Paketen des gemeldeten Sprechers, Granule-Position +960 je Paket. Lücken in einem Satz (verlorene Pakete) und
 * Pausen zwischen Sätzen füllen Stille-Pakete ({@code F8 FF FE}); Pausen länger als 1 s werden auf 1 s gekürzt. Höchstens
 * 10 Minuten und 3 MiB – zu viel wird vorne (das Älteste) gekürzt. Ogg-Seiten mit CRC-32 nach RFC 3533 (Polynom 0x04C11DB7,
 * nicht gespiegelt, Startwert 0). Läuft ohne Minecraft und schreibt nichts auf die Festplatte.
 */
public final class OggOpus {
	/** 20 ms bei 48 kHz */
	public static final int PACKET_SAMPLES = 960;
	public static final int PACKET_MS = 20;
	public static final long MAX_MS = 600_000;
	public static final int MAX_BYTES = 3 * 1024 * 1024;
	/** Stille für 20 ms (CELT, mono, ein Rahmen) */
	static final byte[] SILENCE = {(byte) 0xF8, (byte) 0xFF, (byte) 0xFE};
	/** längere Pausen zwischen Sätzen werden auf so viel gekürzt */
	private static final long MAX_PAUSE_MS = 1000;
	/** höchstens so viele Einträge in HELDIX_SEGMENTS */
	private static final int MAX_SEGMENTS = 600;
	/** Pakete je Ogg-Seite (1 s) */
	private static final int PACKETS_PER_PAGE = 50;
	private static final int SERIAL = 0x48454C44;
	private static final int[] CRC_TABLE = new int[256];

	static {
		for (int i = 0; i < 256; i++) {
			int r = i << 24;
			for (int j = 0; j < 8; j++) r = (r & 0x80000000) != 0 ? (r << 1) ^ 0x04C11DB7 : r << 1;
			CRC_TABLE[i] = r;
		}
	}

	/** Ein empfangenes Paket des Sprechers (Empfangszeit in ms, Folgenummer, Satzende, Opus-Daten) */
	public record Packet(long receivedAt, int sequence, boolean last, byte[] data) {
	}

	/** Fertige Datei: Inhalt, Spieldauer, Zeitpunkt der ersten Aufnahme und Anzahl der Sätze */
	public record Clip(byte[] bytes, long durationMs, long startAt, int segments) {
	}

	private OggOpus() {
	}

	/**
	 * Baut die Datei aus den Paketen des gemeldeten Sprechers (älteste zuerst). Pakete, die nicht genau 20 ms lang sind,
	 * fallen weg. null, wenn nichts übrig bleibt.
	 *
	 * @param speaker  32 Hex-Zeichen (HELDIX_SPEAKER)
	 * @param maxMs    höchstens so lang (Dienst: clip.maxMs), wird auf 10 Minuten begrenzt
	 * @param maxBytes höchstens so groß (Dienst: clip.maxBytes), wird auf 3 MiB begrenzt
	 */
	public static Clip build(String speaker, List<Packet> packets, long maxMs, int maxBytes) {
		long limitMs = Math.clamp(maxMs <= 0 ? MAX_MS : maxMs, PACKET_MS, MAX_MS);
		int limitBytes = Math.clamp(maxBytes <= 0 ? MAX_BYTES : maxBytes, 1024, MAX_BYTES);
		List<Packet> usable = new ArrayList<>();
		for (Packet packet : packets) {
			if (packet != null && packet.data() != null && packet.data().length > 0 && packet.data().length <= 1275
					&& samples(packet.data()) == PACKET_SAMPLES) usable.add(packet);
		}
		int from = 0;
		for (int round = 0; round < 12 && from < usable.size(); round++) {
			Plan plan = plan(usable.subList(from, usable.size()));
			long overMs = plan.durationMs() - limitMs;
			if (overMs > 0) {
				// zu lang: so viele Schritte vorne weg (Stille zählt mit, deshalb neu planen)
				from += Math.max(1, plan.packetsBefore((int) Math.ceil(overMs / (double) PACKET_MS)));
				continue;
			}
			byte[] bytes = write(speaker, plan);
			if (bytes.length <= limitBytes) return new Clip(bytes, plan.durationMs(), plan.startAt(), plan.segments().size());
			// zu groß: anteilig vorne kürzen (mit etwas Reserve für Seiten und Tags)
			double share = (bytes.length - limitBytes) / (double) bytes.length;
			from += Math.max(1, (int) Math.ceil((usable.size() - from) * share * 1.02) + 1);
		}
		return null;
	}

	// ======================================================================================
	// Planen: Pakete, Stille und Sätze
	// ======================================================================================

	/** Reihenfolge der Pakete im Clip (null = Stille) mit Satzanfängen „ms im Clip@ms Echtzeit“ */
	private record Plan(List<byte[]> slots, List<Integer> sources, List<long[]> segments, long startAt) {
		long durationMs() {
			return (long) slots.size() * PACKET_MS;
		}

		/** wie viele echte Pakete stehen in den ersten {@code steps} Schritten? */
		int packetsBefore(int steps) {
			int count = 0;
			for (int i = 0; i < Math.min(steps, sources.size()); i++) if (sources.get(i) >= 0) count++;
			return count;
		}
	}

	private static Plan plan(List<Packet> packets) {
		List<byte[]> slots = new ArrayList<>();
		List<Integer> sources = new ArrayList<>();
		List<long[]> segments = new ArrayList<>();
		Packet previous = null;
		for (int i = 0; i < packets.size(); i++) {
			Packet packet = packets.get(i);
			if (previous == null) {
				segments.add(new long[] {0, packet.receivedAt()});
			} else {
				int step = (packet.sequence() - previous.sequence()) & 0xFFFF;
				long gap = packet.receivedAt() - previous.receivedAt();
				boolean sameSentence = !previous.last() && step >= 1 && step <= 50 && gap < 1500;
				long silence;
				if (sameSentence) {
					// verlorene Pakete im Satz durch Stille ersetzen
					silence = step - 1L;
				} else {
					long pauseMs = Math.clamp(gap - PACKET_MS, 0, MAX_PAUSE_MS);
					silence = pauseMs / PACKET_MS;
				}
				for (long s = 0; s < silence; s++) {
					slots.add(SILENCE);
					sources.add(-1);
				}
				if (!sameSentence) segments.add(new long[] {(long) slots.size() * PACKET_MS, packet.receivedAt()});
			}
			slots.add(packet.data());
			sources.add(i);
			previous = packet;
		}
		if (segments.size() > MAX_SEGMENTS) {
			// der erste Eintrag (0@HELDIX_START) bleibt, sonst die neuesten
			List<long[]> kept = new ArrayList<>(MAX_SEGMENTS);
			kept.add(segments.getFirst());
			kept.addAll(segments.subList(segments.size() - (MAX_SEGMENTS - 1), segments.size()));
			segments = kept;
		}
		return new Plan(slots, sources, segments, packets.isEmpty() ? 0 : packets.getFirst().receivedAt());
	}

	// ======================================================================================
	// Schreiben: Ogg-Seiten
	// ======================================================================================

	private static byte[] write(String speaker, Plan plan) {
		ByteArrayOutputStream out = new ByteArrayOutputStream(plan.slots().size() * 70 + 4096);
		int page = 0;
		writePage(out, List.of(opusHead()), 0, page++, 0x02);
		writePage(out, List.of(opusTags(speaker, plan)), 0, page++, 0x00);
		List<byte[]> slots = plan.slots();
		long granule = 0;
		int start = 0;
		while (start < slots.size()) {
			// bis zu 50 Pakete je Seite, aber höchstens 255 Lacing-Werte
			int end = start;
			int lacing = 0;
			while (end < slots.size() && end - start < PACKETS_PER_PAGE && lacing + slots.get(end).length / 255 + 1 <= 255) {
				lacing += slots.get(end).length / 255 + 1;
				end++;
			}
			granule += (long) (end - start) * PACKET_SAMPLES;
			writePage(out, slots.subList(start, end), granule, page++, end == slots.size() ? 0x04 : 0x00);
			start = end;
		}
		return out.toByteArray();
	}

	/** Eine Ogg-Seite mit ganzen Paketen (Lacing-Werte je Paket: 255er-Blöcke, dann der Rest) */
	private static void writePage(ByteArrayOutputStream out, List<byte[]> packets, long granule, int sequence, int flags) {
		ByteArrayOutputStream lacing = new ByteArrayOutputStream();
		int bodyLength = 0;
		for (byte[] packet : packets) {
			int left = packet.length;
			while (left >= 255) {
				lacing.write(255);
				left -= 255;
			}
			lacing.write(left);
			bodyLength += packet.length;
		}
		byte[] lace = lacing.toByteArray();
		if (lace.length > 255) throw new IllegalArgumentException("Ogg-Seite zu voll");
		byte[] pageBytes = new byte[27 + lace.length + bodyLength];
		pageBytes[0] = 'O';
		pageBytes[1] = 'g';
		pageBytes[2] = 'g';
		pageBytes[3] = 'S';
		pageBytes[4] = 0;
		pageBytes[5] = (byte) flags;
		putLong(pageBytes, 6, granule);
		putInt(pageBytes, 14, SERIAL);
		putInt(pageBytes, 18, sequence);
		// 22..25: CRC, zuerst 0
		pageBytes[26] = (byte) lace.length;
		System.arraycopy(lace, 0, pageBytes, 27, lace.length);
		int at = 27 + lace.length;
		for (byte[] packet : packets) {
			System.arraycopy(packet, 0, pageBytes, at, packet.length);
			at += packet.length;
		}
		putInt(pageBytes, 22, crc(pageBytes));
		out.writeBytes(pageBytes);
	}

	private static byte[] opusHead() {
		byte[] head = new byte[19];
		System.arraycopy("OpusHead".getBytes(StandardCharsets.US_ASCII), 0, head, 0, 8);
		head[8] = 1; // Version
		head[9] = 1; // Kanäle
		// 10..11 Pre-Skip 0
		putInt(head, 12, 48_000);
		// 16..17 Gain 0, 18 Mapping 0
		return head;
	}

	private static byte[] opusTags(String speaker, Plan plan) {
		List<String> comments = new ArrayList<>();
		comments.add("HELDIX_SPEAKER=" + speaker);
		comments.add("HELDIX_START=" + plan.startAt());
		StringBuilder segments = new StringBuilder("HELDIX_SEGMENTS=");
		for (int i = 0; i < plan.segments().size(); i++) {
			long[] segment = plan.segments().get(i);
			if (i > 0) segments.append(',');
			segments.append(segment[0]).append('@').append(segment[1]);
		}
		comments.add(segments.toString());
		ByteArrayOutputStream tags = new ByteArrayOutputStream();
		tags.writeBytes("OpusTags".getBytes(StandardCharsets.US_ASCII));
		byte[] vendor = "HeldixClient".getBytes(StandardCharsets.UTF_8);
		writeInt(tags, vendor.length);
		tags.writeBytes(vendor);
		writeInt(tags, comments.size());
		for (String comment : comments) {
			byte[] bytes = comment.getBytes(StandardCharsets.UTF_8);
			writeInt(tags, bytes.length);
			tags.writeBytes(bytes);
		}
		return tags.toByteArray();
	}

	/** Samples (48 kHz) eines Opus-Pakets aus dem TOC-Byte (RFC 6716, 3.1), -1 = kaputt */
	static int samples(byte[] packet) {
		if (packet.length == 0) return -1;
		int toc = packet[0] & 0xFF;
		int config = toc >> 3;
		int frame;
		if (config < 12) frame = new int[] {480, 960, 1920, 2880}[config & 3];
		else if (config < 16) frame = (config & 1) == 0 ? 480 : 960;
		else frame = new int[] {120, 240, 480, 960}[config & 3];
		int frames = switch (toc & 3) {
			case 0 -> 1;
			case 1, 2 -> 2;
			default -> packet.length < 2 ? -1 : packet[1] & 0x3F;
		};
		return frames <= 0 ? -1 : frame * frames;
	}

	/** CRC-32 einer Ogg-Seite (Feld für die Prüfsumme muss 0 sein) */
	static int crc(byte[] data) {
		int crc = 0;
		for (byte b : data) crc = (crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ (b & 0xFF)) & 0xFF];
		return crc;
	}

	private static void putInt(byte[] target, int at, int value) {
		target[at] = (byte) value;
		target[at + 1] = (byte) (value >>> 8);
		target[at + 2] = (byte) (value >>> 16);
		target[at + 3] = (byte) (value >>> 24);
	}

	private static void putLong(byte[] target, int at, long value) {
		for (int i = 0; i < 8; i++) target[at + i] = (byte) (value >>> (8 * i));
	}

	private static void writeInt(ByteArrayOutputStream out, int value) {
		out.write(value);
		out.write(value >>> 8);
		out.write(value >>> 16);
		out.write(value >>> 24);
	}
}
