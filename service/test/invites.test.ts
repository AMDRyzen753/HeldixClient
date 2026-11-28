// Einladungen (ab 1.11.0): anlegen, wiederverwenden, Grenzen, widerrufen, öffentlich ansehen, annehmen (Freundschaft und
// Willkommens-Belohnung), Bestätigung nach Spielzeit mit Belohnungen für Einladende, Realtime-Nachrichten, Datenauskunft,
// Aufräumen und Konto löschen.
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import type { ServiceOptions } from '../src/app';
import { Store } from '../src/db';
import { INVITE_REWARDS, WELCOME_REWARD } from '../src/invites';
import { api, befriend, connect, devPlayer, rawRequest, sleep, startService, waitFor, type Player, type TestService, type WsClient } from './helpers';
import { webApi, webLogin, WEBSITE } from './web-helpers';

const CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;
const DAY = 24 * 60 * 60 * 1000;
const GONE = 'Diese Einladung gibt es nicht (mehr). Vielleicht ist sie abgelaufen oder wurde zurückgezogen.';
const OWN = 'Das ist deine eigene Einladung. Schick den Link an Freunde, die HeldixClient noch nicht haben.';
const GROUP = 'a'.repeat(64);

interface Setup {
  service: TestService;
  player(name: string): Promise<Player>;
  /** Realtime-Verbindung (wird am Ende geschlossen). */
  live(player: Player): Promise<WsClient>;
  invite(player: Player, body?: unknown): Promise<any>;
  accept(player: Player, code: string): ReturnType<typeof api>;
  overview(player: Player): Promise<any>;
  /** Direkt in der Datenbank ändern (wie über die CLI). */
  sql(statement: string, ...params: (string | number | null)[]): void;
}

async function withInvites(options: Partial<ServiceOptions>, run: (setup: Setup) => Promise<void>): Promise<void> {
  const service = await startService({ dev: true, website: WEBSITE, ...options });
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
      async invite(player, body = {}) {
        const res = await api(service.url, 'POST', '/v1/invites', { token: player.token, body });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        return res.body;
      },
      accept: (player, code) => api(service.url, 'POST', `/v1/invites/${code}/accept`, { token: player.token }),
      async overview(player) {
        const res = await api(service.url, 'GET', '/v1/invites', { token: player.token });
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

/** Freunde laut GET /v1/friends (UUIDs). */
async function friendsOf(service: TestService, player: Player): Promise<string[]> {
  return (await api(service.url, 'GET', '/v1/friends', { token: player.token })).body.friends.map((f: { uuid: string }) => f.uuid);
}

async function exported(service: TestService, player: Player): Promise<any> {
  return JSON.parse((await rawRequest(service.url, 'GET', '/v1/me/export', { Authorization: `Bearer ${player.token}` })).body.toString('utf8'));
}

describe('Einladungen: anlegen und verwalten', () => {
  test('POST /v1/invites: Felder, Code, Ablauf, Server normalisiert, Voice nur mit Server, Fehler', async () => {
    await withInvites({}, async ({ service, player, invite }) => {
      const anna = await player('Anna');
      const before = Date.now();
      const plain = await invite(anna);
      assert.deepEqual(Object.keys(plain).sort(), ['accepted', 'appUrl', 'code', 'created', 'expires', 'server', 'url', 'voice']);
      assert.match(plain.code, CODE_RE);
      assert.equal(plain.url, `${WEBSITE}/einladung#${plain.code}`);
      assert.equal(plain.appUrl, `heldixclient://einladung/${plain.code}`);
      assert.deepEqual([plain.server, plain.voice, plain.accepted], [null, false, 0]);
      assert.ok(plain.expires >= before + 30 * DAY && plain.expires <= Date.now() + 30 * DAY);

      const withServer = await invite(anna, { server: 'Play.Example.NET:25565' });
      assert.equal(withServer.server, 'play.example.net');
      assert.notEqual(withServer.code, plain.code);
      const voice = await invite(anna, { server: 'play.example.net', voice: { group: GROUP } });
      assert.equal(voice.voice, true);
      assert.ok(voice.expires <= Date.now() + DAY && voice.expires >= before + DAY);
      assert.equal(JSON.stringify(voice).includes(GROUP), false, 'der Prüfwert geht nicht zurück');

      for (const [body, error] of [
        [{ server: '127.0.0.1' }, 'Ungültige Server-Adresse'],
        [{ server: 'localhost' }, 'Ungültige Server-Adresse'],
        [{ voice: { group: GROUP } }, 'nur zusammen mit einem Server'],
        [{ server: 'play.example.net', voice: { group: 'kurz' } }, '„voice“ muss'],
        [{ server: 'play.example.net', voice: GROUP }, '„voice“ muss'],
      ] as const) {
        const res = await api(service.url, 'POST', '/v1/invites', { token: anna.token, body });
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.ok(res.body.error.includes(error), res.body.error);
      }
      // ohne Anmeldung: 401; mit Cookie nur mit CSRF-Header
      assert.equal((await api(service.url, 'POST', '/v1/invites', { body: {} })).status, 401);
      const { cookie } = await webLogin(service, anna);
      assert.equal((await webApi(service, 'POST', '/v1/invites', { cookie, csrf: false, body: {} })).status, 403);
      const viaWeb = await webApi(service, 'POST', '/v1/invites', { cookie, body: {} });
      assert.equal(viaWeb.status, 200);
      assert.equal(viaWeb.body.code, plain.code, 'dieselbe allgemeine Einladung');
    });
  });

  test('ohne Webseite: url null; Voice Chat aus: keine Voice-Einladungen (503)', async () => {
    await withInvites({ website: null, voice: false }, async ({ service, player, invite }) => {
      const anna = await player('Anna');
      const plain = await invite(anna);
      assert.equal(plain.url, null);
      assert.equal(plain.appUrl, `heldixclient://einladung/${plain.code}`);
      const res = await api(service.url, 'POST', '/v1/invites', { token: anna.token, body: { server: 'play.example.net', voice: { group: GROUP } } });
      assert.equal(res.status, 503);
      assert.equal(res.body.error, 'Der Voice Chat ist auf diesem Server aus.');
    });
  });

  test('wiederverwenden: gleicher Server und gleiche Gruppe; fast abgelaufen: neue Einladung', async () => {
    await withInvites({}, async ({ player, invite, sql }) => {
      const [anna, ben] = [await player('Anna'), await player('Ben')];
      const a = await invite(anna, { server: 'play.example.net' });
      assert.equal((await invite(anna, { server: 'PLAY.example.net' })).code, a.code);
      assert.notEqual((await invite(anna, { server: 'other.example.net' })).code, a.code);
      assert.notEqual((await invite(ben, { server: 'play.example.net' })).code, a.code, 'je Spieler');
      const v = await invite(anna, { server: 'play.example.net', voice: { group: GROUP } });
      assert.notEqual(v.code, a.code);
      assert.equal((await invite(anna, { server: 'play.example.net', voice: { group: GROUP } })).code, v.code);
      assert.notEqual((await invite(anna, { server: 'play.example.net', voice: { group: 'b'.repeat(64) } })).code, v.code);
      // Gilt nur noch weniger als die halbe Laufzeit (hier 10 Tage von 30): neu
      sql('UPDATE invites SET expires_at = ? WHERE code = ?', Date.now() + 10 * DAY, a.code);
      const fresh = await invite(anna, { server: 'play.example.net' });
      assert.notEqual(fresh.code, a.code);
      assert.equal((await invite(anna, { server: 'play.example.net' })).code, fresh.code);
    });
  });

  test('Grenzen: höchstens N neue pro Tag (429), höchstens 50 offene (älteste ohne Annahmen fallen weg)', async () => {
    await withInvites({ inviteDailyLimit: 3 }, async ({ service, player, invite }) => {
      const anna = await player('Anna');
      for (let i = 0; i < 3; i++) await invite(anna, { server: `s${i}.example.net` });
      const res = await api(service.url, 'POST', '/v1/invites', { token: anna.token, body: { server: 's9.example.net' } });
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get('retry-after')) > 0);
      assert.ok(res.body.error.includes('20 neue Einladungen pro Tag'));
      // Wiederverwenden zählt nicht, der allgemeine Link aus GET auch nicht
      assert.equal((await api(service.url, 'POST', '/v1/invites', { token: anna.token, body: { server: 's1.example.net' } })).status, 200);
      assert.equal((await api(service.url, 'GET', '/v1/invites', { token: anna.token })).status, 200);
    });

    await withInvites({ inviteDailyLimit: 100 }, async ({ player, invite, accept, overview }) => {
      const [anna, ben] = [await player('Anna'), await player('Ben')];
      const codes: string[] = [];
      for (let i = 0; i < 50; i++) {
        codes.push((await invite(anna, { server: `s${i}.example.net` })).code);
        await sleep(1);
      }
      // Die älteste hat eine Annahme: Sie bleibt, stattdessen fällt die zweitälteste weg.
      assert.equal((await accept(ben, codes[0]!)).status, 200);
      const extra = await invite(anna, { server: 'neu.example.net' });
      // GET legt dazu den allgemeinen Link an: Auch dafür fällt die nächstälteste weg.
      const view = await overview(anna);
      const open = view.invites.map((i: { code: string }) => i.code);
      assert.equal(open.length, 50);
      assert.ok(open.includes(codes[0]), 'mit Annahme bleibt');
      assert.equal(open.includes(codes[1]), false, 'älteste ohne Annahme fällt weg');
      assert.equal(open.includes(codes[2]), false);
      assert.ok(open.includes(codes[3]));
      assert.deepEqual(open.slice(0, 2), [view.link.code, extra.code], 'neueste zuerst');
    });
  });

  test('GET /v1/invites: allgemeiner Link (bei Bedarf neu), offene Einladungen, Zähler, Belohnungen', async () => {
    await withInvites({}, async ({ service, player, invite, overview }) => {
      const anna = await player('Anna');
      const first = await overview(anna);
      assert.deepEqual(Object.keys(first).sort(), ['confirmed', 'invited', 'invites', 'link', 'pending', 'rewards', 'unlocked']);
      assert.match(first.link.code, CODE_RE);
      assert.deepEqual([first.link.server, first.link.voice], [null, false]);
      assert.deepEqual(first.invites.map((i: { code: string }) => i.code), [first.link.code]);
      assert.deepEqual([first.invited, first.confirmed, first.pending], [0, 0, 0]);
      assert.deepEqual(first.rewards, [
        { cosmetic: 'freundesfunken', friends: 1, unlocked: false },
        { cosmetic: 'freundesband', friends: 3, unlocked: false },
      ]);
      assert.deepEqual(first.unlocked, []);
      assert.deepEqual(INVITE_REWARDS, [
        { cosmetic: 'freundesfunken', friends: 1 },
        { cosmetic: 'freundesband', friends: 3 },
      ]);
      assert.equal(WELCOME_REWARD, 'freundesfunken');
      const again = await overview(anna);
      assert.equal(again.link.code, first.link.code, 'derselbe Link');
      const server = await invite(anna, { server: 'play.example.net' });
      assert.deepEqual((await overview(anna)).invites.map((i: { code: string }) => i.code), [server.code, first.link.code]);

      // Widerrufen: eigene ja, fremde und unbekannte 404; danach ein neuer allgemeiner Link
      const ben = await player('Ben');
      assert.equal((await api(service.url, 'DELETE', `/v1/invites/${first.link.code}`, { token: ben.token })).status, 404);
      for (const code of ['abcdefghij', 'kurz', 'ABCDEFGHJK']) {
        const res = await api(service.url, 'DELETE', `/v1/invites/${code}`, { token: anna.token });
        assert.equal(res.status, 404, code);
        assert.equal(res.body.error, GONE);
      }
      const revoked = await api(service.url, 'DELETE', `/v1/invites/${first.link.code}`, { token: anna.token });
      assert.deepEqual([revoked.status, revoked.body], [200, { ok: true }]);
      assert.equal((await api(service.url, 'GET', `/v1/public/invites/${first.link.code}`)).status, 404);
      assert.equal((await api(service.url, 'DELETE', `/v1/invites/${first.link.code}`, { token: anna.token })).status, 404);
      const after = await overview(anna);
      assert.notEqual(after.link.code, first.link.code);
      assert.deepEqual(after.invites.map((i: { code: string }) => i.code).sort(), [after.link.code, server.code].sort());
    });
  });

  test('öffentlich: GET /v1/public/invites/<code> mit CORS, 404 bei unbekannt oder abgelaufen, eigene Grenze pro IP', async () => {
    await withInvites({ publicInviteRateLimit: 6 }, async ({ service, player, invite, sql }) => {
      const anna = await player('Anna');
      const plain = await invite(anna, { server: 'play.example.net' });
      const res = await api(service.url, 'GET', `/v1/public/invites/${plain.code}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(res.body, {
        code: plain.code,
        inviter: { uuid: anna.uuid, name: 'Anna' },
        server: 'play.example.net',
        voice: null,
        expires: plain.expires,
        welcome: 'freundesfunken',
      });
      const voice = await invite(anna, { server: 'play.example.net', voice: { group: GROUP } });
      assert.deepEqual((await api(service.url, 'GET', `/v1/public/invites/${voice.code}`)).body.voice, { members: 0, guests: 0, maxGuests: 4 });

      for (const code of ['abcdefghij', 'i1lo0abcde', 'x']) {
        const missing = await api(service.url, 'GET', `/v1/public/invites/${code}`);
        assert.equal(missing.status, 404, code);
        assert.equal(missing.body.error, GONE);
        assert.equal(missing.headers.get('access-control-allow-origin'), '*');
      }
      sql('UPDATE invites SET expires_at = ? WHERE code = ?', Date.now() - 1, plain.code);
      assert.equal((await api(service.url, 'GET', `/v1/public/invites/${plain.code}`)).status, 404, 'abgelaufen');
      assert.equal((await api(service.url, 'POST', `/v1/invites/${plain.code}/accept`, { token: (await player('Ben')).token })).status, 404);
      // Grenze: hier 6 pro Minute und IP
      const limited = await api(service.url, 'GET', `/v1/public/invites/${voice.code}`);
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
    });
  });

  test('Aufräumen: abgelaufene Einladungen löscht der Dienst', async () => {
    await withInvites({ sweepIntervalMs: 50 }, async ({ service, player, invite, sql }) => {
      const anna = await player('Anna');
      const plain = await invite(anna);
      const other = await invite(anna, { server: 'play.example.net' });
      sql('UPDATE invites SET expires_at = ? WHERE code = ?', Date.now() - 1, plain.code);
      await waitFor(async () => (await exported(service, anna)).invites.links.length === 1);
      assert.deepEqual((await exported(service, anna)).invites.links.map((l: { code: string }) => l.code), [other.code]);
    });
  });
});

describe('Einladungen: annehmen', () => {
  test('neuer Spieler: Freundschaft, Willkommens-Belohnung, Realtime an beide, Zähler', async () => {
    await withInvites({}, async ({ service, player, live, invite, accept, overview }) => {
      const [anna, ben] = [await player('Anna'), await player('Ben')];
      const annaWs = await live(anna);
      const benWs = await live(ben);
      const { code } = await invite(anna, { server: 'play.example.net' });
      const res = await accept(ben, code);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body, {
        inviter: { uuid: anna.uuid, name: 'Anna' },
        server: 'play.example.net',
        friend: 'new',
        reward: 'freundesfunken',
        rewardReason: null,
      });
      assert.deepEqual(await friendsOf(service, ben), [anna.uuid]);
      assert.deepEqual(await friendsOf(service, anna), [ben.uuid]);
      assert.deepEqual(await benWs.next('unlock'), { type: 'unlock', cosmetic: 'freundesfunken', reason: 'invite' });
      assert.deepEqual((await benWs.next('friends')).friends.map((f: { uuid: string }) => f.uuid), [anna.uuid]);
      assert.deepEqual(await annaWs.next('invite'), { type: 'invite', event: 'accepted', name: 'Ben' });
      assert.deepEqual((await annaWs.next('friends')).friends.map((f: { uuid: string }) => f.uuid), [ben.uuid]);

      const view = await overview(anna);
      assert.deepEqual([view.invited, view.confirmed, view.pending], [1, 0, 1]);
      assert.equal(view.invites.find((i: { code: string }) => i.code === code).accepted, 1);
      assert.deepEqual(view.unlocked, [], 'der Einladende erst nach der Bestätigung');
      assert.deepEqual((await overview(ben)).unlocked, ['freundesfunken']);
      const cosmetics = (await api(service.url, 'GET', '/v1/me/cosmetics', { token: ben.token })).body;
      assert.deepEqual(cosmetics.unlocked, ['freundesfunken']);

      // Noch einmal annehmen: schon befreundet, schon eingeladen, keine neuen Nachrichten
      await annaWs.sync();
      annaWs.drain();
      const again = await accept(ben, code);
      assert.deepEqual([again.body.friend, again.body.reward, again.body.rewardReason], ['already', null, 'already-invited']);
      await annaWs.sync();
      assert.deepEqual(annaWs.drain(), []);
      assert.equal((await overview(anna)).invited, 1);
    });
  });

  test('eigene Einladung: 400 mit friend self und klarer Meldung; mit Cookie nur mit CSRF-Header', async () => {
    await withInvites({}, async ({ service, player, invite, accept }) => {
      const anna = await player('Anna');
      const { code } = await invite(anna);
      const res = await accept(anna, code);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: OWN, code: 'SELF', friend: 'self', reward: null, rewardReason: 'self' });
      const ben = await player('Ben');
      const { cookie } = await webLogin(service, ben);
      assert.equal((await webApi(service, 'POST', `/v1/invites/${code}/accept`, { cookie, csrf: false })).status, 403);
      const viaWeb = await webApi(service, 'POST', `/v1/invites/${code}/accept`, { cookie });
      assert.equal(viaWeb.status, 200);
      assert.equal(viaWeb.body.friend, 'new');
      for (const bad of ['abcdefghij', 'zu-kurz']) assert.equal((await accept(ben, bad)).status, 404);
    });
  });

  test('nicht neu (Konto älter als 14 Tage) und schon von jemand anderem eingeladen: nur Freundschaft', async () => {
    await withInvites({}, async ({ player, live, invite, accept, overview, sql }) => {
      const [anna, ben, carla, dora] = [await player('Anna'), await player('Ben'), await player('Carla'), await player('Dora')];
      sql('UPDATE users SET created_at = ? WHERE uuid = ?', Date.now() - 15 * 24 * 60 * 60 * 1000, carla.uuid);
      const annaWs = await live(anna);
      const { code } = await invite(anna);
      const old = await accept(carla, code);
      assert.deepEqual([old.body.friend, old.body.reward, old.body.rewardReason], ['new', null, 'not-new']);
      // Eine neue Freundschaft meldet der Dienst dem Einladenden trotzdem.
      assert.deepEqual(await annaWs.next('invite'), { type: 'invite', event: 'accepted', name: 'Carla' });
      assert.deepEqual([(await overview(anna)).invited, (await overview(carla)).unlocked], [0, []]);

      // Ben kommt über Anna, danach lädt ihn Dora ein: keine zweite Belohnung, zählt nicht für Dora
      assert.equal((await accept(ben, code)).body.reward, 'freundesfunken');
      const second = await accept(ben, (await invite(dora)).code);
      assert.deepEqual([second.body.friend, second.body.reward, second.body.rewardReason], ['new', null, 'already-invited']);
      assert.equal((await overview(dora)).invited, 0);
      assert.equal((await overview(anna)).invited, 1);
    });
  });

  test('blockiert (in beide Richtungen): keine Freundschaft, der Einladende erfährt nichts und bekommt nichts gutgeschrieben', async () => {
    await withInvites({}, async ({ service, player, live, invite, accept, overview }) => {
      const [anna, ben, carla] = [await player('Anna'), await player('Ben'), await player('Carla')];
      assert.equal((await api(service.url, 'POST', '/v1/blocks', { token: anna.token, body: { uuid: ben.uuid } })).status, 200);
      assert.equal((await api(service.url, 'POST', '/v1/blocks', { token: carla.token, body: { uuid: anna.uuid } })).status, 200);
      const annaWs = await live(anna);
      const { code } = await invite(anna);
      for (const who of [ben, carla]) {
        const res = await accept(who, code);
        assert.equal(res.status, 200);
        assert.deepEqual([res.body.friend, res.body.reward, res.body.rewardReason], ['blocked', 'freundesfunken', null]);
        assert.deepEqual(await friendsOf(service, who), []);
      }
      await annaWs.sync();
      assert.deepEqual(annaWs.drain().filter((m) => m.type === 'invite'), []);
      const view = await overview(anna);
      assert.deepEqual([view.invited, view.invites[0].accepted], [0, 0]);
      // Ben zählt danach als eingeladen (für niemanden)
      const dora = await player('Dora');
      assert.equal((await accept(ben, (await invite(dora)).code)).body.rewardReason, 'already-invited');
      assert.equal((await exported(service, ben)).invites.invitedBy.uuid, null);
    });
  });

  test('Freundesgrenze: friend limit, Belohnung und Gutschrift trotzdem', async () => {
    await withInvites({ maxFriends: 1 }, async ({ service, player, invite, accept, overview }) => {
      const [anna, ben, carla] = [await player('Anna'), await player('Ben'), await player('Carla')];
      await befriend(service.url, anna, carla);
      const res = await accept(ben, (await invite(anna)).code);
      assert.deepEqual([res.body.friend, res.body.reward], ['limit', 'freundesfunken']);
      assert.deepEqual(await friendsOf(service, ben), []);
      assert.equal((await overview(anna)).invited, 1);
    });
  });
});

describe('Einladungen: Bestätigung nach Spielzeit und Belohnungen', () => {
  test('zählt nur im Spiel (Status gemeldet), nur die Summe über mehrere Verbindungen; Stufe 1 und 3', async () => {
    await withInvites({ inviteConfirmMs: 400 }, async ({ service, player, live, invite, accept, overview, sql }) => {
      const anna = await player('Anna');
      const annaWs = await live(anna);
      const { code } = await invite(anna);
      const ben = await player('Ben');
      assert.equal((await accept(ben, code)).body.friend, 'new');
      await annaWs.next('invite');

      // Verbunden, aber ohne Status (noch nicht im Spiel): zählt nicht
      let benWs = await live(ben);
      await sleep(450);
      await benWs.close();
      await sleep(30);
      assert.equal((await exported(service, ben)).invites.invitedBy.playedMs, 0);

      // 250 ms im Spiel, dann zu: gespeichert wird die Summe
      benWs = await live(ben);
      benWs.send({ type: 'status', state: 'menu', server: null });
      await benWs.sync();
      await sleep(250);
      await benWs.close();
      await waitFor(async () => (await exported(service, ben)).invites.invitedBy.playedMs >= 200);
      assert.equal((await overview(anna)).confirmed, 0);

      // Wieder im Spiel: nach dem Rest bestätigt, Belohnung für Anna
      benWs = await live(ben);
      benWs.send({ type: 'status', state: 'singleplayer', server: null });
      assert.deepEqual(await annaWs.next('invite', 2000), { type: 'invite', event: 'confirmed', name: 'Ben' });
      assert.deepEqual(await annaWs.next('unlock'), { type: 'unlock', cosmetic: 'freundesfunken', reason: 'invite' });
      let view = await overview(anna);
      assert.deepEqual([view.invited, view.confirmed, view.pending], [1, 1, 0]);
      assert.deepEqual(view.unlocked, ['freundesfunken']);
      assert.deepEqual(view.rewards.map((r: { unlocked: boolean }) => r.unlocked), [true, false]);
      const benExport = (await exported(service, ben)).invites.invitedBy;
      assert.ok(benExport.confirmed > 0);
      const played = benExport.playedMs;
      // Danach zählt der Dienst nicht mehr
      await sleep(100);
      assert.equal((await exported(service, ben)).invites.invitedBy.playedMs, played);

      // Zwei weitere: Stufe 3 (freundesband); die zweite Bestätigung bringt nichts Neues
      const carla = await player('Carla');
      const dora = await player('Dora');
      for (const who of [carla, dora]) assert.equal((await accept(who, code)).body.reward, 'freundesfunken');
      const carlaWs = await live(carla);
      carlaWs.send({ type: 'status', state: 'multiplayer', server: 'play.example.net' });
      assert.deepEqual(await annaWs.next((m) => m.type === 'invite' && m.event === 'confirmed', 2000), { type: 'invite', event: 'confirmed', name: 'Carla' });
      await annaWs.sync();
      assert.deepEqual(annaWs.drain().filter((m) => m.type === 'unlock'), []);
      // Dora hat schon fast genug gespielt (gespeicherte Summe): Der Rest reicht.
      sql('UPDATE referrals SET played_ms = 390 WHERE invitee = ?', dora.uuid);
      const doraWs = await live(dora);
      doraWs.send({ type: 'status', state: 'menu', server: null });
      assert.deepEqual(await annaWs.next((m) => m.type === 'invite' && m.event === 'confirmed', 2000), { type: 'invite', event: 'confirmed', name: 'Dora' });
      assert.deepEqual(await annaWs.next('unlock'), { type: 'unlock', cosmetic: 'freundesband', reason: 'invite' });
      view = await overview(anna);
      assert.deepEqual([view.invited, view.confirmed, view.pending], [3, 3, 0]);
      assert.deepEqual(view.unlocked, ['freundesfunken', 'freundesband']);
      assert.deepEqual((await api(service.url, 'GET', '/v1/me/cosmetics', { token: anna.token })).body.unlocked, ['freundesfunken', 'freundesband']);
    });
  });

  test('schon im Spiel beim Annehmen: Die Zeit zählt ab dem Annehmen; Herunterfahren speichert die Summe', async () => {
    await withInvites({ inviteConfirmMs: 300 }, async ({ service, player, live, invite, accept, overview }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const benWs = await live(ben);
      benWs.send({ type: 'status', state: 'menu', server: null });
      await benWs.sync();
      await sleep(350);
      const { code } = await invite(anna);
      assert.equal((await accept(ben, code)).body.friend, 'new');
      assert.equal((await overview(anna)).confirmed, 0, 'Zeit vor dem Annehmen zählt nicht');
      await waitFor(async () => (await overview(anna)).confirmed === 1, 2000);
      assert.ok((await exported(service, ben)).invites.invitedBy.playedMs >= 300);
    });
  });
});

describe('Einladungen: Datenauskunft und Konto löschen', () => {
  test('Export: eigene Links (mit Prüfwert der Gruppe), wie man eingeladen wurde, wer dazukam (nur Zeitpunkte), Freischaltungen', async () => {
    await withInvites({}, async ({ service, player, invite, accept }) => {
      const [anna, ben] = [await player('Anna'), await player('Ben')];
      const voice = await invite(anna, { server: 'play.example.net', voice: { group: GROUP } });
      assert.equal((await accept(ben, voice.code)).status, 200);
      const annaData = (await exported(service, anna)).invites;
      assert.deepEqual(annaData.links, [
        { code: voice.code, createdAt: voice.created, expiresAt: voice.expires, server: 'play.example.net', voiceGroup: GROUP, accepted: 1 },
      ]);
      assert.equal(annaData.invitedBy, null);
      assert.equal(annaData.invited.length, 1);
      assert.deepEqual(Object.keys(annaData.invited[0]).sort(), ['at', 'confirmed']);
      assert.equal(annaData.invited[0].confirmed, null);
      assert.equal(JSON.stringify(annaData).includes(ben.uuid), false, 'nicht, wer dazukam');
      assert.deepEqual(annaData.unlocks, []);
      const benData = (await exported(service, ben)).invites;
      assert.deepEqual(benData.links, []);
      assert.deepEqual(
        [benData.invitedBy.uuid, benData.invitedBy.name, benData.invitedBy.code, benData.invitedBy.playedMs, benData.invitedBy.confirmed],
        [anna.uuid, 'Anna', voice.code, 0, null],
      );
      assert.deepEqual(benData.unlocks.map((u: { cosmetic: string; reason: string }) => [u.cosmetic, u.reason]), [['freundesfunken', 'invite']]);
    });
  });

  test('Konto löschen: Einladungen weg, Eingeladene zählen für niemanden, eigene Freischaltungen und Herkunft weg', async () => {
    await withInvites({}, async ({ service, player, invite, accept, overview }) => {
      const [anna, ben, carla] = [await player('Anna'), await player('Ben'), await player('Carla')];
      const { code } = await invite(anna);
      assert.equal((await accept(ben, code)).status, 200);
      assert.equal((await accept(carla, (await invite(ben)).code)).status, 200);

      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: anna.token })).status, 200);
      assert.equal((await api(service.url, 'GET', `/v1/public/invites/${code}`)).status, 404);
      const benData = (await exported(service, ben)).invites;
      assert.deepEqual([benData.invitedBy.uuid, benData.invitedBy.name, benData.invitedBy.code], [null, null, null]);
      assert.deepEqual(benData.unlocks.map((u: { cosmetic: string }) => u.cosmetic), ['freundesfunken'], 'Bens Belohnung bleibt');
      // Ben bleibt „schon eingeladen“
      const dora = await player('Dora');
      assert.equal((await accept(ben, (await invite(dora)).code)).body.rewardReason, 'already-invited');

      // Ben löscht sein Konto: Carla zählt für niemanden mehr, Bens Daten sind weg
      assert.equal((await overview(ben)).invited, 1);
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: ben.token })).status, 200);
      assert.equal((await exported(service, carla)).invites.invitedBy.uuid, null);
      const db = new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));
      try {
        for (const [table, column] of [
          ['invites', 'inviter'],
          ['referrals', 'invitee'],
          ['referrals', 'inviter'],
          ['unlocks', 'uuid'],
        ] as const) {
          for (const uuid of [anna.uuid, ben.uuid]) {
            assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`).get(uuid)!.n, 0, `${table}.${column}`);
          }
        }
        assert.equal(db.prepare('SELECT count(*) AS n FROM referrals WHERE code IS NOT NULL AND inviter IS NULL').get()!.n, 0);
      } finally {
        db.close();
      }
    });
  });

  test('Sperre: wie Löschen (Einladungen weg)', async () => {
    await withInvites({}, async ({ service, player, invite }) => {
      const anna = await player('Anna');
      const { code } = await invite(anna);
      const res = await api(service.url, 'GET', `/v1/public/invites/${code}`);
      assert.equal(res.status, 200);
      // Wie heldix-dienst-admin: direkt in der Datenbank
      const store = new Store(service.dataDir);
      try {
        store.ban(anna.uuid, 'Anna', 'Test', Date.now());
      } finally {
        store.close();
      }
      assert.equal((await api(service.url, 'GET', `/v1/public/invites/${code}`)).status, 404);
    });
  });
});
