// Echtzeit im Browser (Cookie + Origin) und im Launcher (?client=launcher): Begleiter bekommen alles, zählen aber nicht
// als „online im Spiel“; Abmelden schließt die Verbindung (4008).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { SESSION_COOKIE } from '../src/web';
import { api, befriend, connect, devPlayer, startService, upgradeStatus, WsClient, type TestService } from './helpers';
import { webApi, webLogin, WEBSITE } from './web-helpers';

/** WebSocket wie aus dem Browser: Cookie und Origin. */
async function browserWs(service: TestService, cookie: string, origin = WEBSITE): Promise<{ client: WsClient; friends: any }> {
  const ws = new WebSocket(service.wsUrl, { headers: { Cookie: `${SESSION_COOKIE}=${cookie}`, Origin: origin } });
  const client = new WsClient(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return { client, friends: await client.next('friends') };
}

test('Browser: Cookie mit Origin der Webseite; Freunde, Nachrichten, Party live; nicht online; Abmelden → 4008', async () => {
  const service = await startService({ dev: true, website: WEBSITE });
  try {
    const anna = await devPlayer(service.url, 'Anna');
    const ben = await devPlayer(service.url, 'Ben');
    await befriend(service.url, anna, ben);
    const benWs = (await connect(service.wsUrl, ben.token)).client;
    const { cookie } = await webLogin(service, anna);

    // Falscher oder fehlender Origin: 403; ungültiges Cookie: 401
    assert.equal((await upgradeStatus(service.wsUrl, { Cookie: `${SESSION_COOKIE}=${cookie}`, Origin: 'https://boese.example' })).status, 403);
    assert.equal((await upgradeStatus(service.wsUrl, { Cookie: `${SESSION_COOKIE}=${cookie}` })).status, 403);
    assert.equal((await upgradeStatus(service.wsUrl, { Cookie: `${SESSION_COOKIE}=${'A'.repeat(43)}`, Origin: WEBSITE })).status, 401);

    const { client: web, friends } = await browserWs(service, cookie);
    assert.equal(friends.friends[0].uuid, ben.uuid, 'Freundesliste direkt nach dem Verbinden');
    assert.equal(friends.friends[0].online, true);
    // Anna ist für Ben nicht online gegangen: kein friend, nicht im Nachschlagen, /v1/status zählt nur Ben
    await benWs.sync();
    assert.equal(benWs.drain().some((m) => m.type === 'friend'), false);
    assert.equal((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.friends[0].online, false);
    assert.deepEqual((await api(service.url, 'POST', '/v1/players/lookup', { token: ben.token, body: { uuids: [anna.uuid] } })).body, { players: {} });
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.online, 1);
    // Ein Status aus dem Browser zählt nicht
    web.send({ type: 'status', state: 'multiplayer', server: 'mc.example.de' });
    await web.sync();
    await benWs.sync();
    assert.equal(benWs.drain().some((m) => m.type === 'friend'), false);

    // Live: Nachricht, „schreibt …“, Party-Einladung kommen im Browser an
    await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: ben.token, body: { text: 'Hallo Browser' } });
    assert.equal((await web.next('message')).message.text, 'Hallo Browser');
    benWs.send({ type: 'typing', to: anna.uuid });
    assert.deepEqual(await web.next('typing'), { type: 'typing', from: ben.uuid });
    web.send({ type: 'typing', to: ben.uuid });
    assert.deepEqual(await benWs.next('typing'), { type: 'typing', from: anna.uuid });
    const invite = await api(service.url, 'POST', '/v1/party/invite', { token: ben.token, body: { uuid: anna.uuid } });
    assert.equal((await web.next((m) => m.type === 'party-invite' && m.invite !== null)).invite.party, invite.body.party.id);
    // Annehmen im Browser (Cookie + CSRF): Anna ist in der Party, nicht „away“ (Begleiter zählt als Verbindung)
    const accepted = await webApi(service, 'POST', `/v1/party/${invite.body.party.id}/accept`, { cookie });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const member = accepted.body.party.members.find((m: { uuid: string }) => m.uuid === anna.uuid);
    assert.deepEqual([member.away, member.online], [false, false]);

    // Abmelden schließt die Verbindung dieser Sitzung (4008)
    assert.equal((await webApi(service, 'POST', '/v1/web/logout', { cookie })).status, 200);
    assert.equal((await web.closed).code, 4008);
    await benWs.close();
  } finally {
    await service.close();
  }
});

test('ohne eingerichtete Webseite kein Cookie-WebSocket (403); Launcher mit ?client=launcher ist Begleiter', async () => {
  const service = await startService({ dev: true });
  try {
    const anna = await devPlayer(service.url, 'Anna');
    const ben = await devPlayer(service.url, 'Ben');
    await befriend(service.url, anna, ben);
    assert.equal((await upgradeStatus(service.wsUrl, { Cookie: `${SESSION_COOKIE}=${'A'.repeat(43)}`, Origin: WEBSITE })).status, 403);
    const benWs = (await connect(service.wsUrl, ben.token)).client;
    const launcher = (await connect(`${service.wsUrl}?client=launcher`, anna.token)).client;
    await benWs.sync();
    assert.equal(benWs.drain().some((m) => m.type === 'friend'), false, 'Launcher macht nicht online');
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.online, 1);
    // Das Spiel kommt dazu: jetzt online; Launcher bleibt verbunden, wenn das Spiel geht
    const game = (await connect(service.wsUrl, anna.token)).client;
    assert.equal((await benWs.next('friend')).friend.online, true);
    await game.close();
    assert.equal((await benWs.next('friend')).friend.online, false);
    await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: ben.token, body: { text: 'Im Launcher?' } });
    assert.equal((await launcher.next('message')).message.text, 'Im Launcher?');
    await launcher.close();
    await benWs.close();
  } finally {
    await service.close();
  }
});
