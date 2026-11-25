# Heldix-Dienst: Capes für alle, Heldix-Symbol und Freunde

Der Heldix-Dienst ist ein kleiner Server (Ordner [service/](../service)). Zusammen mit der Webseite (Ordner [website/](../website)) richtet ihn ein Installer mit einem Befehl ein, siehe [Betrieb](#betrieb). Er verbindet HeldixClient-Spieler untereinander:

- **Capes für alle sichtbar:** Andere HeldixClient-Spieler sehen dein Heldix-Cape. Eigene Bilder bleiben auf deinem PC, damit keine fremden Bilder über den Dienst laufen.
- **Heldix-Symbol:** In der Tab-Liste steht das Heldix-Logo vor dem Namen von HeldixClient-Spielern.
- **Freunde:** Freundesliste mit Anfragen und Online-Status. Auf Wunsch zeigt sie, auf welchem Server ein Freund gerade spielt, sodass du ihm direkt beitreten kannst.
- **Nachrichten:** Kurze Direktnachrichten an Freunde, auch wenn ihr gerade nicht auf demselben Server seid.
- **Blockieren und Melden:** Wer stört, lässt sich blockieren und beim Betreiber melden.
- **Launcher-Updates:** Der Launcher lädt neue Versionen über den Dienst. Der Download-Knopf der Webseite zeigt auf dieselbe Datei.
- **Webseite mit Konto:** Anmelden ohne Passwort über den Launcher oder das Spiel. Auf der Webseite siehst du Freunde, Nachrichten und Einstellungen, lädst deine Daten herunter und siehst deine Meldungen.
- **Team-Bereich:** Moderatoren und Admins bearbeiten auf der Webseite Meldungen, Sperren und Support-Anfragen und schreiben Neuigkeiten. Admins veröffentlichen außerdem Updates und verwalten das Team. Der Zugang braucht eine Zwei-Faktor-Anmeldung.
- **Support:** Spieler schreiben dem Team über Webseite, Launcher oder Spiel; Antworten meldet das Spiel sofort.
- **Teamseite, Neuigkeiten, Versionsverlauf, Status:** Öffentlich (ohne Anmeldung) gibt es die Teamseite (nur wer zustimmt), alle Neuigkeiten, die Liste der Launcher-Versionen und einen Status mit Summen.

Ohne eingetragene Adresse des Dienstes sind diese Funktionen aus; der Rest von HeldixClient läuft wie gewohnt.

## Datenschutz

- **Gespeichert werden:** Minecraft-UUID, Spielername, gewähltes Heldix-Cape, die Einstellungen unten, Freundschaften und offene Anfragen, Nachrichten an Freunde, Blockierungen, Meldungen, Support-Anfragen, Zeitpunkt der letzten Verbindung, Anmeldungen auf der Webseite und für Team-Mitglieder Rolle, 2FA-Geheimnis, Teamprofil und Protokoll.
- **Nicht gespeichert werden:** Passwörter und Microsoft- oder Minecraft-Tokens. Die Anmeldung beim Dienst läuft wie der Beitritt zu einem Minecraft-Server über Mojang; der Dienst sieht dabei kein Token.
- **Online-Status und Server** sehen nur bestätigte Freunde. Server-Adressen werden nur weitergegeben, wenn sie öffentliche Domains sind (keine IP-Adressen, kein `localhost`, keine Heimnetz-Namen). Ein Port bleibt dabei, wenn er nicht der Standard-Port 25565 ist, damit Freunde beitreten können.
- **Erkennbar sein** (Heldix-Symbol und Cape für andere): Nur wer online ist und die Einstellung an hat, wird bei einer Abfrage als HeldixClient-Spieler gemeldet.
- **Nachrichten** gehen nur an bestätigte Freunde. Der Dienst speichert sie als Verlauf höchstens 30 Tage, danach löscht er sie von selbst; pro Unterhaltung bleiben höchstens die letzten 500. Sie sind **nicht Ende-zu-Ende-verschlüsselt:** Unterwegs schützt sie HTTPS, auf dem Server liegen sie lesbar in der Datenbank. Endet die Freundschaft (Entfernen, Blockieren, Daten löschen), löscht der Dienst die ganze Unterhaltung sofort, für beide. Ob du eine Nachricht gelesen hast, erfährt der Absender nicht.
- **Blockieren:** Ein blockierter Spieler ist kein Freund mehr; Anfragen und Unterhaltung werden gelöscht. Er erfährt davon nichts: Eine neue Anfrage von ihm scheitert so, als gäbe es dich beim Dienst nicht. Gespeichert wird nur, wer wen seit wann blockiert hat.
- **Melden:** Eine Meldung enthält, wer wen gemeldet hat (UUID und Name), den Grund, eine freiwillige Notiz und als Beleg die letzten 20 Nachrichten zwischen beiden. Nur der Betreiber und das Team sehen sie, um Missbrauch zu prüfen. Ist eine Meldung erledigt, merkt sich der Dienst wann und von wem. Alle Meldungen werden nach 90 Tagen gelöscht, auch erledigte. Deine eigenen Meldungen und ihren Stand siehst du auf der Webseite. Löschst du deine Daten, verschwinden deine eigenen Meldungen. Meldungen anderer über dich bleiben bis zum Ablauf, damit Missbrauch nicht durch Löschen und neues Anmelden verschwindet (berechtigtes Interesse an der Abwehr von Missbrauch).
- **Sperren:** Bei Missbrauch können der Betreiber und das Team ein Konto für den Dienst sperren. Dann löscht der Dienst Konto, Freundschaften, Anfragen, Nachrichten, Blockierungen und Anmeldungen (auch auf der Webseite) und merkt sich nur UUID, letzten Namen, Datum, Grund und wer gesperrt hat. Die Sperre bleibt auch nach „Daten beim Dienst löschen“. Minecraft und der Rest von HeldixClient laufen weiter.
- **Anmeldung auf der Webseite:** Es gibt kein Passwort. Der Launcher oder das Spiel holt einen Anmelde-Link, der 2 Minuten gilt und nur einmal geht. Für jede Anmeldung speichert der Dienst Beginn, letzte Nutzung und einen kurzen Gerätenamen aus dem User-Agent (z. B. „Firefox · Windows“), mehr nicht. Eine Anmeldung endet nach 30 Tagen, nach 7 Tagen ohne Nutzung, beim Abmelden, beim Löschen der Daten und bei einer Sperre. Das Cookie ist nur für die Anmeldung da (kein Tracking). Auf der Webseite bist du für andere nicht „online“.
- **Datenauskunft:** Auf der Webseite lädt „Meine Daten herunterladen“ alles als Datei herunter, was der Dienst über dich speichert (höchstens 5-mal pro Stunde).
- **Team:** Für Team-Mitglieder speichert der Dienst Rolle, seit wann und von wem, das Geheimnis der Zwei-Faktor-Anmeldung und den zuletzt benutzten Code-Zeitschritt, bis zur Entfernung aus dem Team. Jede ändernde Team-Aktion steht mit Name und Zeitpunkt im Protokoll, das 365 Tage aufbewahrt wird (auch nach dem Löschen der Daten, zur Nachvollziehbarkeit). Neuigkeiten des Teams stehen öffentlich mit dem Namen des Autors auf Webseite und Launcher; löscht der Autor seine Daten, bleibt der Name an der Neuigkeit.
- **Launcher-Updates:** Beim Abruf der neuesten Version und beim Download speichert der Dienst nichts. Wie oft eine IP-Adresse lädt, zählt er nur kurz im Arbeitsspeicher (für die Begrenzung, eine Minute lang). Der Versionsverlauf enthält nur Versionen, Datum und Änderungen, keine Personen.
- **Teamseite nur mit Zustimmung:** Auf der öffentlichen Teamseite steht ein Team-Mitglied nur, wenn es das selbst eingeschaltet hat (Standard: aus). Dann zeigt sie Name, Rolle, Aufgabe, einen kurzen Text, seit wann es dabei ist und den Minecraft-Skin. Den Skin lädt der Dienst selbst bei Mojang und gibt ihn weiter; der Browser der Besucher fragt nie bei Mojang. Ausschalten oder das Verlassen des Teams nimmt den Eintrag sofort heraus.
- **Support-Anfragen** sehen nur du und das Team. Antworten des Teams zeigen dir den Namen des Mitglieds nur, wenn es auf der Teamseite steht, sonst „HeldixClient-Team“. Geschlossene Anfragen löscht der Dienst 90 Tage nach dem Schließen, andere 180 Tage nach der letzten Nachricht. „Daten löschen“ und eine Sperre löschen deine Anfragen sofort; sie stehen in deiner Datenauskunft.
- **Status:** Die öffentliche Status-Abfrage zeigt nur Summen (wie viele Spieler online und insgesamt angemeldet sind), keine Namen.
- **Einstellungen im Heldix-Menü:** „Für andere erkennbar“, „Online-Status für Freunde“, „Server für Freunde sichtbar“, „Nachrichten von Freunden annehmen“.
- **Daten löschen:** Im Heldix-Menü unter Freunde → Privatsphäre (oder auf der Webseite) löscht „Daten beim Dienst löschen“ alles, was der Dienst über dich gespeichert hat: Konto, Freundschaften, Anfragen, Nachrichten (auch die an dich), Blockierungen (von dir und gegen dich), deine Meldungen, alle Anmeldungen auf der Webseite und eine Team-Mitgliedschaft. Dazu gehören auch deine Support-Anfragen und dein Teamprofil. Es bleiben nur Meldungen anderer über dich (bis zum Ablauf nach 90 Tagen), Einträge im Team-Protokoll (bis zum Ablauf nach 365 Tagen), der Autorname an Neuigkeiten und an Antworten auf Support-Anfragen anderer, und eine Sperre.

## Schnittstelle (Version 1)

Alle Anfragen und Antworten sind JSON (UTF-8), außer Download und Upload der Launcher-Installer und dem Datenexport (JSON-Datei). UUIDs sind immer klein geschrieben und ohne Bindestriche (32 Hex-Zeichen). Fehler antworten mit einem passenden HTTP-Status und `{ "error": "<deutscher Text für den Spieler>" }`, im Team-Bereich bei fehlendem Zugang zusätzlich mit `"code"`.

**Zwei Arten der Anmeldung:**
- **Bearer-Token** (Launcher, Spiel): `Authorization: Bearer <token>` aus `POST /v1/auth/login`.
- **Cookie** (Webseite): Die Webseite erreicht den Dienst unter `/api/…` auf ihrer eigenen Adresse (Caddy schneidet `/api` ab: `fetch('/api/v1/web/me')` kommt als `GET /v1/web/me` an). Die Sitzung steckt im Cookie `__Host-heldix_web` (HttpOnly, Secure, SameSite=Strict, Path=/). **CSRF:** Jede Anfrage mit Cookie außer GET und HEAD braucht den Header `X-Heldix-Web: 1`, und ein mitgeschickter `Origin` muss genau die Webseite sein (`HELDIX_DIENST_WEBSITE`); sonst 403. Schickt eine Anfrage beides, zählt das Bearer-Token.

Alle Routen für Spieler (`/v1/me…`, `/v1/friends…`, `/v1/messages…`, `/v1/blocks…`, `/v1/reports…`, `/v1/support…`, `/v1/players/lookup`) nehmen beides an. `POST /v1/web/link` geht nur mit Bearer-Token, `/v1/web/…` und `/v1/team/…` nur mit Cookie, der WebSocket nur mit Bearer-Token.

**Öffentliche Routen** (ohne Anmeldung: `/v1/public/…`, `/v1/news`, `/v1/launcher/…`, `/v1/status`) antworten immer mit `Access-Control-Allow-Origin: *`, auch bei Fehlern, und mit einem kurzen `Cache-Control`.

### Anmeldung

Wie bei einem Minecraft-Server: Der Dienst gibt eine zufällige `serverId` aus. Der Client meldet bei Mojang „Ich trete Server `serverId` bei“ (`sessionserver.mojang.com/session/minecraft/join`, mit seinem Token). Der Dienst fragt danach bei Mojang nach, ob das stimmt (`hasJoined`). So weiß er sicher, wem die UUID gehört, ohne das Token zu sehen.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `POST /v1/auth/challenge` | – | `{ "serverId": "<40 Hex-Zeichen>" }`, gültig 60 Sekunden, nur einmal verwendbar |
| `POST /v1/auth/login` | `{ "name": "<Spielername>", "serverId": "…" }` | `{ "token": "…", "uuid": "…", "name": "…", "expiresAt": <ms> }` |

- `login` fragt `GET <Session-Server>/session/minecraft/hasJoined?username=<name>&serverId=<serverId>` ab. Antwortet Mojang mit 200 und `{ "id", "name" }`, ist der Spieler angemeldet. Sonst kommt 401 mit `{ "error": "Anmeldung bei Mojang fehlgeschlagen." }`.
- **Gesperrt:** Hat der Betreiber die UUID gesperrt, antwortet `login` mit 403 „Dieses Konto ist für den Heldix-Dienst gesperrt.“ Der Dienst legt dann auch kein Konto an.
- Das Token gilt 7 Tage. Der Dienst speichert nur seinen SHA-256-Hash. Alle weiteren Anfragen schicken `Authorization: Bearer <token>`. Ohne gültiges Token antworten sie mit 401, der Client meldet sich dann neu an.
- **Entwicklungsmodus** (nur für automatische Tests): Mit `HELDIX_DIENST_DEV=1` gibt es zusätzlich `POST /v1/auth/dev` mit `{ "name", "uuid" }`. Diesen Weg nimmt der Dienst nur von `127.0.0.1` oder `::1` an, und er schreibt beim Start eine deutliche Warnung ins Log. Ohne die Variable antwortet dieser Weg mit 404. Eine Sperre gilt auch hier.

### Eigenes Profil

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/me` | – | `Me` |
| `PUT /v1/me` | Teil von `{ "cape": "<id>" \| "", "visible": bool, "presence": bool, "showServer": bool, "messages": bool }` | `Me` |
| `DELETE /v1/me` | – | `{ "deleted": true }` |
| `GET /v1/me/export` | – | JSON-Datei mit allen Daten (siehe unten) |

`Me` = `{ "uuid", "name", "cape", "visible", "presence", "showServer", "messages" }`. Die Standardwerte sind `cape: ""` und alle vier Schalter `true`.

- `visible`: Für andere als HeldixClient-Spieler erkennbar (Symbol und Cape).
- `presence`: Freunde sehen den Online-Status.
- `showServer`: Freunde sehen den Server.
- `messages`: Nachrichten von Freunden annehmen. Ist der Schalter aus, bekommen Freunde beim Senden 403. Selbst schreiben geht trotzdem, und vorhandene Nachrichten bleiben.
- `cape` muss eine der eingebauten IDs sein: `heldix`, `mitternacht`, `aurora`, `glut`, `kristall`, `neon`, `sakura`, `gewitter`, `galaxie`. Die Liste lässt sich mit der Umgebungsvariable `HELDIX_DIENST_CAPES` (durch Kommas getrennt) ersetzen. `""` heißt: kein Cape.
- `DELETE /v1/me` löscht den Spieler mit allen Tokens, Web-Sitzungen, Freundschaften, Anfragen, Nachrichten und Blockierungen (jeweils in beide Richtungen), der Team-Mitgliedschaft (mit Teamprofil), seinen Support-Anfragen und den Meldungen, die er selbst gemacht hat. Meldungen anderer über ihn und Einträge im Team-Protokoll bleiben bis zum Ablauf, eine Sperre bleibt ganz. Mit Cookie löscht die Antwort auch das Cookie. Seine offenen WebSocket-Verbindungen schließt der Dienst mit Code 4001 („Konto gelöscht“). Frühere Freunde und Spieler mit offenen Anfragen bekommen, falls verbunden, sofort eine neue `friends`-Nachricht ohne ihn. Danach gilt das alte Token nicht mehr (401). Meldet sich derselbe Spieler später wieder an, legt der Dienst ihn neu mit den Standardwerten an.

- **Datenexport** (`GET /v1/me/export`): `Content-Disposition: attachment; filename="heldix-daten-<name>.json"`. Enthält `exportedAt`, `profile` (Me mit `createdAt`, `lastSeen`), `friends` (uuid, name, since), `requests` (`incoming`, `outgoing`), `messages` (alle gespeicherten, beide Richtungen), `blocked`, `reports` (eigene, mit Beleg), `logins` (Zeitpunkte der Tokens), `webSessions` (ohne Hashes), `team` (Rolle oder `null`, ohne 2FA-Geheimnis), `news` (eigene Neuigkeiten), `teamActions` (eigene Einträge im Protokoll) und `support` (eigene Support-Anfragen mit allen Nachrichten, so wie du sie siehst). Höchstens 5 Exporte pro Stunde, sonst 429.

### Spieler nachschlagen (Tab-Liste und Capes)

`POST /v1/players/lookup` mit `{ "uuids": ["…", …] }` (höchstens 200) → `{ "players": { "<uuid>": { "cape": "<id>" | "" } } }`

Die Antwort enthält nur Spieler, die gerade verbunden sind (offene WebSocket-Verbindung) und `visible` an haben. Der Anfragende selbst gehört dazu, wenn das zutrifft.

### Freunde

`Friend` = `{ "uuid", "name", "online": bool, "state": "menu" | "singleplayer" | "multiplayer" | "realms" | "lan" | null, "server": "<domain>" | "<domain>:<port>" | null, "since": <ms> }`
- Hat der Freund `presence` aus, ist `online` immer `false` und `state` und `server` sind `null`.
- `server` steht nur da, wenn er `showServer` an hat und `state` `multiplayer` ist. Der Port steht nur dabei, wenn er nicht 25565 ist (siehe `status` unter Echtzeit).

`Request` = `{ "uuid", "name", "at": <ms> }`

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/friends` | `{ "friends": [Friend], "incoming": [Request], "outgoing": [Request], "unread": { "<uuid>": <Anzahl> } }` |
| `POST /v1/friends/requests` mit `{ "name": "<Spielername>" }` | wie `GET /v1/friends` |
| `POST /v1/friends/requests/<uuid>/accept` | wie `GET /v1/friends` |
| `DELETE /v1/friends/requests/<uuid>` | wie `GET /v1/friends` (ablehnen oder eigene Anfrage zurückziehen) |
| `DELETE /v1/friends/<uuid>` | wie `GET /v1/friends`; die Unterhaltung wird für beide gelöscht |

- `unread`: ungelesene Nachrichten pro Freund, nur Freunde mit mindestens einer (sonst `{}`).

Regeln für Anfragen:
- **Name nicht gefunden:** Gesucht wird ohne Groß-/Kleinschreibung unter Spielern, die sich schon einmal angemeldet haben. Gibt es keinen Treffer: 404 „Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).“ Hat dich der Spieler blockiert, kommt genau dieselbe Antwort, damit die Blockierung verborgen bleibt.
- **Sonderfälle:** Für sich selbst gibt es 400. Für einen Spieler, der schon Freund ist, gibt es 409. Hast du den Spieler selbst blockiert: 409 „Du hast diesen Spieler blockiert. Gib ihn zuerst frei.“ Liegt schon eine Anfrage in die Gegenrichtung vor, werden beide sofort Freunde.
- **Grenzen:** Höchstens 200 Freunde und 50 offene ausgehende Anfragen, sonst 409.

### Nachrichten

`Message` = `{ "id": <Zahl>, "from": "<uuid>", "to": "<uuid>", "text": "…", "at": <ms>, "read": bool }`
- `id` steigt mit jeder neuen Nachricht.
- `read` gilt aus Sicht des Abrufenden: Nachrichten des Freundes sind `true`, sobald man sie als gelesen markiert hat. Eigene Nachrichten sind immer `true`, denn ob der Freund sie gelesen hat, verrät der Dienst nicht (keine Lesebestätigung).

`Conversation` = `{ "uuid", "name", "last": Message, "unread": <Anzahl> }` mit UUID und Namen des Freundes, der neuesten Nachricht und der Zahl seiner ungelesenen Nachrichten an dich.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/messages` | – | `{ "conversations": [Conversation] }`: ein Eintrag pro Freund mit mindestens einer Nachricht, neueste Unterhaltung zuerst |
| `GET /v1/messages/<uuid>?before=<id>&limit=<n>` | – | `{ "messages": [Message], "more": bool }` |
| `POST /v1/messages/<uuid>` | `{ "text": "…" }` | `{ "message": Message }` |
| `POST /v1/messages/<uuid>/read` | – | `{ "ok": true }` |

- **Verlauf:** die neuesten `limit` Nachrichten (Standard 50, erlaubt 1 bis 100) mit einer `id` kleiner als `before` (ohne `before`: ab der neuesten), älteste zuerst. `more` heißt: Es gibt ältere. Für die nächste Seite `before` auf die `id` der ersten Nachricht setzen. Ungültige Werte ergeben 400. Ist der Spieler kein Freund: 404 „Dieser Spieler ist nicht in deiner Freundesliste.“ (ebenso bei `read`).
- **Senden:** nur an Freunde, sonst 403 „Nachrichten gehen nur an Freunde.“ Hat der Freund `messages` aus: 403 „<Name> nimmt gerade keine Nachrichten an.“
- **Text:** Leerzeichen am Anfang und Ende fallen weg, danach 1 bis 500 Zeichen (gezählt werden Unicode-Zeichen, ein Emoji zählt einmal). Nicht erlaubt sind Steuerzeichen (auch Zeilenumbrüche und Tabs), Zeilen- und Absatztrenner und Steuerzeichen für die Schreibrichtung (400). Der Text ist reiner Text: Der Client zeigt ihn ohne Formatierung an und wertet auch `§`-Codes nicht aus.
- **Gelesen:** `read` markiert alle Nachrichten des Freundes an dich als gelesen. Das erfahren nur deine eigenen Verbindungen (siehe `read` unter Echtzeit), nie der Absender.
- **Grenzen und Aufbewahrung:** höchstens 20 Nachrichten pro Minute und Spieler, sonst 429 „Zu viele Nachrichten. Warte kurz.“ Pro Unterhaltung bleiben die letzten 500 Nachrichten, ältere löscht der Dienst. Nach 30 Tagen löscht er jede Nachricht. Endet die Freundschaft, ist die Unterhaltung für beide gelöscht.

### Blockieren

`Blocked` = `{ "uuid", "name", "at": <ms> }`

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/blocks` | – | `{ "blocked": [Blocked] }`, neueste zuerst |
| `POST /v1/blocks` | `{ "uuid": "…" }` oder `{ "name": "<Spielername>" }` | wie `GET /v1/blocks` |
| `DELETE /v1/blocks/<uuid>` | – | wie `GET /v1/blocks` (wieder freigeben) |

- Blockieren beendet die Freundschaft und löscht offene Anfragen in beide Richtungen und die Unterhaltung. Hat sich dadurch etwas geändert, bekommen beide Seiten, falls verbunden, sofort eine neue `friends`-Nachricht.
- Der Name wird gesucht wie bei Anfragen (404 mit demselben Text). Sich selbst blockieren: 400. Schon blockiert: keine Änderung. Höchstens 500 Blockierungen, sonst 409.
- Der Blockierte merkt nichts: Seine Anfrage an dich endet mit derselben 404 wie ein unbekannter Name. Freigeben bringt Freundschaft und Nachrichten nicht zurück.
- **Erst melden, dann blockieren:** Blockieren löscht die Unterhaltung, und damit den Beleg für eine Meldung.

### Melden

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `POST /v1/reports` | `{ "uuid": "<gemeldeter Spieler>", "reason": "spam" \| "harassment" \| "inappropriate" \| "other", "note": "<freiwillig>" }` | `{ "reported": true }` |
| `GET /v1/reports/mine` | – | `{ "reports": [ { "id", "at", "reported": { "uuid", "name" }, "reason", "note", "status": "open" \| "done" } ] }`, neueste zuerst |

- Melden lässt sich jeder Spieler, der sich schon einmal angemeldet hat, auch ohne Freundschaft. Sonst 404 (Text wie bei Anfragen). Sich selbst melden: 400. `note` darf fehlen und ist höchstens 300 Zeichen lang, ohne Steuerzeichen (Regeln wie bei Nachrichten).
- Gespeichert werden Meldender und Gemeldeter (UUID und Name zu diesem Zeitpunkt), Grund, Notiz, Zeitpunkt und als Beleg die letzten 20 Nachrichten zwischen beiden (beide Richtungen). Den Beleg sehen nur der Betreiber ([Verwaltung](#verwaltung-meldungen-sperren-und-team)) und das Team ([Team-Bereich](#team-bereich)).
- **Grenzen:** denselben Spieler einmal in 24 Stunden, insgesamt höchstens 10 Meldungen in 24 Stunden, sonst 429.
- **Status und Aufbewahrung:** Neue Meldungen sind `open`. Team (`POST /v1/team/reports/<id>/done`) oder Betreiber (`heldix-dienst-admin meldung-erledigt`) setzen sie auf `done`; gelöscht werden sie dabei nicht. Nach 90 Tagen löscht der Dienst jede Meldung. `DELETE /v1/me` löscht die eigenen Meldungen; Meldungen über einen Spieler bleiben bis zum Ablauf.

### Launcher-Updates

Der Launcher aktualisiert sich über den Dienst. Signieren und Prüfen übernimmt der Launcher; der Dienst liefert nur Dateien aus, die der Betreiber in den Update-Ordner gelegt hat (siehe [Launcher-Update veröffentlichen](#launcher-update-veröffentlichen)). Diese Wege brauchen keine Anmeldung und antworten immer mit `Access-Control-Allow-Origin: *`, auch bei Fehlern, damit auch die Webseite sie abfragen kann.

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/launcher/latest` | Inhalt von `update.json`: `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }`, mit `Cache-Control: no-cache` |
| `GET /v1/launcher/download/latest` | 302 mit `Location: /v1/launcher/download/<file aus dem Manifest>` (Ziel des Download-Knopfs der Webseite) |
| `GET`, `HEAD /v1/launcher/download/<file>` | der Installer |

- `manifest` ist genau der Text aus `update.json` (darüber läuft die Signatur) und ergibt `{ "v": 1, "version": "0.12.0", "file": "HeldixClient-Setup-0.12.0.exe", "size": <Byte>, "sha512": "<Base64>", "date": "JJJJ-MM-TT", "notes": ["…"] }`.
- **Prüfung beim Ausliefern:** Die Signatur prüft hier der Launcher. Der Dienst prüft nur die Form: beide Texte vorhanden, `manifest` ist ein JSON-Objekt mit `v` gleich 1, Text `version`, `file` nach dem Namensmuster unten und ganzzahligem `size`. Außerdem muss `file` im Update-Ordner liegen und genau `size` Byte groß sein; sonst ist der Upload noch nicht fertig. Fehlt etwas: 404 „Noch keine Version veröffentlicht.“ und ein Eintrag im Log. Ändert sich `update.json`, liest der Dienst sie beim nächsten Abruf neu, ohne Neustart.
- **Dateinamen:** `HeldixClient-Setup-<a>.<b>.<c>.exe`, auf Wunsch mit Zusatz wie `-beta.1` (Muster `^HeldixClient-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.exe$`). Nur solche Dateien direkt im Update-Ordner liefert der Dienst aus. Andere Namen, Unterordner und symbolische Links nach außerhalb ergeben 404.
- **Download:** mit `Content-Length`, `Content-Type: application/vnd.microsoft.portable-executable`, `Content-Disposition: attachment; filename="<file>"`, `Accept-Ranges: bytes`, `ETag` und `Last-Modified`. Ein Bereich per `Range: bytes=a-b`, `bytes=a-` oder `bytes=-n` ergibt 206 mit `Content-Range`, ein Bereich außerhalb der Datei 416. Mehrere Bereiche oder ungültige Angaben ergeben die ganze Datei (200). `If-Range` mit ETag oder Datum wird beachtet. Höchstens 30 Downloads pro Minute und IP, sonst 429.
- Die Datei wird gestreamt, auch ein langsamer Download läuft also bis zum Ende. Kommt 2 Minuten lang gar nichts beim Client an, trennt der Dienst die Verbindung.
- Veröffentlichen geht per `scp` (siehe [Betrieb](#launcher-update-veröffentlichen)) oder als Admin im [Team-Bereich](#team-bereich); dort prüft der Dienst zusätzlich die Signatur.

**Versionsverlauf:** `GET /v1/launcher/versions?limit=<1–50, Standard 20>` → `{ "versions": [ { "version", "date", "notes": ["…"], "publishedAt": <ms> } ] }`, neueste zuerst, `Cache-Control: max-age=60`. Der Launcher zeigt damit nach einem Update „Was ist neu in <Version>“.
- Der Dienst merkt sich jede veröffentlichte Version genau einmal (`version` ist eindeutig): nach dem Veröffentlichen im Team-Bereich und, bei `scp`, sobald er die neue `update.json` einliest und der Installer vollständig da ist (beim nächsten Abruf von `latest`, `versions` oder `status`). `date` und `notes` (höchstens 30) kommen aus dem Manifest, `publishedAt` ist der Zeitpunkt, zu dem der Dienst die Version zuerst gesehen hat.

### Webseite: Anmeldung und Sitzungen

Kein Passwort und kein Microsoft-Login auf der Webseite: Der Launcher (oder das Heldix-Menü im Spiel) ist schon beim Dienst angemeldet, holt einen Einmal-Link und öffnet ihn im Browser.

| Anfrage | Anmeldung | Inhalt | Antwort |
| --- | --- | --- | --- |
| `POST /v1/web/link` | Bearer | – oder `{ "target": "profil" \| "freunde" \| "nachrichten" \| "privatsphaere" \| "daten" \| "support" \| "team" }` | `{ "url": "<Webseite>/konto#code=<code>", "expiresAt": <ms> }`, mit `target`: `…#code=<code>&ziel=<target>` |
| `POST /v1/web/session` | – | `{ "code": "…" }` | setzt das Cookie, Antwort `WebMe` |
| `GET /v1/web/me` | Cookie | – | `WebMe` |
| `POST /v1/web/logout` | Cookie | – | `{ "ok": true }`, Cookie gelöscht |
| `GET /v1/web/sessions` | Cookie | – | `{ "sessions": [ { "id", "createdAt", "lastUsedAt", "current": bool, "device" } ] }`, zuletzt benutzte zuerst |
| `DELETE /v1/web/sessions/<id>` | Cookie | – | wie `GET`; die eigene Sitzung löschen heißt abmelden (Cookie gelöscht) |

`WebMe` = `Me` plus `{ "role": null | "moderator" | "admin", "twoFactor": { "enabled": bool, "verified": bool }, "expiresAt": <ms> }`. `verified`: In dieser Sitzung wurde in den letzten 12 Stunden ein 2FA-Code eingegeben. `expiresAt`: Ende der Sitzung (30 Tage ab Anmeldung, höchstens 7 Tage nach der letzten Nutzung).

- **Ziel:** Mit `target` öffnet die Konto-Seite nach der Anmeldung diesen Reiter, bei `team` die Seite `/team`. Ein anderer Wert: 400. Ohne Körper (oder mit `target: null`) wie bisher.
- **Code:** 32 Zufallsbytes (base64url), gespeichert nur als SHA-256-Hash, 120 Sekunden gültig, nur einmal nutzbar (auch ein fehlgeschlagener Versuch verbraucht ihn). Er steht im Fragment (`#code=`) und landet so in keinem Server-Log. Höchstens 10 Links pro Minute und Spieler, sonst 429.
- **Fehler:** Ohne `HELDIX_DIENST_WEBSITE` antwortet `link` mit 503 „Die Anmeldung auf der Webseite ist auf diesem Server nicht eingerichtet.“ Ein ungültiger, abgelaufener oder benutzter Code ergibt 401 „Der Anmelde-Link ist abgelaufen oder wurde schon benutzt. Bitte im Launcher erneut „Auf heldixclient.com anmelden“ wählen.“ `session` zählt zur Grenze der Anmeldung (20 pro Minute und IP).
- **Cookie:** Wert 32 Zufallsbytes, gespeichert nur als Hash. `Max-Age` 30 Tage; nach 7 Tagen ohne Nutzung gilt es nicht mehr. Ohne gültige Sitzung: 401, und die Antwort löscht das Cookie. Nur bei direkten Anfragen über HTTP von `127.0.0.1`/`::1` (Tests) fehlt `Secure`. Höchstens 10 Sitzungen pro Spieler, die ältesten fallen weg.
- Eine Web-Sitzung macht nicht „online“: kein Online-Status für Freunde, kein Heldix-Symbol, kein Cape beim Nachschlagen. Die Webseite fragt Freunde und Nachrichten etwa alle 10 Sekunden ab.
- Gesperrte bekommen keine Sitzung; eine Sperre und `DELETE /v1/me` beenden alle Sitzungen.

### Team-Bereich

Rollen: `moderator` und `admin`. Den ersten Admin legt der Betreiber auf dem Server an (`heldix-dienst-admin team <name> admin`, siehe [Verwaltung](#verwaltung-meldungen-sperren-und-team)).

**Zugang zu `/v1/team/*`:** nur mit Cookie (ohne Cookie: 401, auch mit Bearer-Token), mit Team-Rolle, eingerichteter Zwei-Faktor-Anmeldung und in dieser Sitzung bestätigtem Code (höchstens 12 Stunden alt). Sonst 403 mit `"code"`:

| `code` | Bedeutung |
| --- | --- |
| `forbidden` | keine Team-Rolle, oder die Route ist nur für Admins |
| `2fa_setup_required` | Zwei-Faktor-Anmeldung noch nicht eingerichtet |
| `2fa_required` | Code in dieser Sitzung noch nicht (oder vor mehr als 12 Stunden) eingegeben |

Geprüft wird in dieser Reihenfolge: Rolle vorhanden, 2FA eingerichtet, Code bestätigt, Admin-Rolle (für Admin-Routen).

**Zwei-Faktor-Anmeldung** (TOTP nach RFC 6238: SHA-1, 6 Ziffern, 30 Sekunden, ±1 Schritt Toleranz), mit Cookie:

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `POST /v1/web/2fa/setup` | – | `{ "secret": "<Base32, 32 Zeichen>", "uri": "otpauth://totp/HeldixClient:<name>?secret=…&issuer=HeldixClient&algorithm=SHA1&digits=6&period=30" }` |
| `POST /v1/web/2fa/enable` | `{ "code": "123456" }` | `WebMe` (2FA aktiv, Sitzung bestätigt) |
| `POST /v1/web/2fa/verify` | `{ "code": "123456" }` | `WebMe` (Sitzung 12 Stunden bestätigt) |

- `setup` nur für Team-Mitglieder (sonst 403 `forbidden`) ohne aktive 2FA (sonst 409); ein neuer Aufruf ersetzt das vorläufige Geheimnis. `enable` ohne vorheriges `setup`: 409. `verify` ohne eingerichtete 2FA: 403 `2fa_setup_required`.
- Der Code darf Leerzeichen enthalten („123 456“); keine 6 Ziffern: 400. Falscher Code: 401 „Der Code stimmt nicht.“ Jeder Zeitschritt gilt nur einmal, derselbe Code ein zweites Mal ist falsch. Höchstens 5 Versuche pro 10 Minuten und Spieler, sonst 429.
- Zurücksetzen: Admin im Team-Bereich oder `heldix-dienst-admin team-2fa-reset <name>`. Danach gilt keine Sitzung des Mitglieds mehr als bestätigt.

**Rechte**

| Bereich | moderator | admin |
| --- | --- | --- |
| Meldungen, Sperren, Spieler ansehen und suchen, Neuigkeiten | ja | ja |
| Spieler: Cape zurücksetzen, Daten löschen | – | ja |
| Updates veröffentlichen | – | ja |
| Team-Mitglieder verwalten, Protokoll | – | ja |

**Routen** (Admin-Routen markiert)

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/team/me/profile` | – | `{ "public": bool, "title": "", "about": "" }` (eigenes Teamprofil, jede Rolle) |
| `PUT /v1/team/me/profile` | Teil davon | wie `GET` |
| `GET /v1/team/support?status=open\|answered\|closed\|all` | – | `{ "tickets": [Ticket ohne messages] }`, neueste Aktivität zuerst; ohne `status`: `open` |
| `GET /v1/team/support/<id>` | – | `{ "ticket": Ticket }` |
| `POST /v1/team/support/<id>/messages` | `{ "text" }` | `{ "ticket": Ticket }` |
| `POST /v1/team/support/<id>/close` | – | `{ "ticket": Ticket }` |
| `GET /v1/team/reports?status=open\|done\|all` | – | `{ "reports": [Report] }`, neueste zuerst; ohne `status`: `open` |
| `POST /v1/team/reports/<id>/done` | – | `{ "report": Report }` (schon erledigt: unverändert) |
| `GET /v1/team/bans` | – | `{ "bans": [ { "uuid", "name", "reason", "at", "by": "<name>" \| null } ] }`, neueste zuerst |
| `POST /v1/team/bans` | `{ "uuid" \| "name", "reason": "<1–300 Zeichen>" }` | wie `GET` |
| `DELETE /v1/team/bans/<uuid>` | – | wie `GET` |
| `GET /v1/team/players?q=<Namensanfang oder UUID>` | – | `{ "players": [ { "uuid", "name", "lastSeen", "online", "banned", "role" } ] }`, höchstens 50 |
| `GET /v1/team/players/<uuid>` | – | Spieler (siehe unten), ohne Nachrichteninhalte |
| `POST /v1/team/players/<uuid>/reset-cape` (admin) | – | Spieler wie `GET` |
| `DELETE /v1/team/players/<uuid>` (admin) | – | `{ "deleted": true }` |
| `GET /v1/team/news` | – | `{ "news": [News] }`, alle, auch Entwürfe |
| `POST /v1/team/news` | `{ "title": "<1–120>", "text": "<1–5000, Zeilenumbrüche erlaubt>", "published": bool }` | `{ "news": News }` |
| `PUT /v1/team/news/<id>` | Teil davon | `{ "news": News }` |
| `DELETE /v1/team/news/<id>` | – | `{ "deleted": true }` |
| `GET /v1/team/updates` (admin) | – | `{ "current": <Manifest-Objekt> \| null, "files": [ { "file", "size", "uploadedAt" } ] }` |
| `PUT /v1/team/updates/files/<file>` (admin) | roher Inhalt (`application/octet-stream`, gestreamt, höchstens 1 GiB) | `{ "file", "size", "sha512": "<base64>" }` |
| `PUT /v1/team/updates/manifest` (admin) | Inhalt von `update.json` (`{ "manifest", "signature" }`) | `{ "current": <Manifest-Objekt> }` |
| `DELETE /v1/team/updates/files/<file>` (admin) | – | wie `GET /v1/team/updates` |
| `GET /v1/team/members` (admin) | – | `{ "members": [ { "uuid", "name", "role", "addedAt", "addedBy": "<name>" \| null, "twoFactor": bool } ] }` |
| `POST /v1/team/members` (admin) | `{ "uuid" \| "name", "role" }` | wie `GET` |
| `PUT /v1/team/members/<uuid>` (admin) | `{ "role" }` | wie `GET` |
| `DELETE /v1/team/members/<uuid>` (admin) | – | wie `GET` |
| `POST /v1/team/members/<uuid>/reset-2fa` (admin) | – | wie `GET` |
| `GET /v1/team/audit?limit=<1–500, Standard 100>` (admin) | – | `{ "entries": [ { "id", "at", "actor": { "uuid", "name" }, "action", "target": "<Text>" \| null, "detail": "<Text>" \| null } ] }`, neueste zuerst |

`Report` = `{ "id", "at", "status": "open" | "done", "reason", "note", "reporter": { "uuid", "name" }, "reported": { "uuid", "name", "banned": bool }, "messages": [ { "from": "<uuid>", "fromName", "text", "at" } ], "doneAt": <ms> | null, "doneBy": "<name>" | null }`

`News` = `{ "id", "title", "text", "at", "updatedAt", "author": "<name>", "published": bool }`. `at` ist der Zeitpunkt der ersten Veröffentlichung, bei Entwürfen der Zeitpunkt der Erstellung.

Spieler (`GET /v1/team/players/<uuid>`) = `{ "uuid", "name", "cape", "visible", "presence", "showServer", "messages", "createdAt", "lastSeen", "online", "friends": <Anzahl>, "blocks": <Anzahl>, "reportsAbout": [<id>], "reportsBy": [<id>], "ban": Ban | null, "role" }` mit `Ban` wie in `GET /v1/team/bans`.

- **`null` bei `by`, `doneBy`, `addedBy`:** über die Server-Konsole (`heldix-dienst-admin`). Im Protokoll heißt der Handelnde dann `{ "uuid": null, "name": "CLI" }`.
- **Sperren** wirkt wie `heldix-dienst-admin sperren` und trennt offene WebSocket-Verbindungen des Spielers sofort (Code 4003 „Gesperrt“). Sich selbst sperren: 400. Team-Mitglieder lassen sich nicht sperren (409), zuerst aus dem Team entfernen. Spieler, die nie online waren, lassen sich per `uuid` sperren. Unbekannter Name: 404.
- **Spieler suchen:** ohne Groß-/Kleinschreibung nach Namensanfang, oder nach UUID (auch mit Bindestrichen); ohne `q` die zuletzt gesehenen. Gesperrte stehen mit drin: Ihr Konto ist gelöscht, deshalb `lastSeen: null` und in der Detailansicht `createdAt: null`, `lastSeen: null`, Schalter `false` und `ban` gesetzt. Etwas anderes als Name oder UUID: 400. `online` ist die echte Verbindung, unabhängig von `presence`.
- **Spieler löschen** wirkt wie dessen `DELETE /v1/me` (ohne Sperre): Verbindungen enden mit 4001.
- **Neuigkeiten:** Titel einzeilig, Text mit Zeilenumbrüchen (`\r\n` wird zu `\n`), sonst die Regeln für Nachrichten. Moderatoren dürfen alle Neuigkeiten bearbeiten. Der Autor bleibt der, der sie angelegt hat.
- **Updates veröffentlichen:** Hochladen streamt in `<file>.part` und benennt erst am Ende um. Name wie beim Download, sonst 400; über 1 GiB: 413; der Installer der veröffentlichten Version lässt sich weder ersetzen noch löschen (409). Beim Manifest prüft der Dienst die Ed25519-Signatur mit dem öffentlichen Update-Schlüssel (`HELDIX_DIENST_UPDATE_KEY`; ohne: 503) und dieselben Regeln wie der Launcher: Dateiname passt zur Version, Größe, `sha512` (400 bei falscher Signatur oder falschem Inhalt). Die Datei muss im Ordner liegen und Größe und SHA-512 müssen stimmen, und die Version muss höher sein als die veröffentlichte (Vorabversionen wie `1.2.0-beta.1` zählen weniger als `1.2.0`), sonst 409. Erst dann ersetzt der Dienst `update.json` atomar (neue Datei schreiben, dann umbenennen). So kann auch ein übernommenes Team-Konto kein fremdes Update ausliefern.
- **Mitglieder:** Aufnehmen nur, wer sich schon einmal angemeldet hat (sonst 404); ist er schon im Team, ändert `POST` die Rolle. Ungültige Rolle: 400. Mindestens ein Admin muss bleiben: Den letzten Admin herabstufen, entfernen oder als Spieler löschen ergibt 409 „Es muss mindestens ein Admin bleiben.“ (`DELETE /v1/me` des letzten Admins geht trotzdem; dann legt der Betreiber einen neuen an).
- **Protokoll:** Jede ändernde Team-Aktion landet im Protokoll; Einträge verfallen nach 365 Tagen. `action` ist eine von: `report.done`, `ban`, `unban`, `player.reset-cape`, `player.delete`, `news.create`, `news.update`, `news.delete`, `update.upload`, `update.publish`, `update.delete`, `team.add`, `team.role`, `team.remove`, `team.reset-2fa`, `team.profile` (nur „öffentlich an“/„öffentlich aus“, ohne Texte), `support.reply`, `support.close`, `2fa.enable`. `target` ist z. B. „Name (uuid)“, „Meldung 12“, „Anfrage 7 (Name)“, „Neuigkeit 3: Titel“ oder ein Dateiname.
- **Teamprofil:** `public` (Standard `false`: niemand erscheint ohne eigene Zustimmung), `title` (Aufgabe, 0–40 Zeichen, eine Zeile, z. B. „Entwicklung“), `about` (0–200 Zeichen, eine Zeile); sonst 400. Die Zustimmung lässt sich jederzeit zurücknehmen; wer das Team verlässt, verliert das Profil (bei neuer Aufnahme ist es wieder privat).

### Support-Anfragen

`Ticket` = `{ "id", "at", "updatedAt", "category": "hilfe" | "fehler" | "konto" | "sonstiges", "subject": "<1–100, eine Zeile>", "status": "open" | "answered" | "closed", "player": { "uuid", "name" }, "messages": [TicketMessage], "unread": bool }`

`TicketMessage` = `{ "id", "at", "from": "player" | "team", "author": "<Name>", "text": "<1–2000, Zeilenumbrüche erlaubt>" }`

| Anfrage | Anmeldung | Inhalt | Antwort |
| --- | --- | --- | --- |
| `GET /v1/support` | Spieler (Bearer oder Cookie) | – | `{ "tickets": [Ticket ohne messages] }`, neueste Aktivität zuerst |
| `POST /v1/support` | Spieler | `{ "category", "subject", "text" }` | `{ "ticket": Ticket }` |
| `GET /v1/support/<id>` | Spieler (nur eigene, sonst 404) | – | `{ "ticket": Ticket }`, setzt `unread` zurück |
| `POST /v1/support/<id>/messages` | Spieler | `{ "text" }` | `{ "ticket": Ticket }` |
| `POST /v1/support/<id>/close` | Spieler | – | `{ "ticket": Ticket }` |

Die Routen für das Team (`/v1/team/support…`, jede Rolle) stehen beim [Team-Bereich](#team-bereich).

- **Namen:** Für den Spieler heißt `author` bei Team-Antworten „HeldixClient-Team“, außer das Mitglied steht (gerade) auf der öffentlichen Teamseite; dann sein Name. Das Team sieht immer den echten Namen.
- **`unread`:** für den Spieler: Es gibt eine Team-Antwort nach seinem letzten Öffnen (`GET /v1/support/<id>`; eigenes Schreiben und Schließen zählen auch als gelesen). Für das Team: Die letzte Nachricht ist vom Spieler (wartet auf Antwort).
- **Status:** neue Anfrage und neue Nachricht des Spielers: `open`; Antwort des Teams: `answered`; Schließen (beide Seiten): `closed`. Auf geschlossene Anfragen kann niemand mehr antworten (409); erneutes Schließen ändert nichts.
- **Antwort des Teams:** Alle WebSocket-Verbindungen des Spielers bekommen `{ "type": "support", "id", "subject" }` (das Spiel blendet „Antwort vom HeldixClient-Team“ ein).
- **Prüfungen:** unbekannte Kategorie, Betreff nicht 1–100 Zeichen in einer Zeile, Text nicht 1–2000 Zeichen (Zeilenumbrüche erlaubt, sonst keine Steuerzeichen): 400. Fremde oder unbekannte Nummer: 404.
- **Grenzen:** höchstens 3 nicht geschlossene Anfragen pro Spieler (409 „Du hast schon 3 offene Anfragen. Schließ eine, bevor du eine neue schreibst.“), höchstens 5 neue in 24 Stunden (429) und 30 Nachrichten pro Stunde und Spieler, die erste einer neuen Anfrage eingerechnet (429). Bei 429 steht `Retry-After` dabei.
- **Aufbewahrung:** geschlossene Anfragen 90 Tage nach dem Schließen, alle anderen 180 Tage nach der letzten Nachricht. `DELETE /v1/me` und eine Sperre löschen die Anfragen des Spielers sofort. Löscht ein Team-Mitglied seine Daten, bleiben seine Antworten mit seinem Namen in den Anfragen anderer.

### Öffentliche Teamseite

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/public/team` | `{ "members": [ { "uuid", "name", "role", "title", "about", "since": <ms> } ] }`: nur Mitglieder mit `public: true`, Admins zuerst, dann nach Name; `Cache-Control: max-age=60` |
| `GET /v1/public/skins/<uuid>` | PNG des Minecraft-Skins (`image/png`, `Cache-Control: max-age=3600`); nur für Mitglieder mit `public: true`, sonst 404 |

- `since`: seit wann im Team. Das Teamprofil bearbeitet jedes Mitglied selbst (`/v1/team/me/profile`, siehe [Team-Bereich](#team-bereich)).
- **Skins:** Der Dienst fragt `<Session-Server>/session/minecraft/profile/<uuid>` (dieselbe Adresse wie bei der Anmeldung) und liest die Skin-Adresse aus der Eigenschaft `textures` (Base64-JSON). Erlaubt sind nur Skin-Dateien von `textures.minecraft.net`, geladen immer über HTTPS (Mojang nennt `http://`), ohne Weiterleitungen, mit Zeitgrenze, höchstens 256 KB und nur, wenn die Datei mit der PNG-Signatur beginnt. Der Dienst hält Skins 6 Stunden im Arbeitsspeicher (höchstens 100), fehlende 10 Minuten. Kein Skin oder ein Fehler: 404 (die Webseite zeigt dann Initialen). Für andere Spieler fragt der Dienst Mojang gar nicht erst; so ist er kein offener Proxy.

### Neuigkeiten (öffentlich)

`GET /v1/news?limit=<1–50, Standard 10>&before=<id>` ohne Anmeldung → `{ "news": [ { "id", "title", "text", "at", "author" } ], "more": bool }`, nur veröffentlichte, neueste zuerst, mit `Cache-Control: max-age=60`. Webseite (Startseite und Archiv) und Launcher zeigen sie. Der Text wird nie als HTML ausgewertet; Zeilenumbrüche werden zu Absätzen.
- **Archiv:** Mit `before` kommen die Neuigkeiten, die in dieser Reihenfolge nach der mit dieser ID stehen (älter); für die nächste Seite `before` auf die `id` der letzten setzen. `more`: Es gibt noch ältere. Aufrufe ohne `before` bleiben wie bisher.

### Status

`GET /v1/status` ohne Anmeldung → `{ "ok": true, "service": "<Version des Dienstes>", "online": <Spieler mit offener WebSocket-Verbindung>, "players": <angemeldete Spieler insgesamt>, "launcher": "<veröffentlichte Version>" | null, "since": <Start des Dienstes, ms> }`, `Cache-Control: max-age=30`.
- Nur Summen, keine Namen. `online` zählt jeden Spieler einmal, auch mit mehreren Verbindungen; eine Web-Sitzung zählt nicht. `players` zählt der Dienst höchstens alle 30 Sekunden neu. `launcher` ist die Version, die `/v1/launcher/latest` gerade ausliefert.

### Echtzeit (WebSocket)

`GET /v1/ws` mit `Authorization: Bearer <token>`. Nachrichten sind JSON-Texte.

Client → Dienst:
- `{ "type": "status", "state": "menu" | "singleplayer" | "multiplayer" | "realms" | "lan", "server": "<domain>" | "<domain>:<port>" | null }`. Den `server` prüft der Dienst: nur Domains wie `hypixel.net`, keine IP-Adressen, kein `localhost`, keine Namen ohne Punkt, höchstens 253 Zeichen. Ein Port von 1 bis 65535 bleibt erhalten (`play.example.de:25570`), der Standard-Port 25565 fällt weg (`play.example.de`). Bei ungültigem Wert, auch bei ungültigem Port, wird `server` zu `null`.
- `{ "type": "ping" }` etwa alle 30 Sekunden. Antwort: `{ "type": "pong" }`. Ohne Nachricht für 90 Sekunden schließt der Dienst die Verbindung.

Dienst → Client:
- `{ "type": "friends", "friends": […], "incoming": […], "outgoing": […], "unread": { … } }` direkt nach dem Verbinden und nach jeder Änderung an Freunden oder Anfragen, auch durch die andere Seite.
- `{ "type": "friend", "friend": Friend }`, wenn ein Freund online oder offline geht oder seinen Status ändert.
- `{ "type": "request", "from": { "uuid", "name" } }` bei einer neuen eingehenden Anfrage. Danach folgt eine `friends`-Nachricht.
- `{ "type": "accepted", "friend": Friend }`, wenn jemand die eigene Anfrage angenommen hat. Danach folgt eine `friends`-Nachricht.
- `{ "type": "message", "message": Message, "name": "<Name des Absenders>" }` bei jeder neuen Nachricht, an alle Verbindungen des Empfängers und des Absenders (so sehen auch die anderen Geräte des Absenders die Nachricht). `message.read` gilt wie oben aus Sicht des Empfängers der WebSocket-Nachricht. Eine neue Nachricht schickt keine `friends`-Nachricht hinterher; `unread` zählt der Client selbst weiter.
- `{ "type": "read", "uuid": "<Freund>" }`, wenn du auf einem deiner Geräte die Nachrichten dieses Freundes als gelesen markiert hast. Nur an deine eigenen Verbindungen.
- `{ "type": "support", "id": <Nummer>, "subject": "<Betreff>" }`, wenn das Team auf eine deiner Support-Anfragen antwortet.

Ein Spieler ist online, solange mindestens eine Verbindung offen ist. Bei mehreren Verbindungen gilt der zuletzt gemeldete Status.

Der Dienst schließt Verbindungen mit Code 4000 („Zeitüberschreitung“), 4001 („Konto gelöscht“) und 4003 („Gesperrt“). Eine Sperre über `heldix-dienst-admin` bemerkt eine offene Verbindung beim nächsten `ping`.

### Schutz vor Missbrauch

- Anfragekörper sind höchstens 16 KB groß und müssen innerhalb von 15 Sekunden ankommen (sonst 408). Ausnahme: Uploads der Installer im Team-Bereich, bis 1 GiB, abgebrochen erst, wenn 60 Sekunden lang nichts ankommt.
- Anmeldung (`challenge`, `login`, `dev`): höchstens 20 Anfragen pro Minute und IP.
- Übrige Anfragen: höchstens 120 pro Minute und Token, sonst 429.
- Webseite: höchstens 10 Anmelde-Links pro Minute und Spieler, 5 Versuche für den 2FA-Code pro 10 Minuten und Spieler, 5 Datenexporte pro Stunde und Spieler.
- Support: höchstens 3 offene Anfragen, 5 neue in 24 Stunden und 30 Nachrichten pro Stunde und Spieler.
- Nachrichten: höchstens 20 pro Minute und Spieler. Meldungen: einmal pro Spieler und höchstens 10 in 24 Stunden. Blockierungen: höchstens 500. Downloads der Launcher-Installer: höchstens 30 pro Minute und IP.
- Hinter einem Reverse-Proxy zählt `X-Forwarded-For` nur mit `HELDIX_DIENST_TRUST_PROXY=1`.

## Betrieb

### Installation mit einem Befehl (empfohlen)

Ein Befehl richtet Webseite und API mit HTTPS ein:

| Adresse | Inhalt |
| --- | --- |
| `https://example.de` | Webseite von HeldixClient mit Funktionen, Bildern, Download, Impressum und Datenschutzerklärung; `www.example.de` leitet dorthin weiter |
| `https://api.example.de` | Heldix-Dienst (diese Schnittstelle, inklusive WebSockets) |

Voraussetzung ist ein Linux-Server mit systemd, z. B. Debian 12 oder Ubuntu 22.04/24.04, mit x86_64 oder arm64. Getestet wurde auf Ubuntu 24.04.

1. **Angaben für Impressum und Datenschutz:** `website/site.config.example.json` als `website/site.config.json` speichern und ausfüllen: Name, Anschrift, E-Mail und Hosting-Anbieter. Die Datei enthält persönliche Angaben und wird nicht eingecheckt. Fehlt sie, enthalten beide Seiten Platzhalter, und der Installer warnt.

2. **Installer bauen** (auf dem Entwicklungs-PC):

   ```powershell
   cd service
   npm run installer
   ```

   Das erzeugt `service/release/heldix-dienst-install.sh` und eine Prüfsumme daneben. Die Datei ist etwa 5 MB groß und enthält den Dienst und die fertige Webseite.

3. **DNS:** A- bzw. AAAA-Einträge für `example.de`, `www.example.de` und `api.example.de` auf den Server setzen. Die Ports 80 und 443 müssen von außen erreichbar sein.

4. **Auf dem Server ausführen:** Die Datei hochladen (z. B. `scp service/release/heldix-dienst-install.sh root@server:`) und starten:

   ```sh
   sudo bash heldix-dienst-install.sh --domain example.de --email admin@example.de
   ```

   Liegt die Datei irgendwo per HTTPS, etwa als GitHub-Release, geht es auch direkt:

   ```sh
   curl -fsSL https://…/heldix-dienst-install.sh | sudo bash -s -- --domain example.de --email admin@example.de
   ```

5. **API-Adresse eintragen:** Am Ende zeigt der Installer die Zeile für [config.ts](../launcher/src/main/config.ts), also `HELDIX_SERVICE_URL = 'https://api.example.de'`.

**Was der Installer macht**
- **Node.js und Caddy:** Er lädt Node.js 24 und Caddy (HTTPS mit Let's Encrypt) von den offiziellen Seiten, prüft die Prüfsummen und legt beide unter `/opt/heldix-dienst` ab. Paketquellen ändert er nicht.
- **Eigene Benutzer:** Dienst und Caddy laufen ohne Rechte, jeweils mit einem eigenen Benutzer. Der Dienst lauscht nur auf `127.0.0.1`. Die systemd-Dienste `heldix-dienst` und `heldix-dienst-caddy` sind abgeschottet und starten nach einem Neustart von selbst.
- **Webseite:** Caddy liefert sie aus `/opt/heldix-dienst/app/website` aus, mit kurzen Adressen wie `/datenschutz`, eigener 404-Seite und strengen Sicherheits-Headern (CSP, HSTS). Zugriffsprotokolle schreibt Caddy keine. Die Anzeige „Heldix-Dienst online“ unten auf der Seite fragt `/dienst-status` auf derselben Adresse ab, der Download-Bereich ebenso `/launcher-latest` (leitet intern auf `/v1/launcher/latest`). Der Download-Knopf zeigt direkt auf `https://api.<domain>/v1/launcher/download/latest`.
- **API:** Caddy reicht alles an den Dienst weiter. Die Launcher-Installer unter `/v1/launcher/download/` und die Uploads unter `/v1/team/updates/files/` gehen ohne Kompression durch (`Content-Length` und `Range` bleiben erhalten); Caddy streamt sie in beide Richtungen, ohne Grenze für den Anfragekörper und ohne Zeitgrenze.
- **Webseite und Dienst unter einer Adresse:** Auf der Webseite leitet Caddy `/api/*` ohne das `/api` an den Dienst weiter (Anmeldung, Spieler- und Team-Bereich mit dem Cookie der Webseite), ebenfalls ohne Kompression und ohne Grenze für Uploads. Der Dienst sieht die IP der Besucher wie bei der API über `X-Forwarded-For`. Der Installer setzt `HELDIX_DIENST_WEBSITE=https://<domain>`.
- **Update-Schlüssel:** `npm run installer` übernimmt den öffentlichen Schlüssel aus [launcher/src/main/update-public-key.ts](../launcher/src/main/update-public-key.ts). Der Installer legt ihn als `/etc/heldix-dienst/update-public-key.pem` ab und setzt `HELDIX_DIENST_UPDATE_KEY`. Ohne Schlüssel lassen sich Updates nur per `scp` veröffentlichen.
- **Daten:** Datenbank in `/var/lib/heldix-dienst`, Einstellungen in `/etc/heldix-dienst/dienst.env`. Eigene Einträge dort, z. B. `HELDIX_DIENST_CAPES`, bleiben bei Updates erhalten. Der Entwicklungsmodus wird auf dem Server immer ausgeschaltet.
- **Launcher-Updates:** Ordner `/var/lib/heldix-dienst/updates`. Er gehört dem Benutzer des Dienstes (Rechte 755): Der Dienst schreibt dort Uploads aus dem Team-Bereich, root lädt per `scp` hoch. Siehe [Launcher-Update veröffentlichen](#launcher-update-veröffentlichen).
- **Verwaltung:** Der Befehl `heldix-dienst-admin` (in `/usr/local/bin`) zeigt Meldungen, sperrt Spieler und verwaltet das Team, siehe [Verwaltung](#verwaltung-meldungen-sperren-und-team).
- **Firewall:** Ist ufw oder firewalld aktiv, öffnet er die Ports 80 und 443.
- **Prüfungen:** Er prüft, ob alle Namen auf den Server zeigen und ob die Ports frei sind. Zum Schluss fragt er API und Webseite über HTTPS ab.

| Option | Bedeutung |
| --- | --- |
| `--domain <name>` | Hauptdomain: Webseite dort, API auf `api.<domain>`; Pflicht (außer mit `--no-https`) |
| `--api-domain <name>` | andere Adresse für die API, z. B. `dienst.example.de` |
| `--email <adresse>` | für Let's Encrypt, empfohlen |
| `--no-website` | nur die API, keine Webseite |
| `--no-www` | keine Weiterleitung von `www.<domain>` (bei Subdomains wie `heldix.example.de` automatisch) |
| `--port <zahl>` | interner Port, Standard 8787 |
| `--no-https` | ohne Caddy, z. B. wenn schon nginx, Apache oder Plesk auf 80/443 läuft. Dort dann die API an `127.0.0.1:<port>` weiterleiten (Beispiele unten) und die Webseite aus `/opt/heldix-dienst/app/website` ausliefern |
| `--uninstall` | Programme, Dienste und `heldix-dienst-admin` entfernen, Daten (auch die Launcher-Updates) bleiben; mit `--purge` auch Daten, Zertifikate und Benutzer |
| `--yes` | keine Rückfragen |

- **Update:** Den Installer einer neueren Version mit denselben Optionen noch einmal ausführen. Node.js und Caddy werden nur neu geladen, wenn es neue Versionen gibt. Für eine geänderte Webseite reicht dasselbe: `npm run installer`, dann den Installer erneut ausführen.
- **Log:** `journalctl -u heldix-dienst -f`, für HTTPS `journalctl -u heldix-dienst-caddy -f`.
- **Webseite ansehen ohne Server:** `node website/build.mjs` baut sie nach `website/dist`.

### Erster Admin und Team-Bereich

1. Der künftige Admin meldet sich einmal im Launcher oder im Spiel beim Dienst an (dann kennt ihn der Dienst).
2. Auf dem Server: `sudo heldix-dienst-admin team <spielername> admin`.
3. Im Launcher „Auf heldixclient.com anmelden“ wählen; der Browser öffnet `https://<domain>/konto`.
4. Im Team-Bereich die Zwei-Faktor-Anmeldung einrichten: QR-Code (oder Geheimnis) in eine Authenticator-App übernehmen, Code eingeben.
5. Weitere Mitglieder nimmt der Admin im Team-Bereich auf. Verliert jemand sein Handy: `sudo heldix-dienst-admin team-2fa-reset <name>` (oder ein anderer Admin im Team-Bereich).

### Launcher-Update veröffentlichen

**Im Browser** (Admin im Team-Bereich): Installer hochladen, dann `update.json` hochladen. Der Dienst prüft Signatur, Größe, SHA-512 und Version und veröffentlicht erst dann.

**Per scp:** Der Launcher-Build erzeugt den Installer `HeldixClient-Setup-<version>.exe` und die signierte `update.json`. Beide kommen in den Update-Ordner, **erst der Installer, `update.json` zuletzt** (scp kopiert in der angegebenen Reihenfolge):

```sh
scp HeldixClient-Setup-0.12.0.exe update.json root@example.de:/var/lib/heldix-dienst/updates/
```

- Ein Neustart ist nicht nötig: Ändert sich `update.json`, liest der Dienst sie beim nächsten Abruf neu. Im Log steht dann „Launcher-Version 0.12.0 ist veröffentlicht“, bei Fehlern der Grund.
- Solange der Installer fehlt oder noch nicht vollständig hochgeladen ist (Größe wie `size` im Manifest), meldet `/v1/launcher/latest` 404. Der Launcher sieht also nie eine Version, die er nicht laden kann.
- Die Dateien müssen für den Dienst lesbar sein (bei scp als root der Standard, Rechte 644). Alte Installer können liegen bleiben; ausgeliefert wird jede Datei mit passendem Namen, angeboten nur die aus `update.json`.
- Ohne Installer (Docker, von Hand): Update-Ordner ist `HELDIX_DIENST_UPDATES`, Standard `<Datenordner>/updates`.

### Verwaltung: Meldungen, Sperren und Team

Auf dem Server mit sudo (der Befehl läuft als Benutzer des Dienstes, mit dessen Datenordner, und darf laufen, während der Dienst läuft). Jede Änderung steht im Team-Protokoll mit dem Handelnden „CLI“.

| Befehl | Wirkung |
| --- | --- |
| `sudo heldix-dienst-admin meldungen [alle]` | offene (mit `alle` auch erledigte) Meldungen, älteste zuerst: Nummer, Datum, wer wen gemeldet hat, Grund, Notiz und die gemeldeten Nachrichten |
| `sudo heldix-dienst-admin meldung-erledigt <nummer> …` | Meldung(en) als erledigt markieren (sie bleiben bis zum Ablauf nach 90 Tagen) |
| `sudo heldix-dienst-admin sperren <name\|uuid> [grund]` | Spieler sperren: löscht Konto, Freundschaften, Anfragen, Nachrichten, Blockierungen und Anmeldungen. Neue Anmeldungen lehnt der Dienst mit 403 ab. Mit UUID (auch mit Bindestrichen) geht es auch für Spieler, die noch nie online waren |
| `sudo heldix-dienst-admin entsperren <name\|uuid>` | Sperre aufheben; bei der nächsten Anmeldung legt der Dienst das Konto neu an |
| `sudo heldix-dienst-admin gesperrt` | alle Sperren mit Datum und Grund |
| `sudo heldix-dienst-admin team <name\|uuid> admin\|moderator` | ins Team aufnehmen oder Rolle ändern; der Spieler muss sich schon einmal angemeldet haben. So entsteht der erste Admin |
| `sudo heldix-dienst-admin team-entfernen <name\|uuid>` | aus dem Team entfernen (warnt, wenn danach kein Admin mehr da ist) |
| `sudo heldix-dienst-admin team-liste` | alle Mitglieder mit Rolle, seit wann, von wem und ob 2FA eingerichtet ist |
| `sudo heldix-dienst-admin team-2fa-reset <name\|uuid>` | Zwei-Faktor-Anmeldung zurücksetzen; beim nächsten Besuch richtet das Mitglied sie neu ein |

- Gemerkt werden bei einer Sperre nur UUID, letzter Name, Datum und Grund. Die Sperre bleibt, bis sie aufgehoben wird, auch wenn der Spieler vorher „Daten löschen“ benutzt hat.
- Eine noch offene WebSocket-Verbindung des Gesperrten trennt der Dienst beim nächsten Lebenszeichen (`ping`, etwa alle 30 Sekunden) mit 4003; jede weitere Anfrage endet mit 401 und die neue Anmeldung mit 403. Sperren im Team-Bereich trennen sofort. Team-Mitglieder sperrt die CLI auch (sie sind danach nicht mehr im Team); im Team-Bereich geht das nicht.
- Frühere Freunde sehen die Änderung beim nächsten Abruf ihrer Freundesliste oder Verbindungsaufbau.
- Ohne Installer: `HELDIX_DIENST_DATA=<Datenordner> node dist/admin.js meldungen`, in Docker `docker exec heldix-dienst node dist/admin.js meldungen`. Den Befehl als derselbe Benutzer wie den Dienst ausführen, damit die Dateien der Datenbank ihm gehören bleiben.

### Von Hand

- **Umgebungsvariablen:**
  - `PORT` (Standard 8787) und `HELDIX_DIENST_DATA` (Ordner für die Datenbank, Standard `./data`).
  - `HELDIX_DIENST_UPDATES` (Ordner für Launcher-Installer und `update.json`, Standard `<Datenordner>/updates`; der Dienst schreibt dort Uploads aus dem Team-Bereich).
  - `HELDIX_DIENST_WEBSITE` (Adresse der Webseite, z. B. `https://heldixclient.com`, ohne Pfad): für die Anmelde-Links und den Schutz vor fremden Seiten. Ohne: keine Anmeldung auf der Webseite (`POST /v1/web/link` → 503).
  - `HELDIX_DIENST_UPDATE_KEY` (Datei mit dem öffentlichen Update-Schlüssel, PEM, Ed25519). Ohne oder unlesbar: Der Dienst startet mit einer Warnung, Veröffentlichen im Team-Bereich antwortet mit 503.
  - `HOST` (Standard: alle Netzwerkschnittstellen; mit `127.0.0.1` nur von diesem Rechner erreichbar).
  - `HELDIX_DIENST_SESSION_SERVER` (Standard `https://sessionserver.mojang.com`, für Tests umstellbar).
  - Dazu die oben genannten `HELDIX_DIENST_DEV`, `HELDIX_DIENST_CAPES` und `HELDIX_DIENST_TRUST_PROXY`.
- **Speicher:** SQLite über `node:sqlite` (Node 24), ohne native Pakete. Die Datenbank ist die Datei `heldix-dienst.db` im Datenordner. Zum Sichern den Ordner kopieren, während der Dienst nicht läuft. Eine Datenbank einer älteren Version hebt der Dienst beim Start selbst an (Schema-Version in `PRAGMA user_version`); zurück auf eine ältere Version des Dienstes geht danach nicht mehr.
- **Starten ohne Docker** (Node 24):

  ```powershell
  cd service
  npm ci
  npm run build
  npm start        # Port 8787, Datenbank in service/data/
  npm test         # baut und prüft den Dienst; Mojang wird dabei nur nachgebaut, nie gefragt
  npm run dev      # bauen und mit HELDIX_DIENST_DEV=1 starten, nur zum Testen auf dem eigenen PC
  ```

  Mit eigenen Werten, z. B. in PowerShell: `$env:PORT = "9000"; npm start`.
- **Docker:** Ein Dockerfile liegt bei ([service/Dockerfile](../service/Dockerfile)). Das Image läuft ohne Root-Rechte und legt die Datenbank im Volume `/data` ab.

  ```sh
  cd service
  docker build -t heldix-dienst .
  docker run -d --name heldix-dienst --restart unless-stopped \
    -p 127.0.0.1:8787:8787 \
    -v heldix-dienst-daten:/data \
    -e HELDIX_DIENST_TRUST_PROXY=1 \
    heldix-dienst
  docker logs -f heldix-dienst   # Log ansehen
  ```

  `HELDIX_DIENST_TRUST_PROXY=1` nur setzen, wenn der Port wie oben nur für den eigenen Reverse-Proxy offen ist. Der Dienst nimmt dann den letzten Eintrag von `X-Forwarded-For` (den der Proxy anhängt).
- **Reverse-Proxy mit HTTPS:** Den Dienst nie direkt ins Internet stellen, sondern hinter einen Reverse-Proxy mit HTTPS (z. B. Caddy oder nginx); WebSockets müssen durchgereicht werden. Caddy holt das Zertifikat selbst und reicht WebSockets ohne weitere Einstellung durch:

  ```
  dienst.example.net {
      reverse_proxy 127.0.0.1:8787
  }
  ```

  Bei nginx braucht `/v1/ws` die Upgrade-Header und ein Timeout über 90 Sekunden (im `server`-Block mit HTTPS):

  ```nginx
  location /v1/ws {
      proxy_pass http://127.0.0.1:8787;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_read_timeout 120s;
  }
  location /v1/launcher/download/ {
      proxy_pass http://127.0.0.1:8787;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_buffering off;
  }
  location / {
      proxy_pass http://127.0.0.1:8787;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
  ```

  `proxy_buffering off` reicht die Launcher-Installer (über 100 MB) direkt durch, statt sie erst zwischenzuspeichern; Kompression dort nicht einschalten. Die Webseite fragt auf ihrer eigenen Adresse `/dienst-status` und `/launcher-latest` ab: Beide an den Dienst weiterleiten, auf `/health` bzw. `/v1/launcher/latest`. Dazu `/api/` ohne das Präfix (im `server`-Block der Webseite):

  ```nginx
  location /api/ {
      proxy_pass http://127.0.0.1:8787/;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      client_max_body_size 1100m;
      proxy_request_buffering off;
      proxy_buffering off;
      proxy_read_timeout 600s;
  }
  ```
- **Überwachung:** `GET /health` antwortet mit `{ "ok": true }` (nutzt auch der Docker-Healthcheck). Ohne Anmeldung, ohne Daten. `GET /v1/status` zeigt dazu Version, Start, Spieler online und insgesamt und die veröffentlichte Launcher-Version.
- **Verbindungen nach außen:** Außer zu Mojang für die Anmeldung (`sessionserver.mojang.com`) verbindet sich der Dienst nur für die Skins der öffentlichen Teamseite (`sessionserver.mojang.com`, `textures.minecraft.net`, jeweils HTTPS).
- **Adresse im Client:** In [launcher/src/main/config.ts](../launcher/src/main/config.ts) bei `HELDIX_SERVICE_URL` eintragen (oder beim Bauen die Umgebungsvariable `HELDIX_SERVICE_URL` setzen). Der Launcher gibt sie dem Spiel als `-Dheldixclient.service=<url>` mit.
