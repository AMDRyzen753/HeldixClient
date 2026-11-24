import AdmZip from 'adm-zip';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson, writeJson } from './fsutil';
import { fetchJson, syncFiles, type DownloadSpec, type ProgressFn } from './http';
import type { LauncherPaths } from './paths';
import { OS_NAME, rulesAllow } from './rules';
import type { AssetIndex, Library, ResolvedVersion, VersionJson } from './types';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES_URL = 'https://resources.download.minecraft.net';
const DEFAULT_MAVEN = 'https://libraries.minecraft.net/';

export interface ManifestVersion {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
}

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: ManifestVersion[];
}

/** Lädt die Versionsliste von Mojang, bei fehlendem Internet aus dem Cache. */
export async function getVersionManifest(paths: LauncherPaths): Promise<{ manifest: VersionManifest; offline: boolean }> {
  const cacheFile = path.join(paths.cache, 'version_manifest_v2.json');
  try {
    const manifest = await fetchJson<VersionManifest>(MANIFEST_URL);
    await writeJson(cacheFile, manifest);
    return { manifest, offline: false };
  } catch (error) {
    const cached = await readJson<VersionManifest>(cacheFile);
    if (cached) return { manifest: cached, offline: true };
    throw error;
  }
}

async function loadVersionJson(paths: LauncherPaths, id: string, manifest: VersionManifest | null): Promise<VersionJson> {
  const file = path.join(paths.versions, id, `${id}.json`);
  const entry = manifest?.versions.find((v) => v.id === id);
  if (entry) {
    await syncFiles([{ url: entry.url, dest: file, sha1: entry.sha1 }], { stage: 'Versionsdaten', verify: 'sha1' });
  }
  const json = await readJson<VersionJson>(file);
  if (!json) throw new Error(`Version ${id} ist nicht installiert und nicht in der Versionsliste.`);
  return json;
}

function libraryKey(lib: Library): string {
  const [group, artifact, , classifier] = lib.name.split(':');
  return classifier ? `${group}:${artifact}:${classifier}` : `${group}:${artifact}`;
}

function mergeVersions(parent: ResolvedVersion, child: VersionJson): ResolvedVersion {
  const childKeys = new Set(child.libraries.map(libraryKey));
  const hasArguments = parent.arguments || child.arguments;
  return {
    ...parent,
    id: child.id,
    type: child.type ?? parent.type,
    mainClass: child.mainClass ?? parent.mainClass,
    jarId: child.jar ?? parent.jarId,
    baseId: parent.baseId,
    inheritsFrom: undefined,
    libraries: [...child.libraries, ...parent.libraries.filter((lib) => !childKeys.has(libraryKey(lib)))],
    arguments: hasArguments
      ? {
          game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
          jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
        }
      : undefined,
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    assets: child.assets ?? parent.assets,
    downloads: child.downloads ?? parent.downloads,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    logging: child.logging ?? parent.logging,
  };
}

/** Lädt eine Version samt allen Eltern (inheritsFrom) und führt sie zusammen. */
export async function resolveVersion(paths: LauncherPaths, id: string, manifest: VersionManifest | null): Promise<ResolvedVersion> {
  const json = await loadVersionJson(paths, id, manifest);
  if (json.inheritsFrom) {
    const parent = await resolveVersion(paths, json.inheritsFrom, manifest);
    return mergeVersions(parent, json);
  }
  return { ...json, jarId: json.jar ?? json.id, baseId: json.id };
}

/** "group:artifact:version[:classifier][@ext]" -> Pfad im Maven-Repository */
export function mavenPath(coordinate: string): string {
  const [main, ext = 'jar'] = coordinate.split('@');
  const [group, artifact, version, classifier] = main.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

export interface LibraryFile {
  spec: DownloadSpec;
  /** gehört in den Classpath (sonst: nur zum Entpacken von Natives) */
  classpath: boolean;
  extractExclude?: string[];
}

export function collectLibraries(paths: LauncherPaths, version: ResolvedVersion): LibraryFile[] {
  const files: LibraryFile[] = [];
  for (const lib of version.libraries) {
    if (!rulesAllow(lib.rules)) continue;

    const artifact = lib.downloads?.artifact;
    if (artifact) {
      const rel = artifact.path ?? mavenPath(lib.name);
      files.push({ spec: { url: artifact.url, dest: path.join(paths.libraries, rel), sha1: artifact.sha1, size: artifact.size }, classpath: true });
    } else if (!lib.downloads) {
      // Maven-Stil (Fabric): name + url
      const rel = mavenPath(lib.name);
      const base = (lib.url ?? DEFAULT_MAVEN).replace(/\/?$/, '/');
      files.push({ spec: { url: base + rel, dest: path.join(paths.libraries, rel), sha1: lib.sha1, size: lib.size }, classpath: true });
    }

    // Alte Versionen (bis 1.18): Natives als separate Classifier-JAR, die entpackt werden muss
    const classifierTemplate = lib.natives?.[OS_NAME];
    if (classifierTemplate) {
      const classifier = classifierTemplate.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const native = lib.downloads?.classifiers?.[classifier];
      const rel = native?.path ?? mavenPath(`${lib.name}:${classifier}`);
      const url = native?.url ?? (lib.url ?? DEFAULT_MAVEN).replace(/\/?$/, '/') + rel;
      files.push({
        spec: { url, dest: path.join(paths.libraries, rel), sha1: native?.sha1, size: native?.size },
        classpath: false,
        extractExclude: lib.extract?.exclude ?? [],
      });
    }
  }
  return files;
}

export function clientJarPath(paths: LauncherPaths, version: ResolvedVersion): string {
  return path.join(paths.versions, version.jarId, `${version.jarId}.jar`);
}

export async function installClientJar(paths: LauncherPaths, version: ResolvedVersion, onProgress?: ProgressFn): Promise<string> {
  const dest = clientJarPath(paths, version);
  const client = version.downloads?.client;
  if (client) {
    await syncFiles([{ url: client.url, dest, sha1: client.sha1, size: client.size }], { stage: 'Spieldatei', onProgress, verify: 'sha1' });
  } else if (!(await exists(dest))) {
    throw new Error(`Für ${version.jarId} gibt es keine client.jar.`);
  }
  return dest;
}

export async function installLibraries(files: LibraryFile[], onProgress?: ProgressFn): Promise<void> {
  await syncFiles(
    files.map((f) => f.spec),
    { stage: 'Bibliotheken', onProgress, concurrency: 12 },
  );
}

/** Entpackt Natives alter Versionen in nativesDir. Neue Versionen entpacken LWJGL selbst. */
export async function extractNatives(files: LibraryFile[], nativesDir: string): Promise<void> {
  await mkdir(nativesDir, { recursive: true });
  const natives = files.filter((f) => f.extractExclude);
  if (natives.length === 0) return;

  const marker = path.join(nativesDir, '.extracted');
  const signature = natives.map((f) => path.basename(f.spec.dest)).sort().join('\n');
  if ((await readJson<{ signature: string }>(marker))?.signature === signature) return;

  const root = path.resolve(nativesDir);
  for (const file of natives) {
    const zip = new AdmZip(file.spec.dest);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (file.extractExclude!.some((prefix) => entry.entryName.startsWith(prefix))) continue;
      const target = path.resolve(root, entry.entryName);
      if (!target.startsWith(root + path.sep)) continue; // Schutz vor "../" in ZIP-Einträgen
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await writeFile(target, entry.getData());
      } catch (error) {
        // Datei ist evtl. von einer laufenden Instanz gesperrt (Windows); dann ist sie schon da.
        if (!(await exists(target))) throw error;
      }
    }
  }
  await writeJson(marker, { signature });
}

/**
 * Lädt Asset-Index und alle Assets. Gibt das Verzeichnis zurück, das als
 * ${game_assets} genutzt wird (nur für sehr alte Versionen relevant).
 */
export async function installAssets(paths: LauncherPaths, version: ResolvedVersion, gameDir: string, onProgress?: ProgressFn): Promise<string> {
  const info = version.assetIndex;
  if (!info) return paths.assets;

  const indexFile = path.join(paths.assets, 'indexes', `${info.id}.json`);
  await syncFiles([{ url: info.url, dest: indexFile, sha1: info.sha1, size: info.size }], { stage: 'Assets-Index', verify: 'sha1' });
  const index = await readJson<AssetIndex>(indexFile);
  if (!index) throw new Error('Asset-Index konnte nicht gelesen werden.');

  const objectPath = (hash: string) => path.join(paths.assets, 'objects', hash.slice(0, 2), hash);
  const specs = Object.values(index.objects).map((o) => ({
    url: `${RESOURCES_URL}/${o.hash.slice(0, 2)}/${o.hash}`,
    dest: objectPath(o.hash),
    sha1: o.hash,
    size: o.size,
  }));
  await syncFiles(specs, { stage: 'Assets', onProgress, concurrency: 24 });

  if (!index.virtual && !index.map_to_resources) return paths.assets;

  // Versionen vor 1.7.10 erwarten die Dateien unter ihrem echten Namen
  const targetRoot = index.map_to_resources ? path.join(gameDir, 'resources') : path.join(paths.assets, 'virtual', info.id);
  for (const [name, o] of Object.entries(index.objects)) {
    const target = path.join(targetRoot, name);
    if (await exists(target)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(objectPath(o.hash), target);
  }
  return targetRoot;
}

export async function installLoggingConfig(paths: LauncherPaths, version: ResolvedVersion): Promise<string | null> {
  const logging = version.logging?.client;
  if (!logging) return null;
  const dest = path.join(paths.assets, 'log_configs', logging.file.id);
  await syncFiles([{ url: logging.file.url, dest, sha1: logging.file.sha1, size: logging.file.size }], { stage: 'Logging', verify: 'sha1' });
  return dest;
}

/** Lokal installierte Versionen (z. B. für den Offline-Fall). */
export async function listInstalledVersions(paths: LauncherPaths): Promise<string[]> {
  try {
    const entries = await readdir(paths.versions, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && (await exists(path.join(paths.versions, entry.name, `${entry.name}.json`)))) {
        result.push(entry.name);
      }
    }
    return result;
  } catch {
    return [];
  }
}
