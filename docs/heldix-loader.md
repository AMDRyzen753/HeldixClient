# Heldix Loader

Der Heldix Loader ([mod/heldix-loader](../mod/heldix-loader)) ist ein eigenständiger Mod-Loader für Minecraft. Fabric, Fabric API und Mixin werden dafür nicht gebraucht. Die HeldixClient-Mod ist selbst eine ganz normale Heldix-Mod.

## So startet ein Heldix-Spiel

1. Der Launcher startet ganz normales Vanilla-Minecraft. Zusätzlich hängt er `-javaagent:heldix-loader-<version>.jar` und `-Dheldix.gameDir=<Instanz>` an.
2. Noch bevor Minecraft startet, ruft Java den Loader auf ([HeldixAgent](../mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/HeldixAgent.java)). Der Loader:
   - liest alle JARs in `mods/` und prüft ihre `heldix.mod.json` (Minecraft-Version, Loader-Version, Abhängigkeiten);
   - legt passende Mods auf den Classpath und liest ihre Übersetzungen;
   - registriert ihre Transformer.
3. Während Minecraft seine Klassen lädt, verändert der Loader die nötigen Stellen per ASM ([TransformerChain](../mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/TransformerChain.java)). Stack-Map-Frames berechnet er selbst, ohne dabei Klassen zu früh zu laden.
4. Im Konstruktor von `Minecraft` ruft der Loader die Einstiegspunkte der Mods auf, also `onInitialize()`.

Diese Eingriffe macht der Loader selbst ([BuiltinPatches](../mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/BuiltinPatches.java)):

- Mods starten
- eigene Tastenbelegungen
- Übersetzungen aus `assets/<id>/lang/*.json` der Mods
- die Events der Loader-API

Schlägt ein Eingriff fehl, etwa nach einem Minecraft-Update, fehlt nur diese eine Funktion. Der Grund steht dann im Log und in `HeldixLoader.problems()`.

Fabric-Mods im `mods`-Ordner einer Heldix-Instanz erkennt der Loader und überspringt sie mit Hinweis, ohne dass das Spiel abstürzt.

## Die Loader-API

| Klasse (`dev.heldixclient.loader.…`) | Wofür |
| --- | --- |
| `HeldixLoader` | Version, Spiel-, Config- und Mods-Ordner, geladene Mods, Probleme beim Start |
| `api.HeldixModInitializer` | Einstiegspunkt einer Mod (`onInitialize()`) |
| `api.KeyMappings` | eigene Tasten; sie erscheinen unter Optionen → Steuerung |
| `api.event.ClientEvents` | `TICK_END`, `STOPPING` |
| `api.event.HudEvents` | `RENDER`: ins HUD zeichnen |
| `api.event.ScreenEvents` | `AFTER_INIT` und `addWidget(...)`: Buttons in fremde Menüs einbauen |
| `api.event.WorldEvents` | `JOIN`, `LEAVE` |
| `api.event.ChatEvents` | `RECEIVE`: empfangene Chatnachrichten |
| `api.transform.ClassTransformer`, `Patches`, `Code` | eigene Eingriffe in Minecraft-Klassen, als Ersatz für Mixins |

## Eine Heldix-Mod schreiben

Eine Heldix-Mod ist eine JAR mit einer `heldix.mod.json`:

```json
{
  "id": "meinemod",
  "name": "Meine Mod",
  "version": "1.0.0",
  "minecraft": "26.3",
  "loader": ">=2.0.0",
  "entrypoints": { "client": ["de.du.MeineMod"] },
  "transformers": ["de.du.MeinTransformer"],
  "depends": { "heldixclient": ">=0.6.0" }
}
```

Versionsangaben können `*`, `26.3`, `26.x`, `>=2.0.0`, `>1.0 <2.0` oder `26.2 || 26.3` sein. `transformers` und `depends` sind optional.

```java
public class MeineMod implements HeldixModInitializer {
    @Override
    public void onInitialize() {
        HudEvents.RENDER.register((g, delta) -> g.text(Minecraft.getInstance().font, "Hallo", 4, 4, -1, true));
        WorldEvents.JOIN.register(mc -> HeldixLoader.mod("meinemod").ifPresent(m -> System.out.println(m.name() + " ist bereit")));
    }
}

// Eingriff in Minecraft: das Sichtfeld läuft durch eine eigene statische Methode
public class MeinTransformer implements ClassTransformer {
    public Set<String> targets() { return Set.of("net/minecraft/client/Camera"); }
    public void transform(String name, ClassNode node) {
        Patches.modifyReturnValue(Patches.method(node, "calculateFov", "(F)F"), "de/du/Hooks", "fov", "(F)F");
    }
}
```

**Wichtig bei Transformern**

- Sie werden erzeugt, bevor Minecraft startet. Sie dürfen deshalb keine Minecraft-Klassen benutzen, nur deren Namen als Text. Die eigentliche Logik gehört in statische Hook-Methoden.
- Bausteine in `Patches`: `head`, `cancelAtHead`, `beforeReturns`, `tail`, `modifyReturnValue`, `replaceCalls`, `afterCalls`, `beforeFieldWrite`.
- Die Deskriptoren der Methoden liefert `javap -s` auf die Client-JAR unter `mod/.gradle/minecraft/<version>/client.jar`.

**Vollständige Beispiele**

- die HeldixClient-Mod: [HeldixClient.java](../mod/src/main/java/dev/heldixclient/HeldixClient.java), [HeldixPatches.java](../mod/src/main/java/dev/heldixclient/transform/HeldixPatches.java), [Hooks.java](../mod/src/main/java/dev/heldixclient/transform/Hooks.java)
- der [Autotest](../mod/autotest)

Gebaut wird mit Gradle wie in [mod/autotest/build.gradle](../mod/autotest/build.gradle): `compileOnly project(':heldix-loader')`; Minecraft kommt über [gradle/minecraft.gradle](../mod/gradle/minecraft.gradle).

## Fehler und Fehlersuche

- Mods mit falscher Minecraft-Version, fehlender Abhängigkeit oder doppelter ID überspringt der Loader und meldet sie mit Grund.
- Wirft eine Mod in `onInitialize()` einen Fehler, bricht das Spiel mit einem Crash-Report ab, in dem die Mod genannt ist.
- Mit `-Dheldix.dumpClasses=<Ordner>` speichert der Loader alle veränderten Klassen. Danach lassen sie sich mit `javap -c` ansehen.

## Hinweise zu Minecraft 26.x

Seit 26.1 ist Minecraft nicht mehr obfuskiert. Loader und Mod nutzen direkt Mojangs Klassennamen; Mappings und Loom werden nicht gebraucht. Einige Namen weichen von älteren Tutorials ab:

- `GuiGraphics` heißt jetzt `GuiGraphicsExtractor` (`text()`, `fill()`).
- Screens öffnet man über `minecraft.gui.setScreen(...)`.
- Das Sichtfeld wird in `Camera.calculateFov` berechnet.
- Tastencodes stehen in `InputConstants`. Die linke Maustaste ist dort `MOUSE_BUTTON_LEFT` (= 1, nicht 0).

Der Loader ist auf diese unverschleierten Namen ausgelegt. Für alte, obfuskierte Versionen bräuchte er zusätzlich Mappings.
