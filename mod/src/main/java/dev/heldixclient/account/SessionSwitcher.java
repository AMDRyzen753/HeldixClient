package dev.heldixclient.account;

import com.mojang.authlib.exceptions.AuthenticationException;
import com.mojang.authlib.minecraft.UserApiService;
import com.mojang.authlib.services.FriendsService;
import com.mojang.authlib.services.MinecraftServicesDiscoveryService;
import com.mojang.authlib.services.ProfileResult;
import com.mojang.realmsclient.RealmsAvailability;
import com.mojang.realmsclient.client.RealmsClient;
import com.mojang.realmsclient.gui.RealmsDataFetcher;
import dev.heldixclient.HeldixClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.User;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.LevelLoadingScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.social.PlayerSocialManager;
import net.minecraft.client.gui.screens.social.RemoteFriendListUpdateHandler;
import net.minecraft.client.multiplayer.ProfileKeyPairManager;
import net.minecraft.client.multiplayer.chat.report.ReportEnvironment;
import net.minecraft.client.multiplayer.chat.report.ReportingContext;
import net.minecraft.client.telemetry.ClientTelemetryManager;
import net.minecraft.util.Util;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * Tauscht die angemeldete Sitzung von Minecraft aus – nur außerhalb einer Welt ({@link #canSwitchNow}).
 *
 * <p>Minecraft baut beim Start aus dem {@code User} eine Reihe von Diensten; die werden alle neu gebaut, wie es der
 * Konstruktor von Minecraft tut:
 * <ul>
 *   <li>{@code user} – Name, UUID, Zugangs-Token (Server-Beitritt fragt es jedes Mal neu ab)</li>
 *   <li>{@code userApiService} und {@code userPropertiesFuture} – Mojang-Dienste mit dem Token (Chat-Erlaubnis, Sperren)</li>
 *   <li>{@code profileFuture} – eigenes Profil mit Skin-Texturen (Figur im Menü)</li>
 *   <li>{@code profileKeyPairManager} – Schlüssel für die Chat-Signatur (je UUID unter profilekeys/)</li>
 *   <li>{@code telemetryManager}, {@code reportingContext} – Telemetrie und Melden mit dem neuen Konto</li>
 *   <li>{@code remoteFriendListUpdateHandler}, {@code playerSocialManager} – Freunde von Minecraft</li>
 *   <li>Realms: zwischengespeicherter Client und Verfügbarkeit vergessen, {@code realmsDataFetcher} neu</li>
 * </ul>
 * Was HeldixClient selbst am Konto festmacht (Heldix-Dienst, Cosmetics, Skin-Cache des Menüs …), erledigen die
 * Zuhörer von {@link #onSwitched} ({@link AccountSwitcher} meldet die eigenen an).
 *
 * <p>Die Felder sind {@code final}; {@link AccountPatches} nimmt das weg (Heldix Loader und Fabric). Netzwerk
 * (Profil, Eigenschaften) läuft vorher im Hintergrund, der Tausch selbst im Render-Thread in einem Rutsch.
 */
public final class SessionSwitcher {
	private record Prepared(User user, UserApiService api, UserApiService.UserProperties properties, ProfileResult profile, FriendsService friends) {
	}

	private static final List<Consumer<User>> LISTENERS = new CopyOnWriteArrayList<>();
	private static Map<String, Field> fields;
	private static Field realmsInstance;
	private static Field realmsAvailability;
	private static String problem;

	private SessionSwitcher() {
	}

	/** Nach jedem Wechsel im Render-Thread (neuer User schon gesetzt). Rückgabe: abmelden. */
	public static Runnable onSwitched(Consumer<User> listener) {
		LISTENERS.add(listener);
		return () -> LISTENERS.remove(listener);
	}

	/** Wechsel jetzt erlaubt: keine Welt, kein Server, kein Verbinden oder Laden */
	public static boolean canSwitchNow(Minecraft mc) {
		if (mc.level != null || mc.player != null || mc.getConnection() != null || mc.getSingleplayerServer() != null) return false;
		Screen screen = mc.gui.screen();
		return !(screen instanceof ConnectScreen) && !(screen instanceof LevelLoadingScreen);
	}

	/** Kann diese Minecraft-Version überhaupt wechseln? Sonst der Grund (für Oberfläche und Autotest). */
	public static synchronized Optional<String> unsupported() {
		resolve();
		return Optional.ofNullable(problem);
	}

	/** Alle Felder ohne final, also hat {@link AccountPatches} gegriffen (für den Autotest) */
	public static synchronized boolean patched() {
		resolve();
		return fields != null && fields.entrySet().stream()
				.filter(e -> AccountPatches.FIELDS.contains(e.getKey()))
				.noneMatch(e -> Modifier.isFinal(e.getValue().getModifiers()));
	}

	/**
	 * Wechselt zu dieser Sitzung. Das Ergebnis kommt im Render-Thread; schlägt es fehl, bleibt die alte Sitzung
	 * vollständig (der Tausch passiert erst, wenn alles vorbereitet ist).
	 */
	public static CompletableFuture<Void> apply(Minecraft mc, LauncherSession session) {
		Optional<String> unsupported = unsupported();
		if (unsupported.isPresent()) {
			return CompletableFuture.failedFuture(new LauncherException("unsupported", unsupported.get()));
		}
		return CompletableFuture.supplyAsync(() -> prepare(mc, session), Util.nonCriticalIoPool())
				.thenAcceptAsync(prepared -> {
					try {
						install(mc, prepared);
					} catch (ReflectiveOperationException e) {
						throw new java.util.concurrent.CompletionException(new LauncherException("unsupported", "Kontowechsel ist in dieser Umgebung nicht möglich."));
					}
					HeldixClient.LOGGER.info("Konto gewechselt: {}", session.name());
					for (Consumer<User> listener : LISTENERS) {
						try {
							listener.accept(prepared.user());
						} catch (RuntimeException e) {
							HeldixClient.LOGGER.warn("Kontowechsel: Fehler beim Aktualisieren", e);
						}
					}
				}, mc::execute);
	}

	/** Im Hintergrund: alles, was Netz braucht (wie im Konstruktor von Minecraft) */
	private static Prepared prepare(Minecraft mc, LauncherSession session) {
		boolean offlineDeveloper = mc.isOfflineDeveloperMode();
		User user = new User(session.name(), session.uuid(), session.accessToken(), Optional.ofNullable(session.xuid()), mc.getUser().getClientId());
		MinecraftServicesDiscoveryService discovery = MinecraftServicesDiscoveryService.create(mc.getProxy(), !offlineDeveloper);
		UserApiService api = UserApiService.OFFLINE;
		if (!offlineDeveloper) {
			try {
				api = discovery.createUserApiService(session.accessToken());
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.warn("Kontowechsel: Mojang-Dienste nicht erreichbar ({})", e.getClass().getSimpleName());
			}
		}
		UserApiService.UserProperties properties;
		try {
			properties = api.fetchProperties();
		} catch (AuthenticationException | RuntimeException e) {
			// wie Minecraft beim Start (Offline-Konten, Mojang nicht erreichbar): ohne besondere Rechte weiter
			properties = UserApiService.OFFLINE_PROPERTIES;
		}
		ProfileResult profile = null;
		if (!offlineDeveloper && !session.offline()) {
			try {
				profile = mc.services().sessionService().fetchProfile(session.uuid(), true);
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.info("Kontowechsel: Profil nicht geladen ({})", e.getClass().getSimpleName());
			}
		}
		FriendsService friends = discovery.createFriendsService(session.accessToken());
		return new Prepared(user, api, properties, profile, friends);
	}

	/** Im Render-Thread: neue Dienste bauen, dann alle Felder auf einmal setzen */
	private static void install(Minecraft mc, Prepared p) throws ReflectiveOperationException {
		if (!canSwitchNow(mc)) {
			throw new java.util.concurrent.CompletionException(new LauncherException("in_world", "Verlasse zuerst die Welt, um das Konto zu wechseln."));
		}
		Map<String, Field> f = fields;
		ProfileKeyPairManager keys = mc.isOfflineDeveloperMode()
				? ProfileKeyPairManager.EMPTY_KEY_MANAGER
				: ProfileKeyPairManager.create(p.api(), p.user(), mc.gameDirectory.toPath());
		ClientTelemetryManager telemetry = new ClientTelemetryManager(mc, p.api(), p.user());
		ReportingContext reporting = ReportingContext.create(ReportEnvironment.local(), p.api());
		RemoteFriendListUpdateHandler friendUpdates = new RemoteFriendListUpdateHandler(p.friends(), mc);
		ClientTelemetryManager oldTelemetry = mc.getTelemetryManager();
		Object oldFriendUpdates = f.get("remoteFriendListUpdateHandler").get(mc);

		f.get("user").set(mc, p.user());
		f.get("userApiService").set(mc, p.api());
		f.get("userPropertiesFuture").set(mc, CompletableFuture.completedFuture(p.properties()));
		f.get("profileFuture").set(mc, CompletableFuture.completedFuture(p.profile()));
		f.get("profileKeyPairManager").set(mc, keys);
		f.get("telemetryManager").set(mc, telemetry);
		f.get("reportingContext").set(mc, reporting);
		f.get("remoteFriendListUpdateHandler").set(mc, friendUpdates);
		// liest die Eigenschaften (Freunde erlaubt?) über Minecraft – darum nach dem Setzen der neuen
		PlayerSocialManager social = new PlayerSocialManager(mc, p.api(), p.friends(), friendUpdates);
		f.get("playerSocialManager").set(mc, social);
		if (social.isFriendListEnabled()) friendUpdates.start();

		// Realms merkt sich Sitzung und Verfügbarkeit statisch
		realmsInstance.set(null, null);
		realmsAvailability.set(null, null);
		f.get("realmsDataFetcher").set(mc, new RealmsDataFetcher(RealmsClient.getOrCreate(mc)));

		try {
			oldTelemetry.close();
		} catch (RuntimeException e) {
			HeldixClient.LOGGER.debug("Kontowechsel: alte Telemetrie nicht geschlossen", e);
		}
		if (oldFriendUpdates instanceof RemoteFriendListUpdateHandler old) {
			try {
				old.close();
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.debug("Kontowechsel: alte Freundesliste nicht beendet", e);
			}
		}
	}

	/** Felder einmal suchen; fehlt etwas, steht der Grund in problem */
	private static void resolve() {
		if (fields != null || problem != null) return;
		try {
			Map<String, Field> found = new LinkedHashMap<>();
			for (String name : AccountPatches.FIELDS) found.put(name, field(Minecraft.class, name));
			found.put("reportingContext", field(Minecraft.class, "reportingContext"));
			realmsInstance = field(RealmsClient.class, "realmsClientInstance");
			realmsAvailability = field(RealmsAvailability.class, "future");
			fields = found;
			List<String> stillFinal = found.entrySet().stream().filter(e -> Modifier.isFinal(e.getValue().getModifiers())).map(Map.Entry::getKey).toList();
			if (!stillFinal.isEmpty()) {
				// ohne Transformer geht es auf Java 25 trotzdem (setAccessible), spätere Java-Versionen sperren das
				HeldixClient.LOGGER.warn("Kontowechsel: Felder noch final ({}) – Transformer AccountPatches nicht angewendet?", String.join(", ", stillFinal));
			}
		} catch (ReflectiveOperationException | RuntimeException e) {
			problem = "Kontowechsel wird von dieser Minecraft-Version nicht unterstützt.";
			HeldixClient.LOGGER.warn("Kontowechsel nicht verfügbar: {}", e.toString());
		}
	}

	private static Field field(Class<?> owner, String name) throws NoSuchFieldException {
		Field field = owner.getDeclaredField(name);
		field.setAccessible(true);
		return field;
	}
}
