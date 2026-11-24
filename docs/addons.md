# Heldix-Addons

Addons sind die einfache Stufe unter den Mods. HeldixClient lädt sie aus dem Ordner `heldix-addons/` einer Instanz. Addons programmiert man nur gegen die [Heldix-API](../mod/heldix-api/src/main/java/dev/heldixclient/api). Die API enthält bewusst nichts aus Minecraft. Deshalb läuft dieselbe Addon-JAR über Minecraft-Updates hinweg weiter.

| | Heldix-Mod (`mods/`) | Heldix-Addon (`heldix-addons/`) |
| --- | --- | --- |
| Zugriff | ganzes Minecraft, eigene Transformer | nur die Heldix-API |
| Läuft nach Minecraft-Updates | nur mit neuem Build | ja, dieselbe JAR |
| Bei Fehlern | Crash-Report | Addon wird abgeschaltet, das Spiel läuft weiter |

Wie Heldix-Mods funktionieren, steht in [heldix-loader.md](heldix-loader.md).

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
  "api": 1
}
```

… und einer Klasse, die `HeldixAddon` implementiert:

```java
public class MeinAddon implements HeldixAddon {
    @Override
    public void onEnable(HeldixApi api) {
        // HUD-Element, im HUD-Editor verschiebbar, im Heldix-Menü an/aus
        api.registerHudModule(ModuleSpec.of("hallo", "Hallo", "Mein erstes Modul"),
                canvas -> canvas.labelValue("Hallo", api.player().map(p -> p.name()).orElse("Welt")));
        // Ereignisse: onTick, onWorldJoin, onWorldLeave, onChatMessage
        api.events().onWorldJoin(() -> api.chat("Willkommen zurück!"));
    }
}
```

**Vorlage:** [example-addon](../mod/example-addon) mit Uhrzeit, Spielzeit und einer Begrüßung im Chat.

```powershell
cd mod
.\gradlew :example-addon:build     # Ergebnis: mod/example-addon/build/libs/
```

Fertige Addons zieht man im Launcher unter **Instanzen → Heldix-Addons** in die Liste oder legt sie direkt in den Ordner `heldix-addons/` der Instanz.

## Was die API kann

- HUD-Module und Schalt-Module, die im Heldix-Menü erscheinen
- Events: Tick, Welt betreten und verlassen, Chatnachrichten
- Spielerdaten: Position, Leben, Hunger, Dimension, Biom
- lokale Chatnachrichten
- eigene Einstellungen (`api.config()`) und ein Logger

Details stehen in den Javadoc-Kommentaren der [API-Klassen](../mod/heldix-api/src/main/java/dev/heldixclient/api).

## Robustheit

- Jedes Addon bekommt einen eigenen Classloader.
- Addons mit falscher API-Version, fehlender `heldix.addon.json` oder Fehlern beim Laden werden übersprungen. Das Heldix-Menü zeigt sie im Reiter **Addons** rot mit Grund an.
- Wirft ein Addon zur Laufzeit drei Fehler, wird es abgeschaltet.
- Das Spiel läuft in allen Fällen weiter.
