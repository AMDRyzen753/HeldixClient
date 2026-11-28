# Heldix Loader

Der Heldix Loader ([mod/heldix-loader](../mod/heldix-loader)) ist ein eigenständiger Mod-Loader für Minecraft. Fabric, Fabric API und Mixin werden dafür nicht gebraucht. Die HeldixClient-Mod ist selbst eine ganz normale Heldix-Mod.

Er lädt zwei Arten von Erweiterungen: **Heldix-Mods** (`heldix.mod.json` in `mods/`, wie bisher) und – ab Loader 2.4.0 – **Addons mit Zugriff auf Minecraft** (`heldix.addon.json` mit `clientEntrypoint` oder `transformers` in `heldix-addons/`). Für Neues sind Addons der empfohlene Weg; wie man sie schreibt, steht in [addons.md](addons.md#weg-2-mit-zugriff-auf-minecraft).

## So startet ein Heldix-Spiel

1. Der Launcher startet ganz normales Vanilla-Minecraft. Zusätzlich hängt er `-javaagent:heldix-loader-<version>.jar` und `-Dheldix.gameDir=<Instanz>` an.
2. Noch bevor Minecraft startet, ruft Java den Loader auf ([HeldixAgent](../mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/HeldixAgent.java)). Der Loader:
   - liest alle JARs in `mods/` und prüft ihre `heldix.mod.json` (Minecraft-Version, Loader-Version, Abhängigkeiten);
   - legt passende Mods auf den Classpath und liest ihre Übersetzungen;
   - registriert ihre Transformer;
   - erledigt in `heldix-addons/` die im Spiel vorgemerkten Änderungen (`.jar.neu`, `.entfernen`, `.ausschalten`), liest die Addons mit Zugriff auf Minecraft (nicht die `.jar.disabled`), prüft `minecraft`, `loader`, `loaders` und `api`, legt passende auf den Classpath und registriert ihre Transformer. Was nicht passt, bleibt aus und steht mit Grund in `HeldixLoader.problems()` und `HeldixLoader.addons()`.
3. Während Minecraft seine Klassen lädt, verändert der Loader die nötigen Stellen per ASM ([TransformerChain](../mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/TransformerChain.java)). Stack-Map-Frames berechnet er selbst, ohne dabei Klassen zu früh zu laden.
4. Im Konstruktor von `Minecraft` ruft der Loader erst die `clientEntrypoint`s der Addons auf (ein Fehler hält nur das Addon an), dann die Einstiegspunkte der Mods, also `onInitialize()`. Den `entrypoint` (Heldix-API) eines Addons lädt danach HeldixClient über denselben Classloader.

Diese Eingriffe macht der Loader selbst ([BuiltinPatches](../mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/BuiltinPatches.java)):

- Mods starten
- eigene Tastenbelegungen
- Übersetzungen aus `assets/<id>/lang/*.json` der Mods
- die Events der Loader-API

Schlägt ein Eingriff fehl, etwa nach einem Minecraft-Update, fehlt nur diese eine Funktion. Der Grund steht dann im Log und in `HeldixLoader.problems()`.

Fabric-Mods im `mods`-Ordner einer Heldix-Instanz erkennt der Loader und überspringt sie mit Hinweis, ohne dass das Spiel abstürzt.

## Die Loader-API

Die Loader-API (`HeldixLoader`, `HeldixModInitializer`, `KeyMappings`, die Events und `ClassTransformer`/`Patches`/`Code`) ist für Addons mit Zugriff auf Minecraft und für Heldix-Mods dieselbe. Beschrieben ist sie mit den Hinweisen zu Transformern in [addons.md → Die Loader-API](addons.md#die-loader-api).

## Heldix Loader in Fabric

Den Loader gibt es zusätzlich als Fabric-Mod `heldixloader` ([mod/heldix-loader-fabric](../mod/heldix-loader-fabric)). Damit laufen Heldix-Mods wie HeldixClient auch in Fabric-Instanzen, zusammen mit Sodium, Iris und anderen Fabric-Mods. Der Launcher legt beides in Fabric-Instanzen automatisch in den mods-Ordner (Instanz → Einstellungen → HeldixClient).

So funktioniert es:

- Eine Heldix-Mod, die auch in Fabric laufen soll, hat neben der `heldix.mod.json` eine `fabric.mod.json` ohne Einstiegspunkte, nur mit `"depends": { "heldixloader": ">=2.4.0" }`. Fabric lädt die JAR dann selbst; die Heldix-Einstiegspunkte ruft weiter der Heldix Loader auf.
- Der Loader startet in Fabrics `preLaunch`, liest die `heldix.mod.json` aller geladenen Fabric-Mods und meldet ihre Transformer an.
- Die Transformer laufen über ein Mixin-Plugin: Ein leerer Mixin (`TransformTargets`, höchste Priorität) sorgt dafür, dass Mixin nach allen anderen Mixins `postApply` aufruft. Dort wenden dieselben `ClassTransformer` ihre ASM-Eingriffe an wie beim Java-Agent.
- Neue Ziel-Klassen müssen deshalb in [Targets.java](../mod/heldix-loader-fabric/src/main/java/dev/heldixclient/loader/fabric/Targets.java) und `TransformTargets` stehen (zuletzt in Loader 2.5.0: `DiscardedPayload` für den Server-Kanal `heldixclient:server` von HeldixClient 0.14.1; der eigenständige Loader ist in 2.5.0 inhaltlich unverändert, HeldixClient 0.14.1 verlangt aber Loader ab 2.5.0). Fehlt eine, meldet der Loader das beim Start unter `HeldixLoader.problems()`. Die Liste steht auch in [addons.md](addons.md#in-fabric-instanzen).
- **Addons mit Zugriff auf Minecraft** aus `heldix-addons/` kennt Fabric nicht. Der Loader erzeugt ihre Transformer einmal in einem eigenen Classloader zur Prüfung: Stehen alle Ziele in `Targets`, legt er die JAR über `FabricLauncherBase.getLauncher().addToClassPath(…)` auf Fabrics Classpath (Knot), meldet die Transformer an und ruft den `clientEntrypoint` auf; sonst bleibt das Addon aus mit „Läuft nur in Heldix-Instanzen“. `HeldixLoader.platformMods()` liefert die Fabric-Mods aus dem mods-Ordner (für die Anzeige im Heldix-Menü).
- Anders als beim Java-Agent verwirft der Fabric-Weg halbe Änderungen nicht: Wirft ein Transformer, nachdem er schon etwas geändert hat, bleibt diese Änderung in der Klasse. Deshalb erst alle Ziele suchen und prüfen, dann ändern (wie in [DroppedItemPatches](../mod/src/main/java/dev/heldixclient/transform/DroppedItemPatches.java)).
- Transformer dürfen in `postApply` auch Schnittstellen, Felder und Methoden anhängen (z. B. hängt HeldixClient an `ItemEntityRenderState` eine Schnittstelle mit einem Feld an); im Autotest in beiden Wegen geprüft.
- Ressourcen (Texturen, Shader, Sprachdateien) lädt in Fabric Fabric API; `HeldixLoader.platform()` gibt `"fabric"` zurück.

## Eine Heldix-Mod schreiben

Neue Erweiterungen schreibt man besser als [Addon mit Zugriff auf Minecraft](addons.md#weg-2-mit-zugriff-auf-minecraft): gleiche Möglichkeiten, aber ein Fehler beendet nicht das Spiel, es lässt sich an- und ausschalten und kommt über den Addon-Store. Heldix-Mods laufen weiter und erscheinen im Heldix-Menü unter Mods & Addons (nur zur Info).

Eine Heldix-Mod ist eine JAR mit einer `heldix.mod.json`:

```json
{
  "id": "meinemod",
  "name": "Meine Mod",
  "version": "1.0.0",
  "minecraft": "26.3",
  "loader": ">=2.4.0",
  "entrypoints": { "client": ["de.du.MeineMod"] },
  "transformers": ["de.du.MeinTransformer"],
  "depends": { "heldixclient": ">=0.10.0" }
}
```

Versionsangaben können `*`, `26.3`, `26.x`, `>=2.0.0`, `>1.0 <2.0` oder `26.2 || 26.3` sein. `transformers` und `depends` sind optional.

**Ressourcen (ab Loader 2.1.0):** Liegt eine `pack.mcmeta` in der JAR, lädt der Loader die Mod als eingebautes Ressourcenpaket. Dann gehen Texturen, Sounds, Modelle, Shader und Post-Effekte unter `assets/<modid>/…` genauso wie in einem Ressourcenpaket. Das Paket ist immer aktiv und liegt unter den Paketen des Spielers, die es also überschreiben können. Für Minecraft 26.3:

```json
{ "pack": { "description": "Meine Mod", "min_format": 97, "max_format": 999 } }
```

Beispiel: die Shader von HeldixClient unter [mod/src/main/resources/assets/heldixclient](../mod/src/main/resources/assets/heldixclient) (`post_effect/*.json` und `shaders/post/grade.fsh`).

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

Was bei Transformern wichtig ist, steht in [addons.md](addons.md#die-loader-api).

**Vollständige Beispiele**

- die HeldixClient-Mod: [HeldixClient.java](../mod/src/main/java/dev/heldixclient/HeldixClient.java), [HeldixPatches.java](../mod/src/main/java/dev/heldixclient/transform/HeldixPatches.java), [Hooks.java](../mod/src/main/java/dev/heldixclient/transform/Hooks.java)
- der [Autotest](../mod/autotest)

Gebaut wird mit Gradle wie in [mod/autotest/build.gradle](../mod/autotest/build.gradle): `compileOnly project(':heldix-loader')`; Minecraft kommt über [gradle/minecraft.gradle](../mod/gradle/minecraft.gradle).

## Fehler und Fehlersuche

- Mods mit falscher Minecraft-Version, fehlender Abhängigkeit oder doppelter ID überspringt der Loader und meldet sie mit Grund. Bei Addons mit Zugriff auf Minecraft genauso (falsche Version, `loaders`, Transformer nicht ladbar, in Fabric nicht unterstütztes Ziel); das Heldix-Menü zeigt den Grund rot an der Karte.
- Wirft eine Mod in `onInitialize()` einen Fehler, bricht das Spiel mit einem Crash-Report ab, in dem die Mod genannt ist. Wirft der `clientEntrypoint` eines Addons, läuft das Spiel weiter und nur das Addon ist aus.
- Mit `-Dheldix.dumpClasses=<Ordner>` speichert der Loader alle veränderten Klassen. Danach lassen sie sich mit `javap -c` ansehen.

## Hinweise zu Minecraft 26.x

Seit 26.1 ist Minecraft nicht mehr obfuskiert. Loader und Mod nutzen direkt Mojangs Klassennamen; Mappings und Loom werden nicht gebraucht. Einige Namen weichen von älteren Tutorials ab:

- `GuiGraphics` heißt jetzt `GuiGraphicsExtractor` (`text()`, `fill()`).
- Screens öffnet man über `minecraft.gui.setScreen(...)`.
- Das Sichtfeld wird in `Camera.calculateFov` berechnet.
- Tastencodes stehen in `InputConstants`. Die linke Maustaste ist dort `MOUSE_BUTTON_LEFT` (= 1, nicht 0).
- Gezeichnet wird über `com.mojang.renderpearl` mit zwei Backends, OpenGL und Vulkan. Das Startargument `--graphicsBackend vulkan` (oder `opengl`) legt das Backend fest; kann der PC kein Vulkan, nimmt Minecraft OpenGL. Welches läuft, verrät `RenderSystem.getDevice().getDeviceInfo().backendName()`.
- Post-Effekte (`assets/<ns>/post_effect/*.json`) und ihre Shader (`assets/<ns>/shaders/post/*.fsh`, GLSL 330) übersetzt Minecraft für beide Backends. Uniforms stehen in std140-Blöcken; die Reihenfolge in der JSON muss der im Shader entsprechen. Angefordert werden sie jedes Bild über `GameRenderer.getRequestedPostEffects()`.
- F3-Zeilen sind Einträge in `DebugScreenEntries`; welche sichtbar sind, steht in `minecraft.debugEntries`.

Der Loader ist auf diese unverschleierten Namen ausgelegt. Für alte, obfuskierte Versionen bräuchte er zusätzlich Mappings.
