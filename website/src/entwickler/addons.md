---
titel: Heldix-Addons schreiben
beschreibung: Was ein Heldix-Addon ist, wie es aufgebaut ist und wie du in wenigen Minuten dein erstes eigenes Addon baust.
reihenfolge: 1
stichworte: addon, api, heldix.addon.json, onEnable, onDisable, gradle, einstieg, beispiel
---
Heldix-Addons sind kleine Erweiterungen für HeldixClient. Ein Addon ist eine einzelne JAR-Datei, die HeldixClient beim Spielstart aus dem Ordner `heldix-addons` deiner Instanz lädt. Du programmierst dabei nur gegen die **Heldix-API**. Sie enthält bewusst nichts aus Minecraft – deshalb läuft dieselbe Addon-JAR auch nach einem Minecraft-Update einfach weiter.

## Addon oder Mod?

HeldixClient kennt zwei Arten von Erweiterungen:

- **Heldix-Addon** (Ordner `heldix-addons`): sieht nur die Heldix-API und läuft mit derselben JAR über Minecraft-Updates hinweg. Macht ein Addon Fehler, wird nur das Addon abgeschaltet – das Spiel läuft weiter.
- **Heldix-Mod** (Ordner `mods`): hat Zugriff auf ganz Minecraft und kann mit eigenen Transformern in Minecraft-Klassen eingreifen. Dafür muss sie für jede Minecraft-Version neu gebaut werden, und ein Fehler beim Start beendet das Spiel mit einem Crash-Report.

Für HUD-Anzeigen, eigene Tasten, Einblendungen und kleine Helfer reicht fast immer ein Addon. Wie Mods funktionieren, steht unter [Heldix-Mods mit dem Heldix Loader](/entwickler/heldix-mods).

## Aufbau eines Addons

Ein Addon besteht aus genau zwei Teilen:

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
- `entrypoint` – der volle Klassenname deiner Addon-Klasse, also mit Paket.
- `api` – die API-Stufe, für die du das Addon gebaut hast (siehe unten). Das Feld ist Pflicht: Fehlt es, lädt HeldixClient das Addon nicht.

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

Die aktuelle API-Stufe ist **2** (Konstante `HeldixApi.API_VERSION`, Stand HeldixClient 0.12.1). HeldixClient lädt Addons, die für API 1 oder API 2 gebaut sind.

- **API 1:** Module und HUD-Module, Ereignisse (Tick, Welt betreten und verlassen, Chat), Spielerdaten, lokale Chatnachrichten, eigene Einstellungen mit `api.config()` und ein Logger.
- **API 2** (ab HeldixClient 0.11.0): eigene Tasten, Einblendungen oben rechts, Einstellungen im Untermenü eines Moduls, Icons für Module, Bilder, Heldix-Schrift und abgerundete Flächen im HUD sowie ein eigener Datenordner.

Neue Stufen erweitern die API nur. Ein Addon für API 1 läuft deshalb unverändert weiter. Ein Addon, das eine höhere Stufe verlangt, als der installierte HeldixClient kennt, wird mit dem Hinweis „bitte HeldixClient aktualisieren“ übersprungen.

Trag in `api` die höchste Stufe ein, deren Funktionen du benutzt. In den API-Klassen sind alle Funktionen der Stufe 2 mit `@since 2` gekennzeichnet. Das Beispiel oben nutzt `registerKey`, `notify`, `addToggle` und `withIcon` und braucht deshalb `"api": 2`.

> **Hinweis:** Die API-Datei hat eine eigene Versionsnummer (derzeit `heldix-api-1.0.0.jar`). Für die Kompatibilität zählt allein die API-Stufe im Feld `api`.

## Bauen mit Gradle

Du brauchst ein JDK 21 oder neuer. Die mitgelieferten Addons werden für Java 21 gebaut; das reicht für alle Funktionen der API.

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

## Vorlagen aus dem Launcher

Der Launcher bringt zwei Addons mit, die gleichzeitig gute Vorlagen sind:

- **Uhrzeit & Spielzeit** (`uhrzeit`): zwei HUD-Module, ein Schalt-Modul für eine Begrüßung im Chat, eine Einstellung „Sekunden“ und ein Zähler mit `api.config()`.
- **Spotify** (`spotify`): eigene Tasten, mehrere Einstellungen, ein selbst gezeichnetes HUD-Element mit Album-Cover, Einblendungen beim Songwechsel und ein Hintergrund-Prozess, der nur läuft, solange das Modul an ist.

Ausschnitte aus beiden findest du unter [Addon-API im Detail](/entwickler/addon-api).
