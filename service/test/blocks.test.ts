// Blockieren: Liste, Folgen für Freundschaft, Anfragen und Nachrichten, verborgene 404, Grenzen und Konto löschen.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { api, befriend, connect, devPlayer, randomUuid, sleep, startService, type Player, type TestService } from './helpers';

const NOT_FOUND = 'Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).';

const blockBy = (service: TestService, me: Player, body: unknown) => api(service.url, 'POST', '/v1/blocks', { token: me.token, body });
const request = (service: TestService, me: Player, name: string) =>
  api(service.url, 'POST', '/v1/friends/requests', { token: me.token, body: { name } });

describe('Blockieren', () => {
  test('per Name oder UUID; Freundschaft, Unterhaltung und Anfragen sind weg; beide Seiten sehen es sofort', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben, carla, dora] = [
        await devPlayer(service.url, 'Anna'),
        await devPlayer(service.url, 'Ben'),
        await devPlayer(service.url, 'Carla'),
        await devPlayer(service.url, 'Dora'),
      ];
      await befriend(service.url, anna, ben);
      await api(service.url, 'POST', `/v1/messages/${ben.uuid}`, { token: anna.token, body: { text: 'Hallo' } });
      await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: ben.token, body: { text: 'Lass mich' } });
      // Offene Anfragen in beide Richtungen
      await request(service, carla, 'Anna');
      await request(service, anna, 'Dora');

      const empty = await api(service.url, 'GET', '/v1/blocks', { token: anna.token });
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.body, { blocked: [] });

      const annaWs = (await connect(service.wsUrl, anna.token)).client;
      const benWs = (await connect(service.wsUrl, ben.token)).client;
      try {
        for (const client of [annaWs, benWs]) {
          await client.sync();
          client.drain();
        }
        const blocked = await blockBy(service, anna, { name: 'BEN' });
        assert.equal(blocked.status, 200, JSON.stringify(blocked.body));
        assert.equal(blocked.body.blocked.length, 1);
        assert.deepEqual(Object.keys(blocked.body.blocked[0]).sort(), ['at', 'name', 'uuid']);
        assert.equal(blocked.body.blocked[0].uuid, ben.uuid);
        assert.equal(blocked.body.blocked[0].name, 'Ben');

        // Beide bekommen eine neue Freundesliste ohne den anderen.
        await benWs.sync();
        assert.deepEqual(
          benWs.drain().map((m) => [m.type, m.friends.length]),
          [['friends', 0]],
        );
        await annaWs.sync();
        assert.deepEqual(
          annaWs.drain().map((m) => [m.type, m.friends.length]),
          [['friends', 0]],
        );
      } finally {
        await annaWs.close();
        await benWs.close();
      }
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.friends, []);
      assert.deepEqual((await api(service.url, 'GET', '/v1/messages', { token: anna.token })).body, { conversations: [] });
      assert.deepEqual((await api(service.url, 'GET', '/v1/messages', { token: ben.token })).body, { conversations: [] });
      // Nachrichten gehen nicht mehr (keine Freunde mehr).
      assert.equal((await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: ben.token, body: { text: 'Hallo?' } })).status, 403);

      // Anfragen in beide Richtungen werden beim Blockieren entfernt.
      await sleep(5);
      assert.equal((await blockBy(service, anna, { uuid: carla.uuid })).status, 200);
      await sleep(5);
      const list = await blockBy(service, anna, { name: 'Dora' });
      assert.deepEqual(
        list.body.blocked.map((b: { name: string }) => b.name),
        ['Dora', 'Carla', 'Ben'],
        'neueste zuerst',
      );
      const annaFriends = (await api(service.url, 'GET', '/v1/friends', { token: anna.token })).body;
      assert.deepEqual([annaFriends.incoming, annaFriends.outgoing], [[], []]);
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: carla.token })).body.outgoing, []);
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: dora.token })).body.incoming, []);

      // Noch einmal blockieren ändert nichts (auch nicht den Zeitpunkt).
      const again = await blockBy(service, anna, { uuid: ben.uuid });
      assert.deepEqual(again.body, list.body);

      // Freigeben: wieder weg aus der Liste; Freundschaft und Nachrichten kommen nicht zurück.
      const unblocked = await api(service.url, 'DELETE', `/v1/blocks/${ben.uuid}`, { token: anna.token });
      assert.equal(unblocked.status, 200);
      assert.deepEqual(
        unblocked.body.blocked.map((b: { name: string }) => b.name),
        ['Dora', 'Carla'],
      );
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: anna.token })).body.friends, []);
      // Nicht blockiert: trotzdem 200 mit aktuellem Stand. Ungültige UUID: 400.
      assert.equal((await api(service.url, 'DELETE', `/v1/blocks/${ben.uuid}`, { token: anna.token })).status, 200);
      assert.equal((await api(service.url, 'DELETE', '/v1/blocks/xyz', { token: anna.token })).status, 400);
      assert.deepEqual((await api(service.url, 'GET', '/v1/blocks', { token: anna.token })).body, unblocked.body);
    } finally {
      await service.close();
    }
  });

  test('Blockierte sehen nichts davon: Anfrage ergibt dieselbe 404 wie ein unbekannter Name', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben')];
      assert.equal((await blockBy(service, anna, { name: 'Ben' })).status, 200);

      const unknown = await request(service, ben, 'GibtEsNicht');
      const hidden = await request(service, ben, 'Anna');
      assert.equal(unknown.status, 404);
      assert.equal(hidden.status, 404);
      assert.deepEqual(hidden.body, unknown.body);
      assert.equal(hidden.body.error, NOT_FOUND);
      assert.equal(hidden.headers.get('content-length'), unknown.headers.get('content-length'));
      // Auch keine Anfrage ist bei Anna angekommen.
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: anna.token })).body.incoming, []);

      // Wer selbst blockiert hat, bekommt einen Hinweis.
      const own = await request(service, anna, 'ben');
      assert.equal(own.status, 409);
      assert.equal(own.body.error, 'Du hast diesen Spieler blockiert. Gib ihn zuerst frei.');

      // Nach dem Freigeben geht es wieder.
      await api(service.url, 'DELETE', `/v1/blocks/${ben.uuid}`, { token: anna.token });
      assert.equal((await request(service, ben, 'Anna')).status, 200);
    } finally {
      await service.close();
    }
  });

  test('Fehler: sich selbst, unbekannt, ungültig, Grenze (hier 2)', async () => {
    const service = await startService({ dev: true, maxBlocks: 2 });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      await devPlayer(service.url, 'Carla');
      await devPlayer(service.url, 'Dora');
      assert.equal((await blockBy(service, anna, { name: 'anna' })).status, 400);
      assert.equal((await blockBy(service, anna, { uuid: anna.uuid })).status, 400);
      const unknownName = await blockBy(service, anna, { name: 'Niemand' });
      assert.equal(unknownName.status, 404);
      assert.equal(unknownName.body.error, NOT_FOUND);
      assert.equal((await blockBy(service, anna, { uuid: randomUuid() })).status, 404);
      for (const body of [{}, { uuid: 'ABC' }, { uuid: 42 }, { name: 'kein name' }, { name: '' }, { uuid: null }]) {
        assert.equal((await blockBy(service, anna, body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await blockBy(service, anna, { uuid: ben.uuid })).status, 200);
      assert.equal((await blockBy(service, anna, { name: 'Carla' })).status, 200);
      const full = await blockBy(service, anna, { name: 'Dora' });
      assert.equal(full.status, 409);
      assert.equal(full.body.error, 'Du hast schon 2 Spieler blockiert. Gib zuerst welche frei.');
      // Schon Blockierte noch einmal: kein Fehler, auch an der Grenze.
      assert.equal((await blockBy(service, anna, { name: 'Ben' })).status, 200);
      // Ohne Anmeldung: 401.
      assert.equal((await api(service.url, 'GET', '/v1/blocks')).status, 401);
      assert.equal((await api(service.url, 'POST', '/v1/blocks', { body: { name: 'Ben' } })).status, 401);
    } finally {
      await service.close();
    }
  });

  test('Konto löschen entfernt Blockierungen in beide Richtungen', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben, carla] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben'), await devPlayer(service.url, 'Carla')];
      await blockBy(service, anna, { name: 'Ben' });
      await blockBy(service, ben, { name: 'Carla' });
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: ben.token })).status, 200);
      assert.deepEqual((await api(service.url, 'GET', '/v1/blocks', { token: anna.token })).body, { blocked: [] });

      // Ben meldet sich neu an: Er hat keine Blockierungen, und Anna findet ihn per Name wieder.
      const fresh = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Ben', uuid: ben.uuid } });
      assert.deepEqual((await api(service.url, 'GET', '/v1/blocks', { token: fresh.body.token })).body, { blocked: [] });
      assert.equal((await request(service, carla, 'Ben')).status, 200);
      assert.equal((await request(service, anna, 'Ben')).status, 200);
    } finally {
      await service.close();
    }
  });
});
