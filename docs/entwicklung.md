# Entwicklung

## Voraussetzungen

- Windows, für die Mac-App macOS (oder GitHub Actions, siehe unten)
- [Node.js](https://nodejs.org) 22 oder neuer
- JDK 25, z. B. [Temurin](https://adoptium.net). Alternativ ein entpacktes JDK unter `.tools/jdk-25/` im Projektordner; das nutzen die Skripte automatisch.

## Bauen und starten

```powershell
cd launcher
npm install
npm run mod      # baut Heldix Loader und Client-Mod und legt sie in resources/ ab (Addons: npm run addon -- <id>)
npm start        # baut und startet den Launcher im Entwicklungsmodus
npm run dist     # Java-Teile + Launcher bauen und Installer erzeugen
```

### macOS

`npm run dist:mac` geht nur auf einem Mac (electron-builder braucht dafür macOS). Ohne Mac baut GitHub Actions die App bei jedem Push im Job „macOS-App bauen“; das Ergebnis liegt als Artefakt `HeldixClient-macOS` am Lauf, bei einem Tag wie `v0.13.0` auch im Release.

- Ergebnis: `HeldixClient-<version>-mac-arm64.dmg`/`.zip` (Apple Silicon) und `HeldixClient-<version>-mac-x64.dmg`/`.zip` (Intel).
- **Veröffentlichen:** die Mac-Dateien (aus dem Artefakt von GitHub Actions oder vom Mac) im Team-Bereich der Webseite unter „Updates“ hochladen. Der Heldix-Dienst liefert sie unter `/v1/launcher/download/latest/mac-arm64` bzw. `mac-x64` aus, die Download-Seite zeigt Größe und SHA-256. GitHub wird dafür nicht gebraucht (das Repository kann privat sein; GitHub Actions kostet für private Repositories allerdings Minuten, macOS-Minuten zählen zehnfach).
- **Signatur:** ad-hoc (`identity: "-"`), ohne Apple-Entwicklerkonto. Das reicht, damit die App auf Apple Silicon startet; Gatekeeper fragt beim ersten Start trotzdem nach. Für eine beglaubigte App (keine Warnung) braucht es ein Apple-Developer-Konto (99 USD im Jahr), ein „Developer ID Application“-Zertifikat und Notarisierung; electron-builder übernimmt beides, wenn `CSC_LINK`/`CSC_KEY_PASSWORD` und `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` gesetzt sind und `identity` aus der Konfiguration entfernt wird.
- **Was auf dem Mac anders ist:** Ampel-Knöpfe statt eigener Fensterknöpfe und ein App-Menü (für ⌘C/⌘V/⌘Q); kein Vulkan (`graphicsArguments` gibt auf dem Mac nichts vor); der Updater meldet neue Versionen nur (`downloadInstaller: false`) und schickt zur Download-Seite, weil das Update-Manifest den Windows-Installer beschreibt; die PC-Kennung für Entwickler-Schlüssel kommt aus `IOPlatformUUID`. Java (`mac-os-arm64`/`mac-os`), die macOS-Natives und `-XstartOnFirstThread` kommen wie beim offiziellen Launcher aus Mojangs Daten.
- Getestet werden kann die Mac-App nur auf einem Mac; die Spieltests (`npm run test:launch`) laufen dort genauso.

Das Ergebnis von `npm run dist` liegt in `launcher/release/`:
- `HeldixClient-Setup-<version>.exe` ist der Installer.
- `win-unpacked/` enthält eine direkt startbare Version ohne Installation.

Weitere Hinweise:
- Das Logo (Sechseck mit „H“) steht in [logo.svg](../launcher/src/renderer/logo.svg). `npm run icon` erzeugt daraus App-Icon (`launcher/build/icon.png`), Discord-Bild, Mod-Icon, `pack.png` und den Schriftzug für den Ladebildschirm; `npm run ui-assets` das Logo für die Oberfläche im Spiel. Nach einer Änderung am Logo das Discord-Bild neu hochladen (siehe [einrichtung.md](einrichtung.md)).
- **Offline-Konten** gibt es nur im Entwicklungsmodus (`npm start`). Damit lässt sich ohne Microsoft-Login testen. Die fertig gepackte App kennt keine Offline-Konten: Gespielt wird mit dem Microsoft-Konto, mit dem Minecraft gekauft wurde; alte Offline-Konten aus früheren Versionen blendet sie aus.
- Die Java-Projekte in `mod/` lassen sich in IntelliJ IDEA als Gradle-Projekt öffnen (JDK 25 auswählen).
- Minecraft lädt Gradle zum Kompilieren selbst von Mojang ([gradle/minecraft.gradle](../mod/gradle/minecraft.gradle)). Die Dateien landen in `mod/.gradle/minecraft/` und sind vom Git ausgeschlossen.

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
npm run test:crash                             # Absturz-Hilfe: Ursachen-Erkennung mit nachgebauten Crash-Reports
npm run test:social / test:profile / test:store   # Freunde, Skins & Capes, Addon-Store (gegen lokalen Dienst bzw. Attrappen)
npm run test:accounts-ipc                      # Kontowechsel im Spiel: Protokoll über stdin/stdout mit einem nachgebauten Spiel
```

**Absturz-Hilfe** ([core/crash.ts](../launcher/src/main/core/crash.ts)): Nach einem Absturz (Fehlercode, neuer Crash-Report oder `hs_err_pid*.log`, nicht nach „Spiel beenden“) erkennt der Launcher häufige Ursachen (RAM, Grafiktreiber, OpenGL, Java-Version, Mod-Konflikte per Mixin, fehlende Abhängigkeiten, Mods aus dem Stacktrace über die Pakete der Mod-JARs) und zeigt Schritte mit Knopf. „An den Support senden“ legt eine Support-Anfrage an und hängt Crash-Report, JVM-Fehler und Log an – vorher sichtbar, Benutzerordner durch `~` ersetzt, Tokens entfernt. Zum Ansehen ohne echtes Spiel: `HELDIX_SCREENSHOT_CRASH=<Ordner mit crash-reports/, logs/, mods/>` zusammen mit `HELDIX_SCREENSHOT` (nur Entwicklungsmodus).

Der Starttest bricht mit Fehler ab, wenn:

- das Spiel abstürzt;
- ein Eingriff des Loaders oder einer Mod fehlschlägt;
- Loader, HeldixClient oder die Addons (frisch gebaut aus mod/addons, sonst kommen sie aus dem Addon-Store) nicht geladen werden;
- HeldixClient keinen Status für Discord meldet (Hauptmenü, im Autotest auch Einzelspieler);
- eine Fabric- oder Vanilla-Instanz fälschlich den Heldix Loader lädt.

**Der Autotest** ([mod/autotest](../mod/autotest)) ist eine Heldix-Mod, die nur mit `-Dheldix.autotest=true` aktiv wird. Er:

- prüft Loader, Übersetzungen, Tasten, Fenstertitel und Addons, auch ein absichtlich kaputtes Addon und eine Fabric-Attrappe im `mods`-Ordner;
- prüft die Startseite (Schnellstart-Karten) und klickt über die echte Maus-Verarbeitung von Minecraft das Heldix-Menü auf vier Wegen an;
- prüft die Oberfläche ([ShellTests](../mod/autotest/src/main/java/dev/heldixclient/autotest/ShellTests.java)): Bereiche und Seiten in den Leisten, Schnellschalter der Übersicht, Klick auf einen Bereich, Strg+Tab und Strg+1–4, die Schnellsuche (Treffer, Esc, Enter auf Modul, Seite und Einstellung mit Hervorhebung), Pfeile und Enter im Inhalt und das Layout in vier Fenstergrößen (alles im Fenster, nichts überlappt);
- prüft mit `--service` das Spielermenü und den Voice Chat ([VoiceTests](../mod/autotest/src/main/java/dev/heldixclient/autotest/VoiceTests.java)): eine zweite Spielerin steht vor uns, Mausrad öffnet das Menü, Name kopieren, Freund hinzufügen; sie meldet sich über die Schnittstelle beim Sprachkanal an, empfängt unseren Testton (Opus), schickt ihn zurück, Schallwellen über ihrem Kopf, Stummschalten über das Spielermenü, ihr Status (Mikrofon stumm, Ton aus) als Symbol, unser Status bei ihr mit Signalton und eine Gruppe, in der sie uns aus dem Nether ohne Position hört – ohne echtes Mikrofon;
- prüft die Tasten der Module ([KeyTests](../mod/autotest/src/main/java/dev/heldixclient/autotest/KeyTests.java)): Ein/Aus-Taste für jedes Modul, Belegen per Klick und Tastendruck, Wirkung im Spiel, Esc, Entf, ↺ und die Addon-API (`addKey` der Uhrzeit, `showKey` von Spotify, zu späte Taste);
- erstellt eine flache Testwelt und prüft darin HUD, Chat- und Welt-Events, den Zoom und die Module Rüstung, Trank-Effekte, Dauersprint/-schleichen, Freelook, Fadenkreuz, Chat und Wegpunkte (mit Todespunkt);
- mit `--service=<adresse>` zusätzlich den Heldix-Dienst im Entwicklungsmodus: Eine zweite Spielerin schickt über die Schnittstelle eine Freundschaftsanfrage, ihr Status und ihr Cape kommen an, und das Heldix-Symbol steht in der Tab-Liste;
- mit `--service=<adresse>` und dem Startsatz im Katalog (`launcher/release/cosmetics`, über `PUT /v1/team/cosmetics` veröffentlicht) die Cosmetics: Katalog geladen und geprüft (auch ein veränderter Umschlag im Zwischenspeicher, veränderte Signatur, Regeln des Formats, Palette-PNGs), Seite Cosmetics im Heldix-Menü mit Auswahl über den Dienst (Team-Cosmetics gesperrt, Meldung ohne Dienst), jedes Slot am eigenen Spieler (Anker an Kopf und Rücken, Flügelschlag, Begleiter folgt weich, Partikel begrenzt, Hut über Helm, F1/unsichtbar/Zuschauer), ein anderer Spieler mit Cosmetics und Katalog-Cape aus dem Nachschlagen (Einstellungen, `null` vom Dienst), das Inventar, die Addon-API (Vorschau, Effekte, Änderungen) und die Zeit je Bild mit 20 Spielern;
- prüft das Heldix-Symbol je Rolle (normal, Team-Admin, Moderator, Addon-Entwickler; Rollen als vorgegebene Antwort des Dienstes) vor Namen in der Tab-Liste (Teamfarbe färbt es nicht, Zeile „HeldixClient: … Spieler hier“ in der Fußzeile, nur mit Dienst) und im Namensschild über dem Kopf, auch beim Schleichen, unsichtbar, mit F1 und mit vom Server ausgeblendeten Namensschildern;
- prüft im HUD-Editor Verschieben, Auswählen, Skalieren über den Griff, Pfeiltasten, Ausblenden mit Entf, Rückgängig (Strg+Z), Rechtsklick-Menü bis zu den Einstellungen und die Elemente-Liste, im Hauptmenü auch die Vorschau ohne Welt;
- prüft das überarbeitete HUD ([HudTests](../mod/autotest/src/main/java/dev/heldixclient/autotest/HudTests.java)): die drei Stile, Deckkraft, Akzent und HUD-Größe (scharfe Schrift), Bezugspunkte über GUI-Skalierung und Fenstergröße (auch alte Positionen), Einrasten mit Hilfslinien, Mehrfachauswahl, Rahmen, Pfeiltasten, Rückgängig/Wiederholen, jede Option des Rechtsklick-Menüs (Umklappen am Rand, Tastatur), anklickbare Elemente bei offenem Chat und mit der Taste „HUD bedienen“ (beim Spielen nie), die HUD-API der Stufe 4 mit einem Test-Element und das Spotify-Addon (ohne die Musik zu steuern). Nur diese Prüfungen: ;
- prüft, dass Minecrafts Einzel- und Mehrspieler-Menü sowie das Pausemenü durch die Heldix-Seiten ersetzt werden (Testwelt und Testserver in der Liste) und die klassischen Ansichten Vanilla bleiben;
- prüft den Kontowechsel im Spiel ([AccountTests](../mod/autotest/src/main/java/dev/heldixclient/autotest/AccountTests.java), Protokoll in [konto-wechsel.md](konto-wechsel.md)): `test:launch` spielt dabei den Launcher (stdin/stdout, zwei Offline-Konten, Bestätigung automatisch, Anmeldung abgebrochen). Geprüft werden der Transformer (Felder in `Minecraft` nicht mehr final), die Seite Konten mit den Marken „Im Spiel“/„Aktiv im Launcher“, ein echter Wechsel über den Knopf (Name, UUID, Profil, neuer Schlüssel für die Chat-Signatur, Telemetrie, Realms, Skin im Menü, neue Anmeldung beim Heldix-Dienst, Einblendung, aktives Konto im Launcher), das Profil auf der Startseite, „Konto hinzufügen“ (abgebrochen), die Sperre in der Welt mit „Welt verlassen und wechseln“ (zweiter Klick) und am Ende das Ausblenden, wenn der Launcher den Wechsel ausschaltet bzw. die Verbindung beendet. Mit `--no-ipc` startet das Spiel ohne Launcher-Verbindung (dann nur: ausgeblendet);
- lädt die Ressourcen neu und fotografiert dabei den Heldix-Ladebildschirm;
- öffnet das Untermenü eines Moduls über das Regler-Symbol und prüft die Einstellung „Größe“ am HUD;
- prüft Ressourcen der Mod, alle Farbstile und die Shader-Engine (werden sie wirklich gezeichnet?), die F3-Zeilen, FPS-Boost (an und wieder zurück) und die Hintergrund-FPS;
- prüft, dass Minecraft die gewünschte Grafik-API benutzt (`--graphics=vulkan|opengl|default`, Standard wie im Launcher: Vulkan);
- macht Screenshots aller Menüs (`--size=1920x1080 --gui-scale=2` prüft große Fenster). Sie liegen danach unter `%APPDATA%\.heldixclient\test-instances\26.3-heldix-autotest\screenshots`.

Für den Kontowechsel allein: `HELDIX_AUTOTEST_ONLY=konten` (Hauptmenü, Testwelt, „Welt verlassen und wechseln“, Ausblenden). Der Launcher-Teil des Kontowechsels hat einen eigenen Test ohne Spiel: `npm run test:accounts-ipc`.

Beim Arbeiten an den Cosmetics reicht oft ein Teil: Mit der Umgebungsvariable `HELDIX_AUTOTEST_ONLY=cosmetics` legt der Autotest nur die Testwelt an und führt die Cosmetics-Prüfungen aus (braucht `--service` mit dem Startsatz im Katalog).

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

### Automatische Updates des Launchers

Installierte Launcher fragen `https://api.heldixclient.com/v1/launcher/latest` (beim Start und alle sechs Stunden) und laden neue Versionen von dort ([updater.ts](../launcher/src/main/core/updater.ts)). Sie nehmen nur ein Manifest an, das mit dem Update-Schlüssel signiert ist, dessen Version höher ist und dessen Installer Größe und SHA-512 erfüllt.

- **Einmalig:** `npm run update-key` erstellt `%USERPROFILE%\.heldixclient-dev\update-key.pem` (sichern, nie weitergeben oder einchecken) und trägt den öffentlichen Schlüssel in [update-public-key.ts](../launcher/src/main/update-public-key.ts) ein. Geht der private Schlüssel verloren, müssen alle den Launcher einmal neu von der Webseite installieren.
- **Pro Version** (nach dem Anheben der Version): die Hinweise in [release-notes.md](../launcher/release-notes.md) eintragen (Zeilen mit „- “; sie erscheinen im Launcher unter „Was ist neu“ und im Versionsverlauf der Webseite), dann `npm run release`. Das baut den Installer, schreibt `launcher/release/update/update.json` und zeigt den `scp`-Befehl zum Hochladen. Zuerst den Installer hochladen, `update.json` zuletzt – oder beides im Team-Bereich der Webseite unter „Updates“.
- **Testen:** `npm run test:update` prüft den Updater gegen einen kleinen Test-Server (Signatur, ältere Version, veränderter Download). Mit `-- --service=http://127.0.0.1:8787 --current=0.0.1` zusätzlich gegen einen lokalen Heldix-Dienst mit veröffentlichter Version.
- Versionen vor 0.12.0 haben den Updater noch nicht; wer sie hat, installiert einmal von Hand neu.

## Die Client-Mod erweitern

**Neues Modul:** eine Klasse in `mod/src/main/java/dev/heldixclient/module/impl/` anlegen, die von `Module` erbt (bzw. von `HudModule` für HUD-Elemente), und sie in `ModuleManager.init()` registrieren. Sie erscheint dann automatisch im Heldix-Menü.

**Wie das Menü-Design funktioniert**

- [HeldixPatches](../mod/src/main/java/dev/heldixclient/transform/HeldixPatches.java) setzt an der Stelle an, an der Minecraft Widget-Grafiken zeichnet (`widget/button`, `widget/text_field`, `textures/gui/menu_background.png` …).
- [WidgetStyle](../mod/src/main/java/dev/heldixclient/ui/WidgetStyle.java) zeichnet stattdessen das Heldix-Design. Dadurch sehen auch Menüs anderer Mods passend aus, und die Funktionen bleiben die von Minecraft.
- [Ui](../mod/src/main/java/dev/heldixclient/ui/Ui.java) zeichnet das eigene Design: Text in der Schrift Inter (je GUI-Skalierung eine eigene Schriftdefinition, dadurch scharf), abgerundete Flächen, Rahmen und Schatten in echten Bildschirmpixeln (kantengeglättete Ecken aus einer Grafik statt Minecraft-Pixeln) und Icons. Bilder wie Icons und Hintergrund lädt es mit weicher (linearer) Filterung.
- Die Grafiken erzeugt `npm run ui-assets` ([render-ui-assets.mjs](../launcher/scripts/render-ui-assets.mjs)): Icon-Set (SVG im Skript, 64 und 32 px), Ecken-Atlas, Schatten, Hintergrund und Logo sowie die Schriftdefinitionen. Dieselben Icons schreibt es nach [ui-icons.ts](../launcher/src/renderer/ui-icons.ts) für den Launcher; dort füllt `hydrateIcons()` alle `<svg data-icon="name">` im HTML. Die Schrift Inter kopiert der Launcher-Build aus der Client-Mod. Neue Icons dort eintragen und das Skript ausführen; im Code dann `Ui.icon(g, "name", x, y, größe, farbe)`.
- Kontowechsel im Spiel: [AccountSwitcher](../mod/src/main/java/dev/heldixclient/account/AccountSwitcher.java) spricht über stdin/stdout mit dem Launcher, der das Spiel gestartet hat (kein Netzwerk; Protokoll, Bestätigung im Launcher und Grenzen in [konto-wechsel.md](konto-wechsel.md)); [SessionSwitcher](../mod/src/main/java/dev/heldixclient/account/SessionSwitcher.java) tauscht den `User` von Minecraft samt allem, was daran hängt, der Transformer [AccountPatches](../mod/src/main/java/dev/heldixclient/account/AccountPatches.java) macht die Felder dafür veränderlich (Heldix Loader und Fabric). Im Menü: Seite **Konten**, Profil unten in der Seitenleiste und oben rechts auf der Startseite.
- Capes: [Capes](../mod/src/main/java/dev/heldixclient/cosmetic/Capes.java) tauscht im Skin des eigenen Spielers (Eingriff am Ende von `AbstractClientPlayer.getSkin`) das Cape und auf Wunsch die Elytra aus; Minecraft zeichnet es dann selbst. Die neun Motive erzeugt `npm run capes` ([render-capes.mjs](../launcher/scripts/render-capes.mjs)) als SVG im Raster der Cape-Vorlage (64 × 32 Texel): je 24 Bilder einer Schleife untereinander in `<id>.png` (512 × 256 pro Bild, achtfache Vorlage), die leuchtenden Teile in `<id>_glow.png` (256 × 128, durchsichtig = dunkel) und Name, Bildrate und Leuchten in `capes.json`. Capes liest die Streifen beim ersten Gebrauch in eigenen Threads, zerlegt sie in einzelne Texturen mit Mipmaps (kein Flimmern aus der Entfernung) und lädt sie verteilt über mehrere Bilder hoch – viele große Uploads auf einmal überlaufen sonst den Zwischenspeicher der Grafikkarte. Der Eingriff in `CapeLayer.submit` (Hook `capeModel`) zeichnet das Cape mit [CapeCloth](../mod/src/main/java/dev/heldixclient/cosmetic/CapeCloth.java) als wehenden Stoff (16 × 6 Gitter, Welle von oben nach unten, Wölbung, Normalen für die Schattierung) und legt die leuchtenden Teile mit dem Render-Typ `eyes` voll hell darüber. Eigene Bilder liegen im Ordner `heldix-capes` der Instanz: Cape-Vorlagen (2:1, auch 46 × 22) werden direkt genutzt, andere Bilder auf Rückseite und Elytra gelegt. Die Vorschau im Menü zeichnet eine Spielerfigur über `GuiGraphicsExtractor.entity` – auch im Hauptmenü ohne Welt.
- Cosmetics (Katalog des Heldix-Dienstes, siehe [dienst.md](dienst.md#cosmetics-katalog)): [CosmeticCatalog](../mod/src/main/java/dev/heldixclient/cosmetic/CosmeticCatalog.java) lädt mit eingeschaltetem Dienst beim Start und alle 30 Minuten `GET /v1/cosmetics` (mit ETag), holt nur neue oder geänderte Umschläge (`?v=<sha256>`) und legt sie unter `config/heldixclient-cosmetics/<sha256>.json` ab. Jeder Umschlag – auch aus dem Zwischenspeicher – muss Größe und SHA-256 aus dem Katalog treffen, die Ed25519-Signatur über `"heldix-cosmetic\n" + manifest` mit dem Update-Schlüssel (`heldix-store-key.pem`, derselbe wie im Addon-Store) und alle Regeln von [CosmeticFormat](../mod/src/main/java/dev/heldixclient/cosmetic/CosmeticFormat.java) bestehen (Nachbau von `service/src/cosmetics-format.ts` mit denselben Meldungen, Zahlen wie in JavaScript, JSON streng); sonst wird er verworfen. [CosmeticMesh](../mod/src/main/java/dev/heldixclient/cosmetic/CosmeticMesh.java) baut daraus einmal je Cosmetic die Flächen (Box-UV wie Minecraft, `mirror`, Ebenen mit zwei Seiten, Umlaufsinn für Minecrafts Culling) und rechnet beim Zeichnen nur die Bone-Matrizen (Eltern · T(pivot + bob) · Rz · Ry · Rx · T(−pivot), Animationen additiv). [CosmeticRenderer](../mod/src/main/java/dev/heldixclient/cosmetic/CosmeticRenderer.java) hängt sich an den Anfang von `CapeLayer.submit` (Kopf und Rücken am schon ausgerichteten Spielermodell: Kopf-Oberseite bzw. Rumpfmitte auf Schulterhöhe, Java-Modellraum → Cosmetic-Raum per Drehung um 180° um x) und von `EntityRenderer.submit` (Begleiter weich nachgeführt in Weltlage, Aura als Partikel in Weltlage, höchstens 64 je Spieler, bei anderen nur bis 48 Blöcke). Beide Klassen sind schon Ziele der Fabric-Brücke. Gezeichnet wird über `submitCustomGeometry` mit wiederverwendeten Objekten (Ring) – keine neuen Objekte je Bild außer Minecrafts eigenen. Katalog-Capes laufen durch [Capes](../mod/src/main/java/dev/heldixclient/cosmetic/Capes.java) wie die eingebauten (Bilder 64, 128 oder 256 breit untereinander, Leuchtebene). Das Heldix-Menü hat die Seite **Cosmetics** (Reiter je Slot, Vorschau an der Figur, Kacheln mit auf der CPU gezeichneten Vorschaubildern aus [CosmeticIcons](../mod/src/main/java/dev/heldixclient/cosmetic/CosmeticIcons.java), Auswahl über `PUT /v1/me/cosmetics`).
- Alle Heldix-Seiten teilen sich eine Oberfläche: [Shell](../mod/src/main/java/dev/heldixclient/ui/Shell.java) zeichnet Fenster, obere Leisten und Hintergrund und öffnet die Seiten, [ShellScreen](../mod/src/main/java/dev/heldixclient/screen/ShellScreen.java) ist die Basis mit Werkzeugzeile und Inhaltsfläche. Die obere Leiste zeigt die vier Bereiche (`Shell.Section`: Spielen, Heldix, Profil, System), Suche, Profil und Schließen; die Leiste darunter die Ober-Seiten des aktiven Bereichs (`Shell.Page` ohne `parent`). Ein Klick auf einen Bereich öffnet dessen zuletzt offene Seite (`Shell.remember`/`Shell.target`). Unterseiten wie `PERFORMANCE` (Grafik) oder `REQUESTS` (Freunde) erscheinen über `ShellScreen.pageTabs` als Reiter in der Werkzeugzeile; eigene Reiter einer Seite (z. B. die Filter der Module) liefert `subTabs()`. Passen die Reiter nicht neben die Knöpfe der Seite (`toolbarActionsWidth()`), stehen sie in einer eigenen Zeile. Detailansichten (Untermenü eines Moduls, Chat) zeigen über `detailHeader()` Titel und Untertitel links in der Werkzeugzeile.
- Schnellsuche: [QuickSearchScreen](../mod/src/main/java/dev/heldixclient/screen/QuickSearchScreen.java) (Strg+K, Lupe oben) liegt über der offenen Seite und sucht in Seiten, Modulen und ihren Einstellungen, den Heldix-Einstellungen (`HeldixMenuScreen.searchableSettings()` baut die Seiten dafür unsichtbar auf), Addons, Store, Freunden und Wegpunkten. Gefundene Einstellungen öffnet `HeldixMenuScreen.highlighted(...)`, scrollt hin und lässt die Zeile kurz aufleuchten.
- Tastatur: Tab und Pfeile zwischen den Widgets (Leisten, Reiter, Knöpfe) macht Minecraft; im selbst gezeichneten Inhalt von `HeldixMenuScreen` sammelt `Ui.collectTargets` beim Zeichnen jede Hover-Abfrage (`Ui.inside`) als Ziel, Einstellungen melden sich mit eigener Aktion (`keyTarget`). Pfeile wählen räumlich das nächste Ziel (am Rand wird gescrollt), Hover und Tooltips folgen dem gewählten Ziel, Enter/Leertaste lösen aus (eigene Aktion oder ein Klick in die Mitte), Pfeil links/rechts ändert Regler und Auswahlen. Strg+Tab wechselt Reiter bzw. Seite, Strg+1–4 den Bereich (`ShellScreen.keyPressed`).
- Tasten im Untermenü: `Setting.Key` zeigt eine Minecraft-Tastenbelegung als Chip (Klick, neue Taste; Entf/Rücktaste = frei, Esc = abbrechen, ↺ = Standard, gelbe Warnung bei doppelter Belegung) und speichert wie Minecraft in options.txt. `Module.keys()` liefert die Tasten eines Moduls (Zoom, Freelook, Wegpunkte; bei Addons `addKey`/`showKey`) plus die Ein/Aus-Taste, die `ModuleManager.createToggleKeys()` nach den Haupttasten für jedes Modul anlegt und `handleToggleKeys()` jeden Tick ausführt.
- Spielermenü: [PlayerMenu](../mod/src/main/java/dev/heldixclient/player/PlayerMenu.java) öffnet mit der Taste „Spielermenü“ (ab Werk Mausrad, teilt sie sich gewollt mit „Block auswählen“) das Kreismenü [PlayerMenuScreen](../mod/src/main/java/dev/heldixclient/screen/PlayerMenuScreen.java), wenn das Fadenkreuz auf einem anderen Spieler steht. Symbole der Addons am Namensschild hängt [PlayerMarkerStore](../mod/src/main/java/dev/heldixclient/player/PlayerMarkerStore.java) in `BadgeDisplay.nameTag` an (Schrift `heldixclient:marker`, alle Icons als Zeichen, erzeugt von `npm run ui-assets`); die Symbole über dem Kopf (API 7) reicht `PlayerMarkerStore.submitAbove` aus dem Hook `cosmeticEntity` (Anfang von `EntityRenderer.submit`) als Text in dieser Schrift ein – gleiche Lage wie das Namensschild, als runde Plakette (Zeichen `disc` und `ring`, darüber das Symbol mit `POLYGON_OFFSET`), nur wenn `state.nameTag` gesetzt ist.
- Sprachkanal: [VoiceLink](../mod/src/main/java/dev/heldixclient/voice/VoiceLink.java) verbindet sich mit `/v1/voice`, solange ein Addon ihn eingeschaltet hat und du auf einem Server spielst, meldet Raum und Position und verteilt Rahmen (Protokoll in [dienst.md](dienst.md)). Ab Dienst 1.9.0 (`features` in `ready`) schickt es nach dem `join` den eigenen Status und hängt die Gruppe als SHA-256 an (`groupKey`: Präfix, Name klein, Passwort); `peers` liefert Gruppe und Status der anderen.
- Schnellschalter: [QuickModules](../mod/src/main/java/dev/heldixclient/module/QuickModules.java) (Auswahl in `HeldixConfig.quickModules`, sonst eine Standardauswahl) für Übersicht und Pausemenü. Darauf bauen [WorldsScreen](../mod/src/main/java/dev/heldixclient/screen/WorldsScreen.java), [ServersScreen](../mod/src/main/java/dev/heldixclient/screen/ServersScreen.java) und [HeldixMenuScreen](../mod/src/main/java/dev/heldixclient/screen/HeldixMenuScreen.java) auf.
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
- **Weitere Module oder Addons:** Minimap, Item-Physik, Server-spezifische Profile
- **Addons anderer Entwickler** im Addon-Store (Einreichen mit Prüfung im Team-Bereich)
- **Shaderpacks** im Stil von OptiFine/Iris (Schatten, Reflexionen) bräuchten einen eigenen Renderer; die eingebauten Stile sind Post-Effekte
