---
titel: Addon-API im Detail
beschreibung: Module, HUD-Elemente, Einstellungen, Tasten, Einblendungen und Ereignisse – mit echten Beispielen aus den Addons Spotify und Uhrzeit & Spielzeit.
reihenfolge: 2
stichworte: api, heldixapi, modul, hud, hudcanvas, einstellungen, tasten, keybind, notify, einblendung, events, config
---
Alle Klassen der Heldix-API liegen im Paket `dev.heldixclient.api`. Diese Seite beschreibt API-Stufe **2** (Stand HeldixClient 0.13.0). Funktionen mit dem Vermerk „ab API 2“ brauchen in der `heldix.addon.json` den Eintrag `"api": 2`. Wie ein Addon grundsätzlich aufgebaut ist, steht unter [Heldix-Addons schreiben](/entwickler/addons).

## Das Objekt HeldixApi

In `onEnable(HeldixApi api)` bekommst du ein Objekt, über das alles läuft:

- `addon()` – Angaben aus deiner `heldix.addon.json` als `AddonInfo` mit `id()`, `name()`, `version()`, `description()` und `authors()`.
- `clientVersion()`, `loaderVersion()`, `minecraftVersion()` – Versionen als Text, z. B. `"26.3"`.
- `logger()` – ein `HeldixLogger` mit `info(text)`, `warn(text)` und `error(text, fehler)`. Er schreibt ins Spiel-Log und damit auch in die Konsole des Launchers.
- `events()` – Ereignisse wie Tick und Welt betreten.
- `registerModule(spec)` und `registerHudModule(spec, renderer)` – Module für das Heldix-Menü.
- `player()` – der eigene Spieler als `Optional<PlayerInfo>`.
- `chat(text)` – eine Nachricht nur im eigenen Chat.
- `config()` – einfache, dauerhaft gespeicherte Einstellungen.
- ab API 2: `registerKey(...)`, `notify(...)` und `dataDirectory()`.

## Ereignisse

`api.events()` liefert ein `HeldixEvents` mit vier Ereignissen. Alle Listener laufen im Haupt-Thread des Spiels.

- `onTick(Runnable)` – 20-mal pro Sekunde, bei jedem Client-Tick.
- `onWorldJoin(Runnable)` – beim Betreten einer Welt oder eines Servers.
- `onWorldLeave(Runnable)` – beim Verlassen einer Welt oder eines Servers.
- `onChatMessage(Consumer<String>)` – bei jeder empfangenen Chat- oder Systemnachricht, als reiner Text.

So zählt das Uhrzeit-Addon mit, wie oft du eine Welt betreten hast, und begrüßt dich im Chat:

```java
api.events().onWorldJoin(() -> {
    worldJoinedAt = System.currentTimeMillis();
    worldsJoined = api.config().getInt("worlds-joined", 0) + 1;
    api.config().set("worlds-joined", String.valueOf(worldsJoined));
    api.config().save();
    if (greeting.isEnabled()) {
        String name = api.player().map(p -> p.name()).orElse("Spieler");
        api.chat("Willkommen, " + name + "! Das ist deine " + worldsJoined + ". Welt mit HeldixClient.");
    }
});
api.events().onWorldLeave(() -> worldJoinedAt = 0);
```

Auf Chatnachrichten reagierst du so:

```java
api.events().onChatMessage(text -> {
    if (text.contains("Runde gewonnen")) api.notify("GG", text);
});
```

> **Hinweis:** Actionbar-Texte und lokale Meldungen – auch die von `api.chat` – lösen `onChatMessage` nicht aus.

## Module

Jedes Modul erscheint im Heldix-Menü unter **Module** als eigene Karte (im Reiter „Addons“) und lässt sich dort an- und ausschalten. Beschrieben wird es mit einem `ModuleSpec`:

- `ModuleSpec.of(id, name, beschreibung)` – eingeschaltet beim ersten Start, HUD-Position (4, 120), ohne Icon.
- `.at(x, y)` – Startposition des HUD-Elements in GUI-Pixeln.
- `.disabledByDefault()` – beim ersten Start ausgeschaltet.
- `.withIcon("music")` – Icon für Karte, Addon-Liste und HUD-Editor (ab API 2).

Die Modul-ID darf nur `a-z`, `0-9`, `_` und `-` enthalten und muss innerhalb deines Addons eindeutig sein. Für die Beschreibung ist auf der Karte Platz für ungefähr 25 Zeichen.

Ein Modul ohne HUD-Element legst du mit `registerModule` an. Das ist praktisch für Funktionen, die man nur an- und ausschalten will:

```java
ModuleHandle greeting = api.registerModule(
        ModuleSpec.of("begruessung", "Begrüßung", "Gruß beim Welt-Start").withIcon("chat"));
```

Beide Methoden liefern ein `ModuleHandle` zurück:

- `isEnabled()` – ist das Modul gerade an?
- `setEnabled(boolean)` – Modul selbst an- oder ausschalten.
- `onToggle(enabled -> …)` – wird aufgerufen, wenn der Spieler das Modul im Heldix-Menü umschaltet.

Das Spotify-Addon startet und stoppt damit seinen Hintergrund-Prozess:

```java
module.onToggle(enabled -> {
    if (enabled) startBridge(); else bridge.stop();
});
api.events().onTick(this::tick);
if (module.isEnabled()) startBridge();
```

## HUD-Elemente

Mit `registerHudModule(spec, renderer)` bekommt dein Modul ein HUD-Element. Der Renderer wird jedes Bild aufgerufen, solange das Modul an ist. Koordinaten zählen ab der linken oberen Ecke des Elements, und die Größe ergibt sich automatisch aus dem, was du zeichnest. Verschieben und skalieren kann der Spieler das Element im HUD-Editor.

Die Uhr aus dem Uhrzeit-Addon mit der Einstellung „Sekunden“:

```java
private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");
private static final DateTimeFormatter TIME_SHORT = DateTimeFormatter.ofPattern("HH:mm");

// Feld mit Startwert: der Renderer kann laufen, bevor addToggle den echten Wert liefert
private BooleanSupplier showSeconds = () -> true;

@Override
public void onEnable(HeldixApi api) {
    ModuleHandle clock = api.registerHudModule(
            ModuleSpec.of("uhrzeit", "Uhrzeit", "Echte Uhrzeit im HUD").at(4, 190).withIcon("clock"),
            canvas -> canvas.labelValue("Uhr", LocalTime.now().format(showSeconds.getAsBoolean() ? TIME : TIME_SHORT)));
    showSeconds = clock.addToggle("seconds", "Sekunden", "Uhrzeit mit Sekunden anzeigen", true);
}
```

### Die Zeichenfläche HudCanvas

Der Renderer bekommt ein `HudCanvas`. Farben sind ARGB-Werte, z. B. `0xFFFFFFFF` für deckendes Weiß.

Seit API 1:

- `labelValue(label, wert)` – fertige Box im Heldix-Stil: farbiger Streifen, Label in Akzentfarbe, Wert in Weiß.
- `labelValues(String[][] zeilen)` – mehrzeilige Box, jede Zeile als `{label, wert}`.
- `text(text, x, y, farbe)` – Text in der Minecraft-Schrift mit Schatten.
- `rect(x, y, breite, höhe, farbe)` – gefülltes Rechteck.
- `textWidth(text)` und `lineHeight()` – Maße der Minecraft-Schrift.
- `screenWidth()` und `screenHeight()` – Größe des Bildschirms in GUI-Pixeln.

Ab API 2:

- `text(text, x, y, farbe, stil)` – Text in der Heldix-Schrift Inter. Stile in `HudCanvas.TextStyle`: `MINECRAFT`, `SMALL` (8 Pixel hoch), `BODY` (9), `BOLD` (9, halbfett) und `TITLE` (12). Die Zeilenhöhe steht in `stil.height`.
- `textWidth(text, stil)` und `ellipsize(text, maxBreite, stil)` – Breite messen bzw. mit „…“ kürzen.
- `roundedRect(x, y, breite, höhe, radius, farbe)` und `roundedOutline(…)` – kantengeglättete, abgerundete Flächen und Rahmen. Die Werte sind `float`, halbe Pixel gehen also auch.
- `image(pfad, x, y, breite, höhe)` – zeichnet eine PNG-Datei. Sie wird zwischengespeichert und neu geladen, wenn sich die Datei ändert. Gibt `false` zurück, wenn die Datei fehlt oder kein gültiges PNG ist.
- `icon(name, x, y, größe, farbe)` – ein Icon aus dem Heldix-Icon-Set. Unbekannte Namen zeichnen nichts.
- `isPreview()` – `true` im HUD-Editor. Zeig dann Beispieldaten, damit man das Element auch ohne echte Daten anordnen kann.

Ein HUD-Element mit Koordinaten und Biom, das auch im HUD-Editor ohne Welt sichtbar bleibt:

```java
api.registerHudModule(ModuleSpec.of("position", "Position", "Koordinaten und Biom").withIcon("compass"), canvas -> {
    Optional<PlayerInfo> player = api.player();
    if (player.isEmpty()) {
        if (canvas.isPreview()) canvas.labelValue("XYZ", "120 / 64 / -38");
        return;
    }
    PlayerInfo p = player.get();
    canvas.labelValues(new String[][] {
            {"XYZ", Math.round(p.x()) + " / " + Math.round(p.y()) + " / " + Math.round(p.z())},
            {"Biom", p.biome()}
    });
});
```

Eigene Karten zeichnest du mit den Bausteinen ab API 2. So sieht das Spotify-Addon aus, wenn gerade keine Musik läuft:

```java
private static final int WIDTH = 172;
private static final int CARD = 0xDC0E131E;
private static final int GREEN = 0xFF1DB954;
private static final int GREEN_SOFT = 0x2E1DB954;

private void drawIdle(HudCanvas c, String message) {
    int h = 30;
    c.roundedRect(0, 0, WIDTH, h, 8, CARD);
    c.roundedOutline(0, 0, WIDTH, h, 8, HeldixColors.LINE);
    c.roundedRect(6, 6, 18, 18, 5, GREEN_SOFT);
    c.icon("music", 9, 9, 12, GREEN);
    c.text("Spotify", 30, 6, HeldixColors.TEXT, TextStyle.BOLD);
    c.text(c.ellipsize(message, WIDTH - 30 - 8, TextStyle.SMALL), 30, 17, HeldixColors.MUTED, TextStyle.SMALL);
}
```

Dafür importierst du `dev.heldixclient.api.HeldixColors` und `dev.heldixclient.api.HudCanvas.TextStyle`. Ein Bild mit Platzhalter, falls die Datei fehlt:

```java
Path cover = api.dataDirectory().resolve("cover.png");   // einmal in onEnable

// im Renderer:
if (!canvas.image(cover, 6, 6, 32, 32)) {
    canvas.roundedRect(6, 6, 32, 32, 5, 0x2E1DB954);
    canvas.icon("music", 14, 14, 16, 0xFF1DB954);
}
```

### Farben und Icons

`HeldixColors` enthält die Farben des Heldix-Designs: `ACCENT`, `ACCENT_LIGHT`, `CYAN`, `TEXT`, `MUTED`, `SUCCESS`, `WARNING`, `DANGER` und `BACKGROUND` (halbtransparenter Hintergrund der HUD-Boxen), ab API 2 außerdem `FAINT`, `PANEL` und `LINE`.

Icons für `withIcon` und `canvas.icon` sind unter anderem `music`, `play`, `pause`, `skip-next`, `skip-previous`, `clock`, `hourglass`, `chat`, `star`, `compass`, `signal`, `keyboard`, `mouse`, `eye`, `pin`, `flag`, `lightbulb`, `palette`, `image`, `potion`, `sprint`, `crosshair`, `fps`, `zoom` und `sparkles`. Ein Modul ohne gültiges Icon bekommt das Puzzleteil.

## Einstellungen eines Moduls (ab API 2)

Jedes Modul kann eigene Einstellungen haben. Sie erscheinen im Heldix-Menü unter **Module**, wenn man auf das Zahnrad an der Karte klickt, und werden automatisch gespeichert.

- `addToggle(schlüssel, label, beschreibung, standard)` – An/Aus-Schalter, liefert einen `BooleanSupplier`.
- `addChoice(schlüssel, label, beschreibung, möglichkeiten, standardIndex)` – Auswahl aus einer festen Liste; jeder Klick schaltet weiter. Liefert einen `IntSupplier` mit dem Index der gewählten Möglichkeit.
- `addAction(label, beschreibung, knopfText, aktion)` – ein Knopf, dessen Aktion im Haupt-Thread läuft.

Schlüssel dürfen `a-z`, `0-9`, `_`, `.` und `-` enthalten und müssen innerhalb des Moduls eindeutig sein. Aus dem Spotify-Addon:

```java
showCover = module.addToggle("cover", "Cover anzeigen", "Album-Cover links im HUD-Element", true);
hideIdle = module.addToggle("hide-idle", "Ohne Musik ausblenden", "HUD-Element nur zeigen, wenn ein Song geladen ist", false);
module.addAction("Nächster Song", "Standardtaste: Bild ab", "Weiter", () -> command(bridge::next));
```

Eine Auswahl, z. B. für das Uhrzeit-Format:

```java
IntSupplier format = clock.addChoice("format", "Format", "Wie die Uhrzeit angezeigt wird",
        List.of("24 Stunden", "12 Stunden"), 0);

// im Renderer:
String pattern = format.getAsInt() == 0 ? "HH:mm" : "hh:mm a";
```

> **Tipp:** Frag den Supplier bei jeder Verwendung neu ab, also im Renderer oder im Tick – nicht einmal in `onEnable`. Er liefert immer den aktuellen Wert.

## Eigene Daten speichern

- `api.config()` – ein `AddonConfig` mit `get(schlüssel, standard)`, `getInt(…)`, `getBoolean(…)`, `set(schlüssel, text)` und `save()`. Die Werte landen in der Instanz unter `config/heldix-addons/<id>.properties`. Erst `save()` schreibt sie auf die Festplatte.
- `api.dataDirectory()` – ein eigener Ordner `config/heldix-addons/<id>/` für Dateien und Zwischenspeicher, z. B. Bilder. Er wird beim ersten Aufruf angelegt (ab API 2).

## Tasten (ab API 2)

```java
KeyHandle registerKey(String id, String name, int defaultKey, Runnable onPress)
```

Die Taste erscheint unter Optionen → Steuerung in der Gruppe „Heldix-Addons“ als „Addon-Name – Name“ und lässt sich dort umbelegen. `onPress` läuft bei jedem Druck im Haupt-Thread, aber nur im Spiel, nicht in Menüs. Die ID darf `a-z`, `0-9`, `_` und `-` enthalten.

Die Tasten des Spotify-Addons ([[Pos1]], [[Bild ab]] und [[Bild auf]]):

```java
api.registerKey("play-pause", "Abspielen/Pause", HeldixKeys.HOME, this::playPause);
api.registerKey("next", "Nächster Song", HeldixKeys.PAGE_DOWN, () -> command(bridge::next));
api.registerKey("previous", "Vorheriger Song", HeldixKeys.PAGE_UP, () -> command(bridge::previous));
```

Tastencodes stehen in `HeldixKeys`, z. B. `F1` bis `F12`, `HOME`, `END`, `PAGE_UP`, `PAGE_DOWN`, `INSERT`, `DELETE`, die Pfeiltasten, `NUMPAD_0` bis `NUMPAD_0 + 9` und die Umschalt-, Strg- und Alt-Tasten. Buchstaben und Ziffern gibst du als Zeichen an, z. B. `'K'` oder `'7'`. Mit `HeldixKeys.NONE` ist die Taste zunächst nicht belegt, und der Spieler wählt sie selbst.

Das zurückgegebene `KeyHandle` hat `isDown()` (wird die Taste gerade gehalten?) und `keyName()` (Name der aktuell belegten Taste, z. B. „Pos1“, leer, wenn nicht belegt).

## Einblendungen (ab API 2)

`api.notify(titel, text)` zeigt oben rechts im Spiel eine kurze Einblendung. Mit `api.notify(titel, text, bild)` erscheint links zusätzlich ein quadratisches PNG, z. B. ein Album-Cover; `null` heißt ohne Bild. Eine neue Einblendung deines Addons ersetzt die vorige, solange diese noch sichtbar ist.

```java
api.notify(track.title(), byline(track), track.cover());
```

`notify` darf aus jedem Thread aufgerufen werden – praktisch, wenn Daten aus einem eigenen Hintergrund-Thread kommen.

## Spielerdaten und Chat

`api.player()` liefert ein `Optional<PlayerInfo>`. Es ist leer, solange keine Welt geladen ist. `PlayerInfo` ist eine Momentaufnahme mit `name()`, `x()`, `y()`, `z()`, `health()`, `food()`, `dimension()` (z. B. `"overworld"`, `"the_nether"`, `"the_end"`) und `biome()` (z. B. `"plains"`). Hol sie dir bei jedem Gebrauch neu.

`api.chat(text)` zeigt eine Nachricht nur in deinem eigenen Chat, mit dem Namen deines Addons davor. Sie wird nicht an den Server gesendet.

## Threads und Fehler

- Ereignisse, Tasten, Aktionen, `onToggle` und Renderer laufen im Haupt-Thread. Warte dort nie auf Netzwerk oder langsame Dateien, sonst ruckelt das Spiel.
- Aus eigenen Threads ist nur `notify` ausdrücklich erlaubt. Alles andere legst du in Felder und verarbeitest es im nächsten Tick oder im Renderer.
- Fehler in deinem Code fängt HeldixClient ab und schreibt sie ins Log. Nach drei Fehlern wird das Addon für diese Sitzung abgeschaltet, das Spiel läuft weiter. Ein Fehler im Renderer passiert meist jedes Bild – dann ist das Addon sehr schnell aus.
- Wirft `onEnable` einen Fehler, wird das Addon gar nicht erst geladen. Das Heldix-Menü zeigt es dann rot mit dem Grund an, siehe [Addons installieren und Fehler finden](/entwickler/addon-installieren).
