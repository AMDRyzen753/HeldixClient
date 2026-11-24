# Einrichtung: Microsoft-Login und Discord-Status

Beides braucht eine App-Registrierung beim jeweiligen Anbieter. Die IDs dieses Projekts stehen schon in [launcher/src/main/config.ts](../launcher/src/main/config.ts). Diese Anleitung ist für alle, die einen eigenen Build mit eigenen IDs ausliefern möchten.

Beide IDs sind keine Geheimnisse und dürfen im Code stehen. Einen geheimen Clientschlüssel (Client Secret) braucht der Launcher nicht.

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

Bis zur Freigabe klappt die Anmeldung bei Microsoft zwar, danach meldet der Launcher aber: „Mojang hat die Microsoft-Anmeldung von HeldixClient noch nicht freigeschaltet …“. Das gilt für alle Konten, bis Mojang die App freigibt. Die Antwort kommt per E-Mail.

Zum Testen bis dahin: den Launcher aus dem Quellcode starten (`npm start`) oder in der .exe die [Entwickleroptionen mit Entwickler-Schlüssel](entwicklung.md#entwickleroptionen-in-der-fertigen-app) nutzen. Dann gehen Offline-Konten ohne Microsoft-Konto, also Einzelspieler, LAN und Server ohne Online-Modus. Für Server mit Online-Modus braucht es eine echte Anmeldung.

### So läuft die Anmeldung ab

Microsoft (OAuth 2.0 mit PKCE) → Xbox Live → XSTS → Minecraft-Dienste → Profil. Der Code steht in [core/auth.ts](../launcher/src/main/core/auth.ts), das Anmeldefenster in [auth-window.ts](../launcher/src/main/auth-window.ts). Tokens speichert der Launcher nur lokal und mit Windows-DPAPI verschlüsselt.

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
