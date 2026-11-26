---
titel: Mods und Leistungs-Paket installieren
beschreibung: Fabric-Mods direkt von Modrinth installieren, eigene JAR-Dateien hinzufügen und mit einem Klick das Leistungs-Paket holen.
kategorie: launcher
reihenfolge: 2
stichworte: mods, mod installieren, modrinth, fabric, jar, sodium, lithium, ferritecore, leistungs-paket, abhängigkeiten, mod menu
---
Mods von Modrinth laufen in **Fabric-Instanzen**. Der Launcher sucht sie für dich, installiert die passende Version und prüft vor jedem Start, ob alles zusammenpasst.

> **Hinweis:** In Instanzen mit dem Heldix Loader laufen keine Fabric-Mods, und Vanilla-Instanzen haben keine Mods. Für Fabric-Mods legst du eine [Fabric-Instanz](/hilfe/instanzen-und-loader) an.

## Mods von Modrinth installieren
1. Öffne **Instanzen**, wähle deine Fabric-Instanz und den Reiter **Mods & Addons**.
2. Klicke auf **Hinzufügen** und wähle oben **Modrinth**.
3. Suche nach einer Mod, z. B. Sodium oder Mod Menu.
4. Klicke auf **Installieren**.

Der Launcher nimmt automatisch die Version, die zur Minecraft-Version der Instanz passt, und lädt nötige Abhängigkeiten mit.

## Eigene Mod-Dateien
Hast du eine Mod als `.jar`-Datei, ziehe sie in die Liste oder klicke auf **Datei hinzufügen**. Der Launcher erkennt selbst, ob es eine Fabric-Mod oder ein Heldix-Addon ist, und legt sie in den richtigen Ordner. Wie Addons funktionieren, steht unter [Mods & Addons und der Addon-Store](/hilfe/heldix-addons).

## Mods verwalten
- Die Liste zeigt Fabric-Mods und Heldix-Addons zusammen. Chips wie **Fabric-Mod** und **Addon** zeigen, was was ist; oben filterst du nach **Mods**, **Addons**, **Updates** oder **Ausgeschaltet**.
- Der **Schalter** neben einer Mod schaltet sie aus, ohne sie zu löschen.
- Das **Papierkorb-Symbol** entfernt sie aus der Instanz.
- Einträge mit **Schloss** und der Markierung „VERWALTET“ – etwa Fabric API und HeldixClient – hält der Launcher selbst aktuell.

## Das Leistungs-Paket
Mit einem Klick bekommst du bewährte Leistungs-Mods, jeweils in der neuesten Version für deine Minecraft-Version:
- **Sodium** – ersetzt den Chunk-Renderer
- **Lithium** – schnellere Spiellogik
- **FerriteCore** – weniger Arbeitsspeicher
- **ImmediatelyFast** – schnelleres Zeichnen von HUD, Texten und Partikeln
- **Entity Culling** – verdeckte Objekte werden nicht gezeichnet
- **More Culling** – weitere verdeckte Flächen werden weggelassen

So installierst du es:
- in einer bestehenden Fabric-Instanz unter **Mods & Addons → Leistungs-Paket**, oder
- gleich beim Anlegen einer Fabric-Instanz mit dem Schalter **Leistungs-Paket installieren**.

Das Leistungs-Paket gibt es nur für Fabric-Instanzen. In Heldix-Instanzen sorgt stattdessen Vulkan für hohe FPS, siehe [Mehr FPS](/hilfe/mehr-fps).

## Passt alles zusammen?
Vor jedem Start prüft der Launcher, ob alle Fabric-Mods zueinander passen. Verlangt eine Mod eine bestimmte Version einer anderen, installiert er genau diese.

Passt eine Mod aus dem Leistungs-Paket nicht, schaltet er sie ab und schreibt den Grund in die **Konsole**. Selbst installierte Mods schaltet er nie ab – bei einem Konflikt gibt es nur einen Hinweis.

> **Tipp:** Startet das Spiel nach dem Installieren einer Mod nicht mehr, schalte die zuletzt hinzugefügten Mods testweise aus. Mehr dazu unter [Absturz und Crash-Log](/hilfe/absturz).
