// Voice-Moderation (ab 1.13.0): Voice-Regeln mit Pflicht-Zustimmung (versioniert, Admin veröffentlicht), Voice-Sperren
// des Teams (Begründung, Einspruch über den Support), Voice-Meldungen mit Kontext und Lautstärke-Verlauf, auf Wunsch mit
// einem Clip der letzten Minuten des Gemeldeten (nur solange die Regeln veröffentlicht sind, verschlüsselt mit AES-256-GCM
// im Datenordner, nur das Team spielt ab, Löschen 30 Tage nach Abschluss, spätestens nach 90 Tagen) und die Liste
// „Voice aus“ für Server. Stummschalten und Entfernen durch Gastgeber, Operatoren und Party-Leiter liegt nur im
// Arbeitsspeicher (voice.ts). Clip-Inhalte und der Schlüssel stehen nie im Log.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { StatementSync } from 'node:sqlite';
import type { Store, UserRow } from './db';
import { UNKNOWN_PLAYER } from './friends';
import { HttpError } from './http';
import { OggError, parseOggOpus } from './ogg';
import { playerLabel, writeAudit, type Actor } from './team';
import { checkMultilineText, checkText, isName, isUuid, normalizeServer } from './validate';

export const VOICE_REPORT_REASONS = ['insult', 'harassment', 'hate', 'noise', 'other'] as const;
export type VoiceReportReason = (typeof VOICE_REPORT_REASONS)[number];
export const VOICE_REPORT_REASON_LABELS: Record<VoiceReportReason, string> = {
  insult: 'Beleidigung',
  harassment: 'Belästigung',
  hate: 'Hassrede',
  noise: 'Anschreien/Lärm',
  other: 'Sonstiges',
};
export const VOICE_BAN_DURATIONS = { '1h': 60 * 60_000, '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000, permanent: null } as const;
export type VoiceBanDuration = keyof typeof VOICE_BAN_DURATIONS;
export const VOICE_REPORT_OUTCOMES = ['justified', 'unjustified', 'unclear'] as const;
export type VoiceReportOutcome = (typeof VOICE_REPORT_OUTCOMES)[number];

/** Clip: höchstens 10 Minuten und 3 MiB, Hochladen bis 15 Minuten nach der Meldung. */
export const CLIP_MAX_MS = 10 * 60_000;
export const CLIP_MAX_BYTES = 3 * 1024 * 1024;
export const CLIP_UPLOAD_WINDOW_MS = 15 * 60_000;
/** Clips löschen: 30 Tage nach Abschluss der Meldung, spätestens 90 Tage nach dem Hochladen. */
export const CLIP_DONE_TTL_MS = 30 * 24 * 60 * 60_000;
export const CLIP_MAX_TTL_MS = 90 * 24 * 60 * 60_000;
/** Aufgehobene und abgelaufene Voice-Sperren bleiben so lange im Verlauf. */
export const VOICE_BAN_HISTORY_MS = 365 * 24 * 60 * 60_000;
/** Entfernen aus dem Voice einer Welt oder Party (nur im Arbeitsspeicher, voice.ts). */
export const VOICE_KICK_MS = 10 * 60_000;
export const VOICE_RULES_MAX = 12_000;
export const MAX_VOICE_NOTE = 300;
export const MAX_VOICE_BAN_REASON = 300;
const MAX_LEVELS = 600;
const MAX_NEARBY = 20;
const MAX_SEGMENTS = 600;
const MAX_LIST = 500;
/** Schlüssel der Datei (bei „Clips“ aus der Umgebung oder dem Datenordner) */
const CLIP_MAGIC = Buffer.from('HXC1', 'latin1');
const CLIP_FILE_RE = /^(\d{1,15})-[0-9a-f]{16}\.clip$/;

/** Standardtext der Voice-Regeln (bis ein Admin einen eigenen veröffentlicht). Format: `# ` Überschrift, `- ` Punkt. */
export const DEFAULT_VOICE_RULES = `# Voice-Regeln von HeldixClient
Diese Regeln gelten für den Voice Chat von HeldixClient – im Spiel und im Browser. Bitte lies sie, bevor du sprichst. Ohne deine Zustimmung kannst du den Voice Chat nicht nutzen.

# Verhalten
- Sei respektvoll: keine Beleidigungen, Drohungen oder Belästigung.
- Keine Hassrede: niemanden wegen Herkunft, Hautfarbe, Religion, Geschlecht, sexueller Orientierung, Behinderung oder Alter abwerten.
- Kein Anschreien, keine Störgeräusche und keine laute Musik oder Soundboards gegen den Willen anderer.
- Keine sexuellen Inhalte, keine Werbung, kein Spam.
- Keine persönlichen Daten anderer weitergeben (Adresse, Telefonnummer, Fotos).
- Halte dich an die Regeln des Servers oder der Welt, auf der du spielst. Gastgeber und Operatoren einer Heldix-Welt und der Leiter einer Party dürfen dich dort für alle stummschalten oder für 10 Minuten aus dem Voice entfernen.

# Melden
- Stört dich jemand, melde ihn im Spielermenü (Mausrad-Klick auf den Spieler), in der Voice-Anzeige oder im Browser. Wähle einen Grund: Beleidigung, Belästigung, Hassrede, Anschreien/Lärm oder Sonstiges.
- Zur Meldung gehören: wer wen gemeldet hat, Grund und Notiz, Server oder Welt, Dimension, Zeitpunkt, wer in Hörweite war, ob ihr in einer Gruppe wart, und ein Lautstärke-Verlauf des Gemeldeten (nur der Pegel je Sekunde, kein Inhalt).

# Aufnahme der letzten 10 Minuten beim Melden
- Dein Spiel hält die Stimmen der anderen, die du hörst, höchstens 10 Minuten lang im Arbeitsspeicher – nie auf der Festplatte. Deine eigene Stimme hält es nicht. Verlässt du den Server oder beendest du das Spiel, ist alles weg.
- Nur wenn du jemanden meldest, lädt dein Spiel die Aufnahme genau dieses Spielers hoch (höchstens 10 Minuten, mit Zeitpunkten). Genauso können die letzten 10 Minuten deiner Stimme Teil einer Meldung gegen dich werden.
- Der Heldix-Dienst speichert die Aufnahme verschlüsselt. Anhören kann sie nur das Team (Admins, Moderatoren und Supporter), um die Meldung zu prüfen.
- Gelöscht wird sie 30 Tage nach Abschluss der Meldung, spätestens 90 Tage nach dem Hochladen. In der Datenauskunft des Gemeldeten steht sie nicht, damit der Meldende geschützt bleibt.
- Im Browser wird nichts aufgenommen.

# Sperren
- Bei Verstößen kann das Team dich für 1 Stunde, 24 Stunden, 7 Tage oder dauerhaft vom Voice Chat sperren. Du erfährst den Grund und wie lange die Sperre gilt – im Spiel und auf der Webseite in deinem Konto.
- Bei schweren Verstößen kann das Team dein Konto beim Heldix-Dienst ganz sperren.

# Einspruch
- Bist du mit einer Entscheidung nicht einverstanden, schreib eine Support-Anfrage (Kategorie „Konto“) auf der Webseite, im Launcher oder im Spiel. Das Team prüft die Entscheidung erneut und antwortet dir.

# Zustimmung
- Mit „Annehmen“ stimmst du diesen Regeln zu – auch der Aufnahme der letzten 10 Minuten beim Melden. Du kannst die Zustimmung jederzeit in deinem Konto auf der Webseite widerrufen; dann ist der Voice Chat für dich aus.
- Ändern sich die Regeln, fragen wir dich erneut.`;

export const VOICE_APPEAL = 'Einspruch: Support-Anfrage (Kategorie „Konto“) auf der Webseite, im Launcher oder im Spiel.';
export const VOICE_SERVER_OFF = 'Voice ist auf diesem Server aus (auf Wunsch des Server-Betreibers).';
export const VOICE_RULES_REQUIRED = 'Bitte zuerst die Voice-Regeln lesen und annehmen.';
const NO_SUCH_REPORT = 'Diese Meldung gibt es nicht (mehr).';

type Row = Record<string, unknown>;

/** Wer nicht in den Voice Chat darf: Regeln nicht angenommen (4012) oder gesperrt (4013). */
export type VoiceGate =
  | { kind: 'rules'; version: number }
  | { kind: 'banned'; until: number | null; reason: string; message: string; appeal: string };

/** Was der Voice Chat bei Änderungen tun soll (voice.ts); ohne Voice Chat null. */
export interface VoiceModerationListener {
  /** Spieler gesperrt: laufende Verbindung mit `banned` und 4013 schließen, Gäste seiner Einladungen trennen. */
  banned(uuid: string, gate: Extract<VoiceGate, { kind: 'banned' }>): void;
  /** Neue Regeln: alle ohne Zustimmung zu `version` mit 4012 schließen. */
  rulesPublished(version: number): void;
  /** Zustimmung widerrufen: Verbindung mit 4012 schließen (nur wenn Regeln gelten). */
  consentWithdrawn(uuid: string, version: number): void;
  /** Clips an oder aus (auch nach Zurückziehen der Regeln). */
  clipsChanged(): void;
  /** Liste „Voice aus“ geändert. */
  serversChanged(): void;
}

export interface VoiceModerationOptions {
  /** Ordner für Clips (`<Daten>/voice-clips`) */
  clipDir: string;
  /** Schlüssel für Clips (32 Byte, aus HELDIX_DIENST_VOICE_CLIP_KEY); null: aus `clipKeyFile` (wird angelegt). */
  clipKey: Buffer | null;
  clipKeyFile: string;
  /** false: Clips hart aus (HELDIX_DIENST_VOICE_CLIPS=0) */
  clipsAllowed: boolean;
  /** Voice-Meldungen je Meldendem: je Stunde, je 24 Stunden; Gäste je Stunde */
  reportHourly: number;
  reportDaily: number;
  guestReportHourly: number;
  log: (line: string) => void;
}

export interface VoiceBanRow {
  id: number;
  uuid: string;
  name: string;
  reason: string;
  reports: number[];
  at: number;
  until: number | null;
  by: string | null;
  liftedAt: number | null;
  liftedBy: string | null;
}

interface RulesRow {
  version: number;
  text: string;
  publishedAt: number;
  publishedBy: string | null;
  withdrawnAt: number | null;
  withdrawnBy: string | null;
}

interface VoiceReportRow {
  id: number;
  reporter: string;
  reporterName: string;
  reported: string;
  reportedName: string;
  reason: string;
  note: string;
  at: number;
  status: 'open' | 'done';
  doneAt: number | null;
  doneBy: string | null;
  outcome: VoiceReportOutcome | null;
  context: Record<string, unknown>;
  clip: ClipMeta | null;
}

interface ClipMeta {
  size: number;
  durationMs: number;
  createdAt: number;
  start: number | null;
  segments: { offset: number; at: number }[];
}

/** Kontext, den der Dienst selbst aus der Voice-Verbindung des Meldenden kennt (voice.ts). */
export interface ServiceVoiceContext {
  server: string | null;
  dimension: string | null;
  group: boolean;
  world: { code: string; name: string } | null;
  /** Wer gerade in Hörweite oder in der Gruppe ist (UUIDs bzw. Gast-IDs mit Namen) */
  nearby: { uuid: string; name: string; guest: boolean }[];
  /** Ist der Gemeldete gerade im selben Raum bzw. in derselben Gruppe? */
  reportedPresent: boolean;
}

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const nullableString = (value: unknown) => (value === null || value === undefined ? null : String(value));

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toBan(row: Row): VoiceBanRow {
  let reports: number[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.reports));
    if (Array.isArray(parsed)) reports = parsed.filter((n): n is number => Number.isInteger(n));
  } catch {
    reports = [];
  }
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    reason: String(row.reason),
    reports,
    at: Number(row.at),
    until: nullableNumber(row.until),
    by: nullableString(row.by_name),
    liftedAt: nullableNumber(row.lifted_at),
    liftedBy: nullableString(row.lifted_by),
  };
}

function toRules(row: Row): RulesRow {
  return {
    version: Number(row.version),
    text: String(row.text),
    publishedAt: Number(row.published_at),
    publishedBy: nullableString(row.published_by),
    withdrawnAt: nullableNumber(row.withdrawn_at),
    withdrawnBy: nullableString(row.withdrawn_by),
  };
}

function toClipMeta(row: Row): ClipMeta | null {
  if (row.clip_size === null || row.clip_size === undefined) return null;
  const meta = parseJson(row.clip_meta);
  const segments = Array.isArray(meta.segments)
    ? (meta.segments as unknown[]).flatMap((s) => {
        const entry = s as { offset?: unknown; at?: unknown };
        return typeof entry?.offset === 'number' && typeof entry?.at === 'number' ? [{ offset: entry.offset, at: entry.at }] : [];
      })
    : [];
  return {
    size: Number(row.clip_size),
    durationMs: Number(row.clip_duration),
    createdAt: Number(row.clip_created),
    start: typeof meta.start === 'number' ? meta.start : null,
    segments,
  };
}

function toVoiceReport(row: Row): VoiceReportRow {
  const outcome = (VOICE_REPORT_OUTCOMES as readonly unknown[]).includes(row.outcome) ? (row.outcome as VoiceReportOutcome) : null;
  return {
    id: Number(row.id),
    reporter: String(row.reporter),
    reporterName: String(row.reporter_name),
    reported: String(row.reported),
    reportedName: String(row.reported_name),
    reason: String(row.reason),
    note: String(row.note),
    at: Number(row.at),
    status: row.status === 'done' ? 'done' : 'open',
    doneAt: nullableNumber(row.done_at),
    doneBy: nullableString(row.done_by),
    outcome,
    context: parseJson(row.context),
    clip: toClipMeta(row),
  };
}

const VOICE_REPORT_SELECT = `
  SELECT r.id, r.reporter, r.reporter_name, r.reported, r.reported_name, r.reason, r.note, r.at, r.status, r.done_at, r.done_by,
    r.outcome, r.context, c.size AS clip_size, c.duration_ms AS clip_duration, c.created_at AS clip_created, c.meta AS clip_meta
  FROM reports r LEFT JOIN voice_clips c ON c.report = r.id`;
const BAN_COLUMNS = 'id, uuid, name, reason, reports, at, until, by_name, lifted_at, lifted_by';

/** Uhrzeit für Spieler (Europe/Berlin), z. B. „29.11.2026, 14:00 Uhr“. */
export function formatBerlin(ms: number): string {
  const text = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
  return `${text} Uhr`;
}

/** Meldung für einen gesperrten Spieler. */
export function banMessage(until: number | null, reason: string): string {
  return until === null
    ? `Du bist dauerhaft vom Voice Chat gesperrt. Grund: ${reason}`
    : `Du bist bis ${formatBerlin(until)} vom Voice Chat gesperrt. Grund: ${reason}`;
}

/** Host einer Server-Adresse (ohne Port, klein) bzw. ein Eintrag der Liste „Voice aus“. */
export function normalizeVoiceDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase().replace(/\.$/, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return raw.split('.').every((part) => Number(part) <= 255) ? raw : null;
  const server = normalizeServer(raw);
  if (server === null || server.includes(':')) return null;
  return server;
}

/** Teil eines Pfads dekodieren (kaputte %-Folgen: leer statt Fehler). */
function decodePath(value: string | undefined): string {
  try {
    return decodeURIComponent(value ?? '');
  } catch {
    return '';
  }
}

/** Ganze Zahl in dBFS (-100..0) bzw. null (still); sonst undefined (ungültig). */
function level(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(-100, Math.min(0, Math.round(value)));
}

export class VoiceModeration {
  private readonly sql: Record<string, StatementSync>;
  private key: Buffer | null = null;
  private keySource: 'env' | 'file' | null = null;
  /** Veröffentlichte, nicht zurückgezogene Regeln (null = keine) – im Speicher, weil jede Verbindung fragt */
  private rules: RulesRow | null = null;
  private clipsEnabled = true;
  /** Liste „Voice aus“ im Speicher (klein; jedes `join` fragt) */
  private servers: { domain: string; subdomains: boolean }[] = [];
  listener: VoiceModerationListener | null = null;

  constructor(
    private readonly store: Store,
    private readonly options: VoiceModerationOptions,
  ) {
    const p = (sql: string) => store.prepare(sql);
    this.sql = {
      currentRules: p('SELECT version, text, published_at, published_by, withdrawn_at, withdrawn_by FROM voice_rules ORDER BY version DESC LIMIT 1'),
      allRules: p('SELECT version, text, published_at, published_by, withdrawn_at, withdrawn_by FROM voice_rules ORDER BY version DESC'),
      insertRules: p('INSERT INTO voice_rules (version, text, published_at, published_by) VALUES (?, ?, ?, ?)'),
      withdrawRules: p('UPDATE voice_rules SET withdrawn_at = ?, withdrawn_by = ? WHERE version = ? AND withdrawn_at IS NULL'),
      getSetting: p('SELECT value FROM voice_settings WHERE key = ?'),
      putSetting: p('INSERT INTO voice_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
      getConsent: p('SELECT version, at FROM voice_consents WHERE uuid = ?'),
      putConsent: p('INSERT INTO voice_consents (uuid, version, at) VALUES (?, ?, ?) ON CONFLICT (uuid) DO UPDATE SET version = excluded.version, at = excluded.at'),
      deleteConsent: p('DELETE FROM voice_consents WHERE uuid = ?'),
      activeBan: p(`SELECT ${BAN_COLUMNS} FROM voice_bans WHERE uuid = ? AND lifted_at IS NULL AND (until IS NULL OR until > ?) ORDER BY at DESC, id DESC LIMIT 1`),
      activeBans: p(`SELECT ${BAN_COLUMNS} FROM voice_bans WHERE lifted_at IS NULL AND (until IS NULL OR until > ?) ORDER BY at DESC, id DESC`),
      recentBans: p(`SELECT ${BAN_COLUMNS} FROM voice_bans ORDER BY at DESC, id DESC LIMIT 100`),
      bansOf: p(`SELECT ${BAN_COLUMNS} FROM voice_bans WHERE uuid = ? ORDER BY at DESC, id DESC`),
      insertBan: p('INSERT INTO voice_bans (uuid, name, reason, reports, at, until, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      liftBan: p('UPDATE voice_bans SET lifted_at = ?, lifted_by = ? WHERE uuid = ? AND lifted_at IS NULL AND (until IS NULL OR until > ?)'),
      deleteOldBans: p('DELETE FROM voice_bans WHERE coalesce(lifted_at, until) IS NOT NULL AND coalesce(lifted_at, until) < ?'),
      servers: p('SELECT domain, subdomains, reason, contact, at, by_name FROM voice_servers ORDER BY domain'),
      putServer: p(`INSERT INTO voice_servers (domain, subdomains, reason, contact, at, by_name) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (domain) DO UPDATE SET subdomains = excluded.subdomains, reason = excluded.reason, contact = excluded.contact,
          at = excluded.at, by_name = excluded.by_name`),
      deleteServer: p('DELETE FROM voice_servers WHERE domain = ?'),
      insertReport: p(`INSERT INTO reports (reporter, reporter_name, reported, reported_name, reason, note, messages, at, kind, context)
        VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'voice', ?)`),
      getReport: p(`${VOICE_REPORT_SELECT} WHERE r.id = ? AND r.kind = 'voice'`),
      reports: p(`${VOICE_REPORT_SELECT} WHERE r.kind = 'voice' AND r.status IN (SELECT value FROM json_each(?)) ORDER BY r.id DESC LIMIT ${MAX_LIST}`),
      reportsAbout: p(`${VOICE_REPORT_SELECT} WHERE r.kind = 'voice' AND r.reported = ? ORDER BY r.id DESC LIMIT 200`),
      reportsBy: p(`${VOICE_REPORT_SELECT} WHERE r.kind = 'voice' AND r.reporter = ? ORDER BY r.id DESC`),
      reportsSince: p("SELECT count(*) AS n, min(at) AS oldest FROM reports WHERE kind = 'voice' AND reporter = ? AND at > ?"),
      pairSince: p("SELECT max(at) AS last FROM reports WHERE kind = 'voice' AND reporter = ? AND reported = ? AND at > ?"),
      markDone: p("UPDATE reports SET status = 'done', done_at = ?, done_by = ?, outcome = ? WHERE id = ? AND kind = 'voice'"),
      countOpen: p("SELECT count(*) AS n FROM reports WHERE kind = 'voice' AND status = 'open'"),
      outcomesBy: p('SELECT outcome, count(*) AS n FROM reports WHERE reporter = ? AND outcome IS NOT NULL GROUP BY outcome'),
      getClip: p('SELECT report, file, size, duration_ms, meta, created_at FROM voice_clips WHERE report = ?'),
      insertClip: p('INSERT INTO voice_clips (report, file, size, duration_ms, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      deleteClip: p('DELETE FROM voice_clips WHERE report = ?'),
      dueClips: p(`SELECT c.report, c.file FROM voice_clips c JOIN reports r ON r.id = c.report
        WHERE c.created_at <= ? OR (r.status = 'done' AND r.done_at IS NOT NULL AND r.done_at <= ?)`),
      clipFiles: p('SELECT file FROM voice_clips'),
      voiceAudit: p(`SELECT id, at, actor_name, action, target, detail FROM audit WHERE action LIKE 'voice.%' AND target LIKE ? ORDER BY at DESC, id DESC LIMIT 100`),
    };
    this.reload();
  }

  /** Regeln, Schalter und Server-Liste aus der Datenbank in den Speicher. */
  private reload(): void {
    const row = this.sql.currentRules!.get() as Row | undefined;
    const rules = row ? toRules(row) : null;
    this.rules = rules && rules.withdrawnAt === null ? rules : null;
    const setting = this.sql.getSetting!.get('clips') as Row | undefined;
    this.clipsEnabled = setting ? String(setting.value) !== '0' : true;
    this.servers = (this.sql.servers!.all() as Row[]).map((r) => ({ domain: String(r.domain), subdomains: Number(r.subdomains) === 1 }));
  }

  // ---------- Abfragen für den Voice Chat ----------

  /** Veröffentlichte Version der Regeln (null = keine). */
  rulesVersion(): number | null {
    return this.rules?.version ?? null;
  }

  /** Sind Clips gerade aktiv (Regeln veröffentlicht, Schalter an, nicht hart aus)? */
  clipsActive(): boolean {
    return this.options.clipsAllowed && this.clipsEnabled && this.rules !== null;
  }

  /** Grenzen für `ready.clips` bzw. null. */
  clipLimits(): { maxMs: number; maxBytes: number } | null {
    return this.clipsActive() ? { maxMs: CLIP_MAX_MS, maxBytes: CLIP_MAX_BYTES } : null;
  }

  /** Aktive Voice-Sperre eines Spielers oder null. */
  activeBan(uuid: string, now = Date.now()): VoiceBanRow | null {
    const row = this.sql.activeBan!.get(uuid, now) as Row | undefined;
    return row ? toBan(row) : null;
  }

  isBanned(uuid: string): boolean {
    return this.activeBan(uuid) !== null;
  }

  private banGate(ban: VoiceBanRow): Extract<VoiceGate, { kind: 'banned' }> {
    return { kind: 'banned', until: ban.until, reason: ban.reason, message: banMessage(ban.until, ban.reason), appeal: VOICE_APPEAL };
  }

  /**
   * Darf diese Verbindung in den Voice Chat? Spieler: Sperre, dann Zustimmung zur aktuellen Version. Gast: die bei der
   * Gast-Sitzung angenommene Version (`guestRules`). null = darf.
   */
  gate(uuid: string, guest: boolean, guestRules: number | null): VoiceGate | null {
    if (!guest) {
      const ban = this.activeBan(uuid);
      if (ban) return this.banGate(ban);
    }
    const version = this.rulesVersion();
    if (version === null) return null;
    const accepted = guest ? guestRules : this.acceptedVersion(uuid);
    return accepted === version ? null : { kind: 'rules', version };
  }

  /** Version, der der Spieler zugestimmt hat (null = keiner). */
  acceptedVersion(uuid: string): number | null {
    const row = this.sql.getConsent!.get(uuid) as Row | undefined;
    return row ? Number(row.version) : null;
  }

  /** Steht der Server (Adresse wie im Voice Chat, ggf. mit Port) auf der Liste „Voice aus“? */
  serverOff(server: string): boolean {
    if (this.servers.length === 0) return false;
    const host = server.replace(/:\d{1,5}$/, '').toLowerCase();
    return this.servers.some((entry) => host === entry.domain || (entry.subdomains && host.endsWith(`.${entry.domain}`)));
  }

  // ---------- Öffentlich und für Spieler ----------

  private limits() {
    return {
      clipMs: CLIP_MAX_MS,
      clipBytes: CLIP_MAX_BYTES,
      deleteAfterDoneDays: CLIP_DONE_TTL_MS / (24 * 60 * 60_000),
      deleteAfterDays: CLIP_MAX_TTL_MS / (24 * 60 * 60_000),
      kickMinutes: VOICE_KICK_MS / 60_000,
    };
  }

  /** `GET /v1/public/voice/rules` */
  publicRules() {
    const rules = this.rules;
    return {
      published: rules !== null,
      version: rules?.version ?? null,
      publishedAt: rules?.publishedAt ?? null,
      text: rules?.text ?? DEFAULT_VOICE_RULES,
      clips: this.clipsActive(),
      limits: this.limits(),
    };
  }

  private banView(ban: VoiceBanRow) {
    return { reason: ban.reason, at: ban.at, until: ban.until, message: banMessage(ban.until, ban.reason), appeal: VOICE_APPEAL };
  }

  /** `GET /v1/voice/me` */
  me(user: UserRow) {
    const version = this.rulesVersion();
    const consent = this.sql.getConsent!.get(user.uuid) as Row | undefined;
    const accepted = consent ? Number(consent.version) : null;
    const ban = this.activeBan(user.uuid);
    return {
      rules: { version, accepted, acceptedAt: consent ? Number(consent.at) : null, required: version !== null && accepted !== version },
      clips: this.clipsActive(),
      ban: ban ? this.banView(ban) : null,
      bans: (this.sql.bansOf!.all(user.uuid) as Row[]).map(toBan).map((b) => ({ reason: b.reason, at: b.at, until: b.until, liftedAt: b.liftedAt })),
    };
  }

  /** `POST /v1/voice/rules/accept { version }` */
  accept(user: UserRow, input: Record<string, unknown>) {
    const version = this.rulesVersion();
    if (version === null) throw new HttpError(409, 'Es gibt gerade keine Voice-Regeln zum Annehmen.', {}, 'voice-rules-none');
    if (input.version !== version) {
      throw new HttpError(409, 'Die Voice-Regeln wurden geändert. Bitte lies die neue Fassung.', {}, 'voice-rules-version', { version });
    }
    this.sql.putConsent!.run(user.uuid, version, Date.now());
    return this.me(user);
  }

  /** `DELETE /v1/voice/rules/accept`: Zustimmung widerrufen (der Voice Chat ist danach aus). */
  withdrawConsent(user: UserRow) {
    const accepted = this.acceptedVersion(user.uuid);
    this.sql.deleteConsent!.run(user.uuid);
    const version = this.rulesVersion();
    if (accepted !== null && version !== null) this.listener?.consentWithdrawn(user.uuid, version);
    return this.me(user);
  }

  // ---------- Melden ----------

  private checkReason(value: unknown): VoiceReportReason {
    if (!(VOICE_REPORT_REASONS as readonly unknown[]).includes(value)) throw new HttpError(400, `Ungültiger Grund (erlaubt: ${VOICE_REPORT_REASONS.join(', ')}).`);
    return value as VoiceReportReason;
  }

  private checkNote(value: unknown): string {
    if (value === undefined || value === null) return '';
    const checked = checkText(value, MAX_VOICE_NOTE, true);
    if ('problem' in checked) throw new HttpError(400, `Die Notiz darf höchstens ${MAX_VOICE_NOTE} Zeichen lang sein (eine Zeile).`);
    return checked.text;
  }

  /** Kontext vom Client (Server, Dimension, Zeitpunkt, Gruppe, Spieler in Hörweite); Ungültiges fällt weg. */
  private clientContext(value: unknown, now: number): Record<string, unknown> | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '„context“ muss ein Objekt sein.');
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof input.server === 'string' && input.server.length <= 300) {
      const server = normalizeServer(input.server) ?? (/^[a-z0-9.-]{1,253}(?::\d{1,5})?$/.test(input.server.trim().toLowerCase()) ? input.server.trim().toLowerCase() : null);
      if (server !== null) out.server = server;
    }
    if (typeof input.dimension === 'string' && /^[a-z0-9_.-]{1,32}:[a-z0-9_./-]{1,64}$/.test(input.dimension)) out.dimension = input.dimension;
    if (typeof input.at === 'number' && Number.isFinite(input.at) && Math.abs(input.at - now) <= 24 * 60 * 60_000) out.at = Math.round(input.at);
    if (typeof input.group === 'boolean') out.group = input.group;
    if (Array.isArray(input.nearby)) {
      const nearby: { uuid: string; name: string | null }[] = [];
      for (const entry of input.nearby.slice(0, MAX_NEARBY)) {
        const e = entry as { uuid?: unknown; name?: unknown } | null;
        if (!e || !isUuid(e.uuid)) continue;
        const name = typeof e.name === 'string' && (isName(e.name) || /^[\p{L}\p{N} _.-]{1,24}$/u.test(e.name)) ? e.name : null;
        nearby.push({ uuid: e.uuid, name });
      }
      out.nearby = nearby;
    }
    return out;
  }

  /** Lautstärke-Verlauf je Sekunde (rms/peak in dBFS -100..0 oder null), höchstens 600 Werte. */
  private levels(value: unknown, now: number): Record<string, unknown> | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '„levels“ muss ein Objekt sein.');
    const input = value as Record<string, unknown>;
    const series = (name: string): (number | null)[] | null => {
      const raw = input[name];
      if (raw === undefined || raw === null) return null;
      if (!Array.isArray(raw) || raw.length > MAX_LEVELS) throw new HttpError(400, `„levels.${name}“: höchstens ${MAX_LEVELS} Werte.`);
      return raw.map((v) => {
        const checked = level(v);
        if (checked === undefined) throw new HttpError(400, `„levels.${name}“: Werte in dBFS (Zahl) oder null.`);
        return checked;
      });
    };
    const rms = series('rms');
    const peak = series('peak');
    if (rms === null && peak === null) return null;
    const end = typeof input.end === 'number' && Number.isFinite(input.end) && Math.abs(input.end - now) <= 24 * 60 * 60_000 ? Math.round(input.end) : now;
    return { end, step: 1000, rms: rms ?? [], peak: peak ?? [] };
  }

  private retry(until: number, now: number): Record<string, string> {
    return { 'Retry-After': String(Math.max(1, Math.ceil((until - now) / 1000))) };
  }

  /** Grenzen je Meldendem (Spieler: je Stunde und 24 Stunden; Gast: je Stunde) und einmal je Gemeldetem in 24 Stunden. */
  private checkLimits(reporter: string, reported: string, reportedName: string, guest: boolean, now: number): void {
    const day = 24 * 60 * 60_000;
    const last = Number((this.sql.pairSince!.get(reporter, reported, now - day) as Row).last ?? NaN);
    if (Number.isFinite(last)) {
      throw new HttpError(429, `Du hast ${reportedName} in den letzten 24 Stunden schon gemeldet. Das Team schaut sich die Meldung an.`, this.retry(last + day, now));
    }
    const hour = this.sql.reportsSince!.get(reporter, now - 60 * 60_000) as Row;
    const hourly = guest ? this.options.guestReportHourly : this.options.reportHourly;
    if (Number(hour.n) >= hourly) {
      throw new HttpError(429, `Höchstens ${hourly} Voice-Meldungen pro Stunde. Versuche es später noch einmal.`, this.retry(Number(hour.oldest ?? now) + 60 * 60_000, now));
    }
    if (!guest) {
      const daily = this.sql.reportsSince!.get(reporter, now - day) as Row;
      if (Number(daily.n) >= this.options.reportDaily) {
        throw new HttpError(429, `Höchstens ${this.options.reportDaily} Voice-Meldungen in 24 Stunden. Versuche es später noch einmal.`, this.retry(Number(daily.oldest ?? now) + day, now));
      }
    }
  }

  /**
   * `POST /v1/voice/reports` (Spieler) bzw. die Gast-Meldung: Meldung mit Kontext vom Client und vom Dienst, dazu der
   * Lautstärke-Verlauf. Antwort mit `clip`, wenn eine Aufnahme hochgeladen werden darf (nur Spieler, nur aktive Clips).
   */
  report(
    reporter: { uuid: string; name: string; guest: boolean },
    input: Record<string, unknown>,
    service: ServiceVoiceContext | null,
    isGuestId: (id: string) => boolean,
  ) {
    const { uuid } = input;
    if (!isUuid(uuid)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
    const reason = this.checkReason(input.reason);
    const note = this.checkNote(input.note);
    if (uuid === reporter.uuid) throw new HttpError(400, 'Du kannst dich nicht selbst melden.');
    const target = this.store.getUser(uuid);
    if (!target) {
      if (isGuestId(uuid)) throw new HttpError(400, 'Gäste im Browser lassen sich nicht melden – entferne sie aus der Gruppe.', {}, 'voice-guest');
      throw new HttpError(404, UNKNOWN_PLAYER);
    }
    const now = Date.now();
    const client = this.clientContext(input.context, now);
    const levels = this.levels(input.levels, now);
    this.checkLimits(reporter.uuid, target.uuid, target.name, reporter.guest, now);
    const context = { client, service, levels, reporterGuest: reporter.guest };
    const name = reporter.guest ? `${reporter.name} (Gast)` : reporter.name;
    const result = this.sql.insertReport!.run(reporter.uuid, name, target.uuid, target.name, reason, note, now, JSON.stringify(context));
    const id = Number(result.lastInsertRowid);
    // Ohne Namen: Das Log soll nur zeigen, dass es etwas zu prüfen gibt.
    this.options.log(`Neue Voice-Meldung #${id} (Grund: ${reason}). Ansehen im Team-Bereich unter Voice.`);
    const clip =
      !reporter.guest && this.clipsActive()
        ? { upload: `/v1/voice/reports/${id}/clip`, maxBytes: CLIP_MAX_BYTES, maxMs: CLIP_MAX_MS, until: now + CLIP_UPLOAD_WINDOW_MS }
        : null;
    return { reported: true as const, id, clip };
  }

  // ---------- Clips ----------

  /** Schlüssel für Clips: aus der Umgebung oder aus der Datei im Datenordner (wird beim ersten Mal angelegt). */
  private clipKey(): Buffer {
    if (this.key) return this.key;
    if (this.options.clipKey) {
      if (this.options.clipKey.length !== 32) throw new Error('Der Schlüssel für Voice-Clips muss 32 Byte lang sein.');
      this.key = this.options.clipKey;
      this.keySource = 'env';
      return this.key;
    }
    const file = this.options.clipKeyFile;
    let text: string | null = null;
    try {
      text = fs.readFileSync(file, 'utf8').trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (text === null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      text = randomBytes(32).toString('hex');
      fs.writeFileSync(file, `${text}\n`, { mode: 0o600, flag: 'wx' });
      this.options.log('Voice-Clips: neuer Schlüssel im Datenordner angelegt (voice-clips.key, nur für den Dienst lesbar).');
    }
    if (!/^[0-9a-f]{64}$/.test(text)) throw new Error('Die Schlüsseldatei für Voice-Clips ist beschädigt (erwartet 64 Hex-Zeichen).');
    this.key = Buffer.from(text, 'hex');
    this.keySource = 'file';
    return this.key;
  }

  private encrypt(report: number, data: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.clipKey(), iv);
    cipher.setAAD(Buffer.from(`heldix-voice-clip\n${report}`, 'utf8'));
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([CLIP_MAGIC, iv, cipher.getAuthTag(), body]);
  }

  private decrypt(report: number, file: Buffer): Buffer {
    if (file.length < 32 || !file.subarray(0, 4).equals(CLIP_MAGIC)) throw new Error('Clip-Datei beschädigt');
    const decipher = createDecipheriv('aes-256-gcm', this.clipKey(), file.subarray(4, 16));
    decipher.setAAD(Buffer.from(`heldix-voice-clip\n${report}`, 'utf8'));
    decipher.setAuthTag(file.subarray(16, 32));
    return Buffer.concat([decipher.update(file.subarray(32)), decipher.final()]);
  }

  private clipPath(file: string): string {
    return path.join(this.options.clipDir, file);
  }

  /** `PUT /v1/voice/reports/<id>/clip` (nur der Meldende, einmal, bis 15 Minuten nach der Meldung, nur bei aktiven Clips). */
  async uploadClip(user: UserRow, id: number, contentType: string | undefined, body: Buffer) {
    const row = this.sql.getReport!.get(id) as Row | undefined;
    const report = row ? toVoiceReport(row) : null;
    if (!report || report.reporter !== user.uuid || report.context.reporterGuest === true) throw new HttpError(404, NO_SUCH_REPORT);
    if (!this.clipsActive()) throw new HttpError(409, 'Aufnahmen beim Melden sind gerade aus.', {}, 'clip-off');
    if (report.clip) throw new HttpError(409, 'Zu dieser Meldung gibt es schon eine Aufnahme.', {}, 'clip-exists');
    if (Date.now() - report.at > CLIP_UPLOAD_WINDOW_MS || report.status !== 'open') {
      throw new HttpError(409, 'Die Aufnahme kam zu spät (höchstens 15 Minuten nach der Meldung).', {}, 'clip-late');
    }
    const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'audio/ogg' && type !== 'application/ogg') throw new HttpError(415, 'Die Aufnahme muss als audio/ogg kommen.', {}, 'clip-format');
    let info;
    try {
      info = parseOggOpus(body, CLIP_MAX_MS + 1000);
    } catch (err) {
      if (err instanceof OggError) throw new HttpError(400, `Die Aufnahme ist ungültig: ${err.message}`, {}, 'clip-format');
      throw err;
    }
    if (info.tags.HELDIX_SPEAKER !== report.reported) {
      throw new HttpError(400, 'Die Aufnahme gehört nicht zum gemeldeten Spieler (HELDIX_SPEAKER).', {}, 'clip-format');
    }
    const start = /^\d{1,15}$/.test(info.tags.HELDIX_START ?? '') ? Number(info.tags.HELDIX_START) : null;
    const segments: { offset: number; at: number }[] = [];
    for (const part of (info.tags.HELDIX_SEGMENTS ?? '').split(',')) {
      const match = /^(\d{1,9})@(\d{1,15})$/.exec(part.trim());
      if (match && segments.length < MAX_SEGMENTS) segments.push({ offset: Number(match[1]), at: Number(match[2]) });
    }
    const file = `${id}-${randomBytes(8).toString('hex')}.clip`;
    const encrypted = this.encrypt(id, body);
    await fs.promises.mkdir(this.options.clipDir, { recursive: true, mode: 0o700 });
    const temp = this.clipPath(`.${file}.tmp`);
    await fs.promises.writeFile(temp, encrypted, { mode: 0o600 });
    await fs.promises.rename(temp, this.clipPath(file));
    const durationMs = Math.min(info.durationMs, CLIP_MAX_MS);
    try {
      this.sql.insertClip!.run(id, file, body.length, durationMs, JSON.stringify({ start, segments }), Date.now());
    } catch (err) {
      await fs.promises.rm(this.clipPath(file), { force: true });
      // Gleichzeitig zweimal hochgeladen
      if (String((err as Error).message).includes('UNIQUE')) throw new HttpError(409, 'Zu dieser Meldung gibt es schon eine Aufnahme.', {}, 'clip-exists');
      throw err;
    }
    this.options.log(`Voice-Meldung #${id}: Aufnahme gespeichert (verschlüsselt).`);
    return { clip: { size: body.length, durationMs } };
  }

  /** `GET /v1/team/voice/clips/<id>`: entschlüsselte Ogg-Datei (Abspielen steht im Protokoll). */
  async readClip(actor: Actor, id: number): Promise<Buffer> {
    const row = this.sql.getClip!.get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Zu dieser Meldung gibt es keine Aufnahme (mehr).');
    let data: Buffer;
    try {
      data = this.decrypt(id, await fs.promises.readFile(this.clipPath(String(row.file))));
    } catch (err) {
      this.options.log(`Voice-Meldung #${id}: Aufnahme nicht lesbar (${(err as NodeJS.ErrnoException).code ?? 'entschlüsseln fehlgeschlagen'}).`);
      throw new HttpError(410, 'Die Aufnahme ist nicht mehr lesbar.');
    }
    writeAudit(this.store, actor, 'voice.clip.play', `Meldung ${id}`);
    return data;
  }

  /** `DELETE /v1/team/voice/clips/<id>` */
  async deleteClip(actor: Actor, id: number) {
    const row = this.sql.getClip!.get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Zu dieser Meldung gibt es keine Aufnahme (mehr).');
    this.sql.deleteClip!.run(id);
    await fs.promises.rm(this.clipPath(String(row.file)), { force: true });
    writeAudit(this.store, actor, 'voice.clip.delete', `Meldung ${id}`);
    return { deleted: true };
  }

  /**
   * Fällige Clips löschen (30 Tage nach Abschluss, 90 Tage nach dem Hochladen) und Dateien ohne Eintrag entfernen (Meldung
   * gelöscht, Konto des Meldenden gelöscht, abgebrochener Upload älter als eine Stunde).
   */
  async sweepClips(now = Date.now()): Promise<void> {
    for (const row of this.sql.dueClips!.all(now - CLIP_MAX_TTL_MS, now - CLIP_DONE_TTL_MS) as Row[]) {
      this.sql.deleteClip!.run(Number(row.report));
      await fs.promises.rm(this.clipPath(String(row.file)), { force: true });
    }
    let names: string[];
    try {
      names = await fs.promises.readdir(this.options.clipDir);
    } catch {
      return;
    }
    const known = new Set((this.sql.clipFiles!.all() as Row[]).map((row) => String(row.file)));
    for (const name of names) {
      if (CLIP_FILE_RE.test(name)) {
        if (!known.has(name)) await fs.promises.rm(this.clipPath(name), { force: true });
      } else if (/^\.\d{1,15}-[0-9a-f]{16}\.clip\.tmp$/.test(name)) {
        const stat = await fs.promises.stat(this.clipPath(name)).catch(() => null);
        if (stat && now - stat.mtimeMs > 60 * 60_000) await fs.promises.rm(this.clipPath(name), { force: true });
      }
    }
  }

  /** Aufgehobene und abgelaufene Sperren nach 365 Tagen aus dem Verlauf löschen. */
  sweep(now = Date.now()): void {
    this.sql.deleteOldBans!.run(now - VOICE_BAN_HISTORY_MS);
  }

  // ---------- Team ----------

  /** Verlässlichkeit eines Meldenden: Anteil berechtigter unter den entschiedenen Meldungen. */
  private reliability(reporter: string, cache: Map<string, ReturnType<VoiceModeration['reliabilityOf']>>) {
    let value = cache.get(reporter);
    if (!value) {
      value = this.reliabilityOf(reporter);
      cache.set(reporter, value);
    }
    return value;
  }

  private reliabilityOf(reporter: string) {
    const counts: Record<string, number> = {};
    for (const row of this.sql.outcomesBy!.all(reporter) as Row[]) counts[String(row.outcome)] = Number(row.n);
    const justified = counts.justified ?? 0;
    const unjustified = counts.unjustified ?? 0;
    const unclear = counts.unclear ?? 0;
    const decided = justified + unjustified;
    return { justified, unjustified, unclear, share: decided === 0 ? null : Math.round((justified / decided) * 100) / 100 };
  }

  private teamBanView(ban: VoiceBanRow, now = Date.now()) {
    const active = ban.liftedAt === null && (ban.until === null || ban.until > now);
    return {
      id: ban.id,
      uuid: ban.uuid,
      name: ban.name,
      reason: ban.reason,
      reports: ban.reports,
      at: ban.at,
      until: ban.until,
      permanent: ban.until === null,
      by: ban.by,
      liftedAt: ban.liftedAt,
      liftedBy: ban.liftedBy,
      active,
    };
  }

  private reportView(report: VoiceReportRow, cache: Map<string, ReturnType<VoiceModeration['reliabilityOf']>>) {
    const guest = report.context.reporterGuest === true;
    const ban = this.activeBan(report.reported);
    return {
      id: report.id,
      kind: 'voice' as const,
      at: report.at,
      status: report.status,
      reason: report.reason,
      reasonLabel: VOICE_REPORT_REASON_LABELS[report.reason as VoiceReportReason] ?? report.reason,
      note: report.note,
      reporter: { uuid: report.reporter, name: report.reporterName, guest, reliability: guest ? null : this.reliability(report.reporter, cache) },
      reported: {
        uuid: report.reported,
        name: report.reportedName,
        banned: this.store.getBan(report.reported) !== undefined,
        voiceBan: ban ? this.teamBanView(ban) : null,
      },
      context: { client: report.context.client ?? null, service: report.context.service ?? null },
      levels: report.context.levels ?? null,
      clip: report.clip
        ? {
            ...report.clip,
            url: `/v1/team/voice/clips/${report.id}`,
            deleteAt: Math.min(report.clip.createdAt + CLIP_MAX_TTL_MS, report.doneAt === null ? Infinity : report.doneAt + CLIP_DONE_TTL_MS),
          }
        : null,
      doneAt: report.doneAt,
      doneBy: report.doneBy,
      outcome: report.outcome,
    };
  }

  /** Meldungen gebündelt je gemeldetem Spieler (Anzahl, offene, verschiedene Meldende, Zeitraum, Gründe). */
  private bundles(reports: VoiceReportRow[]) {
    const map = new Map<string, { reported: { uuid: string; name: string }; ids: number[]; open: number; reporters: Set<string>; first: number; last: number; reasons: Record<string, number> }>();
    for (const r of reports) {
      let entry = map.get(r.reported);
      if (!entry) {
        entry = { reported: { uuid: r.reported, name: r.reportedName }, ids: [], open: 0, reporters: new Set(), first: r.at, last: r.at, reasons: {} };
        map.set(r.reported, entry);
      }
      entry.ids.push(r.id);
      if (r.status === 'open') entry.open++;
      entry.reporters.add(r.reporter);
      entry.first = Math.min(entry.first, r.at);
      entry.last = Math.max(entry.last, r.at);
      entry.reasons[r.reason] = (entry.reasons[r.reason] ?? 0) + 1;
    }
    return [...map.values()]
      .map((e) => {
        const ban = this.activeBan(e.reported.uuid);
        return {
          reported: e.reported,
          reports: e.ids.length,
          open: e.open,
          reporters: e.reporters.size,
          first: e.first,
          last: e.last,
          reasons: e.reasons,
          ids: e.ids,
          voiceBan: ban ? this.teamBanView(ban) : null,
        };
      })
      .sort((a, b) => b.open - a.open || b.reporters - a.reporters || b.last - a.last);
  }

  /** `GET /v1/team/voice/reports?status=open|done|all` */
  teamReports(status: string | null) {
    const filter = status ?? 'open';
    if (!['open', 'done', 'all'].includes(filter)) throw new HttpError(400, '„status“ muss open, done oder all sein.');
    const statuses = filter === 'all' ? ['open', 'done'] : [filter];
    const rows = (this.sql.reports!.all(JSON.stringify(statuses)) as Row[]).map(toVoiceReport);
    const cache = new Map();
    return { reports: rows.map((r) => this.reportView(r, cache)), players: this.bundles(rows), reasons: VOICE_REPORT_REASON_LABELS };
  }

  private requireReport(id: number): VoiceReportRow {
    const row = this.sql.getReport!.get(id) as Row | undefined;
    if (!row) throw new HttpError(404, NO_SUCH_REPORT);
    return toVoiceReport(row);
  }

  /** `GET /v1/team/voice/reports/<id>` */
  teamReport(id: number) {
    return { report: this.reportView(this.requireReport(id), new Map()) };
  }

  /** `POST /v1/team/voice/reports/<id>/done { outcome }`: abschließen (zählt für die Verlässlichkeit des Meldenden). */
  teamReportDone(actor: Actor, id: number, input: Record<string, unknown>) {
    const report = this.requireReport(id);
    const outcome = input.outcome ?? 'unclear';
    if (!(VOICE_REPORT_OUTCOMES as readonly unknown[]).includes(outcome)) throw new HttpError(400, `„outcome“ muss ${VOICE_REPORT_OUTCOMES.join(', ')} sein.`);
    // Schon erledigt: nur das Ergebnis ändern (Zeitpunkt bleibt, damit die Löschfrist des Clips nicht wandert).
    const doneAt = report.doneAt ?? Date.now();
    this.sql.markDone!.run(doneAt, report.doneBy ?? actor.name, outcome as string, id);
    writeAudit(this.store, actor, 'voice.report.done', `Meldung ${id}`, String(outcome));
    return this.teamReport(id);
  }

  /** `GET /v1/team/voice`: Regeln, Schalter, Zahlen. */
  overview(extra: { connected: number }) {
    const rules = this.rules;
    return {
      rules: {
        published: rules ? { version: rules.version, at: rules.publishedAt, by: rules.publishedBy, length: rules.text.length } : null,
        text: rules?.text ?? DEFAULT_VOICE_RULES,
        defaultText: DEFAULT_VOICE_RULES,
        maxLength: VOICE_RULES_MAX,
      },
      clips: { active: this.clipsActive(), enabled: this.clipsEnabled, allowed: this.options.clipsAllowed, rulesPublished: rules !== null },
      stats: {
        openReports: Number((this.sql.countOpen!.get() as Row).n),
        activeBans: (this.sql.activeBans!.all(Date.now()) as Row[]).length,
        connected: extra.connected,
      },
      limits: this.limits(),
      durations: Object.keys(VOICE_BAN_DURATIONS),
      reasons: VOICE_REPORT_REASON_LABELS,
    };
  }

  countOpenReports(): number {
    return Number((this.sql.countOpen!.get() as Row).n);
  }

  /** `GET /v1/team/voice/rules/versions` */
  rulesVersions() {
    return {
      versions: (this.sql.allRules!.all() as Row[]).map(toRules).map((r) => ({
        version: r.version,
        text: r.text,
        at: r.publishedAt,
        by: r.publishedBy,
        withdrawnAt: r.withdrawnAt,
        withdrawnBy: r.withdrawnBy,
      })),
    };
  }

  /** `POST /v1/team/voice/rules { text }` (Admin): neue Version veröffentlichen – ab dann Pflicht-Zustimmung für alle. */
  publishRules(actor: Actor, input: Record<string, unknown>) {
    const checked = checkMultilineText(input.text ?? DEFAULT_VOICE_RULES, VOICE_RULES_MAX);
    if ('problem' in checked) throw new HttpError(400, `Der Text der Voice-Regeln muss 1 bis ${VOICE_RULES_MAX} Zeichen lang sein.`);
    const latest = this.sql.currentRules!.get() as Row | undefined;
    const version = latest ? Number(latest.version) + 1 : 1;
    // Ältere Versionen bleiben im Verlauf; es gilt immer die neueste (solange sie nicht zurückgezogen ist).
    this.sql.insertRules!.run(version, checked.text, Date.now(), actor.name);
    this.reload();
    writeAudit(this.store, actor, 'voice.rules.publish', `Version ${version}`, this.clipsActive() ? 'Aufnahmen beim Melden aktiv' : 'Aufnahmen aus');
    this.options.log(`Voice-Regeln: Version ${version} veröffentlicht – ab jetzt brauchen alle die Zustimmung.`);
    this.listener?.rulesPublished(version);
    return { version };
  }

  /** `DELETE /v1/team/voice/rules` (Admin): Regeln zurückziehen – keine Pflicht mehr, keine Aufnahmen. */
  withdrawRules(actor: Actor) {
    const rules = this.rules;
    if (!rules) throw new HttpError(404, 'Es sind keine Voice-Regeln veröffentlicht.');
    this.sql.withdrawRules!.run(Date.now(), actor.name, rules.version);
    this.reload();
    writeAudit(this.store, actor, 'voice.rules.withdraw', `Version ${rules.version}`);
    this.listener?.clipsChanged();
    return { version: null };
  }

  /** `PUT /v1/team/voice/settings { clips }` (Admin) */
  setSettings(actor: Actor, input: Record<string, unknown>) {
    if (typeof input.clips !== 'boolean') throw new HttpError(400, '„clips“ muss true oder false sein.');
    if (input.clips !== this.clipsEnabled) {
      this.sql.putSetting!.run('clips', input.clips ? '1' : '0');
      this.reload();
      writeAudit(this.store, actor, 'voice.clips', null, input.clips ? 'an' : 'aus');
      this.listener?.clipsChanged();
    }
    return { clips: { active: this.clipsActive(), enabled: this.clipsEnabled, allowed: this.options.clipsAllowed, rulesPublished: this.rules !== null } };
  }

  // ---------- Sperren ----------

  /** `GET /v1/team/voice/bans`: aktive Sperren und die letzten 100 Einträge. */
  teamBans() {
    const now = Date.now();
    return {
      bans: (this.sql.activeBans!.all(now) as Row[]).map(toBan).map((b) => this.teamBanView(b, now)),
      recent: (this.sql.recentBans!.all() as Row[]).map(toBan).map((b) => this.teamBanView(b, now)),
    };
  }

  /**
   * `PUT /v1/team/voice/bans/<uuid> { duration, reason, reports? }`: sperren (ersetzt eine laufende Sperre). Wirkt sofort:
   * die Voice-Verbindung schließt mit 4013, Gäste seiner Einladungen fliegen raus.
   */
  ban(actor: Actor, uuid: string, input: Record<string, unknown>, options: { minutes?: number } = {}) {
    const duration = input.duration;
    let length: number | null;
    if (options.minutes !== undefined) {
      length = options.minutes * 60_000;
    } else {
      if (typeof duration !== 'string' || !Object.hasOwn(VOICE_BAN_DURATIONS, duration)) {
        throw new HttpError(400, `„duration“ muss ${Object.keys(VOICE_BAN_DURATIONS).join(', ')} sein.`);
      }
      length = VOICE_BAN_DURATIONS[duration as VoiceBanDuration];
    }
    const reason = checkText(input.reason, MAX_VOICE_BAN_REASON, false);
    if ('problem' in reason) throw new HttpError(400, `Bitte einen Grund angeben (höchstens ${MAX_VOICE_BAN_REASON} Zeichen, eine Zeile).`);
    let reports: number[] = [];
    if (input.reports !== undefined && input.reports !== null) {
      if (!Array.isArray(input.reports) || input.reports.length > 50 || !input.reports.every((n) => Number.isInteger(n) && n > 0)) {
        throw new HttpError(400, '„reports“ muss eine Liste von Meldungsnummern sein.');
      }
      reports = [...new Set(input.reports as number[])];
      for (const id of reports) {
        const row = this.sql.getReport!.get(id) as Row | undefined;
        if (!row || String(row.reported) !== uuid) throw new HttpError(400, `Meldung ${id} gehört nicht zu diesem Spieler.`);
      }
    }
    if (uuid === actor.uuid) throw new HttpError(400, 'Du kannst dich nicht selbst sperren.');
    if (this.store.getTeamMember(uuid)) throw new HttpError(409, 'Team-Mitglieder lassen sich nicht vom Voice Chat sperren.');
    const user = this.store.getUser(uuid);
    const name = user?.name ?? this.store.getBan(uuid)?.name ?? '';
    if (!user && name === '') throw new HttpError(404, UNKNOWN_PLAYER);
    const now = Date.now();
    const until = length === null ? null : now + length;
    this.store.transaction(() => {
      this.sql.liftBan!.run(now, actor.name, uuid, now);
      this.sql.insertBan!.run(uuid, name, reason.text, JSON.stringify(reports), now, until, actor.name);
    });
    writeAudit(this.store, actor, 'voice.ban', playerLabel(name, uuid), `${until === null ? 'dauerhaft' : `bis ${new Date(until).toISOString()}`}: ${reason.text}`);
    const ban = this.activeBan(uuid, now);
    if (ban) this.listener?.banned(uuid, this.banGate(ban));
    return this.player(uuid);
  }

  /** `DELETE /v1/team/voice/bans/<uuid>`: Sperre aufheben (wirkt beim nächsten Verbinden). */
  unban(actor: Actor, uuid: string) {
    const ban = this.activeBan(uuid);
    if (!ban) throw new HttpError(404, 'Dieser Spieler ist nicht vom Voice Chat gesperrt.');
    this.sql.liftBan!.run(Date.now(), actor.name, uuid, Date.now());
    writeAudit(this.store, actor, 'voice.unban', playerLabel(ban.name, uuid));
    return this.player(uuid);
  }

  /** `GET /v1/team/voice/players/<uuid>`: Zeitleiste (Meldungen, Sperren, Zustimmung) und Protokoll. */
  player(uuid: string) {
    const user = this.store.getUser(uuid);
    const bans = (this.sql.bansOf!.all(uuid) as Row[]).map(toBan);
    const about = (this.sql.reportsAbout!.all(uuid) as Row[]).map(toVoiceReport);
    if (!user && bans.length === 0 && about.length === 0) throw new HttpError(404, 'Diesen Spieler gibt es beim Heldix-Dienst nicht.');
    const cache = new Map();
    const consent = this.sql.getConsent!.get(uuid) as Row | undefined;
    const now = Date.now();
    const active = this.activeBan(uuid, now);
    const timeline: { at: number; kind: string; [key: string]: unknown }[] = [];
    for (const r of about) timeline.push({ at: r.at, kind: 'report', id: r.id, reason: r.reason, reporter: r.reporterName, status: r.status, outcome: r.outcome });
    for (const b of bans) {
      timeline.push({ at: b.at, kind: 'ban', id: b.id, reason: b.reason, until: b.until, by: b.by });
      if (b.liftedAt !== null) timeline.push({ at: b.liftedAt, kind: 'unban', id: b.id, by: b.liftedBy });
    }
    if (consent) timeline.push({ at: Number(consent.at), kind: 'consent', version: Number(consent.version) });
    timeline.sort((a, b) => b.at - a.at);
    return {
      player: { uuid, name: user?.name ?? bans[0]?.name ?? about[0]?.reportedName ?? '', known: user !== undefined },
      ban: active ? this.teamBanView(active, now) : null,
      bans: bans.map((b) => this.teamBanView(b, now)),
      reportsAbout: about.map((r) => this.reportView(r, cache)),
      reportsBy: this.reliabilityOf(uuid),
      consent: consent ? { version: Number(consent.version), at: Number(consent.at) } : null,
      timeline,
      audit: (this.sql.voiceAudit!.all(`%(${uuid})`) as Row[]).map((row) => ({
        id: Number(row.id),
        at: Number(row.at),
        actor: String(row.actor_name),
        action: String(row.action),
        target: nullableString(row.target),
        detail: nullableString(row.detail),
      })),
    };
  }

  // ---------- Liste „Voice aus“ ----------

  /** `GET /v1/team/voice/servers` */
  teamServers() {
    return {
      servers: (this.sql.servers!.all() as Row[]).map((row) => ({
        domain: String(row.domain),
        subdomains: Number(row.subdomains) === 1,
        reason: String(row.reason),
        contact: String(row.contact),
        at: Number(row.at),
        by: nullableString(row.by_name),
      })),
    };
  }

  /** `PUT /v1/team/voice/servers/<domain> { subdomains, reason, contact? }` (Admin) */
  putServer(actor: Actor, rawDomain: string | undefined, input: Record<string, unknown>) {
    const domain = normalizeVoiceDomain(decodePath(rawDomain));
    if (domain === null) throw new HttpError(400, 'Ungültige Domain (z. B. mc.example.net, ohne Port).');
    const subdomains = input.subdomains ?? false;
    if (typeof subdomains !== 'boolean') throw new HttpError(400, '„subdomains“ muss true oder false sein.');
    const reason = checkText(input.reason, 200, false);
    if ('problem' in reason) throw new HttpError(400, 'Bitte einen Grund angeben (höchstens 200 Zeichen, eine Zeile).');
    const contact = checkText(input.contact ?? '', 200, true);
    if ('problem' in contact) throw new HttpError(400, 'Der Kontakt darf höchstens 200 Zeichen lang sein (eine Zeile).');
    this.sql.putServer!.run(domain, subdomains ? 1 : 0, reason.text, contact.text, Date.now(), actor.name);
    this.reload();
    writeAudit(this.store, actor, 'voice.server.add', subdomains ? `${domain} (mit Subdomains)` : domain, reason.text);
    this.listener?.serversChanged();
    return this.teamServers();
  }

  /** `DELETE /v1/team/voice/servers/<domain>` (Admin) */
  deleteServer(actor: Actor, rawDomain: string | undefined) {
    const domain = normalizeVoiceDomain(decodePath(rawDomain));
    if (domain === null || Number(this.sql.deleteServer!.run(domain).changes) === 0) throw new HttpError(404, 'Diese Domain steht nicht auf der Liste.');
    this.reload();
    writeAudit(this.store, actor, 'voice.server.remove', domain);
    this.listener?.serversChanged();
    return this.teamServers();
  }

  // ---------- Datenauskunft ----------

  /**
   * Datenauskunft: Zustimmung, eigene Voice-Sperren (ohne das Team-Mitglied) und eigene Voice-Meldungen mit Kontext (ob
   * es eine Aufnahme gibt, aber nicht die Aufnahme). Meldungen anderer über dich stehen nicht darin (Schutz der Meldenden).
   */
  exportFor(user: UserRow) {
    const consent = this.sql.getConsent!.get(user.uuid) as Row | undefined;
    return {
      consent: consent ? { version: Number(consent.version), at: Number(consent.at) } : null,
      bans: (this.sql.bansOf!.all(user.uuid) as Row[]).map(toBan).map((b) => ({ reason: b.reason, at: b.at, until: b.until, liftedAt: b.liftedAt })),
      reports: (this.sql.reportsBy!.all(user.uuid) as Row[]).map(toVoiceReport).map((r) => ({
        id: r.id,
        at: r.at,
        reported: { uuid: r.reported, name: r.reportedName },
        reason: r.reason,
        note: r.note,
        status: r.status,
        context: r.context.client ?? null,
        levels: r.context.levels ?? null,
        clip: r.clip ? { size: r.clip.size, durationMs: r.clip.durationMs } : null,
      })),
    };
  }

  /** Woher der Schlüssel für Clips kommt (für das Log beim Start), ohne ihn zu laden. */
  keyDescription(): string {
    return this.options.clipKey ? 'aus HELDIX_DIENST_VOICE_CLIP_KEY' : `aus ${path.basename(this.options.clipKeyFile)} im Datenordner`;
  }

  /** Nur für Tests: Woher kam der Schlüssel? */
  get clipKeySource(): 'env' | 'file' | null {
    return this.keySource;
  }
}
