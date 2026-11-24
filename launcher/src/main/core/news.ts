// Minecraft-Neuigkeiten: die offiziellen Patch Notes der Java Edition aus Mojangs Launcher-Feed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { NewsEntry } from '../../shared/api';
import { fetchJson } from './http';
import type { LauncherPaths } from './paths';

const BASE = 'https://launchercontent.mojang.com/v2/';
const FEED = `${BASE}javaPatchNotes.json`;

interface FeedEntry {
  id: string;
  title: string;
  version: string;
  type: string;
  date: string;
  shortText?: string;
  contentPath: string;
  image?: { url: string; title?: string };
}

let entries: FeedEntry[] = [];
let loadedAt = 0;

function toNews(entry: FeedEntry): NewsEntry {
  return {
    id: entry.id,
    title: entry.title,
    version: entry.version,
    type: entry.type === 'release' ? 'release' : 'snapshot',
    date: entry.date,
    summary: entry.shortText ?? '',
    image: entry.image?.url ? new URL(entry.image.url, BASE).toString() : null,
  };
}

/** Die neuesten Einträge; offline aus dem Zwischenspeicher. */
export async function listNews(paths: LauncherPaths, limit = 6): Promise<NewsEntry[]> {
  const cacheFile = path.join(paths.cache, 'java-patch-notes.json');
  if (Date.now() - loadedAt > 30 * 60 * 1000 || entries.length === 0) {
    try {
      const feed = await fetchJson<{ entries: FeedEntry[] }>(FEED);
      entries = (feed.entries ?? []).filter((e) => e.id && e.title && e.contentPath);
      loadedAt = Date.now();
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, JSON.stringify(entries));
    } catch {
      if (entries.length === 0) {
        entries = JSON.parse(await readFile(cacheFile, 'utf8').catch(() => '[]')) as FeedEntry[];
      }
    }
  }
  // Neueste Vollversion immer dabei, dazu die aktuellsten Snapshots
  const sorted = [...entries].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const release = sorted.find((e) => e.type === 'release');
  const picked = sorted.slice(0, limit);
  if (release && !picked.includes(release)) picked.splice(limit - 1, 1, release);
  return picked.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).map(toNews);
}

/** Volltext (HTML von Mojang) eines Eintrags – nur für Einträge aus dem Feed. */
export async function newsBody(id: string): Promise<string> {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error('Diesen Eintrag gibt es nicht (mehr).');
  if (!/^[\w./-]+\.json$/.test(entry.contentPath) || entry.contentPath.includes('..')) throw new Error('Ungültiger Eintrag.');
  const detail = await fetchJson<{ body?: string }>(new URL(entry.contentPath, BASE).toString());
  return detail.body ?? '';
}
