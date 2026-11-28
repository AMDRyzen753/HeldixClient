// Prüft den Updater (core/updater.ts) gegen einen kleinen Test-Server auf 127.0.0.1:
// gültiges Update, falsche Signatur, ältere Version, veränderter Download, zu große Datei. Dazu das Update beim Start
// (core/startup-update.ts): Plan und Entscheidung (Einstellung aus, Spiel läuft, macOS, fehlgeschlagener Versuch),
// Zeitgrenze der Prüfung, wiederverwendeter Installer, Argumente für den stillen Start mit Neustart, „Neu in …“ nur
// einmal, Merkdatei und Spiel aus einer früheren Sitzung.
// Mit --service=<Adresse> zusätzlich gegen einen echten Heldix-Dienst (dessen update.json mit dem echten Schlüssel).
//
// Aufruf: npm run test:update [-- --service=http://127.0.0.1:8787 --current=0.10.0]

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { UPDATE_PUBLIC_KEY } from '../main/update-public-key';
import { CHECK_INTERVAL_MS, Updater, compareVersions, installerArgs, type UpdateState } from '../main/core/updater';
import {
  GAME_MARKER_MAX_MS,
  RETRY_INSTALL_AFTER_MS,
  STARTUP_CHECK_TIMEOUT_MS,
  decideStartupUpdate,
  parseGameMarker,
  parseUpdateMemo,
  pickWhatsNew,
  previousGameRunning,
  processAlive,
  readUpdateMemo,
  settleUpdateMemo,
  splashText,
  startupPlan,
  writeUpdateMemo,
  type StartupInput,
} from '../main/core/startup-update';

let failures = 0;
let passed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FEHLER'} ${label}${detail ? ` (${detail})` : ''}`);
  if (ok) passed++;
  else failures++;
}

interface Fake {
  manifest: string;
  signature: string;
  body: Buffer;
}

/** Verhalten des Test-Servers: Antwort von /latest verzögern oder mit Fehler; Zähler der Downloads */
const behavior = { latestDelayMs: 0, latestStatus: 200, downloads: 0 };

async function serve(fake: () => Fake): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const f = fake();
    if (req.url === '/v1/launcher/latest') {
      const answer = () => {
        if (res.destroyed) return;
        if (behavior.latestStatus !== 200) {
          res.writeHead(behavior.latestStatus).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ manifest: f.manifest, signature: f.signature }));
      };
      if (behavior.latestDelayMs > 0) setTimeout(answer, behavior.latestDelayMs);
      else answer();
    } else if (req.url?.startsWith('/v1/launcher/download/')) {
      behavior.downloads++;
      res.writeHead(200, { 'content-length': f.body.length });
      res.end(f.body);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** Entscheidung beim Start: Plan, Spiel, Einstellung, macOS, fehlgeschlagener Versuch (ohne Netz) */
function startupDecisions(): void {
  check('Argumente: still mit Neustart = /S --updated --force-run', JSON.stringify(installerArgs(true)) === JSON.stringify(['/S', '--updated', '--force-run']));
  check('Argumente: still ohne Neustart (beim Beenden) = /S --updated', JSON.stringify(installerArgs(false)) === JSON.stringify(['/S', '--updated']));
  check('Argumente: kein /D= (Verzeichnis bleibt aus der Registry)', !installerArgs(true).some((a) => /^\/D=/i.test(a)));
  check('im laufenden Launcher alle 30 Minuten', CHECK_INTERVAL_MS === 30 * 60_000);
  check('Zeitgrenze beim Start 3–4 s', STARTUP_CHECK_TIMEOUT_MS >= 3000 && STARTUP_CHECK_TIMEOUT_MS <= 4000);

  check('Plan: ohne Adresse/Schlüssel (Entwicklung ohne HELDIX_UPDATE_URL) → gar nicht', startupPlan({ enabled: false, platform: 'win32', autoUpdate: true }) === 'off');
  check('Plan: Windows, automatisch → Startfenster', startupPlan({ enabled: true, platform: 'win32', autoUpdate: true }) === 'splash');
  check('Plan: Windows, Einstellung aus → nur Hinweis im Hintergrund', startupPlan({ enabled: true, platform: 'win32', autoUpdate: false }) === 'background');
  check('Plan: macOS → nur Hinweis im Hintergrund', startupPlan({ enabled: true, platform: 'darwin', autoUpdate: true }) === 'background');

  const now = 1_800_000_000_000;
  const base: StartupInput = { platform: 'win32', autoUpdate: true, state: { phase: 'available', version: '0.13.8' }, gameRunning: false, attempt: null, now };
  const decide = (patch: Partial<StartupInput>) => JSON.stringify(decideStartupUpdate({ ...base, ...patch }));
  check('Start: neue Version → installieren', decide({}) === JSON.stringify({ action: 'install' }));
  check('Start: schon geladen (ready) → installieren', decide({ state: { phase: 'ready', version: '0.13.8' } }) === JSON.stringify({ action: 'install' }));
  check('Start: aktuell → normal starten', decide({ state: { phase: 'current' } }) === JSON.stringify({ action: 'start', reason: 'current' }));
  check('Start: Fehler/offline/Zeitgrenze → normal starten', decide({ state: { phase: 'error' } }) === JSON.stringify({ action: 'start', reason: 'error' }));
  check('Start: Einstellung aus → nur Hinweis „Jetzt installieren“', decide({ autoUpdate: false }) === JSON.stringify({ action: 'notify', reason: 'install' }));
  check('Start: macOS → Hinweis mit Download, nichts Automatisches', decide({ platform: 'darwin' }) === JSON.stringify({ action: 'notify', reason: 'download' }));
  check('Start: Spiel aus früherer Sitzung läuft → nicht installieren', decide({ gameRunning: true }) === JSON.stringify({ action: 'start', reason: 'game' }));
  check('Start: derselbe Versuch eben fehlgeschlagen → später', decide({ attempt: { version: '0.13.8', at: now - 5 * 60_000 } }) === JSON.stringify({ action: 'start', reason: 'retry-later' }));
  check('Start: Versuch ist lange her → wieder installieren', decide({ attempt: { version: '0.13.8', at: now - RETRY_INSTALL_AFTER_MS - 1 } }) === JSON.stringify({ action: 'install' }));
  check('Start: Versuch einer anderen Version zählt nicht', decide({ attempt: { version: '0.13.7', at: now - 60_000 } }) === JSON.stringify({ action: 'install' }));

  check('Startfenster: Suche', splashText({ phase: 'checking' }).title === 'Suche nach Updates …');
  const loading = splashText({ phase: 'downloading', version: '0.13.8', progress: 0.42 });
  check('Startfenster: „Update auf 0.13.8 wird geladen … 42 %“', loading.title === 'Update auf 0.13.8 wird geladen … 42 %' && loading.progress === 0.42, loading.title);
  check('Startfenster: „Wird installiert …“', splashText({ phase: 'ready', version: '0.13.8' }, true).title === 'Wird installiert …');
}

/** „Neu in …“, Merkdatei und Spiel aus einer früheren Sitzung */
async function startupMemory(dir: string): Promise<void> {
  const saved = { version: '0.13.8', date: '2026-11-28', notes: ['Updates direkt beim Start'] };
  let r = pickWhatsNew('0.13.8', null, null, saved);
  check('Neu in: erste Installation → nichts zeigen, nur merken', r.show === null && r.markSeen);
  r = pickWhatsNew('0.13.8', '0.13.7', null, saved);
  check('Neu in: Dienst nicht erreichbar → Hinweise aus dem Manifest', r.show?.version === '0.13.8' && r.show.entries[0]?.notes[0] === 'Updates direkt beim Start' && r.markSeen);
  r = pickWhatsNew('0.13.8', '0.13.8', null, saved);
  check('Neu in: danach (gesehen) nicht noch einmal', r.show === null && !r.markSeen);
  const remote = [
    { version: '0.13.9', date: '', notes: ['zu neu'] },
    { version: '0.13.8', date: '2026-11-28', notes: ['acht'] },
    { version: '0.13.7', date: '2026-11-27', notes: ['sieben'] },
    { version: '0.13.6', date: '2026-11-20', notes: ['sechs'] },
  ];
  r = pickWhatsNew('0.13.8', '0.13.6', remote, saved);
  check('Neu in: Versionsverlauf seit der zuletzt gesehenen', JSON.stringify(r.show?.entries.map((e) => e.version)) === JSON.stringify(['0.13.8', '0.13.7']) && r.markSeen);
  r = pickWhatsNew('0.13.8', '0.13.7', null, null);
  check('Neu in: nicht erreichbar und nichts gemerkt → nächster Start', r.show === null && !r.markSeen);
  r = pickWhatsNew('0.13.8', '0.13.7', [{ version: '0.13.8', date: '', notes: [] }], null);
  check('Neu in: keine Hinweise → nichts zeigen, gesehen', r.show === null && r.markSeen);

  const file = path.join(dir, 'update-start.json');
  check('Merkdatei: fehlt → leer', JSON.stringify(await readUpdateMemo(file)) === JSON.stringify({ attempt: null, notes: null }));
  await writeUpdateMemo(file, { attempt: { version: '0.13.8', at: 123 }, notes: saved });
  const memo = await readUpdateMemo(file);
  check('Merkdatei: lesen und schreiben', memo.attempt?.version === '0.13.8' && memo.attempt.at === 123 && memo.notes?.notes[0] === saved.notes[0]);
  check('Merkdatei: alte Version noch da → Versuch bleibt', settleUpdateMemo(memo, '0.13.7') === memo);
  const settled = settleUpdateMemo(memo, '0.13.8');
  check('Merkdatei: neue Version läuft → Versuch erledigt, Hinweise bleiben', settled.attempt === null && settled.notes === memo.notes);
  check('Merkdatei: Unsinn wird verworfen', JSON.stringify(parseUpdateMemo({ attempt: { version: '../x', at: 'gestern' }, notes: { version: 3 } })) === JSON.stringify({ attempt: null, notes: null }));
  await writeUpdateMemo(file, { attempt: null, notes: null });
  check('Merkdatei: leer → Datei gelöscht', JSON.stringify(await readUpdateMemo(file)) === JSON.stringify({ attempt: null, notes: null }));

  const now = Date.now();
  const alive = () => true;
  const dead = () => false;
  check('Spiel: kein Marker → läuft nicht', !previousGameRunning(null, now, alive));
  check('Spiel: Marker und Prozess lebt → läuft', previousGameRunning({ pid: 4242, startedAt: now - 60_000 }, now, alive));
  check('Spiel: Prozess weg → läuft nicht', !previousGameRunning({ pid: 4242, startedAt: now - 60_000 }, now, dead));
  check('Spiel: Marker älter als 24 h → zählt nicht', !previousGameRunning({ pid: 4242, startedAt: now - GAME_MARKER_MAX_MS - 1 }, now, alive));
  check('Spiel: Marker prüfen', parseGameMarker({ pid: 12, startedAt: 5 })?.pid === 12 && parseGameMarker({ pid: -1, startedAt: 5 }) === null && parseGameMarker('x') === null);
  check('Spiel: eigener Prozess lebt, unbekannte PID nicht', processAlive(process.pid) && !processAlive(2 ** 30 + 7));
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

    const macLike = new Updater({ baseUrl: url, currentVersion: '0.11.0', dir, publicKey: pem, log: () => undefined, downloadInstaller: false });
    state = await macLike.check();
    check('Mac: neue Version nur melden, nichts laden', state.phase === 'available' && state.version === '0.12.0' && macLike.installerPath() === null, state.phase);

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

    // ---------- Update beim Start ----------
    startupDecisions();
    await startupMemory(dir);
    current = make('0.12.0');
    const startDir = await mkdtemp(path.join(os.tmpdir(), 'heldix-update-start-'));
    try {
      const fresh = (options: { downloadInstaller?: boolean } = {}) => new Updater({ baseUrl: url, currentVersion: '0.11.0', dir: startDir, publicKey: pem, log: () => undefined, ...options });
      behavior.downloads = 0;
      const first = fresh();
      state = await first.check({ timeoutMs: STARTUP_CHECK_TIMEOUT_MS, download: false });
      check('Start: Prüfung ohne Laden → available, nichts geladen', state.phase === 'available' && state.version === '0.12.0' && behavior.downloads === 0 && first.installerPath() === null, state.phase);
      const progress: number[] = [];
      first.onState = (s: UpdateState) => {
        if (s.phase === 'downloading') progress.push(s.progress ?? 0);
      };
      state = await first.download();
      check('Start: danach laden und prüfen → ready (mit Fortschritt)', state.phase === 'ready' && behavior.downloads === 1 && progress.length > 0 && first.found()?.version === '0.12.0', `${state.phase} ${behavior.downloads}`);
      check('Start: geprüfter Installer liegt im Update-Ordner', first.installerPath() === path.join(startDir, 'HeldixClient-Setup-0.12.0.exe'));

      const second = fresh();
      state = await second.check({ download: false });
      state = await second.download();
      check('Start: geprüfter Installer wird wiederverwendet (kein zweiter Download)', state.phase === 'ready' && behavior.downloads === 1, `${state.phase} ${behavior.downloads}`);
      state = await second.check();
      check('Start: bereit bleibt bereit (keine neue Prüfung)', state.phase === 'ready');

      const tampered = Buffer.from(await readFile(path.join(startDir, 'HeldixClient-Setup-0.12.0.exe')));
      tampered[10] ^= 1;
      await writeFile(path.join(startDir, 'HeldixClient-Setup-0.12.0.exe'), tampered);
      const third = fresh();
      await third.check({ download: false });
      state = await third.download();
      check('Start: veränderter Installer im Ordner wird nicht genommen, sondern neu geladen', state.phase === 'ready' && behavior.downloads === 2, `${state.phase} ${behavior.downloads}`);

      behavior.latestDelayMs = 2000;
      const started = Date.now();
      state = await fresh().check({ timeoutMs: 300, download: false });
      const took = Date.now() - started;
      behavior.latestDelayMs = 0;
      check('Start: Zeitgrenze – Server antwortet nicht rechtzeitig → Fehler nach ~0,3 s', state.phase === 'error' && took < 1500, `${state.phase} nach ${took} ms`);
      check('Start: … freundliche Meldung (nur Einstellungen und Log)', /nicht erreichbar/.test(state.error ?? ''), state.error);
      check('Start: … und der Launcher startet normal', decideStartupUpdate({ platform: 'win32', autoUpdate: true, state, gameRunning: false, attempt: null, now: Date.now() }).action === 'start');
      const offline = new Updater({ baseUrl: 'http://127.0.0.1:9', currentVersion: '0.11.0', dir: startDir, publicKey: pem, log: () => undefined });
      state = await offline.check({ timeoutMs: STARTUP_CHECK_TIMEOUT_MS, download: false });
      check('Start: offline → Fehler, normal starten', state.phase === 'error' && decideStartupUpdate({ platform: 'win32', autoUpdate: true, state, gameRunning: false, attempt: null, now: Date.now() }).action === 'start', state.error);

      const notice = fresh({ downloadInstaller: false });
      await notice.check();
      behavior.latestStatus = 500;
      state = await notice.check();
      behavior.latestStatus = 200;
      check('Hinweis „Update verfügbar“ bleibt, wenn die nächste Prüfung scheitert', state.phase === 'available' && state.version === '0.12.0', state.phase);

      state = await fresh().check({ download: false });
      check('Einstellung aus: nur melden (available), Laden erst mit „Jetzt installieren“', state.phase === 'available' && behavior.downloads === 2, `${state.phase} ${behavior.downloads}`);
      const none = new Updater({ baseUrl: '', currentVersion: '0.11.0', dir: startDir, publicKey: pem, log: () => undefined });
      check('Entwicklung ohne HELDIX_UPDATE_URL: aus', !none.enabled() && none.state.phase === 'disabled' && (await none.check()).phase === 'disabled');
    } finally {
      await rm(startDir, { recursive: true, force: true });
    }

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
  console.log(failures === 0 ? `Updater: alle ${passed} Prüfungen bestanden` : `Updater: ${failures} Fehler (${passed} bestanden)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
