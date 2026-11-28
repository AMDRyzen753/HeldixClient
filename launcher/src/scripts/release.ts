// Veröffentlicht eine neue Launcher-Version für die automatischen Updates (siehe core/updater.ts).
//
// Einmalig:  npm run update-key
//   erstellt das Schlüsselpaar für Updates:
//     privat:     %USERPROFILE%\.heldixclient-dev\update-key.pem   (sichern, nie weitergeben, nie einchecken)
//     öffentlich: src/main/update-public-key.ts                     (kommt mit in die .exe)
//
// Für jede Version (vorher die Version in package.json und src/main/config.ts erhöhen):
//   Hinweise in release-notes.md eintragen (Zeilen mit „- “), dann: npm run release
//   baut den Installer, signiert release/update/update.json und zeigt den Befehl zum Hochladen auf den Server.
// Mac: npm run release:mac -- <Ordner mit den Mac-Dateien aus GitHub Actions> (siehe release-mac.ts).

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { LAUNCHER_VERSION } from '../main/config';
import { verifyManifest, type UpdateManifest } from '../main/core/updater';
import { readReleaseNotes } from './release-common';

const UPDATE_KEY_PATH = path.join(os.homedir(), '.heldixclient-dev', 'update-key.pem');
const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_KEY_TS = path.join(ROOT, 'src', 'main', 'update-public-key.ts');
/** Derselbe Schlüssel prüft im Spiel die Addons aus dem Addon-Store */
const MOD_STORE_KEY = path.join(ROOT, '..', 'mod', 'src', 'main', 'resources', 'heldix-store-key.pem');

async function writePublicKey(publicPem: string): Promise<boolean> {
  if ((await readFile(MOD_STORE_KEY, 'utf8').catch(() => '')) !== publicPem) await writeFile(MOD_STORE_KEY, publicPem);
  const current = await readFile(PUBLIC_KEY_TS, 'utf8').catch(() => '');
  if (current.includes(JSON.stringify(publicPem))) return false;
  await writeFile(
    PUBLIC_KEY_TS,
    [
      '// Öffentlicher Schlüssel für Launcher-Updates (siehe core/updater.ts).',
      '// Wird von "npm run update-key" geschrieben; null = dieser Build installiert keine Updates.',
      `export const UPDATE_PUBLIC_KEY: string | null = ${JSON.stringify(publicPem)};`,
      '',
    ].join('\n'),
  );
  return true;
}

async function loadPrivateKey(): Promise<KeyObject> {
  if (!existsSync(UPDATE_KEY_PATH)) throw new Error(`Kein Update-Schlüssel unter ${UPDATE_KEY_PATH}. Einmalig "npm run update-key" ausführen.`);
  return createPrivateKey(await readFile(UPDATE_KEY_PATH, 'utf8'));
}

async function init(): Promise<void> {
  let privateKey: KeyObject;
  if (existsSync(UPDATE_KEY_PATH)) {
    privateKey = await loadPrivateKey();
    console.log(`Update-Schlüssel vorhanden: ${UPDATE_KEY_PATH}`);
  } else {
    await mkdir(path.dirname(UPDATE_KEY_PATH), { recursive: true });
    privateKey = generateKeyPairSync('ed25519').privateKey;
    await writeFile(UPDATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log(`Neuer Update-Schlüssel: ${UPDATE_KEY_PATH}`);
    console.log('  → Diese Datei sichern (z. B. USB-Stick) und niemals weitergeben oder einchecken.');
    console.log('    Geht sie verloren, nehmen installierte Launcher keine Updates mehr an.');
  }
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (await writePublicKey(publicPem)) console.log('Öffentlicher Schlüssel in src/main/update-public-key.ts eingetragen → ab dem nächsten Build kennt die .exe ihn.');
  else console.log('src/main/update-public-key.ts passt schon.');
}

async function sha512(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

async function release(): Promise<void> {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const version = pkg.version;
  if (version !== LAUNCHER_VERSION) {
    throw new Error(`Version in package.json (${version}) und src/main/config.ts (${LAUNCHER_VERSION}) unterscheiden sich.`);
  }
  const privateKey = await loadPrivateKey();
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const embedded = await readFile(PUBLIC_KEY_TS, 'utf8').catch(() => '');
  if (!embedded.includes(JSON.stringify(publicPem))) {
    throw new Error('Der öffentliche Schlüssel im Quellcode passt nicht zum Update-Schlüssel. "npm run update-key" und danach neu bauen.');
  }

  const file = `HeldixClient-Setup-${version}.exe`;
  const installer = path.join(ROOT, 'release', file);
  if (!existsSync(installer)) throw new Error(`${installer} fehlt. Zuerst "npm run dist".`);
  // Hinweise: --note="…" (direkter Aufruf) oder die Zeilen „- …“ aus release-notes.md (siehe release-common.ts)
  const notes = await readReleaseNotes(ROOT, process.argv);
  if (notes.length === 0) console.log('Hinweis: keine Versionshinweise (release-notes.md ist leer).');
  const manifest: UpdateManifest = {
    v: 1,
    version,
    file,
    size: (await stat(installer)).size,
    sha512: await sha512(installer),
    date: new Date().toISOString().slice(0, 10),
    notes,
  };
  const text = JSON.stringify(manifest);
  const signature = sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');
  verifyManifest(text, signature, publicPem); // Selbsttest wie im Launcher

  const outDir = path.join(ROOT, 'release', 'update');
  await mkdir(outDir, { recursive: true });
  const updateJson = path.join(outDir, 'update.json');
  await writeFile(updateJson, `${JSON.stringify({ manifest: text, signature }, null, 2)}\n`);

  console.log(`Version ${version} signiert: ${updateJson}`);
  console.log(`  Installer: ${installer} (${(manifest.size / 1024 / 1024).toFixed(1)} MB)`);
  if (notes.length) console.log(`  Hinweise: ${notes.join(' · ')}`);
  console.log('');
  console.log('Hochladen (zuerst der Installer, update.json zuletzt):');
  console.log(`  scp "${installer}" "${updateJson}" root@heldixclient.com:/var/lib/heldix-dienst/updates/`);
  console.log('Den Pfad auf dem Server nennt der Server-Installer am Ende ("Updates veröffentlichen").');
}

const run = process.argv.includes('--init') ? init : release;
run().catch((error: Error) => {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
