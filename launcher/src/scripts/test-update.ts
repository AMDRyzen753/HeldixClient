// Prüft den Updater (core/updater.ts) gegen einen kleinen Test-Server auf 127.0.0.1:
// gültiges Update, falsche Signatur, ältere Version, veränderter Download, zu große Datei.
// Mit --service=<Adresse> zusätzlich gegen einen echten Heldix-Dienst (dessen update.json mit dem echten Schlüssel).
//
// Aufruf: npm run test:update [-- --service=http://127.0.0.1:8787 --current=0.10.0]

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { UPDATE_PUBLIC_KEY } from '../main/update-public-key';
import { Updater, compareVersions } from '../main/core/updater';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FEHLER'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

interface Fake {
  manifest: string;
  signature: string;
  body: Buffer;
}

async function serve(fake: () => Fake): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const f = fake();
    if (req.url === '/v1/launcher/latest') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ manifest: f.manifest, signature: f.signature }));
    } else if (req.url?.startsWith('/v1/launcher/download/')) {
      res.writeHead(200, { 'content-length': f.body.length });
      res.end(f.body);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function main(): Promise<void> {
  check('Versionen vergleichen', compareVersions('0.12.0', '0.11.9') > 0 && compareVersions('1.0.0-beta.1', '1.0.0') < 0 && compareVersions('0.11.0', '0.11.0') === 0);

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const other = generateKeyPairSync('ed25519').privateKey;
  const body = Buffer.from('nur ein Test-Installer '.repeat(5000));
  const make = (version: string, data = body, key = privateKey): Fake => {
    const manifest = JSON.stringify({
      v: 1, version, file: `HeldixClient-Setup-${version}.exe`, size: body.length,
      sha512: createHash('sha512').update(body).digest('base64'), date: '2026-11-25', notes: ['Neu: Test'],
    });
    return { manifest, signature: sign(null, Buffer.from(manifest), key).toString('base64'), body: data };
  };

  let current = make('0.12.0');
  const { server, url } = await serve(() => current);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'heldix-update-'));
  try {
    const updater = (version = '0.11.0') => new Updater({ baseUrl: url, currentVersion: version, dir, publicKey: pem, log: () => undefined });

    let u = updater();
    let state = await u.check();
    check('neue Version wird geladen und geprüft', state.phase === 'ready' && state.version === '0.12.0', state.error);
    check('Pfad des Installers', u.installerPath()?.endsWith('HeldixClient-Setup-0.12.0.exe') === true);

    state = await updater('0.12.0').check();
    check('gleiche Version: aktuell', state.phase === 'current', state.phase);
    state = await updater('0.13.0').check();
    check('ältere Version wird nicht angeboten (kein Zurückspielen)', state.phase === 'current', state.phase);

    current = make('0.12.1', body, other);
    state = await updater().check();
    check('fremde Signatur wird abgelehnt', state.phase === 'error' && /Signatur/.test(state.error ?? ''), state.error);

    const tampered = Buffer.from(body);
    tampered[100] ^= 1;
    current = make('0.12.2', tampered);
    state = await updater().check();
    check('veränderter Download wird abgelehnt', state.phase === 'error' && /Prüfsumme/.test(state.error ?? ''), state.error);

    current = make('0.12.3', Buffer.concat([body, Buffer.from('mehr')]));
    state = await updater().check();
    check('zu große Datei wird abgebrochen', state.phase === 'error', state.error);

    const bad = make('0.12.4');
    current = { ...bad, manifest: bad.manifest.replace('0.12.4.exe', '0.12.4.exe.bat') };
    state = await updater().check();
    check('verändertes Manifest wird abgelehnt', state.phase === 'error', state.error);

    // gegen einen echten Heldix-Dienst mit dem eingebauten Schlüssel
    const service = process.argv.find((a) => a.startsWith('--service='))?.slice('--service='.length);
    if (service) {
      const version = process.argv.find((a) => a.startsWith('--current='))?.slice('--current='.length) ?? '0.0.1';
      const real = new Updater({ baseUrl: service, currentVersion: version, dir, publicKey: UPDATE_PUBLIC_KEY, log: () => undefined });
      state = await real.check();
      check(`Heldix-Dienst ${service}: Update geladen und geprüft`, state.phase === 'ready', `${state.phase} ${state.version ?? ''} ${state.error ?? ''}`);
    }
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
  console.log(failures === 0 ? 'Updater: alle Prüfungen bestanden' : `Updater: ${failures} Fehler`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
