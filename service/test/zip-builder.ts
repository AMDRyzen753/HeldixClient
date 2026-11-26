// Hilfen für die Tests: ZIP-Archive (auch absichtlich kaputte), Addon-JARs und Bilder (PNG, JPEG) bauen.
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipSpec {
  name: string;
  data: Buffer;
  method: number;
  /** wie gespeichert (bei Deflate komprimiert) */
  stored: Buffer;
  crc: number;
  /** angegebene Größe (entpackt) */
  size: number;
  flags: number;
  /** Name im lokalen Kopf (Standard: wie im Inhaltsverzeichnis) */
  localName?: string;
  localMethod?: number;
}

/** Ein Eintrag; `overrides` verfälscht einzelne Felder für Tests. */
export function entry(name: string, data: Buffer | string, method = 8, overrides: Partial<ZipSpec> = {}): ZipSpec {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return {
    name,
    data: bytes,
    method,
    stored: method === 8 ? deflateRawSync(bytes) : bytes,
    crc: crc32(bytes),
    size: bytes.length,
    flags: 0x0800,
    ...overrides,
  };
}

export function localRecord(e: ZipSpec): Buffer {
  const name = Buffer.from(e.localName ?? e.name, 'utf8');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(e.flags, 6);
  head.writeUInt16LE(e.localMethod ?? e.method, 8);
  head.writeUInt32LE(e.crc >>> 0, 14);
  head.writeUInt32LE(e.stored.length, 18);
  head.writeUInt32LE(e.size, 22);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28);
  return Buffer.concat([head, name, e.stored]);
}

export function centralRecord(e: ZipSpec, offset: number): Buffer {
  const name = Buffer.from(e.name, 'utf8');
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(e.flags, 8);
  head.writeUInt16LE(e.method, 10);
  head.writeUInt32LE(e.crc >>> 0, 16);
  head.writeUInt32LE(e.stored.length, 20);
  head.writeUInt32LE(e.size, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt32LE(offset, 42);
  return Buffer.concat([head, name]);
}

export function endRecord(count: number, cdSize: number, cdOffset: number, comment = '', total = count): Buffer {
  const text = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(total, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdOffset, 16);
  end.writeUInt16LE(text.length, 20);
  return Buffer.concat([end, text]);
}

/** Ein ZIP aus den Einträgen (lokale Köpfe, Inhaltsverzeichnis, Ende). */
export function buildZip(entries: ZipSpec[], comment = ''): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const local = localRecord(e);
    centrals.push(centralRecord(e, offset));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  return Buffer.concat([...locals, cd, endRecord(entries.length, cd.length, offset, comment)]);
}

/** Klassendatei zum Durchsuchen: Magic, dann die Texte (wie Konstanten im Pool). */
export function classFile(...constants: string[]): Buffer {
  return Buffer.concat([Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 65]), ...constants.map((c) => Buffer.from(`\u0001${c}`, 'latin1'))]);
}

export interface JarOptions {
  /** Felder von heldix.addon.json (undefined: Feld fehlt) */
  meta?: Record<string, unknown>;
  /** zusätzliche Einträge, z. B. Klassen mit bestimmten Konstanten */
  extra?: ZipSpec[];
  /** Text statt JSON für heldix.addon.json */
  rawMeta?: string;
}

/** Eine Addon-JAR wie aus Gradle: heldix.addon.json, Manifest, Einstiegsklasse und Extras. */
export function addonJar(id: string, version: string, options: JarOptions = {}): Buffer {
  const meta = {
    id,
    name: `Addon ${id}`,
    version,
    description: `Kurz: ${id}.`,
    authors: [],
    entrypoint: `dev.beispiel.${id.replace(/[^a-z0-9]/g, '')}.Haupt`,
    api: 2,
    ...options.meta,
  };
  // Die Einstiegsklasse nur, wenn der Name eine Klasse sein kann (sonst testet der Fall gerade das Feld).
  const entrypoint = typeof meta.entrypoint === 'string' && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(meta.entrypoint) ? meta.entrypoint : null;
  return buildZip([
    entry('META-INF/', '', 0),
    entry('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\r\n\r\n'),
    entry('heldix.addon.json', options.rawMeta ?? JSON.stringify(meta, null, 2)),
    ...(entrypoint === null ? [] : [entry(`${entrypoint.replace(/\./g, '/')}.class`, classFile('dev/heldixclient/api/HeldixAddon', 'java/lang/Object'))]),
    ...(options.extra ?? []),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** Kleines PNG mit der angegebenen Größe im IHDR (Bilddaten egal, werden nie dekodiert). */
export function png(width: number, height: number, padding = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.alloc(16 + padding)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Kleines JPEG: SOI, APP0 (JFIF), Füllbytes, SOF (Standard C0, progressiv C2), SOS, EOI. */
export function jpeg(width: number, height: number, sof = 0xc0): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\u0000', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  const frame = Buffer.alloc(19);
  frame[0] = 0xff;
  frame[1] = sof;
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame[9] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    Buffer.from([0xff]), // Füllbyte vor dem nächsten Marker
    frame,
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]),
    Buffer.alloc(32, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]);
}
