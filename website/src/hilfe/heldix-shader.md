---
titel: Heldix-Shader und Farbstile
beschreibung: Farbstile wie Kino oder Warm und Effekte wie Bloom, Tiefenunschärfe, Nebel und Umgebungsverdeckung in Heldix-Instanzen.
kategorie: grafik
reihenfolge: 3
stichworte: shader, heldix-shader, farbstil, farben, bloom, leuchten, tiefenunschärfe, nebel, ssao, umgebungsverdeckung, kino, grafik
---
Heldix-Instanzen bringen eigene Shader mit. Sie laufen mit Vulkan und OpenGL und verändern nur die Welt – HUD und Menüs bleiben, wie sie sind.

![Farbstile und Shader-Engine im Heldix-Menü](/images/spiel-shader.png)

## Öffnen
Drücke [[Rechte Umschalttaste]] und wähle **Grafik**, Reiter **Shader**. Änderungen siehst du sofort im Spiel.

## Farbstile
Ein Farbstil verändert Schärfe, Farben, Kontrast und Helligkeit des Bildes:
- **Aus** – originale Minecraft-Farben
- **Klar** – schärfer, etwas mehr Kontrast, gut für PvP
- **Lebendig** – kräftige Farben, leichte Vignette
- **Kino** – starker Kontrast und dunkle Ränder
- **Warm** – goldene, warme Töne
- **Kühl** – bläuliche, kühle Töne
- **Hell** – hellt dunkle Bereiche auf
- **Schwarzweiß** – klassische Graustufen
- **Retro** – Sepia und weniger Farbstufen

Farbstile kosten kaum Leistung.

## Shader-Engine
Die Shader-Engine nutzt zusätzlich die Tiefe des Bildes. Wähle eine Stufe – **Aus**, **Dezent** oder **Kräftig** – und passe die Effekte bei Bedarf einzeln an:
- **Leuchten (Bloom):** helle Stellen strahlen
- **Tiefenunschärfe:** ferne Dinge werden weich
- **Nebel:** Dunst in der Ferne
- **Umgebungsverdeckung:** Schatten in Ecken und Spalten (SSAO)

> **Tipp:** Die Stufe „Kräftig“ kostet spürbar FPS – in unserer Messung rund ein Viertel. Auf schwächeren PCs ist „Dezent“ oder „Aus“ die bessere Wahl.

## Und Shaderpacks wie BSL?
Echte Shaderpacks mit Schatten und Reflexionen brauchen Iris und laufen in Fabric-Instanzen: [Shaderpacks installieren](/hilfe/shaderpacks). Läuft HeldixClient dort mit und ist ein Iris-Shaderpack aktiv, pausieren die Heldix-Shader.
