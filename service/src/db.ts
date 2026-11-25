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
  messages: boolean;
  createdAt: number;
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
  messages?: boolean;
}

export interface MessageRow {
  id: number;
  from: string;
  to: string;
  text: string;
  at: number;
  /** Vom Empfänger gelesen. */
  read: boolean;
}

export interface ConversationRow {
  uuid: string;
  name: string;
  last: MessageRow;
  /** Ungelesene Nachrichten des Freundes an den Abrufenden. */
  unread: number;
}

export interface BlockRow {
  uuid: string;
  name: string;
  at: number;
}

export interface ReportRow {
  id: number;
  reporter: string;
  reporterName: string;
  reported: string;
  reportedName: string;
  reason: string;
  note: string;
  /** JSON-Liste der letzten Nachrichten zwischen beiden (Beleg für die Prüfung). */
  messages: string;
  at: number;
  status: ReportStatus;
  doneAt: number | null;
  /** Name des Team-Mitglieds; null = über die Server-Konsole (heldix-dienst-admin) */
  doneBy: string | null;
}

export type ReportStatus = 'open' | 'done';

export interface NewReport {
  reporter: string;
  reporterName: string;
  reported: string;
  reportedName: string;
  reason: string;
  note: string;
  messages: string;
  at: number;
}

export interface BanRow {
  uuid: string;
  name: string;
  reason: string;
  at: number;
  /** Name des Team-Mitglieds; null = über die Server-Konsole */
  by: string | null;
}

export interface WebSessionRow {
  id: string;
  uuid: string;
  device: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  /** Zeitpunkt, zu dem in dieser Sitzung zuletzt ein 2FA-Code eingegeben wurde (0 = nie) */
  verifiedAt: number;
}

export type TeamRole = 'moderator' | 'admin';

export interface TeamMemberRow {
  uuid: string;
  name: string;
  role: TeamRole;
  addedAt: number;
  addedBy: string | null;
  totpSecret: string | null;
  totpPending: string | null;
  totpLastStep: number;
  /** Teamprofil: auf der öffentlichen Teamseite (nur mit eigener Zustimmung), Aufgabe, kurzer Text */
  public: boolean;
  title: string;
  about: string;
}

export interface TeamProfilePatch {
  public?: boolean;
  title?: string;
  about?: string;
}

export type TicketStatus = 'open' | 'answered' | 'closed';

export interface TicketRow {
  id: number;
  uuid: string;
  /** aktueller Name des Spielers */
  name: string;
  category: string;
  subject: string;
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  /** höchste Nachrichten-ID, die der Spieler gesehen hat */
  playerReadId: number;
  /** ID der letzten Team-Nachricht (0 = keine) */
  lastTeamId: number;
  /** Die letzte Nachricht ist vom Team */
  lastFromTeam: boolean;
}

export interface TicketMessageRow {
  id: number;
  at: number;
  fromTeam: boolean;
  authorUuid: string | null;
  authorName: string;
  text: string;
}

export interface LauncherVersionRow {
  version: string;
  date: string;
  notes: string[];
  publishedAt: number;
}

export interface NewsRow {
  id: number;
  title: string;
  text: string;
  authorUuid: string | null;
  author: string;
  published: boolean;
  createdAt: number;
  publishedAt: number | null;
  updatedAt: number;
}

export interface AuditRow {
  id: number;
  at: number;
  actorUuid: string | null;
  actorName: string;
  action: string;
  target: string | null;
  detail: string | null;
}

export type NewAudit = Omit<AuditRow, 'id'>;

type Row = Record<string, unknown>;

/**
 * Schema-Versionen. Jede Stufe hebt eine Datenbank um genau eine Version an; eine neue Datenbank
 * durchläuft alle Stufen. Bestehende Stufen nie ändern, nur neue anhängen.
 */
const MIGRATIONS: readonly string[] = [
  // 1: Spieler, Tokens, Freundschaften, Anfragen
  `
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
`,
  // 2: Nachrichten, Blockierungen, Meldungen, Sperren
  `
ALTER TABLE users ADD COLUMN messages INTEGER NOT NULL DEFAULT 1;

-- conv: beide UUIDs sortiert hintereinander (ein Schlüssel pro Unterhaltung)
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

-- Ohne Fremdschlüssel: Meldungen über einen Spieler bleiben bis zum Ablauf, auch wenn er sein Konto löscht.
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

-- Ohne Fremdschlüssel: Eine Sperre bleibt, auch wenn das Konto gelöscht ist.
CREATE TABLE bans (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
`,
  // 3: Web-Anmeldung, Team (mit 2FA), Neuigkeiten, Protokoll; Meldungen mit Status statt Löschen
  `
ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE reports ADD COLUMN done_at INTEGER;
ALTER TABLE reports ADD COLUMN done_by TEXT;
CREATE INDEX reports_status ON reports (status, id);
CREATE INDEX reports_reported ON reports (reported);
ALTER TABLE bans ADD COLUMN by_name TEXT;

-- Einmal-Codes aus POST /v1/web/link (nur der Hash)
CREATE TABLE web_codes (
  hash TEXT PRIMARY KEY,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX web_codes_uuid ON web_codes (uuid);
CREATE INDEX web_codes_expires ON web_codes (expires_at);

-- Web-Sitzungen (Cookie); gespeichert wird nur der Hash des Cookie-Werts
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

-- Ohne Fremdschlüssel: Neuigkeiten bleiben mit dem Namen des Autors, auch wenn er sein Konto löscht.
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

-- Protokoll der Team-Aktionen (actor_uuid NULL = Server-Konsole)
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
`,
  // 4: Teamprofile (öffentliche Teamseite), Support-Anfragen, Versionsverlauf des Launchers
  `
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

-- author_uuid: Spieler oder Team-Mitglied (NULL, wenn das Mitglied sein Konto gelöscht hat)
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
`,
];

const SCHEMA_VERSION = MIGRATIONS.length;

const USER_COLUMNS = 'u.uuid, u.name, u.cape, u.visible, u.presence, u.show_server, u.messages, u.created_at, u.last_seen';
const MESSAGE_COLUMNS = 'm.id, m.from_uuid, m.to_uuid, m.text, m.at, m.is_read';
const REPORT_COLUMNS = 'id, reporter, reporter_name, reported, reported_name, reason, note, messages, at, status, done_at, done_by';
const BAN_COLUMNS = 'uuid, name, reason, at, by_name';
const SESSION_COLUMNS = 'id, uuid, device, created_at, last_used_at, expires_at, verified_at';
const TEAM_COLUMNS = 't.uuid, u.name, t.role, t.added_at, t.added_by, t.totp_secret, t.totp_pending, t.totp_last_step, t.public, t.title, t.about';
const TICKET_COLUMNS = `t.id, t.uuid, u.name, t.category, t.subject, t.status, t.created_at, t.updated_at, t.closed_at, t.player_read_id,
  (SELECT coalesce(max(m.id), 0) FROM ticket_messages m WHERE m.ticket = t.id AND m.from_team = 1) AS last_team_id,
  (SELECT m.from_team FROM ticket_messages m WHERE m.ticket = t.id ORDER BY m.id DESC LIMIT 1) AS last_from_team`;
const NEWS_COLUMNS = 'id, title, text, author_uuid, author_name, published, created_at, published_at, updated_at';
/** Größer als jede vergebene Nachrichten-ID (für „von der neuesten an“). */
const NEWEST = Number.MAX_SAFE_INTEGER;

/** Muster für LIKE: Namensanfang ohne Groß-/Kleinschreibung, `_`, `%` und `\` maskiert (ESCAPE '\'). */
function likePrefix(prefix: string): string {
  return `${prefix.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Schlüssel der Unterhaltung zwischen a und b (unabhängig von der Reihenfolge). */
export function conversationKey(a: string, b: string): string {
  return a < b ? a + b : b + a;
}

function toUser(row: Row): UserRow {
  return {
    uuid: String(row.uuid),
    name: String(row.name),
    cape: String(row.cape),
    visible: Number(row.visible) === 1,
    presence: Number(row.presence) === 1,
    showServer: Number(row.show_server) === 1,
    messages: Number(row.messages) === 1,
    createdAt: Number(row.created_at),
    lastSeen: Number(row.last_seen),
  };
}

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const nullableString = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toSession(row: Row): WebSessionRow {
  return {
    id: String(row.id),
    uuid: String(row.uuid),
    device: String(row.device),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
    expiresAt: Number(row.expires_at),
    verifiedAt: Number(row.verified_at),
  };
}

function toTeamMember(row: Row): TeamMemberRow {
  return {
    uuid: String(row.uuid),
    name: String(row.name),
    role: row.role === 'admin' ? 'admin' : 'moderator',
    addedAt: Number(row.added_at),
    addedBy: nullableString(row.added_by),
    totpSecret: nullableString(row.totp_secret),
    totpPending: nullableString(row.totp_pending),
    totpLastStep: Number(row.totp_last_step),
    public: Number(row.public) === 1,
    title: String(row.title ?? ''),
    about: String(row.about ?? ''),
  };
}

function toTicket(row: Row): TicketRow {
  const status = String(row.status);
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    category: String(row.category),
    subject: String(row.subject),
    status: status === 'answered' || status === 'closed' ? status : 'open',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    closedAt: nullableNumber(row.closed_at),
    playerReadId: Number(row.player_read_id),
    lastTeamId: Number(row.last_team_id ?? 0),
    lastFromTeam: Number(row.last_from_team) === 1,
  };
}

function toTicketMessage(row: Row): TicketMessageRow {
  return {
    id: Number(row.id),
    at: Number(row.at),
    fromTeam: Number(row.from_team) === 1,
    authorUuid: nullableString(row.author_uuid),
    authorName: String(row.author_name),
    text: String(row.text),
  };
}

function toVersion(row: Row): LauncherVersionRow {
  let notes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.notes));
    if (Array.isArray(parsed)) notes = parsed.filter((n): n is string => typeof n === 'string');
  } catch {
    notes = [];
  }
  return { version: String(row.version), date: String(row.date), notes, publishedAt: Number(row.published_at) };
}

function toNews(row: Row): NewsRow {
  return {
    id: Number(row.id),
    title: String(row.title),
    text: String(row.text),
    authorUuid: nullableString(row.author_uuid),
    author: String(row.author_name),
    published: Number(row.published) === 1,
    createdAt: Number(row.created_at),
    publishedAt: nullableNumber(row.published_at),
    updatedAt: Number(row.updated_at),
  };
}

function toAudit(row: Row): AuditRow {
  return {
    id: Number(row.id),
    at: Number(row.at),
    actorUuid: nullableString(row.actor_uuid),
    actorName: String(row.actor_name),
    action: String(row.action),
    target: nullableString(row.target),
    detail: nullableString(row.detail),
  };
}

function toRequest(row: Row): RequestRow {
  return { uuid: String(row.uuid), name: String(row.name), at: Number(row.at) };
}

function toMessage(row: Row): MessageRow {
  return {
    id: Number(row.id),
    from: String(row.from_uuid),
    to: String(row.to_uuid),
    text: String(row.text),
    at: Number(row.at),
    read: Number(row.is_read) === 1,
  };
}

function toReport(row: Row): ReportRow {
  return {
    id: Number(row.id),
    reporter: String(row.reporter),
    reporterName: String(row.reporter_name),
    reported: String(row.reported),
    reportedName: String(row.reported_name),
    reason: String(row.reason),
    note: String(row.note),
    messages: String(row.messages),
    at: Number(row.at),
    status: row.status === 'done' ? 'done' : 'open',
    doneAt: nullableNumber(row.done_at),
    doneBy: nullableString(row.done_by),
  };
}

function toBan(row: Row): BanRow {
  return { uuid: String(row.uuid), name: String(row.name), reason: String(row.reason), at: Number(row.at), by: nullableString(row.by_name) };
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
    // Suche im Team-Bereich: Namensanfang (LIKE mit Escape für _ und %) bzw. zuletzt gesehen
    searchUsers: db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.name_lower LIKE ? ESCAPE '\\' ORDER BY u.last_seen DESC LIMIT ?`),
    recentUsers: db.prepare(`SELECT ${USER_COLUMNS} FROM users u ORDER BY u.last_seen DESC LIMIT ?`),
    resetCape: db.prepare("UPDATE users SET cape = '' WHERE uuid = ?"),
    touch: db.prepare('UPDATE users SET last_seen = ? WHERE uuid = ?'),
    updateSettings: db.prepare(`
      UPDATE users SET
        cape = coalesce(?, cape),
        visible = coalesce(?, visible),
        presence = coalesce(?, presence),
        show_server = coalesce(?, show_server),
        messages = coalesce(?, messages)
      WHERE uuid = ?`),

    insertToken: db.prepare('INSERT INTO tokens (hash, uuid, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    findToken: db.prepare('SELECT uuid FROM tokens WHERE hash = ? AND expires_at > ?'),
    trimTokens: db.prepare(`
      DELETE FROM tokens WHERE uuid = ? AND hash NOT IN (
        SELECT hash FROM tokens WHERE uuid = ? ORDER BY created_at DESC LIMIT ?)`),
    deleteExpiredTokens: db.prepare('DELETE FROM tokens WHERE expires_at <= ?'),
    tokensOf: db.prepare('SELECT created_at, expires_at FROM tokens WHERE uuid = ? ORDER BY created_at'),

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

    // Nachrichten
    insertMessage: db.prepare('INSERT INTO messages (conv, from_uuid, to_uuid, text, at) VALUES (?, ?, ?, ?, ?)'),
    getMessage: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.id = ?`),
    // Alles ab der (keep+1)-neuesten Nachricht löschen
    trimConversation: db.prepare(`
      DELETE FROM messages WHERE conv = ? AND id <= (
        SELECT id FROM messages WHERE conv = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`),
    conversationPage: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.conv = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`),
    listConversations: db.prepare(`
      SELECT u.uuid AS friend, u.name AS friend_name, ${MESSAGE_COLUMNS},
        (SELECT count(*) FROM messages x WHERE x.to_uuid = f.uuid AND x.is_read = 0 AND x.from_uuid = f.friend) AS unread
      FROM friendships f
      JOIN users u ON u.uuid = f.friend
      JOIN messages m ON m.id = (
        SELECT max(id) FROM messages
        WHERE conv = CASE WHEN f.uuid < f.friend THEN f.uuid || f.friend ELSE f.friend || f.uuid END)
      WHERE f.uuid = ?
      ORDER BY m.at DESC, m.id DESC`),
    unreadCounts: db.prepare(`
      SELECT m.from_uuid AS friend, count(*) AS n FROM messages m
      JOIN friendships f ON f.uuid = m.to_uuid AND f.friend = m.from_uuid
      WHERE m.to_uuid = ? AND m.is_read = 0
      GROUP BY m.from_uuid`),
    markRead: db.prepare('UPDATE messages SET is_read = 1 WHERE from_uuid = ? AND to_uuid = ? AND is_read = 0'),
    deleteConversation: db.prepare('DELETE FROM messages WHERE conv = ?'),
    deleteOldMessages: db.prepare('DELETE FROM messages WHERE at < ?'),
    messagesOf: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.from_uuid = ? OR m.to_uuid = ? ORDER BY m.id`),

    // Blockierungen
    listBlocks: db.prepare(`
      SELECT u.uuid, u.name, b.at FROM blocks b JOIN users u ON u.uuid = b.blocked
      WHERE b.blocker = ? ORDER BY b.at DESC, u.name_lower`),
    isBlocked: db.prepare('SELECT 1 AS x FROM blocks WHERE blocker = ? AND blocked = ?'),
    countBlocks: db.prepare('SELECT count(*) AS n FROM blocks WHERE blocker = ?'),
    addBlock: db.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked, at) VALUES (?, ?, ?)'),
    removeBlock: db.prepare('DELETE FROM blocks WHERE blocker = ? AND blocked = ?'),

    // Meldungen
    insertReport: db.prepare(`
      INSERT INTO reports (reporter, reporter_name, reported, reported_name, reason, note, messages, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    reportsSince: db.prepare('SELECT count(*) AS n, min(at) AS oldest FROM reports WHERE reporter = ? AND at > ?'),
    pairReportSince: db.prepare('SELECT max(at) AS last FROM reports WHERE reporter = ? AND reported = ? AND at > ?'),
    listReports: db.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE status IN (SELECT value FROM json_each(?)) ORDER BY id`),
    getReport: db.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE id = ?`),
    reportsBy: db.prepare(`SELECT ${REPORT_COLUMNS} FROM reports WHERE reporter = ? ORDER BY id DESC`),
    reportIdsAbout: db.prepare('SELECT id FROM reports WHERE reported = ? ORDER BY id DESC'),
    reportIdsBy: db.prepare('SELECT id FROM reports WHERE reporter = ? ORDER BY id DESC'),
    markReportDone: db.prepare("UPDATE reports SET status = 'done', done_at = ?, done_by = ? WHERE id = ? AND status = 'open'"),
    deleteOldReports: db.prepare('DELETE FROM reports WHERE at < ?'),

    // Sperren
    getBan: db.prepare(`SELECT ${BAN_COLUMNS} FROM bans WHERE uuid = ?`),
    findBanByName: db.prepare(`SELECT ${BAN_COLUMNS} FROM bans WHERE lower(name) = ? ORDER BY at DESC LIMIT 1`),
    listBans: db.prepare(`SELECT ${BAN_COLUMNS} FROM bans ORDER BY at DESC`),
    addBan: db.prepare(`
      INSERT INTO bans (uuid, name, reason, at, by_name) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (uuid) DO UPDATE SET name = excluded.name, reason = excluded.reason`),
    removeBan: db.prepare('DELETE FROM bans WHERE uuid = ?'),
    searchBans: db.prepare(`SELECT ${BAN_COLUMNS} FROM bans WHERE lower(name) LIKE ? ESCAPE '\\' ORDER BY at DESC LIMIT ?`),

    // Web-Anmeldung
    insertWebCode: db.prepare('INSERT INTO web_codes (hash, uuid, expires_at) VALUES (?, ?, ?)'),
    findWebCode: db.prepare('SELECT uuid FROM web_codes WHERE hash = ? AND expires_at > ?'),
    deleteWebCode: db.prepare('DELETE FROM web_codes WHERE hash = ?'),
    deleteExpiredWebCodes: db.prepare('DELETE FROM web_codes WHERE expires_at <= ?'),
    insertWebSession: db.prepare(`
      INSERT INTO web_sessions (id, hash, uuid, device, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    trimWebSessions: db.prepare(`
      DELETE FROM web_sessions WHERE uuid = ? AND id NOT IN (
        SELECT id FROM web_sessions WHERE uuid = ? ORDER BY created_at DESC LIMIT ?)`),
    findWebSession: db.prepare(`SELECT ${SESSION_COLUMNS} FROM web_sessions WHERE hash = ? AND expires_at > ? AND last_used_at > ?`),
    touchWebSession: db.prepare('UPDATE web_sessions SET last_used_at = ? WHERE id = ?'),
    verifyWebSession: db.prepare('UPDATE web_sessions SET verified_at = ? WHERE id = ?'),
    unverifyWebSessionsOf: db.prepare('UPDATE web_sessions SET verified_at = 0 WHERE uuid = ?'),
    listWebSessions: db.prepare(`
      SELECT ${SESSION_COLUMNS} FROM web_sessions WHERE uuid = ? AND expires_at > ? AND last_used_at > ? ORDER BY last_used_at DESC`),
    deleteWebSession: db.prepare('DELETE FROM web_sessions WHERE uuid = ? AND id = ?'),
    deleteExpiredWebSessions: db.prepare('DELETE FROM web_sessions WHERE expires_at <= ? OR last_used_at <= ?'),

    // Team
    getTeamMember: db.prepare(`SELECT ${TEAM_COLUMNS} FROM team t JOIN users u ON u.uuid = t.uuid WHERE t.uuid = ?`),
    listTeam: db.prepare(`SELECT ${TEAM_COLUMNS} FROM team t JOIN users u ON u.uuid = t.uuid ORDER BY t.role, u.name_lower`),
    addTeamMember: db.prepare('INSERT INTO team (uuid, role, added_at, added_by) VALUES (?, ?, ?, ?)'),
    setTeamRole: db.prepare('UPDATE team SET role = ? WHERE uuid = ?'),
    removeTeamMember: db.prepare('DELETE FROM team WHERE uuid = ?'),
    countAdmins: db.prepare("SELECT count(*) AS n FROM team WHERE role = 'admin'"),
    setTotpPending: db.prepare('UPDATE team SET totp_pending = ? WHERE uuid = ?'),
    enableTotp: db.prepare('UPDATE team SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ? WHERE uuid = ? AND totp_pending IS NOT NULL'),
    setTotpLastStep: db.prepare('UPDATE team SET totp_last_step = ? WHERE uuid = ? AND totp_last_step < ?'),
    resetTotp: db.prepare('UPDATE team SET totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE uuid = ?'),
    setTeamProfile: db.prepare('UPDATE team SET public = coalesce(?, public), title = coalesce(?, title), about = coalesce(?, about) WHERE uuid = ?'),
    listPublicTeam: db.prepare(`
      SELECT ${TEAM_COLUMNS} FROM team t JOIN users u ON u.uuid = t.uuid WHERE t.public = 1
      ORDER BY CASE t.role WHEN 'admin' THEN 0 ELSE 1 END, u.name_lower`),
    isPublicTeamMember: db.prepare('SELECT 1 AS x FROM team WHERE uuid = ? AND public = 1'),
    publicTeamUuids: db.prepare('SELECT uuid FROM team WHERE public = 1'),

    // Support
    insertTicket: db.prepare(`
      INSERT INTO tickets (uuid, category, subject, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)`),
    insertTicketMessage: db.prepare(`
      INSERT INTO ticket_messages (ticket, at, from_team, author_uuid, author_name, text) VALUES (?, ?, ?, ?, ?, ?)`),
    getTicket: db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets t JOIN users u ON u.uuid = t.uuid WHERE t.id = ?`),
    ticketsOf: db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets t JOIN users u ON u.uuid = t.uuid WHERE t.uuid = ? ORDER BY t.updated_at DESC, t.id DESC`),
    ticketsIn: db.prepare(`
      SELECT ${TICKET_COLUMNS} FROM tickets t JOIN users u ON u.uuid = t.uuid
      WHERE t.status IN (SELECT value FROM json_each(?)) ORDER BY t.updated_at DESC, t.id DESC`),
    ticketMessages: db.prepare('SELECT id, at, from_team, author_uuid, author_name, text FROM ticket_messages WHERE ticket = ? ORDER BY id'),
    setTicketStatus: db.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?'),
    closeTicket: db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ? AND status <> 'closed'"),
    markTicketRead: db.prepare('UPDATE tickets SET player_read_id = (SELECT coalesce(max(id), 0) FROM ticket_messages WHERE ticket = ?) WHERE id = ?'),
    countOpenTickets: db.prepare("SELECT count(*) AS n FROM tickets WHERE uuid = ? AND status <> 'closed'"),
    ticketsSince: db.prepare('SELECT count(*) AS n, min(created_at) AS oldest FROM tickets WHERE uuid = ? AND created_at > ?'),
    playerMessagesSince: db.prepare('SELECT count(*) AS n, min(at) AS oldest FROM ticket_messages WHERE author_uuid = ? AND from_team = 0 AND at > ?'),
    deleteOldTickets: db.prepare(`
      DELETE FROM tickets WHERE (status = 'closed' AND closed_at < ?) OR (status <> 'closed' AND updated_at < ?)`),
    deleteTicketsOf: db.prepare('DELETE FROM tickets WHERE uuid = ?'),
    forgetTicketAuthor: db.prepare('UPDATE ticket_messages SET author_uuid = NULL WHERE author_uuid = ? AND from_team = 1'),

    // Versionsverlauf des Launchers
    recordVersion: db.prepare('INSERT OR IGNORE INTO launcher_versions (version, date, notes, published_at) VALUES (?, ?, ?, ?)'),
    listVersions: db.prepare('SELECT version, date, notes, published_at FROM launcher_versions ORDER BY published_at DESC, version DESC LIMIT ?'),

    // Status
    countUsers: db.prepare('SELECT count(*) AS n FROM users'),

    // Neuigkeiten
    insertNews: db.prepare(`
      INSERT INTO news (title, text, author_uuid, author_name, published, created_at, published_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    getNews: db.prepare(`SELECT ${NEWS_COLUMNS} FROM news WHERE id = ?`),
    updateNews: db.prepare(`
      UPDATE news SET title = ?, text = ?, published = ?, published_at = ?, updated_at = ? WHERE id = ?`),
    deleteNews: db.prepare('DELETE FROM news WHERE id = ?'),
    listNews: db.prepare(`SELECT ${NEWS_COLUMNS} FROM news ORDER BY coalesce(published_at, created_at) DESC, id DESC`),
    listPublishedNews: db.prepare(`SELECT ${NEWS_COLUMNS} FROM news WHERE published = 1 ORDER BY published_at DESC, id DESC LIMIT ?`),
    // Archiv: älter als eine Neuigkeit (gleiche Reihenfolge wie oben: Veröffentlichung, dann ID)
    listPublishedNewsBefore: db.prepare(`
      SELECT ${NEWS_COLUMNS} FROM news WHERE published = 1 AND (published_at < ? OR (published_at = ? AND id < ?))
      ORDER BY published_at DESC, id DESC LIMIT ?`),
    listPublishedNewsBeforeId: db.prepare(`SELECT ${NEWS_COLUMNS} FROM news WHERE published = 1 AND id < ? ORDER BY published_at DESC, id DESC LIMIT ?`),
    newsBy: db.prepare(`SELECT ${NEWS_COLUMNS} FROM news WHERE author_uuid = ? ORDER BY id`),
    forgetNewsAuthor: db.prepare('UPDATE news SET author_uuid = NULL WHERE author_uuid = ?'),

    // Protokoll
    insertAudit: db.prepare('INSERT INTO audit (at, actor_uuid, actor_name, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)'),
    listAudit: db.prepare('SELECT id, at, actor_uuid, actor_name, action, target, detail FROM audit ORDER BY id DESC LIMIT ?'),
    auditBy: db.prepare('SELECT id, at, actor_uuid, actor_name, action, target, detail FROM audit WHERE actor_uuid = ? ORDER BY id'),
    deleteOldAudit: db.prepare('DELETE FROM audit WHERE at < ?'),

    // Konto löschen
    relatedUsers: db.prepare(`
      SELECT friend AS other FROM friendships WHERE uuid = ?
      UNION SELECT to_uuid FROM requests WHERE from_uuid = ?
      UNION SELECT from_uuid FROM requests WHERE to_uuid = ?`),
    deleteTokensOf: db.prepare('DELETE FROM tokens WHERE uuid = ?'),
    deleteFriendshipsOf: db.prepare('DELETE FROM friendships WHERE uuid = ? OR friend = ?'),
    deleteRequestsOf: db.prepare('DELETE FROM requests WHERE from_uuid = ? OR to_uuid = ?'),
    deleteMessagesOf: db.prepare('DELETE FROM messages WHERE from_uuid = ? OR to_uuid = ?'),
    deleteBlocksOf: db.prepare('DELETE FROM blocks WHERE blocker = ? OR blocked = ?'),
    deleteWebCodesOf: db.prepare('DELETE FROM web_codes WHERE uuid = ?'),
    deleteWebSessionsOf: db.prepare('DELETE FROM web_sessions WHERE uuid = ?'),
    deleteReportsBy: db.prepare('DELETE FROM reports WHERE reporter = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE uuid = ?'),
  };
}

type Statements = ReturnType<typeof prepareStatements>;

/** Alle Datenbankzugriffe des Dienstes. Jede Methode ist synchron (DatabaseSync). */
export class Store {
  private readonly db: DatabaseSync;
  private readonly sql: Statements;
  private transactionDepth = 0;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'heldix-dienst.db'));
    // secure_delete: Gelöschte Daten werden in der Datei mit Nullen überschrieben (Konto löschen).
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;',
    );
    try {
      this.migrate();
    } catch (err) {
      this.db.close();
      throw err;
    }
    this.sql = prepareStatements(this.db);
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as Row | undefined;
    const version = Number(row?.user_version ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new Error(`Die Datenbank stammt von einer neueren Version des Dienstes (Schema ${version}).`);
    }
    if (version < SCHEMA_VERSION) {
      // Alle fehlenden Stufen in einer Transaktion: Schlägt eine fehl, bleibt die Datenbank, wie sie war.
      this.transaction(() => {
        for (let next = version; next < SCHEMA_VERSION; next++) this.db.exec(MIGRATIONS[next]!);
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  }

  /** Führt `fn` in einer Transaktion aus (alles oder nichts). Innerhalb einer Transaktion läuft `fn` einfach mit. */
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.transactionDepth--;
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /** Alte Seiten aus dem WAL in die Datenbank übernehmen und das WAL leeren (keine Kopie gelöschter Daten im WAL). */
  private checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
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
      bool(patch.messages),
      uuid,
    );
  }

  /** Spieler, deren Name mit `prefix` beginnt (ohne Groß-/Kleinschreibung), zuletzt gesehen zuerst. */
  searchUsers(prefix: string, limit: number): UserRow[] {
    return (this.sql.searchUsers.all(likePrefix(prefix), limit) as Row[]).map(toUser);
  }

  recentUsers(limit: number): UserRow[] {
    return (this.sql.recentUsers.all(limit) as Row[]).map(toUser);
  }

  resetCape(uuid: string): boolean {
    return Number(this.sql.resetCape.run(uuid).changes) > 0;
  }

  /**
   * Löscht den Spieler mit allen Tokens, Web-Sitzungen, Freundschaften, Anfragen, Nachrichten und Blockierungen
   * (in beide Richtungen), der Team-Mitgliedschaft und den Meldungen, die er gemacht hat.
   * Meldungen über ihn, das Protokoll und eine Sperre bleiben; seine Neuigkeiten behalten nur den Namen.
   * Liefert die UUIDs der Spieler, deren Freundesliste oder Anfragen sich dadurch ändern.
   */
  deleteUser(uuid: string): string[] {
    const related = this.transaction(() => {
      this.sql.deleteReportsBy.run(uuid);
      return this.wipeUser(uuid);
    });
    this.checkpoint();
    return related;
  }

  /** Gemeinsamer Teil von Konto löschen und Sperren. Muss in einer Transaktion laufen. */
  private wipeUser(uuid: string): string[] {
    const others = (this.sql.relatedUsers.all(uuid, uuid, uuid) as Row[]).map((row) => String(row.other));
    this.sql.deleteTokensOf.run(uuid);
    this.sql.deleteFriendshipsOf.run(uuid, uuid);
    this.sql.deleteRequestsOf.run(uuid, uuid);
    this.sql.deleteMessagesOf.run(uuid, uuid);
    this.sql.deleteBlocksOf.run(uuid, uuid);
    this.sql.deleteWebCodesOf.run(uuid);
    this.sql.deleteWebSessionsOf.run(uuid);
    this.sql.removeTeamMember.run(uuid);
    this.sql.forgetNewsAuthor.run(uuid);
    this.sql.deleteTicketsOf.run(uuid);
    this.sql.forgetTicketAuthor.run(uuid);
    this.sql.deleteUser.run(uuid);
    return others.filter((other) => other !== uuid);
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

  tokensOf(uuid: string): { createdAt: number; expiresAt: number }[] {
    return (this.sql.tokensOf.all(uuid) as Row[]).map((row) => ({ createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) }));
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

  /** Beendet die Freundschaft und löscht die Unterhaltung. Liefert true, wenn es eine Freundschaft gab. */
  removeFriendship(a: string, b: string): boolean {
    return this.transaction(() => {
      const removed = Number(this.sql.removeFriendship.run(a, b, b, a).changes) > 0;
      this.sql.deleteConversation.run(conversationKey(a, b));
      return removed;
    });
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

  // ---------- Nachrichten ----------

  /** Speichert eine Nachricht und behält höchstens `keep` Nachrichten pro Unterhaltung (die neuesten). */
  insertMessage(from: string, to: string, text: string, now: number, keep: number): MessageRow {
    return this.transaction(() => {
      const conv = conversationKey(from, to);
      const id = Number(this.sql.insertMessage.run(conv, from, to, text, now).lastInsertRowid);
      this.sql.trimConversation.run(conv, conv, keep);
      return toMessage(this.sql.getMessage.get(id) as Row);
    });
  }

  /**
   * Die neuesten `limit` Nachrichten zwischen a und b mit einer ID unter `before` (ohne: ab der neuesten),
   * neueste zuerst. `more`: Es gibt noch ältere.
   */
  conversationPage(a: string, b: string, before: number | undefined, limit: number): { messages: MessageRow[]; more: boolean } {
    const rows = (this.sql.conversationPage.all(conversationKey(a, b), before ?? NEWEST, limit + 1) as Row[]).map(toMessage);
    const more = rows.length > limit;
    return { messages: more ? rows.slice(0, limit) : rows, more };
  }

  /** Eine Zeile pro Freund mit mindestens einer Nachricht, die neueste Unterhaltung zuerst. */
  listConversations(uuid: string): ConversationRow[] {
    return (this.sql.listConversations.all(uuid) as Row[]).map((row) => ({
      uuid: String(row.friend),
      name: String(row.friend_name),
      last: toMessage(row),
      unread: Number(row.unread),
    }));
  }

  /** Ungelesene Nachrichten an `uuid` pro Freund (nur Freunde mit mindestens einer). */
  unreadCounts(uuid: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of this.sql.unreadCounts.all(uuid) as Row[]) counts[String(row.friend)] = Number(row.n);
    return counts;
  }

  /** Markiert alle Nachrichten von `from` an `to` als gelesen. Liefert die Anzahl. */
  markRead(from: string, to: string): number {
    return Number(this.sql.markRead.run(from, to).changes);
  }

  /** Alle gespeicherten Nachrichten von und an `uuid`, älteste zuerst (Datenauskunft). */
  messagesOf(uuid: string): MessageRow[] {
    return (this.sql.messagesOf.all(uuid, uuid) as Row[]).map(toMessage);
  }

  /** Löscht Nachrichten, die vor `cutoff` geschrieben wurden. */
  deleteMessagesBefore(cutoff: number): number {
    return Number(this.sql.deleteOldMessages.run(cutoff).changes);
  }

  // ---------- Blockierungen ----------

  listBlocks(uuid: string): BlockRow[] {
    return (this.sql.listBlocks.all(uuid) as Row[]).map(toRequest);
  }

  isBlocked(blocker: string, blocked: string): boolean {
    return this.sql.isBlocked.get(blocker, blocked) !== undefined;
  }

  countBlocks(uuid: string): number {
    return Number((this.sql.countBlocks.get(uuid) as Row).n);
  }

  /**
   * `blocker` blockiert `blocked`: Freundschaft, Anfragen (beide Richtungen) und Unterhaltung werden gelöscht.
   * Liefert true, wenn sich dadurch Freundesliste oder Anfragen geändert haben.
   */
  block(blocker: string, blocked: string, now: number): boolean {
    return this.transaction(() => {
      this.sql.addBlock.run(blocker, blocked, now);
      const friendship = Number(this.sql.removeFriendship.run(blocker, blocked, blocked, blocker).changes) > 0;
      const outgoing = Number(this.sql.removeRequest.run(blocker, blocked).changes) > 0;
      const incoming = Number(this.sql.removeRequest.run(blocked, blocker).changes) > 0;
      this.sql.deleteConversation.run(conversationKey(blocker, blocked));
      return friendship || outgoing || incoming;
    });
  }

  /** Hebt die Blockierung auf. Liefert true, wenn es eine gab. */
  unblock(blocker: string, blocked: string): boolean {
    return Number(this.sql.removeBlock.run(blocker, blocked).changes) > 0;
  }

  // ---------- Meldungen ----------

  insertReport(report: NewReport): number {
    const result = this.sql.insertReport.run(
      report.reporter,
      report.reporterName,
      report.reported,
      report.reportedName,
      report.reason,
      report.note,
      report.messages,
      report.at,
    );
    return Number(result.lastInsertRowid);
  }

  /** Meldungen von `reporter` nach `since`: Anzahl und Zeitpunkt der ältesten. */
  reportsSince(reporter: string, since: number): { count: number; oldest: number | null } {
    const row = this.sql.reportsSince.get(reporter, since) as Row;
    return { count: Number(row.n), oldest: row.oldest === null ? null : Number(row.oldest) };
  }

  /** Zeitpunkt der letzten Meldung von `reporter` über `reported` nach `since` (oder null). */
  lastPairReport(reporter: string, reported: string, since: number): number | null {
    const row = this.sql.pairReportSince.get(reporter, reported, since) as Row;
    return row.last === null ? null : Number(row.last);
  }

  /** Meldungen mit dem Status (Standard: alle), älteste zuerst. */
  listReports(status: ReportStatus | 'all' = 'all'): ReportRow[] {
    const statuses = status === 'all' ? ['open', 'done'] : [status];
    return (this.sql.listReports.all(JSON.stringify(statuses)) as Row[]).map(toReport);
  }

  getReport(id: number): ReportRow | undefined {
    const row = this.sql.getReport.get(id) as Row | undefined;
    return row ? toReport(row) : undefined;
  }

  /** Meldungen von `reporter`, neueste zuerst. */
  reportsBy(reporter: string): ReportRow[] {
    return (this.sql.reportsBy.all(reporter) as Row[]).map(toReport);
  }

  reportIdsAbout(uuid: string): number[] {
    return (this.sql.reportIdsAbout.all(uuid) as Row[]).map((row) => Number(row.id));
  }

  reportIdsBy(uuid: string): number[] {
    return (this.sql.reportIdsBy.all(uuid) as Row[]).map((row) => Number(row.id));
  }

  /** Setzt eine offene Meldung auf erledigt. Liefert false, wenn es sie nicht gibt oder sie schon erledigt war. */
  markReportDone(id: number, now: number, by: string | null): boolean {
    return Number(this.sql.markReportDone.run(now, by, id).changes) > 0;
  }

  deleteReportsBefore(cutoff: number): number {
    return Number(this.sql.deleteOldReports.run(cutoff).changes);
  }

  // ---------- Sperren ----------

  getBan(uuid: string): BanRow | undefined {
    const row = this.sql.getBan.get(uuid) as Row | undefined;
    return row ? toBan(row) : undefined;
  }

  findBanByName(name: string): BanRow | undefined {
    const row = this.sql.findBanByName.get(name.toLowerCase()) as Row | undefined;
    return row ? toBan(row) : undefined;
  }

  listBans(): BanRow[] {
    return (this.sql.listBans.all() as Row[]).map(toBan);
  }

  /**
   * Sperrt den Spieler: Konto mit Tokens, Freundschaften, Anfragen, Nachrichten und Blockierungen wird gelöscht,
   * gemerkt werden nur UUID, letzter Name, Datum und Grund. Meldungen von ihm und über ihn bleiben bis zum Ablauf.
   * Liefert die UUIDs der Spieler, deren Freundesliste oder Anfragen sich dadurch ändern.
   */
  ban(uuid: string, name: string, reason: string, now: number, by: string | null = null): string[] {
    const related = this.transaction(() => {
      this.sql.addBan.run(uuid, name, reason, now, by);
      return this.wipeUser(uuid);
    });
    this.checkpoint();
    return related;
  }

  unban(uuid: string): boolean {
    return Number(this.sql.removeBan.run(uuid).changes) > 0;
  }

  /** Sperren, deren letzter Name mit `prefix` beginnt. */
  searchBans(prefix: string, limit: number): BanRow[] {
    return (this.sql.searchBans.all(likePrefix(prefix), limit) as Row[]).map(toBan);
  }

  // ---------- Web-Anmeldung ----------

  insertWebCode(hash: string, uuid: string, expiresAt: number): void {
    this.sql.insertWebCode.run(hash, uuid, expiresAt);
  }

  /** Löst einen Einmal-Code ein: Danach ist er weg, auch wenn er abgelaufen war. Liefert die UUID oder undefined. */
  takeWebCode(hash: string, now: number): string | undefined {
    return this.transaction(() => {
      const row = this.sql.findWebCode.get(hash, now) as Row | undefined;
      this.sql.deleteWebCode.run(hash);
      return row ? String(row.uuid) : undefined;
    });
  }

  /** Neue Web-Sitzung; höchstens `keep` pro Spieler (die ältesten fallen weg). */
  insertWebSession(session: WebSessionRow, hash: string, keep: number): void {
    this.transaction(() => {
      this.sql.insertWebSession.run(
        session.id,
        hash,
        session.uuid,
        session.device,
        session.createdAt,
        session.lastUsedAt,
        session.expiresAt,
      );
      this.sql.trimWebSessions.run(session.uuid, session.uuid, keep);
    });
  }

  /** Gültige Sitzung zum Cookie-Hash: nicht abgelaufen und nach `idleCutoff` zuletzt benutzt. */
  findWebSession(hash: string, now: number, idleCutoff: number): WebSessionRow | undefined {
    const row = this.sql.findWebSession.get(hash, now, idleCutoff) as Row | undefined;
    return row ? toSession(row) : undefined;
  }

  touchWebSession(id: string, now: number): void {
    this.sql.touchWebSession.run(now, id);
  }

  verifyWebSession(id: string, now: number): void {
    this.sql.verifyWebSession.run(now, id);
  }

  listWebSessions(uuid: string, now: number, idleCutoff: number): WebSessionRow[] {
    return (this.sql.listWebSessions.all(uuid, now, idleCutoff) as Row[]).map(toSession);
  }

  deleteWebSession(uuid: string, id: string): boolean {
    return Number(this.sql.deleteWebSession.run(uuid, id).changes) > 0;
  }

  deleteExpiredWebSessions(now: number, idleCutoff: number): void {
    this.sql.deleteExpiredWebSessions.run(now, idleCutoff);
    this.sql.deleteExpiredWebCodes.run(now);
  }

  // ---------- Team ----------

  getTeamMember(uuid: string): TeamMemberRow | undefined {
    const row = this.sql.getTeamMember.get(uuid) as Row | undefined;
    return row ? toTeamMember(row) : undefined;
  }

  listTeam(): TeamMemberRow[] {
    return (this.sql.listTeam.all() as Row[]).map(toTeamMember);
  }

  countAdmins(): number {
    return Number((this.sql.countAdmins.get() as Row).n);
  }

  /** Nimmt den Spieler ins Team auf oder ändert seine Rolle. Liefert, was passiert ist. */
  setTeamMember(uuid: string, role: TeamRole, now: number, addedBy: string | null): 'added' | 'changed' | 'same' {
    return this.transaction(() => {
      const existing = this.getTeamMember(uuid);
      if (!existing) {
        this.sql.addTeamMember.run(uuid, role, now, addedBy);
        return 'added';
      }
      if (existing.role === role) return 'same';
      this.sql.setTeamRole.run(role, uuid);
      return 'changed';
    });
  }

  /** Entfernt den Spieler aus dem Team; seine Sitzungen gelten danach nicht mehr als bestätigt. */
  removeTeamMember(uuid: string): boolean {
    return this.transaction(() => {
      const removed = Number(this.sql.removeTeamMember.run(uuid).changes) > 0;
      this.sql.unverifyWebSessionsOf.run(uuid);
      return removed;
    });
  }

  setTotpPending(uuid: string, secret: string): void {
    this.sql.setTotpPending.run(secret, uuid);
  }

  /** Macht das vorläufige Geheimnis gültig; `step` ist der eben benutzte Zeitschritt. */
  enableTotp(uuid: string, step: number): boolean {
    return Number(this.sql.enableTotp.run(step, uuid).changes) > 0;
  }

  /** Merkt den benutzten Zeitschritt. false, wenn er (gleichzeitig) schon benutzt wurde. */
  useTotpStep(uuid: string, step: number): boolean {
    return Number(this.sql.setTotpLastStep.run(step, uuid, step).changes) > 0;
  }

  /** 2FA zurücksetzen: Geheimnis weg, keine Sitzung des Spielers gilt mehr als bestätigt. */
  resetTotp(uuid: string): boolean {
    return this.transaction(() => {
      const changed = Number(this.sql.resetTotp.run(uuid).changes) > 0;
      this.sql.unverifyWebSessionsOf.run(uuid);
      return changed;
    });
  }

  // ---------- Neuigkeiten ----------

  insertNews(title: string, text: string, author: { uuid: string; name: string }, published: boolean, now: number): NewsRow {
    const result = this.sql.insertNews.run(title, text, author.uuid, author.name, published ? 1 : 0, now, published ? now : null, now);
    return this.getNews(Number(result.lastInsertRowid))!;
  }

  getNews(id: number): NewsRow | undefined {
    const row = this.sql.getNews.get(id) as Row | undefined;
    return row ? toNews(row) : undefined;
  }

  /** Ändert eine Neuigkeit. Beim ersten Veröffentlichen zählt ab dann dieser Zeitpunkt als Datum. */
  updateNews(id: number, patch: { title?: string; text?: string; published?: boolean }, now: number): NewsRow | undefined {
    return this.transaction(() => {
      const current = this.getNews(id);
      if (!current) return undefined;
      const published = patch.published ?? current.published;
      const publishedAt = published && current.publishedAt === null ? now : current.publishedAt;
      this.sql.updateNews.run(patch.title ?? current.title, patch.text ?? current.text, published ? 1 : 0, publishedAt, now, id);
      return this.getNews(id);
    });
  }

  deleteNews(id: number): boolean {
    return Number(this.sql.deleteNews.run(id).changes) > 0;
  }

  /** Alle Neuigkeiten (auch Entwürfe), neueste zuerst. */
  listNews(): NewsRow[] {
    return (this.sql.listNews.all() as Row[]).map(toNews);
  }

  listPublishedNews(limit: number): NewsRow[] {
    return (this.sql.listPublishedNews.all(limit) as Row[]).map(toNews);
  }

  /** Veröffentlichte Neuigkeiten nach (älter als) der mit der ID `before`, neueste zuerst. */
  listPublishedNewsBefore(before: number, limit: number): NewsRow[] {
    const anchor = this.getNews(before);
    if (anchor && anchor.published && anchor.publishedAt !== null) {
      return (this.sql.listPublishedNewsBefore.all(anchor.publishedAt, anchor.publishedAt, anchor.id, limit) as Row[]).map(toNews);
    }
    // Gibt es die Neuigkeit nicht mehr (gelöscht oder zurückgezogen): nach der ID.
    return (this.sql.listPublishedNewsBeforeId.all(before, limit) as Row[]).map(toNews);
  }

  newsBy(uuid: string): NewsRow[] {
    return (this.sql.newsBy.all(uuid) as Row[]).map(toNews);
  }

  // ---------- Protokoll ----------

  insertAudit(entry: NewAudit): void {
    this.sql.insertAudit.run(entry.at, entry.actorUuid, entry.actorName, entry.action, entry.target, entry.detail);
  }

  listAudit(limit: number): AuditRow[] {
    return (this.sql.listAudit.all(limit) as Row[]).map(toAudit);
  }

  auditBy(uuid: string): AuditRow[] {
    return (this.sql.auditBy.all(uuid) as Row[]).map(toAudit);
  }

  deleteAuditBefore(cutoff: number): number {
    return Number(this.sql.deleteOldAudit.run(cutoff).changes);
  }

  // ---------- Teamprofil ----------

  setTeamProfile(uuid: string, patch: TeamProfilePatch): void {
    this.sql.setTeamProfile.run(patch.public === undefined ? null : patch.public ? 1 : 0, patch.title ?? null, patch.about ?? null, uuid);
  }

  /** Öffentliche Team-Mitglieder: Admins zuerst, dann nach Name. */
  listPublicTeam(): TeamMemberRow[] {
    return (this.sql.listPublicTeam.all() as Row[]).map(toTeamMember);
  }

  isPublicTeamMember(uuid: string): boolean {
    return this.sql.isPublicTeamMember.get(uuid) !== undefined;
  }

  publicTeamUuids(): Set<string> {
    return new Set((this.sql.publicTeamUuids.all() as Row[]).map((row) => String(row.uuid)));
  }

  // ---------- Support ----------

  /** Neue Anfrage mit erster Nachricht des Spielers. Liefert die Nummer. */
  insertTicket(uuid: string, name: string, category: string, subject: string, text: string, now: number): number {
    return this.transaction(() => {
      const id = Number(this.sql.insertTicket.run(uuid, category, subject, now, now).lastInsertRowid);
      this.sql.insertTicketMessage.run(id, now, 0, uuid, name, text);
      this.sql.markTicketRead.run(id, id);
      return id;
    });
  }

  getTicket(id: number): TicketRow | undefined {
    const row = this.sql.getTicket.get(id) as Row | undefined;
    return row ? toTicket(row) : undefined;
  }

  /** Anfragen eines Spielers, neueste Aktivität zuerst. */
  ticketsOf(uuid: string): TicketRow[] {
    return (this.sql.ticketsOf.all(uuid) as Row[]).map(toTicket);
  }

  /** Anfragen mit einem der Status, neueste Aktivität zuerst. */
  tickets(statuses: TicketStatus[]): TicketRow[] {
    return (this.sql.ticketsIn.all(JSON.stringify(statuses)) as Row[]).map(toTicket);
  }

  ticketMessages(id: number): TicketMessageRow[] {
    return (this.sql.ticketMessages.all(id) as Row[]).map(toTicketMessage);
  }

  /** Neue Nachricht; der Status wird `status` (Spieler: open, Team: answered). */
  addTicketMessage(id: number, fromTeam: boolean, author: { uuid: string; name: string }, text: string, status: TicketStatus, now: number): void {
    this.transaction(() => {
      this.sql.insertTicketMessage.run(id, now, fromTeam ? 1 : 0, author.uuid, author.name, text);
      this.sql.setTicketStatus.run(status, now, id);
    });
  }

  /** Schließt die Anfrage. false, wenn sie schon geschlossen war. */
  closeTicket(id: number, now: number): boolean {
    return Number(this.sql.closeTicket.run(now, now, id).changes) > 0;
  }

  /** Der Spieler hat alle bisherigen Nachrichten gesehen. */
  markTicketRead(id: number): void {
    this.sql.markTicketRead.run(id, id);
  }

  countOpenTickets(uuid: string): number {
    return Number((this.sql.countOpenTickets.get(uuid) as Row).n);
  }

  /** Neue Anfragen eines Spielers nach `since`: Anzahl und Zeitpunkt der ältesten. */
  ticketsSince(uuid: string, since: number): { count: number; oldest: number | null } {
    const row = this.sql.ticketsSince.get(uuid, since) as Row;
    return { count: Number(row.n), oldest: nullableNumber(row.oldest) };
  }

  /** Nachrichten eines Spielers in Anfragen nach `since`: Anzahl und Zeitpunkt der ältesten. */
  playerTicketMessagesSince(uuid: string, since: number): { count: number; oldest: number | null } {
    const row = this.sql.playerMessagesSince.get(uuid, since) as Row;
    return { count: Number(row.n), oldest: nullableNumber(row.oldest) };
  }

  /** Löscht geschlossene Anfragen, die vor `closedCutoff` geschlossen wurden, und andere ohne Nachricht seit `idleCutoff`. */
  deleteOldTickets(closedCutoff: number, idleCutoff: number): number {
    return Number(this.sql.deleteOldTickets.run(closedCutoff, idleCutoff).changes);
  }

  // ---------- Versionsverlauf und Status ----------

  /** Merkt sich eine veröffentlichte Launcher-Version (jede Version nur einmal). true, wenn sie neu ist. */
  recordVersion(version: string, date: string, notes: string[], now: number): boolean {
    return Number(this.sql.recordVersion.run(version, date, JSON.stringify(notes), now).changes) > 0;
  }

  listVersions(limit: number): LauncherVersionRow[] {
    return (this.sql.listVersions.all(limit) as Row[]).map(toVersion);
  }

  countUsers(): number {
    return Number((this.sql.countUsers.get() as Row).n);
  }
}
