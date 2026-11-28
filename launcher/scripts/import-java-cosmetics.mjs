// Übernimmt Cosmetics, die als Minecraft-Java-Modell gebaut wurden (Blockbench-Export „Modded Entity“ mit Mojang-Namen:
// MeshDefinition, PartDefinition, CubeListBuilder), in das Cosmetic-Format von HeldixClient:
//   cosmetics/<id>/quelle/   Java-Datei mit dem Modell (Methode create()) und die Texturen in voller Auflösung
//   cosmetics/<id>/          cosmetic.json, texture.png, glow.png (danach wie alle anderen: npm run cosmetic)
//
// Umrechnung (siehe launcher/src/main/core/cosmetics.ts):
//   Java-Modellraum: Pixel, y nach unten, vorn = −z; Teile relativ zum Elternteil, Würfel relativ zum Teil.
//   Cosmetic-Modellraum: Pixel, +y oben, +z vorn; Pivots und Würfel absolut (ohne Drehung der Eltern).
//   → x bleibt, y und z kehren sich um (Drehung um x um 180°): Drehwinkel um x bleiben, um y und z wechseln das
//     Vorzeichen; Reihenfolge Rz·Ry·Rx ist in beiden Formaten gleich. Box-UV (texOffs) bleibt, weil beide Formate die
//     Flächen nach Seiten des Trägers (rechts, vorn, links, hinten, oben, unten) belegen.
// Texturen: die Farbe des Addons (Tönung) wird eingerechnet, mehrere Durchgänge (Knochen, Fleisch) werden zu einer
// Textur gestapelt. Die Auflösung bleibt (vierfach: 512 × 256 für 128 × 64 Texel; Cosmetics erlauben bis 512 Pixel).
//
// Aufruf: npm run cosmetics-import   (nur Node)
// Herkunft: Cyber-Flügel und Krallen sind Entwürfe eines externen Entwicklers (ursprünglich als Addons gebaut).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from './png-rgba.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COSMETICS = path.join(ROOT, 'cosmetics');

// PNG lesen und schreiben: scripts/png-rgba.mjs

/** RGB mit einer Farbe (0xRRGGBB) und einem Faktor multiplizieren – wie die Tönung beim Zeichnen */
function tint(img, color, factor = 1) {
  const r = ((color >> 16) & 255) / 255 * factor, g = ((color >> 8) & 255) / 255 * factor, b = (color & 255) / 255 * factor;
  const data = Buffer.from(img.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.round(data[i] * r));
    data[i + 1] = Math.min(255, Math.round(data[i + 1] * g));
    data[i + 2] = Math.min(255, Math.round(data[i + 2] * b));
  }
  return { ...img, data };
}

/** top über bottom legen (gleiche Größe), wie zwei Durchgänge mit Ausschnitt-Textur nacheinander */
function stack(bottom, top) {
  const data = Buffer.from(bottom.data);
  for (let i = 0; i < data.length; i += 4) {
    if (top.data[i + 3] >= 128) top.data.copy(data, i, i, i + 4);
  }
  return { ...bottom, data };
}

// ---------------------------------------------------------------------------------------------
// Java-Modell lesen
// ---------------------------------------------------------------------------------------------

const NUM = String.raw`(-?\d+(?:\.\d+)?)F?`;

/** Teile aus der Methode create(): Name, Eltern, Pose (Pixel, Bogenmaß), Würfel mit texOffs, grow und mirror */
function parseJavaModel(source) {
  const start = source.indexOf('MeshDefinition mesh = new MeshDefinition();');
  if (start < 0) throw new Error('create() mit MeshDefinition nicht gefunden');
  const body = source.slice(start, source.indexOf('LayerDefinition.create', start) > 0 ? source.indexOf('LayerDefinition.create', start) : undefined);
  const statements = body.replace(/\s+/g, ' ').split(';');
  const parts = [];
  const byVar = new Map([['root', null]]);
  for (const statement of statements) {
    const m = /^\s*(?:PartDefinition (\w+) = )?(\w+)\.addOrReplaceChild\("(\w+)", CubeListBuilder\.create\(\)(.*), PartPose\.(offset|offsetAndRotation)\(([^)]*)\)\)\s*$/.exec(statement);
    if (!m) continue;
    const [, variable, parentVar, name, chain, poseKind, poseArgs] = m;
    if (!byVar.has(parentVar)) throw new Error(`Elternteil ${parentVar} von ${name} unbekannt`);
    const numbers = poseArgs.split(',').map((s) => parseFloat(s));
    const offset = numbers.slice(0, 3);
    const rotation = poseKind === 'offsetAndRotation' ? numbers.slice(3, 6) : [0, 0, 0];
    const cubes = [];
    let u = 0, v = 0, mirror = false;
    const tokens = chain.match(/\.texOffs\([^)]*\)|\.mirror\(\)|\.mirror\(false\)|\.addBox\([^;]*?(?:CubeDeformation\.NONE|new CubeDeformation\([^)]*\))\)/g) ?? [];
    for (const token of tokens) {
      if (token.startsWith('.texOffs')) [u, v] = token.slice(9, -1).split(',').map((s) => parseInt(s, 10));
      else if (token === '.mirror()') mirror = true;
      else if (token === '.mirror(false)') mirror = false;
      else {
        const args = token.slice(8, -1);
        const values = [...args.matchAll(new RegExp(NUM, 'g'))].map((x) => parseFloat(x[1]));
        const grow = args.includes('CubeDeformation.NONE') ? 0 : values[6];
        cubes.push({ u, v, box: values.slice(0, 3), size: values.slice(3, 6), grow, mirror });
      }
    }
    const part = { name, parent: byVar.get(parentVar), offset, rotation, cubes };
    parts.push(part);
    if (variable) byVar.set(variable, part);
    // Blätter ohne Variable können trotzdem Eltern sein, wenn der Name als Variable fehlt – dann nicht
  }
  if (!parts.length) throw new Error('keine Teile gefunden');
  return parts;
}

const round = (n) => Math.round(n * 1000) / 1000 + 0;

/**
 * In das Cosmetic-Modell umrechnen. options.restRotation(part) liefert zusätzliche Ruhe-Drehungen (Bogenmaß, Java),
 * options.pivotShift verschiebt alles im Java-Raum (für eine Skalierung um einen anderen Punkt als den Ursprung).
 */
function convert(parts, options = {}) {
  const absolute = new Map();
  const shift = options.pivotShift ?? [0, 0, 0];
  for (const part of parts) {
    const base = part.parent ? absolute.get(part.parent) : shift;
    absolute.set(part, [base[0] + part.offset[0], base[1] + part.offset[1], base[2] + part.offset[2]]);
  }
  const toDeg = (r) => (r * 180) / Math.PI;
  return parts.map((part) => {
    const p = absolute.get(part);
    const extra = options.restRotation?.(part) ?? [0, 0, 0];
    const rx = part.rotation[0] + extra[0];
    const ry = part.rotation[1] + extra[1];
    const rz = part.rotation[2] + extra[2];
    const bone = { name: part.name };
    if (part.parent) bone.parent = part.parent.name;
    bone.pivot = [round(p[0]), round(-p[1]), round(-p[2])];
    if (rx || ry || rz) bone.rotation = [round(toDeg(rx)), round(-toDeg(ry)), round(-toDeg(rz))];
    bone.cubes = part.cubes.map((c) => {
      const cube = {
        origin: [round(p[0] + c.box[0]), round(-(p[1] + c.box[1] + c.size[1])), round(-(p[2] + c.box[2] + c.size[2]))],
        size: c.size.map(round),
        uv: [c.u, c.v],
      };
      if (c.grow) cube.inflate = round(c.grow);
      if (c.mirror) cube.mirror = true;
      return cube;
    });
    return bone;
  });
}

// ---------------------------------------------------------------------------------------------
// Die Cosmetics
// ---------------------------------------------------------------------------------------------

/** Drehgeschwindigkeit aus „Winkel · sin(Alter · ω)“ (ω je Tick) in Schwingungen pro Sekunde */
const perSecond = (omegaPerTick) => round((omegaPerTick * 20) / (2 * Math.PI));

const COSMETICS_LIST = [
  {
    id: 'cyberfluegel',
    java: 'WingsModel.java',
    name: 'Cyber-Flügel',
    description: 'Mechanische Flügel mit Panzerarm, Leuchtring-Gelenken und fächernden Federklingen mit leuchtenden Kanten',
    textures: async (dir) => {
      const frame = tint(readPng(await readFile(path.join(dir, 'wings_frame.png'))), 0xc4cad2);
      // Leuchten in Cyan, im Mittel des Pulses (0,72 … 1)
      const glow = tint(readPng(await readFile(path.join(dir, 'wings_glow.png'))), 0x2fe6ff, 0.9);
      return { texture: frame, glow };
    },
    // Ruhepose wie im Addon: Wölbung je Holmglied nach hinten (yRot), rechts +, links −
    restRotation: (part) => {
      const m = /^([rl])_holm(\d)$/.exec(part.name);
      if (!m) return null;
      const camber = [0.3, 0.22, 0.26][Number(m[2])];
      return [0, (m[1] === 'r' ? 1 : -1) * camber, 0];
    },
    // Das Addon verkleinert den Kern um 0,62 um seinen Pivot (0, 2, 2.5): dasselbe als Skalierung um den Ursprung
    scale: 0.62,
    scaleAround: [0, 2, 2.5],
    animations: () => {
      const list = [];
      const breathe = perSecond(0.06);
      // Atmen: Holm hebt und senkt sich, die äußeren Glieder knicken leicht mit; links gegenphasig gespiegelt
      for (const [side, phase] of [['r', 0], ['l', 0.5]]) {
        list.push({ bone: `${side}_holm0`, type: 'flap', axis: 'z', amplitude: 3, speed: breathe, phase });
        list.push({ bone: `${side}_holm1`, type: 'sway', axis: 'z', amplitude: 1.7, speed: breathe, phase: (phase + 0.5) % 1 });
        list.push({ bone: `${side}_holm2`, type: 'sway', axis: 'z', amplitude: 1.4, speed: breathe, phase: (phase + 0.5) % 1 });
      }
      // leise Welle durch die äußeren Klingen
      for (const [side, base] of [['r', 0], ['l', 0.5]]) {
        for (const i of [8, 9, 10, 11, 7]) {
          list.push({ bone: `${side}_klinge${i}`, type: 'sway', axis: 'z', amplitude: 2.5, speed: 0.35, phase: round((base + i * 0.05) % 1) });
        }
      }
      return list;
    },
  },
  {
    id: 'krallen',
    java: 'ClawsModel.java',
    name: 'Krallen',
    description: 'Vier Tentakel-Krallen mit Knochenschuppen, Hakenklingen und pulsierenden Leuchtadern',
    textures: async (dir) => {
      const bone = tint(readPng(await readFile(path.join(dir, 'claws_bone.png'))), 0xe0d4bd);
      const flesh = tint(readPng(await readFile(path.join(dir, 'claws_flesh.png'))), 0x8d2629);
      // Leuchtadern in der Fleischfarbe auf volle Helligkeit gezogen (wie im Addon), im Mittel des Herzschlags
      const glow = tint(readPng(await readFile(path.join(dir, 'claws_glow.png'))), 0xff454a, 0.8);
      return { texture: stack(bone, flesh), glow };
    },
    animations: () => {
      const list = [];
      // je Kralle: Wiegen am Ansatz und ein Einrollen weiter oben, jede Kralle mit eigener Phase
      for (let i = 0; i < 4; i++) {
        const phase = round(((i * 1.7) / (2 * Math.PI)) % 1);
        list.push({ bone: `kralle${i}_g0`, type: 'sway', axis: 'x', amplitude: 3, speed: perSecond(0.05), phase });
        list.push({ bone: `kralle${i}_g2`, type: 'sway', axis: 'x', amplitude: 3, speed: perSecond(0.07), phase: round((phase + 0.11) % 1) });
        list.push({ bone: `kralle${i}_g4`, type: 'sway', axis: 'x', amplitude: 3.5, speed: perSecond(0.07), phase: round((phase + 0.22) % 1) });
        list.push({ bone: `kralle${i}_g6`, type: 'sway', axis: 'x', amplitude: 4, speed: perSecond(0.07), phase: round((phase + 0.33) % 1) });
      }
      return list;
    },
  },
];

async function main() {
  for (const c of COSMETICS_LIST) {
    const dir = path.join(COSMETICS, c.id, 'quelle');
    const parts = parseJavaModel(await readFile(path.join(dir, c.java), 'utf8'));
    let pivotShift;
    if (c.scale && c.scaleAround) {
      // s · (v + t) = s · v + (1 − s) · K  →  t = (1 − s) / s · K (im Java-Raum)
      const k = (1 - c.scale) / c.scale;
      pivotShift = c.scaleAround.map((value) => value * k);
    }
    const bones = convert(parts, { restRotation: c.restRotation, pivotShift });
    const { texture, glow } = await c.textures(dir);
    const manifest = {
      format: 1,
      id: c.id,
      version: 1,
      slot: 'back',
      name: c.name,
      description: c.description,
      access: 'all',
      model: { textureSize: [128, 64], ...(c.scale ? { scale: c.scale } : {}), bones },
      animations: c.animations(),
    };
    // Die Texturen liegen in vierfacher Auflösung vor (512 × 256 für 128 × 64 Texel)
    await mkdir(path.join(COSMETICS, c.id), { recursive: true });
    await writeFile(path.join(COSMETICS, c.id, 'cosmetic.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(COSMETICS, c.id, 'texture.png'), writePng(texture));
    await writeFile(path.join(COSMETICS, c.id, 'glow.png'), writePng(glow));
    const cubes = bones.reduce((n, b) => n + b.cubes.length, 0);
    console.log(`${c.id}: ${bones.length} Bones, ${cubes} Würfel, Textur ${texture.width} × ${texture.height}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
