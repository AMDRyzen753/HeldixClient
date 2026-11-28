// Automatische Updates auf dem Mac (ab 0.14.0) – alles, was sich ohne Mac prüfen lässt, als reine Funktionen
// (getestet in scripts/test-update.ts); Prüfen und Laden übernimmt core/updater.ts, der Ablauf steht in main.ts.
//
// Vertrag mit dem Heldix-Dienst: GET /v1/launcher/latest/mac → { manifest, signature } (404 = nichts veröffentlicht).
// manifest ist ein JSON-Text, signiert mit demselben Update-Schlüssel wie unter Windows (npm run release:mac):
//   { "v": 2, "platform": "mac", "version": "0.14.0", "date": "<ISO>", "notes": ["…"],
//     "files": { "arm64": { "file": "HeldixClient-0.14.0-mac-arm64.zip", "size": <Byte>, "sha512": "<base64>" }, "x64": { … } } }
// Die ZIPs kommen wie der Windows-Installer über /v1/launcher/download/<Datei>.
//
// Installieren (installMacUpdate): ZIP noch einmal prüfen, mit `ditto -x -k` in einen Temp-Ordner entpacken, prüfen,
// dass HeldixClient.app darin liegt und Contents/Info.plist die erwartete Version hat, dann ein kleines Bash-Skript
// starten (macInstallScript). Das wartet auf das Ende des Launchers, verschiebt die alte App nach „…app.alt“, legt die
// neue an dieselbe Stelle, entfernt die Quarantäne, startet sie mit `open` neu (--updated) und löscht die alte. Geht
// etwas schief, legt es die alte App zurück und startet trotzdem neu. Das Ergebnis schreibt es in eine kleine Datei
// (parseMacInstallResult), damit der nächste Start ein abgelehntes Ersetzen erkennt und nur noch auf die Webseite zeigt.
//
// Kein Selbst-Update (macSelfUpdateBlock), wenn die App aus dem DMG läuft (/Volumes/…), macOS sie aus einem
// geschützten Ordner startet (App Translocation, nicht in Programme gezogen), der Ort nicht beschreibbar ist oder es
// die Entwicklungsversion ist. Dann bleibt es beim Hinweis mit der Download-Seite. Läuft ein Spiel, wird wie unter
// Windows nicht installiert (startup-update.ts), sondern später.

import { spawn, execFile } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export type MacArch = 'arm64' | 'x64';
export const MAC_ARCHES: readonly MacArch[] = ['arm64', 'x64'];

/** Eine Datei im Mac-Manifest */
export interface MacUpdateFile {
  file: string;
  size: number;
  sha512: string;
}

/** Inhalt des signierten Mac-Manifests (Version 2) */
export interface MacUpdateManifest {
  v: 2;
  platform: 'mac';
  version: string;
  date: string;
  notes: string[];
  files: Partial<Record<MacArch, MacUpdateFile>>;
}

/** Was der Updater für diesen Mac braucht (dieselben Felder wie beim Windows-Installer) */
export interface MacRelease {
  version: string;
  file: string;
  size: number;
  sha512: string;
  date: string;
  notes: string[];
}

/** Name des App-Pakets im ZIP (productName in package.json) */
export const MAC_APP_NAME = 'HeldixClient.app';
const VERSION_PART = '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?)';
const VERSION_RE = new RegExp(`^${VERSION_PART}$`);
/** HeldixClient-<version>-mac-<arch>.zip bzw. .dmg (artifactName in package.json) */
export const MAC_ARTIFACT_RE = new RegExp(`^HeldixClient-${VERSION_PART}-mac-(arm64|x64)\\.(zip|dmg)$`);
const MAX_SIZE = 1024 * 1024 * 1024;

export function macFileName(version: string, arch: MacArch, ext: 'zip' | 'dmg' = 'zip'): string {
  return `HeldixClient-${version}-mac-${arch}.${ext}`;
}

/** process.arch → Schlüssel im Manifest (null = kein Mac-Build für diesen Prozessor) */
export function macArch(arch: string): MacArch | null {
  return arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null;
}

/** Lesbarer Name des Prozessors (für Meldungen) */
export function macArchLabel(arch: MacArch): string {
  return arch === 'arm64' ? 'Apple Silicon' : 'Intel';
}

/**
 * Prüft Signatur und Inhalt eines Mac-Manifests. Wirft mit einer verständlichen Meldung, wenn etwas nicht stimmt.
 */
export function verifyMacManifest(manifest: string, signature: string, publicKey: string): MacUpdateManifest {
  const key = createPublicKey(publicKey);
  const ok = verify(null, Buffer.from(manifest, 'utf8'), key, Buffer.from(signature, 'base64'));
  if (!ok) throw new Error('Die Signatur des Updates stimmt nicht. Das Update wird nicht installiert.');
  let data: unknown;
  try {
    data = JSON.parse(manifest);
  } catch {
    throw new Error('Das Update-Manifest ist kein gültiges JSON.');
  }
  const m = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (m.v !== 2 || m.platform !== 'mac') throw new Error('Unbekanntes Format des Updates. Bitte den Launcher von der Webseite neu laden.');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) throw new Error('Ungültige Version im Update.');
  const version = m.version;
  const rawFiles = m.files && typeof m.files === 'object' ? (m.files as Record<string, unknown>) : {};
  const files: Partial<Record<MacArch, MacUpdateFile>> = {};
  for (const arch of MAC_ARCHES) {
    const raw = rawFiles[arch];
    if (raw === undefined) continue;
    const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (f.file !== macFileName(version, arch)) throw new Error('Ungültiger Dateiname im Update.');
    if (typeof f.size !== 'number' || !Number.isInteger(f.size) || f.size <= 0 || f.size > MAX_SIZE) throw new Error('Ungültige Größe im Update.');
    if (typeof f.sha512 !== 'string' || Buffer.from(f.sha512, 'base64').length !== 64) throw new Error('Ungültige Prüfsumme im Update.');
    files[arch] = { file: f.file, size: f.size, sha512: f.sha512 };
  }
  if (Object.keys(files).length === 0) throw new Error('Das Update enthält keine Mac-Datei.');
  const notes = Array.isArray(m.notes) ? m.notes.filter((n): n is string => typeof n === 'string').slice(0, 30) : [];
  return { v: 2, platform: 'mac', version, date: typeof m.date === 'string' ? m.date : '', notes, files };
}

/** Datei für diesen Prozessor (null = das Update hat keine für ihn) */
export function macRelease(manifest: MacUpdateManifest, arch: MacArch | null): MacRelease | null {
  const file = arch ? manifest.files[arch] : undefined;
  if (!file) return null;
  return { version: manifest.version, file: file.file, size: file.size, sha512: file.sha512, date: manifest.date, notes: manifest.notes };
}

// ---------- Wo läuft die App, und darf sie sich selbst ersetzen? ----------

/** Pfad der App aus process.execPath: /Applications/X.app/Contents/MacOS/X → /Applications/X.app (sonst null) */
export function macAppBundle(execPath: string): string | null {
  const marker = '.app/Contents/MacOS/';
  const index = execPath.lastIndexOf(marker);
  if (index <= 0) return null;
  const bundle = execPath.slice(0, index + '.app'.length);
  return bundle.startsWith('/') ? bundle : null;
}

export type MacSelfUpdateBlock = 'dev' | 'not-bundle' | 'volume' | 'translocated' | 'readonly' | 'failed';

/**
 * Darf sich die App selbst ersetzen? null = ja. Sonst der Grund: Entwicklungsversion, kein App-Paket, läuft aus dem DMG
 * (/Volumes/…), von macOS in einen geschützten Ordner verlegt (App Translocation: nicht in Programme gezogen), Ort nicht
 * beschreibbar, oder das letzte Ersetzen hat macOS abgelehnt (failed).
 */
export function macSelfUpdateBlock(input: { packaged: boolean; appPath: string | null; writable: boolean; lastFailed?: boolean }): MacSelfUpdateBlock | null {
  if (!input.packaged) return 'dev';
  if (!input.appPath) return 'not-bundle';
  if (input.appPath.startsWith('/Volumes/')) return 'volume';
  if (input.appPath.includes('/AppTranslocation/')) return 'translocated';
  if (!input.writable) return 'readonly';
  if (input.lastFailed) return 'failed';
  return null;
}

/** Hinweis für Einstellungen → Updates und den Dialog „Update verfügbar“, wenn sich die App nicht selbst ersetzt */
export function macBlockText(block: MacSelfUpdateBlock): string {
  switch (block) {
    case 'volume':
      return 'HeldixClient läuft direkt aus dem DMG. Zieh die App in den Ordner Programme und starte sie dort – dann aktualisiert sie sich selbst. Bis dahin lädst du neue Versionen über heldixclient.com.';
    case 'translocated':
      return 'macOS startet HeldixClient aus einem geschützten Ordner, weil die App nicht in Programme liegt. Zieh sie in den Ordner Programme und starte sie dort – dann aktualisiert sie sich selbst.';
    case 'readonly':
      return 'HeldixClient darf sich an diesem Ort nicht selbst ersetzen (keine Schreibrechte). Neue Versionen lädst du über heldixclient.com.';
    case 'failed':
      return 'macOS hat das letzte automatische Update nicht erlaubt. Lade die neue Version über heldixclient.com und zieh sie in Programme.';
    case 'dev':
      return 'Die Entwicklungsversion aktualisiert sich nicht selbst. Neue Versionen gibt es auf heldixclient.com.';
    default:
      return 'Diese Version aktualisiert sich nicht selbst. Neue Versionen lädst du über heldixclient.com.';
  }
}

// ---------- Info.plist ----------

/** CFBundleShortVersionString aus einer XML-Info.plist (null = nicht gefunden) */
export function plistVersion(xml: string): string | null {
  const match = /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>\s*([^<]*?)\s*<\/string>/.exec(xml);
  return match ? match[1] : null;
}

// ---------- Skript, das die App austauscht ----------

/** Text in einfache Anführungszeichen für bash (auch mit Leerzeichen und ' im Pfad) */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface MacInstallScriptInput {
  /** PID des Launchers, auf dessen Ende gewartet wird */
  pid: number;
  /** jetzige App (wird ersetzt), z. B. /Applications/HeldixClient.app */
  appPath: string;
  /** entpackte neue App im Temp-Ordner */
  newAppPath: string;
  /** Temp-Ordner (wird am Ende gelöscht) */
  workDir: string;
  version: string;
  /** Protokoll (angehängt) */
  logFile: string;
  /** Ergebnis für den nächsten Start (parseMacInstallResult) */
  resultFile: string;
  /** danach neu starten (false = beim Beenden installieren) */
  restart: boolean;
  /** so lange höchstens warten (Sekunden) */
  waitSeconds?: number;
}

/**
 * Bash-Skript (bash 3.2 von macOS, ohne Erweiterungen), das nach dem Ende des Launchers die App austauscht. Reihenfolge:
 * warten → alte nach „…app.alt“ → neue an ihren Platz → Quarantäne weg → neu starten → alte löschen. Schlägt das
 * Verschieben der neuen fehl, kommt die alte zurück; neu gestartet wird in jedem Fall (mit --updated nur nach Erfolg).
 */
export function macInstallScript(input: MacInstallScriptInput): string {
  const tries = Math.max(1, Math.round((input.waitSeconds ?? 120) * 2));
  return [
    '#!/bin/bash',
    '# HeldixClient-Update für macOS – vom Launcher geschrieben (core/mac-update.ts), läuft nach dessen Ende genau einmal.',
    `PID=${Math.trunc(input.pid)}`,
    `APP=${shellQuote(input.appPath)}`,
    `NEW=${shellQuote(input.newAppPath)}`,
    `WORK=${shellQuote(input.workDir)}`,
    `LOG=${shellQuote(input.logFile)}`,
    `RESULT=${shellQuote(input.resultFile)}`,
    `VERSION=${shellQuote(input.version)}`,
    `RESTART=${input.restart ? 1 : 0}`,
    'OLD="$APP.alt"',
    'exec >>"$LOG" 2>&1',
    'echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] Update auf $VERSION: warte auf das Ende des Launchers (PID $PID)"',
    'n=0',
    'while kill -0 "$PID" 2>/dev/null; do',
    '  n=$((n+1))',
    `  if [ "$n" -gt ${tries} ]; then`,
    '    echo "Der Launcher läuft noch – kein Update"',
    '    echo "fail $VERSION wartet" >"$RESULT"',
    '    rm -rf "$WORK"',
    '    exit 1',
    '  fi',
    '  sleep 0.5',
    'done',
    'ok=0',
    'reason=""',
    'rm -rf "$OLD"',
    'if mv "$APP" "$OLD"; then',
    '  if mv "$NEW" "$APP"; then',
    '    ok=1',
    '  else',
    '    reason="neu"',
    '    echo "Die neue App ließ sich nicht an ihren Platz legen – die alte kommt zurück"',
    '    rm -rf "$APP"',
    '    mv "$OLD" "$APP" || echo "Die alte App ließ sich nicht zurücklegen: $OLD"',
    '  fi',
    'else',
    '  reason="alt"',
    '  echo "Die alte App ließ sich nicht verschieben – kein Update"',
    'fi',
    'if [ "$ok" = 1 ]; then',
    '  xattr -dr com.apple.quarantine "$APP" 2>/dev/null',
    '  touch "$APP"',
    '  echo "ok $VERSION" >"$RESULT"',
    '  echo "HeldixClient $VERSION liegt jetzt unter $APP"',
    'else',
    '  echo "fail $VERSION $reason" >"$RESULT"',
    'fi',
    'if [ "$RESTART" = 1 ]; then',
    '  if [ "$ok" = 1 ]; then open "$APP" --args --updated; else open "$APP"; fi',
    'fi',
    'if [ "$ok" = 1 ]; then rm -rf "$OLD"; fi',
    'rm -rf "$WORK"',
    'exit 0',
    '',
  ].join('\n');
}

export interface MacInstallResult {
  ok: boolean;
  version: string;
  /** warum nicht (alt = alte App nicht verschiebbar, neu = neue nicht, wartet = Launcher lief weiter) */
  reason: string | null;
}

/** Ergebnisdatei des Skripts („ok 0.14.0“ bzw. „fail 0.14.0 alt“) */
export function parseMacInstallResult(text: string): MacInstallResult | null {
  const match = /^(ok|fail)\s+(\S+)(?:\s+(\S+))?\s*$/.exec(text.trim());
  if (!match || !VERSION_RE.test(match[2])) return null;
  return { ok: match[1] === 'ok', version: match[2], reason: match[3] ?? null };
}

// ---------- Installieren ----------

export interface MacCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MacInstallDeps {
  /** Befehl ausführen und warten (ditto, plutil) */
  run(command: string, args: string[]): Promise<MacCommandResult>;
  /** Skript losgelöst starten; true, sobald der Prozess läuft */
  spawnDetached(command: string, args: string[]): Promise<boolean>;
  /** Ordner für den Temp-Ordner (Standard os.tmpdir()) */
  tmpdir?: string;
}

export interface MacInstallOptions {
  /** geladenes, geprüftes ZIP */
  zip: string;
  release: Pick<MacRelease, 'version' | 'sha512'>;
  appPath: string;
  restart: boolean;
  pid: number;
  logFile: string;
  resultFile: string;
  log?: (line: string) => void;
}

async function sha512File(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

/** echte Befehle (nur auf dem Mac sinnvoll) */
export const SYSTEM_MAC_DEPS: MacInstallDeps = {
  run: (command, args) => new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      // Exit-Code steht als Zahl in error.code; ein Text wie ENOENT heißt: Programm fehlt
      const raw = (error as { code?: unknown } | null)?.code;
      const code = !error ? 0 : typeof raw === 'number' ? raw : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (error ? error.message : '') });
    });
  }),
  spawnDetached: (command, args) => new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
    child.once('error', () => resolve(false));
  }),
};

/**
 * Entpackt und prüft die neue App und startet das Skript, das sie nach dem Ende des Launchers einsetzt. Der Aufrufer
 * beendet danach sofort die App. Wirft mit einer verständlichen Meldung, wenn etwas nicht stimmt (dann bleibt alles,
 * wie es ist, und der Temp-Ordner ist weg).
 */
export async function installMacUpdate(options: MacInstallOptions, deps: MacInstallDeps = SYSTEM_MAC_DEPS): Promise<void> {
  const log = options.log ?? (() => undefined);
  if ((await sha512File(options.zip).catch(() => '')) !== options.release.sha512) {
    throw new Error('Das geladene Update wurde verändert. Bitte erneut suchen.');
  }
  const workDir = await mkdtemp(path.join(deps.tmpdir ?? os.tmpdir(), 'heldixclient-update-'));
  try {
    const target = path.join(workDir, 'neu');
    const unpacked = await deps.run('/usr/bin/ditto', ['-x', '-k', options.zip, target]);
    if (unpacked.code !== 0) throw new Error(`Das Update ließ sich nicht entpacken (${unpacked.stderr.trim() || `Code ${unpacked.code}`}).`);
    const newApp = path.join(target, MAC_APP_NAME);
    const plist = path.join(newApp, 'Contents', 'Info.plist');
    if (!(await exists(plist)) || !(await exists(path.join(newApp, 'Contents', 'MacOS')))) {
      throw new Error(`Im Update fehlt ${MAC_APP_NAME}.`);
    }
    let text = await readFile(plist, 'utf8');
    if (text.startsWith('bplist')) {
      // binäre Info.plist: Version über plutil lesen
      const result = await deps.run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
      text = result.code === 0 ? `<key>CFBundleShortVersionString</key><string>${result.stdout.trim()}</string>` : '';
    }
    const found = plistVersion(text);
    if (found !== options.release.version) {
      throw new Error(`Die App im Update hat die Version ${found ?? 'unbekannt'} statt ${options.release.version}.`);
    }
    const script = path.join(workDir, 'install.sh');
    await writeFile(script, macInstallScript({
      pid: options.pid,
      appPath: options.appPath,
      newAppPath: newApp,
      workDir,
      version: options.release.version,
      logFile: options.logFile,
      resultFile: options.resultFile,
      restart: options.restart,
    }), { mode: 0o700 });
    await rm(options.resultFile, { force: true }).catch(() => undefined);
    log(`Starte den Austausch der App (${options.appPath}) auf ${options.release.version}${options.restart ? ' mit Neustart' : ''}`);
    if (!(await deps.spawnDetached('/bin/bash', [script]))) throw new Error('Das Update ließ sich nicht starten. Später erneut versuchen.');
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
