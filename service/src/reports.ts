// Melden: Spieler melden einen anderen; der Betreiber prüft die Meldung mit heldix-dienst-admin (src/admin.ts). Ab 1.14.0
// auch geteilte Setups und öffentliche Spielerprofile (Art `setup` bzw. `profile`, Stand beim Melden in `context`).
import type { StatementSync } from 'node:sqlite';
import type { Store, UserRow } from './db';
import { UNKNOWN_PLAYER } from './friends';
import { HttpError } from './http';
import { checkText, isUuid, type TextProblem } from './validate';

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Höchstlänge der Notiz in Unicode-Zeichen. */
export const MAX_NOTE_LENGTH = 300;
/** So viele der letzten Nachrichten zwischen beiden kommen als Beleg in die Meldung. */
export const SNAPSHOT_SIZE = 20;

/** Eine Nachricht im Beleg einer Meldung. */
export interface SnapshotMessage {
  id: number;
  from: string;
  to: string;
  text: string;
  at: number;
}

export interface ReportLimits {
  /** Höchstens so viele Meldungen pro Meldendem und Zeitraum (und eine pro gemeldetem Spieler). */
  perReporter: number;
  windowMs: number;
}

const NOTE_ERRORS: Record<TextProblem, string> = {
  type: '„note“ muss ein Text sein.',
  empty: '',
  long: `Die Notiz ist zu lang (höchstens ${MAX_NOTE_LENGTH} Zeichen).`,
  chars: 'Die Notiz enthält Zeichen, die nicht erlaubt sind (z. B. Zeilenumbrüche).',
};

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

function retryAfter(until: number, now: number): Record<string, string> {
  return { 'Retry-After': String(Math.max(1, Math.ceil((until - now) / 1000))) };
}

/** Ab 1.14.0: Meldung zu etwas, das einem Spieler gehört (Setup, öffentliches Profil). */
export interface SubjectReport {
  kind: 'setup' | 'profile';
  /** Schlüssel des Gemeldeten (Code des Setups bzw. UUID des Profils): höchstens eine offene Meldung je Meldendem */
  subject: string;
  /** Wem es gehört (Ersteller bzw. Inhaber des Profils) */
  owner: { uuid: string; name: string };
  /** Stand beim Melden für das Team (Name, Beschreibung bzw. Bio) */
  snapshot: Record<string, unknown>;
}

const SELF_REPORT: Record<SubjectReport['kind'], string> = {
  setup: 'Dein eigenes Setup kannst du nicht melden.',
  profile: 'Du kannst dich nicht selbst melden.',
};

export class Reports {
  private readonly sql: Record<'insert' | 'openPair' | 'since', StatementSync>;

  constructor(
    private readonly store: Store,
    private readonly limits: ReportLimits,
    private readonly log: (line: string) => void,
  ) {
    this.sql = {
      insert: store.prepare(`INSERT INTO reports (reporter, reporter_name, reported, reported_name, reason, note, messages, at, kind, context)
        VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`),
      openPair: store.prepare("SELECT 1 AS x FROM reports WHERE reporter = ? AND kind = ? AND status = 'open' AND json_extract(context, '$.subject') = ? LIMIT 1"),
      since: store.prepare("SELECT count(*) AS n, min(at) AS oldest FROM reports WHERE reporter = ? AND kind IN ('setup', 'profile') AND at > ?"),
    };
  }

  /**
   * Ab 1.14.0: `POST /v1/setups/<code>/report` bzw. `POST /v1/public/players/<name>/report` mit `{ reason, note? }`.
   * Gründe wie bei Spielern; je Meldendem eine offene Meldung je Setup bzw. Profil und zusammen höchstens so viele wie
   * bei Spielern in 24 Stunden. Die Meldung erscheint in den Meldungen des Teams (`kind` setup bzw. profile).
   */
  reportSubject(me: UserRow, target: SubjectReport, input: Record<string, unknown>): { reported: true } {
    const { reason } = input;
    if (!isReportReason(reason)) throw new HttpError(400, `Ungültiger Grund (erlaubt: ${REPORT_REASONS.join(', ')}).`);
    let note = '';
    if (input.note !== undefined && input.note !== null) {
      const checked = checkText(input.note, MAX_NOTE_LENGTH, true);
      if ('problem' in checked) throw new HttpError(400, NOTE_ERRORS[checked.problem]);
      note = checked.text;
    }
    if (target.owner.uuid === me.uuid) throw new HttpError(400, SELF_REPORT[target.kind]);
    if (this.sql.openPair.get(me.uuid, target.kind, target.subject) !== undefined) {
      throw new HttpError(429, 'Das hast du schon gemeldet. Das Team schaut es sich an.');
    }
    const now = Date.now();
    const recent = this.sql.since.get(me.uuid, now - this.limits.windowMs) as { n: number; oldest: number | null };
    if (Number(recent.n) >= this.limits.perReporter) {
      throw new HttpError(
        429,
        `Du hast in den letzten 24 Stunden schon ${this.limits.perReporter} Setups oder Profile gemeldet. Versuche es später noch einmal.`,
        retryAfter(Number(recent.oldest ?? now) + this.limits.windowMs, now),
      );
    }
    const context = JSON.stringify({ subject: target.subject, [target.kind]: target.snapshot });
    const result = this.sql.insert.run(me.uuid, me.name, target.owner.uuid, target.owner.name, reason, note, now, target.kind, context);
    // Ohne Namen und Inhalte: Das Log soll nur zeigen, dass es etwas zu prüfen gibt.
    this.log(`Neue Meldung #${Number(result.lastInsertRowid)} (${target.kind === 'setup' ? 'Setup' : 'Profil'}, Grund: ${reason}).`);
    return { reported: true };
  }

  /** `POST /v1/reports` mit `{ uuid, reason, note? }`. */
  report(me: UserRow, input: Record<string, unknown>): { reported: true } {
    const { uuid, reason } = input;
    if (!isUuid(uuid)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
    if (!isReportReason(reason)) throw new HttpError(400, `Ungültiger Grund (erlaubt: ${REPORT_REASONS.join(', ')}).`);
    let note = '';
    if (input.note !== undefined && input.note !== null) {
      const checked = checkText(input.note, MAX_NOTE_LENGTH, true);
      if ('problem' in checked) throw new HttpError(400, NOTE_ERRORS[checked.problem]);
      note = checked.text;
    }
    if (uuid === me.uuid) throw new HttpError(400, 'Du kannst dich nicht selbst melden.');
    const target = this.store.getUser(uuid);
    if (!target) throw new HttpError(404, UNKNOWN_PLAYER);

    const now = Date.now();
    const since = now - this.limits.windowMs;
    const last = this.store.lastPairReport(me.uuid, target.uuid, since);
    if (last !== null) {
      throw new HttpError(429, `Du hast ${target.name} in den letzten 24 Stunden schon gemeldet.`, retryAfter(last + this.limits.windowMs, now));
    }
    const recent = this.store.reportsSince(me.uuid, since);
    if (recent.count >= this.limits.perReporter) {
      throw new HttpError(
        429,
        `Du hast in den letzten 24 Stunden schon ${this.limits.perReporter} Spieler gemeldet. Versuche es später noch einmal.`,
        retryAfter((recent.oldest ?? now) + this.limits.windowMs, now),
      );
    }

    // Beleg: die letzten Nachrichten zwischen beiden (beide Richtungen), älteste zuerst.
    const snapshot: SnapshotMessage[] = this.store
      .conversationPage(me.uuid, target.uuid, undefined, SNAPSHOT_SIZE)
      .messages.reverse()
      .map(({ id, from, to, text, at }) => ({ id, from, to, text, at }));
    const id = this.store.insertReport({
      reporter: me.uuid,
      reporterName: me.name,
      reported: target.uuid,
      reportedName: target.name,
      reason,
      note,
      messages: JSON.stringify(snapshot),
      at: now,
    });
    // Ohne Namen: Das Log soll nur zeigen, dass es etwas zu prüfen gibt.
    this.log(`Neue Meldung #${id} (Grund: ${reason}). Ansehen mit: heldix-dienst-admin meldungen`);
    return { reported: true };
  }
}
