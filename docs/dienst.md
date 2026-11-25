# Heldix-Dienst: Capes für alle, Heldix-Symbol und Freunde

Der Heldix-Dienst ist ein kleiner Server (Ordner [service/](../service)). Er verbindet HeldixClient-Spieler untereinander:

- **Capes für alle sichtbar:** Andere HeldixClient-Spieler sehen dein Heldix-Cape. Eigene Bilder bleiben auf deinem PC, damit keine fremden Bilder über den Dienst laufen.
- **Heldix-Symbol:** In der Tab-Liste steht das Heldix-Logo vor dem Namen von HeldixClient-Spielern.
- **Freunde:** Freundesliste mit Anfragen und Online-Status. Auf Wunsch zeigt sie, auf welchem Server ein Freund gerade spielt.

Ohne eingetragene Adresse des Dienstes sind diese Funktionen aus; der Rest von HeldixClient läuft wie gewohnt.

## Datenschutz

- **Gespeichert werden:** Minecraft-UUID, Spielername, gewähltes Heldix-Cape, die Einstellungen unten, Freundschaften und offene Anfragen, Zeitpunkt der letzten Verbindung.
- **Nicht gespeichert werden:** Passwörter und Microsoft- oder Minecraft-Tokens. Die Anmeldung beim Dienst läuft wie der Beitritt zu einem Minecraft-Server über Mojang; der Dienst sieht dabei kein Token.
- **Online-Status und Server** sehen nur bestätigte Freunde. Server-Adressen werden nur weitergegeben, wenn sie öffentliche Domains sind (keine IP-Adressen, kein `localhost`, keine Heimnetz-Namen).
- **Erkennbar sein** (Heldix-Symbol und Cape für andere): Nur wer online ist und die Einstellung an hat, wird bei einer Abfrage als HeldixClient-Spieler gemeldet.
- **Einstellungen im Heldix-Menü:** „Für andere erkennbar“, „Online-Status für Freunde“, „Server für Freunde sichtbar“.
- **Daten löschen:** Im Heldix-Menü unter Freunde → Privatsphäre löscht „Daten beim Dienst löschen“ alles, was der Dienst über dich gespeichert hat.

## Schnittstelle (Version 1)

Alle Anfragen und Antworten sind JSON (UTF-8). UUIDs sind immer klein geschrieben und ohne Bindestriche (32 Hex-Zeichen). Fehler antworten mit einem passenden HTTP-Status und `{ "error": "<deutscher Text für den Spieler>" }`.

### Anmeldung

Wie bei einem Minecraft-Server: Der Dienst gibt eine zufällige `serverId` aus. Der Client meldet bei Mojang „Ich trete Server `serverId` bei“ (`sessionserver.mojang.com/session/minecraft/join`, mit seinem Token). Der Dienst fragt danach bei Mojang nach, ob das stimmt (`hasJoined`). So weiß er sicher, wem die UUID gehört, ohne das Token zu sehen.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `POST /v1/auth/challenge` | – | `{ "serverId": "<40 Hex-Zeichen>" }`, gültig 60 Sekunden, nur einmal verwendbar |
| `POST /v1/auth/login` | `{ "name": "<Spielername>", "serverId": "…" }` | `{ "token": "…", "uuid": "…", "name": "…", "expiresAt": <ms> }` |

- `login` fragt `GET <Session-Server>/session/minecraft/hasJoined?username=<name>&serverId=<serverId>` ab. Antwortet Mojang mit 200 und `{ "id", "name" }`, ist der Spieler angemeldet. Sonst kommt 401 mit `{ "error": "Anmeldung bei Mojang fehlgeschlagen." }`.
- Das Token gilt 7 Tage. Der Dienst speichert nur seinen SHA-256-Hash. Alle weiteren Anfragen schicken `Authorization: Bearer <token>`. Ohne gültiges Token antworten sie mit 401, der Client meldet sich dann neu an.
- **Entwicklungsmodus** (nur für automatische Tests): Mit `HELDIX_DIENST_DEV=1` gibt es zusätzlich `POST /v1/auth/dev` mit `{ "name", "uuid" }`. Diesen Weg nimmt der Dienst nur von `127.0.0.1` oder `::1` an, und er schreibt beim Start eine deutliche Warnung ins Log. Ohne die Variable antwortet dieser Weg mit 404.

### Eigenes Profil

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/me` | – | `Me` |
| `PUT /v1/me` | Teil von `{ "cape": "<id>" \| "", "visible": bool, "presence": bool, "showServer": bool }` | `Me` |
| `DELETE /v1/me` | – | `{ "deleted": true }` |

`Me` = `{ "uuid", "name", "cape", "visible", "presence", "showServer" }`. Die Standardwerte sind `cape: ""` und alle drei Schalter `true`.

- `visible`: Für andere als HeldixClient-Spieler erkennbar (Symbol und Cape).
- `presence`: Freunde sehen den Online-Status.
- `showServer`: Freunde sehen den Server.
- `cape` muss eine der eingebauten IDs sein: `heldix`, `mitternacht`, `aurora`, `glut`, `kristall`, `neon`, `sakura`, `gewitter`, `galaxie`. Die Liste lässt sich mit der Umgebungsvariable `HELDIX_DIENST_CAPES` (durch Kommas getrennt) ersetzen. `""` heißt: kein Cape.
- `DELETE /v1/me` löscht den Spieler mit allen Tokens, Freundschaften und Anfragen (in beide Richtungen). Seine offenen WebSocket-Verbindungen schließt der Dienst mit Code 4001 („Konto gelöscht“). Frühere Freunde und Spieler mit offenen Anfragen bekommen, falls verbunden, sofort eine neue `friends`-Nachricht ohne ihn. Danach gilt das alte Token nicht mehr (401). Meldet sich derselbe Spieler später wieder an, legt der Dienst ihn neu mit den Standardwerten an.

### Spieler nachschlagen (Tab-Liste und Capes)

`POST /v1/players/lookup` mit `{ "uuids": ["…", …] }` (höchstens 200) → `{ "players": { "<uuid>": { "cape": "<id>" | "" } } }`

Die Antwort enthält nur Spieler, die gerade verbunden sind (offene WebSocket-Verbindung) und `visible` an haben. Der Anfragende selbst gehört dazu, wenn das zutrifft.

### Freunde

`Friend` = `{ "uuid", "name", "online": bool, "state": "menu" | "singleplayer" | "multiplayer" | "realms" | "lan" | null, "server": "<domain>" | null, "since": <ms> }`
- Hat der Freund `presence` aus, ist `online` immer `false` und `state` und `server` sind `null`.
- `server` steht nur da, wenn er `showServer` an hat und `state` `multiplayer` ist.

`Request` = `{ "uuid", "name", "at": <ms> }`

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/friends` | `{ "friends": [Friend], "incoming": [Request], "outgoing": [Request] }` |
| `POST /v1/friends/requests` mit `{ "name": "<Spielername>" }` | wie `GET /v1/friends` |
| `POST /v1/friends/requests/<uuid>/accept` | wie `GET /v1/friends` |
| `DELETE /v1/friends/requests/<uuid>` | wie `GET /v1/friends` (ablehnen oder eigene Anfrage zurückziehen) |
| `DELETE /v1/friends/<uuid>` | wie `GET /v1/friends` |

Regeln für Anfragen:
- **Name nicht gefunden:** Gesucht wird ohne Groß-/Kleinschreibung unter Spielern, die sich schon einmal angemeldet haben. Gibt es keinen Treffer: 404 „Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).“
- **Sonderfälle:** Für sich selbst gibt es 400. Für einen Spieler, der schon Freund ist, gibt es 409. Liegt schon eine Anfrage in die Gegenrichtung vor, werden beide sofort Freunde.
- **Grenzen:** Höchstens 200 Freunde und 50 offene ausgehende Anfragen, sonst 409.

### Echtzeit (WebSocket)

`GET /v1/ws` mit `Authorization: Bearer <token>`. Nachrichten sind JSON-Texte.

Client → Dienst:
- `{ "type": "status", "state": "menu" | "singleplayer" | "multiplayer" | "realms" | "lan", "server": "<domain>" | null }`. Den `server` prüft der Dienst: nur Domains wie `hypixel.net`, keine IP-Adressen, kein `localhost`, keine Namen ohne Punkt, höchstens 253 Zeichen. Bei ungültigem Wert wird er zu `null`.
- `{ "type": "ping" }` etwa alle 30 Sekunden. Antwort: `{ "type": "pong" }`. Ohne Nachricht für 90 Sekunden schließt der Dienst die Verbindung.

Dienst → Client:
- `{ "type": "friends", "friends": […], "incoming": […], "outgoing": […] }` direkt nach dem Verbinden und nach jeder Änderung an Freunden oder Anfragen, auch durch die andere Seite.
- `{ "type": "friend", "friend": Friend }`, wenn ein Freund online oder offline geht oder seinen Status ändert.
- `{ "type": "request", "from": { "uuid", "name" } }` bei einer neuen eingehenden Anfrage. Danach folgt eine `friends`-Nachricht.
- `{ "type": "accepted", "friend": Friend }`, wenn jemand die eigene Anfrage angenommen hat. Danach folgt eine `friends`-Nachricht.

Ein Spieler ist online, solange mindestens eine Verbindung offen ist. Bei mehreren Verbindungen gilt der zuletzt gemeldete Status.

### Schutz vor Missbrauch

- Anfragekörper sind höchstens 16 KB groß.
- Anmeldung (`challenge`, `login`, `dev`): höchstens 20 Anfragen pro Minute und IP.
- Übrige Anfragen: höchstens 120 pro Minute und Token, sonst 429.
- Hinter einem Reverse-Proxy zählt `X-Forwarded-For` nur mit `HELDIX_DIENST_TRUST_PROXY=1`.

## Betrieb

- **Umgebungsvariablen:**
  - `PORT` (Standard 8787) und `HELDIX_DIENST_DATA` (Ordner für die Datenbank, Standard `./data`).
  - `HOST` (Standard: alle Netzwerkschnittstellen; mit `127.0.0.1` nur von diesem Rechner erreichbar).
  - `HELDIX_DIENST_SESSION_SERVER` (Standard `https://sessionserver.mojang.com`, für Tests umstellbar).
  - Dazu die oben genannten `HELDIX_DIENST_DEV`, `HELDIX_DIENST_CAPES` und `HELDIX_DIENST_TRUST_PROXY`.
- **Speicher:** SQLite über `node:sqlite` (Node 24), ohne native Pakete. Die Datenbank ist die Datei `heldix-dienst.db` im Datenordner. Zum Sichern den Ordner kopieren, während der Dienst nicht läuft.
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
  location / {
      proxy_pass http://127.0.0.1:8787;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
  ```
- **Überwachung:** `GET /health` antwortet mit `{ "ok": true }` (nutzt auch der Docker-Healthcheck). Ohne Anmeldung, ohne Daten.
- **Adresse im Client:** In [launcher/src/main/config.ts](../launcher/src/main/config.ts) bei `HELDIX_SERVICE_URL` eintragen (oder beim Bauen die Umgebungsvariable `HELDIX_SERVICE_URL` setzen). Der Launcher gibt sie dem Spiel als `-Dheldixclient.service=<url>` mit.
