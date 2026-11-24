import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson, writeJson } from './fsutil';
import { fetchJson, syncFiles, type DownloadSpec, type ProgressFn } from './http';
import type { LauncherPaths } from './paths';

// Offizieller Index der Java-Laufzeiten, die auch der Minecraft-Launcher nutzt
const RUNTIME_INDEX_URL =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

type RuntimeIndex = Record<string, Record<string, { manifest: { sha1: string; size: number; url: string }; version: { name: string } }[]>>;

type RuntimeFile =
  | { type: 'directory' }
  | { type: 'link'; target: string }
  | { type: 'file'; executable?: boolean; downloads: { raw: { sha1: string; size: number; url: string } } };

function platformKey(): string {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

function javaExecutable(dir: string): string {
  if (process.platform === 'win32') return path.join(dir, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(dir, 'bin', 'java');
}

async function getRuntimeIndex(paths: LauncherPaths): Promise<RuntimeIndex | null> {
  const cacheFile = path.join(paths.cache, 'java-runtimes.json');
  try {
    const index = await fetchJson<RuntimeIndex>(RUNTIME_INDEX_URL);
    await writeJson(cacheFile, index);
    return index;
  } catch {
    return readJson<RuntimeIndex>(cacheFile);
  }
}

/**
 * Stellt sicher, dass die passende Java-Version (z. B. "java-runtime-epsilon" = Java 25)
 * im Launcher-Ordner liegt, und gibt den Pfad zu java(w) zurück.
 */
export async function ensureJavaRuntime(paths: LauncherPaths, component: string, onProgress?: ProgressFn): Promise<string> {
  const dir = path.join(paths.runtime, component);
  const executable = javaExecutable(dir);
  const marker = path.join(dir, '.heldix-manifest');

  const index = await getRuntimeIndex(paths);
  const entry = index?.[platformKey()]?.[component]?.[0];
  if (!entry) {
    if (await exists(executable)) return executable;
    throw new Error(`Mojang bietet "${component}" nicht für ${platformKey()} an. Bitte in den Einstellungen einen eigenen Java-Pfad angeben.`);
  }

  const installed = await readFile(marker, 'utf8').catch(() => '');
  if (installed === entry.manifest.sha1 && (await exists(executable))) return executable;

  const manifest = await fetchJson<{ files: Record<string, RuntimeFile> }>(entry.manifest.url);
  const downloads: DownloadSpec[] = [];
  const executables: string[] = [];
  const links: [string, string][] = [];
  for (const [rel, file] of Object.entries(manifest.files)) {
    const dest = path.join(dir, rel);
    if (file.type === 'directory') {
      await mkdir(dest, { recursive: true });
    } else if (file.type === 'file') {
      const raw = file.downloads.raw;
      downloads.push({ url: raw.url, dest, sha1: raw.sha1, size: raw.size });
      if (file.executable) executables.push(dest);
    } else if (file.type === 'link') {
      links.push([dest, file.target]);
    }
  }

  await syncFiles(downloads, { stage: `Java ${entry.version.name}`, onProgress, concurrency: 12 });

  if (process.platform !== 'win32') {
    for (const file of executables) await chmod(file, 0o755);
    for (const [dest, target] of links) await symlink(target, dest).catch(() => undefined);
  }
  await writeFile(marker, entry.manifest.sha1);
  return executable;
}

/** Java-Komponente für eine Version; sehr alte Versionen haben keine Angabe und laufen mit Java 8. */
export function javaComponentFor(javaVersion: { component: string } | undefined): string {
  return javaVersion?.component ?? 'jre-legacy';
}
