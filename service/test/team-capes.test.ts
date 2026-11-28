// Eingebaute Capes ab 1.10.0: `matrix` für alle, `matrix_rot`, `matrix_tuerkis` und `sakura_orange` nur fürs Team – genau
// wie Katalog-Cosmetics mit `access: team`: wählen (PUT /v1/me und PUT /v1/me/cosmetics) nur im Team, sonst 403 und
// keine Änderung; ausgeliefert (Me, MyCosmetics, Nachschlagen) nur, solange der Träger im Team ist, die Auswahl bleibt
// gespeichert. Die Sperre gilt auch mit eigener Liste (HELDIX_DIENST_CAPES); die IDs sind für den Katalog gesperrt.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Store } from '../src/db';
import { BUILTIN_CAPE_IDS } from '../src/cosmetics-format';
import { DEFAULT_CAPES, parseCapeList, TEAM_CAPES } from '../src/validate';
import { manifestOf, signCosmetic } from './cosmetic-fixtures';
import { api, connect, devPlayer, rawRequest, startService, type Player, type TestService, type WsClient } from './helpers';
import { addToTeam, Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

const TEAM_ONLY = 'Dieses Cosmetic gibt es nur für das HeldixClient-Team.';
const TEAM_CAPE_IDS = ['matrix_rot', 'matrix_tuerkis', 'sakura_orange'];

/** Nimmt einen Spieler direkt in der Datenbank aus dem Team (Gegenstück zu addToTeam). */
function removeFromTeam(service: TestService, player: Player): void {
  const store = new Store(service.dataDir);
  try {
    assert.equal(store.removeTeamMember(player.uuid), true);
  } finally {
    store.close();
  }
}

test('Liste: vier neue eingebaute Capes nach den bisherigen neun, drei davon nur fürs Team', () => {
  assert.deepEqual(DEFAULT_CAPES.slice(0, 9), ['heldix', 'mitternacht', 'aurora', 'glut', 'kristall', 'neon', 'sakura', 'gewitter', 'galaxie']);
  assert.deepEqual(DEFAULT_CAPES.slice(9), ['matrix', ...TEAM_CAPE_IDS]);
  assert.deepEqual([...BUILTIN_CAPE_IDS], [...DEFAULT_CAPES]);
  assert.deepEqual([...TEAM_CAPES], TEAM_CAPE_IDS);
  assert.equal(TEAM_CAPES.has('matrix'), false);
});

describe('Eingebaute Team-Capes', () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  let service: TestService;
  let cookie: string;
  let viewer: Player;
  const clients: WsClient[] = [];

  const me = async (player: Player) => (await api(service.url, 'GET', '/v1/me', { token: player.token })).body;
  const mine = async (player: Player) => (await api(service.url, 'GET', '/v1/me/cosmetics', { token: player.token })).body;
  const setCape = (player: Player, cape: unknown, extra: Record<string, unknown> = {}) =>
    api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape, ...extra } });
  const choose = (player: Player, id: unknown) => api(service.url, 'PUT', '/v1/me/cosmetics', { token: player.token, body: { slot: 'cape', id } });
  /** Capes, wie andere sie beim Nachschlagen sehen (eine Abfrage für alle). */
  const lookupCapes = async (...players: Player[]) => {
    const res = await api(service.url, 'POST', '/v1/players/lookup', { token: viewer.token, body: { uuids: players.map((p) => p.uuid) } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return players.map((p) => res.body.players[p.uuid]?.cape);
  };
  const storedCape = async (player: Player) =>
    JSON.parse((await rawRequest(service.url, 'GET', '/v1/me/export', { Authorization: `Bearer ${player.token}` })).body.toString('utf8')).cosmetics.cape;
  const online = async (player: Player) => {
    clients.push((await connect(service.wsUrl, player.token)).client);
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
    viewer = await devPlayer(service.url, 'Zuschauer');
  });
  after(async () => {
    for (const client of clients) await client.close();
    await service.close();
  });

  test('matrix: für alle wählbar (über beide Wege) und für andere sichtbar', async () => {
    const player = await devPlayer(service.url, 'Gruen');
    await online(player);
    let res = await setCape(player, 'matrix');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.cape, 'matrix');
    res = await choose(player, null);
    assert.equal(res.status, 200);
    assert.equal(res.body.cape, null);
    res = await choose(player, 'matrix');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.cape, 'matrix');
    assert.equal(res.body.team, false);
    assert.equal((await me(player)).cape, 'matrix');
    assert.deepEqual(await lookupCapes(player), ['matrix']);
  });

  test('ohne Team: Team-Capes 403 über PUT /v1/me und PUT /v1/me/cosmetics, nichts ändert sich', async () => {
    const player = await devPlayer(service.url, 'Ohne');
    await online(player);
    assert.equal((await setCape(player, 'neon')).status, 200);
    for (const cape of TEAM_CAPE_IDS) {
      let res = await setCape(player, cape, { visible: false, messages: false });
      assert.equal(res.status, 403, cape);
      assert.equal(res.body.error, TEAM_ONLY);
      res = await choose(player, cape);
      assert.equal(res.status, 403, cape);
      assert.equal(res.body.error, TEAM_ONLY);
    }
    // Auch die anderen Felder der abgelehnten Anfrage bleiben, wie sie waren.
    const profile = await me(player);
    assert.equal(profile.cape, 'neon');
    assert.equal(profile.visible, true);
    assert.equal(profile.messages, true);
    const choice = await mine(player);
    assert.deepEqual([choice.cape, choice.team], ['neon', false]);
    assert.equal(await storedCape(player), 'neon');
    assert.deepEqual(await lookupCapes(player), ['neon']);
  });

  test('im Team: wählbar und für andere sichtbar; nach dem Austritt nicht ausgeliefert, Auswahl bleibt; wieder im Team: wieder da', async () => {
    const member = await devPlayer(service.url, 'Mitglied');
    const other = await devPlayer(service.url, 'Kollege');
    const plain = await devPlayer(service.url, 'Normal');
    for (const player of [member, other, plain]) await online(player);
    addToTeam(service, member, 'moderator');
    addToTeam(service, other, 'admin');

    // Über PUT /v1/me ...
    for (const cape of TEAM_CAPE_IDS) {
      const res = await setCape(member, cape);
      assert.equal(res.status, 200, `${cape}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.cape, cape);
      assert.deepEqual(await lookupCapes(member), [cape]);
    }
    // ... und über den Slot cape
    let res = await choose(member, 'sakura_orange');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.cape, 'sakura_orange');
    assert.equal(res.body.team, true);
    assert.equal((await choose(other, 'matrix_rot')).status, 200);
    assert.equal((await setCape(plain, 'matrix')).status, 200);
    assert.equal((await me(member)).cape, 'sakura_orange');
    assert.deepEqual(await lookupCapes(member, other, plain), ['sakura_orange', 'matrix_rot', 'matrix']);

    // Aus dem Team: nirgends mehr ausgeliefert, gespeichert bleibt es; die anderen in derselben Abfrage unverändert.
    assert.equal((await webApi(service, 'DELETE', `/v1/team/members/${member.uuid}`, { cookie })).status, 200);
    assert.deepEqual(await lookupCapes(member, other, plain), ['', 'matrix_rot', 'matrix']);
    assert.equal((await me(member)).cape, '');
    const now = await mine(member);
    assert.deepEqual([now.cape, now.team], [null, false]);
    assert.equal(await storedCape(member), 'sakura_orange');
    // Neu wählen geht auch nicht mehr (die gespeicherte Wahl bleibt trotzdem).
    for (const result of [await setCape(member, 'sakura_orange'), await choose(member, 'matrix_rot')]) {
      assert.equal(result.status, 403);
      assert.equal(result.body.error, TEAM_ONLY);
    }
    assert.equal(await storedCape(member), 'sakura_orange');

    // Wieder im Team: sofort wieder da.
    res = await webApi(service, 'POST', '/v1/team/members', { cookie, body: { uuid: member.uuid, role: 'moderator' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await lookupCapes(member, other, plain), ['sakura_orange', 'matrix_rot', 'matrix']);
    assert.equal((await me(member)).cape, 'sakura_orange');
    assert.equal((await mine(member)).cape, 'sakura_orange');
  });

  test('Katalog: „matrix“ ist als ID eines eingebauten Capes gesperrt', async () => {
    const count = (await webApi(service, 'GET', '/v1/team/cosmetics', { cookie })).body.cosmetics.length;
    for (const slot of ['cape', 'head'] as const) {
      const res = await webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, body: signCosmetic(keys.privateKey, manifestOf(slot, { id: 'matrix' })) });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.error, /eingebauten Capes/);
      assert.match(res.body.error, /matrix_tuerkis, sakura_orange/);
    }
    assert.equal((await webApi(service, 'GET', '/v1/team/cosmetics', { cookie })).body.cosmetics.length, count, 'nichts veröffentlicht');
  });
});

test('eigene Liste (HELDIX_DIENST_CAPES): Team-Capes bleiben gesperrt, nicht gelistete sind unbekannt', async () => {
  const service = await startService({ dev: true, capes: parseCapeList('matrix, matrix_rot') });
  const clients: WsClient[] = [];
  try {
    const player = await devPlayer(service.url, 'Eigene');
    const viewer = await devPlayer(service.url, 'Zuschauer');
    clients.push((await connect(service.wsUrl, player.token)).client);
    const setCape = (cape: string) => api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape } });
    const choose = (id: string) => api(service.url, 'PUT', '/v1/me/cosmetics', { token: player.token, body: { slot: 'cape', id } });
    const lookup = async () =>
      (await api(service.url, 'POST', '/v1/players/lookup', { token: viewer.token, body: { uuids: [player.uuid] } })).body.players[player.uuid].cape;

    assert.equal((await setCape('matrix')).status, 200);
    for (const res of [await setCape('matrix_rot'), await choose('matrix_rot')]) {
      assert.equal(res.status, 403);
      assert.equal(res.body.error, TEAM_ONLY);
    }
    addToTeam(service, player, 'moderator');
    let res = await setCape('matrix_rot');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.cape, 'matrix_rot');
    assert.equal((await choose('matrix_rot')).status, 200);
    assert.equal(await lookup(), 'matrix_rot');

    // Nicht in der Liste: wie bisher unbekannt, auch fürs Team (und eingebaute Capes außerhalb der Liste ebenso).
    for (const cape of ['matrix_tuerkis', 'sakura_orange', 'heldix']) {
      res = await setCape(cape);
      assert.equal(res.status, 400, cape);
      assert.equal(res.body.error, 'Unbekanntes Cape.');
      res = await choose(cape);
      assert.equal(res.status, 404, cape);
      assert.equal(res.body.error, 'Dieses Cosmetic gibt es nicht.');
    }

    // Aus dem Team: auch mit eigener Liste nicht mehr ausgeliefert.
    removeFromTeam(service, player);
    assert.equal(await lookup(), '');
    assert.equal((await api(service.url, 'GET', '/v1/me', { token: player.token })).body.cape, '');
    addToTeam(service, player, 'admin');
    assert.equal(await lookup(), 'matrix_rot');
  } finally {
    for (const client of clients) await client.close();
    await service.close();
  }
});
