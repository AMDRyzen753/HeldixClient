// Freunde: Anfragen per Name, annehmen, ablehnen, entfernen, Grenzen.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { api, devPlayer, randomUuid, startService, type Player, type TestService } from './helpers';

const NOT_FOUND = 'Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).';

describe('Freundschaftsanfragen', () => {
  let service: TestService;
  let anna: Player;
  let ben: Player;
  let carla: Player;

  before(async () => {
    service = await startService({ dev: true });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben_99');
    carla = await devPlayer(service.url, 'Carla');
  });
  after(() => service.close());

  const friendsOf = (p: Player) => api(service.url, 'GET', '/v1/friends', { token: p.token });
  const request = (p: Player, name: string) => api(service.url, 'POST', '/v1/friends/requests', { token: p.token, body: { name } });

  test('am Anfang leer', async () => {
    const res = await friendsOf(anna);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { friends: [], incoming: [], outgoing: [], unread: {} });
  });

  test('unbekannter Name: 404 mit Text für den Spieler', async () => {
    const res = await request(anna, 'GibtEsNicht');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, NOT_FOUND);
  });

  test('an sich selbst: 400, ungültiger Name: 400', async () => {
    assert.equal((await request(anna, 'anna')).status, 400);
    assert.equal((await request(anna, 'kein name!')).status, 400);
    assert.equal((await api(service.url, 'POST', '/v1/friends/requests', { token: anna.token, body: {} })).status, 400);
  });

  test('Anfrage (ohne Groß-/Kleinschreibung) und annehmen', async () => {
    const sent = await request(anna, 'BEN_99');
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.friends.length, 0);
    assert.equal(sent.body.incoming.length, 0);
    assert.equal(sent.body.outgoing.length, 1);
    assert.equal(sent.body.outgoing[0].uuid, ben.uuid);
    assert.equal(sent.body.outgoing[0].name, 'Ben_99');
    assert.equal(typeof sent.body.outgoing[0].at, 'number');

    // Doppelt anfragen ändert nichts.
    const again = await request(anna, 'Ben_99');
    assert.equal(again.status, 200);
    assert.equal(again.body.outgoing.length, 1);

    const forBen = await friendsOf(ben);
    assert.deepEqual(forBen.body.incoming, [{ uuid: anna.uuid, name: 'Anna', at: sent.body.outgoing[0].at }]);
    assert.deepEqual(forBen.body.outgoing, []);

    const accepted = await api(service.url, 'POST', `/v1/friends/requests/${anna.uuid}/accept`, { token: ben.token });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body.incoming, []);
    assert.equal(accepted.body.friends.length, 1);
    const friend = accepted.body.friends[0];
    assert.deepEqual(Object.keys(friend).sort(), ['badge', 'dnd', 'favorite', 'lastOnline', 'name', 'nickname', 'note', 'online', 'server', 'since', 'state', 'statusText', 'uuid']);
    assert.equal(friend.uuid, anna.uuid);
    assert.equal(friend.name, 'Anna');
    assert.equal(friend.online, false);
    assert.equal(friend.state, null);
    assert.equal(friend.server, null);
    assert.equal(typeof friend.since, 'number');

    const forAnna = await friendsOf(anna);
    assert.equal(forAnna.body.friends.length, 1);
    assert.equal(forAnna.body.friends[0].uuid, ben.uuid);
    assert.equal(forAnna.body.friends[0].since, friend.since);
    assert.deepEqual(forAnna.body.outgoing, []);
  });

  test('schon befreundet: 409', async () => {
    const res = await request(ben, 'Anna');
    assert.equal(res.status, 409);
    assert.equal(typeof res.body.error, 'string');
  });

  test('Anfrage in beide Richtungen: sofort Freunde', async () => {
    assert.equal((await request(carla, 'Anna')).status, 200);
    const res = await request(anna, 'Carla');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.friends.map((f: { name: string }) => f.name),
      ['Ben_99', 'Carla'],
    );
    assert.deepEqual(res.body.incoming, []);
    assert.deepEqual(res.body.outgoing, []);
    const forCarla = await friendsOf(carla);
    assert.deepEqual(
      forCarla.body.friends.map((f: { uuid: string }) => f.uuid),
      [anna.uuid],
    );
    assert.deepEqual(forCarla.body.outgoing, []);
  });

  test('ablehnen und zurückziehen', async () => {
    assert.equal((await request(ben, 'Carla')).status, 200);
    // Carla lehnt ab.
    let res = await api(service.url, 'DELETE', `/v1/friends/requests/${ben.uuid}`, { token: carla.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.incoming, []);
    assert.deepEqual((await friendsOf(ben)).body.outgoing, []);

    // Ben fragt erneut und zieht selbst zurück.
    assert.equal((await request(ben, 'Carla')).status, 200);
    res = await api(service.url, 'DELETE', `/v1/friends/requests/${carla.uuid}`, { token: ben.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.outgoing, []);
    assert.deepEqual((await friendsOf(carla)).body.incoming, []);

    // Nichts mehr da: trotzdem 200 mit aktuellem Stand.
    res = await api(service.url, 'DELETE', `/v1/friends/requests/${carla.uuid}`, { token: ben.token });
    assert.equal(res.status, 200);
  });

  test('annehmen ohne Anfrage: 404, ungültige UUID: 400', async () => {
    assert.equal((await api(service.url, 'POST', `/v1/friends/requests/${carla.uuid}/accept`, { token: ben.token })).status, 404);
    assert.equal((await api(service.url, 'POST', `/v1/friends/requests/${randomUuid()}/accept`, { token: ben.token })).status, 404);
    assert.equal((await api(service.url, 'POST', '/v1/friends/requests/NICHT-HEX/accept', { token: ben.token })).status, 400);
    assert.equal((await api(service.url, 'DELETE', '/v1/friends/requests/123', { token: ben.token })).status, 400);
    assert.equal((await api(service.url, 'DELETE', `/v1/friends/${carla.uuid.toUpperCase()}`, { token: ben.token })).status, 400);
  });

  test('Freund entfernen (beide Seiten)', async () => {
    const res = await api(service.url, 'DELETE', `/v1/friends/${ben.uuid}`, { token: anna.token });
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.friends.map((f: { name: string }) => f.name),
      ['Carla'],
    );
    assert.deepEqual((await friendsOf(ben)).body.friends, []);
    // Danach geht eine neue Anfrage wieder.
    assert.equal((await request(ben, 'Anna')).status, 200);
  });

  test('Name, den inzwischen ein anderer Spieler hat: der zuletzt angemeldete zählt', async () => {
    const old = await devPlayer(service.url, 'Wechsel');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const current = await devPlayer(service.url, 'wechsel');
    const res = await request(anna, 'Wechsel');
    assert.equal(res.status, 200);
    const target = res.body.outgoing.find((r: { name: string }) => r.name.toLowerCase() === 'wechsel');
    assert.equal(target.uuid, current.uuid);
    assert.notEqual(target.uuid, old.uuid);
  });
});

describe('Grenzen', () => {
  test('höchstens 50 offene ausgehende Anfragen, sonst 409', async () => {
    const service = await startService({ dev: true });
    try {
      const sender = await devPlayer(service.url, 'Sammler');
      const others: Player[] = [];
      for (let i = 0; i < 51; i++) others.push(await devPlayer(service.url, `Ziel${i}`));
      for (let i = 0; i < 50; i++) {
        const res = await api(service.url, 'POST', '/v1/friends/requests', { token: sender.token, body: { name: `Ziel${i}` } });
        assert.equal(res.status, 200, `Anfrage ${i + 1}`);
      }
      const res = await api(service.url, 'POST', '/v1/friends/requests', { token: sender.token, body: { name: 'Ziel50' } });
      assert.equal(res.status, 409);
      assert.equal(typeof res.body.error, 'string');
      // Eine Anfrage in die Gegenrichtung annehmen geht trotzdem.
      const back = await api(service.url, 'POST', '/v1/friends/requests', { token: others[50]!.token, body: { name: 'Sammler' } });
      assert.equal(back.status, 200);
      const accept = await api(service.url, 'POST', `/v1/friends/requests/${others[50]!.uuid}/accept`, { token: sender.token });
      assert.equal(accept.status, 200);
      assert.equal(accept.body.friends.length, 1);
    } finally {
      await service.close();
    }
  });

  test('höchstens N Freunde (hier 2), sonst 409 – auch beim Annehmen', async () => {
    const service = await startService({ dev: true, maxFriends: 2 });
    try {
      const [voll, a, b, c, d] = [
        await devPlayer(service.url, 'Voll'),
        await devPlayer(service.url, 'A1'),
        await devPlayer(service.url, 'B1'),
        await devPlayer(service.url, 'C1'),
        await devPlayer(service.url, 'D1'),
      ];
      const send = (from: Player, name: string) => api(service.url, 'POST', '/v1/friends/requests', { token: from.token, body: { name } });
      const accept = (by: Player, from: Player) => api(service.url, 'POST', `/v1/friends/requests/${from.uuid}/accept`, { token: by.token });
      assert.equal((await send(a, 'Voll')).status, 200);
      assert.equal((await send(b, 'Voll')).status, 200);
      assert.equal((await send(c, 'Voll')).status, 200);
      assert.equal((await accept(voll, a)).status, 200);
      assert.equal((await accept(voll, b)).status, 200);
      // Voll hat 2 Freunde: weder annehmen noch selbst anfragen.
      assert.equal((await accept(voll, c)).status, 409);
      assert.equal((await send(voll, 'D1')).status, 409);
      // Wer einem vollen Spieler eine Anfrage schickt, darf das; annehmen scheitert dann bei ihm.
      assert.equal((await send(d, 'Voll')).status, 200);
      assert.equal((await send(voll, 'D1')).status, 409);
    } finally {
      await service.close();
    }
  });
});
