import { readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ModrinthSearchResult, ModrinthUpdate, PerformancePackResult } from '../../shared/api';
import { contentDir, MODRINTH_INDEX, type ModrinthIndex, type ModrinthIndexEntry } from './content';
import { readJson, writeJson } from './fsutil';
import { fetchJson, runPool, syncFiles, type ProgressFn } from './http';
import { findConflicts, readFabricMods, resolveFabricConflicts, type FabricModInfo } from './fabricmods';

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

// ---------- Updates für Mods von Modrinth ----------

const UPDATE_CACHE_MS = 15 * 60_000;
/** Versionslisten je Projekt und Minecraft-Version (für die Update-Prüfung) */
const versionCache = new Map<string, { at: number; versions: ModrinthVersion[] }>();

/**
 * Versionen eines Projekts für Fabric und diese Minecraft-Version, neueste zuerst; dazu die, die der Launcher nehmen würde.
 * cached: eine höchstens 15 Minuten alte Liste genügt.
 */
async function projectVersions(projectId: string, minecraft: string, cached = false): Promise<{ versions: ModrinthVersion[]; latest: ModrinthVersion | null }> {
  const key = `${projectId}@${minecraft}`;
  const hit = versionCache.get(key);
  let versions: ModrinthVersion[];
  if (cached && hit && Date.now() - hit.at < UPDATE_CACHE_MS) {
    versions = hit.versions;
  } else {
    const query = new URLSearchParams({ loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([minecraft]) });
    versions = await fetchJson<ModrinthVersion[]>(`${API}/project/${projectId}/version?${query}`);
    versionCache.set(key, { at: Date.now(), versions });
  }
  return { versions, latest: versions.find((v) => v.version_type === 'release') ?? versions[0] ?? null };
}

/**
 * Neuere Versionen der über den Launcher von Modrinth installierten Mods (dieselbe Wahl wie beim Installieren: neueste
 * Vollversion, sonst neueste). Ältere „neueste“ Vollversionen (installiert ist eine neuere Beta) und Updates, die schon
 * einmal nicht zu den übrigen Mods passten, zählen nicht. Fehler bei einzelnen Projekten werden übersprungen.
 */
export async function modrinthUpdates(gameDir: string, minecraft: string): Promise<ModrinthUpdate[]> {
  const modsDir = contentDir(gameDir, 'mods');
  const index = (await readJson<ModrinthIndex>(path.join(modsDir, MODRINTH_INDEX))) ?? {};
  const files = new Set(await readdir(modsDir).catch(() => [] as string[]));
  const entries = Object.entries(index).filter(([file, entry]) => (files.has(file) || files.has(`${file}.disabled`)) && /^[A-Za-z0-9]{1,32}$/.test(entry.projectId) && entry.projectId !== FABRIC_API_PROJECT);
  const result: ModrinthUpdate[] = [];
  await runPool(entries, 4, async ([file, entry]) => {
    const { versions, latest } = await projectVersions(entry.projectId, minecraft, true).catch(() => ({ versions: [] as ModrinthVersion[], latest: null }));
    if (!latest || latest.id === entry.versionId) return;
    // passte schon einmal nicht – erst wieder anbieten, wenn sich die andere Mod geändert hat
    if (latest.id === entry.heldUpdate && entry.heldBecause && files.has(entry.heldBecause)) return;
    const installedAt = versions.findIndex((v) => v.id === entry.versionId);
    if (installedAt !== -1 && installedAt < versions.indexOf(latest)) return;
    result.push({ file: files.has(file) ? file : `${file}.disabled`, projectId: entry.projectId, title: entry.title, versionId: latest.id, version: latest.version_number });
  });
  return result.sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

/**
 * Aktualisiert eine Modrinth-Mod auf die neueste passende Version (samt neuer Pflicht-Abhängigkeiten). Verträgt sich die
 * neue Version nicht mit einer anderen Modrinth-Mod (depends/breaks wie bei Fabric, z. B. Iris und Sodium), wird die andere
 * mit aktualisiert, wenn es von ihr eine neuere Version gibt. Passt es dann immer noch nicht, bleibt alles beim Alten –
 * und das Update wird erst wieder angeboten, wenn sich die andere Mod ändert. Ausgeschaltete Mods bleiben ausgeschaltet.
 */
export async function updateModrinthMod(gameDir: string, minecraft: string, file: string, onProgress?: ProgressFn): Promise<{ title: string; version: string; notes: string[] }> {
  if (typeof file !== 'string' || path.basename(file) !== file || !/\.jar(\.disabled)?$/.test(file)) throw new Error(`Ungültiger Dateiname: ${file}`);
  const modsDir = contentDir(gameDir, 'mods');
  const indexFile = path.join(modsDir, MODRINTH_INDEX);
  const index = (await readJson<ModrinthIndex>(indexFile)) ?? {};
  const entry = index[file.replace(/\.disabled$/, '')];
  if (!entry) throw new Error('Diese Mod ist nicht über Modrinth installiert – Updates gibt es nur für Mods von Modrinth.');
  const { latest } = await projectVersions(entry.projectId, minecraft);
  if (!latest || latest.id === entry.versionId) throw new Error(`${entry.title} ist schon aktuell.`);

  interface Staged { base: string; file: string; entry: ModrinthIndexEntry; version: ModrinthVersion; name: string }
  const staged: Staged[] = [];
  // alte Datei als <name>.alt (ohne .jar am Ende: Fabric lädt sie während der Prüfung nicht mit), neue daneben laden
  const stage = async (current: string, owner: ModrinthIndexEntry, version: ModrinthVersion): Promise<Staged> => {
    const download = version.files.find((f) => f.primary) ?? version.files[0];
    const name = download ? path.basename(download.filename) : '';
    if (!download || !/\.jar$/.test(name)) throw new Error(`${owner.title} ${version.version_number} hat keine passende JAR-Datei.`);
    const item = { base: current.replace(/\.disabled$/, ''), file: current, entry: owner, version, name };
    await rename(path.join(modsDir, current), path.join(modsDir, `${item.base}.alt`));
    staged.push(item);
    await syncFiles([{ url: download.url, dest: path.join(modsDir, name), sha1: download.hashes.sha1, size: download.size }], { stage: owner.title, onProgress, verify: 'sha1' });
    return item;
  };
  const rollback = async () => {
    for (const item of [...staged].reverse()) {
      await rm(path.join(modsDir, item.name), { force: true });
      await rename(path.join(modsDir, `${item.base}.alt`), path.join(modsDir, item.file)).catch(() => undefined);
    }
  };

  const disabled = file.endsWith('.disabled');
  try {
    const first = await stage(file, entry, latest);
    // ausgeschaltete Mods lädt Fabric nicht – dann gibt es nichts zu prüfen
    for (let round = 0; !disabled && round < 6; round++) {
      const names = new Set(staged.map((s) => s.name));
      const conflict = findConflicts(await readFabricMods(modsDir)).find((c) => names.has(c.mod.file) || names.has(c.other.file));
      if (!conflict) break;
      const other = names.has(conflict.mod.file) ? conflict.other : conflict.mod;
      const partner = !names.has(other.file) ? index[other.file] : undefined;
      const partnerLatest = partner ? (await projectVersions(partner.projectId, minecraft).catch(() => null))?.latest : null;
      if (partner && partnerLatest && partnerLatest.id !== partner.versionId) {
        await stage(other.file, partner, partnerLatest);
        continue;
      }
      index[first.base] = { ...entry, heldUpdate: latest.id, heldBecause: other.file };
      await writeJson(indexFile, index);
      if (conflict.mod.file === first.name && conflict.kind === 'depends') {
        throw new Error(`${entry.title} ${latest.version_number} braucht eine andere Version von ${other.name} (${conflict.rule}) – die bisherige Version bleibt installiert.`);
      }
      throw new Error(`${entry.title} ${latest.version_number} passt nicht zu ${other.name} ${other.version} – die bisherige Version bleibt installiert.`);
    }
    if (disabled) await rename(path.join(modsDir, first.name), path.join(modsDir, `${first.name}.disabled`));
  } catch (error) {
    await rollback();
    throw error;
  }
  for (const item of staged) {
    await rm(path.join(modsDir, `${item.base}.alt`), { force: true });
    delete index[item.base];
    index[item.name] = { projectId: item.entry.projectId, versionId: item.version.id, title: item.entry.title };
  }
  await writeJson(indexFile, index);

  const notes: string[] = [];
  const partners = staged.slice(1);
  if (partners.length) notes.push(`Damit alles zusammenpasst, auch aktualisiert: ${partners.map((p) => `${p.entry.title} ${p.version.version_number}`).join(', ')}`);
  // neue Pflicht-Abhängigkeiten nachinstallieren
  const present = new Set(Object.values(index).map((e) => e.projectId));
  for (const dependency of staged.flatMap((s) => s.version.dependencies)) {
    if (dependency.dependency_type !== 'required' || !dependency.project_id || present.has(dependency.project_id) || dependency.project_id === FABRIC_API_PROJECT) continue;
    present.add(dependency.project_id);
    try {
      const added = await installModrinth(gameDir, minecraft, dependency.project_id, onProgress);
      if (added.length) notes.push(`Dazu installiert: ${added.join(', ')}`);
    } catch (error) {
      notes.push(`Abhängigkeit nicht installiert: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { title: entry.title, version: latest.version_number, notes };
}
