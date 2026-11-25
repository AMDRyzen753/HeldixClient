// Der Heldix-Dienst: HTTP-Schnittstelle (Version 1) und WebSocket.
import { createPublicKey, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { exportData, myReports } from './account';
import { Challenges, hashToken, hasJoined, isLoopback, newToken, parseBearer } from './auth';
import { Blocks } from './blocks';
import { Store, type SettingsPatch, type TeamMemberRow, type TeamRole, type UserRow, type WebSessionRow } from './db';
import { Friends } from './friends';
import { HttpError, readJsonObject, rejectUpgrade, sendError, sendJson } from './http';
import { RateLimiter } from './limits';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Messages } from './messages';
import { Realtime } from './realtime';
import { Reports } from './reports';
import { DEFAULT_SKIN_HOSTS, Skins } from './skins';
import { Support } from './support';
import { playerLabel, Team, writeAudit, type Actor } from './team';
import { MAX_SETUP_SIZE, NOTHING_PUBLISHED, Updates } from './updates';
import { DEFAULT_CAPES, isName, isUuid } from './validate';
import { checkCsrf, checkOrigin, clearSessionCookie, NOT_SIGNED_IN, readSessionCookie, Web, type WebAuth } from './web';

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
  /** Ordner mit Launcher-Installern und update.json (Standard: `<dataDir>/updates`). */
  updatesDir?: string;
  /** Adresse der Webseite (Origin, z. B. `https://heldixclient.com`); ohne: keine Anmeldung auf der Webseite (503). */
  website?: string | null;
  /** Öffentlicher Update-Schlüssel (Ed25519, PEM); ohne: kein Veröffentlichen im Team-Bereich (503). */
  updateKey?: string | null;
  /** Uhr für die 2FA-Codes (nur Tests stellen sie). */
  totpNow?: () => number;

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
  /** Nachrichten pro Absender und Zeitraum (rateWindowMs). */
  messageRateLimit?: number;
  /** Höchstens so viele Nachrichten pro Unterhaltung; ältere werden gelöscht. */
  maxConversationMessages?: number;
  /** Nachrichten werden nach dieser Zeit gelöscht. */
  messageTtlMs?: number;
  maxBlocks?: number;
  /** Meldungen pro Meldendem und Zeitraum (reportWindowMs); dazu höchstens eine pro gemeldetem Spieler. */
  reportLimit?: number;
  reportWindowMs?: number;
  /** Meldungen werden nach dieser Zeit gelöscht. */
  reportTtlMs?: number;
  /** Downloads von Launcher-Installern pro IP und Zeitraum (rateWindowMs). */
  downloadRateLimit?: number;
  /** Kommt so lange nichts beim Client an, wird ein Download abgebrochen. */
  downloadIdleTimeoutMs?: number;
  /** Web-Anmeldung: Einmal-Code, Sitzung (ab Anmeldung, ohne Nutzung), 2FA-Bestätigung der Sitzung. */
  webCodeTtlMs?: number;
  webSessionTtlMs?: number;
  webSessionIdleMs?: number;
  teamVerifyTtlMs?: number;
  /** Einmal-Links pro Spieler und Zeitraum (rateWindowMs). */
  webLinkRateLimit?: number;
  /** 2FA-Versuche pro Spieler und Zeitraum (totpWindowMs). */
  totpRateLimit?: number;
  totpWindowMs?: number;
  /** Datenexporte pro Spieler und Zeitraum (exportWindowMs). */
  exportRateLimit?: number;
  exportWindowMs?: number;
  /** Einträge im Protokoll des Teams werden nach dieser Zeit gelöscht. */
  auditTtlMs?: number;
  /** Größter Upload eines Installers im Team-Bereich und Abbruch, wenn so lange nichts ankommt. */
  maxUploadBytes?: number;
  uploadIdleTimeoutMs?: number;
  /** Erlaubte Hosts für Skin-Dateien der Teamseite (Standard: textures.minecraft.net) und Zeitgrenze pro Abfrage. */
  skinHosts?: readonly string[];
  skinTimeoutMs?: number;
  /** Support: nicht geschlossene Anfragen pro Spieler, neue pro 24 Stunden, Nachrichten pro Stunde. */
  supportMaxOpen?: number;
  supportDailyLimit?: number;
  supportHourlyMessages?: number;
  /** Support: geschlossene Anfragen nach dem Schließen, andere nach der letzten Nachricht löschen. */
  supportClosedTtlMs?: number;
  supportIdleTtlMs?: number;
  /** Abstand zum Aufräumen abgelaufener Tokens, Challenges, Nachrichten, Meldungen, Sitzungen und Zähler. */
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
  /** Web-Sitzung, wenn über das Cookie angemeldet */
  session?: WebSessionRow;
  /** Team-Mitglied (nur bei Team-Routen) */
  member?: TeamMemberRow;
}

/**
 * Wer eine Route benutzen darf: `public` alle, `auth`/`dev` Anmeldung (Grenze pro IP), `user` Bearer-Token oder
 * Cookie, `bearer` nur Bearer-Token (Launcher, Spiel), `web` nur Cookie (Webseite), `team` Cookie mit Team-Rolle und 2FA.
 */
type Kind = 'public' | 'auth' | 'dev' | 'user' | 'bearer' | 'web' | 'team';

/** Angemeldet über Bearer-Token oder Cookie; `key` zählt für die Begrenzung der Anfragen. */
interface Auth {
  user: UserRow;
  key: string;
  session?: WebSessionRow;
}

/** Rückgabe eines Endpunkts, der seine Antwort selbst geschrieben hat (Dateien, Weiterleitungen, eigene Header). */
const RESPONDED = Symbol('beantwortet');

interface Route {
  method: string;
  pattern: RegExp;
  kind: Kind;
  /** Mindestrolle für Team-Routen (Standard: moderator) */
  role?: TeamRole;
  handler: (ctx: Context) => unknown;
}

/** Wege ohne Anmeldung, die auch andere Seiten abfragen dürfen: CORS für alle Antworten, auch Fehler. */
function isPublicPath(path: string): boolean {
  return path.startsWith('/v1/launcher/') || path.startsWith('/v1/public/') || path === '/v1/news' || path === '/v1/status';
}

/** Version des Dienstes aus package.json (liegt je nach Start eine bis drei Ebenen über dieser Datei). */
function readServiceVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
      if (pkg.name === 'heldix-dienst' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // weiter oben suchen
    }
    dir = dirname(dir);
  }
  return 'unbekannt';
}

/** Gezählte Spieler für /v1/status höchstens so lange zwischenspeichern (wie Cache-Control). */
const STATUS_CACHE_MS = 30_000;

/**
 * Grenze für den ganzen Empfang einer Anfrage. Sie ist lang, weil Installer (bis 1 GiB) im Team-Bereich hochgeladen
 * werden; JSON-Körper haben eine eigene, kurze Grenze (readJsonObject), Uploads brechen ab, wenn nichts mehr ankommt.
 */
const REQUEST_TIMEOUT_MS = 6 * 60 * 60 * 1000;

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
  const messageTtlMs = options.messageTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  const reportTtlMs = options.reportTtlMs ?? 90 * 24 * 60 * 60 * 1000;
  const downloadIdleTimeoutMs = options.downloadIdleTimeoutMs ?? 120_000;
  const updatesDir = options.updatesDir ?? join(options.dataDir, 'updates');
  const website = options.website ? new URL(options.website).origin : null;
  const auditTtlMs = options.auditTtlMs ?? 365 * 24 * 60 * 60 * 1000;
  let updateKey: KeyObject | null = null;
  if (options.updateKey) {
    updateKey = createPublicKey(options.updateKey);
    if (updateKey.asymmetricKeyType !== 'ed25519') throw new Error('Der Update-Schlüssel muss ein öffentlicher Ed25519-Schlüssel sein.');
  }

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
  const messageLimiter = new RateLimiter(options.messageRateLimit ?? 20, rateWindowMs);
  const downloadLimiter = new RateLimiter(options.downloadRateLimit ?? 30, rateWindowMs);
  const linkLimiter = new RateLimiter(options.webLinkRateLimit ?? 10, rateWindowMs);
  const totpLimiter = new RateLimiter(options.totpRateLimit ?? 5, options.totpWindowMs ?? 10 * 60_000);
  const exportLimiter = new RateLimiter(options.exportRateLimit ?? 5, options.exportWindowMs ?? 60 * 60_000);
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
  const messages = new Messages(store, realtime, {
    limiter: messageLimiter,
    maxPerConversation: options.maxConversationMessages ?? 500,
  });
  const blocks = new Blocks(store, realtime, options.maxBlocks ?? 500);
  const reports = new Reports(
    store,
    { perReporter: options.reportLimit ?? 10, windowMs: options.reportWindowMs ?? 24 * 60 * 60 * 1000 },
    log,
  );
  const startedAt = Date.now();
  const serviceVersion = readServiceVersion();
  /** Versionsverlauf: jede veröffentlichte Version einmal (Upload per scp oder Team-Bereich). */
  const recordVersion = (published: { manifest: string; version: string }) => {
    try {
      const manifest = JSON.parse(published.manifest) as { date?: unknown; notes?: unknown };
      const notes = Array.isArray(manifest.notes) ? manifest.notes.filter((n): n is string => typeof n === 'string').slice(0, 30) : [];
      if (store.recordVersion(published.version, typeof manifest.date === 'string' ? manifest.date : '', notes, Date.now())) {
        log(`Versionsverlauf: ${published.version} gemerkt.`);
      }
    } catch (err) {
      log(`Versionsverlauf: ${published.version} nicht gemerkt (${(err as Error).message}).`);
    }
  };
  const updates = new Updates(updatesDir, log, recordVersion);
  const skins = new Skins({
    sessionServer,
    hosts: options.skinHosts ?? DEFAULT_SKIN_HOSTS,
    timeoutMs: options.skinTimeoutMs ?? 5_000,
  });
  const support = new Support(store, realtime, {
    maxOpen: options.supportMaxOpen ?? 3,
    perDay: options.supportDailyLimit ?? 5,
    messagesPerHour: options.supportHourlyMessages ?? 30,
  });
  const supportClosedTtlMs = options.supportClosedTtlMs ?? 90 * 24 * 60 * 60 * 1000;
  const supportIdleTtlMs = options.supportIdleTtlMs ?? 180 * 24 * 60 * 60 * 1000;
  let playerCount: { value: number; until: number } | undefined;
  const web = new Web(store, {
    website,
    codeTtlMs: options.webCodeTtlMs ?? 120_000,
    sessionTtlMs: options.webSessionTtlMs ?? 30 * 24 * 60 * 60 * 1000,
    sessionIdleMs: options.webSessionIdleMs ?? 7 * 24 * 60 * 60 * 1000,
    verifyTtlMs: options.teamVerifyTtlMs ?? 12 * 60 * 60 * 1000,
    linkLimiter,
    totpLimiter,
    totpNow: options.totpNow ?? Date.now,
  });
  const team = new Team(store, realtime, updates, {
    updateKey,
    maxUploadBytes: options.maxUploadBytes ?? MAX_SETUP_SIZE,
    uploadIdleTimeoutMs: options.uploadIdleTimeoutMs ?? 60_000,
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

  function rateLimit(limiter: RateLimiter, key: string, message = 'Zu viele Anfragen. Bitte kurz warten.'): void {
    const result = limiter.take(key);
    if (!result.ok) {
      throw new HttpError(429, message, { 'Retry-After': String(result.retryAfter) });
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
    throw new HttpError(401, NOT_SIGNED_IN);
  }

  /**
   * Anmeldung für eine Route: mit Bearer-Token (wenn erlaubt und mitgeschickt) oder mit dem Cookie der Webseite.
   * Mit Cookie gilt für alles außer GET/HEAD der Schutz vor fremden Webseiten (CSRF).
   */
  function authenticateFor(req: IncomingMessage, kind: Kind): Auth {
    const bearer = kind === 'user' || kind === 'bearer';
    const cookie = kind === 'user' || kind === 'web' || kind === 'team';
    if (bearer && (req.headers.authorization !== undefined || !cookie)) {
      const { user, tokenHash } = authenticate(req);
      return { user, key: tokenHash };
    }
    const value = readSessionCookie(req);
    if (value === null) throw new HttpError(401, NOT_SIGNED_IN);
    const found = web.find(value);
    // Ungültiges Cookie: im Browser gleich mit löschen.
    if (!found) throw new HttpError(401, NOT_SIGNED_IN, { 'Set-Cookie': clearSessionCookie(req) });
    checkCsrf(req, website);
    return { user: found.user, key: `web:${found.session.id}`, session: found.session };
  }

  function actor(ctx: Context): Actor & { uuid: string } {
    return { uuid: ctx.user.uuid, name: ctx.user.name };
  }

  /** Web-Sitzung des Kontexts (Routen der Art `web` und `team` haben immer eine). */
  function webAuth(ctx: Context): WebAuth {
    return { user: ctx.user, session: ctx.session! };
  }

  /** `WebMe`: das Profil wie `GET /v1/me` plus Rolle, 2FA-Stand und Ablauf der Sitzung. */
  function webMe(auth: WebAuth) {
    const user = store.getUser(auth.user.uuid) ?? auth.user;
    return {
      ...me(user),
      role: store.getTeamMember(user.uuid)?.role ?? null,
      twoFactor: web.twoFactor(user, auth.session),
      expiresAt: web.expiresAt(auth.session),
    };
  }

  function issueToken(uuid: string, name: string) {
    // Gesperrt: kein Token und auch kein neues Konto.
    if (store.getBan(uuid)) throw new HttpError(403, 'Dieses Konto ist für den Heldix-Dienst gesperrt.');
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
      messages: user.messages,
    };
  }

  function uuidParam(value: string | undefined): string {
    if (!isUuid(value)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
    return value;
  }

  /** Ganze Zahl aus der Abfrage (`?name=…`) zwischen min und max; fehlt sie: undefined. */
  function intQuery(ctx: Context, name: string, min: number, max: number, error: string): number | undefined {
    const raw = new URL(ctx.req.url ?? '/', 'http://heldix.invalid').searchParams.get(name);
    if (raw === null) return undefined;
    const value = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
    if (!(value >= min && value <= max)) throw new HttpError(400, error);
    return value;
  }

  /** Text aus der Abfrage (`?name=…`) oder null. */
  function textQuery(ctx: Context, name: string): string | null {
    return new URL(ctx.req.url ?? '/', 'http://heldix.invalid').searchParams.get(name);
  }

  /** Nummer aus dem Pfad (Meldung, Neuigkeit); keine Nummer: 404. */
  function idParam(value: string | undefined): number {
    if (value === undefined || !/^\d{1,15}$/.test(value)) throw new HttpError(404, 'Nicht gefunden.');
    return Number(value);
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
    for (const key of ['visible', 'presence', 'showServer', 'messages'] as const) {
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
    if (ctx.session) ctx.res.setHeader('Set-Cookie', clearSessionCookie(ctx.req));
    return { deleted: true };
  }

  /** `GET /v1/me/export`: Datenauskunft als Datei. */
  function exportMe(ctx: Context) {
    rateLimit(exportLimiter, ctx.user.uuid, 'Höchstens 5 Datenexporte pro Stunde. Bitte später noch einmal.');
    const user = store.getUser(ctx.user.uuid)!;
    const text = JSON.stringify({ ...exportData(store, user, me(user)), support: support.exportFor(user) }, null, 2);
    ctx.res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="heldix-daten-${user.name}.json"`,
      'Content-Length': String(Buffer.byteLength(text)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    ctx.res.end(text);
    return RESPONDED;
  }

  // ---------- Web-Anmeldung ----------

  async function createWebSession(ctx: Context) {
    checkOrigin(ctx.req, website);
    const { code } = await body(ctx);
    const created = web.createSession(ctx.req, code);
    ctx.res.setHeader('Set-Cookie', created.setCookie);
    return webMe(created);
  }

  function logout(ctx: Context) {
    web.deleteSession(ctx.user, ctx.session!.id);
    ctx.res.setHeader('Set-Cookie', clearSessionCookie(ctx.req));
    return { ok: true };
  }

  function deleteWebSession(ctx: Context) {
    const id = ctx.params[0] ?? '';
    web.deleteSession(ctx.user, id);
    // Die eigene Sitzung löschen heißt abmelden.
    if (id === ctx.session!.id) ctx.res.setHeader('Set-Cookie', clearSessionCookie(ctx.req));
    return web.sessions(ctx.user, ctx.session!);
  }

  async function enable2fa(ctx: Context) {
    const { code } = await body(ctx);
    web.enable(ctx.user, ctx.session!, code);
    writeAudit(store, actor(ctx), '2fa.enable', playerLabel(ctx.user.name, ctx.user.uuid));
    return webMe(webAuth(ctx));
  }

  async function verify2fa(ctx: Context) {
    const { code } = await body(ctx);
    web.verify(ctx.user, ctx.session!, code);
    return webMe(webAuth(ctx));
  }

  /** `GET /v1/news`: veröffentlichte Neuigkeiten für Webseite und Launcher, mit `before` als Archiv. */
  function publicNews(ctx: Context) {
    const limit = intQuery(ctx, 'limit', 1, 50, '„limit“ muss zwischen 1 und 50 liegen.') ?? 10;
    const before = intQuery(ctx, 'before', 1, Number.MAX_SAFE_INTEGER, '„before“ muss die ID einer Neuigkeit sein.');
    sendJson(ctx.res, 200, team.publicNews(limit, before), { 'Cache-Control': 'max-age=60' });
    return RESPONDED;
  }

  async function link(ctx: Context) {
    const { target } = await body(ctx);
    return web.link(ctx.user, target);
  }

  /** `GET /v1/public/skins/<uuid>`: nur für öffentliche Team-Mitglieder, sonst (und ohne Skin) 404. */
  async function publicSkin(ctx: Context) {
    const uuid = ctx.params[0];
    const png = isUuid(uuid) && store.isPublicTeamMember(uuid) ? await skins.get(uuid) : null;
    if (!png) throw new HttpError(404, 'Kein Skin gefunden.');
    ctx.res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      'Cache-Control': 'max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    ctx.res.end(png);
    return RESPONDED;
  }

  /** `GET /v1/launcher/versions`: Versionsverlauf, neueste zuerst. */
  async function launcherVersions(ctx: Context) {
    const limit = intQuery(ctx, 'limit', 1, 50, '„limit“ muss zwischen 1 und 50 liegen.') ?? 20;
    // Eine eben per scp hochgeladene update.json zählt sofort mit.
    await updates.latest();
    sendJson(ctx.res, 200, { versions: store.listVersions(limit) }, { 'Cache-Control': 'max-age=60' });
    return RESPONDED;
  }

  /** `GET /v1/status`: nur Summen, keine Namen. */
  async function status(ctx: Context) {
    const now = Date.now();
    if (!playerCount || playerCount.until <= now) playerCount = { value: store.countUsers(), until: now + STATUS_CACHE_MS };
    const published = await updates.latest();
    sendJson(
      ctx.res,
      200,
      {
        ok: true,
        service: serviceVersion,
        online: realtime.onlineCount(),
        players: playerCount.value,
        launcher: published?.version ?? null,
        since: startedAt,
      },
      { 'Cache-Control': 'max-age=30' },
    );
    return RESPONDED;
  }

  function teamMember(ctx: Context) {
    return ctx.member!;
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

  async function sendMessage(ctx: Context) {
    const friend = uuidParam(ctx.params[0]);
    const { text } = await body(ctx);
    return messages.send(ctx.user, friend, text);
  }

  function history(ctx: Context) {
    const friend = uuidParam(ctx.params[0]);
    const before = intQuery(ctx, 'before', 1, Number.MAX_SAFE_INTEGER, '„before“ muss eine Nachrichten-ID sein (ganze Zahl ab 1).');
    const limit = intQuery(ctx, 'limit', 1, MAX_PAGE_SIZE, `„limit“ muss zwischen 1 und ${MAX_PAGE_SIZE} liegen.`);
    return messages.history(ctx.user, friend, before, limit ?? DEFAULT_PAGE_SIZE);
  }

  async function block(ctx: Context) {
    return blocks.block(ctx.user, await body(ctx));
  }

  async function report(ctx: Context) {
    return reports.report(ctx.user, await body(ctx));
  }

  /** `GET /v1/launcher/latest`: update.json, wie der Betreiber sie hochgeladen hat. */
  async function launcherLatest(ctx: Context) {
    const published = await updates.latest();
    if (!published) throw new HttpError(404, NOTHING_PUBLISHED);
    sendJson(ctx.res, 200, { manifest: published.manifest, signature: published.signature }, { 'Cache-Control': 'no-cache' });
    return RESPONDED;
  }

  /** `GET /v1/launcher/download/latest`: Weiterleitung auf den aktuellen Installer (Download-Knopf der Webseite). */
  async function downloadLatest(ctx: Context) {
    const published = await updates.latest();
    if (!published) throw new HttpError(404, NOTHING_PUBLISHED);
    ctx.res.writeHead(302, {
      Location: `/v1/launcher/download/${published.file}`,
      'Cache-Control': 'no-cache',
      'Content-Length': '0',
    });
    ctx.res.end();
    return RESPONDED;
  }

  async function download(ctx: Context) {
    rateLimit(downloadLimiter, clientIp(ctx.req), 'Zu viele Downloads. Bitte kurz warten.');
    await updates.serve(ctx.req, ctx.res, ctx.params[0] ?? '', downloadIdleTimeoutMs);
    return RESPONDED;
  }

  const teamRoutes: Route[] = [
    { method: 'GET', pattern: /^\/v1\/team\/me\/profile$/, kind: 'team', handler: (ctx) => team.profile(teamMember(ctx)) },
    {
      method: 'PUT',
      pattern: /^\/v1\/team\/me\/profile$/,
      kind: 'team',
      handler: async (ctx) => team.updateProfile(actor(ctx), teamMember(ctx), await body(ctx)),
    },
    { method: 'GET', pattern: /^\/v1\/team\/support$/, kind: 'team', handler: (ctx) => support.teamList(textQuery(ctx, 'status')) },
    { method: 'GET', pattern: /^\/v1\/team\/support\/([^/]+)$/, kind: 'team', handler: (ctx) => support.teamGet(idParam(ctx.params[0])) },
    {
      method: 'POST',
      pattern: /^\/v1\/team\/support\/([^/]+)\/messages$/,
      kind: 'team',
      handler: async (ctx) => support.teamReply(actor(ctx), idParam(ctx.params[0]), await body(ctx)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/team\/support\/([^/]+)\/close$/,
      kind: 'team',
      handler: (ctx) => support.teamClose(actor(ctx), idParam(ctx.params[0])),
    },
    { method: 'GET', pattern: /^\/v1\/team\/reports$/, kind: 'team', handler: (ctx) => team.reports(textQuery(ctx, 'status')) },
    {
      method: 'POST',
      pattern: /^\/v1\/team\/reports\/([^/]+)\/done$/,
      kind: 'team',
      handler: (ctx) => team.markDone(actor(ctx), idParam(ctx.params[0])),
    },
    { method: 'GET', pattern: /^\/v1\/team\/bans$/, kind: 'team', handler: () => team.bans() },
    { method: 'POST', pattern: /^\/v1\/team\/bans$/, kind: 'team', handler: async (ctx) => team.ban(actor(ctx), await body(ctx)) },
    {
      method: 'DELETE',
      pattern: /^\/v1\/team\/bans\/([^/]+)$/,
      kind: 'team',
      handler: (ctx) => team.unban(actor(ctx), uuidParam(ctx.params[0])),
    },
    { method: 'GET', pattern: /^\/v1\/team\/players$/, kind: 'team', handler: (ctx) => team.players(textQuery(ctx, 'q')) },
    { method: 'GET', pattern: /^\/v1\/team\/players\/([^/]+)$/, kind: 'team', handler: (ctx) => team.player(uuidParam(ctx.params[0])) },
    {
      method: 'POST',
      pattern: /^\/v1\/team\/players\/([^/]+)\/reset-cape$/,
      kind: 'team',
      role: 'admin',
      handler: (ctx) => team.resetCape(actor(ctx), uuidParam(ctx.params[0])),
    },
    {
      method: 'DELETE',
      pattern: /^\/v1\/team\/players\/([^/]+)$/,
      kind: 'team',
      role: 'admin',
      handler: (ctx) => team.deletePlayer(actor(ctx), uuidParam(ctx.params[0])),
    },
    { method: 'GET', pattern: /^\/v1\/team\/news$/, kind: 'team', handler: () => team.news() },
    { method: 'POST', pattern: /^\/v1\/team\/news$/, kind: 'team', handler: async (ctx) => team.createNews(actor(ctx), await body(ctx)) },
    {
      method: 'PUT',
      pattern: /^\/v1\/team\/news\/([^/]+)$/,
      kind: 'team',
      handler: async (ctx) => team.updateNews(actor(ctx), idParam(ctx.params[0]), await body(ctx)),
    },
    {
      method: 'DELETE',
      pattern: /^\/v1\/team\/news\/([^/]+)$/,
      kind: 'team',
      handler: (ctx) => team.deleteNews(actor(ctx), idParam(ctx.params[0])),
    },
    { method: 'GET', pattern: /^\/v1\/team\/updates$/, kind: 'team', role: 'admin', handler: () => team.updatesOverview() },
    {
      method: 'PUT',
      pattern: /^\/v1\/team\/updates\/files\/([^/]+)$/,
      kind: 'team',
      role: 'admin',
      // Roher, gestreamter Körper bis 1 GiB: ohne BODY_LIMIT, ohne JSON.
      handler: (ctx) => team.upload(actor(ctx), ctx.req, ctx.params[0] ?? ''),
    },
    {
      method: 'DELETE',
      pattern: /^\/v1\/team\/updates\/files\/([^/]+)$/,
      kind: 'team',
      role: 'admin',
      handler: (ctx) => team.deleteFile(actor(ctx), ctx.params[0] ?? ''),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/team\/updates\/manifest$/,
      kind: 'team',
      role: 'admin',
      handler: async (ctx) => team.publish(actor(ctx), await body(ctx)),
    },
    { method: 'GET', pattern: /^\/v1\/team\/members$/, kind: 'team', role: 'admin', handler: () => team.members() },
    {
      method: 'POST',
      pattern: /^\/v1\/team\/members$/,
      kind: 'team',
      role: 'admin',
      handler: async (ctx) => team.addMember(actor(ctx), await body(ctx)),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/team\/members\/([^/]+)$/,
      kind: 'team',
      role: 'admin',
      handler: async (ctx) => team.setRole(actor(ctx), uuidParam(ctx.params[0]), await body(ctx)),
    },
    {
      method: 'DELETE',
      pattern: /^\/v1\/team\/members\/([^/]+)$/,
      kind: 'team',
      role: 'admin',
      handler: (ctx) => team.removeMember(actor(ctx), uuidParam(ctx.params[0])),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/team\/members\/([^/]+)\/reset-2fa$/,
      kind: 'team',
      role: 'admin',
      handler: (ctx) => team.reset2fa(actor(ctx), uuidParam(ctx.params[0])),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/team\/audit$/,
      kind: 'team',
      role: 'admin',
      handler: (ctx) => team.auditEntries(intQuery(ctx, 'limit', 1, 500, '„limit“ muss zwischen 1 und 500 liegen.') ?? 100),
    },
  ];

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
    { method: 'GET', pattern: /^\/v1\/messages$/, kind: 'user', handler: (ctx) => messages.conversations(ctx.user.uuid) },
    { method: 'GET', pattern: /^\/v1\/messages\/([^/]+)$/, kind: 'user', handler: history },
    { method: 'POST', pattern: /^\/v1\/messages\/([^/]+)$/, kind: 'user', handler: sendMessage },
    {
      method: 'POST',
      pattern: /^\/v1\/messages\/([^/]+)\/read$/,
      kind: 'user',
      handler: (ctx) => messages.markRead(ctx.user, uuidParam(ctx.params[0])),
    },
    { method: 'GET', pattern: /^\/v1\/blocks$/, kind: 'user', handler: (ctx) => blocks.list(ctx.user.uuid) },
    { method: 'POST', pattern: /^\/v1\/blocks$/, kind: 'user', handler: block },
    {
      method: 'DELETE',
      pattern: /^\/v1\/blocks\/([^/]+)$/,
      kind: 'user',
      handler: (ctx) => blocks.unblock(ctx.user, uuidParam(ctx.params[0])),
    },
    { method: 'POST', pattern: /^\/v1\/reports$/, kind: 'user', handler: report },
    { method: 'GET', pattern: /^\/v1\/reports\/mine$/, kind: 'user', handler: (ctx) => myReports(store, ctx.user) },
    { method: 'GET', pattern: /^\/v1\/me\/export$/, kind: 'user', handler: exportMe },
    // Anmeldung auf der Webseite
    { method: 'POST', pattern: /^\/v1\/web\/link$/, kind: 'bearer', handler: link },
    { method: 'POST', pattern: /^\/v1\/web\/session$/, kind: 'auth', handler: createWebSession },
    { method: 'GET', pattern: /^\/v1\/web\/me$/, kind: 'web', handler: (ctx) => webMe(webAuth(ctx)) },
    { method: 'POST', pattern: /^\/v1\/web\/logout$/, kind: 'web', handler: logout },
    { method: 'GET', pattern: /^\/v1\/web\/sessions$/, kind: 'web', handler: (ctx) => web.sessions(ctx.user, ctx.session!) },
    { method: 'DELETE', pattern: /^\/v1\/web\/sessions\/([^/]+)$/, kind: 'web', handler: deleteWebSession },
    { method: 'POST', pattern: /^\/v1\/web\/2fa\/setup$/, kind: 'web', handler: (ctx) => web.setup(ctx.user) },
    { method: 'POST', pattern: /^\/v1\/web\/2fa\/enable$/, kind: 'web', handler: enable2fa },
    { method: 'POST', pattern: /^\/v1\/web\/2fa\/verify$/, kind: 'web', handler: verify2fa },
    { method: 'GET', pattern: /^\/v1\/news$/, kind: 'public', handler: publicNews },
    // Support (Spieler)
    { method: 'GET', pattern: /^\/v1\/support$/, kind: 'user', handler: (ctx) => support.list(ctx.user) },
    { method: 'POST', pattern: /^\/v1\/support$/, kind: 'user', handler: async (ctx) => support.create(ctx.user, await body(ctx)) },
    { method: 'GET', pattern: /^\/v1\/support\/([^/]+)$/, kind: 'user', handler: (ctx) => support.get(ctx.user, idParam(ctx.params[0])) },
    {
      method: 'POST',
      pattern: /^\/v1\/support\/([^/]+)\/messages$/,
      kind: 'user',
      handler: async (ctx) => support.reply(ctx.user, idParam(ctx.params[0]), await body(ctx)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/support\/([^/]+)\/close$/,
      kind: 'user',
      handler: (ctx) => support.close(ctx.user, idParam(ctx.params[0])),
    },
    // Öffentlich: Teamseite, Skins, Versionsverlauf, Status
    {
      method: 'GET',
      pattern: /^\/v1\/public\/team$/,
      kind: 'public',
      handler: (ctx) => {
        sendJson(ctx.res, 200, team.publicTeam(), { 'Cache-Control': 'max-age=60' });
        return RESPONDED;
      },
    },
    { method: 'GET', pattern: /^\/v1\/public\/skins\/([^/]+)$/, kind: 'public', handler: publicSkin },
    { method: 'GET', pattern: /^\/v1\/launcher\/versions$/, kind: 'public', handler: launcherVersions },
    { method: 'GET', pattern: /^\/v1\/status$/, kind: 'public', handler: status },
    ...teamRoutes,
    // Launcher-Updates (ohne Anmeldung); `latest` steht vor dem allgemeinen Muster für Dateien.
    { method: 'GET', pattern: /^\/v1\/launcher\/latest$/, kind: 'public', handler: launcherLatest },
    { method: 'GET', pattern: /^\/v1\/launcher\/download\/latest$/, kind: 'public', handler: downloadLatest },
    { method: 'HEAD', pattern: /^\/v1\/launcher\/download\/latest$/, kind: 'public', handler: downloadLatest },
    { method: 'GET', pattern: /^\/v1\/launcher\/download\/([^/]+)$/, kind: 'public', handler: download },
    { method: 'HEAD', pattern: /^\/v1\/launcher\/download\/([^/]+)$/, kind: 'public', handler: download },
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
    // Launcher-Updates fragt auch die Webseite ab (andere Adresse): CORS für alle Antworten, auch Fehler.
    if (isPublicPath(path)) res.setHeader('Access-Control-Allow-Origin', '*');
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
    let session: WebSessionRow | undefined;
    let member: TeamMemberRow | undefined;
    if (route.kind === 'auth' || route.kind === 'dev') {
      rateLimit(authLimiter, clientIp(req));
    } else if (route.kind !== 'public') {
      const auth = authenticateFor(req, route.kind);
      rateLimit(apiLimiter, auth.key);
      user = auth.user;
      session = auth.session;
      if (route.kind === 'team') member = web.teamGate(auth.user, auth.session!, route.role ?? 'moderator');
    }
    const result = await route.handler({ req, res, params, user: user!, session, member });
    if (result !== RESPONDED) sendJson(res, 200, result);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        // Antwort hatte schon begonnen (z. B. ein Download): nur noch abbrechen.
        if (!(err instanceof HttpError)) log(`Interner Fehler bei ${req.method} ${pathOf(req)}: ${(err as Error)?.stack ?? String(err)}`);
        res.destroy();
      } else if (err instanceof HttpError) {
        sendError(res, err);
      } else {
        log(`Interner Fehler bei ${req.method} ${pathOf(req)}: ${(err as Error)?.stack ?? String(err)}`);
        sendError(res, new HttpError(500, 'Interner Fehler im Heldix-Dienst.'));
      }
    });
  });
  // Langsame oder hängende Clients nicht ewig festhalten. Beide Grenzen gelten nur, bis die Anfrage
  // angekommen ist, nicht für die Antwort: Ein langer Download über eine langsame Leitung läuft weiter
  // (dafür gibt es downloadIdleTimeoutMs, falls beim Client gar nichts mehr ankommt).
  server.headersTimeout = 10_000;
  server.requestTimeout = REQUEST_TIMEOUT_MS;

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
    messageLimiter.sweep(now);
    downloadLimiter.sweep(now);
    linkLimiter.sweep(now);
    totpLimiter.sweep(now);
    exportLimiter.sweep(now);
    try {
      store.deleteExpiredTokens(now);
      store.deleteMessagesBefore(now - messageTtlMs);
      store.deleteReportsBefore(now - reportTtlMs);
      store.deleteExpiredWebSessions(now, now - web.options.sessionIdleMs);
      store.deleteAuditBefore(now - auditTtlMs);
      store.deleteOldTickets(now - supportClosedTtlMs, now - supportIdleTtlMs);
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
