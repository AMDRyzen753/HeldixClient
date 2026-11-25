---
titel: Heldix-Mods mit dem Heldix Loader
beschreibung: Der eigene Mod-Loader von HeldixClient – heldix.mod.json, Einstiegspunkte, Ereignisse, Tasten und Eingriffe in Minecraft-Klassen.
reihenfolge: 3
stichworte: mod, loader, heldix loader, heldix.mod.json, transformer, asm, patches, events, fabric, ressourcen
---
Der **Heldix Loader** ist der eigene Mod-Loader von HeldixClient. Er läuft als Java-Agent, verändert Minecraft-Klassen beim Laden direkt mit ASM und braucht weder Fabric noch Mixin. HeldixClient selbst ist eine ganz normale Heldix-Mod. Aktuell ist Heldix Loader **2.3.0** für Minecraft **26.3**.

> **Hinweis:** Heldix-Mods sind die Profi-Stufe. Sie greifen direkt in Minecraft ein und müssen für jede Minecraft-Version neu gebaut werden. Für HUD-Elemente, Tasten und Einblendungen reicht meist ein [Heldix-Addon](/entwickler/addons).

## So startet ein Heldix-Spiel

1. Der Launcher startet ganz normales Vanilla-Minecraft und hängt zusätzlich `-javaagent:heldix-loader-<version>.jar` und `-Dheldix.gameDir=<Instanz>` an.
2. Noch bevor Minecraft startet, liest der Loader alle JARs im Ordner `mods` und prüft ihre `heldix.mod.json` (Minecraft-Version, Loader-Version, Abhängigkeiten). Passende Mods legt er auf den Classpath, liest ihre Übersetzungen und registriert ihre Transformer.
3. Während Minecraft seine Klassen lädt, verändert der Loader die nötigen Stellen per ASM. Stack-Map-Frames berechnet er selbst, ohne dabei Klassen zu früh zu laden.
4. Im Konstruktor von `Minecraft` ruft der Loader die Einstiegspunkte der Mods auf, also `onInitialize()`.

Fabric-Mods im `mods`-Ordner einer Heldix-Instanz erkennt der Loader und überspringt sie mit einem Hinweis, ohne dass das Spiel abstürzt. Dasselbe gilt für Heldix-Addons, die versehentlich dort liegen.

## Die heldix.mod.json

Eine Heldix-Mod ist eine JAR mit einer `heldix.mod.json` im Wurzelverzeichnis:

```json
{
  "id": "meinemod",
  "name": "Meine Mod",
  "version": "1.0.0",
  "description": "Was die Mod macht.",
  "authors": ["Du"],
  "minecraft": "26.3",
  "loader": ">=2.3.0",
  "entrypoints": { "client": ["de.du.meinemod.MeineMod"] },
  "transformers": ["de.du.meinemod.MeinTransformer"],
  "depends": { "heldixclient": ">=0.10.0" }
}
```

- `id` – beginnt mit einem Kleinbuchstaben, danach `a-z`, `0-9`, `_` und `-`, insgesamt 2 bis 64 Zeichen. `minecraft`, `java` und `heldixloader` sind reserviert.
- `minecraft` und `loader` – welche Minecraft- und Loader-Versionen passen. Fehlt eine Angabe, passt jede Version.
- `entrypoints.client` – Klassen, die `HeldixModInitializer` implementieren.
- `transformers` – optional, Klassen, die `ClassTransformer` implementieren.
- `depends` – optional. Schlüssel sind Mod-IDs oder `minecraft`, `heldixloader` und `java` (Java-Hauptversion, z. B. `">=25"`). Abhängigkeiten werden vor deiner Mod geladen.

Versionsangaben können so aussehen:

- `*` – jede Version
- `26.3` – genau diese Version
- `26.x` – alle Versionen, die mit 26 beginnen
- `>=2.0.0` – mindestens diese Version (auch `>`, `<`, `<=`)
- `>1.0 <2.0` – mehrere Bedingungen, alle müssen passen
- `26.2 || 26.3` – eine der Alternativen

## Der Einstiegspunkt

`HeldixModInitializer` hat eine einzige Methode: `onInitialize()`. Sie läuft einmal im Haupt-Thread, direkt nachdem Minecraft erzeugt wurde – vor Optionen, Ressourcen und Fenster-Inhalten. Hier meldest du Tasten und Ereignisse an.

```java
package de.du.meinemod;

import dev.heldixclient.loader.HeldixLoader;
import dev.heldixclient.loader.api.HeldixModInitializer;
import dev.heldixclient.loader.api.event.HudEvents;
import dev.heldixclient.loader.api.event.WorldEvents;
import net.minecraft.client.Minecraft;

public class MeineMod implements HeldixModInitializer {
    @Override
    public void onInitialize() {
        HudEvents.RENDER.register((g, delta) -> g.text(Minecraft.getInstance().font, "Hallo", 4, 4, -1, true));
        WorldEvents.JOIN.register(mc -> HeldixLoader.mod("meinemod")
                .ifPresent(m -> System.out.println(m.name() + " ist bereit")));
    }
}
```

## Die Loader-API

Die Klasse `dev.heldixclient.loader.HeldixLoader` gibt Auskunft über den Loader:

- `version()` und `minecraftVersion()` – z. B. `"2.3.0"` und `"26.3"`.
- `platform()` – `"heldix"` (eigenständig als Java-Agent) oder `"fabric"` (als Fabric-Mod).
- `gameDir()`, `configDir()` und `modsDir()` – Spielordner der Instanz, deren `config` und `mods`.
- `mods()`, `mod(id)` und `isLoaded(id)` – geladene Mods als `ModInfo` mit `id()`, `name()`, `version()`, `description()`, `authors()` und `file()`.
- `problems()` – übersprungene Mods und fehlgeschlagene Eingriffe beim Start. Leer, wenn alles geklappt hat.

### Ereignisse

Ereignisse liegen in `dev.heldixclient.loader.api.event`. Du meldest dich mit `register(listener)` an und mit `unregister(listener)` wieder ab. Listener laufen in der Reihenfolge der Anmeldung.

- `ClientEvents.TICK_END` – `(Minecraft mc)` am Ende jedes Client-Ticks, 20-mal pro Sekunde.
- `ClientEvents.STOPPING` – `(Minecraft mc)` beim Beenden des Spiels.
- `HudEvents.RENDER` – `(GuiGraphicsExtractor g, DeltaTracker delta)` nach dem Vanilla-HUD. Nicht, wenn das HUD mit [[F1]] ausgeblendet ist.
- `ScreenEvents.AFTER_INIT` – `(Minecraft mc, Screen screen, int width, int height)`, nachdem ein Menü seine Elemente aufgebaut hat, auch nach Größenänderungen des Fensters.
- `WorldEvents.JOIN` und `WorldEvents.LEAVE` – `(Minecraft mc)` beim Betreten und Verlassen einer Welt oder eines Servers.
- `ChatEvents.RECEIVE` – `(Component message, boolean fromPlayer)` für empfangene Chatnachrichten; `fromPlayer` ist bei System- und Servernachrichten `false`.

Mit `ScreenEvents.addWidget(screen, widget)` baust du eigene Knöpfe in fremde Menüs ein:

```java
ScreenEvents.AFTER_INIT.register((mc, screen, width, height) -> {
    if (screen instanceof TitleScreen) {
        ScreenEvents.addWidget(screen, Button.builder(Component.literal("Meine Mod"),
                        button -> mc.gui.hud.getChat().addClientSystemMessage(Component.literal("Hallo!")))
                .bounds(6, height - 26, 90, 20)
                .build());
    }
});
```

### Tasten

Eigene Tasten meldest du mit `KeyMappings.register(...)` an – nur in `onInitialize()`, danach sind die Optionen schon geladen. Sie erscheinen unter Optionen → Steuerung und werden wie die Vanilla-Tasten in `options.txt` gespeichert.

```java
KeyMapping.Category kategorie = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("meinemod", "main"));
KeyMapping hallo = KeyMappings.register(
        new KeyMapping("key.meinemod.hallo", InputConstants.Type.KEYBOARD, InputConstants.KEY_H, kategorie));

ClientEvents.TICK_END.register(mc -> {
    while (hallo.consumeClick()) {
        mc.gui.hud.getChat().addClientSystemMessage(Component.literal("Hallo!"));
    }
});
```

Die Namen übersetzt der Loader aus den Sprachdateien deiner Mod, z. B. `assets/meinemod/lang/de_de.json`:

```json
{
  "key.category.meinemod.main": "Meine Mod",
  "key.meinemod.hallo": "Hallo sagen"
}
```

## Eingriffe in Minecraft: Transformer

Statt Mixins nutzt der Heldix Loader Transformer. Ein `ClassTransformer` nennt in `targets()` die internen Namen seiner Zielklassen und verändert sie in `transform(className, node)` als ASM-`ClassNode`.

```java
package de.du.meinemod;

import dev.heldixclient.loader.api.transform.ClassTransformer;
import dev.heldixclient.loader.api.transform.Patches;
import org.objectweb.asm.tree.ClassNode;

import java.util.Set;

// Das Sichtfeld läuft durch eine eigene statische Methode
public class MeinTransformer implements ClassTransformer {
    @Override
    public Set<String> targets() {
        return Set.of("net/minecraft/client/Camera");
    }

    @Override
    public void transform(String className, ClassNode node) {
        Patches.modifyReturnValue(Patches.method(node, "calculateFov", "(F)F"),
                "de/du/meinemod/Hooks", "fov", "(F)F");
    }
}
```

```java
package de.du.meinemod;

public final class Hooks {
    public static volatile boolean weit;

    // bekommt den Originalwert und gibt den neuen zurück
    public static float fov(float original) {
        return weit ? original * 1.2f : original;
    }
}
```

> **Achtung:** Transformer werden erzeugt, bevor Minecraft startet. Die Transformer-Klasse darf deshalb keine Minecraft-Klassen benutzen, nur deren Namen als Text. Die eigentliche Logik gehört in statische Hook-Methoden wie oben.

### Bausteine in Patches

- `method(node, name, deskriptor)` – findet eine Methode, z. B. `("calculateFov", "(F)F")`.
- `head(methode, code)` – Code ganz am Anfang einfügen.
- `cancelAtHead(methode, bedingung)` – am Anfang `if (bedingung) return;`, nur bei `void`-Methoden.
- `beforeReturns(methode, () -> code)` und `tail(methode, code)` – vor jedem bzw. vor dem letzten `return`.
- `modifyReturnValue(methode, hookKlasse, hookName, hookDeskriptor)` – jeden Rückgabewert durch eine statische Methode leiten.
- `afterCalls(…)` und `replaceCalls(…)` – Code nach bestimmten Aufrufen einfügen bzw. Aufrufe ersetzen.
- `beforeFieldWrite(…)` und `afterFirstFieldWrite(…)` – vor jedem bzw. nach dem ersten Schreiben eines Feldes.

Den eingefügten Bytecode baust du mit `Code`: `Code.begin()`, dann z. B. `loadThis()`, `loadArg(methode, index)`, `getField(…)`, `invokeStatic(…)`, `invokeVirtual(…)`, `returnVoid()`, `ifTrue(dann)` oder `returnIfNonNull()`. Ein Abbruch am Anfang einer Methode sieht so aus:

```java
// if (Hooks.blockieren()) return;
Patches.cancelAtHead(methode, Code.begin().invokeStatic("de/du/meinemod/Hooks", "blockieren", "()Z"));
```

Alle Bausteine suchen zuerst ihr Ziel und werfen eine `PatchException`, wenn etwas fehlt – die Methode bleibt dann unverändert. Schlägt ein Transformer fehl, fehlt nur diese eine Funktion; der Grund steht im Log und in `HeldixLoader.problems()`.

Die Deskriptoren der Minecraft-Methoden liefert `javap -s -p` auf die Client-JAR, z. B. `javap -s -p -cp client.jar net.minecraft.client.Camera`.

## Ressourcen (ab Loader 2.1.0)

Liegt eine `pack.mcmeta` in der JAR, lädt der Loader die Mod als eingebautes Ressourcenpaket. Texturen, Sounds, Modelle, Shader und Post-Effekte unter `assets/<modid>/…` funktionieren dann genauso wie in einem Ressourcenpaket. Das Paket ist immer aktiv und liegt unter den Paketen des Spielers, die es also überschreiben können. Für Minecraft 26.3:

```json
{ "pack": { "description": "Meine Mod", "min_format": 97, "max_format": 999 } }
```

## Bauen

Heldix-Mods werden für Java 25 gebaut. Zum Kompilieren brauchst du zwei Dinge, beide nur als `compileOnly`:

- **den Heldix Loader** (`heldix-loader-2.3.0.jar`, ASM ist darin schon enthalten). Nach dem ersten Start einer Heldix-Instanz liegt die Datei im Datenordner des Launchers unter `libraries/dev/heldixclient/heldix-loader/2.3.0/`; unter Windows ist das `%APPDATA%\.heldixclient`.
- **Minecraft selbst**: die Client-JAR und ihre Bibliotheken. Seit 26.1 ist Minecraft nicht mehr verschleiert, Mappings und Loom brauchst du deshalb nicht.

Im Beispielprojekt lädt das Skript `gradle/minecraft.gradle` die Client-JAR und alle Bibliotheken direkt von Mojang und legt sie auf den Compile-Classpath. Die Minecraft-Version steht in der `gradle.properties`:

```text
minecraft_version=26.3
```

```groovy
plugins {
    id 'java'
}

// Minecraft-Client und Bibliotheken von Mojang, nur zum Kompilieren
apply from: rootProject.file('gradle/minecraft.gradle')

version = '1.0.0'

dependencies {
    // Heldix Loader inklusive ASM, im Spiel bringt ihn der Launcher mit
    compileOnly files('libs/heldix-loader-2.3.0.jar')
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = 25
    it.options.encoding = 'UTF-8'
}
```

Das Beispielprojekt mit diesem Skript bekommst du auf Anfrage über den [Support](/konto#ziel=support). Die heruntergeladene Client-JAR liegt danach unter `.gradle/minecraft/26.3/client.jar` – das ist auch die Datei für `javap`.

## In Fabric-Instanzen

Den Loader gibt es zusätzlich als Fabric-Mod `heldixloader`. Damit laufen Heldix-Mods auch in Fabric-Instanzen, zusammen mit Sodium, Iris und anderen Fabric-Mods. Der Launcher legt ihn automatisch in Fabric-Instanzen, in denen HeldixClient eingeschaltet ist (Instanz → Einstellungen → HeldixClient).

Damit deine Mod auch dort läuft, bekommt die JAR neben der `heldix.mod.json` eine `fabric.mod.json` ohne Einstiegspunkte:

```json
{
  "schemaVersion": 1,
  "id": "meinemod",
  "version": "1.0.0",
  "name": "Meine Mod",
  "environment": "client",
  "depends": {
    "heldixloader": ">=2.3.0",
    "minecraft": "26.3"
  }
}
```

- Fabric lädt die JAR dann selbst; deine Heldix-Einstiegspunkte ruft weiter der Heldix Loader auf.
- Die Transformer laufen in Fabric über ein Mixin-Plugin, nach allen anderen Mixins, mit denselben ASM-Eingriffen wie beim Java-Agent.
- Verändern lassen sich in Fabric nur die Minecraft-Klassen, die der Heldix Loader dafür vorgesehen hat – die Klassen, die der Loader selbst und HeldixClient brauchen, z. B. `Minecraft`, `Camera`, `Gui`, `Hud`, `Screen` und `GameRenderer`. Für jede andere Zielklasse meldet der Loader beim Start „In Fabric kann … nicht verändert werden“ unter `HeldixLoader.problems()`.
- Ressourcen wie Texturen, Shader und Sprachdateien lädt in Fabric die Fabric API. `HeldixLoader.platform()` gibt dort `"fabric"` zurück.

## Fehler und Fehlersuche

- Mods mit falscher Minecraft-Version, fehlender Abhängigkeit oder doppelter ID überspringt der Loader und nennt den Grund. Du findest die Hinweise im Log, in `HeldixLoader.problems()` und im Spiel im Heldix-Menü unter **Einstellungen → Info** bei „Hinweise beim Start“.
- Wirft eine Mod in `onInitialize()` einen Fehler, bricht das Spiel mit einem Crash-Report ab, in dem die Mod genannt ist.
- Mit `-Dheldix.dumpClasses=<Ordner>` speichert der Loader alle veränderten Klassen; danach kannst du sie mit `javap -c` ansehen. Das Argument trägst du im Launcher unter **Einstellungen → Java → Zusätzliche JVM-Argumente** ein, am besten mit einem Ordner ohne Leerzeichen, z. B. `-Dheldix.dumpClasses=C:\heldix-dump`.

## Namen in Minecraft 26.x

Loader und Mods nutzen direkt Mojangs Klassennamen. Einige weichen von älteren Anleitungen ab:

- `GuiGraphics` heißt jetzt `GuiGraphicsExtractor` (mit `text()` und `fill()`).
- Menüs öffnest du über `minecraft.gui.setScreen(...)`.
- Das Sichtfeld wird in `Camera.calculateFov` berechnet.
- Tastencodes stehen in `InputConstants`, die linke Maustaste ist dort `MOUSE_BUTTON_LEFT`.
- F3-Zeilen sind Einträge in `DebugScreenEntries`.
