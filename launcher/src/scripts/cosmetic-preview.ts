// Vorschaubilder der Heldix-Cosmetics aus den Quellen (cosmetics/<id>/), gerendert mit einem kleinen
// Software-Rasterizer: Modell am Anker einer Spielerfigur in Steve-Größe (16 px je Block), Licht wie bei Minecraft-
// Entities, Leuchtebene voll hell, Partikel als Standbild, Capes mit Einzelbildern. Kein Electron, keine GPU.
//
//   npm run cosmetic:preview -- <ausgabeordner> [id …]
//
// Je Cosmetic eine Datei <id>.png (vorn, hinten, Textur, bei Animationen vier Zeitpunkte) und uebersicht.png.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { cosmeticBoneMatrices, cosmeticCubeFaces, cosmeticLoopSeconds, cosmeticPose, mat4Apply, mat4Multiply, pngFromDataUrl, type Mat4 } from '../main/core/cosmetics';
import type { CosmeticCube, CosmeticManifest, CosmeticModel, Vec3 } from '../main/core/cosmetics-format';
import { buildCosmetic, listCosmeticSources } from './cosmetic-sources';
import { encodePng } from './testkit';

// ---------------------------------------------------------------------------------------------
// Bilder
// ---------------------------------------------------------------------------------------------

interface Tex {
  w: number;
  h: number;
  data: Uint8Array;
}

function decodePng(bytes: Buffer): Tex {
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  const depth = bytes[24];
  const type = bytes[25];
  if (depth !== 8 || bytes[28] !== 0) throw new Error('Vorschau kann nur 8-Bit-PNG ohne Interlacing');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  let palette: Buffer | null = null;
  let alpha: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'PLTE') palette = data;
    if (kind === 'tRNS') alpha = data;
    if (kind === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const pixels = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let out = value;
      if (filter === 1) out += a;
      else if (filter === 2) out += b;
      else if (filter === 3) out += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        out += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = out & 255;
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * channels;
    let rgba: number[];
    if (type === 6) rgba = [pixels[s], pixels[s + 1], pixels[s + 2], pixels[s + 3]];
    else if (type === 2) rgba = [pixels[s], pixels[s + 1], pixels[s + 2], 255];
    else if (type === 4) rgba = [pixels[s], pixels[s], pixels[s], pixels[s + 1]];
    else if (type === 0) rgba = [pixels[s], pixels[s], pixels[s], 255];
    else {
      const k = pixels[s];
      rgba = [palette![k * 3], palette![k * 3 + 1], palette![k * 3 + 2], alpha && k < alpha.length ? alpha[k] : 255];
    }
    data.set(rgba, i * 4);
  }
  return { w, h, data };
}

/** Ausschnitt (z. B. ein Bild eines Capes) */
function crop(tex: Tex, x: number, y: number, w: number, h: number): Tex {
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) data.set(tex.data.subarray(((y + j) * tex.w + x) * 4, ((y + j) * tex.w + x + w) * 4), j * w * 4);
  return { w, h, data };
}

// ---------------------------------------------------------------------------------------------
// Rasterizer
// ---------------------------------------------------------------------------------------------

interface Quad {
  corners: Vec3[];
  uvs: [number, number][];
  normal: Vec3;
  tex: Tex;
  glow?: Tex | null;
  /** ohne Licht */
  fullbright?: boolean;
}

interface Camera {
  yaw: number;
  pitch: number;
  /** Bildpunkte je Modellpixel */
  scale: number;
  center: Vec3;
  /** Bildmitte in gedrehten Koordinaten (Modellpixel) */
  offset?: [number, number];
}

/** Lage eines Punkts nach Drehung der Kamera (ohne Maßstab) */
function rotated(cam: { yaw: number; pitch: number }, p: Vec3): Vec3 {
  const yaw = (cam.yaw * Math.PI) / 180;
  const pitch = (cam.pitch * Math.PI) / 180;
  const x1 = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw);
  const z1 = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
  return [x1, p[1] * Math.cos(pitch) - z1 * Math.sin(pitch), p[1] * Math.sin(pitch) + z1 * Math.cos(pitch)];
}

const LIGHT0 = norm([0.2, 1, -0.7]);
const LIGHT1 = norm([-0.2, 1, 0.7]);

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

class Canvas {
  color: Float32Array;
  depth: Float32Array;
  constructor(readonly w: number, readonly h: number, background: (x: number, y: number) => [number, number, number]) {
    this.color = new Float32Array(w * h * 3);
    this.depth = new Float32Array(w * h).fill(-Infinity);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.color.set(background(x, y), (y * w + x) * 3);
  }

  project(cam: Camera, p: Vec3): Vec3 {
    const [x1, y2, z2] = rotated(cam, [p[0] - cam.center[0], p[1] - cam.center[1], p[2] - cam.center[2]]);
    const [ox, oy] = cam.offset ?? [0, 0];
    return [this.w / 2 + (x1 - ox) * cam.scale, this.h / 2 - (y2 - oy) * cam.scale, z2];
  }

  quad(cam: Camera, q: Quad): void {
    const s = q.corners.map((c) => this.project(cam, c));
    // Rückseite sichtbar (doppelseitige Ebenen)? Dann Normale für das Licht umdrehen
    const facing = rotated(cam, q.normal)[2] >= 0 ? 1 : -1;
    const n: Vec3 = [q.normal[0] * facing, q.normal[1] * facing, q.normal[2] * facing];
    const light = q.fullbright ? 1 : Math.min(1, 0.4 + 0.6 * (Math.max(0, dot(n, LIGHT0)) + Math.max(0, dot(n, LIGHT1))));
    const us = q.uvs.map((u) => u[0]);
    const vs = q.uvs.map((u) => u[1]);
    const uMin = Math.min(...us) + 1e-3, uMax = Math.max(...us) - 1e-3;
    const vMin = Math.min(...vs) + 1e-3, vMax = Math.max(...vs) - 1e-3;
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const pa = s[a], pb = s[b], pc = s[c];
      const det = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1]);
      if (Math.abs(det) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
      const x1 = Math.min(this.w - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
      const y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
      const y1 = Math.min(this.h - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const wb = ((px - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (py - pa[1])) / det;
          const wc = ((pb[0] - pa[0]) * (py - pa[1]) - (px - pa[0]) * (pb[1] - pa[1])) / det;
          const wa = 1 - wb - wc;
          if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
          const z = wa * pa[2] + wb * pb[2] + wc * pc[2];
          const i = y * this.w + x;
          if (z <= this.depth[i] + 1e-4) continue;
          const u = Math.min(uMax, Math.max(uMin, wa * q.uvs[a][0] + wb * q.uvs[b][0] + wc * q.uvs[c][0]));
          const v = Math.min(vMax, Math.max(vMin, wa * q.uvs[a][1] + wb * q.uvs[b][1] + wc * q.uvs[c][1]));
          const tx = Math.min(q.tex.w - 1, Math.floor(u)), ty = Math.min(q.tex.h - 1, Math.floor(v));
          const t = (ty * q.tex.w + tx) * 4;
          const alpha = q.tex.data[t + 3];
          const g = q.glow ? (ty * q.glow.w + tx) * 4 : -1;
          const glowAlpha = g >= 0 ? q.glow!.data[g + 3] : 0;
          if (alpha < 26 && glowAlpha < 26) continue;
          let r = 0, gg = 0, bb = 0;
          if (alpha >= 26) {
            r = q.tex.data[t] * light;
            gg = q.tex.data[t + 1] * light;
            bb = q.tex.data[t + 2] * light;
          }
          if (glowAlpha >= 26) {
            const k = glowAlpha / 255;
            r = r * (1 - k) + q.glow!.data[g] * k;
            gg = gg * (1 - k) + q.glow!.data[g + 1] * k;
            bb = bb * (1 - k) + q.glow!.data[g + 2] * k;
          }
          this.depth[i] = z;
          this.color[i * 3] = r;
          this.color[i * 3 + 1] = gg;
          this.color[i * 3 + 2] = bb;
        }
      }
    }
  }

  /** Billboard (Partikel) in Bildschirmkoordinaten, getönt, mit Tiefentest am Mittelpunkt */
  sprite(cam: Camera, at: Vec3, sizePx: number, tex: Tex, frame: number, frames: number, tint: [number, number, number]): void {
    const [cx, cy, z] = this.project(cam, at);
    const half = (sizePx * cam.scale) / 2;
    const fw = tex.w / frames;
    for (let y = Math.floor(cy - half); y < Math.ceil(cy + half); y++) {
      for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const i = y * this.w + x;
        if (z <= this.depth[i]) continue;
        const u = Math.floor(((x + 0.5 - (cx - half)) / (2 * half)) * fw);
        const v = Math.floor(((y + 0.5 - (cy - half)) / (2 * half)) * tex.h);
        if (u < 0 || v < 0 || u >= fw || v >= tex.h) continue;
        const t = (v * tex.w + frame * fw + u) * 4;
        if (tex.data[t + 3] < 26) continue;
        this.color[i * 3] = (tex.data[t] * tint[0]) / 255;
        this.color[i * 3 + 1] = (tex.data[t + 1] * tint[1]) / 255;
        this.color[i * 3 + 2] = (tex.data[t + 2] * tint[2]) / 255;
      }
    }
  }

  /** verkleinert um factor (Kantenglättung) und liefert RGBA */
  toRgba(factor: number): { w: number; h: number; data: Uint8Array } {
    const w = Math.floor(this.w / factor), h = Math.floor(this.h / factor);
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sum = [0, 0, 0];
        for (let j = 0; j < factor; j++) for (let i = 0; i < factor; i++) {
          const s = ((y * factor + j) * this.w + x * factor + i) * 3;
          sum[0] += this.color[s];
          sum[1] += this.color[s + 1];
          sum[2] += this.color[s + 2];
        }
        const o = (y * w + x) * 4;
        data[o] = Math.round(sum[0] / (factor * factor));
        data[o + 1] = Math.round(sum[1] / (factor * factor));
        data[o + 2] = Math.round(sum[2] / (factor * factor));
        data[o + 3] = 255;
      }
    }
    return { w, h, data };
  }
}

// ---------------------------------------------------------------------------------------------
// Spielerfigur (Steve-ähnlich, eigene Farben)
// ---------------------------------------------------------------------------------------------

function paintBox(tex: Tex, uv: [number, number], size: Vec3, paint: (face: string, fx: number, fy: number, fw: number, fh: number) => [number, number, number]): void {
  const cube: CosmeticCube = { origin: [0, 0, 0], size, uv, inflate: 0, mirror: false };
  for (const face of cosmeticCubeFaces(cube)) {
    const [ua, va] = face.uvs[0];
    const [ub, vb] = face.uvs[2];
    const fw = ub - ua, fh = vb - va;
    for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
      const c = paint(face.name, fx, fy, fw, fh);
      tex.data.set([c[0], c[1], c[2], 255], ((va + fy) * tex.w + ua + fx) * 4);
    }
  }
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function dummySkin(): Tex {
  const tex: Tex = { w: 64, h: 64, data: new Uint8Array(64 * 64 * 4) };
  const skin = [rgb('#c9967a'), rgb('#b5806a'), rgb('#9e6c58')];
  const hair = [rgb('#4a3222'), rgb('#3a2616'), rgb('#2b1c10')];
  const shirt = [rgb('#2fb4b4'), rgb('#229a9a'), rgb('#187d7d')];
  const pants = [rgb('#4646b4'), rgb('#383896'), rgb('#2c2c78')];
  const shoe = [rgb('#7a7a7a'), rgb('#5e5e5e')];
  paintBox(tex, [0, 0], [8, 8, 8], (face, fx, fy) => {
    if (face === 'top') return hair[(fx + fy) % 3 === 0 ? 0 : 1];
    if (face === 'bottom') return skin[2];
    if (face === 'back') return fy < 6 ? hair[(fx + fy) % 2] : skin[1];
    if (face === 'left' || face === 'right') return fy < 2 || (fy < 4 && (face === 'right' ? fx < 3 : fx > 4)) ? hair[1] : skin[1];
    // Gesicht
    if (fy < 2) return hair[fy];
    if (fy === 4 && (fx === 1 || fx === 6)) return rgb('#ffffff');
    if (fy === 4 && (fx === 2 || fx === 5)) return rgb('#4a4ad0');
    if (fy === 5 && (fx === 3 || fx === 4)) return skin[2];
    if (fy === 6 && fx >= 2 && fx <= 5) return rgb('#6a3c2c');
    if (fy === 7 && fx >= 2 && fx <= 5) return hair[1];
    return skin[0];
  });
  const body = (face: string, fx: number, fy: number) => (face === 'top' ? shirt[0] : face === 'bottom' ? pants[1] : fy >= 10 ? pants[0] : shirt[fy === 0 ? 0 : (fx + fy) % 5 === 0 ? 2 : 1]);
  paintBox(tex, [16, 16], [8, 12, 4], body);
  const arm = (face: string, fx: number, fy: number) => (face === 'top' ? shirt[0] : face === 'bottom' ? skin[2] : fy < 4 ? shirt[1] : skin[fy === 11 ? 2 : 0]);
  paintBox(tex, [40, 16], [4, 12, 4], arm);
  paintBox(tex, [32, 48], [4, 12, 4], arm);
  const leg = (face: string, fx: number, fy: number) => (face === 'top' ? pants[0] : face === 'bottom' ? shoe[1] : fy >= 10 ? shoe[fy === 10 ? 0 : 1] : pants[(fx + fy) % 4 === 0 ? 2 : 1]);
  paintBox(tex, [0, 16], [4, 12, 4], leg);
  paintBox(tex, [16, 48], [4, 12, 4], leg);
  return tex;
}

const SKIN = dummySkin();
const DUMMY: { origin: Vec3; size: Vec3; uv: [number, number] }[] = [
  { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
  { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] },
  { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] },
  { origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] },
  { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16] },
  { origin: [0, 0, -2], size: [4, 12, 4], uv: [16, 48] },
];

function cubeQuads(cube: CosmeticCube, matrix: Mat4, tex: Tex, glow: Tex | null): Quad[] {
  return cosmeticCubeFaces(cube).map((face) => ({
    corners: face.corners.map((c) => mat4Apply(matrix, c)),
    uvs: face.uvs,
    normal: norm(mat4Apply(matrix, face.normal, 0)),
    tex,
    glow,
  }));
}

function dummyQuads(): Quad[] {
  const identity: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return DUMMY.flatMap((part) => cubeQuads({ ...part, inflate: 0, mirror: false }, identity, SKIN, null));
}

// ---------------------------------------------------------------------------------------------
// Szene je Cosmetic
// ---------------------------------------------------------------------------------------------

interface Loaded {
  manifest: CosmeticManifest;
  texture: Tex;
  glow: Tex | null;
}

const translate = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scaleMat = (s: number): Mat4 => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];

/** Anker des Modells in Spielerkoordinaten (Füße bei y = 0) */
function anchor(m: CosmeticManifest): Mat4 {
  if (m.slot === 'head') return translate(0, 32, 0);
  if (m.slot === 'back') return translate(0, 24, 0);
  if (m.slot === 'companion' && m.companion) {
    const [x, y, z] = m.companion.offset;
    // offset: x rechts, y hoch, z vorn (Blöcke); Modell-x zeigt nach links
    return mat4Multiply(translate(-x * 16, y * 16, z * 16), scaleMat(m.companion.scale));
  }
  return translate(0, 0, 0);
}

function modelQuads(item: Loaded, t: number): Quad[] {
  const m = item.manifest;
  if (!m.model) return [];
  const pose = cosmeticPose(m.model, m.animations, t);
  const matrices = cosmeticBoneMatrices(m.model, pose);
  const base = anchor(m);
  return m.model.bones.flatMap((bone) => bone.cubes.flatMap((cube) => cubeQuads(cube, mat4Multiply(base, matrices.get(bone.name)!), item.texture, item.glow)));
}

/** Cape wie in Minecraft: Würfel 10 × 16 × 1 mit uv (0, 0), hängt hinten an den Schultern, Außenseite nach hinten */
function capeQuads(item: Loaded, frame: number): Quad[] {
  // 64, 128 oder 256 breit: Vorlage 64 × 32 in k-facher Auflösung
  const w = item.texture.w;
  const k = w / 64;
  const tex = crop(item.texture, 0, frame * (w / 2), w, w / 2);
  const glow = item.glow ? crop(item.glow, 0, frame * (w / 2), w, w / 2) : null;
  const model: CosmeticModel = {
    textureSize: [64, 32],
    bones: [{ name: 'cape', parent: null, pivot: [0, 24, -2], rotation: [-8, 180, 0], cubes: [{ origin: [-5, 8, -2], size: [10, 16, 1], uv: [0, 0], inflate: 0, mirror: false }] }],
  };
  const matrix = cosmeticBoneMatrices(model).get('cape')!;
  return cubeQuads(model.bones[0].cubes[0], matrix, tex, glow).map((q) => ({ ...q, uvs: q.uvs.map(([u, v]) => [u * k, v * k] as [number, number]) }));
}

/** Partikel als Standbild: feste Pseudo-Zufallspositionen je Bewegungsart */
function particleSprites(item: Loaded): { at: Vec3; frame: number }[] {
  const p = item.manifest.particles!;
  const r = p.radius * 16;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const list: { at: Vec3; frame: number }[] = [];
  const count = 16;
  for (let i = 0; i < count; i++) {
    const age = rnd();
    const angle = rnd() * Math.PI * 2;
    const dist = r * (0.55 + 0.45 * rnd());
    const frame = Math.min(p.frames - 1, Math.floor(age * p.frames));
    let at: Vec3;
    if (p.motion === 'rise') at = [Math.cos(angle) * dist, 4 + age * 30, Math.sin(angle) * dist];
    else if (p.motion === 'fall') at = [Math.cos(angle) * dist, 38 - age * 34, Math.sin(angle) * dist];
    else if (p.motion === 'orbit') at = [Math.cos((i / count) * Math.PI * 2) * r, 16 + Math.sin(i * 1.7) * 3, Math.sin((i / count) * Math.PI * 2) * r];
    else if (p.motion === 'spark') at = [Math.cos(angle) * dist, 6 + rnd() * 26, Math.sin(angle) * dist];
    else at = [Math.cos(angle) * dist, 4 + rnd() * 30, Math.sin(angle) * dist];
    list.push({ at, frame });
  }
  return list;
}

interface View {
  yaw: number;
  pitch: number;
}

const FRONT: View = { yaw: -32, pitch: 12 };
const BACK: View = { yaw: 180 + 32, pitch: 12 };

/** Bereich der Spielerfigur, der je Slot mit ins Bild soll (Ecken eines Quaders) */
function context(m: CosmeticManifest): [Vec3, Vec3] {
  if (m.slot === 'head') return [[-4, 22, -4], [4, 32, 4]];
  if (m.slot === 'back') return [[-8, 8, -2], [8, 32, 2]];
  if (m.slot === 'companion') return [[-8, 18, -4], [8, 32, 4]];
  if (m.slot === 'aura') return [[-14, 0, -14], [14, 38, 14]];
  return [[-8, 0, -4], [8, 32, 4]];
}

/** Kamera, die Cosmetic (Ruhelage) und passenden Teil der Figur füllt */
function fitCamera(item: Loaded, view: View, pixels: number): Camera {
  const m = item.manifest;
  const [a, b] = context(m);
  const points: Vec3[] = [];
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) points.push([x, y, z]);
  for (const q of modelQuads(item, 0)) points.push(...q.corners);
  const r = points.map((p) => rotated(view, p));
  const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((pixels * 0.84) / Math.max(1, x1 - x0), (pixels * 0.84) / Math.max(1, y1 - y0));
  return { yaw: view.yaw, pitch: view.pitch, scale, center: [0, 0, 0], offset: [(x0 + x1) / 2, (y0 + y1) / 2] };
}

function background(w: number, h: number) {
  return (x: number, y: number): [number, number, number] => {
    const t = y / h;
    const r = Math.hypot(x / w - 0.5, (y / h - 0.85) * 3.2);
    const floor = r < 0.32 ? 0.35 * (1 - r / 0.32) : 0;
    return [16 + 10 * t - 8 * floor, 20 + 12 * t - 8 * floor, 33 + 16 * t - 10 * floor];
  };
}

function renderView(item: Loaded, view: View, size: number, t: number, capeFrame = 0): { w: number; h: number; data: Uint8Array } {
  const ss = 2;
  const m = item.manifest;
  // gleiche Kamera für alle Zeitpunkte (aus der Ruhelage), damit die Bewegung sichtbar bleibt
  const cam = fitCamera(item, view, size * ss);
  const canvas = new Canvas(size * ss, size * ss, background(size * ss, size * ss));
  const quads = [...dummyQuads()];
  if (m.model) quads.push(...modelQuads(item, t));
  if (m.slot === 'cape') quads.push(...capeQuads(item, capeFrame));
  for (const q of quads) canvas.quad(cam, q);
  if (m.particles) {
    const p = m.particles;
    const tint = rgb(p.color);
    // weiter hinten zuerst
    const sprites = particleSprites(item).sort((a, b) => canvas.project(cam, a.at)[2] - canvas.project(cam, b.at)[2]);
    for (const s of sprites) canvas.sprite(cam, s.at, p.size * 16, item.texture, s.frame, p.frames, tint);
  }
  return canvas.toRgba(ss);
}

// ---------------------------------------------------------------------------------------------
// Zusammensetzen
// ---------------------------------------------------------------------------------------------

class Sheet {
  data: Uint8Array;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) this.data.set([11, 15, 25, 255], i * 4);
  }
  blit(img: { w: number; h: number; data: Uint8Array }, x0: number, y0: number): void {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const X = x0 + x, Y = y0 + y;
      if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
      this.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (Y * this.w + X) * 4);
    }
  }
  /** Textur vergrößert auf Schachbrett */
  texture(tex: Tex, x0: number, y0: number, maxW: number, maxH: number): number {
    const k = Math.max(1, Math.min(Math.floor(maxW / tex.w), Math.floor(maxH / tex.h), 8));
    for (let y = 0; y < tex.h * k; y++) for (let x = 0; x < tex.w * k; x++) {
      const t = (Math.floor(y / k) * tex.w + Math.floor(x / k)) * 4;
      const a = tex.data[t + 3] / 255;
      const check = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 46 : 36;
      const X = x0 + x, Y = y0 + y;
      if (X >= this.w || Y >= this.h) continue;
      this.data.set([tex.data[t] * a + check * (1 - a), tex.data[t + 1] * a + check * (1 - a), tex.data[t + 2] * a + check * (1 - a), 255], (Y * this.w + X) * 4);
    }
    return tex.h * k;
  }
  png(): Buffer {
    return encodePng(this.w, this.h, Buffer.from(this.data));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outDir = args[0];
  if (!outDir) throw new Error('Aufruf: npm run cosmetic:preview -- <ausgabeordner> [id …]');
  const ids = args.length > 1 ? args.slice(1) : await listCosmeticSources();
  await mkdir(outDir, { recursive: true });
  const thumbs: { w: number; h: number; data: Uint8Array }[] = [];
  for (const id of ids) {
    const built = await buildCosmetic(id, new Date().toISOString());
    const m = built.manifest;
    const item: Loaded = {
      manifest: m,
      texture: decodePng(pngFromDataUrl(m.texture)),
      glow: m.glow ? decodePng(pngFromDataUrl(m.glow)) : null,
    };
    const size = 480;
    const front = renderView(item, FRONT, size, 0);
    const back = renderView(item, BACK, size, 0);
    const animated = m.animations.length > 0 || m.slot === 'cape';
    const texW = 400;
    const sheet = new Sheet(size * 2 + texW + 40, size + (animated ? size / 2 + 10 : 0));
    sheet.blit(m.slot === 'back' || m.slot === 'cape' ? back : front, 0, 0);
    sheet.blit(m.slot === 'back' || m.slot === 'cape' ? front : back, size + 10, 0);
    if (m.slot === 'cape') {
      // Außenseite von sechs Bildern der Animation, darunter eine Elytra-Fläche
      const s = item.texture.w / 64;
      for (let k = 0; k < 6; k++) {
        const frame = Math.floor((k * m.cape!.frames) / 6);
        sheet.texture(crop(item.texture, s, frame * 32 * s + s, 10 * s, 16 * s), size * 2 + 30 + (k % 3) * 125, 10 + Math.floor(k / 3) * 140, 80, 128);
      }
      sheet.texture(crop(item.texture, 24 * s, 2 * s, 10 * s, 20 * s), size * 2 + 30, 300, 60, 120);
      if (item.glow) sheet.texture(crop(item.glow, 0, 0, 64 * s, 32 * s), size * 2 + 120, 300, 256, 128);
    } else {
      const texH = sheet.texture(item.texture, size * 2 + 30, 10, texW, item.glow ? size / 2 - 20 : size - 20);
      if (item.glow) sheet.texture(item.glow, size * 2 + 30, texH + 30, texW, size / 2 - 20);
    }
    if (animated) {
      const loop = m.slot === 'cape' ? m.cape!.frames / m.cape!.fps : cosmeticLoopSeconds(m.animations);
      const view = m.slot === 'head' || m.slot === 'companion' ? FRONT : BACK;
      for (let k = 0; k < 4; k++) {
        const t = (loop * k) / 4;
        const img = m.slot === 'cape' ? renderView(item, BACK, size / 2, 0, Math.round((k * m.cape!.frames) / 4) % m.cape!.frames) : renderView(item, view, size / 2, t);
        sheet.blit(img, k * (size / 2 + 10), size + 10);
      }
    }
    await writeFile(path.join(outDir, `${id}.png`), sheet.png());
    thumbs.push(m.slot === 'back' || m.slot === 'cape' ? renderView(item, BACK, 240, 0) : renderView(item, FRONT, 240, 0));
    console.log(`${id}: ${path.join(outDir, `${id}.png`)}`);
  }
  const cols = 5;
  const rows = Math.ceil(thumbs.length / cols);
  const overview = new Sheet(cols * 250 + 10, rows * 250 + 10);
  thumbs.forEach((img, i) => overview.blit(img, 10 + (i % cols) * 250, 10 + Math.floor(i / cols) * 250));
  await writeFile(path.join(outDir, 'uebersicht.png'), overview.png());
  console.log(`Übersicht: ${path.join(outDir, 'uebersicht.png')}`);
}

main().catch((error: Error) => {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
