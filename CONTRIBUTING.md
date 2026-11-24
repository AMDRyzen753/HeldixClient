# Mitmachen

Danke, dass du HeldixClient verbessern möchtest! Fehler und Ideen kannst du jederzeit als [Issue](https://github.com/AMDRyzen753/HeldixClient/issues) melden.

## Änderungen beisteuern

1. Das Repository forken und einen eigenen Branch anlegen, z. B. `feature/armor-hud`.
2. Die Entwicklungsumgebung einrichten, wie in [docs/entwicklung.md](docs/entwicklung.md) beschrieben.
3. Die Änderung umsetzen und testen (siehe unten).
4. Einen Pull Request gegen `main` öffnen und kurz beschreiben, was sich ändert und warum.

## Vor dem Pull Request

```powershell
cd launcher
npm run mod                                    # Java-Teile bauen
npm run build                                  # Launcher bauen (TypeScript-Prüfung)
npm run test:launch -- 26.3 heldix --autotest  # bei Änderungen an Loader oder Client-Mod
```

Bei Änderungen an der Oberfläche hilft ein Screenshot vorher/nachher im Pull Request.

## Stil

- **Sprache:** Texte in der Oberfläche, Kommentare und Dokumentation sind auf Deutsch. Bezeichner im Code sind Englisch.
- **TypeScript:** 2 Leerzeichen Einrückung, `strict`-Modus; keine neuen Abhängigkeiten ohne guten Grund.
- **Java:** Tabs, Java 25. Eingriffe in Minecraft gehören in einen `ClassTransformer`; die Logik steht in statischen Hook-Methoden (siehe [docs/heldix-loader.md](docs/heldix-loader.md)).
- **Design:** Farben kommen aus den CSS-Variablen in `styles.css` bzw. aus `Theme.java`.

## Was nicht ins Repository gehört

- Minecraft-Dateien oder daraus abgeleitete Klassen
- gebaute JARs, Installer oder das JDK (siehe `.gitignore`)
- Zugangsdaten, Tokens oder geheime Schlüssel

## Lizenz

Mit einem Beitrag erklärst du dich einverstanden, dass er unter der [MIT-Lizenz](LICENSE) des Projekts veröffentlicht wird.
