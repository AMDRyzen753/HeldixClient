# Entwicklung

## Voraussetzungen

- Windows
- [Node.js](https://nodejs.org) 22 oder neuer
- JDK 25, z. B. [Temurin](https://adoptium.net). Alternativ ein entpacktes JDK unter `.tools/jdk-25/` im Projektordner; das nutzen die Skripte automatisch.

## Bauen und starten

```powershell
cd launcher
npm install
npm run mod      # baut Heldix Loader, Client-Mod und Addons und legt sie in resources/ ab
npm start        # baut und startet den Launcher im Entwicklungsmodus
npm run dist     # Java-Teile + Launcher bauen und Installer erzeugen
```

Das Ergebnis von `npm run dist` liegt in `launcher/release/`:
- `HeldixClient-Setup-<version>.exe` ist der Installer.
- `win-unpacked/` enthält eine direkt startbare Version ohne Installation.

Weitere Hinweise:
- Das Logo (Sechseck mit „H“) steht in [logo.svg](../launcher/src/renderer/logo.svg). `npm run icon` erzeugt daraus App-Icon (`launcher/build/icon.png`), Discord-Bild, Mod-Icon, `pack.png` und den Schriftzug für den Ladebildschirm; `npm run ui-assets` das Logo für die Oberfläche im Spiel. Nach einer Änderung am Logo das Discord-Bild neu hochladen (siehe [einrichtung.md](einrichtung.md)).
- Im Entwicklungsmodus gehen **Offline-Konten** immer. Damit lässt sich ohne Microsoft-Login testen. In der fertig gepackten App gibt es sie erst, wenn ein Microsoft-Konto mit Minecraft im Launcher ist (wie bei Prism Launcher). Wer das Spiel nicht gekauft hat, kann also nicht spielen.
- Die Java-Projekte in `mod/` lassen sich in IntelliJ IDEA als Gradle-Projekt öffnen (JDK 25 auswählen).
- Minecraft lädt Gradle zum Kompilieren selbst von Mojang ([gradle/minecraft.gradle](../mod/gradle/minecraft.gradle)). Die Dateien landen in `mod/.gradle/minecraft/` und sind vom Git ausgeschlossen.

## Entwickleroptionen in der fertigen App

In der installierten .exe gibt es Offline-Konten normalerweise erst mit einem Microsoft-Konto. Für die eigene Entwicklung (z. B. solange Mojang die App noch nicht freigeschaltet hat) gibt es **Einstellungen → Entwickler → Entwickleroptionen**. Sie schalten Offline-Konten ohne Microsoft-Konto frei, aber nur auf PCs mit einem **Entwickler-Schlüssel**:

```powershell
cd launcher
npm run dev-key                                  # Schlüssel für diesen PC (beim ersten Mal entsteht das Schlüsselpaar)
npm run dev-key -- --name=Max --pc=3F2A-91C0-7B44-E0D1   # Schlüssel für einen anderen PC
npm run dist                                     # nur nötig, wenn das Schlüsselpaar neu ist
```

**Automatisch:** Liegt der Signaturschlüssel auf dem PC, erstellt der Launcher den Entwickler-Schlüssel selbst, sobald man die Entwickleroptionen einschaltet. Auf weiteren eigenen PCs einmal **„Schlüssel importieren …“** klicken und `signing-key.pem` auswählen (z. B. vom USB-Stick); danach geht es dort ebenfalls automatisch. Wer den Signaturschlüssel nicht bekommen soll, bekommt eine mit `--pc` ausgestellte Schlüsseldatei und importiert sie genauso.

- Der private Schlüssel liegt in `%USERPROFILE%\.heldixclient-dev\signing-key.pem`. Nur auf eigene PCs kopieren, nie weitergeben, nicht einchecken, gut sichern.
- Der öffentliche Schlüssel steht in [src/main/dev-public-key.ts](../launcher/src/main/dev-public-key.ts) und kommt mit in die .exe.
- Ein Entwickler-Schlüssel (`developer.key` im Datenordner des Launchers) gilt nur für den PC, dessen Kennung er enthält. Die Kennung steht in der Entwickler-Karte. Sie ist ein Hash der Windows-MachineGuid; die GUID selbst wird nirgends gespeichert.
- Wer die App aus dem Quellcode selbst baut, erzeugt mit `npm run dev-key` sein eigenes Schlüsselpaar. Schlüssel aus einem anderen Build gelten dann nicht.

## Testen

```powershell
cd launcher
npm run test:launch -- 26.3 heldix              # startet offline mit Heldix Loader, HeldixClient + Addon, beendet nach dem Laden
npm run test:launch -- 26.3 heldix --autotest   # zusätzlich der komplette Test im Spiel, mit Screenshots
npm run test:launch -- 26.3 heldix --autotest --graphics=opengl   # derselbe Test mit OpenGL statt Vulkan
npm run test:launch -- 26.3 heldix --benchmark=25 --graphics=vulkan   # FPS-Messung (25 s), siehe unten
npm run test:launch -- 26.3 fabric --autotest --perf   # Autotest in Fabric: HeldixClient + Leistungs-Paket
npm run test:launch -- 26.3 fabric --autotest --shaderpack=an   # dazu ein installiertes Iris-Shaderpack einschalten
npm run test:launch -- 26.3 heldix "--world=Meine Welt"   # Direktstart (Quick Play) in eine Welt aus saves/
npm run test:launch -- 26.3 fabric              # nur Fabric, ohne HeldixClient
npm run test:launch -- 1.8.9 vanilla
npm run test:discord -- <Application-ID>       # Discord-Status, Discord muss laufen
```

Der Starttest bricht mit Fehler ab, wenn:

- das Spiel abstürzt;
- ein Eingriff des Loaders oder einer Mod fehlschlägt;
- Loader, HeldixClient oder das Beispiel-Addon nicht geladen werden;
- HeldixClient keinen Status für Discord meldet (Hauptmenü, im Autotest auch Einzelspieler);
- eine Fabric- oder Vanilla-Instanz fälschlich den Heldix Loader lädt.

**Der Autotest** ([mod/autotest](../mod/autotest)) ist eine Heldix-Mod, die nur mit `-Dheldix.autotest=true` aktiv wird. Er:

- prüft Loader, Übersetzungen, Tasten, Fenstertitel und Addons, auch ein absichtlich kaputtes Addon und eine Fabric-Attrappe im `mods`-Ordner;
- prüft die Startseite (Seitenleiste, Schnellstart-Karten) und klickt über die echte Maus-Verarbeitung von Minecraft das Heldix-Menü auf vier Wegen an;
- erstellt eine flache Testwelt und prüft darin HUD, Chat- und Welt-Events und den Zoom;
- prüft im HUD-Editor Verschieben, Auswählen, Skalieren über den Griff, Pfeiltasten, Ausblenden mit Entf, Rückgängig (Strg+Z), Rechtsklick zu den Einstellungen und die Elemente-Liste, im Hauptmenü auch die Vorschau ohne Welt;
- prüft, dass Minecrafts Einzel- und Mehrspieler-Menü sowie das Pausemenü durch die Heldix-Seiten ersetzt werden (Testwelt und Testserver in der Liste) und die klassischen Ansichten Vanilla bleiben;
- lädt die Ressourcen neu und fotografiert dabei den Heldix-Ladebildschirm;
- öffnet das Untermenü eines Moduls über das Regler-Symbol und prüft die Einstellung „Größe“ am HUD;
- prüft Ressourcen der Mod, alle Farbstile und die Shader-Engine (werden sie wirklich gezeichnet?), die F3-Zeilen, FPS-Boost (an und wieder zurück) und die Hintergrund-FPS;
- prüft, dass Minecraft die gewünschte Grafik-API benutzt (`--graphics=vulkan|opengl|default`, Standard wie im Launcher: Vulkan);
- macht Screenshots aller Menüs (`--size=1920x1080 --gui-scale=2` prüft große Fenster). Sie liegen danach unter `%APPDATA%\.heldixclient\test-instances\26.3-heldix-autotest\screenshots`.

Während der Autotest läuft, die Maus nicht über das Spielfenster bewegen.

**Der Benchmark** (`--benchmark[=Sekunden]`) erstellt immer dieselbe Welt (Seed `heldix-benchmark`), setzt die Kamera 40 Blöcke über das Gelände und dreht sie während der Messung einmal im Kreis: Sichtweite 12, keine FPS-Grenze, kein VSync, 1600×900. Ausgabe: `BENCHMARK backend=Vulkan avg=… low1=…` (Durchschnitt und 1-%-Tiefs). Weitere Schalter: `--shader=kino`, `--engine=dezent|kraeftig` (Shader-Engine), `--boost` (FPS-Boost), `--no-tuning` (ohne JVM-Abstimmung), `--size=1920x1080`. Mehrere Läufe machen, die Werte schwanken um gut 10 %.

Bei jedem Push baut GitHub Actions alles einmal komplett ([.github/workflows/build.yml](../.github/workflows/build.yml)). Die Spieltests laufen dort nicht, weil sie ein Fenster mit Grafikkarte brauchen.

## Releases

1. Die Version an drei Stellen anheben:
   - `version` in [launcher/package.json](../launcher/package.json)
   - `LAUNCHER_VERSION` in [config.ts](../launcher/src/main/config.ts)
   - `mod_version` in [mod/gradle.properties](../mod/gradle.properties)
2. Committen und einen Tag setzen, z. B. `git tag v0.7.0`, dann `git push --tags`.
3. GitHub Actions baut den Installer und hängt ihn an ein neues Release.

## Die Client-Mod erweitern

**Neues Modul:** eine Klasse in `mod/src/main/java/dev/heldixclient/module/impl/` anlegen, die von `Module` erbt (bzw. von `HudModule` für HUD-Elemente), und sie in `ModuleManager.init()` registrieren. Sie erscheint dann automatisch im Heldix-Menü.

**Wie das Menü-Design funktioniert**

- [HeldixPatches](../mod/src/main/java/dev/heldixclient/transform/HeldixPatches.java) setzt an der Stelle an, an der Minecraft Widget-Grafiken zeichnet (`widget/button`, `widget/text_field`, `textures/gui/menu_background.png` …).
- [WidgetStyle](../mod/src/main/java/dev/heldixclient/ui/WidgetStyle.java) zeichnet stattdessen das Heldix-Design. Dadurch sehen auch Menüs anderer Mods passend aus, und die Funktionen bleiben die von Minecraft.
- [Ui](../mod/src/main/java/dev/heldixclient/ui/Ui.java) zeichnet das eigene Design: Text in der Schrift Inter (je GUI-Skalierung eine eigene Schriftdefinition, dadurch scharf), abgerundete Flächen, Rahmen und Schatten in echten Bildschirmpixeln (kantengeglättete Ecken aus einer Grafik statt Minecraft-Pixeln) und Icons. Bilder wie Icons und Hintergrund lädt es mit weicher (linearer) Filterung.
- Die Grafiken erzeugt `npm run ui-assets` ([render-ui-assets.mjs](../launcher/scripts/render-ui-assets.mjs)): Icon-Set (SVG im Skript, 64 und 32 px), Ecken-Atlas, Schatten, Hintergrund und Logo sowie die Schriftdefinitionen. Dieselben Icons schreibt es nach [ui-icons.ts](../launcher/src/renderer/ui-icons.ts) für den Launcher; dort füllt `hydrateIcons()` alle `<svg data-icon="name">` im HTML. Die Schrift Inter kopiert der Launcher-Build aus der Client-Mod. Neue Icons dort eintragen und das Skript ausführen; im Code dann `Ui.icon(g, "name", x, y, größe, farbe)`.
- Alle Heldix-Seiten teilen sich eine Oberfläche: [Shell](../mod/src/main/java/dev/heldixclient/ui/Shell.java) zeichnet Seitenleiste und Hintergrund und öffnet die Seiten, [ShellScreen](../mod/src/main/java/dev/heldixclient/screen/ShellScreen.java) ist die Basis mit Kopfzeile und Inhaltsfläche. Darauf bauen [WorldsScreen](../mod/src/main/java/dev/heldixclient/screen/WorldsScreen.java), [ServersScreen](../mod/src/main/java/dev/heldixclient/screen/ServersScreen.java) und [HeldixMenuScreen](../mod/src/main/java/dev/heldixclient/screen/HeldixMenuScreen.java) auf.
- Das Hauptmenü baut [HeldixTitle](../mod/src/main/java/dev/heldixclient/screen/HeldixTitle.java) neu auf. Technisch bleibt es ein `TitleScreen`.
- Ein Eingriff in `Gui.setScreen` ersetzt Minecrafts `SelectWorldScreen`, `JoinMultiplayerScreen` und `PauseScreen` durch die Heldix-Seiten, auch wenn andere Mods oder Minecraft selbst sie öffnen (z. B. „Zurück zur Serverliste“). „Klassische Ansicht“ öffnet das Vanilla-Menü über `Shell.openVanilla`, das nie ersetzt wird. Mit „Heldix-Design für Menüs“ aus bleibt alles Vanilla.

<img src="images/spiel-einzelspieler.png" width="600" alt="Einzelspieler-Seite von HeldixClient">

*Die Einzelspieler-Seite: Weltenliste mit Suche, Aktionen direkt in der ausgewählten Zeile.*

<img src="images/ui-icons.png" width="600" alt="Icon-Set von HeldixClient">

*Das Icon-Set (`docs/images/ui-icons.png` erzeugt das Skript mit).*

**Farben:** Launcher und Spiel nutzen dieselbe Akzentfarbe (Blau). Sie stehen als CSS-Variablen in [styles.css](../launcher/src/renderer/styles.css) (Launcher), in [Ui.java](../mod/src/main/java/dev/heldixclient/ui/Ui.java) (Oberfläche im Spiel) und in [Theme.java](../mod/src/main/java/dev/heldixclient/ui/Theme.java) (HUD, F3-Menü, Ladebildschirm). Das Hintergrundbild des Launchers erzeugt `node scripts/render-background.mjs`.

## Mehrere Minecraft-Versionen

- Der **Launcher** startet jede Version aus Mojangs Liste. Fabric-Instanzen gibt es ab 1.14, alte Versionen mit Natives (z. B. 1.8.9) funktionieren ebenfalls.
- Die **Client-Mod** wird pro Minecraft-Version gebaut. Der Launcher erkennt die passende JAR am Dateinamen (`heldixclient-<modversion>+<minecraft>.jar`). Versionen mit Mod stehen in der Versionsauswahl mit dem Schild „HELDIX“.
- **Für eine weitere Version:** in `mod/gradle.properties` den Wert `minecraft_version` ändern, Kompilierfehler beheben, `npm run mod` ausführen und mit dem Autotest prüfen. Er meldet jeden Eingriff, der nicht mehr greift.

## Instanzen und Datenordner

Spieldaten liegen unter `%APPDATA%\.heldixclient`:

| Ordner | Inhalt |
| --- | --- |
| `versions/`, `libraries/`, `assets/` | Minecraft-Dateien wie beim offiziellen Launcher; der Heldix Loader liegt unter `libraries/dev/heldixclient/` |
| `runtime/` | Java-Laufzeiten von Mojang (Java 8/17/21/25, je nach Version automatisch) |
| `instances/<id>/` | eine Instanz: `heldix-instance.json`, Welten, Einstellungen, `mods/`, `heldix-addons/` |
| `launcher-settings.json`, `launcher-accounts.json` | Einstellungen und Konten; Tokens per Windows-DPAPI verschlüsselt |
| `test-instances/` | Spielordner der Tests |

Mit der Umgebungsvariable `HELDIX_DATA_DIR` lässt sich ein anderer Datenordner nutzen, z. B. zum Testen.

**Verwaltete Dateien:** Dateien mit Schloss-Symbol verwaltet der Launcher selbst und aktualisiert sie bei jedem Start. Das sind die HeldixClient-Mod in Heldix-Instanzen sowie Fabric API, Heldix Loader (Fabric) und HeldixClient in Fabric-Instanzen.

**Ältere Versionen:**
- Heldix-Instanzen aus Version 0.5 liefen noch auf Fabric. Beim ersten Start mit 0.6 entfernt der Launcher die alte Fabric API und die Fabric-Version der Mod automatisch. Welten und Einstellungen bleiben.
- Gelöschte Instanzen landen im Papierkorb.

## Wo der Name steht

Falls der Name noch einmal geändert werden soll:

- **Launcher:** [config.ts](../launcher/src/main/config.ts) (Name, Datenordner, Mod-Präfix), `productName`/`appId` in `launcher/package.json`, Texte in [index.html](../launcher/src/renderer/index.html)
- **Mod:** `archives_base_name`/`maven_group` in `gradle.properties`, `id`/`name` in `heldix.mod.json`, `MOD_ID`/`NAME` in `HeldixClient.java`, Paket `dev.heldixclient`, Sprachdateien unter `assets/heldixclient/lang`

## Ideen für später

- **Code-Signatur** für den Installer, damit SmartScreen nicht mehr warnt
- **Auto-Update** für Launcher, Loader und Mod über GitHub Releases
- **Weitere Module oder Addons:** Armor-Status, Potion-HUD, eigene Crosshairs, Freelook
- **Mod- und Addon-Katalog** im Launcher, ähnlich wie Fabric-Mods über Modrinth
- **Shaderpacks** im Stil von OptiFine/Iris (Schatten, Reflexionen) bräuchten einen eigenen Renderer; die eingebauten Stile sind Post-Effekte
- **Kosmetik** wie Capes braucht einen eigenen Server, der Spieler und Kosmetik zuordnet
