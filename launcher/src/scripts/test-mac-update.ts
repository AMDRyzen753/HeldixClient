// Mac-Teil von npm run test:update (aufgerufen aus scripts/test-update.ts): Manifest Version 2, Datei je Prozessor,
// Pfad der App, wann sie sich nicht selbst ersetzt, Info.plist, das Austausch-Skript (unter Windows mit Git-Bash
// wirklich ausgeführt: Austausch und Zurücklegen), Installieren mit nachgebauten Befehlen, das Release-Skript mit einem
// Test-Schlüssel und der Updater gegen den Test-Server. Nichts davon braucht einen Mac oder den echten Update-Schlüssel.

import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAC_APP_NAME,
  installMacUpdate,
  macAppBundle,
  macArch,
  macBlockText,
  macFileName,
  macInstallScript,
  macRelease,
  macSelfUpdateBlock,
  parseMacInstallResult,
  plistVersion,
  shellQuote,
  verifyMacManifest,
  type MacInstallDeps,
} from '../main/core/mac-update';
import { Updater } from '../main/core/updater';
import { decideStartupUpdate, startupPlan, type StartupInput } from '../main/core/startup-update';
import { findMacArtifacts, readReleaseNotes, signMacManifest, writeMacUpdate } from './release-common';

type Check = (label: string, ok: boolean, detail?: string) => void;

const sha = (data: Buffer) => createHash('sha512').update(data).digest('base64');

function macManifestText(version: string, files: Record<string, { file: string; size: number; sha512: string }>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 2, platform: 'mac', version, date: '2026-11-28', notes: ['Mac: Updates von selbst'], files, ...extra });
}

function signed(text: string, key: KeyObject): { manifest: string; signature: string } {
  return { manifest: text, signature: sign(null, Buffer.from(text), key).toString('base64') };
}

async function expectThrow(check: Check, label: string, task: () => unknown | Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await task();
    check(label, false, 'kein Fehler');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, pattern.test(message), message);
  }
}

/** Git-Bash (Windows) bzw. bash (Mac/Linux) zum Ausführen des Skripts; null = keine passende bash (z. B. nur WSL) */
function findBash(): string | null {
  const candidates = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'bash'] : ['/bin/bash', 'bash'];
  for (const candidate of candidates) {
    if (candidate.includes('\\') && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['-c', 'uname -s'], { encoding: 'utf8' });
    if (result.status !== 0) continue;
    const name = result.stdout.trim();
    if (process.platform === 'win32' ? /^(MINGW|MSYS|CYGWIN)/.test(name) : /^(Darwin|Linux)/.test(name)) return candidate;
  }
  return null;
}

/** Pfad für bash (Git-Bash versteht C:/… mit Schrägstrichen) */
const bashPath = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);

async function fakeApp(dir: string, version: string, marker: string): Promise<string> {
  const app = path.join(dir, MAC_APP_NAME);
  await mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  await writeFile(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n  <key>CFBundleName</key><string>HeldixClient</string>\n  <key>CFBundleShortVersionString</key>\n  <string>${version}</string>\n</dict></plist>\n`);
  await writeFile(path.join(app, 'Contents', 'MacOS', 'HeldixClient'), marker);
  return app;
}

export async function macUpdateTests(check: Check, base: { serve: (route: string, body: () => { status: number; json?: unknown; data?: Buffer }) => void; url: string }): Promise<void> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const other = generateKeyPairSync('ed25519').privateKey;
  const zipArm = Buffer.from('ZIP für Apple Silicon '.repeat(3000));
  const zipIntel = Buffer.from('ZIP für Intel '.repeat(2000));
  const files = (version: string) => ({
    arm64: { file: macFileName(version, 'arm64'), size: zipArm.length, sha512: sha(zipArm) },
    x64: { file: macFileName(version, 'x64'), size: zipIntel.length, sha512: sha(zipIntel) },
  });

  // ---------- Manifest ----------
  const good = signed(macManifestText('0.14.0', files('0.14.0')), privateKey);
  const parsed = verifyMacManifest(good.manifest, good.signature, pem);
  check('Mac-Manifest: gültig, Version und beide Dateien', parsed.version === '0.14.0' && !!parsed.files.arm64 && !!parsed.files.x64 && parsed.notes[0] === 'Mac: Updates von selbst');
  await expectThrow(check, 'Mac-Manifest: fremde Signatur wird abgelehnt', () => {
    const bad = signed(macManifestText('0.14.0', files('0.14.0')), other);
    verifyMacManifest(bad.manifest, bad.signature, pem);
  }, /Signatur/);
  await expectThrow(check, 'Mac-Manifest: Windows-Manifest (v 1) passt nicht', () => {
    const win = signed(JSON.stringify({ v: 1, version: '0.14.0', file: 'HeldixClient-Setup-0.14.0.exe', size: 1, sha512: sha(zipArm), date: '', notes: [] }), privateKey);
    verifyMacManifest(win.manifest, win.signature, pem);
  }, /Format/);
  await expectThrow(check, 'Mac-Manifest: falscher Dateiname (andere Version) wird abgelehnt', () => {
    const f = files('0.14.0');
    const bad = signed(macManifestText('0.14.1', { arm64: f.arm64 }), privateKey);
    verifyMacManifest(bad.manifest, bad.signature, pem);
  }, /Dateiname/);
  await expectThrow(check, 'Mac-Manifest: .app.zip.sh o. Ä. wird abgelehnt', () => {
    const bad = signed(macManifestText('0.14.0', { x64: { ...files('0.14.0').x64, file: 'HeldixClient-0.14.0-mac-x64.zip.sh' } }), privateKey);
    verifyMacManifest(bad.manifest, bad.signature, pem);
  }, /Dateiname/);
  await expectThrow(check, 'Mac-Manifest: ohne Dateien wird abgelehnt', () => {
    const bad = signed(macManifestText('0.14.0', {}), privateKey);
    verifyMacManifest(bad.manifest, bad.signature, pem);
  }, /keine Mac-Datei/);
  await expectThrow(check, 'Mac-Manifest: kaputte Prüfsumme wird abgelehnt', () => {
    const bad = signed(macManifestText('0.14.0', { arm64: { ...files('0.14.0').arm64, sha512: 'abc' } }), privateKey);
    verifyMacManifest(bad.manifest, bad.signature, pem);
  }, /Prüfsumme/);
  check('Prozessor: arm64 und x64, sonst keiner', macArch('arm64') === 'arm64' && macArch('x64') === 'x64' && macArch('ia32') === null);
  check('Datei für Apple Silicon', macRelease(parsed, 'arm64')?.file === 'HeldixClient-0.14.0-mac-arm64.zip' && macRelease(parsed, 'arm64')?.size === zipArm.length);
  check('Datei für Intel', macRelease(parsed, 'x64')?.file === 'HeldixClient-0.14.0-mac-x64.zip');
  check('kein passender Prozessor → keine Datei', macRelease({ ...parsed, files: { arm64: parsed.files.arm64 } }, 'x64') === null && macRelease(parsed, null) === null);

  // ---------- Pfad und Entscheidung ----------
  check('App-Pfad aus process.execPath', macAppBundle('/Applications/HeldixClient.app/Contents/MacOS/HeldixClient') === '/Applications/HeldixClient.app');
  check('App-Pfad mit Leerzeichen', macAppBundle('/Users/a b/Applications/Heldix Client.app/Contents/MacOS/HeldixClient') === '/Users/a b/Applications/Heldix Client.app');
  check('App-Pfad: Helfer-App im Paket zählt zur äußeren App nicht doppelt', macAppBundle('/Applications/HeldixClient.app/Contents/Frameworks/HeldixClient Helper.app/Contents/MacOS/HeldixClient Helper') === '/Applications/HeldixClient.app/Contents/Frameworks/HeldixClient Helper.app');
  check('App-Pfad: kein App-Paket (Windows, Linux) → null', macAppBundle('C:\\Program Files\\HeldixClient\\HeldixClient.exe') === null && macAppBundle('/opt/heldix/heldixclient') === null);
  const block = (patch: Partial<Parameters<typeof macSelfUpdateBlock>[0]>) => macSelfUpdateBlock({ packaged: true, appPath: '/Applications/HeldixClient.app', writable: true, ...patch });
  check('Selbst-Update: Programme, beschreibbar → erlaubt', block({}) === null);
  check('Selbst-Update: ~/Applications → erlaubt', block({ appPath: '/Users/jan/Applications/HeldixClient.app' }) === null);
  check('Selbst-Update: aus dem DMG (/Volumes/…) → nein', block({ appPath: '/Volumes/HeldixClient 0.14.0/HeldixClient.app', writable: false }) === 'volume');
  check('Selbst-Update: App Translocation → nein', block({ appPath: '/private/var/folders/xy/T/AppTranslocation/1234-ABCD/d/HeldixClient.app', writable: false }) === 'translocated');
  check('Selbst-Update: nicht beschreibbar → nein', block({ writable: false }) === 'readonly');
  check('Selbst-Update: Entwicklung → nein', block({ packaged: false }) === 'dev');
  check('Selbst-Update: letzter Austausch abgelehnt → nein', block({ lastFailed: true }) === 'failed');
  check('Hinweis aus dem DMG nennt „Programme“', /Programme/.test(macBlockText('volume')) && /Programme/.test(macBlockText('translocated')) && /heldixclient\.com/.test(macBlockText('readonly')));

  const now = 1_800_000_000_000;
  const input: StartupInput = { platform: 'darwin', selfUpdate: true, autoUpdate: true, state: { phase: 'available', version: '0.14.0' }, gameRunning: false, attempt: null, now };
  const decide = (patch: Partial<StartupInput>) => JSON.stringify(decideStartupUpdate({ ...input, ...patch }));
  check('Mac mit Selbst-Update: Plan Startfenster', startupPlan({ enabled: true, platform: 'darwin', selfUpdate: true, autoUpdate: true }) === 'splash');
  check('Mac ohne Selbst-Update (DMG …): nur Hinweis', startupPlan({ enabled: true, platform: 'darwin', selfUpdate: false, autoUpdate: true }) === 'background');
  check('Unsichtbarer Start (Autostart): kein Startfenster', startupPlan({ enabled: true, platform: 'win32', autoUpdate: true, hidden: true }) === 'background');
  check('Mac mit Selbst-Update: neue Version → installieren', decide({}) === JSON.stringify({ action: 'install' }));
  check('Mac mit Selbst-Update: Spiel läuft → später', decide({ gameRunning: true }) === JSON.stringify({ action: 'start', reason: 'game' }));
  check('Mac mit Selbst-Update: Einstellung aus → Hinweis „Jetzt installieren“', decide({ autoUpdate: false }) === JSON.stringify({ action: 'notify', reason: 'install' }));
  check('Mac ohne Selbst-Update → Hinweis mit Download', decide({ selfUpdate: false }) === JSON.stringify({ action: 'notify', reason: 'download' }));
  check('Mac: derselbe Versuch eben → später', decide({ attempt: { version: '0.14.0', at: now - 60_000 } }) === JSON.stringify({ action: 'start', reason: 'retry-later' }));

  // ---------- Info.plist und Ergebnisdatei ----------
  check('Info.plist: Version lesen', plistVersion('<dict><key>CFBundleVersion</key><string>9</string><key>CFBundleShortVersionString</key>\n\t<string>0.14.0</string></dict>') === '0.14.0');
  check('Info.plist: ohne Version → null', plistVersion('<dict><key>CFBundleVersion</key><string>9</string></dict>') === null);
  check('Ergebnis: ok', JSON.stringify(parseMacInstallResult('ok 0.14.0\n')) === JSON.stringify({ ok: true, version: '0.14.0', reason: null }));
  check('Ergebnis: fail mit Grund', JSON.stringify(parseMacInstallResult('fail 0.14.0 alt')) === JSON.stringify({ ok: false, version: '0.14.0', reason: 'alt' }));
  check('Ergebnis: Unsinn → null', parseMacInstallResult('rm -rf /') === null && parseMacInstallResult('') === null);

  // ---------- Skript ----------
  check('Quoting: einfache Anführungszeichen im Pfad', shellQuote("/Users/o'neil/HeldixClient.app") === `'/Users/o'\\''neil/HeldixClient.app'`);
  const script = macInstallScript({
    pid: 4242, appPath: '/Applications/HeldixClient.app', newAppPath: '/tmp/x/neu/HeldixClient.app', workDir: '/tmp/x', version: '0.14.0',
    logFile: '/Users/a b/Library/x.log', resultFile: '/Users/a b/r.txt', restart: true,
  });
  const at = (text: string) => script.indexOf(text);
  check('Skript: wartet auf die PID des Launchers', /PID=4242/.test(script) && at('kill -0 "$PID"') > 0);
  check('Skript: Reihenfolge alt → .alt, neu an den Platz, Quarantäne weg, open, alte löschen',
    at('mv "$APP" "$OLD"') > 0 && at('mv "$APP" "$OLD"') < at('mv "$NEW" "$APP"') && at('mv "$NEW" "$APP"') < at('xattr -dr com.apple.quarantine "$APP"')
      && at('xattr -dr') < at('open "$APP" --args --updated') && at('open "$APP" --args --updated') < at('if [ "$ok" = 1 ]; then rm -rf "$OLD"; fi'));
  check('Skript: bei Fehler alte App zurück und trotzdem neu starten', at('mv "$OLD" "$APP"') > 0 && /else open "\$APP"; fi/.test(script));
  check('Skript: OLD ist „…app.alt“, Pfade mit Leerzeichen sicher in Anführungszeichen', /OLD="\$APP\.alt"/.test(script) && script.includes(`LOG='/Users/a b/Library/x.log'`));
  check('Skript: ohne Neustart (beim Beenden) kein open', !/^RESTART=1/m.test(macInstallScript({ pid: 1, appPath: '/A.app', newAppPath: '/B.app', workDir: '/w', version: '0.14.0', logFile: '/l', resultFile: '/r', restart: false })));

  const bash = findBash();
  if (!bash) {
    console.log('HINWEIS Skript nicht ausgeführt (keine passende bash gefunden)');
  } else {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'heldix-mac-skript-'));
    try {
      // Erfolg: alte App wird ersetzt, .alt verschwindet, Ergebnis „ok“
      const apps = path.join(sandbox, 'Programme');
      await mkdir(apps);
      const oldApp = await fakeApp(apps, '0.13.9', 'alt');
      const work = path.join(sandbox, 'arbeit');
      const newApp = await fakeApp(path.join(work, 'neu'), '0.14.0', 'neu');
      const result = path.join(sandbox, 'ergebnis.txt');
      const text = macInstallScript({
        pid: 999_999, appPath: bashPath(oldApp), newAppPath: bashPath(newApp), workDir: bashPath(work), version: '0.14.0',
        logFile: bashPath(path.join(sandbox, 'update.log')), resultFile: bashPath(result), restart: false, waitSeconds: 1,
      });
      const file = path.join(sandbox, 'install.sh');
      await writeFile(file, text);
      const run = spawnSync(bash, [bashPath(file)], { encoding: 'utf8' });
      const marker = await readFile(path.join(oldApp, 'Contents', 'MacOS', 'HeldixClient'), 'utf8').catch(() => '');
      check('Skript ausgeführt: neue App liegt an der alten Stelle', run.status === 0 && marker === 'neu', `${run.status} ${marker} ${run.stderr}`);
      check('Skript ausgeführt: „….app.alt“ und Arbeitsordner sind weg', !existsSync(`${oldApp}.alt`) && !existsSync(work));
      check('Skript ausgeführt: Ergebnis ok', parseMacInstallResult(await readFile(result, 'utf8').catch(() => ''))?.ok === true);
      const log = await readFile(path.join(sandbox, 'update.log'), 'utf8').catch(() => '');
      check('Skript ausgeführt: Protokoll geschrieben', /Update auf 0\.14\.0/.test(log) && /liegt jetzt unter/.test(log));

      // Fehler: neue App fehlt → alte kommt zurück, Ergebnis „fail … neu“
      const work2 = path.join(sandbox, 'arbeit2');
      await mkdir(work2);
      const text2 = macInstallScript({
        pid: 999_999, appPath: bashPath(oldApp), newAppPath: bashPath(path.join(work2, 'fehlt', MAC_APP_NAME)), workDir: bashPath(work2), version: '0.14.1',
        logFile: bashPath(path.join(sandbox, 'update.log')), resultFile: bashPath(result), restart: false, waitSeconds: 1,
      });
      await writeFile(file, text2);
      spawnSync(bash, [bashPath(file)], { encoding: 'utf8' });
      const after = await readFile(path.join(oldApp, 'Contents', 'MacOS', 'HeldixClient'), 'utf8').catch(() => '');
      const failed = parseMacInstallResult(await readFile(result, 'utf8').catch(() => ''));
      check('Skript ausgeführt: Fehler → alte App wieder an ihrem Platz', after === 'neu' && !existsSync(`${oldApp}.alt`), after);
      check('Skript ausgeführt: Fehler → Ergebnis „fail 0.14.1 neu“', failed?.ok === false && failed.version === '0.14.1' && failed.reason === 'neu', JSON.stringify(failed));
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }

  // ---------- Installieren mit nachgebauten Befehlen ----------
  const box = await mkdtemp(path.join(os.tmpdir(), 'heldix-mac-install-'));
  try {
    const zip = path.join(box, macFileName('0.14.0', 'arm64'));
    await writeFile(zip, zipArm);
    const calls: { command: string; args: string[] }[] = [];
    const deps = (appVersion: string | null, binary = false): MacInstallDeps => ({
      tmpdir: box,
      run: async (command, args) => {
        calls.push({ command, args });
        if (command.endsWith('ditto')) {
          if (appVersion) {
            const app = await fakeApp(args[3], appVersion, 'neu');
            if (binary) await writeFile(path.join(app, 'Contents', 'Info.plist'), 'bplist00…');
          } else await mkdir(args[3], { recursive: true });
          return { code: 0, stdout: '', stderr: '' };
        }
        if (command.endsWith('plutil')) return { code: 0, stdout: `${appVersion}\n`, stderr: '' };
        return { code: 1, stdout: '', stderr: 'unbekannt' };
      },
      spawnDetached: async (command, args) => {
        calls.push({ command, args });
        return true;
      },
    });
    const options = { zip, release: { version: '0.14.0', sha512: sha(zipArm) }, appPath: '/Applications/HeldixClient.app', restart: true, pid: 77, logFile: path.join(box, 'l.log'), resultFile: path.join(box, 'r.txt') };
    await installMacUpdate(options, deps('0.14.0'));
    const spawned = calls.find((c) => c.command === '/bin/bash');
    const ditto = calls.find((c) => c.command.endsWith('ditto'));
    check('Installieren: ditto -x -k entpackt in einen Temp-Ordner', !!ditto && ditto.args[0] === '-x' && ditto.args[1] === '-k' && ditto.args[2] === zip && ditto.args[3].startsWith(box));
    const scriptText = spawned ? await readFile(spawned.args[0], 'utf8').catch(() => '') : '';
    check('Installieren: Skript gestartet, mit PID, App-Pfad und Neustart', !!spawned && /PID=77/.test(scriptText) && scriptText.includes(`APP='/Applications/HeldixClient.app'`) && /RESTART=1/.test(scriptText));
    await rm(path.dirname(spawned?.args[0] ?? path.join(box, 'x', 'y')), { recursive: true, force: true });
    calls.length = 0;
    await installMacUpdate(options, deps('0.14.0', true));
    check('Installieren: binäre Info.plist über plutil', calls.some((c) => c.command.endsWith('plutil')) && calls.some((c) => c.command === '/bin/bash'));
    for (const dir of await readdir(box)) if (dir.startsWith('heldixclient-update-')) await rm(path.join(box, dir), { recursive: true, force: true });
    await expectThrow(check, 'Installieren: falsche Version in der App → abgelehnt', () => installMacUpdate(options, deps('0.13.9')), /Version 0\.13\.9 statt 0\.14\.0/);
    await expectThrow(check, 'Installieren: ohne HeldixClient.app → abgelehnt', () => installMacUpdate(options, deps(null)), /fehlt HeldixClient\.app/);
    await expectThrow(check, 'Installieren: veränderte ZIP → abgelehnt', () => installMacUpdate({ ...options, release: { ...options.release, sha512: sha(zipIntel) } }, deps('0.14.0')), /verändert/);
    check('Installieren: nach Fehlern kein Temp-Ordner übrig', !(await readdir(box)).some((name) => name.startsWith('heldixclient-update-')));
  } finally {
    await rm(box, { recursive: true, force: true });
  }

  // ---------- Release-Skript (mit Test-Schlüssel, nur im Temp-Ordner) ----------
  const artifact = await mkdtemp(path.join(os.tmpdir(), 'heldix-mac-artefakt-'));
  try {
    const nested = path.join(artifact, 'HeldixClient-macOS');
    await mkdir(nested);
    await writeFile(path.join(nested, macFileName('0.14.0', 'arm64')), zipArm);
    await writeFile(path.join(nested, macFileName('0.14.0', 'x64')), zipIntel);
    await writeFile(path.join(nested, macFileName('0.14.0', 'arm64', 'dmg')), 'dmg');
    let found = await findMacArtifacts(artifact, '0.14.0');
    check('Release: ZIPs im Unterordner gefunden, DMG x64 fehlt nur als Hinweis', found.errors.length === 0 && found.zips.length === 2 && found.dmgs.length === 1 && found.warnings.some((w) => /x64\.dmg/.test(w)), JSON.stringify(found.errors));
    const notes = await readReleaseNotes(artifact, ['--note=Erste Zeile', '--note=Zweite Zeile']);
    const signedRelease = await signMacManifest({ version: '0.14.0', date: '2026-11-28', notes, zips: found.zips, privateKey });
    const back = verifyMacManifest(signedRelease.text, signedRelease.signature, pem);
    check('Release: Manifest signiert und vom Launcher angenommen', back.files.arm64?.sha512 === sha(zipArm) && back.files.x64?.size === zipIntel.length && back.notes.length === 2);
    const out = await writeMacUpdate(path.join(artifact, 'update'), signedRelease);
    const body = JSON.parse(await readFile(out.latest, 'utf8')) as { manifest: string; signature: string };
    check('Release: update-mac.json und Kopie update-mac-0.14.0.json', path.basename(out.copy) === 'update-mac-0.14.0.json' && existsSync(out.copy) && body.manifest === signedRelease.text && typeof body.signature === 'string');
    await writeFile(path.join(nested, macFileName('0.13.9', 'x64')), 'alt');
    found = await findMacArtifacts(artifact, '0.14.0');
    check('Release: Datei einer anderen Version → Fehler', found.errors.some((e) => /0\.13\.9/.test(e)));
    await rm(path.join(nested, macFileName('0.14.0', 'x64')));
    found = await findMacArtifacts(artifact, '0.14.0');
    check('Release: ZIP für Intel fehlt → Fehler', found.errors.some((e) => /mac-x64\.zip fehlt/.test(e)));

    // Hinweise aus release-notes.md: nur aktive Zeilen mit „- “
    await writeFile(path.join(artifact, 'release-notes.md'), '# Kopf\n# ---------- 0.14.0 ----------\n- Neu A\n#- alt\n# - auch alt\n- Neu B\n');
    check('Release: Hinweise ohne auskommentierte Zeilen', JSON.stringify(await readReleaseNotes(artifact, [])) === JSON.stringify(['Neu A', 'Neu B']));
  } finally {
    await rm(artifact, { recursive: true, force: true });
  }

  // ---------- Updater gegen den Test-Server ----------
  let macBody = signed(macManifestText('0.14.0', files('0.14.0')), privateKey);
  base.serve('/v1/launcher/latest/mac', () => ({ status: 200, json: macBody }));
  base.serve(`/v1/launcher/download/${macFileName('0.14.0', 'arm64')}`, () => ({ status: 200, data: zipArm }));
  base.serve(`/v1/launcher/download/${macFileName('0.14.0', 'x64')}`, () => ({ status: 200, data: zipIntel }));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'heldix-mac-updater-'));
  try {
    const installs: { zip: string; version: string; restart: boolean }[] = [];
    const mac = (arch: string, extra: Partial<ConstructorParameters<typeof Updater>[0]> = {}) => new Updater({
      baseUrl: base.url, currentVersion: '0.13.9', dir, publicKey: pem, log: () => undefined, platform: 'mac', arch,
      macInstall: async (zip, release, restart) => {
        installs.push({ zip, version: release.version, restart });
      },
      ...extra,
    });
    let updater = mac('arm64');
    let state = await updater.check();
    check('Updater Mac: ZIP für Apple Silicon geladen und geprüft', state.phase === 'ready' && updater.installerPath()?.endsWith('HeldixClient-0.14.0-mac-arm64.zip') === true, `${state.phase} ${state.error ?? ''}`);
    check('Updater Mac: Installieren übergibt die geprüfte ZIP', (await updater.install(true)) && installs[0]?.version === '0.14.0' && installs[0].restart && installs[0].zip.endsWith('mac-arm64.zip'));
    updater = mac('x64');
    state = await updater.check();
    check('Updater Mac: Intel bekommt die x64-ZIP', state.phase === 'ready' && updater.installerPath()?.endsWith('mac-x64.zip') === true, `${state.phase} ${state.error ?? ''}`);
    const failing = mac('x64', { macInstall: async () => { throw new Error('Die App im Update hat die Version 0.13.0 statt 0.14.0.'); } });
    await failing.check();
    check('Updater Mac: Fehler beim Installieren → false und Meldung', !(await failing.install(false)) && failing.state.phase === 'error' && /0\.13\.0/.test(failing.state.error ?? ''));
    macBody = signed(macManifestText('0.14.0', { x64: files('0.14.0').x64 }), privateKey);
    state = await mac('arm64').check();
    check('Updater Mac: keine Datei für diesen Prozessor → aktuell (kein Fehler)', state.phase === 'current', state.phase);
    macBody = signed(macManifestText('0.14.0', files('0.14.0')), privateKey);
    const manual = mac('arm64', { manualReason: macBlockText('volume') });
    state = await manual.check();
    check('Updater Mac aus dem DMG: nur melden, Grund in state.manual, nichts geladen', state.phase === 'available' && /DMG/.test(state.manual ?? '') && manual.installerPath() === null && !manual.selfInstall(), state.phase);
    check('Updater Mac aus dem DMG: „Laden“ lädt nicht', (await manual.download()).phase === 'available');
    macBody = signed(macManifestText('0.14.0', files('0.14.0')), other);
    state = await mac('arm64').check();
    check('Updater Mac: fremde Signatur → Fehler', state.phase === 'error' && /Signatur/.test(state.error ?? ''), state.error);
    macBody = signed(macManifestText('0.14.0', files('0.14.0')), privateKey);
    state = await new Updater({ baseUrl: base.url, currentVersion: '0.14.0', dir, publicKey: pem, log: () => undefined, platform: 'mac', arch: 'arm64' }).check();
    check('Updater Mac: gleiche Version → aktuell', state.phase === 'current', state.phase);
    state = await new Updater({ baseUrl: base.url, currentVersion: '0.15.0', dir, publicKey: pem, log: () => undefined, platform: 'mac', arch: 'arm64' }).check();
    check('Updater Mac: ältere Version wird nicht angeboten', state.phase === 'current', state.phase);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
