import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { ModrinthSearchResult, PerformancePackResult } from '../../shared/api';
import { contentDir, MODRINTH_INDEX, type ModrinthIndex } from './content';
import { readJson, writeJson } from './fsutil';
import { fetchJson, syncFiles, type ProgressFn } from './http';
import { resolveFabricConflicts, type FabricModInfo } from './fabricmods';

const API = 'https://api.modrinth.com/v2';
/** Fabric API wird vom Launcher selbst verwaltet und hier übersprungen */
const FABRIC_API_PROJECT = 'P7dR8mSH';

interface SearchResponse {
  hits: { project_id: string; slug: string; title: string; description: string; author: string; downloads: number; icon_url: string | null }[];
  total_hits: number;
  offset: number;
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  version_type: 'release' | 'beta' | 'alpha';
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha1: string } }[];
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded' }[];
}

async function installedProjects(modsDir: string): Promise<Set<string>> {
  const index = (await readJson<ModrinthIndex>(path.join(modsDir, MODRINTH_INDEX))) ?? {};
  return new Set(Object.values(index).map((entry) => entry.projectId));
}

/** Fabric-Mods auf Modrinth für eine bestimmte Minecraft-Version suchen. */
export async function searchModrinth(gameDir: string, minecraft: string, query: string, offset: number): Promise<ModrinthSearchResult> {
  const params = new URLSearchParams({
    query: query.trim(),
    facets: JSON.stringify([['project_type:mod'], ['categories:fabric'], [`versions:${minecraft}`]]),
    index: query.trim() ? 'relevance' : 'downloads',
    limit: '20',
    offset: String(Math.max(0, Math.floor(offset))),
  });
  const [result, installed] = await Promise.all([
    fetchJson<SearchResponse>(`${API}/search?${params}`),
    installedProjects(contentDir(gameDir, 'mods')),
  ]);
  return {
    hits: result.hits
      .filter((hit) => hit.project_id !== FABRIC_API_PROJECT)
      .map((hit) => ({
        projectId: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        description: hit.description,
        author: hit.author,
        downloads: hit.downloads,
        iconUrl: hit.icon_url || null,
        installed: installed.has(hit.project_id),
      })),
    total: result.total_hits,
    offset: result.offset,
  };
}

/**
 * Leistungs-Mods für Fabric-Instanzen. Alle von Modrinth, jeweils die neueste passende Version.
 * Sodium ersetzt den Chunk-Renderer, Lithium optimiert die Spiellogik, FerriteCore spart Arbeitsspeicher,
 * ImmediatelyFast beschleunigt HUD, Texte und Partikel, Entity Culling und More Culling zeichnen Verdecktes nicht.
 */
export const PERFORMANCE_PACK: { id: string; name: string }[] = [
  { id: 'AANobbMI', name: 'Sodium' },
  { id: 'gvQqBUqZ', name: 'Lithium' },
  { id: 'uXXizFIs', name: 'FerriteCore' },
  { id: '5ZwdcRci', name: 'ImmediatelyFast' },
  { id: 'NNAgCjsB', name: 'Entity Culling' },
  { id: '51shyZVL', name: 'More Culling' },
];

/**
 * Darf bei einem Konflikt ausgeschaltet werden? Ja für die Zusatz-Mods aus dem Leistungs-Paket
 * (Sodium nicht: das braucht z. B. Iris). Gewollte Mods wie Iris bleiben so immer an.
 */
export async function optionalForConflicts(modsDir: string): Promise<(mod: FabricModInfo) => boolean> {
  const index = (await readJson<ModrinthIndex>(path.join(modsDir, MODRINTH_INDEX))) ?? {};
  const optional = new Set(PERFORMANCE_PACK.filter((m) => m.id !== 'AANobbMI').map((m) => m.id));
  return (mod) => optional.has(index[mod.file]?.projectId ?? '');
}

/** Konflikte zwischen Fabric-Mods der Instanz lösen (siehe fabricmods.ts). */
export async function fixFabricConflicts(gameDir: string): Promise<string[]> {
  const modsDir = contentDir(gameDir, 'mods');
  return resolveFabricConflicts(modsDir, await optionalForConflicts(modsDir));
}

/** Installiert alle Leistungs-Mods, die es für diese Minecraft-Version gibt. */
export async function installPerformancePack(gameDir: string, minecraft: string, onProgress?: ProgressFn): Promise<PerformancePackResult> {
  const result: PerformancePackResult = { installed: [], alreadyInstalled: [], unavailable: [], notes: [] };
  const present = await installedProjects(contentDir(gameDir, 'mods'));
  for (const mod of PERFORMANCE_PACK) {
    if (present.has(mod.id)) {
      result.alreadyInstalled.push(mod.name);
      continue;
    }
    try {
      result.installed.push(...(await installModrinth(gameDir, minecraft, mod.id, onProgress)));
    } catch (error) {
      if (error instanceof Error && error.message.includes('gibt es nicht')) result.unavailable.push(mod.name);
      else throw error;
    }
  }
  // z. B. More Culling braucht ein neueres Sodium, als Iris erlaubt: dann More Culling aus
  result.notes = await fixFabricConflicts(gameDir);
  return result;
}

/**
 * Installiert ein Modrinth-Projekt samt benötigter Abhängigkeiten in den mods-Ordner.
 * Gibt die Namen der neu installierten Mods zurück.
 */
export async function installModrinth(gameDir: string, minecraft: string, projectId: string, onProgress?: ProgressFn): Promise<string[]> {
  if (!/^[A-Za-z0-9]{1,32}$/.test(projectId)) throw new Error('Ungültige Projekt-ID');
  const modsDir = contentDir(gameDir, 'mods');
  const indexFile = path.join(modsDir, MODRINTH_INDEX);
  const index = (await readJson<ModrinthIndex>(indexFile)) ?? {};
  // schon über den Launcher installiert: Projekt → Datei und Version
  const present = new Map(Object.entries(index).map(([file, entry]) => [entry.projectId, { file, versionId: entry.versionId }]));
  const visited = new Set<string>();
  const installed: string[] = [];
  const validId = (value: string | null | undefined): value is string => !!value && /^[A-Za-z0-9]{1,32}$/.test(value);

  const installDependencies = async (version: ModrinthVersion, title: string): Promise<void> => {
    for (const dependency of version.dependencies) {
      if (dependency.dependency_type === 'required' && dependency.project_id) {
        await installOne(dependency.project_id, true, dependency.version_id, title);
      }
    }
  };

  // pinned: genau diese Version. Beispiel: Iris 1.11.7 verlangt Sodium 0.9.2, und Sodium 0.9.3 schließt diese
  // Iris-Version aus. Ist schon ein anderes Sodium installiert, wird es deshalb gegen die verlangte Version getauscht.
  const installOne = async (id: string, isDependency: boolean, pinned?: string | null, requiredBy?: string): Promise<void> => {
    if (id === FABRIC_API_PROJECT || visited.has(id)) return;
    visited.add(id);
    const existing = present.get(id);
    if (existing && (!validId(pinned) || existing.versionId === pinned)) {
      // vorhanden und passend – bei der gewählten Mod trotzdem ihre Abhängigkeiten prüfen
      if (!isDependency && validId(existing.versionId)) {
        const current = await fetchJson<ModrinthVersion>(`${API}/version/${existing.versionId}`).catch(() => null);
        const title = Object.values(index).find((e) => e.projectId === id)?.title ?? id;
        if (current) await installDependencies(current, title);
      }
      return;
    }
    const query = new URLSearchParams({ loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([minecraft]) });
    const [project, versions] = await Promise.all([
      fetchJson<{ title: string }>(`${API}/project/${id}`),
      validId(pinned)
        ? fetchJson<ModrinthVersion>(`${API}/version/${pinned}`).then((v) => [v])
        : fetchJson<ModrinthVersion[]>(`${API}/project/${id}/version?${query}`),
    ]);
    const version = versions.find((v) => v.version_type === 'release') ?? versions[0];
    if (!version) {
      if (isDependency) return;
      throw new Error(`${project.title} gibt es nicht für Minecraft ${minecraft} mit Fabric.`);
    }
    if (existing) {
      // andere Version derselben Mod ersetzen
      await rm(path.join(modsDir, path.basename(existing.file)), { force: true });
      delete index[existing.file];
    }
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    await syncFiles([{ url: file.url, dest: path.join(modsDir, file.filename), sha1: file.hashes.sha1, size: file.size }], {
      stage: project.title,
      onProgress,
      verify: 'sha1',
    });
    index[file.filename] = { projectId: id, versionId: version.id, title: project.title };
    present.set(id, { file: file.filename, versionId: version.id });
    installed.push(existing ? `${project.title} ${version.version_number} (passend zu ${requiredBy ?? 'dieser Instanz'})` : project.title);
    await installDependencies(version, project.title);
  };

  await installOne(projectId, false);
  await writeJson(indexFile, index);
  return installed;
}
