// Voice Chat: verteilt Sprache an HeldixClient-Spieler in der Nähe (gleicher Server, gleiche Dimension)
// und an die eigene Gruppe (gleicher Server, jede Dimension, jede Entfernung).
// Der Dienst speichert und protokolliert dabei nichts: keine Sprache, keine Positionen, keine Räume, keine Gruppen, keinen Status.
import { WebSocket, type RawData } from 'ws';
import type { Store } from './db';
import { normalizeServer } from './validate';

export interface VoiceOptions {
  /** Reichweite in Blöcken (8–128). */
  range: number;
  /** Ohne Nachricht so lange wird die Verbindung geschlossen (Standard 60 s). */
  idleTimeoutMs: number;
  /** Uhr für Positionen und Begrenzungen (nur Tests stellen sie). */
  now: () => number;
  log: (line: string) => void;
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
  uuid: string;
  /** UUID als 16 Byte für die weitergeleiteten Rahmen */
  id: Buffer;
  room: string | null;
  /** Gruppe: Server und Prüfwert aus Gruppenname und Passwort; nur zusammen mit einem Raum. */
  group: string | null;
  mode: Mode;
  pos: Position | null;
  /** Eigener Status; bleibt an der Verbindung, auch über Raum- und Gruppenwechsel und `leave` hinweg. */
  muted: boolean;
  deafened: boolean;
  idleTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  textWindow: number;
  texts: number;
  frameWindow: number;
  frames: number;
  stateWindow: number;
  states: number;
}

export const VOICE_PROTOCOL = 1;
/** Höchstgröße der Opus-Nutzdaten eines Rahmens. */
export const VOICE_MAX_FRAME = 1024;
/** Was der Dienst über die Grundfunktionen hinaus kann (steht in `ready`); das Rahmen-Format bleibt Version 1. */
export const VOICE_FEATURES: readonly string[] = ['state', 'groups'];
/** Höchstens so viele Mitglieder hat eine Gruppe. */
export const VOICE_MAX_GROUP = 16;
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
  /** Höchstens eine Verbindung pro Spieler. */
  private readonly connections = new Map<string, Connection>();
  /** Raum (Server und Dimension) → Verbindungen darin; leere Räume werden gelöscht. */
  private readonly rooms = new Map<string, Set<Connection>>();
  /** Gruppe (Server und Prüfwert) → Verbindungen darin, höchstens 16; leere Gruppen werden gelöscht. */
  private readonly groups = new Map<string, Set<Connection>>();
  private readonly rangeSquared: number;
  private closing = false;

  constructor(
    private readonly store: Store,
    private readonly options: VoiceOptions,
  ) {
    this.rangeSquared = options.range * options.range;
  }

  /** Spieler mit offener Voice-Verbindung (für /v1/status). */
  connectedCount(): number {
    return this.connections.size;
  }

  /** Neue, bereits angemeldete Verbindung übernehmen. Eine ältere des Spielers wird geschlossen (4002). */
  attach(ws: WebSocket, uuid: string): void {
    const now = this.options.now();
    const conn: Connection = {
      ws,
      uuid,
      id: Buffer.from(uuid, 'hex'),
      room: null,
      group: null,
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
    };
    // Zuerst die Ereignisse anmelden: Geht danach etwas schief, räumt 'close' auf.
    ws.on('message', (data, isBinary) => this.onMessage(conn, data, isBinary));
    ws.on('ping', () => this.resetIdle(conn));
    ws.on('pong', () => this.resetIdle(conn));
    ws.on('error', () => {
      // Danach folgt immer 'close'.
    });
    ws.on('close', () => this.onClose(conn));

    const old = this.connections.get(uuid);
    if (old) this.drop(old, 4002, 'Neue Verbindung');
    this.connections.set(uuid, conn);
    this.resetIdle(conn);
    this.sendTo(conn, {
      type: 'ready',
      range: this.options.range,
      maxFrame: VOICE_MAX_FRAME,
      protocol: VOICE_PROTOCOL,
      features: VOICE_FEATURES,
      maxGroup: VOICE_MAX_GROUP,
    });
  }

  /** Schließt die Voice-Verbindung eines Spielers (Konto gelöscht, gesperrt). */
  disconnectUser(uuid: string, code: number, reason: string): void {
    const conn = this.connections.get(uuid);
    if (conn) this.drop(conn, code, reason);
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
    this.clearTimers(conn);
    conn.ws.close(code, reason);
    conn.killTimer = setTimeout(() => conn.ws.terminate(), Math.min(2000, this.options.idleTimeoutMs));
    conn.killTimer.unref();
  }

  private onMessage(conn: Connection, data: RawData, isBinary: boolean): void {
    // Schon abgemeldete Verbindung (ersetzt, Konto gelöscht): nichts mehr annehmen.
    if (this.connections.get(conn.uuid) !== conn) return;
    this.resetIdle(conn);
    try {
      if (isBinary) this.onFrame(conn, toBuffer(data));
      else this.onText(conn, data);
    } catch (err) {
      // Nur der Fehler, nie Inhalte (keine Sprache, keine Positionen, keine Räume, keine Gruppen).
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
        if (!this.store.getUser(conn.uuid)) {
          const banned = this.store.getBan(conn.uuid) !== undefined;
          this.drop(conn, banned ? 4003 : 4001, banned ? 'Gesperrt' : 'Konto gelöscht');
          return;
        }
        this.sendTo(conn, { type: 'pong' });
        return;
      case 'join': {
        const server = normalizeServer(input.server);
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
          group = `${server} ${input.group}`;
        }
        conn.mode = mode;
        this.join(conn, `${server} ${dimension}`, group);
        return;
      }
      case 'pos': {
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
      case 'leave':
        if (conn.room === null) return;
        this.leave(conn);
        this.sendPeersTo(conn);
        return;
    }
    // Unbekannte Nachrichten werden ignoriert.
  }

  /**
   * Raum betreten oder wechseln und Gruppe betreten, wechseln oder verlassen (`group` null: keine Gruppe).
   * Raum und Gruppe sind unabhängig: Beim Dimensionswechsel bleibt die Gruppe, im selben Raum wechselt nur die Gruppe.
   * Beim Raumwechsel gilt die alte Position nicht mehr (andere Dimension, anderer Server).
   */
  private join(conn: Connection, room: string, group: string | null): void {
    if (conn.room === room && conn.group === group) {
      // Nichts geändert: nur die aktuelle Liste an den Spieler selbst.
      this.sendPeersTo(conn);
      return;
    }
    // Jeder Betroffene bekommt einmal seine vollständige Liste, auch wenn er in Raum und Gruppe ist.
    const notify = new Set<Connection>();
    if (conn.room !== room) {
      this.leaveRoom(conn, notify);
      for (const other of enter(this.rooms, room, conn)) notify.add(other);
      conn.room = room;
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
   * die anderen in der Gruppe (jede Dimension) und wer davon gerade stumm ist bzw. den Ton aus hat.
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
    for (const other of listed) {
      if (other.muted) muted.push(other.uuid);
      if (other.deafened) deafened.push(other.uuid);
    }
    this.sendTo(conn, { type: 'peers', uuids, group, muted, deafened });
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
    if (conn.room === null) return;

    let out: Buffer | null = null;
    // (a) Eigene Gruppe: jede Dimension, jede Entfernung, ohne Positionen und ohne „Nur Freunde“; Blockieren gilt.
    const group = conn.group === null ? undefined : this.groups.get(conn.group);
    if (group) {
      for (const other of group) {
        if (other === conn || !this.canReceive(other) || this.blocked(conn, other)) continue;
        out ??= this.forwarded(conn, frame);
        other.ws.send(out, { binary: true });
      }
    }

    // (b) In der Nähe: gleicher Raum, beide mit frischer Position, in Reichweite.
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

  /** Weitergeleiteter Rahmen: `[Version][Flags][Folgenummer][UUID des Sprechers, 16 Byte][Opus]`. */
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

  /** Einer der beiden hat den anderen blockiert. */
  private blocked(a: Connection, b: Connection): boolean {
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
