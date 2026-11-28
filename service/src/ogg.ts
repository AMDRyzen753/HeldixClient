// Prüft hochgeladene Voice-Clips (ab 1.13.0): eine Ogg-Datei mit genau einem Opus-Strom, wie ihn HeldixClient beim
// Melden erzeugt (OpusHead, OpusTags, dann die Opus-Pakete des gemeldeten Sprechers). Gelesen werden nur die Rahmen
// der Datei (Seiten, CRC, Kopf, Kommentare, Granule-Positionen), nie der Ton selbst.

/** Ergebnis der Prüfung. */
export interface OggOpusInfo {
  /** Spieldauer aus der letzten Granule-Position (ohne Pre-Skip), in Millisekunden */
  durationMs: number;
  /** Zahl der Audio-Pakete (ohne OpusHead und OpusTags) */
  packets: number;
  channels: number;
  vendor: string;
  /** Kommentare aus OpusTags (Schlüssel groß geschrieben); doppelte: der erste zählt */
  tags: Record<string, string>;
}

/** Fehler in einer Clip-Datei (deutscher Text für die Antwort). */
export class OggError extends Error {}

/** CRC-32 von Ogg: Polynom 0x04C11DB7, nicht gespiegelt, Startwert 0, ohne Abschluss-XOR. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

export function oggCrc(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]!) & 0xff]!) >>> 0;
  return crc >>> 0;
}

const SAMPLE_RATE = 48_000;
/** Größtes Opus-Paket, das wir annehmen (der Voice Chat sendet höchstens 1024 Byte je Rahmen). */
const MAX_PACKET = 1500;
/** Höchstens so viele Kommentare und so lange Werte in OpusTags. */
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 16 * 1024;

interface Page {
  headerType: number;
  granule: bigint;
  serial: number;
  sequence: number;
  segments: number[];
  data: Buffer;
}

function readPages(buffer: Buffer): Page[] {
  const pages: Page[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 27) throw new OggError('Die Datei endet mitten in einer Ogg-Seite.');
    if (buffer.toString('latin1', offset, offset + 4) !== 'OggS') throw new OggError('Keine Ogg-Datei (Kennung „OggS“ fehlt).');
    if (buffer[offset + 4] !== 0) throw new OggError('Unbekannte Ogg-Version.');
    const headerType = buffer[offset + 5]!;
    const granule = buffer.readBigInt64LE(offset + 6);
    const serial = buffer.readUInt32LE(offset + 14);
    const sequence = buffer.readUInt32LE(offset + 18);
    const crc = buffer.readUInt32LE(offset + 22);
    const count = buffer[offset + 26]!;
    const headerLength = 27 + count;
    if (buffer.length - offset < headerLength) throw new OggError('Die Datei endet mitten in einer Ogg-Seite.');
    const segments: number[] = [];
    let bodyLength = 0;
    for (let i = 0; i < count; i++) {
      const value = buffer[offset + 27 + i]!;
      segments.push(value);
      bodyLength += value;
    }
    const end = offset + headerLength + bodyLength;
    if (end > buffer.length) throw new OggError('Die Datei endet mitten in einer Ogg-Seite.');
    const page = Buffer.from(buffer.subarray(offset, end));
    page.writeUInt32LE(0, 22);
    if (oggCrc(page) !== crc) throw new OggError('Prüfsumme einer Ogg-Seite stimmt nicht.');
    pages.push({ headerType, granule, serial, sequence, segments, data: buffer.subarray(offset + headerLength, end) });
    offset = end;
  }
  return pages;
}

/** Kommentare aus OpusTags lesen. */
function readTags(packet: Buffer): { vendor: string; tags: Record<string, string> } {
  let offset = 8;
  const need = (n: number) => {
    if (offset + n > packet.length) throw new OggError('OpusTags ist unvollständig.');
  };
  need(4);
  const vendorLength = packet.readUInt32LE(offset);
  offset += 4;
  if (vendorLength > MAX_TAG_LENGTH) throw new OggError('OpusTags ist zu groß.');
  need(vendorLength);
  const vendor = packet.toString('utf8', offset, offset + vendorLength);
  offset += vendorLength;
  need(4);
  const count = packet.readUInt32LE(offset);
  offset += 4;
  if (count > MAX_TAGS) throw new OggError('OpusTags hat zu viele Kommentare.');
  const tags: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    need(4);
    const length = packet.readUInt32LE(offset);
    offset += 4;
    if (length > MAX_TAG_LENGTH) throw new OggError('Ein Kommentar in OpusTags ist zu lang.');
    need(length);
    const entry = packet.toString('utf8', offset, offset + length);
    offset += length;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    if (!Object.hasOwn(tags, key)) tags[key] = entry.slice(eq + 1);
  }
  return { vendor, tags };
}

/**
 * Prüft eine Ogg/Opus-Datei: gültige Seiten mit CRC, genau ein Strom, Paket 1 OpusHead (Version 1, 1–2 Kanäle), Paket 2
 * OpusTags, danach mindestens ein Audio-Paket bis höchstens `maxPacket` Byte, Granule-Positionen nicht fallend, Spieldauer
 * höchstens `maxMs`. Wirft OggError mit deutschem Text.
 */
export function parseOggOpus(buffer: Buffer, maxMs: number): OggOpusInfo {
  if (buffer.length < 27) throw new OggError('Die Datei ist zu klein für eine Ogg-Datei.');
  const pages = readPages(buffer);
  if (pages.length === 0) throw new OggError('Die Datei enthält keine Ogg-Seiten.');
  const serial = pages[0]!.serial;
  if ((pages[0]!.headerType & 0x02) === 0) throw new OggError('Der erste Ogg-Seite fehlt der Anfang des Stroms.');
  const packets: Buffer[] = [];
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let lastGranule = -1n;
  let sequence = -1;
  for (const [index, page] of pages.entries()) {
    if (page.serial !== serial) throw new OggError('Die Datei darf nur einen Ogg-Strom enthalten.');
    if (index > 0 && (page.headerType & 0x02) !== 0) throw new OggError('Die Datei darf nur einen Ogg-Strom enthalten.');
    if (sequence >= 0 && page.sequence !== sequence + 1) throw new OggError('Ogg-Seiten fehlen oder sind vertauscht.');
    sequence = page.sequence;
    const continued = (page.headerType & 0x01) !== 0;
    if (continued !== pending.length > 0) throw new OggError('Ein Ogg-Paket ist falsch über Seiten verteilt.');
    if (page.granule !== -1n) {
      if (page.granule < lastGranule) throw new OggError('Die Granule-Positionen der Ogg-Seiten fallen.');
      lastGranule = page.granule;
    }
    let offset = 0;
    for (const value of page.segments) {
      pending.push(page.data.subarray(offset, offset + value));
      pendingLength += value;
      offset += value;
      if (pendingLength > Math.max(MAX_PACKET, MAX_TAG_LENGTH * 2)) throw new OggError('Ein Ogg-Paket ist zu groß.');
      if (value < 255) {
        packets.push(Buffer.concat(pending));
        pending = [];
        pendingLength = 0;
      }
    }
  }
  if (pending.length > 0) throw new OggError('Die Datei endet mitten in einem Ogg-Paket.');
  const head = packets[0];
  if (!head || head.length < 19 || head.toString('latin1', 0, 8) !== 'OpusHead') throw new OggError('OpusHead fehlt (keine Opus-Datei).');
  if (head[8]! >> 4 !== 0) throw new OggError('Unbekannte Version von OpusHead.');
  const channels = head[9]!;
  if (channels < 1 || channels > 2) throw new OggError('Nur Opus mit einem oder zwei Kanälen.');
  const preSkip = head.readUInt16LE(10);
  if (head[18] !== 0) throw new OggError('Nur Opus ohne Kanal-Zuordnung (Mapping 0).');
  const tagsPacket = packets[1];
  if (!tagsPacket || tagsPacket.length < 16 || tagsPacket.toString('latin1', 0, 8) !== 'OpusTags') throw new OggError('OpusTags fehlt.');
  const { vendor, tags } = readTags(tagsPacket);
  const audio = packets.slice(2);
  if (audio.length === 0) throw new OggError('Die Datei enthält keinen Ton.');
  for (const packet of audio) {
    if (packet.length === 0 || packet.length > MAX_PACKET) throw new OggError('Ein Opus-Paket hat eine ungültige Größe.');
  }
  if (lastGranule <= 0n) throw new OggError('Die Datei hat keine gültige Spieldauer.');
  const samples = lastGranule - BigInt(preSkip);
  const durationMs = Number(samples > 0n ? (samples * 1000n) / BigInt(SAMPLE_RATE) : 0n);
  if (durationMs > maxMs) throw new OggError(`Die Aufnahme ist zu lang (höchstens ${Math.round(maxMs / 60_000)} Minuten).`);
  return { durationMs, packets: audio.length, channels, vendor, tags };
}

/** Kleine Ogg/Opus-Datei bauen (für Tests): `packets` als Audio-Pakete je 20 ms, Kommentare `tags`. */
export function buildOggOpus(packets: readonly Buffer[], tags: Record<string, string>, serial = 0x48454c44): Buffer {
  const pages: Buffer[] = [];
  let sequence = 0;
  const page = (data: Buffer[], granule: bigint, headerType: number) => {
    const segments: number[] = [];
    for (const packet of data) {
      let left = packet.length;
      while (left >= 255) {
        segments.push(255);
        left -= 255;
      }
      segments.push(left);
    }
    const header = Buffer.alloc(27 + segments.length);
    header.write('OggS', 0, 'latin1');
    header[4] = 0;
    header[5] = headerType;
    header.writeBigInt64LE(granule, 6);
    header.writeUInt32LE(serial, 14);
    header.writeUInt32LE(sequence++, 18);
    header[26] = segments.length;
    segments.forEach((value, i) => (header[27 + i] = value));
    const out = Buffer.concat([header, ...data]);
    out.writeUInt32LE(oggCrc(out), 22);
    pages.push(out);
  };
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(0, 10);
  head.writeUInt32LE(48_000, 12);
  page([head], 0n, 0x02);
  const vendor = Buffer.from('HeldixClient', 'utf8');
  const comments = Object.entries(tags).map(([key, value]) => Buffer.from(`${key}=${value}`, 'utf8'));
  const parts: Buffer[] = [Buffer.from('OpusTags', 'latin1')];
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
  };
  parts.push(u32(vendor.length), vendor, u32(comments.length));
  for (const comment of comments) parts.push(u32(comment.length), comment);
  page([Buffer.concat(parts)], 0n, 0);
  let granule = 0n;
  for (let i = 0; i < packets.length; i += 50) {
    const chunk = packets.slice(i, i + 50);
    granule += BigInt(chunk.length * 960);
    page([...chunk], granule, i + 50 >= packets.length ? 0x04 : 0);
  }
  return Buffer.concat(pages);
}
