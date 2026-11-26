---
titel: Eingriffe in Minecraft mit dem Heldix Loader
beschreibung: Für Addons, die direkt in Minecraft eingreifen: Einstiegspunkt, Ereignisse, Tasten und Transformer des Heldix Loaders – dazu ältere Heldix-Mods mit heldix.mod.json.
reihenfolge: 3
stichworte: mod, loader, heldix loader, heldix.mod.json, heldix.addon.json, clientEntrypoint, transformer, asm, patches, events, fabric, ressourcen, greift in minecraft ein, minecraft-version
---
Der **Heldix Loader** ist der eigene Mod-Loader von HeldixClient. Er läuft als Java-Agent, verändert Minecraft-Klassen beim Laden direkt mit ASM und braucht weder Fabric noch Mixin. HeldixClient selbst nutzt ihn genauso. Aktuell ist Heldix Loader **2.4.0** für Minecraft **26.3**.

Diese Seite ist für **Addons, die direkt in Minecraft eingreifen** ([Weg 2](/entwickler/addons#weg-2-eingriff-in-minecraft)): mit `clientEntrypoint` und `transformers` in ihrer `heldix.addon.json`. Dieselbe Loader-API nutzen auch ältere Heldix-Mods mit einer `heldix.mod.json` im Ordner `mods` – die laufen weiter.

> **Hinweis:** Eingriffe in Minecraft sind die Profi-Stufe. Sie sind an die Minecraft-Version gebunden und müssen für neue Versionen angepasst werden. Für HUD-Elemente, Tasten, Einblendungen und vieles mehr reicht die [Heldix-API](/entwickler/addons) – sie läuft über Minecraft-Updates hinweg.

## So startet ein Heldix-Spiel

1. Der Launcher startet ganz normales Vanilla-Minecraft und hängt zusätzlich `-javaagent:heldix-loader-<version>.jar` und `-Dheldix.gameDir=<Instanz>` an.
2. Noch bevor Minecraft startet, liest der Loader die Addons mit Eingriff in Minecraft aus dem Ordner `heldix-addons` (abgeschaltete `.jar.disabled` lässt er liegen) und die älteren Heldix-Mods aus `mods`. Er prüft Minecraft-Version, Loader-Version und Abhängigkeiten, legt passende JARs auf den Classpath, liest ihre Übersetzungen und registriert ihre Transformer. Passt die Minecraft-Version nicht, lädt er das Addon nicht und meldet den Grund.
3. Während Minecraft seine Klassen lädt, verändert der Loader die nötigen Stellen per ASM. Stack-Map-Frames berechnet er selbst, ohne dabei Klassen zu früh zu laden.
4. Im Konstruktor von `Minecraft` ruft der Loader erst die `clientEntrypoint`s der Addons auf (ein Fehler hält nur das Addon an), dann die Einstiegspunkte der älteren Heldix-Mods, also `onInitialize()`. Den `entrypoint` (Heldix-API) eines Addons lädt danach HeldixClient über denselben Classloader.

Fabric-Mods im `mods`-Ordner einer Heldix-Instanz erkennt der Loader und überspringt sie mit einem Hinweis, ohne dass das Spiel abstürzt. Dasselbe gilt für Heldix-Addons, die versehentlich dort liegen.

## Im Addon: die heldix.addon.json

Ein Addon mit Eingriff in Minecraft nennt in seiner `heldix.addon.json` zusätzlich zu den üblichen Angaben ([Aufbau eines Addons](/entwickler/addons#die-heldix-addon-json)) seinen Einstiegspunkt für den Loader, seine Transformer und die passenden Minecraft-Versionen:

```json
{
  "id": "weites-sichtfeld",
  "name": "Weites Sichtfeld",
  "version": "1.0.0",
  "authors": ["Du"],
  "api": 4,
  "clientEntrypoint": "de.du.sichtfeld.SichtfeldStart",
  "transformers": ["de.du.sichtfeld.SichtfeldTransformer"],
  "minecraft": ["26.3"],
  "loader": ">=2.4.0"
}
```

- `clientEntrypoint` – eine Klasse, die `HeldixModInitializer` implementiert (siehe [Der Einstiegspunkt](#der-einstiegspunkt)).
- `transformers` – Klassen, die `ClassTransformer` implementieren (siehe [Transformer](#eingriffe-in-minecraft-transformer)).
- `minecraft` – Pflicht bei Eingriffen: die Minecraft-Versionen als Liste, z. B. `["26.2", "26.3"]`. Einträge dürfen auch Regeln wie unten sein, etwa `26.x` oder `>=26.2` – im Addon-Store aber nur genaue Versionen und Muster wie `26.x` oder `*`.
- `loader` – optional, die nötige Version des Heldix Loaders.
- `loaders` – optional, `["heldix"]`, `["fabric"]` oder beides. Ohne Angabe läuft das Addon überall, wo es geht; im Addon-Store gilt es dann als „nur Heldix-Instanzen“.
- `entrypoint` – optional zusätzlich: eine `HeldixAddon`-Klasse für die Heldix-API.

Anders als ältere Heldix-Mods liegen solche Addons im Ordner `heldix-addons`, kommen über den [Addon-Store](/addons) und erscheinen dort mit **Greift in Minecraft ein**.

## Ältere Heldix-Mods: die heldix.mod.json

Eine ältere Heldix-Mod ist eine JAR mit einer `heldix.mod.json` im Wurzelverzeichnis und liegt im Ordner `mods`. Sie läuft weiter, und der Launcher zeigt sie in der Liste **Mods & Addons** als Addon an. In den Addon-Store kommt sie aber nur mit einer `heldix.addon.json` wie oben.

```json
{
  "id": "meinemod",
  "name": "Meine Mod",
  "version": "1.0.0",
  "description": "Was die Mod macht.",
  "authors": ["Du"],
  "minecraft": "26.3",
  "loader": ">=2.4.0",
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

- `version()` und `minecraftVersion()` – z. B. `"2.4.0"` und `"26.3"`.
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

- **den Heldix Loader** (`heldix-loader-2.4.0.jar`, ASM ist darin schon enthalten). Nach dem ersten Start einer Heldix-Instanz liegt die Datei im Datenordner des Launchers unter `libraries/dev/heldixclient/heldix-loader/2.4.0/`; unter Windows ist das `%APPDATA%\.heldixclient`.
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
    compileOnly files('libs/heldix-loader-2.4.0.jar')
    // nutzt dein Addon auch die Heldix-API (entrypoint):
    // compileOnly files('libs/heldix-api-1.0.0.jar')
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = 25
    it.options.encoding = 'UTF-8'
}
```

Das Beispielprojekt mit diesem Skript bekommst du auf Anfrage über den [Support](/konto#ziel=support). Die heruntergeladene Client-JAR liegt danach unter `.gradle/minecraft/26.3/client.jar` – das ist auch die Datei für `javap`.

## In Fabric-Instanzen

Den Loader gibt es zusätzlich als Fabric-Mod `heldixloader`. Damit laufen HeldixClient, Addons und Heldix-Mods auch in Fabric-Instanzen, zusammen mit Sodium, Iris und anderen Fabric-Mods. Der Launcher legt ihn automatisch in Fabric-Instanzen, in denen HeldixClient eingeschaltet ist (Instanz → Einstellungen → HeldixClient).

**Addons mit Eingriff in Minecraft** kennt Fabric selbst nicht. Der Loader erzeugt ihre Transformer beim Start einmal zur Prüfung: Stehen alle Ziele in der Liste unten (und schließen `loaders` Fabric nicht aus), legt er die JAR auf den Classpath von Fabric, meldet die Transformer an und ruft den `clientEntrypoint` auf – wie in Heldix-Instanzen. Sonst bleibt das Addon aus und zeigt „Läuft nur in Heldix-Instanzen“ mit den fehlenden Klassen. Addons nur mit `clientEntrypoint` und reine API-Addons laufen in Fabric immer.

Damit eine ältere Heldix-Mod auch dort läuft, bekommt die JAR neben der `heldix.mod.json` eine `fabric.mod.json` ohne Einstiegspunkte:

```json
{
  "schemaVersion": 1,
  "id": "meinemod",
  "version": "1.0.0",
  "name": "Meine Mod",
  "environment": "client",
  "depends": {
    "heldixloader": ">=2.4.0",
    "minecraft": "26.3"
  }
}
```

- Fabric lädt die JAR dann selbst; deine Heldix-Einstiegspunkte ruft weiter der Heldix Loader auf.
- Die Transformer laufen in Fabric über ein Mixin-Plugin, nach allen anderen Mixins, mit denselben ASM-Eingriffen wie beim Java-Agent.
- Verändern lassen sich in Fabric nur die Minecraft-Klassen, die der Heldix Loader dafür vorgesehen hat – die Liste steht unten.
- Für jede andere Zielklasse meldet der Loader beim Start „In Fabric kann … nicht verändert werden“ unter `HeldixLoader.problems()`. Anders als beim Java-Agent verwirft der Fabric-Weg halbe Änderungen nicht: Such erst alle Ziele und prüf sie, dann ändere.
- Ressourcen wie Texturen, Shader und Sprachdateien lädt in Fabric die Fabric API. `HeldixLoader.platform()` gibt dort `"fabric"` zurück.

Zielklassen, die Transformer in Fabric verändern können (Loader 2.4.0, Minecraft 26.3):

- **Spiel und Optionen:** `net.minecraft.client.Minecraft`, `net.minecraft.client.Options`, `net.minecraft.client.resources.language.ClientLanguage`, `com.mojang.blaze3d.platform.FramerateLimitTracker`
- **HUD und Zeichnen:** `net.minecraft.client.gui.Hud`, `net.minecraft.client.gui.Gui`, `net.minecraft.client.gui.GuiGraphicsExtractor`, `net.minecraft.client.renderer.GameRenderer`, `net.minecraft.client.gui.components.DebugScreenOverlay`
- **Menüs:** `net.minecraft.client.gui.screens.Screen`, `TitleScreen`, `LoadingOverlay`, `LevelLoadingScreen`, `ConnectScreen` (alle in `net.minecraft.client.gui.screens`) und `net.minecraft.client.gui.components.AbstractSelectionList`
- **Chat und Tab-Liste:** `net.minecraft.client.multiplayer.chat.ChatListener`, `net.minecraft.client.gui.components.ChatComponent`, `net.minecraft.client.gui.screens.ChatScreen`, `net.minecraft.client.gui.components.PlayerTabOverlay`
- **Netzwerk:** `net.minecraft.client.multiplayer.ClientPacketListener`
- **Kamera und Eingabe:** `net.minecraft.client.Camera`, `net.minecraft.client.MouseHandler`, `net.minecraft.client.player.KeyboardInput`
- **Spieler und Entitäten:** `net.minecraft.client.player.AbstractClientPlayer`, `net.minecraft.world.entity.Entity`, `net.minecraft.client.renderer.entity.EntityRenderer`, `net.minecraft.client.renderer.entity.layers.CapeLayer`
- **Gedroppte Items:** `net.minecraft.client.renderer.entity.ItemEntityRenderer`, `net.minecraft.client.renderer.entity.state.ItemEntityRenderState`

## Fehler und Fehlersuche

- Addons und Mods mit falscher Minecraft-Version, fehlender Abhängigkeit oder doppelter ID überspringt der Loader und nennt den Grund. Du findest die Hinweise im Log, in `HeldixLoader.problems()` und im Spiel im Heldix-Menü unter **Einstellungen → Info** bei „Hinweise beim Start“.
- Wirft der `clientEntrypoint` eines Addons einen Fehler, läuft das Spiel weiter und nur das Addon ist aus; das Heldix-Menü zeigt den Grund rot an der Karte. Wirft eine ältere Heldix-Mod in `onInitialize()`, bricht das Spiel mit einem Crash-Report ab, in dem sie genannt ist.
- Mit `-Dheldix.dumpClasses=<Ordner>` speichert der Loader alle veränderten Klassen; danach kannst du sie mit `javap -c` ansehen. Das Argument trägst du im Launcher unter **Einstellungen → Java → Zusätzliche JVM-Argumente** ein, am besten mit einem Ordner ohne Leerzeichen, z. B. `-Dheldix.dumpClasses=C:\heldix-dump`.

## Namen in Minecraft 26.x

Loader und Mods nutzen direkt Mojangs Klassennamen. Einige weichen von älteren Anleitungen ab:

- `GuiGraphics` heißt jetzt `GuiGraphicsExtractor` (mit `text()` und `fill()`).
- Menüs öffnest du über `minecraft.gui.setScreen(...)`.
- Das Sichtfeld wird in `Camera.calculateFov` berechnet.
- Tastencodes stehen in `InputConstants`, die linke Maustaste ist dort `MOUSE_BUTTON_LEFT`.
- F3-Zeilen sind Einträge in `DebugScreenEntries`.
