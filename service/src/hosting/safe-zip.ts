// Dauerhafte Welten (1.13.0): sicheres Lesen, Prüfen und Entpacken großer ZIP-Dateien direkt von der Platte (Welten bis
// 2 GB, Sicherungen) und ein kleiner ZIP-Schreiber. Gemeinsamer Helfer für den Dienst (Prüfen beim Upload) und den
// ProcessRunner (Entpacken, Sichern, Herunterladen). Der Welten-Wächter hat bewusst einen eigenen.
//
// Abgelehnt werden: absolute Pfade und Laufwerke, „..“ und „.“, Backslashes, Steuerzeichen, zu lange Namen, Symlinks und
// andere Sonderdateien, verschlüsselte Einträge, unbekannte Kompression, doppelte Einträge, überlappende Daten, zu viele
// Einträge und zu viel entpackter Inhalt. Beim Entpacken zählt der Helfer die echten Bytes mit (nicht nur die Angabe im
// Inhaltsverzeichnis) und prüft die CRC-32 jedes Eintrags.
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform, Writable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

/** Fehler mit deutschem Text für den Spieler (Upload abgelehnt). */
export class ZipRejected extends Error {}

export interface ZipLimits {
  /** höchstens so viele Einträge */
  maxEntries: number;
  /** höchstens so viel entpackt, alle Einträge zusammen */
  maxTotalBytes: number;
  /** höchstens so groß ein einzelner Eintrag (entpackt) */
  maxEntryBytes: number;
}

/** Grenzen für hochgeladene Welten (Speicher je Welt 6 GB). */
export const WORLD_ZIP_LIMITS: ZipLimits = {
  maxEntries: 200_000,
  maxTotalBytes: 6 * 1024 ** 3,
  maxEntryBytes: 1024 ** 3,
};

export interface SafeZipEntry {
  name: string;
  directory: boolean;
  method: 0 | 8;
  crc32: number;
  compressedSize: number;
  size: number;
  /** Beginn des lokalen Kopfs */
  localOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_NAME_BYTES = 1024;
const MAX_COMPONENT = 255;
const MAX_DEPTH = 32;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const U32 = 0xffffffff;
const U16 = 0xffff;
const READ_CHUNK = 256 * 1024;

const broken = (detail: string) => new ZipRejected(`Die ZIP-Datei ist beschädigt (${detail}).`);

function shown(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}]/gu, '?').slice(0, 120);
}

/**
 * Name eines Eintrags prüfen: relativ, nur „/“ als Trenner, keine leeren Teile, kein „.“ oder „..“, keine Steuerzeichen,
 * keine Laufwerke, nicht zu lang und nicht zu tief. Liefert den Namen ohne „/“ am Ende und ob es ein Ordner ist.
 */
export function checkEntryName(raw: string): { name: string; directory: boolean } {
  const directory = raw.endsWith('/');
  const name = directory ? raw.slice(0, -1) : raw;
  const parts = name.split('/');
  const bad =
    name === '' ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    parts.length > MAX_DEPTH ||
    parts.some((part) => part === '' || part === '.' || part === '..' || Buffer.byteLength(part) > MAX_COMPONENT);
  if (bad) throw new ZipRejected(`Die ZIP-Datei enthält einen ungültigen Pfad: „${shown(raw)}“ (keine „..“, keine absoluten Pfade, keine Backslashes).`);
  return { name, directory };
}

async function readAt(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buf, done, length - done, position + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return done === length ? buf : buf.subarray(0, done);
}

/** Zip64-Zusatzfeld: echte Größen und Offset, wo das Inhaltsverzeichnis 0xFFFFFFFF schreibt. */
function zip64Values(extra: Buffer, wanted: { size: boolean; compressed: boolean; offset: boolean }) {
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const id = extra.readUInt16LE(pos);
    const length = extra.readUInt16LE(pos + 2);
    const body = extra.subarray(pos + 4, pos + 4 + length);
    if (id === 0x0001) {
      let at = 0;
      const next = () => {
        if (at + 8 > body.length) throw broken('Zip64-Angaben unvollständig');
        const value = Number(body.readBigUInt64LE(at));
        at += 8;
        return value;
      };
      return {
        size: wanted.size ? next() : undefined,
        compressed: wanted.compressed ? next() : undefined,
        offset: wanted.offset ? next() : undefined,
      };
    }
    pos += 4 + length;
  }
  throw broken('Zip64-Angaben fehlen');
}

/** Ende des Inhaltsverzeichnisses finden und lesen (auch Zip64). */
async function readEnd(handle: fs.FileHandle, fileSize: number): Promise<{ count: number; offset: number; size: number }> {
  if (fileSize < EOCD_SIZE) throw new ZipRejected('Das ist keine ZIP-Datei.');
  const tailLength = Math.min(fileSize, EOCD_SIZE + 0xffff);
  const tailStart = fileSize - tailLength;
  const tail = await readAt(handle, tailStart, tailLength);
  let pos = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE && i + EOCD_SIZE + tail.readUInt16LE(i + 20) === tail.length) {
      pos = i;
      break;
    }
  }
  if (pos < 0) throw new ZipRejected('Das ist keine ZIP-Datei (Inhaltsverzeichnis fehlt).');
  if (tail.readUInt16LE(pos + 4) !== 0 || tail.readUInt16LE(pos + 6) !== 0) throw new ZipRejected('Mehrteilige ZIP-Dateien gehen nicht.');
  let count = tail.readUInt16LE(pos + 10);
  let size = tail.readUInt32LE(pos + 12);
  let offset = tail.readUInt32LE(pos + 16);
  if (count === U16 || size === U32 || offset === U32) {
    // Zip64: Locator direkt vor dem normalen Ende
    const locatorAt = tailStart + pos - 20;
    if (locatorAt < 0) throw broken('Zip64-Verweis fehlt');
    const locator = await readAt(handle, locatorAt, 20);
    if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) throw broken('Zip64-Verweis fehlt');
    const recordAt = Number(locator.readBigUInt64LE(8));
    const record = await readAt(handle, recordAt, 56);
    if (record.length < 56 || record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) throw broken('Zip64-Ende fehlt');
    count = Number(record.readBigUInt64LE(32));
    size = Number(record.readBigUInt64LE(40));
    offset = Number(record.readBigUInt64LE(48));
  }
  if (offset + size > fileSize) throw broken('Inhaltsverzeichnis außerhalb der Datei');
  return { count, offset, size };
}

/**
 * Inhaltsverzeichnis lesen und jeden Eintrag prüfen (ohne zu entpacken). Wirft ZipRejected mit deutschem Text.
 */
export async function readZipEntries(zipPath: string, limits: ZipLimits): Promise<SafeZipEntry[]> {
  const handle = await fs.open(zipPath, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const end = await readEnd(handle, fileSize);
    if (end.count > limits.maxEntries) throw new ZipRejected(`Die ZIP-Datei hat zu viele Einträge (höchstens ${limits.maxEntries}).`);
    if (end.size > 512 * 1024 * 1024) throw broken('Inhaltsverzeichnis zu groß');
    const dir = await readAt(handle, end.offset, end.size);
    const entries: SafeZipEntry[] = [];
    const seen = new Set<string>();
    let total = 0;
    let pos = 0;
    for (let i = 0; i < end.count; i++) {
      if (pos + CENTRAL_SIZE > dir.length || dir.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw broken('Inhaltsverzeichnis');
      const madeBy = dir.readUInt16LE(pos + 4);
      const flags = dir.readUInt16LE(pos + 8);
      const method = dir.readUInt16LE(pos + 10);
      const crc = dir.readUInt32LE(pos + 16);
      let compressedSize = dir.readUInt32LE(pos + 20);
      let size = dir.readUInt32LE(pos + 24);
      const nameLength = dir.readUInt16LE(pos + 28);
      const extraLength = dir.readUInt16LE(pos + 30);
      const commentLength = dir.readUInt16LE(pos + 32);
      const disk = dir.readUInt16LE(pos + 34);
      const external = dir.readUInt32LE(pos + 38);
      let localOffset = dir.readUInt32LE(pos + 42);
      const nameStart = pos + CENTRAL_SIZE;
      const next = nameStart + nameLength + extraLength + commentLength;
      if (next > dir.length) throw broken('Inhaltsverzeichnis');
      if (nameLength > MAX_NAME_BYTES) throw new ZipRejected('Die ZIP-Datei enthält einen zu langen Namen.');
      const nameBytes = dir.subarray(nameStart, nameStart + nameLength);
      // Ohne UTF-8-Kennzeichen: nur ASCII annehmen (alte Codepages führen sonst zu falschen Namen).
      if ((flags & FLAG_UTF8) === 0 && nameBytes.some((b) => b > 0x7f)) {
        throw new ZipRejected('Die ZIP-Datei enthält Namen in einer alten Zeichenkodierung. Bitte mit einem aktuellen Programm packen.');
      }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
      if (disk !== 0 && disk !== U16) throw new ZipRejected('Mehrteilige ZIP-Dateien gehen nicht.');
      if (compressedSize === U32 || size === U32 || localOffset === U32) {
        const values = zip64Values(dir.subarray(nameStart + nameLength, nameStart + nameLength + extraLength), {
          size: size === U32,
          compressed: compressedSize === U32,
          offset: localOffset === U32,
        });
        if (values.size !== undefined) size = values.size;
        if (values.compressed !== undefined) compressedSize = values.compressed;
        if (values.offset !== undefined) localOffset = values.offset;
      }
      pos = next;
      const checked = checkEntryName(raw);
      if ((flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) throw new ZipRejected('Verschlüsselte ZIP-Dateien gehen nicht.');
      if (method !== 0 && method !== 8) throw new ZipRejected(`Die ZIP-Datei nutzt eine unbekannte Kompression (Methode ${method}).`);
      // Unix-Rechte im oberen Teil der externen Attribute: nur normale Dateien und Ordner, keine Symlinks oder Geräte.
      if (madeBy >> 8 === 3) {
        const type = (external >>> 16) & 0o170000;
        if (type === 0o120000) throw new ZipRejected(`Die ZIP-Datei enthält eine Verknüpfung (Symlink): „${shown(raw)}“.`);
        if (type !== 0 && type !== 0o100000 && type !== 0o040000) throw new ZipRejected(`Die ZIP-Datei enthält eine Sonderdatei: „${shown(raw)}“.`);
      }
      const key = checked.name.toLowerCase();
      if (seen.has(key)) throw new ZipRejected(`Die ZIP-Datei enthält einen Eintrag doppelt: „${shown(checked.name)}“.`);
      seen.add(key);
      if (checked.directory && size !== 0) throw broken('Ordner mit Inhalt');
      if (size > limits.maxEntryBytes) throw new ZipRejected(`Eine Datei in der ZIP ist zu groß: „${shown(checked.name)}“.`);
      total += size;
      if (total > limits.maxTotalBytes) {
        throw new ZipRejected(`Entpackt ist die Welt zu groß (höchstens ${Math.round(limits.maxTotalBytes / 1024 ** 3)} GB).`);
      }
      if (localOffset + LOCAL_SIZE + compressedSize > end.offset) throw broken('Daten außerhalb der Datei');
      entries.push({ name: checked.name, directory: checked.directory, method, crc32: crc, compressedSize, size, localOffset });
    }
    // Überlappende Daten (eine klassische Zip-Bombe): nach Offset sortiert darf kein Eintrag in den nächsten reichen.
    const sorted = [...entries].sort((a, b) => a.localOffset - b.localOffset);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      if (prev.localOffset + LOCAL_SIZE + prev.compressedSize > sorted[i]!.localOffset) throw broken('überlappende Einträge');
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** Beginn der Daten eines Eintrags (hinter dem lokalen Kopf). */
async function dataStart(handle: fs.FileHandle, entry: SafeZipEntry): Promise<number> {
  const head = await readAt(handle, entry.localOffset, LOCAL_SIZE);
  if (head.length < LOCAL_SIZE || head.readUInt32LE(0) !== LOCAL_SIGNATURE) throw broken('lokaler Kopf');
  const flags = head.readUInt16LE(6);
  if ((flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) throw new ZipRejected('Verschlüsselte ZIP-Dateien gehen nicht.');
  return entry.localOffset + LOCAL_SIZE + head.readUInt16LE(26) + head.readUInt16LE(28);
}

async function* readRange(handle: fs.FileHandle, start: number, length: number): AsyncGenerator<Buffer> {
  let done = 0;
  while (done < length) {
    const chunk = await readAt(handle, start + done, Math.min(READ_CHUNK, length - done));
    if (chunk.length === 0) throw broken('Datei zu kurz');
    done += chunk.length;
    yield chunk;
  }
}

/** Zählt die echten Bytes (höchstens `expected`) und rechnet die CRC-32 mit. */
class Counter extends Transform {
  count = 0;
  crc = 0;

  constructor(
    private readonly expected: number,
    private readonly name: string,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.count += chunk.length;
    if (this.count > this.expected) {
      done(new ZipRejected(`Ein Eintrag der ZIP-Datei ist größer als angegeben: „${shown(this.name)}“ (Zip-Bombe?).`));
      return;
    }
    this.crc = zlib.crc32(chunk, this.crc);
    done(null, chunk);
  }

  override _flush(done: TransformCallback): void {
    if (this.count !== this.expected) done(broken(`„${shown(this.name)}“ kürzer als angegeben`));
    else done();
  }
}

/** Einen Eintrag ganz in den Speicher lesen (nur für kleine Dateien wie icon.png oder level.dat). */
export async function readZipEntry(zipPath: string, entry: SafeZipEntry, maxBytes: number): Promise<Buffer> {
  if (entry.directory || entry.size > maxBytes) throw new ZipRejected(`„${shown(entry.name)}“ ist zu groß.`);
  const handle = await fs.open(zipPath, 'r');
  try {
    const start = await dataStart(handle, entry);
    const counter = new Counter(entry.size, entry.name);
    const chunks: Buffer[] = [];
    const source = Readable.from(readRange(handle, start, entry.compressedSize));
    const collect = new Writable({
      write(chunk: Buffer, _enc, done) {
        chunks.push(chunk);
        done();
      },
    });
    await pipeline(entry.method === 8 ? [source, zlib.createInflateRaw(), counter, collect] : [source, counter, collect]);
    if (counter.crc >>> 0 !== entry.crc32 >>> 0) throw broken(`Prüfsumme von „${shown(entry.name)}“`);
    return Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}

/**
 * Einträge sicher nach `targetDir` entpacken (muss es schon geben und sollte leer sein). `map` bestimmt den Zielpfad
 * relativ zu targetDir (oder null = überspringen); die Ergebnisse werden noch einmal geprüft. Dateien entstehen mit
 * O_EXCL (nichts wird überschrieben), Ordner nur innerhalb von targetDir.
 */
export async function extractZip(
  zipPath: string,
  entries: readonly SafeZipEntry[],
  targetDir: string,
  map: (name: string) => string | null = (name) => name,
): Promise<{ files: number; bytes: number }> {
  const root = path.resolve(targetDir);
  const handle = await fs.open(zipPath, 'r');
  let files = 0;
  let bytes = 0;
  try {
    for (const entry of entries) {
      const mapped = map(entry.name);
      if (mapped === null || mapped === '') continue;
      const relative = checkEntryName(entry.directory ? `${mapped}/` : mapped).name;
      const target = path.resolve(root, ...relative.split('/'));
      if (target !== root && !target.startsWith(root + path.sep)) throw new ZipRejected(`Ungültiger Pfad: „${shown(entry.name)}“.`);
      if (entry.directory) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Kein Teil des Weges darf ein Symlink sein (targetDir ist neu, aber sicher ist sicher).
      let dir = path.dirname(target);
      while (dir !== root && dir.startsWith(root)) {
        if ((await fs.lstat(dir)).isSymbolicLink()) throw new ZipRejected(`Ungültiger Pfad: „${shown(entry.name)}“.`);
        dir = path.dirname(dir);
      }
      const start = await dataStart(handle, entry);
      const counter = new Counter(entry.size, entry.name);
      const source = Readable.from(readRange(handle, start, entry.compressedSize));
      const sink = createWriteStream(target, { flags: 'wx', mode: 0o644 });
      try {
        await pipeline(entry.method === 8 ? [source, zlib.createInflateRaw(), counter, sink] : [source, counter, sink]);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new ZipRejected(`Die ZIP-Datei enthält einen Eintrag doppelt: „${shown(entry.name)}“.`);
        if (err instanceof ZipRejected) throw err;
        if ((err as NodeJS.ErrnoException).code?.startsWith('Z_')) throw broken(`„${shown(entry.name)}“ lässt sich nicht entpacken`);
        throw err;
      }
      if (counter.crc >>> 0 !== entry.crc32 >>> 0) throw broken(`Prüfsumme von „${shown(entry.name)}“`);
      files++;
      bytes += entry.size;
    }
  } finally {
    await handle.close();
  }
  return { files, bytes };
}

export interface WorldZipInfo {
  entries: SafeZipEntry[];
  /** Ordner der Welt in der ZIP („“ oder „Name/“) */
  root: string;
  /** entpackte Größe der Welt */
  bytes: number;
  /** icon.png der Welt (Einzelspieler-Symbol), wenn vorhanden und klein */
  icon: Buffer | null;
}

/**
 * Hochgeladene Einzelspielerwelt prüfen: level.dat ganz oben oder in genau einem Ordner, alle Einträge sauber.
 */
export async function inspectWorldZip(zipPath: string, limits: ZipLimits = WORLD_ZIP_LIMITS): Promise<WorldZipInfo> {
  const entries = await readZipEntries(zipPath, limits);
  const levels = entries.filter((e) => !e.directory && (e.name === 'level.dat' || /^[^/]+\/level\.dat$/.test(e.name)));
  if (levels.length === 0) throw new ZipRejected('In der ZIP-Datei ist keine Minecraft-Welt (level.dat fehlt).');
  const top = levels.find((e) => e.name === 'level.dat');
  if (!top && levels.length > 1) throw new ZipRejected('In der ZIP-Datei sind mehrere Welten. Bitte nur eine hochladen.');
  const root = top ? '' : levels[0]!.name.slice(0, -'level.dat'.length);
  let bytes = 0;
  for (const entry of entries) if (entry.name.startsWith(root)) bytes += entry.size;
  const iconEntry = entries.find((e) => !e.directory && e.name === `${root}icon.png`);
  let icon: Buffer | null = null;
  if (iconEntry && iconEntry.size <= 64 * 1024) {
    try {
      icon = await readZipEntry(zipPath, iconEntry, 64 * 1024);
    } catch {
      icon = null;
    }
  }
  return { entries, root, bytes, icon };
}

// ---------- Schreiben ----------

/** Schon komprimiert: nur speichern (Region-Dateien sind zlib, Bilder, Archive). */
const STORED_EXTENSIONS = /\.(?:mca|mcc|png|jpg|gz|zip|jar|dat_old)$/i;

interface WrittenEntry {
  name: Buffer;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  directory: boolean;
  /** mit Datendeskriptor geschrieben (nur deflate) */
  descriptor?: boolean;
}

/**
 * Kleiner ZIP-Schreiber (Datei für Datei, Daten gestreamt, mit Datendeskriptor). Ohne Zip64: höchstens 4 GB und 65535
 * Einträge (reicht für die Entwicklung; der Welten-Wächter hat einen eigenen).
 */
export class ZipWriter {
  private readonly entries: WrittenEntry[] = [];
  private offset = 0;
  private readonly out: fs.FileHandle;

  private constructor(out: fs.FileHandle) {
    this.out = out;
  }

  static async create(zipPath: string): Promise<ZipWriter> {
    return new ZipWriter(await fs.open(zipPath, 'wx'));
  }

  private async write(buf: Buffer): Promise<void> {
    await this.out.write(buf, 0, buf.length, this.offset);
    this.offset += buf.length;
    if (this.offset > U32 - 1024 * 1024) throw new Error('Das Archiv wird zu groß (höchstens 4 GB).');
  }

  /**
   * Lokaler Kopf. Mit `known` (Prüfsumme und Größe vorab bekannt) ohne Datendeskriptor: Javas ZipInputStream (Client,
   * Herunterladen der Welt) kann „stored“-Einträge mit Deskriptor nicht lesen („only DEFLATED entries can have EXT descriptor“).
   */
  private localHeader(name: Buffer, method: number, directory: boolean, known?: { crc: number; size: number }): Buffer {
    const head = Buffer.alloc(LOCAL_SIZE);
    head.writeUInt32LE(LOCAL_SIGNATURE, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(FLAG_UTF8 | (directory || known ? 0 : FLAG_DESCRIPTOR), 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0x21, 12);
    if (known) {
      head.writeUInt32LE(known.crc >>> 0, 14);
      head.writeUInt32LE(known.size, 18);
      head.writeUInt32LE(known.size, 22);
    }
    head.writeUInt16LE(name.length, 26);
    return Buffer.concat([head, name]);
  }

  async addDirectory(name: string): Promise<void> {
    const encoded = Buffer.from(`${checkEntryName(`${name}/`).name}/`, 'utf8');
    const offset = this.offset;
    await this.write(this.localHeader(encoded, 0, true));
    this.entries.push({ name: encoded, method: 0, crc: 0, compressed: 0, size: 0, offset, directory: true });
  }

  /** Datei von der Platte hinzufügen (gestreamt). */
  async addFile(name: string, filePath: string): Promise<void> {
    if (this.entries.length >= U16 - 1) throw new Error('Zu viele Dateien für ein Archiv ohne Zip64.');
    const encoded = Buffer.from(checkEntryName(name).name, 'utf8');
    const method = STORED_EXTENSIONS.test(name) ? 0 : 8;
    const offset = this.offset;
    // „stored“: Prüfsumme und Größe vorab lesen und in den Kopf schreiben (kein Datendeskriptor, siehe localHeader)
    let known: { crc: number; size: number } | undefined;
    if (method === 0) {
      let preCrc = 0;
      let preSize = 0;
      const handle = await fs.open(filePath, 'r');
      try {
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          preCrc = zlib.crc32(chunk as Buffer, preCrc);
          preSize += (chunk as Buffer).length;
        }
      } finally {
        await handle.close().catch(() => undefined);
      }
      known = { crc: preCrc >>> 0, size: preSize };
    }
    await this.write(this.localHeader(encoded, method, false, known));
    let crc = 0;
    let size = 0;
    let compressed = 0;
    const source = (await fs.open(filePath, 'r')).createReadStream();
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        crc = zlib.crc32(chunk, crc);
        size += chunk.length;
        done(null, chunk);
      },
    });
    const writer = this;
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        compressed += chunk.length;
        writer.write(chunk).then(() => done(), done);
      },
    });
    await pipeline(method === 8 ? [source, count, zlib.createDeflateRaw({ level: 6 }), sink] : [source, count, sink]);
    if (known) {
      // Datei hat sich zwischen den beiden Lesevorgängen geändert: Kopf passt nicht mehr – lieber abbrechen als ein kaputtes Archiv
      if (known.crc !== crc >>> 0 || known.size !== size) throw new Error(`„${name.slice(0, 120)}“ hat sich beim Packen geändert.`);
    } else {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(compressed, 8);
      descriptor.writeUInt32LE(size, 12);
      await this.write(descriptor);
    }
    this.entries.push({ name: encoded, method, crc: crc >>> 0, compressed, size, offset, directory: false, descriptor: !known });
  }

  async close(): Promise<void> {
    try {
      const start = this.offset;
      for (const entry of this.entries) {
        const head = Buffer.alloc(CENTRAL_SIZE);
        head.writeUInt32LE(CENTRAL_SIGNATURE, 0);
        head.writeUInt16LE((3 << 8) | 20, 4);
        head.writeUInt16LE(20, 6);
        head.writeUInt16LE(FLAG_UTF8 | (entry.directory || !entry.descriptor ? 0 : FLAG_DESCRIPTOR), 8);
        head.writeUInt16LE(entry.method, 10);
        head.writeUInt16LE(0, 12);
        head.writeUInt16LE(0x21, 14);
        head.writeUInt32LE(entry.crc, 16);
        head.writeUInt32LE(entry.compressed, 20);
        head.writeUInt32LE(entry.size, 24);
        head.writeUInt16LE(entry.name.length, 28);
        head.writeUInt32LE(((entry.directory ? 0o040755 : 0o100644) << 16) >>> 0, 38);
        head.writeUInt32LE(entry.offset, 42);
        await this.write(Buffer.concat([head, entry.name]));
      }
      const end = Buffer.alloc(EOCD_SIZE);
      end.writeUInt32LE(EOCD_SIGNATURE, 0);
      end.writeUInt16LE(this.entries.length, 8);
      end.writeUInt16LE(this.entries.length, 10);
      end.writeUInt32LE(this.offset - start, 12);
      end.writeUInt32LE(start, 16);
      await this.write(end);
    } finally {
      await this.out.close();
    }
  }

  /** Abbrechen: Datei schließen (der Aufrufer löscht sie). */
  async abort(): Promise<void> {
    await this.out.close().catch(() => undefined);
  }
}
