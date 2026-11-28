// Baut den Ein-Befehl-Installer für Linux-Server: service/release/heldix-dienst-install.sh
//
//   npm run installer
//
// Ablauf: Dienst bauen (dist/), Laufzeitpakete ohne Entwicklungspakete holen (nur ws), Webseite bauen (website/),
// öffentlichen Update-Schlüssel aus launcher/src/main/update-public-key.ts als update-public-key.pem dazulegen,
// alles als tar.gz packen und Base64-kodiert in installer/install.sh einsetzen; dazu die App-ID des Launchers
// (launcher/src/main/config.ts) als Standard für --minecraft-login. Die fertige Datei braucht auf dem Server nur bash und curl;
// Node.js und Caddy lädt sie selbst (mit Prüfsumme). Im Paket steckt auch der Welten-Wächter (dist/agent/, dauerhafte
// Welten mit --hosting).
//
//   node installer/build.mjs --out <ordner>   zum Ausprobieren in einen anderen Ordner statt service/release/
import { execSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { buildWebsite } from '../../website/build.mjs';

const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outIndex = process.argv.indexOf('--out');
if (outIndex !== -1 && !process.argv[outIndex + 1]) throw new Error('--out braucht einen Ordner');
const releaseDir = outIndex === -1 ? path.join(serviceDir, 'release') : path.resolve(process.argv[outIndex + 1]);
const output = path.join(releaseDir, 'heldix-dienst-install.sh');
const pkg = JSON.parse(readFileSync(path.join(serviceDir, 'package.json'), 'utf8'));
const keySource = path.join(serviceDir, '..', 'launcher', 'src', 'main', 'update-public-key.ts');
const configSource = path.join(serviceDir, '..', 'launcher', 'src', 'main', 'config.ts');

/**
 * Liest die App-ID (MICROSOFT_CLIENT_ID) aus der config.ts des Launchers (nur lesen, nie ändern). Der Installer nimmt
 * sie mit --minecraft-login für die Anmeldung mit dem Minecraft-Konto auf der Webseite: dieselbe App-Registrierung, die
 * Mojang freigegeben hat. Leer: keine gefunden (dann braucht der Installer --ms-client-id).
 */
function readMicrosoftClientId() {
  let source;
  try {
    source = readFileSync(configSource, 'utf8');
  } catch {
    return '';
  }
  const match = /MICROSOFT_CLIENT_ID\b[^=]*=\s*process\.env\.HELDIX_MS_CLIENT_ID\s*\?\?\s*'([^']*)'/.exec(source);
  const id = match ? match[1].trim().toLowerCase() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : '';
}

/**
 * Liest UPDATE_PUBLIC_KEY aus der Datei des Launchers (nur lesen, nie ändern). Mit diesem Schlüssel prüft der Dienst
 * Updates, die im Team-Bereich veröffentlicht werden. null: kein Schlüssel (Veröffentlichen im Browser bleibt aus).
 */
function readUpdateKey() {
  let source;
  try {
    source = readFileSync(keySource, 'utf8');
  } catch {
    return null;
  }
  const match = /UPDATE_PUBLIC_KEY\b[^=]*=\s*("(?:[^"\\]|\\.)*"|null)\s*;/.exec(source);
  if (!match || match[1] === 'null') return null;
  const pem = JSON.parse(match[1]);
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${keySource}: UPDATE_PUBLIC_KEY ist kein Ed25519-Schlüssel`);
  return pem.endsWith('\n') ? pem : `${pem}\n`;
}

console.log(`Heldix-Dienst ${pkg.version}: baue …`);
execSync('npm run build', { cwd: serviceDir, stdio: 'inherit' });

// Laufzeitpakete in einem leeren Ordner installieren (genau die Versionen aus package-lock.json)
const stage = mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-'));
try {
  copyFileSync(path.join(serviceDir, 'package.json'), path.join(stage, 'package.json'));
  copyFileSync(path.join(serviceDir, 'package-lock.json'), path.join(stage, 'package-lock.json'));
  execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error', { cwd: stage, stdio: 'inherit' });

  // Dateien fürs Paket: package.json, dist/ (ohne Test-Build), node_modules/
  const entries = [];
  const add = (absolute, name) => {
    const info = statSync(absolute);
    if (info.isDirectory()) {
      entries.push({ name: `${name}/`, dir: true });
      for (const child of readdirSync(absolute).sort()) add(path.join(absolute, child), `${name}/${child}`);
    } else if (info.isFile()) {
      entries.push({ name, data: readFileSync(absolute) });
    }
  };
  add(path.join(serviceDir, 'package.json'), 'package.json');
  entries.push({ name: 'dist/', dir: true });
  for (const file of readdirSync(path.join(serviceDir, 'dist')).sort()) {
    if (file === 'test-build') continue;
    add(path.join(serviceDir, 'dist', file), `dist/${file}`);
  }
  add(path.join(stage, 'node_modules'), 'node_modules');
  // Webseite (website/, mit Impressum und Datenschutz aus website/site.config.json)
  const siteComplete = buildWebsite(path.join(stage, 'website'));
  add(path.join(stage, 'website'), 'website');
  if (!siteComplete) console.warn('ACHTUNG: website/site.config.json fehlt – Impressum und Datenschutz enthalten Platzhalter.');
  // Öffentlicher Update-Schlüssel (für das Veröffentlichen im Team-Bereich)
  const updateKey = readUpdateKey();
  if (updateKey) entries.push({ name: 'update-public-key.pem', data: Buffer.from(updateKey, 'utf8') });
  else console.warn('Hinweis: kein UPDATE_PUBLIC_KEY im Launcher – Updates lassen sich im Team-Bereich nicht veröffentlichen.');
  const required = [
    'dist/server.js',
    'dist/app.js',
    'dist/agent/main.js',
    'dist/hosting/agent-runner.js',
    'node_modules/ws/package.json',
    'website/index.html',
    'website/datenschutz.html',
  ];
  for (const name of required) {
    if (!entries.some((e) => e.name === name)) throw new Error(`Im Paket fehlt ${name}`);
  }

  const tgz = zlib.gzipSync(tar(entries), { level: 9 });
  const base64 = tgz.toString('base64').replace(/.{1,76}/g, '$&\n').trimEnd();

  const template = readFileSync(path.join(serviceDir, 'installer', 'install.sh'), 'utf8').replace(/\r\n/g, '\n');
  if (!template.includes('__HELDIX_PAYLOAD__')) throw new Error('Platzhalter __HELDIX_PAYLOAD__ fehlt in install.sh');
  const msClientId = readMicrosoftClientId();
  if (!msClientId) console.warn('Hinweis: keine MICROSOFT_CLIENT_ID im Launcher – --minecraft-login braucht dann --ms-client-id.');
  const script = template
    .replaceAll('__HELDIX_VERSION__', pkg.version)
    .replaceAll('__HELDIX_MS_CLIENT_ID__', msClientId)
    .replace('__HELDIX_PAYLOAD__', base64);

  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(output, script, { mode: 0o755 });
  const sha256 = createHash('sha256').update(script).digest('hex');
  writeFileSync(`${output}.sha256`, `${sha256}  heldix-dienst-install.sh\n`);
  const files = entries.filter((e) => !e.dir).length;
  if (updateKey) console.log('Update-Schlüssel: aus launcher/src/main/update-public-key.ts übernommen');
  if (msClientId) console.log(`App-ID für --minecraft-login: ${msClientId} (aus launcher/src/main/config.ts)`);
  console.log(`Installer fertig: ${path.relative(process.cwd(), output)} (${Math.round(script.length / 1024)} KB, ${files} Dateien im Paket)`);
  console.log(`SHA-256: ${sha256}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

/** Minimales tar (ustar): Dateien 0644, Ordner 0755, Besitzer root – unabhängig vom System, auf dem gebaut wird. */
function tar(entries) {
  const blocks = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    let name = entry.name;
    let prefix = '';
    if (Buffer.byteLength(name) > 100) {
      // langer Pfad: vorderer Teil ins Feld "prefix" (bis 155 Zeichen), getrennt an einem Schrägstrich
      const cut = name.lastIndexOf('/', name.length - 2);
      prefix = name.slice(0, cut);
      name = name.slice(cut + 1);
      if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Pfad zu lang für tar: ${entry.name}`);
    }
    const size = entry.dir ? 0 : entry.data.length;
    header.write(name, 0, 100, 'utf8');
    header.write(entry.dir ? '0000755\0' : '0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii'); // uid
    header.write('0000000\0', 116, 8, 'ascii'); // gid
    header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write(`${mtime.toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii');
    header.write('        ', 148, 8, 'ascii'); // Prüfsumme: erst Leerzeichen
    header.write(entry.dir ? '5' : '0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.write('root', 265, 32, 'ascii');
    header.write('root', 297, 32, 'ascii');
    header.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header);
    if (!entry.dir) {
      blocks.push(entry.data);
      const padding = (512 - (size % 512)) % 512;
      if (padding) blocks.push(Buffer.alloc(padding));
    }
  }
  blocks.push(Buffer.alloc(1024)); // Ende: zwei leere Blöcke
  return Buffer.concat(blocks);
}
