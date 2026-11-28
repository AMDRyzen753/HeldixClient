// Server-Gruppen im Voice Chat (1.14.0): Partner-Server setzen Gruppen über die Partner-Schnittstelle. In der Nähe hört
// nur dieselbe Server-Gruppe (ohne Gruppe nur andere ohne), der Gruppenkanal ist die Server-Gruppe (jede Entfernung, nur
// auf diesem Server), die eigene Gruppe bzw. Party-Gruppe ist so lange aus. Nachricht `serverGroup`, `null` entfernt,
// DELETE leert, Verfall ohne Erneuerung, Partner pausiert, Prüfungen und Grenzen, nichts gespeichert.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { WebSocket } from 'ws';
import type { ServiceOptions } from '../src/app';
import { VoiceServerGroups } from '../src/voice-server-groups';
import { api, devPlayer, randomUuid, sleep, startService, type Player, type TestService } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

const OVERWORLD = 'minecraft:overworld';
const NETHER = 'minecraft:the_nether';
const OWN_GROUP = createHash('sha256').update('Bande\ngeheim').digest('hex');

type Text = any;

/** Kleiner Voice-Client: Textnachrichten und Rahmen getrennt, `next` wartet auf eine passende Nachricht. */
class VoiceClient {
  readonly texts: Text[] = [];
  readonly frames: Buffer[] = [];
  private waiters: { match: (m: Text) => boolean; resolve: (m: Text) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.frames.push(Buffer.from(data as Buffer));
        return;
      }
      const message = JSON.parse(String(data));
      const index = this.waiters.findIndex((w) => w.match(message));
      if (index >= 0) this.waiters.splice(index, 1)[0]!.resolve(message);
      else this.texts.push(message);
    });
  }
  next(match: string | ((m: Text) => boolean), timeoutMs = 3000): Promise<Text> {
    const fn = typeof match === 'string' ? (m: Text) => m.type === match : match;
    const index = this.texts.findIndex(fn);
    if (index >= 0) return Promise.resolve(this.texts.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Keine passende Nachricht. Gepuffert: ${JSON.stringify(this.texts)}`)), timeoutMs);
      this.waiters.push({ match: fn, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }
  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }
  async sync(): Promise<void> {
    this.send({ type: 'ping' });
    await this.next('pong');
  }
  /** Raum (und eigene Gruppe) betreten, Position setzen, eigene peers abwarten. */
  async enter(server: string, dimension: string, group: string | null, x = 0): Promise<Text> {
    this.send({ type: 'join', server, dimension, group });
    this.send({ type: 'pos', x, y: 64, z: 0 });
    const peers = await this.next('peers');
    await this.sync();
    return peers;
  }
  pos(x: number): void {
    this.send({ type: 'pos', x, y: 64, z: 0 });
  }
  /** Letzte peers-Nachricht im Puffer (nach sync) als sortierte Listen. */
  async lastPeers(): Promise<{ uuids: string[]; group: string[] }> {
    await this.sync();
    const all = this.texts.filter((m) => m.type === 'peers');
    const last = all[all.length - 1];
    assert.ok(last, 'keine peers-Nachricht');
    return { uuids: [...last.uuids].sort(), group: [...last.group].sort() };
  }
  serverGroups(): Text[] {
    const found = this.texts.filter((m) => m.type === 'serverGroup');
    this.texts.splice(0, this.texts.length, ...this.texts.filter((m) => m.type !== 'serverGroup'));
    return found;
  }
  drainFrames(): number {
    return this.frames.splice(0, this.frames.length).length;
  }
  close(): void {
    this.ws.terminate();
  }
}

/** Spricht einen Rahmen und liefert, wer ihn gehört hat. */
async function heardBy(speaker: VoiceClient, listeners: VoiceClient[]): Promise<boolean[]> {
  for (const listener of listeners) listener.drainFrames();
  speaker.ws.send(Buffer.from([1, 0, 0, 1, 9, 9, 9]));
  await speaker.sync();
  const heard: boolean[] = [];
  for (const listener of listeners) {
    await listener.sync();
    heard.push(listener.drainFrames() > 0);
  }
  return heard;
}

interface Setup {
  service: TestService;
  key: string;
  admin: string;
  player(name: string): Promise<Player>;
  connect(player: Player): Promise<VoiceClient>;
  groups(server: unknown, groups: unknown, key?: string): ReturnType<typeof api>;
}

async function withPartner(options: Partial<ServiceOptions>, run: (setup: Setup) => Promise<void>): Promise<void> {
  const clock = new Clock();
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, ...options });
  const clients: VoiceClient[] = [];
  try {
    const admin = (await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock)).cookie;
    const created = await webApi(service, 'POST', '/v1/team/partners', { cookie: admin, body: { id: 'beispiel', name: 'Beispiel-Netzwerk', servers: ['example.net'] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const key = (await webApi(service, 'POST', '/v1/team/partners/beispiel/key', { cookie: admin })).body.key as string;
    await run({
      service,
      key,
      admin,
      player: (name) => devPlayer(service.url, name),
      async connect(player) {
        const ws = new WebSocket(`${service.url.replace('http', 'ws')}/v1/voice`, { headers: { Authorization: `Bearer ${player.token}` } });
        const client = new VoiceClient(ws);
        clients.push(client);
        await new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
          ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
        });
        await client.next('ready');
        return client;
      },
      groups: (server, groups, k = key) =>
        api(service.url, 'PUT', '/v1/partner/voice/groups', { headers: { Authorization: `Partner ${k}` }, body: { server, groups } }),
    });
  } finally {
    for (const client of clients) client.close();
    await service.close();
  }
}

describe('Voice Chat: Server-Gruppen der Partner-Server', () => {
  test('in der Nähe nur dieselbe Server-Gruppe, Gruppenkanal über jede Entfernung, eigene Gruppe so lange aus', async () => {
    await withPartner({}, async ({ player, connect, groups, service }) => {
      const [anna, ben, carla, dora] = await Promise.all(['Anna', 'Ben', 'Carla', 'Dora'].map((n) => player(n)));
      const [a, b, c, d] = await Promise.all([anna!, ben!, carla!, dora!].map((p) => connect(p)));
      // Alle auf mc.example.net (Subdomain des Partner-Eintrags example.net), dicht beieinander; Anna und Dora in einer eigenen Gruppe
      await a!.enter('mc.example.net', OVERWORLD, OWN_GROUP, 0);
      await b!.enter('mc.example.net', OVERWORLD, null, 1);
      await c!.enter('mc.example.net', OVERWORLD, null, 2);
      await d!.enter('mc.example.net', OVERWORLD, OWN_GROUP, 3);
      assert.deepEqual(await heardBy(a!, [b!, c!, d!]), [true, true, true], 'vorher hören alle');
      assert.deepEqual((await a!.lastPeers()).group, [dora!.uuid]);

      const res = await groups('example.net', { [anna!.uuid]: 'rot', [ben!.uuid]: 'rot', [carla!.uuid]: 'blau' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body, { server: 'example.net', players: 3, ttl: 600 });
      // Nachricht an die Betroffenen (type wie im Voice-Protokoll, t wie im Vertrag)
      assert.deepEqual(await a!.next('serverGroup'), { type: 'serverGroup', t: 'serverGroup', server: 'mc.example.net', group: 'rot', partner: 'Beispiel-Netzwerk' });
      assert.equal((await b!.next('serverGroup')).group, 'rot');
      assert.equal((await c!.next('serverGroup')).group, 'blau');
      await d!.sync();
      assert.deepEqual(d!.serverGroups(), [], 'Dora hat keine Server-Gruppe: keine Nachricht');

      // Listen: in der Nähe nur dieselbe Server-Gruppe; Gruppe = Server-Gruppe
      assert.deepEqual(await a!.lastPeers(), { uuids: [ben!.uuid], group: [ben!.uuid] });
      assert.deepEqual(await c!.lastPeers(), { uuids: [], group: [] });
      assert.deepEqual(await d!.lastPeers(), { uuids: [], group: [] }, 'Dora: niemand ohne Server-Gruppe in der Nähe, Anna nicht mehr in der eigenen Gruppe');

      assert.deepEqual(await heardBy(a!, [b!, c!, d!]), [true, false, false]);
      assert.deepEqual(await heardBy(c!, [a!, b!, d!]), [false, false, false]);
      assert.deepEqual(await heardBy(d!, [a!, b!, c!]), [false, false, false], 'ohne Server-Gruppe hört nur, wer auch keine hat');
      // Jede Entfernung und Dimension: Gruppenkanal
      b!.pos(10_000);
      await b!.sync();
      assert.deepEqual(await heardBy(a!, [b!]), [true]);
      await b!.enter('mc.example.net', NETHER, null, 0);
      assert.deepEqual(await heardBy(a!, [b!]), [true], 'andere Dimension, gleiche Server-Gruppe');
      // Auch über eine andere Adresse desselben Partners (example.net) – nicht aber auf einem anderen Server
      const eva = await player('Eva');
      const e = await connect(eva);
      await e.enter('example.net', OVERWORLD, null, 0);
      await groups('example.net', { [eva.uuid]: 'rot' });
      assert.equal((await e.next('serverGroup')).group, 'rot');
      assert.deepEqual(await heardBy(a!, [e]), [true], 'gleiche Server-Gruppe über eine andere Adresse des Partners');
      await e.enter('anders.example.org', OVERWORLD, null, 0);
      assert.deepEqual(await e.next('serverGroup'), { type: 'serverGroup', t: 'serverGroup', server: 'anders.example.org', group: null, partner: null });
      assert.deepEqual(await heardBy(a!, [e]), [false]);

      // Nichts davon steht im Log (keine Gruppen, keine Spieler)
      assert.ok(!service.logs.some((line) => line.includes('blau') || line.includes(anna!.uuid) || line.includes(carla!.uuid)), service.logs.join('\n'));
    });
  });

  test('null entfernt, DELETE leert, eigene Gruppe kommt zurück; Partner pausiert: sofort aus', async () => {
    await withPartner({}, async ({ player, connect, groups, service, key, admin }) => {
      const [anna, ben, dora] = await Promise.all(['Anna', 'Ben', 'Dora'].map((n) => player(n)));
      const [a, b, d] = await Promise.all([anna!, ben!, dora!].map((p) => connect(p)));
      await a!.enter('mc.example.net', OVERWORLD, OWN_GROUP, 0);
      await b!.enter('mc.example.net', OVERWORLD, null, 1);
      await d!.enter('mc.example.net', OVERWORLD, OWN_GROUP, 2);
      await groups('mc.example.net', { [anna!.uuid]: 'rot', [ben!.uuid]: 'rot' });
      await a!.next('serverGroup');
      await b!.next('serverGroup');

      // Ben: null → wieder ohne Server-Gruppe, hört Dora in der Nähe
      const removed = await groups('mc.example.net', { [ben!.uuid]: null });
      assert.deepEqual(removed.body, { server: 'example.net', players: 1, ttl: 600 });
      assert.deepEqual(await b!.next('serverGroup'), { type: 'serverGroup', t: 'serverGroup', server: 'mc.example.net', group: null, partner: null });
      assert.deepEqual(await heardBy(b!, [a!, d!]), [false, true]);

      // DELETE leert alles: Anna wieder in der eigenen Gruppe mit Dora
      const cleared = await api(service.url, 'DELETE', '/v1/partner/voice/groups?server=example.net', { headers: { Authorization: `Partner ${key}` } });
      assert.deepEqual(cleared.body, { ok: true, server: 'example.net' });
      assert.equal((await a!.next('serverGroup')).group, null);
      assert.deepEqual((await a!.lastPeers()).group, [dora!.uuid]);
      assert.deepEqual(await heardBy(a!, [b!, d!]), [true, true]);

      // Partner pausiert: Server-Gruppen sofort weg, Schnittstelle 403
      await groups('example.net', { [anna!.uuid]: 'rot' });
      assert.equal((await a!.next('serverGroup')).group, 'rot');
      await webApi(service, 'PUT', '/v1/team/partners/beispiel', { cookie: admin, body: { status: 'paused' } });
      assert.equal((await a!.next('serverGroup')).group, null);
      assert.equal((await groups('example.net', { [anna!.uuid]: 'rot' })).status, 403);
      // wieder aktiv: Gruppen müssen neu gesetzt werden
      await webApi(service, 'PUT', '/v1/team/partners/beispiel', { cookie: admin, body: { status: 'active' } });
      await a!.sync();
      assert.deepEqual(a!.serverGroups(), []);
      await groups('example.net', { [anna!.uuid]: 'blau' });
      assert.equal((await a!.next('serverGroup')).group, 'blau');
      // Partner gelöscht: ebenso sofort weg
      await webApi(service, 'DELETE', '/v1/team/partners/beispiel', { cookie: admin });
      assert.equal((await a!.next('serverGroup')).group, null);
    });
  });

  test('ohne Erneuerung verfällt die Server-Gruppe; Erneuern hält sie', async () => {
    await withPartner({ partnerVoiceTtlMs: 600, partnerVoiceSweepMs: 50 }, async ({ player, connect, groups }) => {
      const anna = await player('Anna');
      const a = await connect(anna);
      await a.enter('mc.example.net', OVERWORLD, OWN_GROUP, 0);
      const res = await groups('example.net', { [anna.uuid]: 'rot' });
      assert.equal(res.body.ttl, 1);
      assert.equal((await a.next('serverGroup')).group, 'rot');
      // zweimal nach 350 ms erneuern: länger als die Gültigkeit, trotzdem noch da
      await sleep(350);
      await groups('example.net', { [anna.uuid]: 'rot' });
      await sleep(350);
      await groups('example.net', { [anna.uuid]: 'rot' });
      await a.sync();
      assert.deepEqual(a.serverGroups(), [], 'Erneuern mit derselben Gruppe schickt nichts');
      // ohne Erneuerung: verfällt (Aufräumen alle 50 ms)
      const started = Date.now();
      assert.deepEqual(await a.next('serverGroup', 3000), { type: 'serverGroup', t: 'serverGroup', server: 'mc.example.net', group: null, partner: null });
      assert.ok(Date.now() - started >= 400, 'zu früh verfallen');
      assert.deepEqual(await a.lastPeers(), { uuids: [], group: [] });
    });
  });

  test('Prüfungen: Server muss zum Partner passen, Format der Gruppen, höchstens 500 je Anfrage und 5000 je Partner', async () => {
    await withPartner({}, async ({ groups, service, player, connect }) => {
      const uuid = randomUuid();
      for (const [server, body, status, code, why] of [
        ['anders.example.org', { [uuid]: 'rot' }, 403, 'SERVER_NOT_PARTNER', 'fremder Server'],
        ['notexample.net', { [uuid]: 'rot' }, 403, 'SERVER_NOT_PARTNER', 'kein Subdomain-Treffer'],
        ['127.0.0.1', { [uuid]: 'rot' }, 400, undefined, 'IP-Adresse'],
        [undefined, { [uuid]: 'rot' }, 400, undefined, 'ohne Server'],
        ['example.net', [], 400, undefined, 'Liste statt Objekt'],
        ['example.net', null, 400, undefined, 'null'],
        ['example.net', { 'keine-uuid': 'rot' }, 400, undefined, 'keine UUID'],
        ['example.net', { [uuid]: 'Rot' }, 400, undefined, 'Großbuchstaben'],
        ['example.net', { [uuid]: 'x'.repeat(25) }, 400, undefined, 'zu lang'],
        ['example.net', { [uuid]: '' }, 400, undefined, 'leer'],
        ['example.net', { [uuid]: 5 }, 400, undefined, 'Zahl'],
      ] as const) {
        const res = await groups(server, body);
        assert.deepEqual([res.status, res.body.code], [status, code], why);
      }
      // Spieler auf einem anderen Server bekommt keine Server-Gruppe, auch wenn das Plugin ihn nennt
      const eva = await player('Eva');
      const e = await connect(eva);
      await e.enter('anders.example.org', OVERWORLD, null, 0);
      assert.equal((await groups('example.net', { [eva.uuid]: 'rot' })).status, 200);
      await e.sync();
      assert.deepEqual(e.serverGroups(), []);
      assert.equal((await groups('example.net', { [eva.uuid]: null })).status, 200);
      const many = (n: number) => Object.fromEntries(Array.from({ length: n }, () => [randomUuid(), 'team_a-1']));
      assert.equal((await groups('example.net', many(501))).status, 400);
      for (let i = 0; i < 10; i++) assert.equal((await groups('example.net', many(500))).status, 200, `Runde ${i}`);
      const limit = await groups('example.net', many(1));
      assert.deepEqual([limit.status, limit.body.code], [409, 'SERVER_GROUP_LIMIT']);
      // Entfernen geht auch an der Grenze
      assert.equal((await groups('example.net', { [randomUuid()]: null })).status, 200);
      // Ohne Schlüssel: 401
      assert.equal((await api(service.url, 'PUT', '/v1/partner/voice/groups', { body: { server: 'example.net', groups: {} } })).status, 401);
      // Nichts in der Datenbank (keine Tabelle für Gruppen; auch nicht im WAL)
      for (const file of ['heldix-dienst.db', 'heldix-dienst.db-wal']) {
        const full = path.join(service.dataDir, file);
        if (fs.existsSync(full)) assert.ok(!fs.readFileSync(full).includes(Buffer.from('team_a-1')), file);
      }
    });
  });

  test('Voice Chat aus: 503', async () => {
    await withPartner({ voice: false }, async ({ groups, service, key }) => {
      const res = await groups('example.net', { [randomUuid()]: 'rot' });
      assert.deepEqual([res.status, res.body.code], [503, 'VOICE_OFF']);
      const cleared = await api(service.url, 'DELETE', '/v1/partner/voice/groups?server=example.net', { headers: { Authorization: `Partner ${key}` } });
      assert.equal(cleared.status, 503);
    });
  });

  test('Party-Leiter kann in einer Server-Gruppe nicht über die Party moderieren', async () => {
    await withPartner({}, async ({ player, connect, groups }) => {
      const anna = await player('Anna');
      const a = await connect(anna);
      await a.enter('mc.example.net', OVERWORLD, OWN_GROUP, 0);
      await groups('example.net', { [anna.uuid]: 'rot' });
      await a.next('serverGroup');
      a.send({ type: 'mod', action: 'mute', scope: 'party', uuid: randomUuid() });
      const reply = await a.next('mod');
      assert.equal(reply.status, 'denied');
      assert.match(reply.message, /Server-Gruppe/);
    });
  });
});

describe('VoiceServerGroups (ohne Netz)', () => {
  test('Ablauf je Eintrag mit eigener Uhr, Benachrichtigung der Betroffenen, Bereich je Partner', () => {
    let now = 1_000;
    const changed: string[][] = [];
    const groups = new VoiceServerGroups({
      ttlMs: 100,
      sweepMs: 60_000,
      now: () => now,
      resolve: (server) => (server.endsWith('example.net') ? { key: 'p example.net', partner: 'p', partnerName: 'P', entry: 'example.net' } : null),
    });
    try {
      groups.listener = (uuids) => changed.push([...(uuids ?? [])].sort());
      const scope = { key: 'p example.net', partner: 'p', partnerName: 'P', entry: 'example.net' };
      assert.deepEqual(groups.set(scope, [['a', 'rot'], ['b', 'blau']]), { players: 2 });
      assert.deepEqual(changed, [['a', 'b']]);
      assert.equal(groups.of('mc.example.net', 'a')?.group, 'rot');
      assert.equal(groups.of('anders.org', 'a'), null);
      now = 1_060;
      groups.set(scope, [['a', 'rot']]);
      now = 1_120;
      // b ist abgelaufen (nicht erneuert), a noch nicht
      assert.equal(groups.of('mc.example.net', 'b'), null);
      assert.equal(groups.of('mc.example.net', 'a')?.group, 'rot');
      groups.sweep();
      assert.deepEqual(changed[changed.length - 1], ['b']);
      assert.equal(groups.count(scope.key), 1);
      now = 1_200;
      groups.sweep();
      assert.deepEqual(changed[changed.length - 1], ['a']);
      assert.equal(groups.count(scope.key), 0);
      groups.set(scope, [['c', 'rot']]);
      groups.clear('anderer');
      assert.equal(groups.count(scope.key), 1);
      groups.clear('p');
      assert.equal(groups.count(scope.key), 0);
    } finally {
      groups.close();
    }
  });
});
