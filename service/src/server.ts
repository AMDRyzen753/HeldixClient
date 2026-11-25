// Startpunkt: liest die Umgebungsvariablen und startet den Heldix-Dienst.
import path from 'node:path';
import { createService, DEFAULT_SESSION_SERVER } from './app';
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

const env = process.env;
const port = readPort(env.PORT);
const host = env.HOST?.trim() || undefined;
const dataDir = path.resolve(env.HELDIX_DIENST_DATA?.trim() || './data');
const sessionServer = readUrl(env.HELDIX_DIENST_SESSION_SERVER);
let capes: string[];
try {
  capes = parseCapeList(env.HELDIX_DIENST_CAPES);
} catch (err) {
  fail((err as Error).message);
}

const service = createService({
  dataDir,
  sessionServer,
  dev: env.HELDIX_DIENST_DEV === '1',
  capes,
  trustProxy: env.HELDIX_DIENST_TRUST_PROXY === '1',
  log,
});

service.server.on('error', (err) => fail(`Server-Fehler: ${err.message}`));
service.server.listen(port, host, () => {
  const address = service.server.address();
  const shown = typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address);
  log(`Heldix-Dienst läuft auf ${shown} (Daten: ${dataDir}, Session-Server: ${sessionServer})`);
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
