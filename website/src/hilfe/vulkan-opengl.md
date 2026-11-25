---
titel: Vulkan oder OpenGL?
beschreibung: HeldixClient startet Heldix-Instanzen mit Vulkan für mehr FPS. So stellst du die Grafik-API um – und was auf dem Mac gilt.
kategorie: grafik
reihenfolge: 1
stichworte: vulkan, opengl, grafik-api, grafik, fps, grafikkarte, treiber, automatisch, mac, absturz
---
Minecraft 26.x kann mit OpenGL oder mit Vulkan zeichnen. HeldixClient nutzt für Heldix-Instanzen **Vulkan als Standard**: In unseren Messungen brachte Vulkan rund 40 % mehr FPS als OpenGL. Je nach Grafikkarte und Treiber kann das bei dir anders aussehen.

## Wo gilt was?
- **Heldix-Instanzen ab Minecraft 26.x:** Der Launcher startet sie mit der Grafik-API aus den Launcher-Einstellungen (Standard: Vulkan).
- **Fabric- und Vanilla-Instanzen:** nutzen die Einstellung im Spiel unter **Optionen → Grafik**, weil viele Fabric-Mods wie Iris nur mit OpenGL laufen.
- **Ältere Minecraft-Versionen** kennen kein Vulkan und starten wie gewohnt.

## Umstellen
Im Launcher unter **Einstellungen → Leistung → Grafik-API**:
- **Vulkan** – Standard bei HeldixClient. Kann dein PC kein Vulkan, nimmt Minecraft von selbst OpenGL.
- **Automatisch** – Minecraft entscheidet selbst (zurzeit OpenGL).
- **OpenGL** – die bewährte Grafik-API. Gut, falls Vulkan auf deinem PC Probleme macht.

Die Änderung gilt ab dem nächsten Spielstart.

## Welche API läuft gerade?
- im Heldix-Menü unter **Grafik → Leistung**
- im F3-Menü im Eintrag von HeldixClient
- in der **Konsole** des Launchers (Zeile „Grafik-API: …“)

## Absturz beim Start mit Vulkan
Stürzt Minecraft ab, während es Vulkan startet, stellt der Launcher die Grafik-API von selbst auf **Automatisch** und sagt dir Bescheid. Willst du Vulkan später wieder ausprobieren – etwa nach einem Treiber-Update –, stell es in den Einstellungen zurück.

> **Hinweis:** Mojang kennzeichnet Vulkan in Minecraft 26.3 noch als experimentell. Mit einzelnen Grafiktreibern kann es Grafikfehler geben – dann hilft OpenGL. Mehr unter [Grafikfehler und Treiber](/hilfe/grafikprobleme).

## Mac
Auf dem Mac gibt es kein Vulkan. Minecraft wählt die Grafik-API dort selbst, die Auswahl im Launcher ist ausgegraut.
