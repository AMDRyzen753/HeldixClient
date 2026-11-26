// Startpunkt: liest die Umgebungsvariablen und startet den Heldix-Dienst.
import { createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createService, DEFAULT_SESSION_SERVER } from './app';
import { CALLBACK_PATH, type MicrosoftEndpoints } from './microsoft';
import { parseCapeList } from './validate';

function log(line: string): void {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

function fail(message: string): never {
  console.error(`Heldix-Dienst: ${message}`);
  process.exit(1);
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 8787;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Ungültiger PORT: "${raw}"`);
  return port;
}

function readUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_SESSION_SERVER;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
  } catch {
    fail(`Ungültige HELDIX_DIENST_SESSION_SERVER: "${value}"`);
  }
  return value.replace(/\/+$/, '');
}

/**
 * Adresse ohne Pfad (nur Schema, Name, Port), z. B. HELDIX_DIENST_WEBSITE=https://heldixclient.com oder
 * HELDIX_DIENST_API_URL=https://api.heldixclient.com
 */
function readOrigin(name: string, raw: string | undefined, example: string): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname.replace(/\/+$/, '') !== '' || url.search || url.hash) {
      throw new Error();
    }
    return url.origin;
  } catch {
    fail(`Ungültige ${name}: "${value}" (erwartet z. B. ${example})`);
  }
}

/** HELDIX_DIENST_MS_CLIENT_ID: Anwendungs-ID der Azure-App (GUID); leer: keine Anmeldung mit dem Minecraft-Konto. */
function readClientId(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    fail(`Ungültige HELDIX_DIENST_MS_CLIENT_ID: "${value}" (erwartet die Anwendungs-ID der Azure-App, z. B. 00000000-0000-0000-0000-000000000000)`);
  }
  return value.toLowerCase();
}

/**
 * HELDIX_DIENST_MS_CLIENT_SECRET_FILE: Datei mit dem Client-Geheimnis (eine Zeile). Der Inhalt erscheint nie im Log.
 * Nicht lesbar oder leer: undefined (dann bleibt die Anmeldung mit dem Minecraft-Konto aus).
 */
function readClientSecret(raw: string | undefined): string | null | undefined {
  const file = raw?.trim();
  if (!file) return null;
  try {
    const secret = fs.readFileSync(file, 'utf8').trim();
    if (secret === '' || secret.length > 1024 || /[\r\n]/.test(secret)) throw new Error('leer oder mehr als eine Zeile');
    return secret;
  } catch (err) {
    const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
    log(`WARNUNG: Client-Geheimnis ${file} nicht nutzbar (${reason}). Die Anmeldung mit dem Minecraft-Konto ist aus.`);
    return undefined;
  }
}

/** Nur mit HELDIX_DIENST_DEV=1 (Tests): andere Adressen für Microsoft, Xbox Live und die Minecraft-Dienste. */
function readMicrosoftEndpoints(dev: boolean): Partial<MicrosoftEndpoints> | undefined {
  const names = {
    login: 'HELDIX_DIENST_MS_LOGIN_URL',
    xboxUser: 'HELDIX_DIENST_XBOX_USER_URL',
    xsts: 'HELDIX_DIENST_XSTS_URL',
    minecraft: 'HELDIX_DIENST_MINECRAFT_URL',
  } as const;
  const out: Partial<MicrosoftEndpoints> = {};
  for (const [key, name] of Object.entries(names) as [keyof MicrosoftEndpoints, string][]) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    if (!dev) {
      log(`WARNUNG: ${name} gilt nur im Entwicklungsmodus (HELDIX_DIENST_DEV=1) und wird ignoriert.`);
      continue;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    } catch {
      fail(`Ungültige ${name}: "${value}"`);
    }
    out[key] = value.replace(/\/+$/, '');
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * HELDIX_DIENST_UPDATE_KEY: Datei mit dem öffentlichen Update-Schlüssel (PEM). Fehlt sie oder ist sie ungültig, startet
 * der Dienst trotzdem; nur das Veröffentlichen im Team-Bereich geht dann nicht (503).
 */
function readUpdateKey(raw: string | undefined): string | null {
  const file = raw?.trim();
  if (!file) return null;
  try {
    const pem = fs.readFileSync(file, 'utf8');
    if (createPublicKey(pem).asymmetricKeyType !== 'ed25519') throw new Error('kein Ed25519-Schlüssel');
    return pem;
  } catch (err) {
    log(`WARNUNG: Update-Schlüssel ${file} nicht nutzbar (${(err as Error).message}). Veröffentlichen im Team-Bereich ist aus.`);
    return null;
  }
}

const env = process.env;
const port = readPort(env.PORT);
const host = env.HOST?.trim() || undefined;
const dataDir = path.resolve(env.HELDIX_DIENST_DATA?.trim() || './data');
const updatesDir = path.resolve(env.HELDIX_DIENST_UPDATES?.trim() || path.join(dataDir, 'updates'));
const addonsDir = path.resolve(env.HELDIX_DIENST_ADDONS?.trim() || path.join(dataDir, 'addons'));
const sessionServer = readUrl(env.HELDIX_DIENST_SESSION_SERVER);
const website = readOrigin('HELDIX_DIENST_WEBSITE', env.HELDIX_DIENST_WEBSITE, 'https://heldixclient.com');
const apiUrl = readOrigin('HELDIX_DIENST_API_URL', env.HELDIX_DIENST_API_URL, 'https://api.heldixclient.com');
const updateKey = readUpdateKey(env.HELDIX_DIENST_UPDATE_KEY);
const dev = env.HELDIX_DIENST_DEV === '1';
const clientId = readClientId(env.HELDIX_DIENST_MS_CLIENT_ID);
const clientSecret = readClientSecret(env.HELDIX_DIENST_MS_CLIENT_SECRET_FILE);
const microsoftEndpoints = readMicrosoftEndpoints(dev);
// Anmeldung mit dem Minecraft-Konto: nur mit App-ID, Webseite und API-Adresse (und lesbarem Geheimnis, falls angegeben)
const microsoft = clientId !== null && clientSecret !== undefined && website !== null && apiUrl !== null ? { clientId, clientSecret } : null;
function microsoftStatus(): string {
  if (microsoft) {
    const kind = microsoft.clientSecret === null ? 'öffentlicher Client mit PKCE' : 'mit Client-Geheimnis';
    return `an (${kind}, Umleitungs-URI ${apiUrl}${CALLBACK_PATH})`;
  }
  if (clientId === null) return 'aus (keine HELDIX_DIENST_MS_CLIENT_ID)';
  if (clientSecret === undefined) return 'aus (Client-Geheimnis nicht lesbar)';
  if (website === null) return 'aus (keine HELDIX_DIENST_WEBSITE)';
  return 'aus (keine HELDIX_DIENST_API_URL)';
}
let capes: string[];
try {
  capes = parseCapeList(env.HELDIX_DIENST_CAPES);
} catch (err) {
  fail((err as Error).message);
}

const service = createService({
  dataDir,
  updatesDir,
  addonsDir,
  sessionServer,
  dev,
  capes,
  trustProxy: env.HELDIX_DIENST_TRUST_PROXY === '1',
  website,
  apiUrl,
  microsoft,
  microsoftEndpoints,
  updateKey,
  log,
});

service.server.on('error', (err) => fail(`Server-Fehler: ${err.message}`));
service.server.listen(port, host, () => {
  const address = service.server.address();
  const shown = typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address);
  log(`Heldix-Dienst läuft auf ${shown} (Daten: ${dataDir}, Updates: ${updatesDir}, Addons: ${addonsDir}, Session-Server: ${sessionServer})`);
  log(`Webseite: ${website ?? 'nicht eingerichtet (keine Anmeldung auf der Webseite)'} · Update-Schlüssel: ${updateKey ? 'eingerichtet' : 'keiner (kein Veröffentlichen von Updates, Addons und Cosmetics im Team-Bereich)'}`);
  log(`Anmeldung mit dem Minecraft-Konto auf der Webseite: ${microsoftStatus()}`);
});

let stopping = false;
function stop(signal: string): void {
  if (stopping) return;
  stopping = true;
  log(`${signal} empfangen, Dienst wird beendet …`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  service.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
