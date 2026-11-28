package dev.heldixclient.addons.voicechat;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixColors;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.HudCanvas;
import dev.heldixclient.api.HudClick;
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
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/**
 * Voice Chat für HeldixClient: Sprache mit HeldixClient-Spielern in der Nähe, auf jedem Server, über den Sprachkanal des
 * Heldix-Dienstes (Heldix-API 9, {@link HeldixApi#voice()}). Push-to-Talk (Standard V) oder Sprachaktivierung, Lautstärke
 * nach Abstand, Richtung in Stereo, Rauschfilter und Signaltöne, Gruppen über den ganzen Server, Symbole über dem Kopf
 * (spricht, stumm, Ton aus), eine HUD-Anzeige mit Köpfen der Sprecher, Stummschalten und Lautstärke je Spieler im
 * Spielermenü (Mausrad-Klick auf einen Spieler). Ab 1.2.0 mit Browser-Link für die Gruppe: Gäste ohne HeldixClient reden auf
 * der Webseite mit, sind in der Anzeige gekennzeichnet und lassen sich entfernen. Ab 1.3.0 (Heldix-API 10, Dienst 1.13.0):
 * Melden aus Spielermenü und Anzeige (Dialog von HeldixClient, mit Lautstärke-Verlauf und – bei aktiven Aufnahmen – den
 * letzten Minuten des Gemeldeten), Lautstärke-Schutz je Sprecher, Knöpfe für Gastgeber, Operatoren und Party-Leiter (für
 * alle stummschalten, aus dem Voice entfernen), Hinweise bei Sperre und Moderation und die Voice-Regeln vor der ersten
 * Verbindung. Opus kommt aus Concentus (reines Java).
 */
public final class VoiceChatAddon implements HeldixAddon {
	static final int SPEAKING = HeldixColors.SUCCESS;
	static final int GROUP = 0xFFA78BFA;
	private static final int STATUS_RED = HeldixColors.DANGER;
	private static final int MARKER_MS = 300;
	/** so lange nach dem letzten Tippen im Feld „Gruppe“ warten, bevor die Gruppe wechselt */
	private static final long GROUP_DEBOUNCE_MS = 1500;
	/** Knopf im Gruppen-Bereich des Untermenüs (ab 1.2.0) */
	static final String BROWSER_LINK = "Browser-Link für die Gruppe";
	static final String BROWSER_LINK_BUTTON = "Browser-Link kopieren";
	/** Kennzeichen in der Anzeige: Gast ohne HeldixClient, Spieler im Browser */
	static final String GUEST_TAG = "Gast";
	static final String BROWSER_TAG = "Browser";
	/** Einträge im Spielermenü und Knöpfe ab 1.3.0 */
	static final String REPORT = "Melden …";
	static final String MUTE_ALL = "Für alle stummschalten";
	static final String UNMUTE_ALL = "Stumm für alle aufheben";
	static final String KICK = "Aus dem Voice entfernen (10 Min.)";
	static final String UNKICK = "Entfernen aufheben";
	static final String RULES = "Voice-Regeln";
	static final String CLIPS_HINT = "Meldungen können die letzten 10 Minuten enthalten";
	/** so lange gilt ein Sprecher bei offenem Chat noch als „gerade gehört“ (für Melden) */
	private static final long RECENT_MS = 60_000;
	private static final List<Mixer.Info> MICROPHONES = new ArrayList<>();

	private HeldixApi api;
	private ModuleHandle module;
	private ModuleHandle hudModule;
	private VoiceEngine engine;
	private KeyHandle talkKey;
	private IntSupplier talkMode;
	private DoubleSupplier threshold;
	private IntSupplier microphone;
	private DoubleSupplier micGain;
	private BooleanSupplier noiseFilter;
	private DoubleSupplier volume;
	private IntSupplier audience;
	private BooleanSupplier stereo;
	private BooleanSupplier tones;
	private IntSupplier markerMode;
	private Supplier<String> groupName;
	private Supplier<String> groupPassword;
	private IntSupplier hudLayout;
	private BooleanSupplier hudHeads;
	private BooleanSupplier hudOnlyActive;
	private BooleanSupplier volumeGuard;
	/** von dir aus dem Voice Entfernte (für „Entfernen aufheben“), bis wann */
	private final Map<UUID, Long> kickedByMe = new HashMap<>();
	/** Anhänge für Meldungen: Lautstärke-Verlauf und (bei aktiven Aufnahmen) die gepufferten Pakete */
	private final VoiceChannel.ReportAttachments attachments = new VoiceChannel.ReportAttachments() {
		@Override
		public VoiceChannel.ReportData collect(UUID participant, boolean includeClip) {
			return engine == null ? null : engine.report(participant, includeClip);
		}

		@Override
		public long bufferedMillis(UUID participant) {
			return engine == null ? 0 : engine.bufferedMillis(participant);
		}
	};
	private volatile boolean muted;
	private volatile boolean deafened;
	private volatile long testUntil;
	/** stumm geschaltete Spieler und Lautstärke je Spieler (1 = 100 %), gespeichert in der Addon-Konfiguration */
	private final Set<UUID> mutedPlayers = ConcurrentHashMap.newKeySet();
	private final Map<UUID, Double> playerVolumes = new ConcurrentHashMap<>();
	private volatile Map<UUID, VoiceEngine.Position> positions = Map.of();
	/** Namen für die Anzeige (auch Gruppenmitglieder weit weg), im Tick gesammelt */
	private final Map<UUID, String> names = new HashMap<>();
	/** Kennzeichen der Gruppenmitglieder („Gast“, „Browser“), im Tick gesammelt – bleibt nach dem Gehen für die Meldung */
	private final Map<UUID, String> tags = new HashMap<>();
	private Set<UUID> inRange = Set.of();

	// Gruppe: Eingabe entprellen, Mitglieder für Hinweise beobachten
	private String groupInput = "";
	private long groupInputAt;
	private String joinedGroupName;
	private long groupJoinedAt;
	private boolean groupSummaryDone = true;
	private Set<UUID> knownMembers = Set.of();

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
		noiseFilter = module.addToggle("noise-filter", "Rauschfilter", "Nimmt Brummen und leises Rauschen (Lüfter, Tastatur) zwischen deinen Worten weg", true);
		volume = module.addSlider("volume", "Lautstärke", "Wie laut du die anderen hörst", 0, 2, 0.05, 1, value -> Math.round(value * 100) + " %");
		volumeGuard = module.addToggle("volume-guard", "Lautstärke-Schutz",
				"Begrenzt sehr laute Stimmen (Anschreien, laute Musik, Störgeräusche) – und senkt weiter ab, wenn jemand lange laut ist", true);
		audience = module.addChoice("audience", "Sprechen und hören mit", "„Nur Freunde“ gilt in beide Richtungen (deine Gruppe hörst du immer)",
				List.of("Allen in der Nähe", "Nur Freunden"), 0);
		stereo = module.addToggle("stereo", "Richtung hören", "Stimmen kommen von links oder rechts, je nachdem, wo der Spieler steht", true);
		tones = module.addToggle("tones", "Signaltöne", "Kurzer Ton beim Drücken und Loslassen von Push-to-Talk und beim Stummschalten", true);
		markerMode = module.addChoice("marker-mode", "Symbole über dem Kopf", "Wer gerade spricht – und wer sein Mikrofon stumm oder den Ton aus hat",
				List.of("Aus", "Nur beim Sprechen", "Sprechen und Status"), 2);
		groupName = module.addText("group", "Gruppe", "Alle mit demselben Gruppennamen (und Passwort) auf diesem Server hören sich überall – leer = keine Gruppe",
				"", 32);
		groupPassword = module.addText("group-password", "Gruppen-Passwort", "Optional – nur wer Name und Passwort kennt, kommt in die Gruppe", "", 64);
		module.addAction(BROWSER_LINK, "Freunde ohne HeldixClient reden im Browser in deiner Gruppe mit – 24 Std. gültig, bis zu 4 Gäste "
				+ "(braucht den Heldix-Dienst 1.11.0)", BROWSER_LINK_BUTTON, this::copyBrowserLink);
		module.addAction("Mikrofon testen", "Zehn Sekunden lang hörst du dich selbst (nichts wird gesendet)", "Testen",
				() -> testUntil = System.currentTimeMillis() + 10_000);
		module.addAction(RULES, "Regeln für den Voice Chat lesen und annehmen (ab Heldix-Dienst 1.13.0). Sind Aufnahmen für Meldungen aktiv, "
				+ "können Meldungen die letzten 10 Minuten enthalten.", "Lesen", this::showRules);

		talkKey = module.addKey("talk", "Sprechen (Push-to-Talk)", "Halten, um zu sprechen", 'V', () -> {
		});
		module.addKey("mute", "Mikrofon stumm", "Schaltet dein Mikrofon stumm und wieder an", HeldixKeys.NONE, () -> setMuted(!muted));
		module.addKey("deafen", "Ton aus", "Andere nicht mehr hören (und selbst nicht senden)", HeldixKeys.NONE, () -> setDeafened(!deafened));

		hudModule = api.registerHudModule(ModuleSpec.of("anzeige", "Voice Chat-Anzeige", "Mikrofon, Gruppe und wer gerade spricht").at(9999, 124)
				.withIcon("headphones"), new Hud());
		hudLayout = hudModule.addStyleChoice("layout", "Darstellung", List.of("Liste", "Kompakt"), 0);
		hudHeads = hudModule.addStyleToggle("heads", "Köpfe zeigen", true);
		hudOnlyActive = hudModule.addStyleToggle("only-active", "Nur zeigen, wenn etwas los ist", false);

		loadPlayers();
		muted = api.config().getBoolean("muted", false);
		deafened = api.config().getBoolean("deafened", false);
		engine = new VoiceEngine(this, api.voice(), api.logger());
		api.voice().onFrame(engine::receive);
		api.voice().onModeration(this::onModeration);
		api.events().onTick(this::tick);
		// Server- oder Weltwechsel: gepufferte Pakete und Verläufe weg
		api.events().onWorldJoin(engine::clearRecordings);
		api.events().onWorldLeave(engine::clearRecordings);
		api.events().onServerJoin(server -> engine.clearRecordings());
		api.events().onServerLeave(server -> engine.clearRecordings());
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
		voice.setState(muted, deafened);
		long now = System.currentTimeMillis();
		if (on && !api.config().getBoolean("intro", false)) {
			api.config().set("intro", "true");
			api.config().save();
			api.notify("Voice Chat ist an", "Deine Stimme geht über den Heldix-Dienst an HeldixClient-Spieler in deiner Nähe. Sprechen: Taste "
					+ keyName() + " halten.");
		}
		updateGroup(voice, on, now);

		Map<UUID, VoiceEngine.Position> where = new HashMap<>();
		List<NearbyPlayer> nearby = on ? api.nearbyPlayers() : List.of();
		Set<UUID> close = new HashSet<>();
		for (NearbyPlayer player : nearby) {
			where.put(player.uuid(), new VoiceEngine.Position(player.distance(), player.direction(), player.name()));
			names.put(player.uuid(), player.name());
			if (player.distance() <= voice.range() && voice.peers().contains(player.uuid())) close.add(player.uuid());
		}
		positions = where;
		inRange = close;
		Set<UUID> group = on ? voice.groupMembers() : Set.of();
		boolean test = testing();
		engine.update(new VoiceEngine.Settings(talkMode.getAsInt() == 0, threshold.getAsDouble(), microphone.getAsInt(), micGain.getAsDouble(),
				volume.getAsDouble(), stereo.getAsBoolean(), muted, deafened, test, noiseFilter.getAsBoolean(), tones.getAsBoolean(),
				volumeGuard.getAsBoolean()), where, group, on && (voice.status() == VoiceChannel.Status.CONNECTED || test), voice.range());
		// Aufnahmen für Meldungen: nur solange aktiv; Modul aus = auch die Verläufe weg
		if (!on) engine.clearRecordings();
		else if (!voice.clipsActive()) engine.clearClips();
		else engine.expireClips(now);
		kickedByMe.values().removeIf(until -> until <= now);
		// Namen von Sprechern und Gruppenmitgliedern, die nicht in der Nähe sind
		for (UUID speaker : engine.speaking()) if (!names.containsKey(speaker)) api.playerName(speaker).ifPresent(name -> names.put(speaker, name));
		for (UUID member : group) {
			if (!names.containsKey(member)) api.playerName(member).ifPresent(name -> names.put(member, name));
			String tag = voice.isGuest(member) ? GUEST_TAG : voice.inBrowser(member) ? BROWSER_TAG : null;
			if (tag != null) tags.put(member, tag);
			else tags.remove(member);
		}
		if (names.size() > 512) names.clear();
		if (tags.size() > 128) tags.clear();
		if (on) showMarkers(voice, nearby, group);
	}

	/** Symbole über dem Kopf: spricht (1–3 Wellen nach Lautstärke, Gruppe violett), von dir stumm, Mikrofon stumm, Ton aus */
	private void showMarkers(VoiceChannel voice, List<NearbyPlayer> nearby, Set<UUID> group) {
		int mode = markerMode.getAsInt();
		if (mode == 0) return;
		Set<UUID> speaking = new HashSet<>(engine.speaking());
		Set<UUID> peers = voice.peers();
		Duration duration = Duration.ofMillis(MARKER_MS);
		for (NearbyPlayer player : nearby) {
			UUID id = player.uuid();
			if (!peers.contains(id) && !group.contains(id) && !speaking.contains(id)) continue;
			if (isMuted(id)) {
				if (mode == 2) api.playerMarkers().showAbove(id, "volume-off", HeldixColors.MUTED, duration);
				continue;
			}
			// ab 1.3.0: vom Gastgeber bzw. Party-Leiter für alle stumm geschaltet (gelb)
			if (voice.isSilenced(id)) {
				if (mode == 2) api.playerMarkers().showAbove(id, "volume-off", HeldixColors.WARNING, duration);
				continue;
			}
			if (speaking.contains(id)) {
				float level = engine.levelOf(id);
				String icon = level < 0.34f ? "volume-1" : level < 0.67f ? "volume-2" : "volume-3";
				api.playerMarkers().showAbove(id, icon, group.contains(id) ? GROUP : SPEAKING, duration);
			} else if (mode == 2 && voice.peerDeafened(id)) {
				api.playerMarkers().showAbove(id, "headphones-off", STATUS_RED, duration);
			} else if (mode == 2 && voice.peerMuted(id)) {
				api.playerMarkers().showAbove(id, "mic-off", STATUS_RED, duration);
			}
		}
	}

	/** Gruppe aus den Einstellungen übernehmen (entprellt) und Kommen und Gehen melden */
	private void updateGroup(VoiceChannel voice, boolean on, long now) {
		String name = groupName.get().strip();
		String password = groupPassword.get();
		String input = name + "\n" + password;
		if (!input.equals(groupInput)) {
			groupInput = input;
			groupInputAt = now;
		}
		if (!on) {
			joinedGroupName = null;
			knownMembers = Set.of();
			return;
		}
		if (groupInputAt == 0 || now - groupInputAt >= GROUP_DEBOUNCE_MS) voice.setGroup(name, password);
		String current = voice.group();
		if (current == null) {
			joinedGroupName = null;
			knownMembers = Set.of();
			return;
		}
		Set<UUID> members = voice.groupMembers();
		if (!current.equals(joinedGroupName)) {
			// neue Gruppe: erst die Antwort des Dienstes abwarten, dann einmal zusammenfassen
			joinedGroupName = current;
			groupJoinedAt = now;
			groupSummaryDone = false;
			knownMembers = members;
			return;
		}
		if (!groupSummaryDone) {
			if (!members.equals(knownMembers) || now - groupJoinedAt > 3000 || voice.groupProblem() != null) {
				groupSummaryDone = true;
				knownMembers = members;
				String problem = voice.groupProblem();
				if (problem != null) api.notify("Voice-Gruppe „" + current + "“", problem);
				else api.notify("Voice-Gruppe „" + current + "“",
						members.isEmpty() ? "Du bist drin – noch niemand sonst da" : "Du bist drin – " + countText(members.size()) + " dabei");
			}
			return;
		}
		if (members.equals(knownMembers)) return;
		List<String> joined = new ArrayList<>();
		List<String> left = new ArrayList<>();
		for (UUID member : members) if (!knownMembers.contains(member)) joined.add(labelOf(member));
		for (UUID member : knownMembers) if (!members.contains(member)) left.add(labelOf(member));
		knownMembers = members;
		if (!joined.isEmpty()) api.notify("Voice-Gruppe „" + current + "“", String.join(", ", joined) + (joined.size() == 1 ? " ist dazugekommen" : " sind dazugekommen"));
		if (!left.isEmpty()) api.notify("Voice-Gruppe „" + current + "“", String.join(", ", left) + (left.size() == 1 ? " ist gegangen" : " sind gegangen"));
	}

	private static String countText(int count) {
		return count == 1 ? "1 andere Person" : count + " andere";
	}

	String nameOf(UUID player) {
		String name = names.get(player);
		if (name == null) name = api.playerName(player).orElse(null);
		return name != null ? name : tags.containsKey(player) ? "Jemand im Browser" : "Ein Spieler";
	}

	/** Kennzeichen eines Teilnehmers: „Gast“ (ohne HeldixClient), „Browser“ (Spieler auf der Webseite) oder null */
	public String tagOf(UUID player) {
		VoiceChannel voice = api.voice();
		if (voice.isGuest(player)) return GUEST_TAG;
		if (voice.inBrowser(player)) return BROWSER_TAG;
		return tags.get(player);
	}

	/** Name mit Kennzeichen für Meldungen, z. B. „Tom (Gast)“ */
	private String labelOf(UUID player) {
		String tag = tagOf(player);
		return nameOf(player) + (tag != null ? " (" + tag + ")" : "");
	}

	// ======================================================================================
	// Browser-Link und Gäste (ab 1.2.0, Heldix-API 9, Heldix-Dienst 1.11.0)
	// ======================================================================================

	/** Knopf „Browser-Link kopieren“: Link für die aktuelle Gruppe in die Zwischenablage (24 Std.) */
	public void copyBrowserLink() {
		if (!module.isEnabled()) {
			api.notify("Browser-Link", "Schalte zuerst Voice Chat ein und trag eine Gruppe ein");
			return;
		}
		String group = api.voice().group();
		api.voice().createBrowserLink(link -> {
			api.copyToClipboard(link);
			api.notify("Browser-Link kopiert", "Wer ihn öffnet, redet im Browser in „" + (group == null ? "deiner Gruppe" : group)
					+ "“ mit – 24 Std. gültig, bis zu 4 Gäste");
		}, error -> api.notify("Browser-Link", error));
	}

	/** Gast aus der Gruppe entfernen (Knopf in der Anzeige bei offenem Chat) */
	public void removeGuest(UUID guest) {
		if (!api.voice().isGuest(guest)) return;
		String name = nameOf(guest);
		api.voice().removeGuest(guest);
		api.notify("Voice-Gruppe", name + " (Gast) ist entfernt");
	}

	// ======================================================================================
	// Moderation, Melden, Voice-Regeln (ab 1.3.0, Heldix-API 10, Heldix-Dienst 1.13.0)
	// ======================================================================================

	/** Hinweise bei Sperre, Moderation durch Gastgeber/Leiter und Server ohne Voice; Regeln-Dialog, wenn nötig */
	private void onModeration(VoiceChannel.ModerationEvent event) {
		switch (event.kind()) {
			case BANNED -> {
				api.notify("Voice Chat gesperrt", event.message());
				String appeal = api.voice().moderation().banAppeal();
				api.chat(event.message() + (appeal != null ? " " + appeal : ""));
			}
			case MUTED, UNMUTED, KICKED, UNKICKED, SERVER_OFF -> api.notify("Voice Chat", event.message());
			// vor der ersten Verbindung bzw. bei neuer Fassung: Dialog von HeldixClient (einmal je Fassung, solange das Modul an ist)
			case RULES_REQUIRED -> {
				if (module.isEnabled()) showRules();
			}
			case CLIPS_CHANGED -> {
				if (!api.voice().clipsActive()) engine.clearClips();
				api.notify("Voice Chat", event.message());
			}
		}
	}

	/** Knopf „Voice-Regeln“ bzw. automatisch: Dialog von HeldixClient; Ablehnen = Voice bleibt aus */
	public void showRules() {
		api.voice().showRules(accepted -> {
			if (!accepted && api.voice().rules().required()) {
				api.notify("Voice Chat", "Ohne Zustimmung zu den Voice-Regeln bleibt der Voice Chat aus. Lesen: Untermenü → " + RULES);
			}
		});
	}

	/** Melde-Dialog von HeldixClient (Spielermenü, Knopf in der Anzeige); das Ergebnis zeigt HeldixClient selbst an */
	public void report(UUID player) {
		if (!module.isEnabled()) {
			api.notify("Voice Chat", "Schalte zuerst Voice Chat ein");
			return;
		}
		api.voice().openReport(player, attachments, result -> api.logger().info("Voice-Meldung: " + result));
	}

	/** Gastgeber, Operatoren und Party-Leiter: für alle stummschalten bzw. entfernen (und aufheben) */
	public void moderate(UUID player, VoiceChannel.ModerationAction action) {
		String name = nameOf(player);
		if (action == VoiceChannel.ModerationAction.KICK) kickedByMe.put(player, System.currentTimeMillis() + 10 * 60_000L);
		if (action == VoiceChannel.ModerationAction.UNKICK) kickedByMe.remove(player);
		api.voice().moderate(player, action, message -> api.notify("Voice Chat – " + name, message));
	}

	/** Ist der Spieler gerade im Voice dabei (im Raum, in der Gruppe oder kürzlich gehört)? */
	private boolean inVoice(UUID player) {
		VoiceChannel voice = api.voice();
		return voice.peers().contains(player) || voice.groupMembers().contains(player)
				|| engine.lastHeard(player) > System.currentTimeMillis() - ClipBuffer.MAX_AGE_MS;
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
		engine.cue(value ? VoiceEngine.Cue.MUTE : VoiceEngine.Cue.UNMUTE);
		api.notify("Voice Chat", value ? "Mikrofon stumm" : "Mikrofon an");
	}

	private void setDeafened(boolean value) {
		deafened = value;
		api.config().set("deafened", Boolean.toString(value));
		api.config().save();
		engine.cue(value ? VoiceEngine.Cue.MUTE : VoiceEngine.Cue.UNMUTE);
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
		// ab 1.3.0: Melden (Dialog von HeldixClient), für Gastgeber/Leiter: für alle stummschalten und entfernen
		api.addPlayerMenuEntry(new PlayerMenuEntry() {
			@Override
			public String label(NearbyPlayer player) {
				if (!module.isEnabled() || !player.heldixPlayer() || !api.voice().moderation().available() || !inVoice(player.uuid())) return null;
				return REPORT;
			}

			@Override
			public String icon(NearbyPlayer player) {
				return "flag";
			}

			@Override
			public void select(NearbyPlayer player) {
				report(player.uuid());
			}
		});
		api.addPlayerMenuEntry(new PlayerMenuEntry() {
			@Override
			public String label(NearbyPlayer player) {
				if (!module.isEnabled() || !api.voice().rights().canModerate(player.uuid()) || !inVoice(player.uuid())) return null;
				return api.voice().isSilenced(player.uuid()) ? UNMUTE_ALL : MUTE_ALL;
			}

			@Override
			public String icon(NearbyPlayer player) {
				return api.voice().isSilenced(player.uuid()) ? "mic" : "mic-off";
			}

			@Override
			public void select(NearbyPlayer player) {
				moderate(player.uuid(), api.voice().isSilenced(player.uuid()) ? VoiceChannel.ModerationAction.UNMUTE : VoiceChannel.ModerationAction.MUTE);
			}
		});
		api.addPlayerMenuEntry(new PlayerMenuEntry() {
			@Override
			public String label(NearbyPlayer player) {
				if (!module.isEnabled() || !api.voice().rights().canModerate(player.uuid())) return null;
				if (kickedByMe.containsKey(player.uuid())) return UNKICK;
				return inVoice(player.uuid()) ? KICK : null;
			}

			@Override
			public String icon(NearbyPlayer player) {
				return kickedByMe.containsKey(player.uuid()) ? "undo" : "ban";
			}

			@Override
			public void select(NearbyPlayer player) {
				moderate(player.uuid(), kickedByMe.containsKey(player.uuid()) ? VoiceChannel.ModerationAction.UNKICK : VoiceChannel.ModerationAction.KICK);
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
	// HUD: eigenes Mikrofon, Gruppe und wer gerade spricht
	// ======================================================================================

	/** Zustand der Kopfzeile */
	private record Head(String icon, String label, int color, boolean meter) {
	}

	/**
	 * ein Sprecher (bzw. bei offenem Chat ein Mitglied der Gruppe) in der Liste; tag = „Gast“, „Browser“ oder null, speaking =
	 * spricht gerade
	 */
	private record Speaker(UUID uuid, String name, float level, boolean group, String tag, boolean speaking) {
		boolean guest() {
			return GUEST_TAG.equals(tag);
		}
	}

	/** Knöpfe einer Zeile bei offenem Chat (ab 1.3.0): Melden, für alle stummschalten, entfernen; Gäste nur entfernen */
	private List<String[]> rowButtons(Speaker speaker) {
		List<String[]> buttons = new ArrayList<>();
		VoiceChannel voice = api.voice();
		if (speaker.guest()) {
			buttons.add(new String[] {"kick:" + speaker.uuid(), "close", "Gast entfernen\n" + speaker.name() + " fliegt aus der Gruppe (mit dem Link kann er neu beitreten)"});
			return buttons;
		}
		if (voice.rights().canModerate(speaker.uuid())) {
			boolean silenced = voice.isSilenced(speaker.uuid());
			if (kickedByMe.containsKey(speaker.uuid())) {
				buttons.add(new String[] {"unban:" + speaker.uuid(), "undo", UNKICK + "\n" + speaker.name() + " darf gleich wieder in den Voice"});
			} else {
				buttons.add(new String[] {"ban:" + speaker.uuid(), "ban", KICK + "\n" + speaker.name() + " kommt 10 Minuten nicht mehr in den Voice"});
			}
			buttons.add(new String[] {(silenced ? "unsilence:" : "silence:") + speaker.uuid(), silenced ? "mic" : "mic-off",
					(silenced ? UNMUTE_ALL : MUTE_ALL) + "\nGilt für alle in dieser Welt bzw. Party"});
		}
		if (voice.moderation().available()) {
			buttons.add(new String[] {"report:" + speaker.uuid(), "flag", "Melden\n" + speaker.name() + " beim Team von HeldixClient melden"});
		}
		return buttons;
	}

	/** zweite Infozeile zur Moderation: für alle stumm, entfernt oder (bei offenem Chat) der Hinweis auf Aufnahmen; sonst null */
	private String moderationInfo(boolean interactive) {
		VoiceChannel voice = api.voice();
		if (!module.isEnabled() || voice.status() != VoiceChannel.Status.CONNECTED) return null;
		VoiceChannel.Moderation moderation = voice.moderation();
		if (moderation.mutedBy() != null) return "Für alle stumm (von " + moderation.mutedBy() + ")";
		if (moderation.kickedUntil() > System.currentTimeMillis()) {
			return "Aus dem Voice entfernt bis " + java.time.format.DateTimeFormatter.ofPattern("HH:mm")
					.format(java.time.Instant.ofEpochMilli(moderation.kickedUntil()).atZone(java.time.ZoneId.systemDefault()));
		}
		if (interactive && voice.clipsActive()) return CLIPS_HINT;
		return null;
	}

	private final class Hud implements HudRenderer {
		private static final int BADGE = 14;
		private static final int FACE = 12;

		@Override
		public void render(HudCanvas canvas) {
			HudStyle style = canvas.style();
			int pad = style.padding();
			HudCanvas.TextStyle text = style.textStyle();
			int lineHeight = canvas.lineHeight(text);
			int row = Math.max(lineHeight, FACE) + 4;
			boolean preview = canvas.isPreview();
			Head head = head(style);
			boolean buttons = canvas.interactive() && module.isEnabled();
			// bei offenem Chat: wer gerade spricht, wer kürzlich zu hören war, und alle Mitglieder der Gruppe (auch Gäste) – mit
			// Knöpfen (Melden, für Gastgeber/Leiter Stummschalten und Entfernen, Gäste entfernen); sonst nur wer gerade spricht
			boolean memberList = buttons && api.voice().status() == VoiceChannel.Status.CONNECTED;
			List<Speaker> speakers = memberList ? members() : speakers(preview);
			boolean linkButton = buttons && api.voice().group() != null && api.voice().guestsAvailable();
			String info = info(preview);
			int infoColor = infoColor();
			String modInfo = moderationInfo(buttons);
			int modColor = CLIPS_HINT.equals(modInfo) ? HeldixColors.FAINT : HeldixColors.WARNING;
			boolean active = !speakers.isEmpty() || engine.transmitting() || testing() || muted || deafened || engine.problem() != null
					|| api.voice().groupProblem() != null || (modInfo != null && !CLIPS_HINT.equals(modInfo));
			if (hudOnlyActive.getAsBoolean() && !active && !preview && !canvas.interactive()) return;

			if (hudLayout.getAsInt() == 1) {
				compact(canvas, style, head, speakers);
				return;
			}
			int faces = hudHeads.getAsBoolean() ? FACE + 4 : 0;
			int width = pad * 2 + BADGE + 5 + canvas.textWidth(head.label(), text) + (head.meter() ? 22 : 0) + (buttons ? 30 : 0)
					+ (linkButton ? 15 : 0);
			if (info != null) width = Math.max(width, pad * 2 + BADGE + 5 + canvas.textWidth(info, text));
			if (modInfo != null) width = Math.max(width, pad * 2 + BADGE + 5 + canvas.textWidth(modInfo, text));
			int shown = Math.min(speakers.size(), memberList ? 8 : 5);
			List<List<String[]>> actions = new ArrayList<>();
			for (int i = 0; i < shown; i++) {
				Speaker speaker = speakers.get(i);
				List<String[]> rowActions = buttons ? rowButtons(speaker) : List.of();
				actions.add(rowActions);
				boolean silenced = api.voice().isSilenced(speaker.uuid());
				width = Math.max(width, pad * 2 + faces + canvas.textWidth(speaker.name(), text) + 6 + 14 + (speaker.group() ? 12 : 0)
						+ (speaker.tag() != null ? canvas.textWidth(speaker.tag(), text) + 4 : 0) + (silenced ? 13 : 0) + rowActions.size() * 15);
			}
			String more = speakers.size() > shown ? "+" + (speakers.size() - shown) + " weitere" : null;
			int rows = 1 + (info != null ? 1 : 0) + (modInfo != null ? 1 : 0) + shown + (more != null ? 1 : 0);
			int height = pad * 2 + rows * row - 4 + (shown > 0 ? 3 : 0);
			canvas.panel(0, 0, width, height);

			// Kopfzeile: Mikrofon im runden Feld, Text, Pegel, Knöpfe
			int y = pad;
			badge(canvas, pad, y + (row - 4 - BADGE) / 2f, head.icon(), head.color());
			canvas.text(head.label(), pad + BADGE + 5, y + (row - 4 - lineHeight) / 2f + 1, head.color() == HeldixColors.MUTED ? HeldixColors.MUTED
					: style.textColor(), text, style.shadow());
			float right = width - pad;
			if (buttons) {
				canvas.iconButton("deafen", deafened ? "headphones-off" : "headphones", right - 12, y, 12, deafened ? STATUS_RED : style.textColor(),
						deafened ? "Ton wieder an" : "Ton aus (niemanden hören)");
				canvas.iconButton("mute", muted ? "mic-off" : "mic", right - 27, y, 12, muted ? STATUS_RED : style.textColor(),
						muted ? "Mikrofon an" : "Mikrofon stumm");
				right -= 30;
				if (linkButton) {
					canvas.iconButton("browser-link", "user-plus", right - 12, y, 12, style.textColor(),
							"Browser-Link kopieren\nFreunde ohne HeldixClient reden im Browser in deiner Gruppe mit (24 Std.)");
					right -= 15;
				}
			}
			if (head.meter()) meter(canvas, right - 18, y + (row - 4) / 2f, engine.level(), engine.transmitting() ? SPEAKING : style.accent());
			y += row;
			if (info != null) {
				canvas.text(info, pad + BADGE + 5, y + (row - 4 - lineHeight) / 2f, infoColor, text, style.shadow());
				y += row;
			}
			if (modInfo != null) {
				canvas.text(modInfo, pad + BADGE + 5, y + (row - 4 - lineHeight) / 2f, modColor, text, style.shadow());
				y += row;
			}
			if (shown > 0) {
				canvas.rect(pad, y - 2, width - pad * 2, 1, 0x22FFFFFF);
				y += 3;
			}
			for (int i = 0; i < shown; i++) {
				Speaker speaker = speakers.get(i);
				int color = speaker.group() ? GROUP : SPEAKING;
				float x = pad;
				if (faces > 0) {
					face(canvas, speaker, x, y + (row - 4 - FACE) / 2f, color);
					x += faces;
				}
				canvas.text(speaker.name(), x, y + (row - 4 - lineHeight) / 2f + 1, style.textColor(), text, style.shadow());
				x += canvas.textWidth(speaker.name(), text) + 4;
				// Gäste und Spieler im Browser gekennzeichnet
				if (speaker.tag() != null) {
					canvas.text(speaker.tag(), x, y + (row - 4 - lineHeight) / 2f + 1, HeldixColors.MUTED, text, style.shadow());
					x += canvas.textWidth(speaker.tag(), text) + 4;
				}
				if (speaker.group()) {
					canvas.icon("friends", (int) x, y + (row - 4 - 9) / 2, 9, GROUP);
					x += 12;
				}
				// vom Gastgeber bzw. Party-Leiter für alle stumm geschaltet
				if (api.voice().isSilenced(speaker.uuid())) canvas.icon("volume-off", (int) x, y + (row - 4 - 9) / 2, 9, HeldixColors.WARNING);
				float barsX = width - pad - 11;
				for (String[] action : actions.get(i)) {
					int iconColor = action[0].startsWith("kick:") || action[0].startsWith("ban:") ? STATUS_RED
							: action[0].startsWith("report:") ? HeldixColors.MUTED : style.textColor();
					canvas.iconButton(action[0], action[1], barsX, y + (row - 4 - 11) / 2f, 11, iconColor, action[2]);
					barsX -= 15;
				}
				if (speaker.speaking()) bars(canvas, barsX, y + (row - 4) / 2f, speaker.level(), color);
				y += row;
			}
			if (more != null) canvas.text(more, pad, y + (row - 4 - lineHeight) / 2f, HeldixColors.MUTED, text, style.shadow());
		}

		@Override
		public boolean onClick(HudClick click) {
			switch (click.hotspot()) {
				case "mute" -> setMuted(!muted);
				case "deafen" -> setDeafened(!deafened);
				case "browser-link" -> copyBrowserLink();
				default -> {
					String spot = click.hotspot();
					int colon = spot.indexOf(':');
					if (colon < 0) return false;
					UUID target;
					try {
						target = UUID.fromString(spot.substring(colon + 1));
					} catch (IllegalArgumentException e) {
						return false;
					}
					switch (spot.substring(0, colon)) {
						case "kick" -> removeGuest(target);
						case "report" -> report(target);
						case "silence" -> moderate(target, VoiceChannel.ModerationAction.MUTE);
						case "unsilence" -> moderate(target, VoiceChannel.ModerationAction.UNMUTE);
						case "ban" -> moderate(target, VoiceChannel.ModerationAction.KICK);
						case "unban" -> moderate(target, VoiceChannel.ModerationAction.UNKICK);
						default -> {
							return false;
						}
					}
				}
			}
			return true;
		}

		/** Kompakt: nur das Mikrofon und die Köpfe der Sprecher */
		private void compact(HudCanvas canvas, HudStyle style, Head head, List<Speaker> speakers) {
			int pad = style.padding();
			int shown = Math.min(speakers.size(), 8);
			int width = pad * 2 + BADGE + shown * (FACE + 5);
			int height = pad * 2 + BADGE;
			canvas.panel(0, 0, width, height);
			badge(canvas, pad, pad, head.icon(), head.color());
			if (head.meter() && engine.transmitting()) canvas.roundedOutline(pad - 1, pad - 1, BADGE + 2, BADGE + 2, (BADGE + 2) / 2f, SPEAKING);
			float x = pad + BADGE + 5;
			for (int i = 0; i < shown; i++) {
				Speaker speaker = speakers.get(i);
				face(canvas, speaker, x, pad + (BADGE - FACE) / 2f, speaker.group() ? GROUP : SPEAKING);
				x += FACE + 5;
			}
			if (module.isEnabled()) canvas.hotspot("mute", pad, pad, BADGE, BADGE, muted ? "Mikrofon an" : "Mikrofon stumm");
		}

		/** rundes Feld mit Symbol, in der Farbe des Zustands */
		private void badge(HudCanvas canvas, float x, float y, String icon, int color) {
			canvas.circle(x + BADGE / 2f, y + BADGE / 2f, BADGE / 2f, (color & 0xFFFFFF) | 0x38000000);
			canvas.icon(icon, Math.round(x + 2), Math.round(y + 2), BADGE - 4, color);
		}

		/** Kopf mit farbigem Ring, der mit der Lautstärke kräftiger wird */
		private void face(HudCanvas canvas, Speaker speaker, float x, float y, int color) {
			float alpha = 0.45f + 0.55f * speaker.level();
			int ring = ((int) (alpha * 255) << 24) | (color & 0xFFFFFF);
			canvas.roundedRect(x - 1.5f, y - 1.5f, FACE + 3, FACE + 3, 3, ring);
			// Gäste haben keinen Minecraft-Skin (zufällige ID): gleich das Symbol, ohne nachzuschlagen
			if (speaker.guest() || !canvas.playerHead(speaker.uuid().toString(), Math.round(x), Math.round(y), FACE)) {
				canvas.roundedRect(x, y, FACE, FACE, 2, 0xFF1B2232);
				canvas.icon("user", Math.round(x + 2), Math.round(y + 2), FACE - 4, HeldixColors.MUTED);
			}
		}

		/** Pegel des eigenen Mikrofons: fünf Balken */
		private void meter(HudCanvas canvas, float x, float centerY, float level, int color) {
			for (int i = 0; i < 5; i++) {
				float height = 3 + i * 1.5f;
				boolean lit = level > (i + 0.5f) / 5f;
				canvas.roundedRect(x + i * 3.5f, centerY - height / 2f, 2, height, 1, lit ? color : 0x33FFFFFF);
			}
		}

		/** drei Balken, die mit der Stimme des Sprechers hüpfen */
		private void bars(HudCanvas canvas, float x, float centerY, float level, int color) {
			long now = System.currentTimeMillis();
			for (int i = 0; i < 3; i++) {
				double wave = 0.6 + 0.4 * Math.sin(now / 90.0 + i * 1.7);
				float height = (float) (3 + 7 * Math.clamp(level, 0.15, 1) * wave);
				canvas.roundedRect(x + i * 4, centerY - height / 2f, 2.5f, height, 1.2f, color);
			}
		}

		private Head head(HudStyle style) {
			VoiceChannel.Status status = api.voice().status();
			if (!module.isEnabled()) return new Head("mic-off", "Voice Chat aus", HeldixColors.MUTED, false);
			if (testing()) return new Head("headphones", "Test: du hörst dich selbst", style.accent(), true);
			if (deafened) return new Head("headphones-off", "Ton aus", STATUS_RED, false);
			if (muted) return new Head("mic-off", "Mikrofon stumm", STATUS_RED, false);
			// ab 1.3.0: Sperre durch das Team, Voice-Regeln offen, Server ohne Voice
			VoiceChannel.Moderation moderation = api.voice().moderation();
			if (moderation.banned()) return new Head("ban", api.voice().statusText(), STATUS_RED, false);
			if (moderation.rulesRequired() && status != VoiceChannel.Status.CONNECTED) return new Head("shield", api.voice().statusText(), HeldixColors.WARNING, false);
			if (moderation.serverOff()) return new Head("volume-off", "Voice ist auf diesem Server aus", HeldixColors.MUTED, false);
			if (status != VoiceChannel.Status.CONNECTED) return new Head("headphones", api.voice().statusText(), HeldixColors.MUTED, false);
			if (engine.problem() != null) return new Head("warning", engine.problem(), HeldixColors.WARNING, false);
			if (engine.transmitting()) return new Head("mic", "Du sprichst", SPEAKING, true);
			String label = talkMode.getAsInt() == 0 ? "Sprechen: " + keyName() : "Sprachaktivierung";
			return new Head("mic", label, style.accent(), true);
		}

		/** zweite Zeile: Reichweite und Gruppe (bzw. warum die Gruppe nicht geht) */
		private String info(boolean preview) {
			if (!module.isEnabled() || api.voice().status() != VoiceChannel.Status.CONNECTED) {
				return preview ? "2 hier · Gruppe „Bau“ · 3" : null;
			}
			String problem = api.voice().groupProblem();
			if (problem != null) return problem;
			String group = api.voice().group();
			if (group == null) return inRange.isEmpty() ? "Niemand in Reichweite" : inRange.size() + " in Reichweite";
			// mit Gruppe kurz halten, damit die Anzeige nicht zu breit wird
			String name = group.length() > 14 ? group.substring(0, 13) + "…" : group;
			String members = "Gruppe „" + name + "“ · " + api.voice().groupMembers().size();
			return inRange.isEmpty() ? members : inRange.size() + " hier · " + members;
		}

		private int infoColor() {
			return api.voice().groupProblem() != null ? HeldixColors.WARNING : HeldixColors.MUTED;
		}

		private List<Speaker> speakers(boolean preview) {
			List<Speaker> list = new ArrayList<>();
			if (module.isEnabled() && !deafened) {
				Set<UUID> group = api.voice().groupMembers();
				for (UUID speaker : engine.speaking()) {
					list.add(new Speaker(speaker, nameOf(speaker), engine.levelOf(speaker), group.contains(speaker), tagOf(speaker), true));
				}
				list.sort((a, b) -> a.name().compareToIgnoreCase(b.name()));
			}
			if (list.isEmpty() && preview) {
				list.add(new Speaker(new UUID(0, 1), "Steve", 0.7f, false, null, true));
				list.add(new Speaker(new UUID(0, 2), "Alex", 0.4f, true, null, true));
			}
			return list;
		}

		/**
		 * bei offenem Chat: wer gerade spricht, wer in der letzten Minute zu hören war (zum Melden) und alle Mitglieder der Gruppe
		 * (Sprecher zuerst, dann nach Namen)
		 */
		private List<Speaker> members() {
			List<Speaker> list = new ArrayList<>(speakers(false));
			Set<UUID> listed = new HashSet<>();
			for (Speaker speaker : list) listed.add(speaker.uuid());
			Set<UUID> group = api.voice().groupMembers();
			for (UUID member : group) {
				if (listed.add(member)) list.add(new Speaker(member, nameOf(member), 0f, true, tagOf(member), false));
			}
			if (!deafened) {
				for (UUID recent : engine.heardSince(System.currentTimeMillis() - RECENT_MS)) {
					if (listed.add(recent)) list.add(new Speaker(recent, nameOf(recent), 0f, group.contains(recent), tagOf(recent), false));
				}
			}
			list.sort((a, b) -> a.speaking() != b.speaking() ? (a.speaking() ? -1 : 1) : a.name().compareToIgnoreCase(b.name()));
			return list;
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

	public int cuesPlayed() {
		return engine == null ? 0 : engine.cuesPlayed();
	}

	public List<UUID> speakingNow() {
		return engine == null ? List.of() : engine.speaking();
	}

	public float levelOf(UUID player) {
		return engine == null ? 0 : engine.levelOf(player);
	}

	public boolean mutedPlayer(UUID player) {
		return isMuted(player);
	}

	public void toggleMute() {
		setMuted(!muted);
	}

	public void toggleDeafen() {
		setDeafened(!deafened);
	}

	/** Lautstärke-Schutz an Testsignalen prüfen: null = in Ordnung, sonst die Abweichung */
	public String guardSelfTest() {
		return VolumeGuard.verify();
	}

	/** gepufferte Zeit (ms) eines Sprechers für Meldungen */
	public long bufferedMillisOf(UUID player) {
		return engine == null ? 0 : engine.bufferedMillis(player);
	}

	/** Sprecher im Ringpuffer */
	public int clipSpeakers() {
		return engine == null ? 0 : engine.clipSpeakers();
	}

	/** Sekunden im Lautstärke-Verlauf eines Sprechers */
	public int levelSecondsOf(UUID player) {
		VoiceChannel.ReportData data = engine == null ? null : engine.report(player, false);
		return data == null || data.rms() == null ? 0 : data.rms().length;
	}
}
