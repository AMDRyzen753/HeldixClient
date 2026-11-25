---
titel: Addons installieren und Fehler finden
beschreibung: Wo Addons hingehören, wie du sie aus dem Addon-Store oder als eigene JAR installierst und abschaltest – und was du tust, wenn ein Addon nicht lädt.
reihenfolge: 4
stichworte: installieren, heldix-addons, addon-store, store, ordner, launcher, abschalten, kompatibilität, fehler, log, fehlersuche
---
Heldix-Addons laufen in jeder Instanz mit HeldixClient: in Heldix-Instanzen und in Fabric-Instanzen, in denen HeldixClient eingeschaltet ist (Instanz → Einstellungen → HeldixClient). Jede Instanz hat ihren eigenen Ordner `heldix-addons`, Addons gelten also immer nur für die Instanz, in die du sie legst. In reinen Vanilla-Instanzen gibt es keine Addons.

Den Launcher bekommst du unter [Download](/download). Die Kurzfassung für Spieler steht im Hilfe-Center unter [Heldix-Addons](/hilfe/heldix-addons).

## Aus dem Addon-Store

Fertige Addons wie **Spotify** und **Uhrzeit & Spielzeit** kommen nicht mehr mit dem Launcher, sondern aus dem [Addon-Store](/addons). Jede Version dort hat das Team geprüft und mit seinem Schlüssel signiert.

- **Im Launcher:** Instanz → Reiter **Heldix-Addons** → **Addon-Store** → **Installieren** bzw. **Aktualisieren**. Der Launcher prüft dabei Signatur, SHA-256-Prüfsumme und die `heldix.addon.json` der Datei.
- **Im Spiel:** Heldix-Menü → **Addons**, Reiter **Addon-Store**. Installieren, Aktualisieren und Entfernen (Papierkorb neben dem Knopf) wirken beim nächsten Start.
- **Auf der Webseite:** Auf der Seite des Addons im [Addon-Store](/addons) lädst du die JAR herunter und legst sie wie unten beschrieben von Hand in den Ordner.

## Eigene JAR im Launcher installieren

1. Öffne im Launcher **Instanzen** und wähle die Instanz aus.
2. Wechsle in den Reiter **Heldix-Addons**.
3. Zieh die `.jar`-Datei in die Liste oder klick auf **Addon-Datei hinzufügen**.
4. Starte das Spiel. Addons werden beim Spielstart geladen – läuft das Spiel schon, starte es neu.

Der Launcher liest dabei die `heldix.addon.json` der Datei. Fehlt sie, steht in der Liste „Kein Heldix-Addon (heldix.addon.json fehlt)“.

> **Hinweis:** Das Spotify-Addon liest den laufenden Song über die Windows-Mediensteuerung. Es braucht keine Anmeldung, funktioniert aber nur unter Windows. Die Tasten sind [[Pos1]] (Abspielen/Pause), [[Bild ab]] (nächster Song) und [[Bild auf]] (vorheriger Song).

## Von Hand in den Ordner legen

Du kannst ein Addon auch direkt in den Ordner `heldix-addons` der Instanz kopieren. Am schnellsten kommst du dorthin über Instanz → **Einstellungen** → Karte **Ordner** → **Addons**. Unter Windows liegen die Instanzen unter `%APPDATA%\.heldixclient\instances\`.

- Leg die JAR direkt in den Ordner, nicht in einen Unterordner.
- Den Ordner legt HeldixClient beim ersten Start selbst an, falls er fehlt.

> **Achtung:** Addons gehören nicht in den Ordner `mods`. Dort überspringt sie der Heldix Loader mit dem Hinweis „Heldix-Addon – gehört in den Ordner heldix-addons, nicht nach mods“.

## Abschalten, löschen, einstellen

- **Abschalten:** der Schalter in der Liste des Launchers. Der Launcher benennt die Datei dann in `.jar.disabled` um, und HeldixClient lässt sie beim Start liegen.
- **Löschen:** das Papierkorb-Symbol in der Liste.
- **Einzelne Module:** Im Spiel öffnet die rechte [[Umschalt]]-Taste das Heldix-Menü. Unter **Module** (Reiter „Addons“) schaltest du jedes Modul eines Addons einzeln an und aus; das Zahnrad an der Karte öffnet seine Einstellungen. HUD-Elemente verschiebst du im HUD-Editor.
- **Tasten:** unter Optionen → Steuerung in der Gruppe „Heldix-Addons“.

## Kompatibilität

- **Minecraft-Versionen:** Addons nutzen nur die Heldix-API. Dieselbe JAR läuft deshalb auch nach Minecraft-Updates weiter, solange es HeldixClient für die Version gibt.
- **API-Stufe:** HeldixClient 0.13.0 lädt Addons für API 1 und API 2. Ein Addon mit `"api": 2` braucht mindestens HeldixClient 0.11.0. Welche Stufe dein HeldixClient kann, steht im Heldix-Menü unter **Addons → Installiert** ganz unten („Heldix Loader … · Addon-API 2“).
- **Zu neues Addon:** Verlangt ein Addon eine höhere API-Stufe, wird es mit „bitte HeldixClient aktualisieren“ übersprungen. HeldixClient kommt mit dem Launcher und wird mit ihm aktualisiert – hol dir also die neueste Launcher-Version.
- **Doppelt installiert:** Liegt dasselbe Addon (gleiche `id`) mehrmals im Ordner, nutzt HeldixClient die neueste Version. Die anderen erscheinen im Heldix-Menü mit „Ältere Version – genutzt wird …“ bzw. „Doppelt installiert – genutzt wird …“.
- **Betriebssystem:** Addons laufen überall, wo HeldixClient läuft – es sei denn, ein Addon nutzt etwas Systemeigenes, wie das Spotify-Addon die Windows-Mediensteuerung.

## Wenn ein Addon nicht lädt

Öffne im Spiel das Heldix-Menü und geh zu **Addons**, Reiter **Installiert**. Dort steht jedes installierte Addon mit Status: „Aktiv“ mit der Zahl seiner Module oder rot „Fehler“ mit dem Grund. Das Spiel läuft in jedem Fall weiter.

Die häufigsten Meldungen:

- **„heldix.addon.json fehlt in der JAR“** – die Datei muss im Wurzelverzeichnis der JAR liegen. Im Gradle-Projekt gehört sie nach `src/main/resources`.
- **„Ungültige Addon-ID: …“** – die `id` darf nur `a-z`, `0-9`, `_` und `-` enthalten.
- **„"entrypoint" fehlt“** – trag den vollen Klassennamen deiner Addon-Klasse ein.
- **Nur ein Klassenname als Grund** – die Einstiegsklasse wurde nicht gefunden. Prüf Paket und Schreibweise im Feld `entrypoint`.
- **„… implementiert HeldixAddon nicht“** – die Einstiegsklasse muss `HeldixAddon` implementieren und einen öffentlichen Konstruktor ohne Parameter haben.
- **„Gebaut für die veraltete Heldix-API 0 …“** – in der `heldix.addon.json` fehlt das Feld `api`.
- **„Braucht Heldix-API … – bitte HeldixClient aktualisieren“** – das Addon ist neuer als dein HeldixClient, siehe oben.
- **„Abgeschaltet nach 3 Fehlern: …“** – das Addon hat beim Spielen dreimal einen Fehler geworfen und ist für diese Sitzung aus. Beim nächsten Start wird es wieder geladen.

Die vollständige Fehlermeldung steht im Spiel-Log. Du siehst es im Launcher unter **Konsole** oder als Datei im Ordner `logs` der Instanz (Instanz → Einstellungen → Ordner → **Logs**). Meldungen zu Addons erkennst du am Wort `Heldix-Addon` und dem Namen des Addons.

> **Tipp:** Daten, die ein Addon selbst speichert, liegen in der Instanz unter `config/heldix-addons/` – als `<id>.properties` und im Ordner `<id>`. Löschst du sie, beginnt das Addon wieder bei null.

Kommst du nicht weiter, schreib uns über den [Support](/konto#ziel=support). Was in eine gute Anfrage gehört, steht unter [Fragen und Kontakt](/entwickler/kontakt).
