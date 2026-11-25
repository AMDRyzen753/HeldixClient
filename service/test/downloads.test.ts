// Downloads für Windows und macOS vom eigenen Server: Namen, Content-Types, latest/<ziel>, Dateiliste mit SHA-256,
// Schutz des Ordners, Team-Upload und -Löschen der Mac-Dateien, Grenzen.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { parseDownloadName } from '../src/updates';
import { SESSION_COOKIE } from '../src/web';
import { api, devPlayer, rawRequest, startService, type TestService } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function publishWindows(dir: string, version: string, data: Buffer): void {
  const file = `HeldixClient-Setup-${version}.exe`;
  fs.writeFileSync(path.join(dir, file), data);
  const manifest = JSON.stringify({ v: 1, version, file, size: data.length, sha512: createHash('sha512').update(data).digest('base64'), date: '2026-11-25', notes: [] });
  fs.writeFileSync(path.join(dir, 'update.json'), JSON.stringify({ manifest, signature: 'c2ln' }));
}

test('Dateinamen: Windows-Installer und Mac-Dateien, sonst nichts', () => {
  assert.deepEqual(parseDownloadName('HeldixClient-Setup-0.12.1.exe'), { platform: 'windows', arch: 'x64', kind: 'exe', version: '0.12.1' });
  assert.deepEqual(parseDownloadName('HeldixClient-0.12.1-mac-arm64.dmg'), { platform: 'mac', arch: 'arm64', kind: 'dmg', version: '0.12.1' });
  assert.deepEqual(parseDownloadName('HeldixClient-0.12.1-mac-x64.zip'), { platform: 'mac', arch: 'x64', kind: 'zip', version: '0.12.1' });
  assert.deepEqual(parseDownloadName('HeldixClient-1.0.0-beta.2-mac-arm64.dmg'), { platform: 'mac', arch: 'arm64', kind: 'dmg', version: '1.0.0-beta.2' });
  for (const bad of [
    'HeldixClient-0.12.1-mac-ppc.dmg',
    'HeldixClient-0.12.1-mac-arm64.pkg',
    'HeldixClient-0.12.1-mac-arm64.dmg.part',
    'HeldixClient-0.12-mac-arm64.dmg',
    'heldixclient-0.12.1-mac-arm64.dmg',
    'HeldixClient-0.12.1-mac-ARM64.dmg',
    'HeldixClient-0.12.1-linux-x64.zip',
    'HeldixClient-0.12.1.exe',
    'HeldixClient-Setup-0.12.1.dmg',
    '../HeldixClient-0.12.1-mac-arm64.dmg',
    'sub/HeldixClient-0.12.1-mac-arm64.dmg',
    'update.json',
  ]) {
    assert.equal(parseDownloadName(bad), null, bad);
  }
});

describe('Downloads für alle Systeme', () => {
  let service: TestService;
  let dir: string;
  const files: Record<string, Buffer> = {
    'HeldixClient-1.0.0-mac-arm64.dmg': randomBytes(3000),
    'HeldixClient-1.2.0-mac-arm64.dmg': randomBytes(3100),
    'HeldixClient-1.10.0-mac-arm64.dmg': randomBytes(3200),
    'HeldixClient-1.10.0-beta.1-mac-arm64.dmg': randomBytes(3300),
    'HeldixClient-1.10.0-mac-arm64.zip': randomBytes(2000),
    // Nur eine zip in einer höheren Version: zählt für latest (dmg) nicht.
    'HeldixClient-2.0.0-mac-x64.zip': randomBytes(2100),
    'HeldixClient-1.9.0-mac-x64.zip': randomBytes(2200),
  };

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-downloads-'));
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data);
    service = await startService({ updatesDir: dir });
  });
  after(async () => {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Content-Type je Art, HEAD, Range, Dateiname', async () => {
    const dmg = await rawRequest(service.url, 'GET', '/v1/launcher/download/HeldixClient-1.2.0-mac-arm64.dmg');
    assert.equal(dmg.status, 200);
    assert.equal(dmg.headers['content-type'], 'application/x-apple-diskimage');
    assert.equal(dmg.headers['content-disposition'], 'attachment; filename="HeldixClient-1.2.0-mac-arm64.dmg"');
    assert.equal(dmg.headers['access-control-allow-origin'], '*');
    assert.deepEqual(dmg.body, files['HeldixClient-1.2.0-mac-arm64.dmg']);
    const zip = await rawRequest(service.url, 'HEAD', '/v1/launcher/download/HeldixClient-1.9.0-mac-x64.zip');
    assert.deepEqual([zip.status, zip.headers['content-type'], zip.headers['content-length'], zip.body.length], [200, 'application/zip', '2200', 0]);
    const part = await rawRequest(service.url, 'GET', '/v1/launcher/download/HeldixClient-1.10.0-mac-arm64.zip', { Range: 'bytes=10-19' });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], 'bytes 10-19/2000');
    assert.deepEqual(part.body, files['HeldixClient-1.10.0-mac-arm64.zip']!.subarray(10, 20));
    // Windows wie bisher
    publishWindows(dir, '0.12.1', randomBytes(1500));
    const exe = await rawRequest(service.url, 'GET', '/v1/launcher/download/HeldixClient-Setup-0.12.1.exe');
    assert.equal(exe.headers['content-type'], 'application/vnd.microsoft.portable-executable');
  });

  test('latest/<ziel>: Windows aus dem Manifest, Mac höchste dmg-Version des Prozessors, sonst 404', async () => {
    const latest = async (target: string, method = 'GET') => rawRequest(service.url, method, `/v1/launcher/download/latest/${target}`);
    let res = await latest('mac-arm64');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/v1/launcher/download/HeldixClient-1.10.0-mac-arm64.dmg', '1.10.0 > 1.10.0-beta.1 > 1.2.0');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal((await latest('mac-arm64', 'HEAD')).status, 302);
    res = await latest('windows');
    assert.equal(res.headers.location, '/v1/launcher/download/HeldixClient-Setup-0.12.1.exe');
    // Bisheriger Weg bleibt gleich.
    assert.equal((await rawRequest(service.url, 'GET', '/v1/launcher/download/latest')).headers.location, '/v1/launcher/download/HeldixClient-Setup-0.12.1.exe');
    for (const target of ['mac-x64', 'linux', 'mac', 'MAC-ARM64']) {
      res = await latest(target);
      assert.equal(res.status, 404, target);
      assert.equal(JSON.parse(res.body.toString('utf8')).error, 'Für dieses System gibt es noch keinen Download.');
      assert.equal(res.headers['access-control-allow-origin'], '*');
    }
    // fetch folgt der Weiterleitung bis zur Datei.
    const followed = await fetch(`${service.url}/v1/launcher/download/latest/mac-arm64`);
    assert.deepEqual(Buffer.from(await followed.arrayBuffer()), files['HeldixClient-1.10.0-mac-arm64.dmg']);
  });

  test('files: neueste je System, Prozessor und Art mit SHA-256; zwischengespeichert nach Name, Größe und Änderungszeit', async () => {
    // Änderungszeit auf ganze Sekunden, damit sie sich unten genau wiederherstellen lässt.
    const file = path.join(dir, 'HeldixClient-1.10.0-mac-arm64.dmg');
    const mtime = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    fs.utimesSync(file, mtime, mtime);
    let res = await api(service.url, 'GET', '/v1/launcher/files');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'max-age=60');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.body.version, '0.12.1');
    assert.deepEqual(
      res.body.files.map((f: { file: string; platform: string; arch: string; kind: string; version: string }) => [f.file, f.platform, f.arch, f.kind, f.version]),
      [
        ['HeldixClient-Setup-0.12.1.exe', 'windows', 'x64', 'exe', '0.12.1'],
        ['HeldixClient-1.10.0-mac-arm64.dmg', 'mac', 'arm64', 'dmg', '1.10.0'],
        ['HeldixClient-1.10.0-mac-arm64.zip', 'mac', 'arm64', 'zip', '1.10.0'],
        ['HeldixClient-2.0.0-mac-x64.zip', 'mac', 'x64', 'zip', '2.0.0'],
      ],
    );
    const entry = res.body.files[1];
    assert.deepEqual(Object.keys(entry).sort(), ['arch', 'file', 'kind', 'platform', 'sha256', 'size', 'uploadedAt', 'version']);
    assert.equal(entry.sha256, sha256(files['HeldixClient-1.10.0-mac-arm64.dmg']!));
    assert.equal(entry.size, 3200);
    assert.equal(typeof entry.uploadedAt, 'number');

    // Gleicher Name, gleiche Größe, gleiche Änderungszeit: der gespeicherte Wert (die Datei wird nicht neu gelesen).
    const changed = randomBytes(3200);
    fs.writeFileSync(file, changed);
    fs.utimesSync(file, mtime, mtime);
    res = await api(service.url, 'GET', '/v1/launcher/files');
    assert.equal(res.body.files[1].sha256, entry.sha256, 'aus dem Zwischenspeicher');
    // Andere Änderungszeit: neu berechnet.
    const later = new Date(mtime.getTime() + 10_000);
    fs.utimesSync(file, later, later);
    res = await api(service.url, 'GET', '/v1/launcher/files');
    assert.equal(res.body.files[1].sha256, sha256(changed));
  });

  test('kein Weg aus dem Ordner mit den neuen Mustern; Grenze pro IP gilt auch für Mac-Dateien', async () => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-HeldixClient-9.9.9-mac-arm64.dmg`);
    fs.writeFileSync(outside, 'geheim');
    fs.mkdirSync(path.join(dir, 'HeldixClient-3.0.0-mac-arm64.dmg'));
    try {
      for (const p of [
        `/v1/launcher/download/..%2F${path.basename(outside)}`,
        '/v1/launcher/download/HeldixClient-1.2.0-mac-arm64.dmg%2F..%2F..%2Fx',
        '/v1/launcher/download/HeldixClient-1.2.0-mac-arm64.dmg.part',
        '/v1/launcher/download/HeldixClient-1.2.0-mac-ppc.dmg',
        '/v1/launcher/download/HeldixClient-1.2.0-mac-arm64.pkg',
        '/v1/launcher/download/heldixclient-1.2.0-mac-arm64.dmg',
        '/v1/launcher/download/HeldixClient-3.0.0-mac-arm64.dmg',
        '/v1/launcher/download/latest/..%2Fmac-arm64',
        '/v1/launcher/download/latest/mac-arm64/x',
      ]) {
        const res = await rawRequest(service.url, 'GET', p);
        assert.equal(res.status, 404, p);
        assert.equal(res.body.includes('geheim'), false, p);
      }
      // Ein Ordner mit Mac-Namen wird nicht als neueste Datei angeboten.
      assert.equal((await rawRequest(service.url, 'GET', '/v1/launcher/download/latest/mac-arm64')).headers.location, '/v1/launcher/download/HeldixClient-1.10.0-mac-arm64.dmg');
    } finally {
      fs.rmSync(outside, { force: true });
      fs.rmdirSync(path.join(dir, 'HeldixClient-3.0.0-mac-arm64.dmg'));
    }
    const limited = await startService({ updatesDir: dir, downloadRateLimit: 2 });
    try {
      const url = '/v1/launcher/download/HeldixClient-1.9.0-mac-x64.zip';
      assert.equal((await rawRequest(limited.url, 'GET', url)).status, 200);
      assert.equal((await rawRequest(limited.url, 'GET', url)).status, 200);
      assert.equal((await rawRequest(limited.url, 'GET', url)).status, 429);
    } finally {
      await limited.close();
    }
  });
});

test('Team-Bereich: Mac-Dateien hochladen und löschen; Liste mit System, Prozessor, Art und Version', async () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-downloads-team-'));
  const service = await startService({
    dev: true,
    website: WEBSITE,
    totpNow: clock.read,
    updatesDir: dir,
    updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    maxUploadBytes: 64 * 1024,
  });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const modCookie = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
    const upload = async (name: string, data: Buffer, as = cookie) => {
      const res = await fetch(`${service.url}/v1/team/updates/files/${name}`, {
        method: 'PUT',
        headers: { Cookie: `${SESSION_COOKIE}=${as}`, 'X-Heldix-Web': '1', 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(data),
      });
      return { status: res.status, body: JSON.parse((await res.text()) || 'null') };
    };
    const older = randomBytes(5000);
    const newer = randomBytes(6000);
    let res = await upload('HeldixClient-1.0.0-mac-arm64.dmg', older);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.file, res.body.size], ['HeldixClient-1.0.0-mac-arm64.dmg', 5000]);
    assert.equal((await upload('HeldixClient-1.1.0-mac-arm64.dmg', newer)).status, 200);
    assert.equal((await upload('HeldixClient-1.1.0-mac-arm64.zip', newer)).status, 200);
    assert.equal(fs.readdirSync(dir).some((f) => f.endsWith('.part')), false);
    for (const bad of ['HeldixClient-1.1.0-mac-ppc.dmg', 'HeldixClient-1.1.0-mac-arm64.pkg', 'HeldixClient-1.1.0.dmg']) {
      assert.equal((await upload(bad, newer)).status, 400, bad);
    }
    assert.equal((await upload('HeldixClient-2.0.0-mac-x64.dmg', randomBytes(64 * 1024 + 1))).status, 413);
    assert.deepEqual([(await upload('HeldixClient-2.0.0-mac-x64.dmg', newer, modCookie)).body.code], ['forbidden']);

    // SHA-256 ist schon beim Upload berechnet.
    const listed = await api(service.url, 'GET', '/v1/launcher/files');
    assert.deepEqual(listed.body.files.map((f: { file: string; sha256: string }) => [f.file, f.sha256]), [
      ['HeldixClient-1.1.0-mac-arm64.dmg', sha256(newer)],
      ['HeldixClient-1.1.0-mac-arm64.zip', sha256(newer)],
    ]);
    assert.equal(listed.body.version, null);

    const overview = await webApi(service, 'GET', '/v1/team/updates', { cookie });
    const dmg = overview.body.files.find((f: { file: string }) => f.file === 'HeldixClient-1.1.0-mac-arm64.dmg');
    assert.deepEqual(Object.keys(dmg).sort(), ['arch', 'file', 'kind', 'platform', 'size', 'uploadedAt', 'version']);
    assert.deepEqual([dmg.platform, dmg.arch, dmg.kind, dmg.version, dmg.size], ['mac', 'arm64', 'dmg', '1.1.0', 6000]);

    // Die gerade angebotene Mac-Datei lässt sich löschen; danach zeigt latest auf die nächstältere.
    assert.equal((await rawRequest(service.url, 'GET', '/v1/launcher/download/latest/mac-arm64')).headers.location, '/v1/launcher/download/HeldixClient-1.1.0-mac-arm64.dmg');
    res = await webApi(service, 'DELETE', '/v1/team/updates/files/HeldixClient-1.1.0-mac-arm64.dmg', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.files.some((f: { file: string }) => f.file === 'HeldixClient-1.1.0-mac-arm64.dmg'), false);
    assert.equal((await rawRequest(service.url, 'GET', '/v1/launcher/download/latest/mac-arm64')).headers.location, '/v1/launcher/download/HeldixClient-1.0.0-mac-arm64.dmg');
    assert.equal((await webApi(service, 'DELETE', '/v1/team/updates/files/HeldixClient-1.1.0-mac-arm64.dmg', { cookie })).status, 404);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/updates/files/HeldixClient-1.0.0-mac-arm64.dmg', { cookie })).status, 200);
    assert.equal((await rawRequest(service.url, 'GET', '/v1/launcher/download/latest/mac-arm64')).status, 404);

    // Der Windows-Installer aus dem Manifest bleibt geschützt.
    const exe = randomBytes(4000);
    assert.equal((await upload('HeldixClient-Setup-1.1.0.exe', exe)).status, 200);
    const manifest = JSON.stringify({ v: 1, version: '1.1.0', file: 'HeldixClient-Setup-1.1.0.exe', size: exe.length, sha512: createHash('sha512').update(exe).digest('base64'), date: '2026-11-25', notes: [] });
    const signature = sign(null, Buffer.from(manifest), keys.privateKey).toString('base64');
    assert.equal((await webApi(service, 'PUT', '/v1/team/updates/manifest', { cookie, body: { manifest, signature } })).status, 200);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/updates/files/HeldixClient-Setup-1.1.0.exe', { cookie })).status, 409);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/files')).body.version, '1.1.0');

    const actions = (await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries.map((e: { action: string; target: string }) => `${e.action} ${e.target}`);
    for (const entry of ['update.upload HeldixClient-1.1.0-mac-arm64.dmg', 'update.delete HeldixClient-1.1.0-mac-arm64.dmg', 'update.upload HeldixClient-1.1.0-mac-arm64.zip']) {
      assert.ok(actions.includes(entry), entry);
    }
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
