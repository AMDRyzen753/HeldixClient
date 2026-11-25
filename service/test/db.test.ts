// Datenbank: Datenbanken älterer Versionen (Schema 1, 2 und 3) werden beim Start sauber angehoben.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Store } from '../src/db';
import { api, connect, startService } from './helpers';

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
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 4);
    check.close();

    // Ein zweiter Start ändert nichts mehr; der Dienst läuft auf der angehobenen Datenbank.
    new Store(dataDir).close();
    const service = await startService({ dev: true, dataDir });
    try {
      const login = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Anna', uuid: ANNA } });
      const me = await api(service.url, 'GET', '/v1/me', { token: login.body.token });
      assert.deepEqual(me.body, { uuid: ANNA, name: 'Anna', cape: 'glut', visible: false, presence: true, showServer: false, messages: true });
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
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 4);
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
    assert.equal(Number((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 4);
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
