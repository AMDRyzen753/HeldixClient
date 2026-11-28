// Eigenes Profil (GET/PUT /v1/me) und allgemeine Prüfungen der Anfragen.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { api, devPlayer, startService, type Player, type TestService, ME_DEFAULTS } from './helpers';

describe('Eigenes Profil', () => {
  let service: TestService;
  let player: Player;

  before(async () => {
    service = await startService({ dev: true });
    player = await devPlayer(service.url, 'Profil');
  });
  after(() => service.close());

  test('Standardwerte', async () => {
    const res = await api(service.url, 'GET', '/v1/me', { token: player.token });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(res.body, { uuid: player.uuid, name: 'Profil', cape: '', visible: true, presence: true, showServer: true, messages: true, ...ME_DEFAULTS });
  });

  test('PUT ändert nur die angegebenen Felder', async () => {
    let res = await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape: 'aurora' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { uuid: player.uuid, name: 'Profil', cape: 'aurora', visible: true, presence: true, showServer: true, messages: true, ...ME_DEFAULTS });

    res = await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { visible: false, showServer: false } });
    assert.deepEqual(res.body, { uuid: player.uuid, name: 'Profil', cape: 'aurora', visible: false, presence: true, showServer: false, messages: true, ...ME_DEFAULTS });

    res = await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { presence: false, cape: '' } });
    assert.deepEqual(res.body, { uuid: player.uuid, name: 'Profil', cape: '', visible: false, presence: false, showServer: false, messages: true, ...ME_DEFAULTS });

    res = await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { messages: false } });
    assert.deepEqual(res.body, { uuid: player.uuid, name: 'Profil', cape: '', visible: false, presence: false, showServer: false, messages: false, ...ME_DEFAULTS });

    // Leeres Objekt: nichts ändert sich.
    res = await api(service.url, 'PUT', '/v1/me', { token: player.token, body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.presence, false);
    assert.equal(res.body.messages, false);

    const get = await api(service.url, 'GET', '/v1/me', { token: player.token });
    assert.deepEqual(get.body, res.body);
  });

  test('alle eingebauten Capes sind erlaubt', async () => {
    for (const cape of ['heldix', 'mitternacht', 'aurora', 'glut', 'kristall', 'neon', 'sakura', 'gewitter', 'galaxie']) {
      const res = await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape } });
      assert.equal(res.status, 200, cape);
      assert.equal(res.body.cape, cape);
    }
  });

  test('ungültige Werte: 400 und keine Änderung', async () => {
    await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape: 'neon', visible: true } });
    for (const body of [
      { cape: 'eigenes-bild' },
      { cape: 'NEON' },
      { cape: null },
      { cape: 3 },
      { visible: 'ja' },
      { presence: 1 },
      { showServer: null },
      { messages: 'ja' },
      { messages: 0 },
      { cape: 'glut', visible: 'nein' },
    ]) {
      const res = await api(service.url, 'PUT', '/v1/me', { token: player.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(typeof res.body.error, 'string');
    }
    const me = await api(service.url, 'GET', '/v1/me', { token: player.token });
    assert.equal(me.body.cape, 'neon');
    assert.equal(me.body.visible, true);
  });

  test('Körper ist kein Objekt oder kein JSON: 400', async () => {
    for (const rawBody of ['[]', '"text"', '42', 'null', '{"cape":']) {
      const res = await api(service.url, 'PUT', '/v1/me', { token: player.token, rawBody });
      assert.equal(res.status, 400, rawBody);
    }
  });

  test('Körper über 16 KB: 413', async () => {
    const rawBody = JSON.stringify({ cape: 'heldix', padding: 'x'.repeat(17 * 1024) });
    const res = await api(service.url, 'PUT', '/v1/me', { token: player.token, rawBody });
    assert.equal(res.status, 413);
    assert.equal(typeof res.body.error, 'string');
    // Knapp unter der Grenze geht es noch.
    const ok = JSON.stringify({ cape: 'heldix', padding: 'x'.repeat(15 * 1024) });
    assert.equal((await api(service.url, 'PUT', '/v1/me', { token: player.token, rawBody: ok })).status, 200);
  });

  test('neue Anmeldung behält die Einstellungen', async () => {
    await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape: 'sakura', presence: true } });
    const again = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'ProfilNeu', uuid: player.uuid } });
    const me = await api(service.url, 'GET', '/v1/me', { token: again.body.token });
    assert.equal(me.body.name, 'ProfilNeu');
    assert.equal(me.body.cape, 'sakura');
    // Das alte Token gilt weiter.
    assert.equal((await api(service.url, 'GET', '/v1/me', { token: player.token })).status, 200);
  });

  test('Health-Check', async () => {
    const res = await api(service.url, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});

describe('Eigene Cape-Liste (HELDIX_DIENST_CAPES)', () => {
  test('ersetzt die eingebaute Liste', async () => {
    const service = await startService({ dev: true, capes: ['winter', 'sommer'] });
    try {
      const player = await devPlayer(service.url);
      assert.equal((await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape: 'winter' } })).status, 200);
      assert.equal((await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape: 'heldix' } })).status, 400);
    } finally {
      await service.close();
    }
  });
});
