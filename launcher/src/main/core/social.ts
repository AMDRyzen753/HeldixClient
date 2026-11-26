// Freunde und Nachrichten im Launcher über den Heldix-Dienst (siehe docs/dienst.md).
//
// Bewusst ohne WebSocket: Eine offene Verbindung würde den Spieler bei seinen Freunden als „online“ zeigen, obwohl er
// nur im Launcher ist. Stattdessen fragt der Launcher GET /v1/friends ab – alle 20 s, solange ein Fenster sichtbar ist,
// sonst alle 60 s, und sofort nach einem Kontowechsel, jeder Aktion und refresh().

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  BlockedPlayer,
  ChatMessage,
  Conversation,
  Friend,
  FriendActivity,
  FriendRequest,
  ReportReason,
  SocialOverview,
  SocialPrivacy,
  SocialStatus,
} from '../../shared/api';
import { SERVICE_UNREACHABLE, ServiceError, isLoopback, serviceBase, serviceFetch, serviceLogin, serviceRequest, type ServiceToken } from './heldixservice';

export const POLL_VISIBLE_MS = 20_000;
export const POLL_HIDDEN_MS = 60_000;
/** Nach einer fehlgeschlagenen Anmeldung meldet sich die regelmäßige Abfrage erst nach dieser Zeit neu an (Mojang schonen). */
const LOGIN_BACKOFF_MS = 2 * 60_000;
/** Token rechtzeitig vor Ablauf (7 Tage) erneuern */
const TOKEN_MARGIN_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SKIN_MAX_AGE_MS = 6 * 60 * 60_000;
const SKIN_MISS_MS = 10 * 60_000;
const SKIN_RETRY_MS = 60_000;
const MAX_SKIN_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ACTIVITIES: readonly FriendActivity[] = ['menu', 'singleplayer', 'multiplayer', 'realms', 'lan'];
const REASONS: readonly ReportReason[] = ['spam', 'harassment', 'inappropriate', 'other'];
const PRIVACY_KEYS = ['visible', 'presence', 'showServer', 'messages'] as const;

export interface SocialAccount {
  /** ID des Kontos im Launcher */
  id: string;
  type: 'microsoft' | 'offline';
  name: string;
  uuid: string;
}

/** Anlass für eine Benachrichtigung */
export type SocialNotice =
  | { kind: 'request'; uuid: string; name: string }
  | { kind: 'message'; uuid: string; name: string; /** gekürzter Text der neuesten Nachricht */ text: string | null; count: number };

export interface SocialOptions<A extends SocialAccount> {
  serviceUrl: string;
  /** Offline-Konten über POST /v1/auth/dev anmelden (nur Tests gegen einen lokalen Dienst) */
  devAuth?: boolean;
  /** Session-Server für die Anmeldung (Standard Mojang; nur Tests ändern ihn) */
  sessionServer?: string;
  /** Einstellung „Freunde und Nachrichten“ */
  enabled(): Promise<boolean>;
  /** aktives Konto */
  account(): Promise<A | null>;
  /** gültiges Minecraft-Token des Kontos (bei Bedarf erneuert); wirft mit deutscher Meldung */
  accessToken(account: A): Promise<string>;
  /** Ist ein Fenster sichtbar? (20 s statt 60 s) */
  visible?(): boolean;
  onUpdate?(overview: SocialOverview): void;
  /** Sollen jetzt Benachrichtigungen kommen? (Einstellung an, kein Fenster im Vordergrund) */
  wantNotices?(): boolean | Promise<boolean>;
  onNotice?(notice: SocialNotice): void;
  /** Ordner für zwischengespeicherte Skins anderer Spieler */
  skinCacheDir?: string;
  log?(line: string): void;
}

interface RawFriend {
  uuid?: unknown;
  name?: unknown;
  online?: unknown;
  state?: unknown;
  server?: unknown;
  since?: unknown;
}
interface RawRequest {
  uuid?: unknown;
  name?: unknown;
  at?: unknown;
}
interface FriendsResponse {
  friends?: RawFriend[];
  incoming?: RawRequest[];
  outgoing?: RawRequest[];
  unread?: Record<string, unknown>;
}
interface RawMessage {
  id?: unknown;
  from?: unknown;
  to?: unknown;
  text?: unknown;
  at?: unknown;
  read?: unknown;
}
export interface ServiceMe {
  uuid: string;
  name: string;
  cape: string;
  visible: boolean;
  presence: boolean;
  showServer: boolean;
  messages: boolean;
}

function emptyOverview(status: SocialStatus, error: string | null = null): SocialOverview {
  return { status, error, me: null, friends: [], incoming: [], outgoing: [], unread: 0 };
}

/** UUID aus der Oberfläche: ohne Bindestriche, klein, 32 Hex-Zeichen. */
export function normalizeUuid(raw: unknown): string {
  const uuid = typeof raw === 'string' ? raw.replace(/-/g, '').toLowerCase() : '';
  if (!/^[0-9a-f]{32}$/.test(uuid)) throw new Error('Ungültige Spieler-ID.');
  return uuid;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unbekannter Fehler beim Heldix-Dienst.';
}

function shorten(text: string, max = 120): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

/** Freunde: online zuerst, dann nach Name. */
export function sortFriends(friends: Friend[]): Friend[] {
  return friends.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

/** Antwort von GET /v1/friends (und den Anfrage-Routen) in die Übersicht für die Oberfläche übersetzen. */
export function mapFriends(data: FriendsResponse, me: { uuid: string; name: string }): SocialOverview {
  const unreadMap = data.unread && typeof data.unread === 'object' ? data.unread : {};
  const friends: Friend[] = (Array.isArray(data.friends) ? data.friends : [])
    .filter((f) => typeof f?.uuid === 'string')
    .map((f) => {
      const uuid = str(f.uuid);
      const activity = ACTIVITIES.includes(f.state as FriendActivity) ? (f.state as FriendActivity) : null;
      const online = f.online === true;
      return {
        uuid,
        name: str(f.name) || uuid,
        online,
        activity: online ? activity : null,
        server: online && activity === 'multiplayer' && typeof f.server === 'string' && f.server ? f.server : null,
        since: num(f.since),
        unread: Math.max(0, Math.floor(num(unreadMap[uuid]))),
      };
    });
  const requests = (list: unknown): FriendRequest[] =>
    (Array.isArray(list) ? (list as RawRequest[]) : [])
      .filter((r) => typeof r?.uuid === 'string')
      .map((r) => ({ uuid: str(r.uuid), name: str(r.name) || str(r.uuid), at: num(r.at) }));
  sortFriends(friends);
  return {
    status: 'online',
    error: null,
    me: { uuid: me.uuid, name: me.name },
    friends,
    incoming: requests(data.incoming),
    outgoing: requests(data.outgoing),
    unread: friends.reduce((sum, f) => sum + f.unread, 0),
  };
}

/** Server, dem man folgen kann (Freund online im Mehrspieler und zeigt eine Domain, ggf. mit Port), sonst null. */
export function joinableServer(friend: Friend): string | null {
  if (!friend.online || friend.activity !== 'multiplayer' || !friend.server) return null;
  return /^(?=.{1,253}(:|$))[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?$/i.test(friend.server) ? friend.server : null;
}

/** Instanz für „Beitreten“: die angegebene bzw. ausgewählte, wenn sie HeldixClient hat, sonst die erste passende. */
export function pickJoinInstance<T>(list: readonly T[], preferred: T | null, hasClient: (instance: T) => boolean): T | null {
  if (preferred && hasClient(preferred)) return preferred;
  return list.find(hasClient) ?? null;
}

export function mapMessage(raw: RawMessage, me: string): ChatMessage {
  const from = str(raw.from);
  return { id: num(raw.id), from, to: str(raw.to), text: str(raw.text), at: num(raw.at), read: raw.read !== false, mine: from === me };
}

function mapMe(raw: Partial<ServiceMe>): ServiceMe {
  return {
    uuid: str(raw.uuid),
    name: str(raw.name),
    cape: str(raw.cape),
    visible: raw.visible !== false,
    presence: raw.presence !== false,
    showServer: raw.showServer !== false,
    messages: raw.messages !== false,
  };
}

const pickPrivacy = (me: ServiceMe): SocialPrivacy => ({ visible: me.visible, presence: me.presence, showServer: me.showServer, messages: me.messages });

class LoginFailure extends Error {
  constructor(
    message: string,
    readonly at: number,
    /** Dienst gar nicht erreicht: bei der nächsten Abfrage ruhig wieder versuchen */
    readonly transient: boolean,
  ) {
    super(message);
  }
}

export class SocialClient<A extends SocialAccount = SocialAccount> {
  private readonly base: string;
  private overview: SocialOverview = emptyOverview('connecting');
  private lastSent = '';
  /** mindestens einmal fertig geladen */
  private loaded = false;
  private running: Promise<SocialOverview> | null = null;
  private queued: Promise<SocialOverview> | null = null;
  private readonly tokens = new Map<string, ServiceToken>();
  private readonly logins = new Map<string, Promise<ServiceToken>>();
  private readonly loginFailures = new Map<string, LoginFailure>();
  private currentAccount: string | null = null;
  /** Stand beim letzten Laden, um neue Anfragen und Nachrichten zu erkennen */
  private baseline: { account: string; incoming: Set<string>; unread: Map<string, number> } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private lastRefresh = 0;
  private readonly skinMemory = new Map<string, { dataUrl: string | null; until: number }>();
  private readonly skinLoads = new Map<string, Promise<string | null>>();

  /** Testmodus (/v1/auth/dev) nur gegen einen lokalen Dienst */
  private readonly devAuth: boolean;

  constructor(private readonly options: SocialOptions<A>) {
    this.base = serviceBase(options.serviceUrl ?? '');
    this.devAuth = options.devAuth === true && isLoopback(this.base);
  }

  get current(): SocialOverview {
    return this.overview;
  }

  // ---------- Abfragen ----------

  /** Regelmäßig abfragen (erste Abfrage sofort). */
  start(): void {
    this.started = true;
    this.schedule(0);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Ein Fenster ist wieder sichtbar: fällige Abfrage jetzt, sonst im 20-s-Takt weiter. */
  wake(): void {
    if (!this.started || this.running) return;
    const due = this.lastRefresh + POLL_VISIBLE_MS - Date.now();
    if (due <= 0) void this.refresh(false);
    else this.schedule(due);
  }

  private schedule(delay?: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const ms = delay ?? (this.options.visible?.() === false ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    this.timer = setTimeout(() => void this.refresh(false), ms);
    this.timer.unref?.();
  }

  /** Übersicht; vor dem ersten Laden wartet sie darauf. */
  async getOverview(): Promise<SocialOverview> {
    if (this.loaded) return this.overview;
    return this.running ?? this.refresh();
  }

  /**
   * Neu laden. force = sofort neu anmelden, auch kurz nach einem Fehler (Kontowechsel, „Erneut versuchen“, Aktionen);
   * die regelmäßige Abfrage nutzt force = false. Läuft schon eine Abfrage, kommt danach genau eine weitere.
   */
  refresh(force = true): Promise<SocialOverview> {
    if (this.running) {
      this.queued ??= this.running
        .catch(() => undefined)
        .then(() => {
          this.queued = null;
          return this.refresh(force);
        });
      return this.queued;
    }
    this.running = this.load(force).finally(() => {
      this.running = null;
      this.lastRefresh = Date.now();
      this.schedule();
    });
    return this.running;
  }

  private publish(next: SocialOverview): SocialOverview {
    this.overview = next;
    if (next.status !== 'connecting') this.loaded = true;
    const json = JSON.stringify(next);
    if (json !== this.lastSent) {
      this.lastSent = json;
      this.options.onUpdate?.(next);
    }
    return next;
  }

  /** Zustand ohne Konto beim Dienst: alles zurücksetzen. */
  private idle(status: SocialStatus): SocialOverview {
    this.currentAccount = null;
    this.baseline = null;
    return this.publish(emptyOverview(status));
  }

  private async load(force: boolean): Promise<SocialOverview> {
    let account: A | null;
    try {
      if (!(await this.options.enabled())) return this.idle('disabled');
      if (!this.base) return this.idle('no-service');
      account = await this.options.account();
    } catch (error) {
      return this.publish({ ...emptyOverview('error', errorText(error)) });
    }
    if (!account) return this.idle('no-account');
    if (account.type === 'offline' && !this.devAuth) return this.idle('offline-account');
    if (account.id !== this.currentAccount) {
      // Kontowechsel: alte Liste weg, neu anmelden bzw. laden
      this.currentAccount = account.id;
      this.baseline = null;
      this.publish(emptyOverview('connecting'));
    } else if (!this.tokens.has(account.id) && this.overview.status !== 'online' && (force || this.overview.status !== 'error')) {
      // meldet sich (neu) an; die regelmäßige Abfrage nach einem Fehler flackert nicht über „connecting“
      this.publish({ ...this.overview, status: 'connecting', error: null });
    }
    try {
      const data = await this.call<FriendsResponse>(account, '/v1/friends', {}, force);
      if (account.id !== this.currentAccount) return this.overview;
      return this.apply(account, data);
    } catch (error) {
      if (account.id !== this.currentAccount) return this.overview;
      // letzter Stand desselben Kontos bleibt sichtbar, mit Fehler
      return this.publish({ ...this.overview, status: 'error', error: errorText(error) });
    }
  }

  /** Antwort mit Freundesliste übernehmen (GET /v1/friends und Aktionen). */
  private async apply(account: A, data: FriendsResponse): Promise<SocialOverview> {
    const token = this.tokens.get(account.id);
    const me = token ? { uuid: token.uuid, name: token.name } : { uuid: account.uuid.replace(/-/g, '').toLowerCase(), name: account.name };
    const next = mapFriends(data, me);
    await this.notices(account, next).catch((error) => this.options.log?.(`Benachrichtigung: ${errorText(error)}`));
    return this.publish(next);
  }

  private async notices(account: A, next: SocialOverview): Promise<void> {
    const before = this.baseline;
    this.baseline = {
      account: account.id,
      incoming: new Set(next.incoming.map((r) => r.uuid)),
      unread: new Map(next.friends.map((f) => [f.uuid, f.unread])),
    };
    // nie beim ersten Laden (nach dem Start oder Kontowechsel)
    if (!before || before.account !== account.id || !this.options.onNotice) return;
    const fresh = next.incoming.filter((r) => !before.incoming.has(r.uuid));
    const grown = next.friends.filter((f) => f.unread > (before.unread.get(f.uuid) ?? 0));
    if (fresh.length === 0 && grown.length === 0) return;
    if (!(await (this.options.wantNotices?.() ?? true))) return;
    for (const request of fresh) this.options.onNotice({ kind: 'request', uuid: request.uuid, name: request.name });
    for (const friend of grown) {
      let text: string | null = null;
      try {
        const { messages } = await this.call<{ messages?: RawMessage[] }>(account, `/v1/messages/${friend.uuid}?limit=1`);
        const last = Array.isArray(messages) ? messages.at(-1) : undefined;
        if (last && typeof last.text === 'string') text = shorten(last.text);
      } catch {
        // ohne Text benachrichtigen
      }
      this.options.onNotice({ kind: 'message', uuid: friend.uuid, name: friend.name, text, count: friend.unread - (before.unread.get(friend.uuid) ?? 0) });
    }
  }

  // ---------- Anmeldung ----------

  private async token(account: A, force: boolean): Promise<ServiceToken> {
    const cached = this.tokens.get(account.id);
    if (cached && cached.expiresAt > Date.now() + TOKEN_MARGIN_MS) return cached;
    const failure = this.loginFailures.get(account.id);
    if (!force && failure && !failure.transient && Date.now() - failure.at < LOGIN_BACKOFF_MS) throw failure;
    let login = this.logins.get(account.id);
    if (!login) {
      login = (async () => {
        try {
          const accessToken = account.type === 'offline' ? '' : await this.options.accessToken(account);
          const token = await serviceLogin(
            this.base,
            { name: account.name, uuid: account.uuid, accessToken },
            { devAuth: this.devAuth && account.type === 'offline', sessionServer: this.options.sessionServer },
          );
          this.tokens.set(account.id, token);
          this.loginFailures.delete(account.id);
          this.options.log?.(`Beim Heldix-Dienst angemeldet als ${token.name}`);
          return token;
        } catch (error) {
          const transient = error instanceof ServiceError && error.status === 0 && error.message === SERVICE_UNREACHABLE;
          const failure = new LoginFailure(errorText(error), Date.now(), transient);
          this.loginFailures.set(account.id, failure);
          throw failure;
        }
      })().finally(() => this.logins.delete(account.id));
      this.logins.set(account.id, login);
    }
    return login;
  }

  /** Anfrage mit Token; bei 401 einmal neu anmelden. */
  private async call<T>(account: A, route: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; rawBody?: string; contentType?: string } = {}, force = true): Promise<T> {
    let token = await this.token(account, force);
    try {
      return await serviceRequest<T>(this.base, route, { ...init, token: token.token, timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 401) throw error;
      if (this.tokens.get(account.id) === token) this.tokens.delete(account.id);
      token = await this.token(account, true);
      return serviceRequest<T>(this.base, route, { ...init, token: token.token, timeoutMs: REQUEST_TIMEOUT_MS });
    }
  }

  /**
   * Konto für Aktionen. requireEnabled = false für das Heldix-Cape (Skins & Capes) und den Addon-Store, die auch ohne
   * die Freunde-Funktion gehen.
   */
  private async actionAccount(requireEnabled = true, offlineMessage = 'Freunde und Nachrichten gibt es nur mit einem Microsoft-Konto.'): Promise<A> {
    if (!this.base) throw new Error('Kein Heldix-Dienst eingerichtet.');
    if (requireEnabled && !(await this.options.enabled())) throw new Error('Freunde und Nachrichten sind in den Einstellungen ausgeschaltet.');
    const account = await this.options.account();
    if (!account) throw new Error('Bitte zuerst ein Konto hinzufügen.');
    if (account.type === 'offline' && !this.devAuth) throw new Error(offlineMessage);
    return account;
  }

  /**
   * Beliebige Spieler-Route mit der Anmeldung beim Dienst (z. B. Addon-Bewertungen), unabhängig von der Einstellung
   * „Freunde“. quiet = im Hintergrund: nach einer fehlgeschlagenen Anmeldung nicht gleich wieder anmelden.
   */
  async authed<T>(route: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; rawBody?: string; contentType?: string } = {}, options: { offlineMessage?: string; quiet?: boolean } = {}): Promise<T> {
    const account = await this.actionAccount(false, options.offlineMessage);
    return this.call<T>(account, route, init, !options.quiet);
  }

  /** Kann sich das aktive Konto beim Dienst anmelden (Dienst eingerichtet, Microsoft-Konto bzw. Testmodus)? */
  async canAuthenticate(): Promise<boolean> {
    if (!this.base) return false;
    const account = await this.options.account().catch(() => null);
    return account !== null && (account.type !== 'offline' || this.devAuth);
  }

  /** ID des aktiven Kontos (für Zwischenspeicher je Konto) */
  async accountId(): Promise<string | null> {
    return (await this.options.account().catch(() => null))?.id ?? null;
  }

  /** angemeldeter Spieler (UUID) für „mine“ */
  private async meUuid(account: A): Promise<string> {
    return (await this.token(account, true)).uuid;
  }

  // ---------- Freunde ----------

  private async friendsAction(route: string, method: 'POST' | 'DELETE', body?: unknown): Promise<SocialOverview> {
    const account = await this.actionAccount();
    const data = await this.call<FriendsResponse>(account, route, { method, body });
    if (account.id !== this.currentAccount) return this.refresh();
    return this.apply(account, data);
  }

  sendFriendRequest(rawName: unknown): Promise<SocialOverview> {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return Promise.reject(new Error('Spielernamen haben 1–16 Zeichen: Buchstaben, Zahlen und _.'));
    return this.friendsAction('/v1/friends/requests', 'POST', { name });
  }

  acceptFriendRequest(uuid: unknown): Promise<SocialOverview> {
    return this.friendsAction(`/v1/friends/requests/${normalizeUuid(uuid)}/accept`, 'POST');
  }

  removeFriendRequest(uuid: unknown): Promise<SocialOverview> {
    return this.friendsAction(`/v1/friends/requests/${normalizeUuid(uuid)}`, 'DELETE');
  }

  removeFriend(uuid: unknown): Promise<SocialOverview> {
    return this.friendsAction(`/v1/friends/${normalizeUuid(uuid)}`, 'DELETE');
  }

  /** Freund aus der aktuellen Liste (frisch geladen) */
  async friend(uuid: unknown): Promise<Friend | null> {
    const id = normalizeUuid(uuid);
    const overview = await this.refresh();
    if (overview.status === 'error') throw new Error(overview.error ?? SERVICE_UNREACHABLE);
    return overview.friends.find((f) => f.uuid === id) ?? null;
  }

  // ---------- Nachrichten ----------

  async listConversations(): Promise<Conversation[]> {
    const account = await this.actionAccount();
    const me = await this.meUuid(account);
    const data = await this.call<{ conversations?: { uuid?: unknown; name?: unknown; last?: RawMessage | null; unread?: unknown }[] }>(account, '/v1/messages');
    return (Array.isArray(data.conversations) ? data.conversations : [])
      .filter((c) => typeof c?.uuid === 'string')
      .map((c) => ({
        uuid: str(c.uuid),
        name: str(c.name) || str(c.uuid),
        last: c.last && typeof c.last === 'object' ? mapMessage(c.last, me) : null,
        unread: Math.max(0, Math.floor(num(c.unread))),
      }));
  }

  async getMessages(uuid: unknown, before?: unknown): Promise<{ messages: ChatMessage[]; more: boolean }> {
    const friend = normalizeUuid(uuid);
    const account = await this.actionAccount();
    const me = await this.meUuid(account);
    const params = new URLSearchParams({ limit: '50' });
    if (before !== undefined && before !== null) {
      if (!Number.isSafeInteger(before) || (before as number) < 1) throw new Error('Ungültige Nachrichten-ID.');
      params.set('before', String(before));
    }
    const data = await this.call<{ messages?: RawMessage[]; more?: unknown }>(account, `/v1/messages/${friend}?${params}`);
    return { messages: (Array.isArray(data.messages) ? data.messages : []).map((m) => mapMessage(m, me)), more: data.more === true };
  }

  async sendMessage(uuid: unknown, rawText: unknown): Promise<ChatMessage> {
    const friend = normalizeUuid(uuid);
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) throw new Error('Die Nachricht ist leer.');
    if ([...text].length > 500) throw new Error('Nachrichten haben höchstens 500 Zeichen.');
    const account = await this.actionAccount();
    const me = await this.meUuid(account);
    const data = await this.call<{ message?: RawMessage }>(account, `/v1/messages/${friend}`, { method: 'POST', body: { text } });
    void this.refresh().catch(() => undefined);
    return mapMessage(data.message ?? {}, me);
  }

  async markRead(uuid: unknown): Promise<void> {
    const friend = normalizeUuid(uuid);
    const account = await this.actionAccount();
    await this.call(account, `/v1/messages/${friend}/read`, { method: 'POST' });
    // Zähler sofort nullen (Abzeichen), dann frisch laden
    if (account.id === this.currentAccount && this.overview.status === 'online') {
      const friends = this.overview.friends.map((f) => (f.uuid === friend ? { ...f, unread: 0 } : f));
      this.publish({ ...this.overview, friends, unread: friends.reduce((sum, f) => sum + f.unread, 0) });
    }
    this.baseline?.unread.set(friend, 0);
    void this.refresh().catch(() => undefined);
  }

  // ---------- Blockieren, Melden, Privatsphäre ----------

  private mapBlocked(data: { blocked?: RawRequest[] }): BlockedPlayer[] {
    return (Array.isArray(data.blocked) ? data.blocked : [])
      .filter((b) => typeof b?.uuid === 'string')
      .map((b) => ({ uuid: str(b.uuid), name: str(b.name) || str(b.uuid), at: num(b.at) }));
  }

  async listBlocked(): Promise<BlockedPlayer[]> {
    const account = await this.actionAccount();
    return this.mapBlocked(await this.call(account, '/v1/blocks'));
  }

  async blockPlayer(uuid: unknown): Promise<BlockedPlayer[]> {
    const target = normalizeUuid(uuid);
    const account = await this.actionAccount();
    const list = this.mapBlocked(await this.call(account, '/v1/blocks', { method: 'POST', body: { uuid: target } }));
    // Freundschaft, Anfragen und Unterhaltung sind damit weg
    await this.refresh().catch(() => undefined);
    return list;
  }

  async unblockPlayer(uuid: unknown): Promise<BlockedPlayer[]> {
    const target = normalizeUuid(uuid);
    const account = await this.actionAccount();
    const list = this.mapBlocked(await this.call(account, `/v1/blocks/${target}`, { method: 'DELETE' }));
    void this.refresh().catch(() => undefined);
    return list;
  }

  async reportPlayer(uuid: unknown, reason: unknown, note?: unknown): Promise<void> {
    const target = normalizeUuid(uuid);
    if (!REASONS.includes(reason as ReportReason)) throw new Error('Bitte einen Grund für die Meldung wählen.');
    const text = typeof note === 'string' ? note.trim() : '';
    if ([...text].length > 300) throw new Error('Die Notiz hat höchstens 300 Zeichen.');
    const account = await this.actionAccount();
    await this.call(account, '/v1/reports', { method: 'POST', body: { uuid: target, reason, ...(text ? { note: text } : {}) } });
  }

  /** GET /v1/me (auch für das Heldix-Cape, darum ohne die Einstellung „Freunde“) */
  async getMe(requireEnabled = false): Promise<ServiceMe> {
    const account = await this.actionAccount(requireEnabled);
    return mapMe(await this.call<Partial<ServiceMe>>(account, '/v1/me'));
  }

  async updateMe(patch: Partial<Omit<ServiceMe, 'uuid' | 'name'>>, requireEnabled = false): Promise<ServiceMe> {
    const account = await this.actionAccount(requireEnabled);
    return mapMe(await this.call<Partial<ServiceMe>>(account, '/v1/me', { method: 'PUT', body: patch }));
  }

  async getPrivacy(): Promise<SocialPrivacy> {
    return pickPrivacy(await this.getMe(true));
  }

  async setPrivacy(raw: unknown): Promise<SocialPrivacy> {
    const patch: Partial<SocialPrivacy> = {};
    if (raw && typeof raw === 'object') {
      for (const key of PRIVACY_KEYS) {
        const value = (raw as Record<string, unknown>)[key];
        if (typeof value === 'boolean') patch[key] = value;
      }
    }
    if (Object.keys(patch).length === 0) return this.getPrivacy();
    const result = pickPrivacy(await this.updateMe(patch, true));
    void this.refresh().catch(() => undefined);
    return result;
  }

  // ---------- Skins anderer Spieler ----------

  /** Skin als PNG-data:-URL über GET /v1/skins/<uuid>; null = Standard-Skin zeigen. Zwischengespeichert (Speicher und Datei). */
  async playerSkin(rawUuid: unknown): Promise<string | null> {
    let uuid: string;
    try {
      uuid = normalizeUuid(rawUuid);
    } catch {
      return null;
    }
    const hit = this.skinMemory.get(uuid);
    if (hit && hit.until > Date.now()) return hit.dataUrl;
    let loading = this.skinLoads.get(uuid);
    if (!loading) {
      loading = this.loadSkin(uuid).finally(() => this.skinLoads.delete(uuid));
      this.skinLoads.set(uuid, loading);
    }
    return loading;
  }

  private remember(uuid: string, dataUrl: string | null, ms: number): string | null {
    this.skinMemory.delete(uuid);
    this.skinMemory.set(uuid, { dataUrl, until: Date.now() + ms });
    while (this.skinMemory.size > 500) this.skinMemory.delete(this.skinMemory.keys().next().value!);
    return dataUrl;
  }

  private async loadSkin(uuid: string): Promise<string | null> {
    const file = this.options.skinCacheDir ? path.join(this.options.skinCacheDir, `${uuid}.png`) : null;
    let stale: Buffer | null = null;
    if (file) {
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) {
        const data = await readFile(file).catch(() => null);
        if (data && isPng(data)) {
          if (Date.now() - info.mtimeMs < SKIN_MAX_AGE_MS) return this.remember(uuid, pngDataUrl(data), SKIN_MAX_AGE_MS - (Date.now() - info.mtimeMs));
          stale = data;
        }
      }
    }
    const fallback = () => this.remember(uuid, stale ? pngDataUrl(stale) : null, SKIN_RETRY_MS);
    let account: A;
    try {
      account = await this.actionAccount(false);
    } catch {
      return fallback();
    }
    try {
      let token = await this.token(account, false);
      let response = await serviceFetch(this.base, `/v1/skins/${uuid}`, { token: token.token, accept: 'image/png', timeoutMs: REQUEST_TIMEOUT_MS });
      if (response.status === 401) {
        await response.body?.cancel().catch(() => undefined);
        if (this.tokens.get(account.id) === token) this.tokens.delete(account.id);
        token = await this.token(account, true);
        response = await serviceFetch(this.base, `/v1/skins/${uuid}`, { token: token.token, accept: 'image/png', timeoutMs: REQUEST_TIMEOUT_MS });
      }
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        if (file) await rm(file, { force: true }).catch(() => undefined);
        return this.remember(uuid, null, SKIN_MISS_MS);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return fallback();
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > MAX_SKIN_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return this.remember(uuid, null, SKIN_MISS_MS);
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > MAX_SKIN_BYTES || !isPng(data)) return this.remember(uuid, null, SKIN_MISS_MS);
      if (file) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, data).catch(() => undefined);
      }
      return this.remember(uuid, pngDataUrl(data), SKIN_MAX_AGE_MS);
    } catch {
      return fallback();
    }
  }
}

function isPng(data: Buffer): boolean {
  return data.length > PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function pngDataUrl(data: Buffer): string {
  return `data:image/png;base64,${data.toString('base64')}`;
}
