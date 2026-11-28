---
titel: Addons entwickeln
beschreibung: Zwei Wege zu einem Heldix-Addon – nur mit der Heldix-API oder mit Eingriffen in Minecraft. Aufbau, dein erstes Addon, Bauen mit Gradle und wie es in den Addon-Store kommt.
reihenfolge: 1
stichworte: addon, api, heldix.addon.json, onEnable, onDisable, gradle, einstieg, beispiel, addon-store, veröffentlichen, einreichen, community, prüfung, regeln, screenshots, mod, heldix-mod, transformer, clientEntrypoint, minecraft, greift in minecraft ein, fabric, loaders, mods & addons
---
Heldix-Addons erweitern HeldixClient. Ein Addon ist eine einzelne JAR-Datei mit einer `heldix.addon.json`, die HeldixClient beim Spielstart aus dem Ordner `heldix-addons` deiner Instanz lädt. Im Launcher und im Spiel stehen Addons zusammen mit Fabric-Mods in der Liste **Mods & Addons**.

## Zwei Wege

Für ein Addon gibt es zwei Wege – und du kannst beide in einem Addon verbinden:

- **Weg 1: nur die Heldix-API** (empfohlen). Dein Addon baut Module, HUD-Elemente, Tasten, Einstellungen, Befehle und mehr über die Heldix-API. Sie enthält bewusst nichts aus Minecraft. Deshalb läuft dieselbe JAR auch nach Minecraft-Updates weiter, in Heldix- **und** Fabric-Instanzen. Macht das Addon Fehler, schaltet HeldixClient nur das Addon ab, und im Spiel lässt es sich sofort ausschalten.
- **Weg 2: Eingriff in Minecraft.** Reicht die Heldix-API nicht, greift dein Addon über den Heldix Loader direkt in Minecraft ein: mit einem eigenen Startpunkt (`clientEntrypoint`) und mit Transformern, die Minecraft-Klassen beim Laden verändern. Solche Addons laufen nur in den Minecraft-Versionen, die sie in `minecraft` nennen, meist nur in Heldix-Instanzen, und An oder Aus wirkt erst nach einem Neustart. Im Addon-Store und im Heldix-Menü tragen sie den Hinweis **Greift in Minecraft ein**.

Für HUD-Anzeigen, Tasten, Einblendungen, Chat-Befehle und kleine Helfer reicht fast immer Weg 1. Selbst Dinge wie flach liegende Items gehen inzwischen über die API (siehe [Ab API 4](/entwickler/addon-api#ab-api-4)) – frag ruhig über den [Support](/konto#ziel=support), bevor du in Minecraft eingreifst.

> **Hinweis:** Fabric-Mods, etwa von Modrinth, bleiben Fabric-Mods und gehören in den Ordner `mods` einer Fabric-Instanz. Ältere Heldix-Mods mit einer `heldix.mod.json` im Ordner `mods` laufen weiter und erscheinen im Launcher und im Heldix-Menü in derselben Liste. Für Neues ist ein Addon nach [Weg 2](#weg-2-eingriff-in-minecraft) der bessere Weg: gleiche Möglichkeiten, aber ein Fehler beendet nicht das Spiel, es lässt sich an- und ausschalten und kommt über den Addon-Store.

## Aufbau eines Addons

Ein Addon für Weg 1 besteht aus zwei Teilen:

1. der Datei `heldix.addon.json` direkt im Wurzelverzeichnis der JAR,
2. einer Klasse, die `dev.heldixclient.api.HeldixAddon` implementiert und einen öffentlichen Konstruktor ohne Parameter hat.

Ein typisches Gradle-Projekt sieht so aus:

```text
mein-addon/
├── build.gradle
├── settings.gradle
├── libs/
│   └── heldix-api-1.0.0.jar
└── src/main/
    ├── java/de/du/meinaddon/MeinAddon.java
    └── resources/heldix.addon.json
```

### Die heldix.addon.json

```json
{
  "id": "mein-addon",
  "name": "Mein Addon",
  "version": "1.0.0",
  "description": "Zeigt deinen Namen im HUD und begrüßt dich in jeder Welt.",
  "authors": ["Du"],
  "entrypoint": "de.du.meinaddon.MeinAddon",
  "api": 2
}
```

- `id` – eindeutige Kennung, nur Kleinbuchstaben `a-z`, Ziffern, `_` und `-`. Unter dieser ID speichert HeldixClient auch die Daten des Addons.
- `name`, `description`, `authors` – erscheinen im Launcher und im Heldix-Menü. Fehlt `name`, zeigt das Heldix-Menü die `id` an.
- `version` – deine Versionsnummer, z. B. `1.0.0`. Liegt dasselbe Addon in mehreren Versionen im Ordner, lädt HeldixClient die neueste.
- `entrypoint` – der volle Klassenname deiner Addon-Klasse, also mit Paket (Weg 1).
- `api` – die API-Stufe, für die du das Addon gebaut hast (siehe unten). Pflicht, sobald es einen `entrypoint` gibt – fehlt es dann, lädt HeldixClient das Addon nicht. Für den Addon-Store gehört es in jede `heldix.addon.json`.
- `clientEntrypoint`, `transformers`, `minecraft`, `loader` und `loaders` – nur für Weg 2, siehe [Eingriff in Minecraft](#weg-2-eingriff-in-minecraft).

Mindestens einer der Einstiegspunkte `entrypoint`, `clientEntrypoint` oder `transformers` muss da sein.

### Die Addon-Klasse

`HeldixAddon` hat zwei Methoden:

- `onEnable(HeldixApi api)` – wird einmal beim Spielstart aufgerufen. Hier registrierst du Module, Ereignisse und Tasten.
- `onDisable()` – optional, wird beim Beenden des Spiels aufgerufen. Hier räumst du auf, z. B. einen Hintergrund-Prozess beenden.

Das Objekt `api` ist dein Zugang zum HeldixClient. Jedes Addon bekommt seine eigene Instanz davon. Wenn du es außerhalb von `onEnable` brauchst, merk es dir in einem Feld.

> **Achtung:** Eigene Tasten (`api.registerKey`) kannst du nur in `onEnable` anlegen. Später sind die Minecraft-Optionen schon geladen, und der Aufruf schlägt fehl.

## Dein erstes Addon

Dieses Addon zeigt deinen Spielernamen im HUD, begrüßt dich beim Betreten einer Welt und reagiert auf eine eigene Taste:

```java
package de.du.meinaddon;

import dev.heldixclient.api.HeldixAddon;
import dev.heldixclient.api.HeldixApi;
import dev.heldixclient.api.HeldixKeys;
import dev.heldixclient.api.ModuleHandle;
import dev.heldixclient.api.ModuleSpec;

import java.util.function.BooleanSupplier;

public class MeinAddon implements HeldixAddon {
    @Override
    public void onEnable(HeldixApi api) {
        // HUD-Element: im HUD-Editor verschiebbar, im Heldix-Menü an- und ausschaltbar
        ModuleHandle hallo = api.registerHudModule(
                ModuleSpec.of("hallo", "Hallo", "Dein Name im HUD").withIcon("star"),
                canvas -> canvas.labelValue("Hallo", api.player().map(p -> p.name()).orElse("Welt")));

        // Einstellung im Untermenü des Moduls, wird automatisch gespeichert
        BooleanSupplier laut = hallo.addToggle("laut", "Laut", "Begrüßung zusätzlich als Einblendung", false);

        // Ereignis: Welt oder Server betreten
        api.events().onWorldJoin(() -> {
            api.chat("Willkommen zurück!");
            if (laut.getAsBoolean()) api.notify("Hallo", "Schön, dass du da bist");
        });

        // eigene Taste, umbelegbar unter Optionen → Steuerung
        api.registerKey("winken", "Winken", HeldixKeys.F7, () -> api.chat("*winkt*"));

        api.logger().info("Mein Addon läuft mit HeldixClient " + api.clientVersion());
    }
}
```

Was die einzelnen Bausteine können, steht ausführlich unter [Addon-API im Detail](/entwickler/addon-api).

## Die API-Version

Die aktuelle API-Stufe ist **9** (Konstante `HeldixApi.API_VERSION`, Stand HeldixClient 0.13.8). HeldixClient lädt Addons, die für API 1 bis 9 gebaut sind.

- **API 1:** Module und HUD-Module, Ereignisse (Tick, Welt betreten und verlassen, Chat), Spielerdaten, lokale Chatnachrichten, eigene Einstellungen mit `api.config()` und ein Logger.
- **API 2** (ab HeldixClient 0.11.0): eigene Tasten, Einblendungen oben rechts, Einstellungen im Untermenü eines Moduls, Icons für Module, Bilder, Heldix-Schrift und abgerundete Flächen im HUD sowie ein eigener Datenordner.
- **API 3** (ab HeldixClient 0.13.1): weitere Ereignisse mit Abmeldung (Server, Menüs, Tod, Dimension, Leben), Spiel- und Spielerdaten (`game()`, `playerState()`), ein Scheduler für Aufgaben im Haupt-Thread und im Hintergrund, Chat-Befehle „.name“, Chat an den Server als Aktion des Spielers, Regler, Farbwahl und Textfelder als Einstellungen und neue Zeichenhilfen im HUD. Mehr unter [Ab API 3](/entwickler/addon-api#ab-api-3).
- **API 4** (ab HeldixClient 0.13.2): gedroppte Items in der Welt selbst zeichnen lassen – Höhe und Drehung je Item, statt zu schweben und sich zu drehen (`api.droppedItems()`, `DroppedItemRenderer`, `DroppedItem`, `DroppedItemPose`) – und den Cosmetics-Katalog lesen, Cosmetics bei dir vorführen und kurz animieren (`api.cosmetics()`). Mehr unter [Ab API 4](/entwickler/addon-api#ab-api-4).
- **API 5** (ab HeldixClient 0.13.3): HUD-Elemente, die man im Spiel anklicken kann – bei offenem Chat oder mit der Taste „HUD bedienen“ –, mit Tooltip, Knöpfen und klickbaren Bereichen (`HudRenderer.onClick`, `onHover`, `canvas.hotspot`, `canvas.iconButton`), das eingestellte HUD-Aussehen (`canvas.style()`, `canvas.panel`), weitere Zeichenhilfen und Stil-Optionen für das Rechtsklick-Menü im HUD-Editor (`addStyleToggle`, `addStyleChoice`, `addStyleColor`). Mehr unter [Ab API 5](/entwickler/addon-api#ab-api-5).
- **API 6** (ab HeldixClient 0.13.4): Tasten im Untermenü eines Moduls, die der Spieler dort umbelegt (`addKey`, `showKey`), andere Spieler in der Nähe (`nearbyPlayers()`), Einträge im Spielermenü (`addPlayerMenuEntry`), Symbole am Namensschild (`playerMarkers()`) und ein Sprachkanal über den Heldix-Dienst (`voice()`). Mehr unter [Ab API 6](/entwickler/addon-api#ab-api-6).
- **API 7** (ab HeldixClient 0.13.5): Symbole frei über dem Kopf anderer Spieler (`playerMarkers().showAbove`), Status (Mikrofon stumm, Ton aus) und Gruppen über den ganzen Server im Sprachkanal (`voice().setState`, `voice().setGroup`) und Spielernamen (`playerName`). Mehr unter [Ab API 7](/entwickler/addon-api#ab-api-7).
- **API 8** (ab HeldixClient 0.13.7): die Welt von oben für Karten (`worldMap()`: Farbe, Höhe und Wassertiefe je Spalte, weiche Spielerposition fürs aktuelle Bild), selbst gefüllte Bilder im HUD (`createImage`, `canvas.image`) und die Wegpunkte des Spielers (`waypoints()`). Mehr unter [Ab API 8](/entwickler/addon-api#ab-api-8).
- **API 9** (ab HeldixClient 0.13.7): Gäste und Teilnehmer im Browser im Sprachkanal (`voice().isGuest`, `inBrowser`, `removeGuest`, `guestsAvailable`), ein Browser-Link für die Voice-Gruppe (`voice().createBrowserLink`) und Text in die Zwischenablage (`copyToClipboard`). Mehr unter [Ab API 9](/entwickler/addon-api#ab-api-9).

Neue Stufen erweitern die API nur. Ein Addon für API 1 läuft deshalb unverändert weiter. Ein Addon, das eine höhere Stufe verlangt, als der installierte HeldixClient kennt, wird mit dem Hinweis „bitte HeldixClient aktualisieren“ übersprungen.

Trag in `api` die höchste Stufe ein, deren Funktionen du benutzt. In den API-Klassen sind die Funktionen der Stufen 2 bis 9 mit `@since 2` bis `@since 9` gekennzeichnet. Das Beispiel oben nutzt `registerKey`, `notify`, `addToggle` und `withIcon` und braucht deshalb `"api": 2`.

> **Hinweis:** Die API-Datei hat eine eigene Versionsnummer (derzeit `heldix-api-1.0.0.jar`). Für die Kompatibilität zählt allein die API-Stufe im Feld `api`. Ob ein Addon in Minecraft eingreift, hängt nicht an der API-Stufe.

## Weg 2: Eingriff in Minecraft

Reicht die Heldix-API nicht, darf dein Addon Minecraft auch direkt verändern. Dafür nutzt es die API des Heldix Loaders – denselben Weg, auf dem HeldixClient selbst in Minecraft eingreift. In der `heldix.addon.json` kommen dazu:

```json
{
  "id": "weites-sichtfeld",
  "name": "Weites Sichtfeld",
  "version": "1.0.0",
  "description": "Ein Sichtfeld über die Grenze von Minecraft hinaus, per Taste umschaltbar.",
  "authors": ["Du"],
  "api": 4,
  "clientEntrypoint": "de.du.sichtfeld.SichtfeldStart",
  "transformers": ["de.du.sichtfeld.SichtfeldTransformer"],
  "minecraft": ["26.3"],
  "loader": ">=2.4.0"
}
```

- `clientEntrypoint` – eine Klasse, die `HeldixModInitializer` aus der Heldix-Loader-API implementiert. Ihr `onInitialize()` läuft einmal beim Spielstart im Konstruktor von `Minecraft`. Dort meldest du Tasten und Ereignisse des Loaders an.
- `transformers` – Klassen, die `ClassTransformer` implementieren. Sie verändern Minecraft-Klassen beim Laden (statt Mixins).
- `minecraft` – **Pflicht**, sobald `clientEntrypoint` oder `transformers` da sind: die Minecraft-Versionen, für die du das Addon gebaut hast, z. B. `["26.3"]` oder `["26.2", "26.3"]`. Eine Angabe ist eine genaue Version (`26.3` passt nicht zu `26.3.1`) oder ein Muster wie `26.x`. Passt die laufende Version nicht, lädt der Loader das Addon nicht und nennt den Grund, etwa „Nur für Minecraft 26.3“.
- `loader` – optional: die nötige Version des Heldix Loaders, z. B. `">=2.4.0"`.
- `loaders` – optional: wo das Addon laufen soll, `["heldix"]`, `["fabric"]` oder beides. Ohne Angabe läuft es im Spiel überall, wo es geht (in Fabric entscheiden die Zielklassen, siehe unten); im Addon-Store gilt ohne Angabe für Addons mit Eingriff „nur Heldix-Instanzen“.
- `entrypoint` – darf zusätzlich da sein. Dann nutzt dasselbe Addon auch die Heldix-API, etwa für ein Modul mit Einstellungen im Heldix-Menü. Beide Teile laufen im selben ClassLoader und teilen sich ihre Klassen.

```java
// Läuft beim Spielstart (Heldix-Loader-API)
public class SichtfeldStart implements HeldixModInitializer {
    @Override
    public void onInitialize() {
        ClientEvents.TICK_END.register(mc -> Sichtfeld.tick(mc));
    }
}

// Verändert Minecraft beim Laden: Das Sichtfeld läuft durch eine eigene statische Methode
public class SichtfeldTransformer implements ClassTransformer {
    @Override
    public Set<String> targets() {
        return Set.of("net/minecraft/client/Camera");
    }

    @Override
    public void transform(String className, ClassNode node) {
        Patches.modifyReturnValue(Patches.method(node, "calculateFov", "(F)F"),
                "de/du/sichtfeld/Sichtfeld", "fov", "(F)F");
    }
}
```

Darauf solltest du achten:

- **Transformer kennen Minecraft nur beim Namen.** Sie werden erzeugt, bevor Minecraft startet, und dürfen keine Minecraft-Klassen benutzen. Die eigentliche Logik gehört in statische Hook-Methoden (hier `Sichtfeld.fov`).
- **Fabric-Instanzen:** Dort greifen Transformer nur bei den Minecraft-Klassen, die der Heldix Loader in Fabric vorgesehen hat ([Liste](/entwickler/heldix-mods#in-fabric-instanzen)). Ein Addon mit Transformern läuft in Fabric nur, wenn alle seine Ziele dazugehören – sonst lädt der Loader es dort nicht und zeigt „Läuft nur in Heldix-Instanzen“. Addons nur mit `clientEntrypoint` und reine API-Addons laufen in Fabric immer.
- **An und Aus** wirkt bei solchen Addons erst nach dem Neustart des Spiels („Wirkt nach dem Neustart“), weil sich Eingriffe in schon geladene Klassen nicht zurücknehmen lassen.
- **Fehler:** Lässt sich ein Transformer beim Start nicht erzeugen, bleibt das ganze Addon aus. Scheitert ein Eingriff erst, wenn seine Zielklasse geladen wird (etwa nach einem Minecraft-Update), fehlt nur dieser Eingriff, und das Heldix-Menü zeigt „Problem“ mit dem Grund. Wirft `onInitialize()`, läuft das Spiel weiter, nur dein Addon ist aus. Die Gründe stehen auch im Log und in `HeldixLoader.problems()`.

Alle Ereignisse, Tasten, Bausteine für Transformer, Ressourcen und das Bauen gegen Minecraft stehen unter [Eingriffe in Minecraft mit dem Heldix Loader](/entwickler/heldix-mods).

## Bauen mit Gradle

Du brauchst ein JDK 21 oder neuer. Die Addons des Teams werden für Java 21 gebaut; das reicht für alle Funktionen der API. Für Weg 2 brauchst du zusätzlich den Heldix Loader und Minecraft zum Kompilieren und Java 25 – siehe [Bauen](/entwickler/heldix-mods#bauen).

Die API-Datei (`heldix-api-1.0.0.jar`) und ein fertiges Beispielprojekt bekommst du auf Anfrage über den [Support](/konto#ziel=support). Leg die API-Datei in den Ordner `libs` deines Projekts.

`settings.gradle`:

```groovy
rootProject.name = 'mein-addon'
```

`build.gradle`:

```groovy
plugins {
    id 'java'
}

version = '1.0.0'

base {
    archivesName = 'mein-addon'
}

dependencies {
    // Die API steckt schon im HeldixClient: nur zum Kompilieren einbinden
    compileOnly files('libs/heldix-api-1.0.0.jar')
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = 21
    it.options.encoding = 'UTF-8'
}

// setzt die Version aus build.gradle in die heldix.addon.json ein
processResources {
    def props = [version: project.version]
    inputs.properties props
    filesMatching('heldix.addon.json') {
        expand props
    }
}
```

> **Tipp:** Mit dem `processResources`-Block kannst du in der `heldix.addon.json` einfach `"version": "${version}"` schreiben. Die Versionsnummer pflegst du dann nur noch an einer Stelle.

> **Hinweis:** Binde die API nur mit `compileOnly` ein. Im Spiel kommen die API-Klassen immer aus dem installierten HeldixClient; eine eigene Kopie in deiner JAR wäre nur Ballast.

Gebaut wird im Projektordner mit:

```bash
./gradlew build
```

Unter Windows lautet der Befehl in PowerShell `.\gradlew build`. Die fertige JAR liegt danach in `build/libs/`, hier also `mein-addon-1.0.0.jar`. Wie du sie ins Spiel bekommst, steht unter [Addons installieren](/entwickler/addon-installieren).

## Addon einreichen

Im [Addon-Store](/addons) stehen **offizielle** Addons des Teams und **Community**-Addons von Spielern. Jede Version ist mit dem Schlüssel des Teams signiert; Launcher und Spiel installieren nichts ohne gültige Signatur. Addons sind Code, der im Spiel läuft – deshalb prüft das Team jedes Addon, bevor es in den Store kommt. Das gilt für beide Wege; Addons mit Eingriff in Minecraft sieht sich das Team besonders genau an.

### Ablauf

1. **Anmelden:** Öffne den [Konto-Bereich](/konto#ziel=addons) auf heldixclient.com – angemeldet wirst du über den Launcher oder im Spiel, ohne Passwort.
2. **JAR hochladen:** Unter **Meine Addons → Addon einreichen** wählst du die fertige JAR aus `build/libs` (höchstens 50 MB). Der Dienst liest daraus die `heldix.addon.json` (ID, Version, Name, Autoren, API-Stufe, Einstiegspunkte und Minecraft-Versionen) und durchsucht die Klassendateien nach Zugriffen, die sich das Team genauer ansieht. Ausgeführt wird dabei nichts. Ob dein Addon in Minecraft eingreift, leitet der Dienst aus `clientEntrypoint` und `transformers` ab. Für den Store dürfen in `minecraft` nur genaue Versionen und Muster wie `26.x` oder `*` stehen – Regeln wie `>=26.2` gehen nur in selbst installierten JARs.
3. **Store-Angaben:** Name, Kurzbeschreibung (vorbelegt mit `description` aus der `heldix.addon.json`), eine längere Beschreibung in Klartext, die Kategorie (HUD, Musik & Medien, Chat & Freunde, Werkzeuge oder Sonstiges), ein Icon aus dem Heldix-Icon-Set (wie bei `withIcon`), die Systeme, auf denen das Addon läuft, und ein paar Stichpunkte, was neu ist. Greift dein Addon in Minecraft ein, beschreib dort, was es verändert.
4. **Screenshots:** bis zu vier Bilder, PNG oder JPEG, je höchstens 2 MB und zwischen 320 × 180 und 3840 × 2160 Pixeln. Am besten zeigst du das Addon im Spiel, im Format 16:9.
5. **Einreichen:** Regeln bestätigen und **Zur Prüfung einreichen** wählen. Solange das Team prüft, lässt sich nichts ändern – zurückziehen geht jederzeit.

Der Assistent speichert deine Angaben als Entwurf. Du kannst ihn schließen und später unter **Meine Addons** weitermachen.

### Regeln

- **Heldix-API zuerst.** Was die Heldix-API kann, machst du über die API. Eingriffe in Minecraft (`clientEntrypoint`, Transformer, Zugriff auf `net.minecraft`) sind erlaubt, wenn die API dafür nicht reicht. Dann nennt deine `heldix.addon.json` die Minecraft-Versionen in `minecraft`, und die Beschreibung sagt, was dein Addon an Minecraft ändert.
- **Kein Schadcode.** Keine Programme starten, keinen nativen Code laden, keinen Code nachladen und nichts vor dem Team oder den Spielern verstecken.
- **Netzwerk und Dateien nur mit Angabe.** Baut dein Addon Verbindungen ins Internet auf oder liest und schreibt es Dateien außerhalb seines Datenordners, steht in der Beschreibung, wohin und wofür. Daten über Spieler sammelt oder verschickt es nicht, ohne dass es dort steht. Eigene Daten gehören in den Datenordner des Addons.
- **Eigene Rechte.** Code, Bilder, Namen und Screenshots sind von dir, oder du darfst sie verwenden – etwa unter einer passenden Lizenz. Keine fremden Marken oder Logos als Name, Icon oder Bild.
- **Ehrliche Angaben.** Beschreibung und Screenshots zeigen, was das Addon wirklich tut. Nichts Anstößiges, keine Werbung.
- **IDs und Versionen.** Eine Addon-ID gehört dem, der sie zuerst einreicht; die IDs offizieller Addons sind gesperrt. Jede neue Version braucht eine höhere Versionsnummer als die veröffentlichte, und eine veröffentlichte Version lässt sich nicht ersetzen.

### Die Prüfung

Das Team lädt die JAR herunter, sieht sich den Code an und prüft Texte, Icon und Screenshots. Dabei helfen die Prüf-Hinweise aus der JAR – die siehst du schon beim Hochladen:

- **Rot – fast immer eine Ablehnung:** Programme starten (`ProcessBuilder`, `Runtime`) und nativer Code (`System.loadLibrary`, `java.lang.foreign`). Ebenfalls rot: Zugriffe auf Minecraft-Klassen (`net.minecraft`) in einem Addon, das keinen Eingriff angibt.
- **Erwartet bei Weg 2:** Gibt dein Addon `clientEntrypoint` oder `transformers` an, sind Zugriffe auf Minecraft kein Warnzeichen. Das Team sieht sich dann jeden Eingriff an und prüft, ob er nötig ist und ob die Heldix-API nicht gereicht hätte.
- **Gelb – erlaubt, wenn es passt:** Netzwerk (`java.net`), Dateien (`java.io.File`, `java.nio.file`) und Reflection (`java.lang.reflect`). Erklär in der Beschreibung, wofür dein Addon das braucht.

Die Hinweise kommen aus einer groben Suche in den Klassendateien und sind noch kein Urteil. Die Prüfung dauert meist ein paar Tage. Gibt ein Admin das Addon frei, signiert er im Team-Bereich genau das Manifest, das der Dienst für deine Einreichung erzeugt hat – als Community-Addon mit dir als Entwickler, samt Zugriff, Minecraft-Versionen und Loadern. Ab dann steht es auf der Webseite, im Launcher und im Spiel. Den Stand siehst du unter **Meine Addons**; ändert er sich, während die Seite offen ist, bekommst du sofort Bescheid.

### Wenn das Team ablehnt

Unter **Meine Addons** steht dann die Begründung des Teams. Mit **Überarbeiten** öffnest du die Einreichung wieder: Angaben ändern, bei Bedarf eine neue JAR hochladen – solange die Version noch nicht veröffentlicht ist, darf es dieselbe Versionsnummer sein – und erneut einreichen. Abgelehnte und zurückgezogene Einreichungen löscht der Dienst nach 90 Tagen. Fragen zur Ablehnung beantwortet das Team über eine [Support-Anfrage](/konto#ziel=support).

### Nach der Veröffentlichung

- Im Store steht dein Addon mit dem Abzeichen **Community** und deinem Spielernamen als Entwickler. Der Name führt zu deiner Entwicklerseite mit all deinen Addons.
- Addons mit Eingriff in Minecraft zeigt der Store mit **Greift in Minecraft ein**, den Minecraft-Versionen und gegebenenfalls „Nur Heldix-Instanzen“. Der Launcher bietet sie nur für Instanzen an, zu denen Minecraft-Version und Loader passen.
- Downloads und Bewertungen siehst du unter **Meine Addons**. Dort reichst du mit **Neue Version einreichen** auch Updates ein – gleiche ID, höhere Versionsnummer. Für eine neue Minecraft-Version reichst du bei Weg 2 eine neue Version mit passender Liste in `minecraft` ein.
- Spieler können ein Addon melden. Das Team kann es dann aus dem Store nehmen; wer es installiert hat, behält es.

> **Hinweis:** Spielername und UUID stehen im signierten Manifest jeder veröffentlichten Version und lassen sich dort nicht mehr ändern. Löschst du später deine Daten beim Heldix-Dienst, bleibt das Addon im Store, als Entwickler steht dann „Gelöschter Spieler“. Mehr dazu in der [Datenschutzerklärung](/datenschutz).

## Vorlagen

Fünf Addons des Teams sind gleichzeitig gute Vorlagen. Alle gibt es im [Addon-Store](/addons):

- **Uhrzeit & Spielzeit** (`uhrzeit`): zwei HUD-Module, ein Schalt-Modul für eine Begrüßung im Chat, Farbe, Textfeld und Regler als Einstellungen, ein Scheduler und der Befehl `.uhr`.
- **Spotify** (`spotify`): eigene Tasten, mehrere Einstellungen, ein selbst gezeichnetes HUD-Element mit Album-Cover, Einblendungen beim Songwechsel, Chat-Befehle und ein Hintergrund-Prozess, der nur läuft, solange das Modul an ist.
- **Item Physics** (`itemphysics`, API 4): ein Renderer für gedroppte Items mit Speicher je Item, Regler mit eigenem Text und einer Taste ohne Standardbelegung. Ursprünglich eine Heldix-Mod mit Transformern – heute nur noch Heldix-API, deshalb läuft es auch in Fabric-Instanzen.
- **Voice Chat** (`voicechat`, API 9): Sprachkanal über den Heldix-Dienst, Aufnahme und Wiedergabe in eigenen Threads, eine mitgelieferte Bibliothek (Opus), Tasten im Untermenü, Einträge im Spielermenü, Symbole über Köpfen und ab Version 1.2.0 ein Browser-Link für die Gruppe samt Gästen.
- **Minimap** (`minimap`, API 8): liest die Welt chunkweise mit Budget je Tick, baut daraus ein selbst gefülltes, gedrehtes Bild (`createImage`), Stil-Optionen im HUD-Editor, Zoom-Tasten und Wegpunkte.

Ausschnitte daraus findest du unter [Addon-API im Detail](/entwickler/addon-api).
