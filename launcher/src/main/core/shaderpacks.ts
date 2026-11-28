// Shaderpacks (BSL, Complementary, Photon …) für Fabric-Instanzen. Sie laufen über Iris; Iris und Sodium
// installiert der Launcher beim ersten Shaderpack automatisch von Modrinth. Welches Pack aktiv ist, steht
// in config/iris.properties – genau dort, wo Iris selbst es speichert.

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModrinthSearchResult, ShaderpackInfo, ShaderpackList } from '../../shared/api';
import { contentDir, MODRINTH_INDEX, type ModrinthIndex } from './content';
import { readJson, writeJson } from './fsutil';
import { fetchJson, syncFiles, type ProgressFn } from './http';
import { fixFabricConflicts, installModrinth } from './modrinth';

const API = 'https://api.modrinth.com/v2';
export const IRIS_PROJECT = 'YL57xq9U';
export const SODIUM_PROJECT = 'AANobbMI';
export const SHADERPACK_DIR = 'shaderpacks';
/** Shaderpacks von Modrinth: Datei → Projekt, Version, Titel (auch für „Setup teilen“, core/setupinstall.ts) */
export const SHADERPACK_INDEX = '.heldix-shaderpacks.json';
const IRIS_CONFIG = path.join('config', 'iris.properties');

type ShaderpackIndex = Record<string, { projectId: string; versionId: string; title: string }>;

interface ShaderVersion {
  id: string;
  version_number: string;
  version_type: 'release' | 'beta' | 'alpha';
  loaders: string[];
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha1: string } }[];
}

function shaderDir(gameDir: string): string {
  return path.join(gameDir, SHADERPACK_DIR);
}

/** Nur ein Dateiname, nur .zip oder ein Ordner ohne Pfadteile. */
function assertPackName(file: string): string {
  if (typeof file !== 'string' || !file || path.basename(file) !== file || file.startsWith('.')) throw new Error(`Ungültiger Name: ${file}`);
  return file;
}

// ---------- iris.properties ----------

async function readIrisConfig(gameDir: string): Promise<Map<string, string>> {
  const text = await readFile(path.join(gameDir, IRIS_CONFIG), 'utf8').catch(() => '');
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*)$/.exec(line);
    if (match) values.set(match[1], match[2].replace(/\\(.)/g, '$1'));
  }
  return values;
}

/** Setzt Schlüssel in iris.properties und lässt alle anderen Zeilen (Iris-Einstellungen) unverändert. */
async function writeIrisConfig(gameDir: string, changes: Record<string, string>): Promise<void> {
  const file = path.join(gameDir, IRIS_CONFIG);
  const lines = (await readFile(file, 'utf8').catch(() => '')).split(/\r?\n/).filter((line, i, all) => line !== '' || i < all.length - 1);
  const pending = new Map(Object.entries(changes));
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/=/g, '\\=');
  const out = lines.map((line) => {
    const key = /^\s*([^#!=:\s][^=:]*?)\s*[=:]/.exec(line)?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key)!;
      pending.delete(key);
      return `${key}=${escape(value)}`;
    }
    return line;
  });
  if (out.length === 0) out.push('# Iris-Einstellungen (vom HeldixClient-Launcher angelegt)');
  for (const [key, value] of pending) out.push(`${key}=${escape(value)}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${out.join('\n')}\n`);
}

// ---------- Status und Liste ----------

async function modProjects(gameDir: string): Promise<{ iris: string | null; sodium: string | null }> {
  const modsDir = contentDir(gameDir, 'mods');
  const index = (await readJson<ModrinthIndex>(path.join(modsDir, MODRINTH_INDEX))) ?? {};
  const files = await readdir(modsDir).catch(() => [] as string[]);
  const find = (projectId: string, prefix: RegExp) => {
    const indexed = Object.entries(index).find(([file, entry]) => entry.projectId === projectId && files.includes(file));
    if (indexed) return indexed[0];
    return files.find((f) => prefix.test(f) && f.endsWith('.jar')) ?? null;
  };
  return { iris: find(IRIS_PROJECT, /^iris/i), sodium: find(SODIUM_PROJECT, /^sodium/i) };
}

export async function listShaderpacks(gameDir: string): Promise<ShaderpackList> {
  const dir = shaderDir(gameDir);
  const index = (await readJson<ShaderpackIndex>(path.join(dir, SHADERPACK_INDEX))) ?? {};
  const config = await readIrisConfig(gameDir);
  const enabled = config.get('enableShaders') !== 'false';
  const active = enabled ? (config.get('shaderPack') ?? null) : null;
  const packs: ShaderpackInfo[] = [];
  for (const file of await readdir(dir).catch(() => [] as string[])) {
    if (file.startsWith('.')) continue;
    const info = await stat(path.join(dir, file)).catch(() => null);
    if (!info || (!info.isDirectory() && !file.toLowerCase().endsWith('.zip'))) continue;
    packs.push({
      file,
      name: index[file]?.title ?? file.replace(/\.zip$/i, '').replace(/[_+]/g, ' '),
      sizeBytes: info.isDirectory() ? null : info.size,
      projectId: index[file]?.projectId ?? null,
      active: file === active,
    });
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));
  const mods = await modProjects(gameDir);
  return { packs, active: packs.some((p) => p.active) ? active : null, irisInstalled: mods.iris != null, sodiumInstalled: mods.sodium != null };
}

// ---------- Modrinth ----------

/** Shaderpacks für Iris auf Modrinth suchen (beliebteste zuerst, wenn ohne Suchbegriff). */
export async function searchShaderpacks(gameDir: string, minecraft: string, query: string, offset: number): Promise<ModrinthSearchResult> {
  const params = new URLSearchParams({
    query: query.trim(),
    facets: JSON.stringify([['project_type:shader'], ['categories:iris'], [`versions:${minecraft}`]]),
    index: query.trim() ? 'relevance' : 'downloads',
    limit: '20',
    offset: String(Math.max(0, Math.floor(offset))),
  });
  const [result, index] = await Promise.all([
    fetchJson<{ hits: { project_id: string; slug: string; title: string; description: string; author: string; downloads: number; icon_url: string | null }[]; total_hits: number; offset: number }>(`${API}/search?${params}`),
    readJson<ShaderpackIndex>(path.join(shaderDir(gameDir), SHADERPACK_INDEX)),
  ]);
  const installed = new Set(Object.values(index ?? {}).map((e) => e.projectId));
  return {
    hits: result.hits.map((hit) => ({
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

/** Iris (mit dem passenden Sodium) installieren, falls es fehlt. Gibt die neu installierten Mods zurück. */
export async function ensureIris(gameDir: string, minecraft: string, onProgress?: ProgressFn): Promise<string[]> {
  const modsDir = contentDir(gameDir, 'mods');
  const index = (await readJson<ModrinthIndex>(path.join(modsDir, MODRINTH_INDEX))) ?? {};
  const mods = await modProjects(gameDir);
  // Iris von Hand hinzugefügt (nicht über den Launcher): Version unbekannt, also nichts anfassen
  if (mods.iris && !index[mods.iris]) return [];
  // sonst immer über Modrinth prüfen: Iris verlangt eine bestimmte Sodium-Version (z. B. 0.9.2),
  // ein neueres Sodium aus dem Leistungs-Paket wird dabei gegen diese getauscht
  return installModrinth(gameDir, minecraft, IRIS_PROJECT, onProgress);
}

/**
 * Lädt ein Shaderpack von Modrinth in den shaderpacks-Ordner, installiert bei Bedarf Iris + Sodium
 * und schaltet das Pack ein. Gibt den Namen des Packs und die nachinstallierten Mods zurück.
 */
export async function installShaderpack(gameDir: string, minecraft: string, projectId: string, onProgress?: ProgressFn): Promise<{ title: string; mods: string[]; notes: string[] }> {
  if (!/^[A-Za-z0-9]{1,32}$/.test(projectId)) throw new Error('Ungültige Projekt-ID');
  const query = new URLSearchParams({ loaders: JSON.stringify(['iris']), game_versions: JSON.stringify([minecraft]) });
  const [project, versions] = await Promise.all([
    fetchJson<{ title: string; project_type: string }>(`${API}/project/${projectId}`),
    fetchJson<ShaderVersion[]>(`${API}/project/${projectId}/version?${query}`),
  ]);
  if (project.project_type !== 'shader') throw new Error(`${project.title} ist kein Shaderpack.`);
  const version = versions.find((v) => v.version_type === 'release') ?? versions[0];
  if (!version) throw new Error(`${project.title} gibt es nicht für Minecraft ${minecraft} mit Iris.`);
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  const dir = shaderDir(gameDir);
  await mkdir(dir, { recursive: true });
  await syncFiles([{ url: file.url, dest: path.join(dir, assertPackName(file.filename)), sha1: file.hashes.sha1, size: file.size }], {
    stage: project.title,
    onProgress,
    verify: 'sha1',
  });
  const indexFile = path.join(dir, SHADERPACK_INDEX);
  const index = (await readJson<ShaderpackIndex>(indexFile)) ?? {};
  // ältere Version desselben Packs ersetzen
  for (const [old, entry] of Object.entries(index)) {
    if (entry.projectId === projectId && old !== file.filename) {
      await rm(path.join(dir, old), { recursive: true, force: true });
      delete index[old];
    }
  }
  index[file.filename] = { projectId, versionId: version.id, title: project.title };
  await writeJson(indexFile, index);

  const mods = await ensureIris(gameDir, minecraft, onProgress);
  const notes = await fixFabricConflicts(gameDir);
  await setActiveShaderpack(gameDir, file.filename);
  return { title: project.title, mods, notes };
}

/** Pack in Iris einschalten (null = Shader aus). */
export async function setActiveShaderpack(gameDir: string, file: string | null): Promise<void> {
  if (file == null) {
    await writeIrisConfig(gameDir, { enableShaders: 'false' });
    return;
  }
  const name = assertPackName(file);
  const exists = await stat(path.join(shaderDir(gameDir), name)).catch(() => null);
  if (!exists) throw new Error(`Shaderpack ${name} ist nicht installiert.`);
  await writeIrisConfig(gameDir, { shaderPack: name, enableShaders: 'true' });
}

export async function removeShaderpack(gameDir: string, file: string): Promise<void> {
  const name = assertPackName(file);
  const dir = shaderDir(gameDir);
  await rm(path.join(dir, name), { recursive: true, force: true });
  const indexFile = path.join(dir, SHADERPACK_INDEX);
  const index = (await readJson<ShaderpackIndex>(indexFile)) ?? {};
  if (index[name]) {
    delete index[name];
    await writeJson(indexFile, index);
  }
  const config = await readIrisConfig(gameDir);
  if (config.get('shaderPack') === name) await writeIrisConfig(gameDir, { enableShaders: 'false' });
}

/** Eigene Shaderpack-Dateien (.zip) übernehmen. */
export async function addShaderpackFiles(gameDir: string, files: string[]): Promise<number> {
  const dir = shaderDir(gameDir);
  await mkdir(dir, { recursive: true });
  let added = 0;
  for (const source of files) {
    if (typeof source !== 'string' || !source.toLowerCase().endsWith('.zip')) continue;
    await copyFile(source, path.join(dir, path.basename(source)));
    added++;
  }
  return added;
}
