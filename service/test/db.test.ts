// Datenbank: Datenbanken älterer Versionen (Schema 1 bis 7) werden beim Start sauber angehoben.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { DELETED_OWNER, Store } from '../src/db';
import { api, connect, ME_DEFAULTS, startService } from './helpers';

/** Genau das Schema 1, wie es die vorige Version des Dienstes angelegt hat. */
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS users (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  name_verified_at INTEGER NOT NULL,
  cape TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  presence INTEGER NOT NULL DEFAULT 1,
  show_server INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS users_name ON users (name_lower, name_verified_at);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS tokens_uuid ON tokens (uuid, created_at);
CREATE INDEX IF NOT EXISTS tokens_expires ON tokens (expires_at);
CREATE TABLE IF NOT EXISTS friendships (
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  friend TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  since INTEGER NOT NULL,
  PRIMARY KEY (uuid, friend)
) STRICT, WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS requests (
  from_uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  to_uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  PRIMARY KEY (from_uuid, to_uuid)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS requests_to ON requests (to_uuid);
`;

/** Genau die Stufe 2 (Nachrichten, Blockierungen, Meldungen, Sperren), wie sie Version 1.0.0 angelegt hat. */
const MIGRATION_V2 = `
ALTER TABLE users ADD COLUMN messages INTEGER NOT NULL DEFAULT 1;
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv TEXT NOT NULL,
  from_uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  to_uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX messages_conv ON messages (conv, id);
CREATE INDEX messages_unread ON messages (to_uuid, is_read, from_uuid);
CREATE INDEX messages_at ON messages (at);
CREATE TABLE blocks (
  blocker TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  blocked TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  PRIMARY KEY (blocker, blocked)
) STRICT, WITHOUT ROWID;
CREATE INDEX blocks_blocked ON blocks (blocked);
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reported TEXT NOT NULL,
  reported_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  messages TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX reports_reporter ON reports (reporter, at);
CREATE INDEX reports_at ON reports (at);
CREATE TABLE bans (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`;

/** Genau die Stufe 3 (Web-Anmeldung, Team, Neuigkeiten, Protokoll), wie sie Version 1.1.0 angelegt hat. */
const MIGRATION_V3 = `
ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE reports ADD COLUMN done_at INTEGER;
ALTER TABLE reports ADD COLUMN done_by TEXT;
CREATE INDEX reports_status ON reports (status, id);
CREATE INDEX reports_reported ON reports (reported);
ALTER TABLE bans ADD COLUMN by_name TEXT;
CREATE TABLE web_codes (
  hash TEXT PRIMARY KEY,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX web_codes_uuid ON web_codes (uuid);
CREATE INDEX web_codes_expires ON web_codes (expires_at);
CREATE TABLE web_sessions (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  device TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;
CREATE INDEX web_sessions_uuid ON web_sessions (uuid, created_at);
CREATE INDEX web_sessions_expires ON web_sessions (expires_at);
CREATE TABLE team (
  uuid TEXT PRIMARY KEY REFERENCES users (uuid) ON DELETE CASCADE,
  role TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  added_by TEXT,
  totp_secret TEXT,
  totp_pending TEXT,
  totp_last_step INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;
CREATE TABLE news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  author_uuid TEXT,
  author_name TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX news_published ON news (published, published_at);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_uuid TEXT,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
) STRICT;
CREATE INDEX audit_at ON audit (at);
`;

/** Genau die Stufe 4 (Teamprofile, Support, Versionsverlauf), wie sie Version 1.2.0 und 1.3.0 angelegt haben. */
const MIGRATION_V4 = `
ALTER TABLE team ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE team ADD COLUMN about TEXT NOT NULL DEFAULT '';
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  player_read_id INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX tickets_uuid ON tickets (uuid, updated_at);
CREATE INDEX tickets_status ON tickets (status, updated_at);
CREATE TABLE ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  from_team INTEGER NOT NULL,
  author_uuid TEXT,
  author_name TEXT NOT NULL,
  text TEXT NOT NULL
) STRICT;
CREATE INDEX ticket_messages_ticket ON ticket_messages (ticket, id);
CREATE INDEX ticket_messages_author ON ticket_messages (author_uuid, at);
CREATE TABLE launcher_versions (
  version TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  notes TEXT NOT NULL,
  published_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX launcher_versions_published ON launcher_versions (published_at);
`;

/** Genau die Stufe 5 (Addon-Store), wie sie Version 1.4.0 angelegt hat. */
const MIGRATION_V5 = `
CREATE TABLE addons (
  id TEXT PRIMARY KEY,
  hidden INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE TABLE addon_versions (
  id TEXT NOT NULL REFERENCES addons (id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  signature TEXT NOT NULL,
  file TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  published_by TEXT,
  PRIMARY KEY (id, version)
) STRICT, WITHOUT ROWID;
`;

/** Genau die Stufe 6 (Addons von Spielern, Bewertungen, Meldungen zu Addons, Anhänge), wie sie Version 1.5.x angelegt hat. */
const MIGRATION_V6 = `
ALTER TABLE addons ADD COLUMN owner TEXT;
ALTER TABLE addons ADD COLUMN screenshots TEXT NOT NULL DEFAULT '[]';
CREATE INDEX addons_owner ON addons (owner);
CREATE TABLE addon_submissions (
  id TEXT PRIMARY KEY,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  status TEXT NOT NULL,
  addon_id TEXT,
  version TEXT,
  name TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'sonstiges',
  icon TEXT NOT NULL DEFAULT 'addons',
  platforms TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  authors TEXT NOT NULL DEFAULT '[]',
  api INTEGER,
  size INTEGER,
  sha256 TEXT,
  inspection TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  manifest TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  review_note TEXT,
  reviewer TEXT,
  reviewer_uuid TEXT
) STRICT, WITHOUT ROWID;
CREATE INDEX addon_submissions_uuid ON addon_submissions (uuid, created_at);
CREATE INDEX addon_submissions_status ON addon_submissions (status, submitted_at);
CREATE INDEX addon_submissions_addon ON addon_submissions (addon_id, status);
CREATE TABLE addon_ratings (
  addon TEXT NOT NULL REFERENCES addons (id) ON DELETE CASCADE,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  stars INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (addon, uuid)
) STRICT, WITHOUT ROWID;
CREATE INDEX addon_ratings_uuid ON addon_ratings (uuid);
CREATE TABLE addon_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  addon TEXT NOT NULL,
  reporter TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  done_at INTEGER,
  done_by TEXT
) STRICT;
CREATE INDEX addon_reports_status ON addon_reports (status, id);
CREATE INDEX addon_reports_reporter ON addon_reports (reporter, addon, status);
CREATE INDEX addon_reports_at ON addon_reports (at);
CREATE TABLE ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX ticket_attachments_ticket ON ticket_attachments (ticket, id);
CREATE INDEX ticket_attachments_uuid ON ticket_attachments (uuid, at);
`;

/** Genau die Stufe 7 (Cosmetics-Katalog, Auswahl je Slot), wie sie Version 1.6.0 angelegt hat. */
const MIGRATION_V7 = `
CREATE TABLE cosmetics (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL,
  version INTEGER NOT NULL,
  access TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER NOT NULL,
  published_by TEXT,
  signature TEXT NOT NULL,
  manifest TEXT NOT NULL
) STRICT;

ALTER TABLE users ADD COLUMN cosmetic_head TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN cosmetic_back TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN cosmetic_aura TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN cosmetic_companion TEXT NOT NULL DEFAULT '';
CREATE INDEX users_cosmetic_head ON users (cosmetic_head) WHERE cosmetic_head <> '';
CREATE INDEX users_cosmetic_back ON users (cosmetic_back) WHERE cosmetic_back <> '';
CREATE INDEX users_cosmetic_aura ON users (cosmetic_aura) WHERE cosmetic_aura <> '';
CREATE INDEX users_cosmetic_companion ON users (cosmetic_companion) WHERE cosmetic_companion <> '';
CREATE INDEX users_cape ON users (cape) WHERE cape <> '';
`;

const ANNA = 'a'.repeat(32);
const BEN = 'b'.repeat(32);

test('Schema 1 → aktuell: Daten bleiben, neue Einstellung „messages“ ist an, neue Tabellen sind da', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec('PRAGMA journal_mode = WAL;');
    old.exec(SCHEMA_V1);
    const now = Date.now();
    const user = old.prepare(
      'INSERT INTO users (uuid, name, name_lower, name_verified_at, cape, visible, presence, show_server, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    user.run(ANNA, 'Anna', 'anna', now, 'glut', 0, 1, 0, now, now);
    user.run(BEN, 'Ben', 'ben', now, '', 1, 1, 1, now, now);
    old.prepare('INSERT INTO friendships (uuid, friend, since) VALUES (?, ?, ?), (?, ?, ?)').run(ANNA, BEN, now, BEN, ANNA, now);
    old.exec('PRAGMA user_version = 1');
    old.close();

    const store = new Store(dataDir);
    try {
      const anna = store.getUser(ANNA)!;
      assert.deepEqual(
        { cape: anna.cape, visible: anna.visible, presence: anna.presence, showServer: anna.showServer, messages: anna.messages },
        { cape: 'glut', visible: false, presence: true, showServer: false, messages: true },
      );
      assert.equal(store.friendsSince(ANNA, BEN), now);
      const sent = store.insertMessage(ANNA, BEN, 'Hallo', now, 500);
      assert.equal(sent.text, 'Hallo');
      assert.deepEqual(store.unreadCounts(BEN), { [ANNA]: 1 });
      assert.equal(store.block(ANNA, BEN, now), true);
      assert.deepEqual(store.listBans(), []);
      assert.deepEqual(store.listReports(), []);
    } finally {
      store.close();
    }

    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 13);
    check.close();

    // Ein zweiter Start ändert nichts mehr; der Dienst läuft auf der angehobenen Datenbank.
    new Store(dataDir).close();
    const service = await startService({ dev: true, dataDir });
    try {
      const login = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Anna', uuid: ANNA } });
      const me = await api(service.url, 'GET', '/v1/me', { token: login.body.token });
      assert.deepEqual(me.body, { uuid: ANNA, name: 'Anna', cape: 'glut', visible: false, presence: true, showServer: false, messages: true, ...ME_DEFAULTS });
      const { client, friends } = await connect(service.wsUrl, login.body.token);
      assert.deepEqual(friends.unread, {});
      await client.close();
    } finally {
      await service.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Schema 2 → 3 (Version 1.0.0 auf dem Server): Meldungen bekommen einen Status, Sperren bleiben, Web und Team sind da', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec('PRAGMA journal_mode = WAL;');
    old.exec(SCHEMA_V1);
    old.exec(MIGRATION_V2);
    const now = Date.now();
    const user = old.prepare(
      'INSERT INTO users (uuid, name, name_lower, name_verified_at, cape, created_at, last_seen, messages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    user.run(ANNA, 'Anna', 'anna', now, 'neon', now - 1000, now, 0);
    user.run(BEN, 'Ben', 'ben', now, '', now, now, 1);
    old
      .prepare('INSERT INTO reports (reporter, reporter_name, reported, reported_name, reason, note, messages, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ANNA, 'Anna', BEN, 'Ben', 'spam', 'alt', '[]', now);
    old.prepare('INSERT INTO bans (uuid, name, reason, at) VALUES (?, ?, ?, ?)').run('c'.repeat(32), 'Carla', 'Spam', now);
    old.prepare('INSERT INTO messages (conv, from_uuid, to_uuid, text, at) VALUES (?, ?, ?, ?, ?)').run(ANNA + BEN, ANNA, BEN, 'Hallo', now);
    old.exec('PRAGMA user_version = 2');
    old.close();

    const store = new Store(dataDir);
    try {
      const anna = store.getUser(ANNA)!;
      assert.deepEqual([anna.cape, anna.messages, anna.createdAt], ['neon', false, now - 1000]);
      const [report] = store.listReports();
      assert.deepEqual([report!.status, report!.doneAt, report!.doneBy, report!.note], ['open', null, null, 'alt']);
      assert.equal(store.markReportDone(report!.id, now, 'Chefin'), true);
      assert.deepEqual(store.listBans().map((b) => [b.name, b.reason, b.by]), [['Carla', 'Spam', null]]);
      assert.equal(store.messagesOf(BEN).length, 1);
      // Neue Tabellen sind benutzbar.
      assert.equal(store.setTeamMember(ANNA, 'admin', now, null), 'added');
      assert.equal(store.countAdmins(), 1);
      store.insertWebSession({ id: 'sitzung', uuid: ANNA, device: 'Firefox · Windows', createdAt: now, lastUsedAt: now, expiresAt: now + 1000, verifiedAt: 0 }, 'h'.repeat(64), 10);
      assert.equal(store.findWebSession('h'.repeat(64), now, now - 1000)?.id, 'sitzung');
      assert.equal(store.insertNews('Titel', 'Text', { uuid: ANNA, name: 'Anna' }, true, now).author, 'Anna');
      store.insertAudit({ at: now, actorUuid: null, actorName: 'CLI', action: 'team.add', target: 'Anna', detail: 'admin' });
      assert.equal(store.listAudit(5).length, 1);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 13);
    check.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Schema 3 → 4 (Version 1.1.0 auf dem Server): Team behält 2FA, Teamprofil ist privat, Support und Versionsverlauf sind da', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec('PRAGMA journal_mode = WAL;');
    old.exec(SCHEMA_V1);
    old.exec(MIGRATION_V2);
    old.exec(MIGRATION_V3);
    const now = Date.now();
    old
      .prepare('INSERT INTO users (uuid, name, name_lower, name_verified_at, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ANNA, 'Anna', 'anna', now, now, now);
    old.prepare("INSERT INTO team (uuid, role, added_at, added_by, totp_secret, totp_last_step) VALUES (?, 'admin', ?, NULL, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 7)").run(ANNA, now);
    old
      .prepare('INSERT INTO web_sessions (id, hash, uuid, device, created_at, last_used_at, expires_at, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('sitzung', 'h'.repeat(64), ANNA, 'Firefox · Windows', now, now, now + 100_000, now);
    old
      .prepare('INSERT INTO news (title, text, author_uuid, author_name, published, created_at, published_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
      .run('Alt', 'Text', ANNA, 'Anna', now, now, now);
    old.exec('PRAGMA user_version = 3');
    old.close();

    const store = new Store(dataDir);
    try {
      const member = store.getTeamMember(ANNA)!;
      assert.deepEqual(
        [member.role, member.totpSecret, member.totpLastStep, member.public, member.title, member.about],
        ['admin', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 7, false, '', ''],
      );
      assert.deepEqual(store.listPublicTeam(), [], 'niemand ist ohne Zustimmung öffentlich');
      assert.equal(store.findWebSession('h'.repeat(64), now, now - 1000)?.verifiedAt, now);
      assert.equal(store.listPublishedNews(5)[0]!.title, 'Alt');
      store.setTeamProfile(ANNA, { public: true, title: 'Entwicklung' });
      assert.equal(store.listPublicTeam()[0]!.title, 'Entwicklung');
      const ticket = store.insertTicket(ANNA, 'Anna', 'hilfe', 'Frage', 'Hallo', now);
      assert.equal(store.getTicket(ticket)!.status, 'open');
      assert.equal(store.recordVersion('1.0.0', '2026-11-25', ['Neu'], now), true);
      assert.equal(store.recordVersion('1.0.0', '2026-11-25', ['Neu'], now), false, 'nur einmal');
      assert.deepEqual(store.listVersions(5), [{ version: '1.0.0', date: '2026-11-25', notes: ['Neu'], publishedAt: now }]);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 13);
    check.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Schema 4 → 5 (Version 1.3.0 auf dem Server): alle Daten bleiben, der Addon-Store ist leer und benutzbar', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec('PRAGMA journal_mode = WAL;');
    old.exec(SCHEMA_V1);
    old.exec(MIGRATION_V2);
    old.exec(MIGRATION_V3);
    old.exec(MIGRATION_V4);
    const now = Date.now();
    const user = old.prepare('INSERT INTO users (uuid, name, name_lower, name_verified_at, cape, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)');
    user.run(ANNA, 'Anna', 'anna', now, 'aurora', now, now);
    user.run(BEN, 'Ben', 'ben', now, '', now, now);
    old.prepare('INSERT INTO friendships (uuid, friend, since) VALUES (?, ?, ?), (?, ?, ?)').run(ANNA, BEN, now, BEN, ANNA, now);
    old.prepare("INSERT INTO team (uuid, role, added_at, totp_secret, public, title) VALUES (?, 'admin', ?, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1, 'Chefin')").run(ANNA, now);
    old.prepare("INSERT INTO tickets (uuid, category, subject, status, created_at, updated_at) VALUES (?, 'hilfe', 'Frage', 'open', ?, ?)").run(BEN, now, now);
    old.prepare('INSERT INTO launcher_versions (version, date, notes, published_at) VALUES (?, ?, ?, ?)').run('1.3.0', '2026-11-25', '["Support"]', now);
    old.prepare("INSERT INTO audit (at, actor_uuid, actor_name, action, target) VALUES (?, NULL, 'CLI', 'team.add', 'Anna')").run(now);
    old.exec('PRAGMA user_version = 4');
    old.close();

    const store = new Store(dataDir);
    try {
      assert.equal(store.getUser(ANNA)!.cape, 'aurora');
      assert.equal(store.friendsSince(BEN, ANNA), now);
      const member = store.getTeamMember(ANNA)!;
      assert.deepEqual([member.role, member.totpSecret, member.public, member.title], ['admin', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', true, 'Chefin']);
      assert.equal(store.ticketsOf(BEN)[0]!.subject, 'Frage');
      assert.deepEqual(store.listVersions(5), [{ version: '1.3.0', date: '2026-11-25', notes: ['Support'], publishedAt: now }]);
      assert.equal(store.listAudit(5).length, 1);
      // Addon-Store: leer, dann benutzbar (neues Addon sichtbar, letzte Version löschen entfernt das Addon).
      assert.deepEqual([store.listAddons(), store.countVisibleAddons()], [[], 0]);
      const row = {
        id: 'uhrzeit',
        version: '1.0.0',
        manifest: '{}',
        signature: 'c2ln',
        file: 'heldix-addon-uhrzeit-1.0.0.jar',
        size: 3,
        sha256: '0'.repeat(64),
        publishedAt: now,
        publishedBy: 'Anna',
      };
      store.insertAddonVersion(row);
      assert.deepEqual(store.listAddons(), [{ id: 'uhrzeit', hidden: false, downloads: 0, createdAt: now, owner: null, screenshots: [] }]);
      assert.deepEqual(store.addonVersionByFile(row.file), row);
      store.countAddonDownload('uhrzeit');
      assert.equal(store.getAddon('uhrzeit')!.downloads, 1);
      assert.equal(store.setAddonHidden('uhrzeit', true), true);
      assert.equal(store.setAddonHidden('uhrzeit', true), false, 'keine Änderung');
      assert.equal(store.countVisibleAddons(), 0);
      assert.equal(store.deleteAddonVersion('uhrzeit', '1.0.0'), true);
      assert.deepEqual(store.listAddons(), []);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 13);
    check.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Schema 5 → 6 (Version 1.4.0 auf dem Server): Addons, Versionen und Zähler bleiben (offiziell, ohne Besitzer), Einreichungen, Bewertungen und Meldungen sind da', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec('PRAGMA journal_mode = WAL;');
    old.exec(SCHEMA_V1);
    old.exec(MIGRATION_V2);
    old.exec(MIGRATION_V3);
    old.exec(MIGRATION_V4);
    old.exec(MIGRATION_V5);
    const now = Date.now();
    const user = old.prepare('INSERT INTO users (uuid, name, name_lower, name_verified_at, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)');
    user.run(ANNA, 'Anna', 'anna', now, now, now);
    user.run(BEN, 'Ben', 'ben', now, now, now);
    old.prepare("INSERT INTO team (uuid, role, added_at, totp_secret) VALUES (?, 'admin', ?, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')").run(ANNA, now);
    // Ein Addon wie aus 1.4.0: Manifest ohne „official“ und „author“, versteckt, mit Downloads
    const manifest = JSON.stringify({
      type: 'heldix-addon',
      id: 'uhrzeit',
      name: 'Uhrzeit',
      version: '1.0.0',
      summary: 'Zeigt die Uhrzeit.',
      description: '',
      authors: ['HeldixClient'],
      api: 2,
      icon: 'clock',
      category: 'hud',
      platforms: [],
      file: 'heldix-addon-uhrzeit-1.0.0.jar',
      size: 3,
      sha256: '0'.repeat(64),
      date: '2026-11-25',
      notes: [],
    });
    old.prepare('INSERT INTO addons (id, hidden, downloads, created_at) VALUES (?, 0, 42, ?)').run('uhrzeit', now);
    old.prepare('INSERT INTO addons (id, hidden, downloads, created_at) VALUES (?, 1, 7, ?)').run('versteckt', now);
    const version = old.prepare(
      'INSERT INTO addon_versions (id, version, manifest, signature, file, size, sha256, published_at, published_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    version.run('uhrzeit', '1.0.0', manifest, 'c2ln', 'heldix-addon-uhrzeit-1.0.0.jar', 3, '0'.repeat(64), now, 'Anna');
    version.run('versteckt', '2.0.0', manifest.replace(/uhrzeit/g, 'versteckt').replace('1.0.0', '2.0.0'), 'c2ln', 'heldix-addon-versteckt-2.0.0.jar', 3, '0'.repeat(64), now, null);
    old.exec('PRAGMA user_version = 5');
    old.close();

    const store = new Store(dataDir);
    try {
      assert.deepEqual(
        store.listAddons().map((a) => [a.id, a.hidden, a.downloads, a.createdAt, a.owner, a.screenshots]),
        [
          ['uhrzeit', false, 42, now, null, []],
          ['versteckt', true, 7, now, null, []],
        ],
      );
      assert.deepEqual(store.addonVersionsOf('uhrzeit').map((v) => [v.version, v.manifest, v.publishedBy]), [['1.0.0', manifest, 'Anna']]);
      assert.equal(store.getTeamMember(ANNA)!.role, 'admin');
      // Neue Tabellen sind benutzbar.
      const sub = store.insertSubmission('s'.repeat(16), BEN, { name: 'X', summary: '', description: '', category: 'hud', icon: 'addons', platforms: [], notes: [] }, now);
      assert.deepEqual([sub.status, sub.submitterName, sub.screenshots, sub.inspection], ['draft', 'Ben', [], null]);
      store.saveSubmission({ ...sub, status: 'pending', addonId: 'neu', inspection: { classes: 2, uses: ['netzwerk'], expected: [] }, submittedAt: now });
      assert.deepEqual(store.getSubmission(sub.id)!.inspection, { classes: 2, uses: ['netzwerk'], expected: [] });
      assert.equal(store.countPendingSubmissions(), 1);
      store.setAddonRating('uhrzeit', BEN, 4, now);
      assert.deepEqual(store.addonRatingSummary('uhrzeit'), { average: 4, count: 1 });
      store.insertAddonReport({ addon: 'uhrzeit', reporter: BEN, reporterName: 'Ben', reason: 'broken', note: '', at: now });
      assert.equal(store.countOpenAddonReports(), 1);
      store.setAddonScreenshots('uhrzeit', [{ file: 'uhrzeit-0123456789abcdef.png', type: 'png', width: 1280, height: 720, size: 10 }]);
      assert.equal(store.getAddon('uhrzeit')!.screenshots.length, 1);
      const ticket = store.insertTicket(BEN, 'Ben', 'fehler', 'Absturz', 'Hilfe', now);
      store.addTicketAttachment(ticket, BEN, 'crash.txt', 7, Buffer.from([0x1f, 0x8b]), now);
      assert.deepEqual(store.ticketAttachments(ticket).map((a) => [a.name, a.size]), [['crash.txt', 7]]);
      // Konto löschen: Einreichungen, Bewertungen, Meldungen und Anhänge weg
      store.deleteUser(BEN);
      assert.deepEqual([store.countPendingSubmissions(), store.addonRatingSummary('uhrzeit').count, store.countOpenAddonReports()], [0, 0, 0]);
      assert.deepEqual(store.ticketAttachments(ticket), []);
      assert.equal(DELETED_OWNER, 'geloescht');
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 13);
    check.close();

    // Der Dienst zeigt das alte Addon weiter, als offiziell gewertet ist es nicht (ohne „official“ gilt false).
    const service = await startService({ dataDir });
    try {
      const list = await api(service.url, 'GET', '/v1/addons');
      assert.deepEqual(list.body.addons.map((a: { id: string; downloads: number; official: boolean; author: unknown }) => [a.id, a.downloads, a.official, a.author]), [
        ['uhrzeit', 42, false, null],
      ]);
      assert.equal(list.body.addons[0].manifest, manifest);
    } finally {
      await service.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Schema 6 → 7 (Version 1.5.x auf dem Server): Spieler, Capes und Addons bleiben, Cosmetics sind leer und benutzbar', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec('PRAGMA journal_mode = WAL;');
    old.exec(SCHEMA_V1);
    old.exec(MIGRATION_V2);
    old.exec(MIGRATION_V3);
    old.exec(MIGRATION_V4);
    old.exec(MIGRATION_V5);
    old.exec(MIGRATION_V6);
    const now = Date.now();
    const user = old.prepare(
      'INSERT INTO users (uuid, name, name_lower, name_verified_at, cape, visible, presence, show_server, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    user.run(ANNA, 'Anna', 'anna', now, 'glut', 1, 1, 1, now, now);
    user.run(BEN, 'Ben', 'ben', now, '', 0, 1, 1, now, now);
    old.prepare("INSERT INTO team (uuid, role, added_at, totp_secret) VALUES (?, 'admin', ?, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')").run(ANNA, now);
    old.prepare("INSERT INTO addons (id, hidden, downloads, created_at, owner) VALUES ('uhrzeit', 0, 9, ?, ?)").run(now, BEN);
    old.exec('PRAGMA user_version = 6');
    old.close();

    const store = new Store(dataDir);
    try {
      const anna = store.getUser(ANNA)!;
      assert.deepEqual([anna.cape, anna.visible, anna.worn], ['glut', true, { head: '', back: '', aura: '', companion: '' }]);
      assert.deepEqual(store.getUser(BEN)!.worn, { head: '', back: '', aura: '', companion: '' });
      assert.equal(store.getTeamMember(ANNA)!.role, 'admin');
      assert.deepEqual(store.listAddons().map((a) => [a.id, a.downloads, a.owner]), [['uhrzeit', 9, BEN]]);
      // Neue Tabelle und Spalten sind benutzbar: veröffentlichen, wählen, zählen, ausblenden, löschen setzt zurück
      assert.deepEqual(store.cosmeticInfos(), []);
      assert.equal(store.countVisibleCosmetics(), 0);
      const row = {
        id: 'krone',
        slot: 'head',
        version: 1,
        access: 'all',
        name: 'Krone',
        description: '',
        date: '2026-11-26',
        size: 10,
        sha256: '0'.repeat(64),
        createdAt: now,
        publishedAt: now,
        publishedBy: 'Anna',
        signature: 'c2ln',
        manifest: '{}',
      };
      store.upsertCosmetic(row);
      store.setWorn(BEN, 'head', 'krone');
      store.setWorn(ANNA, 'cape', 'sternenregen');
      assert.equal(store.getUser(BEN)!.worn.head, 'krone');
      assert.equal(store.getUser(ANNA)!.cape, 'sternenregen');
      assert.equal(store.cosmeticWearers().get('head:krone'), 1);
      assert.equal(store.setCosmeticHidden('krone', true), true);
      assert.equal(store.setCosmeticHidden('krone', true), false);
      assert.equal(store.countVisibleCosmetics(), 0);
      // Neue Version: hidden und createdAt bleiben
      store.upsertCosmetic({ ...row, version: 2, createdAt: now + 1000, publishedAt: now + 1000 });
      assert.deepEqual(
        [store.getCosmetic('krone')!.version, store.getCosmetic('krone')!.hidden, store.getCosmetic('krone')!.createdAt],
        [2, true, now],
      );
      assert.deepEqual([...store.teamMembersIn([ANNA, BEN])], [ANNA]);
      assert.equal(store.deleteCosmetic('krone'), 1);
      assert.equal(store.getUser(BEN)!.worn.head, '');
      assert.equal(store.deleteCosmetic('krone'), null);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 13);
    check.close();

    // Der Dienst läuft darauf: Katalog leer, das eingebaute Cape bleibt
    const service = await startService({ dev: true, dataDir });
    try {
      assert.deepEqual((await api(service.url, 'GET', '/v1/cosmetics')).body, { cosmetics: [] });
      const login = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Ben', uuid: BEN } });
      assert.deepEqual((await api(service.url, 'GET', '/v1/me/cosmetics', { token: login.body.token })).body, {
        head: null,
        back: null,
        aura: null,
        companion: null,
        cape: null,
        team: false,
        unlocked: [],
      });
    } finally {
      await service.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Schema 7 → 8 (Version 1.6.0 auf dem Server): Einreichungen mit JAR gelten als API-Addon, Zugriff und Versionen sind speicherbar', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const old = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    old.exec('PRAGMA journal_mode = WAL;');
    for (const step of [SCHEMA_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4, MIGRATION_V5, MIGRATION_V6, MIGRATION_V7]) old.exec(step);
    const now = Date.now();
    old.prepare('INSERT INTO users (uuid, name, name_lower, name_verified_at, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(BEN, 'Ben', 'ben', now, now, now);
    const insert = old.prepare(
      "INSERT INTO addon_submissions (id, uuid, status, addon_id, version, inspection, manifest, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // Mit JAR (eingereicht, Manifest ohne die neuen Felder) und ein Entwurf ohne JAR
    insert.run('m'.repeat(16), BEN, 'pending', 'wetter', '1.0.0', JSON.stringify({ classes: 2, uses: ['minecraft'] }), '{"type":"heldix-addon"}', now, now);
    insert.run('e'.repeat(16), BEN, 'draft', null, null, null, null, now, now);
    old.exec('PRAGMA user_version = 7');
    old.close();

    const store = new Store(dataDir);
    try {
      const withJar = store.getSubmission('m'.repeat(16))!;
      assert.deepEqual([withJar.access, withJar.minecraft, withJar.loaders, withJar.manifest], ['api', [], ['heldix', 'fabric'], '{"type":"heldix-addon"}']);
      assert.deepEqual(withJar.inspection, { classes: 2, uses: ['minecraft'], expected: [] }, 'ältere Prüfung ohne „expected“');
      const empty = store.getSubmission('e'.repeat(16))!;
      assert.deepEqual([empty.access, empty.minecraft, empty.loaders], [null, [], []]);
      store.saveSubmission({
        ...empty,
        addonId: 'sicht',
        access: 'minecraft',
        minecraft: ['26.2', '26.3'],
        loaders: ['heldix'],
        inspection: { classes: 1, uses: ['minecraft'], expected: ['minecraft'] },
      });
      const saved = store.getSubmission('e'.repeat(16))!;
      assert.deepEqual([saved.access, saved.minecraft, saved.loaders, saved.inspection], ['minecraft', ['26.2', '26.3'], ['heldix'], { classes: 1, uses: ['minecraft'], expected: ['minecraft'] }]);
      // Cosmetics aus Stufe 7 bleiben benutzbar
      assert.deepEqual(store.cosmeticInfos(), []);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 13);
    check.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Datenbank einer neueren Version: Start bricht mit klarer Meldung ab', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-migration-'));
  try {
    const db = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    db.exec('PRAGMA user_version = 99');
    db.close();
    assert.throws(() => new Store(dataDir), /neueren Version des Dienstes \(Schema 99\)/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
