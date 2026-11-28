// Hilfen für Tests der Cosmetics: PNGs bauen, gültige Manifeste für jeden Slot und signierte Umschläge.
import { randomBytes, sign, type KeyObject } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { COSMETIC_SIGNATURE_PREFIX, encodeInt16LE, encodeInt8, encodeUint16LE, encodeUint8, type CosmeticSlot } from '../src/cosmetics-format';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Ein PNG-Abschnitt mit Länge, Typ, Daten und CRC. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

export interface PngOptions {
  colorType?: number;
  bitDepth?: number;
  interlace?: number;
  /** zufällige Pixel (lassen sich nicht komprimieren) */
  random?: boolean;
}

/** Echtes PNG (RGBA, 8 Bit) mit einem Schachbrett oder zufälligen Pixeln; der Kopf lässt sich verbiegen. */
export function makePng(width: number, height: number, options: PngOptions = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = options.colorType ?? 6;
  ihdr[12] = options.interlace ?? 0;
  const stride = 1 + width * 4;
  const raw = options.random ? randomBytes(stride * height) : Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    if (options.random) continue;
    for (let x = 0; x < width; x++) {
      const p = y * stride + 1 + x * 4;
      const on = ((x >> 2) + (y >> 2)) % 2 === 0;
      raw[p] = on ? 0xff : 0x20;
      raw[p + 1] = on ? 0xc8 : 0x30;
      raw[p + 2] = on ? 0x30 : 0x90;
      raw[p + 3] = 0xff;
    }
  }
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

export function dataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

export const DATE = '2026-11-26T12:00:00.000Z';

type Manifest = Record<string, unknown>;

const base = (id: string, slot: CosmeticSlot, name: string): Manifest => ({
  type: 'heldix-cosmetic',
  format: 1,
  id,
  version: 1,
  slot,
  name,
  description: `${name} für HeldixClient`,
  access: 'all',
  date: DATE,
});

/** Gültige Manifeste, eins je Slot (wie aus `npm run cosmetic`). */
export const VALID: Record<CosmeticSlot, () => Manifest> = {
  head: () => ({
    ...base('krone', 'head', 'Krone'),
    texture: dataUrl(makePng(64, 32)),
    model: {
      textureSize: [64, 32],
      bones: [
        { name: 'base', pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 2, 8], uv: [0, 0], inflate: 0, mirror: false }] },
        // ohne rotation, inflate, mirror: Standardwerte
        { name: 'spitze', parent: 'base', pivot: [0, 2, 0], cubes: [{ origin: [-1, 2, -1], size: [2, 3, 2], uv: [32, 0] }] },
      ],
    },
    // spin ohne amplitude
    animations: [{ bone: 'spitze', type: 'spin', axis: 'y', speed: 0.5 }],
  }),
  back: () => ({
    ...base('engelsfluegel', 'back', 'Engelsflügel'),
    texture: dataUrl(makePng(64, 64)),
    glow: dataUrl(makePng(64, 64)),
    model: {
      textureSize: [64, 64],
      bones: [
        { name: 'koerper', pivot: [0, 0, -2], cubes: [] },
        { name: 'fluegel_links', parent: 'koerper', pivot: [2, 0, -2], rotation: [0, -20, 0], cubes: [{ origin: [2, -10, -3], size: [1, 12, 8], uv: [0, 0] }] },
        { name: 'fluegel_rechts', parent: 'koerper', pivot: [-2, 0, -2], rotation: [0, 20, 0], cubes: [{ origin: [-3, -10, -3], size: [1, 12, 8], uv: [0, 24], mirror: true }] },
      ],
    },
    animations: [
      { bone: 'fluegel_links', type: 'flap', axis: 'y', amplitude: 25, speed: 1.2, phase: 0 },
      { bone: 'fluegel_rechts', type: 'flap', axis: 'y', amplitude: 25, speed: 1.2, phase: 0.5 },
    ],
  }),
  aura: () => ({
    ...base('funken', 'aura', 'Funken'),
    // 4 Bilder zu je 8 × 8 nebeneinander
    texture: dataUrl(makePng(32, 8)),
    particles: { frames: 4, rate: 6, lifetime: 30, size: 0.12, motion: 'rise', radius: 0.6, color: '#ffcc00', fullbright: true },
  }),
  companion: () => ({
    ...base('drache', 'companion', 'Kleiner Drache'),
    texture: dataUrl(makePng(32, 32)),
    model: {
      textureSize: [32, 32],
      bones: [{ name: 'koerper', pivot: [0, 0, 0], cubes: [{ origin: [-2, 0, -3], size: [4, 4, 6], uv: [0, 0], inflate: 0.25 }] }],
    },
    animations: [{ bone: 'koerper', type: 'bob', axis: 'y', amplitude: 2, speed: 0.5 }],
    companion: { offset: [0.7, 1.6, -0.4], scale: 1 },
  }),
  cape: () => ({
    ...base('sternenregen', 'cape', 'Sternenregen'),
    texture: dataUrl(makePng(64, 32 * 4)),
    glow: dataUrl(makePng(64, 32 * 4)),
    cape: { frames: 4, fps: 8 },
  }),
};

/** Gültiges Manifest des Slots mit Änderungen; `undefined` entfernt ein Feld. */
export function manifestOf(slot: CosmeticSlot, changes: Manifest = {}): Manifest {
  const manifest: Manifest = { ...VALID[slot](), ...changes };
  for (const [key, value] of Object.entries(changes)) if (value === undefined) delete manifest[key];
  return manifest;
}

// ---------- Format 2 (Mesh mit Keyframes) ----------

/** Quaternion für eine Drehung um y (Grad) als Int16 × 32767. */
export function quatY(degrees: number): number[] {
  const half = (degrees * Math.PI) / 360;
  return [0, Math.round(Math.sin(half) * 32767), 0, Math.round(Math.cos(half) * 32767)];
}

/** Ein Rechteck (4 Vertices, 2 Dreiecke) an zwei Knochen, 1/32 Pixel; dazu Normalen, UVs, Dreiecke. */
export function quadMesh(): Record<string, unknown> {
  const px = (v: number) => v * 32;
  return {
    vertexCount: 4,
    triangleCount: 2,
    positions: encodeInt16LE([0, 0, 2, 4, 0, 2, 4, 8, 2, 0, 8, 2].map(px)),
    normals: encodeInt8([0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127]),
    uvs: encodeUint16LE([0, 0, 65535, 0, 65535, 65535, 0, 65535]),
    bones: encodeUint8([0, 0, 1, 1]),
    triangles: encodeUint16LE([0, 1, 2, 0, 2, 3]),
  };
}

const base2 = (id: string, slot: CosmeticSlot, name: string): Manifest => ({ ...base(id, slot, name), format: 2 });

/** Gültiges Manifest nach Format 2 (wie aus dem Blender-Konverter), je Slot ohne Cape. */
export function valid2(slot: Exclude<CosmeticSlot, 'cape'> = 'back'): Manifest {
  const manifest: Manifest = {
    ...base2(`mesh-${slot}`, slot, `Mesh ${slot}`),
    texture: dataUrl(makePng(16, 16)),
    glow: dataUrl(makePng(16, 16 * 4)),
    emissive: { frames: 4, frametimeTicks: 2, pulse: { period: 2, min: 0.5, max: 1 } },
    mesh: quadMesh(),
    bones: [
      { name: 'root', parent: -1, pivot: [0, 0, 2], tail: [0, 4, 2] },
      { name: 'wing.L', parent: 0, pivot: [4, 0, 2], tail: [4, 8, 2] },
    ],
    animations: {
      Idle: {
        fps: 24,
        frames: 48,
        loop: true,
        tracks: [{ bone: 1, rot: { keys: encodeUint16LE([0, 24, 47]), values: encodeInt16LE([...quatY(0), ...quatY(30), ...quatY(1)]) } }],
      },
      Hurt: {
        fps: 24,
        frames: 12,
        loop: false,
        tracks: [
          {
            bone: 0,
            move: { keys: encodeUint16LE([0, 6]), values: encodeInt16LE([0, 0, 0, 0, -32, 0]) },
            scale: { keys: encodeUint16LE([0]), values: encodeUint16LE([1000]) },
          },
        ],
      },
    },
    states: { idle: 'Idle', hurt: 'Hurt', blendSeconds: 0.25 },
    particles: [
      { bone: 1, at: 'tail', particle: 'minecraft:dust', color: '#ffcc00', perSecond: 2, states: ['Idle'] },
      { bone: 0, at: 'pivot', particle: 'end_rod', perSecond: 0.5 },
    ],
  };
  if (slot === 'companion') manifest.attach = { origin: [14, -6, 1], side: 'left' };
  return manifest;
}

/** Umschlag wie `npm run cosmetic`: Manifest-Text plus Ed25519-Signatur über "heldix-cosmetic\n" + Text. */
export function signCosmetic(privateKey: KeyObject, manifest: Manifest | string): { manifest: string; signature: string } {
  const text = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
  return { manifest: text, signature: sign(null, Buffer.from(COSMETIC_SIGNATURE_PREFIX + text, 'utf8'), privateKey).toString('base64') };
}
