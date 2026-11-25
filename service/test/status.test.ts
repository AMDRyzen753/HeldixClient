// Versionsverlauf des Launchers (beide Wege des Veröffentlichens) und /v1/status (nur Summen).
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { api, connect, devPlayer, startService } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

function manifestFor(version: string, data: Buffer, notes: string[]): string {
  return JSON.stringify({
    v: 1,
    version,
    file: `HeldixClient-Setup-${version}.exe`,
    size: data.length,
    sha512: createHash('sha512').update(data).digest('base64'),
    date: '2026-11-25',
    notes,
  });
}

test('Versionsverlauf: per scp hochgeladen und im Team-Bereich veröffentlicht, jede Version einmal', async () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-versions-'));
  const service = await startService({
    dev: true,
    website: WEBSITE,
    totpNow: clock.read,
    updatesDir: dir,
    updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  try {
    let res = await api(service.url, 'GET', '/v1/launcher/versions');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { versions: [] });
    assert.equal(res.headers.get('cache-control'), 'max-age=60');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');

    // Weg 1: Installer und update.json per scp (hier: direkt in den Ordner). Erst wenn der Installer da ist, zählt sie.
    const v1 = randomBytes(1000);
    const manifest1 = manifestFor('1.0.0', v1, ['Erste Version', 'Web-Login']);
    const signed1 = { manifest: manifest1, signature: sign(null, Buffer.from(manifest1), keys.privateKey).toString('base64') };
    fs.writeFileSync(path.join(dir, 'update.json'), JSON.stringify(signed1));
    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/versions')).body.versions, [], 'Installer fehlt noch');
    fs.writeFileSync(path.join(dir, 'HeldixClient-Setup-1.0.0.exe'), v1);
    res = await api(service.url, 'GET', '/v1/launcher/versions');
    assert.equal(res.body.versions.length, 1);
    const [first] = res.body.versions;
    assert.deepEqual(Object.keys(first).sort(), ['date', 'notes', 'publishedAt', 'version']);
    assert.deepEqual([first.version, first.date, first.notes], ['1.0.0', '2026-11-25', ['Erste Version', 'Web-Login']]);
    // Neu eingelesen (andere Änderungszeit): trotzdem nur einmal.
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, 'update.json'), later, later);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 200);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/versions')).body.versions.length, 1);

    // Weg 2: im Team-Bereich hochladen und veröffentlichen.
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const v2 = randomBytes(800);
    const upload = await fetch(`${service.url}/v1/team/updates/files/HeldixClient-Setup-1.1.0.exe`, {
      method: 'PUT',
      headers: { Cookie: `__Host-heldix_web=${cookie}`, 'X-Heldix-Web': '1' },
      body: new Uint8Array(v2),
    });
    assert.equal(upload.status, 200);
    const manifest2 = manifestFor('1.1.0', v2, ['Support-Anfragen']);
    const published = await webApi(service, 'PUT', '/v1/team/updates/manifest', {
      cookie,
      body: { manifest: manifest2, signature: sign(null, Buffer.from(manifest2), keys.privateKey).toString('base64') },
    });
    assert.equal(published.status, 200);
    await api(service.url, 'GET', '/v1/launcher/latest');
    res = await api(service.url, 'GET', '/v1/launcher/versions');
    assert.deepEqual(
      res.body.versions.map((v: { version: string; notes: string[] }) => [v.version, v.notes]),
      [
        ['1.1.0', ['Support-Anfragen']],
        ['1.0.0', ['Erste Version', 'Web-Login']],
      ],
      'neueste zuerst, keine Doppelten',
    );
    assert.deepEqual((await api(service.url, 'GET', '/v1/launcher/versions?limit=1')).body.versions.map((v: { version: string }) => v.version), ['1.1.0']);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/versions?limit=50')).status, 200);
    for (const q of ['?limit=0', '?limit=51', '?limit=x']) assert.equal((await api(service.url, 'GET', `/v1/launcher/versions${q}`)).status, 400, q);
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/v1/status: Version, online (eindeutige Spieler mit WebSocket, ohne Web-Sitzungen), Spieler insgesamt, Launcher, Start', async () => {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-status-'));
  const service = await startService({ dev: true, website: WEBSITE, updatesDir: dir });
  try {
    const anna = await devPlayer(service.url, 'Anna');
    const ben = await devPlayer(service.url, 'Ben');
    await devPlayer(service.url, 'Carla');
    const clients = [(await connect(service.wsUrl, anna.token)).client, (await connect(service.wsUrl, anna.token)).client, (await connect(service.wsUrl, ben.token)).client];
    // Eine Web-Sitzung zählt nicht als online.
    await webLogin(service, await devPlayer(service.url, 'NurWeb'));
    // Eine Version ist veröffentlicht (per Datei).
    const data = randomBytes(500);
    fs.writeFileSync(path.join(dir, 'HeldixClient-Setup-2.3.4.exe'), data);
    fs.writeFileSync(path.join(dir, 'update.json'), JSON.stringify({ manifest: manifestFor('2.3.4', data, []), signature: 'c2ln' }));
    try {
      const res = await api(service.url, 'GET', '/v1/status');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'max-age=30');
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
      const { since, ...rest } = res.body;
      assert.deepEqual(rest, { ok: true, service: pkg.version, online: 2, players: 4, launcher: '2.3.4' });
      assert.ok(since >= started - 5000 && since <= Date.now());
      assert.equal(pkg.version, '1.3.0');
    } finally {
      for (const client of clients) await client.close();
    }
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Ohne Version: launcher null.
  const empty = await startService();
  try {
    const res = await api(empty.url, 'GET', '/v1/status');
    assert.deepEqual([res.body.launcher, res.body.online, res.body.players], [null, 0, 0]);
  } finally {
    await empty.close();
  }
});
