# Mods & Addons

Heldix-Addons und Heldix-Mods sind **ein System**: Alles ist ein **Addon** mit einer `heldix.addon.json` und liegt im Ordner `heldix-addons/` der Instanz. Ein Addon kann auf zwei Wegen arbeiten – oder beides zugleich:

| | Weg 1: nur Heldix-API | Weg 2: mit Zugriff auf Minecraft |
| --- | --- | --- |
| In der `heldix.addon.json` | `entrypoint` (+ `api`) | `clientEntrypoint` und/oder `transformers` (+ `minecraft`) |
| Programmiert gegen | die [Heldix-API](../mod/heldix-api/src/main/java/dev/heldixclient/api) (nichts aus Minecraft) | die [Loader-API](../mod/heldix-loader/src/main/java/dev/heldixclient/loader) und Minecraft selbst (ASM-Transformer statt Mixins) |
| Geladen von | HeldixClient, eigener Classloader je Addon | dem Heldix Loader beim Spielstart, im Classloader des Spiels |
| Läuft nach Minecraft-Updates | ja, dieselbe JAR | nur in den Versionen aus `minecraft` |
| An/aus im Spiel | Ausschalten wirkt sofort | wirkt nach dem Neustart |
| Bei Fehlern | Addon wird abgeschaltet, das Spiel läuft weiter | Addon wird nicht geladen bzw. zeigt das Problem, das Spiel läuft weiter |
| Im Menü | Addon | Addon mit dem Hinweis **„Greift in Minecraft ein“** |

Der **Zugriff** steht nicht im Manifest, er folgt daraus: `minecraft`, sobald `clientEntrypoint` oder `transformers` gesetzt sind, sonst `api`. Ein Addon darf auch beides haben, z. B. einen Transformer für Minecraft und HUD-Module über die Heldix-API (`entrypoint`); dann lädt HeldixClient den `entrypoint` über denselben Classloader, den der Heldix Loader schon benutzt hat – es gibt keine Klasse doppelt, statische Felder sind für beide Teile dieselben.

Bisherige Heldix-Mods (`heldix.mod.json` im Ordner `mods/`) laufen unverändert weiter und erscheinen im Spiel in derselben Liste (siehe [unten](#bisherige-heldix-mods)). Fabric-Mods bleiben Fabric-Mods; in Fabric-Instanzen zeigt das Spiel sie nur zur Info mit an.

## Wo Addons erscheinen

- **Launcher:** Instanz → **Mods & Addons**: eine Liste mit Fabric-Mods, Addons und alten Heldix-Mods, an/aus, entfernen, aktualisieren; Hinzufügen aus dem Addon-Store, von Modrinth (Fabric-Instanzen) oder als Datei.
- **Im Spiel:** Heldix-Menü → **Mods & Addons** mit den Reitern **Installiert** und **Store**.
  - *Installiert* zeigt jedes Addon mit Icon, Version, Zustand („Aktiv · 2 Module“, „Ausgeschaltet“, „Fehler“, „Nicht geladen“, „Problem“) und einem Schalter; Addons mit Zugriff auf Minecraft tragen den Chip **„Greift in Minecraft ein“**. Darunter stehen die bisherigen Heldix-Mods (nur Info) und in Fabric-Instanzen die Fabric-Mods der Instanz (nur Info, verwaltet im Launcher).
  - **An/aus** schreibt dasselbe wie der Launcher: Ein ausgeschaltetes Addon heißt `<Datei>.jar.disabled` und wird beim Start übersprungen. Ein reines API-Addon geht beim Ausschalten **sofort** aus (`onDisable`, Module verschwinden, Aufgaben enden). Ein Addon, das in Minecraft eingreift, läuft bis zum Neustart weiter, weil sich Eingriffe in geladene Klassen nicht zurücknehmen lassen. Einschalten wirkt immer nach dem Neustart (Addons legen ihre Tasten beim Start an). Solange etwas erst nach dem Neustart wirkt, steht an der Karte **„Wirkt nach dem Neustart“** und oben auf der Seite ein Hinweis.
  - Unter Windows sind geladene JARs bis zum Spielende gesperrt und lassen sich nicht umbenennen. Das Spiel merkt sie dann in `heldix-addons/.ausschalten` vor (eine Datei pro Zeile); der Heldix Loader benennt sie beim nächsten Start um, bevor er etwas lädt – genauso wie `heldix-addons/.entfernen` (im Store entfernt) und `*.jar.neu` (im Store aktualisiert).
  - *Store* ist der Addon-Store (siehe [unten](#addon-store)).
- **Webseite:** `/addons` mit Beschreibung, Versionen, Prüfsumme und Download der JAR.

## Die `heldix.addon.json` (Version 2)

```json
{
  "id": "mein-addon",
  "name": "Mein Addon",
  "version": "1.0.0",
  "description": "Was das Addon macht.",
  "authors": ["Du"],
  "entrypoint": "de.du.MeinAddon",
  "api": 4,
  "clientEntrypoint": "de.du.MeinStart",
  "transformers": ["de.du.MeinTransformer"],
  "minecraft": ["26.3"],
  "loader": ">=2.4.0",
  "loaders": ["heldix", "fabric"]
}
```

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| `id` | ja | a-z, 0-9, `_` und `-`; je Instanz einmal (liegen mehrere Versionen da, gilt die neueste) |
| `name`, `version`, `description`, `authors` | nein | Anzeige; `version` wie `1.2.0` |
| `entrypoint` | einer der drei | Klasse, die `HeldixAddon` implementiert (Heldix-API) |
| `api` | mit `entrypoint` | Stufe der Heldix-API, die das Addon braucht (1 bis 4) |
| `clientEntrypoint` | einer der drei | Klasse, die `HeldixModInitializer` implementiert (Loader-API); läuft beim Spielstart im Konstruktor von `Minecraft`, zur selben Zeit wie die Einstiegspunkte der Heldix-Mods (vor ihnen) |
| `transformers` | einer der drei | Liste von Klassen, die `ClassTransformer` implementieren (Loader-API) |
| `minecraft` | mit `clientEntrypoint` oder `transformers` | Minecraft-Versionen, für die das Addon gebaut ist: Liste oder ein einzelner Text. Jede Angabe ist eine genaue Version (`26.3` passt nicht zu `26.3.1`) oder eine Regel wie in `heldix.mod.json` (`*`, `26.x`, `>=26.2`, `26.2 \|\| 26.3`); Snapshots (`26w14a`) passen nur genau. Leer bzw. weggelassen = jede Version (nur bei reinen API-Addons erlaubt). |
| `loader` | nein | benötigte Version des Heldix Loaders, z. B. `>=2.4.0` (Addons mit Zugriff auf Minecraft gibt es ab 2.4.0) |
| `loaders` | nein | wo das Addon laufen soll: `["heldix"]`, `["fabric"]` oder beides, jedes höchstens einmal. Schließt es die laufende Instanz aus, wird das Addon nicht geladen („Läuft nur in Heldix-Instanzen“ bzw. „Läuft nur in Fabric-Instanzen“). Weggelassen = überall, wo es geht (in Fabric entscheidet dann die [Liste der Ziel-Klassen](#in-fabric-instanzen)). Im Store gilt ohne Angabe: Zugriff `minecraft` → nur `heldix`, Zugriff `api` → beide. |

Mindestens einer von `entrypoint`, `clientEntrypoint` und `transformers` muss da sein. Fehler im Manifest meldet das Spiel auf Deutsch, z. B. „„minecraft“ fehlt – ein Addon mit „clientEntrypoint“ oder „transformers“ muss angeben, für welche Minecraft-Versionen es gebaut ist“, „„transformers“ muss eine Liste sein“, „„loaders“ darf nur „heldix“ und „fabric“ enthalten“ oder „Kein Einstiegspunkt …“. Gelesen und geprüft wird die Datei an einer Stelle ([AddonManifest](../mod/heldix-loader/src/main/java/dev/heldixclient/loader/api/AddonManifest.java)), für Heldix Loader und HeldixClient gleich. Alte Manifeste (Version 1, nur `entrypoint` und `api`) bleiben gültig.

**Im Addon-Store** dürfen in `minecraft` nur genaue Versionen und Muster wie `26.x` oder `*` stehen (`^[0-9A-Za-z][0-9A-Za-z._+*-]{0,31}$`); Regeln wie `>=26.2` oder `26.2 || 26.3` gehen nur in selbst installierten JARs, der Heldix-Dienst lehnt sie ab. `loader` prüft der Dienst beim Einreichen, ins Store-Manifest kommt es nicht.

## Weg 1: nur Heldix-API

Ein reines API-Addon besteht aus einer `heldix.addon.json` …

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

**Vorlagen:** [mod/addons/uhrzeit](../mod/addons/uhrzeit) (Uhrzeit, Spielzeit, Begrüßung; API 3: Farbe, Textfeld, Regler, Scheduler, Befehl; API 5: HUD-Stil, Tooltip, Klick; API 6: eigene Taste), [mod/addons/spotify](../mod/addons/spotify) (Tasten, Einstellungen, Bilder, Einblendungen, Hintergrund-Prozess, Befehle, Laufschrift, Fortschrittsbalken; API 5: Knöpfe im HUD, Stil-Optionen im HUD-Editor; API 6: Tasten im Untermenü) und [mod/addons/itemphysics](../mod/addons/itemphysics) (API 4: Renderer für gedroppte Items, Speicher je Item, Regler mit eigenem Text, Taste ohne Standardbelegung).

```powershell
cd mod
.\gradlew :addons:uhrzeit:build     # Ergebnis: mod/addons/uhrzeit/build/libs/
```

Zum Ausprobieren zieht man die JAR im Launcher unter **Instanz → Mods & Addons** in die Liste (der Launcher legt sie anhand der `heldix.addon.json` nach `heldix-addons/`) oder legt sie direkt in den Ordner `heldix-addons/` der Instanz. Für alle Spieler kommt sie über den [Addon-Store](#addon-store).

## Was die Heldix-API kann

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

**API 4** (ab HeldixClient 0.13.2, `"api": 4`)

| Neu | Wofür |
| --- | --- |
| `api.droppedItems()` → `DroppedItems` | Zeichnen der gedroppten Items in der Welt (Items am Boden und in der Luft) |
| `droppedItems().addRenderer(item -> …)` → `Registration` | Renderer anmelden: für jedes sichtbare Item in jedem Bild Höhe und Drehung festlegen, statt dass es schwebt und sich dreht. Es zeichnet nur der zuletzt angemeldete, noch aktive Renderer (auch über Addons hinweg); `cancel()` stellt das normale Zeichnen wieder her |
| `droppedItems().isSupported()` | false, wenn HeldixClient das Zeichnen in dieser Minecraft-Version nicht verändern kann (Renderer wirken dann nicht) |
| `DroppedItemRenderer.pose(item)` → `DroppedItemPose` oder `null` | läuft im Haupt-Thread einmal pro Item und Bild; `null` = dieses Item wie in Minecraft |
| `DroppedItem` | nur lesen, gilt nur während `pose`: `entityId()`, `itemId()` (z. B. `minecraft:diamond`), `stackSize()`, `count()` (gezeichnete Modelle, 1 bis 5), `ageTicks()` (mit Bruchteil des Ticks), `onGround()`, `inWater()`, `speed()`, `verticalSpeed()` (Blöcke/Tick), `flat()` (Modell höchstens 1/16 Block dick), `bobOffset()` (fest, zufällig, 0 bis 2π), Modell-Box `minX()` … `maxZ()` und `memory()` (8 Zahlen je Item, bleiben über Bilder erhalten) |
| `DroppedItemPose(lift, yaw, pitch, roll)`, `DroppedItemPose.of(lift, yaw, pitch)` | Modell-Mitte `lift` Blöcke über der Position des Items, dann Drehung um die Hochachse (`yaw`), die Querachse (`pitch`, 90 = flach) und die Längsachse (`roll`), Winkel in Grad. `liftOnly(…)` / `rotationOnly(…)`: der andere Teil bleibt wie in Minecraft |
| `api.cosmetics()` → `Cosmetics` | Heldix-Cosmetics (Hüte, Flügel, Partikel, Begleiter, Capes aus dem Katalog des Teams, siehe [dienst.md](dienst.md#cosmetics-katalog)): lesen, lokal vorführen, kurz animieren. Die Auswahl ändert nur der Spieler |
| `cosmetics().catalog()` → `List<CosmeticInfo>` | alle geladenen und geprüften Cosmetics (Signatur des Teams, alle Regeln des Formats): `id()`, `slot()`, `name()`, `description()`, `teamOnly()`; leer ohne Heldix-Dienst. Die eingebauten Capes stehen nicht darin |
| `cosmetics().worn(uuid, slot)` → `Optional<String>` | was ein Spieler trägt: für dich deine Auswahl, für andere, was der Dienst beim Nachschlagen gemeldet hat (nur erkennbare HeldixClient-Spieler in der Nähe oder in der Tab-Liste) |
| `cosmetics().mine()` → `Map<Slot, String>` | deine Auswahl je Slot (`HEAD`, `BACK`, `AURA`, `COMPANION`, `CAPE`; nur belegte, ohne Vorschauen, ohne eigene Cape-Bilder) |
| `cosmetics().preview(slot, id, dauer)` → `Registration` | zeigt ein Cosmetic **nur bei dir** (Third-Person, Inventar, Figuren im Heldix-Menü), z. B. als Vorschau in einem Addon-Menü; endet nach der Dauer (höchstens 1 h), mit `cancel()` oder wenn das Addon abgeschaltet wird. Beim Dienst ändert sich nichts. Unbekannte ID für den Slot: `IllegalArgumentException` |
| `cosmetics().animate(slot, effekt)` | kurzer Effekt (etwa 1,6 s) an deinem Cosmetic, nur bei dir: `"flap"` (Flügel doppelt so schnell, `BACK`), `"spin"` (einmal drehen, `HEAD`/`BACK`/`COMPANION`), `"bounce"` (hüpfen, `HEAD`/`BACK`/`COMPANION`), `"burst"` (Schwall Partikel, `AURA`, höchstens 64 gleichzeitig); ein Effekt, den es für den Slot nicht gibt: `IllegalArgumentException` |
| `cosmetics().onChange(change -> …)` → `Registration` | deine Auswahl hat sich geändert (Heldix-Menü, Launcher, Webseite – letztere beim nächsten Abgleich): `slot()`, `previous()`, `current()`; im Haupt-Thread, Fehler zählen wie Addon-Fehler |

```java
// Items liegen flach und still am Boden; in der Luft schweben sie wie gewohnt
Registration flach = api.droppedItems().addRenderer(item -> {
    if (!item.onGround()) return null;                       // null = wie Minecraft
    float yaw = (float) Math.toDegrees(item.bobOffset());     // feste, zufällige Ausrichtung
    float pitch = item.flat() ? 90 : 0;                      // flache Items hinlegen, Blöcke aufrecht
    // tiefste Ecke auf den Boden: flach liegend zählt die Dicke (z), aufrecht die Unterkante (y)
    float lift = item.flat() ? item.maxZ() + 0.005f : -item.minY() + 0.005f;
    return DroppedItemPose.of(lift, yaw, pitch);
});
flach.cancel();                                              // wieder wie Minecraft

// Werte über mehrere Bilder: eigener Speicher je Item (8 Zahlen, anfangs 0)
api.droppedItems().addRenderer(item -> {
    float[] speicher = item.memory();
    if (speicher[0] == 0) speicher[0] = item.ageTicks();      // erstes Bild dieses Items merken
    if (item.ageTicks() - speicher[0] < 20) return null;      // die erste Sekunde wie Minecraft
    return DroppedItemPose.liftOnly(-item.minY() + 0.005f);  // danach kein Schweben mehr, Drehen wie gewohnt
});
```

Ein vollständiges Beispiel mit Überschlagen in der Luft, sanftem Hinlegen und Stapeln ist [mod/addons/itemphysics](../mod/addons/itemphysics).

```java
// Cosmetics: Katalog lesen, im eigenen Menü vorführen, auf Änderungen hören
Cosmetics cosmetics = api.cosmetics();
for (CosmeticInfo c : cosmetics.catalog()) {
    if (c.slot() == Cosmetics.Slot.BACK) api.logger().info(c.name() + (c.teamOnly() ? " (nur Team)" : ""));
}
Registration vorschau = cosmetics.preview(Cosmetics.Slot.HEAD, "krone", Duration.ofSeconds(10)); // nur bei dir
vorschau.cancel();                                                                                // sofort wieder weg
cosmetics.animate(Cosmetics.Slot.BACK, "flap");                                                   // Flügel kurz schneller
cosmetics.onChange(change -> api.chat("Neu in " + change.slot() + ": " + change.current().orElse("nichts")));
Optional<String> hut = cosmetics.worn(andererSpieler, Cosmetics.Slot.HEAD);                       // z. B. "zylinder"
```

Cosmetics sind reine Daten (Modell, Textur, Partikel), vom Team mit dem Update-Schlüssel signiert. HeldixClient prüft jeden Umschlag selbst (Signatur über `"heldix-cosmetic\n" + manifest`, alle Regeln aus [service/src/cosmetics-format.ts](../service/src/cosmetics-format.ts), nachgebaut in [CosmeticFormat](../mod/src/main/java/dev/heldixclient/cosmetic/CosmeticFormat.java)) und zeichnet sie in Heldix- und Fabric-Instanzen ([CosmeticRenderer](../mod/src/main/java/dev/heldixclient/cosmetic/CosmeticRenderer.java), Eingriffe am Anfang von `CapeLayer.submit` und `EntityRenderer.submit`). Ein Addon kann keine eigenen Cosmetics zeichnen lassen, nichts an andere Spieler senden und die Auswahl beim Dienst nicht ändern.

So funktioniert es (gedroppte Items): HeldixClient verändert dafür `ItemEntityRenderer` und `ItemEntityRenderState` ([DroppedItemPatches](../mod/src/main/java/dev/heldixclient/transform/DroppedItemPatches.java)). Am Ende von `extractRenderState` fragt der Hook den Renderer des Addons und legt die Lage am Renderzustand ab; in `submit` gehen das eine `translate` (Schweben) und das eine `rotate` (Drehen) durch die Hooks. Ohne Lage rufen sie genau Minecrafts Methoden mit Minecrafts Werten auf – ohne Addon bleibt alles wie bisher. Hat Minecraft den Code umgebaut, bleibt die Klasse ganz unverändert, `isSupported()` ist false und das Problem steht unter `HeldixLoader.problems()`. Das gilt in Heldix- und Fabric-Instanzen (in Fabric stehen beide Klassen in `Targets`/`TransformTargets`). `gradlew checkTransforms` (läuft mit jedem `build`) prüft die veränderten Klassen mit dem ASM-Verifier gegen die echte Minecraft-JAR.

Werte, die keinen Sinn ergeben, fängt HeldixClient ab: `lift` wird auf ±2 Blöcke begrenzt, Winkel über 3600° auf 0 bis 360° gebracht; ist `lift` keine endliche Zahl (`NaN`, unendlich), schwebt das Item wie gewohnt, ist ein Winkel keine endliche Zahl, dreht es sich wie gewohnt. Wirft der Renderer, wird dieses Item in diesem Bild normal gezeichnet und der Fehler zählt wie jeder Addon-Fehler.

**API 5** (ab HeldixClient 0.13.3, `"api": 5`): HUD-Elemente anklickbar, im HUD-Stil, mehr Zeichenhilfen

Seit der HUD-Überarbeitung (HeldixClient 0.13.3) haben alle HUD-Elemente ein gemeinsames Aussehen (Stil Heldix, Minimal oder Klassisch, Akzentfarbe, Deckkraft, Größe; dazu Einstellungen je Element im Rechtsklick-Menü des HUD-Editors), hängen an einem Bezugspunkt am Bildschirmrand und lassen sich im Spiel bedienen: **bei offenem Chat** oder mit der Taste **„HUD bedienen“** (Optionen → Steuerung → HeldixClient, ab Werk nicht belegt) zeigen sie beim Überfahren einen Rahmen und einen Tooltip und reagieren auf Klicks – beim normalen Spielen nie, und ein Klick erreicht das Spiel nicht. Addon-Elemente machen dabei mit:

| Neu | Wofür |
| --- | --- |
| `HudRenderer.onClick(HudClick)` → `boolean` | Klick auf das Element (Default-Methode, ein Lambda zeichnet weiter nur). `HudClick`: `x()`/`y()` lokal in den Koordinaten der Zeichenfläche, `button()` (`LEFT`, `RIGHT`, `MIDDLE`), `shift()`, `control()`, `alt()`, `hotspot()` (Bereich unter der Maus), `chatOpen()`, `insertIntoChat(text)`, `copyToClipboard(text)`. Ein Klick ist eine Aktion des Spielers (`sendChatMessage` einmal erlaubt). Ein Rechtsklick, den das Addon nicht verbraucht (`false`), öffnet die Einstellungen des Moduls |
| `HudRenderer.onHover(HudHover)` | Maus über dem Element: `tooltip(zeilen…)` (höchstens 12 Zeilen) und `cursor(…)` mit `HAND`, `TEXT`, `CROSSHAIR`, `MOVE`, `NOT_ALLOWED` oder `DEFAULT`; vorbelegt mit Tooltip und Hand des Bereichs unter der Maus |
| `canvas.hotspot(id, x, y, b, h, tooltip)` | klickbarer Bereich: Hand, Tooltip (`\n` trennt Zeilen), beim Klick `click.hotspot()` = id. Jedes Bild beim Zeichnen neu anmelden; später angemeldete liegen oben |
| `canvas.iconButton(id, icon, x, y, größe, farbe, tooltip)` → `boolean` | runder Knopf mit Icon im HUD-Stil, hell bei Hover; zugleich ein Bereich. Rückgabe: Maus darüber |
| `canvas.interactive()`, `canvas.hovered(x, y, b, h)` | Bedient der Spieler gerade das HUD (im HUD-Editor immer `false`)? Maus über einem Bereich? – z. B. Knöpfe nur dann zeigen |
| `canvas.style()` → `HudStyle` | eingestelltes Aussehen für dieses Element: `kind()` (`HELDIX`, `MINIMAL`, `CLASSIC`), `accent()`, `labelColor()`, `textColor()`, `background()` (mit Deckkraft, 0 = aus), `opacity()`, `border()`, `borderColor()`, `shadow()`, `radius()`, `padding()`, `align()` (`LEFT`/`CENTER`/`RIGHT`), `scale()`, `textStyle()` |
| `canvas.panel(x, y, b, h)` | Fläche im HUD-Stil (Deckkraft, Ecken, Rahmen bzw. klassischer Streifen) – wie bei den eingebauten Elementen |
| `canvas.text(text, x, y, farbe, schrift, schatten)` | Text an Kommazahl-Positionen, wahlweise mit Schatten (z. B. `style.shadow()`) |
| `canvas.lineHeight(schrift)`, `canvas.wrap(text, breite, schrift)` | Zeilenhöhe; Umbruch nach Wörtern |
| `canvas.clippedText(text, x, y, breite, farbe, schrift)`, `canvas.pushClip(x, y, b, h)` / `popClip()` | hart abgeschnittener Text; Ausschnitt für alles dazwischen (verschachtelbar, vergessene `popClip` schließt HeldixClient) |
| `canvas.hasIcon(name)` | Gibt es das Icon im Heldix-Icon-Set? |
| `modul.addStyleToggle(key, label, standard)`, `addStyleChoice(…)`, `addStyleColor(…)` | Stil-Optionen: erscheinen im HUD-Editor im Rechtsklick-Menü des Elements unter „Optionen: <Name>“ und im Untermenü des Moduls |

Abgerundete Flächen, Icons, Fortschrittsbalken, Items, Spielerköpfe, gekürzter Text und Textbreiten gibt es schon seit API 2 bzw. 3 (`roundedRect`, `icon`, `progressBar`, `item`, `playerHead`, `ellipsize`, `textWidth`). Die Größe des Elements (HUD-Größe × Größe im Editor, mit „Scharfe Schrift“ auf ganze Bildschirmpixel gerundet) ist beim Zeichnen schon eingerechnet; die Zeichenfläche arbeitet immer in den eigenen, ungeskalierten Koordinaten.

```java
// Element mit Knopf: zeichnet im HUD-Stil, bei offenem Chat mit Knopf und Tooltip
ModuleHandle zaehler = api.registerHudModule(ModuleSpec.of("zaehler", "Zähler", "Klicks zählen").withIcon("star"), new HudRenderer() {
    int klicks;

    @Override
    public void render(HudCanvas c) {
        HudStyle stil = c.style();
        c.panel(0, 0, 90, 18);
        c.text("Klicks " + klicks, stil.padding(), 5, stil.textColor(), stil.textStyle(), stil.shadow());
        if (c.interactive()) c.iconButton("plus", "plus", 74, 3, 12, stil.accent(), "Eins dazu\nUmschalt+Klick: in den Chat");
    }

    @Override
    public boolean onClick(HudClick klick) {
        if (!klick.hotspot().equals("plus")) return false;                 // Rechtsklick → Einstellungen
        if (klick.shift()) return klick.insertIntoChat(klicks + " Klicks"); // nur einfügen, nicht senden
        klicks++;
        return true;
    }

    @Override
    public void onHover(HudHover maus) {
        if (maus.hotspot().isEmpty()) maus.tooltip("Zähler", klicks + " Klicks bisher");
    }
});
BooleanSupplier kompakt = zaehler.addStyleToggle("kompakt", "Kompakt", false);  // im Rechtsklick-Menü des HUD-Editors
```

Das Spotify-Addon ([SpotifyHud](../mod/addons/spotify/src/main/java/dev/heldixclient/addons/spotify/SpotifyHud.java)) zeigt so bei offenem Chat Knöpfe für Zurück, Abspielen/Pause und Weiter, springt per Klick auf die Zeitleiste und zeigt bei Klick auf den Titel den Song im Chat; die Uhrzeit hat einen Tooltip mit Datum und zeigt per Klick Uhr- und Spielzeit.

**API 6** (ab HeldixClient 0.13.4, `"api": 6`): Tasten im Modul, andere Spieler, Spielermenü, Sprachkanal

| Neu | Wofür |
| --- | --- |
| `modul.addKey(key, label, beschreibung, standardtaste, onPress)` → `KeyHandle` | Taste des Moduls: im Untermenü unter „Tasten“ (Klick, neue Taste drücken; Entf = frei, Esc = abbrechen, ↺ = Standard) und unter Optionen → Steuerung → Heldix-Addons. Nur in `onEnable` (wie `registerKey`, sonst `IllegalStateException`); `onPress` läuft im Spiel als Aktion des Spielers, auch bei ausgeschaltetem Modul |
| `modul.showKey(keyHandle, label, beschreibung)` | eine mit `api.registerKey` angelegte Taste zusätzlich im Untermenü zeigen (Spotify: alle Musik-Tasten) |
| `api.nearbyPlayers()` → `List<NearbyPlayer>` | andere Spieler in der geladenen Welt, nächster zuerst: `uuid()`, `name()`, Position, `distance()`, `direction()` (Grad von der Blickrichtung, negativ = links), `heldixPlayer()`; nur im Haupt-Thread |
| `api.addPlayerMenuEntry(PlayerMenuEntry)` → `Registration` | Eintrag im Spielermenü (Mausrad-Klick auf einen Spieler): `label(spieler)` (`null` = kein Eintrag), `icon(spieler)`, `select(spieler)` als Aktion des Spielers, `keepOpen()` |
| `api.playerMarkers()` → `PlayerMarkers` | `show(uuid, icon, farbe, dauer)`/`hide(uuid)`: Symbol aus dem Icon-Set hinter dem Namen im Namensschild (Schrift `heldixclient:marker`, U+E100 + Nummer), höchstens eine Minute |
| `api.voice()` → `VoiceChannel` | Sprachkanal über den Heldix-Dienst (`/v1/voice`, siehe [dienst.md](dienst.md)): `setActive`, `setFriendsOnly`, `status()`/`statusText()`, `range()`, `maxFrameSize()`, `send(rahmen, folge, letzter)`, `onFrame(…)` (Netzwerk-Thread!), `peers()`. Der Kern meldet Server, Welt und Position; kodieren und abspielen macht das Addon |

Jedes Modul – eingebaut oder aus einem Addon – bekommt außerdem von HeldixClient eine Taste „Ein/Aus“ (ab Werk frei, Gruppe „Heldix-Module“ in der Steuerung). Sie entsteht beim Start, solange Minecraft die Optionen noch nicht geladen hat; Module, die ein Addon erst später anlegt, haben keine.

**Warum so:** Neue Methoden gibt es nur an Schnittstellen, die HeldixClient selbst bereitstellt (`HeldixApi`, `HeldixEvents`, `HudCanvas`, `ModuleHandle`); Schnittstellen, die Addons selbst schreiben (`HeldixAddon`, `DroppedItemRenderer`, Listener), bleiben unverändert. Einzige Ausnahme ist `HudRenderer`: Es bekommt in API 5 nur **Default-Methoden** (`onClick`, `onHover`), bleibt ein funktionales Interface, und fertige Addons (auch Lambdas) laufen unverändert. `HudClick`, `HudHover` und `HudStyle` stellt HeldixClient bereit, deshalb sind es Schnittstellen. `GameInfo`, `PlayerState`, `DroppedItem`, `CosmeticInfo` und `CosmeticChange` sind Schnittstellen statt Records, damit spätere Versionen Werte ergänzen können, ohne Addons zu brechen. `DroppedItemPose` baut das Addon selbst, deshalb ist es ein Record (wie `ItemInfo`). Die bisherigen Events (`onTick` …) geben weiter `void` zurück – eine andere Rückgabe würde fertige Addons brechen.

Tastencodes aus `HeldixKeys` sind feste GLFW-Werte. HeldixClient übersetzt sie in die Tasten der jeweiligen Minecraft-Version (seit 26.x nimmt Minecraft SDL-Scancodes). Bis 0.13.0 landeten sie unübersetzt im Spiel: Standardtasten wie Pos1 lagen dadurch auf falschen Tasten, und `HeldixKeys.NONE` brachte das Spiel zum Absturz. Falsch gespeicherte Standardtasten setzt HeldixClient einmal auf die richtigen zurück.

Addons für API 1 bis 5 laufen unverändert weiter. Ein Addon, das eine neuere API braucht, als der installierte HeldixClient kann, wird mit dem Hinweis „bitte HeldixClient aktualisieren“ übersprungen (z. B. ein Addon mit `"api": 6` in HeldixClient 0.13.3). Launcher und Addon-Store im Spiel zeigen es dort mit „Braucht einen neueren HeldixClient“ statt mit „Installieren“.

Details stehen in den Javadoc-Kommentaren der [API-Klassen](../mod/heldix-api/src/main/java/dev/heldixclient/api).

## Weg 2: mit Zugriff auf Minecraft

Reicht die Heldix-API nicht, greift ein Addon direkt in Minecraft ein: mit **Transformern** (ASM, als Ersatz für Mixins) und einem **clientEntrypoint**, der beim Spielstart läuft. Ein kleines, vollständiges Beispiel – ein Zähler im HUD, den `Minecraft.tick()` hochzählt:

```json
{
  "id": "ticks",
  "name": "Tick-Zähler",
  "version": "1.0.0",
  "clientEntrypoint": "de.du.ticks.Start",
  "transformers": ["de.du.ticks.TickTransformer"],
  "minecraft": ["26.3"],
  "loader": ">=2.4.0",
  "loaders": ["heldix", "fabric"]
}
```

```java
// Eingriff: am Anfang von Minecraft.tick() die eigene statische Methode aufrufen
public class TickTransformer implements ClassTransformer {
    public Set<String> targets() { return Set.of("net/minecraft/client/Minecraft"); }
    public void transform(String name, ClassNode node) {
        Patches.head(Patches.method(node, "tick", "()V"), Code.begin().invokeStatic("de/du/ticks/Hooks", "tick", "()V"));
    }
}

// Die Logik steckt in statischen Hooks; Minecraft-Klassen sehen sie, weil das Addon im Classloader des Spiels liegt
public final class Hooks {
    static int ticks;
    public static void tick() { ticks++; }
}

// Läuft beim Spielstart (Loader-API): Tasten, Events, eigene Bildschirme …
public class Start implements HeldixModInitializer {
    public void onInitialize() {
        HudEvents.RENDER.register((g, delta) -> g.text(Minecraft.getInstance().font, "Ticks: " + Hooks.ticks, 4, 4, -1, true));
    }
}
```

Gebaut wird wie in [mod/test-addons/minecraft/build.gradle](../mod/test-addons/minecraft/build.gradle): `compileOnly project(':heldix-loader')` (bringt ASM mit), dazu `compileOnly project(':heldix-api')`, wenn das Addon auch einen `entrypoint` hat; Minecraft kommt über [gradle/minecraft.gradle](../mod/gradle/minecraft.gradle). Das Test-Addon dort ist zugleich das Beispiel für alle drei Teile in einem Addon (Transformer, clientEntrypoint und entrypoint mit Heldix-API).

**So lädt es der Heldix Loader**

1. Beim Start (in Heldix-Instanzen als Java-Agent vor Minecraft, in Fabric in `preLaunch`) erledigt der Loader zuerst, was im Spiel vorgemerkt wurde (`.jar.neu`, `.entfernen`, `.ausschalten`), und liest dann alle `heldix-addons/*.jar` (nicht `.jar.disabled`). Liegt ein Addon mehrfach da, zählt die neueste Version – wie bei HeldixClient.
2. Für jedes Addon mit Zugriff auf Minecraft prüft er das Manifest, `minecraft` gegen die laufende Version, `loader` gegen seine eigene Version, `loaders` gegen die Instanz und – wenn ein `entrypoint` da ist – `api` gegen HeldixClient. Passt etwas nicht, bleibt das Addon ganz aus (kein Transformer, kein clientEntrypoint) und der Grund steht im Heldix-Menü rot an der Karte und in `HeldixLoader.problems()`, z. B. „Nur für Minecraft 26.2“ oder „Braucht Heldix Loader 2.5.0 oder neuer“.
3. Dann legt er die JAR auf den Classpath des Spiels, erzeugt alle Transformer (scheitert einer, bleibt das ganze Addon aus) und meldet sie an.
4. Im Konstruktor von `Minecraft` ruft er die clientEntrypoints der Addons auf, danach die der Heldix-Mods. Wirft ein clientEntrypoint, bleibt das Spiel an; das Addon gilt als fehlerhaft und sein `entrypoint` wird nicht geladen.
5. HeldixClient lädt den `entrypoint` (falls da) über genau den Classloader des Loaders (`HeldixLoader.addons()` → `LoaderAddon.classLoader()`).

Scheitert ein Transformer erst später, wenn seine Ziel-Klasse geladen wird (z. B. nach einem Minecraft-Update), fehlt nur dieser Eingriff: Das Addon läuft weiter, die Karte zeigt „Problem“ mit dem Grund, und er steht in `HeldixLoader.problems()`.

### In Fabric-Instanzen

In Fabric laufen Heldix-Transformer über ein Mixin-Plugin der Fabric-Brücke, und das nur für die Klassen ihrer festen Liste ([Targets.java](../mod/heldix-loader-fabric/src/main/java/dev/heldixclient/loader/fabric/Targets.java)). Ein Addon mit Transformern lädt der Loader in Fabric deshalb nur, wenn **alle** Ziele seiner Transformer in dieser Liste stehen; dafür erzeugt er die Transformer vorab einmal in einem eigenen Classloader zur Prüfung. Sonst bleibt es aus und zeigt **„Läuft nur in Heldix-Instanzen“** mit den fehlenden Klassen. Passen alle Ziele, legt der Loader die JAR auf Fabrics Classpath (Knot), meldet die Transformer an und ruft den clientEntrypoint auf – wie in Heldix-Instanzen. Addons nur mit `clientEntrypoint` und reine API-Addons laufen in Fabric immer.

Ziel-Klassen, die in Fabric unterstützt werden (Loader 2.4.0, Minecraft 26.3):

| Bereich | Klassen |
| --- | --- |
| Spiel und Optionen | `net.minecraft.client.Minecraft`, `net.minecraft.client.Options`, `net.minecraft.client.resources.language.ClientLanguage`, `com.mojang.blaze3d.platform.FramerateLimitTracker` |
| HUD und Zeichnen | `net.minecraft.client.gui.Hud`, `net.minecraft.client.gui.Gui`, `net.minecraft.client.gui.GuiGraphicsExtractor`, `net.minecraft.client.renderer.GameRenderer`, `net.minecraft.client.gui.components.DebugScreenOverlay` |
| Menüs | `net.minecraft.client.gui.screens.Screen`, `net.minecraft.client.gui.screens.TitleScreen`, `net.minecraft.client.gui.screens.LoadingOverlay`, `net.minecraft.client.gui.screens.LevelLoadingScreen`, `net.minecraft.client.gui.screens.ConnectScreen`, `net.minecraft.client.gui.components.AbstractSelectionList` |
| Chat und Tab-Liste | `net.minecraft.client.multiplayer.chat.ChatListener`, `net.minecraft.client.gui.components.ChatComponent`, `net.minecraft.client.gui.screens.ChatScreen`, `net.minecraft.client.gui.components.PlayerTabOverlay` |
| Netzwerk | `net.minecraft.client.multiplayer.ClientPacketListener` |
| Kamera und Eingabe | `net.minecraft.client.Camera`, `net.minecraft.client.MouseHandler`, `net.minecraft.client.player.KeyboardInput` |
| Spieler und Entitäten | `net.minecraft.client.player.AbstractClientPlayer`, `net.minecraft.world.entity.Entity`, `net.minecraft.client.renderer.entity.EntityRenderer`, `net.minecraft.client.renderer.entity.layers.CapeLayer` |
| Gedroppte Items | `net.minecraft.client.renderer.entity.ItemEntityRenderer`, `net.minecraft.client.renderer.entity.state.ItemEntityRenderState` |

Für weitere Klassen muss die Fabric-Brücke erweitert werden (`Targets` und `mixin/TransformTargets`, neuer Loader). Anders als in Heldix-Instanzen verwirft der Fabric-Weg halbe Änderungen nicht: erst alle Ziele suchen und prüfen, dann ändern (wie in [DroppedItemPatches](../mod/src/main/java/dev/heldixclient/transform/DroppedItemPatches.java)). Transformer dürfen dort auch Schnittstellen, Felder und Methoden anhängen.

### Die Loader-API

| Klasse (`dev.heldixclient.loader.…`) | Wofür |
| --- | --- |
| `HeldixLoader` | Version, Plattform (`heldix` oder `fabric`), Spiel-, Config- und Mods-Ordner, geladene Heldix-Mods, `addons()` (Addons mit Zugriff auf Minecraft samt Gründen), `platformMods()` (in Fabric die Fabric-Mods), Probleme beim Start |
| `api.HeldixModInitializer` | `clientEntrypoint` eines Addons bzw. Einstiegspunkt einer Heldix-Mod (`onInitialize()`) |
| `api.KeyMappings` | eigene Tasten (nur in `onInitialize()`); sie erscheinen unter Optionen → Steuerung |
| `api.event.ClientEvents` | `TICK_END`, `STOPPING` |
| `api.event.HudEvents` | `RENDER`: ins HUD zeichnen |
| `api.event.ScreenEvents` | `AFTER_INIT` und `addWidget(...)`: Buttons in fremde Menüs einbauen |
| `api.event.WorldEvents` | `JOIN`, `LEAVE` |
| `api.event.ChatEvents` | `RECEIVE`: empfangene Chatnachrichten |
| `api.transform.ClassTransformer`, `Patches`, `Code` | eigene Eingriffe in Minecraft-Klassen |
| `api.AddonManifest`, `api.LoaderAddon` | die `heldix.addon.json` lesen und prüfen; Zustand eines Addons beim Loader |

**Wichtig bei Transformern**

- Sie werden erzeugt, bevor Minecraft startet. Sie dürfen deshalb keine Minecraft-Klassen benutzen, nur deren Namen als Text. Die eigentliche Logik gehört in statische Hook-Methoden.
- Bausteine in `Patches`: `head`, `cancelAtHead`, `beforeReturns`, `tail`, `modifyReturnValue`, `replaceCalls`, `afterCalls`, `beforeFieldWrite`.
- Die Deskriptoren der Methoden liefert `javap -s` auf die Client-JAR unter `mod/.gradle/minecraft/<version>/client.jar`.
- Seit 26.1 ist Minecraft nicht mehr obfuskiert; Namen und Hinweise zu 26.x stehen in [heldix-loader.md](heldix-loader.md#hinweise-zu-minecraft-26x).
- Mit `-Dheldix.dumpClasses=<Ordner>` speichert der Loader alle veränderten Klassen; danach lassen sie sich mit `javap -c` ansehen.

## Bisherige Heldix-Mods

Heldix-Mods (`heldix.mod.json` im Ordner `mods/`, Format in [heldix-loader.md](heldix-loader.md#eine-heldix-mod-schreiben)) lädt der Heldix Loader wie bisher; HeldixClient selbst ist eine. Im Heldix-Menü stehen sie unter **Mods & Addons → Installiert** mit „Greift in Minecraft ein“ und dem Hinweis „Heldix-Mod aus dem Ordner mods, nur zur Info“ (ohne Schalter; HeldixClient selbst steht nicht in der Liste). Für Neues ist ein Addon mit Zugriff auf Minecraft der empfohlene Weg: gleiche Möglichkeiten, aber ein Fehler beendet nicht das Spiel, das Addon lässt sich an- und ausschalten und es kommt über den Addon-Store. Automatisch umgezogen wird nichts.

## An/aus und Robustheit

- Jedes reine API-Addon bekommt einen eigenen Classloader; Addons mit Zugriff auf Minecraft liegen im Classloader des Spiels (der Heldix Loader hat sie beim Start geladen), ihr `entrypoint` kommt über denselben.
- Addons mit unpassender API-Version, falscher Minecraft- oder Loader-Version, unpassendem `loaders`, fehlerhafter oder fehlender `heldix.addon.json` oder Fehlern beim Laden werden übersprungen. Das Heldix-Menü zeigt sie unter **Mods & Addons → Installiert** rot mit Grund an; Addons mit Zugriff auf Minecraft stehen zusätzlich in `HeldixLoader.problems()`.
- Abgeschaltete Addons (`.jar.disabled`, im Launcher oder im Heldix-Menü ausgeschaltet) lädt weder der Heldix Loader noch HeldixClient; im Menü stehen sie als „Ausgeschaltet“ mit Schalter.
- Wirft ein Addon zur Laufzeit drei Fehler, wird es abgeschaltet. Das gilt für alle Rückrufe: Events, Tasten, Befehle, Knöpfe, Regler-Texte, HUD (Zeichnen, Klicks und Tooltips), Renderer für gedroppte Items und Aufgaben im Scheduler (Fehler aus Hintergrund-Threads werden im Haupt-Thread gezählt). Ist ein Item-Renderer abgeschaltet, zeichnet wieder der vorige bzw. Minecraft. Eingriffe eines Addons mit Zugriff auf Minecraft bleiben bis zum Neustart.
- Beim Abschalten eines Addons und beim Beenden des Spiels werden seine geplanten Aufgaben abgebrochen und laufende Hintergrund-Aufgaben unterbrochen.
- Chat an den Server geht nur als direkte Folge einer Aktion des Spielers (Taste, Befehl, Knopf) und nur einmal pro Aktion. Ein Addon kann so nicht von sich aus spammen.
- Befehle eines abgeschalteten Addons werden trotzdem abgefangen („Das Addon … ist abgeschaltet“), damit „.np“ nicht im öffentlichen Chat landet.
- Das Spiel läuft in allen Fällen weiter – auch wenn der clientEntrypoint eines Addons wirft (anders als bei Heldix-Mods, die dann mit einem Crash-Report enden).
- Getestet wird das im Autotest (`npm run test:launch -- 26.3 heldix --autotest` und `… fabric …`) mit den Test-Addons aus [mod/test-addons](../mod/test-addons): Manifest-Regeln, Transformer und Einstiegspunkte, ein Classloader, falsche Version, abgeschaltete Datei, gescheiterter Transformer, nicht unterstütztes Ziel in Fabric, alte Heldix-Mod in der Liste, die Seite Mods & Addons und an/aus.

## Addon-Store

Addons kommen nicht mehr mit dem Launcher, sondern einzeln aus dem **Addon-Store**. Jedes Addon ist ein eigenes Projekt unter [mod/addons](../mod/addons) mit eigener Version. Der Store ist an drei Stellen:

- **Launcher:** Instanz → **Mods & Addons** → Hinzufügen → Addon-Store (Installieren, Aktualisieren, Details) und die Seite Addon-Store.
- **Im Spiel:** Heldix-Menü → **Mods & Addons** → Reiter **Store**. Installieren, Aktualisieren und Entfernen wirken nach einem Neustart, weil Addons ihre Tasten beim Start anlegen. Unter Windows sind geladene JARs gesperrt; das Spiel merkt sie in `heldix-addons/.entfernen` vor (bzw. legt eine `.jar.neu` ab) und erledigt das beim nächsten Start.
- **Webseite:** `/addons` mit Beschreibung, Versionen, Prüfsumme und Download der JAR.

**Passt es?** Das signierte Store-Manifest trägt zusätzlich `access` (`api` oder `minecraft`), `minecraft` (Versionen, leer = jede) und `loaders` (`["heldix", "fabric"]` bzw. `["heldix"]`). Alte Manifeste ohne diese Felder gelten als `api`, jede Version, beide Loader; Zugriff `minecraft` ohne `loaders` gilt als nur `heldix`. Installierbar ist ein Addon nur, wenn API-Stufe, System, Minecraft-Version und Loader passen – geprüft in dieser Reihenfolge, sonst steht der Grund statt „Installieren“ da: „Braucht einen neueren HeldixClient“, „Nur für Windows“, „Nur für Minecraft 26.3“ (bzw. „26.2 und 26.3“), „Läuft nur in Heldix-Instanzen“. Store-Karten zeigen „Greift in Minecraft ein“ und die Minecraft-Versionen.

| Addon | Was es macht |
| --- | --- |
| **Spotify** ([mod/addons/spotify](../mod/addons/spotify)) | HUD-Element mit Cover, Titel, Künstler und Fortschritt des laufenden Songs in drei Darstellungen (Kompakt, Groß mit Cover, Nur Titel), bei offenem Chat mit Knöpfen für Zurück, Abspielen/Pause und Weiter. Tasten für Abspielen/Pause (**Pos1**), nächsten Song (**Bild ab**) und vorherigen Song (**Bild auf**), dazu frei belegbare Tasten für Spulen, Zufall, Wiederholen und Teilen. Chat-Befehle `.np`, `.np teilen` und `.spotify …`. Einblendung beim Songwechsel. Windows, macOS und Linux (mit playerctl). |
| **Uhrzeit & Spielzeit** ([mod/addons/uhrzeit](../mod/addons/uhrzeit)) | Uhrzeit (Farbe, Beschriftung, Sekunden und Datum einstellbar; Tooltip mit Datum, Klick zeigt Uhr- und Spielzeit im Chat) und Spielzeit mit Pausen-Erinnerung im HUD, eine Begrüßung im Chat und der Befehl `.uhr`. Gleichzeitig die Vorlage für eigene Addons. |
| **Item Physics** ([mod/addons/itemphysics](../mod/addons/itemphysics)) | Gedroppte Items fallen, überschlagen sich und liegen dann flach und still auf dem Boden (Blöcke auf einer Seite), statt zu schweben und sich zu drehen. Von Kxyuzu, braucht API 4 (HeldixClient 0.13.2). |

**Sicherheit:** Addons sind Code, der im Spiel läuft. Deshalb veröffentlicht nur das Team, und jede Version ist mit dem **Update-Schlüssel** signiert (derselbe Ed25519-Schlüssel wie bei Launcher-Updates). Signiert werden die Bytes von `"heldix-addon\n"` + Manifest, damit ein Addon-Manifest nie als Launcher-Update gilt. Der Heldix-Dienst prüft die Signatur beim Veröffentlichen, Launcher und Spiel prüfen Signatur, Größe, SHA-256 und die `heldix.addon.json` der JAR noch einmal vor dem Installieren. Ein übernommenes Team-Konto kann so kein fremdes Addon ausliefern. Der öffentliche Schlüssel liegt im Launcher (`launcher/src/main/update-public-key.ts`) und in der Mod (`mod/src/main/resources/heldix-store-key.pem`); `npm run update-key` schreibt beide, `npm run mod` bricht ab, wenn sie nicht zusammenpassen.

### Ein Addon veröffentlichen

1. Version in `mod/addons/<id>/build.gradle` erhöhen und in `mod/addons/<id>/store.json` die `hinweise` (Was ist neu) eintragen. Dort stehen auch Icon, Kategorie (`hud`, `musik`, `chat`, `werkzeuge`, `sonstiges`), Systeme (`plattformen`, leer = alle) und die lange Beschreibung (Klartext, Absätze durch Leerzeile, Listenpunkte mit „- “).
2. Im Ordner `launcher`: `npm run addon -- <id>`. Das baut das Addon, signiert es und legt `heldix-addon-<id>-<version>.jar` und `heldix-addon-<id>-<version>.addon.json` in `launcher/release/addons/`.
3. Auf heldixclient.com im Team-Bereich (Admin) unter **Addons** beide Dateien wählen und veröffentlichen. Jede neue Version muss höher sein als die vorige. Ein Addon lässt sich dort auch aus dem Store nehmen oder eine Version löschen.

Solche Team-Addons sind im Store **„Offiziell“** (`official: true` im signierten Manifest).

### Addons von Spielern (Community)

1. **Einreichen:** Jeder Spieler mit Microsoft-Konto meldet sich auf heldixclient.com an (über den Launcher) und reicht unter **Konto → Meine Addons** seine JAR ein, mit Store-Angaben und bis zu vier Screenshots. Der Heldix-Dienst liest dabei die `heldix.addon.json` und durchsucht die Klassen grob nach Hinweisen für die Prüfung (Netzwerk, Dateien, Prozesse, Reflection, native Bibliotheken, Minecraft-Klassen). Ausgeführt wird nichts. Addons mit Zugriff auf Minecraft sind erlaubt, wenn die Heldix-API nicht reicht; Minecraft-Klassen gelten dann als erwartet, die übrigen Hinweise bleiben. Kein Schadcode, kein Netzwerk- oder Dateizugriff ohne Angabe in der Beschreibung. Die Addon-ID gehört danach dem Einreicher; offizielle IDs sind gesperrt.
2. **Prüfen:** Im Team-Bereich unter **Addons → Einreichungen** sieht das Team alle Angaben, die Prüf-Hinweise und die Screenshots und kann die JAR herunterladen. Ablehnen geht mit Begründung (auch für Moderatoren); der Einreicher sieht sie sofort.
3. **Freigeben (nur Admins):** Die Seite zeigt das Manifest, das der Dienst für die Einreichung erzeugt hat (`official: false`, `author` = Einreicher). Der Admin wählt einmal seine Schlüsseldatei `update-key.pem`; **die Seite signiert lokal im Browser** (WebCrypto Ed25519) und schickt nur die Signatur. Der Schlüssel bleibt im Arbeitsspeicher der Seite und wird nie hochgeladen. Der Dienst prüft die Signatur und veröffentlicht. Im Store steht das Addon als **„Community · <Spielername>“**.

Bewertungen (1–5 Sterne) und Meldungen zu Addons gehen auf der Webseite und im Launcher mit Microsoft-Konto. Gemeldete Addons sieht das Team unter **Addons → Meldungen** und kann sie aus dem Store nehmen.

## Die offiziellen Addons

### Spotify-Addon

- **Keine Anmeldung nötig.** Das Addon liest den laufenden Song über die Mediensteuerung des Systems. Ein Spotify-Konto, Premium oder ein API-Schlüssel ist nicht nötig. Es werden keine Daten über den Spieler ins Internet geschickt.
- **Systeme** (Version 2.2.0, API 6):

  | System | Quelle | Was geht |
  | --- | --- | --- |
  | Windows | Windows-Mediensteuerung (dieselbe Quelle wie die Medienanzeige bei der Lautstärke), über [heldix-media.ps1](../mod/addons/spotify/src/main/resources/heldix-media.ps1) | Titel, Künstler, Album, Cover, Fortschritt, Abspielen/Pause, Weiter/Zurück, Spulen, Zufall und Wiederholen (wenn der Player sie meldet). Mit „Nur Spotify“ aus auch Browser, VLC usw.; **Player wechseln**, wenn mehrere laufen. |
  | macOS | Spotify-App per JavaScript for Automation (`osascript`), ein kleines Abfrage-Skript läuft dauerhaft mit | wie Windows (Wiederholen nur an/aus); nur Spotify. Beim ersten Mal fragt macOS, ob Minecraft Spotify steuern darf (**Systemeinstellungen → Datenschutz → Automation**). |
  | Linux | MPRIS über das Programm `playerctl` (einmal pro Sekunde abgefragt) | wie Windows; mit „Nur Spotify“ aus jeder MPRIS-Player. Ohne `playerctl` zeigt das HUD „playerctl fehlt – bitte installieren“. |

  Unter anderen Systemen zeigt das HUD-Element „Nur unter Windows, macOS und Linux (mit playerctl)“. Fehlt Spotify oder läuft es nicht, steht dort z. B. „Spotify nicht geöffnet“.
- **Darstellungen:** Kompakt (wie bisher), Groß mit Cover (Player, Zufall/Wiederholen, Album, Zeitleiste) und Nur Titel (eine Zeile mit feiner Fortschrittslinie). Akzentfarbe für Fortschritt und Equalizer: Spotify-Grün, aus dem Cover (`canvas.imageColor`) oder eine eigene Farbe. Lange Titel laufen als Laufschrift durch oder werden mit „…“ gekürzt.
- **Im Spiel bedienen** (ab 2.1.0): Bei offenem Chat oder mit der Taste „HUD bedienen“ zeigt das Element Knöpfe für Zurück, Abspielen/Pause und Weiter; ein Klick auf die Zeitleiste springt an die Stelle (wenn der Player spulen kann), ein Klick auf den Titel zeigt den Song nur dir im Chat, mit Umschalt kommt „🎵 Titel – Künstler“ in die Chat-Eingabe. Fläche, Deckkraft und Rahmen folgen dem HUD-Stil; als Akzentfarbe gibt es zusätzlich „Wie das HUD“.
- **Einstellungen** im Heldix-Menü unter **Module → Spotify → Zahnrad** (Darstellung, Cover, Fortschritt und Akzentfarbe auch im Rechtsklick-Menü des HUD-Editors): Darstellung, HUD-Element, Cover, Fortschritt, Akzentfarbe, Lange Titel, Ausblenden ohne Musik, Ausblenden nach 10 Sekunden Pause, Einblendung beim Songwechsel (auf Wunsch nur, wenn das HUD-Element aus oder per F1 ausgeblendet ist) und „Nur Spotify“.
- **Tasten** ändert man unter **Optionen → Steuerung → Heldix-Addons**. Belegt sind Abspielen/Pause (**Pos1**), nächster Song (**Bild ab**) und vorheriger Song (**Bild auf**); „10 Sekunden vor/zurück“, „Zufallswiedergabe“, „Wiederholen“ und „Song im Chat teilen“ belegt man selbst. Sie wirken nur im Spiel, nicht in Menüs.
- **Chat-Befehle:** `.np` zeigt den laufenden Song nur dir, `.np teilen` schickt „🎵 Titel – Künstler“ an alle. `.spotify play | pause | next | prev | +10 | -10 | shuffle | repeat | player` steuert die Musik.
- **Technik:** Die Verbindung zum Player läuft nur, solange das Modul an ist, und endet mit dem Spiel. Bricht sie ab, baut das Addon sie mit wachsender Pause (2 s bis 30 s) neu auf. Cover landen als PNG unter `config/heldix-addons/spotify/covers/` (je höchstens 30). Unter macOS und Linux melden die Player nur eine Adresse: Das Addon lädt das Bild dann einmal selbst (nur https oder lokale Datei, höchstens 2 MB). Die Lautstärke lässt sich nicht steuern, das kann die Mediensteuerung nicht.
- **Getestet** ist Windows (Autotest im echten Spiel, Skript gegen die laufende Spotify-App). Die Wege für macOS und Linux lassen sich nur auf diesen Systemen prüfen.

### Voice-Chat-Addon

Proximity-Voice-Chat über den Heldix-Dienst ([mod/addons/voicechat](../mod/addons/voicechat), Version 1.0.0, API 6), auf jedem Server ohne Plugin.

- **Ton:** Aufnahme mit `javax.sound` (48 kHz mono, 20-ms-Rahmen), Opus mit [Concentus](https://github.com/jaredmdobson/concentus) (reines Java, BSD-Lizenz, liegt in der JAR mit `META-INF/LICENSE-concentus.txt`), 24 kbit/s mit FEC. Wiedergabe: je Sprecher ein Decoder mit 60 ms Puffer, Lücken überbrückt Opus; Mischen in Stereo nach Abstand (bis 4 Blöcke voll, am Rand der Reichweite still) und Richtung (`NearbyPlayer.direction()`).
- **Sprechen:** Push-to-Talk (`addKey`, ab Werk V) oder Sprachaktivierung mit Schwelle und 300 ms Nachlauf; Tasten „Mikrofon stumm“ und „Ton aus“; „Mikrofon testen“ spielt zehn Sekunden lang die eigenen Rahmen ab, ohne zu senden.
- **Anzeige:** HUD-Element mit Mikrofon-Zustand, Pegel und Sprechern; Symbol `volume` über dem Kopf von Sprechern (`playerMarkers`); Spielermenü mit Stummschalten, Lauter und Leiser je Spieler (gespeichert in der Addon-Konfiguration).
- **Start:** Das Modul ist ab Werk aus. Mikrofon und Lautsprecher sind nur offen, solange es an und der Kanal verbunden ist (oder der Test läuft). Beim ersten Einschalten erklärt eine Einblendung, wohin die Stimme geht.
- **Autotest:** `-Dheldixclient.voicechat.testAudio=true` ersetzt Mikrofon und Lautsprecher durch einen Testton bzw. nichts, `-Dheldixclient.voice.testServer=…` gibt dem Einzelspieler einen Raum. Beides setzt `test:launch` mit `--autotest`.

### Item-Physics-Addon

Ursprünglich eine eigene Heldix-Mod von Kxyuzu (Transformer für Minecraft 26.3). Als Addon nutzt es nur noch die Heldix-API 4 (`api.droppedItems()`); die Eingriffe in Minecraft macht HeldixClient selbst. Dadurch kommt es signiert über den Addon-Store und läuft in Heldix- **und** Fabric-Instanzen. Die ursprüngliche Technik (eigener Transformer und clientEntrypoint) zeigt jetzt das Test-Addon [mod/test-addons/minecraft](../mod/test-addons/minecraft) – so ginge es heute als Addon mit Zugriff auf Minecraft (siehe Weg 2).

- **Verhalten** (Version 1.0.0, API 4): In der Luft überschlagen sich Items, je schneller, desto mehr (8° pro Tick plus 60° je Block/Tick Tempo). Am Boden und im Wasser legen sie sich in 0,25 s hin: flache Items (Modell höchstens 1/16 Block dick) flach, Blöcke auf die nächste Seite. Die Ausrichtung um die Hochachse ist je Item fest und zufällig (aus Minecrafts `bobOffset`). Die tiefste Ecke des gedrehten Modells liegt 0,005 Blöcke über dem Boden, auch bei Stapeln. Liegt ein Item schon, wenn es zum ersten Mal gezeichnet wird, liegt es sofort flach.
- **Einstellungen** unter **Module → Item Physics → Zahnrad**: „Drehung in der Luft“ (0 bis 200 %, 0 = aus), „Hinlegen“ (Dauer, „Sofort“ bis 1 s) und „Blöcke kippen“ (aus: Blöcke bleiben aufrecht). Das Modul selbst schaltet das Addon an und aus; aus heißt: Items schweben wie in Minecraft.
- **Taste** „Item Physics – Ein/Aus“ unter **Optionen → Steuerung → Heldix-Addons**, ab Werk nicht belegt.
- **Rein optisch:** Hitbox, Aufsammeln und Spielablauf bleiben gleich, auf Servern ist nichts nötig.
