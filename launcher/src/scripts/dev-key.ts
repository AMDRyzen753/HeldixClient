// Erstellt einen Entwickler-Schlüssel, der in der fertigen App Offline-Konten ohne Microsoft-Konto freischaltet
// (Einstellungen → Entwickler → Entwickleroptionen).
//
// Aufruf: npm run dev-key -- [--name=<Name>] [--pc=<PC-Kennung>] [--out=<Datei>]
//
// Beim ersten Aufruf entsteht ein Schlüsselpaar:
//   privat:     %USERPROFILE%\.heldixclient-dev\signing-key.pem   (nie weitergeben, nie einchecken)
//   öffentlich: src/main/dev-public-key.ts                         (danach "npm run dist", damit die .exe ihn kennt)
// Ohne --pc gilt der Schlüssel für diesen PC und landet direkt im Datenordner des Launchers.
// Für einen anderen PC dort unter Einstellungen → Entwickler die PC-Kennung ablesen und mit --pc angeben.

import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR_NAME } from '../main/config';
import { DEV_KEY_FILE, SIGNING_KEY_PATH, checkDevKey, machineCode, signDevKey } from '../main/core/devkey';
import { defaultDataRoot } from '../main/core/paths';

const PRIVATE_KEY = SIGNING_KEY_PATH;
const KEY_DIR = path.dirname(PRIVATE_KEY);
const PUBLIC_KEY_TS = path.join(__dirname, '..', '..', 'src', 'main', 'dev-public-key.ts');

async function loadOrCreatePrivateKey(): Promise<KeyObject> {
  if (existsSync(PRIVATE_KEY)) return createPrivateKey(await readFile(PRIVATE_KEY, 'utf8'));
  await mkdir(KEY_DIR, { recursive: true });
  const { privateKey } = generateKeyPairSync('ed25519');
  await writeFile(PRIVATE_KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Neues Schlüsselpaar erstellt. Privater Schlüssel: ${PRIVATE_KEY}`);
  console.log('  → Diese Datei sichern und niemals weitergeben oder einchecken.');
  return privateKey;
}

/** Schreibt den öffentlichen Schlüssel in den Quellcode; true, wenn er sich geändert hat. */
async function writePublicKey(publicPem: string): Promise<boolean> {
  const current = await readFile(PUBLIC_KEY_TS, 'utf8').catch(() => '');
  if (current.includes(JSON.stringify(publicPem))) return false;
  await writeFile(
    PUBLIC_KEY_TS,
    [
      '// Öffentlicher Schlüssel für Entwickler-Schlüssel (siehe core/devkey.ts).',
      '// Wird von "npm run dev-key" geschrieben; null = dieser Build nimmt keine Entwickler-Schlüssel an.',
      `export const DEV_PUBLIC_KEY: string | null = ${JSON.stringify(publicPem)};`,
      '',
    ].join('\n'),
  );
  return true;
}

async function main(): Promise<void> {
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const name = (flag('name') ?? 'Entwickler').trim();
  if (!/^[\p{L}\p{N} _.-]{1,32}$/u.test(name)) throw new Error('--name: 1–32 Zeichen (Buchstaben, Zahlen, Leerzeichen, _ . -)');
  const thisPc = machineCode();
  const pc = (flag('pc') ?? thisPc).trim().toUpperCase();
  if (!/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(pc)) throw new Error('--pc: PC-Kennung wie 3F2A-91C0-7B44-E0D1 (steht im Launcher unter Einstellungen → Entwickler)');

  const privateKey = await loadOrCreatePrivateKey();
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const changed = await writePublicKey(publicPem);

  const key = signDevKey(privateKey, name, pc);
  const check = checkDevKey(JSON.stringify(key), publicPem, pc);
  if (!check.valid) throw new Error(`Selbsttest fehlgeschlagen: ${check.reason}`);

  const dataRoot = process.env.HELDIX_DATA_DIR ?? defaultDataRoot(DATA_DIR_NAME);
  const out = flag('out') ?? (pc === thisPc ? path.join(dataRoot, DEV_KEY_FILE) : path.resolve(`developer-${pc}.key`));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(key, null, 2)}\n`);

  console.log(`Entwickler-Schlüssel für ${name} (PC ${pc}) gespeichert: ${out}`);
  if (pc !== thisPc) console.log("  → Auf dem anderen PC: Einstellungen → Entwickler → „Schlüssel importieren …“ und diese Datei auswählen.");
  if (changed) console.log('Öffentlicher Schlüssel in src/main/dev-public-key.ts eingetragen → jetzt "npm run dist", damit die .exe ihn kennt.');
  console.log('Im Launcher: Einstellungen → Entwickler → Entwickleroptionen einschalten.');
  console.log(`Weitere eigene PCs: dort im Launcher „Schlüssel importieren …“ und ${PRIVATE_KEY} auswählen (z. B. vom USB-Stick).`);
}

main().catch((error: Error) => {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
