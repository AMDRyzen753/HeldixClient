// Öffentliche Spielerprofile (1.14.0): Einstellungen (Standard aus, Teilfelder, Bio mit Wortfilter), öffentliche Ansicht
// nur mit Profil (sonst 404, auch gesperrt und ausgeblendet), Felder je nach Schalter, Skin und Kopf ohne Anmeldung,
// Melden in die Meldungen des Teams, Ausblenden durch das Team, Seite /spieler/<name> mit eingesetzter Vorschaukarte
// (ohne HTML-Injection), Datenauskunft und Konto löschen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { escapeHtml, injectMeta, META_MARKER } from '../src/public-profiles';
import { PNG, startFakeSkins, type FakeSkins } from './fake-skins';
import { api, devPlayer, rawRequest, startService, type Player, type TestService } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';

const API = 'https://api.heldix.example';
const TEMPLATE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spieler – HeldixClient</title>
<meta name="description" content="Allgemeine Beschreibung">
<link rel="canonical" href="https://heldix.example/spieler">
<meta property="og:title" content="Spieler – HeldixClient">
<meta property="og:image" content="https://heldix.example/og/start.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/spieler.css">
<script type="module" src="/spieler.js"></script>
</head>
<body data-seite="spieler"><main id="profil">Profil wird geladen …</main></body>
</html>
`;

const DEFAULTS = { enabled: false, bio: '', showCosmetics: true, showWorlds: true, showBadges: true, showFriendsButton: true, hidden: false, updated: null };

describe('Öffentliche Spielerprofile', () => {
  const clock = new Clock();
  let fake: FakeSkins;
  let service: TestService;
  let websiteDir: string;
  let admin: string;
  let moderator: string;
  let supporter: string;
  let anna: Player;
  let ben: Player;

  const settings = (player: Player) => api(service.url, 'GET', '/v1/account/public-profile', { token: player.token });
  const put = (player: Player, body: unknown) => api(service.url, 'PUT', '/v1/account/public-profile', { token: player.token, body });
  const profile = (who: string) => api(service.url, 'GET', `/v1/public/players/${who}`);
  const page = (pathname: string) => rawRequest(service.url, 'GET', pathname);

  before(async () => {
    fake = await startFakeSkins();
    websiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-webseite-'));
    fs.writeFileSync(path.join(websiteDir, 'spieler.html'), TEMPLATE);
    service = await startService({ dev: true, website: WEBSITE, apiUrl: API, totpNow: clock.read, sessionServer: fake.url, skinHosts: ['127.0.0.1'], websiteDir });
    admin = (await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock)).cookie;
    moderator = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
    supporter = (await teamLogin(service, await devPlayer(service.url, 'Supporter'), 'supporter', clock)).cookie;
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
  });
  after(async () => {
    await service.close();
    await fake.close();
    fs.rmSync(websiteDir, { recursive: true, force: true });
  });

  test('Einstellungen: Standard aus, Teilfelder, Prüfungen, Bio mit Wortfilter', async () => {
    assert.deepEqual((await settings(anna)).body, { ...DEFAULTS, url: `${WEBSITE}/spieler/Anna` });
    for (const [body, code, why] of [
      [{ enabled: 'ja' }, undefined, 'enabled kein Bool'],
      [{ showWorlds: 1 }, undefined, 'showWorlds keine Zahl'],
      [{ bio: 'x'.repeat(161) }, undefined, 'Bio zu lang'],
      [{ bio: 'zwei\nZeilen' }, undefined, 'Zeilenumbruch'],
      [{ bio: 42 }, undefined, 'Bio keine Zeichenkette'],
      [{ bio: 'Mein Server: play.beispiel.de' }, 'words-link', 'Link'],
      [{ bio: 'Ich bin kein Hurensohn' }, 'words-word', 'Wortfilter'],
    ] as const) {
      const res = await put(anna, body);
      assert.deepEqual([res.status, res.body.code], [400, code], why);
    }
    const saved = await put(anna, { enabled: true, bio: '  Baue gern Burgen  ' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual({ ...saved.body, updated: null }, { ...DEFAULTS, enabled: true, bio: 'Baue gern Burgen', url: `${WEBSITE}/spieler/Anna` });
    assert.equal(typeof saved.body.updated, 'number');
    // Teilfelder: der Rest bleibt
    const partial = await put(anna, { showWorlds: false });
    assert.deepEqual([partial.body.enabled, partial.body.bio, partial.body.showWorlds, partial.body.showBadges], [true, 'Baue gern Burgen', false, true]);
    await put(anna, { showWorlds: true, bio: null });
    assert.equal((await settings(anna)).body.bio, '');
    await put(anna, { bio: 'Baue gern Burgen' });
    assert.equal((await api(service.url, 'GET', '/v1/account/public-profile')).status, 401);
  });

  test('Öffentliche Ansicht: nur mit Profil (sonst 404), Felder je nach Schalter, Abzeichen, Cosmetics, Welten', async () => {
    // Ben hat kein Profil: wie unbekannt
    const hiddenBen = await profile('Ben');
    const unknown = await profile('Niemand');
    assert.deepEqual([hiddenBen.status, hiddenBen.body], [404, { error: 'Dieses Profil gibt es nicht oder es ist nicht öffentlich.', code: 'PROFILE_UNKNOWN' }]);
    assert.deepEqual([unknown.status, unknown.body], [hiddenBen.status, hiddenBen.body]);
    assert.equal((await profile('kein-name!')).status, 404);

    await webApi(service, 'PUT', `/v1/team/badges/${anna.uuid}`, { cookie: admin, body: { badge: 'creator' } });
    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { cape: 'glut' } });
    const res = await profile('anna');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
    assert.deepEqual(res.body, {
      uuid: anna.uuid,
      name: 'Anna',
      bio: 'Baue gern Burgen',
      badges: [{ id: 'creator', label: 'Creator' }],
      cosmetics: { cape: 'glut', worn: { head: null, back: null, aura: null, companion: null } },
      worlds: [],
      friendsButton: true,
      since: res.body.since,
      head: `/v1/public/heads/${anna.uuid}.png`,
      skin: `/v1/public/skins/${anna.uuid}`,
      url: `${WEBSITE}/spieler/Anna`,
    });
    assert.equal(typeof res.body.since, 'number');
    assert.deepEqual((await profile(anna.uuid)).body.name, 'Anna', 'auch über die UUID');

    // Schalter aus: Felder fehlen
    await put(anna, { showBadges: false, showCosmetics: false, showWorlds: false, showFriendsButton: false });
    const reduced = (await profile('Anna')).body;
    assert.deepEqual(Object.keys(reduced).sort(), ['bio', 'friendsButton', 'head', 'name', 'since', 'skin', 'url', 'uuid']);
    assert.equal(reduced.friendsButton, false);
    await put(anna, { showBadges: true, showCosmetics: true, showWorlds: true, showFriendsButton: true });

    // Ausgeblendet vom Team (Moderation): 404; der Spieler sieht hidden
    assert.equal((await webApi(service, 'PUT', `/v1/team/public-profiles/${anna.uuid}`, { cookie: supporter, body: { hidden: true } })).status, 403);
    assert.equal((await webApi(service, 'PUT', `/v1/team/public-profiles/${anna.uuid}`, { cookie: moderator, body: { hidden: 'ja' } })).status, 400);
    assert.equal((await webApi(service, 'PUT', '/v1/team/public-profiles/kaputt', { cookie: moderator, body: { hidden: true } })).status, 400);
    const hidden = await webApi(service, 'PUT', `/v1/team/public-profiles/${anna.uuid}`, { cookie: moderator, body: { hidden: true } });
    assert.deepEqual(hidden.body, { uuid: anna.uuid, name: 'Anna', hidden: true, enabled: true });
    assert.equal((await profile('Anna')).status, 404);
    assert.equal((await settings(anna)).body.hidden, true);
    // Selbst wieder einschalten hebt das Ausblenden nicht auf
    await put(anna, { enabled: true });
    assert.equal((await profile('Anna')).status, 404);
    await webApi(service, 'PUT', `/v1/team/public-profiles/${anna.uuid}`, { cookie: moderator, body: { hidden: false } });
    assert.equal((await profile('Anna')).status, 200);
    const audit = (await webApi(service, 'GET', '/v1/team/audit', { cookie: admin })).body.entries;
    assert.ok(audit.some((e: any) => e.action === 'profile.hide') && audit.some((e: any) => e.action === 'profile.show'));

    // Gesperrt: 404 (die Daten sind weg)
    const carla = await devPlayer(service.url, 'Carla');
    await put(carla, { enabled: true });
    assert.equal((await profile('Carla')).status, 200);
    await webApi(service, 'POST', '/v1/team/bans', { cookie: moderator, body: { uuid: carla.uuid, reason: 'Test' } });
    assert.equal((await profile('Carla')).status, 404);
    assert.equal((await profile(carla.uuid)).status, 404);
  });

  test('Skin und Kopf ohne Anmeldung: auch für Spieler mit öffentlichem Profil (sonst 404)', async () => {
    const dora = await devPlayer(service.url, 'Dora');
    fake.skinUrls.set(dora.uuid, `${fake.url}/texture/dora`);
    fake.files.set('/texture/dora', { body: PNG });
    await api(service.url, 'PUT', '/v1/me', { token: dora.token, body: { visible: false } });
    assert.equal((await rawRequest(service.url, 'GET', `/v1/public/skins/${dora.uuid}`)).status, 404);
    assert.equal((await rawRequest(service.url, 'GET', `/v1/public/heads/${dora.uuid}.png`)).status, 404);
    await put(dora, { enabled: true });
    const skin = await rawRequest(service.url, 'GET', `/v1/public/skins/${dora.uuid}`);
    assert.deepEqual([skin.status, skin.headers['content-type'], Buffer.compare(skin.body, PNG)], [200, 'image/png', 0]);
    const head = await rawRequest(service.url, 'GET', `/v1/public/heads/${dora.uuid}.png?size=128`);
    assert.deepEqual([head.status, head.headers['content-type']], [200, 'image/png']);
    // Profil aus: wieder 404 (der Kopf ist zwischengespeichert, aber nicht mehr erlaubt)
    await put(dora, { enabled: false });
    assert.equal((await rawRequest(service.url, 'GET', `/v1/public/skins/${dora.uuid}`)).status, 404);
    assert.equal((await rawRequest(service.url, 'GET', `/v1/public/heads/${dora.uuid}.png?size=128`)).status, 404);
  });

  test('Melden: in die Meldungen des Teams (Art profile), ohne CORS; nur öffentliche Profile', async () => {
    const report = (player: Player, who: string, body: unknown) => api(service.url, 'POST', `/v1/public/players/${who}/report`, { token: player.token, body });
    assert.equal((await api(service.url, 'POST', '/v1/public/players/Anna/report', { body: { reason: 'spam' } })).status, 401);
    assert.equal((await report(ben, 'Anna', { reason: 'unsinn' })).status, 400);
    assert.equal((await report(anna, 'Anna', { reason: 'spam' })).status, 400, 'sich selbst');
    assert.equal((await report(anna, 'Ben', { reason: 'spam' })).status, 404, 'Ben hat kein öffentliches Profil');
    const res = await report(ben, 'Anna', { reason: 'inappropriate', note: 'Bio unpassend' });
    assert.deepEqual(res.body, { reported: true });
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'Melden ohne CORS');
    assert.equal((await report(ben, anna.uuid, { reason: 'spam' })).status, 429, 'einmal je offenem Profil');
    const reports = (await webApi(service, 'GET', '/v1/team/reports', { cookie: moderator })).body.reports;
    const found = reports.find((r: any) => r.kind === 'profile');
    assert.deepEqual([found.reported.uuid, found.reporter.uuid, found.reason, found.profile], [anna.uuid, ben.uuid, 'inappropriate', { name: 'Anna', bio: 'Baue gern Burgen' }]);
  });

  test('Seite /spieler/<name>: Vorschaukarte eingesetzt und maskiert; unbekannt oder privat allgemein mit noindex (404)', async () => {
    const bio = `"><script>alert(1)</script> & 'x' $& $1 <!--heldix:spieler-meta-->`;
    const saved = await put(anna, { bio });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const res = await page('/spieler/Anna');
    const html = res.body.toString('utf8');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'public, max-age=60');
    assert.equal(Number(res.headers['content-length']), res.body.length);
    // keine Injektion: der Text der Bio steht nur maskiert drin
    assert.ok(!html.includes('<script>alert(1)'), html);
    assert.ok(!html.includes('content=""><'), 'Anführungszeichen nicht maskiert');
    const escaped = escapeHtml(bio);
    assert.ok(html.includes(`<meta name="description" content="${escaped}">`));
    assert.ok(html.includes(`<meta property="og:description" content="${escaped}">`));
    assert.ok(html.includes(`<meta name="twitter:description" content="${escaped}">`));
    assert.ok(escaped.includes('&lt;!--heldix:spieler-meta--&gt;'));
    // genau ein Titel und je eine Angabe, die alten der Vorlage sind weg
    assert.equal(html.match(/<title>/g)?.length, 1);
    assert.ok(html.includes('<title>Anna – HeldixClient</title>'));
    assert.equal(html.match(/property="og:title"/g)?.length, 1);
    assert.ok(!html.includes('summary_large_image') && !html.includes('Allgemeine Beschreibung') && !html.includes('og/start.png'));
    assert.ok(!html.includes('href="https://heldix.example/spieler"'));
    for (const line of [
      `<link rel="canonical" href="${WEBSITE}/spieler/Anna">`,
      '<meta property="og:type" content="profile">',
      `<meta property="og:url" content="${WEBSITE}/spieler/Anna">`,
      `<meta property="og:image" content="${API}/v1/public/heads/${anna.uuid}.png?size=256">`,
      '<meta name="twitter:card" content="summary">',
      `<meta name="twitter:image" content="${API}/v1/public/heads/${anna.uuid}.png?size=256">`,
    ]) {
      assert.ok(html.includes(line), line);
    }
    assert.ok(!html.includes('noindex'));
    // Rest der Vorlage bleibt; der Block steht nach <meta charset>
    assert.ok(html.includes('<script type="module" src="/spieler.js"></script>') && html.includes('Profil wird geladen …'));
    assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('<title>'));
    assert.ok(html.indexOf('<title>') < html.indexOf('</head>'));

    // Auch mit Schrägstrich am Ende und über die UUID
    assert.equal((await page('/spieler/Anna/')).status, 200);
    assert.ok((await page(`/spieler/${anna.uuid}`)).body.toString('utf8').includes('<title>Anna – HeldixClient</title>'));
    // HEAD: Kopfzeilen ohne Körper
    const head = await rawRequest(service.url, 'HEAD', '/spieler/Anna');
    assert.deepEqual([head.status, head.body.length, Number(head.headers['content-length']) > 0], [200, 0, true]);

    // Privat, unbekannt oder kaputt: allgemeine Angaben, noindex, 404, nichts vom Namen
    for (const pathname of ['/spieler/Ben', '/spieler/Niemand', '/spieler/%3Cscript%3E', '/spieler/%E0%A4%A']) {
      const other = await page(pathname);
      const text = other.body.toString('utf8');
      assert.equal(other.status, 404, pathname);
      assert.ok(text.includes('<title>Spielerprofil – HeldixClient</title>'), pathname);
      assert.ok(text.includes('<meta name="robots" content="noindex">'), pathname);
      assert.ok(text.includes(`<meta property="og:image" content="${WEBSITE}/og/start.png">`));
      assert.ok(!text.includes('Ben') && !text.includes('<script>'), pathname);
      assert.equal(other.headers['cache-control'], 'no-cache');
    }
    // Vorlage geändert: wird neu gelesen (Platzhalter statt Kopf-Angaben)
    fs.writeFileSync(path.join(websiteDir, 'spieler.html'), `<!doctype html><html><head><meta charset="utf-8">${META_MARKER}<link rel="stylesheet" href="/neu.css"></head><body></body></html>`);
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(websiteDir, 'spieler.html'), future, future);
    const updated = (await page('/spieler/Anna')).body.toString('utf8');
    assert.ok(updated.includes('/neu.css') && updated.includes('<title>Anna – HeldixClient</title>') && !updated.includes(META_MARKER));
    await put(anna, { bio: 'Baue gern Burgen' });
  });

  test('Datenauskunft mit dem Profil; Konto löschen löscht es', async () => {
    const eva = await devPlayer(service.url, 'Eva');
    assert.equal((await api(service.url, 'GET', '/v1/me/export', { token: eva.token })).body.publicProfile, null);
    await put(eva, { enabled: true, bio: 'Hallo' });
    const exported = (await api(service.url, 'GET', '/v1/me/export', { token: eva.token })).body.publicProfile;
    assert.deepEqual([exported.enabled, exported.bio], [true, 'Hallo']);
    await api(service.url, 'DELETE', '/v1/me', { token: eva.token });
    assert.equal((await profile('Eva')).status, 404);
  });
});

describe('Seite /spieler ohne gebaute Webseite', () => {
  test('eingebaute kleine Seite mit denselben Angaben', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      await api(service.url, 'PUT', '/v1/account/public-profile', { token: anna.token, body: { enabled: true } });
      const res = await rawRequest(service.url, 'GET', '/spieler/Anna');
      const html = res.body.toString('utf8');
      assert.equal(res.status, 200);
      assert.ok(html.startsWith('<!doctype html>'));
      assert.ok(html.includes('<title>Anna – HeldixClient</title>'));
      assert.ok(html.includes('content="Das öffentliche Profil von Anna bei HeldixClient."'));
      // ohne API-Adresse: Kopf über /api der Webseite
      assert.ok(html.includes(`<meta property="og:image" content="${WEBSITE}/api/v1/public/heads/${anna.uuid}.png?size=256">`));
    } finally {
      await service.close();
    }
  });
});

describe('injectMeta und escapeHtml', () => {
  test('Platzhalter, $-Muster bleiben Text, ohne </head> davor', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const meta = '<title>$& $1 $$</title>';
    assert.equal(injectMeta(`<html><head>${META_MARKER}</head><body>${META_MARKER}</body></html>`, meta), `<html><head>${meta}</head><body>${META_MARKER}</body></html>`);
    assert.equal(injectMeta('<html><head><title>Alt</title></head></html>', meta), `<html><head>\n${meta}</head></html>`);
    assert.equal(injectMeta('<p>ohne Kopf</p>', meta), `${meta}\n<p>ohne Kopf</p>`);
    // Nur im Kopf wird entfernt: Inhalt der Seite bleibt
    const body = '<body><meta property="og:title" content="im Körper"></body>';
    assert.ok(injectMeta(`<head><meta charset="utf-8"></head>${body}`, meta).endsWith(body));
  });
});
