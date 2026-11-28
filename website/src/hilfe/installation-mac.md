---
titel: Mac: Installieren und erster Start
beschreibung: HeldixClient auf macOS 11 oder neuer installieren – DMG öffnen, in Programme ziehen, „Dennoch öffnen“ beim ersten Start, automatische Updates, Spotify und Apple Music.
kategorie: erste-schritte
reihenfolge: 2
stichworte: mac, macos, installieren, installation, dmg, apple silicon, intel, m1, gatekeeper, dennoch öffnen, programme, erster start, automatische updates, apple music, spotify, automation, dock, menüleiste, cmd, befehlstaste
---
HeldixClient läuft auf macOS 11 oder neuer – auf Macs mit Apple Silicon (M1 und neuer) genauso wie auf Intel-Macs.

## Die richtige Version wählen
Auf der [Download-Seite](/download) gibt es zwei Mac-Versionen:
- **Apple Silicon** für Macs mit M1 oder neuer
- **Intel** für Macs mit Intel-Prozessor

Welchen Chip dein Mac hat, siehst du im Apple-Menü unter **Über diesen Mac**.

## Installieren
1. Lade die passende `.dmg`-Datei von der [Download-Seite](/download).
2. Öffne die Datei per Doppelklick. Es erscheint ein Fenster mit HeldixClient links und dem Ordner **Programme** rechts.
3. Ziehe **HeldixClient** auf **Programme** – so, wie es der Pfeil zeigt.
4. Wirf die DMG aus (im Finder in der Seitenleiste auf das Auswerfen-Symbol klicken).
5. Starte HeldixClient aus dem Ordner **Programme** oder über Launchpad.

> **Wichtig:** Starte HeldixClient nicht direkt aus der DMG oder aus dem Ordner Downloads. Nur aus **Programme** kann sich die App später selbst aktualisieren. Läuft sie noch aus der DMG, erinnert dich der Launcher daran.

## Beim ersten Start: „Dennoch öffnen“
HeldixClient ist (noch) nicht von Apple beglaubigt. Deshalb blockiert macOS den ersten Start. So erlaubst du ihn:
1. Versuche, HeldixClient zu öffnen. macOS zeigt eine Warnung – schließe sie mit **Fertig** bzw. **OK**.
2. Öffne **Systemeinstellungen → Datenschutz & Sicherheit**.
3. Weiter unten steht ein Hinweis zu HeldixClient mit dem Knopf **Dennoch öffnen**. Klicke darauf.
4. Bestätige die Rückfrage mit deinem Passwort oder Touch ID.

Danach startet HeldixClient ganz normal. Beim ersten Start führt dich die [Einrichtung](/hilfe/einrichtung) durch Anmeldung und Addons.

> **Achtung:** Lade HeldixClient nur über die offizielle [Download-Seite](/download) herunter.

## Automatische Updates
Ab Version 0.14.0 aktualisiert sich HeldixClient auf dem Mac selbst – wie unter Windows:
- Beim Start schaut der Launcher kurz nach (**„Suche nach Updates …“**). Gibt es eine neue Version, lädt er sie, prüft sie, tauscht die App in **Programme** aus und startet neu.
- Läuft der Launcher schon, prüft er alle 30 Minuten. Ist ein Update fertig, steht in der Seitenleiste **Update bereit** mit **Jetzt neu starten**. Während Minecraft läuft, wird nicht installiert.
- Jede Version ist vom HeldixClient-Team signiert. Der Launcher nimmt nur unveränderte Dateien mit gültiger Signatur.

Nicht selbst aktualisieren kann sich die App, wenn sie direkt aus der DMG läuft, nicht in **Programme** liegt oder dein Benutzer dort nichts ändern darf. Dann zeigt der Launcher **Update verfügbar** mit **Herunterladen** – lade die neue DMG und ziehe HeldixClient wieder in **Programme**. Mehr dazu unter [Updates des Launchers](/hilfe/launcher-updates).

Hast du eine Version vor 0.14.0, installierst du einmal von Hand neu – danach geht es von selbst.

## Spotify und Apple Music
Das [Spotify-Addon](/hilfe/heldix-addons) zeigt den laufenden Song auch auf dem Mac im Spiel:
- Es spricht direkt mit der **Spotify-App** – ganz ohne Anmeldung.
- Schaltest du in den Einstellungen des Moduls **Nur Spotify** aus, zeigt und steuert es auch **Apple Music**. Laufen beide, zählt der Player, der gerade spielt.
- Beim ersten Mal fragt macOS, ob Minecraft Spotify bzw. Musik steuern darf. Erlaube das. Hast du es abgelehnt, schalte es unter **Systemeinstellungen → Datenschutz & Sicherheit → Automation** bei **java** bzw. **HeldixClient** wieder ein.
- Die Tasten [[Pos1]], [[Bild ab]] und [[Bild auf]] erreichst du auf MacBook-Tastaturen mit [[fn]] + [[←]], [[fn]] + [[↓]] und [[fn]] + [[↑]]. Die Medientasten des Macs steuern die Musik ohnehin.

## Das ist auf dem Mac anders
- **Kein Vulkan:** Auf dem Mac wählt Minecraft die Grafik-API selbst. Die Auswahl im Launcher ist dort ausgegraut.
- **Befehlstaste statt Strg:** Kürzel heißen auf dem Mac [[⌘]] statt [[Strg]] – im Launcher und im Spiel, z. B. [[⌘]] + [[K]] für die Schnellsuche im Heldix-Menü oder [[⌘]] + Klick, um eine Chat-Nachricht zu kopieren. Den Reiter wechselst du mit [[⌃]] + [[Tab]], weil [[⌘]] + [[Tab]] zwischen Programmen wechselt.
- **Dock:** Das Symbol im Dock zeigt, wie viele Nachrichten und Freundschaftsanfragen auf dich warten. Mit einem Rechtsklick darauf startest du deine zuletzt gespielten Instanzen oder öffnest die Freunde.
- **Fenster schließen:** HeldixClient bleibt wie jede Mac-App im Dock und meldet weiter neue Nachrichten. Beenden mit [[⌘]] + [[Q]]. **Einstellungen …** öffnest du mit [[⌘]] + [[,]].
- **Bei der Anmeldung starten:** Unter **Einstellungen → Allgemein** startet HeldixClient auf Wunsch beim Anmelden am Mac ohne Fenster.

Java lädt der Launcher auch auf dem Mac selbst, passend zu deinem Chip. Deine Microsoft-Anmeldung liegt verschlüsselt im Schlüsselbund von macOS.

## Wie geht es weiter?
1. [Mit dem Microsoft-Konto anmelden](/hilfe/anmelden-microsoft) – falls du es in der Einrichtung übersprungen hast.
2. [Das erste Spiel starten](/hilfe/erster-start).

Lässt sich die App trotzdem nicht öffnen? Dann hilft [Mac: App lässt sich nicht öffnen](/hilfe/mac-app-blockiert).
