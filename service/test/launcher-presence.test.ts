// „Im Launcher“ (1.14.0): Launcher-Verbindungen (/v1/ws?client=launcher) zählen getrennt von der Webseite. Freunde sehen
// `launcher: true` (Präsenz sichtbar, kein Spiel, mindestens ein Launcher), `online` bleibt „im Spiel“, „Nicht stören“
// gilt auch im Launcher, „zuletzt online“ zählt den Launcher mit, Freunde bekommen beim Wechsel eine Aktualisierung,
// Party-Mitglieder sehen `launcher` ebenfalls.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { SESSION_COOKIE } from '../src/web';
import { api, befriend, devPlayer, startService, WsClient, type Player, type TestService } from './helpers';
import { webLogin, WEBSITE } from './web-helpers';

describe('Freunde: „Im Launcher“', () => {
  let service: TestService;
  const open: WsClient[] = [];

  before(async () => {
    service = await startService({ dev: true, website: WEBSITE });
  });
  after(async () => {
    for (const client of open) await client.close();
    await service.close();
  });

  /** Echtzeit-Verbindung: Spiel, Launcher (`?client=launcher`) oder Webseite (Cookie, Origin der Webseite). */
  async function ws(player: Player, kind: 'game' | 'launcher' | 'web'): Promise<WsClient> {
    let socket: WebSocket;
    if (kind === 'web') {
      const { cookie } = await webLogin(service, player);
      socket = new WebSocket(service.wsUrl, { headers: { Cookie: `${SESSION_COOKIE}=${cookie}`, Origin: WEBSITE } });
    } else {
      socket = new WebSocket(`${service.wsUrl}${kind === 'launcher' ? '?client=launcher' : ''}`, { headers: { Authorization: `Bearer ${player.token}` } });
    }
    const client = new WsClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
      socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    await client.next('friends');
    open.push(client);
    return client;
  }

  const friendOf = async (viewer: Player, uuid: string) =>
    (await api(service.url, 'GET', '/v1/friends', { token: viewer.token })).body.friends.find((f: { uuid: string }) => f.uuid === uuid);
  const update = (client: WsClient, uuid: string, check: (f: any) => boolean) => client.next((m) => m.type === 'friend' && m.friend.uuid === uuid && check(m.friend));

  test('Launcher allein: launcher true, online false; Spiel geht vor; zuletzt online erst, wenn auch der Launcher zu ist', async () => {
    const anna = await devPlayer(service.url, 'Anna');
    const ben = await devPlayer(service.url, 'Ben');
    await befriend(service.url, anna, ben);
    const benGame = await ws(ben, 'game');
    let friend = await friendOf(ben, anna.uuid);
    assert.deepEqual([friend.online, friend.launcher, friend.lastOnline], [false, false, null]);

    // Launcher an: Ben bekommt sofort eine Aktualisierung
    const launcher = await ws(anna, 'launcher');
    friend = (await update(benGame, anna.uuid, (f) => f.launcher)).friend;
    assert.deepEqual([friend.online, friend.launcher, friend.state, friend.server, friend.dnd, friend.lastOnline], [false, true, null, null, false, null]);
    assert.equal((await friendOf(ben, anna.uuid)).launcher, true);
    // online bleibt „im Spiel“: /v1/status und Nachschlagen zählen den Launcher nicht
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.online, 1);
    // Ein zweiter Launcher ändert nichts
    const second = await ws(anna, 'launcher');

    // Spiel dazu: online, launcher false
    const game = await ws(anna, 'game');
    friend = (await update(benGame, anna.uuid, (f) => f.online)).friend;
    assert.deepEqual([friend.online, friend.launcher], [true, false]);
    // Spiel zu, Launcher noch offen: wieder „Im Launcher“, ohne „zuletzt online“
    await game.close();
    friend = (await update(benGame, anna.uuid, (f) => !f.online)).friend;
    assert.deepEqual([friend.online, friend.launcher, friend.lastOnline], [false, true, null]);
    // Erst wenn der letzte Launcher zu ist: offline mit „zuletzt online“
    await second.close();
    await benGame.sync();
    assert.equal((await friendOf(ben, anna.uuid)).launcher, true, 'ein Launcher ist noch offen');
    const closedAt = Date.now();
    await launcher.close();
    friend = (await update(benGame, anna.uuid, (f) => !f.launcher)).friend;
    assert.deepEqual([friend.online, friend.launcher], [false, false]);
    assert.equal(typeof friend.lastOnline, 'number');
    // gerundet (auf 5 Minuten), aber aus der Zeit des Schließens
    assert.ok(friend.lastOnline <= Date.now() && friend.lastOnline > closedAt - 10 * 60_000);
  });

  test('Webseite zählt nicht; Präsenz aus: immer offline; „Nicht stören“ gilt auch im Launcher', async () => {
    const carla = await devPlayer(service.url, 'Carla');
    const dora = await devPlayer(service.url, 'Dora');
    await befriend(service.url, carla, dora);
    const doraGame = await ws(dora, 'game');
    await ws(carla, 'web');
    await doraGame.sync();
    assert.equal((await friendOf(dora, carla.uuid)).launcher, false, 'Webseite ist kein Launcher');

    await api(service.url, 'PUT', '/v1/me', { token: carla.token, body: { dnd: true } });
    await ws(carla, 'launcher');
    let friend = (await update(doraGame, carla.uuid, (f) => f.launcher)).friend;
    assert.deepEqual([friend.launcher, friend.dnd], [true, true]);
    // Präsenz aus: auch nicht „Im Launcher“ (Aktualisierung an die Freunde)
    await api(service.url, 'PUT', '/v1/me', { token: carla.token, body: { presence: false } });
    friend = (await update(doraGame, carla.uuid, (f) => !f.launcher)).friend;
    assert.deepEqual([friend.online, friend.launcher, friend.dnd, friend.lastOnline], [false, false, false, null]);
    await api(service.url, 'PUT', '/v1/me', { token: carla.token, body: { presence: true } });
    friend = (await update(doraGame, carla.uuid, (f) => f.launcher)).friend;
    assert.equal(friend.launcher, true);
  });

  test('Party: Mitglieder sehen launcher (online nur im Spiel)', async () => {
    const leo = await devPlayer(service.url, 'Leo');
    const mia = await devPlayer(service.url, 'Mia');
    await befriend(service.url, leo, mia);
    const leoGame = await ws(leo, 'game');
    const miaGame = await ws(mia, 'game');
    const invited = await api(service.url, 'POST', '/v1/party/invite', { token: leo.token, body: { uuid: mia.uuid } });
    assert.equal(invited.status, 200, JSON.stringify(invited.body));
    assert.equal((await api(service.url, 'POST', `/v1/party/${invited.body.party.id}/accept`, { token: mia.token })).status, 200);
    const miaLauncher = await ws(mia, 'launcher');
    await miaGame.close();
    const member = async () => (await api(service.url, 'GET', '/v1/party', { token: leo.token })).body.party.members.find((m: { uuid: string }) => m.uuid === mia.uuid);
    for (let i = 0; i < 50 && (await member()).online; i++) await leoGame.sync();
    assert.deepEqual([(await member()).online, (await member()).launcher], [false, true]);
    // Leo bekommt den neuen Stand der Party per Echtzeit
    const pushed = await leoGame.next((m) => m.type === 'party' && m.party?.members.some((x: any) => x.uuid === mia.uuid && x.launcher));
    assert.ok(pushed);
    await miaLauncher.close();
    await leoGame.next((m) => m.type === 'party' && m.party?.members.some((x: any) => x.uuid === mia.uuid && !x.launcher && !x.online));
  });
});
