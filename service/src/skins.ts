// Skins für die öffentliche Teamseite: Der Dienst lädt den Skin selbst bei Mojang, damit der Browser der Besucher
// nie etwas von Mojang lädt. Kein offener Proxy: nur öffentliche Team-Mitglieder (prüft app.ts), nur erlaubte Hosts,
// höchstens 256 KB, nur PNG, mit Zeitgrenze und Zwischenspeicher.

/** Erlaubte Hosts für Skin-Dateien (Standard). */
export const DEFAULT_SKIN_HOSTS: readonly string[] = ['textures.minecraft.net'];
/** Größter Skin; echte Skins haben wenige KB. */
export const MAX_SKIN_BYTES = 256 * 1024;
/** Antwort von Mojang auf die Profil-Abfrage: wenige KB. */
const MAX_PROFILE_BYTES = 64 * 1024;
const CACHE_MS = 6 * 60 * 60 * 1000;
/** Fehlt ein Skin (oder ging etwas schief), wird erst nach dieser Zeit erneut gefragt. */
const MISS_CACHE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 100;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface SkinOptions {
  /** Basis-Adresse des Session-Servers (wie bei hasJoined). */
  sessionServer: string;
  /** Erlaubte Hosts für die Skin-Datei; Loopback-Hosts (nur Tests) dürfen über HTTP laden. */
  hosts: readonly string[];
  timeoutMs: number;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

/** Lädt höchstens `max` Byte; mehr, ein anderer Status als 200 oder eine Weiterleitung: null. */
async function fetchLimited(url: string, max: number, timeoutMs: number): Promise<Buffer | null> {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > max) {
    await res.body.cancel().catch(() => {});
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export class Skins {
  private readonly cache = new Map<string, { png: Buffer | null; until: number }>();
  private readonly pending = new Map<string, Promise<Buffer | null>>();
  private readonly hosts: Set<string>;

  constructor(private readonly options: SkinOptions) {
    this.hosts = new Set(options.hosts.map((host) => host.toLowerCase()));
  }

  /** PNG des Skins oder null (kein Skin, Fehler, nicht erlaubt). */
  async get(uuid: string): Promise<Buffer | null> {
    const hit = this.cache.get(uuid);
    if (hit && hit.until > Date.now()) return hit.png;
    let loading = this.pending.get(uuid);
    if (!loading) {
      loading = this.load(uuid).finally(() => this.pending.delete(uuid));
      this.pending.set(uuid, loading);
    }
    const png = await loading;
    this.cache.delete(uuid);
    this.cache.set(uuid, { png, until: Date.now() + (png ? CACHE_MS : MISS_CACHE_MS) });
    // Höchstens MAX_ENTRIES: die ältesten Einträge fallen weg (Map behält die Einfügereihenfolge).
    while (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    return png;
  }

  /** Adresse der Skin-Datei, wenn der Host erlaubt ist; außer bei Loopback immer HTTPS. Sonst null. */
  skinUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    const host = url.hostname.toLowerCase();
    if (!this.hosts.has(host)) return null;
    if (isLoopbackHost(host)) return url.toString();
    // Mojang liefert http:// – geladen wird trotzdem über HTTPS, auf dem Standard-Port.
    if (url.port !== '' && url.port !== '80' && url.port !== '443') return null;
    url.protocol = 'https:';
    url.port = '';
    return url.toString();
  }

  private async load(uuid: string): Promise<Buffer | null> {
    try {
      const base = this.options.sessionServer.replace(/\/+$/, '');
      const profileData = await fetchLimited(`${base}/session/minecraft/profile/${uuid}`, MAX_PROFILE_BYTES, this.options.timeoutMs);
      if (!profileData) return null;
      const profile = JSON.parse(profileData.toString('utf8')) as { properties?: unknown };
      const properties = Array.isArray(profile.properties) ? (profile.properties as { name?: unknown; value?: unknown }[]) : [];
      const textures = properties.find((p) => p && p.name === 'textures');
      if (!textures || typeof textures.value !== 'string') return null;
      const decoded = JSON.parse(Buffer.from(textures.value, 'base64').toString('utf8')) as { textures?: { SKIN?: { url?: unknown } } };
      const url = this.skinUrl(decoded.textures?.SKIN?.url);
      if (url === null) return null;
      const png = await fetchLimited(url, MAX_SKIN_BYTES, this.options.timeoutMs);
      if (!png || png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
      return png;
    } catch {
      return null;
    }
  }
}
