---
titel: Addon-API im Detail
beschreibung: Module, HUD-Elemente, Einstellungen, Tasten, Einblendungen und Ereignisse – mit echten Beispielen aus den Addons Spotify und Uhrzeit & Spielzeit.
reihenfolge: 2
stichworte: api, heldixapi, modul, hud, hudcanvas, einstellungen, tasten, keybind, notify, einblendung, events, config, api 3, scheduler, befehl, chat-befehl, regler, farbe, gameinfo, playerstate
---
Alle Klassen der Heldix-API liegen im Paket `dev.heldixclient.api`. Diese Seite beschreibt API-Stufe **3** (Stand HeldixClient 0.13.1). Funktionen mit dem Vermerk „ab API 2“ brauchen in der `heldix.addon.json` den Eintrag `"api": 2`, alles unter [Ab API 3](#ab-api-3) den Eintrag `"api": 3`. Wie ein Addon grundsätzlich aufgebaut ist, steht unter [Heldix-Addons schreiben](/entwickler/addons).

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
- ab API 3: `game()`, `playerState()`, `scheduler()`, `registerCommand(...)` und `sendChatMessage(...)` – siehe [Ab API 3](#ab-api-3).

## Ereignisse

`api.events()` liefert ein `HeldixEvents` mit vier Ereignissen (ab API 3 kommen weitere dazu, siehe unten). Alle Listener laufen im Haupt-Thread des Spiels.

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

## Ab API 3

Mit `"api": 3` (ab HeldixClient 0.13.1) kommen diese Bausteine dazu. Neue Methoden gibt es nur an Schnittstellen, die HeldixClient bereitstellt – fertige Addons für API 1 und 2 laufen unverändert weiter.

### Mehr Ereignisse, mit Abmeldung

- `onServerJoin(adresse -> …)` und `onServerLeave(…)` – Server betreten oder verlassen (nicht im Einzelspieler), mit Adresse.
- `onScreenOpen(art -> …)` und `onScreenClose(…)` – ein Menü geht auf oder zu. `art` ist `chat`, `inventory`, `container`, `pause`, `death`, `options`, `title`, `worlds`, `servers`, `loading`, `heldix` oder `other`.
- `onDeath(…)`, `onRespawn(…)`, `onDimensionChange(dimension -> …)` und `onHealthChange((vorher, jetzt) -> …)`.

Alle neuen Ereignisse, Befehle und geplanten Aufgaben geben eine `Registration` zurück: `cancel()` meldet ab, `isActive()` sagt, ob sie noch läuft. Die bisherigen Ereignisse wie `onTick` bleiben, wie sie sind.

```java
Registration tod = api.events().onDeath(() -> api.notify("Autsch", "Zurück zum Spawn?"));
api.events().onDimensionChange(dimension -> api.chat("Jetzt in " + dimension));
api.events().onScreenOpen(art -> { if (art.equals("pause")) api.logger().info("Pause"); });
```

### Spiel- und Spielerdaten

- `api.game()` liefert ein `GameInfo`: FPS, Ping, Einzel- oder Mehrspieler, Server-Adresse, Tageszeit, Wetter, pausiert, HUD ausgeblendet ([[F1]]) und das offene Menü. Es gibt die Angaben immer, auch im Hauptmenü – dann sind sie leer bzw. -1.
- `api.playerState()` liefert ein `Optional<PlayerState>`: alles aus `player()` plus Blickrichtung, Tempo, maximale Leben, Absorption, Sättigung, Rüstungspunkte, Level, Spielmodus, Sprinten, Schleichen und Fliegen, die Items in der Hand und die Rüstung (`ItemInfo`) und aktive Effekte (`EffectInfo`).

```java
GameInfo spiel = api.game();
String wo = spiel.multiplayer() ? spiel.serverAddress() : "Einzelspieler";
api.playerState().ifPresent(p -> api.chat(p.mainHand().name() + ", noch " + p.mainHand().durability() + " Haltbarkeit"));
```

### Aufgaben planen

`api.scheduler()` liefert einen `Scheduler`:

- `runLater(ticks, …)` und `runRepeating(verzögerung, abstand, …)` laufen im Haupt-Thread; ein Tick ist eine Zwanzigstelsekunde.
- `runAsync(…)` läuft im Hintergrund (zwei Threads je Addon) – für Downloads und langsame Dateien.
- `runOnMainThread(…)` bringt ein Ergebnis zurück in den Haupt-Thread, `isMainThread()` sagt, wo du gerade bist.

Schaltet sich das Addon ab oder endet das Spiel, bricht HeldixClient alle geplanten Aufgaben ab.

```java
api.scheduler().runAsync(() -> {
    String text = ladeEtwas(); // darf blockieren
    api.scheduler().runOnMainThread(() -> api.chat(text));
});
api.scheduler().runRepeating(20, 20 * 60, () -> api.notify("Minute um", "Trink etwas"));
```

### Chat-Befehle und Chat an den Server

`api.registerCommand(name, verwendung, beschreibung, befehl -> …)` legt einen Befehl „.name …“ an. Er geht nicht an den Server. `.hilfe` listet alle Befehle, [[Tab]] ergänzt, und über dem Eingabefeld stehen passende Befehle. `befehl.arg(0)` liefert das erste Argument, `befehl.reply(text)` antwortet nur dir.

`api.sendChatMessage(text)` schickt eine Nachricht an den Server – aber nur direkt in einer Taste, einem Befehl oder einem Knopf und höchstens einmal pro Aktion, sonst gibt es eine `IllegalStateException`. `/`-Befehle gehen damit nicht. So kann kein Addon von sich aus spammen.

```java
api.registerCommand("winken", "[alle]", "Winkt (alle: im öffentlichen Chat)", befehl -> {
    if (befehl.arg(0).equals("alle")) api.sendChatMessage("*winkt*");
    else befehl.reply("*winkt*");
});
```

### Regler, Farben und Textfelder

Zu Schalter, Auswahl und Knopf kommen im Untermenü eines Moduls:

- `addSlider(schlüssel, label, beschreibung, min, max, schritt, standard)` – ein Regler, liefert einen `DoubleSupplier`; auf Wunsch mit eigenem Text für den Wert.
- `addColor(schlüssel, label, beschreibung, standardFarbe)` – Farbwahl aus der Heldix-Palette, liefert einen `IntSupplier`.
- `addText(schlüssel, label, beschreibung, standard, maxLänge)` – ein Textfeld, liefert einen `Supplier<String>`.

```java
DoubleSupplier abstand = modul.addSlider("abstand", "Abstand", "", 0, 10, 0.5, 2);
IntSupplier farbe = modul.addColor("farbe", "Farbe", "", HeldixColors.ACCENT);
Supplier<String> titel = modul.addText("titel", "Titel", "", "Mein HUD", 32);
```

### Neue Zeichenhilfen im HUD

- `progressBar(...)`, `gradientRect(...)`, `line(...)` und `circle(...)` – Fortschrittsbalken, Farbverläufe, Linien in jede Richtung und Kreise.
- `item("minecraft:diamond_sword", x, y, größe)` und `playerHead(name oder uuid, …)` – Item-Symbole und Spielerköpfe.
- `scrollingText(...)` – Laufschrift für Texte, die nicht passen.
- `imageColor(png)` – die typische Farbe eines Bildes, etwa als Akzentfarbe aus einem Album-Cover.

```java
canvas.progressBar(0, 20, 100, 3, 0.4f, 0x2EFFFFFF, farbe.getAsInt());
canvas.item("minecraft:clock", 0, 0, 16);
canvas.scrollingText("Ein sehr langer Titel, der nicht passt", 20, 4, 80, HeldixColors.TEXT, TextStyle.BOLD);
```

Alle Einzelheiten stehen in den Javadoc-Kommentaren der API-Klassen; Funktionen der Stufe 3 sind mit `@since 3` gekennzeichnet.

## Threads und Fehler

- Ereignisse, Tasten, Aktionen, `onToggle` und Renderer laufen im Haupt-Thread. Warte dort nie auf Netzwerk oder langsame Dateien, sonst ruckelt das Spiel.
- Aus eigenen Threads ist nur `notify` ausdrücklich erlaubt. Alles andere legst du in Felder und verarbeitest es im nächsten Tick oder im Renderer – ab API 3 einfacher mit `api.scheduler().runAsync(…)` und `runOnMainThread(…)`.
- Fehler in deinem Code fängt HeldixClient ab und schreibt sie ins Log. Nach drei Fehlern – auch in Befehlen, Knöpfen und Aufgaben des Schedulers – wird das Addon für diese Sitzung abgeschaltet, das Spiel läuft weiter. Ein Fehler im Renderer passiert meist jedes Bild – dann ist das Addon sehr schnell aus.
- Wirft `onEnable` einen Fehler, wird das Addon gar nicht erst geladen. Das Heldix-Menü zeigt es dann rot mit dem Grund an, siehe [Addons installieren und Fehler finden](/entwickler/addon-installieren).
