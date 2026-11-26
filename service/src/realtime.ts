// Echtzeit über WebSocket: wer ist verbunden, welcher Status gilt, wer bekommt welche Nachricht.
import { WebSocket, type RawData } from 'ws';
import type { Store, UserRow } from './db';
import { friendView, friendsPayload, type Presence, type PresenceSource } from './friends';
import { isState, normalizeServer, type State } from './validate';

export interface RealtimeOptions {
  /** Ohne Nachricht so lange wird die Verbindung geschlossen (Standard 90 s). */
  idleTimeoutMs: number;
  /** Höchstens so viele Nachrichten pro Verbindung und Zeitraum; der Rest wird verworfen. */
  messageLimit: number;
  messageWindowMs: number;
  log: (line: string) => void;
}

interface Status {
  state: State | null;
  server: string | null;
}

interface Connection {
  ws: WebSocket;
  uuid: string;
  idleTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  windowStart: number;
  messages: number;
}

/** Schickt ein langsamer Client nichts mehr ab, wird die Verbindung ab dieser Puffergröße getrennt. */
const MAX_BUFFERED = 1024 * 1024;
const OFFLINE: Presence = Object.freeze({ online: false, state: null, server: null });

export class Realtime implements PresenceSource {
  private readonly connections = new Map<string, Set<Connection>>();
  /** Zuletzt gemeldeter Status pro Spieler (gilt für alle seine Verbindungen). */
  private readonly status = new Map<string, Status>();
  /** Weitere Verbindungen, die disconnectUser mit schließt (Voice Chat). */
  private readonly disconnectListeners: ((uuid: string, code: number, reason: string) => void)[] = [];
  private closing = false;

  constructor(
    private readonly store: Store,
    private readonly options: RealtimeOptions,
  ) {}

  isConnected(uuid: string): boolean {
    return this.connections.has(uuid);
  }

  /** Spieler mit mindestens einer offenen Verbindung (für /v1/status; Web-Sitzungen zählen nicht). */
  onlineCount(): number {
    return this.connections.size;
  }

  connectionCount(uuid: string): number {
    return this.connections.get(uuid)?.size ?? 0;
  }

  /** Was Freunde sehen. Bei `presence` aus immer offline, Server nur mit `showServer` im Mehrspieler. */
  presenceOf(user: UserRow): Presence {
    if (!user.presence || !this.connections.has(user.uuid)) return OFFLINE;
    const status = this.status.get(user.uuid);
    const state = status?.state ?? null;
    const server = user.showServer && state === 'multiplayer' ? (status?.server ?? null) : null;
    return { online: true, state, server };
  }

  /** Neue, bereits angemeldete Verbindung übernehmen. */
  attach(ws: WebSocket, uuid: string): void {
    const before = this.snapshot(uuid);
    const conn: Connection = { ws, uuid, windowStart: Date.now(), messages: 0 };
    // Zuerst die Ereignisse anmelden: Geht danach etwas schief, räumt 'close' auf.
    ws.on('message', (data, isBinary) => this.onMessage(conn, data, isBinary));
    // Auch Ping/Pong-Frames des Protokolls zählen als Lebenszeichen.
    ws.on('ping', () => this.resetIdle(conn));
    ws.on('pong', () => this.resetIdle(conn));
    ws.on('error', () => {
      // Danach folgt immer 'close'.
    });
    ws.on('close', () => this.onClose(conn));

    let set = this.connections.get(uuid);
    if (!set) {
      set = new Set();
      this.connections.set(uuid, set);
    }
    set.add(conn);
    this.resetIdle(conn);
    this.store.touch(uuid, Date.now());

    this.sendTo(conn, { type: 'friends', ...friendsPayload(this.store, this, uuid) });
    this.announce(uuid, before);
  }

  /** Nachricht an alle Verbindungen eines Spielers. */
  send(uuid: string, message: unknown): void {
    const set = this.connections.get(uuid);
    if (!set) return;
    const text = JSON.stringify(message);
    for (const conn of set) this.sendText(conn, text);
  }

  /** Aktuelle Freundesliste an alle Verbindungen eines Spielers. */
  pushFriends(uuid: string): void {
    if (!this.connections.has(uuid)) return;
    this.send(uuid, { type: 'friends', ...friendsPayload(this.store, this, uuid) });
  }

  /** Stand vor einer Änderung merken, um danach nur bei echten Änderungen zu senden. */
  snapshot(uuid: string): string {
    const user = this.store.getUser(uuid);
    return user ? JSON.stringify(this.presenceOf(user)) : '';
  }

  /** Hat sich die Sicht der Freunde auf `uuid` geändert, bekommen alle verbundenen Freunde eine `friend`-Nachricht. */
  announce(uuid: string, before: string): void {
    const user = this.store.getUser(uuid);
    if (!user) return;
    const presence = this.presenceOf(user);
    if (JSON.stringify(presence) === before) return;
    for (const friend of this.store.listFriendIds(uuid)) {
      if (this.connections.has(friend.uuid)) {
        this.send(friend.uuid, { type: 'friend', friend: friendView(user, friend.since, presence) });
      }
    }
  }

  /** Beim Trennen eines Spielers (Konto gelöscht, gesperrt) auch andere Verbindungen schließen, z. B. den Voice Chat. */
  onDisconnectUser(listener: (uuid: string, code: number, reason: string) => void): void {
    this.disconnectListeners.push(listener);
  }

  /**
   * Schließt alle Verbindungen eines Spielers (z. B. Konto gelöscht), ohne Freunde zu benachrichtigen.
   * Antwortet die Gegenseite nicht auf das Schließen, wird hart getrennt.
   */
  disconnectUser(uuid: string, code: number, reason: string): void {
    for (const listener of this.disconnectListeners) listener(uuid, code, reason);
    const set = this.connections.get(uuid);
    this.connections.delete(uuid);
    this.status.delete(uuid);
    if (!set) return;
    for (const conn of set) {
      this.clearTimers(conn);
      conn.ws.close(code, reason);
      conn.killTimer = setTimeout(() => conn.ws.terminate(), Math.min(2000, this.options.idleTimeoutMs));
      conn.killTimer.unref();
    }
  }

  /** Alle Verbindungen sofort trennen (beim Herunterfahren). */
  closeAll(): void {
    this.closing = true;
    for (const set of this.connections.values()) {
      for (const conn of set) {
        this.clearTimers(conn);
        conn.ws.terminate();
      }
    }
    this.connections.clear();
    this.status.clear();
  }

  private onMessage(conn: Connection, data: RawData, isBinary: boolean): void {
    // Schon abgemeldete Verbindung (z. B. Konto gelöscht): nichts mehr annehmen.
    if (!this.connections.get(conn.uuid)?.has(conn)) return;
    this.resetIdle(conn);
    const now = Date.now();
    if (now - conn.windowStart >= this.options.messageWindowMs) {
      conn.windowStart = now;
      conn.messages = 0;
    }
    if (++conn.messages > this.options.messageLimit || isBinary) return;

    let message: unknown;
    try {
      const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      message = JSON.parse(buffer.toString('utf8'));
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const { type, state, server } = message as { type?: unknown; state?: unknown; server?: unknown };

    if (type === 'ping') {
      // Konto inzwischen gesperrt oder gelöscht (z. B. über heldix-dienst-admin, das diese Verbindung nicht erreicht):
      // spätestens beim nächsten Lebenszeichen trennen.
      if (!this.store.getUser(conn.uuid)) {
        const banned = this.store.getBan(conn.uuid) !== undefined;
        this.disconnectUser(conn.uuid, banned ? 4003 : 4001, banned ? 'Gesperrt' : 'Konto gelöscht');
        return;
      }
      this.sendTo(conn, { type: 'pong' });
    } else if (type === 'status') {
      if (!isState(state)) return;
      const before = this.snapshot(conn.uuid);
      this.status.set(conn.uuid, { state, server: state === 'multiplayer' ? normalizeServer(server) : null });
      this.announce(conn.uuid, before);
    }
    // Unbekannte Nachrichten werden ignoriert.
  }

  private onClose(conn: Connection): void {
    this.clearTimers(conn);
    if (this.closing) return;
    const set = this.connections.get(conn.uuid);
    if (!set || !set.has(conn)) return;
    const before = this.snapshot(conn.uuid);
    set.delete(conn);
    if (set.size > 0) return;
    // Letzte Verbindung zu: Der Spieler ist offline.
    this.connections.delete(conn.uuid);
    this.status.delete(conn.uuid);
    try {
      this.store.touch(conn.uuid, Date.now());
      this.announce(conn.uuid, before);
    } catch (err) {
      this.options.log(`Fehler beim Trennen einer Verbindung: ${(err as Error).message}`);
    }
  }

  private resetIdle(conn: Connection): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    conn.idleTimer = setTimeout(() => {
      conn.ws.close(4000, 'Zeitüberschreitung');
      // Antwortet die Gegenseite nicht auf das Schließen, hart trennen.
      conn.killTimer = setTimeout(() => conn.ws.terminate(), Math.min(2000, this.options.idleTimeoutMs));
      conn.killTimer.unref();
    }, this.options.idleTimeoutMs);
    conn.idleTimer.unref();
  }

  private clearTimers(conn: Connection): void {
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    if (conn.killTimer) clearTimeout(conn.killTimer);
  }

  private sendTo(conn: Connection, message: unknown): void {
    this.sendText(conn, JSON.stringify(message));
  }

  private sendText(conn: Connection, text: string): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.ws.bufferedAmount > MAX_BUFFERED) {
      conn.ws.terminate();
      return;
    }
    conn.ws.send(text);
  }
}
