---
titel: Heldix-Addons schreiben
beschreibung: Was ein Heldix-Addon ist, wie es aufgebaut ist, wie du in wenigen Minuten dein erstes eigenes Addon baust und wie es in den Addon-Store kommt.
reihenfolge: 1
stichworte: addon, api, heldix.addon.json, onEnable, onDisable, gradle, einstieg, beispiel, addon-store, veröffentlichen, einreichen, community, prüfung, regeln, screenshots
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

Die aktuelle API-Stufe ist **3** (Konstante `HeldixApi.API_VERSION`, Stand HeldixClient 0.13.1). HeldixClient lädt Addons, die für API 1, 2 oder 3 gebaut sind.

- **API 1:** Module und HUD-Module, Ereignisse (Tick, Welt betreten und verlassen, Chat), Spielerdaten, lokale Chatnachrichten, eigene Einstellungen mit `api.config()` und ein Logger.
- **API 2** (ab HeldixClient 0.11.0): eigene Tasten, Einblendungen oben rechts, Einstellungen im Untermenü eines Moduls, Icons für Module, Bilder, Heldix-Schrift und abgerundete Flächen im HUD sowie ein eigener Datenordner.
- **API 3** (ab HeldixClient 0.13.1): weitere Ereignisse mit Abmeldung (Server, Menüs, Tod, Dimension, Leben), Spiel- und Spielerdaten (`game()`, `playerState()`), ein Scheduler für Aufgaben im Haupt-Thread und im Hintergrund, Chat-Befehle „.name“, Chat an den Server als Aktion des Spielers, Regler, Farbwahl und Textfelder als Einstellungen und neue Zeichenhilfen im HUD. Mehr unter [Ab API 3](/entwickler/addon-api#ab-api-3).

Neue Stufen erweitern die API nur. Ein Addon für API 1 läuft deshalb unverändert weiter. Ein Addon, das eine höhere Stufe verlangt, als der installierte HeldixClient kennt, wird mit dem Hinweis „bitte HeldixClient aktualisieren“ übersprungen.

Trag in `api` die höchste Stufe ein, deren Funktionen du benutzt. In den API-Klassen sind die Funktionen der Stufen 2 und 3 mit `@since 2` bzw. `@since 3` gekennzeichnet. Das Beispiel oben nutzt `registerKey`, `notify`, `addToggle` und `withIcon` und braucht deshalb `"api": 2`.

> **Hinweis:** Die API-Datei hat eine eigene Versionsnummer (derzeit `heldix-api-1.0.0.jar`). Für die Kompatibilität zählt allein die API-Stufe im Feld `api`.

## Bauen mit Gradle

Du brauchst ein JDK 21 oder neuer. Die Addons des Teams werden für Java 21 gebaut; das reicht für alle Funktionen der API.

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

Im [Addon-Store](/addons) stehen **offizielle** Addons des Teams und **Community**-Addons von Spielern. Jede Version ist mit dem Schlüssel des Teams signiert; Launcher und Spiel installieren nichts ohne gültige Signatur. Addons sind Code, der im Spiel läuft – deshalb prüft das Team jedes Addon, bevor es in den Store kommt.

### Ablauf

1. **Anmelden:** Öffne den [Konto-Bereich](/konto#addons) auf heldixclient.com – angemeldet wirst du über den Launcher oder im Spiel, ohne Passwort.
2. **JAR hochladen:** Unter **Meine Addons → Addon einreichen** wählst du die fertige JAR aus `build/libs` (höchstens 50 MB). Der Dienst liest daraus die `heldix.addon.json` (ID, Version, Name, Autoren, API-Stufe) und durchsucht die Klassendateien nach Zugriffen, die sich das Team genauer ansieht. Ausgeführt wird dabei nichts.
3. **Store-Angaben:** Name, Kurzbeschreibung (vorbelegt mit `description` aus der `heldix.addon.json`), eine längere Beschreibung in Klartext, die Kategorie (HUD, Musik & Medien, Chat & Freunde, Werkzeuge oder Sonstiges), ein Icon aus dem Heldix-Icon-Set (wie bei `withIcon`), die Systeme, auf denen das Addon läuft, und ein paar Stichpunkte, was neu ist.
4. **Screenshots:** bis zu vier Bilder, PNG oder JPEG, je höchstens 2 MB und zwischen 320 × 180 und 3840 × 2160 Pixeln. Am besten zeigst du das Addon im Spiel, im Format 16:9.
5. **Einreichen:** Regeln bestätigen und **Zur Prüfung einreichen** wählen. Solange das Team prüft, lässt sich nichts ändern – zurückziehen geht jederzeit.

Der Assistent speichert deine Angaben als Entwurf. Du kannst ihn schließen und später unter **Meine Addons** weitermachen.

### Regeln

- **Nur die Heldix-API.** Addons greifen nicht auf Minecraft-Klassen (`net.minecraft`) zu, laden keinen Code nach und bringen keine eigenen Mixins oder Transformer mit. Was die API nicht kann, gehört in eine [Heldix-Mod](/entwickler/heldix-mods) – die kommt nicht in den Store.
- **Kein Schadcode.** Keine Programme starten, keinen nativen Code laden, keine Daten sammeln oder verschicken, ohne dass es in der Beschreibung steht. Braucht dein Addon Internet oder Dateien, schreib dort, wofür. Eigene Daten gehören in den Datenordner des Addons.
- **Eigene Rechte.** Code, Bilder, Namen und Screenshots sind von dir, oder du darfst sie verwenden – etwa unter einer passenden Lizenz. Keine fremden Marken oder Logos als Name, Icon oder Bild.
- **Ehrliche Angaben.** Beschreibung und Screenshots zeigen, was das Addon wirklich tut. Nichts Anstößiges, keine Werbung.
- **IDs und Versionen.** Eine Addon-ID gehört dem, der sie zuerst einreicht; die IDs offizieller Addons sind gesperrt. Jede neue Version braucht eine höhere Versionsnummer als die veröffentlichte, und eine veröffentlichte Version lässt sich nicht ersetzen.

### Die Prüfung

Das Team lädt die JAR herunter, sieht sich den Code an und prüft Texte, Icon und Screenshots. Dabei helfen die Prüf-Hinweise aus der JAR – die siehst du schon beim Hochladen:

- **Rot – fast immer eine Ablehnung:** Programme starten (`ProcessBuilder`, `Runtime`), nativer Code (`System.loadLibrary`, `java.lang.foreign`) und Minecraft-Klassen (`net.minecraft`).
- **Gelb – erlaubt, wenn es passt:** Netzwerk (`java.net`), Dateien (`java.io.File`, `java.nio.file`) und Reflection (`java.lang.reflect`). Erklär in der Beschreibung, wofür dein Addon das braucht.

Die Hinweise kommen aus einer groben Suche in den Klassendateien und sind noch kein Urteil. Die Prüfung dauert meist ein paar Tage. Gibt ein Admin das Addon frei, signiert er im Team-Bereich genau das Manifest, das der Dienst für deine Einreichung erzeugt hat – als Community-Addon mit dir als Entwickler. Ab dann steht es auf der Webseite, im Launcher und im Spiel. Den Stand siehst du unter **Meine Addons**; ändert er sich, während die Seite offen ist, bekommst du sofort Bescheid.

### Wenn das Team ablehnt

Unter **Meine Addons** steht dann die Begründung des Teams. Mit **Überarbeiten** öffnest du die Einreichung wieder: Angaben ändern, bei Bedarf eine neue JAR hochladen – solange die Version noch nicht veröffentlicht ist, darf es dieselbe Versionsnummer sein – und erneut einreichen. Abgelehnte und zurückgezogene Einreichungen löscht der Dienst nach 90 Tagen. Fragen zur Ablehnung beantwortet das Team über eine [Support-Anfrage](/konto#ziel=support).

### Nach der Veröffentlichung

- Im Store steht dein Addon mit dem Abzeichen **Community** und deinem Spielernamen als Entwickler. Der Name führt zu deiner Entwicklerseite mit all deinen Addons.
- Downloads und Bewertungen siehst du unter **Meine Addons**. Dort reichst du mit **Neue Version einreichen** auch Updates ein – gleiche ID, höhere Versionsnummer.
- Spieler können ein Addon melden. Das Team kann es dann aus dem Store nehmen; wer es installiert hat, behält es.

> **Hinweis:** Spielername und UUID stehen im signierten Manifest jeder veröffentlichten Version und lassen sich dort nicht mehr ändern. Löschst du später deine Daten beim Heldix-Dienst, bleibt das Addon im Store, als Entwickler steht dann „Gelöschter Spieler“. Mehr dazu in der [Datenschutzerklärung](/datenschutz).

## Vorlagen

Zwei Addons des Teams sind gleichzeitig gute Vorlagen. Beide gibt es im [Addon-Store](/addons):

- **Uhrzeit & Spielzeit** (`uhrzeit`): zwei HUD-Module, ein Schalt-Modul für eine Begrüßung im Chat, eine Einstellung „Sekunden“ und ein Zähler mit `api.config()`.
- **Spotify** (`spotify`): eigene Tasten, mehrere Einstellungen, ein selbst gezeichnetes HUD-Element mit Album-Cover, Einblendungen beim Songwechsel und ein Hintergrund-Prozess, der nur läuft, solange das Modul an ist.

Ausschnitte aus beiden findest du unter [Addon-API im Detail](/entwickler/addon-api).
