// Hilfen für die Tests von Welt teilen: Gastgeber (Steuerverbindung und Datenströme) und ein kleiner Test-Client, der
// über TCP wie Minecraft Handshake, Status, Ping und Login Start schickt. Die Pakete baut er selbst (unabhängig von
// src/minecraft-protocol.ts), damit Fehler in der Kodierung nicht auf beiden Seiten gleich sind.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { WebSocket } from 'ws';
import { api, WsClient, type Player, type TestService } from './helpers';

export const DOMAIN = 'welt.test';
/** Protokollnummer, wie sie ein Minecraft-Client schicken könnte. */
export const PROTOCOL = 775;

export function varInt(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value >>> 0;
  for (;;) {
    if ((rest & ~0x7f) === 0) {
      bytes.push(rest);
      return Buffer.from(bytes);
    }
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
}

export function mcString(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([varInt(bytes.length), bytes]);
}

export function packet(id: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat([varInt(id), ...parts]);
  return Buffer.concat([varInt(body.length), body]);
}

export function handshake(address: string, next: 1 | 2 | 3, protocol = PROTOCOL, port = 25565): Buffer {
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  return packet(0x00, varInt(protocol), mcString(address), portBytes, varInt(next));
}

/** Login Start wie ab 1.20.2: Name und UUID (16 Byte). */
export function loginStart(name: string): Buffer {
  return packet(0x00, mcString(name), randomBytes(16));
}

export const STATUS_REQUEST = packet(0x00);

export function pingPacket(payload: Buffer): Buffer {
  return packet(0x01, payload);
}

/** VarInt lesen (Test-Seite). */
function readVarInt(buf: Buffer, offset: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const byte = buf[offset + i]!;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 };
  }
  throw new Error('VarInt zu lang');
}

/** Text aus einem Paket (VarInt-Länge und UTF-8). */
export function readString(data: Buffer): string {
  const length = readVarInt(data, 0)!;
  return data.toString('utf8', length.next, length.next + length.value);
}

/** Test-Client wie Minecraft: TCP zum Relay, sammelt alles, was ankommt. */
export class McClient {
  private buffer = Buffer.alloc(0);
  private wakers: (() => void)[] = [];
  isClosed = false;
  readonly closed: Promise<void>;

  constructor(readonly socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake();
    });
    socket.on('error', () => {
      // Danach folgt 'close'.
    });
    this.closed = new Promise((resolve) =>
      socket.on('close', () => {
        this.isClosed = true;
        this.wake();
        resolve();
      }),
    );
  }

  static connect(port: number): Promise<McClient> {
    const socket = net.connect({ port, host: '127.0.0.1', noDelay: true });
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(new McClient(socket)));
      socket.once('error', reject);
    });
  }

  write(...parts: Buffer[]): void {
    this.socket.write(Buffer.concat(parts));
  }

  /** Alles bisher Angekommene (ohne es zu verbrauchen). */
  received(): Buffer {
    return this.buffer;
  }

  private wake(): void {
    const wakers = this.wakers;
    this.wakers = [];
    for (const wake of wakers) wake();
  }

  private async until(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`${what}: nicht rechtzeitig (bisher ${this.buffer.length} Byte, geschlossen: ${this.isClosed})`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wakers.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Genau n Byte (verbraucht sie). */
  async bytes(n: number, timeoutMs = 3000): Promise<Buffer> {
    await this.until(() => this.buffer.length >= n, timeoutMs, `${n} Byte`);
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  /** Nächstes ganzes Paket (verbraucht es). */
  async packet(timeoutMs = 3000): Promise<{ id: number; data: Buffer }> {
    const box: { found: { id: number; data: Buffer; end: number } | null } = { found: null };
    await this.until(
      () => {
        box.found = this.peekPacket();
        return box.found !== null || this.isClosed;
      },
      timeoutMs,
      'Paket',
    );
    const found = box.found;
    if (found === null) throw new Error('Verbindung geschlossen, bevor ein ganzes Paket kam');
    this.buffer = this.buffer.subarray(found.end);
    return { id: found.id, data: found.data };
  }

  private peekPacket(): { id: number; data: Buffer; end: number } | null {
    const length = readVarInt(this.buffer, 0);
    if (length === null || this.buffer.length < length.next + length.value) return null;
    const body = this.buffer.subarray(length.next, length.next + length.value);
    const id = readVarInt(body, 0)!;
    return { id: id.value, data: body.subarray(id.next), end: length.next + length.value };
  }

  /** Nächstes Paket mit JSON-Text (Status-Antwort, Disconnect). */
  async json(expectedId = 0x00, timeoutMs = 3000): Promise<any> {
    const { id, data } = await this.packet(timeoutMs);
    assert.equal(id, expectedId);
    return JSON.parse(readString(data));
  }

  /** Text des Disconnect-Pakets beim Login; danach schließt der Dienst. */
  async disconnectText(timeoutMs = 3000): Promise<string> {
    const message = await this.json(0x00, timeoutMs);
    await this.waitClosed(timeoutMs);
    return message.text;
  }

  async waitClosed(timeoutMs = 3000): Promise<void> {
    await this.until(() => this.isClosed, timeoutMs, 'Schließen');
  }

  destroy(): void {
    this.socket.destroy();
  }
}

/** Datenstrom aus Sicht des Gastgebers (binär). */
export class StreamClient {
  private buffer = Buffer.alloc(0);
  private wakers: (() => void)[] = [];
  /** jede Binärnachricht einzeln (die erste muss die gepufferten Bytes enthalten) */
  readonly frames: Buffer[] = [];
  readonly closed: Promise<number>;
  isClosed = false;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      this.frames.push(data as Buffer);
      this.buffer = Buffer.concat([this.buffer, data as Buffer]);
      this.wake();
    });
    this.closed = new Promise((resolve) =>
      ws.on('close', (code) => {
        this.isClosed = true;
        this.wake();
        resolve(code);
      }),
    );
  }

  private wake(): void {
    const wakers = this.wakers;
    this.wakers = [];
    for (const wake of wakers) wake();
  }

  /** Genau n Byte (verbraucht sie). */
  async bytes(n: number, timeoutMs = 3000): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < n) {
      const left = deadline - Date.now();
      if (left <= 0 || this.isClosed) throw new Error(`Datenstrom: ${n} Byte nicht rechtzeitig (bisher ${this.buffer.length})`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wakers.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  received(): Buffer {
    return this.buffer;
  }

  send(data: Buffer): void {
    this.ws.send(data, { binary: true });
  }

  close(): Promise<number> {
    if (!this.isClosed) this.ws.close();
    return this.closed;
  }
}

function wsBase(service: TestService): string {
  return service.url.replace('http', 'ws');
}

/** Steuerverbindung des Gastgebers (ohne auf eine Nachricht zu warten). */
export async function hostConnect(service: TestService, token: string): Promise<WsClient> {
  const ws = new WebSocket(`${wsBase(service)}/v1/worlds/host`, { headers: { Authorization: `Bearer ${token}` } });
  const client = new WsClient(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return client;
}

/** Datenstrom öffnen (wie der Client nach `stream`). */
export async function openStream(service: TestService, token: string, id: string): Promise<StreamClient> {
  const ws = new WebSocket(`${wsBase(service)}/v1/worlds/streams/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const client = new StreamClient(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return client;
}

export async function createWorld(service: TestService, player: Player, body: unknown = {}): Promise<any> {
  const res = await api(service.url, 'POST', '/v1/worlds', { token: player.token, body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

/** Welt öffnen; liefert `ready`. Danach liegt `members` im Puffer. */
export async function openWorld(host: WsClient, world: string, extra: Record<string, unknown> = {}): Promise<any> {
  host.send({ type: 'open', world, version: '26.3', protocol: PROTOCOL, motd: 'Hallo aus der Welt', lanReady: true, ...extra });
  return host.next('ready');
}
