// Discord Rich Presence über die lokale IPC-Schnittstelle des Discord-Clients
// (Named Pipe \\?\pipe\discord-ipc-N unter Windows, Unix-Socket sonst). Ohne Zusatzpaket.
//
// Protokoll: jede Nachricht = 4 Byte Opcode + 4 Byte Länge (Little Endian) + JSON.
// Ablauf: HANDSHAKE { v: 1, client_id } → Discord antwortet mit READY → SET_ACTIVITY.
//
// Zuverlässigkeit: Läuft Discord nicht (oder startet neu), versucht der Launcher es still alle 15 Sekunden wieder und
// setzt den Status nach dem Verbinden sofort. Änderungen werden gebündelt: höchstens alle 15 Sekunden eine (Discord
// erlaubt 5 in 20 Sekunden, mehr wird verworfen), immer der neueste Stand und nur, wenn er sich geändert hat.
// stop() löscht den Status und wartet kurz, bis die Nachricht raus ist (Beenden des Launchers).

import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import type { DiscordStatus } from '../../shared/api';

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

/** Höchstens alle 15 Sekunden eine Statusänderung (Discord erlaubt 5 in 20 Sekunden). */
export const MIN_SEND_INTERVAL_MS = 15_000;
/** So oft wird still neu verbunden, wenn Discord nicht läuft oder die Verbindung abbricht */
export const RETRY_MS = 15_000;
/** Discord legt die Pipe als discord-ipc-0 … discord-ipc-9 an */
const PIPES = 10;

export interface DiscordActivity {
  details?: string;
  state?: string;
  timestamps?: { start?: number; end?: number };
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
  /** Spielerzahl („(3 von 8)“ hinter state), id zufällig je Party */
  party?: { id: string; size: [number, number] };
  buttons?: { label: string; url: string }[];
}

export type DiscordConnection = DiscordStatus;

/** Nur für Tests: eigene Pipe (nie die echte von Discord) und kürzere Zeiten */
export interface DiscordRpcOptions {
  pipePath?(index: number): string;
  minIntervalMs?: number;
  retryMs?: number;
}

export function pipePath(index: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`;
  const base = process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? '/tmp';
  return path.join(base, `discord-ipc-${index}`);
}

function openPipe(file: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(file);
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

export class DiscordRpc {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private ready = false;
  private enabled = false;
  private connecting = false;
  private activity: DiscordActivity | null = null;
  private sentJson: string | null = null;
  private lastSend = 0;
  private sendTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private status: DiscordConnection = { state: 'disabled' };
  private readonly minInterval: number;
  private readonly retryMs: number;
  private readonly pipe: (index: number) => string;

  /** Wird bei jeder Änderung der Verbindung aufgerufen (für die Anzeige in den Einstellungen). */
  onStatus: (status: DiscordConnection) => void = () => undefined;

  constructor(
    private readonly clientId: string,
    private readonly log: (message: string) => void = () => undefined,
    options: DiscordRpcOptions = {},
  ) {
    this.minInterval = options.minIntervalMs ?? MIN_SEND_INTERVAL_MS;
    this.retryMs = options.retryMs ?? RETRY_MS;
    this.pipe = options.pipePath ?? pipePath;
  }

  get connection(): DiscordConnection {
    return this.status;
  }

  /** zuletzt gewünschter Status (null = keiner) */
  get current(): DiscordActivity | null {
    return this.activity;
  }

  /** Verbindet (und hält die Verbindung), bis stop() aufgerufen wird. */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    if (!this.clientId) {
      this.setStatus({ state: 'unconfigured' });
      return;
    }
    void this.connect();
  }

  /** Löscht den Status in Discord und trennt die Verbindung; fertig, sobald die Nachricht raus ist (höchstens 500 ms). */
  stop(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.enabled = false;
    let sent: Promise<void> = Promise.resolve();
    const socket = this.socket;
    if (this.ready && socket) {
      sent = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        timer.unref();
        socket.write(this.frame(OP_FRAME, JSON.stringify({ cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() })), () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.disconnect();
    this.setStatus({ state: 'disabled' });
    return sent;
  }

  /** Neuer Status (null = keiner). Wird gebündelt und erst bei bestehender Verbindung gesendet. */
  setActivity(activity: DiscordActivity | null): void {
    this.activity = activity;
    this.scheduleSend();
  }

  private setStatus(status: DiscordConnection): void {
    this.status = status;
    this.onStatus(status);
  }

  private async connect(): Promise<void> {
    if (!this.enabled || this.connecting || this.socket) return;
    this.connecting = true;
    // Beim erneuten Versuch bleibt die letzte Meldung (z. B. "Discord läuft nicht") stehen, damit nichts flackert
    if (this.status.state === 'disabled') this.setStatus({ state: 'connecting' });
    let socket: net.Socket | null = null;
    for (let i = 0; i < PIPES && !socket; i++) {
      socket = await openPipe(this.pipe(i)).catch(() => null);
    }
    this.connecting = false;
    if (!this.enabled) {
      socket?.destroy();
      return;
    }
    if (!socket) {
      this.setStatus({ state: 'unavailable' });
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      // eine ältere Verbindung (nach stop/start) meldet sich nicht mehr
      if (this.socket !== socket) return;
      const wasReady = this.ready;
      this.socket = null;
      this.ready = false;
      this.sentJson = null;
      if (!this.enabled) return;
      if (wasReady) this.log('Verbindung zu Discord getrennt');
      if (this.status.state !== 'error') this.setStatus({ state: 'unavailable' });
      this.scheduleRetry();
    });
    this.write(OP_HANDSHAKE, { v: 1, client_id: this.clientId });
  }

  private disconnect(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.sendTimer = null;
    this.retryTimer = null;
    this.ready = false;
    this.sentJson = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      // erst die letzte Nachricht rausschicken, dann schließen
      socket.end();
      setTimeout(() => socket.destroy(), 500).unref();
    }
  }

  private scheduleRetry(): void {
    if (!this.enabled || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.retryMs);
    this.retryTimer.unref();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > 1024 * 1024) {
        // kaputte Nachricht: Verbindung neu aufbauen
        this.socket?.destroy();
        return;
      }
      if (this.buffer.length < 8 + length) return;
      const body = this.buffer.subarray(8, 8 + length).toString('utf8');
      this.buffer = this.buffer.subarray(8 + length);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        continue;
      }
      this.handle(op, payload, body);
    }
  }

  private handle(op: number, payload: Record<string, unknown>, raw: string): void {
    if (op === OP_PING) {
      this.socket?.write(this.frame(OP_PONG, raw));
      return;
    }
    if (op === OP_CLOSE) {
      // z. B. { code: 4000, message: "Invalid Client ID" }
      const message = typeof payload.message === 'string' ? payload.message : 'Verbindung abgelehnt';
      this.log(`Discord hat die Verbindung beendet: ${message}`);
      this.setStatus({ state: 'error', message });
      return;
    }
    if (op !== OP_FRAME) return;
    if (payload.evt === 'READY') {
      this.ready = true;
      const data = payload.data as { user?: { global_name?: string; username?: string } } | undefined;
      const user = data?.user?.global_name ?? data?.user?.username ?? null;
      this.log(`Verbunden${user ? ` als ${user}` : ''}`);
      this.setStatus({ state: 'connected', user });
      // nach dem (Neu-)Verbinden sofort den aktuellen Stand
      if (this.sendTimer) clearTimeout(this.sendTimer);
      this.sendTimer = null;
      this.lastSend = 0;
      this.scheduleSend(true);
    } else if (payload.cmd === 'SET_ACTIVITY' && payload.evt == null) {
      this.log(payload.data ? 'Status gesetzt' : 'Status gelöscht');
    } else if (payload.evt === 'ERROR') {
      const data = payload.data as { message?: string } | undefined;
      this.log(`Fehler von Discord: ${data?.message ?? raw}`);
    }
  }

  private scheduleSend(immediate = false): void {
    if (this.sendTimer) return;
    const wait = immediate ? 0 : Math.max(Math.min(800, this.minInterval), this.lastSend + this.minInterval - Date.now());
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.flush();
    }, wait);
    this.sendTimer.unref();
  }

  private flush(): void {
    if (!this.ready || !this.socket) return;
    const json = JSON.stringify(this.activity);
    if (json === this.sentJson) return;
    const sinceLast = Date.now() - this.lastSend;
    if (sinceLast < this.minInterval) {
      this.scheduleSend();
      return;
    }
    this.write(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.activity }, nonce: randomUUID() });
    this.sentJson = json;
    this.lastSend = Date.now();
  }

  private frame(op: number, body: string): Buffer {
    const data = Buffer.from(body, 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(data.length, 4);
    return Buffer.concat([header, data]);
  }

  private write(op: number, payload: unknown): void {
    this.socket?.write(this.frame(op, JSON.stringify(payload)));
  }
}
