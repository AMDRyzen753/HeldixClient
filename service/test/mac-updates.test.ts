// Mac-Updates (ab 1.13.0): update-mac.json mit einer ZIP je Prozessor – Prüfen der Form, GET /v1/launcher/latest/mac
// (erst wenn beide ZIPs vollständig da sind), Dateiliste und Versionsverlauf, Veröffentlichen im Team-Bereich.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { checkMacUpdateObject, isMacUpdateObject, parseMacUpdateJson } from '../src/updates';
import { SESSION_COOKIE } from '../src/web';
import { api, devPlayer, rawRequest, startService, type TestService } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

const NOTHING_MAC = 'Noch keine Mac-Version veröffentlicht.';
const sha512 = (data: Buffer) => createHash('sha512').update(data).digest('base64');
const zipName = (version: string, arch: string) => `HeldixClient-${version}-mac-${arch}.zip`;

/** `files` wie `npm run release:mac`: je Prozessor Name, Größe und SHA-512 der ZIP. */
function macFiles(version: string, arm64: Buffer, x64: Buffer) {
  return {
    arm64: { file: zipName(version, 'arm64'), size: arm64.length, sha512: sha512(arm64) },
    x64: { file: zipName(version, 'x64'), size: x64.length, sha512: sha512(x64) },
  };
}

function macManifest(version: string, files: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 2, platform: 'mac', version, date: '2026-11-28T10:00:00.000Z', notes: ['Mac: Updates von selbst'], files, ...extra });
}

/** update-mac.json: Manifest-Text plus Ed25519-Signatur (Base64) über genau diesen Text. */
function signed(privateKey: KeyObject, manifest: string) {
  return { manifest, signature: sign(null, Buffer.from(manifest, 'utf8'), privateKey).toString('base64') };
}

/** Schreibt update-mac.json und setzt die Änderungszeit (damit der Dienst neu liest). */
function writeMacJson(dir: string, text: string, mtime: Date): void {
  const file = path.join(dir, 'update-mac.json');
  fs.writeFileSync(file, text);
  fs.utimesSync(file, mtime, mtime);
}

test('Form von update-mac.json: wie im Launcher, beide ZIPs Pflicht', () => {
  const keys = generateKeyPairSync('ed25519');
  const files = macFiles('0.14.0', randomBytes(100), randomBytes(200));
  const good = signed(keys.privateKey, macManifest('0.14.0', files));
  const checked = checkMacUpdateObject(good);
  assert.ok(typeof checked !== 'string', String(checked));
  assert.deepEqual([checked.version, checked.manifest, checked.signature, checked.files], ['0.14.0', good.manifest, good.signature, files]);
  // Mit BOM (manche Editoren) geht es auch.
  assert.equal(typeof parseMacUpdateJson(`﻿${JSON.stringify(good)}`), 'object');

  const withFiles = (patch: Record<string, unknown>) => macManifest('0.14.0', { ...files, ...patch });
  const cases: [unknown, string][] = [
    [[], 'kein JSON-Objekt'],
    [{ manifest: good.manifest }, '„signature“ fehlt'],
    [{ manifest: '{kaputt', signature: 'x' }, '„manifest“ ist kein gültiges JSON'],
    [{ manifest: macManifest('0.14.0', files, { v: 1 }), signature: 'x' }, '„v“ im Manifest ist nicht 2'],
    [{ manifest: macManifest('0.14.0', files, { platform: 'windows' }), signature: 'x' }, '„platform“'],
    [{ manifest: macManifest('0.14', files), signature: 'x' }, '„version“'],
    [{ manifest: macManifest('0.14.0', files, { files: [] }), signature: 'x' }, '„files“ im Manifest fehlt'],
    [{ manifest: macManifest('0.14.0', { arm64: files.arm64 }), signature: 'x' }, '„files.x64“ im Manifest fehlt'],
    [{ manifest: withFiles({ arm64: { ...files.arm64, file: zipName('0.13.0', 'arm64') } }), signature: 'x' }, '„files.arm64.file“'],
    [{ manifest: withFiles({ x64: { ...files.x64, file: '../HeldixClient-0.14.0-mac-x64.zip' } }), signature: 'x' }, '„files.x64.file“'],
    [{ manifest: withFiles({ x64: { ...files.x64, file: 'HeldixClient-0.14.0-mac-x64.dmg' } }), signature: 'x' }, '„files.x64.file“'],
    [{ manifest: withFiles({ x64: { ...files.x64, size: 0 } }), signature: 'x' }, '„files.x64.size“'],
    [{ manifest: withFiles({ x64: { ...files.x64, size: '200' } }), signature: 'x' }, '„files.x64.size“'],
    [{ manifest: withFiles({ x64: { ...files.x64, size: 1024 * 1024 * 1024 + 1 } }), signature: 'x' }, '„files.x64.size“'],
    [{ manifest: withFiles({ arm64: { ...files.arm64, sha512: 'kurz' } }), signature: 'x' }, '„files.arm64.sha512“'],
  ];
  for (const [input, reason] of cases) {
    const result = checkMacUpdateObject(input);
    assert.equal(typeof result, 'string', JSON.stringify(input).slice(0, 80));
    assert.ok((result as string).includes(reason), `${String(result)} sollte „${reason}“ enthalten`);
  }
  assert.equal(parseMacUpdateJson('{ kaputt'), 'kein gültiges JSON');

  // Erkennen im Team-Bereich: update-mac.json, nicht update.json oder ein Addon
  assert.equal(isMacUpdateObject(good), true);
  assert.equal(isMacUpdateObject({ manifest: JSON.stringify({ v: 2 }), signature: 'x' }), true);
  const windows = JSON.stringify({ v: 1, version: '0.14.0', file: 'HeldixClient-Setup-0.14.0.exe', size: 1, sha512: sha512(Buffer.from('x')) });
  for (const other of [{ manifest: windows, signature: 'x' }, {}, { manifest: '{kaputt' }, { manifest: JSON.stringify({ type: 'heldix-addon' }) }, null, 'text']) {
    assert.equal(isMacUpdateObject(other), false, JSON.stringify(other));
  }
});

describe('Mac-Updates: update-mac.json im Update-Ordner (scp)', () => {
  const keys = generateKeyPairSync('ed25519');
  let service: TestService;
  let dir: string;
  let clock = Date.now() - 3_600_000;
  const nextTime = () => new Date((clock += 5000));
  const arm = randomBytes(3000);
  const x64 = randomBytes(3500);

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-mac-updates-'));
    service = await startService({ updatesDir: dir });
  });
  after(async () => {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ohne update-mac.json: 404 mit Meldung und CORS; files nennt die Mac-Version nach Dateinamen', async () => {
    const res = await api(service.url, 'GET', '/v1/launcher/latest/mac');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: NOTHING_MAC });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal((await api(service.url, 'POST', '/v1/launcher/latest/mac')).status, 405);

    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/files')).body, { version: null, mac: null, files: [] });
    fs.writeFileSync(path.join(dir, zipName('0.13.0', 'arm64')), randomBytes(100));
    fs.writeFileSync(path.join(dir, 'HeldixClient-0.13.5-mac-x64.dmg'), randomBytes(100));
    const files = await api(service.url, 'GET', '/v1/launcher/files');
    assert.equal(files.body.mac, '0.13.5', 'höchste Version unter den Mac-Dateien');
    assert.equal(files.body.version, null);
  });

  test('gilt erst, wenn beide ZIPs vollständig da sind; dann genau der Text, no-cache und CORS; Versionsverlauf', async () => {
    const good = signed(keys.privateKey, macManifest('0.14.0', macFiles('0.14.0', arm, x64)));
    const latest = () => api(service.url, 'GET', '/v1/launcher/latest/mac');
    fs.writeFileSync(path.join(dir, zipName('0.14.0', 'arm64')), arm);
    writeMacJson(dir, JSON.stringify(good), nextTime());
    let res = await latest();
    assert.deepEqual([res.status, res.body], [404, { error: NOTHING_MAC }]);
    assert.ok(service.logs.some((l) => l.includes(`update-mac.json nennt ${zipName('0.14.0', 'x64')}, die Datei fehlt aber`)));
    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/versions')).body.versions, [], 'noch nicht veröffentlicht');

    // Intel-ZIP halb hochgeladen
    fs.writeFileSync(path.join(dir, zipName('0.14.0', 'x64')), x64.subarray(0, 1000));
    writeMacJson(dir, `${JSON.stringify(good, null, 2)}\n`, nextTime());
    res = await latest();
    assert.equal(res.status, 404);
    assert.ok(service.logs.some((l) => l.includes('Upload noch nicht fertig?')));

    fs.writeFileSync(path.join(dir, zipName('0.14.0', 'x64')), x64);
    res = await latest();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, good);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.ok(service.logs.some((l) => l.includes('Mac-Launcher-Version 0.14.0 ist veröffentlicht')));
    // Windows bleibt davon unberührt.
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 404);

    // Versionsverlauf: die Mac-Version mit Datum und Hinweisen aus dem Manifest, einmal
    const versions = (await api(service.url, 'GET', '/v1/launcher/versions')).body.versions;
    assert.deepEqual(versions.map((v: { version: string; date: string; notes: string[] }) => [v.version, v.date, v.notes]), [
      ['0.14.0', '2026-11-28T10:00:00.000Z', ['Mac: Updates von selbst']],
    ]);

    // ZIPs weiter über /v1/launcher/download/<Datei>
    const zip = await rawRequest(service.url, 'GET', `/v1/launcher/download/${zipName('0.14.0', 'x64')}`);
    assert.deepEqual([zip.status, zip.headers['content-type']], [200, 'application/zip']);
    assert.deepEqual(zip.body, x64);
  });

  test('files: ZIPs und mac-Version aus update-mac.json, auch wenn eine höhere ZIP herumliegt', async () => {
    fs.writeFileSync(path.join(dir, zipName('0.15.0', 'arm64')), randomBytes(500));
    const res = await api(service.url, 'GET', '/v1/launcher/files');
    assert.equal(res.body.mac, '0.14.0');
    assert.deepEqual(
      res.body.files.map((f: { file: string; version: string }) => [f.file, f.version]),
      [
        [zipName('0.14.0', 'arm64'), '0.14.0'],
        ['HeldixClient-0.13.5-mac-x64.dmg', '0.13.5'],
        [zipName('0.14.0', 'x64'), '0.14.0'],
      ],
    );
    // Ohne update-mac.json wieder nach Dateinamen
    fs.renameSync(path.join(dir, 'update-mac.json'), path.join(dir, 'update-mac.json.bak'));
    try {
      const plain = await api(service.url, 'GET', '/v1/launcher/files');
      assert.equal(plain.body.mac, '0.15.0');
      assert.equal(plain.body.files.find((f: { arch: string; kind: string }) => f.arch === 'arm64' && f.kind === 'zip').file, zipName('0.15.0', 'arm64'));
      assert.equal((await api(service.url, 'GET', '/v1/launcher/latest/mac')).status, 404);
    } finally {
      fs.renameSync(path.join(dir, 'update-mac.json.bak'), path.join(dir, 'update-mac.json'));
      fs.rmSync(path.join(dir, zipName('0.15.0', 'arm64')));
    }
  });

  test('ungültige update-mac.json: 404 und ein Eintrag im Log, einmal je Datei', async () => {
    const files = macFiles('0.14.0', arm, x64);
    const cases: [string, string][] = [
      ['{ kaputt', 'kein gültiges JSON'],
      [JSON.stringify({ manifest: macManifest('0.14.0', files, { v: 1 }), signature: 'x' }), '„v“ im Manifest ist nicht 2'],
      [JSON.stringify({ manifest: macManifest('0.14.0', { arm64: files.arm64 }), signature: 'x' }), '„files.x64“ im Manifest fehlt'],
      [JSON.stringify({ manifest: macManifest('0.14.0', files), signature: 'x', pad: 'x'.repeat(70 * 1024) }), 'größer als 64 KB'],
    ];
    for (const [text, logPart] of cases) {
      writeMacJson(dir, text, nextTime());
      const res = await api(service.url, 'GET', '/v1/launcher/latest/mac');
      assert.deepEqual([res.status, res.body], [404, { error: NOTHING_MAC }], text.slice(0, 60));
      assert.ok(service.logs.some((l) => l.includes(`update-mac.json im Update-Ordner ist ungültig (${logPart}`)), `Log fehlt: ${logPart}`);
    }
    const count = service.logs.length;
    await api(service.url, 'GET', '/v1/launcher/latest/mac');
    await api(service.url, 'GET', '/v1/launcher/files');
    assert.equal(service.logs.length, count);
    // Gültig wieder: sofort da, ohne Neustart
    writeMacJson(dir, JSON.stringify(signed(keys.privateKey, macManifest('0.14.0', files))), nextTime());
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest/mac')).status, 200);
  });
});

/** Roher Upload wie von der Webseite (fetch mit Cookie und CSRF-Header). */
async function upload(service: TestService, cookie: string, file: string, data: Buffer) {
  const res = await fetch(`${service.url}/v1/team/updates/files/${file}`, {
    method: 'PUT',
    headers: { Cookie: `${SESSION_COOKIE}=${cookie}`, 'X-Heldix-Web': '1', 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(data),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? undefined : JSON.parse(text) };
}

test('Team-Bereich: update-mac.json veröffentlichen – Form, Signatur, ZIPs, höhere Version, atomar, geschützt, Protokoll', async () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-mac-team-'));
  const service = await startService({
    dev: true,
    website: WEBSITE,
    totpNow: clock.read,
    updatesDir: dir,
    updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    maxUploadBytes: 1024 * 1024,
  });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const modCookie = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
    const put = (body: unknown, as = cookie) => webApi(service, 'PUT', '/v1/team/updates/manifest', { cookie: as, body });
    assert.deepEqual((await webApi(service, 'GET', '/v1/team/updates', { cookie })).body, { current: null, files: [], mac: null });

    const arm = randomBytes(40_000);
    const x64 = randomBytes(50_000);
    assert.equal((await upload(service, cookie, zipName('0.14.0', 'arm64'), arm)).status, 200);
    assert.equal((await upload(service, cookie, zipName('0.14.0', 'x64'), x64)).status, 200);
    const files = macFiles('0.14.0', arm, x64);
    const good = signed(keys.privateKey, macManifest('0.14.0', files));

    // Signatur: fremder Schlüssel, verfälschter Text, kaputte Signatur
    let res = await put(signed(generateKeyPairSync('ed25519').privateKey, good.manifest));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Signatur/);
    res = await put({ manifest: good.manifest.replace('von selbst', 'Boese'), signature: good.signature });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Signatur/);
    assert.equal((await put({ manifest: good.manifest, signature: '' })).status, 400);
    // Form (richtig signiert): nur eine ZIP, Name passt nicht zur Version
    res = await put(signed(keys.privateKey, macManifest('0.14.0', { arm64: files.arm64 })));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^Ungültige update-mac\.json: „files\.x64“/);
    res = await put(signed(keys.privateKey, macManifest('0.14.1', files)));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /„files\.arm64\.file“/);
    // Dateien: fehlt, falsche Größe, falsche Prüfsumme
    res = await put(signed(keys.privateKey, macManifest('0.15.0', macFiles('0.15.0', arm, x64))));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /HeldixClient-0\.15\.0-mac-arm64\.zip liegt nicht im Update-Ordner\. Bitte zuerst hochladen\./);
    res = await put(signed(keys.privateKey, macManifest('0.14.0', { ...files, x64: { ...files.x64, size: x64.length + 1 } })));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Byte groß/);
    res = await put(signed(keys.privateKey, macManifest('0.14.0', { ...files, x64: { ...files.x64, sha512: sha512(Buffer.from('anders')) } })));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Prüfsumme \(SHA-512\) von HeldixClient-0\.14\.0-mac-x64\.zip/);
    assert.equal(fs.existsSync(path.join(dir, 'update-mac.json')), false, 'nichts veröffentlicht');
    // Als Moderator: forbidden
    assert.deepEqual([(await put(good, modCookie)).body.code], ['forbidden']);

    res = await put(good);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { mac: JSON.parse(good.manifest) });
    // Für den Launcher sofort sichtbar, mit genau dem signierten Text; keine temporären Dateien; Windows unberührt.
    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/latest/mac')).body, good);
    assert.deepEqual(fs.readdirSync(dir).sort(), [zipName('0.14.0', 'arm64'), zipName('0.14.0', 'x64'), 'update-mac.json']);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 404);
    const overview = await webApi(service, 'GET', '/v1/team/updates', { cookie });
    assert.deepEqual([overview.body.current, overview.body.mac], [null, JSON.parse(good.manifest)]);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/files')).body.mac, '0.14.0');
    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/versions')).body.versions.map((v: { version: string }) => v.version), ['0.14.0']);

    // Gleiche oder niedrigere Version: 409
    res = await put(good);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /nicht höher als die veröffentlichte Mac-Version \(0\.14\.0\)/);
    // Die ZIPs der veröffentlichten Version lassen sich weder ersetzen noch löschen.
    const replaced = await upload(service, cookie, zipName('0.14.0', 'x64'), randomBytes(10));
    assert.equal(replaced.status, 409);
    assert.match(replaced.body.error, /veröffentlichten Mac-Version/);
    assert.equal((await webApi(service, 'DELETE', `/v1/team/updates/files/${zipName('0.14.0', 'arm64')}`, { cookie })).status, 409);
    assert.deepEqual(fs.readFileSync(path.join(dir, zipName('0.14.0', 'x64'))), x64);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/updates/files/update-mac.json', { cookie })).status, 404);

    // Neue Version: hochladen, veröffentlichen, alte ZIPs löschen.
    const arm2 = randomBytes(30_000);
    const x642 = randomBytes(31_000);
    assert.equal((await upload(service, cookie, zipName('0.14.1', 'arm64'), arm2)).status, 200);
    assert.equal((await upload(service, cookie, zipName('0.14.1', 'x64'), x642)).status, 200);
    const next = signed(keys.privateKey, macManifest('0.14.1', macFiles('0.14.1', arm2, x642)));
    assert.equal((await put(next)).status, 200);
    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/latest/mac')).body, next);
    const removed = await webApi(service, 'DELETE', `/v1/team/updates/files/${zipName('0.14.0', 'arm64')}`, { cookie });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.mac.version, '0.14.1');
    assert.equal(removed.body.files.some((f: { file: string }) => f.file === zipName('0.14.0', 'arm64')), false);

    const actions = (await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries.map(
      (e: { action: string; target: string; detail: string }) => `${e.action} ${e.target} ${e.detail}`,
    );
    for (const entry of [
      `update.publish update-mac.json Mac-Version 0.14.0: ${zipName('0.14.0', 'arm64')}, ${zipName('0.14.0', 'x64')}`,
      `update.publish update-mac.json Mac-Version 0.14.1: ${zipName('0.14.1', 'arm64')}, ${zipName('0.14.1', 'x64')}`,
    ]) {
      assert.ok(actions.includes(entry), entry);
    }
    assert.equal(actions.filter((a: string) => a.startsWith('update.publish')).length, 2, 'abgelehnte Versuche stehen nicht im Protokoll');
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ohne Update-Schlüssel: update-mac.json im Browser 503', async () => {
  const clock = new Clock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-mac-team-'));
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, updatesDir: dir });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const arm = randomBytes(1000);
    const x64 = randomBytes(1000);
    const body = signed(generateKeyPairSync('ed25519').privateKey, macManifest('0.14.0', macFiles('0.14.0', arm, x64)));
    const res = await webApi(service, 'PUT', '/v1/team/updates/manifest', { cookie, body });
    assert.equal(res.status, 503);
    assert.equal(fs.existsSync(path.join(dir, 'update-mac.json')), false);
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
