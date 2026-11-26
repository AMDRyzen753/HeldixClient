---
titel: Heldix-Addons und der Addon-Store
beschreibung: Addons aus dem Addon-Store installieren und aktualisieren, Offiziell und Community, Bewertungen, Screenshots, ein Addon melden – und eigene Addons einreichen.
kategorie: launcher
reihenfolge: 4
stichworte: addons, heldix-addons, addon-store, store, community, offiziell, bewertung, sterne, screenshots, melden, einreichen, entwickler, spotify, musik, song, uhrzeit, spielzeit, addon installieren, aktualisieren, update, jar
---
Heldix-Addons sind kleine Erweiterungen für HeldixClient. Sie laufen in allen Instanzen mit HeldixClient – also in Heldix-Instanzen und in Fabric-Instanzen mit HeldixClient – und funktionieren auch nach Minecraft-Updates weiter.

Addons kommen nicht mit dem Launcher, sondern einzeln aus dem **Addon-Store**. Was es dort gibt, siehst du unter [Addon-Store](/addons). In den Store kommen nur Addons, die das Team geprüft und signiert hat.

## Offiziell und Community
- **Offiziell** sind Addons des HeldixClient-Teams, etwa Spotify oder Uhrzeit & Spielzeit.
- **Community**-Addons haben Spieler geschrieben und eingereicht. Das Team sieht sich auch ihren Code an und signiert sie, bevor sie im Store erscheinen.

Welche Art ein Addon ist, steht im signierten Manifest – das lässt sich nachträglich nicht ändern. Bei Community-Addons führt der Name des Entwicklers zu seiner **Entwicklerseite** mit all seinen Addons.

## Im Launcher installieren
1. Öffne **Instanzen**, wähle die Instanz und den Reiter **Heldix-Addons**.
2. Unter **Addon-Store** klickst du beim gewünschten Addon auf **Installieren** – oder auf **Aktualisieren**, wenn es eine neue Version gibt.
3. Starte die Instanz. Läuft das Spiel schon, starte es neu.

Der Launcher prüft beim Installieren die Signatur und die Prüfsumme der Datei.

Gibt es für ein installiertes Addon eine neue Version, meldet der Launcher das von selbst und zeigt am Addon-Store eine Zahl. Unter **Einstellungen** schaltest du **Addon-Updates melden** aus oder **Addons automatisch aktualisieren** ein – dann aktualisiert der Launcher sie, wenn gerade kein Spiel läuft.

## Im Spiel installieren
Öffne das Heldix-Menü (rechte [[Umschalt]]-Taste) und klick links auf **Addons**. Im Reiter **Addon-Store** installierst und aktualisierst du Addons; der Papierkorb neben „Installiert“ entfernt eines wieder. Der Reiter **Installiert** zeigt, was gerade geladen ist. Alles wirkt beim nächsten Spielstart. Gibt es ein Update, zeigt „Addons“ in der Seitenleiste eine Zahl, und kurz nach dem Start erscheint einmal der Hinweis „Addon-Updates verfügbar“.

## Von Hand installieren
Auf der Seite eines Addons im [Addon-Store](/addons) lädst du die `.jar` herunter. Leg sie in den Ordner `heldix-addons` der Instanz – nicht nach `mods`. Den Ordner öffnest du im Launcher unter Instanz → **Einstellungen** → **Ordner** → **Addons**. Eigene Addons, die nicht im Store sind, fügst du im Reiter **Heldix-Addons** auch mit **Addon-Datei hinzufügen** hinzu.

## Bewerten, Screenshots und Versionen
Ein Klick auf ein Addon im [Addon-Store](/addons) öffnet seine Seite mit Screenshots (ein Klick zeigt sie groß), der Beschreibung, dem **Versionsverlauf** und den **Bewertungen**.

- Bewerten kannst du mit 1 bis 5 Sternen, sobald du angemeldet bist – auf der Webseite über den [Konto-Bereich](/hilfe/web-konto), ganz ohne Passwort. Ändern oder entfernen geht jederzeit.
- Andere sehen nur den Durchschnitt und die Zahl der Bewertungen, nie wer wie bewertet hat.
- Eigene Addons kannst du nicht bewerten.

## Ein Addon melden
Funktioniert ein Addon nicht, enthält es fremde Inhalte oder verhält es sich verdächtig? Öffne es im Store und wähle **Addon melden**. Gib einen Grund an und, wenn du magst, einen kurzen Hinweis. Das Team sieht sich die Meldung an und kann das Addon aus dem Store nehmen. Der Entwickler erfährt nicht, wer gemeldet hat.

> **Achtung:** Hältst du ein Addon für Schadsoftware, entferne es sofort aus der Instanz (Reiter **Heldix-Addons** → Papierkorb) und melde es.

## Im Spiel einstellen
Addons findest du im Heldix-Menü unter **Module**, Reiter **Addons**. Ein Klick auf die Kachel schaltet ein Addon ein oder aus, das **Regler-Symbol** öffnet seine Einstellungen.

Die Tasten der Addons änderst du in Minecraft unter **Optionen → Steuerung**, Abschnitt **Heldix-Addons**.

## Spotify-Addon: gut zu wissen
- **Steuerung per Taste:** [[Pos1]] für Abspielen/Pause, [[Bild ab]] für den nächsten und [[Bild auf]] für den vorherigen Song. Weitere Tasten (10 Sekunden vor und zurück, Zufallswiedergabe, Wiederholen, Song teilen) belegst du unter **Optionen → Steuerung → Heldix-Addons**.
- **Im Chat:** `.np` zeigt den laufenden Song nur dir, `.np teilen` schickt ihn an alle. Mit `.spotify play`, `pause`, `next` oder `prev` steuerst du die Musik.
- **Keine Anmeldung nötig:** Ein Spotify-Konto mit Premium oder einen API-Schlüssel brauchst du nicht.
- **Windows:** Das Addon liest den Song über die Windows-Mediensteuerung. Schaltest du in den Einstellungen **Nur Spotify** aus, steuert es auch andere Player, z. B. den Browser.
- **macOS:** Das Addon spricht mit der Spotify-App. Beim ersten Mal fragt macOS, ob Minecraft Spotify steuern darf – erlaube das.
- **Linux:** Das Addon nutzt die Mediensteuerung MPRIS; dafür muss das Programm `playerctl` installiert sein.
- Daten über dich schickt das Addon nicht ins Internet. Nur unter macOS und Linux lädt es die Cover-Bilder direkt von Spotify.
- Die Tasten wirken nur im Spiel, nicht in Menüs.

## Eigenes Addon in den Store bringen
Hast du selbst ein Addon geschrieben, reichst du es im Konto unter **Meine Addons** ein: JAR hochladen, Store-Angaben und Screenshots ergänzen, einreichen. Das Team prüft es und gibt es frei – oder schreibt dir, was noch fehlt. Alles dazu steht unter [Addon einreichen](/entwickler/addons#addon-einreichen).

## Der Store lädt nicht?
Den Addon-Store liefert der Heldix-Dienst. Ist er gerade nicht erreichbar, laufen installierte Addons trotzdem weiter – nur Installieren und Aktualisieren geht erst wieder, wenn er zurück ist. Ob der Dienst läuft, siehst du unter [Status](/status).

> **Hinweis:** Hat ein Addon einen Fehler, schaltet HeldixClient es ab – das Spiel läuft weiter.
