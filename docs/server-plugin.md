# Server-Plugin „HeldixClient Server“

Mit dem Paper-Plugin **HeldixClient Server** (ab HeldixClient 0.14.1) spricht ein Server direkt mit den HeldixClient-Spielern:

- **Server-Regeln:** Funktionen von HeldixClient auf dem Server abschalten (z. B. Freelook, Zoom, Minimap, Koordinaten). Der Spieler sieht beim Versuch „Auf diesem Server deaktiviert“.
- **HUD-Elemente:** eigene Anzeigen (Text, Fortschritt, Liste) im HUD-Stil von HeldixClient, auf Wunsch anklickbar.
- **Einblendungen:** kurze Hinweise oben rechts im Heldix-Stil.
- **Mit Partner-Schlüssel** (Partner-Programm von HeldixClient): **Voice-Gruppen** für den Voice Chat von HeldixClient (z. B. je Team einer Runde) und **Belohnungs-Cosmetics**, die das Team für den Partner freigegeben hat.

Spieler ohne HeldixClient merken nichts davon. Das Plugin braucht kein Fabric, keine Mod auf dem Server und keinen Proxy-Teil.

Quellcode: [mod/heldix-server](../mod/heldix-server). Gegenstück im Client: [dev.heldixclient.serverlink](../mod/src/main/java/dev/heldixclient/serverlink).

## Herunterladen

- **Webseite:** auf [/partner](https://heldixclient.com/partner) und [/entwickler/server-plugin](https://heldixclient.com/entwickler/server-plugin) mit Version, Größe und SHA-256-Prüfsumme; die Datei selbst liegt unter `/downloads/HeldixClient-Server-<version>.jar` (z. B. `/downloads/HeldixClient-Server-1.0.0.jar`).
- **Wie sie auf die Webseite kommt:** `website/build.mjs` (auch über den Dienst-Installer `service/installer/build.mjs`) nimmt die neueste `HeldixClient-Server-<x.y.z>.jar` aus `mod/heldix-server/build/libs/` – die `-sources.jar` nie – und kopiert sie nach `<Webseite>/downloads/`. Ihre Version muss zu `version` in `mod/heldix-server/build.gradle` passen (`heldix_server_version` in `mod/gradle.properties`); „für Paper …“ kommt aus `minecraft_version`. Fehlt die Datei oder passt die Version nicht, gibt der Bau eine Warnung aus, kopiert nichts und die Seiten zeigen weiter „kommt bald“. Vor dem Bau der Webseite bzw. des Installers also erst das Plugin bauen (siehe [Bauen und testen](#bauen-und-testen)). Zum Ausprobieren mit einem anderen Ordner: `HELDIX_SERVER_PLUGIN_LIBS=<ordner>`.
- **Eigene Builds:** aus dem Quellcode in `mod/heldix-server` mit `.\gradlew :heldix-server:build` (Ergebnis in `mod/heldix-server/build/libs/`). Die `-sources.jar` daneben brauchst du nur zum Entwickeln gegen die Schnittstelle, nicht auf dem Server.

## Einrichtung

1. **Paper 26.3** (dieselbe Minecraft-Version wie HeldixClient). Andere Bukkit-Server werden nicht geprüft.
2. `HeldixClient-Server-1.0.0.jar` in den Ordner `plugins/` legen und den Server neu starten.
3. Das Plugin legt `plugins/HeldixClient-Server/config.yml` an. Eintragen, was gebraucht wird (siehe unten), dann `/heldix reload`.
4. `/heldix status` zeigt Version, Partner, Regeln und die HeldixClient-Spieler, die gerade online sind (mit Version und Sprache).
5. Test: `/heldix test-hud <Spieler>` schickt einem HeldixClient-Spieler für 15 Sekunden drei Beispiel-Elemente (Text oben rechts – anklickbar –, Fortschritt oben in der Mitte, Liste rechts) und eine Einblendung.

Partner-Server werden in HeldixClient (Serverliste, Pausemenü), im Launcher und auf der Webseite mit dem Abzeichen **„Partner“** hervorgehoben. Ob ein Server Partner ist, entscheidet allein die öffentliche Partnerliste des Heldix-Dienstes (`GET /v1/public/partners`, Adresse passt) – nicht das Plugin.

## config.yml

```yaml
# Partner-Schlüssel (hxp_ und 40 Zeichen) aus dem Partner-Programm. Leer = ohne Partner-Funktionen.
partner-key: ""
# Name, den HeldixClient-Spieler für diesen Server sehen (≤ 40 Zeichen). Leer = Text der MOTD.
server-name: ""
# Adresse, unter der Spieler den Server betreten – nur für Voice-Gruppen. Leer = erste Adresse des Partners beim Dienst.
server-address: ""
rules:
  # Funktionen von HeldixClient, die auf diesem Server aus sind, z. B. [freelook, minimap, coordinates]
  disable: []
# Heldix-Dienst (nur ändern, wenn das Team es sagt)
api-url: "https://api.heldixclient.com"
```

| Schlüssel | Bedeutung |
| --- | --- |
| `partner-key` | Schlüssel aus dem Team-Bereich (wird beim Erzeugen nur einmal gezeigt). Beim Start und nach `/heldix reload` prüft das Plugin ihn mit `GET /v1/partner/me` (im Hintergrund) und schreibt Partner und Server ins Log. Ungültig, pausiert oder leer → Regeln, HUD und Einblendungen gehen weiter, Voice-Gruppen und Belohnungen nicht. **Nie öffentlich zeigen.** |
| `server-name` | Anzeigename im `welcome` (HeldixClient zeigt ihn z. B. als Absender von Einblendungen). |
| `server-address` | Die Adresse, mit der die Spieler verbinden (bei Proxys die öffentliche Adresse des Proxys), z. B. `play.example.net`. Muss zu den Servern des Partner-Eintrags passen (eine Domain deckt ihre Subdomains ab). |
| `rules.disable` | Global abgeschaltete Funktionen, siehe [Regel-Schlüssel](#regel-schlüssel). Klein, `[a-z0-9_.-]{1,32}`, höchstens 64; ungültige werden mit Warnung ignoriert. |
| `api-url` | Basis des Heldix-Dienstes, ohne `/` am Ende. |

## Befehl /heldix

Recht `heldix.admin` (ab Werk nur Operatoren), auch aus der Konsole.

| Befehl | Was er macht |
| --- | --- |
| `/heldix status` | Version, Dienst, Partner (Name, Server) bzw. warum nicht, Voice-Gruppen (Anzahl, letztes Senden), Regeln, HeldixClient-Spieler online |
| `/heldix reload` | `config.yml` neu lesen, Regeln und `welcome` an alle HeldixClient-Spieler, Schlüssel neu prüfen (wenn geändert) |
| `/heldix test-hud <Spieler>` | Beispiel-HUD und Einblendung für 15 Sekunden |

## Schnittstelle für andere Plugins

Das Plugin meldet `dev.heldixclient.server.api.HeldixServer` beim **ServicesManager** von Bukkit an. Zum Kompilieren das Jar als `compileOnly` einbinden (die Quellen liegen als `HeldixClient-Server-1.0.0-sources.jar` daneben), in der `plugin.yml` `softdepend: [HeldixClient-Server]` (oder `depend`) eintragen:

```groovy
dependencies {
    compileOnly files('libs/HeldixClient-Server-1.0.0.jar')
}
```

Alle Methoden im **Hauptthread** aufrufen. Aufrufe an den Heldix-Dienst laufen immer im Hintergrund; ihre Ergebnisse (`CompletableFuture`) kommen im Hauptthread zurück und scheitern nie mit einer Ausnahme.

```java
HeldixServer heldix = HeldixServer.get();                    // null, wenn das Plugin fehlt
if (heldix == null) return;

heldix.isHeldix(player);                                      // spielt mit HeldixClient (hat hello geschickt)?
heldix.clientVersion(player);                                 // Optional<String>, z. B. "0.14.1"
heldix.client(player);                                        // Optional<HeldixClientInfo>: version, api (11), language ("de"/"en")
heldix.heldixPlayers();                                       // alle HeldixClient-Spieler online
```

**HUD-Elemente** (höchstens 8 je Spieler, gleiche ID ersetzt; auch vor dem `hello` setzbar – sie gehen raus, sobald sich HeldixClient meldet; gelten bis zum Verlassen des Servers):

```java
HeldixHud hud = heldix.hud(player);
hud.set(HudElement.ofText("runde").anchor(HudAnchor.TOP_RIGHT).title("Runde 2").text("Noch 3 Minuten").clickable(true));
hud.set(HudElement.ofProgress("tore").anchor(HudAnchor.TOP).title("Rot gegen Blau").text("3 : 2").value(0.6).color(0x22C55E));
hud.set(HudElement.ofList("team").anchor(HudAnchor.RIGHT).title("Team Rot").lines(List.of("Alex", "Steve")));
hud.remove("tore");
hud.clear();
```

Stellen (`HudAnchor`): `TOP_LEFT`, `TOP` (unter den Bossleisten), `TOP_RIGHT`, `LEFT`, `RIGHT`, `BOTTOM_LEFT`, `BOTTOM_RIGHT` – unten in der Mitte liegt die Hotbar. Mehrere Elemente an derselben Stelle stehen untereinander. Grenzen: ID `[a-z0-9_-]{1,24}`, Titel ≤ 40, Text ≤ 120 (bis drei Zeilen umbrochen), Liste ≤ 10 Zeilen zu je ≤ 80 Zeichen, Wert 0 bis 1, Farbe RGB (Titel und Balken; ohne = Akzentfarbe des Spielers). §-Codes und Steuerzeichen werden entfernt.

**Einblendungen** (höchstens eine je 5 Sekunden und Spieler, sonst `false`):

```java
heldix.toast(player, "Event", "Die Schatzsuche beginnt in einer Minute!");
```

**Regeln** global oder je Spieler (eigene Regeln ersetzen die globalen, bis `reset` oder bis zum Verlassen):

```java
heldix.rules().setGlobal(List.of("freelook", "minimap"));    // nicht in config.yml gespeichert
heldix.rules().set(player, List.of("freelook", "minimap", "coordinates", "waypoints"));  // z. B. während einer Runde
heldix.rules().reset(player);
heldix.rules().of(player);                                    // was für ihn gilt
```

**Voice-Gruppen** (nur mit Partner-Schlüssel):

```java
HeldixVoiceGroups voice = heldix.voiceGroups();
if (voice.available()) {
    voice.set(player, "rot");                                 // [a-z0-9_-]{1,24}
    voice.remove(player);
    voice.clear();                                            // alle (auch beim Dienst)
    voice.sync().thenAccept(ok -> getLogger().info("Voice-Gruppen gesendet: " + ok));
}
```

Ein Spieler mit Server-Gruppe hört in der Nähe nur Spieler derselben Gruppe; seine Gruppe im Voice Chat ist die Server-Gruppe (jede Entfernung, nur auf diesem Server), seine eigene Gruppe bzw. die Party-Gruppe ist so lange aus. Spieler ohne Server-Gruppe hören nur Spieler ohne Server-Gruppe. Das Plugin schickt Änderungen gesammelt nach einer halben Sekunde und alle 2 Minuten den ganzen Stand (der Dienst vergisst Gruppen nach 10 Minuten ohne Erneuerung). Verlässt ein Spieler den Server, fällt seine Gruppe weg; beim Abschalten des Plugins werden alle geleert. Das Voice-Chat-Addon (ab 1.4.0) zeigt die Server-Gruppe und meldet Eintritt und Austritt.

**Belohnungen** (nur mit Partner-Schlüssel, nur Cosmetics mit `access: "partner"` für diesen Partner, höchstens 600 je Stunde):

```java
heldix.rewards().grant(player, "sieger-krone").thenAccept(result -> {
    if (result.granted()) player.sendMessage(result.already() ? "Du hast die Krone schon." : "Neu: die Sieger-Krone!");
    else getLogger().warning("Belohnung nicht vergeben: " + result.error());
});
```

**Ereignisse** (Bukkit, Hauptthread):

```java
@EventHandler
public void onHeldix(HeldixPlayerJoinEvent event) {          // einmal je Betreten, nach dem hello
    HeldixClientInfo client = event.client();
    heldix.toast(event.getPlayer(), "Willkommen", "Schön, dass du mit HeldixClient " + client.version() + " da bist.");
}

@EventHandler
public void onClick(HeldixHudClickEvent event) {             // Klick auf ein Element mit clickable(true), ≤ 4 je Sekunde
    if (event.elementId().equals("runde")) event.getPlayer().performCommand("runde info");
}
```

## Kanalprotokoll

Plugin-Messaging-Kanal **`heldixclient:server`**. Jede Nachricht ist ein UTF-8-JSON-Objekt, höchstens **32 KiB**, mit `t` (Typ) und `v` (Protokollversion, jetzt **1**). Unbekannte Typen und Felder werden auf beiden Seiten ignoriert; kaputte oder zu große Nachrichten verworfen. Neue Versionen bleiben abwärtskompatibel (neue Felder bzw. neue Typen statt geänderter Bedeutung).

**Ablauf:** Bei jedem Betreten eines Servers (jedes `ClientboundLoginPacket`, also auch nach einem Serverwechsel hinter einem Proxy) vergisst HeldixClient alles vom vorigen Server. Im nächsten Tick meldet er den Kanal mit **`minecraft:register`** an (Inhalt `heldixclient:server`; ohne diese Anmeldung stellt Paper Plugin-Nachrichten nicht zu) und schickt `hello`. Das Plugin antwortet mit `welcome` und `rules` und schickt danach die HUD-Elemente, die es für den Spieler schon hat. Ein weiteres `hello` (z. B. nach einem Sprachwechsel) beantwortet es genauso.

Client → Server:

| Typ | Felder | Bedeutung |
| --- | --- | --- |
| `hello` | `client: "HeldixClient"`, `version: "0.14.1"`, `api: 11`, `lang: "de"`/`"en"` | Der Spieler hat HeldixClient. Kommt nach dem Beitritt und erneut, wenn sich die Sprache ändert. |
| `hud_click` | `id` | Klick auf ein Element mit `clickable: true` (bei offenem Chat oder mit „HUD bedienen“; Client höchstens alle 250 ms, Plugin höchstens 4 je Sekunde). |

Server → Client:

| Typ | Felder | Bedeutung |
| --- | --- | --- |
| `welcome` | `server` (Anzeigename, ≤ 40), `partner` (Partner-ID oder `null`) | Der Server spricht Heldix. `partner` ist nur ein Hinweis. |
| `rules` | `disable: [Schlüssel…]` | Diese Funktionen sind auf dem Server aus. Gilt bis zum Verlassen oder bis zur nächsten `rules`-Nachricht (leere Liste = alles erlaubt). |
| `hud_set` | `id` (`[a-z0-9_-]{1,24}`), `type` (`text`/`progress`/`list`), `anchor` (`top_left`, `top`, `top_right`, `left`, `right`, `bottom_left`, `bottom_right`), `title?` (≤ 40), `text?` (≤ 120), `lines?` (≤ 10 × ≤ 80), `value?` (0..1), `color?` (`#rrggbb`), `clickable?` | Element setzen bzw. ersetzen, höchstens 8 je Server (weitere werden verworfen). Texte ohne §-Codes. |
| `hud_remove` | `id` | Element entfernen |
| `hud_clear` | – | alle Elemente entfernen |
| `toast` | `title` (≤ 40), `text` (≤ 120) | Einblendung im Heldix-Stil, höchstens eine je 5 Sekunden (sonst verworfen) |

Beispiel: `{"t":"hud_set","v":1,"id":"runde","type":"progress","anchor":"top","title":"Runde 2","text":"Noch 3 Minuten","value":0.4,"color":"#22c55e"}`

Der Spieler kann **Server-HUD** und **Server-Einblendungen** in HeldixClient unter Einstellungen → HUD ausschalten.

## Regel-Schlüssel

| Schlüssel | Was HeldixClient 0.14.1 auf dem Server tut |
| --- | --- |
| `freelook` | Freelook-Taste wirkt nicht (Hinweis) |
| `zoom` | Zoom-Taste wirkt nicht (Hinweis) |
| `minimap` | Minimap-Addon ausgeblendet (auch ältere Versionen; ab 1.1.0 über `followServerRule`), Karte im Menü „Auf diesem Server deaktiviert“ |
| `worldmap` | für Karten-Addons (`api.server().allowed("worldmap")`); sind `minimap` **und** `worldmap` aus, liefert `api.worldMap()` keine Welt von oben mehr |
| `waypoints` | keine Wegpunkt-Markierungen, Wegpunkt setzen geht nicht (Hinweis), kein Todespunkt; `api.waypoints()` leer; Minimap ohne Wegpunkte |
| `coordinates` | HUD-Element Koordinaten ausgeblendet, Pausemenü zeigt keine Position, Minimap ohne Koordinaten |
| `fullbright` | für Addons, die Helligkeit verändern (HeldixClient selbst hat keine Fullbright-Funktion) |
| `togglesprint` | Dauersprint/Dauerschleichen aus – Sprint- und Schleichtaste wirken wie bei Minecraft |

Weitere Schlüssel (`[a-z0-9_.-]{1,32}`) sind erlaubt: HeldixClient ignoriert sie, Addons können sie mit `api.server().allowed("…")` abfragen bzw. ein Modul mit `followServerRule("…")` daran binden (Addon-API 11, siehe [addons.md](addons.md)). Die Einstellung des Spielers bleibt bei einer Sperre erhalten; nach dem Verlassen des Servers ist alles wieder an. Kommt eine Regel, die ein eingeschaltetes Modul sperrt, erklärt eine Einblendung einmal „Auf diesem Server deaktiviert: …“. Die F3-Anzeige von Minecraft bleibt unberührt (dafür gibt es die Gamerule `reducedDebugInfo`).

## Partner-Funktionen beim Heldix-Dienst

Das Plugin meldet sich mit `Authorization: Partner <key>` an (eigene Grenze je Schlüssel; pausierter Partner → 403). Alle Aufrufe laufen im Hintergrund.

| Route | Wofür |
| --- | --- |
| `GET /v1/partner/me` | Schlüssel prüfen → `{ id, name, servers, cosmetics }` |
| `PUT /v1/partner/voice/groups` | `{ server, groups: { "<uuid32>": "<gruppe>" \| null } }`, ≤ 500 Einträge je Anfrage (größere Stände in Paketen) |
| `DELETE /v1/partner/voice/groups?server=…` | alle Gruppen dieses Servers leeren |
| `POST /v1/partner/rewards` | `{ uuid: "<uuid32>", cosmetic }` → `{ granted, already }` |

Fehler kommen vom Dienst als deutscher Satz (`{ error, code? }`); das Plugin gibt sie in `RewardResult.error()`, im Log bzw. in `/heldix status` weiter.

## Proxys (Velocity, BungeeCord)

Auf dem Proxy ist nichts nötig. Das Plugin gehört auf **jeden Backend-Server** (Paper), auf dem es wirken soll, jeweils mit eigener `config.yml` (eigene Regeln je Modus). Velocity und BungeeCord reichen Plugin-Nachrichten auf `heldixclient:server` in beide Richtungen durch und geben die Anmeldung des Kanals (`minecraft:register`) an den neuen Server weiter. Beim Wechsel des Backend-Servers schickt der Proxy ein neues `ClientboundLoginPacket`; HeldixClient vergisst dann Regeln und HUD des alten Servers und sagt dem neuen erneut `hello`. Für Voice-Gruppen in `server-address` die **öffentliche Adresse des Proxys** eintragen – mit ihr verbinden die Spieler, und mit ihr meldet HeldixClient den Raum im Voice Chat.

## Technik im Client

- Seit Minecraft 1.20.5 verwirft der Client unbekannte Custom-Payloads schon beim Lesen (`DiscardedPayload`). HeldixClient greift dafür in `DiscardedPayload.codec(Identifier, int)` ein ([ServerLinkPatches](../mod/src/main/java/dev/heldixclient/transform/ServerLinkPatches.java)): Für `heldixclient:server` (lesen und schreiben) und `minecraft:register` (schreiben) kommt ein eigener Codec ([ServerPayload](../mod/src/main/java/dev/heldixclient/serverlink/ServerPayload.java)), alle anderen Kanäle bleiben wie bei Minecraft. `ClientPacketListener.handleCustomPayload` gibt Nachrichten des Kanals im Hauptthread an [ServerLink](../mod/src/main/java/dev/heldixclient/serverlink/ServerLink.java). Vor dem ersten Senden prüft der Client selbst, ob der Eingriff wirkt; sonst sendet er nichts (ein Fehler beim Schreiben würde die Verbindung trennen).
- In Fabric-Instanzen braucht das den **Heldix Loader 2.5.0** (`DiscardedPayload` steht in `Targets`/`TransformTargets`). Ist **Fabric API** geladen, meldet HeldixClient den Kanal dort an (Payload-Typ in beide Richtungen und Empfänger, per Reflexion) – Fabric API kennt `minecraft:register` selbst und schickt die Anmeldung dann mit ([FabricNetworking](../mod/src/main/java/dev/heldixclient/serverlink/FabricNetworking.java)).
- `gradlew checkTransforms` (läuft mit jedem `build`) prüft beide Eingriffe mit dem ASM-Verifier an der echten Minecraft-JAR.

## Bauen und testen

```powershell
cd mod
.\gradlew :heldix-server:build     # Ergebnis: mod/heldix-server/build/libs/HeldixClient-Server-1.0.0.jar (+ -sources.jar)
```

Version in `mod/gradle.properties` (`heldix_server_version`), Paper-API `io.papermc.paper:paper-api:<minecraft_version>.build.<paper_api_build>` von `repo.papermc.io`. Kompiliert wird Java-21-Bytecode.

Spieltest im echten Spiel: `ServerLinkTests` im Autotest – ohne Server (Codec, Nachrichten, Regeln, HUD, Partnerliste) läuft er immer mit; mit echtem Paper-Server samt Plugin, wenn `HELDIX_AUTOTEST_PAPER` (Pfad zu einem Paper-26.3-Jar) und `HELDIX_AUTOTEST_PLUGIN` (Pfad zum Plugin-Jar) gesetzt sind. Nur diesen Teil: `$env:HELDIX_AUTOTEST_ONLY='server'`. Der Test startet Paper im Spielordner unter `heldix-autotest-paper/` (offline-mode, eigener Port, EULA nur für diesen lokalen Testserver) und beendet ihn am Ende.
