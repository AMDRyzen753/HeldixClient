// Screenshots von Addons: Art und Größe aus dem Dateikopf lesen (PNG: IHDR, JPEG: SOF), sonst nichts.
// Die Bilder werden nicht dekodiert; ausgeliefert werden sie nur mit passendem Content-Type und nosniff.

export type ImageType = 'png' | 'jpeg';

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
}

export const IMAGE_CONTENT_TYPES: Record<ImageType, string> = { png: 'image/png', jpeg: 'image/jpeg' };
export const IMAGE_EXTENSIONS: Record<ImageType, string> = { png: 'png', jpeg: 'jpg' };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(buf: Buffer): ImageInfo | null {
  // Signatur, dann als erster Abschnitt IHDR mit 13 Byte: Breite, Höhe, …
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.readUInt32BE(8) !== 13 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { type: 'png', width, height } : null;
}

/** SOF-Marker (Bildgröße): C0–CF außer C4 (DHT), C8 (JPG) und CC (DAC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpeg(buf: Buffer): ImageInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let pos = 2;
  // Abschnitte bis zum ersten SOF durchgehen; vor den Bilddaten (SOS) muss er kommen.
  for (let guard = 0; guard < 10_000 && pos + 4 <= buf.length; guard++) {
    if (buf[pos] !== 0xff) return null;
    let marker = buf[pos + 1]!;
    // Füllbytes (0xFF 0xFF …)
    while (marker === 0xff && pos + 2 < buf.length) {
      pos++;
      marker = buf[pos + 1]!;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null;
    if (pos + 4 > buf.length) return null;
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      if (length < 7 || pos + 9 > buf.length) return null;
      const height = buf.readUInt16BE(pos + 5);
      const width = buf.readUInt16BE(pos + 7);
      return width > 0 && height > 0 ? { type: 'jpeg', width, height } : null;
    }
    pos += 2 + length;
  }
  return null;
}

/** Art und Größe eines PNG- oder JPEG-Bilds aus dem Dateikopf; alles andere: null. */
export function imageInfo(buf: Buffer): ImageInfo | null {
  return png(buf) ?? jpeg(buf);
}
