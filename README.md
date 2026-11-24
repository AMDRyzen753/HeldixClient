# HeldixClient

Eigener Minecraft-Client nach dem Prinzip von Lunar oder Feather. Er besteht aus vier Teilen:

- **Launcher** (Electron + TypeScript) mit **Instanz-System**: lädt Minecraft herunter und startet es.
- **Heldix Loader**: ein **eigener Mod-Loader**, ganz ohne Fabric. Er klinkt sich als Java-Agent beim Spielstart ein, verändert Minecraft-Klassen per Bytecode (ASM) und lädt Heldix-Mods.
- **HeldixClient-Mod** (Java): baut die Features ins Spiel ein. Sie ist selbst eine Heldix-Mod.
- **Heldix-Addons**: kleine Erweiterungen über eine stabile API, ohne Minecraft-Code.

Für Fabric-Mods von Modrinth gibt es weiterhin eigene **Fabric-Instanzen**.

**Design „Glas“:** halbtransparente Milchglas-Flächen in Blau und Cyan.
- Im Launcher liegen sie über einem großen Hintergrundbild ([background.svg](launcher/src/renderer/background.svg), neu erzeugbar mit `node scripts/render-background.mjs`).
- Im Spiel liegen sie über Minecrafts verschwommenem Hintergrund.
- Das Logo ist eine Glas-Kachel mit geschichtetem „H“ ([logo.svg](launcher/src/renderer/logo.svg)).
- Die Farben sind an zwei Stellen definiert und sollten übereinstimmen: CSS-Variablen in [styles.css](launcher/src/renderer/styles.css) (Launcher) und [Theme.java](mod/src/main/java/dev/heldixclient/ui/Theme.java) (im Spiel).

```
MC-Launcher/
├── launcher/                    Electron-Launcher
│   ├── src/main/                Hauptprozess: Fenster, IPC, Konten, Einstellungen
│   │   └── core/                Launcher-Kern ohne Electron (Download, Java, Fabric, Start)
│   ├── src/renderer/            Oberfläche (HTML/CSS/TS)
│   ├── src/shared/api.d.ts      Gemeinsame Typen von Oberfläche und Hauptprozess
│   ├── src/scripts/             Starttest und Autotest
│   ├── resources/heldix-loader/ gebaute Loader-JAR
│   ├── resources/client-mods/   gebaute HeldixClient-JARs (eine pro Minecraft-Version)
│   └── resources/heldix-addons/ mitgelieferte Addons (kommen in neue Heldix-Instanzen)
├── mod/                         Java-Projekte (Gradle, Minecraft 26.3, Java 25)
│   ├── heldix-loader/           der Heldix Loader (Java-Agent + ASM)
│   ├── src/                     HeldixClient-Mod
│   ├── heldix-api/              Heldix-API für Addons (reines Java, ohne Minecraft)
│   ├── example-addon/           Beispiel-Addon „Uhrzeit & Spielzeit“
│   ├── autotest/                automatischer Test im echten Spiel (wird nicht ausgeliefert)
│   └── gradle/minecraft.gradle  lädt Minecraft zum Kompilieren direkt von Mojang
└── .tools/jdk-25/               Portables JDK zum Bauen (nicht im Git)
```

## Schnellstart

Voraussetzungen: Node.js 22+ und ein JDK 25 zum Bauen der Java-Teile. Liegt `.tools/jdk-25` vor, wird es automatisch genutzt.

```powershell
cd launcher
npm install
npm run mod      # baut Loader, Client-Mod und Addon und legt sie in resources/ ab
npm start        # baut und startet den Launcher
```

**Installer bauen:**

```powershell
cd launcher
npm run dist     # Java-Teile + Launcher bauen, Installer erzeugen
```

Ergebnis: `launcher/release/HeldixClient-Setup-<version>.exe`.
- Eine direkt startbare Version ohne Installation liegt in `launcher/release/win-unpacked/`.
- Das App-Icon kommt aus `launcher/build/icon.png` und lässt sich mit `npm run icon` neu erzeugen.
- Der Installer ist nicht signiert. Deshalb warnt Windows SmartScreen beim ersten Start („Weitere Informationen“ → „Trotzdem ausführen“).

Im Entwicklungsmodus gibt es zusätzlich **Offline-Konten (Dev)**. Damit kannst du sofort testen, auch ohne Microsoft-Login. In der fertig gepackten App sind Offline-Konten gesperrt.

Spieldaten liegen unter `%APPDATA%\.heldixclient`:

| Ordner | Inhalt |
| --- | --- |
| `versions/`, `libraries/`, `assets/` | Minecraft-Dateien (wie beim offiziellen Launcher); der Heldix Loader liegt unter `libraries/dev/heldixclient/` |
| `runtime/` | Java-Laufzeiten von Mojang (Java 8/17/21/25, je nach Version automatisch) |
| `instances/<id>/` | eine Instanz: `heldix-instance.json`, Welten, Einstellungen, `mods/`, `heldix-addons/` |
| `launcher-settings.json`, `launcher-accounts.json` | Launcher-Einstellungen, Konten (Tokens per Windows-DPAPI verschlüsselt) |
| `test-instances/` | Spielordner der Tests |

## Instanzen

Jede Instanz hat eigene Welten, Mods, Addons, Einstellungen und optional einen eigenen RAM-Wert. Verwaltet werden sie im Launcher unter **Instanzen**.

| Loader | Was geladen wird |
| --- | --- |
| **Heldix Loader** | Vanilla-Minecraft mit dem Heldix Loader: HeldixClient, eigene Heldix-Mods und Heldix-Addons. Kein Fabric. Nur für Versionen, für die eine HeldixClient-Mod gebaut ist. |
| **Fabric** | Fabric, Fabric API und eigene Fabric-Mods, z. B. von Modrinth (ohne HeldixClient) |
| **Vanilla** | Minecraft ohne Mods, jede Version |

**Mods in Heldix-Instanzen**
- Hier laufen nur Heldix-Mods, also JARs mit `heldix.mod.json`.
- Hinzufügen per Datei-Dialog oder Drag & Drop, außerdem an/aus schalten und löschen.
- Fabric-Mods werden im Launcher als „läuft nicht mit dem Heldix Loader“ markiert und vom Loader übersprungen, ohne dass das Spiel abstürzt.

**Mods in Fabric-Instanzen**
- **Mods entdecken** installiert Mods direkt von [Modrinth](https://modrinth.com).
- Benötigte Abhängigkeiten werden automatisch mitinstalliert, passend zu Minecraft-Version und Fabric.

**Allgemein**
- Vom Launcher verwaltete Dateien (Schloss-Symbol) werden bei jedem Start aktualisiert. Das sind die HeldixClient-Mod in Heldix-Instanzen und die Fabric API in Fabric-Instanzen.
- Heldix-Instanzen aus Version 0.5 liefen noch auf Fabric. Beim ersten Start mit 0.6 entfernt der Launcher die alte Fabric API und die Fabric-Version der Mod automatisch. Welten und Einstellungen bleiben erhalten.
- Spielordner aus älteren Launcher-Versionen (`26.3-fabric` usw.) werden beim ersten Start automatisch als Instanzen übernommen.
- Gelöschte Instanzen landen im Papierkorb.

## Der Heldix Loader

Der Heldix Loader ([mod/heldix-loader](mod/heldix-loader)) ist ein eigenständiger Mod-Loader. Fabric, Fabric API und Mixin werden dafür nicht gebraucht.

**So startet ein Heldix-Spiel:**

1. Der Launcher startet ganz normales Vanilla-Minecraft. Zusätzlich hängt er `-javaagent:heldix-loader-<version>.jar` und `-Dheldix.gameDir=<Instanz>` an.
2. Noch bevor Minecraft startet, ruft Java den Loader auf ([HeldixAgent](mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/HeldixAgent.java)). Der Loader:
   - liest alle JARs in `mods/` und prüft ihre `heldix.mod.json` (Minecraft-Version, Loader-Version, Abhängigkeiten);
   - legt passende Mods auf den Classpath und liest ihre Übersetzungen;
   - registriert ihre Transformer.
3. Während Minecraft seine Klassen lädt, verändert der Loader die nötigen Stellen per ASM ([TransformerChain](mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/TransformerChain.java)). Stack-Map-Frames berechnet er selbst, ohne dabei Klassen zu früh zu laden.
4. Im Konstruktor von `Minecraft` ruft der Loader die Einstiegspunkte der Mods auf, also `onInitialize()`.

Diese Eingriffe macht der Loader selbst ([BuiltinPatches](mod/heldix-loader/src/main/java/dev/heldixclient/loader/impl/BuiltinPatches.java)):
- Mods starten
- eigene Tastenbelegungen
- Übersetzungen aus `assets/<id>/lang/*.json` der Mods
- die Events der Loader-API

Schlägt ein Eingriff fehl (etwa nach einem Minecraft-Update), fehlt nur diese Funktion. Der Grund steht dann im Log und in `HeldixLoader.problems()`.

| Loader-API (`dev.heldixclient.loader.…`) | Wofür |
| --- | --- |
| `HeldixLoader` | Version, Spiel-/Config-/Mods-Ordner, geladene Mods, Probleme beim Start |
| `api.HeldixModInitializer` | Einstiegspunkt einer Mod (`onInitialize()`) |
| `api.KeyMappings` | eigene Tasten (erscheinen unter Optionen → Steuerung) |
| `api.event.ClientEvents` | `TICK_END`, `STOPPING` |
| `api.event.HudEvents` | `RENDER`: ins HUD zeichnen |
| `api.event.ScreenEvents` | `AFTER_INIT` und `addWidget(...)`: Buttons in fremde Menüs einbauen |
| `api.event.WorldEvents` | `JOIN`, `LEAVE` |
| `api.event.ChatEvents` | `RECEIVE`: empfangene Chatnachrichten |
| `api.transform.ClassTransformer`, `Patches`, `Code` | eigene Eingriffe in Minecraft-Klassen (statt Mixins) |

### Eine Heldix-Mod schreiben

```json
// src/main/resources/heldix.mod.json
{
  "id": "meinemod",
  "name": "Meine Mod",
  "version": "1.0.0",
  "minecraft": "26.3",
  "loader": ">=2.0.0",
  "entrypoints": { "client": ["de.du.MeineMod"] },
  "transformers": ["de.du.MeinTransformer"],
  "depends": { "heldixclient": ">=0.6.0" }
}
```

Versionsangaben können `*`, `26.3`, `26.x`, `>=2.0.0`, `>1.0 <2.0` oder `26.2 || 26.3` sein. `transformers` und `depends` sind optional.

```java
public class MeineMod implements HeldixModInitializer {
    @Override
    public void onInitialize() {
        HudEvents.RENDER.register((g, delta) -> g.text(Minecraft.getInstance().font, "Hallo", 4, 4, -1, true));
        WorldEvents.JOIN.register(mc -> HeldixLoader.mod("meinemod").ifPresent(m -> System.out.println(m.name() + " ist bereit")));
    }
}

// Eingriff in Minecraft: Sichtfeld halbieren (Logik in einer statischen Hook-Methode)
public class MeinTransformer implements ClassTransformer {
    public Set<String> targets() { return Set.of("net/minecraft/client/Camera"); }
    public void transform(String name, ClassNode node) {
        Patches.modifyReturnValue(Patches.method(node, "calculateFov", "(F)F"), "de/du/Hooks", "fov", "(F)F");
    }
}
```

**Wichtig bei Transformern**
- Sie werden erzeugt, bevor Minecraft startet. Sie dürfen deshalb keine Minecraft-Klassen benutzen, nur deren Namen als Text.
- Weitere Bausteine:
  - `Patches.head`, `cancelAtHead`, `beforeReturns`, `tail`
  - `replaceCalls`, `afterCalls`, `beforeFieldWrite`
- Die Deskriptoren der Methoden liefert `javap -s` auf die Client-JAR unter `mod/.gradle/minecraft/<version>/client.jar`.

Vollständige Beispiele:
- die HeldixClient-Mod: [HeldixClient.java](mod/src/main/java/dev/heldixclient/HeldixClient.java), [HeldixPatches.java](mod/src/main/java/dev/heldixclient/transform/HeldixPatches.java), [Hooks.java](mod/src/main/java/dev/heldixclient/transform/Hooks.java)
- der [Autotest](mod/autotest)

Gebaut wird mit Gradle, wie bei `mod/autotest/build.gradle`: `compileOnly project(':heldix-loader')`, Minecraft kommt über `gradle/minecraft.gradle`.

**Start mit Problemen:** Mods mit falscher Minecraft-Version, fehlender Abhängigkeit oder doppelter ID überspringt der Loader und meldet sie mit Grund. Wirft eine Mod in `onInitialize()` einen Fehler, bricht das Spiel mit einem Crash-Report ab, in dem die Mod genannt ist.

**Zum Prüfen:** Mit `-Dheldix.dumpClasses=<Ordner>` speichert der Loader alle veränderten Klassen; danach lassen sie sich mit `javap -c` ansehen.

## Microsoft-Login einrichten

Für echte Konten braucht der Launcher eine eigene App-Registrierung bei Microsoft:

1. [Azure-Portal](https://portal.azure.com) → **App-Registrierungen** → **Neue Registrierung**
   - Unterstützte Kontotypen: **Nur persönliche Microsoft-Konten**
   - Umleitungs-URI: Plattform **Öffentlicher Client/nativ (mobil und Desktop)**, Adresse
     `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. Die **Anwendungs-ID (Client-ID)** in [launcher/src/main/config.ts](launcher/src/main/config.ts) bei `MICROSOFT_CLIENT_ID` eintragen, oder die Umgebungsvariable `HELDIX_MS_CLIENT_ID` setzen.
3. **Freischaltung bei Mojang beantragen.** Neue Azure-Apps dürfen die Minecraft-API erst nach Prüfung nutzen. Das Formular ist unter <https://aka.ms/mce-reviewappid> verlinkt. Bis zur Freigabe meldet der Launcher: „Minecraft lehnt die App-Registrierung ab …“.

Der Ablauf im Code (Microsoft → Xbox Live → XSTS → Minecraft) steckt in [core/auth.ts](launcher/src/main/core/auth.ts), das Anmeldefenster in [auth-window.ts](launcher/src/main/auth-window.ts).

## Discord-Status (Rich Presence)

Der Launcher zeigt in Discord an, was gespielt wird. Discord blendet dabei „Spielt HeldixClient“ ein, darunter zum Beispiel:

| Situation | Anzeige |
| --- | --- |
| Launcher offen | Im Launcher |
| Spiel startet | Minecraft 26.3 · HeldixClient – Startet das Spiel … |
| Hauptmenü | Minecraft 26.3 · HeldixClient – Im Hauptmenü |
| Einzelspieler / LAN / Realms | … – Spielt Einzelspieler / Spielt im LAN / Spielt auf Realms |
| Server | … – Spielt auf hypixel.net (dazu die Spielzeit) |

**So funktioniert es:**
- Der Launcher spricht direkt mit der Discord-App auf dem PC, über deren lokale Schnittstelle ([core/discord.ts](launcher/src/main/core/discord.ts)). Dafür braucht er kein Zusatzpaket und keinen Internetdienst.
- In Heldix-Instanzen meldet HeldixClient, ob man im Menü, im Einzelspieler oder auf einem Server ist ([StatusReporter](mod/src/main/java/dev/heldixclient/status/StatusReporter.java)). Fabric- und Vanilla-Instanzen zeigen nur „Im Spiel“.
- Der Text des Status entsteht in [core/presence.ts](launcher/src/main/core/presence.ts).

**Einstellungen → Discord:**
- Der Status lässt sich ganz abschalten.
- Ob der Server angezeigt wird, ist ebenfalls einstellbar.
- Angezeigt werden nur öffentliche Domains wie `hypixel.net`. IP-Adressen, `localhost` und Heimnetz-Namen erscheinen nie.
- Die Karte zeigt auch, ob die Verbindung zu Discord steht.

**Einrichten (einmalig, wie beim Microsoft-Login braucht der Launcher eine eigene App):**

1. Im [Discord Developer Portal](https://discord.com/developers/applications) auf **New Application** klicken. Der Name, z. B. `HeldixClient`, erscheint später als „Spielt …“.
2. Unter **General Information** die **Application ID** kopieren.
3. Unter **Rich Presence → Art Assets** die Datei `launcher/build/discord-logo.png` hochladen.
   - Die Datei erzeugt `npm run icon`.
   - Discord übernimmt den Dateinamen `discord-logo` als Namen; genau so muss das Bild heißen.
   - Neue Bilder kann Discord erst nach ein paar Minuten anzeigen.
4. Die ID in [launcher/src/main/config.ts](launcher/src/main/config.ts) bei `DISCORD_CLIENT_ID` eintragen oder die Umgebungsvariable `HELDIX_DISCORD_CLIENT_ID` setzen.
   - Die ID ist kein Geheimnis und darf im Launcher stehen.
   - Danach `npm run dist` ausführen.
5. Testen mit `npm run test:discord -- <Application-ID>`. Discord muss dabei geöffnet sein. Dein Discord-Profil zeigt dann 20 Sekunden lang einen Beispielstatus.

## Die Client-Mod

| Feature | Taste / Ort |
| --- | --- |
| Eigenes Hauptmenü (Seitenleiste, Begrüßung, Tipps, Profil mit Skin) | automatisch |
| Heldix-Design für alle Menüs (Buttons, Textfelder, Regler, Listen, Hintergründe) | automatisch, abschaltbar im Heldix-Menü über „Design“ |
| Heldix-Menü-Button im Pausemenü | **ESC** im Spiel |
| Heldix-Menü (Module an/aus, Addons, eigenes Design) | **Rechte Umschalttaste** |
| HUD-Editor (verschieben mit Einrasten, **R** setzt zurück) | Heldix-Menü → „HUD bearbeiten“ |
| Zoom, Mausrad ändert die Stärke | **C** halten |
| FPS, CPS, Ping, Koordinaten/Richtung/Biom, Keystrokes | HUD |
| Branding im Hauptmenü und im Fenstertitel | automatisch |

Einstellungen speichert die Mod in `instances/<…>/config/heldixclient.json`.

**Ein neues Feature hinzufügen:** Eine Klasse in `mod/src/main/java/dev/heldixclient/module/impl/` anlegen, die von `Module` erbt (bzw. von `HudModule` für HUD-Elemente), und sie in `ModuleManager.init()` registrieren. Sie erscheint dann automatisch im Heldix-Menü.

**Wie das Menü-Design funktioniert**
- [HeldixPatches](mod/src/main/java/dev/heldixclient/transform/HeldixPatches.java) setzt an der Stelle an, an der Minecraft Widget-Grafiken zeichnet (`widget/button`, `widget/text_field`, `textures/gui/menu_background.png` …).
- [WidgetStyle](mod/src/main/java/dev/heldixclient/ui/WidgetStyle.java) zeichnet stattdessen das Heldix-Design. Dadurch sehen auch Menüs anderer Mods passend aus, und die Funktionen bleiben die von Minecraft.
- Das Hauptmenü baut [HeldixTitle](mod/src/main/java/dev/heldixclient/screen/HeldixTitle.java) neu auf. Technisch bleibt es aber ein `TitleScreen`.

**Entwickeln:**
- In IntelliJ IDEA den Ordner `mod` als Gradle-Projekt öffnen und JDK 25 auswählen. Minecraft lädt Gradle beim ersten Mal selbst herunter.
- Ausprobieren am schnellsten mit `npm run mod` und danach `npm run test:launch -- 26.3 heldix` (siehe [Testen](#testen)) oder über den Launcher.

## Heldix-Addons

Addons sind die einfache Stufe unter den Mods. HeldixClient lädt sie aus dem Ordner `heldix-addons/` einer Instanz. Addons programmiert man nur gegen die [Heldix-API](mod/heldix-api/src/main/java/dev/heldixclient/api). Die API enthält bewusst nichts aus Minecraft, deshalb läuft dieselbe Addon-JAR über Minecraft-Updates hinweg weiter.

| | Heldix-Mod (`mods/`) | Heldix-Addon (`heldix-addons/`) |
| --- | --- | --- |
| Zugriff | ganzes Minecraft, eigene Transformer | nur die Heldix-API |
| Läuft nach Minecraft-Updates | nur mit neuem Build | ja, dieselbe JAR |
| Bei Fehlern | Crash-Report | Addon wird abgeschaltet, das Spiel läuft weiter |

Ein Addon besteht aus:

```json
// src/main/resources/heldix.addon.json
{
  "id": "mein-addon",
  "name": "Mein Addon",
  "version": "1.0.0",
  "description": "Was das Addon macht.",
  "authors": ["Du"],
  "entrypoint": "de.du.MeinAddon",
  "api": 1
}
```

```java
public class MeinAddon implements HeldixAddon {
    @Override
    public void onEnable(HeldixApi api) {
        // HUD-Element, im HUD-Editor verschiebbar, im Heldix-Menü an/aus
        api.registerHudModule(ModuleSpec.of("hallo", "Hallo", "Mein erstes Modul"),
                canvas -> canvas.labelValue("Hallo", api.player().map(p -> p.name()).orElse("Welt")));
        // Ereignisse: onTick, onWorldJoin, onWorldLeave, onChatMessage
        api.events().onWorldJoin(() -> api.chat("Willkommen zurück!"));
    }
}
```

- **Vorlage:** [example-addon](mod/example-addon) mit Uhrzeit, Spielzeit und einer Begrüßung im Chat.
  - Bauen mit `cd mod; .\gradlew :example-addon:build`.
  - Das Ergebnis liegt in `mod/example-addon/build/libs/`.
- **Was die API kann**
  - HUD-Module und Schalt-Module
  - Events
  - Spielerdaten: Position, Leben, Hunger, Dimension, Biom
  - lokale Chatnachrichten
  - eigene Einstellungen (`api.config()`) und ein Logger

  Details stehen in den Javadoc-Kommentaren der [API-Klassen](mod/heldix-api/src/main/java/dev/heldixclient/api).
- **Robustheit**
  - Jedes Addon bekommt einen eigenen Classloader.
  - Addons mit falscher API-Version, fehlender `heldix.addon.json` oder Fehlern beim Laden werden übersprungen. Das Heldix-Menü zeigt sie im Reiter **Addons** rot mit Grund an.
  - Wirft ein Addon zur Laufzeit drei Fehler, wird es abgeschaltet.
  - Das Spiel läuft in allen Fällen weiter.

### Hinweise zu Minecraft 26.x

Seit 26.1 ist Minecraft nicht mehr obfuskiert. Loader und Mod nutzen direkt Mojangs Klassennamen; Mappings und Loom werden nicht gebraucht. Einige Namen weichen von älteren Tutorials ab:
- `GuiGraphics` heißt jetzt `GuiGraphicsExtractor` (`text()`, `fill()`).
- Screens öffnet man über `minecraft.gui.setScreen(...)`.
- Das Sichtfeld wird in `Camera.calculateFov` berechnet.
- Tastencodes stehen in `InputConstants`. Die linke Maustaste ist dort `MOUSE_BUTTON_LEFT` (= 1, nicht 0).

## Mehrere Minecraft-Versionen

- Der **Launcher** startet jede Version aus Mojangs Liste. Fabric-Instanzen gibt es ab 1.14. Alte Versionen mit Natives (z. B. 1.8.9) werden ebenfalls unterstützt.
- Die **Client-Mod** wird pro Minecraft-Version gebaut. Der Launcher erkennt die passende JAR am Dateinamen (`heldixclient-<modversion>+<minecraft>.jar`). Versionen mit Mod stehen in der Versionsauswahl unter dem Reiter „Heldix“.
- **Für eine weitere Version:**
  1. In `mod/gradle.properties` den Wert `minecraft_version` ändern.
  2. Kompilierfehler beheben.
  3. `npm run mod` ausführen.
  4. Mit dem Autotest prüfen. Er meldet jeden Eingriff, der nicht mehr greift.

  JARs für andere Versionen bleiben dabei in `resources/client-mods` liegen.
- Der Loader selbst ist auf die 26.x-Klassennamen ausgelegt. Für sehr alte, obfuskierte Versionen bräuchte er Mappings.

## Testen

```powershell
cd launcher
npm run test:launch -- 26.3 heldix              # startet offline mit Heldix Loader, HeldixClient + Addon, beendet nach dem Laden
npm run test:launch -- 26.3 heldix --autotest   # zusätzlich der komplette Test im Spiel, mit Screenshots
npm run test:launch -- 26.3 fabric              # nur Fabric (ohne HeldixClient)
npm run test:launch -- 1.8.9 vanilla
npm run test:discord -- <Application-ID>       # Discord-Status (Discord muss laufen)
```

Der Starttest bricht mit Fehler ab, wenn:
- das Spiel abstürzt;
- ein Eingriff des Loaders oder einer Mod fehlschlägt;
- Loader, HeldixClient oder das Beispiel-Addon nicht geladen werden;
- HeldixClient keinen Status für Discord meldet (Hauptmenü, im Autotest auch Einzelspieler);
- eine Fabric- oder Vanilla-Instanz fälschlich den Heldix Loader lädt.

**Der Autotest** ([mod/autotest](mod/autotest)) ist eine Heldix-Mod, die nur mit `-Dheldix.autotest=true` aktiv wird. Er:
- prüft Loader, Übersetzungen, Tasten, Fenstertitel und Addons, auch ein absichtlich kaputtes Addon und eine Fabric-Attrappe im `mods`-Ordner;
- klickt über die echte Maus-Verarbeitung von Minecraft das Heldix-Menü auf vier Wegen an;
- erstellt eine flache Testwelt und prüft darin HUD, Chat- und Welt-Events, das Verschieben im HUD-Editor und den Zoom;
- macht Screenshots aller Menüs.

Die Bilder liegen danach unter `%APPDATA%\.heldixclient\test-instances\26.3-heldix-autotest\screenshots`.

## Wo der Name steht

Falls der Name noch einmal geändert werden soll:

- **Launcher**
  - [config.ts](launcher/src/main/config.ts): Name, Datenordner, Mod-Präfix
  - `productName`/`appId` in `launcher/package.json`
  - Texte in [index.html](launcher/src/renderer/index.html)
- **Mod**
  - `archives_base_name`/`maven_group` in `gradle.properties`
  - `id`/`name` in `heldix.mod.json`
  - `MOD_ID`/`NAME` in `HeldixClient.java`
  - Paket `dev.heldixclient`
  - Sprachdateien unter `assets/heldixclient/lang`

## Nächste Schritte

- **Code-Signatur** für den Installer, damit SmartScreen nicht mehr warnt.
- **Auto-Update** für Launcher, Loader und Mod, z. B. über GitHub Releases.
- **Weitere Module oder Addons:** Armor-Status, Potion-HUD, Fullbright, eigene Crosshairs, Freelook.
- **Mod- und Addon-Katalog:** Heldix-Mods und -Addons im Launcher durchsuchen und installieren, ähnlich wie Fabric-Mods über Modrinth.
- **Ressourcen aus Mods:** Der Loader liefert bisher nur Übersetzungen aus Mod-JARs. Für eigene Texturen und Sounds wäre ein Ressourcenpaket pro Mod der nächste Schritt.
- **Eigene Kosmetik** wie Capes braucht einen eigenen Server, der Spieler und Kosmetik zuordnet.

## Rechtliches und Fair Play

- Der Launcher lädt alle Minecraft-Dateien direkt von Mojang. Minecraft-Dateien selbst darfst du nicht weiterverteilen. Das gilt auch für veränderte Klassen: Der Heldix Loader verändert sie nur im Arbeitsspeicher beim Start und speichert sie nicht.
- Laut Mojangs [Markenrichtlinien](https://www.minecraft.net/usage-guidelines) darf „Minecraft“ nicht im Produktnamen stehen, und das Produkt darf nicht wie ein offizielles Mojang-Produkt aussehen.
- Viele Server verbieten Features, die einen Vorteil verschaffen (z. B. Fullbright oder Minimaps mit Spieler-Anzeige). Im Zweifel die Server-Regeln prüfen.
