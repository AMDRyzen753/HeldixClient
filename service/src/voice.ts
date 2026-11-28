// Voice Chat: verteilt Sprache an HeldixClient-Spieler in der Nähe (gleicher Server, gleiche Dimension)
// und an die eigene Gruppe (gleicher Server, jede Dimension, jede Entfernung). Ab 1.11.0 auch an Teilnehmer im Browser:
// Gäste mit einer Einladung und angemeldete Spieler auf der Webseite, beide nur in der Gruppe der Einladung.
// Der Dienst speichert und protokolliert dabei nichts: keine Sprache, keine Positionen, keine Räume, keine Gruppen, keinen
// Status, keine Namen von Gästen. Ab 1.13.0 (Funktion „moderation“): Voice-Regeln mit Pflicht-Zustimmung (4012),
// Voice-Sperren (4013), Liste „Voice aus“ für Server, und Gastgeber/Operatoren einer Heldix-Welt bzw. der Leiter einer
// Party schalten andere für alle stumm oder entfernen sie für 10 Minuten (nur im Arbeitsspeicher).
import { WebSocket, type RawData } from 'ws';
import type { Store } from './db';
import { isInviteCode, normalizeServer } from './validate';
import { VOICE_KICK_MS, VOICE_SERVER_OFF, type ServiceVoiceContext, type VoiceGate } from './voice-moderation';

/** Heldix-Welt zu einer Server-Adresse und die Rolle eines Spielers darin. */
export interface VoiceWorld {
  id: string;
  code: string;
  name: string;
  role: 'host' | 'operator' | 'player';
}

/** Party eines Spielers; `inGroup`: Die gemeldete Gruppe ist die Voice-Gruppe dieser Party. */
export interface VoiceParty {
  id: string;
  leader: string;
  members: ReadonlySet<string>;
  inGroup: boolean;
}

/** Ab 1.13.0: Anbindung an die Voice-Moderation (voice-moderation.ts) und an Welten und Parties (app.ts). */
export interface VoiceModerationHooks {
  /** Darf die Verbindung rein? Sperre bzw. fehlende Zustimmung zu den Regeln, sonst null. */
  gate(uuid: string, guest: VoiceGuest | null): VoiceGate | null;
  /** Veröffentlichte Version der Voice-Regeln (null = keine) */
  rulesVersion(): number | null;
  /** Grenzen für Clips, wenn Aufnahmen beim Melden aktiv sind, sonst null */
  clips(): { maxMs: number; maxBytes: number } | null;
  /** Server steht auf der Liste „Voice aus“ */
  serverOff(server: string): boolean;
  /** Heldix-Welt zur Adresse mit der Rolle des Spielers, sonst null */
  world(server: string, uuid: string): VoiceWorld | null;
  /** Party des Spielers (`group`: gemeldeter Prüfwert der Gruppe oder null), sonst null */
  party(group: string | null, uuid: string): VoiceParty | null;
  /** Name eines Spielers (für Hinweise an Betroffene) */
  name(uuid: string): string;
}

export interface VoiceOptions {
  /** Reichweite in Blöcken (8–128). */
  range: number;
  /** Ohne Nachricht so lange wird die Verbindung geschlossen (Standard 60 s). */
  idleTimeoutMs: number;
  /** Uhr für Positionen und Begrenzungen (nur Tests stellen sie). */
  now: () => number;
  log: (line: string) => void;
  /** Gruppe einer offenen Einladung mit Voice (`<server> <prüfwert>`) oder null (unbekannt, abgelaufen, widerrufen). */
  inviteGroup?: (code: string) => string | null;
  /** Ein Gast wurde aus der Gruppe entfernt (`kick`): Seine Sitzung gilt danach nicht mehr. */
  onGuestRemoved?: (id: string) => void;
  /** Server-Adressen prüfen (Standard: nur öffentliche Domains; app.ts lässt auch Adressen geteilter Welten zu). */
  normalizeServer?: (value: unknown) => string | null;
  /** Ab 1.13.0: Moderation; ohne: wie 1.12.0 (keine Regeln, keine Sperren, kein „moderation“). */
  moderation?: VoiceModerationHooks;
}

/** Gast im Browser: Name und Einladung aus der Gast-Sitzung (nur im Arbeitsspeicher). */
export interface VoiceGuest {
  name: string;
  /** Code der Einladung, mit der die Sitzung angelegt wurde */
  invite: string;
  /** Ablauf der Sitzung (ms, Uhr des Rechners) */
  expiresAt: number;
  /** Bei der Gast-Sitzung angenommene Version der Voice-Regeln (ab 1.13.0) */
  rulesVersion?: number | null;
}

/** Stummschalten bzw. Entfernen in einem Bereich (`world:<id>` oder `party:<id>`), nur im Arbeitsspeicher. */
interface ScopeEntry {
  by: { uuid: string; name: string };
  muted: boolean;
  kickedUntil: number | null;
  /** Zuletzt im Bereich verbunden gesehen (aufgeräumt 10 Minuten danach) */
  seenAt: number;
}

type RoomVoice = 'on' | 'off' | 'kicked';

/** Wie eine Verbindung angemeldet ist (Spiel mit Bearer-Token: nichts davon). */
export interface VoiceAttachOptions {
  /** über die Webseite (Gast oder angemeldeter Spieler mit Cookie) */
  browser?: boolean;
  guest?: VoiceGuest;
}

type Mode = 'all' | 'friends';

interface Position {
  x: number;
  y: number;
  z: number;
  at: number;
}

interface Connection {
  ws: WebSocket;
  /** UUID des Spielers oder ID des Gasts (32 Hex-Zeichen) */
  uuid: string;
  /** UUID bzw. Gast-ID als 16 Byte für die weitergeleiteten Rahmen */
  id: Buffer;
  room: string | null;
  /** Gruppe: Server und Prüfwert aus Gruppenname und Passwort; im Spiel zusammen mit einem Raum, im Browser ohne. */
  group: string | null;
  /** Einladung, über die die Verbindung in ihrer Gruppe ist (`join` mit `invite`), sonst null */
  invite: string | null;
  /** über die Webseite verbunden (Gast oder angemeldeter Spieler) */
  browser: boolean;
  /** Gast ohne Konto, sonst null */
  guest: VoiceGuest | null;
  mode: Mode;
  pos: Position | null;
  /** Eigener Status; bleibt an der Verbindung, auch über Raum- und Gruppenwechsel und `leave` hinweg. */
  muted: boolean;
  deafened: boolean;
  idleTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  /** Ablauf der Gast-Sitzung (4005) */
  expireTimer?: NodeJS.Timeout;
  textWindow: number;
  texts: number;
  frameWindow: number;
  frames: number;
  stateWindow: number;
  states: number;
  /** Server des letzten `join` (Spiel) bzw. der Einladung (Browser), sonst null */
  server: string | null;
  /** Letztes `join` aus dem Spiel (für `unkick`, „Voice aus“ und neue Rechte) */
  lastJoin: { server: string; dimension: string; group: string | null } | null;
  /** Heldix-Welt des Servers mit eigener Rolle bzw. Party (bei `join` und `ping` neu bestimmt) */
  world: VoiceWorld | null;
  party: VoiceParty | null;
  /** Zustand des Raums für `room` und die zuletzt geschickte `room`-Nachricht (als Text) */
  roomVoice: RoomVoice;
  roomMessage: string | null;
  roomUntil: number | null;
  roomSent: string | null;
  /** Bereiche, für die diese Verbindung `moderated: muted` schon bekommen hat */
  mutedNotified: Set<string>;
  /** Angenommene Version der Voice-Regeln beim Verbinden (null = keine nötig bzw. keine) */
  rulesVersion: number | null;
}

export const VOICE_PROTOCOL = 1;
/** Höchstgröße der Opus-Nutzdaten eines Rahmens. */
export const VOICE_MAX_FRAME = 1024;
/**
 * Was der Dienst über die Grundfunktionen hinaus kann (steht in `ready`); das Rahmen-Format bleibt Version 1.
 * `guests` (ab 1.11.0): Teilnehmer im Browser, Einladungen mit Gruppe, `join` mit `invite` und `kick`.
 */
export const VOICE_FEATURES: readonly string[] = ['state', 'groups', 'guests'];
/** `moderation` (ab 1.13.0): Regeln, Sperren, „Voice aus“, Stummschalten und Entfernen durch Gastgeber und Leiter. */
export const VOICE_FEATURES_MODERATION: readonly string[] = [...VOICE_FEATURES, 'moderation'];
/** Höchstens so viele Mitglieder hat eine Gruppe (Gäste zählen mit). */
export const VOICE_MAX_GROUP = 16;
/** Höchstens so viele Gäste gleichzeitig je Einladung. */
export const VOICE_MAX_GUESTS = 4;
/** Unterprotokoll für Verbindungen aus dem Browser (Gäste schicken dazu `gast.<token>`). */
export const VOICE_SUBPROTOCOL = 'heldix-voice';
/** Kopf eines Rahmens vom Client: Version, Flags, Folgenummer (2 Byte). */
const HEADER = 4;
/** Kopf eines weitergeleiteten Rahmens: dazu die UUID des Sprechers (16 Byte). */
const OUT_HEADER = HEADER + 16;
/** Größte WebSocket-Nachricht auf /v1/voice; größere trennt ws mit 1009. */
export const VOICE_MAX_PAYLOAD = 4 * 1024;
export const VOICE_RANGE_MIN = 8;
export const VOICE_RANGE_MAX = 128;
export const VOICE_RANGE_DEFAULT = 48;

/** Positionen, die älter sind, zählen nicht. */
const POSITION_MAX_AGE_MS = 15_000;
const MAX_COORDINATE = 30_000_000;
const WINDOW_MS = 1000;
/** Höchstens so viele Sprach-Rahmen bzw. Textnachrichten pro Verbindung und Sekunde; der Rest wird verworfen. */
const FRAME_LIMIT = 60;
const TEXT_LIMIT = 20;
/** Höchstens so viele angenommene Status-Änderungen pro Verbindung und Sekunde; weitere werden ignoriert. */
const STATE_LIMIT = 4;
/** So viele andere Spieler stehen höchstens in `peers`. */
const MAX_PEERS = 100;
/** Kommt ein Hörer mit dem Lesen nicht hinterher, bekommt er ab dieser Puffergröße keine Sprache mehr. */
const MAX_BUFFERED_FRAMES = 256 * 1024;
/** Kommen auch kleine Textnachrichten nicht mehr an, wird die Verbindung ab dieser Puffergröße getrennt. */
const MAX_BUFFERED = 1024 * 1024;
const DIMENSION_RE = /^[a-z0-9_.-]{1,32}:[a-z0-9_./-]{1,64}$/;
/** Gruppe: SHA-256 (hex) aus Gruppenname und Passwort, vom Client berechnet. Name und Passwort sieht der Dienst nie. */
const GROUP_RE = /^[0-9a-f]{64}$/;
/** UUID eines Spielers oder ID eines Gasts (für `kick`). */
const ID_RE = /^[0-9a-f]{32}$/;

/** Schließcodes für Teilnehmer im Browser (ab 1.11.0). */
export const CLOSE_KICKED = 4004;
export const CLOSE_EXPIRED = 4005;
export const CLOSE_INVITE = 4006;
export const CLOSE_FULL = 4007;
/** Schließcodes ab 1.13.0: Voice-Regeln nicht angenommen, Voice-Sperre. */
export const CLOSE_RULES = 4012;
export const CLOSE_VOICE_BANNED = 4013;
/** Moderation: erlaubte Aktionen und Bereiche */
const MOD_ACTIONS = ['mute', 'unmute', 'kick', 'unkick'] as const;
type ModAction = (typeof MOD_ACTIONS)[number];
/** Stummschaltungen ohne Verbindung im Bereich so lange behalten (Wiederverbinden hebt sie nicht auf). */
const SCOPE_IDLE_MS = 10 * 60_000;

function isMode(value: unknown): value is Mode {
  return value === 'all' || value === 'friends';
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/** Verbindung in einen Raum oder eine Gruppe aufnehmen (wird bei Bedarf angelegt); liefert alle Mitglieder. */
function enter(sets: Map<string, Set<Connection>>, key: string, conn: Connection): Set<Connection> {
  let members = sets.get(key);
  if (!members) {
    members = new Set();
    sets.set(key, members);
  }
  members.add(conn);
  return members;
}

/** Verbindung aus einem Raum oder einer Gruppe nehmen; leere werden gelöscht, die übrigen Mitglieder kommen nach `notify`. */
function exit(sets: Map<string, Set<Connection>>, key: string, conn: Connection, notify: Set<Connection>): void {
  const members = sets.get(key);
  if (!members) return;
  members.delete(conn);
  if (members.size === 0) sets.delete(key);
  else for (const other of members) notify.add(other);
}

export class Voice {
  /** Höchstens eine Verbindung pro Spieler bzw. Gast. */
  private readonly connections = new Map<string, Connection>();
  /** Raum (Server und Dimension) → Verbindungen darin; leere Räume werden gelöscht. */
  private readonly rooms = new Map<string, Set<Connection>>();
  /** Gruppe (Server und Prüfwert) → Verbindungen darin, höchstens 16; leere Gruppen werden gelöscht. */
  private readonly groups = new Map<string, Set<Connection>>();
  /** Bereich (`world:<id>`, `party:<id>`) → Ziel → Stummschaltung bzw. Entfernen (nur im Arbeitsspeicher) */
  private readonly scopes = new Map<string, Map<string, ScopeEntry>>();
  private readonly rangeSquared: number;
  private readonly normalize: (value: unknown) => string | null;
  private closing = false;

  constructor(
    private readonly store: Store,
    private readonly options: VoiceOptions,
  ) {
    this.rangeSquared = options.range * options.range;
    this.normalize = options.normalizeServer ?? normalizeServer;
  }

  /** Offene Voice-Verbindungen (für /v1/status; Gäste und Browser zählen mit). */
  connectedCount(): number {
    return this.connections.size;
  }

  /** Hat dieser Spieler bzw. Gast gerade eine Voice-Verbindung? */
  isConnected(uuid: string): boolean {
    return this.connections.has(uuid);
  }

  /** Verbundene Gäste einer Einladung (höchstens VOICE_MAX_GUESTS). */
  guestCount(invite: string, except?: string): number {
    let count = 0;
    for (const conn of this.connections.values()) if (conn.guest?.invite === invite && conn.uuid !== except) count++;
    return count;
  }

  /** Für die öffentliche Ansicht einer Einladung: wie viele Nicht-Gäste in der Gruppe sind, dazu die Gäste der Einladung. */
  inviteInfo(invite: string, group: string): { members: number; guests: number } {
    let members = 0;
    for (const conn of this.groups.get(group) ?? []) if (conn.guest === null) members++;
    return { members, guests: this.guestCount(invite) };
  }

  /**
   * Neue, bereits angemeldete Verbindung übernehmen. Eine ältere desselben Spielers bzw. Gasts wird geschlossen (4002).
   * Hat die Einladung eines Gasts schon VOICE_MAX_GUESTS verbundene Gäste, wird die neue sofort geschlossen (4007).
   */
  attach(ws: WebSocket, uuid: string, extra: VoiceAttachOptions = {}): void {
    const now = this.options.now();
    const guest = extra.guest ?? null;
    const conn: Connection = {
      ws,
      uuid,
      id: Buffer.from(uuid, 'hex'),
      room: null,
      group: null,
      invite: null,
      browser: extra.browser === true || guest !== null,
      guest,
      mode: 'all',
      pos: null,
      muted: false,
      deafened: false,
      textWindow: now,
      texts: 0,
      frameWindow: now,
      frames: 0,
      stateWindow: now,
      states: 0,
      server: null,
      lastJoin: null,
      world: null,
      party: null,
      roomVoice: 'on',
      roomMessage: null,
      roomUntil: null,
      roomSent: null,
      mutedNotified: new Set(),
      rulesVersion: null,
    };
    // Zuerst die Ereignisse anmelden: Geht danach etwas schief, räumt 'close' auf.
    ws.on('message', (data, isBinary) => this.onMessage(conn, data, isBinary));
    ws.on('ping', () => this.resetIdle(conn));
    ws.on('pong', () => this.resetIdle(conn));
    ws.on('error', () => {
      // Danach folgt immer 'close'.
    });
    ws.on('close', () => this.onClose(conn));

    if (guest !== null && this.guestCount(guest.invite, uuid) >= VOICE_MAX_GUESTS) {
      this.closeSocket(conn, CLOSE_FULL, 'Voll');
      return;
    }
    // Ab 1.13.0: gesperrt (4013) oder Voice-Regeln nicht angenommen (4012) – Bescheid geben und schließen.
    const hooks = this.options.moderation;
    const gate = hooks?.gate(uuid, guest) ?? null;
    if (gate !== null) {
      this.refuse(conn, gate);
      return;
    }
    conn.rulesVersion = hooks?.rulesVersion() ?? null;
    const old = this.connections.get(uuid);
    if (old) this.drop(old, 4002, 'Neue Verbindung');
    this.connections.set(uuid, conn);
    this.resetIdle(conn);
    if (guest !== null) {
      const left = guest.expiresAt - Date.now();
      if (left <= 0) {
        this.drop(conn, CLOSE_EXPIRED, 'Sitzung abgelaufen');
        return;
      }
      conn.expireTimer = setTimeout(() => {
        if (this.connections.get(conn.uuid) === conn) this.drop(conn, CLOSE_EXPIRED, 'Sitzung abgelaufen');
      }, left);
      conn.expireTimer.unref();
    }
    this.sendTo(conn, {
      type: 'ready',
      range: this.options.range,
      maxFrame: VOICE_MAX_FRAME,
      protocol: VOICE_PROTOCOL,
      features: hooks ? VOICE_FEATURES_MODERATION : VOICE_FEATURES,
      maxGroup: VOICE_MAX_GROUP,
      // ab 1.13.0: veröffentlichte Voice-Regeln (angenommen, sonst wäre 4012 gekommen) und ob Clips aktiv sind
      ...(hooks ? { rules: conn.rulesVersion === null ? null : { version: conn.rulesVersion }, clips: hooks.clips() } : {}),
    });
  }

  /** Verbindung abweisen: `rules` + 4012 bzw. `banned` + 4013 (Gäste mit alter Zustimmung verlieren ihre Sitzung). */
  private refuse(conn: Connection, gate: VoiceGate): void {
    if (gate.kind === 'rules') {
      this.sendTo(conn, { type: 'rules', status: 'required', version: gate.version });
      if (conn.guest !== null) this.options.onGuestRemoved?.(conn.uuid);
      if (this.connections.get(conn.uuid) === conn) this.drop(conn, CLOSE_RULES, 'Voice-Regeln');
      else this.closeSocket(conn, CLOSE_RULES, 'Voice-Regeln');
      return;
    }
    this.sendTo(conn, { type: 'banned', until: gate.until, reason: gate.reason, message: gate.message, appeal: gate.appeal });
    if (this.connections.get(conn.uuid) === conn) this.drop(conn, CLOSE_VOICE_BANNED, 'Voice-Sperre');
    else this.closeSocket(conn, CLOSE_VOICE_BANNED, 'Voice-Sperre');
  }

  // ---------- Ab 1.13.0: Änderungen aus dem Team-Bereich und vom Spieler ----------

  /** Voice-Sperre: laufende Verbindung bekommt `banned` und wird mit 4013 geschlossen. */
  banUser(uuid: string, gate: Extract<VoiceGate, { kind: 'banned' }>): void {
    const conn = this.connections.get(uuid);
    if (conn && conn.guest === null) this.refuse(conn, gate);
  }

  /** Neue Version der Voice-Regeln: Wer ihr nicht zugestimmt hat (also alle), bekommt `rules` und 4012. */
  rulesPublished(version: number): void {
    for (const conn of [...this.connections.values()]) if (conn.rulesVersion !== version) this.refuse(conn, { kind: 'rules', version });
  }

  /** Zustimmung widerrufen: Verbindung mit `rules` und 4012 schließen. */
  consentWithdrawn(uuid: string, version: number): void {
    const conn = this.connections.get(uuid);
    if (conn && conn.guest === null) this.refuse(conn, { kind: 'rules', version });
  }

  /** Clips an oder aus (Schalter, Regeln zurückgezogen): alle bekommen `clips`. */
  clipsChanged(): void {
    const clips = this.options.moderation?.clips() ?? null;
    for (const conn of this.connections.values()) this.sendTo(conn, { type: 'clips', clips });
  }

  /** Liste „Voice aus“ geändert: Räume und Gruppen auf betroffenen Servern verlassen bzw. wieder betreten. */
  serversChanged(): void {
    for (const conn of [...this.connections.values()]) {
      if (conn.lastJoin !== null && !conn.browser) {
        this.joinGame(conn, conn.lastJoin.server, conn.lastJoin.dimension, conn.lastJoin.group);
      } else if (conn.browser && conn.server !== null && this.options.moderation?.serverOff(conn.server) && conn.group !== null) {
        this.join(conn, null, null);
        this.sendTo(conn, { type: 'room', server: conn.server, voice: 'off', message: VOICE_SERVER_OFF, until: null, world: null, party: null });
      }
    }
  }

  /** Ist diese ID gerade ein verbundener Gast? (Melden: Gäste lassen sich nicht melden.) */
  isGuest(id: string): boolean {
    const conn = this.connections.get(id);
    return conn !== undefined && conn.guest !== null;
  }

  /**
   * Kontext einer Meldung aus Sicht des Dienstes: Raum (Server, Dimension), Gruppe ja/nein, Welt, wer in Hörweite
   * (frische Position in Reichweite) bzw. in der Gruppe ist, und ob der Gemeldete dabei ist. Nicht verbunden: null.
   */
  contextFor(uuid: string, reported: string): ServiceVoiceContext | null {
    const conn = this.connections.get(uuid);
    if (!conn) return null;
    const now = this.options.now();
    const nearby = new Map<string, { uuid: string; name: string; guest: boolean }>();
    const add = (other: Connection) => {
      if (other === conn || nearby.size >= 30) return;
      nearby.set(other.uuid, {
        uuid: other.uuid,
        name: other.guest !== null ? other.guest.name : (this.options.moderation?.name(other.uuid) ?? ''),
        guest: other.guest !== null,
      });
    };
    const from = this.freshPosition(conn, now);
    if (from && conn.room !== null) {
      for (const other of this.rooms.get(conn.room) ?? []) {
        const to = this.freshPosition(other, now);
        if (!to) continue;
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const dz = from.z - to.z;
        if (dx * dx + dy * dy + dz * dz <= this.rangeSquared) add(other);
      }
    }
    for (const other of conn.group === null ? [] : (this.groups.get(conn.group) ?? [])) add(other);
    const reportedConn = this.connections.get(reported);
    const present =
      reportedConn !== undefined &&
      ((conn.room !== null && reportedConn.room === conn.room) || (conn.group !== null && reportedConn.group === conn.group));
    return {
      server: conn.server,
      dimension: conn.room === null ? null : (conn.room.split(' ')[1] ?? null),
      group: conn.group !== null,
      world: conn.world ? { code: conn.world.code, name: conn.world.name } : null,
      nearby: [...nearby.values()],
      reportedPresent: present,
    };
  }

  /** Abgelaufenes Entfernen und verwaiste Stummschaltungen aufräumen (regelmäßig aus app.ts). */
  sweep(now = this.options.now()): void {
    for (const [key, entries] of this.scopes) {
      for (const [target, entry] of entries) {
        if (entry.kickedUntil !== null && entry.kickedUntil <= now) entry.kickedUntil = null;
        const conn = this.connections.get(target);
        const inScope = conn !== undefined && (this.worldScope(conn) === key || this.partyScope(conn) === key);
        if (inScope) entry.seenAt = now;
        if ((!entry.muted && entry.kickedUntil === null) || (!inScope && now - entry.seenAt > SCOPE_IDLE_MS && entry.kickedUntil === null)) {
          entries.delete(target);
        }
      }
      if (entries.size === 0) this.scopes.delete(key);
    }
  }

  /** Schließt die Voice-Verbindung eines Spielers (Konto gelöscht, gesperrt). */
  disconnectUser(uuid: string, code: number, reason: string): void {
    const conn = this.connections.get(uuid);
    if (conn) this.drop(conn, code, reason);
  }

  /**
   * Einladung widerrufen, gelöscht oder ungültig: Gäste dieser Einladung werden getrennt (4004 „Aus der Gruppe entfernt“),
   * angemeldete Teilnehmer, die über sie in der Gruppe sind, bekommen `invite: invalid` und werden getrennt (4006).
   */
  disconnectInvite(invite: string): void {
    for (const conn of [...this.connections.values()]) {
      if (conn.guest?.invite === invite) {
        this.drop(conn, CLOSE_KICKED, 'Aus der Gruppe entfernt');
      } else if (conn.invite === invite) {
        this.inviteInvalid(conn);
      }
    }
  }

  /** Alle Verbindungen sofort trennen (beim Herunterfahren). */
  closeAll(): void {
    this.closing = true;
    for (const conn of this.connections.values()) {
      this.clearTimers(conn);
      conn.ws.terminate();
    }
    this.connections.clear();
    this.rooms.clear();
    this.groups.clear();
  }

  /** Abmelden, aus Raum und Gruppe nehmen und schließen; antwortet die Gegenseite nicht, wird hart getrennt. */
  private drop(conn: Connection, code: number, reason: string): void {
    if (this.connections.get(conn.uuid) === conn) this.connections.delete(conn.uuid);
    this.leave(conn);
    this.closeSocket(conn, code, reason);
  }

  private closeSocket(conn: Connection, code: number, reason: string): void {
    this.clearTimers(conn);
    conn.ws.close(code, reason);
    conn.killTimer = setTimeout(() => conn.ws.terminate(), Math.min(2000, this.options.idleTimeoutMs));
    conn.killTimer.unref();
  }

  /** Einladung (nicht mehr) gültig: Bescheid geben und trennen (4006). */
  private inviteInvalid(conn: Connection): void {
    this.sendTo(conn, { type: 'invite', status: 'invalid' });
    this.drop(conn, CLOSE_INVITE, 'Einladung ungültig');
  }

  private onMessage(conn: Connection, data: RawData, isBinary: boolean): void {
    // Schon abgemeldete Verbindung (ersetzt, Konto gelöscht): nichts mehr annehmen.
    if (this.connections.get(conn.uuid) !== conn) return;
    this.resetIdle(conn);
    try {
      if (isBinary) this.onFrame(conn, toBuffer(data));
      else this.onText(conn, data);
    } catch (err) {
      // Nur der Fehler, nie Inhalte (keine Sprache, keine Positionen, keine Räume, keine Gruppen, keine Namen).
      this.options.log(`Fehler im Voice Chat: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  private onText(conn: Connection, data: RawData): void {
    const now = this.options.now();
    if (now - conn.textWindow >= WINDOW_MS) {
      conn.textWindow = now;
      conn.texts = 0;
    }
    if (++conn.texts > TEXT_LIMIT) return;

    let message: unknown;
    try {
      message = JSON.parse(toBuffer(data).toString('utf8'));
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return;
    const input = message as Record<string, unknown>;

    switch (input.type) {
      case 'ping':
        // Konto inzwischen gesperrt oder gelöscht (z. B. über heldix-dienst-admin): beim nächsten Lebenszeichen trennen.
        if (conn.guest === null && !this.store.getUser(conn.uuid)) {
          const banned = this.store.getBan(conn.uuid) !== undefined;
          this.drop(conn, banned ? 4003 : 4001, banned ? 'Gesperrt' : 'Konto gelöscht');
          return;
        }
        // Über eine Einladung in der Gruppe: Gilt sie noch (abgelaufen, gelöscht)?
        if (conn.invite !== null && this.options.inviteGroup?.(conn.invite) == null) {
          this.inviteInvalid(conn);
          return;
        }
        this.sendTo(conn, { type: 'pong' });
        // Ab 1.13.0: Rechte in Welt und Party neu bestimmen (Operator geworden, Party-Leitung übergeben).
        this.refreshRights(conn);
        return;
      case 'mod':
        this.moderate(conn, input);
        return;
      case 'join': {
        if (Object.hasOwn(input, 'invite')) {
          this.joinInvite(conn, input.invite);
          return;
        }
        // Im Browser gibt es keine Räume (keine Welt, keine Position): nur `join` mit `invite`.
        if (conn.browser) return;
        const server = this.normalize(input.server);
        const { dimension } = input;
        if (server === null || typeof dimension !== 'string' || !DIMENSION_RE.test(dimension)) return;
        let mode: Mode = 'all';
        if (input.mode !== undefined && input.mode !== null) {
          if (!isMode(input.mode)) return;
          mode = input.mode;
        }
        // Gruppen gelten je Server, die Dimension ist egal. Ungültig: die ganze Nachricht ignorieren.
        let group: string | null = null;
        if (input.group !== undefined && input.group !== null) {
          if (typeof input.group !== 'string' || !GROUP_RE.test(input.group)) return;
          group = input.group;
        }
        conn.mode = mode;
        conn.invite = null;
        if (!this.options.moderation) {
          this.join(conn, `${server} ${dimension}`, group === null ? null : `${server} ${group}`);
          return;
        }
        conn.lastJoin = { server, dimension, group };
        this.joinGame(conn, server, dimension, group);
        return;
      }
      case 'pos': {
        if (conn.browser) return;
        const { x, y, z } = input;
        if (!isCoordinate(x) || !isCoordinate(y) || !isCoordinate(z)) return;
        conn.pos = { x, y, z, at: now };
        return;
      }
      case 'mode':
        if (isMode(input.mode)) conn.mode = input.mode;
        return;
      case 'state':
        this.setState(conn, input.muted, input.deafened, now);
        return;
      case 'kick':
        this.kick(conn, input.uuid);
        return;
      case 'leave':
        // Welt verlassen: Stummschaltung dort endet (Entfernen läuft weiter).
        if (conn.world !== null) this.endMute(`world:${conn.world.id}`, conn.uuid);
        conn.lastJoin = null;
        conn.world = null;
        conn.party = null;
        if (conn.room === null && conn.group === null) return;
        conn.invite = null;
        this.leave(conn);
        this.sendPeersTo(conn);
        return;
    }
    // Unbekannte Nachrichten werden ignoriert.
  }

  // ---------- Ab 1.13.0: Räume mit Moderation ----------

  private worldScope(conn: Connection): string | null {
    return conn.world === null ? null : `world:${conn.world.id}`;
  }

  private partyScope(conn: Connection): string | null {
    return conn.group !== null && conn.party !== null && conn.party.inGroup ? `party:${conn.party.id}` : null;
  }

  /** Eintrag eines Ziels im Bereich (abgelaufenes Entfernen fällt weg, leere Einträge auch), sonst undefined. */
  private scopeEntry(key: string | null, target: string, now = this.options.now()): ScopeEntry | undefined {
    if (key === null) return undefined;
    const entries = this.scopes.get(key);
    const entry = entries?.get(target);
    if (!entries || !entry) return undefined;
    if (entry.kickedUntil !== null && entry.kickedUntil <= now) entry.kickedUntil = null;
    if (!entry.muted && entry.kickedUntil === null) {
      entries.delete(target);
      if (entries.size === 0) this.scopes.delete(key);
      return undefined;
    }
    return entry;
  }

  private silenced(key: string | null, target: string): boolean {
    return this.scopeEntry(key, target)?.muted === true;
  }

  /** Stummschaltung in einem Bereich beenden (Welt bzw. Party verlassen); Entfernen bleibt bis zum Ablauf. */
  private endMute(key: string, target: string): void {
    const entry = this.scopes.get(key)?.get(target);
    if (!entry || !entry.muted) return;
    entry.muted = false;
    this.scopeEntry(key, target);
    for (const conn of this.connections.values()) if (conn.uuid === target) conn.mutedNotified.delete(key);
  }

  /**
   * `join` aus dem Spiel mit Moderation: „Voice aus“ (kein Raum, keine Gruppe), Welt und Party bestimmen, Entfernte
   * bleiben draußen (Welt: ohne Raum, Party: ohne Gruppe), danach `room` und – für Stummgeschaltete – `moderated`.
   */
  private joinGame(conn: Connection, server: string, dimension: string, groupHex: string | null): void {
    const hooks = this.options.moderation!;
    const now = this.options.now();
    const previousWorld = conn.world;
    const party = hooks.party(groupHex, conn.uuid);
    // Party verlassen: Stummschaltungen in früheren Parties enden.
    for (const key of this.scopes.keys()) {
      if (key.startsWith('party:') && key !== (party ? `party:${party.id}` : '')) this.endMute(key, conn.uuid);
    }
    if (hooks.serverOff(server)) {
      if (previousWorld !== null) this.endMute(`world:${previousWorld.id}`, conn.uuid);
      conn.server = server;
      conn.world = null;
      conn.party = null;
      this.join(conn, null, null);
      this.setRoom(conn, 'off', VOICE_SERVER_OFF, null, true);
      return;
    }
    const world = hooks.world(server, conn.uuid);
    if (previousWorld !== null && previousWorld.id !== world?.id) this.endMute(`world:${previousWorld.id}`, conn.uuid);
    conn.server = server;
    conn.world = world;
    conn.party = party;
    let room: string | null = `${server} ${dimension}`;
    let voice: RoomVoice = 'on';
    let message: string | null = null;
    let until: number | null = null;
    const worldKick = this.scopeEntry(this.worldScope(conn), conn.uuid, now)?.kickedUntil ?? null;
    if (worldKick !== null) {
      room = null;
      voice = 'kicked';
      until = worldKick;
      message = 'Du bist gerade aus dem Voice dieser Welt entfernt.';
    }
    let group: string | null = groupHex === null ? null : `${server} ${groupHex}`;
    let partyKick: number | null = null;
    if (group !== null && party !== null && party.inGroup) {
      partyKick = this.scopeEntry(`party:${party.id}`, conn.uuid, now)?.kickedUntil ?? null;
      if (partyKick !== null) group = null;
    }
    this.join(conn, room, group);
    if (partyKick !== null) {
      this.sendTo(conn, { type: 'group', status: 'kicked', until: partyKick, message: 'Du bist gerade aus dem Voice der Party entfernt.' });
    }
    this.setRoom(conn, voice, message, until, true);
    this.notifyMuted(conn, now);
  }

  /** Stand von `room` merken und schicken (ohne `force` nur bei einer Änderung). */
  private setRoom(conn: Connection, voice: RoomVoice, message: string | null, until: number | null, force: boolean): void {
    conn.roomVoice = voice;
    conn.roomMessage = message;
    conn.roomUntil = until;
    const info = {
      type: 'room',
      server: conn.server,
      voice,
      message,
      until,
      world: conn.world === null ? null : { code: conn.world.code, name: conn.world.name, role: conn.world.role },
      party: this.partyScope(conn) === null ? null : { leader: conn.party!.leader === conn.uuid },
    };
    const text = JSON.stringify(info);
    if (!force && text === conn.roomSent) return;
    conn.roomSent = text;
    this.sendTo(conn, info);
  }

  /** Bei `ping`: Rechte neu bestimmen; `room` nur, wenn sich etwas geändert hat. */
  private refreshRights(conn: Connection): void {
    const hooks = this.options.moderation;
    if (!hooks || conn.browser || conn.lastJoin === null || conn.server === null || conn.roomVoice === 'off') return;
    const now = this.options.now();
    conn.world = hooks.world(conn.server, conn.uuid);
    conn.party = hooks.party(conn.lastJoin.group, conn.uuid);
    // Entfernen abgelaufen: wieder in den Raum (der Client darf auch selbst `join` schicken).
    if (conn.roomVoice === 'kicked' && (conn.roomUntil ?? 0) <= now) {
      this.joinGame(conn, conn.lastJoin.server, conn.lastJoin.dimension, conn.lastJoin.group);
      return;
    }
    this.setRoom(conn, conn.roomVoice, conn.roomMessage, conn.roomUntil, false);
    this.notifyMuted(conn, now);
  }

  /** Ist die Verbindung in ihrem Bereich stumm geschaltet und weiß es noch nicht: `moderated` mit `muted`. */
  private notifyMuted(conn: Connection, now: number): void {
    for (const [key, scope] of [
      [this.worldScope(conn), 'world'],
      [this.partyScope(conn), 'party'],
    ] as const) {
      const entry = this.scopeEntry(key, conn.uuid, now);
      if (!key || !entry) continue;
      entry.seenAt = now;
      if (!entry.muted || conn.mutedNotified.has(key)) continue;
      conn.mutedNotified.add(key);
      this.sendTo(conn, this.moderatedMessage('mute', scope, entry.by, conn.world, null));
    }
  }

  /** Nachricht an das Ziel einer Moderation. */
  private moderatedMessage(action: ModAction, scope: 'world' | 'party', by: { uuid: string; name: string }, world: VoiceWorld | null, until: number | null) {
    const name = by.name === '' ? 'Jemand' : by.name;
    const where = scope === 'world' ? 'dieser Welt' : 'dieser Party';
    const message = {
      mute: `${name} hat dich in ${where} stummgeschaltet.`,
      unmute: `${name} hat deine Stummschaltung aufgehoben.`,
      kick: scope === 'world' ? `${name} hat dich aus dem Voice dieser Welt entfernt (10 Minuten).` : `${name} hat dich aus dem Voice der Party entfernt (10 Minuten).`,
      unkick: scope === 'world' ? 'Du darfst wieder in den Voice dieser Welt.' : 'Du darfst wieder in den Voice der Party.',
    }[action];
    const past = { mute: 'muted', unmute: 'unmuted', kick: 'kicked', unkick: 'unkicked' }[action];
    return {
      type: 'moderated',
      action: past,
      scope,
      by,
      world: scope === 'world' && world !== null ? { code: world.code, name: world.name } : null,
      until,
      message,
    };
  }

  /**
   * `mod` (ab 1.13.0): Gastgeber bzw. Operator einer Heldix-Welt (`scope: world`) oder Leiter der Party (`scope: party`)
   * schaltet einen Teilnehmer für alle stumm, entfernt ihn für 10 Minuten oder hebt das auf. Operatoren können weder
   * den Gastgeber noch andere Operatoren moderieren. Antwort `mod` mit `status`; das Ziel bekommt `moderated`.
   */
  private moderate(conn: Connection, input: Record<string, unknown>): void {
    const hooks = this.options.moderation;
    if (!hooks || conn.guest !== null || conn.browser) return;
    const { action, scope, uuid: target } = input;
    if (!(MOD_ACTIONS as readonly unknown[]).includes(action) || (scope !== 'world' && scope !== 'party') || typeof target !== 'string' || !ID_RE.test(target)) {
      return;
    }
    const act = action as ModAction;
    const reply = (status: 'ok' | 'denied' | 'invalid', message: string) => this.sendTo(conn, { type: 'mod', status, action: act, uuid: target, scope, message });
    if (target === conn.uuid) return reply('invalid', 'Dich selbst kannst du hier nicht moderieren.');
    const now = this.options.now();
    const other = this.connections.get(target);
    const targetName = other?.guest?.name ?? (hooks.name(target) || 'Der Spieler');
    let key: string;
    if (scope === 'world') {
      const world = conn.server === null || conn.lastJoin === null ? null : hooks.world(conn.server, conn.uuid);
      conn.world = world;
      if (world === null || world.role === 'player') return reply('denied', 'Das dürfen nur der Gastgeber und die Operatoren dieser Welt.');
      const targetRole = hooks.world(conn.server!, target)?.role ?? 'player';
      if (targetRole === 'host') return reply('denied', 'Den Gastgeber der Welt kannst du nicht moderieren.');
      if (world.role === 'operator' && targetRole === 'operator') return reply('denied', 'Andere Operatoren kann nur der Gastgeber moderieren.');
      key = `world:${world.id}`;
      const present = other !== undefined && other.guest === null && other.world?.id === world.id;
      if ((act === 'mute' || act === 'kick') && !present) return reply('invalid', `${targetName} ist gerade nicht im Voice dieser Welt.`);
    } else {
      const party = conn.lastJoin === null ? null : hooks.party(conn.lastJoin.group, conn.uuid);
      conn.party = party;
      if (party === null || !party.inGroup || conn.group === null || party.leader !== conn.uuid) return reply('denied', 'Das darf nur der Leiter der Party (in der Voice-Gruppe der Party).');
      if (!party.members.has(target)) return reply('invalid', `${targetName} ist nicht in deiner Party.`);
      key = `party:${party.id}`;
    }
    const by = { uuid: conn.uuid, name: hooks.name(conn.uuid) };
    let entries = this.scopes.get(key);
    const existing = this.scopeEntry(key, target, now);
    const upsert = (): ScopeEntry => {
      if (!entries) {
        entries = new Map();
        this.scopes.set(key, entries);
      }
      let entry = entries.get(target);
      if (!entry) {
        entry = { by, muted: false, kickedUntil: null, seenAt: now };
        entries.set(target, entry);
      }
      entry.by = by;
      entry.seenAt = now;
      return entry;
    };
    let until: number | null = null;
    switch (act) {
      case 'mute':
        upsert().muted = true;
        break;
      case 'unmute':
        if (!existing?.muted) return reply('invalid', `${targetName} ist hier nicht stummgeschaltet.`);
        existing.muted = false;
        this.scopeEntry(key, target, now);
        break;
      case 'kick':
        until = now + VOICE_KICK_MS;
        upsert().kickedUntil = until;
        break;
      case 'unkick':
        if (existing?.kickedUntil == null) return reply('invalid', `${targetName} ist hier nicht entfernt.`);
        existing.kickedUntil = null;
        this.scopeEntry(key, target, now);
        break;
    }
    if (other !== undefined) {
      if (act === 'mute') other.mutedNotified.add(key);
      if (act === 'unmute') other.mutedNotified.delete(key);
      this.sendTo(other, this.moderatedMessage(act, scope, by, other.world, until));
      if (act === 'kick') {
        if (scope === 'world' && other.room !== null) {
          this.join(other, null, other.group);
          this.setRoom(other, 'kicked', 'Du bist gerade aus dem Voice dieser Welt entfernt.', until, true);
        } else if (scope === 'party' && other.group !== null && this.partyScope(other) === key) {
          this.join(other, other.room, null);
          this.sendTo(other, { type: 'group', status: 'kicked', until, message: 'Du bist gerade aus dem Voice der Party entfernt.' });
        }
      } else if (act === 'unkick' && other.lastJoin !== null) {
        // Wieder hinein, ohne auf ein neues `join` des Clients zu warten.
        this.joinGame(other, other.lastJoin.server, other.lastJoin.dimension, other.lastJoin.group);
      }
    }
    // Wer im Bereich ist, sieht `silenced` sofort.
    if (act === 'mute' || act === 'unmute') {
      for (const member of this.connections.values()) if (this.worldScope(member) === key || this.partyScope(member) === key) this.sendPeersTo(member);
    }
    const done = {
      mute: `${targetName} ist hier jetzt für alle stumm.`,
      unmute: `${targetName} ist wieder zu hören.`,
      kick: `${targetName} ist für 10 Minuten aus dem Voice entfernt.`,
      unkick: `${targetName} darf wieder in den Voice.`,
    }[act];
    reply('ok', done);
  }

  /**
   * `join` mit `invite` (Browser, ab 1.11.0): nur die Gruppe der Einladung, kein Raum. Gäste nur mit der Einladung ihrer
   * Sitzung. Ungültig, abgelaufen oder widerrufen: `{ type: 'invite', status: 'invalid' }` und Schließen (4006).
   */
  private joinInvite(conn: Connection, code: unknown): void {
    const group = isInviteCode(code) && (conn.guest === null || conn.guest.invite === code) ? (this.options.inviteGroup?.(code) ?? null) : null;
    if (group === null) {
      this.inviteInvalid(conn);
      return;
    }
    // Ab 1.13.0: Server der Einladung steht auf der Liste „Voice aus“: keine Gruppe, nur der Hinweis.
    const server = group.split(' ')[0] ?? '';
    conn.server = server;
    if (this.options.moderation?.serverOff(server)) {
      conn.invite = null;
      this.join(conn, null, null);
      this.sendTo(conn, { type: 'room', server, voice: 'off', message: VOICE_SERVER_OFF, until: null, world: null, party: null });
      return;
    }
    conn.invite = code as string;
    this.join(conn, null, group);
  }

  /**
   * `kick` (ab 1.11.0): Ein Nicht-Gast entfernt einen Gast aus seiner Gruppe. Der Gast wird getrennt (4004), seine Sitzung
   * gilt nicht mehr. Alles andere (kein Gast, andere Gruppe, selbst ein Gast) wird ignoriert.
   */
  private kick(conn: Connection, target: unknown): void {
    if (conn.guest !== null || conn.group === null || typeof target !== 'string' || !ID_RE.test(target)) return;
    const other = this.connections.get(target);
    if (!other || other.guest === null || other.group !== conn.group) return;
    this.options.onGuestRemoved?.(other.uuid);
    this.drop(other, CLOSE_KICKED, 'Aus der Gruppe entfernt');
  }

  /**
   * Raum betreten oder wechseln (`room` null: kein Raum, im Browser) und Gruppe betreten, wechseln oder verlassen
   * (`group` null: keine Gruppe). Raum und Gruppe sind unabhängig: Beim Dimensionswechsel bleibt die Gruppe, im selben
   * Raum wechselt nur die Gruppe. Beim Raumwechsel gilt die alte Position nicht mehr (andere Dimension, anderer Server).
   */
  private join(conn: Connection, room: string | null, group: string | null): void {
    if (conn.room === room && conn.group === group) {
      // Nichts geändert: nur die aktuelle Liste an den Spieler selbst.
      this.sendPeersTo(conn);
      return;
    }
    // Jeder Betroffene bekommt einmal seine vollständige Liste, auch wenn er in Raum und Gruppe ist.
    const notify = new Set<Connection>();
    if (conn.room !== room) {
      this.leaveRoom(conn, notify);
      if (room !== null) {
        for (const other of enter(this.rooms, room, conn)) notify.add(other);
        conn.room = room;
      }
    }
    let full = false;
    if (conn.group !== group) {
      this.leaveGroup(conn, notify);
      if (group !== null) {
        if ((this.groups.get(group)?.size ?? 0) >= VOICE_MAX_GROUP) {
          // Voll: Der Spieler ist danach in keiner Gruppe.
          full = true;
        } else {
          for (const other of enter(this.groups, group, conn)) notify.add(other);
          conn.group = group;
        }
      }
    }
    notify.add(conn);
    if (full) this.sendTo(conn, { type: 'group', status: 'full' });
    for (const other of notify) this.sendPeersTo(other);
  }

  /** Raum und Gruppe verlassen (`leave`, Trennen, Verdrängen, Konto gelöscht oder gesperrt); die übrigen bekommen ihre Liste. */
  private leave(conn: Connection): void {
    const notify = new Set<Connection>();
    this.leaveRoom(conn, notify);
    this.leaveGroup(conn, notify);
    for (const other of notify) this.sendPeersTo(other);
  }

  private leaveRoom(conn: Connection, notify: Set<Connection>): void {
    const room = conn.room;
    if (room === null) return;
    conn.room = null;
    conn.pos = null;
    exit(this.rooms, room, conn, notify);
  }

  private leaveGroup(conn: Connection, notify: Set<Connection>): void {
    const group = conn.group;
    if (group === null) return;
    conn.group = null;
    exit(this.groups, group, conn, notify);
  }

  /**
   * Vollständige Liste für einen Spieler: die anderen im Raum (höchstens 100, unabhängig von der Entfernung),
   * die anderen in der Gruppe (jede Dimension, auch im Browser), wer davon gerade stumm ist bzw. den Ton aus hat, und
   * (ab 1.11.0) wer davon Gast (mit Namen) bzw. im Browser ist.
   */
  private sendPeersTo(conn: Connection): void {
    const uuids: string[] = [];
    const group: string[] = [];
    const listed = new Set<Connection>();
    const roomMembers = conn.room === null ? undefined : this.rooms.get(conn.room);
    if (roomMembers) {
      for (const other of roomMembers) {
        if (other === conn) continue;
        uuids.push(other.uuid);
        listed.add(other);
        if (uuids.length >= MAX_PEERS) break;
      }
    }
    const groupMembers = conn.group === null ? undefined : this.groups.get(conn.group);
    if (groupMembers) {
      for (const other of groupMembers) {
        if (other === conn) continue;
        group.push(other.uuid);
        listed.add(other);
        if (group.length >= VOICE_MAX_GROUP) break;
      }
    }
    const muted: string[] = [];
    const deafened: string[] = [];
    const guests: Record<string, string> = {};
    const browser: string[] = [];
    // Ab 1.13.0: für alle stumm geschaltet – im Raum vom Gastgeber/Operator der Welt, in der Gruppe vom Party-Leiter.
    const silenced: string[] = [];
    const worldKey = this.worldScope(conn);
    const partyKey = this.partyScope(conn);
    for (const other of listed) {
      if (other.muted) muted.push(other.uuid);
      if (other.deafened) deafened.push(other.uuid);
      if (other.guest !== null) guests[other.uuid] = other.guest.name;
      if (other.browser) browser.push(other.uuid);
      if (this.options.moderation && ((roomMembers?.has(other) && this.silenced(worldKey, other.uuid)) || (groupMembers?.has(other) && this.silenced(partyKey, other.uuid)))) {
        silenced.push(other.uuid);
      }
    }
    this.sendTo(conn, { type: 'peers', uuids, group, muted, deafened, guests, browser, ...(this.options.moderation ? { silenced } : {}) });
  }

  /** Eigener Status „Mikrofon stumm“ / „Ton aus“: Bei einer Änderung bekommt ihn jeder im selben Raum oder in derselben Gruppe. */
  private setState(conn: Connection, muted: unknown, deafened: unknown, now: number): void {
    if (typeof muted !== 'boolean' || typeof deafened !== 'boolean') return;
    if (muted === conn.muted && deafened === conn.deafened) return;
    if (now - conn.stateWindow >= WINDOW_MS) {
      conn.stateWindow = now;
      conn.states = 0;
    }
    if (conn.states >= STATE_LIMIT) return;
    conn.states++;
    conn.muted = muted;
    conn.deafened = deafened;

    // Wer in Raum und Gruppe ist, bekommt den Status nur einmal.
    const watchers = new Set<Connection>();
    const roomMembers = conn.room === null ? undefined : this.rooms.get(conn.room);
    const groupMembers = conn.group === null ? undefined : this.groups.get(conn.group);
    for (const members of [roomMembers, groupMembers]) {
      if (members) for (const other of members) if (other !== conn) watchers.add(other);
    }
    const message = { type: 'state', uuid: conn.uuid, muted, deafened };
    for (const other of watchers) this.sendTo(other, message);
  }

  /** Sprach-Rahmen: `[Version][Flags][Folgenummer, 2 Byte][Opus]`. */
  private onFrame(conn: Connection, frame: Buffer): void {
    const now = this.options.now();
    if (now - conn.frameWindow >= WINDOW_MS) {
      conn.frameWindow = now;
      conn.frames = 0;
    }
    if (++conn.frames > FRAME_LIMIT) return;
    if (frame.length <= HEADER || frame.length > HEADER + VOICE_MAX_FRAME || frame[0] !== VOICE_PROTOCOL) return;
    // Ohne Raum und ohne Gruppe hört niemand zu (im Browser gibt es nur die Gruppe).
    if (conn.room === null && conn.group === null) return;

    let out: Buffer | null = null;
    // (a) Eigene Gruppe: jede Dimension, jede Entfernung, auch im Browser, ohne Positionen und ohne „Nur Freunde“;
    // Blockieren gilt (zwischen Spielern mit Konto). Ab 1.13.0: vom Party-Leiter stumm geschaltet → nicht in der Party-Gruppe.
    const group = conn.group === null || this.silenced(this.partyScope(conn), conn.uuid) ? undefined : this.groups.get(conn.group);
    if (group) {
      for (const other of group) {
        if (other === conn || !this.canReceive(other) || this.blocked(conn, other)) continue;
        out ??= this.forwarded(conn, frame);
        other.ws.send(out, { binary: true });
      }
    }

    // (b) In der Nähe: gleicher Raum, beide mit frischer Position, in Reichweite. Ab 1.13.0: vom Gastgeber bzw. einem
    // Operator der Welt stumm geschaltet → in den Räumen der Welt nicht weiter.
    if (conn.room === null || this.silenced(this.worldScope(conn), conn.uuid)) return;
    const from = this.freshPosition(conn, now);
    if (!from) return;
    const members = this.rooms.get(conn.room);
    if (!members) return;
    for (const other of members) {
      if (other === conn) continue;
      // Mitglieder der eigenen Gruppe sind schon oben geprüft (höchstens eine Kopie).
      if (conn.group !== null && other.group === conn.group) continue;
      const to = this.freshPosition(other, now);
      if (!to) continue;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const dz = from.z - to.z;
      if (dx * dx + dy * dy + dz * dz > this.rangeSquared) continue;
      if (!this.canReceive(other)) continue;
      if (!this.mayHear(conn, other)) continue;
      out ??= this.forwarded(conn, frame);
      other.ws.send(out, { binary: true });
    }
  }

  /** Hörer ist offen, kommt mit dem Lesen hinterher und hat den Ton nicht aus. */
  private canReceive(listener: Connection): boolean {
    return listener.ws.readyState === WebSocket.OPEN && listener.ws.bufferedAmount <= MAX_BUFFERED_FRAMES && !listener.deafened;
  }

  /** Weitergeleiteter Rahmen: `[Version][Flags][Folgenummer][UUID bzw. Gast-ID des Sprechers, 16 Byte][Opus]`. */
  private forwarded(conn: Connection, frame: Buffer): Buffer {
    const out = Buffer.allocUnsafe(OUT_HEADER + frame.length - HEADER);
    out[0] = VOICE_PROTOCOL;
    // Nur Bit 0 (Ende eines Satzes) ist belegt.
    out[1] = frame[1] & 1;
    out[2] = frame[2];
    out[3] = frame[3];
    conn.id.copy(out, HEADER);
    frame.copy(out, OUT_HEADER, HEADER);
    return out;
  }

  private freshPosition(conn: Connection, now: number): Position | null {
    const pos = conn.pos;
    return pos && now - pos.at <= POSITION_MAX_AGE_MS ? pos : null;
  }

  /** Einer der beiden hat den anderen blockiert. Gäste haben kein Konto und lassen sich nicht blockieren. */
  private blocked(a: Connection, b: Connection): boolean {
    if (a.guest !== null || b.guest !== null) return false;
    return this.store.isBlocked(a.uuid, b.uuid) || this.store.isBlocked(b.uuid, a.uuid);
  }

  /** Keiner hat den anderen blockiert; mit „Nur Freunde“ (bei einem von beiden) müssen sie befreundet sein. */
  private mayHear(speaker: Connection, listener: Connection): boolean {
    if (this.blocked(speaker, listener)) return false;
    if (speaker.mode === 'friends' || listener.mode === 'friends') {
      return this.store.friendsSince(speaker.uuid, listener.uuid) !== undefined;
    }
    return true;
  }

  private onClose(conn: Connection): void {
    this.clearTimers(conn);
    if (this.closing || this.connections.get(conn.uuid) !== conn) return;
    this.connections.delete(conn.uuid);
    this.leave(conn);
  }

  private resetIdle(conn: Connection): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    conn.idleTimer = setTimeout(() => {
      if (this.connections.get(conn.uuid) === conn) this.drop(conn, 4000, 'Zeitüberschreitung');
    }, this.options.idleTimeoutMs);
    conn.idleTimer.unref();
  }

  private clearTimers(conn: Connection): void {
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    if (conn.killTimer) clearTimeout(conn.killTimer);
    if (conn.expireTimer) clearTimeout(conn.expireTimer);
  }

  private sendTo(conn: Connection, message: unknown): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.ws.bufferedAmount > MAX_BUFFERED) {
      conn.ws.terminate();
      return;
    }
    conn.ws.send(JSON.stringify(message));
  }
}
