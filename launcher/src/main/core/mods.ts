import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './fsutil';
import { fetchJson, syncFiles, type ProgressFn } from './http';

const MANAGED_LIST = '.heldix-managed.json';

export interface ManagedMod {
  filename: string;
  /** Download aus dem Internet … */
  url?: string;
  sha1?: string;
  size?: number;
  /** … oder Kopie einer lokalen Datei (z. B. die mitgelieferte Client-Mod) */
  sourcePath?: string;
}

/**
 * Hält die vom Launcher verwalteten Mods im mods-Ordner aktuell.
 * Mods, die der Spieler selbst hineinlegt, werden nicht angefasst.
 */
export async function syncManagedMods(modsDir: string, mods: ManagedMod[], onProgress?: ProgressFn): Promise<void> {
  await mkdir(modsDir, { recursive: true });
  const listFile = path.join(modsDir, MANAGED_LIST);
  const previous = (await readJson<string[]>(listFile)) ?? [];
  const wanted = new Set(mods.map((m) => m.filename));

  for (const old of previous) {
    if (!wanted.has(old)) await rm(path.join(modsDir, path.basename(old)), { force: true });
  }

  const downloads = mods.filter((m) => m.url);
  await syncFiles(
    downloads.map((m) => ({ url: m.url!, dest: path.join(modsDir, m.filename), sha1: m.sha1, size: m.size })),
    { stage: 'Mods', onProgress, verify: 'sha1' },
  );
  for (const mod of mods) {
    if (mod.sourcePath) await copyFile(mod.sourcePath, path.join(modsDir, mod.filename));
  }
  await writeJson(listFile, [...wanted]);
}

interface ModrinthVersion {
  version_type: 'release' | 'beta' | 'alpha';
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha1: string } }[];
}

/** Neueste passende Datei eines Modrinth-Projekts, z. B. "fabric-api". */
export async function latestModrinthFile(project: string, gameVersion: string, loader = 'fabric'): Promise<ManagedMod | null> {
  const query = new URLSearchParams({
    game_versions: JSON.stringify([gameVersion]),
    loaders: JSON.stringify([loader]),
  });
  const versions = await fetchJson<ModrinthVersion[]>(`https://api.modrinth.com/v2/project/${project}/version?${query}`);
  const version = versions.find((v) => v.version_type === 'release') ?? versions[0];
  if (!version) return null;
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  return { filename: file.filename, url: file.url, sha1: file.hashes.sha1, size: file.size };
}

export interface ClientModBuild {
  file: string;
  modVersion: string;
  minecraft: string;
}

/** Findet gebaute Client-Mods, Dateiname: <prefix>-<modVersion>+<minecraft>.jar */
export async function findClientMods(dir: string, prefix: string): Promise<ClientModBuild[]> {
  const pattern = new RegExp(`^${prefix}-(.+?)\\+(.+)\\.jar$`);
  try {
    const files = await readdir(dir);
    return files.flatMap((file) => {
      const match = pattern.exec(file);
      return match ? [{ file: path.join(dir, file), modVersion: match[1], minecraft: match[2] }] : [];
    });
  } catch {
    return [];
  }
}

export interface LoaderBuild {
  file: string;
  version: string;
}

/** Findet die mitgelieferte Heldix-Loader-JAR (heldix-loader-<version>.jar), bei mehreren die neueste. */
export async function findLoaderJar(dir: string): Promise<LoaderBuild | null> {
  try {
    const builds = (await readdir(dir)).flatMap((file) => {
      const match = /^heldix-loader-(.+)\.jar$/.exec(file);
      return match ? [{ file: path.join(dir, file), version: match[1] }] : [];
    });
    const numeric = (v: string) => v.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
    builds.sort((a, b) => {
      const x = numeric(a.version);
      const y = numeric(b.version);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
      return 0;
    });
    return builds[0] ?? null;
  } catch {
    return null;
  }
}
