// Updates und Downloads des Launchers: Installer (Windows), Mac-Dateien und update.json liegen im Update-Ordner,
// der Dienst liefert sie aus (das GitHub-Repository ist privat).
// Hochladen geht per scp (Betreiber) oder im Team-Bereich (Admin). Der Launcher prüft die Signatur selbst; beim
// Veröffentlichen im Team-Bereich prüft sie zusätzlich der Dienst mit dem öffentlichen Update-Schlüssel.
import { createHash, randomBytes, verify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline, Transform } from 'node:stream';
import { pipeline as pipelineAsync } from 'node:stream/promises';
import { HttpError } from './http';

/** Windows-Installer, z. B. `HeldixClient-Setup-0.12.0.exe` oder `HeldixClient-Setup-1.0.0-beta.2.exe` (steht im Manifest). */
export const SETUP_FILE_RE = /^HeldixClient-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.exe$/;
const WINDOWS_FILE_RE = /^HeldixClient-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\.exe$/;
/** Mac-Dateien, z. B. `HeldixClient-0.12.1-mac-arm64.dmg` oder `HeldixClient-0.12.1-mac-x64.zip`. */
export const MAC_FILE_RE = /^HeldixClient-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-mac-(arm64|x64)\.(dmg|zip)$/;

export type DownloadKind = 'exe' | 'dmg' | 'zip';

export interface DownloadName {
  platform: 'windows' | 'mac';
  arch: 'x64' | 'arm64';
  kind: DownloadKind;
  version: string;
}

/** Datei im Update-Ordner mit dem, was ihr Name verrät. */
export interface DownloadFile extends DownloadName {
  file: string;
  size: number;
  uploadedAt: number;
}

/** Ziele für `/v1/launcher/download/latest/<ziel>`. */
export const DOWNLOAD_TARGETS = ['windows', 'mac-arm64', 'mac-x64'] as const;
export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];

const CONTENT_TYPES: Record<DownloadKind, string> = {
  exe: 'application/vnd.microsoft.portable-executable',
  dmg: 'application/x-apple-diskimage',
  zip: 'application/zip',
};

/** System, Prozessor, Art und Version aus dem Dateinamen; andere Namen gibt es nicht (null). */
export function parseDownloadName(file: string): DownloadName | null {
  const windows = WINDOWS_FILE_RE.exec(file);
  if (windows) return { platform: 'windows', arch: 'x64', kind: 'exe', version: windows[1]! };
  const mac = MAC_FILE_RE.exec(file);
  if (mac) return { platform: 'mac', arch: mac[2] as 'arm64' | 'x64', kind: mac[3] as 'dmg' | 'zip', version: mac[1]! };
  return null;
}

const INVALID_NAME =
  'Ungültiger Dateiname (erwartet: HeldixClient-Setup-<version>.exe oder HeldixClient-<version>-mac-<arm64|x64>.<dmg|zip>).';
export const MANIFEST_FILE = 'update.json';
/** update.json ist ein paar hundert Byte groß; alles über 64 KB ist sicher ein Versehen. */
const MAX_MANIFEST_SIZE = 64 * 1024;

export const NOTHING_PUBLISHED = 'Noch keine Version veröffentlicht.';
const NO_SUCH_FILE = 'Diese Datei gibt es nicht.';
/** Versionen wie im Launcher (core/updater.ts): 1.2.3 oder 1.2.3-beta.1 */
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;
/** Größter Installer (wie im Launcher) und damit größter Upload. */
export const MAX_SETUP_SIZE = 1024 * 1024 * 1024;

/**
 * Vergleicht zwei Versionen genau wie der Launcher: Vorabversionen (1.2.3-beta.1) zählen weniger als die fertige.
 * Ungültige Versionen: wirft.
 */
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

/** Gültige Version wie im Launcher (1.2.3 oder 1.2.3-beta.1)? */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_RE.test(value);
}

/** Hash einer Datei, gestreamt (große Dateien blockieren den Dienst nicht). */
export async function hashFile(file: string, algorithm: 'sha256' | 'sha512', encoding: 'hex' | 'base64'): Promise<string> {
  const hash = createHash(algorithm);
  await pipelineAsync(fs.createReadStream(file), hash);
  return hash.digest(encoding);
}

/**
 * Echter Pfad von `file` direkt in `dir`, oder `null`, wenn die Datei fehlt oder (über einen symbolischen Link)
 * außerhalb des Ordners liegt. Den Namen prüft der Aufrufer vorher (keine Pfadtrenner, festes Muster).
 */
export async function resolveInDir(dir: string, file: string): Promise<string | null> {
  try {
    const realDir = await fs.promises.realpath(dir);
    const real = await fs.promises.realpath(path.join(realDir, file));
    return path.dirname(real) === realDir ? real : null;
  } catch {
    return null;
  }
}

export interface SendFileOptions {
  /** Dateiname für `Content-Disposition` */
  name: string;
  contentType: string;
  cacheControl: string;
  /** Kommt so lange nichts beim Client an, wird die Verbindung getrennt. */
  idleTimeoutMs: number;
  /** Nach einem vollständig gesendeten GET der ganzen Datei (200, kein HEAD, kein Teilbereich). */
  onComplete?: () => void;
  /** `inline` für Bilder, die der Browser anzeigen soll (Standard: `attachment`, also Download). */
  disposition?: 'attachment' | 'inline';
}

/**
 * Liefert eine Datei aus (`GET`/`HEAD`), auf Wunsch einen Teil (`Range`, `If-Range`), mit `ETag` und `Last-Modified`.
 * Die Datei wird gestreamt; ein langsamer Client bremst das Lesen (kein Puffern im Speicher).
 */
export async function sendFile(req: IncomingMessage, res: ServerResponse, real: string, options: SendFileOptions): Promise<void> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(real, 'r');
  } catch {
    throw new HttpError(404, NO_SUCH_FILE);
  }
  let streaming = false;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new HttpError(404, NO_SUCH_FILE);
    const size = info.size;
    const etag = `"${size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const lastModified = info.mtime.toUTCString();
    let range = parseRange(req.headers.range, size);
    // Fortsetzen nur, wenn die Datei noch dieselbe ist; sonst die ganze neue Datei.
    const ifRange = req.headers['if-range'];
    if (range !== null && ifRange !== undefined && ifRange !== etag && ifRange !== lastModified) range = null;
    if (range === 'unsatisfiable') {
      throw new HttpError(416, 'Dieser Bereich liegt außerhalb der Datei.', {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes',
      });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const length = size === 0 ? 0 : end - start + 1;
    const headers: Record<string, string> = {
      'Content-Type': options.contentType,
      'Content-Length': String(length),
      'Content-Disposition': `${options.disposition ?? 'attachment'}; filename="${options.name}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': options.cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
      'Last-Modified': lastModified,
    };
    if (range !== null) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(range !== null ? 206 : 200, headers);
    if (req.method === 'HEAD' || length === 0) {
      res.end();
      return;
    }
    res.setTimeout(options.idleTimeoutMs, () => res.destroy());
    const stream = handle.createReadStream({ start, end, autoClose: true });
    streaming = true;
    const whole = range === null && req.method === 'GET';
    pipeline(stream, res, (err) => {
      // Abbruch durch den Client oder Lesefehler: pipeline schließt Datei und Verbindung.
      if (!err && whole) options.onComplete?.();
    });
  } finally {
    if (!streaming) await handle.close().catch(() => {});
  }
}

/** 413 für einen zu großen Upload (die Verbindung wird danach geschlossen). */
export function uploadTooLarge(maxBytes: number): HttpError {
  return new HttpError(413, `Die Datei ist zu groß (höchstens ${Math.round(maxBytes / 1024 / 1024)} MB).`, { Connection: 'close' });
}

/** Wirft 413, wenn `Content-Length` schon mehr als `maxBytes` ankündigt (bevor etwas gelesen wird). */
export function checkUploadLength(req: IncomingMessage, maxBytes: number): void {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw uploadTooLarge(maxBytes);
}

/**
 * Speichert den Anfragekörper gestreamt als `<file>.part` in `dir` und benennt ihn erst am Ende um (wer liest, sieht
 * nie eine halbe Datei). Höchstens `maxBytes` (sonst 413); kommt `idleTimeoutMs` lang nichts an, wird abgebrochen
 * (400). SHA-256 und SHA-512 werden beim Empfang mitgerechnet. Den Namen prüft der Aufrufer vorher.
 */
export async function receiveFile(
  req: IncomingMessage,
  dir: string,
  file: string,
  maxBytes: number,
  idleTimeoutMs: number,
): Promise<{ size: number; sha256: string; sha512: string; mtimeMs: number }> {
  let part: string | undefined;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const realDir = await fs.promises.realpath(dir);
    part = path.join(realDir, `${file}.part`);
    // Reste eines abgebrochenen Uploads weg; 'wx' folgt keinem symbolischen Link.
    await fs.promises.rm(part, { force: true });
    const hash512 = createHash('sha512');
    const hash256 = createHash('sha256');
    let size = 0;
    let idle: NodeJS.Timeout | undefined;
    const resetIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => req.destroy(new Error('Zeitüberschreitung beim Upload')), idleTimeoutMs);
      idle.unref();
    };
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        resetIdle();
        size += chunk.length;
        if (size > maxBytes) return callback(uploadTooLarge(maxBytes));
        hash512.update(chunk);
        hash256.update(chunk);
        callback(null, chunk);
      },
    });
    resetIdle();
    try {
      await pipelineAsync(req, meter, fs.createWriteStream(part, { flags: 'wx', mode: 0o644 }));
    } finally {
      if (idle) clearTimeout(idle);
    }
    const target = path.join(realDir, file);
    await fs.promises.rename(part, target);
    part = undefined;
    const info = await fs.promises.stat(target);
    return { size, sha256: hash256.digest('hex'), sha512: hash512.digest('base64'), mtimeMs: info.mtimeMs };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Der Upload wurde abgebrochen. Bitte noch einmal versuchen.', { Connection: 'close' });
  } finally {
    if (part !== undefined) await fs.promises.rm(part, { force: true }).catch(() => {});
  }
}

function sha512File(file: string): Promise<string> {
  return hashFile(file, 'sha512', 'base64');
}

/** Inhalt einer gültigen update.json. `manifest` bleibt genau der Text aus der Datei (darüber läuft die Signatur). */
export interface Published {
  manifest: string;
  signature: string;
  version: string;
  file: string;
  size: number;
}

/** Prüft den Inhalt von update.json. Liefert das Ergebnis oder einen Fehlertext fürs Log. */
export function parseUpdateJson(text: string): Published | string {
  let outer: unknown;
  try {
    // Ein BOM am Anfang (manche Editoren) stört JSON.parse.
    outer = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return 'kein gültiges JSON';
  }
  return checkUpdateObject(outer);
}

/** Prüft die Form von `{ manifest, signature }` (ohne Signatur). Liefert das Ergebnis oder einen Fehlertext. */
export function checkUpdateObject(outer: unknown): Published | string {
  if (typeof outer !== 'object' || outer === null || Array.isArray(outer)) return 'kein JSON-Objekt';
  const { manifest, signature } = outer as Record<string, unknown>;
  if (typeof manifest !== 'string' || manifest === '') return '„manifest“ fehlt oder ist kein Text';
  if (typeof signature !== 'string' || signature === '') return '„signature“ fehlt oder ist kein Text';
  let inner: unknown;
  try {
    inner = JSON.parse(manifest);
  } catch {
    return '„manifest“ ist kein gültiges JSON';
  }
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return '„manifest“ ist kein JSON-Objekt';
  const { v, version, file, size } = inner as Record<string, unknown>;
  if (v !== 1) return '„v“ im Manifest ist nicht 1';
  if (typeof version !== 'string' || version === '') return '„version“ im Manifest fehlt';
  if (typeof file !== 'string' || !SETUP_FILE_RE.test(file)) return '„file“ im Manifest fehlt oder heißt nicht HeldixClient-Setup-<version>.exe';
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return '„size“ im Manifest fehlt oder ist keine ganze Zahl';
  return { manifest, signature, version, file, size };
}

/**
 * Liest einen `Range`-Header für eine Datei mit `size` Byte. Unterstützt genau einen Bereich
 * (`bytes=a-b`, `bytes=a-`, `bytes=-n`). `null`: ganze Datei schicken (kein, ungültiger oder
 * mehrfacher Bereich); `'unsatisfiable'`: Bereich liegt außerhalb (416).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    // Die letzten n Byte
    const count = Number(last);
    if (count === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - count), end: size - 1 };
  }
  const start = Number(first);
  // Ende vor dem Anfang: syntaktisch ungültig, also ignorieren (RFC 9110).
  if (last !== '' && Number(last) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
}

interface ManifestCache {
  /** Änderungszeit, Größe und Inode von update.json beim Lesen */
  key: string;
  value: Published | null;
  /** Schon ins Log geschrieben, dass die Datei fehlt bzw. dass die Version veröffentlicht ist */
  warned: boolean;
  announced: boolean;
}

export class Updates {
  private cache?: ManifestCache;

  /**
   * `onPublished`: für jede neu veröffentlichte Version – beim Neueinlesen einer hochgeladenen update.json (sobald der
   * Installer vollständig da ist) und nach dem Veröffentlichen im Team-Bereich. Kann für dieselbe Version mehrfach
   * kommen; der Versionsverlauf merkt sich jede Version nur einmal.
   */
  constructor(
    private readonly dir: string,
    private readonly log: (line: string) => void,
    private readonly onPublished: (published: Published) => void = () => {},
  ) {}

  /** Installer, die gerade hochgeladen werden (je Datei nur ein Upload gleichzeitig). */
  private readonly uploading = new Set<string>();
  /** SHA-256 pro Datei, gültig solange Größe und Änderungszeit gleich sind. */
  private readonly sha256Cache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  private readonly sha256Pending = new Map<string, Promise<string>>();
  private publishing = false;

  /**
   * Inhalt von update.json, wenn die Form stimmt (ohne Prüfung, ob der Installer schon da ist), sonst `null`.
   * Ändert sich die Datei (Änderungszeit, Größe oder Inode), liest der Dienst sie neu.
   */
  private async manifestCache(): Promise<ManifestCache | null> {
    let info: fs.Stats;
    try {
      info = await fs.promises.stat(path.join(this.dir, MANIFEST_FILE));
    } catch {
      this.cache = undefined;
      return null;
    }
    const key = `${info.mtimeMs}:${info.size}:${info.ino}`;
    if (this.cache?.key !== key) {
      this.cache = { key, value: await this.load(info), warned: false, announced: false };
    }
    return this.cache;
  }

  /** update.json, wenn ihre Form stimmt – auch wenn der Installer noch fehlt. */
  async published(): Promise<Published | null> {
    return (await this.manifestCache())?.value ?? null;
  }

  /**
   * Die veröffentlichte Version aus update.json oder `null`. Gilt erst, wenn der Installer dazu vollständig im Ordner
   * liegt (Größe wie im Manifest).
   */
  async latest(): Promise<Published | null> {
    const cache = await this.manifestCache();
    const published = cache?.value ?? null;
    if (!cache || !published) return null;
    const size = await this.sizeOf(published.file);
    if (size !== published.size) {
      if (!cache.warned) {
        cache.warned = true;
        this.log(
          size === null
            ? `update.json nennt ${published.file}, die Datei fehlt aber im Update-Ordner. Bis sie da ist, gilt: ${NOTHING_PUBLISHED}`
            : `${published.file} ist ${size} Byte groß, update.json nennt ${published.size} (Upload noch nicht fertig?). Bis dahin gilt: ${NOTHING_PUBLISHED}`,
        );
      }
      return null;
    }
    if (!cache.announced) {
      cache.announced = true;
      this.log(`Launcher-Version ${published.version} ist veröffentlicht (${published.file}).`);
      this.onPublished(published);
    }
    return published;
  }

  /**
   * `GET`/`HEAD /v1/launcher/download/<file>`: liefert einen Installer aus dem Update-Ordner, auf Wunsch einen Teil
   * (`Range`). Die Datei wird gestreamt; ein langsamer Client bremst das Lesen (kein Puffern im Speicher).
   * Kommt `idleTimeoutMs` lang nichts beim Client an, wird die Verbindung getrennt.
   */
  async serve(req: IncomingMessage, res: ServerResponse, file: string, idleTimeoutMs: number): Promise<void> {
    const real = await this.resolve(file);
    if (real === null) throw new HttpError(404, NO_SUCH_FILE);
    await sendFile(req, res, real, {
      name: file,
      contentType: CONTENT_TYPES[parseDownloadName(file)!.kind],
      cacheControl: 'no-cache',
      idleTimeoutMs,
    });
  }

  // ---------- Team-Bereich (Admin) ----------

  /** Alle Dateien im Update-Ordner (Windows und Mac), zuletzt hochgeladene zuerst. */
  async files(): Promise<DownloadFile[]> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch {
      return [];
    }
    const files: DownloadFile[] = [];
    for (const name of names) {
      const parsed = parseDownloadName(name);
      const real = parsed === null ? null : await this.resolve(name);
      if (parsed === null || real === null) continue;
      try {
        const info = await fs.promises.stat(real);
        if (info.isFile()) files.push({ file: name, ...parsed, size: info.size, uploadedAt: Math.floor(info.mtimeMs) });
      } catch {
        // gerade gelöscht
      }
    }
    return files.sort((a, b) => b.uploadedAt - a.uploadedAt || (a.file < b.file ? -1 : 1));
  }

  /** Höchste Version unter den Dateien eines Systems, Prozessors und einer Art. */
  private newest(files: DownloadFile[], platform: 'windows' | 'mac', arch: 'x64' | 'arm64', kind: DownloadKind): DownloadFile | null {
    let best: DownloadFile | null = null;
    for (const f of files) {
      if (f.platform !== platform || f.arch !== arch || f.kind !== kind) continue;
      if (best === null || compareVersions(f.version, best.version) > 0) best = f;
    }
    return best;
  }

  /**
   * Datei für `/v1/launcher/download/latest/<ziel>`: Windows = Installer aus dem Manifest (wenn vollständig da),
   * Mac = höchste Version unter den vorhandenen `.dmg` dieses Prozessors. Nichts da: null.
   */
  async latestFor(target: DownloadTarget): Promise<string | null> {
    if (target === 'windows') return (await this.latest())?.file ?? null;
    const arch = target === 'mac-arm64' ? 'arm64' : 'x64';
    return this.newest(await this.files(), 'mac', arch, 'dmg')?.file ?? null;
  }

  /** SHA-256 (hex) einer Datei; einmal berechnet und zwischengespeichert, solange Größe und Änderungszeit gleich sind. */
  private async sha256(file: string, real: string, size: number, mtimeMs: number): Promise<string> {
    const cached = this.sha256Cache.get(file);
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.sha256;
    const key = `${file}:${size}:${mtimeMs}`;
    let pending = this.sha256Pending.get(key);
    if (!pending) {
      pending = hashFile(real, 'sha256', 'hex').finally(() => this.sha256Pending.delete(key));
      this.sha256Pending.set(key, pending);
    }
    const sha256 = await pending;
    this.sha256Cache.set(file, { size, mtimeMs, sha256 });
    return sha256;
  }

  /**
   * `GET /v1/launcher/files`: die neueste Datei je System, Prozessor und Art mit SHA-256 – Windows (der veröffentlichte
   * Installer aus dem Manifest), Mac Apple Silicon (dmg, zip), Mac Intel (dmg, zip).
   */
  async publicFiles() {
    const all = await this.files();
    const published = await this.latest();
    // Einträge für Dateien, die es nicht mehr gibt, aus dem Zwischenspeicher nehmen.
    for (const name of this.sha256Cache.keys()) if (!all.some((f) => f.file === name)) this.sha256Cache.delete(name);
    const chosen = [
      published ? (all.find((f) => f.file === published.file) ?? null) : null,
      this.newest(all, 'mac', 'arm64', 'dmg'),
      this.newest(all, 'mac', 'arm64', 'zip'),
      this.newest(all, 'mac', 'x64', 'dmg'),
      this.newest(all, 'mac', 'x64', 'zip'),
    ].filter((f): f is DownloadFile => f !== null);
    const files = [];
    for (const f of chosen) {
      const real = await this.resolve(f.file);
      const info = real === null ? null : await fs.promises.stat(real).catch(() => null);
      if (real === null || !info) continue;
      files.push({
        file: f.file,
        platform: f.platform,
        arch: f.arch,
        kind: f.kind,
        version: f.version,
        size: info.size,
        sha256: await this.sha256(f.file, real, info.size, info.mtimeMs),
        uploadedAt: Math.floor(info.mtimeMs),
      });
    }
    return { version: published?.version ?? null, files };
  }

  /**
   * `PUT /v1/team/updates/files/<file>`: speichert den Anfragekörper gestreamt als `<file>.part` und benennt ihn erst
   * am Ende um. Höchstens `maxBytes`; kommt `idleTimeoutMs` lang nichts an, wird abgebrochen.
   */
  async receive(req: IncomingMessage, file: string, maxBytes: number, idleTimeoutMs: number): Promise<{ file: string; size: number; sha512: string }> {
    if (parseDownloadName(file) === null) throw new HttpError(400, INVALID_NAME);
    checkUploadLength(req, maxBytes);
    if ((await this.published())?.file === file) {
      throw new HttpError(409, 'Das ist der Installer der veröffentlichten Version. Er lässt sich nicht ersetzen.');
    }
    if (this.uploading.has(file)) throw new HttpError(409, 'Diese Datei wird gerade schon hochgeladen.');
    this.uploading.add(file);
    try {
      const received = await receiveFile(req, this.dir, file, maxBytes, idleTimeoutMs);
      // SHA-256 für /v1/launcher/files gleich mitgerechnet: Die Liste muss die Datei nicht noch einmal lesen.
      this.sha256Cache.set(file, { size: received.size, mtimeMs: received.mtimeMs, sha256: received.sha256 });
      return { file, size: received.size, sha512: received.sha512 };
    } finally {
      this.uploading.delete(file);
    }
  }

  /**
   * `PUT /v1/team/updates/manifest`: prüft Signatur (Ed25519, öffentlicher Update-Schlüssel), Inhalt, Datei
   * (Größe und SHA-512) und dass die Version höher ist, und ersetzt dann update.json atomar.
   */
  async publish(input: unknown, publicKey: KeyObject): Promise<{ manifest: Record<string, unknown>; version: string; file: string }> {
    const checked = checkUpdateObject(input);
    if (typeof checked === 'string') throw new HttpError(400, `Ungültige update.json: ${checked}.`);
    let signed = false;
    try {
      signed = verify(null, Buffer.from(checked.manifest, 'utf8'), publicKey, Buffer.from(checked.signature, 'base64'));
    } catch {
      signed = false;
    }
    if (!signed) throw new HttpError(400, 'Die Signatur passt nicht zum Update-Schlüssel dieses Servers. Das Update wird nicht veröffentlicht.');
    const manifest = JSON.parse(checked.manifest) as Record<string, unknown>;
    // Dieselben Regeln wie im Launcher, damit nichts veröffentlicht wird, was der Launcher ablehnt.
    if (!VERSION_RE.test(checked.version)) throw new HttpError(400, 'Ungültige Version im Manifest.');
    if (checked.file !== `HeldixClient-Setup-${checked.version}.exe`) {
      throw new HttpError(400, 'Der Dateiname im Manifest passt nicht zur Version (HeldixClient-Setup-<version>.exe).');
    }
    if (checked.size <= 0 || checked.size > MAX_SETUP_SIZE) throw new HttpError(400, 'Ungültige Größe im Manifest.');
    const sha512 = manifest.sha512;
    if (typeof sha512 !== 'string' || Buffer.from(sha512, 'base64').length !== 64) throw new HttpError(400, 'Ungültige Prüfsumme (sha512) im Manifest.');

    if (this.publishing) throw new HttpError(409, 'Gerade wird schon eine Version veröffentlicht.');
    this.publishing = true;
    try {
      const current = await this.published();
      if (current) {
        let newer = true;
        try {
          newer = compareVersions(checked.version, current.version) > 0;
        } catch {
          // Die bisherige update.json hat keine gültige Version: Die neue darf sie ersetzen.
        }
        if (!newer) {
          throw new HttpError(409, `Die Version ${checked.version} ist nicht höher als die veröffentlichte (${current.version}).`);
        }
      }
      const real = await this.resolve(checked.file);
      const info = real === null ? null : await fs.promises.stat(real).catch(() => null);
      if (real === null || !info || !info.isFile()) {
        throw new HttpError(409, `${checked.file} liegt nicht im Update-Ordner. Bitte zuerst hochladen.`);
      }
      if (info.size !== checked.size) {
        throw new HttpError(409, `${checked.file} ist ${info.size} Byte groß, das Manifest nennt ${checked.size}.`);
      }
      if ((await sha512File(real)) !== sha512) {
        throw new HttpError(409, `Die Prüfsumme (SHA-512) von ${checked.file} passt nicht zum Manifest.`);
      }
      // Atomar: erst eine neue Datei schreiben, dann umbenennen. Wer gerade liest, sieht die alte oder die neue.
      const dir = await fs.promises.realpath(this.dir);
      const tmp = path.join(dir, `.${MANIFEST_FILE}.${randomBytes(6).toString('hex')}.tmp`);
      try {
        const handle = await fs.promises.open(tmp, 'wx', 0o644);
        try {
          await handle.writeFile(JSON.stringify({ manifest: checked.manifest, signature: checked.signature }));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.promises.rename(tmp, path.join(dir, MANIFEST_FILE));
      } catch (err) {
        await fs.promises.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
      this.cache = undefined;
      this.onPublished(checked);
      return { manifest, version: checked.version, file: checked.file };
    } finally {
      this.publishing = false;
    }
  }

  /** `DELETE /v1/team/updates/files/<file>`: löscht einen Installer, aber nie den veröffentlichten (409). */
  async deleteFile(file: string): Promise<void> {
    if (parseDownloadName(file) === null) throw new HttpError(404, NO_SUCH_FILE);
    if ((await this.published())?.file === file) {
      throw new HttpError(409, 'Das ist der Installer der veröffentlichten Version. Er lässt sich nicht löschen.');
    }
    if ((await this.resolve(file)) === null) throw new HttpError(404, NO_SUCH_FILE);
    // Den Eintrag im Ordner löschen (bei einem Link den Link, nie sein Ziel).
    await fs.promises.unlink(path.join(await fs.promises.realpath(this.dir), file)).catch(() => {
      throw new HttpError(404, NO_SUCH_FILE);
    });
  }

  private async load(info: fs.Stats): Promise<Published | null> {
    const invalid = (reason: string) => {
      this.log(`update.json im Update-Ordner ist ungültig (${reason}). Bis zur Korrektur gilt: ${NOTHING_PUBLISHED}`);
      return null;
    };
    if (!info.isFile()) return invalid('keine Datei');
    if (info.size > MAX_MANIFEST_SIZE) return invalid(`größer als ${MAX_MANIFEST_SIZE / 1024} KB`);
    let text: string;
    try {
      text = await fs.promises.readFile(path.join(this.dir, MANIFEST_FILE), 'utf8');
    } catch (err) {
      return invalid(`nicht lesbar: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
    }
    const result = parseUpdateJson(text);
    return typeof result === 'string' ? invalid(result) : result;
  }

  /**
   * Echter Pfad einer Installer-Datei im Update-Ordner, oder `null`, wenn der Name nicht passt, die Datei fehlt
   * oder sie (über einen symbolischen Link) außerhalb des Ordners liegt.
   */
  private async resolve(file: string): Promise<string | null> {
    if (parseDownloadName(file) === null) return null;
    return resolveInDir(this.dir, file);
  }

  private async sizeOf(file: string): Promise<number | null> {
    const real = await this.resolve(file);
    if (real === null) return null;
    try {
      const info = await fs.promises.stat(real);
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  }
}
