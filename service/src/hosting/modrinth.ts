// Dauerhafte Welten (1.13.0): Plugins nur aus dem Modrinth-Katalog. Der Dienst fragt Modrinth stellvertretend (Suche,
// Projekt, Versionen), merkt sich Antworten 5 Minuten und wählt beim Installieren selbst die passende Datei: neueste
// Version für Paper (bzw. Bukkit/Spigot) und die Minecraft-Version der Welt, nur von cdn.modrinth.com, mit SHA-512 aus
// der API. Eigene Plugin-Dateien gibt es nicht.
import { HttpError } from '../http';
import type { PluginFile } from './runner';

export const MODRINTH_API = 'https://api.modrinth.com';
export const MODRINTH_CDN_PREFIX = 'https://cdn.modrinth.com/';
export const MODRINTH_SITE = 'https://modrinth.com';
/** Loader, die auf Paper laufen (Folia und Proxys nicht). */
export const PLUGIN_LOADERS = ['paper', 'bukkit', 'spigot', 'purpur'] as const;
/** Projekt-ID (8 Zeichen) oder Slug bei Modrinth. */
export const PROJECT_RE = /^[A-Za-z0-9._-]{1,64}$/;
/** Dateiname in /data/plugins (siehe runner.ts). */
export const PLUGIN_FILE_RE = /^[A-Za-z0-9._+-]{1,96}\.jar$/;

const CACHE_MS = 5 * 60_000;
const MAX_CACHE = 1000;
const UNREACHABLE = 'Der Plugin-Katalog (Modrinth) ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.';
const NOT_FOUND = 'Dieses Plugin gibt es bei Modrinth nicht.';

export interface ModrinthOptions {
  /** Basis der API (Standard https://api.modrinth.com; anders nur in Tests) */
  api?: string;
  userAgent: string;
  timeoutMs?: number;
}

export interface PluginHit {
  project: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  url: string;
  updatedAt: string | null;
}

export interface PluginVersion {
  id: string;
  name: string;
  versionNumber: string;
  type: string;
  published: string;
  loaders: string[];
  gameVersions: string[];
  file: { name: string; size: number; url: string; sha512: string } | null;
}

export interface PluginProject {
  project: string;
  slug: string;
  title: string;
  description: string;
  icon: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  loaders: string[];
  gameVersions: string[];
  license: string | null;
  source: string | null;
  url: string;
  /** Plugin für Paper/Bukkit/Spigot? (sonst lässt es sich nicht installieren) */
  serverPlugin: boolean;
}

/** Was der Dienst beim Installieren speichert und dem Runner gibt. */
export interface ChosenPlugin {
  project: string;
  slug: string;
  title: string;
  icon: string | null;
  versionId: string;
  versionNumber: string;
  file: PluginFile;
}

interface Cached {
  value: unknown;
  until: number;
}

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const nonNegative = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 200) : []);
/** Nur https-Bilder von Modrinth (sonst null), damit die Webseite keine fremden Adressen lädt. */
const iconUrl = (value: unknown): string | null => (typeof value === 'string' && value.startsWith(MODRINTH_CDN_PREFIX) && value.length <= 500 ? value : null);

/** Dateiname für /data/plugins aus dem Namen bei Modrinth (unerlaubte Zeichen werden zu „-“). */
export function pluginFileName(original: string, slug: string): string {
  let base = original.replace(/\.jar$/i, '').replace(/[^A-Za-z0-9._+-]+/g, '-').replace(/^[.-]+/, '');
  if (base === '') base = slug.replace(/[^A-Za-z0-9._+-]+/g, '-') || 'plugin';
  return `${base.slice(0, 90)}.jar`;
}

export class Modrinth {
  private readonly cache = new Map<string, Cached>();
  private readonly api: string;

  constructor(private readonly options: ModrinthOptions) {
    this.api = (options.api ?? MODRINTH_API).replace(/\/+$/, '');
  }

  /** GET an Modrinth (mit Cache); 404 → null. */
  private async get(pathAndQuery: string): Promise<unknown> {
    const now = Date.now();
    const hit = this.cache.get(pathAndQuery);
    if (hit && hit.until > now) return hit.value;
    let res: Response;
    try {
      res = await fetch(`${this.api}${pathAndQuery}`, {
        headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        redirect: 'error',
      });
    } catch {
      throw new HttpError(502, UNREACHABLE);
    }
    let value: unknown = null;
    if (res.status === 404) {
      await res.body?.cancel();
    } else if (res.status === 200) {
      try {
        value = JSON.parse(await res.text());
      } catch {
        throw new HttpError(502, UNREACHABLE);
      }
    } else {
      await res.body?.cancel();
      throw new HttpError(res.status === 429 ? 503 : 502, UNREACHABLE);
    }
    if (this.cache.size >= MAX_CACHE) {
      for (const [key, entry] of this.cache) if (entry.until <= now) this.cache.delete(key);
      if (this.cache.size >= MAX_CACHE) this.cache.clear();
    }
    this.cache.set(pathAndQuery, { value, until: now + CACHE_MS });
    return value;
  }

  /** Suche nach Paper-Plugins für eine Minecraft-Version. */
  async search(query: string, version: string | null, offset: number, limit: number): Promise<{ hits: PluginHit[]; total: number; offset: number; limit: number }> {
    const facets: string[][] = [['project_type:plugin'], ['categories:paper', 'categories:bukkit', 'categories:spigot']];
    if (version !== null) facets.push([`versions:${version}`]);
    const params = new URLSearchParams({ query, facets: JSON.stringify(facets), offset: String(offset), limit: String(limit), index: 'relevance' });
    const body = (await this.get(`/v2/search?${params.toString()}`)) as { hits?: unknown[]; total_hits?: unknown } | null;
    if (body === null || !Array.isArray(body.hits)) throw new HttpError(502, UNREACHABLE);
    const hits: PluginHit[] = [];
    for (const raw of body.hits) {
      if (typeof raw !== 'object' || raw === null) continue;
      const h = raw as Record<string, unknown>;
      const project = str(h.project_id);
      const slug = str(h.slug);
      if (!PROJECT_RE.test(project) || !PROJECT_RE.test(slug)) continue;
      hits.push({
        project,
        slug,
        title: str(h.title, slug).slice(0, 100),
        description: str(h.description).slice(0, 300),
        author: str(h.author).slice(0, 64),
        icon: iconUrl(h.icon_url),
        downloads: nonNegative(h.downloads),
        follows: nonNegative(h.follows),
        categories: strings(h.categories).slice(0, 20),
        url: `${MODRINTH_SITE}/plugin/${slug}`,
        updatedAt: typeof h.date_modified === 'string' ? h.date_modified : null,
      });
    }
    return { hits, total: nonNegative(body.total_hits), offset, limit };
  }

  /** Ein Projekt (ID oder Slug); unbekannt: 404. */
  async project(id: string): Promise<PluginProject> {
    if (!PROJECT_RE.test(id)) throw new HttpError(400, 'Ungültige Plugin-ID.');
    const body = (await this.get(`/v2/project/${encodeURIComponent(id)}`)) as Record<string, unknown> | null;
    if (body === null) throw new HttpError(404, NOT_FOUND);
    const project = str(body.id);
    const slug = str(body.slug);
    if (!PROJECT_RE.test(project) || !PROJECT_RE.test(slug)) throw new HttpError(502, UNREACHABLE);
    const loaders = strings(body.loaders);
    const license = body.license as { id?: unknown } | undefined;
    const source = str(body.source_url);
    return {
      project,
      slug,
      title: str(body.title, slug).slice(0, 100),
      description: str(body.description).slice(0, 300),
      icon: iconUrl(body.icon_url),
      downloads: nonNegative(body.downloads),
      follows: nonNegative(body.followers),
      categories: strings(body.categories).slice(0, 20),
      loaders,
      gameVersions: strings(body.game_versions),
      license: typeof license?.id === 'string' ? license.id : null,
      source: source.startsWith('https://') && source.length <= 300 ? source : null,
      url: `${MODRINTH_SITE}/plugin/${slug}`,
      serverPlugin: loaders.some((l) => (PLUGIN_LOADERS as readonly string[]).includes(l)),
    };
  }

  /** Versionen eines Projekts für Paper-Loader (und auf Wunsch eine Minecraft-Version), neueste zuerst. */
  async versions(id: string, gameVersion: string | null): Promise<PluginVersion[]> {
    if (!PROJECT_RE.test(id)) throw new HttpError(400, 'Ungültige Plugin-ID.');
    const params = new URLSearchParams({ loaders: JSON.stringify(PLUGIN_LOADERS) });
    if (gameVersion !== null) params.set('game_versions', JSON.stringify([gameVersion]));
    const body = await this.get(`/v2/project/${encodeURIComponent(id)}/version?${params.toString()}`);
    if (body === null) throw new HttpError(404, NOT_FOUND);
    if (!Array.isArray(body)) throw new HttpError(502, UNREACHABLE);
    const out: PluginVersion[] = [];
    for (const raw of body) {
      if (typeof raw !== 'object' || raw === null) continue;
      const v = raw as Record<string, unknown>;
      const versionId = str(v.id);
      if (!PROJECT_RE.test(versionId)) continue;
      const files = Array.isArray(v.files) ? (v.files as Record<string, unknown>[]) : [];
      const jars = files.filter((f) => typeof f === 'object' && f !== null && /\.jar$/i.test(str(f.filename)));
      const primary = jars.find((f) => f.primary === true) ?? jars[0];
      let file: PluginVersion['file'] = null;
      if (primary) {
        const url = str(primary.url);
        const sha512 = str((primary.hashes as Record<string, unknown> | undefined)?.sha512);
        if (url.startsWith(MODRINTH_CDN_PREFIX) && /^[0-9a-f]{128}$/.test(sha512)) {
          file = { name: str(primary.filename).slice(0, 200), size: nonNegative(primary.size), url, sha512 };
        }
      }
      out.push({
        id: versionId,
        name: str(v.name).slice(0, 100),
        versionNumber: str(v.version_number).slice(0, 64),
        type: str(v.version_type, 'release'),
        published: str(v.date_published),
        loaders: strings(v.loaders),
        gameVersions: strings(v.game_versions),
        file,
      });
    }
    return out.sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
  }

  /**
   * Passende Version zum Installieren: neueste mit Paper-Loader, der Minecraft-Version und einer Jar von cdn.modrinth.com
   * (Release vor Beta vor Alpha). Nichts Passendes: 409 mit Erklärung.
   */
  async choose(id: string, gameVersion: string, versionId?: string): Promise<ChosenPlugin> {
    const project = await this.project(id);
    if (!project.serverPlugin) throw new HttpError(409, `„${project.title}“ ist kein Plugin für Paper-Server.`);
    const versions = (await this.versions(project.project, gameVersion)).filter(
      (v) => v.file !== null && v.gameVersions.includes(gameVersion) && v.loaders.some((l) => (PLUGIN_LOADERS as readonly string[]).includes(l)),
    );
    let chosen: PluginVersion | undefined;
    if (versionId !== undefined) {
      chosen = versions.find((v) => v.id === versionId);
      if (!chosen) throw new HttpError(409, `Diese Version von „${project.title}“ passt nicht zu Minecraft ${gameVersion}.`);
    } else {
      const rank = (type: string) => (type === 'release' ? 0 : type === 'beta' ? 1 : 2);
      chosen = [...versions].sort((a, b) => rank(a.type) - rank(b.type))[0];
    }
    if (!chosen || !chosen.file) throw new HttpError(409, `Für Minecraft ${gameVersion} gibt es von „${project.title}“ keine passende Version.`);
    return {
      project: project.project,
      slug: project.slug,
      title: project.title,
      icon: project.icon,
      versionId: chosen.id,
      versionNumber: chosen.versionNumber || chosen.name,
      file: { name: pluginFileName(chosen.file.name, project.slug), url: chosen.file.url, sha512: chosen.file.sha512 },
    };
  }
}
