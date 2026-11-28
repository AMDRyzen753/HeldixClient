// Cosmetics-Format 2 (animierte Meshes): Daten entpacken, Keyframes auswerten, Knochen-Matrizen, Skinning.
//
// Reine Rechnung ohne DOM und ohne three.js (cosmetic-scene.ts baut daraus die Szene; test-cosmetics-client.ts prüft
// diese Datei in Node). Die Webseite hat dieselbe Rechnung in website/src/cosmetics-common.js. Bedeutung der Daten
// (verbindlich: docs/dienst.md bzw. cosmetics-format.ts):
// - Body-Modellraum in Pixeln: Ursprung = Hals-Pivot des Rumpfs, +X links des Trägers, +Y nach unten, +Z nach hinten
//   (wie Minecrafts ModelPart „body“). Die Szene des Launchers hat +Y oben und +Z vorn: (x, −y, −z), also eine Drehung um
//   180° um X – das erledigt eine Gruppe in cosmetic-scene.ts, hier wird nur im Body-Raum gerechnet.
// - mesh.positions Int16LE ×3 (1/32 Pixel), normals Int8 ×3 (×127), uvs Uint16LE ×2 (÷65535, v = 0 oben),
//   bones Uint8 (ein Knochen je Ecke, starr), triangles Uint16LE ×3; weiche Haut (freiwillig): joints Uint8 ×4 und
//   weights Uint8 ×4 (÷255) je Ecke, dann v' = Σ wᵢ · W_jointᵢ · v.
// - Keyframes: keys Uint16LE (Frame-Nummern aufsteigend, erste 0); rot Int16LE ×4 (x, y, z, w × 32767), move Int16LE ×3
//   (1/32 Pixel), scale Uint16LE (÷1000, gleichmäßig um den Pivot). Zwischen zwei Keys: Quaternion slerp, move und
//   scale linear. Nach dem letzten Key: loop → zurück auf Key 0 interpolieren (Frame frames = Frame 0, wie Blender),
//   sonst den letzten Wert halten.
// - Zeit: Frame = Sekunden × fps; loop → modulo frames, sonst am letzten Frame (frames − 1) halten.
// - Knochen: W_b = W_eltern · T(move) · T(pivot) · R · S · T(−pivot); Ecke v' = W_knochen · v, Normale mit dem 3×3-Teil.
// - Leuchten: Bild = ⌊Ticks / frametimeTicks⌋ mod frames (Ticks = Sekunden × 20), Stärke
//   min + (max − min) · (0,5 + 0,5 · sin(2π · t / period)).
import type { CosmeticMeshData, CosmeticMeshEmissive, CosmeticMeshTrackData, CosmeticVec3 } from '../shared/api';

/** Zustände, in denen die Vorschau etwas zeigt (Reihenfolge der Auswahl), siehe CosmeticMeshData.states */
export const PREVIEW_STATES = ['idle', 'emote'] as const;

// ---------- Entpacken ----------

function bytesOf(base64: string): DataView {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new DataView(bytes.buffer);
}

function int16(base64: string, count: number, scale: number): Float32Array {
  const view = bytesOf(base64);
  if (view.byteLength < count * 2) throw new Error('Mesh-Daten zu kurz');
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / scale;
  return out;
}

function uint16(base64: string, count: number): Uint16Array {
  const view = bytesOf(base64);
  if (view.byteLength < count * 2) throw new Error('Mesh-Daten zu kurz');
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

/** Keyframes einer Spur: Frame-Nummern und je Key `stride` Werte */
export interface Channel {
  keys: Uint16Array;
  values: Float32Array;
  stride: number;
}

export interface MeshClip {
  name: string;
  fps: number;
  frames: number;
  loop: boolean;
  /** je Knochen (Index) die Spuren oder null */
  rot: (Channel | null)[];
  move: (Channel | null)[];
  scale: (Channel | null)[];
}

export interface MeshRig {
  vertexCount: number;
  triangleCount: number;
  /** Pixel im Body-Modellraum */
  positions: Float32Array;
  normals: Float32Array;
  /** u, v mit v = 0 oben (wie im Manifest) */
  uvs: Float32Array;
  bone: Uint8Array;
  /** weiche Haut: je Ecke 4 Knochen und 4 Gewichte (0 … 1), sonst null */
  joints: Uint8Array | null;
  weights: Float32Array | null;
  triangles: Uint16Array;
  parents: Int16Array;
  /** Pivot je Knochen (x, y, z) */
  pivots: Float32Array;
  /** Animationen in der Reihenfolge des Manifests */
  clips: MeshClip[];
  byName: Map<string, MeshClip>;
  /** Zustand → Animation; idle gibt es immer */
  states: Record<string, string>;
  blendSeconds: number;
  emissive: CosmeticMeshEmissive | null;
}

function channel(track: { keys: string; values: string } | null | undefined, stride: number, kind: 'rot' | 'move' | 'scale'): Channel | null {
  if (!track) return null;
  const keyView = bytesOf(track.keys);
  const count = keyView.byteLength / 2;
  if (!Number.isInteger(count) || count < 1) throw new Error('Keyframes ungültig');
  const keys = uint16(track.keys, count);
  let values: Float32Array;
  if (kind === 'rot') {
    values = int16(track.values, count * 4, 32767);
    // nach dem Runden wieder auf Länge 1
    for (let k = 0; k < count; k++) {
      const o = k * 4;
      const length = Math.hypot(values[o], values[o + 1], values[o + 2], values[o + 3]) || 1;
      for (let c = 0; c < 4; c++) values[o + c] /= length;
    }
  } else if (kind === 'move') values = int16(track.values, count * 3, 32);
  else {
    const raw = uint16(track.values, count);
    values = new Float32Array(count);
    for (let k = 0; k < count; k++) values[k] = raw[k] / 1000;
  }
  return { keys, values, stride };
}

/** Geprüfte Daten (CosmeticItem.mesh) in Zahlenfelder */
export function decodeMeshRig(data: CosmeticMeshData): MeshRig {
  const n = data.vertexCount;
  const t = data.triangleCount;
  const bones = data.skeleton.length;
  const boneView = bytesOf(data.bones);
  if (boneView.byteLength < n) throw new Error('Mesh-Daten zu kurz');
  const bone = new Uint8Array(n);
  for (let i = 0; i < n; i++) bone[i] = Math.min(bones - 1, boneView.getUint8(i));
  const normalView = bytesOf(data.normals);
  if (normalView.byteLength < n * 3) throw new Error('Mesh-Daten zu kurz');
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) normals[i] = normalView.getInt8(i) / 127;
  const rawUvs = uint16(data.uvs, n * 2);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i++) uvs[i] = rawUvs[i] / 65535;
  const triangles = uint16(data.triangles, t * 3);
  for (let i = 0; i < triangles.length; i++) if (triangles[i] >= n) triangles[i] = 0;
  let joints: Uint8Array | null = null;
  let weights: Float32Array | null = null;
  if (data.joints && data.weights) {
    const jointView = bytesOf(data.joints);
    const weightView = bytesOf(data.weights);
    if (jointView.byteLength < n * 4 || weightView.byteLength < n * 4) throw new Error('Mesh-Daten zu kurz');
    joints = new Uint8Array(n * 4);
    weights = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) {
      joints[i] = Math.min(bones - 1, jointView.getUint8(i));
      weights[i] = weightView.getUint8(i) / 255;
    }
  }
  const parents = new Int16Array(bones);
  const pivots = new Float32Array(bones * 3);
  data.skeleton.forEach((b, i) => {
    parents[i] = b.parent >= 0 && b.parent < i ? b.parent : -1;
    pivots.set(b.pivot, i * 3);
  });
  const clips: MeshClip[] = data.animations.map((a) => {
    const clip: MeshClip = { name: a.name, fps: a.fps, frames: a.frames, loop: a.loop, rot: new Array(bones).fill(null), move: new Array(bones).fill(null), scale: new Array(bones).fill(null) };
    for (const track of a.tracks as CosmeticMeshTrackData[]) {
      if (track.bone < 0 || track.bone >= bones) continue;
      clip.rot[track.bone] = channel(track.rot, 4, 'rot');
      clip.move[track.bone] = channel(track.move, 3, 'move');
      clip.scale[track.bone] = channel(track.scale, 1, 'scale');
    }
    return clip;
  });
  return {
    vertexCount: n,
    triangleCount: t,
    positions: int16(data.positions, n * 3, 32),
    normals,
    uvs,
    bone,
    joints,
    weights,
    triangles,
    parents,
    pivots,
    clips,
    byName: new Map(clips.map((c) => [c.name, c])),
    states: { ...data.states },
    blendSeconds: data.blendSeconds,
    emissive: data.emissive,
  };
}

// ---------- Keyframes ----------

/** Frame-Position (mit Bruchteil) einer Animation nach `seconds` Sekunden */
export function clipFrame(clip: MeshClip, seconds: number): number {
  const f = Math.max(0, seconds) * clip.fps;
  if (clip.loop) return clip.frames > 0 ? f % clip.frames : 0;
  return Math.min(f, Math.max(0, clip.frames - 1));
}

/** Ist eine einmalige Animation durch? (loop: nie) */
export function clipDone(clip: MeshClip, seconds: number): boolean {
  return !clip.loop && seconds * clip.fps >= clip.frames - 1;
}

/** Dauer in Sekunden (eine Schleife bzw. bis zum letzten Frame) */
export function clipSeconds(clip: MeshClip): number {
  return (clip.loop ? clip.frames : Math.max(1, clip.frames - 1)) / clip.fps;
}

/** Quaternion-slerp a → b (kürzester Weg), Ergebnis nach out[o…o+3] */
export function slerp(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, t: number, out: Float32Array, o: number): void {
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka: number;
  let kb: number;
  if (cos > 0.9995) {
    // fast gleich: linear und normieren
    ka = 1 - t;
    kb = t;
  } else {
    const angle = Math.acos(Math.min(1, cos));
    const sin = Math.sin(angle);
    ka = Math.sin((1 - t) * angle) / sin;
    kb = Math.sin(t * angle) / sin;
  }
  const x = ax * ka + bx * kb, y = ay * ka + by * kb, z = az * ka + bz * kb, w = aw * ka + bw * kb;
  const length = Math.hypot(x, y, z, w) || 1;
  out[o] = x / length;
  out[o + 1] = y / length;
  out[o + 2] = z / length;
  out[o + 3] = w / length;
}

/**
 * Wert einer Spur bei Frame f nach out[o…] (rot: slerp, sonst linear). loopFrames (Schleifen: frames der Animation):
 * nach dem letzten Key zurück auf Key 0 bei Frame loopFrames; ohne (null) den letzten Wert halten.
 */
export function sampleChannel(ch: Channel, f: number, out: Float32Array, o: number, rotation: boolean, loopFrames: number | null = null): void {
  const { keys, values, stride } = ch;
  const last = keys.length - 1;
  if (loopFrames !== null && f > keys[last] && loopFrames > keys[last]) {
    // Schleife: vom letzten Key zurück auf den ersten (Frame loopFrames = Frame 0)
    const t = Math.min(1, (f - keys[last]) / (loopFrames - keys[last]));
    if (rotation) slerp(values, last * stride, values, 0, t, out, o);
    else for (let c = 0; c < stride; c++) out[o + c] = values[last * stride + c] + (values[c] - values[last * stride + c]) * t;
    return;
  }
  let i = 0;
  if (f <= keys[0]) i = -1;
  else if (f >= keys[last]) i = last;
  else {
    // größter Key ≤ f (binäre Suche)
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
  if (rotation) slerp(values, i * stride, values, (i + 1) * stride, t, out, o);
  else for (let c = 0; c < stride; c++) out[o + c] = values[i * stride + c] + (values[(i + 1) * stride + c] - values[i * stride + c]) * t;
}

/** Lage eines Knochens: qx, qy, qz, qw, mx, my, mz, s */
export const POSE_STRIDE = 8;

export function restPose(bones: number): Float32Array {
  const pose = new Float32Array(bones * POSE_STRIDE);
  for (let b = 0; b < bones; b++) {
    pose[b * POSE_STRIDE + 3] = 1;
    pose[b * POSE_STRIDE + 7] = 1;
  }
  return pose;
}

/** Lage aller Knochen einer Animation nach `seconds` Sekunden (ohne Spur: Ruhelage) */
export function samplePose(rig: MeshRig, clip: MeshClip, seconds: number, out: Float32Array = restPose(rig.parents.length)): Float32Array {
  const f = clipFrame(clip, seconds);
  const wrap = clip.loop ? clip.frames : null;
  for (let b = 0; b < rig.parents.length; b++) {
    const o = b * POSE_STRIDE;
    const rot = clip.rot[b];
    const move = clip.move[b];
    const scale = clip.scale[b];
    if (rot) sampleChannel(rot, f, out, o, true, wrap);
    else out.set([0, 0, 0, 1], o);
    if (move) sampleChannel(move, f, out, o + 4, false, wrap);
    else out.set([0, 0, 0], o + 4);
    if (scale) sampleChannel(scale, f, out, o + 7, false, wrap);
    else out[o + 7] = 1;
  }
  return out;
}

/** Überblenden from → to (w = 0 … 1): slerp der Drehung, move und scale linear */
export function blendPose(from: Float32Array, to: Float32Array, w: number, out: Float32Array): Float32Array {
  for (let o = 0; o < out.length; o += POSE_STRIDE) {
    slerp(from, o, to, o, w, out, o);
    for (let c = 4; c < POSE_STRIDE; c++) out[o + c] = from[o + c] + (to[o + c] - from[o + c]) * w;
  }
  return out;
}

// ---------- Matrizen und Skinning ----------

/** Matrizen aller Knochen (je 16 Werte, spaltenweise wie three.js) im Body-Modellraum */
export function boneMatrices(rig: MeshRig, pose: Float32Array, out: Float32Array = new Float32Array(rig.parents.length * 16)): Float32Array {
  const local = new Float32Array(16);
  for (let b = 0; b < rig.parents.length; b++) {
    const p = b * POSE_STRIDE;
    const x = pose[p], y = pose[p + 1], z = pose[p + 2], w = pose[p + 3];
    const s = pose[p + 7];
    const px = rig.pivots[b * 3], py = rig.pivots[b * 3 + 1], pz = rig.pivots[b * 3 + 2];
    // s · R (Spalten)
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
    // T(move + pivot) · sR · T(−pivot): Verschiebung = pivot + move − sR · pivot
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
        for (let r = 0; r < 4; r++) {
          out[o + c * 4 + r] = out[q + r] * local[c * 4] + out[q + 4 + r] * local[c * 4 + 1] + out[q + 8 + r] * local[c * 4 + 2] + out[q + 12 + r] * local[c * 4 + 3];
        }
      }
    }
  }
  return out;
}

/**
 * Ecken und Normalen mit den Knochen-Matrizen bewegen: starr je Ecke ein Knochen, mit weicher Haut (joints/weights)
 * die gewichtete Summe der Matrizen.
 */
export function skinMesh(rig: MeshRig, matrices: Float32Array, positions: Float32Array, normals: Float32Array): void {
  const src = rig.positions;
  const nrm = rig.normals;
  const { joints, weights } = rig;
  const blended = new Float32Array(12);
  const mat = matrices;
  for (let i = 0; i < rig.vertexCount; i++) {
    if (joints && weights) {
      // Σ wᵢ · Mᵢ (nur die oberen drei Zeilen, spaltenweise wie die Matrizen: 0–2, 4–6, 8–10, 12–14)
      blended.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = weights[i * 4 + k];
        if (w <= 0) continue;
        const j = joints[i * 4 + k] * 16;
        for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) blended[c * 3 + r] += w * matrices[j + c * 4 + r];
      }
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      positions[i * 3] = blended[0] * x + blended[3] * y + blended[6] * z + blended[9];
      positions[i * 3 + 1] = blended[1] * x + blended[4] * y + blended[7] * z + blended[10];
      positions[i * 3 + 2] = blended[2] * x + blended[5] * y + blended[8] * z + blended[11];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      const ax = blended[0] * nx + blended[3] * ny + blended[6] * nz;
      const ay = blended[1] * nx + blended[4] * ny + blended[7] * nz;
      const az = blended[2] * nx + blended[5] * ny + blended[8] * nz;
      const length = Math.hypot(ax, ay, az) || 1;
      normals[i * 3] = ax / length;
      normals[i * 3 + 1] = ay / length;
      normals[i * 3 + 2] = az / length;
      continue;
    }
    const m = rig.bone[i] * 16;
    const o = i * 3;
    const x = src[o], y = src[o + 1], z = src[o + 2];
    positions[o] = mat[m] * x + mat[m + 4] * y + mat[m + 8] * z + mat[m + 12];
    positions[o + 1] = mat[m + 1] * x + mat[m + 5] * y + mat[m + 9] * z + mat[m + 13];
    positions[o + 2] = mat[m + 2] * x + mat[m + 6] * y + mat[m + 10] * z + mat[m + 14];
    const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
    const ax = mat[m] * nx + mat[m + 4] * ny + mat[m + 8] * nz;
    const ay = mat[m + 1] * nx + mat[m + 5] * ny + mat[m + 9] * nz;
    const az = mat[m + 2] * nx + mat[m + 6] * ny + mat[m + 10] * nz;
    const length = Math.hypot(ax, ay, az) || 1;
    normals[o] = ax / length;
    normals[o + 1] = ay / length;
    normals[o + 2] = az / length;
  }
}

/** Punkt (Pixel, Body-Raum) mit der Matrix eines Knochens */
export function applyBone(matrices: Float32Array, bone: number, p: CosmeticVec3): CosmeticVec3 {
  const m = bone * 16;
  return [
    matrices[m] * p[0] + matrices[m + 4] * p[1] + matrices[m + 8] * p[2] + matrices[m + 12],
    matrices[m + 1] * p[0] + matrices[m + 5] * p[1] + matrices[m + 9] * p[2] + matrices[m + 13],
    matrices[m + 2] * p[0] + matrices[m + 6] * p[1] + matrices[m + 10] * p[2] + matrices[m + 14],
  ];
}

/** Hülle der bewegten Ecken (Body-Raum) */
export function meshBounds(positions: Float32Array, count: number): { min: CosmeticVec3; max: CosmeticVec3 } | null {
  if (!count) return null;
  const min: CosmeticVec3 = [Infinity, Infinity, Infinity];
  const max: CosmeticVec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

// ---------- Leuchten ----------

/** Bild des Leucht-Streifens nach `seconds` Sekunden */
export function glowFrame(emissive: CosmeticMeshEmissive | null, seconds: number): number {
  if (!emissive || emissive.frames <= 1) return 0;
  return Math.floor((Math.max(0, seconds) * 20) / emissive.frametimeTicks) % emissive.frames;
}

/** Stärke des Leuchtens (Puls) nach `seconds` Sekunden; ohne Puls 1 */
export function glowIntensity(emissive: CosmeticMeshEmissive | null, seconds: number): number {
  const pulse = emissive?.pulse;
  if (!pulse) return 1;
  return pulse.min + (pulse.max - pulse.min) * (0.5 + 0.5 * Math.sin((2 * Math.PI * seconds) / pulse.period));
}

// ---------- Abspielen (Vorschau) ----------

/** Animation eines Zustands (fehlt er: Idle) */
export function stateClip(rig: MeshRig, state: string): MeshClip | null {
  return rig.byName.get(rig.states[state] ?? '') ?? rig.byName.get(rig.states.idle ?? '') ?? rig.clips[0] ?? null;
}

/**
 * Spielt Animationen wie im Spiel: Wechsel mit Überblenden (blendSeconds, slerp je Knochen), einmalige Animationen laufen
 * zu Ende und kehren dann zur gewählten Schleife zurück (start_flying → danach der Elytra-Zustand, falls es ihn gibt).
 */
export class MeshAnimator {
  private base: MeshClip | null;
  private clip: MeshClip | null;
  private started = 0;
  private readonly target: Float32Array;
  readonly pose: Float32Array;
  private blendStart = -1;
  private blendFrom: Float32Array | null = null;

  constructor(readonly rig: MeshRig, initial: string | null = null) {
    const bones = rig.parents.length;
    this.target = restPose(bones);
    this.pose = restPose(bones);
    this.base = (initial ? rig.byName.get(initial) : null) ?? stateClip(rig, 'idle');
    this.clip = this.base;
    this.update(0);
  }

  /** Name der laufenden Animation */
  get current(): string | null {
    return this.clip?.name ?? null;
  }

  /** Name der gewählten Schleife (dorthin geht es nach einer einmaligen Animation zurück) */
  get chosen(): string | null {
    return this.base?.name ?? null;
  }

  /**
   * Animation wechseln (now = Uhr des Aufrufers in Sekunden); dieselbe läuft einfach weiter. restart: von vorn,
   * immediate: ohne Überblenden (z. B. wenn die Uhr steht).
   */
  play(name: string, now: number, options: { restart?: boolean; immediate?: boolean } = {}): void {
    const next = this.rig.byName.get(name);
    if (!next) return;
    if (next.loop) this.base = next;
    if (next === this.clip && !options.restart) return;
    // von der Lage aus, die gerade zu sehen ist (auch mitten in einer Überblendung)
    this.blendFrom = options.immediate ? null : new Float32Array(this.pose);
    this.blendStart = this.rig.blendSeconds > 0 && this.blendFrom ? now : -1;
    this.clip = next;
    this.started = now;
  }

  /** Lage zur Uhrzeit now (Sekunden) ausrechnen; liefert this.pose */
  update(now: number): Float32Array {
    const clip = this.clip;
    if (!clip) return this.pose;
    if (clipDone(clip, now - this.started)) {
      // einmalig: zu Ende → zurück zur Schleife (nach dem Abheben in den Gleitflug); von der Endlage aus überblenden
      const after = this.rig.states.start_flying === clip.name ? this.rig.byName.get(this.rig.states.elytra ?? '') ?? this.base : this.base;
      if (after && after !== clip) {
        if (this.blendStart < 0) this.pose.set(samplePose(this.rig, clip, now - this.started, this.target));
        this.play(after.name, now);
      }
    }
    samplePose(this.rig, this.clip!, now - this.started, this.target);
    if (this.blendStart >= 0 && this.blendFrom) {
      const w = (now - this.blendStart) / this.rig.blendSeconds;
      if (w >= 1) {
        this.blendStart = -1;
        this.blendFrom = null;
        this.pose.set(this.target);
      } else blendPose(this.blendFrom, this.target, Math.max(0, w), this.pose);
    } else this.pose.set(this.target);
    return this.pose;
  }
}

/** Anzeigename einer Animation („Idle“, „Emote“, „Takeoff“ …): wie im Manifest, Unterstriche als Leerzeichen */
export function clipLabel(name: string): string {
  return name.replace(/_/g, ' ');
}
