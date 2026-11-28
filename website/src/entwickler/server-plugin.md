---
titel: Server-Plugin „HeldixClient Server“
beschreibung: Für Partner-Server: das Paper-Plugin, sein Kanal zu HeldixClient, die Java-Schnittstelle für andere Plugins und die Partner-Schnittstelle des Heldix-Dienstes.
reihenfolge: 4
stichworte: server, plugin, paper, bukkit, velocity, bungeecord, proxy, partner, partner-server, partner-schlüssel, config.yml, kanal, plugin messaging, heldixclient:server, hud, toast, einblendung, regeln, rules, voice-gruppen, belohnungen, rewards, servicesmanager, HeldixServer, HeldixPlayerJoinEvent
---
**HeldixClient Server** ist ein kleines Plugin für Paper-Server. Es erkennt Spieler mit HeldixClient, schickt ihnen Server-Regeln, eigene HUD-Anzeigen und Einblendungen – und für [Partner-Server](/partner) mit Partner-Schlüssel auch Voice-Gruppen und Belohnungs-Cosmetics über den Heldix-Dienst. Spieler ohne HeldixClient merken davon nichts.

{{#serverplugin}}
{{SERVER_PLUGIN_HTML}}
{{/serverplugin}}
{{^serverplugin}}
> **Hinweis:** Das Plugin zum Herunterladen kommt bald. Diese Seite beschreibt die Schnittstelle, damit du dich schon jetzt darauf einstellen kannst. Das Plugin bringt seine ausführliche Dokumentation selbst mit.
{{/serverplugin}}

## Einrichten
1. Es braucht einen **Paper-Server mit der Minecraft-Version von HeldixClient** (gerade 26.3).
2. `HeldixClient-Server-<version>.jar` in den Ordner `plugins` legen und den Server neu starten.
3. In `plugins/HeldixClient-Server/config.yml` eintragen, was du brauchst, dann `/heldix reload`.
4. `/heldix status` zeigt Version, Partner, Regeln und die HeldixClient-Spieler, die gerade online sind. `/heldix test-hud <Spieler>` schickt einem Spieler für 15 Sekunden Beispiel-Anzeigen. Beide Befehle brauchen das Recht `heldix.admin`.

```yaml
# plugins/HeldixClient-Server/config.yml
# Partner-Schlüssel (hxp_ und 40 Zeichen). Leer = ohne Partner-Funktionen (Voice-Gruppen, Belohnungen)
partner-key: ""
# Name, den HeldixClient-Spieler für diesen Server sehen (höchstens 40 Zeichen). Leer = Text der MOTD
server-name: ""
# Adresse, mit der die Spieler verbinden – nur für Voice-Gruppen. Leer = erste Adresse des Partners
server-address: ""
rules:
  # Funktionen von HeldixClient, die auf diesem Server aus sind, z. B. [freelook, minimap, coordinates]
  disable: []
# Heldix-Dienst (nur ändern, wenn das Team es sagt)
api-url: "https://api.heldixclient.com"
```

Hinter **Velocity** oder **BungeeCord** brauchst du auf dem Proxy nichts: Die Proxys reichen den Kanal durch. Das Plugin gehört auf jeden Paper-Server dahinter, jeweils mit eigener `config.yml`. Für Voice-Gruppen trägst du unter `server-address` die öffentliche Adresse des Proxys ein.

> **Wichtig:** Der Partner-Schlüssel ist wie ein Passwort. Er erscheint nur einmal, wenn das Team ihn erzeugt. Nie öffentlich posten und nicht in ein Repository legen – geht er verloren, erzeugt das Team einen neuen, und der alte gilt nicht mehr.

## Was das Plugin kann
- **Server-Regeln:** Funktionen von HeldixClient auf deinem Server ausschalten: `freelook`, `zoom`, `minimap`, `worldmap`, `waypoints`, `coordinates`, `togglesprint` und – für Addons, die die Helligkeit ändern – `fullbright`. Der Spieler sieht dann „Auf diesem Server deaktiviert“. Weitere Schlüssel sind erlaubt; HeldixClient ignoriert sie, Addons können sie abfragen.
- **Server-HUD:** bis zu 8 Anzeigen je Spieler im Heldix-Stil – Text, Fortschrittsbalken oder Liste – an einem der Ränder des Bildschirms (unten in der Mitte liegt die Hotbar). Spieler können das Server-HUD in ihren Einstellungen ausschalten.
- **Einblendungen:** kurze Hinweise mit Titel und Text, höchstens einer alle 5 Sekunden je Spieler.
- **Voice-Gruppen** (nur Partner): Spieler je Team oder Runde in Gruppen einteilen. Wer eine Server-Gruppe hat, hört in der Nähe nur seine Gruppe und spricht im Gruppenkanal mit ihr – über jede Entfernung, nur auf diesem Server. Spieler ohne Gruppe hören nur Spieler ohne Gruppe.
- **Belohnungen** (nur Partner): Cosmetics freischalten, die das Team für deinen Server freigegeben hat – höchstens 600 je Stunde.

## Java-Schnittstelle für andere Plugins
Das Plugin meldet `HeldixServer` beim Bukkit-`ServicesManager` an; in der `plugin.yml` deines Plugins trägst du `softdepend: [HeldixClient-Server]` ein. Alle Methoden rufst du im Hauptthread auf; Aufrufe an den Heldix-Dienst laufen im Hintergrund und kommen als `CompletableFuture` zurück.

```java
HeldixServer heldix = HeldixServer.get();               // null, wenn das Plugin fehlt
if (heldix == null || !heldix.isHeldix(player)) return;

heldix.hud(player).set(HudElement.ofText("runde").anchor(HudAnchor.TOP_RIGHT).title("Runde 2").text("Noch 3 Minuten"));
heldix.toast(player, "Event", "Die Schatzsuche beginnt in einer Minute!");
heldix.rules().set(player, List.of("freelook", "minimap"));   // während einer Runde
heldix.voiceGroups().set(player, "rot");                       // nur mit Partner-Schlüssel
heldix.rewards().grant(player, "sieger-krone").thenAccept(result -> {
    if (result.granted()) player.sendMessage("Neu: die Sieger-Krone!");
});
```

Dazu `clientVersion(player)` und das Ereignis `HeldixPlayerJoinEvent`, sobald sich ein Spieler mit HeldixClient meldet.

## Der Kanal zwischen Server und Client
Plugin und Client sprechen über den Plugin-Messaging-Kanal `heldixclient:server`. Jede Nachricht ist ein JSON-Objekt (UTF-8, höchstens 32 KiB) mit dem Typ `t` und der Protokollversion `v` (jetzt 1). Unbekannte Typen und Felder ignorieren beide Seiten.

- Client → Server: `hello` nach dem Beitritt (Client, Version, API-Stufe, Sprache) und `hud_click` für anklickbare Anzeigen.
- Server → Client: `welcome` (Name des Servers), `rules` (`disable`: Liste der Funktionen), `hud_set`, `hud_remove`, `hud_clear` und `toast`.

```json
{ "t": "rules", "v": 1, "disable": ["freelook", "minimap"] }
{ "t": "hud_set", "v": 1, "id": "runde", "type": "progress", "anchor": "top", "title": "Runde 2", "text": "Noch 3 Minuten", "value": 0.4, "color": "#22c55e" }
```

Texte kommen ohne §-Farbcodes an. Ob ein Server Partner ist, entscheidet HeldixClient allein über die öffentliche Liste der Partner – nicht über eine Angabe des Servers.

## Partner-Schnittstelle des Heldix-Dienstes
Für Partner spricht das Plugin mit dem Heldix-Dienst – angemeldet mit `Authorization: Partner <Schlüssel>`. Du brauchst das nur, wenn du nicht das Plugin nimmst. Ist der Partner pausiert, antwortet der Dienst mit 403.

- `GET /v1/partner/me` – prüft den Schlüssel: ID, Name, Server und die freigegebenen Cosmetics.
- `PUT /v1/partner/voice/groups` mit `{ server, groups: { "<uuid>": "<gruppe>" | null } }` – höchstens 500 Einträge je Anfrage. Jeder Eintrag gilt 10 Minuten; das Plugin schickt alle 2 Minuten den ganzen Stand. `null` entfernt einen Spieler, `DELETE /v1/partner/voice/groups?server=…` leert alle.
- `POST /v1/partner/rewards` mit `{ uuid, cosmetic }` – schaltet ein freigegebenes Cosmetic frei; die Antwort sagt, ob der Spieler es schon hatte.

Gruppennamen haben 1 bis 24 Zeichen aus a–z, 0–9, `_` und `-`. Die Voice-Gruppen hält der Dienst nur im Arbeitsspeicher und speichert sie nicht. Fehler kommen als deutscher Satz (`{ error, code }`).

## Partner werden
Das Partner-Programm ist kostenlos. Den Antrag stellst du auf der Seite [Partner-Server](/partner), angemeldet mit deinem Minecraft-Konto.
