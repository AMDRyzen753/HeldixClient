// Hilfen für Tests der Webseite: Anmelden per Einmal-Link, Anfragen mit Cookie, Team-Mitglied mit 2FA.
import assert from 'node:assert/strict';
import { Store, type TeamRole } from '../src/db';
import { base32Decode, totp } from '../src/totp';
import { SESSION_COOKIE } from '../src/web';
import { api, type ApiResponse, type Player, type TestService } from './helpers';

export const WEBSITE = 'https://heldix.example';

/** Uhr für die 2FA-Codes: Tests schieben sie weiter, statt zu warten. */
export class Clock {
  constructor(public now = Date.now()) {}
  readonly read = () => this.now;
  /** Nächster Zeitschritt (30 s), damit ein neuer Code gilt. */
  step(): void {
    this.now += 30_000;
  }
}

/** Wert des Sitzungs-Cookies aus Set-Cookie (oder undefined). */
export function cookieFrom(res: ApiResponse): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const match = new RegExp(`^${SESSION_COOKIE}=([^;]*)`).exec(header);
    if (match) return match[1];
  }
  return undefined;
}

export interface WebRequest {
  cookie?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /** X-Heldix-Web: 1 mitschicken (Standard bei allem außer GET/HEAD) */
  csrf?: boolean;
}

/** Anfrage wie von der Webseite: Cookie und (außer bei GET) der CSRF-Header. */
export function webApi(service: TestService, method: string, path: string, options: WebRequest = {}): Promise<ApiResponse> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie !== undefined) headers.Cookie = `${SESSION_COOKIE}=${options.cookie}`;
  if (options.csrf ?? (method !== 'GET' && method !== 'HEAD')) headers['X-Heldix-Web'] = '1';
  return api(service.url, method, path, { body: options.body, rawBody: options.rawBody, headers });
}

/** Holt mit dem Bearer-Token einen Einmal-Link und tauscht ihn gegen eine Sitzung. Liefert Cookie und WebMe. */
export async function webLogin(service: TestService, player: Player, headers: Record<string, string> = {}) {
  const link = await api(service.url, 'POST', '/v1/web/link', { token: player.token });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  const code = new URL(link.body.url).hash.replace(/^#code=/, '');
  const session = await api(service.url, 'POST', '/v1/web/session', { body: { code }, headers });
  assert.equal(session.status, 200, JSON.stringify(session.body));
  const cookie = cookieFrom(session);
  assert.ok(cookie, 'kein Cookie');
  return { cookie: cookie!, me: session.body, response: session };
}

/** 6-stelliger Code für das Geheimnis zur Uhrzeit der Uhr. */
export function codeFor(secret: string, clock: Clock): string {
  return totp(base32Decode(secret)!, clock.now);
}

/** Nimmt einen Spieler direkt in der Datenbank ins Team auf (wie die CLI). */
export function addToTeam(service: TestService, player: Player, role: TeamRole): void {
  const store = new Store(service.dataDir);
  try {
    store.setTeamMember(player.uuid, role, Date.now(), null);
  } finally {
    store.close();
  }
}

/**
 * Team-Mitglied mit eingerichteter 2FA und bestätigter Sitzung. Danach steht die Uhr einen Schritt weiter,
 * damit der nächste Code gilt.
 */
export async function teamLogin(service: TestService, player: Player, role: TeamRole, clock: Clock) {
  addToTeam(service, player, role);
  const { cookie } = await webLogin(service, player);
  const setup = await webApi(service, 'POST', '/v1/web/2fa/setup', { cookie });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const enable = await webApi(service, 'POST', '/v1/web/2fa/enable', { cookie, body: { code: codeFor(setup.body.secret, clock) } });
  assert.equal(enable.status, 200, JSON.stringify(enable.body));
  clock.step();
  return { cookie, secret: setup.body.secret as string };
}
