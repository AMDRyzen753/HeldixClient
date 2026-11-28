// Heldix+-Warteliste (1.13.0): eintragen und austragen, Zahl erst ab der Schwelle öffentlich, Team-Liste und Freischalten
// (einzeln oder „die ersten N“) mit hosting-granted, Rechte, Datenauskunft und Löschen.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Store } from '../src/db';
import { api, connect, devPlayer } from './helpers';
import { setTeam, startHosting } from './hosting-helpers';
import { teamLogin, webApi } from './web-helpers';

describe('Heldix+-Warteliste', () => {
  test('eintragen (einmal), austragen; Zahl erst ab der Schwelle; öffentliche Zahl', async () => {
    const t = await startHosting({ plusCountMin: 2 });
    try {
      const anna = await devPlayer(t.service.url, 'Anna');
      let res = await api(t.service.url, 'GET', '/v1/plus', { token: anna.token });
      assert.deepEqual(res.body, { waitlist: null, granted: false, grantedAt: null, team: false, unseen: false, count: null });
      res = await api(t.service.url, 'PUT', '/v1/plus/waitlist', { token: anna.token });
      const since = res.body.waitlist.since;
      assert.ok(since > 0);
      assert.equal(res.body.count, null, 'unter der Schwelle');
      res = await api(t.service.url, 'PUT', '/v1/plus/waitlist', { token: anna.token });
      assert.equal(res.body.waitlist.since, since, 'bleibt beim ersten Zeitpunkt');
      const ben = await devPlayer(t.service.url, 'Ben');
      await api(t.service.url, 'PUT', '/v1/plus/waitlist', { token: ben.token });
      assert.equal((await api(t.service.url, 'GET', '/v1/plus', { token: anna.token })).body.count, 2);
      const pub = await api(t.service.url, 'GET', '/v1/public/plus');
      assert.deepEqual([pub.body, pub.headers.get('access-control-allow-origin')], [{ count: 2 }, '*']);
      res = await api(t.service.url, 'DELETE', '/v1/plus/waitlist', { token: anna.token });
      assert.deepEqual([res.body.waitlist, res.body.count], [null, null]);
      assert.equal((await api(t.service.url, 'GET', '/v1/plus')).status, 401);
      // Team-Mitglieder dürfen ohnehin
      setTeam(t.service, anna.uuid, 'designer');
      res = await api(t.service.url, 'GET', '/v1/plus', { token: anna.token });
      assert.deepEqual([res.body.granted, res.body.team], [true, true]);
    } finally {
      await t.close();
    }
  });

  test('Team: Liste (hosting:grant), die ersten N freischalten (ohne schon Freigeschaltete und Team), einzeln per UUID; hosting-granted', async () => {
    const t = await startHosting();
    try {
      const players = [];
      for (const name of ['Erste', 'Zweite', 'Dritte', 'Vierte']) {
        const player = await devPlayer(t.service.url, name);
        await api(t.service.url, 'PUT', '/v1/plus/waitlist', { token: player.token });
        players.push(player);
        await new Promise((resolve) => setTimeout(resolve, 3));
      }
      setTeam(t.service, players[1]!.uuid, 'tester');
      const admin = await teamLogin(t.service, await devPlayer(t.service.url, 'Chefin'), 'admin', t.clock);
      const mod = await teamLogin(t.service, await devPlayer(t.service.url, 'Moderator'), 'moderator', t.clock);
      assert.equal((await webApi(t.service, 'GET', '/v1/team/plus/waitlist', { cookie: mod.cookie })).status, 403);
      assert.equal((await webApi(t.service, 'POST', '/v1/team/plus/grant', { cookie: mod.cookie, body: { first: 1 } })).status, 403);
      let res = await webApi(t.service, 'GET', '/v1/team/plus/waitlist', { cookie: admin.cookie });
      assert.deepEqual(res.body.entries.map((e: { name: string; team: boolean; granted: boolean }) => [e.name, e.team, e.granted]), [
        ['Erste', false, false],
        ['Zweite', true, false],
        ['Dritte', false, false],
        ['Vierte', false, false],
      ]);
      assert.deepEqual([res.body.count, res.body.waiting], [4, 3]);
      assert.ok(res.body.entries[0].memberSince > 0);
      const first = (await connect(t.service.wsUrl, players[0]!.token)).client;
      const third = (await connect(t.service.wsUrl, players[2]!.token)).client;
      res = await webApi(t.service, 'POST', '/v1/team/plus/grant', { cookie: admin.cookie, body: { first: 2 } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.granted.map((g: { name: string }) => g.name), ['Erste', 'Dritte']);
      assert.equal((await first.next('hosting-granted')).text, 'Du bist für die Beta „Dauerhafte Welten“ freigeschaltet. Stell eine deiner Welten dauerhaft online!');
      await third.next('hosting-granted');
      assert.equal(res.body.waiting, 1);
      res = await webApi(t.service, 'POST', '/v1/team/plus/grant', { cookie: admin.cookie, body: { uuids: [players[3]!.uuid, players[0]!.uuid, 'f'.repeat(32)] } });
      assert.deepEqual([res.body.granted.map((g: { name: string }) => g.name), res.body.skipped], [['Vierte'], 2]);
      for (const bad of [{}, { first: 0 }, { first: 201 }, { uuids: [] }, { uuids: ['nein'] }]) {
        assert.equal((await webApi(t.service, 'POST', '/v1/team/plus/grant', { cookie: admin.cookie, body: bad })).status, 400, JSON.stringify(bad));
      }
      // Spieler sieht die Freischaltung
      res = await api(t.service.url, 'GET', '/v1/plus', { token: players[0]!.token });
      assert.deepEqual([res.body.granted, res.body.unseen, res.body.waitlist !== null], [true, true, true]);
      assert.equal((await api(t.service.url, 'GET', '/v1/hosting', { token: players[0]!.token })).body.allowed, true);
      await first.close();
      await third.close();
    } finally {
      await t.close();
    }
  });

  test('Datenauskunft und Löschen: Eintrag geht mit', async () => {
    const t = await startHosting();
    try {
      const anna = await devPlayer(t.service.url, 'Anna');
      await api(t.service.url, 'PUT', '/v1/plus/waitlist', { token: anna.token });
      const data = (await (await fetch(`${t.service.url}/v1/me/export`, { headers: { Authorization: `Bearer ${anna.token}` } })).json()) as any;
      assert.ok(data.plus.waitlist.since > 0);
      await api(t.service.url, 'DELETE', '/v1/me', { token: anna.token });
      const store = new Store(t.service.dataDir);
      try {
        assert.equal(Number((store.prepare('SELECT count(*) AS n FROM plus_waitlist').get() as { n: number }).n), 0);
      } finally {
        store.close();
      }
    } finally {
      await t.close();
    }
  });
});
