// Voice Chat im Browser (ab 1.11.0): Gast-Zugang über eine Einladung mit Gruppe, Anmeldung per Unterprotokoll
// gast.<token> oder Web-Cookie (mit Origin-Prüfung), join mit invite (nur Gruppe, kein Raum), Sprache Gast ↔ Gruppe,
// peers mit guests und browser, kick, Widerruf, höchstens 4 Gäste, Ablauf, Datenschutz.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { WebSocket } from 'ws';
import type { ServiceOptions } from '../src/app';
import { SESSION_COOKIE } from '../src/web';
import { api, devPlayer, sleep, startService, upgradeStatus, waitFor, type Player, type TestService } from './helpers';
import { webLogin, WEBSITE } from './web-helpers';

const SERVER = 'mc.example.net';
const OVERWORLD = 'minecraft:overworld';
const NETHER = 'minecraft:the_nether';
const GROUP = createHash('sha256').update('Bande\ngeheim').digest('hex');
const OTHER_GROUP = createHash('sha256').update('Andere\ngeheim').digest('hex');
const NAME_ERROR = 'Der Name muss 3 bis 16 Zeichen lang sein: Buchstaben, Ziffern, Leerzeichen, _ . und -.';

type Text = any;

/** Sprach-Rahmen wie vom Client: `[Version][Flags][Folgenummer][Opus]`. */
function frame(seq: number, payload: number[] = [1, 2, 3], flags = 0): Buffer {
  const out = Buffer.alloc(4 + payload.length);
  out[0] = 1;
  out[1] = flags;
  out.writeUInt16BE(seq, 2);
  Buffer.from(payload).copy(out, 4);
  return out;
}

/** WebSocket-Client für /v1/voice: Textnachrichten und Sprach-Rahmen getrennt. */
class VoiceClient {
  readonly texts: Text[] = [];
  readonly rooms: Text[] = [];
  readonly frames: Buffer[] = [];
  private waiters: { match: (m: Text) => boolean; resolve: (m: Text) => void }[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.frames.push(Buffer.from(data as Buffer));
        return;
      }
      const message = JSON.parse(String(data));
      const index = this.waiters.findIndex((w) => w.match(message));
      if (index >= 0) this.waiters.splice(index, 1)[0]!.resolve(message);
      // ab 1.13.0: `room` nach jedem join getrennt, damit die Prüfungen auf den Rest wie bisher bleiben
      else if (message.type === 'room') this.rooms.push(message);
      else this.texts.push(message);
    });
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })));
  }

  next(match: string | ((m: Text) => boolean), timeoutMs = 3000): Promise<Text> {
    const fn = typeof match === 'string' ? (m: Text) => m.type === match : match;
    const index = this.texts.findIndex(fn);
    if (index >= 0) return Promise.resolve(this.texts.splice(index, 1)[0]);
    const room = this.rooms.findIndex(fn);
    if (room >= 0) return Promise.resolve(this.rooms.splice(room, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        match: fn,
        resolve: (m: Text) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Keine passende Nachricht erhalten. Gepuffert: ${JSON.stringify(this.texts)}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  async sync(): Promise<void> {
    this.send({ type: 'ping' });
    await this.next('pong');
  }

  /** Letzte `peers`-Nachricht nach einem Abgleich (ältere fallen weg). */
  async lastPeers(): Promise<Text> {
    await this.sync();
    const all = this.texts.filter((m) => m.type === 'peers');
    this.texts.splice(0, this.texts.length, ...this.texts.filter((m) => m.type !== 'peers'));
    assert.ok(all.length > 0, 'keine peers-Nachricht');
    return all[all.length - 1];
  }

  speak(seq: number): void {
    this.ws.send(frame(seq));
  }

  /** Sprecher-IDs der empfangenen Rahmen (danach leer). */
  heard(): string[] {
    return this.frames.splice(0, this.frames.length).map((data) => data.subarray(4, 20).toString('hex'));
  }

  drain(): Text[] {
    return this.texts.splice(0, this.texts.length);
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close();
    await this.closed;
  }
}

interface Guest {
  token: string;
  id: string;
  name: string;
  expires: number;
}

interface Setup {
  service: TestService;
  voiceUrl: string;
  player(name: string): Promise<Player>;
  /** Spiel: Bearer-Token */
  game(player: Player): Promise<VoiceClient>;
  /** Browser: Gast mit Unterprotokoll */
  guestClient(guest: Guest, origin?: string): Promise<VoiceClient>;
  /** Browser: angemeldet mit Cookie */
  cookieClient(cookie: string, origin?: string): Promise<VoiceClient>;
  voiceInvite(player: Player, group?: string): Promise<string>;
  guest(code: string, name?: string, headers?: Record<string, string>): ReturnType<typeof api>;
  newGuest(code: string, name?: string): Promise<Guest>;
  sql(statement: string, ...params: (string | number | null)[]): void;
}

async function open(client: VoiceClient): Promise<VoiceClient> {
  await new Promise<void>((resolve, reject) => {
    client.ws.once('open', () => resolve());
    client.ws.once('error', reject);
    client.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return client;
}

async function withGuests(options: Partial<ServiceOptions>, run: (setup: Setup) => Promise<void>): Promise<void> {
  const service = await startService({ dev: true, website: WEBSITE, guestRateLimit: 1000, ...options });
  const voiceUrl = `${service.url.replace('http', 'ws')}/v1/voice`;
  const clients: VoiceClient[] = [];
  const track = (client: VoiceClient) => {
    clients.push(client);
    return client;
  };
  let guestNumber = 0;
  const guest = (code: string, name = `Gast ${++guestNumber}`, headers: Record<string, string> = { Origin: WEBSITE }) =>
    api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name }, headers });
  try {
    await run({
      service,
      voiceUrl,
      player: (name) => devPlayer(service.url, name),
      game: async (player) => open(track(new VoiceClient(new WebSocket(voiceUrl, { headers: { Authorization: `Bearer ${player.token}` } })))),
      guestClient: async (g, origin = WEBSITE) => open(track(new VoiceClient(new WebSocket(voiceUrl, ['heldix-voice', `gast.${g.token}`], { origin })))),
      cookieClient: async (cookie, origin = WEBSITE) =>
        open(track(new VoiceClient(new WebSocket(voiceUrl, ['heldix-voice'], { origin, headers: { Cookie: `${SESSION_COOKIE}=${cookie}` } })))),
      async voiceInvite(player, group = GROUP) {
        const res = await api(service.url, 'POST', '/v1/invites', { token: player.token, body: { server: SERVER, voice: { group } } });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        return res.body.code;
      },
      guest,
      async newGuest(code, name) {
        const res = await guest(code, name);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        return res.body;
      },
      sql(statement, ...params) {
        const db = new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));
        try {
          db.exec('PRAGMA busy_timeout = 5000');
          db.prepare(statement).run(...params);
        } finally {
          db.close();
        }
      },
    });
  } finally {
    for (const client of clients) await client.close();
    await service.close();
  }
}

/** Spieler im Spiel betritt Raum und Gruppe und bekommt seine Liste. */
async function enterGame(client: VoiceClient, dimension = OVERWORLD, group: string | null = GROUP): Promise<Text> {
  await client.next('ready');
  client.send({ type: 'join', server: SERVER, dimension, group });
  return client.next('peers');
}

/** Teilnehmer im Browser betritt die Gruppe der Einladung. */
async function enterInvite(client: VoiceClient, code: string): Promise<Text> {
  await client.next('ready');
  client.send({ type: 'join', invite: code });
  return client.next('peers');
}

describe('Voice im Browser: Gast-Zugang', () => {
  test('POST /v1/public/invites/<code>/guest: Name prüfen, Felder, Ablauf, nur Einladungen mit Voice, Origin', async () => {
    await withGuests({}, async ({ service, player, voiceInvite, guest }) => {
      const anna = await player('Anna');
      const code = await voiceInvite(anna);
      for (const name of ['ab', '  ab  ', 'a'.repeat(17), 'Böse<Name>', 'tab\tname', '...', '', 5, null]) {
        const res = await api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name }, headers: { Origin: WEBSITE } });
        assert.equal(res.status, 400, JSON.stringify(name));
        assert.equal(res.body.error, NAME_ERROR);
      }
      const before = Date.now();
      const res = await guest(code, '  Jörg Große_1.-  ');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual(Object.keys(res.body).sort(), ['expires', 'id', 'name', 'token']);
      assert.equal(res.body.name, 'Jörg Große_1.-');
      assert.match(res.body.id, /^[0-9a-f]{32}$/);
      assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(res.body.expires >= before + 6 * 60 * 60 * 1000 && res.body.expires <= Date.now() + 6 * 60 * 60 * 1000, 'höchstens 6 Stunden');
      // Ohne Origin (kein Browser) geht es, von fremden Seiten nicht
      assert.equal((await guest(code, 'Ohne Origin', {})).status, 200);
      assert.equal((await guest(code, 'Fremd', { Origin: 'https://fremd.example' })).status, 403);

      // Nur offene Einladungen mit Voice
      const plain = (await api(service.url, 'POST', '/v1/invites', { token: anna.token, body: { server: SERVER } })).body.code;
      for (const bad of [plain, 'abcdefghij', 'kurz']) {
        const missing = await guest(bad, 'Max');
        assert.equal(missing.status, 404, bad);
        assert.equal(missing.body.error, 'Diese Einladung gibt es nicht (mehr), oder sie lädt nicht in den Voice Chat ein.');
      }
    });
  });

  test('Gast-Zugang nie länger als die Einladung; eigene Grenze pro IP', async () => {
    await withGuests({ guestRateLimit: 2 }, async ({ player, voiceInvite, guest, sql }) => {
      const code = await voiceInvite(await player('Anna'));
      const until = Date.now() + 60_000;
      sql('UPDATE invites SET expires_at = ? WHERE code = ?', until, code);
      const res = await guest(code, 'Max');
      assert.equal(res.body.expires, until);
      assert.equal((await guest(code, 'Moritz')).status, 200);
      const limited = await guest(code, 'Zu viel');
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal(limited.body.error, 'Zu viele Gast-Zugänge. Bitte in ein paar Minuten noch einmal.');
    });
  });

  test('Voice Chat aus: 503', async () => {
    await withGuests({ voice: false }, async ({ service, player }) => {
      const anna = await player('Anna');
      const code = (await api(service.url, 'POST', '/v1/invites', { token: anna.token, body: { server: SERVER } })).body.code;
      const res = await api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name: 'Max' } });
      assert.equal(res.status, 503);
    });
  });
});

describe('Voice im Browser: Verbindung', () => {
  test('Gast mit Unterprotokoll: heldix-voice gewählt, ready mit guests; falscher Origin 403, falsches oder abgelaufenes Token 401', async () => {
    await withGuests({}, async ({ voiceUrl, player, voiceInvite, newGuest, guestClient, sql }) => {
      const code = await voiceInvite(await player('Anna'));
      const max = await newGuest(code, 'Max');
      const client = await guestClient(max);
      assert.equal(client.ws.protocol, 'heldix-voice');
      assert.deepEqual(await client.next('ready'), {
        type: 'ready',
        range: 48,
        maxFrame: 1024,
        protocol: 1,
        // ab 1.14.0: Server-Gruppen der Partner-Server (größer als eigene Gruppen)
        features: ['state', 'groups', 'guests', 'moderation', 'serverGroups'],
        maxGroup: 16,
        maxServerGroup: 100,
        rules: null,
        clips: null,
      });
      client.send({ type: 'ping' });
      assert.deepEqual(await client.next('pong'), { type: 'pong' });

      const protocols = (token: string) => ({ 'Sec-WebSocket-Protocol': `heldix-voice, gast.${token}` });
      assert.equal((await upgradeStatus(voiceUrl, { ...protocols(max.token), Origin: 'https://fremd.example' })).status, 403);
      assert.equal((await upgradeStatus(voiceUrl, protocols(max.token))).status, 403, 'ohne Origin, obwohl eine Webseite eingerichtet ist');
      const wrong = await upgradeStatus(voiceUrl, { ...protocols('A'.repeat(43)), Origin: WEBSITE });
      assert.equal(wrong.status, 401);
      assert.equal(JSON.parse(wrong.body).error, 'Der Gast-Zugang ist abgelaufen. Öffne den Einladungs-Link noch einmal.');
      assert.equal((await upgradeStatus(voiceUrl, { ...protocols('kaputt'), Origin: WEBSITE })).status, 401);
      // Einladung abgelaufen: das Token gilt nicht mehr
      const moritz = await newGuest(code, 'Moritz');
      sql('UPDATE invites SET expires_at = ? WHERE code = ?', Date.now() - 1, code);
      assert.equal((await upgradeStatus(voiceUrl, { ...protocols(moritz.token), Origin: WEBSITE })).status, 401);
    });
  });

  test('ohne Webseite: Gäste ohne Origin-Prüfung, Cookie-Verbindungen gibt es nicht', async () => {
    await withGuests({ website: null }, async ({ voiceUrl, player, voiceInvite, newGuest, guestClient }) => {
      const code = await voiceInvite(await player('Anna'));
      const client = await guestClient(await newGuest(code, 'Max'), 'https://irgendwo.example');
      assert.equal((await client.next('ready')).type, 'ready');
      assert.equal((await upgradeStatus(voiceUrl, { Cookie: `${SESSION_COOKIE}=${'a'.repeat(43)}` })).status, 403);
    });
  });

  test('Gast-Sitzung läuft ab: 4005', async () => {
    await withGuests({}, async ({ player, voiceInvite, newGuest, guestClient, sql }) => {
      const code = await voiceInvite(await player('Anna'));
      sql('UPDATE invites SET expires_at = ? WHERE code = ?', Date.now() + 400, code);
      const client = await guestClient(await newGuest(code, 'Max'));
      await enterInvite(client, code);
      assert.deepEqual(await client.closed, { code: 4005, reason: 'Sitzung abgelaufen' });
    });
  });

  test('angemeldet im Browser (Cookie): Origin muss die Webseite sein, ersetzt eine Verbindung desselben Spielers (4002)', async () => {
    await withGuests({}, async ({ service, voiceUrl, player, game, cookieClient }) => {
      const ben = await player('Ben');
      const { cookie } = await webLogin(service, ben);
      const cookieHeader = { Cookie: `${SESSION_COOKIE}=${cookie}` };
      assert.equal((await upgradeStatus(voiceUrl, cookieHeader)).status, 403, 'ohne Origin');
      assert.equal((await upgradeStatus(voiceUrl, { ...cookieHeader, Origin: 'https://fremd.example' })).status, 403);
      assert.equal((await upgradeStatus(voiceUrl, { Cookie: `${SESSION_COOKIE}=${'b'.repeat(43)}`, Origin: WEBSITE })).status, 401);
      const inGame = await game(ben);
      await inGame.next('ready');
      const browser = await cookieClient(cookie);
      assert.equal(browser.ws.protocol, 'heldix-voice');
      assert.equal((await browser.next('ready')).type, 'ready');
      assert.deepEqual(await inGame.closed, { code: 4002, reason: 'Neue Verbindung' });
      // Konto gelöscht: auch die Verbindung im Browser zu
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: ben.token })).status, 200);
      assert.equal((await browser.closed).code, 4001);
    });
  });
});

describe('Voice im Browser: Gruppe der Einladung', () => {
  test('join mit invite: nur die Gruppe, peers mit guests und browser, Sprache Gast ↔ Gruppe (auch andere Dimension), nicht an den Raum', async () => {
    await withGuests({}, async ({ service, player, game, voiceInvite, newGuest, guestClient, cookieClient }) => {
      const [anna, ben, carla, dora] = [await player('Anna'), await player('Ben'), await player('Carla'), await player('Dora')];
      const code = await voiceInvite(anna);
      const annaGame = await game(anna);
      const carlaGame = await game(carla);
      const doraGame = await game(dora);
      await enterGame(annaGame, OVERWORLD);
      await enterGame(carlaGame, NETHER);
      // Dora: gleicher Raum wie Anna, aber nicht in der Gruppe
      await enterGame(doraGame, OVERWORLD, null);

      const max = await newGuest(code, 'Max');
      const maxClient = await guestClient(max);
      const own = await enterInvite(maxClient, code);
      assert.deepEqual(own.uuids, [], 'kein Raum');
      assert.deepEqual([...own.group].sort(), [anna.uuid, carla.uuid].sort());
      assert.deepEqual([own.guests, own.browser], [{}, []]);

      const annaPeers = await annaGame.lastPeers();
      assert.deepEqual([...annaPeers.group].sort(), [carla.uuid, max.id].sort());
      assert.deepEqual(annaPeers.guests, { [max.id]: 'Max' });
      assert.deepEqual(annaPeers.browser, [max.id]);
      assert.deepEqual(annaPeers.uuids, [dora.uuid]);
      await doraGame.sync();
      assert.deepEqual(doraGame.drain().filter((m) => m.type === 'peers'), [], 'Dora merkt den Gast nicht');

      // Ben im Browser (Cookie) kommt dazu
      const { cookie } = await webLogin(service, ben);
      const benBrowser = await cookieClient(cookie);
      const benPeers = await enterInvite(benBrowser, code);
      assert.deepEqual([...benPeers.group].sort(), [anna.uuid, carla.uuid, max.id].sort());
      assert.deepEqual(benPeers.guests, { [max.id]: 'Max' });
      assert.deepEqual(benPeers.browser, [max.id]);
      const carlaPeers = await carlaGame.lastPeers();
      assert.deepEqual(carlaPeers.guests, { [max.id]: 'Max' });
      assert.deepEqual([...carlaPeers.browser].sort(), [ben.uuid, max.id].sort());

      // Gast spricht: die Gruppe hört (auch Carla im Nether, Ben im Browser), Dora im selben Raum nicht
      maxClient.speak(1);
      await maxClient.sync();
      for (const client of [annaGame, carlaGame, benBrowser, doraGame]) await client.sync();
      assert.deepEqual([annaGame.heard(), carlaGame.heard(), benBrowser.heard(), doraGame.heard()], [[max.id], [max.id], [max.id], []]);
      // Carla spricht im Nether: der Gast hört sie
      carlaGame.speak(2);
      await carlaGame.sync();
      for (const client of [annaGame, maxClient, benBrowser, doraGame]) await client.sync();
      assert.deepEqual([annaGame.heard(), maxClient.heard(), benBrowser.heard(), doraGame.heard()], [[carla.uuid], [carla.uuid], [carla.uuid], []]);
      // Ben im Browser spricht: alle in der Gruppe
      benBrowser.speak(3);
      await benBrowser.sync();
      for (const client of [annaGame, maxClient, doraGame]) await client.sync();
      assert.deepEqual([annaGame.heard(), maxClient.heard(), doraGame.heard()], [[ben.uuid], [ben.uuid], []]);

      // Status eines Gasts geht an die Gruppe
      maxClient.send({ type: 'state', muted: true, deafened: false });
      assert.deepEqual(await annaGame.next('state'), { type: 'state', uuid: max.id, muted: true, deafened: false });

      // Gäste können keinen Raum betreten und keine Position schicken
      await maxClient.sync();
      maxClient.drain();
      maxClient.send({ type: 'join', server: SERVER, dimension: OVERWORLD, group: GROUP });
      maxClient.send({ type: 'pos', x: 0, y: 64, z: 0 });
      await maxClient.sync();
      assert.deepEqual(maxClient.drain().filter((m) => m.type === 'peers'), []);

      // leave: aus der Gruppe, Verbindung bleibt
      maxClient.send({ type: 'leave' });
      const left = await maxClient.next('peers');
      assert.deepEqual([left.uuids, left.group], [[], []]);
      assert.deepEqual((await annaGame.lastPeers()).guests, {});
    });
  });

  test('ungültige Einladung beim join: invite invalid und 4006; Gäste nur mit dem Code ihrer Sitzung', async () => {
    await withGuests({}, async ({ service, player, game, voiceInvite, newGuest, guestClient, cookieClient }) => {
      const anna = await player('Anna');
      const code = await voiceInvite(anna);
      const other = await voiceInvite(anna, OTHER_GROUP);
      const plain = (await api(service.url, 'POST', '/v1/invites', { token: anna.token, body: { server: SERVER } })).body.code;

      const max = await guestClient(await newGuest(code, 'Max'));
      await max.next('ready');
      max.send({ type: 'join', invite: other });
      assert.deepEqual(await max.next('invite'), { type: 'invite', status: 'invalid' });
      assert.deepEqual(await max.closed, { code: 4006, reason: 'Einladung ungültig' });

      const ben = await player('Ben');
      const { cookie } = await webLogin(service, ben);
      for (const invite of [plain, 'abcdefghij', 42]) {
        const browser = await cookieClient(cookie);
        await browser.next('ready');
        browser.send({ type: 'join', invite });
        assert.deepEqual(await browser.next('invite'), { type: 'invite', status: 'invalid' }, String(invite));
        assert.equal((await browser.closed).code, 4006);
      }
      // Ein Spieler im Spiel darf auch über die Einladung beitreten (nur Gruppe)
      const carla = await game(await player('Carla'));
      const peers = await enterInvite(carla, other);
      assert.deepEqual([peers.uuids, peers.group], [[], []]);
    });
  });

  test('kick: nur Nicht-Gäste derselben Gruppe entfernen Gäste (4004), das Token gilt danach nicht mehr', async () => {
    await withGuests({}, async ({ voiceUrl, player, game, voiceInvite, newGuest, guestClient }) => {
      const [anna, carla] = [await player('Anna'), await player('Carla')];
      const code = await voiceInvite(anna);
      const annaGame = await game(anna);
      await enterGame(annaGame);
      const carlaGame = await game(carla);
      await enterGame(carlaGame, OVERWORLD, OTHER_GROUP);
      const max = await newGuest(code, 'Max');
      const moritz = await newGuest(code, 'Moritz');
      const maxClient = await guestClient(max);
      const moritzClient = await guestClient(moritz);
      await enterInvite(maxClient, code);
      await enterInvite(moritzClient, code);

      // Gast entfernt Gast, Carla (andere Gruppe) entfernt Gast, Anna entfernt Carla oder sich selbst: nichts
      moritzClient.send({ type: 'kick', uuid: max.id });
      carlaGame.send({ type: 'kick', uuid: max.id });
      annaGame.send({ type: 'kick', uuid: carla.uuid });
      annaGame.send({ type: 'kick', uuid: anna.uuid });
      annaGame.send({ type: 'kick', uuid: 'kein-gast' });
      for (const client of [moritzClient, carlaGame, annaGame, maxClient]) await client.sync();
      assert.equal(maxClient.ws.readyState, WebSocket.OPEN);
      assert.equal(carlaGame.ws.readyState, WebSocket.OPEN);

      annaGame.send({ type: 'kick', uuid: max.id });
      assert.deepEqual(await maxClient.closed, { code: 4004, reason: 'Aus der Gruppe entfernt' });
      await waitFor(async () => !(await annaGame.lastPeers()).group.includes(max.id));
      const status = await upgradeStatus(voiceUrl, { 'Sec-WebSocket-Protocol': `heldix-voice, gast.${max.token}`, Origin: WEBSITE });
      assert.equal(status.status, 401, 'Token ungültig');
      assert.equal(moritzClient.ws.readyState, WebSocket.OPEN);
    });
  });

  test('Widerruf: Gäste fliegen sofort raus (4004), Angemeldete im Browser bekommen invite invalid (4006); Spieler im Spiel bleiben', async () => {
    await withGuests({}, async ({ service, player, game, voiceInvite, newGuest, guestClient, cookieClient }) => {
      const [anna, ben] = [await player('Anna'), await player('Ben')];
      const code = await voiceInvite(anna);
      const annaGame = await game(anna);
      await enterGame(annaGame);
      const maxClient = await guestClient(await newGuest(code, 'Max'));
      await enterInvite(maxClient, code);
      const { cookie } = await webLogin(service, ben);
      const benBrowser = await cookieClient(cookie);
      await enterInvite(benBrowser, code);
      const unused = await newGuest(code, 'Später');

      assert.equal((await api(service.url, 'DELETE', `/v1/invites/${code}`, { token: anna.token })).status, 200);
      assert.deepEqual(await maxClient.closed, { code: 4004, reason: 'Aus der Gruppe entfernt' });
      assert.deepEqual(await benBrowser.next('invite'), { type: 'invite', status: 'invalid' });
      assert.deepEqual(await benBrowser.closed, { code: 4006, reason: 'Einladung ungültig' });
      assert.equal(annaGame.ws.readyState, WebSocket.OPEN);
      const peers = await annaGame.lastPeers();
      assert.deepEqual([peers.group, peers.guests, peers.browser], [[], {}, []]);
      const status = await upgradeStatus(`${service.url.replace('http', 'ws')}/v1/voice`, {
        'Sec-WebSocket-Protocol': `heldix-voice, gast.${unused.token}`,
        Origin: WEBSITE,
      });
      assert.equal(status.status, 401);
    });
  });

  test('Konto des Einladenden gelöscht: seine Gäste werden getrennt; abgelaufene Einladung: beim ping 4006', async () => {
    await withGuests({}, async ({ service, player, voiceInvite, newGuest, guestClient, cookieClient, sql }) => {
      const [anna, ben] = [await player('Anna'), await player('Ben')];
      const code = await voiceInvite(anna);
      const maxClient = await guestClient(await newGuest(code, 'Max'));
      await enterInvite(maxClient, code);
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: anna.token })).status, 200);
      assert.equal((await maxClient.closed).code, 4004);

      const carla = await player('Carla');
      const second = await voiceInvite(carla);
      const { cookie } = await webLogin(service, ben);
      const benBrowser = await cookieClient(cookie);
      await enterInvite(benBrowser, second);
      sql('UPDATE invites SET expires_at = ? WHERE code = ?', Date.now() - 1, second);
      benBrowser.send({ type: 'ping' });
      assert.deepEqual(await benBrowser.next('invite'), { type: 'invite', status: 'invalid' });
      assert.equal((await benBrowser.closed).code, 4006);
    });
  });

  test('höchstens 4 Gäste je Einladung: der fünfte bekommt 409 beim Anlegen bzw. 4007 beim Verbinden; öffentliche Ansicht zählt mit', async () => {
    await withGuests({}, async ({ service, player, game, voiceInvite, newGuest, guest, guestClient }) => {
      const anna = await player('Anna');
      const code = await voiceInvite(anna);
      const annaGame = await game(anna);
      await enterGame(annaGame);
      const sessions = [];
      for (let i = 1; i <= 5; i++) sessions.push(await newGuest(code, `Gast ${i}`));
      const clients = [];
      for (const session of sessions.slice(0, 4)) {
        const client = await guestClient(session);
        await enterInvite(client, code);
        clients.push(client);
      }
      assert.deepEqual((await api(service.url, 'GET', `/v1/public/invites/${code}`)).body.voice, { members: 1, guests: 4, maxGuests: 4 });
      const full = await guest(code, 'Noch einer');
      assert.equal(full.status, 409);
      assert.equal(full.body.error, 'Die Gruppe ist voll: Höchstens 4 Gäste können gleichzeitig mitreden.');
      const fifth = await guestClient(sessions[4]!);
      assert.deepEqual(await fifth.closed, { code: 4007, reason: 'Voll' });
      // Derselbe Gast noch einmal: ersetzt seine alte Verbindung (4002), kein „Voll“
      const again = await guestClient(sessions[0]!);
      assert.equal((await again.next('ready')).type, 'ready');
      assert.deepEqual(await clients[0]!.closed, { code: 4002, reason: 'Neue Verbindung' });
      // Platz frei: jetzt klappt es
      await clients[1]!.close();
      await waitFor(async () => (await api(service.url, 'GET', `/v1/public/invites/${code}`)).body.voice.guests === 3);
      const now = await guestClient(sessions[4]!);
      assert.equal((await now.next('ready')).type, 'ready');
    });
  });

  test('Gäste lassen sich nicht blockieren; Blockieren zwischen Spielern gilt auch mit dem Browser', async () => {
    await withGuests({}, async ({ service, player, game, voiceInvite, newGuest, guestClient, cookieClient }) => {
      const [anna, ben] = [await player('Anna'), await player('Ben')];
      const code = await voiceInvite(anna);
      const annaGame = await game(anna);
      await enterGame(annaGame);
      const { cookie } = await webLogin(service, ben);
      const benBrowser = await cookieClient(cookie);
      await enterInvite(benBrowser, code);
      const max = await newGuest(code, 'Max');
      const maxClient = await guestClient(max);
      await enterInvite(maxClient, code);
      assert.equal((await api(service.url, 'POST', '/v1/blocks', { token: anna.token, body: { uuid: ben.uuid } })).status, 200);
      benBrowser.speak(1);
      await benBrowser.sync();
      await annaGame.sync();
      await maxClient.sync();
      assert.deepEqual([annaGame.heard(), maxClient.heard()], [[], [ben.uuid]]);
      // Blockieren eines Gasts: Er hat kein Konto (404), er bleibt hörbar
      assert.equal((await api(service.url, 'POST', '/v1/blocks', { token: anna.token, body: { uuid: max.id } })).status, 404);
      maxClient.speak(2);
      await maxClient.sync();
      await annaGame.sync();
      assert.deepEqual(annaGame.heard(), [max.id]);
    });
  });

  test('Datenschutz: weder Gastnamen noch Tokens, Codes oder Gruppen landen in Log oder Datenbank', async () => {
    await withGuests({}, async ({ service, player, game, voiceInvite, newGuest, guestClient }) => {
      const anna = await player('Anna');
      const code = await voiceInvite(anna);
      const annaGame = await game(anna);
      await enterGame(annaGame);
      const max = await newGuest(code, 'Geheimer Gast');
      const client = await guestClient(max);
      await enterInvite(client, code);
      client.speak(1);
      await client.sync();
      annaGame.send({ type: 'kick', uuid: max.id });
      await client.closed;
      await sleep(20);
      const logged = service.logs.join('\n');
      for (const needle of ['Geheimer Gast', max.token, max.id, code, GROUP]) assert.equal(logged.includes(needle), false, `im Log: ${needle}`);
      for (const file of fs.readdirSync(service.dataDir)) {
        const full = path.join(service.dataDir, file);
        if (!fs.statSync(full).isFile()) continue;
        const content = fs.readFileSync(full);
        for (const needle of ['Geheimer Gast', max.token, max.id]) assert.equal(content.includes(needle), false, `in ${file}: ${needle}`);
      }
    });
  });
});
