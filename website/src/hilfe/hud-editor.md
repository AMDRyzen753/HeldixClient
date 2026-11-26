---
titel: Der HUD-Editor
beschreibung: HUD-Elemente verschieben, ausrichten und gestalten – mit Rechtsklick-Menü, Einrasten, Mehrfachauswahl, Rückgängig und anklickbaren Elementen im Spiel.
kategorie: spiel
reihenfolge: 3
stichworte: hud, hud-editor, verschieben, position, größe, skalieren, einrasten, raster, hilfslinien, rückgängig, wiederholen, strg+z, strg+y, zurücksetzen, ausblenden, rechtsklick, kontextmenü, mehrfachauswahl, stil, deckkraft, akzentfarbe, anklickbar, hud bedienen
---
Im HUD-Editor legst du fest, wo FPS, Koordinaten, Keystrokes und Co. auf dem Bildschirm stehen, wie groß sie sind und wie sie aussehen.

![HUD-Editor mit Werkzeugleiste und Elemente-Liste](/images/spiel-hud-editor.png)

## Öffnen
- im Heldix-Menü unter **Module** mit dem Knopf **HUD-Editor** oben rechts
- im Heldix-Menü unter **Einstellungen → Allgemein → HUD-Editor**
- im Pausemenü über **HUD-Editor**

## Verschieben und Größe ändern
- **Verschieben:** Ziehe ein Element mit der Maus. Es rastet an den Bildschirmrändern, an der Mitte, an den Kanten und Mitten anderer Elemente (bündig oder direkt daneben) und am Raster ein. Hilfslinien zeigen, woran. Halte [[Strg]] oder [[Alt]] gedrückt, um es frei zu platzieren.
- **Größe:** Ziehe am Punkt an der unteren rechten Ecke oder drehe das Mausrad über dem Element.
- **Mehrere auf einmal:** Klicke mit gedrückter [[Umschalt]]-Taste weitere Elemente an oder ziehe auf freier Fläche einen Rahmen um sie. Die Auswahl verschiebst du dann zusammen. [[Strg]]+[[A]] wählt alle.

Jedes Element hängt an der nächsten Ecke, Kante oder der Mitte des Bildschirms – der kleine Punkt am Rand zeigt, wo. So bleibt ein Element unten rechts auch nach einer anderen Fenstergröße oder GUI-Skalierung unten rechts, und es wächst vom Rand weg, wenn sein Inhalt breiter wird. Vom Bildschirm verschwinden kann es nicht.

## Das Rechtsklick-Menü
Ein **Rechtsklick auf ein Element** (oder [[Enter]] bei ausgewähltem Element) öffnet sein Menü. Sind mehrere ausgewählt, gilt alles für die ganze Auswahl.
- **Ausrichtung:** Automatisch, Links, Mitte oder Rechts – richtet den Inhalt aus und bestimmt, in welche Richtung das Element wächst.
- **Skalierung:** feste Größen von 50 bis 200 % oder in 5-%-Schritten kleiner und größer.
- **Hintergrund** an oder aus, **Deckkraft** (wie global oder eigene), **Farben** (Akzentfarbe und Textfarbe), **Schatten** und **Rahmen**.
- **Ebene:** nach vorn oder nach hinten, wenn sich Elemente überdecken.
- **An Raster einrasten:** setzt das Element auf die nächste Rasterlinie.
- **Optionen:** eigene Einstellungen des Elements, z. B. die Darstellung der Koordinaten oder beim Spotify-Addon „Groß mit Cover“.
- **Einstellungen öffnen**, **Zurücksetzen** (Position, Größe und Aussehen) und **Ausblenden**.

Ein **Rechtsklick auf freie Fläche** bietet **Widget hinzufügen** (ausgeblendete Elemente, auch die von Addons, erscheinen an dieser Stelle), den **HUD-Stil**, **Raster**, **Hilfslinien** und **Einrasten** an und aus, **Alles auswählen**, **Rückgängig**, **Wiederholen** und **Alles zurücksetzen**.

Das Menü klappt am Bildschirmrand nach links bzw. oben auf. Mit der Tastatur: Pfeiltasten wählen, [[Pfeil rechts]] öffnet ein Untermenü, [[Pfeil links]] schließt es, [[Enter]] führt aus, [[Esc]] schließt das Menü.

## Mit der Tastatur
Klicke ein Element an, um es auszuwählen. Dann gilt:
- Pfeiltasten verschieben um 1 Pixel, mit [[Umschalt]] um 10 Pixel – auch mehrere Elemente zusammen.
- [[Tab]] wählt das nächste Element, [[Umschalt]]+[[Tab]] das vorherige.
- [[Entf]] blendet die Auswahl aus.
- [[Strg]]+[[Z]] macht den letzten Schritt rückgängig, [[Strg]]+[[Y]] stellt ihn wieder her.
- [[G]] schaltet das Raster ein oder aus, [[Esc]] hebt die Auswahl auf.

## Die Werkzeugleiste
- **Elemente:** Liste aller HUD-Elemente. Der Schalter blendet ein Element ein oder aus, das Regler-Symbol öffnet seine Einstellungen.
- **Raster:** blendet ein Raster mit Mittellinien als Orientierung ein.
- **Einrasten:** schaltet das Einrasten an Rändern, Elementen und Raster ein oder aus.
- **Rückgängig** und **Wiederholen:** wie [[Strg]]+[[Z]] und [[Strg]]+[[Y]].
- **Standard:** setzt alle Positionen und Größen zurück (auch mit [[R]]).
- **Fertig:** schließt den Editor.

Änderungen speichert HeldixClient sofort.

## Aussehen für alle Elemente
Unter **Einstellungen → Allgemein → HUD** wählst du den **HUD-Stil** (Heldix wie das Menü, Minimal ohne Fläche oder Klassisch wie früher), die **Deckkraft**, die **HUD-Größe** und die **Akzentfarbe** für alle Elemente. **Scharfe Schrift** rundet Größen so, dass Text bei jeder GUI-Skalierung sauber aussieht. Dort legst du auch fest, ob das HUD mit [[F3]] oder bei offenem Chat verschwindet. Mit [[F1]] ist es wie immer ganz aus.

## Elemente im Spiel anklicken
Solange der **Chat offen** ist, kannst du HUD-Elemente anklicken: Beim Überfahren bekommen sie einen Rahmen und einen Tooltip.
- **Koordinaten:** Klick fügt sie in die Chat-Eingabe ein, mit [[Umschalt]] werden sie kopiert.
- **FPS:** öffnet Leistung und FPS-Boost. **Ping:** öffnet seine Einstellungen.
- **Rüstung** und **Trank-Effekte:** der Tooltip zeigt Haltbarkeit, Verzauberungen bzw. Restzeit.
- **Wegpunkt-Markierungen:** Klick öffnet die Wegpunkte.
- **Addons** wie Spotify zeigen eigene Knöpfe, z. B. Abspielen/Pause.
- **Rechtsklick** auf ein Element öffnet seine Einstellungen.

Ohne Chat geht das mit der Taste **„HUD bedienen“**: Sie gibt die Maus frei, ohne den Chat zu öffnen. Kurz drücken lässt sie frei, bis du die Taste noch einmal oder [[Esc]] drückst; gedrückt halten gibt sie nur so lange frei. Ab Werk ist die Taste nicht belegt – du legst sie unter **Optionen → Steuerung → HeldixClient** fest. Beim normalen Spielen reagiert das HUD nie auf Klicks, und ein Klick auf ein Element trifft nichts im Spiel.

> **Tipp:** Aus Versehen alles verschoben oder zurückgesetzt? [[Strg]]+[[Z]] holt den vorigen Stand zurück.
