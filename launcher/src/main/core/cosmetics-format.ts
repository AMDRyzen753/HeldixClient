// Heldix-Cosmetics (Format 1): signierter Umschlag und strenge Prüfung des Manifests.
//
// Ein Cosmetic ist reine Daten (Modell, Textur, Partikel), kein Code. Das Team signiert es mit dem Update-Schlüssel:
// Ed25519 über die UTF-8-Bytes von "heldix-cosmetic\n" + Manifest-Text (Domänentrennung zu Addons und Launcher-Updates).
// Dienst, Spiel, Launcher und Webseite prüfen dieselben Regeln. Deshalb ist diese Datei eigenständig: keine anderen
// Module, kein Node-Buffer, nur Standard-JavaScript (atob). Launcher und Webseite können sie übernehmen, das Spiel baut
// sie in Java nach. Die Signatur prüft der Aufrufer selbst (cosmeticSignedText liefert den signierten Text).
// Alle Grenzen stehen in COSMETIC_LIMITS; docs/dienst.md beschreibt sie.

/** Steht vor dem Manifest-Text, wenn signiert wird. */
export const COSMETIC_SIGNATURE_PREFIX = 'heldix-cosmetic\n';
export const COSMETIC_TYPE = 'heldix-cosmetic';
export const COSMETIC_FORMAT = 1;

export const COSMETIC_SLOTS = ['head', 'back', 'aura', 'companion', 'cape'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];
/** Slots mit Modell (und damit mit Animationen). */
export const MODEL_SLOTS: readonly CosmeticSlot[] = ['head', 'back', 'companion'];
export const COSMETIC_ACCESS = ['all', 'team'] as const;
export type CosmeticAccess = (typeof COSMETIC_ACCESS)[number];
export const ANIMATION_TYPES = ['flap', 'sway', 'spin', 'bob'] as const;
export type AnimationType = (typeof ANIMATION_TYPES)[number];
export const ANIMATION_AXES = ['x', 'y', 'z'] as const;
export type AnimationAxis = (typeof ANIMATION_AXES)[number];
export const PARTICLE_MOTIONS = ['rise', 'fall', 'orbit', 'spark', 'float'] as const;
export type ParticleMotion = (typeof PARTICLE_MOTIONS)[number];

/** 1–32 Zeichen aus a–z, 0–9 und -, nicht mit - am Anfang oder Ende. */
export const COSMETIC_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const BONE_NAME_RE = /^[a-z0-9_]{1,24}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Ed25519-Signatur (64 Byte) als Standard-Base64: 88 Zeichen mit „==“, kanonisch (keine Restbits). */
export const SIGNATURE_RE = /^[A-Za-z0-9+/]{85}[AQgw]==$/;
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** IDs der eingebauten Capes (wie DEFAULT_CAPES im Dienst): Ein Cosmetic darf keine davon tragen. */
export const BUILTIN_CAPE_IDS: readonly string[] = ['heldix', 'mitternacht', 'aurora', 'glut', 'kristall', 'neon', 'sakura', 'gewitter', 'galaxie'];

/** Alle Grenzen von Format 1 (Byte-Angaben: 1 KB = 1024 Byte). */
export const COSMETIC_LIMITS = Object.freeze({
  /** Umschlag `{ manifest, signature }` als JSON (wie ausgeliefert) */
  envelopeBytes: 192 * 1024,
  /** Manifest-Text (UTF-8) */
  manifestBytes: 160 * 1024,
  /** je PNG (texture, glow), dekodiert */
  pngBytes: 64 * 1024,
  versionMax: 2_147_483_647,
  nameMax: 40,
  descriptionMax: 300,
  /** head, back, aura, companion: Breite und Höhe je 8–256, Vielfache von 8 */
  textureMin: 8,
  textureMax: 256,
  textureStep: 8,
  /** cape: 64, 128 oder 256 breit, je Bild halb so hoch wie breit, Bilder untereinander */
  capeWidths: Object.freeze([64, 128, 256]) as readonly number[],
  capeFramesMax: 32,
  capeFpsMax: 20,
  bonesMax: 32,
  cubesMax: 128,
  cubeEdgeMax: 32,
  /** Koordinaten, Pivots und Würfel (mit inflate) in [-48, 48] Pixel um den Anker */
  coordMax: 48,
  rotationMax: 180,
  inflateMax: 2,
  animationsMax: 16,
  amplitudeMax: 90,
  bobAmplitudeMax: 8,
  speedMax: 4,
  particleFramesMax: 8,
  rateMin: 1,
  rateMax: 20,
  lifetimeMin: 5,
  lifetimeMax: 80,
  sizeMin: 0.03,
  sizeMax: 0.4,
  radiusMin: 0.2,
  radiusMax: 1.5,
  /** companion.offset in Blöcken: x und z in [-2, 2], y in [0, 3] */
  offsetXZMax: 2,
  offsetYMin: 0,
  offsetYMax: 3,
  scaleMin: 0.25,
  scaleMax: 1.5,
});

export type Vec3 = [number, number, number];

export interface CosmeticCube {
  origin: Vec3;
  size: Vec3;
  uv: [number, number];
  inflate: number;
  mirror: boolean;
}

export interface CosmeticBone {
  name: string;
  /** Name eines vorher definierten Bones oder null */
  parent: string | null;
  pivot: Vec3;
  rotation: Vec3;
  cubes: CosmeticCube[];
}

export interface CosmeticModel {
  textureSize: [number, number];
  bones: CosmeticBone[];
}

export interface CosmeticAnimation {
  bone: string;
  type: AnimationType;
  axis: AnimationAxis;
  /** Grad (bei bob: Pixel); bei spin ohne Bedeutung (fehlt es, 0) */
  amplitude: number;
  speed: number;
  phase: number;
}

export interface CosmeticParticles {
  frames: number;
  rate: number;
  lifetime: number;
  size: number;
  motion: ParticleMotion;
  radius: number;
  color: string;
  fullbright: boolean;
}

export interface CosmeticCape {
  frames: number;
  fps: number;
}

export interface CosmeticCompanion {
  offset: Vec3;
  scale: number;
}

/** Größe eines PNG aus dem Dateikopf und seine Länge in Byte. */
export interface CosmeticImage {
  width: number;
  height: number;
  bytes: number;
}

/** Das geprüfte Manifest; fehlende freiwillige Felder mit ihrem Standardwert. */
export interface CosmeticManifest {
  type: typeof COSMETIC_TYPE;
  format: typeof COSMETIC_FORMAT;
  id: string;
  version: number;
  slot: CosmeticSlot;
  name: string;
  description: string;
  access: CosmeticAccess;
  date: string;
  texture: string;
  /** Größe der Textur (aus IHDR) */
  image: CosmeticImage;
  glow: string | null;
  model: CosmeticModel | null;
  animations: CosmeticAnimation[];
  particles: CosmeticParticles | null;
  cape: CosmeticCape | null;
  companion: CosmeticCompanion | null;
}

export interface CosmeticEnvelope {
  manifest: string;
  signature: string;
}

const MANIFEST_KEYS = [
  'type',
  'format',
  'id',
  'version',
  'slot',
  'name',
  'description',
  'access',
  'date',
  'texture',
  'glow',
  'model',
  'animations',
  'particles',
  'cape',
  'companion',
];
/** Steuerzeichen (auch Zeilenumbrüche), Zeilen-/Absatztrenner, Schreibrichtung, einzelne Ersatzzeichen. */
const FORBIDDEN_TEXT_RE = /[\p{Cc}\p{Cs}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;
const LONE_SURROGATE_RE = /\p{Cs}/u;
/** ISO 8601: Datum, auf Wunsch mit Uhrzeit (Sekunden, Bruchteile und Zeitzone freiwillig). */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Die Bytes, über die die Signatur läuft, als Text (UTF-8 kodieren): `"heldix-cosmetic\n" + manifest`. */
export function cosmeticSignedText(manifest: string): string {
  return COSMETIC_SIGNATURE_PREFIX + manifest;
}

/** Der Umschlag genau so, wie der Dienst ihn ausliefert (darüber laufen `size` und `sha256` im Katalog). */
export function cosmeticEnvelopeText(envelope: CosmeticEnvelope): string {
  return JSON.stringify({ manifest: envelope.manifest, signature: envelope.signature });
}

/** Länge in Byte als UTF-8 (einzelne Ersatzzeichen zählen wie U+FFFD). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Länge in Unicode-Zeichen (Codepunkten), nicht in UTF-16-Einheiten. */
export function codePointLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
    length++;
  }
  return length;
}

// ---------- PNG (nur Aufbau und Kopf, nicht dekodiert) ----------

let crcTable: Uint32Array | null = null;

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (wie in PNG und zlib) über bytes[start, end). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const table = crcTable ?? (crcTable = makeCrcTable());
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Erlaubte Bittiefen je Farbtyp (PNG-Spezifikation). */
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function u32(bytes: Uint8Array, pos: number): number {
  return ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
}

/**
 * Prüft den Aufbau eines PNG ohne es zu dekodieren: Signatur, alle Abschnitte vollständig mit stimmender Prüfsumme
 * (CRC), IHDR zuerst mit gültigen Werten, mindestens ein IDAT, IEND zuletzt und nichts danach. Liefert die Größe oder
 * einen Hinweis.
 */
export function readPng(bytes: Uint8Array): { width: number; height: number } | string {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return 'ist kein PNG (die PNG-Signatur fehlt)';
  let pos = 8;
  let size: { width: number; height: number } | null = null;
  let data = false;
  let end = false;
  while (pos < bytes.length) {
    if (end) return 'hat Daten nach dem Ende (IEND)';
    if (bytes.length - pos < 12) return 'ist beschädigt (Abschnitt abgeschnitten)';
    const length = u32(bytes, pos);
    if (length > bytes.length - pos - 12) return 'ist beschädigt (Abschnitt abgeschnitten)';
    let type = '';
    for (let i = pos + 4; i < pos + 8; i++) {
      const c = bytes[i];
      if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) return 'ist beschädigt (ungültiger Abschnitt)';
      type += String.fromCharCode(c);
    }
    if (crc32(bytes, pos + 4, pos + 8 + length) !== u32(bytes, pos + 8 + length)) return `ist beschädigt (Prüfsumme von ${type} stimmt nicht)`;
    if (size === null) {
      if (type !== 'IHDR' || length !== 13) return 'ist beschädigt (IHDR fehlt am Anfang)';
      const width = u32(bytes, pos + 8);
      const height = u32(bytes, pos + 12);
      const depth = bytes[pos + 16];
      const color = bytes[pos + 17];
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return 'hat eine ungültige Größe';
      if (!(PNG_DEPTHS[color] ?? []).includes(depth) || bytes[pos + 18] !== 0 || bytes[pos + 19] !== 0 || bytes[pos + 20] > 1) {
        return 'hat ungültige Werte im Kopf (IHDR: Farbtyp, Bittiefe, Kompression, Filter oder Interlace)';
      }
      size = { width, height };
    } else if (type === 'IHDR') {
      return 'ist beschädigt (IHDR doppelt)';
    }
    if (type === 'IDAT') data = true;
    if (type === 'IEND') {
      if (length !== 0) return 'ist beschädigt (IEND nicht leer)';
      end = true;
    }
    pos += 12 + length;
  }
  if (size === null) return 'ist beschädigt (IHDR fehlt am Anfang)';
  if (!data) return 'hat keine Bilddaten (IDAT)';
  if (!end) return 'ist unvollständig (IEND fehlt am Ende)';
  return size;
}

/** Strenges Standard-Base64 (Länge ein Vielfaches von 4, nur A–Z, a–z, 0–9, +, / und = am Ende); sonst null. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64_RE.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- Prüfung ----------

/** Ein Problem im Manifest (nur innerhalb dieser Datei; nach außen kommt der Text). */
class Problem extends Error {}

function fail(message: string): never {
  throw new Problem(message);
}

const q = (path: string) => `„${path}“`;
const sub = (path: string, key: string) => (path === '' ? key : `${path}.${key}`);

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${q(path)} muss ein JSON-Objekt sein`);
  return value as Record<string, unknown>;
}

/** Nur bekannte Felder (Format 1 kennt keine Zusatzfelder). */
function onlyKeys(o: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(`${q(sub(path, key))} ist kein bekanntes Feld (Format ${COSMETIC_FORMAT})`);
  }
}

function has(o: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(o, key);
}

function required(o: Record<string, unknown>, key: string, path: string): unknown {
  if (!has(o, key)) fail(`${q(sub(path, key))} fehlt`);
  return o[key];
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${q(path)} muss eine ganze Zahl von ${min} bis ${max} sein`);
  }
  return value;
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${q(path)} muss eine Zahl von ${min} bis ${max} sein`);
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, list: readonly T[]): T {
  if (typeof value !== 'string' || !(list as readonly string[]).includes(value)) fail(`${q(path)} muss eins von ${list.join(', ')} sein`);
  return value as T;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${q(path)} muss true oder false sein`);
  return value;
}

/** Drei Zahlen; `ranges` je Achse [min, max]. */
function vec3(value: unknown, path: string, ranges: [number, number][]): Vec3 {
  const ok =
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((v, i) => typeof v === 'number' && Number.isFinite(v) && v >= ranges[i]![0] && v <= ranges[i]![1]);
  if (!ok) {
    const same = ranges.every((r) => r[0] === ranges[0]![0] && r[1] === ranges[0]![1]);
    fail(
      same
        ? `${q(path)} muss eine Liste aus drei Zahlen von ${ranges[0]![0]} bis ${ranges[0]![1]} sein`
        : `${q(path)} muss eine Liste aus drei Zahlen sein (${['x', 'y', 'z'].map((a, i) => `${a} von ${ranges[i]![0]} bis ${ranges[i]![1]}`).join(', ')})`,
    );
  }
  return [value[0], value[1], value[2]];
}

const around = (max: number): [number, number][] => [
  [-max, max],
  [-max, max],
  [-max, max],
];

/** Text genau wie signiert (ohne Trimmen), eine Zeile. */
function text(value: unknown, path: string, min: number, max: number): string {
  if (typeof value !== 'string') fail(`${q(path)} fehlt oder ist kein Text`);
  if (FORBIDDEN_TEXT_RE.test(value)) fail(`${q(path)} enthält Zeichen, die nicht erlaubt sind (auch keine Zeilenumbrüche)`);
  if (min > 0 && value.trim() === '') fail(`${q(path)} darf nicht leer sein`);
  if (codePointLength(value) > max) fail(`${q(path)} ist zu lang (höchstens ${max} Zeichen)`);
  return value;
}

/** Datum nach ISO 8601, das es wirklich gibt (kein 30. Februar). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, mo, d, h = '0', mi = '0', s = '0', oh = '0', om = '0'] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return Number(h) <= 23 && Number(mi) <= 59 && Number(s) <= 59 && Number(oh) <= 23 && Number(om) <= 59;
}

/** PNG als data-URL: Präfix, strenges Base64, höchstens 64 KB, gültiger Aufbau. */
function png(value: unknown, path: string): CosmeticImage {
  if (typeof value !== 'string' || !value.startsWith(PNG_DATA_URL_PREFIX)) fail(`${q(path)} muss eine data-URL „${PNG_DATA_URL_PREFIX}…“ sein`);
  const base64 = value.slice(PNG_DATA_URL_PREFIX.length);
  const tooLarge = `${q(path)} ist zu groß (höchstens ${COSMETIC_LIMITS.pngBytes / 1024} KB als PNG)`;
  if (base64.length > Math.ceil(COSMETIC_LIMITS.pngBytes / 3) * 4) fail(tooLarge);
  const bytes = decodeBase64(base64);
  if (bytes === null) fail(`${q(path)} enthält kein gültiges Base64`);
  if (bytes.length > COSMETIC_LIMITS.pngBytes) fail(tooLarge);
  const info = readPng(bytes);
  if (typeof info === 'string') fail(`${q(path)} ${info}`);
  return { width: info.width, height: info.height, bytes: bytes.length };
}

function checkCape(value: unknown): CosmeticCape {
  const o = object(value, 'cape');
  onlyKeys(o, 'cape', ['frames', 'fps']);
  return {
    frames: integer(required(o, 'frames', 'cape'), 'cape.frames', 1, COSMETIC_LIMITS.capeFramesMax),
    fps: integer(required(o, 'fps', 'cape'), 'cape.fps', 1, COSMETIC_LIMITS.capeFpsMax),
  };
}

function checkParticles(value: unknown): CosmeticParticles {
  const L = COSMETIC_LIMITS;
  const o = object(value, 'particles');
  onlyKeys(o, 'particles', ['frames', 'rate', 'lifetime', 'size', 'motion', 'radius', 'color', 'fullbright']);
  const get = (key: string) => required(o, key, 'particles');
  const frames = integer(get('frames'), 'particles.frames', 1, L.particleFramesMax);
  const rate = integer(get('rate'), 'particles.rate', L.rateMin, L.rateMax);
  const lifetime = integer(get('lifetime'), 'particles.lifetime', L.lifetimeMin, L.lifetimeMax);
  const size = number(get('size'), 'particles.size', L.sizeMin, L.sizeMax);
  const motion = oneOf(get('motion'), 'particles.motion', PARTICLE_MOTIONS);
  const radius = number(get('radius'), 'particles.radius', L.radiusMin, L.radiusMax);
  const color = get('color');
  if (typeof color !== 'string' || !COLOR_RE.test(color)) fail('„particles.color“ muss eine Farbe wie #ffcc00 sein');
  const fullbright = has(o, 'fullbright') ? boolean(o.fullbright, 'particles.fullbright') : false;
  return { frames, rate, lifetime, size, motion, radius, color, fullbright };
}

function checkCompanion(value: unknown): CosmeticCompanion {
  const L = COSMETIC_LIMITS;
  const o = object(value, 'companion');
  onlyKeys(o, 'companion', ['offset', 'scale']);
  return {
    offset: vec3(required(o, 'offset', 'companion'), 'companion.offset', [
      [-L.offsetXZMax, L.offsetXZMax],
      [L.offsetYMin, L.offsetYMax],
      [-L.offsetXZMax, L.offsetXZMax],
    ]),
    scale: number(required(o, 'scale', 'companion'), 'companion.scale', L.scaleMin, L.scaleMax),
  };
}

/** Würfel: Box-UV wie bei Minecraft, Fläche (2d+2w) × (d+h) ab `uv`, muss in die Textur passen. */
function checkCube(value: unknown, path: string, texture: [number, number]): CosmeticCube {
  const L = COSMETIC_LIMITS;
  const o = object(value, path);
  onlyKeys(o, path, ['origin', 'size', 'uv', 'inflate', 'mirror']);
  const origin = vec3(required(o, 'origin', path), sub(path, 'origin'), around(L.coordMax));
  const size = vec3(required(o, 'size', path), sub(path, 'size'), [
    [0, L.cubeEdgeMax],
    [0, L.cubeEdgeMax],
    [0, L.cubeEdgeMax],
  ]);
  if (size.every((edge) => edge === 0)) fail(`${q(sub(path, 'size'))}: mindestens eine Kante muss größer als 0 sein`);
  const uv = required(o, 'uv', path);
  if (!Array.isArray(uv) || uv.length !== 2 || !uv.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0x7fffffff)) {
    fail(`${q(sub(path, 'uv'))} muss eine Liste aus zwei ganzen Zahlen ab 0 sein`);
  }
  const inflate = has(o, 'inflate') ? number(o.inflate, sub(path, 'inflate'), 0, L.inflateMax) : 0;
  const mirror = has(o, 'mirror') ? boolean(o.mirror, sub(path, 'mirror')) : false;
  for (let axis = 0; axis < 3; axis++) {
    const from = origin[axis]! - inflate;
    const to = origin[axis]! + size[axis]! + inflate;
    if (from < -L.coordMax || to > L.coordMax) {
      fail(`${q(path)} reicht weiter als ${L.coordMax} Pixel vom Anker (${'xyz'[axis]} von ${from} bis ${to})`);
    }
  }
  const [w, h, d] = size;
  const uvWidth = 2 * d + 2 * w;
  const uvHeight = d + h;
  if (uv[0] + uvWidth > texture[0] || uv[1] + uvHeight > texture[1]) {
    fail(`${q(sub(path, 'uv'))}: Die UV-Fläche (${uvWidth} × ${uvHeight} ab ${uv[0]}, ${uv[1]}) passt nicht in die Textur (${texture[0]} × ${texture[1]})`);
  }
  return { origin, size, uv: [uv[0], uv[1]], inflate, mirror };
}

function checkModel(value: unknown, image: CosmeticImage): CosmeticModel {
  const L = COSMETIC_LIMITS;
  const o = object(value, 'model');
  onlyKeys(o, 'model', ['textureSize', 'bones']);
  const textureSize = required(o, 'textureSize', 'model');
  if (!Array.isArray(textureSize) || textureSize.length !== 2 || textureSize[0] !== image.width || textureSize[1] !== image.height) {
    fail(`„model.textureSize“ muss genau die Größe der Textur sein ([${image.width}, ${image.height}])`);
  }
  const texture: [number, number] = [image.width, image.height];
  const rawBones = required(o, 'bones', 'model');
  if (!Array.isArray(rawBones) || rawBones.length < 1 || rawBones.length > L.bonesMax) fail(`„model.bones“ muss eine Liste mit 1 bis ${L.bonesMax} Bones sein`);
  const names = new Set<string>();
  const bones: CosmeticBone[] = [];
  let cubeCount = 0;
  rawBones.forEach((raw, i) => {
    const path = `model.bones[${i}]`;
    const b = object(raw, path);
    onlyKeys(b, path, ['name', 'parent', 'pivot', 'rotation', 'cubes']);
    const name = required(b, 'name', path);
    if (typeof name !== 'string' || !BONE_NAME_RE.test(name)) fail(`${q(sub(path, 'name'))} ist ungültig (1–24 Zeichen aus a–z, 0–9 und _)`);
    if (names.has(name)) fail(`${q(sub(path, 'name'))}: Den Bone „${name}“ gibt es schon`);
    let parent: string | null = null;
    if (has(b, 'parent')) {
      if (typeof b.parent !== 'string' || !names.has(b.parent)) {
        fail(`${q(sub(path, 'parent'))} muss der Name eines Bones sein, der vorher in der Liste steht`);
      }
      parent = b.parent;
    }
    const pivot = vec3(required(b, 'pivot', path), sub(path, 'pivot'), around(L.coordMax));
    const rotation: Vec3 = has(b, 'rotation') ? vec3(b.rotation, sub(path, 'rotation'), around(L.rotationMax)) : [0, 0, 0];
    const rawCubes = required(b, 'cubes', path);
    if (!Array.isArray(rawCubes)) fail(`${q(sub(path, 'cubes'))} muss eine Liste sein`);
    cubeCount += rawCubes.length;
    if (cubeCount > L.cubesMax) fail(`„model“ hat zu viele Würfel (höchstens ${L.cubesMax} insgesamt)`);
    const cubes = rawCubes.map((cube, j) => checkCube(cube, `${path}.cubes[${j}]`, texture));
    names.add(name);
    bones.push({ name, parent, pivot, rotation, cubes });
  });
  if (cubeCount === 0) fail('„model“ braucht mindestens einen Würfel');
  return { textureSize: texture, bones };
}

function checkAnimations(value: unknown, model: CosmeticModel): CosmeticAnimation[] {
  const L = COSMETIC_LIMITS;
  if (!Array.isArray(value) || value.length > L.animationsMax) fail(`„animations“ muss eine Liste mit höchstens ${L.animationsMax} Einträgen sein`);
  const bones = new Set(model.bones.map((b) => b.name));
  return value.map((raw, i) => {
    const path = `animations[${i}]`;
    const a = object(raw, path);
    onlyKeys(a, path, ['bone', 'type', 'axis', 'amplitude', 'speed', 'phase']);
    const bone = required(a, 'bone', path);
    if (typeof bone !== 'string' || !bones.has(bone)) fail(`${q(sub(path, 'bone'))} muss der Name eines Bones im Modell sein`);
    const type = oneOf(required(a, 'type', path), sub(path, 'type'), ANIMATION_TYPES);
    const axis = oneOf(required(a, 'axis', path), sub(path, 'axis'), ANIMATION_AXES);
    const amplitudeMax = type === 'bob' ? L.bobAmplitudeMax : L.amplitudeMax;
    // Bei spin zählt nur speed (Umdrehungen pro Sekunde); amplitude darf fehlen.
    const amplitude =
      type === 'spin' && !has(a, 'amplitude') ? 0 : number(required(a, 'amplitude', path), sub(path, 'amplitude'), 0, amplitudeMax);
    const speed = number(required(a, 'speed', path), sub(path, 'speed'), 0, L.speedMax);
    const phase = has(a, 'phase') ? number(a.phase, sub(path, 'phase'), 0, 1) : 0;
    return { bone, type, axis, amplitude, speed, phase };
  });
}

/**
 * Größe der Textur je Slot. head, back, companion, aura: 8–256 in Schritten von 8. cape: 64, 128 oder 256 breit, jedes
 * Bild halb so hoch wie breit (wie die Vorlage eines Minecraft-Capes, 64 × 32), alle Bilder untereinander.
 */
function checkTextureSize(slot: CosmeticSlot, image: CosmeticImage, cape: CosmeticCape | null, particles: CosmeticParticles | null): void {
  const L = COSMETIC_LIMITS;
  const { width, height } = image;
  if (cape !== null) {
    if (!L.capeWidths.includes(width) || height !== (width / 2) * cape.frames) {
      const sizes = L.capeWidths.map((w) => `${w} × ${(w / 2) * cape.frames}`);
      fail(
        `„texture“ muss für ein Cape mit ${cape.frames} Bildern ${sizes.slice(0, -1).join(', ')} oder ${sizes[sizes.length - 1]} Pixel groß sein ` +
          `(Breite ${L.capeWidths.slice(0, -1).join(', ')} oder ${L.capeWidths[L.capeWidths.length - 1]}, jedes Bild halb so hoch wie breit; ist ${width} × ${height})`,
      );
    }
    return;
  }
  const fits = (v: number) => v >= L.textureMin && v <= L.textureMax && v % L.textureStep === 0;
  if (!fits(width) || !fits(height)) {
    fail(`„texture“ muss ${L.textureMin} bis ${L.textureMax} Pixel breit und hoch sein, jeweils ein Vielfaches von ${L.textureStep} (ist ${width} × ${height})`);
  }
  if (slot === 'aura' && particles !== null && width !== height * particles.frames) {
    fail(`„texture“ muss ${particles.frames} quadratische Bilder nebeneinander enthalten (Breite = Höhe × ${particles.frames}; ist ${width} × ${height})`);
  }
}

/**
 * Prüft den Inhalt eines Cosmetic-Manifests (das geparste JSON) nach Format 1. Liefert das Manifest mit Standardwerten
 * für fehlende freiwillige Felder oder einen deutschen Hinweis, was nicht stimmt (der erste Fehler).
 */
export function checkCosmeticManifest(value: unknown): CosmeticManifest | string {
  try {
    return check(value);
  } catch (err) {
    if (err instanceof Problem) return err.message;
    throw err;
  }
}

function check(value: unknown): CosmeticManifest {
  const L = COSMETIC_LIMITS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Das Manifest ist kein JSON-Objekt');
  const m = value as Record<string, unknown>;
  if (m.type !== COSMETIC_TYPE) fail(`„type“ muss „${COSMETIC_TYPE}“ sein`);
  if (m.format !== COSMETIC_FORMAT) fail(`„format“ muss ${COSMETIC_FORMAT} sein`);
  onlyKeys(m, '', MANIFEST_KEYS);
  const id = m.id;
  if (typeof id !== 'string' || !COSMETIC_ID_RE.test(id)) fail('„id“ ist ungültig (1–32 Zeichen aus a–z, 0–9 und -, ohne - am Anfang oder Ende)');
  if (BUILTIN_CAPE_IDS.includes(id)) fail(`„id“ darf nicht die ID eines eingebauten Capes sein (${BUILTIN_CAPE_IDS.join(', ')})`);
  const version = integer(m.version, 'version', 1, L.versionMax);
  const slot = oneOf(m.slot, 'slot', COSMETIC_SLOTS);
  const name = text(m.name, 'name', 1, L.nameMax);
  const description = text(m.description, 'description', 0, L.descriptionMax);
  const access = oneOf(m.access, 'access', COSMETIC_ACCESS);
  if (!isIsoDate(m.date)) fail('„date“ ist kein gültiges Datum nach ISO 8601 (z. B. 2026-11-26T12:00:00.000Z)');
  const date = m.date;

  if (!has(m, 'texture')) fail('„texture“ fehlt');
  const image = png(m.texture, 'texture');
  let glow: string | null = null;
  if (has(m, 'glow')) {
    const glowImage = png(m.glow, 'glow');
    if (glowImage.width !== image.width || glowImage.height !== image.height) {
      fail(`„glow“ muss genauso groß sein wie „texture“ (${image.width} × ${image.height}; ist ${glowImage.width} × ${glowImage.height})`);
    }
    glow = m.glow as string;
  }

  // Welche Teile zu welchem Slot gehören: Pflicht oder verboten.
  const needs: Record<'model' | 'particles' | 'cape' | 'companion', boolean> = {
    model: MODEL_SLOTS.includes(slot),
    particles: slot === 'aura',
    cape: slot === 'cape',
    companion: slot === 'companion',
  };
  for (const key of ['model', 'particles', 'cape', 'companion'] as const) {
    if (needs[key] && !has(m, key)) fail(`„${key}“ fehlt (Pflicht für den Slot ${slot})`);
    if (!needs[key] && has(m, key)) fail(`„${key}“ gibt es beim Slot ${slot} nicht`);
  }
  if (!needs.model && has(m, 'animations')) fail(`„animations“ gibt es nur mit „model“ (nicht beim Slot ${slot})`);

  const cape = needs.cape ? checkCape(m.cape) : null;
  const particles = needs.particles ? checkParticles(m.particles) : null;
  const companion = needs.companion ? checkCompanion(m.companion) : null;
  checkTextureSize(slot, image, cape, particles);
  const model = needs.model ? checkModel(m.model, image) : null;
  const animations = model !== null && has(m, 'animations') ? checkAnimations(m.animations, model) : [];

  return {
    type: COSMETIC_TYPE,
    format: COSMETIC_FORMAT,
    id,
    version,
    slot,
    name,
    description,
    access,
    date,
    texture: m.texture as string,
    image,
    glow,
    model,
    animations,
    particles,
    cape,
    companion,
  };
}

/** Manifest-Text lesen und prüfen (der Text muss vorher mit seiner Signatur geprüft sein). */
export function parseCosmeticManifest(manifest: string): CosmeticManifest | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return '„manifest“ ist kein gültiges JSON';
  }
  return checkCosmeticManifest(parsed);
}

/**
 * Prüft die Form eines Umschlags `{ manifest, signature }` (ohne Kryptografie): beide als Text, Manifest höchstens
 * 160 KB (UTF-8) ohne einzelne Ersatzzeichen, Signatur als kanonisches Base64 von 64 Byte, der Umschlag wie
 * ausgeliefert höchstens 192 KB. Zusatzfelder im Umschlag werden ignoriert.
 */
export function checkCosmeticEnvelope(value: unknown): CosmeticEnvelope | string {
  const L = COSMETIC_LIMITS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Der Umschlag ist kein JSON-Objekt';
  const { manifest, signature } = value as Record<string, unknown>;
  if (typeof manifest !== 'string' || manifest === '') return '„manifest“ fehlt oder ist kein Text';
  if (typeof signature !== 'string' || signature === '') return '„signature“ fehlt oder ist kein Text';
  if (LONE_SURROGATE_RE.test(manifest)) return '„manifest“ enthält ungültige Zeichen';
  if (utf8Length(manifest) > L.manifestBytes) return `„manifest“ ist zu groß (höchstens ${L.manifestBytes / 1024} KB)`;
  if (!SIGNATURE_RE.test(signature)) return '„signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen)';
  if (utf8Length(cosmeticEnvelopeText({ manifest, signature })) > L.envelopeBytes) {
    return `Der Umschlag ist zu groß (höchstens ${L.envelopeBytes / 1024} KB)`;
  }
  return { manifest, signature };
}
