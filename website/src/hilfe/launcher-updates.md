---
titel: Updates des Launchers
beschreibung: Wie sich HeldixClient unter Windows und auf dem Mac selbst aktualisiert – und was zu tun ist, wenn der Mac nur einen Hinweis zeigt.
kategorie: launcher
reihenfolge: 6
stichworte: update, updates, aktualisieren, neue version, automatisch, beim start, startfenster, suche nach updates, versionsverlauf, was ist neu, neu in, mac update, neu starten, jetzt neu starten, jetzt installieren, signatur
---
Neue Versionen von HeldixClient kommen über heldixclient.com. Mit dem Launcher bekommen deine Instanzen beim nächsten Start auch die neue HeldixClient-Mod.

## Automatisch beim Start
Unter Windows und ab Version 0.14.0 auch auf dem Mac hält sich der Launcher selbst aktuell – direkt beim Start:
1. Beim Öffnen zeigt ein kleines Startfenster **„Suche nach Updates …“**. Das dauert höchstens ein paar Sekunden; ohne Internet startet der Launcher einfach normal.
2. Gibt es eine neue Version, lädt er sie gleich (**„Update auf … wird geladen … 42 %“**), installiert sie (**„Wird installiert …“**) und startet danach von selbst neu. Dauert das Laden zu lange, startet **Später – Launcher jetzt öffnen** den Launcher sofort; das Update lädt dann im Hintergrund weiter.
3. Läuft der Launcher schon länger, schaut er alle 30 Minuten nach. Eine neue Version lädt er im Hintergrund; ist sie fertig, steht in der Seitenleiste **Update bereit** mit **Jetzt neu starten**. Spielst du gerade, kommt der Hinweis erst nach dem Spiel. Spätestens beim Beenden des Launchers wird installiert.
4. Beim ersten Start der neuen Version zeigt der Launcher einmal **„Neu in HeldixClient …“** mit den Änderungen.

Jede Version ist vom HeldixClient-Team signiert. Der Launcher installiert nur Updates mit gültiger Signatur und unveränderter Datei – und nie eine ältere Version als die installierte.

> **Hinweis:** Solange Minecraft läuft, wird nicht installiert – auch nicht beim Start, wenn das Spiel aus der letzten Sitzung noch offen ist. Klappt eine Installation nicht, startet der Launcher normal und versucht es später noch einmal.

## Einstellungen
Unter **Einstellungen → Updates** findest du:
- **Automatisch aktualisieren:** beim Start prüfen und gleich installieren, im laufenden Launcher im Hintergrund laden. Ist der Schalter aus, zeigt der Launcher beim Start nur **Update verfügbar** mit **Jetzt installieren** und installiert nichts von selbst.
- **Nach Updates suchen:** prüft sofort und lädt eine neue Version gleich herunter. Danach installierst du sie mit **Jetzt neu starten**.
- **Versionsverlauf:** öffnet die Liste aller Versionen mit ihren Änderungen.

## Mac: so läuft es
Auf dem Mac lädt der Launcher die Version für deinen Chip (Apple Silicon oder Intel), prüft sie, entpackt sie und tauscht nach dem Beenden die App in **Programme** aus. Danach startet HeldixClient von selbst neu. Klappt der Austausch nicht, bleibt die alte Version, und der Launcher startet trotzdem.

Das geht nur, wenn HeldixClient im Ordner **Programme** liegt und dort ersetzt werden darf. Läuft die App direkt aus der DMG, aus dem Ordner Downloads oder ohne Schreibrechte, meldet der Launcher neue Versionen nur (**Update verfügbar** mit dem Grund) – dann so:
1. Klicke auf **Herunterladen**. Die [Download-Seite](/download) öffnet sich.
2. Lade die passende `.dmg`-Datei (Apple Silicon oder Intel).
3. Beende HeldixClient, öffne die DMG und ziehe HeldixClient in **Programme**. Ersetze dabei die alte Version.
4. Starte HeldixClient ab jetzt aus **Programme** – dann kommen die nächsten Updates von selbst.

Versionen vor 0.14.0 aktualisieren sich auf dem Mac noch nicht selbst; dort einmal wie oben von Hand neu installieren.

Deine Instanzen, Welten und Konten bleiben erhalten – sie liegen nicht in der App, sondern im Datenordner. Blockiert macOS den Start erneut, hilft wieder **Dennoch öffnen**, siehe [Auf dem Mac installieren](/hilfe/installation-mac).

## Fehlermeldungen
- **„Update-Server nicht erreichbar. Später erneut versuchen.“** – Der Launcher erreicht heldixclient.com gerade nicht. Prüfe deine Internetverbindung oder schau auf die [Statusseite](/status).
- **„Die Signatur des Updates stimmt nicht. Das Update wird nicht installiert.“** – Das Update wurde zu deiner Sicherheit abgelehnt. Lade die aktuelle Version über die [Download-Seite](/download).
- **„Erst das Spiel beenden, dann aktualisieren.“** – Beende Minecraft und klicke noch einmal auf **Jetzt neu starten**.
- **„Der Installer ließ sich nicht starten. Später erneut versuchen.“** – Meist hält ein Virenscanner die Datei kurz fest. Der Launcher versucht es später von selbst noch einmal; sonst hilft die [Download-Seite](/download).
