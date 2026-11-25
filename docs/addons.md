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
| **Spotify** ([mod/addons/spotify](../mod/addons/spotify)) | HUD-Element mit Cover, Titel, Künstler und Fortschritt des laufenden Songs. Tasten für Abspielen/Pause (**Pos1**), nächsten Song (**Bild ab**) und vorherigen Song (**Bild auf**). Bei jedem Songwechsel erscheint oben rechts eine kurze Einblendung. |
| **Uhrzeit & Spielzeit** ([mod/addons/uhrzeit](../mod/addons/uhrzeit)) | Uhrzeit und Spielzeit im HUD und eine Begrüßung im Chat. Gleichzeitig die Vorlage für eigene Addons. |

**Sicherheit:** Addons sind Code, der im Spiel läuft. Deshalb veröffentlicht nur das Team, und jede Version ist mit dem **Update-Schlüssel** signiert (derselbe Ed25519-Schlüssel wie bei Launcher-Updates). Signiert werden die Bytes von `"heldix-addon\n"` + Manifest, damit ein Addon-Manifest nie als Launcher-Update gilt. Der Heldix-Dienst prüft die Signatur beim Veröffentlichen, Launcher und Spiel prüfen Signatur, Größe, SHA-256 und die `heldix.addon.json` der JAR noch einmal vor dem Installieren. Ein übernommenes Team-Konto kann so kein fremdes Addon ausliefern. Der öffentliche Schlüssel liegt im Launcher (`launcher/src/main/update-public-key.ts`) und in der Mod (`mod/src/main/resources/heldix-store-key.pem`); `npm run update-key` schreibt beide, `npm run mod` bricht ab, wenn sie nicht zusammenpassen.

### Ein Addon veröffentlichen

1. Version in `mod/addons/<id>/build.gradle` erhöhen und in `mod/addons/<id>/store.json` die `hinweise` (Was ist neu) eintragen. Dort stehen auch Icon, Kategorie (`hud`, `musik`, `chat`, `werkzeuge`, `sonstiges`), Systeme (`plattformen`, leer = alle) und die lange Beschreibung (Klartext, Absätze durch Leerzeile, Listenpunkte mit „- “).
2. Im Ordner `launcher`: `npm run addon -- <id>`. Das baut das Addon, signiert es und legt `heldix-addon-<id>-<version>.jar` und `heldix-addon-<id>-<version>.addon.json` in `launcher/release/addons/`.
3. Auf heldixclient.com im Team-Bereich (Admin) unter **Addons** beide Dateien wählen und veröffentlichen. Jede neue Version muss höher sein als die vorige. Ein Addon lässt sich dort auch aus dem Store nehmen oder eine Version löschen.

Addons anderer Entwickler: Einreichen über eine Support-Anfrage; das Team prüft den Code, legt das Addon unter `mod/addons/` an (oder baut die gelieferte JAR) und veröffentlicht es wie oben.

### Spotify-Addon

- **Keine Anmeldung nötig.** Das Addon liest den laufenden Song über die Windows-Mediensteuerung, also dieselbe Quelle wie die Medienanzeige von Windows bei der Lautstärke. Ein Spotify-Konto, Premium oder ein API-Schlüssel ist nicht nötig. Es werden keine Daten ins Internet geschickt.
- **Nur Windows.** Unter anderen Systemen zeigt das HUD-Element „Nur unter Windows verfügbar“.
- **Einstellungen** im Heldix-Menü unter **Module → Spotify → Zahnrad**: HUD-Element, Cover, Fortschritt, Einblendung beim Songwechsel, Ausblenden ohne Musik und „Nur Spotify“. Ist „Nur Spotify“ aus, steuert das Addon auch andere Player, die sich bei Windows anmelden, z. B. den Browser oder VLC.
- **Tasten** ändert man unter **Optionen → Steuerung → Heldix-Addons**. Sie wirken nur im Spiel, nicht in Menüs.
- **Technik:** Ein kleines PowerShell-Skript ([heldix-media.ps1](../mod/spotify-addon/src/main/resources/heldix-media.ps1)) spricht mit der Windows-Mediensteuerung. Es läuft nur, solange das Modul an ist, und beendet sich mit dem Spiel. Cover landen als PNG unter `config/heldix-addons/spotify/covers/` (höchstens 30). Die Lautstärke lässt sich darüber nicht steuern, das kann die Windows-Mediensteuerung nicht.

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
  "api": 2
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
        // Einstellung im Untermenü des Moduls (wird automatisch gespeichert)
        BooleanSupplier laut = hallo.addToggle("laut", "Laut", "Begrüßung zusätzlich als Einblendung", false);
        // Ereignisse: onTick, onWorldJoin, onWorldLeave, onChatMessage
        api.events().onWorldJoin(() -> {
            api.chat("Willkommen zurück!");
            if (laut.getAsBoolean()) api.notify("Hallo", "Schön, dass du da bist");
        });
        // eigene Taste, umbelegbar unter Optionen → Steuerung → Heldix-Addons
        api.registerKey("winken", "Winken", HeldixKeys.F7, () -> api.chat("*winkt*"));
    }
}
```

**Vorlagen:** [mod/addons/uhrzeit](../mod/addons/uhrzeit) (Uhrzeit, Spielzeit, Begrüßung) und [mod/addons/spotify](../mod/addons/spotify) (Tasten, Einstellungen, Bilder, Einblendungen, Hintergrund-Prozess).

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

Addons für API 1 laufen unverändert weiter. Ein Addon, das eine neuere API braucht, als der installierte HeldixClient kann, wird mit dem Hinweis „bitte HeldixClient aktualisieren“ übersprungen.

Details stehen in den Javadoc-Kommentaren der [API-Klassen](../mod/heldix-api/src/main/java/dev/heldixclient/api).

## Robustheit

- Jedes Addon bekommt einen eigenen Classloader.
- Addons mit unpassender API-Version, fehlender `heldix.addon.json` oder Fehlern beim Laden werden übersprungen. Das Heldix-Menü zeigt sie unter **Addons → Installiert** rot mit Grund an.
- Wirft ein Addon zur Laufzeit drei Fehler, wird es abgeschaltet.
- Das Spiel läuft in allen Fällen weiter.
