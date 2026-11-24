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

## Im Spiel (Heldix-Menü → Leistung)

| Funktion | Was sie tut |
| --- | --- |
| **FPS-Boost** | Stellt teure Optionen auf schnelle Werte: Improved Transparency aus, schnelle Wolken, keine Schatten unter Entities, weniger Partikel, Biom-Übergang 1, Wetter-Radius 5, kein Einblenden neuer Chunks, VSync aus. Die alten Werte merkt sich HeldixClient; Ausschalten stellt sie wieder her. |
| **Hintergrund-FPS** | Höchstens 30 FPS, solange das Fenster nicht im Vordergrund ist. Spart Grafikkarte, Strom und Lüfter, z. B. beim Warten in einer Lobby. |

## Shader

Es gibt zwei Wege zu Shadern:

| | Heldix-Instanz | Fabric-Instanz |
| --- | --- | --- |
| Was | Heldix-Shader: Farbstile und Shader-Engine | Shaderpacks wie BSL, Complementary, Photon |
| Technik | Post-Effekte von Minecraft (Vulkan und OpenGL) | Iris + Sodium (nur OpenGL) |
| Einstellen | Heldix-Menü → Shader | Launcher → Instanz → Shader, im Spiel Optionen → Grafik → Shaderpacks |
| Schatten, Reflexionen | nein | ja (je nach Pack) |
| HeldixClient-HUD und -Menü | ja | nein |

### Heldix-Shader

**Farbstile** sind Post-Effekte im Ressourcenpaket der Mod ([assets/heldixclient](../mod/src/main/resources/assets/heldixclient)):

- `shaders/post/grade.fsh` macht in einem Durchgang Schärfe, Tönung, Sättigung, Kontrast, Helligkeit, Farbstufen und Vignette;
- `post_effect/<stil>.json` legt die Werte je Stil fest.

HeldixClient fordert den gewählten Stil jedes Bild über `GameRenderer.update` an ([Shaders.java](../mod/src/main/java/dev/heldixclient/render/Shaders.java)). Minecraft übersetzt den Shader selbst für Vulkan und OpenGL. Er wirkt nur auf die Welt, HUD und Menüs bleiben unverändert. Kosten: zwei Bildschirm-Durchgänge, auf aktuellen Grafikkarten kaum messbar.

Einen eigenen Stil anlegen: eine Kopie von `kino.json` mit anderen Werten unter neuem Namen, dazu ein Eintrag in [ShaderPreset.java](../mod/src/main/java/dev/heldixclient/render/ShaderPreset.java).

Die **Shader-Engine** ([engine.json](../mod/src/main/resources/assets/heldixclient/post_effect/engine.json), [ShaderEngine.java](../mod/src/main/java/dev/heldixclient/render/ShaderEngine.java)) nutzt zusätzlich die Tiefe des Bildes:

- **Leuchten (Bloom):** helle Stellen auf ein kleines Bild (480×270) verkleinern, weichzeichnen, wieder dazurechnen;
- **Tiefenunschärfe:** alles hinter dem Punkt in der Bildmitte wird weicher;
- **Nebel:** Dunst, der mit der Entfernung dichter wird und am Ende der Sichtweite genau in Minecrafts Nebel übergeht;
- **Umgebungsverdeckung (SSAO):** 16 Tiefenproben pro Pixel dunkeln Ecken, Spalten und Kanten ab, nur in der Nähe.

Post-Effekte kennen sonst nur feste Werte aus der JSON. Regler, Sichtweite, Sichtfeld und Nebelfarbe kommen deshalb über eine 8×1-Pixel-Textur in den Shader, die HeldixClient jedes Bild neu füllt. Minecraft 26.x speichert die Tiefe umgekehrt (nah = 1, fern = 0); die Shader rechnen das in Blöcke um.

Kosten (Messung unten, gleiche Szene): Stufe „Kräftig“ etwa 24 % weniger FPS, „Aus“ kostet nichts.

### Shaderpacks über Iris

Echte Shaderpacks ersetzen große Teile von Minecrafts Renderer (Schattenkarte, eigene Programme für jede Art von Geometrie). Dafür gibt es Iris; ein eigener Nachbau wäre ein Projekt von vielen Monaten. Der Launcher macht Iris deshalb so bequem wie möglich ([core/shaderpacks.ts](../launcher/src/main/core/shaderpacks.ts)):

- **Instanz → Shader → Shaderpacks entdecken** sucht Iris-Shaderpacks auf Modrinth für die Minecraft-Version der Instanz;
- **Installieren** lädt das Pack nach `shaderpacks/`, installiert beim ersten Mal Iris und genau die Sodium-Version, die Iris verlangt, und schaltet das Pack in `config/iris.properties` ein;
- der Schalter je Pack wählt das aktive Pack oder schaltet Shader aus; eigene .zip-Dateien gehen über „Datei hinzufügen“.

Shaderpacks laufen nur in Fabric-Instanzen. Iris braucht OpenGL; der Launcher erzwingt Vulkan deshalb nur bei Heldix-Instanzen.

## F3-Menü

- HeldixClient meldet einen eigenen F3-Eintrag an. Er zeigt Client- und Loader-Version, die tatsächlich genutzte Grafik-API, den Shader, FPS-Boost, Hintergrund-FPS sowie die Zahl der Mods und Addons. In den F3-Optionen (F3 + F6) lässt er sich wie jeder andere Eintrag ausblenden.
- Die F3-Zeilen bekommen dunkle Glas-Hintergründe mit blauer Akzentlinie. Abschalten unter Heldix-Menü → Einstellungen → „F3-Menü im Heldix-Design“.

## Fabric: Sodium, Lithium & Co.

In Fabric-Instanzen gibt es unter **Instanz → Mods → Leistungs-Paket** die bekannten Leistungs-Mods mit einem Klick, jeweils in der neuesten Version für die Minecraft-Version der Instanz:

| Mod | Was sie tut |
| --- | --- |
| Sodium | ersetzt den Chunk-Renderer (OpenGL) |
| Lithium | schnellere Spiellogik (Welt, Physik, KI) |
| FerriteCore | weniger Arbeitsspeicher |
| ImmediatelyFast | schnelleres Zeichnen von HUD, Texten und Partikeln |
| Entity Culling | verdeckte Entities und Block-Entities nicht zeichnen |
| More Culling | weitere verdeckte Flächen weglassen |

HeldixClient läuft in Fabric-Instanzen mit (siehe [Heldix Loader in Fabric](heldix-loader.md#heldix-loader-in-fabric)).

**Versionen, die zusammenpassen:** Mods schließen sich gegenseitig aus, zum Beispiel verlangt Iris 1.11.7 genau Sodium 0.9.2, und More Culling 1.9.2 braucht ein neueres Sodium. Der Launcher kümmert sich darum:

- Verlangt eine Mod eine bestimmte Version einer Abhängigkeit (wie Iris → Sodium 0.9.2), installiert der Launcher genau diese und tauscht eine andere Version aus ([core/modrinth.ts](../launcher/src/main/core/modrinth.ts)).
- Vor jedem Start prüft er die Regeln `depends` und `breaks` aller Fabric-Mods, genau wie Fabric selbst ([core/fabricmods.ts](../launcher/src/main/core/fabricmods.ts)). Passt eine Zusatz-Mod aus dem Leistungs-Paket nicht, schaltet er sie aus und schreibt den Grund in die Konsole. Iris, Sodium und selbst installierte Mods schaltet er nie ab; bei einem Konflikt zwischen ihnen gibt er nur einen Hinweis.

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
| Vulkan, Shader-Engine aus (10 s) | 2396 | 560 |
| Vulkan, Shader-Engine „Kräftig“ (10 s) | 1827 | 502 |
| **Fabric** + HeldixClient + Leistungs-Paket (Sodium, OpenGL) | 1818 | 694 |
| Heldix, Vulkan (gleiche Sitzung) | 2546 | 704 |

Fabric mit dem Leistungs-Paket hebt OpenGL deutlich an: die 1-%-Tiefs von 128–429 auf 694 (so ruhig wie Vulkan), der Durchschnitt von 950–1554 auf 1818. Am meisten FPS im Durchschnitt hat auf diesem PC trotzdem die Heldix-Instanz mit Vulkan.

Auf diesem PC war Vulkan in jedem Lauf deutlich schneller als OpenGL: etwa 40 % mehr FPS als der bessere OpenGL-Lauf, bei den 1-%-Tiefs etwa 30 % mehr. JVM-Abstimmung und FPS-Boost liegen dagegen innerhalb der Schwankung zwischen den Läufen (gut 10 %). Sie helfen eher auf schwächeren PCs und in längeren Sitzungen als bei diesem kurzen Test auf einer schnellen Grafikkarte. Andere Grafikkarten und Treiber können anders abschneiden. Am besten selbst messen.
