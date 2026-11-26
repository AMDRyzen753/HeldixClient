// Anmeldung auf der Webseite ohne Passwort: Der Launcher (oder das Spiel) holt mit seinem Token einen Einmal-Link,
// die Webseite tauscht den Code gegen eine Cookie-Sitzung. Bei der Anmeldung mit dem Minecraft-Konto (microsoft.ts)
// entsteht derselbe Einmal-Code, zusätzlich an den Browser gebunden, der die Anmeldung begonnen hat.
// Dazu die Zwei-Faktor-Anmeldung und der Zugang zum Team-Bereich.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import { hashToken, isLoopback } from './auth';
import type { Store, TeamMemberRow, TeamRole, UserRow, WebSessionRow } from './db';
import { HttpError } from './http';
import type { RateLimiter } from './limits';
import { newTotpSecret, totpUri, verifyTotp } from './totp';

/** Name des Cookies (`__Host-`: nur über HTTPS, nur für genau diese Adresse, Pfad `/`). */
export const SESSION_COOKIE = '__Host-heldix_web';
/**
 * Bindung der Anmeldung mit dem Minecraft-Konto an diesen Browser: gesetzt beim Start (über die Webseite), geprüft beim
 * Einlösen des Codes, danach gelöscht. Enthält nur einen Zufallswert.
 */
export const BINDING_COOKIE = '__Host-heldix_ms';
/** 32 Zufallsbytes als base64url (Cookie-Wert und Einmal-Code). */
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
/** Höchstens so viele Web-Sitzungen pro Spieler; die ältesten fallen weg. */
const SESSIONS_PER_USER = 10;

/** Erlaubte Ziele im Einmal-Link: Reiter der Konto-Seite bzw. `team` für die Seite /team. */
export const LINK_TARGETS = ['profil', 'freunde', 'nachrichten', 'privatsphaere', 'daten', 'support', 'team'] as const;
/** Erlaubte Ziele bei der Anmeldung mit dem Minecraft-Konto (`?ziel=`): alle Bereiche der Konto-Seite und `team`. */
export const LOGIN_TARGETS = [...LINK_TARGETS, 'uebersicht', 'sicherheit', 'addons'] as const;

/** Ziel aus der Anfrage, nur aus der Liste; alles andere (auch Adressen) fällt still weg. */
export function loginTarget(value: string | null): string | null {
  return value !== null && (LOGIN_TARGETS as readonly string[]).includes(value) ? value : null;
}

export const LINK_EXPIRED =
  'Der Anmelde-Link ist abgelaufen oder wurde schon benutzt. Bitte im Launcher erneut „Auf heldixclient.com anmelden“ wählen.';
export const NOT_SIGNED_IN = 'Nicht angemeldet oder Anmeldung abgelaufen. Bitte neu anmelden.';
export const MICROSOFT_EXPIRED =
  'Die Anmeldung ist abgelaufen oder wurde in einem anderen Browser begonnen. Bitte klicke noch einmal auf „Mit Minecraft-Konto anmelden“.';
const CSRF_REJECTED = 'Diese Anfrage wurde aus Sicherheitsgründen abgelehnt. Bitte die Seite neu laden.';
const WRONG_CODE = 'Der Code stimmt nicht.';

export interface WebOptions {
  /** Adresse der Webseite (Origin, z. B. `https://heldixclient.com`); ohne: keine Anmeldung auf der Webseite. */
  website: string | null;
  codeTtlMs: number;
  sessionTtlMs: number;
  sessionIdleMs: number;
  /** So lange gilt ein eingegebener 2FA-Code für die Sitzung. */
  verifyTtlMs: number;
  /** Einmal-Links pro Spieler und Zeitraum. */
  linkLimiter: RateLimiter;
  /** 2FA-Versuche pro Spieler und Zeitraum. */
  totpLimiter: RateLimiter;
  /** Uhr für die 2FA-Codes (Tests stellen sie). */
  totpNow: () => number;
}

export interface WebAuth {
  user: UserRow;
  session: WebSessionRow;
}

// ---------- Cookie, CSRF, Gerät ----------

/** Wert des Cookies `name` aus der Anfrage oder null. */
export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Wert des Sitzungs-Cookies aus der Anfrage oder null. */
export function readSessionCookie(req: IncomingMessage): string | null {
  return readCookie(req, SESSION_COOKIE);
}

/** Bindungs-Cookie dieses Browsers, wenn es gültig aussieht, sonst null. */
export function readBindingCookie(req: IncomingMessage): string | null {
  const value = readCookie(req, BINDING_COOKIE);
  return value !== null && SECRET_RE.test(value) ? value : null;
}

/** Direkte Anfrage über HTTP von diesem Rechner (nur Tests): Dann darf `Secure` fehlen. Hinter einem Proxy nie. */
function plainLoopback(req: IncomingMessage): boolean {
  const proxied = ['x-forwarded-for', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'via'].some((name) => req.headers[name] !== undefined);
  return !proxied && !(req.socket instanceof TLSSocket) && isLoopback(req.socket.remoteAddress);
}

function cookie(req: IncomingMessage, value: string, maxAgeSeconds: number, name = SESSION_COOKIE): string {
  const secure = plainLoopback(req) ? '' : '; Secure';
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`;
}

/** Set-Cookie für das Bindungs-Cookie (gleiche Regeln wie das Sitzungs-Cookie); `maxAgeSeconds` 0 löscht es. */
export function bindingCookie(req: IncomingMessage, value: string, maxAgeSeconds: number): string {
  return cookie(req, value, maxAgeSeconds, BINDING_COOKIE);
}

/** Set-Cookie, das das Sitzungs-Cookie im Browser löscht. */
export function clearSessionCookie(req: IncomingMessage): string {
  return cookie(req, '', 0);
}

/**
 * Schutz vor fremden Webseiten (CSRF) für Anfragen mit Cookie, die etwas ändern: Header `X-Heldix-Web: 1`, und ein
 * mitgeschickter `Origin` muss genau die eigene Webseite sein.
 */
export function checkCsrf(req: IncomingMessage, website: string | null): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-heldix-web'] !== '1') throw new HttpError(403, CSRF_REJECTED);
  checkOrigin(req, website);
}

/** Ein mitgeschickter `Origin` muss genau die eigene Webseite sein (auch beim Anmelden: kein Anmelden über fremde Seiten). */
export function checkOrigin(req: IncomingMessage, website: string | null): void {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== website) throw new HttpError(403, CSRF_REJECTED);
}

/** Kurzer Gerätename aus dem User-Agent, z. B. `Firefox · Windows`. Mehr wird davon nicht gespeichert. */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = /\bEdg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /\bOPR\/|\bOpera\b/.test(ua)
      ? 'Opera'
      : /\bFirefox\/|\bFxiOS\//.test(ua)
        ? 'Firefox'
        : /\bChrome\/|\bCriOS\//.test(ua)
          ? 'Chrome'
          : /\bSafari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? 'Unbekanntes Gerät';
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Höchstens so viele an einen Browser gebundene Codes im Speicher; darüber fallen die ältesten weg. */
const MAX_BOUND_CODES = 10_000;

/** Einmal-Code aus der Anmeldung mit dem Minecraft-Konto: nur im Arbeitsspeicher, gebunden an den Browser. */
interface BoundCode {
  uuid: string;
  /** Hash des Bindungs-Cookies */
  binding: string;
  expiresAt: number;
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Code aus der Eingabe (Leerzeichen erlaubt, z. B. „123 456“). */
function readCode(value: unknown): string {
  const code = typeof value === 'string' ? value.replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Bitte den 6-stelligen Code aus der Authenticator-App eingeben.');
  return code;
}

// ---------- Anmeldung ----------

export class Web {
  private readonly bound = new Map<string, BoundCode>();

  constructor(
    private readonly store: Store,
    readonly options: WebOptions,
  ) {}

  /**
   * Einmal-Code nach der Anmeldung mit dem Minecraft-Konto (gleiche Form und Laufzeit wie beim Einmal-Link), gebunden an
   * den Browser mit dem Bindungs-Cookie `bindingHash`. Liefert die Adresse auf der Webseite.
   */
  boundLink(uuid: string, bindingHash: string, target: string | null): string {
    const { website } = this.options;
    if (website === null) throw new HttpError(503, 'Die Anmeldung auf der Webseite ist auf diesem Server nicht eingerichtet.');
    const now = Date.now();
    if (this.bound.size >= MAX_BOUND_CODES) this.sweepBound(now);
    while (this.bound.size >= MAX_BOUND_CODES) {
      const oldest = this.bound.keys().next().value;
      if (oldest === undefined) break;
      this.bound.delete(oldest);
    }
    const code = newSecret();
    this.bound.set(hashToken(code), { uuid, binding: bindingHash, expiresAt: now + this.options.codeTtlMs });
    return `${website}/konto#code=${code}${target !== null ? `&ziel=${target}` : ''}`;
  }

  /** Abgelaufene gebundene Codes entfernen. */
  sweepBound(now = Date.now()): void {
    for (const [key, entry] of this.bound) {
      if (entry.expiresAt <= now) this.bound.delete(key);
    }
  }

  /** `POST /v1/web/link` (mit Bearer-Token), auf Wunsch mit `{ target }`: Einmal-Link zur Webseite. */
  link(user: UserRow, target?: unknown): { url: string; expiresAt: number } {
    const { website } = this.options;
    if (website === null) throw new HttpError(503, 'Die Anmeldung auf der Webseite ist auf diesem Server nicht eingerichtet.');
    if (target !== undefined && target !== null && !(LINK_TARGETS as readonly unknown[]).includes(target)) {
      throw new HttpError(400, `Unbekanntes Ziel (erlaubt: ${LINK_TARGETS.join(', ')}).`);
    }
    const rate = this.options.linkLimiter.take(user.uuid);
    if (!rate.ok) {
      throw new HttpError(429, 'Zu viele Anmelde-Links. Bitte kurz warten.', { 'Retry-After': String(rate.retryAfter) });
    }
    const code = newSecret();
    const expiresAt = Date.now() + this.options.codeTtlMs;
    this.store.insertWebCode(hashToken(code), user.uuid, expiresAt);
    // Im Fragment (#): Der Code geht nicht an den Server der Webseite und landet in keinem Log.
    const ziel = typeof target === 'string' ? `&ziel=${target}` : '';
    return { url: `${website}/konto#code=${code}${ziel}`, expiresAt };
  }

  /**
   * `POST /v1/web/session` mit `{ code }`: neue Sitzung. Liefert Sitzung, Spieler und Set-Cookie. Der Code kommt aus
   * dem Einmal-Link des Launchers oder aus der Anmeldung mit dem Minecraft-Konto (dann nur mit dem Bindungs-Cookie des
   * Browsers, der sie begonnen hat; das Cookie wird dabei gelöscht). Danach ist alles gleich.
   */
  createSession(req: IncomingMessage, code: unknown): WebAuth & { setCookie: string[] } {
    if (typeof code !== 'string' || !SECRET_RE.test(code)) throw new HttpError(401, LINK_EXPIRED);
    const now = Date.now();
    const hash = hashToken(code);
    const extraCookies: string[] = [];
    let uuid: string | undefined;
    let expired = LINK_EXPIRED;
    const bound = this.bound.get(hash);
    if (bound) {
      // Einmal: auch ein Fehlversuch verbraucht den Code.
      this.bound.delete(hash);
      expired = MICROSOFT_EXPIRED;
      const binding = readBindingCookie(req);
      if (bound.expiresAt <= now || binding === null || !sameHash(hashToken(binding), bound.binding)) throw new HttpError(401, expired);
      uuid = bound.uuid;
      extraCookies.push(bindingCookie(req, '', 0));
    } else {
      uuid = this.store.takeWebCode(hash, now);
    }
    const user = uuid === undefined ? undefined : this.store.getUser(uuid);
    if (!user || this.store.getBan(user.uuid)) throw new HttpError(401, expired);
    const value = newSecret();
    const session: WebSessionRow = {
      id: randomBytes(12).toString('base64url'),
      uuid: user.uuid,
      device: deviceName(req.headers['user-agent']).slice(0, 60),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + this.options.sessionTtlMs,
      verifiedAt: 0,
    };
    this.store.insertWebSession(session, hashToken(value), SESSIONS_PER_USER);
    return { user, session, setCookie: [cookie(req, value, Math.floor(this.options.sessionTtlMs / 1000)), ...extraCookies] };
  }

  /** Sitzung zum Cookie-Wert (gültig, nicht zu lange unbenutzt) oder undefined. Merkt die Nutzung. */
  find(value: string): WebAuth | undefined {
    if (!SECRET_RE.test(value)) return undefined;
    const now = Date.now();
    const session = this.store.findWebSession(hashToken(value), now, now - this.options.sessionIdleMs);
    const user = session === undefined ? undefined : this.store.getUser(session.uuid);
    if (!session || !user) return undefined;
    // Nicht bei jeder Anfrage schreiben: höchstens etwa einmal pro Minute.
    if (now - session.lastUsedAt > Math.min(60_000, this.options.sessionIdleMs / 10)) {
      this.store.touchWebSession(session.id, now);
      session.lastUsedAt = now;
    }
    return { user, session };
  }

  /** Bis wann die Sitzung gilt: 30 Tage ab Anmeldung, aber höchstens 7 Tage nach der letzten Nutzung. */
  expiresAt(session: WebSessionRow): number {
    return Math.min(session.expiresAt, session.lastUsedAt + this.options.sessionIdleMs);
  }

  /** Stand der Zwei-Faktor-Anmeldung für `WebMe`. */
  twoFactor(user: UserRow, session: WebSessionRow): { enabled: boolean; verified: boolean } {
    const member = this.store.getTeamMember(user.uuid);
    return {
      enabled: member !== undefined && member.totpSecret !== null,
      verified: member !== undefined && this.isVerified(session),
    };
  }

  /** `GET /v1/web/sessions` */
  sessions(user: UserRow, current: WebSessionRow) {
    const now = Date.now();
    return {
      sessions: this.store.listWebSessions(user.uuid, now, now - this.options.sessionIdleMs).map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        current: s.id === current.id,
        device: s.device,
      })),
    };
  }

  deleteSession(user: UserRow, id: string): void {
    this.store.deleteWebSession(user.uuid, id);
  }

  // ---------- Zwei-Faktor-Anmeldung ----------

  /** Sitzung als 2FA-bestätigt merken (auch im übergebenen Objekt, für die Antwort). */
  private confirm(session: WebSessionRow): void {
    session.verifiedAt = Date.now();
    this.store.verifyWebSession(session.id, session.verifiedAt);
  }

  private isVerified(session: WebSessionRow): boolean {
    return session.verifiedAt > 0 && session.verifiedAt > Date.now() - this.options.verifyTtlMs;
  }

  private member(user: UserRow): TeamMemberRow {
    const member = this.store.getTeamMember(user.uuid);
    if (!member) throw new HttpError(403, 'Die Zwei-Faktor-Anmeldung gibt es nur für das HeldixClient-Team.', {}, 'forbidden');
    return member;
  }

  private takeAttempt(user: UserRow): void {
    const rate = this.options.totpLimiter.take(user.uuid);
    if (!rate.ok) {
      throw new HttpError(429, 'Zu viele Versuche. Bitte in ein paar Minuten noch einmal.', { 'Retry-After': String(rate.retryAfter) });
    }
  }

  /** `POST /v1/web/2fa/setup`: vorläufiges Geheimnis (ein neuer Aufruf ersetzt es). */
  setup(user: UserRow): { secret: string; uri: string } {
    const member = this.member(user);
    if (member.totpSecret !== null) {
      throw new HttpError(409, 'Die Zwei-Faktor-Anmeldung ist schon eingerichtet. Zum Zurücksetzen bitte an einen Admin wenden.');
    }
    const secret = newTotpSecret();
    this.store.setTotpPending(user.uuid, secret);
    return { secret, uri: totpUri(user.name, secret) };
  }

  /** `POST /v1/web/2fa/enable`: ersten Code prüfen, dann ist 2FA aktiv und die Sitzung bestätigt. */
  enable(user: UserRow, session: WebSessionRow, input: unknown): void {
    const member = this.member(user);
    if (member.totpSecret !== null) throw new HttpError(409, 'Die Zwei-Faktor-Anmeldung ist schon eingerichtet.');
    if (member.totpPending === null) throw new HttpError(409, 'Bitte zuerst die Einrichtung starten.');
    const code = readCode(input);
    this.takeAttempt(user);
    const step = verifyTotp(member.totpPending, code, this.options.totpNow(), member.totpLastStep);
    if (step === null || !this.store.enableTotp(user.uuid, step)) throw new HttpError(401, WRONG_CODE);
    this.confirm(session);
  }

  /** `POST /v1/web/2fa/verify`: Code eingeben, die Sitzung gilt dann 12 Stunden als bestätigt. */
  verify(user: UserRow, session: WebSessionRow, input: unknown): void {
    const member = this.member(user);
    if (member.totpSecret === null) {
      throw new HttpError(403, 'Bitte zuerst die Zwei-Faktor-Anmeldung einrichten.', {}, '2fa_setup_required');
    }
    const code = readCode(input);
    this.takeAttempt(user);
    // Jeder Zeitschritt nur einmal: auch derselbe Code ein zweites Mal gilt als falsch.
    const step = verifyTotp(member.totpSecret, code, this.options.totpNow(), member.totpLastStep);
    if (step === null || !this.store.useTotpStep(user.uuid, step)) throw new HttpError(401, WRONG_CODE);
    this.confirm(session);
  }

  /**
   * Zugang zu `/v1/team/*`: Team-Rolle, eingerichtete 2FA und in dieser Sitzung bestätigter Code; für Admin-Routen die
   * Rolle `admin`. Sonst 403 mit `code`.
   */
  /** Wie teamGate (jede Rolle), aber ohne Fehler: true, wenn der Team-Bereich offen wäre. */
  passesTeamGate(user: UserRow, session: WebSessionRow): boolean {
    const member = this.store.getTeamMember(user.uuid);
    return member !== undefined && member.totpSecret !== null && this.isVerified(session);
  }

  teamGate(user: UserRow, session: WebSessionRow, role: TeamRole): TeamMemberRow {
    const member = this.store.getTeamMember(user.uuid);
    if (!member) throw new HttpError(403, 'Dieser Bereich ist nur für das HeldixClient-Team.', {}, 'forbidden');
    if (member.totpSecret === null) {
      throw new HttpError(403, 'Bitte zuerst die Zwei-Faktor-Anmeldung einrichten.', {}, '2fa_setup_required');
    }
    if (!this.isVerified(session)) {
      throw new HttpError(403, 'Bitte den Code aus der Authenticator-App eingeben.', {}, '2fa_required');
    }
    if (role === 'admin' && member.role !== 'admin') throw new HttpError(403, 'Dafür braucht es die Rolle Admin.', {}, 'forbidden');
    return member;
  }
}
