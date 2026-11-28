// Updates und Downloads des Launchers: Installer (Windows), Mac-Dateien, update.json (Windows) und update-mac.json
// (Mac, ab 1.13.0: eine ZIP je Prozessor) liegen im Update-Ordner, der Dienst liefert sie aus (das GitHub-Repository
// ist privat).
// Hochladen geht per scp (Betreiber) oder im Team-Bereich (Admin). Der Launcher prüft die Signatur selbst; beim
// Veröffentlichen im Team-Bereich prüft sie zusätzlich der Dienst mit dem öffentlichen Update-Schlüssel.
import { createHash, randomBytes, verify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline, Transform } from 'node:stream';
import { pipeline as pipelineAsync } from 'node:stream/promises';
import { HttpError } from './http';
import { isInviteCode } from './validate';

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

/**
 * Einladung im Download (ab 1.11.0): `?einladung=<code>` an `/v1/launcher/download/…`. Gültig nur ein Code wie bei den
 * Einladungen (10 Zeichen aus a–z und 2–9 ohne i, l, o, 0, 1), sonst null – dann gilt der Parameter als nicht da.
 */
export function downloadInvite(url: string | undefined): string | null {
  const value = new URL(url ?? '/', 'http://heldix.invalid').searchParams.get('einladung');
  return isInviteCode(value) ? value : null;
}

/**
 * Dateiname für `Content-Disposition`: Der Windows-Installer heißt mit Einladung
 * `HeldixClient-Setup-<version>-einladung-<code>.exe` (der Installer liest den Code aus seinem Namen), alles andere
 * behält seinen Namen.
 */
export function downloadName(file: string, invite: string | null): string {
  const windows = invite === null ? null : WINDOWS_FILE_RE.exec(file);
  return windows ? `HeldixClient-Setup-${windows[1]}-einladung-${invite}.exe` : file;
}

const INVALID_NAME =
  'Ungültiger Dateiname (erwartet: HeldixClient-Setup-<version>.exe oder HeldixClient-<version>-mac-<arm64|x64>.<dmg|zip>).';
export const MANIFEST_FILE = 'update.json';
/** Manifest der Mac-Updates (ab 1.13.0), erzeugt mit `npm run release:mac` im Launcher. */
export const MAC_MANIFEST_FILE = 'update-mac.json';
/** update.json und update-mac.json sind ein paar hundert Byte groß; alles über 64 KB ist sicher ein Versehen. */
const MAX_MANIFEST_SIZE = 64 * 1024;

export const NOTHING_PUBLISHED = 'Noch keine Version veröffentlicht.';
export const NOTHING_PUBLISHED_MAC = 'Noch keine Mac-Version veröffentlicht.';
/** Prozessoren im Mac-Manifest; für jeden muss eine ZIP drinstehen. */
export const MAC_ARCHES = ['arm64', 'x64'] as const;
export type MacArch = (typeof MAC_ARCHES)[number];
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

/** Was jede veröffentlichte Version hat (Windows und Mac), z. B. für den Versionsverlauf. */
export interface PublishedVersion {
  /** genau der Text aus der Datei (darüber läuft die Signatur) */
  manifest: string;
  signature: string;
  version: string;
}

/** Inhalt einer gültigen update.json. `manifest` bleibt genau der Text aus der Datei (darüber läuft die Signatur). */
export interface Published extends PublishedVersion {
  file: string;
  size: number;
}

/** Eine ZIP im Mac-Manifest. */
export interface MacFile {
  file: string;
  size: number;
  /** SHA-512, Base64 */
  sha512: string;
}

/** Inhalt einer gültigen update-mac.json (Manifest Version 2 mit einer ZIP je Prozessor). */
export interface PublishedMac extends PublishedVersion {
  files: Record<MacArch, MacFile>;
}

/** Prüft den Inhalt von update.json. Liefert das Ergebnis oder einen Fehlertext fürs Log. */
export function parseUpdateJson(text: string): Published | string {
  return parseManifestFile(text, checkUpdateObject);
}

/** JSON aus einer Manifest-Datei, dann `check`. Liefert das Ergebnis oder einen Fehlertext fürs Log. */
function parseManifestFile<T>(text: string, check: (outer: unknown) => T | string): T | string {
  let outer: unknown;
  try {
    // Ein BOM am Anfang (manche Editoren) stört JSON.parse.
    outer = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return 'kein gültiges JSON';
  }
  return check(outer);
}

/** `{ manifest, signature }` mit dem Manifest als JSON-Objekt, sonst ein Fehlertext. */
function parseOuter(outer: unknown): { manifest: string; signature: string; inner: Record<string, unknown> } | string {
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
  return { manifest, signature, inner: inner as Record<string, unknown> };
}

/** Prüft die Form von `{ manifest, signature }` (ohne Signatur). Liefert das Ergebnis oder einen Fehlertext. */
export function checkUpdateObject(outer: unknown): Published | string {
  const parsed = parseOuter(outer);
  if (typeof parsed === 'string') return parsed;
  const { manifest, signature, inner } = parsed;
  const { v, version, file, size } = inner;
  if (v !== 1) return '„v“ im Manifest ist nicht 1';
  if (typeof version !== 'string' || version === '') return '„version“ im Manifest fehlt';
  if (typeof file !== 'string' || !SETUP_FILE_RE.test(file)) return '„file“ im Manifest fehlt oder heißt nicht HeldixClient-Setup-<version>.exe';
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return '„size“ im Manifest fehlt oder ist keine ganze Zahl';
  return { manifest, signature, version, file, size };
}

/** Prüft den Inhalt von update-mac.json. Liefert das Ergebnis oder einen Fehlertext fürs Log. */
export function parseMacUpdateJson(text: string): PublishedMac | string {
  return parseManifestFile(text, checkMacUpdateObject);
}

/**
 * Prüft `{ manifest, signature }` einer update-mac.json (ohne Signatur) mit denselben Regeln wie der Launcher
 * (core/mac-update.ts): `v` 2, `platform` „mac“, gültige Version und für arm64 und x64 je eine ZIP
 * `HeldixClient-<version>-mac-<arch>.zip` mit Größe (1 Byte bis 1 GiB) und SHA-512 (Base64, 64 Byte).
 */
export function checkMacUpdateObject(outer: unknown): PublishedMac | string {
  const parsed = parseOuter(outer);
  if (typeof parsed === 'string') return parsed;
  const { manifest, signature, inner } = parsed;
  if (inner.v !== 2) return '„v“ im Manifest ist nicht 2';
  if (inner.platform !== 'mac') return '„platform“ im Manifest ist nicht „mac“';
  const version = inner.version;
  if (!isVersion(version)) return '„version“ im Manifest fehlt oder ist ungültig';
  const raw = inner.files;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '„files“ im Manifest fehlt oder ist kein Objekt';
  const files = {} as Record<MacArch, MacFile>;
  for (const arch of MAC_ARCHES) {
    const entry = (raw as Record<string, unknown>)[arch];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return `„files.${arch}“ im Manifest fehlt (beide ZIPs sind Pflicht)`;
    const { file, size, sha512 } = entry as Record<string, unknown>;
    const expected = `HeldixClient-${version}-mac-${arch}.zip`;
    if (file !== expected) return `„files.${arch}.file“ im Manifest heißt nicht ${expected}`;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_SETUP_SIZE) return `„files.${arch}.size“ im Manifest ist keine gültige Größe`;
    if (typeof sha512 !== 'string' || Buffer.from(sha512, 'base64').length !== 64) return `„files.${arch}.sha512“ im Manifest ist keine gültige Prüfsumme (SHA-512, Base64)`;
    files[arch] = { file: expected, size, sha512 };
  }
  return { manifest, signature, version, files };
}

/**
 * Ist das eine update-mac.json (und keine update.json)? Erkannt am Manifest: `platform` „mac“ oder `v` 2. So nimmt
 * `PUT /v1/team/updates/manifest` beide Dateien an.
 */
export function isMacUpdateObject(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const manifest = (input as Record<string, unknown>).manifest;
  if (typeof manifest !== 'string') return false;
  try {
    const inner = JSON.parse(manifest) as unknown;
    if (typeof inner !== 'object' || inner === null) return false;
    const { platform, v } = inner as Record<string, unknown>;
    return platform === 'mac' || v === 2;
  } catch {
    return false;
  }
}

/** Wirft 400, wenn die Signatur (Ed25519 über den Manifest-Text) nicht zum Update-Schlüssel passt. */
function checkSignature(published: PublishedVersion, publicKey: KeyObject): void {
  let signed = false;
  try {
    signed = verify(null, Buffer.from(published.manifest, 'utf8'), publicKey, Buffer.from(published.signature, 'base64'));
  } catch {
    signed = false;
  }
  if (!signed) throw new HttpError(400, 'Die Signatur passt nicht zum Update-Schlüssel dieses Servers. Das Update wird nicht veröffentlicht.');
}

/** Wirft 409, wenn `version` nicht höher ist als `current`; `label` benennt die bisherige im Fehlertext. */
function checkNewer(version: string, current: string | undefined, label: string): void {
  if (current === undefined) return;
  let newer = true;
  try {
    newer = compareVersions(version, current) > 0;
  } catch {
    // Die bisherige Datei hat keine gültige Version: Die neue darf sie ersetzen.
  }
  if (!newer) throw new HttpError(409, `Die Version ${version} ist nicht höher als ${label} (${current}).`);
}

/** Woran der Dienst eine Manifest-Datei erkennt und was gilt, solange sie fehlt oder ungültig ist. */
interface ManifestKind<T> {
  file: string;
  nothing: string;
  parse: (text: string) => T | string;
}

const WINDOWS_MANIFEST: ManifestKind<Published> = { file: MANIFEST_FILE, nothing: NOTHING_PUBLISHED, parse: parseUpdateJson };
const MAC_MANIFEST: ManifestKind<PublishedMac> = { file: MAC_MANIFEST_FILE, nothing: NOTHING_PUBLISHED_MAC, parse: parseMacUpdateJson };

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

interface ManifestCache<T> {
  /** Änderungszeit, Größe und Inode der Manifest-Datei beim Lesen */
  key: string;
  value: T | null;
  /** Schon ins Log geschrieben, dass eine Datei fehlt bzw. dass die Version veröffentlicht ist */
  warned: boolean;
  announced: boolean;
}

export class Updates {
  private cache?: ManifestCache<Published>;

  /**
   * `onPublished`: für jede neu veröffentlichte Version (Windows und Mac) – beim Neueinlesen einer hochgeladenen
   * update.json bzw. update-mac.json (sobald Installer bzw. beide ZIPs vollständig da sind) und nach dem Veröffentlichen
   * im Team-Bereich. Kann für dieselbe Version mehrfach kommen; der Versionsverlauf merkt sich jede Version nur einmal.
   */
  constructor(
    private readonly dir: string,
    private readonly log: (line: string) => void,
    private readonly onPublished: (published: PublishedVersion) => void = () => {},
  ) {}

  /** Installer, die gerade hochgeladen werden (je Datei nur ein Upload gleichzeitig). */
  private readonly uploading = new Set<string>();
  /** SHA-256 pro Datei, gültig solange Größe und Änderungszeit gleich sind. */
  private readonly sha256Cache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  private readonly sha256Pending = new Map<string, Promise<string>>();
  /** Manifeste, die gerade veröffentlicht werden (update.json, update-mac.json). */
  private readonly publishing = new Set<string>();
  private macCache?: ManifestCache<PublishedMac>;

  /**
   * Inhalt von update.json, wenn die Form stimmt (ohne Prüfung, ob der Installer schon da ist), sonst `null`.
   * Ändert sich die Datei (Änderungszeit, Größe oder Inode), liest der Dienst sie neu.
   */
  private async manifestCache(): Promise<ManifestCache<Published> | null> {
    this.cache = await this.readManifest(WINDOWS_MANIFEST, this.cache);
    return this.cache ?? null;
  }

  /** Dasselbe für update-mac.json. */
  private async macManifestCache(): Promise<ManifestCache<PublishedMac> | null> {
    this.macCache = await this.readManifest(MAC_MANIFEST, this.macCache);
    return this.macCache ?? null;
  }

  /** Liest eine Manifest-Datei neu, wenn sie sich geändert hat; fehlt sie: `undefined`. */
  private async readManifest<T>(kind: ManifestKind<T>, cache: ManifestCache<T> | undefined): Promise<ManifestCache<T> | undefined> {
    let info: fs.Stats;
    try {
      info = await fs.promises.stat(path.join(this.dir, kind.file));
    } catch {
      return undefined;
    }
    const key = `${info.mtimeMs}:${info.size}:${info.ino}`;
    if (cache?.key === key) return cache;
    return { key, value: await this.load(kind, info), warned: false, announced: false };
  }

  /** update.json, wenn ihre Form stimmt – auch wenn der Installer noch fehlt. */
  async published(): Promise<Published | null> {
    return (await this.manifestCache())?.value ?? null;
  }

  /** update-mac.json, wenn ihre Form stimmt – auch wenn die ZIPs noch fehlen. */
  async publishedMac(): Promise<PublishedMac | null> {
    return (await this.macManifestCache())?.value ?? null;
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
   * `GET /v1/launcher/latest/mac`: die veröffentlichte Mac-Version aus update-mac.json oder `null`. Gilt erst, wenn
   * beide ZIPs vollständig im Ordner liegen (Größe wie im Manifest).
   */
  async latestMac(): Promise<PublishedMac | null> {
    const cache = await this.macManifestCache();
    const published = cache?.value ?? null;
    if (!cache || !published) return null;
    for (const arch of MAC_ARCHES) {
      const { file, size: expected } = published.files[arch];
      const size = await this.sizeOf(file);
      if (size === expected) continue;
      if (!cache.warned) {
        cache.warned = true;
        this.log(
          size === null
            ? `${MAC_MANIFEST_FILE} nennt ${file}, die Datei fehlt aber im Update-Ordner. Bis sie da ist, gilt: ${NOTHING_PUBLISHED_MAC}`
            : `${file} ist ${size} Byte groß, ${MAC_MANIFEST_FILE} nennt ${expected} (Upload noch nicht fertig?). Bis dahin gilt: ${NOTHING_PUBLISHED_MAC}`,
        );
      }
      return null;
    }
    if (!cache.announced) {
      cache.announced = true;
      this.log(`Mac-Launcher-Version ${published.version} ist veröffentlicht (${MAC_ARCHES.map((arch) => published.files[arch].file).join(', ')}).`);
      this.onPublished(published);
    }
    return published;
  }

  /** Ist `file` der Installer aus update.json bzw. eine ZIP aus update-mac.json? Dann ist sie geschützt. */
  private async protectedFile(file: string): Promise<'windows' | 'mac' | null> {
    if ((await this.published())?.file === file) return 'windows';
    const mac = await this.publishedMac();
    return mac && MAC_ARCHES.some((arch) => mac.files[arch].file === file) ? 'mac' : null;
  }

  /**
   * `GET`/`HEAD /v1/launcher/download/<file>`: liefert einen Installer aus dem Update-Ordner, auf Wunsch einen Teil
   * (`Range`). Die Datei wird gestreamt; ein langsamer Client bremst das Lesen (kein Puffern im Speicher).
   * Kommt `idleTimeoutMs` lang nichts beim Client an, wird die Verbindung getrennt.
   * Mit `?einladung=<code>` heißt der Windows-Installer im `Content-Disposition` anders (siehe downloadName); Inhalt,
   * Größe, ETag, Caching und Range bleiben gleich.
   */
  async serve(req: IncomingMessage, res: ServerResponse, file: string, idleTimeoutMs: number): Promise<void> {
    const real = await this.resolve(file);
    if (real === null) throw new HttpError(404, NO_SUCH_FILE);
    await sendFile(req, res, real, {
      name: downloadName(file, downloadInvite(req.url)),
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
   * Installer aus dem Manifest), Mac Apple Silicon (dmg, zip), Mac Intel (dmg, zip). Ist update-mac.json veröffentlicht,
   * stehen dort ihre ZIPs, und `mac` ist ihre Version; sonst die höchste Version unter den Mac-Dateien (nach Namen).
   */
  async publicFiles() {
    const all = await this.files();
    const published = await this.latest();
    const mac = await this.latestMac();
    // Einträge für Dateien, die es nicht mehr gibt, aus dem Zwischenspeicher nehmen.
    for (const name of this.sha256Cache.keys()) if (!all.some((f) => f.file === name)) this.sha256Cache.delete(name);
    const zip = (arch: MacArch) => (mac ? (all.find((f) => f.file === mac.files[arch].file) ?? null) : this.newest(all, 'mac', arch, 'zip'));
    const chosen = [
      published ? (all.find((f) => f.file === published.file) ?? null) : null,
      this.newest(all, 'mac', 'arm64', 'dmg'),
      zip('arm64'),
      this.newest(all, 'mac', 'x64', 'dmg'),
      zip('x64'),
    ].filter((f): f is DownloadFile => f !== null);
    let macVersion = mac?.version ?? null;
    if (macVersion === null) {
      for (const f of chosen) if (f.platform === 'mac' && (macVersion === null || compareVersions(f.version, macVersion) > 0)) macVersion = f.version;
    }
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
    return { version: published?.version ?? null, mac: macVersion, files };
  }

  /**
   * `PUT /v1/team/updates/files/<file>`: speichert den Anfragekörper gestreamt als `<file>.part` und benennt ihn erst
   * am Ende um. Höchstens `maxBytes`; kommt `idleTimeoutMs` lang nichts an, wird abgebrochen.
   */
  async receive(req: IncomingMessage, file: string, maxBytes: number, idleTimeoutMs: number): Promise<{ file: string; size: number; sha512: string }> {
    if (parseDownloadName(file) === null) throw new HttpError(400, INVALID_NAME);
    checkUploadLength(req, maxBytes);
    const protectedBy = await this.protectedFile(file);
    if (protectedBy === 'windows') throw new HttpError(409, 'Das ist der Installer der veröffentlichten Version. Er lässt sich nicht ersetzen.');
    if (protectedBy === 'mac') throw new HttpError(409, 'Das ist eine ZIP der veröffentlichten Mac-Version. Sie lässt sich nicht ersetzen.');
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
    checkSignature(checked, publicKey);
    const manifest = JSON.parse(checked.manifest) as Record<string, unknown>;
    // Dieselben Regeln wie im Launcher, damit nichts veröffentlicht wird, was der Launcher ablehnt.
    if (!VERSION_RE.test(checked.version)) throw new HttpError(400, 'Ungültige Version im Manifest.');
    if (checked.file !== `HeldixClient-Setup-${checked.version}.exe`) {
      throw new HttpError(400, 'Der Dateiname im Manifest passt nicht zur Version (HeldixClient-Setup-<version>.exe).');
    }
    if (checked.size <= 0 || checked.size > MAX_SETUP_SIZE) throw new HttpError(400, 'Ungültige Größe im Manifest.');
    const sha512 = manifest.sha512;
    if (typeof sha512 !== 'string' || Buffer.from(sha512, 'base64').length !== 64) throw new HttpError(400, 'Ungültige Prüfsumme (sha512) im Manifest.');

    return this.exclusive(MANIFEST_FILE, async () => {
      checkNewer(checked.version, (await this.published())?.version, 'die veröffentlichte');
      await this.checkUploaded({ file: checked.file, size: checked.size, sha512 });
      await this.writeManifest(MANIFEST_FILE, checked);
      this.cache = undefined;
      this.onPublished(checked);
      return { manifest, version: checked.version, file: checked.file };
    });
  }

  /**
   * `PUT /v1/team/updates/manifest` mit dem Inhalt von update-mac.json (erkannt an `platform` „mac“): prüft Form,
   * Signatur (Ed25519, öffentlicher Update-Schlüssel), beide ZIPs (Größe und SHA-512) und dass die Version höher ist
   * als die bisherige Mac-Version, und ersetzt dann update-mac.json atomar.
   */
  async publishMac(input: unknown, publicKey: KeyObject): Promise<{ manifest: Record<string, unknown>; version: string; files: string[] }> {
    const checked = checkMacUpdateObject(input);
    if (typeof checked === 'string') throw new HttpError(400, `Ungültige ${MAC_MANIFEST_FILE}: ${checked}.`);
    checkSignature(checked, publicKey);
    const manifest = JSON.parse(checked.manifest) as Record<string, unknown>;
    return this.exclusive(MAC_MANIFEST_FILE, async () => {
      checkNewer(checked.version, (await this.publishedMac())?.version, 'die veröffentlichte Mac-Version');
      for (const arch of MAC_ARCHES) await this.checkUploaded(checked.files[arch]);
      await this.writeManifest(MAC_MANIFEST_FILE, checked);
      this.macCache = undefined;
      this.onPublished(checked);
      return { manifest, version: checked.version, files: MAC_ARCHES.map((arch) => checked.files[arch].file) };
    });
  }

  /** Je Manifest-Datei nur ein Veröffentlichen gleichzeitig (sonst 409). */
  private async exclusive<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (this.publishing.has(name)) throw new HttpError(409, 'Gerade wird schon eine Version veröffentlicht.');
    this.publishing.add(name);
    try {
      return await work();
    } finally {
      this.publishing.delete(name);
    }
  }

  /** Wirft 409, wenn die Datei fehlt, gerade hochgeladen wird oder Größe bzw. SHA-512 nicht zum Manifest passen. */
  private async checkUploaded({ file, size, sha512 }: { file: string; size: number; sha512: string }): Promise<void> {
    const real = await this.resolve(file);
    const info = real === null ? null : await fs.promises.stat(real).catch(() => null);
    if (real === null || !info || !info.isFile()) {
      throw new HttpError(409, `${file} liegt nicht im Update-Ordner. Bitte zuerst hochladen.`);
    }
    if (this.uploading.has(file)) throw new HttpError(409, `${file} wird gerade hochgeladen. Bitte warten, bis der Upload fertig ist.`);
    if (info.size !== size) {
      throw new HttpError(409, `${file} ist ${info.size} Byte groß, das Manifest nennt ${size}.`);
    }
    if ((await sha512File(real)) !== sha512) {
      throw new HttpError(409, `Die Prüfsumme (SHA-512) von ${file} passt nicht zum Manifest.`);
    }
  }

  /** Atomar: erst eine neue Datei schreiben, dann umbenennen. Wer gerade liest, sieht die alte oder die neue. */
  private async writeManifest(name: string, published: PublishedVersion): Promise<void> {
    const dir = await fs.promises.realpath(this.dir);
    const tmp = path.join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      const handle = await fs.promises.open(tmp, 'wx', 0o644);
      try {
        await handle.writeFile(JSON.stringify({ manifest: published.manifest, signature: published.signature }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.promises.rename(tmp, path.join(dir, name));
    } catch (err) {
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /**
   * `DELETE /v1/team/updates/files/<file>`: löscht einen Installer oder eine Mac-Datei, aber nie den veröffentlichten
   * Installer und nie eine ZIP der veröffentlichten Mac-Version (409).
   */
  async deleteFile(file: string): Promise<void> {
    if (parseDownloadName(file) === null) throw new HttpError(404, NO_SUCH_FILE);
    const protectedBy = await this.protectedFile(file);
    if (protectedBy === 'windows') throw new HttpError(409, 'Das ist der Installer der veröffentlichten Version. Er lässt sich nicht löschen.');
    if (protectedBy === 'mac') throw new HttpError(409, 'Das ist eine ZIP der veröffentlichten Mac-Version. Sie lässt sich nicht löschen.');
    if ((await this.resolve(file)) === null) throw new HttpError(404, NO_SUCH_FILE);
    // Den Eintrag im Ordner löschen (bei einem Link den Link, nie sein Ziel).
    await fs.promises.unlink(path.join(await fs.promises.realpath(this.dir), file)).catch(() => {
      throw new HttpError(404, NO_SUCH_FILE);
    });
  }

  private async load<T>(kind: ManifestKind<T>, info: fs.Stats): Promise<T | null> {
    const invalid = (reason: string) => {
      this.log(`${kind.file} im Update-Ordner ist ungültig (${reason}). Bis zur Korrektur gilt: ${kind.nothing}`);
      return null;
    };
    if (!info.isFile()) return invalid('keine Datei');
    if (info.size > MAX_MANIFEST_SIZE) return invalid(`größer als ${MAX_MANIFEST_SIZE / 1024} KB`);
    let text: string;
    try {
      text = await fs.promises.readFile(path.join(this.dir, kind.file), 'utf8');
    } catch (err) {
      return invalid(`nicht lesbar: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
    }
    const result = kind.parse(text);
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
