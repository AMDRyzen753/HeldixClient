// Entdecken – öffentliches Weltenverzeichnis des Heldix-Dienstes (ab 1.13.0, siehe docs/dienst.md):
//
// - GET /v1/public/discover?sort=popular&page=1 (öffentlich, ohne Anmeldung, 30 s Cache beim Dienst, 120/min je IP).
// - Startseite „Beliebte Welten“: bis zu drei Einträge; „Beitreten“ läuft wie ein Link heldixclient://welt/<code>
//   (frische Welt-Info, passende Instanz, Quick Play), schlafende dauerhafte Welten weckt der Beitritt.
// - Dauerhafte Welten von Freunden (Gastgeber ist Freund) ergänzen „Offene Welten deiner Freunde“, weil der Dienst
//   unter GET /v1/worlds → friends nur Welten mit offenem Tunnel meldet.
// - Dienst ohne Entdecken (404) bzw. ohne Welt teilen (503 „nicht eingerichtet“): Bereich aus, 30 Minuten Ruhe.

import type { DiscoverWorld, FriendWorld, PopularWorlds } from '../../shared/api';
import { SERVICE_UNREACHABLE, ServiceError, serviceBase, serviceRequest } from './heldixservice';
import { WORLD_CODE_RE, normalizeWorldAddress, worldCodeOf } from './worlds';

export const DISCOVER_TAGS: Record<string, string> = {
  survival: 'Survival',
  kreativ: 'Kreativ',
  minispiele: 'Minispiele',
  rollenspiel: 'Rollenspiel',
  bauen: 'Bauen',
  parkour: 'Parkour',
  technik: 'Technik',
  entspannt: 'Entspannt',
  hardcore: 'Hardcore',
};
const STATES = ['online', 'sleeping', 'starting', 'running', 'stopping'] as const;
/** so lange gilt die Liste (Startseite fragt bei Bedarf, alle 5 Minuten im Hintergrund) */
export const POPULAR_FRESH_MS = 2 * 60_000;
const UNSUPPORTED_MS = 30 * 60_000;
export const POPULAR_LIMIT = 3;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown, max = 10_000_000): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(max, Math.floor(value)) : 0);

function line(raw: unknown, max: number): string {
  const text = str(raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** Eintrag aus GET /v1/public/discover → entries; ungültig: null */
export function mapDiscoverEntry(raw: unknown): DiscoverWorld | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const address = normalizeWorldAddress(r.address);
  const code = typeof r.code === 'string' && WORLD_CODE_RE.test(r.code) ? r.code : null;
  if (!address || !code || worldCodeOf(address) !== code) return null;
  const host = r.host && typeof r.host === 'object' ? (r.host as Record<string, unknown>) : {};
  const uuid = str(host.uuid).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(uuid)) return null;
  const hostName = line(host.name, 16) || 'Unbekannt';
  const state = (STATES as readonly string[]).includes(str(r.state)) ? (r.state as DiscoverWorld['state']) : 'online';
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string' && t in DISCOVER_TAGS).slice(0, 3) : [];
  return {
    code,
    name: line(r.name, 32) || `Welt von ${hostName}`,
    description: line(r.description, 160),
    tags,
    lang: r.lang === 'en' ? 'en' : 'de',
    version: typeof r.version === 'string' && /^[A-Za-z0-9._+-]{1,32}$/.test(r.version) ? r.version : null,
    players: count(r.players, 1000),
    maxPlayers: Math.max(1, Math.min(100, count(r.maxPlayers, 100) || 8)),
    state,
    persistent: r.persistent === true,
    host: { uuid, name: hostName },
    likes: count(r.likes),
    address,
  };
}

/** Kurztext des Zustands für Listen */
export function discoverStateText(world: Pick<DiscoverWorld, 'state'>): string {
  switch (world.state) {
    case 'running':
      return 'läuft';
    case 'sleeping':
    case 'stopping':
      return 'schläft – Beitreten weckt sie';
    case 'starting':
      return 'startet gerade';
    default:
      return 'geöffnet';
  }
}

/** Eintrag als Welt für „Offene Welten deiner Freunde“ (dauerhafte Welten von Freunden) */
export function discoverAsFriendWorld(world: DiscoverWorld): FriendWorld {
  return {
    // Entdecken nennt keine Welt-ID: der Code ist eindeutig
    id: `entdecken-${world.code}`,
    code: world.code,
    name: world.name,
    address: world.address,
    host: world.host,
    players: world.players,
    maxPlayers: world.maxPlayers,
    version: world.version,
    hosted: world.persistent ? { state: world.state === 'online' ? 'running' : world.state } : null,
  };
}

export interface DiscoverOptions {
  serviceUrl: string;
  onUpdate?(popular: PopularWorlds): void;
  log?(line: string): void;
}

export class DiscoverClient {
  private readonly base: string;
  private current: PopularWorlds = { status: 'off', error: null, worlds: [] };
  private loadedAt = 0;
  private unsupportedUntil = 0;
  private running: Promise<PopularWorlds> | null = null;
  private lastSent = '';
  /** alle Einträge der ersten Seite (für dauerhafte Welten von Freunden) */
  private all: DiscoverWorld[] = [];

  constructor(private readonly options: DiscoverOptions) {
    this.base = serviceBase(options.serviceUrl ?? '');
  }

  get popularWorlds(): PopularWorlds {
    return this.current;
  }

  /** Beliebte Welten (höchstens drei); fresh = am Speicher vorbei */
  popular(fresh = false): Promise<PopularWorlds> {
    if (!fresh && this.current.status !== 'off' && Date.now() - this.loadedAt < POPULAR_FRESH_MS) return Promise.resolve(this.current);
    this.running ??= this.load().finally(() => (this.running = null));
    return this.running;
  }

  /** dauerhafte Welten, deren Gastgeber in {@code friends} ist (UUIDs ohne Bindestriche) */
  persistentOf(friends: ReadonlySet<string>): DiscoverWorld[] {
    return this.all.filter((w) => w.persistent && friends.has(w.host.uuid));
  }

  private publish(next: PopularWorlds): PopularWorlds {
    this.current = next;
    const json = JSON.stringify(next);
    if (json !== this.lastSent) {
      this.lastSent = json;
      this.options.onUpdate?.(next);
    }
    return next;
  }

  private async load(): Promise<PopularWorlds> {
    if (!this.base) return this.publish({ status: 'off', error: null, worlds: [] });
    if (Date.now() < this.unsupportedUntil) return this.publish({ status: 'unsupported', error: null, worlds: [] });
    let raw: unknown;
    try {
      raw = await serviceRequest<unknown>(this.base, '/v1/public/discover?sort=popular&page=1', { timeoutMs: 10_000 });
    } catch (error) {
      if (error instanceof ServiceError && (error.status === 404 || (error.status === 503 && error.message !== SERVICE_UNREACHABLE))) {
        this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        this.all = [];
        return this.publish({ status: 'unsupported', error: null, worlds: [] });
      }
      // letzter Stand bleibt sichtbar, mit Fehler
      return this.publish({ ...this.current, status: this.current.worlds.length ? this.current.status : 'error', error: error instanceof Error ? error.message : String(error) });
    }
    const list = raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries) ? (raw as { entries: unknown[] }).entries : [];
    this.all = list.map(mapDiscoverEntry).filter((w): w is DiscoverWorld => w !== null);
    this.loadedAt = Date.now();
    // nur, was man gerade betreten kann (geöffnet, läuft oder schläft)
    return this.publish({ status: 'ok', error: null, worlds: this.all.slice(0, POPULAR_LIMIT) });
  }
}
