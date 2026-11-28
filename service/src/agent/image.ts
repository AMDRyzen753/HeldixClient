// Image der Welt-Container: Java 25 (Eclipse Temurin, JRE auf Ubuntu). Fest mit Digest, damit unter demselben Tag nie
// unbemerkt ein anderes Image läuft. Der Digest ist der des Index (amd64 und arm64; Docker wählt die passende Plattform).
//
// Stand: 2026-11-28 (Docker Hub, Tag zuletzt gebaut am 2026-11-20).
//
// Aktualisieren (z. B. für Sicherheits-Updates von Java oder Ubuntu, etwa monatlich):
//   1. Digest holen, auf einem Rechner mit Docker:
//        docker buildx imagetools inspect eclipse-temurin:25-jre      → Zeile „Digest: sha256:…“
//      oder ohne Docker (Feld „digest“ ganz oben im JSON, nicht die der einzelnen Plattformen):
//        curl -s https://hub.docker.com/v2/repositories/library/eclipse-temurin/tags/25-jre
//   2. Unten bei WORLD_IMAGE_DIGEST eintragen, Datum oben anpassen, `npm test` in service/.
//   3. Installer neu bauen (`npm run installer`) und auf dem Server ausführen: Er zieht das neue Image vorab
//      (`node dist/agent/main.js pull`) und startet den Wächter neu. Laufende Welten nehmen es beim nächsten Start.
//      Das alte Image kann danach weg: `docker image prune` (löscht nur Images ohne Container).
// Eine neue Java-Hauptversion (z. B. für eine neue Minecraft-Version) heißt: Tag ändern (eclipse-temurin:<n>-jre),
// Digest wie oben holen und prüfen, dass JAVA_BIN in docker.ts noch stimmt (/opt/java/openjdk/bin/java).

export const WORLD_IMAGE_TAG = 'eclipse-temurin:25-jre';
export const WORLD_IMAGE_DIGEST = 'sha256:4ed132f6832e9804b123e89a849a7b4502756ae64a4ee08ebab939d9d5d0a9fa';
export const WORLD_IMAGE = `${WORLD_IMAGE_TAG}@${WORLD_IMAGE_DIGEST}`;
