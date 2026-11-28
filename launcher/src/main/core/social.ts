// Freunde und Nachrichten im Launcher über den Heldix-Dienst (siehe docs/dienst.md, „Freunde 2.0“ ab Dienst 1.12.0).
//
// - Echtzeit: Gestartet (start()) hält der Launcher eine Begleiter-Verbindung /v1/ws?client=launcher (core/realtime.ts).
//   Sie zählt beim Dienst NICHT als „online im Spiel“ – online bleibt nur, wer im Spiel ist. Über sie kommen die
//   Freundesliste (friends, friend), Nachrichten, Reaktionen, gelöschte Nachrichten, „schreibt …“ und gelesen; alles
//   andere (Party, Welten, Einladungen, Freischaltungen) reicht onRealtime weiter.
// - Abfrage nur noch als Rückfall: Solange die Verbindung nicht steht (älterer Dienst, Netzprobleme), fragt der Launcher
//   GET /v1/friends ab – alle 20 s, solange ein Fenster sichtbar ist, sonst alle 60 s. Steht sie, nur alle 5 Minuten
//   zum Abgleich. Sofort nach einem Kontowechsel, jeder Aktion und refresh().
// - Benachrichtigungen: neue Anfragen und Nachrichten (aus dem Vergleich mit dem letzten Stand bzw. direkt aus der
//   Echtzeit), „ist online“ je nach eigener Einstellung onlineNotify (alle, nur Favoriten, keine; höchstens alle 10
//   Minuten je Freund). „Nicht stören“ (Me.dnd) unterdrückt Toasts und Systembenachrichtigungen – der Verlauf (Glocke)
//   sammelt weiter.

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  BlockedPlayer,
  ChatEvent,
  ChatMessage,
  Conversation,
  Friend,
  FriendActivity,
  FriendProfile,
  FriendRequest,
  FriendSuggestions,
  MessageCard,
  OnlineNotify,
  PlayerBadge,
  ReactionId,
  ReportReason,
  SocialMe,
  SocialOverview,
  SocialPrivacy,
  SocialStatus,
} from '../../shared/api';
import { SERVICE_UNREACHABLE, ServiceError, isLoopback, serviceBase, serviceFetch, serviceLogin, serviceRequest, type ServiceMethod, type ServiceToken } from './heldixservice';
import { CompanionSocket, type CompanionState, type SocketFactory } from './realtime';

export const POLL_VISIBLE_MS = 20_000;
export const POLL_HIDDEN_MS = 60_000;
/** Abgleich, solange die Echtzeit-Verbindung steht */
export const POLL_LIVE_MS = 5 * 60_000;
/** „ist online“ höchstens so oft je Freund */
export const ONLINE_NOTICE_GAP_MS = 10 * 60_000;
/** „schreibt …“ höchstens so oft je Freund senden */
export const TYPING_INTERVAL_MS = 3000;
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
const PRIVACY_KEYS = ['visible', 'presence', 'showServer', 'messages', 'showLastOnline', 'suggestable', 'showSuggestions'] as const;
const ONLINE_NOTIFY: readonly OnlineNotify[] = ['all', 'favorites', 'none'];

/** Abzeichen-Werte des Dienstes (BADGE_VALUES in service/src/roles.ts); Unbekanntes = normaler Spieler (null) */
export const BADGES: readonly PlayerBadge[] = ['admin', 'developer-team', 'moderator', 'supporter', 'designer', 'tester', 'partner', 'creator', 'ambassador', 'developer'];
/** Reaktionen (REACTIONS in service/src/messages.ts) */
export const REACTION_IDS: readonly ReactionId[] = ['like', 'love', 'laugh', 'wow', 'sad', 'party', 'fire', 'eyes'];

export const NICKNAME_MAX = 24;
export const NOTE_MAX = 200;
export const STATUS_MAX = 40;
export const CARD_TITLE_MAX = 60;
const WORLD_CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
const INVITE_CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;

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
  | { kind: 'message'; uuid: string; name: string; /** gekürzter Text der neuesten Nachricht */ text: string | null; count: number }
  /** Freund ist ins Spiel gekommen (nur laut onlineNotify, nie im Verlauf) */
  | { kind: 'online'; uuid: string; name: string };

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
  /** Sollen jetzt Benachrichtigungen kommen? (Einstellung an, kein Fenster im Vordergrund) – „Nicht stören“ prüft der Client selbst */
  wantNotices?(): boolean | Promise<boolean>;
  onNotice?(notice: SocialNotice): void;
  /** Jede neue Anfrage und Nachricht für den Verlauf (Glocke), auch wenn wantNotices nein sagt oder „Nicht stören“ an ist */
  onHistory?(notice: SocialNotice): void;
  /** Echtzeit-Begleiter nach start() (Standard an) */
  realtime?: boolean;
  /** WebSocket für den Begleiter (nur Tests) */
  socket?: SocketFactory;
  /** Unterhaltungen in Echtzeit (neue/gelöschte Nachrichten, Reaktionen, „schreibt …“, gelesen) */
  onChatEvent?(event: ChatEvent): void;
  /** übrige Echtzeit-Nachrichten (party*, world-*, invite, unlock, …) */
  onRealtime?(message: Record<string, unknown>): void;
  /** Echtzeit-Verbindung steht (auch nach jedem Neuverbinden): Party und Welten frisch holen */
  onRealtimeOpen?(): void;
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
  favorite?: unknown;
  nickname?: unknown;
  note?: unknown;
  statusText?: unknown;
  dnd?: unknown;
  lastOnline?: unknown;
  badge?: unknown;
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
  replyTo?: unknown;
  card?: unknown;
  reactions?: unknown;
}
export interface ServiceMe {
  uuid: string;
  name: string;
  cape: string;
  visible: boolean;
  presence: boolean;
  showServer: boolean;
  messages: boolean;
  statusText: string | null;
  dnd: boolean;
  showLastOnline: boolean;
  suggestable: boolean;
  showSuggestions: boolean;
  onlineNotify: OnlineNotify;
  badge: PlayerBadge | null;
}

function emptyOverview(status: SocialStatus, error: string | null = null): SocialOverview {
  return { status, error, me: null, friends: [], incoming: [], outgoing: [], unread: 0, realtime: 'off' };
}

/** UUID aus der Oberfläche: ohne Bindestriche, klein, 32 Hex-Zeichen. */
export function normalizeUuid(raw: unknown): string {
  const uuid = typeof raw === 'string' ? raw.replace(/-/g, '').toLowerCase() : '';
  if (!/^[0-9a-f]{32}$/.test(uuid)) throw new Error('Ungültige Spieler-ID.');
  return uuid;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unbekannter Fehler beim Heldix-Dienst.';
}

function shorten(text: string, max = 120): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

// als RegExp aus Text: so stehen im Quelltext nur Escape-Folgen, nie die (unsichtbaren) Zeichen selbst
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
const DIRECTION_CHARS = new RegExp('[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]', 'g');

/** Text „wie Nachrichten“: eine Zeile, ohne Steuer- und Schreibrichtungs-Zeichen, ohne Leerzeichen am Rand */
export function cleanLine(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(CONTROL_CHARS, ' ').replace(DIRECTION_CHARS, '').replace(/\s+/g, ' ').trim() : '';
}

export function badgeOf(value: unknown): PlayerBadge | null {
  return BADGES.includes(value as PlayerBadge) ? (value as PlayerBadge) : null;
}

/** Name für die Anzeige: eigener Spitzname, sonst der Spielername */
export function displayName(friend: Pick<Friend, 'name' | 'nickname'>): string {
  return friend.nickname?.trim() || friend.name;
}

/** Freunde: Favoriten zuerst, dann online, dann nach Name (Spitzname, wenn vergeben). */
export function sortFriends(friends: Friend[]): Friend[] {
  return friends.sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(b.online) - Number(a.online)
    || displayName(a).localeCompare(displayName(b), 'de', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'de'));
}

/** Ein Freund aus GET /v1/friends bzw. der Echtzeit-Nachricht friend */
export function mapFriend(f: RawFriend, unread = 0): Friend {
  const uuid = str(f.uuid);
  const activity = ACTIVITIES.includes(f.state as FriendActivity) ? (f.state as FriendActivity) : null;
  const online = f.online === true;
  const lastOnline = typeof f.lastOnline === 'number' && Number.isFinite(f.lastOnline) && f.lastOnline > 0 ? f.lastOnline : null;
  return {
    uuid,
    name: str(f.name) || uuid,
    online,
    activity: online ? activity : null,
    server: online && activity === 'multiplayer' && typeof f.server === 'string' && f.server ? f.server : null,
    since: num(f.since),
    unread: Math.max(0, Math.floor(unread)),
    favorite: f.favorite === true,
    nickname: textOrNull(f.nickname) ? [...cleanLine(f.nickname)].slice(0, NICKNAME_MAX).join('') || null : null,
    note: textOrNull(f.note) ? [...cleanLine(f.note)].slice(0, NOTE_MAX).join('') || null : null,
    statusText: textOrNull(f.statusText) ? [...cleanLine(f.statusText)].slice(0, STATUS_MAX).join('') || null : null,
    dnd: online && f.dnd === true,
    lastOnline: online ? null : lastOnline,
    badge: badgeOf(f.badge),
  };
}

/** Antwort von GET /v1/friends (und den Anfrage-Routen, der Echtzeit-Nachricht friends) in die Übersicht übersetzen. */
export function mapFriends(data: FriendsResponse, me: SocialMe | { uuid: string; name: string }): SocialOverview {
  const unreadMap = data.unread && typeof data.unread === 'object' ? data.unread : {};
  const friends: Friend[] = (Array.isArray(data.friends) ? data.friends : [])
    .filter((f) => typeof f?.uuid === 'string')
    .map((f) => mapFriend(f, num(unreadMap[str(f.uuid)])));
  const requests = (list: unknown): FriendRequest[] =>
    (Array.isArray(list) ? (list as RawRequest[]) : [])
      .filter((r) => typeof r?.uuid === 'string')
      .map((r) => ({ uuid: str(r.uuid), name: str(r.name) || str(r.uuid), at: num(r.at) }));
  sortFriends(friends);
  return {
    status: 'online',
    error: null,
    me: fullMe(me),
    friends,
    incoming: requests(data.incoming),
    outgoing: requests(data.outgoing),
    unread: friends.reduce((sum, f) => sum + f.unread, 0),
    realtime: 'off',
  };
}

function fullMe(me: SocialMe | { uuid: string; name: string }): SocialMe {
  const m = me as Partial<SocialMe> & { uuid: string; name: string };
  return {
    uuid: m.uuid,
    name: m.name,
    badge: m.badge ?? null,
    statusText: m.statusText ?? null,
    dnd: m.dnd === true,
    onlineNotify: ONLINE_NOTIFY.includes(m.onlineNotify as OnlineNotify) ? (m.onlineNotify as OnlineNotify) : 'all',
  };
}

/**
 * Freunde, die seit dem letzten Stand online gekommen sind und eine „ist online“-Benachrichtigung bekommen sollen
 * (onlineNotify: all = alle, favorites = nur Favoriten, none = keine).
 */
export function cameOnline(before: ReadonlySet<string>, friends: readonly Friend[], notify: OnlineNotify): Friend[] {
  if (notify === 'none') return [];
  return friends.filter((f) => f.online && !before.has(f.uuid) && (notify === 'all' || f.favorite));
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

// ---------- Nachrichten ----------

/** Karte aus einer Antwort des Dienstes (ungültig: null) */
export function mapCard(raw: unknown): MessageCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const target = str(c.target).trim();
  const title = [...cleanLine(c.title)].slice(0, CARD_TITLE_MAX).join('');
  if (c.kind === 'server' && target && target.length <= 260 && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(target)) return { kind: 'server', target: target.toLowerCase(), title };
  if (c.kind === 'world' && WORLD_CODE_RE.test(target.toLowerCase())) return { kind: 'world', target: target.toLowerCase(), title };
  if (c.kind === 'invite' && INVITE_CODE_RE.test(target)) return { kind: 'invite', target, title };
  return null;
}

function mapReactions(raw: unknown): Record<string, ReactionId> {
  const out: Record<string, ReactionId> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [uuid, reaction] of Object.entries(raw as Record<string, unknown>)) {
    if (/^[0-9a-f]{32}$/.test(uuid) && REACTION_IDS.includes(reaction as ReactionId)) out[uuid] = reaction as ReactionId;
  }
  return out;
}

function mapReply(raw: unknown): ChatMessage['replyTo'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(r.id) || (r.id as number) < 1) return null;
  return { id: r.id as number, from: typeof r.from === 'string' && /^[0-9a-f]{32}$/.test(r.from) ? r.from : null, text: typeof r.text === 'string' ? r.text : null };
}

export function mapMessage(raw: RawMessage, me: string): ChatMessage {
  const from = str(raw.from);
  return {
    id: num(raw.id),
    from,
    to: str(raw.to),
    text: str(raw.text),
    at: num(raw.at),
    read: raw.read !== false,
    mine: from === me,
    replyTo: mapReply(raw.replyTo),
    card: mapCard(raw.card),
    reactions: mapReactions(raw.reactions),
  };
}

/**
 * Karte aus der Oberfläche prüfen (wie der Dienst): Server = öffentliche Domain (Port ≠ 25565 bleibt), Welt = 6 Zeichen,
 * Einladung = 10 Zeichen, Titel höchstens 60 Zeichen in einer Zeile. Wirft mit deutscher Meldung.
 */
export function checkCard(raw: unknown, normalizeServer: (value: unknown) => string | null): MessageCard {
  if (!raw || typeof raw !== 'object') throw new Error('Ungültige Karte.');
  const c = raw as Record<string, unknown>;
  const title = cleanLine(c.title);
  if ([...title].length > CARD_TITLE_MAX) throw new Error(`Der Titel der Karte hat höchstens ${CARD_TITLE_MAX} Zeichen.`);
  if (c.kind === 'server') {
    const server = normalizeServer(c.target);
    if (!server) throw new Error('Bitte eine öffentliche Serveradresse angeben, z. B. play.example.de – keine IP-Adressen.');
    return { kind: 'server', target: server, title: title || server };
  }
  if (c.kind === 'world') {
    const code = str(c.target).trim().toLowerCase();
    if (!WORLD_CODE_RE.test(code)) throw new Error('Ungültiger Welt-Code.');
    return { kind: 'world', target: code, title };
  }
  if (c.kind === 'invite') {
    const code = str(c.target).trim();
    if (!INVITE_CODE_RE.test(code)) throw new Error('Ungültiger Einladungslink.');
    return { kind: 'invite', target: code, title };
  }
  throw new Error('Ungültige Karte.');
}

/** Text zur Karte für ältere Clients (z. B. „Komm auf mc.example.de“) */
export function cardFallbackText(card: MessageCard, address?: string | null): string {
  if (card.kind === 'server') return `Komm auf ${card.target}`;
  if (card.kind === 'world') return `Komm in meine Welt${card.title ? ` „${card.title}“` : ''}${address ? `: ${address}` : ''}`;
  return `Ich lade dich ein: heldixclient://einladung/${card.target}`;
}

function mapMe(raw: Partial<Record<keyof ServiceMe, unknown>>): ServiceMe {
  return {
    uuid: str(raw.uuid),
    name: str(raw.name),
    cape: str(raw.cape),
    visible: raw.visible !== false,
    presence: raw.presence !== false,
    showServer: raw.showServer !== false,
    messages: raw.messages !== false,
    statusText: textOrNull(raw.statusText),
    dnd: raw.dnd === true,
    showLastOnline: raw.showLastOnline !== false,
    suggestable: raw.suggestable === true,
    showSuggestions: raw.showSuggestions !== false,
    onlineNotify: ONLINE_NOTIFY.includes(raw.onlineNotify as OnlineNotify) ? (raw.onlineNotify as OnlineNotify) : 'all',
    badge: badgeOf(raw.badge),
  };
}

const pickPrivacy = (me: ServiceMe): SocialPrivacy => ({
  visible: me.visible,
  presence: me.presence,
  showServer: me.showServer,
  messages: me.messages,
  showLastOnline: me.showLastOnline,
  suggestable: me.suggestable,
  showSuggestions: me.showSuggestions,
  onlineNotify: me.onlineNotify,
});

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

type CallInit = { method?: ServiceMethod; body?: unknown; rawBody?: string; contentType?: string };

interface Baseline {
  account: string;
  incoming: Set<string>;
  unread: Map<string, number>;
  online: Set<string>;
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
  /** GET /v1/me je Konto (Abzeichen, Status, „Nicht stören“, onlineNotify) */
  private readonly meInfo = new Map<string, ServiceMe>();
  private readonly meLoads = new Map<string, Promise<ServiceMe | null>>();
  private currentAccount: string | null = null;
  /** Stand beim letzten Laden, um neue Anfragen, Nachrichten und Freunde online zu erkennen */
  private baseline: Baseline | null = null;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private lastRefresh = 0;
  private readonly skinMemory = new Map<string, { dataUrl: string | null; until: number }>();
  private readonly skinLoads = new Map<string, Promise<string | null>>();
  private socket: CompanionSocket | null = null;
  private socketAccount: string | null = null;
  private readonly typingSent = new Map<string, number>();
  private readonly onlineNoticeAt = new Map<string, number>();
  private soonTimer: NodeJS.Timeout | null = null;

  /** Testmodus (/v1/auth/dev) nur gegen einen lokalen Dienst */
  private readonly devAuth: boolean;

  constructor(private readonly options: SocialOptions<A>) {
    this.base = serviceBase(options.serviceUrl ?? '');
    this.devAuth = options.devAuth === true && isLoopback(this.base);
  }

  get current(): SocialOverview {
    return this.overview;
  }

  /** Stand der Echtzeit-Verbindung */
  get realtime(): CompanionState {
    return this.socket?.state ?? 'off';
  }

  /** eigene UUID beim Dienst (angemeldet), sonst null */
  get meUuidNow(): string | null {
    return this.overview.me?.uuid ?? null;
  }

  // ---------- Abfragen ----------

  /** Regelmäßig abfragen (erste Abfrage sofort) und nach dem ersten Laden die Echtzeit-Verbindung aufbauen. */
  start(): void {
    this.started = true;
    this.schedule(0);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.soonTimer = null;
    this.closeSocket();
  }

  /** Ein Fenster ist wieder sichtbar: fällige Abfrage jetzt, sonst im 20-s-Takt weiter (bei Echtzeit nichts). */
  wake(): void {
    if (!this.started || this.running || this.realtime === 'live') return;
    const due = this.lastRefresh + POLL_VISIBLE_MS - Date.now();
    if (due <= 0) void this.refresh(false);
    else this.schedule(due);
  }

  private schedule(delay?: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const ms = delay ?? (this.realtime === 'live' ? POLL_LIVE_MS : this.options.visible?.() === false ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    this.timer = setTimeout(() => void this.refresh(false), ms);
    this.timer.unref?.();
  }

  /** Bald neu laden (mehrere Anlässe kurz hintereinander = eine Abfrage) */
  private refreshSoon(): void {
    if (this.soonTimer) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.refresh().catch(() => undefined);
    }, 1500);
    this.soonTimer.unref?.();
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
    next.realtime = next.status === 'online' || next.status === 'error' ? this.realtime : 'off';
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
    this.closeSocket();
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
      // Kontowechsel: alte Liste weg, Echtzeit des alten Kontos zu, neu anmelden bzw. laden
      this.currentAccount = account.id;
      this.baseline = null;
      this.closeSocket();
      this.publish(emptyOverview('connecting'));
    } else if (!this.tokens.has(account.id) && this.overview.status !== 'online' && (force || this.overview.status !== 'error')) {
      // meldet sich (neu) an; die regelmäßige Abfrage nach einem Fehler flackert nicht über „connecting“
      this.publish({ ...this.overview, status: 'connecting', error: null });
    }
    try {
      const data = await this.call<FriendsResponse>(account, '/v1/friends', {}, force);
      if (account.id !== this.currentAccount) return this.overview;
      if (!this.meInfo.has(account.id)) await this.loadMe(account, false);
      const result = await this.apply(account, data);
      this.syncRealtime(account);
      return result;
    } catch (error) {
      if (account.id !== this.currentAccount) return this.overview;
      // letzter Stand desselben Kontos bleibt sichtbar, mit Fehler
      return this.publish({ ...this.overview, status: 'error', error: errorText(error) });
    }
  }

  /** eigenes Profil beim Dienst (Abzeichen, Status …); publish = Übersicht gleich neu schicken */
  private loadMe(account: A, publish = true): Promise<ServiceMe | null> {
    let load = this.meLoads.get(account.id);
    if (!load) {
      load = this.call<Partial<Record<keyof ServiceMe, unknown>>>(account, '/v1/me', {}, false)
        .then((raw) => {
          const me = mapMe(raw);
          this.meInfo.set(account.id, me);
          return me;
        })
        .catch(() => null)
        .finally(() => this.meLoads.delete(account.id));
      this.meLoads.set(account.id, load);
    }
    return load.then((me) => {
      if (me && publish && account.id === this.currentAccount && this.overview.status === 'online' && this.overview.me) {
        this.publish({ ...this.overview, me: this.meOf(account, this.overview.me) });
      }
      return me;
    });
  }

  private meOf(account: A, fallback?: { uuid: string; name: string }): SocialMe {
    const token = this.tokens.get(account.id);
    const base = token ? { uuid: token.uuid, name: token.name } : fallback ?? { uuid: account.uuid.replace(/-/g, '').toLowerCase(), name: account.name };
    const info = this.meInfo.get(account.id);
    return fullMe({ ...base, badge: info?.badge ?? null, statusText: info?.statusText ?? null, dnd: info?.dnd ?? false, onlineNotify: info?.onlineNotify ?? 'all' });
  }

  /** „Nicht stören“ des aktiven Kontos */
  get doNotDisturb(): boolean {
    return this.overview.me?.dnd === true;
  }

  /** Antwort mit Freundesliste übernehmen (GET /v1/friends, Aktionen, Echtzeit friends). */
  private async apply(account: A, data: FriendsResponse): Promise<SocialOverview> {
    const next = mapFriends(data, this.meOf(account));
    await this.notices(account, next).catch((error) => this.options.log?.(`Benachrichtigung: ${errorText(error)}`));
    return this.publish(next);
  }

  /** Benachrichtigen: Verlauf immer, Toast/Systembenachrichtigung nur mit wantNotices und ohne „Nicht stören“ */
  private async emit(notices: SocialNotice[]): Promise<void> {
    if (!notices.length || (!this.options.onNotice && !this.options.onHistory)) return;
    const want = !!this.options.onNotice && !this.doNotDisturb && (await (this.options.wantNotices?.() ?? true));
    for (const notice of notices) {
      if (notice.kind !== 'online') this.options.onHistory?.(notice);
      if (want) this.options.onNotice?.(notice);
    }
  }

  /** „ist online“ je Freund höchstens alle 10 Minuten */
  private onlineNotices(friends: Friend[]): SocialNotice[] {
    const now = Date.now();
    const out: SocialNotice[] = [];
    for (const friend of friends) {
      const last = this.onlineNoticeAt.get(friend.uuid) ?? 0;
      if (now - last < ONLINE_NOTICE_GAP_MS) continue;
      this.onlineNoticeAt.set(friend.uuid, now);
      out.push({ kind: 'online', uuid: friend.uuid, name: displayName(friend) });
    }
    return out;
  }

  private async notices(account: A, next: SocialOverview): Promise<void> {
    const before = this.baseline;
    this.baseline = {
      account: account.id,
      incoming: new Set(next.incoming.map((r) => r.uuid)),
      unread: new Map(next.friends.map((f) => [f.uuid, f.unread])),
      online: new Set(next.friends.filter((f) => f.online).map((f) => f.uuid)),
    };
    // nie beim ersten Laden (nach dem Start oder Kontowechsel)
    if (!before || before.account !== account.id || (!this.options.onNotice && !this.options.onHistory)) return;
    const fresh = next.incoming.filter((r) => !before.incoming.has(r.uuid));
    const grown = next.friends.filter((f) => f.unread > (before.unread.get(f.uuid) ?? 0));
    const online = this.onlineNotices(cameOnline(before.online, next.friends, next.me?.onlineNotify ?? 'all'));
    if (fresh.length === 0 && grown.length === 0 && online.length === 0) return;
    const notices: SocialNotice[] = fresh.map((request) => ({ kind: 'request', uuid: request.uuid, name: request.name }));
    for (const friend of grown) {
      let text: string | null = null;
      try {
        const { messages } = await this.call<{ messages?: RawMessage[] }>(account, `/v1/messages/${friend.uuid}?limit=1`);
        const last = Array.isArray(messages) ? messages.at(-1) : undefined;
        if (last && typeof last.text === 'string') text = shorten(last.text);
      } catch {
        // ohne Text benachrichtigen
      }
      notices.push({ kind: 'message', uuid: friend.uuid, name: displayName(friend), text, count: friend.unread - (before.unread.get(friend.uuid) ?? 0) });
    }
    notices.push(...online);
    await this.emit(notices);
  }

  // ---------- Echtzeit (Begleiter) ----------

  private closeSocket(): void {
    this.socket?.stop();
    this.socket = null;
    this.socketAccount = null;
  }

  /** Begleiter-Verbindung für das aktive Konto (nur gestartet, online und mit Einstellung) */
  private syncRealtime(account: A): void {
    if (!this.started || this.options.realtime === false || this.overview.status !== 'online' || account.id !== this.currentAccount) return;
    if (this.socket && this.socketAccount === account.id) return;
    this.closeSocket();
    this.socketAccount = account.id;
    const socket = new CompanionSocket({
      base: this.base,
      token: async (retry) => {
        // kam der letzte Versuch nicht zustande: Token beim Dienst prüfen (401 → neu anmelden)
        if (retry) await this.call(account, '/v1/me', {}, false);
        return (await this.token(account, false)).token;
      },
      socket: this.options.socket,
      onMessage: (message) => {
        if (this.socket === socket && account.id === this.currentAccount) void this.onSocketMessage(account, message);
      },
      onState: (state) => {
        if (this.socket !== socket) return;
        if (this.overview.status === 'online' || this.overview.status === 'error') this.publish({ ...this.overview });
        if (state === 'live') this.options.log?.('Echtzeit-Verbindung zum Heldix-Dienst steht');
        // Rückfall: ohne Verbindung wieder im normalen Takt abfragen, mit Verbindung nur selten
        this.schedule(state === 'live' ? POLL_LIVE_MS : POLL_VISIBLE_MS);
      },
      onOpen: () => {
        if (this.socket !== socket) return;
        void this.loadMe(account);
        this.options.onRealtimeOpen?.();
      },
      log: this.options.log,
    });
    this.socket = socket;
    socket.start();
  }

  /** Nachricht über die Echtzeit-Verbindung an den Dienst (z. B. typing); false = keine Verbindung */
  sendRealtime(message: Record<string, unknown>): boolean {
    return this.socket?.send(message) ?? false;
  }

  private myUuid(account: A): string {
    return this.tokens.get(account.id)?.uuid ?? account.uuid.replace(/-/g, '').toLowerCase();
  }

  private async onSocketMessage(account: A, message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case 'friends':
        await this.apply(account, message as FriendsResponse);
        return;
      case 'friend':
        await this.applyFriend(account, message.friend);
        return;
      case 'request':
      case 'accepted':
        // die neue Liste kommt gleich als friends hinterher
        return;
      case 'message':
        await this.applyMessage(account, message.message);
        return;
      case 'read': {
        const uuid = str(message.uuid);
        if (!/^[0-9a-f]{32}$/.test(uuid)) return;
        this.setUnread(uuid, 0);
        this.options.onChatEvent?.({ kind: 'read', uuid });
        return;
      }
      case 'message-deleted': {
        const uuid = str(message.uuid);
        if (!/^[0-9a-f]{32}$/.test(uuid) || !Number.isSafeInteger(message.id)) return;
        this.options.onChatEvent?.({ kind: 'deleted', uuid, id: message.id as number });
        // war sie ungelesen, stimmt der Zähler nicht mehr: frisch holen
        if ((this.overview.friends.find((f) => f.uuid === uuid)?.unread ?? 0) > 0) this.refreshSoon();
        return;
      }
      case 'reaction': {
        const uuid = str(message.uuid);
        if (!/^[0-9a-f]{32}$/.test(uuid) || !Number.isSafeInteger(message.id)) return;
        this.options.onChatEvent?.({ kind: 'reaction', uuid, id: message.id as number, reactions: mapReactions(message.reactions) });
        return;
      }
      case 'typing': {
        const uuid = str(message.from);
        if (/^[0-9a-f]{32}$/.test(uuid) && this.overview.friends.some((f) => f.uuid === uuid)) this.options.onChatEvent?.({ kind: 'typing', uuid });
        return;
      }
      default:
        this.options.onRealtime?.(message);
    }
  }

  /** Ein Freund hat sich geändert (online, Status, eigene Angaben): nur ihn ersetzen */
  private async applyFriend(account: A, raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object' || this.overview.status !== 'online') return;
    const uuid = str((raw as RawFriend).uuid);
    const existing = this.overview.friends.find((f) => f.uuid === uuid);
    if (!existing) {
      this.refreshSoon();
      return;
    }
    const next = mapFriend(raw as RawFriend, existing.unread);
    const friends = sortFriends(this.overview.friends.map((f) => (f.uuid === uuid ? next : f)));
    const wasOnline = existing.online;
    if (this.baseline?.account === account.id) {
      if (next.online) this.baseline.online.add(uuid);
      else this.baseline.online.delete(uuid);
    }
    this.publish({ ...this.overview, friends });
    if (!wasOnline) await this.emit(this.onlineNotices(cameOnline(new Set(), [next], this.overview.me?.onlineNotify ?? 'all')));
  }

  private setUnread(uuid: string, unread: number): void {
    if (this.overview.status !== 'online') return;
    const friends = this.overview.friends.map((f) => (f.uuid === uuid ? { ...f, unread } : f));
    this.baseline?.unread.set(uuid, unread);
    this.publish({ ...this.overview, friends, unread: friends.reduce((sum, f) => sum + f.unread, 0) });
  }

  /** Neue Nachricht in Echtzeit: an die Unterhaltung, ungelesen zählen, benachrichtigen */
  private async applyMessage(account: A, raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = mapMessage(raw as RawMessage, this.myUuid(account));
    if (!message.id) return;
    const other = message.mine ? message.to : message.from;
    if (!/^[0-9a-f]{32}$/.test(other)) return;
    this.options.onChatEvent?.({ kind: 'message', uuid: other, message });
    if (message.mine || message.read) return;
    const friend = this.overview.friends.find((f) => f.uuid === other);
    if (!friend) return;
    this.setUnread(other, friend.unread + 1);
    await this.emit([{ kind: 'message', uuid: other, name: displayName(friend), text: shorten(message.text), count: 1 }]);
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
  private async call<T>(account: A, route: string, init: CallInit = {}, force = true): Promise<T> {
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
   * Beliebige Spieler-Route mit der Anmeldung beim Dienst (z. B. Addon-Bewertungen, Party), unabhängig von der Einstellung
   * „Freunde“. quiet = im Hintergrund: nach einer fehlgeschlagenen Anmeldung nicht gleich wieder anmelden.
   */
  async authed<T>(route: string, init: CallInit = {}, options: { offlineMessage?: string; quiet?: boolean } = {}): Promise<T> {
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

  /** eigene UUID beim Dienst (meldet bei Bedarf an); für Party und Tests */
  async myServiceUuid(): Promise<string> {
    return this.meUuid(await this.actionAccount(false));
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

  /** Eigene Angaben zu einem Freund (PATCH /v1/friends/<uuid>): Favorit, Spitzname, Notiz; '' bzw. null löscht */
  async updateFriend(rawUuid: unknown, raw: unknown): Promise<SocialOverview> {
    const uuid = normalizeUuid(rawUuid);
    const patch: { favorite?: boolean; nickname?: string | null; note?: string | null } = {};
    const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if ('favorite' in input) {
      if (typeof input.favorite !== 'boolean') throw new Error('„Favorit“ muss an oder aus sein.');
      patch.favorite = input.favorite;
    }
    for (const [key, max, label] of [['nickname', NICKNAME_MAX, 'Der Spitzname'], ['note', NOTE_MAX, 'Die Notiz']] as const) {
      if (!(key in input)) continue;
      const value = input[key];
      if (value !== null && typeof value !== 'string') throw new Error(`${label} muss ein Text sein.`);
      const clean = cleanLine(value);
      if ([...clean].length > max) throw new Error(`${label} hat höchstens ${max} Zeichen.`);
      patch[key] = clean || null;
    }
    if (Object.keys(patch).length === 0) return this.overview;
    const account = await this.actionAccount();
    const data = await this.call<{ friend?: RawFriend }>(account, `/v1/friends/${uuid}`, { method: 'PATCH', body: patch });
    if (account.id === this.currentAccount && data.friend) await this.applyFriend(account, data.friend);
    return this.overview;
  }

  /** Profilkarte (GET /v1/friends/<uuid>/profile) */
  async friendProfile(rawUuid: unknown): Promise<FriendProfile> {
    const uuid = normalizeUuid(rawUuid);
    const account = await this.actionAccount();
    const data = await this.call<{ friend?: RawFriend; mutual?: unknown; cape?: unknown; cosmetics?: unknown }>(account, `/v1/friends/${uuid}/profile`);
    const unread = this.overview.friends.find((f) => f.uuid === uuid)?.unread ?? 0;
    const friend = mapFriend(data.friend ?? { uuid }, unread);
    const mutual = (Array.isArray(data.mutual) ? data.mutual : [])
      .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : {}))
      .filter((m) => typeof m.uuid === 'string' && /^[0-9a-f]{32}$/.test(m.uuid))
      .map((m) => ({ uuid: m.uuid as string, name: str(m.name) || (m.uuid as string) }));
    let cosmetics: Record<string, string | null> | null = null;
    if (data.cosmetics && typeof data.cosmetics === 'object') {
      cosmetics = {};
      for (const [slot, id] of Object.entries(data.cosmetics as Record<string, unknown>)) {
        if (/^[a-z]{1,16}$/.test(slot)) cosmetics[slot] = typeof id === 'string' && /^[a-z0-9_-]{1,40}$/.test(id) ? id : null;
      }
    }
    return { friend, mutual, cape: typeof data.cape === 'string' && /^[a-z0-9_-]{0,40}$/.test(data.cape) ? data.cape : '', cosmetics };
  }

  /** Freunde von Freunden (GET /v1/friends/suggestions); Dienst ohne Vorschläge: aus */
  async suggestions(): Promise<FriendSuggestions> {
    const account = await this.actionAccount();
    let data: { enabled?: unknown; suggestions?: unknown };
    try {
      data = await this.call(account, '/v1/friends/suggestions');
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) return { enabled: false, suggestions: [] };
      throw error;
    }
    const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
      .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
      .filter((s) => typeof s.uuid === 'string' && /^[0-9a-f]{32}$/.test(s.uuid))
      .slice(0, 20)
      .map((s) => ({ uuid: s.uuid as string, name: str(s.name) || (s.uuid as string), mutual: Math.max(0, Math.floor(num(s.mutual))) }));
    return { enabled: data.enabled !== false, suggestions };
  }

  requestSuggestion(uuid: unknown): Promise<SocialOverview> {
    return this.friendsAction(`/v1/friends/suggestions/${normalizeUuid(uuid)}/request`, 'POST');
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

  /**
   * Nachricht senden; extra.replyTo = Antwort auf eine Nachricht dieser Unterhaltung, extra.card = Beitreten-Karte
   * (schon geprüft, siehe checkCard). Der Text bleibt Pflicht (Rückfall für ältere Clients).
   */
  async sendMessage(uuid: unknown, rawText: unknown, extra: { replyTo?: unknown; card?: MessageCard | null } = {}): Promise<ChatMessage> {
    const friend = normalizeUuid(uuid);
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) throw new Error('Die Nachricht ist leer.');
    if ([...text].length > 500) throw new Error('Nachrichten haben höchstens 500 Zeichen.');
    const body: { text: string; replyTo?: number; card?: MessageCard } = { text };
    if (extra.replyTo !== undefined && extra.replyTo !== null) {
      if (!Number.isSafeInteger(extra.replyTo) || (extra.replyTo as number) < 1) throw new Error('Ungültige Nachrichten-ID.');
      body.replyTo = extra.replyTo as number;
    }
    if (extra.card) body.card = extra.card;
    const account = await this.actionAccount();
    const me = await this.meUuid(account);
    const data = await this.call<{ message?: RawMessage }>(account, `/v1/messages/${friend}`, { method: 'POST', body });
    // ohne Echtzeit: Liste (Zähler, Sortierung) frisch
    if (this.realtime !== 'live') void this.refresh().catch(() => undefined);
    this.typingSent.delete(friend);
    return mapMessage(data.message ?? {}, me);
  }

  /** eigene Nachricht für beide löschen */
  async deleteMessage(uuid: unknown, id: unknown): Promise<void> {
    const friend = normalizeUuid(uuid);
    if (!Number.isSafeInteger(id) || (id as number) < 1) throw new Error('Ungültige Nachrichten-ID.');
    const account = await this.actionAccount();
    await this.call(account, `/v1/messages/${friend}/${id as number}`, { method: 'DELETE' });
  }

  /** eigene Reaktion setzen bzw. (null) entfernen */
  async react(uuid: unknown, id: unknown, reaction: unknown): Promise<ChatMessage> {
    const friend = normalizeUuid(uuid);
    if (!Number.isSafeInteger(id) || (id as number) < 1) throw new Error('Ungültige Nachrichten-ID.');
    if (reaction !== null && !REACTION_IDS.includes(reaction as ReactionId)) throw new Error('Diese Reaktion gibt es nicht.');
    const account = await this.actionAccount();
    const me = await this.meUuid(account);
    const route = `/v1/messages/${friend}/${id as number}/reaction`;
    const data = await this.call<{ message?: RawMessage }>(account, route, reaction === null ? { method: 'DELETE' } : { method: 'PUT', body: { reaction } });
    return mapMessage(data.message ?? {}, me);
  }

  /** „schreibt …“ – höchstens alle 3 s je Freund; über die Echtzeit-Verbindung, sonst POST …/typing */
  async typing(uuid: unknown): Promise<void> {
    const friend = normalizeUuid(uuid);
    const now = Date.now();
    if (now - (this.typingSent.get(friend) ?? 0) < TYPING_INTERVAL_MS) return;
    this.typingSent.set(friend, now);
    if (this.sendRealtime({ type: 'typing', to: friend })) return;
    const account = await this.actionAccount();
    await this.call(account, `/v1/messages/${friend}/typing`, { method: 'POST' }).catch(() => undefined);
  }

  async markRead(uuid: unknown): Promise<void> {
    const friend = normalizeUuid(uuid);
    const account = await this.actionAccount();
    await this.call(account, `/v1/messages/${friend}/read`, { method: 'POST' });
    // Zähler sofort nullen (Abzeichen), dann (ohne Echtzeit) frisch laden
    if (account.id === this.currentAccount && this.overview.status === 'online') this.setUnread(friend, 0);
    this.baseline?.unread.set(friend, 0);
    if (this.realtime !== 'live') void this.refresh().catch(() => undefined);
  }

  // ---------- Blockieren, Melden, Privatsphäre, eigener Status ----------

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
    const me = mapMe(await this.call<Partial<Record<keyof ServiceMe, unknown>>>(account, '/v1/me'));
    this.rememberMe(account, me);
    return me;
  }

  async updateMe(patch: Partial<Omit<ServiceMe, 'uuid' | 'name' | 'badge'>>, requireEnabled = false): Promise<ServiceMe> {
    const account = await this.actionAccount(requireEnabled);
    const me = mapMe(await this.call<Partial<Record<keyof ServiceMe, unknown>>>(account, '/v1/me', { method: 'PUT', body: patch }));
    this.rememberMe(account, me);
    return me;
  }

  private rememberMe(account: A, me: ServiceMe): void {
    this.meInfo.set(account.id, me);
    if (account.id === this.currentAccount && this.overview.status === 'online' && this.overview.me) {
      this.publish({ ...this.overview, me: this.meOf(account, this.overview.me) });
    }
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
      const notify = (raw as Record<string, unknown>).onlineNotify;
      if (ONLINE_NOTIFY.includes(notify as OnlineNotify)) patch.onlineNotify = notify as OnlineNotify;
    }
    if (Object.keys(patch).length === 0) return this.getPrivacy();
    const result = pickPrivacy(await this.updateMe(patch, true));
    if (this.realtime !== 'live') void this.refresh().catch(() => undefined);
    return result;
  }

  /** Eigener Statustext (höchstens 40 Zeichen, '' bzw. null löscht) und „Nicht stören“ */
  async setStatus(raw: unknown): Promise<SocialOverview> {
    const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const patch: { statusText?: string | null; dnd?: boolean } = {};
    if ('statusText' in input) {
      if (input.statusText !== null && typeof input.statusText !== 'string') throw new Error('Der Status muss ein Text sein.');
      const text = cleanLine(input.statusText);
      if ([...text].length > STATUS_MAX) throw new Error(`Der Status hat höchstens ${STATUS_MAX} Zeichen.`);
      patch.statusText = text || null;
    }
    if ('dnd' in input) {
      if (typeof input.dnd !== 'boolean') throw new Error('„Nicht stören“ muss an oder aus sein.');
      patch.dnd = input.dnd;
    }
    if (Object.keys(patch).length) await this.updateMe(patch, true);
    return this.overview;
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
