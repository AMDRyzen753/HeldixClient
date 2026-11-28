// Server-Partner (1.14.0): Recht partners:manage, Anträge, Partner und Schlüssel (nur gehasht), öffentliche Liste,
// Partner-Schnittstelle (Anmeldung, pausiert, /me), Belohnungen nur für Partner-Cosmetics des eigenen Partners, Zugang
// „partner“ im Katalog, Grenzen, Datenauskunft und Konto löschen.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { serverMatches } from '../src/partners';
import { manifestOf, signCosmetic } from './cosmetic-fixtures';
import { api, connect, devPlayer, startService, type Player, type TestService, type WsClient } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

const KEY_RE = /^hxp_[0-9A-Za-z]{40}$/;

function query(service: TestService, sql: string, ...params: string[]): Record<string, unknown>[] {
  const db = new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

const partnerApi = (service: TestService, method: string, pathname: string, key: string, body?: unknown) =>
  api(service.url, method, pathname, { headers: { Authorization: `Partner ${key}` }, body });

describe('Server-Partner: Team, Anträge, Schlüssel, öffentliche Liste', () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  let service: TestService;
  let admin: string;
  let developer: string;
  let moderator: string;
  let designer: string;
  let anna: Player;
  let ben: Player;
  const clients: WsClient[] = [];

  const team = (cookie: string, method: string, pathname: string, body?: unknown) => webApi(service, method, pathname, { cookie, body });
  const publish = async (manifest: Record<string, unknown>) => {
    const res = await team(admin, 'PUT', '/v1/team/cosmetics', signCosmetic(keys.privateKey, manifest));
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };

  before(async () => {
    service = await startService({
      dev: true,
      website: WEBSITE,
      totpNow: clock.read,
      updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    admin = (await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock)).cookie;
    developer = (await teamLogin(service, await devPlayer(service.url, 'Entwicklerin'), 'developer-team', clock)).cookie;
    moderator = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
    designer = (await teamLogin(service, await devPlayer(service.url, 'Designerin'), 'designer', clock)).cookie;
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
  });
  after(async () => {
    for (const client of clients) await client.close();
    await service.close();
  });

  test('Recht partners:manage: Admin und Entwickler, sonst 403; Text in der Rechte-Übersicht', async () => {
    assert.equal((await team(admin, 'GET', '/v1/team/partners')).status, 200);
    assert.equal((await team(developer, 'GET', '/v1/team/partners')).status, 200);
    for (const cookie of [moderator, designer]) {
      for (const [method, pathname] of [
        ['GET', '/v1/team/partners'],
        ['POST', '/v1/team/partners'],
        ['GET', '/v1/team/partner-applications'],
        ['PUT', '/v1/team/cosmetics/krone/partner'],
      ] as const) {
        const res = await team(cookie, method, pathname, method === 'GET' ? undefined : {});
        assert.deepEqual([res.status, res.body.code], [403, 'forbidden'], `${method} ${pathname}`);
      }
    }
    const rights = await team(admin, 'GET', '/v1/team/permissions');
    assert.deepEqual(
      rights.body.permissions.find((p: { id: string }) => p.id === 'partners:manage'),
      { id: 'partners:manage', label: 'Partner-Server verwalten (Anträge, Schlüssel, Cosmetics)' },
    );
    // Ohne Anmeldung bzw. als Spieler: kein Team-Bereich
    assert.equal((await api(service.url, 'GET', '/v1/team/partners', { token: anna.token })).status, 401);
  });

  test('Anträge: anlegen (201), Prüfungen, höchstens einer offen, eigene Liste, Team entscheidet', async () => {
    const apply = (body: unknown, player = anna) => api(service.url, 'POST', '/v1/partner-applications', { token: player.token, body });
    const valid = { server: 'Play.Example.NET', name: 'Beispiel-Netzwerk', description: 'Minispiele und Survival', contact: 'discord: beispiel' };
    for (const [body, why] of [
      [{ ...valid, server: '127.0.0.1' }, 'IP-Adresse'],
      [{ ...valid, server: 'localhost' }, 'localhost'],
      [{ ...valid, name: '' }, 'Name leer'],
      [{ ...valid, name: 'x'.repeat(41) }, 'Name zu lang'],
      [{ ...valid, description: 'x'.repeat(301) }, 'Beschreibung zu lang'],
      [{ ...valid, contact: 'x'.repeat(201) }, 'Kontakt zu lang'],
      [{ ...valid, description: 'zwei\nZeilen' }, 'Zeilenumbruch'],
    ] as const) {
      assert.equal((await apply(body)).status, 400, why);
    }
    assert.equal((await api(service.url, 'POST', '/v1/partner-applications', { body: valid })).status, 401);
    const first = await apply(valid);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(Object.keys(first.body), ['id']);
    const again = await apply(valid);
    assert.deepEqual([again.status, again.body.code], [409, 'APPLICATION_OPEN']);

    const mine = await api(service.url, 'GET', '/v1/account/partner-applications', { token: anna.token });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.applications, [
      { id: first.body.id, server: 'play.example.net', name: 'Beispiel-Netzwerk', description: 'Minispiele und Survival', contact: 'discord: beispiel', created: mine.body.applications[0].created, status: 'open', note: null, decidedAt: null },
    ]);
    // Ben sieht Annas Antrag nicht
    assert.deepEqual((await api(service.url, 'GET', '/v1/account/partner-applications', { token: ben.token })).body.applications, []);

    // Über die Webseite (Cookie, CSRF-Header) geht es auch
    const { cookie: benCookie } = await webLogin(service, ben);
    const viaWeb = await webApi(service, 'POST', '/v1/partner-applications', { cookie: benCookie, body: { server: 'ben.example.org', name: 'Bens Server' } });
    assert.equal(viaWeb.status, 201, JSON.stringify(viaWeb.body));
    assert.equal((await webApi(service, 'POST', '/v1/partner-applications', { cookie: benCookie, body: { server: 'b.example.org', name: 'X' }, csrf: false })).status, 403);

    const open = await team(developer, 'GET', '/v1/team/partner-applications');
    assert.deepEqual(
      open.body.applications.map((a: any) => [a.name, a.player.name, a.status]),
      [
        ['Bens Server', 'Ben', 'open'],
        ['Beispiel-Netzwerk', 'Anna', 'open'],
      ],
    );
    assert.equal((await team(admin, 'GET', '/v1/team/partner-applications?status=irgendwas')).status, 400);
    assert.equal((await team(admin, 'PUT', '/v1/team/partner-applications/99999', { status: 'accepted' })).status, 404);
    assert.equal((await team(admin, 'PUT', `/v1/team/partner-applications/${first.body.id}`, { status: 'vielleicht' })).status, 400);
    const declined = await team(admin, 'PUT', `/v1/team/partner-applications/${first.body.id}`, { status: 'declined', note: 'Bitte erst mehr Spieler sammeln.' });
    assert.equal(declined.status, 200, JSON.stringify(declined.body));
    assert.deepEqual([declined.body.application.status, declined.body.application.note, declined.body.application.decidedBy], ['declined', 'Bitte erst mehr Spieler sammeln.', 'Chefin']);
    const seen = (await api(service.url, 'GET', '/v1/account/partner-applications', { token: anna.token })).body.applications[0];
    assert.deepEqual([seen.status, seen.note, typeof seen.decidedAt], ['declined', 'Bitte erst mehr Spieler sammeln.', 'number']);
    // Abgelehnt: ein neuer Antrag geht wieder
    const second = await apply({ ...valid, description: 'Jetzt mit 200 Spielern' });
    assert.equal(second.status, 201);
    const accepted = await team(admin, 'PUT', `/v1/team/partner-applications/${second.body.id}`, { status: 'accepted' });
    assert.equal(accepted.body.application.status, 'accepted');
    // Annehmen legt keinen Partner an
    assert.deepEqual((await team(admin, 'GET', '/v1/team/partners')).body.partners, []);
    assert.ok((await team(admin, 'GET', '/v1/team/audit')).body.entries.some((e: any) => e.action === 'partner-application.decide'));
  });

  test('Partner anlegen und ändern (Prüfungen), Schlüssel nur gehasht, öffentliche Liste mit Cache und CORS', async () => {
    const create = (body: unknown, cookie = admin) => team(cookie, 'POST', '/v1/team/partners', body);
    const valid = { id: 'beispiel', name: 'Beispiel-Netzwerk', description: 'Minispiele', website: 'https://beispiel.example', servers: ['Example.NET', 'play.example.net:25565'], featured: false };
    for (const [body, why] of [
      [{ ...valid, id: 'AB' }, 'ID zu kurz und groß'],
      [{ ...valid, id: 'mit leerzeichen' }, 'ID mit Leerzeichen'],
      [{ ...valid, name: 'x'.repeat(41) }, 'Name zu lang'],
      [{ ...valid, description: 'x'.repeat(301) }, 'Beschreibung zu lang'],
      [{ ...valid, website: 'http://beispiel.example' }, 'kein https'],
      [{ ...valid, website: 'https://nutzer:pw@beispiel.example' }, 'mit Zugangsdaten'],
      [{ ...valid, servers: [] }, 'keine Server'],
      [{ ...valid, servers: ['10.0.0.1'] }, 'IP-Adresse'],
      [{ ...valid, servers: Array.from({ length: 11 }, (_, i) => `s${i}.example.net`) }, '11 Server'],
      [{ ...valid, featured: 'ja' }, 'featured kein Bool'],
      [{ ...valid, contactUuid: 'nein' }, 'contactUuid keine UUID'],
    ] as const) {
      assert.equal((await create(body)).status, 400, why);
    }
    const application = (await api(service.url, 'GET', '/v1/account/partner-applications', { token: anna.token })).body.applications[0];
    const created = await create({ ...valid, application: application.id });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.partner, {
      id: 'beispiel',
      name: 'Beispiel-Netzwerk',
      description: 'Minispiele',
      website: 'https://beispiel.example/',
      // normalisiert, ohne Doppelte (25565 fällt weg)
      servers: ['example.net', 'play.example.net'],
      status: 'active',
      featured: false,
      created: created.body.partner.created,
      hasKey: false,
      keyCreated: null,
      contact: { uuid: anna.uuid, name: 'Anna' },
      cosmetics: [],
    });
    assert.deepEqual([(await create(valid)).status, (await create(valid)).body.code], [409, 'PARTNER_EXISTS']);
    const taken = await create({ ...valid, id: 'zweiter', servers: ['example.net'] });
    assert.deepEqual([taken.status, taken.body.code], [409, 'SERVER_TAKEN']);
    const other = await create({ id: 'andere-welt', name: 'Andere Welt', description: '', website: null, servers: ['andere.example.org'], featured: true }, developer);
    assert.equal(other.status, 201);
    const hidden = await create({ id: 'pausiert', name: 'Pausiert', servers: ['pause.example.org'] });
    assert.equal(hidden.status, 201);
    assert.equal((await team(admin, 'PUT', '/v1/team/partners/pausiert', { status: 'weg' })).status, 400);
    assert.equal((await team(admin, 'PUT', '/v1/team/partners/pausiert', { status: 'paused' })).body.partner.status, 'paused');
    assert.equal((await team(admin, 'PUT', '/v1/team/partners/gibtsnicht', { name: 'x' })).status, 404);

    // Öffentliche Liste: nur aktive, hervorgehobene zuerst, nur öffentliche Felder, Cache 5 Minuten, CORS
    const list = await api(service.url, 'GET', '/v1/public/partners');
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(list.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(list.body, {
      partners: [
        { id: 'andere-welt', name: 'Andere Welt', description: '', website: null, servers: ['andere.example.org'], featured: true },
        { id: 'beispiel', name: 'Beispiel-Netzwerk', description: 'Minispiele', website: 'https://beispiel.example/', servers: ['example.net', 'play.example.net'], featured: false },
      ],
    });
    // Änderung gilt sofort (Zwischenspeicher wird geleert); gleich hervorgehoben: nach Name
    await team(admin, 'PUT', '/v1/team/partners/beispiel', { featured: true, name: 'Beispiel' });
    assert.deepEqual((await api(service.url, 'GET', '/v1/public/partners')).body.partners.map((p: any) => [p.id, p.name, p.featured]), [
      ['andere-welt', 'Andere Welt', true],
      ['beispiel', 'Beispiel', true],
    ]);

    // Schlüssel: Format hxp_ + 40 Base62, nur einmal im Klartext, gespeichert nur der SHA-256
    const first = await team(admin, 'POST', '/v1/team/partners/beispiel/key');
    assert.equal(first.status, 200);
    assert.match(first.body.key, KEY_RE);
    const rows = query(service, 'SELECT * FROM partners WHERE id = ?', 'beispiel');
    assert.equal(rows[0]!.key_hash, createHash('sha256').update(first.body.key).digest('hex'));
    assert.ok(!JSON.stringify(rows).includes(first.body.key), 'Schlüssel im Klartext gespeichert');
    assert.ok(!JSON.stringify((await team(admin, 'GET', '/v1/team/partners')).body).includes(first.body.key), 'Schlüssel in der Übersicht');
    assert.deepEqual((await team(admin, 'GET', '/v1/team/partners')).body.partners.find((p: any) => p.id === 'beispiel').hasKey, true);
    assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', first.body.key)).status, 200);
    const second = await team(admin, 'POST', '/v1/team/partners/beispiel/key');
    assert.notEqual(second.body.key, first.body.key);
    assert.deepEqual((await partnerApi(service, 'GET', '/v1/partner/me', first.body.key)).body.code, 'PARTNER_KEY_INVALID', 'alter Schlüssel gilt nicht mehr');
    assert.deepEqual((await partnerApi(service, 'GET', '/v1/partner/me', second.body.key)).body, { id: 'beispiel', name: 'Beispiel', servers: ['example.net', 'play.example.net'], cosmetics: [] });
    assert.ok((await team(admin, 'GET', '/v1/team/audit')).body.entries.some((e: any) => e.action === 'partner.key' && e.detail === 'ersetzt'));
  });

  test('Partner-Schnittstelle: ohne bzw. falscher Schlüssel 401, Spieler-Token 401, pausiert 403', async () => {
    const key = (await team(admin, 'POST', '/v1/team/partners/pausiert/key')).body.key as string;
    assert.equal((await api(service.url, 'GET', '/v1/partner/me')).status, 401);
    for (const header of [`Partner hxp_${'a'.repeat(40)}`, 'Partner falsch', `Bearer ${anna.token}`, `Partner  ${key} extra`]) {
      const res = await api(service.url, 'GET', '/v1/partner/me', { headers: { Authorization: header } });
      assert.deepEqual([res.status, res.body.code], [401, 'PARTNER_KEY_INVALID'], header);
    }
    const paused = await partnerApi(service, 'GET', '/v1/partner/me', key);
    assert.deepEqual([paused.status, paused.body.code], [403, 'PARTNER_PAUSED']);
    await team(admin, 'PUT', '/v1/team/partners/pausiert', { status: 'active' });
    assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', key)).status, 200);
    // Partner-Schlüssel gilt nicht für Spieler-Routen
    assert.equal((await partnerApi(service, 'GET', '/v1/me', key)).status, 401);
    await team(admin, 'PUT', '/v1/team/partners/pausiert', { status: 'paused' });
  });

  test('Belohnungen: Zugang „partner“ im Katalog, nur Cosmetics des eigenen Partners, Freischaltung mit Echtzeit-Nachricht', async () => {
    await publish(manifestOf('aura', { id: 'beispielfunken', name: 'Beispielfunken', access: 'unlock' }));
    await publish(manifestOf('cape', { id: 'beispielcape', name: 'Beispiel-Cape', access: 'unlock' }));
    await publish(manifestOf('aura', { id: 'fremdfunken', name: 'Fremdfunken', access: 'unlock' }));
    await publish(manifestOf('aura', { id: 'freiefunken', name: 'Freie Funken', access: 'unlock' }));
    await publish(manifestOf('aura', { id: 'allefunken', name: 'Alle Funken', access: 'all' }));
    const assign = (cookie: string, id: string, partner: unknown) => team(cookie, 'PUT', `/v1/team/cosmetics/${id}/partner`, { partner });
    assert.equal((await assign(admin, 'beispielfunken', 'beispiel')).status, 200);
    assert.equal((await assign(developer, 'fremdfunken', 'andere-welt')).status, 200);
    const notUnlock = await assign(admin, 'allefunken', 'beispiel');
    assert.deepEqual([notUnlock.status, notUnlock.body.code], [409, 'NOT_UNLOCK']);
    assert.equal((await assign(admin, 'gibtsnicht', 'beispiel')).status, 404);
    assert.equal((await assign(admin, 'freiefunken', 'gibtsnicht')).status, 404);
    assert.equal((await assign(admin, 'freiefunken', 42)).status, 400);
    assert.equal((await team(admin, 'PUT', '/v1/team/cosmetics/freiefunken/partner', {})).status, 400);
    // Über PATCH: Designerin (nur „cosmetics“) darf nicht zuordnen, Entwicklerin schon
    const denied = await team(designer, 'PATCH', '/v1/team/cosmetics/beispielcape', { partner: 'beispiel' });
    assert.deepEqual([denied.status, denied.body.code], [403, 'forbidden']);
    const patched = await team(developer, 'PATCH', '/v1/team/cosmetics/beispielcape', { partner: 'beispiel' });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    // hidden geht weiter wie bisher
    assert.equal((await team(designer, 'PATCH', '/v1/team/cosmetics/allefunken', { hidden: false })).status, 200);
    // Wie die Webseite: { access: "partner", partner } zuordnen, mit dem Zugang aus dem Manifest wieder lösen
    const accessOf = (res: any, id: string) => res.body.cosmetics.find((c: any) => c.id === id).access;
    const viaAccess = await team(developer, 'PATCH', '/v1/team/cosmetics/freiefunken', { access: 'partner', partner: 'andere-welt' });
    assert.deepEqual([viaAccess.status, accessOf(viaAccess, 'freiefunken')], [200, 'partner']);
    assert.equal((await team(designer, 'PATCH', '/v1/team/cosmetics/freiefunken', { access: 'unlock' })).status, 403, 'Lösen braucht partners:manage');
    assert.equal(accessOf(await team(developer, 'PATCH', '/v1/team/cosmetics/freiefunken', { access: 'unlock' }), 'freiefunken'), 'unlock');
    assert.equal((await team(designer, 'PATCH', '/v1/team/cosmetics/freiefunken', { access: 'unlock' })).status, 200, 'ohne Änderung reicht „cosmetics“');
    const signed = await team(admin, 'PATCH', '/v1/team/cosmetics/freiefunken', { access: 'all' });
    assert.deepEqual([signed.status, signed.body.code], [409, 'ACCESS_SIGNED']);
    assert.equal((await team(admin, 'PATCH', '/v1/team/cosmetics/freiefunken', { access: 'partner' })).status, 400, 'ohne Partner');
    assert.equal((await team(admin, 'PATCH', '/v1/team/cosmetics/allefunken', { access: 'partner', partner: 'beispiel' })).body.code, 'NOT_UNLOCK');

    const catalog = (await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics;
    const entry = (id: string) => catalog.find((c: any) => c.id === id);
    assert.deepEqual([entry('beispielfunken').access, entry('beispielfunken').partner, entry('beispielfunken').partnerName], ['partner', 'beispiel', 'Beispiel']);
    assert.deepEqual([entry('beispielcape').access, entry('beispielcape').partner], ['partner', 'beispiel']);
    assert.deepEqual([entry('fremdfunken').access, entry('fremdfunken').partnerName], ['partner', 'Andere Welt']);
    assert.deepEqual([entry('freiefunken').access, 'partner' in entry('freiefunken')], ['unlock', false]);
    assert.equal(entry('allefunken').access, 'all');
    // Das signierte Manifest bleibt unverändert (access unlock)
    const envelope = (await api(service.url, 'GET', '/v1/cosmetics/beispielfunken')).body;
    assert.equal(JSON.parse(envelope.manifest).access, 'unlock');
    // Team-Übersicht: access partner, manifestAccess unlock
    const overview = (await team(admin, 'GET', '/v1/team/cosmetics')).body.cosmetics.find((c: any) => c.id === 'beispielfunken');
    assert.deepEqual([overview.access, overview.manifestAccess, overview.partner, overview.partnerName], ['partner', 'unlock', 'beispiel', 'Beispiel']);

    const key = (await team(admin, 'POST', '/v1/team/partners/beispiel/key')).body.key as string;
    const otherKey = (await team(admin, 'POST', '/v1/team/partners/andere-welt/key')).body.key as string;
    assert.deepEqual((await partnerApi(service, 'GET', '/v1/partner/me', key)).body.cosmetics, ['beispielcape', 'beispielfunken']);
    const reward = (body: unknown, k = key) => partnerApi(service, 'POST', '/v1/partner/rewards', k, body);

    // Ohne Freischaltung: wählen geht nicht, mit dem Hinweis auf den Partner
    const locked = await api(service.url, 'PUT', '/v1/me/cosmetics', { token: anna.token, body: { slot: 'aura', id: 'beispielfunken' } });
    assert.deepEqual(locked.body, { error: 'Dieses Cosmetic bekommst du als Belohnung auf Beispiel.', code: 'LOCKED' });

    const { client } = await connect(service.wsUrl, anna.token);
    clients.push(client);
    const granted = await reward({ uuid: anna.uuid, cosmetic: 'beispielfunken' });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.deepEqual(granted.body, { granted: true, already: false });
    assert.deepEqual(await client.next('unlock'), { type: 'unlock', cosmetic: 'beispielfunken', reason: 'partner', partner: 'Beispiel' });
    assert.deepEqual((await reward({ uuid: anna.uuid, cosmetic: 'beispielfunken' })).body, { granted: true, already: true });
    assert.deepEqual(query(service, 'SELECT reason FROM unlocks WHERE uuid = ? AND cosmetic = ?', anna.uuid, 'beispielfunken'), [{ reason: 'partner:beispiel' }]);
    assert.ok((await api(service.url, 'GET', '/v1/me/cosmetics', { token: anna.token })).body.unlocked.includes('beispielfunken'));
    // nicht unter den Einladungen (sonst melden Launcher sie als „Belohnung für deine Einladungen“)
    assert.ok(!(await api(service.url, 'GET', '/v1/invites', { token: anna.token })).body.unlocked.includes('beispielfunken'));
    assert.equal((await api(service.url, 'PUT', '/v1/me/cosmetics', { token: anna.token, body: { slot: 'aura', id: 'beispielfunken' } })).status, 200);

    for (const [body, status, code, why] of [
      [{ uuid: anna.uuid, cosmetic: 'fremdfunken' }, 403, 'NOT_PARTNER_COSMETIC', 'Cosmetic eines anderen Partners'],
      [{ uuid: anna.uuid, cosmetic: 'freiefunken' }, 403, 'NOT_PARTNER_COSMETIC', 'Belohnung ohne Partner'],
      [{ uuid: anna.uuid, cosmetic: 'allefunken' }, 403, 'NOT_PARTNER_COSMETIC', 'Cosmetic für alle'],
      [{ uuid: anna.uuid, cosmetic: 'gibtsnicht' }, 404, 'UNKNOWN_COSMETIC', 'unbekanntes Cosmetic'],
      [{ uuid: 'a'.repeat(32), cosmetic: 'beispielfunken' }, 404, 'UNKNOWN_PLAYER', 'unbekannter Spieler'],
      [{ uuid: 'keine-uuid', cosmetic: 'beispielfunken' }, 400, undefined, 'keine UUID'],
      [{ uuid: anna.uuid, cosmetic: 'Groß' }, 400, undefined, 'ungültige ID'],
    ] as const) {
      const res = await reward(body);
      assert.deepEqual([res.status, res.body.code], [status, code], why);
    }
    // Der andere Partner darf seine eigenen vergeben, aber nicht die von „beispiel“
    assert.equal((await reward({ uuid: ben.uuid, cosmetic: 'fremdfunken' }, otherKey)).status, 200);
    assert.equal((await reward({ uuid: ben.uuid, cosmetic: 'beispielcape' }, otherKey)).body.code, 'NOT_PARTNER_COSMETIC');
    // Ausgeblendet: nicht mehr im Katalog, keine Belohnung
    await team(admin, 'PATCH', '/v1/team/cosmetics/beispielcape', { hidden: true });
    assert.equal((await reward({ uuid: ben.uuid, cosmetic: 'beispielcape' })).status, 404);
    assert.deepEqual((await partnerApi(service, 'GET', '/v1/partner/me', key)).body.cosmetics, ['beispielfunken']);
    await team(admin, 'PATCH', '/v1/team/cosmetics/beispielcape', { hidden: false });

    // Zuordnung lösen (null): wieder eine normale Belohnung
    assert.equal((await team(admin, 'PATCH', '/v1/team/cosmetics/beispielcape', { partner: null })).status, 200);
    assert.equal((await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics.find((c: any) => c.id === 'beispielcape').access, 'unlock');

    // Partner löschen: Katalog wieder unlock, vergebene Freischaltungen bleiben
    assert.deepEqual((await team(admin, 'DELETE', '/v1/team/partners/beispiel')).body, { ok: true });
    assert.equal((await team(admin, 'DELETE', '/v1/team/partners/beispiel')).status, 404);
    assert.equal((await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics.find((c: any) => c.id === 'beispielfunken').access, 'unlock');
    assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', key)).status, 401);
    assert.ok((await api(service.url, 'GET', '/v1/me/cosmetics', { token: anna.token })).body.unlocked.includes('beispielfunken'));
    assert.deepEqual(query(service, 'SELECT count(*) AS n FROM partner_cosmetics WHERE partner = ?', 'beispiel'), [{ n: 0 }]);
  });

  test('Datenauskunft mit Anträgen; Konto löschen löscht Anträge und den Kontakt des Partners', async () => {
    const carla = await devPlayer(service.url, 'Carla');
    const res = await api(service.url, 'POST', '/v1/partner-applications', { token: carla.token, body: { server: 'carla.example.net', name: 'Carlas Welt' } });
    assert.equal(res.status, 201);
    const created = await team(admin, 'POST', '/v1/team/partners', { id: 'carla', name: 'Carlas Welt', servers: ['carla.example.net'], application: res.body.id });
    assert.equal(created.body.partner.contact.uuid, carla.uuid);
    const exported = await api(service.url, 'GET', '/v1/me/export', { token: carla.token });
    assert.deepEqual(exported.body.partnerApplications.map((a: any) => a.name), ['Carlas Welt']);
    assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: carla.token })).status, 200);
    assert.deepEqual(query(service, 'SELECT count(*) AS n FROM partner_applications WHERE uuid = ?', carla.uuid), [{ n: 0 }]);
    assert.equal((await team(admin, 'GET', '/v1/team/partners')).body.partners.find((p: any) => p.id === 'carla').contact, null);
  });
});

describe('Server-Partner: Grenzen', () => {
  test('Anfragen je Schlüssel, Belohnungen je Partner und Stunde, ungültige Schlüssel je IP', async () => {
    const clock = new Clock();
    const keys = generateKeyPairSync('ed25519');
    const service = await startService({
      dev: true,
      website: WEBSITE,
      totpNow: clock.read,
      updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      partnerRateLimit: 4,
      partnerRewardRateLimit: 2,
      partnerFailRateLimit: 3,
    });
    try {
      const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
      await webApi(service, 'POST', '/v1/team/partners', { cookie, body: { id: 'netz', name: 'Netz', servers: ['netz.example.net'] } });
      await webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, body: signCosmetic(keys.privateKey, manifestOf('aura', { id: 'netzfunken', access: 'unlock' })) });
      await webApi(service, 'PUT', '/v1/team/cosmetics/netzfunken/partner', { cookie, body: { partner: 'netz' } });
      const key = (await webApi(service, 'POST', '/v1/team/partners/netz/key', { cookie })).body.key as string;
      const anna = await devPlayer(service.url, 'Anna');
      const reward = () => partnerApi(service, 'POST', '/v1/partner/rewards', key, { uuid: anna.uuid, cosmetic: 'netzfunken' });
      assert.equal((await reward()).status, 200);
      assert.equal((await reward()).status, 200);
      const tooMany = await reward();
      assert.equal(tooMany.status, 429);
      assert.ok(Number(tooMany.headers.get('retry-after')) > 0);
      // vierte Anfrage im Zeitraum: noch erlaubt, die fünfte nicht (je Schlüssel)
      assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', key)).status, 200);
      assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', key)).status, 429);
      // Ungültige Schlüssel: nach 3 Versuchen je IP 429
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await partnerApi(service, 'GET', '/v1/partner/me', `hxp_${'b'.repeat(40)}`)).status);
      assert.deepEqual(statuses, [401, 401, 401, 429]);
    } finally {
      await service.close();
    }
  });
});

describe('Server-Partner: Entwicklungsmodus', () => {
  test('POST /v1/dev/partner legt an bzw. setzt aktiv und liefert einen neuen Schlüssel; ohne HELDIX_DIENST_DEV 404', async () => {
    const service = await startService({ dev: true });
    const off = await startService({});
    try {
      const first = await api(service.url, 'POST', '/v1/dev/partner', { body: { servers: ['plugin.example.net'] } });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.match(first.body.key, KEY_RE);
      assert.deepEqual([first.body.partner.id, first.body.partner.name, first.body.partner.servers, first.body.partner.status], ['autotest', 'Autotest', ['plugin.example.net'], 'active']);
      assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', first.body.key)).status, 200);
      const second = await api(service.url, 'POST', '/v1/dev/partner', { body: { name: 'Plugin-Test' } });
      assert.equal(second.body.partner.name, 'Plugin-Test');
      assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', first.body.key)).status, 401, 'alter Schlüssel ungültig');
      assert.equal((await partnerApi(service, 'GET', '/v1/partner/me', second.body.key)).status, 200);
      // über einen Proxy (X-Forwarded-For) nicht
      assert.equal((await api(service.url, 'POST', '/v1/dev/partner', { headers: { 'X-Forwarded-For': '1.2.3.4' } })).status, 404);
      assert.equal((await api(off.url, 'POST', '/v1/dev/partner', { body: {} })).status, 404);
    } finally {
      await service.close();
      await off.close();
    }
  });
});

describe('Server-Adressen der Partner', () => {
  test('eine Domain deckt ihre Subdomains ab; ein Port im Eintrag muss passen', () => {
    assert.equal(serverMatches('example.net', 'example.net'), true);
    assert.equal(serverMatches('example.net', 'mc.example.net'), true);
    assert.equal(serverMatches('example.net', 'a.b.example.net:25566'), true);
    assert.equal(serverMatches('example.net', 'notexample.net'), false);
    assert.equal(serverMatches('example.net', 'example.net.evil.org'), false);
    assert.equal(serverMatches('play.example.net', 'example.net'), false);
    assert.equal(serverMatches('example.net:25566', 'example.net:25566'), true);
    assert.equal(serverMatches('example.net:25566', 'example.net'), false);
    assert.equal(serverMatches('example.net:25566', 'mc.example.net:25567'), false);
  });
});
