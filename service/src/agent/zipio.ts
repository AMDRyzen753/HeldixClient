// ZIP lesen und schreiben, ohne das Archiv in den Speicher zu laden (Welten und Sicherungen bis mehrere GB).
//
// Lesen prüft streng: ein Datenträger, nur „stored“ und „deflate“, nichts verschlüsselt, keine symbolischen Links oder
// Sondertypen, Namen ohne absolute Pfade, Laufwerke, Backslashes, Doppelpunkte, „..“ und Steuerzeichen, keine doppelten
// Namen (auch nicht Datei und Ordner gleichen Namens), Grenzen für Zahl der Einträge und entpackte Größe, Einträge
// überlappen nicht, lokale Köpfe passen zum Inhaltsverzeichnis, entpackte Größe und CRC-32 stimmen genau. ZIP64 (mehr
// als 65 535 Einträge oder über 4 GiB) wird gelesen und beim Schreiben nur benutzt, wenn nötig.
import type { FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { AgentError } from './errors';
import { readChunks, writeAllAt } from './files';

export interface ZipLimits {
  maxEntries: number;
  /** Summe der entpackten Größen */
  maxTotalBytes: number;
  maxEntryBytes: number;
}

export interface ZipItem {
  name: string;
  rawName: Buffer;
  directory: boolean;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  mtime: Date;
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const U16 = 0xffff;
const U32 = 0xffffffff;
const MAX_CD_BYTES = 256 * 1024 * 1024;
const MAX_NAME_BYTES = 1024;
const MAX_DEPTH = 64;

function bad(message: string): AgentError {
  return new AgentError(`ZIP: ${message}`, 'invalid');
}

function shown(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '?');
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done);
    if (bytesRead === 0) throw bad('Datei endet zu früh.');
    done += bytesRead;
  }
  return buf;
}

function readU64(buf: Buffer, offset: number): number {
  const value = buf.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw bad('Wert zu groß.');
  return Number(value);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeName(bytes: Buffer, flags: number): string {
  if (!(flags & 0x0800) && bytes.every((b) => b < 0x80)) return bytes.toString('latin1');
  try {
    // Mit UTF-8-Merker (Bit 11) – und ohne ihn nur, wenn es trotzdem gültiges UTF-8 ist (manche Programme vergessen ihn)
    return utf8.decode(bytes);
  } catch {
    throw bad('Dateiname ist kein gültiges UTF-8.');
  }
}

/** Prüft einen Namen im Archiv (Ordner enden mit „/“). */
export function checkEntryName(name: string): void {
  if (name.length === 0) throw bad('leerer Name.');
  if (/[\u0000-\u001f\u007f\\:]/.test(name)) throw bad(`ungültiges Zeichen im Namen „${shown(name)}“.`);
  if (name.startsWith('/')) throw bad(`absoluter Pfad „${shown(name)}“ ist nicht erlaubt.`);
  const parts = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (parts.length > MAX_DEPTH) throw bad(`„${shown(name)}“ ist zu tief verschachtelt.`);
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw bad(`ungültiger Pfad „${shown(name)}“.`);
  }
}

function dosTime(date: number, time: number): Date {
  const result = new Date(
    ((date >> 9) & 0x7f) + 1980,
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
  return Number.isNaN(result.getTime()) ? new Date() : result;
}

function dosDateTime(value: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
  };
}

function findExtra(extra: Buffer, id: number): Buffer | null {
  let p = 0;
  while (p + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(p);
    const size = extra.readUInt16LE(p + 2);
    if (p + 4 + size > extra.length) throw bad('Zusatzfeld ungültig.');
    if (headerId === id) return extra.subarray(p + 4, p + 4 + size);
    p += 4 + size;
  }
  return null;
}

export class ZipReader {
  private constructor(
    private readonly fh: FileHandle,
    readonly entries: ZipItem[],
    private readonly cdOffset: number,
  ) {}

  /** Liest und prüft das Inhaltsverzeichnis; der Aufrufer schließt fh. */
  static async open(fh: FileHandle, limits: ZipLimits): Promise<ZipReader> {
    const { size } = await fh.stat();
    if (size < 22) throw bad('Datei ist zu kurz für ein ZIP.');
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = await readAt(fh, size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw bad('kein Inhaltsverzeichnis gefunden (kein ZIP oder abgeschnitten).');
    const eocdPos = size - tailLength + eocd;
    let disk = tail.readUInt16LE(eocd + 4);
    let cdDisk = tail.readUInt16LE(eocd + 6);
    let diskEntries = tail.readUInt16LE(eocd + 8);
    let total = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    let cdLimit = eocdPos;
    if (total === U16 || diskEntries === U16 || cdSize === U32 || cdOffset === U32) {
      if (eocdPos < 20) throw bad('ZIP64-Verweis fehlt.');
      const locator = await readAt(fh, eocdPos - 20, 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) throw bad('ZIP64-Verweis fehlt.');
      if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) > 1) throw bad('mehrteilige Archive gehen nicht.');
      const z64Pos = readU64(locator, 8);
      if (z64Pos + 56 > eocdPos - 20) throw bad('ZIP64-Ende ungültig.');
      const z = await readAt(fh, z64Pos, 56);
      if (z.readUInt32LE(0) !== ZIP64_EOCD_SIG) throw bad('ZIP64-Ende ungültig.');
      disk = z.readUInt32LE(16);
      cdDisk = z.readUInt32LE(20);
      diskEntries = readU64(z, 24);
      total = readU64(z, 32);
      cdSize = readU64(z, 40);
      cdOffset = readU64(z, 48);
      cdLimit = z64Pos;
    }
    if (disk !== 0 || cdDisk !== 0 || diskEntries !== total) throw bad('mehrteilige Archive gehen nicht.');
    if (total > limits.maxEntries) throw new AgentError(`ZIP: zu viele Einträge (höchstens ${limits.maxEntries}).`, 'too-large');
    if (cdSize > MAX_CD_BYTES || cdOffset + cdSize > cdLimit) throw bad('Inhaltsverzeichnis ungültig.');
    const cd = await readAt(fh, cdOffset, cdSize);

    const entries: ZipItem[] = [];
    const files = new Set<string>();
    const dirs = new Set<string>();
    let sum = 0;
    let p = 0;
    for (let n = 0; n < total; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN_SIG) throw bad('Inhaltsverzeichnis ungültig.');
      const madeBy = cd.readUInt16LE(p + 4);
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const time = cd.readUInt16LE(p + 12);
      const date = cd.readUInt16LE(p + 14);
      const crc = cd.readUInt32LE(p + 16);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLength = cd.readUInt16LE(p + 28);
      const extraLength = cd.readUInt16LE(p + 30);
      const commentLength = cd.readUInt16LE(p + 32);
      const diskStart = cd.readUInt16LE(p + 34);
      const external = cd.readUInt32LE(p + 38);
      let localOffset = cd.readUInt32LE(p + 42);
      const end = p + 46 + nameLength + extraLength + commentLength;
      if (end > cd.length) throw bad('Inhaltsverzeichnis ungültig.');
      if (nameLength > MAX_NAME_BYTES) throw bad('Name zu lang.');
      const rawName = Buffer.from(cd.subarray(p + 46, p + 46 + nameLength));
      const extra = cd.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
      if (compressedSize === U32 || entrySize === U32 || localOffset === U32 || diskStart === U16) {
        const z = findExtra(extra, 0x0001);
        if (!z) throw bad('ZIP64-Angaben fehlen.');
        let q = 0;
        const next = (): number => {
          if (q + 8 > z.length) throw bad('ZIP64-Angaben unvollständig.');
          const value = readU64(z, q);
          q += 8;
          return value;
        };
        if (entrySize === U32) entrySize = next();
        if (compressedSize === U32) compressedSize = next();
        if (localOffset === U32) localOffset = next();
        if (diskStart === U16 && (q + 4 > z.length || z.readUInt32LE(q) !== 0)) throw bad('mehrteilige Archive gehen nicht.');
      } else if (diskStart !== 0) {
        throw bad('mehrteilige Archive gehen nicht.');
      }
      if (flags & 0x0041) throw bad('verschlüsselte Einträge gehen nicht.');
      if (method !== 0 && method !== 8) throw bad(`Packverfahren ${method} wird nicht unterstützt (nur stored und deflate).`);
      const name = decodeName(rawName, flags);
      checkEntryName(name);
      const directory = name.endsWith('/');
      if (madeBy >> 8 === 3) {
        // von Unix: Dateityp steht in den oberen 16 Bit
        const type = (external >>> 16) & 0o170000;
        if (type === 0o120000) throw bad(`symbolischer Link „${shown(name)}“ ist nicht erlaubt.`);
        if (type !== 0 && type !== 0o100000 && type !== 0o040000) throw bad(`Sondertyp „${shown(name)}“ ist nicht erlaubt.`);
        if (type === 0o040000 && !directory) throw bad(`Ordner „${shown(name)}“ ohne „/“ am Ende.`);
      }
      if (directory && entrySize !== 0) throw bad(`Ordner „${shown(name)}“ mit Inhalt.`);
      if (method === 0 && compressedSize !== entrySize) throw bad(`Größen von „${shown(name)}“ passen nicht.`);
      if (entrySize > limits.maxEntryBytes) {
        throw new AgentError(`ZIP: „${shown(name)}“ ist zu groß (höchstens ${Math.round(limits.maxEntryBytes / 1048576)} MB).`, 'too-large');
      }
      sum += entrySize;
      if (sum > limits.maxTotalBytes) {
        throw new AgentError(`ZIP: entpackt zu groß (höchstens ${Math.round(limits.maxTotalBytes / 1048576)} MB).`, 'too-large');
      }
      const key = directory ? name.slice(0, -1) : name;
      if (files.has(key) || dirs.has(key)) throw bad(`doppelter Eintrag „${shown(name)}“.`);
      (directory ? dirs : files).add(key);
      if (localOffset + 30 + compressedSize > cdOffset) throw bad(`„${shown(name)}“ liegt außerhalb der Daten.`);
      entries.push({ name, rawName, directory, method, crc, compressedSize, size: entrySize, localOffset, mtime: dosTime(date, time) });
      p = end;
    }
    // Datei und Ordner mit gleichem Pfad („a“ als Datei und „a/b“)
    for (const entry of entries) {
      const parts = (entry.directory ? entry.name.slice(0, -1) : entry.name).split('/');
      for (let i = 1; i < parts.length; i++) {
        if (files.has(parts.slice(0, i).join('/'))) throw bad(`„${shown(entry.name)}“ liegt unter einer Datei.`);
      }
    }
    return new ZipReader(fh, entries, cdOffset);
  }

  /**
   * Entpackt einen Eintrag Stück für Stück an `write`; prüft lokalen Kopf, Lage (nicht vor `minOffset`, also ohne
   * Überlappung, wenn in Reihenfolge der Offsets entpackt wird), Größe und CRC-32. Liefert das Ende seiner Daten.
   */
  async extract(item: ZipItem, write: (chunk: Buffer) => Promise<void>, minOffset: number): Promise<number> {
    if (item.localOffset < minOffset) throw bad(`„${shown(item.name)}“ überlappt einen anderen Eintrag.`);
    const head = await readAt(this.fh, item.localOffset, 30);
    if (head.readUInt32LE(0) !== LOC_SIG) throw bad(`Kopf von „${shown(item.name)}“ fehlt.`);
    if (head.readUInt16LE(6) & 0x0041) throw bad('verschlüsselte Einträge gehen nicht.');
    if (head.readUInt16LE(8) !== item.method) throw bad(`Kopf von „${shown(item.name)}“ passt nicht zum Inhaltsverzeichnis.`);
    const nameLength = head.readUInt16LE(26);
    const extraLength = head.readUInt16LE(28);
    const localName = await readAt(this.fh, item.localOffset + 30, nameLength);
    if (!localName.equals(item.rawName)) throw bad(`Name im Kopf von „${shown(item.name)}“ passt nicht.`);
    const dataStart = item.localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + item.compressedSize;
    if (dataEnd > this.cdOffset) throw bad(`„${shown(item.name)}“ reicht ins Inhaltsverzeichnis.`);
    let produced = 0;
    let crc = 0;
    if (item.compressedSize > 0) {
      const source = readChunks(this.fh, dataStart, dataEnd);
      const limit = item.size;
      const sink = async (input: AsyncIterable<Buffer>): Promise<void> => {
        for await (const chunk of input) {
          produced += chunk.length;
          if (produced > limit) throw bad(`„${shown(item.name)}“ ist entpackt größer als angegeben.`);
          crc = zlib.crc32(chunk, crc);
          await write(chunk);
        }
      };
      try {
        if (item.method === 8) await pipeline(source, zlib.createInflateRaw(), sink);
        else await pipeline(source, sink);
      } catch (err) {
        if (err instanceof AgentError) throw err;
        throw bad(`„${shown(item.name)}“ lässt sich nicht entpacken (beschädigt).`);
      }
    }
    if (produced !== item.size) throw bad(`Größe von „${shown(item.name)}“ passt nicht.`);
    if (crc >>> 0 !== item.crc >>> 0) throw bad(`Prüfsumme (CRC-32) von „${shown(item.name)}“ passt nicht.`);
    return dataEnd;
  }

  /** Kleinen Eintrag in den Speicher (höchstens maxBytes). */
  async readSmall(item: ZipItem, maxBytes: number): Promise<Buffer> {
    if (item.size > maxBytes) throw bad(`„${shown(item.name)}“ ist zu groß.`);
    const parts: Buffer[] = [];
    await this.extract(
      item,
      async (chunk) => {
        parts.push(chunk);
      },
      0,
    );
    return Buffer.concat(parts);
  }
}

/** Schon komprimierte Dateien (gzip-NBT, Bilder, Archive) werden nur gespeichert, nicht noch einmal gepackt. */
export function shouldCompress(name: string): boolean {
  return !/\.(dat|dat_old|gz|zip|jar|png|jpg|jpeg|ogg|mcc)$/i.test(name);
}

/** Schreibt ein ZIP in eine offene Datei (ab Position 0); Größen und CRC werden nach den Daten in den Kopf geschrieben. */
export class ZipWriter {
  private position = 0;
  private readonly central: Buffer[] = [];
  private readonly names = new Set<string>();

  constructor(private readonly fh: FileHandle) {}

  get count(): number {
    return this.central.length;
  }

  private async put(buf: Buffer): Promise<void> {
    await writeAllAt(this.fh, buf, this.position);
    this.position += buf.length;
  }

  private async begin(name: string, method: number, mtime: Date): Promise<{ nameBytes: Buffer; localOffset: number; date: number; time: number }> {
    checkEntryName(name);
    if (name.endsWith('/')) throw bad('Ordner werden nicht einzeln geschrieben.');
    if (this.names.has(name)) throw bad(`doppelter Eintrag „${shown(name)}“.`);
    this.names.add(name);
    const nameBytes = Buffer.from(name, 'utf8');
    const { date, time } = dosDateTime(mtime);
    const localOffset = this.position;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(LOC_SIG, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    // CRC und Größen (14–25) kommen nach den Daten
    head.writeUInt16LE(nameBytes.length, 26);
    head.writeUInt16LE(0, 28);
    await this.put(Buffer.concat([head, nameBytes]));
    return { nameBytes, localOffset, date, time };
  }

  private async end(
    start: { nameBytes: Buffer; localOffset: number; date: number; time: number },
    name: string,
    method: number,
    crc: number,
    compressed: number,
    size: number,
  ): Promise<void> {
    if (size >= U32 || compressed >= U32) throw new AgentError(`ZIP: „${shown(name)}“ ist größer als 4 GiB.`, 'too-large');
    const patch = Buffer.alloc(12);
    patch.writeUInt32LE(crc >>> 0, 0);
    patch.writeUInt32LE(compressed, 4);
    patch.writeUInt32LE(size, 8);
    await writeAllAt(this.fh, patch, start.localOffset + 14);
    const zip64 = start.localOffset >= U32;
    const extra = Buffer.alloc(zip64 ? 12 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(start.localOffset), 4);
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(CEN_SIG, 0);
    c.writeUInt16LE((3 << 8) | (zip64 ? 45 : 20), 4);
    c.writeUInt16LE(zip64 ? 45 : 20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(start.time, 12);
    c.writeUInt16LE(start.date, 14);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(compressed, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(start.nameBytes.length, 28);
    c.writeUInt16LE(extra.length, 30);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    c.writeUInt32LE(zip64 ? U32 : start.localOffset, 42);
    this.central.push(Buffer.concat([c, start.nameBytes, extra]));
  }

  /** Datei aus einer offenen Quelle (liest ab Position 0 bis zum Ende). */
  async addFile(name: string, source: FileHandle, mtime: Date): Promise<void> {
    const method = shouldCompress(name) ? 8 : 0;
    const start = await this.begin(name, method, mtime);
    let crc = 0;
    let size = 0;
    let compressed = 0;
    const counter = async function* (input: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
      for await (const chunk of input) {
        size += chunk.length;
        crc = zlib.crc32(chunk, crc);
        yield chunk;
      }
    };
    const sink = async (input: AsyncIterable<Buffer>): Promise<void> => {
      for await (const chunk of input) {
        compressed += chunk.length;
        await this.put(chunk);
      }
    };
    const input = readChunks(source);
    if (method === 8) await pipeline(input, counter, zlib.createDeflateRaw({ level: 6 }), sink);
    else await pipeline(input, counter, sink);
    await this.end(start, name, method, crc, compressed, size);
  }

  async addBuffer(name: string, data: Buffer, mtime = new Date()): Promise<void> {
    const method = shouldCompress(name) ? 8 : 0;
    const start = await this.begin(name, method, mtime);
    const stored = method === 8 ? zlib.deflateRawSync(data) : data;
    await this.put(stored);
    await this.end(start, name, method, zlib.crc32(data), stored.length, data.length);
  }

  /** Inhaltsverzeichnis und Ende schreiben; liefert die Größe der Datei. */
  async finish(): Promise<number> {
    const cdOffset = this.position;
    for (let i = 0; i < this.central.length; i += 1024) await this.put(Buffer.concat(this.central.slice(i, i + 1024)));
    const cdSize = this.position - cdOffset;
    const count = this.central.length;
    const zip64 = count >= U16 || cdOffset >= U32 || cdSize >= U32;
    if (zip64) {
      const z = Buffer.alloc(56);
      z.writeUInt32LE(ZIP64_EOCD_SIG, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE((3 << 8) | 45, 12);
      z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(count), 24);
      z.writeBigUInt64LE(BigInt(count), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40);
      z.writeBigUInt64LE(BigInt(cdOffset), 48);
      const z64Pos = this.position;
      await this.put(z);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
      locator.writeBigUInt64LE(BigInt(z64Pos), 8);
      locator.writeUInt32LE(1, 16);
      await this.put(locator);
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(EOCD_SIG, 0);
    e.writeUInt16LE(zip64 ? U16 : count, 8);
    e.writeUInt16LE(zip64 ? U16 : count, 10);
    e.writeUInt32LE(zip64 ? U32 : cdSize, 12);
    e.writeUInt32LE(zip64 ? U32 : cdOffset, 16);
    await this.put(e);
    return this.position;
  }
}
