// Addons von Spielern: Einreichen (Entwurf, JAR, Angaben, Screenshots), Prüfung im Team-Bereich (Freigeben nur mit
// gültiger Signatur, Ablehnen), Besitz der Addon-IDs, Grenzen, Bewertungen, Meldungen, Entwicklerseite, Echtzeit,
// Datenexport und Löschen, Aufräumen.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ADDON_SIGNATURE_PREFIX, verifyAddonSignature } from '../src/addons';
import { Store } from '../src/db';
import { SESSION_COOKIE } from '../src/web';
import { api, connect, devPlayer, rawRequest, rawUpload, sleep, startService, waitFor, type Player, type TestService } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';
import { addonJar, buildZip, classFile, entry, jpeg, png } from './zip-builder';

const MIB = 1024 * 1024;
const TAKEN = 'Diese Addon-ID gehört schon jemand anderem.';
const NO_SUBMISSION = 'Diese Einreichung gibt es nicht.';
const WRONG_SIGNATURE = 'Die Signatur stimmt nicht.';
const SUBMISSION_KEYS = [
  'access',
  'addonId',
  'api',
  'authors',
  'category',
  'createdAt',
  'description',
  'icon',
  'id',
  'inspection',
  'loaders',
  'minecraft',
  'name',
  'notes',
  'platforms',
  'reviewNote',
  'reviewedAt',
  'reviewer',
  'screenshots',
  'sha256',
  'size',
  'status',
  'submittedAt',
  'summary',
  'version',
];

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Antwort von api() oder rawUpload(), wenn nur Status und Körper zählen. */
type AnyResponse = { status: number; body: any };

/** Signatur wie ein Admin auf der Webseite: Ed25519 über "heldix-addon\n" + Manifest. */
function signManifest(manifest: string, key: KeyObject): string {
  return sign(null, Buffer.from(ADDON_SIGNATURE_PREFIX + manifest, 'utf8'), key).toString('base64');
}

/** Manifest eines offiziellen Addons wie `npm run addon`. */
function officialManifest(id: string, version: string, data: Buffer): string {
  return JSON.stringify({
    type: 'heldix-addon',
    id,
    name: id,
    version,
    summary: 'Vom Team.',
    description: '',
    authors: ['HeldixClient-Team'],
    api: 1,
    icon: 'clock',
    category: 'hud',
    platforms: [],
    file: `heldix-addon-${id}-${version}.jar`,
    size: data.length,
    sha256: sha256(data),
    date: '2026-11-26',
    notes: [],
    official: true,
    author: null,
  });
}

/** Die JAR des Beispiel-Addons „wetter“: Netzwerk und Minecraft-Klassen (für die Hinweise). */
function wetterJar(version: string, meta: Record<string, unknown> = {}): Buffer {
  return addonJar('wetter', version, {
    meta: { description: 'Zeigt das Wetter im HUD.', ...meta },
    extra: [
      entry('dev/beispiel/wetter/Netz.class', classFile('java/net/URL', 'java/lang/String')),
      entry('dev/beispiel/wetter/Welt.class', classFile('net/minecraft/client/MinecraftClient')),
    ],
  });
}

describe('Addons von Spielern', () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  let service: TestService;
  let addonsDir: string;
  let submissionsDir: string;
  let admin: string;
  /** Prüft Einreichungen (ab 1.12.0 die Rolle Entwickler; Recht „Addons“) */
  let mod: string;
  /** Moderator: darf ab 1.12.0 nur Meldungen zu Addons, keine Einreichungen */
  let moderator: string;
  let chefin: Player;
  let anna: Player;
  let ben: Player;
  let carla: Player;
  let wetterSid: string;
  const wetter1 = wetterJar('1.0.0');
  const shot1 = png(1280, 720, 100);
  const shot2 = jpeg(1920, 1080);

  const call = (method: string, p: string, player: Player, body?: unknown) => api(service.url, method, p, { token: player.token, body });
  const upload = (p: string, player: Player, data: Buffer, declared?: number) =>
    rawUpload(service.url, 'PUT', p, data, { Authorization: `Bearer ${player.token}` }, declared);
  const team = (method: string, p: string, body?: unknown, cookie = admin) => webApi(service, method, p, { cookie, body });
  const audit = async () =>
    ((await team('GET', '/v1/team/audit')).body.entries as { action: string; target: string }[]).map((e) => `${e.action} ${e.target}`);
  const filesIn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

  /** Neuer Entwurf, auf Wunsch gleich mit JAR. */
  async function draft(player: Player, jar?: Buffer, fields: Record<string, unknown> = {}): Promise<string> {
    const created = await call('POST', '/v1/addon-submissions', player, fields);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sid = created.body.submission.id as string;
    if (jar) {
      const res = await upload(`/v1/addon-submissions/${sid}/jar`, player, jar);
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    return sid;
  }

  async function submitted(player: Player, jar: Buffer, fields: Record<string, unknown> = {}): Promise<string> {
    const sid = await draft(player, jar, fields);
    const res = await call('POST', `/v1/addon-submissions/${sid}/submit`, player);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return sid;
  }

  async function approve(sid: string) {
    const detail = await team('GET', `/v1/team/addon-submissions/${sid}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const res = await team('POST', `/v1/team/addon-submissions/${sid}/approve`, { signature: signManifest(detail.body.submission.manifest, keys.privateKey) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.submission;
  }

  before(async () => {
    addonsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-einreichungen-'));
    submissionsDir = path.join(addonsDir, 'einreichungen');
    service = await startService({
      dev: true,
      website: WEBSITE,
      totpNow: clock.read,
      addonsDir,
      updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    chefin = await devPlayer(service.url, 'Chefin');
    admin = (await teamLogin(service, chefin, 'admin', clock)).cookie;
    mod = (await teamLogin(service, await devPlayer(service.url, 'Entwickler'), 'developer-team', clock)).cookie;
    moderator = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    carla = await devPlayer(service.url, 'Carla');
  });
  after(async () => {
    await service.close();
    fs.rmSync(addonsDir, { recursive: true, force: true });
  });

  test('Entwurf, JAR (geprüft), Angaben, Screenshots, Einreichen; nur der Einreicher sieht und ändert', async () => {
    const created = await call('POST', '/v1/addon-submissions', anna, {});
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sub = created.body.submission;
    wetterSid = sub.id;
    assert.deepEqual(Object.keys(sub).sort(), SUBMISSION_KEYS);
    assert.match(sub.id, /^[A-Za-z0-9_-]{16}$/);
    assert.deepEqual(
      [sub.status, sub.addonId, sub.name, sub.summary, sub.category, sub.icon, sub.platforms, sub.notes, sub.screenshots, sub.inspection, sub.submittedAt, sub.reviewer],
      ['draft', null, '', '', 'sonstiges', 'addons', [], [], 0, null, null, null],
    );
    let res: AnyResponse = await call('POST', `/v1/addon-submissions/${wetterSid}/submit`, anna);
    assert.deepEqual([res.status, res.body.error], [400, 'Bitte zuerst die JAR hochladen.']);

    // JAR: geprüft, Name und Kurzbeschreibung aus heldix.addon.json, Autor = Einreicher, Hinweise aus den Klassen.
    res = await upload(`/v1/addon-submissions/${wetterSid}/jar`, anna, wetter1);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    let s = res.body.submission;
    assert.deepEqual(
      [s.addonId, s.version, s.api, s.size, s.sha256, s.name, s.summary, s.authors, s.inspection],
      ['wetter', '1.0.0', 2, wetter1.length, sha256(wetter1), 'Addon wetter', 'Zeigt das Wetter im HUD.', ['Anna'], { classes: 3, uses: ['netzwerk', 'minecraft'], expected: [] }],
    );
    assert.deepEqual(filesIn(submissionsDir), [`${wetterSid}.jar`]);
    assert.deepEqual(fs.readFileSync(path.join(submissionsDir, `${wetterSid}.jar`)), wetter1);

    // Kaputte JAR: 400 mit Hinweis, die bisherige bleibt, keine Reste.
    for (const [bad, pattern] of [
      [Buffer.from('keine jar'), /keine gültige JAR/],
      [addonJar('wetter', '1.0.0', { extra: [entry('../boese.class', 'x')] }), /ungültigen Pfad/],
      [addonJar('Wetter', '1.0.0'), /„id“ in heldix\.addon\.json/],
      [buildZip([entry('heldix.addon.json', JSON.stringify({ id: 'wetter', name: 'W', version: '1.0.0', entrypoint: 'dev.x.Fehlt', api: 1 }))]), /Einstiegsklasse dev.x.Fehlt/],
    ] as [Buffer, RegExp][]) {
      res = await upload(`/v1/addon-submissions/${wetterSid}/jar`, anna, bad);
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.error, pattern);
    }
    assert.deepEqual(filesIn(submissionsDir), [`${wetterSid}.jar`]);
    assert.equal((await call('GET', '/v1/addon-submissions', anna)).body.submissions[0].sha256, sha256(wetter1));

    // Store-Angaben (Texte getrimmt, Zeilenumbrüche vereinheitlicht) und ihre Prüfung
    res = await call('PATCH', `/v1/addon-submissions/${wetterSid}`, anna, {
      name: '  Wetter ',
      description: 'Absatz eins.\r\n\r\n- Punkt  ',
      category: 'werkzeuge',
      icon: 'cloud',
      platforms: ['windows', 'linux'],
      notes: ['Erste Version'],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    s = res.body.submission;
    assert.deepEqual([s.name, s.description, s.category, s.icon, s.platforms, s.notes], ['Wetter', 'Absatz eins.\n\n- Punkt', 'werkzeuge', 'cloud', ['windows', 'linux'], ['Erste Version']]);
    for (const [body, pattern] of [
      [{ name: 'x'.repeat(41) }, /„name“ ist zu lang/],
      [{ name: 5 }, /„name“ muss ein Text sein/],
      [{ summary: 'a\nb' }, /„summary“ enthält Zeichen/],
      [{ description: 'a\tb' }, /„description“ enthält Zeichen/],
      [{ description: 'x'.repeat(4001) }, /„description“ ist zu lang/],
      [{ category: 'spiele' }, /„category“/],
      [{ icon: 'Wolke' }, /„icon“/],
      [{ platforms: ['windows', 'windows'] }, /„platforms“/],
      [{ platforms: ['android'] }, /„platforms“/],
      [{ notes: Array(21).fill('x') }, /„notes“/],
      [{ notes: [''] }, /„notes \(Eintrag 1\)“ darf nicht leer/],
    ] as [Record<string, unknown>, RegExp][]) {
      res = await call('PATCH', `/v1/addon-submissions/${wetterSid}`, anna, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(res.body.error, pattern, JSON.stringify(body));
    }
    res = await api(service.url, 'PATCH', `/v1/addon-submissions/${wetterSid}`, { token: anna.token, rawBody: JSON.stringify({ description: 'x'.repeat(70_000) }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 413);

    // Screenshots: der Reihe nach, PNG oder JPEG, Größe aus dem Dateikopf, höchstens 2 MiB
    const shots = (n: number) => `/v1/addon-submissions/${wetterSid}/screenshots/${n}`;
    assert.equal((await upload(shots(1), anna, shot1)).body.submission.screenshots, 1);
    assert.equal((await upload(shots(2), anna, png(640, 360))).body.submission.screenshots, 2);
    for (const [n, data, status, pattern] of [
      [4, shot1, 400, /der Reihe nach/],
      [3, Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(100)]), 400, /PNG- oder JPEG/],
      [3, png(100, 100), 400, /100×100 Pixel/],
      [3, png(4000, 2000), 400, /4000×2000 Pixel/],
      [3, jpeg(1920, 100), 400, /1920×100/],
    ] as [number, Buffer, number, RegExp][]) {
      res = await upload(shots(n), anna, data);
      assert.equal(res.status, status, `${n}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.error, pattern);
    }
    res = await upload(shots(3), anna, shot1.subarray(0, 100), 2 * MIB + 1);
    assert.equal(res.status, 413);
    assert.equal((await upload(shots(5), anna, shot1)).status, 404);
    // Ersetzen (die alte Datei verschwindet), löschen (die folgenden rücken auf), wieder anhängen
    assert.equal((await upload(shots(2), anna, shot2)).body.submission.screenshots, 2);
    assert.equal(filesIn(submissionsDir).length, 3, filesIn(submissionsDir).join(', '));
    assert.equal((await call('DELETE', shots(1), anna)).body.submission.screenshots, 1);
    assert.equal((await call('DELETE', shots(2), anna)).status, 404);
    let own = await rawRequest(service.url, 'GET', shots(1), { Authorization: `Bearer ${anna.token}` });
    assert.deepEqual([own.status, own.headers['content-type'], own.body], [200, 'image/jpeg', shot2]);
    assert.equal((await upload(shots(2), anna, shot1)).body.submission.screenshots, 2);
    own = await rawRequest(service.url, 'GET', shots(2), { Authorization: `Bearer ${anna.token}` });
    assert.deepEqual([own.status, own.headers['content-type'], own.headers['cache-control'], own.body], [200, 'image/png', 'private, no-store', shot1]);
    assert.match(String(own.headers['content-disposition']), /^inline;/);
    assert.equal((await rawRequest(service.url, 'GET', shots(3), { Authorization: `Bearer ${anna.token}` })).status, 404);
    assert.equal(filesIn(submissionsDir).length, 3);
    assert.equal(filesIn(submissionsDir).some((f) => f.includes('.upload')), false, 'keine Reste');

    // Fremde sehen nichts (404 wie unbekannt), ohne Anmeldung 401; mit Cookie nur mit CSRF-Schutz
    for (const [method, p] of [
      ['PATCH', `/v1/addon-submissions/${wetterSid}`],
      ['DELETE', `/v1/addon-submissions/${wetterSid}`],
      ['POST', `/v1/addon-submissions/${wetterSid}/submit`],
      ['DELETE', shots(1)],
      ['GET', shots(1)],
      ['PATCH', '/v1/addon-submissions/AAAAAAAAAAAAAAAA'],
      ['PATCH', '/v1/addon-submissions/..%2F..%2Fx'],
    ]) {
      const foreign = await call(method!, p!, ben, method === 'PATCH' ? {} : undefined);
      assert.deepEqual([foreign.status, foreign.body?.error], [404, NO_SUBMISSION], `${method} ${p}`);
    }
    assert.equal((await upload(`/v1/addon-submissions/${wetterSid}/jar`, ben, wetter1)).status, 404);
    assert.equal((await api(service.url, 'GET', '/v1/addon-submissions')).status, 401);
    assert.deepEqual((await call('GET', '/v1/addon-submissions', ben)).body, { submissions: [], addons: [] });
    const web = await webLogin(service, anna);
    assert.equal((await webApi(service, 'GET', '/v1/addon-submissions', { cookie: web.cookie })).body.submissions.length, 1);
    assert.equal((await webApi(service, 'PATCH', `/v1/addon-submissions/${wetterSid}`, { cookie: web.cookie, body: {}, csrf: false })).status, 403);
    assert.equal((await webApi(service, 'PATCH', `/v1/addon-submissions/${wetterSid}`, { cookie: web.cookie, body: { summary: 'Zeigt das Wetter.' } })).status, 200);

    // Einreichen: danach unveränderlich
    res = await call('POST', `/v1/addon-submissions/${wetterSid}/submit`, anna);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    s = res.body.submission;
    assert.equal(s.status, 'pending');
    assert.ok(s.submittedAt >= s.createdAt);
    for (const [method, p] of [
      ['PATCH', `/v1/addon-submissions/${wetterSid}`],
      ['POST', `/v1/addon-submissions/${wetterSid}/submit`],
      ['DELETE', shots(1)],
    ]) {
      assert.equal((await call(method!, p!, anna, method === 'PATCH' ? { name: 'Neu' } : undefined)).status, 409, `${method} ${p}`);
    }
    assert.equal((await upload(`/v1/addon-submissions/${wetterSid}/jar`, anna, wetter1)).status, 409);
    assert.equal((await upload(shots(3), anna, shot1)).status, 409);
    const list = (await call('GET', '/v1/addon-submissions', anna)).body;
    assert.deepEqual([list.submissions.map((x: { status: string }) => x.status), list.addons], [['pending'], []]);
  });

  test('Team: Liste und Details mit genau dem Manifest, das signiert wird; JAR und Screenshots zum Prüfen; Rechte', async () => {
    // Nie eingereichte Entwürfe sind privat.
    const privat = await draft(anna);
    let res = await team('GET', '/v1/team/addon-submissions', undefined, mod);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.submissions.map((x: { id: string }) => x.id), [wetterSid]);
    const item = res.body.submissions[0];
    assert.deepEqual(Object.keys(item).sort(), [...SUBMISSION_KEYS, 'submitter'].sort());
    assert.deepEqual(item.submitter, { uuid: anna.uuid, name: 'Anna' });
    assert.deepEqual((await team('GET', '/v1/team/addon-submissions?status=all', undefined, mod)).body.submissions.map((x: { id: string }) => x.id), [wetterSid]);
    assert.equal((await team('GET', '/v1/team/addon-submissions?status=draft', undefined, mod)).status, 400);
    assert.equal((await team('GET', `/v1/team/addon-submissions/${privat}`, undefined, mod)).status, 404);
    assert.equal((await call('DELETE', `/v1/addon-submissions/${privat}`, anna)).body.deleted, true);

    res = await team('GET', `/v1/team/addon-submissions/${wetterSid}`, undefined, mod);
    assert.equal(res.status, 200);
    const sub = res.body.submission;
    const manifest = JSON.parse(sub.manifest);
    assert.deepEqual(manifest, {
      type: 'heldix-addon',
      id: 'wetter',
      name: 'Wetter',
      version: '1.0.0',
      summary: 'Zeigt das Wetter.',
      description: 'Absatz eins.\n\n- Punkt',
      authors: ['Anna'],
      api: 2,
      icon: 'cloud',
      category: 'werkzeuge',
      platforms: ['windows', 'linux'],
      file: 'heldix-addon-wetter-1.0.0.jar',
      size: wetter1.length,
      sha256: sha256(wetter1),
      date: new Date(sub.submittedAt).toISOString(),
      notes: ['Erste Version'],
      official: false,
      author: { uuid: anna.uuid, name: 'Anna' },
      // aus der JAR: nur die Heldix-API, läuft überall
      access: 'api',
      minecraft: [],
      loaders: ['heldix', 'fabric'],
    });
    assert.deepEqual(Object.keys(manifest).slice(-5), ['official', 'author', 'access', 'minecraft', 'loaders']);

    const jar = await rawRequest(service.url, 'GET', `/v1/team/addon-submissions/${wetterSid}/jar`, { Cookie: `${SESSION_COOKIE}=${mod}` });
    assert.deepEqual(
      [jar.status, jar.headers['content-type'], jar.headers['content-disposition'], jar.headers['cache-control'], jar.body],
      [200, 'application/java-archive', 'attachment; filename="heldix-addon-wetter-1.0.0.jar"', 'private, no-store', wetter1],
    );
    const shot = await rawRequest(service.url, 'GET', `/v1/team/addon-submissions/${wetterSid}/screenshots/1`, { Cookie: `${SESSION_COOKIE}=${mod}` });
    assert.deepEqual([shot.status, shot.headers['content-type'], shot.body], [200, 'image/jpeg', shot2]);

    // Ohne Team: Spieler-Cookie 403, Bearer 401; Freigeben nur mit dem Recht „Addons“ (Moderator 403, ohne bestätigte 2FA 403)
    const player = await webLogin(service, anna);
    assert.equal((await webApi(service, 'GET', '/v1/team/addon-submissions', { cookie: player.cookie })).status, 403);
    assert.equal((await call('GET', '/v1/team/addon-submissions', anna)).status, 401);
    const signature = signManifest(sub.manifest, keys.privateKey);
    res = await team('POST', `/v1/team/addon-submissions/${wetterSid}/approve`, { signature }, moderator);
    assert.deepEqual([res.status, res.body.code], [403, 'forbidden']);
    res = await team('GET', '/v1/team/addon-submissions', undefined, moderator);
    assert.deepEqual([res.status, res.body.code], [403, 'forbidden'], 'Moderator sieht keine Einreichungen');
    // Meldungen zu Addons darf der Moderator weiterhin bearbeiten.
    assert.equal((await team('GET', '/v1/team/addon-reports', undefined, moderator)).status, 200);
    const fresh = await webLogin(service, chefin);
    res = await team('POST', `/v1/team/addon-submissions/${wetterSid}/approve`, { signature }, fresh.cookie);
    assert.deepEqual([res.status, res.body.code], [403, '2fa_required']);
    res = await webApi(service, 'POST', `/v1/team/addon-submissions/${wetterSid}/approve`, { cookie: admin, body: { signature }, csrf: false });
    assert.equal(res.status, 403);
  });

  test('Freigeben: nur mit gültiger Signatur über "heldix-addon\\n" + Manifest; danach im Store mit Besitzer und Screenshots', async () => {
    const detail = (await team('GET', `/v1/team/addon-submissions/${wetterSid}`)).body.submission;
    const approvePath = `/v1/team/addon-submissions/${wetterSid}/approve`;
    for (const [body, status, error] of [
      [{}, 400, /„signature“ fehlt/],
      [{ signature: 'a3Vyeg==' }, 400, WRONG_SIGNATURE],
      [{ signature: signManifest(detail.manifest, generateKeyPairSync('ed25519').privateKey) }, 400, WRONG_SIGNATURE],
      [{ signature: sign(null, Buffer.from(detail.manifest, 'utf8'), keys.privateKey).toString('base64') }, 400, WRONG_SIGNATURE],
      [{ signature: signManifest(detail.manifest.replace('Wetter', 'Boese'), keys.privateKey) }, 400, WRONG_SIGNATURE],
      [{ signature: signManifest(detail.manifest, keys.privateKey), manifest: '{}' }, 400, /passt nicht zur Einreichung/],
    ] as [Record<string, unknown>, number, RegExp | string][]) {
      const res = await team('POST', approvePath, body);
      assert.equal(res.status, status, JSON.stringify(body).slice(0, 60));
      if (typeof error === 'string') assert.equal(res.body.error, error);
      else assert.match(res.body.error, error);
    }
    assert.deepEqual((await api(service.url, 'GET', '/v1/addons')).body.addons, [], 'nichts veröffentlicht');

    const annaWs = (await connect(service.wsUrl, anna.token)).client;
    const benWs = (await connect(service.wsUrl, ben.token)).client;
    try {
      const res = await team('POST', approvePath, { signature: signManifest(detail.manifest, keys.privateKey), manifest: detail.manifest });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.submission.status, res.body.submission.reviewer, res.body.submission.screenshots], ['approved', 'Chefin', 0]);
      assert.deepEqual(await annaWs.next('addon-review'), {
        type: 'addon-review',
        submission: wetterSid,
        status: 'approved',
        addonId: 'wetter',
        version: '1.0.0',
        note: null,
      });
      await benWs.sync();
      assert.equal(benWs.drain().some((m) => m.type === 'addon-review'), false, 'nur an den Einreicher');
    } finally {
      await annaWs.close();
      await benWs.close();
    }
    assert.equal((await team('POST', approvePath, { signature: signManifest(detail.manifest, keys.privateKey) })).status, 409);

    // Öffentlich: Community-Addon mit Autor, Screenshots, signiertem Text
    const list = await api(service.url, 'GET', '/v1/addons');
    const [addon] = list.body.addons;
    assert.deepEqual(
      [addon.id, addon.version, addon.official, addon.author, addon.screenshots, addon.rating, addon.manifest, addon.name, addon.platforms],
      ['wetter', '1.0.0', false, { uuid: anna.uuid, name: 'Anna' }, 2, { average: 0, count: 0 }, detail.manifest, 'Wetter', ['windows', 'linux']],
    );
    assert.match(addon.screenshotsVersion, /^[0-9a-f]{12}$/);
    assert.equal(verifyAddonSignature(addon.manifest, addon.signature, keys.publicKey), true);
    // Dateien: JAR im Addon-Ordner, Screenshots im eigenen Ordner, nichts mehr bei den Einreichungen
    assert.deepEqual(fs.readFileSync(path.join(addonsDir, 'heldix-addon-wetter-1.0.0.jar')), wetter1);
    assert.equal(filesIn(submissionsDir).length, 0, filesIn(submissionsDir).join(', '));
    assert.equal(filesIn(path.join(addonsDir, 'screenshots')).length, 2);
    // Screenshots öffentlich (inline, ein Tag Cache, CORS), andere Nummern 404
    for (const [n, type, data] of [
      [1, 'image/jpeg', shot2],
      [2, 'image/png', shot1],
    ] as [number, string, Buffer][]) {
      const res = await rawRequest(service.url, 'GET', `/v1/addons/wetter/screenshots/${n}`);
      assert.deepEqual(
        [res.status, res.headers['content-type'], res.headers['cache-control'], res.headers['access-control-allow-origin'], res.headers['x-content-type-options'], res.body],
        [200, type, 'public, max-age=86400', '*', 'nosniff', data],
      );
      assert.match(String(res.headers['content-disposition']), /^inline; filename="wetter-\d\.(png|jpg)"$/);
      const head = await rawRequest(service.url, 'HEAD', `/v1/addons/wetter/screenshots/${n}`);
      assert.deepEqual([head.status, head.body.length], [200, 0]);
    }
    for (const p of ['/v1/addons/wetter/screenshots/3', '/v1/addons/wetter/screenshots/0', '/v1/addons/wetter/screenshots/x', '/v1/addons/gibtsnicht/screenshots/1']) {
      const res = await rawRequest(service.url, 'GET', p);
      assert.deepEqual([res.status, res.headers['access-control-allow-origin']], [404, '*'], p);
    }
    assert.equal((await rawRequest(service.url, 'GET', '/v1/addons/wetter/download')).status, 302);
    assert.deepEqual((await rawRequest(service.url, 'GET', '/v1/addons/wetter/files/heldix-addon-wetter-1.0.0.jar')).body, wetter1);
    await waitFor(async () => (await api(service.url, 'GET', '/v1/addons/wetter')).body.addon.downloads === 1);

    // Für den Einreicher: freigegeben (Prüfer nicht auf der Teamseite: „HeldixClient-Team“), eigenes Addon
    const mine = (await call('GET', '/v1/addon-submissions', anna)).body;
    assert.deepEqual([mine.submissions[0].status, mine.submissions[0].reviewer, mine.submissions[0].reviewNote], ['approved', 'HeldixClient-Team', null]);
    assert.deepEqual(mine.addons.map((a: { id: string; hidden: boolean; downloads: number }) => [a.id, a.hidden, a.downloads]), [['wetter', false, 1]]);
    assert.ok((await audit()).includes('addon.approve wetter 1.0.0'));
    const overview = (await team('GET', '/v1/team/addons')).body;
    assert.deepEqual(
      overview.addons.map((a: { id: string; official: boolean; owner: unknown; screenshots: number }) => [a.id, a.official, a.owner, a.screenshots]),
      [['wetter', false, { uuid: anna.uuid, name: 'Anna' }, 2]],
    );
    assert.deepEqual([overview.pendingSubmissions, overview.openReports, overview.publicKey], [0, 0, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]);

    // Entwicklerseite und Filter nach Autor
    const page = await api(service.url, 'GET', `/v1/addon-authors/${anna.uuid}`);
    assert.deepEqual([page.status, page.headers.get('access-control-allow-origin'), page.headers.get('cache-control')], [200, '*', 'max-age=60']);
    assert.deepEqual(page.body, { author: { uuid: anna.uuid, name: 'Anna' }, addons: list.body.addons.map((a: { downloads: number }) => ({ ...a, downloads: 1 })) });
    for (const p of [`/v1/addon-authors/${ben.uuid}`, '/v1/addon-authors/xyz', `/v1/addon-authors/${'0'.repeat(32)}`]) {
      const res = await api(service.url, 'GET', p);
      assert.deepEqual([res.status, res.headers.get('access-control-allow-origin')], [404, '*'], p);
    }
    assert.deepEqual((await api(service.url, 'GET', `/v1/addons?author=${anna.uuid}`)).body.addons.map((a: { id: string }) => a.id), ['wetter']);
    assert.deepEqual((await api(service.url, 'GET', `/v1/addons?author=${ben.uuid}`)).body.addons, []);
    const bad = await api(service.url, 'GET', '/v1/addons?author=ANNA');
    assert.deepEqual([bad.status, bad.headers.get('access-control-allow-origin')], [400, '*']);
  });

  test('Neue Version, Ablehnen mit Begründung (Echtzeit), überarbeitet neu einreichen; Screenshots bleiben oder werden ersetzt', async () => {
    let sid = await draft(anna);
    let res: AnyResponse = await upload(`/v1/addon-submissions/${sid}/jar`, anna, wetterJar('1.0.0'));
    assert.deepEqual([res.status, res.body.error], [409, 'Die Version 1.0.0 ist nicht höher als die vorhandene (1.0.0).']);
    res = await upload(`/v1/addon-submissions/${sid}/jar`, anna, wetterJar('1.0.0-beta.1'));
    assert.equal(res.status, 409);
    const wetter11 = wetterJar('1.1.0');
    assert.equal((await upload(`/v1/addon-submissions/${sid}/jar`, anna, wetter11)).status, 200);
    assert.equal((await call('PATCH', `/v1/addon-submissions/${sid}`, anna, { name: 'Wetter', notes: ['Regen'] })).status, 200);
    assert.equal((await call('POST', `/v1/addon-submissions/${sid}/submit`, anna)).status, 200);

    const reject = (body: unknown, cookie = mod) => team('POST', `/v1/team/addon-submissions/${sid}/reject`, body, cookie);
    assert.equal((await reject({})).status, 400);
    assert.equal((await reject({ note: '   ' })).status, 400);
    assert.match((await reject({ note: 'x'.repeat(1001) })).body.error, /höchstens 1000/);
    const ws = (await connect(service.wsUrl, anna.token)).client;
    try {
      res = await reject({ note: 'Bitte ohne net/minecraft.\nNur die Heldix-API.' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.submission.status, res.body.submission.reviewer, res.body.submission.reviewNote], ['rejected', 'Entwickler', 'Bitte ohne net/minecraft.\nNur die Heldix-API.']);
      assert.deepEqual(await ws.next('addon-review'), {
        type: 'addon-review',
        submission: sid,
        status: 'rejected',
        addonId: 'wetter',
        version: '1.1.0',
        note: 'Bitte ohne net/minecraft.\nNur die Heldix-API.',
      });
    } finally {
      await ws.close();
    }
    assert.equal((await reject({ note: 'nochmal' })).status, 409);
    assert.equal((await team('POST', `/v1/team/addon-submissions/${sid}/approve`, { signature: 'x' })).status, 409);
    assert.ok((await audit()).includes('addon.reject wetter 1.1.0'));
    let mine = (await call('GET', '/v1/addon-submissions', anna)).body.submissions.find((x: { id: string }) => x.id === sid);
    assert.deepEqual([mine.status, mine.reviewer, mine.reviewNote], ['rejected', 'HeldixClient-Team', 'Bitte ohne net/minecraft.\nNur die Heldix-API.']);
    // Abgelehnt: erst ändern (wird Entwurf), dann neu einreichen
    assert.equal((await call('POST', `/v1/addon-submissions/${sid}/submit`, anna)).status, 409);
    res = await call('PATCH', `/v1/addon-submissions/${sid}`, anna, {});
    assert.deepEqual([res.body.submission.status, res.body.submission.reviewNote], ['draft', 'Bitte ohne net/minecraft.\nNur die Heldix-API.']);
    res = await call('POST', `/v1/addon-submissions/${sid}/submit`, anna);
    assert.deepEqual([res.body.submission.status, res.body.submission.reviewNote, res.body.submission.reviewer], ['pending', null, null]);
    // Team-Liste: das abgelehnte und wieder eingereichte steht nur einmal da
    assert.deepEqual((await team('GET', '/v1/team/addon-submissions')).body.submissions.map((x: { id: string }) => x.id), [sid]);
    const before = (await api(service.url, 'GET', '/v1/addons/wetter')).body.addon.screenshotsVersion;
    await approve(sid);
    const detail = (await api(service.url, 'GET', '/v1/addons/wetter')).body;
    assert.deepEqual(
      detail.versions.map((v: { version: string; notes: string[] }) => [v.version, v.notes]),
      [
        ['1.1.0', ['Regen']],
        ['1.0.0', ['Erste Version']],
      ],
    );
    assert.deepEqual([detail.addon.version, detail.addon.screenshots, detail.addon.screenshotsVersion], ['1.1.0', 2, before], 'ohne neue Screenshots bleiben die alten');

    // Mit einem Screenshot: ersetzt die bisherigen (alte Dateien gelöscht)
    sid = await draft(anna, wetterJar('1.2.0'), { name: 'Wetter', summary: 'Mit Bild.' });
    assert.equal((await upload(`/v1/addon-submissions/${sid}/screenshots/1`, anna, png(800, 450))).status, 200);
    assert.equal((await call('POST', `/v1/addon-submissions/${sid}/submit`, anna)).status, 200);
    await approve(sid);
    const addon = (await api(service.url, 'GET', '/v1/addons/wetter')).body.addon;
    assert.deepEqual([addon.version, addon.summary, addon.screenshots], ['1.2.0', 'Mit Bild.', 1]);
    assert.notEqual(addon.screenshotsVersion, before);
    assert.equal(filesIn(path.join(addonsDir, 'screenshots')).length, 1);
    assert.deepEqual((await rawRequest(service.url, 'GET', '/v1/addons/wetter/screenshots/1')).body, png(800, 450));
    assert.equal((await rawRequest(service.url, 'GET', '/v1/addons/wetter/screenshots/2')).status, 404);
    mine = (await call('GET', '/v1/addon-submissions', anna)).body;
    assert.deepEqual(mine.addons.map((a: { id: string; version: string }) => [a.id, a.version]), [['wetter', '1.2.0']]);
  });

  test('Besitz: Eine Addon-ID gehört dem ersten Einreicher; offizielle und fremde IDs sind gesperrt, auch für das Team', async () => {
    // Fremdes Community-Addon
    let sid = await draft(ben);
    let res: AnyResponse = await upload(`/v1/addon-submissions/${sid}/jar`, ben, wetterJar('9.0.0'));
    assert.deepEqual([res.status, res.body.error], [409, TAKEN]);
    // Offizielles Addon des Teams
    const uhr = addonJar('uhrzeit', '1.0.0');
    const teamUpload = (file: string, data: Buffer) =>
      rawUpload(service.url, 'PUT', `/v1/team/addons/files/${file}`, data, { Cookie: `${SESSION_COOKIE}=${admin}`, 'X-Heldix-Web': '1' });
    assert.equal((await teamUpload('heldix-addon-uhrzeit-1.0.0.jar', uhr)).status, 200);
    const official = officialManifest('uhrzeit', '1.0.0', uhr);
    res = await team('PUT', '/v1/team/addons/manifest', { manifest: official, signature: signManifest(official, keys.privateKey) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    res = await upload(`/v1/addon-submissions/${sid}/jar`, ben, addonJar('uhrzeit', '2.0.0'));
    assert.deepEqual([res.status, res.body.error], [409, TAKEN]);
    const listed = (await api(service.url, 'GET', '/v1/addons/uhrzeit')).body.addon;
    assert.deepEqual([listed.official, listed.author], [true, null]);
    // Das Team kann kein offizielles Addon unter der ID eines Spielers veröffentlichen.
    const fake = addonJar('wetter', '9.0.0');
    assert.equal((await teamUpload('heldix-addon-wetter-9.0.0.jar', fake)).status, 200);
    const hijack = officialManifest('wetter', '9.0.0', fake);
    res = await team('PUT', '/v1/team/addons/manifest', { manifest: hijack, signature: signManifest(hijack, keys.privateKey) });
    assert.deepEqual([res.status, res.body.error], [409, TAKEN]);
    assert.equal((await team('DELETE', '/v1/team/addons/files/heldix-addon-wetter-9.0.0.jar')).status, 200);
    assert.equal((await api(service.url, 'GET', '/v1/addons/wetter')).body.addon.version, '1.2.0');

    // Wartet eine Einreichung eines anderen Spielers mit dieser ID, ist sie ebenfalls gesperrt.
    const benKoll = await submitted(ben, addonJar('kollision', '2.0.0'));
    const annaKoll = await draft(anna);
    res = await upload(`/v1/addon-submissions/${annaKoll}/jar`, anna, addonJar('kollision', '3.0.0'));
    assert.deepEqual([res.status, res.body.error], [409, TAKEN]);
    // Veröffentlicht das Team inzwischen ein offizielles Addon mit dieser ID, scheitert die Freigabe – und alles bleibt bei der Einreichung.
    const koll = addonJar('kollision', '1.0.0');
    assert.equal((await teamUpload('heldix-addon-kollision-1.0.0.jar', koll)).status, 200);
    const kollManifest = officialManifest('kollision', '1.0.0', koll);
    assert.equal((await team('PUT', '/v1/team/addons/manifest', { manifest: kollManifest, signature: signManifest(kollManifest, keys.privateKey) })).status, 200);
    const detail = (await team('GET', `/v1/team/addon-submissions/${benKoll}`)).body.submission;
    res = await team('POST', `/v1/team/addon-submissions/${benKoll}/approve`, { signature: signManifest(detail.manifest, keys.privateKey) });
    assert.deepEqual([res.status, res.body.error], [409, TAKEN]);
    assert.ok(filesIn(submissionsDir).includes(`${benKoll}.jar`), 'JAR bleibt bei der Einreichung');
    assert.equal(fs.existsSync(path.join(addonsDir, 'heldix-addon-kollision-2.0.0.jar')), false);
    assert.equal((await team('GET', `/v1/team/addon-submissions/${benKoll}`)).body.submission.status, 'pending');
    assert.equal((await team('POST', `/v1/team/addon-submissions/${benKoll}/reject`, { note: 'ID vergeben.' })).status, 200);
    sid = await draft(ben);
    // Nach der Ablehnung ist die ID wieder frei – aber jetzt offiziell, also gesperrt.
    assert.equal((await upload(`/v1/addon-submissions/${sid}/jar`, ben, addonJar('kollision', '4.0.0'))).status, 409);
  });

  test('Eingriff in Minecraft: Zugriff, Versionen und Loader aus der JAR, Hinweis „minecraft“ erwartet, im Manifest und im Store', async () => {
    const dora = await devPlayer(service.url, 'Dora');
    // Ohne JAR: noch nichts bekannt
    const empty = await call('POST', '/v1/addon-submissions', dora, {});
    assert.deepEqual([empty.body.submission.access, empty.body.submission.minecraft, empty.body.submission.loaders], [null, [], []]);
    // Ohne Minecraft-Version lässt sich ein Eingriff nicht einreichen
    const noVersion = addonJar('sichtfeld', '1.0.0', {
      meta: { entrypoint: undefined, clientEntrypoint: 'dev.dora.Start' },
      extra: [entry('dev/dora/Start.class', classFile())],
    });
    let res: AnyResponse = await upload(`/v1/addon-submissions/${empty.body.submission.id}/jar`, dora, noVersion);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /greift in Minecraft ein .*nennt aber keine Minecraft-Version/);
    assert.equal((await call('DELETE', `/v1/addon-submissions/${empty.body.submission.id}`, dora)).body.deleted, true);

    const jar = addonJar('sichtfeld', '1.0.0', {
      meta: { entrypoint: undefined, clientEntrypoint: 'dev.dora.Start', transformers: ['dev.dora.Kamera'], minecraft: ['26.2', '26.3'], description: 'Weiteres Sichtfeld.' },
      extra: [
        entry('dev/dora/Start.class', classFile('dev/heldixclient/loader/api/HeldixModInitializer')),
        entry('dev/dora/Kamera.class', classFile('net/minecraft/client/Camera', 'java/lang/reflect/Method')),
      ],
    });
    const sid = await draft(dora, jar);
    const own = (await call('GET', '/v1/addon-submissions', dora)).body.submissions.find((x: { id: string }) => x.id === sid);
    assert.deepEqual([own.access, own.minecraft, own.loaders], ['minecraft', ['26.2', '26.3'], ['heldix']]);
    // Minecraft-Klassen sind hier erwartet; andere Hinweise (Reflection) bleiben
    assert.deepEqual(own.inspection, { classes: 2, uses: ['reflection', 'minecraft'], expected: ['minecraft'] });
    res = await call('POST', `/v1/addon-submissions/${sid}/submit`, dora);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const detail = await team('GET', `/v1/team/addon-submissions/${sid}`, undefined, mod);
    assert.deepEqual([detail.body.submission.access, detail.body.submission.inspection.expected], ['minecraft', ['minecraft']]);
    const manifest = JSON.parse(detail.body.submission.manifest);
    assert.deepEqual(Object.keys(manifest).slice(-5), ['official', 'author', 'access', 'minecraft', 'loaders']);
    assert.deepEqual([manifest.access, manifest.minecraft, manifest.loaders, manifest.official], ['minecraft', ['26.2', '26.3'], ['heldix'], false]);

    // Freigeben signiert genau dieses Manifest; im Store steht der Eingriff
    await approve(sid);
    const listed = (await api(service.url, 'GET', '/v1/addons/sichtfeld')).body;
    assert.deepEqual([listed.addon.access, listed.addon.minecraft, listed.addon.loaders], ['minecraft', ['26.2', '26.3'], ['heldix']]);
    assert.equal(JSON.parse(listed.addon.manifest).access, 'minecraft');

    // Eine neue Version, die nur die Heldix-API nutzt und selbst sagt, wo sie läuft
    const apiJar = addonJar('sichtfeld', '1.1.0', { meta: { loaders: ['heldix', 'fabric'] }, extra: [entry('dev/dora/Welt.class', classFile('net/minecraft/x'))] });
    const sid2 = await draft(dora, apiJar);
    const next = (await call('GET', '/v1/addon-submissions', dora)).body.submissions.find((x: { id: string }) => x.id === sid2);
    assert.deepEqual([next.access, next.minecraft, next.loaders, next.inspection.uses, next.inspection.expected], ['api', [], ['heldix', 'fabric'], ['minecraft'], []]);
    assert.equal((await call('POST', `/v1/addon-submissions/${sid2}/submit`, dora)).status, 200);
    const nextManifest = JSON.parse((await team('GET', `/v1/team/addon-submissions/${sid2}`, undefined, mod)).body.submission.manifest);
    assert.deepEqual([nextManifest.access, nextManifest.minecraft, nextManifest.loaders], ['api', [], ['heldix', 'fabric']]);
    assert.equal((await call('DELETE', `/v1/addon-submissions/${sid2}`, dora)).status, 200);
  });

  test('Grenzen: 3 wartende und 10 Entwürfe je Spieler, JAR und Kurzbeschreibung nötig, eine wartende je Addon', async () => {
    for (const id of ['c1', 'c2', 'c3']) await submitted(carla, addonJar(id, '1.0.0'));
    const fourth = await draft(carla, addonJar('c4', '1.0.0'));
    let res = await call('POST', `/v1/addon-submissions/${fourth}/submit`, carla);
    assert.deepEqual([res.status, res.body.error], [409, 'Du hast schon 3 Einreichungen in der Prüfung. Bitte warte, bis das Team sie geprüft hat.']);
    const drafts: string[] = [fourth];
    for (let i = 0; i < 9; i++) drafts.push(await draft(carla));
    res = await call('POST', '/v1/addon-submissions', carla, {});
    assert.deepEqual([res.status, res.body.error], [409, 'Du hast schon 10 Entwürfe. Bitte erst einen einreichen oder löschen.']);
    assert.deepEqual((await call('DELETE', `/v1/addon-submissions/${drafts.pop()}`, carla)).body, { deleted: true, submission: null });
    assert.equal((await call('POST', '/v1/addon-submissions', carla, {})).status, 200);

    // Ohne Kurzbeschreibung (description in heldix.addon.json leer, Formular leer): 400
    let sid = await draft(ben, addonJar('ohnetext', '1.0.0', { meta: { description: '' } }));
    res = await call('POST', `/v1/addon-submissions/${sid}/submit`, ben);
    assert.deepEqual([res.status, res.body.error], [400, 'Bitte eine Kurzbeschreibung angeben („summary“).']);
    // Fehlende Angabe im Manifest (Name leer gemacht): 400 mit Hinweis
    assert.equal((await call('PATCH', `/v1/addon-submissions/${sid}`, ben, { summary: 'Text', name: '' })).status, 200);
    res = await call('POST', `/v1/addon-submissions/${sid}/submit`, ben);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^Bitte noch korrigieren: „name“ darf nicht leer sein\.$/);
    // Für dasselbe Addon wartet höchstens eine Einreichung.
    await submitted(ben, addonJar('doppelt', '1.0.0'));
    sid = await draft(ben, addonJar('doppelt', '1.0.1'));
    res = await call('POST', `/v1/addon-submissions/${sid}/submit`, ben);
    assert.deepEqual([res.status, res.body.error], [409, 'Für dieses Addon wartet schon eine Einreichung auf die Prüfung.']);
  });

  test('Zurückziehen: Entwurf verschwindet, eingereichte werden „withdrawn“ (Dateien weg), freigegebene nicht', async () => {
    let sid = await draft(anna, addonJar('weg', '1.0.0'));
    assert.ok(filesIn(submissionsDir).includes(`${sid}.jar`));
    assert.deepEqual((await call('DELETE', `/v1/addon-submissions/${sid}`, anna)).body, { deleted: true, submission: null });
    assert.equal(filesIn(submissionsDir).includes(`${sid}.jar`), false);
    assert.equal((await call('PATCH', `/v1/addon-submissions/${sid}`, anna, {})).status, 404);

    sid = await draft(anna, addonJar('weg', '1.0.0'));
    assert.equal((await upload(`/v1/addon-submissions/${sid}/screenshots/1`, anna, shot1)).status, 200);
    assert.equal((await call('POST', `/v1/addon-submissions/${sid}/submit`, anna)).status, 200);
    let res = await call('DELETE', `/v1/addon-submissions/${sid}`, anna);
    assert.deepEqual([res.status, res.body.deleted, res.body.submission.status, res.body.submission.screenshots], [200, false, 'withdrawn', 0]);
    assert.equal(filesIn(submissionsDir).some((f) => f.startsWith(sid)), false, 'JAR und Screenshot weg');
    assert.equal((await call('DELETE', `/v1/addon-submissions/${sid}`, anna)).body.submission.status, 'withdrawn');
    assert.equal((await call('PATCH', `/v1/addon-submissions/${sid}`, anna, {})).status, 409);
    assert.equal((await call('POST', `/v1/addon-submissions/${sid}/submit`, anna)).status, 409);
    const all = (await team('GET', '/v1/team/addon-submissions?status=all')).body.submissions;
    assert.equal(all.find((x: { id: string }) => x.id === sid).status, 'withdrawn');
    assert.equal((await rawRequest(service.url, 'GET', `/v1/team/addon-submissions/${sid}/jar`, { Cookie: `${SESSION_COOKIE}=${admin}` })).status, 404);
    assert.equal((await team('POST', `/v1/team/addon-submissions/${sid}/reject`, { note: 'x' })).status, 409);
    // Freigegeben: bleibt
    res = await call('DELETE', `/v1/addon-submissions/${wetterSid}`, anna);
    assert.equal(res.status, 409);
  });

  test('Bewertungen: 1–5 Sterne je Spieler, Durchschnitt mit einer Nachkommastelle, eigene Addons nicht', async () => {
    const rating = (player: Player, method = 'GET', body?: unknown, id = 'wetter') => call(method, `/v1/addons/${id}/rating`, player, body);
    let res = await rating(ben);
    assert.deepEqual([res.status, res.body], [200, { myRating: null, average: 0, count: 0 }]);
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'kein CORS für Angemeldete');
    assert.deepEqual((await rating(ben, 'PUT', { stars: 4 })).body, { myRating: 4, average: 4, count: 1 });
    assert.deepEqual((await rating(carla, 'PUT', { stars: 5 })).body, { myRating: 5, average: 4.5, count: 2 });
    assert.deepEqual((await rating(chefin, 'PUT', { stars: 4 })).body, { myRating: 4, average: 4.3, count: 3 });
    assert.deepEqual((await rating(ben, 'PUT', { stars: 2 })).body, { myRating: 2, average: 3.7, count: 3 }, 'ändern statt doppelt');
    res = await rating(anna, 'PUT', { stars: 5 });
    assert.deepEqual([res.status, res.body.error], [403, 'Eigene Addons kannst du nicht bewerten.']);
    for (const body of [{}, { stars: 0 }, { stars: 6 }, { stars: 2.5 }, { stars: '5' }, { stars: null }]) {
      assert.equal((await rating(ben, 'PUT', body)).status, 400, JSON.stringify(body));
    }
    for (const id of ['gibtsnicht', 'Wetter']) assert.equal((await rating(ben, 'PUT', { stars: 3 }, id)).status, 404, id);
    assert.equal((await api(service.url, 'GET', '/v1/addons/wetter/rating')).status, 401);
    // In Liste und Detail; offizielle Addons lassen sich auch bewerten
    assert.deepEqual((await api(service.url, 'GET', '/v1/addons/wetter')).body.addon.rating, { average: 3.7, count: 3 });
    assert.deepEqual((await rating(anna, 'PUT', { stars: 5 }, 'uhrzeit')).body, { myRating: 5, average: 5, count: 1 });
    const list = (await api(service.url, 'GET', '/v1/addons')).body.addons;
    assert.deepEqual(list.find((a: { id: string }) => a.id === 'uhrzeit').rating, { average: 5, count: 1 });
    // Zurücknehmen
    assert.deepEqual((await rating(ben, 'DELETE')).body, { myRating: null, average: 4.5, count: 2 });
    assert.deepEqual((await rating(ben, 'DELETE')).body, { myRating: null, average: 4.5, count: 2 });
    assert.deepEqual((await call('GET', '/v1/me/addon-ratings', carla)).body, { ratings: { wetter: 5 } });
    assert.deepEqual((await call('GET', '/v1/me/addon-ratings', ben)).body, { ratings: {} });
    // Versteckt: 404
    assert.equal((await team('PATCH', '/v1/team/addons/wetter', { hidden: true })).status, 200);
    assert.equal((await rating(ben)).status, 404);
    assert.equal((await rating(ben, 'PUT', { stars: 3 })).status, 404);
    assert.equal((await team('PATCH', '/v1/team/addons/wetter', { hidden: false })).status, 200);
    // Mit Cookie: nur mit CSRF-Header
    const web = await webLogin(service, carla);
    assert.equal((await webApi(service, 'PUT', '/v1/addons/wetter/rating', { cookie: web.cookie, body: { stars: 3 }, csrf: false })).status, 403);
    assert.equal((await webApi(service, 'PUT', '/v1/addons/wetter/rating', { cookie: web.cookie, body: { stars: 3 } })).body.myRating, 3);
  });

  test('Meldungen: eine offene je Spieler und Addon, Team sieht und erledigt sie', async () => {
    const report = (player: Player, body: unknown, id = 'wetter') => call('POST', `/v1/addons/${id}/reports`, player, body);
    assert.deepEqual((await report(ben, { reason: 'broken', note: ' Stürzt beim Start ab. ' })).body, { reported: true });
    assert.deepEqual((await report(ben, { reason: 'malware' })).body, { reported: true }, 'keine zweite offene');
    for (const [body, pattern] of [
      [{}, /Ungültiger Grund/],
      [{ reason: 'spam' }, /Ungültiger Grund/],
      [{ reason: 'other', note: 'x'.repeat(501) }, /höchstens 500/],
      [{ reason: 'other', note: 'a\nb' }, /nicht erlaubt/],
      [{ reason: 'other', note: 5 }, /„note“/],
    ] as [Record<string, unknown>, RegExp][]) {
      const res = await report(carla, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(res.body.error, pattern);
    }
    assert.equal((await report(anna, { reason: 'other' })).status, 400, 'eigenes Addon');
    assert.equal((await report(carla, { reason: 'other' }, 'gibtsnicht')).status, 404);
    assert.equal((await api(service.url, 'POST', '/v1/addons/wetter/reports', { body: { reason: 'other' } })).status, 401);
    assert.deepEqual((await report(carla, { reason: 'malware', note: '' })).body, { reported: true });

    let res = await team('GET', '/v1/team/addon-reports', undefined, mod);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.reports.map((r: { reason: string; note: string; reporter: { name: string } }) => [r.reason, r.note, r.reporter.name]),
      [
        ['malware', '', 'Carla'],
        ['broken', 'Stürzt beim Start ab.', 'Ben'],
      ],
    );
    const [, benReport] = res.body.reports;
    assert.deepEqual(Object.keys(benReport).sort(), ['addon', 'at', 'doneAt', 'doneBy', 'id', 'note', 'reason', 'reporter', 'status']);
    assert.deepEqual(benReport.addon, { id: 'wetter', name: 'Wetter', exists: true, hidden: false, official: false, owner: { uuid: anna.uuid, name: 'Anna' } });
    assert.equal((await team('GET', '/v1/team/addons')).body.openReports, 2);
    assert.equal((await team('GET', '/v1/team/addon-reports?status=kaputt', undefined, mod)).status, 400);
    res = await team('POST', `/v1/team/addon-reports/${benReport.id}/done`, undefined, mod);
    assert.deepEqual([res.status, res.body.report.status, res.body.report.doneBy], [200, 'done', 'Entwickler']);
    assert.equal((await team('POST', `/v1/team/addon-reports/${benReport.id}/done`, undefined, mod)).body.report.status, 'done');
    assert.equal((await team('POST', '/v1/team/addon-reports/99999/done', undefined, mod)).status, 404);
    assert.equal((await team('GET', '/v1/team/addon-reports', undefined, mod)).body.reports.length, 1);
    assert.equal((await team('GET', '/v1/team/addon-reports?status=done', undefined, mod)).body.reports.length, 1);
    assert.equal((await audit()).filter((a) => a === `addon-report.done Addon-Meldung ${benReport.id}`).length, 1);
    // Erledigt: Eine neue Meldung ist wieder möglich.
    assert.deepEqual((await report(ben, { reason: 'copyright' })).body, { reported: true });
    assert.equal((await team('GET', '/v1/team/addon-reports?status=all', undefined, mod)).body.reports.length, 3);
    // Nur für das Team
    assert.equal((await call('GET', '/v1/team/addon-reports', ben)).status, 401);
  });

  test('Datenexport und Löschen: Einreichungen, Bewertungen, Meldungen; eigene Addons bleiben mit „Gelöschter Spieler“', async () => {
    const exported = async (player: Player) => (await rawRequest(service.url, 'GET', '/v1/me/export', { Authorization: `Bearer ${player.token}` })).body;
    const annaData = JSON.parse((await exported(anna)).toString('utf8')).addonStore;
    assert.deepEqual(Object.keys(annaData).sort(), ['addons', 'ratings', 'reports', 'submissions']);
    assert.ok(annaData.submissions.length >= 5);
    const approved = annaData.submissions.find((s: { id: string }) => s.id === wetterSid);
    assert.equal(approved.status, 'approved');
    assert.equal(JSON.parse(approved.manifest).author.uuid, anna.uuid);
    assert.deepEqual(annaData.addons.map((a: { id: string }) => a.id), ['wetter']);
    assert.deepEqual(annaData.ratings.map((r: { addon: string; stars: number }) => [r.addon, r.stars]), [['uhrzeit', 5]]);
    const benData = JSON.parse((await exported(ben)).toString('utf8')).addonStore;
    assert.deepEqual(benData.reports.map((r: { reason: string; status: string }) => [r.reason, r.status]), [
      ['copyright', 'open'],
      ['broken', 'done'],
    ]);
    assert.ok(benData.submissions.some((s: { status: string }) => s.status === 'pending'));

    // Ben löscht sein Konto: Einreichungen samt Dateien, Bewertungen und Meldungen sind weg.
    const benSids = benData.submissions.map((s: { id: string }) => s.id as string);
    assert.ok(filesIn(submissionsDir).some((f) => benSids.some((sid: string) => f.startsWith(sid))));
    assert.equal((await call('DELETE', '/v1/me', ben)).status, 200);
    assert.equal(filesIn(submissionsDir).some((f) => benSids.some((sid: string) => f.startsWith(sid))), false, 'Dateien weg');
    const teamAll = (await team('GET', '/v1/team/addon-submissions?status=all')).body.submissions;
    assert.equal(teamAll.some((s: { submitter: { uuid: string } }) => s.submitter.uuid === ben.uuid), false);
    assert.equal((await team('GET', '/v1/team/addon-reports?status=all')).body.reports.some((r: { reporter: { uuid: string } }) => r.reporter.uuid === ben.uuid), false);
    assert.equal((await team('GET', '/v1/team/addons')).body.pendingSubmissions, 3, 'nur noch die von Carla');

    // Anna löscht ihr Konto: Das Addon bleibt (signiert), der Autor heißt „Gelöschter Spieler“, die Entwicklerseite entfällt.
    const manifestBefore = (await api(service.url, 'GET', '/v1/addons/wetter')).body.addon.manifest;
    assert.equal((await call('DELETE', '/v1/me', anna)).status, 200);
    const addon = (await api(service.url, 'GET', '/v1/addons/wetter')).body.addon;
    assert.deepEqual([addon.official, addon.author, addon.manifest], [false, { uuid: anna.uuid, name: 'Gelöschter Spieler' }, manifestBefore]);
    assert.equal(verifyAddonSignature(addon.manifest, addon.signature, keys.publicKey), true);
    assert.deepEqual([addon.rating, addon.screenshots], [{ average: 3.5, count: 2 }, 1]);
    assert.equal((await api(service.url, 'GET', `/v1/addon-authors/${anna.uuid}`)).status, 404);
    assert.deepEqual((await api(service.url, 'GET', `/v1/addons?author=${anna.uuid}`)).body.addons, []);
    const owner = (await team('GET', '/v1/team/addons')).body.addons.find((a: { id: string }) => a.id === 'wetter').owner;
    assert.deepEqual(owner, { uuid: null, name: 'Gelöschter Spieler' });
    assert.equal((await team('GET', '/v1/team/addon-submissions?status=all')).body.submissions.some((s: { submitter: { uuid: string } }) => s.submitter.uuid === anna.uuid), false);
    // Die ID bleibt vergeben – auch für ein neues Konto mit derselben UUID.
    const again = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Anna', uuid: anna.uuid } });
    const annaAgain = { ...anna, token: again.body.token as string };
    const sid = await draft(annaAgain);
    const res = await upload(`/v1/addon-submissions/${sid}/jar`, annaAgain, wetterJar('5.0.0'));
    assert.deepEqual([res.status, res.body.error], [409, TAKEN]);
  });
});

test('Grenzen pro Spieler: Uploads, Meldungen und Bewertungen; JAR über der Größe: 413', async () => {
  const service = await startService({ dev: true, addonUploadRateLimit: 3, addonReportLimit: 2, addonRatingRateLimit: 2, maxAddonUploadBytes: 64 * 1024 });
  try {
    const anna = await devPlayer(service.url, 'Anna');
    const ben = await devPlayer(service.url, 'Ben');
    const created = await api(service.url, 'POST', '/v1/addon-submissions', { token: anna.token, body: {} });
    const sid = created.body.submission.id;
    const put = (data: Buffer, declared?: number) => rawUpload(service.url, 'PUT', `/v1/addon-submissions/${sid}/jar`, data, { Authorization: `Bearer ${anna.token}` }, declared);
    let res: AnyResponse = await put(Buffer.alloc(100), 64 * 1024 + 1);
    assert.equal(res.status, 413);
    assert.match(res.body.error, /zu groß/);
    assert.equal((await put(addonJar('a1', '1.0.0'))).status, 200);
    assert.equal((await put(addonJar('a1', '1.0.1'))).status, 200);
    const limited = await put(addonJar('a1', '1.0.2'));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers['retry-after']) >= 1);
    assert.equal(fs.readdirSync(path.join(service.dataDir, 'addons', 'einreichungen')).length, 1, 'nur die JAR der Einreichung');

    // Drei sichtbare Addons direkt in Datenbank und Ordner
    const store = new Store(service.dataDir);
    try {
      for (const id of ['x1', 'x2', 'x3']) {
        store.insertAddonVersion({
          id,
          version: '1.0.0',
          manifest: officialManifest(id, '1.0.0', Buffer.from(id)),
          signature: 'c2ln',
          file: `heldix-addon-${id}-1.0.0.jar`,
          size: 2,
          sha256: sha256(Buffer.from(id)),
          publishedAt: Date.now(),
          publishedBy: null,
        });
      }
    } finally {
      store.close();
    }
    const call = (method: string, p: string, body: unknown) => api(service.url, method, p, { token: ben.token, body });
    assert.equal((await call('POST', '/v1/addons/x1/reports', { reason: 'other' })).status, 200);
    assert.equal((await call('POST', '/v1/addons/x1/reports', { reason: 'other' })).status, 200, 'doppelt zählt nicht');
    assert.equal((await call('POST', '/v1/addons/x2/reports', { reason: 'other' })).status, 200);
    res = await call('POST', '/v1/addons/x3/reports', { reason: 'other' });
    assert.equal(res.status, 429);
    assert.match(res.body.error, /schon 2 Addons gemeldet/);
    assert.equal((await call('PUT', '/v1/addons/x1/rating', { stars: 5 })).status, 200);
    assert.equal((await call('DELETE', '/v1/addons/x1/rating', undefined)).status, 200);
    res = await call('PUT', '/v1/addons/x2/rating', { stars: 5 });
    assert.equal(res.status, 429);
    assert.equal((await api(service.url, 'GET', '/v1/addons/x2/rating', { token: ben.token })).status, 200, 'Abfragen zählen nicht');
  } finally {
    await service.close();
  }
});

test('Aufräumen: abgelehnte und zurückgezogene Einreichungen und Meldungen nach Ablauf, verwaiste Dateien', async () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  const service = await startService({
    dev: true,
    website: WEBSITE,
    totpNow: clock.read,
    updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    addonSubmissionTtlMs: 300,
    reportTtlMs: 300,
    sweepIntervalMs: 100,
  });
  try {
    const dir = path.join(service.dataDir, 'addons', 'einreichungen');
    const mod = (await teamLogin(service, await devPlayer(service.url, 'Entwickler'), 'developer-team', clock)).cookie;
    const anna = await devPlayer(service.url, 'Anna');
    const call = (method: string, p: string, body?: unknown) => api(service.url, method, p, { token: anna.token, body });
    const make = async (id: string) => {
      const sid = (await call('POST', '/v1/addon-submissions', {})).body.submission.id as string;
      assert.equal((await rawUpload(service.url, 'PUT', `/v1/addon-submissions/${sid}/jar`, addonJar(id, '1.0.0'), { Authorization: `Bearer ${anna.token}` })).status, 200);
      assert.equal((await call('POST', `/v1/addon-submissions/${sid}/submit`)).status, 200);
      return sid;
    };
    const rejected = await make('r1');
    const withdrawn = await make('r2');
    const kept = await make('r3');
    assert.equal((await webApi(service, 'POST', `/v1/team/addon-submissions/${rejected}/reject`, { cookie: mod, body: { note: 'Nein.' } })).status, 200);
    assert.equal((await call('DELETE', `/v1/addon-submissions/${withdrawn}`)).status, 200);
    // Verwaiste Datei einer Einreichung, die es nicht gibt, und eine fremde Datei (bleibt)
    fs.writeFileSync(path.join(dir, 'AAAAAAAAAAAAAAAA.jar'), 'rest');
    fs.writeFileSync(path.join(dir, 'liesmich.txt'), 'bleibt');
    await waitFor(async () => (await call('GET', '/v1/addon-submissions')).body.submissions.length === 1, 5000);
    assert.equal((await call('GET', '/v1/addon-submissions')).body.submissions[0].id, kept);
    await waitFor(() => !fs.readdirSync(dir).includes(`${rejected}.jar`) && !fs.readdirSync(dir).includes('AAAAAAAAAAAAAAAA.jar'), 5000);
    assert.deepEqual(fs.readdirSync(dir).sort(), [`${kept}.jar`, 'liesmich.txt'].sort());
    await sleep(200);
    assert.ok(fs.existsSync(path.join(dir, `${kept}.jar`)), 'wartende Einreichung bleibt');
  } finally {
    await service.close();
  }
});

test('ohne Update-Schlüssel: Freigeben 503, publicKey null; Ablehnen geht', async () => {
  const clock = new Clock();
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
  try {
    const admin = (await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock)).cookie;
    const anna = await devPlayer(service.url, 'Anna');
    const sid = (await api(service.url, 'POST', '/v1/addon-submissions', { token: anna.token, body: {} })).body.submission.id;
    assert.equal((await rawUpload(service.url, 'PUT', `/v1/addon-submissions/${sid}/jar`, addonJar('ohne', '1.0.0'), { Authorization: `Bearer ${anna.token}` })).status, 200);
    assert.equal((await api(service.url, 'POST', `/v1/addon-submissions/${sid}/submit`, { token: anna.token })).status, 200);
    const signature = signManifest('{}', generateKeyPairSync('ed25519').privateKey);
    const res = await webApi(service, 'POST', `/v1/team/addon-submissions/${sid}/approve`, { cookie: admin, body: { signature } });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /kein Update-Schlüssel/);
    const overview = (await webApi(service, 'GET', '/v1/team/addons', { cookie: admin })).body;
    assert.deepEqual([overview.keyConfigured, overview.publicKey, overview.pendingSubmissions], [false, null, 1]);
    assert.equal((await webApi(service, 'POST', `/v1/team/addon-submissions/${sid}/reject`, { cookie: admin, body: { note: 'Später.' } })).status, 200);
  } finally {
    await service.close();
  }
});
