// Addon-Store: signierte Manifeste (Signatur über "heldix-addon\n" + Text), Felder, Versionsregel, Liste und Detail,
// Downloads mit Range und Zähler, Verstecken und Löschen, Team-Rechte, Protokoll und Schutz des Addon-Ordners.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ADDON_SIGNATURE_PREFIX, verifyAddonSignature } from '../src/addons';
import { Store } from '../src/db';
import { SESSION_COOKIE } from '../src/web';
import { api, devPlayer, rawRequest, sleep, startService, waitFor, type Player, type TestService } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

const NO_ADDON = 'Dieses Addon gibt es nicht.';
const WRONG_SIGNATURE = 'Die Signatur stimmt nicht.';
const MIB = 1024 * 1024;

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const fileName = (id: string, version: string) => `heldix-addon-${id}-${version}.jar`;

/** Manifest-Felder wie `npm run addon` sie schreibt; `extra` überschreibt (undefined: Feld fehlt). */
function fields(id: string, version: string, data: Buffer, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'heldix-addon',
    id,
    name: id === 'spotify' ? 'Spotify' : 'Uhrzeit',
    version,
    summary: 'Zeigt etwas im HUD an.',
    description: 'Erster Absatz.\n\n- Punkt eins\n- Punkt zwei',
    authors: ['HeldixClient-Team'],
    api: 1,
    icon: 'clock',
    category: 'hud',
    platforms: [],
    file: fileName(id, version),
    size: data.length,
    sha256: sha256(data),
    date: '2026-11-25',
    notes: ['Erste Version'],
    ...extra,
  };
}

/** `.addon.json` wie `npm run addon`: Manifest-Text plus Ed25519-Signatur über "heldix-addon\n" + Text. */
function signText(privateKey: KeyObject, manifest: string) {
  return { manifest, signature: sign(null, Buffer.from(ADDON_SIGNATURE_PREFIX + manifest, 'utf8'), privateKey).toString('base64') };
}

function signAddon(privateKey: KeyObject, manifest: Record<string, unknown>) {
  return signText(privateKey, JSON.stringify(manifest));
}

/** Signiert wie ein Launcher-Update (update.json): über den Text ohne Präfix. */
function signWithoutPrefix(privateKey: KeyObject, manifest: string) {
  return { manifest, signature: sign(null, Buffer.from(manifest, 'utf8'), privateKey).toString('base64') };
}

/** Manifest eines Launcher-Updates (wie in update.json). */
function launcherManifest(version: string, data: Buffer): string {
  return JSON.stringify({
    v: 1,
    version,
    file: `HeldixClient-Setup-${version}.exe`,
    size: data.length,
    sha512: createHash('sha512').update(data).digest('base64'),
    date: '2026-11-25',
    notes: ['Neu'],
  });
}

/** Roher Upload wie von der Webseite (fetch mit Cookie und CSRF-Header). */
async function upload(service: TestService, cookie: string | null, file: string, data: Buffer, headers: Record<string, string> = {}) {
  const res = await fetch(`${service.url}/v1/team/addons/files/${file}`, {
    method: 'PUT',
    headers: {
      ...(cookie === null ? {} : { Cookie: `${SESSION_COOKIE}=${cookie}` }),
      'X-Heldix-Web': '1',
      'Content-Type': 'application/octet-stream',
      ...headers,
    },
    body: new Uint8Array(data),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? undefined : JSON.parse(text) };
}

const ENTRY_KEYS = [
  'api',
  'authors',
  'category',
  'date',
  'description',
  'downloads',
  'file',
  'icon',
  'id',
  'manifest',
  'name',
  'notes',
  'platforms',
  'publishedAt',
  'sha256',
  'signature',
  'size',
  'summary',
  'version',
];

describe('Addon-Store', () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  let service: TestService;
  let addonsDir: string;
  let updatesDir: string;
  let cookie: string;
  let modCookie: string;
  let chefin: Player;
  const uhr1 = randomBytes(40_000);
  const uhr2 = randomBytes(30_000);
  const uhrBeta = randomBytes(20_000);
  const spotify = randomBytes(25_000);

  const put = (body: unknown) => webApi(service, 'PUT', '/v1/team/addons/manifest', { cookie, body });
  const downloads = async (id: string) => (await api(service.url, 'GET', `/v1/addons/${id}`)).body.addon.downloads as number;
  const audit = async () =>
    ((await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries as { action: string; target: string }[]).map(
      (e) => `${e.action} ${e.target}`,
    );

  before(async () => {
    addonsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-addons-'));
    updatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-addons-updates-'));
    service = await startService({
      dev: true,
      website: WEBSITE,
      totpNow: clock.read,
      addonsDir,
      updatesDir,
      updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      maxAddonUploadBytes: MIB,
    });
    chefin = await devPlayer(service.url, 'Chefin');
    cookie = (await teamLogin(service, chefin, 'admin', clock)).cookie;
    modCookie = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
  });
  after(async () => {
    await service.close();
    fs.rmSync(addonsDir, { recursive: true, force: true });
    fs.rmSync(updatesDir, { recursive: true, force: true });
  });

  test('leerer Store: Liste, Detail, Status und Team-Übersicht, öffentlich mit CORS', async () => {
    const list = await api(service.url, 'GET', '/v1/addons');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, { addons: [] });
    assert.equal(list.headers.get('cache-control'), 'max-age=60');
    assert.equal(list.headers.get('access-control-allow-origin'), '*');
    for (const p of ['/v1/addons/uhrzeit', '/v1/addons/uhrzeit/download', `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.0.0')}`]) {
      const res = await rawRequest(service.url, 'GET', p);
      assert.equal(res.status, 404, p);
      assert.equal(res.headers['access-control-allow-origin'], '*', p);
    }
    assert.deepEqual((await api(service.url, 'GET', '/v1/addons/uhrzeit')).body, { error: NO_ADDON });
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.addons, 0);
    const overview = await webApi(service, 'GET', '/v1/team/addons', { cookie });
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    assert.deepEqual(overview.body, { addons: [], pending: [], keyConfigured: true });
  });

  test('Hochladen: gestreamt mit SHA-256, nur gültige Namen, höchstens die Grenze, keine Reste', async () => {
    const file = fileName('uhrzeit', '1.0.0');
    const res = await upload(service, cookie, file, uhr1);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { file, size: uhr1.length, sha256: sha256(uhr1) });
    assert.deepEqual(fs.readFileSync(path.join(addonsDir, file)), uhr1);
    assert.deepEqual(fs.readdirSync(addonsDir), [file], 'kein .part übrig');
    const overview = (await webApi(service, 'GET', '/v1/team/addons', { cookie })).body;
    assert.deepEqual(overview.addons, []);
    assert.deepEqual(overview.pending.map((p: { file: string; size: number }) => [p.file, p.size]), [[file, uhr1.length]]);
    assert.equal(typeof overview.pending[0].uploadedAt, 'number');
    // Noch nicht veröffentlicht: öffentlich nicht zu haben.
    assert.equal((await rawRequest(service.url, 'GET', `/v1/addons/uhrzeit/files/${file}`)).status, 404);

    for (const bad of [
      'uhrzeit.jar',
      'heldix-addon-Uhrzeit-1.0.0.jar',
      'heldix-addon-uhrzeit-1.0.jar',
      'heldix-addon-uhrzeit-1.0.0.zip',
      'heldix-addon--1.0.0.jar',
      'heldix-addon-uhrzeit-1.0.0.jar.part',
      `heldix-addon-${'a'.repeat(41)}-1.0.0.jar`,
    ]) {
      assert.equal((await upload(service, cookie, bad, uhr1)).status, 400, bad);
    }
    // Über der Grenze (im Test 1 MiB): 413, ohne Datei oder Rest.
    const big = await upload(service, cookie, fileName('uhrzeit', '9.0.0'), randomBytes(MIB + 1));
    assert.equal(big.status, 413);
    assert.deepEqual(fs.readdirSync(addonsDir), [file]);
  });

  test('Signatur: nur mit Präfix und Update-Schlüssel; Launcher-Updates gelten nie als Addon und umgekehrt', async () => {
    const manifest = fields('uhrzeit', '1.0.0', uhr1);
    const good = signAddon(keys.privateKey, manifest);

    // Ohne Präfix signiert (wie ein Launcher-Update): abgelehnt.
    let res = await put(signWithoutPrefix(keys.privateKey, good.manifest));
    assert.deepEqual([res.status, res.body.error], [400, WRONG_SIGNATURE]);
    // Fremder Schlüssel, verfälschter Text, kaputte Signatur
    res = await put(signAddon(generateKeyPairSync('ed25519').privateKey, manifest));
    assert.deepEqual([res.status, res.body.error], [400, WRONG_SIGNATURE]);
    res = await put({ manifest: good.manifest.replace('Uhrzeit', 'Boese'), signature: good.signature });
    assert.deepEqual([res.status, res.body.error], [400, WRONG_SIGNATURE]);
    res = await put({ manifest: good.manifest, signature: 'a3Vyeg==' });
    assert.deepEqual([res.status, res.body.error], [400, WRONG_SIGNATURE]);

    // Ein echtes Launcher-Update (update.json, signiert ohne Präfix) ist kein Addon.
    const setup = randomBytes(1000);
    const update = signWithoutPrefix(keys.privateKey, launcherManifest('9.9.9', setup));
    res = await put(update);
    assert.deepEqual([res.status, res.body.error], [400, WRONG_SIGNATURE]);
    // Selbst mit Präfix signiert scheitert es an den Feldern.
    res = await put(signText(keys.privateKey, update.manifest));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /„type“/);

    // Umgekehrt: Ein Addon-Manifest (mit Präfix signiert) ist nie ein Launcher-Update, auch nicht in passender Form.
    fs.writeFileSync(path.join(updatesDir, 'HeldixClient-Setup-9.9.9.exe'), setup);
    const asUpdate = signText(keys.privateKey, launcherManifest('9.9.9', setup));
    res = await webApi(service, 'PUT', '/v1/team/updates/manifest', { cookie, body: asUpdate });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Signatur/);
    res = await webApi(service, 'PUT', '/v1/team/updates/manifest', { cookie, body: good });
    assert.equal(res.status, 400);
    assert.equal((await api(service.url, 'GET', '/v1/launcher/latest')).status, 404, 'kein Update veröffentlicht');
    // Dieselbe Prüfung ohne Dienst: Jede Signatur gilt nur in ihrer eigenen Domäne.
    const publicKey = keys.publicKey;
    assert.equal(verifyAddonSignature(good.manifest, good.signature, publicKey), true);
    assert.equal(verifyAddonSignature(update.manifest, update.signature, publicKey), false);
    assert.equal(verify(null, Buffer.from(asUpdate.manifest, 'utf8'), publicKey, Buffer.from(asUpdate.signature, 'base64')), false);
    assert.equal(verify(null, Buffer.from(update.manifest, 'utf8'), publicKey, Buffer.from(update.signature, 'base64')), true);

    // Form des Körpers
    for (const body of [{}, { manifest: good.manifest }, { signature: good.signature }, { manifest: 5, signature: good.signature }]) {
      assert.equal((await put(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    res = await put(signText(keys.privateKey, '{kaputt'));
    assert.deepEqual([res.status, res.body.error], [400, 'Ungültiges Addon-Manifest: „manifest“ ist kein gültiges JSON.']);
    res = await put(signText(keys.privateKey, '[]'));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /kein JSON-Objekt/);
    res = await put({ manifest: '{"name":"\ud800"}', signature: good.signature });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ungültige Zeichen/);
    res = await put(signText(keys.privateKey, JSON.stringify({ ...manifest, zusatz: 'x'.repeat(70_000) })));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /zu groß/);
    res = await put({ manifest: 'x'.repeat(300_000), signature: good.signature });
    assert.equal(res.status, 413);
    assert.deepEqual((await webApi(service, 'GET', '/v1/team/addons', { cookie })).body.addons, [], 'nichts veröffentlicht');

    // Richtig: veröffentlicht, sofort im Store (sichtbar), mit genau dem signierten Text.
    res = await put(good);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.pending, []);
    assert.equal(res.body.keyConfigured, true);
    const [addon] = res.body.addons;
    assert.deepEqual(
      [addon.id, addon.name, addon.hidden, addon.downloads, addon.latest, addon.versions.length],
      ['uhrzeit', 'Uhrzeit', false, 0, '1.0.0', 1],
    );
    assert.deepEqual(Object.keys(addon.versions[0]).sort(), ['api', 'date', 'file', 'notes', 'publishedAt', 'publishedBy', 'sha256', 'size', 'version']);
    assert.deepEqual(
      [addon.versions[0].file, addon.versions[0].size, addon.versions[0].sha256, addon.versions[0].publishedBy],
      [fileName('uhrzeit', '1.0.0'), uhr1.length, sha256(uhr1), 'Chefin'],
    );
    const list = (await api(service.url, 'GET', '/v1/addons')).body.addons;
    assert.equal(list.length, 1);
    assert.equal(list[0].manifest, good.manifest);
    assert.equal(list[0].signature, good.signature);
  });

  test('Felder: jede Regel aus dem Manifest, unbekannte Zusatzfelder sind erlaubt', async () => {
    const data = Buffer.from('x');
    const rejected: [Record<string, unknown>, RegExp][] = [
      [{ type: undefined }, /„type“/],
      [{ type: 'heldix-update' }, /„type“/],
      [{ id: 'Uhrzeit' }, /„id“/],
      [{ id: 'a'.repeat(41) }, /„id“/],
      [{ id: 'a.b' }, /„id“/],
      [{ id: '-abc' }, /„id“/],
      [{ id: 7 }, /„id“/],
      [{ name: '' }, /„name“ darf nicht leer/],
      [{ name: '   ' }, /„name“ darf nicht leer/],
      [{ name: 'x'.repeat(41) }, /„name“ ist zu lang/],
      [{ name: '😀'.repeat(41) }, /„name“ ist zu lang/],
      [{ name: 'Uhr\nzeit' }, /„name“ enthält Zeichen/],
      [{ name: 'Uhr‮zeit' }, /„name“ enthält Zeichen/],
      [{ name: 5 }, /„name“ fehlt/],
      [{ version: '1.0' }, /„version“/],
      [{ version: '1.0.0+build' }, /„version“/],
      [{ version: undefined }, /„version“/],
      [{ summary: '' }, /„summary“ darf nicht leer/],
      [{ summary: 'x'.repeat(201) }, /„summary“ ist zu lang/],
      [{ summary: 'a\nb' }, /„summary“ enthält/],
      [{ description: 'x'.repeat(4001) }, /„description“ ist zu lang/],
      [{ description: 'a\r\nb' }, /„description“ enthält/],
      [{ description: 'a\tb' }, /„description“ enthält/],
      [{ description: undefined }, /„description“ fehlt/],
      [{ authors: [] }, /„authors“ muss 1 bis 5/],
      [{ authors: ['a', 'b', 'c', 'd', 'e', 'f'] }, /„authors“ muss 1 bis 5/],
      [{ authors: 'Team' }, /„authors“ fehlt oder ist keine Liste/],
      [{ authors: ['Team', ''] }, /„authors“ \(Eintrag 2\) darf nicht leer/],
      [{ authors: ['x'.repeat(41)] }, /„authors“ \(Eintrag 1\) ist zu lang/],
      [{ authors: [3] }, /„authors“ \(Eintrag 1\) fehlt/],
      [{ api: 0 }, /„api“/],
      [{ api: 100 }, /„api“/],
      [{ api: 1.5 }, /„api“/],
      [{ api: '2' }, /„api“/],
      [{ icon: 'Clock' }, /„icon“/],
      [{ icon: 'a'.repeat(31) }, /„icon“/],
      [{ icon: '' }, /„icon“/],
      [{ icon: 'uhr zeit' }, /„icon“/],
      [{ category: 'spiele' }, /„category“/],
      [{ category: 'HUD' }, /„category“/],
      [{ platforms: ['windows', 'windows'] }, /„platforms“/],
      [{ platforms: ['android'] }, /„platforms“/],
      [{ platforms: 'windows' }, /„platforms“/],
      [{ platforms: undefined }, /„platforms“/],
      [{ file: fileName('feldtest', '1.0.1') }, /„file“ muss genau heldix-addon-feldtest-1\.0\.0\.jar heißen/],
      [{ file: `../${fileName('feldtest', '1.0.0')}` }, /„file“/],
      [{ size: 0 }, /„size“/],
      [{ size: 50 * MIB + 1 }, /„size“/],
      [{ size: '1' }, /„size“/],
      [{ size: 1.5 }, /„size“/],
      [{ sha256: 'A'.repeat(64) }, /„sha256“/],
      [{ sha256: 'ab' }, /„sha256“/],
      [{ date: '25.11.2026' }, /„date“/],
      [{ date: '2026-02-30' }, /„date“/],
      [{ date: '2026-11-25T24:00:00Z' }, /„date“/],
      [{ date: 20261125 }, /„date“/],
      [{ notes: Array(21).fill('Neu') }, /„notes“ muss 0 bis 20/],
      [{ notes: [''] }, /„notes“ \(Eintrag 1\) darf nicht leer/],
      [{ notes: ['x'.repeat(301)] }, /„notes“ \(Eintrag 1\) ist zu lang/],
      [{ notes: undefined }, /„notes“ fehlt/],
      [{ notes: 'Neu' }, /„notes“ fehlt oder ist keine Liste/],
    ];
    for (const [extra, expected] of rejected) {
      const res = await put(signAddon(keys.privateKey, fields('feldtest', '1.0.0', data, extra)));
      assert.equal(res.status, 400, JSON.stringify(extra).slice(0, 80));
      assert.match(res.body.error, /^Ungültiges Addon-Manifest: /);
      assert.match(res.body.error, expected, JSON.stringify(extra).slice(0, 80));
    }
    // Erlaubt: Die Felder passen, es fehlt nur noch die Datei (409). Das letzte Beispiel ist größer als 16 KB.
    const accepted: Record<string, unknown>[] = [
      { homepage: 'https://example.invalid', zusatz: { tief: [1, 2] } },
      { name: '😀'.repeat(40), summary: 'x'.repeat(200), description: '' },
      { description: `${'Absatz „mit Anführungszeichen“ und "quotes".\n\n- Punkt\n'.repeat(60)}`.slice(0, 4000) },
      { authors: ['a', 'b', 'c', 'd', 'e'], notes: [], api: 99, icon: 'puzzle-2' },
      { platforms: ['windows', 'mac', 'linux'], category: 'sonstiges', date: '2026-11-25T18:30:00Z' },
      { date: '2026-11-25T18:30:00.123+01:00', size: 50 * MIB },
      { version: '1.0.0-beta.1', file: fileName('feldtest', '1.0.0-beta.1') },
      { notes: Array(20).fill('😀'.repeat(300)) },
    ];
    for (const extra of accepted) {
      const res = await put(signAddon(keys.privateKey, fields('feldtest', '1.0.0', data, extra)));
      assert.equal(res.status, 409, `${JSON.stringify(extra).slice(0, 80)}: ${JSON.stringify(res.body).slice(0, 200)}`);
      assert.match(res.body.error, /Erst die JAR hochladen/);
    }
  });

  test('Datei und Versionsregel: Größe, SHA-256, nur höhere Versionen (Vorabversion < fertige)', async () => {
    // Datei fehlt: 409; falsche Größe oder Prüfsumme: 400.
    let res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.1.0', uhr2)));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /^Erst die JAR hochladen/);
    assert.equal((await upload(service, cookie, fileName('uhrzeit', '1.1.0'), uhr2)).status, 200);
    res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.1.0', uhr2, { size: uhr2.length + 1 })));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Byte groß/);
    res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.1.0', uhr2, { sha256: sha256(uhr1) })));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Prüfsumme \(SHA-256\)/);

    // Gleiche, niedrigere Version und Vorabversion derselben Version: 409.
    res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.0.0', uhr1)));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /nicht höher als die vorhandene \(1\.0\.0\)/);
    assert.equal((await upload(service, cookie, fileName('uhrzeit', '1.0.0-beta.1'), uhrBeta)).status, 200);
    res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.0.0-beta.1', uhrBeta)));
    assert.equal(res.status, 409);

    // Höher: Vorabversion von 1.1.0, dann 1.1.0 selbst.
    assert.equal((await upload(service, cookie, fileName('uhrzeit', '1.1.0-beta.1'), uhrBeta)).status, 200);
    res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.1.0-beta.1', uhrBeta, { notes: ['Vorab'] })));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.1.0', uhr2, { notes: ['Sekunden', 'Farben'], api: 2 })));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const uhrzeit = res.body.addons.find((a: { id: string }) => a.id === 'uhrzeit');
    assert.equal(uhrzeit.latest, '1.1.0');
    assert.deepEqual(uhrzeit.versions.map((v: { version: string }) => v.version), ['1.1.0', '1.1.0-beta.1', '1.0.0']);
    assert.deepEqual(res.body.pending.map((p: { file: string }) => p.file), [fileName('uhrzeit', '1.0.0-beta.1')]);
    res = await put(signAddon(keys.privateKey, fields('uhrzeit', '1.0.5', uhr1)));
    assert.equal(res.status, 409);

    // Veröffentlichte Dateien lassen sich weder ersetzen noch einzeln löschen.
    for (const version of ['1.0.0', '1.1.0']) {
      assert.equal((await upload(service, cookie, fileName('uhrzeit', version), randomBytes(10))).status, 409, version);
      assert.equal((await webApi(service, 'DELETE', `/v1/team/addons/files/${fileName('uhrzeit', version)}`, { cookie })).status, 409, version);
    }
    assert.deepEqual(fs.readFileSync(path.join(addonsDir, fileName('uhrzeit', '1.1.0'))), uhr2);
  });

  test('Liste und Detail: alle Felder, signierter Text, neueste Version, Sortierung', async () => {
    assert.equal((await upload(service, cookie, fileName('spotify', '1.0.0'), spotify)).status, 200);
    const spotifyManifest = fields('spotify', '1.0.0', spotify, { category: 'musik', platforms: ['windows'], icon: 'music', summary: 'Zeigt den laufenden Titel.' });
    const signed = signAddon(keys.privateKey, spotifyManifest);
    assert.equal((await put(signed)).status, 200);

    const res = await api(service.url, 'GET', '/v1/addons');
    assert.equal(res.headers.get('cache-control'), 'max-age=60');
    const list = res.body.addons;
    // Gleich viele Downloads (0): nach Name.
    assert.deepEqual(list.map((a: { id: string; version: string }) => [a.id, a.version]), [
      ['spotify', '1.0.0'],
      ['uhrzeit', '1.1.0'],
    ]);
    for (const entry of list) {
      assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS);
      // Der Text ist signiert (mit Präfix), und die Felder sind genau die aus dem Text.
      assert.equal(verifyAddonSignature(entry.manifest, entry.signature, keys.publicKey), true);
      const { type, ...rest } = JSON.parse(entry.manifest);
      assert.equal(type, 'heldix-addon');
      assert.deepEqual({ ...rest, downloads: entry.downloads, publishedAt: entry.publishedAt, manifest: entry.manifest, signature: entry.signature }, entry);
      assert.equal(entry.downloads, 0);
      assert.equal(typeof entry.publishedAt, 'number');
    }
    assert.equal(list[0].manifest, signed.manifest);
    assert.deepEqual([list[0].category, list[0].platforms, list[1].api, list[1].notes], ['musik', ['windows'], 2, ['Sekunden', 'Farben']]);

    const detail = await api(service.url, 'GET', '/v1/addons/uhrzeit');
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(detail.body.addon, list[1]);
    assert.deepEqual(Object.keys(detail.body).sort(), ['addon', 'versions']);
    assert.deepEqual(
      detail.body.versions.map((v: Record<string, unknown>) => {
        assert.deepEqual(Object.keys(v).sort(), ['api', 'date', 'file', 'notes', 'publishedAt', 'sha256', 'size', 'version']);
        return [v.version, v.file, v.size, v.sha256, v.api, v.notes, v.date];
      }),
      [
        ['1.1.0', fileName('uhrzeit', '1.1.0'), uhr2.length, sha256(uhr2), 2, ['Sekunden', 'Farben'], '2026-11-25'],
        ['1.1.0-beta.1', fileName('uhrzeit', '1.1.0-beta.1'), uhrBeta.length, sha256(uhrBeta), 1, ['Vorab'], '2026-11-25'],
        ['1.0.0', fileName('uhrzeit', '1.0.0'), uhr1.length, sha256(uhr1), 1, ['Erste Version'], '2026-11-25'],
      ],
    );
    for (const id of ['gibtsnicht', 'Uhrzeit', 'a'.repeat(41), 'uhr%2Fzeit']) {
      const missing = await api(service.url, 'GET', `/v1/addons/${id}`);
      assert.deepEqual([missing.status, missing.body], [404, { error: NO_ADDON }], id);
    }
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.addons, 2);
  });

  test('Download: JAR mit Typ, ETag, Range und Cache; nur ein vollständiges GET zählt', async () => {
    const file = fileName('uhrzeit', '1.1.0');
    const url = `/v1/addons/uhrzeit/files/${file}`;
    const res = await rawRequest(service.url, 'GET', url);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, uhr2);
    assert.equal(res.headers['content-type'], 'application/java-archive');
    assert.equal(res.headers['content-disposition'], `attachment; filename="${file}"`);
    assert.equal(res.headers['content-length'], String(uhr2.length));
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.headers.etag);
    assert.ok(res.headers['last-modified']);
    await waitFor(async () => (await downloads('uhrzeit')) === 1);

    // HEAD, Teilbereiche und 416 zählen nicht.
    const head = await rawRequest(service.url, 'HEAD', url);
    assert.deepEqual([head.status, head.headers['content-length'], head.body.length], [200, String(uhr2.length), 0]);
    const part = await rawRequest(service.url, 'GET', url, { Range: 'bytes=10-19' });
    assert.deepEqual([part.status, part.headers['content-range']], [206, `bytes 10-19/${uhr2.length}`]);
    assert.deepEqual(part.body, uhr2.subarray(10, 20));
    const tail = await rawRequest(service.url, 'GET', url, { Range: 'bytes=-100', 'If-Range': String(head.headers.etag) });
    assert.deepEqual([tail.status, tail.body], [206, uhr2.subarray(uhr2.length - 100)]);
    const outside = await rawRequest(service.url, 'GET', url, { Range: `bytes=${uhr2.length}-` });
    assert.deepEqual([outside.status, outside.headers['content-range'], outside.headers['access-control-allow-origin']], [416, `bytes */${uhr2.length}`, '*']);
    await sleep(50);
    assert.equal(await downloads('uhrzeit'), 1);
    // If-Range passt nicht mehr: die ganze Datei, das zählt.
    const changed = await rawRequest(service.url, 'GET', url, { Range: 'bytes=0-9', 'If-Range': '"anders"' });
    assert.deepEqual([changed.status, changed.body.length], [200, uhr2.length]);
    await waitFor(async () => (await downloads('uhrzeit')) === 2);
    // Ältere Versionen bleiben ladbar und zählen für dasselbe Addon.
    const older = await rawRequest(service.url, 'GET', `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.0.0')}`);
    assert.deepEqual([older.status, older.body], [200, uhr1]);
    await waitFor(async () => (await downloads('uhrzeit')) === 3);

    // Nur Dateien veröffentlichter Versionen genau dieses Addons.
    for (const p of [
      `/v1/addons/spotify/files/${file}`,
      `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.0.0-beta.1')}`,
      `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '7.0.0')}`,
      `/v1/addons/gibtsnicht/files/${file}`,
    ]) {
      const missing = await rawRequest(service.url, 'GET', p);
      assert.equal(missing.status, 404, p);
      assert.equal(missing.headers['access-control-allow-origin'], '*', p);
    }

    // Weiterleitung auf die neueste Datei (Knopf der Webseite), zählt selbst nicht.
    for (const method of ['GET', 'HEAD']) {
      const redirect = await rawRequest(service.url, method, '/v1/addons/uhrzeit/download');
      assert.equal(redirect.status, 302, method);
      assert.equal(redirect.headers.location, `/v1/addons/uhrzeit/files/${file}`);
      assert.equal(redirect.headers['cache-control'], 'no-cache');
      assert.equal(redirect.headers['access-control-allow-origin'], '*');
    }
    await sleep(50);
    assert.equal(await downloads('uhrzeit'), 3);
    // Mehr Downloads: zuerst in der Liste; die Team-Übersicht zeigt dieselbe Zahl.
    assert.deepEqual((await api(service.url, 'GET', '/v1/addons')).body.addons.map((a: { id: string; downloads: number }) => [a.id, a.downloads]), [
      ['uhrzeit', 3],
      ['spotify', 0],
    ]);
    const overview = (await webApi(service, 'GET', '/v1/team/addons', { cookie })).body;
    assert.equal(overview.addons.find((a: { id: string }) => a.id === 'uhrzeit').downloads, 3);
  });

  test('Verstecken: aus dem Store genommen (404), Dateien bleiben; wieder zeigen', async () => {
    const patch = (id: string, body: unknown) => webApi(service, 'PATCH', `/v1/team/addons/${id}`, { cookie, body });
    let res = await patch('uhrzeit', { hidden: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.addons.find((a: { id: string }) => a.id === 'uhrzeit').hidden, true);
    assert.deepEqual((await api(service.url, 'GET', '/v1/addons')).body.addons.map((a: { id: string }) => a.id), ['spotify']);
    for (const p of ['/v1/addons/uhrzeit', '/v1/addons/uhrzeit/download', `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.1.0')}`]) {
      const hidden = await rawRequest(service.url, 'GET', p);
      assert.equal(hidden.status, 404, p);
      assert.equal(hidden.headers['access-control-allow-origin'], '*', p);
    }
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.addons, 1);
    assert.ok(fs.existsSync(path.join(addonsDir, fileName('uhrzeit', '1.1.0'))), 'Datei bleibt');
    // Nochmal verstecken: keine Änderung, kein zweiter Eintrag im Protokoll.
    assert.equal((await patch('uhrzeit', { hidden: true })).status, 200);

    for (const body of [{}, { hidden: 'ja' }, { hidden: 1 }]) assert.equal((await patch('uhrzeit', body)).status, 400, JSON.stringify(body));
    const unknown = await patch('gibtsnicht', { hidden: true });
    assert.deepEqual([unknown.status, unknown.body.error], [404, NO_ADDON]);

    res = await patch('uhrzeit', { hidden: false });
    assert.equal(res.status, 200);
    assert.equal((await api(service.url, 'GET', '/v1/addons/uhrzeit')).status, 200);
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.addons, 2);
    const actions = await audit();
    assert.equal(actions.filter((a) => a === 'addon.hide uhrzeit').length, 1);
    assert.ok(actions.includes('addon.show uhrzeit'));
  });

  test('Löschen: unveröffentlichte Dateien, Versionen samt Datei; die letzte Version entfernt das Addon ganz', async () => {
    // Unveröffentlichte Datei
    const pending = fileName('uhrzeit', '1.0.0-beta.1');
    let res = await webApi(service, 'DELETE', `/v1/team/addons/files/${pending}`, { cookie });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.pending, []);
    assert.equal(fs.existsSync(path.join(addonsDir, pending)), false);
    assert.equal((await webApi(service, 'DELETE', `/v1/team/addons/files/${pending}`, { cookie })).status, 404);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/addons/files/heldix-dienst.db', { cookie })).status, 404);

    // Neueste Version löschen: die nächstältere ist wieder die neueste.
    res = await webApi(service, 'DELETE', '/v1/team/addons/uhrzeit/versions/1.1.0', { cookie });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.addons.find((a: { id: string }) => a.id === 'uhrzeit').latest, '1.1.0-beta.1');
    assert.equal(fs.existsSync(path.join(addonsDir, fileName('uhrzeit', '1.1.0'))), false);
    assert.equal((await rawRequest(service.url, 'GET', `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.1.0')}`)).status, 404);
    assert.equal((await rawRequest(service.url, 'GET', '/v1/addons/uhrzeit/download')).headers.location, `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.1.0-beta.1')}`);
    assert.equal((await api(service.url, 'GET', '/v1/addons/uhrzeit')).body.addon.version, '1.1.0-beta.1');
    for (const p of ['/v1/team/addons/uhrzeit/versions/1.1.0', '/v1/team/addons/uhrzeit/versions/1.x', '/v1/team/addons/gibtsnicht/versions/1.0.0']) {
      const missing = await webApi(service, 'DELETE', p, { cookie });
      assert.deepEqual([missing.status, missing.body.error], [404, 'Diese Version gibt es nicht.'], p);
    }

    // Die letzte Version von Spotify: Das Addon ist ganz weg (auch aus dem Team-Bereich).
    res = await webApi(service, 'DELETE', '/v1/team/addons/spotify/versions/1.0.0', { cookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.addons.map((a: { id: string }) => a.id), ['uhrzeit']);
    assert.equal((await api(service.url, 'GET', '/v1/addons/spotify')).status, 404);
    assert.deepEqual((await api(service.url, 'GET', '/v1/addons')).body.addons.map((a: { id: string }) => a.id), ['uhrzeit']);
    assert.equal((await api(service.url, 'GET', '/v1/status')).body.addons, 1);
    assert.equal(fs.existsSync(path.join(addonsDir, fileName('spotify', '1.0.0'))), false);
    // Neu veröffentlicht beginnt es wieder bei 0 Downloads.
    assert.equal((await upload(service, cookie, fileName('spotify', '1.0.0'), spotify)).status, 200);
    assert.equal((await put(signAddon(keys.privateKey, fields('spotify', '1.0.0', spotify)))).status, 200);
    assert.equal(await downloads('spotify'), 0);
  });

  test('Protokoll: addon.upload, addon.publish, addon.hide, addon.show und addon.delete', async () => {
    const actions = await audit();
    for (const entry of [
      `addon.upload ${fileName('uhrzeit', '1.0.0')}`,
      'addon.publish uhrzeit 1.0.0',
      'addon.publish uhrzeit 1.1.0',
      'addon.publish spotify 1.0.0',
      'addon.hide uhrzeit',
      'addon.show uhrzeit',
      `addon.delete ${fileName('uhrzeit', '1.0.0-beta.1')}`,
      'addon.delete uhrzeit 1.1.0',
      'addon.delete spotify 1.0.0',
    ]) {
      assert.ok(actions.includes(entry), entry);
    }
    const entries = (await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries;
    const upload1 = entries.find((e: { action: string; target: string }) => e.action === 'addon.upload' && e.target === fileName('uhrzeit', '1.0.0'));
    assert.equal(upload1.detail, `${uhr1.length} Byte, SHA-256 ${sha256(uhr1)}`);
    assert.equal(upload1.actor.name, 'Chefin');
  });

  test('Team-Rechte: nur Admin mit 2FA und Cookie; Moderator 403, Bearer-Token 401, ohne CSRF-Header 403', async () => {
    const file = fileName('uhrzeit', '3.0.0');
    const signed = signAddon(keys.privateKey, fields('uhrzeit', '3.0.0', uhr1));
    const routes: [string, string, unknown][] = [
      ['GET', '/v1/team/addons', undefined],
      ['PUT', '/v1/team/addons/manifest', signed],
      ['PATCH', '/v1/team/addons/uhrzeit', { hidden: true }],
      ['DELETE', '/v1/team/addons/uhrzeit/versions/1.0.0', undefined],
      ['DELETE', `/v1/team/addons/files/${file}`, undefined],
    ];
    const fresh = await webLogin(service, chefin); // neue Sitzung: 2FA noch nicht bestätigt
    for (const [method, p, body] of routes) {
      const mod = await webApi(service, method, p, { cookie: modCookie, body });
      assert.deepEqual([mod.status, mod.body.code], [403, 'forbidden'], `${method} ${p}`);
      const unverified = await webApi(service, method, p, { cookie: fresh.cookie, body });
      assert.deepEqual([unverified.status, unverified.body.code], [403, '2fa_required'], `${method} ${p}`);
      assert.equal((await webApi(service, method, p, { body })).status, 401, `${method} ${p} ohne Cookie`);
      assert.equal((await api(service.url, method, p, { token: chefin.token, body })).status, 401, `${method} ${p} mit Bearer`);
      if (method !== 'GET') {
        assert.equal((await webApi(service, method, p, { cookie, body, csrf: false })).status, 403, `${method} ${p} ohne CSRF`);
        assert.equal((await webApi(service, method, p, { cookie, body, headers: { Origin: 'https://boese.example' } })).status, 403);
      }
    }
    const mod = await upload(service, modCookie, file, uhr1);
    assert.deepEqual([mod.status, mod.body.code], [403, 'forbidden']);
    assert.equal((await upload(service, null, file, uhr1)).status, 401);
    assert.equal((await upload(service, cookie, file, uhr1, { 'X-Heldix-Web': '0' })).status, 403);
    assert.equal(fs.existsSync(path.join(addonsDir, file)), false, 'nichts hochgeladen');
    // Nichts davon hat etwas geändert.
    const overview = (await webApi(service, 'GET', '/v1/team/addons', { cookie })).body;
    assert.deepEqual(overview.addons.map((a: { id: string; hidden: boolean; latest: string }) => [a.id, a.hidden, a.latest]), [
      ['spotify', false, '1.0.0'],
      ['uhrzeit', false, '1.1.0-beta.1'],
    ]);
  });

  test('kein Weg aus dem Addon-Ordner: Traversal, fremde Dateien, symbolische Links', async () => {
    fs.writeFileSync(path.join(addonsDir, 'notiz.txt'), 'geheim');
    fs.writeFileSync(path.join(addonsDir, `${fileName('uhrzeit', '5.0.0')}.part`), 'geheim');
    const outside = path.join(path.dirname(addonsDir), `${path.basename(addonsDir)}-geheim.jar`);
    fs.writeFileSync(outside, 'geheim');
    try {
      const paths = [
        `/v1/addons/uhrzeit/files/..%2F${path.basename(outside)}`,
        `/v1/addons/uhrzeit/files/%2E%2E%2F${path.basename(outside)}`,
        `/v1/addons/uhrzeit/files/..%5C${path.basename(outside)}`,
        `/v1/addons/uhrzeit/files/../../${path.basename(outside)}`,
        '/v1/addons/uhrzeit/files/..%2F..%2Fheldix-dienst.db',
        '/v1/addons/uhrzeit/files/notiz.txt',
        `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '5.0.0')}.part`,
        `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.0.0')}%00`,
        `/v1/addons/uhrzeit/files/sub/${fileName('uhrzeit', '1.0.0')}`,
        `/v1/addons/..%2Fuhrzeit/files/${fileName('uhrzeit', '1.0.0')}`,
        '/v1/addons/%2E%2E/download',
        '/v1/addons/uhrzeit/files/',
      ];
      for (const p of paths) {
        const res = await rawRequest(service.url, 'GET', p);
        assert.equal(res.status, 404, p);
        assert.equal(res.body.includes('geheim'), false, p);
      }
      // Team: Traversal im Namen ist kein gültiger Name.
      for (const name of [`..%2F${fileName('uhrzeit', '6.0.0')}`, `${fileName('uhrzeit', '6.0.0')}%2F..`, '..%5Cnotiz.txt']) {
        assert.equal((await upload(service, cookie, name, uhr1)).status, 400, name);
        assert.equal((await webApi(service, 'DELETE', `/v1/team/addons/files/${name}`, { cookie })).status, 404, name);
      }
      assert.equal(fs.existsSync(path.join(path.dirname(addonsDir), fileName('uhrzeit', '6.0.0'))), false);
      // Fremde Dateien stehen nicht bei den unveröffentlichten.
      assert.deepEqual((await webApi(service, 'GET', '/v1/team/addons', { cookie })).body.pending, []);

      // Symbolischer Link nach draußen: weder unveröffentlicht noch veröffentlichbar (auf Windows ohne Rechte übersprungen).
      const linkName = fileName('linktest', '1.0.0');
      let linked = true;
      try {
        fs.symlinkSync(outside, path.join(addonsDir, linkName), 'file');
      } catch {
        linked = false;
      }
      if (linked) {
        assert.deepEqual((await webApi(service, 'GET', '/v1/team/addons', { cookie })).body.pending, []);
        const res = await put(signAddon(keys.privateKey, fields('linktest', '1.0.0', Buffer.from('geheim'))));
        assert.equal(res.status, 409);
        // Eine veröffentlichte Datei, die durch einen Link nach draußen ersetzt wurde: 404.
        const published = path.join(addonsDir, fileName('uhrzeit', '1.0.0'));
        fs.rmSync(published);
        fs.symlinkSync(outside, published, 'file');
        const served = await rawRequest(service.url, 'GET', `/v1/addons/uhrzeit/files/${fileName('uhrzeit', '1.0.0')}`);
        assert.equal(served.status, 404);
        assert.equal(served.body.includes('geheim'), false);
        fs.rmSync(published);
        fs.writeFileSync(published, uhr1);
      }
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

test('ohne Update-Schlüssel: Veröffentlichen 503, keyConfigured false, Hochladen geht', async () => {
  const clock = new Clock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-addons-'));
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, addonsDir: dir });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const data = randomBytes(1000);
    assert.equal((await upload(service, cookie, fileName('uhrzeit', '1.0.0'), data)).status, 200);
    const signed = signAddon(generateKeyPairSync('ed25519').privateKey, fields('uhrzeit', '1.0.0', data));
    const res = await webApi(service, 'PUT', '/v1/team/addons/manifest', { cookie, body: signed });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /kein Update-Schlüssel/);
    const overview = (await webApi(service, 'GET', '/v1/team/addons', { cookie })).body;
    assert.equal(overview.keyConfigured, false);
    assert.deepEqual(overview.pending.map((p: { file: string }) => p.file), [fileName('uhrzeit', '1.0.0')]);
  } finally {
    await service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Standardordner <Daten>/addons und höchstens N Addon-Downloads pro IP (hier 2), dann 429 mit CORS', async () => {
  const service = await startService({ addonDownloadRateLimit: 2 });
  try {
    // Eine Version direkt in Datenbank und Ordner (wie nach dem Veröffentlichen).
    const data = randomBytes(500);
    const file = fileName('uhrzeit', '1.0.0');
    fs.mkdirSync(path.join(service.dataDir, 'addons'), { recursive: true });
    fs.writeFileSync(path.join(service.dataDir, 'addons', file), data);
    const store = new Store(service.dataDir);
    try {
      store.insertAddonVersion({
        id: 'uhrzeit',
        version: '1.0.0',
        manifest: JSON.stringify(fields('uhrzeit', '1.0.0', data)),
        signature: 'c2ln',
        file,
        size: data.length,
        sha256: sha256(data),
        publishedAt: Date.now(),
        publishedBy: null,
      });
    } finally {
      store.close();
    }
    const url = `/v1/addons/uhrzeit/files/${file}`;
    for (let i = 0; i < 2; i++) assert.equal((await rawRequest(service.url, 'GET', url)).status, 200);
    const limited = await rawRequest(service.url, 'GET', url);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['access-control-allow-origin'], '*');
    assert.ok(Number(limited.headers['retry-after']) >= 1);
    assert.equal(JSON.parse(limited.body.toString('utf8')).error, 'Zu viele Downloads. Bitte kurz warten.');
    // Liste und Weiterleitung zählen nicht zur Grenze.
    assert.equal((await api(service.url, 'GET', '/v1/addons')).body.addons.length, 1);
    assert.equal((await rawRequest(service.url, 'GET', '/v1/addons/uhrzeit/download')).status, 302);
    await waitFor(async () => (await api(service.url, 'GET', '/v1/addons/uhrzeit')).body.addon.downloads === 2);
  } finally {
    await service.close();
  }
});
