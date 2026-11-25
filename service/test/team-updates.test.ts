// Updates im Team-Bereich: Installer hochladen (gestreamt), Manifest mit Signatur prüfen und atomar veröffentlichen.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { SESSION_COOKIE } from '../src/web';
import { api, devPlayer, startService, waitFor, type TestService } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

function keyPair() {
  return generateKeyPairSync('ed25519');
}

/** update.json wie das Release-Skript des Launchers: Manifest-Text plus Ed25519-Signatur (base64). */
function updateJson(privateKey: KeyObject, version: string, data: Buffer, extra: Record<string, unknown> = {}) {
  const manifest = JSON.stringify({
    v: 1,
    version,
    file: `HeldixClient-Setup-${version}.exe`,
    size: data.length,
    sha512: createHash('sha512').update(data).digest('base64'),
    date: '2026-11-25',
    notes: ['Web-Login'],
    ...extra,
  });
  return { manifest, signature: sign(null, Buffer.from(manifest, 'utf8'), privateKey).toString('base64') };
}

/** Roher Upload wie von der Webseite (fetch mit Cookie und CSRF-Header). */
async function upload(service: TestService, cookie: string, file: string, data: Buffer, headers: Record<string, string> = {}) {
  const res = await fetch(`${service.url}/v1/team/updates/files/${file}`, {
    method: 'PUT',
    headers: { Cookie: `${SESSION_COOKIE}=${cookie}`, 'X-Heldix-Web': '1', 'Content-Type': 'application/octet-stream', ...headers },
    body: new Uint8Array(data),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? undefined : JSON.parse(text) };
}

describe('Updates im Team-Bereich', () => {
  const clock = new Clock();
  const keys = keyPair();
  let service: TestService;
  let dir: string;
  let cookie: string;
  let modCookie: string;
  const v1 = randomBytes(300_000);
  const v2 = randomBytes(200_000);

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-team-updates-'));
    service = await startService({
      dev: true,
      website: WEBSITE,
      totpNow: clock.read,
      updatesDir: dir,
      updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      maxUploadBytes: 1024 * 1024,
    });
    cookie = (await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock)).cookie;
    modCookie = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
  });
  after(async () => {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Übersicht leer, Upload gestreamt mit Größe und SHA-512, keine Reste', async () => {
    assert.deepEqual((await webApi(service, 'GET', '/v1/team/updates', { cookie })).body, { current: null, files: [] });
    const res = await upload(service, cookie, 'HeldixClient-Setup-1.0.0.exe', v1);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { file: 'HeldixClient-Setup-1.0.0.exe', size: v1.length, sha512: createHash('sha512').update(v1).digest('base64') });
    assert.deepEqual(fs.readFileSync(path.join(dir, 'HeldixClient-Setup-1.0.0.exe')), v1);
    assert.deepEqual(fs.readdirSync(dir), ['HeldixClient-Setup-1.0.0.exe'], 'kein .part übrig');
    const overview = await webApi(service, 'GET', '/v1/team/updates', { cookie });
    assert.deepEqual(overview.body.files.map((f: { file: string; size: number }) => [f.file, f.size]), [['HeldixClient-Setup-1.0.0.exe', v1.length]]);
    assert.equal(typeof overview.body.files[0].uploadedAt, 'number');

    assert.equal((await upload(service, cookie, 'setup.exe', v1)).status, 400);
    assert.equal((await upload(service, cookie, 'HeldixClient-Setup-1.0.exe', v1)).status, 400);
    // Über der Grenze (im Test 1 MB): 413, ohne die Datei anzulegen.
    const big = await upload(service, cookie, 'HeldixClient-Setup-9.0.0.exe', randomBytes(1024 * 1024 + 1));
    assert.equal(big.status, 413);
    assert.equal(fs.existsSync(path.join(dir, 'HeldixClient-Setup-9.0.0.exe')), false);
    assert.equal(fs.existsSync(path.join(dir, 'HeldixClient-Setup-9.0.0.exe.part')), false);
    // Ohne CSRF-Header: 403; als Moderator: forbidden.
    assert.equal((await upload(service, cookie, 'HeldixClient-Setup-1.0.1.exe', v1, { 'X-Heldix-Web': '0' })).status, 403);
    const mod = await upload(service, modCookie, 'HeldixClient-Setup-1.0.1.exe', v1);
    assert.deepEqual([mod.status, mod.body.code], [403, 'forbidden']);
  });

  test('Manifest: nur mit gültiger Signatur, passender Datei und höherer Version', async () => {
    const put = (body: unknown) => webApi(service, 'PUT', '/v1/team/updates/manifest', { cookie, body });
    const good = updateJson(keys.privateKey, '1.0.0', v1);

    // Falscher Schlüssel und verfälschtes Manifest: 400
    const foreign = updateJson(keyPair().privateKey, '1.0.0', v1);
    let res = await put(foreign);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Signatur/);
    res = await put({ manifest: good.manifest.replace('Web-Login', 'Boese'), signature: good.signature });
    assert.equal(res.status, 400);
    for (const body of [{}, { manifest: good.manifest }, { manifest: '{kaputt', signature: good.signature }, { manifest: good.manifest, signature: '' }]) {
      assert.equal((await put(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    // Richtig signiert, aber Inhalt falsch: Dateiname zur Version, Größe, Prüfsumme, fehlende Datei.
    res = await put(updateJson(keys.privateKey, '1.0.0', v1, { file: 'HeldixClient-Setup-1.0.1.exe' }));
    assert.equal(res.status, 400);
    res = await put(updateJson(keys.privateKey, '1.0.0', v1, { size: v1.length + 1 }));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Byte groß/);
    res = await put(updateJson(keys.privateKey, '1.0.0', v1, { sha512: createHash('sha512').update('anders').digest('base64') }));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Prüfsumme/);
    res = await put(updateJson(keys.privateKey, '1.0.0', v1, { sha512: 'kurz' }));
    assert.equal(res.status, 400);
    res = await put(updateJson(keys.privateKey, '2.0.0', v2));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /zuerst hochladen/);
    assert.equal(fs.existsSync(path.join(dir, 'update.json')), false, 'nichts veröffentlicht');

    res = await put(good);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { current: JSON.parse(good.manifest) });
    // Für den Launcher sofort sichtbar, mit genau dem signierten Text.
    const latest = await api(service.url, 'GET', '/v1/launcher/latest');
    assert.deepEqual(latest.body, good);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['HeldixClient-Setup-1.0.0.exe', 'update.json'], 'keine temporären Dateien');
    assert.deepEqual((await webApi(service, 'GET', '/v1/team/updates', { cookie })).body.current, JSON.parse(good.manifest));

    // Gleiche oder niedrigere Version: 409; Vorabversion unter der fertigen auch.
    assert.equal((await put(good)).status, 409);
    assert.equal((await upload(service, cookie, 'HeldixClient-Setup-1.0.0-beta.1.exe', v2)).status, 200);
    res = await put(updateJson(keys.privateKey, '1.0.0-beta.1', v2));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /nicht höher/);

    // Der veröffentlichte Installer lässt sich weder ersetzen noch löschen.
    assert.equal((await upload(service, cookie, 'HeldixClient-Setup-1.0.0.exe', v2)).status, 409);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/updates/files/HeldixClient-Setup-1.0.0.exe', { cookie })).status, 409);

    // Neue Version: hochladen, veröffentlichen, alte Datei löschen.
    assert.equal((await upload(service, cookie, 'HeldixClient-Setup-1.1.0.exe', v2)).status, 200);
    const next = updateJson(keys.privateKey, '1.1.0', v2);
    assert.equal((await put(next)).status, 200);
    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/latest')).body, next);
    const removed = await webApi(service, 'DELETE', '/v1/team/updates/files/HeldixClient-Setup-1.0.0.exe', { cookie });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.files.map((f: { file: string }) => f.file).sort(), ['HeldixClient-Setup-1.0.0-beta.1.exe', 'HeldixClient-Setup-1.1.0.exe']);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/updates/files/HeldixClient-Setup-1.0.0.exe', { cookie })).status, 404);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/updates/files/update.json', { cookie })).status, 404);

    const audit = (await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries;
    const actions = audit.map((e: { action: string; target: string }) => `${e.action} ${e.target}`);
    for (const entry of ['update.upload HeldixClient-Setup-1.1.0.exe', 'update.publish HeldixClient-Setup-1.1.0.exe', 'update.delete HeldixClient-Setup-1.0.0.exe']) {
      assert.ok(actions.includes(entry), entry);
    }
  });
});

test('ohne Update-Schlüssel: Veröffentlichen im Browser 503, Hochladen geht', async () => {
  const clock = new Clock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-team-updates-'));
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, updatesDir: dir });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const data = randomBytes(1000);
    assert.equal((await upload(service, cookie, 'HeldixClient-Setup-1.0.0.exe', data)).status, 200);
    const res = await webApi(service, 'PUT', '/v1/team/updates/manifest', { cookie, body: updateJson(keyPair().privateKey, '1.0.0', data) });
    assert.equal(res.status, 503);
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Upload, bei dem nichts mehr ankommt (hier 200 ms): abgebrochen, keine halbe Datei', async () => {
  const clock = new Clock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-team-updates-'));
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, updatesDir: dir, uploadIdleTimeoutMs: 200 });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const { hostname, port } = new URL(service.url);
    const closed = await new Promise<string>((resolve) => {
      const req = httpRequest({
        host: hostname,
        port,
        method: 'PUT',
        path: '/v1/team/updates/files/HeldixClient-Setup-3.0.0.exe',
        headers: { Cookie: `${SESSION_COOKIE}=${cookie}`, 'X-Heldix-Web': '1', 'Content-Length': '100000' },
      });
      req.on('response', (res) => resolve(`Antwort ${res.statusCode}`));
      req.on('error', (err) => resolve(`getrennt (${(err as NodeJS.ErrnoException).code})`));
      req.write(Buffer.alloc(1000));
      // danach nichts mehr
    });
    assert.ok(closed.startsWith('getrennt') || closed === 'Antwort 400', closed);
    await waitFor(() => fs.readdirSync(dir).length === 0);
    // Danach geht derselbe Upload normal.
    assert.equal((await upload(service, cookie, 'HeldixClient-Setup-3.0.0.exe', randomBytes(500))).status, 200);
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
