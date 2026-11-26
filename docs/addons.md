# Heldix-Addons

Addons sind die einfache Stufe unter den Mods. HeldixClient lädt sie aus dem Ordner `heldix-addons/` einer Instanz. Addons programmiert man nur gegen die [Heldix-API](../mod/heldix-api/src/main/java/dev/heldixclient/api). Die API enthält bewusst nichts aus Minecraft. Deshalb läuft dieselbe Addon-JAR über Minecraft-Updates hinweg weiter.

| | Heldix-Mod (`mods/`) | Heldix-Addon (`heldix-addons/`) |
| --- | --- | --- |
| Zugriff | ganzes Minecraft, eigene Transformer | nur die Heldix-API |
| Läuft nach Minecraft-Updates | nur mit neuem Build | ja, dieselbe JAR |
| Bei Fehlern | Crash-Report | Addon wird abgeschaltet, das Spiel läuft weiter |

Wie Heldix-Mods funktionieren, steht in [heldix-loader.md](heldix-loader.md).

## Addon-Store

Addons kommen nicht mehr mit dem Launcher, sondern einzeln aus dem **Addon-Store**. Jedes Addon ist ein eigenes Projekt unter [mod/addons](../mod/addons) mit eigener Version. Der Store ist an drei Stellen:

- **Launcher:** Instanzen → Instanz → **Heldix-Addons** → Karten „Addon-Store“ oben (Installieren, Aktualisieren, Details).
- **Im Spiel:** Heldix-Menü → **Addons** → Reiter **Addon-Store**. Installieren, Aktualisieren und Entfernen wirken nach einem Neustart, weil Addons ihre Tasten beim Start anlegen. Unter Windows sind geladene JARs gesperrt; das Spiel merkt sie in `heldix-addons/.entfernen` vor (bzw. legt eine `.jar.neu` ab) und erledigt das beim nächsten Start.
- **Webseite:** `/addons` mit Beschreibung, Versionen, Prüfsumme und Download der JAR.

| Addon | Was es macht |
| --- | --- |
| **Spotify** ([mod/addons/spotify](../mod/addons/spotify)) | HUD-Element mit Cover, Titel, Künstler und Fortschritt des laufenden Songs in drei Darstellungen (Kompakt, Groß mit Cover, Nur Titel). Tasten für Abspielen/Pause (**Pos1**), nächsten Song (**Bild ab**) und vorherigen Song (**Bild auf**), dazu frei belegbare Tasten für Spulen, Zufall, Wiederholen und Teilen. Chat-Befehle `.np`, `.np teilen` und `.spotify …`. Einblendung beim Songwechsel. Windows, macOS und Linux (mit playerctl). |
| **Uhrzeit & Spielzeit** ([mod/addons/uhrzeit](../mod/addons/uhrzeit)) | Uhrzeit (Farbe und Beschriftung einstellbar) und Spielzeit mit Pausen-Erinnerung im HUD, eine Begrüßung im Chat und der Befehl `.uhr`. Gleichzeitig die Vorlage für eigene Addons. |

**Sicherheit:** Addons sind Code, der im Spiel läuft. Deshalb veröffentlicht nur das Team, und jede Version ist mit dem **Update-Schlüssel** signiert (derselbe Ed25519-Schlüssel wie bei Launcher-Updates). Signiert werden die Bytes von `"heldix-addon\n"` + Manifest, damit ein Addon-Manifest nie als Launcher-Update gilt. Der Heldix-Dienst prüft die Signatur beim Veröffentlichen, Launcher und Spiel prüfen Signatur, Größe, SHA-256 und die `heldix.addon.json` der JAR noch einmal vor dem Installieren. Ein übernommenes Team-Konto kann so kein fremdes Addon ausliefern. Der öffentliche Schlüssel liegt im Launcher (`launcher/src/main/update-public-key.ts`) und in der Mod (`mod/src/main/resources/heldix-store-key.pem`); `npm run update-key` schreibt beide, `npm run mod` bricht ab, wenn sie nicht zusammenpassen.

### Ein Addon veröffentlichen

1. Version in `mod/addons/<id>/build.gradle` erhöhen und in `mod/addons/<id>/store.json` die `hinweise` (Was ist neu) eintragen. Dort stehen auch Icon, Kategorie (`hud`, `musik`, `chat`, `werkzeuge`, `sonstiges`), Systeme (`plattformen`, leer = alle) und die lange Beschreibung (Klartext, Absätze durch Leerzeile, Listenpunkte mit „- “).
2. Im Ordner `launcher`: `npm run addon -- <id>`. Das baut das Addon, signiert es und legt `heldix-addon-<id>-<version>.jar` und `heldix-addon-<id>-<version>.addon.json` in `launcher/release/addons/`.
3. Auf heldixclient.com im Team-Bereich (Admin) unter **Addons** beide Dateien wählen und veröffentlichen. Jede neue Version muss höher sein als die vorige. Ein Addon lässt sich dort auch aus dem Store nehmen oder eine Version löschen.

Solche Team-Addons sind im Store **„Offiziell“** (`official: true` im signierten Manifest).

### Addons von Spielern (Community)

1. **Einreichen:** Jeder Spieler mit Microsoft-Konto meldet sich auf heldixclient.com an (über den Launcher) und reicht unter **Konto → Meine Addons** seine JAR ein, mit Store-Angaben und bis zu vier Screenshots. Der Heldix-Dienst liest dabei die `heldix.addon.json` und durchsucht die Klassen grob nach Hinweisen für die Prüfung (Netzwerk, Dateien, Prozesse, Reflection, native Bibliotheken, Minecraft-Klassen). Ausgeführt wird nichts. Die Addon-ID gehört danach dem Einreicher; offizielle IDs sind gesperrt.
2. **Prüfen:** Im Team-Bereich unter **Addons → Einreichungen** sieht das Team alle Angaben, die Prüf-Hinweise und die Screenshots und kann die JAR herunterladen. Ablehnen geht mit Begründung (auch für Moderatoren); der Einreicher sieht sie sofort.
3. **Freigeben (nur Admins):** Die Seite zeigt das Manifest, das der Dienst für die Einreichung erzeugt hat (`official: false`, `author` = Einreicher). Der Admin wählt einmal seine Schlüsseldatei `update-key.pem`; **die Seite signiert lokal im Browser** (WebCrypto Ed25519) und schickt nur die Signatur. Der Schlüssel bleibt im Arbeitsspeicher der Seite und wird nie hochgeladen. Der Dienst prüft die Signatur und veröffentlicht. Im Store steht das Addon als **„Community · <Spielername>“**.

Bewertungen (1–5 Sterne) und Meldungen zu Addons gehen auf der Webseite und im Launcher mit Microsoft-Konto. Gemeldete Addons sieht das Team unter **Addons → Meldungen** und kann sie aus dem Store nehmen.

### Spotify-Addon

- **Keine Anmeldung nötig.** Das Addon liest den laufenden Song über die Mediensteuerung des Systems. Ein Spotify-Konto, Premium oder ein API-Schlüssel ist nicht nötig. Es werden keine Daten über den Spieler ins Internet geschickt.
- **Systeme** (Version 2.0.0, API 3):

  | System | Quelle | Was geht |
  | --- | --- | --- |
  | Windows | Windows-Mediensteuerung (dieselbe Quelle wie die Medienanzeige bei der Lautstärke), über [heldix-media.ps1](../mod/addons/spotify/src/main/resources/heldix-media.ps1) | Titel, Künstler, Album, Cover, Fortschritt, Abspielen/Pause, Weiter/Zurück, Spulen, Zufall und Wiederholen (wenn der Player sie meldet). Mit „Nur Spotify“ aus auch Browser, VLC usw.; **Player wechseln**, wenn mehrere laufen. |
  | macOS | Spotify-App per JavaScript for Automation (`osascript`), ein kleines Abfrage-Skript läuft dauerhaft mit | wie Windows (Wiederholen nur an/aus); nur Spotify. Beim ersten Mal fragt macOS, ob Minecraft Spotify steuern darf (**Systemeinstellungen → Datenschutz → Automation**). |
  | Linux | MPRIS über das Programm `playerctl` (einmal pro Sekunde abgefragt) | wie Windows; mit „Nur Spotify“ aus jeder MPRIS-Player. Ohne `playerctl` zeigt das HUD „playerctl fehlt – bitte installieren“. |

  Unter anderen Systemen zeigt das HUD-Element „Nur unter Windows, macOS und Linux (mit playerctl)“. Fehlt Spotify oder läuft es nicht, steht dort z. B. „Spotify nicht geöffnet“.
- **Darstellungen:** Kompakt (wie bisher), Groß mit Cover (Player, Zufall/Wiederholen, Album, Zeitleiste) und Nur Titel (eine Zeile mit feiner Fortschrittslinie). Akzentfarbe für Fortschritt und Equalizer: Spotify-Grün, aus dem Cover (`canvas.imageColor`) oder eine eigene Farbe. Lange Titel laufen als Laufschrift durch oder werden mit „…“ gekürzt.
- **Einstellungen** im Heldix-Menü unter **Module → Spotify → Zahnrad**: Darstellung, HUD-Element, Cover, Fortschritt, Akzentfarbe, Lange Titel, Ausblenden ohne Musik, Ausblenden nach 10 Sekunden Pause, Einblendung beim Songwechsel (auf Wunsch nur, wenn das HUD-Element aus oder per F1 ausgeblendet ist) und „Nur Spotify“.
- **Tasten** ändert man unter **Optionen → Steuerung → Heldix-Addons**. Belegt sind Abspielen/Pause (**Pos1**), nächster Song (**Bild ab**) und vorheriger Song (**Bild auf**); „10 Sekunden vor/zurück“, „Zufallswiedergabe“, „Wiederholen“ und „Song im Chat teilen“ belegt man selbst. Sie wirken nur im Spiel, nicht in Menüs.
- **Chat-Befehle:** `.np` zeigt den laufenden Song nur dir, `.np teilen` schickt „🎵 Titel – Künstler“ an alle. `.spotify play | pause | next | prev | +10 | -10 | shuffle | repeat | player` steuert die Musik.
- **Technik:** Die Verbindung zum Player läuft nur, solange das Modul an ist, und endet mit dem Spiel. Bricht sie ab, baut das Addon sie mit wachsender Pause (2 s bis 30 s) neu auf. Cover landen als PNG unter `config/heldix-addons/spotify/covers/` (je höchstens 30). Unter macOS und Linux melden die Player nur eine Adresse: Das Addon lädt das Bild dann einmal selbst (nur https oder lokale Datei, höchstens 2 MB). Die Lautstärke lässt sich nicht steuern, das kann die Mediensteuerung nicht.
- **Getestet** ist Windows (Autotest im echten Spiel, Skript gegen die laufende Spotify-App). Die Wege für macOS und Linux lassen sich nur auf diesen Systemen prüfen.

## Ein Addon schreiben

Ein Addon besteht aus einer `heldix.addon.json` …

```json
{
  "id": "mein-addon",
  "name": "Mein Addon",
  "version": "1.0.0",
  "description": "Was das Addon macht.",
  "authors": ["Du"],
  "entrypoint": "de.du.MeinAddon",
  "api": 3
}
```

… und einer Klasse, die `HeldixAddon` implementiert:

```java
public class MeinAddon implements HeldixAddon {
    @Override
    public void onEnable(HeldixApi api) {
        // HUD-Element, im HUD-Editor verschiebbar, im Heldix-Menü an/aus
        ModuleHandle hallo = api.registerHudModule(ModuleSpec.of("hallo", "Hallo", "Mein erstes Modul").withIcon("star"),
                canvas -> canvas.labelValue("Hallo", api.player().map(p -> p.name()).orElse("Welt")));
        // Einstellungen im Untermenü des Moduls (werden automatisch gespeichert)
        BooleanSupplier laut = hallo.addToggle("laut", "Laut", "Begrüßung zusätzlich als Einblendung", false);
        Supplier<String> gruss = hallo.addText("gruss", "Gruß", "Text beim Betreten einer Welt", "Willkommen zurück!", 64);
        // Ereignisse: onTick, onWorldJoin, onWorldLeave, onChatMessage (ab API 3 auch Menüs, Tod, Dimension …)
        api.events().onWorldJoin(() -> {
            api.chat(gruss.get());
            if (laut.getAsBoolean()) api.notify("Hallo", "Schön, dass du da bist");
        });
        // eigene Taste, umbelegbar unter Optionen → Steuerung → Heldix-Addons
        api.registerKey("winken", "Winken", HeldixKeys.F7, () -> api.chat("*winkt*"));
        // Chat-Befehl „.winken“: geht nicht an den Server; als Aktion des Spielers darf er einmal an alle senden
        api.registerCommand("winken", "[alle]", "Winkt (alle: im öffentlichen Chat)", befehl -> {
            if (befehl.arg(0).equals("alle")) api.sendChatMessage("*winkt*");
            else befehl.reply("*winkt*");
        });
    }
}
```

**Vorlagen:** [mod/addons/uhrzeit](../mod/addons/uhrzeit) (Uhrzeit, Spielzeit, Begrüßung; API 3: Farbe, Textfeld, Regler, Scheduler, Befehl) und [mod/addons/spotify](../mod/addons/spotify) (Tasten, Einstellungen, Bilder, Einblendungen, Hintergrund-Prozess, Befehle, Laufschrift, Fortschrittsbalken).

```powershell
cd mod
.\gradlew :addons:uhrzeit:build     # Ergebnis: mod/addons/uhrzeit/build/libs/
```

Zum Ausprobieren zieht man die JAR im Launcher unter **Instanzen → Heldix-Addons** in die Liste oder legt sie direkt in den Ordner `heldix-addons/` der Instanz. Für alle Spieler kommt sie über den Addon-Store (siehe oben).

## Was die API kann

**API 1**

- HUD-Module und Schalt-Module, die im Heldix-Menü erscheinen
- Events: Tick, Welt betreten und verlassen, Chatnachrichten
- Spielerdaten: Position, Leben, Hunger, Dimension, Biom
- lokale Chatnachrichten
- eigene Einstellungen (`api.config()`) und ein Logger

**API 2** (ab HeldixClient 0.11.0)

| Neu | Wofür |
| --- | --- |
| `api.registerKey(id, name, taste, aktion)` | eigene Tasten, Codes in `HeldixKeys` |
| `api.notify(titel, text)` / `api.notify(titel, text, bild)` | Einblendung oben rechts, optional mit PNG (z. B. Cover); threadsicher |
| `api.dataDirectory()` | eigener Ordner `config/heldix-addons/<id>/` |
| `modul.addToggle(...)`, `addChoice(...)`, `addAction(...)` | Einstellungen im Untermenü des Moduls |
| `ModuleSpec.withIcon("music")` | Icon für Karte, Addon-Liste und HUD-Editor |
| `canvas.text(text, x, y, farbe, TextStyle.BOLD)` | Heldix-Schrift (Inter) in den Stufen `SMALL`, `BODY`, `BOLD`, `TITLE` |
| `canvas.roundedRect(...)`, `roundedOutline(...)` | kantenglatte, abgerundete Flächen und Rahmen |
| `canvas.image(pfad, x, y, b, h)` | PNG-Datei zeichnen (zwischengespeichert, lädt bei Änderung neu) |
| `canvas.icon(name, x, y, größe, farbe)` | Icon aus dem Heldix-Icon-Set |
| `canvas.isPreview()` | true im HUD-Editor, um Beispieldaten zu zeigen |

Icons, die man für Module und `canvas.icon` nutzen kann, zeigt [ui-icons.png](images/ui-icons.png), z. B. `music`, `play`, `pause`, `skip-next`, `skip-previous`, `clock`, `chat`, `star`, `compass`, `signal`.

**API 3** (ab HeldixClient 0.13.1, `"api": 3`)

| Neu | Wofür |
| --- | --- |
| `api.events().onServerJoin(adresse -> …)`, `onServerLeave(…)` | Server betreten/verlassen (nicht im Einzelspieler), mit Adresse |
| `api.events().onScreenOpen(art -> …)`, `onScreenClose(…)` | Menü auf/zu; Art: `chat`, `inventory`, `container`, `pause`, `death`, `options`, `title`, `worlds`, `servers`, `loading`, `heldix`, `other` |
| `api.events().onDeath(…)`, `onRespawn(…)`, `onDimensionChange(dimension -> …)`, `onHealthChange((vorher, jetzt) -> …)` | Tod, Wiederbeleben, Dimensionswechsel, Schaden und Heilung |
| `Registration` | Rückgabe aller neuen Events, Befehle und Aufgaben: `cancel()` meldet ab, `isActive()` |
| `api.game()` → `GameInfo` | FPS, Ping, Einzel-/Mehrspieler, Server-Adresse, Tageszeit, Wetter, pausiert, HUD ausgeblendet (F1), offenes Menü |
| `api.playerState()` → `PlayerState` | wie `api.player()` plus Blickrichtung, Tempo, max. Leben, Absorption, Sättigung, Rüstungspunkte, Level, Spielmodus, Sprinten/Schleichen/Fliegen, Items in Hand und Rüstung (`ItemInfo`), Effekte (`EffectInfo`) |
| `api.scheduler()` → `Scheduler` | `runLater(ticks, …)`, `runRepeating(verzögerung, abstand, …)` im Haupt-Thread, `runAsync(…)` (zwei Threads je Addon), `runOnMainThread(…)`, `isMainThread()`; wird beim Abschalten des Addons und beim Beenden abgebrochen |
| `api.registerCommand(name, verwendung, beschreibung, befehl -> …)` | Chat-Befehl „.name …“: geht nicht an den Server; `.hilfe` listet alle, Tab ergänzt, über dem Eingabefeld stehen passende Befehle |
| `api.sendChatMessage(text)` | Nachricht an den Server – nur direkt in einer Taste, einem Befehl oder einem Knopf und höchstens einmal pro Aktion; sonst `IllegalStateException`. Keine `/`-Befehle |
| `modul.addSlider(...)`, `addColor(...)`, `addText(...)` | Regler (optional mit eigenem Text für den Wert), Farbwahl (Palette), Textfeld im Untermenü |
| `canvas.progressBar(...)`, `gradientRect(...)`, `line(...)`, `circle(...)` | Fortschrittsbalken, Farbverlauf, Linien in jeder Richtung, Kreise |
| `canvas.item("minecraft:diamond_sword", x, y, größe)`, `canvas.playerHead(name oder uuid, …)` | Item-Symbole und Spielerköpfe |
| `canvas.scrollingText(...)` | Laufschrift für lange Texte |
| `canvas.imageColor(png)` | typische Farbe eines Bildes (z. B. Akzentfarbe aus einem Cover) |

```java
// Events mit Abmeldung
Registration tod = api.events().onDeath(() -> api.notify("Autsch", "Zurück zum Spawn?"));
api.events().onDimensionChange(dimension -> api.chat("Jetzt in " + dimension));
api.events().onScreenOpen(art -> { if (art.equals("pause")) api.logger().info("Pause"); });

// Spiel- und Spielerdaten
GameInfo spiel = api.game();
String wo = spiel.multiplayer() ? spiel.serverAddress() : "Einzelspieler";
api.playerState().ifPresent(p -> api.chat(p.mainHand().name() + ", noch " + p.mainHand().durability() + " Haltbarkeit"));

// Scheduler: Download im Hintergrund, Ergebnis im Haupt-Thread
api.scheduler().runAsync(() -> {
    String text = ladeEtwas();                      // darf blockieren
    api.scheduler().runOnMainThread(() -> api.chat(text));
});
api.scheduler().runRepeating(20, 20 * 60, () -> api.notify("Minute um", "Trink etwas"));

// Einstellungen
DoubleSupplier abstand = modul.addSlider("abstand", "Abstand", "", 0, 10, 0.5, 2);
IntSupplier farbe = modul.addColor("farbe", "Farbe", "", HeldixColors.ACCENT);
Supplier<String> titel = modul.addText("titel", "Titel", "", "Mein HUD", 32);

// HUD
canvas.progressBar(0, 20, 100, 3, 0.4f, 0x2EFFFFFF, farbe.getAsInt());
canvas.item("minecraft:clock", 0, 0, 16);
canvas.scrollingText("Ein sehr langer Titel, der nicht passt", 20, 4, 80, HeldixColors.TEXT, TextStyle.BOLD);
```

**Warum so:** Neue Methoden gibt es nur an Schnittstellen, die HeldixClient selbst bereitstellt (`HeldixApi`, `HeldixEvents`, `HudCanvas`, `ModuleHandle`); Schnittstellen, die Addons selbst schreiben (`HeldixAddon`, `HudRenderer`, Listener), bleiben unverändert. `GameInfo` und `PlayerState` sind Schnittstellen statt Records, damit spätere Versionen Werte ergänzen können, ohne Addons zu brechen. Die bisherigen Events (`onTick` …) geben weiter `void` zurück – eine andere Rückgabe würde fertige Addons brechen.

Tastencodes aus `HeldixKeys` sind feste GLFW-Werte. HeldixClient übersetzt sie in die Tasten der jeweiligen Minecraft-Version (seit 26.x nimmt Minecraft SDL-Scancodes). Bis 0.13.0 landeten sie unübersetzt im Spiel: Standardtasten wie Pos1 lagen dadurch auf falschen Tasten, und `HeldixKeys.NONE` brachte das Spiel zum Absturz. Falsch gespeicherte Standardtasten setzt HeldixClient einmal auf die richtigen zurück.

Addons für API 1 und 2 laufen unverändert weiter. Ein Addon, das eine neuere API braucht, als der installierte HeldixClient kann, wird mit dem Hinweis „bitte HeldixClient aktualisieren“ übersprungen.

Details stehen in den Javadoc-Kommentaren der [API-Klassen](../mod/heldix-api/src/main/java/dev/heldixclient/api).

## Robustheit

- Jedes Addon bekommt einen eigenen Classloader.
- Addons mit unpassender API-Version, fehlender `heldix.addon.json` oder Fehlern beim Laden werden übersprungen. Das Heldix-Menü zeigt sie unter **Addons → Installiert** rot mit Grund an.
- Wirft ein Addon zur Laufzeit drei Fehler, wird es abgeschaltet. Das gilt für alle Rückrufe: Events, Tasten, Befehle, Knöpfe, Regler-Texte, HUD und Aufgaben im Scheduler (Fehler aus Hintergrund-Threads werden im Haupt-Thread gezählt).
- Beim Abschalten eines Addons und beim Beenden des Spiels werden seine geplanten Aufgaben abgebrochen und laufende Hintergrund-Aufgaben unterbrochen.
- Chat an den Server geht nur als direkte Folge einer Aktion des Spielers (Taste, Befehl, Knopf) und nur einmal pro Aktion. Ein Addon kann so nicht von sich aus spammen.
- Befehle eines abgeschalteten Addons werden trotzdem abgefangen („Das Addon … ist abgeschaltet“), damit „.np“ nicht im öffentlichen Chat landet.
- Das Spiel läuft in allen Fällen weiter.
