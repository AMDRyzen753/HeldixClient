// Cosmetics mit `access: "unlock"` (ab 1.11.0): im Katalog für alle sichtbar, wählen und tragen nur mit Freischaltung
// (403 LOCKED), `unlocked` in MyCosmetics, Nachschlagen gebündelt, Freischaltung über eine Einladung.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { manifestOf, signCosmetic } from './cosmetic-fixtures';
import { api, connect, devPlayer, startService, type Player, type TestService, type WsClient } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

const LOCKED = 'Dieses Cosmetic schaltest du frei, indem du Freunde zu HeldixClient einlädst.';
const NONE = { head: null, back: null, aura: null, companion: null };

describe('Cosmetics zum Freischalten (access: unlock)', () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  let service: TestService;
  let cookie: string;
  let anna: Player;
  let ben: Player;
  let carla: Player;
  const clients: WsClient[] = [];

  const mine = async (player: Player) => (await api(service.url, 'GET', '/v1/me/cosmetics', { token: player.token })).body;
  const choose = (player: Player, slot: string, id: unknown) => api(service.url, 'PUT', '/v1/me/cosmetics', { token: player.token, body: { slot, id } });
  const lookup = async (who: Player[]) =>
    (await api(service.url, 'POST', '/v1/players/lookup', { token: carla.token, body: { uuids: who.map((p) => p.uuid) } })).body.players;
  const sql = (statement: string, ...params: string[]) => {
    const db = new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.prepare(statement).run(...params);
    } finally {
      db.close();
    }
  };

  before(async () => {
    service = await startService({
      dev: true,
      website: WEBSITE,
      totpNow: clock.read,
      updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    const chefin = await devPlayer(service.url, 'Chefin');
    cookie = (await teamLogin(service, chefin, 'admin', clock)).cookie;
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    carla = await devPlayer(service.url, 'Carla');
    for (const manifest of [
      manifestOf('aura', { id: 'freundesfunken', name: 'Freundesfunken', access: 'unlock' }),
      manifestOf('cape', { id: 'freundesband', name: 'Freundesband', access: 'unlock' }),
    ]) {
      const res = await webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, body: signCosmetic(keys.privateKey, manifest) });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  });
  after(async () => {
    for (const client of clients) await client.close();
    await service.close();
  });

  test('im Katalog mit access unlock; gesperrt: 403 LOCKED beim Wählen (Slot und Cape über PUT /v1/me)', async () => {
    const list = (await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics;
    assert.deepEqual(
      list.map((c: { id: string; access: string }) => [c.id, c.access]),
      [
        ['freundesfunken', 'unlock'],
        ['freundesband', 'unlock'],
      ],
    );
    assert.deepEqual(await mine(anna), { ...NONE, cape: null, team: false, unlocked: [] });
    for (const attempt of [choose(anna, 'aura', 'freundesfunken'), choose(anna, 'cape', 'freundesband'), api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { cape: 'freundesband' } })]) {
      const res = await attempt;
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: LOCKED, code: 'LOCKED' });
    }
    assert.deepEqual(await mine(anna), { ...NONE, cape: null, team: false, unlocked: [] });
    // Team-Mitglieder bekommen es auch nicht geschenkt
    const team = await webApi(service, 'PUT', '/v1/me/cosmetics', { cookie, body: { slot: 'aura', id: 'freundesfunken' } });
    assert.equal(team.status, 403);
    assert.equal(team.body.code, 'LOCKED');
  });

  test('freigeschaltet über eine Einladung: wählen, Antwort mit unlocked, Nachschlagen zeigt es; ohne Freischaltung bleibt es verborgen', async () => {
    const invite = (await api(service.url, 'POST', '/v1/invites', { token: anna.token, body: {} })).body;
    const res = await api(service.url, 'POST', `/v1/invites/${invite.code}/accept`, { token: ben.token });
    assert.equal(res.body.reward, 'freundesfunken');
    const chosen = await choose(ben, 'aura', 'freundesfunken');
    assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
    assert.deepEqual(chosen.body, { ...NONE, aura: 'freundesfunken', cape: null, team: false, unlocked: ['freundesfunken'] });
    assert.equal((await choose(ben, 'cape', 'freundesband')).status, 403, 'das Cape erst ab 3 bestätigten Freunden');

    // Anna trägt es „gespeichert“, ohne Freischaltung (z. B. direkt in der Datenbank): niemand sieht es
    sql("UPDATE users SET cosmetic_aura = 'freundesfunken', cape = 'freundesband' WHERE uuid = ?", anna.uuid);
    for (const player of [anna, ben, carla]) clients.push((await connect(service.wsUrl, player.token)).client);
    const players = await lookup([anna, ben]);
    assert.deepEqual(players[ben.uuid], { cape: '', badge: null, cosmetics: { ...NONE, aura: 'freundesfunken' } });
    assert.deepEqual(players[anna.uuid], { cape: '', badge: null, cosmetics: NONE });
    assert.deepEqual(await mine(anna), { ...NONE, cape: null, team: false, unlocked: [] });
    assert.equal((await api(service.url, 'GET', '/v1/me', { token: anna.token })).body.cape, '');

    // Freigeschaltet (hier direkt): ab der nächsten Abfrage sichtbar, die gespeicherte Wahl gilt
    sql("INSERT INTO unlocks (uuid, cosmetic, reason, at) VALUES (?, 'freundesband', 'invite', 1)", anna.uuid);
    assert.deepEqual((await lookup([anna]))[anna.uuid], { cape: 'freundesband', badge: null, cosmetics: NONE });
    assert.equal((await api(service.url, 'GET', '/v1/me', { token: anna.token })).body.cape, 'freundesband');
    assert.deepEqual((await mine(anna)).unlocked, ['freundesband']);
    const viaMe = await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { cape: 'freundesband' } });
    assert.equal(viaMe.status, 200);
  });

  test('Freischaltung ohne Cosmetic im Katalog bleibt gespeichert und steht in unlocked', async () => {
    sql("INSERT INTO unlocks (uuid, cosmetic, reason, at) VALUES (?, 'kommt-noch', 'invite', 2)", carla.uuid);
    assert.deepEqual((await mine(carla)).unlocked, ['kommt-noch']);
    assert.equal((await choose(carla, 'aura', 'kommt-noch')).status, 404);
  });
});
