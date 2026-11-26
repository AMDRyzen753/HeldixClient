package dev.heldixclient.account;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.heldixclient.HeldixClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.toasts.SystemToast;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.network.chat.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

/**
 * Konto-Wechsel im Spiel – das, was die Oberfläche braucht (Heldix-Menü → Konten, Profil in der Seitenleiste und auf
 * der Startseite): Konten des Launchers, Konto hinzufügen (Microsoft-Anmeldung im Launcher), wechseln, „Welt verlassen
 * und wechseln“. Protokoll: docs/konto-wechsel.md.
 *
 * <p>Nur verfügbar, wenn das Spiel vom HeldixClient-Launcher gestartet wurde und der Launcher den Wechsel erlaubt
 * ({@link #available()}); sonst blendet die Oberfläche ihn aus. Gewechselt wird nur außerhalb einer Welt
 * ({@link #canSwitchHere()}).
 *
 * <p>Fragt der Launcher nach (erster Wechsel zu einem Konto in diesem Spiel) oder öffnet er sein Anmeldefenster,
 * verlässt das Spiel vorher den Vollbildmodus und stellt ihn danach wieder her.
 *
 * <p>Alle Ergebnisse und {@link #addListener Zuhörer} laufen im Render-Thread.
 */
public final class AccountSwitcher {
	public enum Phase {
		IDLE,
		/** Microsoft-Fenster des Launchers ist offen */
		SIGNING_IN,
		/** Sitzung holen (ggf. Bestätigung im Launcher) und tauschen */
		SWITCHING,
		/** Welt wird verlassen, danach wird gewechselt */
		LEAVING
	}

	private static final Duration LIST_TIMEOUT = Duration.ofSeconds(10);
	/** Bestätigung im Launcher (bis 2 Minuten) und Erneuern bei Microsoft, Xbox und Minecraft */
	private static final Duration SESSION_TIMEOUT = Duration.ofMinutes(3);
	/** so lange darf man sich im Microsoft-Fenster Zeit lassen */
	private static final Duration SIGN_IN_TIMEOUT = Duration.ofMinutes(15);
	private static final long LEAVE_TIMEOUT_MS = 30_000;

	private static volatile List<LauncherAccount> accounts = List.of();
	private static volatile boolean loaded;
	private static volatile Phase phase = Phase.IDLE;
	/** Hinweis für die Oberfläche (läuft gerade, letzter Fehler), sonst null */
	private static volatile String status;
	/** status ist ein Fehler (sonst ein Hinweis, z. B. „läuft“) */
	private static volatile boolean statusError;
	private static final List<Runnable> LISTENERS = new CopyOnWriteArrayList<>();
	private static boolean initialized;
	/** Konto, mit dem das Spiel gestartet wurde (der Launcher fragt dafür nicht nach) */
	private static volatile UUID launchUuid;
	/** Konten (IDs des Launchers), zu denen in diesem Spiel schon gewechselt oder die hier angemeldet wurden */
	private static final Set<String> CONFIRMED = ConcurrentHashMap.newKeySet();
	/** Vollbild für ein Fenster des Launchers verlassen: danach wiederherstellen */
	private static boolean leftFullscreen;

	private AccountSwitcher() {
	}

	/** Einmal beim Start der Mod (HeldixClient.onInitialize) */
	public static synchronized void init() {
		if (initialized) return;
		initialized = true;
		LauncherLink.onEvent(event -> {
			switch (event) {
				case LauncherLink.EVENT_READY -> onMain(() -> {
					if (launchUuid == null) launchUuid = Minecraft.getInstance().getUser().getProfileId();
					refresh();
				});
				case "accounts.changed" -> onMain(AccountSwitcher::refresh);
				case LauncherLink.EVENT_CLOSED -> onMain(() -> {
					accounts = List.of();
					loaded = false;
					changed();
				});
				default -> {
				}
			}
		});
		// was HeldixClient selbst am Konto festmacht: Skin im Menü, Heldix-Dienst (Freunde, Nachrichten, Rolle), Cosmetics
		SessionSwitcher.onSwitched(user -> {
			dev.heldixclient.ui.Shell.forgetSkin();
			dev.heldixclient.social.Social.accountChanged();
			// meldet sich der Dienst gleich neu an, kommen die Cosmetics des neuen Kontos von dort
			if (dev.heldixclient.social.Social.state() == dev.heldixclient.social.Social.State.CONNECTING) {
				dev.heldixclient.cosmetic.Cosmetics.forgetMine();
			}
		});
		LauncherLink.start();
	}

	/** Vom Launcher gestartet, verbunden und im Launcher erlaubt: Kontowechsel zeigen */
	public static boolean available() {
		return LauncherLink.ready() && LauncherLink.allowed();
	}

	/** Grund, warum der Wechsel fehlt (für die Seite Konten), null = verfügbar */
	public static String unavailableReason() {
		return switch (LauncherLink.state()) {
			case OFF -> "Starte das Spiel über den HeldixClient-Launcher, dann wechselst du hier zwischen deinen Konten.";
			case CONNECTING -> "Verbinde mit dem Launcher …";
			case CLOSED -> "Der Launcher ist nicht mehr verbunden. Starte das Spiel neu über den Launcher, um das Konto zu wechseln.";
			case READY -> LauncherLink.allowed() ? null
					: "Kontowechsel im Spiel ist im Launcher ausgeschaltet (Einstellungen → Spiel → „Kontowechsel im Spiel erlauben“).";
		};
	}

	/** Konten des Launchers (ohne Tokens), wie zuletzt geladen */
	public static List<LauncherAccount> accounts() {
		return accounts;
	}

	public static boolean loaded() {
		return loaded;
	}

	public static Phase phase() {
		return phase;
	}

	public static String status() {
		return status;
	}

	public static boolean statusError() {
		return statusError;
	}

	/** Hinweis vergessen (Seite neu geöffnet), solange gerade nichts läuft */
	public static void clearStatus() {
		if (phase != Phase.IDLE) return;
		status = null;
		statusError = false;
	}

	/** Das Konto, mit dem das Spiel gerade angemeldet ist */
	public static boolean isCurrent(LauncherAccount account) {
		return account.uuid().equals(Minecraft.getInstance().getUser().getProfileId());
	}

	/** Fragt der Launcher beim Wechsel zu diesem Konto nach? (erster Wechsel in diesem Spiel, nicht das Startkonto) */
	public static boolean needsConfirmation(LauncherAccount account) {
		return !account.uuid().equals(launchUuid) && !CONFIRMED.contains(account.id());
	}

	/** Gerade wechseln möglich (keine Welt)? Sonst bietet die Oberfläche „Welt verlassen und wechseln“ an. */
	public static boolean canSwitchHere() {
		return SessionSwitcher.canSwitchNow(Minecraft.getInstance());
	}

	/** Oberfläche neu zeichnen, wenn sich etwas ändert (Render-Thread). Rückgabe: abmelden. */
	public static Runnable addListener(Runnable listener) {
		LISTENERS.add(listener);
		return () -> LISTENERS.remove(listener);
	}

	/** Konten neu laden */
	public static CompletableFuture<List<LauncherAccount>> refresh() {
		return LauncherLink.request("accounts.list", null, LIST_TIMEOUT)
				.thenApplyAsync(result -> {
					accounts = parseAccounts(result);
					loaded = true;
					changed();
					return accounts;
				}, AccountSwitcher::onMain)
				.whenComplete((list, error) -> {
					if (error != null) HeldixClient.LOGGER.info("Konten nicht geladen: {}", LauncherException.describe(error));
				});
	}

	/**
	 * Neues Microsoft-Konto über den Launcher anmelden (sein Anmeldefenster öffnet sich). switchAfter: danach gleich
	 * wechseln, wenn das hier geht – in einer Welt wird das Konto nur hinzugefügt.
	 */
	public static CompletableFuture<LauncherAccount> addAccount(boolean switchAfter) {
		if (!available()) return fail(new LauncherException("not_allowed", unavailableReason()));
		if (phase != Phase.IDLE) return busy();
		Minecraft mc = Minecraft.getInstance();
		leaveFullscreen(mc);
		setPhase(Phase.SIGNING_IN, "Melde dich im Anmeldefenster von Microsoft an, das der Launcher geöffnet hat …", false);
		toast(mc, "Anmelden im Launcher", "Melde dich im Fenster von Microsoft an.");
		return LauncherLink.request("accounts.add", null, SIGN_IN_TIMEOUT)
				.thenApplyAsync(result -> {
					accounts = parseAccounts(result);
					loaded = true;
					LauncherAccount added = result.has("account") ? LauncherAccount.fromJson(result.get("account")).orElse(null) : null;
					if (added == null) throw new CompletionException(new LauncherException("bad_response", "Der Launcher hat kein Konto zurückgegeben."));
					// im Anmeldefenster bestätigt: der Launcher fragt beim Wechsel nicht noch einmal
					CONFIRMED.add(added.id());
					return added;
				}, AccountSwitcher::onMain)
				.handleAsync((added, error) -> {
					restoreFullscreen(mc);
					if (error != null) {
						LauncherException failure = LauncherException.of(error);
						boolean cancelled = failure != null && failure.cancelled();
						setPhase(Phase.IDLE, cancelled ? "Anmeldung abgebrochen." : LauncherException.describe(error), !cancelled);
						throw error instanceof CompletionException completion ? completion : new CompletionException(error);
					}
					setPhase(Phase.IDLE, null, false);
					if (switchAfter && canSwitchHere() && !isCurrent(added)) switchTo(added);
					else if (!canSwitchHere()) setPhase(Phase.IDLE, "„" + added.name() + "“ hinzugefügt – verlasse die Welt, um zu wechseln.", false);
					return added;
				}, AccountSwitcher::onMain);
	}

	/** Zu diesem Konto wechseln (nur außerhalb einer Welt). Danach ist es auch im Launcher aktiv. */
	public static CompletableFuture<Void> switchTo(LauncherAccount account) {
		if (!available()) return fail(new LauncherException("not_allowed", unavailableReason()));
		if (phase != Phase.IDLE && phase != Phase.LEAVING) return busy();
		Minecraft mc = Minecraft.getInstance();
		if (!SessionSwitcher.canSwitchNow(mc)) {
			return fail(new LauncherException("in_world", "Verlasse zuerst die Welt, um das Konto zu wechseln."));
		}
		if (isCurrent(account)) {
			if (phase == Phase.LEAVING) setPhase(Phase.IDLE, null, false);
			return CompletableFuture.completedFuture(null);
		}
		Optional<String> unsupported = SessionSwitcher.unsupported();
		if (unsupported.isPresent()) return fail(new LauncherException("unsupported", unsupported.get()));
		boolean confirm = needsConfirmation(account);
		if (confirm) {
			// der Launcher öffnet ein Fenster zum Bestätigen: im Vollbild sähe man es nicht
			leaveFullscreen(mc);
			setPhase(Phase.SWITCHING, "Bestätige den Wechsel zu " + account.name() + " im Fenster des Launchers …", false);
			toast(mc, "Bestätigen im Launcher", "Wechsel zu " + account.name() + " im Launcher-Fenster bestätigen.");
		} else {
			setPhase(Phase.SWITCHING, "Wechsle zu " + account.name() + " …", false);
		}
		JsonObject params = new JsonObject();
		params.addProperty("account", account.id());
		return LauncherLink.request("accounts.session", params, SESSION_TIMEOUT)
				.thenComposeAsync(result -> {
					restoreFullscreen(mc);
					CONFIRMED.add(account.id());
					try {
						return SessionSwitcher.apply(mc, LauncherSession.fromJson(result, account));
					} catch (LauncherException e) {
						return CompletableFuture.failedFuture(e);
					}
				}, AccountSwitcher::onMain)
				.handleAsync((ignored, error) -> {
					restoreFullscreen(mc);
					if (error != null) {
						setPhase(Phase.IDLE, LauncherException.describe(error), true);
						throw error instanceof CompletionException completion ? completion : new CompletionException(error);
					}
					setPhase(Phase.IDLE, null, false);
					toast(mc, "Konto gewechselt", "Du spielst jetzt als " + account.name() + ".");
					refreshScreen(mc);
					// der nächste Start aus dem Launcher nutzt dieses Konto; die Liste kommt gleich mit
					LauncherLink.request("accounts.setActive", params, LIST_TIMEOUT)
							.thenAcceptAsync(r -> {
								accounts = parseAccounts(r);
								changed();
							}, AccountSwitcher::onMain)
							.exceptionally(e -> {
								HeldixClient.LOGGER.info("Konto im Launcher nicht aktiv gesetzt: {}", LauncherException.describe(e));
								return null;
							});
					return null;
				}, AccountSwitcher::onMain);
	}

	/** In einer Welt: speichern und verlassen (wie „Speichern und verlassen“), dann wechseln */
	public static CompletableFuture<Void> leaveWorldAndSwitch(LauncherAccount account) {
		if (!available()) return fail(new LauncherException("not_allowed", unavailableReason()));
		if (phase != Phase.IDLE) return busy();
		Minecraft mc = Minecraft.getInstance();
		if (SessionSwitcher.canSwitchNow(mc)) return switchTo(account);
		setPhase(Phase.LEAVING, "Verlasse die Welt …", false);
		CompletableFuture<Void> left = new CompletableFuture<>();
		onMain(() -> {
			try {
				if (mc.level != null) mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE);
				waitOutsideWorld(mc, System.currentTimeMillis() + LEAVE_TIMEOUT_MS, left);
			} catch (RuntimeException e) {
				left.completeExceptionally(e);
			}
		});
		return left.thenCompose(ignored -> switchTo(account))
				.whenComplete((ignored, error) -> {
					if (error != null && phase == Phase.LEAVING) onMain(() -> setPhase(Phase.IDLE, LauncherException.describe(error), true));
				});
	}

	/** Das Speichern einer Einzelspielerwelt kann ein paar Ticks dauern */
	private static void waitOutsideWorld(Minecraft mc, long deadline, CompletableFuture<Void> done) {
		if (SessionSwitcher.canSwitchNow(mc)) {
			done.complete(null);
		} else if (System.currentTimeMillis() > deadline) {
			done.completeExceptionally(new LauncherException("in_world", "Die Welt ließ sich nicht verlassen."));
		} else {
			CompletableFuture.delayedExecutor(100, TimeUnit.MILLISECONDS).execute(() -> onMain(() -> waitOutsideWorld(mc, deadline, done)));
		}
	}

	/** Vollbild verlassen, ohne die Einstellung zu ändern (Fenster des Launchers wären sonst verdeckt) */
	private static void leaveFullscreen(Minecraft mc) {
		if (leftFullscreen || !mc.options.fullscreen().get()) return;
		leftFullscreen = true;
		mc.getWindow().setFullscreen(false);
	}

	/** Vollbild wiederherstellen – wenn es der Spieler inzwischen nicht selbst ausgeschaltet hat */
	private static void restoreFullscreen(Minecraft mc) {
		if (!leftFullscreen) return;
		leftFullscreen = false;
		if (mc.options.fullscreen().get()) mc.getWindow().setFullscreen(true);
	}

	/** Startseite neu aufbauen (Name, Figur, Realms); andere Menüs neu anordnen */
	private static void refreshScreen(Minecraft mc) {
		Screen screen = mc.gui.screen();
		if (screen instanceof TitleScreen) {
			mc.gui.setScreen(new TitleScreen());
		} else if (screen != null) {
			screen.resize(mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight());
		}
	}

	private static void toast(Minecraft mc, String title, String message) {
		SystemToast.addOrUpdate(mc.gui.toastManager(), SystemToast.SystemToastId.PERIODIC_NOTIFICATION, Component.literal(title), Component.literal(message));
	}

	private static List<LauncherAccount> parseAccounts(JsonObject result) {
		LauncherLink.updateAllowed(result);
		JsonElement list = result.get("accounts");
		if (list == null || !list.isJsonArray()) return accounts;
		List<LauncherAccount> parsed = new ArrayList<>();
		JsonArray array = list.getAsJsonArray();
		for (int i = 0; i < Math.min(array.size(), 100); i++) {
			LauncherAccount.fromJson(array.get(i)).filter(a -> !a.offline() || LauncherLink.offlineAllowed()).ifPresent(parsed::add);
		}
		return List.copyOf(parsed);
	}

	private static void setPhase(Phase next, String text, boolean error) {
		phase = next;
		status = text;
		statusError = error;
		changed();
	}

	private static void changed() {
		for (Runnable listener : LISTENERS) {
			try {
				listener.run();
			} catch (RuntimeException e) {
				HeldixClient.LOGGER.warn("Konto-Wechsel: Fehler in der Oberfläche", e);
			}
		}
	}

	/** Im Render-Thread ausführen (beim ganz frühen Start, bevor es Minecraft gibt: kurz warten) */
	private static void onMain(Runnable task) {
		Minecraft mc = Minecraft.getInstance();
		if (mc == null) {
			CompletableFuture.delayedExecutor(200, TimeUnit.MILLISECONDS).execute(() -> onMain(task));
			return;
		}
		mc.execute(task);
	}

	private static <T> CompletableFuture<T> busy() {
		return CompletableFuture.failedFuture(new LauncherException("switching", "Einen Moment – es läuft schon ein Kontowechsel."));
	}

	private static <T> CompletableFuture<T> fail(LauncherException error) {
		status = error.getMessage();
		statusError = true;
		changed();
		return CompletableFuture.failedFuture(error);
	}
}
