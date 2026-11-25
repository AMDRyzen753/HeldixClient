---
titel: Java-Fehler
beschreibung: Java musst du nicht selbst installieren – der Launcher lädt die passende Version. So löst du Probleme mit eigenem Java-Pfad oder JVM-Argumenten.
kategorie: probleme
reihenfolge: 4
stichworte: java, jre, jdk, java-version, java 25, java-pfad, jvm, jvm-argumente, runtime, garbage collector
---
Für Minecraft brauchst du Java – aber du musst es nicht selbst installieren. Der Launcher lädt automatisch die passende Version (Java 8 bis 25, je nach Minecraft-Version) direkt von Mojang und hält sie aktuell. Ein bereits installiertes Java auf deinem Rechner stört dabei nicht.

## Empfohlene Einstellung
Im Launcher unter **Einstellungen → Java**:
- **Java-Pfad:** leer lassen („Automatisch (empfohlen)“)
- **Zusätzliche JVM-Argumente:** leer lassen, wenn du nicht genau weißt, was du tust

Unter **Einstellungen → Leistung** sorgen die **Optimierten Java-Einstellungen** (Standard: an) für flüssiges Spielen.

## Häufige Probleme
- **Das Spiel startet nicht, seit du einen eigenen Java-Pfad eingetragen hast:** Leere das Feld **Java-Pfad**. Jede Minecraft-Version braucht eine bestimmte Java-Version – mit dem automatischen Pfad stimmt sie immer.
- **Das Spiel startet nicht, seit du JVM-Argumente eingetragen hast:** Leere das Feld **Zusätzliche JVM-Argumente** und starte erneut. Schon ein Tippfehler verhindert den Start.
- **„Mojang bietet … nicht für … an. Bitte in den Einstellungen einen eigenen Java-Pfad angeben.“** – Für dein System gibt es diese Java-Version nicht von Mojang. Nur in diesem Fall trägst du unter **Java-Pfad** eine selbst installierte, passende Java-Version ein.
- **Java-Download hängt oder bricht ab:** Prüfe deine Internetverbindung und starte erneut. Bereits geladene Dateien bleiben erhalten.

> **Tipp:** Welche Java-Installation beim letzten Start genutzt wurde, steht in der **Konsole** in der Zeile, die mit `[Launcher] Java:` beginnt.

Startet das Spiel aus einem anderen Grund nicht? Dann hilft [Das Spiel startet nicht](/hilfe/spiel-startet-nicht).
