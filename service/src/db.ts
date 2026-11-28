// Speicher des Dienstes: SQLite über node:sqlite (ohne native Pakete).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { isCommunityBadge, isTeamRole, TEAM_ROLES, type CommunityBadge, type TeamRole } from './roles';

export type { CommunityBadge, TeamRole } from './roles';

export interface UserRow {
  uuid: string;
  name: string;
  /** eingebautes Cape oder Katalog-Cape (Slot cape); '' = keins */
  cape: string;
  /** gewählte Cosmetics je Slot ('' = nichts) */
  worn: WornCosmetics;
  visible: boolean;
  presence: boolean;
  showServer: boolean;
  messages: boolean;
  createdAt: number;
  lastSeen: number;
  /** Freunde 2.0 (ab 1.12.0): Statustext ('' = keiner), „Nicht stören“ */
  statusText: string;
  dnd: boolean;
  /** Freunde sehen „zuletzt online“ (nur mit presence) */
  showLastOnline: boolean;
  /** erscheint bei Freunden von Freunden in den Vorschlägen (Standard aus) */
  suggestable: boolean;
  /** bekommt selbst Vorschläge */
  showSuggestions: boolean;
  /** „Ist online“-Benachrichtigungen: alle Freunde, nur Favoriten oder keine (wertet der Client aus) */
  onlineNotify: OnlineNotify;
  /** Ende der letzten Verbindung aus dem Spiel (null = noch nie bzw. unbekannt) */
  lastOnline: number | null;
}

export const ONLINE_NOTIFY = ['all', 'favorites', 'none'] as const;
export type OnlineNotify = (typeof ONLINE_NOTIFY)[number];

export interface RequestRow {
  uuid: string;
  name: string;
  at: number;
}

export interface FriendshipRow extends FriendshipExtras {
  user: UserRow;
  since: number;
}

/** Eigene Angaben zu einem Freund (Favorit, Spitzname, Notiz), nur für den Besitzer der Zeile (ab 1.12.0). */
export interface FriendshipExtras {
  favorite: boolean;
  nickname: string;
  note: string;
}

/** Wer `friend` als Freund hat, mit seinen eigenen Angaben dazu (für Echtzeit-Nachrichten je Betrachter). */
export interface FriendViewerRow extends FriendshipExtras {
  uuid: string;
  since: number;
}

export interface FriendshipPatch {
  favorite?: boolean;
  nickname?: string;
  note?: string;
}

/** Vorschlag „Freunde von Freunden“ (nur Spieler mit `suggestable`). */
export interface SuggestionRow {
  uuid: string;
  name: string;
  mutual: number;
}

/** Slots der Cosmetics außer dem Cape (das steht in `UserRow.cape`). */
export const WORN_SLOTS = ['head', 'back', 'aura', 'companion'] as const;
export type WornSlot = (typeof WORN_SLOTS)[number];
export type WornCosmetics = Record<WornSlot, string>;

export interface SettingsPatch {
  cape?: string;
  visible?: boolean;
  presence?: boolean;
  showServer?: boolean;
  messages?: boolean;
  statusText?: string;
  dnd?: boolean;
  showLastOnline?: boolean;
  suggestable?: boolean;
  showSuggestions?: boolean;
  onlineNotify?: OnlineNotify;
}

export interface MessageRow {
  id: number;
  from: string;
  to: string;
  text: string;
  at: number;
  /** Vom Empfänger gelesen. */
  read: boolean;
  /** Antwort auf diese Nachricht (ID; die Nachricht kann inzwischen gelöscht sein) */
  replyTo: number | null;
  /** Beitreten-Karte (ab 1.12.0) */
  card: MessageCard | null;
}

export const CARD_KINDS = ['server', 'world', 'invite'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** Beitreten-Karte an einer Nachricht: Server-Adresse, Welt-Code oder Einladungs-Code, dazu ein Titel. */
export interface MessageCard {
  kind: CardKind;
  target: string;
  title: string;
}

/** Eigene Reaktion auf eine Nachricht (Datenauskunft). */
export interface ReactionRow {
  message: number;
  reaction: string;
  at: number;
}

/** Community-Abzeichen eines Spielers. */
export interface CommunityBadgeRow {
  uuid: string;
  name: string;
  badge: CommunityBadge;
  addedAt: number;
  /** Name des Team-Mitglieds; null = über die Server-Konsole */
  addedBy: string | null;
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
  /** Ab 1.13.0: `chat` (Nachrichten als Beleg) oder `voice` (Kontext, Lautstärke-Verlauf, ggf. Clip; voice-moderation.ts) */
  kind: string;
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

/** Anhang einer Support-Anfrage (ohne Inhalt). `size`: Größe entpackt in Byte. */
export interface TicketAttachmentRow {
  id: number;
  name: string;
  size: number;
  at: number;
}

export interface LauncherVersionRow {
  version: string;
  date: string;
  notes: string[];
  publishedAt: number;
}

/** Besitzer eines Addons, dessen Konto gelöscht (oder gesperrt) wurde: Die ID bleibt vergeben, ohne UUID. */
export const DELETED_OWNER = 'geloescht';

/** Screenshot eines Addons oder einer Einreichung (Datei im jeweiligen Ordner, Größe aus dem Dateikopf). */
export interface AddonScreenshot {
  file: string;
  type: 'png' | 'jpeg';
  width: number;
  height: number;
  size: number;
}

/**
 * Addon im Store. `downloads`: vollständige Downloads, nur eine Zahl (ohne IP oder sonstige Daten).
 * `owner`: UUID des Einreichers; null = Team (offiziell); `DELETED_OWNER` = Konto des Einreichers gelöscht.
 */
export interface AddonRow {
  id: string;
  hidden: boolean;
  downloads: number;
  createdAt: number;
  owner: string | null;
  screenshots: AddonScreenshot[];
}

export type SubmissionStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface SubmissionInspection {
  classes: number;
  uses: string[];
  /** Hinweise aus `uses`, die zum Zugriff passen (bei Zugriff minecraft: „minecraft“); fehlt in älteren Einreichungen */
  expected: string[];
}

/** Einreichung eines Addons durch einen Spieler. */
export interface SubmissionRow {
  id: string;
  /** Einreicher */
  uuid: string;
  /** aktueller Name des Einreichers */
  submitterName: string;
  status: SubmissionStatus;
  /** aus heldix.addon.json der hochgeladenen JAR (null: noch keine JAR) */
  addonId: string | null;
  version: string | null;
  name: string;
  summary: string;
  description: string;
  category: string;
  icon: string;
  platforms: string[];
  notes: string[];
  authors: string[];
  api: number | null;
  size: number | null;
  sha256: string | null;
  inspection: SubmissionInspection | null;
  screenshots: AddonScreenshot[];
  /** Vom Dienst erzeugtes Manifest (genau der Text, der signiert wird); null, solange nicht eingereicht */
  manifest: string | null;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  reviewedAt: number | null;
  reviewNote: string | null;
  /** Name und UUID des Team-Mitglieds, das geprüft hat */
  reviewer: string | null;
  reviewerUuid: string | null;
  /** aus heldix.addon.json abgeleitet (null: noch keine JAR) */
  access: 'api' | 'minecraft' | null;
  /** Minecraft-Versionen aus heldix.addon.json (leer = jede) */
  minecraft: string[];
  /** wo das Addon läuft (leer: noch keine JAR) */
  loaders: string[];
}

export type AddonReportStatus = 'open' | 'done';

export interface AddonReportRow {
  id: number;
  addon: string;
  reporter: string;
  reporterName: string;
  reason: string;
  note: string;
  at: number;
  status: AddonReportStatus;
  doneAt: number | null;
  doneBy: string | null;
}

/** Veröffentlichte Version eines Addons. `manifest` ist genau der signierte Text. */
export interface AddonVersionRow {
  id: string;
  version: string;
  manifest: string;
  signature: string;
  file: string;
  size: number;
  sha256: string;
  publishedAt: number;
  /** Spielername des Team-Mitglieds; null = über die Server-Konsole */
  publishedBy: string | null;
}

/**
 * Cosmetic im Katalog (nur die aktuelle Version), ohne den signierten Text. `name`, `description`, `access` und `date`
 * stammen aus dem geprüften Manifest; `size` und `sha256` gelten für den Umschlag, wie der Dienst ihn ausliefert.
 */
export interface CosmeticInfoRow {
  id: string;
  slot: string;
  version: number;
  access: string;
  hidden: boolean;
  name: string;
  description: string;
  date: string;
  size: number;
  sha256: string;
  createdAt: number;
  publishedAt: number;
  /** Spielername des Team-Mitglieds; null = über die Server-Konsole */
  publishedBy: string | null;
}

/** Cosmetic mit dem signierten Manifest-Text und der Signatur (Base64). */
export interface CosmeticRow extends CosmeticInfoRow {
  manifest: string;
  signature: string;
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

/** Einladung (Link mit Code). */
export interface InviteRow {
  code: string;
  inviter: string;
  createdAt: number;
  expiresAt: number;
  /** normalisierte Server-Adresse oder null */
  server: string | null;
  /** Prüfwert der Voice-Gruppe (64 Hex-Zeichen) oder null */
  voiceGroup: string | null;
  /** wie oft die Einladung zu einer neuen Freundschaft oder einem neuen Spieler geführt hat */
  accepted: number;
}

/** Neu über eine Einladung dazugekommen. */
export interface ReferralRow {
  invitee: string;
  /** null: zählt für niemanden (Konto gelöscht oder blockiert) */
  inviter: string | null;
  code: string | null;
  at: number;
  playedMs: number;
  confirmed: number | null;
}

export interface UnlockRow {
  cosmetic: string;
  reason: string;
  at: number;
}

export type WorldAccess = 'invited' | 'friends' | 'open';
export type WorldRole = 'visitor' | 'player' | 'operator';

/** Geteilte Welt (Welt teilen, ab 1.12.0). */
export interface WorldRow {
  id: string;
  owner: string;
  code: string;
  name: string;
  access: WorldAccess;
  maxPlayers: number;
  defaultRole: WorldRole;
  createdAt: number;
  lastOnline: number | null;
  version: string | null;
}

export interface WorldPatch {
  name?: string;
  access?: WorldAccess;
  maxPlayers?: number;
  defaultRole?: WorldRole;
}

export interface WorldMemberRow {
  name: string;
  uuid: string | null;
  role: WorldRole;
  addedAt: number;
}

/** Mitgliedschaft in der Welt eines anderen (Datenauskunft). */
export interface WorldMembershipRow {
  world: string;
  worldName: string;
  owner: string;
  ownerName: string;
  name: string;
  role: WorldRole;
  addedAt: number;
}

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
  // 5: Addon-Store (Addons mit Download-Zähler, signierte Versionen)
  `
CREATE TABLE addons (
  id TEXT PRIMARY KEY,
  hidden INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- manifest: genau der signierte Text; published_by: Spielername (NULL = Server-Konsole), ohne Fremdschlüssel,
-- damit der Name an der Version bleibt, auch wenn das Team-Mitglied sein Konto löscht.
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
`,
  // 6: Addons von Spielern (Besitzer, Einreichungen mit Prüfung), Screenshots, Bewertungen, Meldungen zu Addons;
  //    Anhänge an Support-Anfragen
  `
-- owner: UUID des Einreichers; NULL = Team (offiziell); 'geloescht' = Konto des Einreichers gelöscht
ALTER TABLE addons ADD COLUMN owner TEXT;
-- screenshots: JSON-Liste [{ file, type, width, height, size }] (Dateien im Ordner screenshots)
ALTER TABLE addons ADD COLUMN screenshots TEXT NOT NULL DEFAULT '[]';
CREATE INDEX addons_owner ON addons (owner);

-- Einreichungen; platforms, notes, authors, inspection, screenshots als JSON. Mit dem Konto gelöscht.
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

-- Bewertungen 1–5: eine pro Spieler und Addon, mit Konto oder Addon gelöscht
CREATE TABLE addon_ratings (
  addon TEXT NOT NULL REFERENCES addons (id) ON DELETE CASCADE,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  stars INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (addon, uuid)
) STRICT, WITHOUT ROWID;
CREATE INDEX addon_ratings_uuid ON addon_ratings (uuid);

-- Meldungen zu Addons: ohne Fremdschlüssel (bleiben bis zum Ablauf, auch wenn das Addon gelöscht wird)
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

-- Anhänge von Support-Anfragen (Textdateien wie Absturzberichte, gzip-komprimiert), mit der Anfrage gelöscht
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
`,
  // 7: Cosmetics-Katalog (signierte Manifeste des Teams) und die Auswahl der Spieler je Slot
  `
-- Nur die aktuelle Version je Cosmetic. name, description, access und date stammen aus dem geprüften Manifest (für die
-- Liste, ohne jedes Mal das Manifest zu lesen); size und sha256 gelten für den ausgelieferten Umschlag. published_by:
-- Spielername ohne Fremdschlüssel (bleibt wie bei Addon-Versionen). signature und manifest stehen zuletzt: Abfragen
-- ohne sie lesen die großen Werte nicht.
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

-- Auswahl je Slot ('' = nichts); das Cape bleibt in users.cape (eingebaute Capes und Katalog-Capes)
ALTER TABLE users ADD COLUMN cosmetic_head TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN cosmetic_back TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN cosmetic_aura TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN cosmetic_companion TEXT NOT NULL DEFAULT '';
-- Für Träger zählen und zurücksetzen (nur Spieler, die etwas gewählt haben)
CREATE INDEX users_cosmetic_head ON users (cosmetic_head) WHERE cosmetic_head <> '';
CREATE INDEX users_cosmetic_back ON users (cosmetic_back) WHERE cosmetic_back <> '';
CREATE INDEX users_cosmetic_aura ON users (cosmetic_aura) WHERE cosmetic_aura <> '';
CREATE INDEX users_cosmetic_companion ON users (cosmetic_companion) WHERE cosmetic_companion <> '';
CREATE INDEX users_cape ON users (cape) WHERE cape <> '';
`,
  // 8: Addons dürfen in Minecraft eingreifen: Zugriff, Minecraft-Versionen und Loader einer Einreichung (aus der JAR)
  `
ALTER TABLE addon_submissions ADD COLUMN access TEXT;
ALTER TABLE addon_submissions ADD COLUMN minecraft TEXT NOT NULL DEFAULT '[]';
ALTER TABLE addon_submissions ADD COLUMN loaders TEXT NOT NULL DEFAULT '[]';
-- Bis hierher hochgeladene JARs brauchten einen entrypoint und nutzten damit nur die Heldix-API
UPDATE addon_submissions SET access = 'api', loaders = '["heldix","fabric"]' WHERE addon_id IS NOT NULL;
`,
  // 9: Einladungen (Links mit Code), wer über wen neu dazukam (Belohnungen) und freigeschaltete Cosmetics
  `
-- Einladung eines Spielers; server und voice_group (Prüfwert der Gruppe) nur, wenn angegeben. accepted zählt, wie oft
-- die Einladung zu einer neuen Freundschaft oder einem neuen Spieler geführt hat. Mit dem Konto gelöscht, abgelaufene
-- beim Aufräumen.
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  inviter TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  server TEXT,
  voice_group TEXT,
  accepted INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;
CREATE INDEX invites_inviter ON invites (inviter, created_at);
CREATE INDEX invites_expires ON invites (expires_at);

-- Neu über eine Einladung dazugekommen: höchstens einmal je Spieler. inviter NULL = zählt für niemanden (Konto des
-- Einladenden gelöscht oder einer hat den anderen blockiert). played_ms: nur die Summe der Spielzeit bis zur
-- Bestätigung (confirmed), danach zählt der Dienst nicht mehr.
CREATE TABLE referrals (
  invitee TEXT PRIMARY KEY REFERENCES users (uuid) ON DELETE CASCADE,
  inviter TEXT REFERENCES users (uuid) ON DELETE SET NULL,
  code TEXT,
  at INTEGER NOT NULL,
  played_ms INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER
) STRICT, WITHOUT ROWID;
CREATE INDEX referrals_inviter ON referrals (inviter, confirmed);

-- Freigeschaltete Cosmetics (access: unlock), auch wenn es das Cosmetic im Katalog (noch) nicht gibt
CREATE TABLE unlocks (
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  cosmetic TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (uuid, cosmetic)
) STRICT, WITHOUT ROWID;
`,
  // 10: Welt teilen – Welten mit fester Adresse (<code>.<Welt-Domain>) und ihre Mitglieder
  `
-- Welt eines Spielers (höchstens 10). code: 6 Zeichen aus dem Alphabet der Einladungen, bleibt für immer gleich.
-- last_online: zuletzt geöffnet bzw. geschlossen; version: zuletzt gemeldete Minecraft-Version (für Webseite und
-- Launcher, auch wenn die Welt gerade zu ist). Mit dem Konto gelöscht.
CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  access TEXT NOT NULL,
  max_players INTEGER NOT NULL,
  default_role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_online INTEGER,
  version TEXT
) STRICT, WITHOUT ROWID;
CREATE INDEX worlds_owner ON worlds (owner, created_at);

-- Mitglieder (Minecraft-Namen, auch ohne HeldixClient). uuid nur, wenn bekannt (Heldix-Spieler mit diesem Namen oder
-- über die Freundesliste eingeladen); löscht ein Spieler sein Konto, vergisst der Dienst nur die UUID.
CREATE TABLE world_members (
  world TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  uuid TEXT,
  role TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (world, name_lower)
) STRICT, WITHOUT ROWID;
CREATE INDEX world_members_uuid ON world_members (uuid) WHERE uuid IS NOT NULL;
CREATE INDEX world_members_name ON world_members (name_lower);
`,
  // 11: Freunde 2.0 (Statustext, „Nicht stören“, Schalter, zuletzt online, Favorit/Spitzname/Notiz je Freundschaft,
  //     Antworten, Beitreten-Karten, Reaktionen) und Community-Abzeichen; neue Team-Rollen brauchen keine Änderung
  `
ALTER TABLE users ADD COLUMN status_text TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN dnd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN show_last_online INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN suggestable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN show_suggestions INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN online_notify TEXT NOT NULL DEFAULT 'all';
-- Ende der letzten Verbindung aus dem Spiel; bis zur ersten neuen Trennung gilt die letzte bekannte Verbindung
ALTER TABLE users ADD COLUMN last_online INTEGER;
UPDATE users SET last_online = last_seen;

-- Favorit, Spitzname und Notiz gehören dem Besitzer der Zeile (uuid) und gehen mit der Freundschaft
ALTER TABLE friendships ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friendships ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
ALTER TABLE friendships ADD COLUMN note TEXT NOT NULL DEFAULT '';
CREATE INDEX friendships_friend ON friendships (friend);

-- Antwort auf eine Nachricht (ID ohne Fremdschlüssel: die Nachricht kann gelöscht werden) und Beitreten-Karte als JSON
ALTER TABLE messages ADD COLUMN reply_to INTEGER;
ALTER TABLE messages ADD COLUMN card TEXT;

-- Reaktionen: höchstens eine je Spieler und Nachricht, mit der Nachricht bzw. dem Konto gelöscht
CREATE TABLE message_reactions (
  message INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (message, uuid)
) STRICT, WITHOUT ROWID;
CREATE INDEX message_reactions_uuid ON message_reactions (uuid);

-- Community-Abzeichen (Partner, Creator, Botschafter): höchstens eines je Spieler, mit dem Konto gelöscht.
-- added_by: Name des Team-Mitglieds ohne Fremdschlüssel (NULL = Server-Konsole)
CREATE TABLE community_badges (
  uuid TEXT PRIMARY KEY REFERENCES users (uuid) ON DELETE CASCADE,
  badge TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  added_by TEXT
) STRICT, WITHOUT ROWID;

-- Team-Rollen: admin und moderator bleiben, wie sie sind; Unbekanntes (nie vorgesehen) wird zu moderator
UPDATE team SET role = 'moderator' WHERE role NOT IN ('admin', 'moderator');
`,
  // 12: Dauerhafte Welten (1.13.0) mit Plugins, Freischaltungen dafür, Heldix+-Warteliste und Entdecken (Weltenverzeichnis)
  `
-- Dauerhafte Welt: gehört zu einer geteilten Welt (gleiche ID, Besitzer = Besitzer der Welt) und geht mit ihr und dem
-- Konto. state: creating | sleeping | starting | running | stopping | error (beim Start des Dienstes neu abgeglichen).
-- jar: Server-Software als JSON (paper/vanilla, Version, Build, Adresse, Prüfsumme); properties: Auswahl aus
-- server.properties (JSON); icon: Symbol 64×64 (PNG, mit Heldix-Plakette); applied_roles: zuletzt per Konsole gesetzte
-- Rolle je Name (JSON), damit ein Rollenwechsel beim nächsten Beitreten greift.
CREATE TABLE hosted_worlds (
  world TEXT PRIMARY KEY REFERENCES worlds (id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  error TEXT,
  jar TEXT NOT NULL,
  memory_mb INTEGER NOT NULL,
  disk_mb INTEGER NOT NULL,
  max_plugins INTEGER NOT NULL,
  sleep_after_min INTEGER NOT NULL,
  properties TEXT NOT NULL,
  icon BLOB,
  prepared INTEGER NOT NULL DEFAULT 0,
  awaiting_upload INTEGER NOT NULL DEFAULT 0,
  restart_needed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_started_at INTEGER,
  last_active_at INTEGER,
  last_daily_backup_at INTEGER,
  applied_roles TEXT NOT NULL DEFAULT '{}'
) STRICT;

-- Plugins einer dauerhaften Welt (nur aus dem Modrinth-Katalog): Projekt, gewählte Version, Datei und Prüfsumme
CREATE TABLE hosted_plugins (
  world TEXT NOT NULL REFERENCES hosted_worlds (world) ON DELETE CASCADE,
  project TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  icon TEXT,
  version_id TEXT NOT NULL,
  version_number TEXT NOT NULL,
  file TEXT NOT NULL,
  sha512 TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  PRIMARY KEY (world, project)
) STRICT, WITHOUT ROWID;

-- Gelöschte dauerhafte Welten, deren Daten der Runner noch löschen muss. Der Trigger greift auch, wenn die Zeile über
-- einen Fremdschlüssel wegfällt (Konto gelöscht oder gesperrt, auch über heldix-dienst-admin). Nur diese Welten löscht
-- der Dienst beim Runner; Unbekanntes dort meldet er nur (eine falsche Datenbank löscht so nie fremde Welten).
CREATE TABLE hosted_tombstones (
  world TEXT PRIMARY KEY,
  at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE TRIGGER hosted_worlds_tombstone AFTER DELETE ON hosted_worlds BEGIN
  INSERT OR REPLACE INTO hosted_tombstones (world, at) VALUES (old.world, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
END;

-- Plugins zum Zeitpunkt einer Sicherung (JSON wie hosted_plugins), damit Wiederherstellen auch die Liste zurückholt
CREATE TABLE hosted_backup_plugins (
  world TEXT NOT NULL REFERENCES hosted_worlds (world) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plugins TEXT NOT NULL,
  PRIMARY KEY (world, name)
) STRICT, WITHOUT ROWID;

-- Freischaltungen für dauerhafte Welten: source 'beta' (Beta: Dauerhafte Welten, vom Team); später 'plus' (Heldix+).
-- granted_by: Name des Team-Mitglieds ohne Fremdschlüssel (NULL = Server-Konsole); expires_at NULL = unbefristet;
-- seen_at: wann der Spieler den Hinweis gesehen hat (bis dahin bekommt er ihn bei der nächsten Verbindung).
CREATE TABLE hosting_grants (
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  source TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  granted_by TEXT,
  expires_at INTEGER,
  seen_at INTEGER,
  PRIMARY KEY (uuid, source)
) STRICT, WITHOUT ROWID;

-- Heldix+-Warteliste: nur UUID und seit wann, bis zur Entfernung, bis Heldix+ startet oder mit dem Konto
CREATE TABLE plus_waitlist (
  uuid TEXT PRIMARY KEY REFERENCES users (uuid) ON DELETE CASCADE,
  since INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX plus_waitlist_since ON plus_waitlist (since);

-- Entdecken: freiwilliger Eintrag einer Welt im öffentlichen Verzeichnis (geht mit der Welt). tags: JSON-Liste.
-- hidden: vom Team ausgeblendet (hidden_by = Name des Team-Mitglieds).
CREATE TABLE discover_listings (
  world TEXT PRIMARY KEY REFERENCES worlds (id) ON DELETE CASCADE,
  listed INTEGER NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL,
  lang TEXT NOT NULL,
  listed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  rules_accepted_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER,
  hidden_by TEXT
) STRICT, WITHOUT ROWID;

-- „Gefällt mir“: eins je Spieler und Welt; öffentlich nur als Zahl
CREATE TABLE discover_likes (
  world TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  uuid TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  PRIMARY KEY (world, uuid)
) STRICT, WITHOUT ROWID;
CREATE INDEX discover_likes_uuid ON discover_likes (uuid);

-- Meldungen zu Einträgen (wie Spielermeldungen): Stand des Eintrags beim Melden; mit dem Konto des Meldenden gelöscht,
-- sonst nach 90 Tagen
CREATE TABLE discover_reports (
  id INTEGER PRIMARY KEY,
  world TEXT NOT NULL,
  code TEXT NOT NULL,
  world_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  description TEXT NOT NULL,
  reporter TEXT NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
  reporter_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  done_at INTEGER,
  done_by TEXT
) STRICT;
CREATE INDEX discover_reports_status ON discover_reports (status, at);
CREATE INDEX discover_reports_reporter ON discover_reports (reporter, at);

-- Für das Verzeichnis gesperrte Besitzer (bleibt wie eine Sperre, auch nach dem Löschen der Daten)
CREATE TABLE discover_bans (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL,
  by_name TEXT
) STRICT, WITHOUT ROWID;
`,
  // 13: Voice-Moderation (1.13.0): Meldungen mit Art (chat/voice), Kontext und Ergebnis; Voice-Sperren, Zustimmung zu den
  //     Voice-Regeln (versioniert), Einstellungen, Liste „Voice aus“ für Server und verschlüsselte Clips zu Meldungen
  `
-- kind: 'chat' (Nachrichten als Beleg) oder 'voice'; context: JSON (Kontext vom Client und vom Dienst, Lautstärke-Verlauf);
-- outcome: Ergebnis der Prüfung (justified | unjustified | unclear) für die Verlässlichkeit des Meldenden
ALTER TABLE reports ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE reports ADD COLUMN context TEXT;
ALTER TABLE reports ADD COLUMN outcome TEXT;
CREATE INDEX reports_kind ON reports (kind, status, id);

-- Voice-Sperren mit Verlauf (ohne Fremdschlüssel: bleiben wie Sperren, auch wenn das Konto gelöscht wird). until NULL =
-- dauerhaft; reports: JSON-Liste der Meldungen als Begründung; by_name/lifted_by: Name des Team-Mitglieds. Aufgehobene
-- und abgelaufene Einträge löscht der Dienst nach 365 Tagen.
CREATE TABLE voice_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  reports TEXT NOT NULL DEFAULT '[]',
  at INTEGER NOT NULL,
  until INTEGER,
  by_name TEXT,
  lifted_at INTEGER,
  lifted_by TEXT
) STRICT;
CREATE INDEX voice_bans_uuid ON voice_bans (uuid, at);

-- Zustimmung zu den Voice-Regeln: Version und Zeitpunkt, mit dem Konto gelöscht (Widerruf löscht die Zeile)
CREATE TABLE voice_consents (
  uuid TEXT PRIMARY KEY REFERENCES users (uuid) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- Veröffentlichte Voice-Regeln (es gilt die neueste, solange sie nicht zurückgezogen ist)
CREATE TABLE voice_rules (
  version INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  published_by TEXT,
  withdrawn_at INTEGER,
  withdrawn_by TEXT
) STRICT;

-- Schalter des Admins (z. B. clips = '0' | '1')
CREATE TABLE voice_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- Server, auf denen Voice aus ist (Wunsch des Betreibers): Domain, auf Wunsch mit allen Subdomains
CREATE TABLE voice_servers (
  domain TEXT PRIMARY KEY,
  subdomains INTEGER NOT NULL,
  reason TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  by_name TEXT
) STRICT, WITHOUT ROWID;

-- Clip zu einer Voice-Meldung: verschlüsselte Datei im Datenordner (voice-clips/<file>), geht mit der Meldung.
-- meta: JSON (Beginn, Sätze mit Zeitpunkten)
CREATE TABLE voice_clips (
  report INTEGER PRIMARY KEY REFERENCES reports (id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  meta TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX voice_clips_created ON voice_clips (created_at);
`,
];

const SCHEMA_VERSION = MIGRATIONS.length;

const USER_COLUMNS = `u.uuid, u.name, u.cape, u.visible, u.presence, u.show_server, u.messages, u.created_at, u.last_seen,
  u.cosmetic_head, u.cosmetic_back, u.cosmetic_aura, u.cosmetic_companion,
  u.status_text, u.dnd, u.show_last_online, u.suggestable, u.show_suggestions, u.online_notify, u.last_online`;
const MESSAGE_COLUMNS = 'm.id, m.from_uuid, m.to_uuid, m.text, m.at, m.is_read, m.reply_to, m.card';
/** Rang der Team-Rollen in SQL (wie roleRank): Admin zuerst. */
const ROLE_ORDER = `CASE t.role ${TEAM_ROLES.map((role, i) => `WHEN '${role}' THEN ${i}`).join(' ')} ELSE ${TEAM_ROLES.length} END`;
const REPORT_COLUMNS = 'id, reporter, reporter_name, reported, reported_name, reason, note, messages, at, status, done_at, done_by, kind';
const BAN_COLUMNS = 'uuid, name, reason, at, by_name';
const SESSION_COLUMNS = 'id, uuid, device, created_at, last_used_at, expires_at, verified_at';
const TEAM_COLUMNS = 't.uuid, u.name, t.role, t.added_at, t.added_by, t.totp_secret, t.totp_pending, t.totp_last_step, t.public, t.title, t.about';
const TICKET_COLUMNS = `t.id, t.uuid, u.name, t.category, t.subject, t.status, t.created_at, t.updated_at, t.closed_at, t.player_read_id,
  (SELECT coalesce(max(m.id), 0) FROM ticket_messages m WHERE m.ticket = t.id AND m.from_team = 1) AS last_team_id,
  (SELECT m.from_team FROM ticket_messages m WHERE m.ticket = t.id ORDER BY m.id DESC LIMIT 1) AS last_from_team`;
const NEWS_COLUMNS = 'id, title, text, author_uuid, author_name, published, created_at, published_at, updated_at';
const ADDON_COLUMNS = 'id, hidden, downloads, created_at, owner, screenshots';
const SUBMISSION_COLUMNS = `s.id, s.uuid, u.name AS submitter_name, s.status, s.addon_id, s.version, s.name, s.summary, s.description,
  s.category, s.icon, s.platforms, s.notes, s.authors, s.api, s.size, s.sha256, s.inspection, s.screenshots, s.manifest,
  s.created_at, s.updated_at, s.submitted_at, s.reviewed_at, s.review_note, s.reviewer, s.reviewer_uuid, s.access, s.minecraft, s.loaders`;
const ADDON_REPORT_COLUMNS = 'id, addon, reporter, reporter_name, reason, note, at, status, done_at, done_by';
const ADDON_VERSION_COLUMNS = 'id, version, manifest, signature, file, size, sha256, published_at, published_by';
const COSMETIC_COLUMNS = 'id, slot, version, access, hidden, name, description, date, size, sha256, created_at, published_at, published_by';
const INVITE_COLUMNS = 'code, inviter, created_at, expires_at, server, voice_group, accepted';
const REFERRAL_COLUMNS = 'invitee, inviter, code, at, played_ms, confirmed';
const WORLD_COLUMNS = 'id, owner, code, name, access, max_players, default_role, created_at, last_online, version';
const WORLD_MEMBER_COLUMNS = 'name, uuid, role, added_at';
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
    worn: {
      head: String(row.cosmetic_head ?? ''),
      back: String(row.cosmetic_back ?? ''),
      aura: String(row.cosmetic_aura ?? ''),
      companion: String(row.cosmetic_companion ?? ''),
    },
    visible: Number(row.visible) === 1,
    presence: Number(row.presence) === 1,
    showServer: Number(row.show_server) === 1,
    messages: Number(row.messages) === 1,
    createdAt: Number(row.created_at),
    lastSeen: Number(row.last_seen),
    statusText: String(row.status_text ?? ''),
    dnd: Number(row.dnd) === 1,
    showLastOnline: row.show_last_online === undefined || Number(row.show_last_online) === 1,
    suggestable: Number(row.suggestable) === 1,
    showSuggestions: row.show_suggestions === undefined || Number(row.show_suggestions) === 1,
    onlineNotify: row.online_notify === 'favorites' || row.online_notify === 'none' ? row.online_notify : 'all',
    lastOnline: row.last_online === null || row.last_online === undefined ? null : Number(row.last_online),
  };
}

function toExtras(row: Row): FriendshipExtras {
  return { favorite: Number(row.favorite) === 1, nickname: String(row.nickname ?? ''), note: String(row.note ?? '') };
}

/** Karte aus der Spalte card (JSON); kaputt oder unbekannt: null. */
function toCard(value: unknown): MessageCard | null {
  const parsed = parseJson<Record<string, unknown> | null>(value, (p) => typeof p === 'object' && p !== null && !Array.isArray(p), null);
  if (parsed === null) return null;
  const { kind, target, title } = parsed;
  if (!(CARD_KINDS as readonly unknown[]).includes(kind) || typeof target !== 'string' || typeof title !== 'string') return null;
  return { kind: kind as CardKind, target, title };
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
    // Unbekannte Werte (z. B. aus einer neueren Version) gelten als Tester: so wenige Rechte wie möglich.
    role: isTeamRole(row.role) ? row.role : 'tester',
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

/** JSON aus einer Spalte; bei kaputtem Inhalt `fallback`. */
function parseJson<T>(value: unknown, check: (parsed: unknown) => boolean, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return check(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

const stringList = (value: unknown) => parseJson<string[]>(value, (p) => Array.isArray(p) && p.every((x) => typeof x === 'string'), []);

function isScreenshot(value: unknown): boolean {
  const s = value as Record<string, unknown> | null;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.file === 'string' &&
    (s.type === 'png' || s.type === 'jpeg') &&
    typeof s.width === 'number' &&
    typeof s.height === 'number' &&
    typeof s.size === 'number'
  );
}

const screenshotList = (value: unknown) => parseJson<AddonScreenshot[]>(value, (p) => Array.isArray(p) && p.every(isScreenshot), []);

function toAddon(row: Row): AddonRow {
  return {
    id: String(row.id),
    hidden: Number(row.hidden) === 1,
    downloads: Number(row.downloads),
    createdAt: Number(row.created_at),
    owner: nullableString(row.owner),
    screenshots: screenshotList(row.screenshots),
  };
}

const SUBMISSION_STATUSES: readonly SubmissionStatus[] = ['draft', 'pending', 'approved', 'rejected', 'withdrawn'];

/** Ergebnis der JAR-Prüfung; `expected` fehlt bei älteren Einreichungen (dann leer). */
function inspectionOf(value: unknown): SubmissionInspection | null {
  const parsed = parseJson<Record<string, unknown> | null>(
    value,
    (p) => typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).classes === 'number' && Array.isArray((p as Record<string, unknown>).uses),
    null,
  );
  if (parsed === null) return null;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  return { classes: parsed.classes as number, uses: strings(parsed.uses), expected: strings(parsed.expected) };
}

function toSubmission(row: Row): SubmissionRow {
  const status = String(row.status) as SubmissionStatus;
  return {
    id: String(row.id),
    uuid: String(row.uuid),
    submitterName: String(row.submitter_name ?? ''),
    status: SUBMISSION_STATUSES.includes(status) ? status : 'draft',
    addonId: nullableString(row.addon_id),
    version: nullableString(row.version),
    name: String(row.name),
    summary: String(row.summary),
    description: String(row.description),
    category: String(row.category),
    icon: String(row.icon),
    platforms: stringList(row.platforms),
    notes: stringList(row.notes),
    authors: stringList(row.authors),
    api: nullableNumber(row.api),
    size: nullableNumber(row.size),
    sha256: nullableString(row.sha256),
    inspection: inspectionOf(row.inspection),
    screenshots: screenshotList(row.screenshots),
    manifest: nullableString(row.manifest),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    submittedAt: nullableNumber(row.submitted_at),
    reviewedAt: nullableNumber(row.reviewed_at),
    reviewNote: nullableString(row.review_note),
    reviewer: nullableString(row.reviewer),
    reviewerUuid: nullableString(row.reviewer_uuid),
    access: row.access === 'minecraft' ? 'minecraft' : row.access === 'api' ? 'api' : null,
    minecraft: stringList(row.minecraft),
    loaders: stringList(row.loaders),
  };
}

function toAddonReport(row: Row): AddonReportRow {
  return {
    id: Number(row.id),
    addon: String(row.addon),
    reporter: String(row.reporter),
    reporterName: String(row.reporter_name),
    reason: String(row.reason),
    note: String(row.note),
    at: Number(row.at),
    status: row.status === 'done' ? 'done' : 'open',
    doneAt: nullableNumber(row.done_at),
    doneBy: nullableString(row.done_by),
  };
}

function toAddonVersion(row: Row): AddonVersionRow {
  return {
    id: String(row.id),
    version: String(row.version),
    manifest: String(row.manifest),
    signature: String(row.signature),
    file: String(row.file),
    size: Number(row.size),
    sha256: String(row.sha256),
    publishedAt: Number(row.published_at),
    publishedBy: nullableString(row.published_by),
  };
}

function toCosmeticInfo(row: Row): CosmeticInfoRow {
  return {
    id: String(row.id),
    slot: String(row.slot),
    version: Number(row.version),
    access: String(row.access),
    hidden: Number(row.hidden) === 1,
    name: String(row.name),
    description: String(row.description),
    date: String(row.date),
    size: Number(row.size),
    sha256: String(row.sha256),
    createdAt: Number(row.created_at),
    publishedAt: Number(row.published_at),
    publishedBy: nullableString(row.published_by),
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
    replyTo: row.reply_to === null || row.reply_to === undefined ? null : Number(row.reply_to),
    card: toCard(row.card),
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
    kind: row.kind === 'voice' ? 'voice' : 'chat',
  };
}

function toBan(row: Row): BanRow {
  return { uuid: String(row.uuid), name: String(row.name), reason: String(row.reason), at: Number(row.at), by: nullableString(row.by_name) };
}

function toWorldAccess(value: unknown): WorldAccess {
  return value === 'friends' || value === 'open' ? value : 'invited';
}

function toWorldRole(value: unknown): WorldRole {
  return value === 'visitor' || value === 'operator' ? value : 'player';
}

function toWorld(row: Row): WorldRow {
  return {
    id: String(row.id),
    owner: String(row.owner),
    code: String(row.code),
    name: String(row.name),
    access: toWorldAccess(row.access),
    maxPlayers: Number(row.max_players),
    defaultRole: toWorldRole(row.default_role),
    createdAt: Number(row.created_at),
    lastOnline: nullableNumber(row.last_online),
    version: nullableString(row.version),
  };
}

function toWorldMember(row: Row): WorldMemberRow {
  return { name: String(row.name), uuid: nullableString(row.uuid), role: toWorldRole(row.role), addedAt: Number(row.added_at) };
}

function toInvite(row: Row): InviteRow {
  return {
    code: String(row.code),
    inviter: String(row.inviter),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    server: nullableString(row.server),
    voiceGroup: nullableString(row.voice_group),
    accepted: Number(row.accepted),
  };
}

function toReferral(row: Row): ReferralRow {
  return {
    invitee: String(row.invitee),
    inviter: nullableString(row.inviter),
    code: nullableString(row.code),
    at: Number(row.at),
    playedMs: Number(row.played_ms),
    confirmed: nullableNumber(row.confirmed),
  };
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
        messages = coalesce(?, messages),
        status_text = coalesce(?, status_text),
        dnd = coalesce(?, dnd),
        show_last_online = coalesce(?, show_last_online),
        suggestable = coalesce(?, suggestable),
        show_suggestions = coalesce(?, show_suggestions),
        online_notify = coalesce(?, online_notify)
      WHERE uuid = ?`),
    setLastOnline: db.prepare('UPDATE users SET last_online = ? WHERE uuid = ?'),

    insertToken: db.prepare('INSERT INTO tokens (hash, uuid, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    findToken: db.prepare('SELECT uuid FROM tokens WHERE hash = ? AND expires_at > ?'),
    trimTokens: db.prepare(`
      DELETE FROM tokens WHERE uuid = ? AND hash NOT IN (
        SELECT hash FROM tokens WHERE uuid = ? ORDER BY created_at DESC LIMIT ?)`),
    deleteExpiredTokens: db.prepare('DELETE FROM tokens WHERE expires_at <= ?'),
    tokensOf: db.prepare('SELECT created_at, expires_at FROM tokens WHERE uuid = ? ORDER BY created_at'),

    listFriends: db.prepare(`
      SELECT ${USER_COLUMNS}, f.since, f.favorite, f.nickname, f.note FROM friendships f JOIN users u ON u.uuid = f.friend
      WHERE f.uuid = ? ORDER BY u.name_lower`),
    listFriendIds: db.prepare('SELECT friend, since FROM friendships WHERE uuid = ?'),
    // Wer den Spieler als Freund hat, mit seinen eigenen Angaben dazu
    friendViewers: db.prepare('SELECT uuid, since, favorite, nickname, note FROM friendships WHERE friend = ?'),
    friendship: db.prepare('SELECT since, favorite, nickname, note FROM friendships WHERE uuid = ? AND friend = ?'),
    updateFriendship: db.prepare(`
      UPDATE friendships SET favorite = coalesce(?, favorite), nickname = coalesce(?, nickname), note = coalesce(?, note)
      WHERE uuid = ? AND friend = ?`),
    // Gemeinsame Freunde von a und b
    mutualFriends: db.prepare(`
      SELECT u.uuid, u.name FROM friendships f1 JOIN friendships f2 ON f2.friend = f1.friend AND f2.uuid = ?
      JOIN users u ON u.uuid = f1.friend WHERE f1.uuid = ? ORDER BY u.name_lower`),
    // Freunde von Freunden, die in Vorschlägen erscheinen wollen; ohne Freunde, offene Anfragen und Blockierungen
    suggestions: db.prepare(`
      SELECT u.uuid, u.name, count(*) AS mutual FROM friendships f1
      JOIN friendships f2 ON f2.uuid = f1.friend
      JOIN users u ON u.uuid = f2.friend
      WHERE f1.uuid = ? AND u.uuid <> ? AND u.suggestable = 1
        AND NOT EXISTS (SELECT 1 FROM friendships x WHERE x.uuid = ? AND x.friend = u.uuid)
        AND NOT EXISTS (SELECT 1 FROM requests r WHERE (r.from_uuid = ? AND r.to_uuid = u.uuid) OR (r.from_uuid = u.uuid AND r.to_uuid = ?))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ? AND b.blocked = u.uuid) OR (b.blocker = u.uuid AND b.blocked = ?))
      GROUP BY u.uuid ORDER BY mutual DESC, u.name_lower LIMIT ?`),
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
    insertMessage: db.prepare('INSERT INTO messages (conv, from_uuid, to_uuid, text, at, reply_to, card) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    getMessage: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.id = ?`),
    messagesIn: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.id IN (SELECT value FROM json_each(?))`),
    deleteOwnMessage: db.prepare('DELETE FROM messages WHERE id = ? AND from_uuid = ?'),
    setReaction: db.prepare(`
      INSERT INTO message_reactions (message, uuid, reaction, at) VALUES (?, ?, ?, ?)
      ON CONFLICT (message, uuid) DO UPDATE SET reaction = excluded.reaction, at = excluded.at`),
    deleteReaction: db.prepare('DELETE FROM message_reactions WHERE message = ? AND uuid = ?'),
    reactionsIn: db.prepare('SELECT message, uuid, reaction FROM message_reactions WHERE message IN (SELECT value FROM json_each(?)) ORDER BY at'),
    reactionsBy: db.prepare('SELECT message, reaction, at FROM message_reactions WHERE uuid = ? ORDER BY message'),
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
    // Grenzen für Meldungen aus Freundesliste und Chat; Voice-Meldungen haben eigene (voice-moderation.ts)
    reportsSince: db.prepare("SELECT count(*) AS n, min(at) AS oldest FROM reports WHERE reporter = ? AND at > ? AND kind = 'chat'"),
    pairReportSince: db.prepare("SELECT max(at) AS last FROM reports WHERE reporter = ? AND reported = ? AND at > ? AND kind = 'chat'"),
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
    webSessionAlive: db.prepare('SELECT 1 AS x FROM web_sessions WHERE id = ? AND expires_at > ? AND last_used_at > ?'),
    touchWebSession: db.prepare('UPDATE web_sessions SET last_used_at = ? WHERE id = ?'),
    verifyWebSession: db.prepare('UPDATE web_sessions SET verified_at = ? WHERE id = ?'),
    unverifyWebSessionsOf: db.prepare('UPDATE web_sessions SET verified_at = 0 WHERE uuid = ?'),
    listWebSessions: db.prepare(`
      SELECT ${SESSION_COLUMNS} FROM web_sessions WHERE uuid = ? AND expires_at > ? AND last_used_at > ? ORDER BY last_used_at DESC`),
    deleteWebSession: db.prepare('DELETE FROM web_sessions WHERE uuid = ? AND id = ?'),
    deleteExpiredWebSessions: db.prepare('DELETE FROM web_sessions WHERE expires_at <= ? OR last_used_at <= ?'),

    // Team
    getTeamMember: db.prepare(`SELECT ${TEAM_COLUMNS} FROM team t JOIN users u ON u.uuid = t.uuid WHERE t.uuid = ?`),
    listTeam: db.prepare(`SELECT ${TEAM_COLUMNS} FROM team t JOIN users u ON u.uuid = t.uuid ORDER BY ${ROLE_ORDER}, u.name_lower`),
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
      ORDER BY ${ROLE_ORDER}, u.name_lower`),
    isPublicTeamMember: db.prepare('SELECT 1 AS x FROM team WHERE uuid = ? AND public = 1'),
    publicTeamUuids: db.prepare('SELECT uuid FROM team WHERE public = 1'),
    publicTeamRolesIn: db.prepare('SELECT uuid, role FROM team WHERE public = 1 AND uuid IN (SELECT value FROM json_each(?))'),

    // Community-Abzeichen
    getCommunityBadge: db.prepare(`
      SELECT b.uuid, u.name, b.badge, b.added_at, b.added_by FROM community_badges b JOIN users u ON u.uuid = b.uuid WHERE b.uuid = ?`),
    listCommunityBadges: db.prepare(`
      SELECT b.uuid, u.name, b.badge, b.added_at, b.added_by FROM community_badges b JOIN users u ON u.uuid = b.uuid
      ORDER BY b.badge, u.name_lower`),
    setCommunityBadge: db.prepare(`
      INSERT INTO community_badges (uuid, badge, added_at, added_by) VALUES (?, ?, ?, ?)
      ON CONFLICT (uuid) DO UPDATE SET badge = excluded.badge, added_at = excluded.added_at, added_by = excluded.added_by`),
    deleteCommunityBadge: db.prepare('DELETE FROM community_badges WHERE uuid = ?'),
    communityBadgesIn: db.prepare('SELECT uuid, badge FROM community_badges WHERE uuid IN (SELECT value FROM json_each(?))'),

    // Kennzahlen für die Übersicht des Teams
    countOpenReports: db.prepare("SELECT count(*) AS n FROM reports WHERE status = 'open'"),
    countWaitingTickets: db.prepare("SELECT count(*) AS n FROM tickets WHERE status = 'open'"),

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
    insertTicketAttachment: db.prepare('INSERT INTO ticket_attachments (ticket, uuid, name, size, data, at) VALUES (?, ?, ?, ?, ?, ?)'),
    reopenTicket: db.prepare("UPDATE tickets SET status = 'open', updated_at = ? WHERE id = ? AND status <> 'closed'"),
    ticketAttachments: db.prepare('SELECT id, name, size, at FROM ticket_attachments WHERE ticket = ? ORDER BY id'),
    ticketAttachment: db.prepare('SELECT id, name, size, at, data FROM ticket_attachments WHERE ticket = ? AND id = ?'),
    countTicketAttachments: db.prepare('SELECT count(*) AS n FROM ticket_attachments WHERE ticket = ?'),
    attachmentsSince: db.prepare('SELECT count(*) AS n, min(at) AS oldest FROM ticket_attachments WHERE uuid = ? AND at > ?'),

    // Versionsverlauf des Launchers
    recordVersion: db.prepare('INSERT OR IGNORE INTO launcher_versions (version, date, notes, published_at) VALUES (?, ?, ?, ?)'),
    listVersions: db.prepare('SELECT version, date, notes, published_at FROM launcher_versions ORDER BY published_at DESC, version DESC LIMIT ?'),

    // Addon-Store
    listAddons: db.prepare(`SELECT ${ADDON_COLUMNS} FROM addons ORDER BY id`),
    getAddon: db.prepare(`SELECT ${ADDON_COLUMNS} FROM addons WHERE id = ?`),
    addonsOwnedBy: db.prepare(`SELECT ${ADDON_COLUMNS} FROM addons WHERE owner = ? ORDER BY id`),
    insertAddon: db.prepare('INSERT OR IGNORE INTO addons (id, created_at, owner) VALUES (?, ?, ?)'),
    setAddonScreenshots: db.prepare('UPDATE addons SET screenshots = ? WHERE id = ?'),
    forgetAddonOwner: db.prepare('UPDATE addons SET owner = ? WHERE owner = ?'),

    // Bewertungen
    setAddonRating: db.prepare(`
      INSERT INTO addon_ratings (addon, uuid, stars, at) VALUES (?, ?, ?, ?)
      ON CONFLICT (addon, uuid) DO UPDATE SET stars = excluded.stars, at = excluded.at`),
    getAddonRating: db.prepare('SELECT stars FROM addon_ratings WHERE addon = ? AND uuid = ?'),
    deleteAddonRating: db.prepare('DELETE FROM addon_ratings WHERE addon = ? AND uuid = ?'),
    addonRatingSummary: db.prepare('SELECT avg(stars) AS average, count(*) AS n FROM addon_ratings WHERE addon = ?'),
    allAddonRatings: db.prepare('SELECT addon, avg(stars) AS average, count(*) AS n FROM addon_ratings GROUP BY addon'),
    addonRatingsBy: db.prepare('SELECT addon, stars, at FROM addon_ratings WHERE uuid = ? ORDER BY addon'),

    // Meldungen zu Addons
    insertAddonReport: db.prepare(`
      INSERT INTO addon_reports (addon, reporter, reporter_name, reason, note, at) VALUES (?, ?, ?, ?, ?, ?)`),
    openAddonReportOf: db.prepare("SELECT id FROM addon_reports WHERE reporter = ? AND addon = ? AND status = 'open' LIMIT 1"),
    addonReportsSince: db.prepare('SELECT count(*) AS n, min(at) AS oldest FROM addon_reports WHERE reporter = ? AND at > ?'),
    listAddonReports: db.prepare(`SELECT ${ADDON_REPORT_COLUMNS} FROM addon_reports WHERE status IN (SELECT value FROM json_each(?)) ORDER BY id DESC`),
    getAddonReport: db.prepare(`SELECT ${ADDON_REPORT_COLUMNS} FROM addon_reports WHERE id = ?`),
    markAddonReportDone: db.prepare("UPDATE addon_reports SET status = 'done', done_at = ?, done_by = ? WHERE id = ? AND status = 'open'"),
    countOpenAddonReports: db.prepare("SELECT count(*) AS n FROM addon_reports WHERE status = 'open'"),
    addonReportsBy: db.prepare(`SELECT ${ADDON_REPORT_COLUMNS} FROM addon_reports WHERE reporter = ? ORDER BY id DESC`),
    deleteAddonReportsBy: db.prepare('DELETE FROM addon_reports WHERE reporter = ?'),
    deleteOldAddonReports: db.prepare('DELETE FROM addon_reports WHERE at < ?'),

    // Einreichungen
    insertSubmission: db.prepare(`
      INSERT INTO addon_submissions (id, uuid, status, name, summary, description, category, icon, platforms, notes, created_at, updated_at)
      VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    saveSubmission: db.prepare(`
      UPDATE addon_submissions SET status = ?, addon_id = ?, version = ?, name = ?, summary = ?, description = ?, category = ?,
        icon = ?, platforms = ?, notes = ?, authors = ?, api = ?, size = ?, sha256 = ?, inspection = ?, screenshots = ?,
        manifest = ?, updated_at = ?, submitted_at = ?, reviewed_at = ?, review_note = ?, reviewer = ?,
        reviewer_uuid = ?, access = ?, minecraft = ?, loaders = ?
      WHERE id = ?`),
    getSubmission: db.prepare(`SELECT ${SUBMISSION_COLUMNS} FROM addon_submissions s JOIN users u ON u.uuid = s.uuid WHERE s.id = ?`),
    submissionsOf: db.prepare(`
      SELECT ${SUBMISSION_COLUMNS} FROM addon_submissions s JOIN users u ON u.uuid = s.uuid WHERE s.uuid = ? ORDER BY s.created_at DESC, s.id`),
    submissionsIn: db.prepare(`
      SELECT ${SUBMISSION_COLUMNS} FROM addon_submissions s JOIN users u ON u.uuid = s.uuid
      WHERE s.status IN (SELECT value FROM json_each(?)) ORDER BY coalesce(s.submitted_at, s.created_at) DESC, s.id`),
    pendingSubmissionsFor: db.prepare(`
      SELECT ${SUBMISSION_COLUMNS} FROM addon_submissions s JOIN users u ON u.uuid = s.uuid WHERE s.addon_id = ? AND s.status = 'pending'`),
    countSubmissionsWith: db.prepare('SELECT count(*) AS n FROM addon_submissions WHERE uuid = ? AND status = ?'),
    countPendingSubmissions: db.prepare("SELECT count(*) AS n FROM addon_submissions WHERE status = 'pending'"),
    deleteSubmission: db.prepare('DELETE FROM addon_submissions WHERE id = ?'),
    deleteOldSubmissions: db.prepare("DELETE FROM addon_submissions WHERE status IN ('rejected', 'withdrawn') AND updated_at < ?"),
    submissionIds: db.prepare('SELECT id FROM addon_submissions'),
    setAddonHidden: db.prepare('UPDATE addons SET hidden = ? WHERE id = ? AND hidden <> ?'),
    countAddonDownload: db.prepare('UPDATE addons SET downloads = downloads + 1 WHERE id = ?'),
    deleteAddon: db.prepare('DELETE FROM addons WHERE id = ?'),
    countVisibleAddons: db.prepare(
      'SELECT count(*) AS n FROM addons a WHERE a.hidden = 0 AND EXISTS (SELECT 1 FROM addon_versions v WHERE v.id = a.id)',
    ),
    visibleAddonOwnersIn: db.prepare(`
      SELECT DISTINCT a.owner AS owner FROM addons a
      WHERE a.hidden = 0 AND a.owner IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM addon_versions v WHERE v.id = a.id)`),
    insertAddonVersion: db.prepare(`
      INSERT INTO addon_versions (id, version, manifest, signature, file, size, sha256, published_at, published_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    addonVersionsOf: db.prepare(`SELECT ${ADDON_VERSION_COLUMNS} FROM addon_versions WHERE id = ?`),
    allAddonVersions: db.prepare(`SELECT ${ADDON_VERSION_COLUMNS} FROM addon_versions`),
    getAddonVersion: db.prepare(`SELECT ${ADDON_VERSION_COLUMNS} FROM addon_versions WHERE id = ? AND version = ?`),
    addonVersionByFile: db.prepare(`SELECT ${ADDON_VERSION_COLUMNS} FROM addon_versions WHERE file = ?`),
    deleteAddonVersion: db.prepare('DELETE FROM addon_versions WHERE id = ? AND version = ?'),
    countAddonVersions: db.prepare('SELECT count(*) AS n FROM addon_versions WHERE id = ?'),

    // Cosmetics
    cosmeticInfos: db.prepare(`SELECT ${COSMETIC_COLUMNS} FROM cosmetics ORDER BY id`),
    getCosmeticInfo: db.prepare(`SELECT ${COSMETIC_COLUMNS} FROM cosmetics WHERE id = ?`),
    getCosmetic: db.prepare(`SELECT ${COSMETIC_COLUMNS}, signature, manifest FROM cosmetics WHERE id = ?`),
    // Neue Version: alles außer hidden und created_at
    upsertCosmetic: db.prepare(`
      INSERT INTO cosmetics (id, slot, version, access, name, description, date, size, sha256, created_at, published_at, published_by, signature, manifest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        slot = excluded.slot, version = excluded.version, access = excluded.access, name = excluded.name,
        description = excluded.description, date = excluded.date, size = excluded.size, sha256 = excluded.sha256,
        published_at = excluded.published_at, published_by = excluded.published_by, signature = excluded.signature,
        manifest = excluded.manifest`),
    setCosmeticHidden: db.prepare('UPDATE cosmetics SET hidden = ? WHERE id = ? AND hidden <> ?'),
    deleteCosmetic: db.prepare('DELETE FROM cosmetics WHERE id = ?'),
    countVisibleCosmetics: db.prepare('SELECT count(*) AS n FROM cosmetics WHERE hidden = 0'),
    // Träger je gewählter ID und Slot (beim Cape auch eingebaute IDs; die fallen beim Abgleich weg)
    cosmeticWearers: db.prepare(`
      SELECT 'head' AS slot, cosmetic_head AS id, count(*) AS n FROM users WHERE cosmetic_head <> '' GROUP BY cosmetic_head
      UNION ALL SELECT 'back', cosmetic_back, count(*) FROM users WHERE cosmetic_back <> '' GROUP BY cosmetic_back
      UNION ALL SELECT 'aura', cosmetic_aura, count(*) FROM users WHERE cosmetic_aura <> '' GROUP BY cosmetic_aura
      UNION ALL SELECT 'companion', cosmetic_companion, count(*) FROM users WHERE cosmetic_companion <> '' GROUP BY cosmetic_companion
      UNION ALL SELECT 'cape', cape, count(*) FROM users WHERE cape <> '' GROUP BY cape`),
    setWornHead: db.prepare('UPDATE users SET cosmetic_head = ? WHERE uuid = ?'),
    setWornBack: db.prepare('UPDATE users SET cosmetic_back = ? WHERE uuid = ?'),
    setWornAura: db.prepare('UPDATE users SET cosmetic_aura = ? WHERE uuid = ?'),
    setWornCompanion: db.prepare('UPDATE users SET cosmetic_companion = ? WHERE uuid = ?'),
    setWornCape: db.prepare('UPDATE users SET cape = ? WHERE uuid = ?'),
    resetWornHead: db.prepare("UPDATE users SET cosmetic_head = '' WHERE cosmetic_head = ?"),
    resetWornBack: db.prepare("UPDATE users SET cosmetic_back = '' WHERE cosmetic_back = ?"),
    resetWornAura: db.prepare("UPDATE users SET cosmetic_aura = '' WHERE cosmetic_aura = ?"),
    resetWornCompanion: db.prepare("UPDATE users SET cosmetic_companion = '' WHERE cosmetic_companion = ?"),
    resetWornCape: db.prepare("UPDATE users SET cape = '' WHERE cape = ?"),
    teamMembersIn: db.prepare('SELECT uuid FROM team WHERE uuid IN (SELECT value FROM json_each(?))'),

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
    // Wer über den Spieler dazukam, zählt danach für niemanden (inviter per Fremdschlüssel NULL); den Code vergessen.
    forgetReferralCode: db.prepare('UPDATE referrals SET code = NULL WHERE inviter = ?'),
    // In Welten anderer bleibt der Name (deren Liste), die Verbindung zum Konto fällt weg.
    forgetWorldMemberUuid: db.prepare('UPDATE world_members SET uuid = NULL WHERE uuid = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE uuid = ?'),

    // Einladungen
    insertInvite: db.prepare(`INSERT INTO invites (${INVITE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 0)`),
    getInvite: db.prepare(`SELECT ${INVITE_COLUMNS} FROM invites WHERE code = ?`),
    // Gleicher Einladender, Server und Gruppe (IS vergleicht auch NULL), die am längsten gültige zuerst
    reusableInvite: db.prepare(`
      SELECT ${INVITE_COLUMNS} FROM invites WHERE inviter = ? AND server IS ? AND voice_group IS ? AND expires_at > ?
      ORDER BY expires_at DESC LIMIT 1`),
    openInvitesOf: db.prepare(`SELECT ${INVITE_COLUMNS} FROM invites WHERE inviter = ? AND expires_at > ? ORDER BY created_at DESC, code`),
    allInvitesOf: db.prepare(`SELECT ${INVITE_COLUMNS} FROM invites WHERE inviter = ? ORDER BY created_at DESC, code`),
    deleteInvite: db.prepare('DELETE FROM invites WHERE code = ? AND inviter = ?'),
    deleteInviteByCode: db.prepare('DELETE FROM invites WHERE code = ?'),
    deleteExpiredInvites: db.prepare('DELETE FROM invites WHERE expires_at <= ?'),
    countAccept: db.prepare('UPDATE invites SET accepted = accepted + 1 WHERE code = ?'),
    getReferral: db.prepare(`SELECT ${REFERRAL_COLUMNS} FROM referrals WHERE invitee = ?`),
    insertReferral: db.prepare('INSERT OR IGNORE INTO referrals (invitee, inviter, code, at) VALUES (?, ?, ?, ?)'),
    pendingPlayTime: db.prepare('SELECT played_ms FROM referrals WHERE invitee = ? AND confirmed IS NULL AND inviter IS NOT NULL'),
    addPlayTime: db.prepare(`
      UPDATE referrals SET played_ms = played_ms + ? WHERE invitee = ? AND confirmed IS NULL AND inviter IS NOT NULL
      RETURNING played_ms`),
    confirmReferral: db.prepare('UPDATE referrals SET confirmed = ? WHERE invitee = ? AND confirmed IS NULL AND inviter IS NOT NULL'),
    referralCounts: db.prepare('SELECT count(*) AS invited, count(confirmed) AS confirmed FROM referrals WHERE inviter = ?'),
    referralsBy: db.prepare('SELECT at, confirmed FROM referrals WHERE inviter = ? ORDER BY at'),
    addUnlock: db.prepare('INSERT OR IGNORE INTO unlocks (uuid, cosmetic, reason, at) VALUES (?, ?, ?, ?)'),
    hasUnlock: db.prepare('SELECT 1 AS x FROM unlocks WHERE uuid = ? AND cosmetic = ?'),
    unlocksOf: db.prepare('SELECT cosmetic, reason, at FROM unlocks WHERE uuid = ? ORDER BY at, cosmetic'),
    unlocksIn: db.prepare('SELECT uuid, cosmetic FROM unlocks WHERE uuid IN (SELECT value FROM json_each(?))'),

    // Welt teilen
    insertWorld: db.prepare(`INSERT INTO worlds (${WORLD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`),
    getWorld: db.prepare(`SELECT ${WORLD_COLUMNS} FROM worlds WHERE id = ?`),
    getWorldByCode: db.prepare(`SELECT ${WORLD_COLUMNS} FROM worlds WHERE code = ?`),
    worldsOf: db.prepare(`SELECT ${WORLD_COLUMNS} FROM worlds WHERE owner = ? ORDER BY created_at, id`),
    countWorlds: db.prepare('SELECT count(*) AS n FROM worlds WHERE owner = ?'),
    updateWorld: db.prepare(`
      UPDATE worlds SET name = coalesce(?, name), access = coalesce(?, access), max_players = coalesce(?, max_players),
        default_role = coalesce(?, default_role) WHERE id = ?`),
    setWorldOnline: db.prepare('UPDATE worlds SET last_online = ?, version = coalesce(?, version) WHERE id = ?'),
    deleteWorld: db.prepare('DELETE FROM worlds WHERE id = ? AND owner = ?'),
    worldMembers: db.prepare(`SELECT ${WORLD_MEMBER_COLUMNS} FROM world_members WHERE world = ? ORDER BY name_lower`),
    getWorldMember: db.prepare(`SELECT ${WORLD_MEMBER_COLUMNS} FROM world_members WHERE world = ? AND name_lower = ?`),
    countWorldMembers: db.prepare('SELECT count(*) AS n FROM world_members WHERE world = ?'),
    // Neu: mit Rolle und UUID; vorhanden: Rolle und (wenn jetzt bekannt) UUID ändern, Schreibweise des Namens übernehmen
    putWorldMember: db.prepare(`
      INSERT INTO world_members (world, name, name_lower, uuid, role, added_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (world, name_lower) DO UPDATE SET name = excluded.name, role = excluded.role,
        uuid = coalesce(excluded.uuid, uuid)`),
    // Einladen: nur neu anlegen, eine vorhandene Rolle bleibt
    addWorldMember: db.prepare(`
      INSERT INTO world_members (world, name, name_lower, uuid, role, added_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (world, name_lower) DO UPDATE SET uuid = coalesce(excluded.uuid, uuid)`),
    deleteWorldMember: db.prepare('DELETE FROM world_members WHERE world = ? AND name_lower = ?'),
    // Zugang im Relay (nur der Name aus Login Start): Name auf der Liste, oder ein Mitglied mit UUID heißt jetzt so
    worldMemberNamed: db.prepare(`
      SELECT 1 AS x FROM world_members m WHERE m.world = ? AND (m.name_lower = ?
        OR (m.uuid IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.uuid = m.uuid AND u.name_lower = ?))) LIMIT 1`),
    // Welten, in denen ein Spieler Mitglied ist: über die UUID, ohne UUID über den Namen
    worldIdsWithMember: db.prepare(`
      SELECT DISTINCT world FROM world_members WHERE uuid = ? OR (uuid IS NULL AND name_lower = ?)`),
    worldMembershipsOf: db.prepare(`
      SELECT w.id AS world, w.name AS world_name, w.owner, u.name AS owner_name, m.name, m.role, m.added_at
      FROM world_members m JOIN worlds w ON w.id = m.world JOIN users u ON u.uuid = w.owner
      WHERE w.owner <> ? AND (m.uuid = ? OR (m.uuid IS NULL AND m.name_lower = ?)) ORDER BY m.added_at, w.id`),
    // Freund des Besitzers, der gerade so heißt (Zugang „Freunde“)
    friendNamed: db.prepare(`
      SELECT 1 AS x FROM friendships f JOIN users u ON u.uuid = f.friend WHERE f.uuid = ? AND u.name_lower = ? LIMIT 1`),
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

  /**
   * Eigene vorbereitete Abfrage auf derselben Datenbank (ab 1.13.0 für Teil-Speicher wie hosting/store.ts, discover.ts
   * und plus.ts, damit nicht alles in dieser Datei steht). Nur nach der Migration (also im Konstruktor fertig) benutzen.
   */
  prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
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
      patch.statusText ?? null,
      bool(patch.dnd),
      bool(patch.showLastOnline),
      bool(patch.suggestable),
      bool(patch.showSuggestions),
      patch.onlineNotify ?? null,
      uuid,
    );
  }

  /** Ende der letzten Verbindung aus dem Spiel merken („zuletzt online“). */
  setLastOnline(uuids: readonly string[], now: number): void {
    if (uuids.length === 0) return;
    this.transaction(() => {
      for (const uuid of uuids) this.sql.setLastOnline.run(now, uuid);
    });
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
   * (in beide Richtungen), der Team-Mitgliedschaft, den Meldungen, die er gemacht hat (auch zu Addons), seinen
   * Addon-Einreichungen und Bewertungen. Meldungen über ihn, das Protokoll und eine Sperre bleiben; seine Neuigkeiten
   * behalten nur den Namen, seine veröffentlichten Addons bleiben (Besitzer `DELETED_OWNER`).
   * Liefert die UUIDs der Spieler, deren Freundesliste oder Anfragen sich dadurch ändern.
   */
  deleteUser(uuid: string): string[] {
    const related = this.transaction(() => {
      this.sql.deleteReportsBy.run(uuid);
      this.sql.deleteAddonReportsBy.run(uuid);
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
    // Eigene Addons bleiben veröffentlicht (signiert), die ID bleibt vergeben, aber ohne UUID als Besitzer.
    this.sql.forgetAddonOwner.run(DELETED_OWNER, uuid);
    this.sql.forgetReferralCode.run(uuid);
    this.sql.forgetWorldMemberUuid.run(uuid);
    // Bewertungen, Einreichungen, Einladungen, Freischaltungen, wie der Spieler selbst eingeladen wurde und seine Welten
    // (mit Mitgliedern) gehen mit dem Konto (Fremdschlüssel); wer über ihn dazukam, zählt danach für niemanden mehr.
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
    return (this.sql.listFriends.all(uuid) as Row[]).map((row) => ({ user: toUser(row), since: Number(row.since), ...toExtras(row) }));
  }

  /** Alle, die `friend` als Freund haben, mit ihren eigenen Angaben zu ihm. */
  friendViewers(friend: string): FriendViewerRow[] {
    return (this.sql.friendViewers.all(friend) as Row[]).map((row) => ({ uuid: String(row.uuid), since: Number(row.since), ...toExtras(row) }));
  }

  /** Die Freundschaft aus Sicht von `owner` (seit wann, eigene Angaben) oder undefined. */
  friendship(owner: string, friend: string): (FriendshipExtras & { since: number }) | undefined {
    const row = this.sql.friendship.get(owner, friend) as Row | undefined;
    return row ? { since: Number(row.since), ...toExtras(row) } : undefined;
  }

  /** Eigene Angaben zu einem Freund ändern (nur die Zeile von `owner`). false, wenn es die Freundschaft nicht gibt. */
  updateFriendship(owner: string, friend: string, patch: FriendshipPatch): boolean {
    const favorite = patch.favorite === undefined ? null : patch.favorite ? 1 : 0;
    return Number(this.sql.updateFriendship.run(favorite, patch.nickname ?? null, patch.note ?? null, owner, friend).changes) > 0;
  }

  /** Gemeinsame Freunde von a und b, nach Namen sortiert. */
  mutualFriends(a: string, b: string): { uuid: string; name: string }[] {
    return (this.sql.mutualFriends.all(b, a) as Row[]).map((row) => ({ uuid: String(row.uuid), name: String(row.name) }));
  }

  /** Vorschläge „Freunde von Freunden“ für `uuid` (nur Spieler mit `suggestable`), meiste gemeinsame zuerst. */
  suggestions(uuid: string, limit: number): SuggestionRow[] {
    return (this.sql.suggestions.all(uuid, uuid, uuid, uuid, uuid, uuid, uuid, limit) as Row[]).map((row) => ({
      uuid: String(row.uuid),
      name: String(row.name),
      mutual: Number(row.mutual),
    }));
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
  insertMessage(
    from: string,
    to: string,
    text: string,
    now: number,
    keep: number,
    extra: { replyTo?: number | null; card?: MessageCard | null } = {},
  ): MessageRow {
    return this.transaction(() => {
      const conv = conversationKey(from, to);
      const card = extra.card ? JSON.stringify({ kind: extra.card.kind, target: extra.card.target, title: extra.card.title }) : null;
      const id = Number(this.sql.insertMessage.run(conv, from, to, text, now, extra.replyTo ?? null, card).lastInsertRowid);
      this.sql.trimConversation.run(conv, conv, keep);
      return toMessage(this.sql.getMessage.get(id) as Row);
    });
  }

  getMessage(id: number): MessageRow | undefined {
    const row = this.sql.getMessage.get(id) as Row | undefined;
    return row ? toMessage(row) : undefined;
  }

  /** Mehrere Nachrichten nach ID (fehlende fallen weg). */
  messagesByIds(ids: readonly number[]): Map<number, MessageRow> {
    const map = new Map<number, MessageRow>();
    if (ids.length === 0) return map;
    for (const row of this.sql.messagesIn.all(JSON.stringify([...new Set(ids)])) as Row[]) {
      const message = toMessage(row);
      map.set(message.id, message);
    }
    return map;
  }

  /** Eigene Nachricht löschen (für beide; Reaktionen gehen mit). false, wenn sie nicht von `from` ist oder fehlt. */
  deleteOwnMessage(id: number, from: string): boolean {
    const removed = Number(this.sql.deleteOwnMessage.run(id, from).changes) > 0;
    if (removed) this.checkpoint();
    return removed;
  }

  /** Reaktion setzen oder ersetzen (eine je Spieler und Nachricht). */
  setReaction(message: number, uuid: string, reaction: string, now: number): void {
    this.sql.setReaction.run(message, uuid, reaction, now);
  }

  deleteReaction(message: number, uuid: string): boolean {
    return Number(this.sql.deleteReaction.run(message, uuid).changes) > 0;
  }

  /** Reaktionen je Nachricht: UUID → Reaktion. */
  reactionsFor(ids: readonly number[]): Map<number, Record<string, string>> {
    const map = new Map<number, Record<string, string>>();
    if (ids.length === 0) return map;
    for (const row of this.sql.reactionsIn.all(JSON.stringify([...new Set(ids)])) as Row[]) {
      const id = Number(row.message);
      let entry = map.get(id);
      if (!entry) {
        entry = {};
        map.set(id, entry);
      }
      entry[String(row.uuid)] = String(row.reaction);
    }
    return map;
  }

  /** Eigene Reaktionen (Datenauskunft). */
  reactionsBy(uuid: string): ReactionRow[] {
    return (this.sql.reactionsBy.all(uuid) as Row[]).map((row) => ({ message: Number(row.message), reaction: String(row.reaction), at: Number(row.at) }));
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

  /** Gibt es die Sitzung mit dieser ID noch (nicht abgelaufen, nach `idleCutoff` benutzt)? */
  webSessionAlive(id: string, now: number, idleCutoff: number): boolean {
    return this.sql.webSessionAlive.get(id, now, idleCutoff) !== undefined;
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

  /** Rollen der Team-Mitglieder unter `uuids`, die auf der öffentlichen Teamseite stehen (`public`); andere fehlen. */
  publicTeamRolesIn(uuids: string[]): Map<string, TeamRole> {
    if (uuids.length === 0) return new Map();
    const map = new Map<string, TeamRole>();
    for (const row of this.sql.publicTeamRolesIn.all(JSON.stringify(uuids)) as Row[]) {
      map.set(String(row.uuid), isTeamRole(row.role) ? row.role : 'tester');
    }
    return map;
  }

  // ---------- Community-Abzeichen ----------

  private toBadge(row: Row): CommunityBadgeRow | undefined {
    if (!isCommunityBadge(row.badge)) return undefined;
    return { uuid: String(row.uuid), name: String(row.name), badge: row.badge, addedAt: Number(row.added_at), addedBy: nullableString(row.added_by) };
  }

  getCommunityBadge(uuid: string): CommunityBadgeRow | undefined {
    const row = this.sql.getCommunityBadge.get(uuid) as Row | undefined;
    return row ? this.toBadge(row) : undefined;
  }

  listCommunityBadges(): CommunityBadgeRow[] {
    return (this.sql.listCommunityBadges.all() as Row[]).map((row) => this.toBadge(row)).filter((b): b is CommunityBadgeRow => b !== undefined);
  }

  /** Abzeichen vergeben oder ersetzen. Liefert, was vorher war (null = keins). */
  setCommunityBadge(uuid: string, badge: CommunityBadge, now: number, by: string | null): CommunityBadge | null {
    return this.transaction(() => {
      const before = this.getCommunityBadge(uuid)?.badge ?? null;
      this.sql.setCommunityBadge.run(uuid, badge, now, by);
      return before;
    });
  }

  deleteCommunityBadge(uuid: string): boolean {
    return Number(this.sql.deleteCommunityBadge.run(uuid).changes) > 0;
  }

  /** Community-Abzeichen mehrerer Spieler (Nachschlagen, Freundesliste). */
  communityBadgesIn(uuids: readonly string[]): Map<string, CommunityBadge> {
    const map = new Map<string, CommunityBadge>();
    if (uuids.length === 0) return map;
    for (const row of this.sql.communityBadgesIn.all(JSON.stringify(uuids)) as Row[]) {
      if (isCommunityBadge(row.badge)) map.set(String(row.uuid), row.badge);
    }
    return map;
  }

  /** Offene Meldungen (für die Übersicht des Teams). */
  countOpenReports(): number {
    return Number((this.sql.countOpenReports.get() as Row).n);
  }

  /** Support-Anfragen, die auf eine Antwort des Teams warten (Status open). */
  countWaitingTickets(): number {
    return Number((this.sql.countWaitingTickets.get() as Row).n);
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

  /**
   * Neuer Anhang (Inhalt schon gzip-komprimiert, `size` entpackt). Wie eine Nachricht des Spielers: Die Anfrage ist
   * danach wieder offen und gilt als aktiv.
   */
  addTicketAttachment(ticket: number, uuid: string, name: string, size: number, gzipped: Buffer, now: number): number {
    return this.transaction(() => {
      const id = Number(this.sql.insertTicketAttachment.run(ticket, uuid, name, size, gzipped, now).lastInsertRowid);
      this.sql.reopenTicket.run(now, ticket);
      return id;
    });
  }

  ticketAttachments(ticket: number): TicketAttachmentRow[] {
    return (this.sql.ticketAttachments.all(ticket) as Row[]).map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      size: Number(row.size),
      at: Number(row.at),
    }));
  }

  /** Anhang mit Inhalt (gzip), nur wenn er zu dieser Anfrage gehört. */
  ticketAttachment(ticket: number, id: number): (TicketAttachmentRow & { data: Buffer }) | undefined {
    const row = this.sql.ticketAttachment.get(ticket, id) as Row | undefined;
    if (!row) return undefined;
    return { id: Number(row.id), name: String(row.name), size: Number(row.size), at: Number(row.at), data: Buffer.from(row.data as Uint8Array) };
  }

  countTicketAttachments(ticket: number): number {
    return Number((this.sql.countTicketAttachments.get(ticket) as Row).n);
  }

  /** Anhänge eines Spielers nach `since`: Anzahl und Zeitpunkt des ältesten. */
  ticketAttachmentsSince(uuid: string, since: number): { count: number; oldest: number | null } {
    const row = this.sql.attachmentsSince.get(uuid, since) as Row;
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

  // ---------- Addon-Store ----------

  listAddons(): AddonRow[] {
    return (this.sql.listAddons.all() as Row[]).map(toAddon);
  }

  getAddon(id: string): AddonRow | undefined {
    const row = this.sql.getAddon.get(id) as Row | undefined;
    return row ? toAddon(row) : undefined;
  }

  /** Versionen eines Addons (ohne Reihenfolge; sortiert wird nach Version). */
  addonVersionsOf(id: string): AddonVersionRow[] {
    return (this.sql.addonVersionsOf.all(id) as Row[]).map(toAddonVersion);
  }

  allAddonVersions(): AddonVersionRow[] {
    return (this.sql.allAddonVersions.all() as Row[]).map(toAddonVersion);
  }

  getAddonVersion(id: string, version: string): AddonVersionRow | undefined {
    const row = this.sql.getAddonVersion.get(id, version) as Row | undefined;
    return row ? toAddonVersion(row) : undefined;
  }

  /** Version, zu der eine Datei gehört (jede Datei gehört zu höchstens einer). */
  addonVersionByFile(file: string): AddonVersionRow | undefined {
    const row = this.sql.addonVersionByFile.get(file) as Row | undefined;
    return row ? toAddonVersion(row) : undefined;
  }

  /** Addons eines Einreichers (auch versteckte). */
  addonsOwnedBy(uuid: string): AddonRow[] {
    return (this.sql.addonsOwnedBy.all(uuid) as Row[]).map(toAddon);
  }

  /** Neue Version; ein neues Addon wird dabei sichtbar angelegt, mit `owner` (null = Team). */
  insertAddonVersion(row: AddonVersionRow, owner: string | null = null): void {
    this.transaction(() => {
      this.sql.insertAddon.run(row.id, row.publishedAt, owner);
      this.sql.insertAddonVersion.run(row.id, row.version, row.manifest, row.signature, row.file, row.size, row.sha256, row.publishedAt, row.publishedBy);
    });
  }

  setAddonScreenshots(id: string, screenshots: AddonScreenshot[]): void {
    this.sql.setAddonScreenshots.run(JSON.stringify(screenshots), id);
  }

  // ---------- Bewertungen ----------

  /** Setzt oder ändert die Bewertung (1–5) eines Spielers. */
  setAddonRating(addon: string, uuid: string, stars: number, now: number): void {
    this.sql.setAddonRating.run(addon, uuid, stars, now);
  }

  getAddonRating(addon: string, uuid: string): number | null {
    const row = this.sql.getAddonRating.get(addon, uuid) as Row | undefined;
    return row ? Number(row.stars) : null;
  }

  deleteAddonRating(addon: string, uuid: string): boolean {
    return Number(this.sql.deleteAddonRating.run(addon, uuid).changes) > 0;
  }

  /** Durchschnitt (ungerundet, 0 ohne Bewertungen) und Anzahl. */
  addonRatingSummary(addon: string): { average: number; count: number } {
    const row = this.sql.addonRatingSummary.get(addon) as Row;
    return { average: Number(row.average ?? 0), count: Number(row.n) };
  }

  allAddonRatings(): Map<string, { average: number; count: number }> {
    const map = new Map<string, { average: number; count: number }>();
    for (const row of this.sql.allAddonRatings.all() as Row[]) map.set(String(row.addon), { average: Number(row.average), count: Number(row.n) });
    return map;
  }

  /** Bewertungen eines Spielers (Datenauskunft, eigene Sterne im Launcher). */
  addonRatingsBy(uuid: string): { addon: string; stars: number; at: number }[] {
    return (this.sql.addonRatingsBy.all(uuid) as Row[]).map((row) => ({ addon: String(row.addon), stars: Number(row.stars), at: Number(row.at) }));
  }

  // ---------- Meldungen zu Addons ----------

  insertAddonReport(report: Omit<AddonReportRow, 'id' | 'status' | 'doneAt' | 'doneBy'>): number {
    const result = this.sql.insertAddonReport.run(report.addon, report.reporter, report.reporterName, report.reason, report.note, report.at);
    return Number(result.lastInsertRowid);
  }

  /** Hat der Spieler schon eine offene Meldung zu diesem Addon? */
  hasOpenAddonReport(reporter: string, addon: string): boolean {
    return this.sql.openAddonReportOf.get(reporter, addon) !== undefined;
  }

  addonReportsSince(reporter: string, since: number): { count: number; oldest: number | null } {
    const row = this.sql.addonReportsSince.get(reporter, since) as Row;
    return { count: Number(row.n), oldest: nullableNumber(row.oldest) };
  }

  /** Meldungen mit dem Status, neueste zuerst. */
  listAddonReports(status: AddonReportStatus | 'all'): AddonReportRow[] {
    const statuses = status === 'all' ? ['open', 'done'] : [status];
    return (this.sql.listAddonReports.all(JSON.stringify(statuses)) as Row[]).map(toAddonReport);
  }

  getAddonReport(id: number): AddonReportRow | undefined {
    const row = this.sql.getAddonReport.get(id) as Row | undefined;
    return row ? toAddonReport(row) : undefined;
  }

  markAddonReportDone(id: number, now: number, by: string | null): boolean {
    return Number(this.sql.markAddonReportDone.run(now, by, id).changes) > 0;
  }

  countOpenAddonReports(): number {
    return Number((this.sql.countOpenAddonReports.get() as Row).n);
  }

  addonReportsBy(uuid: string): AddonReportRow[] {
    return (this.sql.addonReportsBy.all(uuid) as Row[]).map(toAddonReport);
  }

  deleteAddonReportsBefore(cutoff: number): number {
    return Number(this.sql.deleteOldAddonReports.run(cutoff).changes);
  }

  // ---------- Einreichungen ----------

  /** Neuer Entwurf mit den Store-Angaben (Rest kommt mit der JAR). */
  insertSubmission(
    id: string,
    uuid: string,
    fields: { name: string; summary: string; description: string; category: string; icon: string; platforms: string[]; notes: string[] },
    now: number,
  ): SubmissionRow {
    this.sql.insertSubmission.run(
      id,
      uuid,
      fields.name,
      fields.summary,
      fields.description,
      fields.category,
      fields.icon,
      JSON.stringify(fields.platforms),
      JSON.stringify(fields.notes),
      now,
      now,
    );
    return this.getSubmission(id)!;
  }

  getSubmission(id: string): SubmissionRow | undefined {
    const row = this.sql.getSubmission.get(id) as Row | undefined;
    return row ? toSubmission(row) : undefined;
  }

  /** Schreibt alle änderbaren Felder einer Einreichung. */
  saveSubmission(s: SubmissionRow): void {
    this.sql.saveSubmission.run(
      s.status,
      s.addonId,
      s.version,
      s.name,
      s.summary,
      s.description,
      s.category,
      s.icon,
      JSON.stringify(s.platforms),
      JSON.stringify(s.notes),
      JSON.stringify(s.authors),
      s.api,
      s.size,
      s.sha256,
      s.inspection === null ? null : JSON.stringify(s.inspection),
      JSON.stringify(s.screenshots),
      s.manifest,
      s.updatedAt,
      s.submittedAt,
      s.reviewedAt,
      s.reviewNote,
      s.reviewer,
      s.reviewerUuid,
      s.access,
      JSON.stringify(s.minecraft),
      JSON.stringify(s.loaders),
      s.id,
    );
  }

  /** Einreichungen eines Spielers, neueste zuerst. */
  submissionsOf(uuid: string): SubmissionRow[] {
    return (this.sql.submissionsOf.all(uuid) as Row[]).map(toSubmission);
  }

  /** Einreichungen mit einem der Status, zuletzt eingereichte zuerst. */
  submissions(statuses: SubmissionStatus[]): SubmissionRow[] {
    return (this.sql.submissionsIn.all(JSON.stringify(statuses)) as Row[]).map(toSubmission);
  }

  /** Einreichungen eines Addons, die auf Prüfung warten (alle Spieler). */
  pendingSubmissionsFor(addonId: string): SubmissionRow[] {
    return (this.sql.pendingSubmissionsFor.all(addonId) as Row[]).map(toSubmission);
  }

  countSubmissions(uuid: string, status: SubmissionStatus): number {
    return Number((this.sql.countSubmissionsWith.get(uuid, status) as Row).n);
  }

  countPendingSubmissions(): number {
    return Number((this.sql.countPendingSubmissions.get() as Row).n);
  }

  deleteSubmission(id: string): boolean {
    return Number(this.sql.deleteSubmission.run(id).changes) > 0;
  }

  /** Löscht abgelehnte und zurückgezogene Einreichungen, die seit `cutoff` nicht mehr geändert wurden. */
  deleteOldSubmissions(cutoff: number): number {
    return Number(this.sql.deleteOldSubmissions.run(cutoff).changes);
  }

  /** IDs aller Einreichungen (zum Aufräumen verwaister Dateien). */
  submissionIds(): Set<string> {
    return new Set((this.sql.submissionIds.all() as Row[]).map((row) => String(row.id)));
  }

  /** Aus dem Store nehmen bzw. wieder zeigen. true, wenn sich etwas geändert hat. */
  setAddonHidden(id: string, hidden: boolean): boolean {
    const value = hidden ? 1 : 0;
    return Number(this.sql.setAddonHidden.run(value, id, value).changes) > 0;
  }

  /** Ein vollständiger Download mehr (nur der Zähler, sonst nichts). */
  countAddonDownload(id: string): void {
    this.sql.countAddonDownload.run(id);
  }

  /** Löscht eine Version; war es die letzte, auch das Addon mit seinem Zähler. Liefert, ob das Addon jetzt weg ist. */
  deleteAddonVersion(id: string, version: string): boolean {
    return this.transaction(() => {
      this.sql.deleteAddonVersion.run(id, version);
      if (Number((this.sql.countAddonVersions.get(id) as Row).n) > 0) return false;
      this.sql.deleteAddon.run(id);
      return true;
    });
  }

  /** Sichtbare Addons mit mindestens einer Version. */
  countVisibleAddons(): number {
    return Number((this.sql.countVisibleAddons.get() as Row).n);
  }

  /** Einreicher unter `uuids` mit mindestens einem sichtbaren Addon, das eine Version hat (Vorauswahl, ohne Manifest-Prüfung). */
  visibleAddonOwnersIn(uuids: string[]): string[] {
    if (uuids.length === 0) return [];
    return (this.sql.visibleAddonOwnersIn.all(JSON.stringify(uuids)) as Row[]).map((row) => String(row.owner));
  }

  // ---------- Cosmetics ----------

  /** Alle Cosmetics (auch ausgeblendete), ohne Manifest und Signatur. */
  cosmeticInfos(): CosmeticInfoRow[] {
    return (this.sql.cosmeticInfos.all() as Row[]).map(toCosmeticInfo);
  }

  getCosmeticInfo(id: string): CosmeticInfoRow | undefined {
    const row = this.sql.getCosmeticInfo.get(id) as Row | undefined;
    return row ? toCosmeticInfo(row) : undefined;
  }

  getCosmetic(id: string): CosmeticRow | undefined {
    const row = this.sql.getCosmetic.get(id) as Row | undefined;
    return row ? { ...toCosmeticInfo(row), signature: String(row.signature), manifest: String(row.manifest) } : undefined;
  }

  /** Neues Cosmetic (sichtbar) oder neue Version; `hidden` und `createdAt` bleiben bei einer neuen Version. */
  upsertCosmetic(row: Omit<CosmeticRow, 'hidden'>): void {
    this.sql.upsertCosmetic.run(
      row.id,
      row.slot,
      row.version,
      row.access,
      row.name,
      row.description,
      row.date,
      row.size,
      row.sha256,
      row.createdAt,
      row.publishedAt,
      row.publishedBy,
      row.signature,
      row.manifest,
    );
  }

  /** Ausblenden bzw. wieder zeigen. true, wenn sich etwas geändert hat. */
  setCosmeticHidden(id: string, hidden: boolean): boolean {
    const value = hidden ? 1 : 0;
    return Number(this.sql.setCosmeticHidden.run(value, id, value).changes) > 0;
  }

  /**
   * Löscht ein Cosmetic und setzt die Auswahl seiner Träger (im Slot des Cosmetics) zurück, in einer Transaktion.
   * `resetCape: false` lässt `users.cape` in Ruhe (die ID ist inzwischen ein eingebautes Cape). Liefert die Zahl der
   * zurückgesetzten Spieler, oder null, wenn es das Cosmetic nicht gab.
   */
  deleteCosmetic(id: string, resetCape = true): number | null {
    return this.transaction(() => {
      const info = this.getCosmeticInfo(id);
      if (!info) return null;
      let reset = 0;
      if (info.slot === 'cape') {
        if (resetCape) reset = Number(this.sql.resetWornCape.run(id).changes);
      } else if ((WORN_SLOTS as readonly string[]).includes(info.slot)) {
        reset = Number(this.resetStatement(info.slot as WornSlot).run(id).changes);
      }
      this.sql.deleteCosmetic.run(id);
      return reset;
    });
  }

  private resetStatement(slot: WornSlot) {
    switch (slot) {
      case 'head':
        return this.sql.resetWornHead;
      case 'back':
        return this.sql.resetWornBack;
      case 'aura':
        return this.sql.resetWornAura;
      case 'companion':
        return this.sql.resetWornCompanion;
    }
  }

  /** Setzt die Auswahl eines Spielers in einem Slot ('' = ablegen; beim Cape auch eingebaute IDs). */
  setWorn(uuid: string, slot: WornSlot | 'cape', id: string): void {
    const statement = slot === 'cape' ? this.sql.setWornCape : this.setStatement(slot);
    statement.run(id, uuid);
  }

  private setStatement(slot: WornSlot) {
    switch (slot) {
      case 'head':
        return this.sql.setWornHead;
      case 'back':
        return this.sql.setWornBack;
      case 'aura':
        return this.sql.setWornAura;
      case 'companion':
        return this.sql.setWornCompanion;
    }
  }

  /** Anzahl der Spieler je `<slot>:<id>`, die das gewählt haben (Cape: auch eingebaute IDs). */
  cosmeticWearers(): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of this.sql.cosmeticWearers.all() as Row[]) map.set(`${String(row.slot)}:${String(row.id)}`, Number(row.n));
    return map;
  }

  countVisibleCosmetics(): number {
    return Number((this.sql.countVisibleCosmetics.get() as Row).n);
  }

  /** Wer unter `uuids` im Team ist (jede Rolle, mit oder ohne öffentliches Profil). */
  teamMembersIn(uuids: string[]): Set<string> {
    if (uuids.length === 0) return new Set();
    return new Set((this.sql.teamMembersIn.all(JSON.stringify(uuids)) as Row[]).map((row) => String(row.uuid)));
  }

  // ---------- Einladungen ----------

  /** Neue Einladung (Code muss frei sein). */
  insertInvite(invite: Omit<InviteRow, 'accepted'>): void {
    this.sql.insertInvite.run(invite.code, invite.inviter, invite.createdAt, invite.expiresAt, invite.server, invite.voiceGroup);
  }

  /** Einladung zum Code (auch abgelaufene, die noch nicht aufgeräumt sind). */
  getInvite(code: string): InviteRow | undefined {
    const row = this.sql.getInvite.get(code) as Row | undefined;
    return row ? toInvite(row) : undefined;
  }

  /** Offene Einladung mit genau diesem Server und dieser Gruppe, die noch bis mindestens `validUntil` gilt. */
  reusableInvite(inviter: string, server: string | null, voiceGroup: string | null, validUntil: number): InviteRow | undefined {
    const row = this.sql.reusableInvite.get(inviter, server, voiceGroup, validUntil) as Row | undefined;
    return row ? toInvite(row) : undefined;
  }

  /** Offene Einladungen eines Spielers, neueste zuerst. */
  openInvitesOf(inviter: string, now: number): InviteRow[] {
    return (this.sql.openInvitesOf.all(inviter, now) as Row[]).map(toInvite);
  }

  /** Alle gespeicherten Einladungen eines Spielers (Datenauskunft). */
  allInvitesOf(inviter: string): InviteRow[] {
    return (this.sql.allInvitesOf.all(inviter) as Row[]).map(toInvite);
  }

  /** Widerrufen: nur die eigene. true, wenn es sie gab. */
  deleteInvite(code: string, inviter: string): boolean {
    return Number(this.sql.deleteInvite.run(code, inviter).changes) > 0;
  }

  /**
   * Höchstens `keep` offene Einladungen je Spieler: Darüber fallen die ältesten ohne Annahmen weg (gibt es keine
   * solche mehr, die ältesten überhaupt). Liefert die gelöschten Codes.
   */
  trimInvites(inviter: string, now: number, keep: number): string[] {
    return this.transaction(() => {
      const open = this.openInvitesOf(inviter, now).reverse();
      const removed: string[] = [];
      while (open.length > keep) {
        const index = Math.max(0, open.findIndex((invite) => invite.accepted === 0));
        const [oldest] = open.splice(index, 1);
        this.sql.deleteInviteByCode.run(oldest!.code);
        removed.push(oldest!.code);
      }
      return removed;
    });
  }

  deleteExpiredInvites(now: number): number {
    return Number(this.sql.deleteExpiredInvites.run(now).changes);
  }

  /** Die Einladung hat zu einer neuen Freundschaft oder einem neuen Spieler geführt. */
  countInviteAccept(code: string): void {
    this.sql.countAccept.run(code);
  }

  getReferral(invitee: string): ReferralRow | undefined {
    const row = this.sql.getReferral.get(invitee) as Row | undefined;
    return row ? toReferral(row) : undefined;
  }

  /** Neu über eine Einladung dazugekommen (höchstens einmal je Spieler). true, wenn eingetragen. */
  insertReferral(invitee: string, inviter: string | null, code: string | null, at: number): boolean {
    return Number(this.sql.insertReferral.run(invitee, inviter, code, at).changes) > 0;
  }

  /** Bisher gezählte Spielzeit, wenn die Bestätigung noch offen ist und sie für jemanden zählt; sonst undefined. */
  pendingPlayTime(invitee: string): number | undefined {
    const row = this.sql.pendingPlayTime.get(invitee) as Row | undefined;
    return row ? Number(row.played_ms) : undefined;
  }

  /** Spielzeit dazuzählen (nur bei offener Bestätigung). Liefert die neue Summe oder undefined. */
  addPlayTime(invitee: string, ms: number): number | undefined {
    const row = this.sql.addPlayTime.get(Math.max(0, Math.round(ms)), invitee) as Row | undefined;
    return row ? Number(row.played_ms) : undefined;
  }

  /** Bestätigen (nur einmal). true, wenn es jetzt bestätigt wurde. */
  confirmReferral(invitee: string, now: number): boolean {
    return Number(this.sql.confirmReferral.run(now, invitee).changes) > 0;
  }

  /** Über den Spieler neu dazugekommen und davon bestätigt. */
  referralCounts(inviter: string): { invited: number; confirmed: number } {
    const row = this.sql.referralCounts.get(inviter) as Row;
    return { invited: Number(row.invited), confirmed: Number(row.confirmed) };
  }

  /** Datenauskunft des Einladenden: nur Zeitpunkte, nicht wer. */
  referralsBy(inviter: string): { at: number; confirmed: number | null }[] {
    return (this.sql.referralsBy.all(inviter) as Row[]).map((row) => ({ at: Number(row.at), confirmed: nullableNumber(row.confirmed) }));
  }

  // ---------- Freischaltungen ----------

  /** Freischalten; true, wenn es neu ist. */
  addUnlock(uuid: string, cosmetic: string, reason: string, at: number): boolean {
    return Number(this.sql.addUnlock.run(uuid, cosmetic, reason, at).changes) > 0;
  }

  hasUnlock(uuid: string, cosmetic: string): boolean {
    return this.sql.hasUnlock.get(uuid, cosmetic) !== undefined;
  }

  unlocksOf(uuid: string): UnlockRow[] {
    return (this.sql.unlocksOf.all(uuid) as Row[]).map((row) => ({ cosmetic: String(row.cosmetic), reason: String(row.reason), at: Number(row.at) }));
  }

  // ---------- Welt teilen ----------

  insertWorld(world: Omit<WorldRow, 'lastOnline' | 'version'>): void {
    this.sql.insertWorld.run(world.id, world.owner, world.code, world.name, world.access, world.maxPlayers, world.defaultRole, world.createdAt);
  }

  getWorld(id: string): WorldRow | undefined {
    const row = this.sql.getWorld.get(id) as Row | undefined;
    return row ? toWorld(row) : undefined;
  }

  getWorldByCode(code: string): WorldRow | undefined {
    const row = this.sql.getWorldByCode.get(code) as Row | undefined;
    return row ? toWorld(row) : undefined;
  }

  /** Welten eines Spielers, älteste zuerst. */
  worldsOf(owner: string): WorldRow[] {
    return (this.sql.worldsOf.all(owner) as Row[]).map(toWorld);
  }

  countWorlds(owner: string): number {
    return Number((this.sql.countWorlds.get(owner) as Row).n);
  }

  updateWorld(id: string, patch: WorldPatch): void {
    this.sql.updateWorld.run(patch.name ?? null, patch.access ?? null, patch.maxPlayers ?? null, patch.defaultRole ?? null, id);
  }

  /** Geöffnet bzw. geschlossen: Zeitpunkt merken, beim Öffnen auch die Minecraft-Version. */
  setWorldOnline(id: string, now: number, version: string | null): void {
    this.sql.setWorldOnline.run(now, version, id);
  }

  /** Eigene Welt löschen (mit Mitgliedern). true, wenn es sie gab. */
  deleteWorld(id: string, owner: string): boolean {
    return Number(this.sql.deleteWorld.run(id, owner).changes) > 0;
  }

  worldMembers(world: string): WorldMemberRow[] {
    return (this.sql.worldMembers.all(world) as Row[]).map(toWorldMember);
  }

  getWorldMember(world: string, name: string): WorldMemberRow | undefined {
    const row = this.sql.getWorldMember.get(world, name.toLowerCase()) as Row | undefined;
    return row ? toWorldMember(row) : undefined;
  }

  countWorldMembers(world: string): number {
    return Number((this.sql.countWorldMembers.get(world) as Row).n);
  }

  /** Mitglied anlegen oder Rolle ändern (UUID nur setzen, wenn bekannt). */
  putWorldMember(world: string, name: string, uuid: string | null, role: WorldRole, now: number): void {
    this.sql.putWorldMember.run(world, name, name.toLowerCase(), uuid, role, now);
  }

  /** Mitglied anlegen, wenn es noch keins ist (eine vorhandene Rolle bleibt). */
  addWorldMember(world: string, name: string, uuid: string | null, role: WorldRole, now: number): void {
    this.sql.addWorldMember.run(world, name, name.toLowerCase(), uuid, role, now);
  }

  deleteWorldMember(world: string, name: string): boolean {
    return Number(this.sql.deleteWorldMember.run(world, name.toLowerCase()).changes) > 0;
  }

  /** Steht ein Spieler dieses Namens auf der Liste (auch über die UUID eines inzwischen umbenannten Mitglieds)? */
  isWorldMemberNamed(world: string, name: string): boolean {
    const lower = name.toLowerCase();
    return this.sql.worldMemberNamed.get(world, lower, lower) !== undefined;
  }

  /** IDs der Welten, in denen der Spieler Mitglied ist. */
  worldIdsWithMember(uuid: string, name: string): string[] {
    return (this.sql.worldIdsWithMember.all(uuid, name.toLowerCase()) as Row[]).map((row) => String(row.world));
  }

  /** Mitgliedschaften in Welten anderer (Datenauskunft). */
  worldMembershipsOf(uuid: string, name: string): WorldMembershipRow[] {
    return (this.sql.worldMembershipsOf.all(uuid, uuid, name.toLowerCase()) as Row[]).map((row) => ({
      world: String(row.world),
      worldName: String(row.world_name),
      owner: String(row.owner),
      ownerName: String(row.owner_name),
      name: String(row.name),
      role: toWorldRole(row.role),
      addedAt: Number(row.added_at),
    }));
  }

  /** Hat `owner` einen Freund, der gerade so heißt? */
  hasFriendNamed(owner: string, name: string): boolean {
    return this.sql.friendNamed.get(owner, name.toLowerCase()) !== undefined;
  }

  /** Freischaltungen mehrerer Spieler auf einmal (Nachschlagen). */
  unlocksIn(uuids: string[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    if (uuids.length === 0) return map;
    for (const row of this.sql.unlocksIn.all(JSON.stringify(uuids)) as Row[]) {
      const uuid = String(row.uuid);
      let set = map.get(uuid);
      if (!set) {
        set = new Set();
        map.set(uuid, set);
      }
      set.add(String(row.cosmetic));
    }
    return map;
  }
}
