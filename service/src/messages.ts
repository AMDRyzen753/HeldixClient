// Direktnachrichten zwischen Freunden: Unterhaltungen, Verlauf, Senden und „gelesen“.
import type { MessageRow, Store, UserRow } from './db';
import { HttpError } from './http';
import type { RateLimiter } from './limits';
import type { Realtime } from './realtime';
import { checkText, type TextProblem } from './validate';

export interface Message {
  id: number;
  from: string;
  to: string;
  text: string;
  at: number;
  read: boolean;
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
}

/** Höchstlänge einer Nachricht in Unicode-Zeichen. */
export const MAX_MESSAGE_LENGTH = 500;
/** Nachrichten pro Seite beim Verlauf: Standard und Höchstwert. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export const NOT_A_FRIEND = 'Dieser Spieler ist nicht in deiner Freundesliste.';

const TEXT_ERRORS: Record<TextProblem, string> = {
  type: '„text“ muss ein Text sein.',
  empty: 'Die Nachricht ist leer.',
  long: `Die Nachricht ist zu lang (höchstens ${MAX_MESSAGE_LENGTH} Zeichen).`,
  chars: 'Die Nachricht enthält Zeichen, die nicht erlaubt sind (z. B. Zeilenumbrüche).',
};

/**
 * Nachricht aus Sicht von `viewer`. `read` sagt, ob der Abrufende sie gelesen hat; eigene Nachrichten
 * gelten immer als gelesen. So erfährt der Absender nie, ob der Freund sie gelesen hat (keine Lesebestätigung).
 */
export function messageView(row: MessageRow, viewer: string): Message {
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    text: row.text,
    at: row.at,
    read: row.from === viewer ? true : row.read,
  };
}

export class Messages {
  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly options: MessageOptions,
  ) {}

  /** `GET /v1/messages`: eine Zeile pro Freund mit Nachrichten, die neueste Unterhaltung zuerst. */
  conversations(uuid: string): { conversations: Conversation[] } {
    return {
      conversations: this.store.listConversations(uuid).map((row) => ({
        uuid: row.uuid,
        name: row.name,
        last: messageView(row.last, uuid),
        unread: row.unread,
      })),
    };
  }

  /** `GET /v1/messages/<uuid>`: die neuesten `limit` Nachrichten vor `before`, älteste zuerst. */
  history(me: UserRow, friendUuid: string, before: number | undefined, limit: number): { messages: Message[]; more: boolean } {
    if (this.store.friendsSince(me.uuid, friendUuid) === undefined) throw new HttpError(404, NOT_A_FRIEND);
    const page = this.store.conversationPage(me.uuid, friendUuid, before, limit);
    return { messages: page.messages.reverse().map((row) => messageView(row, me.uuid)), more: page.more };
  }

  /** `POST /v1/messages/<uuid>`: Nachricht an einen Freund. Beide Seiten bekommen sie sofort über alle Verbindungen. */
  send(me: UserRow, friendUuid: string, input: unknown): { message: Message } {
    const checked = checkText(input, MAX_MESSAGE_LENGTH, false);
    if ('problem' in checked) throw new HttpError(400, TEXT_ERRORS[checked.problem]);
    const friend = this.store.friendsSince(me.uuid, friendUuid) === undefined ? undefined : this.store.getUser(friendUuid);
    if (!friend) throw new HttpError(403, 'Nachrichten gehen nur an Freunde.');
    if (!friend.messages) throw new HttpError(403, `${friend.name} nimmt gerade keine Nachrichten an.`);
    const rate = this.options.limiter.take(me.uuid);
    if (!rate.ok) throw new HttpError(429, 'Zu viele Nachrichten. Warte kurz.', { 'Retry-After': String(rate.retryAfter) });

    const row = this.store.insertMessage(me.uuid, friend.uuid, checked.text, Date.now(), this.options.maxPerConversation);
    this.realtime.send(friend.uuid, { type: 'message', message: messageView(row, friend.uuid), name: me.name });
    this.realtime.send(me.uuid, { type: 'message', message: messageView(row, me.uuid), name: me.name });
    return { message: messageView(row, me.uuid) };
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
}
