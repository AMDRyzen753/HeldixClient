// Support-Anfragen: Spieler schreiben dem Team (Webseite, Launcher, Spiel), das Team antwortet im Team-Bereich.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Store, TicketAttachmentRow, TicketMessageRow, TicketRow, TicketStatus, UserRow } from './db';
import { HttpError, readRawBody } from './http';
import type { Realtime } from './realtime';
import { writeAudit, type Actor } from './team';
import { checkMultilineText, checkText, type TextProblem } from './validate';

export const TICKET_CATEGORIES = ['hilfe', 'fehler', 'konto', 'sonstiges'] as const;
export const MAX_SUBJECT = 100;
export const MAX_TICKET_TEXT = 2000;
/** So heißen Team-Antworten für Spieler, wenn das Mitglied nicht auf der Teamseite steht. */
export const TEAM_AUTHOR = 'HeldixClient-Team';
const NO_SUCH_TICKET = 'Diese Anfrage gibt es nicht (mehr).';
const NO_SUCH_ATTACHMENT = 'Diesen Anhang gibt es nicht.';
/** Anhänge (z. B. Absturzbericht und Log aus der Absturzhilfe des Launchers): nur Text, höchstens 512 KiB. */
export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_ATTACHMENTS_PER_TICKET = 5;
export const ATTACHMENTS_PER_HOUR = 10;
const ATTACHMENT_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
const ATTACHMENT_EXTENSION_RE = /.(?:txt|log)$/i;
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface SupportLimits {
  /** Höchstens so viele nicht geschlossene Anfragen pro Spieler */
  maxOpen: number;
  /** Höchstens so viele neue Anfragen pro Spieler in 24 Stunden */
  perDay: number;
  /** Höchstens so viele Nachrichten pro Spieler und Stunde (auch die erste einer neuen Anfrage) */
  messagesPerHour: number;
}

type Viewer = 'player' | 'team';

function textError(field: string, max: number, problem: TextProblem): string {
  switch (problem) {
    case 'type':
      return `„${field}“ muss ein Text sein.`;
    case 'empty':
      return `„${field}“ darf nicht leer sein.`;
    case 'long':
      return `„${field}“ ist zu lang (höchstens ${max} Zeichen).`;
    case 'chars':
      return `„${field}“ enthält Zeichen, die nicht erlaubt sind.`;
  }
}

function retryAfter(until: number, now: number): Record<string, string> {
  return { 'Retry-After': String(Math.max(1, Math.ceil((until - now) / 1000))) };
}

export class Support {
  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly limits: SupportLimits,
  ) {}

  // ---------- Ansicht ----------

  /** `unread`: für den Spieler eine Team-Antwort nach seinem letzten Öffnen, für das Team die letzte Nachricht vom Spieler. */
  private summary(ticket: TicketRow, viewer: Viewer) {
    return {
      id: ticket.id,
      at: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      category: ticket.category,
      subject: ticket.subject,
      status: ticket.status,
      player: { uuid: ticket.uuid, name: ticket.name },
      attachments: this.store.ticketAttachments(ticket.id).map(({ id, name, size, at }) => ({ id, name, size, at })),
      unread: viewer === 'player' ? ticket.lastTeamId > ticket.playerReadId : !ticket.lastFromTeam,
    };
  }

  /** Ganze Anfrage. Für Spieler heißen Team-Antworten „HeldixClient-Team“, außer das Mitglied steht auf der Teamseite. */
  view(ticket: TicketRow, viewer: Viewer) {
    const visible = viewer === 'player' ? this.store.publicTeamUuids() : null;
    const author = (m: TicketMessageRow) => {
      if (!m.fromTeam || visible === null) return m.authorName;
      return m.authorUuid !== null && visible.has(m.authorUuid) ? m.authorName : TEAM_AUTHOR;
    };
    const { unread, ...rest } = this.summary(ticket, viewer);
    return {
      ...rest,
      messages: this.store.ticketMessages(ticket.id).map((m) => ({
        id: m.id,
        at: m.at,
        from: m.fromTeam ? ('team' as const) : ('player' as const),
        author: author(m),
        text: m.text,
      })),
      unread,
    };
  }

  private readText(value: unknown): string {
    const text = checkMultilineText(value, MAX_TICKET_TEXT);
    if ('problem' in text) throw new HttpError(400, textError('text', MAX_TICKET_TEXT, text.problem));
    return text.text;
  }

  private takePlayerMessage(user: UserRow, now: number): void {
    const recent = this.store.playerTicketMessagesSince(user.uuid, now - HOUR_MS);
    if (recent.count >= this.limits.messagesPerHour) {
      throw new HttpError(
        429,
        `Höchstens ${this.limits.messagesPerHour} Nachrichten pro Stunde. Bitte später weiterschreiben.`,
        retryAfter((recent.oldest ?? now) + HOUR_MS, now),
      );
    }
  }

  // ---------- Spieler ----------

  private own(user: UserRow, id: number): TicketRow {
    const ticket = this.store.getTicket(id);
    if (!ticket || ticket.uuid !== user.uuid) throw new HttpError(404, NO_SUCH_TICKET);
    return ticket;
  }

  /** `GET /v1/support` */
  list(user: UserRow) {
    return { tickets: this.store.ticketsOf(user.uuid).map((t) => this.summary(t, 'player')) };
  }

  /** `POST /v1/support` mit `{ category, subject, text }` */
  create(user: UserRow, input: Record<string, unknown>) {
    const { category } = input;
    if (typeof category !== 'string' || !(TICKET_CATEGORIES as readonly string[]).includes(category)) {
      throw new HttpError(400, `Ungültige Kategorie (erlaubt: ${TICKET_CATEGORIES.join(', ')}).`);
    }
    const subject = checkText(input.subject, MAX_SUBJECT, false);
    if ('problem' in subject) throw new HttpError(400, textError('subject', MAX_SUBJECT, subject.problem));
    const text = this.readText(input.text);
    if (this.store.countOpenTickets(user.uuid) >= this.limits.maxOpen) {
      throw new HttpError(409, `Du hast schon ${this.limits.maxOpen} offene Anfragen. Schließ eine, bevor du eine neue schreibst.`);
    }
    const now = Date.now();
    const today = this.store.ticketsSince(user.uuid, now - DAY_MS);
    if (today.count >= this.limits.perDay) {
      throw new HttpError(
        429,
        `Du hast in den letzten 24 Stunden schon ${this.limits.perDay} Anfragen geschrieben. Bitte später noch einmal.`,
        retryAfter((today.oldest ?? now) + DAY_MS, now),
      );
    }
    this.takePlayerMessage(user, now);
    const id = this.store.insertTicket(user.uuid, user.name, category, subject.text, text, now);
    return { ticket: this.view(this.store.getTicket(id)!, 'player') };
  }

  /** `GET /v1/support/<id>`: setzt `unread` zurück. */
  get(user: UserRow, id: number) {
    this.own(user, id);
    this.store.markTicketRead(id);
    return { ticket: this.view(this.store.getTicket(id)!, 'player') };
  }

  /** `POST /v1/support/<id>/messages`: Die Anfrage ist danach wieder offen. */
  reply(user: UserRow, id: number, input: Record<string, unknown>) {
    const ticket = this.own(user, id);
    const text = this.readText(input.text);
    if (ticket.status === 'closed') throw new HttpError(409, 'Diese Anfrage ist geschlossen. Bitte schreib eine neue.');
    const now = Date.now();
    this.takePlayerMessage(user, now);
    this.store.addTicketMessage(id, false, user, text, 'open', now);
    this.store.markTicketRead(id);
    return { ticket: this.view(this.store.getTicket(id)!, 'player') };
  }

  /** Grenzen für Anhänge: höchstens 5 je Anfrage (409), 10 je Spieler und Stunde (429). */
  private checkAttachmentLimits(user: UserRow, ticket: TicketRow, now: number): void {
    if (ticket.status === 'closed') throw new HttpError(409, 'Diese Anfrage ist geschlossen. Bitte schreib eine neue.');
    if (this.store.countTicketAttachments(ticket.id) >= MAX_ATTACHMENTS_PER_TICKET) {
      throw new HttpError(409, `Höchstens ${MAX_ATTACHMENTS_PER_TICKET} Anhänge pro Anfrage.`);
    }
    const recent = this.store.ticketAttachmentsSince(user.uuid, now - HOUR_MS);
    if (recent.count >= ATTACHMENTS_PER_HOUR) {
      throw new HttpError(429, `Höchstens ${ATTACHMENTS_PER_HOUR} Anhänge pro Stunde. Bitte später noch einmal.`, retryAfter((recent.oldest ?? now) + HOUR_MS, now));
    }
  }

  /**
   * `POST /v1/support/<id>/attachments?name=<datei>`: roher Text (`text/plain; charset=utf-8`, höchstens 512 KiB,
   * gültiges UTF-8 ohne NUL), Name aus A–Z, a–z, 0–9, `.`, `_`, `-` mit Endung .txt oder .log. Gespeichert gzip-komprimiert.
   * Wie eine Nachricht des Spielers: Die Anfrage ist danach wieder offen.
   */
  async attach(user: UserRow, id: number, name: string | null, req: IncomingMessage) {
    if (name === null || !ATTACHMENT_NAME_RE.test(name) || !ATTACHMENT_EXTENSION_RE.test(name)) {
      throw new HttpError(400, 'Ungültiger Dateiname (1–80 Zeichen aus A–Z, a–z, 0–9, „.“, „_“ und „-“, Endung .txt oder .log).');
    }
    const [type, ...params] = String(req.headers['content-type'] ?? '').toLowerCase().split(';').map((part) => part.trim());
    const charset = params.find((param) => param.startsWith('charset='))?.slice('charset='.length).replace(/"/g, '');
    if (type !== 'text/plain' || (charset !== undefined && charset !== 'utf-8' && charset !== 'utf8')) {
      throw new HttpError(415, 'Anhänge bitte als Text senden (Content-Type: text/plain; charset=utf-8).');
    }
    this.checkAttachmentLimits(user, this.own(user, id), Date.now());
    const data = await readRawBody(req, MAX_ATTACHMENT_BYTES);
    if (data.length === 0) throw new HttpError(400, 'Der Anhang ist leer.');
    try {
      strictUtf8.decode(data);
    } catch {
      throw new HttpError(400, 'Der Anhang ist kein gültiger UTF-8-Text.');
    }
    if (data.includes(0)) throw new HttpError(400, 'Der Anhang enthält Nullbytes und ist damit kein Text.');
    // Nach dem Empfang noch einmal (gleichzeitige Uploads), dann ohne Unterbrechung speichern.
    const now = Date.now();
    this.checkAttachmentLimits(user, this.own(user, id), now);
    this.store.addTicketAttachment(id, user.uuid, name, data.length, gzipSync(data), now);
    this.store.markTicketRead(id);
    return { ticket: this.view(this.store.getTicket(id)!, 'player') };
  }

  /** Anhang einer eigenen Anfrage (`GET /v1/support/<id>/attachments/<aid>`). */
  ownAttachment(user: UserRow, id: number, aid: number) {
    this.own(user, id);
    return this.attachment(id, aid);
  }

  private attachment(id: number, aid: number): TicketAttachmentRow & { data: Buffer } {
    const row = this.store.ticketAttachment(id, aid);
    if (!row) throw new HttpError(404, NO_SUCH_ATTACHMENT);
    return row;
  }

  /** Liefert einen Anhang als Download: immer Text, nie als HTML ausgewertet. */
  static sendAttachment(res: ServerResponse, row: TicketAttachmentRow & { data: Buffer }): void {
    const text = gunzipSync(row.data, { maxOutputLength: MAX_ATTACHMENT_BYTES + 1 });
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${row.name}"`,
      'Content-Length': String(text.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.end(text);
  }

  /** `POST /v1/support/<id>/close` */
  close(user: UserRow, id: number) {
    this.own(user, id);
    this.store.closeTicket(id, Date.now());
    this.store.markTicketRead(id);
    return { ticket: this.view(this.store.getTicket(id)!, 'player') };
  }

  // ---------- Team ----------

  private any(id: number): TicketRow {
    const ticket = this.store.getTicket(id);
    if (!ticket) throw new HttpError(404, NO_SUCH_TICKET);
    return ticket;
  }

  /** `GET /v1/team/support?status=…` (ohne: open) */
  teamList(status: string | null) {
    const filter = status ?? 'open';
    const statuses: Record<string, TicketStatus[]> = {
      open: ['open'],
      answered: ['answered'],
      closed: ['closed'],
      all: ['open', 'answered', 'closed'],
    };
    if (!Object.hasOwn(statuses, filter)) throw new HttpError(400, '„status“ muss open, answered, closed oder all sein.');
    return { tickets: this.store.tickets(statuses[filter]!).map((t) => this.summary(t, 'team')) };
  }

  teamGet(id: number) {
    return { ticket: this.view(this.any(id), 'team') };
  }

  /** `GET /v1/team/support/<id>/attachments/<aid>` (jede Rolle) */
  teamAttachment(id: number, aid: number) {
    this.any(id);
    return this.attachment(id, aid);
  }

  /** `POST /v1/team/support/<id>/messages`: Antwort; der Spieler bekommt sie sofort über den WebSocket gemeldet. */
  teamReply(actor: Actor & { uuid: string }, id: number, input: Record<string, unknown>) {
    const ticket = this.any(id);
    const text = this.readText(input.text);
    if (ticket.status === 'closed') throw new HttpError(409, 'Diese Anfrage ist geschlossen.');
    this.store.addTicketMessage(id, true, actor, text, 'answered', Date.now());
    this.realtime.send(ticket.uuid, { type: 'support', id, subject: ticket.subject });
    writeAudit(this.store, actor, 'support.reply', `Anfrage ${id} (${ticket.name})`);
    return { ticket: this.view(this.store.getTicket(id)!, 'team') };
  }

  teamClose(actor: Actor, id: number) {
    const ticket = this.any(id);
    if (this.store.closeTicket(id, Date.now())) writeAudit(this.store, actor, 'support.close', `Anfrage ${id} (${ticket.name})`);
    return { ticket: this.view(this.store.getTicket(id)!, 'team') };
  }

  /** Für die Datenauskunft: alle Anfragen des Spielers mit Nachrichten und den Namen und Größen der Anhänge (Sicht des Spielers). */
  exportFor(user: UserRow) {
    return this.store.ticketsOf(user.uuid).map((t) => this.view(t, 'player'));
  }
}
