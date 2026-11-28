// Baut und signiert Heldix-Cosmetics für den Katalog (siehe core/cosmetics-format.ts).
//
//   npm run cosmetic                    alle Quellen unter cosmetics/ (Repo-Wurzel)
//   npm run cosmetic -- <id> [<id> …]   nur diese
//   npm run cosmetic -- --pruefen       nur prüfen, nichts signieren (braucht keinen Schlüssel)
//
// Quellen: cosmetics/<id>/cosmetic.json (Manifest ohne type, date, texture, glow) + texture.png (+ glow.png).
// Format 1 (Würfel) und Format 2 (Mesh mit Keyframes, "format": 2 in cosmetic.json, aus npm run blender-import).
// Jede Quelle wird nach allen Regeln ihres Formats geprüft (gemeinsamer Prüfer core/cosmetics-format.ts), bekommt date und die PNGs als data-URL und wird mit dem privaten
// Update-Schlüssel (%USERPROFILE%\.heldixclient-dev\update-key.pem) signiert, über die Bytes von
// "heldix-cosmetic\n" + Manifest. Vor dem Schreiben prüft das Skript den Umschlag mit dem öffentlichen Schlüssel des
// Launchers. Ergebnis: release/cosmetics/<id>-<version>.cosmetic.json – danach im Team-Bereich der Webseite unter
// „Cosmetics“ hochladen. Vor einer neuen Fassung version in cosmetic.json erhöhen (der Dienst nimmt nur größere).

import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COSMETIC_SLOT_NAMES, cosmeticSignedBytes, verifyCosmeticEnvelope } from '../main/core/cosmetics';
import { COSMETIC_LIMITS, COSMETIC_LIMITS_2, cosmeticEnvelopeLength, cosmeticEnvelopeText, utf8Length, type AnyCosmeticManifest } from '../main/core/cosmetics-format';
import { UPDATE_PUBLIC_KEY } from '../main/update-public-key';
import { buildCosmetic, COSMETICS_DIR, listCosmeticSources, type BuiltCosmetic } from './cosmetic-sources';

const UPDATE_KEY_PATH = path.join(os.homedir(), '.heldixclient-dev', 'update-key.pem');
const ROOT = path.join(__dirname, '..', '..');

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
/** Grenzen des Formats (Format 1: 160 KB / 192 KB, Format 2: 512 KB / 544 KB) */
const limitsOf = (manifest: AnyCosmeticManifest) => (manifest.format === 2 ? COSMETIC_LIMITS_2 : COSMETIC_LIMITS);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--pruefen');
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--pruefen');
  if (unknown.length) throw new Error(`Unbekannte Option ${unknown.join(', ')}. Aufruf: npm run cosmetic -- [<id> …] [--pruefen]`);
  const available = await listCosmeticSources();
  if (!available.length) throw new Error(`Keine Cosmetic-Quellen unter ${COSMETICS_DIR}`);
  const wanted = args.filter((a) => !a.startsWith('--'));
  for (const id of wanted) {
    if (!available.includes(id)) throw new Error(`Kein Cosmetic „${id}“ unter cosmetics/ (vorhanden: ${available.join(', ')})`);
  }
  const ids = wanted.length ? [...new Set(wanted)] : available;

  // erst alles prüfen, dann signieren – ein Fehler hält den ganzen Lauf an
  const date = new Date().toISOString();
  const built: BuiltCosmetic[] = [];
  for (const id of ids) built.push(await buildCosmetic(id, date));
  if (checkOnly) {
    for (const b of built) {
      const L = limitsOf(b.manifest);
      console.log(
        `OK  ${b.id} (${COSMETIC_SLOT_NAMES[b.manifest.slot]}, Format ${b.manifest.format}, Version ${b.manifest.version}, ` +
          `Manifest ${kb(utf8Length(b.text))} von ${kb(L.manifestBytes)}, Umschlag etwa ${kb(cosmeticEnvelopeLength(b.text))} von ${kb(L.envelopeBytes)})`,
      );
    }
    console.log(`${built.length} Cosmetics geprüft – nichts signiert (--pruefen).`);
    return;
  }

  if (!existsSync(UPDATE_KEY_PATH)) throw new Error(`Kein Update-Schlüssel unter ${UPDATE_KEY_PATH}. Einmalig "npm run update-key" ausführen.`);
  const privateKey = createPrivateKey(await readFile(UPDATE_KEY_PATH, 'utf8'));
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (UPDATE_PUBLIC_KEY !== publicPem) {
    throw new Error('Der öffentliche Schlüssel im Launcher passt nicht zum Update-Schlüssel. "npm run update-key" und danach neu bauen.');
  }

  const outDir = path.join(ROOT, 'release', 'cosmetics');
  await mkdir(outDir, { recursive: true });
  for (const b of built) {
    const signature = sign(null, cosmeticSignedBytes(b.text), privateKey).toString('base64');
    // genau die Form, die der Dienst ausliefert (darüber laufen size und sha256 im Katalog)
    const envelope = cosmeticEnvelopeText({ manifest: b.text, signature });
    // Selbsttest wie im Launcher/Dienst: Größe, Signatur mit dem öffentlichen Schlüssel des Launchers, alle Regeln
    verifyCosmeticEnvelope(envelope, UPDATE_PUBLIC_KEY);
    const file = path.join(outDir, `${b.id}-${b.manifest.version}.cosmetic.json`);
    const replaced = existsSync(file);
    await writeFile(file, envelope);
    const size = utf8Length(envelope);
    console.log(`${b.manifest.name} (${b.id}, ${COSMETIC_SLOT_NAMES[b.manifest.slot]}, Version ${b.manifest.version}${b.manifest.access === 'team' ? ', nur Team' : ''}) signiert:`);
    console.log(`  ${file} (${kb(size)} von höchstens ${kb(limitsOf(b.manifest).envelopeBytes)})${replaced ? ' – ersetzt' : ''}`);
  }
  console.log('');
  console.log('Veröffentlichen: heldixclient.com/team → Cosmetics → Datei wählen → Veröffentlichen.');
}

main().catch((error: Error) => {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
