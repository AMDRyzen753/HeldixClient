// Prüft die Cosmetics im Launcher (core/cosmeticcatalog.ts) gegen einen Fake-Dienst: Katalog laden, Umschläge prüfen
// (falsche Signatur, falsches Präfix, verändertes Manifest, fremde ID, Prüfsumme) und still verwerfen, Zwischenspeicher
// nach sha256 (keine zweite Anfrage, auch nicht nach einem Neustart; beschädigte Datei wird neu geladen; alte Versionen
// werden gelöscht), ETag, Betrieb ohne Dienst, eigene Auswahl lesen und ändern (Prüfungen vor dem Senden, Team-Status
// aus Auswahl und 403). Zum Schluss: der Startsatz (launcher/release/cosmetics) besteht die Prüfung mit dem echten
// öffentlichen Update-Schlüssel. Signiert wird mit einem Test-Schlüssel; der private Update-Schlüssel wird nie gebraucht.
//
// Aufruf: npm run test:cosmetics-client

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { CosmeticsState } from '../shared/api';
import { CosmeticCatalog, TEAM_ONLY_MESSAGE, type CosmeticAuth } from '../main/core/cosmeticcatalog';
import { cosmeticCubeFaces, pngDataUrl } from '../main/core/cosmetics';
import { COSMETIC_SIGNATURE_PREFIX, cosmeticEnvelopeText } from '../main/core/cosmetics-format';
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
        if (req.method === 'GET') return send(200, JSON.stringify(this.mine));
        if (req.method === 'PUT') {
          let raw = '';
          req.on('data', (d: Buffer) => (raw += d.toString()));
          req.on('end', () => {
            const body = JSON.parse(raw) as Json;
            this.puts.push(body);
            if (body.id === 'team-hut' && !this.team) return send(403, JSON.stringify({ error: TEAM_ONLY_MESSAGE }));
            this.mine = { ...this.mine, [body.slot]: body.id };
            send(200, JSON.stringify(this.mine));
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
      { id: 'team-hut', slot: 'head', version: 1, envelope: envelope(manifest('team-hut', 'head', { access: 'team' }), privateKey) },
      { id: 'fluegel', slot: 'back', version: 1, envelope: envelope(manifest('fluegel', 'back'), privateKey) },
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
    const aura = result.items.find((i) => i.id === 'funken')!;
    check('aura: Partikel, keine Bones, Textur 32 × 8', !!aura.particles && aura.particles.frames === 4 && aura.particles.fullbright === false && aura.bones.length === 0 && aura.textureSize.join() === '32,8');
    const cape = result.items.find((i) => i.id === 'ozean')!;
    check('cape: Bilder und fps', cape.cape?.frames === 2 && cape.cape.fps === 4 && cape.textureSize.join() === '64,64');
    const companion = result.items.find((i) => i.id === 'drache')!;
    check('companion: Platz und Größe', companion.companion?.offset.join() === '0.7,1.6,-0.4' && companion.companion.scale === 0.8);
    check('back: Leuchtebene', result.items.find((i) => i.id === 'fluegel')!.glow?.startsWith('data:image/png;base64,') === true);

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

    // ---------- Startsatz mit dem echten öffentlichen Update-Schlüssel ----------
    const releaseDir = path.resolve(__dirname, '..', '..', 'release', 'cosmetics');
    if (existsSync(releaseDir)) {
      const starters = (await readdir(releaseDir)).filter((f) => f.endsWith('.cosmetic.json'));
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
      check('Startsatz: Modelle mit Flächen, Auren mit Partikeln, Capes mit Bildern',
        starter.items.every((i) => (i.slot === 'aura' ? !!i.particles : i.slot === 'cape' ? !!i.cape && [64, 128, 256].includes(i.textureSize[0]) : i.bones.some((b) => b.faces.length > 0))));
      check('Startsatz: Team-Krone nur fürs Team', starter.items.find((i) => i.id === 'team-krone')?.teamOnly === true);
    } else {
      console.log('  (Startsatz fehlt: launcher/release/cosmetics – übersprungen)');
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
