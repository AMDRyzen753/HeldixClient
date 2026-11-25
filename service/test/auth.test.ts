// Anmeldung: Challenge, Mojang-hasJoined, Tokens, Entwicklungsweg und Begrenzung der Anfragen.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { isLoopback, parseBearer } from '../src/auth';
import { api, randomUuid, sleep, startFakeMojang, startService, upgradeStatus, type FakeMojang, type TestService } from './helpers';

describe('Anmeldung über Mojang', () => {
  let mojang: FakeMojang;
  let service: TestService;

  before(async () => {
    mojang = await startFakeMojang();
    service = await startService({ sessionServer: mojang.url, challengeTtlMs: 200 });
  });
  after(async () => {
    await service.close();
    await mojang.close();
  });

  async function challenge(): Promise<string> {
    const res = await api(service.url, 'POST', '/v1/auth/challenge');
    assert.equal(res.status, 200);
    assert.match(res.body.serverId, /^[0-9a-f]{40}$/);
    return res.body.serverId;
  }

  test('Challenge → Login liefert Token, UUID, Namen und Ablauf', async () => {
    const uuid = randomUuid();
    const serverId = await challenge();
    mojang.join('Heldix_1', serverId, uuid);
    const started = Date.now();
    // Kleinschreibung beim Namen: Es zählt die Schreibweise von Mojang.
    const res = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'heldix_1', serverId } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.uuid, uuid);
    assert.equal(res.body.name, 'Heldix_1');
    assert.match(res.body.token, /^[A-Za-z0-9_-]{40,}$/);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    assert.ok(res.body.expiresAt >= started + sevenDays - 1000 && res.body.expiresAt <= Date.now() + sevenDays);

    const me = await api(service.url, 'GET', '/v1/me', { token: res.body.token });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { uuid, name: 'Heldix_1', cape: '', visible: true, presence: true, showServer: true });

    // Parameter kommen URL-kodiert beim Session-Server an.
    const last = mojang.requests.at(-1)!;
    assert.equal(last, `/session/minecraft/hasJoined?username=heldix_1&serverId=${serverId}`);
  });

  test('UUID mit Bindestrichen von Mojang wird normalisiert', async () => {
    const uuid = randomUuid();
    const dashed = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`.toUpperCase();
    const serverId = await challenge();
    mojang.join('Bindestrich', serverId, uuid, { status: 200, body: { id: dashed, name: 'Bindestrich' } });
    const res = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Bindestrich', serverId } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.uuid, uuid);
  });

  test('ohne Beitritt bei Mojang: 401', async () => {
    const serverId = await challenge();
    const res = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Niemand', serverId } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Anmeldung bei Mojang fehlgeschlagen.');
  });

  test('falsche Antworten von Mojang zählen als Fehlschlag', async () => {
    const answers = [
      { status: 500, body: { id: randomUuid(), name: 'Kaputt' } },
      { status: 200, body: { id: randomUuid(), name: 'Anderer' } },
      { status: 200, body: { id: 'keine-uuid', name: 'Kaputt' } },
      { status: 200, body: { name: 'Kaputt' } },
      { status: 200, body: 'kein json' },
      { status: 200, body: [] },
    ];
    for (const answer of answers) {
      const serverId = await challenge();
      mojang.join('Kaputt', serverId, randomUuid(), answer);
      const res = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Kaputt', serverId } });
      assert.equal(res.status, 401, JSON.stringify(answer));
      assert.equal(res.body.error, 'Anmeldung bei Mojang fehlgeschlagen.');
    }
  });

  test('serverId ist nur einmal verwendbar', async () => {
    const uuid = randomUuid();
    const serverId = await challenge();
    mojang.join('Einmal', serverId, uuid);
    const first = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Einmal', serverId } });
    assert.equal(first.status, 200);
    const second = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Einmal', serverId } });
    assert.equal(second.status, 401);
  });

  test('fehlgeschlagener Versuch verbraucht die serverId ebenfalls', async () => {
    const serverId = await challenge();
    const failed = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Spaet', serverId } });
    assert.equal(failed.status, 401);
    mojang.join('Spaet', serverId, randomUuid());
    const retry = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Spaet', serverId } });
    assert.equal(retry.status, 401);
  });

  test('unbekannte oder abgelaufene serverId: 401', async () => {
    const unknown = 'a'.repeat(40);
    mojang.join('Unbekannt', unknown, randomUuid());
    const res = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Unbekannt', serverId: unknown } });
    assert.equal(res.status, 401);

    const serverId = await challenge();
    mojang.join('Abgelaufen', serverId, randomUuid());
    await sleep(250); // challengeTtlMs ist im Test 200 ms
    const expired = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Abgelaufen', serverId } });
    assert.equal(expired.status, 401);
  });

  test('ungültige Eingaben: 400', async () => {
    const serverId = await challenge();
    for (const body of [
      {},
      { name: 'Mit Leerzeichen', serverId },
      { name: 'a'.repeat(17), serverId },
      { name: '', serverId },
      { name: 'Gut', serverId: 'zu-kurz' },
      { name: 'Gut', serverId: serverId.toUpperCase() },
      { name: 42, serverId },
    ]) {
      const res = await api(service.url, 'POST', '/v1/auth/login', { body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(typeof res.body.error, 'string');
    }
    const broken = await api(service.url, 'POST', '/v1/auth/login', { rawBody: '{kaputt', headers: { 'Content-Type': 'application/json' } });
    assert.equal(broken.status, 400);
  });

  test('Token: ohne, falsch oder kaputt → 401', async () => {
    for (const headers of <Record<string, string>[]>[{}, { Authorization: 'Bearer ' + 'x'.repeat(43) }, { Authorization: 'Basic abc' }, { Authorization: 'Bearer' }]) {
      const res = await api(service.url, 'GET', '/v1/me', { headers });
      assert.equal(res.status, 401, JSON.stringify(headers));
      assert.equal(typeof res.body.error, 'string');
    }
    for (const [method, path] of [
      ['GET', '/v1/friends'],
      ['PUT', '/v1/me'],
      ['POST', '/v1/players/lookup'],
      ['POST', '/v1/friends/requests'],
      ['DELETE', `/v1/friends/${randomUuid()}`],
    ] as const) {
      const res = await api(service.url, method, path, { body: {} });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  test('WebSocket ohne gültiges Token: 401', async () => {
    assert.equal((await upgradeStatus(service.wsUrl)).status, 401);
    assert.equal((await upgradeStatus(service.wsUrl, { Authorization: 'Bearer ' + 'y'.repeat(43) })).status, 401);
  });

  test('Entwicklungsweg ist ohne Entwicklungsmodus nicht da (404)', async () => {
    const res = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Dev', uuid: randomUuid() } });
    assert.equal(res.status, 404);
    assert.equal(service.logs.some((line) => line.includes('ENTWICKLUNGSMODUS')), false);
  });

  test('unbekannte Wege: 404, falsche Methode: 405', async () => {
    assert.equal((await api(service.url, 'GET', '/v1/gibtsnicht')).status, 404);
    const res = await api(service.url, 'GET', '/v1/auth/challenge');
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });
});

describe('Token-Ablauf', () => {
  test('abgelaufenes Token → 401', async () => {
    const service = await startService({ dev: true, tokenTtlMs: 150 });
    try {
      const res = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Kurz', uuid: randomUuid() } });
      assert.equal(res.status, 200);
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: res.body.token })).status, 200);
      await sleep(200);
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: res.body.token })).status, 401);
    } finally {
      await service.close();
    }
  });
});

describe('Entwicklungsmodus', () => {
  let service: TestService;
  before(async () => {
    service = await startService({ dev: true });
  });
  after(() => service.close());

  test('schreibt eine deutliche Warnung ins Log', () => {
    assert.ok(service.logs.some((line) => line.includes('ENTWICKLUNGSMODUS') && line.includes('/v1/auth/dev')));
  });

  test('meldet von 127.0.0.1 an', async () => {
    const uuid = randomUuid();
    const res = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'DevSpieler', uuid } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.uuid, uuid);
    assert.equal(res.body.name, 'DevSpieler');
    const me = await api(service.url, 'GET', '/v1/me', { token: res.body.token });
    assert.equal(me.body.uuid, uuid);
  });

  test('über einen Proxy (Proxy-Header) gibt es den Weg nicht, auch nicht mit trustProxy', async () => {
    for (const headers of <Record<string, string>[]>[{ 'X-Forwarded-For': '127.0.0.1' }, { Forwarded: 'for=127.0.0.1' }, { 'X-Real-IP': '127.0.0.1' }, { Via: '1.1 proxy' }]) {
      const res = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Proxy', uuid: randomUuid() }, headers });
      assert.equal(res.status, 404, JSON.stringify(headers));
    }
    const proxied = await startService({ dev: true, trustProxy: true });
    try {
      const res = await api(proxied.url, 'POST', '/v1/auth/dev', {
        body: { name: 'Proxy', uuid: randomUuid() },
        headers: { 'X-Forwarded-For': '127.0.0.1' },
      });
      assert.equal(res.status, 404);
    } finally {
      await proxied.close();
    }
  });

  test('prüft Name und UUID', async () => {
    for (const body of [{ name: 'Gut', uuid: 'ABC' }, { name: 'Gut', uuid: randomUuid().toUpperCase() }, { name: 'nicht gut', uuid: randomUuid() }]) {
      assert.equal((await api(service.url, 'POST', '/v1/auth/dev', { body })).status, 400);
    }
  });

  test('nur Loopback-Adressen zählen als „dieser Rechner“', () => {
    assert.equal(isLoopback('127.0.0.1'), true);
    assert.equal(isLoopback('::1'), true);
    assert.equal(isLoopback('::ffff:127.0.0.1'), true);
    for (const address of ['10.0.0.5', '192.168.178.20', '::ffff:192.168.0.1', '2001:db8::1', '', undefined]) {
      assert.equal(isLoopback(address), false, String(address));
    }
  });
});

describe('Begrenzung der Anfragen', () => {
  test('Anmeldung: höchstens 20 pro Minute und IP, danach 429', async () => {
    const service = await startService({ authRateLimit: undefined });
    try {
      for (let i = 0; i < 20; i++) {
        assert.equal((await api(service.url, 'POST', '/v1/auth/challenge')).status, 200, `Anfrage ${i + 1}`);
      }
      const res = await api(service.url, 'POST', '/v1/auth/challenge');
      assert.equal(res.status, 429);
      assert.equal(typeof res.body.error, 'string');
      assert.ok(Number(res.headers.get('retry-after')) >= 1);
      // Auch login zählt zur selben Grenze.
      assert.equal((await api(service.url, 'POST', '/v1/auth/login', { body: {} })).status, 429);
    } finally {
      await service.close();
    }
  });

  test('X-Forwarded-For zählt nur mit trustProxy', async () => {
    const plain = await startService({ authRateLimit: 2 });
    const proxied = await startService({ authRateLimit: 2, trustProxy: true });
    try {
      const send = (s: TestService, ip: string) => api(s.url, 'POST', '/v1/auth/challenge', { headers: { 'X-Forwarded-For': ip } });
      // Ohne trustProxy wird der Header ignoriert: alles zählt für 127.0.0.1.
      assert.equal((await send(plain, '1.1.1.1')).status, 200);
      assert.equal((await send(plain, '2.2.2.2')).status, 200);
      assert.equal((await send(plain, '3.3.3.3')).status, 429);
      // Mit trustProxy zählt der letzte Eintrag (vom eigenen Proxy angehängt).
      assert.equal((await send(proxied, '1.1.1.1')).status, 200);
      assert.equal((await send(proxied, '1.1.1.1')).status, 200);
      assert.equal((await send(proxied, '1.1.1.1')).status, 429);
      assert.equal((await send(proxied, '9.9.9.9, 2.2.2.2')).status, 200);
    } finally {
      await plain.close();
      await proxied.close();
    }
  });

  test('übrige Anfragen: Grenze pro Token, danach 429', async () => {
    const service = await startService({ dev: true, apiRateLimit: 3 });
    try {
      const a = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Viel', uuid: randomUuid() } });
      const b = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Wenig', uuid: randomUuid() } });
      for (let i = 0; i < 3; i++) assert.equal((await api(service.url, 'GET', '/v1/me', { token: a.body.token })).status, 200);
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: a.body.token })).status, 429);
      assert.equal((await api(service.url, 'GET', '/v1/friends', { token: a.body.token })).status, 429);
      assert.equal((await upgradeStatus(service.wsUrl, { Authorization: `Bearer ${a.body.token}` })).status, 429);
      // Ein anderes Token hat seine eigene Grenze.
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: b.body.token })).status, 200);
    } finally {
      await service.close();
    }
  });
});

test('parseBearer liest nur gültige Bearer-Header', () => {
  const token = 'A'.repeat(43);
  assert.equal(parseBearer(`Bearer ${token}`), token);
  assert.equal(parseBearer(`bearer ${token}`), token);
  assert.equal(parseBearer(undefined), null);
  assert.equal(parseBearer(`Bearer ${token} extra`), null);
  assert.equal(parseBearer(`Bearer ${'ä'.repeat(43)}`), null);
});
