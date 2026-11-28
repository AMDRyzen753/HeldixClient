// Öffentliche Live-Zahlen (/v1/public/stats mit Schwelle) und Köpfe aus dem Skin (/v1/public/heads/<uuid>.png).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/db';
import { decodePng, encodePng, faceOf, renderHead } from '../src/heads';
import { startFakeSkins } from './fake-skins';
import { addToTeam } from './web-helpers';
import { api, connect, devPlayer, randomUuid, rawRequest, startService } from './helpers';

/** Skin 64×64 (RGBA): Gesicht rot, an (9,9) ein grüner Punkt, Hut-Ebene durchsichtig außer (41,8) blau. */
function skin(height = 64, hatOpaque = false): Buffer {
  const data = Buffer.alloc(64 * height * 4);
  const set = (x: number, y: number, rgba: number[]) => data.set(rgba, (y * 64 + x) * 4);
  for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) set(x, y, [200, 0, 0, 255]);
  set(9, 9, [0, 200, 0, 255]);
  for (let y = 8; y < 16; y++) for (let x = 40; x < 48; x++) set(x, y, hatOpaque ? [10, 10, 10, 255] : [0, 0, 0, 0]);
  set(41, 8, [0, 0, 255, 255]);
  return encodePng({ width: 64, height, data });
}

test('Köpfe: PNG lesen und schreiben, Gesicht mit Hut-Ebene, alte Skins ohne deckende Füllung, vergrößert', () => {
  const decoded = decodePng(skin())!;
  assert.deepEqual([decoded.width, decoded.height], [64, 64]);
  const face = faceOf(decoded)!;
  const px = (x: number, y: number) => [...face.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
  assert.deepEqual(px(0, 1), [200, 0, 0, 255]);
  assert.deepEqual(px(1, 1), [0, 200, 0, 255]);
  assert.deepEqual(px(1, 0), [0, 0, 255, 255], 'Hut darüber');
  // 64×32 mit ganz deckender Hut-Ebene: wie in Minecraft weggelassen
  const legacy = faceOf(decodePng(skin(32, true))!)!;
  assert.deepEqual([...legacy.data.subarray(0, 4)], [200, 0, 0, 255]);
  // Größe 32: jedes Pixel 4×4
  const head = decodePng(renderHead(skin(), 32))!;
  assert.deepEqual([head.width, head.height], [32, 32]);
  assert.deepEqual([...head.data.subarray((5 * 32 + 5) * 4, (5 * 32 + 5) * 4 + 4)], [0, 200, 0, 255]);
  // Kein Skin oder Unsinn: Standard-Kopf
  for (const input of [null, Buffer.from('kein png')]) {
    const fallback = decodePng(renderHead(input, 64))!;
    assert.deepEqual([fallback.width, fallback.height, fallback.data[3]], [64, 64, 255]);
  }
  assert.equal(faceOf({ width: 32, height: 32, data: Buffer.alloc(32 * 32 * 4) }), null, 'falsche Größe');
});

test('Live-Zahlen: unter der Schwelle null, darüber Zahlen; 30 s zwischengespeichert; CORS', async () => {
  const hidden = await startService({ dev: true });
  try {
    const player = await devPlayer(hidden.url, 'Anna');
    const ws = (await connect(hidden.wsUrl, player.token)).client;
    const res = await api(hidden.url, 'GET', '/v1/public/stats');
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.online, res.body.voice, res.body.worlds, res.body.minOnline], [null, null, null, 50]);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('cache-control') ?? '', /max-age=30/);
    await ws.close();
  } finally {
    await hidden.close();
  }
  const shown = await startService({ dev: true, liveStatsMinOnline: 1, weltDomain: 'welt.test' });
  try {
    let res = await api(shown.url, 'GET', '/v1/public/stats');
    assert.deepEqual([res.body.online, res.body.voice, res.body.worlds], [null, null, null], 'noch niemand online');
    // Zwischengespeichert: dieselbe Antwort, auch wenn jetzt jemand online ist
    const player = await devPlayer(shown.url, 'Ben');
    const ws = (await connect(shown.wsUrl, player.token)).client;
    const again = await api(shown.url, 'GET', '/v1/public/stats');
    assert.equal(again.body.at, res.body.at);
    assert.equal(again.body.online, null);
    await ws.close();
  } finally {
    await shown.close();
  }
  const always = await startService({ dev: true, liveStatsMinOnline: 0, weltDomain: 'welt.test' });
  try {
    const res = await api(always.url, 'GET', '/v1/public/stats');
    assert.deepEqual([res.body.online, res.body.voice, res.body.worlds, res.body.minOnline], [0, 0, 0, 0]);
  } finally {
    await always.close();
  }
  await assert.rejects(startService({ liveStatsMinOnline: -1 }), /Schwelle/);
});

test('Köpfe: nur bekannte, erkennbare Spieler (oder Teamseite); Größen; Standard-Kopf; Zwischenspeicher; Grenze', async () => {
  const fake = await startFakeSkins();
  fake.files.set('/texture/rot', { body: skin() });
  const service = await startService({ dev: true, sessionServer: fake.url, skinHosts: ['127.0.0.1'], publicHeadRateLimit: 12 });
  try {
    const anna = await devPlayer(service.url, 'Anna');
    fake.skinUrls.set(anna.uuid, `${fake.url}/texture/rot`);
    const head = (uuid: string, query = '') => rawRequest(service.url, 'GET', `/v1/public/heads/${uuid}.png${query}`);
    let res = await head(anna.uuid);
    assert.equal(res.status, 200);
    assert.deepEqual([res.headers['content-type'], res.headers['access-control-allow-origin'], res.headers['x-content-type-options']], ['image/png', '*', 'nosniff']);
    assert.match(String(res.headers['cache-control']), /public, max-age=3600/);
    const image = decodePng(res.body)!;
    assert.deepEqual([image.width, image.height], [64, 64]);
    assert.deepEqual([...image.data.subarray((12 * 64 + 12) * 4, (12 * 64 + 12) * 4 + 4)], [0, 200, 0, 255], 'Pixel (1,1) des Gesichts');
    for (const size of [32, 128]) assert.equal(decodePng((await head(anna.uuid, `?size=${size}`)).body)!.width, size);
    for (const bad of ['?size=16', '?size=abc', '?size=512']) assert.equal((await head(anna.uuid, bad)).status, 400, bad);
    // Zwischenspeicher: Mojang nur einmal gefragt
    const asked = fake.requests.filter((r) => r.includes(anna.uuid)).length;
    await head(anna.uuid);
    assert.equal(fake.requests.filter((r) => r.includes(anna.uuid)).length, asked);
    // Unbekannt, ungültig: 404 ohne Mojang zu fragen
    const before = fake.requests.length;
    assert.equal((await head(randomUuid())).status, 404);
    assert.equal((await head('kaputt')).status, 404);
    assert.equal(fake.requests.length, before);
    // Ohne Skin: Standard-Kopf
    const ben = await devPlayer(service.url, 'Ben');
    res = await head(ben.uuid);
    assert.equal(res.status, 200);
    assert.equal(decodePng(res.body)!.width, 64);
    // „Für andere erkennbar“ aus: 404, außer auf der Teamseite
    await api(service.url, 'PUT', '/v1/me', { token: ben.token, body: { visible: false } });
    assert.equal((await head(ben.uuid, '?size=32')).status, 404);
    addToTeam(service, ben, 'tester');
    const store = new Store(service.dataDir);
    store.setTeamProfile(ben.uuid, { public: true });
    store.close();
    assert.equal((await head(ben.uuid, '?size=32')).status, 200);
    // Grenze pro IP
    let limited = 0;
    for (let i = 0; i < 12; i++) if ((await head(anna.uuid)).status === 429) limited++;
    assert.ok(limited > 0, 'irgendwann 429');
  } finally {
    await service.close();
    await fake.close();
  }
});
