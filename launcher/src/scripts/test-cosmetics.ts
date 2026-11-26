// Prüft das Cosmetic-Format (core/cosmetics-format.ts = Kopie von service/src/cosmetics-format.ts, core/cosmetics.ts)
// und den Startsatz unter cosmetics/: Kopie gleich dem Dienst, gültige Beispiele je Slot, jede Grenze einzeln verletzt,
// Umschlag und Signatur (falsches Präfix, fremder Schlüssel, verändertes Manifest), Bedeutung von Box-UV/Animationen
// und dass jedes Start-Cosmetic gebaut und signiert werden kann. Signiert wird mit einem Test-Schlüssel – der echte
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
  COSMETIC_SIGNATURE_PREFIX,
  cosmeticEnvelopeText,
  readPng,
  type CosmeticManifest,
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

function simpleModel(textureSize: [number, number] = [64, 32]): CosmeticModel {
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

/** Prüft ein Manifest-Objekt; liefert das Manifest oder wirft mit der (ersten) Fehlermeldung. */
function parse(manifest: unknown): CosmeticManifest {
  const result = checkCosmeticManifest(manifest);
  if (typeof result === 'string') throw new Error(result);
  return result;
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
  check('Standardwerte ergänzt (parent, rotation, inflate, mirror, phase, amplitude bei spin)',
    head.model!.bones[1].parent === 'base' && head.model!.bones[1].rotation.join() === '0,0,0' && head.model!.bones[1].cubes[0].inflate === 0
      && head.model!.bones[1].cubes[0].mirror === false && head.animations[0].phase === 0 && head.animations[0].amplitude === 0 && head.glow === null);
  check('Texturmaße aus dem PNG-Kopf', head.image.width === 64 && head.image.height === 32);

  // ---------- Grenzen genau erreicht ----------
  accepts('Name mit 40 Zeichen', 'head', (m) => (m.name = 'Ä'.repeat(40)));
  accepts('Beschreibung leer', 'head', (m) => (m.description = ''));
  accepts('Beschreibung mit 300 Zeichen', 'head', (m) => (m.description = 'x'.repeat(300)));
  accepts('ID mit 32 Zeichen', 'head', (m) => (m.id = 'a'.repeat(32)));
  accepts('access team', 'head', (m) => (m.access = 'team'));
  accepts('version 2^31 − 1', 'head', (m) => (m.version = 2147483647));
  accepts('32 Bones, 128 Würfel, 16 Animationen', 'head', (m) => {
    m.texture = png(256, 256);
    m.model = { textureSize: [256, 256], bones: Array.from({ length: 32 }, (_, i) => ({ name: `b${i}`, pivot: [0, 0, 0], cubes: Array.from({ length: 4 }, () => ({ origin: [-48, -48, -48], size: [1, 1, 1], uv: [252, 254] })) })) };
    m.animations = Array.from({ length: 16 }, (_, i) => ({ bone: `b${i}`, type: 'flap', axis: 'x', amplitude: 90, speed: 4, phase: 1 }));
  });
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
  rejects('format 2', 'head', (m) => (m.format = 2), /„format“/);
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
  rejects('texture 12 px breit', 'head', (m) => ((m.texture = png(12, 16)), (m.model.textureSize = [12, 16])), /„texture“ muss 8 bis 256/);
  rejects('texture 264 px breit', 'head', (m) => ((m.texture = png(264, 16)), (m.model.textureSize = [264, 16])), /„texture“ muss 8 bis 256/);
  rejects('texture kleiner als 8 px', 'aura', (m) => (m.texture = png(16, 4)), /„texture“ muss 8 bis 256/);
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
  rejects('textureSize passt nicht zur Textur', 'head', (m) => (m.model.textureSize = [64, 64]), /„model\.textureSize“/);
  rejects('keine Bones', 'head', (m) => (m.model.bones = []), /„model\.bones“ muss eine Liste mit 1 bis 32/);
  rejects('33 Bones', 'head', (m) => (m.model.bones = Array.from({ length: 33 }, (_, i) => ({ name: `b${i}`, pivot: [0, 0, 0], cubes: i ? [] : [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }))), /„model\.bones“ muss eine Liste mit 1 bis 32/);
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
  const big = { manifest: 'x'.repeat(COSMETIC_LIMITS.manifestBytes), signature: JSON.parse(validEnvelope).signature };
  check('Manifest-Text über 160 KB im Umschlag abgelehnt', typeof checkCosmeticEnvelope({ ...big, manifest: big.manifest + 'x' }) === 'string');
  check('Umschlag über 192 KB abgelehnt', /Umschlag ist zu groß/.test(String(checkCosmeticEnvelope({ manifest: '"'.repeat(COSMETIC_LIMITS.manifestBytes), signature: big.signature }))));
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
  const rot = cosmeticBoneMatrices({ textureSize: [64, 32], bones: [{ name: 'a', parent: null, pivot: [0, 0, 0], rotation: [0, 90, 0], cubes: [] }] }).get('a')!;
  const turned = mat4Apply(rot, [1, 0, 0]);
  check('Drehung um +Y (rechte Hand): +X → -Z', Math.abs(turned[0]) < 1e-9 && Math.abs(turned[2] + 1) < 1e-9);
  const chain = cosmeticBoneMatrices({
    textureSize: [64, 32],
    bones: [
      { name: 'a', parent: null, pivot: [0, 0, 0], rotation: [0, 0, 90], cubes: [] },
      { name: 'b', parent: 'a', pivot: [4, 0, 0], rotation: [0, 0, 90], cubes: [] },
    ],
  }).get('b')!;
  const tip = mat4Apply(chain, [8, 0, 0]);
  check('Bones erben die Lage der Eltern (Pivots absolut)', Math.abs(tip[0] + 4) < 1e-9 && Math.abs(tip[1] - 4) < 1e-9);

  // ---------- Startsatz ----------
  const ids = await listCosmeticSources();
  const slots: Record<string, number> = {};
  for (const id of ids) {
    try {
      const built = await buildCosmetic(id, new Date().toISOString());
      const m = built.manifest;
      slots[m.slot] = (slots[m.slot] ?? 0) + 1;
      const envelope = cosmeticEnvelopeText({ manifest: built.text, signature: sign(null, cosmeticSignedBytes(built.text), privateKey).toString('base64') });
      const verified = verifyCosmeticEnvelope(envelope, publicKey);
      const size = Buffer.byteLength(envelope);
      const header = readPng(built.texture);
      if (typeof header === 'string') throw new Error(`texture.png ${header}`);
      check(`Start-Cosmetic ${id}: gültig, signiert, ${(size / 1024).toFixed(1)} KB, Textur ${header.width}×${header.height}`,
        verified.id === id && size <= COSMETIC_LIMITS.envelopeBytes && verified.access === (id === 'team-krone' ? 'team' : 'all'));
    } catch (error) {
      check(`Start-Cosmetic ${id}`, false, error);
    }
  }
  check('Startsatz vollständig (5 Kopf, 3 Rücken, 3 Partikel, 2 Begleiter, 2 Capes)',
    slots.head === 5 && slots.back === 3 && slots.aura === 3 && slots.companion === 2 && slots.cape === 2, slots);

  finish('test:cosmetics');
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
