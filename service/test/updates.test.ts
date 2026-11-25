// Launcher-Updates: update.json, Weiterleitung auf den aktuellen Installer, Download mit Range und HEAD, Schutz des Ordners.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { parseRange, parseUpdateJson } from '../src/updates';
import { api, rawRequest, sleep, startService, waitFor, type TestService } from './helpers';

const NOTHING = 'Noch keine Version veröffentlicht.';

function manifestFor(version: string, data: Buffer, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    version,
    file: `HeldixClient-Setup-${version}.exe`,
    size: data.length,
    sha512: createHash('sha512').update(data).digest('base64'),
    date: '2026-11-25',
    notes: ['Neu: Nachrichten an Freunde'],
    ...extra,
  });
}

/** Legt Installer und update.json in den Ordner und setzt die Änderungszeit (damit der Dienst neu liest). */
function publish(dir: string, version: string, data: Buffer, mtime: Date, manifest = manifestFor(version, data)) {
  fs.writeFileSync(path.join(dir, `HeldixClient-Setup-${version}.exe`), data);
  const updateJson = JSON.stringify({ manifest, signature: Buffer.from(`sig-${version}`).toString('base64') });
  writeUpdateJson(dir, updateJson, mtime);
  return { manifest, updateJson };
}

function writeUpdateJson(dir: string, text: string, mtime: Date): void {
  const file = path.join(dir, 'update.json');
  fs.writeFileSync(file, text);
  fs.utimesSync(file, mtime, mtime);
}

describe('Launcher-Updates: update.json', () => {
  let service: TestService;
  let dir: string;
  let clock = Date.now() - 3_600_000;
  const nextTime = () => new Date((clock += 5000));

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-updates-'));
    service = await startService({ updatesDir: dir });
  });
  after(async () => {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ohne update.json: 404, mit CORS', async () => {
    const res = await api(service.url, 'GET', '/v1/launcher/latest');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: NOTHING });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const redirect = await rawRequest(service.url, 'GET', '/v1/launcher/download/latest');
    assert.equal(redirect.status, 404);
    assert.equal(redirect.headers['access-control-allow-origin'], '*');
  });

  test('gültige update.json: genau der Text des Manifests, no-cache und CORS; neu gelesen nach dem Hochladen', async () => {
    const data = randomBytes(4096);
    const { manifest } = publish(dir, '0.12.0', data, nextTime());
    const res = await api(service.url, 'GET', '/v1/launcher/latest');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), ['manifest', 'signature']);
    assert.equal(res.body.manifest, manifest);
    assert.equal(res.body.signature, Buffer.from('sig-0.12.0').toString('base64'));
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.ok(service.logs.some((l) => l.includes('Launcher-Version 0.12.0 ist veröffentlicht')));

    // Neue Version hochladen: ohne Neustart sofort sichtbar.
    const newer = randomBytes(5000);
    const second = publish(dir, '0.13.0-beta.1', newer, nextTime());
    const updated = await api(service.url, 'GET', '/v1/launcher/latest');
    assert.equal(updated.body.manifest, second.manifest);

    // Weiterleitung auf den aktuellen Installer.
    const redirect = await rawRequest(service.url, 'GET', '/v1/launcher/download/latest');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, '/v1/launcher/download/HeldixClient-Setup-0.13.0-beta.1.exe');
    assert.equal(redirect.headers['access-control-allow-origin'], '*');
    assert.equal(redirect.headers['cache-control'], 'no-cache');
    assert.equal((await rawRequest(service.url, 'HEAD', '/v1/launcher/download/latest')).status, 302);
    // fetch folgt der Weiterleitung und bekommt den Installer.
    const followed = await fetch(`${service.url}/v1/launcher/download/latest`);
    assert.equal(followed.status, 200);
    assert.deepEqual(Buffer.from(await followed.arrayBuffer()), newer);
    // Falsche Methode: 405.
    assert.equal((await api(service.url, 'POST', '/v1/launcher/latest')).status, 405);
  });

  test('ungültige oder unvollständige update.json: 404 und ein Eintrag im Log', async () => {
    const data = randomBytes(1000);
    fs.writeFileSync(path.join(dir, 'HeldixClient-Setup-1.0.0.exe'), data);
    const good = manifestFor('1.0.0', data);
    const cases: [string, string][] = [
      ['{ kaputt', 'kein gültiges JSON'],
      ['[]', 'kein JSON-Objekt'],
      [JSON.stringify({ manifest: good }), '„signature“ fehlt'],
      [JSON.stringify({ manifest: JSON.parse(good), signature: 'x' }), '„manifest“ fehlt oder ist kein Text'],
      [JSON.stringify({ manifest: '{kaputt', signature: 'x' }), '„manifest“ ist kein gültiges JSON'],
      [JSON.stringify({ manifest: manifestFor('1.0.0', data, { v: 2 }), signature: 'x' }), '„v“ im Manifest ist nicht 1'],
      [JSON.stringify({ manifest: manifestFor('1.0.0', data, { version: 1 }), signature: 'x' }), '„version“ im Manifest fehlt'],
      [JSON.stringify({ manifest: manifestFor('1.0.0', data, { file: '../HeldixClient-Setup-1.0.0.exe' }), signature: 'x' }), '„file“ im Manifest'],
      [JSON.stringify({ manifest: manifestFor('1.0.0', data, { file: 'setup.exe' }), signature: 'x' }), '„file“ im Manifest'],
      [JSON.stringify({ manifest: manifestFor('1.0.0', data, { size: '1000' }), signature: 'x' }), '„size“ im Manifest'],
      // Installer fehlt bzw. ist noch nicht vollständig hochgeladen.
      [JSON.stringify({ manifest: manifestFor('9.9.9', data), signature: 'x' }), 'die Datei fehlt aber'],
      [JSON.stringify({ manifest: manifestFor('1.0.0', data, { size: 1001 }), signature: 'x' }), 'Upload noch nicht fertig?'],
    ];
    for (const [text, logPart] of cases) {
      writeUpdateJson(dir, text, nextTime());
      const res = await api(service.url, 'GET', '/v1/launcher/latest');
      assert.equal(res.status, 404, text);
      assert.deepEqual(res.body, { error: NOTHING });
      assert.ok(service.logs.some((l) => l.includes(logPart)), `Log fehlt: ${logPart}`);
    }
    // Dieselbe kaputte Datei wird nur einmal gemeldet.
    const count = service.logs.length;
    await api(service.url, 'GET', '/v1/launcher/latest');
    await api(service.url, 'GET', '/v1/launcher/latest');
    assert.equal(service.logs.length, count);

    // Sobald der Upload fertig ist, gilt die Version (update.json unverändert).
    fs.appendFileSync(path.join(dir, 'HeldixClient-Setup-1.0.0.exe'), Buffer.from([1]));
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 200);

    // Mit BOM (manche Editoren) geht es auch; update.json löschen: wieder 404.
    writeUpdateJson(dir, `\uFEFF${JSON.stringify({ manifest: good, signature: 'x' })}`, nextTime());
    fs.writeFileSync(path.join(dir, 'HeldixClient-Setup-1.0.0.exe'), data);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 200);
    fs.rmSync(path.join(dir, 'update.json'));
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 404);
  });
});

describe('Launcher-Updates: Download', () => {
  let service: TestService;
  let dir: string;
  const data = randomBytes(256 * 1024 + 123);
  const file = 'HeldixClient-Setup-2.0.0.exe';
  const url = `/v1/launcher/download/${file}`;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-updates-'));
    fs.writeFileSync(path.join(dir, file), data);
    service = await startService({ updatesDir: dir });
  });
  after(async () => {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ganze Datei und HEAD: Länge, Typ, Dateiname, Accept-Ranges, CORS', async () => {
    const res = await rawRequest(service.url, 'GET', url);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-length'], String(data.length));
    assert.equal(res.headers['content-type'], 'application/vnd.microsoft.portable-executable');
    assert.equal(res.headers['content-disposition'], `attachment; filename="${file}"`);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.headers.etag);
    assert.ok(res.headers['last-modified']);
    assert.deepEqual(res.body, data);

    const head = await rawRequest(service.url, 'HEAD', url);
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], String(data.length));
    assert.equal(head.headers['accept-ranges'], 'bytes');
    assert.equal(head.body.length, 0);
  });

  test('Range: ein Bereich (a-b, a-, -n), 416 außerhalb, sonst die ganze Datei', async () => {
    const size = data.length;
    const ranged: [string, number, number][] = [
      ['bytes=0-9', 0, 9],
      ['bytes=1000-', 1000, size - 1],
      ['bytes=-10', size - 10, size - 1],
      ['bytes=-999999999', 0, size - 1],
      ['bytes=5-999999999', 5, size - 1],
      [`bytes=${size - 1}-${size - 1}`, size - 1, size - 1],
      ['BYTES=3-4', 3, 4],
    ];
    for (const [range, start, end] of ranged) {
      const res = await rawRequest(service.url, 'GET', url, { Range: range });
      assert.equal(res.status, 206, range);
      assert.equal(res.headers['content-range'], `bytes ${start}-${end}/${size}`, range);
      assert.equal(res.headers['content-length'], String(end - start + 1), range);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.deepEqual(res.body, data.subarray(start, end + 1), range);
    }
    const headRange = await rawRequest(service.url, 'HEAD', url, { Range: 'bytes=0-99' });
    assert.equal(headRange.status, 206);
    assert.equal(headRange.headers['content-length'], '100');
    assert.equal(headRange.body.length, 0);

    for (const range of [`bytes=${size}-`, `bytes=${size + 10}-${size + 20}`, 'bytes=-0']) {
      const res = await rawRequest(service.url, 'GET', url, { Range: range });
      assert.equal(res.status, 416, range);
      assert.equal(res.headers['content-range'], `bytes */${size}`);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.equal(typeof JSON.parse(res.body.toString('utf8')).error, 'string');
    }
    // Mehrere Bereiche, ungültige oder fremde Einheiten: ganze Datei.
    for (const range of ['bytes=0-1,5-6', 'bytes=5-3', 'bytes=abc', 'items=0-1', 'bytes=-', 'bytes 0-1']) {
      const res = await rawRequest(service.url, 'GET', url, { Range: range });
      assert.equal(res.status, 200, range);
      assert.equal(res.body.length, size, range);
    }
  });

  test('If-Range: Fortsetzen nur, solange die Datei dieselbe ist', async () => {
    const first = await rawRequest(service.url, 'HEAD', url);
    const etag = String(first.headers.etag);
    const lastModified = String(first.headers['last-modified']);
    assert.equal((await rawRequest(service.url, 'GET', url, { Range: 'bytes=10-19', 'If-Range': etag })).status, 206);
    assert.equal((await rawRequest(service.url, 'GET', url, { Range: 'bytes=10-19', 'If-Range': lastModified })).status, 206);
    const changed = await rawRequest(service.url, 'GET', url, { Range: 'bytes=10-19', 'If-Range': '"anders"' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.length, data.length);
  });

  test('nur erlaubte Dateinamen, kein Weg aus dem Ordner hinaus', async () => {
    // Daneben liegende Dateien, die nie ausgeliefert werden dürfen.
    fs.writeFileSync(path.join(dir, 'update.json'), '{}');
    fs.writeFileSync(path.join(dir, 'HeldixClient-Setup-2.0.0.exe.part'), 'halb');
    fs.mkdirSync(path.join(dir, 'HeldixClient-Setup-3.0.0.exe'));
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-geheim.exe`);
    fs.writeFileSync(outside, 'geheim');
    try {
      const paths = [
        '/v1/launcher/download/update.json',
        '/v1/launcher/download/HeldixClient-Setup-2.0.0.exe.part',
        '/v1/launcher/download/HeldixClient-Setup-3.0.0.exe',
        '/v1/launcher/download/HeldixClient-Setup-9.9.9.exe',
        '/v1/launcher/download/heldixclient-setup-2.0.0.exe',
        '/v1/launcher/download/HeldixClient-Setup-2.0.exe',
        '/v1/launcher/download/HeldixClient-Setup-2.0.0-beta_1.exe',
        `/v1/launcher/download/..%2F${path.basename(outside)}`,
        `/v1/launcher/download/%2E%2E%2F${path.basename(outside)}`,
        `/v1/launcher/download/..%5C${path.basename(outside)}`,
        `/v1/launcher/download/../${path.basename(outside)}`,
        `/v1/launcher/download/HeldixClient-Setup-2.0.0.exe%00`,
        `/v1/launcher/download/${encodeURIComponent(file)}x`,
        '/v1/launcher/download/',
        '/v1/launcher/download/sub/HeldixClient-Setup-2.0.0.exe',
      ];
      for (const p of paths) {
        const res = await rawRequest(service.url, 'GET', p);
        assert.equal(res.status, 404, p);
        assert.equal(res.headers['access-control-allow-origin'], '*', p);
        assert.equal(res.body.includes('geheim'), false, p);
      }

      // Symbolischer Link nach draußen: 404 (auf Windows ohne Rechte für Links übersprungen).
      const link = path.join(dir, 'HeldixClient-Setup-6.6.6.exe');
      let linked = true;
      try {
        fs.symlinkSync(outside, link, 'file');
      } catch {
        linked = false;
      }
      if (linked) {
        const res = await rawRequest(service.url, 'GET', '/v1/launcher/download/HeldixClient-Setup-6.6.6.exe');
        assert.equal(res.status, 404);
        assert.equal(res.body.includes('geheim'), false);
        // Ein Link innerhalb des Ordners ist erlaubt.
        const inner = path.join(dir, 'HeldixClient-Setup-2.0.1.exe');
        fs.symlinkSync(path.join(dir, file), inner, 'file');
        const ok = await rawRequest(service.url, 'GET', '/v1/launcher/download/HeldixClient-Setup-2.0.1.exe');
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.body, data);
      }
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

describe('Launcher-Updates: Grenzen und Verbindungen', () => {
  test('höchstens N Downloads pro IP und Zeitraum (hier 3), dann 429 mit CORS', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-updates-'));
    fs.writeFileSync(path.join(dir, 'HeldixClient-Setup-1.2.3.exe'), 'MZ');
    const service = await startService({ updatesDir: dir, downloadRateLimit: 3 });
    try {
      const url = '/v1/launcher/download/HeldixClient-Setup-1.2.3.exe';
      for (let i = 0; i < 3; i++) assert.equal((await rawRequest(service.url, 'GET', url)).status, 200);
      const limited = await rawRequest(service.url, 'GET', url);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers['access-control-allow-origin'], '*');
      assert.ok(Number(limited.headers['retry-after']) >= 1);
      assert.equal(JSON.parse(limited.body.toString('utf8')).error, 'Zu viele Downloads. Bitte kurz warten.');
      // update.json abfragen ist davon nicht betroffen.
      assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 404);
    } finally {
      await service.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('langsamer Client: läuft durch; Client liest gar nicht mehr: Verbindung wird getrennt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-updates-'));
    const big = randomBytes(24 * 1024 * 1024);
    fs.writeFileSync(path.join(dir, 'HeldixClient-Setup-4.0.0.exe'), big);
    const service = await startService({ updatesDir: dir, downloadIdleTimeoutMs: 400 });
    const { hostname, port } = new URL(service.url);
    try {
      // Liest gebremst (Pausen unter der Grenze): Die Datei kommt vollständig an.
      const slow = await new Promise<{ length: number; hash: string }>((resolve, reject) => {
        const req = httpRequest({ host: hostname, port, path: '/v1/launcher/download/HeldixClient-Setup-4.0.0.exe' }, (res) => {
          const hash = createHash('sha256');
          let length = 0;
          let chunks = 0;
          res.on('data', (chunk: Buffer) => {
            hash.update(chunk);
            length += chunk.length;
            if (++chunks % 64 === 0) {
              res.pause();
              setTimeout(() => res.resume(), 100);
            }
          });
          res.on('end', () => resolve({ length, hash: hash.digest('hex') }));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(slow.length, big.length);
      assert.equal(slow.hash, createHash('sha256').update(big).digest('hex'));

      // Liest nach dem Anfang 1,5 s gar nicht (Grenze 400 ms): Der Dienst trennt. Das merkt der Client erst,
      // wenn er weiterliest; dann endet die Antwort vorzeitig.
      const stalled = await new Promise<{ received: number; complete: boolean }>((resolve, reject) => {
        const req = httpRequest({ host: hostname, port, path: '/v1/launcher/download/HeldixClient-Setup-4.0.0.exe' }, (res) => {
          let received = 0;
          res.once('data', (chunk: Buffer) => {
            received += chunk.length;
            res.pause();
            setTimeout(() => {
              res.on('data', (more: Buffer) => (received += more.length));
              res.resume();
            }, 1500);
          });
          res.on('close', () => resolve({ received, complete: res.complete }));
          res.on('error', () => {
            // folgt auf das Trennen
          });
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(stalled.complete, false);
      assert.ok(stalled.received < big.length);
      // Danach antwortet der Dienst normal weiter.
      await sleep(10);
      await waitFor(async () => (await rawRequest(service.url, 'HEAD', '/v1/launcher/download/HeldixClient-Setup-4.0.0.exe')).status === 200);
    } finally {
      await service.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('parseRange', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-0', 100), { start: 0, end: 0 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-1', 100), { start: 99, end: 99 });
  assert.deepEqual(parseRange(' bytes=10-200 ', 100), { start: 10, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
  assert.equal(parseRange('bytes=-5', 0), 'unsatisfiable');
  for (const header of ['bytes=', 'bytes=-', 'bytes=1-2,3-4', 'bytes=3-2', 'bits=0-1', 'bytes=a-b', 'bytes=1.5-2']) {
    assert.equal(parseRange(header, 100), null, header);
  }
});

test('parseUpdateJson', () => {
  const manifest = JSON.stringify({ v: 1, version: '0.12.0', file: 'HeldixClient-Setup-0.12.0.exe', size: 5, sha512: 'x', date: '2026-11-25', notes: [] });
  assert.deepEqual(parseUpdateJson(JSON.stringify({ manifest, signature: 'c2ln' })), {
    manifest,
    signature: 'c2ln',
    version: '0.12.0',
    file: 'HeldixClient-Setup-0.12.0.exe',
    size: 5,
  });
  assert.equal(typeof parseUpdateJson(JSON.stringify({ manifest, signature: '' })), 'string');
  assert.equal(typeof parseUpdateJson('null'), 'string');
});
