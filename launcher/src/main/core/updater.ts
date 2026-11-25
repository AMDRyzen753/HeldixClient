// Automatische Updates des Launchers über die Schnittstelle des Heldix-Dienstes.
//
// Ablauf: GET <Dienst>/v1/launcher/latest liefert { manifest, signature }. Das Manifest ist mit dem privaten
// Update-Schlüssel des Entwicklers signiert (npm run release); die App enthält nur den öffentlichen Schlüssel
// (update-public-key.ts) und nimmt nur Manifeste mit gültiger Signatur und höherer Version an. Danach lädt sie
// den Installer von <Dienst>/v1/launcher/download/<Datei>, prüft Größe und SHA-512 und startet ihn auf Wunsch
// still (/S). Ein übernommener Server kann so keine fremde .exe unterschieben und keine alte Version zurückspielen.

import { spawn } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/** Inhalt des signierten Manifests (Version 1) */
export interface UpdateManifest {
  v: 1;
  version: string;
  file: string;
  size: number;
  sha512: string;
  date: string;
  notes: string[];
}

export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  /** installierte Version */
  current: string;
  /** neue Version (ab downloading) */
  version?: string;
  notes?: string[];
  date?: string;
  /** 0–1 beim Herunterladen */
  progress?: number;
  error?: string;
  /** Zeitpunkt der letzten Prüfung (ms) */
  checkedAt?: number;
}

export interface UpdaterOptions {
  /** Adresse des Heldix-Dienstes, z. B. https://api.heldixclient.com (leer = keine Updates) */
  baseUrl: string;
  currentVersion: string;
  /** Ordner für heruntergeladene Installer */
  dir: string;
  /** öffentlicher Update-Schlüssel (PEM); null = dieser Build nimmt keine Updates an */
  publicKey: string | null;
  log?: (line: string) => void;
  /** false = neue Version nur melden (Phase "available"), z. B. auf dem Mac, wo der Windows-Installer nicht passt */
  downloadInstaller?: boolean;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;
const FILE_RE = /^HeldixClient-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.exe$/;
const MAX_SIZE = 1024 * 1024 * 1024;
/** nach dem Start, dann alle sechs Stunden */
const FIRST_CHECK_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Vergleicht zwei Versionen (1.2.3 bzw. 1.2.3-beta.1); Vorabversionen zählen weniger als die fertige */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (!pa || !pb) throw new Error(`Ungültige Version: ${!pa ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  const preA = pa[4];
  const preB = pb[4];
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}

/**
 * Prüft Signatur und Inhalt eines Manifests. Wirft mit einer verständlichen Meldung, wenn etwas nicht stimmt.
 */
export function verifyManifest(manifest: string, signature: string, publicKey: string): UpdateManifest {
  const key = createPublicKey(publicKey);
  const ok = verify(null, Buffer.from(manifest, 'utf8'), key, Buffer.from(signature, 'base64'));
  if (!ok) throw new Error('Die Signatur des Updates stimmt nicht. Das Update wird nicht installiert.');
  let data: unknown;
  try {
    data = JSON.parse(manifest);
  } catch {
    throw new Error('Das Update-Manifest ist kein gültiges JSON.');
  }
  const m = data as Partial<UpdateManifest>;
  if (m.v !== 1) throw new Error('Unbekanntes Format des Updates. Bitte den Launcher von der Webseite neu laden.');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) throw new Error('Ungültige Version im Update.');
  if (m.file !== `HeldixClient-Setup-${m.version}.exe` || !FILE_RE.test(m.file)) throw new Error('Ungültiger Dateiname im Update.');
  if (typeof m.size !== 'number' || !Number.isInteger(m.size) || m.size <= 0 || m.size > MAX_SIZE) throw new Error('Ungültige Größe im Update.');
  if (typeof m.sha512 !== 'string' || Buffer.from(m.sha512, 'base64').length !== 64) throw new Error('Ungültige Prüfsumme im Update.');
  const notes = Array.isArray(m.notes) ? m.notes.filter((n): n is string => typeof n === 'string').slice(0, 30) : [];
  return { v: 1, version: m.version, file: m.file, size: m.size, sha512: m.sha512, date: typeof m.date === 'string' ? m.date : '', notes };
}

/** SHA-512 einer Datei (Base64) */
async function sha512File(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

export class Updater {
  state: UpdateState;
  onState: (state: UpdateState) => void = () => {};
  private manifest: UpdateManifest | null = null;
  private running: Promise<UpdateState> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: UpdaterOptions) {
    this.state = { phase: this.enabled() ? 'idle' : 'disabled', current: options.currentVersion };
  }

  /** Updates möglich? (Adresse und öffentlicher Schlüssel im Build) */
  enabled(): boolean {
    return this.options.baseUrl.trim() !== '' && this.options.publicKey !== null;
  }

  private log(line: string): void {
    (this.options.log ?? console.log)(`[Update] ${line}`);
  }

  private set(next: Partial<UpdateState>): void {
    this.state = { ...this.state, ...next };
    this.onState(this.state);
  }

  /** Regelmäßig prüfen und im Hintergrund laden; {@code auto} = false: nur auf Knopfdruck */
  start(auto: () => boolean): void {
    if (!this.enabled() || this.timer) return;
    const tick = () => {
      if (auto()) this.check().catch(() => undefined);
    };
    setTimeout(tick, FIRST_CHECK_MS).unref();
    this.timer = setInterval(tick, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  /** Nach einem Update fragen und es gleich laden. Mehrfache Aufrufe teilen sich eine Prüfung. */
  check(): Promise<UpdateState> {
    if (!this.enabled()) return Promise.resolve(this.state);
    if (this.state.phase === 'ready' || this.state.phase === 'available') return Promise.resolve(this.state);
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private base(): string {
    return this.options.baseUrl.replace(/\/+$/, '');
  }

  private async run(): Promise<UpdateState> {
    this.set({ phase: 'checking', error: undefined });
    try {
      const response = await fetch(`${this.base()}/v1/launcher/latest`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      if (response.status === 404) {
        this.set({ phase: 'current', checkedAt: Date.now() });
        return this.state;
      }
      if (!response.ok) throw new Error(`Update-Server antwortet mit ${response.status}`);
      const body = (await response.json()) as { manifest?: unknown; signature?: unknown };
      if (typeof body.manifest !== 'string' || typeof body.signature !== 'string') throw new Error('Antwort des Update-Servers ist unvollständig.');
      const manifest = verifyManifest(body.manifest, body.signature, this.options.publicKey!);
      if (compareVersions(manifest.version, this.options.currentVersion) <= 0) {
        this.set({ phase: 'current', checkedAt: Date.now() });
        return this.state;
      }
      this.log(`Neue Version ${manifest.version} gefunden`);
      this.manifest = manifest;
      if (this.options.downloadInstaller === false) {
        this.set({ phase: 'available', version: manifest.version, notes: manifest.notes, date: manifest.date, checkedAt: Date.now() });
        return this.state;
      }
      this.set({ phase: 'downloading', version: manifest.version, notes: manifest.notes, date: manifest.date, progress: 0, checkedAt: Date.now() });
      await this.download(manifest);
      this.set({ phase: 'ready', progress: 1 });
      this.log(`Version ${manifest.version} geladen und geprüft`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Fehler: ${message}`);
      this.set({ phase: 'error', error: friendly(message), checkedAt: Date.now() });
    }
    return this.state;
  }

  /** Pfad des geprüften Installers (nur im Zustand ready) */
  installerPath(): string | null {
    return this.state.phase === 'ready' && this.manifest ? path.join(this.options.dir, this.manifest.file) : null;
  }

  private async download(manifest: UpdateManifest): Promise<void> {
    const dir = this.options.dir;
    await mkdir(dir, { recursive: true });
    // alte Installer aufräumen
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (name !== manifest.file) await rm(path.join(dir, name), { force: true }).catch(() => undefined);
    }
    const target = path.join(dir, manifest.file);
    // schon vollständig da (z. B. vor dem letzten Neustart geladen)?
    if (existsSync(target)) {
      const info = await stat(target);
      if (info.size === manifest.size && (await sha512File(target)) === manifest.sha512) return;
      await rm(target, { force: true });
    }
    const part = `${target}.part`;
    const response = await fetch(`${this.base()}/v1/launcher/download/${encodeURIComponent(manifest.file)}`, {
      signal: AbortSignal.timeout(60 * 60 * 1000),
    });
    if (!response.ok || !response.body) throw new Error(`Download fehlgeschlagen (${response.status})`);
    const hash = createHash('sha512');
    let received = 0;
    let lastReport = 0;
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.length;
        if (received > manifest.size) {
          callback(new Error('Die Datei ist größer als angekündigt.'));
          return;
        }
        hash.update(chunk);
        const now = Date.now();
        if (now - lastReport > 250) {
          lastReport = now;
          this.set({ progress: received / manifest.size });
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as WebReadableStream), counter, createWriteStream(part));
      if (received !== manifest.size) throw new Error('Download unvollständig.');
      if (hash.digest('base64') !== manifest.sha512) throw new Error('Prüfsumme des Downloads stimmt nicht.');
      await rename(part, target);
    } catch (error) {
      await rm(part, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Startet den geprüften Installer still. {@code restart} = Launcher danach wieder öffnen.
   * Der Aufrufer beendet danach die App. false = kein Update bereit.
   */
  async install(restart: boolean): Promise<boolean> {
    const installer = this.installerPath();
    if (!installer || !this.manifest || process.platform !== 'win32') return false;
    // unmittelbar vor dem Start noch einmal prüfen (die Datei lag eine Weile im Datenordner)
    if ((await sha512File(installer)) !== this.manifest.sha512) {
      await rm(installer, { force: true });
      this.set({ phase: 'error', error: 'Der geladene Installer wurde verändert und ist gelöscht. Bitte erneut suchen.' });
      return false;
    }
    const args = ['/S', '--updated'];
    if (restart) args.push('--force-run');
    this.log(`Starte Installer ${path.basename(installer)} ${args.join(' ')}`);
    spawn(installer, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
}

/** Technische Meldungen für die Anzeige übersetzen */
function friendly(message: string): string {
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|aborted/i.test(message)) return 'Update-Server nicht erreichbar. Später erneut versuchen.';
  return message;
}
