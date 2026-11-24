# Heldix-Addons

Addons sind die einfache Stufe unter den Mods. HeldixClient lädt sie aus dem Ordner `heldix-addons/` einer Instanz. Addons programmiert man nur gegen die [Heldix-API](../mod/heldix-api/src/main/java/dev/heldixclient/api). Die API enthält bewusst nichts aus Minecraft. Deshalb läuft dieselbe Addon-JAR über Minecraft-Updates hinweg weiter.

| | Heldix-Mod (`mods/`) | Heldix-Addon (`heldix-addons/`) |
| --- | --- | --- |
| Zugriff | ganzes Minecraft, eigene Transformer | nur die Heldix-API |
| Läuft nach Minecraft-Updates | nur mit neuem Build | ja, dieselbe JAR |
| Bei Fehlern | Crash-Report | Addon wird abgeschaltet, das Spiel läuft weiter |

Wie Heldix-Mods funktionieren, steht in [heldix-loader.md](heldix-loader.md).

## Mitgelieferte Addons

Der Launcher bringt zwei Addons mit. Neue Instanzen mit HeldixClient bekommen sie automatisch. Bei bestehenden Instanzen bietet der Reiter **Instanzen → Heldix-Addons** sie oben als Karte zum Installieren an, auch wenn es eine neuere Version gibt.

| Addon | Was es macht |
| --- | --- |
| **Spotify** ([spotify-addon](../mod/spotify-addon)) | HUD-Element mit Cover, Titel, Künstler und Fortschritt des laufenden Songs. Tasten für Abspielen/Pause (**Pos1**), nächsten Song (**Bild ab**) und vorherigen Song (**Bild auf**). Bei jedem Songwechsel erscheint oben rechts eine kurze Einblendung. |
| **Uhrzeit & Spielzeit** ([example-addon](../mod/example-addon)) | Uhrzeit und Spielzeit im HUD und eine Begrüßung im Chat. Gleichzeitig die Vorlage für eigene Addons. |

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

**Vorlagen:** [example-addon](../mod/example-addon) (Uhrzeit, Spielzeit, Begrüßung) und [spotify-addon](../mod/spotify-addon) (Tasten, Einstellungen, Bilder, Einblendungen, Hintergrund-Prozess).

```powershell
cd mod
.\gradlew :example-addon:build     # Ergebnis: mod/example-addon/build/libs/
```

Fertige Addons zieht man im Launcher unter **Instanzen → Heldix-Addons** in die Liste oder legt sie direkt in den Ordner `heldix-addons/` der Instanz.

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
- Addons mit unpassender API-Version, fehlender `heldix.addon.json` oder Fehlern beim Laden werden übersprungen. Das Heldix-Menü zeigt sie im Reiter **Addons** rot mit Grund an.
- Wirft ein Addon zur Laufzeit drei Fehler, wird es abgeschaltet.
- Das Spiel läuft in allen Fällen weiter.
