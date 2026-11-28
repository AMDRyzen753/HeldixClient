// Team-Rollen und Rechte je Route (ab 1.12.0), Rechte-Übersicht, Letzter-Admin-Schutz, Community-Abzeichen, Reihenfolge
// der Abzeichen beim Nachschlagen und in der Freundesliste, Team-Übersicht, Migration der Rollen (Schema 10 → 11).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { Store, type AddonVersionRow } from '../src/db';
import { PERMISSIONS, TEAM_ROLES, type TeamRole } from '../src/roles';
import { api, befriend, connect, devPlayer, randomUuid, startService, UNDO_SCHEMA_11, type Player, type TestService, type WsClient } from './helpers';
import { addToTeam, Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

/** Erwartete Rechte je Rolle (Tabelle aus rollen-spec.md, unabhängig von roles.ts aufgeschrieben). */
const EXPECTED: Record<TeamRole, string[]> = {
  admin: [
    'team.manage',
    'players.delete',
    'updates',
    'addons',
    'addon-reports',
    'cosmetics',
    'news',
    'moderation',
    'players',
    'support',
    'audit',
    'team.view',
    'hosting:manage',
    'hosting:grant',
    'discover:moderate',
    // ab 1.13.0: Voice-Moderation (Admin, Moderator, Supporter) und Voice-Einstellungen (nur Admin)
    'voice:moderate',
    'voice:admin',
    // ab 1.14.0: Partner-Server (Admin und Entwickler)
    'partners:manage',
  ],
  'developer-team': ['updates', 'addons', 'addon-reports', 'cosmetics', 'news', 'players', 'audit', 'team.view', 'hosting:manage', 'partners:manage'],
  moderator: ['addon-reports', 'news', 'moderation', 'players', 'support', 'audit', 'team.view', 'discover:moderate', 'voice:moderate'],
  supporter: ['players', 'support', 'team.view', 'discover:moderate', 'voice:moderate'],
  designer: ['cosmetics', 'team.view'],
  tester: ['team.view'],
};

function withStore(service: TestService, fn: (store: Store) => void): void {
  const store = new Store(service.dataDir);
  try {
    fn(store);
  } finally {
    store.close();
  }
}

function communityAddon(id: string, author: Player): AddonVersionRow {
  const file = `heldix-addon-${id}-1.0.0.jar`;
  return {
    id,
    version: '1.0.0',
    manifest: JSON.stringify({
      type: 'heldix-addon',
      id,
      name: 'Test-Addon',
      version: '1.0.0',
      summary: 'Zeigt etwas im HUD an.',
      description: '',
      authors: [author.name],
      api: 1,
      icon: 'clock',
      category: 'hud',
      platforms: [],
      file,
      size: 100,
      sha256: 'a'.repeat(64),
      date: '2026-11-25',
      notes: [],
      official: false,
      author: { uuid: author.uuid, name: author.name },
    }),
    signature: 'x'.repeat(88),
    file,
    size: 100,
    sha256: 'a'.repeat(64),
    publishedAt: Date.now(),
    publishedBy: null,
  };
}

describe('Rollen und Rechte', () => {
  const clock = new Clock();
  let service: TestService;
  const cookies = new Map<TeamRole, string>();
  const members = new Map<TeamRole, Player>();

  before(async () => {
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    for (const role of TEAM_ROLES) {
      const player = await devPlayer(service.url, `Rolle_${role.replace('-', '')}`.slice(0, 16));
      members.set(role, player);
      cookies.set(role, (await teamLogin(service, player, role, clock)).cookie);
    }
  });
  after(() => service.close());

  const as = (role: TeamRole, method: string, p: string, body?: unknown) => webApi(service, method, p, { cookie: cookies.get(role)!, body });

  test('jede Rolle darf genau die Routen ihrer Rechte (sonst 403 forbidden)', async () => {
    const unknown = randomUuid();
    // Je Recht eine Route; ungültige Körper bzw. unbekannte IDs: erlaubt heißt dann 400/404 statt 403.
    const probes: [string, string, string, unknown?][] = [
      ['team.manage', 'POST', '/v1/team/members', {}],
      ['team.manage', 'PUT', `/v1/team/badges/${unknown}`, { badge: 'partner' }],
      ['players.delete', 'DELETE', `/v1/team/players/${unknown}`],
      ['updates', 'GET', '/v1/team/updates'],
      ['addons', 'GET', '/v1/team/addons'],
      ['addons', 'GET', '/v1/team/addon-submissions'],
      ['addon-reports', 'GET', '/v1/team/addon-reports'],
      ['cosmetics', 'GET', '/v1/team/cosmetics'],
      ['news', 'GET', '/v1/team/news'],
      ['moderation', 'GET', '/v1/team/reports'],
      ['moderation', 'GET', '/v1/team/bans'],
      ['moderation', 'POST', `/v1/team/players/${unknown}/reset-cape`],
      ['players', 'GET', '/v1/team/players'],
      ['support', 'GET', '/v1/team/support'],
      ['audit', 'GET', '/v1/team/audit'],
      ['team.view', 'GET', '/v1/team/members'],
      ['team.view', 'GET', '/v1/team/badges'],
    ];
    for (const role of TEAM_ROLES) {
      for (const [permission, method, p, body] of probes) {
        const res = await as(role, method, p, body);
        const allowed = EXPECTED[role].includes(permission);
        if (allowed) {
          assert.notEqual(res.status, 403, `${role} darf ${method} ${p}: ${JSON.stringify(res.body)}`);
        } else {
          assert.deepEqual([res.status, res.body.code], [403, 'forbidden'], `${role} darf nicht ${method} ${p}`);
          assert.match(res.body.error, /^Dafür fehlt deiner Rolle das Recht „.+“\.$/);
        }
      }
      // Ohne Recht: eigenes Teamprofil, Rechte-Übersicht, Team-Übersicht
      for (const p of ['/v1/team/me/profile', '/v1/team/permissions', '/v1/team/dashboard']) assert.equal((await as(role, 'GET', p)).status, 200, `${role} ${p}`);
    }
  });

  test('Rechte-Übersicht und WebMe mit Rechten', async () => {
    const res = await as('designer', 'GET', '/v1/team/permissions');
    assert.deepEqual(res.body.roles.map((r: { id: string }) => r.id), [...TEAM_ROLES]);
    assert.deepEqual(Object.fromEntries(res.body.roles.map((r: { id: TeamRole; permissions: string[] }) => [r.id, r.permissions])), EXPECTED);
    assert.deepEqual(res.body.roles.map((r: { label: string }) => r.label), ['Team-Admin', 'Entwickler', 'Moderator', 'Supporter', 'Designer', 'Tester']);
    assert.deepEqual(res.body.permissions.map((p: { id: string }) => p.id), [...PERMISSIONS]);
    assert.deepEqual(res.body.badges, [
      { id: 'partner', label: 'Partner' },
      { id: 'creator', label: 'Creator' },
      { id: 'ambassador', label: 'Botschafter' },
    ]);
    assert.deepEqual(res.body.mine, { role: 'designer', permissions: EXPECTED.designer });
    const me = await webApi(service, 'GET', '/v1/web/me', { cookie: cookies.get('supporter')! });
    assert.deepEqual([me.body.role, me.body.permissions], ['supporter', EXPECTED.supporter]);
  });

  test('Rollen vergeben: neue Werte, ungültige 400, letzter Admin bleibt; 2FA für alle Rollen', async () => {
    const neu = await devPlayer(service.url, 'Neuling');
    let res = await as('admin', 'POST', '/v1/team/members', { uuid: neu.uuid, role: 'developer-team' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.members.find((m: { uuid: string }) => m.uuid === neu.uuid).role, 'developer-team');
    // Liste nach Rang: Admin zuerst, Tester zuletzt
    assert.deepEqual(
      [...new Set(res.body.members.map((m: { role: string }) => m.role))],
      ['admin', 'developer-team', 'moderator', 'supporter', 'designer', 'tester'],
    );
    res = await as('admin', 'PUT', `/v1/team/members/${neu.uuid}`, { role: 'developer' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /admin, developer-team, moderator, supporter, designer, tester/);
    assert.equal((await as('admin', 'PUT', `/v1/team/members/${members.get('admin')!.uuid}`, { role: 'designer' })).status, 409);
    // Neues Mitglied ohne 2FA: kein Zugang, auch nicht für Routen ohne Recht
    const { cookie } = await webLogin(service, neu);
    res = await webApi(service, 'GET', '/v1/team/permissions', { cookie });
    assert.deepEqual([res.status, res.body.code], [403, '2fa_setup_required']);
    // Team-Capes gelten für jede Rolle
    res = await api(service.url, 'PUT', '/v1/me', { token: members.get('tester')!.token, body: { cape: 'matrix_rot' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test('Team-Übersicht: Zahlen nur für Bereiche mit Recht', async () => {
    const tester = (await as('tester', 'GET', '/v1/team/dashboard')).body;
    assert.deepEqual([tester.reports, tester.support, tester.submissions, tester.addonReports, tester.recent], [null, null, null, null, null]);
    assert.equal(typeof tester.online, 'number');
    assert.equal(typeof tester.voice, 'number');
    assert.equal(tester.worlds, null, 'Welt teilen ist hier aus');
    const moderator = (await as('moderator', 'GET', '/v1/team/dashboard')).body;
    assert.deepEqual([typeof moderator.reports, typeof moderator.support, moderator.submissions, typeof moderator.addonReports], ['number', 'number', null, 'number']);
    assert.ok(Array.isArray(moderator.recent));
    const developer = (await as('developer-team', 'GET', '/v1/team/dashboard')).body;
    assert.deepEqual([developer.reports, developer.support, typeof developer.submissions], [null, null, 'number']);
  });

  test('Community-Abzeichen: vergeben, ersetzen, entziehen; Protokoll; Datenauskunft; Spieler-Ansicht', async () => {
    const creator = await devPlayer(service.url, 'Kreativ');
    let res = await as('admin', 'PUT', `/v1/team/badges/${creator.uuid}`, { badge: 'creator' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const entry = res.body.badges.find((b: { uuid: string }) => b.uuid === creator.uuid);
    assert.deepEqual([entry.badge, entry.name, entry.addedBy], ['creator', 'Kreativ', members.get('admin')!.name]);
    assert.equal((await as('admin', 'PUT', `/v1/team/badges/${creator.uuid}`, { badge: 'botschafter' })).status, 400, 'Wert heißt ambassador');
    assert.equal((await as('admin', 'PUT', `/v1/team/badges/${randomUuid()}`, { badge: 'partner' })).status, 404);
    res = await as('admin', 'PUT', `/v1/team/badges/${creator.uuid}`, { badge: 'ambassador' });
    assert.equal(res.body.badges.find((b: { uuid: string }) => b.uuid === creator.uuid).badge, 'ambassador');
    assert.equal((await as('moderator', 'GET', '/v1/team/badges')).status, 200, 'ansehen mit Team-Übersicht');
    assert.equal((await as('moderator', 'DELETE', `/v1/team/badges/${creator.uuid}`)).status, 403);
    assert.equal((await as('admin', 'GET', `/v1/team/players/${creator.uuid}`)).body.communityBadge, 'ambassador');
    const exported = (await api(service.url, 'GET', '/v1/me/export', { token: creator.token })).body;
    assert.equal(exported.communityBadge.badge, 'ambassador');
    assert.equal(exported.profile.badge, 'ambassador');
    res = await as('admin', 'DELETE', `/v1/team/badges/${creator.uuid}`);
    assert.equal(res.body.badges.some((b: { uuid: string }) => b.uuid === creator.uuid), false);
    assert.equal((await as('admin', 'DELETE', `/v1/team/badges/${creator.uuid}`)).status, 200, 'noch einmal: nichts zu tun');
    const actions = (await as('admin', 'GET', '/v1/team/audit?limit=500')).body.entries
      .filter((e: { action: string }) => e.action.startsWith('badge.'))
      .map((e: { action: string; detail: string }) => [e.action, e.detail]);
    assert.deepEqual(actions, [
      ['badge.remove', 'ambassador'],
      ['badge.set', 'creator → ambassador'],
      ['badge.set', 'creator'],
    ]);
  });

  test('Abzeichen: Team-Rolle (öffentlich) vor Community-Abzeichen vor Addon-Entwickler; auch in Freundesliste und Me', async () => {
    const fragt = await devPlayer(service.url, 'Fragt');
    const team = await devPlayer(service.url, 'TeamOffen');
    const leise = await devPlayer(service.url, 'TeamLeise');
    const partner = await devPlayer(service.url, 'Partnerin');
    const entwickler = await devPlayer(service.url, 'AddonMacher');
    withStore(service, (store) => {
      const now = Date.now();
      store.setTeamMember(team.uuid, 'designer', now, null);
      store.setTeamProfile(team.uuid, { public: true });
      store.setCommunityBadge(team.uuid, 'creator', now, null);
      store.setTeamMember(leise.uuid, 'supporter', now, null);
      store.setCommunityBadge(leise.uuid, 'partner', now, null);
      store.setCommunityBadge(partner.uuid, 'partner', now, null);
      store.insertAddonVersion(communityAddon('partner-addon', partner), partner.uuid);
      store.insertAddonVersion(communityAddon('macher-addon', entwickler), entwickler.uuid);
    });
    const clients: WsClient[] = [];
    try {
      for (const player of [team, leise, partner, entwickler]) clients.push((await connect(service.wsUrl, player.token)).client);
      const res = await api(service.url, 'POST', '/v1/players/lookup', { token: fragt.token, body: { uuids: [team.uuid, leise.uuid, partner.uuid, entwickler.uuid] } });
      const badges = Object.fromEntries(Object.entries(res.body.players as Record<string, { badge: unknown }>).map(([uuid, e]) => [uuid, e.badge]));
      assert.deepEqual(badges, { [team.uuid]: 'designer', [leise.uuid]: 'partner', [partner.uuid]: 'partner', [entwickler.uuid]: 'developer' });
      await befriend(service.url, fragt, partner);
      await befriend(service.url, fragt, team);
      const list = (await api(service.url, 'GET', '/v1/friends', { token: fragt.token })).body.friends;
      assert.deepEqual(list.map((f: { name: string; badge: string }) => [f.name, f.badge]), [
        ['Partnerin', 'partner'],
        ['TeamOffen', 'designer'],
      ]);
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: leise.token })).body.badge, 'partner', 'Team-Rolle verborgen, Abzeichen sichtbar');
      assert.equal((await api(service.url, 'GET', `/v1/friends/${team.uuid}/profile`, { token: fragt.token })).body.friend.badge, 'designer');
      // Öffentliche Teamseite: neue Rollen mit Rang sortiert
      withStore(service, (store) => store.setTeamProfile(leise.uuid, { public: true }));
      const roles = (await api(service.url, 'GET', '/v1/public/team')).body.members.map((m: { role: string }) => m.role);
      assert.deepEqual(roles, ['supporter', 'designer']);
    } finally {
      for (const client of clients) await client.close();
    }
  });
});

test('Schema 10 → 11: Rollen bleiben, neue Einstellungen mit Standardwerten, zuletzt online aus der letzten Verbindung', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const anna = 'a'.repeat(32);
    const ben = 'b'.repeat(32);
    const first = new Store(dataDir);
    first.upsertUser(anna, 'Anna', 1000);
    first.upsertUser(ben, 'Ben', 2000);
    first.setTeamMember(anna, 'moderator', 1000, null);
    first.setTeamMember(ben, 'admin', 1000, null);
    first.befriend(anna, ben, 3000);
    first.insertMessage(anna, ben, 'Hallo', 4000, 500);
    first.close();
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec(UNDO_SCHEMA_11);
    old.exec("UPDATE users SET last_seen = 5000 WHERE uuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; PRAGMA user_version = 10;");
    old.close();
    const store = new Store(dataDir);
    try {
      const user = store.getUser(anna)!;
      assert.deepEqual(
        [user.statusText, user.dnd, user.showLastOnline, user.suggestable, user.showSuggestions, user.onlineNotify, user.lastOnline],
        ['', false, true, false, true, 'all', 5000],
      );
      assert.deepEqual([store.getTeamMember(anna)?.role, store.getTeamMember(ben)?.role], ['moderator', 'admin']);
      const [friend] = store.listFriends(anna);
      assert.deepEqual([friend!.favorite, friend!.nickname, friend!.note], [false, '', '']);
      const [message] = store.messagesOf(anna);
      assert.deepEqual([message!.text, message!.replyTo, message!.card], ['Hallo', null, null]);
      assert.equal(store.getCommunityBadge(anna), undefined);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 14);
    // Unbekannte Rolle (z. B. aus einer neueren Version) gilt als Tester
    check.exec(`UPDATE team SET role = 'kaiser' WHERE uuid = '${anna}'`);
    check.close();
    const later = new Store(dataDir);
    try {
      assert.equal(later.getTeamMember(anna)?.role, 'tester');
    } finally {
      later.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('addToTeam mit neuen Rollen (Hilfsfunktion der Tests)', async () => {
  const service = await startService({ dev: true, website: WEBSITE });
  try {
    const player = await devPlayer(service.url, 'Testerin');
    addToTeam(service, player, 'tester');
    const { cookie } = await webLogin(service, player);
    const me = await webApi(service, 'GET', '/v1/web/me', { cookie });
    assert.deepEqual([me.body.role, me.body.permissions], ['tester', ['team.view']]);
  } finally {
    await service.close();
  }
});
