import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { InstanceLoader } from '../../shared/api';
import { installFabric } from './fabric';
import { ADDON_DIR } from './instances';
import type { ProgressFn } from './http';
import { ensureJavaRuntime, javaComponentFor } from './java';
import { MANAGED_LIST } from './content';
import { fixFabricConflicts } from './modrinth';
import { readJson } from './fsutil';
import { findClientMods, findFabricLoaderJar, findLoaderJar, latestModrinthFile, syncManagedMods, type ManagedMod } from './mods';
import {
  collectLibraries,
  extractNatives,
  getVersionManifest,
  installAssets,
  installClientJar,
  installLibraries,
  installLoggingConfig,
  resolveVersion,
} from './mojang';
import type { LauncherPaths } from './paths';
import type { ResolvedVersion } from './types';

export interface PrepareOptions {
  paths: LauncherPaths;
  /** Minecraft-Version, z. B. "26.3" */
  versionId: string;
  loader: InstanceLoader;
  /** Spielordner der Instanz */
  gameDir: string;
  /** Ordner mit gebauten Client-Mods (heldixclient-*.jar) */
  clientModsDir: string | null;
  clientModPrefix: string;
  /** Ordner mit der Heldix-Loader-JAR (heldix-loader-*.jar) */
  loaderDir: string | null;
  /** Ordner mit dem Heldix Loader als Fabric-Mod (heldix-loader-fabric-*.jar) */
  fabricLoaderDir?: string | null;
  /** nur Fabric: HeldixClient mitstarten (fehlt = ja) */
  heldixClient?: boolean;
  /** eigener Java-Pfad statt der von Mojang bereitgestellten Laufzeit */
  javaOverride?: string;
  onProgress?: ProgressFn;
  onInfo?: (message: string) => void;
}

export interface PreparedGame {
  version: ResolvedVersion;
  javaPath: string;
  classpath: string[];
  gameDir: string;
  nativesDir: string;
  legacyAssetsDir: string;
  loggingConfig: string | null;
  clientModLoaded: boolean;
  /** Zusätzliche JVM-Argumente, z. B. -javaagent für den Heldix Loader */
  loaderJvmArgs: string[];
  /** Version des Heldix Loaders, wenn er benutzt wird */
  loaderVersion: string | null;
  /** Client-JAR von Minecraft */
  clientJar: string;
  /** Java-Hauptversion der Mojang-Laufzeit (null bei eigenem Java-Pfad: unbekannt) */
  javaMajor: number | null;
}

/** Kopiert die Loader-JAR in den Bibliotheksordner, damit das laufende Spiel nicht auf den Launcher-Ordner zugreift. */
async function installLoader(paths: LauncherPaths, loaderDir: string | null): Promise<{ jar: string; version: string }> {
  const build = loaderDir ? await findLoaderJar(loaderDir) : null;
  if (!build) throw new Error('Der Heldix Loader fehlt in dieser Launcher-Installation (resources/heldix-loader).');
  const target = path.join(paths.libraries, 'dev', 'heldixclient', 'heldix-loader', build.version, `heldix-loader-${build.version}.jar`);
  const [source, existing] = await Promise.all([stat(build.file), stat(target).catch(() => null)]);
  if (!existing || existing.size !== source.size || existing.mtimeMs < source.mtimeMs) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(build.file, target);
  }
  return { jar: target, version: build.version };
}

/** Lädt alles herunter, was für den Start einer Instanz nötig ist. */
export async function prepareGame(options: PrepareOptions): Promise<PreparedGame> {
  const { paths, versionId, loader, gameDir, onProgress } = options;
  const info = options.onInfo ?? (() => undefined);
  await mkdir(gameDir, { recursive: true });

  // Heldix-Instanzen brauchen eine gebaute HeldixClient-Mod für genau diese Minecraft-Version;
  // Fabric-Instanzen bekommen sie dazu, wenn es sie für die Version gibt
  const wantsClient = loader === 'heldix' || (loader === 'fabric' && options.heldixClient !== false);
  const clientMod =
    wantsClient && options.clientModsDir
      ? (await findClientMods(options.clientModsDir, options.clientModPrefix)).find((m) => m.minecraft === versionId)
      : undefined;
  if (loader === 'heldix' && !clientMod) {
    throw new Error(`Für Minecraft ${versionId} gibt es noch keine HeldixClient-Mod. Wähle für diese Instanz Fabric oder Vanilla.`);
  }

  const { manifest, offline } = await getVersionManifest(paths).catch(() => ({ manifest: null, offline: true }));
  if (offline) info('Keine Verbindung zu Mojang, nutze lokale Daten.');

  // Nur Fabric-Instanzen nutzen Fabric. Der Heldix Loader startet Vanilla-Minecraft und klinkt sich als Java-Agent ein.
  const launchId = loader === 'fabric' ? await installFabric(paths, versionId) : versionId;
  const version = await resolveVersion(paths, launchId, manifest);
  info(`Version ${version.id} (Java ${version.javaVersion?.majorVersion ?? 8})`);

  const clientJar = await installClientJar(paths, version, onProgress);
  const libraries = collectLibraries(paths, version);
  await installLibraries(libraries, onProgress);

  const nativesDir = path.join(paths.natives, version.id);
  await extractNatives(libraries, nativesDir);

  const legacyAssetsDir = await installAssets(paths, version, gameDir, onProgress);
  const loggingConfig = await installLoggingConfig(paths, version);

  const javaPath = options.javaOverride?.trim()
    ? options.javaOverride.trim()
    : await ensureJavaRuntime(paths, javaComponentFor(version.javaVersion), onProgress);

  const modsDir = path.join(gameDir, 'mods');
  let clientModLoaded = false;
  let loaderJvmArgs: string[] = [];
  let loaderVersion: string | null = null;

  if (loader === 'heldix' && clientMod) {
    const heldixLoader = await installLoader(paths, options.loaderDir);
    loaderVersion = heldixLoader.version;
    loaderJvmArgs = [`-javaagent:${heldixLoader.jar}`, `-Dheldix.gameDir=${gameDir}`];
    // Verwaltete Mods: nur noch die HeldixClient-Mod (Fabric API aus früheren Versionen wird dabei entfernt)
    await syncManagedMods(modsDir, [{ filename: path.basename(clientMod.file), sourcePath: clientMod.file }], onProgress);
    await mkdir(path.join(gameDir, ADDON_DIR), { recursive: true });
    clientModLoaded = true;
    info(`Heldix Loader ${heldixLoader.version} mit HeldixClient ${clientMod.modVersion}`);
  }

  if (loader === 'fabric') {
    const managed: ManagedMod[] = [];
    const fabricApi = await latestModrinthFile('fabric-api', versionId).catch(() => undefined);
    if (fabricApi === undefined) {
      // Modrinth nicht erreichbar: bisher verwaltete Fabric API behalten
      info('Fabric API konnte nicht geprüft werden, nutze die vorhandene Version.');
      const previous = (await readJson<string[]>(path.join(modsDir, MANAGED_LIST))) ?? [];
      for (const file of previous.filter((f) => f.startsWith('fabric-api'))) managed.push({ filename: file });
    } else if (fabricApi) {
      managed.push(fabricApi);
    } else {
      info(`Fabric API gibt es für ${versionId} nicht, starte nur mit Fabric Loader.`);
    }
    // HeldixClient über den Heldix Loader als Fabric-Mod
    if (wantsClient) {
      const bridge = options.fabricLoaderDir ? await findFabricLoaderJar(options.fabricLoaderDir) : null;
      if (!clientMod) {
        info(`HeldixClient gibt es für Minecraft ${versionId} noch nicht – die Instanz startet ohne.`);
      } else if (!bridge) {
        info('Heldix Loader (Fabric) fehlt in dieser Launcher-Installation – die Instanz startet ohne HeldixClient.');
      } else {
        managed.push({ filename: path.basename(bridge.file), sourcePath: bridge.file });
        managed.push({ filename: path.basename(clientMod.file), sourcePath: clientMod.file });
        await mkdir(path.join(gameDir, ADDON_DIR), { recursive: true });
        clientModLoaded = true;
        loaderVersion = bridge.version;
        info(`HeldixClient ${clientMod.modVersion} über Heldix Loader ${bridge.version} (als Fabric-Mod)`);
      }
    }
    await syncManagedMods(modsDir, managed, onProgress);
    // Konflikte vor dem Start lösen, statt dass Fabric mit "Incompatible mods found!" abbricht
    for (const note of await fixFabricConflicts(gameDir)) info(note);
  }

  const classpath = [...new Set([...libraries.filter((l) => l.classpath).map((l) => l.spec.dest), clientJar])];
  const javaMajor = options.javaOverride?.trim() ? null : (version.javaVersion?.majorVersion ?? 8);
  return { version, javaPath, classpath, gameDir, nativesDir, legacyAssetsDir, loggingConfig, clientModLoaded, loaderJvmArgs, loaderVersion, clientJar, javaMajor };
}
