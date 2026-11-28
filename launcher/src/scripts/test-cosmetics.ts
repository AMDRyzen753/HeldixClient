// Prüft das Cosmetic-Format (core/cosmetics-format.ts = Kopie von service/src/cosmetics-format.ts, core/cosmetics.ts)
// und den Startsatz unter cosmetics/: Kopie gleich dem Dienst, gültige Beispiele je Slot, jede Grenze einzeln verletzt,
// Umschlag und Signatur (falsches Präfix, fremder Schlüssel, verändertes Manifest), Bedeutung von Box-UV/Animationen,
// Format 2 (Mesh mit Keyframes: Beispiele, Regeln, Dekodier-Hilfen, Größe je Format) und dass jedes Start-Cosmetic
// (Format 1 und die aus Blender übernommenen in Format 2) gebaut und signiert werden kann. Signiert wird mit einem Test-Schlüssel – der echte
// Update-Schlüssel wird nicht gebraucht.
//
// Aufruf: npm run test:cosmetics

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  cosmeticBoneMatrices,
  cosmeticCubeFaces,
  cosmeticPose,
  cosmeticSignedBytes,
  mat4Apply,
  parseCosmeticManifestText,
  pngDataUrl,
  verifyCosmeticEnvelope,
} from '../main/core/cosmetics';
import {
  BUILTIN_CAPE_IDS,
  checkCosmeticEnvelope,
  checkCosmeticManifest,
  COSMETIC_LIMITS,
  COSMETIC_LIMITS_2,
  COSMETIC_MAX_MANIFEST_BYTES,
  COSMETIC_SIGNATURE_PREFIX,
  cosmeticEnvelopeText,
  decodeCosmeticMesh,
  decodeCosmeticTrack,
  encodeInt16LE,
  encodeInt8,
  encodeUint16LE,
  encodeUint8,
  readPng,
  type CosmeticManifest,
  type CosmeticManifest2,
  type CosmeticModel,
} from '../main/core/cosmetics-format';
import { buildCosmetic, listCosmeticSources } from './cosmetic-sources';
import { check, encodePng, finish } from './testkit';

type Json = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** PNG mit einfachem Muster (noise = schlecht komprimierbar, für die Größengrenze) */
function png(width: number, height: number, noise = false): string {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = noise ? (i * 2654435761) >>> 24 : 200;
    rgba[i * 4 + 1] = noise ? (i * 40503) & 255 : 120;
    rgba[i * 4 + 2] = noise ? (i * 97) & 255 : 40;
    rgba[i * 4 + 3] = i % 3 ? 255 : 0;
  }
  return pngDataUrl(encodePng(width, height, rgba));
}

const DATE = '2026-11-26T12:00:00.000Z';
const BASE = { type: 'heldix-cosmetic', format: 1, version: 1, description: 'Zum Testen', access: 'all', date: DATE };

/** Rohes Modell ohne scale (Standardwert 1) */
function simpleModel(textureSize: [number, number] = [64, 32]): Omit<CosmeticModel, 'scale'> {
  return {
    textureSize,
    bones: [
      { name: 'base', pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 2, 8], uv: [0, 0], inflate: 0, mirror: false }] } as never,
      { name: 'spitze', parent: 'base', pivot: [0, 2, 0], cubes: [{ origin: [-1, 2, -1], size: [2, 3, 2], uv: [32, 0] }] } as never,
    ],
  };
}

const VALID: Record<string, Json> = {
  head: { ...BASE, id: 'test-hut', slot: 'head', name: 'Testhut', texture: png(64, 32), model: simpleModel(), animations: [{ bone: 'spitze', type: 'spin', axis: 'y', speed: 0.5 }] },
  back: {
    ...BASE, id: 'test-fluegel', slot: 'back', name: 'Testflügel', texture: png(64, 32), glow: png(64, 32),
    model: {
      textureSize: [64, 32],
      bones: [
        { name: 'fluegel_links', pivot: [1, -3, -2.5], rotation: [0, 20, 0], cubes: [{ origin: [1, -15, -2.5], size: [16, 20, 0], uv: [0, 0] }] },
        { name: 'fluegel_rechts', pivot: [-1, -3, -2.5], rotation: [0, -20, 0], cubes: [{ origin: [-17, -15, -2.5], size: [16, 20, 0], uv: [0, 0], mirror: true }] },
      ],
    },
    animations: [
      { bone: 'fluegel_links', type: 'flap', axis: 'y', amplitude: 25, speed: 1.2, phase: 0 },
      { bone: 'fluegel_rechts', type: 'flap', axis: 'y', amplitude: 25, speed: 1.2, phase: 0.5 },
    ],
  },
  companion: {
    ...BASE, id: 'test-begleiter', slot: 'companion', name: 'Testbegleiter', texture: png(32, 16),
    model: { textureSize: [32, 16], bones: [{ name: 'koerper', pivot: [0, 2, 0], cubes: [{ origin: [-2, 0, -2], size: [4, 4, 4], uv: [0, 0] }] }] },
    animations: [{ bone: 'koerper', type: 'bob', axis: 'y', amplitude: 1, speed: 0.5 }],
    companion: { offset: [0.7, 1.6, -0.4], scale: 1 },
  },
  aura: {
    ...BASE, id: 'test-aura', slot: 'aura', name: 'Testaura', texture: png(32, 8),
    particles: { frames: 4, rate: 6, lifetime: 30, size: 0.12, motion: 'rise', radius: 0.6, color: '#ffffff', fullbright: true },
  },
  cape: { ...BASE, id: 'test-cape', slot: 'cape', name: 'Testcape', texture: png(64, 64), cape: { frames: 2, fps: 12 } },
};

/** Prüft ein Manifest-Objekt (Format 1); liefert das Manifest oder wirft mit der (ersten) Fehlermeldung. */
function parse(manifest: unknown): CosmeticManifest {
  const result = checkCosmeticManifest(manifest);
  if (typeof result === 'string') throw new Error(result);
  if (result.format !== 1) throw new Error(`Format ${result.format} statt 1`);
  return result;
}

// ---------- Format 2: Rechteck an zwei Knochen (1/32 Pixel), zwei Animationen, Leucht-Streifen mit 4 Bildern ----------

const quatY = (degrees: number) => [0, Math.round(Math.sin((degrees * Math.PI) / 360) * 32767), 0, Math.round(Math.cos((degrees * Math.PI) / 360) * 32767)];

function mesh2(slot: 'head' | 'back' | 'aura' | 'companion'): Json {
  return {
    type: 'heldix-cosmetic', format: 2, id: `test-mesh-${slot}`, version: 1, slot, name: `Testmesh ${slot}`, description: 'Zum Testen', access: 'all', date: DATE,
    texture: png(16, 16), glow: png(16, 64),
    emissive: { frames: 4, frametimeTicks: 2, pulse: { period: 2, min: 0.5, max: 1 } },
    bones: [
      { name: 'root', parent: -1, pivot: [0, 0, 2], tail: [0, 4, 2] },
      { name: 'wing.L', parent: 0, pivot: [4, 0, 2], tail: [4, 8, 2] },
    ],
    mesh: {
      vertexCount: 4, triangleCount: 2,
      positions: encodeInt16LE([0, 0, 2, 4, 0, 2, 4, 8, 2, 0, 8, 2].map((v) => v * 32)),
      normals: encodeInt8([0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127]),
      uvs: encodeUint16LE([0, 0, 65535, 0, 65535, 65535, 0, 65535]),
      bones: encodeUint8([0, 0, 1, 1]),
      triangles: encodeUint16LE([0, 1, 2, 0, 2, 3]),
    },
    animations: {
      Idle: { fps: 24, frames: 48, loop: true, tracks: [{ bone: 1, rot: { keys: encodeUint16LE([0, 24, 47]), values: encodeInt16LE([...quatY(0), ...quatY(30), ...quatY(1)]) } }] },
      Hurt: { fps: 24, frames: 12, loop: false, tracks: [{ bone: 0, move: { keys: encodeUint16LE([0, 6]), values: encodeInt16LE([0, 0, 0, 0, -32, 0]) }, scale: { keys: encodeUint16LE([0]), values: encodeUint16LE([1000]) } }] },
    },
    states: { idle: 'Idle', hurt: 'Hurt', blendSeconds: 0.25 },
    particles: [{ bone: 1, at: 'tail', particle: 'minecraft:dust', color: '#ffcc00', perSecond: 2, states: ['Idle'] }],
    ...(slot === 'companion' ? { attach: { origin: [14, -6, 1], side: 'left' } } : {}),
  };
}

/** Prüft ein Manifest-Objekt (Format 2) oder wirft mit der Fehlermeldung. */
function parse2(manifest: unknown): CosmeticManifest2 {
  const result = checkCosmeticManifest(manifest);
  if (typeof result === 'string') throw new Error(result);
  if (result.format !== 2) throw new Error(`Format ${result.format} statt 2`);
  return result;
}

function rejects2(label: string, change: (m: Json) => void, pattern: RegExp, slot: 'head' | 'back' | 'aura' | 'companion' = 'back'): void {
  const manifest = mesh2(slot);
  change(manifest);
  const result = checkCosmeticManifest(manifest);
  check(`Format 2 abgelehnt: ${label}`, typeof result === 'string' && pattern.test(result), typeof result === 'string' ? result : 'keine Fehlermeldung');
}

/** Erwartet, dass die Änderung mit passender Meldung abgelehnt wird (der Rest des Beispiels ist gültig). */
function rejects(label: string, slot: keyof typeof VALID, change: (m: Json) => void, pattern: RegExp): void {
  const manifest = clone(VALID[slot]);
  change(manifest);
  const result = checkCosmeticManifest(manifest);
  check(`abgelehnt: ${label}`, typeof result === 'string' && pattern.test(result), typeof result === 'string' ? result : 'keine Fehlermeldung');
}

function accepts(label: string, slot: keyof typeof VALID, change: (m: Json) => void): void {
  const manifest = clone(VALID[slot]);
  change(manifest);
  const result = checkCosmeticManifest(manifest);
  check(`erlaubt: ${label}`, typeof result !== 'string', result);
}

function envelopeOf(manifest: Json, key: KeyObject, prefix = COSMETIC_SIGNATURE_PREFIX): string {
  const text = JSON.stringify(manifest);
  const signature = sign(null, Buffer.from(prefix + text, 'utf8'), key).toString('base64');
  return cosmeticEnvelopeText({ manifest: text, signature });
}

function throwsWith(label: string, task: () => unknown, pattern: RegExp): void {
  try {
    task();
    check(label, false, 'kein Fehler');
  } catch (error) {
    check(label, pattern.test((error as Error).message), (error as Error).message);
  }
}

async function main(): Promise<void> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');

  // ---------- Kopie im Launcher = Prüfung des Dienstes ----------
  const serviceCopy = path.resolve(__dirname, '..', '..', '..', 'service', 'src', 'cosmetics-format.ts');
  const launcherCopy = path.resolve(__dirname, '..', '..', 'src', 'main', 'core', 'cosmetics-format.ts');
  if (existsSync(serviceCopy)) {
    check('core/cosmetics-format.ts gleich service/src/cosmetics-format.ts', readFileSync(serviceCopy).equals(readFileSync(launcherCopy)), 'neu aus service/src kopieren');
  }

  // ---------- gültige Beispiele je Slot ----------
  for (const [slot, manifest] of Object.entries(VALID)) {
    const result = checkCosmeticManifest(manifest);
    check(`gültig: Beispiel ${slot}`, typeof result !== 'string', result);
    try {
      const parsed = verifyCosmeticEnvelope(envelopeOf(manifest, privateKey), publicKey);
      check(`signiert und geprüft: ${slot}`, parsed.id === manifest.id && parsed.slot === slot);
    } catch (error) {
      check(`signiert und geprüft: ${slot}`, false, error);
    }
  }
  const head = parse(VALID.head);
  check('Standardwerte ergänzt (parent, rotation, inflate, mirror, phase, amplitude bei spin, model.scale)',
    head.model!.bones[1].parent === 'base' && head.model!.bones[1].rotation.join() === '0,0,0' && head.model!.bones[1].cubes[0].inflate === 0
      && head.model!.bones[1].cubes[0].mirror === false && head.animations[0].phase === 0 && head.animations[0].amplitude === 0 && head.glow === null
      && head.model!.scale === 1);
  const scaled = clone(VALID.back);
  scaled.model.scale = 0.62;
  check('model.scale übernommen', parse(scaled).model!.scale === 0.62);
  check('Texturmaße aus dem PNG-Kopf', head.image.width === 64 && head.image.height === 32);

  // ---------- Grenzen genau erreicht ----------
  accepts('Name mit 40 Zeichen', 'head', (m) => (m.name = 'Ä'.repeat(40)));
  accepts('Beschreibung leer', 'head', (m) => (m.description = ''));
  accepts('Beschreibung mit 300 Zeichen', 'head', (m) => (m.description = 'x'.repeat(300)));
  accepts('ID mit 32 Zeichen', 'head', (m) => (m.id = 'a'.repeat(32)));
  accepts('access team', 'head', (m) => (m.access = 'team'));
  accepts('access unlock (Belohnung, z. B. für Einladungen)', 'aura', (m) => (m.access = 'unlock'));
  accepts('version 2^31 − 1', 'head', (m) => (m.version = 2147483647));
  accepts('64 Bones, 128 Würfel, 16 Animationen', 'head', (m) => {
    m.texture = png(256, 256);
    m.model = { textureSize: [256, 256], bones: Array.from({ length: 64 }, (_, i) => ({ name: `b${i}`, pivot: [0, 0, 0], cubes: Array.from({ length: 2 }, () => ({ origin: [-48, -48, -48], size: [1, 1, 1], uv: [252, 254] })) })) };
    m.animations = Array.from({ length: 16 }, (_, i) => ({ bone: `b${i}`, type: 'flap', axis: 'x', amplitude: 90, speed: 4, phase: 1 }));
  });
  accepts('model.scale 0,25', 'head', (m) => (m.model.scale = 0.25));
  accepts('model.scale 1,5', 'back', (m) => (m.model.scale = 1.5));
  accepts('model.scale beim Begleiter (zusätzlich zu companion.scale)', 'companion', (m) => (m.model.scale = 0.5));
  accepts('texture 512 × 256', 'head', (m) => ((m.texture = png(512, 256)), (m.model.textureSize = [512, 256])));
  accepts('texture 512 × 256 für 128 × 64 Texel (4-fache Auflösung)', 'head', (m) => ((m.texture = png(512, 256)), (m.model.textureSize = [128, 64])));
  accepts('texture 128 × 64 für 64 × 32 Texel (2-fache Auflösung)', 'head', (m) => ((m.texture = png(128, 64)), (m.model.textureSize = [64, 32])));
  accepts('texture und glow 4-fach (256 × 128 für 64 × 32 Texel)', 'back', (m) => ((m.texture = png(256, 128)), (m.glow = png(256, 128))));
  accepts('texture und glow 512 × 512', 'back', (m) => ((m.texture = png(512, 512)), (m.glow = png(512, 512)), (m.model.textureSize = [512, 512])));
  accepts('leere Bones neben einem Würfel', 'head', (m) => m.model.bones.push({ name: 'leer', parent: 'base', pivot: [0, 0, 0], cubes: [] }));
  accepts('Würfelkante 32 und Koordinate 48', 'head', (m) => ((m.texture = png(256, 64)), delete m.animations, (m.model = { textureSize: [256, 64], bones: [{ name: 'a', pivot: [48, -48, 0], rotation: [180, -180, 0], cubes: [{ origin: [16, 0, 0], size: [32, 0, 0], uv: [0, 0], inflate: 0 }] }] })));
  accepts('Ebene (eine Kante 0) und inflate 2', 'head', (m) => (m.model.bones[0].cubes[0] = { origin: [-4, 2, 0], size: [8, 8, 0], uv: [0, 0], inflate: 2 }));
  accepts('bob mit 8 px', 'companion', (m) => (m.animations[0].amplitude = 8));
  accepts('Partikel an den Grenzen', 'aura', (m) => ((m.texture = png(64, 8)), (m.particles = { frames: 8, rate: 20, lifetime: 80, size: 0.4, motion: 'float', radius: 1.5, color: '#00FF7f' })));
  accepts('Cape 64 breit, 32 Bilder, 20 fps', 'cape', (m) => ((m.texture = png(64, 1024)), (m.cape = { frames: 32, fps: 20 })));
  accepts('Cape 128 breit (2-fach)', 'cape', (m) => ((m.texture = png(128, 128)), (m.cape = { frames: 2, fps: 10 })));
  accepts('Cape 256 breit (4-fach)', 'cape', (m) => ((m.texture = png(256, 128)), (m.cape = { frames: 1, fps: 1 })));
  accepts('Begleiter an den Grenzen', 'companion', (m) => (m.companion = { offset: [-2, 3, 2], scale: 0.25 }));

  // ---------- jede Regel einzeln verletzt ----------
  rejects('type falsch', 'head', (m) => (m.type = 'heldix-addon'), /„type“/);
  rejects('format 3', 'head', (m) => (m.format = 3), /„format“ muss 1 oder 2 sein/);
  rejects('Format-1-Inhalt mit format 2', 'head', (m) => (m.format = 2), /„model“ ist kein bekanntes Feld \(Format 2\)/);
  rejects('ID mit Großbuchstaben', 'head', (m) => (m.id = 'Krone'), /„id“ ist ungültig/);
  rejects('ID beginnt mit -', 'head', (m) => (m.id = '-krone'), /„id“ ist ungültig/);
  rejects('ID endet mit -', 'head', (m) => (m.id = 'krone-'), /„id“ ist ungültig/);
  rejects('ID mit 33 Zeichen', 'head', (m) => (m.id = 'a'.repeat(33)), /„id“ ist ungültig/);
  rejects('ID eines eingebauten Capes', 'cape', (m) => (m.id = BUILTIN_CAPE_IDS[2]), /eingebauten Capes/);
  rejects('version 0', 'head', (m) => (m.version = 0), /„version“/);
  rejects('version 1,5', 'head', (m) => (m.version = 1.5), /„version“/);
  rejects('version 2^31', 'head', (m) => (m.version = 2147483648), /„version“/);
  rejects('version als Text', 'head', (m) => (m.version = '1'), /„version“/);
  rejects('slot unbekannt', 'head', (m) => (m.slot = 'hand'), /„slot“/);
  rejects('Name leer', 'head', (m) => (m.name = ''), /„name“ darf nicht leer/);
  rejects('Name nur Leerzeichen', 'head', (m) => (m.name = '   '), /„name“ darf nicht leer/);
  rejects('Name mit 41 Zeichen', 'head', (m) => (m.name = 'x'.repeat(41)), /„name“ ist zu lang/);
  rejects('Name mit Zeilenumbruch', 'head', (m) => (m.name = 'Zwei\nZeilen'), /„name“ enthält Zeichen/);
  rejects('Name mit Zeilentrenner U+2028', 'head', (m) => (m.name = `A${String.fromCharCode(0x2028)}B`), /„name“ enthält Zeichen/);
  rejects('Name mit Schreibrichtungszeichen', 'head', (m) => (m.name = `A${String.fromCharCode(0x202e)}B`), /„name“ enthält Zeichen/);
  rejects('Beschreibung mit 301 Zeichen', 'head', (m) => (m.description = 'x'.repeat(301)), /„description“ ist zu lang/);
  rejects('Beschreibung mit Tab', 'head', (m) => (m.description = 'a\tb'), /„description“ enthält Zeichen/);
  rejects('access unbekannt', 'head', (m) => (m.access = 'admin'), /„access“/);
  rejects('date kein Zeitpunkt', 'head', (m) => (m.date = '26.11.2026'), /„date“/);
  rejects('date ungültiger Tag', 'head', (m) => (m.date = '2026-02-30T12:00:00.000Z'), /„date“/);
  rejects('unbekanntes Feld oben', 'head', (m) => (m.script = 'alert(1)'), /„script“ ist kein bekanntes Feld/);
  rejects('unbekanntes Feld im Würfel', 'head', (m) => (m.model.bones[0].cubes[0].color = 'red'), /„model\.bones\[0\]\.cubes\[0\]\.color“ ist kein bekanntes Feld/);
  rejects('unbekanntes Feld in particles', 'aura', (m) => (m.particles.gravity = 1), /„particles\.gravity“ ist kein bekanntes Feld/);

  // Texturen
  rejects('texture fehlt', 'head', (m) => delete m.texture, /„texture“ fehlt/);
  rejects('texture keine data-URL', 'head', (m) => (m.texture = 'https://example.com/x.png'), /„texture“ muss eine data-URL/);
  rejects('texture als JPEG-URL', 'head', (m) => (m.texture = m.texture.replace('image/png', 'image/jpeg')), /„texture“ muss eine data-URL/);
  rejects('texture mit ungültigem Base64', 'head', (m) => (m.texture = 'data:image/png;base64,abc$'), /„texture“ enthält kein gültiges Base64/);
  rejects('texture kein PNG', 'head', (m) => (m.texture = pngDataUrl(Buffer.from('GIF89a…………………………………………'))), /„texture“ ist kein PNG/);
  rejects('texture mit falscher IHDR-Prüfsumme', 'head', (m) => {
    const bytes = Buffer.from(m.texture.slice('data:image/png;base64,'.length), 'base64');
    bytes[29] ^= 0xff;
    m.texture = pngDataUrl(bytes);
  }, /Prüfsumme von IHDR/);
  rejects('texture abgeschnitten (IEND fehlt)', 'head', (m) => {
    const bytes = Buffer.from(m.texture.slice('data:image/png;base64,'.length), 'base64');
    m.texture = pngDataUrl(bytes.subarray(0, bytes.length - 12));
  }, /IEND fehlt/);
  rejects('texture größer als 64 KB', 'head', (m) => ((m.texture = png(256, 256, true)), (m.model.textureSize = [256, 256])), /„texture“ ist zu groß/);
  rejects('texture 12 px breit', 'head', (m) => ((m.texture = png(12, 16)), (m.model.textureSize = [12, 16])), /„texture“ muss 8 bis 512/);
  rejects('texture 520 px breit', 'head', (m) => ((m.texture = png(520, 16)), (m.model.textureSize = [520, 16])), /„texture“ muss 8 bis 512/);
  rejects('texture 1024 px hoch', 'head', (m) => ((m.texture = png(16, 1024)), (m.model.textureSize = [16, 1024])), /„texture“ muss 8 bis 512 Pixel breit und hoch sein, jeweils ein Vielfaches von 8 \(ist 16 × 1024\)/);
  rejects('texture kleiner als 8 px', 'aura', (m) => (m.texture = png(16, 4)), /„texture“ muss 8 bis 512/);
  rejects('glow anders groß', 'back', (m) => (m.glow = png(32, 32)), /„glow“ muss genauso groß/);
  rejects('glow kein PNG', 'back', (m) => (m.glow = 'data:image/png;base64,AAAA'), /„glow“ ist kein PNG/);

  // Felder je Slot
  rejects('head ohne model', 'head', (m) => delete m.model, /„model“ fehlt/);
  rejects('companion ohne companion', 'companion', (m) => delete m.companion, /„companion“ fehlt/);
  rejects('aura ohne particles', 'aura', (m) => delete m.particles, /„particles“ fehlt/);
  rejects('cape ohne cape', 'cape', (m) => delete m.cape, /„cape“ fehlt/);
  rejects('aura mit model', 'aura', (m) => (m.model = simpleModel([32, 8])), /„model“ gibt es beim Slot aura nicht/);
  rejects('aura mit animations', 'aura', (m) => (m.animations = []), /„animations“ gibt es nur mit „model“/);
  rejects('head mit particles', 'head', (m) => (m.particles = VALID.aura.particles), /„particles“ gibt es beim Slot head nicht/);
  rejects('head mit cape', 'head', (m) => (m.cape = { frames: 1, fps: 1 }), /„cape“ gibt es beim Slot head nicht/);
  rejects('back mit companion', 'back', (m) => (m.companion = VALID.companion.companion), /„companion“ gibt es beim Slot back nicht/);
  rejects('cape mit model', 'cape', (m) => (m.model = simpleModel([64, 64])), /„model“ gibt es beim Slot cape nicht/);

  // Modell
  rejects('textureSize passt nicht zur Textur', 'head', (m) => (m.model.textureSize = [64, 64]), /^„model\.textureSize“ muss die Größe der Textur in Texeln sein \(\[64, 32\], \[32, 16\] oder \[16, 8\]: Textur in 1-, 2- oder 4-facher Auflösung\)$/);
  rejects('textureSize mit 3-facher Auflösung', 'head', (m) => ((m.texture = png(192, 96)), (m.model.textureSize = [64, 32])), /„model\.textureSize“ muss die Größe der Textur in Texeln sein \(\[192, 96\]/);
  rejects('textureSize ungleich aufgelöst', 'head', (m) => ((m.texture = png(256, 64)), (m.model.textureSize = [64, 32])), /„model\.textureSize“/);
  rejects('UV zählt in Texeln von textureSize (4-fach)', 'head', (m) => ((m.texture = png(256, 128)), (m.model.bones[0].cubes[0].uv = [40, 0])), /Die UV-Fläche \(32 × 10 ab 40, 0\) passt nicht in die Textur \(64 × 32\)/);
  rejects('keine Bones', 'head', (m) => (m.model.bones = []), /„model\.bones“ muss eine Liste mit 1 bis 64 Bones sein/);
  rejects('65 Bones', 'head', (m) => (m.model.bones = Array.from({ length: 65 }, (_, i) => ({ name: `b${i}`, pivot: [0, 0, 0], cubes: i ? [] : [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }))), /„model\.bones“ muss eine Liste mit 1 bis 64 Bones sein/);
  rejects('model.scale 0,2', 'head', (m) => (m.model.scale = 0.2), /^„model\.scale“ muss eine Zahl von 0\.25 bis 1\.5 sein$/);
  rejects('model.scale 1,6', 'back', (m) => (m.model.scale = 1.6), /^„model\.scale“ muss eine Zahl von 0\.25 bis 1\.5 sein$/);
  rejects('model.scale 0', 'head', (m) => (m.model.scale = 0), /„model\.scale“/);
  rejects('model.scale als Text', 'head', (m) => (m.model.scale = '1'), /„model\.scale“/);
  rejects('model.scale null', 'head', (m) => (m.model.scale = null), /„model\.scale“/);
  rejects('129 Würfel', 'head', (m) => {
    m.texture = png(256, 256);
    m.model = { textureSize: [256, 256], bones: Array.from({ length: 3 }, (_, i) => ({ name: `b${i}`, pivot: [0, 0, 0], cubes: Array.from({ length: 43 }, () => ({ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] })) })) };
  }, /zu viele Würfel/);
  rejects('kein Würfel', 'head', (m) => (m.model.bones = [{ name: 'leer', pivot: [0, 0, 0], cubes: [] }]), /mindestens einen Würfel/);
  rejects('Bone-Name mit Umlaut', 'head', (m) => (m.model.bones[0].name = 'flügel'), /„model\.bones\[0\]\.name“ ist ungültig/);
  rejects('Bone-Name mit 25 Zeichen', 'head', (m) => (m.model.bones[0].name = 'a'.repeat(25)), /„model\.bones\[0\]\.name“ ist ungültig/);
  rejects('Bone-Name doppelt', 'head', (m) => (m.model.bones[1].name = 'base'), /gibt es schon/);
  rejects('parent erst später definiert', 'head', (m) => m.model.bones.reverse(), /„model\.bones\[0\]\.parent“/);
  rejects('parent zeigt auf sich selbst', 'head', (m) => (m.model.bones[1].parent = 'spitze'), /„model\.bones\[1\]\.parent“/);
  rejects('pivot außerhalb', 'head', (m) => (m.model.bones[0].pivot = [0, -49, 0]), /„model\.bones\[0\]\.pivot“/);
  rejects('rotation 181', 'head', (m) => (m.model.bones[0].rotation = [0, 181, 0]), /„model\.bones\[0\]\.rotation“/);
  rejects('rotation mit 2 Werten', 'head', (m) => (m.model.bones[0].rotation = [0, 0]), /„model\.bones\[0\]\.rotation“/);
  rejects('Würfelkante 33', 'head', (m) => (m.model.bones[0].cubes[0].size = [33, 1, 1]), /„model\.bones\[0\]\.cubes\[0\]\.size“/);
  rejects('Würfelkante negativ', 'head', (m) => (m.model.bones[0].cubes[0].size = [-1, 1, 1]), /„model\.bones\[0\]\.cubes\[0\]\.size“/);
  rejects('alle Kanten 0', 'head', (m) => (m.model.bones[0].cubes[0].size = [0, 0, 0]), /mindestens eine Kante/);
  rejects('Würfel reicht über 48 px', 'head', (m) => (m.model.bones[0].cubes[0].origin = [42, 0, 0]), /reicht weiter als 48 Pixel/);
  rejects('origin außerhalb', 'head', (m) => (m.model.bones[0].cubes[0].origin = [-49, 0, 0]), /„model\.bones\[0\]\.cubes\[0\]\.origin“/);
  rejects('inflate 2,5', 'head', (m) => (m.model.bones[0].cubes[0].inflate = 2.5), /„model\.bones\[0\]\.cubes\[0\]\.inflate“/);
  rejects('inflate lässt Würfel über 48 px reichen', 'head', (m) => ((m.model.bones[0].cubes[0].origin = [-48, 0, 0]), (m.model.bones[0].cubes[0].inflate = 1)), /reicht weiter als 48 Pixel/);
  rejects('UV passt nicht in die Textur', 'head', (m) => (m.model.bones[0].cubes[0].uv = [40, 0]), /Die UV-Fläche/);
  rejects('UV negativ', 'head', (m) => (m.model.bones[0].cubes[0].uv = [-1, 0]), /„model\.bones\[0\]\.cubes\[0\]\.uv“/);
  rejects('UV nicht ganzzahlig', 'head', (m) => (m.model.bones[0].cubes[0].uv = [0.5, 0]), /„model\.bones\[0\]\.cubes\[0\]\.uv“/);
  rejects('mirror als Text', 'head', (m) => (m.model.bones[0].cubes[0].mirror = 'ja'), /„model\.bones\[0\]\.cubes\[0\]\.mirror“/);
  rejects('Zahl als Text im origin', 'head', (m) => (m.model.bones[0].cubes[0].origin = ['0', 0, 0]), /„model\.bones\[0\]\.cubes\[0\]\.origin“/);

  // Animationen
  rejects('17 Animationen', 'head', (m) => (m.animations = Array.from({ length: 17 }, () => ({ bone: 'base', type: 'spin', axis: 'y', speed: 1 }))), /„animations“ muss eine Liste mit höchstens 16/);
  rejects('animations kein Array', 'head', (m) => (m.animations = {}), /„animations“ muss eine Liste/);
  rejects('Animation für unbekannten Bone', 'head', (m) => (m.animations[0].bone = 'gibtsnicht'), /„animations\[0\]\.bone“/);
  rejects('Animationstyp unbekannt', 'head', (m) => (m.animations[0].type = 'wobble'), /„animations\[0\]\.type“/);
  rejects('Achse unbekannt', 'head', (m) => (m.animations[0].axis = 'w'), /„animations\[0\]\.axis“/);
  rejects('flap mit 91 Grad', 'back', (m) => (m.animations[0].amplitude = 91), /„animations\[0\]\.amplitude“ muss eine Zahl von 0 bis 90/);
  rejects('flap ohne amplitude', 'back', (m) => delete m.animations[0].amplitude, /„animations\[0\]\.amplitude“ fehlt/);
  rejects('bob mit 9 px', 'companion', (m) => (m.animations[0].amplitude = 9), /„animations\[0\]\.amplitude“ muss eine Zahl von 0 bis 8/);
  rejects('speed 4,5', 'head', (m) => (m.animations[0].speed = 4.5), /„animations\[0\]\.speed“/);
  rejects('phase 1,5', 'head', (m) => (m.animations[0].phase = 1.5), /„animations\[0\]\.phase“/);

  // Partikel
  rejects('frames 9', 'aura', (m) => ((m.particles.frames = 9), (m.texture = png(72, 8))), /„particles\.frames“/);
  rejects('frames 0', 'aura', (m) => (m.particles.frames = 0), /„particles\.frames“/);
  rejects('rate 0', 'aura', (m) => (m.particles.rate = 0), /„particles\.rate“/);
  rejects('rate 21', 'aura', (m) => (m.particles.rate = 21), /„particles\.rate“/);
  rejects('rate 2,5', 'aura', (m) => (m.particles.rate = 2.5), /„particles\.rate“ muss eine ganze Zahl/);
  rejects('lifetime 4', 'aura', (m) => (m.particles.lifetime = 4), /„particles\.lifetime“/);
  rejects('lifetime 81', 'aura', (m) => (m.particles.lifetime = 81), /„particles\.lifetime“/);
  rejects('lifetime 10,5', 'aura', (m) => (m.particles.lifetime = 10.5), /„particles\.lifetime“ muss eine ganze Zahl/);
  rejects('size 0,02', 'aura', (m) => (m.particles.size = 0.02), /„particles\.size“/);
  rejects('size 0,5', 'aura', (m) => (m.particles.size = 0.5), /„particles\.size“/);
  rejects('motion unbekannt', 'aura', (m) => (m.particles.motion = 'zickzack'), /„particles\.motion“/);
  rejects('radius 0,1', 'aura', (m) => (m.particles.radius = 0.1), /„particles\.radius“/);
  rejects('radius 1,6', 'aura', (m) => (m.particles.radius = 1.6), /„particles\.radius“/);
  rejects('Farbe kurz', 'aura', (m) => (m.particles.color = '#fff'), /„particles\.color“/);
  rejects('Farbe ohne #', 'aura', (m) => (m.particles.color = 'ffffff'), /„particles\.color“/);
  rejects('fullbright als Zahl', 'aura', (m) => (m.particles.fullbright = 1), /„particles\.fullbright“/);
  rejects('Streifen passt nicht zu frames', 'aura', (m) => (m.particles.frames = 2), /„texture“ muss 2 quadratische Bilder/);

  // Cape
  rejects('Cape mit 33 Bildern', 'cape', (m) => ((m.cape.frames = 33), (m.texture = png(64, 256))), /„cape\.frames“/);
  rejects('Cape mit 21 fps', 'cape', (m) => (m.cape.fps = 21), /„cape\.fps“/);
  rejects('Cape mit 0 fps', 'cape', (m) => (m.cape.fps = 0), /„cape\.fps“/);
  rejects('Cape-Textur passt nicht zu frames', 'cape', (m) => (m.cape.frames = 3), /für ein Cape mit 3 Bildern/);
  rejects('Cape 96 breit', 'cape', (m) => (m.texture = png(96, 96)), /für ein Cape mit 2 Bildern/);
  rejects('Cape 512 breit', 'cape', (m) => ((m.texture = png(512, 256)), (m.cape.frames = 1)), /„texture“/);

  // Begleiter
  rejects('offset x 2,5', 'companion', (m) => (m.companion.offset = [2.5, 1, 0]), /„companion\.offset“/);
  rejects('offset y unter 0', 'companion', (m) => (m.companion.offset = [0, -0.5, 0]), /„companion\.offset“/);
  rejects('offset y über 3', 'companion', (m) => (m.companion.offset = [0, 3.5, 0]), /„companion\.offset“/);
  rejects('offset mit 2 Werten', 'companion', (m) => (m.companion.offset = [0, 0]), /„companion\.offset“/);
  rejects('scale 0,2', 'companion', (m) => (m.companion.scale = 0.2), /„companion\.scale“/);
  rejects('scale 1,6', 'companion', (m) => (m.companion.scale = 1.6), /„companion\.scale“/);

  // ---------- Text- und Umschlaggrenzen ----------
  throwsWith('Manifest größer als 160 KB', () => parseCosmeticManifestText(JSON.stringify(VALID.head) + ' '.repeat(COSMETIC_LIMITS.manifestBytes)), /„manifest“ ist zu groß/);
  throwsWith('Manifest kein JSON', () => parseCosmeticManifestText('{kaputt'), /kein gültiges JSON/);
  const validEnvelope = envelopeOf(VALID.head, privateKey);
  // Der Umschlag kennt das Format noch nicht: größte Grenze (512 KB / 544 KB); Format 1 bleibt beim Lesen bei 160 KB
  const big = { manifest: 'x'.repeat(COSMETIC_MAX_MANIFEST_BYTES), signature: JSON.parse(validEnvelope).signature };
  check('Manifest-Text über 512 KB im Umschlag abgelehnt', typeof checkCosmeticEnvelope({ ...big, manifest: big.manifest + 'x' }) === 'string');
  check('Umschlag über 544 KB abgelehnt', /Umschlag ist zu groß \(höchstens 544 KB\)/.test(String(checkCosmeticEnvelope({ manifest: '"'.repeat(300 * 1024), signature: big.signature }))));
  throwsWith('Format 1 über 160 KB abgelehnt (auch wenn der Umschlag passt)', () => parseCosmeticManifestText(JSON.stringify(VALID.head).slice(0, -1) + ' '.repeat(COSMETIC_LIMITS.manifestBytes) + '}'), /höchstens 160 KB bei Format 1/);
  const two = JSON.stringify(mesh2('back'));
  check('Format 2 bis 512 KB erlaubt', parseCosmeticManifestText(two.slice(0, -1) + ' '.repeat(400 * 1024) + '}').format === 2);
  throwsWith('Format 2 über 512 KB abgelehnt', () => parseCosmeticManifestText(two.slice(0, -1) + ' '.repeat(COSMETIC_LIMITS_2.manifestBytes) + '}'), /„manifest“ ist zu groß/);
  check('Zusatzfelder im Umschlag werden ignoriert', typeof checkCosmeticEnvelope({ ...JSON.parse(validEnvelope), extra: 1 }) !== 'string');
  check('Umschlag ohne Signatur abgelehnt', /„signature“/.test(String(checkCosmeticEnvelope({ manifest: '{}' }))));
  check('Signatur zu kurz abgelehnt', /„signature“/.test(String(checkCosmeticEnvelope({ manifest: '{}', signature: Buffer.alloc(32).toString('base64') }))));
  check('Signatur nicht kanonisch abgelehnt', /„signature“/.test(String(checkCosmeticEnvelope({ manifest: '{}', signature: `${'A'.repeat(85)}B==` }))));
  check('Manifest als Objekt statt Text abgelehnt', /„manifest“/.test(String(checkCosmeticEnvelope({ manifest: VALID.head, signature: big.signature }))));
  throwsWith('Datei kein JSON', () => verifyCosmeticEnvelope('{kaputt', publicKey), /kein gültiges JSON/);

  // ---------- Signatur ----------
  throwsWith('Signatur mit falschem Präfix (heldix-addon)', () => verifyCosmeticEnvelope(envelopeOf(VALID.head, privateKey, 'heldix-addon\n'), publicKey), /Signatur passt nicht/);
  throwsWith('Signatur ohne Präfix', () => verifyCosmeticEnvelope(envelopeOf(VALID.head, privateKey, ''), publicKey), /Signatur passt nicht/);
  throwsWith('Signatur von fremdem Schlüssel', () => verifyCosmeticEnvelope(envelopeOf(VALID.head, other.privateKey), publicKey), /Signatur passt nicht/);
  throwsWith('Manifest nach dem Signieren verändert', () => {
    const env = JSON.parse(validEnvelope);
    env.manifest = env.manifest.replace('"access":"all"', '"access":"team"');
    return verifyCosmeticEnvelope(JSON.stringify(env), publicKey);
  }, /Signatur passt nicht/);
  throwsWith('gültige Signatur, aber Regel verletzt', () => verifyCosmeticEnvelope(envelopeOf({ ...VALID.head, version: 0 }, privateKey), publicKey), /„version“/);
  check('signierte Bytes = Präfix + Manifest', cosmeticSignedBytes('{}').toString('utf8') === 'heldix-cosmetic\n{}');
  check('Umschlag als Bytes', verifyCosmeticEnvelope(Buffer.from(validEnvelope), publicKey).id === 'test-hut');
  check('Umschlag hübsch formatiert (wie eine Datei)', verifyCosmeticEnvelope(JSON.stringify(JSON.parse(validEnvelope), null, 2), publicKey).id === 'test-hut');
  check('öffentlicher Schlüssel als PEM', verifyCosmeticEnvelope(validEnvelope, publicKey.export({ type: 'spki', format: 'pem' }).toString()).id === 'test-hut');

  // ---------- Bedeutung: Box-UV, Spiegeln, Animationen ----------
  const faces = cosmeticCubeFaces({ origin: [0, 0, 0], size: [8, 4, 2], uv: [10, 20], inflate: 0, mirror: false });
  const face = (name: string) => faces.find((f) => f.name === name)!;
  check('Box-UV vorn bei (u+d, v+d)', face('front').uvs[0].join() === '12,22' && face('front').uvs[2].join() === '20,26');
  check('Box-UV oben/unten/hinten', face('top').uvs[0].join() === '12,20' && face('bottom').uvs[0].join() === '20,20' && face('back').uvs[0].join() === '22,22' && face('back').uvs[2].join() === '30,26');
  check('vorn zeigt nach +Z, Textur links = -X', face('front').normal.join() === '0,0,1' && face('front').corners[0].join() === '0,4,2');
  const mirrored = cosmeticCubeFaces({ origin: [0, 0, 0], size: [8, 4, 2], uv: [10, 20], inflate: 0, mirror: true });
  check('mirror: Textur links = +X, rechte Fläche liegt bei +X', mirrored.find((f) => f.name === 'front')!.corners[0].join() === '8,4,2' && mirrored.find((f) => f.name === 'right')!.normal[0] === 1);
  check('Ebene hat nur zwei Flächen', cosmeticCubeFaces({ origin: [0, 0, 0], size: [8, 8, 0], uv: [0, 0], inflate: 0, mirror: false }).length === 2);
  const back = parse(VALID.back);
  const quarter = 0.25 / 1.2;
  const pose = cosmeticPose(back.model!, back.animations, quarter);
  check('flap: Ruhelage + amplitude, rechts gegenläufig', Math.abs(pose.get('fluegel_links')!.rotation[1] - 45) < 1e-9 && Math.abs(pose.get('fluegel_rechts')!.rotation[1] + 45) < 1e-9);
  check('flap im Flug schneller (Faktor 2)', Math.abs(cosmeticPose(back.model!, back.animations, quarter / 2, 2).get('fluegel_links')!.rotation[1] - 45) < 1e-9);
  const spin = cosmeticPose(head.model!, head.animations, 0.5).get('spitze')!;
  check('spin: 0,5 Umdrehungen/s nach 0,5 s = 90°', Math.abs(spin.rotation[1] - 90) < 1e-9);
  const comp = parse(VALID.companion);
  check('bob verschiebt den Pivot', Math.abs(cosmeticPose(comp.model!, comp.animations, 0.5).get('koerper')!.offset[1] - 1) < 1e-9);
  const rot = cosmeticBoneMatrices({ textureSize: [64, 32], scale: 1, bones: [{ name: 'a', parent: null, pivot: [0, 0, 0], rotation: [0, 90, 0], cubes: [] }] }).get('a')!;
  const turned = mat4Apply(rot, [1, 0, 0]);
  check('Drehung um +Y (rechte Hand): +X → -Z', Math.abs(turned[0]) < 1e-9 && Math.abs(turned[2] + 1) < 1e-9);
  const chainModel = (scale: number): CosmeticModel => ({
    textureSize: [64, 32],
    scale,
    bones: [
      { name: 'a', parent: null, pivot: [0, 0, 0], rotation: [0, 0, 90], cubes: [] },
      { name: 'b', parent: 'a', pivot: [4, 0, 0], rotation: [0, 0, 90], cubes: [] },
    ],
  });
  const tip = mat4Apply(cosmeticBoneMatrices(chainModel(1)).get('b')!, [8, 0, 0]);
  check('Bones erben die Lage der Eltern (Pivots absolut)', Math.abs(tip[0] + 4) < 1e-9 && Math.abs(tip[1] - 4) < 1e-9);
  // model.scale: S · Matrix des Bones um den Anker – Spitze halb so weit weg, Anker bleibt, auch bei Kindern
  const half = cosmeticBoneMatrices(chainModel(0.5));
  const halfTip = mat4Apply(half.get('b')!, [8, 0, 0]);
  const halfAnchor = mat4Apply(half.get('a')!, [0, 0, 0]);
  check('model.scale skaliert um den Anker über den Bone-Matrizen', Math.abs(halfTip[0] + 2) < 1e-9 && Math.abs(halfTip[1] - 2) < 1e-9
    && halfAnchor.every((v) => Math.abs(v) < 1e-9), [halfTip, halfAnchor]);

  // ---------- Format 2: Mesh mit Keyframes ----------
  for (const slot of ['head', 'back', 'aura', 'companion'] as const) {
    try {
      const verified = verifyCosmeticEnvelope(envelopeOf(mesh2(slot), privateKey), publicKey);
      check(`Format 2 gültig, signiert und geprüft: ${slot}`, verified.format === 2 && verified.slot === slot);
    } catch (error) {
      check(`Format 2 gültig, signiert und geprüft: ${slot}`, false, error);
    }
  }
  const m2 = parse2(mesh2('companion'));
  check('Format 2: Standardwerte und Partikel ohne „minecraft:“', m2.particles[0].particle === 'dust' && m2.particles[0].color === '#ffcc00'
    && m2.attach?.side === 'left' && m2.attach.origin.join() === '14,-6,1' && m2.states.idle === 'Idle' && m2.states.blendSeconds === 0.25 && m2.mesh.joints === null);
  const withoutAttach = mesh2('companion');
  delete withoutAttach.attach;
  check('Format 2: attach fehlt → Ursprung 0, links', parse2(withoutAttach).attach?.origin.join() === '0,0,0');
  const decoded = decodeCosmeticMesh(m2.mesh);
  check('Format 2: Mesh dekodiert (Int16LE, Int8, Uint16LE, Uint8)', decoded.positions[3] === 128 && decoded.positions[7] === 256 && decoded.normals[2] === 127
    && decoded.uvs[2] === 65535 && decoded.bones.join() === '0,0,1,1' && decoded.triangles.join() === '0,1,2,0,2,3');
  const idleTrack = decodeCosmeticTrack(m2.animations.Idle.tracks[0]);
  check('Format 2: Spur dekodiert (Keys, Quaternionen)', idleTrack.rot!.keys.join() === '0,24,47' && [...idleTrack.rot!.values.slice(4, 8)].join() === quatY(30).join() && idleTrack.move === null);
  const skin = mesh2('back');
  skin.mesh.joints = encodeUint8([0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  skin.mesh.weights = encodeUint8([200, 55, 0, 0, 128, 127, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]);
  check('Format 2: weiche Haut (joints/weights) erlaubt', decodeCosmeticMesh(parse2(skin).mesh).weights![1] === 55);
  rejects2('Format 2 beim Cape', (m) => (m.slot = 'cape'), /„slot“ muss eins von head, back, aura, companion sein/);
  rejects2('Textur keine Zweierpotenz', (m) => ((m.texture = png(24, 16)), delete m.glow, delete m.emissive), /„texture“ muss je eine Zweierpotenz von 16 bis 512/);
  rejects2('glow nicht texture.h × frames hoch', (m) => (m.glow = png(16, 16)), /„glow“ muss 16 × 64 Pixel groß sein/);
  rejects2('glow ohne emissive', (m) => delete m.emissive, /„emissive“ fehlt/);
  rejects2('Base64-Länge passt nicht zu vertexCount', (m) => (m.mesh.vertexCount = 5), /„mesh\.positions“ muss genau 15 Int16-Werte/);
  rejects2('Dreieck nennt Vertex ≥ N', (m) => (m.mesh.triangles = encodeUint16LE([0, 1, 2, 0, 2, 4])), /„mesh\.triangles“: Dreieck 1 nennt den Vertex 4/);
  rejects2('Vertex nennt unbekannten Knochen', (m) => (m.mesh.bones = encodeUint8([0, 0, 1, 2])), /„mesh\.bones“: Vertex 3 nennt den Knochen 2/);
  rejects2('weiche Haut: Gewichte nicht 255', (m) => Object.assign(m.mesh, { joints: encodeUint8(Array(16).fill(0)), weights: encodeUint8(Array(16).fill(1)) }), /ergeben 4 statt 255/);
  rejects2('Eltern-Knochen nach dem Kind', (m) => (m.bones[1].parent = 1), /„bones\[1\]\.parent“/);
  rejects2('Keys nicht ab 0', (m) => (m.animations.Idle.tracks[0].rot.keys = encodeUint16LE([1, 24, 47])), /muss mit Frame 0 beginnen/);
  rejects2('Keys nicht aufsteigend', (m) => (m.animations.Idle.tracks[0].rot.keys = encodeUint16LE([0, 30, 24])), /muss streng aufsteigen/);
  rejects2('Key hinter dem letzten Frame', (m) => (m.animations.Idle.tracks[0].rot.keys = encodeUint16LE([0, 24, 48])), /Frame 48 liegt nicht in der Animation/);
  rejects2('Quaternion nicht normiert', (m) => (m.animations.Idle.tracks[0].rot.values = encodeInt16LE([...quatY(0), ...quatY(30), 0, 0, 0, 30000])), /hat die Länge 0\.916/);
  rejects2('Zustand ohne Animation', (m) => (m.states.emote = 'Emote'), /„states\.emote“ muss der Name einer Animation sein/);
  rejects2('ohne idle', (m) => delete m.states.idle, /„states\.idle“ fehlt/);
  rejects2('unbekannter Partikel', (m) => (m.particles[0].particle = 'minecraft:explosion'), /ist kein erlaubter Partikel/);
  rejects2('17 Partikel', (m) => (m.particles = Array.from({ length: 17 }, () => ({ bone: 0, at: 'pivot', particle: 'flame', perSecond: 1 }))), /höchstens 16 Einträgen/);
  rejects2('attach außerhalb von companion', (m) => (m.attach = {}), /„attach“ gibt es nur beim Slot companion/);
  rejects2('unbekanntes Feld (Format 2)', (m) => (m.model = {}), /„model“ ist kein bekanntes Feld \(Format 2\)/);

  // ---------- Startsatz ----------
  // Zugriff: Team-Krone nur fürs Team, Freundesfunken und Freundesband als Belohnung für Einladungen, sonst alle
  const ACCESS: Record<string, string> = { 'team-krone': 'team', freundesfunken: 'unlock', freundesband: 'unlock' };
  // Aus Blender übernommen (npm run blender-import): 8 Flügel, 9 Begleiter (+3 Mochi-Fellfarben), 6 Auren
  const BLENDER = [
    'seraphfluegel', 'daemonenfluegel', 'morphofluegel', 'mechfluegel', 'lohenfluegel', 'amethystfaecher', 'abgrund-tentakel', 'farnwedel',
    'ember', 'wisp', 'bolt', 'mochi', 'mochi-tuxedo', 'mochi-silber', 'mochi-schnee', 'jelly', 'orbit', 'pip', 'lumi', 'sprout',
    'runenkreis', 'flammenkreis', 'eiskranz', 'leere-spirale', 'bluetensturm', 'gewitterwolke',
  ];
  const ids = await listCosmeticSources();
  const slots: Record<string, number> = {};
  const formats: Record<number, number> = {};
  for (const id of ids) {
    try {
      const built = await buildCosmetic(id, new Date().toISOString());
      const m = built.manifest;
      slots[m.slot] = (slots[m.slot] ?? 0) + 1;
      formats[m.format] = (formats[m.format] ?? 0) + 1;
      const envelope = cosmeticEnvelopeText({ manifest: built.text, signature: sign(null, cosmeticSignedBytes(built.text), privateKey).toString('base64') });
      const verified = verifyCosmeticEnvelope(envelope, publicKey);
      const size = Buffer.byteLength(envelope);
      const header = readPng(built.texture);
      if (typeof header === 'string') throw new Error(`texture.png ${header}`);
      const limit = verified.format === 2 ? COSMETIC_LIMITS_2.envelopeBytes : COSMETIC_LIMITS.envelopeBytes;
      let extra = true;
      if (verified.format === 2) {
        // Mesh und alle Spuren lassen sich dekodieren, Zustände zeigen auf Animationen, Begleiter haben attach
        const mesh = decodeCosmeticMesh(verified.mesh);
        for (const clip of Object.values(verified.animations)) for (const track of clip.tracks) decodeCosmeticTrack(track);
        extra = mesh.triangles.length === verified.mesh.triangleCount * 3 && Object.hasOwn(verified.animations, verified.states.idle)
          && (verified.slot === 'companion') === (verified.attach !== null) && verified.emissive !== null && BLENDER.includes(id);
      }
      check(`Start-Cosmetic ${id}: Format ${verified.format}, gültig, signiert, ${(size / 1024).toFixed(1)} KB, Textur ${header.width}×${header.height}`,
        verified.id === id && size <= limit && verified.access === (ACCESS[id] ?? 'all') && extra, { access: verified.access, size });
    } catch (error) {
      check(`Start-Cosmetic ${id}`, false, error);
    }
  }
  check('aus Blender: alle 26 vorhanden', BLENDER.every((id) => ids.includes(id)), BLENDER.filter((id) => !ids.includes(id)));
  check('Startsatz vollständig (45: 5 Kopf, 13 Rücken, 10 Partikel/Auren, 14 Begleiter, 3 Capes; 19 in Format 1, 26 in Format 2)',
    ids.length === 45 && slots.head === 5 && slots.back === 13 && slots.aura === 10 && slots.companion === 14 && slots.cape === 3 && formats[1] === 19 && formats[2] === 26,
    { slots, formats });

  finish('test:cosmetics');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
