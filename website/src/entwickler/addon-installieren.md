---
titel: Addons installieren und Fehler finden
beschreibung: Wo Addons hingehören, wie du sie aus dem Addon-Store oder als eigene JAR installierst und abschaltest – und was du tust, wenn ein Addon nicht lädt.
reihenfolge: 4
stichworte: installieren, heldix-addons, addon-store, store, ordner, launcher, abschalten, kompatibilität, fehler, log, fehlersuche, mods & addons, minecraft-version, greift in minecraft ein, heldix-instanz, fabric
---
Heldix-Addons laufen in jeder Instanz mit HeldixClient: in Heldix-Instanzen und in Fabric-Instanzen, in denen HeldixClient eingeschaltet ist (Instanz → Einstellungen → HeldixClient). Addons, die direkt in Minecraft eingreifen, laufen meist nur in Heldix-Instanzen und nur in den Minecraft-Versionen, die sie nennen. Jede Instanz hat ihren eigenen Ordner `heldix-addons`, Addons gelten also immer nur für die Instanz, in die du sie legst. In reinen Vanilla-Instanzen gibt es keine Addons.

Den Launcher bekommst du unter [Download](/download). Die Kurzfassung für Spieler steht im Hilfe-Center unter [Heldix-Addons](/hilfe/heldix-addons).

## Aus dem Addon-Store

Fertige Addons wie **Spotify**, **Uhrzeit & Spielzeit** und **Item Physics** kommen nicht mit dem Launcher, sondern aus dem [Addon-Store](/addons). Jede Version dort hat das Team geprüft und mit seinem Schlüssel signiert.

- **Im Launcher:** Instanz → Reiter **Mods & Addons** → **Hinzufügen** → **Addon-Store** → **Installieren** bzw. **Aktualisieren**. Der Launcher prüft dabei Signatur, SHA-256-Prüfsumme und die `heldix.addon.json` der Datei – und ob API-Stufe, System, Minecraft-Version und Loader zur Instanz passen. Passt etwas nicht, steht dort der Grund, z. B. „Nur für Minecraft 26.3“ oder „Läuft nur in Heldix-Instanzen“.
- **Im Spiel:** Heldix-Menü → **Mods & Addons**, Reiter **Store**. Installieren, Aktualisieren und Entfernen (Papierkorb neben dem Knopf) wirken beim nächsten Start.
- **Auf der Webseite:** Auf der Seite des Addons im [Addon-Store](/addons) lädst du die JAR herunter und legst sie wie unten beschrieben von Hand in den Ordner.

## Eigene JAR im Launcher installieren

1. Öffne im Launcher **Instanzen** und wähle die Instanz aus.
2. Wechsle in den Reiter **Mods & Addons**.
3. Zieh die `.jar`-Datei in die Liste oder klick auf **Datei hinzufügen**.
4. Starte das Spiel. Addons werden beim Spielstart geladen – läuft das Spiel schon, starte es neu.

Der Launcher sortiert jede Datei selbst ein: eine JAR mit `heldix.addon.json` in den Ordner `heldix-addons`, Fabric-Mods (`fabric.mod.json`) und ältere Heldix-Mods (`heldix.mod.json`) nach `mods`. In der Liste zeigen Chips, was eine Datei ist: „Fabric-Mod“, „Addon“ und bei Addons mit Eingriff „Greift in Minecraft ein“.

> **Hinweis:** Das Spotify-Addon liest den laufenden Song über die Windows-Mediensteuerung. Es braucht keine Anmeldung, funktioniert aber nur unter Windows. Die Tasten sind [[Pos1]] (Abspielen/Pause), [[Bild ab]] (nächster Song) und [[Bild auf]] (vorheriger Song).

## Von Hand in den Ordner legen

Du kannst ein Addon auch direkt in den Ordner `heldix-addons` der Instanz kopieren. Am schnellsten kommst du dorthin über Instanz → **Einstellungen** → Karte **Ordner** → **Addons**. Unter Windows liegen die Instanzen unter `%APPDATA%\.heldixclient\instances\`.

- Leg die JAR direkt in den Ordner, nicht in einen Unterordner.
- Den Ordner legt HeldixClient beim ersten Start selbst an, falls er fehlt.

> **Achtung:** Addons gehören nicht in den Ordner `mods`. Dort überspringt sie der Heldix Loader mit dem Hinweis „Heldix-Addon – gehört in den Ordner heldix-addons, nicht nach mods“.

## Abschalten, löschen, einstellen

- **Abschalten:** der Schalter in der Liste des Launchers. Der Launcher benennt die Datei dann in `.jar.disabled` um, und HeldixClient lässt sie beim Start liegen. Im Spiel (Heldix-Menü → **Mods & Addons** → **Installiert**) gibt es denselben Schalter: Ausschalten wirkt bei reinen API-Addons sofort, Einschalten – und bei Addons mit Eingriff in Minecraft beides – erst nach dem Neustart („Wirkt nach dem Neustart“).
- **Löschen:** das Papierkorb-Symbol in der Liste.
- **Einzelne Module:** Im Spiel öffnet die rechte [[Umschalt]]-Taste das Heldix-Menü. Unter **Module** (Reiter „Addons“) schaltest du jedes Modul eines Addons einzeln an und aus; das Zahnrad an der Karte öffnet seine Einstellungen. HUD-Elemente verschiebst du im HUD-Editor.
- **Tasten:** unter Optionen → Steuerung in der Gruppe „Heldix-Addons“.

## Kompatibilität

- **Minecraft-Versionen:** Addons, die nur die Heldix-API nutzen, laufen mit derselben JAR auch nach Minecraft-Updates weiter, solange es HeldixClient für die Version gibt. Addons mit Eingriff in Minecraft laufen nur in den Versionen aus `minecraft` – sonst lädt der Heldix Loader sie nicht und meldet „Nur für Minecraft …“.
- **Heldix- oder Fabric-Instanz:** Reine API-Addons laufen in beiden. Addons mit Transformern laufen in Fabric nur, wenn der Heldix Loader dort alle ihre Zielklassen verändern kann; sonst zeigen Launcher und Spiel „Läuft nur in Heldix-Instanzen“. Braucht ein Addon einen neueren Heldix Loader, steht dort z. B. „Braucht Heldix Loader 2.5.0 oder neuer“ – der Loader kommt mit dem Launcher.
- **API-Stufe:** HeldixClient 0.13.3 lädt Addons für API 1 bis 5. Ein Addon mit `"api": 2` braucht mindestens HeldixClient 0.11.0, eines mit `"api": 3` mindestens 0.13.1, eines mit `"api": 4` mindestens 0.13.2 und eines mit `"api": 5` mindestens 0.13.3. Welche Stufe dein HeldixClient kann, steht im Heldix-Menü unter **Mods & Addons → Installiert** ganz unten („Heldix Loader … · Addon-API 5“).
- **Zu neues Addon:** Verlangt ein Addon eine höhere API-Stufe, wird es mit „bitte HeldixClient aktualisieren“ übersprungen. HeldixClient kommt mit dem Launcher und wird mit ihm aktualisiert – hol dir also die neueste Launcher-Version.
- **Doppelt installiert:** Liegt dasselbe Addon (gleiche `id`) mehrmals im Ordner, nutzt HeldixClient die neueste Version. Die anderen erscheinen im Heldix-Menü mit „Ältere Version – genutzt wird …“ bzw. „Doppelt installiert – genutzt wird …“.
- **Betriebssystem:** Addons laufen überall, wo HeldixClient läuft – es sei denn, ein Addon nutzt etwas Systemeigenes. Das Spotify-Addon etwa braucht unter Linux das Programm `playerctl`. Im Store steht bei solchen Addons „Nur Windows“ o. Ä.

## Wenn ein Addon nicht lädt

Öffne im Spiel das Heldix-Menü und geh zu **Mods & Addons**, Reiter **Installiert**. Dort steht jedes installierte Addon mit Status: „Aktiv“ mit der Zahl seiner Module oder rot „Fehler“ mit dem Grund. Das Spiel läuft in jedem Fall weiter.

Die häufigsten Meldungen:

- **„heldix.addon.json fehlt in der JAR“** – die Datei muss im Wurzelverzeichnis der JAR liegen. Im Gradle-Projekt gehört sie nach `src/main/resources`.
- **„Ungültige Addon-ID: …“** – die `id` darf nur `a-z`, `0-9`, `_` und `-` enthalten.
- **„"entrypoint" fehlt“** – trag den vollen Klassennamen deiner Addon-Klasse ein.
- **Nur ein Klassenname als Grund** – die Einstiegsklasse wurde nicht gefunden. Prüf Paket und Schreibweise im Feld `entrypoint`.
- **„… implementiert HeldixAddon nicht“** – die Einstiegsklasse muss `HeldixAddon` implementieren und einen öffentlichen Konstruktor ohne Parameter haben.
- **„Gebaut für die veraltete Heldix-API 0 …“** – in der `heldix.addon.json` fehlt das Feld `api`.
- **„Braucht Heldix-API … – bitte HeldixClient aktualisieren“** – das Addon ist neuer als dein HeldixClient, siehe oben.
- **„Nur für Minecraft …“** – das Addon greift in Minecraft ein und ist für eine andere Minecraft-Version gebaut. Nimm eine Instanz mit passender Version oder warte auf ein Update des Addons.
- **„Läuft nur in Heldix-Instanzen“** – das Addon verändert Minecraft-Klassen, die der Heldix Loader in Fabric nicht verändern kann. Nimm eine Heldix-Instanz.
- **„Kein Einstiegspunkt …“** – in der `heldix.addon.json` fehlt `entrypoint`, `clientEntrypoint` oder `transformers`.
- **„Abgeschaltet nach 3 Fehlern: …“** – das Addon hat beim Spielen dreimal einen Fehler geworfen und ist für diese Sitzung aus. Beim nächsten Start wird es wieder geladen.

Die vollständige Fehlermeldung steht im Spiel-Log. Du siehst es im Launcher unter **Konsole** oder als Datei im Ordner `logs` der Instanz (Instanz → Einstellungen → Ordner → **Logs**). Meldungen zu Addons erkennst du am Wort `Heldix-Addon` und dem Namen des Addons.

> **Tipp:** Daten, die ein Addon selbst speichert, liegen in der Instanz unter `config/heldix-addons/` – als `<id>.properties` und im Ordner `<id>`. Löschst du sie, beginnt das Addon wieder bei null.

Kommst du nicht weiter, schreib uns über den [Support](/konto#ziel=support). Was in eine gute Anfrage gehört, steht unter [Fragen und Kontakt](/entwickler/kontakt).
