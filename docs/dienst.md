# Heldix-Dienst: Capes und Cosmetics für alle, Heldix-Symbol und Freunde

Der Heldix-Dienst ist ein kleiner Server (Ordner [service/](../service)). Zusammen mit der Webseite (Ordner [website/](../website)) richtet ihn ein Installer mit einem Befehl ein, siehe [Betrieb](#betrieb). Er verbindet HeldixClient-Spieler untereinander:

- **Capes für alle sichtbar:** Andere HeldixClient-Spieler sehen dein Heldix-Cape. Eigene Bilder bleiben auf deinem PC, damit keine fremden Bilder über den Dienst laufen. Ab Version 1.10.0 gibt es dazu das Matrix-Cape für alle und drei eingebaute Capes nur fürs Team.
- **Cosmetics für alle sichtbar:** Hüte, Flügel, Auren, Begleiter und weitere Capes aus dem Katalog des Teams. Jedes Cosmetic ist reine Daten (Modell und Textur, kein Code) und mit dem Update-Schlüssel signiert. Du wählst sie im Spiel, im Launcher oder auf der Webseite, und alle HeldixClient-Spieler sehen sie ohne Installation.
- **Heldix-Symbol:** In der Tab-Liste und im Namensschild über dem Kopf steht das Heldix-Logo vor dem Namen von HeldixClient-Spielern. Team-Mitglieder (Admin, Entwickler, Moderator, Supporter, Designer, Tester; nur mit öffentlichem Teamprofil), Spieler mit Community-Abzeichen (Partner, Creator, Botschafter) und Addon-Entwickler haben ein eigenes Symbol (siehe [Abzeichen](#abzeichen-badge)); unten in der Tab-Liste steht, wie viele HeldixClient-Spieler da sind.
- **Freunde:** Freundesliste mit Anfragen und Online-Status. Auf Wunsch zeigt sie, auf welchem Server ein Freund gerade spielt, sodass du ihm direkt beitreten kannst. Ab 1.12.0 (Freunde 2.0) dazu Favoriten, Spitznamen und Notizen (nur für dich), Statustext und „Nicht stören“, „zuletzt online“, eine Profilkarte mit gemeinsamen Freunden und freiwillige Vorschläge „Freunde von Freunden“.
- **Party:** Ab 1.12.0 spielt ihr mit bis zu 8 Spielern (der Leiter und bis zu 7 Freunde) als Party: Der Leiter lädt ein, alle sehen, wo die anderen spielen, und bekommen „<Leiter> ist auf <Ziel> – Beitreten“, wenn der Leiter den Server oder die Welt wechselt. Auf demselben Server bzw. in derselben Welt seid ihr automatisch in einer gemeinsamen Voice-Gruppe; dazu ein Party-Chat (siehe [Party](#party)).
- **Nachrichten:** Kurze Direktnachrichten an Freunde, auch wenn ihr gerade nicht auf demselben Server seid; ab 1.12.0 mit Antworten, Reaktionen, „schreibt …“, Löschen eigener Nachrichten und Beitreten-Karten (Server, Welt, Einladung).
- **Voice Chat:** Ab Version 1.8.0 sprechen HeldixClient-Spieler mit anderen in der Nähe, auf jedem Server und ohne Plugin; ab 1.9.0 auch in Gruppen über den ganzen Server, und andere sehen, wer sein Mikrofon stumm oder den Ton aus hat. Ab 1.11.0 reden Freunde ohne HeldixClient als Gast im Browser mit der Gruppe (über eine Einladung). Das Addon „Voice Chat“ nimmt auf und spielt ab; der Dienst leitet die Sprache nur weiter und speichert nichts davon (siehe [Voice Chat](#voice-chat)). Ab 1.13.0 **Voice-Moderation:** Voice-Regeln mit Pflicht-Zustimmung, Melden aus dem Voice (mit Kontext, Lautstärke-Verlauf und – erst nach Veröffentlichung der Regeln – der Aufnahme der letzten Minuten des Gemeldeten), Voice-Sperren des Teams, Gastgeber, Operatoren und Party-Leiter schalten für alle stumm oder entfernen für 10 Minuten, Server-Betreiber lassen Voice auf ihrem Server abschalten (siehe [Voice-Moderation](#voice-moderation)).
- **Einladungen:** Ab Version 1.11.0 erzeugt jeder Spieler Einladungs-Links (auf Wunsch mit Server oder Voice-Gruppe). Wer neu dazukommt, wird Freund und bekommt eine Willkommens-Belohnung; der Einladende schaltet Cosmetics frei, sobald seine Eingeladenen eine Weile gespielt haben (siehe [Einladungen](#einladungen)).
- **Welt teilen:** Ab Version 1.12.0 öffnet ein Spieler seine Einzelspielerwelt mit einem Klick für Freunde, ohne Portfreigabe und ohne Abo. Jede Welt hat eine feste Adresse wie `k7m2xq.welt.heldixclient.com`; der Dienst reicht die Minecraft-Verbindungen zum Gastgeber durch, auch für Spieler ohne HeldixClient. Die IP-Adressen der Spieler sieht der Gastgeber nicht (siehe [Welt teilen](#welt-teilen)).
- **Dauerhafte Welten, Entdecken, Heldix+:** Ab Version 1.13.0 läuft eine geteilte Welt auf Wunsch als echter Minecraft-Server (Paper, damit Plugins aus dem Modrinth-Katalog gehen) auf dem Heldix-Server, auch wenn ihr Besitzer offline ist; leere Welten schlafen und wachen beim Beitreten auf. Erst für Team-Mitglieder und Beta-Tester, später mit Heldix+. Im öffentlichen Verzeichnis „Entdecken“ listen Besitzer ihre offenen Welten freiwillig; auf der Heldix+-Warteliste trägt man sich für später ein (siehe [Dauerhafte Welten](#dauerhafte-welten), [Entdecken](#entdecken), [Heldix+-Warteliste](#heldix-warteliste)).
- **Server-Partner, Setup teilen, öffentliche Profile:** Ab Version 1.14.0 werden Minecraft-Server Partner (Abzeichen „Partner“, Server-Plugin mit Server-Gruppen im Voice Chat und Belohnungs-Cosmetics), Spieler teilen eine Instanz als Link (Mods, Pakete und Addons von Modrinth bzw. aus dem Store, auf Wunsch Grafik und Tasten) und schalten auf Wunsch ein öffentliches Profil unter /spieler/<name> ein. Freunde sehen außerdem, wer gerade nur im Launcher ist („Im Launcher“).
- **Blockieren und Melden:** Wer stört, lässt sich blockieren und beim Betreiber melden.
- **Launcher-Updates und Downloads:** Der Launcher lädt neue Versionen über den Dienst. Alle Downloads der Webseite (Windows und macOS, mit Prüfsummen) kommen ebenfalls vom Dienst, nicht von GitHub.
- **Addon-Store:** Heldix-Addons kommen einzeln aus dem Store, im Launcher, im Spiel und auf der Webseite; seit Version 1.6.1 auch Addons, die direkt in Minecraft eingreifen (früher Heldix-Mods). Offizielle Addons veröffentlicht das Team; jeder angemeldete Spieler kann eigene Addons einreichen, das Team prüft sie. Jede Version ist mit dem Update-Schlüssel signiert, auch bei Addons von Spielern (Freigeben heißt signieren). Dazu Screenshots, Bewertungen, Meldungen und eine Seite je Entwickler.
- **Webseite mit Konto:** Anmelden ohne Passwort über den Launcher oder das Spiel, ab Version 1.7.0 auf Wunsch auch direkt mit dem Minecraft-Konto (bei Microsoft). Auf der Webseite siehst du Freunde, Nachrichten und Einstellungen, lädst deine Daten herunter und siehst deine Meldungen.
- **Team-Bereich:** Das Team arbeitet auf der Webseite mit Rechten je Rolle (ab 1.12.0: Admin, Entwickler, Moderator, Supporter, Designer, Tester): Meldungen, Sperren und Support-Anfragen bearbeiten, Neuigkeiten schreiben, eingereichte Addons prüfen und freigeben (signieren), Updates, offizielle Addons und Cosmetics veröffentlichen, das Team und die Community-Abzeichen verwalten (siehe [Rechte](#rechte-je-rolle)). Der Zugang braucht für jede Rolle eine Zwei-Faktor-Anmeldung.
- **Support:** Spieler schreiben dem Team über Webseite, Launcher oder Spiel, auf Wunsch mit Textdateien als Anhang (z. B. Absturzbericht aus der Absturzhilfe des Launchers); Antworten meldet das Spiel sofort.
- **Teamseite, Neuigkeiten, Versionsverlauf, Status:** Öffentlich (ohne Anmeldung) gibt es die Teamseite (nur wer zustimmt), alle Neuigkeiten, die Liste der Launcher-Versionen und einen Status mit Summen; ab 1.12.0 auch Live-Zahlen für die Webseite (erst ab 50 Spielern online) und Köpfe aus dem Skin als Bild (für Webseite und Discord).

Ohne eingetragene Adresse des Dienstes sind diese Funktionen aus; der Rest von HeldixClient läuft wie gewohnt.

## Datenschutz

- **Gespeichert werden:** Minecraft-UUID, Spielername, gewähltes Heldix-Cape und gewählte Cosmetics, die Einstellungen unten, Freundschaften und offene Anfragen, Nachrichten an Freunde, Blockierungen, Meldungen, Support-Anfragen (mit Anhängen), eingereichte Addons, Bewertungen und Meldungen zu Addons, Einladungen, wer über wessen Einladung dazukam, freigeschaltete Cosmetics, Zeitpunkt der letzten Verbindung, Anmeldungen auf der Webseite und für Team-Mitglieder Rolle, 2FA-Geheimnis, Teamprofil und Protokoll. Ab 1.12.0 (Freunde 2.0) dazu: dein Statustext, „Nicht stören“, die Schalter „Zuletzt online zeigen“, „In Vorschlägen erscheinen“, „Vorschläge zeigen“ und „Ist online“-Benachrichtigungen, das Ende deiner letzten Verbindung aus dem Spiel („zuletzt online“), je Freundschaft dein Favorit, Spitzname und deine Notiz, bei Nachrichten der Antwort-Bezug und eine Beitreten-Karte, deine Reaktionen und ein Community-Abzeichen (mit Zeitpunkt und dem Team-Mitglied, das es vergeben hat).
- **Freunde 2.0** (ab 1.12.0): **Favorit, Spitzname und Notiz** sieht nur, wer sie angelegt hat; der Freund erfährt davon nichts. Sie gehen mit der Freundschaft. **Statustext** (höchstens 40 Zeichen) sehen deine Freunde immer, **„Nicht stören“** nur, solange du online bist; bei „Nicht stören“ zeigen deine Clients keine Hinweise, Nachrichten kommen trotzdem an. **„Zuletzt online“** sehen Freunde nur, wenn dein Online-Status für Freunde an ist und du „Zuletzt online zeigen“ nicht ausgeschaltet hast, und nur gerundet (vor weniger als einer Stunde auf 5 Minuten, sonst auf Stunden bzw. Tage). Die **Profilkarte** zeigt Freunden dazu gemeinsame Freunde (nur die gemeinsamen), das Abzeichen und – mit „Für andere erkennbar“ – Cape und Cosmetics. **Vorschläge „Freunde von Freunden“:** Du erscheinst nur bei Freunden deiner Freunde, wenn du „In Vorschlägen erscheinen“ einschaltest (Standard: aus); gezeigt werden dabei nur dein Name und die Zahl gemeinsamer Freunde, nicht wer. Wer „Vorschläge zeigen“ ausschaltet, bekommt keine. Blockierte, Freunde und offene Anfragen erscheinen nie. **„Schreibt …“** leitet der Dienst nur weiter und speichert es nie. **Löschen** einer eigenen Nachricht löscht sie für beide, mit ihren Reaktionen.
- **Party** (ab 1.12.0): Parties und Party-Chat (die letzten 50 Nachrichten) liegen nur im Arbeitsspeicher, nie in der Datenbank, und sind nach einem Neustart des Dienstes weg. Innerhalb einer Party sehen die Mitglieder untereinander, ob die anderen online sind und wo sie spielen (Server bzw. geteilte Welt), **auch wenn „Online-Status“ oder „Server zeigen“ für Freunde aus ist** – das gehört zum Zusammenspielen; wer das nicht möchte, tritt keiner Party bei. Server-Adressen gehen dabei wie sonst nur als öffentliche Domains weiter. Den Prüfwert der Voice-Gruppe bildet der Dienst aus der Party (HMAC mit einem Schlüssel nur im Arbeitsspeicher); er ändert sich, sobald jemand geht.
- **Nicht gespeichert werden:** Passwörter und Microsoft-, Xbox- oder Minecraft-Tokens. Die Anmeldung beim Dienst läuft wie der Beitritt zu einem Minecraft-Server über Mojang; der Dienst sieht dabei kein Token. Bei der Anmeldung mit dem Minecraft-Konto auf der Webseite hat der Dienst die Tokens für die Dauer der Anmeldung in der Hand (nur im Arbeitsspeicher), holt damit UUID und Namen und verwirft sie sofort; sie stehen in keinem Log und keiner Datenbank.
- **Online-Status und Server** sehen nur bestätigte Freunde (und ab 1.12.0 die Mitglieder einer gemeinsamen Party, siehe unten). Server-Adressen werden nur weitergegeben, wenn sie öffentliche Domains sind (keine IP-Adressen, kein `localhost`, keine Heimnetz-Namen). Ein Port bleibt dabei, wenn er nicht der Standard-Port 25565 ist, damit Freunde beitreten können.
- **Erkennbar sein** (Heldix-Symbol, Cape und Cosmetics für andere): Nur wer online ist und die Einstellung an hat, wird bei einer Abfrage als HeldixClient-Spieler gemeldet, mit Cape und gewählten Cosmetics. Dabei meldet der Dienst auch ein Abzeichen fürs Symbol: eine Team-Rolle nur, wenn das Mitglied auf der öffentlichen Teamseite steht (sonst bleibt die Rolle verborgen), ein Community-Abzeichen (Partner, Creator, Botschafter), wenn das Team es vergeben hat, Addon-Entwickler, wenn ein sichtbares Community-Addon des Spielers im Store ist (das steht ohnehin auf seiner Entwicklerseite). Mehr verrät die Abfrage nicht. Dasselbe Abzeichen sehen Freunde in der Freundesliste und auf der Profilkarte.
- **Köpfe** (ab 1.12.0): `GET /v1/public/heads/<uuid>.png` zeigt ohne Anmeldung den Kopf aus deinem Minecraft-Skin (für Webseite und Discord), aber nur, wenn du beim Dienst bekannt bist und „Für andere erkennbar“ an hast (oder auf der Teamseite stehst). Der Skin ist bei Mojang ohnehin öffentlich; den Kopf berechnet der Dienst selbst und hält ihn eine Stunde im Arbeitsspeicher.
- **Nachrichten** gehen nur an bestätigte Freunde. Der Dienst speichert sie als Verlauf höchstens 30 Tage, danach löscht er sie von selbst; pro Unterhaltung bleiben höchstens die letzten 500. Sie sind **nicht Ende-zu-Ende-verschlüsselt:** Unterwegs schützt sie HTTPS, auf dem Server liegen sie lesbar in der Datenbank. Endet die Freundschaft (Entfernen, Blockieren, Daten löschen), löscht der Dienst die ganze Unterhaltung sofort, für beide. Ob du eine Nachricht gelesen hast, erfährt der Absender nicht.
- **Voice Chat:** Mit dem Addon „Voice Chat“ gehen deine Sprache (Opus-kodiert) und deine Position, Server-Adresse und Dimension an den Dienst. Er leitet die Sprache nur an HeldixClient-Spieler weiter, die auf demselben Server in derselben Welt in Reichweite sind (Standard 48 Blöcke) oder mit dir in derselben Gruppe auf diesem Server, nie an Blockierte (in beide Richtungen) und in der Nähe mit „Nur Freunde“ nur an Freunde. Für eine Gruppe bekommt der Dienst nur einen Prüfwert (SHA-256) aus Gruppenname und Passwort, nie Name oder Passwort selbst. Ob du dein Mikrofon stumm oder den Ton aus hast, sehen die Spieler im selben Raum und in deiner Gruppe. Position, Server, Dimension, Gruppe und dieser Status liegen nur im Arbeitsspeicher, solange die Verbindung offen ist. Sprache und Positionen speichert der Dienst nicht und schreibt sie in kein Log. Unterwegs schützt sie HTTPS; Ende-zu-Ende-verschlüsselt ist die Sprache nicht.
- **Voice im Browser** (ab 1.11.0): Gäste brauchen kein Konto. Ihren Namen und ihre Sitzung (Zufalls-ID, SHA-256 des Tokens, Einladung, Ablauf) hält der Dienst nur im Arbeitsspeicher, höchstens 6 Stunden und nie länger als die Einladung; nach einem Neustart sind sie weg. Er schreibt sie in kein Log und keine Datenbank. Wer in der Gruppe ist, sieht den Gastnamen und dass jemand im Browser ist. Sprache leitet der Dienst wie im Spiel nur weiter. Angemeldete Spieler im Browser nutzen das Cookie der Webseite; dafür wird nichts zusätzlich gespeichert.
- **Voice-Moderation** (ab 1.13.0): **Zustimmung zu den Voice-Regeln:** Version und Zeitpunkt, bis zum Widerruf (`DELETE /v1/voice/rules/accept`, dann ist Voice für dich aus) oder mit dem Konto; bei Gästen nur in der Gast-Sitzung im Arbeitsspeicher. **Voice-Meldungen:** wer wen gemeldet hat (bei Gästen die Gast-Sitzung mit Namen), Grund, Notiz, Kontext vom Client (Server/Welt, Dimension, Zeitpunkt, Gruppe ja/nein, Spieler in Hörweite mit UUID und Name) und vom Dienst (dasselbe aus der Voice-Verbindung des Meldenden), dazu ein **Lautstärke-Verlauf** des Gemeldeten (Pegel je Sekunde, höchstens 10 Minuten, kein Inhalt); nur das Team sieht sie, gelöscht nach 90 Tagen wie andere Meldungen; das Ergebnis der Prüfung (berechtigt/unberechtigt/unklar) zählt für die Verlässlichkeit des Meldenden. **Clips** gibt es nur, solange die Voice-Regeln veröffentlicht sind und Aufnahmen an sind (Schalter des Admins, `HELDIX_DIENST_VOICE_CLIPS=0` schaltet hart ab): Das Spiel hält die empfangenen Opus-Pakete anderer höchstens 10 Minuten im Arbeitsspeicher, nie auf der Festplatte, nie die eigene Stimme; nur beim Melden lädt es die Pakete **des Gemeldeten** hoch (Ogg/Opus, höchstens 10 Minuten und 3 MiB, mit Zeitpunkten). Der Dienst speichert sie mit AES-256-GCM verschlüsselt im Datenordner; abspielen kann sie nur das Team mit `voice:moderate` (jedes Abspielen steht im Protokoll); gelöscht 30 Tage nach Abschluss der Meldung, spätestens 90 Tage nach dem Hochladen, und mit der Meldung. Nicht in der Datenauskunft des Gemeldeten (Schutz des Meldenden); der Meldende sieht dort nur, dass es eine Aufnahme gibt. **Voice-Sperren:** UUID, Name, Grund, Dauer, wer gesperrt bzw. aufgehoben hat, auf welche Meldungen sie sich stützen; aktive bleiben wie Sperren (auch nach dem Löschen der Daten), aufgehobene und abgelaufene stehen 365 Tage im Verlauf. Stummschalten und Entfernen durch Gastgeber, Operatoren und Party-Leiter liegt nur im Arbeitsspeicher. Die Liste „Voice aus“ enthält nur Domains von Servern (mit Grund und einem freiwilligen Kontakt des Betreibers).
- **Einladungen** (ab 1.11.0): Gespeichert werden deine Einladungen (Code, erstellt, Ablauf, Server, bei Einladungen in den Voice Chat der Prüfwert der Gruppe, Zahl der Annahmen) bis zum Ablauf (30 Tage, mit Voice 24 Stunden) oder Widerruf; wer über welche Einladung neu dazukam (UUID des Eingeladenen und des Einladenden, Code, Zeitpunkt), die **Summe** der Spielzeit bis zur Bestätigung (keine einzelnen Sitzungen, nach der Bestätigung zählt der Dienst nicht mehr) und der Zeitpunkt der Bestätigung, solange das Konto des Eingeladenen besteht; freigeschaltete Cosmetics (ID, Grund, Zeitpunkt) bis zum Löschen deines Kontos. Wer einen Link hat, sieht ohne Anmeldung Name und UUID des Einladenden, den Server und bei Voice-Einladungen, wie viele gerade in der Gruppe sind. Der Einladende sieht in der Übersicht nur Zähler (eingeladen, bestätigt) und in der Datenauskunft nur Zeitpunkte; den Namen erfährt er nur in der Benachrichtigung „angenommen“ bzw. „bestätigt“ (meist seid ihr dann ohnehin Freunde). Hat einer den anderen blockiert, erfährt der Einladende nichts und bekommt nichts gutgeschrieben. Codes stehen im Fragment des Web-Links (`#`), also in keinem Log eines Webservers; der Dienst loggt weder Codes noch Tokens.
- **Welt teilen** (ab 1.12.0): Gespeichert werden deine Welten (ID, Code, Name, Zugang, Höchstzahl der Spieler, Standardrolle, erstellt, zuletzt geöffnet bzw. geschlossen, zuletzt gemeldete Minecraft-Version) und ihre Mitglieder (Minecraft-Name, Rolle, seit wann; die UUID nur, wenn ein HeldixClient-Spieler so heißt oder du ihn aus der Freundesliste eingeladen hast), bis du die Welt oder dein Konto löschst. Nur im Arbeitsspeicher, solange die Welt geöffnet ist: Minecraft-Version, Protokollnummer, MOTD, Spielerzahl, wer angeklopft hat und wen du abgelehnt hast (10 Minuten). Der Dienst reicht die Verbindungen der Spieler nur durch: Er liest Handshake und Login Start (Adresse, Protokollnummer, Spielername), alles danach ist für ihn unlesbar (Minecraft verschlüsselt es) und wird weder gespeichert noch geloggt. **Der Gastgeber sieht keine IP-Adressen:** Bei ihm kommen alle Spieler über seine eigene Verbindung zum Dienst an. IP-Adressen zählt der Dienst nur kurz im Arbeitsspeicher für die Grenzen (eine Minute lang). Wer die Adresse kennt, sieht ohne Anmeldung Name der Welt, Name und UUID des Gastgebers, ob sie gerade offen ist, Spielerzahl, Minecraft-Version und ob jeder beitreten darf. Freunde sehen eine geöffnete Welt nur mit Zugang „Freunde“ oder „offen“ und wenn dein Online-Status für Freunde an ist; Mitglieder sehen sie immer, Blockierte nie.
- **Dauerhafte Welten** (ab 1.13.0): Gespeichert werden je dauerhafter Welt Zustand, Server-Software und Version, Grenzen, Schlafen nach, die Auswahl aus server.properties, das Symbol, die installierten Plugins (Modrinth-Projekt, Version, Datei, Prüfsumme) und wann sie zuletzt lief, dazu beim Welten-Wächter die **Weltdateien, Plugins, ihre Konfiguration und die Sicherungen**, bis du die Welt dauerhaft beendest, sie oder dein Konto löschst. Das **Server-Log** (Spielernamen, Chat, Befehle) hält der Server höchstens **7 Tage**; der Dienst selbst speichert es nicht (Konsole und Live-Log nur auf Abruf, nur für dich und deine Operatoren). **Spieler-IPs erreichen den Server nicht:** Das Relay verbindet sich lokal mit ihm (127.0.0.1 bzw. die Docker-Brücke), im Log steht nur diese Adresse. Eine hochgeladene Welt liegt nur bis zum Übernehmen im Upload-Ordner des Dienstes (unfertige Uploads 2 Stunden, Downloads bis zum Ende des Downloads). Wer anklopft und wen du abgelehnt hast, liegt nur im Arbeitsspeicher (10 Minuten). **Plugins aus dem Katalog** sind Programme anderer: Sie können eigene Daten speichern und ins Internet verbinden (Hinweis beim Installieren). Freischaltungen („Beta: Dauerhafte Welten“: UUID, Quelle, seit wann, von wem, ob gesehen) bis zum Entzug oder mit dem Konto.
- **Entdecken** (ab 1.13.0): Öffentlich sichtbar ist nur, was du listest (Name der Welt, Beschreibung, Tags, Sprache, Version, Spieler online/max, Zustand, Adresse, bei dauerhaften Welten das Symbol) und Name und Kopf des Gastgebers. **Gefällt mir** speichert der Dienst mit deiner UUID; öffentlich ist nur die Zahl. Meldungen zu Einträgen (wer, Grund, Notiz, Stand des Eintrags) sehen nur das Team und der Betreiber, nach 90 Tagen gelöscht. Eine Sperre fürs Verzeichnis (UUID, Name, Grund, wer) bleibt wie eine Sperre.
- **Heldix+-Warteliste** (ab 1.13.0): Gespeichert werden nur UUID und seit wann, bis du dich austrägst, bis Heldix+ startet oder mit dem Konto. Das Team sieht dazu Name, seit wann du dabei bist und – wenn bekannt – die Spielzeit bis zur Bestätigung einer Einladung. Keine E-Mail: Hinweise kommen über die Glocke im Launcher, die Webseite und das Spiel. Die Zahl der Einträge ist öffentlich erst ab 50.
- **Server-Partner, Setups, öffentliche Profile** (ab 1.14.0): **Anträge** auf das Partner-Programm (Server, Name, Beschreibung, Kontakt, Status, Antwort des Teams) gehen mit dem Konto; bei einem angelegten Partner merkt sich der Dienst den Antragsteller als Kontakt (fällt mit dem Konto weg). **Belohnungen** eines Partner-Servers sind Freischaltungen wie bei Einladungen (Herkunft `partner:<id>`); der Partner erfährt nur, ob es geklappt hat. **Server-Gruppen** im Voice Chat liegen nur im Arbeitsspeicher (ohne Erneuerung höchstens 10 Minuten), nie in Datenbank oder Log. **Setups:** Name, Beschreibung, Inhalt (Minecraft-Version, Loader, IDs und Namen von Mods, Paketen und Addons, auf Wunsch Grafik-Einstellungen und Tasten), Zeitpunkte und Zähler mit deiner UUID; sichtbar für jeden mit dem Code, samt deinem Namen; gelöscht 30 Tage nach Ablauf bzw. Widerruf oder mit dem Konto. Welche IP ein Setup schon aufgerufen bzw. installiert hat, merkt sich der Dienst nur als gesalzenen Hash im Arbeitsspeicher (1 Stunde bzw. 1 Tag). **Öffentliches Profil:** aus, bis du es einschaltest; dann sind Name, Bio, seit wann du dabei bist, Kopf und Skin und – je nach Schalter – Abzeichen, Cape und Cosmetics und deine Einträge in Entdecken ohne Anmeldung sichtbar (auch für Suchmaschinen und Vorschaukarten). Ausschalten wirkt sofort (Zwischenspeicher höchstens 1 Minute). **„Im Launcher“:** Freunde sehen, dass dein Launcher verbunden ist (nur mit sichtbarem Online-Status).
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
- **Status:** Die öffentliche Status-Abfrage zeigt nur Summen (wie viele Spieler online, im Voice Chat und insgesamt angemeldet sind, wie viele Addons im Store und Cosmetics im Katalog sind und wie viele Welten gerade geteilt werden), keine Namen. Die Live-Zahlen für die Webseite (`/v1/public/stats`, ab 1.12.0) zeigen Spieler online, im Voice Chat und offene Welten erst ab einer Schwelle (Standard 50 Spieler online), darunter gar keine Zahlen.
- **Einstellungen im Heldix-Menü:** „Für andere erkennbar“, „Online-Status für Freunde“, „Server für Freunde sichtbar“, „Nachrichten von Freunden annehmen“; ab 1.12.0 dazu „Zuletzt online zeigen“ (Standard an), „In Vorschlägen erscheinen“ (Standard aus), „Vorschläge zeigen“ (Standard an), „Ist online“-Hinweise (alle, nur Favoriten, keine), Statustext und „Nicht stören“.
- **Echtzeit im Browser und im Launcher** (ab 1.12.0): Die Webseite (mit dem Cookie) und der Launcher können eine Echtzeit-Verbindung halten, um Freunde, Nachrichten und Party live zu zeigen. Sie zählen nicht als „online im Spiel“: Freunde sehen dich dadurch nicht online, und „zuletzt online“ ändert sich nicht.
- **Daten löschen:** Im Heldix-Menü unter Freunde → Privatsphäre (oder auf der Webseite) löscht „Daten beim Dienst löschen“ alles, was der Dienst über dich gespeichert hat: Konto, Freundschaften, Anfragen, Nachrichten (auch die an dich), Blockierungen (von dir und gegen dich), deine Meldungen, alle Anmeldungen auf der Webseite und eine Team-Mitgliedschaft. Dazu gehören auch deine Auswahl an Cosmetics, deine Support-Anfragen, dein Teamprofil, deine Addon-Einreichungen (mit JARs und Screenshots), Bewertungen und Meldungen zu Addons, deine Einladungen (Gäste darüber fliegen sofort aus dem Voice Chat), wie du selbst eingeladen wurdest und deine Freischaltungen; wer über dich dazukam, zählt danach für niemanden mehr. Ab 1.12.0 auch deine Welten mit ihren Mitgliedern (eine geöffnete Welt geht sofort zu), ab 1.13.0 deine dauerhaften Welten (der Server hält an, Weltdateien, Plugins und Sicherungen werden beim Welten-Wächter gelöscht), Freischaltungen, dein Eintrag auf der Heldix+-Warteliste, deine Einträge in Entdecken, deine Gefällt-mir und deine Meldungen dort; stehst du in der Welt eines anderen auf der Liste, bleibt dort nur dein Minecraft-Name (seine Liste), die Verbindung zu deinem Konto (UUID) löscht der Dienst. Ebenso (Freunde 2.0) Statustext, Schalter, Favoriten, Spitznamen und Notizen, deine Reaktionen, ein Community-Abzeichen und deine Party-Mitgliedschaft (du verlässt die Party sofort). Deine veröffentlichten Addons bleiben im Store: Ihr Manifest ist signiert und bleibt unverändert (mit deinem damaligen Namen und deiner UUID), angezeigt wird als Autor aber „Gelöschter Spieler“, die Entwicklerseite entfällt, und die Addon-ID bleibt gesperrt (auch für ein neues Konto). Es bleiben nur Meldungen anderer über dich (bis zum Ablauf nach 90 Tagen), Einträge im Team-Protokoll (bis zum Ablauf nach 365 Tagen), der Autorname an Neuigkeiten, an Antworten auf Support-Anfragen anderer, an veröffentlichten Addon-Versionen und an veröffentlichten Cosmetics, und eine Sperre. Ab 1.13.0 löscht es auch deine Zustimmung zu den Voice-Regeln und deine Voice-Meldungen (mit ihren Aufnahmen); eine Voice-Sperre bleibt wie eine Sperre.

## Schnittstelle (Version 1)

Alle Anfragen und Antworten sind JSON (UTF-8), außer Download und Upload der Launcher-Installer und der Addons und dem Datenexport (JSON-Datei). UUIDs sind immer klein geschrieben und ohne Bindestriche (32 Hex-Zeichen). Fehler antworten mit einem passenden HTTP-Status und `{ "error": "<deutscher Text für den Spieler>" }`, im Team-Bereich bei fehlendem Zugang zusätzlich mit `"code"`.

**Zwei Arten der Anmeldung:**
- **Bearer-Token** (Launcher, Spiel): `Authorization: Bearer <token>` aus `POST /v1/auth/login`.
- **Cookie** (Webseite): Die Webseite erreicht den Dienst unter `/api/…` auf ihrer eigenen Adresse (Caddy schneidet `/api` ab: `fetch('/api/v1/web/me')` kommt als `GET /v1/web/me` an). Die Sitzung steckt im Cookie `__Host-heldix_web` (HttpOnly, Secure, SameSite=Strict, Path=/). **CSRF:** Jede Anfrage mit Cookie außer GET und HEAD braucht den Header `X-Heldix-Web: 1`, und ein mitgeschickter `Origin` muss genau die Webseite sein (`HELDIX_DIENST_WEBSITE`); sonst 403. Schickt eine Anfrage beides, zählt das Bearer-Token.

Alle Routen für Spieler (`/v1/me…`, `/v1/friends…`, `/v1/messages…`, `/v1/blocks…`, `/v1/reports…`, `/v1/support…`, `/v1/players/lookup`, `/v1/addon-submissions…`, `/v1/addons/<id>/rating`, `/v1/addons/<id>/reports`, `/v1/invites…`, ab 1.12.0 `/v1/worlds…`, ab 1.13.0 `/v1/hosting…`, `/v1/discover…` und `/v1/plus…`) nehmen beides an. `POST /v1/web/link` geht nur mit Bearer-Token, `/v1/web/…` und `/v1/team/…` nur mit Cookie (außer `POST /v1/web/session`, `GET /v1/web/config` und `GET /v1/web/auth/microsoft…`, die ohne Anmeldung gehen), die WebSockets `/v1/worlds/host` und `/v1/worlds/streams/<id>` nur mit Bearer-Token. `/v1/ws` geht mit Bearer-Token (Spiel; Launcher mit `?client=launcher`) und ab 1.12.0 auch mit dem Cookie aus dem Browser, wenn `Origin` genau die Webseite ist (siehe [Echtzeit](#echtzeit-websocket)). Ab 1.12.0 gehört auch `/v1/party…` zu den Routen für Spieler (Bearer-Token oder Cookie), ab 1.14.0 ebenso `/v1/setups…`, `/v1/account/…`, `POST /v1/partner-applications` und `POST /v1/public/players/<name>/report`. Die Partner-Schnittstelle `/v1/partner/…` (ab 1.14.0) nimmt nur `Authorization: Partner <key>` an (siehe [Server-Partner](#server-partner-und-partner-schnittstelle)). `/v1/voice` geht mit Bearer-Token (Spiel) und ab 1.11.0 auch aus dem Browser: als Gast mit dem Unterprotokoll `gast.<token>` oder angemeldet mit dem Cookie, jeweils mit Prüfung des `Origin` (siehe [Voice im Browser](#voice-im-browser)).

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
| `PUT /v1/me` | Teil von `{ "cape": "<id>" \| "", "visible": bool, "presence": bool, "showServer": bool, "messages": bool, "statusText": "<0–40>" \| null, "dnd": bool, "showLastOnline": bool, "suggestable": bool, "showSuggestions": bool, "onlineNotify": "all" \| "favorites" \| "none" }` | `Me` |
| `DELETE /v1/me` | – | `{ "deleted": true }` |
| `GET /v1/me/export` | – | JSON-Datei mit allen Daten (siehe unten) |
| `GET /v1/me/cosmetics` | – | `MyCosmetics` (siehe [Cosmetics-Katalog](#cosmetics-katalog)) |
| `PUT /v1/me/cosmetics` | `{ "slot", "id" }` | `MyCosmetics` |

`Me` = `{ "uuid", "name", "cape", "visible", "presence", "showServer", "messages", "statusText", "dnd", "showLastOnline", "suggestable", "showSuggestions", "onlineNotify", "badge" }`. Die Standardwerte sind `cape: ""`, die vier ersten Schalter `true`, `statusText: null`, `dnd: false`, `showLastOnline: true`, `suggestable: false`, `showSuggestions: true`, `onlineNotify: "all"`. Die Felder ab `statusText` gibt es ab 1.12.0 (ältere Clients ignorieren sie).

- `statusText` (ab 1.12.0): eigener Status für Freunde, 0–40 Zeichen, eine Zeile (Regeln wie bei Nachrichten, Leerzeichen am Rand fallen weg); `""` oder `null` löscht ihn, `Me` zeigt dann `null`. Zu lang: 400 „Der Statustext ist zu lang (höchstens 40 Zeichen).“, Zeilenumbrüche o. Ä.: 400.
- `dnd`: „Nicht stören“. Freunde sehen es (solange du online bist); deine Clients zeigen keine Hinweise und spielen keine Töne, Nachrichten kommen trotzdem an; Party-Einladungen an dich tragen `quiet: true`.
- `showLastOnline`: Freunde sehen „zuletzt online“ (nur mit `presence`). `suggestable`: du erscheinst in Vorschlägen bei Freunden deiner Freunde. `showSuggestions`: du bekommst selbst Vorschläge. `onlineNotify`: welche „Ist online“-Hinweise deine Clients zeigen (`all`, nur `favorites`, `none`); der Dienst speichert es nur, damit alle Clients gleich entscheiden.
- `badge` (nur lesen): dein Abzeichen, wie andere es sehen (siehe [Abzeichen](#abzeichen-badge)).

- `visible`: Für andere als HeldixClient-Spieler erkennbar (Symbol und Cape).
- `presence`: Freunde sehen den Online-Status.
- `showServer`: Freunde sehen den Server.
- `messages`: Nachrichten von Freunden annehmen. Ist der Schalter aus, bekommen Freunde beim Senden 403. Selbst schreiben geht trotzdem, und vorhandene Nachrichten bleiben.
- `cape` muss eine der eingebauten IDs sein: `heldix`, `mitternacht`, `aurora`, `glut`, `kristall`, `neon`, `sakura`, `gewitter`, `galaxie`, ab Version 1.10.0 auch `matrix`, `matrix_rot`, `matrix_tuerkis` und `sakura_orange` (die Bilder liegen in der HeldixClient-Mod). Die Liste lässt sich mit der Umgebungsvariable `HELDIX_DIENST_CAPES` (durch Kommas getrennt) ersetzen. `""` heißt: kein Cape. Ab Version 1.6.0 geht auch die ID eines Katalog-Capes (Slot `cape`, siehe [Cosmetics-Katalog](#cosmetics-katalog)), das sichtbar ist und das der Spieler wählen darf; sonst 400 „Unbekanntes Cape.“, bei einem Cape nur fürs Team 403. Ist das gewählte Katalog-Cape gerade ausgeblendet (oder nur fürs Team und der Spieler nicht mehr im Team), zeigt `Me` `cape: ""`; gespeichert bleibt die Wahl trotzdem.
- **Team-Capes** (ab Version 1.10.0): Die eingebauten Capes `matrix_rot`, `matrix_tuerkis` und `sakura_orange` gelten wie Katalog-Cosmetics mit `access: "team"`; `matrix` ist für alle. Wählen darf sie nur, wer im Team ist (jede Rolle); sonst antworten `PUT /v1/me` und `PUT /v1/me/cosmetics` mit 403 „Dieses Cosmetic gibt es nur für das HeldixClient-Team.“ und ändern nichts. Andere sehen sie nur, solange der Träger im Team ist: Verlässt er das Team, zeigen `Me` und das Nachschlagen `cape: ""` (`MyCosmetics`: `null`); gespeichert bleibt die Wahl trotzdem und gilt wieder, sobald er wieder im Team ist. Das gilt auch, wenn `HELDIX_DIENST_CAPES` die Liste ersetzt; ein Team-Cape, das dort nicht steht, ist wie jedes andere unbekannt (400).
- `DELETE /v1/me` löscht den Spieler mit allen Tokens, Web-Sitzungen, Freundschaften, Anfragen, Nachrichten und Blockierungen (jeweils in beide Richtungen), der Team-Mitgliedschaft (mit Teamprofil), seiner Auswahl an Cosmetics, seinen Support-Anfragen, den Meldungen, die er selbst gemacht hat, und ab 1.11.0 seinen Einladungen (deren Gäste trennt der Dienst mit 4004), seinen Freischaltungen und wie er eingeladen wurde, ab 1.12.0 seinen Welten mit Mitgliedern (eine geöffnete schließt der Dienst samt Steuerverbindung mit 4001; in Welten anderer verliert sein Eintrag nur die UUID). Wer über ihn dazukam, zählt danach für niemanden mehr (bleibt aber „schon eingeladen“). Meldungen anderer über ihn und Einträge im Team-Protokoll bleiben bis zum Ablauf, eine Sperre bleibt ganz. Mit Cookie löscht die Antwort auch das Cookie. Seine offenen WebSocket-Verbindungen (auch den Voice Chat) schließt der Dienst mit Code 4001 („Konto gelöscht“). Frühere Freunde und Spieler mit offenen Anfragen bekommen, falls verbunden, sofort eine neue `friends`-Nachricht ohne ihn. Danach gilt das alte Token nicht mehr (401). Meldet sich derselbe Spieler später wieder an, legt der Dienst ihn neu mit den Standardwerten an.

- **Datenexport** (`GET /v1/me/export`): `Content-Disposition: attachment; filename="heldix-daten-<name>.json"`. Enthält `exportedAt`, `profile` (Me mit `createdAt`, `lastSeen`), `friends` (uuid, name, since), `requests` (`incoming`, `outgoing`), `messages` (alle gespeicherten, beide Richtungen), `blocked`, `reports` (eigene, mit Beleg), `logins` (Zeitpunkte der Tokens), `webSessions` (ohne Hashes), `team` (Rolle oder `null`, ohne 2FA-Geheimnis), `news` (eigene Neuigkeiten), `teamActions` (eigene Einträge im Protokoll), `support` (eigene Support-Anfragen mit allen Nachrichten, so wie du sie siehst), `cosmetics` (`{ "head", "back", "aura", "companion", "cape" }`: die gespeicherte Auswahl je Slot, auch ausgeblendete, `null` = nichts) und ab 1.11.0 `invites`: `links` (eigene Einladungen mit `code`, `createdAt`, `expiresAt`, `server`, `voiceGroup` (Prüfwert oder `null`), `accepted`), `invitedBy` (wie du dazukamst: `uuid` und `name` des Einladenden (`null`, wenn sein Konto gelöscht ist oder einer den anderen blockiert hatte), `code`, `at`, `playedMs` (gezählte Summe), `confirmed` (Zeitpunkt oder `null`); oder `null`), `invited` (wer über dich dazukam: nur `at` und `confirmed`, nicht wer) und `unlocks` (`cosmetic`, `reason`, `at`), ab 1.12.0 `worlds`: `worlds` (eigene Welten mit `id`, `code`, `address` (ohne Welt-Domain `null`), `name`, `access`, `maxPlayers`, `defaultRole`, `createdAt`, `lastOnline`, `version` und `members` wie `Member` unter [Welt teilen](#welt-teilen)) und `memberOf` (Welten anderer, in denen du Mitglied bist: `world`, `name`, `host` (`uuid`, `name`), `as` (der Name auf der Liste), `role`, `added`). Ab 1.12.0 (Freunde 2.0): `profile` zusätzlich mit allen neuen Feldern von `Me` und `lastOnline` (genauer Zeitpunkt deiner letzten Trennung aus dem Spiel), `friends` je Freund zusätzlich `favorite`, `nickname`, `note` (deine Angaben, `null` = keine), `messages` je Nachricht zusätzlich `replyTo` (ID oder `null`) und `card` (Karte oder `null`), `reactions` (deine Reaktionen: `message`, `reaction`, `at`) und `communityBadge` (`{ "badge", "addedAt" }` oder `null`). Ab 1.14.0 dazu `partnerApplications` (eigene Anträge auf das Partner-Programm), `setups` (eigene Setups mit Inhalt) und `publicProfile` (Einstellungen des öffentlichen Profils oder `null`). Parties stehen nicht darin: Der Dienst speichert sie nicht. Höchstens 5 Exporte pro Stunde, sonst 429.

### Spieler nachschlagen (Tab-Liste, Namensschilder und Capes)

`POST /v1/players/lookup` mit `{ "uuids": ["…", …] }` (höchstens 200) → `{ "players": { "<uuid>": { "cape": "<id>" | "", "badge": <Abzeichen> | null, "cosmetics": { "head", "back", "aura", "companion" } } } }`

Die Antwort enthält nur Spieler, die gerade **aus dem Spiel** verbunden sind (offene WebSocket-Verbindung; Begleiter wie Webseite und Launcher zählen nicht) und `visible` an haben. Der Anfragende selbst gehört dazu, wenn das zutrifft (so erfährt das Spiel auch die eigene Rolle).

#### Abzeichen (`badge`)

`badge` wählt das Heldix-Symbol (ab Version 1.5.1, ab 1.12.0 mit neuen Werten). Hat ein Spieler mehrere, gilt die Reihenfolge **Team-Rolle vor Community-Abzeichen vor Addon-Entwickler**:

| Wert | Bezeichnung | Bedingung |
| --- | --- | --- |
| `admin` | Team-Admin | Team-Rolle, **nur mit öffentlichem Teamprofil** (`public`); ohne diese Zustimmung verrät die Antwort keine Rolle |
| `developer-team` (ab 1.12.0) | Entwickler (Team) | wie oben |
| `moderator` | Moderator | wie oben |
| `supporter` (ab 1.12.0) | Supporter | wie oben |
| `designer` (ab 1.12.0) | Designer | wie oben |
| `tester` (ab 1.12.0) | Tester | wie oben |
| `partner` (ab 1.12.0) | Partner | Community-Abzeichen, vom Team vergeben (siehe [Team-Bereich](#community-abzeichen)) |
| `creator` (ab 1.12.0) | Creator | wie oben |
| `ambassador` (ab 1.12.0) | Botschafter | wie oben |
| `developer` | Addon-Entwickler | mindestens ein sichtbares, veröffentlichtes Community-Addon im Store (dieselbe Bedingung wie für die Entwicklerseite); Addons des Teams zählen nicht |
| `null` | HeldixClient-Spieler | keine besondere Rolle |

- **Achtung:** `developer` heißt weiterhin „Addon-Entwickler“ (wie seit 1.5.1); die Team-Rolle „Entwickler“ ist `developer-team`. Die Werte der Team-Rollen sind dieselben wie `role` im Team-Bereich.
- **Ältere Clients** zeigen unbekannte Werte als normales Heldix-Symbol: Die Client-Mod bis 0.13.7 wählt in `Badge.Role.of` für alles Unbekannte `PLAYER` (blaues „H“), der Launcher zeigt bis 0.13.7 keine Abzeichen, und die Webseite zeigt unbekannte Rollen bis zu ihrer Erneuerung mit dem rohen Wert (z. B. „developer-team“ auf der Teamseite). Es geht also nichts kaputt, nur das neue Symbol fehlt.
- Dasselbe Abzeichen steht ab 1.12.0 in `Friend.badge` (Freundesliste, Profilkarte) und in `Me.badge`.

`cape` und `cosmetics` (ab Version 1.6.0, siehe [Cosmetics-Katalog](#cosmetics-katalog)):
- `cape` ist ein eingebautes Cape oder die ID eines Katalog-Capes, `""` = keins.
- `cosmetics` nennt je Slot die ID des gewählten Cosmetics oder `null`. Was hinter einer ID steckt (Modell, Textur), steht im Katalog (`GET /v1/cosmetics`).
- Ausgeblendete und gelöschte Cosmetics sind `null` (beim Cape `""`), ebenso Cosmetics nur fürs Team (`access: "team"`, ab Version 1.10.0 auch die eingebauten [Team-Capes](#eigenes-profil)), wenn der Spieler nicht (mehr) im Team ist, und ab 1.11.0 Cosmetics zum Freischalten (`access: "unlock"`), die der Spieler nicht freigeschaltet hat. Das gilt ab der nächsten Abfrage. Team und Freischaltungen fragt der Dienst gebündelt ab, nur für Spieler, die so etwas tragen.

**Wer was sieht:** Jeder angemeldete Spieler kann nachschlagen, bekommt aber nur Spieler, die online und erkennbar sind, und für sie nur Cape, Cosmetics und Rolle. Die Rolle steht ohnehin öffentlich auf der Teamseite bzw. der Entwicklerseite. Verbirgt ein Mitglied sein Teamprofil, verlässt es das Team oder wird ein Addon versteckt, gilt das ab der nächsten Abfrage. Das Spiel fragt höchstens einmal pro Sekunde, gebündelt für neue Spieler in der Tab-Liste und in der Nähe; bekannte HeldixClient-Spieler fragt es nach 30 Sekunden neu ab, andere nach 90 Sekunden.

### Freunde

`Friend` = `{ "uuid", "name", "online": bool, "launcher": bool, "state": "menu" | "singleplayer" | "multiplayer" | "realms" | "lan" | null, "server": "<domain>" | "<domain>:<port>" | null, "since": <ms>, "favorite": bool, "nickname": "<Text>" | null, "note": "<Text>" | null, "statusText": "<Text>" | null, "dnd": bool, "lastOnline": <ms> | null, "badge": <Abzeichen> | null }` (die Felder ab `favorite` ab 1.12.0, `launcher` ab 1.14.0)
- Hat der Freund `presence` aus, ist `online` immer `false` (auch `launcher`) und `state` und `server` sind `null`.
- `online` heißt **im Spiel** verbunden; Begleiter-Verbindungen (Webseite, Launcher) zählen nicht.
- `launcher` (ab 1.14.0): **„Im Launcher“** – nicht im Spiel, aber mit mindestens einer Launcher-Verbindung (`/v1/ws?client=launcher`, auch im Hintergrund); er bekommt Nachrichten also sofort. Die Webseite zählt nicht. Dann gilt auch `dnd`, und `lastOnline` ist `null`; „zuletzt online“ beginnt erst, wenn auch der letzte Launcher zu ist. Ändert sich `launcher`, bekommen verbundene Freunde `{ "type": "friend", … }` wie beim Wechsel online/offline. Ältere Clients ignorieren das Feld.
- `server` steht nur da, wenn er `showServer` an hat und `state` `multiplayer` ist. Der Port steht nur dabei, wenn er nicht 25565 ist (siehe `status` unter Echtzeit). Mitspieler einer geteilten Welt melden deren Adresse (`<code>.<Welt-Domain>`).
- `favorite`, `nickname` (0–24 Zeichen), `note` (0–200 Zeichen): **deine** Angaben zu diesem Freund; er sieht sie nie. Clients sortieren Favoriten oben (der Dienst sortiert nach Namen).
- `statusText`: Statustext des Freundes (auch offline). `dnd`: „Nicht stören“ (nur, solange er online oder im Launcher ist, sonst `false`).
- `lastOnline`: nur offline, mit `presence` und `showLastOnline` des Freundes, **gerundet** (abgerundet): vor weniger als 1 Stunde auf 5 Minuten, vor weniger als 1 Tag auf volle Stunden, sonst auf volle Tage (UTC). Sonst `null`. Clients zeigen „zuletzt online vor 5 Min./3 Std./2 Tagen“.
- `badge`: wie beim [Nachschlagen](#abzeichen-badge).

`Request` = `{ "uuid", "name", "at": <ms> }`

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/friends` | `{ "friends": [Friend], "incoming": [Request], "outgoing": [Request], "unread": { "<uuid>": <Anzahl> } }` |
| `POST /v1/friends/requests` mit `{ "name": "<Spielername>" }` | wie `GET /v1/friends` |
| `POST /v1/friends/requests/<uuid>/accept` | wie `GET /v1/friends` |
| `DELETE /v1/friends/requests/<uuid>` | wie `GET /v1/friends` (ablehnen oder eigene Anfrage zurückziehen) |
| `DELETE /v1/friends/<uuid>` | wie `GET /v1/friends`; die Unterhaltung wird für beide gelöscht (Favorit, Spitzname, Notiz auch); Party-Einladungen zwischen beiden fallen weg |
| `PATCH /v1/friends/<uuid>` (ab 1.12.0) mit Teil von `{ "favorite": bool, "nickname": "<0–24>" \| null, "note": "<0–200>" \| null }` | `{ "friend": Friend }` |
| `GET /v1/friends/<uuid>/profile` (ab 1.12.0) | `{ "friend": Friend, "mutual": [{ "uuid", "name" }], "cape": "<id>" \| "", "cosmetics": { "head", "back", "aura", "companion" } }` |
| `GET /v1/friends/suggestions` (ab 1.12.0) | `{ "enabled": bool, "suggestions": [{ "uuid", "name", "mutual": <Anzahl> }] }` |
| `POST /v1/friends/suggestions/<uuid>/request` (ab 1.12.0) | wie `GET /v1/friends` |

- `unread`: ungelesene Nachrichten pro Freund, nur Freunde mit mindestens einer (sonst `{}`).
- **Eigene Angaben (`PATCH`):** nur für Freunde (sonst 404 „Dieser Spieler ist nicht in deiner Freundesliste.“); `nickname`/`note` wie Nachrichten geprüft (eine Zeile, Leerzeichen am Rand fallen weg), `""` oder `null` löscht; zu lang oder Zeilenumbrüche: 400; `favorite` kein Wahrheitswert: 400. Danach bekommen nur deine eigenen Verbindungen `{ "type": "friend", "friend": Friend }`.
- **Profilkarte:** nur für Freunde (sonst 404). `mutual`: Freunde, die ihr beide habt, nach Namen. `cape`/`cosmetics` wie beim Nachschlagen, aber auch offline; mit `visible` aus des Freundes `""` bzw. alles `null`. Den Skin (für 3D) gibt es weiter unter `GET /v1/skins/<uuid>`.
- **Vorschläge:** Freunde deiner Freunde, die `suggestable` an haben, ohne dich selbst, deine Freunde, Spieler mit offener Anfrage (beide Richtungen) und Blockierte (beide Richtungen); meiste gemeinsame zuerst, dann Name, höchstens 20. Nur die Zahl gemeinsamer Freunde, nicht wer. Mit `showSuggestions` aus: `{ "enabled": false, "suggestions": [] }`. Anfrage über einen Vorschlag geht ohne Namen; ist er keiner (mehr): 404 „Diesen Vorschlag gibt es nicht (mehr).“ Sonst gelten die Regeln für Anfragen unten.

Regeln für Anfragen:
- **Name nicht gefunden:** Gesucht wird ohne Groß-/Kleinschreibung unter Spielern, die sich schon einmal angemeldet haben. Gibt es keinen Treffer: 404 „Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).“ Hat dich der Spieler blockiert, kommt genau dieselbe Antwort, damit die Blockierung verborgen bleibt.
- **Sonderfälle:** Für sich selbst gibt es 400. Für einen Spieler, der schon Freund ist, gibt es 409. Hast du den Spieler selbst blockiert: 409 „Du hast diesen Spieler blockiert. Gib ihn zuerst frei.“ Liegt schon eine Anfrage in die Gegenrichtung vor, werden beide sofort Freunde.
- **Grenzen:** Höchstens 200 Freunde und 50 offene ausgehende Anfragen, sonst 409.

### Party

Ab Version 1.12.0. Bis zu 8 Spieler (mit dem Leiter) spielen zusammen. Die Party lebt **nur im Arbeitsspeicher** des Dienstes (nach einem Neustart weg). Alle Routen: Bearer-Token oder Cookie (mit CSRF-Schutz).

`Location` = `{ "kind": "server" | "world", "target": "<Server-Adresse>" | "<Welt-Code>", "address": "<Adresse zum Beitreten>", "title": "<Server-Adresse>" | "<Name der Welt>" }`. Bei Welten ist `address` = `<code>.<Welt-Domain>`. Gleiche `address` heißt: am selben Ort.

`PartyMember` = `{ "uuid", "name", "leader": bool, "online": bool, "launcher": bool, "away": bool, "awayUntil": <ms> | null, "state": "menu" | … | null, "location": Location | null, "joined": <ms> }`
- `online`: im Spiel verbunden. `launcher` (ab 1.14.0): nicht im Spiel, aber im Launcher verbunden (wie `online` unabhängig von `presence`). `away`: gar keine Verbindung (weder Spiel noch Begleiter); nach `awayUntil` (10 Minuten Gnadenfrist) fliegt das Mitglied raus.
- `state` und `location` sehen Party-Mitglieder untereinander **unabhängig von `presence` und `showServer`** (Server nur als öffentliche Domain, sonst `null`). `location`: geöffnete eigene Welt (Gastgeber), sonst eine geteilte Welt (Status `multiplayer` mit Welt-Adresse) oder ein Server.

`Party` = `{ "id": "<32 hex>", "leader": "<uuid>", "created": <ms>, "max": 8, "members": [PartyMember] (in der Reihenfolge des Beitritts), "invites": [{ "uuid", "name", "by": "<uuid>", "at", "expires" }], "target": Location | null (Ort des Leiters), "voice": { "group": "<64 hex>", "server": "<address>" } | null }`. `voice` gilt **für den Empfänger**: nur gesetzt, wenn er an derselben `address` ist wie mindestens ein anderes Mitglied. `GET /v1/party` liefert zusätzlich `chat: [PartyChatMessage]` (die letzten 50).

`PartyInvite` = `{ "party": "<id>", "from": { "uuid", "name" }, "leader": { "uuid", "name" }, "members": <Anzahl>, "at", "expires", "quiet": bool }` (`quiet`: der Eingeladene hat „Nicht stören“ an – Hinweis still zeigen).

`PartyChatMessage` = `{ "id": <Zahl, je Party aufsteigend>, "from": "<uuid>", "name", "text", "at" }`

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/party` | – | `{ "party": Party (mit chat) \| null, "invites": [PartyInvite] }` |
| `POST /v1/party/invite` | `{ "uuid": "<Freund>" }` | `{ "party": Party }` |
| `DELETE /v1/party/invites/<uuid>` | – | `{ "party": Party \| null }` (Leiter zieht eine Einladung zurück) |
| `POST /v1/party/<id>/accept` | – | `{ "party": Party }` |
| `POST /v1/party/<id>/decline` | – | `{ "invites": [PartyInvite] }` |
| `POST /v1/party/leave` | – | `{ "party": null }` |
| `DELETE /v1/party/members/<uuid>` | – | `{ "party": Party \| null }` (Leiter entfernt ein Mitglied) |
| `POST /v1/party/leader` | `{ "uuid": "<Mitglied>" }` | `{ "party": Party }` (Leitung übergeben) |
| `POST /v1/party/chat` | `{ "text": "<1–500>" }` | `{ "message": PartyChatMessage }` |

- **Einladen:** nur Freunde (sonst 403 „In die Party einladen kannst du nur Freunde.“), nur der Leiter (sonst 403 „Einladen kann nur der Leiter der Party.“). Ohne Party entsteht eine mit dir als Leiter. Schon Mitglied: 409; voll (8): 409 „Die Party ist voll (höchstens 8).“; hat ein Mitglied den Eingeladenen blockiert oder umgekehrt: 409 „<Name> kann dieser Party gerade nicht beitreten.“; höchstens 16 offene Einladungen: 409. Sich selbst: 400, ungültige UUID: 400. Eine Einladung gilt 10 Minuten; erneutes Einladen verlängert sie, meldet sie dem Eingeladenen aber höchstens einmal pro Minute neu (`invite` sonst `null`).
- **Annehmen:** nur offene Einladungen, deren Einladender noch Mitglied und noch befreundet ist (sonst 404 „Diese Party-Einladung gibt es nicht (mehr).“); voll oder blockiert: 409. Wer schon in einer anderen Party ist, verlässt sie dabei.
- **Verlassen, entfernen, Leitung:** ohne Party 404 „Du bist in keiner Party.“; nur der Leiter entfernt (403 „Das darf nur der Leiter der Party.“), sich selbst entfernen: 400; kein Mitglied: 404. Geht der Leiter, übernimmt das Mitglied, das am längsten dabei ist. Bleibt nur einer ohne offene Einladung übrig (oder keiner), **löst sich die Party auf**.
- **Gnadenfrist:** Ohne jede Verbindung (Spiel, Launcher oder Webseite) bleibt ein Mitglied 10 Minuten in der Party (`away`), dann ist es raus. Wer über HTTP annimmt und keine Verbindung hat, ist sofort `away`.
- **Blockieren, Freundschaft beenden, Konto löschen/sperren:** Blockiert ein Mitglied ein anderes, fliegt der Blockierte aus der Party (`reason: removed`). Endet eine Freundschaft, gelten Einladungen zwischen beiden nicht mehr. Konto gelöscht oder gesperrt: raus aus Party und Einladungen.
- **Folgen:** Wechselt der Leiter den Ort (neuer Server, geteilte Welt geöffnet bzw. betreten), bekommen alle anderen Mitglieder, die nicht schon dort sind, `party-follow` (siehe Echtzeit). „Automatisch folgen“ entscheidet der Client (nur aus dem Menü, nie mitten aus einer Welt ohne Bestätigung).
- **Geteilte Welt:** Party-Mitglieder des Gastgebers dürfen in seine geöffnete Welt wie Mitglieder der Welt (auch bei Zugang „eingeladen“, solange sie nicht voll ist; Blockieren gilt weiter). So klappt das Folgen ohne Anklopfen.
- **Party-Voice:** `voice.group` ist ein Prüfwert wie bei Gruppen im Voice Chat (`join` mit `group`); Clients treten damit der Gruppe bei, solange sie keine eigene Gruppe gesetzt haben (eigene Gruppe hat Vorrang). Der Dienst bildet ihn als HMAC-SHA256 aus Party-ID und einem Zähler mit einem Schlüssel, der nur im Arbeitsspeicher liegt; geht oder fliegt jemand, ändert er sich (Ehemalige hören nicht mehr mit). Wird `voice` `null`, verlassen Clients die Party-Gruppe.
- **Party-Chat:** Regeln wie bei Nachrichten (1–500 Zeichen, eine Zeile), gemeinsame Grenze mit Direktnachrichten (20 pro Minute), nur im Arbeitsspeicher, die letzten 50.

### Einladungen

Ab Version 1.11.0. Ein angemeldeter Spieler erzeugt einen Link, mit dem Freunde HeldixClient holen und ihn als Freund hinzufügen, auf Wunsch mit Server („Komm auf meinen Server“) und mit Voice-Gruppe („Sprich im Browser mit uns“, siehe [Voice im Browser](#voice-im-browser)). Wer neu dazukommt, bekommt eine Willkommens-Belohnung; der Einladende bekommt Belohnungen, sobald seine Eingeladenen eine Weile gespielt haben.

- **Code:** 10 Zeichen aus `abcdefghjkmnpqrstuvwxyz23456789` (ohne i, l, o, 0 und 1), also `^[a-hjkmnp-z2-9]{10}$`, gleich verteilt zufällig. Falsch geformte, unbekannte und abgelaufene Codes ergeben 404 „Diese Einladung gibt es nicht (mehr). Vielleicht ist sie abgelaufen oder wurde zurückgezogen.“
- **Links:** Web-Link `<HELDIX_DIENST_WEBSITE>/einladung#<code>` (im Fragment, damit der Code in keinem Log eines Webservers steht; ohne Webseite `null`) und Launcher-Link `heldixclient://einladung/<code>`.

`Invite` = `{ "code", "url": "<Web-Link>" | null, "appUrl": "heldixclient://einladung/<code>", "created": <ms>, "expires": <ms>, "server": "<domain>" | "<domain>:<port>" | null, "voice": bool, "accepted": <Anzahl> }`. `voice` sagt nur, ob die Einladung eine Voice-Gruppe hat; den Prüfwert gibt der Dienst nicht zurück. `accepted` zählt, wie oft die Einladung zu einer neuen Freundschaft oder einem neuen Spieler geführt hat.

Angemeldet (Bearer-Token oder Cookie mit CSRF-Schutz):

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `POST /v1/invites` | `{ "server"?: "<Adresse>" \| null, "voice"?: { "group": "<64 Hex-Zeichen>" } \| null }` | `Invite` |
| `GET /v1/invites` | – | `{ "link": Invite, "invites": [Invite], "invited": n, "confirmed": n, "pending": n, "rewards": [{ "cosmetic", "friends", "unlocked": bool }], "unlocked": ["<id>"] }` |
| `DELETE /v1/invites/<code>` | – | `{ "ok": true }` |
| `POST /v1/invites/<code>/accept` | – | `{ "inviter": { "uuid", "name" }, "server", "friend": "new" \| "already" \| "blocked" \| "limit", "reward": "freundesfunken" \| null, "rewardReason": null \| "not-new" \| "already-invited" }` |

- **Anlegen:** `server` prüft der Dienst wie beim Online-Status (nur öffentliche Domains, ein Port außer 25565 bleibt; sonst 400). `voice` geht nur zusammen mit `server` (sonst 400) und nur, wenn der Voice Chat an ist (sonst 503); `group` ist der Prüfwert der Gruppe wie bei `join` im Voice Chat (das Spiel kennt Name und Passwort, der Dienst nie). Hat der Spieler schon eine offene Einladung mit genau diesem Server und dieser Gruppe, die noch mindestens die halbe Laufzeit gilt, kommt sie zurück statt einer neuen. So legen Launcher und Spiel (z. B. für den Discord-Status) nicht bei jeder Änderung neue an.
- **Ablauf:** ohne Voice 30 Tage, mit Voice 24 Stunden. Abgelaufene Einladungen gelten nicht mehr und werden beim regelmäßigen Aufräumen (alle 10 Minuten) gelöscht.
- **Grenzen:** höchstens 20 neue Einladungen pro Spieler und Tag (429 mit `Retry-After`; wiederverwendete und der allgemeine Link aus `GET` zählen nicht) und höchstens 50 offene je Spieler: Darüber fallen die ältesten ohne Annahmen weg (haben alle Annahmen, die ältesten); ihre Gäste trennt der Dienst wie beim Widerruf.
- **Übersicht** (`GET`): `link` ist die allgemeine Einladung ohne Server (bei Bedarf neu angelegt, sonst wiederverwendet wie oben), `invites` alle offenen, neueste zuerst (`link` steht auch darin). `invited` zählt Spieler, die über deine Links neu dazugekommen sind, `confirmed` die davon bestätigten, `pending` die übrigen. `rewards` sind die Belohnungsstufen (unten) mit `unlocked`; `unlocked` nennt alle deine Freischaltungen.
- **Widerrufen** (`DELETE`): nur eigene, sonst 404. Gäste dieser Einladung fliegen sofort aus dem Voice Chat (4004); angemeldete Teilnehmer im Browser, die über sie in der Gruppe sind, bekommen `invite: invalid` (4006). Spieler im Spiel bleiben in ihrer Gruppe.
- **Annehmen:** Die eigene Einladung ergibt 400 `{ "error": "Das ist deine eigene Einladung. Schick den Link an Freunde, die HeldixClient noch nicht haben.", "code": "SELF", "friend": "self", "reward": null, "rewardReason": "self" }`. Sonst stellt der Dienst die Freundschaft her wie beim Annehmen einer Anfrage (offene Anfragen zwischen beiden fallen weg, beide bekommen über Echtzeit ihre neue Freundesliste): `friend` ist `new`, `already` (schon befreundet), `blocked` (einer hat den anderen blockiert: keine Freundschaft) oder `limit` (einer von beiden hat schon 200 Freunde: keine Freundschaft). Noch einmal annehmen schadet nicht.
- **Willkommens-Belohnung:** Neu ist, wessen Konto beim Dienst höchstens 14 Tage alt ist (erste Anmeldung, `createdAt`) und wer noch nie über eine Einladung dazugekommen ist. Neue bekommen sofort `freundesfunken` (`reward`), unabhängig von `friend`, und zählen ab dann für den Einladenden; bei `blocked` zählen sie für niemanden, und der Einladende erfährt nichts. Sonst ist `reward` `null` und `rewardReason` `not-new` oder `already-invited`: Bestehende Spieler können Einladungen annehmen, bekommen aber nur die Freundschaft.
- **Bestätigt** ist ein neuer Spieler, sobald er insgesamt 30 Minuten im Spiel war: mit offener Verbindung zu `/v1/ws` und gemeldetem Status (`status` mit `state`, also Hauptmenü, Welt oder Server mit HeldixClient); Zeit nur im Launcher zählt nicht. Gezählt wird erst ab dem Annehmen und nur für Eingeladene mit offener Bestätigung. Gespeichert wird nur die Summe (beim Verlassen des Spiels, beim regelmäßigen Aufräumen und beim Herunterfahren); nach der Bestätigung zählt der Dienst nicht mehr.
- **Belohnungsstufen** (`INVITE_REWARDS` und `WELCOME_REWARD` in [service/src/invites.ts](../service/src/invites.ts)):

  | Stufe | Cosmetic | Slot | Bedingung |
  | --- | --- | --- | --- |
  | Willkommen / 1 | `freundesfunken` | aura | Eingeladener: sofort beim Annehmen (wenn neu). Einladender: ab 1 bestätigten Freund |
  | 2 | `freundesband` | cape | Einladender: ab 3 bestätigten Freunden |

  Beide sind Katalog-Cosmetics mit `access: "unlock"` (siehe [Cosmetics-Katalog](#cosmetics-katalog)). Freigeschaltet und gespeichert wird auch, wenn es das Cosmetic im Katalog (noch) nicht gibt; sobald das Team es veröffentlicht, ist es wählbar.
- **Echtzeit:** Bei jeder Freischaltung bekommt der Spieler `{ "type": "unlock", "cosmetic": "<id>", "reason": "invite" }` (ab 1.14.0 bei Belohnungen eines Partner-Servers `{ "type": "unlock", "cosmetic", "reason": "partner", "partner": "<Name des Partners>" }`); der Einladende `{ "type": "invite", "event": "accepted", "name": "<Name>" }`, wenn über seinen Link eine neue Freundschaft oder ein neuer Spieler entsteht, und `{ "type": "invite", "event": "confirmed", "name": "<Name>" }` bei der Bestätigung (siehe [Echtzeit](#echtzeit-websocket)). Der Launcher hat keine Verbindung zu `/v1/ws` und sieht Freischaltungen über `GET /v1/invites` bzw. `unlocked` in `GET /v1/me/cosmetics`.

Öffentlich (ohne Anmeldung, `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`):

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/public/invites/<code>` | `{ "code", "inviter": { "uuid", "name" }, "server": "<domain>" \| null, "voice": null \| { "members": n, "guests": n, "maxGuests": 4 }, "expires": <ms>, "welcome": "freundesfunken" }`. Unbekannt oder abgelaufen: 404. Höchstens 60 pro Minute und IP, sonst 429 |
| `POST /v1/public/invites/<code>/guest` mit `{ "name" }` | `{ "token", "id", "name", "expires" }`, siehe [Voice im Browser](#voice-im-browser). Höchstens 5 in 10 Minuten und IP, sonst 429 |

- `voice` gibt es nur bei Einladungen mit Voice-Gruppe und eingeschaltetem Voice Chat: `members` sind die Mitglieder der Gruppe ohne Gäste (im Spiel oder angemeldet im Browser), `guests` die gerade verbundenen Gäste dieser Einladung.

### Nachrichten

`Message` = `{ "id": <Zahl>, "from": "<uuid>", "to": "<uuid>", "text": "…", "at": <ms>, "read": bool, "replyTo": { "id", "from": "<uuid>" | null, "text": "<bis 100 Zeichen>…" | null } | null, "card": Card | null, "reactions": { "<uuid>": "<Reaktion>" } }` (`replyTo`, `card`, `reactions` ab 1.12.0)
- `id` steigt mit jeder neuen Nachricht.
- `read` gilt aus Sicht des Abrufenden: Nachrichten des Freundes sind `true`, sobald man sie als gelesen markiert hat. Eigene Nachrichten sind immer `true`, denn ob der Freund sie gelesen hat, verrät der Dienst nicht (keine Lesebestätigung).
- `replyTo`: Antwort auf diese Nachricht, mit den ersten 100 Zeichen ihres Textes (länger: mit „…“). Ist sie gelöscht (oder schon abgelaufen), sind `from` und `text` `null`.
- `card` (Beitreten-Karte) = `{ "kind": "server" | "world" | "invite", "target": "<Server-Adresse>" | "<Welt-Code>" | "<Einladungs-Code>", "title": "<0–60>" }`. Clients zeigen „Beitreten“ (Server: Quick Play Multiplayer; Welt: `<code>.<Welt-Domain>` bzw. `/v1/public/worlds/<code>`; Einladung: `heldixclient://einladung/<code>` bzw. `/einladung#<code>`). `text` bleibt Pflicht und ist der Rückfall für ältere Clients (z. B. „Komm auf mc.example.de“).
- `reactions`: je Person höchstens eine Reaktion, als ID: `like` 👍, `love` ❤️, `laugh` 😂, `wow` 😮, `sad` 😢, `party` 🎉, `fire` 🔥, `eyes` 👀 (`REACTIONS` in [service/src/messages.ts](../service/src/messages.ts)). Clients ohne Emoji (z. B. im Spiel) zeigen ein eigenes Zeichen je ID.

`Conversation` = `{ "uuid", "name", "last": Message, "unread": <Anzahl> }` mit UUID und Namen des Freundes, der neuesten Nachricht und der Zahl seiner ungelesenen Nachrichten an dich.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/messages` | – | `{ "conversations": [Conversation] }`: ein Eintrag pro Freund mit mindestens einer Nachricht, neueste Unterhaltung zuerst |
| `GET /v1/messages/<uuid>?before=<id>&limit=<n>` | – | `{ "messages": [Message], "more": bool }` |
| `POST /v1/messages/<uuid>` | `{ "text": "…", "replyTo"?: <id> \| null, "card"?: Card \| null }` | `{ "message": Message }` |
| `POST /v1/messages/<uuid>/read` | – | `{ "ok": true }` |
| `DELETE /v1/messages/<uuid>/<id>` (ab 1.12.0) | – | `{ "ok": true }` (eigene Nachricht für beide löschen) |
| `PUT /v1/messages/<uuid>/<id>/reaction` (ab 1.12.0) | `{ "reaction": "like" \| … }` | `{ "message": Message }` |
| `DELETE /v1/messages/<uuid>/<id>/reaction` (ab 1.12.0) | – | `{ "message": Message }` |
| `POST /v1/messages/<uuid>/typing` (ab 1.12.0) | – | `{ "ok": true }` („schreibt …“ für Clients ohne WebSocket) |

- **Verlauf:** die neuesten `limit` Nachrichten (Standard 50, erlaubt 1 bis 100) mit einer `id` kleiner als `before` (ohne `before`: ab der neuesten), älteste zuerst. `more` heißt: Es gibt ältere. Für die nächste Seite `before` auf die `id` der ersten Nachricht setzen. Ungültige Werte ergeben 400. Ist der Spieler kein Freund: 404 „Dieser Spieler ist nicht in deiner Freundesliste.“ (ebenso bei `read`).
- **Senden:** nur an Freunde, sonst 403 „Nachrichten gehen nur an Freunde.“ Hat der Freund `messages` aus: 403 „<Name> nimmt gerade keine Nachrichten an.“
- **Text:** Leerzeichen am Anfang und Ende fallen weg, danach 1 bis 500 Zeichen (gezählt werden Unicode-Zeichen, ein Emoji zählt einmal). Nicht erlaubt sind Steuerzeichen (auch Zeilenumbrüche und Tabs), Zeilen- und Absatztrenner und Steuerzeichen für die Schreibrichtung (400). Der Text ist reiner Text: Der Client zeigt ihn ohne Formatierung an und wertet auch `§`-Codes nicht aus.
- **Gelesen:** `read` markiert alle Nachrichten des Freundes an dich als gelesen. Das erfahren nur deine eigenen Verbindungen (siehe `read` unter Echtzeit), nie der Absender.
- **Grenzen und Aufbewahrung:** höchstens 20 Nachrichten pro Minute und Spieler, sonst 429 „Zu viele Nachrichten. Warte kurz.“ Pro Unterhaltung bleiben die letzten 500 Nachrichten, ältere löscht der Dienst. Nach 30 Tagen löscht er jede Nachricht. Endet die Freundschaft, ist die Unterhaltung für beide gelöscht.
- **Antworten (ab 1.12.0):** `replyTo` muss eine Nachricht derselben Unterhaltung sein (beide Richtungen), sonst 400 „Auf diese Nachricht kannst du nicht antworten (sie gehört nicht zu dieser Unterhaltung).“
- **Karten:** `server` wie beim Online-Status geprüft (nur öffentliche Domains; ein Port außer 25565 bleibt, sonst 400), `world` 6 Zeichen `^[a-hjkmnp-z2-9]{6}$` (klein geschrieben gespeichert), `invite` 10 Zeichen `^[a-hjkmnp-z2-9]{10}$`; `title` 0–60 Zeichen, eine Zeile. Ob es Welt oder Einladung gibt, prüft der Dienst nicht (das zeigt der Client beim Beitreten). Ungültig: 400.
- **Reaktionen:** nur auf Nachrichten der eigenen Unterhaltung (sonst 404 „Diese Nachricht gibt es nicht (mehr).“), unbekannte Reaktion 400. Setzen ersetzt die eigene, `DELETE` nimmt sie zurück. Beide Seiten bekommen `reaction` (siehe Echtzeit). Zählt zur Grenze von 20 Nachrichten pro Minute.
- **Löschen:** nur eigene Nachrichten (fremde 403 „Du kannst nur deine eigenen Nachrichten löschen.“, unbekannt oder andere Unterhaltung 404). Die Nachricht ist für beide weg, mit ihren Reaktionen; Antworten darauf behalten nur die ID. Beide Seiten bekommen `message-deleted`. Ältere Clients sehen sie bis zum nächsten Laden noch.
- **„schreibt …“:** per Echtzeit `{ "type": "typing", "to": "<uuid>" }` oder `POST …/typing`; der Freund bekommt `{ "type": "typing", "from": "<uuid>" }`. Nur an Freunde, die Nachrichten annehmen (sonst still ignoriert; HTTP an Nicht-Freunde: 404), höchstens einmal je 3 Sekunden und Paar weitergegeben, nie gespeichert. Clients schicken es höchstens alle 3 Sekunden beim Tippen und blenden die Anzeige 6 Sekunden nach dem letzten `typing` oder bei der nächsten Nachricht aus.

### Blockieren

`Blocked` = `{ "uuid", "name", "at": <ms> }`

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/blocks` | – | `{ "blocked": [Blocked] }`, neueste zuerst |
| `POST /v1/blocks` | `{ "uuid": "…" }` oder `{ "name": "<Spielername>" }` | wie `GET /v1/blocks` |
| `DELETE /v1/blocks/<uuid>` | – | wie `GET /v1/blocks` (wieder freigeben) |

- Blockieren beendet die Freundschaft und löscht offene Anfragen in beide Richtungen und die Unterhaltung. Hat sich dadurch etwas geändert, bekommen beide Seiten, falls verbunden, sofort eine neue `friends`-Nachricht. Ab 1.12.0 fliegt der Blockierte aus einer gemeinsamen [Party](#party), und Party-Einladungen zwischen beiden fallen weg.
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
- **Art** (ab 1.13.0): Meldungen haben `kind`: `chat` (diese hier) oder `voice` (aus dem Voice Chat, siehe [Voice-Moderation](#voice-moderation)); `GET /v1/reports/mine`, die Liste im Team-Bereich und die Datenauskunft nennen sie. Die Grenzen oben gelten nur für `chat`, Voice-Meldungen haben eigene.

### Launcher-Updates

Der Launcher aktualisiert sich über den Dienst, und die Download-Seite der Webseite bietet alle Dateien vom Dienst an (Windows-Installer und Mac-Dateien). Signieren und Prüfen der Updates (Windows und, ab 1.13.0, Mac) übernimmt der Launcher; der Dienst liefert nur Dateien aus, die der Betreiber in den Update-Ordner gelegt hat (siehe [Launcher-Update veröffentlichen](#launcher-update-veröffentlichen)). Diese Wege brauchen keine Anmeldung und antworten immer mit `Access-Control-Allow-Origin: *`, auch bei Fehlern, damit auch die Webseite sie abfragen kann.

| Anfrage | Antwort |
| --- | --- |
| `GET /v1/launcher/latest` | Inhalt von `update.json`: `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }`, mit `Cache-Control: no-cache` |
| `GET /v1/launcher/latest/mac` (ab 1.13.0) | Inhalt von `update-mac.json`: `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }`, mit `Cache-Control: no-cache`; nichts veröffentlicht: 404 „Noch keine Mac-Version veröffentlicht.“ |
| `GET`, `HEAD /v1/launcher/download/latest` | 302 mit `Location: /v1/launcher/download/<file aus dem Manifest>` (Windows-Installer) |
| `GET`, `HEAD /v1/launcher/download/latest/<ziel>` | 302 auf die neueste Datei für `windows`, `mac-arm64` oder `mac-x64`; nichts da: 404 „Für dieses System gibt es noch keinen Download.“ |
| `GET`, `HEAD /v1/launcher/download/<file>` | die Datei (Windows-Installer oder Mac-Datei); `?einladung=<code>` nur für den Namen des Windows-Installers (siehe unten) |
| `GET /v1/launcher/files` | `{ "version": "<Version aus dem Manifest>" \| null, "mac": "<Mac-Version>" \| null, "files": [ { "file", "platform": "windows" \| "mac", "arch": "x64" \| "arm64", "kind": "exe" \| "dmg" \| "zip", "version", "size", "sha256": "<hex>", "uploadedAt": <ms> } ] }`, `Cache-Control: max-age=60` |

- `manifest` ist genau der Text aus `update.json` (darüber läuft die Signatur) und ergibt `{ "v": 1, "version": "0.12.0", "file": "HeldixClient-Setup-0.12.0.exe", "size": <Byte>, "sha512": "<Base64>", "date": "JJJJ-MM-TT", "notes": ["…"] }`.
- **Prüfung beim Ausliefern:** Die Signatur prüft hier der Launcher. Der Dienst prüft nur die Form: beide Texte vorhanden, `manifest` ist ein JSON-Objekt mit `v` gleich 1, Text `version`, `file` nach dem Namensmuster unten und ganzzahligem `size`. Außerdem muss `file` im Update-Ordner liegen und genau `size` Byte groß sein; sonst ist der Upload noch nicht fertig. Fehlt etwas: 404 „Noch keine Version veröffentlicht.“ und ein Eintrag im Log. Ändert sich `update.json`, liest der Dienst sie beim nächsten Abruf neu, ohne Neustart.
- **Mac-Updates** (ab 1.13.0, `latest/mac`): `update-mac.json` im Update-Ordner (erzeugt mit `npm run release:mac` im Launcher) hat dieselbe Hülle; `manifest` ergibt `{ "v": 2, "platform": "mac", "version": "0.14.0", "date": "<ISO>", "notes": ["…"], "files": { "arm64": { "file": "HeldixClient-0.14.0-mac-arm64.zip", "size": <Byte>, "sha512": "<Base64>" }, "x64": { … } } }` und ist mit demselben Update-Schlüssel signiert wie `update.json`. Der Dienst prüft die Form wie der Launcher: `v` gleich 2, `platform` gleich `mac`, gültige Version, für **beide** Prozessoren eine ZIP namens `HeldixClient-<version>-mac-<arm64|x64>.zip` mit `size` (1 Byte bis 1 GiB) und `sha512` (64 Byte als Base64). Sie gilt erst, wenn beide ZIPs vollständig im Update-Ordner liegen (Größe wie im Manifest); sonst 404 „Noch keine Mac-Version veröffentlicht.“ und ein Eintrag im Log („Upload noch nicht fertig?“). Die ZIPs lädt der Launcher wie den Installer über `/v1/launcher/download/<file>`. Die ZIPs der gerade veröffentlichten Mac-Version lassen sich im Team-Bereich weder ersetzen noch löschen (409), wie der Installer aus `update.json`.
- **Dateinamen** (`<version>` wie `0.12.1`, auf Wunsch mit Zusatz wie `-beta.1`):

  | System | Datei | Beispiel |
  | --- | --- | --- |
  | Windows | `HeldixClient-Setup-<version>.exe` (steht im signierten Manifest) | `HeldixClient-Setup-0.12.1.exe` |
  | macOS Apple Silicon | `HeldixClient-<version>-mac-arm64.dmg` und `.zip` | `HeldixClient-0.12.1-mac-arm64.dmg` |
  | macOS Intel | `HeldixClient-<version>-mac-x64.dmg` und `.zip` | `HeldixClient-0.12.1-mac-x64.zip` |

  Nur solche Dateien direkt im Update-Ordner liefert der Dienst aus. Andere Namen (auch `.part`, andere Prozessoren oder Endungen), Unterordner und symbolische Links nach außerhalb ergeben 404.
- **Neueste Datei je System** (`latest/<ziel>`): `windows` ist der Installer aus dem Manifest (sobald er vollständig da ist); `mac-arm64` und `mac-x64` sind die höchste Version unter den vorhandenen `.dmg` dieses Prozessors (Vergleich wie im Launcher: `1.10.0` > `1.2.0`, `1.2.0` > `1.2.0-beta.1`). Die Weiterleitung hat `Cache-Control: no-cache`. Ein unbekanntes Ziel ergibt ebenfalls 404.
- **Dateiliste** (`files`, für die Download-Seite): je System, Prozessor und Art nur die neueste Version, sortiert Windows, Mac Apple Silicon (dmg, zip), Mac Intel (dmg, zip). Für Windows steht dort der veröffentlichte Installer aus dem Manifest (hochgeladene, noch nicht veröffentlichte Installer nicht); `version` ist die Version aus dem Manifest. Ist `update-mac.json` veröffentlicht, stehen dort als ZIPs genau die aus diesem Manifest, und `mac` ist seine Version; sonst sind es die höchsten ZIPs nach Dateinamen und `mac` ist die höchste Version unter den angebotenen Mac-Dateien (`null` ohne Mac-Dateien). Die DMGs sind immer die höchste Version nach Dateinamen. `sha256` berechnet der Dienst einmal (gestreamt, bei Uploads im Team-Bereich schon beim Hochladen) und merkt sie sich, solange Name, Größe und Änderungszeit gleich bleiben.
- **Download:** mit `Content-Length`, `Content-Type` (exe: `application/vnd.microsoft.portable-executable`, dmg: `application/x-apple-diskimage`, zip: `application/zip`), `Content-Disposition: attachment; filename="<file>"`, `Accept-Ranges: bytes`, `ETag` und `Last-Modified`. Ein Bereich per `Range: bytes=a-b`, `bytes=a-` oder `bytes=-n` ergibt 206 mit `Content-Range`, ein Bereich außerhalb der Datei 416. Mehrere Bereiche oder ungültige Angaben ergeben die ganze Datei (200). `If-Range` mit ETag oder Datum wird beachtet. Höchstens 30 Downloads pro Minute und IP, sonst 429.
- **Einladung im Download** (ab 1.11.0, Parameter `einladung`): `GET`/`HEAD /v1/launcher/download/<file>?einladung=<code>` liefert für den Windows-Installer dieselbe Datei mit `Content-Disposition: attachment; filename="HeldixClient-Setup-<version>-einladung-<code>.exe"`; der Installer liest den Code aus seinem Namen und legt ihn für den Launcher ab, der danach die Einladung öffnet. Alles andere (Inhalt, Größe, `Content-Type`, `ETag`, `Last-Modified`, `Cache-Control`, Range) bleibt gleich. Die Weiterleitungen `latest` und `latest/windows` reichen `?einladung=<code>` an die Datei weiter (die Webseite verlinkt `latest/windows?einladung=<code>`), `latest/mac-*` nicht. Gültig ist nur ein Code wie bei den [Einladungen](#einladungen) (`^[a-hjkmnp-z2-9]{10}$`); alles andere wird still ignoriert (normaler Name), Mac-Dateien behalten immer ihren Namen. Der Dienst prüft nicht, ob die Einladung existiert, speichert den Code nicht und schreibt ihn in kein Log (protokolliert wird bei Fehlern nur der Pfad ohne Abfrage).
- Die Datei wird gestreamt, auch ein langsamer Download läuft also bis zum Ende. Kommt 2 Minuten lang gar nichts beim Client an, trennt der Dienst die Verbindung.
- Veröffentlichen geht per `scp` (siehe [Betrieb](#launcher-update-veröffentlichen)) oder als Admin im [Team-Bereich](#team-bereich); dort prüft der Dienst zusätzlich die Signatur.

**Versionsverlauf:** `GET /v1/launcher/versions?limit=<1–50, Standard 20>` → `{ "versions": [ { "version", "date", "notes": ["…"], "publishedAt": <ms> } ] }`, neueste zuerst, `Cache-Control: max-age=60`. Der Launcher zeigt damit nach einem Update „Was ist neu in <Version>“.
- Der Dienst merkt sich jede veröffentlichte Version genau einmal (`version` ist eindeutig): nach dem Veröffentlichen im Team-Bereich und, bei `scp`, sobald er die neue `update.json` einliest und der Installer vollständig da ist (beim nächsten Abruf von `latest`, `versions` oder `status`). Mac-Versionen aus `update-mac.json` zählen genauso (sobald beide ZIPs da sind; beim nächsten Abruf von `latest/mac`, `versions` oder `files`); dieselbe Version für Windows und Mac steht nur einmal drin. `date` und `notes` (höchstens 30) kommen aus dem Manifest, `publishedAt` ist der Zeitpunkt, zu dem der Dienst die Version zuerst gesehen hat.

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
| `GET /v1/cosmetics` | `{ "cosmetics": [ { "id", "slot", "format", "version", "name", "description", "access": "all" \| "team" \| "unlock" \| "partner", "partner"?, "partnerName"?, "sha256", "size", "date" } ] }`: alle sichtbaren, nach Slot (head, back, aura, companion, cape), dann nach Name; `format` (ab 1.12.0) ist `1` oder `2` ([Format 2](#format-2-mesh-mit-keyframe-animationen)); `Cache-Control: public, max-age=60` und `ETag` (mit passendem `If-None-Match`: 304 ohne Körper) |
| `GET /v1/cosmetics/<id>` (auf Wunsch `?v=<sha256>`) | der Umschlag der aktuellen Version: `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }` mit `ETag: "<sha256>"` (passendes `If-None-Match`: 304). Ist `v` der aktuelle `sha256`: `Cache-Control: public, max-age=31536000, immutable`, sonst `public, no-cache`. Unbekannt oder ausgeblendet: 404 „Dieses Cosmetic gibt es nicht.“ Höchstens 300 pro Minute und IP, sonst 429 |

- `sha256` (Hex) und `size` (Byte) gelten genau für die Antwort von `GET /v1/cosmetics/<id>`: Der Dienst liefert den Umschlag immer als `{"manifest":…,"signature":…}` ohne Leerzeichen. Clients laden den Katalog, vergleichen `sha256` mit ihrem Zwischenspeicher und holen nur neue oder geänderte Umschläge, am besten mit `?v=<sha256>`. Auch Cosmetics mit `access: "team"` und `access: "unlock"` stehen im Katalog, damit alle sie an ihren Trägern sehen.
- **Belohnungen von Partner-Servern** (ab 1.14.0): `access: "partner"` mit `partner` (ID des Partners) und `partnerName` (Clients zeigen „Belohnung auf <partnerName>“). Im signierten Manifest steht dabei `access: "unlock"` – getragen wird es also wie jede Belohnung nur mit Freischaltung, auch von älteren Clients. Die Zuordnung zum Partner legt das Team im Team-Bereich fest (`PUT /v1/team/cosmetics/<id>/partner`), freigeschaltet wird über das Server-Plugin des Partners (`POST /v1/partner/rewards`, siehe [Server-Partner](#server-partner-und-partner-schnittstelle)). Ohne Freischaltung: 403 `{ "error": "Dieses Cosmetic bekommst du als Belohnung auf <Name>.", "code": "LOCKED" }`.
- Vorschaubilder liefert der Dienst nicht; die Clients zeichnen sie selbst aus Modell und Textur.

**Wählen** (Bearer-Token oder Cookie mit CSRF-Schutz):

`MyCosmetics` = `{ "head", "back", "aura", "companion", "cape", "team", "unlocked" }`: je Slot die ID oder `null` (nichts); `team` (true/false) sagt, ob du Team-Cosmetics (`access: team`) und die eingebauten Team-Capes (ab Version 1.10.0) wählen darfst – Launcher und Spiel kennen die Rolle sonst nicht. `unlocked` (ab 1.11.0) nennt die IDs, die du freigeschaltet hast (`access: unlock`, Belohnungen für [Einladungen](#einladungen)), auch solche, die es im Katalog noch nicht gibt.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/me/cosmetics` | – | `MyCosmetics`: was du gerade trägst |
| `PUT /v1/me/cosmetics` | `{ "slot": "head" \| "back" \| "aura" \| "companion" \| "cape", "id": "<id>" \| null }` | `MyCosmetics` |

- `id: null` (oder `""`) legt ab. Sonst muss es das Cosmetic geben und es muss sichtbar sein (sonst 404 „Dieses Cosmetic gibt es nicht.“), es muss zum Slot passen (sonst 400), bei `access: "team"` musst du im Team sein (jede Rolle; sonst 403 „Dieses Cosmetic gibt es nur für das HeldixClient-Team.“), und bei `access: "unlock"` musst du es freigeschaltet haben (auch im Team; sonst 403 `{ "error": "Dieses Cosmetic schaltest du frei, indem du Freunde zu HeldixClient einlädst.", "code": "LOCKED" }`, ebenso für ein solches Cape über `PUT /v1/me`). Unbekannter Slot, `id` fehlt oder ist weder Text noch `null`: 400. Es gilt die allgemeine Grenze (120 pro Minute).
- Der Slot `cape` ist dasselbe wie `cape` in `PUT /v1/me`: eingebaute Capes (`HELDIX_DIENST_CAPES`) und Katalog-Capes. Die eingebauten [Team-Capes](#eigenes-profil) `matrix_rot`, `matrix_tuerkis` und `sakura_orange` (ab Version 1.10.0) gelten dabei wie `access: "team"` (403 außerhalb des Teams); ein eingebautes Cape, das nicht in `HELDIX_DIENST_CAPES` steht, ist hier wie bisher unbekannt (404).
- **Gespeichert und sichtbar:** Gespeichert wird die gewählte ID je Slot. Ist ein Cosmetic ausgeblendet, nur fürs Team und du bist nicht mehr im Team, oder zum Freischalten und du hast es nicht freigeschaltet, zeigen `GET /v1/me/cosmetics` und das Nachschlagen dort `null` (beim Cape `""` in `Me` und beim Nachschlagen). Die Auswahl bleibt aber gespeichert und gilt wieder, sobald das Cosmetic wieder sichtbar ist bzw. du wieder im Team bist. Löscht das Team ein Cosmetic, setzt der Dienst die Auswahl aller Träger zurück.

**Paket: signierter Umschlag.** `npm run cosmetic -- <id>` (im Ordner `launcher`) schreibt `<id>-<version>.cosmetic.json` = `{ "manifest": "<JSON-Text>", "signature": "<Base64>" }`. Die Signatur ist Ed25519 über die UTF-8-Bytes von `"heldix-cosmetic\n" + manifest` (Domänentrennung: Ein Addon-Manifest oder ein Launcher-Update ist nie als Cosmetic gültig und umgekehrt). `signature` ist kanonisches Standard-Base64 von 64 Byte (88 Zeichen, endet auf `==`). Größe (1 KB = 1024 Byte; Manifest in UTF-8, ohne einzelne Ersatzzeichen; Umschlag so wie ausgeliefert): Format 1 höchstens 160 KB Manifest und 192 KB Umschlag, Format 2 (ab 1.12.0) höchstens 512 KB und 544 KB. Die Form des Umschlags prüft zuerst die größte Grenze (512 KB / 544 KB), die des Formats kommt beim Lesen des Manifests dazu (Fehler z. B. „„manifest“ ist zu groß (höchstens 160 KB bei Format 1)“).

**Manifest** (Format 1): ein JSON-Objekt, alle Felder Pflicht außer den freiwilligen. Format 1 kennt keine Zusatzfelder: Ein unbekanntes Feld, auch in Unterobjekten, ist ein Fehler. Texte gelten genau wie signiert (gezählt werden Unicode-Zeichen); nicht erlaubt sind Steuerzeichen (auch Zeilenumbrüche), Zeilen- und Absatztrenner und Steuerzeichen für die Schreibrichtung. „Zahl“ heißt jede JSON-Zahl, „ganze Zahl“ eine ohne Nachkommastellen; alle Bereiche schließen die Grenzen ein.

| Feld | Regel |
| --- | --- |
| `type` | genau `"heldix-cosmetic"` |
| `format` | genau `1` |
| `id` | `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$` (1–32 Zeichen, kein `-` am Anfang oder Ende), keine ID eines eingebauten Capes (`heldix`, `mitternacht`, `aurora`, `glut`, `kristall`, `neon`, `sakura`, `gewitter`, `galaxie`, `matrix`, `matrix_rot`, `matrix_tuerkis`, `sakura_orange`) |
| `version` | ganze Zahl 1–2147483647; beim Veröffentlichen höher als die vorhandene |
| `slot` | `head`, `back`, `aura`, `companion` oder `cape` |
| `name` | 1–40 Zeichen, eine Zeile, nicht nur Leerzeichen |
| `description` | 0–300 Zeichen, eine Zeile |
| `access` | `all`, `team` (nur Team-Mitglieder dürfen es wählen) oder ab 1.11.0 `unlock` (nur wer es freigeschaltet hat, z. B. über [Einladungen](#einladungen)) |
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
- **Größe der Textur:** `head`, `back`, `companion` und `aura`: Breite und Höhe je 8–512 Pixel, jeweils ein Vielfaches von 8 (z. B. 512 × 256 für eine Vorlage von 128 × 64 in vierfacher Auflösung; `glow` genauso groß). Bei `aura` zusätzlich Breite = Höhe × `particles.frames` (quadratische Bilder nebeneinander). `cape`: 64, 128 oder 256 Pixel breit, jedes Einzelbild halb so hoch wie breit (Vorlage eines Minecraft-Capes, 64 × 32, in einfacher, doppelter oder vierfacher Auflösung), alle `cape.frames` Bilder untereinander; Höhe also Breite / 2 × `cape.frames` (z. B. 128 × 1536 bei 24 Bildern). Die Grenzen von 64 KB je PNG und 160 KB fürs Manifest gelten auch hier: Wer das Cape baut, wählt die Auflösung, die hineinpasst.
- **Modell** (`model`, Einheiten in Pixeln = 1/16 Block): `{ "textureSize": [Breite, Höhe], "scale" (freiwillig), "bones": [Bone] }`. `textureSize` ist die Größe der Textur in Texeln (der Raum, in dem `uv` und Box-UV zählen): genau die Größe des PNG oder, bei doppelter bzw. vierfacher Auflösung, die Hälfte bzw. ein Viertel davon in beiden Richtungen (z. B. `[128, 64]` für ein PNG mit 512 × 256). Gezeichnet wird mit UV / `textureSize`, also unabhängig von der Auflösung.
  - `scale` (freiwillig): Zahl 0.25–1.5 (fehlt: 1). Skaliert das ganze Modell gleichmäßig um den Anker (Ursprung 0, 0, 0), über den Bone-Matrizen: Ecke = S(`scale`) · Bone-Matrix · Punkt. Pivots, Würfel, `bob` und die Grenze von 48 Pixeln gelten vor der Skalierung; der Anker bleibt, wo er ist. Beim Begleiter multipliziert es sich mit `companion.scale`.
  - `Bone` = `{ "name", "parent" (freiwillig), "pivot": [x, y, z], "rotation" (freiwillig): [x, y, z], "cubes": [Würfel] }`: 1–64 Bones; `name` `^[a-z0-9_]{1,24}$` und eindeutig; `parent` ist der Name eines Bones, der **vorher** in der Liste steht (so gibt es keine Zyklen); `pivot` je -48 bis 48; `rotation` in Grad je -180 bis 180 (fehlt: 0, 0, 0). `cubes` darf leer sein (Bone nur als Gelenk).
  - `Würfel` = `{ "origin": [x, y, z], "size": [w, h, d], "uv": [u, v], "inflate" (freiwillig), "mirror" (freiwillig) }`: `origin` je -48 bis 48; jede Kante 0–32, mindestens eine größer als 0; `uv` ganze Zahlen ab 0; `inflate` 0–2 (fehlt: 0); `mirror` true oder false (fehlt: false). Der Würfel samt `inflate` liegt in jeder Achse in [-48, 48] (`origin − inflate ≥ −48` und `origin + size + inflate ≤ 48`, ohne Drehung gerechnet): So reicht das Modell höchstens 48 Pixel vom Anker.
  - **Box-UV** wie bei Minecraft und Blockbench („box UV“): Ein Würfel (w, h, d) belegt ab `uv` die Fläche (2d + 2w) × (d + h) Texel; sie muss in die Textur passen (`u + 2d + 2w ≤ Breite`, `v + d + h ≤ Höhe`, Breite und Höhe aus `textureSize`). `mirror` spiegelt horizontal.
  - Insgesamt 1–128 Würfel.
  - Anker (Ursprung, +Y oben, +Z vorn = Blickrichtung, wie Blockbench für Entities): `head` Mitte der Kopf-Oberseite, `back` Mitte des Rückens auf Schulterhöhe (z = −2 ist die Rückenfläche), `companion` Mitte der Unterseite des Begleiters.
- **Animationen** (`animations`): je `{ "bone", "type", "axis", "amplitude", "speed", "phase" (freiwillig) }`. `bone` ist ein Bone des Modells; `type` ist `flap` (Sinus-Schwingung der Drehung, Flügel), `sway` (langsames Pendeln der Drehung), `spin` (dauerhafte Drehung, `speed` = Umdrehungen pro Sekunde, `amplitude` darf fehlen und zählt nicht) oder `bob` (Auf und Ab der Position); `axis` `x`, `y` oder `z`; `amplitude` 0–90 Grad, bei `bob` 0–8 Pixel; `speed` 0–4 Schwingungen pro Sekunde; `phase` 0–1 (fehlt: 0).
- **Partikel** (`particles`): `{ "frames": 1–8, "rate": 1–20, "lifetime": 5–80, "size": 0.03–0.4, "motion", "radius": 0.2–1.5, "color": "#rrggbb", "fullbright" (freiwillig) }`. `frames`, `rate` (pro Sekunde) und `lifetime` (Ticks) sind ganze Zahlen, `size` und `radius` Blöcke; `motion` ist `rise`, `fall`, `orbit`, `spark` oder `float`; `color` die Tönung (Hex, groß oder klein); `fullbright` true oder false (fehlt: false).
- **Fehler** nennen das Feld mit Pfad, z. B. „Ungültiges Cosmetic-Manifest: „model.bones[1].cubes[0].uv“: Die UV-Fläche (32 × 10 ab 40, 0) passt nicht in die Textur (64 × 32).“ Gemeldet wird der erste Fehler.
- **Nachträglich erweitert** (weiter Format 1, nur dazugekommen): `model.scale`, bis 64 statt 32 Bones, Texturen bis 512 statt 256 Pixel und Modell-Texturen in doppelter oder vierfacher Auflösung von `textureSize`. Ältere Clients lehnen ein Cosmetic, das davon Gebrauch macht, einzeln ab und lassen es weg; der Rest des Katalogs bleibt nutzbar. Ab 1.11.0 genauso `access: "unlock"`: Launcher und Spiel bis 0.13.6 prüfen jeden Umschlag einzeln (Fehler „„access“ muss eins von all, team sein“), verwerfen nur diesen Eintrag und zeigen ihn auch an anderen Spielern nicht; `format` bleibt 1.

#### Format 2: Mesh mit Keyframe-Animationen

Ab Dienst 1.12.0 und HeldixClient 0.13.8, für die Slots `head`, `back`, `aura` und `companion` (nicht `cape`). Statt Würfeln ein Dreiecks-Mesh an Knochen, Keyframe-Animationen je Knochen, Zustände (welche Animation wann läuft), Partikel an Knochen und ein animierter Leucht-Streifen. Format 1 bleibt unverändert gültig. Gleiche Regeln wie oben für Kopf und Texte (`type`, `id`, `version`, `name`, `description`, `access`, `date`); auch Format 2 kennt keine Zusatzfelder. Zahlenlisten stehen als **Base64 kleiner Ganzzahlen** (little-endian) im Manifest; die Länge muss genau zur Anzahl passen. Koordinaten in Pixeln im **Body-Modellraum** von Minecraft: Ursprung am Hals-Pivot des Rumpfs, +X links des Trägers, +Y nach unten, +Z nach hinten (anders als die Anker von Format 1).

| Feld | Regel |
| --- | --- |
| `format` | genau `2` |
| `slot` | `head`, `back`, `aura` oder `companion` |
| `texture` | PNG als data-URL wie bei Format 1, höchstens 64 KB; Breite und Höhe je eine Zweierpotenz von 16 bis 512 |
| `glow` und `emissive` (freiwillig, nur zusammen) | `glow`: Leucht-Streifen als PNG-data-URL (höchstens 64 KB), so breit wie `texture` und `texture`-Höhe × `emissive.frames` hoch (Bilder untereinander, Bild 0 oben). `emissive` = `{ "frames": 1–16, "frametimeTicks": 1–20, "pulse": { "period": 0.1–20, "min": 0–1, "max": 0–1 } }` (ganze Zahlen außer `pulse`; `min` ≤ `max`) |
| `bones` | 1–96 Knochen `{ "name", "parent", "pivot": [x, y, z], "tail": [x, y, z] }`: `name` 1–32 Zeichen aus A–Z, a–z, 0–9, `_`, `.` und `-`, eindeutig; `parent` −1 oder der Index eines Knochens **davor**; `pivot`, `tail` je −1024 bis 1024 |
| `mesh` | `{ "vertexCount": N, "triangleCount": T, "positions", "normals", "uvs", "bones", "triangles", "joints" (freiwillig), "weights" (freiwillig) }`, N und T je 1–16384, siehe unten |
| `animations` | Objekt mit 1–16 Animationen, Name `^[A-Za-z0-9_]{1,24}$` → `{ "fps": 1–60, "frames": 1–1200, "loop": true \| false, "tracks": [Spur] }` (ganze Zahlen) |
| `states` | `{ "idle": "<Animation>", …, "blendSeconds": 0–1 }`: `idle` und `blendSeconds` Pflicht; weitere Schlüssel `walk`, `sneak`, `sit_or_ride`, `swim`, `sprint`, `elytra`, `jump`, `fall`, `creative_fly`, `start_flying`, `land`, `hurt`, `emote`, `celebrate`, `afk`, `sleep`, `enable`, `disable`, `summon`; jeder Wert eine vorhandene Animation |
| `particles` (freiwillig) | höchstens 16 `{ "bone", "at": "pivot" \| "tail", "particle", "perSecond": 0.1–20, "color" (freiwillig), "states" (freiwillig) }`, siehe unten |
| `attach` (freiwillig) | nur bei `companion`: `{ "origin": [x, y, z] (je −64 bis 64, fehlt: 0, 0, 0), "side": "left" \| "right" (fehlt: left) }` |

- **Mesh:** `positions` Int16 × 3N (1/32 Pixel), `normals` Int8 × 3N (× 127, flach je Fläche), `uvs` Uint16 × 2N (÷ 65535, v = 0 oben), `bones` Uint8 × N (Knochen-Index < Anzahl der Knochen, ein Knochen je Vertex), `triangles` Uint16 × 3T (Vertex-Index < N). **Weiche Haut** (freiwillig, z. B. Membranen): `joints` Uint8 × 4N (vier Knochen je Vertex) und `weights` Uint8 × 4N (÷ 255, Summe je Vertex genau 255, unbenutzte Plätze Gewicht 0), nur beide zusammen; `bones` nennt dann den Knochen mit dem größten Gewicht (starrer Ersatz für einfache Renderer).
- **Spur** = `{ "bone", "rot" (freiwillig), "move" (freiwillig), "scale" (freiwillig) }`, mindestens eins davon, höchstens eine Spur je Knochen und Animation; `tracks: []` ist eine Standpose. Jeder Kanal ist `{ "keys", "values" }`: `keys` Uint16 (Frame-Nummern, mindestens eine, die erste 0, streng aufsteigend, jede < `frames`); `values` bei `rot` Int16 × 4 je Key (x, y, z, w × 32767, Länge 0,99–1,01), bei `move` Int16 × 3 je Key (1/32 Pixel), bei `scale` Uint16 je Key (÷ 1000, gleichmäßig um den Pivot).
- **Partikel:** `bone` ist ein Knochen-Index, `at` der Pivot bzw. das Ende (`tail`) des Knochens nach seiner Matrix im aktuellen Frame. `particle` ist eine Minecraft-ID mit oder ohne `minecraft:`: `flame`, `small_flame`, `soul_fire_flame`, `smoke`, `end_rod`, `electric_spark`, `dust`, `heart`, `note`, `happy_villager`, `cloud`, `poof`, `snowflake`, `spore_blossom_air`, `crit`, `enchant`, `portal`, `witch`, `glow`, `falling_water`, `dripping_water`, `firework`, `cherry_leaves`, `ash`, `white_ash`, `soul`, `sculk_soul`, `lava`, `falling_spore_blossom`, `wax_on`, `wax_off`, `bubble_pop`, `composter`, `totem_of_undying`, `reverse_portal`. `color` (`#rrggbb`) gibt es nur bei `dust`; `states` ist eine Liste von 1–16 Animationen (ohne Angabe immer).
- **Auswertung:** Zeit `t = Ticks / 20 × fps` in Frames; `loop` → modulo `frames`, sonst am letzten Frame halten. Zwischen zwei Keys Quaternion-slerp (kürzerer Weg), `move` und `scale` linear; vor dem ersten und nach dem letzten Key gilt der Randwert. Knochen: `W_b = W_eltern · T(move) · T(pivot) · R · S(scale) · T(−pivot)`; Vertex `v' = W_bone · v` (bei weicher Haut `Σ wᵢ · W_jointᵢ · v`), Normalen mit dem 3×3-Anteil. Zustandswechsel überblenden je Knochen über `blendSeconds`; einmalige Animationen (`loop: false`) laufen zu Ende und kehren dann zum Zustand zurück.
- **Anbringen:** `back`, `head` und `companion` im Body-Raum (nach `body.translateAndRotate`, dann `scale(1/16)`); beim Begleiter zählen Positionen, `pivot` und `tail` relativ zu `attach.origin` (der Renderer verschiebt zuerst um `origin`), `side: "right"` spiegelt alles an x = 0 des Body-Raums. `aura` hängt am Spieler selbst: gleiche Pixel-Koordinaten (Füße bei y = 24), aber nur Position und Körperdrehung (kein Mitkippen beim Schleichen).
- **Leuchten:** Bild `⌊Ticks / frametimeTicks⌋ mod frames`, `v_glow = (v + Bild) / frames`, Stärke `min + (max − min) · (0,5 + 0,5 · sin(2π · t / period))` mit t in Sekunden; additiv und voll hell über der Albedo.
- **Ältere Clients** (Launcher, Spiel und Webseite bis 0.13.7 bzw. Dienst 1.11.0) kennen nur Format 1: Sie laden einen Umschlag über 192 KB gar nicht erst (Launcher: Antwort zu groß; Spiel: Eintrag mit `size` über 192 KB übersprungen), sonst scheitert die Prüfung an „„format“ muss 1 sein“. In beiden Fällen fällt nur dieser Eintrag weg (Launcher und Spiel schreiben eine Zeile ins Log, die alte Webseite meldet „… Cosmetics zeigt die Seite nicht“); der Rest des Katalogs bleibt nutzbar, und an anderen Spielern erscheint dort nichts.
- **Werkzeuge:** Prüfer und Dekodier-Hilfen (`decodeCosmeticMesh`, `decodeCosmeticTrack`, `encode…`/`decode…` für die Ganzzahl-Listen) in [service/src/cosmetics-format.ts](../service/src/cosmetics-format.ts); Blender-Exporte wandelt `npm run blender-import` (im Ordner `launcher`) um, siehe [Entwicklung](entwicklung.md#cosmetics-aus-blender-übernehmen-format-2).

Die Routen für das Team (`/v1/team/cosmetics…`, nur Admins) stehen beim [Team-Bereich](#team-bereich), das Veröffentlichen unter [Cosmetic veröffentlichen](#cosmetic-veröffentlichen).

### Webseite: Anmeldung und Sitzungen

Kein Passwort auf der Webseite. Zwei Wege führen zum selben Einmal-Code: Der Launcher (oder das Heldix-Menü im Spiel) ist schon beim Dienst angemeldet, holt einen Einmal-Link und öffnet ihn im Browser. Oder der Spieler meldet sich auf der Webseite direkt mit seinem Minecraft-Konto bei Microsoft an (ab 1.7.0, siehe [unten](#webseite-anmeldung-mit-dem-minecraft-konto)).

| Anfrage | Anmeldung | Inhalt | Antwort |
| --- | --- | --- | --- |
| `POST /v1/web/link` | Bearer | – oder `{ "target": "profil" \| "freunde" \| "nachrichten" \| "privatsphaere" \| "daten" \| "support" \| "team" \| "welten" \| "plus" }` | `{ "url": "<Webseite>/konto#code=<code>", "expiresAt": <ms> }`, mit `target`: `…#code=<code>&ziel=<target>` |
| `POST /v1/web/session` | – | `{ "code": "…" }` | setzt das Cookie, Antwort `WebMe` |
| `GET /v1/web/config` | – | – | `{ "microsoftLogin": bool }`: ob es die Anmeldung mit dem Minecraft-Konto gibt (die Webseite zeigt nur dann den Knopf) |
| `GET /v1/web/auth/microsoft[?ziel=<ziel>]` | – | – | 303 zu Microsoft, setzt das Bindungs-Cookie; nicht eingerichtet: 503 (HTML-Seite) |
| `GET /v1/web/auth/microsoft/callback?code=…&state=…` | – | – | 303 zu `<Webseite>/konto#code=<code>[&ziel=<ziel>]` oder `<Webseite>/konto#fehler=<fehler>[&ziel=<ziel>]`; nicht eingerichtet: 503 |
| `GET /v1/web/me` | Cookie | – | `WebMe` |
| `POST /v1/web/logout` | Cookie | – | `{ "ok": true }`, Cookie gelöscht |
| `GET /v1/web/sessions` | Cookie | – | `{ "sessions": [ { "id", "createdAt", "lastUsedAt", "current": bool, "device" } ] }`, zuletzt benutzte zuerst |
| `DELETE /v1/web/sessions/<id>` | Cookie | – | wie `GET`; die eigene Sitzung löschen heißt abmelden (Cookie gelöscht) |

`WebMe` = `Me` plus `{ "role": null | "moderator" | "admin", "twoFactor": { "enabled": bool, "verified": bool }, "expiresAt": <ms> }`. `verified`: In dieser Sitzung wurde in den letzten 12 Stunden ein 2FA-Code eingegeben. `expiresAt`: Ende der Sitzung (30 Tage ab Anmeldung, höchstens 7 Tage nach der letzten Nutzung).

- **Ziel:** Mit `target` öffnet die Konto-Seite nach der Anmeldung diesen Reiter, bei `team` die Seite `/team`. Ab 1.13.0 auch `welten` (Reiter „Meine Welten“) und `plus`: Die Webseite leitet nach dem Einlösen auf `/plus` weiter (wie bei `team`; der Link führt trotzdem zu `/konto#code=…&ziel=plus`, weil nur die Konto-Seite den Code einlöst). Ein anderer Wert: 400. Ohne Körper (oder mit `target: null`) wie bisher.
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

- **Ziel:** `ziel` nur aus `uebersicht`, `profil`, `freunde`, `nachrichten`, `privatsphaere`, `sicherheit`, `daten`, `support`, `addons`, `team`, ab 1.13.0 auch `welten` und `plus` (die Webseite öffnet den Bereich, bei `team` die Seite `/team`, bei `plus` die Seite `/plus`). Alles andere, auch Adressen, fällt still weg; dann geht es nach `/konto`. Der Dienst leitet nur auf die eigene Webseite (`HELDIX_DIENST_WEBSITE`) weiter.
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

Rollen (ab 1.12.0, in der Reihenfolge ihres Rangs): `admin` (Team-Admin), `developer-team` (Entwickler), `moderator`, `supporter`, `designer`, `tester`. Bis 1.11 gab es nur `moderator` und `admin`; beide bleiben bei der Aktualisierung, wie sie sind (Schema 11 ändert nichts daran). Eine unbekannte Rolle in der Datenbank (z. B. aus einer neueren Version) gilt als `tester`. Den ersten Admin legt der Betreiber auf dem Server an (`heldix-dienst-admin team <name> admin`, siehe [Verwaltung](#verwaltung-meldungen-sperren-und-team)).

**Zugang zu `/v1/team/*`:** nur mit Cookie (ohne Cookie: 401, auch mit Bearer-Token), mit Team-Rolle (jede der sechs), eingerichteter Zwei-Faktor-Anmeldung (für **alle** Rollen) und in dieser Sitzung bestätigtem Code (höchstens 12 Stunden alt), dazu dem **Recht der Route** (siehe unten). Sonst 403 mit `"code"`:

| `code` | Bedeutung |
| --- | --- |
| `forbidden` | keine Team-Rolle, oder der Rolle fehlt das Recht der Route („Dafür fehlt deiner Rolle das Recht „…“.“) |
| `2fa_setup_required` | Zwei-Faktor-Anmeldung noch nicht eingerichtet |
| `2fa_required` | Code in dieser Sitzung noch nicht (oder vor mehr als 12 Stunden) eingegeben |

Geprüft wird in dieser Reihenfolge: Rolle vorhanden, 2FA eingerichtet, Code bestätigt, Recht der Route.

**Zwei-Faktor-Anmeldung** (TOTP nach RFC 6238: SHA-1, 6 Ziffern, 30 Sekunden, ±1 Schritt Toleranz), mit Cookie:

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `POST /v1/web/2fa/setup` | – | `{ "secret": "<Base32, 32 Zeichen>", "uri": "otpauth://totp/HeldixClient:<name>?secret=…&issuer=HeldixClient&algorithm=SHA1&digits=6&period=30" }` |
| `POST /v1/web/2fa/enable` | `{ "code": "123456" }` | `WebMe` (2FA aktiv, Sitzung bestätigt) |
| `POST /v1/web/2fa/verify` | `{ "code": "123456" }` | `WebMe` (Sitzung 12 Stunden bestätigt) |

- `setup` nur für Team-Mitglieder (sonst 403 `forbidden`) ohne aktive 2FA (sonst 409); ein neuer Aufruf ersetzt das vorläufige Geheimnis. `enable` ohne vorheriges `setup`: 409. `verify` ohne eingerichtete 2FA: 403 `2fa_setup_required`.
- Der Code darf Leerzeichen enthalten („123 456“); keine 6 Ziffern: 400. Falscher Code: 401 „Der Code stimmt nicht.“ Jeder Zeitschritt gilt nur einmal, derselbe Code ein zweites Mal ist falsch. Höchstens 5 Versuche pro 10 Minuten und Spieler, sonst 429.
- Zurücksetzen: Admin im Team-Bereich oder `heldix-dienst-admin team-2fa-reset <name>`. Danach gilt keine Sitzung des Mitglieds mehr als bestätigt.

#### Rechte je Rolle

Ab 1.12.0 hat jede Team-Route ein **Recht** statt einer Mindestrolle; welche Rolle welches Recht hat, steht in `ROLE_PERMISSIONS` in [service/src/roles.ts](../service/src/roles.ts) (und so in `GET /v1/team/permissions`):

| Recht (`permission`) | Bedeutung | admin | developer-team | moderator | supporter | designer | tester |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `team.manage` | Team verwalten: Mitglieder aufnehmen, Rollen ändern, entfernen, 2FA zurücksetzen; Community-Abzeichen vergeben und entziehen | ✓ | | | | | |
| `players.delete` | Spieler-Daten löschen (wie `DELETE /v1/me`) | ✓ | | | | | |
| `updates` | Updates: Launcher hochladen, veröffentlichen, Dateien löschen | ✓ | ✓ | | | | |
| `addons` | Addons: offizielle veröffentlichen, ausblenden, löschen; Einreichungen ansehen, ablehnen, freigeben (signieren) | ✓ | ✓ | | | | |
| `addon-reports` | Meldungen zu Addons | ✓ | ✓ | ✓ | | | |
| `cosmetics` | Cosmetics: hochladen, ausblenden, löschen | ✓ | ✓ | | | ✓ | |
| `news` | Neuigkeiten | ✓ | ✓ | ✓ | | | |
| `moderation` | Meldungen, Sperren, Cape zurücksetzen | ✓ | | ✓ | | | |
| `players` | Spieler suchen und ansehen | ✓ | ✓ | ✓ | ✓ | | |
| `support` | Support-Anfragen | ✓ | | ✓ | ✓ | | |
| `audit` | Protokoll ansehen | ✓ | ✓ | ✓ | | | |
| `team.view` | Team-Übersicht ansehen (Mitglieder, vergebene Community-Abzeichen) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `hosting:manage` (ab 1.13.0) | Dauerhafte Welten: Übersicht (RAM/CPU, Plätze), anhalten, Grenzen ändern | ✓ | ✓ | | | | |
| `hosting:grant` (ab 1.13.0) | Freischaltungen „Beta: Dauerhafte Welten“ und Heldix+-Warteliste | ✓ | | | | | |
| `discover:moderate` (ab 1.13.0) | Entdecken: Meldungen, ausblenden, Besitzer fürs Verzeichnis sperren | ✓ | | ✓ | ✓ | | |
| `voice:moderate` (ab 1.13.0) | Voice-Moderation: Voice-Meldungen (mit Aufnahmen abspielen und löschen) bearbeiten, Voice-Sperren setzen und aufheben, Spieler-Zeitleiste, Liste „Voice aus“ und Voice-Regeln ansehen | ✓ | | ✓ | ✓ | | |
| `voice:admin` (ab 1.13.0) | Voice-Regeln veröffentlichen und zurückziehen, Aufnahmen beim Melden an/aus, Liste „Voice aus“ ändern | ✓ | | | | | |
| `partners:manage` (ab 1.14.0) | Partner-Server verwalten: Anträge, Partner anlegen, ändern, pausieren, löschen, Partner-Schlüssel erzeugen, Belohnungs-Cosmetics zuordnen | ✓ | ✓ | | | | |
| (keins) | eigenes Teamprofil, Rechte-Übersicht, Kennzahlen (`/v1/team/me/profile`, `/v1/team/permissions`, `/v1/team/dashboard`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- **Änderungen gegenüber 1.11:** Moderatoren dürfen jetzt Capes zurücksetzen, das Team ansehen und das Protokoll lesen, aber **keine Addon-Einreichungen mehr** ansehen oder ablehnen (das ist jetzt „Addons“: Admin und Entwickler; Meldungen zu Addons bleiben). Entwickler (neu) dürfen Updates, Addons (auch Einreichungen freigeben) und Cosmetics veröffentlichen. `players.delete` ist eine Ergänzung zur Tabelle der Vorgabe (bisher Admin, bleibt Admin).
- **Letzter Admin:** Mindestens ein `admin` muss bleiben (Herabstufen, Entfernen, als Spieler löschen: 409).
- **Tester** haben nur das Abzeichen und die Team-Übersicht (später ggf. Vorab-Versionen). Team-Capes und Cosmetics mit `access: "team"` gelten für jede Rolle.
- **`WebMe`** (`GET /v1/web/me`) hat ab 1.12.0 zusätzlich `permissions: ["<Recht>", …]` (leer ohne Team-Rolle) und `communityBadge` (`partner` | `creator` | `ambassador` | `null`), damit die Webseite Navigation und Seiten nach Rechten zeigt.

#### Community-Abzeichen

`partner` (Partner), `creator` (Creator), `ambassador` (Botschafter): keine Team-Rechte, höchstens eines je Spieler, vergeben vom Team mit `team.manage`. Sie erscheinen beim Nachschlagen nach einer (öffentlichen) Team-Rolle und vor „Addon-Entwickler“ (siehe [Abzeichen](#abzeichen-badge)). Ein Spieler kann es nicht selbst ausblenden (außer mit „Für andere erkennbar“ aus).

**Routen** (Recht in Klammern; ohne Angabe: jedes Team-Mitglied)

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/team/me/profile` | – | `{ "public": bool, "title": "", "about": "" }` (eigenes Teamprofil, jede Rolle) |
| `PUT /v1/team/me/profile` | Teil davon | wie `GET` |
| `GET /v1/team/permissions` (ab 1.12.0) | – | `{ "roles": [{ "id", "label", "permissions": ["<Recht>"] }], "permissions": [{ "id", "label" }], "badges": [{ "id", "label" }], "mine": { "role", "permissions" } }` (Rechte-Übersicht, Reihenfolge wie oben) |
| `GET /v1/team/dashboard` (ab 1.12.0) | – | `{ "online", "voice", "worlds": n \| null, "reports": n \| null, "support": n \| null, "submissions": n \| null, "addonReports": n \| null, "recent": [{ "id", "at", "actor": { "uuid", "name" }, "action", "target" }] \| null }` (Kennzahlen; ohne das Recht des Bereichs `null`: reports = offene Meldungen (moderation), support = Anfragen, die auf das Team warten (support), submissions = wartende Einreichungen (addons), addonReports = offene Meldungen zu Addons (addon-reports), recent = letzte 10 Protokoll-Einträge (audit); online/voice/worlds wie `/v1/status`, genau, ohne Schwelle) |
| `GET /v1/team/support?status=open\|answered\|closed\|all` (support) | – | `{ "tickets": [Ticket ohne messages] }`, neueste Aktivität zuerst; ohne `status`: `open` |
| `GET /v1/team/support/<id>` (support) | – | `{ "ticket": Ticket }` |
| `GET /v1/team/support/<id>/attachments/<aid>` (support) | – | der Anhang als Datei (wie für den Spieler) |
| `POST /v1/team/support/<id>/messages` (support) | `{ "text" }` | `{ "ticket": Ticket }` |
| `POST /v1/team/support/<id>/close` (support) | – | `{ "ticket": Ticket }` |
| `GET /v1/team/reports?status=open\|done\|all` (moderation) | – | `{ "reports": [Report] }`, neueste zuerst; ohne `status`: `open` |
| `POST /v1/team/reports/<id>/done` (moderation) | – | `{ "report": Report }` (schon erledigt: unverändert) |
| `GET /v1/team/bans` (moderation) | – | `{ "bans": [ { "uuid", "name", "reason", "at", "by": "<name>" \| null } ] }`, neueste zuerst |
| `POST /v1/team/bans` (moderation) | `{ "uuid" \| "name", "reason": "<1–300 Zeichen>" }` | wie `GET` |
| `DELETE /v1/team/bans/<uuid>` (moderation) | – | wie `GET` |
| `GET /v1/team/players?q=<Namensanfang oder UUID>` (players) | – | `{ "players": [ { "uuid", "name", "lastSeen", "online", "banned", "role", "communityBadge" } ] }`, höchstens 50 (`communityBadge` ab 1.12.0) |
| `GET /v1/team/players/<uuid>` (players) | – | Spieler (siehe unten), ohne Nachrichteninhalte |
| `POST /v1/team/players/<uuid>/reset-cape` (moderation) | – | Spieler wie `GET` |
| `DELETE /v1/team/players/<uuid>` (players.delete) | – | `{ "deleted": true }` |
| `GET /v1/team/news` (news) | – | `{ "news": [News] }`, alle, auch Entwürfe |
| `POST /v1/team/news` (news) | `{ "title": "<1–120>", "text": "<1–5000, Zeilenumbrüche erlaubt>", "published": bool }` | `{ "news": News }` |
| `PUT /v1/team/news/<id>` (news) | Teil davon | `{ "news": News }` |
| `DELETE /v1/team/news/<id>` (news) | – | `{ "deleted": true }` |
| `GET /v1/team/updates` (updates) | – | `{ "current": <Manifest-Objekt> \| null, "mac": <Mac-Manifest-Objekt aus update-mac.json> \| null, "files": [ { "file", "platform", "arch", "kind", "version", "size", "uploadedAt" } ] }`, alle Dateien, zuletzt hochgeladene zuerst |
| `PUT /v1/team/updates/files/<file>` (updates) | roher Inhalt (`application/octet-stream`, gestreamt, höchstens 1 GiB) | `{ "file", "size", "sha512": "<base64>" }` |
| `PUT /v1/team/updates/manifest` (updates) | Inhalt von `update.json` oder (ab 1.13.0) `update-mac.json` (`{ "manifest", "signature" }`; Mac erkannt an `"platform": "mac"` bzw. `"v": 2` im Manifest) | `update.json`: `{ "current": <Manifest-Objekt> }`; `update-mac.json`: `{ "mac": <Mac-Manifest-Objekt> }`. Geprüft werden Form, Signatur, Größe und SHA-512 der Datei(en) (bei Mac beider ZIPs) und dass die Version höher ist als die bisherige (bei Mac: als die bisherige Mac-Version); dann wird die Datei atomar ersetzt. Protokoll: `update.publish` mit Installer bzw. `update-mac.json` und „Mac-Version <version>: <ZIPs>“ |
| `DELETE /v1/team/updates/files/<file>` (updates) | – | wie `GET /v1/team/updates` |
| `GET /v1/team/addons` (addons) | – | `{ "addons": [ { "id", "name", "hidden", "downloads", "latest": "<Version>", "versions": [ { "version", "file", "size", "sha256", "date", "notes", "api", "access", "minecraft", "loaders", "publishedAt", "publishedBy": "<Spielername>" } ], "official": bool, "owner": { "uuid", "name" } | null, "screenshots": <Anzahl>, "access", "minecraft", "loaders" } ], "pending": [ { "file", "size", "uploadedAt" } ], "keyConfigured": bool, "publicKey": "<PEM>" | null, "pendingSubmissions": <Anzahl>, "openReports": <Anzahl> }`, alle Addons (auch versteckte) nach Name, Versionen neueste zuerst. `owner`: Einreicher (`null` = offiziell; gelöschtes Konto: `{ "uuid": null, "name": "Gelöschter Spieler" }`); `publicKey`: der öffentliche Update-Schlüssel, damit die Seite eine gewählte Schlüsseldatei vor dem Signieren prüfen kann |
| `PUT /v1/team/addons/files/<file>` (addons) | roher Inhalt der JAR (`application/octet-stream`, gestreamt, höchstens 50 MiB) | `{ "file", "size", "sha256": "<hex>" }` |
| `DELETE /v1/team/addons/files/<file>` (addons) | – | wie `GET /v1/team/addons` |
| `PUT /v1/team/addons/manifest` (addons) | Inhalt der `.addon.json` (`{ "manifest", "signature" }`, höchstens 256 KB) | wie `GET /v1/team/addons` |
| `PATCH /v1/team/addons/<id>` (addons) | `{ "hidden": bool }` | wie `GET /v1/team/addons` |
| `DELETE /v1/team/addons/<id>/versions/<version>` (addons) | – | wie `GET /v1/team/addons` |
| `GET /v1/team/cosmetics` (cosmetics) | – | `{ "cosmetics": [TeamCosmetic], "keyConfigured": bool, "publicKey": "<PEM>" \| null }`, alle Cosmetics (auch ausgeblendete) nach Slot, dann Name |
| `GET /v1/team/cosmetics/<id>` (cosmetics) | – | `{ "cosmetic": TeamCosmetic, "manifest": "<Text>", "signature": "<Base64>" }` (auch ausgeblendete, z. B. für die Vorschau); unbekannt: 404 |
| `PUT /v1/team/cosmetics` (cosmetics) | Inhalt der `.cosmetic.json` (`{ "manifest", "signature" }`, höchstens 544 KB; bei Format 1 192 KB) | wie `GET /v1/team/cosmetics` |
| `PATCH /v1/team/cosmetics/<id>` (cosmetics) | `{ "hidden": bool }` | wie `GET /v1/team/cosmetics` |
| `DELETE /v1/team/cosmetics/<id>` (cosmetics) | – | wie `GET /v1/team/cosmetics` |
| `GET /v1/team/addon-submissions?status=pending\|all` (addons) | – | `{ "submissions": [Submission plus "submitter": { "uuid", "name" }] }`; ohne `status`: `pending`, älteste zuerst; `all`: alle eingereichten (nie eingereichte Entwürfe nicht), zuletzt eingereichte zuerst |
| `GET /v1/team/addon-submissions/<sid>` (addons) | – | `{ "submission": Submission plus "submitter" und "manifest": "<Text>" \| null }`; `manifest` ist genau der Text, der beim Freigeben signiert wird |
| `GET /v1/team/addon-submissions/<sid>/jar` (addons) | – | die JAR als Anhang `heldix-addon-<id>-<version>.jar` (`Cache-Control: private, no-store`); nach Freigabe oder Zurückziehen: 404 |
| `GET /v1/team/addon-submissions/<sid>/screenshots/<n>` (addons) | – | das Bild |
| `POST /v1/team/addon-submissions/<sid>/approve` (addons) | `{ "signature": "<Base64>", "manifest"?: "<Text zur Kontrolle>" }` (höchstens 256 KB) | `{ "submission": … }` wie `GET`, `status: "approved"` |
| `POST /v1/team/addon-submissions/<sid>/reject` (addons) | `{ "note": "<1–1000 Zeichen, Zeilenumbrüche erlaubt>" }` | `{ "submission": … }` wie `GET`, `status: "rejected"` |
| `GET /v1/team/addon-reports?status=open\|done\|all` (addon-reports) | – | `{ "reports": [AddonReport] }`, neueste zuerst; ohne `status`: `open` |
| `POST /v1/team/addon-reports/<id>/done` (addon-reports) | – | `{ "report": AddonReport }` (schon erledigt: unverändert) |
| `GET /v1/team/members` (team.view) | – | `{ "members": [ { "uuid", "name", "role", "addedAt", "addedBy": "<name>" \| null, "twoFactor": bool } ] }` |
| `POST /v1/team/members` (team.manage) | `{ "uuid" \| "name", "role" }` | wie `GET` |
| `PUT /v1/team/members/<uuid>` (team.manage) | `{ "role" }` | wie `GET` |
| `DELETE /v1/team/members/<uuid>` (team.manage) | – | wie `GET` |
| `POST /v1/team/members/<uuid>/reset-2fa` (team.manage) | – | wie `GET` |
| `GET /v1/team/badges` (team.view, ab 1.12.0) | – | `{ "badges": [{ "uuid", "name", "badge": "partner" \| "creator" \| "ambassador", "addedAt", "addedBy": "<name>" \| null }] }`, nach Abzeichen, dann Name |
| `PUT /v1/team/badges/<uuid>` (team.manage, ab 1.12.0) | `{ "badge": "partner" \| "creator" \| "ambassador" }` | wie `GET /v1/team/badges` (vergeben oder ersetzen; unbekannter Spieler 404, anderer Wert 400) |
| `DELETE /v1/team/badges/<uuid>` (team.manage, ab 1.12.0) | – | wie `GET /v1/team/badges` (entziehen; auch ohne Abzeichen 200) |
| `GET /v1/team/audit?limit=<1–500, Standard 100>` (audit) | – | `{ "entries": [ { "id", "at", "actor": { "uuid", "name" }, "action", "target": "<Text>" \| null, "detail": "<Text>" \| null } ] }`, neueste zuerst |
| `GET /v1/team/hosting` (hosting:manage, ab 1.13.0) | – | `{ "slots": { "max", "used" }, "memory": { "totalMb", "freeMb" }, "defaults", "worlds": [HostedWorld mit "cpuPercent"] }` |
| `POST /v1/team/hosting/worlds/<id>/stop` (hosting:manage) | – | `{ "ok": true }` |
| `PATCH /v1/team/hosting/worlds/<id>` (hosting:manage) | `{ "memoryMb"?: 1024–16384, "diskMb"?: 1024–65536, "maxPlugins"?: 0–100, "sleepAfterMin"?: 0–1440 (0 = nie) }` | `HostedWorld` |
| `GET /v1/team/hosting/grants`, `GET /v1/team/hosting/grants/<uuid>` (hosting:grant) | – | `{ "grants": [Grant] }` bzw. `{ "uuid", "team", "allowed", "grants" }` |
| `PUT` / `DELETE /v1/team/hosting/grants/<uuid>` (hosting:grant) | – | `{ "added", "grant", "grants" }` bzw. `{ "removed", "grants" }`; `Grant` = `{ "uuid", "name", "source": "beta", "label", "grantedAt", "grantedBy", "expiresAt", "seen" }` |
| `GET /v1/team/plus/waitlist` (hosting:grant) | – | `{ "entries": [{ "uuid", "name", "since", "memberSince", "lastOnline", "playedMs" \| null, "team", "granted" }], "count", "waiting" }` |
| `POST /v1/team/plus/grant` (hosting:grant) | `{ "uuids": [1–200] }` oder `{ "first": 1–200 }` (die ältesten ohne Freischaltung, ohne Team) | `{ "granted": [{ "uuid", "name" }], "skipped", … }` |
| `GET /v1/team/discover?status=open\|done\|all` (discover:moderate) | – | `{ "listings": [...], "reports": [...], "bans": [...] }` |
| `PATCH /v1/team/discover/<code>` (discover:moderate) | `{ "hidden": bool }` | `{ "ok": true, "hidden" }` |
| `POST /v1/team/discover/reports/<id>/done` (discover:moderate) | – | `{ "ok": true }` |
| `PUT` / `DELETE /v1/team/discover/bans/<uuid>` (discover:moderate) | `{ "reason"? }` | `{ "bans": [{ "uuid", "name", "reason", "at", "by" }] }` |

Voice-Moderation (ab 1.13.0, `voice:moderate` bzw. `voice:admin`): Routen unter `/v1/team/voice…`, siehe [Voice-Moderation](#voice-moderation).

`Report` = `{ "id", "kind": "chat" | "voice" (ab 1.13.0), "at", "status": "open" | "done", "reason", "note", "reporter": { "uuid", "name" }, "reported": { "uuid", "name", "banned": bool }, "messages": [ { "from": "<uuid>", "fromName", "text", "at" } ], "doneAt": <ms> | null, "doneBy": "<name>" | null }`

`AddonReport` = `{ "id", "at", "status": "open" | "done", "reason", "note", "addon": { "id", "name", "exists": bool, "hidden": bool, "official": bool, "owner": { "uuid", "name" } | null }, "reporter": { "uuid", "name" }, "doneAt", "doneBy" }`

`TeamCosmetic` = `{ "id", "slot", "format" (ab 1.12.0: 1 oder 2), "version", "name", "description", "access", "manifestAccess" (ab 1.14.0: Zugang im signierten Manifest; `access` ist bei Belohnungen eines Partners `"partner"`), "partner"?, "partnerName"?, "date", "sha256", "size", "hidden": bool, "wearers": <Anzahl>, "createdAt", "publishedAt", "publishedBy": "<Spielername>" | null }`. `wearers`: Spieler, die es gewählt haben (gespeichert, auch während es ausgeblendet ist); `createdAt`: erste Veröffentlichung, `publishedAt`: aktuelle Version.

`News` = `{ "id", "title", "text", "at", "updatedAt", "author": "<name>", "published": bool }`. `at` ist der Zeitpunkt der ersten Veröffentlichung, bei Entwürfen der Zeitpunkt der Erstellung.

Spieler (`GET /v1/team/players/<uuid>`) = `{ "uuid", "name", "cape", "visible", "presence", "showServer", "messages", "createdAt", "lastSeen", "online", "friends": <Anzahl>, "blocks": <Anzahl>, "reportsAbout": [<id>], "reportsBy": [<id>], "ban": Ban | null, "role", "communityBadge" }` mit `Ban` wie in `GET /v1/team/bans` (`communityBadge` ab 1.12.0: `partner` | `creator` | `ambassador` | `null`). `online` heißt im Spiel verbunden.

- **`null` bei `by`, `doneBy`, `addedBy`:** über die Server-Konsole (`heldix-dienst-admin`). Im Protokoll heißt der Handelnde dann `{ "uuid": null, "name": "CLI" }`.
- **Sperren** wirkt wie `heldix-dienst-admin sperren` und trennt offene WebSocket-Verbindungen des Spielers (auch den Voice Chat) sofort (Code 4003 „Gesperrt“). Sich selbst sperren: 400. Team-Mitglieder lassen sich nicht sperren (409), zuerst aus dem Team entfernen. Spieler, die nie online waren, lassen sich per `uuid` sperren. Unbekannter Name: 404.
- **Spieler suchen:** ohne Groß-/Kleinschreibung nach Namensanfang, oder nach UUID (auch mit Bindestrichen); ohne `q` die zuletzt gesehenen. Gesperrte stehen mit drin: Ihr Konto ist gelöscht, deshalb `lastSeen: null` und in der Detailansicht `createdAt: null`, `lastSeen: null`, Schalter `false` und `ban` gesetzt. Etwas anderes als Name oder UUID: 400. `online` ist die echte Verbindung, unabhängig von `presence`.
- **Spieler löschen** wirkt wie dessen `DELETE /v1/me` (ohne Sperre): Verbindungen enden mit 4001.
- **Neuigkeiten:** Titel einzeilig, Text mit Zeilenumbrüchen (`\r\n` wird zu `\n`), sonst die Regeln für Nachrichten. Moderatoren dürfen alle Neuigkeiten bearbeiten. Der Autor bleibt der, der sie angelegt hat.
- **Updates veröffentlichen:** Hochladen streamt in `<file>.part` und benennt erst am Ende um. Erlaubt sind alle Namen wie beim Download, also auch die Mac-Dateien; sonst 400; über 1 GiB: 413; der Windows-Installer der veröffentlichten Version lässt sich weder ersetzen noch löschen (409). Mac-Dateien lassen sich immer löschen, auch die gerade über `latest/<ziel>` angebotene; dann zeigt `latest` auf die nächstältere. Beim Manifest prüft der Dienst die Ed25519-Signatur mit dem öffentlichen Update-Schlüssel (`HELDIX_DIENST_UPDATE_KEY`; ohne: 503) und dieselben Regeln wie der Launcher: Dateiname passt zur Version, Größe, `sha512` (400 bei falscher Signatur oder falschem Inhalt). Die Datei muss im Ordner liegen und Größe und SHA-512 müssen stimmen, und die Version muss höher sein als die veröffentlichte (Vorabversionen wie `1.2.0-beta.1` zählen weniger als `1.2.0`), sonst 409. Erst dann ersetzt der Dienst `update.json` atomar (neue Datei schreiben, dann umbenennen). So kann auch ein übernommenes Team-Konto kein fremdes Update ausliefern.
- **Addons veröffentlichen** (siehe [Addon-Store](#addon-store)): Hochladen streamt die JAR in `<file>.part` und benennt erst am Ende um. Der Name muss `heldix-addon-<id>-<version>.jar` sein (sonst 400), höchstens 50 MiB (sonst 413). Eine Datei, die zu einer veröffentlichten Version gehört, lässt sich weder ersetzen noch einzeln löschen (409); dafür die Version löschen. Hochgeladene JARs ohne veröffentlichtes Manifest stehen unter `pending`. Beim Manifest prüft der Dienst in dieser Reihenfolge: Update-Schlüssel eingerichtet (sonst 503), Form (`manifest` und `signature` als Text, Manifest höchstens 64 KB; sonst 400), Signatur über `"heldix-addon\n" + manifest` (sonst 400 „Die Signatur stimmt nicht.“), alle Felder (400 mit Hinweis, z. B. „Ungültiges Addon-Manifest: „name“ ist zu lang (höchstens 40 Zeichen).“), offiziell (`official: true` und `author: null`, sonst 400), Datei im Addon-Ordner (sonst 409 „Erst die JAR hochladen: …“) mit passender Größe und SHA-256 (sonst 400), die ID gehört keinem Spieler (sonst 409), Version höher als jede vorhandene dieses Addons (sonst 409). Ein neues Addon ist danach sofort sichtbar. `PATCH` mit `hidden` nimmt ein Addon aus dem Store oder zeigt es wieder (unbekannt: 404, kein Wahrheitswert: 400). Eine Version löschen löscht auch ihre Datei; war es die letzte, ist das Addon ganz weg (mit Zähler). Gleichzeitig läuft pro Datei nur eine Aktion (Hochladen, Veröffentlichen oder Löschen, sonst 409).
- **Einreichungen freigeben** (siehe [Addons einreichen](#addons-einreichen) und [Betrieb](#einreichung-eines-spielers-freigeben)): Der Dienst prüft in dieser Reihenfolge: Update-Schlüssel eingerichtet (sonst 503), Einreichung wartet (sonst 409), ein mitgeschicktes `manifest` ist genau das gespeicherte (sonst 400), Signatur über `"heldix-addon\n" + manifest` mit dem öffentlichen Update-Schlüssel (sonst 400 „Die Signatur stimmt nicht.“), ID frei oder schon im Besitz des Einreichers (sonst 409), Version höher (sonst 409), JAR unverändert (Größe und SHA-256). Dann veröffentlicht er wie beim Team-Upload: JAR in den Addon-Ordner, Addon mit dem Einreicher als Besitzer anlegen, Version eintragen, Screenshots übernehmen (sie ersetzen die bisherigen; ohne Screenshots bleiben die alten), Status `approved`, Echtzeit-Nachricht an den Einreicher. Schlägt etwas fehl, bleibt die Einreichung unverändert mit ihren Dateien. Den privaten Schlüssel sieht der Dienst nie.
- **Cosmetics veröffentlichen** (siehe [Cosmetics-Katalog](#cosmetics-katalog)): Der Dienst prüft in dieser Reihenfolge: Körper höchstens 544 KB (sonst 413), Update-Schlüssel eingerichtet (sonst 503), Form des Umschlags (`manifest` und `signature` als Text, Manifest höchstens 512 KB, Signatur als Base64 mit 88 Zeichen, Umschlag höchstens 544 KB; sonst 400 „Ungültiger Cosmetic-Umschlag: …“), Signatur über `"heldix-cosmetic\n" + manifest` (sonst 400 „Die Signatur stimmt nicht.“), JSON, die Größe je Format (Format 1: 160 KB / 192 KB) und alle Regeln des Formats (400 mit Hinweis, z. B. „Ungültiges Cosmetic-Manifest: „name“ ist zu lang (höchstens 40 Zeichen).“), die ID ist kein eingebautes Cape dieses Servers (`HELDIX_DIENST_CAPES`, sonst 409), bei einer vorhandenen ID derselbe Slot (sonst 409, der Slot lässt sich nicht ändern) und eine höhere Version (sonst 409). Gespeichert wird nur die aktuelle Version: Die neue ersetzt die alte, `hidden` bleibt, wie es war; ein neues Cosmetic ist sofort im Katalog. `PATCH` mit `hidden` blendet aus (Katalog, Umschlag und Wählen wie unbekannt, beim Nachschlagen `null`; die Auswahl der Träger bleibt gespeichert) bzw. zeigt wieder (unbekannt: 404, kein Wahrheitswert: 400). `DELETE` löscht das Cosmetic und setzt die Auswahl aller Träger in einer Transaktion zurück; die ID ist danach wieder frei. Den privaten Schlüssel sieht der Dienst nie.
- **Ablehnen:** nur wartende Einreichungen (sonst 409), Begründung 1–1000 Zeichen (sonst 400); der Einreicher sieht sie und kann überarbeiten. **Meldungen zu Addons:** Erledigt merkt sich Zeitpunkt und Namen; ein Addon nehmen Admins mit `PATCH /v1/team/addons/<id>` aus dem Store.
- **Mitglieder:** Aufnehmen nur, wer sich schon einmal angemeldet hat (sonst 404); ist er schon im Team, ändert `POST` die Rolle. Ungültige Rolle: 400 („„role“ muss eine dieser Rollen sein: admin, developer-team, moderator, supporter, designer, tester.“). Die Liste ist nach Rang sortiert (Admin zuerst), dann nach Name. Mindestens ein Admin muss bleiben: Den letzten Admin herabstufen, entfernen oder als Spieler löschen ergibt 409 „Es muss mindestens ein Admin bleiben.“ (`DELETE /v1/me` des letzten Admins geht trotzdem; dann legt der Betreiber einen neuen an).
- **Protokoll:** Jede ändernde Team-Aktion landet im Protokoll; Einträge verfallen nach 365 Tagen. `action` ist eine von: `report.done`, `ban`, `unban`, `player.reset-cape`, `player.delete`, `news.create`, `news.update`, `news.delete`, `update.upload`, `update.publish`, `update.delete`, `addon.upload`, `addon.publish`, `addon.hide`, `addon.show`, `addon.delete` (Version oder unveröffentlichte Datei), `addon.approve` und `addon.reject` (Addon und Version, Detail: Einreichung und Einreicher), `addon-report.done`, `cosmetic.publish` (Cosmetic und Version, Detail: Slot und „neu“ oder die vorige Version), `cosmetic.hide`, `cosmetic.show`, `cosmetic.delete` (Cosmetic und Version, Detail: Slot und Zahl der zurückgesetzten Träger), `team.add`, `team.role`, `team.remove`, `team.reset-2fa`, `badge.set` (ab 1.12.0; Detail: das Abzeichen bzw. „alt → neu“), `badge.remove` (Detail: das entzogene Abzeichen), `team.profile` (nur „öffentlich an“/„öffentlich aus“, ohne Texte), `support.reply`, `support.close`, `2fa.enable`. `target` ist z. B. „Name (uuid)“, „Meldung 12“, „Anfrage 7 (Name)“, „Neuigkeit 3: Titel“, „spotify 1.2.0“ (Addon und Version), „krone 2“ (Cosmetic und Version), eine Addon- oder Cosmetic-ID oder ein Dateiname.
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

Die Routen für das Team (`/v1/team/support…`, Recht `support`: Admin, Moderator, Supporter) stehen beim [Team-Bereich](#team-bereich).

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
| `GET /v1/public/team` | `{ "members": [ { "uuid", "name", "role", "title", "about", "since": <ms> } ] }`: nur Mitglieder mit `public: true`, nach Rang der Rolle (admin, developer-team, moderator, supporter, designer, tester), dann nach Name; `Cache-Control: max-age=60` |
| `GET /v1/public/skins/<uuid>` | PNG des Minecraft-Skins (`image/png`, `Cache-Control: max-age=3600`); nur für Mitglieder mit `public: true`, sonst 404 |
| `GET /v1/public/heads/<uuid>.png?size=32\|64\|128` (ab 1.12.0) | PNG des Kopfes (Gesicht 8×8 mit Hut-Ebene, ohne Glättung vergrößert, Standard 64), `image/png`, `Cache-Control: public, max-age=3600`, CORS; siehe unten |

- `since`: seit wann im Team. Das Teamprofil bearbeitet jedes Mitglied selbst (`/v1/team/me/profile`, siehe [Team-Bereich](#team-bereich)).
- **Skins:** Der Dienst fragt `<Session-Server>/session/minecraft/profile/<uuid>` (dieselbe Adresse wie bei der Anmeldung) und liest die Skin-Adresse aus der Eigenschaft `textures` (Base64-JSON). Erlaubt sind nur Skin-Dateien von `textures.minecraft.net`, geladen immer über HTTPS (Mojang nennt `http://`), ohne Weiterleitungen, mit Zeitgrenze, höchstens 256 KB und nur, wenn die Datei mit der PNG-Signatur beginnt. Der Dienst hält Skins 6 Stunden im Arbeitsspeicher (höchstens 100), fehlende 10 Minuten. Kein Skin oder ein Fehler: 404 (die Webseite zeigt dann Initialen). Für andere Spieler fragt der Dienst Mojang gar nicht erst; so ist er kein offener Proxy.

**Köpfe** (ab 1.12.0, für die Webseite und Bilder in Discord): `GET /v1/public/heads/<uuid>.png` ohne Anmeldung.
- Nur für Spieler, die der Dienst kennt und die `visible` an haben (oder auf der Teamseite stehen); sonst (und bei ungültiger UUID) 404 „Kein Kopf gefunden.“, ohne Mojang zu fragen.
- `size`: 32, 64 (Standard), 128 oder (ab 1.14.0, für Vorschaukarten) 256; anderes: 400. Den Skin lädt der Dienst wie bei der Teamseite (gleiche Prüfungen, gleicher Zwischenspeicher); gelesen werden Skins mit 64×64 oder 64×32 Pixeln (bei alten 64×32-Skins mit ganz deckender Hut-Ebene ohne Hut, wie in Minecraft). Ohne Skin oder bei einem Fehler kommt ein einfacher Standard-Kopf (200), den der Dienst nur 10 Minuten merkt; fertige Köpfe merkt er eine Stunde (höchstens 1000).
- Höchstens 120 pro Minute und IP (eigene Grenze), sonst 429.

**Skins für Angemeldete:** `GET /v1/skins/<uuid>` (Bearer-Token oder Cookie; als GET ohne CSRF-Header) liefert denselben Skin (gleiche Prüfungen und derselbe Zwischenspeicher), mit `Cache-Control: private, max-age=3600` und ohne CORS.
- Erlaubt nur für: dich selbst, Freunde, Spieler mit offener Anfrage in eine der beiden Richtungen, Spieler, die du blockiert hast, und für Team-Mitglieder mit bestätigter Zwei-Faktor-Anmeldung (über das Cookie, jede Rolle) für alle Spieler, z. B. für die Köpfe bei Meldungen, Support, Spielern, Mitgliedern und im Protokoll.
- Alles andere und eine ungültige UUID: 404 „Kein Skin gefunden.“, ohne Mojang zu fragen. So verrät die Antwort keine Beziehungen, und der Dienst ist kein offener Proxy.
- Höchstens 300 pro Minute und Spieler (eigene Grenze statt der allgemeinen 120 pro Minute), sonst 429.

### Neuigkeiten (öffentlich)

`GET /v1/news?limit=<1–50, Standard 10>&before=<id>` ohne Anmeldung → `{ "news": [ { "id", "title", "text", "at", "author" } ], "more": bool }`, nur veröffentlichte, neueste zuerst, mit `Cache-Control: max-age=60`. Webseite (Startseite und Archiv) und Launcher zeigen sie. Der Text wird nie als HTML ausgewertet; Zeilenumbrüche werden zu Absätzen.
- **Archiv:** Mit `before` kommen die Neuigkeiten, die in dieser Reihenfolge nach der mit dieser ID stehen (älter); für die nächste Seite `before` auf die `id` der letzten setzen. `more`: Es gibt noch ältere. Aufrufe ohne `before` bleiben wie bisher.

### Status

`GET /v1/status` ohne Anmeldung → `{ "ok": true, "service": "<Version des Dienstes>", "online": <Spieler mit offener WebSocket-Verbindung>, "voice": <Spieler mit offener Voice-Verbindung>, "players": <angemeldete Spieler insgesamt>, "launcher": "<veröffentlichte Version>" | null, "addons": <sichtbare Addons im Store>, "cosmetics": <sichtbare Cosmetics im Katalog>, "worlds": <geöffnete Welten> | null, "hosted": <laufende dauerhafte Welten> | null, "since": <Start des Dienstes, ms> }`, `Cache-Control: max-age=30`. `hosted` (ab 1.13.0) ist `null`, wenn dauerhafte Welten aus sind.
- Nur Summen, keine Namen. `online` zählt jeden Spieler einmal, auch mit mehreren Verbindungen; eine Web-Sitzung und Begleiter-Verbindungen (Webseite, Launcher) zählen nicht. `players` zählt der Dienst höchstens alle 30 Sekunden neu. `launcher` ist die Version, die `/v1/launcher/latest` gerade ausliefert. `addons` zählt die Addons, die `/v1/addons` gerade zeigt, `cosmetics` (ab Version 1.6.0) die Cosmetics in `/v1/cosmetics`. `voice` (ab Version 1.8.0) zählt die Spieler im [Voice Chat](#voice-chat), unabhängig von `online`, ab 1.11.0 mit den Teilnehmern im Browser (auch Gäste); ist er aus, steht dort 0. `worlds` (ab 1.12.0) zählt die gerade geteilten Welten; ist [Welt teilen](#welt-teilen) aus (keine Welt-Domain oder Port belegt), steht dort `null`.
- `/v1/status` bleibt genau (auch kleine Zahlen); für die Startseite der Webseite gibt es die Live-Zahlen mit Schwelle:

**Live-Zahlen** (ab 1.12.0): `GET /v1/public/stats` ohne Anmeldung → `{ "online": <Spieler im Spiel> | null, "voice": <im Voice Chat> | null, "worlds": <offene Welten> | null, "minOnline": <Schwelle>, "at": <ms, gezählt> }`, `Cache-Control: public, max-age=30`, CORS.
- Der Dienst zählt höchstens alle 30 Sekunden neu (`at` bleibt so lange gleich). Sind weniger als `minOnline` Spieler online (Standard 50, `HELDIX_DIENST_LIVE_MIN`, 0 = immer zeigen), sind **alle drei Werte `null`**; die Webseite blendet die Zahlen dann aus. `worlds` ist auch `null`, wenn Welt teilen aus ist. `voice` zählt wie in `/v1/status` (mit Browser und Gästen).

### Echtzeit (WebSocket)

`GET /v1/ws`, Nachrichten sind JSON-Texte. Ab 1.12.0 gibt es zwei Arten von Verbindungen:

| Wer | Anmeldung | Art |
| --- | --- | --- |
| Spiel | `Authorization: Bearer <token>` | **Spiel**: macht online (Präsenz, Status, Spielzeit, Nachschlagen, `/v1/status`) |
| Launcher | `Authorization: Bearer <token>` und `?client=launcher` (`/v1/ws?client=launcher`) | **Begleiter**; ab 1.14.0 getrennt gezählt: Freunde sehen „Im Launcher“ |
| Webseite | Cookie `__Host-heldix_web` und `Origin` genau gleich `HELDIX_DIENST_WEBSITE` (statt des CSRF-Headers); über `wss://<webseite>/api/v1/ws` | **Begleiter** |

- **Im Launcher** (ab 1.14.0): Solange ein Launcher verbunden ist und kein Spiel, sehen Freunde `launcher: true` in `Friend` (nur mit sichtbarem Online-Status, siehe [Freunde](#freunde)) und Party-Mitglieder `launcher: true`; „zuletzt online“ beginnt erst, wenn auch der letzte Launcher zu ist. Die Webseite zählt dafür nicht.
- **Begleiter** bekommen alle Nachrichten wie das Spiel (Freunde, Nachrichten, Party, Welten …) und dürfen `ping` und `typing` schicken; `status` von ihnen ignoriert der Dienst. Sie zählen **nicht** als „online im Spiel“: Freunde sehen dadurch keinen Online-Status, „zuletzt online“ ändert sich nicht, beim Nachschlagen und in `/v1/status` zählen sie nicht. Für die [Party](#party) zählen sie als Verbindung (keine Gnadenfrist).
- **Cookie:** ohne `Origin` oder mit fremdem `Origin` 403 (auch ohne eingerichtete Webseite), ungültiges oder abgelaufenes Cookie 401. Die Verbindung gehört zur Web-Sitzung: Abmelden (`POST /v1/web/logout`) oder Löschen der Sitzung (`DELETE /v1/web/sessions/<id>`) schließt sie mit **4008** („Abgemeldet“); eine abgelaufene Sitzung bemerkt der Dienst beim nächsten `ping` (ebenfalls 4008).
- Höchstens 10 Verbindungen je Spieler (alle Arten zusammen), sonst 429. Spiel und Begleiter zählen zur Grenze von 120 Anfragen pro Minute (Token bzw. Web-Sitzung).

Client → Dienst:
- `{ "type": "status", "state": "menu" | "singleplayer" | "multiplayer" | "realms" | "lan", "server": "<domain>" | "<domain>:<port>" | null }`. Den `server` prüft der Dienst: nur Domains wie `hypixel.net`, keine IP-Adressen, kein `localhost`, keine Namen ohne Punkt, höchstens 253 Zeichen. Ein Port von 1 bis 65535 bleibt erhalten (`play.example.de:25570`), der Standard-Port 25565 fällt weg (`play.example.de`). Bei ungültigem Wert, auch bei ungültigem Port, wird `server` zu `null`.
- `{ "type": "ping" }` etwa alle 30 Sekunden. Antwort: `{ "type": "pong" }`. Ohne Nachricht für 90 Sekunden schließt der Dienst die Verbindung.
- `{ "type": "typing", "to": "<uuid>" }` (ab 1.12.0): „schreibt …“ an einen Freund (siehe [Nachrichten](#nachrichten)); höchstens alle 3 Sekunden schicken. Ungültig oder kein Freund: ignoriert.
- `{ "type": "hosting-subscribe", "world": "<id>" }` / `{ "type": "hosting-unsubscribe", "world": "<id>" }` (ab 1.13.0): Live-Log einer dauerhaften Welt abonnieren bzw. beenden (nur Besitzer und Operatoren, höchstens 8 Abos je Verbindung). Antwort `{ "type": "hosting-subscribed", "world", "state" }` oder `{ "type": "hosting-error", "world": "<id>" | null, "error" }`.

Dienst → Client:
- `{ "type": "friends", "friends": […], "incoming": […], "outgoing": […], "unread": { … } }` direkt nach dem Verbinden und nach jeder Änderung an Freunden oder Anfragen, auch durch die andere Seite.
- `{ "type": "friend", "friend": Friend }`, wenn ein Freund online oder offline geht oder seinen Status ändert.
- `{ "type": "request", "from": { "uuid", "name" } }` bei einer neuen eingehenden Anfrage. Danach folgt eine `friends`-Nachricht.
- `{ "type": "accepted", "friend": Friend }`, wenn jemand die eigene Anfrage angenommen hat. Danach folgt eine `friends`-Nachricht.
- `{ "type": "message", "message": Message, "name": "<Name des Absenders>" }` bei jeder neuen Nachricht, an alle Verbindungen des Empfängers und des Absenders (so sehen auch die anderen Geräte des Absenders die Nachricht). `message.read` gilt wie oben aus Sicht des Empfängers der WebSocket-Nachricht. Eine neue Nachricht schickt keine `friends`-Nachricht hinterher; `unread` zählt der Client selbst weiter.
- `{ "type": "read", "uuid": "<Freund>" }`, wenn du auf einem deiner Geräte die Nachrichten dieses Freundes als gelesen markiert hast. Nur an deine eigenen Verbindungen.
- `{ "type": "support", "id": <Nummer>, "subject": "<Betreff>" }`, wenn das Team auf eine deiner Support-Anfragen antwortet.
- `{ "type": "addon-review", "submission": "<sid>", "status": "approved" | "rejected", "addonId", "version", "note": "<Begründung>" | null }`, wenn das Team eine deiner Addon-Einreichungen freigegeben oder abgelehnt hat.
- `{ "type": "unlock", "cosmetic": "<id>", "reason": "invite" }` (ab 1.11.0), wenn du ein Cosmetic freigeschaltet hast (siehe [Einladungen](#einladungen)).
- `{ "type": "invite", "event": "accepted" | "confirmed", "name": "<Name>" }` (ab 1.11.0), wenn jemand deine Einladung angenommen hat bzw. ein Eingeladener bestätigt ist.
- `{ "type": "world-invite", "world": { "id", "name", "address", "host": { "uuid", "name" } } }` (ab 1.12.0), wenn dich ein Freund in seine Welt einlädt (siehe [Welt teilen](#welt-teilen)).
- `{ "type": "world-open", "world": FriendWorld }` und `{ "type": "world-closed", "world": { "id" } }` (ab 1.12.0), wenn eine Welt, die du unter `friends` in `GET /v1/worlds` siehst, aufgeht, sich ändert (Name, Zugang, Mitglieder, Präsenz des Gastgebers) bzw. zugeht oder für dich nicht mehr sichtbar ist. Nur für Welten, die per „Welt teilen“ geöffnet sind; dauerhafte Welten (ab 1.13.0) stehen nur in `GET /v1/worlds`.
- Ab 1.13.0 (dauerhafte Welten): `{ "type": "hosting-state", "world": HostedWorld }` an Besitzer und Operatoren bei jeder Änderung (beim Löschen `{ "id", "state": "deleted" }`), `{ "type": "hosting-log", "world", "lines": ["…"] }` an Abonnenten, `{ "type": "hosting-knock", "world": { "id", "name", "address" }, "name" }` (jemand klopft an) und `{ "type": "hosting-granted", "source": "beta", "label", "at", "text", "pending" }` (freigeschaltet; `pending: true` bei der nächsten Verbindung, bis `POST /v1/plus/seen`), siehe [Dauerhafte Welten](#dauerhafte-welten).

Ab 1.12.0 (Freunde 2.0 und Party):
- `{ "type": "friend", "friend": Friend }` gibt es zusätzlich, wenn sich Statustext, „Nicht stören“ oder „Zuletzt online zeigen“ eines Freundes ändern, und an die eigenen Verbindungen nach `PATCH /v1/friends/<uuid>`. `Friend` trägt dabei immer die eigenen Angaben des Empfängers (Favorit, Spitzname, Notiz).
- `{ "type": "message", … }`: `message` mit `replyTo`, `card`, `reactions` (siehe [Nachrichten](#nachrichten)).
- `{ "type": "message-deleted", "uuid": "<Gegenüber>", "id": <Nachrichten-ID> }`: Nachricht gelöscht (an beide Seiten; `uuid` ist jeweils der andere in der Unterhaltung).
- `{ "type": "reaction", "uuid": "<Gegenüber>", "id": <Nachrichten-ID>, "reactions": { "<uuid>": "<Reaktion>" } }`: neue Reaktionen einer Nachricht (an beide Seiten).
- `{ "type": "typing", "from": "<uuid>" }`: ein Freund schreibt gerade (nichts gespeichert, gedrosselt).
- `{ "type": "party", "party": Party }`: Stand der eigenen Party (aus Sicht des Empfängers, mit `voice`) nach jeder Änderung (Mitglieder, Einladungen, Leitung, Ort, Status, Verbindung). `{ "type": "party", "party": null, "reason": "left" | "removed" | "dissolved" }`: nicht mehr in einer Party (`left`: selbst gegangen, Gnadenfrist vorbei oder Konto gelöscht; `removed`: vom Leiter entfernt oder blockiert; `dissolved`: aufgelöst).
- `{ "type": "party-invite", "invite": PartyInvite | null, "invites": [PartyInvite] }`: offene Party-Einladungen des Empfängers. `invite` ist die neue (Hinweis zeigen; bei `quiet` still), `null` heißt nur „Liste geändert“ (abgelehnt, zurückgezogen, abgelaufen, angenommen). Kommt auch beim Verbinden, wenn Einladungen offen sind.
- `{ "type": "party-chat", "party": "<id>", "message": PartyChatMessage }`: Nachricht im Party-Chat (an alle Mitglieder, auch den Absender).
- `{ "type": "party-follow", "party": "<id>", "leader": { "uuid", "name" }, "target": Location }`: Der Leiter ist jetzt auf einem anderen Server bzw. in einer geteilten Welt; an alle Mitglieder, die nicht schon dort sind. Clients zeigen „<Leiter> ist auf <title> – Beitreten“ (Spiel: Toast mit Taste; Launcher: Knopf) bzw. folgen mit „Automatisch folgen“ (nur aus dem Menü).

Clients ignorieren unbekannte Nachrichten: Die Client-Mod bis 0.13.7 überspringt sie (`default`-Zweig in `Social.java`), zeigt bis 0.13.6 `unlock` und `invite` also einfach nicht an (bis 0.13.7 ebenso die Nachrichten zu Welten und alle Nachrichten ab 1.12.0 wie `party`, `typing`, `reaction`, `message-deleted`); neue Felder in `Friend` und `Message` ignoriert sie (Gson). Der Launcher bis 0.13.7 nutzt `/v1/ws` gar nicht.

Ein Spieler ist online, solange mindestens eine Verbindung **aus dem Spiel** offen ist. Bei mehreren Verbindungen gilt der zuletzt gemeldete Status. Schließt die letzte, speichert der Dienst den Zeitpunkt als „zuletzt online“ (auch beim Herunterfahren).

Der Dienst schließt Verbindungen mit Code 4000 („Zeitüberschreitung“), 4001 („Konto gelöscht“), 4003 („Gesperrt“) und ab 1.12.0 4008 („Abgemeldet“, nur Verbindungen mit Cookie). Eine Sperre über `heldix-dienst-admin` bemerkt eine offene Verbindung beim nächsten `ping`.

### Voice Chat

Ab Version 1.8.0: Sprechen mit HeldixClient-Spielern in der Nähe, auf jedem Minecraft-Server und ohne Plugin auf dem Server. Ab Version 1.9.0 dazu Gruppen (über Dimension und Entfernung hinweg) und der Status „Mikrofon stumm“ / „Ton aus“. Das Spiel hält die Verbindung, das offizielle Addon „Voice Chat“ nimmt auf, kodiert (Opus), mischt und spielt ab. Der Dienst verteilt die Sprache nur weiter.

`GET /v1/voice` als WebSocket mit `Authorization: Bearer <token>`, genau wie `/v1/ws` (zählt zur Grenze von 120 Anfragen pro Minute und Token). Ohne gültiges Token: 401, normales GET: 426. Pro Spieler gibt es höchstens eine Voice-Verbindung: Eine neue schließt die alte mit Code 4002 („Neue Verbindung“). Mit `HELDIX_DIENST_VOICE=0` ist der Voice Chat aus, dann antwortet `/v1/voice` mit 404.

Ein **Raum** ist ein Server in einer Dimension. Wer im selben Raum ist, kann sich in der Nähe hören. Eine **Gruppe** (ab 1.9.0) gilt je Server, die Dimension ist egal: Wer in derselben Gruppe ist, hört sich überall auf dem Server. Raum und Gruppe verwaltet der Dienst unabhängig voneinander; im Spiel ist in einer Gruppe nur, wer auch einen Raum betreten hat. Teilnehmer im Browser (ab 1.11.0) sind nur in der Gruppe einer Einladung, ohne Raum (siehe [Voice im Browser](#voice-im-browser)).

Client → Dienst (JSON-Text):

| Nachricht | Bedeutung |
| --- | --- |
| `{ "type": "join", "server": "mc.example.net", "dimension": "minecraft:overworld", "mode": "all", "group": "<64 Hex-Zeichen>" }` | Raum betreten oder wechseln und Gruppe betreten, wechseln oder verlassen. `server` prüft der Dienst wie beim Online-Status (nur öffentliche Domains, ein Port außer 25565 bleibt), `dimension` muss zu `^[a-z0-9_.-]{1,32}:[a-z0-9_./-]{1,64}$` passen, `mode` ist `"all"` (Standard, auch ohne Angabe) oder `"friends"`. `group` (ab 1.9.0) fehlt oder ist `null` (keine Gruppe) oder passt zu `^[0-9a-f]{64}$`: Der Client schickt einen SHA-256 aus Gruppenname und Passwort, Name und Passwort sieht der Dienst nie. Ist etwas ungültig, ignoriert der Dienst die ganze Nachricht. Beim Wechsel in einen anderen Raum gilt die alte Position nicht mehr. Wechselt nur die Dimension und bleibt `group` gleich, bleibt der Spieler in der Gruppe; im selben Raum mit anderer `group` wechselt nur die Gruppe. Ist die Gruppe voll (16 Mitglieder) und der Spieler nicht schon drin, ist er danach in keiner Gruppe und bekommt `{ "type": "group", "status": "full" }`. |
| `{ "type": "pos", "x": 1.5, "y": 64, "z": -3.25 }` | Eigene Position: endliche Zahlen mit Betrag höchstens 30 000 000, sonst ignoriert. Der Client schickt sie bei Bewegung (höchstens etwa 5-mal pro Sekunde), sonst alle 2 Sekunden. |
| `{ "type": "mode", "mode": "friends" }` | Nur noch mit Freunden sprechen und hören; `"all"`: wieder mit allen. Innerhalb der eigenen Gruppe gilt „Nur Freunde“ nicht. |
| `{ "type": "state", "muted": true, "deafened": false }` | Ab 1.9.0: eigener Status „Mikrofon stumm“ (`muted`) und „Ton aus“ (`deafened`). Beide Felder müssen `true` oder `false` sein, sonst ignoriert der Dienst die Nachricht; zu Beginn jeder Verbindung sind beide `false`. Unverändert: nichts. Höchstens 4 Änderungen pro Sekunde, weitere ignoriert der Dienst. Der Status bleibt an der Verbindung, auch über Raum- und Gruppenwechsel und `leave` hinweg. Mit `"deafened": true` bekommt der Spieler keine Sprache mehr. |
| `{ "type": "leave" }` | Raum und Gruppe verlassen, die Verbindung (und der Status) bleibt. Die Position gilt danach nicht mehr. |
| `{ "type": "ping" }` | Antwort `{ "type": "pong" }`. |
| `{ "type": "join", "invite": "<code>" }` | Ab 1.11.0, vor allem aus dem Browser: nur die Gruppe der Einladung betreten, kein Raum (siehe [Voice im Browser](#voice-im-browser)). |
| `{ "type": "kick", "uuid": "<id>" }` | Ab 1.11.0: einen Gast aus der eigenen Gruppe entfernen (siehe [Voice im Browser](#voice-im-browser)). |

Binär (Sprache): `[1 Byte Version = 1][1 Byte Flags][2 Byte Folgenummer, big endian][1–1024 Byte Opus]`. Flags: Bit 0 = letzter Rahmen eines Satzes (Taste losgelassen oder Stille), die anderen Bits 0.

Dienst → Client:
- `{ "type": "ready", "range": 48, "maxFrame": 1024, "protocol": 1, "features": ["state", "groups", "guests"], "maxGroup": 16 }` direkt nach dem Verbinden: Reichweite in Blöcken, größte Nutzdaten eines Rahmens in Byte, Version des Rahmen-Formats (bleibt 1) und ab 1.9.0 die zusätzlichen Funktionen (`features`: Status und Gruppen, ab 1.11.0 `guests` für Teilnehmer im Browser, Einladungen mit Gruppe und `kick`) und die größte Gruppe (`maxGroup`). Ob der Dienst Gruppen und Status kann, erkennt ein Client an `features`, nicht an `protocol`.
- `{ "type": "peers", "uuids": ["…"], "group": ["…"], "muted": ["…"], "deafened": ["…"], "guests": { "<id>": "<Name>" }, "browser": ["…"] }`: `uuids` sind die anderen Spieler im Raum, unabhängig von der Entfernung, höchstens 100. Ab 1.9.0: `group` sind die anderen Mitglieder der eigenen Gruppe in jeder Dimension (höchstens 16, ohne Gruppe leer, auch Teilnehmer im Browser); `muted` und `deafened` sind die Spieler aus `uuids` und `group`, die gerade „Mikrofon stumm“ bzw. „Ton aus“ haben. Ab 1.11.0: `guests` nennt die Gäste unter ihnen mit Namen, `browser` alle Teilnehmer im Browser unter ihnen (Gäste und angemeldete). Es kommen immer alle sechs Felder, leere Listen und `{}` sind möglich; ältere Clients ignorieren die beiden neuen. Die Nachricht geht mit der vollständigen Liste des Empfängers an alle im Raum, sobald jemand ihn betritt, verlässt, in einen anderen Raum wechselt oder die Verbindung trennt, und ebenso an alle in der alten und der neuen Gruppe, sobald jemand eine Gruppe betritt oder verlässt; jeder bekommt dabei nur eine Nachricht. Schickt jemand `join` für seinen Raum und seine Gruppe noch einmal, bekommt nur er die Liste. Nach `leave` sind alle Listen leer.
- `{ "type": "state", "uuid": "<UUID ohne Bindestriche>", "muted": true, "deafened": false }` (ab 1.9.0), sobald ein anderer Spieler im selben Raum oder in derselben Gruppe seinen Status ändert; jeder Empfänger bekommt sie einmal.
- `{ "type": "group", "status": "full" }` (ab 1.9.0), wenn die Gruppe beim `join` schon 16 Mitglieder hatte. Sonst gibt es keine eigene Nachricht zur Gruppe, die Mitglieder stehen in `peers`.
- `{ "type": "pong" }`.
- Binär: `[1 Byte Version = 1][1 Byte Flags][2 Byte Folgenummer][16 Byte UUID des Sprechers][Opus]`. Version, Folgenummer und Opus wie vom Sprecher; von den Flags gibt der Dienst nur Bit 0 weiter.

**Weiterleiten:** Ein Rahmen von A geht an B (höchstens einmal), wenn B nicht A ist, B nicht „Ton aus“ hat, keiner den anderen blockiert hat und
1. beide in derselben Gruppe sind (ab 1.9.0) – dann ohne Prüfung von Dimension, Position, Entfernung und „Nur Freunde“; im Spiel hat A dafür ohnehin einen Raum betreten, im Browser (ab 1.11.0) reicht die Gruppe; oder
2. wie bisher: beide im selben Raum sind (gleicher Server nach der Prüfung oben und gleiche Dimension), beide eine Position haben, die höchstens 15 Sekunden alt ist, der Abstand (3D) höchstens die Reichweite ist und beide befreundet sind, falls einer von beiden „Nur Freunde“ (`"friends"`) gewählt hat.

Ältere Clients schicken weder `group` noch `state`; für sie gilt nur Punkt 2, wie in 1.8.0. Blockieren und das Ende einer Freundschaft wirken sofort. Hat B mehr als 256 KB ungelesen im Puffer (langsame Leitung), verwirft der Dienst den Rahmen für B; die Verbindung bleibt.

**Grenzen:**
- Rahmen: höchstens 60 pro Sekunde und Verbindung, der Rest wird verworfen. Ebenso verworfen werden Rahmen unter 5 oder über 1028 Byte, mit einer anderen Version als 1 oder ohne Raum und ohne Gruppe. Ohne aktuelle Position gehen Rahmen nur an die eigene Gruppe.
- Textnachrichten: höchstens 20 pro Sekunde und Verbindung, der Rest wird verworfen. Ungültiges JSON und unbekannte Nachrichten ignoriert der Dienst.
- Status (`state`): höchstens 4 Änderungen pro Sekunde und Verbindung (sie zählen auch zu den 20 Textnachrichten), weitere ignoriert der Dienst.
- Gruppen: höchstens 16 Mitglieder; leere Gruppen löscht der Dienst sofort. `leave`, Trennen, eine neue Verbindung (4002) und ein gelöschtes oder gesperrtes Konto nehmen auch aus der Gruppe.
- Eine WebSocket-Nachricht ist höchstens 4 KB groß; größere trennt der Dienst (Code 1009).
- Ohne jede Nachricht für 60 Sekunden schließt der Dienst die Verbindung (4000 „Zeitüberschreitung“). Der Client schickt dafür `ping` oder `pos`.
- Konto gelöscht (4001) oder gesperrt (4003): wie bei `/v1/ws`. Löschen und Sperren im Team-Bereich trennen sofort, eine Sperre über `heldix-dienst-admin` beim nächsten `ping`.

**Nichts gespeichert, nichts geloggt:** Sprache leitet der Dienst nur weiter. Position, Modus, Status, Raum und Gruppe liegen nur im Arbeitsspeicher, solange die Verbindung offen ist, und sind danach weg. Von einer Gruppe kennt der Dienst nur den Prüfwert, nie Gruppenname oder Passwort. In Datenbank und Log landen weder Sprache noch Positionen, Server, Dimensionen, Gruppen oder Status; einzige Ausnahme ab 1.11.0 ist der Prüfwert einer Gruppe an einer Einladung in den Voice Chat (in der Datenbank, bis die Einladung abläuft oder widerrufen wird). `/v1/status` zeigt nur, wie viele verbunden sind (`voice`), nichts zu Gruppen. Ab 1.13.0 kommen Voice-Meldungen (mit Kontext, Lautstärke-Verlauf und ggf. Aufnahme des Gemeldeten), Voice-Sperren und die Zustimmung zu den Voice-Regeln dazu (siehe [Voice-Moderation](#voice-moderation)); die Sprache aller anderen speichert der Dienst weiter nicht.

#### Voice im Browser

Ab Version 1.11.0 (`features` enthält `guests`). Auf der Webseite reden Gäste ohne HeldixClient und angemeldete Spieler über eine [Einladung](#einladungen) mit Voice-Gruppe mit dieser Gruppe. Audio wie im Spiel: Opus, 48 kHz, mono, Rahmen zu 20 ms (960 Samples), dasselbe Rahmen-Format.

- **Gast-Zugang:** `POST /v1/public/invites/<code>/guest` mit `{ "name" }` (ohne Anmeldung). Der Name wird getrimmt und muss dann 3–16 Zeichen aus Buchstaben (auch ÄÖÜäöüß), Ziffern, Leerzeichen, `_`, `.` und `-` haben, mindestens einen Buchstaben oder eine Ziffer (sonst 400). Nur für offene Einladungen mit Voice-Gruppe (sonst 404); Voice Chat aus: 503; schon 4 Gäste dieser Einladung verbunden: 409. Ein mitgeschickter `Origin` muss die Webseite sein (403). Antwort `{ "token", "id", "name", "expires" }`: `token` (43 Zeichen base64url) ist der Zugang; `id` (16 Zufallsbytes, 32 Hex-Zeichen) steht im Voice Chat überall an der Stelle der UUID; `expires` ist der frühere Zeitpunkt von Ablauf der Einladung und 6 Stunden. Gast-Sitzungen liegen nur im Arbeitsspeicher (nach einem Neustart des Dienstes neu beitreten); vom Token behält der Dienst nur den SHA-256. Je Einladung hält er höchstens 20 Sitzungen, die ältesten nicht verbundenen fallen weg.
- **Verbinden:** `wss://<webseite>/api/v1/voice` (gleiche Adresse wie die Webseite, Caddy reicht den WebSocket unter `/api` durch).
  - Gast: Unterprotokolle `["heldix-voice", "gast.<token>"]`; der Dienst wählt `heldix-voice`. Ist `HELDIX_DIENST_WEBSITE` gesetzt, muss `Origin` genau die Webseite sein (sonst 403). Unbekanntes oder abgelaufenes Token oder Einladung nicht mehr offen: 401 „Der Gast-Zugang ist abgelaufen. Öffne den Einladungs-Link noch einmal.“
  - Angemeldet: Cookie der Webseite, Unterprotokoll `heldix-voice`; statt des CSRF-Headers muss `Origin` genau die Webseite sein (sonst 403, auch ohne `Origin`). Ungültiges Cookie: 401. Wie jede neue Verbindung ersetzt sie eine alte Voice-Verbindung desselben Spielers (4002), z. B. die des Spiels.
  - Beides zählt zur Grenze von 120 Anfragen pro Minute (je Gast bzw. Sitzung der Webseite).
- **Beitreten:** `{ "type": "join", "invite": "<code>" }` statt Server und Dimension. Der Dienst setzt nur die Gruppe der Einladung (`<server> <prüfwert>`, also dieselbe wie im Spiel), keinen Raum; Gäste nur mit dem Code ihrer Sitzung. Ungültig, abgelaufen oder widerrufen: `{ "type": "invite", "status": "invalid" }` und Schließen mit 4006. Ist die Gruppe voll (16), gilt `group: full` wie im Spiel. `join` mit Server und Dimension und `pos` ignoriert der Dienst im Browser; `state`, `leave` und `ping` gelten wie im Spiel. Bei jedem `ping` prüft er, ob die Einladung noch offen ist (sonst `invite: invalid` und 4006). Auch ein Spiel kann mit `invite` beitreten (dann ebenfalls nur die Gruppe).
- **Sprache:** Eine Verbindung ohne Raum, aber mit Gruppe sendet und empfängt nur in der Gruppe (auch zu Spielern in anderen Dimensionen). Gäste haben kein Konto und lassen sich nicht blockieren (`POST /v1/blocks` mit ihrer ID: 404); Blockieren zwischen Spielern gilt weiter, auch im Browser.
- **Gäste entfernen:** `{ "type": "kick", "uuid": "<id>" }`: Nur ein Nicht-Gast in derselben Gruppe darf einen Gast dieser Gruppe entfernen. Der Gast wird mit 4004 getrennt, sein Token gilt danach nicht mehr. Alles andere (Gast entfernt jemanden, andere Gruppe, kein Gast) ignoriert der Dienst. Die Gruppe bekommt eine neue `peers`-Nachricht.
- **Grenzen:** höchstens 4 Gäste gleichzeitig je Einladung (der fünfte wird beim Verbinden mit 4007 „Voll“ geschlossen; dieselbe Sitzung noch einmal ersetzt ihre alte Verbindung mit 4002) und höchstens 16 Mitglieder je Gruppe (Gäste zählen mit); sonst wie im Spiel.
- **Schließcodes** (dazu 4000–4003 wie oben): 4004 „Aus der Gruppe entfernt“ (`kick`, Einladung widerrufen oder als 51. offene weggefallen, Konto des Einladenden gelöscht oder gesperrt), 4005 „Sitzung abgelaufen“ (Gast), 4006 „Einladung ungültig“ (beim `join` oder später beim `ping`, auch für Angemeldete nach einem Widerruf), 4007 „Voll“.
- **Nichts gespeichert, nichts geloggt:** wie oben; dazu stehen Gastnamen, Gast-IDs, Tokens und Codes in keinem Log. Den Prüfwert der Gruppe speichert der Dienst nur an der Einladung, bis sie abläuft (24 Stunden) oder widerrufen wird.

#### Voice-Moderation

Ab Version 1.13.0 (`features` enthält `moderation`; Client 0.14.0, Addon „Voice Chat“ 1.3.0, Addon-API 10). Voice-Regeln mit Pflicht-Zustimmung, Voice-Meldungen mit Kontext, Lautstärke-Verlauf und – erst nach Veröffentlichung der Regeln – einer Aufnahme, Voice-Sperren, Stummschalten und Entfernen durch Gastgeber, Operatoren und Party-Leiter und die Liste „Voice aus“. Code: [service/src/voice-moderation.ts](../service/src/voice-moderation.ts), [service/src/voice.ts](../service/src/voice.ts), Prüfung der Clips in [service/src/ogg.ts](../service/src/ogg.ts).

**Voice-Regeln (Pflicht-Zustimmung).** Ein eigener, versionierter Text (Standardtext im Dienst; Format: Zeilen mit `# ` sind Überschriften, `- ` Listenpunkte, sonst Absätze; höchstens 12 000 Zeichen). Solange kein Admin eine Version veröffentlicht hat, gibt es weder Pflicht noch Aufnahmen. Ab der ersten Veröffentlichung (`POST /v1/team/voice/rules`) braucht jede Voice-Verbindung die Zustimmung zur **aktuellen** Version: Spieler über `POST /v1/voice/rules/accept` (im Spiel über den Dialog von HeldixClient, auf der Webseite vor dem Beitreten), Gäste beim Anlegen der Gast-Sitzung (`rulesVersion`). Ohne Zustimmung: `{ "type": "rules", "status": "required", "version": 2 }` und Schließen mit **4012** „Voice-Regeln“. Eine neue Version schließt sofort alle Verbindungen ohne Zustimmung zu ihr (also alle); Gäste verlieren dabei ihre Sitzung. Zurückziehen (`DELETE /v1/team/voice/rules`) beendet Pflicht und Aufnahmen. Widerruf durch den Spieler: `DELETE /v1/voice/rules/accept` (schließt die Verbindung mit 4012).

**Aufnahmen (Clips).** Aktiv nur, wenn Regeln veröffentlicht sind, der Admin-Schalter an ist (`PUT /v1/team/voice/settings { "clips": true | false }`, Standard an) und nicht `HELDIX_DIENST_VOICE_CLIPS=0` gesetzt ist. Clients sehen den Stand in `ready.clips` (`{ "maxMs": 600000, "maxBytes": 3145728 }` oder `null`) und bei Änderungen in `{ "type": "clips", "clips": … }`; nur dann puffern sie die empfangenen Opus-Pakete anderer (nur im Arbeitsspeicher, höchstens 10 Minuten je Sprecher) und laden beim Melden die des Gemeldeten hoch.

**Voice-Sperren.** Das Team (`voice:moderate`) sperrt für `1h`, `24h`, `7d` oder `permanent`, Grund Pflicht (höchstens 300 Zeichen), auf Wunsch mit den Meldungen als Begründung. Wirkung sofort: Die Verbindung bekommt `{ "type": "banned", "until": <ms> | null, "reason", "message": "Du bist bis 29.11.2026, 14:00 Uhr vom Voice Chat gesperrt. Grund: …", "appeal": "Einspruch: Support-Anfrage (Kategorie „Konto“) …" }` und schließt mit **4013** „Voice-Sperre“; neue Verbindungen ebenso. Einladungen des Gesperrten laden nicht mehr in den Voice Chat ein (Gäste und Mitredende darüber fliegen raus, `GET /v1/public/invites/<code>` zeigt `voice: null`, neue Gäste: 404). Eine neue Sperre ersetzt die laufende; Team-Mitglieder lassen sich nicht sperren (409). Der Spieler sieht Sperre, Grund, Ende und den Hinweis auf den Einspruch in `GET /v1/voice/me` (Webseite: Konto; Spiel: Hinweis). Der Einspruch läuft über eine Support-Anfrage.

**Gastgeber, Operatoren, Party-Leiter.** In den Räumen einer Heldix-Welt (`<code>.<Welt-Domain>`, geteilt oder dauerhaft, jede Dimension) dürfen der Besitzer und Mitglieder mit Rolle `operator` andere **für alle stummschalten** (der Dienst leitet ihre Stimme in den Räumen der Welt nicht weiter; selbst gewählte Gruppen bleiben) und **für 10 Minuten aus dem Voice entfernen** (kein Raum in der Welt; eine Gruppe bleibt). Operatoren können den Besitzer und andere Operatoren nicht moderieren. In der Voice-Gruppe einer [Party](#party) darf das der Leiter (Stummschalten: keine Weiterleitung in der Party-Gruppe; Entfernen: 10 Minuten nicht in der Party-Gruppe). Stummschalten endet mit Aufheben, Verlassen der Welt (Raum auf einem anderen Server, `leave`) bzw. der Party, spätestens 10 Minuten nachdem das Ziel nicht mehr im Bereich verbunden ist; Wiederverbinden hebt nichts auf. Alles liegt nur im Arbeitsspeicher.

**Voice aus (Wunsch des Server-Betreibers).** Auf Servern der Liste (Domain, auf Wunsch mit allen Subdomains; Antrag über eine Support-Anfrage) gibt es weder Raum noch Gruppe. Betroffene bekommen `room` mit `voice: "off"` und der Meldung „Voice ist auf diesem Server aus (auf Wunsch des Server-Betreibers).“, auch sofort, wenn ein Admin die Domain einträgt; nach dem Austragen sind sie wieder drin.

Neue Nachrichten im WebSocket (zusätzlich zu oben):

| Richtung | Nachricht | Bedeutung |
| --- | --- | --- |
| Dienst → Client | `ready` mit `"rules": { "version": 2 }` oder `null` und `"clips": { "maxMs", "maxBytes" }` oder `null` | veröffentlichte (und angenommene) Version; Aufnahmen aktiv |
| Dienst → Client | `{ "type": "room", "server", "voice": "on" / "off" / "kicked", "message", "until", "world": { "code", "name", "role": "host" / "operator" / "player" } oder null, "party": { "leader": true / false } oder null }` | nach jedem `join` aus dem Spiel und wenn sich Rechte ändern (geprüft bei `join` und `ping`); `party` nur, wenn die Gruppe die Voice-Gruppe der eigenen Party ist |
| Client → Dienst | `{ "type": "mod", "action": "mute" / "unmute" / "kick" / "unkick", "uuid", "scope": "world" / "party" }` | moderieren (zählt zu den 20 Textnachrichten je Sekunde) |
| Dienst → Client | `{ "type": "mod", "status": "ok" / "denied" / "invalid", "action", "uuid", "scope", "message" }` | Antwort an den Moderierenden |
| Dienst → Client | `{ "type": "moderated", "action": "muted" / "unmuted" / "kicked" / "unkicked", "scope", "by": { "uuid", "name" }, "world": { "code", "name" } oder null, "until", "message" }` | an das Ziel, z. B. „Ben hat dich in dieser Welt stummgeschaltet.“; ein noch Stummgeschalteter bekommt `muted` nach dem Wiederverbinden erneut; nach `unkicked` setzt der Dienst Raum bzw. Gruppe selbst wieder |
| Dienst → Client | `{ "type": "group", "status": "kicked", "until", "message" }` | aus der Party-Gruppe entfernt (beim Entfernen und bei jedem `join` mit ihr) |
| Dienst → Client | `peers` mit `"silenced": ["…"]` | wer von den Aufgeführten im geltenden Bereich für alle stumm ist (Raum: Welt, Gruppe: Party); nach jedem Stummschalten und Aufheben bekommen alle im Bereich eine neue Liste |
| Dienst → Client | `{ "type": "clips", "clips": … }`, `rules` + 4012, `banned` + 4013 | siehe oben |

HTTP für Spieler und Gäste:

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/public/voice/rules` | – (ohne Anmeldung, CORS) | `{ "published", "version", "publishedAt", "text", "clips", "limits": { "clipMs": 600000, "clipBytes": 3145728, "deleteAfterDoneDays": 30, "deleteAfterDays": 90, "kickMinutes": 10 } }`; ohne Veröffentlichung `published: false`, `version: null` und der Standardtext |
| `GET /v1/voice/me` | Bearer-Token oder Cookie | `{ "rules": { "version", "accepted", "acceptedAt", "required" }, "clips", "ban": { "reason", "at", "until", "message", "appeal" } oder null, "bans": [ { "reason", "at", "until", "liftedAt" } ] }` |
| `POST /v1/voice/rules/accept` | `{ "version": 2 }` | wie `GET /v1/voice/me`; 409 `voice-rules-version` (mit `version`) bzw. `voice-rules-none` |
| `DELETE /v1/voice/rules/accept` | – | Widerruf; wie `GET /v1/voice/me` |
| `POST /v1/voice/reports` | `{ "uuid", "reason": "insult" / "harassment" / "hate" / "noise" / "other", "note"?, "context"?: { "server", "dimension", "at", "group", "nearby": [ { "uuid", "name"? } ] }, "levels"?: { "end", "rms": [ dBFS oder null ], "peak": [ dBFS oder null ] } }` (höchstens 32 KB) | `{ "reported": true, "id", "clip": { "upload", "maxBytes", "maxMs", "until" } oder null }` |
| `PUT /v1/voice/reports/<id>/clip` | roh, `Content-Type: audio/ogg`, höchstens 3 MiB | `{ "clip": { "size", "durationMs" } }` |
| `POST /v1/public/voice/guest-reports` | `{ "token": "<Gast-Token>", "uuid", "reason", "note"?, "context"?, "levels"? }` (Origin der Webseite) | `{ "reported": true, "id" }` |
| `POST /v1/public/invites/<code>/guest` | ab 1.13.0 zusätzlich `"rulesVersion"` | ohne oder mit alter Version bei veröffentlichten Regeln: 409 `voice-rules` mit `version` |

- **Voice-Meldungen:** Gründe Beleidigung, Belästigung, Hassrede, Anschreien/Lärm, Sonstiges; Notiz höchstens 300 Zeichen (eine Zeile). Melden lassen sich nur Spieler mit Konto (Gäste: 400 `voice-guest`; sie lassen sich aus der Gruppe entfernen), nicht man selbst. Den Kontext vom Client prüft der Dienst und lässt Ungültiges weg (`nearby` höchstens 20); dazu legt er seinen eigenen Kontext aus der Voice-Verbindung des Meldenden ab (Server, Dimension, Gruppe ja/nein, Welt, wer mit frischer Position in Reichweite bzw. in der Gruppe ist, ob der Gemeldete dabei ist). `levels`: je Sekunde höchstens 600 Werte in dBFS (gerundet, −100 bis 0) oder `null` (nichts gehört), gemessen nach dem Dekodieren, vor dem Lautstärke-Schutz.
- **Grenzen:** je Meldendem höchstens 5 Voice-Meldungen je Stunde und 10 je 24 Stunden, denselben Spieler einmal in 24 Stunden (429 mit `Retry-After`); Gäste höchstens 3 je Stunde und Sitzung, dazu 20 je Stunde und IP.
- **Clip-Format:** Ogg mit genau einem Strom (die CRC jeder Seite wird geprüft): `OpusHead` (1–2 Kanäle, Mapping 0), `OpusTags` mit `HELDIX_SPEAKER=<UUID des Gemeldeten>` (Pflicht), `HELDIX_START=<ms>` und `HELDIX_SEGMENTS=<ms im Clip>@<ms Echtzeit>,…` (Beginn jedes Satzes), danach die Opus-Pakete (je 20 ms; Pausen bis 1 s mit Stille `F8 FF FE`, längere auf 1 s gekürzt). Spieldauer höchstens 10 Minuten, Größe höchstens 3 MiB. Hochladen darf nur der Meldende, nur einmal, nur bis 15 Minuten nach der Meldung, nur solange die Meldung offen ist und Aufnahmen aktiv sind. Fehler: 400 `clip-format`, 415 (anderer Typ), 409 `clip-exists` / `clip-off` / `clip-late`, 413, 404.
- **Speicher:** `<Daten>/voice-clips/<id>-<zufall>.clip` mit `HXC1` + IV (12 Byte) + Tag (16 Byte) + AES-256-GCM (zusätzlich an die Nummer der Meldung gebunden). Schlüssel aus `HELDIX_DIENST_VOICE_CLIP_KEY` (der Installer erzeugt ihn beim ersten Lauf in `dienst.env`, siehe [Installer](#installation-mit-einem-befehl-empfohlen)) oder `<Daten>/voice-clips.key` (beim ersten Clip angelegt, Rechte 600). Weder Schlüssel noch Inhalte stehen im Log. Das Aufräumen (alle 10 Minuten und nach dem Löschen eines Kontos) entfernt fällige Clips und Dateien ohne Meldung.

Team-Bereich (`voice:moderate`; Regeln, Schalter und Liste ändern mit `voice:admin`):

| Anfrage | Recht | Inhalt / Antwort |
| --- | --- | --- |
| `GET /v1/team/voice` | moderate | Übersicht: `rules` (veröffentlicht, aktueller Text, Standardtext), `clips` (`active`, `enabled`, `allowed`, `rulesPublished`), `stats` (offene Meldungen, aktive Sperren, verbunden), `limits`, `durations`, `reasons` |
| `GET /v1/team/voice/rules/versions` | moderate | alle Versionen mit Text, Zeitpunkt, wer |
| `POST /v1/team/voice/rules` | admin | `{ "text"? }` (ohne: Standardtext) → `{ "version" }`; schließt alle ohne Zustimmung (4012) |
| `DELETE /v1/team/voice/rules` | admin | zurückziehen |
| `PUT /v1/team/voice/settings` | admin | `{ "clips": true / false }` |
| `GET /v1/team/voice/reports?status=open` (`done`, `all`) | moderate | `{ "reports": [ … ], "players": [ gebündelt je Gemeldetem: Anzahl, offen, verschiedene Meldende, erste/letzte, Gründe, aktive Sperre ], "reasons" }`; jede Meldung mit Kontext (`client`, `service`), `levels`, `clip` (Größe, Dauer, Sätze, `url`, `deleteAt`) und der Verlässlichkeit des Meldenden (`justified`, `unjustified`, `unclear`, `share`) |
| `GET /v1/team/voice/reports/<id>` | moderate | `{ "report" }` |
| `POST /v1/team/voice/reports/<id>/done` | moderate | `{ "outcome": "justified" / "unjustified" / "unclear" }` (Standard `unclear`) |
| `GET /v1/team/voice/clips/<id>` | moderate | `audio/ogg` (entschlüsselt, `no-store`); steht im Protokoll (`voice.clip.play`) |
| `DELETE /v1/team/voice/clips/<id>` | moderate | Aufnahme löschen |
| `GET /v1/team/voice/bans` | moderate | `{ "bans": [aktive], "recent": [letzte 100] }` |
| `PUT /v1/team/voice/bans/<uuid>` | moderate | `{ "duration": "1h" / "24h" / "7d" / "permanent", "reason", "reports"?: [Nummern] }` → Spieler-Ansicht |
| `DELETE /v1/team/voice/bans/<uuid>` | moderate | aufheben → Spieler-Ansicht |
| `GET /v1/team/voice/players/<uuid>` | moderate | Zeitleiste: `ban`, `bans`, `reportsAbout`, `reportsBy` (Verlässlichkeit), `consent`, `timeline`, `audit` (Voice-Einträge im Protokoll) |
| `GET /v1/team/voice/servers` | moderate | Liste „Voice aus“ |
| `PUT /v1/team/voice/servers/<domain>` | admin | `{ "subdomains": bool, "reason", "contact"? }` |
| `DELETE /v1/team/voice/servers/<domain>` | admin | austragen |

Protokoll-Einträge: `voice.rules.publish`, `voice.rules.withdraw`, `voice.clips`, `voice.ban`, `voice.unban`, `voice.report.done`, `voice.clip.play`, `voice.clip.delete`, `voice.server.add`, `voice.server.remove`. `GET /v1/team/dashboard` hat ab 1.13.0 `voiceReports` (offene Voice-Meldungen; ohne `voice:moderate` `null`), `GET /v1/team/reports` zeigt Voice-Meldungen mit `kind: "voice"`.

**Datenauskunft und Löschen:** `GET /v1/me/export` enthält `voice`: Zustimmung, eigene Voice-Sperren (ohne das Team-Mitglied) und eigene Voice-Meldungen mit Kontext und Lautstärke-Verlauf, bei einer Aufnahme nur Größe und Dauer. Meldungen anderer über dich stehen nicht darin. `DELETE /v1/me` löscht Zustimmung und eigene Meldungen (mit ihren Aufnahmen); eine aktive Voice-Sperre bleibt.

**Nur im Entwicklungsmodus** (`HELDIX_DIENST_DEV=1`, nur von diesem Rechner, für den Autotest): `POST /v1/dev/voice/rules { "publish": bool, "clips"?: bool, "text"? }` → `{ "version" }`, `POST /v1/dev/voice/ban { "uuid", "minutes", "reason"? }`, `DELETE /v1/dev/voice/ban/<uuid>`.

#### Server-Gruppen (ab 1.14.0)

Partner-Server teilen ihre Spieler über die [Partner-Schnittstelle](#server-partner-und-partner-schnittstelle) in Server-Gruppen ein (z. B. die Teams eines Minispiels). `ready` nennt dann zusätzlich `"serverGroups"` in `features` und `"maxServerGroup": 100`.

- Wer auf diesem Server eine Server-Gruppe hat (Adresse aus `join` passt zum Server-Eintrag des Partners, auch über eine andere Subdomain), hört **in der Nähe nur Spieler derselben Server-Gruppe**; Spieler ohne Server-Gruppe hören in der Nähe nur Spieler ohne Server-Gruppe. `peers.uuids` und Status-Änderungen (`state`) zeigen nur sie.
- Der **Gruppenkanal** ist die Server-Gruppe: jede Entfernung und Dimension, nur auf diesem Server, bis 100 Spieler (`peers.group`). Die eigene Gruppe bzw. die Party-Gruppe aus `join` ist so lange aus und kommt danach von selbst wieder (der Client schickt seine Gruppe weiter in `join`); Party-Moderation (`mod` mit `scope: "party"`) antwortet dann `denied`.
- Bei jeder Änderung: `{ "type": "serverGroup", "t": "serverGroup", "server": "<Adresse aus join>", "group": "<gruppe>" | null, "partner": "<Name des Partners>" | null }` (`t` steht zusätzlich darin wie im Vertrag zwischen den Teilen; maßgeblich ist `type` wie bei allen Voice-Nachrichten). `group: null`, wenn die Server-Gruppe endet (Plugin entfernt sie, Ablauf, Partner pausiert oder gelöscht, anderer Server, `leave`).
- Nur im Arbeitsspeicher, nichts in Datenbank oder Log; ohne Erneuerung durch das Plugin verfällt jeder Eintrag nach 10 Minuten.

**Einstellungen:** `HELDIX_DIENST_VOICE` (`0` schaltet aus, Standard: an) und `HELDIX_DIENST_VOICE_RANGE` (Reichweite in Blöcken, Standard 48, erlaubt 8–128; ein ungültiger Wert verhindert den Start). Beim Start steht im Log „Voice Chat (/v1/voice): an (Reichweite 48 Blöcke)“ bzw. „aus (HELDIX_DIENST_VOICE=0)“. Ab 1.13.0: `HELDIX_DIENST_VOICE_CLIPS` (`0` schaltet Aufnahmen beim Melden hart ab; Standard: möglich, aktiv erst nach Veröffentlichung der Voice-Regeln) und `HELDIX_DIENST_VOICE_CLIP_KEY` (Schlüssel für Clips, 32 Byte als 64 Hex-Zeichen oder Base64; ohne: `voice-clips.key` im Datenordner). **Empfehlung an den Betreiber:** Vor dem Veröffentlichen der Voice-Regeln (das schaltet die Aufnahmen ein) rechtlich prüfen lassen, vor allem die Einwilligung Minderjähriger und eine Datenschutz-Folgenabschätzung. Zur Bandbreite siehe [docs/einrichtung.md](einrichtung.md#voice-chat-auf-dem-server).

### Welt teilen

Ab Version 1.12.0 (Client 0.13.8). Ein Spieler öffnet seine Einzelspielerwelt für andere, ohne Portfreigabe: Der Dienst nimmt Minecraft-Verbindungen auf `<code>.<Welt-Domain>` an (eigener TCP-Listener, Standard-Port 25565, nicht über Caddy), liest Handshake und Login Start und reicht die Verbindung über WebSockets zum Spiel des Gastgebers durch. Dort öffnet der Client die Welt intern wie „Im LAN öffnen“ und verbindet jeden Datenstrom mit `127.0.0.1:<LAN-Port>`. Jede Welt hat eine feste Adresse, die man wie eine Serveradresse speichern kann; beitreten können auch Spieler ohne HeldixClient (gleiche Minecraft-Version). Der Dienst prüft vorher nur den Namen; die endgültige Prüfung macht der Gastgeber (integrierter Server im Online-Modus, Mojang prüft die Spieler, Zugangsregel mit der echten UUID).

**Aus:** Ohne `HELDIX_DIENST_WELT_DOMAIN` antworten alle Wege unter `/v1/worlds…` und `/v1/public/worlds/…` (auch die WebSockets) mit 503 „Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet.“, es gibt kein Relay, und `/v1/status` zeigt `worlds: null`. Genauso, wenn der Port beim Start nicht zu öffnen ist (z. B. belegt): Der übrige Dienst läuft weiter, im Log steht „WARNUNG: Welt-Relay kann Port … nicht öffnen (…). Welt teilen ist aus.“

- **Code und Adresse:** 6 Zeichen aus `abcdefghjkmnpqrstuvwxyz23456789` (`^[a-hjkmnp-z2-9]{6}$`), gleich verteilt zufällig und für immer gleich; Adresse `<code>.<HELDIX_DIENST_WELT_DOMAIN>`, z. B. `k7m2xq.welt.heldixclient.com`. Die ID (32 Hex-Zeichen) merkt sich der Client in `heldix-welt.json` im Weltordner (`{ "id": "…" }`), damit eine Welt ihre Adresse behält.
- **Zugang** (`access`): `invited` (nur Mitglieder, Standard), `friends` (Mitglieder und Heldix-Freunde des Gastgebers), `open` (jeder mit der Adresse). **Rollen** (`role`, `defaultRole`): `visitor` (Abenteuer), `player` (Spielmodus der Welt, Standard), `operator` (dazu Befehle); umsetzen tut sie der Client des Gastgebers.

`World` = `{ "id", "code", "address", "name", "access", "maxPlayers": 1–20, "defaultRole", "created": <ms>, "lastOnline": <ms> | null, "online": bool, "players": n, "version": "<Minecraft-Version>" | null }`. `lastOnline` ist der Zeitpunkt des letzten Öffnens bzw. Schließens, `version` die zuletzt gemeldete Minecraft-Version (bleibt auch bei geschlossener Welt). `players` zählt die Spieler mit dem Gastgeber: den größeren Wert aus seiner Meldung (`players`) und 1 plus die offenen Spieler-Verbindungen über das Relay; geschlossen 0.

`Member` = `{ "name", "uuid": "<uuid>" | null, "role", "added": <ms> }`

`FriendWorld` = `{ "id", "name", "address", "host": { "uuid", "name" }, "players", "maxPlayers", "version", "online": true }`; ab 1.13.0 bei dauerhaften Welten (nur in `GET /v1/worlds`) `{ …, "online": bool, "hosted": { "state": "sleeping" | "starting" | "running" | "stopping" } }` mit `online` = läuft und `players`/`version` vom Server.

Angemeldet (Bearer-Token oder Cookie mit CSRF-Schutz):

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/worlds` | – | `{ "mine": [World], "friends": [FriendWorld] }` |
| `POST /v1/worlds` | `{ "name"?, "access"?, "maxPlayers"?, "defaultRole"? }` | `World` |
| `GET /v1/worlds/<id>` | – | `World` |
| `PATCH /v1/worlds/<id>` | Teil von `{ "name", "access", "maxPlayers", "defaultRole" }` | `World` |
| `DELETE /v1/worlds/<id>` | – | `{ "ok": true }` |
| `GET /v1/worlds/<id>/members` | – | `[Member]` (nach Namen sortiert) |
| `PUT /v1/worlds/<id>/members/<name>` | `{ "role"? }` | `[Member]` |
| `DELETE /v1/worlds/<id>/members/<name>` | – | `[Member]` |
| `POST /v1/worlds/<id>/invite` | `{ "uuids": ["<Freund>", …] }` | `{ "invited": [{ "uuid", "name" }], "members": [Member] }` |

- **Anlegen:** `name` 1–32 Zeichen ohne Steuerzeichen (getrimmt; Standard „Welt von <Spielername>“), `access` Standard `invited`, `maxPlayers` Standard 8 (1–20), `defaultRole` Standard `player`. Ungültige Werte: 400. Höchstens 10 Welten je Spieler, sonst 409 „Du hast schon 10 Welten. Lösch eine, bevor du eine neue anlegst.“ Geöffnet sein kann davon eine (siehe Steuerverbindung).
- **Nur eigene Welten:** Fremde oder unbekannte IDs ergeben 404 „Diese Welt gibt es nicht (mehr).“ Unbekannte Felder in `PATCH` ignoriert der Dienst. Ist die Welt gerade offen, bekommt der Gastgeber nach `PATCH` die Nachricht `settings`, nach Änderungen an Mitgliedern `members`.
- **Löschen:** löscht die Welt mit allen Mitgliedern. Ist sie gerade offen, bekommt der Gastgeber `{ "type": "error", "message": "Die Welt wurde gelöscht." }`, und die Steuerverbindung schließt mit 4010.
- **Mitglieder:** Name wie bei Minecraft (`^[A-Za-z0-9_]{1,16}$`, sonst 400), ohne Groß-/Kleinschreibung eindeutig (die zuletzt benutzte Schreibweise bleibt). `role` fehlt: Standardrolle der Welt; ein vorhandenes Mitglied bekommt die neue Rolle, `added` bleibt. `uuid` setzt der Dienst, wenn ein HeldixClient-Spieler gerade so heißt (sonst `null`). Höchstens 200 Mitglieder je Welt (409). Entfernen geht auch, wenn der Name nicht auf der Liste steht.
- **Einladen:** `uuids` 1–50 UUIDs; nur Freunde, andere überspringt der Dienst (sie stehen nicht in `invited`). Jeder Freund wird Mitglied mit der Standardrolle (eine vorhandene Rolle bleibt) und bekommt über Echtzeit `{ "type": "world-invite", "world": { "id", "name", "address", "host": { "uuid", "name" } } }`, auch wenn die Welt gerade zu ist.
- **`friends` in `GET`:** gerade geöffnete Welten von Freunden mit Zugang `friends` oder `open`, wenn der Gastgeber seinen Online-Status für Freunde an hat (`presence`), und Welten, in denen man Mitglied ist (über die UUID, Einträge ohne UUID über den Namen), auch mit `presence` aus. Nie die eigene und nie, wenn einer den anderen blockiert hat. Ab 1.13.0 nach denselben Regeln auch **dauerhafte Welten** mit `hosted: { "state" }`, auch wenn sie schlafen (Beitreten weckt sie) und der Besitzer offline ist; nicht, solange sie eingerichtet werden (`creating`) oder einen Fehler haben (`error`). Sortiert nach Gastgeber, dann Name. Dieselbe Gruppe bekommt bei geöffneten Welten `world-open` (beim Öffnen und bei jeder Änderung) und `world-closed`, siehe [Echtzeit](#echtzeit-websocket); für dauerhafte Welten gibt es diese Nachrichten nicht (Liste neu abfragen).

Öffentlich (ohne Anmeldung, `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`): `GET /v1/public/worlds/<code>` → `{ "name", "address", "host": { "uuid", "name" }, "online": bool, "players", "maxPlayers", "version": "<Version>" | null, "access": "open" | "closed" }` für die Webseite `/welt#<code>`. `access` ist `open` nur bei Zugang `open`, sonst `closed`. Unbekannt oder falsch geformt: 404 „Diese Welt gibt es nicht.“ Höchstens 60 pro Minute und IP, sonst 429.

#### Steuerverbindung des Gastgebers

`GET /v1/worlds/host` als WebSocket mit `Authorization: Bearer <token>` (zählt zur Grenze von 120 Anfragen pro Minute und Token). Ohne gültiges Token 401, normales GET 426, Welt teilen aus 503. Pro Spieler gibt es höchstens eine Steuerverbindung: Eine neue schließt die alte mit 4002 („Neue Verbindung“), deren Welt geht dabei zu. Nachrichten sind JSON-Texte bis 16 KB, höchstens 20 pro Sekunde (der Rest wird verworfen); unbekannte ignoriert der Dienst.

Client → Dienst:

| Nachricht | Bedeutung |
| --- | --- |
| `{ "type": "open", "world": "<id>", "version": "26.3", "protocol": 775, "motd": "<Text>" }` | Eigene Welt öffnen. `version` muss zu `^[A-Za-z0-9._+-]{1,32}$` passen, `protocol` eine ganze Zahl von 0 bis 2147483647 sein (Snapshots nutzen hohe Nummern). `motd` ist freiwillig (Standard „Welt von <Name>“, Zeilenumbruch erlaubt, andere Steuerzeichen werden zu Leerzeichen, höchstens 256 Zeichen). Antwort `ready`; fremde oder unbekannte Welt bzw. ungültige Werte: `error` und Schließen (4011). Ist auf dieser Verbindung schon eine andere Welt offen, geht sie zu (eine geöffnete Welt je Spieler); dieselbe Welt noch einmal aktualisiert Version, Protokoll und MOTD. Weitere Felder (z. B. `lanReady`) ignoriert der Dienst. |
| `{ "type": "players", "count": 2 }` | Spielerzahl der Welt mit dem Gastgeber (0–1000), bei jeder Änderung. |
| `{ "type": "allow", "name": "<Name>" }` | Angeklopften Spieler hereinlassen: Er wird Mitglied mit der Standardrolle; der Gastgeber bekommt `members`. |
| `{ "type": "deny", "name": "<Name>" }` | Ablehnen: 10 Minuten lang klopft dieser Name nicht mehr an und bekommt „Der Gastgeber hat deine Anfrage abgelehnt.“ |
| `{ "type": "ping" }` | etwa alle 20 Sekunden; Antwort `{ "type": "pong" }`. Ohne jede Nachricht 60 Sekunden lang schließt der Dienst mit 4000. |
| `{ "type": "close" }` | Teilen beenden: Die Welt geht zu (alle Datenströme schließen), die Verbindung bleibt für ein neues `open`. |

Dienst → Client:
- `{ "type": "ready", "address": "<code>.<Welt-Domain>", "code": "<code>", "world": World }` nach `open`; direkt danach `{ "type": "members", "members": [Member] }`.
- `{ "type": "stream", "id": "<32 Hex-Zeichen>", "kind": "status" | "login", "name": "<Name aus Login Start>" | null }`: Ein Spieler will die Serverliste sehen (`status`, `name` ist `null`) bzw. beitreten (`login`). Der Client öffnet dafür einen Datenstrom (unten) und verbindet ihn mit `127.0.0.1:<LAN-Port>`. Eine IP-Adresse steht nirgends dabei.
- `{ "type": "knock", "name": "<Name>" }`: Ein nicht zugelassener Spieler hat angeklopft (Toast „<Name> möchte beitreten – Erlauben/Ablehnen“).
- `{ "type": "members", "members": [Member] }`, wenn sich die Mitglieder ändern (`allow`, Einladen, `PUT`/`DELETE` über Launcher oder Webseite), damit der Gastgeber mit der aktuellen Liste prüft.
- `{ "type": "settings", "world": World }` nach einem `PATCH` (Zugang, Höchstzahl, Standardrolle, Name).
- `{ "type": "error", "message": "<Text>" }`, danach schließt der Dienst (4011, beim Löschen der Welt 4010).
- `{ "type": "pong" }`.

**Schließcodes:** 4000 „Zeitüberschreitung“, 4001 „Konto gelöscht“, 4002 „Neue Verbindung“, 4003 „Gesperrt“ (Sperre im Team-Bereich sofort, über `heldix-dienst-admin` beim nächsten `ping`), 4010 „Welt gelöscht“, 4011 „Fehler“ (nach `error`). Wie bei den anderen WebSockets wartet der Dienst höchstens 2 Sekunden auf die Antwort und trennt dann hart.

#### Datenströme

`GET /v1/worlds/streams/<id>` als WebSocket mit `Authorization: Bearer <token>`: nur für den Gastgeber der Welt dieses Datenstroms, nur solange die Welt offen ist und der Datenstrom wartet, und nur einmal; sonst 404 „Diesen Datenstrom gibt es nicht (mehr).“ (ohne Token 401). Datenströme zählen nicht zur Grenze von 120 Anfragen pro Minute (ihre Zahl begrenzt das Relay).

- **Inhalt:** nur Binärnachrichten (Textnachrichten ignoriert der Dienst), höchstens 1 MiB je Nachricht (größere trennt der Dienst mit 1009). Der Dienst schickt **zuerst die gepufferten Bytes** als eine Nachricht: den Handshake und beim Login auch Login Start, dazu alles, was der Spieler bis dahin geschickt hat. Danach reicht er beide Richtungen unverändert durch.
- **Wartezeit:** Öffnet der Gastgeber den Datenstrom nicht innerhalb von 10 Sekunden, trennt der Dienst den Spieler (beim Login mit „Der Gastgeber antwortet gerade nicht. Versuch es gleich noch einmal.“).
- **Ende:** Trennt der Spieler, schließt der Dienst den Datenstrom (1000); schließt der Gastgeber den Datenstrom, schreibt der Dienst noch alles Ausstehende zum Spieler und trennt ihn. Geht die Welt zu (`close`, Steuerverbindung getrennt oder ersetzt, Welt oder Konto gelöscht), schließen alle ihre Datenströme. 60 Sekunden ohne Bytes in beide Richtungen schließen einen Datenstrom ebenfalls (im Spiel halten die Keepalives von Minecraft ihn offen).
- **Gegendruck:** Liegen mehr als 1 MiB ungesendet beim Gastgeber, liest der Dienst vom Spieler erst weiter, wenn es unter 256 KiB sind; schreibt der Spieler nicht hinterher, liest er vom Gastgeber erst nach dem Abfluss weiter. So puffert der Dienst je Datenstrom nur wenig.

#### Relay

Ein eigener TCP-Listener auf `HELDIX_DIENST_WELT_BIND:HELDIX_DIENST_WELT_PORT` (Standard `0.0.0.0:25565`). Bis zum Durchreichen liest er nur das Nötigste, unverschlüsselt und unkomprimiert wie jeder Minecraft-Server:

1. **Handshake** (`[VarInt Länge][VarInt 0x00][VarInt Protokoll][String Adresse][UShort Port][VarInt Zustand]`) innerhalb von 5 Sekunden ab dem Verbinden (bis einschließlich Login Start bzw. Ping), höchstens 300 Byte, Adresse höchstens 255 Byte. Die Adresse wird nach `\0` abgeschnitten (Mod-Loader), klein geschrieben, ein `:<port>` und ein Punkt am Ende fallen weg; `<code>.<Welt-Domain>` ergibt die Welt. Teilpakete sammelt das Relay (höchstens 4 KB vor dem Durchreichen). Legacy-Ping (erstes Byte `0xFE`, Minecraft vor 1.7), unbekannte Pakete, zu lange oder ungültige Daten: schließen ohne Antwort.
2. **Status** (Zustand 1, Serverliste): Welt offen → Datenstrom `kind: "status"`, der integrierte Server antwortet selbst (echtes MOTD, Spielerzahl; ab HeldixClient 0.13.9 setzt der Gastgeber für die Zeit des Teilens das MOTD „<Welt> · von <Gastgeber>“ / „Geteilt mit HeldixClient · <Webseite>“ und als Symbol das Bild der Welt mit dem Heldix-Logo). Welt zu → eigene Antwort `{ "version": { "name": "HeldixClient", "protocol": <vom Client> }, "players": { "max": 0, "online": 0 }, "description": { "text": "Welt von <Gastgeber> ist gerade nicht geöffnet", "color": "gray", "extra": [<Zeilenumbruch>, „Geteilt mit HeldixClient“ (ab 1.12.1, mit eingestellter Webseite dahinter „ · <Webseite>“)] } }`, unbekannte Adresse „Diese Welt gibt es nicht“ (mit derselben Werbezeile); danach Ping/Pong (8 Byte zurück) und Schließen. Kommen für eine offene Welt mehr als 30 Abfragen pro Minute oder warten schon 16 Datenströme, antwortet das Relay selbst mit Version, Protokoll, MOTD und Spielerzahl aus `open` bzw. `players`.
3. **Login** (Zustand 2, ebenso 3 = Transfer): Login Start lesen (Name, `^[A-Za-z0-9_]{1,16}$`, sonst „Ungültiger Spielername.“; die UUID danach liest das Relay nicht). Dann der Reihe nach, jeweils als Disconnect beim Login (Paket 0x00 mit JSON-Text-Komponente `{ "text": "…" }`):

   | Fall | Text |
   | --- | --- |
   | Adresse unbekannt | „Diese Welt gibt es nicht. Prüf die Adresse.“ |
   | Welt zu | „Die Welt ist gerade nicht geöffnet.“ |
   | nicht zugelassen (Gastgeber bekommt `knock`) | „Du bist noch nicht eingeladen – <Gastgeber> wurde gefragt. Versuch es gleich noch einmal.“ |
   | nach `deny` (10 Minuten) | „Der Gastgeber hat deine Anfrage abgelehnt.“ |
   | voll (`players` ≥ `maxPlayers`) | „Die Welt ist voll (höchstens <n> Spieler).“ |
   | schon 16 Datenströme warten | „Gerade wollen zu viele gleichzeitig beitreten. Versuch es gleich noch einmal.“ |

   Sonst Datenstrom `kind: "login"` mit dem Namen. **Zugelassen** sind: Mitglieder (Name auf der Liste, oder ein Mitglied mit UUID heißt inzwischen so), der Gastgeber selbst, bei `friends` HeldixClient-Freunde des Gastgebers, die gerade so heißen, bei `open` alle. Hat ein HeldixClient-Spieler dieses Namens den Gastgeber blockiert oder umgekehrt (und steht er nicht ausdrücklich auf der Liste), kommt er nicht durch; er bekommt denselben Text wie „nicht eingeladen“, angeklopft wird nicht. Anklopfen: je Name höchstens alle 30 Sekunden, je Welt höchstens 10 pro Minute.

**Grenzen:** höchstens 20 neue Verbindungen pro Minute und IP (IPv6 je /64), 16 gleichzeitig je IP und 2000 insgesamt (darüber trennt das Relay sofort); 4 MiB/s je Welt, beide Richtungen und alle Spieler zusammen (darüber hält der Dienst die Daten kurz zurück und liest langsamer, mit einer Sekunde Vorrat); dazu die Grenzen der Datenströme oben. Spieler je Welt: `maxPlayers`.

**Nichts gespeichert, nichts geloggt:** IP-Adressen, Inhalte der Verbindungen, Namen aus Login Start und Codes stehen in keinem Log und keiner Datenbank. IP-Adressen gehen nie an den Gastgeber; die Zähler für die Grenzen liegen nur im Arbeitsspeicher (eine Minute). In der Datenbank stehen nur Welten und Mitglieder (siehe [Datenschutz](#datenschutz)).

**Einstellungen:** `HELDIX_DIENST_WELT_DOMAIN` (z. B. `welt.heldixclient.com`; ohne: aus), `HELDIX_DIENST_WELT_PORT` (Standard 25565) und `HELDIX_DIENST_WELT_BIND` (Standard `0.0.0.0`, `::` für IPv4 und IPv6). Ungültige Werte verhindern den Start. Für den Betrieb siehe [Welt teilen auf dem Server](#welt-teilen-auf-dem-server).

**Ergänzungen zur gemeinsamen Vorgabe** (Client darf sie ignorieren): `World` hat zusätzlich `online`, `players` und `version`; `GET /v1/worlds/<id>` gibt es zusätzlich; `GET /v1/public/worlds/<code>` hat zusätzlich `address`; `ready` hat zusätzlich `world`; die Nachrichten `members`, `settings` (Dienst → Gastgeber) und `world-open`/`world-closed` (Echtzeit) sind neu; nach `deny` gibt es den eigenen Text oben. Die Antwort von `POST …/invite` und die Schließcodes 4010/4011 legt erst der Dienst fest. Eine Nachricht `status` vom Dienst an den Gastgeber gibt es nicht: Die Spielerzahl meldet der Gastgeber selbst (`players`).

### Dauerhafte Welten

Ab Version 1.13.0 (Client 0.14.0). Eine geteilte Welt kann „dauerhaft online“ gestellt werden: Sie läuft dann als echter Minecraft-Server auf dem Heldix-Server – **Paper** (damit Plugins gehen), sonst der Vanilla-Server von Mojang – auch wenn ihr Besitzer offline ist. Adresse, Code, Mitglieder, Rollen und Anklopfen bleiben wie bei [Welt teilen](#welt-teilen); das Relay reicht Verbindungen nur an den Server statt an den Tunnel des Gastgebers. Leere Welten **schlafen** (Server aus) und **wachen beim Beitreten auf**. Verwaltet wird auf der Webseite (Konto → Meine Welten) und im Spiel (Heldix-Welten).

**Betrieb der Server:** Der Dienst hat keinen Docker-Zugriff. Er spricht über einen Unix-Socket mit dem **Welten-Wächter** (`heldix-welten-agent`, eigener Prozess, siehe [service/src/agent/](../service/src/agent)), der jede Welt in einem eigenen, abgeschotteten Container betreibt (`HELDIX_DIENST_WELTEN_AGENT`). Nur für Entwicklung und Tests gibt es den **ProcessRunner** (`HELDIX_DIENST_DEV=1` und `HELDIX_DIENST_WELTEN_JAVA`): Java-Prozesse ohne Container, Daten unter `<Datenordner>/hosting-dev/`; ohne `HELDIX_DIENST_DEV=1` verweigert er den Start. Beide erfüllen die Schnittstelle `HostingRunner` ([service/src/hosting/runner.ts](../service/src/hosting/runner.ts)).

**Aus:** Ohne Runner oder ohne Welt teilen antwortet `GET /v1/hosting` mit `{ "allowed": false, "reason": "off", "team", "limits": null, "worlds": [], "operated": [] }`, alle anderen `/v1/hosting…`-Routen mit 503 „Dauerhafte Welten sind auf diesem Heldix-Dienst nicht eingerichtet.“, und `/v1/status` zeigt `hosted: null`.

- **Wer darf:** alle Team-Mitglieder (jede Rolle) und Spieler mit der Freischaltung **„Beta: Dauerhafte Welten“** (Team-Bereich, Recht `hosting:grant`; Tabelle `hosting_grants` mit Quelle `beta`, später zusätzlich `plus` für Heldix+). Sonst 403 `code: "beta"` „Dauerhafte Welten sind gerade in der Beta – bald mit Heldix+.“ Entzieht das Team die Freischaltung, halten laufende Welten an; Start und Aufwecken gehen dann nicht mehr („Diese dauerhafte Welt ist gerade pausiert.“).
- **Grenzen:** 1 dauerhafte Welt je Spieler, 2 je Team-Mitglied (409 `limit`); je Welt 3 GB RAM (davon ~85 % für Java), 6 GB Speicher (Welt, Plugins, Konfiguration und Sicherungen ohne die täglichen; voll: 409 `disk-full`), 30 Plugins (409 `plugin-limit`), höchstens 20 Spieler. Das Team ändert die Grenzen je Welt (RAM, Speicher, Plugins, Schlafen nach bis „nie“).
- **Gleichzeitig laufende Welten:** `HELDIX_DIENST_WELTEN_MAX`, sonst aus dem RAM des Servers `floor((RAM − 6 GB) / 3 GB)`, mindestens 1 (bei 32 GB: 8). Starten, Aufwachen und Wach-bleiben zählen; sind alle Plätze belegt, gibt es 503 bzw. beim Beitreten „Gerade sind alle Plätze belegt – versuch es in ein paar Minuten noch einmal.“ (keine Warteschlange, kein Vorrang).
- **Lebenszyklus:** `creating` (einrichten: Server-Jar laden und prüfen, Datenordner, server.properties, EULA, Symbol; bei einer bestehenden Welt danach Upload) → `sleeping` ⇄ `starting` → `running` → `stopping` → `sleeping`, dazu `error` mit Text. Bereit ist ein Server, sobald er auf eine Status-Abfrage an seinen Port antwortet oder „Done (…)!“ im Log steht (sonst nach 5 Minuten `error`). Beendet sich ein Server ohne Auftrag, schläft die Welt mit Hinweis in `error` (beim nächsten Beitreten startet sie neu); nach drei Abstürzen in 30 Minuten `error`. `stop` in der Konsole ist kein Absturz.
- **Schlafen:** nach 10 Minuten ohne Spieler (einstellbar 5–60, Team: `0` = nie). Die Spielerzahl kommt aus den Log-Zeilen „<Name> joined the game“ / „<Name> left the game“ (Chat-Zeilen zählen nicht) und wird jede Minute per Status-Abfrage am Port abgeglichen.
- **Aufwachen beim Beitreten:** Ein Login (nach der Zugangsprüfung) für eine schlafende Welt startet sie und trennt mit „Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.“; die Serverliste zeigt „<Welt> schläft – zum Aufwecken einfach beitreten“ bzw. „<Welt> startet gerade …“ (grau, darunter die Werbezeile „Geteilt mit HeldixClient · <Webseite>“). Läuft die Welt, gehen Status und Login per TCP an `127.0.0.1:<Port>` des Servers (`online-mode=true`, Mojang prüft jeden Spieler). Anklopfen weckt nie.
- **Zugang und Rollen:** wie bei Welt teilen (Mitglied, Party, Freund bei „Freunde“, jeder bei „offen“; Blockierte merken nichts). Nicht Zugelassene klopfen an; Besitzer und Operatoren bekommen `hosting-knock` und antworten mit `POST …/knocks/<name>`. Beim Beitreten setzt der Dienst die Rolle per Konsole: Besitzer und Operatoren `op`, Besucher `gamemode adventure`; wer kein Operator mehr ist, bekommt `deop`, ein früherer Besucher wieder den Spielmodus der Welt (auch sofort, wenn sich die Rolle ändert, während er online ist). Die Beschreibung (MOTD) ist fest: Name der Welt und „Geteilt mit HeldixClient · <Webseite>“; das Symbol ist das Bild der Welt mit Heldix-Plakette.
- **Welt teilen derselben Welt:** Sobald eine Welt dauerhaft ist, schließt der Dienst eine offene Tunnel-Sitzung und lehnt `open` ab: `{ "type": "error", "message": "Diese Welt läuft dauerhaft auf dem Heldix-Server. Tritt ihr über die Adresse bei, statt sie selbst zu teilen.", "code": "hosted" }`, danach 4011.
- **Server-Software:** Paper über die Fill-API v3 (`https://fill.papermc.io/v3/projects/paper/versions/<mc>/builds/latest`, nur Kanal `STABLE`, sonst der neueste stabile aus `builds?channel=STABLE`; Jar nur von `fill-data.papermc.io` mit SHA-256). Gibt es für die Version kein Paper, der Vanilla-Server aus dem Versions-Manifest von Mojang (`piston-data.mojang.com`, SHA-1; dann ohne Plugins, `notice`). Antworten merkt sich der Dienst eine Stunde. User-Agent `heldix-dienst/<Version> (<Host der Webseite>)`.
- **Sicherungen:** täglich für Welten, die seit der letzten gelaufen sind (die letzten 7), vor jedem Plugin-Wechsel, Versionswechsel, Import und Wiederherstellen (die letzten 5) und von Hand (höchstens 5). Läuft die Welt, schickt der Dienst vorher `save-off` und `save-all flush` und danach `save-on`. Wiederherstellen nur, wenn sie schläft; dabei kommt auch die Liste der Plugins von damals zurück.

`HostedWorld` = `{ "id", "code", "address", "name", "state", "error": "<Text>" | null, "version", "software": "paper" | "vanilla", "paperBuild": n | null, "players", "maxPlayers", "ram": { "used", "limit" }, "disk": { "used", "limit" }, "sleepAfterMin", "createdAt", "lastStartedAt": <ms> | null, "plugins": n, "maxPlugins", "role": "owner" | "operator", "owner": { "uuid", "name" }, "access", "awaitingUpload": bool, "restartNeeded": bool, "notice": "<Text>" | null, "upload": UploadView | null }` (MB; `disk.used` ohne tägliche Sicherungen; `upload` nur für den Besitzer). `UploadView` = `{ "chunkSize", "chunks", "size", "received": [n], "maxBytes", "expiresAt" }`.

**Rollen:** Besitzer der geteilten Welt = Besitzer; Mitglieder mit Rolle `operator` dürfen ansehen, starten, anhalten, neu starten, Konsole und Befehle, Anklopfen beantworten und Einstellungen, Plugins und Plugin-Dateien lesen. Alles Ändernde nur der Besitzer (sonst 403 „Das darf nur der Besitzer der Welt.“). Fremde: 404 „Diese dauerhafte Welt gibt es nicht (mehr).“

Angemeldet (Bearer-Token oder Cookie mit CSRF-Schutz), `…` = `/v1/hosting/worlds/<id>`:

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/hosting` | – | `{ "allowed", "reason": "off" \| "beta" \| null, "team", "limits", "worlds": [HostedWorld], "operated": [HostedWorld] }` |
| `POST /v1/hosting/worlds` | `{ "world": "<id>" \| null, "name"?, "seed"?, "gameMode"?, "difficulty"?, "type"?: "normal" \| "flat", "version"? }` | `HostedWorld` (`creating`) |
| `GET …` | – | `HostedWorld` mit `knocks: [{ "name", "at" }]` und `members: [Member]` |
| `PATCH …` (Besitzer) | `{ "name"?, "sleepAfterMin"?: 5–60, "version"? }` | `HostedWorld` |
| `DELETE …` (Besitzer) | – | `{ "ok": true }`: dauerhaft beenden (Server und Daten beim Runner weg, die geteilte Welt bleibt) |
| `POST …/start`, `…/stop`, `…/restart` | – | `HostedWorld` (Zustand folgt per `hosting-state`) |
| `GET …/console?lines=1–500` | – | `{ "state", "lines": ["…"] }` |
| `POST …/command` | `{ "command" }` (eine Zeile, 1–256 Zeichen, führendes „/“ fällt weg; nur wenn sie läuft) | `{ "ok": true }` |
| `POST …/knocks/<name>` | `{ "allow": bool }` | `{ "allowed", "members": [Member] }` (zulassen: Mitglied mit Standardrolle; ablehnen: 10 Minuten) |
| `GET …/properties` | – | `{ "properties", "motd", "rules", "restartNeeded" }` |
| `PATCH …/properties` (Besitzer) | `{ "<Schlüssel>": Wert }` | wie `GET` |
| `GET …/plugins[?updates=1]` | – | `{ "plugins": [Plugin], "max", "software", "version", "restartNeeded", "notice" }` |
| `POST …/plugins` (Besitzer) | `{ "project": "<ID oder Slug>", "version"? }` | `{ "plugin": Plugin, "restartNeeded", "notice" }` |
| `POST …/plugins/<project>/update`, `DELETE …/plugins/<project>` (Besitzer) | – | `{ "updated", "plugin" }` bzw. `{ "ok": true }`, je mit `restartNeeded` |
| `GET …/files`, `GET …/files?path=plugins/…` | – | `{ "files": ["plugins/…"] }` bzw. `{ "path", "content" }` |
| `PUT …/files?path=plugins/…` (Besitzer) | `{ "content" }` (≤ 256 KB) | `{ "ok": true, "path", "restartNeeded" }` |
| `GET …/backups`, `POST …/backups` (Besitzer) | – | `{ "backups": [Backup], "keepDaily": 7, "maxManual": 5 }` bzw. `{ "backup": Backup }` |
| `POST …/backups/<name>/restore`, `DELETE …/backups/<name>` (Besitzer) | – | `{ "ok": true, … }` |
| `GET …/backups/<name>/download`, `GET …/download` (Besitzer) | – | ZIP (Sicherung bzw. Welt im Einzelspieler-Format) |
| `POST …/upload` (Besitzer) | `{ "size" }` | `UploadView` |
| `PUT …/upload/<n>` (Besitzer) | roher Körper, genau `chunkSize` Byte (das letzte Teil den Rest) | `UploadView` |
| `POST …/upload/finish` (Besitzer) | `{ "sha256" }` | `HostedWorld` (`sleeping`) |
| `DELETE …/upload` (Besitzer) | – | `{ "ok": true }` |
| `GET /v1/hosting/plugins/search?q=&version=&offset=&limit=` | – | `{ "hits": [PluginHit], "total", "offset", "limit" }` |
| `GET /v1/hosting/plugins/<project>`, `…/<project>/versions?version=` | – | Projekt bzw. `{ "versions": [PluginVersion] }` |

- **Anlegen:** `world` = ID einer eigenen geteilten Welt (dann `awaitingUpload: true`, die Welt kommt per Upload), `null` = neue Welt (der Dienst legt dazu eine geteilte Welt an; Seed ≤ 64 Zeichen, Typ normal/flach, Spielmodus, Schwierigkeit). `version` Standard: Version der geteilten Welt bzw. die neueste mit stabilem Paper-Build. Gibt es keinen Server für die Version: 400.
- **Upload** (ZIP der Einzelspielerwelt wie die Sicherungen des Clients, `level.dat` ganz oben oder in genau einem Ordner): in Teilen zu 8 MiB (beliebige Reihenfolge, wiederholbar), höchstens 2 GiB; Teile kommen direkt an ihre Stelle in `<Datenordner>/hosting-uploads/uploads/<id>/welt.zip`. `finish` prüft Vollständigkeit (409 `missing-chunks` mit `missing`) und SHA-256 (400 `checksum`), dann den Inhalt: keine absoluten Pfade, kein „..“, keine Backslashes oder Steuerzeichen, keine Symlinks oder Sonderdateien, keine Verschlüsselung, keine doppelten oder überlappenden Einträge, höchstens 200 000 Einträge und 6 GB entpackt, Größen und CRC-32 stimmen (400 `zip-rejected` mit Grund). Danach übernimmt der Runner die Welt (`importWorld`); Bukkit/Paper teilt Nether und End beim ersten Start selbst auf. Ersetzt der Upload eine bestehende Welt, legt der Dienst vorher „vor-import-…“ an. Nur, wenn die Welt schläft (409 `not-sleeping`). Unfertige Uploads verfallen nach 2 Stunden ohne neues Teil.
- **Download:** `GET …/download` liefert die Welt im Einzelspieler-Format (`world_nether/DIM-1` → `DIM-1`, `world_the_end/DIM1` → `DIM1`), höchstens 10 Downloads (Welt und Sicherungen) pro Stunde und Spieler. Die Datei liegt nur für den Download in `<Datenordner>/hosting-uploads/downloads/`.
- **server.properties:** änderbar `difficulty`, `gamemode`, `pvp`, `max-players` (1–20, gleich `maxPlayers` der Welt), `view-distance` und `simulation-distance` (4–16), `spawn-protection` (0–64), `allow-flight`, `generate-structures`, `hardcore`, `force-gamemode`, `spawn-monsters`, `allow-nether`; `level-seed` und `level-type` nur beim Anlegen, `motd` nie (400). Läuft die Welt, wirkt eine Änderung nach einem Neustart (`restartNeeded`).
- **Plugins** nur aus dem Modrinth-Katalog, keine eigenen Dateien. Suche über den Dienst (`/v2/search` mit den Facets `project_type:plugin`, `categories:paper`/`bukkit`/`spigot`, `versions:<mc>`), Antworten 5 Minuten im Speicher, höchstens 60 Suchen pro Minute und Spieler. Beim Installieren wählt der Dienst die neueste Version für Paper/Bukkit/Spigot/Purpur und die Minecraft-Version der Welt (Release vor Beta vor Alpha), nur eine Jar von `cdn.modrinth.com` mit SHA-512 aus der API; der Runner lädt und prüft sie. Vorher legt der Dienst „vor-plugin-…“ an. `Plugin` = `{ "project", "slug", "title", "icon", "version", "versionId", "file", "installedAt", "url": "https://modrinth.com/plugin/<slug>", "update": { "versionId", "version" } | null }`. Vanilla-Welten: 409 `vanilla`.
- **Plugin-Dateien:** nur Textdateien unter `plugins/` (yml, yaml, json, properties, txt, toml), höchstens 256 KB, ohne „..“; Pfade relativ zum Datenordner der Welt.
- `Backup` = `{ "name", "kind": "daily" | "manual" | "before-plugin" | "before-version" | "before-import" | "before-restore", "sizeBytes", "createdAt" }`, Namen `[hand-|vor-plugin-|vor-version-|vor-import-|vor-wiederherstellen-]JJJJ-MM-TT_hh-mm-ss` (UTC).

**Echtzeit** über `/v1/ws`: `hosting-state` (`{ "world": HostedWorld }` an Besitzer und Operatoren bei jeder Änderung, beim Löschen `{ "world": { "id", "state": "deleted" } }`), `hosting-log` (`{ "world", "lines": [] }`, nur an Verbindungen mit `{ "type": "hosting-subscribe", "world" }` von Besitzer oder Operatoren, gebündelt etwa alle 250 ms, höchstens 200 Zeilen je Sekunde; `hosting-unsubscribe` beendet das Abo, verliert jemand die Rolle, endet es von selbst), `hosting-knock` und `hosting-granted` (siehe [Echtzeit](#echtzeit-websocket)).

**Bestehende Antworten:** `World` (`/v1/worlds…`) und `GET /v1/public/worlds/<code>` haben bei dauerhaften Welten zusätzlich `hosted: { "state" }`; `online` heißt dann „läuft“, `players` und `version` kommen vom Server. `friends` in `GET /v1/worlds` enthält dauerhafte Welten von Freunden (Zugang `friends`/`open`, Präsenz des Besitzers an) und mit Mitgliedschaft, auch schlafend (außer `creating` und `error`), siehe [Welt teilen](#welt-teilen).

**Nur im Entwicklungsmodus** (`HELDIX_DIENST_DEV=1`, nur von diesem Rechner und nicht über einen Proxy, für den Autotest im echten Spiel): `POST /v1/dev/hosting/grant` mit `{ "uuid" }` oder `{ "name" }` (auch als `?uuid=`/`?name=`) setzt die Freischaltung „Beta: Dauerhafte Welten“, `DELETE /v1/dev/hosting/grant` (gleiche Angaben) entfernt sie. Antwort `{ "uuid", "name", "added" | "removed", "allowed", "grants": [Grant] }`; wie im Team-Bereich mit `hosting-granted`, Protokoll-Eintrag als „Autotest“, und ein Entzug hält laufende Welten an. Geht auch, wenn dauerhafte Welten aus sind. Fehlt beides oder ist es ungültig: 400; unbekannter Spieler: 404.

**Nichts geloggt:** Konsole, Chat, Befehle, Namen und IP-Adressen schreibt der Dienst in kein Log; im Log stehen nur Ereignisse ohne Namen („Eine Welt schläft (keine Spieler).“). Wird eine dauerhafte Welt gelöscht – auch über den Fremdschlüssel, wenn ein Konto gelöscht oder gesperrt wird, und über `heldix-dienst-admin` –, merkt sich die Datenbank sie per Trigger (`hosted_tombstones`); beim Abgleich (beim Start, nach jedem Löschen bzw. Sperren im Dienst und alle 5 Minuten) hält der Dienst ihren Server an und löscht ihre Daten beim Runner. Welten, die der Runner kennt, die Datenbank aber nie kannte (z. B. eine falsche Datenbank), löscht er nicht, sondern meldet sie einmal als Warnung.

**Datenbank** (Schema 12, ab 1.13.0): `hosted_worlds` (je dauerhafter Welt, geht mit der geteilten Welt und dem Konto), `hosted_plugins`, `hosted_backup_plugins` (Plugins zum Zeitpunkt einer Sicherung), `hosted_tombstones` (gelöschte Welten, bis der Runner aufgeräumt hat), `hosting_grants` (Freischaltungen, Quelle `beta`, später `plus`), `plus_waitlist`, `discover_listings`, `discover_likes`, `discover_reports`, `discover_bans`. Dateien des Dienstes: `<Datenordner>/hosting-uploads/` (Uploads und Downloads, gemeinsam mit dem Welten-Wächter); die Welten selbst liegen beim Runner.

### Entdecken

Ab Version 1.13.0. Öffentliches Weltenverzeichnis für die Webseite (`/entdecken`, `/welt#<code>`), Heldix-Welten im Spiel (Reiter „Entdecken“) und den Launcher („Beliebte Welten“). Besitzer listen ihre Welt **freiwillig** und nur mit Zugang „Jeder mit der Adresse“ (`access: "open"`); dauerhafte Welten stehen dann immer drin (auch schlafend), normal geteilte nur, solange sie geöffnet sind. Gesperrte Spieler, fürs Verzeichnis gesperrte Besitzer und ausgeblendete Einträge erscheinen nie; ebenso Einträge, deren Name oder Beschreibung den einfachen Wortfilter ([service/src/wordfilter.ts](../service/src/wordfilter.ts): grobe Beleidigungen, Hetze, Jugendgefährdendes, Links) nicht bestehen.

| Anfrage | Wer | Inhalt | Antwort |
| --- | --- | --- | --- |
| `GET /v1/public/discover?sort=popular\|new\|active&tag=&lang=&version=&q=&page=` | öffentlich | – | `{ "sort", "page", "pages", "total", "entries": [Entry] }` (24 je Seite) |
| `GET /v1/public/discover/meta` | öffentlich | – | `{ "tags": [{ "id", "label" }], "langs", "sorts", "rules", "reportReasons", "descriptionMax", "maxTags", "pageSize" }` |
| `GET /v1/public/discover/<code>`, `…/<code>/icon.png` | öffentlich | – | `Entry` bzw. Symbol (PNG 64×64, nur dauerhafte Welten) |
| `GET /v1/worlds/<id>/listing` | Besitzer | – | `{ "listed", "description", "tags", "lang", "listedAt", "hidden", "likes", "access", "problem": null \| "access" \| "banned" \| "hidden" \| "words", "rules" }` |
| `PUT /v1/worlds/<id>/listing` | Besitzer | `{ "listed"?, "description", "tags", "lang", "rulesAccepted": true }` | wie `GET` |
| `DELETE /v1/worlds/<id>/listing` | Besitzer | – | `{ "ok": true }` (mit den Gefällt-mir) |
| `GET`, `PUT`, `DELETE /v1/discover/<code>/like` | angemeldet | – | `{ "liked", "likes" }` |
| `POST /v1/discover/<code>/report` | angemeldet | `{ "reason", "note"? }` | `{ "reported": true }` |

- `Entry` = `{ "code", "name", "description", "tags", "lang", "version", "players", "maxPlayers", "state": "online" | "sleeping" | "starting" | "running" | "stopping", "persistent", "host": { "uuid", "name", "head": "/v1/public/heads/<uuid>.png" }, "icon": "<Pfad>" | null, "likes", "address", "listedAt", "lastActive" }`.
- **Listen:** Beschreibung bis 160 Zeichen (eine Zeile), bis zu 3 Tags aus `survival`, `kreativ`, `minispiele`, `rollenspiel`, `bauen`, `parkour`, `technik`, `entspannt`, `hardcore`, Sprache `de` oder `en`, Regeln bestätigen (400 `rules`: keine Beleidigungen oder Hetze, keine Werbung für fremde Dienste, nichts Jugendgefährdendes). Zugang nicht „offen“: 409 `access`; fürs Verzeichnis gesperrt: 403 `banned`; Wortfilter: 400 `words-word` bzw. `words-link`.
- **Sortierung:** `popular` (Spieler online, dann Gefällt-mir der letzten 30 Tage), `new` (zuletzt gelistet), `active` (Spieler online, dann zuletzt aktiv); Filter nach Tag, Sprache und Version, `q` sucht in Name und Beschreibung. Die öffentliche Liste merkt sich der Dienst 30 Sekunden (`Cache-Control: public, max-age=30`), höchstens 120 Abfragen pro Minute und IP.
- **Gefällt mir:** eins je Spieler und Welt, nicht die eigene (409), höchstens 60 pro Minute und Spieler. **Melden:** Grund `harassment`, `advertising`, `inappropriate`, `spam` oder `other`, Notiz bis 300 Zeichen; einmal je offenem Eintrag (429), höchstens 10 in 24 Stunden je Spieler. Im Log steht nur „Neue Meldung zu einem Eintrag in Entdecken (#<n>, Grund: …).“

### Heldix+-Warteliste

Ab Version 1.13.0. Heldix+ ist **geplant** (dauerhafte Welten, mehr Plätze und Speicher, Vorrang beim Start); Preise und Inhalte stehen noch nicht fest, bezahlt wird nichts. Wer will, trägt sich mit seinem Konto ein; das Team schaltet von dort Beta-Tester frei.

| Anfrage | Wer | Antwort |
| --- | --- | --- |
| `GET /v1/plus` | angemeldet | `{ "waitlist": { "since" } \| null, "granted", "grantedAt" \| null, "team", "unseen", "count": n \| null }` |
| `PUT /v1/plus/waitlist` / `DELETE /v1/plus/waitlist` | angemeldet | wie `GET` (eintragen einmal, `since` bleibt) |
| `POST /v1/plus/seen` | angemeldet | wie `GET` (Hinweis zur Freischaltung gesehen) |
| `GET /v1/public/plus` | öffentlich | `{ "count": n \| null }` |

- `count` erst ab 50 Einträgen, sonst `null`. `granted`: darf dauerhafte Welten nutzen (Team oder Freischaltung); `unseen`: neue Freischaltung, Hinweis noch nicht gesehen.
- Wird ein Spieler freigeschaltet, bekommt er sofort `hosting-granted`; ist er nicht verbunden, bei der nächsten ersten Verbindung (mit `pending: true`), bis er `POST /v1/plus/seen` aufruft.

### Server-Partner und Partner-Schnittstelle

Ab Version 1.14.0. Betreiber von Minecraft-Servern beantragen eine Partnerschaft; das Team legt Partner an und gibt dem Server-Plugin „HeldixClient Server“ ([docs/server-plugin.md](server-plugin.md)) einen Partner-Schlüssel. Spiel, Launcher und Webseite zeigen Server, deren Adresse zu einem Partner passt, mit dem Abzeichen „Partner“.

`Partner` (öffentlich) = `{ "id": "[a-z0-9-]{3,32}", "name" (1–40), "description" (≤ 300), "website": "https://…" | null, "servers": ["<Adresse>"], "featured": bool }`. `servers`: 1–10 Adressen, normalisiert wie beim Online-Status (öffentliche Domains, ohne Port 25565); eine Domain deckt ihre Subdomains ab, ein Port im Eintrag muss passen.

| Anfrage | Wer | Inhalt | Antwort |
| --- | --- | --- | --- |
| `GET /v1/public/partners` | öffentlich (CORS, `Cache-Control: public, max-age=300`) | – | `{ "partners": [Partner] }`: nur aktive, hervorgehobene zuerst, dann nach Name |
| `POST /v1/partner-applications` | angemeldet | `{ "server", "name" (1–40), "description"? (≤ 300), "contact"? (≤ 200) }` | 201 `{ "id" }`; schon ein offener Antrag: 409 `APPLICATION_OPEN` |
| `GET /v1/account/partner-applications` | angemeldet | – | `{ "applications": [ { "id", "server", "name", "description", "contact", "created", "status": "open" \| "accepted" \| "declined", "note": "<Antwort>" \| null, "decidedAt" } ] }`, neueste zuerst |

Team (Recht `partners:manage`: Admin und Entwickler):

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/team/partners` | – | `{ "partners": [TeamPartner] }` |
| `POST /v1/team/partners` | `{ "id", "name", "description"?, "website"?, "servers", "featured"?, "contactUuid"? oder "application"?: <Nummer des Antrags> }` | 201 `{ "partner": TeamPartner }`; ID vergeben: 409 `PARTNER_EXISTS`; Adresse gehört schon einem anderen Partner: 409 `SERVER_TAKEN` |
| `PUT /v1/team/partners/<id>` | Teilfelder davon und `"status": "active" \| "paused"` | `{ "partner": TeamPartner }` |
| `POST /v1/team/partners/<id>/key` | – | `{ "key": "hxp_<40 Zeichen Base62>", "keyCreated" }`; der alte Schlüssel gilt sofort nicht mehr |
| `DELETE /v1/team/partners/<id>` | – | `{ "ok": true }` (die Zuordnung der Cosmetics geht mit, vergebene Freischaltungen bleiben) |
| `GET /v1/team/partner-applications?status=open\|accepted\|declined\|all` | – | `{ "applications": [ … wie oben, dazu "uuid", "player": { "uuid", "name" }, "decidedBy" ] }` (Standard `open`) |
| `PUT /v1/team/partner-applications/<id>` | `{ "status", "note"? (≤ 300) }` | `{ "application" }`; Annehmen legt **keinen** Partner an (dafür `POST /v1/team/partners` mit `application`) |
| `PUT /v1/team/cosmetics/<id>/partner` | `{ "partner": "<id>" \| null }` | wie `GET /v1/team/cosmetics`; nur Cosmetics mit `access: "unlock"` im signierten Manifest (sonst 409 `NOT_UNLOCK`) |

- `TeamPartner` = `Partner` plus `{ "status", "created", "hasKey", "keyCreated", "contact": { "uuid", "name" } | null, "cosmetics": ["<id>"] }`. `application` übernimmt den Antragsteller als Kontakt.
- Die Zuordnung eines Cosmetics geht auch über `PATCH /v1/team/cosmetics/<id>` mit `{ "partner": "<id>" | null }` oder `{ "access": "partner", "partner": "<id>" }`; `{ "access": "<Zugang im signierten Manifest>" }` löst sie wieder. Ein anderer Zugang als im Manifest geht nur mit einer neuen, signierten Version (409 `ACCESS_SIGNED`). Zuordnen und Lösen brauchen zusätzlich zu `cosmetics` das Recht `partners:manage`.
- Vom Schlüssel speichert der Dienst nur den SHA-256; im Klartext steht er nur in der Antwort von `…/key`. Protokoll: `partner.create`, `partner.update`, `partner.key`, `partner.delete`, `partner.cosmetic`, `partner-application.decide`.

**Partner-Schnittstelle** (Server-Plugin): Anmeldung mit `Authorization: Partner <key>`; fehlt er oder ist er falsch: 401 `PARTNER_KEY_INVALID`, Partner pausiert: 403 `PARTNER_PAUSED`. Höchstens 120 Anfragen pro Minute je Schlüssel, ungültige Schlüssel höchstens 20 pro Minute je IP.

| Anfrage | Inhalt | Antwort |
| --- | --- | --- |
| `GET /v1/partner/me` | – | `{ "id", "name", "servers", "cosmetics": ["<id>"] }` (sichtbare Belohnungen dieses Partners), zum Prüfen des Schlüssels |
| `PUT /v1/partner/voice/groups` | `{ "server", "groups": { "<uuid32>": "<gruppe>" \| null } }` (höchstens 500 Einträge, Gruppe `[a-z0-9_-]{1,24}`, Körper bis 64 KB) | `{ "server": "<Server-Eintrag>", "players": <Spieler mit Server-Gruppe dort>, "ttl": 600 }` |
| `DELETE /v1/partner/voice/groups?server=…` | – | `{ "ok": true, "server": "<Server-Eintrag>" }` |
| `POST /v1/partner/rewards` | `{ "uuid", "cosmetic" }` | `{ "granted": true, "already": bool }` |

- **Server-Gruppen:** `server` muss zu den Servern des Partners passen (sonst 403 `SERVER_NOT_PARTNER`); der Bereich ist der passende Server-Eintrag (z. B. gilt `mc.example.net` für den Eintrag `example.net`). Eine Gruppe setzt bzw. erneuert den Eintrag, `null` entfernt ihn, nicht genannte bleiben bis zum Ablauf: Jeder Eintrag verfällt **10 Minuten** nach der letzten Erneuerung (das Plugin schickt alle 2 Minuten den ganzen Stand). Höchstens 5000 Spieler mit Server-Gruppe je Partner (409 `SERVER_GROUP_LIMIT`); Voice Chat aus: 503 `VOICE_OFF`. Pausieren, Löschen oder andere Server-Adressen beim Partner leeren seine Server-Gruppen sofort. Wirkung im Voice: siehe [Server-Gruppen](#server-gruppen-ab-1140).
- **Belohnungen:** nur sichtbare Cosmetics mit `access: "partner"` **dieses** Partners (sonst 403 `NOT_PARTNER_COSMETIC`, unbekannt 404 `UNKNOWN_COSMETIC`); der Spieler muss sich schon einmal mit HeldixClient angemeldet haben (sonst 404 `UNKNOWN_PLAYER`). Wirkt wie eine Freischaltung (Herkunft `partner:<id>`); neu freigeschaltet bekommt der Spieler `{ "type": "unlock", "cosmetic", "reason": "partner", "partner": "<Name>" }`. Höchstens 600 je Partner und Stunde (429).
- **Nur im Entwicklungsmodus** (`HELDIX_DIENST_DEV=1`, nur von diesem Rechner, für Autotests des Server-Plugins): `POST /v1/dev/partner { "id"?, "name"?, "servers"?, "cosmetics"?: ["<id>"] }` legt den Partner an (Standard `autotest`, Server `autotest.example.net`) bzw. setzt ihn aktiv, ordnet die Cosmetics zu und liefert `{ "partner": TeamPartner, "key" }` mit einem neuen Schlüssel.

### Setup teilen

Ab Version 1.14.0. Ein Spieler teilt den Inhalt einer Instanz als Link (`<Webseite>/setup#<code>`, im Launcher `heldixclient://setup/<code>`; `code` wie bei Einladungen: 10 Zeichen aus `[a-hjkmnp-z2-9]`). Der Dienst speichert nur Angaben, keine Dateien und keine URLs; der Launcher lädt alles selbst von Modrinth bzw. aus dem Addon-Store.

`SetupContent` (Format 1) = `{ "v": 1, "minecraft": "<Version>", "loader": "heldix" | "fabric" | "vanilla", "heldixClient": bool, "mods" / "resourcepacks" / "shaderpacks": [ { "project": "<Modrinth-ID, 8 Zeichen>", "version": "<Modrinth-Versions-ID, 8 Zeichen>", "title": "<1–100>" } ], "addons": [ { "id": "<Store-ID>", "version": "<x.y.z>" | null, "name": "<1–100>" } ], "settings": { "graphics": { "<[A-Za-z0-9_.:]{1,64}>": Zahl | bool | "<≤ 64>" } | null, "keys": { "key.…": "key.…" } | null } }`; je Liste höchstens 300 Einträge, `graphics` höchstens 60, `keys` höchstens 200 (Schlüssel `^key\.[A-Za-z0-9_.]{1,80}$`, Wert `^key\.[a-z0-9_.]{1,40}$`).

- Unbekannte Felder fallen weg, doppelte Projekte bzw. Addons zählen einmal, fehlende Listen sind leer, fehlende `settings` werden `{ "graphics": null, "keys": null }`. Gespeichert wird das **kanonische JSON** (Schlüssel sortiert, ohne Leerzeichen), höchstens 64 KiB; `hash` ist der SHA-256 (hex) davon. Falsches Format: 400 `SETUP_INVALID` (der Text nennt das Feld). Welche Grafik-Schlüssel übernommen werden, legt nur der Launcher fest.

| Anfrage | Wer | Inhalt | Antwort |
| --- | --- | --- | --- |
| `POST /v1/setups` | angemeldet | `{ "name" (1–40), "description"? (≤ 300), "content": SetupContent, "expiresDays": 7 \| 30 \| 90 \| null }` (fehlt: `null` = nie) | 201 `{ "code", "url": "<Webseite>/setup#<code>" \| null, "expires": <ms> \| null }` |
| `GET /v1/setups` | angemeldet | – | `{ "setups": [OwnSetup], "limits": { "active": 50, "daily": 20 } }`, neueste zuerst (auch abgelaufene und widerrufene) |
| `GET /v1/setups/<code>` | Ersteller | – | `OwnSetup` mit `content` (zählt keinen Aufruf) |
| `DELETE /v1/setups/<code>` | Ersteller | – | `{ "ok": true, "setup": OwnSetup }` (widerrufen; noch einmal ändert nichts) |
| `POST /v1/setups/<code>/report` | angemeldet | `{ "reason": "spam" \| "harassment" \| "inappropriate" \| "other", "note"? (≤ 300) }` | `{ "reported": true }` |
| `GET /v1/public/setups/<code>` | öffentlich (CORS) | – | `{ "code", "name", "description", "creator": { "name", "uuid" }, "content", "hash", "created", "expires", "views", "installs" }` |
| `POST /v1/public/setups/<code>/installed` | öffentlich (CORS) | – | `{ "ok": true, "counted": bool, "installs" }` |
| `DELETE /v1/team/setups/<code>` | Team (`moderation`) | – | `{ "ok": true, "code", "revoked": true }` (Protokoll `setup.revoke`) |

- `OwnSetup` = `{ "code", "url", "name", "description", "created", "expires", "status": "active" | "expired" | "revoked", "revoked", "expired", "views", "installs", "hash", "minecraft", "loader", "heldixClient", "counts": { "mods", "resourcepacks", "shaderpacks", "addons" }, "graphics": bool, "keys": bool }`.
- **Öffentlich:** unbekannt 404 `SETUP_UNKNOWN`, abgelaufen 410 `SETUP_EXPIRED`, widerrufen 410 `SETUP_REVOKED` (ebenso `…/installed` und Melden). `views` zählt höchstens einmal je IP und Stunde (die Antwort enthält den Aufruf schon), `installs` einmal je IP und Tag; welche IP schon gezählt wurde, merkt sich der Dienst nur als gesalzenen Hash im Arbeitsspeicher. Höchstens 60 Abfragen pro Minute und IP.
- Name und Beschreibung (je eine Zeile) laufen durch den Wortfilter wie in Entdecken (400 `words-word` bzw. `words-link`, also auch keine Links).
- **Grenzen:** höchstens 50 aktive Setups je Spieler (409 `SETUP_LIMIT`) und 20 neue in 24 Stunden (429 `SETUP_DAILY` mit `Retry-After`).
- **Melden:** einmal je offenem Setup (429), zusammen mit Profil-Meldungen höchstens 10 in 24 Stunden. Die Meldung steht in den Meldungen des Teams (`GET /v1/team/reports`) mit `kind: "setup"` und `setup: { "code", "name", "description" }` (Stand beim Melden); gemeldet ist der Ersteller. Im Log steht nur „Neue Meldung #<n> (Setup, Grund: …).“
- Abgelaufene und widerrufene Setups löscht der Dienst 30 Tage danach, alle mit dem Konto.

### Öffentliche Spielerprofile

Ab Version 1.14.0. Freiwillig (Standard aus): Wer es einschaltet, hat unter `<Webseite>/spieler/<name>` eine Seite mit Bio und – je nach Schalter – Abzeichen, Cape und getragenen Cosmetics (3D-Figur mit Skin), gelisteten Welten aus [Entdecken](#entdecken) und „Freund hinzufügen“ (Freundschaftsanfrage wie bisher über `POST /v1/friends/requests` mit dem Namen).

| Anfrage | Wer | Inhalt | Antwort |
| --- | --- | --- | --- |
| `GET /v1/account/public-profile` | angemeldet | – | `ProfileSettings` |
| `PUT /v1/account/public-profile` | angemeldet | Teil von `{ "enabled", "bio" (≤ 160, eine Zeile; `null` oder `""` löscht), "showCosmetics", "showWorlds", "showBadges", "showFriendsButton" }` | `ProfileSettings` |
| `GET /v1/public/players/<name>` oder `…/<uuid32>` | öffentlich (CORS, `Cache-Control: public, max-age=30`) | – | `PublicProfile` |
| `POST /v1/public/players/<name>/report` | angemeldet (ohne CORS) | `{ "reason", "note"? }` wie bei Setups | `{ "reported": true }` |
| `PUT /v1/team/public-profiles/<uuid>` | Team (`moderation`) | `{ "hidden": bool }` | `{ "uuid", "name", "hidden", "enabled" }` (Protokoll `profile.hide` bzw. `profile.show`) |
| `GET /spieler/<name>` (auch `HEAD` und `/spieler/<uuid32>`) | öffentlich, über die Adresse der Webseite | – | HTML (siehe unten) |

- `ProfileSettings` = `{ "enabled": false, "bio": "", "showCosmetics": true, "showWorlds": true, "showBadges": true, "showFriendsButton": true, "hidden": false, "updated": <ms> | null, "url": "<Webseite>/spieler/<name>" | null }` (hier mit den Standardwerten). `hidden`: vom Team ausgeblendet; selbst wieder einschalten hebt das nicht auf.
- `PublicProfile` = `{ "uuid", "name", "bio", "badges"?: [ { "id", "label" } ], "cosmetics"?: { "cape": "<id>" | null, "worn": { "head", "back", "aura", "companion" } }, "worlds"?: [Entry aus Entdecken], "friendsButton": bool, "since": <ms>, "head": "/v1/public/heads/<uuid>.png", "skin": "/v1/public/skins/<uuid>", "url" }`. Felder mit `?` fehlen, wenn der Schalter aus ist. `badges`: alle zutreffenden (öffentliche Team-Rolle, Community-Abzeichen, Addon-Entwickler); `cosmetics` wie beim Nachschlagen (auch ohne „Für andere erkennbar“); `worlds`: sichtbare Einträge in Entdecken, beliebteste zuerst.
- Nicht eingeschaltet, vom Team ausgeblendet, gesperrt oder unbekannt: immer dasselbe 404 `PROFILE_UNKNOWN` („Dieses Profil gibt es nicht oder es ist nicht öffentlich.“). Höchstens 120 Abfragen pro Minute und IP (Seite und Schnittstelle getrennt gezählt).
- **Skin und Kopf:** `GET /v1/public/skins/<uuid>` gibt es jetzt auch für Spieler mit öffentlichem Profil (bisher nur für die Teamseite), `GET /v1/public/heads/<uuid>.png` ebenso, auch ohne „Für andere erkennbar“. Profil aus: wieder 404.
- **Bio** läuft durch den Wortfilter (400 `words-word` bzw. `words-link`).
- **Melden:** einmal je offenem Profil (429), steht in den Meldungen des Teams mit `kind: "profile"` und `profile: { "name", "bio" }`.
- **Seite `/spieler/<name>`:** Caddy leitet `/spieler/*` der Webseite an den Dienst (siehe [Installation](#installation-mit-einem-befehl-empfohlen)). Er liefert die gebaute `spieler.html` der Webseite (Ordner `HELDIX_DIENST_WEBSITE_DIR`) mit eingesetzten Angaben für Suchmaschinen und Vorschaukarten: `<title>` „<Name> – HeldixClient“, `description`, `og:description` und `twitter:description` (die Bio, sonst „Das öffentliche Profil von <Name> bei HeldixClient.“), `canonical` und `og:url`, `og:type` `profile`, `og:image` und `twitter:image` = Kopf (128 px) über die API, `twitter:card` `summary`. Vorhandene `<title>`, `description`, `robots`, `canonical`, `og:*` und `twitter:*` im Kopf der Vorlage fallen weg; der neue Block steht am Platzhalter `<!--heldix:spieler-meta-->`, sonst direkt nach `<meta charset>`. Alle eingesetzten Werte sind HTML-maskiert. Unbekannt oder privat: dieselbe Seite mit allgemeinen Angaben, `<meta name="robots" content="noindex">` und Status 404. `Cache-Control: public, max-age=60` (bei 404 `no-cache`); die Datei liest der Dienst neu, sobald sie sich ändert. Ohne `spieler.html` liefert er eine kleine eingebaute Seite mit denselben Angaben. Die Seite holt das Profil selbst über `/api/v1/public/players/<name>`.

### Schutz vor Missbrauch

- Anfragekörper sind höchstens 16 KB groß und müssen innerhalb von 15 Sekunden ankommen (sonst 408). Ausnahmen im Team-Bereich: Uploads der Installer bis 1 GiB und der Addons bis 50 MiB, abgebrochen erst, wenn 60 Sekunden lang nichts ankommt; das Addon-Manifest (`PUT /v1/team/addons/manifest`) und das Freigeben einer Einreichung bis 256 KB, der Umschlag eines Cosmetics (`PUT /v1/team/cosmetics`) bis 544 KB (Format 2; Format 1 bleibt bei 192 KB). Für Spieler: Addon-Einreichungen (`POST`/`PATCH`) bis 64 KB, JARs bis 50 MiB, Screenshots bis 2 MiB, Anhänge an Support-Anfragen bis 512 KiB.
- Anmeldung (`challenge`, `login`, `dev`): höchstens 20 Anfragen pro Minute und IP.
- Übrige Anfragen: höchstens 120 pro Minute und Token, sonst 429.
- Webseite: höchstens 10 Anmelde-Links pro Minute und Spieler, 20 Anfragen für die Anmeldung mit dem Minecraft-Konto (Start und Rückkehr zusammen) pro Minute und IP, 5 Versuche für den 2FA-Code pro 10 Minuten und Spieler, 5 Datenexporte pro Stunde und Spieler.
- Support: höchstens 3 offene Anfragen, 5 neue in 24 Stunden und 30 Nachrichten pro Stunde und Spieler; Anhänge höchstens 512 KiB, 5 pro Anfrage und 10 pro Stunde und Spieler.
- Skins für Angemeldete (`/v1/skins/<uuid>`): höchstens 300 pro Minute und Spieler; sie zählen nicht zur allgemeinen Grenze.
- Nachrichten: höchstens 20 pro Minute und Spieler. Meldungen: einmal pro Spieler und höchstens 10 in 24 Stunden. Blockierungen: höchstens 500. Downloads der Launcher-Installer: höchstens 30 pro Minute und IP, Downloads von Addons (`/v1/addons/<id>/files/…`) höchstens 60 pro Minute und IP, Screenshots höchstens 300 pro Minute und IP, Umschläge von Cosmetics (`/v1/cosmetics/<id>`) höchstens 300 pro Minute und IP.
- Addons von Spielern: höchstens 10 Entwürfe und 3 wartende Einreichungen je Spieler, 30 Uploads pro Stunde je Spieler, 4 Uploads gleichzeitig insgesamt (JARs werden höchstens zu zweit gleichzeitig geprüft). Bewertungen setzen oder löschen höchstens 30-mal pro Minute, Meldungen zu Addons höchstens 10 in 24 Stunden je Spieler.
- Voice Chat: höchstens 60 Sprach-Rahmen und 20 Textnachrichten pro Sekunde und Verbindung (davon höchstens 4 Statuswechsel), Nachrichten bis 4 KB, eine Verbindung pro Spieler, höchstens 16 Spieler je Gruppe (siehe [Voice Chat](#voice-chat)).
- Einladungen (ab 1.11.0): höchstens 20 neue pro Spieler und Tag und 50 offene je Spieler; öffentliche Ansicht höchstens 60 pro Minute und IP, Gast-Zugänge höchstens 5 in 10 Minuten und IP; höchstens 4 Gäste gleichzeitig je Einladung (siehe [Einladungen](#einladungen)).
- Welt teilen (ab 1.12.0): höchstens 10 Welten je Spieler (eine davon offen), 200 Mitglieder je Welt, 50 Freunde je Einladung; öffentliche Ansicht höchstens 60 pro Minute und IP; Relay höchstens 20 neue Verbindungen pro Minute und IP, 16 gleichzeitig je IP, 4 MiB/s je Welt, Handshake in 5 Sekunden (siehe [Welt teilen](#welt-teilen)).
- Freunde 2.0 und Party (ab 1.12.0): Reaktionen und Party-Chat zählen zur Grenze von 20 Nachrichten pro Minute; „schreibt …“ gibt der Dienst je Absender und Empfänger höchstens alle 3 Sekunden weiter; Party höchstens 8 Mitglieder und 16 offene Einladungen, dieselbe Einladung meldet er höchstens einmal pro Minute neu; Vorschläge höchstens 20; Köpfe (`/v1/public/heads/…`) höchstens 120 pro Minute und IP.
- Dauerhafte Welten (ab 1.13.0): 1 je Spieler, 2 je Team-Mitglied; Upload in Teilen zu 8 MiB (höchstens 2 GiB, 1200 Teile pro Minute und Spieler, 8 unfertige Uploads gleichzeitig, ein Teil ohne Bytes nach 60 Sekunden abgebrochen); Befehle höchstens 30 pro Minute und Spieler; Plugin-Suche 60 pro Minute und Spieler; Downloads von Welten und Sicherungen 10 pro Stunde und Spieler; Plugin-Dateien bis 256 KB. Entdecken: öffentlich 120 Abfragen pro Minute und IP, Gefällt mir 60 pro Minute und Spieler, Meldungen 10 in 24 Stunden.
- Server-Partner, Setups und Profile (ab 1.14.0): Partner-Schnittstelle 120 Anfragen pro Minute je Schlüssel, ungültige Schlüssel 20 pro Minute je IP, Belohnungen 600 pro Stunde je Partner, Server-Gruppen höchstens 500 Einträge je Anfrage (Körper bis 64 KB) und 5000 je Partner; öffentliche Partner-Liste 120, Setups 60 und Spielerprofile 120 Abfragen pro Minute und IP (die Seite `/spieler/…` eigens 120); Setups mit Inhalt bis 64 KiB (Körper bis 96 KB), 50 aktive und 20 neue in 24 Stunden je Spieler; Meldungen zu Setups und Profilen zusammen höchstens 10 in 24 Stunden.
- Hinter einem Reverse-Proxy zählt `X-Forwarded-For` nur mit `HELDIX_DIENST_TRUST_PROXY=1`.

## Betrieb

### Installation mit einem Befehl (empfohlen)

Ein Befehl richtet Webseite und API mit HTTPS ein:

| Adresse | Inhalt |
| --- | --- |
| `https://example.de` | Webseite von HeldixClient mit Funktionen, Bildern, Download, Impressum und Datenschutzerklärung; `www.example.de` leitet dorthin weiter |
| `https://api.example.de` | Heldix-Dienst (diese Schnittstelle, inklusive WebSockets) |
| `<code>.welt.example.de:25565` | geteilte Welten (Minecraft, TCP direkt zum Dienst, ab 1.12.0; nur mit DNS-Eintrag `*.welt.example.de`) |

Voraussetzung ist ein Linux-Server mit systemd, z. B. Debian 12 oder Ubuntu 22.04/24.04, mit x86_64 oder arm64. Getestet wurde auf Ubuntu 24.04.

1. **Angaben für Impressum und Datenschutz:** `website/site.config.example.json` als `website/site.config.json` speichern und ausfüllen: Name, Anschrift, E-Mail und Hosting-Anbieter. Die Datei enthält persönliche Angaben und wird nicht eingecheckt. Fehlt sie, enthalten beide Seiten Platzhalter, und der Installer warnt.

2. **Installer bauen** (auf dem Entwicklungs-PC):

   ```powershell
   cd service
   npm run installer
   ```

   Das erzeugt `service/release/heldix-dienst-install.sh` und eine Prüfsumme daneben. Die Datei ist etwa 5 MB groß und enthält den Dienst und die fertige Webseite.

3. **DNS:** A- bzw. AAAA-Einträge für `example.de`, `www.example.de` und `api.example.de` auf den Server setzen. Die Ports 80 und 443 müssen von außen erreichbar sein. Für [Welt teilen](#welt-teilen-auf-dem-server) zusätzlich einen Platzhalter-Eintrag `*.welt.example.de` (A bzw. AAAA) auf den Server und Port 25565/tcp.

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
- **Webseite und Dienst unter einer Adresse:** Auf der Webseite leitet Caddy `/api/*` ohne das `/api` an den Dienst weiter (Anmeldung, Spieler- und Team-Bereich mit dem Cookie der Webseite), ebenfalls ohne Kompression und ohne Grenze für Uploads. Der Dienst sieht die IP der Besucher wie bei der API über `X-Forwarded-For`. Der Installer setzt `HELDIX_DIENST_WEBSITE=https://<domain>` und `HELDIX_DIENST_API_URL=https://<api-domain>`. Ab 1.14.0 leitet Caddy auf der Webseite auch `/spieler/*` an den Dienst (öffentliche Spielerprofile mit Vorschaukarte, siehe [Öffentliche Spielerprofile](#öffentliche-spielerprofile)); dafür setzt der Installer `HELDIX_DIENST_WEBSITE_DIR=/opt/heldix-dienst/app/website` (mit `--no-website` entfällt beides).
- **Anmeldung mit dem Minecraft-Konto (optional):** Erst mit `--minecraft-login` (oder `--ms-client-secret-file`, `--ms-client-id`). Dann setzt der Installer `HELDIX_DIENST_MS_CLIENT_ID` auf die App-ID des Launchers (beim Bauen aus [launcher/src/main/config.ts](../launcher/src/main/config.ts) übernommen) und richtet die Anmeldung ab 1.14.0 wie im Launcher ein: öffentlicher Client mit PKCE, ohne Client-Geheimnis und ohne Rückfrage. Nur mit `--ms-client-secret-file` (Umleitungs-URI dann unter „Web“) legt er ein Geheimnis als `/etc/heldix-dienst/ms-client-secret` ab (Besitzer root, Gruppe des Dienstes, Rechte 640; nicht in `dienst.env`) und setzt `HELDIX_DIENST_MS_CLIENT_SECRET_FILE`. Er zeigt das Geheimnis nie an. Bei Updates ohne diese Optionen bleibt alles, wie es ist; `--no-minecraft-login` schaltet aus und löscht das Geheimnis. Am Ende nennt er die Umleitungs-URI für Azure. Vorher in Azure einrichten: [docs/einrichtung.md](einrichtung.md#anmeldung-auf-der-webseite-mit-dem-minecraft-konto).
- **Server-Plugin (ab 1.14.0):** Die Webseite im Installer enthält das Plugin „HeldixClient Server“ zum Herunterladen (`/downloads/HeldixClient-Server-<version>.jar`, Seiten `/partner` und Entwickler → Server-Plugin), wenn es vorher gebaut wurde (`npm run mod` im Launcher oder `gradlew :heldix-server:build` in `mod/`). Fehlt es, zeigen die Seiten „kommt bald“ (siehe [server-plugin.md](server-plugin.md#herunterladen)).
- **Update-Schlüssel:** `npm run installer` übernimmt den öffentlichen Schlüssel aus [launcher/src/main/update-public-key.ts](../launcher/src/main/update-public-key.ts). Der Installer legt ihn als `/etc/heldix-dienst/update-public-key.pem` ab und setzt `HELDIX_DIENST_UPDATE_KEY`. Ohne Schlüssel lassen sich Updates nur per `scp` veröffentlichen, Addons und Cosmetics gar nicht.
- **Daten:** Datenbank in `/var/lib/heldix-dienst`, Einstellungen in `/etc/heldix-dienst/dienst.env` (ab 1.13.0 nur für root lesbar: Besitzer root, Rechte 600; systemd liest sie vor dem Wechsel zum Benutzer des Dienstes). Eigene Einträge dort, z. B. `HELDIX_DIENST_CAPES`, bleiben bei Updates erhalten. Der Entwicklungsmodus wird auf dem Server immer ausgeschaltet.
- **Schlüssel für Voice-Clips (ab 1.13.0):** Beim ersten Lauf erzeugt der Installer `HELDIX_DIENST_VOICE_CLIP_KEY` (32 Zufallsbytes aus `/dev/urandom` als 64 Hex-Zeichen) und schreibt ihn in `dienst.env`; bei Updates bleibt er. Hat der Dienst ohne die Variable schon selbst `/var/lib/heldix-dienst/voice-clips.key` angelegt, übernimmt der Installer genau diesen Schlüssel, damit vorhandene Clips lesbar bleiben (die Datei bleibt liegen). Ist die Datei beschädigt, warnt er und erzeugt einen neuen. Der Schlüssel erscheint nie in der Ausgabe. Bei einer Sicherung `dienst.env` mitnehmen: ohne den Schlüssel lassen sich gespeicherte Clips nicht mehr abspielen.
- **Launcher-Updates:** Ordner `/var/lib/heldix-dienst/updates`. Er gehört dem Benutzer des Dienstes (Rechte 755): Der Dienst schreibt dort Uploads aus dem Team-Bereich, root lädt per `scp` hoch. Siehe [Launcher-Update veröffentlichen](#launcher-update-veröffentlichen).
- **Addon-Store:** Ordner `/var/lib/heldix-dienst/addons` (`HELDIX_DIENST_ADDONS`), ebenfalls dem Benutzer des Dienstes (Rechte 755). Die JARs liegen direkt darin; welche Versionen veröffentlicht sind, steht in der Datenbank. Darunter legt der Dienst `einreichungen` (ungeprüfte Uploads von Spielern, nie öffentlich) und `screenshots` an. Die Abschottung des Dienstes (`ReadWritePaths`) umfasst ihn, weil er im Datenordner liegt. Siehe [Addon veröffentlichen](#addon-veröffentlichen).
- **Verwaltung:** Der Befehl `heldix-dienst-admin` (in `/usr/local/bin`) zeigt Meldungen, sperrt Spieler und verwaltet das Team, siehe [Verwaltung](#verwaltung-meldungen-sperren-und-team).
- **Welt teilen (ab 1.12.0):** Ohne Option prüft er, ob ein zufälliger Name unter `*.welt.<domain>` auf diesen Server zeigt und Port 25565/tcp frei ist; nur dann schaltet er Welt teilen ein (`HELDIX_DIENST_WELT_DOMAIN=welt.<domain>`, `HELDIX_DIENST_WELT_PORT=25565`, zeigt der Eintrag per IPv6 hierher auch `HELDIX_DIENST_WELT_BIND=::`). Sonst nennt er, was fehlt, und Welt teilen bleibt aus. Mit `--world-domain` schaltet er auch ohne passenden DNS-Eintrag ein (nach Rückfrage; hinter NAT normal). Eine bestehende Einstellung bleibt bei Updates, auch wenn die Prüfung gerade nur warnt. Ist der Port belegt (z. B. von einem Minecraft-Server), bleibt Welt teilen aus; dann mit `--world-port` einen anderen Port wählen (Spieler ohne HeldixClient geben dann `<code>.welt.<domain>:<port>` ein). Das Relay läuft im Dienst selbst (nicht über Caddy) und lauscht auf allen Schnittstellen, die API weiter nur auf `127.0.0.1`.
- **Firewall:** Ist ufw oder firewalld aktiv, öffnet er die Ports 80 und 443 und, wenn Welt teilen an ist, den Port dafür (Standard 25565/tcp).
- **Dauerhafte Welten (ab 1.13.0, Beta):** Nur mit `--hosting` (und `--accept-minecraft-eula`). Dann installiert er Docker (Debian/Ubuntu: `docker.io` aus den Paketquellen; ein schon installiertes Docker bleibt), legt das Docker-Netz `heldix-welten` mit Netz-Regeln an, richtet den Welten-Wächter `heldix-welten-agent` ein, lädt das Image der Welt-Container vorab und setzt `HELDIX_DIENST_WELTEN_AGENT` und `HELDIX_DIENST_WELTEN_MAX`. Ohne `--hosting` ändert sich nichts; einmal eingeschaltet, aktualisiert jeder weitere Lauf Wächter, Regeln und Image (die Welten bleiben). Siehe [Welten-Wächter](#welten-wächter-docker).
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
| `--minecraft-login` | Anmeldung mit dem Minecraft-Konto auf der Webseite einschalten – mit App-ID und Einstellungen des Launchers (öffentlicher Client, kein Geheimnis; bis 1.13.0 kam noch eine Rückfrage, dort einfach Enter). Braucht Webseite und API-Adresse |
| `--ms-client-secret-file <datei>` | Nur für die Umleitungs-URI unter „Web“: Client-Geheimnis aus dieser Datei (erste Zeile) übernehmen; schaltet die Anmeldung ein. Die Datei danach löschen |
| `--ms-client-id <id>` | andere App-ID (nur für eigene Builds; muss die von Mojang freigegebene App-ID des Launchers sein); schaltet die Anmeldung ein |
| `--no-minecraft-login` | Anmeldung mit dem Minecraft-Konto ausschalten, gespeichertes Geheimnis löschen |
| `--world-domain <name>` | Welt teilen mit Adressen `<code>.<name>` einschalten (Standard ohne Option: `welt.<domain>`, nur mit passendem DNS-Eintrag) |
| `--world-port <zahl>` | anderer Port für Welt teilen (1024–65535, Standard 25565) |
| `--no-world` | Welt teilen ausschalten (entfernt die Einträge aus `dienst.env`) |
| `--hosting` | dauerhafte Welten einschalten (Beta): Docker, Netz `heldix-welten` mit Netz-Regeln, Welten-Wächter. Braucht `--accept-minecraft-eula` (einmal; die Zustimmung bleibt gespeichert) und Welt teilen. Bleibt bei Updates an |
| `--accept-minecraft-eula` | als Betreiber der [Minecraft-EULA](https://aka.ms/MinecraftEULA) zustimmen; ohne sie lehnt der Installer `--hosting` ab und der Wächter startet keine Welt |
| `--welten-max <n>` | höchstens so viele dauerhafte Welten gleichzeitig (1–200; Standard aus dem RAM, siehe [Plätze](#welten-wächter-docker)); bleibt bei Updates |
| `--no-hosting` | dauerhafte Welten ausschalten: hält laufende Welten an (sie speichern), entfernt Wächter und Netz-Regeln und die Einträge aus `dienst.env`. Weltdaten und Docker bleiben |
| `--uninstall` | Programme, Dienste (auch Wächter und Netz-Regeln) und `heldix-dienst-admin` entfernen, laufende Welten anhalten; Daten (auch Launcher-Updates, Addons und Welten) bleiben. Mit `--purge` auch Daten, Welten samt Containern und Netz, Zertifikate und Benutzer |
| `--yes` | keine Rückfragen |

- **Update:** Den Installer einer neueren Version mit denselben Optionen noch einmal ausführen. Node.js und Caddy werden nur neu geladen, wenn es neue Versionen gibt. Für eine geänderte Webseite reicht dasselbe: `npm run installer`, dann den Installer erneut ausführen.
- **Log:** `journalctl -u heldix-dienst -f`, für HTTPS `journalctl -u heldix-dienst-caddy -f`.
- **Webseite ansehen ohne Server:** `node website/build.mjs` baut sie nach `website/dist`.

### Welt teilen auf dem Server

Ab Version 1.12.0. Geteilte Welten erreichen Spieler unter `<code>.welt.<domain>` direkt über Minecraft (TCP, Standard-Port 25565); der Dienst lauscht dafür selbst, Caddy ist nicht beteiligt. Die Steuerverbindung des Gastgebers und die Datenströme laufen als WebSockets über die API (`wss://api.<domain>/v1/worlds/host` und `…/v1/worlds/streams/<id>`), bei Caddy ohne weitere Einstellung.

1. **DNS:** einen Platzhalter-Eintrag `*.welt.example.de` als A- (und, wenn der Server IPv6 hat, AAAA-)Eintrag auf den Server. Ein SRV-Eintrag ist nicht nötig, solange der Port 25565 ist.
2. **Port:** 25565/tcp muss frei und von außen erreichbar sein (Firewall beim Hoster). Läuft auf dem Server schon ein Minecraft-Server, einen anderen Port wählen (`--world-port`); Spieler ohne HeldixClient geben die Adresse dann mit `:<port>` ein.
3. **Installer** erneut ausführen: Er prüft beides und schaltet Welt teilen ein (siehe oben). Im Log steht danach „Welt teilen: Relay auf 0.0.0.0:25565 für *.welt.example.de“.

- **Bandbreite:** Jede Verbindung läuft zweimal durch den Server (Spieler ↔ Dienst ↔ Gastgeber). Je Welt begrenzt der Dienst auf 4 MiB/s (beide Richtungen zusammen); ein normales Spiel braucht pro Spieler meist unter 100 KB/s, beim Laden neuer Gebiete kurz mehr.
- **Ohne Installer:** `HELDIX_DIENST_WELT_DOMAIN`, `HELDIX_DIENST_WELT_PORT` und `HELDIX_DIENST_WELT_BIND` setzen (siehe [Von Hand](#von-hand)); Docker zusätzlich mit `-p 25565:25565`.
- **Ausprobieren auf dem eigenen PC:** `HELDIX_DIENST_DEV=1 HELDIX_DIENST_WELT_DOMAIN=welt.test HELDIX_DIENST_WELT_PORT=25599 HELDIX_DIENST_WELT_BIND=127.0.0.1 npm start` (in `service/`, nach `npm run build`). Minecraft löst `*.welt.test` nicht auf; dafür einen Eintrag wie `127.0.0.1 abcdef.welt.test` in die hosts-Datei schreiben oder im Test-Client die Adresse im Handshake selbst setzen.

### Dauerhafte Welten auf dem Server

Ab Version 1.13.0. Braucht [Welt teilen](#welt-teilen-auf-dem-server) (Relay) und den **Welten-Wächter** mit Docker. Der Installer richtet beides ein; der Betreiber stimmt dabei der Minecraft-EULA zu (`--accept-minecraft-eula`, sonst kein Hosting). Der Dienst bekommt nur den Socket des Wächters (`HELDIX_DIENST_WELTEN_AGENT`, Standard `/run/heldix-dienst/welten.sock`) und teilt mit ihm den Upload-Ordner `<Datenordner>/hosting-uploads`.

- **Wie viele gleichzeitig:** `HELDIX_DIENST_WELTEN_MAX` (Standard aus dem RAM: `floor((RAM − 6 GB) / 3 GB)`, mindestens 1; bei 32 GB 8).
- **Ports:** Jeder Server lauscht nur auf `127.0.0.1:<31000–31999>`; nach außen geht nur das Relay (25565).
- **Freischalten:** Team-Bereich → Hosting (Recht `hosting:grant`, nur Admin) oder Heldix+-Warteliste → „die ersten N freischalten“.
- **Ausprobieren auf dem eigenen PC (ohne Docker):** `HELDIX_DIENST_DEV=1 HELDIX_DIENST_WELT_DOMAIN=welt.test HELDIX_DIENST_WELTEN_JAVA=<Java 25> npm start` (ProcessRunner, Java-Prozesse ohne Container, Daten in `<Datenordner>/hosting-dev`, Jars in `<Datenordner>/hosting-dev/jars` bzw. `HELDIX_DIENST_WELTEN_JAR_CACHE`). Ende-zu-Ende-Test mit echtem Paper: `HELDIX_TEST_PAPER=1 HELDIX_DIENST_WELTEN_JAVA=<Java 25> HELDIX_TEST_PAPER_CACHE=<Ordner> node --test dist/test-build/test/hosting-paper.test.js` (nach `npm test` bzw. dem Bauen).

#### Welten-Wächter (Docker)

Jede dauerhafte Welt ist ein eigener Docker-Container (`heldix-welt-<id>`). Mit Docker spricht nur der **Welten-Wächter** (`heldix-welten-agent`, `dist/agent/main.js`): ein kleiner Prozess als root (systemd-Unit nach `docker.service`, beschränkt auf `CAP_CHOWN`, `CAP_DAC_OVERRIDE`, `CAP_DAC_READ_SEARCH` und `CAP_FOWNER`; schreiben darf er nur in `/var/lib/heldix-welten` und den Upload-Ordner). Der Dienst bleibt ohne Rechte und ohne Docker-Zugriff; er schickt dem Wächter über den Socket `/run/heldix-dienst/welten.sock` (Rechte 0660, Gruppe `heldix-dienst`) wenige, streng geprüfte Befehle.

1. **Voraussetzungen:** [Welt teilen](#welt-teilen-auf-dem-server) ist eingerichtet, der Server hat genug Arbeitsspeicher (empfohlen 32 GB) und läuft mit Debian oder Ubuntu (sonst Docker vorher selbst installieren; Docker aus Snap geht nicht).
2. **EULA lesen:** <https://aka.ms/MinecraftEULA>. Mit `--accept-minecraft-eula` stimmst du als Betreiber zu; die Zustimmung steht danach in `/etc/heldix-dienst/welten.env` (`HELDIX_WELTEN_ACCEPT_MINECRAFT_EULA=1`). Ohne sie lehnt der Installer `--hosting` ab, und der Wächter startet keine Welt.
3. **Installer ausführen:** `sudo bash heldix-dienst-install.sh --domain example.de --hosting --accept-minecraft-eula` (dazu die übrigen Optionen wie bisher). Am Ende nennt er die Zahl der Plätze.
4. **Prüfen:** `systemctl status heldix-welten-agent`; im Log (`journalctl -u heldix-welten-agent -f`) steht „Welten-Wächter … lauscht auf /run/heldix-dienst/welten.sock – höchstens 8 Welten gleichzeitig, EULA zugestimmt, Image eclipse-temurin:25-jre@sha256:…“.

**Plätze:** Wie viele Welten gleichzeitig laufen dürfen, rechnet der Installer aus dem Arbeitsspeicher aus: `floor((RAM − 6 GB) / 3 GB)` – 6 GB für System, Dienst und Docker, je Welt 3 GB (bei 32 GB also 8). Er schreibt den Wert nach `HELDIX_DIENST_WELTEN_MAX` (Dienst) und `HELDIX_WELTEN_MAX` (Wächter, harte Grenze: ein weiterer Start scheitert mit „Gerade sind alle Plätze belegt …“). `--welten-max <n>` setzt ihn ausdrücklich; Updates behalten ihn. Unter 9 GB bricht der Installer ohne `--welten-max` ab.

**Grenzen jedes Containers** (fest im Code, [service/src/agent/docker.ts](../service/src/agent/docker.ts); keine Anfrage kann sie ändern):

| Einstellung | Wert |
| --- | --- |
| Image | `eclipse-temurin:25-jre` mit festem Digest ([service/src/agent/image.ts](../service/src/agent/image.ts)) |
| Arbeitsspeicher | `--memory` und `--memory-swap` gleich (Standard 3 GB, kein Swap); Java bekommt 5/6 davon als Heap (`-Xmx2560m`) |
| CPU, Prozesse | `--cpus 2`, `--pids-limit 512` |
| Rechte | `--cap-drop ALL`, `--security-opt no-new-privileges`, Benutzer `1000:1000` |
| Dateisystem | `--read-only`; schreibbar nur `/data` (Datenordner der Welt) und `/tmp` (tmpfs, 256 MB); Server-Jars aus einem gemeinsamen Ordner nur lesbar unter `/jars` |
| Netz | eigenes Netz `heldix-welten` (Container untereinander getrennt), Port nur `127.0.0.1:<31000–31999>`, nie öffentlich |
| Sonst | `--restart no` (gestartet wird nur über den Wächter), Logs `json-file` mit höchstens 3 × 10 MB, Befehl fest: `java … -jar /jars/<jar> --nogui`, ohne Shell |

`server.properties` schreibt der Wächter vor jedem Start neu: `online-mode=true`, `server-port=25565`, `enable-rcon=false`, `enable-query=false`, `log-ips=false`, `level-name=world` und die MOTD setzt er immer selbst, Besitzer ändern nur die erlaubte Auswahl. In `bukkit.yml` setzt er `settings.connection-throttle: -1` (nur diesen Wert): Alle Spieler kommen über das Relay von derselben Adresse, der Docker-Brücke, sonst wiese Bukkit Logins innerhalb von 4 Sekunden ab. `eula.txt` schreibt er nur, wenn der Betreiber zugestimmt hat.

**Netz-Regeln** (`/opt/heldix-dienst/welten-firewall.sh`, gesetzt von der Unit `heldix-welten-firewall` nach jedem Start von Docker):
- Container dürfen ins Internet (Plugins laden Updates, Köpfe usw.), aber **nicht** in private oder besondere Adressbereiche: 10.0.0.0/8, 172.16.0.0/12 (auch Docker-Gateway und andere Docker-Netze), 192.168.0.0/16, 169.254.0.0/16 (Metadaten-Dienste der Hoster), 100.64.0.0/10, 127.0.0.0/8, Multicast. Antworten auf bestehende Verbindungen gehen durch (Kette `DOCKER-USER` → `HELDIX-WELTEN`).
- Den Server selbst (jede seiner Adressen, auch das Gateway der Brücke) erreichen sie nicht – nur Antworten, z. B. an das Relay (Kette `INPUT` → `HELDIX-WELTEN-HOST`).
- Neue Verbindungen von außen in das Netz der Welten werden verworfen.
- Ansehen: `sudo iptables -S HELDIX-WELTEN`, `sudo iptables -S HELDIX-WELTEN-HOST`, `sudo iptables -S DOCKER-USER`. Nur IPv4: Das Netz der Welten hat kein IPv6.

**Was der Wächter macht**
- **Konsole:** Der Container läuft mit offenem stdin (ohne TTY). Der Wächter hält je laufender Welt einen `docker attach --sig-proxy=false`: Befehle gehen als Zeile an stdin, stdout/stderr sind das Live-Log. Ein Neustart des Wächters (z. B. beim Update) hält keine Welt an; er hängt sich wieder an.
- **Dateien:** In den Datenordner einer Welt schreibt der Wächter nur, solange ihr Container nicht läuft; Änderungen an Plugin-Dateien bei laufender Welt übernimmt er nach dem Anhalten. Lesen geht immer, aber ohne Links zu folgen. Vor jedem Start liegen in `plugins/` genau die geprüften Jars (fremde `*.jar` und `plugins/update` fallen weg).
- **Downloads:** Paper nur von `https://fill-data.papermc.io/…` (SHA-256), Vanilla nur von `https://piston-data.mojang.com/…` (SHA-1), Plugins nur von `https://cdn.modrinth.com/…` (SHA-512); ohne Weiterleitungen, mit Größengrenze. Server-Jars liegen einmal für alle Welten in `/var/lib/heldix-welten/jars`.
- **Import und Export:** nur Pfade im Upload-Ordner des Dienstes (`/var/lib/heldix-dienst/hosting-uploads`, kein Link). Entpacken prüft jedes ZIP streng (keine absoluten Pfade, kein `..`, keine Links, höchstens 250 000 Einträge und 64 GB entpackt; die Speichergrenze der Welt prüft der Dienst vorher, Größe und CRC jedes Eintrags); `level.dat` liegt ganz oben oder in genau einem Ordner (der ist dann die Welt). Export im Einzelspieler-Format (`world_nether/DIM-1` → `DIM-1`, `world_the_end/DIM1` → `DIM1`, `dimensions/` der Paper-Welten dazu).
- **Sicherungen:** ein ZIP je Sicherung in `worlds/<id>/backups/` (im Container nicht sichtbar), ohne Logs und ohne die Server-Dateien von Paper (`libraries`, `versions`, `cache`, `plugins/.paper-remapped`). Alte Sicherungen löscht der Dienst (letzte N je Art); der Wächter löscht nie von selbst, lehnt aber ab 50 Sicherungen je Welt neue ab (`HELDIX_WELTEN_BACKUPS_MAX`, Schutz der Platte). Läuft die Welt, schaltet er das Speichern kurz ab (`save-off`, `save-all flush`, danach `save-on`). Beim Wiederherstellen kommen Plugin-Jars nur zurück, wenn ihre SHA-512 zur Liste der Sicherung passt.
- **Logs:** Logs und Absturzberichte des Servers im Datenordner löscht er nach 7 Tagen (beim nächsten Start). Spieler-IPs sieht der Server nicht, nur die Adresse der Docker-Brücke.
- **Protokoll:** eine JSON-Zeile je Anfrage `{ id, op, world, args }` → `{ id, ok, result }` bzw. `{ id, ok: false, error, code }`, Log-Strom mit `follow`/`unfollow` (siehe [service/src/agent/protocol.ts](../service/src/agent/protocol.ts)). Welt-IDs nur `^[0-9a-f]{32}$`; unbekannte Operationen und Felder lehnt er ab.

| Pfad | Inhalt |
| --- | --- |
| `/var/lib/heldix-welten/worlds/<id>/data` | Datenordner der Welt (Besitzer 1000:1000) → `/data` im Container: `world/`, `plugins/`, `server.properties` … |
| `/var/lib/heldix-welten/worlds/<id>/` | sonst nur root: `world.json` (Einstellungen), `plugin-store/` (geprüfte Jars), `backups/`, `pending/` |
| `/var/lib/heldix-welten/jars` | Server-Jars (`paper-<sha256>.jar`, `vanilla-<sha1>.jar`); unbenutzte fallen nach einem Tag weg |
| `/var/lib/heldix-dienst/hosting-uploads` | Upload-Ordner des Dienstes (Uploads und Downloads der Welten) |
| `/etc/heldix-dienst/welten.env` | Einstellungen des Wächters (nur root lesbar) |

**Einstellungen des Wächters** (`/etc/heldix-dienst/welten.env`, nach Änderungen `systemctl restart heldix-welten-agent`): `HELDIX_WELTEN_SOCKET`, `HELDIX_WELTEN_SOCKET_GID` (Gruppe des Dienstes), `HELDIX_WELTEN_DATA`, `HELDIX_WELTEN_UPLOADS`, `HELDIX_WELTEN_DOCKER` (Docker-CLI), `HELDIX_WELTEN_MAX`, `HELDIX_WELTEN_ACCEPT_MINECRAFT_EULA=1`; dazu von Hand `HELDIX_WELTEN_BACKUPS_MAX` (Obergrenze, Standard 50) und `HELDIX_WELTEN_DISK_MB` (größte Welt beim Import in MB, Standard 65536). Ungültige Werte: Der Wächter startet nicht.

**Image aktualisieren** (Sicherheits-Updates von Java und Ubuntu, etwa monatlich): Digest holen (`docker buildx imagetools inspect eclipse-temurin:25-jre`, Zeile „Digest“, oder ohne Docker das Feld `digest` ganz oben in `https://hub.docker.com/v2/repositories/library/eclipse-temurin/tags/25-jre`), in [service/src/agent/image.ts](../service/src/agent/image.ts) eintragen, `npm test`, `npm run installer` und den Installer auf dem Server erneut ausführen. Er zieht das neue Image vorab; jede Welt nimmt es bei ihrem nächsten Start. Das alte Image danach mit `docker image prune` entfernen.

- **Log:** `journalctl -u heldix-welten-agent -f` (ohne Inhalte von Konsolenbefehlen); Ausgabe eines Servers: `docker logs heldix-welt-<id>`.
- **Ausschalten:** Installer mit `--no-hosting` – hält alle Welten an (sie speichern dabei), entfernt Wächter, Netz-Regeln und die Einträge in `dienst.env`; die Weltdaten bleiben in `/var/lib/heldix-welten`, Docker bleibt installiert.
- **Speicherplatz:** Die Grenze je Welt (6 GB) prüft der Dienst anhand von `stats`; Docker selbst begrenzt den Platz in `/data` nicht (dafür bräuchte es Quotas des Dateisystems). Den freien Platz der Platte im Blick behalten.
- **Benutzer 1000:** Auf vielen Servern ist das der erste Login-Benutzer (z. B. `ubuntu`); ihm gehören dann am Host die Weltdaten. Für die Container ändert das nichts.

### Erster Admin und Team-Bereich

1. Der künftige Admin meldet sich einmal im Launcher oder im Spiel beim Dienst an (dann kennt ihn der Dienst), oder auf der Webseite mit „Mit Minecraft-Konto anmelden“, falls eingerichtet.
2. Auf dem Server: `sudo heldix-dienst-admin team <spielername> admin`.
3. Im Launcher „Auf heldixclient.com anmelden“ wählen; der Browser öffnet `https://<domain>/konto`. Oder auf `https://<domain>/team` „Mit Minecraft-Konto anmelden“.
4. Im Team-Bereich die Zwei-Faktor-Anmeldung einrichten: QR-Code (oder Geheimnis) in eine Authenticator-App übernehmen, Code eingeben.
5. Weitere Mitglieder nimmt der Admin im Team-Bereich auf. Verliert jemand sein Handy: `sudo heldix-dienst-admin team-2fa-reset <name>` (oder ein anderer Admin im Team-Bereich).

### Launcher-Update veröffentlichen

**Im Browser** (Admin im Team-Bereich): Installer hochladen, dann `update.json` hochladen. Der Dienst prüft Signatur, Größe, SHA-512 und Version und veröffentlicht erst dann.

**Mac-Dateien** (`HeldixClient-<version>-mac-arm64.dmg`/`.zip` und `-mac-x64.dmg`/`.zip`, z. B. aus dem Artefakt des Mac-Builds bei GitHub Actions herunterladen): im Team-Bereich hochladen oder per scp in denselben Ordner legen. Die Download-Seite bietet sofort die höchste DMG-Version an. Für automatische Updates der Mac-Launcher (ab 1.13.0) kommt danach die signierte `update-mac.json` aus `npm run release:mac` dazu, **zuletzt**: im Team-Bereich wie `update.json` hochladen (der Dienst prüft Signatur, beide ZIPs mit Größe und SHA-512 und dass die Version höher ist als die bisherige Mac-Version) oder per scp:

```sh
scp HeldixClient-0.14.0-mac-arm64.dmg HeldixClient-0.14.0-mac-arm64.zip \
    HeldixClient-0.14.0-mac-x64.dmg HeldixClient-0.14.0-mac-x64.zip update-mac.json root@example.de:/var/lib/heldix-dienst/updates/
```

Solange eine der beiden ZIPs fehlt oder noch nicht vollständig ist, meldet `/v1/launcher/latest/mac` 404; im Log steht dann der Grund, sonst „Mac-Launcher-Version 0.14.0 ist veröffentlicht“.

Per scp landet eine halb hochgeladene Datei kurz unter ihrem Namen im Ordner; zum Ausprobieren erst `HeldixClient-….dmg.part` hochladen und auf dem Server umbenennen (`mv`), oder den Team-Bereich nehmen (der benennt erst am Ende um). Alte Versionen können liegen bleiben oder im Team-Bereich gelöscht werden.

**Per scp:** Der Launcher-Build erzeugt den Installer `HeldixClient-Setup-<version>.exe` und die signierte `update.json`. Beide kommen in den Update-Ordner, **erst der Installer, `update.json` zuletzt** (scp kopiert in der angegebenen Reihenfolge):

```sh
scp HeldixClient-Setup-0.12.0.exe update.json root@example.de:/var/lib/heldix-dienst/updates/
```

- Ein Neustart ist nicht nötig: Ändert sich `update.json`, liest der Dienst sie beim nächsten Abruf neu. Im Log steht dann „Launcher-Version 0.12.0 ist veröffentlicht“, bei Fehlern der Grund.
- Solange der Installer fehlt oder noch nicht vollständig hochgeladen ist (Größe wie `size` im Manifest), meldet `/v1/launcher/latest` 404. Der Launcher sieht also nie eine Version, die er nicht laden kann.
- Die Dateien müssen für den Dienst lesbar sein (bei scp als root der Standard, Rechte 644). Alte Installer können liegen bleiben; ausgeliefert wird jede Datei mit passendem Namen, angeboten wird für Windows nur die aus `update.json`, für Mac die höchste DMG-Version (zum Installieren) und als Update die ZIPs aus `update-mac.json`.
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

1. **Bauen und signieren** (auf dem Entwicklungs-PC mit dem privaten Update-Schlüssel): Quellen liegen in `cosmetics/<id>/` (`cosmetic.json`, `texture.png`, auf Wunsch `glow.png`; Format 2 mit `"format": 2` in `cosmetic.json`, aus Blender mit `npm run blender-import`, siehe [Entwicklung](entwicklung.md#cosmetics-aus-blender-übernehmen-format-2)). Im Ordner `launcher` `npm run cosmetic -- <id>` (ohne ID: alle; nur prüfen: `-- --pruefen`) prüft alles nach den Regeln oben, setzt `date`, bettet die PNGs ein, signiert und schreibt `launcher/release/cosmetics/<id>-<version>.cosmetic.json`.
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
| `sudo heldix-dienst-admin team <name\|uuid> <rolle>` | ins Team aufnehmen oder Rolle ändern (`admin`, `developer-team`, `moderator`, `supporter`, `designer`, `tester`); der Spieler muss sich schon einmal angemeldet haben. So entsteht der erste Admin |
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
  - `HELDIX_DIENST_VOICE` (`0` schaltet den [Voice Chat](#voice-chat) aus, dann antwortet `/v1/voice` mit 404; Standard: an) und `HELDIX_DIENST_VOICE_RANGE` (Reichweite in Blöcken, Standard 48, erlaubt 8–128). Ein anderer Wert als `0` oder `1` bzw. eine ungültige Reichweite: Der Dienst startet nicht.
  - `HELDIX_DIENST_WELT_DOMAIN` ([Welt teilen](#welt-teilen), z. B. `welt.heldixclient.com`: Adressen `<code>.<domain>`, DNS `*.<domain>` auf den Server; ohne: aus, `/v1/worlds…` antwortet mit 503), `HELDIX_DIENST_WELT_PORT` (TCP-Port des Relays, Standard 25565) und `HELDIX_DIENST_WELT_BIND` (IP-Adresse, auf der das Relay lauscht, Standard `0.0.0.0`; `::` für IPv4 und IPv6). Ungültige Werte: Der Dienst startet nicht. Ist der Port belegt, startet er mit einer Warnung, Welt teilen ist dann aus. `HOST` gilt nur für die HTTP-Schnittstelle, nicht für das Relay.
  - `HELDIX_DIENST_LIVE_MIN` (ab 1.12.0): Live-Zahlen `/v1/public/stats` erst ab so vielen Spielern online zeigen (Standard 50, `0` = immer). Keine ganze Zahl ab 0: Der Dienst startet nicht.
  - `HELDIX_DIENST_WEBSITE_DIR` (ab 1.14.0): Ordner der gebauten Webseite mit `spieler.html` für `/spieler/<name>` (Standard: der Ordner `website` neben `dist`, so wie ihn der Installer auspackt). Fehlt die Datei, liefert der Dienst eine kleine eingebaute Seite; beim Start steht im Log, welche.
  - `HELDIX_DIENST_WELTEN_AGENT` (ab 1.13.0, [Dauerhafte Welten](#dauerhafte-welten)): Unix-Socket des Welten-Wächters; ohne: dauerhafte Welten aus (außer im Entwicklungsmodus mit `HELDIX_DIENST_WELTEN_JAVA`). `HELDIX_DIENST_WELTEN_MAX`: gleichzeitig laufende dauerhafte Welten (ganze Zahl ab 1, Standard aus dem RAM). Nur mit `HELDIX_DIENST_DEV=1`: `HELDIX_DIENST_WELTEN_JAVA` (Java für den ProcessRunner, sonst mit Warnung ignoriert) und `HELDIX_DIENST_WELTEN_JAR_CACHE` (Ordner für Server-Jars).
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

  `HELDIX_DIENST_TRUST_PROXY=1` nur setzen, wenn der Port wie oben nur für den eigenen Reverse-Proxy offen ist. Der Dienst nimmt dann den letzten Eintrag von `X-Forwarded-For` (den der Proxy anhängt). Für [Welt teilen](#welt-teilen) zusätzlich `-e HELDIX_DIENST_WELT_DOMAIN=welt.example.de -p 25565:25565` (das Relay ist direkt erreichbar, nicht über den Reverse-Proxy).
- **Reverse-Proxy mit HTTPS:** Den Dienst nie direkt ins Internet stellen, sondern hinter einen Reverse-Proxy mit HTTPS (z. B. Caddy oder nginx); WebSockets müssen durchgereicht werden. Caddy holt das Zertifikat selbst und reicht WebSockets ohne weitere Einstellung durch:

  ```
  dienst.example.net {
      reverse_proxy 127.0.0.1:8787
  }
  ```

  Bei nginx brauchen `/v1/ws`, `/v1/voice` und (ab 1.12.0) `/v1/worlds/host` und `/v1/worlds/streams/<id>` die Upgrade-Header und ein Timeout über 90 Sekunden (im `server`-Block mit HTTPS):

  ```nginx
  location ~ ^/v1/(ws|voice|worlds/host|worlds/streams/[0-9a-f]{32})$ {
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
  # WebSockets aus dem Browser (Voice im Browser, ab 1.12.0 Echtzeit mit Cookie)
  location ~ ^/api/v1/(ws|voice)$ {
      rewrite ^/api(/.*)$ $1 break;
      proxy_pass http://127.0.0.1:8787;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_read_timeout 120s;
  }
  # Öffentliche Spielerprofile (ab 1.14.0): Seite mit Vorschaukarte vom Dienst
  location /spieler/ {
      proxy_pass http://127.0.0.1:8787;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
  location /api/ {
      proxy_pass http://127.0.0.1:8787/;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      client_max_body_size 1100m;
      proxy_request_buffering off;
      proxy_buffering off;
      proxy_read_timeout 600s;
  }
  ```
- **Überwachung:** `GET /health` antwortet mit `{ "ok": true }` (nutzt auch der Docker-Healthcheck). Ohne Anmeldung, ohne Daten. `GET /v1/status` zeigt dazu Version, Start, Spieler online, im Voice Chat und insgesamt, die veröffentlichte Launcher-Version, die Zahl der Addons im Store und der Cosmetics im Katalog und die geteilten Welten.
- **Verbindungen nach außen:** Außer zu Mojang für die Anmeldung (`sessionserver.mojang.com`) verbindet sich der Dienst nur für Skins (Teamseite und `/v1/skins`: `sessionserver.mojang.com`, `textures.minecraft.net`) und, wenn eingerichtet, für die Anmeldung mit dem Minecraft-Konto auf der Webseite (`login.microsoftonline.com`, `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com`, `api.minecraftservices.com`), jeweils HTTPS.
- **Adresse im Client:** In [launcher/src/main/config.ts](../launcher/src/main/config.ts) bei `HELDIX_SERVICE_URL` eintragen (oder beim Bauen die Umgebungsvariable `HELDIX_SERVICE_URL` setzen). Der Launcher gibt sie dem Spiel als `-Dheldixclient.service=<url>` mit.
