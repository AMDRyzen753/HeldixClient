// Speicher des Dienstes: SQLite über node:sqlite (ohne native Pakete).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface UserRow {
  uuid: string;
  name: string;
  cape: string;
  visible: boolean;
  presence: boolean;
  showServer: boolean;
  lastSeen: number;
}

export interface RequestRow {
  uuid: string;
  name: string;
  at: number;
}

export interface FriendshipRow {
  user: UserRow;
  since: number;
}

export interface SettingsPatch {
  cape?: string;
  visible?: boolean;
  presence?: boolean;
  showServer?: boolean;
}

type Row = Record<string, unknown>;

const SCHEMA_VERSION = 1;

const SCHEMA = `
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

const USER_COLUMNS = 'u.uuid, u.name, u.cape, u.visible, u.presence, u.show_server, u.last_seen';

function toUser(row: Row): UserRow {
  return {
    uuid: String(row.uuid),
    name: String(row.name),
    cape: String(row.cape),
    visible: Number(row.visible) === 1,
    presence: Number(row.presence) === 1,
    showServer: Number(row.show_server) === 1,
    lastSeen: Number(row.last_seen),
  };
}

function toRequest(row: Row): RequestRow {
  return { uuid: String(row.uuid), name: String(row.name), at: Number(row.at) };
}

function prepareStatements(db: DatabaseSync) {
  return {
    upsertUser: db.prepare(`
      INSERT INTO users (uuid, name, name_lower, name_verified_at, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (uuid) DO UPDATE SET
        name = excluded.name,
        name_lower = excluded.name_lower,
        name_verified_at = excluded.name_verified_at,
        last_seen = excluded.last_seen`),
    getUser: db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.uuid = ?`),
    // Ein Name kann bei Mojang den Besitzer wechseln: Es zählt, wer ihn zuletzt bei der Anmeldung hatte.
    findByName: db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.name_lower = ? ORDER BY u.name_verified_at DESC LIMIT 1`),
    usersIn: db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.uuid IN (SELECT value FROM json_each(?))`),
    touch: db.prepare('UPDATE users SET last_seen = ? WHERE uuid = ?'),
    updateSettings: db.prepare(`
      UPDATE users SET
        cape = coalesce(?, cape),
        visible = coalesce(?, visible),
        presence = coalesce(?, presence),
        show_server = coalesce(?, show_server)
      WHERE uuid = ?`),

    insertToken: db.prepare('INSERT INTO tokens (hash, uuid, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    findToken: db.prepare('SELECT uuid FROM tokens WHERE hash = ? AND expires_at > ?'),
    trimTokens: db.prepare(`
      DELETE FROM tokens WHERE uuid = ? AND hash NOT IN (
        SELECT hash FROM tokens WHERE uuid = ? ORDER BY created_at DESC LIMIT ?)`),
    deleteExpiredTokens: db.prepare('DELETE FROM tokens WHERE expires_at <= ?'),

    listFriends: db.prepare(`
      SELECT ${USER_COLUMNS}, f.since FROM friendships f JOIN users u ON u.uuid = f.friend
      WHERE f.uuid = ? ORDER BY u.name_lower`),
    listFriendIds: db.prepare('SELECT friend, since FROM friendships WHERE uuid = ?'),
    friendsSince: db.prepare('SELECT since FROM friendships WHERE uuid = ? AND friend = ?'),
    countFriends: db.prepare('SELECT count(*) AS n FROM friendships WHERE uuid = ?'),
    addFriendship: db.prepare('INSERT OR IGNORE INTO friendships (uuid, friend, since) VALUES (?, ?, ?)'),
    removeFriendship: db.prepare('DELETE FROM friendships WHERE (uuid = ? AND friend = ?) OR (uuid = ? AND friend = ?)'),

    listIncoming: db.prepare(`
      SELECT u.uuid, u.name, r.at FROM requests r JOIN users u ON u.uuid = r.from_uuid
      WHERE r.to_uuid = ? ORDER BY r.at DESC, u.name_lower`),
    listOutgoing: db.prepare(`
      SELECT u.uuid, u.name, r.at FROM requests r JOIN users u ON u.uuid = r.to_uuid
      WHERE r.from_uuid = ? ORDER BY r.at DESC, u.name_lower`),
    hasRequest: db.prepare('SELECT 1 AS x FROM requests WHERE from_uuid = ? AND to_uuid = ?'),
    countOutgoing: db.prepare('SELECT count(*) AS n FROM requests WHERE from_uuid = ?'),
    addRequest: db.prepare('INSERT OR IGNORE INTO requests (from_uuid, to_uuid, at) VALUES (?, ?, ?)'),
    removeRequest: db.prepare('DELETE FROM requests WHERE from_uuid = ? AND to_uuid = ?'),

    // Konto löschen
    relatedUsers: db.prepare(`
      SELECT friend AS other FROM friendships WHERE uuid = ?
      UNION SELECT to_uuid FROM requests WHERE from_uuid = ?
      UNION SELECT from_uuid FROM requests WHERE to_uuid = ?`),
    deleteTokensOf: db.prepare('DELETE FROM tokens WHERE uuid = ?'),
    deleteFriendshipsOf: db.prepare('DELETE FROM friendships WHERE uuid = ? OR friend = ?'),
    deleteRequestsOf: db.prepare('DELETE FROM requests WHERE from_uuid = ? OR to_uuid = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE uuid = ?'),
  };
}

type Statements = ReturnType<typeof prepareStatements>;

/** Alle Datenbankzugriffe des Dienstes. Jede Methode ist synchron (DatabaseSync). */
export class Store {
  private readonly db: DatabaseSync;
  private readonly sql: Statements;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    // secure_delete: Gelöschte Daten werden in der Datei mit Nullen überschrieben (Konto löschen).
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;',
    );
    this.migrate();
    this.sql = prepareStatements(this.db);
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as Row | undefined;
    const version = Number(row?.user_version ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new Error(`Die Datenbank stammt von einer neueren Version des Dienstes (Schema ${version}).`);
    }
    if (version < SCHEMA_VERSION) {
      this.transaction(() => {
        this.db.exec(SCHEMA);
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  }

  /** Führt `fn` in einer Transaktion aus (alles oder nichts). */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  // ---------- Spieler ----------

  /** Legt den Spieler an oder aktualisiert Namen und letzte Verbindung (Einstellungen bleiben). */
  upsertUser(uuid: string, name: string, now: number): UserRow {
    this.sql.upsertUser.run(uuid, name, name.toLowerCase(), now, now, now);
    return this.getUser(uuid)!;
  }

  getUser(uuid: string): UserRow | undefined {
    const row = this.sql.getUser.get(uuid) as Row | undefined;
    return row ? toUser(row) : undefined;
  }

  findUserByName(name: string): UserRow | undefined {
    const row = this.sql.findByName.get(name.toLowerCase()) as Row | undefined;
    return row ? toUser(row) : undefined;
  }

  getUsers(uuids: string[]): UserRow[] {
    if (uuids.length === 0) return [];
    return (this.sql.usersIn.all(JSON.stringify(uuids)) as Row[]).map(toUser);
  }

  touch(uuid: string, now: number): void {
    this.sql.touch.run(now, uuid);
  }

  updateSettings(uuid: string, patch: SettingsPatch): void {
    const bool = (v: boolean | undefined) => (v === undefined ? null : v ? 1 : 0);
    this.sql.updateSettings.run(
      patch.cape ?? null,
      bool(patch.visible),
      bool(patch.presence),
      bool(patch.showServer),
      uuid,
    );
  }

  /**
   * Löscht den Spieler mit allen Tokens, Freundschaften und Anfragen (in beide Richtungen).
   * Liefert die UUIDs der Spieler, deren Freundesliste oder Anfragen sich dadurch ändern.
   */
  deleteUser(uuid: string): string[] {
    const related = this.transaction(() => {
      const others = (this.sql.relatedUsers.all(uuid, uuid, uuid) as Row[]).map((row) => String(row.other));
      this.sql.deleteTokensOf.run(uuid);
      this.sql.deleteFriendshipsOf.run(uuid, uuid);
      this.sql.deleteRequestsOf.run(uuid, uuid);
      this.sql.deleteUser.run(uuid);
      return others;
    });
    // Alte Seiten aus dem WAL in die Datenbank übernehmen und das WAL leeren,
    // damit keine Kopie der gelöschten Daten im WAL liegen bleibt.
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return related.filter((other) => other !== uuid);
  }

  // ---------- Tokens (nur SHA-256-Hashes) ----------

  /** Speichert einen Token-Hash und behält höchstens `keep` Tokens pro Spieler. */
  insertToken(hash: string, uuid: string, now: number, expiresAt: number, keep: number): void {
    this.transaction(() => {
      this.sql.insertToken.run(hash, uuid, now, expiresAt);
      this.sql.trimTokens.run(uuid, uuid, keep);
    });
  }

  findTokenOwner(hash: string, now: number): string | undefined {
    const row = this.sql.findToken.get(hash, now) as Row | undefined;
    return row ? String(row.uuid) : undefined;
  }

  deleteExpiredTokens(now: number): void {
    this.sql.deleteExpiredTokens.run(now);
  }

  // ---------- Freunde ----------

  listFriends(uuid: string): FriendshipRow[] {
    return (this.sql.listFriends.all(uuid) as Row[]).map((row) => ({ user: toUser(row), since: Number(row.since) }));
  }

  listFriendIds(uuid: string): { uuid: string; since: number }[] {
    return (this.sql.listFriendIds.all(uuid) as Row[]).map((row) => ({ uuid: String(row.friend), since: Number(row.since) }));
  }

  friendsSince(a: string, b: string): number | undefined {
    const row = this.sql.friendsSince.get(a, b) as Row | undefined;
    return row ? Number(row.since) : undefined;
  }

  countFriends(uuid: string): number {
    return Number((this.sql.countFriends.get(uuid) as Row).n);
  }

  /** Macht a und b zu Freunden und entfernt offene Anfragen zwischen beiden. */
  befriend(a: string, b: string, now: number): void {
    this.transaction(() => {
      this.sql.removeRequest.run(a, b);
      this.sql.removeRequest.run(b, a);
      this.sql.addFriendship.run(a, b, now);
      this.sql.addFriendship.run(b, a, now);
    });
  }

  /** Beendet die Freundschaft. Liefert true, wenn es eine gab. */
  removeFriendship(a: string, b: string): boolean {
    return Number(this.sql.removeFriendship.run(a, b, b, a).changes) > 0;
  }

  // ---------- Anfragen ----------

  listIncoming(uuid: string): RequestRow[] {
    return (this.sql.listIncoming.all(uuid) as Row[]).map(toRequest);
  }

  listOutgoing(uuid: string): RequestRow[] {
    return (this.sql.listOutgoing.all(uuid) as Row[]).map(toRequest);
  }

  hasRequest(from: string, to: string): boolean {
    return this.sql.hasRequest.get(from, to) !== undefined;
  }

  countOutgoing(uuid: string): number {
    return Number((this.sql.countOutgoing.get(uuid) as Row).n);
  }

  addRequest(from: string, to: string, now: number): void {
    this.sql.addRequest.run(from, to, now);
  }

  /** Entfernt die Anfrage von `from` an `to`. Liefert true, wenn es eine gab. */
  removeRequest(from: string, to: string): boolean {
    return Number(this.sql.removeRequest.run(from, to).changes) > 0;
  }
}
