// Welt teilen (ab 1.12.0): Welten anlegen, Grenzen, ändern, Mitglieder, löschen, öffentliche Ansicht, 503 ohne
// Welt-Domain, Steuerverbindung (open/ready, ersetzen 4002, fremde Welt, Fehler), Einladen per Realtime, geöffnete Welten
// von Freunden (GET /v1/worlds, world-open/world-closed), /v1/status, Datenauskunft, Konto löschen und Schema 9 → 10.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import type { ServiceOptions } from '../src/app';
import { Store } from '../src/db';
import { api, befriend, connect, devPlayer, rawRequest, startService, upgradeStatus, type Player, type TestService, type WsClient, UNDO_SCHEMA_11 } from './helpers';
import { webApi, webLogin, WEBSITE } from './web-helpers';
import { createWorld, DOMAIN, hostConnect, openWorld } from './world-helpers';

const CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
const OFF = 'Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet.';
const GONE = 'Diese Welt gibt es nicht (mehr).';

interface Setup {
  service: TestService;
  player(name: string): Promise<Player>;
  /** Realtime-Verbindung (wird am Ende geschlossen). */
  live(player: Player): Promise<WsClient>;
  /** Steuerverbindung (wird am Ende geschlossen). */
  host(player: Player): Promise<WsClient>;
}

async function withWorlds(options: Partial<ServiceOptions>, run: (setup: Setup) => Promise<void>): Promise<void> {
  const service = await startService({ dev: true, website: WEBSITE, weltDomain: DOMAIN, ...options });
  const clients: WsClient[] = [];
  try {
    await run({
      service,
      player: (name) => devPlayer(service.url, name),
      async live(player) {
        const { client } = await connect(service.wsUrl, player.token);
        clients.push(client);
        return client;
      },
      async host(player) {
        const client = await hostConnect(service, player.token);
        clients.push(client);
        return client;
      },
    });
  } finally {
    for (const client of clients) await client.close();
    await service.close();
  }
}

async function exported(service: TestService, player: Player): Promise<any> {
  return JSON.parse((await rawRequest(service.url, 'GET', '/v1/me/export', { Authorization: `Bearer ${player.token}` })).body.toString('utf8'));
}

describe('Welt teilen: aus ohne Welt-Domain', () => {
  test('Routen 503, Steuerverbindung 503, Status worlds null, kein Relay', async () => {
    const service = await startService({ dev: true });
    try {
      assert.equal(service.relayPort, null);
      const anna = await devPlayer(service.url, 'Anna');
      for (const [method, url] of [
        ['GET', '/v1/worlds'],
        ['POST', '/v1/worlds'],
        ['PATCH', `/v1/worlds/${'a'.repeat(32)}`],
        ['GET', `/v1/worlds/${'a'.repeat(32)}/members`],
      ] as const) {
        const res = await api(service.url, method, url, { token: anna.token, body: {} });
        assert.equal(res.status, 503, `${method} ${url}`);
        assert.equal(res.body.error, OFF);
      }
      const pub = await api(service.url, 'GET', '/v1/public/worlds/abcdef');
      assert.deepEqual([pub.status, pub.body.error, pub.headers.get('access-control-allow-origin')], [503, OFF, '*']);
      const upgrade = await upgradeStatus(`${service.url.replace('http', 'ws')}/v1/worlds/host`, { Authorization: `Bearer ${anna.token}` });
      assert.equal(upgrade.status, 503);
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.worlds, null);
      // Datenauskunft gibt es trotzdem (leer)
      const data = await exported(service, anna);
      assert.deepEqual(data.worlds, { worlds: [], memberOf: [] });
    } finally {
      await service.close();
    }
  });

  test('ungültige Welt-Domain oder Adresse: der Dienst startet nicht', async () => {
    await assert.rejects(startService({ weltDomain: 'kein domain' }), /Ungültige Welt-Domain/);
    await assert.rejects(startService({ weltDomain: 'welt.test', weltBind: 'irgendwo' }), /Ungültige Adresse für das Welt-Relay/);
  });

  test('Port belegt: Dienst läuft, Welt teilen ist aus (503), Warnung im Log', async () => {
    const blocker = await startService({ dev: true, weltDomain: DOMAIN });
    try {
      const second = await startService({ dev: true, weltDomain: DOMAIN, weltPort: blocker.relayPort! });
      try {
        assert.equal(second.relayPort, null);
        assert.ok(second.logs.some((line) => line.includes('Welt-Relay kann Port') && line.includes('Welt teilen ist aus')));
        const anna = await devPlayer(second.url, 'Anna');
        assert.equal((await api(second.url, 'GET', '/v1/worlds', { token: anna.token })).status, 503);
        assert.equal((await api(second.url, 'GET', '/health')).status, 200);
      } finally {
        await second.close();
      }
    } finally {
      await blocker.close();
    }
  });
});

describe('Welt teilen: Welten verwalten', () => {
  test('POST /v1/worlds: Felder, Code, Adresse, Standardwerte, Prüfungen, höchstens 10, auch mit Cookie', async () => {
    await withWorlds({}, async ({ service, player }) => {
      const anna = await player('Anna');
      const before = Date.now();
      const world = await createWorld(service, anna);
      assert.deepEqual(Object.keys(world).sort(), [
        'access',
        'address',
        'code',
        'created',
        'defaultRole',
        'id',
        'lastOnline',
        'maxPlayers',
        'name',
        'online',
        'players',
        'version',
      ]);
      assert.match(world.id, /^[0-9a-f]{32}$/);
      assert.match(world.code, CODE_RE);
      assert.equal(world.address, `${world.code}.${DOMAIN}`);
      assert.deepEqual(
        [world.name, world.access, world.maxPlayers, world.defaultRole, world.lastOnline, world.online, world.players, world.version],
        ['Welt von Anna', 'invited', 8, 'player', null, false, 0, null],
      );
      assert.ok(world.created >= before && world.created <= Date.now());

      const custom = await createWorld(service, anna, { name: '  Insel  ', access: 'friends', maxPlayers: 20, defaultRole: 'visitor' });
      assert.deepEqual([custom.name, custom.access, custom.maxPlayers, custom.defaultRole], ['Insel', 'friends', 20, 'visitor']);
      assert.notEqual(custom.code, world.code);

      for (const [body, error] of [
        [{ name: '' }, 'Der Name der Welt'],
        [{ name: 'x'.repeat(33) }, 'Der Name der Welt'],
        [{ name: 'a\nb' }, 'Der Name der Welt'],
        [{ access: 'alle' }, '„access“'],
        [{ maxPlayers: 0 }, '„maxPlayers“'],
        [{ maxPlayers: 21 }, '„maxPlayers“'],
        [{ maxPlayers: 2.5 }, '„maxPlayers“'],
        [{ defaultRole: 'chef' }, '„defaultRole“'],
      ] as const) {
        const res = await api(service.url, 'POST', '/v1/worlds', { token: anna.token, body });
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.ok(res.body.error.includes(error), res.body.error);
      }

      // höchstens 10 je Spieler
      for (let i = 2; i < 10; i++) await createWorld(service, anna, { name: `Welt ${i}` });
      const full = await api(service.url, 'POST', '/v1/worlds', { token: anna.token, body: {} });
      assert.equal(full.status, 409);
      assert.ok(full.body.error.includes('10 Welten'));
      const list = await api(service.url, 'GET', '/v1/worlds', { token: anna.token });
      assert.equal(list.body.mine.length, 10);
      assert.deepEqual(list.body.friends, []);
      assert.equal(new Set(list.body.mine.map((w: { code: string }) => w.code)).size, 10);

      // mit Cookie: nur mit CSRF-Header; ohne Anmeldung 401
      const ben = await player('Ben');
      const { cookie } = await webLogin(service, ben);
      assert.equal((await webApi(service, 'POST', '/v1/worlds', { cookie, csrf: false, body: {} })).status, 403);
      const viaWeb = await webApi(service, 'POST', '/v1/worlds', { cookie, body: { name: 'Vom Browser' } });
      assert.equal(viaWeb.status, 200);
      assert.equal(viaWeb.body.name, 'Vom Browser');
      assert.equal((await api(service.url, 'GET', '/v1/worlds')).status, 401);
    });
  });

  test('GET/PATCH/DELETE /v1/worlds/<id>: nur eigene, Teiländerungen, Prüfungen', async () => {
    await withWorlds({}, async ({ service, player }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const world = await createWorld(service, anna);
      const url = `/v1/worlds/${world.id}`;
      assert.deepEqual((await api(service.url, 'GET', url, { token: anna.token })).body, world);
      for (const res of [
        await api(service.url, 'GET', url, { token: ben.token }),
        await api(service.url, 'PATCH', url, { token: ben.token, body: { name: 'Meins' } }),
        await api(service.url, 'DELETE', url, { token: ben.token }),
        await api(service.url, 'GET', '/v1/worlds/nichtda', { token: anna.token }),
      ]) {
        assert.equal(res.status, 404);
        assert.equal(res.body.error, GONE);
      }
      let res = await api(service.url, 'PATCH', url, { token: anna.token, body: { access: 'open' } });
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.name, res.body.access, res.body.maxPlayers, res.body.code], ['Welt von Anna', 'open', 8, world.code]);
      res = await api(service.url, 'PATCH', url, { token: anna.token, body: { name: 'Burg', maxPlayers: 3, defaultRole: 'operator', unbekannt: 1 } });
      assert.deepEqual([res.body.name, res.body.access, res.body.maxPlayers, res.body.defaultRole], ['Burg', 'open', 3, 'operator']);
      assert.equal((await api(service.url, 'PATCH', url, { token: anna.token, body: { access: 'freunde' } })).status, 400);
      assert.equal((await api(service.url, 'PATCH', url, { token: anna.token, body: { name: null } })).status, 400);

      assert.deepEqual((await api(service.url, 'DELETE', url, { token: anna.token })).body, { ok: true });
      assert.equal((await api(service.url, 'GET', url, { token: anna.token })).status, 404);
      assert.deepEqual((await api(service.url, 'GET', '/v1/worlds', { token: anna.token })).body.mine, []);
    });
  });

  test('Mitglieder: hinzufügen, Rolle ändern, UUID für Heldix-Spieler, entfernen, Prüfungen', async () => {
    await withWorlds({}, async ({ service, player }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const world = await createWorld(service, anna, { defaultRole: 'visitor' });
      const base = `/v1/worlds/${world.id}/members`;
      assert.deepEqual((await api(service.url, 'GET', base, { token: anna.token })).body, []);
      // Ohne Rolle: Standardrolle der Welt; Ben ist Heldix-Spieler (UUID), Steve nicht
      let res = await api(service.url, 'PUT', `${base}/ben`, { token: anna.token, body: {} });
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.deepEqual([res.body[0].name, res.body[0].uuid, res.body[0].role], ['ben', ben.uuid, 'visitor']);
      assert.deepEqual(Object.keys(res.body[0]).sort(), ['added', 'name', 'role', 'uuid']);
      res = await api(service.url, 'PUT', `${base}/Steve`, { token: anna.token, body: { role: 'operator' } });
      assert.deepEqual(
        res.body.map((m: { name: string; uuid: string | null; role: string }) => [m.name, m.uuid, m.role]),
        [
          ['ben', ben.uuid, 'visitor'],
          ['Steve', null, 'operator'],
        ],
      );
      // Rolle ändern, Schreibweise übernehmen, Zeitpunkt bleibt
      const added = res.body[0].added;
      res = await api(service.url, 'PUT', `${base}/Ben`, { token: anna.token, body: { role: 'player' } });
      assert.deepEqual([res.body[0].name, res.body[0].role, res.body[0].added], ['Ben', 'player', added]);
      for (const [name, body] of [
        ['zu-lang-und-falsch', {}],
        ['Ben', { role: 'admin' }],
      ] as const) {
        assert.equal((await api(service.url, 'PUT', `${base}/${name}`, { token: anna.token, body })).status, 400, name);
      }
      assert.equal((await api(service.url, 'GET', base, { token: ben.token })).status, 404);
      res = await api(service.url, 'DELETE', `${base}/steve`, { token: anna.token });
      assert.deepEqual(res.body.map((m: { name: string }) => m.name), ['Ben']);
      // noch einmal: kein Fehler
      assert.equal((await api(service.url, 'DELETE', `${base}/steve`, { token: anna.token })).status, 200);
    });
  });

  test('GET /v1/public/worlds/<code>: Name, Gastgeber, online, Zugang, CORS; unbekannt 404; Grenze pro IP', async () => {
    await withWorlds({ publicWorldRateLimit: 5 }, async ({ service, player, host }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna, { name: 'Insel', maxPlayers: 4 });
      let res = await api(service.url, 'GET', `/v1/public/worlds/${world.code}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual(res.body, {
        name: 'Insel',
        address: world.address,
        host: { uuid: anna.uuid, name: 'Anna' },
        online: false,
        players: 0,
        maxPlayers: 4,
        version: null,
        access: 'closed',
      });
      const hostWs = await host(anna);
      await openWorld(hostWs, world.id, { version: '26.3' });
      res = await api(service.url, 'GET', `/v1/public/worlds/${world.code}`);
      assert.deepEqual([res.body.online, res.body.players, res.body.version], [true, 1, '26.3']);
      await api(service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { access: 'open' } });
      assert.equal((await api(service.url, 'GET', `/v1/public/worlds/${world.code}`)).body.access, 'open');
      const unknown = await api(service.url, 'GET', '/v1/public/worlds/zzzzzz');
      assert.deepEqual([unknown.status, unknown.body.error], [404, 'Diese Welt gibt es nicht.']);
      assert.equal((await api(service.url, 'GET', '/v1/public/worlds/FALSCH')).status, 404);
      assert.equal((await api(service.url, 'GET', `/v1/public/worlds/${world.code}`)).status, 429);
    });
  });
});

describe('Welt teilen: Steuerverbindung', () => {
  test('open → ready (Adresse, Code, Welt) und members; Status worlds; ping; close; last_online und Version', async () => {
    await withWorlds({}, async ({ service, player, host }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Steve`, { token: anna.token, body: {} });
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.worlds, 0);
      const hostWs = await host(anna);
      const ready = await openWorld(hostWs, world.id);
      assert.deepEqual([ready.address, ready.code], [`${world.code}.${DOMAIN}`, world.code]);
      assert.deepEqual([ready.world.id, ready.world.online, ready.world.version], [world.id, true, '26.3']);
      const members = await hostWs.next('members');
      assert.deepEqual(members.members.map((m: { name: string }) => m.name), ['Steve']);
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.worlds, 1);
      let mine = (await api(service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token })).body;
      assert.deepEqual([mine.online, mine.players, mine.version], [true, 1, '26.3']);
      assert.ok(mine.lastOnline !== null);
      // Spielerzahl vom Gastgeber
      hostWs.send({ type: 'players', count: 3 });
      await hostWs.sync();
      assert.equal((await api(service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token })).body.players, 3);
      // Einstellungen geändert, während die Welt offen ist: settings an den Gastgeber
      await api(service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { maxPlayers: 5 } });
      assert.equal((await hostWs.next('settings')).world.maxPlayers, 5);
      // Mitglied hinzugefügt: neue Liste an den Gastgeber
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Alex`, { token: anna.token, body: {} });
      assert.deepEqual((await hostWs.next('members')).members.map((m: { name: string }) => m.name), ['Alex', 'Steve']);
      // close: offline, Verbindung bleibt
      hostWs.send({ type: 'close' });
      await hostWs.sync();
      mine = (await api(service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token })).body;
      assert.deepEqual([mine.online, mine.players, mine.version], [false, 0, '26.3']);
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.worlds, 0);
      // wieder öffnen geht über dieselbe Verbindung
      await openWorld(hostWs, world.id, { version: '26.4' });
      assert.equal((await api(service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token })).body.version, '26.4');
    });
  });

  test('Fehler: fremde oder unbekannte Welt, ungültige Version oder Protokollnummer → error und 4011', async () => {
    await withWorlds({}, async ({ service, player, host }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const world = await createWorld(service, anna);
      for (const [who, message, error] of [
        [ben, { world: world.id }, GONE],
        [anna, { world: 'f'.repeat(32) }, GONE],
        [anna, { world: world.id, version: 'eins zwei' }, 'Ungültige Minecraft-Version.'],
        [anna, { world: world.id, protocol: -1 }, 'Ungültige Protokollnummer.'],
      ] as const) {
        const hostWs = await host(who);
        hostWs.send({ type: 'open', version: '26.3', protocol: 775, ...message });
        assert.equal((await hostWs.next('error')).message, error);
        assert.equal((await hostWs.closed).code, 4011);
      }
      // ohne Token: 401, normales GET: 426
      assert.equal((await upgradeStatus(`${service.url.replace('http', 'ws')}/v1/worlds/host`)).status, 401);
      assert.equal((await api(service.url, 'GET', '/v1/worlds/host')).status, 426);
    });
  });

  test('eine Steuerverbindung je Spieler: die neue ersetzt die alte (4002), die Welt geht dabei zu', async () => {
    await withWorlds({}, async ({ service, player, host }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      const first = await host(anna);
      await openWorld(first, world.id);
      const second = await host(anna);
      assert.equal((await first.closed).code, 4002);
      assert.equal((await api(service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token })).body.online, false);
      await openWorld(second, world.id);
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.worlds, 1);
      // Eine andere eigene Welt öffnen schließt die erste (eine geöffnete Welt je Spieler)
      const other = await createWorld(service, anna, { name: 'Zweite' });
      await openWorld(second, other.id);
      const list = (await api(service.url, 'GET', '/v1/worlds', { token: anna.token })).body.mine;
      assert.deepEqual(list.map((w: { online: boolean }) => w.online), [false, true]);
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.worlds, 1);
    });
  });

  test('Welt löschen, während sie offen ist: error und 4010; Konto löschen: 4001; Leerlauf: 4000', async () => {
    await withWorlds({ worldIdleTimeoutMs: 300 }, async ({ service, player, host }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      const hostWs = await host(anna);
      await openWorld(hostWs, world.id);
      await api(service.url, 'DELETE', `/v1/worlds/${world.id}`, { token: anna.token });
      assert.equal((await hostWs.next('error')).message, 'Die Welt wurde gelöscht.');
      assert.equal((await hostWs.closed).code, 4010);

      const other = await createWorld(service, anna);
      const again = await host(anna);
      await openWorld(again, other.id);
      assert.deepEqual((await api(service.url, 'DELETE', '/v1/me', { token: anna.token })).body, { deleted: true });
      assert.equal((await again.closed).code, 4001);
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.worlds, 0);

      const ben = await player('Ben');
      const idle = await host(ben);
      assert.equal((await idle.closed).code, 4000);
    });
  });
});

describe('Welt teilen: Freunde und Mitglieder', () => {
  test('POST /v1/worlds/<id>/invite: world-invite an Freunde, Mitglied mit Standardrolle, andere übersprungen', async () => {
    await withWorlds({}, async ({ service, player, live }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const carla = await player('Carla');
      await befriend(service.url, anna, ben);
      const benWs = await live(ben);
      const carlaWs = await live(carla);
      const world = await createWorld(service, anna, { name: 'Insel', defaultRole: 'visitor' });
      const res = await api(service.url, 'POST', `/v1/worlds/${world.id}/invite`, { token: anna.token, body: { uuids: [ben.uuid, carla.uuid, ben.uuid] } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.invited, [{ uuid: ben.uuid, name: 'Ben' }]);
      assert.deepEqual(res.body.members.map((m: { name: string; uuid: string; role: string }) => [m.name, m.uuid, m.role]), [['Ben', ben.uuid, 'visitor']]);
      const message = await benWs.next('world-invite');
      assert.deepEqual(message.world, { id: world.id, name: 'Insel', address: world.address, host: { uuid: anna.uuid, name: 'Anna' } });
      await carlaWs.sync();
      assert.equal(carlaWs.messages.some((m) => m.type === 'world-invite'), false, 'kein Freund: keine Einladung');
      // Rolle bleibt beim erneuten Einladen
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: anna.token, body: { role: 'operator' } });
      const again = await api(service.url, 'POST', `/v1/worlds/${world.id}/invite`, { token: anna.token, body: { uuids: [ben.uuid] } });
      assert.equal(again.body.members[0].role, 'operator');
      for (const body of [{}, { uuids: [] }, { uuids: ['nein'] }, { uuids: new Array(51).fill(ben.uuid) }]) {
        assert.equal((await api(service.url, 'POST', `/v1/worlds/${world.id}/invite`, { token: anna.token, body })).status, 400);
      }
    });
  });

  test('geöffnete Welten: Freunde (Zugang Freunde/offen, Präsenz an) und Mitglieder sehen sie; world-open/world-closed', async () => {
    await withWorlds({}, async ({ service, player, live, host }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const carla = await player('Carla');
      const dora = await player('Dora');
      await befriend(service.url, anna, ben);
      await befriend(service.url, anna, carla);
      const benWs = await live(ben);
      const carlaWs = await live(carla);
      const doraWs = await live(dora);
      const world = await createWorld(service, anna, { name: 'Insel', access: 'invited' });
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Dora`, { token: anna.token, body: {} });
      const hostWs = await host(anna);
      await openWorld(hostWs, world.id);

      // Nur Eingeladene: Dora (Mitglied, kein Freund) sieht sie, Ben und Carla (Freunde) nicht
      const opened = await doraWs.next('world-open');
      assert.deepEqual(opened.world, {
        id: world.id,
        name: 'Insel',
        address: world.address,
        host: { uuid: anna.uuid, name: 'Anna' },
        players: 1,
        maxPlayers: 8,
        version: '26.3',
        online: true,
      });
      const friendsOf = async (p: Player) => (await api(service.url, 'GET', '/v1/worlds', { token: p.token })).body.friends;
      assert.deepEqual((await friendsOf(dora)).map((w: { id: string }) => w.id), [world.id]);
      assert.deepEqual(await friendsOf(ben), []);
      await benWs.sync();
      assert.equal(benWs.messages.some((m) => m.type === 'world-open'), false);

      // Zugang Freunde: Ben und Carla sehen sie jetzt
      await api(service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { access: 'friends' } });
      assert.equal((await benWs.next('world-open')).world.id, world.id);
      assert.equal((await carlaWs.next('world-open')).world.id, world.id);
      assert.deepEqual((await friendsOf(ben)).map((w: { id: string }) => w.id), [world.id]);
      assert.deepEqual(Object.keys((await friendsOf(ben))[0]).sort(), ['address', 'host', 'id', 'maxPlayers', 'name', 'online', 'players', 'version']);

      // Präsenz aus: Freunde sehen sie nicht mehr (Mitglieder schon)
      await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { presence: false } });
      assert.deepEqual((await benWs.next('world-closed')).world, { id: world.id });
      assert.deepEqual((await carlaWs.next('world-closed')).world, { id: world.id });
      assert.deepEqual(await friendsOf(ben), []);
      assert.deepEqual((await friendsOf(dora)).map((w: { id: string }) => w.id), [world.id]);
      await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { presence: true } });
      assert.equal((await benWs.next('world-open')).world.id, world.id);
      assert.equal((await carlaWs.next('world-open')).world.id, world.id);

      // Mitglied Dora blockiert Anna: Dora sieht die Welt nicht mehr
      assert.equal((await api(service.url, 'POST', '/v1/blocks', { token: dora.token, body: { uuid: anna.uuid } })).status, 200);
      assert.deepEqual(await friendsOf(dora), []);

      // Welt zu: world-closed an alle, denen sie gemeldet wurde
      hostWs.send({ type: 'close' });
      assert.deepEqual((await benWs.next('world-closed')).world, { id: world.id });
      assert.deepEqual((await carlaWs.next('world-closed')).world, { id: world.id });
      assert.deepEqual(await friendsOf(ben), []);
      // der Gastgeber selbst sieht die eigene Welt nicht unter friends
      assert.deepEqual(await friendsOf(anna), []);
    });
  });

  test('Datenauskunft: eigene Welten mit Mitgliedern und Mitgliedschaften bei anderen; Konto löschen', async () => {
    await withWorlds({}, async ({ service, player }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const world = await createWorld(service, anna, { name: 'Insel' });
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: anna.token, body: { role: 'operator' } });
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Steve`, { token: anna.token, body: {} });
      const own = (await exported(service, anna)).worlds;
      assert.equal(own.worlds.length, 1);
      const [w] = own.worlds;
      assert.deepEqual([w.id, w.code, w.address, w.name, w.access, w.maxPlayers, w.defaultRole, w.lastOnline, w.version], [
        world.id,
        world.code,
        world.address,
        'Insel',
        'invited',
        8,
        'player',
        null,
        null,
      ]);
      assert.deepEqual(w.members.map((m: { name: string; uuid: string | null; role: string }) => [m.name, m.uuid, m.role]), [
        ['Ben', ben.uuid, 'operator'],
        ['Steve', null, 'player'],
      ]);
      assert.deepEqual(own.memberOf, []);
      const benData = (await exported(service, ben)).worlds;
      assert.deepEqual(benData.worlds, []);
      assert.equal(benData.memberOf.length, 1);
      assert.deepEqual(
        [benData.memberOf[0].world, benData.memberOf[0].name, benData.memberOf[0].host, benData.memberOf[0].as, benData.memberOf[0].role],
        [world.id, 'Insel', { uuid: anna.uuid, name: 'Anna' }, 'Ben', 'operator'],
      );
      // Ben löscht sein Konto: in Annas Liste bleibt der Name, die UUID fällt weg
      await api(service.url, 'DELETE', '/v1/me', { token: ben.token });
      const members = (await api(service.url, 'GET', `/v1/worlds/${world.id}/members`, { token: anna.token })).body;
      assert.deepEqual(members.map((m: { name: string; uuid: string | null }) => [m.name, m.uuid]), [
        ['Ben', null],
        ['Steve', null],
      ]);
      // Anna löscht ihr Konto: Welt und Mitglieder sind weg, der Code ist unbekannt
      await api(service.url, 'DELETE', '/v1/me', { token: anna.token });
      assert.equal((await api(service.url, 'GET', `/v1/public/worlds/${world.code}`)).status, 404);
    });
  });
});

test('Schema 9 → 10: Tabellen für Welten kommen dazu, vorhandene Daten bleiben', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const now = Date.now();
    const first = new Store(dataDir);
    first.upsertUser('a'.repeat(32), 'Anna', now);
    first.close();
    // Zurück auf Stufe 9 (wie eine Datenbank von 1.11.0)
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    // Stufe 11 (Freunde 2.0) rückgängig, dann Stufe 10 (Welten)
    old.exec(UNDO_SCHEMA_11);
    old.exec('DROP TABLE world_members; DROP TABLE worlds; PRAGMA user_version = 9;');
    old.close();
    const store = new Store(dataDir);
    try {
      assert.equal(store.getUser('a'.repeat(32))?.name, 'Anna');
      store.insertWorld({ id: 'b'.repeat(32), owner: 'a'.repeat(32), code: 'abcdef', name: 'Insel', access: 'friends', maxPlayers: 4, defaultRole: 'visitor', createdAt: now });
      store.putWorldMember('b'.repeat(32), 'Steve', null, 'player', now);
      assert.deepEqual(store.getWorldByCode('abcdef')?.access, 'friends');
      assert.equal(store.isWorldMemberNamed('b'.repeat(32), 'STEVE'), true);
      assert.equal(store.isWorldMemberNamed('b'.repeat(32), 'Alex'), false);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 11);
    check.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
