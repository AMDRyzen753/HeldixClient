---
titel: Einstellungen im Launcher
beschreibung: Arbeitsspeicher, Fenstergröße, Infobereich, Java, Discord-Status, Benachrichtigungen und Datenordner – was die Einstellungen im Launcher bewirken.
kategorie: launcher
reihenfolge: 5
stichworte: einstellungen, arbeitsspeicher, ram, speicher, java, jvm, fenstergröße, auflösung, discord, rich presence, datenordner, launcher ausblenden, infobereich, tray, hintergrund, autostart, mit windows starten, bei der anmeldung, taskleiste, dock, nicht stören, glocke, benachrichtigungen, einrichtung erneut starten
---
Unter **Einstellungen** in der Seitenleiste legst du fest, was für alle Instanzen gilt. Änderungen werden sofort gespeichert. Auf dem Mac öffnest du sie auch mit [[⌘]] + [[,]].

## Allgemein: Hintergrund & Start
- **Im Hintergrund bereit für Nachrichten:** Schließt du das Fenster, läuft HeldixClient im Infobereich neben der Uhr weiter – auch ohne Spiel. Nachrichten, Freundschaftsanfragen sowie Party- und Welt-Einladungen kommen dann als Windows-Benachrichtigung; ein Klick öffnet den Launcher direkt im Chat mit dem Absender. Beim ersten Mal erklärt ein kurzer Hinweis, wie du ihn beendest: **Rechtsklick auf das Symbol → Beenden**. Ab Werk an. Ist der Schalter aus, beendet das Schließen den Launcher (ein laufendes Spiel läuft weiter). Wer früher „Beim Schließen in den Infobereich“ ausgeschaltet hatte, hat auch diesen Schalter aus.
- **Mit Windows starten:** HeldixClient startet beim Anmelden an Windows unsichtbar im Infobereich, damit Nachrichten gleich ankommen. Ab Werk aus; auch als Häkchen im letzten Schritt der [Einrichtung](/hilfe/einrichtung). Auf dem Mac heißt es **Bei der Anmeldung starten** und öffnet HeldixClient ohne Fenster im Dock.

Das Menü im Infobereich (Rechtsklick auf das Symbol) hat **HeldixClient öffnen**, **Freunde** mit allen, die gerade online sind, deine **Benachrichtigungen**, **Nicht stören** zum Umschalten und **Beenden**. Am Symbol in der Taskleiste zeigt eine kleine rote Zahl, wie viele Nachrichten und Anfragen auf dich warten; bei einer neuen Nachricht blinkt es kurz, wenn das Fenster im Hintergrund ist. Auf dem Mac steht die Zahl am Symbol im Dock.

## Arbeitsspeicher
Der Regler legt fest, wie viel Arbeitsspeicher (RAM) Minecraft höchstens bekommt. Zwischen 2 und 8 GB zeigt der Launcher „Empfohlen“, darüber „Mehr als nötig“ – mehr Speicher macht Minecraft nicht schneller.

Für eine einzelne Instanz, etwa mit vielen Mods, legst du unter **Instanzen → Instanz → Einstellungen → Arbeitsspeicher** einen eigenen Wert fest.

## Leistung
Hier wählst du die **Grafik-API** (Vulkan, Automatisch oder OpenGL) und schaltest die **Optimierten Java-Einstellungen** ein oder aus. Was dahintersteckt, erklärt [Vulkan oder OpenGL?](/hilfe/vulkan-opengl).

## Spiel
- **Eigene Fenstergröße:** Minecraft startet mit der angegebenen Breite und Höhe.
- **Launcher beim Spielstart ausblenden:** Der Launcher verschwindet, solange du spielst, und kommt nach dem Beenden wieder.

## Discord
Der Launcher zeigt deinen Freunden in Discord, was du spielst – zum Beispiel „Spielt auf hypixel.net“ und „Im Nether · Überleben“. Dafür muss die Discord-App auf deinem Rechner laufen.
- **Discord-Status anzeigen** schaltet die Anzeige ein oder aus.
- **Umfang:** **Ausführlich** oder **Nur „Spielt HeldixClient“**.
- **Was zu sehen ist:** Server und Welten, Dimension und Spielmodus, Weltname im Einzelspieler, Spielerzahl, Voice Chat, Kopf als Bild und Knöpfe – jeweils einzeln abschaltbar. Gezeigt werden nur öffentliche Server wie hypixel.net, nie IP-Adressen.

Ob die Verbindung zu Discord steht, siehst du direkt in der Karte, daneben eine Vorschau deines Status. Alles Weitere unter [Discord-Status](/hilfe/discord-status).

## Benachrichtigungen
Die **Glocke** oben rechts sammelt Freundschaftsanfragen, Nachrichten, Einladungen in Welten und Partys, Freischaltungen, geöffnete Welten von Freunden und Updates. Der Verlauf bleibt nur auf deinem PC (höchstens 100 Einträge, 30 Tage).

Systembenachrichtigungen kommen, wenn der Launcher nicht im Vordergrund ist – auch aus dem Infobereich (siehe **Allgemein** oben). Bei **Nicht stören** und während eines Spiels mit HeldixClient (dort blendet das Spiel selbst ein) bleibt es still; die Glocke sammelt trotzdem weiter.

## Einrichtung erneut starten
Unter **Über HeldixClient** startet **Einrichtung erneut starten** den [Einrichtungs-Assistenten](/hilfe/einrichtung) noch einmal.

## Java
Lass das Feld **Java-Pfad** leer. Dann nimmt der Launcher automatisch die passende Java-Version und lädt sie bei Bedarf selbst. Unter **Zusätzliche JVM-Argumente** lassen sich Java-Optionen ergänzen – lass das Feld leer, wenn du dir nicht sicher bist. Mehr unter [Java-Fehler](/hilfe/java).

## Updates
Wie der Launcher sich aktualisiert, steht unter [Updates des Launchers](/hilfe/launcher-updates).

## Launcher-Daten
**Datenordner öffnen** zeigt, wo Minecraft-Dateien, Java und alle Instanzen liegen:
- Windows: `%APPDATA%\.heldixclient`
- Mac: `~/Library/Application Support/heldixclient`
