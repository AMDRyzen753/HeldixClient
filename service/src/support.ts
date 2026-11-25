// Support-Anfragen: Spieler schreiben dem Team (Webseite, Launcher, Spiel), das Team antwortet im Team-Bereich.
import type { Store, TicketMessageRow, TicketRow, TicketStatus, UserRow } from './db';
import { HttpError } from './http';
import type { Realtime } from './realtime';
import { writeAudit, type Actor } from './team';
import { checkMultilineText, checkText, type TextProblem } from './validate';

export const TICKET_CATEGORIES = ['hilfe', 'fehler', 'konto', 'sonstiges'] as const;
export const MAX_SUBJECT = 100;
export const MAX_TICKET_TEXT = 2000;
/** So heißen Team-Antworten für Spieler, wenn das Mitglied nicht auf der Teamseite steht. */
export const TEAM_AUTHOR = 'HeldixClient-Team';
const NO_SUCH_TICKET = 'Diese Anfrage gibt es nicht (mehr).';
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

  /** Für die Datenauskunft: alle Anfragen des Spielers mit Nachrichten (Sicht des Spielers). */
  exportFor(user: UserRow) {
    return this.store.ticketsOf(user.uuid).map((t) => this.view(t, 'player'));
  }
}
