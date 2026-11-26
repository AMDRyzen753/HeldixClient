---
titel: Voice Chat und Spielermenü
beschreibung: Mit HeldixClient-Spielern in der Nähe oder in deiner Gruppe sprechen – auf jedem Server, ohne Plugin. Und per Mausrad-Klick auf einen Spieler: Freund hinzufügen, Name kopieren, stummschalten.
kategorie: freunde
reihenfolge: 7
stichworte: voice chat, voicechat, gruppe, voice-gruppe, gruppen-passwort, symbol über dem kopf, rauschfilter, signalton, sprechen, mikrofon, proximity, nähe, push-to-talk, ptt, sprachaktivierung, stumm, stummschalten, lautstärke, kopfhörer, spielermenü, mausrad, mittlere maustaste, freund hinzufügen, name kopieren
---
Mit dem Addon **Voice Chat** sprichst du mit anderen HeldixClient-Spielern, die in deiner Nähe sind – auf jedem Server, ganz ohne Plugin. Je weiter jemand weg ist, desto leiser hörst du ihn, und in Stereo hörst du, aus welcher Richtung er spricht.

## Einrichten
1. Installiere **Voice Chat** im Addon-Store (Heldix-Menü → **Heldix → Mods & Addons → Store** oder im Launcher unter **Mods & Addons → Hinzufügen**).
2. Schalte im Heldix-Menü unter **Module** das Modul **Voice Chat** ein. Ab Werk ist es aus.
3. Halte [[V]] gedrückt und sprich. Die Anzeige im HUD zeigt dein Mikrofon und wer gerade spricht (siehe [Anzeige im HUD](#anzeige-im-hud)).

> **Tipp:** Nimm Kopfhörer. Mit Lautsprechern hören die anderen sich sonst selbst.

## Einstellungen
Im Untermenü des Moduls (Zahnrad an der Kachel):
- **Sprechen:** **Push-to-Talk** (Taste halten) oder **Sprachaktivierung** – dann wird gesendet, sobald du lauter als die **Schwelle** sprichst.
- **Mikrofon** und **Mikrofon-Lautstärke**, **Rauschfilter** (nimmt Brummen und leises Rauschen wie Lüfter zwischen deinen Worten weg), **Lautstärke** der anderen.
- **Sprechen und hören mit:** **Allen in der Nähe** oder **Nur Freunden**. „Nur Freunde“ gilt in beide Richtungen; deine Gruppe hörst du immer.
- **Richtung hören** (Stereo) und **Signaltöne** – ein kurzer Ton beim Drücken und Loslassen von Push-to-Talk und beim Stummschalten. Den Ton hörst nur du.
- **Symbole über dem Kopf:** **Aus**, **Nur beim Sprechen** oder **Sprechen und Status** (siehe unten).
- **Gruppe** und **Gruppen-Passwort** (siehe [Gruppen](#gruppen)).
- **Mikrofon testen:** Zehn Sekunden lang hörst du dich selbst. Dabei wird nichts gesendet.
- **Tasten:** Sprechen (ab Werk [[V]]), **Mikrofon stumm** und **Ton aus** – frei belegbar.

## Gruppen
Mit einer Gruppe sprecht ihr auf dem ganzen Server miteinander – egal wie weit ihr auseinander seid, auch wenn einer im Nether ist.
1. Tragt im Untermenü von **Voice Chat** alle denselben Namen unter **Gruppe** ein, z. B. „Bau“. Groß- und Kleinschreibung zählt nicht.
2. Wer will, dass nicht jeder dazukommt, vergibt zusätzlich ein **Gruppen-Passwort** – das müssen dann alle gleich eintragen.
3. Eine Einblendung sagt dir, dass du drin bist und wer dazukommt oder geht. Die Anzeige im HUD zeigt die Gruppe und wie viele dabei sind.

Spieler in deiner Nähe hören dich weiterhin wie gewohnt, und du sie. In eine Gruppe passen höchstens 16 Spieler. Feld **Gruppe** leeren = Gruppe verlassen. Sprecher aus deiner Gruppe erscheinen in **Violett**.

## Symbole über dem Kopf
Über dem Namensschild anderer Spieler siehst du, was im Voice Chat los ist:
- **Lautsprecher mit Wellen** (grün, deine Gruppe violett): spricht gerade – je lauter, desto mehr Wellen.
- **Durchgestrichenes Mikrofon** (rot): hat sein Mikrofon stumm geschaltet.
- **Durchgestrichene Kopfhörer** (rot): hat den Ton aus und hört gerade niemanden.
- **Durchgestrichener Lautsprecher** (grau): hast du selbst stumm geschaltet.

Die Symbole folgen dem Namensschild: Mit [[F1]], bei Unsichtbarkeit oder wenn der Server Namen ausblendet, sind sie weg; beim Schleichen werden sie blass.

## Anzeige im HUD
Das HUD-Element **Voice Chat-Anzeige** zeigt oben dein Mikrofon (an, stumm, Ton aus) mit Pegel, darunter wie viele in Reichweite sind und deine Gruppe, dann die Köpfe der Sprecher mit hüpfenden Balken. Mit offenem Chat erscheinen Knöpfe, mit denen du dein Mikrofon stumm schaltest oder den Ton ausmachst. Im [HUD-Editor](/hilfe/hud-editor) wählst du per Rechtsklick **Liste** oder **Kompakt** (nur Mikrofon und Köpfe), ob Köpfe erscheinen und ob die Anzeige nur sichtbar ist, wenn etwas los ist.

## Wer dich hört
Deine Stimme geht über den Heldix-Dienst an HeldixClient-Spieler mit eingeschaltetem Voice Chat, die auf demselben Server und in derselben Welt höchstens 48 Blöcke von dir entfernt sind – und an die Mitglieder deiner Gruppe auf diesem Server. Ob dein Mikrofon stumm oder dein Ton aus ist, sehen dieselben Spieler. Wen du blockiert hast oder wer dich blockiert hat, hört dich nicht. Der Heldix-Dienst speichert keine Sprache und keine Positionen; von der Gruppe bekommt er nur einen Prüfwert, nie Name oder Passwort. Mehr dazu in der [Datenschutzerklärung](/datenschutz).

Im Einzelspieler und auf Servern im eigenen Netzwerk (LAN) gibt es keinen Voice Chat.

## Spielermenü
Ziel mit dem Fadenkreuz auf einen anderen Spieler und klicke mit dem **Mausrad**. Es öffnet sich ein Kreismenü:
- **Freund hinzufügen** – bzw. **Anfrage annehmen**, und bei Freunden **Nachricht**. Das geht nur bei HeldixClient-Spielern.
- **Name kopieren** – der Name landet in der Zwischenablage.
- Mit Voice Chat: **Stummschalten**, **Lauter** und **Leiser** – nur für diesen Spieler.

In der Mitte stehen Name, HeldixClient-Rolle und Abstand, darunter die Cosmetics, die er trägt. Wähle mit der Maus oder den Zahlen [[1]] bis [[9]]; [[Esc]] schließt das Menü. Die Taste änderst du unter **System → Einstellungen → Tasten** („Spielermenü“). Ab Werk teilt sie sich das Mausrad mit „Block auswählen“ – auf Spielern macht Minecraft damit nichts.
