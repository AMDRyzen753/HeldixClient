// Freunde 2.0: Favorit, Spitzname und Notiz je Freundschaft, Statustext, „Nicht stören“, „zuletzt online“, Profilkarte
// und Vorschläge „Freunde von Freunden“ mit beiden Schaltern.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { roundLastOnline } from '../src/realtime';
import { api, befriend, connect, devPlayer, FRIEND_DEFAULTS, startService, type Player, type TestService, type WsClient } from './helpers';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('zuletzt online wird gerundet: 5 Minuten, Stunden, Tage', () => {
  const now = Date.UTC(2026, 10, 27, 15, 37, 12);
  assert.equal(roundLastOnline(now - 2 * MINUTE, now), Date.UTC(2026, 10, 27, 15, 35));
  assert.equal(roundLastOnline(now - 3 * HOUR, now), Date.UTC(2026, 10, 27, 12, 0));
  assert.equal(roundLastOnline(now - 2 * DAY - 5 * HOUR, now), Date.UTC(2026, 10, 25, 0, 0));
  assert.ok(roundLastOnline(now, now) <= now, 'nie in der Zukunft');
});

describe('Freunde 2.0', () => {
  let service: TestService;
  let anna: Player;
  let ben: Player;
  let carla: Player;
  const open: WsClient[] = [];

  before(async () => {
    service = await startService({ dev: true });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    carla = await devPlayer(service.url, 'Carla');
    await befriend(service.url, anna, ben);
    await befriend(service.url, anna, carla);
    await befriend(service.url, ben, carla);
  });
  after(async () => {
    for (const client of open) await client.close();
    await service.close();
  });

  const call = (player: Player, method: string, path: string, body?: unknown) => api(service.url, method, path, { token: player.token, body });
  async function online(player: Player): Promise<WsClient> {
    const { client } = await connect(service.wsUrl, player.token);
    open.push(client);
    return client;
  }
  const friendIn = async (viewer: Player, uuid: string) => (await call(viewer, 'GET', '/v1/friends')).body.friends.find((f: { uuid: string }) => f.uuid === uuid);

  test('Favorit, Spitzname, Notiz: nur für einen selbst, geprüft, Echtzeit an die eigenen Verbindungen', async () => {
    const annaWs = await online(anna);
    const benWs = await online(ben);
    annaWs.drain();
    benWs.drain();
    let res = await call(anna, 'PATCH', `/v1/friends/${ben.uuid}`, { favorite: true, nickname: '  Benni  ', note: 'Baut gern Burgen' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.friend.favorite, res.body.friend.nickname, res.body.friend.note], [true, 'Benni', 'Baut gern Burgen']);
    assert.equal((await annaWs.next((m) => m.type === 'friend' && m.friend.uuid === ben.uuid && m.friend.nickname !== null)).friend.nickname, 'Benni');
    // Ben sieht davon nichts
    await benWs.sync();
    assert.equal(benWs.messages.some((m) => m.type === 'friend' && m.friend.uuid === anna.uuid), false);
    const fromBen = await friendIn(ben, anna.uuid);
    assert.deepEqual([fromBen.favorite, fromBen.nickname, fromBen.note], [false, null, null]);
    // In der Liste und per Echtzeit beim Status: eigene Angaben bleiben
    const inList = await friendIn(anna, ben.uuid);
    assert.deepEqual([inList.favorite, inList.nickname, inList.note], [true, 'Benni', 'Baut gern Burgen']);
    benWs.send({ type: 'status', state: 'menu', server: null });
    const announced = await annaWs.next((m) => m.type === 'friend' && m.friend.state === 'menu');
    assert.deepEqual([announced.friend.favorite, announced.friend.nickname], [true, 'Benni']);
    // Teilweise ändern, leeren mit null bzw. ""
    res = await call(anna, 'PATCH', `/v1/friends/${ben.uuid}`, { nickname: null });
    assert.deepEqual([res.body.friend.favorite, res.body.friend.nickname, res.body.friend.note], [true, null, 'Baut gern Burgen']);
    res = await call(anna, 'PATCH', `/v1/friends/${ben.uuid}`, { note: '' });
    assert.equal(res.body.friend.note, null);
    // Prüfungen
    for (const body of [{ favorite: 'ja' }, { nickname: 'x'.repeat(25) }, { note: 'y'.repeat(201) }, { nickname: 'a\nb' }, { note: 5 }]) {
      assert.equal((await call(anna, 'PATCH', `/v1/friends/${ben.uuid}`, body)).status, 400, JSON.stringify(body));
    }
    const fremd = await devPlayer(service.url, 'Fremd1');
    assert.equal((await call(anna, 'PATCH', `/v1/friends/${fremd.uuid}`, { favorite: true })).status, 404);
    assert.equal((await call(anna, 'PATCH', '/v1/friends/kaputt', { favorite: true })).status, 400);
    // Ende der Freundschaft: Angaben weg; Datenauskunft zeigt sie solange
    const exported = await api(service.url, 'GET', '/v1/me/export', { token: anna.token });
    assert.deepEqual(
      exported.body.friends.find((f: { uuid: string }) => f.uuid === ben.uuid),
      { uuid: ben.uuid, name: 'Ben', since: inList.since, favorite: true, nickname: null, note: null },
    );
  });

  test('Statustext und „Nicht stören“: Freunde sehen beides; dnd nur, solange online; Prüfungen', async () => {
    const carlaWs = await online(carla);
    carlaWs.drain();
    let res = await call(anna, 'PUT', '/v1/me', { statusText: '  Baue an der Burg  ', dnd: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.statusText, res.body.dnd], ['Baue an der Burg', true]);
    const msg = await carlaWs.next((m) => m.type === 'friend' && m.friend.uuid === anna.uuid && m.friend.statusText !== null);
    assert.deepEqual([msg.friend.statusText, msg.friend.dnd, msg.friend.online], ['Baue an der Burg', true, true]);
    for (const body of [{ statusText: 'x'.repeat(41) }, { statusText: 'a\tb' }, { statusText: 3 }, { dnd: 'ja' }, { onlineNotify: 'manchmal' }]) {
      assert.equal((await call(anna, 'PUT', '/v1/me', body)).status, 400, JSON.stringify(body));
    }
    res = await call(anna, 'PUT', '/v1/me', { onlineNotify: 'favorites' });
    assert.equal(res.body.onlineNotify, 'favorites');
    // Anna geht offline: Statustext bleibt sichtbar, dnd nicht
    for (const client of open.filter((c) => c !== carlaWs)) await client.close();
    open.splice(0, open.length, carlaWs);
    const offline = await carlaWs.next((m) => m.type === 'friend' && m.friend.uuid === anna.uuid && !m.friend.online);
    assert.deepEqual([offline.friend.statusText, offline.friend.dnd], ['Baue an der Burg', false]);
    res = await call(anna, 'PUT', '/v1/me', { statusText: null, dnd: false });
    assert.deepEqual([res.body.statusText, res.body.dnd], [null, false]);
  });

  test('zuletzt online: nur mit Online-Status und eigenem Schalter, gerundet', async () => {
    const dora = await devPlayer(service.url, 'Dora');
    await befriend(service.url, anna, dora);
    const doraWs = await online(dora);
    await doraWs.close();
    open.splice(open.indexOf(doraWs), 1);
    let seen = await friendIn(anna, dora.uuid);
    assert.equal(seen.online, false);
    assert.equal(typeof seen.lastOnline, 'number');
    assert.ok(Date.now() - seen.lastOnline < 6 * MINUTE && seen.lastOnline % (5 * MINUTE) === 0, 'auf 5 Minuten gerundet');
    await call(dora, 'PUT', '/v1/me', { showLastOnline: false });
    assert.equal((await friendIn(anna, dora.uuid)).lastOnline, null);
    await call(dora, 'PUT', '/v1/me', { showLastOnline: true, presence: false });
    assert.equal((await friendIn(anna, dora.uuid)).lastOnline, null, 'ohne Online-Status auch kein „zuletzt online“');
    await call(dora, 'PUT', '/v1/me', { presence: true });
    seen = await friendIn(anna, dora.uuid);
    assert.equal(typeof seen.lastOnline, 'number');
    // Online: kein lastOnline
    const again = await online(dora);
    assert.equal((await friendIn(anna, dora.uuid)).lastOnline, null);
    await again.close();
    open.splice(open.indexOf(again), 1);
    // Datenauskunft: genauer Wert
    const exported = await api(service.url, 'GET', '/v1/me/export', { token: dora.token });
    assert.equal(typeof exported.body.profile.lastOnline, 'number');
    assert.equal(exported.body.profile.showLastOnline, true);
  });

  test('Profilkarte: nur für Freunde, gemeinsame Freunde, Aussehen nur mit „erkennbar“', async () => {
    let res = await call(anna, 'GET', `/v1/friends/${ben.uuid}/profile`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), ['cape', 'cosmetics', 'friend', 'mutual']);
    assert.equal(res.body.friend.uuid, ben.uuid);
    assert.deepEqual(res.body.mutual, [{ uuid: carla.uuid, name: 'Carla' }], 'nur gemeinsame Freunde');
    assert.deepEqual(res.body.cosmetics, { head: null, back: null, aura: null, companion: null });
    await call(ben, 'PUT', '/v1/me', { cape: 'aurora' });
    assert.equal((await call(anna, 'GET', `/v1/friends/${ben.uuid}/profile`)).body.cape, 'aurora');
    await call(ben, 'PUT', '/v1/me', { visible: false });
    assert.equal((await call(anna, 'GET', `/v1/friends/${ben.uuid}/profile`)).body.cape, '', 'nicht erkennbar: kein Aussehen');
    await call(ben, 'PUT', '/v1/me', { visible: true });
    const fremd = await devPlayer(service.url, 'Fremd2');
    assert.equal((await call(anna, 'GET', `/v1/friends/${fremd.uuid}/profile`)).status, 404);
    res = await call(fremd, 'GET', `/v1/friends/${anna.uuid}/profile`);
    assert.deepEqual([res.status, res.body.error], [404, 'Dieser Spieler ist nicht in deiner Freundesliste.']);
  });

  test('Vorschläge: nur wer „In Vorschlägen erscheinen“ an hat; Zähler gemeinsamer Freunde; eigener Schalter; Anfrage', async () => {
    const eva = await devPlayer(service.url, 'Eva');
    const finn = await devPlayer(service.url, 'Finn');
    const gil = await devPlayer(service.url, 'Gil');
    await befriend(service.url, eva, ben);
    await befriend(service.url, eva, carla);
    await befriend(service.url, finn, ben);
    await befriend(service.url, gil, carla);
    // Standard: niemand erscheint
    let res = await call(anna, 'GET', '/v1/friends/suggestions');
    assert.deepEqual(res.body, { enabled: true, suggestions: [] });
    await call(eva, 'PUT', '/v1/me', { suggestable: true });
    await call(finn, 'PUT', '/v1/me', { suggestable: true });
    res = await call(anna, 'GET', '/v1/friends/suggestions');
    assert.deepEqual(res.body.suggestions, [
      { uuid: eva.uuid, name: 'Eva', mutual: 2 },
      { uuid: finn.uuid, name: 'Finn', mutual: 1 },
    ]);
    // Gil will nicht erscheinen; Blockierte und Anfragen fallen weg
    await call(anna, 'POST', '/v1/blocks', { uuid: finn.uuid });
    res = await call(anna, 'GET', '/v1/friends/suggestions');
    assert.deepEqual(res.body.suggestions.map((s: { name: string }) => s.name), ['Eva']);
    await call(anna, 'DELETE', `/v1/blocks/${finn.uuid}`);
    // Anfrage über den Vorschlag (ohne Namen)
    res = await call(anna, 'POST', `/v1/friends/suggestions/${eva.uuid}/request`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.outgoing.map((r: { uuid: string }) => r.uuid), [eva.uuid]);
    assert.deepEqual((await call(anna, 'GET', '/v1/friends/suggestions')).body.suggestions.map((s: { name: string }) => s.name), ['Finn']);
    assert.equal((await call(anna, 'POST', `/v1/friends/suggestions/${gil.uuid}/request`)).status, 404, 'Gil ist kein Vorschlag');
    // „Vorschläge zeigen“ aus
    await call(anna, 'PUT', '/v1/me', { showSuggestions: false });
    assert.deepEqual((await call(anna, 'GET', '/v1/friends/suggestions')).body, { enabled: false, suggestions: [] });
    assert.equal((await call(anna, 'POST', `/v1/friends/suggestions/${finn.uuid}/request`)).status, 404);
    const me = (await call(anna, 'GET', '/v1/me')).body;
    assert.deepEqual([me.showSuggestions, me.suggestable], [false, false]);
  });

  test('Friend-Objekt hat alle neuen Felder (auch in friends und accepted)', async () => {
    const hugo = await devPlayer(service.url, 'Hugo');
    const hugoWs = await online(hugo);
    await call(hugo, 'POST', '/v1/friends/requests', { name: 'Anna' });
    await call(anna, 'POST', `/v1/friends/requests/${hugo.uuid}/accept`);
    const accepted = await hugoWs.next('accepted');
    assert.deepEqual(accepted.friend, {
      uuid: anna.uuid,
      name: 'Anna',
      online: false,
      state: null,
      server: null,
      since: accepted.friend.since,
      ...FRIEND_DEFAULTS,
      lastOnline: accepted.friend.lastOnline,
    });
  });
});
