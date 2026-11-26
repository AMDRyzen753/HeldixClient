// HeldixClient – Webseite: gemeinsame Bausteine für Heldix-Cosmetics (öffentlicher Katalog /cosmetics, Auswahl im
// Konto, Vorschau im Team-Bereich).
//
// Ein Cosmetic ist ein signierter Umschlag { manifest: "<JSON-Text>", signature: "<base64>" }. Die Signatur ist
// Ed25519 mit dem Update-Schlüssel über die UTF-8-Bytes von "heldix-cosmetic\n" + manifest. Die Seite zeigt ein
// Cosmetic erst, wenn die Signatur im Browser (WebCrypto) bestätigt ist und das Manifest alle Regeln von Format 1
// erfüllt. Die Prüfregeln sind eine genaue Übertragung von service/src/cosmetics-format.ts (dieselben Grenzen und
// Meldungen wie Dienst, Spiel und Launcher). Den öffentlichen Schlüssel bringt die Seite selbst mit: build.mjs schreibt
// ihn aus launcher/src/main/update-public-key.ts nach /update-key.js – er kommt also nicht vom Dienst, der die Daten
// liefert. Der Team-Bereich kann stattdessen `publicKey` aus GET /v1/team/cosmetics übergeben.
//
// Exporte (stabil, andere Seiten bauen darauf):
//   Konstanten   COSMETIC_SIGNATURE_PREFIX, COSMETIC_TYPE, COSMETIC_FORMAT, COSMETIC_SLOTS, MODEL_SLOTS,
//                COSMETIC_ACCESS, ANIMATION_TYPES, ANIMATION_AXES, PARTICLE_MOTIONS, COSMETIC_ID_RE, BONE_NAME_RE,
//                COLOR_RE, SIGNATURE_RE, PNG_DATA_URL_PREFIX, BUILTIN_CAPE_IDS, COSMETIC_LIMITS,
//                SLOT_NAMES (Kopf, Rücken, …), SLOT_TITLES (Hüte & Kopf, …), SLOT_HASHES (kopf, ruecken, …)
//   Format       cosmeticSignedText, cosmeticEnvelopeText, utf8Length, codePointLength, crc32, readPng,
//                decodeBase64, isIsoDate, checkCosmeticManifest, parseCosmeticManifest, checkCosmeticEnvelope
//   Prüfen       CosmeticError, cosmeticsKeyAvailable(), importCosmeticKey(pem?), verifyCosmeticEnvelope(envelope, { publicKey, expect })
//   Katalog      normalizeCatalogEntry, loadCosmeticCatalog(), loadCosmetic(entry), loadVerifiedCosmetics(entries, { onItem }),
//                loadBuiltinCapes(), cosmeticAnimated(manifest)
//   Bilder       prepareCosmetic(manifest), prepareBuiltinCape(cape), drawCapeFrame(context, prepared, frame, width, height)
//   Geometrie    cosmeticCubeFaces, cosmeticPose, cosmeticBoneMatrices, mat4Multiply, mat4Apply, cosmeticLoopSeconds
//   Zeichnen     drawCosmeticPreview(canvas, prepared, options)   – 2D (Vorschaubilder, Ersatz ohne WebGL)
//                createCosmeticLayer(viewer, options)              – 3D-Meshes auf einem skinview3d.SkinViewer
import { UPDATE_PUBLIC_KEY } from './update-key.js';

// ---------------------------------------------------------------------------------------------------------
// Format 1 (genau wie service/src/cosmetics-format.ts)
// ---------------------------------------------------------------------------------------------------------

/** Steht vor dem Manifest-Text, wenn signiert wird. */
export const COSMETIC_SIGNATURE_PREFIX = 'heldix-cosmetic\n';
export const COSMETIC_TYPE = 'heldix-cosmetic';
export const COSMETIC_FORMAT = 1;

export const COSMETIC_SLOTS = Object.freeze(['head', 'back', 'aura', 'companion', 'cape']);
/** Slots mit Modell (und damit mit Animationen). */
export const MODEL_SLOTS = Object.freeze(['head', 'back', 'companion']);
export const COSMETIC_ACCESS = Object.freeze(['all', 'team']);
export const ANIMATION_TYPES = Object.freeze(['flap', 'sway', 'spin', 'bob']);
export const ANIMATION_AXES = Object.freeze(['x', 'y', 'z']);
export const PARTICLE_MOTIONS = Object.freeze(['rise', 'fall', 'orbit', 'spark', 'float']);

/** Kurze Namen der Slots (Reiter auf der Webseite). */
export const SLOT_NAMES = Object.freeze({ head: 'Kopf', back: 'Rücken', aura: 'Aura', companion: 'Begleiter', cape: 'Capes' });
/** Lange Namen der Slots (wie im Launcher und im Heldix-Menü). */
export const SLOT_TITLES = Object.freeze({ head: 'Hüte & Kopf', back: 'Flügel & Rücken', aura: 'Partikel', companion: 'Begleiter', cape: 'Capes' });
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
export const BUILTIN_CAPE_IDS = Object.freeze(['heldix', 'mitternacht', 'aurora', 'glut', 'kristall', 'neon', 'sakura', 'gewitter', 'galaxie']);

/** Alle Grenzen von Format 1 (Byte-Angaben: 1 KB = 1024 Byte). */
export const COSMETIC_LIMITS = Object.freeze({
  envelopeBytes: 192 * 1024,
  manifestBytes: 160 * 1024,
  pngBytes: 64 * 1024,
  versionMax: 2_147_483_647,
  nameMax: 40,
  descriptionMax: 300,
  textureMin: 8,
  textureMax: 256,
  textureStep: 8,
  /** cape: 64, 128 oder 256 breit, je Bild halb so hoch wie breit, Bilder untereinander */
  capeWidths: Object.freeze([64, 128, 256]),
  capeFramesMax: 32,
  capeFpsMax: 20,
  bonesMax: 32,
  cubesMax: 128,
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

const MANIFEST_KEYS = ['type', 'format', 'id', 'version', 'slot', 'name', 'description', 'access', 'date', 'texture', 'glow', 'model', 'animations', 'particles', 'cape', 'companion'];
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
function onlyKeys(o, path, allowed) {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(`${q(sub(path, key))} ist kein bekanntes Feld (Format ${COSMETIC_FORMAT})`);
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

function png(value, path) {
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
  onlyKeys(o, 'model', ['textureSize', 'bones']);
  const textureSize = required(o, 'textureSize', 'model');
  if (!Array.isArray(textureSize) || textureSize.length !== 2 || textureSize[0] !== image.width || textureSize[1] !== image.height) {
    fail(`„model.textureSize“ muss genau die Größe der Textur sein ([${image.width}, ${image.height}])`);
  }
  const texture = [image.width, image.height];
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
  return { textureSize: texture, bones };
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
 * Prüft den Inhalt eines Cosmetic-Manifests (das geparste JSON) nach Format 1. Liefert das Manifest mit Standardwerten
 * für fehlende freiwillige Felder (dazu `image`: Größe der Textur) oder einen deutschen Hinweis (der erste Fehler).
 */
export function checkCosmeticManifest(value) {
  try {
    return check(value);
  } catch (error) {
    if (error instanceof Problem) return error.message;
    throw error;
  }
}

function check(value) {
  const L = COSMETIC_LIMITS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Das Manifest ist kein JSON-Objekt');
  const m = value;
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

/** Manifest-Text lesen und prüfen (der Text muss vorher mit seiner Signatur geprüft sein). */
export function parseCosmeticManifest(manifest) {
  let parsed;
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
 * ausgeliefert höchstens 192 KB. Zusatzfelder im Umschlag werden ignoriert. Liefert { manifest, signature } oder Text.
 */
export function checkCosmeticEnvelope(value) {
  const L = COSMETIC_LIMITS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Der Umschlag ist kein JSON-Objekt';
  const { manifest, signature } = value;
  if (typeof manifest !== 'string' || manifest === '') return '„manifest“ fehlt oder ist kein Text';
  if (typeof signature !== 'string' || signature === '') return '„signature“ fehlt oder ist kein Text';
  if (LONE_SURROGATE_RE.test(manifest)) return '„manifest“ enthält ungültige Zeichen';
  if (utf8Length(manifest) > L.manifestBytes) return `„manifest“ ist zu groß (höchstens ${L.manifestBytes / 1024} KB)`;
  if (!SIGNATURE_RE.test(signature)) return '„signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen)';
  if (utf8Length(cosmeticEnvelopeText({ manifest, signature })) > L.envelopeBytes) return `Der Umschlag ist zu groß (höchstens ${L.envelopeBytes / 1024} KB)`;
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
 * Umschlag prüfen: Form, Ed25519-Signatur über "heldix-cosmetic\n" + manifest, alle Regeln von Format 1.
 * envelope: Objekt oder JSON-Text. expect: { id, slot, version } aus dem Katalog (müssen übereinstimmen).
 * Liefert das geprüfte Manifest; wirft CosmeticError mit deutschem Hinweis.
 */
export async function verifyCosmeticEnvelope(envelope, { publicKey = UPDATE_PUBLIC_KEY, expect = null } = {}) {
  let value = envelope;
  if (typeof value === 'string') {
    if (utf8Length(value) > COSMETIC_LIMITS.envelopeBytes) throw new CosmeticError(`Der Umschlag ist zu groß (höchstens ${COSMETIC_LIMITS.envelopeBytes / 1024} KB)`, 'envelope');
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
    access: entry.access === 'team' ? 'team' : 'all',
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

/** Die neun eingebauten Capes (/capes/capes.json aus der Mod): [{ id, name, description, frames, fps, glow }]. */
export function loadBuiltinCapes() {
  if (!builtinCapes) {
    builtinCapes = fetch('/capes/capes.json', { credentials: 'omit' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) =>
        (Array.isArray(data?.capes) ? data.capes : [])
          .filter((cape) => cape && BUILTIN_CAPE_IDS.includes(cape.id))
          .map((cape) => ({ id: cape.id, name: clean(cape.name, 40) || cape.id, description: clean(cape.description, 300), frames: Number(cape.frames) || 1, fps: Number(cape.fps) || 10, glow: cape.glow === true })),
      );
    builtinCapes.catch(() => (builtinCapes = null));
  }
  return builtinCapes;
}

/** Bewegt sich das Cosmetic (Animationen, Partikel, mehrere Cape-Bilder)? */
export function cosmeticAnimated(manifest) {
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

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
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

/** Matrix jedes Bones (Modellkoordinaten), Eltern zuerst; pose aus cosmeticPose() oder Ruhelage. */
export function cosmeticBoneMatrices(model, pose) {
  const matrices = new Map();
  for (const bone of model.bones) {
    const p = pose?.get(bone.name) ?? { rotation: bone.rotation, offset: [0, 0, 0] };
    const parent = bone.parent ? (matrices.get(bone.parent) ?? identity()) : identity();
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
const PREVIEW_YAW = { head: -0.55, back: Math.PI - 0.6, companion: -0.6 };

/**
 * Zeichnet eine 2D-Vorschau auf canvas (Größe aus canvas.width/height). prepared: aus prepareCosmetic() oder
 * prepareBuiltinCape(). options: { t (Sekunden, Animationen und Cape-Bild), yaw, pitch, padding (0–0.4) }.
 */
export function drawCosmeticPreview(canvas, item, { t = 0, yaw, pitch = 0.42, padding = 0.12 } = {}) {
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
      context.drawImage(source, u0, v0, sw, sh, -grow / sw, -grow / sh, 1 + (2 * grow) / sw, 1 + (2 * grow) / sh);
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
 * setElytra(bool), update(dt), dispose() }. item: aus prepareCosmetic() (alle Slots) oder prepareBuiltinCape()
 * (cape); null legt ab. Die Animation läuft über viewer.animation (FunctionAnimation, mit Ruhe-Animation der Arme,
 * wenn idle: true). Ohne passende three.js-Klassen ist supported false – dann bleibt nur die 2D-Vorschau.
 */
export function createCosmeticLayer(viewer, { skinview3d = globalThis.skinview3d, idle = true, playing = true } = {}) {
  const three = threeFrom(viewer, skinview3d);
  const player = viewer.playerObject;
  const colorSpace = viewer.skinTexture?.colorSpace;
  const state = { playing, time: 0, elytra: false, capeFrame: -1, capeTime: 0 };
  const worn = { head: null, back: null, aura: null, companion: null, cape: null };
  const nodes = { head: null, back: null, aura: null, companion: null };
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
      }
    : null;
  if (anchors) {
    anchors.head.position.set(0, 8, 0); // Mitte der Kopf-Oberseite
    player.skin.head.add(anchors.head);
    anchors.back.position.set(0, 6, 0); // Rücken auf Schulterhöhe (Rumpf-Mitte in z, Rückenfläche bei z = -2)
    player.skin.body.add(anchors.back);
    player.add(anchors.companion);
    player.add(anchors.aura);
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
      // offset in Blöcken: x rechts (= -X im Modell), y hoch ab den Füßen (y = -16), z vorn
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
    for (const slot of ['head', 'back', 'companion']) {
      const node = nodes[slot];
      if (node && step && node.item.manifest.animations.length) poseModel(node);
    }
    if (nodes.aura && step) stepAura(nodes.aura, step);
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
      if (slot === 'aura') {
        nodes.aura = buildAura(item);
        if (!state.playing) settleAura(nodes.aura);
        else for (let i = 0; i < 12; i++) stepAura(nodes.aura, 0.1);
      } else nodes[slot] = buildModel(item, anchors[slot]);
    },
    worn: (slot) => worn[slot] ?? null,
    setPlaying(value) {
      state.playing = Boolean(value);
      if (!state.playing && nodes.aura) settleAura(nodes.aura);
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
