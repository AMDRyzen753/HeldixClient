package dev.heldixclient.server;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Aufrufe an den Heldix-Dienst mit dem Partner-Schlüssel ({@code Authorization: Partner <key>}). Nur asynchron: Jede Anfrage
 * läuft auf eigenen Hintergrund-Threads, nie im Hauptthread des Servers. Ergebnisse kommen als {@link Response} (auch bei
 * Fehlern – nie als Ausnahme).
 */
final class ServiceClient {
	/** Antwort: HTTP-Status (0 = keine Verbindung), JSON (leeres Objekt, wenn keins), deutscher Fehlersatz und Code */
	record Response(int status, JsonObject json, String error, String code) {
		boolean ok() {
			return status >= 200 && status < 300;
		}
	}

	private final ExecutorService executor = Executors.newFixedThreadPool(2, runnable -> {
		Thread thread = new Thread(runnable, "HeldixClient-Server Dienst");
		thread.setDaemon(true);
		return thread;
	});
	private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10))
			.executor(executor).build();
	private final String version;
	private volatile Settings settings;

	ServiceClient(String version, Settings settings) {
		this.version = version;
		this.settings = settings;
	}

	void update(Settings settings) {
		this.settings = settings;
	}

	CompletableFuture<Response> get(String path) {
		return call("GET", path, null);
	}

	CompletableFuture<Response> put(String path, JsonObject body) {
		return call("PUT", path, body);
	}

	CompletableFuture<Response> post(String path, JsonObject body) {
		return call("POST", path, body);
	}

	CompletableFuture<Response> delete(String path) {
		return call("DELETE", path, null);
	}

	private CompletableFuture<Response> call(String method, String path, JsonObject body) {
		Settings current = settings;
		if (!current.hasPartnerKey()) {
			return CompletableFuture.completedFuture(new Response(0, new JsonObject(), "Kein Partner-Schlüssel in der config.yml eingetragen.", null));
		}
		HttpRequest.Builder request;
		try {
			request = HttpRequest.newBuilder(URI.create(current.apiUrl() + path)).timeout(Duration.ofSeconds(15))
					.header("Authorization", "Partner " + current.partnerKey())
					.header("Accept", "application/json")
					.header("User-Agent", "HeldixClient-Server/" + version);
		} catch (IllegalArgumentException e) {
			return CompletableFuture.completedFuture(new Response(0, new JsonObject(), "Die api-url in der config.yml ist keine gültige Adresse.", null));
		}
		if (body != null) {
			request.header("Content-Type", "application/json");
			request.method(method, HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
		} else {
			request.method(method, HttpRequest.BodyPublishers.noBody());
		}
		return http.sendAsync(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
				.handle((response, error) -> {
					if (error != null) return new Response(0, new JsonObject(), "Der Heldix-Dienst ist gerade nicht erreichbar.", null);
					JsonObject json = parse(response.body());
					String message = null;
					String code = null;
					if (response.statusCode() >= 400) {
						message = string(json, "error");
						code = string(json, "code");
						if (message == null) message = switch (response.statusCode()) {
							case 401 -> "Der Partner-Schlüssel ist ungültig.";
							case 403 -> "Der Partner ist pausiert oder darf das nicht.";
							case 404 -> "Der Heldix-Dienst kennt diese Funktion nicht (älterer Dienst?).";
							case 429 -> "Zu viele Anfragen – bitte kurz warten.";
							default -> "Fehler beim Heldix-Dienst (" + response.statusCode() + ").";
						};
					}
					return new Response(response.statusCode(), json, message, code);
				});
	}

	private static JsonObject parse(String text) {
		try {
			JsonElement element = JsonParser.parseString(text == null || text.isBlank() ? "{}" : text);
			return element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
		} catch (RuntimeException e) {
			return new JsonObject();
		}
	}

	static String string(JsonObject json, String key) {
		return json != null && json.has(key) && json.get(key).isJsonPrimitive() ? json.get(key).getAsString() : null;
	}

	void close() {
		executor.shutdown();
		try {
			executor.awaitTermination(2, TimeUnit.SECONDS);
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
		executor.shutdownNow();
	}
}
