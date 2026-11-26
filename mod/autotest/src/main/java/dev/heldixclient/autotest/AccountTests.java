package dev.heldixclient.autotest;

import dev.heldixclient.account.AccountSwitcher;
import dev.heldixclient.account.LauncherAccount;
import dev.heldixclient.account.LauncherLink;
import dev.heldixclient.account.SessionSwitcher;
import dev.heldixclient.screen.HeldixMenuScreen;
import dev.heldixclient.screen.ProfileButton;
import dev.heldixclient.social.Social;
import dev.heldixclient.ui.Shell;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.toasts.SystemToast;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;

import java.util.List;
import java.util.Optional;

/**
 * Kontowechsel im Spiel (docs/konto-wechsel.md). test:launch startet das Spiel mit {@code -Dheldixclient.ipc=1} und
 * beantwortet die Anfragen wie der Launcher, mit zwei Offline-Konten (nur in der Entwicklung erlaubt): dem Startkonto
 * und einem zweiten. Über Zeilen „HELDIX-AUTOTEST-KONTO: …“ im Log schaltet der Test dort den Wechsel aus und wieder an
 * und beendet am Ende die Verbindung (stdin zu).
 */
final class AccountTests {
	/** Startkonto und zweites Konto aus dem Launcher */
	private static LauncherAccount home;
	private static LauncherAccount other;

	private AccountTests() {
	}

	/** vom Launcher (test:launch) mit Kontowechsel gestartet? */
	static boolean ipc() {
		return System.getProperty("heldixclient.ipc") != null;
	}

	/** Hauptmenü: Transformer, Seite Konten, Wechsel zum zweiten Konto (über die Seite) und zurück, Anmeldung abgebrochen */
	static void titleScreen(TestContext t) {
		t.check("Kontowechsel: Felder in Minecraft sind nicht mehr final (AccountPatches)", t.compute(mc -> SessionSwitcher.patched()));
		t.check("Kontowechsel: diese Minecraft-Version wird unterstützt", t.compute(mc -> SessionSwitcher.unsupported().isEmpty()));
		if (!ipc()) {
			hidden(t, "ohne Launcher");
			return;
		}
		t.waitFor("Verbindung zum Launcher (hello und Konten)", mc -> AccountSwitcher.available() && AccountSwitcher.loaded(), 30);
		List<LauncherAccount> accounts = t.compute(mc -> AccountSwitcher.accounts());
		t.log("Konten im Launcher " + accounts.stream().map(a -> a.name() + (a.active() ? " (aktiv)" : "")).toList());
		t.check("Kontowechsel: zwei Konten aus dem Launcher", accounts.size() == 2);
		home = t.compute(mc -> accounts.stream().filter(AccountSwitcher::isCurrent).findFirst().orElse(null));
		other = t.compute(mc -> accounts.stream().filter(a -> !AccountSwitcher.isCurrent(a)).findFirst().orElse(null));
		t.check("Kontowechsel: Startkonto ist im Spiel und im Launcher aktiv", home != null && home.active());
		t.check("Kontowechsel: Startkonto ohne Nachfrage, zweites Konto mit Nachfrage im Launcher",
				t.compute(mc -> !AccountSwitcher.needsConfirmation(home) && AccountSwitcher.needsConfirmation(other)));

		// Seite Konten im Heldix-Menü
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.ACCOUNTS));
		t.waitTicks(10);
		t.check("Kontowechsel: „Konten“ steht in der Seitenleiste", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).navIds().contains("ACCOUNTS")));
		List<String> rows = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeAccounts());
		t.log("Seite Konten " + rows);
		t.check("Kontowechsel: Seite zeigt das Startkonto mit „Im Spiel“ und „Aktiv im Launcher“", rows.contains(home.name() + ":im-spiel:aktiv"));
		t.check("Kontowechsel: Seite bietet beim zweiten Konto „Wechseln“", rows.contains(other.name() + ":wechseln"));
		t.moveMouse(5, 5);
		t.screenshot("konto-01-seite");

		Object keysBefore = t.compute(Minecraft::getProfileKeyPairManager);
		Object telemetryBefore = t.compute(Minecraft::getTelemetryManager);
		Object realmsBefore = t.compute(Minecraft::realmsDataFetcher);
		Object skinBefore = t.compute(Shell::skin);
		int socialBefore = Social.accountChanges();

		// wie ein Spieler: Knopf „Wechseln“ beim zweiten Konto
		int[] button = buttonOf(t, other);
		t.check("Kontowechsel: Knopf „Wechseln“ ist zu sehen", button != null);
		t.click(button[0], button[1]);
		t.waitFor("Wechsel zu " + other.name(), mc -> mc.getUser().getName().equals(other.name()) && AccountSwitcher.phase() == AccountSwitcher.Phase.IDLE, 60);
		t.check("Kontowechsel: Name und UUID im Spiel", t.compute(mc -> mc.getUser().getName().equals(other.name()) && mc.getUser().getProfileId().equals(other.uuid())));
		t.check("Kontowechsel: Profil (GameProfile) gehört zum neuen Konto", t.compute(mc -> mc.getGameProfile().name().equals(other.name())
				&& mc.getGameProfile().id().equals(other.uuid())));
		t.check("Kontowechsel: Schlüssel für die Chat-Signatur neu angelegt", t.compute(Minecraft::getProfileKeyPairManager) != keysBefore);
		t.check("Kontowechsel: Telemetrie und Realms neu angelegt", t.compute(Minecraft::getTelemetryManager) != telemetryBefore
				&& t.compute(Minecraft::realmsDataFetcher) != realmsBefore);
		t.check("Kontowechsel: Skin im Menü neu geladen", t.compute(Shell::skin) != skinBefore);
		t.check("Kontowechsel: Heldix-Dienst meldet sich mit dem neuen Konto neu an",
				Social.accountChanges() == socialBefore + 1 && other.uuid().equals(Social.accountChangedTo()));
		t.check("Kontowechsel: Einblendung „Konto gewechselt“", t.compute(mc -> mc.gui.toastManager()
				.getToast(SystemToast.class, SystemToast.SystemToastId.PERIODIC_NOTIFICATION) != null));
		t.check("Kontowechsel: danach ohne Nachfrage", t.compute(mc -> !AccountSwitcher.needsConfirmation(other)));
		t.check("Kontowechsel: im Launcher ist jetzt das neue Konto aktiv", t.waitSoft(mc -> AccountSwitcher.accounts().stream()
				.anyMatch(a -> a.id().equals(other.id()) && a.active()), 10));
		t.waitTicks(5);
		rows = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeAccounts());
		t.check("Kontowechsel: Menü zeigt das neue Konto als „Im Spiel“", rows.contains(other.name() + ":im-spiel:aktiv")
				&& rows.contains(home.name() + ":wechseln"));
		t.moveMouse(5, 5);
		t.screenshot("konto-02-gewechselt");

		// Startseite: Name im Profil oben rechts; Klick darauf öffnet die Konten
		t.setScreen(TitleScreen::new);
		t.waitTicks(15);
		t.screenshot("konto-03-startseite");
		Optional<ProfileButton> chip = t.compute(mc -> mc.gui.screen().children().stream()
				.filter(w -> w instanceof ProfileButton).map(w -> (ProfileButton) w).findFirst());
		if (chip.isPresent() && chip.get().visible) {
			t.click(chip.get().getX() + chip.get().getWidth() / 2.0, chip.get().getY() + 10);
			t.waitTicks(5);
			t.check("Startseite: Klick aufs Profil öffnet die Konten", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu
					&& "ACCOUNTS".equals(menu.currentTab())));
		} else {
			t.log("Profil oben rechts im kleinen Fenster nicht zu sehen");
		}

		// Seitenleiste: Profil unten öffnet die Konten
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(5);
		Optional<ProfileButton> footer = t.compute(mc -> mc.gui.screen().children().stream()
				.filter(w -> w instanceof ProfileButton).map(w -> (ProfileButton) w).findFirst());
		if (footer.isPresent()) {
			t.check("Seitenleiste: Profil unten ist anklickbar", footer.get().isActive());
			t.click(footer.get().getX() + footer.get().getWidth() / 2.0, footer.get().getY() + footer.get().getHeight() / 2.0);
			t.waitTicks(5);
			t.check("Seitenleiste: Klick aufs Profil öffnet die Konten", t.compute(mc -> mc.gui.screen() instanceof HeldixMenuScreen menu
					&& "ACCOUNTS".equals(menu.currentTab())));
		} else {
			t.log("Seitenleiste ohne Profil (kleines Fenster)");
		}

		// zurück zum Startkonto (der Launcher fragt dafür nicht nach)
		t.run(mc -> AccountSwitcher.switchTo(home));
		t.waitFor("Wechsel zurück zu " + home.name(), mc -> mc.getUser().getName().equals(home.name()) && AccountSwitcher.phase() == AccountSwitcher.Phase.IDLE, 60);
		t.check("Kontowechsel: zurück beim Startkonto", t.compute(mc -> mc.getUser().getProfileId().equals(home.uuid())));

		// Konto hinzufügen: der Test-Launcher bricht die Anmeldung ab
		t.run(mc -> AccountSwitcher.addAccount(true));
		t.waitFor("Anmeldung im Launcher beendet", mc -> AccountSwitcher.phase() == AccountSwitcher.Phase.IDLE, 20);
		t.check("Konto hinzufügen: abgebrochen im Launcher → Hinweis im Spiel", "Anmeldung abgebrochen.".equals(AccountSwitcher.status())
				&& t.compute(mc -> mc.getUser().getName().equals(home.name())));
		t.setScreen(TitleScreen::new);
		t.waitForScreen(TitleScreen.class, 10);
	}

	/**
	 * Ende der Welt: In der Welt ist der Wechsel gesperrt, die Seite Konten bietet „Welt verlassen und wechseln“ (zweiter
	 * Klick bestätigt). Verlässt die Welt – ohne Launcher wie bisher über disconnectFromWorld.
	 */
	static void leaveWorld(TestContext t) {
		if (!ipc() || other == null) {
			t.run(mc -> mc.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE));
			return;
		}
		t.check("In der Welt: Wechsel gesperrt", !t.compute(mc -> AccountSwitcher.canSwitchHere()));
		boolean refused = t.compute(mc -> AccountSwitcher.switchTo(other).isCompletedExceptionally());
		t.check("In der Welt: switchTo lehnt ab („Verlasse zuerst die Welt“)", refused && String.valueOf(AccountSwitcher.status()).contains("Welt"));
		t.check("In der Welt: weiter mit dem Startkonto", t.compute(mc -> mc.getUser().getName().equals(home.name()) && mc.level != null));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.ACCOUNTS));
		t.waitTicks(10);
		List<String> rows = t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).describeAccounts());
		t.check("In der Welt: Seite Konten bietet „Welt verlassen und wechseln“", rows.contains(other.name() + ":welt-verlassen"));
		t.moveMouse(5, 5);
		t.screenshot("konto-04-in-der-welt");
		int[] button = buttonOf(t, other);
		t.click(button[0], button[1]);
		t.waitTicks(3);
		t.check("In der Welt: erster Klick fragt nur nach („Wirklich verlassen?“)", t.compute(mc -> mc.level != null
				&& mc.getUser().getName().equals(home.name())
				&& ((HeldixMenuScreen) mc.gui.screen()).describeAccounts().contains(other.name() + ":welt-verlassen-bestaetigen")));
		t.screenshot("konto-05-welt-verlassen-bestaetigen");
		int[] confirm = buttonOf(t, other);
		t.click(confirm[0], confirm[1]);
		t.waitFor("Welt verlassen und zu " + other.name() + " gewechselt", mc -> mc.level == null && mc.getUser().getName().equals(other.name())
				&& AccountSwitcher.phase() == AccountSwitcher.Phase.IDLE && mc.gui.screen() instanceof TitleScreen, 120);
		t.check("Welt verlassen und wechseln: Welt verlassen, neues Konto im Spiel", t.compute(mc -> mc.level == null && mc.getUser().getProfileId().equals(other.uuid())));
		t.waitTicks(10);
		t.screenshot("konto-06-nach-welt-verlassen");
	}

	/** Ganz am Ende: zurück zum Startkonto, im Launcher aus- und wieder einschalten, dann Verbindung beenden */
	static void end(TestContext t) {
		if (!ipc() || home == null) return;
		t.setScreen(TitleScreen::new);
		t.run(mc -> AccountSwitcher.switchTo(home));
		t.waitFor("Wechsel zurück zu " + home.name(), mc -> mc.getUser().getName().equals(home.name()) && AccountSwitcher.phase() == AccountSwitcher.Phase.IDLE, 60);

		// Einstellung „Kontowechsel im Spiel erlauben“ im Launcher aus (test:launch liest diese Zeile)
		t.log("HELDIX-AUTOTEST-KONTO: erlaubt=aus");
		t.waitFor("Launcher hat den Kontowechsel ausgeschaltet", mc -> LauncherLink.ready() && !AccountSwitcher.available(), 20);
		hidden(t, "im Launcher ausgeschaltet");
		boolean refused = t.compute(mc -> AccountSwitcher.switchTo(other)).handle((ok, error) -> error != null).join();
		t.check("Ausgeschaltet: Wechsel wird abgelehnt", refused);
		t.log("HELDIX-AUTOTEST-KONTO: erlaubt=an");
		t.waitFor("Launcher hat den Kontowechsel wieder eingeschaltet", mc -> AccountSwitcher.available(), 20);
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(3);
		t.check("Wieder eingeschaltet: „Konten“ in der Seitenleiste", t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).navIds().contains("ACCOUNTS")));

		// Launcher beendet: stdin zu
		t.log("HELDIX-AUTOTEST-KONTO: launcher-weg");
		t.waitFor("Verbindung zum Launcher beendet", mc -> LauncherLink.state() == LauncherLink.State.CLOSED, 20);
		hidden(t, "Launcher beendet");
		t.setScreen(TitleScreen::new);
	}

	/** Knopf eines Kontos auf der offenen Seite Konten: erst in den sichtbaren Bereich scrollen, dann die Mitte aus dem Bild */
	private static int[] buttonOf(TestContext t, LauncherAccount account) {
		t.run(mc -> ((HeldixMenuScreen) mc.gui.screen()).scrollToAccount(account.name()));
		t.waitTicks(3);
		return t.compute(mc -> ((HeldixMenuScreen) mc.gui.screen()).accountButtonCenter(account.name()));
	}

	/** Kontowechsel ist nirgends zu sehen: Seitenleiste, Profil unten, Seite Konten zeigt nur den Grund */
	private static void hidden(TestContext t, String why) {
		t.check("Kontowechsel ausgeblendet (" + why + ")", !t.compute(mc -> AccountSwitcher.available()));
		t.setScreen(() -> new HeldixMenuScreen(null));
		t.waitTicks(5);
		t.check("Kontowechsel ausgeblendet (" + why + "): nicht in der Seitenleiste",
				t.compute(mc -> !((HeldixMenuScreen) mc.gui.screen()).navIds().contains("ACCOUNTS")));
		t.check("Kontowechsel ausgeblendet (" + why + "): Profil unten nicht anklickbar", t.compute(mc -> mc.gui.screen().children().stream()
				.filter(w -> w instanceof ProfileButton).noneMatch(w -> ((ProfileButton) w).isActive())));
		t.setScreen(() -> new HeldixMenuScreen(null, Shell.Page.ACCOUNTS));
		t.waitTicks(5);
		t.check("Kontowechsel ausgeblendet (" + why + "): Seite Konten nennt nur den Grund", t.compute(mc ->
				((HeldixMenuScreen) mc.gui.screen()).describeRows()).equals(List.of("EmptyState")));
		t.screenshot("konto-07-ausgeblendet-" + why.replaceAll("[^a-zA-Zäöü]+", "-").toLowerCase(java.util.Locale.ROOT));
	}
}
