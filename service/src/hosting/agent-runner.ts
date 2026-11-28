// Dauerhafte Welten: HostingRunner über den Welten-Wächter (src/agent/, eigener Prozess mit Docker-Zugriff). Der Dienst
// selbst hat keinen Docker-Zugriff; er spricht nur über einen Unix-Socket (HELDIX_DIENST_WELTEN_AGENT, Standard des
// Installers /run/heldix-dienst/welten.sock; unter Windows für Tests eine Named Pipe) mit dem Wächter:
//
//   { id, op, world, args } → { id, ok: true, result } bzw. { id, ok: false, error, code }
//   Log-Strom: op "follow" → { id, line } … bis op "unfollow" (siehe src/agent/protocol.ts)
//
// Eine dauerhafte Verbindung, Anfragen laufen gleichzeitig (Zuordnung über id). Jede Anfrage hat eine Zeitgrenze
// (je nach Operation, z. B. Import bis 60 Minuten). Fällt die Verbindung weg, scheitern offene Anfragen mit
// „Verbindung zum Welten-Wächter unterbrochen“; die nächste Anfrage verbindet neu, laufende Log-Abos verbinden sich von
// selbst wieder. Fehler sind AgentError mit deutscher Meldung und `code` (z. B. "full", "running", "unavailable").
//
// Pfade für readFile/writeFile: „plugins/<…>“ (ohne „plugins/“ geht auch); listFiles liefert „plugins/<…>“.
// importWorld/exportWorld/exportBackup: absolute Pfade im Upload-Ordner des Dienstes (<Datenordner>/hosting-uploads).
import net from 'node:net';
import { AgentError, type AgentErrorCode } from '../agent/errors';
import { LineBuffer, MAX_RESPONSE_LINE_BYTES, type AgentOp, type HelloResult } from '../agent/protocol';
import {
  HOSTED_WORLD_ID_RE,
  type BackupInfo,
  type HostingRunner,
  type PluginFile,
  type PrepareOptions,
  type RunnerState,
  type RunnerStats,
} from './runner';

export interface AgentRunnerOptions {
  /** Verbindungsaufbau (Standard 3 s) */
  connectTimeoutMs?: number;
  /** Standard-Zeitgrenze einer Anfrage (30 s; lange Operationen haben eigene, siehe OP_TIMEOUTS) */
  requestTimeoutMs?: number;
  /** erster Abstand beim Wiederverbinden der Log-Abos (1 s, verdoppelt bis maxReconnectDelayMs) */
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

/** Zeitgrenzen der langen Operationen */
const OP_TIMEOUTS: Partial<Record<AgentOp, number>> = {
  prepare: 15 * 60_000,
  start: 4 * 60_000,
  installPlugin: 10 * 60_000,
  importWorld: 60 * 60_000,
  exportWorld: 60 * 60_000,
  backup: 60 * 60_000,
  restoreBackup: 60 * 60_000,
  exportBackup: 30 * 60_000,
  remove: 10 * 60_000,
  stats: 2 * 60_000,
  list: 60_000,
  listFiles: 60_000,
  recentLogs: 60_000,
};

interface Pending {
  op: AgentOp;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Follow {
  world: string;
  onLine: (line: string) => void;
  /** id der follow-Anfrage auf der aktuellen Verbindung (null: gerade nicht abonniert) */
  remoteId: number | null;
  active: boolean;
}

function isMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AgentRunner implements HostingRunner {
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly follows = new Set<Follow>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay: number;
  private closed = false;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly baseReconnectDelay: number;
  private readonly maxReconnectDelay: number;

  constructor(
    readonly socketPath: string,
    options: AgentRunnerOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.baseReconnectDelay = options.reconnectDelayMs ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelayMs ?? 15_000;
    this.reconnectDelay = this.baseReconnectDelay;
  }

  // ------------------------------------------------------------------------------------------
  // Verbindung
  // ------------------------------------------------------------------------------------------

  private unavailable(reason: string): AgentError {
    return new AgentError(`Welten-Wächter nicht erreichbar (${reason}). Läuft der Dienst heldix-welten-agent?`, 'unavailable');
  }

  private connect(): Promise<net.Socket> {
    if (this.closed) return Promise.reject(new AgentError('Die Verbindung zum Welten-Wächter ist geschlossen.', 'unavailable'));
    if (this.socket) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    const attempt = new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(this.unavailable('Zeitüberschreitung beim Verbinden'));
      }, this.connectTimeoutMs);
      const onError = (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(this.unavailable(err.code ?? err.message));
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.off('error', onError);
        if (this.closed) {
          socket.destroy();
          reject(new AgentError('Die Verbindung zum Welten-Wächter ist geschlossen.', 'unavailable'));
          return;
        }
        this.useSocket(socket);
        resolve(socket);
      });
    });
    this.connecting = attempt;
    attempt.then(
      () => {
        this.connecting = null;
      },
      () => {
        this.connecting = null;
      },
    );
    return attempt;
  }

  private useSocket(socket: net.Socket): void {
    this.socket = socket;
    this.reconnectDelay = this.baseReconnectDelay;
    socket.setNoDelay(true);
    // Die Verbindung allein hält den Prozess nicht am Leben (offene Anfragen haben eigene Timer)
    socket.unref();
    const buffer = new LineBuffer(MAX_RESPONSE_LINE_BYTES);
    socket.on('data', (chunk: Buffer) => {
      let lines: string[];
      try {
        lines = buffer.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          this.onMessage(JSON.parse(line));
        } catch {
          // kaputte Zeile: übergehen
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      const lost = [...this.pending.values()];
      this.pending.clear();
      for (const p of lost) {
        clearTimeout(p.timer);
        p.reject(new AgentError('Verbindung zum Welten-Wächter unterbrochen.', 'unavailable'));
      }
      for (const follow of this.follows) follow.remoteId = null;
      if (this.follows.size > 0) this.scheduleReconnect();
    });
  }

  private onMessage(message: unknown): void {
    if (!isMessage(message) || typeof message.id !== 'number') return;
    if (typeof message.line === 'string') {
      for (const follow of this.follows) {
        if (follow.active && follow.remoteId === message.id) {
          try {
            follow.onLine(message.line);
          } catch {
            // Fehler im Abonnenten stören die Verbindung nicht
          }
        }
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message.result);
    else {
      const code = (typeof message.code === 'string' ? message.code : 'internal') as AgentErrorCode;
      pending.reject(new AgentError(typeof message.error === 'string' ? message.error : 'Fehler im Welten-Wächter.', code));
    }
  }

  private send(socket: net.Socket, id: number, op: AgentOp, world: string | undefined, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentError(`Welten-Wächter antwortet nicht (${op}, nach ${Math.round(timeoutMs / 1000)} s).`, 'timeout'));
      }, timeoutMs);
      this.pending.set(id, { op, resolve, reject, timer });
      socket.write(`${JSON.stringify({ id, op, ...(world === undefined ? {} : { world }), args })}\n`);
    });
  }

  private async request<T>(op: AgentOp, world: string | undefined, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    const socket = await this.connect();
    const id = this.nextId++;
    return (await this.send(socket, id, op, world, args, timeoutMs ?? OP_TIMEOUTS[op] ?? this.requestTimeoutMs)) as T;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed || this.follows.size === 0) return;
      this.connect().then(
        () => {
          for (const follow of this.follows) if (follow.remoteId === null) void this.subscribe(follow);
        },
        () => this.scheduleReconnect(),
      );
    }, delay);
    this.reconnectTimer.unref();
  }

  private async subscribe(follow: Follow): Promise<void> {
    try {
      const socket = await this.connect();
      if (!follow.active || follow.remoteId !== null) return;
      const id = this.nextId++;
      follow.remoteId = id;
      await this.send(socket, id, 'follow', follow.world, {}, this.requestTimeoutMs);
    } catch (err) {
      follow.remoteId = null;
      const code = err instanceof AgentError ? err.code : 'unavailable';
      // nur bei Verbindungsproblemen erneut versuchen, nicht bei abgelehnter Anfrage
      if (follow.active && (code === 'unavailable' || code === 'timeout')) this.scheduleReconnect();
    }
  }

  /** Verbindung schließen; offene Anfragen scheitern, Log-Abos enden. */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const follow of this.follows) follow.active = false;
    this.follows.clear();
    this.socket?.destroy();
    this.socket = null;
  }

  /** Version und Grenzen des Wächters (z. B. für den Team-Bereich). */
  hello(): Promise<HelloResult> {
    return this.request<HelloResult>('hello', undefined);
  }

  // ------------------------------------------------------------------------------------------
  // HostingRunner
  // ------------------------------------------------------------------------------------------

  async prepare(world: string, options: PrepareOptions): Promise<void> {
    await this.request('prepare', world, {
      jar: options.jar,
      memoryMb: options.memoryMb,
      properties: options.properties,
      motd: options.motd,
      ...(options.iconPng ? { iconPng: options.iconPng.toString('base64') } : {}),
    });
  }

  start(world: string): Promise<{ port: number }> {
    return this.request<{ port: number }>('start', world);
  }

  async stop(world: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const args = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
    await this.request('stop', world, args, (options.timeoutMs ?? 60_000) + 60_000);
  }

  state(world: string): Promise<RunnerState> {
    return this.request<RunnerState>('state', world);
  }

  port(world: string): Promise<number | null> {
    return this.request<number | null>('port', world);
  }

  async command(world: string, line: string): Promise<void> {
    await this.request('command', world, { line });
  }

  recentLogs(world: string, lines: number): Promise<string[]> {
    return this.request<string[]>('recentLogs', world, { lines });
  }

  followLogs(world: string, onLine: (line: string) => void): () => void {
    if (!HOSTED_WORLD_ID_RE.test(world)) throw new AgentError('Ungültige Welt-ID (erwartet 32 Zeichen 0–9 und a–f).');
    const follow: Follow = { world, onLine, remoteId: null, active: true };
    this.follows.add(follow);
    void this.subscribe(follow);
    return () => {
      if (!follow.active) return;
      follow.active = false;
      this.follows.delete(follow);
      const remote = follow.remoteId;
      follow.remoteId = null;
      if (remote !== null && this.socket) this.request('unfollow', world, { follow: remote }).catch(() => {});
    };
  }

  stats(world: string): Promise<RunnerStats> {
    return this.request<RunnerStats>('stats', world);
  }

  async setProperties(world: string, properties: Record<string, string>, motd?: string): Promise<void> {
    await this.request('setProperties', world, motd === undefined ? { properties } : { properties, motd });
  }

  listPlugins(world: string): Promise<string[]> {
    return this.request<string[]>('listPlugins', world);
  }

  async installPlugin(world: string, file: PluginFile): Promise<void> {
    await this.request('installPlugin', world, { name: file.name, url: file.url, sha512: file.sha512 });
  }

  async removePlugin(world: string, name: string): Promise<void> {
    await this.request('removePlugin', world, { name });
  }

  readFile(world: string, relativePath: string): Promise<string> {
    return this.request<string>('readFile', world, { path: relativePath });
  }

  async writeFile(world: string, relativePath: string, content: string): Promise<void> {
    await this.request('writeFile', world, { path: relativePath, content });
  }

  listFiles(world: string): Promise<string[]> {
    return this.request<string[]>('listFiles', world);
  }

  async importWorld(world: string, zipPath: string): Promise<void> {
    await this.request('importWorld', world, { zipPath });
  }

  async exportWorld(world: string, zipPath: string): Promise<void> {
    await this.request('exportWorld', world, { zipPath });
  }

  backup(world: string, name: string): Promise<BackupInfo> {
    return this.request<BackupInfo>('backup', world, { name });
  }

  listBackups(world: string): Promise<BackupInfo[]> {
    return this.request<BackupInfo[]>('listBackups', world);
  }

  async restoreBackup(world: string, name: string): Promise<void> {
    await this.request('restoreBackup', world, { name });
  }

  async deleteBackup(world: string, name: string): Promise<void> {
    await this.request('deleteBackup', world, { name });
  }

  async exportBackup(world: string, name: string, zipPath: string): Promise<void> {
    await this.request('exportBackup', world, { name, zipPath });
  }

  async remove(world: string): Promise<void> {
    await this.request('remove', world);
  }

  list(): Promise<string[]> {
    return this.request<string[]>('list', undefined);
  }
}
