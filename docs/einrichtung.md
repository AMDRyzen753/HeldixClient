# Einrichtung: Microsoft-Login und Discord-Status

Beides braucht eine App-Registrierung beim jeweiligen Anbieter. Die IDs dieses Projekts stehen schon in [launcher/src/main/config.ts](../launcher/src/main/config.ts). Diese Anleitung ist für alle, die einen eigenen Build mit eigenen IDs ausliefern möchten.

Beide IDs sind keine Geheimnisse und dürfen im Code stehen. Einen geheimen Clientschlüssel (Client Secret) braucht der Launcher nicht. Nur für die [Anmeldung auf der Webseite mit dem Minecraft-Konto](#anmeldung-auf-der-webseite-mit-dem-minecraft-konto) bekommt der Heldix-Dienst (nicht der Launcher) auf Wunsch einen; der liegt nur auf dem Server, nie im Code und nie im Repository.

## Microsoft-Login

### 1. App bei Microsoft registrieren

1. Im [Azure-Portal](https://portal.azure.com) **App-Registrierungen** öffnen und auf **Neue Registrierung** klicken.
2. Name: z. B. `HeldixClient`.
3. Unterstützte Kontotypen: **Nur persönliche Microsoft-Konten**.
4. Umleitungs-URI: Plattform **Öffentlicher Client/nativ (mobil und Desktop)**, Adresse `https://login.microsoftonline.com/common/oauth2/nativeclient`.
5. Nach dem Registrieren die **Anwendungs-ID (Client)** kopieren.

### 2. ID eintragen

In [config.ts](../launcher/src/main/config.ts) bei `MICROSOFT_CLIENT_ID` eintragen oder beim Bauen die Umgebungsvariable `HELDIX_MS_CLIENT_ID` setzen.

### 3. Freischaltung bei Mojang beantragen

Neue Apps dürfen die Minecraft-Schnittstellen erst nach einer Prüfung durch Mojang nutzen.

- Formular: <https://aka.ms/mce-reviewappid>, Anfrageart **New AppID for Approval**.
- Gefragt werden Name, Application (Client) ID, Tenant ID, eine Website und eine Begründung.
- Die Prüfung kann einige Tage bis Wochen dauern.

Bis zur Freigabe klappt die Anmeldung bei Microsoft zwar, danach antwortet Minecraft aber mit „Invalid app registration“ und der Launcher meldet: „Mojang lässt die Microsoft-Anmeldung dieses Launchers nicht zu …“. Das gilt für alle Konten, bis Mojang die App freigibt. Die Antwort kommt per E-Mail („approved for our allow list“); danach ist im Code nichts zu ändern, solange die freigegebene ID in `config.ts` steht.

**Stand HeldixClient:** Die App-ID in [config.ts](../launcher/src/main/config.ts) ist seit November 2026 von Mojang freigegeben.

Zum Testen ohne freigegebene App-ID: den Launcher aus dem Quellcode starten (`npm start`). In dieser Entwicklungsversion gehen Offline-Konten, also Einzelspieler, LAN und Server ohne Online-Modus. Für Server mit Online-Modus braucht es eine echte Anmeldung. Die fertige App kennt keine Offline-Konten.

> Bis Version 0.13 gab es zusätzlich eine Anmeldung über den offiziellen Minecraft Launcher („Brücke“). Seit der Freigabe durch Mojang ist sie entfernt. Ab 0.13 entfernt der Launcher beim Start die alte Installation „HeldixClient“ aus dem offiziellen Launcher ([core/officialcleanup.ts](../launcher/src/main/core/officialcleanup.ts)); Konten, die darüber angemeldet waren, melden sich nach Ablauf einmal neu mit Microsoft an.

### So läuft die Anmeldung ab

Microsoft (OAuth 2.0 mit PKCE) → Xbox Live → XSTS → Minecraft-Dienste → Profil. Der Code steht in [core/auth.ts](../launcher/src/main/core/auth.ts), das Anmeldefenster in [auth-window.ts](../launcher/src/main/auth-window.ts). Tokens speichert der Launcher nur lokal und mit Windows-DPAPI verschlüsselt.

## Anmeldung auf der Webseite mit dem Minecraft-Konto

Ab Heldix-Dienst 1.7.0 können sich Spieler auf der Webseite (`/konto`, `/team`) direkt mit ihrem Minecraft-Konto anmelden, ohne den Umweg über den Launcher. Die Anmeldung läuft bei Microsoft; der Heldix-Dienst macht denselben Weg wie der Launcher (Xbox Live → XSTS → Minecraft-Dienste → Profil) auf dem Server, übernimmt nur UUID und Namen und verwirft alle Tokens sofort. Ablauf, Routen und Fehlercodes: [docs/dienst.md](dienst.md#webseite-anmeldung-mit-dem-minecraft-konto).

> **Dieselbe App-Registrierung wie der Launcher.** Mojang hat die Minecraft-Schnittstellen für genau diese Anwendungs-ID freigegeben (seit 26.11.2026, siehe oben). Für die Webseite deshalb **keine neue App registrieren** und nie die ID einer anderen App eintragen: Damit antworten die Minecraft-Dienste mit „Invalid app registration“, und jede Anmeldung endet mit „Die Minecraft-Dienste haben die Anmeldung abgelehnt“.

Einmal im [Azure-Portal](https://portal.azure.com) (als Besitzer der App-Registrierung) und auf dem Server:

1. **App öffnen:** **App-Registrierungen** → die vorhandene App „HeldixClient“ öffnen. Die **Anwendungs-ID (Client)** muss genau `MICROSOFT_CLIENT_ID` aus [config.ts](../launcher/src/main/config.ts) sein. Die unterstützten Kontotypen bleiben „Nur persönliche Microsoft-Konten“.
2. **Umleitungs-URI eintragen:** **Authentifizierung** → **Plattform hinzufügen** → **Web**. Umleitungs-URI:

   ```text
   https://<api-domain>/v1/web/auth/microsoft/callback
   ```

   Bei HeldixClient also `https://api.heldixclient.com/v1/web/auth/microsoft/callback`. Genau so, mit `https://`, ohne Schrägstrich am Ende: Der Dienst baut sie aus `HELDIX_DIENST_API_URL` und schickt sie bei jeder Anmeldung mit; weicht sie ab, zeigt Microsoft eine Fehlerseite (AADSTS50011). Die Häkchen für „Zugriffstoken“ und „ID-Token“ (impliziter Fluss) **nicht** setzen, die Abmelde-URL bleibt leer. Speichern. Die vorhandene Plattform „Mobil- und Desktopanwendungen“ mit `https://login.microsoftonline.com/common/oauth2/nativeclient` für den Launcher bleibt, wie sie ist.
3. **Client-Geheimnis anlegen:** **Zertifikate & Geheimnisse** → **Geheime Clientschlüssel** → **Neuer geheimer Clientschlüssel**, Beschreibung z. B. „Heldix-Dienst Webseite“, Ablauf z. B. 24 Monate. Danach sofort den **Wert** kopieren (nicht die „Geheimnis-ID“); Azure zeigt ihn nur dieses eine Mal. Den Wert nirgends einchecken, nicht in Chats oder Tickets kopieren.
4. **Berechtigungen:** nichts zu tun. Der Dienst fragt wie der Launcher nur `XboxLive.signin` an (ohne `offline_access`, also ohne dauerhaften Zugriff); Spieler stimmen beim ersten Anmelden selbst zu.
5. **Auf dem Server einschalten** (Installer derselben oder einer neueren Version, mit denselben Optionen wie bei der Installation):

   ```sh
   sudo bash heldix-dienst-install.sh --domain example.de --minecraft-login
   ```

   Der Installer fragt nach dem Client-Geheimnis; die Eingabe bleibt unsichtbar. Ohne Terminal (oder mit `--yes`) geht es über eine Datei, die danach gelöscht wird (als root, z. B. nach `sudo -i`):

   ```sh
   (umask 077; read -rs -p 'Client-Geheimnis: ' s && printf '%s\n' "$s" > /root/ms-secret; echo)
   sudo bash heldix-dienst-install.sh --domain example.de --ms-client-secret-file /root/ms-secret --yes
   shred -u /root/ms-secret
   ```

   Der Installer legt das Geheimnis als `/etc/heldix-dienst/ms-client-secret` ab (root, Gruppe des Dienstes, Rechte 640) und setzt `HELDIX_DIENST_MS_CLIENT_ID` (App-ID des Launchers), `HELDIX_DIENST_MS_CLIENT_SECRET_FILE` und `HELDIX_DIENST_API_URL`. Ohne Installer dieselben Umgebungsvariablen setzen (siehe [docs/dienst.md](dienst.md#von-hand)).
6. **Prüfen:** Im Log steht beim Start `Anmeldung mit dem Minecraft-Konto auf der Webseite: an (mit Client-Geheimnis, Umleitungs-URI https://…/v1/web/auth/microsoft/callback)` (`journalctl -u heldix-dienst`). Auf `https://<domain>/konto` erscheint im abgemeldeten Zustand der Knopf **Mit Minecraft-Konto anmelden**; einmal durchklicken.

**Geheimnis läuft ab:** Azure-Geheimnisse haben ein Ablaufdatum. Rechtzeitig vorher ein neues anlegen, auf dem Server mit `--ms-client-secret-file` übernehmen und danach das alte in Azure löschen. Ist es schon abgelaufen, steht im Log „Microsoft lehnt den Code ab (HTTP 401, invalid_client, AADSTS7000222)“, und Spieler sehen „Microsoft hat die Anmeldung nicht bestätigt“.

**Ohne Geheimnis (öffentlicher Client):** Statt unter **Web** lässt sich dieselbe Umleitungs-URI unter **Mobil- und Desktopanwendungen** eintragen (Plattform hinzufügen → „Mobil- und Desktopanwendungen“ → benutzerdefinierte Umleitungs-URI). Microsoft behandelt die Anmeldung dann als öffentlichen Client, der Code wird nur mit PKCE eingelöst; beim Installer die Frage nach dem Geheimnis leer lassen. Eine URI gehört immer nur zu einer Plattform. Steht sie unter **Web**, ist das Geheimnis Pflicht: Ohne antwortet Microsoft mit „invalid_client“ (AADSTS7000218). Empfohlen ist **Web mit Geheimnis**.

**Ausschalten:** Installer mit `--no-minecraft-login` (löscht auch das Geheimnis auf dem Server), danach Umleitungs-URI und Geheimnis in Azure entfernen. Der Knopf verschwindet sofort, die Anmeldung über den Launcher geht wie bisher.

## Discord-Status (Rich Presence)

Der Launcher zeigt in Discord, was gespielt wird. Discord blendet dabei „Spielt HeldixClient“ ein, darunter zum Beispiel:

| Situation | Anzeige |
| --- | --- |
| Launcher offen | Im Launcher |
| Spiel startet | Minecraft 26.3 · HeldixClient – Startet das Spiel … |
| Hauptmenü | Minecraft 26.3 · HeldixClient – Im Hauptmenü |
| Einzelspieler / LAN / Realms | … – Spielt Einzelspieler / Spielt im LAN / Spielt auf Realms |
| Server | … – Spielt auf hypixel.net (dazu die Spielzeit) |

**So funktioniert es**

- Der Launcher spricht direkt mit der Discord-App auf dem PC, über deren lokale Schnittstelle ([core/discord.ts](../launcher/src/main/core/discord.ts)). Dafür braucht er kein Zusatzpaket und keinen Internetdienst.
- In Heldix-Instanzen meldet HeldixClient, ob man im Menü, im Einzelspieler oder auf einem Server ist ([StatusReporter](../mod/src/main/java/dev/heldixclient/status/StatusReporter.java)). Fabric- und Vanilla-Instanzen zeigen nur „Im Spiel“.
- Den Text baut [core/presence.ts](../launcher/src/main/core/presence.ts).

**Im Launcher unter Einstellungen → Discord**

- Der Status lässt sich ganz abschalten.
- Ob der Server angezeigt wird, ist ebenfalls einstellbar.
- Angezeigt werden nur öffentliche Domains wie `hypixel.net`. IP-Adressen, `localhost` und Heimnetz-Namen erscheinen nie.
- Die Karte zeigt, ob die Verbindung zu Discord steht.

### Eigene Discord-App einrichten

1. Im [Discord Developer Portal](https://discord.com/developers/applications) auf **New Application** klicken. Der Name erscheint später als „Spielt …“.
2. Unter **General Information** die **Application ID** kopieren.
3. Unter **Rich Presence → Art Assets** die Datei `launcher/build/discord-logo.png` hochladen.
   - Die Datei erzeugt `npm run icon`.
   - Discord übernimmt den Dateinamen `discord-logo` als Namen. Genau so muss das Bild heißen.
   - Neue Bilder zeigt Discord oft erst nach ein paar Minuten an.
4. Die ID in [config.ts](../launcher/src/main/config.ts) bei `DISCORD_CLIENT_ID` eintragen oder die Umgebungsvariable `HELDIX_DISCORD_CLIENT_ID` setzen.
5. Testen mit `npm run test:discord -- <Application-ID>`, während Discord läuft. Das eigene Discord-Profil zeigt dann 20 Sekunden lang einen Beispielstatus.
