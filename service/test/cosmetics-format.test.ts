// Format der Cosmetics (cosmetics-format.ts): gültige Manifeste je Slot mit Standardwerten, jede Grenze einzeln
// verletzt, PNG-Aufbau, Umschlag und dass die Datei eigenständig bleibt (Launcher und Webseite übernehmen sie).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { crc32 as zlibCrc32 } from 'node:zlib';
import {
  BUILTIN_CAPE_IDS,
  checkCosmeticEnvelope,
  checkCosmeticManifest,
  COSMETIC_ID_RE,
  COSMETIC_LIMITS,
  COSMETIC_MAX_MANIFEST_BYTES,
  COSMETIC_SLOTS,
  cosmeticEnvelopeText,
  crc32,
  decodeBase64,
  parseCosmeticManifest,
  readPng,
  utf8Length,
  type CosmeticManifest,
  type CosmeticSlot,
} from '../src/cosmetics-format';
import { DEFAULT_CAPES } from '../src/validate';
import { dataUrl, makePng, manifestOf, pngChunk, VALID } from './cosmetic-fixtures';

type Manifest = Record<string, any>;

function ok(manifest: unknown): CosmeticManifest {
  const result = checkCosmeticManifest(manifest);
  assert.equal(typeof result, 'object', `erwartet gültig, bekam: ${String(result)}`);
  return result as CosmeticManifest;
}

/** Erwartet einen Fehler, der `expected` enthält. */
function bad(manifest: unknown, expected: string): void {
  const result = checkCosmeticManifest(manifest);
  assert.equal(typeof result, 'string', `erwartet ungültig (${expected})`);
  assert.ok((result as string).includes(expected), `„${result as string}“ enthält nicht „${expected}“`);
}

/** Gültiges Manifest des Slots, von `change` verändert (tief kopiert). */
function changed(slot: CosmeticSlot, change: (m: Manifest) => void): Manifest {
  const m = structuredClone(VALID[slot]()) as Manifest;
  change(m);
  return m;
}

const SRC = path.join(__dirname, '..', '..', '..', 'src', 'cosmetics-format.ts');

describe('Cosmetic-Manifest (Format 1)', () => {
  test('gültig in jedem Slot, mit Standardwerten für fehlende freiwillige Felder', () => {
    const head = ok(VALID.head());
    assert.deepEqual(
      [head.id, head.slot, head.version, head.access, head.glow, head.particles, head.cape, head.companion, head.image],
      ['krone', 'head', 1, 'all', null, null, null, null, head.image],
    );
    assert.deepEqual([head.image.width, head.image.height], [64, 32]);
    assert.ok(head.image.bytes > 0);
    assert.deepEqual(head.model!.bones[1], {
      name: 'spitze',
      parent: 'base',
      pivot: [0, 2, 0],
      rotation: [0, 0, 0],
      cubes: [{ origin: [-1, 2, -1], size: [2, 3, 2], uv: [32, 0], inflate: 0, mirror: false }],
    });
    assert.equal(head.model!.bones[0]!.parent, null);
    assert.deepEqual(head.animations, [{ bone: 'spitze', type: 'spin', axis: 'y', amplitude: 0, speed: 0.5, phase: 0 }]);

    const back = ok(VALID.back());
    assert.equal(typeof back.glow, 'string');
    assert.equal(back.model!.bones.length, 3);
    assert.equal(back.model!.bones[2]!.cubes[0]!.mirror, true);
    assert.equal(back.animations.length, 2);

    const aura = ok(VALID.aura());
    assert.equal(aura.model, null);
    assert.deepEqual(aura.animations, []);
    assert.deepEqual(aura.particles, { frames: 4, rate: 6, lifetime: 30, size: 0.12, motion: 'rise', radius: 0.6, color: '#ffcc00', fullbright: true });
    assert.equal(ok(changed('aura', (m) => delete m.particles.fullbright)).particles!.fullbright, false);

    const companion = ok(VALID.companion());
    assert.deepEqual(companion.companion, { offset: [0.7, 1.6, -0.4], scale: 1 });
    assert.equal(companion.model!.bones[0]!.cubes[0]!.inflate, 0.25);

    const cape = ok(VALID.cape());
    assert.deepEqual(cape.cape, { frames: 4, fps: 8 });
    assert.deepEqual([cape.image.width, cape.image.height], [64, 128]);

    // Ohne Animationen, ohne glow, Beschreibung leer, Name mit Emoji (zählt als ein Zeichen)
    ok(manifestOf('head', { animations: undefined, description: '' }));
    ok(manifestOf('back', { glow: undefined, animations: [] }));
    ok(manifestOf('head', { name: '👑'.repeat(40), description: 'ä'.repeat(300) }));
    // Grenzfälle, die gerade noch gehen
    ok(manifestOf('head', { id: 'a', version: COSMETIC_LIMITS.versionMax, access: 'team', date: '2026-11-26' }));
    ok(manifestOf('head', { id: 'a'.repeat(32) }));
    ok(manifestOf('head', { id: 'team-krone-2' }));
    // Zeitpunkt mit Zeitzone
    ok(manifestOf('head', { date: '2026-11-26T12:00:00+01:00' }));
  });

  test('Kopf: type, format, Zusatzfelder, id, version, slot, Texte, access, date', () => {
    bad([], 'Das Manifest ist kein JSON-Objekt');
    bad(null, 'Das Manifest ist kein JSON-Objekt');
    bad(manifestOf('head', { type: 'heldix-addon' }), '„type“ muss „heldix-cosmetic“ sein');
    bad(manifestOf('head', { format: 3 }), '„format“ muss 1 oder 2 sein');
    bad(manifestOf('head', { format: '1' }), '„format“ muss 1 oder 2 sein');
    bad(manifestOf('head', { format: undefined }), '„format“ muss 1 oder 2 sein');
    // Format 2 hat andere Felder: ein Format-1-Manifest mit format 2 scheitert am ersten fremden Feld
    bad(manifestOf('head', { format: 2 }), '„model“ ist kein bekanntes Feld (Format 2)');
    bad(manifestOf('head', { extra: true }), '„extra“ ist kein bekanntes Feld');
    for (const id of ['Krone', '-krone', 'krone-', 'kro_ne', 'kro ne', '', 'a'.repeat(33), 'krone.', 5]) {
      bad(manifestOf('head', { id }), '„id“ ist ungültig');
    }
    // Eingebaute IDs mit „_“ (z. B. matrix_rot) scheitern schon am Muster, die übrigen an der Liste.
    for (const id of BUILTIN_CAPE_IDS) bad(manifestOf('cape', { id }), COSMETIC_ID_RE.test(id) ? 'eingebauten Capes' : '„id“ ist ungültig');
    for (const version of [0, -1, 1.5, '1', null, COSMETIC_LIMITS.versionMax + 1]) {
      bad(manifestOf('head', { version }), '„version“ muss eine ganze Zahl von 1 bis 2147483647 sein');
    }
    bad(manifestOf('head', { slot: 'hand' }), '„slot“ muss eins von head, back, aura, companion, cape sein');
    bad(manifestOf('head', { name: '' }), '„name“ darf nicht leer sein');
    bad(manifestOf('head', { name: '   ' }), '„name“ darf nicht leer sein');
    bad(manifestOf('head', { name: 'x'.repeat(41) }), '„name“ ist zu lang (höchstens 40 Zeichen)');
    bad(manifestOf('head', { name: 'Zwei\nZeilen' }), '„name“ enthält Zeichen, die nicht erlaubt sind');
    bad(manifestOf('head', { name: `Rück${String.fromCharCode(0x202e)}wärts` }), '„name“ enthält Zeichen, die nicht erlaubt sind');
    bad(manifestOf('head', { name: undefined }), '„name“ fehlt oder ist kein Text');
    bad(manifestOf('head', { description: 'x'.repeat(301) }), '„description“ ist zu lang (höchstens 300 Zeichen)');
    bad(manifestOf('head', { description: 'mit\tTab' }), '„description“ enthält Zeichen');
    bad(manifestOf('head', { description: undefined }), '„description“ fehlt');
    bad(manifestOf('head', { access: 'public' }), '„access“ muss eins von all, team, unlock sein');
    for (const date of ['2026-02-30', '26.11.2026', '2026-11-26T25:00:00Z', '', undefined]) {
      bad(manifestOf('head', { date }), '„date“ ist kein gültiges Datum');
    }
  });

  test('Texturen: data-URL, Base64, PNG-Aufbau, 64 KB, Größe je Slot, glow gleich groß', () => {
    bad(manifestOf('head', { texture: undefined }), '„texture“ fehlt');
    bad(manifestOf('head', { texture: 'https://example.com/krone.png' }), '„texture“ muss eine data-URL „data:image/png;base64,…“ sein');
    bad(manifestOf('head', { texture: `data:image/jpeg;base64,${makePng(64, 32).toString('base64')}` }), 'data-URL');
    bad(manifestOf('head', { texture: `DATA:image/png;base64,${makePng(64, 32).toString('base64')}` }), 'data-URL');
    bad(manifestOf('head', { texture: 'data:image/png;base64,' }), '„texture“ enthält kein gültiges Base64');
    bad(manifestOf('head', { texture: 'data:image/png;base64,iVBORw0KGgo' }), 'kein gültiges Base64');
    bad(manifestOf('head', { texture: 'data:image/png;base64,iVBO Rw0K' }), 'kein gültiges Base64');
    bad(manifestOf('head', { texture: dataUrl(Buffer.from('kein Bild, nur Text')) }), '„texture“ ist kein PNG (die PNG-Signatur fehlt)');
    // zu groß: zufällige Pixel lassen sich nicht komprimieren
    const huge = makePng(256, 256, { random: true });
    assert.ok(huge.length > COSMETIC_LIMITS.pngBytes);
    bad(manifestOf('head', { texture: dataUrl(huge), model: { ...(VALID.head().model as object), textureSize: [256, 256] } }), '„texture“ ist zu groß (höchstens 64 KB als PNG)');

    // Aufbau: abgeschnitten, Prüfsumme, Daten nach IEND, IHDR nicht zuerst, ungültiger Kopf, ohne IDAT
    const png = makePng(64, 32);
    bad(manifestOf('head', { texture: dataUrl(png.subarray(0, png.length - 12)) }), 'IEND fehlt am Ende');
    bad(manifestOf('head', { texture: dataUrl(png.subarray(0, png.length - 5)) }), 'abgeschnitten');
    const flipped = Buffer.from(png);
    flipped[50] = flipped[50]! ^ 0xff;
    bad(manifestOf('head', { texture: dataUrl(flipped) }), 'Prüfsumme von');
    bad(manifestOf('head', { texture: dataUrl(Buffer.concat([png, Buffer.from([0])])) }), 'hat Daten nach dem Ende (IEND)');
    const signature = png.subarray(0, 8);
    const ihdr = png.subarray(8, 33);
    const rest = png.subarray(33);
    bad(manifestOf('head', { texture: dataUrl(Buffer.concat([signature, pngChunk('tEXt', Buffer.from('a\0b')), ihdr, rest])) }), 'IHDR fehlt am Anfang');
    bad(manifestOf('head', { texture: dataUrl(Buffer.concat([signature, ihdr, ihdr, rest])) }), 'IHDR doppelt');
    bad(manifestOf('head', { texture: dataUrl(Buffer.concat([signature, ihdr, pngChunk('IEND', Buffer.alloc(0))])) }), 'keine Bilddaten (IDAT)');
    bad(manifestOf('head', { texture: dataUrl(makePng(64, 32, { colorType: 2, bitDepth: 4 })) }), 'ungültige Werte im Kopf');
    bad(manifestOf('head', { texture: dataUrl(makePng(64, 32, { colorType: 5 })) }), 'ungültige Werte im Kopf');
    bad(manifestOf('head', { texture: dataUrl(makePng(64, 32, { interlace: 2 })) }), 'ungültige Werte im Kopf');
    // Interlace (Adam7), 16 Bit, Graustufen und Palette sind gültige Köpfe
    ok(manifestOf('head', { texture: dataUrl(makePng(64, 32, { interlace: 1 })) }));
    ok(manifestOf('head', { texture: dataUrl(makePng(64, 32, { bitDepth: 16 })) }));
    ok(manifestOf('head', { texture: dataUrl(makePng(64, 32, { colorType: 3, bitDepth: 4 })) }));

    // Größe je Slot
    const head = (w: number, h: number) => manifestOf('head', { texture: dataUrl(makePng(w, h)), model: { ...(VALID.head().model as object), textureSize: [w, h] } });
    ok(head(64, 64));
    ok(head(64, 32 + 8));
    ok(head(256, 256));
    // bis 512 (z. B. 4-fache Auflösung 512 × 256), texture und glow gleich
    ok(head(512, 256));
    ok(head(512, 512));
    ok(manifestOf('back', { texture: dataUrl(makePng(512, 512)), glow: dataUrl(makePng(512, 512)), model: { ...(VALID.back().model as object), textureSize: [512, 512] } }));
    bad(head(60, 32), '„texture“ muss 8 bis 512 Pixel breit und hoch sein, jeweils ein Vielfaches von 8 (ist 60 × 32)');
    bad(head(520, 32), '„texture“ muss 8 bis 512 Pixel breit und hoch sein, jeweils ein Vielfaches von 8 (ist 520 × 32)');
    bad(head(64, 1024), 'ist 64 × 1024');
    bad(head(1024, 512), 'ist 1024 × 512');
    bad(head(64, 4), 'ist 64 × 4');
    // Cape: 64, 128 oder 256 breit, jedes Bild halb so hoch wie breit, Bilder untereinander; glow genauso groß
    const capeSize = '„texture“ muss für ein Cape mit 4 Bildern 64 × 128, 128 × 256 oder 256 × 512 Pixel groß sein (Breite 64, 128 oder 256, jedes Bild halb so hoch wie breit;';
    const cape = (w: number, h: number, frames = 4, glow = true) =>
      manifestOf('cape', { texture: dataUrl(makePng(w, h)), glow: glow ? dataUrl(makePng(w, h)) : undefined, cape: { frames, fps: 8 } });
    bad(cape(64, 100), `${capeSize} ist 64 × 100)`);
    for (const [w, h] of [
      [128, 128],
      [128, 200],
      [192, 384],
      [32, 64],
      [512, 1024],
      [256, 256],
    ] as const) {
      bad(cape(w, h, 4, false), `ist ${w} × ${h})`);
    }
    for (const [w, h, frames] of [
      [64, 128, 4],
      [128, 256, 4],
      [256, 512, 4],
      [64, 32, 1],
      [256, 128, 1],
      [64, 32 * 32, 32],
      [128, 64 * 32, 32],
      [256, 128 * 32, 32],
    ] as const) {
      const checked = ok(cape(w, h, frames));
      assert.deepEqual([checked.image.width, checked.image.height, checked.cape!.frames], [w, h, frames]);
      ok(cape(w, h, frames, false));
    }
    bad(manifestOf('cape', { texture: dataUrl(makePng(256, 512)), glow: dataUrl(makePng(128, 256)) }), '„glow“ muss genauso groß sein wie „texture“ (256 × 512; ist 128 × 256)');
    // Die 64 KB je PNG gelten auch für große Capes: Die Auflösung wählt, wer es baut
    bad(manifestOf('cape', { texture: dataUrl(makePng(256, 512, { random: true })), glow: undefined }), '„texture“ ist zu groß (höchstens 64 KB als PNG)');
    bad(manifestOf('aura', { texture: dataUrl(makePng(32, 16)) }), '„texture“ muss 4 quadratische Bilder nebeneinander enthalten (Breite = Höhe × 4; ist 32 × 16)');
    ok(changed('aura', (m) => {
      m.texture = dataUrl(makePng(16, 16));
      m.particles.frames = 1;
    }));

    // glow
    bad(manifestOf('back', { glow: dataUrl(makePng(32, 32)) }), '„glow“ muss genauso groß sein wie „texture“ (64 × 64; ist 32 × 32)');
    bad(manifestOf('back', { glow: dataUrl(Buffer.from('nein')) }), '„glow“ ist kein PNG');
    bad(manifestOf('back', { glow: null }), '„glow“ muss eine data-URL');
  });

  test('Slots: was Pflicht ist und was es nicht geben darf', () => {
    bad(manifestOf('head', { model: undefined }), '„model“ fehlt (Pflicht für den Slot head)');
    bad(manifestOf('back', { model: undefined }), '„model“ fehlt (Pflicht für den Slot back)');
    bad(manifestOf('companion', { model: undefined }), '„model“ fehlt (Pflicht für den Slot companion)');
    bad(manifestOf('aura', { particles: undefined }), '„particles“ fehlt (Pflicht für den Slot aura)');
    bad(manifestOf('cape', { cape: undefined }), '„cape“ fehlt (Pflicht für den Slot cape)');
    bad(manifestOf('companion', { companion: undefined }), '„companion“ fehlt (Pflicht für den Slot companion)');
    bad(manifestOf('head', { particles: VALID.aura().particles }), '„particles“ gibt es beim Slot head nicht');
    bad(manifestOf('head', { cape: { frames: 1, fps: 1 } }), '„cape“ gibt es beim Slot head nicht');
    bad(manifestOf('head', { companion: { offset: [0, 1, 0], scale: 1 } }), '„companion“ gibt es beim Slot head nicht');
    bad(manifestOf('aura', { model: VALID.head().model }), '„model“ gibt es beim Slot aura nicht');
    bad(manifestOf('cape', { model: VALID.head().model }), '„model“ gibt es beim Slot cape nicht');
    bad(manifestOf('aura', { animations: [] }), '„animations“ gibt es nur mit „model“ (nicht beim Slot aura)');
    bad(manifestOf('cape', { animations: [] }), '„animations“ gibt es nur mit „model“ (nicht beim Slot cape)');
    // null zählt als vorhanden
    bad(manifestOf('cape', { model: null }), '„model“ gibt es beim Slot cape nicht');
  });

  test('Modell: Bones, Eltern ohne Zyklen, Würfel, Koordinaten, UV in der Textur', () => {
    // ohne Animationen: die Tests ersetzen auch Bones, auf die sie zeigen
    const model = (change: (model: Manifest) => void) =>
      changed('head', (m) => {
        delete m.animations;
        change(m.model);
      });
    bad(manifestOf('head', { model: [] }), '„model“ muss ein JSON-Objekt sein');
    bad(model((m) => (m.extra = 1)), '„model.extra“ ist kein bekanntes Feld');
    const sizeError = '„model.textureSize“ muss die Größe der Textur in Texeln sein ([64, 32], [32, 16] oder [16, 8]: Textur in 1-, 2- oder 4-facher Auflösung)';
    assert.equal(checkCosmeticManifest(model((m) => (m.textureSize = [32, 32]))), sizeError);
    for (const size of [[64, 16], [128, 64], [21.333, 10.667], ['64', '32'], [64], [64, 32, 1], null]) bad(model((m) => (m.textureSize = size)), sizeError);
    bad(model((m) => delete m.textureSize), '„model.textureSize“ fehlt');
    // Textur in 2- oder 4-facher Auflösung: textureSize bleibt in Texeln, UV und Box-UV zählen darin
    const hires = (w: number, h: number, size: [number, number], change: (m: Manifest) => void = () => {}) =>
      changed('head', (m) => {
        delete m.animations;
        m.texture = dataUrl(makePng(w, h));
        m.model.textureSize = size;
        change(m.model);
      });
    assert.deepEqual(ok(hires(128, 64, [64, 32])).model!.textureSize, [64, 32]);
    assert.deepEqual(ok(hires(256, 128, [64, 32])).model!.textureSize, [64, 32]);
    const fourfold = ok(hires(512, 256, [128, 64]));
    assert.deepEqual([fourfold.model!.textureSize, fourfold.image.width, fourfold.image.height], [[128, 64], 512, 256]);
    ok(hires(256, 128, [64, 32], (m) => (m.bones[0].cubes[0].uv = [32, 22])));
    bad(hires(256, 128, [64, 32], (m) => (m.bones[0].cubes[0].uv = [33, 0])), '„model.bones[0].cubes[0].uv“: Die UV-Fläche (32 × 10 ab 33, 0) passt nicht in die Textur (64 × 32)');
    bad(hires(192, 96, [64, 32]), '„model.textureSize“ muss die Größe der Textur in Texeln sein ([192, 96], [96, 48] oder [48, 24]: Textur in 1-, 2- oder 4-facher Auflösung)');
    bad(hires(512, 512, [64, 64]), '([512, 512], [256, 256] oder [128, 128]:');
    bad(hires(256, 64, [64, 32]), '([256, 64], [128, 32] oder [64, 16]:');
    // glow gleich groß wie texture (also auch in derselben Auflösung)
    ok(changed('back', (m) => ((m.texture = dataUrl(makePng(256, 256))), (m.glow = dataUrl(makePng(256, 256))))));
    bad(changed('back', (m) => ((m.texture = dataUrl(makePng(256, 256))), (m.glow = dataUrl(makePng(64, 64))))), '„glow“ muss genauso groß sein wie „texture“ (256 × 256; ist 64 × 64)');
    bad(model((m) => (m.bones = [])), '„model.bones“ muss eine Liste mit 1 bis 64 Bones sein');
    bad(model((m) => (m.bones = {})), '„model.bones“ muss eine Liste');
    const bone = (name: string, cubes: unknown[] = []) => ({ name, pivot: [0, 0, 0], cubes });
    const cube = { origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] };
    assert.equal(ok(model((m) => (m.bones = [bone('a', [cube]), ...Array.from({ length: 63 }, (_, i) => bone(`b${i}`))]))).model!.bones.length, 64);
    bad(model((m) => (m.bones = [bone('a', [cube]), ...Array.from({ length: 64 }, (_, i) => bone(`b${i}`))])), '„model.bones“ muss eine Liste mit 1 bis 64 Bones sein');
    // Würfel bleiben bei höchstens 128, auch mit 64 Bones (2 je Bone)
    ok(model((m) => (m.bones = Array.from({ length: 64 }, (_, i) => bone(`b${i}`, [cube, cube])))));
    bad(model((m) => (m.bones = [...Array.from({ length: 63 }, (_, i) => bone(`b${i}`, [cube, cube])), bone('b63', [cube, cube, cube])])), '„model“ hat zu viele Würfel (höchstens 128 insgesamt)');
    // model.scale (freiwillig): Größe des ganzen Modells um den Anker, 0.25–1.5, fehlt: 1
    assert.equal(ok(VALID.head()).model!.scale, 1);
    assert.equal(ok(VALID.back()).model!.scale, 1);
    for (const scale of [0.25, 0.62, 1, 1.5]) assert.equal(ok(model((m) => (m.scale = scale))).model!.scale, scale);
    assert.equal(ok(changed('companion', (m) => (m.model.scale = 0.5))).model!.scale, 0.5);
    for (const scale of [0.2, 0.249, 1.51, 2, 0, -1, '1', null, [1], Number.NaN]) {
      bad(model((m) => (m.scale = scale)), '„model.scale“ muss eine Zahl von 0.25 bis 1.5 sein');
    }
    assert.equal(checkCosmeticManifest(model((m) => (m.scale = 1.6))), '„model.scale“ muss eine Zahl von 0.25 bis 1.5 sein');
    for (const name of ['Base', 'a'.repeat(25), '', 'bas-e', 7]) bad(model((m) => (m.bones[0].name = name)), '„model.bones[0].name“ ist ungültig (1–24 Zeichen aus a–z, 0–9 und _)');
    bad(model((m) => (m.bones[1].name = 'base')), '„model.bones[1].name“: Den Bone „base“ gibt es schon');
    // Eltern: nur vorher definierte (kein Vorwärtsverweis, kein Zyklus, nicht sich selbst)
    bad(model((m) => (m.bones[0].parent = 'spitze')), '„model.bones[0].parent“ muss der Name eines Bones sein, der vorher in der Liste steht');
    bad(model((m) => (m.bones[1].parent = 'spitze')), '„model.bones[1].parent“ muss der Name');
    bad(model((m) => (m.bones[1].parent = 'gibtsnicht')), 'vorher in der Liste steht');
    bad(model((m) => (m.bones[1].parent = null)), 'vorher in der Liste steht');
    bad(model((m) => (m.bones[0].extra = 1)), '„model.bones[0].extra“ ist kein bekanntes Feld');
    bad(model((m) => delete m.bones[0].pivot), '„model.bones[0].pivot“ fehlt');
    bad(model((m) => (m.bones[0].pivot = [0, 49, 0])), '„model.bones[0].pivot“ muss eine Liste aus drei Zahlen von -48 bis 48 sein');
    bad(model((m) => (m.bones[0].pivot = [0, 0])), '„model.bones[0].pivot“ muss eine Liste aus drei Zahlen');
    bad(model((m) => (m.bones[0].pivot = [0, '1', 0])), '„model.bones[0].pivot“ muss eine Liste aus drei Zahlen');
    bad(model((m) => (m.bones[0].rotation = [0, 181, 0])), '„model.bones[0].rotation“ muss eine Liste aus drei Zahlen von -180 bis 180 sein');
    ok(model((m) => (m.bones[0].rotation = [-180, 180, 22.5])));
    bad(model((m) => (m.bones[0].cubes = {})), '„model.bones[0].cubes“ muss eine Liste sein');
    bad(model((m) => delete m.bones[0].cubes), '„model.bones[0].cubes“ fehlt');
    // Würfel insgesamt
    ok(model((m) => (m.bones = [bone('a', Array.from({ length: 64 }, () => cube)), bone('b', Array.from({ length: 64 }, () => cube))])));
    bad(model((m) => (m.bones = [bone('a', Array.from({ length: 64 }, () => cube)), bone('b', Array.from({ length: 65 }, () => cube))])), '„model“ hat zu viele Würfel (höchstens 128 insgesamt)');
    bad(model((m) => (m.bones = [bone('a'), bone('b')])), '„model“ braucht mindestens einen Würfel');
    // ein Würfel
    const c = (change: (cube: Manifest) => void) => model((m) => change(m.bones[0].cubes[0]));
    bad(c((k) => (k.extra = 1)), '„model.bones[0].cubes[0].extra“ ist kein bekanntes Feld');
    bad(c((k) => delete k.origin), '„model.bones[0].cubes[0].origin“ fehlt');
    bad(c((k) => delete k.uv), '„model.bones[0].cubes[0].uv“ fehlt');
    bad(c((k) => (k.size = [33, 1, 1])), '„model.bones[0].cubes[0].size“ muss eine Liste aus drei Zahlen von 0 bis 32 sein');
    bad(c((k) => (k.size = [-1, 1, 1])), 'von 0 bis 32');
    bad(c((k) => (k.size = [0, 0, 0])), '„model.bones[0].cubes[0].size“: mindestens eine Kante muss größer als 0 sein');
    ok(c((k) => (k.size = [8, 0, 8])));
    bad(c((k) => (k.origin = [-49, 0, 0])), '„model.bones[0].cubes[0].origin“ muss eine Liste aus drei Zahlen von -48 bis 48 sein');
    bad(c((k) => ((k.origin = [40, 0, 0]), (k.size = [10, 1, 1]), (k.uv = [0, 0]))), '„model.bones[0].cubes[0]“ reicht weiter als 48 Pixel vom Anker (x von 40 bis 50)');
    bad(c((k) => ((k.origin = [0, 46, 0]), (k.size = [1, 2, 1]), (k.inflate = 1))), 'reicht weiter als 48 Pixel vom Anker (y von 45 bis 49)');
    ok(c((k) => ((k.origin = [-48, 40, -48]), (k.size = [1, 8, 1]))));
    bad(c((k) => (k.inflate = 2.5)), '„model.bones[0].cubes[0].inflate“ muss eine Zahl von 0 bis 2 sein');
    bad(c((k) => (k.inflate = -0.1)), 'inflate“ muss eine Zahl von 0 bis 2');
    bad(c((k) => (k.mirror = 'ja')), '„model.bones[0].cubes[0].mirror“ muss true oder false sein');
    for (const uv of [[-1, 0], [0.5, 0], [0], [0, 0, 0], '0,0']) bad(c((k) => (k.uv = uv)), '„model.bones[0].cubes[0].uv“ muss eine Liste aus zwei ganzen Zahlen ab 0 sein');
    // Box-UV: (2d + 2w) × (d + h) = 32 × 10 bei 8 × 2 × 8
    ok(c((k) => (k.uv = [32, 22])));
    bad(c((k) => (k.uv = [33, 0])), '„model.bones[0].cubes[0].uv“: Die UV-Fläche (32 × 10 ab 33, 0) passt nicht in die Textur (64 × 32)');
    bad(c((k) => (k.uv = [0, 23])), 'Die UV-Fläche (32 × 10 ab 0, 23) passt nicht in die Textur (64 × 32)');
  });

  test('Animationen: höchstens 16, Bone im Modell, Art, Achse, Ausschlag, Tempo, Phase', () => {
    const anim = (change: (a: Manifest) => void) => changed('back', (m) => change(m.animations[0]));
    bad(manifestOf('back', { animations: {} }), '„animations“ muss eine Liste mit höchstens 16 Einträgen sein');
    const flap = { bone: 'fluegel_links', type: 'flap', axis: 'y', amplitude: 25, speed: 1 };
    ok(manifestOf('back', { animations: Array.from({ length: 16 }, () => flap) }));
    bad(manifestOf('back', { animations: Array.from({ length: 17 }, () => flap) }), 'höchstens 16 Einträgen');
    bad(anim((a) => (a.bone = 'schwanz')), '„animations[0].bone“ muss der Name eines Bones im Modell sein');
    bad(anim((a) => delete a.bone), '„animations[0].bone“ fehlt');
    bad(anim((a) => (a.type = 'wobble')), '„animations[0].type“ muss eins von flap, sway, spin, bob sein');
    bad(anim((a) => (a.axis = 'w')), '„animations[0].axis“ muss eins von x, y, z sein');
    bad(anim((a) => (a.amplitude = 91)), '„animations[0].amplitude“ muss eine Zahl von 0 bis 90 sein');
    bad(anim((a) => delete a.amplitude), '„animations[0].amplitude“ fehlt');
    bad(anim((a) => ((a.type = 'bob'), (a.amplitude = 9))), '„animations[0].amplitude“ muss eine Zahl von 0 bis 8 sein');
    ok(anim((a) => ((a.type = 'bob'), (a.amplitude = 8))));
    ok(anim((a) => ((a.type = 'sway'), (a.amplitude = 90))));
    // spin: amplitude darf fehlen, wenn vorhanden gelten 0–90
    ok(anim((a) => ((a.type = 'spin'), delete a.amplitude)));
    bad(anim((a) => ((a.type = 'spin'), (a.amplitude = 120))), 'von 0 bis 90');
    bad(anim((a) => (a.speed = 4.5)), '„animations[0].speed“ muss eine Zahl von 0 bis 4 sein');
    bad(anim((a) => delete a.speed), '„animations[0].speed“ fehlt');
    bad(anim((a) => (a.phase = 1.5)), '„animations[0].phase“ muss eine Zahl von 0 bis 1 sein');
    bad(anim((a) => (a.extra = 1)), '„animations[0].extra“ ist kein bekanntes Feld');
    bad(manifestOf('back', { animations: [1] }), '„animations[0]“ muss ein JSON-Objekt sein');
  });

  test('Partikel, Cape und Begleiter: alle Grenzen', () => {
    const p = (change: (particles: Manifest) => void) => changed('aura', (m) => change(m.particles));
    bad(manifestOf('aura', { particles: 5 }), '„particles“ muss ein JSON-Objekt sein');
    bad(p((x) => (x.extra = 1)), '„particles.extra“ ist kein bekanntes Feld');
    bad(p((x) => delete x.rate), '„particles.rate“ fehlt');
    bad(p((x) => (x.frames = 9)), '„particles.frames“ muss eine ganze Zahl von 1 bis 8 sein');
    bad(p((x) => (x.frames = 0)), 'von 1 bis 8');
    for (const rate of [0, 21, 1.5]) bad(p((x) => (x.rate = rate)), '„particles.rate“ muss eine ganze Zahl von 1 bis 20 sein');
    for (const lifetime of [4, 81]) bad(p((x) => (x.lifetime = lifetime)), '„particles.lifetime“ muss eine ganze Zahl von 5 bis 80 sein');
    for (const size of [0.02, 0.41]) bad(p((x) => (x.size = size)), '„particles.size“ muss eine Zahl von 0.03 bis 0.4 sein');
    bad(p((x) => (x.motion = 'spiral')), '„particles.motion“ muss eins von rise, fall, orbit, spark, float sein');
    for (const radius of [0.1, 1.6]) bad(p((x) => (x.radius = radius)), '„particles.radius“ muss eine Zahl von 0.2 bis 1.5 sein');
    for (const color of ['red', '#fff', 'ffcc00', '#ffcc0g']) bad(p((x) => (x.color = color)), '„particles.color“ muss eine Farbe wie #ffcc00 sein');
    ok(p((x) => (x.color = '#FFCC00')));
    bad(p((x) => (x.fullbright = 1)), '„particles.fullbright“ muss true oder false sein');
    for (const [key, value] of [
      ['rate', 20],
      ['lifetime', 5],
      ['size', 0.4],
      ['radius', 0.2],
      ['motion', 'orbit'],
    ] as const) {
      ok(p((x) => (x[key] = value)));
    }

    const cape = (frames: unknown, fps: unknown) => manifestOf('cape', { cape: { frames, fps } });
    bad(cape(0, 8), '„cape.frames“ muss eine ganze Zahl von 1 bis 32 sein');
    bad(cape(33, 8), '„cape.frames“ muss eine ganze Zahl von 1 bis 32 sein');
    bad(cape(4, 0), '„cape.fps“ muss eine ganze Zahl von 1 bis 20 sein');
    bad(cape(4, 21), '„cape.fps“ muss eine ganze Zahl von 1 bis 20 sein');
    bad(cape(4, 2.5), '„cape.fps“');
    bad(manifestOf('cape', { cape: { frames: 4, fps: 8, loop: true } }), '„cape.loop“ ist kein bekanntes Feld');

    const comp = (companion: unknown) => manifestOf('companion', { companion });
    const range = '„companion.offset“ muss eine Liste aus drei Zahlen sein (x von -2 bis 2, y von 0 bis 3, z von -2 bis 2)';
    bad(comp({ offset: [2.5, 1, 0], scale: 1 }), range);
    bad(comp({ offset: [0, -0.1, 0], scale: 1 }), range);
    bad(comp({ offset: [0, 3.1, 0], scale: 1 }), range);
    bad(comp({ offset: [0, 1, -2.1], scale: 1 }), range);
    ok(comp({ offset: [-2, 0, 2], scale: 0.25 }));
    ok(comp({ offset: [2, 3, -2], scale: 1.5 }));
    bad(comp({ offset: [0, 1, 0], scale: 0.2 }), '„companion.scale“ muss eine Zahl von 0.25 bis 1.5 sein');
    bad(comp({ offset: [0, 1, 0], scale: 1.6 }), '„companion.scale“');
    bad(comp({ offset: [0, 1, 0] }), '„companion.scale“ fehlt');
    bad(comp({ offset: [0, 1, 0], scale: 1, extra: 0 }), '„companion.extra“ ist kein bekanntes Feld');
  });

  test('Umschlag: Form, Größe (Obergrenze aller Formate: 512 KB / 544 KB), kanonische Signatur', () => {
    const sig = Buffer.alloc(64, 7).toString('base64');
    assert.equal(sig.length, 88);
    assert.deepEqual(checkCosmeticEnvelope({ manifest: '{}', signature: sig, extra: 1 }), { manifest: '{}', signature: sig });
    assert.equal(checkCosmeticEnvelope(null), 'Der Umschlag ist kein JSON-Objekt');
    assert.equal(checkCosmeticEnvelope([]), 'Der Umschlag ist kein JSON-Objekt');
    assert.equal(checkCosmeticEnvelope({ signature: sig }), '„manifest“ fehlt oder ist kein Text');
    assert.equal(checkCosmeticEnvelope({ manifest: {}, signature: sig }), '„manifest“ fehlt oder ist kein Text');
    assert.equal(checkCosmeticEnvelope({ manifest: '{}' }), '„signature“ fehlt oder ist kein Text');
    for (const bad of ['abc', sig.slice(0, -2), `${sig.slice(0, 85)}B==`, `${sig}=`, ` ${sig.slice(1)}`]) {
      assert.equal(checkCosmeticEnvelope({ manifest: '{}', signature: bad }), '„signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen)', bad);
    }
    assert.equal(checkCosmeticEnvelope({ manifest: `{"a":"${String.fromCharCode(0xd800)}"}`, signature: sig }), '„manifest“ enthält ungültige Zeichen');
    // Das Format steht erst im Manifest: Der Umschlag prüft die größte Grenze (Format 2), parseCosmeticManifest die
    // des Formats (Format 1: 160 KB / 192 KB, siehe cosmetics-format2.test.ts)
    const max = 'a'.repeat(COSMETIC_MAX_MANIFEST_BYTES);
    assert.equal(typeof checkCosmeticEnvelope({ manifest: max, signature: sig }), 'object');
    assert.equal(checkCosmeticEnvelope({ manifest: `${max}a`, signature: sig }), '„manifest“ ist zu groß (höchstens 512 KB)');
    // Mehrbyte-Zeichen zählen nach UTF-8
    assert.equal(checkCosmeticEnvelope({ manifest: 'ä'.repeat(COSMETIC_MAX_MANIFEST_BYTES / 2 + 1), signature: sig }), '„manifest“ ist zu groß (höchstens 512 KB)');
    // Anführungszeichen verdoppeln sich im ausgelieferten Umschlag: dann zählt die Grenze von 544 KB
    const quotes = '"'.repeat(300 * 1024);
    assert.equal(checkCosmeticEnvelope({ manifest: quotes, signature: sig }), 'Der Umschlag ist zu groß (höchstens 544 KB)');
    // Format 1 bleibt bei 160 KB Manifest
    const padded = `${JSON.stringify(VALID.head()).slice(0, -1)}${' '.repeat(COSMETIC_LIMITS.manifestBytes)}}`;
    assert.equal(parseCosmeticManifest(padded), '„manifest“ ist zu groß (höchstens 160 KB bei Format 1)');
    assert.equal(cosmeticEnvelopeText({ manifest: 'm', signature: 's' }), '{"manifest":"m","signature":"s"}');
    assert.deepEqual([utf8Length('a'), utf8Length('ä'), utf8Length('€'), utf8Length('👑'), utf8Length('')], [1, 2, 3, 4, 0]);
    assert.equal(parseCosmeticManifest('{'), '„manifest“ ist kein gültiges JSON');
    assert.equal(parseCosmeticManifest('[]'), 'Das Manifest ist kein JSON-Objekt');
    assert.equal(typeof parseCosmeticManifest(JSON.stringify(VALID.cape())), 'object');
  });

  test('Bausteine: CRC-32 wie zlib, strenges Base64, PNG-Kopf', () => {
    for (const size of [0, 1, 13, 1000, 70_000]) {
      const data = randomBytes(size);
      assert.equal(crc32(data), zlibCrc32(data) >>> 0, `Länge ${size}`);
    }
    assert.deepEqual(decodeBase64('YQ=='), new Uint8Array([97]));
    assert.deepEqual(decodeBase64('YWJj'), new Uint8Array([97, 98, 99]));
    for (const text of ['', 'YQ', 'YQ=', 'Y Q==', 'YQ==YQ==', 'Y-_=', '====']) assert.equal(decodeBase64(text), null, text);
    assert.deepEqual(readPng(makePng(24, 16)), { width: 24, height: 16 });
    assert.equal(readPng(new Uint8Array([1, 2, 3])), 'ist kein PNG (die PNG-Signatur fehlt)');
    assert.equal(COSMETIC_SLOTS.length, 5);
  });

  test('eigenständig: keine Importe, kein Buffer; eingebaute Capes wie im Dienst', () => {
    const source = fs.readFileSync(SRC, 'utf8');
    assert.equal(/^\s*import\s/m.test(source), false, 'cosmetics-format.ts importiert nichts');
    assert.equal(/\brequire\(/.test(source), false);
    assert.equal(/\bBuffer\s*[.(]/.test(source), false, 'kein Node-Buffer (läuft auch im Browser)');
    assert.deepEqual([...BUILTIN_CAPE_IDS], [...DEFAULT_CAPES]);
  });
});
