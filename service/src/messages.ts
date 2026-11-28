// Direktnachrichten zwischen Freunden: Unterhaltungen, Verlauf, Senden und „gelesen“. Ab 1.12.0 (Freunde 2.0) dazu
// Antworten auf eine Nachricht, Beitreten-Karten, Reaktionen (feste Auswahl, eine je Person), eigene Nachrichten löschen
// (für beide) und „schreibt …“ (nur Echtzeit, gedrosselt, nie gespeichert).
import { CARD_KINDS, type CardKind, type MessageCard, type MessageRow, type Store, type UserRow } from './db';
import { HttpError } from './http';
import type { RateLimiter } from './limits';
import type { Realtime } from './realtime';
import { checkText, isInviteCode, normalizeServer, type TextProblem } from './validate';
import { WORLD_CODE_RE } from './worlds';

/** Kurzform der Nachricht, auf die geantwortet wird; `text` null, wenn sie gelöscht ist. */
export interface ReplyRef {
  id: number;
  from: string | null;
  text: string | null;
}

export interface Message {
  id: number;
  from: string;
  to: string;
  text: string;
  at: number;
  read: boolean;
  replyTo: ReplyRef | null;
  card: MessageCard | null;
  /** UUID → Reaktion (höchstens eine je Person) */
  reactions: Record<string, Reaction>;
}

export interface Conversation {
  uuid: string;
  name: string;
  last: Message;
  unread: number;
}

export interface MessageOptions {
  /** Begrenzung pro Absender (Nachrichten pro Zeitraum). */
  limiter: RateLimiter;
  /** Höchstens so viele Nachrichten pro Unterhaltung; ältere werden gelöscht. */
  maxPerConversation: number;
  /** „schreibt …“ höchstens einmal je Absender, Empfänger und Zeitraum (Standard 3 s). */
  typingIntervalMs?: number;
}

/** Höchstlänge einer Nachricht in Unicode-Zeichen. */
export const MAX_MESSAGE_LENGTH = 500;
/** Nachrichten pro Seite beim Verlauf: Standard und Höchstwert. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
/** Titel einer Beitreten-Karte. */
export const MAX_CARD_TITLE = 60;
/** So viel vom Text der Nachricht, auf die geantwortet wird, steht in `replyTo`. */
export const REPLY_PREVIEW = 100;

/** Die acht festen Reaktionen (ID → Emoji). Clients zeigen das Emoji bzw. ein eigenes Zeichen dafür. */
export const REACTIONS = {
  like: '👍',
  love: '❤️',
  laugh: '😂',
  wow: '😮',
  sad: '😢',
  party: '🎉',
  fire: '🔥',
  eyes: '👀',
} as const;
export type Reaction = keyof typeof REACTIONS;

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && Object.hasOwn(REACTIONS, value);
}

export const NOT_A_FRIEND = 'Dieser Spieler ist nicht in deiner Freundesliste.';
export const NO_SUCH_MESSAGE = 'Diese Nachricht gibt es nicht (mehr).';

const TEXT_ERRORS: Record<TextProblem, string> = {
  type: '„text“ muss ein Text sein.',
  empty: 'Die Nachricht ist leer.',
  long: `Die Nachricht ist zu lang (höchstens ${MAX_MESSAGE_LENGTH} Zeichen).`,
  chars: 'Die Nachricht enthält Zeichen, die nicht erlaubt sind (z. B. Zeilenumbrüche).',
};

/** Erste `max` Unicode-Zeichen. */
function preview(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

/** Zusatzdaten für die Ansicht mehrerer Nachrichten (gebündelt geladen). */
interface ViewExtras {
  replies: Map<number, MessageRow>;
  reactions: Map<number, Record<string, string>>;
}

/**
 * Nachricht aus Sicht von `viewer`. `read` sagt, ob der Abrufende sie gelesen hat; eigene Nachrichten
 * gelten immer als gelesen. So erfährt der Absender nie, ob der Freund sie gelesen hat (keine Lesebestätigung).
 */
export function messageView(row: MessageRow, viewer: string, extras?: ViewExtras): Message {
  let replyTo: ReplyRef | null = null;
  if (row.replyTo !== null) {
    const original = extras?.replies.get(row.replyTo);
    replyTo = original ? { id: original.id, from: original.from, text: preview(original.text, REPLY_PREVIEW) } : { id: row.replyTo, from: null, text: null };
  }
  const reactions: Record<string, Reaction> = {};
  for (const [uuid, reaction] of Object.entries(extras?.reactions.get(row.id) ?? {})) if (isReaction(reaction)) reactions[uuid] = reaction;
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    text: row.text,
    at: row.at,
    read: row.from === viewer ? true : row.read,
    replyTo,
    card: row.card,
    reactions,
  };
}

/** Karte aus der Anfrage prüfen (`null` oder fehlend: keine). */
function checkCard(value: unknown): MessageCard | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '„card“ muss ein Objekt mit kind, target und title sein.');
  const { kind, target, title } = value as Record<string, unknown>;
  if (!(CARD_KINDS as readonly unknown[]).includes(kind)) throw new HttpError(400, '„card.kind“ muss "server", "world" oder "invite" sein.');
  let checkedTarget: string | null = null;
  if (kind === 'server') checkedTarget = normalizeServer(target);
  else if (kind === 'world') checkedTarget = typeof target === 'string' && WORLD_CODE_RE.test(target.toLowerCase()) ? target.toLowerCase() : null;
  else checkedTarget = isInviteCode(target) ? target : null;
  if (checkedTarget === null) {
    throw new HttpError(
      400,
      kind === 'server'
        ? 'Diese Server-Adresse geht nicht (nur öffentliche Domains, keine IP-Adressen).'
        : kind === 'world'
          ? 'Ungültiger Welt-Code (6 Zeichen).'
          : 'Ungültiger Einladungs-Code (10 Zeichen).',
    );
  }
  const checkedTitle = checkText(title ?? '', MAX_CARD_TITLE, true);
  if ('problem' in checkedTitle) {
    throw new HttpError(400, checkedTitle.problem === 'long' ? `„card.title“ ist zu lang (höchstens ${MAX_CARD_TITLE} Zeichen).` : '„card.title“ muss ein einzeiliger Text sein.');
  }
  return { kind: kind as CardKind, target: checkedTarget, title: checkedTitle.text };
}

export class Messages {
  /** Letztes weitergegebenes „schreibt …“ je Absender und Empfänger (nur im Arbeitsspeicher). */
  private readonly typing = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly options: MessageOptions,
  ) {}

  /** Nachrichten mit Antwort-Bezug und Reaktionen (gebündelt geladen). */
  private views(rows: MessageRow[], viewer: string): Message[] {
    const replyIds = rows.map((row) => row.replyTo).filter((id): id is number => id !== null);
    const extras: ViewExtras = { replies: this.store.messagesByIds(replyIds), reactions: this.store.reactionsFor(rows.map((row) => row.id)) };
    return rows.map((row) => messageView(row, viewer, extras));
  }

  private view(row: MessageRow, viewer: string): Message {
    return this.views([row], viewer)[0]!;
  }

  /** `GET /v1/messages`: eine Zeile pro Freund mit Nachrichten, die neueste Unterhaltung zuerst. */
  conversations(uuid: string): { conversations: Conversation[] } {
    const rows = this.store.listConversations(uuid);
    const lasts = this.views(
      rows.map((row) => row.last),
      uuid,
    );
    return {
      conversations: rows.map((row, i) => ({ uuid: row.uuid, name: row.name, last: lasts[i]!, unread: row.unread })),
    };
  }

  /** `GET /v1/messages/<uuid>`: die neuesten `limit` Nachrichten vor `before`, älteste zuerst. */
  history(me: UserRow, friendUuid: string, before: number | undefined, limit: number): { messages: Message[]; more: boolean } {
    if (this.store.friendsSince(me.uuid, friendUuid) === undefined) throw new HttpError(404, NOT_A_FRIEND);
    const page = this.store.conversationPage(me.uuid, friendUuid, before, limit);
    return { messages: this.views(page.messages.reverse(), me.uuid), more: page.more };
  }

  /**
   * `POST /v1/messages/<uuid>` mit `{ text, replyTo?, card? }`: Nachricht an einen Freund. Beide Seiten bekommen sie
   * sofort über alle Verbindungen. `text` bleibt Pflicht (Rückfall für ältere Clients, die Karten nicht kennen).
   */
  send(me: UserRow, friendUuid: string, input: Record<string, unknown>): { message: Message } {
    const checked = checkText(input.text, MAX_MESSAGE_LENGTH, false);
    if ('problem' in checked) throw new HttpError(400, TEXT_ERRORS[checked.problem]);
    const card = checkCard(input.card);
    let replyTo: number | null = null;
    if (input.replyTo !== undefined && input.replyTo !== null) {
      const original = typeof input.replyTo === 'number' && Number.isSafeInteger(input.replyTo) ? this.store.getMessage(input.replyTo) : undefined;
      const sameConversation =
        original !== undefined && ((original.from === me.uuid && original.to === friendUuid) || (original.from === friendUuid && original.to === me.uuid));
      if (!sameConversation) throw new HttpError(400, 'Auf diese Nachricht kannst du nicht antworten (sie gehört nicht zu dieser Unterhaltung).');
      replyTo = original.id;
    }
    const friend = this.store.friendsSince(me.uuid, friendUuid) === undefined ? undefined : this.store.getUser(friendUuid);
    if (!friend) throw new HttpError(403, 'Nachrichten gehen nur an Freunde.');
    if (!friend.messages) throw new HttpError(403, `${friend.name} nimmt gerade keine Nachrichten an.`);
    const rate = this.options.limiter.take(me.uuid);
    if (!rate.ok) throw new HttpError(429, 'Zu viele Nachrichten. Warte kurz.', { 'Retry-After': String(rate.retryAfter) });

    const row = this.store.insertMessage(me.uuid, friend.uuid, checked.text, Date.now(), this.options.maxPerConversation, { replyTo, card });
    // Eine neue Nachricht beendet „schreibt …“ beim Empfänger (der Client blendet es aus).
    this.typing.delete(`${me.uuid}>${friend.uuid}`);
    this.realtime.send(friend.uuid, { type: 'message', message: this.view(row, friend.uuid), name: me.name });
    this.realtime.send(me.uuid, { type: 'message', message: this.view(row, me.uuid), name: me.name });
    return { message: this.view(row, me.uuid) };
  }

  /**
   * `POST /v1/messages/<uuid>/read`: alle Nachrichten des Freundes als gelesen markieren. Nur die eigenen
   * Verbindungen erfahren davon (Abgleich zwischen mehreren Geräten), der Freund nicht.
   */
  markRead(me: UserRow, friendUuid: string): { ok: true } {
    if (this.store.friendsSince(me.uuid, friendUuid) === undefined) throw new HttpError(404, NOT_A_FRIEND);
    this.store.markRead(friendUuid, me.uuid);
    this.realtime.send(me.uuid, { type: 'read', uuid: friendUuid });
    return { ok: true };
  }

  /** Nachricht `id` der Unterhaltung mit `friendUuid` (beide Richtungen) oder 404. */
  private inConversation(me: UserRow, friendUuid: string, id: number): MessageRow {
    if (this.store.friendsSince(me.uuid, friendUuid) === undefined) throw new HttpError(404, NOT_A_FRIEND);
    const row = this.store.getMessage(id);
    const ok = row !== undefined && ((row.from === me.uuid && row.to === friendUuid) || (row.from === friendUuid && row.to === me.uuid));
    if (!ok) throw new HttpError(404, NO_SUCH_MESSAGE);
    return row;
  }

  /** Neue Reaktionen an beide Seiten: `{ type: 'reaction', uuid: <Gegenüber>, id, reactions }`. */
  private pushReactions(row: MessageRow): Message {
    const viewFor = (viewer: string) => this.view(row, viewer);
    for (const [viewer, other] of [
      [row.from, row.to],
      [row.to, row.from],
    ] as const) {
      this.realtime.send(viewer, { type: 'reaction', uuid: other, id: row.id, reactions: viewFor(viewer).reactions });
    }
    return viewFor(row.from);
  }

  /** `PUT /v1/messages/<uuid>/<id>/reaction` mit `{ reaction }`: eigene Reaktion setzen oder ersetzen. */
  react(me: UserRow, friendUuid: string, id: number, input: Record<string, unknown>): { message: Message } {
    if (!isReaction(input.reaction)) {
      throw new HttpError(400, `„reaction“ muss eine dieser Reaktionen sein: ${Object.keys(REACTIONS).join(', ')}.`);
    }
    const row = this.inConversation(me, friendUuid, id);
    const rate = this.options.limiter.take(me.uuid);
    if (!rate.ok) throw new HttpError(429, 'Zu viele Nachrichten. Warte kurz.', { 'Retry-After': String(rate.retryAfter) });
    this.store.setReaction(row.id, me.uuid, input.reaction, Date.now());
    this.pushReactions(row);
    return { message: this.view(row, me.uuid) };
  }

  /** `DELETE /v1/messages/<uuid>/<id>/reaction`: eigene Reaktion zurücknehmen. */
  unreact(me: UserRow, friendUuid: string, id: number): { message: Message } {
    const row = this.inConversation(me, friendUuid, id);
    if (this.store.deleteReaction(row.id, me.uuid)) this.pushReactions(row);
    return { message: this.view(row, me.uuid) };
  }

  /**
   * `DELETE /v1/messages/<uuid>/<id>`: eigene Nachricht löschen, für beide (mit ihren Reaktionen). Beide Seiten bekommen
   * `{ type: 'message-deleted', uuid: <Gegenüber>, id }`. Fremde Nachrichten: 403.
   */
  remove(me: UserRow, friendUuid: string, id: number): { ok: true } {
    const row = this.inConversation(me, friendUuid, id);
    if (row.from !== me.uuid) throw new HttpError(403, 'Du kannst nur deine eigenen Nachrichten löschen.');
    if (this.store.deleteOwnMessage(row.id, me.uuid)) {
      this.realtime.send(row.to, { type: 'message-deleted', uuid: row.from, id: row.id });
      this.realtime.send(row.from, { type: 'message-deleted', uuid: row.to, id: row.id });
    }
    return { ok: true };
  }

  /**
   * „schreibt …“ von `from` an `to` (Echtzeit `typing` oder `POST /v1/messages/<uuid>/typing`). Nur an Freunde, die
   * Nachrichten annehmen; höchstens einmal je Zeitraum weitergegeben. Nichts wird gespeichert.
   */
  typingFrom(from: string, to: string): void {
    if (this.store.friendsSince(from, to) === undefined) return;
    const now = Date.now();
    const key = `${from}>${to}`;
    const last = this.typing.get(key);
    if (last !== undefined && now - last < (this.options.typingIntervalMs ?? 3000)) return;
    const target = this.store.getUser(to);
    if (!target || !target.messages) return;
    if (this.typing.size >= 10_000) this.sweepTyping(now);
    this.typing.set(key, now);
    this.realtime.send(to, { type: 'typing', from });
  }

  /** `POST /v1/messages/<uuid>/typing` (für Clients ohne WebSocket). */
  typingRoute(me: UserRow, friendUuid: string): { ok: true } {
    if (this.store.friendsSince(me.uuid, friendUuid) === undefined) throw new HttpError(404, NOT_A_FRIEND);
    this.typingFrom(me.uuid, friendUuid);
    return { ok: true };
  }

  sweepTyping(now = Date.now()): void {
    const interval = this.options.typingIntervalMs ?? 3000;
    for (const [key, at] of this.typing) if (now - at >= interval) this.typing.delete(key);
  }
}
