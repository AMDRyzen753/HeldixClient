// Echtzeit über WebSocket: wer ist verbunden, welcher Status gilt, wer bekommt welche Nachricht.
// Ab 1.12.0 gibt es zwei Arten von Verbindungen: aus dem Spiel (Bearer-Token) und Begleiter (Webseite mit Cookie,
// Launcher mit `?client=launcher`). Begleiter bekommen alle Nachrichten, zählen aber nicht als „online im Spiel“:
// Online-Status, Server, Spielzeit, „zuletzt online“ und /v1/status hängen nur an Verbindungen aus dem Spiel.
import { WebSocket, type RawData } from 'ws';
import type { FriendViewerRow, Store, UserRow } from './db';
import { friendView, friendsPayload, type Presence, type PresenceSource } from './friends';
import type { PlayerBadge } from './roles';
import { isState, isUuid, normalizeServer, type State } from './validate';

export interface RealtimeOptions {
  /** Ohne Nachricht so lange wird die Verbindung geschlossen (Standard 90 s). */
  idleTimeoutMs: number;
  /** Höchstens so viele Nachrichten pro Verbindung und Zeitraum; der Rest wird verworfen. */
  messageLimit: number;
  messageWindowMs: number;
  log: (line: string) => void;
  /** Abzeichen mehrerer Spieler (Freundesliste); ohne: keine Abzeichen. */
  badges?: (uuids: readonly string[]) => Map<string, Exclude<PlayerBadge, null>>;
  /** Server aus `status` prüfen (Standard normalizeServer; app.ts lässt zusätzlich Adressen geteilter Welten zu). */
  normalizeServer?: (value: unknown) => string | null;
  /** Gilt die Web-Sitzung einer Begleiter-Verbindung noch? (beim `ping` geprüft) */
  sessionAlive?: (sessionId: string) => boolean;
}

/** Wo die Verbindung herkommt: aus dem Spiel oder als Begleiter (Webseite, Launcher). */
export type ConnectionKind = 'game' | 'companion';

export interface AttachOptions {
  kind?: ConnectionKind;
  /** ID der Web-Sitzung (nur bei Verbindungen mit Cookie), damit Abmelden die Verbindung schließt */
  sessionId?: string | null;
}

interface Status {
  state: State | null;
  server: string | null;
}

interface Connection {
  ws: WebSocket;
  uuid: string;
  kind: ConnectionKind;
  sessionId: string | null;
  idleTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  windowStart: number;
  messages: number;
}

/** Schickt ein langsamer Client nichts mehr ab, wird die Verbindung ab dieser Puffergröße getrennt. */
const MAX_BUFFERED = 1024 * 1024;
/** Schließcode, wenn die Web-Sitzung einer Begleiter-Verbindung endet (Abmelden, abgelaufen). */
export const CLOSE_SIGNED_OUT = 4008;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * „Zuletzt online“ gerundet (abgerundet): vor weniger als einer Stunde auf 5 Minuten, vor weniger als einem Tag auf
 * volle Stunden, sonst auf volle Tage (UTC). So verrät die Angabe nie den genauen Zeitpunkt.
 */
export function roundLastOnline(at: number, now = Date.now()): number {
  const age = now - at;
  const step = age < HOUR ? 5 * MINUTE : age < DAY ? HOUR : DAY;
  return Math.floor(at / step) * step;
}

export class Realtime implements PresenceSource {
  /** Alle Verbindungen je Spieler (Spiel und Begleiter). */
  private readonly connections = new Map<string, Set<Connection>>();
  /** Verbindungen aus dem Spiel je Spieler (nur Spieler mit mindestens einer). */
  private readonly games = new Map<string, number>();
  /** Zuletzt gemeldeter Status pro Spieler (gilt für alle seine Verbindungen aus dem Spiel). */
  private readonly status = new Map<string, Status>();
  /** Weitere Verbindungen, die disconnectUser mit schließt (Voice Chat). */
  private readonly disconnectListeners: ((uuid: string, code: number, reason: string) => void)[] = [];
  /** Beginn und Ende der Zeit im Spiel (für die Bestätigung von Einladungen). */
  private readonly playingListeners: ((uuid: string, playing: boolean) => void)[] = [];
  /** Online im Spiel oder Status/Server geändert (Party: Ort der Mitglieder, Folgen). */
  private readonly changeListeners: ((uuid: string) => void)[] = [];
  /** Erste Verbindung (gleich welcher Art) auf bzw. letzte zu (Party: Gnadenfrist). */
  private readonly connectionListeners: ((uuid: string, connected: boolean) => void)[] = [];
  /** `typing` vom Client (Nachrichten: „schreibt …“). */
  private readonly typingListeners: ((from: string, to: string) => void)[] = [];
  private closing = false;

  constructor(
    private readonly store: Store,
    private readonly options: RealtimeOptions,
  ) {}

  /** Mit mindestens einer Verbindung aus dem Spiel verbunden (Nachschlagen, Team-Bereich). */
  isConnected(uuid: string): boolean {
    return this.games.has(uuid);
  }

  /** Mit irgendeiner Verbindung verbunden (Spiel oder Begleiter). */
  hasConnection(uuid: string): boolean {
    return this.connections.has(uuid);
  }

  /** Spieler mit mindestens einer Verbindung aus dem Spiel (für /v1/status; Begleiter zählen nicht). */
  onlineCount(): number {
    return this.games.size;
  }

  /** Alle offenen Verbindungen eines Spielers (für die Grenze je Spieler). */
  connectionCount(uuid: string): number {
    return this.connections.get(uuid)?.size ?? 0;
  }

  /** Im Spiel: verbunden, und das Spiel hat einen Status gemeldet (Hauptmenü, Welt, Server …). */
  isPlaying(uuid: string): boolean {
    return this.games.has(uuid) && (this.status.get(uuid)?.state ?? null) !== null;
  }

  /** Gemeldeter Status aus dem Spiel ohne Rücksicht auf die Privatsphäre (nur für die Party), sonst null. */
  statusOf(uuid: string): Status | null {
    if (!this.games.has(uuid)) return null;
    return this.status.get(uuid) ?? { state: null, server: null };
  }

  /**
   * Meldet, wann ein Spieler ins Spiel kommt (erster Status) und wann er es verlässt (letzte Verbindung zu, Konto
   * gelöscht oder gesperrt). Beim Herunterfahren kommt keine Meldung.
   */
  onPlaying(listener: (uuid: string, playing: boolean) => void): void {
    this.playingListeners.push(listener);
  }

  /** Online im Spiel, Status oder Server eines Spielers haben sich (vielleicht) geändert. */
  onChange(listener: (uuid: string) => void): void {
    this.changeListeners.push(listener);
  }

  /** Erste Verbindung eines Spielers (Spiel oder Begleiter) bzw. die letzte ist zu. Nicht bei disconnectUser. */
  onConnection(listener: (uuid: string, connected: boolean) => void): void {
    this.connectionListeners.push(listener);
  }

  /** `{ type: 'typing', to }` von einer Verbindung des Spielers `from`. */
  onTyping(listener: (from: string, to: string) => void): void {
    this.typingListeners.push(listener);
  }

  private emit<T extends unknown[]>(listeners: ((...args: T) => void)[], what: string, ...args: T): void {
    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (err) {
        this.options.log(`Fehler bei ${what}: ${(err as Error).message}`);
      }
    }
  }

  private emitPlaying(uuid: string, playing: boolean): void {
    this.emit(this.playingListeners, 'der Spielzeit', uuid, playing);
  }

  /** Was Freunde sehen. Bei `presence` aus immer offline, Server nur mit `showServer` im Mehrspieler. */
  presenceOf(user: UserRow): Presence {
    const statusText = user.statusText === '' ? null : user.statusText;
    if (!user.presence || !this.games.has(user.uuid)) {
      const lastOnline = user.presence && user.showLastOnline && user.lastOnline !== null ? roundLastOnline(user.lastOnline) : null;
      return { online: false, state: null, server: null, statusText, dnd: false, lastOnline };
    }
    const status = this.status.get(user.uuid);
    const state = status?.state ?? null;
    const server = user.showServer && state === 'multiplayer' ? (status?.server ?? null) : null;
    return { online: true, state, server, statusText, dnd: user.dnd, lastOnline: null };
  }

  badgesOf(uuids: readonly string[]): Map<string, Exclude<PlayerBadge, null>> {
    return this.options.badges?.(uuids) ?? new Map();
  }

  /** Neue, bereits angemeldete Verbindung übernehmen. */
  attach(ws: WebSocket, uuid: string, attachOptions: AttachOptions = {}): void {
    const kind = attachOptions.kind ?? 'game';
    const before = this.snapshot(uuid);
    const conn: Connection = { ws, uuid, kind, sessionId: attachOptions.sessionId ?? null, windowStart: Date.now(), messages: 0 };
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
    const first = !set;
    if (!set) {
      set = new Set();
      this.connections.set(uuid, set);
    }
    set.add(conn);
    const firstGame = kind === 'game' && !this.games.has(uuid);
    if (kind === 'game') this.games.set(uuid, (this.games.get(uuid) ?? 0) + 1);
    this.resetIdle(conn);
    if (kind === 'game') this.store.touch(uuid, Date.now());

    this.sendTo(conn, { type: 'friends', ...friendsPayload(this.store, this, uuid) });
    if (kind === 'game') this.announce(uuid, before);
    if (first) this.emit(this.connectionListeners, 'einer Verbindung', uuid, true);
    if (firstGame) this.emit(this.changeListeners, 'einer Statusänderung', uuid);
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

  /**
   * Stand vor einer Änderung merken, um danach nur bei echten Änderungen zu senden. „Zuletzt online“ selbst gehört
   * nicht dazu (es ändert sich mit der Zeit), nur ob es gezeigt wird.
   */
  snapshot(uuid: string): string {
    const user = this.store.getUser(uuid);
    if (!user) return '';
    const { lastOnline, ...rest } = this.presenceOf(user);
    return JSON.stringify({ ...rest, lastOnline: lastOnline !== null });
  }

  /**
   * Hat sich die Sicht der Freunde auf `uuid` geändert, bekommt jeder verbundene Freund eine `friend`-Nachricht (mit
   * seinen eigenen Angaben zu ihm: Favorit, Spitzname, Notiz).
   */
  announce(uuid: string, before: string): void {
    const user = this.store.getUser(uuid);
    if (!user) return;
    if (this.snapshot(uuid) === before) return;
    const viewers = this.store.friendViewers(uuid).filter((row) => this.connections.has(row.uuid));
    if (viewers.length === 0) return;
    const presence = this.presenceOf(user);
    const badge = this.badgesOf([uuid]).get(uuid) ?? null;
    for (const viewer of viewers) this.send(viewer.uuid, { type: 'friend', friend: friendView(user, viewer, presence, badge) });
  }

  /** Eigene Angaben zu einem Freund geändert: nur die eigenen Verbindungen bekommen die neue Sicht. */
  sendFriendTo(viewer: string, row: FriendViewerRow, friend: UserRow): void {
    if (!this.connections.has(viewer)) return;
    const badge = this.badgesOf([friend.uuid]).get(friend.uuid) ?? null;
    this.send(viewer, { type: 'friend', friend: friendView(friend, row, this.presenceOf(friend), badge) });
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
    const playing = this.isPlaying(uuid);
    const set = this.connections.get(uuid);
    this.connections.delete(uuid);
    this.games.delete(uuid);
    this.status.delete(uuid);
    if (playing) this.emitPlaying(uuid, false);
    if (!set) return;
    for (const conn of set) this.closeConnection(conn, code, reason);
  }

  /** Web-Sitzung beendet (Abmelden, Sitzung gelöscht): ihre Begleiter-Verbindungen schließen (4008). */
  closeSession(sessionId: string): void {
    for (const set of this.connections.values()) {
      for (const conn of [...set]) if (conn.sessionId === sessionId) this.closeConnection(conn, CLOSE_SIGNED_OUT, 'Abgemeldet');
    }
  }

  private closeConnection(conn: Connection, code: number, reason: string): void {
    this.clearTimers(conn);
    conn.ws.close(code, reason);
    conn.killTimer = setTimeout(() => conn.ws.terminate(), Math.min(2000, this.options.idleTimeoutMs));
    conn.killTimer.unref();
  }

  /** Alle Verbindungen sofort trennen (beim Herunterfahren); wer im Spiel war, ist ab jetzt „zuletzt online“. */
  closeAll(): void {
    this.closing = true;
    try {
      this.store.setLastOnline([...this.games.keys()], Date.now());
    } catch (err) {
      this.options.log(`„Zuletzt online“ nicht gespeichert: ${(err as Error).message}`);
    }
    for (const set of this.connections.values()) {
      for (const conn of set) {
        this.clearTimers(conn);
        conn.ws.terminate();
      }
    }
    this.connections.clear();
    this.games.clear();
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
    const { type, state, server, to } = message as { type?: unknown; state?: unknown; server?: unknown; to?: unknown };

    if (type === 'ping') {
      // Konto inzwischen gesperrt oder gelöscht (z. B. über heldix-dienst-admin, das diese Verbindung nicht erreicht):
      // spätestens beim nächsten Lebenszeichen trennen.
      if (!this.store.getUser(conn.uuid)) {
        const banned = this.store.getBan(conn.uuid) !== undefined;
        this.disconnectUser(conn.uuid, banned ? 4003 : 4001, banned ? 'Gesperrt' : 'Konto gelöscht');
        return;
      }
      // Web-Sitzung abgelaufen oder abgemeldet: nur diese Verbindung schließen.
      if (conn.sessionId !== null && this.options.sessionAlive && !this.options.sessionAlive(conn.sessionId)) {
        this.closeConnection(conn, CLOSE_SIGNED_OUT, 'Abgemeldet');
        return;
      }
      this.sendTo(conn, { type: 'pong' });
    } else if (type === 'status') {
      // Nur das Spiel meldet, wo der Spieler ist; Begleiter (Webseite, Launcher) nicht.
      if (conn.kind !== 'game' || !isState(state)) return;
      const before = this.snapshot(conn.uuid);
      const wasPlaying = this.isPlaying(conn.uuid);
      const check = this.options.normalizeServer ?? normalizeServer;
      this.status.set(conn.uuid, { state, server: state === 'multiplayer' ? check(server) : null });
      this.announce(conn.uuid, before);
      if (!wasPlaying) this.emitPlaying(conn.uuid, true);
      this.emit(this.changeListeners, 'einer Statusänderung', conn.uuid);
    } else if (type === 'typing') {
      if (isUuid(to) && to !== conn.uuid) this.emit(this.typingListeners, '„schreibt …“', conn.uuid, to);
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
    if (set.size === 0) this.connections.delete(conn.uuid);
    if (conn.kind === 'game') {
      const left = (this.games.get(conn.uuid) ?? 1) - 1;
      if (left > 0) {
        this.games.set(conn.uuid, left);
      } else {
        // Letzte Verbindung aus dem Spiel zu: Der Spieler ist offline.
        const wasPlaying = this.isPlaying(conn.uuid);
        this.games.delete(conn.uuid);
        this.status.delete(conn.uuid);
        try {
          const now = Date.now();
          this.store.touch(conn.uuid, now);
          this.store.setLastOnline([conn.uuid], now);
          this.announce(conn.uuid, before);
        } catch (err) {
          this.options.log(`Fehler beim Trennen einer Verbindung: ${(err as Error).message}`);
        }
        if (wasPlaying) this.emitPlaying(conn.uuid, false);
        this.emit(this.changeListeners, 'einer Statusänderung', conn.uuid);
      }
    }
    if (!this.connections.has(conn.uuid)) this.emit(this.connectionListeners, 'einer Verbindung', conn.uuid, false);
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
