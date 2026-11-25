// Anmeldung: serverId-Challenges, Abfrage bei Mojang (hasJoined) und Tokens.
import { createHash, randomBytes } from 'node:crypto';
import { isName, normalizeUuid } from './validate';

/** Höchstens so viele offene Challenges im Speicher. */
const MAX_CHALLENGES = 50_000;
/** Antworten von Mojang sind wenige KB groß; alles darüber ist verdächtig. */
const MAX_MOJANG_RESPONSE = 64 * 1024;

/** Ausgegebene serverIds: zufällig, kurz gültig und nur einmal verwendbar. */
export class Challenges {
  private readonly open = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  /** Neue serverId (40 Hex-Zeichen). */
  issue(now = Date.now()): string {
    if (this.open.size >= MAX_CHALLENGES) this.sweep(now);
    if (this.open.size >= MAX_CHALLENGES) {
      // Immer noch voll: die älteste verwerfen (Map behält die Einfügereihenfolge).
      const oldest = this.open.keys().next().value;
      if (oldest !== undefined) this.open.delete(oldest);
    }
    const serverId = randomBytes(20).toString('hex');
    this.open.set(serverId, now + this.ttlMs);
    return serverId;
  }

  /** Löst die serverId ein. Danach ist sie verbraucht, auch wenn die Anmeldung scheitert. */
  consume(serverId: string, now = Date.now()): boolean {
    const expiresAt = this.open.get(serverId);
    if (expiresAt === undefined) return false;
    this.open.delete(serverId);
    return expiresAt > now;
  }

  sweep(now = Date.now()): void {
    for (const [id, expiresAt] of this.open) {
      if (expiresAt <= now) this.open.delete(id);
    }
  }
}

export interface MojangProfile {
  uuid: string;
  name: string;
}

/**
 * Fragt beim Session-Server nach, ob `name` dem Server `serverId` beigetreten ist.
 * Nur HTTP 200 mit passendem `{ id, name }` zählt; alles andere (auch Netzwerkfehler) ist `null`.
 */
export async function hasJoined(
  sessionServer: string,
  name: string,
  serverId: string,
  timeoutMs: number,
): Promise<MojangProfile | null> {
  const query = new URLSearchParams({ username: name, serverId });
  const url = `${sessionServer.replace(/\/+$/, '')}/session/minecraft/hasJoined?${query.toString()}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const length = Number(res.headers.get('content-length') ?? '0');
    if (length > MAX_MOJANG_RESPONSE) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const text = await res.text();
    if (text.length > MAX_MOJANG_RESPONSE) return null;
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const { id, name: profileName } = data as { id?: unknown; name?: unknown };
    const uuid = normalizeUuid(id);
    if (uuid === null || !isName(profileName)) return null;
    if (profileName.toLowerCase() !== name.toLowerCase()) return null;
    return { uuid, name: profileName };
  } catch {
    return null;
  }
}

/** Neues zufälliges Token (32 Byte, base64url). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Gespeichert wird nur dieser Hash, nie das Token selbst. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Liest `Authorization: Bearer <token>`. Ungültige Form: `null`. */
export function parseBearer(header: string | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,128})$/i.exec(header.trim());
  return match ? match[1]! : null;
}

/** true nur für Verbindungen von diesem Rechner (127.0.0.1 oder ::1). */
export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
