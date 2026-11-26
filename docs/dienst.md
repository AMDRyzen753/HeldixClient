# Heldix-Dienst: Capes und Cosmetics für alle, Heldix-Symbol und Freunde

Der Heldix-Dienst ist ein kleiner Server (Ordner [service/](../service)). Zusammen mit der Webseite (Ordner [website/](../website)) richtet ihn ein Installer mit einem Befehl ein, siehe [Betrieb](#betrieb). Er verbindet HeldixClient-Spieler untereinander:

- **Capes für alle sichtbar:** Andere HeldixClient-Spieler sehen dein Heldix-Cape. Eigene Bilder bleiben auf deinem PC, damit keine fremden Bilder über den Dienst laufen.
- **Cosmetics für alle sichtbar:** Hüte, Flügel, Auren, Begleiter und weitere Capes aus dem Katalog des Teams. Jedes Cosmetic ist reine Daten (Modell und Textur, kein Code) und mit dem Update-Schlüssel signiert. Du wählst sie im Spiel, im Launcher oder auf der Webseite, und alle HeldixClient-Spieler sehen sie ohne Installation.
- **Heldix-Symbol:** In der Tab-Liste und im Namensschild über dem Kopf steht das Heldix-Logo vor dem Namen von HeldixClient-Spielern. Team-Admins und Moderatoren (nur mit öffentlichem Teamprofil) und Addon-Entwickler haben ein eigenes Symbol; unten in der Tab-Liste steht, wie viele HeldixClient-Spieler da sind.
- **Freunde:** Freundesliste mit Anfragen und Online-Status. Auf Wunsch zeigt sie, auf welchem Server ein Freund gerade spielt, sodass du ihm direkt beitreten kannst.
- **Nachrichten:** Kurze Direktnachrichten an Freunde, auch wenn ihr gerade nicht auf demselben Server seid.
- **Blockieren und Melden:** Wer stört, lässt sich blockieren und beim Betreiber melden.
- **Launcher-Updates und Downloads:** Der Launcher lädt neue Versionen über den Dienst. Alle Downloads der Webseite (Windows und macOS, mit Prüfsummen) kommen ebenfalls vom Dienst, nicht von GitHub.
- **Addon-Store:** Heldix-Addons kommen einzeln aus dem Store, im Launcher, im Spiel und auf der Webseite; seit Version 1.6.1 auch Addons, die direkt in Minecraft eingreifen (früher Heldix-Mods). Offizielle Addons veröffentlicht das Team; jeder angemeldete Spieler kann eigene Addons einreichen, das Team prüft sie. Jede Version ist mit dem Update-Schlüssel signiert, auch bei Addons von Spielern (Freigeben heißt signieren). Dazu Screenshots, Bewertungen, Meldungen und eine Seite je Entwickler.
- **Webseite mit Konto:** Anmelden ohne Passwort über den Launcher oder das Spiel, ab Version 1.7.0 auf Wunsch auch direkt mit dem Minecraft-Konto (bei Microsoft). Auf der Webseite siehst du Freunde, Nachrichten und Einstellungen, lädst deine Daten herunter und siehst deine Meldungen.
- **Team-Bereich:** Moderatoren und Admins bearbeiten auf der Webseite Meldungen, Sperren und Support-Anfragen und schreiben Neuigkeiten. Sie prüfen eingereichte Addons und lehnen sie ab; Admins geben sie frei (signieren), veröffentlichen außerdem Updates und offizielle Addons und verwalten das Team. Der Zugang braucht eine Zwei-Faktor-Anmeldung.
- **Support:** Spieler schreiben dem Team über Webseite, Launcher oder Spiel, auf Wunsch mit Textdateien als Anhang (z. B. Absturzbericht aus der Absturzhilfe des Launchers); Antworten meldet das Spiel sofort.
- **Teamseite, Neuigkeiten, Versionsverlauf, Status:** Öffentlich (ohne Anmeldung) gibt es die Teamseite (nur wer zustimmt), alle Neuigkeiten, die Liste der Launcher-Versionen und einen Status mit Summen.

Ohne eingetragene Adresse des Dienstes sind diese Funktionen aus; der Rest von HeldixClient läuft wie gewohnt.

## Datenschutz

- **Gespeichert werden:** Minecraft-UUID, Spielername, gewähltes Heldix-Cape und gewählte Cosmetics, die Einstellungen unten, Freundschaften und offene Anfragen, Nachrichten an Freunde, Blockierungen, Meldungen, Support-Anfragen (mit Anhängen), eingereichte Addons, Bewertungen und Meldungen zu Addons, Zeitpunkt der letzten Verbindung, Anmeldungen auf der Webseite und für Team-Mitglieder Rolle, 2FA-Geheimnis, Teamprofil und Protokoll.
- **Nicht gespeichert werden:** Passwörter und Microsoft-, Xbox- oder Minecraft-Tokens. Die Anmeldung beim Dienst läuft wie der Beitritt zu einem Minecraft-Server über Mojang; der Dienst sieht dabei kein Token. Bei der Anmeldung mit dem Minecraft-Konto auf der Webseite hat der Dienst die Tokens für die Dauer der Anmeldung in der Hand (nur im Arbeitsspeicher), holt damit UUID und Namen und verwirft sie sofort; sie stehen in keinem Log und keiner Datenbank.
- **Online-Status und Server** sehen nur bestätigte Freunde. Server-Adressen werden nur weitergegeben, wenn sie öffentliche Domains sind (keine IP-Adressen, kein `localhost`, keine Heimnetz-Namen). Ein Port bleibt dabei, wenn er nicht der Standard-Port 25565 ist, damit Freunde beitreten können.
- **Erkennbar sein** (Heldix-Symbol, Cape und Cosmetics für andere): Nur wer online ist und die Einstellung an hat, wird bei einer Abfrage als HeldixClient-Spieler gemeldet, mit Cape und gewählten Cosmetics. Dabei meldet der Dienst auch eine Rolle fürs Symbol: Team-Admin oder Moderator nur, wenn das Mitglied auf der öffentlichen Teamseite steht (sonst bleibt die Rolle verborgen), Addon-Entwickler, wenn ein sichtbares Community-Addon des Spielers im Store ist (das steht ohnehin auf seiner Entwicklerseite). Mehr verrät die Abfrage nicht.
- **Nachrichten** gehen nur an bestätigte Freunde. Der Dienst speichert sie als Verlauf höchstens 30 Tage, danach löscht er sie von selbst; pro Unterhaltung bleiben höchstens die letzten 500. Sie sind **nicht Ende-zu-Ende-verschlüsselt:** Unterwegs schützt sie HTTPS, auf dem Server liegen sie lesbar in der Datenbank. Endet die Freundschaft (Entfernen, Blockieren, Daten löschen), löscht der Dienst die ganze Unterhaltung sofort, für beide. Ob du eine Nachricht gelesen hast, erfährt der Absender nicht.
- **Blockieren:** Ein blockierter Spieler ist kein Freund mehr; Anfragen und Unterhaltung werden gelöscht. Er erfährt davon nichts: Eine neue Anfrage von ihm scheitert so, als gäbe es dich beim Dienst nicht. Gespeichert wird nur, wer wen seit wann blockiert hat.
- **Melden:** Eine Meldung enthält, wer wen gemeldet hat (UUID und Name), den Grund, eine freiwillige Notiz und als Beleg die letzten 20 Nachrichten zwischen beiden. Nur der Betreiber und das Team sehen sie, um Missbrauch zu prüfen. Ist eine Meldung erledigt, merkt sich der Dienst wann und von wem. Alle Meldungen werden nach 90 Tagen gelöscht, auch erledigte. Deine eigenen Meldungen und ihren Stand siehst du auf der Webseite. Löschst du deine Daten, verschwinden deine eigenen Meldungen. Meldungen anderer über dich bleiben bis zum Ablauf, damit Missbrauch nicht durch Löschen und neues Anmelden verschwindet (berechtigtes Interesse an der Abwehr von Missbrauch).
- **Sperren:** Bei Missbrauch können der Betreiber und das Team ein Konto für den Dienst sperren. Dann löscht der Dienst Konto, Freundschaften, Anfragen, Nachrichten, Blockierungen und Anmeldungen (auch auf der Webseite) und merkt sich nur UUID, letzten Namen, Datum, Grund und wer gesperrt hat. Die Sperre bleibt auch nach „Daten beim Dienst löschen“. Minecraft und der Rest von HeldixClient laufen weiter.
- **Anmeldung auf der Webseite:** Es gibt kein Passwort. Der Launcher oder das Spiel holt einen Anmelde-Link, der 2 Minuten gilt und nur einmal geht; oder der Spieler meldet sich bei Microsoft mit seinem Minecraft-Konto an, und der Dienst übernimmt davon nur UUID und Namen (siehe [Anmeldung mit dem Minecraft-Konto](#webseite-anmeldung-mit-dem-minecraft-konto)). Anmeldeversuche zählt er dabei je IP-Adresse nur kurz im Arbeitsspeicher. Für jede Anmeldung speichert der Dienst Beginn, letzte Nutzung und einen kurzen Gerätenamen aus dem User-Agent (z. B. „Firefox · Windows“), mehr nicht. Eine Anmeldung endet nach 30 Tagen, nach 7 Tagen ohne Nutzung, beim Abmelden, beim Löschen der Daten und bei einer Sperre. Das Cookie ist nur für die Anmeldung da (kein Tracking). Auf der Webseite bist du für andere nicht „online“.
- **Datenauskunft:** Auf der Webseite lädt „Meine Daten herunterladen“ alles als Datei herunter, was der Dienst über dich speichert (höchstens 5-mal pro Stunde).
- **Team:** Für Team-Mitglieder speichert der Dienst Rolle, seit wann und von wem, das Geheimnis der Zwei-Faktor-Anmeldung und den zuletzt benutzten Code-Zeitschritt, bis zur Entfernung aus dem Team. Jede ändernde Team-Aktion steht mit Name und Zeitpunkt im Protokoll, das 365 Tage aufbewahrt wird (auch nach dem Löschen der Daten, zur Nachvollziehbarkeit). Neuigkeiten des Teams stehen öffentlich mit dem Namen des Autors auf Webseite und Launcher; löscht der Autor seine Daten, bleibt der Name an der Neuigkeit.
- **Launcher-Updates:** Beim Abruf der neuesten Version und beim Download speichert der Dienst nichts. Wie oft eine IP-Adresse lädt, zählt er nur kurz im Arbeitsspeicher (für die Begrenzung, eine Minute lang). Der Versionsverlauf enthält nur Versionen, Datum und Änderungen, keine Personen.
- **Addon-Store:** Liste, Details, Screenshots, Entwicklerseiten und Downloads gehen ohne Anmeldung; der Dienst erfährt dabei nicht, wer du bist. Pro Addon zählt er nur, wie oft es vollständig heruntergeladen wurde: eine Zahl, ohne IP-Adresse, Zeitpunkt oder sonstige Daten. Wie oft eine IP-Adresse lädt, zählt er wie bei den Launcher-Downloads nur kurz im Arbeitsspeicher (eine Minute lang). Der Launcher lädt die Liste etwa 10 Sekunden nach dem Start und danach alle 6 Stunden im Hintergrund, wenn Addons installiert sind (Hinweise auf Updates, auf Wunsch automatisches Aktualisieren), außerdem beim Öffnen des Stores; das Spiel lädt sie etwa 20 Sekunden nach dem Start einmal, wenn der Heldix-Dienst an ist. Auch das geht ohne Anmeldung. Bei offener Store-Seite fragt der Launcher mit deinem Token deine eigene Bewertung je Addon ab (`/v1/addons/<id>/rating`, 5 Minuten zwischengespeichert). An jeder Version merkt sich der Dienst den Namen des Team-Mitglieds, das sie veröffentlicht oder freigegeben hat; den sieht nur das Team.
- **Addons einreichen:** Gespeichert werden deine Einreichungen (Angaben, JAR, Screenshots, Ergebnis der Prüfung, Begründung beim Ablehnen) mit deiner UUID. Das Team sieht sie erst, wenn du sie einreichst (Entwürfe sind privat). Für Spieler heißt der Prüfer „HeldixClient-Team“, außer er steht auf der Teamseite. Abgelehnte und zurückgezogene Einreichungen löscht der Dienst 90 Tage nach der letzten Änderung (beim Zurückziehen JAR und Screenshots sofort); Entwürfe und wartende bleiben, bis du sie löschst bzw. zurückziehst, freigegebene (ohne Dateien, die liegen dann beim Addon) bis zum Löschen deines Kontos. Ein veröffentlichtes Community-Addon zeigt öffentlich deinen Spielernamen und deine UUID als Autor (im signierten Manifest) und eine Entwicklerseite mit deinen Addons.
- **Cosmetics:** Katalog und Cosmetics (`/v1/cosmetics…`) gehen ohne Anmeldung; der Dienst erfährt dabei nicht, wer du bist. Wie oft eine IP-Adresse Cosmetics lädt, zählt er nur kurz im Arbeitsspeicher (eine Minute lang). Deine Auswahl (eine ID je Slot) speichert er mit deinem Konto; andere HeldixClient-Spieler sehen sie wie das Cape, solange „Für andere erkennbar“ an ist. An jedem Cosmetic merkt sich der Dienst den Namen des Team-Mitglieds, das es veröffentlicht hat; den sieht nur das Team.
- **Bewertungen** (1–5 Sterne) speichert der Dienst mit deiner UUID, bis du sie zurücknimmst oder dein Konto löschst; öffentlich sind nur Durchschnitt und Anzahl. **Meldungen zu Addons** (Grund, Notiz, wer gemeldet hat) sehen nur das Team und der Betreiber; sie werden nach 90 Tagen gelöscht, auch erledigte.
- **Teamseite nur mit Zustimmung:** Auf der öffentlichen Teamseite steht ein Team-Mitglied nur, wenn es das selbst eingeschaltet hat (Standard: aus). Dann zeigt sie Name, Rolle, Aufgabe, einen kurzen Text, seit wann es dabei ist und den Minecraft-Skin; im Spiel trägt es dann das Heldix-Symbol seiner Rolle. Den Skin lädt der Dienst selbst bei Mojang und gibt ihn weiter; der Browser der Besucher fragt nie bei Mojang. Genauso zeigt die Webseite angemeldeten Spielern die Skins ihrer Freunde, Anfragen und Blockierten (und dem Team die von Spielern, um die es geht); andere Skins gibt der Dienst nicht heraus. Ausschalten oder das Verlassen des Teams nimmt den Eintrag sofort heraus.
- **Support-Anfragen** sehen nur du und das Team. Antworten des Teams zeigen dir den Namen des Mitglieds nur, wenn es auf der Teamseite steht, sonst „HeldixClient-Team“. Geschlossene Anfragen löscht der Dienst 90 Tage nach dem Schließen, andere 180 Tage nach der letzten Nachricht. „Daten löschen“ und eine Sperre löschen deine Anfragen sofort; sie stehen in deiner Datenauskunft. **Anhänge** (Textdateien wie Absturzbericht und Log, z. B. aus der Absturzhilfe des Launchers „An den Support senden“) gehören zur Anfrage und werden mit ihr gelöscht. Absturzberichte und Logs können Dateipfade, Server-Adressen und Namen von Mods enthalten; der Launcher zeigt dir vor dem Senden genau, was er schickt, und ersetzt dein Benutzerverzeichnis durch `~`. Der Dienst speichert Anhänge komprimiert in der Datenbank; die Datenauskunft nennt Name und Größe, den Inhalt lädst du auf der Webseite bei der Anfrage herunter.
- **Status:** Die öffentliche Status-Abfrage zeigt nur Summen (wie viele Spieler online und insgesamt angemeldet sind, wie viele Addons im Store und Cosmetics im Katalog sind), keine Namen.
- **Einstellungen im Heldix-Menü:** „Für andere erkennbar“, „Online-Status für Freunde“, „Server für Freunde sichtbar“, „Nachrichten von Freunden annehmen“.
- **Daten löschen:** Im Heldix-Menü unter Freunde → Privatsphäre (oder auf der Webseite) löscht „Daten beim Dienst löschen“ alles, was der Dienst über dich gespeichert hat: Konto, Freundschaften, Anfragen, Nachrichten (auch die an dich), Blockierungen (von dir und gegen dich), deine Meldungen, alle Anmeldungen auf der Webseite und eine Team-Mitgliedschaft. Dazu gehören auch deine Auswahl an Cosmetics, deine Support-Anfragen, dein Teamprofil, deine Addon-Einreichungen (mit JARs und Screenshots), Bewertungen und Meldungen zu Addons. Deine veröffentlichten Addons bleiben im Store: Ihr Manifest ist signiert und bleibt unverändert (mit deinem damaligen Namen und deiner UUID), angezeigt wird als Autor aber „Gelöschter Spieler“, die Entwicklerseite entfällt, und die Addon-ID bleibt gesperrt (auch für ein neues Konto). Es bleiben nur Meldungen anderer über dich (bis zum Ablauf nach 90 Tagen), Einträge im Team-Protokoll (bis zum Ablauf nach 365 Tagen), der Autorname an Neuigkeiten, an Antworten auf Support-Anfragen anderer, an veröffentlichten Addon-Versionen und an veröffentlichten Cosmetics, und eine Sperre.

## Schnittstelle (Version 1)

Alle Anfragen und Antworten sind JSON (UTF-8), außer Download und Upload der Launcher-Installer und der Addons und dem Datenexport (JSON-Datei). UUIDs sind immer klein geschrieben und ohne Bindestriche (32 Hex-Zeichen). Fehler antworten mit einem passenden HTTP-Status und `{ "error": "<deutscher Text für den Spieler>" }`, im Team-Bereich bei fehlendem Zugang zusätzlich mit `"code"`.

**Zwei Arten der Anmeldung:**
- **Bearer-Token** (Launcher, Spiel): `Authorization: Bearer <token>` aus `POST /v1/auth/login`.
- **Cookie** (Webseite): Die Webseite erreicht den Dienst unter `/api/…` auf ihrer eigenen Adresse (Caddy schneidet `/api` ab: `fetch('/api/v1/web/me')` kommt als `GET /v1/web/me` an). Die Sitzung steckt im Cookie `__Host-heldix_web` (HttpOnly, Secure, SameSite=Strict, Path=/). **CSRF:** Jede Anfrage mit Cookie außer GET und HEAD braucht den Header `X-Heldix-Web: 1`, und ein mitgeschickter `Origin` muss genau die Webseite sein (`HELDIX_DIENST_WEBSITE`); sonst 403. Schickt eine Anfrage beides, zählt das Bearer-Token.

Alle Routen für Spieler (`/v1/me…`, `/v1/friends…`, `/v1/messages…`, `/v1/blocks…`, `/v1/reports…`, `/v1/support…`, `/v1/players/lookup`, `/v1/addon-submissions…`, `/v1/addons/<id>/rating`, `/v1/addons/<id>/reports`) nehmen beides an. `POST /v1/web/link` geht nur mit Bearer-Token, `/v1/web/…` und `/v1/team/…` nur mit Cookie (außer `POST /v1/web/session`, `GET /v1/web/config` und `GET /v1/web/auth/microsoft…`, die ohne Anmeldung gehen), der WebSocket nur mit Bearer-Token.

**Öffentliche Routen** (ohne Anmeldung: `/v1/public/…`, `/v1/news`, `/v1/launcher/…`, `/v1/addons…` außer `…/rating` und `…/reports`, `/v1/addon-authors/…`, `/v1/cosmetics…`, `/v1/status`) antworten immer mit `Access-Control-Allow-Origin: *`, auch bei Fehlern, und mit einem kurzen `Cache-Control` (Addon-Dateien und Cosmetics mit `?v=<sha256>` ändern sich nie und dürfen lange im Cache bleiben).

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
| `GET /v1/me/cosmetics` | – | `MyCosmetics` (siehe [Cosmetics-Katalog](#cosmetics-katalog)) |
| `PUT /v1/me/cosmetics` | `{ "slot", "id" }` | `MyCosmetics` |

`Me` = `{ "uuid", "name", "cape", "visible", "presence", "showServer", "messages" }`. Die Standardwerte sind `cape: ""` und alle vier Schalter `true`.

- `visible`: Für andere als HeldixClient-Spieler erkennbar (Symbol und Cape).
- `presence`: Freunde sehen den Online-Status.
- `showServer`: Freunde sehen den Server.
- `messages`: Nachrichten von Freunden annehmen. Ist der Schalter aus, bekommen Freunde beim Senden 403. Selbst schreiben geht trotzdem, und vorhandene Nachrichten bleiben.
- `cape` muss eine der eingebauten IDs sein: `heldix`, `mitternacht`, `aurora`, `glut`, `kristall`, `neon`, `sakura`, `gewitter`, `galaxie`. Die Liste lässt sich mit der Umgebungsvariable `HELDIX_DIENST_CAPES` (durch Kommas getrennt) ersetzen. `""` heißt: kein Cape. Ab Version 1.6.0 geht auch die ID eines Katalog-Capes (Slot `cape`, siehe [Cosmetics-Katalog](#cosmetics-katalog)), das sichtbar ist und das der Spieler wählen darf; sonst 400 „Unbekanntes Cape.“, bei einem Cape nur fürs Team 403. Ist das gewählte Katalog-Cape gerade ausgeblendet (oder nur fürs Team und der Spieler nicht mehr im Team), zeigt `Me` `cape: ""`; gespeichert bleibt die Wahl trotzdem.
- `DELETE /v1/me` löscht den Spieler mit allen Tokens, Web-Sitzungen, Freundschaften, Anfragen, Nachrichten und Blockierungen (jeweils in beide Richtungen), der Team-Mitgliedschaft (mit Teamprofil), seiner Auswahl an Cosmetics, seinen Support-Anfragen und den Meldungen, die er selbst gemacht hat. Meldungen anderer über ihn und Einträge im Team-Protokoll bleiben bis zum Ablauf, eine Sperre bleibt ganz. Mit Cookie löscht die Antwort auch das Cookie. Seine offenen WebSocket-Verbindungen schließt der Dienst mit Code 4001 („Konto gelöscht“). Frühere Freunde und Spieler mit offenen Anfragen bekommen, falls verbunden, sofort eine neue `friends`-Nachricht ohne ihn. Danach gilt das alte Token nicht mehr (401). Meldet sich derselbe Spieler später wieder an, legt der Dienst ihn neu mit den Standardwerten an.

- **Datenexport** (`GET /v1/me/export`): `Content-Disposition: attachment; filename="heldix-daten-<name>.json"`. Enthält `exportedAt`, `profile` (Me mit `createdAt`, `lastSeen`), `friends` (uuid, name, since), `requests` (`incoming`, `outgoing`), `messages` (alle gespeicherten, beide Richtungen), `blocked`, `reports` (eigene, mit Beleg), `logins` (Zeitpunkte der Tokens), `webSessions` (ohne Hashes), `team` (Rolle oder `null`, ohne 2FA-Geheimnis), `news` (eigene Neuigkeiten), `teamActions` (eigene Einträge im Protokoll), `support` (eigene Support-Anfragen mit allen Nachrichten, so wie du sie siehst) und `cosmetics` (`{ "head", "back", "aura", "companion", "cape" }`: die gespeicherte Auswahl je Slot, auch ausgeblendete, `null` = nichts). Höchstens 5 Exporte pro Stunde, sonst 429.

### Spieler nachschlagen (Tab-Liste, Namensschilder und Capes)

`POST /v1/players/lookup` mit `{ "uuids": ["…", …] }` (höchstens 200) → `{ "players": { "<uuid>": { "cape": "<id>" | "", "badge": "admin" | "moderator" | "developer" | null, "cosmetics": { "head", "back", "aura", "companion" } } } }`

Die Antwort enthält nur Spieler, die gerade verbunden sind (offene WebSocket-Verbindung) und `visible` an haben. Der Anfragende selbst gehört dazu, wenn das zutrifft (so erfährt das Spiel auch die eigene Rolle).

`badge` wählt das Heldix-Symbol (ab Version 1.5.1):
- `admin` / `moderator`: Team-Mitglied, **nur wenn es auf der öffentlichen Teamseite steht** (`public` im Teamprofil). Ohne diese Zustimmung verrät die Antwort keine Rolle.
- `developer`: hat mindestens ein sichtbares, veröffentlichtes Community-Addon im Store (dieselbe Bedingung wie für die Entwicklerseite) und wird nicht schon als Team gezeigt. Addons des Teams zählen nicht.
- `null`: HeldixClient-Spieler ohne besondere Rolle.

`cape` und `cosmetics` (ab Version 1.6.0, siehe [Cosmetics-Katalog](#cosmetics-katalog)):
- `cape` ist ein eingebautes Cape oder die ID eines Katalog-Capes, `""` = keins.
- `cosmetics` nennt je Slot die ID des gewählten Cosmetics oder `null`. Was hinter einer ID steckt (Modell, Textur), steht im Katalog (`GET /v1/cosmetics`).
- Ausgeblendete und gelöschte Cosmetics sind `null` (beim Cape `""`), ebenso Cosmetics nur fürs Team (`access: "team"`), wenn der Spieler nicht (mehr) im Team ist. Das gilt ab der nächsten Abfrage.

**Wer was sieht:** Jeder angemeldete Spieler kann nachschlagen, bekommt aber nur Spieler, die online und erkennbar sind, und für sie nur Cape, Cosmetics und Rolle. Die Rolle steht ohnehin öffentlich auf der Teamseite bzw. der Entwicklerseite. Verbirgt ein Mitglied sein Teamprofil, verlässt es das Team oder wird ein Addon versteckt, gilt das ab der nächsten Abfrage. Das Spiel fragt höchstens einmal pro Sekunde, gebündelt für neue Spieler in der Tab-Liste und in der Nähe; bekannte HeldixClient-Spieler fragt es nach 30 Sekunden neu ab, andere nach 90 Sekunden.

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

Der Launcher aktualisiert sich über den Dienst, und die Download-Seite der Webseite bietet alle Dateien vom Dienst an (Windows-Installer und Mac-Dateien). Signieren und Prüfen der Windows-Updates übernimmt der Launcher; der Dienst liefert nur Dateien aus, die der Betreiber in den Update-Ordner gelegt hat (siehe [Launcher-Update veröffentlichen](#launcher-update-veröffentlichen)). Diese Wege brauchen keine Anmeldung und antworten immer mit `Access-Control-Allow-Origin: *`, auch bei Fehlern, damit auch die Webseite sie abfragen kann.

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/launcher/latest` | Inhalt von `update.json`: `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }`, mit `Cache-Control: no-cache` |
| `GET`, `HEAD /v1/launcher/download/latest` | 302 mit `Location: /v1/launcher/download/<file aus dem Manifest>` (Windows-Installer) |
| `GET`, `HEAD /v1/launcher/download/latest/<ziel>` | 302 auf die neueste Datei für `windows`, `mac-arm64` oder `mac-x64`; nichts da: 404 „Für dieses System gibt es noch keinen Download.“ |
| `GET`, `HEAD /v1/launcher/download/<file>` | die Datei (Windows-Installer oder Mac-Datei) |
| `GET /v1/launcher/files` | `{ "version": "<Version aus dem Manifest>" \| null, "files": [ { "file", "platform": "windows" \| "mac", "arch": "x64" \| "arm64", "kind": "exe" \| "dmg" \| "zip", "version", "size", "sha256": "<hex>", "uploadedAt": <ms> } ] }`, `Cache-Control: max-age=60` |

- `manifest` ist genau der Text aus `update.json` (darüber läuft die Signatur) und ergibt `{ "v": 1, "version": "0.12.0", "file": "HeldixClient-Setup-0.12.0.exe", "size": <Byte>, "sha512": "<Base64>", "date": "JJJJ-MM-TT", "notes": ["…"] }`.
- **Prüfung beim Ausliefern:** Die Signatur prüft hier der Launcher. Der Dienst prüft nur die Form: beide Texte vorhanden, `manifest` ist ein JSON-Objekt mit `v` gleich 1, Text `version`, `file` nach dem Namensmuster unten und ganzzahligem `size`. Außerdem muss `file` im Update-Ordner liegen und genau `size` Byte groß sein; sonst ist der Upload noch nicht fertig. Fehlt etwas: 404 „Noch keine Version veröffentlicht.“ und ein Eintrag im Log. Ändert sich `update.json`, liest der Dienst sie beim nächsten Abruf neu, ohne Neustart.
- **Dateinamen** (`<version>` wie `0.12.1`, auf Wunsch mit Zusatz wie `-beta.1`):

  | System | Datei | Beispiel |
  | --- | --- | --- |
  | Windows | `HeldixClient-Setup-<version>.exe` (steht im signierten Manifest) | `HeldixClient-Setup-0.12.1.exe` |
  | macOS Apple Silicon | `HeldixClient-<version>-mac-arm64.dmg` und `.zip` | `HeldixClient-0.12.1-mac-arm64.dmg` |
  | macOS Intel | `HeldixClient-<version>-mac-x64.dmg` und `.zip` | `HeldixClient-0.12.1-mac-x64.zip` |

  Nur solche Dateien direkt im Update-Ordner liefert der Dienst aus. Andere Namen (auch `.part`, andere Prozessoren oder Endungen), Unterordner und symbolische Links nach außerhalb ergeben 404.
- **Neueste Datei je System** (`latest/<ziel>`): `windows` ist der Installer aus dem Manifest (sobald er vollständig da ist); `mac-arm64` und `mac-x64` sind die höchste Version unter den vorhandenen `.dmg` dieses Prozessors (Vergleich wie im Launcher: `1.10.0` > `1.2.0`, `1.2.0` > `1.2.0-beta.1`). Die Weiterleitung hat `Cache-Control: no-cache`. Ein unbekanntes Ziel ergibt ebenfalls 404.
- **Dateiliste** (`files`, für die Download-Seite): je System, Prozessor und Art nur die neueste Version, sortiert Windows, Mac Apple Silicon (dmg, zip), Mac Intel (dmg, zip). Für Windows steht dort der veröffentlichte Installer aus dem Manifest (hochgeladene, noch nicht veröffentlichte Installer nicht); `version` ist die Version aus dem Manifest. `sha256` berechnet der Dienst einmal (gestreamt, bei Uploads im Team-Bereich schon beim Hochladen) und merkt sie sich, solange Name, Größe und Änderungszeit gleich bleiben.
- **Download:** mit `Content-Length`, `Content-Type` (exe: `application/vnd.microsoft.portable-executable`, dmg: `application/x-apple-diskimage`, zip: `application/zip`), `Content-Disposition: attachment; filename="<file>"`, `Accept-Ranges: bytes`, `ETag` und `Last-Modified`. Ein Bereich per `Range: bytes=a-b`, `bytes=a-` oder `bytes=-n` ergibt 206 mit `Content-Range`, ein Bereich außerhalb der Datei 416. Mehrere Bereiche oder ungültige Angaben ergeben die ganze Datei (200). `If-Range` mit ETag oder Datum wird beachtet. Höchstens 30 Downloads pro Minute und IP, sonst 429.
- Die Datei wird gestreamt, auch ein langsamer Download läuft also bis zum Ende. Kommt 2 Minuten lang gar nichts beim Client an, trennt der Dienst die Verbindung.
- Veröffentlichen geht per `scp` (siehe [Betrieb](#launcher-update-veröffentlichen)) oder als Admin im [Team-Bereich](#team-bereich); dort prüft der Dienst zusätzlich die Signatur.

**Versionsverlauf:** `GET /v1/launcher/versions?limit=<1–50, Standard 20>` → `{ "versions": [ { "version", "date", "notes": ["…"], "publishedAt": <ms> } ] }`, neueste zuerst, `Cache-Control: max-age=60`. Der Launcher zeigt damit nach einem Update „Was ist neu in <Version>“.
- Der Dienst merkt sich jede veröffentlichte Version genau einmal (`version` ist eindeutig): nach dem Veröffentlichen im Team-Bereich und, bei `scp`, sobald er die neue `update.json` einliest und der Installer vollständig da ist (beim nächsten Abruf von `latest`, `versions` oder `status`). `date` und `notes` (höchstens 30) kommen aus dem Manifest, `publishedAt` ist der Zeitpunkt, zu dem der Dienst die Version zuerst gesehen hat.

### Addon-Store

Heldix-Addons kommen nicht mit dem Launcher, sondern einzeln aus dem Store (Launcher, Heldix-Menü im Spiel, Webseite). Addons sind Code, der im Spiel läuft. Deshalb ist jede Version mit dem **Update-Schlüssel** signiert, demselben Ed25519-Schlüssel wie bei Launcher-Updates: offizielle Addons veröffentlicht das Team (Admins, siehe [Team-Bereich](#team-bereich)), Addons von Spielern ([Addons einreichen](#addons-einreichen)) gibt ein Admin nach der Prüfung frei, indem er im Browser das Manifest signiert, das der Dienst erzeugt hat. Der Dienst hat nie den privaten Schlüssel; so kann auch ein übernommenes Team-Konto kein fremdes Addon ausliefern. Diese Wege brauchen keine Anmeldung und antworten immer mit `Access-Control-Allow-Origin: *`, auch bei Fehlern.

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/addons` (auf Wunsch `?author=<uuid>`) | `{ "addons": [Addon] }`: sichtbare Addons mit ihrer neuesten Version, meiste Downloads zuerst, dann nach Name; mit `author` nur die Addons dieses Einreichers (keine gültige UUID: 400); `Cache-Control: max-age=60` |
| `GET /v1/addons/<id>` | `{ "addon": Addon, "versions": [ { "version", "date", "notes", "api", "access", "minecraft", "loaders", "size", "sha256", "file", "publishedAt" } ] }`, neueste Version zuerst; `Cache-Control: max-age=60`. Unbekannt oder versteckt: 404 „Dieses Addon gibt es nicht.“ |
| `GET`, `HEAD /v1/addons/<id>/download` | 302 mit `Location: /v1/addons/<id>/files/<file der neuesten Version>`, `Cache-Control: no-cache` (Knopf auf der Webseite); unbekannt oder versteckt: 404 |
| `GET`, `HEAD /v1/addons/<id>/files/<file>` | die JAR einer veröffentlichten Version dieses Addons; sonst 404 „Diese Datei gibt es nicht.“ |
| `GET`, `HEAD /v1/addons/<id>/screenshots/<1–4>` | das Bild (`image/png` oder `image/jpeg`, `Content-Disposition: inline`, `Cache-Control: public, max-age=86400`, `nosniff`, ETag und Range wie bei Dateien); andere Nummern, unbekannt oder versteckt: 404. Höchstens 300 pro Minute und IP |
| `GET /v1/addon-authors/<uuid>` | Entwicklerseite: `{ "author": { "uuid", "name" }, "addons": [Addon] }` mit allen sichtbaren Addons dieses Einreichers (`name`: aktueller Spielername beim Dienst); ohne sichtbares Addon, unbekannt oder gelöschtes Konto: 404; `Cache-Control: max-age=60` |

`Addon` = alle Felder des Manifests außer `type` (`id`, `name`, `version`, `summary`, `description`, `authors`, `api`, `icon`, `category`, `platforms`, `file`, `size`, `sha256`, `date`, `notes`, `official`, `author`, `access`, `minecraft`, `loaders`; die letzten drei mit ihren Standardwerten, wenn das Manifest sie nicht nennt) plus `downloads` (Zahl), `publishedAt` (ms), `rating` (`{ "average": <Durchschnitt mit einer Nachkommastelle, 0 ohne Bewertungen>, "count" }`), `screenshots` (Anzahl), `screenshotsVersion` (kurzer Hash, ändert sich mit jedem neuen Satz Screenshots; für den Cache, z. B. `…/screenshots/1?v=<screenshotsVersion>`), `manifest` (genau der signierte Text) und `signature` (Base64). `GET /v1/addons/<id>` liefert dazu `versions` (mit `notes`). `author` ist der aus dem Manifest; ist das Konto des Einreichers gelöscht, heißt er `{ "uuid", "name": "Gelöschter Spieler" }`.

- **Prüfen im Client:** Launcher und Spiel prüfen die Signatur selbst und verlassen sich nur auf den geprüften Text in `manifest`, nicht auf die Felder daneben (die sind für die Webseite). Nach dem Download prüfen sie Größe und SHA-256 der JAR.
- **Signatur:** Ed25519 über die UTF-8-Bytes von `"heldix-addon\n" + manifest` (Domänentrennung). Ein Launcher-Update (signiert über den Text ohne Präfix) ist nie als Addon gültig und ein Addon-Manifest nie als Launcher-Update. Erzeugt werden JAR und Manifest im Ordner `launcher` mit `npm run addon -- <id>` (signiert mit dem privaten Update-Schlüssel): `heldix-addon-<id>-<version>.jar` und `heldix-addon-<id>-<version>.addon.json` = `{ "manifest": "<JSON als Text>", "signature": "<Base64>" }`.
- **Manifest** (alle Felder Pflicht außer `official`, `author`, `access`, `minecraft` und `loaders`; unbekannte Zusatzfelder sind erlaubt und werden ignoriert). Texte gelten genau wie signiert, ohne Kürzen; gezählt werden Unicode-Zeichen. Nicht erlaubt sind Steuerzeichen, Zeilen- und Absatztrenner und Steuerzeichen für die Schreibrichtung, in `description` aber Zeilenumbrüche als `\n` (kein `\r`, kein Tab):

  | Feld | Regel |
  | --- | --- |
  | `type` | genau `"heldix-addon"` |
  | `id` | `^[a-z0-9][a-z0-9_-]{0,39}$` (wie in `heldix.addon.json`) |
  | `name` | 1–40 Zeichen, eine Zeile |
  | `version` | `1.2.3` oder mit Zusatz wie `1.2.3-beta.1` (wie bei Launcher-Updates) |
  | `summary` | 1–200 Zeichen, eine Zeile (Kurzbeschreibung = `description` aus `heldix.addon.json`) |
  | `description` | 0–4000 Zeichen Klartext; Absätze durch eine Leerzeile, Zeilen mit `- ` sind Listenpunkte. Wird nie als HTML ausgegeben |
  | `authors` | 1–5 Einträge, je 1–40 Zeichen |
  | `api` | ganze Zahl 1–99: Heldix-API-Stufe, die das Addon braucht |
  | `icon` | `^[a-z0-9-]{1,30}$`, Name aus dem Heldix-Icon-Set; unbekannte zeigen die Clients als Puzzleteil |
  | `category` | `hud`, `musik`, `chat`, `werkzeuge` oder `sonstiges` (angezeigt als „HUD“, „Musik & Medien“, „Chat & Freunde“, „Werkzeuge“, „Sonstiges“) |
  | `platforms` | Liste aus `windows`, `mac`, `linux` ohne Doppelte; leer = alle Systeme |
  | `file` | genau `heldix-addon-<id>-<version>.jar` |
  | `size` | ganze Zahl, 1 Byte bis 50 MiB |
  | `sha256` | 64 kleine Hex-Zeichen |
  | `date` | Datum nach ISO 8601, z. B. `2026-11-25` oder `2026-11-25T18:30:00Z` |
  | `notes` | 0–20 Texte, je 1–300 Zeichen, eine Zeile („Was ist neu“) |
  | `official` | `true` nur bei Addons des Teams (`npm run addon`), sonst `false`. Fehlt es (Manifeste vor Version 1.5.0), gilt `false` |
  | `author` | `{ "uuid": "<32 Hex-Zeichen>", "name": "<Spielername>" }` des Einreichers bei Community-Addons, `null` bei offiziellen (dort Pflicht: `official: true` mit `author` ist ungültig). Fehlt es, gilt `null` |
  | `access` | `"api"` (nur die Heldix-API) oder `"minecraft"` (greift direkt in Minecraft ein: `clientEntrypoint`, `transformers` oder eine mitgebrachte `heldix.mod.json`). Fehlt es (Manifeste vor Version 1.6.1), gilt `api` |
  | `minecraft` | Liste mit 0–50 Minecraft-Versionen, ohne Doppelte, jede `^[0-9A-Za-z][0-9A-Za-z._+*-]{0,31}$` (z. B. `26.3`, `1.21.11`, `26.x`; keine Leerzeichen, `>` oder `\|`); leer = jede Version, das geht nur bei `access: "api"`. Fehlt es, gilt `[]` |
  | `loaders` | nicht leere Liste aus `heldix` (Heldix-Instanzen) und `fabric` (Fabric-Instanzen), ohne Doppelte. Fehlt es, gilt `["heldix", "fabric"]` bei `access: "api"` und `["heldix"]` bei `access: "minecraft"` |

- **Zugriff, Minecraft-Versionen und Loader** (Format 2, ab Version 1.6.1): Launcher und Spiel zeigen „Greift in Minecraft ein“ und die Versionen nur aus dem signierten Text und installieren nur, wenn API-Stufe, System, Minecraft-Version und Loader zur Instanz passen. Die Liste `minecraft` muss (als Menge) genau der aus `heldix.addon.json` der JAR entsprechen, und eine JAR mit `clientEntrypoint` oder `transformers` braucht `access: "minecraft"`; sonst lehnt der Launcher die Installation ab. Ein ungültiges Feld macht den ganzen Eintrag für den Launcher unbrauchbar: Der Dienst prüft deshalb streng und schreibt beim Einreichen alle drei Felder immer ins Manifest.
- **Offiziell oder Community:** Beide Felder stehen im signierten Text; Launcher und Spiel zeigen „Offiziell“/„Community“ und den Autor nur von dort. Der Dienst nimmt im Team-Upload nur `official: true` mit `author: null` an und veröffentlicht bei einer Freigabe genau das Manifest, das er für die Einreichung erzeugt hat (`official: false`, `author` = Einreicher).
- **Besitz:** Ein Addon gehört dem Team (offiziell) oder dem Spieler, dessen Einreichung als erste freigegeben wurde. Offizielle IDs und IDs anderer Besitzer sind für Einreichungen gesperrt, ebenso eine ID, für die gerade die Einreichung eines anderen Spielers auf die Prüfung wartet (409 „Diese Addon-ID gehört schon jemand anderem.“). Umgekehrt kann auch das Team kein offizielles Addon unter der ID eines Spielers veröffentlichen (409). Wird die letzte Version gelöscht, ist die ID wieder frei.
- **Sichtbar:** Ein neues Addon ist sofort im Store. Das Team kann es herausnehmen (`hidden`); dann ergeben Detail, Weiterleitung und Dateien 404, die Dateien bleiben aber liegen. Ein Addon ohne Version gibt es nicht: Wird die letzte Version gelöscht, verschwindet es ganz, mit seinem Zähler.
- **Neueste Version:** Vergleich wie bei Launcher-Updates (`1.10.0` > `1.2.0`, `1.2.0` > `1.2.0-beta.1`). Jede neue Version muss höher sein als alle vorhandenen dieses Addons.
- **Download:** `Content-Type: application/java-archive`, `Content-Disposition: attachment; filename="<file>"`, `Content-Length`, `Accept-Ranges: bytes`, `ETag`, `Last-Modified`, Range und `If-Range` wie bei den Launcher-Downloads (206, 416). `Cache-Control: public, max-age=31536000, immutable`: Eine veröffentlichte Datei lässt sich nicht ersetzen, ihr Name enthält Addon und Version. Nur Dateien, die zu einer veröffentlichten Version genau dieses Addons gehören, liefert der Dienst aus; unveröffentlichte Uploads, andere Namen, Unterordner und symbolische Links nach außerhalb ergeben 404. Höchstens 60 Addon-Downloads pro Minute und IP, sonst 429.
- **Download-Zähler:** Ein vollständig ausgeliefertes `GET` der ganzen Datei (200; kein `HEAD`, kein Teilbereich, kein abgebrochener Download) zählt `downloads` des Addons um 1 hoch. Gespeichert wird nur diese Zahl, keine IP-Adresse und sonst nichts. Die Weiterleitung `download` zählt nicht.
- **Screenshots** (höchstens 4) gehören zum Addon, nicht zur Version, und sind nicht signiert (Bilder sind kein Code). Eine Freigabe mit Screenshots ersetzt die bisherigen, eine ohne lässt sie stehen.

**Bewerten und Melden** (angemeldet: Bearer-Token oder Cookie mit CSRF-Schutz; ohne CORS):

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/addons/<id>/rating` | – | `{ "myRating": 1–5 \| null, "average", "count" }` |
| `PUT /v1/addons/<id>/rating` | `{ "stars": 1–5 }` | wie `GET`; ändert eine vorhandene Bewertung |
| `DELETE /v1/addons/<id>/rating` | – | wie `GET` (eigene Bewertung zurückgenommen) |
| `GET /v1/me/addon-ratings` | – | `{ "ratings": { "<id>": 1–5 } }`: alle eigenen Bewertungen auf einmal (statt einer Abfrage je Addon) |
| `POST /v1/addons/<id>/reports` | `{ "reason": "malware" \| "broken" \| "inappropriate" \| "copyright" \| "other", "note"?: "<0–500 Zeichen, eine Zeile>" }` | `{ "reported": true }` |

- Nur sichtbare Addons (sonst 404). Keine ganze Zahl von 1 bis 5: 400. Eigene Addons bewerten: 403 „Eigene Addons kannst du nicht bewerten.“, melden: 400. Setzen und Löschen höchstens 30-mal pro Minute und Spieler (429); Abfragen zählen nur zur allgemeinen Grenze (120 pro Minute).
- **Meldungen:** Eine offene Meldung pro Spieler und Addon; weitere antworten genauso mit 200, ohne eine zweite anzulegen. Höchstens 10 Meldungen zu Addons in 24 Stunden je Spieler (429). Das Team bearbeitet sie im [Team-Bereich](#team-bereich); nach 90 Tagen werden sie gelöscht.

### Addons einreichen

Jeder angemeldete Spieler (Bearer-Token oder Cookie mit CSRF-Schutz) kann Addons einreichen, ab Version 1.6.1 auch solche, die direkt in Minecraft eingreifen (Zugriff `minecraft`); das Team prüft sie dann besonders auf die Eingriffe. Regeln: Eingriffe in Minecraft nur, wenn die Heldix-API nicht reicht; kein Schadcode; Netzwerk- und Dateizugriff nur, wenn die Beschreibung ihn nennt; nur eigener Code oder solcher, den man verbreiten darf. die Webseite führt durch die Schritte; die Webseite führt durch die Schritte. Ablauf: Entwurf anlegen → JAR hochladen (der Dienst prüft sie und übernimmt ID, Version, Name und Kurzbeschreibung) → Store-Angaben → Screenshots → zur Prüfung einreichen. Das Team prüft im [Team-Bereich](#team-bereich): Ablehnen mit Begründung (Moderator und Admin) oder Freigeben (nur Admin, signiert im Browser).

`Submission` = `{ "id": "<16 Zeichen>", "status": "draft" | "pending" | "approved" | "rejected" | "withdrawn", "addonId", "version", "name", "summary", "description", "category", "icon", "platforms", "notes", "authors", "api", "access": "api" | "minecraft" | null, "minecraft": ["<Version>"], "loaders": ["heldix" | "fabric"], "size", "sha256", "screenshots": <Anzahl>, "inspection": { "classes": <Zahl>, "uses": ["netzwerk" | "dateien" | "prozesse" | "reflection" | "nativ" | "minecraft"], "expected": ["minecraft"] } | null, "createdAt", "submittedAt", "reviewedAt", "reviewNote", "reviewer": "<Name>" | null }`. `addonId`, `version`, `api`, `access`, `minecraft`, `loaders`, `size`, `sha256`, `authors` und `inspection` kommen aus der JAR (vorher `null` bzw. leer). `reviewer` heißt für Spieler „HeldixClient-Team“, außer das Mitglied steht auf der öffentlichen Teamseite.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/addon-submissions` | – | `{ "submissions": [Submission], "addons": [Addon plus "hidden"] }`: eigene Einreichungen (neueste zuerst) und eigene veröffentlichte Addons (auch versteckte) |
| `POST /v1/addon-submissions` | Store-Angaben (alle freiwillig) | `{ "submission": Submission }` (Entwurf) |
| `PATCH /v1/addon-submissions/<sid>` | Store-Angaben (Teil davon) | `{ "submission": Submission }`; nur `draft` und `rejected` (sonst 409), `rejected` wird wieder `draft` |
| `PUT /v1/addon-submissions/<sid>/jar` | roher Inhalt der JAR (`application/octet-stream`, gestreamt, höchstens 50 MiB) | `{ "submission": Submission }` |
| `PUT /v1/addon-submissions/<sid>/screenshots/<n>` | rohes Bild (PNG oder JPEG, höchstens 2 MiB) | `{ "submission": Submission }` |
| `DELETE /v1/addon-submissions/<sid>/screenshots/<n>` | – | `{ "submission": Submission }`; die folgenden rücken auf |
| `GET /v1/addon-submissions/<sid>/screenshots/<n>` | – | das Bild (nur der Einreicher, `Cache-Control: private, no-store`) |
| `POST /v1/addon-submissions/<sid>/submit` | – | `{ "submission": Submission }` mit `status: "pending"` |
| `DELETE /v1/addon-submissions/<sid>` | – | `{ "deleted": true, "submission": null }` (nie eingereichter Entwurf, ganz gelöscht) oder `{ "deleted": false, "submission": Submission }` (zurückgezogen, `withdrawn`); freigegeben: 409 |

- **Store-Angaben:** `name` (0–40 Zeichen, eine Zeile), `summary` (0–200, eine Zeile), `description` (0–4000, Zeilenumbrüche erlaubt, `\r\n` wird zu `\n`), `category`, `icon`, `platforms`, `notes` (0–20 Texte, je 1–300) mit denselben Regeln wie im Manifest; Texte ohne Leerzeichen am Anfang und Ende; sonst 400 mit Hinweis. Neue Entwürfe: `category: "sonstiges"`, `icon: "addons"`. Körper höchstens 64 KB (sonst 413).
- **JAR-Prüfung** (ohne Bibliothek, nichts wird ausgeführt): Der Dienst liest das ZIP-Inhaltsverzeichnis selbst und lehnt mit 400 und Hinweis ab: kein gültiges ZIP, ZIP64, mehrere Teile, mehr als 20 000 Einträge, andere Kompression als „stored“ und „deflate“, verschlüsselte Einträge, doppelte Namen, Pfade mit `..`, absolute Pfade, Laufwerke oder Backslashes, überlappende Einträge, falsche Größen oder Prüfsummen, entpackt über 200 MiB (Zip-Bombe), eine Klassendatei über 16 MiB. In `heldix.addon.json` (höchstens 64 KB, höchstens 100:1 komprimiert) müssen stimmen: `id` (wie im Manifest), `version` (wie im Manifest), `api` (ganze Zahl 1–99), `name` (1–40), `description` (0–200, wird `summary`, wenn das Feld leer ist), `authors` (freiwillig, höchstens 5; ohne: der Spielername). Ein leerer `name` wird ebenfalls übernommen. Fehlt `heldix.addon.json`, ist aber eine `heldix.mod.json` da, sagt die Meldung, dass Heldix-Mods für den Store eine `heldix.addon.json` brauchen.
- **Einstiegspunkte und Zugriff** (`heldix.addon.json` Format 2, abwärtskompatibel): `entrypoint` (HeldixAddon, Heldix-API), `clientEntrypoint` (HeldixModInitializer, Heldix-Loader-API) und `transformers` (Liste mit höchstens 50 ClassTransformern; ein einzelner Text zählt als Liste mit einem Eintrag, Doppelte fallen weg) sind je freiwillig, mindestens eins muss da sein. Jeder Wert ist ein Klassenname (z. B. `dev.beispiel.MeinAddon`, höchstens 300 Zeichen), und jede genannte Klasse muss als `.class` in der JAR liegen (sonst 400). Der Zugriff ist abgeleitet: `minecraft`, sobald `clientEntrypoint` oder `transformers` da sind oder die JAR eine `heldix.mod.json` enthält, sonst `api`. `minecraft` (Text oder Liste, Doppelte fallen weg) hat höchstens 50 Einträge, jeder einzeln nach der Regel des Manifests (z. B. `["26.2", "26.3"]` oder `"26.x"`; Regeln wie `">=26.2"` oder `"26.2 || 26.3"` gehen im Store nicht); bei Zugriff `minecraft` Pflicht (400). `loader` (freiwillig, Mindestversion des Heldix Loaders, z. B. `">=2.4.0"`, 1–100 Zeichen) wird nur geprüft, nicht ins Manifest übernommen. `loaders` (freiwillig, nicht leere Liste aus `"heldix"` und `"fabric"` ohne Doppelte) sagt, wo das Addon läuft; ohne gilt `["heldix", "fabric"]` bei Zugriff `api` und `["heldix"]` bei Zugriff `minecraft`. Zugriff, `minecraft` (genau wie in der JAR) und `loaders` übernimmt der Dienst in die Einreichung und ins Manifest.
- **Hinweise für die Prüfung** (`inspection`): Anzahl der `.class`-Dateien und grobe Hinweise aus deren Konstanten (Bytes werden nur verglichen): `java/net/` → `netzwerk`, `java/io/File` oder `java/nio/file/` → `dateien`, `java/lang/ProcessBuilder` oder `java/lang/Runtime` → `prozesse`, `java/lang/reflect/` → `reflection`, `loadLibrary`, `java/lang/foreign` oder native Bibliotheken (`.dll`, `.so`, `.dylib`, `.jnilib`) in der JAR → `nativ`, `net/minecraft/` → `minecraft`. Bei Zugriff `minecraft` ist der Hinweis `minecraft` erwartet und steht zusätzlich in `expected` (die Webseite zeigt ihn dann nicht als Warnung); bei Zugriff `api` bleibt er ein Warnzeichen, ebenso alle übrigen Hinweise (Netzwerk, Dateien, Prozesse, nativ, Reflection) bei beiden Zugriffen. Ältere Einreichungen haben `expected: []`. Das sind Hinweise, keine Garantie: Das Team prüft selbst.
- **Besitz und Version:** Die ID aus der JAR muss frei sein oder schon dem Einreicher gehören (sonst 409, siehe [Besitz](#addon-store)), die Version muss höher sein als jede veröffentlichte dieses Addons (409). Eine neue JAR ersetzt die alte erst, wenn sie die Prüfung bestanden hat.
- **Screenshots:** PNG oder JPEG (erkannt am Dateikopf, nicht an der Endung), höchstens 2 MiB (sonst 413), Breite 320–3840 und Höhe 180–2160 Pixel, gelesen aus IHDR bzw. SOF (sonst 400). Höchstens 4, der Reihe nach: `<n>` ersetzt ein vorhandenes Bild oder hängt an (`<n>` = Anzahl + 1, sonst 400); `<n>` außerhalb 1–4: 404.
- **Einreichen:** braucht eine JAR (400 „Bitte zuerst die JAR hochladen.“) und eine Kurzbeschreibung (400); alle Angaben werden wie im Manifest geprüft (400 „Bitte noch korrigieren: …“). Nur Entwürfe (`rejected` erst ändern). Dabei erzeugt der Dienst das Manifest, das beim Freigeben signiert wird: alle Felder wie oben, `file` = `heldix-addon-<id>-<version>.jar`, `date` = Zeitpunkt des Einreichens (ISO 8601), `official: false`, `author` = Einreicher, dazu immer `access`, `minecraft` und `loaders` aus der JAR (Einreichungen mit einer JAR aus der Zeit vor Version 1.6.1: `api`, `[]`, `["heldix", "fabric"]`). Danach lässt sich nichts mehr ändern (409); zum Ändern zurückziehen und neu einreichen.
- **Grenzen:** höchstens 10 Entwürfe und 3 wartende Einreichungen je Spieler, für dasselbe Addon höchstens eine wartende (sonst 409). Uploads (JAR und Screenshots) höchstens 30 pro Stunde je Spieler (429), höchstens 4 gleichzeitig insgesamt (429 mit `Retry-After`). Je Einreichung läuft nur eine Aktion gleichzeitig (409).
- **Fremde Einreichungen** sehen aus wie unbekannte (404 „Diese Einreichung gibt es nicht.“).
- **Echtzeit:** Nach dem Freigeben oder Ablehnen bekommen alle WebSocket-Verbindungen des Einreichers `{ "type": "addon-review", "submission": "<sid>", "status": "approved" | "rejected", "addonId", "version", "note": "<Begründung>" | null }`.
- **Ablage:** JARs und Screenshots von Einreichungen liegen in `<Addon-Ordner>/einreichungen` (nicht öffentlich), veröffentlichte Screenshots in `<Addon-Ordner>/screenshots`. Beim Freigeben wandert die JAR als `heldix-addon-<id>-<version>.jar` in den Addon-Ordner. Dateien, die zu keiner Einreichung mehr gehören (gelöschtes Konto, Ablauf, abgebrochene Uploads), räumt der Dienst regelmäßig weg.

### Cosmetics-Katalog

Ab Version 1.6.0. Das Team veröffentlicht Cosmetics (Modell und Textur, signiert), Spieler wählen sie je Slot wie ein Cape, und alle HeldixClient-Spieler sehen sie beim [Nachschlagen](#spieler-nachschlagen-tab-liste-namensschilder-und-capes) ohne Installation. Slots: `head` (Hüte und Kopf), `back` (Flügel und Rücken), `aura` (Partikel), `companion` (Begleiter) und `cape` (Capes zusätzlich zu den eingebauten). Ein Cosmetic ist reine Daten, kein Code. Trotzdem ist jede Version mit dem **Update-Schlüssel** signiert, damit auch ein übernommenes Team-Konto nichts Fremdes an alle Spieler verteilen kann. Spiel, Launcher und Webseite prüfen die Signatur und dieselben Regeln selbst; Vorlage ist [service/src/cosmetics-format.ts](../service/src/cosmetics-format.ts) (eigenständig, ohne andere Module und ohne Node-Buffer, also auch im Browser lauffähig).

**Öffentlich** (ohne Anmeldung, `Access-Control-Allow-Origin: *`, auch bei Fehlern):

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/cosmetics` | `{ "cosmetics": [ { "id", "slot", "version", "name", "description", "access": "all" \| "team", "sha256", "size", "date" } ] }`: alle sichtbaren, nach Slot (head, back, aura, companion, cape), dann nach Name; `Cache-Control: public, max-age=60` und `ETag` (mit passendem `If-None-Match`: 304 ohne Körper) |
| `GET /v1/cosmetics/<id>` (auf Wunsch `?v=<sha256>`) | der Umschlag der aktuellen Version: `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }` mit `ETag: "<sha256>"` (passendes `If-None-Match`: 304). Ist `v` der aktuelle `sha256`: `Cache-Control: public, max-age=31536000, immutable`, sonst `public, no-cache`. Unbekannt oder ausgeblendet: 404 „Dieses Cosmetic gibt es nicht.“ Höchstens 300 pro Minute und IP, sonst 429 |

- `sha256` (Hex) und `size` (Byte) gelten genau für die Antwort von `GET /v1/cosmetics/<id>`: Der Dienst liefert den Umschlag immer als `{"manifest":…,"signature":…}` ohne Leerzeichen. Clients laden den Katalog, vergleichen `sha256` mit ihrem Zwischenspeicher und holen nur neue oder geänderte Umschläge, am besten mit `?v=<sha256>`. Auch Cosmetics mit `access: "team"` stehen im Katalog, damit alle sie an Team-Mitgliedern sehen.
- Vorschaubilder liefert der Dienst nicht; die Clients zeichnen sie selbst aus Modell und Textur.

**Wählen** (Bearer-Token oder Cookie mit CSRF-Schutz):

`MyCosmetics` = `{ "head", "back", "aura", "companion", "cape", "team" }`: je Slot die ID oder `null` (nichts); `team` (true/false) sagt, ob du Team-Cosmetics (`access: team`) wählen darfst – Launcher und Spiel kennen die Rolle sonst nicht.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/me/cosmetics` | – | `MyCosmetics`: was du gerade trägst |
| `PUT /v1/me/cosmetics` | `{ "slot": "head" \| "back" \| "aura" \| "companion" \| "cape", "id": "<id>" \| null }` | `MyCosmetics` |

- `id: null` (oder `""`) legt ab. Sonst muss es das Cosmetic geben und es muss sichtbar sein (sonst 404 „Dieses Cosmetic gibt es nicht.“), es muss zum Slot passen (sonst 400), und bei `access: "team"` musst du im Team sein (jede Rolle; sonst 403 „Dieses Cosmetic gibt es nur für das HeldixClient-Team.“). Unbekannter Slot, `id` fehlt oder ist weder Text noch `null`: 400. Es gilt die allgemeine Grenze (120 pro Minute).
- Der Slot `cape` ist dasselbe wie `cape` in `PUT /v1/me`: eingebaute Capes (`HELDIX_DIENST_CAPES`) und Katalog-Capes.
- **Gespeichert und sichtbar:** Gespeichert wird die gewählte ID je Slot. Ist ein Cosmetic ausgeblendet, oder nur fürs Team und du bist nicht mehr im Team, zeigen `GET /v1/me/cosmetics` und das Nachschlagen dort `null` (beim Cape `""` in `Me` und beim Nachschlagen). Die Auswahl bleibt aber gespeichert und gilt wieder, sobald das Cosmetic wieder sichtbar ist bzw. du wieder im Team bist. Löscht das Team ein Cosmetic, setzt der Dienst die Auswahl aller Träger zurück.

**Paket: signierter Umschlag.** `npm run cosmetic -- <id>` (im Ordner `launcher`) schreibt `<id>-<version>.cosmetic.json` = `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }`. Die Signatur ist Ed25519 über die UTF-8-Bytes von `"heldix-cosmetic\n" + manifest` (Domänentrennung: Ein Addon-Manifest oder ein Launcher-Update ist nie als Cosmetic gültig und umgekehrt). `signature` ist kanonisches Standard-Base64 von 64 Byte (88 Zeichen, endet auf `==`). Der Umschlag (so wie ausgeliefert) ist höchstens 192 KB groß, das Manifest höchstens 160 KB (UTF-8, ohne einzelne Ersatzzeichen); 1 KB = 1024 Byte.

**Manifest** (Format 1): ein JSON-Objekt, alle Felder Pflicht außer den freiwilligen. Format 1 kennt keine Zusatzfelder: Ein unbekanntes Feld, auch in Unterobjekten, ist ein Fehler. Texte gelten genau wie signiert (gezählt werden Unicode-Zeichen); nicht erlaubt sind Steuerzeichen (auch Zeilenumbrüche), Zeilen- und Absatztrenner und Steuerzeichen für die Schreibrichtung. „Zahl“ heißt jede JSON-Zahl, „ganze Zahl“ eine ohne Nachkommastellen; alle Bereiche schließen die Grenzen ein.

| Feld | Regel |
| --- | --- |
| `type` | genau `"heldix-cosmetic"` |
| `format` | genau `1` |
| `id` | `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$` (1–32 Zeichen, kein `-` am Anfang oder Ende), keine ID eines eingebauten Capes (`heldix`, `mitternacht`, `aurora`, `glut`, `kristall`, `neon`, `sakura`, `gewitter`, `galaxie`) |
| `version` | ganze Zahl 1–2147483647; beim Veröffentlichen höher als die vorhandene |
| `slot` | `head`, `back`, `aura`, `companion` oder `cape` |
| `name` | 1–40 Zeichen, eine Zeile, nicht nur Leerzeichen |
| `description` | 0–300 Zeichen, eine Zeile |
| `access` | `all` oder `team` (nur Team-Mitglieder dürfen es wählen) |
| `date` | Datum nach ISO 8601, z. B. `2026-11-26T12:00:00.000Z` |
| `texture` | PNG als `data:image/png;base64,<Base64>` (genau dieses Präfix, strenges Standard-Base64), dekodiert höchstens 64 KB; Größe siehe unten |
| `glow` (freiwillig) | Leuchtebene (ohne Licht gezeichnet), Regeln wie `texture`, genauso groß wie `texture` |
| `model` | Pflicht bei `head`, `back` und `companion`; bei `aura` und `cape` verboten |
| `animations` (freiwillig) | nur mit `model`, höchstens 16 |
| `particles` | Pflicht bei `aura`, sonst verboten |
| `cape` | `{ "frames": 1–32, "fps": 1–20 }` (ganze Zahlen); Pflicht bei `cape`, sonst verboten |
| `companion` | `{ "offset": [x, y, z], "scale": 0.25–1.5 }`: Platz in Blöcken relativ zum Spieler (x rechts, y hoch, z vorn, mit dem Rumpf gedreht), x und z von -2 bis 2, y von 0 bis 3; Pflicht bei `companion`, sonst verboten |

„Verboten“ heißt: Das Feld fehlt ganz (auch `null` zählt als vorhanden).

- **PNG:** Der Dienst dekodiert nichts, er prüft den Aufbau: PNG-Signatur, alle Abschnitte vollständig mit stimmender CRC, `IHDR` zuerst (Breite und Höhe ab 1, gültige Kombination aus Farbtyp und Bittiefe, Kompression und Filter 0, Interlace 0 oder 1), mindestens ein `IDAT`, `IEND` zuletzt (leer) und nichts danach. Breite und Höhe kommen aus `IHDR`.
- **Größe der Textur:** `head`, `back`, `companion` und `aura`: Breite und Höhe je 8–256 Pixel, jeweils ein Vielfaches von 8. Bei `aura` zusätzlich Breite = Höhe × `particles.frames` (quadratische Bilder nebeneinander). `cape`: 64, 128 oder 256 Pixel breit, jedes Einzelbild halb so hoch wie breit (Vorlage eines Minecraft-Capes, 64 × 32, in einfacher, doppelter oder vierfacher Auflösung), alle `cape.frames` Bilder untereinander; Höhe also Breite / 2 × `cape.frames` (z. B. 128 × 1536 bei 24 Bildern). Die Grenzen von 64 KB je PNG und 160 KB fürs Manifest gelten auch hier: Wer das Cape baut, wählt die Auflösung, die hineinpasst.
- **Modell** (`model`, Einheiten in Pixeln = 1/16 Block): `{ "textureSize": [Breite, Höhe], "bones": [Bone] }`; `textureSize` muss genau die Größe der Textur sein.
  - `Bone` = `{ "name", "parent" (freiwillig), "pivot": [x, y, z], "rotation" (freiwillig): [x, y, z], "cubes": [Würfel] }`: 1–32 Bones; `name` `^[a-z0-9_]{1,24}$` und eindeutig; `parent` ist der Name eines Bones, der **vorher** in der Liste steht (so gibt es keine Zyklen); `pivot` je -48 bis 48; `rotation` in Grad je -180 bis 180 (fehlt: 0, 0, 0). `cubes` darf leer sein (Bone nur als Gelenk).
  - `Würfel` = `{ "origin": [x, y, z], "size": [w, h, d], "uv": [u, v], "inflate" (freiwillig), "mirror" (freiwillig) }`: `origin` je -48 bis 48; jede Kante 0–32, mindestens eine größer als 0; `uv` ganze Zahlen ab 0; `inflate` 0–2 (fehlt: 0); `mirror` true oder false (fehlt: false). Der Würfel samt `inflate` liegt in jeder Achse in [-48, 48] (`origin − inflate ≥ −48` und `origin + size + inflate ≤ 48`, ohne Drehung gerechnet): So reicht das Modell höchstens 48 Pixel vom Anker.
  - **Box-UV** wie bei Minecraft und Blockbench („box UV“): Ein Würfel (w, h, d) belegt ab `uv` die Fläche (2d + 2w) × (d + h); sie muss in die Textur passen (`u + 2d + 2w ≤ Breite`, `v + d + h ≤ Höhe`). `mirror` spiegelt horizontal.
  - Insgesamt 1–128 Würfel.
  - Anker (Ursprung, +Y oben, +Z vorn = Blickrichtung, wie Blockbench für Entities): `head` Mitte der Kopf-Oberseite, `back` Mitte des Rückens auf Schulterhöhe (z = −2 ist die Rückenfläche), `companion` Mitte der Unterseite des Begleiters.
- **Animationen** (`animations`): je `{ "bone", "type", "axis", "amplitude", "speed", "phase" (freiwillig) }`. `bone` ist ein Bone des Modells; `type` ist `flap` (Sinus-Schwingung der Drehung, Flügel), `sway` (langsames Pendeln der Drehung), `spin` (dauerhafte Drehung, `speed` = Umdrehungen pro Sekunde, `amplitude` darf fehlen und zählt nicht) oder `bob` (Auf und Ab der Position); `axis` `x`, `y` oder `z`; `amplitude` 0–90 Grad, bei `bob` 0–8 Pixel; `speed` 0–4 Schwingungen pro Sekunde; `phase` 0–1 (fehlt: 0).
- **Partikel** (`particles`): `{ "frames": 1–8, "rate": 1–20, "lifetime": 5–80, "size": 0.03–0.4, "motion", "radius": 0.2–1.5, "color": "#rrggbb", "fullbright" (freiwillig) }`. `frames`, `rate` (pro Sekunde) und `lifetime` (Ticks) sind ganze Zahlen, `size` und `radius` Blöcke; `motion` ist `rise`, `fall`, `orbit`, `spark` oder `float`; `color` die Tönung (Hex, groß oder klein); `fullbright` true oder false (fehlt: false).
- **Fehler** nennen das Feld mit Pfad, z. B. „Ungültiges Cosmetic-Manifest: „model.bones[1].cubes[0].uv“: Die UV-Fläche (32 × 10 ab 40, 0) passt nicht in die Textur (64 × 32).“ Gemeldet wird der erste Fehler.

Die Routen für das Team (`/v1/team/cosmetics…`, nur Admins) stehen beim [Team-Bereich](#team-bereich), das Veröffentlichen unter [Cosmetic veröffentlichen](#cosmetic-veröffentlichen).

### Webseite: Anmeldung und Sitzungen

Kein Passwort auf der Webseite. Zwei Wege führen zum selben Einmal-Code: Der Launcher (oder das Heldix-Menü im Spiel) ist schon beim Dienst angemeldet, holt einen Einmal-Link und öffnet ihn im Browser. Oder der Spieler meldet sich auf der Webseite direkt mit seinem Minecraft-Konto bei Microsoft an (ab 1.7.0, siehe [unten](#webseite-anmeldung-mit-dem-minecraft-konto)).

| Anfrage | Anmeldung | Inhalt | Antwort |
| --- | --- | --- | --- |
| `POST /v1/web/link` | Bearer | – oder `{ "target": "profil" \| "freunde" \| "nachrichten" \| "privatsphaere" \| "daten" \| "support" \| "team" }` | `{ "url": "<Webseite>/konto#code=<code>", "expiresAt": <ms> }`, mit `target`: `…#code=<code>&ziel=<target>` |
| `POST /v1/web/session` | – | `{ "code": "…" }` | setzt das Cookie, Antwort `WebMe` |
| `GET /v1/web/config` | – | – | `{ "microsoftLogin": bool }`: ob es die Anmeldung mit dem Minecraft-Konto gibt (die Webseite zeigt nur dann den Knopf) |
| `GET /v1/web/auth/microsoft[?ziel=<ziel>]` | – | – | 303 zu Microsoft, setzt das Bindungs-Cookie; nicht eingerichtet: 503 (HTML-Seite) |
| `GET /v1/web/auth/microsoft/callback?code=…&state=…` | – | – | 303 zu `<Webseite>/konto#code=<code>[&ziel=<ziel>]` oder `<Webseite>/konto#fehler=<fehler>[&ziel=<ziel>]`; nicht eingerichtet: 503 |
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

### Webseite: Anmeldung mit dem Minecraft-Konto

Ab Version 1.7.0, wenn eingerichtet (siehe unten). Minecraft: Java Edition hängt an einem Microsoft-Konto: Der Spieler meldet sich bei Microsoft an, der Dienst holt über Xbox Live und die Minecraft-Dienste das Java-Profil und übernimmt davon nur **UUID und Namen**. Alles läuft auf dem Server (OAuth 2.0 Autorisierungscode mit PKCE); im Browser liegt nichts Geheimes. Es ist dieselbe App-Registrierung wie im Launcher: Nur deren App-ID hat Mojang für die Minecraft-Dienste freigegeben.

**Ablauf**

1. **Start** (`GET /api/v1/web/auth/microsoft?ziel=…` auf der Adresse der Webseite; der Knopf „Mit Minecraft-Konto anmelden“ auf `/konto` und `/team`): Der Dienst erzeugt `state` (32 Zufallsbytes) und einen PKCE-Verifier (32 Zufallsbytes), merkt sich beides mit dem Ziel **nur im Arbeitsspeicher** (10 Minuten, höchstens 10 000 offene Versuche) und setzt das **Bindungs-Cookie** `__Host-heldix_ms` (Zufallswert, `Path=/; Max-Age=600; HttpOnly; SameSite=Strict; Secure`; ein schon vorhandenes bleibt, damit zwei Tabs gehen). Dann 303 zu `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize` mit `client_id`, `redirect_uri`, `response_type=code`, `response_mode=query`, `scope=XboxLive.signin`, `code_challenge` (S256), `state` und `prompt=select_account`. Weil der Start über `/api` auf der Webseite läuft, gilt das Cookie für die Webseite; ein Start direkt auf der API-Adresse endet beim Einlösen mit „abgelaufen“.
2. **Rückkehr** (`GET /v1/web/auth/microsoft/callback` auf der API-Adresse = Umleitungs-URI): `state` wird genau einmal eingelöst, auch wenn Microsoft mit einem Fehler zurückkommt. Dann nacheinander:
   - `POST …/consumers/oauth2/v2.0/token` (`grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `scope`; mit `HELDIX_DIENST_MS_CLIENT_SECRET_FILE` zusätzlich `client_secret`, sonst öffentlicher Client nur mit PKCE)
   - `POST https://user.auth.xboxlive.com/user/authenticate` (`RpsTicket: d=<Microsoft-Token>`)
   - `POST https://xsts.auth.xboxlive.com/xsts/authorize` (`RelyingParty: rp://api.minecraftservices.com/`)
   - `POST https://api.minecraftservices.com/authentication/login_with_xbox` (`identityToken: XBL3.0 x=<uhs>;<XSTS-Token>`)
   - `GET https://api.minecraftservices.com/minecraft/profile` → `id` und `name`
3. **Konto:** Gesperrt: kein Konto, keine Sitzung (`fehler=gesperrt`). Sonst legt der Dienst den Spieler an bzw. aktualisiert Namen und letzte Verbindung, genau wie bei `POST /v1/auth/login`. Alle Tokens von Microsoft, Xbox Live und Minecraft sind dann verworfen: Sie waren nur lokale Variablen dieser Anfrage, stehen in keiner Datenbank, in keinem Log und in keinem Fehlertext (Antworten der Gegenseite werden höchstens 64 KB gelesen; was nicht passt, wird verworfen, ohne den Text zu zeigen). Kein Refresh-Token (`offline_access` wird nicht angefragt).
4. **Weiter zur Webseite:** 303 zu `<Webseite>/konto#code=<code>[&ziel=<ziel>]`. Der Code ist wie beim Einmal-Link (32 Zufallsbytes, 120 Sekunden, einmal), liegt aber nur im Arbeitsspeicher und ist an das Bindungs-Cookie gebunden. Die Webseite tauscht ihn wie gewohnt mit `POST /v1/web/session`; ohne passendes Bindungs-Cookie (anderer Browser, abgelaufen) 401 „Die Anmeldung ist abgelaufen oder wurde in einem anderen Browser begonnen. Bitte klicke noch einmal auf „Mit Minecraft-Konto anmelden“.“, und der Code ist verbraucht. Klappt es, entsteht **dieselbe Sitzung** wie beim Einmal-Link (gleiches Cookie, gleicher Gerätename, gleiche Grenzen, unter „Sicherheit“ in der Liste), und die Antwort löscht das Bindungs-Cookie (`Max-Age=0`).

- **Ziel:** `ziel` nur aus `uebersicht`, `profil`, `freunde`, `nachrichten`, `privatsphaere`, `sicherheit`, `daten`, `support`, `addons`, `team` (die Webseite öffnet den Bereich, bei `team` die Seite `/team`). Alles andere, auch Adressen, fällt still weg; dann geht es nach `/konto`. Der Dienst leitet nur auf die eigene Webseite (`HELDIX_DIENST_WEBSITE`) weiter.
- **Grenze:** Start und Rückkehr zählen zusammen höchstens 20 pro Minute und IP (hinter dem eigenen Proxy über `X-Forwarded-For` wie überall, `HELDIX_DIENST_TRUST_PROXY`); darüber `fehler=zu-viele` (beim Start mit `Retry-After`).
- **Antworten** von Start und Rückkehr: 303 ohne Körper, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
- **Log:** nur Probleme der Einrichtung oder der Gegenseite (z. B. „Microsoft lehnt den Code ab (HTTP 401, invalid_client, AADSTS7000218)“, „Invalid app registration“ einmal, „Minecraft antwortet mit HTTP 503“), ohne Spieler, IP, Codes oder Tokens. Was der Spieler selbst auslöst (Abbrechen, kein Minecraft), steht nicht im Log.

**Fehler** (`<Webseite>/konto#fehler=<code>`, das Ziel bleibt; die Texte zeigt die Webseite, `website/src/anmelden.js`):

| `fehler` | Wann | Text auf der Webseite (gekürzt) |
| --- | --- | --- |
| `abgebrochen` | Microsoft meldet `error=access_denied` (abgebrochen oder Zustimmung verweigert) | „Du hast die Anmeldung bei Microsoft abgebrochen …“ |
| `abgelaufen` | `state` unbekannt, schon benutzt, älter als 10 Minuten oder fehlt | „Die Anmeldung hat zu lange gedauert oder wurde schon benutzt …“ |
| `microsoft` | anderer Fehler von Microsoft, Code fehlt, Token-Tausch abgelehnt (z. B. `invalid_grant`, `invalid_client`) | „Microsoft hat die Anmeldung nicht bestätigt …“ |
| `kein-xbox` | XSTS `XErr` 2148916233: kein Xbox-Profil | „… noch kein Xbox-Profil. Melde dich einmal auf xbox.com an …“ |
| `xbox-land` | 2148916235: Xbox Live im Land nicht verfügbar | „Xbox Live ist in deinem Land nicht verfügbar …“ |
| `xbox-alter` | 2148916236, 2148916237: Altersnachweis nötig (Südkorea) | „Microsoft verlangt für dieses Konto eine Altersbestätigung …“ |
| `kinderkonto` | 2148916238: Konto eines Kindes ohne Microsoft-Familie | „… gehört zu einem Kind. Ein Erwachsener muss es erst zu seiner Microsoft-Familie hinzufügen …“ |
| `xbox-eltern` | 2148916229: Jugendschutz verbietet Online-Spiel | „Die Jugendschutz-Einstellungen … erlauben kein Online-Spiel …“ |
| `xbox-bedingungen` | 2148916234: Nutzungsbedingungen von Xbox nicht bestätigt | „… Nutzungsbedingungen von Xbox noch nicht bestätigt …“ |
| `xbox-gesperrt` | 2148916227: bei Xbox gesperrt | „Dieses Konto ist bei Xbox gesperrt …“ |
| `xbox` | anderer Fehler von Xbox Live oder XSTS | „Die Anmeldung bei Xbox Live hat nicht geklappt …“ |
| `kein-minecraft` | Profil 404: kein Minecraft: Java Edition (oder noch kein Spielername) | „Mit diesem Microsoft-Konto ist kein Minecraft: Java Edition verknüpft. Melde dich mit dem Konto an, mit dem du Minecraft spielst.“ |
| `minecraft` | `login_with_xbox` abgelehnt (z. B. 403 „Invalid app registration“: falsche App-ID) oder Profil unlesbar | „Die Minecraft-Dienste haben die Anmeldung abgelehnt …“ |
| `gesperrt` | UUID für den Heldix-Dienst gesperrt | „Dieses Konto ist für den Heldix-Dienst gesperrt.“ |
| `zu-viele` | eigene Grenze pro IP oder 429 von Microsoft, Xbox oder Minecraft | „Zu viele Anmeldeversuche …“ |
| `nicht-erreichbar` | keine Verbindung, Zeitüberschreitung (10 Sekunden je Anfrage) oder 5xx | „Microsoft oder die Minecraft-Dienste antworten gerade nicht …“ |
| `fehler` | unerwarteter Fehler im Dienst (nur die Art steht im Log) | allgemeiner Text |

Unbekannte Codes zeigt die Webseite als allgemeinen Text, nie den Code selbst.

**Einrichtung:** `HELDIX_DIENST_MS_CLIENT_ID` (App-ID), `HELDIX_DIENST_API_URL` (öffentliche Adresse der API, daraus die Umleitungs-URI `<HELDIX_DIENST_API_URL>/v1/web/auth/microsoft/callback`, nie aus Headern der Anfrage) und `HELDIX_DIENST_WEBSITE`; optional `HELDIX_DIENST_MS_CLIENT_SECRET_FILE`. Fehlt eins, ist die Anmeldung aus: `GET /v1/web/config` meldet `microsoftLogin: false`, Start und Rückkehr antworten mit 503 (kurze deutsche HTML-Seite mit Link zurück zum Konto). Beim Start steht im Log „Anmeldung mit dem Minecraft-Konto auf der Webseite: an (…, Umleitungs-URI …)“ bzw. „aus (…)“ mit dem Grund. Was in Azure einzutragen ist, steht in [docs/einrichtung.md](einrichtung.md#anmeldung-auf-der-webseite-mit-dem-minecraft-konto); der Installer richtet es mit `--minecraft-login` ein.

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
| Addon-Einreichungen ansehen (mit JAR und Screenshots) und ablehnen, Meldungen zu Addons | ja | ja |
| Addon-Einreichungen freigeben (signieren), Updates und offizielle Addons veröffentlichen, Addons ausblenden | – | ja |
| Cosmetics veröffentlichen, ausblenden und löschen | – | ja |
| Team-Mitglieder verwalten, Protokoll | – | ja |

**Routen** (Admin-Routen markiert)

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/team/me/profile` | – | `{ "public": bool, "title": "", "about": "" }` (eigenes Teamprofil, jede Rolle) |
| `PUT /v1/team/me/profile` | Teil davon | wie `GET` |
| `GET /v1/team/support?status=open\|answered\|closed\|all` | – | `{ "tickets": [Ticket ohne messages] }`, neueste Aktivität zuerst; ohne `status`: `open` |
| `GET /v1/team/support/<id>` | – | `{ "ticket": Ticket }` |
| `GET /v1/team/support/<id>/attachments/<aid>` | – | der Anhang als Datei (wie für den Spieler) |
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
| `GET /v1/team/updates` (admin) | – | `{ "current": <Manifest-Objekt> \| null, "files": [ { "file", "platform", "arch", "kind", "version", "size", "uploadedAt" } ] }`, alle Dateien, zuletzt hochgeladene zuerst |
| `PUT /v1/team/updates/files/<file>` (admin) | roher Inhalt (`application/octet-stream`, gestreamt, höchstens 1 GiB) | `{ "file", "size", "sha512": "<base64>" }` |
| `PUT /v1/team/updates/manifest` (admin) | Inhalt von `update.json` (`{ "manifest", "signature" }`) | `{ "current": <Manifest-Objekt> }` |
| `DELETE /v1/team/updates/files/<file>` (admin) | – | wie `GET /v1/team/updates` |
| `GET /v1/team/addons` (admin) | – | `{ "addons": [ { "id", "name", "hidden", "downloads", "latest": "<Version>", "versions": [ { "version", "file", "size", "sha256", "date", "notes", "api", "access", "minecraft", "loaders", "publishedAt", "publishedBy": "<Spielername>" } ], "official": bool, "owner": { "uuid", "name" } | null, "screenshots": <Anzahl>, "access", "minecraft", "loaders" } ], "pending": [ { "file", "size", "uploadedAt" } ], "keyConfigured": bool, "publicKey": "<PEM>" | null, "pendingSubmissions": <Anzahl>, "openReports": <Anzahl> }`, alle Addons (auch versteckte) nach Name, Versionen neueste zuerst. `owner`: Einreicher (`null` = offiziell; gelöschtes Konto: `{ "uuid": null, "name": "Gelöschter Spieler" }`); `publicKey`: der öffentliche Update-Schlüssel, damit die Seite eine gewählte Schlüsseldatei vor dem Signieren prüfen kann |
| `PUT /v1/team/addons/files/<file>` (admin) | roher Inhalt der JAR (`application/octet-stream`, gestreamt, höchstens 50 MiB) | `{ "file", "size", "sha256": "<hex>" }` |
| `DELETE /v1/team/addons/files/<file>` (admin) | – | wie `GET /v1/team/addons` |
| `PUT /v1/team/addons/manifest` (admin) | Inhalt der `.addon.json` (`{ "manifest", "signature" }`, höchstens 256 KB) | wie `GET /v1/team/addons` |
| `PATCH /v1/team/addons/<id>` (admin) | `{ "hidden": bool }` | wie `GET /v1/team/addons` |
| `DELETE /v1/team/addons/<id>/versions/<version>` (admin) | – | wie `GET /v1/team/addons` |
| `GET /v1/team/cosmetics` (admin) | – | `{ "cosmetics": [TeamCosmetic], "keyConfigured": bool, "publicKey": "<PEM>" \| null }`, alle Cosmetics (auch ausgeblendete) nach Slot, dann Name |
| `GET /v1/team/cosmetics/<id>` (admin) | – | `{ "cosmetic": TeamCosmetic, "manifest": "<Text>", "signature": "<Base64>" }` (auch ausgeblendete, z. B. für die Vorschau); unbekannt: 404 |
| `PUT /v1/team/cosmetics` (admin) | Inhalt der `.cosmetic.json` (`{ "manifest", "signature" }`, höchstens 192 KB) | wie `GET /v1/team/cosmetics` |
| `PATCH /v1/team/cosmetics/<id>` (admin) | `{ "hidden": bool }` | wie `GET /v1/team/cosmetics` |
| `DELETE /v1/team/cosmetics/<id>` (admin) | – | wie `GET /v1/team/cosmetics` |
| `GET /v1/team/addon-submissions?status=pending\|all` | – | `{ "submissions": [Submission plus "submitter": { "uuid", "name" }] }`; ohne `status`: `pending`, älteste zuerst; `all`: alle eingereichten (nie eingereichte Entwürfe nicht), zuletzt eingereichte zuerst |
| `GET /v1/team/addon-submissions/<sid>` | – | `{ "submission": Submission plus "submitter" und "manifest": "<Text>" \| null }`; `manifest` ist genau der Text, der beim Freigeben signiert wird |
| `GET /v1/team/addon-submissions/<sid>/jar` | – | die JAR als Anhang `heldix-addon-<id>-<version>.jar` (`Cache-Control: private, no-store`); nach Freigabe oder Zurückziehen: 404 |
| `GET /v1/team/addon-submissions/<sid>/screenshots/<n>` | – | das Bild |
| `POST /v1/team/addon-submissions/<sid>/approve` (admin) | `{ "signature": "<Base64>", "manifest"?: "<Text zur Kontrolle>" }` (höchstens 256 KB) | `{ "submission": … }` wie `GET`, `status: "approved"` |
| `POST /v1/team/addon-submissions/<sid>/reject` | `{ "note": "<1–1000 Zeichen, Zeilenumbrüche erlaubt>" }` | `{ "submission": … }` wie `GET`, `status: "rejected"` |
| `GET /v1/team/addon-reports?status=open\|done\|all` | – | `{ "reports": [AddonReport] }`, neueste zuerst; ohne `status`: `open` |
| `POST /v1/team/addon-reports/<id>/done` | – | `{ "report": AddonReport }` (schon erledigt: unverändert) |
| `GET /v1/team/members` (admin) | – | `{ "members": [ { "uuid", "name", "role", "addedAt", "addedBy": "<name>" \| null, "twoFactor": bool } ] }` |
| `POST /v1/team/members` (admin) | `{ "uuid" \| "name", "role" }` | wie `GET` |
| `PUT /v1/team/members/<uuid>` (admin) | `{ "role" }` | wie `GET` |
| `DELETE /v1/team/members/<uuid>` (admin) | – | wie `GET` |
| `POST /v1/team/members/<uuid>/reset-2fa` (admin) | – | wie `GET` |
| `GET /v1/team/audit?limit=<1–500, Standard 100>` (admin) | – | `{ "entries": [ { "id", "at", "actor": { "uuid", "name" }, "action", "target": "<Text>" \| null, "detail": "<Text>" \| null } ] }`, neueste zuerst |

`Report` = `{ "id", "at", "status": "open" | "done", "reason", "note", "reporter": { "uuid", "name" }, "reported": { "uuid", "name", "banned": bool }, "messages": [ { "from": "<uuid>", "fromName", "text", "at" } ], "doneAt": <ms> | null, "doneBy": "<name>" | null }`

`AddonReport` = `{ "id", "at", "status": "open" | "done", "reason", "note", "addon": { "id", "name", "exists": bool, "hidden": bool, "official": bool, "owner": { "uuid", "name" } | null }, "reporter": { "uuid", "name" }, "doneAt", "doneBy" }`

`TeamCosmetic` = `{ "id", "slot", "version", "name", "description", "access", "date", "sha256", "size", "hidden": bool, "wearers": <Anzahl>, "createdAt", "publishedAt", "publishedBy": "<Spielername>" | null }`. `wearers`: Spieler, die es gewählt haben (gespeichert, auch während es ausgeblendet ist); `createdAt`: erste Veröffentlichung, `publishedAt`: aktuelle Version.

`News` = `{ "id", "title", "text", "at", "updatedAt", "author": "<name>", "published": bool }`. `at` ist der Zeitpunkt der ersten Veröffentlichung, bei Entwürfen der Zeitpunkt der Erstellung.

Spieler (`GET /v1/team/players/<uuid>`) = `{ "uuid", "name", "cape", "visible", "presence", "showServer", "messages", "createdAt", "lastSeen", "online", "friends": <Anzahl>, "blocks": <Anzahl>, "reportsAbout": [<id>], "reportsBy": [<id>], "ban": Ban | null, "role" }` mit `Ban` wie in `GET /v1/team/bans`.

- **`null` bei `by`, `doneBy`, `addedBy`:** über die Server-Konsole (`heldix-dienst-admin`). Im Protokoll heißt der Handelnde dann `{ "uuid": null, "name": "CLI" }`.
- **Sperren** wirkt wie `heldix-dienst-admin sperren` und trennt offene WebSocket-Verbindungen des Spielers sofort (Code 4003 „Gesperrt“). Sich selbst sperren: 400. Team-Mitglieder lassen sich nicht sperren (409), zuerst aus dem Team entfernen. Spieler, die nie online waren, lassen sich per `uuid` sperren. Unbekannter Name: 404.
- **Spieler suchen:** ohne Groß-/Kleinschreibung nach Namensanfang, oder nach UUID (auch mit Bindestrichen); ohne `q` die zuletzt gesehenen. Gesperrte stehen mit drin: Ihr Konto ist gelöscht, deshalb `lastSeen: null` und in der Detailansicht `createdAt: null`, `lastSeen: null`, Schalter `false` und `ban` gesetzt. Etwas anderes als Name oder UUID: 400. `online` ist die echte Verbindung, unabhängig von `presence`.
- **Spieler löschen** wirkt wie dessen `DELETE /v1/me` (ohne Sperre): Verbindungen enden mit 4001.
- **Neuigkeiten:** Titel einzeilig, Text mit Zeilenumbrüchen (`\r\n` wird zu `\n`), sonst die Regeln für Nachrichten. Moderatoren dürfen alle Neuigkeiten bearbeiten. Der Autor bleibt der, der sie angelegt hat.
- **Updates veröffentlichen:** Hochladen streamt in `<file>.part` und benennt erst am Ende um. Erlaubt sind alle Namen wie beim Download, also auch die Mac-Dateien; sonst 400; über 1 GiB: 413; der Windows-Installer der veröffentlichten Version lässt sich weder ersetzen noch löschen (409). Mac-Dateien lassen sich immer löschen, auch die gerade über `latest/<ziel>` angebotene; dann zeigt `latest` auf die nächstältere. Beim Manifest prüft der Dienst die Ed25519-Signatur mit dem öffentlichen Update-Schlüssel (`HELDIX_DIENST_UPDATE_KEY`; ohne: 503) und dieselben Regeln wie der Launcher: Dateiname passt zur Version, Größe, `sha512` (400 bei falscher Signatur oder falschem Inhalt). Die Datei muss im Ordner liegen und Größe und SHA-512 müssen stimmen, und die Version muss höher sein als die veröffentlichte (Vorabversionen wie `1.2.0-beta.1` zählen weniger als `1.2.0`), sonst 409. Erst dann ersetzt der Dienst `update.json` atomar (neue Datei schreiben, dann umbenennen). So kann auch ein übernommenes Team-Konto kein fremdes Update ausliefern.
- **Addons veröffentlichen** (siehe [Addon-Store](#addon-store)): Hochladen streamt die JAR in `<file>.part` und benennt erst am Ende um. Der Name muss `heldix-addon-<id>-<version>.jar` sein (sonst 400), höchstens 50 MiB (sonst 413). Eine Datei, die zu einer veröffentlichten Version gehört, lässt sich weder ersetzen noch einzeln löschen (409); dafür die Version löschen. Hochgeladene JARs ohne veröffentlichtes Manifest stehen unter `pending`. Beim Manifest prüft der Dienst in dieser Reihenfolge: Update-Schlüssel eingerichtet (sonst 503), Form (`manifest` und `signature` als Text, Manifest höchstens 64 KB; sonst 400), Signatur über `"heldix-addon\n" + manifest` (sonst 400 „Die Signatur stimmt nicht.“), alle Felder (400 mit Hinweis, z. B. „Ungültiges Addon-Manifest: „name“ ist zu lang (höchstens 40 Zeichen).“), offiziell (`official: true` und `author: null`, sonst 400), Datei im Addon-Ordner (sonst 409 „Erst die JAR hochladen: …“) mit passender Größe und SHA-256 (sonst 400), die ID gehört keinem Spieler (sonst 409), Version höher als jede vorhandene dieses Addons (sonst 409). Ein neues Addon ist danach sofort sichtbar. `PATCH` mit `hidden` nimmt ein Addon aus dem Store oder zeigt es wieder (unbekannt: 404, kein Wahrheitswert: 400). Eine Version löschen löscht auch ihre Datei; war es die letzte, ist das Addon ganz weg (mit Zähler). Gleichzeitig läuft pro Datei nur eine Aktion (Hochladen, Veröffentlichen oder Löschen, sonst 409).
- **Einreichungen freigeben** (siehe [Addons einreichen](#addons-einreichen) und [Betrieb](#einreichung-eines-spielers-freigeben)): Der Dienst prüft in dieser Reihenfolge: Update-Schlüssel eingerichtet (sonst 503), Einreichung wartet (sonst 409), ein mitgeschicktes `manifest` ist genau das gespeicherte (sonst 400), Signatur über `"heldix-addon\n" + manifest` mit dem öffentlichen Update-Schlüssel (sonst 400 „Die Signatur stimmt nicht.“), ID frei oder schon im Besitz des Einreichers (sonst 409), Version höher (sonst 409), JAR unverändert (Größe und SHA-256). Dann veröffentlicht er wie beim Team-Upload: JAR in den Addon-Ordner, Addon mit dem Einreicher als Besitzer anlegen, Version eintragen, Screenshots übernehmen (sie ersetzen die bisherigen; ohne Screenshots bleiben die alten), Status `approved`, Echtzeit-Nachricht an den Einreicher. Schlägt etwas fehl, bleibt die Einreichung unverändert mit ihren Dateien. Den privaten Schlüssel sieht der Dienst nie.
- **Cosmetics veröffentlichen** (siehe [Cosmetics-Katalog](#cosmetics-katalog)): Der Dienst prüft in dieser Reihenfolge: Körper höchstens 192 KB (sonst 413), Update-Schlüssel eingerichtet (sonst 503), Form des Umschlags (`manifest` und `signature` als Text, Manifest höchstens 160 KB, Signatur als Base64 mit 88 Zeichen, Umschlag höchstens 192 KB; sonst 400 „Ungültiger Cosmetic-Umschlag: …“), Signatur über `"heldix-cosmetic\n" + manifest` (sonst 400 „Die Signatur stimmt nicht.“), JSON und alle Regeln des Formats (400 mit Hinweis, z. B. „Ungültiges Cosmetic-Manifest: „name“ ist zu lang (höchstens 40 Zeichen).“), die ID ist kein eingebautes Cape dieses Servers (`HELDIX_DIENST_CAPES`, sonst 409), bei einer vorhandenen ID derselbe Slot (sonst 409, der Slot lässt sich nicht ändern) und eine höhere Version (sonst 409). Gespeichert wird nur die aktuelle Version: Die neue ersetzt die alte, `hidden` bleibt, wie es war; ein neues Cosmetic ist sofort im Katalog. `PATCH` mit `hidden` blendet aus (Katalog, Umschlag und Wählen wie unbekannt, beim Nachschlagen `null`; die Auswahl der Träger bleibt gespeichert) bzw. zeigt wieder (unbekannt: 404, kein Wahrheitswert: 400). `DELETE` löscht das Cosmetic und setzt die Auswahl aller Träger in einer Transaktion zurück; die ID ist danach wieder frei. Den privaten Schlüssel sieht der Dienst nie.
- **Ablehnen:** nur wartende Einreichungen (sonst 409), Begründung 1–1000 Zeichen (sonst 400); der Einreicher sieht sie und kann überarbeiten. **Meldungen zu Addons:** Erledigt merkt sich Zeitpunkt und Namen; ein Addon nehmen Admins mit `PATCH /v1/team/addons/<id>` aus dem Store.
- **Mitglieder:** Aufnehmen nur, wer sich schon einmal angemeldet hat (sonst 404); ist er schon im Team, ändert `POST` die Rolle. Ungültige Rolle: 400. Mindestens ein Admin muss bleiben: Den letzten Admin herabstufen, entfernen oder als Spieler löschen ergibt 409 „Es muss mindestens ein Admin bleiben.“ (`DELETE /v1/me` des letzten Admins geht trotzdem; dann legt der Betreiber einen neuen an).
- **Protokoll:** Jede ändernde Team-Aktion landet im Protokoll; Einträge verfallen nach 365 Tagen. `action` ist eine von: `report.done`, `ban`, `unban`, `player.reset-cape`, `player.delete`, `news.create`, `news.update`, `news.delete`, `update.upload`, `update.publish`, `update.delete`, `addon.upload`, `addon.publish`, `addon.hide`, `addon.show`, `addon.delete` (Version oder unveröffentlichte Datei), `addon.approve` und `addon.reject` (Addon und Version, Detail: Einreichung und Einreicher), `addon-report.done`, `cosmetic.publish` (Cosmetic und Version, Detail: Slot und „neu“ oder die vorige Version), `cosmetic.hide`, `cosmetic.show`, `cosmetic.delete` (Cosmetic und Version, Detail: Slot und Zahl der zurückgesetzten Träger), `team.add`, `team.role`, `team.remove`, `team.reset-2fa`, `team.profile` (nur „öffentlich an“/„öffentlich aus“, ohne Texte), `support.reply`, `support.close`, `2fa.enable`. `target` ist z. B. „Name (uuid)“, „Meldung 12“, „Anfrage 7 (Name)“, „Neuigkeit 3: Titel“, „spotify 1.2.0“ (Addon und Version), „krone 2“ (Cosmetic und Version), eine Addon- oder Cosmetic-ID oder ein Dateiname.
- **Teamprofil:** `public` (Standard `false`: niemand erscheint ohne eigene Zustimmung), `title` (Aufgabe, 0–40 Zeichen, eine Zeile, z. B. „Entwicklung“), `about` (0–200 Zeichen, eine Zeile); sonst 400. Die Zustimmung lässt sich jederzeit zurücknehmen; wer das Team verlässt, verliert das Profil (bei neuer Aufnahme ist es wieder privat).

### Support-Anfragen

`Ticket` = `{ "id", "at", "updatedAt", "category": "hilfe" | "fehler" | "konto" | "sonstiges", "subject": "<1–100, eine Zeile>", "status": "open" | "answered" | "closed", "player": { "uuid", "name" }, "messages": [TicketMessage], "attachments": [ { "id", "name", "size": <Byte>, "at" } ], "unread": bool }`

`TicketMessage` = `{ "id", "at", "from": "player" | "team", "author": "<Name>", "text": "<1–2000, Zeilenumbrüche erlaubt>" }`

| Anfrage | Anmeldung | Inhalt | Antwort |
| --- | --- | --- | --- |
| `GET /v1/support` | Spieler (Bearer oder Cookie) | – | `{ "tickets": [Ticket ohne messages] }`, neueste Aktivität zuerst |
| `POST /v1/support` | Spieler | `{ "category", "subject", "text" }` | `{ "ticket": Ticket }` |
| `GET /v1/support/<id>` | Spieler (nur eigene, sonst 404) | – | `{ "ticket": Ticket }`, setzt `unread` zurück |
| `POST /v1/support/<id>/messages` | Spieler | `{ "text" }` | `{ "ticket": Ticket }` |
| `POST /v1/support/<id>/close` | Spieler | – | `{ "ticket": Ticket }` |
| `POST /v1/support/<id>/attachments?name=<datei>` | Spieler | roher Text (`Content-Type: text/plain; charset=utf-8`, höchstens 512 KiB) | `{ "ticket": Ticket }` |
| `GET /v1/support/<id>/attachments/<aid>` | Spieler (nur eigene Anfragen) | – | der Anhang als Datei |

Die Routen für das Team (`/v1/team/support…`, jede Rolle) stehen beim [Team-Bereich](#team-bereich).

- **Namen:** Für den Spieler heißt `author` bei Team-Antworten „HeldixClient-Team“, außer das Mitglied steht (gerade) auf der öffentlichen Teamseite; dann sein Name. Das Team sieht immer den echten Namen.
- **`unread`:** für den Spieler: Es gibt eine Team-Antwort nach seinem letzten Öffnen (`GET /v1/support/<id>`; eigenes Schreiben und Schließen zählen auch als gelesen). Für das Team: Die letzte Nachricht ist vom Spieler (wartet auf Antwort).
- **Status:** neue Anfrage und neue Nachricht des Spielers: `open`; Antwort des Teams: `answered`; Schließen (beide Seiten): `closed`. Auf geschlossene Anfragen kann niemand mehr antworten (409); erneutes Schließen ändert nichts.
- **Antwort des Teams:** Alle WebSocket-Verbindungen des Spielers bekommen `{ "type": "support", "id", "subject" }` (das Spiel blendet „Antwort vom HeldixClient-Team“ ein).
- **Prüfungen:** unbekannte Kategorie, Betreff nicht 1–100 Zeichen in einer Zeile, Text nicht 1–2000 Zeichen (Zeilenumbrüche erlaubt, sonst keine Steuerzeichen): 400. Fremde oder unbekannte Nummer: 404.
- **Grenzen:** höchstens 3 nicht geschlossene Anfragen pro Spieler (409 „Du hast schon 3 offene Anfragen. Schließ eine, bevor du eine neue schreibst.“), höchstens 5 neue in 24 Stunden (429) und 30 Nachrichten pro Stunde und Spieler, die erste einer neuen Anfrage eingerechnet (429). Bei 429 steht `Retry-After` dabei.
- **Anhänge:** Name aus A–Z, a–z, 0–9, `.`, `_` und `-` (1–80 Zeichen) mit der Endung `.txt` oder `.log` (sonst 400), `Content-Type: text/plain` (ohne oder mit `charset=utf-8`, sonst 415), 1 Byte bis 512 KiB (leer: 400, darüber: 413), gültiges UTF-8 ohne Nullbytes (sonst 400). Nur eigene Anfragen (sonst 404), die nicht geschlossen sind (409). Höchstens 5 Anhänge pro Anfrage (409) und 10 pro Spieler und Stunde (429 mit `Retry-After`). Ein Anhang zählt wie eine Nachricht des Spielers: Die Anfrage ist danach wieder `open`. Gespeichert wird er gzip-komprimiert in der Datenbank. Der Download kommt immer als `text/plain; charset=utf-8` mit `Content-Disposition: attachment; filename="<name>"`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` und `Cache-Control: private, no-store`, wird also nie als HTML ausgewertet; ein Anhang einer anderen Anfrage: 404.
- **Aufbewahrung:** geschlossene Anfragen 90 Tage nach dem Schließen, alle anderen 180 Tage nach der letzten Nachricht (Anhänge jeweils mit ihrer Anfrage). `DELETE /v1/me` und eine Sperre löschen die Anfragen des Spielers sofort. Löscht ein Team-Mitglied seine Daten, bleiben seine Antworten mit seinem Namen in den Anfragen anderer.

### Öffentliche Teamseite

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/public/team` | `{ "members": [ { "uuid", "name", "role", "title", "about", "since": <ms> } ] }`: nur Mitglieder mit `public: true`, Admins zuerst, dann nach Name; `Cache-Control: max-age=60` |
| `GET /v1/public/skins/<uuid>` | PNG des Minecraft-Skins (`image/png`, `Cache-Control: max-age=3600`); nur für Mitglieder mit `public: true`, sonst 404 |

- `since`: seit wann im Team. Das Teamprofil bearbeitet jedes Mitglied selbst (`/v1/team/me/profile`, siehe [Team-Bereich](#team-bereich)).
- **Skins:** Der Dienst fragt `<Session-Server>/session/minecraft/profile/<uuid>` (dieselbe Adresse wie bei der Anmeldung) und liest die Skin-Adresse aus der Eigenschaft `textures` (Base64-JSON). Erlaubt sind nur Skin-Dateien von `textures.minecraft.net`, geladen immer über HTTPS (Mojang nennt `http://`), ohne Weiterleitungen, mit Zeitgrenze, höchstens 256 KB und nur, wenn die Datei mit der PNG-Signatur beginnt. Der Dienst hält Skins 6 Stunden im Arbeitsspeicher (höchstens 100), fehlende 10 Minuten. Kein Skin oder ein Fehler: 404 (die Webseite zeigt dann Initialen). Für andere Spieler fragt der Dienst Mojang gar nicht erst; so ist er kein offener Proxy.

**Skins für Angemeldete:** `GET /v1/skins/<uuid>` (Bearer-Token oder Cookie; als GET ohne CSRF-Header) liefert denselben Skin (gleiche Prüfungen und derselbe Zwischenspeicher), mit `Cache-Control: private, max-age=3600` und ohne CORS.
- Erlaubt nur für: dich selbst, Freunde, Spieler mit offener Anfrage in eine der beiden Richtungen, Spieler, die du blockiert hast, und für Team-Mitglieder mit bestätigter Zwei-Faktor-Anmeldung (über das Cookie, jede Rolle) für alle Spieler, z. B. für die Köpfe bei Meldungen, Support, Spielern, Mitgliedern und im Protokoll.
- Alles andere und eine ungültige UUID: 404 „Kein Skin gefunden.“, ohne Mojang zu fragen. So verrät die Antwort keine Beziehungen, und der Dienst ist kein offener Proxy.
- Höchstens 300 pro Minute und Spieler (eigene Grenze statt der allgemeinen 120 pro Minute), sonst 429.

### Neuigkeiten (öffentlich)

`GET /v1/news?limit=<1–50, Standard 10>&before=<id>` ohne Anmeldung → `{ "news": [ { "id", "title", "text", "at", "author" } ], "more": bool }`, nur veröffentlichte, neueste zuerst, mit `Cache-Control: max-age=60`. Webseite (Startseite und Archiv) und Launcher zeigen sie. Der Text wird nie als HTML ausgewertet; Zeilenumbrüche werden zu Absätzen.
- **Archiv:** Mit `before` kommen die Neuigkeiten, die in dieser Reihenfolge nach der mit dieser ID stehen (älter); für die nächste Seite `before` auf die `id` der letzten setzen. `more`: Es gibt noch ältere. Aufrufe ohne `before` bleiben wie bisher.

### Status

`GET /v1/status` ohne Anmeldung → `{ "ok": true, "service": "<Version des Dienstes>", "online": <Spieler mit offener WebSocket-Verbindung>, "players": <angemeldete Spieler insgesamt>, "launcher": "<veröffentlichte Version>" | null, "addons": <sichtbare Addons im Store>, "cosmetics": <sichtbare Cosmetics im Katalog>, "since": <Start des Dienstes, ms> }`, `Cache-Control: max-age=30`.
- Nur Summen, keine Namen. `online` zählt jeden Spieler einmal, auch mit mehreren Verbindungen; eine Web-Sitzung zählt nicht. `players` zählt der Dienst höchstens alle 30 Sekunden neu. `launcher` ist die Version, die `/v1/launcher/latest` gerade ausliefert. `addons` zählt die Addons, die `/v1/addons` gerade zeigt, `cosmetics` (ab Version 1.6.0) die Cosmetics in `/v1/cosmetics`.

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
- `{ "type": "addon-review", "submission": "<sid>", "status": "approved" | "rejected", "addonId", "version", "note": "<Begründung>" | null }`, wenn das Team eine deiner Addon-Einreichungen freigegeben oder abgelehnt hat.

Ein Spieler ist online, solange mindestens eine Verbindung offen ist. Bei mehreren Verbindungen gilt der zuletzt gemeldete Status.

Der Dienst schließt Verbindungen mit Code 4000 („Zeitüberschreitung“), 4001 („Konto gelöscht“) und 4003 („Gesperrt“). Eine Sperre über `heldix-dienst-admin` bemerkt eine offene Verbindung beim nächsten `ping`.

### Schutz vor Missbrauch

- Anfragekörper sind höchstens 16 KB groß und müssen innerhalb von 15 Sekunden ankommen (sonst 408). Ausnahmen im Team-Bereich: Uploads der Installer bis 1 GiB und der Addons bis 50 MiB, abgebrochen erst, wenn 60 Sekunden lang nichts ankommt; das Addon-Manifest (`PUT /v1/team/addons/manifest`) und das Freigeben einer Einreichung bis 256 KB, der Umschlag eines Cosmetics (`PUT /v1/team/cosmetics`) bis 192 KB. Für Spieler: Addon-Einreichungen (`POST`/`PATCH`) bis 64 KB, JARs bis 50 MiB, Screenshots bis 2 MiB, Anhänge an Support-Anfragen bis 512 KiB.
- Anmeldung (`challenge`, `login`, `dev`): höchstens 20 Anfragen pro Minute und IP.
- Übrige Anfragen: höchstens 120 pro Minute und Token, sonst 429.
- Webseite: höchstens 10 Anmelde-Links pro Minute und Spieler, 20 Anfragen für die Anmeldung mit dem Minecraft-Konto (Start und Rückkehr zusammen) pro Minute und IP, 5 Versuche für den 2FA-Code pro 10 Minuten und Spieler, 5 Datenexporte pro Stunde und Spieler.
- Support: höchstens 3 offene Anfragen, 5 neue in 24 Stunden und 30 Nachrichten pro Stunde und Spieler; Anhänge höchstens 512 KiB, 5 pro Anfrage und 10 pro Stunde und Spieler.
- Skins für Angemeldete (`/v1/skins/<uuid>`): höchstens 300 pro Minute und Spieler; sie zählen nicht zur allgemeinen Grenze.
- Nachrichten: höchstens 20 pro Minute und Spieler. Meldungen: einmal pro Spieler und höchstens 10 in 24 Stunden. Blockierungen: höchstens 500. Downloads der Launcher-Installer: höchstens 30 pro Minute und IP, Downloads von Addons (`/v1/addons/<id>/files/…`) höchstens 60 pro Minute und IP, Screenshots höchstens 300 pro Minute und IP, Umschläge von Cosmetics (`/v1/cosmetics/<id>`) höchstens 300 pro Minute und IP.
- Addons von Spielern: höchstens 10 Entwürfe und 3 wartende Einreichungen je Spieler, 30 Uploads pro Stunde je Spieler, 4 Uploads gleichzeitig insgesamt (JARs werden höchstens zu zweit gleichzeitig geprüft). Bewertungen setzen oder löschen höchstens 30-mal pro Minute, Meldungen zu Addons höchstens 10 in 24 Stunden je Spieler.
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
- **API:** Caddy reicht alles an den Dienst weiter. Die Launcher-Installer unter `/v1/launcher/download/`, alles unter `/v1/addons/` (außer der Liste selbst, also auch Screenshots), die Uploads unter `/v1/team/updates/files/` und `/v1/team/addons/files/` und alles unter `/v1/addon-submissions/` und `/v1/team/addon-submissions/` (JARs und Screenshots von Einreichungen) gehen ohne Kompression durch (`Content-Length` und `Range` bleiben erhalten); Caddy streamt sie in beide Richtungen, ohne Grenze für den Anfragekörper und ohne Zeitgrenze.
- **Webseite und Dienst unter einer Adresse:** Auf der Webseite leitet Caddy `/api/*` ohne das `/api` an den Dienst weiter (Anmeldung, Spieler- und Team-Bereich mit dem Cookie der Webseite), ebenfalls ohne Kompression und ohne Grenze für Uploads. Der Dienst sieht die IP der Besucher wie bei der API über `X-Forwarded-For`. Der Installer setzt `HELDIX_DIENST_WEBSITE=https://<domain>` und `HELDIX_DIENST_API_URL=https://<api-domain>`.
- **Anmeldung mit dem Minecraft-Konto (optional):** Erst mit `--minecraft-login` (oder `--ms-client-secret-file`, `--ms-client-id`). Dann setzt der Installer `HELDIX_DIENST_MS_CLIENT_ID` auf die App-ID des Launchers (beim Bauen aus [launcher/src/main/config.ts](../launcher/src/main/config.ts) übernommen) und fragt nach dem Client-Geheimnis (Eingabe unsichtbar; leer = ohne Geheimnis, öffentlicher Client). Das Geheimnis legt er als `/etc/heldix-dienst/ms-client-secret` ab (Besitzer root, Gruppe des Dienstes, Rechte 640; nicht in `dienst.env`, die für alle lesbar ist) und setzt `HELDIX_DIENST_MS_CLIENT_SECRET_FILE`. Er zeigt das Geheimnis nie an. Bei Updates ohne diese Optionen bleibt alles, wie es ist; `--no-minecraft-login` schaltet aus und löscht das Geheimnis. Am Ende nennt er die Umleitungs-URI für Azure. Vorher in Azure einrichten: [docs/einrichtung.md](einrichtung.md#anmeldung-auf-der-webseite-mit-dem-minecraft-konto).
- **Update-Schlüssel:** `npm run installer` übernimmt den öffentlichen Schlüssel aus [launcher/src/main/update-public-key.ts](../launcher/src/main/update-public-key.ts). Der Installer legt ihn als `/etc/heldix-dienst/update-public-key.pem` ab und setzt `HELDIX_DIENST_UPDATE_KEY`. Ohne Schlüssel lassen sich Updates nur per `scp` veröffentlichen, Addons und Cosmetics gar nicht.
- **Daten:** Datenbank in `/var/lib/heldix-dienst`, Einstellungen in `/etc/heldix-dienst/dienst.env`. Eigene Einträge dort, z. B. `HELDIX_DIENST_CAPES`, bleiben bei Updates erhalten. Der Entwicklungsmodus wird auf dem Server immer ausgeschaltet.
- **Launcher-Updates:** Ordner `/var/lib/heldix-dienst/updates`. Er gehört dem Benutzer des Dienstes (Rechte 755): Der Dienst schreibt dort Uploads aus dem Team-Bereich, root lädt per `scp` hoch. Siehe [Launcher-Update veröffentlichen](#launcher-update-veröffentlichen).
- **Addon-Store:** Ordner `/var/lib/heldix-dienst/addons` (`HELDIX_DIENST_ADDONS`), ebenfalls dem Benutzer des Dienstes (Rechte 755). Die JARs liegen direkt darin; welche Versionen veröffentlicht sind, steht in der Datenbank. Darunter legt der Dienst `einreichungen` (ungeprüfte Uploads von Spielern, nie öffentlich) und `screenshots` an. Die Abschottung des Dienstes (`ReadWritePaths`) umfasst ihn, weil er im Datenordner liegt. Siehe [Addon veröffentlichen](#addon-veröffentlichen).
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
| `--minecraft-login` | Anmeldung mit dem Minecraft-Konto auf der Webseite einschalten (App-ID des Launchers); fragt nach dem Client-Geheimnis (leer = ohne). Braucht Webseite und API-Adresse |
| `--ms-client-secret-file <datei>` | Client-Geheimnis aus dieser Datei (erste Zeile) übernehmen, ohne Rückfrage; schaltet die Anmeldung ein. Die Datei danach löschen |
| `--ms-client-id <id>` | andere App-ID (nur für eigene Builds; muss die von Mojang freigegebene App-ID des Launchers sein); schaltet die Anmeldung ein |
| `--no-minecraft-login` | Anmeldung mit dem Minecraft-Konto ausschalten, gespeichertes Geheimnis löschen |
| `--uninstall` | Programme, Dienste und `heldix-dienst-admin` entfernen, Daten (auch die Launcher-Updates und Addons) bleiben; mit `--purge` auch Daten, Zertifikate und Benutzer |
| `--yes` | keine Rückfragen |

- **Update:** Den Installer einer neueren Version mit denselben Optionen noch einmal ausführen. Node.js und Caddy werden nur neu geladen, wenn es neue Versionen gibt. Für eine geänderte Webseite reicht dasselbe: `npm run installer`, dann den Installer erneut ausführen.
- **Log:** `journalctl -u heldix-dienst -f`, für HTTPS `journalctl -u heldix-dienst-caddy -f`.
- **Webseite ansehen ohne Server:** `node website/build.mjs` baut sie nach `website/dist`.

### Erster Admin und Team-Bereich

1. Der künftige Admin meldet sich einmal im Launcher oder im Spiel beim Dienst an (dann kennt ihn der Dienst), oder auf der Webseite mit „Mit Minecraft-Konto anmelden“, falls eingerichtet.
2. Auf dem Server: `sudo heldix-dienst-admin team <spielername> admin`.
3. Im Launcher „Auf heldixclient.com anmelden“ wählen; der Browser öffnet `https://<domain>/konto`. Oder auf `https://<domain>/team` „Mit Minecraft-Konto anmelden“.
4. Im Team-Bereich die Zwei-Faktor-Anmeldung einrichten: QR-Code (oder Geheimnis) in eine Authenticator-App übernehmen, Code eingeben.
5. Weitere Mitglieder nimmt der Admin im Team-Bereich auf. Verliert jemand sein Handy: `sudo heldix-dienst-admin team-2fa-reset <name>` (oder ein anderer Admin im Team-Bereich).

### Launcher-Update veröffentlichen

**Im Browser** (Admin im Team-Bereich): Installer hochladen, dann `update.json` hochladen. Der Dienst prüft Signatur, Größe, SHA-512 und Version und veröffentlicht erst dann.

**Mac-Dateien** (`HeldixClient-<version>-mac-arm64.dmg`/`.zip` und `-mac-x64.dmg`/`.zip`, z. B. aus dem Artefakt des Mac-Builds bei GitHub Actions herunterladen): im Team-Bereich hochladen oder per scp in denselben Ordner legen. Ein Manifest gibt es dafür nicht; die Download-Seite bietet sofort die höchste Version an:

```sh
scp HeldixClient-0.12.1-mac-arm64.dmg HeldixClient-0.12.1-mac-arm64.zip \
    HeldixClient-0.12.1-mac-x64.dmg HeldixClient-0.12.1-mac-x64.zip root@example.de:/var/lib/heldix-dienst/updates/
```

Per scp landet eine halb hochgeladene Datei kurz unter ihrem Namen im Ordner; zum Ausprobieren erst `HeldixClient-….dmg.part` hochladen und auf dem Server umbenennen (`mv`), oder den Team-Bereich nehmen (der benennt erst am Ende um). Alte Versionen können liegen bleiben oder im Team-Bereich gelöscht werden.

**Per scp:** Der Launcher-Build erzeugt den Installer `HeldixClient-Setup-<version>.exe` und die signierte `update.json`. Beide kommen in den Update-Ordner, **erst der Installer, `update.json` zuletzt** (scp kopiert in der angegebenen Reihenfolge):

```sh
scp HeldixClient-Setup-0.12.0.exe update.json root@example.de:/var/lib/heldix-dienst/updates/
```

- Ein Neustart ist nicht nötig: Ändert sich `update.json`, liest der Dienst sie beim nächsten Abruf neu. Im Log steht dann „Launcher-Version 0.12.0 ist veröffentlicht“, bei Fehlern der Grund.
- Solange der Installer fehlt oder noch nicht vollständig hochgeladen ist (Größe wie `size` im Manifest), meldet `/v1/launcher/latest` 404. Der Launcher sieht also nie eine Version, die er nicht laden kann.
- Die Dateien müssen für den Dienst lesbar sein (bei scp als root der Standard, Rechte 644). Alte Installer können liegen bleiben; ausgeliefert wird jede Datei mit passendem Namen, angeboten wird für Windows nur die aus `update.json`, für Mac die höchste Version.
- Ohne Installer (Docker, von Hand): Update-Ordner ist `HELDIX_DIENST_UPDATES`, Standard `<Datenordner>/updates`.

### Addon veröffentlichen

Addons gehen nur über den Team-Bereich (Admin mit Zwei-Faktor-Anmeldung) und nur mit Update-Schlüssel auf dem Server. Eine Befehlszeile auf dem Server gibt es dafür nicht.

1. **Bauen und signieren** (auf dem Entwicklungs-PC mit dem privaten Update-Schlüssel): im Ordner `launcher` `npm run addon -- <id>`, z. B. `npm run addon -- spotify`. Das erzeugt `heldix-addon-<id>-<version>.jar` und `heldix-addon-<id>-<version>.addon.json`. Die Version kommt aus dem Addon und muss höher sein als jede schon veröffentlichte.
2. **Hochladen:** Auf der Webseite unter Team-Bereich → **Addons** beide Dateien wählen. Die Seite lädt erst die JAR hoch, zeigt dann das Manifest (ID, Version, Datei, Größe und SHA-256 im Vergleich zur hochgeladenen Datei) und veröffentlicht per Knopf. Der Dienst prüft Signatur, Felder, Größe, SHA-256 und Version noch einmal selbst; erst dann steht das Addon im Store.
3. **Danach:** Im selben Reiter lässt sich ein Addon aus dem Store nehmen (Dateien bleiben, Launcher und Spiel bieten es nicht mehr an) oder eine Version löschen. Hochgeladene, aber nicht veröffentlichte JARs stehen dort ebenfalls und lassen sich löschen.

- Eine gelöschte Version nicht mit anderem Inhalt unter derselben Versionsnummer neu veröffentlichen, lieber eine höhere Version nehmen: Addon-Dateien dürfen ein Jahr im Cache bleiben (`immutable`).
- Die JAR kann auch per scp in den Addon-Ordner (`/var/lib/heldix-dienst/addons/`, erst als `….jar.part`, auf dem Server dann umbenennen); veröffentlicht wird sie trotzdem im Team-Bereich, dann nur mit der `.addon.json`. Die Datei muss für den Dienst lesbar sein (scp: Standard).
- Ohne Installer (Docker, von Hand): Addon-Ordner ist `HELDIX_DIENST_ADDONS`, Standard `<Datenordner>/addons`.
- Das Manifest offizieller Addons enthält `"official": true, "author": null` (schreibt `npm run addon`); ohne beides lehnt der Dienst den Team-Upload ab (400).

### Einreichung eines Spielers freigeben

Spieler reichen Addons auf der Webseite ein (Konto → „Meine Addons“). Das Team sieht sie im Team-Bereich unter **Addons → Einreichungen**, mit allen Angaben, Screenshots, den Hinweisen aus der JAR-Prüfung (`inspection`, z. B. „netzwerk“ oder „minecraft“) und der JAR zum Herunterladen.

1. **Prüfen:** JAR herunterladen und ansehen (z. B. mit einem Decompiler), Hinweise ernst nehmen. Eingriffe in Minecraft (Zugriff `minecraft`: `clientEntrypoint`, Transformer) sind erlaubt, wenn die Heldix-API nicht reicht: ansehen, ob sie nötig sind und nur tun, was die Beschreibung sagt; Netzwerk- und Dateizugriff nur, wenn die Beschreibung ihn nennt. Nichts davon auf dem eigenen Rechner einfach ausführen.
2. **Ablehnen** (Moderator oder Admin): mit Begründung; der Spieler bekommt sie sofort angezeigt und kann überarbeiten.
3. **Freigeben** (nur Admin mit Zwei-Faktor-Anmeldung): einmal die Schlüsseldatei wählen (`update-key.pem`, der private Update-Schlüssel im Format PKCS#8, derselbe wie für `npm run addon`). Die Seite liest sie nur in den Arbeitsspeicher des Browsers (nie hochgeladen, „Schlüssel vergessen“ löscht sie), prüft sie gegen `publicKey` aus `GET /v1/team/addons`, signiert mit WebCrypto (Ed25519) die UTF-8-Bytes von `"heldix-addon\n" + manifest` – genau den Text `manifest` aus `GET /v1/team/addon-submissions/<sid>` – und schickt nach einer Bestätigung nur die Signatur. Der Dienst prüft sie mit dem öffentlichen Schlüssel und veröffentlicht erst dann.

- Ohne Webseite geht dieselbe Signatur auch auf dem Entwicklungs-PC, z. B. mit Node.js: den Text `manifest` unverändert (ohne Zeilenumbruch am Ende) als `manifest.txt` speichern, dann `node -e "const c=require('crypto'),f=require('fs');console.log(c.sign(null,Buffer.from('heldix-addon\n'+f.readFileSync('manifest.txt','utf8'),'utf8'),c.createPrivateKey(f.readFileSync('update-key.pem'))).toString('base64'))"` und die Ausgabe als `signature` an `POST /v1/team/addon-submissions/<sid>/approve` schicken.
- Der private Schlüssel gehört nie auf den Server und nie in den Dienst; der Dienst kennt nur den öffentlichen (`HELDIX_DIENST_UPDATE_KEY`). Ohne ihn antwortet das Freigeben mit 503.
- Ein freigegebenes Addon gehört danach dem Spieler: Neue Versionen reicht er selbst ein, das Team prüft sie wieder. Aus dem Store nehmen und Versionen löschen geht wie bei offiziellen Addons.

### Cosmetic veröffentlichen

Cosmetics gehen nur über den Team-Bereich (Admin mit Zwei-Faktor-Anmeldung) und nur mit Update-Schlüssel auf dem Server. Dateien im Datenordner gibt es dafür nicht: Das signierte Manifest mit den Texturen steht in der Datenbank.

1. **Bauen und signieren** (auf dem Entwicklungs-PC mit dem privaten Update-Schlüssel): Quellen liegen in `cosmetics/<id>/` (`cosmetic.json`, `texture.png`, auf Wunsch `glow.png`). Im Ordner `launcher` `npm run cosmetic -- <id>` (ohne ID: alle) prüft alles nach den Regeln oben, setzt `date`, bettet die PNGs ein, signiert und schreibt `launcher/release/cosmetics/<id>-<version>.cosmetic.json`.
2. **Hochladen:** Auf der Webseite unter Team-Bereich → **Cosmetics** die `.cosmetic.json` wählen und veröffentlichen. Der Dienst prüft Signatur, alle Regeln und die Version noch einmal selbst; erst dann steht das Cosmetic im Katalog, und Spieler können es wählen.
3. **Danach:** Im selben Reiter lässt sich ein Cosmetic ausblenden (Träger sehen es nicht mehr, ihre Auswahl bleibt), wieder zeigen oder löschen (die Auswahl aller Träger wird zurückgesetzt). Die Übersicht zeigt, wie viele Spieler es tragen.

- Eine neue Version braucht eine höhere `version` und denselben Slot; für einen anderen Slot eine neue ID nehmen.
- Clients dürfen einen Umschlag unter `?v=<sha256>` ein Jahr im Cache behalten. Eine neue Version hat einen neuen `sha256`, die Clients sehen sie mit dem nächsten Katalog (Liste höchstens 60 Sekunden im Cache).
- Ohne Webseite: `PUT /v1/team/cosmetics` mit dem Inhalt der Datei als Körper (Cookie einer Admin-Sitzung mit bestätigter 2FA und `X-Heldix-Web: 1`).

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
  - `HELDIX_DIENST_ADDONS` (Ordner für die JARs des Addon-Stores, Standard `<Datenordner>/addons`; der Dienst schreibt dort Uploads aus dem Team-Bereich und legt die Unterordner `einreichungen` und `screenshots` an).
  - `HELDIX_DIENST_WEBSITE` (Adresse der Webseite, z. B. `https://heldixclient.com`, ohne Pfad): für die Anmelde-Links und den Schutz vor fremden Seiten. Ohne: keine Anmeldung auf der Webseite (`POST /v1/web/link` → 503).
  - `HELDIX_DIENST_UPDATE_KEY` (Datei mit dem öffentlichen Update-Schlüssel, PEM, Ed25519). Ohne oder unlesbar: Der Dienst startet mit einer Warnung, Veröffentlichen von Updates, Addons und Cosmetics im Team-Bereich antwortet mit 503.
  - `HELDIX_DIENST_API_URL` (öffentliche Adresse der API, z. B. `https://api.heldixclient.com`, ohne Pfad): Daraus entsteht die Umleitungs-URI der Anmeldung mit dem Minecraft-Konto. Allein ändert sie nichts.
  - `HELDIX_DIENST_MS_CLIENT_ID` (Anwendungs-ID der Azure-App, dieselbe wie `MICROSOFT_CLIENT_ID` im Launcher): Anmeldung mit dem Minecraft-Konto auf der Webseite. Es gibt keinen Standardwert im Dienst (der Installer nimmt die des Launchers). Ungültig (keine GUID): Der Dienst startet nicht. Ohne, oder ohne `HELDIX_DIENST_WEBSITE`/`HELDIX_DIENST_API_URL`: aus.
  - `HELDIX_DIENST_MS_CLIENT_SECRET_FILE` (freiwillig, Datei mit dem Client-Geheimnis, eine Zeile): Mit ihr ist der Dienst ein vertraulicher Client (Plattform „Web“ in Azure), ohne ein öffentlicher Client nur mit PKCE. Den Inhalt schreibt der Dienst nie ins Log. Angegeben, aber unlesbar oder leer: Warnung, die Anmeldung mit dem Minecraft-Konto bleibt aus. Die Datei sollte nur für root und den Dienst lesbar sein.
  - Nur für Tests, nur mit `HELDIX_DIENST_DEV=1` (sonst mit Warnung ignoriert): `HELDIX_DIENST_MS_LOGIN_URL`, `HELDIX_DIENST_XBOX_USER_URL`, `HELDIX_DIENST_XSTS_URL`, `HELDIX_DIENST_MINECRAFT_URL` stellen Microsoft, Xbox Live und die Minecraft-Dienste auf eigene (nachgebaute) Server um.
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

  `proxy_buffering off` reicht die Launcher-Installer (über 100 MB) direkt durch, statt sie erst zwischenzuspeichern; Kompression dort nicht einschalten. Für `/v1/addons/` (JARs bis 50 MiB, mit Range, und Screenshots) gilt dasselbe, für `/v1/addon-submissions/` (Uploads von Spielern bis 50 MiB) zusätzlich `client_max_body_size 60m` und `proxy_request_buffering off`. Die Webseite fragt auf ihrer eigenen Adresse `/dienst-status` und `/launcher-latest` ab: Beide an den Dienst weiterleiten, auf `/health` bzw. `/v1/launcher/latest`. Dazu `/api/` ohne das Präfix (im `server`-Block der Webseite):

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
- **Überwachung:** `GET /health` antwortet mit `{ "ok": true }` (nutzt auch der Docker-Healthcheck). Ohne Anmeldung, ohne Daten. `GET /v1/status` zeigt dazu Version, Start, Spieler online und insgesamt, die veröffentlichte Launcher-Version und die Zahl der Addons im Store und der Cosmetics im Katalog.
- **Verbindungen nach außen:** Außer zu Mojang für die Anmeldung (`sessionserver.mojang.com`) verbindet sich der Dienst nur für Skins (Teamseite und `/v1/skins`: `sessionserver.mojang.com`, `textures.minecraft.net`) und, wenn eingerichtet, für die Anmeldung mit dem Minecraft-Konto auf der Webseite (`login.microsoftonline.com`, `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com`, `api.minecraftservices.com`), jeweils HTTPS.
- **Adresse im Client:** In [launcher/src/main/config.ts](../launcher/src/main/config.ts) bei `HELDIX_SERVICE_URL` eintragen (oder beim Bauen die Umgebungsvariable `HELDIX_SERVICE_URL` setzen). Der Launcher gibt sie dem Spiel als `-Dheldixclient.service=<url>` mit.
