// Köpfe aus dem Minecraft-Skin (ab 1.12.0) für Webseite und Discord-Bilder: Gesicht (8×8) mit der Hut-Ebene darüber,
// ohne Glättung vergrößert auf 32, 64, 128 oder (ab 1.14.0, Vorschaukarten) 256 Pixel, als PNG. Ohne fremde Pakete: PNG lesen und schreiben mit node:zlib.
// Gelesen werden nur Skins in 64×64 oder 64×32 (wie Minecraft sie erlaubt), 8 Bit, ohne Interlacing; alles andere und
// Spieler ohne Skin bekommen einen einfachen Standard-Kopf.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export const HEAD_SIZES = [32, 64, 128, 256] as const;
export type HeadSize = (typeof HEAD_SIZES)[number];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Größter entpackter Inhalt eines Skins (64×64 RGBA mit Filter-Bytes, großzügig). */
const MAX_RAW = 64 * 1024;

interface Image {
  width: number;
  height: number;
  /** RGBA, 4 Byte je Pixel */
  data: Buffer;
}

/** Paeth-Vorhersage (PNG-Filter 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG lesen (Farbtypen 0, 2, 3, 4, 6; 8 Bit, bei Palette auch 1, 2, 4 Bit; ohne Interlacing). Sonst null. */
export function decodePng(png: Buffer): Image | null {
  try {
    if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    let pos = 8;
    let width = 0;
    let height = 0;
    let depth = 0;
    let colorType = -1;
    let palette: Buffer | null = null;
    let alpha: Buffer | null = null;
    const idat: Buffer[] = [];
    while (pos + 12 <= png.length) {
      const length = png.readUInt32BE(pos);
      const type = png.toString('latin1', pos + 4, pos + 8);
      const body = png.subarray(pos + 8, pos + 8 + length);
      if (body.length !== length) return null;
      pos += 12 + length;
      if (type === 'IHDR') {
        width = body.readUInt32BE(0);
        height = body.readUInt32BE(4);
        depth = body[8]!;
        colorType = body[9]!;
        if (body[10] !== 0 || body[11] !== 0 || body[12] !== 0) return null; // Kompression, Filter, Interlacing
      } else if (type === 'PLTE') {
        palette = body;
      } else if (type === 'tRNS') {
        alpha = body;
      } else if (type === 'IDAT') {
        idat.push(body);
      } else if (type === 'IEND') {
        break;
      }
    }
    if (width <= 0 || height <= 0 || width > 512 || height > 512) return null;
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
    if (channels === undefined) return null;
    if (colorType === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8) return null;
    if (colorType === 3 && palette === null) return null;
    const bitsPerPixel = channels * depth;
    const stride = Math.ceil((width * bitsPerPixel) / 8);
    const bpp = Math.max(1, bitsPerPixel >> 3);
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: MAX_RAW * 64 });
    if (raw.length < (stride + 1) * height) return null;
    // Filter rückgängig machen
    const lines = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!;
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const value = raw[src + x]!;
        const left = x >= bpp ? lines[dst + x - bpp]! : 0;
        const up = y > 0 ? lines[dst - stride + x]! : 0;
        const upLeft = y > 0 && x >= bpp ? lines[dst - stride + x - bpp]! : 0;
        let out: number;
        switch (filter) {
          case 0:
            out = value;
            break;
          case 1:
            out = value + left;
            break;
          case 2:
            out = value + up;
            break;
          case 3:
            out = value + ((left + up) >> 1);
            break;
          case 4:
            out = value + paeth(left, up, upLeft);
            break;
          default:
            return null;
        }
        lines[dst + x] = out & 0xff;
      }
    }
    // In RGBA umwandeln
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const line = y * stride;
        if (colorType === 3) {
          const bit = x * depth;
          const byte = lines[line + (bit >> 3)]!;
          const index = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
          data[o] = palette![index * 3] ?? 0;
          data[o + 1] = palette![index * 3 + 1] ?? 0;
          data[o + 2] = palette![index * 3 + 2] ?? 0;
          data[o + 3] = alpha && index < alpha.length ? alpha[index]! : 255;
        } else {
          const p = line + x * channels;
          if (colorType === 0 || colorType === 4) {
            data[o] = data[o + 1] = data[o + 2] = lines[p]!;
            data[o + 3] = colorType === 4 ? lines[p + 1]! : 255;
          } else {
            data[o] = lines[p]!;
            data[o + 1] = lines[p + 1]!;
            data[o + 2] = lines[p + 2]!;
            data[o + 3] = colorType === 6 ? lines[p + 3]! : 255;
          }
        }
      }
    }
    return { width, height, data };
  } catch {
    return null;
  }
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** RGBA als PNG (8 Bit, Farbtyp 6, Filter 0). */
export function encodePng(image: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Standard-Kopf (8×8): Haare oben, Haut, Augen; Farben als RGB. */
const DEFAULT_FACE: readonly string[] = ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SSSSSSSS', 'SWESSEWS', 'SSSNNSSS', 'SSMSSMSS', 'SSMMMMSS'];
const DEFAULT_COLORS: Record<string, [number, number, number]> = {
  H: [0x3b, 0x2a, 0x1e],
  S: [0xc6, 0x8e, 0x6b],
  W: [0xff, 0xff, 0xff],
  E: [0x3a, 0x4f, 0xa8],
  N: [0xa8, 0x6f, 0x52],
  M: [0x6e, 0x3b, 0x2c],
};

function defaultFace(): Image {
  const data = Buffer.alloc(8 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const [r, g, b] = DEFAULT_COLORS[DEFAULT_FACE[y]![x]!]!;
      const o = (y * 8 + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { width: 8, height: 8, data };
}

/**
 * Gesicht 8×8 aus einem Skin: Grundebene (8,8) deckend, Hut-Ebene (40,8) darüber gemischt. Bei alten Skins (64×32) ist
 * eine ganz deckende Hut-Ebene meist Füllfarbe und wird wie in Minecraft weggelassen.
 */
export function faceOf(skin: Image): Image | null {
  if (skin.width !== 64 || (skin.height !== 64 && skin.height !== 32)) return null;
  const data = Buffer.alloc(8 * 8 * 4);
  const at = (x: number, y: number) => (y * skin.width + x) * 4;
  let hatOpaque = true;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (skin.data[at(40 + x, 8 + y) + 3]! < 128) hatOpaque = false;
  const useHat = !(skin.height === 32 && hatOpaque);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const base = at(8 + x, 8 + y);
      const hat = at(40 + x, 8 + y);
      const a = useHat ? skin.data[hat + 3]! / 255 : 0;
      const o = (y * 8 + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(skin.data[base + c]! * (1 - a) + skin.data[hat + c]! * a);
      data[o + 3] = 255;
    }
  }
  return { width: 8, height: 8, data };
}

/** Bild ohne Glättung vergrößern (jedes Pixel wird zu einem Quadrat). */
function scale(image: Image, size: number): Image {
  const factor = size / image.width;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      image.data.copy(data, (y * size + x) * 4, (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4, (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4 + 4);
    }
  }
  return { width: size, height: size, data };
}

/** PNG des Kopfes in `size` Pixeln; ohne (lesbaren) Skin der Standard-Kopf. */
export function renderHead(skinPng: Buffer | null, size: HeadSize): Buffer {
  const skin = skinPng ? decodePng(skinPng) : null;
  const face = (skin ? faceOf(skin) : null) ?? defaultFace();
  return encodePng(scale(face, size));
}

export function isHeadSize(value: number): value is HeadSize {
  return (HEAD_SIZES as readonly number[]).includes(value);
}

/** Zwischenspeicher für fertige Köpfe (je Spieler und Größe), die ältesten fallen zuerst weg. */
export class HeadCache {
  private readonly entries = new Map<string, { png: Buffer; until: number }>();

  constructor(
    private readonly maxEntries = 1000,
    private readonly ttlMs = 60 * 60 * 1000,
  ) {}

  get(key: string, now = Date.now()): Buffer | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.until <= now) {
      this.entries.delete(key);
      return null;
    }
    return hit.png;
  }

  set(key: string, png: Buffer, ttlMs = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { png, until: Date.now() + ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}
