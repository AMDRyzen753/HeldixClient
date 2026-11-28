package dev.heldixclient.addons.voicechat;

import dev.heldixclient.api.VoiceChannel;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ringpuffer der empfangenen Opus-Pakete je Sprecher für Meldungen (ab 1.3.0) – nur im Arbeitsspeicher, nie auf der
 * Festplatte, nie die eigene Stimme, und nur solange Aufnahmen aktiv sind ({@link VoiceChannel#clipsActive()}). Grenzen: je
 * Sprecher höchstens 10 Minuten (nach Empfangszeit) und 3 MiB, höchstens 32 Sprecher und 48 MiB zusammen. Was nicht passt,
 * verdrängt zuerst das Älteste des Sprechers bzw. den Sprecher, der am längsten nicht mehr zu hören war. Threadsicher
 * (Netzwerk-Thread schreibt, Haupt-Thread liest).
 */
final class ClipBuffer {
	static final long MAX_AGE_MS = 600_000;
	static final long MAX_SPEAKER_BYTES = 3L * 1024 * 1024;
	static final int MAX_SPEAKERS = 32;
	static final long MAX_TOTAL_BYTES = 48L * 1024 * 1024;
	/** Verwaltung je Paket (grob), zählt zu den Grenzen dazu */
	static final int OVERHEAD = 32;
	private static final int MAX_PACKET = 4096;

	private static final class Speaker {
		final ArrayDeque<VoiceChannel.ReceivedPacket> packets = new ArrayDeque<>();
		long bytes;
		long lastHeard;
	}

	private final Map<UUID, Speaker> speakers = new HashMap<>();
	private long totalBytes;

	/** Ein empfangenes Paket merken (Netzwerk-Thread); {@code data} wird nicht verändert */
	synchronized void add(UUID sender, long now, int sequence, boolean last, byte[] data) {
		if (sender == null || data == null || data.length == 0 || data.length > MAX_PACKET) return;
		Speaker speaker = speakers.get(sender);
		if (speaker == null) {
			while (speakers.size() >= MAX_SPEAKERS) evictQuietest(null);
			speaker = new Speaker();
			speakers.put(sender, speaker);
		}
		speaker.packets.addLast(new VoiceChannel.ReceivedPacket(now, sequence & 0xFFFF, last, data));
		long size = (long) data.length + OVERHEAD;
		speaker.bytes += size;
		totalBytes += size;
		speaker.lastHeard = now;
		trim(speaker, now);
		while (totalBytes > MAX_TOTAL_BYTES && speakers.size() > 1) evictQuietest(sender);
	}

	/** Zu alte bzw. zu viele Pakete vorne weg */
	private void trim(Speaker speaker, long now) {
		while (!speaker.packets.isEmpty() && (speaker.bytes > MAX_SPEAKER_BYTES || now - speaker.packets.peekFirst().receivedAt() > MAX_AGE_MS)) {
			VoiceChannel.ReceivedPacket first = speaker.packets.pollFirst();
			long size = (long) first.data().length + OVERHEAD;
			speaker.bytes -= size;
			totalBytes -= size;
		}
	}

	/** Den Sprecher verdrängen, der am längsten nicht zu hören war (außer {@code keep}) */
	private void evictQuietest(UUID keep) {
		UUID quietest = null;
		long oldest = Long.MAX_VALUE;
		for (Map.Entry<UUID, Speaker> entry : speakers.entrySet()) {
			if (entry.getKey().equals(keep)) continue;
			if (entry.getValue().lastHeard < oldest) {
				oldest = entry.getValue().lastHeard;
				quietest = entry.getKey();
			}
		}
		if (quietest == null) return;
		totalBytes -= speakers.remove(quietest).bytes;
	}

	/** Kopie der Pakete eines Sprechers, älteste zuerst (für die Meldung) */
	synchronized List<VoiceChannel.ReceivedPacket> snapshot(UUID speaker, long now) {
		Speaker entry = speakers.get(speaker);
		if (entry == null) return List.of();
		trim(entry, now);
		return List.copyOf(entry.packets);
	}

	/** gepufferte Zeit eines Sprechers in ms (20 ms je Paket) */
	synchronized long bufferedMillis(UUID speaker, long now) {
		Speaker entry = speakers.get(speaker);
		if (entry == null) return 0;
		trim(entry, now);
		return entry.packets.size() * 20L;
	}

	/** Alte Pakete aller Sprecher wegwerfen, leere Sprecher vergessen (jeden Tick) */
	synchronized void expire(long now) {
		speakers.values().forEach(speaker -> trim(speaker, now));
		speakers.values().removeIf(speaker -> speaker.packets.isEmpty());
	}

	synchronized void clear() {
		speakers.clear();
		totalBytes = 0;
	}

	synchronized boolean isEmpty() {
		return speakers.isEmpty();
	}

	synchronized int speakerCount() {
		return speakers.size();
	}

	synchronized long totalBytes() {
		return totalBytes;
	}

	synchronized long bytesOf(UUID speaker) {
		Speaker entry = speakers.get(speaker);
		return entry == null ? 0 : entry.bytes;
	}

	synchronized boolean contains(UUID speaker) {
		return speakers.containsKey(speaker);
	}
}
