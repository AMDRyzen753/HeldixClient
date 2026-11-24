import path from 'node:path';
import type { ModrinthSearchResult } from '../../shared/api';
import { contentDir, MODRINTH_INDEX, type ModrinthIndex } from './content';
import { readJson, writeJson } from './fsutil';
import { fetchJson, syncFiles, type ProgressFn } from './http';

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
  version_type: 'release' | 'beta' | 'alpha';
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha1: string } }[];
  dependencies: { project_id: string | null; dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded' }[];
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
 * Installiert ein Modrinth-Projekt samt benötigter Abhängigkeiten in den mods-Ordner.
 * Gibt die Namen der neu installierten Mods zurück.
 */
export async function installModrinth(gameDir: string, minecraft: string, projectId: string, onProgress?: ProgressFn): Promise<string[]> {
  if (!/^[A-Za-z0-9]{1,32}$/.test(projectId)) throw new Error('Ungültige Projekt-ID');
  const modsDir = contentDir(gameDir, 'mods');
  const indexFile = path.join(modsDir, MODRINTH_INDEX);
  const index = (await readJson<ModrinthIndex>(indexFile)) ?? {};
  const already = new Set(Object.values(index).map((entry) => entry.projectId));
  const visited = new Set<string>();
  const installed: string[] = [];

  const installOne = async (id: string, isDependency: boolean): Promise<void> => {
    if (id === FABRIC_API_PROJECT || visited.has(id) || already.has(id)) return;
    visited.add(id);
    const query = new URLSearchParams({ loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([minecraft]) });
    const [project, versions] = await Promise.all([
      fetchJson<{ title: string }>(`${API}/project/${id}`),
      fetchJson<ModrinthVersion[]>(`${API}/project/${id}/version?${query}`),
    ]);
    const version = versions.find((v) => v.version_type === 'release') ?? versions[0];
    if (!version) {
      if (isDependency) return;
      throw new Error(`${project.title} gibt es nicht für Minecraft ${minecraft} mit Fabric.`);
    }
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    await syncFiles([{ url: file.url, dest: path.join(modsDir, file.filename), sha1: file.hashes.sha1, size: file.size }], {
      stage: project.title,
      onProgress,
      verify: 'sha1',
    });
    index[file.filename] = { projectId: id, versionId: version.id, title: project.title };
    installed.push(project.title);
    for (const dependency of version.dependencies) {
      if (dependency.dependency_type === 'required' && dependency.project_id) {
        await installOne(dependency.project_id, true);
      }
    }
  };

  await installOne(projectId, false);
  await writeJson(indexFile, index);
  return installed;
}
