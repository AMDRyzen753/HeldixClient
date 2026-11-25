// Der Heldix-Dienst: HTTP-Schnittstelle (Version 1) und WebSocket.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { Challenges, hashToken, hasJoined, isLoopback, newToken, parseBearer } from './auth';
import { Store, type SettingsPatch, type UserRow } from './db';
import { Friends } from './friends';
import { HttpError, readJsonObject, rejectUpgrade, sendError, sendJson } from './http';
import { RateLimiter } from './limits';
import { Realtime } from './realtime';
import { DEFAULT_CAPES, isName, isUuid } from './validate';

export const DEFAULT_SESSION_SERVER = 'https://sessionserver.mojang.com';
/** Höchstgröße für Anfragekörper und WebSocket-Nachrichten. */
export const BODY_LIMIT = 16 * 1024;

export interface ServiceOptions {
  /** Ordner für die Datenbank. */
  dataDir: string;
  /** Basis-Adresse des Session-Servers (Standard: Mojang). */
  sessionServer?: string;
  /** Entwicklungsmodus: `POST /v1/auth/dev` (nur von diesem Rechner). */
  dev?: boolean;
  /** Erlaubte Cape-IDs (Standard: eingebaute Liste). */
  capes?: readonly string[];
  /** `X-Forwarded-For` auswerten (nur hinter einem eigenen Reverse-Proxy). */
  trustProxy?: boolean;
  /** Ausgabe für Meldungen (Standard: Konsole). */
  log?: (line: string) => void;

  // Zeiten und Grenzen; die Standardwerte entsprechen docs/dienst.md. Tests stellen sie kürzer.
  challengeTtlMs?: number;
  tokenTtlMs?: number;
  idleTimeoutMs?: number;
  rateWindowMs?: number;
  authRateLimit?: number;
  apiRateLimit?: number;
  wsMessageLimit?: number;
  mojangTimeoutMs?: number;
  maxConnectionsPerUser?: number;
  maxFriends?: number;
  maxOutgoingRequests?: number;
  maxLookup?: number;
  /** Abstand zum Aufräumen abgelaufener Tokens, Challenges und Zähler. */
  sweepIntervalMs?: number;
}

export interface Service {
  server: Server;
  close(): Promise<void>;
}

interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  params: string[];
  user: UserRow;
}

type Kind = 'public' | 'auth' | 'dev' | 'user';

interface Route {
  method: string;
  pattern: RegExp;
  kind: Kind;
  handler: (ctx: Context) => unknown;
}

/** Höchstens so viele gültige Tokens pro Spieler; ältere verfallen bei einer neuen Anmeldung. */
const TOKENS_PER_USER = 10;

export function createService(options: ServiceOptions): Service {
  const log = options.log ?? ((line: string) => console.log(line));
  const sessionServer = options.sessionServer ?? DEFAULT_SESSION_SERVER;
  const dev = options.dev === true;
  const trustProxy = options.trustProxy === true;
  const capes = new Set(options.capes ?? DEFAULT_CAPES);
  const challengeTtlMs = options.challengeTtlMs ?? 60_000;
  const tokenTtlMs = options.tokenTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 90_000;
  const rateWindowMs = options.rateWindowMs ?? 60_000;
  const mojangTimeoutMs = options.mojangTimeoutMs ?? 10_000;
  const maxConnectionsPerUser = options.maxConnectionsPerUser ?? 10;
  const maxLookup = options.maxLookup ?? 200;

  if (dev) {
    const bar = '!'.repeat(78);
    log(
      [
        bar,
        '!!! ACHTUNG: ENTWICKLUNGSMODUS (HELDIX_DIENST_DEV=1)',
        '!!! POST /v1/auth/dev meldet JEDEN beliebigen Spieler OHNE Mojang an',
        '!!! (nur von 127.0.0.1 oder ::1). Nur für automatische Tests!',
        '!!! Niemals so öffentlich betreiben.',
        bar,
      ].join('\n'),
    );
  }

  const store = new Store(options.dataDir);
  const challenges = new Challenges(challengeTtlMs);
  const authLimiter = new RateLimiter(options.authRateLimit ?? 20, rateWindowMs);
  const apiLimiter = new RateLimiter(options.apiRateLimit ?? 120, rateWindowMs);
  const realtime = new Realtime(store, {
    idleTimeoutMs,
    messageLimit: options.wsMessageLimit ?? 120,
    messageWindowMs: rateWindowMs,
    log,
  });
  const friends = new Friends(store, realtime, {
    maxFriends: options.maxFriends ?? 200,
    maxOutgoing: options.maxOutgoingRequests ?? 50,
  });

  let closed = false;
  let closing: Promise<void> | undefined;

  // ---------- Hilfen ----------

  /** IP für die Begrenzung der Anmeldung. `X-Forwarded-For` nur mit trustProxy (letzter Eintrag = vom eigenen Proxy gesetzt). */
  function clientIp(req: IncomingMessage): string {
    if (trustProxy) {
      const header = req.headers['x-forwarded-for'];
      const value = Array.isArray(header) ? header.join(',') : header;
      const parts = (value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');
      if (parts.length > 0) return parts[parts.length - 1]!;
    }
    return req.socket.remoteAddress ?? 'unbekannt';
  }

  function rateLimit(limiter: RateLimiter, key: string): void {
    const result = limiter.take(key);
    if (!result.ok) {
      throw new HttpError(429, 'Zu viele Anfragen. Bitte kurz warten.', { 'Retry-After': String(result.retryAfter) });
    }
  }

  /** Prüft `Authorization: Bearer <token>`; liefert Spieler und Token-Hash oder wirft 401. */
  function authenticate(req: IncomingMessage): { user: UserRow; tokenHash: string } {
    const token = parseBearer(req.headers.authorization);
    if (token !== null) {
      const tokenHash = hashToken(token);
      const uuid = store.findTokenOwner(tokenHash, Date.now());
      const user = uuid === undefined ? undefined : store.getUser(uuid);
      if (user) return { user, tokenHash };
    }
    throw new HttpError(401, 'Nicht angemeldet oder Anmeldung abgelaufen. Bitte neu anmelden.');
  }

  function issueToken(uuid: string, name: string) {
    const now = Date.now();
    const user = store.upsertUser(uuid, name, now);
    const token = newToken();
    const expiresAt = now + tokenTtlMs;
    store.insertToken(hashToken(token), user.uuid, now, expiresAt, TOKENS_PER_USER);
    return { token, uuid: user.uuid, name: user.name, expiresAt };
  }

  function me(user: UserRow) {
    return {
      uuid: user.uuid,
      name: user.name,
      cape: capes.has(user.cape) ? user.cape : '',
      visible: user.visible,
      presence: user.presence,
      showServer: user.showServer,
    };
  }

  function uuidParam(value: string | undefined): string {
    if (!isUuid(value)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
    return value;
  }

  const body = (ctx: Context) => readJsonObject(ctx.req, BODY_LIMIT);

  // ---------- Endpunkte ----------

  async function login(ctx: Context) {
    const { name, serverId } = await body(ctx);
    if (!isName(name)) throw new HttpError(400, 'Ungültiger Spielername.');
    if (typeof serverId !== 'string' || !/^[0-9a-f]{40}$/.test(serverId)) {
      throw new HttpError(400, 'Ungültige serverId.');
    }
    if (!challenges.consume(serverId)) {
      throw new HttpError(401, 'Die Anmeldung ist abgelaufen. Bitte erneut versuchen.');
    }
    const profile = await hasJoined(sessionServer, name, serverId, mojangTimeoutMs);
    if (!profile) throw new HttpError(401, 'Anmeldung bei Mojang fehlgeschlagen.');
    return issueToken(profile.uuid, profile.name);
  }

  async function devLogin(ctx: Context) {
    const { name, uuid } = await body(ctx);
    if (!isName(name)) throw new HttpError(400, 'Ungültiger Spielername.');
    if (!isUuid(uuid)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
    return issueToken(uuid, name);
  }

  async function updateMe(ctx: Context) {
    const input = await body(ctx);
    const patch: SettingsPatch = {};
    if (Object.hasOwn(input, 'cape')) {
      const cape = input.cape;
      if (typeof cape !== 'string' || (cape !== '' && !capes.has(cape))) throw new HttpError(400, 'Unbekanntes Cape.');
      patch.cape = cape;
    }
    for (const key of ['visible', 'presence', 'showServer'] as const) {
      if (!Object.hasOwn(input, key)) continue;
      const value = input[key];
      if (typeof value !== 'boolean') throw new HttpError(400, `„${key}“ muss true oder false sein.`);
      patch[key] = value;
    }
    const before = realtime.snapshot(ctx.user.uuid);
    store.updateSettings(ctx.user.uuid, patch);
    // presence oder showServer geändert: Freunde sehen das sofort.
    realtime.announce(ctx.user.uuid, before);
    return me(store.getUser(ctx.user.uuid)!);
  }

  /** `DELETE /v1/me`: alles löschen, was der Dienst über den Spieler gespeichert hat (DSGVO). */
  function deleteMe(ctx: Context) {
    const { uuid } = ctx.user;
    const related = store.deleteUser(uuid);
    realtime.disconnectUser(uuid, 4001, 'Konto gelöscht');
    // Frühere Freunde und Spieler mit offenen Anfragen sehen die neue Liste sofort.
    for (const other of related) realtime.pushFriends(other);
    return { deleted: true };
  }

  async function lookup(ctx: Context) {
    const { uuids } = await body(ctx);
    if (!Array.isArray(uuids)) throw new HttpError(400, '„uuids“ muss eine Liste sein.');
    if (uuids.length > maxLookup) throw new HttpError(400, `Höchstens ${maxLookup} UUIDs pro Abfrage.`);
    for (const uuid of uuids) uuidParam(uuid);
    // Nur wer gerade verbunden ist, kommt überhaupt in Frage.
    const connected = [...new Set(uuids as string[])].filter((uuid) => realtime.isConnected(uuid));
    const players: Record<string, { cape: string }> = {};
    for (const user of store.getUsers(connected)) {
      if (user.visible) players[user.uuid] = { cape: capes.has(user.cape) ? user.cape : '' };
    }
    return { players };
  }

  async function sendRequest(ctx: Context) {
    const { name } = await body(ctx);
    if (!isName(name)) throw new HttpError(400, 'Ungültiger Spielername.');
    return friends.request(ctx.user, name);
  }

  const routes: Route[] = [
    { method: 'GET', pattern: /^\/health$/, kind: 'public', handler: () => ({ ok: true }) },
    { method: 'POST', pattern: /^\/v1\/auth\/challenge$/, kind: 'auth', handler: () => ({ serverId: challenges.issue() }) },
    { method: 'POST', pattern: /^\/v1\/auth\/login$/, kind: 'auth', handler: login },
    { method: 'POST', pattern: /^\/v1\/auth\/dev$/, kind: 'dev', handler: devLogin },
    { method: 'GET', pattern: /^\/v1\/me$/, kind: 'user', handler: (ctx) => me(ctx.user) },
    { method: 'PUT', pattern: /^\/v1\/me$/, kind: 'user', handler: updateMe },
    { method: 'DELETE', pattern: /^\/v1\/me$/, kind: 'user', handler: deleteMe },
    { method: 'POST', pattern: /^\/v1\/players\/lookup$/, kind: 'user', handler: lookup },
    { method: 'GET', pattern: /^\/v1\/friends$/, kind: 'user', handler: (ctx) => friends.list(ctx.user.uuid) },
    { method: 'POST', pattern: /^\/v1\/friends\/requests$/, kind: 'user', handler: sendRequest },
    {
      method: 'POST',
      pattern: /^\/v1\/friends\/requests\/([^/]+)\/accept$/,
      kind: 'user',
      handler: (ctx) => friends.accept(ctx.user, uuidParam(ctx.params[0])),
    },
    {
      method: 'DELETE',
      pattern: /^\/v1\/friends\/requests\/([^/]+)$/,
      kind: 'user',
      handler: (ctx) => friends.removeRequest(ctx.user, uuidParam(ctx.params[0])),
    },
    {
      method: 'DELETE',
      pattern: /^\/v1\/friends\/([^/]+)$/,
      kind: 'user',
      handler: (ctx) => friends.removeFriend(ctx.user, uuidParam(ctx.params[0])),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/ws$/,
      kind: 'public',
      handler: () => {
        throw new HttpError(426, 'Dieser Weg ist nur per WebSocket erreichbar.', { Upgrade: 'websocket' });
      },
    },
  ];

  function pathOf(req: IncomingMessage): string {
    try {
      return new URL(req.url ?? '/', 'http://heldix.invalid').pathname;
    } catch {
      return '/';
    }
  }

  function devAllowed(req: IncomingMessage): boolean {
    // Bewusst die echte Gegenstelle, nie X-Forwarded-For. Kommt die Anfrage erkennbar über einen
    // Proxy auf diesem Rechner (der dann als 127.0.0.1 erscheint), gibt es den Weg ebenfalls nicht.
    const proxied = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'via'].some((name) => req.headers[name] !== undefined);
    return dev && isLoopback(req.socket.remoteAddress) && !proxied;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = pathOf(req);
    const matching = routes.filter((route) => route.pattern.test(path) && (route.kind !== 'dev' || devAllowed(req)));
    if (matching.length === 0) throw new HttpError(404, 'Nicht gefunden.');
    const route = matching.find((r) => r.method === req.method);
    if (!route) {
      throw new HttpError(405, 'Diese Methode ist hier nicht erlaubt.', {
        Allow: [...new Set(matching.map((r) => r.method))].join(', '),
      });
    }
    const params = route.pattern.exec(path)!.slice(1);
    let user: UserRow | undefined;
    if (route.kind === 'auth' || route.kind === 'dev') {
      rateLimit(authLimiter, clientIp(req));
    } else if (route.kind === 'user') {
      const auth = authenticate(req);
      rateLimit(apiLimiter, auth.tokenHash);
      user = auth.user;
    }
    const result = await route.handler({ req, res, params, user: user! });
    sendJson(res, 200, result);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        sendError(res, err);
      } else {
        log(`Interner Fehler bei ${req.method} ${pathOf(req)}: ${(err as Error)?.stack ?? String(err)}`);
        sendError(res, new HttpError(500, 'Interner Fehler im Heldix-Dienst.'));
      }
    });
  });
  // Langsame oder hängende Clients nicht ewig festhalten.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: BODY_LIMIT, clientTracking: false });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    try {
      if (pathOf(req) !== '/v1/ws') throw new HttpError(404, 'Nicht gefunden.');
      if (req.method !== 'GET') throw new HttpError(405, 'Diese Methode ist hier nicht erlaubt.', { Allow: 'GET' });
      const { user, tokenHash } = authenticate(req);
      rateLimit(apiLimiter, tokenHash);
      if (realtime.connectionCount(user.uuid) >= maxConnectionsPerUser) {
        throw new HttpError(429, 'Zu viele gleichzeitige Verbindungen.', { 'Retry-After': '30' });
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (closed) {
          ws.terminate();
          return;
        }
        try {
          realtime.attach(ws, user.uuid);
        } catch (err) {
          log(`Fehler beim Verbinden: ${(err as Error)?.stack ?? String(err)}`);
          ws.terminate();
        }
      });
    } catch (err) {
      if (err instanceof HttpError) {
        rejectUpgrade(socket, err);
      } else {
        log(`Interner Fehler beim WebSocket-Aufbau: ${(err as Error)?.stack ?? String(err)}`);
        rejectUpgrade(socket, new HttpError(500, 'Interner Fehler im Heldix-Dienst.'));
      }
    }
  });

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    challenges.sweep(now);
    authLimiter.sweep(now);
    apiLimiter.sweep(now);
    try {
      store.deleteExpiredTokens(now);
    } catch (err) {
      log(`Aufräumen fehlgeschlagen: ${(err as Error).message}`);
    }
  }, options.sweepIntervalMs ?? 10 * 60_000);
  sweepTimer.unref();

  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    clearInterval(sweepTimer);
    realtime.closeAll();
    closing = new Promise<void>((resolve) => {
      wss.close();
      server.close(() => {
        store.close();
        resolve();
      });
      server.closeAllConnections();
    });
    return closing;
  }

  return { server, close };
}
