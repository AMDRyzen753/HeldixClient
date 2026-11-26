// Heldix-Cosmetics im Launcher: Signaturprüfung (Node) und die Bedeutung der Daten für Vorschauen.
//
// Die Regeln selbst stehen in cosmetics-format.ts – eine unveränderte Kopie von service/src/cosmetics-format.ts
// (npm run test:cosmetics prüft, dass beide gleich sind). Hier kommt nur dazu, was der Dienst nicht braucht.
//
// Koordinaten (Modell, Einheiten in Pixeln = 1/16 Block): rechtshändig, +Y nach oben, +Z nach vorn (Blickrichtung),
// damit +X = links des Trägers (wie die Minecraft-Welt bei Blick nach Süden). Java-Modellraum (y nach unten,
// vorn = -z) entsteht daraus mit (x, -y, -z).
//
// Anker (Ursprung des Modells): head = Mitte der Kopf-Oberseite; back = Mitte des Rumpfs auf Schulterhöhe (die
// Rückenfläche liegt bei z = -2); companion = eigenes Objekt, Ursprung unten in der Mitte, Platz über companion.offset
// (Blöcke, x rechts, y hoch, z vorn – also Modell-x = -offset.x · 16) und companion.scale.
//
// Bones: pivot und Würfel stehen in Modellkoordinaten (nicht relativ zum Eltern-Bone, wie Bedrock/Blockbench).
//   Matrix eines Bones = Eltern · T(pivot + bob) · Rz · Ry · Rx · T(-pivot), Winkel in Grad, rechte-Hand-Regel
//   (positiv = gegen den Uhrzeigersinn, wenn man von der positiven Achse zum Ursprung schaut); erst X, dann Y, dann Z.
//
// Box-UV (wie Minecraft): Würfel (w, h, d) mit uv (u, v) belegt (2d + 2w) × (d + h):
//   oben (u+d, v) w×d · unten (u+d+w, v) w×d · rechts/-X (u, v+d) d×h · vorn/+Z (u+d, v+d) w×h
//   links/+X (u+d+w, v+d) d×h · hinten/-Z (u+2d+w, v+d) w×h. Genaue Ecken: cosmeticCubeFaces().
//   mirror spiegelt den Würfel an seiner eigenen Mitte in x (Textur seitenverkehrt, wie Minecraft). Würfel mit einer
//   Kante 0 sind Ebenen mit zwei Seiten – ohne Rückseiten-Culling zeichnen.
//
// Animationen (t in Sekunden, alles additiv zur Ruhelage; mehrere je Bone erlaubt):
//   flap:  Winkel[achse] += amplitude · sin(2π(speed·t + phase))   (im Spiel beim Fliegen/Fallen bis 2× schneller)
//   sway:  Winkel[achse] += amplitude · sin(2π(speed·t + phase))   (immer gleich schnell)
//   spin:  Winkel[achse] += 360 · (speed·t + phase)                  (amplitude ohne Bedeutung)
//   bob:   pivot[achse]  += amplitude · sin(2π(speed·t + phase))   (Pixel)
//
// Partikel (aura): Textur = Streifen aus `frames` quadratischen Bildern nebeneinander; die Bilder laufen einmal über
// die Lebensdauer eines Partikels ab (wie Minecraft-Partikel). `color` tönt multiplikativ (#ffffff = Originalfarben),
// `size` ist die Kantenlänge des Partikels in Blöcken.
//
// Capes: 64, 128 oder 256 breit (Minecraft-Vorlage 64 × 32 in 1-, 2- oder 4-facher Auflösung), alle Bilder
// untereinander, Leuchtebene gleich groß.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  checkCosmeticEnvelope,
  COSMETIC_LIMITS,
  cosmeticSignedText,
  decodeBase64,
  parseCosmeticManifest,
  PNG_DATA_URL_PREFIX,
  utf8Length,
  type AnimationAxis,
  type CosmeticAnimation,
  type CosmeticCube,
  type CosmeticManifest,
  type CosmeticModel,
  type CosmeticSlot,
  type Vec3,
} from './cosmetics-format';

export const COSMETIC_SLOT_NAMES: Record<CosmeticSlot, string> = {
  head: 'Hüte & Kopf',
  back: 'Flügel & Rücken',
  aura: 'Partikel',
  companion: 'Begleiter',
  cape: 'Capes',
};

// ---------------------------------------------------------------------------------------------
// Signatur und Umschlag
// ---------------------------------------------------------------------------------------------

/** Die Bytes, über die signiert wird ("heldix-cosmetic\n" + Manifest, UTF-8). */
export const cosmeticSignedBytes = (manifest: string): Buffer => Buffer.from(cosmeticSignedText(manifest), 'utf8');

/** Bettet PNG-Bytes als data-URL ein. */
export const pngDataUrl = (png: Uint8Array): string => PNG_DATA_URL_PREFIX + Buffer.from(png).toString('base64');

/** PNG-Bytes aus einer geprüften data-URL (texture oder glow eines geprüften Manifests). */
export function pngFromDataUrl(dataUrl: string): Buffer {
  const bytes = dataUrl.startsWith(PNG_DATA_URL_PREFIX) ? decodeBase64(dataUrl.slice(PNG_DATA_URL_PREFIX.length)) : null;
  if (!bytes) throw new Error('Cosmetic ungültig: keine PNG-data-URL');
  return Buffer.from(bytes);
}

/** Prüft Größe und JSON eines Manifest-Texts nach allen Regeln; wirft mit deutscher Meldung. */
export function parseCosmeticManifestText(text: string): CosmeticManifest {
  if (utf8Length(text) > COSMETIC_LIMITS.manifestBytes) throw new Error(`Cosmetic ungültig: „manifest“ ist zu groß (höchstens ${COSMETIC_LIMITS.manifestBytes / 1024} KB)`);
  const manifest = parseCosmeticManifest(text);
  if (typeof manifest === 'string') throw new Error(`Cosmetic ungültig: ${manifest}`);
  return manifest;
}

/**
 * Prüft einen Umschlag { manifest, signature } vollständig: Form und Größe (wie der Dienst), Ed25519-Signatur über
 * "heldix-cosmetic\n" + manifest mit dem öffentlichen Update-Schlüssel (PEM oder KeyObject), dann alle Regeln des
 * Manifests. input: Dateiinhalt (Text oder Bytes) oder schon geparstes Objekt. Liefert das geprüfte Manifest.
 */
export function verifyCosmeticEnvelope(input: string | Uint8Array | object, publicKey: string | KeyObject): CosmeticManifest {
  let value: unknown = input;
  if (typeof input === 'string' || input instanceof Uint8Array) {
    const text = typeof input === 'string' ? input : Buffer.from(input).toString('utf8');
    // grobe Schranke vor dem Parsen; die genaue Grenze prüft checkCosmeticEnvelope an der ausgelieferten Form
    if (utf8Length(text) > 2 * COSMETIC_LIMITS.envelopeBytes) throw new Error(`Cosmetic ungültig: Der Umschlag ist zu groß (höchstens ${COSMETIC_LIMITS.envelopeBytes / 1024} KB)`);
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('Cosmetic ungültig: Die Datei ist kein gültiges JSON');
    }
  }
  const envelope = checkCosmeticEnvelope(value);
  if (typeof envelope === 'string') throw new Error(`Cosmetic ungültig: ${envelope}`);
  let ok = false;
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    ok = verify(null, cosmeticSignedBytes(envelope.manifest), key, Buffer.from(envelope.signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('Cosmetic ungültig: Die Signatur passt nicht (nicht vom HeldixClient-Team signiert oder verändert)');
  return parseCosmeticManifestText(envelope.manifest);
}

// ---------------------------------------------------------------------------------------------
// Bedeutung: Würfelflächen, Animationen, Bone-Matrizen
// ---------------------------------------------------------------------------------------------

export type CubeFaceName = 'right' | 'front' | 'left' | 'back' | 'top' | 'bottom';

export interface CubeFace {
  /** Fläche der Box-UV (bei mirror liegt z. B. „right“ auf der +X-Seite) */
  name: CubeFaceName;
  /** Ecken in Modellkoordinaten: oben links, oben rechts, unten rechts, unten links (bezogen auf die Textur) */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** passende UV in Texturpixeln */
  uvs: [[number, number], [number, number], [number, number], [number, number]];
  /** Normale nach außen (ohne Bone-Drehung) */
  normal: Vec3;
}

/** Die Flächen eines Würfels mit Box-UV (Flächen mit Breite oder Höhe 0 fallen weg). */
export function cosmeticCubeFaces(cube: CosmeticCube): CubeFace[] {
  const [w, h, d] = cube.size;
  const [u, v] = cube.uv;
  const i = cube.inflate;
  const x0 = cube.origin[0] - i, y0 = cube.origin[1] - i, z0 = cube.origin[2] - i;
  const x1 = cube.origin[0] + w + i, y1 = cube.origin[1] + h + i, z1 = cube.origin[2] + d + i;
  const rect = (ua: number, va: number, ub: number, vb: number): CubeFace['uvs'] => [[ua, va], [ub, va], [ub, vb], [ua, vb]];
  const faces: (CubeFace & { area: number })[] = [
    { name: 'right', area: d * h, normal: [-1, 0, 0], corners: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], uvs: rect(u, v + d, u + d, v + d + h) },
    { name: 'front', area: w * h, normal: [0, 0, 1], corners: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], uvs: rect(u + d, v + d, u + d + w, v + d + h) },
    { name: 'left', area: d * h, normal: [1, 0, 0], corners: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], uvs: rect(u + d + w, v + d, u + 2 * d + w, v + d + h) },
    { name: 'back', area: w * h, normal: [0, 0, -1], corners: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]], uvs: rect(u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h) },
    { name: 'top', area: w * d, normal: [0, 1, 0], corners: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], uvs: rect(u + d, v, u + d + w, v + d) },
    { name: 'bottom', area: w * d, normal: [0, -1, 0], corners: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], uvs: rect(u + d + w, v, u + d + 2 * w, v + d) },
  ];
  return faces
    .filter((f) => f.area > 0)
    .map(({ name, corners, uvs, normal }) => {
      if (!cube.mirror) return { name, corners, uvs, normal };
      // an der Würfelmitte in x spiegeln: Textur seitenverkehrt, linke und rechte Fläche tauschen die Seite
      const flip = (p: Vec3): Vec3 => [x0 + x1 - p[0], p[1], p[2]];
      return { name, corners: corners.map(flip) as CubeFace['corners'], uvs, normal: [-normal[0], normal[1], normal[2]] as Vec3 };
    });
}

export interface BonePose {
  /** Drehung in Grad (Ruhelage + Animationen) */
  rotation: Vec3;
  /** Verschiebung des Pivots in Pixeln (bob) */
  offset: Vec3;
}

const AXIS_INDEX: Record<AnimationAxis, number> = { x: 0, y: 1, z: 2 };

/** Lage aller Bones zur Zeit t (Sekunden). flapFactor (1–2) beschleunigt flap-Animationen (z. B. beim Fliegen). */
export function cosmeticPose(model: CosmeticModel, animations: CosmeticAnimation[], t: number, flapFactor = 1): Map<string, BonePose> {
  const pose = new Map<string, BonePose>();
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

/** 4×4-Matrix, spaltenweise (wie three.js/WebGL): m[spalte * 4 + zeile] */
export type Mat4 = number[];

export const mat4Identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const mat4Translation = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** Drehung um eine Achse (0 = x, 1 = y, 2 = z) in Grad, rechte-Hand-Regel */
export function mat4Rotation(axis: 0 | 1 | 2, degrees: number): Mat4 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  if (axis === 0) return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  if (axis === 1) return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Punkt (w = 1) oder Richtung (w = 0) mit einer Matrix abbilden */
export function mat4Apply(m: Mat4, p: Vec3, w = 1): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w,
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w,
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w,
  ];
}

/** Matrix jedes Bones (Modellkoordinaten), Eltern zuerst; pose aus cosmeticPose() oder Ruhelage. */
export function cosmeticBoneMatrices(model: CosmeticModel, pose?: Map<string, BonePose>): Map<string, Mat4> {
  const matrices = new Map<string, Mat4>();
  for (const bone of model.bones) {
    const p = pose?.get(bone.name) ?? { rotation: bone.rotation, offset: [0, 0, 0] as Vec3 };
    const parent = bone.parent ? matrices.get(bone.parent) ?? mat4Identity() : mat4Identity();
    let m = mat4Multiply(parent, mat4Translation(bone.pivot[0] + p.offset[0], bone.pivot[1] + p.offset[1], bone.pivot[2] + p.offset[2]));
    m = mat4Multiply(m, mat4Rotation(2, p.rotation[2]));
    m = mat4Multiply(m, mat4Rotation(1, p.rotation[1]));
    m = mat4Multiply(m, mat4Rotation(0, p.rotation[0]));
    m = mat4Multiply(m, mat4Translation(-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]));
    matrices.set(bone.name, m);
  }
  return matrices;
}

/** Dauer einer Schleife der langsamsten Animation in Sekunden (für Vorschauen; 0 = keine Bewegung). */
export function cosmeticLoopSeconds(animations: CosmeticAnimation[]): number {
  const speeds = animations.map((a) => a.speed).filter((s) => s > 0);
  if (!speeds.length) return 0;
  return 1 / Math.min(...speeds);
}
