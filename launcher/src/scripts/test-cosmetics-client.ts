// Prüft die Cosmetics im Launcher (core/cosmeticcatalog.ts) gegen einen Fake-Dienst: Katalog laden, Umschläge prüfen
// (falsche Signatur, falsches Präfix, verändertes Manifest, fremde ID, Prüfsumme) und still verwerfen, Zwischenspeicher
// nach sha256 (keine zweite Anfrage, auch nicht nach einem Neustart; beschädigte Datei wird neu geladen; alte Versionen
// werden gelöscht), ETag, Betrieb ohne Dienst, eigene Auswahl lesen und ändern (Prüfungen vor dem Senden, Team-Status
// aus Auswahl und 403, Belohnungen mit access „unlock“ gesperrt bis zur Freischaltung). Format 2 (animierte Meshes):
// laden (auch über 192 KB), Form für die Oberfläche, Rechnung der Vorschau (renderer/cosmetic-mesh.ts: Keyframes mit
// slerp/lerp, halten, loop, Knochen-Matrizen, Skinning, Leuchten, Abspielen mit Überblenden) und Aufbau der Szene
// (renderer/cosmetic-scene.ts mit three.js aus node_modules, ohne WebGL). Zum Schluss: der Startsatz
// (launcher/release/cosmetics) besteht die Prüfung mit dem echten öffentlichen Update-Schlüssel. Signiert wird mit einem
// Test-Schlüssel; der private Update-Schlüssel wird nie gebraucht.
//
// Aufruf: npm run test:cosmetics-client

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CosmeticsState } from '../shared/api';
import { CosmeticCatalog, TEAM_ONLY_MESSAGE, UNLOCK_MESSAGE, parseUnlocked, type CosmeticAuth } from '../main/core/cosmeticcatalog';
import { cosmeticCubeFaces, pngDataUrl } from '../main/core/cosmetics';
import { COSMETIC_SIGNATURE_PREFIX, cosmeticEnvelopeText, encodeInt16LE, encodeInt8, encodeUint16LE, encodeUint8 } from '../main/core/cosmetics-format';
import { ServiceError, serviceRequest } from '../main/core/heldixservice';
import { UPDATE_PUBLIC_KEY } from '../main/update-public-key';
import { check, encodePng, finish, rejects } from './testkit';

type Json = Record<string, any>;
const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

function png(width: number, height: number): string {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([200, 120 + (i % 7) * 10, 40, i % 5 ? 255 : 0], i * 4);
  return pngDataUrl(encodePng(width, height, rgba));
}

const BASE = { type: 'heldix-cosmetic', format: 1, version: 1, description: 'Zum Testen', access: 'all', date: '2026-11-26T12:00:00.000Z' };
const MODEL = {
  textureSize: [64, 32],
  bones: [
    { name: 'base', pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 2, 8], uv: [0, 0] }] },
    { name: 'spitze', parent: 'base', pivot: [0, 2, 0], cubes: [{ origin: [-1, 2, -1], size: [2, 3, 2], uv: [32, 0] }, { origin: [-3, 2, 0], size: [6, 4, 0], uv: [0, 12], mirror: true }] },
  ],
};

function manifest(id: string, slot: string, extra: Json = {}): Json {
  const bySlot: Record<string, Json> = {
    head: { texture: png(64, 32), model: MODEL, animations: [{ bone: 'spitze', type: 'spin', axis: 'y', speed: 0.5 }] },
    back: { texture: png(64, 32), glow: png(64, 32), model: MODEL },
    aura: { texture: png(32, 8), particles: { frames: 4, rate: 6, lifetime: 30, size: 0.12, motion: 'rise', radius: 0.6, color: '#ffd166' } },
    companion: { texture: png(64, 32), model: MODEL, companion: { offset: [0.7, 1.6, -0.4], scale: 0.8 } },
    cape: { texture: png(64, 64), cape: { frames: 2, fps: 4 } },
  };
  return { ...BASE, id, slot, name: `Test ${id}`, ...bySlot[slot], ...extra };
}

/** Umschlag so, wie der Dienst ihn ausliefert (kompaktes JSON) */
function envelope(m: Json, key: KeyObject, prefix = COSMETIC_SIGNATURE_PREFIX): string {
  const text = JSON.stringify(m);
  return cosmeticEnvelopeText({ manifest: text, signature: sign(null, Buffer.from(prefix + text, 'utf8'), key).toString('base64') });
}

// ---------- Format 2 (animierte Meshes) ----------
const DEG = Math.PI / 180;
/** Quaternion (x, y, z, w) für eine Drehung um eine Achse */
const quat = (axis: [number, number, number], degrees: number) => {
  const s = Math.sin((degrees * DEG) / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos((degrees * DEG) / 2)];
};
const keysOf = (frames: number[]) => encodeUint16LE(frames);
const rotTrack = (frames: number[], quats: number[][]) => ({ keys: keysOf(frames), values: encodeInt16LE(quats.flatMap((q) => q.map((v) => Math.round(v * 32767)))) });

/**
 * Kleines Format-2-Manifest: Knochen 0 „root“ (Rumpf) mit einem Quadrat, Knochen 1 „wing.L“ (Kind) mit einem Quadrat;
 * Body-Raum in Pixeln (+Y unten, +Z hinten). Idle dreht den Flügel in 20 Frames um 90° um Z, Takeoff (einmalig)
 * verschiebt und vergrößert den Rumpf, Leucht-Streifen mit 2 Bildern.
 */
function meshManifest(id: string, slot: string, extra: Json = {}): Json {
  const corners = [[-2, 2, 2.5], [2, 2, 2.5], [2, 6, 2.5], [-2, 6, 2.5], [1, 3, 3], [8, 3, 3], [8, 5, 3], [1, 5, 3]];
  return {
    type: 'heldix-cosmetic',
    format: 2,
    id,
    version: 1,
    slot,
    name: `Test ${id}`,
    description: 'Format 2 zum Testen',
    access: 'all',
    date: BASE.date,
    texture: png(16, 16),
    glow: png(16, 32),
    emissive: { frames: 2, frametimeTicks: 3, pulse: { period: 2, min: 0.5, max: 1 } },
    mesh: {
      vertexCount: 8,
      triangleCount: 4,
      positions: encodeInt16LE(corners.flat().map((v) => Math.round(v * 32))),
      normals: encodeInt8(corners.flatMap(() => [0, 0, 127])),
      uvs: encodeUint16LE(corners.flatMap((_, i) => [i % 4 === 1 || i % 4 === 2 ? 65535 : 0, i % 4 >= 2 ? 65535 : 0])),
      bones: encodeUint8([0, 0, 0, 0, 1, 1, 1, 1]),
      triangles: encodeUint16LE([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    },
    bones: [
      { name: 'root', parent: -1, pivot: [0, 4, 2], tail: [0, 2, 2] },
      { name: 'wing.L', parent: 0, pivot: [1, 3, 3], tail: [8, 3, 3] },
    ],
    animations: {
      Idle: { fps: 20, frames: 40, loop: true, tracks: [{ bone: 1, rot: rotTrack([0, 20], [[0, 0, 0, 1], quat([0, 0, 1], 90)]) }] },
      Emote: { fps: 10, frames: 20, loop: true, tracks: [{ bone: 1, rot: rotTrack([0, 10], [[0, 0, 0, 1], quat([1, 0, 0], 60)]) }] },
      Takeoff: {
        fps: 10,
        frames: 11,
        loop: false,
        tracks: [{ bone: 0, move: { keys: keysOf([0, 10]), values: encodeInt16LE([0, 0, 0, 128, 0, 0]) }, scale: { keys: keysOf([0, 10]), values: encodeUint16LE([1000, 2000]) } }],
      },
      Glide: { fps: 10, frames: 10, loop: true, tracks: [{ bone: 1, rot: rotTrack([0], [quat([0, 1, 0], 30)]) }] },
      Land: { fps: 10, frames: 21, loop: false, tracks: [{ bone: 1, rot: rotTrack([0, 10], [[0, 0, 0, 1], quat([0, 0, 1], 40)]) }] },
    },
    states: { idle: 'Idle', emote: 'Emote', start_flying: 'Takeoff', elytra: 'Glide', land: 'Land', blendSeconds: 0.25 },
    particles: [{ bone: 1, at: 'tail', particle: 'minecraft:end_rod', perSecond: 2, states: ['Emote'] }],
    ...extra,
  };
}

/** Format 2 mit großem Mesh (Umschlag über der Grenze von Format 1, 192 KB) */
function bigMeshManifest(id: string): Json {
  const n = 10000;
  const t = 3400;
  const base = meshManifest(id, 'back');
  return {
    ...base,
    mesh: {
      vertexCount: n,
      triangleCount: t,
      positions: encodeInt16LE(Array.from({ length: n * 3 }, (_, i) => (i * 37) % 600 - 300)),
      normals: encodeInt8(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 2 ? 127 : 0))),
      uvs: encodeUint16LE(Array.from({ length: n * 2 }, (_, i) => (i * 911) % 65536)),
      bones: encodeUint8(Array.from({ length: n }, (_, i) => i % 2)),
      triangles: encodeUint16LE(Array.from({ length: t * 3 }, (_, i) => i % n)),
    },
  };
}

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;
const nearAll = (a: ArrayLike<number>, b: number[], eps = 1e-3) => b.every((v, i) => near(a[i], v, eps));

// ---------- Fake-Dienst ----------
interface Listing {
  id: string;
  slot: string;
  version: number;
  envelope: string;
  /** abweichende Prüfsumme im Katalog */
  sha256?: string;
}

class FakeService {
  listings: Listing[] = [];
  list = 0;
  notModified = 0;
  envelopes = new Map<string, number>();
  mine: Json = { head: null, back: null, aura: null, companion: null, cape: null };
  team = false;
  /** Belohnungen (access „unlock“) und was freigeschaltet ist; null = Feld fehlt (älterer Dienst) */
  rewards = new Set<string>();
  unlocked: string[] | null = null;
  gets = 0;
  puts: Json[] = [];
  private server: Server | null = null;
  url = '';

  catalogBody(): string {
    return JSON.stringify({
      cosmetics: this.listings.map((l) => ({ id: l.id, slot: l.slot, version: l.version, name: l.id, description: '', access: 'all', sha256: l.sha256 ?? sha(l.envelope), size: Buffer.byteLength(l.envelope), date: BASE.date })),
    });
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const send = (status: number, body: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(body);
      };
      if (req.method === 'GET' && url.pathname === '/v1/cosmetics') {
        this.list++;
        const body = this.catalogBody();
        const etag = `"${sha(body).slice(0, 32)}"`;
        if (req.headers['if-none-match'] === etag) {
          this.notModified++;
          res.writeHead(304, { etag });
          res.end();
          return;
        }
        return send(200, body, { etag });
      }
      const one = /^\/v1\/cosmetics\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && one) {
        const listing = this.listings.find((l) => l.id === one[1]);
        this.envelopes.set(one[1], (this.envelopes.get(one[1]) ?? 0) + 1);
        return listing ? send(200, listing.envelope) : send(404, JSON.stringify({ error: 'Dieses Cosmetic gibt es nicht.' }));
      }
      if (url.pathname === '/v1/me/cosmetics') {
        if (req.headers.authorization !== 'Bearer test') return send(401, JSON.stringify({ error: 'Nicht angemeldet.' }));
        const mine = () => JSON.stringify(this.unlocked ? { ...this.mine, unlocked: this.unlocked } : this.mine);
        if (req.method === 'GET') {
          this.gets++;
          return send(200, mine());
        }
        if (req.method === 'PUT') {
          let raw = '';
          req.on('data', (d: Buffer) => (raw += d.toString()));
          req.on('end', () => {
            const body = JSON.parse(raw) as Json;
            this.puts.push(body);
            if (body.id === 'team-hut' && !this.team) return send(403, JSON.stringify({ error: TEAM_ONLY_MESSAGE }));
            if (this.rewards.has(body.id) && !(this.unlocked ?? []).includes(body.id)) return send(403, JSON.stringify({ error: UNLOCK_MESSAGE, code: 'LOCKED' }));
            this.mine = { ...this.mine, [body.slot]: body.id };
            send(200, mine());
          });
          return;
        }
      }
      send(404, JSON.stringify({ error: 'Unbekannt.' }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

/** Anmeldung wie core/social.ts, nur mit festem Token */
function fakeAuth(base: () => string, account: { id: string | null }): CosmeticAuth {
  return {
    async authed<T>(route: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}, options: { offlineMessage?: string } = {}): Promise<T> {
      if (!account.id) throw new Error('Bitte zuerst ein Konto hinzufügen.');
      if (account.id === 'offline') throw new Error(options.offlineMessage ?? 'offline');
      return serviceRequest<T>(base(), route, { ...init, token: 'test', timeoutMs: 3000 });
    },
    accountId: async () => account.id,
  };
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-cosmetics-client-'));
  const fake = await new FakeService().start();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519').privateKey;
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const cacheDir = path.join(tmp, 'cache', 'cosmetics');
  const account = { id: 'konto-1' as string | null };
  const logs: string[] = [];
  const catalog = (options: { key?: string | null; url?: string } = {}) =>
    new CosmeticCatalog({
      serviceUrl: options.url ?? fake.url,
      publicKey: options.key === undefined ? publicPem : options.key,
      cacheDir,
      auth: fakeAuth(() => options.url ?? fake.url, account),
      log: (line) => logs.push(line),
    });
  try {
    // ---------- Katalog mit guten und schlechten Umschlägen ----------
    const krone = manifest('krone', 'head');
    const tampered = JSON.parse(envelope(manifest('veraendert', 'aura'), privateKey));
    tampered.manifest = tampered.manifest.replace('"rate":6', '"rate":7');
    fake.listings = [
      { id: 'krone', slot: 'head', version: 1, envelope: envelope(krone, privateKey) },
      // Textur in 4-facher Auflösung (256 × 128 für 64 × 32 Texel)
      { id: 'team-hut', slot: 'head', version: 1, envelope: envelope(manifest('team-hut', 'head', { access: 'team', texture: png(256, 128) }), privateKey) },
      { id: 'fluegel', slot: 'back', version: 1, envelope: envelope(manifest('fluegel', 'back', { model: { ...MODEL, scale: 0.62 } }), privateKey) },
      { id: 'funken', slot: 'aura', version: 1, envelope: envelope(manifest('funken', 'aura'), privateKey) },
      { id: 'drache', slot: 'companion', version: 1, envelope: envelope(manifest('drache', 'companion'), privateKey) },
      { id: 'ozean', slot: 'cape', version: 1, envelope: envelope(manifest('ozean', 'cape'), privateKey) },
      { id: 'fremd', slot: 'head', version: 1, envelope: envelope(manifest('fremd', 'head'), other) },
      { id: 'praefix', slot: 'head', version: 1, envelope: envelope(manifest('praefix', 'head'), privateKey, 'heldix-addon\n') },
      { id: 'veraendert', slot: 'aura', version: 1, envelope: cosmeticEnvelopeText(tampered) },
      { id: 'falsche-id', slot: 'head', version: 1, envelope: envelope(manifest('anders', 'head'), privateKey) },
      { id: 'falscher-slot', slot: 'back', version: 1, envelope: envelope(manifest('falscher-slot', 'head'), privateKey) },
      { id: 'pruefsumme', slot: 'head', version: 1, envelope: envelope(manifest('pruefsumme', 'head'), privateKey), sha256: 'a'.repeat(64) },
      { id: 'kaputt', slot: 'head', version: 1, envelope: '{"manifest": 1' },
    ];
    const first = catalog();
    let result = await first.catalog();
    const ids = result.items.map((i) => i.id);
    check('gültige Umschläge übernommen (in Katalog-Reihenfolge)', ids.join() === 'krone,team-hut,fluegel,funken,drache,ozean', ids);
    check('Katalog ohne Fehler', result.error === null, result.error);
    const rejectedLog = (id: string, pattern: RegExp) => logs.some((l) => l.includes(`„${id}“`) && pattern.test(l));
    check('fremder Schlüssel: verworfen mit Logzeile', !ids.includes('fremd') && rejectedLog('fremd', /verworfen.*Signatur/), logs);
    check('falsches Präfix (Addon-Signatur): verworfen', !ids.includes('praefix') && rejectedLog('praefix', /verworfen.*Signatur/));
    check('verändertes Manifest: verworfen', !ids.includes('veraendert') && rejectedLog('veraendert', /verworfen.*Signatur/));
    check('ID passt nicht zum Katalog: verworfen', !ids.includes('falsche-id') && rejectedLog('falsche-id', /verworfen.*ID/));
    check('Slot passt nicht zum Katalog: verworfen', !ids.includes('falscher-slot') && rejectedLog('falscher-slot', /verworfen.*Slot/));
    check('Prüfsumme passt nicht: verworfen', !ids.includes('pruefsumme') && rejectedLog('pruefsumme', /verworfen.*Prüfsumme/));
    check('kein gültiges JSON: verworfen', !ids.includes('kaputt') && rejectedLog('kaputt', /verworfen/));

    // ---------- Form für die Oberfläche ----------
    const head = result.items.find((i) => i.id === 'krone')!;
    const expectedFaces = MODEL.bones.map((b) => b.cubes.reduce((n, c) => n + cosmeticCubeFaces({ origin: c.origin as never, size: c.size as never, uv: c.uv as never, inflate: 0, mirror: !!(c as Json).mirror }).length, 0));
    check('Flächen je Bone wie cosmeticCubeFaces (Ebene: zwei Flächen)', head.bones.map((b) => b.faces.length).join() === expectedFaces.join() && expectedFaces[1] === 8, head.bones.map((b) => b.faces.length));
    check('Bone: Eltern, absoluter Pivot, Standard-Drehung', head.bones[1].parent === 'base' && head.bones[1].pivot.join() === '0,2,0' && head.bones[1].rotation.join() === '0,0,0');
    check('Textur als data:-URL, Größe aus dem Modell', head.texture.startsWith('data:image/png;base64,') && head.textureSize.join() === '64,32' && head.glow === null);
    check('Animation mit Standardwerten (phase 0)', head.animations.length === 1 && head.animations[0].phase === 0 && head.animations[0].type === 'spin');
    check('sha256 des Umschlags', head.sha256 === sha(fake.listings[0].envelope));
    const team = result.items.find((i) => i.id === 'team-hut')!;
    check('access: team → teamOnly', team.teamOnly && !head.teamOnly);
    check('Textur 4-fach aufgelöst: textureSize bleibt in Texeln (UV-Raum)', team.textureSize.join() === '64,32', team.textureSize);
    const aura = result.items.find((i) => i.id === 'funken')!;
    check('aura: Partikel, keine Bones, Textur 32 × 8', !!aura.particles && aura.particles.frames === 4 && aura.particles.fullbright === false && aura.bones.length === 0 && aura.textureSize.join() === '32,8');
    const cape = result.items.find((i) => i.id === 'ozean')!;
    check('cape: Bilder und fps', cape.cape?.frames === 2 && cape.cape.fps === 4 && cape.textureSize.join() === '64,64');
    const companion = result.items.find((i) => i.id === 'drache')!;
    check('companion: Platz und Größe', companion.companion?.offset.join() === '0.7,1.6,-0.4' && companion.companion.scale === 0.8);
    check('back: Leuchtebene', result.items.find((i) => i.id === 'fluegel')!.glow?.startsWith('data:image/png;base64,') === true);
    check('Modellgröße: model.scale übernommen, sonst 1 (auch ohne Modell)', result.items.find((i) => i.id === 'fluegel')!.modelScale === 0.62
      && head.modelScale === 1 && companion.modelScale === 1 && aura.modelScale === 1 && cape.modelScale === 1);

    // ---------- Zwischenspeicher ----------
    const files = (await readdir(path.join(cacheDir, 'envelopes'))).sort();
    const validShas = fake.listings.slice(0, 6).map((l) => `${sha(l.envelope)}.json`).sort();
    check('nur geprüfte Umschläge liegen im Zwischenspeicher (<sha256>.json)', files.join() === validShas.join(), files);
    check('Katalog auf der Platte', existsSync(path.join(cacheDir, 'catalog.json')));
    const envelopeCalls = () => [...fake.envelopes.values()].reduce((a, b) => a + b, 0);
    const before = envelopeCalls();
    const listsBefore = fake.list;
    result = await first.catalog();
    check('innerhalb einer Minute: keine neue Anfrage', fake.list === listsBefore && envelopeCalls() === before);
    result = await first.catalog(true);
    check('neu laden mit ETag: 304, keine Umschläge', fake.list === listsBefore + 1 && fake.notModified === 1 && envelopeCalls() === before && result.items.length === 6);
    check('verworfene Umschläge werden nicht immer wieder geladen', (fake.envelopes.get('fremd') ?? 0) === 1);

    // Neustart: neue Instanz mit demselben Ordner
    const restarted = catalog();
    result = await restarted.catalog();
    check('Neustart: Umschläge aus dem Zwischenspeicher (gleiches sha256, keine Anfrage)', result.items.length === 6 && fake.envelopes.get('krone') === 1 && fake.envelopes.get('ozean') === 1, Object.fromEntries(fake.envelopes));
    check('Neustart: verworfene werden einmal neu geprüft', (fake.envelopes.get('fremd') ?? 0) === 2);

    // beschädigte Datei im Zwischenspeicher
    const kroneFile = path.join(cacheDir, 'envelopes', `${sha(fake.listings[0].envelope)}.json`);
    await writeFile(kroneFile, fake.listings[0].envelope.replace('Test krone', 'Test KRONE'));
    logs.length = 0;
    result = await catalog().catalog();
    check('veränderte Datei im Zwischenspeicher: verworfen und neu geladen', result.items.some((i) => i.id === 'krone' && i.name === 'Test krone') && fake.envelopes.get('krone') === 2 && logs.some((l) => /Zwischenspeicher verworfen/.test(l)), logs);
    check('… und wieder richtig gespeichert', (await readFile(kroneFile, 'utf8')) === fake.listings[0].envelope);

    // neue Version: neues sha256, alte Datei weg
    const oldSha = sha(fake.listings[0].envelope);
    fake.listings[0] = { id: 'krone', slot: 'head', version: 2, envelope: envelope({ ...krone, version: 2, name: 'Krone 2' }, privateKey) };
    result = await restarted.catalog(true);
    check('neue Version wird geladen', result.items.find((i) => i.id === 'krone')?.name === 'Krone 2' && fake.envelopes.get('krone') === 3);
    check('alte Version aus dem Zwischenspeicher gelöscht', !existsSync(path.join(cacheDir, 'envelopes', `${oldSha}.json`)) && existsSync(path.join(cacheDir, 'envelopes', `${sha(fake.listings[0].envelope)}.json`)));

    // ohne Dienst: zuletzt geladener Katalog
    const offline = catalog({ url: 'http://127.0.0.1:9' });
    result = await offline.catalog();
    check('Dienst nicht erreichbar: Katalog aus dem Zwischenspeicher', result.items.length === 6 && result.error === 'Heldix-Dienst nicht erreichbar.', { n: result.items.length, error: result.error });
    const noKey = await catalog({ key: null }).state();
    check('ohne Schlüssel: keine Cosmetics, klare Meldung', noKey.items.length === 0 && /Signatur-Schlüssel/.test(noKey.error ?? ''), noKey.error);
    const noService = await new CosmeticCatalog({ serviceUrl: '', publicKey: publicPem, cacheDir, auth: null }).state();
    check('ohne Dienst eingerichtet: Meldung, nichts wählbar', !noService.canChoose && noService.selection === null && /Kein Heldix-Dienst/.test(noService.error ?? ''), noService.error);

    // ---------- Auswahl ----------
    const service = catalog();
    fake.mine = { head: 'krone', back: null, aura: 'unbekannt!', companion: null, cape: 'aurora' };
    let state: CosmeticsState = await service.state();
    check('eigene Auswahl gelesen (ungültige IDs = nichts)', state.canChoose && state.selection?.head === 'krone' && state.selection.aura === null && state.selection.cape === 'aurora' && state.error === null, state.selection);
    check('Team unbekannt, solange nichts darauf hinweist', state.team === null);
    state = await service.choose('companion', 'drache');
    check('anlegen: PUT { slot, id }', fake.puts.at(-1)?.slot === 'companion' && fake.puts.at(-1)?.id === 'drache' && state.selection?.companion === 'drache');
    state = await service.choose('companion', null);
    check('ablegen: id null', fake.puts.at(-1)?.id === null && state.selection?.companion === null);
    state = await service.choose('cape', 'glut');
    check('Cape-Slot: eingebautes Cape', fake.puts.at(-1)?.slot === 'cape' && state.selection?.cape === 'glut');
    state = await service.choose('cape', 'ozean');
    check('Cape-Slot: Cape aus dem Katalog', state.selection?.cape === 'ozean');
    const puts = fake.puts.length;
    await rejects('unbekanntes Cosmetic: abgelehnt ohne Anfrage', () => service.choose('head', 'gibts-nicht'), /gibt es nicht/);
    await rejects('falscher Slot: abgelehnt ohne Anfrage', () => service.choose('back', 'krone'), /passt nicht in diesen Slot/);
    await rejects('verworfenes Cosmetic nicht wählbar', () => service.choose('head', 'fremd'), /gibt es nicht/);
    await rejects('unbekannter Slot', () => service.choose('fuesse', 'krone'), /Unbekannter Slot/);
    check('keine dieser Anfragen ging an den Dienst', fake.puts.length === puts);
    await rejects('nur fürs Team: 403 des Dienstes', () => service.choose('head', 'team-hut'), /nur für das HeldixClient-Team/);
    state = await service.state();
    check('nach 403: nicht im Team', state.team === false);
    const afterTeam = fake.puts.length;
    await rejects('nicht im Team: abgelehnt ohne Anfrage', () => service.choose('head', 'team-hut'), /nur für das HeldixClient-Team/);
    check('… ohne Anfrage', fake.puts.length === afterTeam);
    fake.team = true;
    fake.mine = { ...fake.mine, head: 'team-hut' };
    state = await catalog().state();
    check('trägt etwas nur fürs Team: im Team', state.team === true);
    account.id = 'konto-2';
    fake.mine = { ...fake.mine, head: null };
    state = await service.state();
    check('anderes Konto: Team wieder unbekannt', state.team === null, state.team);
    account.id = 'offline';
    state = await service.state();
    check('Offline-Konto: klare Meldung, Katalog trotzdem da', !state.canChoose && state.selection === null && state.error === 'Cosmetics gibt es nur mit einem Microsoft-Konto.' && state.items.length === 6, state.error);
    await rejects('Offline-Konto: wählen geht nicht', () => service.choose('head', 'krone'), /nur mit einem Microsoft-Konto/);
    account.id = null;
    state = await service.state();
    check('ohne Konto: klare Meldung', !state.canChoose && state.error === 'Bitte zuerst ein Konto hinzufügen.', state.error);
    account.id = 'konto-3';
    fake.team = false;
    const refused = await catalog().choose('head', 'team-hut').then(() => null, (e: unknown) => e);
    check('Fehler des Dienstes kommen als ServiceError mit Status', refused instanceof ServiceError && refused.status === 403 && refused.message === TEAM_ONLY_MESSAGE, refused);

    // ---------- Belohnungen (access „unlock“, z. B. für Einladungen) ----------
    check('unlocked lesen: nur gültige IDs, ohne Feld leer', parseUnlocked({ unlocked: ['freundesband', 'Böse ID', 7, 'freundesband'] }).join() === 'freundesband' && parseUnlocked({}).length === 0);
    fake.listings = [
      { id: 'krone', slot: 'head', version: 1, envelope: envelope(krone, privateKey) },
      { id: 'freundesfunken', slot: 'aura', version: 1, envelope: envelope(manifest('freundesfunken', 'aura', { access: 'unlock' }), privateKey) },
      { id: 'freundesband', slot: 'cape', version: 1, envelope: envelope(manifest('freundesband', 'cape', { access: 'unlock' }), privateKey) },
    ];
    fake.rewards = new Set(['freundesfunken', 'freundesband']);
    fake.unlocked = [];
    fake.mine = { head: null, back: null, aura: null, companion: null, cape: null };
    account.id = 'konto-4';
    const rewards = new CosmeticCatalog({ serviceUrl: fake.url, publicKey: publicPem, cacheDir: path.join(tmp, 'belohnungen'), auth: fakeAuth(() => fake.url, account), log: (line) => logs.push(line) });
    state = await rewards.state();
    const funken = state.items.find((i) => i.id === 'freundesfunken');
    const band = state.items.find((i) => i.id === 'freundesband');
    check('access: unlock → im Katalog, unlockOnly (nicht teamOnly)', !!funken && !!band && funken.unlockOnly && band.unlockOnly && !funken.teamOnly && !state.items.find((i) => i.id === 'krone')!.unlockOnly, state.items.map((i) => [i.id, i.unlockOnly]));
    check('noch nichts freigeschaltet: unlocked leer', Array.isArray(state.unlocked) && state.unlocked.length === 0, state.unlocked);
    const putsBefore = fake.puts.length;
    await rejects('gesperrte Belohnung: abgelehnt mit Hinweis auf Einladungen', () => rewards.choose('aura', 'freundesfunken'), /Freunde zu HeldixClient einlädst/);
    check('… ohne PUT (vorher frisch nachgesehen)', fake.puts.length === putsBefore);
    await rejects('gesperrtes Belohnungs-Cape ebenso', () => rewards.choose('cape', 'freundesband'), /einlädst/);
    fake.unlocked = ['freundesfunken'];
    const getsBefore = fake.gets;
    state = await rewards.choose('aura', 'freundesfunken');
    check('gerade freigeschaltet: choose sieht frisch nach und legt an', fake.gets === getsBefore + 1 && state.selection?.aura === 'freundesfunken' && state.unlocked?.join() === 'freundesfunken', { gets: fake.gets - getsBefore, state: state.selection, unlocked: state.unlocked });
    state = await rewards.state();
    check('freigeschaltet: in unlocked, das andere nicht', state.unlocked?.includes('freundesfunken') === true && !state.unlocked.includes('freundesband'), state.unlocked);
    fake.unlocked = null;
    state = await rewards.state();
    check('älterer Dienst ohne Feld: unlocked leer (alles gesperrt)', state.unlocked?.length === 0, state.unlocked);
    const noAuth = await new CosmeticCatalog({ serviceUrl: fake.url, publicKey: publicPem, cacheDir: path.join(tmp, 'belohnungen'), auth: null }).state();
    check('ohne Anmeldung: unlocked unbekannt (null)', noAuth.unlocked === null && noAuth.items.some((i) => i.unlockOnly));
    const fresh = new CosmeticCatalog({ serviceUrl: fake.url, publicKey: publicPem, cacheDir: path.join(tmp, 'belohnungen'), auth: fakeAuth(() => fake.url, account) });
    fake.unlocked = [];
    const lockedRefusal = await fresh.choose('cape', 'freundesband').then(() => null, (e: unknown) => e);
    check('ohne bekannten Stand entscheidet der Dienst: 403 mit seiner Meldung', lockedRefusal instanceof ServiceError && lockedRefusal.status === 403 && lockedRefusal.message === UNLOCK_MESSAGE, lockedRefusal);

    // ---------- Format 2: animierte Meshes laden ----------
    fake.listings = [
      { id: 'krone', slot: 'head', version: 1, envelope: envelope(krone, privateKey) },
      { id: 'test-fluegel', slot: 'back', version: 1, envelope: envelope(meshManifest('test-fluegel', 'back'), privateKey) },
      { id: 'test-begleiter', slot: 'companion', version: 1, envelope: envelope(meshManifest('test-begleiter', 'companion', { attach: { origin: [14, -7, 0], side: 'right' } }), privateKey) },
      { id: 'test-aura', slot: 'aura', version: 1, envelope: envelope(meshManifest('test-aura', 'aura'), privateKey) },
      { id: 'gross', slot: 'back', version: 1, envelope: envelope(bigMeshManifest('gross'), privateKey) },
      { id: 'mesh-kaputt', slot: 'back', version: 1, envelope: envelope(meshManifest('mesh-kaputt', 'back', { states: { idle: 'Fehlt', blendSeconds: 0 } }), privateKey) },
    ];
    const bigSize = Buffer.byteLength(fake.listings[4].envelope);
    const meshCatalog = new CosmeticCatalog({ serviceUrl: fake.url, publicKey: publicPem, cacheDir: path.join(tmp, 'format2'), auth: null, log: (line) => logs.push(line) });
    const meshItems = (await meshCatalog.catalog()).items;
    check('Format 2: Umschläge geprüft und übernommen (Reihenfolge des Katalogs)', meshItems.map((i) => i.id).join() === 'krone,test-fluegel,test-begleiter,test-aura,gross', meshItems.map((i) => i.id));
    check(`Format 2: Umschlag über 192 KB (${Math.round(bigSize / 1024)} KB) geladen und zwischengespeichert`, bigSize > 192 * 1024 && existsSync(path.join(tmp, 'format2', 'envelopes', `${sha(fake.listings[4].envelope)}.json`)));
    check('Format 2: ungültiges Manifest (Zustand ohne Animation) verworfen', rejectedLog('mesh-kaputt', /verworfen.*states\.idle/), logs.filter((l) => l.includes('mesh-kaputt')));
    const wing = meshItems.find((i) => i.id === 'test-fluegel')!;
    const mesh = wing.mesh!;
    check('Format 2: format 2 mit mesh, Felder von Format 1 leer', wing.format === 2 && !!mesh && wing.bones.length === 0 && wing.animations.length === 0 && wing.particles === null && wing.companion === null && wing.textureSize.join() === '16,16');
    check('Format 2: Mesh-Daten als Base64 wie im Manifest, ohne weiche Haut', mesh.vertexCount === 8 && mesh.triangleCount === 4 && typeof mesh.positions === 'string' && mesh.joints === null && mesh.weights === null);
    check('Format 2: Knochen und Animationen in der Reihenfolge des Manifests', mesh.skeleton.map((b) => `${b.name}:${b.parent}`).join() === 'root:-1,wing.L:0' && mesh.animations.map((a) => a.name).join() === 'Idle,Emote,Takeoff,Glide,Land', mesh.animations.map((a) => a.name));
    check('Format 2: Zustände ohne blendSeconds, Überblendzeit extra', Object.keys(mesh.states).sort().join() === 'elytra,emote,idle,land,start_flying' && mesh.states.idle === 'Idle' && mesh.blendSeconds === 0.25, mesh.states);
    check('Format 2: Leuchten (2 Bilder, Puls), Partikel ohne „minecraft:“', mesh.emissive?.frames === 2 && mesh.emissive.pulse?.min === 0.5 && wing.glow?.startsWith('data:image/png;base64,') === true && mesh.particles[0]?.particle === 'end_rod' && mesh.particles[0].states?.join() === 'Emote');
    const buddy = meshItems.find((i) => i.id === 'test-begleiter')!;
    check('Format 2: Begleiter mit attach (Ursprung, rechte Seite); Rücken ohne Ursprung', buddy.mesh?.attach.origin?.join() === '14,-7,0' && buddy.mesh.attach.side === 'right' && mesh.attach.origin === null && mesh.attach.side === 'left');
    const crown = meshItems.find((i) => i.id === 'krone')!;
    check('Format 1 daneben unverändert (format 1, kein mesh)', crown.format === 1 && crown.mesh === null && crown.bones.length === 2);

    // ---------- Format 2: Rechnung und Szene der Oberfläche (renderer/cosmetic-mesh.ts, cosmetic-scene.ts) ----------
    // Die Renderer-Module sind ES-Module: in einen eigenen Ordner mit "type": "module" kopieren und dort laden
    const esm = path.join(tmp, 'esm');
    await mkdir(esm, { recursive: true });
    await writeFile(path.join(esm, 'package.json'), '{"type":"module"}');
    const rendererDir = path.resolve(__dirname, '..', 'renderer');
    for (const file of ['cosmetic-mesh.js', 'cosmetic-scene.js']) await copyFile(path.join(rendererDir, file), path.join(esm, file));
    const lib = (await import(pathToFileURL(path.join(esm, 'cosmetic-mesh.js')).href)) as Json;
    const sceneLib = (await import(pathToFileURL(path.join(esm, 'cosmetic-scene.js')).href)) as Json;
    const rig = lib.decodeMeshRig(mesh);
    check('entpackt: 8 Ecken in Pixeln, 4 Dreiecke, UV mit v = 0 oben, Knochen je Ecke', rig.vertexCount === 8 && rig.triangles.length === 12 && nearAll(rig.positions, [-2, 2, 2.5, 2, 2, 2.5]) && nearAll(rig.uvs, [0, 0, 1, 0, 1, 1]) && rig.bone[5] === 1 && rig.parents.join() === '-1,0');
    const idle = rig.byName.get('Idle');
    const takeoff = rig.byName.get('Takeoff');
    const s225 = Math.sin(22.5 * DEG);
    const c225 = Math.cos(22.5 * DEG);
    let pose = lib.samplePose(rig, idle, 0.5);
    check('Keyframes: slerp – Frame 10 zwischen 0° (Frame 0) und 90° (Frame 20) um Z ergibt 45°', nearAll(pose.subarray(8, 12), [0, 0, s225, c225]), Array.from(pose.subarray(8, 12)));
    check('Keyframes: Knochen ohne Spur bleibt in Ruhe (Drehung 0, move 0, scale 1)', nearAll(pose.subarray(0, 8), [0, 0, 0, 1, 0, 0, 0, 1]));
    check('Keyframes: Schleife nach dem letzten Key zurück auf Key 0 (Frame 30 zwischen 90° bei Frame 20 und 0° bei Frame 40 = 45°)', nearAll(lib.samplePose(rig, idle, 1.5).subarray(8, 12), [0, 0, s225, c225]), Array.from(lib.samplePose(rig, idle, 1.5).subarray(8, 12)));
    check('Keyframes: einmalig nach dem letzten Key halten (Land: Frame 15 und 20 = 40°)', nearAll(lib.samplePose(rig, rig.byName.get('Land'), 1.5).subarray(8, 12), quat([0, 0, 1], 40)) && nearAll(lib.samplePose(rig, rig.byName.get('Land'), 5).subarray(8, 12), quat([0, 0, 1], 40)));
    check('Keyframes: loop → modulo frames (2,5 s = Frame 50 = Frame 10)', near(lib.clipFrame(idle, 2.5), 10) && nearAll(lib.samplePose(rig, idle, 2.5).subarray(8, 12), [0, 0, s225, c225]));
    pose = lib.samplePose(rig, takeoff, 0.5);
    check('Keyframes: move und scale linear (Frame 5: 2 px, × 1,5)', nearAll(pose.subarray(4, 8), [2, 0, 0, 1.5]), Array.from(pose.subarray(4, 8)));
    check('Keyframes: einmalig → am letzten Frame halten (9 s = Frame 10: 4 px, × 2)', near(lib.clipFrame(takeoff, 9), 10) && nearAll(lib.samplePose(rig, takeoff, 9).subarray(4, 8), [4, 0, 0, 2]));
    let matrices = lib.boneMatrices(rig, lib.samplePose(rig, idle, 1));
    check('Knochen-Matrix: Ecke (8, 3, 3) dreht 90° um Z um den Pivot (1, 3, 3) auf (1, 10, 3)', nearAll(lib.applyBone(matrices, 1, [8, 3, 3]), [1, 10, 3]), lib.applyBone(matrices, 1, [8, 3, 3]));
    const skinned = new Float32Array(24);
    const turned = new Float32Array(24);
    lib.skinMesh(rig, matrices, skinned, turned);
    check('Skinning: Rumpf-Ecken bleiben, Flügel-Ecke 5 auf (1, 10, 3), Normale (Drehung um Z) bleibt', nearAll(skinned, [-2, 2, 2.5]) && nearAll(skinned.subarray(15, 18), [1, 10, 3]) && nearAll(turned.subarray(15, 18), [0, 0, 1]));
    matrices = lib.boneMatrices(rig, lib.samplePose(rig, takeoff, 1));
    check('Eltern-Kette: Rumpf × 2 um den Pivot (0, 4, 2) und + 4 px in x – das Kind (Flügel) wandert mit', nearAll(lib.applyBone(matrices, 1, [8, 3, 3]), [20, 2, 4]), lib.applyBone(matrices, 1, [8, 3, 3]));
    check('Leuchten: Bild = Ticks / 3 mod 2 (0 s → 0, 0,15 s → 1, 0,3 s → 0)', lib.glowFrame(mesh.emissive, 0) === 0 && lib.glowFrame(mesh.emissive, 0.15) === 1 && lib.glowFrame(mesh.emissive, 0.3) === 0);
    check('Leuchten: Puls min + (max − min)(½ + ½ sin(2πt/period)) (0 s → 0,75; 0,5 s → 1; 1,5 s → 0,5)', near(lib.glowIntensity(mesh.emissive, 0), 0.75) && near(lib.glowIntensity(mesh.emissive, 0.5), 1) && near(lib.glowIntensity(mesh.emissive, 1.5), 0.5));
    const animator = new lib.MeshAnimator(rig);
    check('Abspielen: Start mit dem Zustand idle', animator.current === 'Idle' && animator.chosen === 'Idle');
    animator.play('Emote', 1);
    const halfway = animator.update(1.125);
    const target = lib.samplePose(rig, rig.byName.get('Emote'), 0.125);
    check('Abspielen: Wechsel überblendet (nach der halben blendSeconds weder alte noch neue Lage)', !nearAll(halfway.subarray(8, 12), Array.from(target.subarray(8, 12))) && !nearAll(halfway.subarray(8, 12), [0, 0, 0, 1]));
    check('Abspielen: nach blendSeconds genau die neue Animation', nearAll(animator.update(1.5).subarray(8, 12), Array.from(lib.samplePose(rig, rig.byName.get('Emote'), 0.5).subarray(8, 12))) && animator.chosen === 'Emote');
    animator.play('Takeoff', 2);
    animator.update(2.5);
    check('Abspielen: einmalig läuft, die gewählte Schleife bleibt gemerkt', animator.current === 'Takeoff' && animator.chosen === 'Emote');
    animator.update(3.2);
    check('Abspielen: Takeoff (start_flying) zu Ende → weiter mit Glide (elytra)', animator.current === 'Glide', animator.current);
    animator.play('Idle', 4, { immediate: true });
    check('Abspielen: immediate (Standbild) ohne Überblenden', nearAll(animator.update(4).subarray(8, 12), [0, 0, 0, 1]));

    // three.js wie in skinview3d (hier die CommonJS-Ausgabe aus node_modules), ohne WebGL – nur der Aufbau der Szene
    const THREE = require('three') as Json;
    const three = { Group: THREE.Group, Mesh: THREE.Mesh, BufferGeometry: THREE.BufferGeometry, Float32BufferAttribute: THREE.Float32BufferAttribute, MeshStandardMaterial: THREE.MeshStandardMaterial };
    const glowTexture = new THREE.Texture();
    const mount = new sceneLib.MeshMount(three, wing, new THREE.Texture(), glowTexture);
    const meshes: Json[] = [];
    mount.root.traverse((o: Json) => o.isMesh && meshes.push(o));
    check('Szene: Gruppe dreht den Body-Raum in die Szene (180° um X), nicht gespiegelt', near(mount.root.rotation.x, Math.PI) && mount.root.scale.x === 1);
    check('Szene: Albedo und Leuchten als zwei Meshes mit derselben Geometrie (12 Indizes, beidseitig)', meshes.length === 2 && meshes[0].geometry === meshes[1].geometry && meshes[0].geometry.index.count === 12 && meshes[0].material.side === THREE.DoubleSide && meshes[0].material.alphaTest === 0.1);
    const light = meshes[1].material;
    check('Szene: Leuchten additiv, ohne Licht und Glanz, nach dem Albedo gezeichnet', light.blending === THREE.AdditiveBlending && light.color.getHex() === 0 && light.metalness === 1 && light.emissiveMap === glowTexture && light.depthWrite === false && meshes[1].renderOrder === 1);
    check('Szene: Streifen 2 Bilder (repeat ½), Bild 0 oben (offset ½)', near(glowTexture.repeat.y, 0.5) && near(glowTexture.offset.y, 0.5));
    mount.update(0.15);
    check('Szene: nach 0,15 s Bild 1 (offset 0), Stärke nach Puls', near(glowTexture.offset.y, 0) && near(light.emissiveIntensity, lib.glowIntensity(mesh.emissive, 0.15)));
    mount.update(1);
    const attribute = meshes[0].geometry.getAttribute('position');
    check('Szene: Ecken je Bild bewegt (Idle nach 1 s: Flügel-Ecke 5 auf (1, 10, 3))', nearAll(attribute.array.subarray(15, 18), [1, 10, 3]) && attribute.version > 1);
    mount.play('Takeoff', 1, { immediate: true });
    mount.update(2);
    check('Szene: Animation wechseln (Takeoff zu Ende → Glide)', mount.animator.current === 'Glide');
    const extent = mount.extent();
    check('Szene: Hülle der Idle-Pose in Spielerkoordinaten am Hals (+Y oben, +Z vorn)', !!extent && nearAll(extent.min, [-2, -6, -3]) && nearAll(extent.max, [8, -2, -2.5]), extent);
    const buddyMount = new sceneLib.MeshMount(three, buddy, new THREE.Texture(), null);
    const buddyMeshes: Json[] = [];
    buddyMount.root.traverse((o: Json) => o.isMesh && buddyMeshes.push(o));
    check('Szene: Begleiter um attach.origin verschoben, rechte Seite gespiegelt, ohne glow nur ein Mesh', buddyMount.root.scale.x === -1 && buddyMeshes.length === 1 && buddyMeshes[0].parent.position.toArray().join() === '14,-7,0');
    const buddyExtent = buddyMount.extent();
    check('Szene: Hülle des Begleiters mit attach.origin (14, −7, 0)', nearAll(buddyExtent.min, [12, 1, -3]) && nearAll(buddyExtent.max, [22, 5, -2.5]), buddyExtent);
    check('Vorschaubild: Rücken schräg von hinten, Aura (Format 2) steiler von oben, sonst schräg von vorn', sceneLib.thumbnailView({ slot: 'back', mesh }).join() === '150,16' && sceneLib.thumbnailView({ slot: 'aura', mesh }).join() === '20,30' && sceneLib.thumbnailView({ slot: 'companion', mesh }).join() === '30,16');
    mount.dispose();
    buddyMount.dispose();

    // ---------- Startsatz mit dem echten öffentlichen Update-Schlüssel ----------
    const releaseDir = path.resolve(__dirname, '..', '..', 'release', 'cosmetics');
    const starters = existsSync(releaseDir) ? (await readdir(releaseDir)).filter((f) => f.endsWith('.cosmetic.json')) : [];
    if (starters.length) {
      fake.listings = await Promise.all(
        starters.map(async (file) => {
          const raw = JSON.parse(await readFile(path.join(releaseDir, file), 'utf8')) as { manifest: string; signature: string };
          const m = JSON.parse(raw.manifest) as Json;
          return { id: m.id, slot: m.slot, version: m.version, envelope: cosmeticEnvelopeText(raw) };
        }),
      );
      const real = new CosmeticCatalog({ serviceUrl: fake.url, publicKey: UPDATE_PUBLIC_KEY, cacheDir: path.join(tmp, 'echt'), auth: null, log: (line) => logs.push(line) });
      const starter = await real.catalog();
      check(`Startsatz: alle ${starters.length} Umschläge mit dem Update-Schlüssel geprüft`, starter.items.length === starters.length && starters.length >= 15, starter.items.map((i) => i.id));
      const slots = starter.items.reduce<Record<string, number>>((n, i) => ({ ...n, [i.slot]: (n[i.slot] ?? 0) + 1 }), {});
      check('Startsatz: alle Slots dabei', ['head', 'back', 'aura', 'companion', 'cape'].every((s) => (slots[s] ?? 0) > 0), slots);
      check('Startsatz: Modelle mit Flächen, Auren mit Partikeln, Capes mit Bildern, Format 2 mit Mesh und Idle',
        starter.items.every((i) => (i.mesh
          ? i.mesh.vertexCount > 0 && i.mesh.animations.some((a) => a.name === i.mesh!.states.idle)
          : i.slot === 'aura' ? !!i.particles : i.slot === 'cape' ? !!i.cape && [64, 128, 256].includes(i.textureSize[0]) : i.bones.some((b) => b.faces.length > 0))),
        starter.items.filter((i) => !i.mesh && i.slot !== 'aura' && i.slot !== 'cape' && !i.bones.length).map((i) => i.id));
      check('Startsatz: Team-Krone nur fürs Team', starter.items.find((i) => i.id === 'team-krone')?.teamOnly === true);
      for (const id of ['freundesfunken', 'freundesband']) {
        const reward = starter.items.find((i) => i.id === id);
        if (reward) check(`Startsatz: ${id} ist eine Belohnung (access unlock)`, reward.unlockOnly && !reward.teamOnly);
      }
    } else {
      console.log('  (Startsatz fehlt oder ist leer: launcher/release/cosmetics – übersprungen)');
    }
  } finally {
    await fake.stop();
    await rm(tmp, { recursive: true, force: true });
  }
  finish('Cosmetics im Launcher');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
