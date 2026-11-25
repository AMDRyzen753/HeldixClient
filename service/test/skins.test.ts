// Skins für angemeldete Spieler (GET /v1/skins/<uuid>): nur bekannte Spieler, sonst 404; Team mit 2FA sieht alle.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { SESSION_COOKIE } from '../src/web';
import { PNG, startFakeSkins, type FakeSkins } from './fake-skins';
import { api, befriend, devPlayer, rawRequest, startService, type Player, type TestService } from './helpers';
import { addToTeam, Clock, teamLogin, webLogin, WEBSITE } from './web-helpers';

describe('Skins für angemeldete Spieler', () => {
  const clock = new Clock();
  let fake: FakeSkins;
  let service: TestService;
  let anna: Player;

  before(async () => {
    fake = await startFakeSkins();
    fake.files.set('/texture/gut', { body: PNG });
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, sessionServer: fake.url, skinHosts: ['127.0.0.1'] });
    anna = await devPlayer(service.url, 'Anna');
  });
  after(async () => {
    await service.close();
    await fake.close();
  });

  /** Spieler mit Skin beim nachgebauten Mojang. */
  async function withSkin(name: string): Promise<Player> {
    const player = await devPlayer(service.url, name);
    fake.skinUrls.set(player.uuid, `${fake.url}/texture/gut`);
    return player;
  }

  const skin = (viewer: Player, uuid: string) => rawRequest(service.url, 'GET', `/v1/skins/${uuid}`, { Authorization: `Bearer ${viewer.token}` });
  const skinWithCookie = (cookie: string, uuid: string) => rawRequest(service.url, 'GET', `/v1/skins/${uuid}`, { Cookie: `${SESSION_COOKIE}=${cookie}` });

  test('erlaubt: selbst, Freund, Anfrage in beide Richtungen, selbst Blockierte; privates Cache-Control, kein CORS', async () => {
    fake.skinUrls.set(anna.uuid, `${fake.url}/texture/gut`);
    const own = await skin(anna, anna.uuid);
    assert.equal(own.status, 200);
    assert.equal(own.headers['content-type'], 'image/png');
    assert.equal(own.headers['cache-control'], 'private, max-age=3600');
    assert.equal(own.headers['access-control-allow-origin'], undefined);
    assert.deepEqual(own.body, PNG);

    const friend = await withSkin('Freund');
    await befriend(service.url, anna, friend);
    const incoming = await withSkin('FragtAn');
    await api(service.url, 'POST', '/v1/friends/requests', { token: incoming.token, body: { name: 'Anna' } });
    const outgoing = await withSkin('Angefragt');
    await api(service.url, 'POST', '/v1/friends/requests', { token: anna.token, body: { name: 'Angefragt' } });
    const blocked = await withSkin('Blockiert');
    await api(service.url, 'POST', '/v1/blocks', { token: anna.token, body: { name: 'Blockiert' } });
    for (const other of [friend, incoming, outgoing, blocked]) {
      const res = await skin(anna, other.uuid);
      assert.equal(res.status, 200, other.name);
      assert.deepEqual(res.body, PNG);
    }
    // Die andere Seite einer Anfrage sieht Anna ebenfalls.
    assert.equal((await skin(incoming, anna.uuid)).status, 200);
  });

  test('nicht erlaubt: Fremde, wer mich blockiert hat, ungültige UUID – 404 ohne Mojang zu fragen; ohne Anmeldung 401', async () => {
    const stranger = await withSkin('Fremder');
    const blocker = await withSkin('Blockierer');
    await api(service.url, 'POST', '/v1/blocks', { token: blocker.token, body: { name: 'Anna' } });
    const asked = fake.requests.length;
    for (const uuid of [stranger.uuid, blocker.uuid, 'f'.repeat(32), 'NICHT-HEX']) {
      const res = await skin(anna, uuid);
      assert.equal(res.status, 404, uuid);
      assert.equal(JSON.parse(res.body.toString('utf8')).error, 'Kein Skin gefunden.');
    }
    assert.equal(fake.requests.length, asked);
    assert.equal((await rawRequest(service.url, 'GET', `/v1/skins/${anna.uuid}`)).status, 401);
    // Erlaubt, aber kein Skin bei Mojang: ebenfalls 404.
    const noSkin = await devPlayer(service.url, 'OhneSkin');
    await befriend(service.url, anna, noSkin);
    assert.equal((await skin(anna, noSkin.uuid)).status, 404);
  });

  test('mit Cookie; Team mit bestätigter 2FA sieht alle, ohne 2FA nicht', async () => {
    const stranger = await withSkin('Unbekannt');
    const { cookie } = await webLogin(service, anna);
    assert.equal((await skinWithCookie(cookie, anna.uuid)).status, 200, 'Cookie, eigener Skin');
    assert.equal((await skinWithCookie(cookie, stranger.uuid)).status, 404);

    const mod = await devPlayer(service.url, 'Moderator');
    addToTeam(service, mod, 'moderator');
    const noTwoFactor = await webLogin(service, mod);
    assert.equal((await skinWithCookie(noTwoFactor.cookie, stranger.uuid)).status, 404, 'Team ohne 2FA');
    const verified = await teamLogin(service, mod, 'moderator', clock);
    assert.equal((await skinWithCookie(verified.cookie, stranger.uuid)).status, 200, 'Team mit 2FA');
    // Neue Sitzung ohne eingegebenen Code: nicht bestätigt.
    const fresh = await webLogin(service, mod);
    assert.equal((await skinWithCookie(fresh.cookie, stranger.uuid)).status, 404);
    // Mit Bearer-Token gilt das Team-Gate nicht (der Team-Bereich ist nur auf der Webseite).
    assert.equal((await skin(mod, stranger.uuid)).status, 404);
  });
});

test('Skins: eigene Grenze pro Spieler (hier 3), unabhängig von der allgemeinen', async () => {
  const fake = await startFakeSkins();
  const service = await startService({ dev: true, sessionServer: fake.url, skinHosts: ['127.0.0.1'], skinRateLimit: 3, apiRateLimit: 2 });
  try {
    const player = await devPlayer(service.url, 'Viel');
    fake.files.set('/texture/gut', { body: PNG });
    fake.skinUrls.set(player.uuid, `${fake.url}/texture/gut`);
    const get = () => rawRequest(service.url, 'GET', `/v1/skins/${player.uuid}`, { Authorization: `Bearer ${player.token}` });
    for (let i = 0; i < 3; i++) assert.equal((await get()).status, 200, `Skin ${i + 1}`);
    const limited = await get();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers['retry-after']) >= 1);
    // Die allgemeine Grenze (hier 2) hat die Skins nicht mitgezählt.
    assert.equal((await api(service.url, 'GET', '/v1/me', { token: player.token })).status, 200);
  } finally {
    await service.close();
    await fake.close();
  }
});
