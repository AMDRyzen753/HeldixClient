# Hinweise zur nächsten Version
# Jede Zeile mit "- " erscheint im Launcher unter „Was ist neu“ und im Versionsverlauf auf heldixclient.com.
# Vor jedem "npm run release" anpassen. Zeilen mit # werden ignoriert.

# ---------- 0.14.2 ----------
- Behoben: Leuchtende Cosmetics (Flügel, Auren, Begleiter) wirkten im Spiel viel zu dunkel und fleckig – jetzt leuchten sie wie in der Vorschau
- Behoben: Mit Iris-Shadern tauchten Partikel von Flügeln, Auren und Begleitern teils einige Blöcke daneben auf, in der Ich-Perspektive auch von den eigenen Cosmetics

# ---------- 0.14.1 (veröffentlicht – nicht noch einmal ausliefern) ----------
# - Neu: Setup teilen – teile eine Instanz als Link: Mods, Ressourcenpakete, Shader und Addons, auf Wunsch auch Grafik-Einstellungen und Tasten. Wer den Link öffnet, sieht eine Vorschau und baut alles mit einem Klick als neue Instanz nach – nur aus Modrinth und dem Addon-Store, mit Prüfsummen
# - Eigene Setups siehst du unter Instanzen → Setups und auf der Webseite unter „Meine Setups“ mit Aufrufen und Installationen; zurückziehen geht jederzeit
# - Neu: „Im Launcher“ – Freunde, die nur den Launcher offen haben (auch im Hintergrund), erscheinen jetzt mit türkisem Punkt statt offline: Sie bekommen deine Nachrichten sofort. Im Spiel, im Launcher und auf der Webseite
# - Neu: Öffentliches Profil – auf Wunsch bekommst du eine eigene Seite heldixclient.com/spieler/<name> mit 3D-Figur, Cape und Cosmetics, Abzeichen, kurzem Text und deinen öffentlichen Welten; einschalten unter Skins & Cosmetics oder im Konto auf der Webseite
# - Neu: Partner-Server – Server mit dem neuen Plugin „HeldixClient Server“ bekommen das Abzeichen „Partner“ in der Serverliste, im Pausemenü, unter „Beliebte Welten“ und in Entdecken auf der Webseite
# - Partner-Server können eigene HUD-Anzeigen (Text, Fortschritt, Listen) und Einblendungen schicken – unter Einstellungen → HUD kannst du „Server-HUD“ und „Server-Einblendungen“ ausschalten
# - Partner-Server können Funktionen wie Freelook, Zoom, Minimap oder Wegpunkte für ihren Server abschalten – dann steht dort „Auf diesem Server deaktiviert“, deine Einstellung bleibt erhalten
# - Voice Chat 1.4.0 im Store: Partner-Server können dich in eine Voice-Gruppe setzen (z. B. je Team einer Runde); die Anzeige zeigt die Server-Gruppe
# - Minimap 1.1.0 im Store: beachtet die Regeln von Partner-Servern für Minimap, Wegpunkte und Koordinaten
# - Partner-Server können dir Belohnungs-Cosmetics freischalten – die Einblendung sagt, von welchem Server sie kommen
# - Für Serverbetreiber: das kostenlose Partner-Programm mit Antrag unter heldixclient.com/partner und das Server-Plugin mit Java-Schnittstelle (Voice-Gruppen, HUD, Belohnungen, Regeln)
# - Neu: Addon-API Stufe 11 für Entwickler – Server-Infos und Server-Regeln, Sprache des Spielers und Server-Gruppe im Voice Chat
# - Behoben: Im Dialog „Voice-Regeln“ im Spiel war der Text der Regeln nicht zu sehen

# ---------- 0.14.0 (veröffentlicht – nicht noch einmal ausliefern) ----------
# - Mac: HeldixClient aktualisiert sich jetzt selbst – beim Start und im laufenden Launcher, wie unter Windows. Läuft die App noch aus dem DMG, erinnert sie daran, sie in Programme zu ziehen
# - Mac: Kürzel zeigen ⌘ statt Strg – im Launcher und im Spiel (⌘K Schnellsuche, ⌘Z im HUD-Editor, ⌘-Klick kopiert eine Chat-Nachricht)
# - Mac: Das Dock zeigt ungelesene Nachrichten und Freundschaftsanfragen; per Rechtsklick aufs Dock-Symbol startest du deine zuletzt gespielten Instanzen; „Einstellungen …“ mit ⌘,
# - Mac: schöneres DMG mit Pfeil – einfach HeldixClient auf Programme ziehen
# - Windows: Im Hintergrund bereit für Nachrichten – schließt du das Fenster, bleibt HeldixClient im Infobereich und meldet Nachrichten, Anfragen und Einladungen als Windows-Benachrichtigung. Ein Klick öffnet direkt den Chat
# - Windows: Die Taskleiste zeigt die Zahl ungelesener Nachrichten und Anfragen am Symbol und blinkt kurz bei einer neuen Nachricht
# - Neu: Mit Windows starten (Mac: bei der Anmeldung) – unsichtbar im Hintergrund, damit Nachrichten gleich ankommen; einschaltbar in der Einrichtung und unter Einstellungen → Allgemein
# - Das Menü im Infobereich hat „Nicht stören“ zum Umschalten und führt direkt zu deinen Freunden
# - Spotify-Addon 2.3.0 im Store: auf dem Mac auch Apple Music (Einstellung „Nur Spotify“ ausschalten)
# - Voice Chat 1.3.0 im Store: Melden direkt aus dem Voice (mit Lautstärke-Verlauf), Lautstärke-Schutz gegen Anschreien und Dauerlärm, Gastgeber, Operatoren und Party-Leiter können für alle stummschalten oder für 10 Minuten entfernen
# - Voice-Regeln: Hat das Team sie veröffentlicht, stimmst du ihnen vor der ersten Voice-Verbindung zu – das Melden kann dann die letzten Minuten des Gemeldeten enthalten
# - Neu: Addon-API Stufe 10 für Entwickler – Moderation im Sprachkanal (Ereignisse, eigene Rechte im Raum, Melden)
# - Neu (Beta): Dauerhafte Welten – stell eine deiner Welten dauerhaft online. Sie läuft auf dem Heldix-Server weiter, auch wenn du offline bist, schläft, wenn niemand drin ist, und wacht beim Beitreten auf. Im Spiel unter Heldix-Welten → Deine Welten oder im Pausemenü bei „Welt teilen“
# - Dauerhafte Welten in Heldix-Welten mit Zustand und Spielerzahl, „Beitreten“, „Auf der Webseite verwalten“ (Plugins, Konsole, Sicherungen) und „Herunterladen“ als neue Einzelspielerwelt – deine Einzelspielerwelt bleibt dabei, wie sie ist
# - Schläft eine dauerhafte Welt, weckt sie dein Beitritt: HeldixClient wartet die etwa 30 Sekunden und tritt dann von selbst bei
# - Klopft jemand an deine dauerhafte Welt, kommt das im Spiel als Einblendung mit H/N – ohne laufendes Spiel in der Glocke des Launchers
# - Neu: Entdecken – öffentliche Welten in Heldix-Welten, sortiert nach beliebt, neu oder gerade aktiv, mit Tags, Suche, „Gefällt mir“ und „Melden“. Die beliebtesten drei stehen auf der Startseite des Launchers
# - Heldix+ – bald: Dauerhafte Welten sind gerade eine Beta. Trag dich in Heldix-Welten auf die Warteliste ein – sobald du freigeschaltet bist, sagen dir das Spiel und die Glocke Bescheid
# - Startseite: „Offene Welten deiner Freunde“ zeigt jetzt auch dauerhafte Welten mit ihrem Zustand; die Glocke meldet, wenn eine deiner dauerhaften Welten ein Problem hat

# ---------- 0.13.9 (veröffentlicht – nicht noch einmal ausliefern) ----------
# - Neues Hauptmenü: „Weiterspielen“ zeigt den Live-Stand deines letzten Servers – wie viele Spieler online sind und deinen Ping
# - In kleinen Fenstern sind die Kacheln und Knöpfe im Hauptmenü nicht mehr abgeschnitten, alle Knöpfe sind beschriftet, und deine Spielfigur steht größer neben den Kacheln
# - Neu im Hauptmenü: Cosmetics mit einem Klick; die Freunde-Zeile lädt zum Einladen ein, wenn gerade niemand online ist
# - Pausemenü: oben Servername und Adresse, die Adresse mit einem Klick kopieren und der echte Ping – auch auf Servern, die in der Tab-Liste 0 ms melden
# - Pausemenü: „Freunde einladen“ groß in der Freunde-Karte – im Mehrspieler kommen deine Freunde damit direkt auf deinen Server; die Party ist einen Klick entfernt
# - Pausemenü: Mikrofon und Ton des Voice Chats direkt schalten, bis zu 12 Schnellschalter für Module und keine Lücke mehr unter den Knöpfen
# - Geteilte Welten werben in der Serverliste deiner Mitspieler für HeldixClient: „Geteilt mit HeldixClient“ unter dem Namen der Welt und das Heldix-Logo am Bild der Welt – auch wenn die Welt gerade zu ist
# - Minecrafts Hinweis „Chatnachrichten können nicht überprüft werden“ verdeckt die Menüs nicht mehr – er erscheint als Heldix-Einblendung

# ---------- 0.13.8 (veröffentlicht – nicht noch einmal ausliefern) ----------
# - Neu: Welt teilen – öffne deine Einzelspielerwelt im Pausenmenü mit einem Klick für Freunde, kostenlos und ohne Portfreigabe. Jede Welt hat eine feste Adresse, und auch Freunde ohne HeldixClient können beitreten
# - Neu im Hauptmenü: Heldix-Welten – offene Welten deiner Freunde mit „Beitreten“, deine eigenen Welten mit Mitgliedern und Rollen, Anklopfen (Erlauben mit H, Ablehnen mit N) und automatischen Sicherungen
# - Neue animierte Cosmetics: 8 Flügel und Rückenteile, 9 Begleiter (Mochi in vier Fellfarben) und 6 Auren, die sich beim Laufen, Schleichen, Schwimmen und Fliegen mitbewegen und teils leuchten
# - Der Cosmetics-Platz „Partikel“ heißt jetzt „Aura“
# - Neue Webseite: Freunde, Nachrichten und Party gibt es jetzt auch im Browser unter Konto, dazu „Meine Welten“
# - Neu: Einrichtung beim ersten Start – Willkommen, Microsoft-Anmeldung und offizielle Addons wie Voice Chat und Minimap mit einem Klick; der Windows-Installer kommt im HeldixClient-Design und auf Deutsch
# - Neuer Discord-Status: zeigt Dimension und Spielmodus („Im Nether · Überleben“), Spielerzahl, Voice, „Teilt seine Welt“ bzw. „In der Welt von …“ und „Abwesend“, dazu passende Bilder, deinen Minecraft-Kopf und die Zeit seit dem Betreten des Servers
# - Einstellungen → Discord: jeden Teil einzeln abschalten, „Nur ‚Spielt HeldixClient‘“ und eine Vorschau, wie dein Status gerade aussieht – verbindet sich von selbst, sobald Discord läuft
# - Startseite: „Offene Welten deiner Freunde“ und Freunde online mit „Beitreten“ – auch in geteilte Welten, mit der passenden Instanz
# - Geteilten Welten beitreten per Link (heldixclient://welt/…) und mit „Mitspielen“ im Discord-Status, wenn die Welt für alle offen ist
# - Neu: Glocke oben rechts mit allen Benachrichtigungen – Anfragen, Nachrichten, Einladungen, Freischaltungen, geöffnete Welten und Updates
# - Neu: Schließt du den Launcher während des Spiels, bleibt er im Infobereich – mit Freunden online und Benachrichtigungen; nach dem Spiel beendet er sich
# - Freunde 2.0: Nachrichten, Anfragen und Einladungen kommen im Launcher jetzt sofort an – ohne dass du dadurch bei deinen Freunden als „online“ erscheinst
# - Neu: Party – lade bis zu 7 Freunde ein, seht, wo jeder spielt, schreibt im Party-Chat und folgt dem Leiter mit „Beitreten“ (oder automatisch, wenn gerade kein Spiel läuft)
# - Im Chat: auf Nachrichten antworten, mit Emojis reagieren, eigene Nachrichten löschen, „schreibt …“ sehen und Server oder Welten als Karte mit „Beitreten“ teilen
# - Freunde als Favoriten oben anheften, Spitznamen und Notizen nur für dich, eigener Status mit „Nicht stören“, „zuletzt online“ und eine Profilkarte mit 3D-Skin und gemeinsamen Freunden
# - Neu: Freundesvorschläge (Freunde deiner Freunde, nur wer zustimmt) und „Ist online“-Hinweise wahlweise nur für Favoriten
# - Neue Abzeichen für Team und Community – Entwickler, Supporter, Designer, Tester, Partner, Creator und Botschafter – in der Freundesliste, auf der Profilkarte und an deinem Konto
# - Die Glocke zeigt jetzt auch Einladungen in Welten und Partys; der Discord-Status zeigt in einer Party „(2 von 8)“

# ---------- 0.13.7 (veröffentlicht – nicht noch einmal ausliefern) ----------
# - Neu: Freunde einladen – dein Link unter Freunde → Einladen. Wer neu dazukommt, bekommt sofort den Freundesfunken und ihr seid gleich befreundet
# - Belohnungen fürs Einladen: Freundesfunken ab 1 und das Cape Freundesband ab 3 Freunden, die 30 Minuten mit HeldixClient gespielt haben
# - Neu: Beitreten-Links „Komm auf meinen Server“ – ein Klick, und HeldixClient startet und verbindet direkt mit dem Server
# - Neu: Voice im Browser – Freunde ohne HeldixClient reden über einen Gast-Link aus dem Spiel mit (Freunde → Browser-Link für die Voice-Gruppe)
# - Neu: Knöpfe „Mitspielen“ und „HeldixClient holen“ in deinem Discord-Status (in den Einstellungen abschaltbar)
# - Voice Chat 1.2.0 im Store: Browser-Link für die Gruppe kopieren, Gäste in der Liste sehen und entfernen
# - Neu: Addon-API Stufe 9 für Entwickler – Gäste und Browser-Teilnehmer im Sprachkanal, Browser-Link für die Voice-Gruppe
# - Updates werden jetzt direkt beim Start installiert – der Launcher prüft kurz, lädt, installiert und startet neu; läuft er schon, kommt „Jetzt neu starten“
# - Einladung kommt beim Installieren mit: Wer HeldixClient über eine Einladung für Windows lädt, sieht sie nach der Installation sofort im Launcher

# ---------- 0.13.6 (übersprungen – die Neuerungen kamen mit 0.13.7) ----------
# Auskommentierte Abschnitte bleiben stehen: daraus entsteht der Versionsverlauf auf der Webseite.
# - Neu: Minimap als Addon im Store – Karte deiner Umgebung im HUD, rund oder eckig, dreht sich mit, in echten Blockfarben, mit Wegpunkten und Himmelsrichtungen
# - Capes wehen ruhiger, stechen nicht mehr durch Körper und Beine und haben keine schwarzen Ränder mehr beim Wehen und aus der Ferne
# - Neu: Elytra in Flügelform statt zweier Rechtecke – Aurora, Mitternacht, Glut und Galaxie mit eigener Form
# - Neu: Cape „Matrix“ (fallender Hacker-Code) und drei Team-Capes: Matrix Rot, Matrix Türkis und Sakura Orange
# - Neue Cosmetics: Cyber-Flügel und Krallen für den Rücken – alle HeldixClient-Spieler sehen sie
# - Neu im Store: das Emote-Rad mit Sitzen, Winken und Verbeugen (nur für dich sichtbar, nur Minecraft 26.3)
# - Neu: Addon-API Stufe 8 für Entwickler – die Welt von oben für Karten, selbst gefüllte Bilder im HUD und Wegpunkte lesen
