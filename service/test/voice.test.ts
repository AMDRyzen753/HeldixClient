// Voice Chat über /v1/voice: Anmeldung, Räume, Gruppen, Status, Weiterleiten nur in der Nähe oder in der Gruppe, Grenzen, Trennen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { createService, type ServiceOptions } from '../src/app';
import { Store } from '../src/db';
import { Voice } from '../src/voice';
import { api, befriend, devPlayer, randomUuid, startService, upgradeStatus, waitFor, type Player, type TestService } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

const SERVER = 'mc.example.net';
const OVERWORLD = 'minecraft:overworld';
const NETHER = 'minecraft:the_nether';
const THE_END = 'minecraft:the_end';

/** Prüfwert einer Gruppe wie vom Client: SHA-256 aus Gruppenname und Passwort. */
function groupHash(name: string, password = 'geheim'): string {
  return createHash('sha256').update(`${name}\n${password}`).digest('hex');
}
const GROUP = groupHash('Bande');
const OTHER_GROUP = groupHash('Andere');

interface Peers {
  uuids: string[];
  group: string[];
  muted: string[];
  deafened: string[];
}

/** Erwartete `peers`-Felder (sortiert). */
function peers(uuids: string[] = [], group: string[] = [], muted: string[] = [], deafened: string[] = []): Peers {
  return { uuids: [...uuids].sort(), group: [...group].sort(), muted: [...muted].sort(), deafened: [...deafened].sort() };
}

/** Uhr des Voice Chats: läuft mit der echten Zeit, lässt sich vorstellen und anhalten. */
class VoiceClock {
  private offset = 0;
  private frozenAt: number | null = null;
  readonly read = () => this.frozenAt ?? Date.now() + this.offset;
  advance(ms: number): void {
    if (this.frozenAt !== null) this.frozenAt += ms;
    else this.offset += ms;
  }
  freeze(): void {
    this.frozenAt = this.read();
  }
}

type Text = any;

/** Eine `peers`-Nachricht: immer alle vier Felder, verglichen ohne Reihenfolge. */
function peersOf(message: Text): Peers {
  assert.equal(message.type, 'peers');
  assert.deepEqual(Object.keys(message).sort(), ['deafened', 'group', 'muted', 'type', 'uuids']);
  return peers(message.uuids, message.group, message.muted, message.deafened);
}

interface Frame {
  version: number;
  flags: number;
  seq: number;
  speaker: string;
  payload: Buffer;
}

function parseFrame(data: Buffer): Frame {
  return {
    version: data[0]!,
    flags: data[1]!,
    seq: data.readUInt16BE(2),
    speaker: data.subarray(4, 20).toString('hex'),
    payload: Buffer.from(data.subarray(20)),
  };
}

/** Sprach-Rahmen wie vom Client: `[Version][Flags][Folgenummer][Opus]`. */
function frame(seq: number, payload: Buffer | number[], flags = 0, version = 1): Buffer {
  const data = Buffer.from(payload);
  const out = Buffer.alloc(4 + data.length);
  out[0] = version;
  out[1] = flags;
  out.writeUInt16BE(seq, 2);
  data.copy(out, 4);
  return out;
}

/** WebSocket-Client für /v1/voice: sammelt Textnachrichten und Sprach-Rahmen getrennt. */
class VoiceClient {
  readonly texts: Text[] = [];
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
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        waiter!.resolve(message);
      } else {
        this.texts.push(message);
      }
    });
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })));
  }

  next(match: string | ((m: Text) => boolean), timeoutMs = 3000): Promise<Text> {
    const fn = typeof match === 'string' ? (m: Text) => m.type === match : match;
    const index = this.texts.findIndex(fn);
    if (index >= 0) return Promise.resolve(this.texts.splice(index, 1)[0]);
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

  /** Raum betreten und die eigene `peers`-Nachricht abwarten (sortiert). */
  async join(server: string, dimension: string, mode?: string): Promise<string[]> {
    this.send(mode === undefined ? { type: 'join', server, dimension } : { type: 'join', server, dimension, mode });
    return [...(await this.next('peers')).uuids].sort();
  }

  /** Raum und Gruppe (`null`: keine) betreten und die eigene `peers`-Nachricht abwarten. */
  async enter(server: string, dimension: string, group: string | null, mode?: string): Promise<Peers> {
    this.send(mode === undefined ? { type: 'join', server, dimension, group } : { type: 'join', server, dimension, group, mode });
    return this.nextPeers();
  }

  async nextPeers(): Promise<Peers> {
    return peersOf(await this.next('peers'));
  }

  state(muted: boolean, deafened: boolean): void {
    this.send({ type: 'state', muted, deafened });
  }

  pos(x: number, y: number, z: number): void {
    this.send({ type: 'pos', x, y, z });
  }

  speak(seq: number, payload: Buffer | number[] = [1, 2, 3], flags = 0): void {
    this.ws.send(frame(seq, payload, flags));
  }

  /** Ping-Pong-Runde: Danach liegt alles im Puffer, was der Dienst vorher an diese Verbindung geschickt hat. */
  async sync(): Promise<void> {
    this.send({ type: 'ping' });
    await this.next('pong');
  }

  drain(): Text[] {
    return this.texts.splice(0, this.texts.length);
  }

  takeFrames(): Frame[] {
    return this.frames.splice(0, this.frames.length).map(parseFrame);
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close();
    await this.closed;
  }
}

function voiceUrl(service: TestService): string {
  return `${service.url.replace('http', 'ws')}/v1/voice`;
}

interface Setup {
  service: TestService;
  clock: VoiceClock;
  /** Verbindet einen Spieler mit dem Voice Chat; liefert Client und `ready`. */
  connect(player: Player): Promise<{ client: VoiceClient; ready: Text }>;
  player(name: string): Promise<Player>;
}

/** Startet einen Dienst mit stellbarer Voice-Uhr und schließt am Ende alle Verbindungen. */
async function withVoice(options: Partial<ServiceOptions>, run: (setup: Setup) => Promise<void>): Promise<void> {
  const clock = new VoiceClock();
  const service = await startService({ dev: true, voiceNow: clock.read, ...options });
  const clients: VoiceClient[] = [];
  try {
    await run({
      service,
      clock,
      player: (name) => devPlayer(service.url, name),
      async connect(player) {
        const ws = new WebSocket(voiceUrl(service), { headers: { Authorization: `Bearer ${player.token}` } });
        const client = new VoiceClient(ws);
        clients.push(client);
        await new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
          ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
        });
        return { client, ready: await client.next('ready') };
      },
    });
  } finally {
    for (const client of clients) await client.close();
    await service.close();
  }
}

/** Ändert die Datenbank des laufenden Dienstes direkt (wie die CLI). */
function withStore(service: TestService, change: (store: Store) => void): void {
  const store = new Store(service.dataDir);
  try {
    change(store);
  } finally {
    store.close();
  }
}

/** Spricht einen Rahmen und liefert, welche Hörer ihn bekommen haben (alle Puffer sind danach leer). */
async function heardBy(speaker: VoiceClient, listeners: VoiceClient[], seq = 1): Promise<boolean[]> {
  speaker.speak(seq);
  await speaker.sync();
  const heard: boolean[] = [];
  for (const listener of listeners) {
    await listener.sync();
    heard.push(listener.takeFrames().length > 0);
  }
  return heard;
}

async function voiceCount(service: TestService): Promise<number> {
  return (await api(service.url, 'GET', '/v1/status')).body.voice;
}

describe('Voice Chat: Verbindung', () => {
  test('nur mit Anmeldung, normales GET bekommt 426, ready mit Reichweite', async () => {
    await withVoice({}, async ({ service, connect, player }) => {
      assert.equal((await upgradeStatus(voiceUrl(service))).status, 401);
      assert.equal((await upgradeStatus(voiceUrl(service), { Authorization: 'Bearer falsch' })).status, 401);
      const anna = await player('Anna');
      assert.equal((await api(service.url, 'GET', '/v1/voice', { token: anna.token })).status, 426);
      assert.equal(await voiceCount(service), 0);

      const { client, ready } = await connect(anna);
      assert.deepEqual(ready, { type: 'ready', range: 48, maxFrame: 1024, protocol: 1, features: ['state', 'groups'], maxGroup: 16 });
      client.send({ type: 'ping' });
      assert.deepEqual(await client.next('pong'), { type: 'pong' });
      assert.equal(await voiceCount(service), 1);
      // /v1/ws zählt nicht als Voice, Voice nicht als online
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.online, 0);

      await client.close();
      await waitForCount(service, 0);
    });
  });

  test('eigene Reichweite in ready', async () => {
    await withVoice({ voiceRange: 16 }, async ({ connect, player }) => {
      const { ready } = await connect(await player('Anna'));
      assert.equal(ready.range, 16);
    });
  });

  test('ungültige Reichweite: Der Dienst startet nicht', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-voice-'));
    try {
      for (const voiceRange of [7, 129, 48.5, Number.NaN]) {
        assert.throws(() => createService({ dataDir, voiceRange }), /Reichweite des Voice Chats/, String(voiceRange));
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('aus (voice: false): 404, /v1/ws geht weiter, voice im Status 0', async () => {
    await withVoice({ voice: false }, async ({ service, player }) => {
      const anna = await player('Anna');
      assert.equal((await upgradeStatus(voiceUrl(service), { Authorization: `Bearer ${anna.token}` })).status, 404);
      assert.equal((await upgradeStatus(voiceUrl(service))).status, 404);
      assert.equal((await api(service.url, 'GET', '/v1/voice', { token: anna.token })).status, 404);
      assert.equal((await api(service.url, 'GET', '/v1/ws', { token: anna.token })).status, 426);
      assert.equal(await voiceCount(service), 0);
    });
  });

  test('zweite Verbindung ersetzt die erste (4002), der Raum merkt das', async () => {
    await withVoice({}, async ({ service, connect, player }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const { client: first } = await connect(anna);
      const { client: benClient } = await connect(ben);
      await first.join(SERVER, OVERWORLD);
      assert.deepEqual(await benClient.join(SERVER, OVERWORLD), [anna.uuid]);
      await first.next('peers');

      const { client: second, ready } = await connect(anna);
      assert.equal(ready.type, 'ready');
      assert.deepEqual(await first.closed, { code: 4002, reason: 'Neue Verbindung' });
      assert.deepEqual((await benClient.next('peers')).uuids, []);
      assert.equal(await voiceCount(service), 2);

      assert.deepEqual(await second.join(SERVER, OVERWORLD), [ben.uuid]);
      assert.deepEqual((await benClient.next('peers')).uuids, [anna.uuid]);
    });
  });

  test('ohne Nachricht schließt der Dienst (im Test nach 150 ms), Ping hält offen', async () => {
    await withVoice({ voiceIdleTimeoutMs: 150 }, async ({ connect, player }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const { client: annaClient } = await connect(anna);
      const { client: benClient } = await connect(ben);
      await annaClient.join(SERVER, OVERWORLD);
      await benClient.join(SERVER, OVERWORLD);
      await annaClient.next('peers');

      const pinger = setInterval(() => benClient.send({ type: 'ping' }), 40);
      try {
        assert.deepEqual(await annaClient.closed, { code: 4000, reason: 'Zeitüberschreitung' });
        assert.deepEqual((await benClient.next('peers')).uuids, []);
        assert.equal(benClient.ws.readyState, WebSocket.OPEN);
      } finally {
        clearInterval(pinger);
      }
    });
  });
});

async function waitForCount(service: TestService, expected: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while ((await voiceCount(service)) !== expected) {
    if (Date.now() > deadline) throw new Error(`voice ist nicht ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Voice Chat: Räume', () => {
  test('join, Wechsel, leave und Trennen schicken peers an alle im Raum', async () => {
    await withVoice({}, async ({ connect, player }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const carla = await player('Carla');
      const { client: a } = await connect(anna);
      const { client: b } = await connect(ben);
      const { client: c } = await connect(carla);

      assert.deepEqual(await a.join('Mc.Example.NET', OVERWORLD), []);
      // derselbe Server (25565 ist der Standard-Port), andere Schreibweise
      assert.deepEqual(await b.join('mc.example.net:25565', OVERWORLD), [anna.uuid]);
      assert.deepEqual((await a.next('peers')).uuids, [ben.uuid]);
      // andere Dimension: eigener Raum, die anderen merken nichts
      assert.deepEqual(await c.join(SERVER, NETHER), []);
      await a.sync();
      assert.deepEqual(a.drain(), []);

      // Ben wechselt in den Nether
      assert.deepEqual(await b.join(SERVER, NETHER), [carla.uuid]);
      assert.deepEqual((await a.next('peers')).uuids, []);
      assert.deepEqual((await c.next('peers')).uuids, [ben.uuid]);

      // Gleicher Raum noch einmal: nur die eigene Liste, keine Nachricht an die anderen
      assert.deepEqual(await b.join(SERVER, NETHER), [carla.uuid]);
      await c.sync();
      assert.deepEqual(c.drain(), []);

      // leave: der Spieler selbst bekommt eine leere Liste, der Raum die neue
      b.send({ type: 'leave' });
      assert.deepEqual((await b.next('peers')).uuids, []);
      assert.deepEqual((await c.next('peers')).uuids, []);
      // leave ohne Raum: nichts
      b.send({ type: 'leave' });
      await b.sync();
      assert.deepEqual(b.drain(), []);

      // Port gehört zum Server: anderer Raum
      assert.deepEqual(await b.join('mc.example.net:25570', OVERWORLD), []);
      await a.sync();
      assert.deepEqual(a.drain(), []);

      // Trennen: der Raum bekommt die neue Liste
      assert.deepEqual(await c.join(SERVER, OVERWORLD), [anna.uuid]);
      assert.deepEqual((await a.next('peers')).uuids, [carla.uuid]);
      await c.close();
      assert.deepEqual((await a.next('peers')).uuids, []);
    });
  });

  test('ungültige Nachrichten werden ignoriert', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const { client } = await connect(await player('Anna'));
      const invalid: unknown[] = [
        { type: 'join', server: '192.168.178.20', dimension: OVERWORLD },
        { type: 'join', server: 'localhost', dimension: OVERWORLD },
        { type: 'join', server: 'server.local', dimension: OVERWORLD },
        { type: 'join', server: 42, dimension: OVERWORLD },
        { type: 'join', dimension: OVERWORLD },
        { type: 'join', server: SERVER, dimension: 'Minecraft:Overworld' },
        { type: 'join', server: SERVER, dimension: 'overworld' },
        { type: 'join', server: SERVER, dimension: `minecraft:${'a'.repeat(65)}` },
        { type: 'join', server: SERVER, dimension: `${'a'.repeat(33)}:overworld` },
        { type: 'join', server: SERVER, dimension: 7 },
        { type: 'join', server: SERVER, dimension: OVERWORLD, mode: 'feinde' },
        { type: 'gibtsnicht' },
        ['join'],
        'join',
        null,
      ];
      for (const message of invalid) client.send(message);
      client.ws.send('{kaputt');
      clock.advance(1000);
      await client.sync();
      assert.deepEqual(client.drain(), []);

      // mode: null zählt wie ohne Angabe
      assert.deepEqual(await client.join(SERVER, OVERWORLD, null as unknown as string), []);
    });
  });
});

describe('Voice Chat: Weiterleiten', () => {
  test('nur im selben Raum und in Reichweite, mit UUID des Sprechers', async () => {
    await withVoice({}, async ({ connect, player }) => {
      const names = ['Anna', 'Ben', 'Carla', 'Dirk', 'Emil', 'Frida'];
      const players = await Promise.all(names.map((name) => player(name)));
      const clients: VoiceClient[] = [];
      for (const p of players) clients.push((await connect(p)).client);
      const [anna, ben, carla, dirk, emil, frida] = clients as [VoiceClient, VoiceClient, VoiceClient, VoiceClient, VoiceClient, VoiceClient];

      await anna.join(SERVER, OVERWORLD);
      await ben.join(SERVER, OVERWORLD);
      await carla.join(SERVER, OVERWORLD);
      await dirk.join(SERVER, OVERWORLD);
      await emil.join('anderer.example.net', OVERWORLD);
      await frida.join(SERVER, NETHER);
      anna.pos(0, 64, 0);
      ben.pos(30, 64, 0); // in Reichweite
      carla.pos(48.01, 64, 0); // knapp außerhalb
      dirk.pos(0, 64 + 48, 0); // genau an der Grenze (zählt)
      emil.pos(0, 64, 0); // gleiche Stelle, anderer Server
      frida.pos(0, 64, 0); // gleiche Stelle, andere Dimension
      for (const client of clients) await client.sync();

      anna.speak(513, [9, 8, 7, 6], 1);
      await anna.sync();
      const received: Frame[][] = [];
      for (const client of clients) {
        await client.sync();
        received.push(client.takeFrames());
      }
      const annaUuid = players[0]!.uuid;
      assert.deepEqual(
        received.map((frames) => frames.length),
        [0, 1, 0, 1, 0, 0],
      );
      for (const got of [received[1]![0]!, received[3]![0]!]) {
        assert.deepEqual(got, { version: 1, flags: 1, seq: 513, speaker: annaUuid, payload: Buffer.from([9, 8, 7, 6]) });
      }

      // Andere Bits in den Flags fallen weg; Folgenummer bis 65535.
      anna.speak(65535, [1], 0xff);
      await anna.sync();
      await ben.sync();
      const [masked] = ben.takeFrames();
      assert.deepEqual([masked!.flags, masked!.seq], [1, 65535]);
      anna.speak(1, [1], 0xfe);
      await anna.sync();
      await ben.sync();
      assert.equal(ben.takeFrames()[0]!.flags, 0);
      // Dirk hat beide auch bekommen.
      await dirk.sync();
      assert.equal(dirk.takeFrames().length, 2);

      // Ben spricht: Anna und Carla (18 Blöcke von Ben) hören ihn, Dirk (ca. 57 Blöcke) nicht.
      assert.deepEqual(await heardBy(ben, [anna, carla, dirk, emil, frida]), [true, true, false, false, false]);

      // Carla geht näher heran: jetzt hört sie auch Anna.
      carla.pos(10, 70, -10);
      await carla.sync();
      assert.deepEqual(await heardBy(anna, [ben, carla, dirk]), [true, true, true]);
    });
  });

  test('ohne Raum, ohne Position oder mit alter Position (über 15 s): verworfen', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const { client: anna } = await connect(await player('Anna'));
      const { client: ben } = await connect(await player('Ben'));

      // ohne Raum
      anna.pos(0, 64, 0);
      ben.pos(1, 64, 0);
      assert.deepEqual(await heardBy(anna, [ben]), [false]);

      // im Raum, aber ohne Position: Eine Position vor dem Betreten bleibt, wenn vorher kein Raum war.
      await anna.join(SERVER, OVERWORLD);
      await ben.join(SERVER, OVERWORLD);
      assert.deepEqual(await heardBy(anna, [ben]), [true]);

      // Raumwechsel löscht die Position (andere Dimension)
      await anna.join(SERVER, NETHER);
      await anna.join(SERVER, OVERWORLD);
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      assert.deepEqual(await heardBy(ben, [anna]), [false], 'Anna hat keine Position mehr, hört also auch nichts');
      anna.pos(0, 64, 0);
      await anna.sync();
      assert.deepEqual(await heardBy(anna, [ben]), [true]);

      // genau 15 s alt: zählt noch; danach nicht mehr
      clock.freeze();
      anna.pos(0, 64, 0);
      ben.pos(1, 64, 0);
      await anna.sync();
      await ben.sync();
      clock.advance(15_000);
      assert.deepEqual(await heardBy(anna, [ben]), [true]);
      clock.advance(1);
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      // nur Ben aktualisiert: Annas Position ist immer noch alt
      ben.pos(1, 64, 0);
      await ben.sync();
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      assert.deepEqual(await heardBy(ben, [anna]), [false]);
      anna.pos(0, 64, 0);
      await anna.sync();
      assert.deepEqual(await heardBy(anna, [ben]), [true]);
      assert.deepEqual(await heardBy(ben, [anna]), [true]);

      // leave: verworfen
      anna.send({ type: 'leave' });
      await anna.next('peers');
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
    });
  });

  test('ungültige Positionen werden ignoriert, die alte gilt weiter', async () => {
    await withVoice({}, async ({ connect, player }) => {
      const { client: anna } = await connect(await player('Anna'));
      const { client: ben } = await connect(await player('Ben'));
      await anna.join(SERVER, OVERWORLD);
      await ben.join(SERVER, OVERWORLD);
      anna.pos(1000, 64, 1000);
      ben.pos(0, 64, 0);
      await anna.sync();
      for (const message of [
        { type: 'pos', x: 0, y: 64 },
        { type: 'pos', x: '0', y: 64, z: 0 },
        { type: 'pos', x: 0, y: 64, z: 30_000_001 },
        { type: 'pos', x: -30_000_001, y: 64, z: 0 },
        { type: 'pos', x: null, y: 64, z: 0 },
      ]) {
        anna.send(message);
      }
      // 1e400 wird in JSON zu Infinity
      anna.ws.send('{"type":"pos","x":1e400,"y":64,"z":0}');
      await anna.sync();
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      // Grenzwert 30 000 000 ist erlaubt (dann weit weg von Ben)
      anna.pos(30_000_000, 64, -30_000_000);
      await anna.sync();
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      anna.pos(0.5, 64.25, -0.75);
      await anna.sync();
      assert.deepEqual(await heardBy(anna, [ben]), [true]);
    });
  });

  test('blockiert (in beide Richtungen): keine Sprache, weder hin noch zurück', async () => {
    await withVoice({}, async ({ service, clock, connect, player }) => {
      const annaPlayer = await player('Anna');
      const benPlayer = await player('Ben');
      const carlaPlayer = await player('Carla');
      const { client: anna } = await connect(annaPlayer);
      const { client: ben } = await connect(benPlayer);
      const { client: carla } = await connect(carlaPlayer);
      for (const [client, x] of [[anna, 0], [ben, 1], [carla, 2]] as const) {
        await client.join(SERVER, OVERWORLD);
        client.pos(x, 64, 0);
        await client.sync();
      }
      assert.deepEqual(await heardBy(anna, [ben, carla]), [true, true]);

      const block = async (who: Player, target: Player) =>
        assert.equal((await api(service.url, 'POST', '/v1/blocks', { token: who.token, body: { uuid: target.uuid } })).status, 200);
      const unblock = async (who: Player, target: Player) =>
        assert.equal((await api(service.url, 'DELETE', `/v1/blocks/${target.uuid}`, { token: who.token })).status, 200);

      await block(annaPlayer, benPlayer);
      assert.deepEqual(await heardBy(anna, [ben, carla]), [false, true]);
      assert.deepEqual(await heardBy(ben, [anna, carla]), [false, true]);
      await unblock(annaPlayer, benPlayer);
      clock.advance(1000);
      assert.deepEqual(await heardBy(anna, [ben]), [true]);

      await block(benPlayer, annaPlayer);
      assert.deepEqual(await heardBy(anna, [ben, carla]), [false, true]);
      assert.deepEqual(await heardBy(ben, [anna, carla]), [false, true]);
      await unblock(benPlayer, annaPlayer);
      assert.deepEqual(await heardBy(ben, [anna]), [true]);
    });
  });

  test('„Nur Freunde“: bei einem von beiden müssen sie befreundet sein', async () => {
    await withVoice({}, async ({ service, clock, connect, player }) => {
      const annaPlayer = await player('Anna');
      const benPlayer = await player('Ben');
      const carlaPlayer = await player('Carla');
      await befriend(service.url, annaPlayer, carlaPlayer);
      const { client: anna } = await connect(annaPlayer);
      const { client: ben } = await connect(benPlayer);
      const { client: carla } = await connect(carlaPlayer);
      await anna.join(SERVER, OVERWORLD, 'friends');
      await ben.join(SERVER, OVERWORLD);
      await carla.join(SERVER, OVERWORLD, 'all');
      for (const [client, x] of [[anna, 0], [ben, 1], [carla, 2]] as const) {
        client.pos(x, 64, 0);
        await client.sync();
      }
      // Anna nur Freunde: Carla (Freundin) ja, Ben nein – in beide Richtungen
      assert.deepEqual(await heardBy(anna, [ben, carla]), [false, true]);
      assert.deepEqual(await heardBy(ben, [anna, carla]), [false, true]);
      assert.deepEqual(await heardBy(carla, [anna, ben]), [true, true]);

      // wieder alle
      anna.send({ type: 'mode', mode: 'all' });
      await anna.sync();
      assert.deepEqual(await heardBy(ben, [anna]), [true]);
      assert.deepEqual(await heardBy(anna, [ben]), [true]);

      // Ben stellt auf nur Freunde: Anna hört ihn nicht mehr, und er sie nicht
      ben.send({ type: 'mode', mode: 'friends' });
      ben.send({ type: 'mode', mode: 'feinde' }); // ungültig: bleibt friends
      clock.advance(1000);
      await ben.sync();
      assert.deepEqual(await heardBy(anna, [ben, carla]), [false, true]);
      assert.deepEqual(await heardBy(ben, [anna, carla]), [false, false]);

      // join ohne mode heißt wieder alle
      await ben.join(SERVER, OVERWORLD);
      assert.deepEqual(await heardBy(ben, [anna, carla]), [true, true]);

      // Freundschaft beendet: auch Carla hört Anna mit „Nur Freunde“ nicht mehr
      anna.send({ type: 'mode', mode: 'friends' });
      await anna.sync();
      assert.deepEqual(await heardBy(anna, [carla]), [true]);
      assert.equal((await api(service.url, 'DELETE', `/v1/friends/${carlaPlayer.uuid}`, { token: annaPlayer.token })).status, 200);
      assert.deepEqual(await heardBy(anna, [carla]), [false]);
    });
  });
});

describe('Voice Chat: Grenzen', () => {
  test('Größe und Version der Rahmen', async () => {
    await withVoice({}, async ({ connect, player }) => {
      const { client: anna } = await connect(await player('Anna'));
      const { client: ben } = await connect(await player('Ben'));
      for (const client of [anna, ben]) {
        await client.join(SERVER, OVERWORLD);
        client.pos(0, 64, 0);
        await client.sync();
      }
      const send = async (data: Buffer): Promise<Frame[]> => {
        anna.ws.send(data);
        await anna.sync();
        await ben.sync();
        return ben.takeFrames();
      };
      assert.equal((await send(Buffer.from([1, 0, 0, 1]))).length, 0, 'nur Kopf, keine Nutzdaten');
      assert.equal((await send(Buffer.from([1]))).length, 0, '1 Byte');
      assert.equal((await send(Buffer.alloc(0))).length, 0, 'leer');
      assert.deepEqual(
        (await send(Buffer.from([1, 0, 0, 2, 42]))).map((f) => f.payload),
        [Buffer.from([42])],
        '5 Byte',
      );
      const biggest = Buffer.alloc(1024, 7);
      const [big] = await send(frame(3, biggest));
      assert.deepEqual(big!.payload, biggest, '1028 Byte');
      assert.equal((await send(frame(4, Buffer.alloc(1025)))).length, 0, '1029 Byte');
      assert.equal((await send(frame(5, [1, 2, 3], 0, 2))).length, 0, 'Version 2');
      assert.equal((await send(frame(6, [1, 2, 3], 0, 0))).length, 0, 'Version 0');
      // Text statt Binär zählt nicht als Sprache
      anna.ws.send(frame(7, [1, 2, 3]).toString('latin1'));
      await anna.sync();
      await ben.sync();
      assert.equal(ben.takeFrames().length, 0, 'Text');

      // Über 4 KB: ws trennt (1009)
      anna.ws.send(Buffer.alloc(4097));
      assert.equal((await anna.closed).code, 1009);
    });
  });

  test('höchstens 60 Rahmen und 20 Textnachrichten pro Sekunde, der Rest wird verworfen', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const { client: anna } = await connect(await player('Anna'));
      const { client: ben } = await connect(await player('Ben'));
      for (const client of [anna, ben]) {
        await client.join(SERVER, OVERWORLD);
        client.pos(0, 64, 0);
        await client.sync();
      }
      clock.advance(1000);
      clock.freeze();
      for (let seq = 0; seq < 75; seq++) anna.speak(seq);
      await anna.sync();
      await ben.sync();
      const frames = ben.takeFrames();
      assert.equal(frames.length, 60);
      assert.deepEqual(
        frames.map((f) => f.seq),
        Array.from({ length: 60 }, (_, i) => i),
      );
      // In der nächsten Sekunde geht es weiter.
      clock.advance(1000);
      assert.deepEqual(await heardBy(anna, [ben], 99), [true]);

      // Text: 25 Pings in einer Sekunde ergeben 20 Pongs; der join danach (nächste Sekunde) kommt an.
      clock.advance(1000);
      for (let i = 0; i < 25; i++) ben.send({ type: 'ping' });
      // Kommt Bens Rahmen bei Anna an, hat der Dienst auch alle Pings davor verarbeitet.
      ben.speak(500);
      await waitFor(() => anna.frames.length > 0);
      clock.advance(1000);
      ben.send({ type: 'join', server: SERVER, dimension: NETHER });
      await ben.next('peers');
      assert.equal(ben.drain().filter((m) => m.type === 'pong').length, 20);
    });
  });
});

describe('Voice Chat: Status', () => {
  test('state geht an alle im selben Raum oder in derselben Gruppe (jeden einmal); unverändert oder ungültig: nichts', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const [annaP, benP, carlaP, dirkP, emilP] = await Promise.all(['Anna', 'Ben', 'Carla', 'Dirk', 'Emil'].map((name) => player(name)));
      const all: VoiceClient[] = [];
      for (const p of [annaP, benP, carlaP, dirkP, emilP]) all.push((await connect(p!)).client);
      const [anna, ben, carla, dirk, emil] = all as [VoiceClient, VoiceClient, VoiceClient, VoiceClient, VoiceClient];
      await anna.enter(SERVER, OVERWORLD, GROUP);
      await ben.enter(SERVER, OVERWORLD, GROUP); // Raum und Gruppe
      await carla.enter(SERVER, NETHER, GROUP); // nur die Gruppe
      await dirk.enter(SERVER, OVERWORLD, null); // nur der Raum
      await emil.join(SERVER, NETHER); // weder noch
      const settle = async (): Promise<Text[][]> => {
        for (const client of all) await client.sync();
        return all.map((client) => client.drain());
      };
      await settle();

      anna.state(true, false);
      const muted = { type: 'state', uuid: annaP!.uuid, muted: true, deafened: false };
      assert.deepEqual(await settle(), [[], [muted], [muted], [muted], []]);

      // unverändert: nichts
      anna.state(true, false);
      assert.deepEqual(await settle(), [[], [], [], [], []]);

      // ungültig: nichts, der Status bleibt
      clock.advance(1000);
      for (const message of [
        { type: 'state', muted: 'true', deafened: false },
        { type: 'state', muted: true },
        { type: 'state', deafened: true },
        { type: 'state', muted: 1, deafened: 0 },
        { type: 'state', muted: false, deafened: null },
        { type: 'state' },
      ]) {
        anna.send(message);
      }
      assert.deepEqual(await settle(), [[], [], [], [], []]);
      assert.deepEqual(
        await ben.enter(SERVER, OVERWORLD, GROUP),
        peers([annaP!.uuid, dirkP!.uuid], [annaP!.uuid, carlaP!.uuid], [annaP!.uuid]),
      );
    });
  });

  test('höchstens 4 angenommene Änderungen pro Sekunde, weitere werden ignoriert', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const annaP = await player('Anna');
      const { client: anna } = await connect(annaP);
      const { client: ben } = await connect(await player('Ben'));
      await anna.enter(SERVER, OVERWORLD, null);
      await ben.enter(SERVER, OVERWORLD, null);
      await anna.nextPeers();
      clock.advance(1000);
      clock.freeze();
      const changes: [boolean, boolean][] = [
        [true, false],
        [false, false],
        [true, false],
        [false, false],
        [true, true],
        [false, true],
      ];
      for (const [muted, deafened] of changes) anna.state(muted, deafened);
      await anna.sync();
      await ben.sync();
      assert.deepEqual(
        ben.drain().map((m) => [m.type, m.uuid, m.muted, m.deafened]),
        changes.slice(0, 4).map(([muted, deafened]) => ['state', annaP.uuid, muted, deafened]),
      );
      // Es gilt die zuletzt angenommene Änderung (beides aus).
      assert.deepEqual(await ben.enter(SERVER, OVERWORLD, null), peers([annaP.uuid]));

      // Nächste Sekunde: Unveränderte zählen nicht mit.
      clock.advance(1000);
      for (let i = 0; i < 3; i++) anna.state(false, false);
      for (const [muted, deafened] of changes.slice(0, 4)) anna.state(muted, deafened);
      await anna.sync();
      await ben.sync();
      assert.equal(ben.drain().length, 4);

      clock.advance(1000);
      anna.state(true, true);
      assert.deepEqual(await ben.next('state'), { type: 'state', uuid: annaP.uuid, muted: true, deafened: true });
    });
  });

  test('peers zeigt muted und deafened; der Status bleibt über Raumwechsel und leave, eine neue Verbindung beginnt ohne', async () => {
    await withVoice({}, async ({ connect, player }) => {
      const annaP = await player('Anna');
      const benP = await player('Ben');
      const { client: anna } = await connect(annaP);
      const { client: ben } = await connect(benP);
      // ohne Raum sieht es niemand
      anna.state(true, true);
      await anna.sync();
      await ben.sync();
      assert.deepEqual(ben.drain(), []);

      assert.deepEqual(await anna.enter(SERVER, OVERWORLD, null), peers());
      assert.deepEqual(await ben.enter(SERVER, OVERWORLD, null), peers([annaP.uuid], [], [annaP.uuid], [annaP.uuid]));
      assert.deepEqual(await anna.nextPeers(), peers([benP.uuid]));

      // leave: alles leer
      anna.send({ type: 'leave' });
      assert.deepEqual(await anna.next('peers'), { type: 'peers', uuids: [], group: [], muted: [], deafened: [] });
      assert.deepEqual(await ben.nextPeers(), peers());

      // über den Nether zurück: der Status ist noch da
      await anna.enter(SERVER, NETHER, null);
      await anna.enter(SERVER, OVERWORLD, null);
      assert.deepEqual(await ben.nextPeers(), peers([annaP.uuid], [], [annaP.uuid], [annaP.uuid]));
      anna.state(false, true);
      assert.deepEqual(await ben.next('state'), { type: 'state', uuid: annaP.uuid, muted: false, deafened: true });

      // neue Verbindung: beides wieder aus
      const { client: again } = await connect(annaP);
      await anna.closed;
      assert.deepEqual(await ben.nextPeers(), peers());
      assert.deepEqual(await again.enter(SERVER, OVERWORLD, null), peers([benP.uuid]));
      assert.deepEqual(await ben.nextPeers(), peers([annaP.uuid]));
    });
  });

  test('„Ton aus“: keine Sprache, weder aus der Nähe noch aus der Gruppe; „Mikrofon stumm“ hört weiter', async () => {
    await withVoice({}, async ({ connect, player }) => {
      const { client: anna } = await connect(await player('Anna'));
      const { client: ben } = await connect(await player('Ben'));
      const { client: carla } = await connect(await player('Carla'));
      await anna.enter(SERVER, OVERWORLD, GROUP);
      await ben.enter(SERVER, OVERWORLD, null);
      await carla.enter(SERVER, NETHER, GROUP);
      anna.pos(0, 64, 0);
      ben.pos(1, 64, 0);
      for (const client of [anna, ben, carla]) await client.sync();
      assert.deepEqual(await heardBy(anna, [ben, carla]), [true, true]);

      ben.state(false, true);
      carla.state(false, true);
      await ben.sync();
      await carla.sync();
      assert.deepEqual(await heardBy(anna, [ben, carla]), [false, false]);
      // Wer den Ton aus hat, spricht selbst weiter.
      assert.deepEqual(await heardBy(ben, [anna]), [true]);
      assert.deepEqual(await heardBy(carla, [anna]), [true]);

      ben.state(true, false);
      carla.state(true, false);
      await ben.sync();
      await carla.sync();
      assert.deepEqual(await heardBy(anna, [ben, carla]), [true, true]);
    });
  });
});

describe('Voice Chat: Gruppen', () => {
  test('die Gruppe hört sich über Dimension und Entfernung hinweg, ohne Position und ohne „Nur Freunde“; andere wie bisher', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const players = await Promise.all(['Anna', 'Ben', 'Carla', 'Dirk', 'Emil', 'Frida'].map((name) => player(name)));
      const clients: VoiceClient[] = [];
      for (const p of players) clients.push((await connect(p)).client);
      const [anna, ben, carla, dirk, emil, frida] = clients as [VoiceClient, VoiceClient, VoiceClient, VoiceClient, VoiceClient, VoiceClient];
      await anna.enter(SERVER, OVERWORLD, GROUP);
      await ben.enter(SERVER, NETHER, GROUP); // andere Dimension, ohne Position
      await carla.enter(SERVER, OVERWORLD, null); // nicht in der Gruppe, in Reichweite
      await dirk.enter(SERVER, OVERWORLD, GROUP); // in der Gruppe, weit weg
      await emil.enter('anderer.example.net', OVERWORLD, GROUP); // gleicher Prüfwert, anderer Server: andere Gruppe
      await frida.enter(SERVER, OVERWORLD, OTHER_GROUP); // andere Gruppe, in Reichweite
      anna.pos(0, 64, 0);
      carla.pos(1, 64, 0);
      dirk.pos(10_000, 64, 0);
      emil.pos(0, 64, 0);
      frida.pos(2, 64, 0);
      for (const client of clients) await client.sync();
      clock.advance(1000);

      assert.deepEqual(await heardBy(anna, [ben, carla, dirk, emil, frida]), [true, true, true, false, true]);
      // Ben hat keine Position: nur die Gruppe hört ihn.
      assert.deepEqual(await heardBy(ben, [anna, carla, dirk, emil, frida]), [true, false, true, false, false]);
      // Nicht-Mitglieder hören sich wie bisher nur in der Nähe.
      assert.deepEqual(await heardBy(carla, [anna, ben, dirk, emil, frida]), [true, false, false, false, true]);
      assert.deepEqual(await heardBy(emil, [anna, ben, carla, dirk, frida]), [false, false, false, false, false]);
      clock.advance(1000);

      // Rahmen-Kopf wie bisher; in Gruppe und Reichweite zugleich nur eine Kopie.
      dirk.pos(1, 64, 1);
      await dirk.sync();
      anna.speak(777, [5, 6], 0xff);
      await anna.sync();
      for (const listener of [ben, dirk]) {
        await listener.sync();
        assert.deepEqual(listener.takeFrames(), [{ version: 1, flags: 1, seq: 777, speaker: players[0]!.uuid, payload: Buffer.from([5, 6]) }]);
      }
      for (const listener of [carla, frida]) {
        await listener.sync();
        assert.equal(listener.takeFrames().length, 1);
      }
      clock.advance(1000);

      // „Nur Freunde“ zählt in der Gruppe nicht (befreundet ist hier niemand).
      ben.send({ type: 'mode', mode: 'friends' });
      dirk.send({ type: 'mode', mode: 'friends' });
      await ben.sync();
      await dirk.sync();
      assert.deepEqual(await heardBy(anna, [ben, dirk, carla, frida]), [true, true, true, true]);
      assert.deepEqual(await heardBy(ben, [anna, dirk]), [true, true]);
      // … in der Nähe aber weiter: Carla und Dirk hören sich nicht.
      assert.deepEqual(await heardBy(carla, [anna, dirk, frida]), [true, false, true]);
      clock.advance(1000);

      // Alte Positionen (über 15 s): in der Nähe hört niemand mehr, die Gruppe weiter.
      clock.advance(16_000);
      assert.deepEqual(await heardBy(anna, [ben, dirk, carla, frida]), [true, true, false, false]);
    });
  });

  test('Gruppenwechsel im selben Raum; Dimensionswechsel behält die Gruppe; ohne group raus aus der Gruppe', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const [annaP, benP, carlaP, dirkP] = await Promise.all(['Anna', 'Ben', 'Carla', 'Dirk'].map((name) => player(name)));
      const all: VoiceClient[] = [];
      for (const p of [annaP, benP, carlaP, dirkP]) all.push((await connect(p!)).client);
      const [anna, ben, carla, dirk] = all as [VoiceClient, VoiceClient, VoiceClient, VoiceClient];
      const [a, b, c, d] = [annaP!.uuid, benP!.uuid, carlaP!.uuid, dirkP!.uuid];
      await anna.enter(SERVER, OVERWORLD, GROUP);
      await ben.enter(SERVER, OVERWORLD, GROUP);
      await carla.enter(SERVER, NETHER, OTHER_GROUP);
      await dirk.enter(SERVER, OVERWORLD, null);
      const settle = async (): Promise<Text[][]> => {
        for (const client of all) await client.sync();
        return all.map((client) => client.drain());
      };
      await settle();

      // Anna wechselt im selben Raum in Carlas Gruppe.
      assert.deepEqual(await anna.enter(SERVER, OVERWORLD, OTHER_GROUP), peers([b, d], [c]));
      assert.deepEqual(await ben.nextPeers(), peers([a, d]));
      assert.deepEqual(await carla.nextPeers(), peers([], [a]));
      assert.deepEqual(await settle(), [[], [], [], []], 'jeder höchstens einmal, Dirk (nur im Raum) gar nicht');
      clock.advance(1000);
      assert.deepEqual(await heardBy(anna, [ben, carla, dirk]), [false, true, false]);

      // Anna wechselt in den Nether, die Gruppe bleibt; Carla (Raum und Gruppe) bekommt eine Liste.
      assert.deepEqual(await anna.enter(SERVER, NETHER, OTHER_GROUP), peers([c], [c]));
      assert.deepEqual(await carla.nextPeers(), peers([a], [a]));
      assert.deepEqual(await ben.nextPeers(), peers([d]));
      assert.deepEqual(await dirk.nextPeers(), peers([b]));
      assert.deepEqual(await settle(), [[], [], [], []]);
      clock.advance(1000);
      assert.deepEqual(await heardBy(anna, [carla, ben, dirk]), [true, false, false]);

      // Wieder ins Overworld mit der Gruppe: Carla merkt nur den Raumwechsel.
      assert.deepEqual(await anna.enter(SERVER, OVERWORLD, OTHER_GROUP), peers([b, d], [c]));
      assert.deepEqual(await carla.nextPeers(), peers([], [a]));
      assert.deepEqual(await ben.nextPeers(), peers([a, d]));
      assert.deepEqual(await dirk.nextPeers(), peers([a, b]));
      clock.advance(1000);

      // join ohne group im selben Raum: raus aus der Gruppe, der Raum bleibt.
      anna.send({ type: 'join', server: SERVER, dimension: OVERWORLD });
      assert.deepEqual(await anna.nextPeers(), peers([b, d]));
      assert.deepEqual(await carla.nextPeers(), peers());
      assert.deepEqual(await settle(), [[], [], [], []]);
      assert.deepEqual(await heardBy(anna, [carla]), [false]);
    });
  });

  test('ungültige group: die ganze join-Nachricht wird ignoriert; group: null heißt keine Gruppe', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const benP = await player('Ben');
      const { client: anna } = await connect(await player('Anna'));
      const { client: ben } = await connect(benP);
      await anna.enter(SERVER, OVERWORLD, null, 'friends');
      await ben.enter(SERVER, OVERWORLD, null);
      anna.pos(0, 64, 0);
      ben.pos(1, 64, 0);
      await anna.sync();
      await ben.sync();
      ben.drain();
      anna.drain();
      assert.deepEqual(await heardBy(anna, [ben]), [false], '„Nur Freunde“');
      clock.advance(1000);

      for (const group of [GROUP.toUpperCase(), GROUP.slice(1), `${GROUP}0`, 'g'.repeat(64), '', 42, true, [GROUP], { hash: GROUP }]) {
        anna.send({ type: 'join', server: SERVER, dimension: NETHER, mode: 'all', group });
      }
      await anna.sync();
      await ben.sync();
      assert.deepEqual([anna.drain(), ben.drain()], [[], []]);
      clock.advance(1000);

      // Raum, Position und Modus sind unverändert.
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      anna.send({ type: 'mode', mode: 'all' });
      await anna.sync();
      assert.deepEqual(await heardBy(anna, [ben]), [true]);
      assert.deepEqual(await anna.enter(SERVER, OVERWORLD, null), peers([benP.uuid]));
    });
  });

  test('Blockieren gilt auch in der Gruppe', async () => {
    await withVoice({}, async ({ service, clock, connect, player }) => {
      const annaP = await player('Anna');
      const benP = await player('Ben');
      const { client: anna } = await connect(annaP);
      const { client: ben } = await connect(benP);
      await anna.enter(SERVER, OVERWORLD, GROUP);
      await ben.enter(SERVER, NETHER, GROUP);
      assert.deepEqual(await heardBy(anna, [ben]), [true]);

      const block = async (who: Player, target: Player) =>
        assert.equal((await api(service.url, 'POST', '/v1/blocks', { token: who.token, body: { uuid: target.uuid } })).status, 200);
      const unblock = async (who: Player, target: Player) =>
        assert.equal((await api(service.url, 'DELETE', `/v1/blocks/${target.uuid}`, { token: who.token })).status, 200);

      await block(annaP, benP);
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      assert.deepEqual(await heardBy(ben, [anna]), [false]);
      await unblock(annaP, benP);
      clock.advance(1000);
      assert.deepEqual(await heardBy(anna, [ben]), [true]);

      await block(benP, annaP);
      assert.deepEqual(await heardBy(anna, [ben]), [false]);
      assert.deepEqual(await heardBy(ben, [anna]), [false]);
      await unblock(benP, annaP);
      assert.deepEqual(await heardBy(ben, [anna]), [true]);
    });
  });

  test('leave, Trennen, Verdrängen (4002) und gelöschtes Konto nehmen aus der Gruppe', async () => {
    await withVoice({}, async ({ service, connect, player }) => {
      const [annaP, benP, carlaP, dirkP] = await Promise.all(['Anna', 'Ben', 'Carla', 'Dirk'].map((name) => player(name)));
      const [a, b, c, d] = [annaP!.uuid, benP!.uuid, carlaP!.uuid, dirkP!.uuid];
      const { client: anna } = await connect(annaP!);
      const { client: ben } = await connect(benP!);
      const { client: carla } = await connect(carlaP!);
      const { client: dirk } = await connect(dirkP!);
      await anna.enter(SERVER, OVERWORLD, GROUP);
      await ben.enter(SERVER, NETHER, GROUP);
      await carla.enter(SERVER, NETHER, GROUP);
      await dirk.enter(SERVER, THE_END, GROUP);
      for (const client of [anna, ben, carla, dirk]) {
        await client.sync();
        client.drain();
      }

      anna.send({ type: 'leave' });
      assert.deepEqual(await anna.next('peers'), { type: 'peers', uuids: [], group: [], muted: [], deafened: [] });
      assert.deepEqual(await ben.nextPeers(), peers([c], [c, d]));
      assert.deepEqual(await carla.nextPeers(), peers([b], [b, d]));
      assert.deepEqual(await dirk.nextPeers(), peers([], [b, c]));
      assert.deepEqual(await heardBy(anna, [ben, carla, dirk]), [false, false, false]);

      assert.deepEqual(await anna.enter(SERVER, OVERWORLD, GROUP), peers([], [b, c, d]));
      for (const client of [ben, carla, dirk]) assert.deepEqual((await client.nextPeers()).group.includes(a), true);

      // Verdrängt durch eine neue Verbindung
      const { client: again } = await connect(annaP!);
      assert.deepEqual(await anna.closed, { code: 4002, reason: 'Neue Verbindung' });
      assert.deepEqual(await ben.nextPeers(), peers([c], [c, d]));
      assert.deepEqual(await carla.nextPeers(), peers([b], [b, d]));
      assert.deepEqual(await dirk.nextPeers(), peers([], [b, c]));
      assert.deepEqual(await heardBy(again, [ben]), [false]);

      // Trennen
      await carla.close();
      assert.deepEqual(await ben.nextPeers(), peers([], [d]));
      assert.deepEqual(await dirk.nextPeers(), peers([], [b]));

      // Konto gelöscht
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: dirkP!.token })).status, 200);
      assert.deepEqual(await dirk.closed, { code: 4001, reason: 'Konto gelöscht' });
      assert.deepEqual(await ben.nextPeers(), peers());
    });
  });

  test('alter Client ohne group und state: wie in 1.8.0', async () => {
    await withVoice({}, async ({ clock, connect, player }) => {
      const [annaP, benP, carlaP] = await Promise.all(['Anna', 'Ben', 'Carla'].map((name) => player(name)));
      const { client: anna } = await connect(annaP!); // alter Client
      const { client: ben } = await connect(benP!);
      const { client: carla } = await connect(carlaP!);
      assert.deepEqual(await anna.join(SERVER, OVERWORLD), []);
      assert.deepEqual(await ben.enter(SERVER, OVERWORLD, GROUP), peers([annaP!.uuid]));
      assert.deepEqual(await anna.next('peers'), { type: 'peers', uuids: [benP!.uuid], group: [], muted: [], deafened: [] });
      assert.deepEqual(await carla.enter(SERVER, NETHER, GROUP), peers([], [benP!.uuid]));
      assert.deepEqual(await ben.nextPeers(), peers([annaP!.uuid], [carlaP!.uuid]));
      await anna.sync();
      assert.deepEqual(anna.drain(), [], 'die Gruppe in einer anderen Dimension merkt der alte Client nicht');

      anna.pos(0, 64, 0);
      ben.pos(1000, 64, 0);
      await anna.sync();
      await ben.sync();
      clock.advance(1000);
      assert.deepEqual(await heardBy(anna, [ben, carla]), [false, false]);
      assert.deepEqual(await heardBy(ben, [anna, carla]), [false, true]);

      ben.pos(3, 64, 0);
      await ben.sync();
      assert.deepEqual(await heardBy(anna, [ben, carla]), [true, false]);
      assert.deepEqual(await heardBy(ben, [anna, carla]), [true, true]);
      clock.advance(1000);

      // Ein Rahmen pro Hörer, Kopf wie bisher
      anna.speak(42, [1, 2], 1);
      await anna.sync();
      await ben.sync();
      assert.deepEqual(ben.takeFrames(), [{ version: 1, flags: 1, seq: 42, speaker: annaP!.uuid, payload: Buffer.from([1, 2]) }]);
    });
  });
});

describe('Voice Chat: Trennen bei gelöschtem oder gesperrtem Konto', () => {
  test('DELETE /v1/me schließt auch die Voice-Verbindung (4001)', async () => {
    await withVoice({}, async ({ service, connect, player }) => {
      const annaPlayer = await player('Anna');
      const { client: anna } = await connect(annaPlayer);
      const { client: ben } = await connect(await player('Ben'));
      await anna.join(SERVER, OVERWORLD);
      await ben.join(SERVER, OVERWORLD);
      await anna.next('peers');

      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: annaPlayer.token })).status, 200);
      assert.deepEqual(await anna.closed, { code: 4001, reason: 'Konto gelöscht' });
      assert.deepEqual((await ben.next('peers')).uuids, []);
      assert.equal(await voiceCount(service), 1);
      assert.equal((await upgradeStatus(voiceUrl(service), { Authorization: `Bearer ${annaPlayer.token}` })).status, 401);
    });
  });

  test('Sperre im Team-Bereich trennt sofort (4003)', async () => {
    const clock = new Clock();
    await withVoice({ website: WEBSITE, totpNow: clock.read }, async ({ service, connect, player }) => {
      const { cookie } = await teamLogin(service, await player('Chefin'), 'admin', clock);
      const stoerer = await player('Stoerer');
      const { client } = await connect(stoerer);
      const res = await webApi(service, 'POST', '/v1/team/bans', { cookie, body: { name: 'Stoerer', reason: 'Spam im Voice Chat' } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(await client.closed, { code: 4003, reason: 'Gesperrt' });
    });
  });

  test('über die CLI gelöscht oder gesperrt: beim nächsten ping getrennt', async () => {
    await withVoice({}, async ({ service, connect, player }) => {
      const geloescht = await player('Geloescht');
      const gesperrt = await player('Gesperrt');
      const { client: a } = await connect(geloescht);
      const { client: b } = await connect(gesperrt);
      withStore(service, (store) => {
        store.deleteUser(geloescht.uuid);
        store.ban(gesperrt.uuid, 'Gesperrt', 'Spam', Date.now());
      });
      a.send({ type: 'ping' });
      b.send({ type: 'ping' });
      assert.deepEqual(await a.closed, { code: 4001, reason: 'Konto gelöscht' });
      assert.deepEqual(await b.closed, { code: 4003, reason: 'Gesperrt' });
    });
  });
});

/** Nachgebaute WebSocket für Voice direkt (ohne Netz): Puffer und Zustand lassen sich setzen. */
class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  readonly sent: (string | Buffer)[] = [];
  closedWith: { code: number; reason: string } | null = null;
  send(data: string | Buffer): void {
    this.sent.push(data);
  }
  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.readyState = WebSocket.CLOSING;
  }
  terminate(): void {
    this.readyState = WebSocket.CLOSED;
  }
  text(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }
  binary(data: Buffer): void {
    this.emit('message', data, true);
  }
  frames(): Buffer[] {
    return this.sent.filter((d): d is Buffer => Buffer.isBuffer(d));
  }
  texts(): Text[] {
    return this.sent.filter((d): d is string => typeof d === 'string').map((t) => JSON.parse(t));
  }
  /** Textnachrichten seit dem letzten Aufruf; danach ist `sent` leer. */
  takeTexts(): Text[] {
    const texts = this.texts();
    this.sent.length = 0;
    return texts;
  }
  lastPeersMessage(): Text {
    const all = this.texts().filter((m) => m.type === 'peers');
    return all[all.length - 1];
  }
  lastPeers(): string[] {
    return this.lastPeersMessage().uuids;
  }
}

function withFakeVoice(run: (voice: Voice, connect: (uuid: string) => FakeSocket) => void): void {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-voice-'));
  const store = new Store(dataDir);
  const voice = new Voice(store, { range: 48, idleTimeoutMs: 60_000, now: () => 1_000_000, log: () => {} });
  try {
    run(voice, (uuid) => {
      const ws = new FakeSocket();
      voice.attach(ws as unknown as WebSocket, uuid);
      return ws;
    });
  } finally {
    voice.closeAll();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('Voice Chat: Verteilung (ohne Netz)', () => {
  test('wer mit dem Lesen nicht hinterherkommt (über 256 KB gepuffert), bekommt keine Sprache, bleibt aber verbunden', () => {
    withFakeVoice((_voice, connect) => {
      const [a, b, c] = [randomUuid(), randomUuid(), randomUuid()].map((uuid) => connect(uuid)) as [FakeSocket, FakeSocket, FakeSocket];
      for (const [ws, x] of [[a, 0], [b, 1], [c, 2]] as const) {
        ws.text({ type: 'join', server: SERVER, dimension: OVERWORLD });
        ws.text({ type: 'pos', x, y: 64, z: 0 });
      }
      b.bufferedAmount = 256 * 1024 + 1;
      a.binary(frame(1, [1, 2, 3]));
      assert.equal(b.frames().length, 0);
      assert.equal(c.frames().length, 1);
      assert.deepEqual([b.closedWith, b.readyState], [null, WebSocket.OPEN]);
      b.bufferedAmount = 256 * 1024;
      a.binary(frame(2, [1, 2, 3]));
      assert.equal(b.frames().length, 1);
      // Derselbe Rahmen für alle Hörer
      assert.deepEqual(b.frames()[0], c.frames()[1]);
    });
  });

  test('peers: höchstens 100 andere; leere Räume verschwinden', () => {
    withFakeVoice((voice, connect) => {
      const uuids = Array.from({ length: 102 }, () => randomUuid());
      const sockets = uuids.map((uuid) => connect(uuid));
      for (const ws of sockets) ws.text({ type: 'join', server: SERVER, dimension: OVERWORLD });
      for (const [i, ws] of sockets.entries()) {
        const peers = ws.lastPeers();
        assert.equal(peers.length, 100);
        assert.equal(peers.includes(uuids[i]!), false);
        assert.equal(new Set(peers).size, 100);
      }
      const rooms = (voice as unknown as { rooms: Map<string, unknown> }).rooms;
      assert.equal(rooms.size, 1);
      for (const ws of sockets) ws.text({ type: 'leave' });
      assert.equal(rooms.size, 0);
      assert.equal(voice.connectedCount(), 102);
      voice.disconnectUser(uuids[0]!, 4001, 'Konto gelöscht');
      assert.deepEqual(sockets[0]!.closedWith, { code: 4001, reason: 'Konto gelöscht' });
      assert.equal(voice.connectedCount(), 101);
    });
  });

  test('Gruppe: höchstens 16 Mitglieder, sonst status full und keine Gruppe; leere Gruppen verschwinden', () => {
    withFakeVoice((voice, connect) => {
      const groups = (voice as unknown as { groups: Map<string, unknown> }).groups;
      const rooms = (voice as unknown as { rooms: Map<string, unknown> }).rooms;
      const uuids = Array.from({ length: 18 }, () => randomUuid());
      const sockets = uuids.map((uuid) => connect(uuid));
      const join = (ws: FakeSocket, group: string, dimension = OVERWORLD) => ws.text({ type: 'join', server: SERVER, dimension, group });
      for (const ws of sockets.slice(0, 16)) join(ws, GROUP);
      for (const ws of sockets.slice(0, 16)) assert.equal(ws.lastPeersMessage().group.length, 15);

      // Die 17. war in einer anderen Gruppe: Sie verlässt diese, kommt nicht hinein und ist danach in keiner Gruppe.
      const [late, other] = [sockets[16]!, sockets[17]!];
      join(late, OTHER_GROUP, NETHER);
      join(other, OTHER_GROUP, NETHER);
      assert.equal(groups.size, 2);
      late.takeTexts();
      other.takeTexts();
      sockets[0]!.takeTexts();
      join(late, GROUP);
      assert.deepEqual(late.takeTexts(), [
        { type: 'group', status: 'full' },
        { type: 'peers', uuids: uuids.slice(0, 16), group: [], muted: [], deafened: [] },
      ]);
      // Die andere war mit ihr in Raum und Gruppe: eine Liste.
      assert.deepEqual(other.takeTexts(), [{ type: 'peers', uuids: [], group: [], muted: [], deafened: [] }]);
      // Die Gruppe hat sie nicht aufgenommen; sie ist nur im Raum.
      assert.equal(sockets[0]!.lastPeersMessage().group.length, 15);
      assert.equal(sockets[0]!.lastPeersMessage().uuids.length, 16);
      // Noch einmal: wieder voll
      join(late, GROUP);
      assert.deepEqual(late.takeTexts().map((m) => m.type), ['group', 'peers']);
      assert.equal(groups.size, 2);
      other.text({ type: 'leave' });
      assert.equal(groups.size, 1, 'leere Gruppe gelöscht');

      // Wer schon drin ist, bleibt drin (gleicher Raum oder andere Dimension).
      sockets[0]!.takeTexts();
      join(sockets[0]!, GROUP);
      join(sockets[0]!, GROUP, NETHER);
      assert.deepEqual(sockets[0]!.takeTexts().map((m) => [m.type, m.group?.length]), [
        ['peers', 15],
        ['peers', 15],
      ]);

      // Platz frei: jetzt klappt es.
      sockets[1]!.text({ type: 'leave' });
      late.takeTexts();
      join(late, GROUP);
      assert.deepEqual(late.takeTexts().map((m) => [m.type, m.group?.length]), [['peers', 15]]);

      // Trennen nimmt aus der Gruppe; leer verschwindet sie.
      for (const ws of sockets) ws.emit('close');
      assert.equal(groups.size, 0);
      assert.equal(rooms.size, 0);
      assert.equal(voice.connectedCount(), 0);
    });
  });
});

describe('Voice Chat: Datenschutz', () => {
  test('weder Sprache noch Positionen, Räume, Gruppen oder Server landen in Log, Datenbank oder Status', async () => {
    await withVoice({}, async ({ service, connect, player }) => {
      const { client: anna } = await connect(await player('Anna'));
      const { client: ben } = await connect(await player('Ben'));
      const server = 'geheimer-voice-server.net';
      for (const [client, x] of [[anna, 123.456], [ben, 124.567]] as const) {
        await client.enter(server, 'meinmod:geheime_welt', GROUP);
        client.pos(x, 77.125, -9876.5);
        client.state(true, false);
        await client.sync();
      }
      const status = (await api(service.url, 'GET', '/v1/status')).body;
      assert.equal(status.voice, 2);
      assert.equal(JSON.stringify(status).includes('group'), false);
      const secret = Buffer.from('GEHEIME-SPRACHE');
      anna.speak(1, secret);
      await anna.sync();
      await ben.sync();
      assert.deepEqual(ben.takeFrames()[0]!.payload, secret);
      await anna.close();
      await ben.close();

      const logged = service.logs.join('\n');
      for (const needle of ['geheimer-voice-server', 'geheime_welt', '123.456', '9876', 'GEHEIME-SPRACHE', GROUP]) {
        assert.equal(logged.includes(needle), false, `im Log: ${needle}`);
      }
      for (const file of fs.readdirSync(service.dataDir)) {
        const full = path.join(service.dataDir, file);
        if (!fs.statSync(full).isFile()) continue;
        const content = fs.readFileSync(full);
        for (const needle of ['geheimer-voice-server', 'geheime_welt', 'GEHEIME-SPRACHE', GROUP]) {
          assert.equal(content.includes(needle), false, `in ${file}: ${needle}`);
        }
      }
    });
  });
});
