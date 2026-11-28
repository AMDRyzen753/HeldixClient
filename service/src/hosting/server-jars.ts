// Dauerhafte Welten (1.13.0): welche Server-Software eine Welt bekommt. Zuerst Paper (Plugins gehen) über die Fill-API v3
// (`/v3/projects/paper/versions/<mc>/builds/latest`, nur Kanal STABLE, SHA-256), sonst der Vanilla-Server von Mojang
// (Versions-Manifest, SHA-1; dann ohne Plugins). Antworten werden eine Stunde gemerkt.
import { HttpError } from '../http';
import type { ServerJar } from './runner';

export const PAPER_API = 'https://fill.papermc.io';
export const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
/** Nur von dort lädt ein Runner Server-Jars. */
export const PAPER_DOWNLOAD_PREFIX = 'https://fill-data.papermc.io/';
export const VANILLA_DOWNLOAD_PREFIX = 'https://piston-data.mojang.com/';
/** Minecraft-Version wie „26.3“, „1.21.4“ (keine Snapshots, keine Release-Kandidaten für neue Welten). */
export const RELEASE_VERSION_RE = /^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/;
/** Erlaubt für bestehende Welten (auch Vorabversionen, wenn es dafür einen Server gibt). */
export const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

const CACHE_MS = 60 * 60_000;
const NO_SERVER = (version: string) => `Für Minecraft ${version} gibt es keinen Server (weder Paper noch Vanilla).`;
const UNREACHABLE = 'Die Server-Software ist gerade nicht abrufbar. Bitte gleich noch einmal versuchen.';

export interface ServerJarsOptions {
  /** Basis der Fill-API (Standard https://fill.papermc.io; anders nur in Tests) */
  paperApi?: string;
  /** Versions-Manifest von Mojang (anders nur in Tests) */
  mojangManifest?: string;
  userAgent: string;
  timeoutMs?: number;
}

interface Cached<T> {
  value: T;
  until: number;
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value);
}

export class ServerJars {
  private readonly cache = new Map<string, Cached<unknown>>();
  private readonly paperApi: string;
  private readonly manifestUrl: string;

  constructor(private readonly options: ServerJarsOptions) {
    this.paperApi = (options.paperApi ?? PAPER_API).replace(/\/+$/, '');
    this.manifestUrl = options.mojangManifest ?? MOJANG_MANIFEST;
  }

  private async fetchJson(url: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(url, {
      headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      redirect: 'error',
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value as T;
    const value = await load();
    if (this.cache.size > 200) this.cache.clear();
    this.cache.set(key, { value, until: Date.now() + CACHE_MS });
    return value;
  }

  /** Build aus der Fill-API in ServerJar umwandeln (nur STABLE, nur fill-data.papermc.io, SHA-256 vorhanden). */
  private paperFrom(build: unknown, version: string): ServerJar | null {
    if (typeof build !== 'object' || build === null) return null;
    const b = build as { id?: unknown; channel?: unknown; downloads?: Record<string, { url?: unknown; checksums?: { sha256?: unknown } }> };
    if (b.channel !== 'STABLE' || typeof b.id !== 'number' || !Number.isInteger(b.id)) return null;
    const download = b.downloads?.['server:default'];
    const url = download?.url;
    const sha256 = download?.checksums?.sha256;
    if (typeof url !== 'string' || !url.startsWith(PAPER_DOWNLOAD_PREFIX) || !isHex(sha256, 64)) return null;
    return { software: 'paper', version, url, sha256, build: b.id };
  }

  /** Neuester stabiler Paper-Build für die Version oder null (gibt es nicht). */
  async paper(version: string): Promise<ServerJar | null> {
    return this.cached(`paper:${version}`, async () => {
      const base = `${this.paperApi}/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`;
      const latest = await this.fetchJson(`${base}/latest`);
      if (latest.status === 404) return null;
      if (latest.status !== 200) throw new HttpError(502, UNREACHABLE);
      const direct = this.paperFrom(latest.body, version);
      if (direct) return direct;
      // Der neueste Build ist nicht stabil: unter den stabilen den neuesten nehmen.
      const list = await this.fetchJson(`${base}?channel=STABLE`);
      if (list.status === 404) return null;
      if (list.status !== 200 || !Array.isArray(list.body)) throw new HttpError(502, UNREACHABLE);
      let best: ServerJar | null = null;
      for (const build of list.body) {
        const jar = this.paperFrom(build, version);
        if (jar && (best === null || (jar.build ?? 0) > (best.build ?? 0))) best = jar;
      }
      return best;
    });
  }

  /** Vanilla-Server von Mojang oder null (Version unbekannt oder ohne Server). */
  async vanilla(version: string): Promise<ServerJar | null> {
    const manifest = await this.cached('mojang:manifest', async () => {
      const res = await this.fetchJson(this.manifestUrl);
      if (res.status !== 200 || typeof res.body !== 'object' || res.body === null) throw new HttpError(502, UNREACHABLE);
      return res.body as { versions?: { id?: unknown; url?: unknown }[] };
    });
    const entry = (manifest.versions ?? []).find((v) => v.id === version);
    // Angaben zur Version nur von Mojang (bzw. vom selben Ort wie das Manifest, wenn Tests ein eigenes nutzen)
    const metaOrigin = `${new URL(this.manifestUrl).origin}/`;
    if (!entry || typeof entry.url !== 'string' || !(entry.url.startsWith('https://piston-meta.mojang.com/') || entry.url.startsWith(metaOrigin))) return null;
    const detailUrl = entry.url;
    return this.cached(`mojang:${version}`, async () => {
      const res = await this.fetchJson(detailUrl);
      if (res.status !== 200 || typeof res.body !== 'object' || res.body === null) throw new HttpError(502, UNREACHABLE);
      const server = (res.body as { downloads?: { server?: { url?: unknown; sha1?: unknown } } }).downloads?.server;
      if (!server || typeof server.url !== 'string' || !server.url.startsWith(VANILLA_DOWNLOAD_PREFIX) || !isHex(server.sha1, 40)) return null;
      return { software: 'vanilla', version, url: server.url, sha1: server.sha1, build: null } satisfies ServerJar;
    });
  }

  /** Paper, sonst Vanilla; gibt es beides nicht: 400. */
  async resolve(version: string): Promise<ServerJar> {
    if (!VERSION_RE.test(version)) throw new HttpError(400, 'Ungültige Minecraft-Version.');
    const paper = await this.paper(version);
    if (paper) return paper;
    const vanilla = await this.vanilla(version);
    if (vanilla) return vanilla;
    throw new HttpError(400, NO_SERVER(version));
  }

  /** Neueste Minecraft-Version mit stabilem Paper-Build (für „Neue Welt“ ohne Angabe). */
  async latestVersion(): Promise<string> {
    return this.cached('paper:latest-version', async () => {
      const res = await this.fetchJson(`${this.paperApi}/v3/projects/paper`);
      const versions = (res.body as { versions?: Record<string, unknown> } | null)?.versions;
      if (res.status !== 200 || typeof versions !== 'object' || versions === null) throw new HttpError(502, UNREACHABLE);
      // Gruppen und Versionen kommen neueste zuerst; Vorabversionen überspringen.
      const candidates = Object.values(versions)
        .flatMap((group) => (Array.isArray(group) ? group : []))
        .filter((v): v is string => typeof v === 'string' && RELEASE_VERSION_RE.test(v))
        .slice(0, 6);
      for (const version of candidates) if (await this.paper(version)) return version;
      throw new HttpError(502, UNREACHABLE);
    });
  }
}
