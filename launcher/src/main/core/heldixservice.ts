// Anfragen an den Heldix-Dienst und die Anmeldung dort (siehe docs/dienst.md).
//
// Anmeldung wie beim Betreten eines Minecraft-Servers: Der Dienst gibt eine serverId aus, der Launcher meldet bei
// Mojang „ich trete bei“ (session/minecraft/join), der Dienst prüft das bei Mojang nach (hasJoined) und gibt ein Token
// (7 Tage) aus. Der Dienst sieht dabei nie das Minecraft-Token. Genutzt von core/weblogin.ts und core/social.ts.

export const MOJANG_SESSION_SERVER = 'https://sessionserver.mojang.com';

/** Netzwerkfehler, Zeitüberschreitung oder Gateway-Fehler ohne Antwort des Dienstes */
export const SERVICE_UNREACHABLE = 'Heldix-Dienst nicht erreichbar.';

export interface ServiceAccount {
  name: string;
  /** mit oder ohne Bindestriche */
  uuid: string;
  /** Minecraft-Zugangs-Token (nur für Mojang, geht nie an den Dienst) */
  accessToken: string;
}

export interface ServiceToken {
  token: string;
  uuid: string;
  name: string;
  expiresAt: number;
}

/** Fehler des Heldix-Dienstes mit deutscher Meldung; status 0 = nicht erreichbar */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isLoopback(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

export function serviceBase(serviceUrl: string): string {
  return serviceUrl.trim().replace(/\/+$/, '');
}

export type ServiceMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ServiceRequest {
  method?: ServiceMethod;
  body?: unknown;
  /** roher Text statt JSON (z. B. Anhang einer Support-Anfrage) */
  rawBody?: string;
  contentType?: string;
  token?: string;
  timeoutMs?: number;
}

/** Fetch mit Zeitgrenze; Netzwerkfehler werden zu ServiceError(status 0). */
export async function serviceFetch(base: string, path: string, init: ServiceRequest & { accept?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: init.accept ?? 'application/json' };
  if (init.rawBody !== undefined) headers['content-type'] = init.contentType ?? 'text/plain; charset=utf-8';
  else if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  try {
    return await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.rawBody !== undefined ? init.rawBody : init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      redirect: 'error',
    });
  } catch {
    throw new ServiceError(SERVICE_UNREACHABLE, 0);
  }
}

/** JSON-Anfrage an den Dienst. Fehler kommen als ServiceError mit der deutschen Meldung des Dienstes. */
export async function serviceRequest<T>(base: string, path: string, init: ServiceRequest = {}): Promise<T> {
  const response = await serviceFetch(base, path, init);
  const json = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok) {
    const message = json && typeof json.error === 'string' && json.error.trim() ? json.error : null;
    if (!message && (response.status === 502 || response.status === 503 || response.status === 504)) {
      throw new ServiceError(SERVICE_UNREACHABLE, response.status);
    }
    throw new ServiceError(message ?? `Der Heldix-Dienst antwortet mit ${response.status}.`, response.status);
  }
  if (json === null || typeof json !== 'object') throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', response.status);
  return json;
}

export interface LoginOptions {
  /**
   * Nur für Tests gegen einen lokalen Dienst im Entwicklungsmodus (HELDIX_DIENST_DEV=1): POST /v1/auth/dev statt Mojang.
   * Gilt nur für Loopback-Adressen.
   */
  devAuth?: boolean;
  /** Basis-Adresse des Session-Servers (Standard: Mojang; nur Tests ändern sie) */
  sessionServer?: string;
}

/** Meldet ein Konto beim Heldix-Dienst an und gibt das Token zurück. */
export async function serviceLogin(serviceUrl: string, account: ServiceAccount, options: LoginOptions = {}): Promise<ServiceToken> {
  const base = serviceBase(serviceUrl);
  if (!base) throw new ServiceError('Kein Heldix-Dienst eingerichtet.', 0);
  const uuid = account.uuid.replace(/-/g, '').toLowerCase();
  let result: Partial<ServiceToken>;
  if (options.devAuth && isLoopback(base)) {
    result = await serviceRequest<Partial<ServiceToken>>(base, '/v1/auth/dev', { method: 'POST', body: { name: account.name, uuid } });
  } else {
    const { serverId } = await serviceRequest<{ serverId: string }>(base, '/v1/auth/challenge', { method: 'POST' });
    if (typeof serverId !== 'string' || !/^[0-9a-f]{40}$/.test(serverId)) throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', 200);
    // wie beim Betreten eines Minecraft-Servers: Mojang bestätigt dem Dienst, wem die UUID gehört
    const sessionServer = (options.sessionServer ?? MOJANG_SESSION_SERVER).replace(/\/+$/, '');
    let join: Response;
    try {
      join = await fetch(`${sessionServer}/session/minecraft/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken: account.accessToken, selectedProfile: uuid, serverId }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceError('Mojang ist gerade nicht erreichbar. Bitte später noch einmal versuchen.', 0);
    }
    if (!join.ok) throw new ServiceError('Mojang hat die Anmeldung abgelehnt. Bitte das Konto im Launcher neu anmelden.', join.status);
    result = await serviceRequest<Partial<ServiceToken>>(base, '/v1/auth/login', { method: 'POST', body: { name: account.name, serverId } });
  }
  if (typeof result.token !== 'string' || !result.token) throw new ServiceError('Der Heldix-Dienst hat kein Token geschickt.', 200);
  return {
    token: result.token,
    uuid: typeof result.uuid === 'string' ? result.uuid : uuid,
    name: typeof result.name === 'string' ? result.name : account.name,
    expiresAt: typeof result.expiresAt === 'number' ? result.expiresAt : Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
}
