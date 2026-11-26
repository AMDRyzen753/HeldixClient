// Hilfen für die Tests: nachgebauter Mojang-Session-Server, Dienst auf Port 0, HTTP- und WebSocket-Client.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createService, type ServiceOptions } from '../src/app';

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

export interface FakeAnswer {
  status?: number;
  body?: unknown;
}

/** Nachgebauter Session-Server: beantwortet hasJoined nur für bekannte Paare aus Name und serverId. */
export interface FakeMojang {
  url: string;
  /** Simuliert den Beitritt eines Clients (`session/minecraft/join`). */
  join(name: string, serverId: string, uuid: string, answer?: FakeAnswer): void;
  /** Alle hasJoined-Abfragen (roh, wie angekommen). */
  requests: string[];
  close(): Promise<void>;
}

export async function startFakeMojang(): Promise<FakeMojang> {
  const joins = new Map<string, FakeAnswer>();
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    const url = new URL(req.url ?? '/', 'http://fake');
    if (req.method !== 'GET' || url.pathname !== '/session/minecraft/hasJoined') {
      res.writeHead(404).end();
      return;
    }
    const key = `${(url.searchParams.get('username') ?? '').toLowerCase()}|${url.searchParams.get('serverId') ?? ''}`;
    const answer = joins.get(key);
    if (!answer) {
      // So antwortet Mojang, wenn der Spieler nicht beigetreten ist.
      res.writeHead(204).end();
      return;
    }
    const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
    res.writeHead(answer.status ?? 200, { 'Content-Type': 'application/json' }).end(text);
  });
  const url = await listen(server);
  return {
    url,
    requests,
    join(name, serverId, uuid, answer) {
      joins.set(`${name.toLowerCase()}|${serverId}`, answer ?? { status: 200, body: { id: uuid, name, properties: [] } });
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export interface TestService {
  url: string;
  wsUrl: string;
  logs: string[];
  dataDir: string;
  close(): Promise<void>;
}

/** Startet den Dienst auf einem freien Port mit eigenem, temporärem Datenordner. */
export async function startService(options: Partial<ServiceOptions> = {}): Promise<TestService> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-test-'));
  const logs: string[] = [];
  const service = createService({
    dataDir,
    sessionServer: 'http://127.0.0.1:9', // ohne eigenen Fake: nie erreichbar
    log: (line) => logs.push(line),
    authRateLimit: 1000,
    apiRateLimit: 1000,
    messageRateLimit: 1000,
    downloadRateLimit: 1000,
    webLinkRateLimit: 1000,
    webMicrosoftRateLimit: 1000,
    totpRateLimit: 1000,
    exportRateLimit: 1000,
    skinRateLimit: 1000,
    ...options,
  });
  const url = await listen(service.server);
  return {
    url,
    wsUrl: `${url.replace('http', 'ws')}/v1/ws`,
    logs,
    dataDir,
    async close() {
      await service.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface ApiResponse {
  status: number;
  body: any;
  headers: Headers;
}

export async function api(
  base: string,
  method: string,
  pathname: string,
  options: { token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  let body: string | undefined = options.rawBody;
  // GET und HEAD haben keinen Körper.
  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(base + pathname, { method, headers, body });
  const text = await res.text();
  return { status: res.status, body: text === '' ? undefined : JSON.parse(text), headers: res.headers };
}

export function randomUuid(): string {
  return randomBytes(16).toString('hex');
}

export interface Player {
  uuid: string;
  name: string;
  token: string;
}

let playerCounter = 0;

/** Meldet einen Spieler über den Entwicklungsweg an (Dienst muss mit dev: true laufen). */
export async function devPlayer(base: string, name?: string): Promise<Player> {
  const player = { uuid: randomUuid(), name: name ?? `Spieler${++playerCounter}` };
  const res = await api(base, 'POST', '/v1/auth/dev', { body: player });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { ...player, token: res.body.token };
}

type Message = any;

/** WebSocket-Client, der alle Nachrichten sammelt. */
export class WsClient {
  readonly messages: Message[] = [];
  private waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const message = JSON.parse(String(data));
      const index = this.waiters.findIndex((w) => w.match(message));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        waiter!.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })));
  }

  /** Nächste passende Nachricht (aus dem Puffer oder abwarten). */
  next(match: string | ((m: Message) => boolean), timeoutMs = 3000): Promise<Message> {
    const fn = typeof match === 'string' ? (m: Message) => m.type === match : match;
    const index = this.messages.findIndex(fn);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        match: fn,
        resolve: (m: Message) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Keine passende Nachricht erhalten. Gepuffert: ${JSON.stringify(this.messages)}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Ping-Pong-Runde. Danach liegen alle Nachrichten im Puffer, die der Dienst vorher an diese
   * Verbindung geschickt hat (eine Verbindung behält die Reihenfolge).
   */
  async sync(): Promise<void> {
    this.send({ type: 'ping' });
    await this.next('pong');
  }

  /** Entfernt gepufferte Nachrichten. */
  drain(): Message[] {
    return this.messages.splice(0, this.messages.length);
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close();
    await this.closed;
  }
}

/** Baut eine WebSocket-Verbindung auf und wartet auf die erste `friends`-Nachricht. */
export async function connect(wsUrl: string, token: string): Promise<{ client: WsClient; friends: Message }> {
  const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });
  const client = new WsClient(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  const friends = await client.next('friends');
  return { client, friends };
}

/** Versucht eine WebSocket-Verbindung und liefert den HTTP-Status der Ablehnung. */
export function upgradeStatus(wsUrl: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers });
    ws.once('open', () => {
      ws.terminate();
      reject(new Error('Verbindung wurde unerwartet angenommen.'));
    });
    ws.once('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    ws.on('error', () => {
      // Folgt nach unexpected-response; der Status ist dann schon gemeldet.
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wiederholt `check`, bis es true liefert (für Dinge, die der Dienst nach dem Trennen erledigt). */
export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Bedingung nicht rechtzeitig erfüllt.');
    await sleep(10);
  }
}

/** Macht zwei Spieler zu Freunden (a fragt an, b nimmt an). */
export async function befriend(base: string, a: Player, b: Player): Promise<void> {
  const sent = await api(base, 'POST', '/v1/friends/requests', { token: a.token, body: { name: b.name } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const accepted = await api(base, 'POST', `/v1/friends/requests/${a.uuid}/accept`, { token: b.token });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * HTTP-Anfrage ohne fetch: Der Pfad geht genau so raus (kein Auflösen von `..`), Weiterleitungen
 * werden nicht verfolgt, HEAD-Antworten bleiben ohne Körper.
 */
export function rawRequest(base: string, method: string, pathname: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: url.hostname, port: url.port, method, path: pathname, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

export interface RawResult {
  status: number;
  body: any;
  headers: IncomingHttpHeaders;
}

/**
 * Roher Upload mit node:http. Mit `declared` (größer als die Daten) wird nur angekündigt und nicht zu Ende gesendet:
 * So antwortet der Dienst mit 413, ohne dass der Client mitten im Senden getrennt wird.
 */
export function rawUpload(base: string, method: string, pathname: string, data: Buffer, headers: Record<string, string>, declared?: number): Promise<RawResult> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    let answered = false;
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        method,
        path: pathname,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(declared ?? data.length), ...headers },
      },
      (res) => {
        answered = true;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, body: text === '' ? undefined : JSON.parse(text), headers: res.headers });
          if (declared !== undefined) req.destroy();
        });
      },
    );
    req.on('error', (err) => {
      if (!answered) reject(err);
    });
    if (declared !== undefined && declared > data.length) req.write(data);
    else req.end(data);
  });
}
