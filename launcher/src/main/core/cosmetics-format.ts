// Heldix-Cosmetics (Format 1 und 2): signierter Umschlag und strenge Prüfung des Manifests.
//
// Ein Cosmetic ist reine Daten (Modell, Textur, Partikel), kein Code. Das Team signiert es mit dem Update-Schlüssel:
// Ed25519 über die UTF-8-Bytes von "heldix-cosmetic\n" + Manifest-Text (Domänentrennung zu Addons und Launcher-Updates).
// Dienst, Spiel, Launcher und Webseite prüfen dieselben Regeln. Deshalb ist diese Datei eigenständig: keine anderen
// Module, kein Node-Buffer, nur Standard-JavaScript (atob, btoa). Launcher und Webseite können sie übernehmen, das Spiel
// baut sie in Java nach. Die Signatur prüft der Aufrufer selbst (cosmeticSignedText liefert den signierten Text).
//
// Format 1: Quader-Modelle mit einfachen Animationen (flap, sway, spin, bob), Partikel-Auren, Capes.
// Format 2 (ab Launcher 0.13.8, Dienst 1.12.0): Dreiecks-Mesh mit Knochen und Keyframe-Animationen, Zustände,
//   Partikel an Knochen, Leucht-Streifen. Zahlenlisten stehen als Base64 kleiner Ganzzahlen im Manifest (siehe
//   checkFormat2 und die Dekodier-Hilfen decodeCosmeticMesh / decodeCosmeticTrack).
// Ältere Clients kennen nur Format 1 und verwerfen Format-2-Einträge einzeln.
// Alle Grenzen stehen in COSMETIC_LIMITS (Format 1) und COSMETIC_LIMITS_2 (Format 2); docs/dienst.md beschreibt sie.

/** Steht vor dem Manifest-Text, wenn signiert wird. */
export const COSMETIC_SIGNATURE_PREFIX = 'heldix-cosmetic\n';
export const COSMETIC_TYPE = 'heldix-cosmetic';
export const COSMETIC_FORMAT = 1;
/** Meshes mit Keyframe-Animationen */
export const COSMETIC_FORMAT_2 = 2;
export const COSMETIC_FORMATS = [COSMETIC_FORMAT, COSMETIC_FORMAT_2] as const;
export type CosmeticFormat = (typeof COSMETIC_FORMATS)[number];

export const COSMETIC_SLOTS = ['head', 'back', 'aura', 'companion', 'cape'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];
/** Slots mit Modell (und damit mit Animationen). */
export const MODEL_SLOTS: readonly CosmeticSlot[] = ['head', 'back', 'companion'];
/** Slots, die Format 2 kennt (kein Cape). */
export const MESH_SLOTS = ['head', 'back', 'aura', 'companion'] as const;
export type MeshSlot = (typeof MESH_SLOTS)[number];
export const COSMETIC_ACCESS = ['all', 'team', 'unlock'] as const;
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
export const BUILTIN_CAPE_IDS: readonly string[] = [
  'heldix',
  'mitternacht',
  'aurora',
  'glut',
  'kristall',
  'neon',
  'sakura',
  'gewitter',
  'galaxie',
  'matrix',
  'matrix_rot',
  'matrix_tuerkis',
  'sakura_orange',
];

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
  /** head, back, aura, companion: Breite und Höhe je 8–512, Vielfache von 8 */
  textureMin: 8,
  textureMax: 512,
  textureStep: 8,
  /** cape: 64, 128 oder 256 breit, je Bild halb so hoch wie breit, Bilder untereinander */
  capeWidths: Object.freeze([64, 128, 256]) as readonly number[],
  capeFramesMax: 32,
  capeFpsMax: 20,
  bonesMax: 64,
  cubesMax: 128,
  /**
   * Auflösungen der Textur eines Modells: Das PNG ist model.textureSize mal 1, 2 oder 4 (gleich in beiden Richtungen).
   * UV und Box-UV zählen in Texeln von textureSize.
   */
  textureScales: Object.freeze([1, 2, 4]) as readonly number[],
  /** model.scale (freiwillig, fehlt: 1): Größe des ganzen Modells um den Anker */
  modelScaleMin: 0.25,
  modelScaleMax: 1.5,
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

/**
 * Alle Grenzen von Format 2 (Byte-Angaben: 1 KB = 1024 Byte). Ganzzahlen in den Base64-Listen: Positionen und move
 * in 1/32 Pixel (Int16), Normalen × 127 (Int8), UV ÷ 65535 (Uint16), Quaternionen × 32767 (Int16), scale ÷ 1000
 * (Uint16), Gewichte ÷ 255 (Uint8).
 */
export const COSMETIC_LIMITS_2 = Object.freeze({
  /** Manifest-Text (UTF-8) */
  manifestBytes: 512 * 1024,
  /** Umschlag `{ manifest, signature }` als JSON (wie ausgeliefert) */
  envelopeBytes: 544 * 1024,
  /** je PNG (texture, glow), dekodiert */
  pngBytes: 64 * 1024,
  /** texture: Breite und Höhe je eine Zweierpotenz von 16 bis 512 */
  textureMin: 16,
  textureMax: 512,
  verticesMax: 16384,
  trianglesMax: 16384,
  bonesMax: 96,
  boneNameMax: 32,
  /** pivot und tail der Knochen: je Achse von -1024 bis 1024 Pixel */
  coordMax: 1024,
  /** attach.origin (Begleiter): je Achse von -64 bis 64 Pixel */
  originMax: 64,
  animationsMax: 16,
  fpsMax: 60,
  framesMax: 1200,
  emissiveFramesMax: 16,
  frametimeTicksMax: 20,
  pulsePeriodMin: 0.1,
  pulsePeriodMax: 20,
  blendSecondsMax: 1,
  particlesMax: 16,
  perSecondMin: 0.1,
  perSecondMax: 20,
  /** Länge eines Quaternions (÷ 32767) darf so weit von 1 abweichen */
  quaternionTolerance: 0.01,
  positionUnit: 32,
  normalUnit: 127,
  uvUnit: 65535,
  rotationUnit: 32767,
  scaleUnit: 1000,
  weightUnit: 255,
  /** Einflüsse je Vertex bei weicher Haut (mesh.joints, mesh.weights) */
  influences: 4,
});

/** Größte Grenzen über alle Formate: für Anfragekörper und Downloads, bevor das Format bekannt ist. */
export const COSMETIC_MAX_MANIFEST_BYTES = Math.max(COSMETIC_LIMITS.manifestBytes, COSMETIC_LIMITS_2.manifestBytes);
export const COSMETIC_MAX_ENVELOPE_BYTES = Math.max(COSMETIC_LIMITS.envelopeBytes, COSMETIC_LIMITS_2.envelopeBytes);

/** Spielerzustände in `states` (Format 2); `idle` ist Pflicht. */
export const COSMETIC_STATES = [
  'idle',
  'walk',
  'sneak',
  'sit_or_ride',
  'swim',
  'sprint',
  'elytra',
  'jump',
  'fall',
  'creative_fly',
  'start_flying',
  'land',
  'hurt',
  'emote',
  'celebrate',
  'afk',
  'sleep',
  'enable',
  'disable',
  'summon',
] as const;
export type CosmeticState = (typeof COSMETIC_STATES)[number];

/** Minecraft-Partikel (ohne „minecraft:“; im Manifest mit oder ohne) für Format 2. Alle ohne Parameter außer dust. */
export const COSMETIC_PARTICLE_IDS = [
  'flame',
  'small_flame',
  'soul_fire_flame',
  'smoke',
  'end_rod',
  'electric_spark',
  'dust',
  'heart',
  'note',
  'happy_villager',
  'cloud',
  'poof',
  'snowflake',
  'spore_blossom_air',
  'crit',
  'enchant',
  'portal',
  'witch',
  'glow',
  'falling_water',
  'dripping_water',
  'firework',
  'cherry_leaves',
  'ash',
  'white_ash',
  'soul',
  'sculk_soul',
  'lava',
  'falling_spore_blossom',
  'wax_on',
  'wax_off',
  'bubble_pop',
  'composter',
  'totem_of_undying',
  'reverse_portal',
] as const;
export type CosmeticParticleId = (typeof COSMETIC_PARTICLE_IDS)[number];
export const PARTICLE_ANCHORS = ['pivot', 'tail'] as const;
export const ATTACH_SIDES = ['left', 'right'] as const;
/** Knochen in Format 2: 1–32 Zeichen aus A–Z, a–z, 0–9, _, . und - (Blender-Namen wie „wing.L“). */
export const MESH_BONE_NAME_RE = /^[A-Za-z0-9_.-]{1,32}$/;
export const ANIMATION_NAME_RE = /^[A-Za-z0-9_]{1,24}$/;

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
  /** Größe der Textur in Texeln (UV-Raum); das PNG ist 1-, 2- oder 4-mal so groß */
  textureSize: [number, number];
  /** Größe des ganzen Modells um den Anker (Ursprung), über den Bone-Matrizen; fehlt es, 1 */
  scale: number;
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

// ---------- Format 2 ----------

/** Leucht-Streifen: `frames` Bilder untereinander, je `frametimeTicks` Ticks lang, mit Puls. */
export interface CosmeticEmissive {
  frames: number;
  frametimeTicks: number;
  /** Intensität = min + (max − min) · (0,5 + 0,5 · sin(2π · t / period)), t in Sekunden */
  pulse: { period: number; min: number; max: number };
}

/** Das Mesh wie im Manifest (Base64); dekodiert mit decodeCosmeticMesh. */
export interface CosmeticMesh {
  vertexCount: number;
  triangleCount: number;
  /** Int16LE × 3N, 1/32 Pixel */
  positions: string;
  /** Int8 × 3N, × 127 */
  normals: string;
  /** Uint16LE × 2N, ÷ 65535, v = 0 oben */
  uvs: string;
  /** Uint8 × N: ein Knochen je Vertex (bei weicher Haut der mit dem größten Gewicht) */
  bones: string;
  /** Uint16LE × 3T */
  triangles: string;
  /** weiche Haut (freiwillig, nur mit weights): Uint8 × 4N Knochen */
  joints: string | null;
  /** weiche Haut (freiwillig, nur mit joints): Uint8 × 4N Gewichte, Summe je Vertex 255 */
  weights: string | null;
}

export interface CosmeticMeshBone {
  name: string;
  /** Index des Eltern-Knochens (kleiner als der eigene) oder -1 */
  parent: number;
  pivot: Vec3;
  tail: Vec3;
}

/** Keys einer Spur (Base64) und ihre Anzahl. */
export interface CosmeticKeys {
  /** Uint16LE: Frame-Nummern, erste 0, streng aufsteigend, < frames */
  keys: string;
  /** rot: Int16LE × 4 je Key (x, y, z, w × 32767); move: Int16LE × 3 (1/32 Pixel); scale: Uint16LE × 1 (÷ 1000) */
  values: string;
  count: number;
}

export interface CosmeticTrack {
  bone: number;
  rot: CosmeticKeys | null;
  move: CosmeticKeys | null;
  scale: CosmeticKeys | null;
}

export interface CosmeticClip {
  fps: number;
  frames: number;
  loop: boolean;
  tracks: CosmeticTrack[];
}

/** Zustand → Animation (idle Pflicht) und die Überblendzeit in Sekunden. */
export type CosmeticStates = { blendSeconds: number; idle: string } & { [K in CosmeticState]?: string };

export interface CosmeticMeshParticle {
  bone: number;
  at: (typeof PARTICLE_ANCHORS)[number];
  /** Minecraft-ID ohne „minecraft:“ */
  particle: CosmeticParticleId;
  perSecond: number;
  /** nur bei dust (sonst null) */
  color: string | null;
  /** nur in diesen Animationen; null = immer */
  states: string[] | null;
}

/** Begleiter: Ursprung im Body-Raum (Pixel); Positionen, pivot und tail zählen relativ dazu. */
export interface CosmeticAttach {
  origin: Vec3;
  side: (typeof ATTACH_SIDES)[number];
}

/** Das geprüfte Manifest von Format 2 (Zahlenlisten weiter als Base64, siehe decodeCosmeticMesh/decodeCosmeticTrack). */
export interface CosmeticManifest2 {
  type: typeof COSMETIC_TYPE;
  format: typeof COSMETIC_FORMAT_2;
  id: string;
  version: number;
  slot: MeshSlot;
  name: string;
  description: string;
  access: CosmeticAccess;
  date: string;
  texture: string;
  image: CosmeticImage;
  glow: string | null;
  emissive: CosmeticEmissive | null;
  mesh: CosmeticMesh;
  bones: CosmeticMeshBone[];
  animations: Record<string, CosmeticClip>;
  states: CosmeticStates;
  particles: CosmeticMeshParticle[];
  /** nur beim Slot companion (Standard: Ursprung 0, links), sonst null */
  attach: CosmeticAttach | null;
}

/** Ein geprüftes Manifest beliebigen Formats (an `format` unterscheiden). */
export type AnyCosmeticManifest = CosmeticManifest | CosmeticManifest2;

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
const MANIFEST_KEYS_2 = [
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
  'emissive',
  'mesh',
  'bones',
  'animations',
  'states',
  'particles',
  'attach',
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

// ---------- Zahlenlisten (Format 2): Base64 ↔ typisierte Listen, little-endian ----------

/** Bytes als Standard-Base64 (mit „=“ am Ende). */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function int16Bytes(values: ArrayLike<number>): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! & 0xffff;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = v >> 8;
  }
  return bytes;
}

/** Uint8-Werte (0–255) als Base64. */
export const encodeUint8 = (values: ArrayLike<number>): string => encodeBase64(Uint8Array.from(values as ArrayLike<number>));
/** Int8-Werte (−128–127) als Base64. */
export const encodeInt8 = (values: ArrayLike<number>): string => encodeBase64(new Uint8Array(Int8Array.from(values as ArrayLike<number>).buffer));
/** Int16-Werte als Base64 (little-endian). */
export const encodeInt16LE = (values: ArrayLike<number>): string => encodeBase64(int16Bytes(values));
/** Uint16-Werte als Base64 (little-endian). */
export const encodeUint16LE = (values: ArrayLike<number>): string => encodeBase64(int16Bytes(values));

/** Base64 → Uint8; null bei ungültigem Base64. */
export const decodeUint8 = (text: string): Uint8Array | null => decodeBase64(text);

/** Base64 → Int8; null bei ungültigem Base64. */
export function decodeInt8(text: string): Int8Array | null {
  const bytes = decodeBase64(text);
  return bytes === null ? null : new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

/** Base64 → Uint16 (little-endian); null bei ungültigem Base64 oder ungerader Byte-Zahl. */
export function decodeUint16LE(text: string): Uint16Array | null {
  const bytes = decodeBase64(text);
  if (bytes === null || bytes.length % 2 !== 0) return null;
  const out = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
  return out;
}

/** Base64 → Int16 (little-endian); null bei ungültigem Base64 oder ungerader Byte-Zahl. */
export function decodeInt16LE(text: string): Int16Array | null {
  const words = decodeUint16LE(text);
  return words === null ? null : new Int16Array(words.buffer);
}

/** Das Mesh eines geprüften Manifests (Format 2) als Ganzzahl-Listen in den Einheiten von COSMETIC_LIMITS_2. */
export interface CosmeticMeshData {
  vertexCount: number;
  triangleCount: number;
  /** × 3, 1/32 Pixel */
  positions: Int16Array;
  /** × 3, ÷ 127 */
  normals: Int8Array;
  /** × 2, ÷ 65535 */
  uvs: Uint16Array;
  /** × 1 */
  bones: Uint8Array;
  /** × 3 */
  triangles: Uint16Array;
  /** × 4 oder null (starr) */
  joints: Uint8Array | null;
  /** × 4, Summe 255, oder null (starr) */
  weights: Uint8Array | null;
}

/** Dekodiert das (geprüfte) Mesh; wirft, wenn es nicht geprüft war. */
export function decodeCosmeticMesh(mesh: CosmeticMesh): CosmeticMeshData {
  const need = <T>(value: T | null): T => {
    if (value === null) throw new Error('Das Mesh ist nicht geprüft (ungültiges Base64)');
    return value;
  };
  return {
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    positions: need(decodeInt16LE(mesh.positions)),
    normals: need(decodeInt8(mesh.normals)),
    uvs: need(decodeUint16LE(mesh.uvs)),
    bones: need(decodeUint8(mesh.bones)),
    triangles: need(decodeUint16LE(mesh.triangles)),
    joints: mesh.joints === null ? null : need(decodeUint8(mesh.joints)),
    weights: mesh.weights === null ? null : need(decodeUint8(mesh.weights)),
  };
}

/** Eine Spur als Ganzzahl-Listen (keys = Frame-Nummern). */
export interface CosmeticTrackData {
  bone: number;
  rot: { keys: Uint16Array; values: Int16Array } | null;
  move: { keys: Uint16Array; values: Int16Array } | null;
  scale: { keys: Uint16Array; values: Uint16Array } | null;
}

/** Dekodiert eine (geprüfte) Spur; wirft, wenn sie nicht geprüft war. */
export function decodeCosmeticTrack(track: CosmeticTrack): CosmeticTrackData {
  const keys = (k: CosmeticKeys) => {
    const value = decodeUint16LE(k.keys);
    if (value === null) throw new Error('Die Spur ist nicht geprüft (ungültiges Base64)');
    return value;
  };
  const signed = (k: CosmeticKeys | null) => {
    if (k === null) return null;
    const values = decodeInt16LE(k.values);
    if (values === null) throw new Error('Die Spur ist nicht geprüft (ungültiges Base64)');
    return { keys: keys(k), values };
  };
  let scale: CosmeticTrackData['scale'] = null;
  if (track.scale !== null) {
    const values = decodeUint16LE(track.scale.values);
    if (values === null) throw new Error('Die Spur ist nicht geprüft (ungültiges Base64)');
    scale = { keys: keys(track.scale), values };
  }
  return { bone: track.bone, rot: signed(track.rot), move: signed(track.move), scale };
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

/** Nur bekannte Felder (kein Format kennt Zusatzfelder). */
function onlyKeys(o: Record<string, unknown>, path: string, allowed: readonly string[], format: CosmeticFormat = COSMETIC_FORMAT): void {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(`${q(sub(path, key))} ist kein bekanntes Feld (Format ${format})`);
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
function png(value: unknown, path: string, maxBytes = COSMETIC_LIMITS.pngBytes): CosmeticImage {
  if (typeof value !== 'string' || !value.startsWith(PNG_DATA_URL_PREFIX)) fail(`${q(path)} muss eine data-URL „${PNG_DATA_URL_PREFIX}…“ sein`);
  const base64 = value.slice(PNG_DATA_URL_PREFIX.length);
  const tooLarge = `${q(path)} ist zu groß (höchstens ${maxBytes / 1024} KB als PNG)`;
  if (base64.length > Math.ceil(maxBytes / 3) * 4) fail(tooLarge);
  const bytes = decodeBase64(base64);
  if (bytes === null) fail(`${q(path)} enthält kein gültiges Base64`);
  if (bytes.length > maxBytes) fail(tooLarge);
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

/** Würfel: Box-UV wie bei Minecraft, Fläche (2d+2w) × (d+h) ab `uv`, muss in die Textur passen (in Texeln von textureSize). */
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
  onlyKeys(o, 'model', ['textureSize', 'scale', 'bones']);
  // textureSize = Größe in Texeln (UV-Raum); das PNG hat die 1-, 2- oder 4-fache Auflösung davon
  const rawSize = required(o, 'textureSize', 'model');
  const size = Array.isArray(rawSize) && rawSize.length === 2 ? rawSize : null;
  const k = size === null ? undefined : L.textureScales.find((f) => size[0] === image.width / f && size[1] === image.height / f);
  if (k === undefined) {
    const sizes = L.textureScales.map((f) => `[${image.width / f}, ${image.height / f}]`);
    const scales = L.textureScales.map(String);
    fail(
      `„model.textureSize“ muss die Größe der Textur in Texeln sein (${sizes.slice(0, -1).join(', ')} oder ${sizes[sizes.length - 1]}: ` +
        `Textur in ${scales.slice(0, -1).join('-, ')}- oder ${scales[scales.length - 1]}-facher Auflösung)`,
    );
  }
  const texture: [number, number] = [image.width / k, image.height / k];
  const scale = has(o, 'scale') ? number(o.scale, 'model.scale', L.modelScaleMin, L.modelScaleMax) : 1;
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
  return { textureSize: texture, scale, bones };
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
 * Größe der Textur je Slot. head, back, companion, aura: 8–512 in Schritten von 8. cape: 64, 128 oder 256 breit, jedes
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
 * Prüft den Inhalt eines Cosmetic-Manifests (das geparste JSON) nach Format 1 oder 2 (je nach `format`). Liefert das
 * Manifest mit Standardwerten für fehlende freiwillige Felder oder einen deutschen Hinweis, was nicht stimmt (der
 * erste Fehler). Die Größe des Manifest-Texts prüft parseCosmeticManifest.
 */
export function checkCosmeticManifest(value: unknown): AnyCosmeticManifest | string {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Das Manifest ist kein JSON-Objekt');
    const m = value as Record<string, unknown>;
    if (m.type !== COSMETIC_TYPE) fail(`„type“ muss „${COSMETIC_TYPE}“ sein`);
    if (m.format === COSMETIC_FORMAT_2) return checkFormat2(m);
    if (m.format !== COSMETIC_FORMAT) fail(`„format“ muss ${COSMETIC_FORMATS.join(' oder ')} sein`);
    return check(m);
  } catch (err) {
    if (err instanceof Problem) return err.message;
    throw err;
  }
}

/** Kopf beider Formate: id, version, slot, name, description, access, date. */
function checkHead<S extends CosmeticSlot>(m: Record<string, unknown>, slots: readonly S[]) {
  const L = COSMETIC_LIMITS;
  const id = m.id;
  if (typeof id !== 'string' || !COSMETIC_ID_RE.test(id)) fail('„id“ ist ungültig (1–32 Zeichen aus a–z, 0–9 und -, ohne - am Anfang oder Ende)');
  if (BUILTIN_CAPE_IDS.includes(id)) fail(`„id“ darf nicht die ID eines eingebauten Capes sein (${BUILTIN_CAPE_IDS.join(', ')})`);
  const version = integer(m.version, 'version', 1, L.versionMax);
  const slot = oneOf(m.slot, 'slot', slots);
  const name = text(m.name, 'name', 1, L.nameMax);
  const description = text(m.description, 'description', 0, L.descriptionMax);
  const access = oneOf(m.access, 'access', COSMETIC_ACCESS);
  if (!isIsoDate(m.date)) fail('„date“ ist kein gültiges Datum nach ISO 8601 (z. B. 2026-11-26T12:00:00.000Z)');
  return { id, version, slot, name, description, access, date: m.date };
}

/** Format 1 (type und format sind schon geprüft). */
function check(m: Record<string, unknown>): CosmeticManifest {
  onlyKeys(m, '', MANIFEST_KEYS);
  const { id, version, slot, name, description, access, date } = checkHead(m, COSMETIC_SLOTS);

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

// ---------- Format 2: Mesh mit Keyframe-Animationen ----------

const isPowerOfTwo = (v: number) => v > 0 && (v & (v - 1)) === 0;
const u16 = (bytes: Uint8Array, i: number) => bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
const s16 = (bytes: Uint8Array, i: number) => (u16(bytes, i) << 16) >> 16;

/** Base64 mit genau `count` Werten zu je `size` Byte (Länge passend, strenges Base64); liefert die Bytes. */
function packed(value: unknown, path: string, count: number, size: 1 | 2, what: string): Uint8Array {
  const bytes = count * size;
  const chars = Math.ceil(bytes / 3) * 4;
  if (typeof value !== 'string') fail(`${q(path)} fehlt oder ist kein Text (Base64)`);
  if (value.length !== chars) fail(`${q(path)} muss genau ${count} ${what} als Base64 enthalten (${chars} Zeichen, nicht ${value.length})`);
  const decoded = decodeBase64(value);
  if (decoded === null || decoded.length !== bytes) fail(`${q(path)} enthält kein gültiges Base64 (erwartet ${bytes} Byte)`);
  return decoded;
}

function checkEmissive(value: unknown): CosmeticEmissive {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'emissive');
  onlyKeys(o, 'emissive', ['frames', 'frametimeTicks', 'pulse'], COSMETIC_FORMAT_2);
  const frames = integer(required(o, 'frames', 'emissive'), 'emissive.frames', 1, L.emissiveFramesMax);
  const frametimeTicks = integer(required(o, 'frametimeTicks', 'emissive'), 'emissive.frametimeTicks', 1, L.frametimeTicksMax);
  const p = object(required(o, 'pulse', 'emissive'), 'emissive.pulse');
  onlyKeys(p, 'emissive.pulse', ['period', 'min', 'max'], COSMETIC_FORMAT_2);
  const period = number(required(p, 'period', 'emissive.pulse'), 'emissive.pulse.period', L.pulsePeriodMin, L.pulsePeriodMax);
  const min = number(required(p, 'min', 'emissive.pulse'), 'emissive.pulse.min', 0, 1);
  const max = number(required(p, 'max', 'emissive.pulse'), 'emissive.pulse.max', 0, 1);
  if (min > max) fail('„emissive.pulse.min“ darf nicht größer sein als „emissive.pulse.max“');
  return { frames, frametimeTicks, pulse: { period, min, max } };
}

/** Knochen: Eltern zuerst (parent -1 oder ein kleinerer Index), Namen eindeutig. */
function checkMeshBones(value: unknown): CosmeticMeshBone[] {
  const L = COSMETIC_LIMITS_2;
  if (!Array.isArray(value) || value.length < 1 || value.length > L.bonesMax) fail(`„bones“ muss eine Liste mit 1 bis ${L.bonesMax} Knochen sein`);
  const names = new Set<string>();
  return value.map((raw, i) => {
    const path = `bones[${i}]`;
    const b = object(raw, path);
    onlyKeys(b, path, ['name', 'parent', 'pivot', 'tail'], COSMETIC_FORMAT_2);
    const name = required(b, 'name', path);
    if (typeof name !== 'string' || !MESH_BONE_NAME_RE.test(name)) {
      fail(`${q(sub(path, 'name'))} ist ungültig (1–${L.boneNameMax} Zeichen aus A–Z, a–z, 0–9, _, . und -)`);
    }
    if (names.has(name)) fail(`${q(sub(path, 'name'))}: Den Knochen „${name}“ gibt es schon`);
    names.add(name);
    const parent = required(b, 'parent', path);
    if (typeof parent !== 'number' || !Number.isInteger(parent) || parent < -1 || parent >= i) {
      fail(
        i === 0
          ? `${q(sub(path, 'parent'))} muss -1 sein (der erste Knochen hat keinen Eltern-Knochen)`
          : `${q(sub(path, 'parent'))} muss -1 (kein Eltern-Knochen) oder der Index eines Knochens davor sein (0 bis ${i - 1})`,
      );
    }
    const pivot = vec3(required(b, 'pivot', path), sub(path, 'pivot'), around(L.coordMax));
    const tail = vec3(required(b, 'tail', path), sub(path, 'tail'), around(L.coordMax));
    return { name, parent, pivot, tail };
  });
}

const MESH_KEYS = ['vertexCount', 'triangleCount', 'positions', 'normals', 'uvs', 'bones', 'triangles', 'joints', 'weights'];

/** Mesh: Längen passend zu N und T, Indizes < N, Knochen gültig; weiche Haut (joints/weights) freiwillig. */
function checkMesh(value: unknown, boneCount: number): CosmeticMesh {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'mesh');
  onlyKeys(o, 'mesh', MESH_KEYS, COSMETIC_FORMAT_2);
  const n = integer(required(o, 'vertexCount', 'mesh'), 'mesh.vertexCount', 1, L.verticesMax);
  const t = integer(required(o, 'triangleCount', 'mesh'), 'mesh.triangleCount', 1, L.trianglesMax);
  packed(required(o, 'positions', 'mesh'), 'mesh.positions', 3 * n, 2, `Int16-Werte (3 je Vertex, ${n} Vertices)`);
  packed(required(o, 'normals', 'mesh'), 'mesh.normals', 3 * n, 1, `Int8-Werte (3 je Vertex, ${n} Vertices)`);
  packed(required(o, 'uvs', 'mesh'), 'mesh.uvs', 2 * n, 2, `Uint16-Werte (2 je Vertex, ${n} Vertices)`);
  const bones = packed(required(o, 'bones', 'mesh'), 'mesh.bones', n, 1, 'Knochen-Indizes (Uint8, 1 je Vertex)');
  for (let v = 0; v < n; v++) {
    if (bones[v]! >= boneCount) fail(`„mesh.bones“: Vertex ${v} nennt den Knochen ${bones[v]}, es gibt nur ${boneCount} (0 bis ${boneCount - 1})`);
  }
  const triangles = packed(required(o, 'triangles', 'mesh'), 'mesh.triangles', 3 * t, 2, `Vertex-Indizes (Uint16, 3 je Dreieck, ${t} Dreiecke)`);
  for (let i = 0; i < 3 * t; i++) {
    const index = u16(triangles, i);
    if (index >= n) fail(`„mesh.triangles“: Dreieck ${Math.floor(i / 3)} nennt den Vertex ${index}, es gibt nur ${n} (0 bis ${n - 1})`);
  }
  let joints: string | null = null;
  let weights: string | null = null;
  if (has(o, 'joints') !== has(o, 'weights')) {
    fail(has(o, 'joints') ? '„mesh.weights“ fehlt (Pflicht mit „mesh.joints“)' : '„mesh.joints“ fehlt (Pflicht mit „mesh.weights“)');
  }
  if (has(o, 'joints')) {
    const k = L.influences;
    const j = packed(o.joints, 'mesh.joints', k * n, 1, `Knochen-Indizes (Uint8, ${k} je Vertex)`);
    const w = packed(o.weights, 'mesh.weights', k * n, 1, `Gewichte (Uint8, ${k} je Vertex)`);
    for (let v = 0; v < n; v++) {
      let sum = 0;
      let max = 0;
      for (let i = v * k; i < v * k + k; i++) {
        if (j[i]! >= boneCount) fail(`„mesh.joints“: Vertex ${v} nennt den Knochen ${j[i]}, es gibt nur ${boneCount} (0 bis ${boneCount - 1})`);
        sum += w[i]!;
        max = Math.max(max, w[i]!);
      }
      if (sum !== L.weightUnit) fail(`„mesh.weights“: Die Gewichte von Vertex ${v} ergeben ${sum} statt ${L.weightUnit}`);
      let main = false;
      for (let i = v * k; i < v * k + k; i++) if (j[i] === bones[v] && w[i] === max) main = true;
      if (!main) fail(`„mesh.bones“: Vertex ${v} muss den Knochen mit dem größten Gewicht aus „mesh.joints“ nennen`);
    }
    joints = o.joints as string;
    weights = o.weights as string;
  }
  return {
    vertexCount: n,
    triangleCount: t,
    positions: o.positions as string,
    normals: o.normals as string,
    uvs: o.uvs as string,
    bones: o.bones as string,
    triangles: o.triangles as string,
    joints,
    weights,
  };
}

const KEY_VALUES = { rot: 4, move: 3, scale: 1 } as const;
const KEY_WHAT = { rot: 'Int16-Werte (x, y, z, w je Key)', move: 'Int16-Werte (x, y, z je Key)', scale: 'Uint16-Werte (einer je Key)' } as const;

/** Keys einer Spur: Frame-Nummern (erste 0, streng aufsteigend, < frames) und passend viele Werte. */
function checkKeys(value: unknown, path: string, frames: number, kind: keyof typeof KEY_VALUES): CosmeticKeys {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, path);
  onlyKeys(o, path, ['keys', 'values'], COSMETIC_FORMAT_2);
  const keysPath = sub(path, 'keys');
  const rawKeys = required(o, 'keys', path);
  const keyBytes = typeof rawKeys === 'string' ? decodeBase64(rawKeys) : null;
  if (keyBytes === null || keyBytes.length % 2 !== 0) fail(`${q(keysPath)} muss Frame-Nummern (Uint16) als Base64 enthalten, mindestens eine`);
  const count = keyBytes.length / 2;
  let previous = -1;
  for (let i = 0; i < count; i++) {
    const frame = u16(keyBytes, i);
    if (i === 0 && frame !== 0) fail(`${q(keysPath)} muss mit Frame 0 beginnen (ist ${frame})`);
    if (frame <= previous) fail(`${q(keysPath)} muss streng aufsteigen (Key ${i}: Frame ${frame} nach ${previous})`);
    if (frame >= frames) fail(`${q(keysPath)}: Frame ${frame} liegt nicht in der Animation (0 bis ${frames - 1})`);
    previous = frame;
  }
  const per = KEY_VALUES[kind];
  const values = packed(required(o, 'values', path), sub(path, 'values'), per * count, 2, KEY_WHAT[kind]);
  if (kind === 'rot') {
    for (let i = 0; i < count; i++) {
      let square = 0;
      for (let c = 0; c < 4; c++) square += (s16(values, i * 4 + c) / L.rotationUnit) ** 2;
      const length = Math.sqrt(square);
      if (Math.abs(length - 1) > L.quaternionTolerance) {
        fail(
          `${q(sub(path, 'values'))}: Das Quaternion von Key ${i} hat die Länge ${length.toFixed(3)} ` +
            `(erlaubt ${1 - L.quaternionTolerance} bis ${1 + L.quaternionTolerance})`,
        );
      }
    }
  }
  return { keys: rawKeys as string, values: o.values as string, count };
}

/** Animationen nach Namen: fps, frames, loop und höchstens eine Spur je Knochen. */
function checkClips(value: unknown, boneCount: number): Record<string, CosmeticClip> {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'animations');
  const names = Object.keys(o);
  if (names.length < 1 || names.length > L.animationsMax) fail(`„animations“ muss 1 bis ${L.animationsMax} Animationen enthalten`);
  const clips: Record<string, CosmeticClip> = {};
  for (const name of names) {
    const path = `animations.${name}`;
    if (!ANIMATION_NAME_RE.test(name)) fail(`${q(path)}: Der Name ist ungültig (1–24 Zeichen aus A–Z, a–z, 0–9 und _)`);
    const a = object(o[name], path);
    onlyKeys(a, path, ['fps', 'frames', 'loop', 'tracks'], COSMETIC_FORMAT_2);
    const fps = integer(required(a, 'fps', path), sub(path, 'fps'), 1, L.fpsMax);
    const frames = integer(required(a, 'frames', path), sub(path, 'frames'), 1, L.framesMax);
    const loop = boolean(required(a, 'loop', path), sub(path, 'loop'));
    const rawTracks = required(a, 'tracks', path);
    if (!Array.isArray(rawTracks) || rawTracks.length > boneCount) {
      fail(`${q(sub(path, 'tracks'))} muss eine Liste mit höchstens ${boneCount} Spuren sein (eine je Knochen)`);
    }
    const seen = new Set<number>();
    const tracks = rawTracks.map((raw, i): CosmeticTrack => {
      const tp = `${path}.tracks[${i}]`;
      const tr = object(raw, tp);
      onlyKeys(tr, tp, ['bone', 'rot', 'move', 'scale'], COSMETIC_FORMAT_2);
      const bone = integer(required(tr, 'bone', tp), sub(tp, 'bone'), 0, boneCount - 1);
      if (seen.has(bone)) fail(`${q(sub(tp, 'bone'))}: Für den Knochen ${bone} gibt es in dieser Animation schon eine Spur`);
      seen.add(bone);
      if (!has(tr, 'rot') && !has(tr, 'move') && !has(tr, 'scale')) fail(`${q(tp)} braucht mindestens eins von „rot“, „move“ und „scale“`);
      return {
        bone,
        rot: has(tr, 'rot') ? checkKeys(tr.rot, sub(tp, 'rot'), frames, 'rot') : null,
        move: has(tr, 'move') ? checkKeys(tr.move, sub(tp, 'move'), frames, 'move') : null,
        scale: has(tr, 'scale') ? checkKeys(tr.scale, sub(tp, 'scale'), frames, 'scale') : null,
      };
    });
    // defineProperty: Auch ein Name wie „__proto__“ wird ein eigenes Feld.
    Object.defineProperty(clips, name, { value: { fps, frames, loop, tracks }, enumerable: true, writable: true, configurable: true });
  }
  return clips;
}

const animationList = (clips: Record<string, CosmeticClip>) => Object.keys(clips).join(', ');

/** Zustände: idle Pflicht, jeder Wert eine vorhandene Animation, dazu blendSeconds. */
function checkStates(value: unknown, clips: Record<string, CosmeticClip>): CosmeticStates {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'states');
  onlyKeys(o, 'states', [...COSMETIC_STATES, 'blendSeconds'], COSMETIC_FORMAT_2);
  const blendSeconds = number(required(o, 'blendSeconds', 'states'), 'states.blendSeconds', 0, L.blendSecondsMax);
  const states: Record<string, string | number> = { blendSeconds };
  for (const key of COSMETIC_STATES) {
    if (!has(o, key)) {
      if (key === 'idle') fail('„states.idle“ fehlt');
      continue;
    }
    const name = o[key];
    if (typeof name !== 'string' || !Object.hasOwn(clips, name)) fail(`„states.${key}“ muss der Name einer Animation sein (${animationList(clips)})`);
    states[key] = name;
  }
  return states as CosmeticStates;
}

/** Partikel an Knochen: erlaubte IDs, perSecond, color nur bei dust, states = Animationen. */
function checkMeshParticles(value: unknown, boneCount: number, clips: Record<string, CosmeticClip>): CosmeticMeshParticle[] {
  const L = COSMETIC_LIMITS_2;
  if (!Array.isArray(value) || value.length > L.particlesMax) fail(`„particles“ muss eine Liste mit höchstens ${L.particlesMax} Einträgen sein`);
  return value.map((raw, i) => {
    const path = `particles[${i}]`;
    const p = object(raw, path);
    onlyKeys(p, path, ['bone', 'at', 'particle', 'perSecond', 'color', 'states'], COSMETIC_FORMAT_2);
    const bone = integer(required(p, 'bone', path), sub(path, 'bone'), 0, boneCount - 1);
    const at = oneOf(required(p, 'at', path), sub(path, 'at'), PARTICLE_ANCHORS);
    const given = required(p, 'particle', path);
    const id = typeof given === 'string' && given.startsWith('minecraft:') ? given.slice('minecraft:'.length) : given;
    if (typeof id !== 'string' || !(COSMETIC_PARTICLE_IDS as readonly string[]).includes(id)) {
      fail(`${q(sub(path, 'particle'))} ist kein erlaubter Partikel (${COSMETIC_PARTICLE_IDS.join(', ')}; mit oder ohne „minecraft:“)`);
    }
    const perSecond = number(required(p, 'perSecond', path), sub(path, 'perSecond'), L.perSecondMin, L.perSecondMax);
    let color: string | null = null;
    if (has(p, 'color')) {
      if (id !== 'dust') fail(`${q(sub(path, 'color'))} gibt es nur beim Partikel dust`);
      if (typeof p.color !== 'string' || !COLOR_RE.test(p.color)) fail(`${q(sub(path, 'color'))} muss eine Farbe wie #ffcc00 sein`);
      color = p.color;
    }
    let states: string[] | null = null;
    if (has(p, 'states')) {
      const list = p.states;
      if (!Array.isArray(list) || list.length < 1 || list.length > L.animationsMax) {
        fail(`${q(sub(path, 'states'))} muss eine Liste mit 1 bis ${L.animationsMax} Animationen sein`);
      }
      list.forEach((name, j) => {
        const at = `${path}.states[${j}]`;
        if (typeof name !== 'string' || !Object.hasOwn(clips, name)) fail(`${q(at)} muss der Name einer Animation sein (${animationList(clips)})`);
        if (list.indexOf(name) !== j) fail(`${q(at)}: „${name}“ steht doppelt in der Liste`);
      });
      states = [...(list as string[])];
    }
    return { bone, at, particle: id as CosmeticParticleId, perSecond, color, states };
  });
}

function checkAttach(value: unknown): CosmeticAttach {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'attach');
  onlyKeys(o, 'attach', ['origin', 'side'], COSMETIC_FORMAT_2);
  return {
    origin: has(o, 'origin') ? vec3(o.origin, 'attach.origin', around(L.originMax)) : [0, 0, 0],
    side: has(o, 'side') ? oneOf(o.side, 'attach.side', ATTACH_SIDES) : 'left',
  };
}

/** Format 2 (type und format sind schon geprüft). */
function checkFormat2(m: Record<string, unknown>): CosmeticManifest2 {
  const L = COSMETIC_LIMITS_2;
  onlyKeys(m, '', MANIFEST_KEYS_2, COSMETIC_FORMAT_2);
  const { id, version, slot, name, description, access, date } = checkHead(m, MESH_SLOTS);

  if (!has(m, 'texture')) fail('„texture“ fehlt');
  const image = png(m.texture, 'texture', L.pngBytes);
  const fits = (v: number) => isPowerOfTwo(v) && v >= L.textureMin && v <= L.textureMax;
  if (!fits(image.width) || !fits(image.height)) {
    fail(`„texture“ muss je eine Zweierpotenz von ${L.textureMin} bis ${L.textureMax} Pixel breit und hoch sein (ist ${image.width} × ${image.height})`);
  }
  let emissive: CosmeticEmissive | null = null;
  let glow: string | null = null;
  if (has(m, 'glow') !== has(m, 'emissive')) fail(has(m, 'glow') ? '„emissive“ fehlt (Pflicht mit „glow“)' : '„glow“ fehlt (Pflicht mit „emissive“)');
  if (has(m, 'emissive')) {
    emissive = checkEmissive(m.emissive);
    const glowImage = png(m.glow, 'glow', L.pngBytes);
    const height = image.height * emissive.frames;
    if (glowImage.width !== image.width || glowImage.height !== height) {
      fail(
        `„glow“ muss ${image.width} × ${height} Pixel groß sein (so breit wie „texture“, ${emissive.frames} Bilder zu je ${image.height} Pixel ` +
          `untereinander; ist ${glowImage.width} × ${glowImage.height})`,
      );
    }
    glow = m.glow as string;
  }

  const bones = checkMeshBones(required(m, 'bones', ''));
  const mesh = checkMesh(required(m, 'mesh', ''), bones.length);
  const animations = checkClips(required(m, 'animations', ''), bones.length);
  const states = checkStates(required(m, 'states', ''), animations);
  const particles = has(m, 'particles') ? checkMeshParticles(m.particles, bones.length, animations) : [];
  if (slot !== 'companion' && has(m, 'attach')) fail(`„attach“ gibt es nur beim Slot companion (nicht beim Slot ${slot})`);
  const attach = slot === 'companion' ? checkAttach(has(m, 'attach') ? m.attach : {}) : null;

  return {
    type: COSMETIC_TYPE,
    format: COSMETIC_FORMAT_2,
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
    emissive,
    mesh,
    bones,
    animations,
    states,
    particles,
    attach,
  };
}

// ---------- Text und Umschlag ----------

/** Länge des Umschlags, wie der Dienst ihn ausliefert, zu einem Manifest-Text (die Signatur hat immer 88 Zeichen). */
export function cosmeticEnvelopeLength(manifest: string): number {
  return utf8Length(cosmeticEnvelopeText({ manifest, signature: 'A'.repeat(88) }));
}

/**
 * Manifest-Text lesen und prüfen (der Text muss vorher mit seiner Signatur geprüft sein). Hier kommt auch die
 * Größengrenze des Formats dazu: Format 1 höchstens 160 KB Manifest bzw. 192 KB Umschlag, Format 2 512 KB bzw. 544 KB.
 */
export function parseCosmeticManifest(manifest: string): AnyCosmeticManifest | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return '„manifest“ ist kein gültiges JSON';
  }
  const format = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).format : undefined;
  if (format === COSMETIC_FORMAT || format === COSMETIC_FORMAT_2) {
    const L = format === COSMETIC_FORMAT ? COSMETIC_LIMITS : COSMETIC_LIMITS_2;
    if (utf8Length(manifest) > L.manifestBytes) return `„manifest“ ist zu groß (höchstens ${L.manifestBytes / 1024} KB bei Format ${format})`;
    if (cosmeticEnvelopeLength(manifest) > L.envelopeBytes) return `Der Umschlag ist zu groß (höchstens ${L.envelopeBytes / 1024} KB bei Format ${format})`;
  }
  return checkCosmeticManifest(parsed);
}

/**
 * Prüft die Form eines Umschlags `{ manifest, signature }` (ohne Kryptografie): beide als Text, Manifest höchstens
 * 512 KB (UTF-8, größte Grenze aller Formate) ohne einzelne Ersatzzeichen, Signatur als kanonisches Base64 von 64 Byte,
 * der Umschlag wie ausgeliefert höchstens 544 KB. Die engere Grenze von Format 1 (160 KB / 192 KB) prüft
 * parseCosmeticManifest, sobald das Format bekannt ist. Zusatzfelder im Umschlag werden ignoriert.
 */
export function checkCosmeticEnvelope(value: unknown): CosmeticEnvelope | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Der Umschlag ist kein JSON-Objekt';
  const { manifest, signature } = value as Record<string, unknown>;
  if (typeof manifest !== 'string' || manifest === '') return '„manifest“ fehlt oder ist kein Text';
  if (typeof signature !== 'string' || signature === '') return '„signature“ fehlt oder ist kein Text';
  if (LONE_SURROGATE_RE.test(manifest)) return '„manifest“ enthält ungültige Zeichen';
  if (utf8Length(manifest) > COSMETIC_MAX_MANIFEST_BYTES) return `„manifest“ ist zu groß (höchstens ${COSMETIC_MAX_MANIFEST_BYTES / 1024} KB)`;
  if (!SIGNATURE_RE.test(signature)) return '„signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen)';
  if (utf8Length(cosmeticEnvelopeText({ manifest, signature })) > COSMETIC_MAX_ENVELOPE_BYTES) {
    return `Der Umschlag ist zu groß (höchstens ${COSMETIC_MAX_ENVELOPE_BYTES / 1024} KB)`;
  }
  return { manifest, signature };
}
