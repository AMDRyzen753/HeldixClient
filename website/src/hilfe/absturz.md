---
titel: Absturz und Crash-Log
beschreibung: Minecraft stürzt ab oder schließt sich plötzlich? So findest du Log und Crash-Report und grenzt die Ursache ein.
kategorie: probleme
reihenfolge: 2
stichworte: absturz, crash, abgestürzt, crash-report, crash-log, log, fehlercode, konsole, mods, logs, schließt sich, absturz-hilfe, support
---
Schließt sich Minecraft unerwartet, öffnet der Launcher die **Absturz-Hilfe**. Sie liest Crash-Report und Log, nennt die wahrscheinliche Ursache und schlägt passende Schritte vor.

## Absturz-Hilfe im Launcher
- **Ursache:** zum Beispiel „Zu wenig Arbeitsspeicher“, „Grafiktreiber abgestürzt“, „Mod-Konflikt“ oder „Ein Mod passt nicht zu dieser Version“ – mit den beteiligten Mods.
- **Mit einem Klick beheben:** etwa mehr Arbeitsspeicher geben, einen verdächtigen Mod ausschalten, auf OpenGL umstellen oder wieder das automatische Java nutzen. Danach **Erneut starten**.
- **An den Support senden:** schickt den Bericht mit Crash-Report und Log als Support-Anfrage an das Team. Du siehst vorher genau, was gesendet wird; dein Benutzerordner wird durch `~` ersetzt, Zugangsdaten werden entfernt. Dafür brauchst du ein Microsoft-Konto im Launcher. Die Antwort kommt auf heldixclient.com unter **Konto → Support** und als Einblendung im Spiel.
- **Später noch einmal ansehen:** in der **Konsole** über **Letzter Absturz**.

## Log in der Konsole
1. Öffne im Launcher die **Konsole** in der Seitenleiste. Ein Punkt neben dem Eintrag zeigt, dass es Fehler gab.
2. Wähle **Warnungen & Fehler**, um nur die wichtigen Zeilen zu sehen.
3. Mit **Kopieren** landet das ganze Log in der Zwischenablage – praktisch für eine Support-Anfrage.

Zeilen, die mit `[Launcher]` beginnen, stammen vom Launcher selbst, zum Beispiel welche Java-Version und welche Grafik-API genutzt wurden.

## Crash-Report und Log-Dateien
Minecraft speichert bei einem Absturz einen Crash-Report im Spielordner der Instanz:
- **Crash-Reports:** Öffne unter **Instanzen** die Instanz und klicke auf **Ordner**. Die Berichte liegen im Unterordner `crash-reports`.
- **Logs:** unter **Instanzen → Instanz → Einstellungen → Ordner → Logs**. Die neueste Datei heißt `latest.log`.

## Ursache eingrenzen
- **Gerade eine Mod installiert?** Schalte sie unter **Mods** aus und starte erneut. Funktioniert es dann, liegt es an dieser Mod oder ihrer Version.
- **Absturz direkt beim Start in einer Heldix-Instanz?** Stell testweise die Grafik-API auf **OpenGL** (Launcher → Einstellungen → Leistung). Siehe [Grafikfehler und Treiber](/hilfe/grafikprobleme).
- **Absturz nach längerem Spielen oder mit vielen Mods?** Gib der Instanz mehr Arbeitsspeicher (Instanz → Einstellungen → Arbeitsspeicher), aber nicht mehr als 8 GB.
- **Eigene JVM-Argumente oder eigener Java-Pfad?** Leere testweise beide Felder unter **Einstellungen → Java**.

> **Hinweis:** Ein fehlerhaftes Heldix-Addon lässt das Spiel nicht abstürzen: HeldixClient schaltet es ab, und das Spiel läuft weiter. Hinweise dazu stehen im Heldix-Menü unter **Einstellungen → Info**.

## Hilfe vom Team
Kommst du nicht weiter, schreib eine [Support-Anfrage](/hilfe/support-anfrage) mit:
- was du gemacht hast, als es abgestürzt ist,
- Instanz, Loader und Minecraft-Version,
- dem kopierten Log aus der Konsole oder dem Inhalt des Crash-Reports.
