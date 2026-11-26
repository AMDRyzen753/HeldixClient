package dev.heldixclient.addons.voicechat;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixColors;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudRenderer;
import dev.heldixclient.api.HudStyle;
import dev.heldixclient.api.KeyHandle;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;
import dev.heldixclient.api.NearbyPlayer;
import dev.heldixclient.api.PlayerMenuEntry;
import dev.heldixclient.api.VoiceChannel;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.Mixer;
import javax.sound.sampled.TargetDataLine;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;

/**
 * Voice Chat für HeldixClient: Sprache mit HeldixClient-Spielern in der Nähe, auf jedem Server, über den Sprachkanal des
 * Heldix-Dienstes (Heldix-API 6, {@link HeldixApi#voice()}). Push-to-Talk (Standard V) oder Sprachaktivierung,
 * Lautstärke nach Abstand, Richtung in Stereo, Symbol über dem Kopf von Sprechern, Stummschalten und Lautstärke je Spieler
 * im Spielermenü (Mausrad-Klick auf einen Spieler). Opus kommt aus Concentus (reines Java).
 */
public final class VoiceChatAddon implements HeldixAddon {
	private static final int SPEAKING = 0xFF34D399;
	private static final List<Mixer.Info> MICROPHONES = new ArrayList<>();

	private HeldixApi api;
	private ModuleHandle module;
	private VoiceEngine engine;
	private KeyHandle talkKey;
	private IntSupplier talkMode;
	private DoubleSupplier threshold;
	private IntSupplier microphone;
	private DoubleSupplier micGain;
	private DoubleSupplier volume;
	private IntSupplier audience;
	private BooleanSupplier stereo;
	private BooleanSupplier markers;
	private volatile boolean muted;
	private volatile boolean deafened;
	private volatile long testUntil;
	/** stumm geschaltete Spieler und Lautstärke je Spieler (1 = 100 %), gespeichert in der Addon-Konfiguration */
	private final Set<UUID> mutedPlayers = ConcurrentHashMap.newKeySet();
	private final Map<UUID, Double> playerVolumes = new ConcurrentHashMap<>();
	private volatile Map<UUID, VoiceEngine.Position> positions = Map.of();

	@Override
	public void onEnable(HeldixApi api) {
		this.api = api;
		module = api.registerModule(ModuleSpec.of("voicechat", "Voice Chat", "Mit Spielern in der Nähe sprechen").disabledByDefault().withIcon("mic"));
		talkMode = module.addChoice("talk", "Sprechen", "Push-to-Talk: Taste halten · Sprachaktivierung: sobald du laut genug sprichst",
				List.of("Push-to-Talk", "Sprachaktivierung"), 0);
		threshold = module.addSlider("threshold", "Schwelle", "Für die Sprachaktivierung: ab dieser Lautstärke wird gesendet", -70, -10, 1, -42,
				value -> Math.round(value) + " dB");
		microphone = module.addChoice("microphone", "Mikrofon", "Welches Mikrofon (Standard = wie im System eingestellt)", microphoneNames(), 0);
		micGain = module.addSlider("mic-gain", "Mikrofon-Lautstärke", "Wie laut dich die anderen hören", 0, 2, 0.05, 1,
				value -> Math.round(value * 100) + " %");
		volume = module.addSlider("volume", "Lautstärke", "Wie laut du die anderen hörst", 0, 2, 0.05, 1, value -> Math.round(value * 100) + " %");
		audience = module.addChoice("audience", "Sprechen und hören mit", "„Nur Freunde“ gilt in beide Richtungen",
				List.of("Allen in der Nähe", "Nur Freunden"), 0);
		stereo = module.addToggle("stereo", "Richtung hören", "Stimmen kommen von links oder rechts, je nachdem, wo der Spieler steht", true);
		markers = module.addToggle("markers", "Symbol über dem Kopf", "Zeigt, wer gerade spricht", true);
		module.addAction("Mikrofon testen", "Zehn Sekunden lang hörst du dich selbst (nichts wird gesendet)", "Testen",
				() -> testUntil = System.currentTimeMillis() + 10_000);

		talkKey = module.addKey("talk", "Sprechen (Push-to-Talk)", "Halten, um zu sprechen", 'V', () -> {
		});
		module.addKey("mute", "Mikrofon stumm", "Schaltet dein Mikrofon stumm und wieder an", HeldixKeys.NONE, () -> setMuted(!muted));
		module.addKey("deafen", "Ton aus", "Andere nicht mehr hören (und selbst nicht senden)", HeldixKeys.NONE, () -> setDeafened(!deafened));

		api.registerHudModule(ModuleSpec.of("anzeige", "Voice Chat-Anzeige", "Mikrofon und wer gerade spricht").at(9999, 80).withIcon("headphones"),
				new Hud());

		loadPlayers();
		muted = api.config().getBoolean("muted", false);
		deafened = api.config().getBoolean("deafened", false);
		engine = new VoiceEngine(this, api.voice(), api.logger());
		api.voice().onFrame(engine::receive);
		api.events().onTick(this::tick);
		addMenuEntries();
	}

	@Override
	public void onDisable() {
		if (engine != null) engine.stop();
		if (api != null) api.voice().setActive(false);
	}

	// ======================================================================================
	// Jeder Tick (Haupt-Thread)
	// ======================================================================================

	private void tick() {
		boolean on = module.isEnabled();
		VoiceChannel voice = api.voice();
		voice.setActive(on);
		voice.setFriendsOnly(audience.getAsInt() == 1);
		if (on && !api.config().getBoolean("intro", false)) {
			api.config().set("intro", "true");
			api.config().save();
			api.notify("Voice Chat ist an", "Deine Stimme geht über den Heldix-Dienst an HeldixClient-Spieler in deiner Nähe. Sprechen: Taste "
					+ keyName() + " halten.");
		}
		Map<UUID, VoiceEngine.Position> where = new HashMap<>();
		if (on) {
			for (NearbyPlayer player : api.nearbyPlayers()) where.put(player.uuid(), new VoiceEngine.Position(player.distance(), player.direction(), player.name()));
		}
		positions = where;
		boolean test = testing();
		engine.update(new VoiceEngine.Settings(talkMode.getAsInt() == 0, threshold.getAsDouble(), microphone.getAsInt(), micGain.getAsDouble(),
				volume.getAsDouble(), stereo.getAsBoolean(), muted, deafened, test), where,
				on && (voice.status() == VoiceChannel.Status.CONNECTED || test), voice.range());
		if (on && markers.getAsBoolean()) {
			for (UUID speaker : engine.speaking()) api.playerMarkers().show(speaker, "volume", SPEAKING, Duration.ofMillis(400));
		}
	}

	boolean testing() {
		return System.currentTimeMillis() < testUntil;
	}

	/** Push-to-Talk gerade gedrückt? (Aufnahme-Thread; die Taste ist ein einfacher Zustand) */
	boolean pushToTalkDown() {
		return talkKey != null && talkKey.isDown();
	}

	private String keyName() {
		String name = talkKey.keyName();
		return name.isEmpty() ? "(nicht belegt)" : name;
	}

	private void setMuted(boolean value) {
		muted = value;
		api.config().set("muted", Boolean.toString(value));
		api.config().save();
		api.notify("Voice Chat", value ? "Mikrofon stumm" : "Mikrofon an");
	}

	private void setDeafened(boolean value) {
		deafened = value;
		api.config().set("deafened", Boolean.toString(value));
		api.config().save();
		api.notify("Voice Chat", value ? "Ton aus – du hörst niemanden" : "Ton wieder an");
	}

	// ======================================================================================
	// Einzelne Spieler: stumm, Lautstärke
	// ======================================================================================

	boolean isMuted(UUID player) {
		return mutedPlayers.contains(player);
	}

	double volumeOf(UUID player) {
		return playerVolumes.getOrDefault(player, 1.0);
	}

	private void loadPlayers() {
		for (String part : api.config().get("stumm", "").split(",")) {
			try {
				if (!part.isBlank()) mutedPlayers.add(UUID.fromString(part.trim()));
			} catch (IllegalArgumentException ignored) {
				// kaputter Eintrag
			}
		}
		for (String part : api.config().get("lautstaerken", "").split(",")) {
			String[] pair = part.split("=");
			try {
				if (pair.length == 2) playerVolumes.put(UUID.fromString(pair[0].trim()), Math.clamp(Double.parseDouble(pair[1]), 0, 2));
			} catch (IllegalArgumentException ignored) {
				// kaputter Eintrag
			}
		}
	}

	private void savePlayers() {
		api.config().set("stumm", String.join(",", mutedPlayers.stream().map(UUID::toString).toList()));
		List<String> volumes = new ArrayList<>();
		for (Map.Entry<UUID, Double> entry : playerVolumes.entrySet()) volumes.add(entry.getKey() + "=" + entry.getValue());
		api.config().set("lautstaerken", String.join(",", volumes));
		api.config().save();
	}

	private void changeVolume(UUID player, double delta) {
		double value = Math.clamp(Math.round((volumeOf(player) + delta) * 4) / 4.0, 0, 2);
		if (value == 1.0) playerVolumes.remove(player);
		else playerVolumes.put(player, value);
		savePlayers();
	}

	/** Einträge im Spielermenü (Mausrad-Klick auf einen Spieler), nur mit eingeschaltetem Voice Chat */
	private void addMenuEntries() {
		api.addPlayerMenuEntry(new PlayerMenuEntry() {
			@Override
			public String label(NearbyPlayer player) {
				if (!module.isEnabled() || !player.heldixPlayer()) return null;
				return isMuted(player.uuid()) ? "Stumm aufheben" : "Stummschalten";
			}

			@Override
			public String icon(NearbyPlayer player) {
				return isMuted(player.uuid()) ? "volume" : "volume-off";
			}

			@Override
			public void select(NearbyPlayer player) {
				if (!mutedPlayers.remove(player.uuid())) mutedPlayers.add(player.uuid());
				savePlayers();
				api.notify("Voice Chat", player.name() + (isMuted(player.uuid()) ? " ist stumm" : " ist wieder zu hören"));
			}
		});
		api.addPlayerMenuEntry(new PlayerMenuEntry() {
			@Override
			public String label(NearbyPlayer player) {
				if (!module.isEnabled() || !player.heldixPlayer() || isMuted(player.uuid())) return null;
				return "Lauter (" + Math.round(volumeOf(player.uuid()) * 100) + " %)";
			}

			@Override
			public String icon(NearbyPlayer player) {
				return "plus";
			}

			@Override
			public void select(NearbyPlayer player) {
				changeVolume(player.uuid(), 0.25);
			}

			@Override
			public boolean keepOpen() {
				return true;
			}
		});
		api.addPlayerMenuEntry(new PlayerMenuEntry() {
			@Override
			public String label(NearbyPlayer player) {
				if (!module.isEnabled() || !player.heldixPlayer() || isMuted(player.uuid())) return null;
				return "Leiser (" + Math.round(volumeOf(player.uuid()) * 100) + " %)";
			}

			@Override
			public String icon(NearbyPlayer player) {
				return "chevron-down";
			}

			@Override
			public void select(NearbyPlayer player) {
				changeVolume(player.uuid(), -0.25);
			}

			@Override
			public boolean keepOpen() {
				return true;
			}
		});
	}

	// ======================================================================================
	// Mikrofone
	// ======================================================================================

	/** „Standard“ und die Mikrofone, die 48 kHz mono 16 Bit aufnehmen können (beim Start ermittelt) */
	private static List<String> microphoneNames() {
		List<String> names = new ArrayList<>();
		names.add("Standard");
		MICROPHONES.clear();
		try {
			AudioFormat format = new AudioFormat(VoiceEngine.RATE, 16, 1, true, false);
			DataLine.Info line = new DataLine.Info(TargetDataLine.class, format);
			Set<String> seen = new LinkedHashSet<>();
			for (Mixer.Info info : AudioSystem.getMixerInfo()) {
				if (MICROPHONES.size() >= 12) break;
				try {
					if (!AudioSystem.getMixer(info).isLineSupported(line)) continue;
				} catch (RuntimeException | LinkageError e) {
					continue;
				}
				String name = info.getName().strip();
				if (name.length() > 40) name = name.substring(0, 39) + "…";
				if (!seen.add(name)) continue;
				MICROPHONES.add(info);
				names.add(name);
			}
		} catch (RuntimeException | LinkageError e) {
			// ohne javax.sound: nur „Standard“
		}
		return names;
	}

	/** Mikrofon Nummer {@code index} (ohne „Standard“), sonst null */
	static Mixer.Info microphone(int index) {
		return index >= 0 && index < MICROPHONES.size() ? MICROPHONES.get(index) : null;
	}

	// ======================================================================================
	// HUD: Mikrofon und wer gerade spricht
	// ======================================================================================

	private final class Hud implements HudRenderer {
		@Override
		public void render(HudCanvas canvas) {
			HudStyle style = canvas.style();
			int pad = style.padding();
			HudCanvas.TextStyle text = style.textStyle();
			int line = canvas.lineHeight(text) + 4;
			VoiceChannel.Status status = api.voice().status();
			boolean on = module.isEnabled();
			String icon;
			String label;
			int color;
			if (!on) {
				icon = "mic-off";
				label = "Voice Chat aus";
				color = HeldixColors.MUTED;
			} else if (testing()) {
				icon = "headphones";
				label = "Test: du hörst dich selbst";
				color = style.accent();
			} else if (deafened) {
				icon = "volume-off";
				label = "Ton aus";
				color = HeldixColors.WARNING;
			} else if (muted) {
				icon = "mic-off";
				label = "Mikrofon stumm";
				color = HeldixColors.WARNING;
			} else if (status != VoiceChannel.Status.CONNECTED) {
				icon = "headphones";
				label = api.voice().statusText();
				color = HeldixColors.MUTED;
			} else if (engine.problem() != null) {
				icon = "warning";
				label = engine.problem();
				color = HeldixColors.WARNING;
			} else {
				icon = "mic";
				label = talkMode.getAsInt() == 0 ? "Sprechen: " + keyName() : "Sprachaktivierung";
				color = engine.transmitting() ? SPEAKING : style.textColor();
			}
			List<String> speakers = new ArrayList<>();
			if (on && !deafened) {
				Map<UUID, VoiceEngine.Position> where = positions;
				for (UUID speaker : engine.speaking()) {
					VoiceEngine.Position position = where.get(speaker);
					speakers.add(position != null ? position.name() : "Spieler");
					if (speakers.size() >= 4) break;
				}
			}
			boolean meter = on && status == VoiceChannel.Status.CONNECTED && !muted && !deafened || testing();
			int width = pad * 2 + 14 + canvas.textWidth(label, text) + (meter ? 34 : 0);
			for (String name : speakers) width = Math.max(width, pad * 2 + 14 + canvas.textWidth(name, text));
			int height = pad * 2 + line * (1 + speakers.size()) - 4;
			canvas.panel(0, 0, width, height);
			int y = pad;
			canvas.icon(icon, pad, y, 10, color);
			canvas.text(label, pad + 14, y + 1, color, text, style.shadow());
			if (meter) {
				float level = engine.level();
				canvas.progressBar(width - pad - 28, y + 3, 28, 4, level, 0x33FFFFFF, engine.transmitting() ? SPEAKING : style.accent());
			}
			for (String name : speakers) {
				y += line;
				canvas.icon("volume", pad, y, 10, SPEAKING);
				canvas.text(name, pad + 14, y + 1, style.textColor(), text, style.shadow());
			}
		}
	}

	// ======================================================================================
	// Für den Autotest (über Reflexion)
	// ======================================================================================

	public boolean engineRunning() {
		return engine != null && engine.running();
	}

	public int framesSent() {
		return engine == null ? 0 : engine.framesSent();
	}

	public int framesPlayed() {
		return engine == null ? 0 : engine.framesPlayed();
	}

	public List<UUID> speakingNow() {
		return engine == null ? List.of() : engine.speaking();
	}

	public boolean mutedPlayer(UUID player) {
		return isMuted(player);
	}
}
