---
titel: Addon-API im Detail
beschreibung: Module, HUD-Elemente, Einstellungen, Tasten, Einblendungen, Ereignisse und gedroppte Items – mit echten Beispielen aus den Addons Spotify, Uhrzeit & Spielzeit und Item Physics.
reihenfolge: 2
stichworte: api, heldixapi, addkey, showkey, voice, voicechat, sprachkanal, nearbyplayers, spielermenü, playermenuentry, playermarkers, tasten, keybind, tastenbelegung, hudclick, hudhover, hudstyle, hotspot, iconbutton, anklickbar, hud bedienen, stil-optionen, cosmetics, cosmeticinfo, preview, animate, modul, hud, hudcanvas, einstellungen, tasten, keybind, notify, einblendung, events, config, api 3, scheduler, befehl, chat-befehl, regler, farbe, gameinfo, playerstate, api 4, api 5, api 6, api 7, showabove, gruppe, voice-gruppe, setstate, playername, api 8, worldmap, minimap, karte, hudimage, createimage, pixel, waypointinfo, wegpunkte, api 9, gast, gäste, browser, browser-link, createbrowserlink, isguest, inbrowser, removeguest, guestsavailable, copytoclipboard, zwischenablage, api 10, moderation, melden, openreport, reportattachments, showrules, voice-regeln, zustimmung, sperre, stummschalten für alle, gastgeber, party-leiter, roomrights, issilenced, clipsactive, aufnahme, lautstärke-verlauf, droppeditems, droppeditemrenderer, droppeditem, droppeditempose, item physics, gedroppte items
---
Alle Klassen der Heldix-API liegen im Paket `dev.heldixclient.api`. Diese Seite beschreibt API-Stufe **10** (Stand HeldixClient 0.14.0). Funktionen mit dem Vermerk „ab API 2“ brauchen in der `heldix.addon.json` den Eintrag `"api": 2`, alles unter [Ab API 3](#ab-api-3) den Eintrag `"api": 3`, alles unter [Ab API 4](#ab-api-4) den Eintrag `"api": 4`, alles unter [Ab API 5](#ab-api-5) den Eintrag `"api": 5`, alles unter [Ab API 6](#ab-api-6) den Eintrag `"api": 6`, alles unter [Ab API 7](#ab-api-7) den Eintrag `"api": 7`, alles unter [Ab API 8](#ab-api-8) den Eintrag `"api": 8`, alles unter [Ab API 9](#ab-api-9) den Eintrag `"api": 9` und alles unter [Ab API 10](#ab-api-10) den Eintrag `"api": 10`. Wie ein Addon grundsätzlich aufgebaut ist, steht unter [Addons entwickeln](/entwickler/addons).

> **Hinweis:** Die Heldix-API reicht für die meisten Addons und läuft über Minecraft-Updates hinweg. Was sie nicht kann, darf ein Addon auch direkt in Minecraft ändern – mit Transformern des Heldix Loaders, siehe [Weg 2: Eingriff in Minecraft](/entwickler/addons#weg-2-eingriff-in-minecraft). Mit der API-Stufe hat das nichts zu tun.

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
- ab API 4: `droppedItems()` – Lage und Drehung der gedroppten Items in der Welt – und `cosmetics()` – der Cosmetics-Katalog, siehe [Ab API 4](#ab-api-4).
- ab API 5: anklickbare HUD-Elemente im HUD-Stil (an `HudRenderer`, `HudCanvas` und `ModuleHandle`), siehe [Ab API 5](#ab-api-5).
- ab API 6: Tasten im Untermenü eines Moduls (`addKey`, `showKey`), `nearbyPlayers()`, `playerMarkers()`, `addPlayerMenuEntry(...)` und `voice()` – siehe [Ab API 6](#ab-api-6).
- ab API 7: `playerName(uuid)`, Symbole über dem Kopf (`playerMarkers().showAbove(...)`), Status und Gruppen im Sprachkanal – siehe [Ab API 7](#ab-api-7).
- ab API 8: `worldMap()` – die Welt von oben für Karten –, `createImage(...)` für selbst gefüllte Bilder im HUD und `waypoints()` – siehe [Ab API 8](#ab-api-8).
- ab API 9: Gäste und Browser-Teilnehmer im Sprachkanal, `voice().createBrowserLink(...)` und `copyToClipboard(text)` – siehe [Ab API 9](#ab-api-9).
- ab API 10: Moderation im Sprachkanal (Sperren, Gastgeber und Party-Leiter), Melden und Voice-Regeln über Dialoge von HeldixClient – siehe [Ab API 10](#ab-api-10).

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

## Ab API 4

Mit `"api": 4` (ab HeldixClient 0.13.2) kommen zwei Bausteine dazu: gedroppte Items und Cosmetics. Ein Addon bestimmt damit, wie gedroppte Items in der Welt liegen: in welcher Höhe und mit welcher Drehung, statt dass sie wie in Minecraft schweben und sich drehen. Die Eingriffe in Minecraft dafür macht HeldixClient selbst – dein Addon nutzt weiter nur die Heldix-API und läuft in Heldix- **und** Fabric-Instanzen. Fertige Addons für API 1 bis 3 laufen unverändert weiter.

### Renderer für gedroppte Items

- `api.droppedItems()` liefert ein `DroppedItems`.
- `droppedItems().addRenderer(item -> …)` meldet einen `DroppedItemRenderer` an und gibt eine `Registration` zurück. Es zeichnet immer nur der zuletzt angemeldete, noch aktive Renderer – auch über Addons hinweg. `cancel()` stellt das normale Zeichnen wieder her (bzw. den vorigen Renderer).
- `droppedItems().isSupported()` ist `false`, wenn HeldixClient das Zeichnen in dieser Minecraft-Version nicht verändern kann. Renderer wirken dann nicht, das Addon läuft aber weiter.
- `DroppedItemRenderer.pose(item)` läuft im Haupt-Thread einmal pro Item und Bild und liefert eine `DroppedItemPose` – oder `null`, dann zeichnet Minecraft dieses Item wie gewohnt.

### DroppedItem

`DroppedItem` ist nur zum Lesen da und gilt nur während `pose`. Merk dir das Objekt nicht über das Bild hinaus.

- `entityId()`, `itemId()` (z. B. `minecraft:diamond`), `stackSize()` und `count()` – wie viele Modelle Minecraft zeichnet (1 bis 5).
- `ageTicks()` – Alter in Ticks, mit Bruchteil des laufenden Ticks.
- `onGround()`, `inWater()`, `speed()` und `verticalSpeed()` – Tempo in Blöcken pro Tick.
- `flat()` – das Modell ist höchstens 1/16 Block dick (etwa Diamanten oder Schwerter).
- `bobOffset()` – ein fester, zufälliger Wert je Item von 0 bis 2π, gut für eine feste Ausrichtung.
- `minX()` bis `maxZ()` – die Box des Modells.
- `memory()` – acht Zahlen je Item, die über die Bilder erhalten bleiben (anfangs 0).

### DroppedItemPose

`new DroppedItemPose(lift, yaw, pitch, roll)` bzw. `DroppedItemPose.of(lift, yaw, pitch)`: Die Mitte des Modells liegt `lift` Blöcke über der Position des Items, dann dreht es sich um die Hochachse (`yaw`), die Querachse (`pitch`, 90 = flach) und die Längsachse (`roll`) – Winkel in Grad. `DroppedItemPose.liftOnly(…)` und `rotationOnly(…)` ändern nur einen Teil, der andere bleibt wie in Minecraft.

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

Werte, die keinen Sinn ergeben, fängt HeldixClient ab: `lift` wird auf ±2 Blöcke begrenzt, Winkel über 3600° auf 0 bis 360° gebracht. Ist `lift` keine endliche Zahl (`NaN`, unendlich), schwebt das Item wie gewohnt; ist ein Winkel keine endliche Zahl, dreht es sich wie gewohnt. Wirft dein Renderer, wird dieses Item in diesem Bild normal gezeichnet, und der Fehler zählt wie jeder Fehler eines Addons.

> **Tipp:** Ein vollständiges Beispiel mit Überschlagen in der Luft, sanftem Hinlegen und Stapeln ist das Addon **Item Physics** (`itemphysics`) im [Addon-Store](/addons).

### Cosmetics

`api.cosmetics()` liefert ein `Cosmetics`: Dein Addon kann den [Cosmetics-Katalog](/cosmetics) lesen, Cosmetics nur bei dir vorführen und kurz animieren. Die Auswahl ändert nur der Spieler selbst – ein Addon kann keine eigenen Cosmetics zeichnen lassen, nichts an andere Spieler senden und die Auswahl beim Heldix-Dienst nicht ändern.

- `catalog()` – alle geladenen und geprüften Cosmetics als `CosmeticInfo` mit `id()`, `slot()`, `name()`, `description()` und `teamOnly()`. Ohne Heldix-Dienst ist die Liste leer; die eingebauten Capes stehen nicht darin.
- `worn(uuid, slot)` – was ein Spieler trägt (`Optional<String>`): für dich deine Auswahl, für andere das, was der Dienst beim Nachschlagen gemeldet hat (nur erkennbare HeldixClient-Spieler in der Nähe oder in der Tab-Liste).
- `mine()` – deine Auswahl je Slot (`HEAD`, `BACK`, `AURA`, `COMPANION`, `CAPE`), nur belegte.
- `preview(slot, id, dauer)` – zeigt ein Cosmetic **nur bei dir** (Third-Person, Inventar, Figuren im Heldix-Menü), etwa als Vorschau in einem eigenen Menü. Endet nach der Dauer (höchstens eine Stunde), mit `cancel()` oder wenn das Addon abgeschaltet wird. Beim Dienst ändert sich nichts.
- `animate(slot, effekt)` – ein kurzer Effekt (etwa 1,6 Sekunden) an deinem Cosmetic, nur bei dir: `"flap"` (Flügel doppelt so schnell, `BACK`), `"spin"` (einmal drehen) und `"bounce"` (hüpfen) für `HEAD`, `BACK` und `COMPANION`, `"burst"` (ein Schwall Partikel, `AURA`). Bei animierten Cosmetics (Format 2, ab HeldixClient 0.13.8) spielen `"flap"` und `"burst"` die Jubel-Animation des Cosmetics, falls es eine hat; `"spin"` und `"bounce"` wirken wie gewohnt.
- `onChange(change -> …)` – deine Auswahl hat sich geändert (Heldix-Menü, Launcher oder Webseite): `slot()`, `previous()` und `current()`. Läuft im Haupt-Thread.

Eine unbekannte ID oder ein Effekt, den es für den Slot nicht gibt, wirft eine `IllegalArgumentException`.

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

Cosmetics sind reine Daten (Modell, Textur, Partikel), vom Team signiert. HeldixClient prüft jedes selbst, bevor es gezeichnet wird – in Heldix- und Fabric-Instanzen.

`DroppedItem`, `CosmeticInfo` und `CosmeticChange` sind Schnittstellen, damit spätere Versionen Werte ergänzen können, ohne Addons zu brechen. `DroppedItemPose` baust du selbst, deshalb ist es ein Record (wie `ItemInfo`). Funktionen der Stufe 4 sind in den API-Klassen mit `@since 4` gekennzeichnet.

## Ab API 5

Mit `"api": 5` (ab HeldixClient 0.13.3) lassen sich HUD-Elemente im Spiel anklicken, und sie passen sich dem HUD-Stil an, den der Spieler eingestellt hat. Fertige Addons für API 1 bis 4 laufen unverändert weiter.

### Anklickbare HUD-Elemente und HUD-Stil

Im Spiel lassen sich HUD-Elemente mit der Maus bedienen, solange der **Chat offen** ist oder der Spieler die Taste **„HUD bedienen“** gedrückt hat (Optionen → Steuerung → HeldixClient, ab Werk nicht belegt). Dann zeigen sie beim Überfahren einen Rahmen und einen Tooltip und reagieren auf Klicks – beim normalen Spielen nie, und ein Klick erreicht das Spiel nicht. Chatnachrichten und das Eingabefeld haben Vorrang.

Dein Renderer macht mit, indem er zwei Methoden von `HudRenderer` überschreibt. Beide sind Default-Methoden – ein Lambda (`canvas -> …`) zeichnet weiter nur:

- `onClick(HudClick klick)` – Klick auf das Element. `true` heißt „verbraucht“. Ein Rechtsklick, den du nicht verbrauchst, öffnet die Einstellungen deines Moduls. Der Klick gilt als Aktion des Spielers: `sendChatMessage` ist einmal erlaubt.
- `onHover(HudHover maus)` – die Maus steht über dem Element: `tooltip(zeilen…)` (höchstens 12 Zeilen) und `cursor(HudHover.Cursor.HAND)` (außerdem `TEXT`, `CROSSHAIR`, `MOVE`, `NOT_ALLOWED`, `DEFAULT`).

`HudClick` und `HudHover` kennen die Stelle in deinen Koordinaten (`x()`, `y()`), den Bereich unter der Maus (`hotspot()`) und ob der Chat offen ist (`chatOpen()`). `HudClick` hat dazu `button()` (`HudClick.LEFT`, `RIGHT`, `MIDDLE`), `shift()`, `control()`, `alt()`, `insertIntoChat(text)` (an der Schreibmarke ins Eingabefeld) und `copyToClipboard(text)`.

Neu auf der Zeichenfläche:

- `hotspot(id, x, y, breite, höhe, tooltip)` – ein klickbarer Bereich: Der Mauszeiger wird zur Hand, der Tooltip erscheint (`\n` trennt Zeilen), ein Klick kommt mit dieser ID an. Melde ihn jedes Bild beim Zeichnen neu an; später angemeldete liegen oben.
- `iconButton(id, icon, x, y, größe, farbe, tooltip)` – runder Knopf mit Icon im HUD-Stil, hell hinterlegt bei Hover, zugleich ein Bereich. Gibt zurück, ob die Maus darüber ist.
- `interactive()` und `hovered(x, y, breite, höhe)` – bedient der Spieler das HUD gerade (im HUD-Editor immer `false`) bzw. steht die Maus über diesem Bereich? Damit zeigst du Knöpfe nur, wenn man sie auch drücken kann.
- `style()` – das eingestellte Aussehen als `HudStyle`: `kind()` (`HELDIX`, `MINIMAL`, `CLASSIC`), `accent()`, `labelColor()`, `textColor()`, `background()` (mit Deckkraft, `0` = ohne), `opacity()`, `border()`, `borderColor()`, `shadow()`, `radius()`, `padding()`, `align()`, `scale()` und `textStyle()`. Einstellungen, die der Spieler für dein Element im HUD-Editor gemacht hat, sind schon eingerechnet.
- `panel(x, y, breite, höhe)` – die Fläche im HUD-Stil, genau wie bei den eingebauten Elementen.
- `text(text, x, y, farbe, stil, schatten)` – Text an Kommazahl-Positionen, wahlweise mit Schatten.
- `lineHeight(stil)`, `wrap(text, maxBreite, stil)` und `clippedText(text, x, y, maxBreite, farbe, stil)` – Zeilenhöhe, Umbruch nach Wörtern und hart abgeschnittener Text.
- `pushClip(x, y, breite, höhe)` und `popClip()` – alles dazwischen erscheint nur in diesem Rechteck (verschachtelbar).
- `hasIcon(name)` – gibt es dieses Icon?

Abgerundete Flächen, Icons, Fortschrittsbalken, Items, Spielerköpfe und gekürzter Text gibt es schon seit API 2 und 3. Die Größe aus dem HUD-Editor ist beim Zeichnen schon eingerechnet; du zeichnest immer in deinen eigenen Koordinaten.

Mit `addStyleToggle(schlüssel, label, standard)`, `addStyleChoice(…)` und `addStyleColor(…)` am `ModuleHandle` legst du Optionen für das Aussehen an. Sie stehen im HUD-Editor im Rechtsklick-Menü deines Elements unter „Optionen: <Name>“ und zusätzlich im Untermenü des Moduls.

So zeigt die Uhr aus dem Uhrzeit-Addon einen Tooltip mit Datum und schreibt per Klick Uhr- und Spielzeit in den Chat:

```java
ModuleHandle clock = api.registerHudModule(
        ModuleSpec.of("uhrzeit", "Uhrzeit", "Echte Uhrzeit im HUD").at(4, 190).withIcon("clock"), new HudRenderer() {
    @Override
    public void render(HudCanvas canvas) {
        HudStyle style = canvas.style();
        String time = LocalTime.now().format(TIME);
        int width = style.padding() * 2 + canvas.textWidth(time, style.textStyle());
        canvas.panel(0, 0, width, 16);
        canvas.text(time, style.padding(), 4, style.textColor(), style.textStyle(), style.shadow());
    }

    @Override
    public void onHover(HudHover hover) {
        hover.tooltip(LocalDate.now().format(DATE), "Klick: im Chat anzeigen");
        hover.cursor(HudHover.Cursor.HAND);
    }

    @Override
    public boolean onClick(HudClick click) {
        if (click.button() != HudClick.LEFT) return false;   // Rechtsklick öffnet die Einstellungen
        if (click.shift() && click.insertIntoChat(LocalTime.now().format(TIME_SHORT) + " Uhr")) return true;
        api.chat("Es ist " + LocalTime.now().format(TIME) + " Uhr.");
        return true;
    }
});
BooleanSupplier showDate = clock.addStyleToggle("date", "Datum", false);   // im Rechtsklick-Menü des HUD-Editors
```

Knöpfe zeigt das Spotify-Addon nur, solange man sie drücken kann:

```java
if (canvas.interactive()) {
    int color = canvas.style().textColor();
    canvas.iconButton("previous", "skip-previous", x, y, 12, color, "Vorheriger Song");
    canvas.iconButton("play-pause", playing ? "pause" : "play", x + 14, y, 12, accent, playing ? "Pause" : "Abspielen");
    canvas.iconButton("next", "skip-next", x + 28, y, 12, color, "Nächster Song");
}
// im onClick: switch (click.hotspot()) { case "play-pause" -> playPause(); … }
```

`HudClick`, `HudHover` und `HudStyle` stellt HeldixClient bereit, deshalb sind es Schnittstellen. `HudRenderer` bekommt nur Default-Methoden und bleibt ein funktionales Interface – fertige Renderer (auch Lambdas) laufen unverändert. Funktionen der Stufe 5 sind in den API-Klassen mit `@since 5` gekennzeichnet.

## Ab API 6

Mit `"api": 6` (ab HeldixClient 0.13.4) bekommen Module eigene Tasten, die der Spieler im Untermenü umbelegt, und Addons sehen andere Spieler in der Nähe, hängen Einträge ins Spielermenü, zeigen Symbole am Namensschild und sprechen über den Sprachkanal des Heldix-Dienstes. Fertige Addons für API 1 bis 5 laufen unverändert weiter.

### Tasten im Untermenü eines Moduls

Tasten, die zu einem Modul gehören, legst du direkt am `ModuleHandle` an. Sie stehen im Untermenü des Moduls unter **Tasten**: Der Spieler klickt auf die Taste, drückt die neue (Entf = nicht belegt, Esc = abbrechen) und kann zur Standardtaste zurück. Dieselbe Belegung steht wie jede Addon-Taste unter Optionen → Steuerung → Heldix-Addons.

- `addKey(schlüssel, name, beschreibung, standardtaste, onPress)` – neue Taste für dieses Modul, gibt ein `KeyHandle` zurück. Wie `registerKey` nur in `onEnable` aufrufen (später lehnt HeldixClient sie ab). `onPress` läuft im Spiel (nicht in Menüs) als Aktion des Spielers, auch wenn das Modul aus ist – prüfe dafür `isEnabled()`.
- `showKey(taste, name, beschreibung)` – eine mit `api.registerKey` angelegte Taste zusätzlich im Untermenü zeigen.

Jedes Modul (auch aus Addons) bekommt außerdem von selbst eine Taste **Ein/Aus**, ab Werk nicht belegt. Darum musst du dich nicht kümmern.

```java
// Uhrzeit-Addon: eigene Taste, ab Werk frei
clock.addKey("tell-time", "Uhrzeit im Chat", "Zeigt Uhr- und Spielzeit nur dir im Chat", HeldixKeys.NONE, () -> api.chat(clockText()));

// Spotify-Addon: vorhandene Tasten im Untermenü zeigen
module.showKey(api.registerKey("play-pause", "Abspielen/Pause", HeldixKeys.HOME, this::playPause), "Abspielen/Pause", "");
```

### Andere Spieler, Spielermenü und Symbole

- `api.nearbyPlayers()` – die anderen Spieler in der geladenen Welt, nächster zuerst, als `NearbyPlayer`: `uuid()`, `name()`, `x()`/`y()`/`z()`, `distance()` (Blöcke), `direction()` (Grad von deiner Blickrichtung aus: 0 geradeaus, negativ links, positiv rechts) und `heldixPlayer()`. Nur im Haupt-Thread.
- `api.addPlayerMenuEntry(eintrag)` – eigener Eintrag im **Spielermenü** (Mausrad-Klick auf einen Spieler). `PlayerMenuEntry` liefert `label(spieler)` (`null` = hier kein Eintrag), `icon(spieler)`, `select(spieler)` (Aktion des Spielers im Haupt-Thread) und `keepOpen()`.
- `api.playerMarkers().show(uuid, icon, farbe, dauer)` – ein Symbol aus dem Heldix-Icon-Set hinter dem Namen im Namensschild über dem Kopf, z. B. `"volume"` für „spricht“. Es verschwindet nach `dauer` (höchstens eine Minute) von selbst; `hide(uuid)` nimmt es sofort weg.

### Sprachkanal (Voice Chat)

`api.voice()` ist ein Kanal über den Heldix-Dienst zu HeldixClient-Spielern in der Nähe – auf demselben Server, in derselben Welt und innerhalb von `range()` Blöcken (meist 48). Blockierungen und „Nur Freunde“ (`setFriendsOnly`) gelten. HeldixClient hält die Verbindung und meldet Server, Welt und Position; Aufnehmen, Kodieren, Mischen und Abspielen macht dein Addon.

- `setActive(true)` verbindet (nur, solange du ihn brauchst), `status()` und `statusText()` sagen, wie es steht (z. B. „Nur auf Servern“).
- `send(rahmen, folgenummer, letzter)` schickt einen Rahmen (bis `maxFrameSize()` Bytes, z. B. 20 ms Opus); aus jedem Thread. Kommt die Verbindung nicht hinterher, werden Rahmen verworfen.
- `onFrame((sender, folgenummer, letzter, rahmen) -> …)` empfängt die Rahmen der anderen – **im Netzwerk-Thread**: schnell zurückkehren und keine Minecraft-Objekte anfassen.
- `peers()` – andere Spieler mit eingeschaltetem Kanal im selben Raum.

Das offizielle Addon **Voice Chat** ist ein vollständiges Beispiel: Aufnahme mit `javax.sound`, Opus aus Concentus, Puffer gegen Schwankungen, Lautstärke nach Abstand und Richtung, Push-to-Talk mit `addKey` und Einträge im Spielermenü (ab Version 1.1.0 mit den Funktionen der Stufe 7).

`NearbyPlayer` und `VoiceChannel` stellt HeldixClient bereit, deshalb sind es Schnittstellen; `PlayerMenuEntry` schreibst du selbst (mit Default-Methoden für `icon` und `keepOpen`). Funktionen der Stufe 6 sind in den API-Klassen mit `@since 6` gekennzeichnet.

## Ab API 7

Mit `"api": 7` (ab HeldixClient 0.13.5) zeigen Addons größere Symbole frei über dem Kopf anderer Spieler, der Sprachkanal kennt den Status der anderen (Mikrofon stumm, Ton aus) und Gruppen über den ganzen Server, und Namen lassen sich auch für Spieler nachschlagen, die nicht in der Nähe sind. Fertige Addons für API 1 bis 6 laufen unverändert weiter.

### Symbole über dem Kopf

- `api.playerMarkers().showAbove(uuid, icon, farbe, dauer)` – ein Symbol aus dem Heldix-Icon-Set über dem Namensschild: größer als hinter dem Namen, auf einer runden, dunklen Fläche mit Rand in der Farbe des Symbols, gut lesbar vor Himmel und Landschaft. Beim Erscheinen ploppt es kurz auf. Es gilt, was für das Namensschild gilt: nicht mit F1, nicht bei Unsichtbarkeit oder wenn der Server Namensschilder ausblendet, beim Schleichen blasser und nicht durch Wände. Symbole mehrerer Addons stehen nebeneinander.
- Ein neues Symbol deines Addons ersetzt das alte – zum Animieren einfach jeden Tick neu zeigen, z. B. `"volume-1"` bis `"volume-3"` je nach Lautstärke. `hide(uuid)` nimmt beide Symbole deines Addons weg (hinter dem Namen und über dem Kopf).
- Neu im Icon-Set: `volume-1`, `volume-2`, `volume-3` (Lautsprecher mit einer bis drei Wellen) und `headphones-off`.

```java
// jeden Tick: wer spricht, bekommt Schallwellen über den Kopf
for (UUID speaker : speaking) {
    float level = levelOf(speaker);
    String icon = level < 0.34f ? "volume-1" : level < 0.67f ? "volume-2" : "volume-3";
    api.playerMarkers().showAbove(speaker, icon, 0x34D399, Duration.ofMillis(300));
}
```

### Status und Gruppen im Sprachkanal

- `voice().setState(stumm, tonAus)` meldet deinen Status an die anderen im selben Raum und in deiner Gruppe; HeldixClient schickt ihn nach jedem Verbinden erneut. Mit `tonAus` bekommst du außerdem keine Rahmen mehr. `peerMuted(uuid)` und `peerDeafened(uuid)` liefern den Status der anderen.
- `voice().setGroup(name, passwort)` betritt eine Gruppe (leerer Name = keine): Alle mit demselben Namen und Passwort auf diesem Server hören sich überall – auch in anderen Dimensionen und ohne Abstand. Spieler in der Nähe hören dich weiter wie gewohnt. Groß- und Kleinschreibung zählt beim Namen nicht, beim Passwort schon. An den Heldix-Dienst geht nur ein Prüfwert (SHA-256) aus Name und Passwort.
- `group()` – eingestellte Gruppe, `groupMembers()` – die anderen Mitglieder (höchstens 16 je Gruppe), `groupsAvailable()` – kann der verbundene Heldix-Dienst Gruppen (ab Dienst 1.9.0), `groupProblem()` – warum es gerade nicht klappt (z. B. „Gruppe ist voll“).
- Rahmen aus der Gruppe kommen wie alle anderen über `onFrame` an; ob der Sprecher zur Gruppe gehört, sagt `groupMembers()`.

### Spielernamen

`api.playerName(uuid)` liefert den Namen eines Spielers aus der Welt, der Tab-Liste des Servers oder deiner Freundesliste – z. B. für Gruppenmitglieder, die gerade woanders sind. Ohne Treffer ein leeres `Optional`. Nur im Haupt-Thread.

Funktionen der Stufe 7 sind in den API-Klassen mit `@since 7` gekennzeichnet.

## Ab API 8

Mit `"api": 8` (ab HeldixClient 0.13.7) lesen Addons die Oberfläche der Welt von oben, zeichnen selbst gefüllte Bilder ins HUD und sehen die Wegpunkte des Spielers – alles, was eine Minimap braucht. Fertige Addons für API 1 bis 7 laufen unverändert weiter.

### Die Welt von oben

`api.worldMap()` liefert ein `WorldMap` (nur im Haupt-Thread, nur geladene Chunks):

- `sampleSurface(minX, minZ, breite, tiefe, farben, colors, heights, waterDepths)` füllt für ein Rechteck je Spalte die Farbe des obersten sichtbaren Blocks (ARGB, 0 = nicht geladen), seine Höhe und die Wassertiefe. Index ist `dz * breite + dx`; `heights` und `waterDepths` dürfen `null` sein. Rückgabe: Anzahl geladener Spalten.
- Farben: `WorldMap.Colors.TEXTURE` – Durchschnittsfarbe der Textur von oben (aus dem aktiven Ressourcenpaket) mal Biom-Färbung für Gras, Laub und Wasser, also wie die Welt aussieht – oder `WorldMap.Colors.MAP` – die Farben der Minecraft-Karten. Schattierung nach Höhe und Wassertiefe machst du selbst (die Höhen hast du ja).
- `view()` – Position und Blickrichtung des Spielers **für das gerade gezeichnete Bild**, zwischen zwei Ticks weich. `playerState()` liest nur jeden Tick neu; für eine Karte, die sich mitdreht, würde das ruckeln.
- `surfaceY(x, z)`, `dimension()`, `hasCeiling()` (z. B. der Nether), `minY()`/`maxY()`.
- `sampleBelow(…, topY, …)` sucht ab der Höhe `topY` abwärts (bis zu 48 Blöcke) – für Höhlen oder den Nether unter seiner Decke. **Fair Play:** Das geht nur in Einzelspieler-Welten (`undergroundAllowed()`); auf Servern bleiben alle Spalten 0.

Lies nicht jedes Bild die ganze Umgebung neu: Chunk für Chunk im Tick (mit einem Budget je Tick) und ältere Chunks nach und nach auffrischen reicht. Neue Texturfarben liest HeldixClient höchstens 24 je Tick; bis dahin kommt dafür die Kartenfarbe.

### Eigene Bilder im HUD

- `api.createImage(breite, höhe)` (bis 512 × 512) legt ein `HudImage` an; `setPixels(argb)` bzw. `setPixel(x, y, argb)` setzen Pixel (ARGB, Alpha 0 = durchsichtig – so wird eine Karte rund).
- `canvas.image(bild, x, y, breite, höhe)` zeichnet es; geänderte Pixel lädt HeldixClient vorher hoch. Gezeichnet wird ohne Glätten, an Bildschirm-Pixeln ausgerichtet.
- `canvas.pixelScale()` sagt, wie viele echte Pixel ein GUI-Pixel gerade hat – lege das Bild so groß an, dann ist es scharf.
- `close()` gibt ein Bild frei; beim Abschalten des Addons passiert das von selbst. Höchstens 16 Bilder je Addon gleichzeitig.

```java
HudImage map = api.createImage(192, 192);
int[] pixels = new int[192 * 192];
// … pixels füllen …
map.setPixels(pixels);
// im HudRenderer:
canvas.image(map, 0, 0, 96, 96);
```

### Wegpunkte

`api.waypoints()` – die sichtbaren Wegpunkte des Spielers in der aktuellen Welt (alle Dimensionen) als `WaypointInfo`: `name`, `x`/`y`/`z`, `dimension`, `color` und `death` (der automatische Todespunkt). Nur lesen, nur im Haupt-Thread.

Das offizielle Addon **Minimap** ist ein vollständiges Beispiel für alles auf dieser Stufe. `WorldMap` und `HudImage` stellt HeldixClient bereit, deshalb sind es Schnittstellen; `WaypointInfo` und `WorldMap.View` sind Records. Funktionen der Stufe 8 sind in den API-Klassen mit `@since 8` gekennzeichnet.

## Ab API 9

Mit `"api": 9` (ab HeldixClient 0.13.7) kennt der Sprachkanal Teilnehmer, die über die Webseite mitreden – Gäste ohne HeldixClient und angemeldete Spieler im Browser –, und ein Addon kann für die eigene Voice-Gruppe einen Browser-Link erzeugen. Fertige Addons für API 1 bis 8 laufen unverändert weiter.

### Gäste und Browser im Sprachkanal

Wer einen Browser-Link öffnet, redet auf der Webseite mit (siehe [Im Browser mitreden](/hilfe/einladungen#im-browser-mitreden)) – als **Gast** mit selbst gewähltem Namen oder angemeldet mit seinem Minecraft-Konto. Browser-Teilnehmer haben keine Position: Sie gehören immer zu deiner Gruppe (`groupMembers()`) und sind überall zu hören, wie ein Mitglied in einer anderen Dimension. Ihre Rahmen kommen wie alle anderen über `onFrame` an – im selben Format (Opus, 48 kHz, mono, 20 ms).

- `isGuest(id)` – ein Gast? Gäste haben statt einer Minecraft-UUID eine zufällige ID; ihren Namen liefert `api.playerName(id)`.
- `inBrowser(id)` – spricht über die Webseite (Gast oder angemeldet im Browser)?
- `guestsAvailable()` – kann der verbundene Heldix-Dienst Gäste und Browser-Links (ab Dienst 1.11.0)? `false`, solange nicht verbunden.
- `removeGuest(id)` – einen Gast aus deiner Gruppe entfernen. Der Dienst trennt ihn sofort; mit dem Link kann er neu beitreten, solange der Link gilt. Nur auf Wunsch des Spielers.

### Browser-Link für die Gruppe

`voice().createBrowserLink(onLink, onError)` erzeugt einen Link für deine Gruppe auf dem aktuellen Server: 24 Stunden gültig, höchstens 4 Gäste gleichzeitig; für dieselbe Gruppe kommt derselbe Link zurück. Genau einer der beiden Callbacks läuft, im Haupt-Thread – `onLink` mit dem Link, `onError` mit einer deutschen Meldung für den Spieler (etwa „Du bist in keiner Voice-Gruppe“). Gruppenname und Passwort erfährt dabei niemand: An den Dienst geht wie immer nur der Prüfwert.

`api.copyToClipboard(text)` legt Text in die Zwischenablage – nur auf Wunsch des Spielers und im Haupt-Thread, höchstens 2000 Zeichen.

```java
// Knopf „Browser-Link kopieren“ im Gruppen-Bereich
if (api.voice().guestsAvailable()) {
    api.voice().createBrowserLink(link -> {
        api.copyToClipboard(link);
        api.notify("Voice Chat", "Browser-Link kopiert – gilt 24 Stunden");
    }, error -> api.notify("Voice Chat", error));
}

// In der Liste: Gäste und Browser kennzeichnen
for (UUID member : api.voice().groupMembers()) {
    String name = api.playerName(member).orElse("Spieler");
    String tag = api.voice().isGuest(member) ? " (Gast)" : api.voice().inBrowser(member) ? " (Browser)" : "";
    // …
}
```

Das offizielle Addon **Voice Chat** (ab Version 1.2.0) zeigt Gäste und Browser-Teilnehmer in seiner Liste, kopiert den Browser-Link und entfernt Gäste. Funktionen der Stufe 9 sind in den API-Klassen mit `@since 9` gekennzeichnet.

## Ab API 10

Mit `"api": 10` (ab HeldixClient 0.14.0) kennt der Sprachkanal die Voice-Moderation des Heldix-Dienstes (ab Dienst 1.13.0): Sperren durch das Team, Server ohne Voice, Gastgeber und Party-Leiter, die andere für alle stummschalten oder entfernen, Meldungen mit Lautstärke-Verlauf und – wenn das Team es eingeschaltet hat – der Aufnahme der letzten Minuten, und die Voice-Regeln, denen jeder vor dem Sprechen zustimmt. Fertige Addons für API 1 bis 9 laufen unverändert weiter.

> **Wichtig:** Zustimmen und Melden laufen über **Dialoge von HeldixClient**. Ein Addon kann die Voice-Regeln nicht selbst annehmen und keine Meldung selbst abschicken – es öffnet nur den Dialog. So sieht der Spieler immer denselben, vollständigen Text und entscheidet selbst.

### Moderations-Stand und Ereignisse

- `voice().moderation()` – der eigene Stand: `available()` (kann der Dienst Moderation?), `banned()` mit `bannedUntil()` (0 = dauerhaft), `banReason()`, `banMessage()` und `banAppeal()`, `serverOff()` (Voice ist auf diesem Server aus), `mutedBy()` (wer dich hier für alle stumm geschaltet hat), `kickedUntil()` und `rulesRequired()`. Nur im Haupt-Thread.
- `voice().onModeration(event -> …)` meldet Änderungen im Haupt-Thread – jeweils mit fertigem deutschen Text in `message()`, z. B. „Tom hat dich in dieser Welt stummgeschaltet.“. Arten (`kind()`): `BANNED`, `MUTED`, `UNMUTED`, `KICKED`, `UNKICKED`, `SERVER_OFF`, `RULES_REQUIRED` und `CLIPS_CHANGED`; dazu `scope()` (`"world"` oder `"party"`), `byName()` und `until()`.

```java
api.voice().onModeration(event -> {
    switch (event.kind()) {
        case RULES_REQUIRED -> api.voice().showRules(ok -> { });
        case CLIPS_CHANGED -> { if (!api.voice().clipsActive()) buffer.clear(); }
        default -> api.notify("Voice Chat", event.message());
    }
});
```

### Rechte im Raum

- `voice().rights()` – `worldName()` und `worldRole()` (`"host"`, `"operator"` oder `"player"`; `null` außerhalb einer Heldix-Welt), `partyLeader()` und `canModerate(uuid)` für deine Knöpfe (Gäste nie).
- `voice().isSilenced(uuid)` – ist jemand im geltenden Bereich für alle stumm geschaltet? Gut für ein Symbol über dem Kopf.
- `voice().moderate(uuid, aktion, ergebnis -> …)` mit `ModerationAction.MUTE`, `UNMUTE`, `KICK` (10 Minuten kein Zutritt) oder `UNKICK`. Den Bereich wählt HeldixClient: Ist der Spieler in deiner Party und du leitest ihre Voice-Gruppe, gilt es für die Party, sonst für die Heldix-Welt (Gastgeber und Operatoren). Das Ergebnis kommt als deutscher Text im Haupt-Thread. **Nur auf Wunsch des Spielers** – in einer Taste, einem Knopf, einem Klick im HUD, einem Befehl oder einem Eintrag im Spielermenü; sonst wirft der Aufruf eine `IllegalStateException`.

### Melden mit Lautstärke-Verlauf und Aufnahme

`voice().openReport(uuid, anhänge, ergebnis -> …)` öffnet den Melde-Dialog von HeldixClient: Grund (Beleidigung, Belästigung, Hassrede, Anschreien/Lärm, Sonstiges), Notiz (höchstens 300 Zeichen) und – nur wenn Aufnahmen aktiv sind – der Schalter „Die letzten X Minuten seiner Stimme werden angehängt“. Server, Dimension, Zeitpunkt, Gruppe und wer in Hörweite war fügt HeldixClient selbst hinzu. Wie `moderate` nur auf Wunsch des Spielers; Gäste lassen sich nicht melden.

Die Anhänge lieferst du über `ReportAttachments` – erst, wenn der Spieler auf „Melden“ klickt:

- `collect(uuid, mitAufnahme)` gibt `ReportData` zurück: den **Lautstärke-Verlauf** (je Sekunde Effektivwert und Spitze in dBFS, älteste zuerst, höchstens 600; `Float.NaN` = nichts gehört; gemessen nach dem Dekodieren, vor jeder Begrenzung) und – nur mit `mitAufnahme` – die gepufferten **Pakete** des Gemeldeten als `ReceivedPacket` (Empfangszeit, Folgenummer, Satzende, Opus-Daten), älteste zuerst.
- `bufferedMillis(uuid)` sagt dem Dialog, wie viel gepuffert ist.

Puffern darfst du nur, solange `voice().clipsActive()` wahr ist: nur im Arbeitsspeicher, je Sprecher höchstens 10 Minuten, nie die eigene Stimme. Wird es falsch (oder wechselt der Server), leere den Puffer sofort. Aus den Paketen baut HeldixClient die Ogg/Opus-Datei und lädt sie hoch; der Heldix-Dienst speichert sie verschlüsselt, nur das Team kann sie anhören.

### Voice-Regeln und Zustimmung

- `voice().rules()` – `version()`, `accepted()`, `required()` und `clipsActive()`.
- `voice().showRules(ok -> …)` zeigt den Dialog „Voice-Regeln“ von HeldixClient: den aktuellen Text vom Heldix-Dienst zum Scrollen, den Hinweis auf die Aufnahme der letzten 10 Minuten beim Melden, „Annehmen“ (erst nach dem Lesen bis zum Ende) und „Ablehnen“. `ok` ist `true`, wenn angenommen oder keine Zustimmung nötig ist. Nach dem Annehmen verbindet HeldixClient den Sprachkanal sofort neu.
- Ohne Aktion des Spielers öffnet sich der Dialog nur, solange die Zustimmung nötig ist, und einmal je Fassung, nachdem dein Addon den Kanal eingeschaltet hat (z. B. bei `RULES_REQUIRED`). Steht gerade ein anderes Fenster offen, wartet HeldixClient damit.

Das offizielle Addon **Voice Chat** (ab Version 1.3.0) nutzt alles auf dieser Stufe: Melden aus Spielermenü und Anzeige, Ringpuffer und Lautstärke-Verlauf, Lautstärke-Schutz, Knöpfe für Gastgeber und Party-Leiter und den Regeln-Dialog vor der ersten Verbindung. `Moderation`, `ModerationEvent`, `RoomRights` und `Rules` stellt HeldixClient bereit, deshalb sind es Schnittstellen; `ReportAttachments` schreibst du selbst, `ReportData` und `ReceivedPacket` sind Records. Funktionen der Stufe 10 sind in den API-Klassen mit `@since 10` gekennzeichnet.

## Threads und Fehler

- Ereignisse, Tasten, Aktionen, `onToggle`, HUD-Renderer (auch `onClick` und `onHover`) und Renderer für gedroppte Items laufen im Haupt-Thread. Warte dort nie auf Netzwerk oder langsame Dateien, sonst ruckelt das Spiel.
- Aus eigenen Threads ist nur `notify` ausdrücklich erlaubt. Alles andere legst du in Felder und verarbeitest es im nächsten Tick oder im Renderer – ab API 3 einfacher mit `api.scheduler().runAsync(…)` und `runOnMainThread(…)`.
- Fehler in deinem Code fängt HeldixClient ab und schreibt sie ins Log. Nach drei Fehlern – auch in Befehlen, Knöpfen und Aufgaben des Schedulers – wird das Addon für diese Sitzung abgeschaltet, das Spiel läuft weiter. Ein Fehler im Renderer passiert meist jedes Bild – dann ist das Addon sehr schnell aus. Ist ein Renderer für gedroppte Items abgeschaltet, zeichnet wieder der vorige bzw. Minecraft.
- Wirft `onEnable` einen Fehler, wird das Addon gar nicht erst geladen. Das Heldix-Menü zeigt es dann rot mit dem Grund an, siehe [Addons installieren und Fehler finden](/entwickler/addon-installieren).
