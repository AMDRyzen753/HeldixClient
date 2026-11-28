package dev.heldixclient.voice;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import dev.heldixclient.api.NearbyPlayer;
import dev.heldixclient.api.VoiceChannel;
import dev.heldixclient.hud.Notifications;
import dev.heldixclient.player.NearbyPlayers;
import dev.heldixclient.social.Social;
import net.minecraft.client.Minecraft;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * Voice-Meldungen (Heldix-Dienst 1.13.0): baut aus dem Melde-Dialog die Meldung mit Kontext (Server, Dimension, Zeitpunkt,
 * Gruppe, wer in Hörweite war) und Lautstärke-Verlauf, schickt sie mit {@code POST /v1/voice/reports} und lädt – nur wenn
 * der Dienst es erlaubt ({@code clip} in der Antwort), Aufnahmen aktiv sind und der Spieler zugestimmt hat – die Pakete des
 * Gemeldeten als Ogg/Opus mit {@code PUT /v1/voice/reports/<id>/clip} hoch ({@link OggOpus}). Die Pakete liegen dabei nur
 * im Arbeitsspeicher und werden nie geloggt.
 */
public final class VoiceReports {
	/** Gründe: Schlüssel für den Dienst → Anzeige */
	public static final Map<String, String> REASONS;
	public static final int NOTE_MAX = 300;
	private static final int MAX_NEARBY = 20;
	private static final int MAX_LEVELS = 600;
	private static final int MAX_PACKETS = 40_000;

	static {
		Map<String, String> reasons = new LinkedHashMap<>();
		reasons.put("insult", "Beleidigung");
		reasons.put("harassment", "Belästigung");
		reasons.put("hate", "Hassrede");
		reasons.put("noise", "Anschreien/Lärm");
		reasons.put("other", "Sonstiges");
		REASONS = java.util.Collections.unmodifiableMap(reasons);
	}

	/**
	 * Eine geöffnete Meldung: wer gemeldet wird, wessen Addon die Anhänge liefert, wohin das Ergebnis geht und wohin Fehler
	 * im Addon gemeldet werden.
	 */
	public record Request(String owner, UUID target, String name, VoiceChannel.ReportAttachments attachments, Consumer<String> onResult,
			BiConsumer<String, Throwable> addonError) {
		/** gepufferte Millisekunden (für den Hinweis im Dialog), Fehler im Addon zählen als Addon-Fehler */
		long bufferedMillis() {
			if (attachments == null) return 0;
			try {
				return Math.max(0, attachments.bufferedMillis(target));
			} catch (Throwable t) {
				addonError.accept("bufferedMillis", t);
				return 0;
			}
		}
	}

	/** Ergebnis der letzten Meldung (für den Autotest): Nummer, Aufnahme hochgeladen, ihre Länge und Größe, Text, HTTP-Status bei Fehlern */
	public record Result(long id, boolean clip, long clipMs, long clipBytes, String message, int status) {
	}

	private static volatile Result last;

	private VoiceReports() {
	}

	/** Nur für den Autotest: Ergebnis der letzten Meldung, sonst null */
	public static Result lastResult() {
		return last;
	}

	/**
	 * Meldung abschicken (Haupt-Thread, Knopf „Melden“ im Dialog). {@code done} bekommt im Haupt-Thread den Text für den
	 * Spieler, sobald alles durch ist (auch bei Fehlern).
	 */
	static void submit(Request request, String reason, String note, boolean withClip, Consumer<String> done) {
		Minecraft minecraft = Minecraft.getInstance();
		boolean includeClip = withClip && VoiceModeration.clipsActive();
		VoiceChannel.ReportData data = null;
		if (request.attachments() != null) {
			try {
				data = request.attachments().collect(request.target(), includeClip);
			} catch (Throwable t) {
				request.addonError().accept("collect", t);
			}
		}
		JsonObject body = body(minecraft, request.target(), reason, note, data);
		List<OggOpus.Packet> packets = includeClip && data != null ? packets(data.packets()) : List.of();
		Social.request("POST", "/v1/voice/reports", body, true)
				.thenComposeAsync(json -> afterReport(json, request.target(), packets))
				.whenComplete((result, error) -> minecraft.execute(() -> {
					Result outcome = result;
					if (error != null) {
						Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
						String why = cause instanceof Social.ServiceException && cause.getMessage() != null ? cause.getMessage() : "Dienst nicht erreichbar";
						outcome = new Result(0, false, 0, 0, "Meldung nicht gesendet: " + why, cause instanceof Social.ServiceException service ? service.status() : 0);
					}
					last = outcome;
					Notifications.show("heldix-voice-report", "Voice-Meldung", outcome.message(), null);
					done.accept(outcome.message());
					request.onResult().accept(outcome.message());
				}));
	}

	/** Antwort auf die Meldung: ggf. die Aufnahme bauen und hochladen */
	private static CompletableFuture<Result> afterReport(JsonElement json, UUID target, List<OggOpus.Packet> packets) {
		JsonObject answer = json.isJsonObject() ? json.getAsJsonObject() : new JsonObject();
		long id = VoiceModeration.number(answer, "id", 0);
		JsonObject clip = VoiceModeration.object(answer, "clip");
		String thanks = "Danke – deine Meldung ist beim Team und wird geprüft.";
		if (clip == null || packets.isEmpty() || id <= 0) return CompletableFuture.completedFuture(new Result(id, false, 0, 0, thanks, 0));
		OggOpus.Clip file = OggOpus.build(Social.compact(target), packets, VoiceModeration.number(clip, "maxMs", OggOpus.MAX_MS),
				(int) Math.min(Integer.MAX_VALUE, VoiceModeration.number(clip, "maxBytes", OggOpus.MAX_BYTES)));
		if (file == null) return CompletableFuture.completedFuture(new Result(id, false, 0, 0, thanks, 0));
		// Pfad selbst bauen (nie einer fremden Adresse folgen)
		String path = "/v1/voice/reports/" + id + "/clip";
		return Social.transfer("PUT", path, file.bytes(), "audio/ogg", Duration.ofSeconds(60), true).thenApply(response -> {
			if (response.statusCode() >= 400) {
				String why = Social.failure(response).getMessage();
				HeldixClient.LOGGER.info("Voice Chat: Aufnahme zur Meldung {} nicht hochgeladen ({})", id, response.statusCode());
				return new Result(id, false, 0, 0, "Deine Meldung ist beim Team, aber die Aufnahme ließ sich nicht hochladen: " + why, response.statusCode());
			}
			long durationMs = file.durationMs();
			long size = file.bytes().length;
			try {
				JsonElement uploaded = Social.json(response);
				JsonObject info = uploaded.isJsonObject() ? VoiceModeration.object(uploaded.getAsJsonObject(), "clip") : null;
				if (info != null) {
					durationMs = VoiceModeration.number(info, "durationMs", durationMs);
					size = VoiceModeration.number(info, "size", size);
				}
			} catch (Social.ServiceException e) {
				// Antwort unvollständig: die eigenen Werte nehmen
			}
			HeldixClient.LOGGER.info("Voice Chat: Meldung {} mit Aufnahme ({} s) gesendet", id, durationMs / 1000);
			return new Result(id, true, durationMs, size, "Danke – deine Meldung ist beim Team (mit Aufnahme, " + seconds(durationMs) + ").", 0);
		});
	}

	private static String seconds(long ms) {
		long seconds = Math.max(1, Math.round(ms / 1000.0));
		if (seconds < 90) return seconds + " Sek.";
		return Math.round(seconds / 60.0) + " Min.";
	}

	private static List<OggOpus.Packet> packets(List<VoiceChannel.ReceivedPacket> received) {
		if (received == null || received.isEmpty()) return List.of();
		List<OggOpus.Packet> list = new ArrayList<>(Math.min(received.size(), MAX_PACKETS));
		int from = Math.max(0, received.size() - MAX_PACKETS);
		for (int i = from; i < received.size(); i++) {
			VoiceChannel.ReceivedPacket packet = received.get(i);
			if (packet == null || packet.data() == null) continue;
			list.add(new OggOpus.Packet(packet.receivedAt(), packet.sequence() & 0xFFFF, packet.last(), packet.data()));
		}
		list.sort(Comparator.comparingLong(OggOpus.Packet::receivedAt));
		return list;
	}

	// ======================================================================================
	// Körper der Meldung
	// ======================================================================================

	static JsonObject body(Minecraft minecraft, UUID target, String reason, String note, VoiceChannel.ReportData data) {
		JsonObject body = new JsonObject();
		body.addProperty("uuid", Social.compact(target));
		body.addProperty("reason", REASONS.containsKey(reason) ? reason : "other");
		String cleanNote = note == null ? "" : note.replaceAll("[\\p{Cc}\\p{Cf}]", " ").replaceAll("\\s+", " ").strip();
		if (cleanNote.length() > NOTE_MAX) cleanNote = cleanNote.substring(0, NOTE_MAX).strip();
		if (!cleanNote.isEmpty()) body.addProperty("note", cleanNote);
		body.add("context", context(minecraft, target));
		JsonObject levels = levels(data);
		if (levels != null) body.add("levels", levels);
		return body;
	}

	/** Server, Dimension, Zeitpunkt, Gruppe ja/nein und wer in Hörweite war (höchstens 20, nächster zuerst) */
	private static JsonObject context(Minecraft minecraft, UUID target) {
		JsonObject context = new JsonObject();
		String server = VoiceLink.joinedServer();
		if (server != null) context.addProperty("server", server);
		if (minecraft.level != null) context.addProperty("dimension", minecraft.level.dimension().identifier().toString());
		context.addProperty("at", System.currentTimeMillis());
		Set<UUID> group = VoiceLink.groupMembers();
		context.addProperty("group", group.contains(target));
		Map<UUID, String> nearby = new LinkedHashMap<>();
		UUID self = minecraft.getUser() != null ? minecraft.getUser().getProfileId() : null;
		Set<UUID> peers = VoiceLink.peers();
		int range = VoiceLink.range();
		if (minecraft.level != null && minecraft.player != null) {
			for (NearbyPlayer player : NearbyPlayers.all(minecraft)) {
				if (nearby.size() >= MAX_NEARBY) break;
				if (player.uuid().equals(self) || !peers.contains(player.uuid()) || player.distance() > range) continue;
				nearby.put(player.uuid(), player.name());
			}
		}
		for (UUID member : group) {
			if (nearby.size() >= MAX_NEARBY) break;
			if (member.equals(self) || nearby.containsKey(member)) continue;
			String name = VoiceLink.guestName(member);
			if (name == null) name = NearbyPlayers.nameOf(minecraft, member);
			nearby.put(member, name != null ? name : "");
		}
		JsonArray list = new JsonArray();
		for (Map.Entry<UUID, String> entry : nearby.entrySet()) {
			JsonObject player = new JsonObject();
			player.addProperty("uuid", Social.compact(entry.getKey()));
			player.addProperty("name", entry.getValue());
			list.add(player);
		}
		context.add("nearby", list);
		return context;
	}

	/** Lautstärke-Verlauf: je Sekunde dBFS als ganze Zahl -100..0 oder null, älteste zuerst, höchstens 600 */
	private static JsonObject levels(VoiceChannel.ReportData data) {
		if (data == null || data.rms() == null || data.peak() == null || data.rms().length == 0) return null;
		int count = Math.min(data.rms().length, data.peak().length);
		int from = Math.max(0, count - MAX_LEVELS);
		JsonArray rms = new JsonArray();
		JsonArray peak = new JsonArray();
		for (int i = from; i < count; i++) {
			rms.add(level(data.rms()[i]));
			peak.add(level(data.peak()[i]));
		}
		JsonObject levels = new JsonObject();
		levels.addProperty("end", data.levelsEnd() > 0 ? data.levelsEnd() : System.currentTimeMillis());
		levels.add("rms", rms);
		levels.add("peak", peak);
		return levels;
	}

	private static JsonElement level(float value) {
		if (Float.isNaN(value) || value == Float.POSITIVE_INFINITY) return JsonNull.INSTANCE;
		// -∞ = gehört, aber völlige Stille
		if (value == Float.NEGATIVE_INFINITY) return new com.google.gson.JsonPrimitive(-100);
		return new com.google.gson.JsonPrimitive(Math.clamp(Math.round(value), -100, 0));
	}
}
