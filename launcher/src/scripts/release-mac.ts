// Veröffentlicht die Mac-Version für die automatischen Updates auf dem Mac (siehe core/mac-update.ts).
//
//   npm run release:mac -- <Ordner>
//
// <Ordner> ist das entpackte Artefakt „HeldixClient-macOS“ von GitHub Actions (oder release/ auf einem Mac nach
// npm run dist:mac) mit HeldixClient-<version>-mac-arm64.zip/.dmg und -mac-x64.zip/.dmg. Das Skript prüft Namen und
// Version gegen package.json, rechnet Größe und SHA-512 der ZIPs, signiert mit dem Update-Schlüssel
// (%USERPROFILE%\.heldixclient-dev\update-key.pem) und schreibt release/update/update-mac.json (+ Kopie
// update-mac-<version>.json). Hinweise wie bei npm run release aus release-notes.md (Zeilen mit „- “).
// Hochladen: zuerst ZIPs und DMGs, update-mac.json zuletzt.

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LAUNCHER_VERSION } from '../main/config';
import { findMacArtifacts, readReleaseNotes, signMacManifest, writeMacUpdate } from './release-common';

const UPDATE_KEY_PATH = path.join(os.homedir(), '.heldixclient-dev', 'update-key.pem');
const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_KEY_TS = path.join(ROOT, 'src', 'main', 'update-public-key.ts');

async function main(): Promise<void> {
  const folder = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!folder) throw new Error('Ordner mit den Mac-Dateien fehlt: npm run release:mac -- <Ordner>');
  const dir = path.resolve(folder);
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const version = pkg.version;
  if (version !== LAUNCHER_VERSION) throw new Error(`Version in package.json (${version}) und src/main/config.ts (${LAUNCHER_VERSION}) unterscheiden sich.`);

  const found = await findMacArtifacts(dir, version);
  for (const warning of found.warnings) console.log(`Hinweis: ${warning}`);
  if (found.errors.length) throw new Error(`Die Mac-Dateien passen nicht:\n  ${found.errors.join('\n  ')}`);

  if (!existsSync(UPDATE_KEY_PATH)) throw new Error(`Kein Update-Schlüssel unter ${UPDATE_KEY_PATH}. Einmalig "npm run update-key" ausführen.`);
  const privateKey = createPrivateKey(await readFile(UPDATE_KEY_PATH, 'utf8'));
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const embedded = await readFile(PUBLIC_KEY_TS, 'utf8').catch(() => '');
  if (!embedded.includes(JSON.stringify(publicPem))) {
    throw new Error('Der öffentliche Schlüssel im Quellcode passt nicht zum Update-Schlüssel. "npm run update-key" und danach neu bauen.');
  }

  const notes = await readReleaseNotes(ROOT, process.argv);
  if (notes.length === 0) console.log('Hinweis: keine Versionshinweise (release-notes.md ist leer).');
  const signed = await signMacManifest({ version, date: new Date().toISOString().slice(0, 10), notes, zips: found.zips, privateKey });
  const out = await writeMacUpdate(path.join(ROOT, 'release', 'update'), signed);

  console.log(`Mac-Version ${version} signiert: ${out.latest}`);
  console.log(`  Kopie: ${out.copy}`);
  for (const zip of found.zips) console.log(`  ${path.basename(zip.path)} (${(zip.size / 1024 / 1024).toFixed(1)} MB)`);
  if (notes.length) console.log(`  Hinweise: ${notes.join(' · ')}`);
  console.log('');
  console.log('Hochladen (zuerst ZIPs und DMGs, update-mac.json zuletzt):');
  const files = [...found.zips, ...found.dmgs].map((a) => `"${a.path}"`).join(' ');
  console.log(`  scp ${files} root@heldixclient.com:/var/lib/heldix-dienst/updates/`);
  console.log(`  scp "${out.latest}" root@heldixclient.com:/var/lib/heldix-dienst/updates/`);
  console.log('Oder im Team-Bereich der Webseite unter „Updates“: ZIPs und DMGs hochladen, update-mac.json als Letztes.');
  console.log('Den Pfad auf dem Server nennt der Server-Installer am Ende ("Updates veröffentlichen").');
}

main().catch((error: Error) => {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
