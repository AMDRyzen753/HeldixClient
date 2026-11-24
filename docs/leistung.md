# Leistung, Vulkan und Shader

Was HeldixClient für mehr FPS tut, wie die Shader funktionieren und was gemessen wurde.

## Vulkan

Minecraft 26.x kann mit OpenGL oder Vulkan zeichnen. HeldixClient nimmt **Vulkan als Standard**:

- Der Launcher hängt beim Start von Heldix-Instanzen `--graphicsBackend vulkan` an ([core/performance.ts](../launcher/src/main/core/performance.ts)). Das gilt nur für Versionen, deren Client-JAR ein Vulkan-Backend hat. Ältere Versionen starten unverändert.
- Fabric- und Vanilla-Instanzen nutzen weiter die Einstellung im Spiel (Optionen → Grafik), weil viele Fabric-Mods nur mit OpenGL laufen.
- Kann der PC kein Vulkan, startet Minecraft von selbst mit OpenGL. Der Launcher schreibt das in die Konsole.
- Stürzt Minecraft ab, während es Vulkan startet, stellt der Launcher die Grafik-API auf „Automatisch“ und sagt Bescheid. Mit dem Startargument greift die eingebaute Absturzerkennung von Minecraft nämlich nicht.
- Umstellen lässt es sich unter **Einstellungen → Leistung → Grafik-API**: Vulkan, Automatisch (Minecraft entscheidet, zurzeit OpenGL) oder OpenGL.

Mojang markiert Vulkan in 26.3 noch als experimentell. Auf einzelnen Treibern kann es Grafikfehler geben. Dann hilft OpenGL.

## Java-Einstellungen

Mit **Optimierte Java-Einstellungen** (Standard: an) startet der Launcher Java mit:

- G1 mit den Werten des offiziellen Minecraft-Launchers (`MaxGCPauseMillis=50`, 32-MB-Regionen …) für kurze GC-Pausen;
- `-XX:+UseCompactObjectHeaders` ab Java 25 (JEP 519). Das braucht weniger Arbeitsspeicher.

Wer in den zusätzlichen JVM-Argumenten selbst einen Garbage Collector wählt (z. B. `-XX:+UseZGC`), bekommt keine G1-Werte dazu. Bei einem eigenen Java-Pfad lässt der Launcher die kompakten Objekt-Header weg, weil er die Java-Version nicht kennt.

## Im Spiel (Heldix-Menü → Grafik)

| Funktion | Was sie tut |
| --- | --- |
| **FPS-Boost** | Stellt teure Optionen auf schnelle Werte: Improved Transparency aus, schnelle Wolken, keine Schatten unter Entities, weniger Partikel, Biom-Übergang 1, Wetter-Radius 5, kein Einblenden neuer Chunks, VSync aus. Die alten Werte merkt sich HeldixClient; Ausschalten stellt sie wieder her. |
| **Hintergrund-FPS** | Höchstens 30 FPS, solange das Fenster nicht im Vordergrund ist. Spart Grafikkarte, Strom und Lüfter, z. B. beim Warten in einer Lobby. |
| **Shader** | Acht Stile als Post-Effekte, siehe unten. |

## Shader

Die Stile sind Post-Effekte im Ressourcenpaket der Mod ([assets/heldixclient](../mod/src/main/resources/assets/heldixclient)):

- `shaders/post/grade.fsh` macht in einem Durchgang Schärfe, Tönung, Sättigung, Kontrast, Helligkeit, Farbstufen und Vignette;
- `post_effect/<stil>.json` legt die Werte je Stil fest.

HeldixClient fordert den gewählten Stil jedes Bild über `GameRenderer.update` an ([Shaders.java](../mod/src/main/java/dev/heldixclient/render/Shaders.java)). Minecraft übersetzt den Shader selbst für Vulkan und OpenGL. Er wirkt nur auf die Welt, HUD und Menüs bleiben unverändert. Kosten: zwei Bildschirm-Durchgänge, auf aktuellen Grafikkarten kaum messbar.

Shaderpacks für OptiFine oder Iris (Schatten, Wasserreflexionen, volumetrisches Licht) gehen damit nicht. Sie bräuchten einen eigenen Renderer.

Einen eigenen Stil anlegen: eine Kopie von `kino.json` mit anderen Werten unter neuem Namen, dazu ein Eintrag in [ShaderPreset.java](../mod/src/main/java/dev/heldixclient/render/ShaderPreset.java).

## F3-Menü

- HeldixClient meldet einen eigenen F3-Eintrag an. Er zeigt Client- und Loader-Version, die tatsächlich genutzte Grafik-API, den Shader, FPS-Boost, Hintergrund-FPS sowie die Zahl der Mods und Addons. In den F3-Optionen (F3 + F6) lässt er sich wie jeder andere Eintrag ausblenden.
- Mit dem Heldix-Design bekommen die F3-Zeilen dunkle Glas-Hintergründe mit blauer Akzentlinie. Mit „Design: Vanilla“ sieht F3 wieder aus wie im normalen Minecraft.

## Messungen

Gemessen mit `npm run test:launch -- 26.3 heldix --benchmark=25`. Dabei gilt: Minecraft 26.3, gleiche Welt und Kamerafahrt, Sichtweite 12, 1600×900, keine FPS-Grenze. Testsystem: NVIDIA GeForce RTX 4070 Ti SUPER (Treiber 621.35), Intel Core i7-13700KF, Java 25.

| Lauf | Ø FPS | 1-%-Tiefs |
| --- | ---: | ---: |
| Vulkan | 2221 | 561 |
| Vulkan | 2153 | 556 |
| Vulkan | 2547 | 702 |
| OpenGL | 1554 | 429 |
| OpenGL | 950 | 128 |
| Vulkan ohne JVM-Abstimmung | 2258 | 611 |
| Vulkan mit FPS-Boost | 2277 | 625 |

Auf diesem PC war Vulkan in jedem Lauf deutlich schneller als OpenGL: etwa 40 % mehr FPS als der bessere OpenGL-Lauf, bei den 1-%-Tiefs etwa 30 % mehr. JVM-Abstimmung und FPS-Boost liegen dagegen innerhalb der Schwankung zwischen den Läufen (gut 10 %). Sie helfen eher auf schwächeren PCs und in längeren Sitzungen als bei diesem kurzen Test auf einer schnellen Grafikkarte. Andere Grafikkarten und Treiber können anders abschneiden. Am besten selbst messen.
