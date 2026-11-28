// Cosmetics an der 3D-Figur (skinview3d) und kleine 3D-Vorschaubilder für die Auswahl.
//
// skinview3d bringt three.js mit, gibt es aber nicht heraus. Statt eine zweite Kopie von three.js zu laden (doppelter
// Code, zwei Instanzen in einer Szene), holen wir die wenigen Klassen aus Objekten, die skinview3d ohnehin anlegt
// (Mesh, Material, Geometrie, Group der Figur; Sprite, SpriteMaterial, CanvasTexture aus einem Namensschild;
// WebGLRenderer, Scene, Kamera, Licht aus dem Viewer). Fehlt etwas, bleibt die Figur einfach ohne Cosmetics.
//
// Bedeutung der Daten wie in main/core/cosmetics.ts (verbindlich, siehe dort):
// - Modellraum in Pixeln, +Y oben, +Z vorn, +X = linke Seite des Trägers – genau der Raum der skinview3d-Figur.
// - Pivots und Würfel sind absolut. Bone-Matrix = Eltern · T(pivot + bob) · Rz · Ry · Rx · T(−pivot): je Bone eine
//   Gruppe „outer“ (Position pivot + bob, Drehung in der Reihenfolge ZYX) mit einer Gruppe „inner“ (Position −pivot)
//   darin; Würfelflächen und Kinder-Bones hängen an „inner“.
// - model.scale (CosmeticItem.modelScale): Gruppe „model“ mit dieser Größe zwischen root und den Bones, also
//   S · Bone-Matrix um den Anker. root bleibt frei für Platz und companion.scale (beide multiplizieren sich).
// - UV in Texeln, geteilt durch item.textureSize (= model.textureSize; das Bild darf 2- oder 4-fach aufgelöst sein).
// - Flächen (Box-UV, mirror, Ebenen mit einer Kante 0) rechnet der Hauptprozess mit cosmeticCubeFaces() aus; alle
//   Flächen werden beidseitig gezeichnet (wie die Vorschau), Pixel mit Deckkraft unter 10 % fallen weg.
// - Leuchtebene: zweites Mesh mit derselben Geometrie, ohne Licht (nur „emissive“), liegt über der Textur.
// - Animationen additiv (flap/sway: Winkel += A·sin(2π(speed·t + phase)), spin: += 360·(speed·t + phase),
//   bob: Pivot += A·sin(…) in Pixeln).
// - Anker: head = Mitte der Kopf-Oberseite (folgt dem Kopf), back = Rumpfmitte auf Schulterhöhe (folgt dem Rumpf),
//   companion = eigenes Objekt neben der Figur (offset in Blöcken, x rechts → Modell-x = −x·16), aura = Partikel um
//   die Füße als einfache Sprites (Bilder laufen einmal über die Lebensdauer, Farbe tönt multiplikativ).
//
// Format 2 (animierte Meshes, item.mesh; Rechnung in cosmetic-mesh.ts):
// - Ein Mesh je Cosmetic, die Ecken werden je Bild auf der CPU mit den Knochen-Matrizen bewegt (starr ein Knochen je
//   Ecke, mit weicher Haut gewichtet – auch Dreiecke über zwei Knochen, z. B. Membranen, verformen sich wie im Spiel).
// - Body-Modellraum → Szene: Gruppe mit 180° um X ((x, y, z) → (x, −y, −z)); attach.side „right“ spiegelt an X.
// - Anker: head, back, companion am Rumpf auf Halshöhe (wie body.translateAndRotate im Spiel; Begleiter dazu
//   attach.origin), aura am Spielerobjekt auf Halshöhe ohne Rumpf (Füße bei y = 24 im Body-Raum, kippt nicht mit).
// - Albedo beidseitig mit Alpha-Schnitt; Leuchten als zweiter Durchgang, additiv und ohne Licht: Streifen-Bild über die
//   Textur-Verschiebung (frame = ⌊Ticks / frametimeTicks⌋ mod frames), Puls über emissiveIntensity.
// - Animationen: gewählte Schleife (Standard: Zustand idle), beim Wechsel Überblenden; emote(slot, item) spielt kurz den
//   Zustand emote (z. B. beim Überfahren einer Kachel). Partikel aus dem Manifest zeigt die Vorschau nicht.
import type { CosmeticBoneData, CosmeticFace, CosmeticItem, CosmeticModelSlot, CosmeticVec3 } from '../shared/api';
import { boneMatrices, decodeMeshRig, glowFrame, glowIntensity, MeshAnimator, meshBounds, skinMesh, stateClip, type MeshRig } from './cosmetic-mesh.js';

// ---------- three.js (nur die Teile, die hier gebraucht werden) ----------
interface V3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): V3;
}
interface Obj3D {
  position: V3;
  rotation: V3 & { order: string };
  scale: V3;
  visible: boolean;
  renderOrder: number;
  frustumCulled: boolean;
  children: Obj3D[];
  parent: Obj3D | null;
  matrixWorld: { elements: number[] };
  add(...objects: Obj3D[]): Obj3D;
  remove(...objects: Obj3D[]): Obj3D;
  updateMatrixWorld(force?: boolean): void;
  lookAt(x: number, y: number, z: number): void;
}
interface Attribute {
  constructor: new (array: Float32Array, itemSize: number) => unknown;
  array: Float32Array;
  needsUpdate: boolean;
}
interface Geometry {
  setAttribute(name: string, attribute: unknown): Geometry;
  getAttribute(name: string): Attribute | undefined;
  setIndex(index: number[]): Geometry;
  dispose(): void;
}
interface MaterialLike {
  opacity: number;
  needsUpdate: boolean;
  emissiveIntensity?: number;
  dispose(): void;
}
interface Tex {
  magFilter: number;
  minFilter: number;
  generateMipmaps: boolean;
  needsUpdate: boolean;
  offset: { set(x: number, y: number): void };
  repeat: { set(x: number, y: number): void };
  clone(): Tex;
  dispose(): void;
}
interface MeshObj extends Obj3D {
  geometry: Geometry;
  material: MaterialLike;
}
interface Renderer {
  outputColorSpace: string;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: number, alpha: number): void;
  render(scene: Obj3D, camera: Obj3D): void;
  dispose(): void;
}
interface Camera extends Obj3D {
  aspect: number;
  fov: number;
  near: number;
  far: number;
  updateProjectionMatrix(): void;
}

interface Three {
  Group: new () => Obj3D;
  Mesh: new (geometry: Geometry, material: MaterialLike) => MeshObj;
  BufferGeometry: new () => Geometry;
  Float32BufferAttribute: new (array: Float32Array, itemSize: number) => unknown;
  MeshStandardMaterial: new (params: Record<string, unknown>) => MaterialLike;
  Sprite: new (material: MaterialLike) => Obj3D;
  SpriteMaterial: new (params: Record<string, unknown>) => MaterialLike;
  CanvasTexture: new (image: HTMLImageElement | HTMLCanvasElement) => Tex;
  WebGLRenderer: new (params: Record<string, unknown>) => Renderer;
  Scene: new () => Obj3D;
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => Camera;
  AmbientLight: new (color: number, intensity: number) => Obj3D;
}

/** die Teile des skinview3d-Viewers, an denen die Cosmetics hängen */
export interface RigViewer {
  readonly playerObject: Obj3D & { skin: Obj3D & { head: Obj3D & { innerLayer: MeshObj }; body: Obj3D } };
  readonly playerWrapper: Obj3D;
  readonly renderer: Renderer;
  readonly scene: Obj3D;
  readonly camera: Camera;
  readonly globalLight: Obj3D;
  zoom: number;
  render(): void;
}
interface RigLib {
  NameTagObject: new (text: string, options?: { repaintAfterLoaded?: boolean }) => Obj3D & { material: MaterialLike & { map: Tex | null } };
}

const NEAREST = 1003; // THREE.NearestFilter
const DOUBLE_SIDE = 2; // THREE.DoubleSide
const ADDITIVE = 2; // THREE.AdditiveBlending
/** Pixel mit weniger Deckkraft fallen weg (wie die Vorschau: 26 / 255) */
const ALPHA_CUT = 0.1;

let cachedThree: Three | null | undefined;

const ctor = <T>(value: unknown): T => (value as { constructor: T }).constructor;
const parentCtor = <T>(value: unknown): T => Object.getPrototypeOf((value as { constructor: { prototype: object } }).constructor.prototype).constructor as T;

/** Klassen von three.js aus den Objekten einer skinview3d-Figur (siehe oben). null = nicht verfügbar. */
function threeFrom(viewer: RigViewer): Three | null {
  if (cachedThree !== undefined) return cachedThree;
  cachedThree = null;
  try {
    const lib = (window as unknown as { skinview3d?: RigLib }).skinview3d;
    if (!lib) return null;
    const headMesh = viewer.playerObject.skin.head.innerLayer;
    const position = headMesh.geometry.getAttribute('position');
    const tag = new lib.NameTagObject('·', { repaintAfterLoaded: false });
    const tagTexture = tag.material.map;
    if (!position || !tagTexture) return null;
    const three: Three = {
      Group: ctor(viewer.playerWrapper),
      Mesh: ctor(headMesh),
      // BoxGeometry → BufferGeometry
      BufferGeometry: parentCtor(headMesh.geometry),
      Float32BufferAttribute: ctor(position),
      MeshStandardMaterial: ctor(headMesh.material),
      Sprite: Object.getPrototypeOf(lib.NameTagObject.prototype).constructor,
      SpriteMaterial: ctor(tag.material),
      CanvasTexture: ctor(tagTexture),
      WebGLRenderer: ctor(viewer.renderer),
      Scene: ctor(viewer.scene),
      PerspectiveCamera: ctor(viewer.camera),
      AmbientLight: ctor(viewer.globalLight),
    };
    tagTexture.dispose();
    tag.material.dispose();
    if (typeof new three.BufferGeometry().setAttribute !== 'function') return null;
    cachedThree = three;
  } catch {
    cachedThree = null;
  }
  return cachedThree;
}

// ---------- Hilfen ----------
const RAD = Math.PI / 180;
const AXIS: Record<'x' | 'y' | 'z', 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

async function decode(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

function pixelTexture(three: Three, image: HTMLImageElement | HTMLCanvasElement): Tex {
  const texture = new three.CanvasTexture(image);
  texture.magFilter = NEAREST;
  texture.minFilter = NEAREST;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const sub = (a: CosmeticVec3, b: CosmeticVec3): CosmeticVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: CosmeticVec3, b: CosmeticVec3): CosmeticVec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: CosmeticVec3, b: CosmeticVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Flächen eines Bones als Dreiecke (gegen den Uhrzeigersinn von außen, auch bei gespiegelten Würfeln) */
function boneGeometry(three: Three, faces: CosmeticFace[], size: [number, number]): Geometry {
  const positions = new Float32Array(faces.length * 18);
  const uvs = new Float32Array(faces.length * 12);
  const normals = new Float32Array(faces.length * 18);
  faces.forEach((face, f) => {
    const [a, , c, d] = face.corners;
    // Reihenfolge so, dass die Dreiecke nach außen (Richtung normal) zeigen
    const outward = dot(cross(sub(d, a), sub(c, a)), face.normal) >= 0;
    const order = outward ? [0, 3, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3];
    order.forEach((corner, k) => {
      const p = face.corners[corner];
      const [u, v] = face.uvs[corner];
      positions.set(p, (f * 6 + k) * 3);
      uvs.set([u / size[0], 1 - v / size[1]], (f * 6 + k) * 2);
      normals.set(face.normal, (f * 6 + k) * 3);
    });
  });
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new three.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new three.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** Lage der Bones zur Zeit t (Sekunden): Grad und Pixel, additiv zur Ruhelage */
function pose(item: CosmeticItem, t: number): Map<string, { rotation: CosmeticVec3; offset: CosmeticVec3 }> {
  const result = new Map<string, { rotation: CosmeticVec3; offset: CosmeticVec3 }>();
  for (const bone of item.bones) result.set(bone.name, { rotation: [...bone.rotation], offset: [0, 0, 0] });
  for (const a of item.animations) {
    const p = result.get(a.bone);
    if (!p) continue;
    const axis = AXIS[a.axis];
    const wave = Math.sin(2 * Math.PI * (a.speed * t + a.phase));
    if (a.type === 'spin') p.rotation[axis] += 360 * ((a.speed * t + a.phase) % 1);
    else if (a.type === 'bob') p.offset[axis] += a.amplitude * wave;
    else p.rotation[axis] += a.amplitude * wave;
  }
  return result;
}

/** Hülle aller Ecken unter root (in den Koordinaten von root; root selbst ohne Eltern) */
function bounds(root: Obj3D): { min: CosmeticVec3; max: CosmeticVec3 } | null {
  root.updateMatrixWorld(true);
  const min: CosmeticVec3 = [Infinity, Infinity, Infinity];
  const max: CosmeticVec3 = [-Infinity, -Infinity, -Infinity];
  const visit = (node: Obj3D) => {
    const positions = (node as MeshObj).geometry?.getAttribute('position')?.array;
    if (positions) {
      const m = node.matrixWorld.elements;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
    }
    node.children.forEach(visit);
  };
  visit(root);
  return Number.isFinite(min[0]) ? { min, max } : null;
}

// ---------- Modelle ----------
interface BoneNode {
  bone: CosmeticBoneData;
  outer: Obj3D;
}

class ModelMount {
  readonly root: Obj3D;
  private readonly nodes: BoneNode[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(three: Three, readonly item: CosmeticItem, texture: Tex, glow: Tex | null) {
    this.root = new three.Group();
    this.disposables.push(texture);
    if (glow) this.disposables.push(glow);
    const base = new three.MeshStandardMaterial({ map: texture, side: DOUBLE_SIDE, alphaTest: ALPHA_CUT });
    this.disposables.push(base);
    let light: MaterialLike | null = null;
    if (glow) {
      // ohne Licht: schwarze Grundfarbe, Farbe nur aus der Leuchtebene; etwas näher zur Kamera als die Textur
      light = new three.MeshStandardMaterial({
        map: glow,
        emissiveMap: glow,
        emissive: 0xffffff,
        color: 0x000000,
        side: DOUBLE_SIDE,
        alphaTest: ALPHA_CUT,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
      this.disposables.push(light);
    }
    // model.scale um den Anker, über allen Bones (root selbst bekommt beim Begleiter Platz und companion.scale)
    const model = new three.Group();
    model.scale.set(item.modelScale, item.modelScale, item.modelScale);
    this.root.add(model);
    const inners = new Map<string, Obj3D>();
    for (const bone of item.bones) {
      const outer = new three.Group();
      outer.rotation.order = 'ZYX';
      const inner = new three.Group();
      inner.position.set(-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]);
      outer.add(inner);
      (bone.parent ? inners.get(bone.parent) ?? model : model).add(outer);
      inners.set(bone.name, inner);
      if (bone.faces.length) {
        const geometry = boneGeometry(three, bone.faces, item.textureSize);
        this.disposables.push(geometry);
        inner.add(new three.Mesh(geometry, base));
        if (light) {
          const mesh = new three.Mesh(geometry, light);
          mesh.renderOrder = 1;
          inner.add(mesh);
        }
      }
      this.nodes.push({ bone, outer });
    }
    this.update(0);
  }

  update(t: number): void {
    const p = pose(this.item, t);
    for (const { bone, outer } of this.nodes) {
      const lage = p.get(bone.name);
      if (!lage) continue;
      outer.position.set(bone.pivot[0] + lage.offset[0], bone.pivot[1] + lage.offset[1], bone.pivot[2] + lage.offset[2]);
      outer.rotation.set(lage.rotation[0] * RAD, lage.rotation[1] * RAD, lage.rotation[2] * RAD);
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}

// ---------- Format 2: animiertes Mesh ----------

/** Verschiebung eines Format-2-Modells im Body-Raum (Pixel): Begleiter an attach.origin, sonst keine */
export function meshOffset(item: CosmeticItem): CosmeticVec3 {
  const origin = item.slot === 'companion' ? item.mesh?.attach.origin : null;
  return origin ? [origin[0], origin[1], origin[2]] : [0, 0, 0];
}

/**
 * Ein Format-2-Cosmetic: ein Mesh (Albedo) und, mit glow, ein zweites (Leuchten) mit derselben Geometrie. root liegt im
 * Anker (Halshöhe, +Y oben, +Z vorn) und dreht in den Body-Raum; update(t) bewegt die Ecken für die Rig-Uhr t.
 */
export class MeshMount {
  readonly root: Obj3D;
  readonly rig: MeshRig;
  readonly animator: MeshAnimator;
  private readonly matrices: Float32Array;
  private readonly position: Attribute;
  private readonly normal: Attribute;
  private readonly glowMaterial: MaterialLike | null = null;
  private readonly glow: Tex | null;
  private readonly disposables: { dispose(): void }[] = [];
  private shownAt = Number.NaN;
  private shownFrame = -1;

  constructor(three: Three, readonly item: CosmeticItem, texture: Tex, glow: Tex | null) {
    const data = item.mesh;
    if (!data) throw new Error('kein Mesh');
    this.rig = decodeMeshRig(data);
    this.animator = new MeshAnimator(this.rig);
    this.matrices = new Float32Array(this.rig.parents.length * 16);
    this.glow = glow;
    this.root = new three.Group();
    // Body-Raum (+Y unten, +Z hinten) → Szene (+Y oben, +Z vorn); Modelle sind links gebaut, rechts = gespiegelt
    this.root.rotation.set(Math.PI, 0, 0);
    if (data.attach.side === 'right') this.root.scale.set(-1, 1, 1);
    const inner = new three.Group();
    const [ox, oy, oz] = meshOffset(item);
    inner.position.set(ox, oy, oz);
    this.root.add(inner);

    const rig = this.rig;
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
    this.position = geometry.getAttribute('position')!;
    this.normal = geometry.getAttribute('normal')!;
    this.disposables.push(geometry, texture);
    const base = new three.MeshStandardMaterial({ map: texture, side: DOUBLE_SIDE, alphaTest: ALPHA_CUT });
    this.disposables.push(base);
    const mesh = new three.Mesh(geometry, base);
    mesh.frustumCulled = false;
    inner.add(mesh);
    if (glow) {
      // nur das Leuchten: schwarz und metallisch (kein Licht, kein Glanz), Farbe aus emissiveMap, aufaddiert
      const frames = Math.max(1, data.emissive?.frames ?? 1);
      glow.repeat.set(1, 1 / frames);
      glow.offset.set(0, (frames - 1) / frames);
      glow.needsUpdate = true;
      const light = new three.MeshStandardMaterial({
        color: 0x000000,
        metalness: 1,
        roughness: 1,
        emissive: 0xffffff,
        emissiveMap: glow,
        side: DOUBLE_SIDE,
        transparent: true,
        depthWrite: false,
        blending: ADDITIVE,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
      this.glowMaterial = light;
      this.disposables.push(light, glow);
      const shine = new three.Mesh(geometry, light);
      shine.renderOrder = 1;
      shine.frustumCulled = false;
      inner.add(shine);
    }
    this.update(0);
  }

  /** Animation wählen (restart: von vorn; immediate: ohne Überblenden, z. B. im Standbild) */
  play(name: string, t: number, options: { restart?: boolean; immediate?: boolean } = {}): void {
    this.animator.play(name, t, options);
    this.shownAt = Number.NaN;
  }

  update(t: number): void {
    if (t === this.shownAt) return;
    this.shownAt = t;
    const pose = this.animator.update(t);
    boneMatrices(this.rig, pose, this.matrices);
    skinMesh(this.rig, this.matrices, this.position.array, this.normal.array);
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    if (this.glow && this.glowMaterial) {
      const emissive = this.rig.emissive;
      const frames = Math.max(1, emissive?.frames ?? 1);
      const frame = glowFrame(emissive, t);
      if (frame !== this.shownFrame) {
        this.shownFrame = frame;
        // Bild 0 oben im Streifen; die Textur ist gespiegelt geladen (v = 0 unten)
        this.glow.offset.set(0, (frames - 1 - frame) / frames);
      }
      this.glowMaterial.emissiveIntensity = glowIntensity(emissive, t);
    }
  }

  /** Hülle der Idle-Pose in Spielerkoordinaten relativ zum Hals (Pixel; +Y oben, +Z vorn) */
  extent(): { min: CosmeticVec3; max: CosmeticVec3 } | null {
    const idle = stateClip(this.rig, 'idle');
    const probe = new MeshAnimator(this.rig, idle?.name ?? null);
    const matrices = boneMatrices(this.rig, probe.update(0));
    const positions = new Float32Array(this.rig.vertexCount * 3);
    skinMesh(this.rig, matrices, positions, new Float32Array(this.rig.vertexCount * 3));
    const box = meshBounds(positions, this.rig.vertexCount);
    if (!box) return null;
    const [ox, oy, oz] = meshOffset(this.item);
    return { min: [box.min[0] + ox, -(box.max[1] + oy), -(box.max[2] + oz)], max: [box.max[0] + ox, -(box.min[1] + oy), -(box.min[2] + oz)] };
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}

// ---------- Partikel (aura) ----------
interface Particle {
  sprite: Obj3D;
  material: MaterialLike & { map: Tex | null };
  age: number;
  life: number;
  angle: number;
  dist: number;
  y: number;
  seed: number;
  frame: number;
}

/** höchstens so viele lebende Partikel (wie im Spiel) */
const MAX_PARTICLES = 64;

class AuraMount {
  readonly root: Obj3D;
  private readonly frames: Tex[] = [];
  private readonly particles: Particle[] = [];
  private due = 0;
  /** Zufall für die Partikel (Park-Miller), Startwert zufällig */
  private seed = 1 + Math.floor(Math.random() * 2147483645);

  constructor(private readonly three: Three, readonly item: CosmeticItem, texture: Tex) {
    this.root = new three.Group();
    const count = Math.max(1, item.particles?.frames ?? 1);
    for (let f = 0; f < count; f++) {
      const frame = f === 0 ? texture : texture.clone();
      frame.repeat.set(1 / count, 1);
      frame.offset.set(f / count, 0);
      frame.needsUpdate = true;
      this.frames.push(frame);
    }
    // gleich voll: eine Lebensdauer im Voraus laufen lassen
    const life = (item.particles?.lifetime ?? 20) / 20;
    for (let t = 0; t < life; t += 0.05) this.update(0.05);
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private spawn(): void {
    const p = this.item.particles!;
    const r = p.radius * 16;
    const material = new this.three.SpriteMaterial({ map: this.frames[0], color: p.color, transparent: true, alphaTest: ALPHA_CUT, depthWrite: false }) as Particle['material'];
    const sprite = new this.three.Sprite(material);
    sprite.scale.set(p.size * 16, p.size * 16, 1);
    const motion = p.motion;
    const y = motion === 'fall' ? 30 + this.random() * 8 : motion === 'rise' ? 1 + this.random() * 8 : 3 + this.random() * 28;
    const particle: Particle = {
      sprite,
      material,
      age: 0,
      life: Math.max(0.25, p.lifetime / 20) * (0.8 + 0.4 * this.random()),
      angle: this.random() * Math.PI * 2,
      dist: r * (0.55 + 0.45 * this.random()),
      y,
      seed: this.random() * 100,
      frame: 0,
    };
    this.particles.push(particle);
    this.root.add(sprite);
    this.place(particle);
  }

  /** Lage eines Partikels über der Fußmitte (Pixel), je nach Bewegungsart */
  private place(q: Particle): void {
    const p = this.item.particles!;
    const k = q.age / q.life;
    let angle = q.angle;
    let dist = q.dist;
    let y = q.y;
    if (p.motion === 'rise') y += k * 28;
    else if (p.motion === 'fall') {
      y -= k * 30;
      angle += Math.sin(q.seed + q.age * 2.4) * 0.18;
    } else if (p.motion === 'orbit') {
      angle += q.age * 1.8;
      y += Math.sin(q.seed + q.age * 1.5) * 1.5;
    } else if (p.motion === 'spark') dist += k * 4;
    else {
      // float: langsames Treiben
      y += Math.sin(q.seed + q.age * 1.3) * 2.5;
      angle += q.age * 0.25;
    }
    q.sprite.position.set(Math.cos(angle) * dist, y, Math.sin(angle) * dist);
    const frame = Math.min(this.frames.length - 1, Math.floor(k * this.frames.length));
    if (frame !== q.frame) {
      // anderes Bild desselben Streifens: nur die Textur tauschen (gleiche Quelle, kein neues Shader-Programm)
      q.frame = frame;
      q.material.map = this.frames[frame];
    }
  }

  update(dt: number): void {
    const p = this.item.particles;
    if (!p || dt <= 0) return;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.age += dt;
      if (q.age >= q.life) {
        this.root.remove(q.sprite);
        q.material.dispose();
        this.particles.splice(i, 1);
      } else this.place(q);
    }
    this.due += dt * p.rate;
    while (this.due >= 1) {
      this.due -= 1;
      if (this.particles.length < MAX_PARTICLES) this.spawn();
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const q of this.particles) q.material.dispose();
    this.particles.length = 0;
    for (const f of this.frames) f.dispose();
  }
}

// ---------- an der Figur ----------
type Mount = ModelMount | AuraMount | MeshMount;

/** Animationen eines Format-2-Cosmetics an der Figur */
export interface RigAnimations {
  /** Namen wie im Manifest (Reihenfolge des Manifests) */
  names: string[];
  /** gewählte Schleife bzw. Animation (Standard: Zustand idle) */
  chosen: string;
  /** Animation des Zustands emote (falls vorhanden) */
  emote: string | null;
}

/** wie weit ein Cosmetic in Spielerkoordinaten reicht (Pixel; Füße bei −16, Kopf oben bei 16) */
interface Extent {
  /** größter Abstand von der senkrechten Achse */
  side: number;
  top: number;
  bottom: number;
}

/**
 * Cosmetics an einer skinview3d-Figur. Bewegt wird vor jedem Bild des Viewers (render() wird umschlossen), also nur,
 * solange der Viewer zeichnet.
 */
export class CosmeticRig {
  private readonly mounts = new Map<CosmeticModelSlot, Mount>();
  private readonly extents = new Map<CosmeticModelSlot, Extent>();
  private baseZoom: number | null = null;
  private readonly wanted = new Map<CosmeticModelSlot, string>();
  private readonly anchors: Record<'head' | 'back' | 'body' | 'stand', Obj3D>;
  /** Format 2: gewählte Animation je Cosmetic (Schlüssel id:sha256) */
  private readonly chosen = new Map<string, string>();
  /** Format 2: Slot, der gerade sein Emote zeigt (Schlüssel des Cosmetics) */
  private readonly emoting = new Map<CosmeticModelSlot, string>();
  private motion = true;
  private time = 0;
  private last = performance.now();

  private constructor(private readonly viewer: RigViewer, private readonly three: Three) {
    const skin = viewer.playerObject.skin;
    const head = new three.Group();
    head.position.set(0, 8, 0); // Oberseite des Kopfes (Kopf 8 × 8 × 8 über dem Hals)
    skin.head.add(head);
    // Schulterhöhe (Rumpf 12 hoch, Mitte bei 0) = Hals-Pivot des Rumpfs: auch der Ursprung des Body-Raums (Format 2)
    const back = new three.Group();
    back.position.set(0, 6, 0);
    skin.body.add(back);
    // Füße der Figur: Spielerobjekt y = −16 (Beine enden 24 unter dem Hals, der liegt bei 8)
    const body = new three.Group();
    body.position.set(0, -16, 0);
    viewer.playerObject.add(body);
    // Format-2-Auren: Hals-Höhe am Spielerobjekt (dieselben Pixel wie der Body-Raum, aber ohne Rumpf-Neigung)
    const stand = new three.Group();
    stand.position.set(0, 8, 0);
    viewer.playerObject.add(stand);
    this.anchors = { head, back, body, stand };
    const render = viewer.render.bind(viewer);
    viewer.render = () => {
      this.tick();
      render();
    };
  }

  /** null, wenn three.js aus skinview3d nicht greifbar ist */
  static attach(viewer: RigViewer): CosmeticRig | null {
    const three = threeFrom(viewer);
    return three ? new CosmeticRig(viewer, three) : null;
  }

  /** Animationen und Partikel anhalten (Standbild) oder weiterlaufen lassen */
  setMotion(on: boolean): void {
    this.motion = on;
  }

  /**
   * Kamera so weit zurücknehmen, dass Figur und Cosmetics ins Bild passen (höchstens base, wie ohne Cosmetics).
   * skinview3d: Abstand = 4,5 + 16,5 / tan(fov/2) / zoom, Mitte des Bildes bei y = 0 (Figur von −16 bis 16).
   */
  autoZoom(base: number): void {
    this.baseZoom = base;
  }

  private targetZoom(base: number): number {
    let half = 18;
    let side = 11;
    for (const e of this.extents.values()) {
      half = Math.max(half, e.top + 2, -e.bottom + 2);
      side = Math.max(side, e.side + 2);
    }
    const t = Math.tan((this.viewer.camera.fov * RAD) / 2);
    const need = Math.max(half, side / Math.max(0.3, this.viewer.camera.aspect || 1));
    return Math.min(base, 16.5 / Math.max(1, need - 4.5 * t));
  }

  private tick(): void {
    const now = performance.now();
    const real = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    const dt = this.motion ? real : 0;
    this.last = now;
    this.time += dt;
    if (this.baseZoom !== null) {
      const target = this.targetZoom(this.baseZoom);
      const zoom = this.viewer.zoom;
      if (Math.abs(target - zoom) > 0.001) this.viewer.zoom = this.motion ? zoom + (target - zoom) * Math.min(1, real * 7) : target;
    }
    for (const mount of this.mounts.values()) {
      if (mount instanceof AuraMount) mount.update(dt);
      else mount.update(this.time);
    }
  }

  private key(item: CosmeticItem | null): string {
    return item ? `${item.id}:${item.sha256}` : '';
  }

  // ---------- Format 2: Animationen ----------

  /** Animationen des Format-2-Cosmetics, das gerade in diesem Slot an der Figur hängt (sonst null) */
  animations(slot: CosmeticModelSlot): RigAnimations | null {
    const mount = this.mounts.get(slot);
    if (!(mount instanceof MeshMount)) return null;
    const rig = mount.rig;
    const emote = rig.byName.has(rig.states.emote ?? '') ? rig.states.emote : null;
    return { names: rig.clips.map((c) => c.name), chosen: this.chosenFor(mount.item, rig), emote };
  }

  private chosenFor(item: CosmeticItem, rig: MeshRig): string {
    const name = this.chosen.get(this.key(item));
    return name && rig.byName.has(name) ? name : stateClip(rig, 'idle')?.name ?? rig.clips[0]?.name ?? '';
  }

  /** Animation eines Cosmetics wählen (null = Zustand idle); gilt, solange es an der Figur hängt */
  setAnimation(item: CosmeticItem, name: string | null): void {
    const key = this.key(item);
    if (name) this.chosen.set(key, name);
    else this.chosen.delete(key);
    for (const [slot, mount] of this.mounts) if (mount instanceof MeshMount && this.key(mount.item) === key) this.applyAnimation(slot, true);
  }

  /** Emote eines Slots zeigen (item = dieses Cosmetic, z. B. beim Überfahren seiner Kachel) oder beenden (null) */
  emote(slot: CosmeticModelSlot, item: CosmeticItem | null): void {
    const key = item?.mesh ? this.key(item) : '';
    if ((this.emoting.get(slot) ?? '') === key) return;
    if (key) this.emoting.set(slot, key);
    else this.emoting.delete(slot);
    this.applyAnimation(slot, false);
  }

  private applyAnimation(slot: CosmeticModelSlot, restart: boolean): void {
    const mount = this.mounts.get(slot);
    if (!(mount instanceof MeshMount)) return;
    const rig = mount.rig;
    const emote = this.emoting.get(slot) === this.key(mount.item) ? rig.states.emote : undefined;
    const name = emote && rig.byName.has(emote) ? emote : this.chosenFor(mount.item, rig);
    // einmalige Animationen beim erneuten Wählen von vorn; im Standbild ohne Überblenden
    const clip = rig.byName.get(name);
    if (clip) mount.play(name, this.time, { restart: restart && !clip.loop, immediate: !this.motion });
    mount.update(this.time);
  }

  /** Cosmetic eines Slots zeigen (null = keins). Gleiche Version bleibt, wie sie ist. */
  async show(slot: CosmeticModelSlot, item: CosmeticItem | null): Promise<void> {
    const key = item && item.slot === slot ? this.key(item) : '';
    if ((this.wanted.get(slot) ?? '') === key && (key === '' || this.mounts.has(slot))) return;
    this.wanted.set(slot, key);
    if (!item || !key) {
      this.mounts.get(slot)?.dispose();
      this.mounts.delete(slot);
      this.extents.delete(slot);
      return;
    }
    if (!item.mesh && (slot === 'aura' ? !item.particles : !item.bones.length)) return;
    let mount: Mount;
    try {
      const [image, glow] = await Promise.all([decode(item.texture), item.glow && (slot !== 'aura' || item.mesh) ? decode(item.glow) : Promise.resolve(null)]);
      if (this.wanted.get(slot) !== key) return;
      const texture = pixelTexture(this.three, image);
      if (item.mesh) mount = new MeshMount(this.three, item, texture, glow ? pixelTexture(this.three, glow) : null);
      else if (slot === 'aura') mount = new AuraMount(this.three, item, texture);
      else {
        const model = new ModelMount(this.three, item, texture, glow ? pixelTexture(this.three, glow) : null);
        model.update(this.time);
        mount = model;
      }
    } catch {
      return;
    }
    if (this.wanted.get(slot) !== key) {
      mount.dispose();
      return;
    }
    this.mounts.get(slot)?.dispose();
    this.mounts.set(slot, mount);
    this.extents.set(slot, this.extentOf(slot, item, mount));
    this.place(slot, item, mount);
    // Format 2: gewählte Animation (bzw. Emote, wenn die Kachel gerade überfahren wird)
    if (mount instanceof MeshMount) this.applyAnimation(slot, false);
  }

  /** Ausdehnung in der Ruhelage (vor dem Einhängen: root ohne Eltern und unverschoben) */
  private extentOf(slot: CosmeticModelSlot, item: CosmeticItem, mount: Mount): Extent {
    if (mount instanceof MeshMount) {
      // Hals bei y = 8 im Spielerobjekt (Rumpf-Anker und Aura-Anker); etwas Luft für größere Bewegungen
      const box = mount.extent();
      if (!box) return { side: 0, top: 0, bottom: 0 };
      const x = Math.max(Math.abs(box.min[0]), Math.abs(box.max[0]));
      const z = Math.max(Math.abs(box.min[2]), Math.abs(box.max[2]));
      return { side: Math.hypot(x, z) + 1, top: 8 + box.max[1] + 1, bottom: 8 + box.min[1] - 1 };
    }
    if (mount instanceof AuraMount) {
      const p = item.particles!;
      return { side: p.radius * 16 + p.size * 8, top: 22 + p.size * 8, bottom: -16 };
    }
    const box = bounds(mount.root);
    if (!box) return { side: 0, top: 0, bottom: 0 };
    const { min, max } = box;
    if (slot === 'companion') {
      const [ox, oy, oz] = item.companion?.offset ?? [0, 0, 0];
      const s = item.companion?.scale ?? 1;
      const x = Math.max(Math.abs(-ox * 16 + s * min[0]), Math.abs(-ox * 16 + s * max[0]));
      const z = Math.max(Math.abs(oz * 16 + s * min[2]), Math.abs(oz * 16 + s * max[2]));
      return { side: Math.hypot(x, z), top: -16 + oy * 16 + s * max[1], bottom: -16 + oy * 16 + s * min[1] };
    }
    // Kopf-Oberseite bei y = 16, Schulterhöhe bei y = 8
    const y = slot === 'head' ? 16 : 8;
    const x = Math.max(Math.abs(min[0]), Math.abs(max[0]));
    const z = Math.max(Math.abs(min[2]), Math.abs(max[2]));
    return { side: Math.hypot(x, z), top: y + max[1], bottom: y + min[1] };
  }

  private place(slot: CosmeticModelSlot, item: CosmeticItem, mount: Mount): void {
    const root = mount.root;
    if (mount instanceof MeshMount) {
      // Format 2: Body-Raum am Rumpf (Hals); Auren ohne Rumpf am Spielerobjekt
      (slot === 'aura' ? this.anchors.stand : this.anchors.back).add(root);
      return;
    }
    if (slot === 'head') this.anchors.head.add(root);
    else if (slot === 'back') this.anchors.back.add(root);
    else if (slot === 'aura') this.anchors.body.add(root);
    else {
      // Begleiter: eigener Platz neben der Figur (Blöcke; x zeigt zur rechten Seite des Trägers = Modell −x)
      const [x, y, z] = item.companion?.offset ?? [0.7, 1.6, -0.4];
      const scale = item.companion?.scale ?? 1;
      root.position.set(-x * 16, y * 16, z * 16);
      root.scale.set(scale, scale, scale);
      this.anchors.body.add(root);
    }
  }

  /** alle Slots auf einmal (fehlende Slots = keins) */
  async showAll(items: Partial<Record<CosmeticModelSlot, CosmeticItem | null>>): Promise<void> {
    await Promise.all((['head', 'back', 'aura', 'companion'] as const).map((slot) => this.show(slot, items[slot] ?? null)));
  }

  clear(): void {
    for (const mount of this.mounts.values()) mount.dispose();
    this.mounts.clear();
    this.extents.clear();
    this.wanted.clear();
    this.emoting.clear();
  }
}

// ---------- Vorschaubilder ----------

/** 3D-Vorschaubilder der Modelle (eigener kleiner Renderer), als PNG-data:-URL zwischengespeichert */
export class CosmeticThumbnails {
  private renderer: Renderer | null = null;
  private readonly canvas = document.createElement('canvas');
  private readonly cache = new Map<string, Promise<string | null>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly viewer: RigViewer) {}

  /** Vorschau eines Cosmetics (head, back, companion: 3D; aura: Partikelbilder) oder null */
  get(item: CosmeticItem, size = 160): Promise<string | null> {
    const key = `${item.id}:${item.sha256}:${size}`;
    let promise = this.cache.get(key);
    if (!promise) {
      promise = this.queue.then(() => this.render(item, size)).catch(() => null);
      this.queue = promise;
      this.cache.set(key, promise);
    }
    return promise;
  }

  private async render(item: CosmeticItem, size: number): Promise<string | null> {
    if (item.slot === 'aura' && !item.mesh) return auraThumbnail(item, size);
    if (!item.bones.length && !item.mesh) return null;
    const three = threeFrom(this.viewer);
    if (!three) return null;
    if (!this.renderer) {
      this.renderer = new three.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      // wie die Figur (dort ohne Umrechnung nach sRGB, siehe skinview3d: Ausgabe über die Effekt-Pipeline)
      this.renderer.outputColorSpace = 'srgb-linear';
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0, 0);
    }
    this.renderer.setSize(size, size, false);
    const [image, glow] = await Promise.all([decode(item.texture), item.glow ? decode(item.glow) : Promise.resolve(null)]);
    // Format 2: Standbild der Idle-Pose (Anfang der Animation), Leuchten mit mittlerem Puls
    const mount = item.mesh
      ? new MeshMount(three, item, pixelTexture(three, image), glow ? pixelTexture(three, glow) : null)
      : new ModelMount(three, item, pixelTexture(three, image), glow ? pixelTexture(three, glow) : null);
    // Hülle aller Ecken in der Ruhelage
    const box = bounds(mount.root);
    if (!box) {
      mount.dispose();
      return null;
    }
    const { min, max } = box;
    const scene = new three.Scene();
    scene.add(new three.AmbientLight(0xffffff, 3));
    scene.add(mount.root);
    const center: CosmeticVec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    const [yawDeg, pitchDeg] = thumbnailView(item);
    const yaw = yawDeg * RAD;
    const pitch = pitchDeg * RAD;
    const fov = 24;
    const distance = (radius / Math.sin((fov / 2) * RAD)) * 1.02;
    const camera = new three.PerspectiveCamera(fov, 1, 1, distance + radius * 4);
    camera.position.set(center[0] + Math.sin(yaw) * Math.cos(pitch) * distance, center[1] + Math.sin(pitch) * distance, center[2] + Math.cos(yaw) * Math.cos(pitch) * distance);
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();
    scene.add(camera);
    this.renderer.render(scene, camera);
    const url = this.canvas.toDataURL('image/png');
    mount.dispose();
    return url;
  }
}

/**
 * Blickrichtung eines Vorschaubilds in Grad [Drehung um y, Neigung von oben]: leicht von oben schräg von vorn,
 * Rückenteile schräg von hinten, Auren (Format 2) steiler von oben, damit der Boden-Kreis zu sehen ist.
 */
export function thumbnailView(item: Pick<CosmeticItem, 'slot' | 'mesh'>): [number, number] {
  if (item.slot === 'back') return [180 - 30, 16];
  if (item.slot === 'aura' && item.mesh) return [20, 30];
  return [30, 16];
}

/** Vorschau einer Aura: einige Partikelbilder, getönt, verstreut */
async function auraThumbnail(item: CosmeticItem, size: number): Promise<string | null> {
  const p = item.particles;
  if (!p) return null;
  const image = await decode(item.texture);
  const frames = Math.max(1, p.frames);
  const fw = image.naturalWidth / frames;
  const fh = image.naturalHeight;
  // getönte Bilder (multiplikativ, Deckkraft wie im Bild)
  const tinted = document.createElement('canvas');
  tinted.width = image.naturalWidth;
  tinted.height = fh;
  const t = tinted.getContext('2d');
  if (!t) return null;
  t.imageSmoothingEnabled = false;
  t.drawImage(image, 0, 0);
  t.globalCompositeOperation = 'multiply';
  t.fillStyle = p.color;
  t.fillRect(0, 0, tinted.width, fh);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(image, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.imageSmoothingEnabled = false;
  const spots: [number, number, number][] = [
    [0.5, 0.5, 0.42],
    [0.2, 0.28, 0.24],
    [0.8, 0.24, 0.28],
    [0.24, 0.76, 0.3],
    [0.78, 0.74, 0.22],
    [0.52, 0.12, 0.16],
  ];
  spots.forEach(([x, y, s], i) => {
    const edge = Math.round(size * s);
    const frame = i % frames;
    c.drawImage(tinted, frame * fw, 0, fw, fh, Math.round(x * size - edge / 2), Math.round(y * size - edge / 2), edge, edge);
  });
  return canvas.toDataURL('image/png');
}
