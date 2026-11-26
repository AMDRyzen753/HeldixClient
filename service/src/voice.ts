// Voice Chat: verteilt Sprache an HeldixClient-Spieler in der Nähe (gleicher Server, gleiche Dimension).
// Der Dienst speichert und protokolliert dabei nichts: keine Sprache, keine Positionen, keine Räume.
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
  mode: Mode;
  pos: Position | null;
  idleTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  textWindow: number;
  texts: number;
  frameWindow: number;
  frames: number;
}

export const VOICE_PROTOCOL = 1;
/** Höchstgröße der Opus-Nutzdaten eines Rahmens. */
export const VOICE_MAX_FRAME = 1024;
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
/** So viele andere Spieler stehen höchstens in `peers`. */
const MAX_PEERS = 100;
/** Kommt ein Hörer mit dem Lesen nicht hinterher, bekommt er ab dieser Puffergröße keine Sprache mehr. */
const MAX_BUFFERED_FRAMES = 256 * 1024;
/** Kommen auch kleine Textnachrichten nicht mehr an, wird die Verbindung ab dieser Puffergröße getrennt. */
const MAX_BUFFERED = 1024 * 1024;
const DIMENSION_RE = /^[a-z0-9_.-]{1,32}:[a-z0-9_./-]{1,64}$/;

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

export class Voice {
  /** Höchstens eine Verbindung pro Spieler. */
  private readonly connections = new Map<string, Connection>();
  /** Raum (Server und Dimension) → Verbindungen darin; leere Räume werden gelöscht. */
  private readonly rooms = new Map<string, Set<Connection>>();
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
      mode: 'all',
      pos: null,
      textWindow: now,
      texts: 0,
      frameWindow: now,
      frames: 0,
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
    this.sendTo(conn, { type: 'ready', range: this.options.range, maxFrame: VOICE_MAX_FRAME, protocol: VOICE_PROTOCOL });
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
  }

  /** Abmelden, aus dem Raum nehmen und schließen; antwortet die Gegenseite nicht, wird hart getrennt. */
  private drop(conn: Connection, code: number, reason: string): void {
    if (this.connections.get(conn.uuid) === conn) this.connections.delete(conn.uuid);
    this.leaveRoom(conn);
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
      // Nur der Fehler, nie Inhalte (keine Sprache, keine Positionen, keine Räume).
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
        conn.mode = mode;
        this.join(conn, `${server} ${dimension}`);
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
      case 'leave':
        if (conn.room === null) return;
        this.leaveRoom(conn);
        this.sendTo(conn, { type: 'peers', uuids: [] });
        return;
    }
    // Unbekannte Nachrichten werden ignoriert.
  }

  /** Raum betreten oder wechseln. Beim Wechsel gilt die alte Position nicht mehr (andere Dimension, anderer Server). */
  private join(conn: Connection, room: string): void {
    if (conn.room === room) {
      // Nichts geändert: nur die aktuelle Liste an den Spieler selbst.
      this.sendPeersTo(conn, this.rooms.get(room)!);
      return;
    }
    this.leaveRoom(conn);
    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    members.add(conn);
    conn.room = room;
    this.broadcastPeers(members);
  }

  private leaveRoom(conn: Connection): void {
    const room = conn.room;
    if (room === null) return;
    conn.room = null;
    conn.pos = null;
    const members = this.rooms.get(room);
    if (!members) return;
    members.delete(conn);
    if (members.size === 0) this.rooms.delete(room);
    else this.broadcastPeers(members);
  }

  /** Jeder im Raum bekommt die anderen (höchstens 100, unabhängig von der Entfernung). */
  private broadcastPeers(members: Set<Connection>): void {
    for (const conn of members) this.sendPeersTo(conn, members);
  }

  private sendPeersTo(conn: Connection, members: Set<Connection>): void {
    const uuids: string[] = [];
    for (const other of members) {
      if (other === conn) continue;
      uuids.push(other.uuid);
      if (uuids.length >= MAX_PEERS) break;
    }
    this.sendTo(conn, { type: 'peers', uuids });
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
    const from = this.freshPosition(conn, now);
    if (!from) return;
    const members = this.rooms.get(conn.room);
    if (!members) return;

    let out: Buffer | null = null;
    for (const other of members) {
      if (other === conn) continue;
      const to = this.freshPosition(other, now);
      if (!to) continue;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const dz = from.z - to.z;
      if (dx * dx + dy * dy + dz * dz > this.rangeSquared) continue;
      if (other.ws.readyState !== WebSocket.OPEN || other.ws.bufferedAmount > MAX_BUFFERED_FRAMES) continue;
      if (!this.mayHear(conn, other)) continue;
      out ??= this.forwarded(conn, frame);
      other.ws.send(out, { binary: true });
    }
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

  /** Keiner hat den anderen blockiert; mit „Nur Freunde“ (bei einem von beiden) müssen sie befreundet sein. */
  private mayHear(speaker: Connection, listener: Connection): boolean {
    if (this.store.isBlocked(speaker.uuid, listener.uuid) || this.store.isBlocked(listener.uuid, speaker.uuid)) return false;
    if (speaker.mode === 'friends' || listener.mode === 'friends') {
      return this.store.friendsSince(speaker.uuid, listener.uuid) !== undefined;
    }
    return true;
  }

  private onClose(conn: Connection): void {
    this.clearTimers(conn);
    if (this.closing || this.connections.get(conn.uuid) !== conn) return;
    this.connections.delete(conn.uuid);
    this.leaveRoom(conn);
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
