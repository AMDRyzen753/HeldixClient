// Setup teilen (1.14.0): Prüfung des Inhalts (Modrinth-IDs, Loader, Listen, Einstellungen, Größe), kanonisches JSON und
// SHA-256, Wortfilter, Ablauf, öffentliche Ansicht mit Zählern (je IP und Stunde bzw. Tag), Widerruf (404/410), Grenzen,
// Melden in die Meldungen des Teams, Widerruf durch das Team, Datenauskunft, Konto löschen und Aufräumen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { canonicalJson } from '../src/setups';
import { isInviteCode } from '../src/validate';
import { api, devPlayer, startService, waitFor, type Player, type TestService } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

const DAY = 24 * 60 * 60_000;

const CONTENT = {
  v: 1,
  minecraft: '26.3',
  loader: 'fabric',
  heldixClient: true,
  mods: [
    { project: 'AANobbMI', version: 'IZskON6d', title: 'Sodium' },
    { project: 'P7dR8mSH', version: 'q8f2Lx0b', title: 'Fabric API' },
  ],
  resourcepacks: [],
  shaderpacks: [{ project: 'HVnmMxH1', version: 'abcdEF12', title: 'Complementary Shaders' }],
  addons: [{ id: 'minimap', version: '1.1.0', name: 'Minimap' }],
  settings: { graphics: { renderDistance: 12, enableVsync: false, graphicsMode: 'fancy', 'heldix:profil': 'leistung' }, keys: { 'key.zoom': 'key.keyboard.c' } },
};

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Kanonisches JSON unabhängig vom Dienst nachgebaut (Schlüssel sortiert, ohne Leerzeichen). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sql(service: TestService, statement: string, ...params: (string | number | null)[]): void {
  const db = new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare(statement).run(...params);
  } finally {
    db.close();
  }
}

describe('Setup teilen', () => {
  const clock = new Clock();
  let service: TestService;
  let anna: Player;
  let ben: Player;
  let moderator: string;
  let supporter: string;

  const create = (player: Player, body: Record<string, unknown>) => api(service.url, 'POST', '/v1/setups', { token: player.token, body });
  const valid = (changes: Record<string, unknown> = {}) => ({ name: 'Annas PvP-Setup', description: 'Schnell und hübsch', content: CONTENT, expiresDays: 30, ...changes });
  const view = (code: string, ip = '203.0.113.1') => api(service.url, 'GET', `/v1/public/setups/${code}`, { headers: { 'X-Forwarded-For': ip } });
  const installed = (code: string, ip = '203.0.113.1') => api(service.url, 'POST', `/v1/public/setups/${code}/installed`, { headers: { 'X-Forwarded-For': ip } });

  before(async () => {
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, trustProxy: true });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    moderator = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
    supporter = (await teamLogin(service, await devPlayer(service.url, 'Supporter'), 'supporter', clock)).cookie;
  });
  after(async () => {
    await service.close();
  });

  test('Anlegen: Prüfung des Inhalts, unbekannte Felder fallen weg, kanonisches JSON mit SHA-256, Link und Ablauf', async () => {
    const withContent = (change: (c: any) => void) => {
      const content = structuredClone(CONTENT) as any;
      change(content);
      return valid({ content });
    };
    const invalid: [Record<string, unknown>, string][] = [
      [valid({ content: undefined }), 'ohne Inhalt'],
      [valid({ content: [] }), 'Liste statt Objekt'],
      [withContent((c) => (c.v = 2)), 'Format 2'],
      [withContent((c) => (c.minecraft = '26 3')), 'Version mit Leerzeichen'],
      [withContent((c) => (c.loader = 'forge')), 'unbekannter Loader'],
      [withContent((c) => (c.heldixClient = 'ja')), 'heldixClient kein Bool'],
      [withContent((c) => (c.mods = 'sodium')), 'mods keine Liste'],
      [withContent((c) => (c.mods[0].project = 'zu-kurz')), 'Modrinth-ID falsch'],
      [withContent((c) => (c.mods[0].version = 'IZskON6d1')), 'Versions-ID zu lang'],
      [withContent((c) => (c.mods[0].title = '')), 'Titel leer'],
      [withContent((c) => (c.mods[0].title = 'x'.repeat(101))), 'Titel zu lang'],
      [withContent((c) => (c.shaderpacks = Array.from({ length: 301 }, (_, i) => ({ project: `A${String(i).padStart(7, '0')}`, version: 'abcdEF12', title: 'S' })))), '301 Shader'],
      [withContent((c) => (c.addons[0].id = 'Mit Leerzeichen')), 'Store-ID falsch'],
      [withContent((c) => (c.addons[0].version = '1.0')), 'Addon-Version falsch'],
      [withContent((c) => (c.settings = 'alles')), 'settings kein Objekt'],
      [withContent((c) => (c.settings.graphics = { 'mit leerzeichen': 1 })), 'Grafik-Schlüssel falsch'],
      [withContent((c) => (c.settings.graphics = { renderDistance: { tief: 1 } })), 'Grafik-Wert Objekt'],
      [withContent((c) => (c.settings.graphics = { name: 'x'.repeat(65) })), 'Grafik-Text zu lang'],
      [withContent((c) => (c.settings.graphics = { name: 'a\nb' })), 'Grafik-Text mit Steuerzeichen'],
      [withContent((c) => (c.settings.graphics = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`k${i}`, i])))), '61 Grafik-Einträge'],
      [withContent((c) => (c.settings.keys = { 'zoom': 'key.keyboard.c' })), 'Tasten-Schlüssel ohne key.'],
      [withContent((c) => (c.settings.keys = { 'key.zoom': 'C' })), 'Taste falsch'],
      [withContent((c) => (c.settings.keys = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`key.k${i}`, 'key.keyboard.a'])))), '201 Tasten'],
    ];
    for (const [body, why] of invalid) {
      const res = await create(anna, body);
      assert.deepEqual([res.status, res.body.code], [400, 'SETUP_INVALID'], `${why}: ${JSON.stringify(res.body)}`);
    }
    // Zu groß: über 64 KiB als kanonisches JSON
    const big = withContent((c) => {
      c.mods = Array.from({ length: 300 }, (_, i) => ({ project: `M${String(i).padStart(7, '0')}`, version: 'abcdEF12', title: 'x'.repeat(100) }));
      c.resourcepacks = Array.from({ length: 300 }, (_, i) => ({ project: `R${String(i).padStart(7, '0')}`, version: 'abcdEF12', title: 'y'.repeat(100) }));
    });
    const tooBig = await create(anna, big);
    assert.equal(tooBig.status, 400, JSON.stringify(tooBig.body));
    assert.match(tooBig.body.error, /zu groß/);
    for (const [body, status, code, why] of [
      [valid({ name: '' }), 400, undefined, 'Name leer'],
      [valid({ name: 'x'.repeat(41) }), 400, undefined, 'Name zu lang'],
      [valid({ description: 'x'.repeat(301) }), 400, undefined, 'Beschreibung zu lang'],
      [valid({ name: 'Setup von einem Wichser' }), 400, 'words-word', 'Wortfilter'],
      [valid({ description: 'Mehr auf www.beispiel.de' }), 400, 'words-link', 'Link'],
      [valid({ expiresDays: 14 }), 400, undefined, '14 Tage'],
    ] as const) {
      const res = await create(anna, body);
      assert.deepEqual([res.status, res.body.code], [status, code], why);
    }
    assert.equal((await api(service.url, 'POST', '/v1/setups', { body: valid() })).status, 401);

    // Gültig, mit unbekannten Feldern und doppeltem Projekt
    const content = structuredClone(CONTENT) as any;
    content.extra = 'weg damit';
    content.mods[0].url = 'https://beispiel.example/sodium.jar';
    content.mods.push({ project: 'AANobbMI', version: 'IZskON6d', title: 'Sodium (doppelt)' });
    content.settings.files = ['options.txt'];
    const started = Date.now();
    const res = await create(anna, valid({ content }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'expires', 'url']);
    assert.ok(isInviteCode(res.body.code));
    assert.equal(res.body.url, `${WEBSITE}/setup#${res.body.code}`);
    assert.ok(res.body.expires >= started + 30 * DAY && res.body.expires <= Date.now() + 30 * DAY);

    const shown = await view(res.body.code);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('access-control-allow-origin'), '*');
    // Ohne unbekannte Felder und ohne das doppelte Projekt; der Hash passt zum kanonischen JSON
    assert.deepEqual(shown.body.content, CONTENT);
    assert.equal(shown.body.hash, sha256(canonical(CONTENT)));
    assert.equal(canonicalJson(shown.body.content), canonical(CONTENT));
    assert.deepEqual(
      { ...shown.body, content: undefined, created: undefined },
      { code: res.body.code, name: 'Annas PvP-Setup', description: 'Schnell und hübsch', creator: { name: 'Anna', uuid: anna.uuid }, content: undefined, hash: shown.body.hash, created: undefined, expires: res.body.expires, views: 1, installs: 0 },
    );
    // Ohne Ablauf (null) und mit Cookie über die Webseite
    const { cookie } = await webLogin(service, anna);
    const forever = await webApi(service, 'POST', '/v1/setups', { cookie, body: valid({ expiresDays: null, settings: undefined }) });
    assert.equal(forever.status, 201, JSON.stringify(forever.body));
    assert.equal(forever.body.expires, null);
    // Ohne settings: graphics und keys null
    const minimal = await create(anna, valid({ content: { v: 1, minecraft: '26.3', loader: 'vanilla', heldixClient: false } }));
    assert.deepEqual((await view(minimal.body.code)).body.content, {
      v: 1,
      minecraft: '26.3',
      loader: 'vanilla',
      heldixClient: false,
      mods: [],
      resourcepacks: [],
      shaderpacks: [],
      addons: [],
      settings: { graphics: null, keys: null },
    });
    // Ein Grafik-Schlüssel „__proto__“ bleibt ein ganz normales Feld
    const proto = await create(anna, valid({ content: JSON.parse(JSON.stringify(CONTENT).replace('"renderDistance"', '"__proto__"')) }));
    assert.equal(proto.status, 201, JSON.stringify(proto.body));
    assert.equal((await view(proto.body.code)).body.content.settings.graphics.__proto__, 12);
    for (const code of [minimal.body.code, proto.body.code, forever.body.code]) await api(service.url, 'DELETE', `/v1/setups/${code}`, { token: anna.token });
  });

  test('Öffentlich: Aufrufe einmal je IP und Stunde, Installationen einmal je IP und Tag; eigene Liste; Widerruf und Ablauf 410', async () => {
    const { code } = (await create(anna, valid({ name: 'Zähl-Setup' }))).body;
    assert.equal((await view(code, '198.51.100.1')).body.views, 1);
    assert.equal((await view(code, '198.51.100.1')).body.views, 1, 'gleiche IP in derselben Stunde');
    assert.equal((await view(code, '198.51.100.2')).body.views, 2);
    assert.deepEqual((await installed(code, '198.51.100.1')).body, { ok: true, counted: true, installs: 1 });
    assert.deepEqual((await installed(code, '198.51.100.1')).body, { ok: true, counted: false, installs: 1 });
    assert.deepEqual((await installed(code, '198.51.100.3')).body, { ok: true, counted: true, installs: 2 });
    for (const bad of ['aaaaaaaaaa', 'kurz', 'IIIIIIIIII']) {
      const res = await view(bad);
      assert.deepEqual([res.status, res.body.code], [404, 'SETUP_UNKNOWN'], bad);
    }

    const mine = await api(service.url, 'GET', '/v1/setups', { token: anna.token });
    const own = mine.body.setups.find((s: any) => s.code === code);
    assert.deepEqual(
      [own.name, own.status, own.views, own.installs, own.minecraft, own.loader, own.counts, own.graphics, own.keys, own.url],
      ['Zähl-Setup', 'active', 2, 2, '26.3', 'fabric', { mods: 2, resourcepacks: 0, shaderpacks: 1, addons: 1 }, true, true, `${WEBSITE}/setup#${code}`],
    );
    assert.equal('content' in own, false, 'Liste ohne Inhalt');
    assert.deepEqual(mine.body.limits, { active: 50, daily: 20 });
    assert.deepEqual((await api(service.url, 'GET', '/v1/setups', { token: ben.token })).body.setups, []);
    // Eigenes Setup mit Inhalt (zählt keinen Aufruf), fremdes 404
    const detail = await api(service.url, 'GET', `/v1/setups/${code}`, { token: anna.token });
    assert.deepEqual([detail.status, detail.body.content.minecraft, detail.body.views], [200, '26.3', 2]);
    assert.equal((await api(service.url, 'GET', `/v1/setups/${code}`, { token: ben.token })).status, 404);

    // Widerruf nur durch den Ersteller
    assert.equal((await api(service.url, 'DELETE', `/v1/setups/${code}`, { token: ben.token })).status, 404);
    const revoked = await api(service.url, 'DELETE', `/v1/setups/${code}`, { token: anna.token });
    assert.deepEqual([revoked.body.ok, revoked.body.setup.status, revoked.body.setup.revoked], [true, 'revoked', true]);
    assert.equal((await api(service.url, 'DELETE', `/v1/setups/${code}`, { token: anna.token })).status, 200, 'noch einmal: ändert nichts');
    for (const res of [await view(code), await installed(code)]) assert.deepEqual([res.status, res.body.code], [410, 'SETUP_REVOKED']);
    assert.equal((await api(service.url, 'GET', `/v1/setups/${code}`, { token: anna.token })).body.status, 'revoked');

    // Abgelaufen
    const expiring = (await create(anna, valid({ name: 'Bald weg', expiresDays: 7 }))).body.code as string;
    assert.equal((await view(expiring)).status, 200);
    sql(service, 'UPDATE setups SET expires = ? WHERE code = ?', Date.now() - 1000, expiring);
    for (const res of [await view(expiring), await installed(expiring)]) assert.deepEqual([res.status, res.body.code], [410, 'SETUP_EXPIRED']);
    const listed = (await api(service.url, 'GET', '/v1/setups', { token: anna.token })).body.setups.find((s: any) => s.code === expiring);
    assert.deepEqual([listed.status, listed.expired], ['expired', true]);
  });

  test('Melden: in die Meldungen des Teams (Art setup); Team zieht zurück (Moderation)', async () => {
    const { code } = (await create(anna, valid({ name: 'Fragwürdig', description: 'Ganz harmlos' }))).body;
    const report = (player: Player, body: unknown) => api(service.url, 'POST', `/v1/setups/${code}/report`, { token: player.token, body });
    assert.equal((await report(ben, { reason: 'gefällt-mir-nicht' })).status, 400);
    assert.equal((await report(anna, { reason: 'spam' })).status, 400, 'eigenes Setup');
    assert.equal((await report(ben, { reason: 'inappropriate', note: 'zwei\nZeilen' })).status, 400);
    assert.deepEqual((await report(ben, { reason: 'inappropriate', note: 'Name passt nicht' })).body, { reported: true });
    assert.equal((await report(ben, { reason: 'spam' })).status, 429, 'einmal je offenem Setup');
    assert.equal((await api(service.url, 'POST', '/v1/setups/aaaaaaaaaa/report', { token: ben.token, body: { reason: 'spam' } })).status, 404);

    const reports = (await webApi(service, 'GET', '/v1/team/reports', { cookie: moderator })).body.reports;
    const found = reports.find((r: any) => r.kind === 'setup');
    assert.deepEqual(
      [found.reason, found.note, found.reporter.uuid, found.reported.uuid, found.setup, found.messages],
      ['inappropriate', 'Name passt nicht', ben.uuid, anna.uuid, { code, name: 'Fragwürdig', description: 'Ganz harmlos' }, []],
    );
    assert.ok(service.logs.some((line) => /Neue Meldung #\d+ \(Setup, Grund: inappropriate\)/.test(line)));
    assert.ok(!service.logs.some((line) => line.includes('Fragwürdig')), 'kein Name im Log');
    // Eigene Meldungen sieht der Meldende
    assert.equal((await api(service.url, 'GET', '/v1/reports/mine', { token: ben.token })).body.reports[0].kind, 'setup');

    // Zurückziehen: nur mit dem Recht „Moderation“
    assert.equal((await webApi(service, 'DELETE', `/v1/team/setups/${code}`, { cookie: supporter })).status, 403);
    assert.deepEqual((await webApi(service, 'DELETE', `/v1/team/setups/${code}`, { cookie: moderator })).body, { ok: true, code, revoked: true });
    assert.equal((await view(code)).status, 410);
    assert.equal((await webApi(service, 'DELETE', '/v1/team/setups/aaaaaaaaaa', { cookie: moderator })).status, 404);
    const audit = await webApi(service, 'GET', '/v1/team/audit', { cookie: moderator });
    assert.ok(audit.body.entries.some((e: any) => e.action === 'setup.revoke' && e.target === `Fragwürdig (${code})`));
  });

  test('Datenauskunft mit Setups; Konto löschen löscht sie', async () => {
    const carla = await devPlayer(service.url, 'Carla');
    const { code } = (await create(carla, valid({ name: 'Carlas Setup' }))).body;
    const exported = (await api(service.url, 'GET', '/v1/me/export', { token: carla.token })).body;
    assert.deepEqual(exported.setups.map((s: any) => [s.code, s.name, s.content.minecraft]), [[code, 'Carlas Setup', '26.3']]);
    await api(service.url, 'DELETE', '/v1/me', { token: carla.token });
    assert.equal((await view(code)).status, 404);
  });
});

describe('Setup teilen: Grenzen und Aufräumen', () => {
  test('höchstens N aktive je Spieler, M neue je Tag; abgelaufene und widerrufene nach 30 Tagen gelöscht', async () => {
    const service = await startService({ dev: true, website: WEBSITE, setupMaxActive: 2, setupDailyLimit: 3, sweepIntervalMs: 50 });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const create = () => api(service.url, 'POST', '/v1/setups', { token: anna.token, body: { name: 'S', content: CONTENT } });
      const first = await create();
      assert.equal(first.status, 201);
      assert.equal(first.body.expires, null, 'ohne expiresDays: läuft nie ab');
      assert.equal((await create()).status, 201);
      const full = await create();
      assert.deepEqual([full.status, full.body.code], [409, 'SETUP_LIMIT']);
      await api(service.url, 'DELETE', `/v1/setups/${first.body.code}`, { token: anna.token });
      const third = await create();
      assert.equal(third.status, 201);
      await api(service.url, 'DELETE', `/v1/setups/${third.body.code}`, { token: anna.token });
      const daily = await create();
      assert.deepEqual([daily.status, daily.body.code], [429, 'SETUP_DAILY']);
      assert.ok(Number(daily.headers.get('retry-after')) > 0);

      // Aufräumen: widerrufen vor mehr als 30 Tagen bzw. abgelaufen vor mehr als 30 Tagen
      sql(service, 'UPDATE setups SET revoked_at = ? WHERE code = ?', Date.now() - 31 * DAY, first.body.code);
      sql(service, 'UPDATE setups SET revoked_at = ? WHERE code = ?', Date.now() - 29 * DAY, third.body.code);
      await waitFor(async () => (await api(service.url, 'GET', '/v1/setups', { token: anna.token })).body.setups.length === 2);
      const left = (await api(service.url, 'GET', '/v1/setups', { token: anna.token })).body.setups.map((s: any) => s.code).sort();
      assert.ok(!left.includes(first.body.code) && left.includes(third.body.code));
    } finally {
      await service.close();
    }
  });
});
