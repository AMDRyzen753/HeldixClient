// Format 2 der Cosmetics (Mesh mit Keyframe-Animationen): gültige Manifeste je Slot, Dekodier-Hilfen, jede Regel
// einzeln verletzt (Texturen, Mesh, weiche Haut, Knochen, Animationen, Zustände, Partikel, Anbringen) und die
// Größengrenzen je Format (Format 1 bleibt bei 160 KB / 192 KB).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checkCosmeticEnvelope,
  checkCosmeticManifest,
  COSMETIC_LIMITS,
  COSMETIC_LIMITS_2,
  COSMETIC_MAX_ENVELOPE_BYTES,
  COSMETIC_MAX_MANIFEST_BYTES,
  COSMETIC_PARTICLE_IDS,
  cosmeticEnvelopeLength,
  cosmeticEnvelopeText,
  decodeCosmeticMesh,
  decodeCosmeticTrack,
  decodeInt16LE,
  decodeInt8,
  decodeUint16LE,
  encodeBase64,
  encodeInt16LE,
  encodeInt8,
  encodeUint16LE,
  encodeUint8,
  parseCosmeticManifest,
  utf8Length,
  type CosmeticManifest2,
} from '../src/cosmetics-format';
import { dataUrl, makePng, quatY, valid2, VALID } from './cosmetic-fixtures';

type Manifest = Record<string, any>;

function ok(manifest: unknown): CosmeticManifest2 {
  const result = checkCosmeticManifest(manifest);
  assert.equal(typeof result, 'object', `erwartet gültig, bekam: ${String(result)}`);
  assert.equal((result as CosmeticManifest2).format, 2);
  return result as CosmeticManifest2;
}

/** Erwartet einen Fehler, der `expected` enthält. */
function bad(manifest: unknown, expected: string): void {
  const result = checkCosmeticManifest(manifest);
  assert.equal(typeof result, 'string', `erwartet ungültig (${expected})`);
  assert.ok((result as string).includes(expected), `„${result as string}“ enthält nicht „${expected}“`);
}

/** Gültiges Manifest (back), von `change` verändert (tief kopiert). */
function changed(change: (m: Manifest) => void, slot: 'head' | 'back' | 'aura' | 'companion' = 'back'): Manifest {
  const m = structuredClone(valid2(slot)) as Manifest;
  change(m);
  return m;
}

const keys = (...frames: number[]) => encodeUint16LE(frames);

describe('Cosmetic-Manifest (Format 2)', () => {
  test('gültig in jedem Slot außer Cape, mit Standardwerten', () => {
    const back = ok(valid2('back'));
    assert.deepEqual([back.id, back.slot, back.version, back.access, back.attach], ['mesh-back', 'back', 1, 'all', null]);
    assert.deepEqual([back.image.width, back.image.height], [16, 16]);
    assert.deepEqual(back.emissive, { frames: 4, frametimeTicks: 2, pulse: { period: 2, min: 0.5, max: 1 } });
    assert.equal(typeof back.glow, 'string');
    assert.deepEqual([back.mesh.vertexCount, back.mesh.triangleCount, back.mesh.joints, back.mesh.weights], [4, 2, null, null]);
    assert.deepEqual(back.bones[1], { name: 'wing.L', parent: 0, pivot: [4, 0, 2], tail: [4, 8, 2] });
    assert.deepEqual(Object.keys(back.animations), ['Idle', 'Hurt']);
    assert.deepEqual([back.animations.Idle!.fps, back.animations.Idle!.frames, back.animations.Idle!.loop], [24, 48, true]);
    assert.equal(back.animations.Idle!.tracks[0]!.rot!.count, 3);
    assert.equal(back.animations.Idle!.tracks[0]!.move, null);
    assert.deepEqual(back.states, { blendSeconds: 0.25, idle: 'Idle', hurt: 'Hurt' });
    // „minecraft:“ fällt weg, color nur bei dust, states null = immer
    assert.deepEqual(back.particles, [
      { bone: 1, at: 'tail', particle: 'dust', color: '#ffcc00', perSecond: 2, states: ['Idle'] },
      { bone: 0, at: 'pivot', particle: 'end_rod', color: null, perSecond: 0.5, states: null },
    ]);
    // Begleiter: attach mit Standardwerten, auch ohne Angabe
    assert.deepEqual(ok(valid2('companion')).attach, { origin: [14, -6, 1], side: 'left' });
    assert.deepEqual(ok(changed((m) => delete m.attach, 'companion')).attach, { origin: [0, 0, 0], side: 'left' });
    assert.deepEqual(ok(changed((m) => (m.attach = { side: 'right' }), 'companion')).attach, { origin: [0, 0, 0], side: 'right' });
    for (const slot of ['head', 'aura'] as const) assert.equal(ok(valid2(slot)).slot, slot);
    // ohne glow/emissive, ohne Partikel, leere Spurliste (Standpose), Animation „__proto__“ als eigenes Feld
    const plain = ok(changed((m) => {
      delete m.glow;
      delete m.emissive;
      delete m.particles;
      m.animations.Idle.tracks = [];
    }));
    assert.deepEqual([plain.glow, plain.emissive, plain.particles], [null, null, []]);
    const proto = ok(JSON.parse(JSON.stringify(valid2()).replace('"Hurt"', '"__proto__"').replace('"hurt":"Hurt"', '"hurt":"__proto__"')));
    assert.ok(Object.hasOwn(proto.animations, '__proto__'));
    // Grenzfälle, die gerade noch gehen
    ok(changed((m) => (m.texture = dataUrl(makePng(512, 16))) && (m.glow = dataUrl(makePng(512, 64)))));
    ok(changed((m) => (m.emissive.frames = 16) && (m.glow = dataUrl(makePng(16, 256)))));
    ok(changed((m) => (m.emissive.pulse = { period: 0.1, min: 1, max: 1 })));
    ok(changed((m) => (m.states.blendSeconds = 0)));
    ok(changed((m) => (m.bones[1].name = 'A'.repeat(32))));
    ok(changed((m) => (m.bones[0].pivot = [-1024, 1024, 0])));
    ok(changed((m) => (m.particles[0].perSecond = 20)));
    ok(changed((m) => (m.particles[1].perSecond = 0.1)));
    for (const particle of COSMETIC_PARTICLE_IDS) ok(changed((m) => (m.particles = [{ bone: 0, at: 'pivot', particle, perSecond: 1 }])));
    ok(changed((m) => (m.animations.Idle.fps = 60) && (m.animations.Idle.frames = 1200)));
  });

  test('Dekodier-Hilfen: Base64 ↔ Ganzzahl-Listen (little-endian), Mesh und Spuren', () => {
    assert.deepEqual([...decodeInt16LE(encodeInt16LE([-32768, -1, 0, 1, 32767]))!], [-32768, -1, 0, 1, 32767]);
    assert.deepEqual([...decodeUint16LE(encodeUint16LE([0, 1, 65535]))!], [0, 1, 65535]);
    assert.deepEqual([...decodeInt8(encodeInt8([-128, -1, 0, 127]))!], [-128, -1, 0, 127]);
    assert.equal(encodeInt16LE([1, -2]), encodeBase64(new Uint8Array([1, 0, 0xfe, 0xff])), 'little-endian');
    assert.equal(encodeUint8([1, 2, 3]), 'AQID');
    assert.equal(decodeUint16LE('AQ=='), null, 'ungerade Byte-Zahl');
    assert.equal(decodeInt16LE('kein base64!'), null);
    const big = new Uint8Array(100_000).map((_, i) => i * 7);
    assert.deepEqual(decodeUint16LE(encodeBase64(big))!.length, 50_000);

    const m = ok(valid2());
    const mesh = decodeCosmeticMesh(m.mesh);
    assert.deepEqual([...mesh.positions.slice(0, 6)], [0, 0, 64, 128, 0, 64]);
    assert.deepEqual([...mesh.normals.slice(0, 3)], [0, 0, 127]);
    assert.deepEqual([...mesh.bones], [0, 0, 1, 1]);
    assert.deepEqual([...mesh.triangles], [0, 1, 2, 0, 2, 3]);
    assert.equal(mesh.joints, null);
    const idle = decodeCosmeticTrack(m.animations.Idle!.tracks[0]!);
    assert.deepEqual([...idle.rot!.keys], [0, 24, 47]);
    assert.deepEqual([...idle.rot!.values.slice(4, 8)], quatY(30));
    const hurt = decodeCosmeticTrack(m.animations.Hurt!.tracks[0]!);
    assert.deepEqual([[...hurt.move!.values], [...hurt.scale!.values], hurt.rot], [[0, 0, 0, 0, -32, 0], [1000], null]);
  });

  test('Kopf und Texturen: format, Felder, Slot, Zweierpotenzen, glow = Streifen mit emissive', () => {
    bad(changed((m) => (m.format = 3)), '„format“ muss 1 oder 2 sein');
    bad(changed((m) => (m.model = {})), '„model“ ist kein bekanntes Feld (Format 2)');
    bad(changed((m) => (m.slot = 'cape')), '„slot“ muss eins von head, back, aura, companion sein');
    bad(changed((m) => (m.id = 'Mesh')), '„id“ ist ungültig');
    bad(changed((m) => (m.name = '')), '„name“ darf nicht leer sein');
    bad(changed((m) => (m.access = 'public')), '„access“ muss eins von all, team, unlock sein');
    bad(changed((m) => delete m.texture), '„texture“ fehlt');
    bad(changed((m) => (m.texture = 'kein png')), '„texture“ muss eine data-URL');
    for (const [w, h] of [[24, 16], [8, 8], [1024, 16], [16, 48]]) {
      bad(changed((m) => (m.texture = dataUrl(makePng(w!, h!)))), `„texture“ muss je eine Zweierpotenz von 16 bis 512 Pixel breit und hoch sein (ist ${w} × ${h})`);
    }
    bad(changed((m) => (m.texture = dataUrl(makePng(256, 256, { random: true })))), '„texture“ ist zu groß (höchstens 64 KB als PNG)');
    bad(changed((m) => delete m.emissive), '„emissive“ fehlt (Pflicht mit „glow“)');
    bad(changed((m) => delete m.glow), '„glow“ fehlt (Pflicht mit „emissive“)');
    bad(changed((m) => (m.glow = dataUrl(makePng(16, 16)))), '„glow“ muss 16 × 64 Pixel groß sein');
    bad(changed((m) => (m.glow = dataUrl(makePng(32, 64)))), 'ist 32 × 64');
    bad(changed((m) => (m.emissive.frames = 0)), '„emissive.frames“ muss eine ganze Zahl von 1 bis 16 sein');
    bad(changed((m) => (m.emissive.frames = 17)), '„emissive.frames“ muss eine ganze Zahl von 1 bis 16 sein');
    bad(changed((m) => (m.emissive.frametimeTicks = 21)), '„emissive.frametimeTicks“ muss eine ganze Zahl von 1 bis 20 sein');
    bad(changed((m) => delete m.emissive.pulse), '„emissive.pulse“ fehlt');
    bad(changed((m) => (m.emissive.pulse.period = 0.05)), '„emissive.pulse.period“ muss eine Zahl von 0.1 bis 20 sein');
    bad(changed((m) => (m.emissive.pulse.max = 1.5)), '„emissive.pulse.max“ muss eine Zahl von 0 bis 1 sein');
    bad(changed((m) => (m.emissive.pulse = { period: 1, min: 0.8, max: 0.5 })), '„emissive.pulse.min“ darf nicht größer sein als „emissive.pulse.max“');
    bad(changed((m) => (m.emissive.extra = 1)), '„emissive.extra“ ist kein bekanntes Feld (Format 2)');
  });

  test('Mesh: Längen passend zu N und T, gültiges Base64, Indizes und Knochen im Bereich', () => {
    for (const key of ['vertexCount', 'triangleCount', 'positions', 'normals', 'uvs', 'bones', 'triangles']) {
      bad(changed((m) => delete m.mesh[key]), `„mesh.${key}“ fehlt`);
    }
    bad(changed((m) => (m.mesh.vertexCount = 0)), '„mesh.vertexCount“ muss eine ganze Zahl von 1 bis 16384 sein');
    bad(changed((m) => (m.mesh.vertexCount = 16385)), '„mesh.vertexCount“ muss eine ganze Zahl von 1 bis 16384 sein');
    bad(changed((m) => (m.mesh.triangleCount = 16385)), '„mesh.triangleCount“ muss eine ganze Zahl von 1 bis 16384 sein');
    // vertexCount 5: Alle Listen passen nicht mehr
    bad(changed((m) => (m.mesh.vertexCount = 5)), '„mesh.positions“ muss genau 15 Int16-Werte (3 je Vertex, 5 Vertices) als Base64 enthalten (40 Zeichen, nicht 32)');
    bad(changed((m) => (m.mesh.normals = encodeInt8([0, 0, 127]))), '„mesh.normals“ muss genau 12 Int8-Werte');
    bad(changed((m) => (m.mesh.uvs = encodeUint16LE([0, 0, 0, 0, 0, 0, 0]))), '„mesh.uvs“ muss genau 8 Uint16-Werte');
    bad(changed((m) => (m.mesh.triangleCount = 3)), '„mesh.triangles“ muss genau 9 Vertex-Indizes');
    bad(changed((m) => (m.mesh.positions = '!'.repeat(32))), '„mesh.positions“ enthält kein gültiges Base64');
    bad(changed((m) => (m.mesh.positions = 5)), '„mesh.positions“ fehlt oder ist kein Text (Base64)');
    bad(changed((m) => (m.mesh.triangles = encodeUint16LE([0, 1, 2, 0, 2, 4]))), '„mesh.triangles“: Dreieck 1 nennt den Vertex 4, es gibt nur 4 (0 bis 3)');
    bad(changed((m) => (m.mesh.bones = encodeUint8([0, 0, 1, 2]))), '„mesh.bones“: Vertex 3 nennt den Knochen 2, es gibt nur 2 (0 bis 1)');
    bad(changed((m) => (m.mesh.extra = '')), '„mesh.extra“ ist kein bekanntes Feld (Format 2)');
  });

  test('weiche Haut: joints und weights nur zusammen, Summe 255, Hauptknochen in bones', () => {
    const skin = (joints: number[], weights: number[]) => changed((m) => Object.assign(m.mesh, { joints: encodeUint8(joints), weights: encodeUint8(weights) }));
    const joints = [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const weights = [200, 55, 0, 0, 128, 127, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0];
    const soft = ok(skin(joints, weights));
    assert.equal(typeof soft.mesh.joints, 'string');
    assert.deepEqual([...decodeCosmeticMesh(soft.mesh).weights!.slice(0, 4)], [200, 55, 0, 0]);
    bad(changed((m) => (m.mesh.joints = encodeUint8(joints))), '„mesh.weights“ fehlt (Pflicht mit „mesh.joints“)');
    bad(changed((m) => (m.mesh.weights = encodeUint8(weights))), '„mesh.joints“ fehlt (Pflicht mit „mesh.weights“)');
    bad(skin(joints.slice(0, 12), weights), '„mesh.joints“ muss genau 16 Knochen-Indizes (Uint8, 4 je Vertex)');
    bad(skin(joints, weights.with(1, 54)), '„mesh.weights“: Die Gewichte von Vertex 0 ergeben 254 statt 255');
    bad(skin(joints.with(1, 2), weights), '„mesh.joints“: Vertex 0 nennt den Knochen 2, es gibt nur 2');
    // Vertex 1: Knochen 1 wiegt mehr, bones sagt aber 0
    bad(skin(joints, weights.with(4, 100).with(5, 155)), '„mesh.bones“: Vertex 1 muss den Knochen mit dem größten Gewicht aus „mesh.joints“ nennen');
  });

  test('Knochen: 1–96, Namen, Eltern zuerst, pivot und tail im Bereich', () => {
    bad(changed((m) => (m.bones = [])), '„bones“ muss eine Liste mit 1 bis 96 Knochen sein');
    bad(changed((m) => (m.bones = Array.from({ length: 97 }, (_, i) => ({ name: `b${i}`, parent: i - 1, pivot: [0, 0, 0], tail: [0, 1, 0] })))), '„bones“ muss eine Liste mit 1 bis 96 Knochen sein');
    bad(changed((m) => delete m.bones), '„bones“ fehlt');
    for (const name of ['', 'A'.repeat(33), 'mit leer', 'ä', 5]) bad(changed((m) => (m.bones[1].name = name)), '„bones[1].name“ ist ungültig (1–32 Zeichen aus A–Z, a–z, 0–9, _, . und -)');
    bad(changed((m) => (m.bones[1].name = 'root')), '„bones[1].name“: Den Knochen „root“ gibt es schon');
    bad(changed((m) => (m.bones[0].parent = 0)), '„bones[0].parent“ muss -1 sein (der erste Knochen hat keinen Eltern-Knochen)');
    bad(changed((m) => (m.bones[1].parent = 1)), '„bones[1].parent“ muss -1 (kein Eltern-Knochen) oder der Index eines Knochens davor sein (0 bis 0)');
    bad(changed((m) => (m.bones[1].parent = -2)), '„bones[1].parent“');
    bad(changed((m) => delete m.bones[1].parent), '„bones[1].parent“ fehlt');
    bad(changed((m) => (m.bones[1].pivot = [0, 1025, 0])), '„bones[1].pivot“ muss eine Liste aus drei Zahlen von -1024 bis 1024 sein');
    bad(changed((m) => delete m.bones[1].tail), '„bones[1].tail“ fehlt');
    bad(changed((m) => (m.bones[1].rotation = [0, 0, 0])), '„bones[1].rotation“ ist kein bekanntes Feld (Format 2)');
  });

  test('Animationen: Namen, fps, frames, loop, Spuren, Keys aufsteigend ab 0, Werte passend, Quaternionen normiert', () => {
    bad(changed((m) => (m.animations = {})), '„animations“ muss 1 bis 16 Animationen enthalten');
    bad(changed((m) => (m.animations = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`A${i}`, m.animations.Idle])))), '„animations“ muss 1 bis 16 Animationen enthalten');
    bad(changed((m) => (m.animations = [])), '„animations“ muss ein JSON-Objekt sein');
    bad(changed((m) => (m.animations['mit-strich'] = m.animations.Idle)), '„animations.mit-strich“: Der Name ist ungültig (1–24 Zeichen aus A–Z, a–z, 0–9 und _)');
    bad(changed((m) => (m.animations.Idle.fps = 61)), '„animations.Idle.fps“ muss eine ganze Zahl von 1 bis 60 sein');
    bad(changed((m) => (m.animations.Idle.fps = 23.5)), '„animations.Idle.fps“ muss eine ganze Zahl von 1 bis 60 sein');
    bad(changed((m) => (m.animations.Idle.frames = 1201)), '„animations.Idle.frames“ muss eine ganze Zahl von 1 bis 1200 sein');
    bad(changed((m) => (m.animations.Idle.loop = 1)), '„animations.Idle.loop“ muss true oder false sein');
    bad(changed((m) => delete m.animations.Idle.tracks), '„animations.Idle.tracks“ fehlt');
    const track = (m: Manifest) => m.animations.Idle.tracks[0];
    bad(changed((m) => m.animations.Idle.tracks.push({ bone: 0, move: track(m).rot }, { bone: 0, scale: track(m).rot })), '„animations.Idle.tracks“ muss eine Liste mit höchstens 2 Spuren sein');
    bad(changed((m) => m.animations.Idle.tracks.push({ ...track(m) })), '„animations.Idle.tracks[1].bone“: Für den Knochen 1 gibt es in dieser Animation schon eine Spur');
    bad(changed((m) => (track(m).bone = 2)), '„animations.Idle.tracks[0].bone“ muss eine ganze Zahl von 0 bis 1 sein');
    bad(changed((m) => (m.animations.Idle.tracks[0] = { bone: 1 })), '„animations.Idle.tracks[0]“ braucht mindestens eins von „rot“, „move“ und „scale“');
    bad(changed((m) => (track(m).rotation = track(m).rot)), '„animations.Idle.tracks[0].rotation“ ist kein bekanntes Feld (Format 2)');
    const rot = 'animations.Idle.tracks[0].rot';
    bad(changed((m) => (track(m).rot.keys = keys(1, 24, 47))), `„${rot}.keys“ muss mit Frame 0 beginnen (ist 1)`);
    bad(changed((m) => (track(m).rot.keys = keys(0, 24, 24))), `„${rot}.keys“ muss streng aufsteigen (Key 2: Frame 24 nach 24)`);
    bad(changed((m) => (track(m).rot.keys = keys(0, 30, 24))), `„${rot}.keys“ muss streng aufsteigen`);
    bad(changed((m) => (track(m).rot.keys = keys(0, 24, 48))), `„${rot}.keys“: Frame 48 liegt nicht in der Animation (0 bis 47)`);
    bad(changed((m) => (track(m).rot.keys = '')), `„${rot}.keys“ muss Frame-Nummern (Uint16) als Base64 enthalten, mindestens eine`);
    bad(changed((m) => (track(m).rot.keys = 'AQ==')), `„${rot}.keys“ muss Frame-Nummern (Uint16)`);
    bad(changed((m) => (track(m).rot.keys = keys(0, 24))), `„${rot}.values“ muss genau 8 Int16-Werte (x, y, z, w je Key) als Base64 enthalten`);
    bad(changed((m) => (track(m).rot.values = encodeInt16LE([...quatY(0), ...quatY(30), 0, 0, 0, 30000]))), `„${rot}.values“: Das Quaternion von Key 2 hat die Länge 0.916 (erlaubt 0.99 bis 1.01)`);
    ok(changed((m) => (track(m).rot.values = encodeInt16LE([...quatY(0), ...quatY(30), 0, 0, 0, 32767]))));
    bad(changed((m) => (m.animations.Hurt.tracks[0].move.values = encodeInt16LE([0, 0, 0]))), '„animations.Hurt.tracks[0].move.values“ muss genau 6 Int16-Werte (x, y, z je Key)');
    bad(changed((m) => (m.animations.Hurt.tracks[0].scale.values = encodeUint16LE([1000, 1000]))), '„animations.Hurt.tracks[0].scale.values“ muss genau 1 Uint16-Werte (einer je Key)');
    bad(changed((m) => delete m.animations.Hurt.tracks[0].scale.values), '„animations.Hurt.tracks[0].scale.values“ fehlt');
  });

  test('Zustände: idle Pflicht, nur bekannte Schlüssel, Werte = Animationen, blendSeconds 0–1', () => {
    bad(changed((m) => delete m.states), '„states“ fehlt');
    bad(changed((m) => delete m.states.idle), '„states.idle“ fehlt');
    bad(changed((m) => (m.states.idle = 'Gibtsnicht')), '„states.idle“ muss der Name einer Animation sein (Idle, Hurt)');
    bad(changed((m) => (m.states.sleep = 5)), '„states.sleep“ muss der Name einer Animation sein');
    bad(changed((m) => (m.states.sleep_in_bed = 'Idle')), '„states.sleep_in_bed“ ist kein bekanntes Feld (Format 2)');
    bad(changed((m) => delete m.states.blendSeconds), '„states.blendSeconds“ fehlt');
    bad(changed((m) => (m.states.blendSeconds = 1.5)), '„states.blendSeconds“ muss eine Zahl von 0 bis 1 sein');
    const all = ok(changed((m) => {
      for (const state of ['walk', 'sneak', 'sit_or_ride', 'swim', 'sprint', 'elytra', 'jump', 'fall', 'creative_fly', 'start_flying', 'land', 'emote', 'celebrate', 'afk', 'sleep', 'enable', 'disable', 'summon']) m.states[state] = 'Idle';
    }));
    assert.equal(Object.keys(all.states).length, 21);
  });

  test('Partikel: höchstens 16, erlaubte IDs, perSecond, color nur bei dust, states = Animationen', () => {
    const p = (change: (x: Manifest) => void) => changed((m) => change(m.particles[0]));
    bad(changed((m) => (m.particles = Array.from({ length: 17 }, () => m.particles[1]))), '„particles“ muss eine Liste mit höchstens 16 Einträgen sein');
    bad(changed((m) => (m.particles = {})), '„particles“ muss eine Liste');
    for (const particle of ['minecraft:explosion', 'Flame', 'minecraft:', 'dragon_breath', 3]) bad(p((x) => (x.particle = particle)), '„particles[0].particle“ ist kein erlaubter Partikel');
    bad(p((x) => (x.bone = 2)), '„particles[0].bone“ muss eine ganze Zahl von 0 bis 1 sein');
    bad(p((x) => (x.at = 'head')), '„particles[0].at“ muss eins von pivot, tail sein');
    bad(p((x) => (x.perSecond = 0.05)), '„particles[0].perSecond“ muss eine Zahl von 0.1 bis 20 sein');
    bad(p((x) => (x.perSecond = 30)), '„particles[0].perSecond“ muss eine Zahl von 0.1 bis 20 sein');
    bad(p((x) => (x.particle = 'flame')), '„particles[0].color“ gibt es nur beim Partikel dust');
    bad(p((x) => (x.color = [1, 0.8, 0.3])), '„particles[0].color“ muss eine Farbe wie #ffcc00 sein');
    bad(p((x) => (x.states = [])), '„particles[0].states“ muss eine Liste mit 1 bis 16 Animationen sein');
    bad(p((x) => (x.states = ['Glide'])), '„particles[0].states[0]“ muss der Name einer Animation sein (Idle, Hurt)');
    bad(p((x) => (x.states = ['Idle', 'Idle'])), '„particles[0].states[1]“: „Idle“ steht doppelt in der Liste');
    bad(p((x) => (x.offset = [0, 0, 0])), '„particles[0].offset“ ist kein bekanntes Feld (Format 2)');
    ok(p((x) => delete x.color));
  });

  test('Anbringen: nur beim Begleiter, origin ±64 Pixel, side links oder rechts', () => {
    bad(changed((m) => (m.attach = { origin: [0, 0, 0] })), '„attach“ gibt es nur beim Slot companion (nicht beim Slot back)');
    bad(changed((m) => (m.attach.origin = [65, 0, 0]), 'companion'), '„attach.origin“ muss eine Liste aus drei Zahlen von -64 bis 64 sein');
    bad(changed((m) => (m.attach.side = 'mitte'), 'companion'), '„attach.side“ muss eins von left, right sein');
    bad(changed((m) => (m.attach.follow = 0.15), 'companion'), '„attach.follow“ ist kein bekanntes Feld (Format 2)');
  });

  test('Größe je Format: Format 2 bis 512 KB, Format 1 bleibt bei 160 KB / 192 KB; Umschlag bis 544 KB', () => {
    assert.deepEqual([COSMETIC_MAX_MANIFEST_BYTES, COSMETIC_MAX_ENVELOPE_BYTES], [COSMETIC_LIMITS_2.manifestBytes, COSMETIC_LIMITS_2.envelopeBytes]);
    assert.deepEqual([COSMETIC_LIMITS.manifestBytes, COSMETIC_LIMITS.envelopeBytes], [160 * 1024, 192 * 1024]);
    // Leerraum gehört zum signierten Text und zählt mit
    const padded = (manifest: Manifest, bytes: number) => {
      const text = JSON.stringify(manifest);
      return `${text.slice(0, -1)}${' '.repeat(bytes - utf8Length(text))}}`;
    };
    const two = padded(valid2(), 400 * 1024);
    assert.equal(utf8Length(two), 400 * 1024);
    assert.equal((parseCosmeticManifest(two) as CosmeticManifest2).format, 2);
    assert.equal(typeof parseCosmeticManifest(padded(valid2(), COSMETIC_LIMITS_2.manifestBytes)), 'object');
    assert.equal(parseCosmeticManifest(padded(valid2(), COSMETIC_LIMITS_2.manifestBytes + 1)), '„manifest“ ist zu groß (höchstens 512 KB bei Format 2)');
    assert.equal(typeof parseCosmeticManifest(padded(VALID.head(), COSMETIC_LIMITS.manifestBytes)), 'object');
    assert.equal(parseCosmeticManifest(padded(VALID.head(), COSMETIC_LIMITS.manifestBytes + 1)), '„manifest“ ist zu groß (höchstens 160 KB bei Format 1)');
    // Umschlag-Länge folgt aus dem Manifest (die Signatur hat immer 88 Zeichen)
    const sig = Buffer.alloc(64, 7).toString('base64');
    assert.equal(cosmeticEnvelopeLength(two), utf8Length(cosmeticEnvelopeText({ manifest: two, signature: sig })));
    // Format 1 mit vielen Anführungszeichen (im Umschlag doppelt): unter 160 KB, aber Umschlag über 192 KB
    const head = JSON.stringify(VALID.head());
    const heavy = `${head.slice(0, -1)},"x":"${'\\"'.repeat(70 * 1024)}"}`;
    assert.ok(utf8Length(heavy) <= COSMETIC_LIMITS.manifestBytes && cosmeticEnvelopeLength(heavy) > COSMETIC_LIMITS.envelopeBytes);
    assert.equal(parseCosmeticManifest(heavy), 'Der Umschlag ist zu groß (höchstens 192 KB bei Format 1)');
    // Unbekanntes Format: keine Größenregel, sondern der Format-Fehler
    assert.equal(parseCosmeticManifest(JSON.stringify({ type: 'heldix-cosmetic', format: 3 })), '„format“ muss 1 oder 2 sein');

    // Umschlag: Obergrenze aller Formate (das Format steht erst im Manifest)
    assert.equal(typeof checkCosmeticEnvelope({ manifest: 'a'.repeat(COSMETIC_MAX_MANIFEST_BYTES), signature: sig }), 'object');
    assert.equal(checkCosmeticEnvelope({ manifest: 'a'.repeat(COSMETIC_MAX_MANIFEST_BYTES + 1), signature: sig }), '„manifest“ ist zu groß (höchstens 512 KB)');
    assert.equal(checkCosmeticEnvelope({ manifest: '"'.repeat(300 * 1024), signature: sig }), 'Der Umschlag ist zu groß (höchstens 544 KB)');
  });
});
