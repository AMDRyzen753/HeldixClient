// HeldixClient – Webseite: gemeinsame Bausteine für Heldix-Cosmetics (öffentlicher Katalog /cosmetics, Auswahl im
// Konto, Vorschau im Team-Bereich).
//
// Ein Cosmetic ist ein signierter Umschlag { manifest: "<JSON-Text>", signature: "<base64>" }. Die Signatur ist
// Ed25519 mit dem Update-Schlüssel über die UTF-8-Bytes von "heldix-cosmetic\n" + manifest. Die Seite zeigt ein
// Cosmetic erst, wenn die Signatur im Browser (WebCrypto) bestätigt ist und das Manifest alle Regeln von Format 1 bzw.
// Format 2 (animierte Meshes, ab Launcher 0.13.8) erfüllt. Die Prüfregeln sind eine genaue Übertragung von
// service/src/cosmetics-format.ts (dieselben Grenzen und Meldungen wie Dienst, Spiel und Launcher). Den öffentlichen
// Schlüssel bringt die Seite selbst mit: build.mjs schreibt ihn aus launcher/src/main/update-public-key.ts nach
// /update-key.js – er kommt also nicht vom Dienst, der die Daten liefert. Der Team-Bereich kann stattdessen `publicKey`
// aus GET /v1/team/cosmetics übergeben.
//
// Exporte (stabil, andere Seiten bauen darauf):
//   Konstanten   COSMETIC_SIGNATURE_PREFIX, COSMETIC_TYPE, COSMETIC_FORMAT, COSMETIC_FORMAT_2, COSMETIC_FORMATS,
//                COSMETIC_SLOTS, MODEL_SLOTS, MESH_SLOTS, COSMETIC_ACCESS, ANIMATION_TYPES, ANIMATION_AXES,
//                PARTICLE_MOTIONS, COSMETIC_ID_RE, BONE_NAME_RE, COLOR_RE, SIGNATURE_RE, PNG_DATA_URL_PREFIX,
//                BUILTIN_CAPE_IDS, COSMETIC_LIMITS, COSMETIC_LIMITS_2, COSMETIC_MAX_MANIFEST_BYTES,
//                COSMETIC_MAX_ENVELOPE_BYTES, COSMETIC_STATES, COSMETIC_PARTICLE_IDS, PARTICLE_ANCHORS, ATTACH_SIDES,
//                MESH_BONE_NAME_RE, ANIMATION_NAME_RE,
//                SLOT_NAMES (Kopf, Rücken, …), SLOT_TITLES (Hüte & Kopf, …), SLOT_HASHES (kopf, ruecken, …)
//   Format       cosmeticSignedText, cosmeticEnvelopeText, cosmeticEnvelopeLength, utf8Length, codePointLength, crc32,
//                readPng, decodeBase64, encodeBase64, encode/decode Uint8, Int8, Uint16LE, Int16LE, isIsoDate,
//                checkCosmeticManifest, parseCosmeticManifest, checkCosmeticEnvelope
//   Prüfen       CosmeticError, cosmeticsKeyAvailable(), importCosmeticKey(pem?), verifyCosmeticEnvelope(envelope, { publicKey, expect })
//   Katalog      normalizeCatalogEntry, loadCosmeticCatalog(), loadCosmetic(entry), loadVerifiedCosmetics(entries, { onItem }),
//                loadBuiltinCapes(), cosmeticAnimated(manifest), cosmeticAnimations(manifest)
//   Bilder       prepareCosmetic(manifest), prepareBuiltinCape(cape), drawCapeFrame(context, prepared, frame, width, height)
//   Geometrie    cosmeticCubeFaces, cosmeticPose, cosmeticBoneMatrices, mat4Multiply, mat4Apply, cosmeticLoopSeconds
//   Format 2     meshRig, meshClipFrame, sampleMeshChannel, sampleMeshPose, blendMeshPose, meshBoneMatrices,
//                skinMeshRig, meshGlowFrame, meshGlowIntensity, meshStateClip, MeshAnimator
//   Zeichnen     drawCosmeticPreview(canvas, prepared, options)   – 2D (Vorschaubilder, Ersatz ohne WebGL)
//                createCosmeticLayer(viewer, options)              – 3D-Meshes auf einem skinview3d.SkinViewer
import { UPDATE_PUBLIC_KEY } from './update-key.js';

// ---------------------------------------------------------------------------------------------------------
// Format 1 und 2 (genau wie service/src/cosmetics-format.ts)
// ---------------------------------------------------------------------------------------------------------

/** Steht vor dem Manifest-Text, wenn signiert wird. */
export const COSMETIC_SIGNATURE_PREFIX = 'heldix-cosmetic\n';
export const COSMETIC_TYPE = 'heldix-cosmetic';
export const COSMETIC_FORMAT = 1;
/** Meshes mit Keyframe-Animationen */
export const COSMETIC_FORMAT_2 = 2;
export const COSMETIC_FORMATS = Object.freeze([COSMETIC_FORMAT, COSMETIC_FORMAT_2]);

export const COSMETIC_SLOTS = Object.freeze(['head', 'back', 'aura', 'companion', 'cape']);
/** Slots mit Modell (und damit mit Animationen). */
export const MODEL_SLOTS = Object.freeze(['head', 'back', 'companion']);
/** Slots, die Format 2 kennt (kein Cape). */
export const MESH_SLOTS = Object.freeze(['head', 'back', 'aura', 'companion']);
/** Wer ein Cosmetic tragen darf: alle, nur das Team oder nur, wer es freigeschaltet hat (Belohnung für Einladungen). */
export const COSMETIC_ACCESS = Object.freeze(['all', 'team', 'unlock']);
export const ANIMATION_TYPES = Object.freeze(['flap', 'sway', 'spin', 'bob']);
export const ANIMATION_AXES = Object.freeze(['x', 'y', 'z']);
export const PARTICLE_MOTIONS = Object.freeze(['rise', 'fall', 'orbit', 'spark', 'float']);

/** Kurze Namen der Slots (Reiter auf der Webseite). */
export const SLOT_NAMES = Object.freeze({ head: 'Kopf', back: 'Rücken', aura: 'Aura', companion: 'Begleiter', cape: 'Capes' });
/** Lange Namen der Slots (wie im Launcher und im Heldix-Menü). */
export const SLOT_TITLES = Object.freeze({ head: 'Hüte & Kopf', back: 'Flügel & Rücken', aura: 'Aura', companion: 'Begleiter', cape: 'Capes' });
/** Slot in Adressen (/cosmetics#kopf, /cosmetics#capes/galaxie). */
export const SLOT_HASHES = Object.freeze({ head: 'kopf', back: 'ruecken', aura: 'aura', companion: 'begleiter', cape: 'capes' });

/** 1–32 Zeichen aus a–z, 0–9 und -, nicht mit - am Anfang oder Ende. */
export const COSMETIC_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const BONE_NAME_RE = /^[a-z0-9_]{1,24}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Ed25519-Signatur (64 Byte) als Standard-Base64: 88 Zeichen mit „==“, kanonisch (keine Restbits). */
export const SIGNATURE_RE = /^[A-Za-z0-9+/]{85}[AQgw]==$/;
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/** IDs der eingebauten Capes (wie DEFAULT_CAPES im Dienst): Ein Cosmetic darf keine davon tragen. */
export const BUILTIN_CAPE_IDS = Object.freeze(['heldix', 'mitternacht', 'aurora', 'glut', 'kristall', 'neon', 'sakura', 'gewitter', 'galaxie', 'matrix', 'matrix_rot', 'matrix_tuerkis', 'sakura_orange']);

/** Alle Grenzen von Format 1 (Byte-Angaben: 1 KB = 1024 Byte). */
export const COSMETIC_LIMITS = Object.freeze({
  envelopeBytes: 192 * 1024,
  manifestBytes: 160 * 1024,
  pngBytes: 64 * 1024,
  versionMax: 2_147_483_647,
  nameMax: 40,
  descriptionMax: 300,
  textureMin: 8,
  textureMax: 512,
  textureStep: 8,
  /** cape: 64, 128 oder 256 breit, je Bild halb so hoch wie breit, Bilder untereinander */
  capeWidths: Object.freeze([64, 128, 256]),
  capeFramesMax: 32,
  capeFpsMax: 20,
  bonesMax: 64,
  cubesMax: 128,
  /** Das PNG eines Modells ist model.textureSize mal 1, 2 oder 4 (UV und Box-UV zählen in Texeln von textureSize) */
  textureScales: Object.freeze([1, 2, 4]),
  /** model.scale (freiwillig, fehlt: 1): Größe des ganzen Modells um den Anker */
  modelScaleMin: 0.25,
  modelScaleMax: 1.5,
  cubeEdgeMax: 32,
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
  manifestBytes: 512 * 1024,
  envelopeBytes: 544 * 1024,
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

/** Größte Grenzen über alle Formate: für Downloads, bevor das Format bekannt ist. */
export const COSMETIC_MAX_MANIFEST_BYTES = Math.max(COSMETIC_LIMITS.manifestBytes, COSMETIC_LIMITS_2.manifestBytes);
export const COSMETIC_MAX_ENVELOPE_BYTES = Math.max(COSMETIC_LIMITS.envelopeBytes, COSMETIC_LIMITS_2.envelopeBytes);

/** Spielerzustände in `states` (Format 2); `idle` ist Pflicht. */
export const COSMETIC_STATES = Object.freeze(['idle', 'walk', 'sneak', 'sit_or_ride', 'swim', 'sprint', 'elytra', 'jump', 'fall', 'creative_fly', 'start_flying', 'land', 'hurt', 'emote', 'celebrate', 'afk', 'sleep', 'enable', 'disable', 'summon']);
/** Minecraft-Partikel (ohne „minecraft:“; im Manifest mit oder ohne) für Format 2. Alle ohne Parameter außer dust. */
export const COSMETIC_PARTICLE_IDS = Object.freeze([
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
]);
export const PARTICLE_ANCHORS = Object.freeze(['pivot', 'tail']);
export const ATTACH_SIDES = Object.freeze(['left', 'right']);
/** Knochen in Format 2: 1–32 Zeichen aus A–Z, a–z, 0–9, _, . und - (Blender-Namen wie „wing.L“). */
export const MESH_BONE_NAME_RE = /^[A-Za-z0-9_.-]{1,32}$/;
export const ANIMATION_NAME_RE = /^[A-Za-z0-9_]{1,24}$/;

const MANIFEST_KEYS = ['type', 'format', 'id', 'version', 'slot', 'name', 'description', 'access', 'date', 'texture', 'glow', 'model', 'animations', 'particles', 'cape', 'companion'];
const MANIFEST_KEYS_2 = ['type', 'format', 'id', 'version', 'slot', 'name', 'description', 'access', 'date', 'texture', 'glow', 'emissive', 'mesh', 'bones', 'animations', 'states', 'particles', 'attach'];
/** Steuerzeichen (auch Zeilenumbrüche), Zeilen-/Absatztrenner, Schreibrichtung, einzelne Ersatzzeichen. */
const FORBIDDEN_TEXT_RE = /[\p{Cc}\p{Cs}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;
const LONE_SURROGATE_RE = /\p{Cs}/u;
/** ISO 8601: Datum, auf Wunsch mit Uhrzeit (Sekunden, Bruchteile und Zeitzone freiwillig). */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Die Bytes, über die die Signatur läuft, als Text (UTF-8 kodieren): `"heldix-cosmetic\n" + manifest`. */
export function cosmeticSignedText(manifest) {
  return COSMETIC_SIGNATURE_PREFIX + manifest;
}

/** Der Umschlag genau so, wie der Dienst ihn ausliefert (darüber laufen `size` und `sha256` im Katalog). */
export function cosmeticEnvelopeText(envelope) {
  return JSON.stringify({ manifest: envelope.manifest, signature: envelope.signature });
}

/** Länge in Byte als UTF-8 (einzelne Ersatzzeichen zählen wie U+FFFD). */
export function utf8Length(text) {
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
export function codePointLength(text) {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
    length++;
  }
  return length;
}

let crcTable = null;
function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (wie in PNG und zlib) über bytes[start, end). */
export function crc32(bytes, start = 0, end = bytes.length) {
  const table = crcTable ?? (crcTable = makeCrcTable());
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Erlaubte Bittiefen je Farbtyp (PNG-Spezifikation). */
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function u32(bytes, pos) {
  return ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
}

/**
 * Prüft den Aufbau eines PNG ohne es zu dekodieren: Signatur, alle Abschnitte vollständig mit stimmender Prüfsumme
 * (CRC), IHDR zuerst mit gültigen Werten, mindestens ein IDAT, IEND zuletzt und nichts danach. Liefert { width, height }
 * oder einen Hinweis (Text).
 */
export function readPng(bytes) {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return 'ist kein PNG (die PNG-Signatur fehlt)';
  let pos = 8;
  let size = null;
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
export function decodeBase64(text) {
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64_RE.test(text)) return null;
  let binary;
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
export function encodeBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function int16Bytes(values) {
  const bytes = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] & 0xffff;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = v >> 8;
  }
  return bytes;
}

/** Uint8-Werte (0–255) als Base64. */
export const encodeUint8 = (values) => encodeBase64(Uint8Array.from(values));
/** Int8-Werte (−128–127) als Base64. */
export const encodeInt8 = (values) => encodeBase64(new Uint8Array(Int8Array.from(values).buffer));
/** Int16-Werte als Base64 (little-endian). */
export const encodeInt16LE = (values) => encodeBase64(int16Bytes(values));
/** Uint16-Werte als Base64 (little-endian). */
export const encodeUint16LE = (values) => encodeBase64(int16Bytes(values));
/** Base64 → Uint8; null bei ungültigem Base64. */
export const decodeUint8 = (text) => decodeBase64(text);

/** Base64 → Int8; null bei ungültigem Base64. */
export function decodeInt8(text) {
  const bytes = decodeBase64(text);
  return bytes === null ? null : new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

/** Base64 → Uint16 (little-endian); null bei ungültigem Base64 oder ungerader Byte-Zahl. */
export function decodeUint16LE(text) {
  const bytes = decodeBase64(text);
  if (bytes === null || bytes.length % 2 !== 0) return null;
  const out = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  return out;
}

/** Base64 → Int16 (little-endian); null bei ungültigem Base64 oder ungerader Byte-Zahl. */
export function decodeInt16LE(text) {
  const words = decodeUint16LE(text);
  return words === null ? null : new Int16Array(words.buffer);
}

/**
 * Das Mesh eines geprüften Manifests (Format 2) als Ganzzahl-Listen in den Einheiten von COSMETIC_LIMITS_2:
 * { vertexCount, triangleCount, positions (Int16, ×3), normals (Int8, ×3), uvs (Uint16, ×2), bones (Uint8),
 * triangles (Uint16, ×3), joints / weights (Uint8, ×4 oder null) }. Wirft, wenn es nicht geprüft war.
 */
export function decodeCosmeticMesh(mesh) {
  const need = (value) => {
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

/** Eine (geprüfte) Spur als Ganzzahl-Listen: { bone, rot, move, scale } je { keys, values } oder null; wirft sonst. */
export function decodeCosmeticTrack(track) {
  const keys = (k) => {
    const value = decodeUint16LE(k.keys);
    if (value === null) throw new Error('Die Spur ist nicht geprüft (ungültiges Base64)');
    return value;
  };
  const signed = (k) => {
    if (k === null) return null;
    const values = decodeInt16LE(k.values);
    if (values === null) throw new Error('Die Spur ist nicht geprüft (ungültiges Base64)');
    return { keys: keys(k), values };
  };
  let scale = null;
  if (track.scale !== null) {
    const values = decodeUint16LE(track.scale.values);
    if (values === null) throw new Error('Die Spur ist nicht geprüft (ungültiges Base64)');
    scale = { keys: keys(track.scale), values };
  }
  return { bone: track.bone, rot: signed(track.rot), move: signed(track.move), scale };
}

class Problem extends Error {}
function fail(message) {
  throw new Problem(message);
}
const q = (path) => `„${path}“`;
const sub = (path, key) => (path === '' ? key : `${path}.${key}`);

function object(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${q(path)} muss ein JSON-Objekt sein`);
  return value;
}
/** Nur bekannte Felder (kein Format kennt Zusatzfelder). */
function onlyKeys(o, path, allowed, format = COSMETIC_FORMAT) {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(`${q(sub(path, key))} ist kein bekanntes Feld (Format ${format})`);
  }
}
const has = (o, key) => Object.hasOwn(o, key);
function required(o, key, path) {
  if (!has(o, key)) fail(`${q(sub(path, key))} fehlt`);
  return o[key];
}
function integer(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(`${q(path)} muss eine ganze Zahl von ${min} bis ${max} sein`);
  return value;
}
function number(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${q(path)} muss eine Zahl von ${min} bis ${max} sein`);
  return value;
}
function oneOf(value, path, list) {
  if (typeof value !== 'string' || !list.includes(value)) fail(`${q(path)} muss eins von ${list.join(', ')} sein`);
  return value;
}
function boolean(value, path) {
  if (typeof value !== 'boolean') fail(`${q(path)} muss true oder false sein`);
  return value;
}
function vec3(value, path, ranges) {
  const ok = Array.isArray(value) && value.length === 3 && value.every((v, i) => typeof v === 'number' && Number.isFinite(v) && v >= ranges[i][0] && v <= ranges[i][1]);
  if (!ok) {
    const same = ranges.every((r) => r[0] === ranges[0][0] && r[1] === ranges[0][1]);
    fail(
      same
        ? `${q(path)} muss eine Liste aus drei Zahlen von ${ranges[0][0]} bis ${ranges[0][1]} sein`
        : `${q(path)} muss eine Liste aus drei Zahlen sein (${['x', 'y', 'z'].map((a, i) => `${a} von ${ranges[i][0]} bis ${ranges[i][1]}`).join(', ')})`,
    );
  }
  return [value[0], value[1], value[2]];
}
const around = (max) => [
  [-max, max],
  [-max, max],
  [-max, max],
];
function text(value, path, min, max) {
  if (typeof value !== 'string') fail(`${q(path)} fehlt oder ist kein Text`);
  if (FORBIDDEN_TEXT_RE.test(value)) fail(`${q(path)} enthält Zeichen, die nicht erlaubt sind (auch keine Zeilenumbrüche)`);
  if (min > 0 && value.trim() === '') fail(`${q(path)} darf nicht leer sein`);
  if (codePointLength(value) > max) fail(`${q(path)} ist zu lang (höchstens ${max} Zeichen)`);
  return value;
}

/** Datum nach ISO 8601, das es wirklich gibt (kein 30. Februar). */
export function isIsoDate(value) {
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

function png(value, path, maxBytes = COSMETIC_LIMITS.pngBytes) {
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

function checkCape(value) {
  const o = object(value, 'cape');
  onlyKeys(o, 'cape', ['frames', 'fps']);
  return {
    frames: integer(required(o, 'frames', 'cape'), 'cape.frames', 1, COSMETIC_LIMITS.capeFramesMax),
    fps: integer(required(o, 'fps', 'cape'), 'cape.fps', 1, COSMETIC_LIMITS.capeFpsMax),
  };
}

function checkParticles(value) {
  const L = COSMETIC_LIMITS;
  const o = object(value, 'particles');
  onlyKeys(o, 'particles', ['frames', 'rate', 'lifetime', 'size', 'motion', 'radius', 'color', 'fullbright']);
  const get = (key) => required(o, key, 'particles');
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

function checkCompanion(value) {
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

function checkCube(value, path, texture) {
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
    const from = origin[axis] - inflate;
    const to = origin[axis] + size[axis] + inflate;
    if (from < -L.coordMax || to > L.coordMax) fail(`${q(path)} reicht weiter als ${L.coordMax} Pixel vom Anker (${'xyz'[axis]} von ${from} bis ${to})`);
  }
  const [w, h, d] = size;
  const uvWidth = 2 * d + 2 * w;
  const uvHeight = d + h;
  if (uv[0] + uvWidth > texture[0] || uv[1] + uvHeight > texture[1]) {
    fail(`${q(sub(path, 'uv'))}: Die UV-Fläche (${uvWidth} × ${uvHeight} ab ${uv[0]}, ${uv[1]}) passt nicht in die Textur (${texture[0]} × ${texture[1]})`);
  }
  return { origin, size, uv: [uv[0], uv[1]], inflate, mirror };
}

function checkModel(value, image) {
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
    fail(`„model.textureSize“ muss die Größe der Textur in Texeln sein (${sizes.slice(0, -1).join(', ')} oder ${sizes[sizes.length - 1]}: Textur in ${scales.slice(0, -1).join('-, ')}- oder ${scales[scales.length - 1]}-facher Auflösung)`);
  }
  const texture = [image.width / k, image.height / k];
  const scale = has(o, 'scale') ? number(o.scale, 'model.scale', L.modelScaleMin, L.modelScaleMax) : 1;
  const rawBones = required(o, 'bones', 'model');
  if (!Array.isArray(rawBones) || rawBones.length < 1 || rawBones.length > L.bonesMax) fail(`„model.bones“ muss eine Liste mit 1 bis ${L.bonesMax} Bones sein`);
  const names = new Set();
  const bones = [];
  let cubeCount = 0;
  rawBones.forEach((raw, i) => {
    const path = `model.bones[${i}]`;
    const b = object(raw, path);
    onlyKeys(b, path, ['name', 'parent', 'pivot', 'rotation', 'cubes']);
    const name = required(b, 'name', path);
    if (typeof name !== 'string' || !BONE_NAME_RE.test(name)) fail(`${q(sub(path, 'name'))} ist ungültig (1–24 Zeichen aus a–z, 0–9 und _)`);
    if (names.has(name)) fail(`${q(sub(path, 'name'))}: Den Bone „${name}“ gibt es schon`);
    let parent = null;
    if (has(b, 'parent')) {
      if (typeof b.parent !== 'string' || !names.has(b.parent)) fail(`${q(sub(path, 'parent'))} muss der Name eines Bones sein, der vorher in der Liste steht`);
      parent = b.parent;
    }
    const pivot = vec3(required(b, 'pivot', path), sub(path, 'pivot'), around(L.coordMax));
    const rotation = has(b, 'rotation') ? vec3(b.rotation, sub(path, 'rotation'), around(L.rotationMax)) : [0, 0, 0];
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

function checkAnimations(value, model) {
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
    const amplitude = type === 'spin' && !has(a, 'amplitude') ? 0 : number(required(a, 'amplitude', path), sub(path, 'amplitude'), 0, amplitudeMax);
    const speed = number(required(a, 'speed', path), sub(path, 'speed'), 0, L.speedMax);
    const phase = has(a, 'phase') ? number(a.phase, sub(path, 'phase'), 0, 1) : 0;
    return { bone, type, axis, amplitude, speed, phase };
  });
}

function checkTextureSize(slot, image, cape, particles) {
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
  const fits = (v) => v >= L.textureMin && v <= L.textureMax && v % L.textureStep === 0;
  if (!fits(width) || !fits(height)) fail(`„texture“ muss ${L.textureMin} bis ${L.textureMax} Pixel breit und hoch sein, jeweils ein Vielfaches von ${L.textureStep} (ist ${width} × ${height})`);
  if (slot === 'aura' && particles !== null && width !== height * particles.frames) {
    fail(`„texture“ muss ${particles.frames} quadratische Bilder nebeneinander enthalten (Breite = Höhe × ${particles.frames}; ist ${width} × ${height})`);
  }
}

/**
 * Prüft den Inhalt eines Cosmetic-Manifests (das geparste JSON) nach Format 1 oder 2 (je nach `format`). Liefert das
 * Manifest mit Standardwerten für fehlende freiwillige Felder (dazu `image`: Größe der Textur) oder einen deutschen
 * Hinweis (der erste Fehler). Die Größe des Manifest-Texts prüft parseCosmeticManifest.
 */
export function checkCosmeticManifest(value) {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Das Manifest ist kein JSON-Objekt');
    const m = value;
    if (m.type !== COSMETIC_TYPE) fail(`„type“ muss „${COSMETIC_TYPE}“ sein`);
    if (m.format === COSMETIC_FORMAT_2) return checkFormat2(m);
    if (m.format !== COSMETIC_FORMAT) fail(`„format“ muss ${COSMETIC_FORMATS.join(' oder ')} sein`);
    return check(m);
  } catch (error) {
    if (error instanceof Problem) return error.message;
    throw error;
  }
}

/** Kopf beider Formate: id, version, slot, name, description, access, date. */
function checkHead(m, slots) {
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
function check(m) {
  onlyKeys(m, '', MANIFEST_KEYS);
  const { id, version, slot, name, description, access, date } = checkHead(m, COSMETIC_SLOTS);

  if (!has(m, 'texture')) fail('„texture“ fehlt');
  const image = png(m.texture, 'texture');
  let glow = null;
  if (has(m, 'glow')) {
    const glowImage = png(m.glow, 'glow');
    if (glowImage.width !== image.width || glowImage.height !== image.height) {
      fail(`„glow“ muss genauso groß sein wie „texture“ (${image.width} × ${image.height}; ist ${glowImage.width} × ${glowImage.height})`);
    }
    glow = m.glow;
  }

  const needs = { model: MODEL_SLOTS.includes(slot), particles: slot === 'aura', cape: slot === 'cape', companion: slot === 'companion' };
  for (const key of ['model', 'particles', 'cape', 'companion']) {
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

  return { type: COSMETIC_TYPE, format: COSMETIC_FORMAT, id, version, slot, name, description, access, date, texture: m.texture, image, glow, model, animations, particles, cape, companion };
}

// ---------- Format 2: Mesh mit Keyframe-Animationen ----------

const isPowerOfTwo = (v) => v > 0 && (v & (v - 1)) === 0;
const u16 = (bytes, i) => bytes[i * 2] | (bytes[i * 2 + 1] << 8);
const s16 = (bytes, i) => (u16(bytes, i) << 16) >> 16;

/** Base64 mit genau `count` Werten zu je `size` Byte (Länge passend, strenges Base64); liefert die Bytes. */
function packed(value, path, count, size, what) {
  const bytes = count * size;
  const chars = Math.ceil(bytes / 3) * 4;
  if (typeof value !== 'string') fail(`${q(path)} fehlt oder ist kein Text (Base64)`);
  if (value.length !== chars) fail(`${q(path)} muss genau ${count} ${what} als Base64 enthalten (${chars} Zeichen, nicht ${value.length})`);
  const decoded = decodeBase64(value);
  if (decoded === null || decoded.length !== bytes) fail(`${q(path)} enthält kein gültiges Base64 (erwartet ${bytes} Byte)`);
  return decoded;
}

function checkEmissive(value) {
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
function checkMeshBones(value) {
  const L = COSMETIC_LIMITS_2;
  if (!Array.isArray(value) || value.length < 1 || value.length > L.bonesMax) fail(`„bones“ muss eine Liste mit 1 bis ${L.bonesMax} Knochen sein`);
  const names = new Set();
  return value.map((raw, i) => {
    const path = `bones[${i}]`;
    const b = object(raw, path);
    onlyKeys(b, path, ['name', 'parent', 'pivot', 'tail'], COSMETIC_FORMAT_2);
    const name = required(b, 'name', path);
    if (typeof name !== 'string' || !MESH_BONE_NAME_RE.test(name)) fail(`${q(sub(path, 'name'))} ist ungültig (1–${L.boneNameMax} Zeichen aus A–Z, a–z, 0–9, _, . und -)`);
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
function checkMesh(value, boneCount) {
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
    if (bones[v] >= boneCount) fail(`„mesh.bones“: Vertex ${v} nennt den Knochen ${bones[v]}, es gibt nur ${boneCount} (0 bis ${boneCount - 1})`);
  }
  const triangles = packed(required(o, 'triangles', 'mesh'), 'mesh.triangles', 3 * t, 2, `Vertex-Indizes (Uint16, 3 je Dreieck, ${t} Dreiecke)`);
  for (let i = 0; i < 3 * t; i++) {
    const index = u16(triangles, i);
    if (index >= n) fail(`„mesh.triangles“: Dreieck ${Math.floor(i / 3)} nennt den Vertex ${index}, es gibt nur ${n} (0 bis ${n - 1})`);
  }
  let joints = null;
  let weights = null;
  if (has(o, 'joints') !== has(o, 'weights')) fail(has(o, 'joints') ? '„mesh.weights“ fehlt (Pflicht mit „mesh.joints“)' : '„mesh.joints“ fehlt (Pflicht mit „mesh.weights“)');
  if (has(o, 'joints')) {
    const k = L.influences;
    const j = packed(o.joints, 'mesh.joints', k * n, 1, `Knochen-Indizes (Uint8, ${k} je Vertex)`);
    const w = packed(o.weights, 'mesh.weights', k * n, 1, `Gewichte (Uint8, ${k} je Vertex)`);
    for (let v = 0; v < n; v++) {
      let sum = 0;
      let max = 0;
      for (let i = v * k; i < v * k + k; i++) {
        if (j[i] >= boneCount) fail(`„mesh.joints“: Vertex ${v} nennt den Knochen ${j[i]}, es gibt nur ${boneCount} (0 bis ${boneCount - 1})`);
        sum += w[i];
        max = Math.max(max, w[i]);
      }
      if (sum !== L.weightUnit) fail(`„mesh.weights“: Die Gewichte von Vertex ${v} ergeben ${sum} statt ${L.weightUnit}`);
      let main = false;
      for (let i = v * k; i < v * k + k; i++) if (j[i] === bones[v] && w[i] === max) main = true;
      if (!main) fail(`„mesh.bones“: Vertex ${v} muss den Knochen mit dem größten Gewicht aus „mesh.joints“ nennen`);
    }
    joints = o.joints;
    weights = o.weights;
  }
  return { vertexCount: n, triangleCount: t, positions: o.positions, normals: o.normals, uvs: o.uvs, bones: o.bones, triangles: o.triangles, joints, weights };
}

const KEY_VALUES = { rot: 4, move: 3, scale: 1 };
const KEY_WHAT = { rot: 'Int16-Werte (x, y, z, w je Key)', move: 'Int16-Werte (x, y, z je Key)', scale: 'Uint16-Werte (einer je Key)' };

/** Keys einer Spur: Frame-Nummern (erste 0, streng aufsteigend, < frames) und passend viele Werte. */
function checkKeys(value, path, frames, kind) {
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
        fail(`${q(sub(path, 'values'))}: Das Quaternion von Key ${i} hat die Länge ${length.toFixed(3)} (erlaubt ${1 - L.quaternionTolerance} bis ${1 + L.quaternionTolerance})`);
      }
    }
  }
  return { keys: rawKeys, values: o.values, count };
}

/** Animationen nach Namen: fps, frames, loop und höchstens eine Spur je Knochen. */
function checkClips(value, boneCount) {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'animations');
  const names = Object.keys(o);
  if (names.length < 1 || names.length > L.animationsMax) fail(`„animations“ muss 1 bis ${L.animationsMax} Animationen enthalten`);
  const clips = {};
  for (const name of names) {
    const path = `animations.${name}`;
    if (!ANIMATION_NAME_RE.test(name)) fail(`${q(path)}: Der Name ist ungültig (1–24 Zeichen aus A–Z, a–z, 0–9 und _)`);
    const a = object(o[name], path);
    onlyKeys(a, path, ['fps', 'frames', 'loop', 'tracks'], COSMETIC_FORMAT_2);
    const fps = integer(required(a, 'fps', path), sub(path, 'fps'), 1, L.fpsMax);
    const frames = integer(required(a, 'frames', path), sub(path, 'frames'), 1, L.framesMax);
    const loop = boolean(required(a, 'loop', path), sub(path, 'loop'));
    const rawTracks = required(a, 'tracks', path);
    if (!Array.isArray(rawTracks) || rawTracks.length > boneCount) fail(`${q(sub(path, 'tracks'))} muss eine Liste mit höchstens ${boneCount} Spuren sein (eine je Knochen)`);
    const seen = new Set();
    const tracks = rawTracks.map((raw, i) => {
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

const animationList = (clips) => Object.keys(clips).join(', ');

/** Zustände: idle Pflicht, jeder Wert eine vorhandene Animation, dazu blendSeconds. */
function checkStates(value, clips) {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'states');
  onlyKeys(o, 'states', [...COSMETIC_STATES, 'blendSeconds'], COSMETIC_FORMAT_2);
  const blendSeconds = number(required(o, 'blendSeconds', 'states'), 'states.blendSeconds', 0, L.blendSecondsMax);
  const states = { blendSeconds };
  for (const key of COSMETIC_STATES) {
    if (!has(o, key)) {
      if (key === 'idle') fail('„states.idle“ fehlt');
      continue;
    }
    const name = o[key];
    if (typeof name !== 'string' || !Object.hasOwn(clips, name)) fail(`„states.${key}“ muss der Name einer Animation sein (${animationList(clips)})`);
    states[key] = name;
  }
  return states;
}

/** Partikel an Knochen: erlaubte IDs, perSecond, color nur bei dust, states = Animationen. */
function checkMeshParticles(value, boneCount, clips) {
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
    if (typeof id !== 'string' || !COSMETIC_PARTICLE_IDS.includes(id)) fail(`${q(sub(path, 'particle'))} ist kein erlaubter Partikel (${COSMETIC_PARTICLE_IDS.join(', ')}; mit oder ohne „minecraft:“)`);
    const perSecond = number(required(p, 'perSecond', path), sub(path, 'perSecond'), L.perSecondMin, L.perSecondMax);
    let color = null;
    if (has(p, 'color')) {
      if (id !== 'dust') fail(`${q(sub(path, 'color'))} gibt es nur beim Partikel dust`);
      if (typeof p.color !== 'string' || !COLOR_RE.test(p.color)) fail(`${q(sub(path, 'color'))} muss eine Farbe wie #ffcc00 sein`);
      color = p.color;
    }
    let states = null;
    if (has(p, 'states')) {
      const list = p.states;
      if (!Array.isArray(list) || list.length < 1 || list.length > L.animationsMax) fail(`${q(sub(path, 'states'))} muss eine Liste mit 1 bis ${L.animationsMax} Animationen sein`);
      list.forEach((name, j) => {
        const where = `${path}.states[${j}]`;
        if (typeof name !== 'string' || !Object.hasOwn(clips, name)) fail(`${q(where)} muss der Name einer Animation sein (${animationList(clips)})`);
        if (list.indexOf(name) !== j) fail(`${q(where)}: „${name}“ steht doppelt in der Liste`);
      });
      states = [...list];
    }
    return { bone, at, particle: id, perSecond, color, states };
  });
}

function checkAttach(value) {
  const L = COSMETIC_LIMITS_2;
  const o = object(value, 'attach');
  onlyKeys(o, 'attach', ['origin', 'side'], COSMETIC_FORMAT_2);
  return {
    origin: has(o, 'origin') ? vec3(o.origin, 'attach.origin', around(L.originMax)) : [0, 0, 0],
    side: has(o, 'side') ? oneOf(o.side, 'attach.side', ATTACH_SIDES) : 'left',
  };
}

/** Format 2 (type und format sind schon geprüft). */
function checkFormat2(m) {
  const L = COSMETIC_LIMITS_2;
  onlyKeys(m, '', MANIFEST_KEYS_2, COSMETIC_FORMAT_2);
  const { id, version, slot, name, description, access, date } = checkHead(m, MESH_SLOTS);

  if (!has(m, 'texture')) fail('„texture“ fehlt');
  const image = png(m.texture, 'texture', L.pngBytes);
  const fits = (v) => isPowerOfTwo(v) && v >= L.textureMin && v <= L.textureMax;
  if (!fits(image.width) || !fits(image.height)) fail(`„texture“ muss je eine Zweierpotenz von ${L.textureMin} bis ${L.textureMax} Pixel breit und hoch sein (ist ${image.width} × ${image.height})`);
  let emissive = null;
  let glow = null;
  if (has(m, 'glow') !== has(m, 'emissive')) fail(has(m, 'glow') ? '„emissive“ fehlt (Pflicht mit „glow“)' : '„glow“ fehlt (Pflicht mit „emissive“)');
  if (has(m, 'emissive')) {
    emissive = checkEmissive(m.emissive);
    const glowImage = png(m.glow, 'glow', L.pngBytes);
    const height = image.height * emissive.frames;
    if (glowImage.width !== image.width || glowImage.height !== height) {
      fail(`„glow“ muss ${image.width} × ${height} Pixel groß sein (so breit wie „texture“, ${emissive.frames} Bilder zu je ${image.height} Pixel untereinander; ist ${glowImage.width} × ${glowImage.height})`);
    }
    glow = m.glow;
  }

  const bones = checkMeshBones(required(m, 'bones', ''));
  const mesh = checkMesh(required(m, 'mesh', ''), bones.length);
  const animations = checkClips(required(m, 'animations', ''), bones.length);
  const states = checkStates(required(m, 'states', ''), animations);
  const particles = has(m, 'particles') ? checkMeshParticles(m.particles, bones.length, animations) : [];
  if (slot !== 'companion' && has(m, 'attach')) fail(`„attach“ gibt es nur beim Slot companion (nicht beim Slot ${slot})`);
  const attach = slot === 'companion' ? checkAttach(has(m, 'attach') ? m.attach : {}) : null;

  return { type: COSMETIC_TYPE, format: COSMETIC_FORMAT_2, id, version, slot, name, description, access, date, texture: m.texture, image, glow, emissive, mesh, bones, animations, states, particles, attach };
}

// ---------- Text und Umschlag ----------

/** Länge des Umschlags, wie der Dienst ihn ausliefert, zu einem Manifest-Text (die Signatur hat immer 88 Zeichen). */
export function cosmeticEnvelopeLength(manifest) {
  return utf8Length(cosmeticEnvelopeText({ manifest, signature: 'A'.repeat(88) }));
}

/**
 * Manifest-Text lesen und prüfen (der Text muss vorher mit seiner Signatur geprüft sein). Hier kommt auch die
 * Größengrenze des Formats dazu: Format 1 höchstens 160 KB Manifest bzw. 192 KB Umschlag, Format 2 512 KB bzw. 544 KB.
 */
export function parseCosmeticManifest(manifest) {
  let parsed;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return '„manifest“ ist kein gültiges JSON';
  }
  const format = typeof parsed === 'object' && parsed !== null ? parsed.format : undefined;
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
 * parseCosmeticManifest, sobald das Format bekannt ist. Zusatzfelder im Umschlag werden ignoriert. Liefert
 * { manifest, signature } oder Text.
 */
export function checkCosmeticEnvelope(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Der Umschlag ist kein JSON-Objekt';
  const { manifest, signature } = value;
  if (typeof manifest !== 'string' || manifest === '') return '„manifest“ fehlt oder ist kein Text';
  if (typeof signature !== 'string' || signature === '') return '„signature“ fehlt oder ist kein Text';
  if (LONE_SURROGATE_RE.test(manifest)) return '„manifest“ enthält ungültige Zeichen';
  if (utf8Length(manifest) > COSMETIC_MAX_MANIFEST_BYTES) return `„manifest“ ist zu groß (höchstens ${COSMETIC_MAX_MANIFEST_BYTES / 1024} KB)`;
  if (!SIGNATURE_RE.test(signature)) return '„signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen)';
  if (utf8Length(cosmeticEnvelopeText({ manifest, signature })) > COSMETIC_MAX_ENVELOPE_BYTES) return `Der Umschlag ist zu groß (höchstens ${COSMETIC_MAX_ENVELOPE_BYTES / 1024} KB)`;
  return { manifest, signature };
}

// ---------------------------------------------------------------------------------------------------------
// Signatur prüfen (WebCrypto, Ed25519)
// ---------------------------------------------------------------------------------------------------------

/** Fehler beim Laden oder Prüfen eines Cosmetics; `reason`: network | key | unsupported | envelope | signature | manifest | mismatch. */
export class CosmeticError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'CosmeticError';
    this.reason = reason;
  }
}

/** Bringt diese Seite einen öffentlichen Update-Schlüssel mit (und kann der Browser prüfen)? */
export function cosmeticsKeyAvailable() {
  return typeof UPDATE_PUBLIC_KEY === 'string' && UPDATE_PUBLIC_KEY.includes('BEGIN PUBLIC KEY') && Boolean(globalThis.crypto?.subtle);
}

const keyCache = new Map();

/** Öffentlichen Schlüssel (PEM, SPKI) für Ed25519 importieren; ohne Angabe der Update-Schlüssel der Seite. */
export function importCosmeticKey(pem = UPDATE_PUBLIC_KEY) {
  if (typeof pem !== 'string' || !pem.includes('BEGIN PUBLIC KEY')) return Promise.reject(new CosmeticError('Für die Prüfung der Cosmetics fehlt der öffentliche Schlüssel.', 'key'));
  if (!globalThis.crypto?.subtle) return Promise.reject(new CosmeticError('Dein Browser kann die Signaturen hier nicht prüfen (WebCrypto fehlt – die Seite muss über HTTPS laufen).', 'unsupported'));
  if (!keyCache.has(pem)) {
    const promise = (async () => {
      const match = /-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----/.exec(pem);
      const der = match ? decodeBase64(match[1].replace(/\s+/g, '')) : null;
      if (!der) throw new CosmeticError('Der öffentliche Schlüssel für Cosmetics ist beschädigt.', 'key');
      try {
        return await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
      } catch (error) {
        if (error?.name === 'NotSupportedError') throw new CosmeticError('Dein Browser kann Ed25519-Signaturen nicht prüfen. Nimm einen aktuellen Chrome, Edge, Firefox oder Safari.', 'unsupported');
        throw new CosmeticError('Der öffentliche Schlüssel für Cosmetics ist kein Ed25519-Schlüssel.', 'key');
      }
    })();
    promise.catch(() => keyCache.delete(pem));
    keyCache.set(pem, promise);
  }
  return keyCache.get(pem);
}

/**
 * Umschlag prüfen: Form, Ed25519-Signatur über "heldix-cosmetic\n" + manifest, alle Regeln von Format 1 bzw. 2.
 * envelope: Objekt oder JSON-Text. expect: { id, slot, version } aus dem Katalog (müssen übereinstimmen).
 * Liefert das geprüfte Manifest; wirft CosmeticError mit deutschem Hinweis.
 */
export async function verifyCosmeticEnvelope(envelope, { publicKey = UPDATE_PUBLIC_KEY, expect = null } = {}) {
  let value = envelope;
  if (typeof value === 'string') {
    if (utf8Length(value) > COSMETIC_MAX_ENVELOPE_BYTES) throw new CosmeticError(`Der Umschlag ist zu groß (höchstens ${COSMETIC_MAX_ENVELOPE_BYTES / 1024} KB)`, 'envelope');
    try {
      value = JSON.parse(value);
    } catch {
      throw new CosmeticError('Der Umschlag ist kein gültiges JSON', 'envelope');
    }
  }
  const checked = checkCosmeticEnvelope(value);
  if (typeof checked === 'string') throw new CosmeticError(checked, 'envelope');
  const key = await importCosmeticKey(publicKey);
  const signature = decodeBase64(checked.signature);
  let valid = false;
  try {
    valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, new TextEncoder().encode(cosmeticSignedText(checked.manifest)));
  } catch {
    valid = false;
  }
  if (!valid) throw new CosmeticError('Die Signatur stimmt nicht (nicht vom HeldixClient-Team signiert oder verändert)', 'signature');
  const manifest = parseCosmeticManifest(checked.manifest);
  if (typeof manifest === 'string') throw new CosmeticError(manifest, 'manifest');
  if (expect) {
    if ((expect.id !== undefined && expect.id !== manifest.id) || (expect.slot !== undefined && expect.slot !== manifest.slot)) {
      throw new CosmeticError('Das Cosmetic passt nicht zum Katalog-Eintrag', 'mismatch');
    }
  }
  return manifest;
}

// ---------------------------------------------------------------------------------------------------------
// Katalog (GET /api/v1/cosmetics, GET /api/v1/cosmetics/<id>?v=<sha256>)
// ---------------------------------------------------------------------------------------------------------

const SHA256_RE = /^[0-9a-f]{64}$/;
const clean = (value, max) => (typeof value === 'string' && !FORBIDDEN_TEXT_RE.test(value) ? value.trim().slice(0, max) : '');

/** Katalog-Eintrag in eine sichere Form bringen (Anzeige vor der Prüfung, z. B. Ladeplatz); sonst null. */
export function normalizeCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !COSMETIC_ID_RE.test(entry.id) || BUILTIN_CAPE_IDS.includes(entry.id)) return null;
  if (!COSMETIC_SLOTS.includes(entry.slot)) return null;
  return {
    id: entry.id,
    slot: entry.slot,
    version: Number.isInteger(entry.version) && entry.version > 0 ? entry.version : null,
    name: clean(entry.name, COSMETIC_LIMITS.nameMax) || entry.id,
    description: clean(entry.description, COSMETIC_LIMITS.descriptionMax),
    access: COSMETIC_ACCESS.includes(entry.access) ? entry.access : 'all',
    sha256: typeof entry.sha256 === 'string' && SHA256_RE.test(entry.sha256) ? entry.sha256 : '',
    size: Number.isInteger(entry.size) && entry.size > 0 ? entry.size : null,
    date: typeof entry.date === 'string' && Number.isFinite(Date.parse(entry.date)) ? entry.date : null,
  };
}

async function fetchText(path, { cache = 'default' } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache });
  } catch {
    throw new CosmeticError('Der Heldix-Dienst ist gerade nicht erreichbar.', 'network');
  }
  if (!response.ok) throw Object.assign(new CosmeticError(`Der Heldix-Dienst antwortet mit ${response.status}.`, 'network'), { status: response.status });
  return response.text();
}

/** GET /v1/cosmetics → geprüfte Einträge (Reihenfolge des Dienstes: Slot, dann Name), doppelte IDs fallen weg. */
export async function loadCosmeticCatalog() {
  const raw = await fetchText('/v1/cosmetics', { cache: 'no-cache' });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new CosmeticError('Der Katalog ist beschädigt.', 'network');
  }
  const seen = new Set();
  return (Array.isArray(data?.cosmetics) ? data.cosmetics : []).map(normalizeCatalogEntry).filter((entry) => entry && !seen.has(entry.id) && seen.add(entry.id));
}

const verified = new Map();

/** Umschlag eines Katalog-Eintrags laden und vollständig prüfen (zwischengespeichert je ID und sha256). */
export function loadCosmetic(entry) {
  const key = `${entry.id}:${entry.sha256}`;
  if (!verified.has(key)) {
    const promise = (async () => {
      const path = `/v1/cosmetics/${encodeURIComponent(entry.id)}${entry.sha256 ? `?v=${entry.sha256}` : ''}`;
      const raw = await fetchText(path);
      return verifyCosmeticEnvelope(raw, { expect: { id: entry.id, slot: entry.slot } });
    })();
    promise.catch(() => verified.delete(key));
    verified.set(key, promise);
  }
  return verified.get(key);
}

/**
 * Alle Einträge laden und prüfen (höchstens vier Anfragen gleichzeitig). onItem(entry, manifest | null, error) meldet
 * jeden fertigen Eintrag sofort. Liefert { cosmetics: [{ entry, manifest }], rejected: [{ entry, error }] } in der
 * Reihenfolge des Katalogs.
 */
export async function loadVerifiedCosmetics(entries, { onItem = null, concurrency = 4 } = {}) {
  const results = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const index = next++;
      const entry = entries[index];
      try {
        const manifest = await loadCosmetic(entry);
        results[index] = { entry, manifest };
        onItem?.(entry, manifest, null);
      } catch (error) {
        const failure = error instanceof CosmeticError ? error : new CosmeticError('Das Cosmetic ließ sich nicht prüfen.', 'manifest');
        results[index] = { entry, error: failure };
        onItem?.(entry, null, failure);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return { cosmetics: results.filter((r) => r.manifest), rejected: results.filter((r) => r.error) };
}

let builtinCapes = null;

/**
 * Die 13 eingebauten Capes (/capes/capes.json aus der Mod): [{ id, name, description, frames, fps, glow, team }].
 * team: nur für das HeldixClient-Team wählbar (capes.json "team": true; der Dienst prüft selbst).
 */
export function loadBuiltinCapes() {
  if (!builtinCapes) {
    builtinCapes = fetch('/capes/capes.json', { credentials: 'omit' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) =>
        (Array.isArray(data?.capes) ? data.capes : [])
          .filter((cape) => cape && BUILTIN_CAPE_IDS.includes(cape.id))
          .map((cape) => ({ id: cape.id, name: clean(cape.name, 40) || cape.id, description: clean(cape.description, 300), frames: Number(cape.frames) || 1, fps: Number(cape.fps) || 10, glow: cape.glow === true, team: cape.team === true })),
      );
    builtinCapes.catch(() => (builtinCapes = null));
  }
  return builtinCapes;
}

/** Bewegt sich das Cosmetic (Animationen, Partikel, mehrere Cape-Bilder)? */
export function cosmeticAnimated(manifest) {
  if (manifest.format === 2) return Object.values(manifest.animations ?? {}).some((clip) => clip.frames > 1 && clip.tracks.length > 0) || (manifest.emissive?.frames ?? 1) > 1;
  if (manifest.slot === 'aura') return true;
  if (manifest.slot === 'cape') return (manifest.cape?.frames ?? 1) > 1;
  return manifest.animations.some((a) => a.speed > 0 && (a.type === 'spin' || a.amplitude > 0));
}

// ---------------------------------------------------------------------------------------------------------
// Bilder
// ---------------------------------------------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new CosmeticError('Ein Bild des Cosmetics ließ sich nicht laden.', 'manifest')));
    image.src = src;
  });
}

const prepared = new WeakMap();

/**
 * Geprüftes Manifest → { kind: 'cosmetic', manifest, texture, glow } mit geladenen Bildern (für Vorschau und 3D).
 * Die Bilder stehen als data-URL im signierten Manifest – nichts wird nachgeladen.
 */
export function prepareCosmetic(manifest) {
  if (!prepared.has(manifest)) {
    const promise = Promise.all([loadImage(manifest.texture), manifest.glow ? loadImage(manifest.glow) : null]).then(([texture, glow]) => ({ kind: 'cosmetic', manifest, texture, glow }));
    promise.catch(() => prepared.delete(manifest));
    prepared.set(manifest, promise);
  }
  return prepared.get(manifest);
}

/** Eingebautes Cape → { kind: 'builtin-cape', cape, texture, glow, frames, fps } (Bilder aus /capes/<id>.png). */
export async function prepareBuiltinCape(cape) {
  const [texture, glow] = await Promise.all([loadImage(`/capes/${encodeURIComponent(cape.id)}.png`), cape.glow ? loadImage(`/capes/${encodeURIComponent(cape.id)}_glow.png`).catch(() => null) : null]);
  return { kind: 'builtin-cape', cape, texture, glow, frames: Number(cape.frames) || 1, fps: Number(cape.fps) || 10 };
}

/** Bilder und Bildfolge eines Capes (eingebaut oder aus dem Katalog). */
function capeSource(item) {
  if (item.kind === 'builtin-cape') return { texture: item.texture, glow: item.glow, frames: item.frames, fps: item.fps };
  return { texture: item.texture, glow: item.glow, frames: item.manifest.cape?.frames ?? 1, fps: item.manifest.cape?.fps ?? 10 };
}

/** Bild `frame` eines Capes (Bilder untereinander, mit Leuchtebene) auf context zeichnen, auf width × height skaliert. */
export function drawCapeFrame(context, item, frame, width, height) {
  const { texture, glow, frames } = capeSource(item);
  const index = ((frame % frames) + frames) % frames;
  // Katalog-Capes sind Pixel-Art (64 × 32 je Bild) und werden hart vergrößert; eingebaute haben schon 512 × 256
  context.imageSmoothingEnabled = item.kind === 'builtin-cape';
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  const h = texture.naturalHeight / frames;
  context.drawImage(texture, 0, index * h, texture.naturalWidth, h, 0, 0, width, height);
  if (glow) {
    const gh = glow.naturalHeight / frames;
    context.globalCompositeOperation = 'lighter';
    context.drawImage(glow, 0, index * gh, glow.naturalWidth, gh, 0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
  }
}

// ---------------------------------------------------------------------------------------------------------
// Geometrie: Box-UV, Animationen, Bone-Matrizen (wie launcher/src/main/core/cosmetics-format.ts)
//
// Modellkoordinaten in Pixeln (1/16 Block), rechtshändig: +Y oben, +Z vorn (Blickrichtung), +X links des Trägers.
// Bones: pivot und Würfel in Modellkoordinaten; Matrix = Eltern · T(pivot + bob) · Rz · Ry · Rx · T(-pivot).
// ---------------------------------------------------------------------------------------------------------

/**
 * Die sechs Flächen eines Würfels mit Box-UV (Flächen ohne Fläche fallen weg): { name, corners (oben links, oben
 * rechts, unten rechts, unten links – bezogen auf die Textur), uvs (Texturpixel), normal, mirrored, plane }.
 * plane: Der Würfel hat eine Kante 0 – die Fläche wird von beiden Seiten gezeichnet.
 */
export function cosmeticCubeFaces(cube) {
  const [w, h, d] = cube.size;
  const [u, v] = cube.uv;
  const i = cube.inflate;
  const x0 = cube.origin[0] - i;
  const y0 = cube.origin[1] - i;
  const z0 = cube.origin[2] - i;
  const x1 = cube.origin[0] + w + i;
  const y1 = cube.origin[1] + h + i;
  const z1 = cube.origin[2] + d + i;
  const rect = (ua, va, ub, vb) => [
    [ua, va],
    [ub, va],
    [ub, vb],
    [ua, vb],
  ];
  const faces = [
    { name: 'right', area: d * h, normal: [-1, 0, 0], corners: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], uvs: rect(u, v + d, u + d, v + d + h) },
    { name: 'front', area: w * h, normal: [0, 0, 1], corners: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], uvs: rect(u + d, v + d, u + d + w, v + d + h) },
    { name: 'left', area: d * h, normal: [1, 0, 0], corners: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], uvs: rect(u + d + w, v + d, u + 2 * d + w, v + d + h) },
    { name: 'back', area: w * h, normal: [0, 0, -1], corners: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], uvs: rect(u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h) },
    { name: 'top', area: w * d, normal: [0, 1, 0], corners: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], uvs: rect(u + d, v, u + d + w, v + d) },
    { name: 'bottom', area: w * d, normal: [0, -1, 0], corners: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uvs: rect(u + d + w, v, u + d + 2 * w, v + d) },
  ];
  // Würfel mit einer Kante 0 sind zweiseitige Flächen (ohne Culling, z. B. Flügel)
  const plane = w === 0 || h === 0 || d === 0;
  return faces
    .filter((f) => f.area > 0)
    .map(({ name, corners, uvs, normal }) => {
      if (!cube.mirror) return { name, corners, uvs, normal, mirrored: false, plane };
      const flip = (p) => [x0 + x1 - p[0], p[1], p[2]];
      return { name, corners: corners.map(flip), uvs, normal: [-normal[0], normal[1], normal[2]], mirrored: true, plane };
    });
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

/** Lage aller Bones zur Zeit t (Sekunden): Map name → { rotation (Grad), offset (Pixel) }. */
export function cosmeticPose(model, animations, t, flapFactor = 1) {
  const pose = new Map();
  for (const bone of model.bones) pose.set(bone.name, { rotation: [...bone.rotation], offset: [0, 0, 0] });
  for (const a of animations) {
    const p = pose.get(a.bone);
    if (!p) continue;
    const axis = AXIS_INDEX[a.axis];
    const speed = a.type === 'flap' ? a.speed * Math.min(2, Math.max(1, flapFactor)) : a.speed;
    const wave = Math.sin(2 * Math.PI * (speed * t + a.phase));
    if (a.type === 'spin') p.rotation[axis] += 360 * ((speed * t + a.phase) % 1);
    else if (a.type === 'bob') p.offset[axis] += a.amplitude * wave;
    else p.rotation[axis] += a.amplitude * wave;
  }
  return pose;
}

const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** 4×4-Matrizen spaltenweise (wie three.js/WebGL): m[spalte * 4 + zeile]. */
export function mat4Multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

function rotationMatrix(axis, degrees) {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  if (axis === 0) return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  if (axis === 1) return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function mat4Apply(m, p, w = 1) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w, m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w, m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w];
}

/**
 * Matrix jedes Bones (Modellkoordinaten), Eltern zuerst; pose aus cosmeticPose() oder Ruhelage. Enthält schon
 * model.scale (wie launcher/src/main/core/cosmetics.ts): Ergebnis = S(scale) · Matrix des Bones, jede Kette beginnt mit
 * S statt der Einheitsmatrix – das ganze Modell wird um den Anker skaliert. Beim Begleiter kommt companion.scale dazu.
 */
export function cosmeticBoneMatrices(model, pose) {
  const matrices = new Map();
  const s = model.scale ?? 1;
  const root = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  for (const bone of model.bones) {
    const p = pose?.get(bone.name) ?? { rotation: bone.rotation, offset: [0, 0, 0] };
    const parent = bone.parent ? (matrices.get(bone.parent) ?? root) : root;
    let m = mat4Multiply(parent, translation(bone.pivot[0] + p.offset[0], bone.pivot[1] + p.offset[1], bone.pivot[2] + p.offset[2]));
    m = mat4Multiply(m, rotationMatrix(2, p.rotation[2]));
    m = mat4Multiply(m, rotationMatrix(1, p.rotation[1]));
    m = mat4Multiply(m, rotationMatrix(0, p.rotation[0]));
    m = mat4Multiply(m, translation(-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]));
    matrices.set(bone.name, m);
  }
  return matrices;
}

/** Dauer einer Schleife aller Animationen in Sekunden (0 = keine Bewegung). */
export function cosmeticLoopSeconds(animations) {
  const speeds = animations.map((a) => a.speed).filter((s) => s > 0);
  return speeds.length ? 1 / Math.min(...speeds) : 0;
}

// ---------------------------------------------------------------------------------------------------------
// Format 2: Mesh, Knochen, Keyframes (wie launcher/src/renderer/cosmetic-mesh.ts)
//
// Body-Modellraum in Pixeln: Ursprung Hals-Pivot, +X links, +Y unten, +Z hinten (die Szene hat +Y oben, +Z vorn:
// (x, −y, −z)). Begleiter: Ecken, pivot und tail zählen relativ zu attach.origin. Zwischen Keys slerp bzw. linear;
// nach dem letzten Key: loop → zurück auf Key 0 interpolieren (Frame frames = Frame 0, wie Blender), sonst halten.
// Frame = Sekunden × fps, loop → modulo frames, sonst am letzten Frame halten. W_b = W_eltern · T(move) · T(pivot) · R · S · T(−pivot); v' = W_knochen · v (weiche Haut:
// Σ wᵢ · W_jointᵢ · v). Leuchten: Bild ⌊Ticks / frametimeTicks⌋ mod frames, Stärke min + (max − min)(½ + ½ sin(2πt/period)).
// ---------------------------------------------------------------------------------------------------------

/** Lage eines Knochens in einer Pose: qx, qy, qz, qw, mx, my, mz, s */
const POSE_STRIDE = 8;

function meshBytes(base64) {
  const bytes = base64 ? decodeBase64(base64) : null;
  if (!bytes) throw new CosmeticError('Das Mesh ließ sich nicht lesen.', 'manifest');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function meshChannel(track, kind) {
  if (!track) return null;
  const keyView = meshBytes(track.keys);
  const count = keyView.byteLength / 2;
  const keys = new Uint16Array(count);
  for (let k = 0; k < count; k++) keys[k] = keyView.getUint16(k * 2, true);
  const view = meshBytes(track.values);
  const stride = kind === 'rot' ? 4 : kind === 'move' ? 3 : 1;
  const values = new Float32Array(count * stride);
  for (let k = 0; k < count * stride; k++) {
    if (kind === 'rot') values[k] = view.getInt16(k * 2, true) / 32767;
    else if (kind === 'move') values[k] = view.getInt16(k * 2, true) / 32;
    else values[k] = view.getUint16(k * 2, true) / 1000;
  }
  if (kind === 'rot') {
    for (let k = 0; k < count; k++) {
      const o = k * 4;
      const length = Math.hypot(values[o], values[o + 1], values[o + 2], values[o + 3]) || 1;
      for (let c = 0; c < 4; c++) values[o + c] /= length;
    }
  }
  return { keys, values, stride };
}

const meshRigs = new WeakMap();

/**
 * Geprüftes Format-2-Manifest → Zahlenfelder (einmal je Manifest): { vertexCount, triangleCount, positions (Pixel, Body-
 * Raum), normals, uvs (v = 0 oben), bone, joints, weights, triangles, parents, pivots, clips (Reihenfolge des
 * Manifests), byName, states, blendSeconds, emissive, offset (attach.origin), mirrored (attach.side right) }.
 */
export function meshRig(manifest) {
  if (meshRigs.has(manifest)) return meshRigs.get(manifest);
  const { mesh } = manifest;
  const n = mesh.vertexCount;
  const boneCount = manifest.bones.length;
  const positionsView = meshBytes(mesh.positions);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) positions[i] = positionsView.getInt16(i * 2, true) / 32;
  const normalView = meshBytes(mesh.normals);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) normals[i] = normalView.getInt8(i) / 127;
  const uvView = meshBytes(mesh.uvs);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i++) uvs[i] = uvView.getUint16(i * 2, true) / 65535;
  const boneView = meshBytes(mesh.bones);
  const bone = new Uint8Array(n);
  for (let i = 0; i < n; i++) bone[i] = Math.min(boneCount - 1, boneView.getUint8(i));
  const triangleView = meshBytes(mesh.triangles);
  const triangles = new Uint16Array(mesh.triangleCount * 3);
  for (let i = 0; i < triangles.length; i++) {
    const v = triangleView.getUint16(i * 2, true);
    triangles[i] = v < n ? v : 0;
  }
  let joints = null;
  let weights = null;
  if (mesh.joints && mesh.weights) {
    const jointView = meshBytes(mesh.joints);
    const weightView = meshBytes(mesh.weights);
    joints = new Uint8Array(n * 4);
    weights = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) {
      joints[i] = Math.min(boneCount - 1, jointView.getUint8(i));
      weights[i] = weightView.getUint8(i) / 255;
    }
  }
  const parents = new Int16Array(boneCount);
  const pivots = new Float32Array(boneCount * 3);
  manifest.bones.forEach((b, i) => {
    parents[i] = b.parent >= 0 && b.parent < i ? b.parent : -1;
    pivots.set(b.pivot, i * 3);
  });
  const clips = Object.entries(manifest.animations).map(([name, a]) => {
    const clip = { name, fps: a.fps, frames: a.frames, loop: a.loop, rot: new Array(boneCount).fill(null), move: new Array(boneCount).fill(null), scale: new Array(boneCount).fill(null) };
    for (const track of a.tracks) {
      if (track.bone < 0 || track.bone >= boneCount) continue;
      clip.rot[track.bone] = meshChannel(track.rot, 'rot');
      clip.move[track.bone] = meshChannel(track.move, 'move');
      clip.scale[track.bone] = meshChannel(track.scale, 'scale');
    }
    return clip;
  });
  const { blendSeconds = 0, ...states } = manifest.states ?? {};
  const origin = manifest.slot === 'companion' ? manifest.attach?.origin : null;
  const rig = {
    vertexCount: n,
    triangleCount: mesh.triangleCount,
    positions,
    normals,
    uvs,
    bone,
    joints,
    weights,
    triangles,
    parents,
    pivots,
    clips,
    byName: new Map(clips.map((clip) => [clip.name, clip])),
    states,
    blendSeconds,
    emissive: manifest.emissive ?? null,
    offset: origin ? [origin[0], origin[1], origin[2]] : [0, 0, 0],
    mirrored: manifest.attach?.side === 'right',
  };
  meshRigs.set(manifest, rig);
  return rig;
}

/** Frame-Position (mit Bruchteil) einer Animation nach `seconds` Sekunden. */
export function meshClipFrame(clip, seconds) {
  const f = Math.max(0, seconds) * clip.fps;
  if (clip.loop) return clip.frames > 0 ? f % clip.frames : 0;
  return Math.min(f, Math.max(0, clip.frames - 1));
}

function slerpInto(a, ao, b, bo, t, out, o) {
  let bx = b[bo];
  let by = b[bo + 1];
  let bz = b[bo + 2];
  let bw = b[bo + 3];
  const ax = a[ao];
  const ay = a[ao + 1];
  const az = a[ao + 2];
  const aw = a[ao + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka = 1 - t;
  let kb = t;
  if (cos <= 0.9995) {
    const angle = Math.acos(Math.min(1, cos));
    const sin = Math.sin(angle);
    ka = Math.sin((1 - t) * angle) / sin;
    kb = Math.sin(t * angle) / sin;
  }
  const x = ax * ka + bx * kb;
  const y = ay * ka + by * kb;
  const z = az * ka + bz * kb;
  const w = aw * ka + bw * kb;
  const length = Math.hypot(x, y, z, w) || 1;
  out[o] = x / length;
  out[o + 1] = y / length;
  out[o + 2] = z / length;
  out[o + 3] = w / length;
}

/**
 * Wert einer Spur bei Frame f nach out[o…] (Drehung: slerp, sonst linear). loopFrames (Schleifen: frames der Animation):
 * nach dem letzten Key zurück auf Key 0 bei Frame loopFrames; ohne (null) den letzten Wert halten.
 */
export function sampleMeshChannel(ch, f, out, o, rotation, loopFrames = null) {
  const { keys, values, stride } = ch;
  const last = keys.length - 1;
  if (loopFrames !== null && f > keys[last] && loopFrames > keys[last]) {
    const t = Math.min(1, (f - keys[last]) / (loopFrames - keys[last]));
    if (rotation) slerpInto(values, last * stride, values, 0, t, out, o);
    else for (let c = 0; c < stride; c++) out[o + c] = values[last * stride + c] + (values[c] - values[last * stride + c]) * t;
    return;
  }
  let i;
  if (f <= keys[0]) i = -1;
  else if (f >= keys[last]) i = last;
  else {
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] <= f) lo = mid;
      else hi = mid;
    }
    i = lo;
  }
  if (i < 0 || i >= last) {
    const k = i < 0 ? 0 : last;
    for (let c = 0; c < stride; c++) out[o + c] = values[k * stride + c];
    return;
  }
  const t = (f - keys[i]) / (keys[i + 1] - keys[i]);
  if (rotation) slerpInto(values, i * stride, values, (i + 1) * stride, t, out, o);
  else for (let c = 0; c < stride; c++) out[o + c] = values[i * stride + c] + (values[(i + 1) * stride + c] - values[i * stride + c]) * t;
}

function restMeshPose(bones) {
  const pose = new Float32Array(bones * POSE_STRIDE);
  for (let b = 0; b < bones; b++) {
    pose[b * POSE_STRIDE + 3] = 1;
    pose[b * POSE_STRIDE + 7] = 1;
  }
  return pose;
}

/** Lage aller Knochen einer Animation nach `seconds` Sekunden (ohne Spur: Ruhelage). */
export function sampleMeshPose(rig, clip, seconds, out = restMeshPose(rig.parents.length)) {
  const f = meshClipFrame(clip, seconds);
  const wrap = clip.loop ? clip.frames : null;
  for (let b = 0; b < rig.parents.length; b++) {
    const o = b * POSE_STRIDE;
    if (clip.rot[b]) sampleMeshChannel(clip.rot[b], f, out, o, true, wrap);
    else out.set([0, 0, 0, 1], o);
    if (clip.move[b]) sampleMeshChannel(clip.move[b], f, out, o + 4, false, wrap);
    else out.set([0, 0, 0], o + 4);
    if (clip.scale[b]) sampleMeshChannel(clip.scale[b], f, out, o + 7, false, wrap);
    else out[o + 7] = 1;
  }
  return out;
}

/** Überblenden from → to (w 0 … 1). */
export function blendMeshPose(from, to, w, out) {
  for (let o = 0; o < out.length; o += POSE_STRIDE) {
    slerpInto(from, o, to, o, w, out, o);
    for (let c = 4; c < POSE_STRIDE; c++) out[o + c] = from[o + c] + (to[o + c] - from[o + c]) * w;
  }
  return out;
}

/** Matrizen aller Knochen (je 16 Werte, spaltenweise) im Body-Modellraum. */
export function meshBoneMatrices(rig, pose, out = new Float32Array(rig.parents.length * 16)) {
  const local = new Float32Array(16);
  for (let b = 0; b < rig.parents.length; b++) {
    const p = b * POSE_STRIDE;
    const x = pose[p];
    const y = pose[p + 1];
    const z = pose[p + 2];
    const w = pose[p + 3];
    const s = pose[p + 7];
    const px = rig.pivots[b * 3];
    const py = rig.pivots[b * 3 + 1];
    const pz = rig.pivots[b * 3 + 2];
    local[0] = (1 - 2 * (y * y + z * z)) * s;
    local[1] = 2 * (x * y + z * w) * s;
    local[2] = 2 * (x * z - y * w) * s;
    local[3] = 0;
    local[4] = 2 * (x * y - z * w) * s;
    local[5] = (1 - 2 * (x * x + z * z)) * s;
    local[6] = 2 * (y * z + x * w) * s;
    local[7] = 0;
    local[8] = 2 * (x * z + y * w) * s;
    local[9] = 2 * (y * z - x * w) * s;
    local[10] = (1 - 2 * (x * x + y * y)) * s;
    local[11] = 0;
    local[12] = px + pose[p + 4] - (local[0] * px + local[4] * py + local[8] * pz);
    local[13] = py + pose[p + 5] - (local[1] * px + local[5] * py + local[9] * pz);
    local[14] = pz + pose[p + 6] - (local[2] * px + local[6] * py + local[10] * pz);
    local[15] = 1;
    const parent = rig.parents[b];
    const o = b * 16;
    if (parent < 0) out.set(local, o);
    else {
      const q = parent * 16;
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) out[o + c * 4 + r] = out[q + r] * local[c * 4] + out[q + 4 + r] * local[c * 4 + 1] + out[q + 8 + r] * local[c * 4 + 2] + out[q + 12 + r] * local[c * 4 + 3];
      }
    }
  }
  return out;
}

/** Ecken und Normalen mit den Knochen-Matrizen bewegen (starr; weiche Haut: gewichtete Summe). */
export function skinMeshRig(rig, matrices, positions, normals) {
  const src = rig.positions;
  const nrm = rig.normals;
  const { joints, weights } = rig;
  const m3 = new Float32Array(12);
  for (let i = 0; i < rig.vertexCount; i++) {
    if (joints && weights) {
      m3.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = weights[i * 4 + k];
        if (w <= 0) continue;
        const j = joints[i * 4 + k] * 16;
        for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) m3[c * 3 + r] += w * matrices[j + c * 4 + r];
      }
    } else {
      const j = rig.bone[i] * 16;
      for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) m3[c * 3 + r] = matrices[j + c * 4 + r];
    }
    const o = i * 3;
    const x = src[o];
    const y = src[o + 1];
    const z = src[o + 2];
    positions[o] = m3[0] * x + m3[3] * y + m3[6] * z + m3[9];
    positions[o + 1] = m3[1] * x + m3[4] * y + m3[7] * z + m3[10];
    positions[o + 2] = m3[2] * x + m3[5] * y + m3[8] * z + m3[11];
    const nx = nrm[o];
    const ny = nrm[o + 1];
    const nz = nrm[o + 2];
    const ax = m3[0] * nx + m3[3] * ny + m3[6] * nz;
    const ay = m3[1] * nx + m3[4] * ny + m3[7] * nz;
    const az = m3[2] * nx + m3[5] * ny + m3[8] * nz;
    const length = Math.hypot(ax, ay, az) || 1;
    normals[o] = ax / length;
    normals[o + 1] = ay / length;
    normals[o + 2] = az / length;
  }
}

/** Bild des Leucht-Streifens nach `seconds` Sekunden. */
export function meshGlowFrame(emissive, seconds) {
  if (!emissive || emissive.frames <= 1) return 0;
  return Math.floor((Math.max(0, seconds) * 20) / emissive.frametimeTicks) % emissive.frames;
}

/** Stärke des Leuchtens (Puls) nach `seconds` Sekunden; ohne Puls 1. */
export function meshGlowIntensity(emissive, seconds) {
  const pulse = emissive?.pulse;
  if (!pulse) return 1;
  return pulse.min + (pulse.max - pulse.min) * (0.5 + 0.5 * Math.sin((2 * Math.PI * seconds) / pulse.period));
}

/** Animation eines Zustands (fehlt er: Idle). */
export function meshStateClip(rig, state) {
  return rig.byName.get(rig.states[state] ?? '') ?? rig.byName.get(rig.states.idle ?? '') ?? rig.clips[0] ?? null;
}

/**
 * Animationen eines Format-2-Cosmetics für die Auswahl: [{ name, loop, seconds }] in der Reihenfolge des Manifests,
 * dazu idle und emote (Namen der Zustände). Format 1: null.
 */
export function cosmeticAnimations(manifest) {
  if (manifest?.format !== 2) return null;
  const rig = meshRig(manifest);
  return {
    clips: rig.clips.map((clip) => ({ name: clip.name, loop: clip.loop, seconds: (clip.loop ? clip.frames : Math.max(1, clip.frames - 1)) / clip.fps })),
    idle: meshStateClip(rig, 'idle')?.name ?? null,
    emote: rig.byName.has(rig.states.emote ?? '') ? rig.states.emote : null,
  };
}

/**
 * Knöpfe für die Auswahl der Animation (Format 2, Klasse anim-chip): info aus cosmeticAnimations(), active = gewählter
 * Name, onPick(name). Einmalige Animationen tragen „1×“ (laufen einmal und kehren dann zurück).
 */
export function animationButtons(info, active, onPick) {
  const seconds = (s) => s.toFixed(1).replace('.', ',');
  return info.clips.map((clip) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anim-chip';
    button.dataset.animation = clip.name;
    button.setAttribute('aria-pressed', String(clip.name === active));
    button.title = clip.loop ? `${clip.name} abspielen (${seconds(clip.seconds)} s, Schleife)` : `${clip.name} einmal abspielen (${seconds(clip.seconds)} s), danach zurück`;
    button.append(clip.name);
    if (!clip.loop) {
      const once = document.createElement('span');
      once.className = 'anim-once';
      once.textContent = '1×';
      button.append(once);
    }
    button.addEventListener('click', () => onPick(clip.name));
    return button;
  });
}

/**
 * Spielt Animationen wie im Spiel: Wechsel mit Überblenden (blendSeconds), einmalige Animationen laufen zu Ende und
 * kehren zur gewählten Schleife zurück (start_flying → danach der Elytra-Zustand, falls es ihn gibt).
 */
export class MeshAnimator {
  constructor(rig, initial = null) {
    this.rig = rig;
    const bones = rig.parents.length;
    this.target = restMeshPose(bones);
    this.pose = restMeshPose(bones);
    this.base = (initial ? rig.byName.get(initial) : null) ?? meshStateClip(rig, 'idle');
    this.clip = this.base;
    this.started = 0;
    this.blendStart = -1;
    this.blendFrom = null;
    this.update(0);
  }

  get current() {
    return this.clip?.name ?? null;
  }

  get chosen() {
    return this.base?.name ?? null;
  }

  /** Animation wechseln (now in Sekunden). restart: von vorn; immediate: ohne Überblenden. */
  play(name, now, { restart = false, immediate = false } = {}) {
    const next = this.rig.byName.get(name);
    if (!next) return;
    if (next.loop) this.base = next;
    if (next === this.clip && !restart) return;
    this.blendFrom = immediate ? null : new Float32Array(this.pose);
    this.blendStart = this.rig.blendSeconds > 0 && this.blendFrom ? now : -1;
    this.clip = next;
    this.started = now;
  }

  update(now) {
    const clip = this.clip;
    if (!clip) return this.pose;
    if (!clip.loop && (now - this.started) * clip.fps >= clip.frames - 1) {
      const after = this.rig.states.start_flying === clip.name ? (this.rig.byName.get(this.rig.states.elytra ?? '') ?? this.base) : this.base;
      if (after && after !== clip) {
        if (this.blendStart < 0) this.pose.set(sampleMeshPose(this.rig, clip, now - this.started, this.target));
        this.play(after.name, now);
      }
    }
    sampleMeshPose(this.rig, this.clip, now - this.started, this.target);
    if (this.blendStart >= 0 && this.blendFrom) {
      const w = (now - this.blendStart) / this.rig.blendSeconds;
      if (w >= 1) {
        this.blendStart = -1;
        this.blendFrom = null;
        this.pose.set(this.target);
      } else blendMeshPose(this.blendFrom, this.target, Math.max(0, w), this.pose);
    } else this.pose.set(this.target);
    return this.pose;
  }
}

/** Bewegte Ecken einer Pose (Body-Raum, Pixel; Begleiter schon um attach.origin verschoben). */
function skinnedMesh(rig, pose) {
  const matrices = meshBoneMatrices(rig, pose);
  const positions = new Float32Array(rig.vertexCount * 3);
  const normals = new Float32Array(rig.vertexCount * 3);
  skinMeshRig(rig, matrices, positions, normals);
  const [ox, oy, oz] = rig.offset;
  if (ox || oy || oz) {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += ox;
      positions[i + 1] += oy;
      positions[i + 2] += oz;
    }
  }
  if (rig.mirrored) {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = -positions[i];
      normals[i] = -normals[i];
    }
  }
  return { positions, normals };
}

// ---------------------------------------------------------------------------------------------------------
// 2D-Vorschau (Vorschaubilder und Ersatz ohne WebGL): Würfel schräg von vorn bzw. hinten, Partikel, Cape-Vorderseite
// ---------------------------------------------------------------------------------------------------------

const shadedCache = new WeakMap();

/** Textur in drei Helligkeiten (oben, Seiten, unten) wie im Spiel; Ergebnis zwischengespeichert. */
function shadedTextures(image) {
  if (shadedCache.has(image)) return shadedCache.get(image);
  const levels = [1, 0.82, 0.64].map((factor) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    if (factor < 1) {
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] *= factor;
        data.data[i + 1] *= factor;
        data.data[i + 2] *= factor;
      }
      context.putImageData(data, 0, 0);
    }
    return canvas;
  });
  shadedCache.set(image, levels);
  return levels;
}

/** Sprite-Streifen eines Aura-Cosmetics: je Bild eine getönte Leinwand (mit Leuchtebene). */
function auraFrames(item) {
  const { manifest, texture, glow } = item;
  const frames = manifest.particles.frames;
  const size = texture.naturalHeight;
  const tint = manifest.particles.color;
  const tr = Number.parseInt(tint.slice(1, 3), 16) / 255;
  const tg = Number.parseInt(tint.slice(3, 5), 16) / 255;
  const tb = Number.parseInt(tint.slice(5, 7), 16) / 255;
  const out = [];
  for (let f = 0; f < frames; f++) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.drawImage(texture, f * size, 0, size, size, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] *= tr;
      data.data[i + 1] *= tg;
      data.data[i + 2] *= tb;
    }
    context.putImageData(data, 0, 0);
    if (glow) {
      context.globalCompositeOperation = 'lighter';
      context.drawImage(glow, f * size, 0, size, size, 0, 0, size, size);
    }
    out.push(canvas);
  }
  return out;
}

const auraCache = new WeakMap();
function auraFramesCached(item) {
  if (!auraCache.has(item)) auraCache.set(item, auraFrames(item));
  return auraCache.get(item);
}

/** Wie Slots am besten zu sehen sind (Drehung um y in Rad; 0 = von vorn). */
const PREVIEW_YAW = { head: -0.55, back: Math.PI - 0.6, companion: -0.6, aura: -0.45 };
/** Format 2: Neigung von oben je Slot (Auren steiler, damit der Boden-Kreis zu sehen ist). */
const MESH_PITCH = { aura: 0.62 };

const texelCache = new WeakMap();
/** Farbe eines Texels (für Dreiecke ohne UV-Fläche): [r, g, b, a] 0–255. */
function texel(image, u, v) {
  let data = texelCache.get(image);
  if (!data) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    data = context.getImageData(0, 0, canvas.width, canvas.height);
    texelCache.set(image, data);
  }
  const x = Math.min(data.width - 1, Math.max(0, Math.floor(u * data.width)));
  const y = Math.min(data.height - 1, Math.max(0, Math.floor(v * data.height)));
  const i = (y * data.width + x) * 4;
  return [data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]];
}

/**
 * 2D-Vorschau eines Format-2-Cosmetics: Pose der Animation (Standard: Zustand idle) zur Zeit t, Dreiecke von hinten nach
 * vorn (beidseitig), Textur je Dreieck affin abgebildet, drei Helligkeiten nach der Normalen wie Format 1, Leuchten
 * aufaddiert (Bild des Streifens und Puls zur Zeit t).
 */
function drawMeshPreview(context, W, H, item, { t, yaw, pitch, padding, animation }) {
  const { manifest } = item;
  const rig = meshRig(manifest);
  const clip = (animation && rig.byName.get(animation)) || meshStateClip(rig, 'idle');
  const pose = clip ? sampleMeshPose(rig, clip, t) : restMeshPose(rig.parents.length);
  const { positions, normals } = skinnedMesh(rig, pose);
  const view = yaw ?? PREVIEW_YAW[manifest.slot] ?? -0.55;
  const tilt = pitch ?? MESH_PITCH[manifest.slot] ?? 0.42;
  const cy = Math.cos(view);
  const sy = Math.sin(view);
  const cp = Math.cos(tilt);
  const sp = Math.sin(tilt);
  const n = rig.vertexCount;
  // Body-Raum (x, y unten, z hinten) → Szene (x, −y, −z) → um y drehen, von oben neigen; z zum Betrachter
  const projected = new Float32Array(n * 3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = -positions[i * 3 + 1];
    const z = -positions[i * 3 + 2];
    const px = x * cy + z * sy;
    const z0 = -x * sy + z * cy;
    const py = y * cp - z0 * sp;
    projected[i * 3] = px;
    projected[i * 3 + 1] = py;
    projected[i * 3 + 2] = y * sp + z0 * cp;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  if (!Number.isFinite(minX)) return false;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((W * (1 - padding * 2)) / spanX, (H * (1 - padding * 2)) / spanY);
  const offX = W / 2 - ((minX + maxX) / 2) * scale;
  const offY = H / 2 + ((minY + maxY) / 2) * scale;
  const order = [];
  for (let k = 0; k < rig.triangleCount; k++) {
    const a = rig.triangles[k * 3];
    const b = rig.triangles[k * 3 + 1];
    const c = rig.triangles[k * 3 + 2];
    const depth = projected[a * 3 + 2] + projected[b * 3 + 2] + projected[c * 3 + 2];
    // Helligkeit nach der (flachen) Normalen in der Szene: oben hell, unten dunkel, Seiten dazwischen
    const up = -(normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1]) / 3;
    order.push({ a, b, c, depth, light: up > 0.55 ? 0 : up < -0.55 ? 2 : 1 });
  }
  order.sort((p, q) => p.depth - q.depth);
  const shades = shadedTextures(item.texture);
  const tw = item.texture.naturalWidth;
  const th = item.texture.naturalHeight;
  const glow = item.glow;
  const frames = Math.max(1, manifest.emissive?.frames ?? 1);
  const glowFrame = meshGlowFrame(manifest.emissive, t);
  const glowAlpha = Math.min(1, meshGlowIntensity(manifest.emissive, t));
  const screen = (i) => [offX + projected[i * 3] * scale, offY - projected[i * 3 + 1] * scale];
  const FACTORS = [1, 0.82, 0.64];
  for (const tri of order) {
    const p = [screen(tri.a), screen(tri.b), screen(tri.c)];
    const area = Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]));
    if (area < 0.01) continue;
    const uv = [tri.a, tri.b, tri.c].map((i) => [rig.uvs[i * 2] * tw, rig.uvs[i * 2 + 1] * th]);
    // gegen Haarrisse: Dreieck um ~0,6 Pixel vom Schwerpunkt weg vergrößern
    const cx = (p[0][0] + p[1][0] + p[2][0]) / 3;
    const cyy = (p[0][1] + p[1][1] + p[2][1]) / 3;
    const grown = p.map(([x, y]) => {
      const d = Math.hypot(x - cx, y - cyy) || 1;
      return [x + ((x - cx) / d) * 0.6, y + ((y - cyy) / d) * 0.6];
    });
    context.save();
    context.beginPath();
    context.moveTo(grown[0][0], grown[0][1]);
    context.lineTo(grown[1][0], grown[1][1]);
    context.lineTo(grown[2][0], grown[2][1]);
    context.closePath();
    const det = (uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1]);
    if (Math.abs(det) < 1e-6) {
      // keine UV-Fläche (z. B. Kante eines Pixel-Sprites): einfarbig mit dem Texel in der Mitte
      const [r, g, b, alpha] = texel(item.texture, (uv[0][0] + uv[1][0] + uv[2][0]) / 3 / tw, (uv[0][1] + uv[1][1] + uv[2][1]) / 3 / th);
      if (alpha >= 26) {
        const f = FACTORS[tri.light];
        context.fillStyle = `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
        context.fill();
      }
      context.restore();
      continue;
    }
    context.clip();
    const solve = (k) => [
      ((p[1][k] - p[0][k]) * (uv[2][1] - uv[0][1]) - (p[2][k] - p[0][k]) * (uv[1][1] - uv[0][1])) / det,
      ((p[2][k] - p[0][k]) * (uv[1][0] - uv[0][0]) - (p[1][k] - p[0][k]) * (uv[2][0] - uv[0][0])) / det,
    ];
    const [a, c] = solve(0);
    const [b, d] = solve(1);
    context.setTransform(a, b, c, d, p[0][0] - a * uv[0][0] - c * uv[0][1], p[0][1] - b * uv[0][0] - d * uv[0][1]);
    context.drawImage(shades[tri.light], 0, 0);
    if (glow) {
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = glowAlpha;
      context.drawImage(glow, 0, glowFrame * (glow.naturalHeight / frames), glow.naturalWidth, glow.naturalHeight / frames, 0, 0, tw, th);
    }
    context.restore();
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  return true;
}

/**
 * Zeichnet eine 2D-Vorschau auf canvas (Größe aus canvas.width/height). prepared: aus prepareCosmetic() oder
 * prepareBuiltinCape(). options: { t (Sekunden, Animationen und Cape-Bild), yaw, pitch, padding (0–0.4), animation
 * (Format 2: Name der Animation; Standard: Zustand idle) }.
 */
export function drawCosmeticPreview(canvas, item, { t = 0, yaw, pitch, padding = 0.12, animation = null } = {}) {
  const context = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, W, H);
  context.imageSmoothingEnabled = false;
  if (item.kind === 'builtin-cape' || item.manifest.slot === 'cape') {
    // Vorderseite des Capes (Außenseite: Fläche 1,1 – 10 × 16 im 64 × 32-Raster)
    const { texture, glow, frames, fps } = capeSource(item);
    const frame = Math.floor(t * fps) % frames;
    const fh = texture.naturalHeight / frames;
    const scale = texture.naturalWidth / 64;
    const ratio = 10 / 16;
    const h = H * (1 - padding * 2);
    const w = h * ratio;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    context.imageSmoothingEnabled = item.kind === 'builtin-cape';
    context.drawImage(texture, scale, frame * fh + scale, 10 * scale, 16 * scale, x, y, w, h);
    if (glow) {
      context.globalCompositeOperation = 'lighter';
      const gfh = glow.naturalHeight / frames;
      const gs = glow.naturalWidth / 64;
      context.drawImage(glow, gs, frame * gfh + gs, 10 * gs, 16 * gs, x, y, w, h);
      context.globalCompositeOperation = 'source-over';
    }
    return true;
  }
  const { manifest } = item;
  if (manifest.format === 2) return drawMeshPreview(context, W, H, item, { t, yaw, pitch, padding, animation });
  pitch ??= 0.42;
  if (manifest.slot === 'aura') {
    const frames = auraFramesCached(item);
    const count = 7;
    const base = Math.min(W, H);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + t * 0.8;
      const r = base * (0.18 + 0.16 * ((i * 37) % 5) / 4);
      const size = base * (0.2 + 0.12 * ((i * 53) % 3) / 2);
      const frame = frames[(i + Math.floor(t * 6)) % frames.length];
      context.drawImage(frame, W / 2 + Math.cos(angle) * r - size / 2, H / 2 + Math.sin(angle) * r * 0.8 - size / 2, size, size);
    }
    return true;
  }
  const { model, animations } = manifest;
  // UV zählt in Texeln von textureSize; das Bild kann die 2- oder 4-fache Auflösung haben
  const res = item.texture.naturalWidth / model.textureSize[0];
  const matrices = cosmeticBoneMatrices(model, cosmeticPose(model, animations, t));
  const view = yaw ?? PREVIEW_YAW[manifest.slot] ?? -0.55;
  const cy = Math.cos(view);
  const sy = Math.sin(view);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Blick von +Z: erst um y drehen, dann nach unten neigen (von schräg oben)
  const project = (p) => {
    const x = p[0] * cy + p[2] * sy;
    const z0 = -p[0] * sy + p[2] * cy;
    const y = p[1] * cp - z0 * sp;
    const z = p[1] * sp + z0 * cp;
    return [x, y, z];
  };
  const shades = shadedTextures(item.texture);
  const glows = item.glow ? shadedTextures(item.glow) : null;
  const faces = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const bone of model.bones) {
    const m = matrices.get(bone.name);
    for (const cube of bone.cubes) {
      for (const face of cosmeticCubeFaces(cube)) {
        const lift = face.plane ? 0.02 : 0;
        const corners = face.corners.map((c) => project(mat4Apply(m, [c[0] + face.normal[0] * lift, c[1] + face.normal[1] * lift, c[2] + face.normal[2] * lift])));
        const normal = project(mat4Apply(m, face.normal, 0));
        for (const [x, y] of corners) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        if (normal[2] <= 1e-4 && !face.plane) continue; // Rückseite (zweiseitige Ebenen bleiben)
        const depth = corners.reduce((sum, c) => sum + c[2], 0) / 4;
        const light = face.name === 'top' ? 0 : face.name === 'bottom' ? 2 : 1;
        faces.push({ corners, uvs: face.uvs, depth, light });
      }
    }
  }
  if (!faces.length || !Number.isFinite(minX)) return false;
  faces.sort((a, b) => a.depth - b.depth);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((W * (1 - padding * 2)) / spanX, (H * (1 - padding * 2)) / spanY);
  const offX = W / 2 - ((minX + maxX) / 2) * scale;
  const offY = H / 2 + ((minY + maxY) / 2) * scale;
  const toScreen = ([x, y]) => [offX + x * scale, offY - y * scale];
  // Kleine Überlappung gegen Haarrisse zwischen den Flächen
  const grow = 0.6 / scale;
  for (const face of faces) {
    const [p0, p1, , p3] = face.corners.map(toScreen);
    const [[u0, v0], , [u1, v1]] = face.uvs;
    const sw = u1 - u0;
    const sh = v1 - v0;
    const draw = (source) => {
      context.setTransform(p1[0] - p0[0], p1[1] - p0[1], p3[0] - p0[0], p3[1] - p0[1], p0[0], p0[1]);
      context.drawImage(source, u0 * res, v0 * res, sw * res, sh * res, -grow / sw, -grow / sh, 1 + (2 * grow) / sw, 1 + (2 * grow) / sh);
    };
    context.globalCompositeOperation = 'source-over';
    draw(shades[face.light]);
    if (glows) {
      context.globalCompositeOperation = 'lighter';
      draw(glows[0]);
    }
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// 3D: Meshes, Animationen und Partikel auf einem skinview3d.SkinViewer
//
// skinview3d bringt three.js mit, gibt es aber nicht heraus. Die nötigen Klassen (Group, Mesh, BufferGeometry, …)
// kommen deshalb von Objekten, die skinview3d selbst angelegt hat.
// ---------------------------------------------------------------------------------------------------------

const NEAREST_FILTER = 1003;
const FRONT_SIDE = 0;
const DOUBLE_SIDE = 2;
const ADDITIVE_BLENDING = 2;
const CAPE_W = 512;
const CAPE_H = 256;
const MAX_PARTICLES = 64;

function threeFrom(viewer, lib) {
  const player = viewer.playerObject;
  const inner = player?.skin?.head?.innerLayer;
  if (!inner?.geometry || !viewer.playerWrapper) return null;
  const tag = lib?.NameTagObject ? new lib.NameTagObject('', { repaintAfterLoaded: false }) : null;
  const three = {
    Group: viewer.playerWrapper.constructor,
    Mesh: inner.constructor,
    BufferGeometry: Object.getPrototypeOf(inner.geometry.constructor),
    Float32BufferAttribute: inner.geometry.getAttribute('position').constructor,
    MeshStandardMaterial: player.skin.layer1Material.constructor,
    Sprite: tag ? Object.getPrototypeOf(tag.constructor) : null,
    SpriteMaterial: tag?.material?.constructor ?? null,
    CanvasTexture: tag?.material?.map?.constructor ?? viewer.capeTexture?.constructor ?? null,
  };
  if (tag) {
    tag.material.map?.dispose();
    tag.material.dispose();
  }
  return Object.values(three).every(Boolean) ? three : null;
}

function makeTexture(three, source, colorSpace) {
  const texture = new three.CanvasTexture(source);
  texture.magFilter = NEAREST_FILTER;
  texture.minFilter = NEAREST_FILTER;
  texture.generateMipmaps = false;
  if (colorSpace !== undefined) texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Geometrie eines Bones: alle Flächen seiner Würfel, Ecken gegen den Uhrzeigersinn (bei Spiegelung umgedreht).
 * planes: nur die Flächen zweiseitiger Ebenen (etwas entlang der Normalen versetzt, damit die Seite zum Betrachter
 * vorn liegt), sonst nur die übrigen. Ohne passende Flächen: null.
 */
function boneGeometry(three, bone, [tw, th], planes) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const cube of bone.cubes) {
    for (const face of cosmeticCubeFaces(cube)) {
      if (face.plane !== planes) continue;
      const lift = face.plane ? 0.02 : 0;
      const base = positions.length / 3;
      face.corners.forEach((corner, i) => {
        positions.push(corner[0] + face.normal[0] * lift, corner[1] + face.normal[1] * lift, corner[2] + face.normal[2] * lift);
        normals.push(face.normal[0], face.normal[1], face.normal[2]);
        uvs.push(face.uvs[i][0] / tw, 1 - face.uvs[i][1] / th);
      });
      // Ecken: oben links, oben rechts, unten rechts, unten links → zwei Dreiecke
      if (face.mirrored) indices.push(base, base + 2, base + 3, base, base + 1, base + 2);
      else indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    }
  }
  if (!positions.length) return null;
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new three.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new three.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Zufallszahlen mit festem Startwert (die Vorschau sieht bei jedem Laden gleich aus). */
function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/**
 * Cosmetics auf einer skinview3d-Figur zeigen. Liefert { supported, wear(slot, item), worn(slot), setPlaying(bool),
 * setElytra(bool), update(dt), animations(slot), setAnimation(slot, name), emote(slot, on), dispose() }. item: aus
 * prepareCosmetic() (alle Slots) oder prepareBuiltinCape() (cape); null legt ab. Die Animation läuft über
 * viewer.animation (FunctionAnimation, mit Ruhe-Animation der Arme, wenn idle: true). Ohne passende three.js-Klassen ist
 * supported false – dann bleibt nur die 2D-Vorschau.
 *
 * Format 2 (manifest.format 2): ein Mesh je Cosmetic, die Ecken bewegt die CPU je Bild mit den Knochen-Matrizen. Der
 * Body-Raum hängt am Rumpf auf Halshöhe (head, back, companion) bzw. am Spielerobjekt auf Halshöhe ohne Rumpf (aura),
 * gedreht um 180° um X. Leuchten: zweites Mesh, additiv ohne Licht, Streifen-Bild über die Textur-Verschiebung, Puls über
 * emissiveIntensity. animations(slot) → { clips, chosen, playing, emote } oder null; setAnimation wählt (null = idle),
 * emote(slot, true) zeigt solange den Zustand emote.
 */
export function createCosmeticLayer(viewer, { skinview3d = globalThis.skinview3d, idle = true, playing = true } = {}) {
  const three = threeFrom(viewer, skinview3d);
  const player = viewer.playerObject;
  const colorSpace = viewer.skinTexture?.colorSpace;
  const state = { playing, time: 0, elytra: false, capeFrame: -1, capeTime: 0 };
  const worn = { head: null, back: null, aura: null, companion: null, cape: null };
  const nodes = { head: null, back: null, aura: null, companion: null };
  /** Format 2: gewählte Animation je Manifest, Emote je Slot */
  const chosenAnimation = new WeakMap();
  const emoting = { head: false, back: false, aura: false, companion: false };
  const capeCanvas = document.createElement('canvas');
  capeCanvas.width = CAPE_W;
  capeCanvas.height = CAPE_H;
  const capeContext = capeCanvas.getContext('2d');
  let capePushed = false;

  const anchors = three
    ? {
        head: Object.assign(new three.Group(), { name: 'heldix-cosmetic-head' }),
        back: Object.assign(new three.Group(), { name: 'heldix-cosmetic-back' }),
        companion: Object.assign(new three.Group(), { name: 'heldix-cosmetic-companion' }),
        aura: Object.assign(new three.Group(), { name: 'heldix-cosmetic-aura' }),
        stand: Object.assign(new three.Group(), { name: 'heldix-cosmetic-stand' }),
      }
    : null;
  if (anchors) {
    anchors.head.position.set(0, 8, 0); // Mitte der Kopf-Oberseite
    player.skin.head.add(anchors.head);
    // Rücken auf Schulterhöhe (Rumpf-Mitte in z, Rückenfläche bei z = -2) = Hals-Pivot des Rumpfs (Ursprung Format 2)
    anchors.back.position.set(0, 6, 0);
    player.skin.body.add(anchors.back);
    player.add(anchors.companion);
    player.add(anchors.aura);
    // Format-2-Auren: Halshöhe am Spielerobjekt (Füße 24 darunter), ohne Rumpf
    anchors.stand.position.set(0, 8, 0);
    player.add(anchors.stand);
  }

  function disposeNode(node) {
    if (!node) return;
    node.root.parent?.remove(node.root);
    for (const geometry of node.geometries ?? []) geometry.dispose();
    for (const material of node.materials ?? []) material.dispose();
    for (const texture of node.textures ?? []) texture.dispose();
  }

  function buildModel(item, anchor) {
    const { manifest } = item;
    const root = new three.Group();
    const texture = makeTexture(three, item.texture, colorSpace);
    const glowTexture = item.glow ? makeTexture(three, item.glow, colorSpace) : null;
    const base = (side) => new three.MeshStandardMaterial({ map: texture, side, transparent: true, alphaTest: 0.02 });
    // Leuchtebene: ohne Licht, aufaddiert (wie die „Augen“-Ebene in Minecraft)
    const glowing = (side) => new three.MeshStandardMaterial({ map: glowTexture, color: 0x000000, emissive: 0xffffff, emissiveMap: glowTexture, side, transparent: true, alphaTest: 0.02, blending: ADDITIVE_BLENDING, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const solid = { material: base(FRONT_SIDE), glow: glowTexture ? glowing(FRONT_SIDE) : null };
    const plane = { material: base(DOUBLE_SIDE), glow: glowTexture ? glowing(DOUBLE_SIDE) : null };
    const materials = [solid.material, solid.glow, plane.material, plane.glow].filter(Boolean);
    const textures = [texture, glowTexture].filter(Boolean);
    const geometries = [];
    const bones = new Map();
    for (const bone of manifest.model.bones) {
      const group = new three.Group();
      group.matrixAutoUpdate = false;
      for (const [planes, set] of [
        [false, solid],
        [true, plane],
      ]) {
        const geometry = bone.cubes.length ? boneGeometry(three, bone, manifest.model.textureSize, planes) : null;
        if (!geometry) continue;
        geometries.push(geometry);
        group.add(new three.Mesh(geometry, set.material));
        if (set.glow) group.add(new three.Mesh(geometry, set.glow));
      }
      root.add(group);
      bones.set(bone.name, group);
    }
    if (manifest.slot === 'companion') {
      const { offset, scale } = manifest.companion;
      // offset in Blöcken: x rechts (= -X im Modell), y hoch ab den Füßen (y = -16), z vorn; companion.scale hier,
      // model.scale steckt schon in den Bone-Matrizen (beide multiplizieren sich)
      root.position.set(-offset[0] * 16, -16 + offset[1] * 16, offset[2] * 16);
      root.scale.setScalar(scale);
    }
    anchor.add(root);
    const node = { item, root, bones, geometries, materials, textures };
    poseModel(node);
    return node;
  }

  function poseModel(node) {
    const { model, animations } = node.item.manifest;
    const matrices = cosmeticBoneMatrices(model, animations.length ? cosmeticPose(model, animations, state.time) : undefined);
    for (const [name, group] of node.bones) {
      group.matrix.fromArray(matrices.get(name));
      group.matrixWorldNeedsUpdate = true;
    }
  }

  /** Format 2: Mesh im Body-Raum (gedreht um 180° um X), Albedo und Leuchten mit derselben Geometrie. */
  function buildMesh(item, slot) {
    const { manifest } = item;
    const rig = meshRig(manifest);
    const root = new three.Group();
    root.rotation.set(Math.PI, 0, 0);
    if (rig.mirrored) root.scale.set(-1, 1, 1);
    const inner = new three.Group();
    inner.position.set(rig.offset[0], rig.offset[1], rig.offset[2]);
    root.add(inner);
    const uvs = new Float32Array(rig.vertexCount * 2);
    for (let i = 0; i < rig.vertexCount; i++) {
      uvs[i * 2] = rig.uvs[i * 2];
      uvs[i * 2 + 1] = 1 - rig.uvs[i * 2 + 1];
    }
    const geometry = new three.BufferGeometry();
    geometry.setAttribute('position', new three.Float32BufferAttribute(rig.positions, 3));
    geometry.setAttribute('normal', new three.Float32BufferAttribute(rig.normals, 3));
    geometry.setAttribute('uv', new three.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(Array.from(rig.triangles));
    const texture = makeTexture(three, item.texture, colorSpace);
    const glowTexture = item.glow ? makeTexture(three, item.glow, colorSpace) : null;
    const base = new three.MeshStandardMaterial({ map: texture, side: DOUBLE_SIDE, alphaTest: 0.1 });
    const materials = [base];
    const mesh = new three.Mesh(geometry, base);
    mesh.frustumCulled = false;
    inner.add(mesh);
    let glowMaterial = null;
    const frames = Math.max(1, rig.emissive?.frames ?? 1);
    if (glowTexture) {
      glowTexture.repeat.set(1, 1 / frames);
      glowTexture.offset.set(0, (frames - 1) / frames);
      // nur das Leuchten: schwarz und metallisch (kein Licht, kein Glanz), Farbe aus emissiveMap, aufaddiert
      glowMaterial = new three.MeshStandardMaterial({ color: 0x000000, metalness: 1, roughness: 1, emissive: 0xffffff, emissiveMap: glowTexture, side: DOUBLE_SIDE, transparent: true, depthWrite: false, blending: ADDITIVE_BLENDING, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      materials.push(glowMaterial);
      const shine = new three.Mesh(geometry, glowMaterial);
      shine.renderOrder = 1;
      shine.frustumCulled = false;
      inner.add(shine);
    }
    (slot === 'aura' ? anchors.stand : anchors.back).add(root);
    const node = {
      kind: 'mesh',
      slot,
      item,
      root,
      rig,
      animator: new MeshAnimator(rig),
      matrices: new Float32Array(rig.parents.length * 16),
      position: geometry.getAttribute('position'),
      normal: geometry.getAttribute('normal'),
      glowMaterial,
      glowTexture,
      frames,
      shownFrame: -1,
      geometries: [geometry],
      materials,
      textures: [texture, glowTexture].filter(Boolean),
    };
    applyAnimation(node, false);
    return node;
  }

  function poseMesh(node) {
    const pose = node.animator.update(state.time);
    meshBoneMatrices(node.rig, pose, node.matrices);
    skinMeshRig(node.rig, node.matrices, node.position.array, node.normal.array);
    node.position.needsUpdate = true;
    node.normal.needsUpdate = true;
    if (node.glowMaterial) {
      const frame = meshGlowFrame(node.rig.emissive, state.time);
      if (frame !== node.shownFrame) {
        node.shownFrame = frame;
        // Bild 0 oben im Streifen; die Textur ist gespiegelt geladen (v = 0 unten)
        node.glowTexture.offset.set(0, (node.frames - 1 - frame) / node.frames);
      }
      node.glowMaterial.emissiveIntensity = meshGlowIntensity(node.rig.emissive, state.time);
    }
  }

  /** Gewählte Animation (bzw. Emote) eines Format-2-Knotens abspielen; im Standbild ohne Überblenden. */
  function applyAnimation(node, restart) {
    const { rig } = node;
    const emote = emoting[node.slot] && rig.byName.has(rig.states.emote ?? '') ? rig.states.emote : null;
    const chosen = chosenAnimation.get(node.item.manifest);
    const name = emote ?? (chosen && rig.byName.has(chosen) ? chosen : meshStateClip(rig, 'idle')?.name);
    const clip = name ? rig.byName.get(name) : null;
    if (clip) node.animator.play(name, state.time, { restart: restart && !clip.loop, immediate: !state.playing });
    poseMesh(node);
  }

  function buildAura(item) {
    const { particles } = item.manifest;
    const root = new three.Group();
    const frames = auraFrames(item);
    const textures = frames.map((canvas) => makeTexture(three, canvas, colorSpace));
    const materials = textures.map((map) => new three.SpriteMaterial({ map, transparent: true, alphaTest: 0.02, depthWrite: false, blending: particles.fullbright ? ADDITIVE_BLENDING : 1 }));
    if (!particles.fullbright) for (const material of materials) material.color.setScalar(0.88);
    anchors.aura.add(root);
    return { item, root, materials, textures, geometries: [], particles: [], spawn: 0, rand: random(item.manifest.id.length * 7919 + item.manifest.version) };
  }

  function spawnParticle(node) {
    const { particles } = node.item.manifest;
    const rand = node.rand;
    const sprite = new three.Sprite(node.materials[0]);
    const r = particles.radius * 16;
    const angle = rand() * Math.PI * 2;
    const life = particles.lifetime / 20;
    const p = { sprite, age: 0, life, angle, radius: r * (0.55 + rand() * 0.45), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, seed: rand() * 10 };
    switch (particles.motion) {
      case 'rise':
        p.y = -15 + rand() * 18;
        p.vy = 9 + rand() * 6;
        break;
      case 'fall':
        p.y = 12 + rand() * 10;
        p.vy = -(7 + rand() * 5);
        break;
      case 'orbit':
        p.radius = r * (0.85 + rand() * 0.15);
        p.y = -12 + rand() * 24;
        p.vy = 1.5;
        break;
      case 'spark': {
        p.radius = r * rand() * 0.8;
        p.y = -8 + rand() * 20;
        const out = 14 + rand() * 14;
        p.vx = Math.cos(angle) * out;
        p.vz = Math.sin(angle) * out;
        p.vy = (rand() - 0.3) * 16;
        break;
      }
      default:
        p.y = -12 + rand() * 26;
        p.vx = (rand() - 0.5) * 5;
        p.vy = (rand() - 0.5) * 4;
        p.vz = (rand() - 0.5) * 5;
    }
    p.x = Math.cos(angle) * p.radius;
    p.z = Math.sin(angle) * p.radius;
    node.root.add(sprite);
    node.particles.push(p);
    placeParticle(node, p);
  }

  function placeParticle(node, p) {
    const { particles } = node.item.manifest;
    const progress = Math.min(1, p.age / p.life);
    const frame = Math.min(node.materials.length - 1, Math.floor(progress * node.materials.length));
    if (p.sprite.material !== node.materials[frame]) p.sprite.material = node.materials[frame];
    const shrink = progress > 0.75 ? 1 - (progress - 0.75) / 0.25 : progress < 0.1 ? progress / 0.1 : 1;
    p.sprite.scale.setScalar(Math.max(0.01, particles.size * 16 * shrink));
    p.sprite.position.set(p.x, p.y, p.z);
  }

  function stepAura(node, dt) {
    const { particles } = node.item.manifest;
    node.spawn += dt * particles.rate;
    while (node.spawn >= 1) {
      node.spawn -= 1;
      if (node.particles.length < MAX_PARTICLES) spawnParticle(node);
    }
    for (const p of node.particles) {
      p.age += dt;
      switch (particles.motion) {
        case 'orbit':
          p.angle += dt * 1.7;
          p.x = Math.cos(p.angle) * p.radius;
          p.z = Math.sin(p.angle) * p.radius;
          p.y += p.vy * dt;
          break;
        case 'fall':
          p.y += p.vy * dt;
          p.x += Math.sin(p.age * 2.4 + p.seed) * 4 * dt;
          p.z += Math.cos(p.age * 2.1 + p.seed) * 4 * dt;
          break;
        case 'spark': {
          const drag = Math.pow(0.12, dt);
          p.vx *= drag;
          p.vz *= drag;
          p.vy = p.vy * drag - 6 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          break;
        }
        case 'float':
          p.vx += Math.sin(p.age * 1.3 + p.seed) * 2 * dt;
          p.vz += Math.cos(p.age * 1.1 + p.seed) * 2 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          break;
        default:
          p.y += p.vy * dt;
          p.x += Math.sin(p.age * 3 + p.seed) * 2 * dt;
      }
      placeParticle(node, p);
    }
    const alive = [];
    for (const p of node.particles) {
      if (p.age < p.life) alive.push(p);
      else node.root.remove(p.sprite);
    }
    node.particles = alive;
  }

  /** Aura ohne Bewegung (angehalten, reduzierte Bewegung): einmal einen ruhigen Kranz zeigen. */
  function settleAura(node) {
    for (const p of node.particles) node.root.remove(p.sprite);
    node.particles = [];
    const count = Math.min(MAX_PARTICLES, Math.max(8, Math.round(node.item.manifest.particles.rate * 2)));
    for (let i = 0; i < count; i++) spawnParticle(node);
    for (const p of node.particles) {
      p.age = p.life * (0.2 + 0.5 * node.rand());
      p.x = Math.cos(p.angle) * p.radius;
      p.z = Math.sin(p.angle) * p.radius;
      placeParticle(node, p);
    }
  }

  function drawCape(force = false) {
    const item = worn.cape;
    if (!item) return;
    const { frames, fps } = capeSource(item);
    const frame = state.playing ? Math.floor(state.capeTime * fps) % frames : 0;
    if (!force && frame === state.capeFrame) return;
    state.capeFrame = frame;
    drawCapeFrame(capeContext, item, frame, CAPE_W, CAPE_H);
    const target = viewer.capeCanvas;
    const texture = viewer.capeTexture;
    if (!force && capePushed && target && texture && target.width === CAPE_W && target.height === CAPE_H) {
      const context = target.getContext('2d');
      context.clearRect(0, 0, CAPE_W, CAPE_H);
      context.drawImage(capeCanvas, 0, 0);
      texture.needsUpdate = true;
      return;
    }
    viewer.loadCape(capeCanvas, { backEquipment: state.elytra ? 'elytra' : 'cape' });
    capePushed = true;
  }

  function update(dt) {
    const step = state.playing ? Math.min(0.1, Math.max(0, dt)) : 0;
    state.time += step;
    state.capeTime += step;
    for (const slot of ['head', 'back', 'aura', 'companion']) {
      const node = nodes[slot];
      if (!node || !step) continue;
      if (node.kind === 'mesh') poseMesh(node);
      else if (slot !== 'aura' && node.item.manifest.animations.length) poseModel(node);
    }
    if (nodes.aura && nodes.aura.kind !== 'mesh' && step) stepAura(nodes.aura, step);
    if (worn.cape && step) drawCape();
  }

  if (skinview3d?.FunctionAnimation) {
    const idleAnimation = idle && skinview3d.IdleAnimation ? new skinview3d.IdleAnimation() : null;
    viewer.animation = new skinview3d.FunctionAnimation((figure, progress, delta) => {
      if (idleAnimation) {
        idleAnimation.progress = progress;
        idleAnimation.animate(figure);
      }
      update(delta);
    });
  }

  return {
    supported: Boolean(three),
    /** Ein Cosmetic in einem Slot zeigen (null = ablegen). Beim Slot cape auch eingebaute Capes. */
    wear(slot, item) {
      if (!COSMETIC_SLOTS.includes(slot)) return;
      worn[slot] = item ?? null;
      if (slot === 'cape') {
        state.capeFrame = -1;
        state.capeTime = 0;
        if (item) drawCape(true);
        else viewer.loadCape(null);
        if (!item) capePushed = false;
        return;
      }
      if (!three) return;
      disposeNode(nodes[slot]);
      nodes[slot] = null;
      if (!item) return;
      if (item.manifest?.format === 2) nodes[slot] = buildMesh(item, slot);
      else if (slot === 'aura') {
        nodes.aura = buildAura(item);
        if (!state.playing) settleAura(nodes.aura);
        else for (let i = 0; i < 12; i++) stepAura(nodes.aura, 0.1);
      } else nodes[slot] = buildModel(item, anchors[slot]);
    },
    worn: (slot) => worn[slot] ?? null,
    /** Format 2: { clips: [Namen], chosen, playing, emote } des getragenen Cosmetics, sonst null */
    animations(slot) {
      const node = nodes[slot];
      if (node?.kind !== 'mesh') return null;
      const { rig } = node;
      const chosen = chosenAnimation.get(node.item.manifest);
      return {
        clips: rig.clips.map((clip) => clip.name),
        chosen: chosen && rig.byName.has(chosen) ? chosen : (meshStateClip(rig, 'idle')?.name ?? null),
        playing: node.animator.current,
        emote: rig.byName.has(rig.states.emote ?? '') ? rig.states.emote : null,
      };
    },
    /** Format 2: Animation wählen (null = Zustand idle); einmalige laufen von vorn und kehren zurück */
    setAnimation(slot, name) {
      const node = nodes[slot];
      if (node?.kind !== 'mesh') return;
      if (name) chosenAnimation.set(node.item.manifest, name);
      else chosenAnimation.delete(node.item.manifest);
      applyAnimation(node, true);
    },
    /** Format 2: solange on, den Zustand emote zeigen (z. B. beim Überfahren der Kachel) */
    emote(slot, on) {
      if (!(slot in emoting) || emoting[slot] === Boolean(on)) return;
      emoting[slot] = Boolean(on);
      if (nodes[slot]?.kind === 'mesh') applyAnimation(nodes[slot], false);
    },
    setPlaying(value) {
      state.playing = Boolean(value);
      if (!state.playing && nodes.aura && nodes.aura.kind !== 'mesh') settleAura(nodes.aura);
      if (worn.cape) drawCape(true);
    },
    setElytra(value) {
      state.elytra = Boolean(value);
      if (worn.cape) drawCape(true);
    },
    update,
    dispose() {
      for (const slot of ['head', 'back', 'aura', 'companion']) disposeNode(nodes[slot]);
      if (anchors) for (const anchor of Object.values(anchors)) anchor.parent?.remove(anchor);
    },
  };
}
