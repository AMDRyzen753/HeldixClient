import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson, writeJson } from './fsutil';
import { fetchJson } from './http';
import type { LauncherPaths } from './paths';
import type { VersionJson } from './types';

const META = 'https://meta.fabricmc.net/v2';

/** Alle Minecraft-Versionen, die Fabric unterstützt (mit Cache für den Offline-Fall). */
export async function getFabricGameVersions(paths: LauncherPaths): Promise<Set<string>> {
  const cacheFile = path.join(paths.cache, 'fabric-game-versions.json');
  try {
    const list = await fetchJson<{ version: string }[]>(`${META}/versions/game`);
    const versions = list.map((v) => v.version);
    await writeJson(cacheFile, versions);
    return new Set(versions);
  } catch {
    return new Set((await readJson<string[]>(cacheFile)) ?? []);
  }
}

async function latestLoader(gameVersion: string): Promise<string> {
  const list = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(
    `${META}/versions/loader/${encodeURIComponent(gameVersion)}`,
  );
  if (list.length === 0) throw new Error(`Fabric unterstützt Minecraft ${gameVersion} nicht.`);
  return (list.find((entry) => entry.loader.stable) ?? list[0]).loader.version;
}

async function installedFabricFor(paths: LauncherPaths, gameVersion: string): Promise<string | null> {
  try {
    const suffix = `-${gameVersion}`;
    const dirs = await readdir(paths.versions);
    return dirs.find((d) => d.startsWith('fabric-loader-') && d.endsWith(suffix)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Installiert das Fabric-Profil für eine Minecraft-Version (versions/fabric-loader-X-Y/…json)
 * und gibt dessen Versions-ID zurück. Die eigentlichen Bibliotheken lädt später der normale Installer.
 */
export async function installFabric(paths: LauncherPaths, gameVersion: string): Promise<string> {
  let loader: string;
  try {
    loader = await latestLoader(gameVersion);
  } catch (error) {
    const installed = await installedFabricFor(paths, gameVersion);
    if (installed) return installed;
    throw error;
  }

  const id = `fabric-loader-${loader}-${gameVersion}`;
  const file = path.join(paths.versions, id, `${id}.json`);
  if (!(await exists(file))) {
    const profile = await fetchJson<VersionJson>(
      `${META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loader)}/profile/json`,
    );
    await writeJson(file, profile);
  }
  return id;
}
