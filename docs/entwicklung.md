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
- Das App-Icon kommt aus `launcher/build/icon.png`. `npm run icon` erzeugt es neu aus [logo.svg](../launcher/src/renderer/logo.svg).
- Im Entwicklungsmodus gibt es zusätzlich **Offline-Konten (Dev)**. Damit lässt sich ohne Microsoft-Login testen. In der fertig gepackten App sind sie gesperrt.
- Die Java-Projekte in `mod/` lassen sich in IntelliJ IDEA als Gradle-Projekt öffnen (JDK 25 auswählen).
- Minecraft lädt Gradle zum Kompilieren selbst von Mojang ([gradle/minecraft.gradle](../mod/gradle/minecraft.gradle)). Die Dateien landen in `mod/.gradle/minecraft/` und sind vom Git ausgeschlossen.

## Testen

```powershell
cd launcher
npm run test:launch -- 26.3 heldix              # startet offline mit Heldix Loader, HeldixClient + Addon, beendet nach dem Laden
npm run test:launch -- 26.3 heldix --autotest   # zusätzlich der komplette Test im Spiel, mit Screenshots
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
- klickt über die echte Maus-Verarbeitung von Minecraft das Heldix-Menü auf vier Wegen an;
- erstellt eine flache Testwelt und prüft darin HUD, Chat- und Welt-Events, das Verschieben im HUD-Editor und den Zoom;
- macht Screenshots aller Menüs. Sie liegen danach unter `%APPDATA%\.heldixclient\test-instances\26.3-heldix-autotest\screenshots`.

Während der Autotest läuft, die Maus nicht über das Spielfenster bewegen.

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
- Das Hauptmenü baut [HeldixTitle](../mod/src/main/java/dev/heldixclient/screen/HeldixTitle.java) neu auf. Technisch bleibt es ein `TitleScreen`.

<img src="images/spiel-einzelspieler.png" width="600" alt="Vanilla-Menü „Welt auswählen“ im Heldix-Design">

*Das normale Minecraft-Menü „Welt auswählen“, gezeichnet im Heldix-Design.*

**Design „Glas“:** Die Farben sind an zwei Stellen definiert und sollten übereinstimmen: als CSS-Variablen in [styles.css](../launcher/src/renderer/styles.css) (Launcher) und in [Theme.java](../mod/src/main/java/dev/heldixclient/ui/Theme.java) (im Spiel). Das Hintergrundbild des Launchers erzeugt `node scripts/render-background.mjs`.

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

**Verwaltete Dateien:** Dateien mit Schloss-Symbol verwaltet der Launcher selbst und aktualisiert sie bei jedem Start. Das sind die HeldixClient-Mod in Heldix-Instanzen und die Fabric API in Fabric-Instanzen.

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
- **Ressourcen aus Mods:** Der Loader liefert bisher nur Übersetzungen aus Mod-JARs; eigene Texturen und Sounds bräuchten ein Ressourcenpaket pro Mod
- **Kosmetik** wie Capes braucht einen eigenen Server, der Spieler und Kosmetik zuordnet
