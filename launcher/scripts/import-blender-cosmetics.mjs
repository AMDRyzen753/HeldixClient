// Übernimmt die Blender-Cosmetics (Export „heldix-cosmetic/1“ der Blender-Skripte: Mesh mit Knochen, ein Quaternion je
// Knochen und Frame, State-Map, Partikel-Vorschläge, Leucht-Streifen) als Quellen im Cosmetics-Format 2:
//   <blender>/output/<Name>/<Name>.cosmetic.json + textures/<Name>_albedo.png + textures/<Name>_emissive_anim.png
//   → cosmetics/<id>/cosmetic.json, texture.png (albedo), glow.png (emissive_anim), pruefbericht.txt
// Danach wie alle Quellen: npm run cosmetic (prüfen mit -- --pruefen, signieren, hochladen).
//
//   npm run blender-import                          alle 23 Quellen (+ drei Mochi-Fellfarben als eigene Einträge)
//   npm run blender-import -- <ordner>              anderer Ordner als %USERPROFILE%\Desktop\Blender-Cosmatics\output
//   npm run blender-import -- --nur ember,wisp      nur diese IDs
//   npm run blender-import -- --pruefen             nur umwandeln und prüfen, nichts schreiben
//
// Der Blender-Ordner ist nur Quelle: Das Skript liest dort, schreibt nichts und führt nichts aus (archive/ bleibt außen vor).
//
// Umrechnung (Format 2 siehe core/cosmetics-format.ts und docs/dienst.md, „Cosmetics-Format 2“):
// - Koordinaten bleiben (Body-Modellraum in Pixeln: Ursprung Hals-Pivot, +X links, +Y unten, +Z hinten). Begleiter:
//   alles relativ zu attach.origin (Quelle attach.originPx, auf 1/32 Pixel gerundet).
// - Positionen ×32 (Int16), Normalen ×127 (Int8), UVs ×65535 (Uint16), Dreiecke Uint16.
// - Knochen je Vertex aus joints/weights: Gewicht 1 → starr (mesh.bones). Gemischte Gewichte (Membranen) werden als
//   weiche Haut übernommen (mesh.joints/weights, ÷255), wenn starr gerechnet mehr als 0,02 px fehlen würde.
// - Keyframes je Knochen und Kanal ausgedünnt (Ramer-Douglas-Peucker über die Frames): so lange Keys dazu, bis jeder
//   Frame höchstens um die Fehlergrenze abweicht (Drehung 0,15°, move 0,02 px je Achse, scale 0,002), gerechnet mit
//   den quantisierten Werten und genau der Auswertung des Formats (slerp bzw. linear, nach dem letzten Key halten).
//   Kanäle ohne Bewegung fallen weg. Bei Schleifen bleibt der letzte Frame immer ein Key.
// - Danach Gegenprobe: alle Vertices in allen Frames aller Animationen einmal aus der Quelle und einmal aus dem
//   Ergebnis verformt; die größte Abweichung steht im Prüfbericht.
// - Zustände 1:1 (sleep_in_bed → sleep, blend_seconds → blendSeconds), Partikel 1:1 (head → pivot, Farben als #rrggbb,
//   .L-Knochen gelten auch für .R → zwei Einträge, perSecond höchstens 20).
// - Passt ein Manifest nicht unter 512 KB, werden die Fehlergrenzen dieses Cosmetics schrittweise angehoben (×1,5, ×2,
//   ×3); der Prüfbericht nennt den Faktor.
// - Prüfung zum Schluss mit dem gemeinsamen Prüfer (dist/main/core/cosmetics-format.js, daher vorher npm run build).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng, writePng } from './png-rgba.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const COSMETICS = path.join(ROOT, 'cosmetics');
const FORMAT_JS = path.join(HERE, '..', 'dist', 'main', 'core', 'cosmetics-format.js');
const DEFAULT_SOURCE = path.join(os.homedir(), 'Desktop', 'Blender-Cosmatics', 'output');

/** Einheiten der Ganzzahlen (wie COSMETIC_LIMITS_2) */
const UNIT = { pos: 32, normal: 127, uv: 65535, rot: 32767, scale: 1000, weight: 255 };
/** Fehlergrenzen beim Ausdünnen: Grad, Pixel je Achse, Faktor */
const TOLERANCE = { rot: 0.15, move: 0.02, scale: 0.002 };
/** Starr statt weicher Haut, wenn die Abweichung höchstens so groß ist (Pixel) */
const RIGID_TOLERANCE = 0.02;
const FACTORS = [1, 1.5, 2, 3];
const PER_SECOND_MAX = 20;
const PER_SECOND_MIN = 0.1;
const STATE_KEYS = { sleep_in_bed: 'sleep', blend_seconds: 'blendSeconds' };
const IGNORED_STATE_KEYS = ['notes'];

// ---------------------------------------------------------------------------------------------
// Die 26 Einträge (23 Quellen, Mochi in vier Fellfarben)
// ---------------------------------------------------------------------------------------------

const MOCHI = 'Sitzt als Chibi-Katze auf der linken Schulter: schaut sich um, zuckt mit den Ohren, putzt sich und miaut. Halsband mit Goldglöckchen, Fragezeichen-Schwanz; Emote: winken, miauen, schnurren und kneten.';

const LIST = [
  // Flügel (back)
  { dir: 'SeraphWings', id: 'seraphfluegel', slot: 'back', name: 'Seraphflügel', description: 'Zwei Paar Pixel-Federflügel in X-Form mit goldener Kante und glühenden Goldspitzen. Die Federgruppen fächern einzeln auf, die Paare schlagen versetzt; im Emote öffnen sich beide Paare weit und die Federn fächern als Welle auf.' },
  { dir: 'DemonWings', id: 'daemonenfluegel', slot: 'back', name: 'Dämonenflügel', description: 'Obsidian-Knochen mit Glutrissen, eine Membran mit zerfetzter Kante und glühenden Brandlöchern, dazu Horn, Stacheln und Krallen. Die Finger krümmen sich, die Membran dehnt sich mit; im Emote reißen die Flügel auf und krallen sich zitternd zusammen.' },
  { dir: 'ButterflyWings', id: 'morphofluegel', slot: 'back', name: 'Morphofalter-Flügel', description: 'Blaue Pixel-Flügel eines Morphofalters mit schwarzem Rand, Leuchtpunkten und Augenflecken. Die Flügelspitzen schwingen nach, beim Schleichen klappen sie zusammen; im Emote wechseln schnelles Flattern und weites, langsames Öffnen.' },
  { dir: 'MechWings', id: 'mechfluegel', slot: 'back', name: 'Aegis-Mechflügel', description: 'Rucksack mit Kern-Fenster, Stahlarme und sieben Pixel-Klingen mit Amber-Linie. Der Turbinen-Lüfter dreht sich, die Düsenflammen flackern, Energie fließt die Klingen entlang; im Emote klappen die Klingen als Welle auf und zu.' },
  { dir: 'FlameWings', id: 'lohenfluegel', slot: 'back', name: 'Lohenflügel', description: 'Sechs lodernde Pixel-Flammen je Seite mit gespaltenen Zungen, Glutkern und Funken. Jede Flammenspitze flackert und peitscht für sich, Helligkeitswellen laufen nach oben; im Emote schlagen die Flammen zweimal weit aus.' },
  { dir: 'CrystalWings', id: 'amethystfaecher', slot: 'back', name: 'Amethyst-Fächer', description: 'Ein Fächer aus Amethyst-Kristallen schwebt frei um einen leuchtenden Kern-Würfel. Der Kern dreht sich, vier Splitter kreisen um ihn, die Kanten funkeln; im Emote pulsieren die Kristalle nacheinander.' },
  { dir: 'AbyssTendrils', id: 'abgrund-tentakel', slot: 'back', name: 'Abgrund-Tentakel', description: 'Fünf Tentakel je Seite aus Quader-Ketten mit Dornen, giftgrünen Adern und leuchtenden Augen. Sechs Glieder je Tentakel für weiche Wellen, Leuchtpulse wandern bis in die Spitzen; im Emote peitschen die Tentakel in großen Wellen.' },
  { dir: 'FernWings', id: 'farnwedel', slot: 'back', name: 'Farnwedel', description: 'Gebogener Farnwedel mit Pixel-Fiederblättchen, leuchtenden Sporen und eingerollter Spitze. Er wiegt sich in sechs Gliedern, Sporen funkeln und schweben davon; im Emote rollt er sich ein und entfaltet sich wieder.' },
  // Begleiter (companion)
  { dir: 'companions/Ember', id: 'ember', slot: 'companion', name: 'Ember, der Mini-Drache', description: 'Chibi-Drache mit Hörnern, beweglichem Kiefer, glühendem Lava-Bauch, Pixel-Flügeln und Schwanz aus drei Gliedern; schwebt neben der linken Schulter. Emote: Fassrolle mit Feueratem. Beim Herbeirufen dreht er sich aus einer Flammensäule hoch.' },
  { dir: 'companions/Wisp', id: 'wisp', slot: 'companion', name: 'Wisp, das Geisterlicht', description: 'Leuchtendes Geisterlicht mit Bäckchen, Flamme, Ärmchen und wehendem Schweif; ein Funke umkreist es auf eigener Bahn und tanzt dabei auf und ab. Emote: Pirouette mit Winken, der Funke kreist gegenläufig.' },
  { dir: 'companions/Bolt', id: 'bolt', slot: 'companion', name: 'Bolt, die Roboter-Drohne', description: 'Schwebende Drohne mit Bildschirm-Gesicht (normal, fröhlich, schläfrig), drehendem Rotor, blinkender Antenne, Seitendüsen und einem Greifarm, der winkt. Emote: Drehung mit Hüpfern, der Rotor läuft auf Vollgas.' },
  { dir: 'companions/Mochi', id: 'mochi', slot: 'companion', name: 'Mochi, die Schulterkatze', description: `${MOCHI} Fell: Ginger.` },
  { dir: 'companions/Mochi', id: 'mochi-tuxedo', fur: 'tuxedo', slot: 'companion', name: 'Mochi (Tuxedo)', description: `${MOCHI} Fell: Tuxedo (schwarz-weiß, gelbe Augen).` },
  { dir: 'companions/Mochi', id: 'mochi-silber', fur: 'silver', slot: 'companion', name: 'Mochi (Silber)', description: `${MOCHI} Fell: Silber (blaugrau, bernsteinfarbene Augen).` },
  { dir: 'companions/Mochi', id: 'mochi-schnee', fur: 'snow', slot: 'companion', name: 'Mochi (Schnee)', description: `${MOCHI} Fell: Schnee (cremeweiß, blaue Augen).` },
  { dir: 'companions/Jelly', id: 'jelly', slot: 'companion', name: 'Jelly, die Qualle', description: 'Qualle mit pulsierendem Schirm, kleinem Gesicht, Leuchtpunkten, sechs langen Tentakeln und zwei gekräuselten Mundarmen. Emote: Drehung mit kräftigen Pulsschlägen. Beim Herbeirufen steigt sie auf und entfaltet sich sternförmig.' },
  { dir: 'companions/Orbit', id: 'orbit', slot: 'companion', name: 'Orbit, der Mini-Planet', description: 'Voxel-Planet mit Kontinenten, Polkappen, Wolken und schrägem Pixel-Ring; ein Mond und eine Mini-Rakete mit glühendem Antrieb kreisen auf eigenen Bahnen. Emote: Hüpfen und Wackeln, Mond und Rakete rasen im Kreis.' },
  { dir: 'companions/Pip', id: 'pip', slot: 'companion', name: 'Pip, das Phönix-Küken', description: 'Rundes Küken in Feuerfarben mit großen Augen, glühendem Flammen-Schopf, Flügelchen mit Glutspitzen und zweigliedrigem Flammenschweif. Emote: ein Looping mit Flammenspur, danach piept es dreimal.' },
  { dir: 'companions/Lumi', id: 'lumi', slot: 'companion', name: 'Lumi, der Laternengeist', description: 'Eiserne Laterne mit leuchtendem Glasgesicht und Flamme auf dem Deckel; sie pendelt am Henkel, zwei Glut-Händchen schweben daneben. Emote: Laternentanz mit Winken. Im Schlaf zieht sich die Flamme in den Deckel zurück.' },
  { dir: 'companions/Sprout', id: 'sprout', slot: 'companion', name: 'Sprout, die Samenkapsel', description: 'Grüne Samenkapsel mit Gesicht und Eichel-Kappe; zwei Blätter drehen sich wie ein Rotor, dazu eine Blütenknospe und drei Wurzel-Ranken. Emote: Der Rotor läuft aus und die Knospe erblüht.' },
  // Auren (aura)
  { dir: 'auras/ArcaneSigil', id: 'runenkreis', slot: 'aura', name: 'Runenkreis', description: 'Leuchtender Zauberkreis am Boden aus zwei gegenläufig drehenden Ringen mit Runen, dazu vier schwebende Runentafeln und aufsteigende Funken. Emote: Die Tafeln steigen spiralförmig auf Kopfhöhe und schlagen dann auf den Kreis.' },
  { dir: 'auras/InfernoRing', id: 'flammenkreis', slot: 'aura', name: 'Flammenkreis', description: 'Verbrannter Boden-Ring mit glühenden Rissen und zehn Pixel-Flammen, die einzeln flackern; Glutfunken steigen spiralförmig auf und verlöschen. Emote: Eine Flammenwelle läuft zweimal um den Kreis.' },
  { dir: 'auras/FrostCrown', id: 'eiskranz', slot: 'aura', name: 'Eiskranz', description: 'Sechs Eiskristalle kreisen auf schräger Bahn um die Brust, Pixel-Schneeflocken rieseln, ein Frost-Ring mit acht Eiszacken wächst am Boden. Emote: Die Kristalle steigen über den Kopf und kreisen dort als Krone.' },
  { dir: 'auras/VoidHelix', id: 'leere-spirale', slot: 'aura', name: 'Leere-Spirale', description: 'Doppelhelix aus zwölf dunklen Kugeln mit magentafarbenem Kern, die sich um den Spieler nach oben schraubt, ein wirbelndes Portal am Boden und drei Splitter über dem Kopf. Emote: Die Helix rast und dehnt sich aus.' },
  { dir: 'auras/BlossomStorm', id: 'bluetensturm', slot: 'aura', name: 'Blütensturm', description: 'Vierzehn Blütenblätter wirbeln trudelnd nach oben, am Boden wiegt sich ein Graskranz mit zehn Blumen, die nacheinander aufblühen. Emote: Die Blätter platzen nach außen, die Blumen blühen riesig auf.' },
  { dir: 'auras/StormCloud', id: 'gewitterwolke', slot: 'aura', name: 'Gewitterwolke', description: 'Voxel-Wolke über dem Kopf, Regen fällt im Kreis um den Spieler, drei Pixel-Blitze zucken nacheinander und die Pfütze am Boden leuchtet bei jedem Blitz auf. Emote: Die Wolke wächst, dazu Blitzgewitter und Platzregen.' },
];

// ---------------------------------------------------------------------------------------------
// Mathe: Quaternionen (x, y, z, w), 4×4-Matrizen spaltenweise (wie JOML/WebGL)
// ---------------------------------------------------------------------------------------------

const ID = [0, 0, 0, 1];

function qnorm(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Drehwinkel zwischen zwei Quaternionen in Grad (q und −q sind dieselbe Drehung), numerisch stabil */
function qangle(a, b) {
  a = qnorm(a);
  b = qnorm(b);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const diff = Math.hypot(a[0] - s * b[0], a[1] - s * b[1], a[2] - s * b[2], a[3] - s * b[3]);
  const sum = Math.hypot(a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]);
  return (4 * Math.atan2(diff, sum) * 180) / Math.PI;
}

/** slerp auf dem kürzeren Weg (wie JOML und three.js), Ergebnis normiert */
function slerp(a, b, t) {
  a = qnorm(a);
  b = qnorm(b);
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (dot < 0) {
    b = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) return qnorm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
}

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function mul(a, b) {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      r[c * 4 + row] = a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] + a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
    }
  }
  return r;
}

/** T(move) · T(pivot) · R(q) · S(s) · T(−pivot) */
function local(move, pivot, q, s) {
  const [x, y, z, w] = qnorm(q);
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  const m = new Float64Array(16);
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) m[c * 4 + row] = r[c * 3 + row] * s;
  // Verschiebung: move + pivot − R·S·pivot
  for (let row = 0; row < 3; row++) {
    m[12 + row] = move[row] + pivot[row] - (m[row] * pivot[0] + m[4 + row] * pivot[1] + m[8 + row] * pivot[2]);
  }
  m[15] = 1;
  return m;
}

function apply(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** Welt-Matrizen aller Knochen; pose(b) → { move, rot, scale } */
function worldMatrices(bones, pose) {
  const world = [];
  bones.forEach((bone, b) => {
    const p = pose(b);
    const l = local(p.move, bone.pivot, p.rot, p.scale);
    world[b] = bone.parent < 0 ? l : mul(world[bone.parent], l);
  });
  return world;
}

// ---------------------------------------------------------------------------------------------
// Ganzzahlen und Base64 (little-endian, wie das Format)
// ---------------------------------------------------------------------------------------------

function int16(values, what) {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => {
    if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new Error(`${what}: ${v} passt nicht in Int16`);
    out.writeInt16LE(v, i * 2);
  });
  return out.toString('base64');
}

function uint16(values, what) {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error(`${what}: ${v} passt nicht in Uint16`);
    out.writeUInt16LE(v, i * 2);
  });
  return out.toString('base64');
}

function uint8(values, what) {
  for (const v of values) if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`${what}: ${v} passt nicht in Uint8`);
  return Buffer.from(values).toString('base64');
}

function int8(values, what) {
  const out = Buffer.alloc(values.length);
  values.forEach((v, i) => {
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`${what}: ${v} passt nicht in Int8`);
    out.writeInt8(v, i);
  });
  return out.toString('base64');
}

// ---------------------------------------------------------------------------------------------
// Keyframes ausdünnen
// ---------------------------------------------------------------------------------------------

const CHANNELS = {
  rot: {
    identity: ID,
    quantize: (q) => qnorm(q).map((v) => Math.round(v * UNIT.rot)),
    dequantize: (q) => qnorm(q.map((v) => v / UNIT.rot)),
    interpolate: slerp,
    error: qangle,
  },
  move: {
    identity: [0, 0, 0],
    quantize: (m) => m.map((v) => Math.round(v * UNIT.pos)),
    dequantize: (m) => m.map((v) => v / UNIT.pos),
    interpolate: lerp,
    error: (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])),
  },
  scale: {
    identity: [1],
    quantize: (s) => [Math.round(s[0] * UNIT.scale)],
    dequantize: (s) => [s[0] / UNIT.scale],
    interpolate: lerp,
    error: (a, b) => Math.abs(a[0] - b[0]),
  },
};

/** Wert einer Spur zur (ganzen oder gebrochenen) Frame-Zeit f wie im Format: zwischen Keys interpolieren, danach halten */
function sampleKeys(channel, keys, values, f) {
  if (f <= keys[0]) return values[0];
  for (let i = 0; i < keys.length - 1; i++) {
    if (f < keys[i + 1]) return channel.interpolate(values[i], values[i + 1], (f - keys[i]) / (keys[i + 1] - keys[i]));
  }
  return values[values.length - 1];
}

/**
 * Keys für einen Kanal: original[f] (Float-Werte je Frame). Liefert null (Kanal ohne Bewegung) oder
 * { keys, ints (quantisiert je Key), values (dequantisiert je Key), error (größter Fehler über alle Frames) }.
 */
function thin(kind, original, loop, tolerance) {
  const channel = CHANNELS[kind];
  const frames = original.length;
  if (original.every((v) => channel.error(channel.identity, v) <= tolerance)) return null;
  const ints = original.map(channel.quantize);
  const exact = ints.map(channel.dequantize);
  const keys = [0];
  const errors = () => original.map((v, f) => channel.error(sampleKeys(channel, keys, keys.map((k) => exact[k]), f), v));
  let worst = errors();
  let forcedEnd = false;
  for (;;) {
    let at = 0;
    for (let f = 1; f < frames; f++) if (worst[f] > worst[at]) at = f;
    if (worst[at] <= tolerance) break;
    // Bei Schleifen: letzter Frame immer Key (siehe Kopf), sobald sich überhaupt etwas bewegt
    if (loop && !forcedEnd && !keys.includes(frames - 1)) {
      forcedEnd = true;
      at = frames - 1;
    }
    if (keys.includes(at)) throw new Error(`${kind}: Fehler ${worst[at]} bei Frame ${at} lässt sich mit Keys nicht unter ${tolerance} bringen`);
    keys.push(at);
    keys.sort((a, b) => a - b);
    worst = errors();
  }
  if (loop && keys.length > 1 && !keys.includes(frames - 1)) {
    keys.push(frames - 1);
    keys.sort((a, b) => a - b);
    worst = errors();
  }
  return { keys, ints: keys.map((k) => ints[k]), values: keys.map((k) => exact[k]), error: Math.max(...worst) };
}

// ---------------------------------------------------------------------------------------------
// Umwandeln
// ---------------------------------------------------------------------------------------------

const kb = (bytes) => `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
const fix = (n, digits = 3) => n.toFixed(digits).replace('.', ',');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const hex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('')}`;
const round = (n, digits = 5) => Math.round(n * 10 ** digits) / 10 ** digits + 0;

/** Leucht-Streifen einer Fellfarbe: Pixel, deren statisches Leuchten anders ist (Augen), in jedem Bild umgefärbt */
function furGlow(baseStatic, furStatic, strip) {
  const out = { width: strip.width, height: strip.height, data: Buffer.from(strip.data) };
  const frames = strip.height / baseStatic.height;
  let changed = 0;
  for (let i = 0; i < baseStatic.data.length; i += 4) {
    const base = baseStatic.data.subarray(i, i + 4);
    const fur = furStatic.data.subarray(i, i + 4);
    if (base.every((v, k) => v === fur[k])) continue;
    changed++;
    const baseLight = base[0] + base[1] + base[2];
    for (let f = 0; f < frames; f++) {
      const j = f * baseStatic.data.length + i;
      const light = out.data[j] + out.data[j + 1] + out.data[j + 2];
      const factor = baseLight > 0 ? light / baseLight : 0;
      for (let k = 0; k < 3; k++) out.data[j + k] = Math.min(255, Math.round(fur[k] * factor));
    }
  }
  return { png: writePng(out), changed };
}

async function readSource(sourceRoot, entry) {
  const dir = path.join(sourceRoot, entry.dir);
  const base = path.basename(entry.dir);
  const files = {
    json: path.join(dir, `${base}.cosmetic.json`),
    albedo: path.join(dir, 'textures', entry.fur ? `${base}_${entry.fur}_albedo.png` : `${base}_albedo.png`),
    glow: path.join(dir, 'textures', `${base}_emissive_anim.png`),
  };
  for (const file of Object.values(files)) if (!existsSync(file)) throw new Error(`${entry.id}: Quelle fehlt: ${file}`);
  const bytes = {
    json: await readFile(files.json),
    albedo: await readFile(files.albedo),
    glow: await readFile(files.glow),
  };
  const src = JSON.parse(bytes.json.toString('utf8'));
  if (src.format !== 'heldix-cosmetic/1') throw new Error(`${entry.id}: unbekanntes Quellformat ${src.format}`);
  let glow = bytes.glow;
  let furChanged = 0;
  if (entry.fur) {
    const baseStatic = readPng(await readFile(path.join(dir, 'textures', `${base}_emissive.png`)));
    const furStatic = readPng(await readFile(path.join(dir, 'textures', `${base}_${entry.fur}_emissive.png`)));
    const result = furGlow(baseStatic, furStatic, readPng(bytes.glow));
    glow = result.png;
    furChanged = result.changed;
  }
  return { root: sourceRoot, src, files, bytes, glow, furChanged };
}

/** Pose eines Knochens aus der Quelle zu Frame f */
function sourcePose(anim, name, f) {
  const r = anim.rotations_xyzw?.[name];
  const t = anim.translations_xyz?.[name];
  const s = anim.scales?.[name];
  return {
    rot: r ? [r[f * 4], r[f * 4 + 1], r[f * 4 + 2], r[f * 4 + 3]] : ID,
    move: t ? [t[f * 3], t[f * 3 + 1], t[f * 3 + 2]] : [0, 0, 0],
    scale: s ? s[f] : 1,
  };
}

function convert(entry, source, factor) {
  const { src } = source;
  const tol = { rot: TOLERANCE.rot * factor, move: TOLERANCE.move * factor, scale: TOLERANCE.scale * factor };
  if (src.type && src.type !== entry.slot) throw new Error(`${entry.id}: Die Quelle ist „${src.type}“, erwartet ${entry.slot}`);
  const N = src.vertexCount;
  const T = src.indices.length / 3;
  for (const [key, per] of [['positions', 3], ['normals', 3], ['uvs', 2], ['joints', 4], ['weights', 4]]) {
    if (src[key].length !== N * per) throw new Error(`${entry.id}: ${key} hat ${src[key].length} Werte statt ${N * per}`);
  }

  // Ursprung (nur Begleiter), auf 1/32 Pixel
  const origin = entry.slot === 'companion' ? src.attach.originPx.map((v) => Math.round(v * UNIT.pos) / UNIT.pos) : [0, 0, 0];

  // Knochen
  const boneIndex = new Map(src.bones.map((b, i) => [b.name, i]));
  const bones = src.bones.map((b, i) => {
    if (!(b.parent < i)) throw new Error(`${entry.id}: Knochen ${b.name} steht vor seinem Eltern-Knochen`);
    return { name: b.name, parent: b.parent, pivot: b.pivot.map((v, k) => round(v - origin[k])), tail: b.tail.map((v, k) => round(v - origin[k])) };
  });
  const absBones = src.bones.map((b) => ({ parent: b.parent, pivot: b.pivot }));

  // Mesh
  let posError = 0;
  const positions = src.positions.map((v, i) => {
    const rel = v - origin[i % 3];
    const q = Math.round(rel * UNIT.pos);
    posError = Math.max(posError, Math.abs(q / UNIT.pos - rel));
    return q;
  });
  const normals = src.normals.map((v) => Math.max(-127, Math.min(127, Math.round(v * UNIT.normal))));
  let uvClamp = 0;
  const uvs = src.uvs.map((v) => {
    if (v < -1e-6 || v > 1 + 1e-6) uvClamp++;
    return Math.round(Math.max(0, Math.min(1, v)) * UNIT.uv);
  });
  if (uvClamp) throw new Error(`${entry.id}: ${uvClamp} UV-Werte liegen außerhalb von 0–1`);
  for (const index of src.indices) if (index >= N) throw new Error(`${entry.id}: Dreieck nennt Vertex ${index} von ${N}`);

  // Knochen je Vertex: starr oder weiche Haut
  const influences = [];
  let soft = 0;
  for (let v = 0; v < N; v++) {
    const list = [];
    for (let k = 0; k < 4; k++) {
      const w = src.weights[v * 4 + k];
      if (w > 1e-6) list.push({ joint: src.joints[v * 4 + k], w });
    }
    if (!list.length) throw new Error(`${entry.id}: Vertex ${v} hat keinen Knochen`);
    list.sort((a, b) => b.w - a.w);
    const sum = list.reduce((s, x) => s + x.w, 0);
    for (const x of list) x.w /= sum;
    if (list.length > 1 && list[1].w > 1e-6) soft++;
    influences.push(list);
  }
  // Abweichung starr gegen weich (in der Quelle selbst), über alle Frames aller Animationen
  let rigidDeviation = 0;
  if (soft) {
    for (const anim of Object.values(src.animations)) {
      for (let f = 0; f < anim.frames; f++) {
        const world = worldMatrices(absBones, (b) => sourcePose(anim, src.bones[b].name, f));
        for (let v = 0; v < N; v++) {
          const list = influences[v];
          if (list.length < 2) continue;
          const [x, y, z] = [src.positions[v * 3], src.positions[v * 3 + 1], src.positions[v * 3 + 2]];
          const acc = [0, 0, 0];
          for (const { joint, w } of list) {
            const p = apply(world[joint], x, y, z);
            acc[0] += w * p[0];
            acc[1] += w * p[1];
            acc[2] += w * p[2];
          }
          const r = apply(world[list[0].joint], x, y, z);
          rigidDeviation = Math.max(rigidDeviation, Math.hypot(r[0] - acc[0], r[1] - acc[1], r[2] - acc[2]));
        }
      }
    }
  }
  const useSkin = soft > 0 && rigidDeviation > RIGID_TOLERANCE;
  const vertexBones = [];
  const joints = [];
  const weights = [];
  for (let v = 0; v < N; v++) {
    const list = influences[v].slice(0, 4);
    // Gewichte auf ganze 255stel, Summe genau 255 (größte Reste zuerst)
    const raw = list.map((x) => x.w * UNIT.weight);
    const ints = raw.map(Math.floor);
    let rest = UNIT.weight - ints.reduce((s, x) => s + x, 0);
    const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
    for (let i = 0; rest > 0; i = (i + 1) % order.length, rest--) ints[order[i][1]]++;
    let main = 0;
    for (let i = 1; i < ints.length; i++) if (ints[i] > ints[main]) main = i;
    vertexBones.push(useSkin ? list[main].joint : list[0].joint);
    for (let k = 0; k < 4; k++) {
      joints.push(k < list.length ? list[k].joint : 0);
      weights.push(k < list.length ? ints[k] : 0);
    }
  }
  const mesh = {
    vertexCount: N,
    triangleCount: T,
    positions: int16(positions, `${entry.id}: Position`),
    normals: int8(normals, `${entry.id}: Normale`),
    uvs: uint16(uvs, `${entry.id}: UV`),
    bones: uint8(vertexBones, `${entry.id}: Knochen`),
    triangles: uint16(src.indices, `${entry.id}: Dreieck`),
  };
  if (useSkin) {
    mesh.joints = uint8(joints, `${entry.id}: joints`);
    mesh.weights = uint8(weights, `${entry.id}: weights`);
  }

  // Animationen
  const animations = {};
  const animReport = [];
  const maxError = { rot: 0, move: 0, scale: 0 };
  let sourceValues = 0;
  let keyCount = 0;
  for (const [name, anim] of Object.entries(src.animations)) {
    const tracks = [];
    let animKeys = 0;
    for (let b = 0; b < src.bones.length; b++) {
      const boneName = src.bones[b].name;
      const series = { rot: null, move: null, scale: null };
      const r = anim.rotations_xyzw?.[boneName];
      const t = anim.translations_xyz?.[boneName];
      const s = anim.scales?.[boneName];
      if (r) series.rot = Array.from({ length: anim.frames }, (_, f) => [r[f * 4], r[f * 4 + 1], r[f * 4 + 2], r[f * 4 + 3]]);
      if (t) series.move = Array.from({ length: anim.frames }, (_, f) => [t[f * 3], t[f * 3 + 1], t[f * 3 + 2]]);
      if (s) series.scale = Array.from({ length: anim.frames }, (_, f) => [s[f]]);
      sourceValues += ((r ? 1 : 0) + (t ? 1 : 0) + (s ? 1 : 0)) * anim.frames;
      const track = { bone: b };
      for (const kind of ['rot', 'move', 'scale']) {
        if (!series[kind]) continue;
        const thinned = thin(kind, series[kind], anim.loop, tol[kind]);
        if (!thinned) {
          // ohne Bewegung: Fehler gegenüber der Ruhelage zählt mit
          maxError[kind] = Math.max(maxError[kind], ...series[kind].map((v) => CHANNELS[kind].error(CHANNELS[kind].identity, v)));
          continue;
        }
        maxError[kind] = Math.max(maxError[kind], thinned.error);
        const flat = thinned.ints.flat();
        track[kind] = {
          keys: uint16(thinned.keys, `${entry.id}: Keys`),
          values: kind === 'scale' ? uint16(flat, `${entry.id}: scale`) : int16(flat, `${entry.id}: ${kind}`),
        };
        animKeys += thinned.keys.length;
      }
      if (track.rot || track.move || track.scale) tracks.push(track);
    }
    keyCount += animKeys;
    animations[name] = { fps: anim.fps, frames: anim.frames, loop: anim.loop, tracks };
    animReport.push(`  ${name}: ${anim.frames} Frames bei ${anim.fps} fps${anim.loop ? ', Schleife' : ', einmalig'}, ${tracks.length} Spuren, ${animKeys} Keys`);
  }

  // Zustände
  const states = {};
  for (const [key, value] of Object.entries(src.stateMap)) {
    if (IGNORED_STATE_KEYS.includes(key)) continue;
    const target = STATE_KEYS[key] ?? key;
    if (target === 'blendSeconds') states.blendSeconds = value;
    else {
      if (!animations[value]) throw new Error(`${entry.id}: Zustand ${key} nennt die unbekannte Animation ${value}`);
      states[target] = value;
    }
  }

  // Partikel
  const particles = [];
  const particleNotes = [];
  for (const p of src.particles ?? []) {
    const names = [p.bone];
    if (p.bone.endsWith('.L') && boneIndex.has(`${p.bone.slice(0, -2)}.R`)) names.push(`${p.bone.slice(0, -2)}.R`);
    let perSecond = round(p.perSecond, 3);
    if (perSecond > PER_SECOND_MAX) {
      particleNotes.push(`${p.particle} an ${p.bone}: ${p.perSecond}/s → ${PER_SECOND_MAX}/s (Grenze)`);
      perSecond = PER_SECOND_MAX;
    }
    perSecond = Math.max(PER_SECOND_MIN, perSecond);
    for (const name of names) {
      if (!boneIndex.has(name)) throw new Error(`${entry.id}: Partikel am unbekannten Knochen ${name}`);
      const particle = { bone: boneIndex.get(name), at: p.at === 'head' ? 'pivot' : p.at, particle: p.particle.replace(/^minecraft:/, ''), perSecond };
      if (p.color) particle.color = hex(p.color);
      if (p.states) {
        for (const state of p.states) if (!animations[state]) throw new Error(`${entry.id}: Partikel nennt die unbekannte Animation ${state}`);
        particle.states = p.states;
      }
      particles.push(particle);
    }
  }

  const emissive = {
    frames: src.emissiveAnimation.frames,
    frametimeTicks: src.emissiveAnimation.frametimeTicks,
    pulse: { period: src.emissivePulse.periodSeconds, min: src.emissivePulse.min, max: src.emissivePulse.max },
  };

  const cosmetic = {
    format: 2,
    id: entry.id,
    version: 1,
    slot: entry.slot,
    name: entry.name,
    description: entry.description,
    access: 'all',
    emissive,
    bones,
    mesh,
    animations,
    states,
    particles,
  };
  if (entry.slot === 'companion') cosmetic.attach = { origin, side: 'left' };

  return {
    cosmetic,
    stats: {
      N, T, bones: bones.length, soft, useSkin, rigidDeviation, posError, keyCount, sourceValues, maxError,
      animations: Object.keys(animations).length, animReport, particles: particles.length, sourceParticles: (src.particles ?? []).length,
      particleNotes, states: Object.keys(states).filter((k) => k !== 'blendSeconds').length, origin, emissive, factor, tol,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Gegenprobe: das geprüfte Manifest mit den Dekodier-Hilfen des Formats auspacken, nach der Vorgabe auswerten und
// jeden Vertex in jedem Frame jeder Animation mit der Quelle vergleichen (unabhängig von der Umrechnung oben)
// ---------------------------------------------------------------------------------------------

/** Wert einer dekodierten Spur zu Frame f (Ganzzahlen → Einheiten), wie es Spiel und Vorschau rechnen */
function sampleDecoded(keys, values, per, unit, f, interpolate) {
  const at = (i) => Array.from(values.subarray(i * per, i * per + per), (v) => v / unit);
  if (f <= keys[0]) return at(0);
  for (let i = 0; i < keys.length - 1; i++) {
    if (f < keys[i + 1]) return interpolate(at(i), at(i + 1), (f - keys[i]) / (keys[i + 1] - keys[i]));
  }
  return at(keys.length - 1);
}

function crossCheck(src, checked, format) {
  const mesh = format.decodeCosmeticMesh(checked.mesh);
  const origin = checked.attach ? checked.attach.origin : [0, 0, 0];
  const absBones = src.bones.map((b) => ({ parent: b.parent, pivot: b.pivot }));
  const N = src.vertexCount;
  const influences = [];
  for (let v = 0; v < N; v++) {
    const list = [];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = src.weights[v * 4 + k];
      if (w > 1e-6) {
        list.push({ joint: src.joints[v * 4 + k], w });
        sum += w;
      }
    }
    for (const x of list) x.w /= sum;
    influences.push(list);
  }
  let worst = { dev: 0, anim: '', frame: 0, vertex: 0 };
  for (const [name, anim] of Object.entries(src.animations)) {
    const clip = checked.animations[name];
    if (!clip || clip.frames !== anim.frames || clip.fps !== anim.fps || clip.loop !== anim.loop) throw new Error(`Gegenprobe: Animation ${name} fehlt oder passt nicht`);
    const tracks = new Map(clip.tracks.map((t) => [t.bone, format.decodeCosmeticTrack(t)]));
    for (let f = 0; f < anim.frames; f++) {
      const ref = worldMatrices(absBones, (b) => sourcePose(anim, src.bones[b].name, f));
      const out = worldMatrices(checked.bones, (b) => {
        const t = tracks.get(b);
        return {
          rot: t?.rot ? sampleDecoded(t.rot.keys, t.rot.values, 4, UNIT.rot, f, slerp) : ID,
          move: t?.move ? sampleDecoded(t.move.keys, t.move.values, 3, UNIT.pos, f, lerp) : [0, 0, 0],
          scale: t?.scale ? sampleDecoded(t.scale.keys, t.scale.values, 1, UNIT.scale, f, lerp)[0] : 1,
        };
      });
      for (let v = 0; v < N; v++) {
        const [x, y, z] = [src.positions[v * 3], src.positions[v * 3 + 1], src.positions[v * 3 + 2]];
        const a = [0, 0, 0];
        for (const { joint, w } of influences[v]) {
          const p = apply(ref[joint], x, y, z);
          a[0] += w * p[0];
          a[1] += w * p[1];
          a[2] += w * p[2];
        }
        const [qx, qy, qz] = [mesh.positions[v * 3] / UNIT.pos, mesh.positions[v * 3 + 1] / UNIT.pos, mesh.positions[v * 3 + 2] / UNIT.pos];
        let b = [0, 0, 0];
        if (mesh.joints) {
          for (let k = 0; k < 4; k++) {
            const w = mesh.weights[v * 4 + k] / UNIT.weight;
            if (!w) continue;
            const p = apply(out[mesh.joints[v * 4 + k]], qx, qy, qz);
            b[0] += w * p[0];
            b[1] += w * p[1];
            b[2] += w * p[2];
          }
        } else {
          b = apply(out[mesh.bones[v]], qx, qy, qz);
        }
        const dev = Math.hypot(b[0] + origin[0] - a[0], b[1] + origin[1] - a[1], b[2] + origin[2] - a[2]);
        if (dev > worst.dev) worst = { dev, anim: name, frame: f, vertex: v };
      }
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------------------------

/** JSON mit Einrückung, Zahlenlisten (pivot, tail, origin) aber in einer Zeile */
function pretty(value) {
  return JSON.stringify(value, null, 2).replace(/\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g, (_, list) => `[${list.split(/,\s+/).join(', ')}]`);
}

function pngInfo(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

const isPow2 = (v) => v >= 16 && v <= 512 && (v & (v - 1)) === 0;

function manifestText(cosmetic, texture, glow) {
  // wie scripts/cosmetic-sources.ts (ORDER_2), mit einem Datum in voller Länge
  const full = { ...cosmetic, type: 'heldix-cosmetic', date: new Date().toISOString(), texture: `data:image/png;base64,${texture.toString('base64')}`, glow: `data:image/png;base64,${glow.toString('base64')}` };
  const order = ['type', 'format', 'id', 'version', 'slot', 'name', 'description', 'access', 'date', 'texture', 'glow', 'emissive', 'bones', 'mesh', 'animations', 'states', 'particles', 'attach'];
  const ordered = {};
  for (const key of order) if (full[key] !== undefined) ordered[key] = full[key];
  return JSON.stringify(ordered);
}

function reportText(entry, source, result, texture, glow, manifestBytes, envelopeBytes, limits) {
  const s = result.stats;
  const rel = (file) => path.relative(source.root, file).replaceAll('\\', '/');
  const tex = pngInfo(texture);
  const gl = pngInfo(glow);
  const lines = [
    `Prüfbericht: ${entry.name} (${entry.id}), Slot ${entry.slot}, Cosmetics-Format 2`,
    `Erzeugt von launcher/scripts/import-blender-cosmetics.mjs (npm run blender-import) aus dem Blender-Export „heldix-cosmetic/1“.`,
    '',
    'Quelle (Blender-Cosmatics/output, nur gelesen):',
    `  ${rel(source.files.json)}  ${kb(source.bytes.json.length)}  sha256 ${sha(source.bytes.json)}`,
    `  ${rel(source.files.albedo)}  ${kb(source.bytes.albedo.length)}  sha256 ${sha(source.bytes.albedo)}`,
    `  ${rel(source.files.glow)}  ${kb(source.bytes.glow.length)}  sha256 ${sha(source.bytes.glow)}`,
    '',
    'Größe:',
    `  vorher: ${kb(source.bytes.json.length + source.bytes.albedo.length + source.bytes.glow.length)} (JSON ${kb(source.bytes.json.length)} + Texturen)`,
    `  nachher: Manifest ${kb(manifestBytes)} von höchstens ${kb(limits.manifestBytes)}, Umschlag etwa ${kb(envelopeBytes)} von ${kb(limits.envelopeBytes)}`,
    '',
    'Mesh:',
    `  ${s.N} Vertices, ${s.T} Dreiecke, ${s.bones} Knochen, größte Rundung der Positionen ${fix(s.posError, 4)} px`,
    s.soft
      ? `  ${s.soft} Vertices mit mehreren Knochen (Membran); starr gerechnet bis ${fix(s.rigidDeviation)} px Abweichung → ${s.useSkin ? 'weiche Haut (mesh.joints/weights)' : 'starr (unter 0,02 px)'}`
      : '  starr: alle Vertices mit Gewicht 1 an genau einem Knochen',
    s.origin.some((v) => v !== 0) ? `  Begleiter: Ursprung attach.origin = [${s.origin.join(', ')}] px (Positionen relativ dazu), Seite links` : null,
    '',
    `Animationen (${s.animations}), Fehlergrenzen ${s.factor === 1 ? 'wie vorgegeben' : `×${String(s.factor).replace('.', ',')} angehoben (Manifest sonst über 512 KB)`}: Drehung ${fix(s.tol.rot, 3)}°, move ${fix(s.tol.move, 3)} px je Achse, scale ${fix(s.tol.scale, 4)}`,
    ...s.animReport,
    `  zusammen ${s.keyCount} Keys statt ${s.sourceValues} Frames (die Quelle hat je Knochen und Kanal einen Wert je Frame)`,
    `  größter Fehler je Frame: Drehung ${fix(s.maxError.rot, 4)}°, move ${fix(s.maxError.move, 4)} px, scale ${fix(s.maxError.scale, 4)}`,
    `  Gegenprobe (alle Vertices, alle Frames, Quelle gegen Ergebnis): größte Abweichung ${fix(s.worst.dev, 4)} px (${s.worst.anim}, Frame ${s.worst.frame}, Vertex ${s.worst.vertex})`,
    '',
    `Zustände: ${s.states} Zustände 1:1 (sleep_in_bed → sleep), Überblenden ${String(result.cosmetic.states.blendSeconds).replace('.', ',')} s`,
    `Partikel: ${s.sourceParticles} Vorschläge → ${s.particles} Einträge (.L-Knochen auch für .R)`,
    ...s.particleNotes.map((n) => `  gekürzt: ${n}`),
    `Leuchten: ${s.emissive.frames} Bilder, ${s.emissive.frametimeTicks} Ticks je Bild, Puls ${String(s.emissive.pulse.period).replace('.', ',')} s zwischen ${String(s.emissive.pulse.min).replace('.', ',')} und ${String(s.emissive.pulse.max).replace('.', ',')}`,
    `Texturen: texture.png ${tex.width} × ${tex.height} (${kb(tex.bytes)}) = ${path.basename(source.files.albedo)}; glow.png ${gl.width} × ${gl.height} (${kb(gl.bytes)}) = ${path.basename(source.files.glow)}${source.furChanged ? ` mit ${source.furChanged} umgefärbten Leuchtpixeln (Augen der Fellfarbe, aus ${path.basename(source.files.albedo).replace('_albedo', '_emissive')})` : ''}`,
  ];
  return `${lines.filter((l) => l !== null).join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--pruefen');
  const onlyIndex = args.indexOf('--nur');
  const only = onlyIndex >= 0 ? (args[onlyIndex + 1] ?? '').split(',').filter(Boolean) : null;
  const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--pruefen' && a !== '--nur' && i !== onlyIndex + 1);
  if (unknown.length) throw new Error(`Unbekannte Option ${unknown.join(', ')}. Aufruf: npm run blender-import -- [<ordner>] [--nur id,id] [--pruefen]`);
  const positional = args.filter((a, i) => !a.startsWith('--') && i !== onlyIndex + 1);
  const sourceRoot = path.resolve(positional[0] ?? DEFAULT_SOURCE);
  if (!existsSync(sourceRoot)) throw new Error(`Kein Blender-Ordner ${sourceRoot} (Aufruf: npm run blender-import -- <ordner>)`);
  if (!existsSync(FORMAT_JS)) throw new Error('Der Prüfer fehlt (dist/main/core/cosmetics-format.js) – erst "npm run build" im Ordner launcher.');
  const format = require(FORMAT_JS);
  const entries = only ? LIST.filter((e) => only.includes(e.id)) : LIST;
  if (only && entries.length !== only.length) throw new Error(`Unbekannte ID in --nur (bekannt: ${LIST.map((e) => e.id).join(', ')})`);

  const summary = [];
  for (const entry of entries) {
    const started = Date.now();
    const source = await readSource(sourceRoot, entry);
    const texture = source.bytes.albedo;
    const glow = source.glow;
    const tex = pngInfo(texture);
    const gl = pngInfo(glow);
    const frames = source.src.emissiveAnimation.frames;
    if (!isPow2(tex.width) || !isPow2(tex.height)) throw new Error(`${entry.id}: Albedo ${tex.width} × ${tex.height} ist keine Zweierpotenz von 16 bis 512`);
    if (gl.width !== tex.width || gl.height !== tex.height * frames) throw new Error(`${entry.id}: Leucht-Streifen ${gl.width} × ${gl.height} passt nicht zu ${tex.width} × ${tex.height} × ${frames} Bilder`);
    for (const [label, info] of [['texture.png', tex], ['glow.png', gl]]) {
      if (info.bytes > format.COSMETIC_LIMITS_2.pngBytes) throw new Error(`${entry.id}: ${label} ist ${kb(info.bytes)} groß (höchstens 64 KB)`);
    }

    let result = null;
    let text = '';
    for (const factor of FACTORS) {
      result = convert(entry, source, factor);
      text = manifestText(result.cosmetic, texture, glow);
      if (format.utf8Length(text) <= format.COSMETIC_LIMITS_2.manifestBytes && format.cosmeticEnvelopeLength(text) <= format.COSMETIC_LIMITS_2.envelopeBytes) break;
      console.log(`${entry.id}: ${kb(format.utf8Length(text))} bei Fehlergrenze ×${factor} – zu groß, nächster Versuch`);
      result = null;
    }
    if (!result) throw new Error(`${entry.id}: Auch mit ×${FACTORS[FACTORS.length - 1]} größer als 512 KB`);
    // gemeinsamer Prüfer: alle Regeln von Format 2
    const checked = format.parseCosmeticManifest(text);
    if (typeof checked === 'string') throw new Error(`${entry.id}: Prüfer lehnt ab: ${checked}`);
    result.stats.worst = crossCheck(source.src, checked, format);
    // Grenze der Gegenprobe: Rundung der Positionen plus Fehler der Keys, über die Knochenketten aufsummiert
    if (result.stats.worst.dev > 0.25 * result.stats.factor) {
      throw new Error(`${entry.id}: Gegenprobe weicht um ${fix(result.stats.worst.dev)} px ab (${result.stats.worst.anim}, Frame ${result.stats.worst.frame})`);
    }
    const manifestBytes = format.utf8Length(text);
    const envelopeBytes = format.cosmeticEnvelopeLength(text);
    const report = reportText(entry, source, result, texture, glow, manifestBytes, envelopeBytes, format.COSMETIC_LIMITS_2);

    if (!checkOnly) {
      const dir = path.join(COSMETICS, entry.id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'cosmetic.json'), `${pretty(result.cosmetic)}\n`);
      await writeFile(path.join(dir, 'texture.png'), texture);
      await writeFile(path.join(dir, 'glow.png'), glow);
      await writeFile(path.join(dir, 'pruefbericht.txt'), report);
    }
    const s = result.stats;
    summary.push({ entry, manifestBytes, s, ms: Date.now() - started });
    console.log(
      `${checkOnly ? 'geprüft' : 'geschrieben'}  ${entry.id.padEnd(17)} ${kb(manifestBytes).padStart(9)}  ${String(s.keyCount).padStart(5)} Keys  ` +
        `Fehler ${fix(s.maxError.rot, 3)}° / ${fix(s.maxError.move, 4)} px / ${fix(s.maxError.scale, 4)}  Gegenprobe ${fix(s.worst.dev, 3)} px` +
        `${s.useSkin ? '  weiche Haut' : ''}${s.factor !== 1 ? `  Grenzen ×${s.factor}` : ''}`,
    );
  }
  const total = summary.reduce((sum, x) => sum + x.manifestBytes, 0);
  console.log(`${summary.length} Cosmetics ${checkOnly ? 'umgewandelt und geprüft – nichts geschrieben (--pruefen)' : `nach ${COSMETICS} geschrieben`}, zusammen ${kb(total)}.`);
  if (!checkOnly) console.log('Weiter: npm run cosmetic -- --pruefen, danach signieren (npm run cosmetic) und im Team-Bereich hochladen.');
}

main().catch((error) => {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
