// Welt teilen (ab 1.12.0): Welten mit fester Adresse `<code>.<Welt-Domain>` und ihre Mitglieder, die Steuerverbindung
// des Gastgebers (`/v1/worlds/host`) und die Datenströme (`/v1/worlds/streams/<id>`), über die das Relay
// (world-relay.ts) Minecraft-Verbindungen zum Gastgeber durchreicht. Der Gastgeber sieht keine IP-Adressen. Der Dienst
// speichert Welten und Mitglieder; offene Welten, Spielerzahlen, Anklopfen und Datenströme liegen nur im Arbeitsspeicher.
// In kein Log kommen IP-Adressen, Inhalte der Verbindungen, Namen aus Login Start oder Codes.
import { randomBytes, randomInt } from 'node:crypto';
import type { Socket } from 'node:net';
import { WebSocket, type RawData } from 'ws';
import type { Store, UserRow, WorldAccess, WorldMemberRow, WorldRole, WorldRow } from './db';
import { HttpError } from './http';
import { INVITE_CODE_ALPHABET } from './invites';
import { loginDisconnect } from './minecraft-protocol';
import type { Realtime } from './realtime';
import { checkText, codePointLength, isName, isUuid } from './validate';

export const WORLD_CODE_LENGTH = 6;
/** Code einer Welt: 6 Zeichen aus dem Alphabet der Einladungen (ohne i, l, o, 0 und 1). */
export const WORLD_CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
export const WORLD_ID_RE = /^[0-9a-f]{32}$/;
/** Höchstens so viele Welten je Spieler (geöffnet sein kann davon eine). */
export const MAX_WORLDS = 10;
/** Höchstens so viele Mitglieder je Welt. */
export const MAX_WORLD_MEMBERS = 200;
/** Höchstens so viele Freunde je Einladung (`POST /v1/worlds/<id>/invite`). */
export const MAX_WORLD_INVITES = 50;
export const WORLD_MAX_PLAYERS = 20;
export const WORLD_DEFAULT_MAX_PLAYERS = 8;
export const WORLD_NAME_MAX = 32;
export const WORLD_MOTD_MAX = 256;
export const WORLD_ACCESS: readonly WorldAccess[] = ['invited', 'friends', 'open'];
export const WORLD_ROLES: readonly WorldRole[] = ['visitor', 'player', 'operator'];
export const WORLD_HOST_PATH = '/v1/worlds/host';
export const WORLD_STREAM_PATH_RE = /^\/v1\/worlds\/streams\/([0-9a-f]{32})$/;
/** Größte WebSocket-Nachricht auf einem Datenstrom (größere trennt ws mit 1009). */
export const WORLD_STREAM_MAX_PAYLOAD = 1024 * 1024;
/** Schließcodes der Steuerverbindung (dazu 4000–4003 wie bei /v1/ws und 4002 „Neue Verbindung“). */
export const CLOSE_WORLD_DELETED = 4010;
export const CLOSE_WORLD_ERROR = 4011;

export const WORLDS_OFF = 'Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet.';
export const WORLD_GONE = 'Diese Welt gibt es nicht (mehr).';
export const STREAM_GONE = 'Diesen Datenstrom gibt es nicht (mehr).';
export const WORLD_DELETED = 'Die Welt wurde gelöscht.';

// Texte, die Spieler beim Beitreten sehen (Disconnect beim Login bzw. Beschreibung in der Serverliste)
export const TEXT_OFFLINE = 'Die Welt ist gerade nicht geöffnet.';
export const TEXT_UNKNOWN = 'Diese Welt gibt es nicht. Prüf die Adresse.';
export const TEXT_DENIED = 'Der Gastgeber hat deine Anfrage abgelehnt.';
export const TEXT_NO_ANSWER = 'Der Gastgeber antwortet gerade nicht. Versuch es gleich noch einmal.';
export const TEXT_BUSY = 'Gerade wollen zu viele gleichzeitig beitreten. Versuch es gleich noch einmal.';
export const TEXT_BAD_NAME = 'Ungültiger Spielername.';
export const STATUS_UNKNOWN = 'Diese Welt gibt es nicht';

export function textNotInvited(host: string): string {
  return `Du bist noch nicht eingeladen – ${host} wurde gefragt. Versuch es gleich noch einmal.`;
}

export function textFull(max: number): string {
  return `Die Welt ist voll (höchstens ${max} Spieler).`;
}

export function statusOffline(host: string): string {
  return `Welt von ${host} ist gerade nicht geöffnet`;
}

/** Minecraft-Version wie „26.3“, „1.21.5“, „25w14a“ oder „1.21.5-rc1“. */
const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;
/** Steuerzeichen außer dem Zeilenumbruch (MOTD darf zwei Zeilen haben). */
const MOTD_FORBIDDEN_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;
/** Steuerverbindung: höchstens so viele Textnachrichten pro Sekunde, der Rest wird verworfen. */
const TEXT_LIMIT = 20;
const WINDOW_MS = 1000;
/** Ab dieser Puffergröße bekommt eine langsame Steuerverbindung nichts mehr und wird getrennt. */
const MAX_BUFFERED = 1024 * 1024;
/** Datenstrom: ab so vielen ungesendeten Byte zum Gastgeber liest der Dienst vom Spieler nicht mehr weiter. */
const STREAM_HIGH_WATER = 1024 * 1024;
const STREAM_LOW_WATER = 256 * 1024;
/** Anklopfen: derselbe Name höchstens alle 30 Sekunden, je Welt höchstens 10 pro Minute; Ablehnen gilt 10 Minuten. */
const KNOCK_REPEAT_MS = 30_000;
const KNOCKS_PER_MINUTE = 10;
const DENY_MS = 10 * 60_000;
/** Höchstens so viele abgelehnte Namen merkt sich eine geöffnete Welt. */
const MAX_DENIED = 500;
/** Höchstens so viele Datenströme je Welt warten gleichzeitig darauf, dass der Gastgeber sie öffnet. */
const MAX_PENDING_STREAMS = 16;

export type StreamKind = 'status' | 'login';

export interface WorldsOptions {
  /** Welt-Domain, z. B. `welt.heldixclient.com` (Adressen `<code>.<domain>`). */
  domain: string;
  /** Höchstens so viele Welten je Spieler (Standard 10). */
  maxWorlds: number;
  /** Steuerverbindung ohne Nachricht und Datenstrom ohne Bytes in beide Richtungen so lange offen (Standard 60 s). */
  idleTimeoutMs: number;
  /** So lange hat der Gastgeber Zeit, einen Datenstrom zu öffnen (Standard 10 s). */
  streamTimeoutMs: number;
  /** Datenrate je Welt (beide Richtungen zusammen, Byte pro Sekunde; darüber wird gedrosselt). */
  bytesPerSecond: number;
  /** Serverlisten-Abfragen, die je Welt und Minute an den Gastgeber gehen; darüber antwortet der Dienst selbst. */
  statusStreamsPerMinute: number;
  log: (line: string) => void;
  /** Party-Mitglieder des Gastgebers (ab 1.12.0): dürfen beitreten wie Mitglieder der Welt. */
  partyMates?: (owner: string) => ReadonlySet<string>;
  /** Eine Welt des Spielers ging auf oder zu (Party: Ort des Gastgebers, Folgen). */
  onHostChange?: (owner: string) => void;
}

interface HostConnection {
  ws: WebSocket;
  uuid: string;
  session: HostSession | null;
  idleTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  textWindow: number;
  texts: number;
}

/** Geöffnete Welt (nur im Arbeitsspeicher, solange die Steuerverbindung sie offen hält). */
interface HostSession {
  world: string;
  code: string;
  owner: string;
  conn: HostConnection;
  version: string;
  protocol: number;
  motd: string;
  /** Spielerzahl laut Gastgeber (mit ihm selbst) oder null, solange er keine gemeldet hat */
  reported: number | null;
  /** offene Datenströme mit kind 'login' (wartend oder durchgereicht) */
  logins: number;
  streams: Set<Stream>;
  /** Drosselung (Token-Bucket über beide Richtungen aller Datenströme der Welt) */
  tokens: number;
  tokensAt: number;
  /** Anklopfen: Name (klein) → Zeitpunkt; Zähler je Minute; abgelehnte Namen bis zu einem Zeitpunkt */
  knocks: Map<string, number>;
  knockWindow: number;
  knockCount: number;
  denied: Map<string, number>;
  statusWindow: number;
  statusCount: number;
  /** wem der Dienst „Welt offen“ gemeldet hat (für `world-closed`) */
  viewers: Set<string>;
}

type Hold = 'peer' | 'rate';

interface Stream {
  id: string;
  session: HostSession;
  kind: StreamKind;
  name: string | null;
  socket: Socket;
  /** Bytes vom Spieler, bevor der Datenstrom offen war (Handshake, Login Start …) */
  pending: Buffer | null;
  ws: WebSocket | null;
  claimed: boolean;
  closed: boolean;
  timer?: NodeJS.Timeout;
  lastActivity: number;
  /** an den Gastgeber gesendet, aber noch nicht hinausgeschrieben */
  inFlight: number;
  /** wegen der Datenrate angestellt (Richtung Gastgeber bzw. Spieler) */
  toHost: Buffer[];
  toPlayer: Buffer[];
  /** warum das Lesen vom Spieler bzw. vom Gastgeber gerade ruht */
  socketHold: Set<Hold>;
  wsHold: Set<Hold>;
  socketRateTimer?: NodeJS.Timeout;
  wsRateTimer?: NodeJS.Timeout;
}

/** Was das Relay zu einer Adresse wissen muss. */
export interface RelayTarget {
  world: WorldRow;
  ownerName: string;
  session: HostSession | null;
}

/** Eigene Status-Antwort des Relays (Welt geöffnet, aber zu viele Abfragen auf einmal). */
export interface OnlineStatus {
  version: string;
  protocol: number;
  motd: string;
  players: number;
  maxPlayers: number;
}

export interface WorldView {
  id: string;
  code: string;
  address: string;
  name: string;
  access: WorldAccess;
  maxPlayers: number;
  defaultRole: WorldRole;
  created: number;
  lastOnline: number | null;
  online: boolean;
  players: number;
  version: string | null;
}

export interface MemberView {
  name: string;
  uuid: string | null;
  role: WorldRole;
  added: number;
}

/** Geöffnete Welt eines Freundes bzw. mit Mitgliedschaft (`friends` in `GET /v1/worlds`, `world-open`). */
export interface FriendWorldView {
  id: string;
  name: string;
  address: string;
  host: { uuid: string; name: string };
  players: number;
  maxPlayers: number;
  version: string;
  online: true;
}

/** Neuer Code: gleich verteilt aus dem Alphabet (crypto.randomInt). */
export function newWorldCode(): string {
  let code = '';
  for (let i = 0; i < WORLD_CODE_LENGTH; i++) code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  return code;
}

/** Welt-Domain prüfen (Name mit mindestens einem Punkt, ohne Port); Ergebnis klein geschrieben oder null. */
export function normalizeWorldDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (domain.length > 200) return null;
  const labels = domain.split('.');
  if (labels.length < 2) return null;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? domain : null;
}

function memberView(member: WorldMemberRow): MemberView {
  return { name: member.name, uuid: member.uuid, role: member.role, added: member.addedAt };
}

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/**
 * Datenauskunft: eigene Welten mit Mitgliedern und Mitgliedschaften in Welten anderer. Geht auch, wenn Welt teilen
 * gerade aus ist (`domain` null: keine Adressen).
 */
export function exportWorlds(store: Store, user: UserRow, domain: string | null) {
  return {
    worlds: store.worldsOf(user.uuid).map((world) => ({
      id: world.id,
      code: world.code,
      address: domain === null ? null : `${world.code}.${domain}`,
      name: world.name,
      access: world.access,
      maxPlayers: world.maxPlayers,
      defaultRole: world.defaultRole,
      createdAt: world.createdAt,
      lastOnline: world.lastOnline,
      version: world.version,
      members: store.worldMembers(world.id).map(memberView),
    })),
    memberOf: store.worldMembershipsOf(user.uuid, user.name).map((m) => ({
      world: m.world,
      name: m.worldName,
      host: { uuid: m.owner, name: m.ownerName },
      as: m.name,
      role: m.role,
      added: m.addedAt,
    })),
  };
}

export class Worlds {
  /** Steuerverbindungen: höchstens eine je Spieler. */
  private readonly hosts = new Map<string, HostConnection>();
  /** Geöffnete Welten nach ID (je Spieler höchstens eine, über seine Steuerverbindung). */
  private readonly sessions = new Map<string, HostSession>();
  /** Datenströme nach ID (wartend und durchgereicht). */
  private readonly streams = new Map<string, Stream>();
  private closing = false;
  /** false, wenn der Port des Relays nicht geöffnet werden konnte: dann wie ohne Welt-Domain (503). */
  available = true;

  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly options: WorldsOptions,
  ) {}

  get domain(): string {
    return this.options.domain;
  }

  /** Geöffnete Welten (für /v1/status). */
  openCount(): number {
    return this.sessions.size;
  }

  address(code: string): string {
    return `${code}.${this.options.domain}`;
  }

  /** Geöffnete Welt des Spielers (Party: Ort des Gastgebers) oder null. */
  hostedBy(uuid: string): { id: string; code: string; name: string } | null {
    const session = this.hosts.get(uuid)?.session;
    if (!session || this.sessions.get(session.world) !== session) return null;
    const world = this.store.getWorld(session.world);
    return world ? { id: world.id, code: world.code, name: world.name } : null;
  }

  /** Welt zu einer Adresse `<code>.<Welt-Domain>` (ohne Port, klein) oder null. */
  worldAt(address: string): WorldRow | null {
    const suffix = `.${this.options.domain}`;
    if (!address.endsWith(suffix)) return null;
    const code = address.slice(0, -suffix.length);
    return WORLD_CODE_RE.test(code) ? (this.store.getWorldByCode(code) ?? null) : null;
  }

  private hostChanged(owner: string): void {
    try {
      this.options.onHostChange?.(owner);
    } catch (err) {
      this.options.log(`Fehler bei Welt teilen (Party): ${(err as Error).message}`);
    }
  }

  // ---------- Hilfen ----------

  /** Eigene Welt zur ID oder 404. */
  private own(user: UserRow, id: string | undefined): WorldRow {
    const world = id !== undefined && WORLD_ID_RE.test(id) ? this.store.getWorld(id) : undefined;
    if (!world || world.owner !== user.uuid) throw new HttpError(404, WORLD_GONE);
    return world;
  }

  /** Spieler in der Welt: der größere Wert aus der Meldung des Gastgebers und 1 (er selbst) plus offene Logins. */
  private playersOf(session: HostSession): number {
    return Math.max(session.reported ?? 0, 1 + session.logins);
  }

  view(world: WorldRow): WorldView {
    const session = this.sessions.get(world.id);
    return {
      id: world.id,
      code: world.code,
      address: this.address(world.code),
      name: world.name,
      access: world.access,
      maxPlayers: world.maxPlayers,
      defaultRole: world.defaultRole,
      created: world.createdAt,
      lastOnline: world.lastOnline,
      online: session !== undefined,
      players: session ? this.playersOf(session) : 0,
      version: session?.version ?? world.version,
    };
  }

  /** Geöffnete Welt, wie Freunde und Mitglieder sie sehen. */
  private friendView(session: HostSession, world: WorldRow, owner: UserRow): FriendWorldView {
    return {
      id: world.id,
      name: world.name,
      address: this.address(world.code),
      host: { uuid: owner.uuid, name: owner.name },
      players: this.playersOf(session),
      maxPlayers: world.maxPlayers,
      version: session.version,
      online: true,
    };
  }

  private members(world: string): MemberView[] {
    return this.store.worldMembers(world).map(memberView);
  }

  /** UUID eines Heldix-Spielers, der gerade so heißt (oder null). */
  private uuidFor(name: string): string | null {
    return this.store.findUserByName(name)?.uuid ?? null;
  }

  private blockedBetween(a: string, b: string): boolean {
    return this.store.isBlocked(a, b) || this.store.isBlocked(b, a);
  }

  private checkName(value: unknown): string {
    const result = checkText(value, WORLD_NAME_MAX, false);
    if ('problem' in result) throw new HttpError(400, `Der Name der Welt muss 1 bis ${WORLD_NAME_MAX} Zeichen lang sein (ohne Steuerzeichen).`);
    return result.text;
  }

  private checkAccess(value: unknown): WorldAccess {
    if (!(WORLD_ACCESS as readonly unknown[]).includes(value)) throw new HttpError(400, '„access“ muss "invited", "friends" oder "open" sein.');
    return value as WorldAccess;
  }

  private checkMaxPlayers(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > WORLD_MAX_PLAYERS) {
      throw new HttpError(400, `„maxPlayers“ muss eine ganze Zahl von 1 bis ${WORLD_MAX_PLAYERS} sein.`);
    }
    return value;
  }

  private checkRole(value: unknown, field: string): WorldRole {
    if (!(WORLD_ROLES as readonly unknown[]).includes(value)) throw new HttpError(400, `„${field}“ muss "visitor", "player" oder "operator" sein.`);
    return value as WorldRole;
  }

  private memberName(value: string | undefined): string {
    if (!isName(value)) throw new HttpError(400, 'Ungültiger Spielername.');
    return value;
  }

  // ---------- Endpunkte (angemeldet) ----------

  /** `GET /v1/worlds`: eigene Welten und gerade geöffnete Welten von Freunden bzw. mit Mitgliedschaft. */
  list(user: UserRow) {
    return { mine: this.store.worldsOf(user.uuid).map((world) => this.view(world)), friends: this.friendWorlds(user) };
  }

  /** Geöffnete Welten, die `user` sieht: von Freunden mit Zugang „Freunde“/„offen“ (Präsenz an) und als Mitglied. */
  private friendWorlds(user: UserRow): FriendWorldView[] {
    const found = new Map<string, FriendWorldView>();
    for (const friend of this.store.listFriendIds(user.uuid)) {
      const session = this.hosts.get(friend.uuid)?.session;
      if (!session) continue;
      const world = this.store.getWorld(session.world);
      const owner = this.store.getUser(session.owner);
      if (!world || !owner || world.access === 'invited' || !owner.presence) continue;
      found.set(world.id, this.friendView(session, world, owner));
    }
    for (const id of this.store.worldIdsWithMember(user.uuid, user.name)) {
      const session = this.sessions.get(id);
      if (found.has(id) || !session || session.owner === user.uuid || this.blockedBetween(session.owner, user.uuid)) continue;
      const world = this.store.getWorld(id);
      const owner = this.store.getUser(session.owner);
      if (world && owner) found.set(id, this.friendView(session, world, owner));
    }
    return [...found.values()].sort((a, b) => a.host.name.localeCompare(b.host.name) || a.name.localeCompare(b.name));
  }

  /** `POST /v1/worlds`: neue Welt (höchstens 10 je Spieler). */
  create(user: UserRow, input: Record<string, unknown>): WorldView {
    if (this.store.countWorlds(user.uuid) >= this.options.maxWorlds) {
      throw new HttpError(409, `Du hast schon ${this.options.maxWorlds} Welten. Lösch eine, bevor du eine neue anlegst.`);
    }
    const name = input.name === undefined || input.name === null ? `Welt von ${user.name}` : this.checkName(input.name);
    const access = input.access === undefined ? 'invited' : this.checkAccess(input.access);
    const maxPlayers = input.maxPlayers === undefined ? WORLD_DEFAULT_MAX_PLAYERS : this.checkMaxPlayers(input.maxPlayers);
    const defaultRole = input.defaultRole === undefined ? 'player' : this.checkRole(input.defaultRole, 'defaultRole');
    let code = newWorldCode();
    // Zufällig doppelt (31^6 Möglichkeiten): einfach einen neuen ziehen.
    for (let tries = 0; this.store.getWorldByCode(code) && tries < 10; tries++) code = newWorldCode();
    if (this.store.getWorldByCode(code)) throw new HttpError(503, 'Gerade ist kein freier Code zu finden. Bitte gleich noch einmal.');
    const world = { id: randomBytes(16).toString('hex'), owner: user.uuid, code, name, access, maxPlayers, defaultRole, createdAt: Date.now() };
    this.store.insertWorld(world);
    return this.view(this.store.getWorld(world.id)!);
  }

  /** `GET /v1/worlds/<id>`: eine eigene Welt. */
  get(user: UserRow, id: string | undefined): WorldView {
    return this.view(this.own(user, id));
  }

  /** `PATCH /v1/worlds/<id>` mit einem Teil von `{ name, access, maxPlayers, defaultRole }`. */
  update(user: UserRow, id: string | undefined, input: Record<string, unknown>): WorldView {
    const world = this.own(user, id);
    const patch = {
      name: Object.hasOwn(input, 'name') ? this.checkName(input.name) : undefined,
      access: Object.hasOwn(input, 'access') ? this.checkAccess(input.access) : undefined,
      maxPlayers: Object.hasOwn(input, 'maxPlayers') ? this.checkMaxPlayers(input.maxPlayers) : undefined,
      defaultRole: Object.hasOwn(input, 'defaultRole') ? this.checkRole(input.defaultRole, 'defaultRole') : undefined,
    };
    this.store.updateWorld(world.id, patch);
    const updated = this.store.getWorld(world.id)!;
    const session = this.sessions.get(world.id);
    if (session) {
      this.sendHost(session.conn, { type: 'settings', world: this.view(updated) });
      this.refreshViewers(session);
    }
    return this.view(updated);
  }

  /** `DELETE /v1/worlds/<id>`: Ist sie gerade geöffnet, bekommt der Gastgeber `error` und die Verbindung schließt (4010). */
  remove(user: UserRow, id: string | undefined): { ok: true } {
    const world = this.own(user, id);
    const session = this.sessions.get(world.id);
    if (session) {
      this.sendHost(session.conn, { type: 'error', message: WORLD_DELETED });
      this.dropHost(session.conn, CLOSE_WORLD_DELETED, 'Welt gelöscht');
    }
    this.store.deleteWorld(world.id, user.uuid);
    return { ok: true };
  }

  /** `GET /v1/worlds/<id>/members` */
  memberList(user: UserRow, id: string | undefined): MemberView[] {
    return this.members(this.own(user, id).id);
  }

  /** `PUT /v1/worlds/<id>/members/<name>` mit `{ role? }` (ohne: Standardrolle der Welt). */
  putMember(user: UserRow, id: string | undefined, rawName: string | undefined, input: Record<string, unknown>): MemberView[] {
    const world = this.own(user, id);
    const name = this.memberName(rawName);
    const role = input.role === undefined ? world.defaultRole : this.checkRole(input.role, 'role');
    if (!this.store.getWorldMember(world.id, name) && this.store.countWorldMembers(world.id) >= MAX_WORLD_MEMBERS) {
      throw new HttpError(409, `Eine Welt hat höchstens ${MAX_WORLD_MEMBERS} Mitglieder.`);
    }
    this.store.putWorldMember(world.id, name, this.uuidFor(name), role, Date.now());
    this.membersChanged(world.id);
    return this.members(world.id);
  }

  /** `DELETE /v1/worlds/<id>/members/<name>` (auch, wenn es kein Mitglied war). */
  deleteMember(user: UserRow, id: string | undefined, rawName: string | undefined): MemberView[] {
    const world = this.own(user, id);
    if (this.store.deleteWorldMember(world.id, this.memberName(rawName))) this.membersChanged(world.id);
    return this.members(world.id);
  }

  /**
   * `POST /v1/worlds/<id>/invite` mit `{ uuids: [Freunde] }`: Jeder Freund wird Mitglied (mit der Standardrolle; eine
   * vorhandene Rolle bleibt) und bekommt `world-invite`. UUIDs, die keine Freunde sind, überspringt der Dienst.
   */
  invite(user: UserRow, id: string | undefined, input: Record<string, unknown>) {
    const world = this.own(user, id);
    const { uuids } = input;
    if (!Array.isArray(uuids) || uuids.length === 0 || uuids.length > MAX_WORLD_INVITES || !uuids.every((uuid) => isUuid(uuid))) {
      throw new HttpError(400, `„uuids“ muss eine Liste mit 1 bis ${MAX_WORLD_INVITES} UUIDs von Freunden sein.`);
    }
    const friends = this.store.getUsers([...new Set(uuids as string[])].filter((uuid) => this.store.friendsSince(user.uuid, uuid) !== undefined));
    const now = Date.now();
    const invited: { uuid: string; name: string }[] = [];
    const message = {
      type: 'world-invite',
      world: { id: world.id, name: world.name, address: this.address(world.code), host: { uuid: user.uuid, name: user.name } },
    };
    for (const friend of friends) {
      if (!this.store.getWorldMember(world.id, friend.name) && this.store.countWorldMembers(world.id) >= MAX_WORLD_MEMBERS) {
        throw new HttpError(409, `Eine Welt hat höchstens ${MAX_WORLD_MEMBERS} Mitglieder.`);
      }
      this.store.addWorldMember(world.id, friend.name, friend.uuid, world.defaultRole, now);
      this.realtime.send(friend.uuid, message);
      invited.push({ uuid: friend.uuid, name: friend.name });
    }
    if (invited.length > 0) this.membersChanged(world.id);
    return { invited, members: this.members(world.id) };
  }

  /** Mitglieder geändert: Gastgeber bekommt die neue Liste, Mitglieder sehen die geöffnete Welt (oder nicht mehr). */
  private membersChanged(world: string): void {
    const session = this.sessions.get(world);
    if (!session) return;
    this.sendHost(session.conn, { type: 'members', members: this.members(world) });
    this.refreshViewers(session);
  }

  // ---------- Öffentlich ----------

  /** `GET /v1/public/worlds/<code>`: was die Webseite zu einer Adresse zeigt. */
  publicInfo(code: string) {
    const world = WORLD_CODE_RE.test(code) ? this.store.getWorldByCode(code) : undefined;
    const owner = world ? this.store.getUser(world.owner) : undefined;
    if (!world || !owner) throw new HttpError(404, 'Diese Welt gibt es nicht.');
    const session = this.sessions.get(world.id);
    return {
      name: world.name,
      address: this.address(world.code),
      host: { uuid: owner.uuid, name: owner.name },
      online: session !== undefined,
      players: session ? this.playersOf(session) : 0,
      maxPlayers: world.maxPlayers,
      version: session?.version ?? world.version,
      access: world.access === 'open' ? 'open' : 'closed',
    };
  }

  // ---------- Wer die Welt in der Freundesliste sieht ----------

  /** Freunde (Zugang Freunde/offen und Präsenz an) und Mitglieder mit Heldix-Konto, ohne Blockierte. */
  private viewersOf(session: HostSession): Set<string> {
    const viewers = new Set<string>();
    const world = this.store.getWorld(session.world);
    const owner = this.store.getUser(session.owner);
    if (!world || !owner) return viewers;
    if (world.access !== 'invited' && owner.presence) for (const friend of this.store.listFriendIds(owner.uuid)) viewers.add(friend.uuid);
    const members = this.store.worldMembers(world.id);
    for (const user of this.store.getUsers(members.filter((m) => m.uuid !== null).map((m) => m.uuid!))) viewers.add(user.uuid);
    for (const member of members) {
      if (member.uuid !== null) continue;
      const user = this.store.findUserByName(member.name);
      if (user) viewers.add(user.uuid);
    }
    viewers.delete(owner.uuid);
    for (const uuid of [...viewers]) if (this.blockedBetween(owner.uuid, uuid)) viewers.delete(uuid);
    return viewers;
  }

  /** `world-open` an alle, die die Welt jetzt sehen; `world-closed` an die, die sie nicht mehr sehen. */
  private refreshViewers(session: HostSession, closing = false): void {
    let next = new Set<string>();
    let open: unknown = null;
    if (!closing) {
      next = this.viewersOf(session);
      const world = this.store.getWorld(session.world);
      const owner = this.store.getUser(session.owner);
      if (world && owner) open = { type: 'world-open', world: this.friendView(session, world, owner) };
      else next.clear();
    }
    const closed = { type: 'world-closed', world: { id: session.world } };
    for (const uuid of session.viewers) if (!next.has(uuid)) this.realtime.send(uuid, closed);
    if (open !== null) for (const uuid of next) this.realtime.send(uuid, open);
    session.viewers = next;
  }

  // ---------- Steuerverbindung (/v1/worlds/host) ----------

  /** Neue, bereits angemeldete Steuerverbindung. Eine ältere desselben Spielers wird geschlossen (4002). */
  attachHost(ws: WebSocket, uuid: string): void {
    const conn: HostConnection = { ws, uuid, session: null, textWindow: Date.now(), texts: 0 };
    // Zuerst die Ereignisse anmelden: Geht danach etwas schief, räumt 'close' auf.
    ws.on('message', (data, isBinary) => this.onHostMessage(conn, data, isBinary));
    ws.on('ping', () => this.resetIdle(conn));
    ws.on('pong', () => this.resetIdle(conn));
    ws.on('error', () => {
      // Danach folgt immer 'close'.
    });
    ws.on('close', () => this.onHostClose(conn));
    const old = this.hosts.get(uuid);
    if (old) this.dropHost(old, 4002, 'Neue Verbindung');
    this.hosts.set(uuid, conn);
    this.resetIdle(conn);
  }

  /** Einstellungen des Gastgebers geändert (z. B. Präsenz): neu bestimmen, wer seine geöffnete Welt sieht. */
  ownerChanged(uuid: string): void {
    const session = this.hosts.get(uuid)?.session;
    if (session) this.refreshViewers(session);
  }

  /** Konto gelöscht oder gesperrt: Steuerverbindung schließen (die Welt mit allen Datenströmen). */
  disconnectUser(uuid: string, code: number, reason: string): void {
    const conn = this.hosts.get(uuid);
    if (conn) this.dropHost(conn, code, reason);
  }

  private onHostMessage(conn: HostConnection, data: RawData, isBinary: boolean): void {
    if (this.hosts.get(conn.uuid) !== conn) return;
    this.resetIdle(conn);
    const now = Date.now();
    if (now - conn.textWindow >= WINDOW_MS) {
      conn.textWindow = now;
      conn.texts = 0;
    }
    if (++conn.texts > TEXT_LIMIT || isBinary) return;
    let message: unknown;
    try {
      message = JSON.parse(toBuffer(data).toString('utf8'));
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return;
    const input = message as Record<string, unknown>;
    try {
      switch (input.type) {
        case 'ping':
          // Konto inzwischen gesperrt oder gelöscht (z. B. über heldix-dienst-admin): beim nächsten Lebenszeichen trennen.
          if (!this.store.getUser(conn.uuid)) {
            const banned = this.store.getBan(conn.uuid) !== undefined;
            this.dropHost(conn, banned ? 4003 : 4001, banned ? 'Gesperrt' : 'Konto gelöscht');
            return;
          }
          this.sendHost(conn, { type: 'pong' });
          return;
        case 'open':
          this.open(conn, input);
          return;
        case 'players': {
          const { count } = input;
          if (conn.session && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 1000) conn.session.reported = count;
          return;
        }
        case 'allow':
          this.allow(conn, input.name);
          return;
        case 'deny':
          if (conn.session && isName(input.name)) {
            const { denied, knocks } = conn.session;
            const lower = input.name.toLowerCase();
            if (denied.size >= MAX_DENIED) for (const [key, until] of denied) if (until <= now) denied.delete(key);
            if (denied.size >= MAX_DENIED && !denied.has(lower)) return;
            denied.set(lower, now + DENY_MS);
            knocks.delete(lower);
          }
          return;
        case 'close':
          if (conn.session) this.closeSession(conn.session);
          return;
      }
      // Unbekannte Nachrichten werden ignoriert.
    } catch (err) {
      // Nur der Fehler, nie Inhalte (keine Namen, keine Codes).
      this.options.log(`Fehler bei Welt teilen: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  /** `open`: eigene Welt öffnen (eine andere, schon geöffnete schließt dabei); Antwort `ready` oder `error`. */
  private open(conn: HostConnection, input: Record<string, unknown>): void {
    const world = typeof input.world === 'string' && WORLD_ID_RE.test(input.world) ? this.store.getWorld(input.world) : undefined;
    if (!world || world.owner !== conn.uuid) return this.fail(conn, WORLD_GONE);
    const { version, protocol } = input;
    if (typeof version !== 'string' || !VERSION_RE.test(version)) return this.fail(conn, 'Ungültige Minecraft-Version.');
    if (typeof protocol !== 'number' || !Number.isInteger(protocol) || protocol < 0 || protocol > 0x7fffffff) {
      return this.fail(conn, 'Ungültige Protokollnummer.');
    }
    const user = this.store.getUser(conn.uuid);
    if (!user) return this.fail(conn, WORLD_GONE);
    let motd = `Welt von ${user.name}`;
    if (typeof input.motd === 'string') {
      const cleaned = input.motd.replace(/\r\n?/g, '\n').replace(MOTD_FORBIDDEN_RE, ' ').trim();
      if (cleaned !== '') motd = codePointLength(cleaned) > WORLD_MOTD_MAX ? [...cleaned].slice(0, WORLD_MOTD_MAX).join('') : cleaned;
    }
    const now = Date.now();
    if (conn.session && conn.session.world !== world.id) this.closeSession(conn.session);
    let session = conn.session;
    if (session) {
      session.version = version;
      session.protocol = protocol;
      session.motd = motd;
    } else {
      session = {
        world: world.id,
        code: world.code,
        owner: conn.uuid,
        conn,
        version,
        protocol,
        motd,
        reported: null,
        logins: 0,
        streams: new Set(),
        tokens: this.options.bytesPerSecond,
        tokensAt: now,
        knocks: new Map(),
        knockWindow: now,
        knockCount: 0,
        denied: new Map(),
        statusWindow: now,
        statusCount: 0,
        viewers: new Set(),
      };
      conn.session = session;
      this.sessions.set(world.id, session);
    }
    this.store.setWorldOnline(world.id, now, version);
    const updated = this.store.getWorld(world.id)!;
    this.sendHost(conn, { type: 'ready', address: this.address(world.code), code: world.code, world: this.view(updated) });
    this.sendHost(conn, { type: 'members', members: this.members(world.id) });
    this.refreshViewers(session);
    this.hostChanged(conn.uuid);
  }

  /** `allow`: angeklopfter Spieler wird Mitglied (Standardrolle der Welt). */
  private allow(conn: HostConnection, name: unknown): void {
    const session = conn.session;
    if (!session || !isName(name)) return;
    const world = this.store.getWorld(session.world);
    if (!world) return;
    session.denied.delete(name.toLowerCase());
    session.knocks.delete(name.toLowerCase());
    if (this.store.getWorldMember(world.id, name)) return;
    if (this.store.countWorldMembers(world.id) >= MAX_WORLD_MEMBERS) return;
    this.store.addWorldMember(world.id, name, this.uuidFor(name), world.defaultRole, Date.now());
    this.membersChanged(world.id);
  }

  /** `error` schicken und schließen (4011). */
  private fail(conn: HostConnection, message: string): void {
    this.sendHost(conn, { type: 'error', message });
    this.dropHost(conn, CLOSE_WORLD_ERROR, 'Fehler');
  }

  /** Welt schließen: offline, alle Datenströme zu, Freunde und Mitglieder bekommen `world-closed`. */
  private closeSession(session: HostSession): void {
    if (this.sessions.get(session.world) === session) this.sessions.delete(session.world);
    if (session.conn.session === session) session.conn.session = null;
    for (const stream of [...session.streams]) this.endStream(stream);
    try {
      this.store.setWorldOnline(session.world, Date.now(), null);
    } catch (err) {
      this.options.log(`Welt teilen: Zeitpunkt nicht gespeichert (${(err as Error).message}).`);
    }
    this.refreshViewers(session, true);
    if (!this.closing) this.hostChanged(session.owner);
  }

  private dropHost(conn: HostConnection, code: number, reason: string): void {
    if (this.hosts.get(conn.uuid) === conn) this.hosts.delete(conn.uuid);
    if (conn.session) this.closeSession(conn.session);
    this.clearHostTimers(conn);
    conn.ws.close(code, reason);
    conn.killTimer = setTimeout(() => conn.ws.terminate(), Math.min(2000, this.options.idleTimeoutMs));
    conn.killTimer.unref();
  }

  private onHostClose(conn: HostConnection): void {
    this.clearHostTimers(conn);
    if (this.closing) return;
    if (this.hosts.get(conn.uuid) === conn) this.hosts.delete(conn.uuid);
    if (conn.session) this.closeSession(conn.session);
  }

  private resetIdle(conn: HostConnection): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    conn.idleTimer = setTimeout(() => {
      if (this.hosts.get(conn.uuid) === conn) this.dropHost(conn, 4000, 'Zeitüberschreitung');
    }, this.options.idleTimeoutMs);
    conn.idleTimer.unref();
  }

  private clearHostTimers(conn: HostConnection): void {
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    if (conn.killTimer) clearTimeout(conn.killTimer);
  }

  private sendHost(conn: HostConnection, message: unknown): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.ws.bufferedAmount > MAX_BUFFERED) {
      conn.ws.terminate();
      return;
    }
    conn.ws.send(JSON.stringify(message));
  }

  // ---------- Für das Relay ----------

  /** Welt zum Code (null: unbekannt), mit Namen des Gastgebers und der geöffneten Sitzung. */
  resolve(code: string | null): RelayTarget | null {
    if (code === null || !this.available) return null;
    const world = this.store.getWorldByCode(code);
    const owner = world ? this.store.getUser(world.owner) : undefined;
    if (!world || !owner) return null;
    return { world, ownerName: owner.name, session: this.sessions.get(world.id) ?? null };
  }

  /** Eigene Status-Antwort für eine geöffnete Welt. */
  onlineStatus(target: RelayTarget): OnlineStatus | null {
    const session = target.session;
    if (!session || this.sessions.get(session.world) !== session) return null;
    return { version: session.version, protocol: session.protocol, motd: session.motd, players: this.playersOf(session), maxPlayers: target.world.maxPlayers };
  }

  /** Darf diese Serverlisten-Abfrage an den Gastgeber gehen? Sonst antwortet das Relay selbst. */
  canStreamStatus(session: HostSession): boolean {
    if (this.sessions.get(session.world) !== session || this.pendingCount(session) >= MAX_PENDING_STREAMS) return false;
    const now = Date.now();
    if (now - session.statusWindow >= 60_000) {
      session.statusWindow = now;
      session.statusCount = 0;
    }
    return ++session.statusCount <= this.options.statusStreamsPerMinute;
  }

  private pendingCount(session: HostSession): number {
    let count = 0;
    for (const stream of session.streams) if (stream.ws === null) count++;
    return count;
  }

  /**
   * Login prüfen (nur der Name aus Login Start; die echte Prüfung macht der Gastgeber im Online-Modus). Liefert den Text
   * für die Ablehnung oder null (darf durch). Nicht zugelassen: Der Gastgeber bekommt `knock`.
   */
  admit(target: RelayTarget, name: string): string | null {
    const session = target.session;
    if (!session || this.sessions.get(session.world) !== session) return TEXT_OFFLINE;
    const world = target.world;
    const access = this.accessOf(world, name);
    if (access === 'blocked') return textNotInvited(target.ownerName);
    if (access === 'none') {
      const lower = name.toLowerCase();
      const now = Date.now();
      const denied = session.denied.get(lower);
      if (denied !== undefined && denied > now) return TEXT_DENIED;
      this.knock(session, name, now);
      return textNotInvited(target.ownerName);
    }
    if (this.playersOf(session) >= world.maxPlayers) return textFull(world.maxPlayers);
    if (this.pendingCount(session) >= MAX_PENDING_STREAMS) return TEXT_BUSY;
    return null;
  }

  /** Zugang nach Name: Mitglied, Freund (bei „Freunde“), alle (bei „offen“); Blockierte nie (sie merken es nicht). */
  private accessOf(world: WorldRow, name: string): 'member' | 'friend' | 'open' | 'blocked' | 'none' {
    if (this.store.isWorldMemberNamed(world.id, name)) return 'member';
    const user = this.store.findUserByName(name);
    if (user?.uuid === world.owner) return 'member';
    if (user && this.blockedBetween(world.owner, user.uuid)) return 'blocked';
    // Ab 1.12.0: Wer mit dem Gastgeber in einer Party ist, darf hinein (Folgen), wie ein Mitglied.
    if (user && this.options.partyMates?.(world.owner).has(user.uuid)) return 'member';
    if (world.access === 'open') return 'open';
    if (world.access === 'friends' && this.store.hasFriendNamed(world.owner, name)) return 'friend';
    return 'none';
  }

  /** Anklopfen beim Gastgeber: derselbe Name höchstens alle 30 s, je Welt höchstens 10 pro Minute. */
  private knock(session: HostSession, name: string, now: number): void {
    const lower = name.toLowerCase();
    const last = session.knocks.get(lower);
    if (last !== undefined && now - last < KNOCK_REPEAT_MS) return;
    if (now - session.knockWindow >= 60_000) {
      session.knockWindow = now;
      session.knockCount = 0;
    }
    if (++session.knockCount > KNOCKS_PER_MINUTE) return;
    if (session.knocks.size >= 200) for (const [key, at] of session.knocks) if (now - at >= KNOCK_REPEAT_MS) session.knocks.delete(key);
    session.knocks.set(lower, now);
    this.sendHost(session.conn, { type: 'knock', name });
  }

  /**
   * Verbindung vom Relay übernehmen: Der Gastgeber bekommt `stream` und hat streamTimeoutMs Zeit, den Datenstrom zu
   * öffnen. `buffered` sind alle Bytes, die bisher vom Spieler kamen; sie gehen zuerst über den Datenstrom.
   */
  openStream(session: HostSession, socket: Socket, buffered: Buffer, kind: StreamKind, name: string | null): void {
    socket.pause();
    const stream: Stream = {
      id: randomBytes(16).toString('hex'),
      session,
      kind,
      name,
      socket,
      pending: buffered,
      ws: null,
      claimed: false,
      closed: false,
      lastActivity: Date.now(),
      inFlight: 0,
      toHost: [],
      toPlayer: [],
      socketHold: new Set(),
      wsHold: new Set(),
    };
    this.streams.set(stream.id, stream);
    session.streams.add(stream);
    if (kind === 'login') session.logins++;
    socket.on('close', () => this.endStream(stream));
    stream.timer = setTimeout(() => {
      if (stream.ws !== null || stream.closed) return;
      // Beim Login darf der Dienst noch selbst trennen (Text für den Spieler), beim Status einfach schließen.
      if (kind === 'login' && !socket.destroyed) socket.end(loginDisconnect(TEXT_NO_ANSWER));
      this.endStream(stream);
    }, this.options.streamTimeoutMs);
    stream.timer.unref();
    this.sendHost(session.conn, { type: 'stream', id: stream.id, kind, name });
  }

  // ---------- Datenströme (/v1/worlds/streams/<id>) ----------

  /**
   * Vor dem WebSocket-Aufbau: Gibt es den Datenstrom, wartet er noch, und gehört er zu einer geöffneten Welt dieses
   * Spielers? Sonst 404. Jeder Datenstrom lässt sich nur einmal öffnen.
   */
  claimStream(id: string, uuid: string): Stream {
    const stream = this.streams.get(id);
    if (!stream || stream.claimed || stream.closed || stream.session.owner !== uuid || this.sessions.get(stream.session.world) !== stream.session) {
      throw new HttpError(404, STREAM_GONE);
    }
    stream.claimed = true;
    return stream;
  }

  /** Datenstrom offen: zuerst die gepufferten Bytes, danach beide Richtungen binär durchreichen. */
  attachStream(ws: WebSocket, stream: Stream): void {
    ws.on('error', () => {
      // Danach folgt immer 'close'.
    });
    ws.on('close', () => this.endStream(stream));
    if (stream.closed) {
      ws.close(1000, 'Verbindung beendet');
      return;
    }
    stream.ws = ws;
    if (stream.timer) clearTimeout(stream.timer);
    ws.on('message', (data, isBinary) => this.fromHost(stream, data, isBinary));
    const { socket } = stream;
    socket.on('data', (chunk: Buffer) => this.fromPlayer(stream, chunk));
    socket.on('end', () => this.endStream(stream));
    socket.on('drain', () => this.release(stream, 'ws', 'peer'));
    const first = stream.pending;
    stream.pending = null;
    if (first !== null && first.length > 0) this.fromPlayer(stream, first);
    if (stream.socketHold.size === 0) socket.resume();
    stream.lastActivity = Date.now();
    this.armIdle(stream, this.options.idleTimeoutMs);
  }

  /** Spieler → Gastgeber: anstellen und weitergeben, sobald die Datenrate der Welt es erlaubt. */
  private fromPlayer(stream: Stream, chunk: Buffer): void {
    if (stream.closed || stream.ws === null) return;
    stream.lastActivity = Date.now();
    this.charge(stream.session, chunk.length);
    stream.toHost.push(chunk);
    this.pump(stream, 'socket');
  }

  /** Gastgeber → Spieler: anstellen und weitergeben, sobald die Datenrate der Welt es erlaubt. Text wird ignoriert. */
  private fromHost(stream: Stream, data: RawData, isBinary: boolean): void {
    if (stream.closed || !isBinary) return;
    const chunk = toBuffer(data);
    stream.lastActivity = Date.now();
    this.charge(stream.session, chunk.length);
    stream.toPlayer.push(chunk);
    this.pump(stream, 'ws');
  }

  /** Datenrate je Welt (Token-Bucket über alle Datenströme und beide Richtungen, Vorrat höchstens eine Sekunde). */
  private refill(session: HostSession): void {
    const rate = this.options.bytesPerSecond;
    const now = Date.now();
    session.tokens = Math.min(rate, session.tokens + ((now - session.tokensAt) * rate) / 1000);
    session.tokensAt = now;
  }

  private charge(session: HostSession, bytes: number): void {
    this.refill(session);
    session.tokens -= bytes;
  }

  /**
   * Angestellte Bytes einer Richtung (`side` = Quelle) weitergeben. Ist die Datenrate überschritten, ruht das Lesen
   * dieser Quelle, bis der Vorrat wieder reicht; so hält auch der erste große Block die Rate ein.
   */
  private pump(stream: Stream, side: 'socket' | 'ws'): void {
    const key = side === 'socket' ? 'socketRateTimer' : 'wsRateTimer';
    if (stream.closed || stream[key]) return;
    this.refill(stream.session);
    const tokens = stream.session.tokens;
    if (tokens < 0) {
      this.hold(stream, side, 'rate');
      const timer = setTimeout(() => {
        stream[key] = undefined;
        this.pump(stream, side);
      }, Math.ceil((-tokens / this.options.bytesPerSecond) * 1000));
      timer.unref();
      stream[key] = timer;
      return;
    }
    if (side === 'socket') for (const chunk of stream.toHost.splice(0)) this.sendToHost(stream, chunk);
    else for (const chunk of stream.toPlayer.splice(0)) this.writeToPlayer(stream, chunk);
    this.release(stream, side, 'rate');
  }

  /** Ab STREAM_HIGH_WATER ungesendeten Bytes zum Gastgeber ruht das Lesen vom Spieler. */
  private sendToHost(stream: Stream, chunk: Buffer): void {
    const ws = stream.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    stream.inFlight += chunk.length;
    ws.send(chunk, { binary: true }, () => {
      stream.inFlight -= chunk.length;
      if (stream.inFlight <= STREAM_LOW_WATER) this.release(stream, 'socket', 'peer');
    });
    if (stream.inFlight > STREAM_HIGH_WATER) this.hold(stream, 'socket', 'peer');
  }

  /** Schreibt der Socket nicht hinterher, ruht das Lesen vom Gastgeber bis 'drain'. */
  private writeToPlayer(stream: Stream, chunk: Buffer): void {
    if (stream.socket.destroyed || stream.socket.writableEnded) return;
    if (!stream.socket.write(chunk)) this.hold(stream, 'ws', 'peer');
  }

  private hold(stream: Stream, side: 'socket' | 'ws', reason: Hold): void {
    if (side === 'socket') {
      stream.socketHold.add(reason);
      stream.socket.pause();
    } else {
      stream.wsHold.add(reason);
      stream.ws?.pause();
    }
  }

  private release(stream: Stream, side: 'socket' | 'ws', reason: Hold): void {
    if (stream.closed) return;
    if (side === 'socket') {
      if (stream.socketHold.delete(reason) && stream.socketHold.size === 0 && stream.ws !== null) stream.socket.resume();
    } else if (stream.wsHold.delete(reason) && stream.wsHold.size === 0) {
      stream.ws?.resume();
    }
  }

  /** Leerlauf: ohne Bytes in beide Richtungen für idleTimeoutMs schließen (Minecraft schickt Keepalives). */
  private armIdle(stream: Stream, delay: number): void {
    stream.timer = setTimeout(() => {
      const idle = Date.now() - stream.lastActivity;
      if (idle >= this.options.idleTimeoutMs) this.endStream(stream);
      else this.armIdle(stream, this.options.idleTimeoutMs - idle);
    }, delay);
    stream.timer.unref();
  }

  /** Datenstrom beenden (einmal): Spieler-Socket schließen (Ausstehendes wird noch geschrieben), WebSocket schließen. */
  private endStream(stream: Stream): void {
    if (stream.closed) return;
    stream.closed = true;
    if (stream.timer) clearTimeout(stream.timer);
    if (stream.socketRateTimer) clearTimeout(stream.socketRateTimer);
    if (stream.wsRateTimer) clearTimeout(stream.wsRateTimer);
    this.streams.delete(stream.id);
    if (stream.session.streams.delete(stream) && stream.kind === 'login') stream.session.logins--;
    const { socket, ws } = stream;
    // Was wegen der Datenrate noch wartet, geht beim Schließen noch hinaus (z. B. die letzte Meldung des Servers).
    for (const chunk of stream.toPlayer.splice(0)) this.writeToPlayer(stream, chunk);
    for (const chunk of stream.toHost.splice(0)) this.sendToHost(stream, chunk);
    if (!socket.destroyed) {
      if (!socket.writableEnded) socket.end();
      setTimeout(() => socket.destroy(), 2000).unref();
    }
    if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, 'Verbindung beendet');
      setTimeout(() => ws.terminate(), 2000).unref();
    }
  }

  // ---------- Aufräumen ----------

  /** Alte Einträge fürs Anklopfen und Ablehnen vergessen. */
  sweep(now = Date.now()): void {
    for (const session of this.sessions.values()) {
      for (const [key, at] of session.knocks) if (now - at >= KNOCK_REPEAT_MS) session.knocks.delete(key);
      for (const [key, until] of session.denied) if (until <= now) session.denied.delete(key);
    }
  }

  /** Alle Verbindungen sofort trennen (beim Herunterfahren); last_online der offenen Welten noch speichern. */
  closeAll(): void {
    this.closing = true;
    const now = Date.now();
    for (const session of this.sessions.values()) {
      try {
        this.store.setWorldOnline(session.world, now, null);
      } catch {
        // Datenbank schon zu: nicht schlimm
      }
    }
    for (const stream of [...this.streams.values()]) {
      stream.closed = true;
      if (stream.timer) clearTimeout(stream.timer);
      if (stream.socketRateTimer) clearTimeout(stream.socketRateTimer);
      if (stream.wsRateTimer) clearTimeout(stream.wsRateTimer);
      stream.socket.destroy();
      stream.ws?.terminate();
    }
    for (const conn of this.hosts.values()) {
      this.clearHostTimers(conn);
      conn.ws.terminate();
    }
    this.streams.clear();
    this.sessions.clear();
    this.hosts.clear();
  }
}
