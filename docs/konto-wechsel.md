# Konto-Wechsel im Spiel

Im Spiel lässt sich zwischen den Microsoft-Konten wechseln, die der HeldixClient-Launcher verwaltet – ohne das Spiel
neu zu starten. Neue Konten meldet der Launcher an (sein normales Microsoft-Anmeldefenster). Dafür sprechen Spiel und
Launcher über **stdin/stdout des Spielprozesses** miteinander: kein Netzwerk-Port, kein Geheimnis in Argumenten oder
Umgebungsvariablen. Nur der Launcher hält das Schreib-Ende von stdin des Spiels, also kann nur er antworten.

| Teil | Datei |
| --- | --- |
| Protokoll im Launcher (Marker ausschneiden, Anfragen prüfen, Grenzen) | `launcher/src/main/core/accountipc.ts` |
| Sitzungen (Erneuern über das Refresh-Token) | `launcher/src/main/core/sessions.ts` |
| Spielstart (stdin als Leitung, Filter vor dem Log-Parser) | `launcher/src/main/core/launch.ts` |
| Verbindung im Spiel | `mod/src/main/java/dev/heldixclient/account/LauncherLink.java` |
| Wechsel in Minecraft | `mod/.../account/SessionSwitcher.java`, `AccountPatches.java` |
| Für die Oberfläche | `mod/.../account/AccountSwitcher.java`; Seite Konten in `screen/HeldixMenuScreen.java`, Profil-Klick `screen/ProfileButton.java` |
| Tests | `npm run test:accounts-ipc` (Launcher, ohne Spiel); im Spiel `AccountTests` im Autotest (`npm run test:launch -- 26.3 heldix --autotest`, allein mit `HELDIX_AUTOTEST_ONLY=konten`) |

## Ablauf

1. Der Launcher startet eine Instanz mit HeldixClient mit `-Dheldixclient.ipc=1` (kein Geheimnis, nur „hier antwortet
   ein Launcher“). Ohne diesen Schalter fasst die Mod stdin nicht an und schreibt nichts auf stdout – dann ist der
   Konto-Wechsel ausgeblendet (z. B. Start über einen anderen Launcher).
2. Die Mod schickt `hello`. Kommt binnen 5 s keine passende Antwort, bleibt der Wechsel aus.
3. Die Oberfläche lädt `accounts.list`, holt zum Wechseln `accounts.session` und meldet danach `accounts.setActive`,
   damit der nächste Start aus dem Launcher dasselbe Konto nutzt.

## Übertragung

**Spiel → Launcher (stdout):** eine Zeile

```
\u0001heldix-ipc {json}\n
```

`\u0001` ist das Steuerzeichen SOH (Byte `0x01`), danach `heldix-ipc` und ein Leerzeichen. Die Mod schreibt die ganze
Zeile in einem Schreibvorgang direkt auf den Datei-Deskriptor von stdout – an `System.out` vorbei, das Minecraft ins
Log umleitet. So landet sie nie in `latest.log`.

Der Launcher schneidet Marker-Zeilen **immer** aus der Ausgabe, bevor der Log-Parser sie sieht – auch über
Blockgrenzen hinweg und mitten in einem Log-Ereignis (wenn ein anderer Thread gleichzeitig loggt). Sie erscheinen nie
in der Konsole, in der Absturz-Hilfe oder in Support-Anfragen. Marker-Zeilen auf **stderr** werden ebenfalls
ausgeschnitten, aber nicht beantwortet. Längste Anfrage: 4096 Zeichen (JSON ohne Marker); längere werden verworfen,
ohne gepuffert zu werden.

**Launcher → Spiel (stdin):** eine JSON-Zeile pro Nachricht, ohne Marker. Die Mod liest bis 256 KiB pro Zeile.

## Nachrichten

Alle Nachrichten haben `"v": 1` (Protokollversion).

### Anfrage

```json
{"v":1,"id":7,"op":"accounts.session","params":{"account":"3f0c…-…"}}
```

| Feld | Regel |
| --- | --- |
| `v` | genau `1` |
| `id` | ganze Zahl von 1 bis 2147483647; nicht zweimal gleichzeitig offen |
| `op` | `hello`, `accounts.list`, `accounts.session`, `accounts.add`, `accounts.setActive` |
| `params` | Objekt oder weggelassen; nur die Parameter der Operation |

Weitere Felder sind nicht erlaubt. Konto-IDs sind die IDs des Launchers (UUID-Format mit Bindestrichen).

### Antwort

```json
{"v":1,"id":7,"ok":true,"result":{…}}
{"v":1,"id":7,"ok":false,"error":{"code":"not_found","message":"Dieses Konto gibt es im Launcher nicht (mehr)."}}
```

Konnte der Launcher die Anfrage nicht lesen (kein JSON, keine gültige ID), kommt `"id": null`. `message` ist ein Text
für den Spieler (Deutsch); der Launcher entfernt daraus alles, was nach einem Token aussieht.

### Ereignis

```json
{"v":1,"event":"accounts.changed"}
```

Die Konten haben sich im Launcher geändert (hinzugefügt, entfernt, gewählt, neuer Skin) – die Mod lädt die Liste neu.
Ereignisse kommen erst nach `hello` und werden gebündelt (150 ms).

## Operationen

| Operation | Parameter | Ergebnis |
| --- | --- | --- |
| `hello` | – | `{"protocol":1,"launcher":"0.13.4","offline":false,"allowed":true}` |
| `accounts.list` | – | `{"accounts":[Konto, …],"allowed":true}` |
| `accounts.session` | `account` | `{"name","uuid","accessToken","userType","xuid"?}` |
| `accounts.add` | – | `{"account":Konto,"accounts":[Konto, …]}` |
| `accounts.setActive` | `account` | `{"accounts":[Konto, …]}` |

`offline`: Entwicklungsversion, Offline-Konten erlaubt. `allowed`: Einstellung „Kontowechsel im Spiel erlauben“ im
Launcher (Einstellungen → Spiel, Standard an). Ist sie aus, antworten `accounts.session`, `accounts.add` und
`accounts.setActive` mit `not_allowed` und die Mod blendet den Wechsel aus. Schaltet man sie um, während das Spiel
läuft, kommt `accounts.changed`; die neue Liste bringt den neuen Wert mit.

**Konto:** `{"id","name","uuid","type","active","skinUrl"?}` – `uuid` ohne Bindestriche, `type` `microsoft` oder
`offline`, `active` = im Launcher gewählt (nicht unbedingt das Konto im Spiel). Nie Tokens.

**accounts.session:** liefert eine gültige Minecraft-Sitzung. Läuft das Token in weniger als 10 Minuten ab, erneuert
der Launcher es vorher über sein Refresh-Token (wie beim Spielstart; mehrere Anfragen teilen sich eine Erneuerung).
`uuid` ohne Bindestriche, `userType` `msa` (Microsoft) oder `legacy` (Offline-Konto, Token `"0"`). Refresh-Tokens
verlassen den Launcher nie. Das aktive Konto im Launcher ändert sich dabei nicht.

Beim **ersten** Wechsel zu einem Konto in diesem Spiel fragt der Launcher nach: ein kleines Fenster über allem (mit
Fokus) „Im Spiel zu <Name> wechseln?“ mit dem Namen der Instanz und [Wechseln] [Abbrechen]. Abbrechen, Escape, Schließen
oder 2 Minuten ohne Antwort ergeben `cancelled`. Nach einem „Wechseln“ gilt das Konto bis zum Ende dieses Spiels als
bestätigt. Ohne Nachfrage: das Konto, mit dem das Spiel gestartet wurde, und Konten, die im Spiel über `accounts.add`
angemeldet wurden (das Anmeldefenster ist die Bestätigung). Es ist immer nur ein Fenster offen; eine Anfrage für ein
anderes Konto bekommt solange `busy`, eine für dasselbe Konto wartet mit.

**accounts.add:** öffnet das normale Microsoft-Anmeldefenster des Launchers (eigenes Fenster über allem, mit Fokus,
auch wenn der Launcher versteckt ist). Die Antwort kommt, wenn die Anmeldung fertig ist oder abgebrochen wurde
(`cancelled`). Das neue Konto wird **nicht** aktiv (außer es ist das einzige) – ob gewechselt wird, entscheidet das Spiel.

**accounts.setActive:** macht das Konto im Launcher aktiv; die Kontenliste im Launcher-Fenster aktualisiert sich. Nur
für Konten, zu denen in diesem Spiel gewechselt werden durfte (Startkonto, bestätigt, im Spiel angemeldet) – sonst
`not_allowed`.

**Vollbild:** Bevor die Mod etwas anfragt, das ein Fenster im Launcher öffnet (`accounts.add`, und `accounts.session`
für ein noch nicht bestätigtes Konto), verlässt sie den Vollbildmodus und stellt ihn danach wieder her. Der Launcher
holt seine Fenster nach vorn und gibt ihnen den Fokus; lässt Windows das nicht zu, blinkt das Fenster in der Taskleiste.

## Fehlercodes

| Code | Bedeutung |
| --- | --- |
| `bad_request` | Anfrage ungültig (Feld, ID, Parameter, Protokollversion, ID doppelt) |
| `unknown_op` | unbekannte Operation |
| `not_found` | Konto gibt es nicht (in der fertigen App gehören Offline-Konten dazu) |
| `rate_limited` | Grenze erreicht (siehe unten) |
| `busy` | schon eine Anmeldung oder Nachfrage offen, oder zu viele offene Anfragen |
| `cancelled` | Anmeldefenster geschlossen oder Wechsel im Launcher abgebrochen |
| `not_allowed` | Kontowechsel im Launcher ausgeschaltet, oder `setActive` für ein Konto ohne Wechsel in diesem Spiel |
| `session_failed` | Sitzung nicht verfügbar (z. B. Erneuerung abgelehnt – im Launcher neu anmelden) |
| `sign_in_failed` | Anmeldung fehlgeschlagen (z. B. kein Xbox-Profil) |
| `internal` | unerwarteter Fehler im Launcher |

Die Mod kennt zusätzlich eigene Codes (nie vom Launcher): `unavailable` (kein Launcher), `timeout`, `bad_response`,
`in_world`, `unsupported`.

## Grenzen und Sicherheit

- Alle Anfragen zusammen: 30 pro 10 Sekunden (auch ungültige Zeilen zählen; darüber gibt es nur noch kurze Absagen).
- Sitzungen (`accounts.session`): 4 pro Minute und 20 pro Stunde.
- Anmeldungen (`accounts.add`): eine zur Zeit, 3 pro 10 Minuten.
- Nachfragen (Bestätigungsfenster): eins zur Zeit, 3 pro 10 Minuten.
- Höchstens 4 offene Anfragen gleichzeitig.
- Jede ausgegebene Sitzung, jede Anmeldung und jeder Kontowechsel steht als Zeile in der Konsole des Launchers
  (`[Launcher] Spiel: …`), nie mit Token. Warnungen über verworfene Anfragen sind auf 10 pro Minute begrenzt.
- Offline-Konten nur in der Entwicklungsversion (`npm start`), wie im Launcher selbst.
- Was im Spiel läuft (Mods, Addons mit Zugriff auf Minecraft), kann dieselben Anfragen stellen wie HeldixClient. Darum
  bekommt das Spiel die Sitzung eines anderen Kontos erst, nachdem du den Wechsel im Launcher bestätigt hast (siehe
  `accounts.session`), und der Wechsel lässt sich in den Einstellungen ganz ausschalten. Jede Nachfrage und deine
  Antwort stehen in der Konsole des Launchers.

## Im Spiel

Heldix-Menü → **Profil → Konten** zeigt die Konten des Launchers mit den Marken „Im Spiel“
und „Aktiv im Launcher“, „Wechseln“ und „Konto hinzufügen“. Das Profil oben rechts im Heldix-Menü und auf der
Startseite öffnet die Seite ebenfalls. Ohne Launcher-Verbindung oder mit `allowed: false` fehlen Eintrag und Klick auf
das Profil; die Seite nennt nur den Grund. Ändert sich das während das Menü offen ist, baut sich die Navigation neu auf.

Gewechselt wird nur außerhalb einer Welt (Hauptmenü, Mehrspieler-, Realms-Seite, Heldix-Menü ohne Welt). In einer Welt
bietet die Seite „Welt verlassen und wechseln“ an (zweiter Klick bestätigt; speichern und verlassen wie im Pausemenü,
dann wechseln).

Braucht ein Wechsel die Bestätigung im Launcher (nicht das Startkonto, noch nicht in diesem Spiel gewechselt oder hier
angemeldet) oder öffnet `accounts.add` das Anmeldefenster, verlässt das Spiel vorher den Vollbildmodus (nur das
Fenster, die Einstellung bleibt) und stellt ihn nach der Antwort wieder her. Eine Einblendung sagt, dass im
Launcher-Fenster etwas zu tun ist. Die Mod wartet bis zu 3 Minuten auf die Sitzung.

`SessionSwitcher` ersetzt den `User` von Minecraft und baut neu, was daran hängt – so, wie es der Konstruktor von
Minecraft tut: Mojang-Dienste und Eigenschaften (`userApiService`, `userPropertiesFuture`), eigenes Profil mit Skin
(`profileFuture`), Schlüssel für die Chat-Signatur (`profileKeyPairManager`), Telemetrie, Melden, Freunde von Minecraft
und Realms. Netzwerk läuft vorher im Hintergrund, der Tausch im Render-Thread in einem Rutsch. Danach vergisst
HeldixClient alles vom alten Konto (`Social.accountChanged()`: Anmeldung beim Dienst, Freunde, Anfragen, Nachrichten,
nachgeschlagene Spieler; Skin im Menü; mit erreichbarem Dienst die eigenen Cosmetics), meldet sich neu beim
Heldix-Dienst an (Profil mit Cape, Cosmetics, Freunde kommen vom neuen Konto), baut die Startseite neu auf und zeigt die
Einblendung „Konto gewechselt“. Zuletzt macht `accounts.setActive` das Konto im Launcher aktiv.

Die Fehlertexte im Spiel hängen am Code (`not_allowed`, `cancelled`, `busy`, `rate_limited`, `session_failed`,
`sign_in_failed`, `not_found` …), siehe `LauncherException.describe`.

Die Felder in `Minecraft` sind `final`; der Transformer `AccountPatches` nimmt das weg (Heldix Loader und Fabric –
`net.minecraft.client.Minecraft` steht schon in den Zielen der Fabric-Brücke).
