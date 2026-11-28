// Startpunkt: liest die Umgebungsvariablen und startet den Heldix-Dienst.
import { createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { createService, DEFAULT_SESSION_SERVER } from './app';
import { CALLBACK_PATH, type MicrosoftEndpoints } from './microsoft';
import { parseCapeList } from './validate';
import { VOICE_RANGE_DEFAULT, VOICE_RANGE_MAX, VOICE_RANGE_MIN } from './voice';
import { normalizeWorldDomain } from './worlds';

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

/** HELDIX_DIENST_VOICE: `0` schaltet den Voice Chat aus, `1` (oder leer) lässt ihn an. */
function readVoice(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value || value === '1') return true;
  if (value === '0') return false;
  fail(`Ungültige HELDIX_DIENST_VOICE: "${value}" (erwartet 0 oder 1)`);
}

/** HELDIX_DIENST_VOICE_RANGE: Reichweite des Voice Chats in Blöcken. */
function readVoiceRange(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return VOICE_RANGE_DEFAULT;
  const range = /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  if (!(range >= VOICE_RANGE_MIN && range <= VOICE_RANGE_MAX)) {
    fail(`Ungültige HELDIX_DIENST_VOICE_RANGE: "${value}" (erwartet eine ganze Zahl von ${VOICE_RANGE_MIN} bis ${VOICE_RANGE_MAX})`);
  }
  return range;
}

/** HELDIX_DIENST_LIVE_MIN: Live-Zahlen (/v1/public/stats) erst ab so vielen Spielern online (Standard 50, 0 = immer). */
function readLiveMin(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return 50;
  const min = /^\d{1,6}$/.test(value) ? Number(value) : NaN;
  if (!(min >= 0)) fail(`Ungültige HELDIX_DIENST_LIVE_MIN: "${value}" (erwartet eine ganze Zahl ab 0)`);
  return min;
}

/** HELDIX_DIENST_WELT_DOMAIN: Domain für Welt teilen (Adressen `<code>.<domain>`); leer: aus. */
function readWorldDomain(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const domain = normalizeWorldDomain(value);
  if (domain === null) fail(`Ungültige HELDIX_DIENST_WELT_DOMAIN: "${value}" (erwartet z. B. welt.heldixclient.com, ohne Port)`);
  return domain;
}

/** HELDIX_DIENST_WELT_PORT: TCP-Port des Welt-Relays (Standard 25565). */
function readWorldPort(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return 25565;
  const port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  if (!(port >= 1 && port <= 65535)) fail(`Ungültige HELDIX_DIENST_WELT_PORT: "${value}" (erwartet 1 bis 65535)`);
  return port;
}

/** HELDIX_DIENST_WELT_BIND: IP-Adresse, auf der das Welt-Relay lauscht (Standard 0.0.0.0, `::` für IPv4 und IPv6). */
function readWorldBind(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return '0.0.0.0';
  if (isIP(value) === 0) fail(`Ungültige HELDIX_DIENST_WELT_BIND: "${value}" (erwartet eine IP-Adresse, z. B. 0.0.0.0 oder ::)`);
  return value;
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
const voice = readVoice(env.HELDIX_DIENST_VOICE);
const voiceRange = readVoiceRange(env.HELDIX_DIENST_VOICE_RANGE);
const weltDomain = readWorldDomain(env.HELDIX_DIENST_WELT_DOMAIN);
const weltPort = readWorldPort(env.HELDIX_DIENST_WELT_PORT);
const weltBind = readWorldBind(env.HELDIX_DIENST_WELT_BIND);
const liveStatsMinOnline = readLiveMin(env.HELDIX_DIENST_LIVE_MIN);
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
  voice,
  voiceRange,
  weltDomain,
  weltPort,
  weltBind,
  liveStatsMinOnline,
  log,
});

service.server.on('error', (err) => fail(`Server-Fehler: ${err.message}`));
service.server.listen(port, host, () => {
  const address = service.server.address();
  const shown = typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address);
  log(`Heldix-Dienst läuft auf ${shown} (Daten: ${dataDir}, Updates: ${updatesDir}, Addons: ${addonsDir}, Session-Server: ${sessionServer})`);
  log(`Webseite: ${website ?? 'nicht eingerichtet (keine Anmeldung auf der Webseite)'} · Update-Schlüssel: ${updateKey ? 'eingerichtet' : 'keiner (kein Veröffentlichen von Updates, Addons und Cosmetics im Team-Bereich)'}`);
  log(`Anmeldung mit dem Minecraft-Konto auf der Webseite: ${microsoftStatus()}`);
  log(`Voice Chat (/v1/voice): ${voice ? `an (Reichweite ${voiceRange} Blöcke)` : 'aus (HELDIX_DIENST_VOICE=0)'}`);
  if (weltDomain === null) log('Welt teilen: aus (keine HELDIX_DIENST_WELT_DOMAIN)');
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
