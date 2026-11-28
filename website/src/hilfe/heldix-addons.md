---
titel: Mods & Addons und der Addon-Store
beschreibung: Heldix-Addons aus dem Addon-Store installieren und aktualisieren, was „Greift in Minecraft ein“ bedeutet, Offiziell und Community, Bewertungen, ein Addon melden – und eigene Addons einreichen.
kategorie: launcher
reihenfolge: 4
stichworte: addons, heldix-addons, mods & addons, mods und addons, addon-store, store, community, offiziell, bewertung, sterne, screenshots, melden, einreichen, entwickler, spotify, musik, song, uhrzeit, spielzeit, item physics, addon installieren, aktualisieren, update, jar, greift in minecraft ein, nur api-addons, heldix-instanzen, minecraft-version
---
Heldix-Addons sind Erweiterungen für HeldixClient. Sie laufen in allen Instanzen mit HeldixClient – in Heldix-Instanzen und in Fabric-Instanzen mit HeldixClient. Im Launcher und im Spiel stehen sie zusammen mit deinen Fabric-Mods in einer Liste: **Mods & Addons**.

Addons kommen nicht mit dem Launcher, sondern einzeln aus dem **Addon-Store**. Was es dort gibt, siehst du unter [Addon-Store](/addons). In den Store kommen nur Addons, die das Team geprüft und signiert hat.

## Zwei Arten von Addons
- Die meisten Addons nutzen nur die **Heldix-API**. Sie laufen über Minecraft-Updates hinweg weiter, in Heldix- und Fabric-Instanzen, und lassen sich im Spiel sofort ausschalten.
- Manche Addons **greifen direkt in Minecraft ein**, weil die Heldix-API für ihre Idee nicht reicht. Sie tragen im Store den Hinweis **Greift in Minecraft ein** und nennen die Minecraft-Versionen, für die sie gebaut sind (etwa „Minecraft 26.3“). Viele laufen nur in **Heldix-Instanzen**, und An oder Aus wirkt erst nach dem Neustart des Spiels. Das Team sieht sich ihre Eingriffe beim Prüfen besonders genau an.

Willst du im Store nur Addons ohne solche Eingriffe sehen, wähle dort **Nur API-Addons**.

## Offiziell und Community
- **Offiziell** sind Addons des HeldixClient-Teams, etwa Spotify, Uhrzeit & Spielzeit oder Item Physics.
- **Community**-Addons haben Spieler geschrieben und eingereicht. Das Team sieht sich auch ihren Code an und signiert sie, bevor sie im Store erscheinen.

Welche Art ein Addon ist, steht im signierten Manifest – das lässt sich nachträglich nicht ändern. Bei Community-Addons führt der Name des Entwicklers zu seiner **Entwicklerseite** mit all seinen Addons.

## Im Launcher installieren
1. Öffne **Instanzen**, wähle die Instanz und den Reiter **Mods & Addons**.
2. Klick auf **Hinzufügen** und wähle oben **Addon-Store**.
3. Klick beim gewünschten Addon auf **Installieren** – oder auf **Aktualisieren**, wenn es eine neue Version gibt.
4. Starte die Instanz. Läuft das Spiel schon, starte es neu.

Der Launcher prüft beim Installieren die Signatur und die Prüfsumme der Datei – und ob das Addon zur Instanz passt. Passt es nicht, steht statt **Installieren** der Grund, etwa „Nur für Minecraft 26.3“, „Läuft nur in Heldix-Instanzen“ oder „Braucht einen neueren HeldixClient“.

In der Liste zeigen Chips, was ein Eintrag ist: **Fabric-Mod**, **Addon** und bei Addons mit Eingriff **Greift in Minecraft ein**. Oben filterst du nach **Alle**, **Mods**, **Addons**, **Updates** und **Ausgeschaltet**. Fabric-Mods von Modrinth holst du über **Hinzufügen → Modrinth** (nur in Fabric-Instanzen) – mehr unter [Mods installieren](/hilfe/mods-installieren).

Gibt es für ein installiertes Addon eine neue Version, meldet der Launcher das von selbst. Unter **Einstellungen** schaltest du **Addon-Updates melden** aus oder **Addons automatisch aktualisieren** ein – dann aktualisiert der Launcher sie, wenn gerade kein Spiel läuft.

## Im Spiel installieren
Öffne das Heldix-Menü (rechte [[Umschalt]]-Taste) und wähle **Mods & Addons**. Im Reiter **Store** installierst und aktualisierst du Addons; der Papierkorb neben „Installiert“ entfernt eines wieder. Der Reiter **Installiert** zeigt, was gerade geladen ist – zur Info auch die Fabric-Mods der Instanz. Installieren und Entfernen wirken beim nächsten Spielstart. Gibt es ein Update, erscheint kurz nach dem Start einmal der Hinweis „Addon-Updates verfügbar“.

## Von Hand installieren
Auf der Seite eines Addons im [Addon-Store](/addons) lädst du die `.jar` herunter. Leg sie in den Ordner `heldix-addons` der Instanz – nicht nach `mods`. Den Ordner öffnest du im Launcher unter Instanz → **Einstellungen** → **Ordner** → **Addons**. Einfacher geht es im Reiter **Mods & Addons** mit **Datei hinzufügen**: Der Launcher legt Addons und Fabric-Mods dann selbst in den richtigen Ordner.

## Bewerten, Screenshots und Versionen
Ein Klick auf ein Addon im [Addon-Store](/addons) öffnet seine Seite mit Screenshots (ein Klick zeigt sie groß), der Beschreibung, dem **Versionsverlauf** und den **Bewertungen**. Unter **Details** steht auch, ob das Addon in Minecraft eingreift, für welche Minecraft-Versionen es gebaut ist und in welchen Instanzen es läuft.

- Bewerten kannst du mit 1 bis 5 Sternen, sobald du angemeldet bist – auf der Webseite über den [Konto-Bereich](/hilfe/web-konto), ganz ohne Passwort. Ändern oder entfernen geht jederzeit.
- Andere sehen nur den Durchschnitt und die Zahl der Bewertungen, nie wer wie bewertet hat.
- Eigene Addons kannst du nicht bewerten.

## Ein Addon melden
Funktioniert ein Addon nicht, enthält es fremde Inhalte oder verhält es sich verdächtig? Öffne es im Store und wähle **Addon melden**. Gib einen Grund an und, wenn du magst, einen kurzen Hinweis. Das Team sieht sich die Meldung an und kann das Addon aus dem Store nehmen. Der Entwickler erfährt nicht, wer gemeldet hat.

> **Achtung:** Hältst du ein Addon für Schadsoftware, entferne es sofort aus der Instanz (Reiter **Mods & Addons** → Papierkorb) und melde es.

## Im Spiel einstellen
Die Module der Addons findest du im Heldix-Menü unter **Module**, Reiter **Addons**. Ein Klick auf die Kachel schaltet ein Modul ein oder aus, das **Regler-Symbol** öffnet seine Einstellungen. Ein ganzes Addon schaltest du unter **Mods & Addons** an oder aus. Ausschalten wirkt bei reinen API-Addons sofort; Einschalten und alles bei Addons mit Eingriff in Minecraft wirkt nach dem Neustart – dann steht dort „Wirkt nach dem Neustart“.

Die Tasten der Addons änderst du in Minecraft unter **Optionen → Steuerung**, Abschnitt **Heldix-Addons**.

## Spotify-Addon: gut zu wissen
- **Steuerung per Taste:** [[Pos1]] für Abspielen/Pause, [[Bild ab]] für den nächsten und [[Bild auf]] für den vorherigen Song (auf MacBook-Tastaturen [[fn]] + [[←]], [[fn]] + [[↓]] und [[fn]] + [[↑]]). Weitere Tasten (10 Sekunden vor und zurück, Zufallswiedergabe, Wiederholen, Song teilen) belegst du unter **Optionen → Steuerung → Heldix-Addons**.
- **Im Chat:** `.np` zeigt den laufenden Song nur dir, `.np teilen` schickt ihn an alle. Mit `.spotify play`, `pause`, `next` oder `prev` steuerst du die Musik.
- **Keine Anmeldung nötig:** Ein Spotify-Konto mit Premium oder einen API-Schlüssel brauchst du nicht.
- **Windows:** Das Addon liest den Song über die Windows-Mediensteuerung. Schaltest du in den Einstellungen **Nur Spotify** aus, steuert es auch andere Player, z. B. den Browser.
- **macOS:** Das Addon spricht mit der Spotify-App. Schaltest du **Nur Spotify** aus, zeigt und steuert es auch **Apple Music** – es zählt der Player, der gerade spielt. Beim ersten Mal fragt macOS je App, ob Minecraft sie steuern darf – erlaube das (später änderbar unter **Systemeinstellungen → Datenschutz & Sicherheit → Automation**).
- **Linux:** Das Addon nutzt die Mediensteuerung MPRIS; dafür muss das Programm `playerctl` installiert sein.
- Daten über dich schickt das Addon nicht ins Internet. Nur unter macOS und Linux lädt es die Cover-Bilder direkt von Spotify; Cover aus Apple Music liest es vom Mac selbst.
- Die Tasten wirken nur im Spiel, nicht in Menüs.

## Eigenes Addon in den Store bringen
Hast du selbst ein Addon geschrieben, reichst du es im Konto unter **Meine Addons** ein: JAR hochladen, Store-Angaben und Screenshots ergänzen, einreichen. Das Team prüft es und gibt es frei – oder schreibt dir, was noch fehlt. Alles dazu steht unter [Addon einreichen](/entwickler/addons#addon-einreichen).

## Der Store lädt nicht?
Den Addon-Store liefert der Heldix-Dienst. Ist er gerade nicht erreichbar, laufen installierte Addons trotzdem weiter – nur Installieren und Aktualisieren geht erst wieder, wenn er zurück ist. Ob der Dienst läuft, siehst du unter [Status](/status).

> **Hinweis:** Hat ein Addon einen Fehler, schaltet HeldixClient es ab bzw. lädt es nicht – das Spiel läuft weiter. Den Grund siehst du im Heldix-Menü unter **Mods & Addons → Installiert**.
