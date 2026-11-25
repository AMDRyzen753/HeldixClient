---
titel: Grafikfehler und Grafiktreiber
beschreibung: Flackern, Grafikfehler oder Absturz beim Start mit Vulkan? So wechselst du auf OpenGL und was beim Grafiktreiber hilft.
kategorie: probleme
reihenfolge: 5
stichworte: grafikfehler, grafik, treiber, grafiktreiber, flackern, artefakte, vulkan, opengl, absturz, grafikkarte, gpu
---
HeldixClient startet Heldix-Instanzen mit Vulkan. Das ist meist schneller, aber Mojang kennzeichnet Vulkan in Minecraft 26.3 noch als experimentell. Mit einzelnen Grafiktreibern kann es deshalb Probleme geben.

## Grafikfehler: auf OpenGL wechseln
Siehst du Flackern, falsche Farben oder andere Grafikfehler in einer Heldix-Instanz:
1. Beende Minecraft.
2. Öffne im Launcher **Einstellungen → Leistung → Grafik-API**.
3. Wähle **OpenGL**.
4. Starte das Spiel erneut.

Verschwindet der Fehler, liegt es an Vulkan mit deinem Treiber. Nach einem Treiber-Update kannst du Vulkan wieder ausprobieren.

## Absturz beim Start mit Vulkan
Stürzt Minecraft ab, während es Vulkan startet, stellt der Launcher die Grafik-API von selbst auf **Automatisch** und meldet: „Minecraft ist beim Start mit Vulkan abgestürzt. Die Grafik-API steht jetzt auf „Automatisch“ …“. Starte einfach noch einmal.

Kann dein PC gar kein Vulkan, nimmt Minecraft automatisch OpenGL. In der Konsole steht dann „Vulkan wird auf diesem PC nicht unterstützt – Minecraft nutzt stattdessen OpenGL.“ Das ist kein Fehler.

## Grafiktreiber aktualisieren
Viele Grafikprobleme verschwinden mit einem aktuellen Treiber. Lade ihn direkt beim Hersteller deiner Grafikkarte herunter. Welche Grafikkarte Minecraft gerade nutzt, steht im Heldix-Menü unter **Grafik → Leistung** und unter **Einstellungen → Info**.

## Fabric- und Vanilla-Instanzen
Hier gilt die Einstellung im Spiel unter **Optionen → Grafik**. Shaderpacks über Iris brauchen OpenGL. Gibt es mit einem Shaderpack Grafikfehler, probiere ein anderes Pack oder schalte es im Launcher unter **Instanz → Shader** aus.

## Heldix-Shader
Wirkt das Bild zu dunkel, zu unscharf oder verfärbt, ist vielleicht ein Farbstil oder die Shader-Engine aktiv. Stell beides im Heldix-Menü unter **Grafik → Shader** auf **Aus**. Siehe [Heldix-Shader](/hilfe/heldix-shader).

Mehr zur Grafik-API: [Vulkan oder OpenGL?](/hilfe/vulkan-opengl)
