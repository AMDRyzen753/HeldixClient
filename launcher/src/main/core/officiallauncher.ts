// Offizieller Minecraft Launcher: Installation „HeldixClient“ einrichten und den Launcher öffnen.
//
// Die Installation ist eine eigene Version (versions/heldixclient), die von einer vorhandenen Vanilla-Version erbt –
// so muss der offizielle Launcher nichts herunterladen und gibt der Brücke dieselben Anmeldedaten wie Minecraft.
// Nur die Hauptklasse ist die Brücke (mod/launcher-bridge). Sie reicht die Anmeldung an HeldixClient weiter.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exists, readJson, writeJson } from './fsutil';

export const OFFICIAL_PROFILE_ID = 'heldixclient';
export const OFFICIAL_VERSION_ID = 'heldixclient';
export const OFFICIAL_PROFILE_NAME = 'HeldixClient';
const BRIDGE_MAIN_CLASS = 'dev.heldixclient.bridge.Bridge';
/** Die Brücke braucht kaum Speicher */
const BRIDGE_JAVA_ARGS = '-Xmx128M -XX:+UseSerialGC';

/** Minecraft Launcher aus dem Microsoft Store / der Xbox-App */
const STORE_PACKAGE = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe';
const STORE_APP_ID = `${STORE_PACKAGE}!Minecraft`;

/** Leere JAR (nur das Ende-Verzeichnis einer ZIP-Datei), wie sie auch der Fabric-Installer anlegt */
const EMPTY_JAR = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]);

/** Spielordner des offiziellen Launchers */
export function officialMinecraftDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), '.minecraft');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'minecraft');
  return path.join(home, '.minecraft');
}

function classicLauncherPaths(): string[] {
  if (process.platform !== 'win32') return [];
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')];
  return roots.filter((r): r is string => Boolean(r)).map((root) => path.join(root, 'Minecraft Launcher', 'MinecraftLauncher.exe'));
}

async function storeLauncherInstalled(): Promise<boolean> {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return false;
  return exists(path.join(process.env.LOCALAPPDATA, 'Packages', STORE_PACKAGE));
}

async function classicLauncher(): Promise<string | null> {
  for (const file of classicLauncherPaths()) if (await exists(file)) return file;
  return null;
}

/** Läuft der offizielle Launcher gerade? (Er liest neue Installationen nur beim Start.) */
export function officialLauncherRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
      // Minecraft.exe = Store-Launcher, MinecraftLauncher.exe = klassischer Launcher (Bedrock heißt Minecraft.Windows.exe)
      resolve(!error && /^"(Minecraft|MinecraftLauncher)\.exe"/im.test(stdout));
    });
  });
}

/** Öffnet den offiziellen Minecraft Launcher. */
export async function openOfficialLauncher(): Promise<void> {
  const detach = { detached: true, stdio: 'ignore' as const, windowsHide: false };
  if (process.platform === 'win32') {
    if (await storeLauncherInstalled()) {
      spawn('explorer.exe', [`shell:AppsFolder\\${STORE_APP_ID}`], detach).unref();
      return;
    }
    const classic = await classicLauncher();
    if (classic) {
      spawn(classic, [], detach).unref();
      return;
    }
    throw new Error('Der offizielle Minecraft Launcher wurde nicht gefunden. Du bekommst ihn auf minecraft.net.');
  }
  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Minecraft'], detach).unref();
    return;
  }
  const child = spawn('minecraft-launcher', [], detach);
  child.on('error', () => undefined);
  child.unref();
}

interface VersionFile {
  id: string;
  type?: string;
  releaseTime?: string;
  inheritsFrom?: string;
  arguments?: unknown;
  downloads?: { client?: unknown };
}

/** Neueste vollständig installierte Vanilla-Version (Release vor Snapshot) als Grundlage der Installation */
async function installedParent(minecraftDir: string): Promise<VersionFile | null> {
  const versionsDir = path.join(minecraftDir, 'versions');
  const found: VersionFile[] = [];
  for (const id of await readdir(versionsDir).catch(() => [] as string[])) {
    if (id === OFFICIAL_VERSION_ID) continue;
    const json = await readJson<VersionFile>(path.join(versionsDir, id, `${id}.json`));
    if (!json || json.id !== id || json.inheritsFrom || !json.downloads?.client) continue;
    if (!(await exists(path.join(versionsDir, id, `${id}.jar`)))) continue;
    found.push(json);
  }
  const rank = (v: VersionFile) => (v.type === 'release' ? 1 : 0);
  found.sort((a, b) => rank(b) - rank(a) || (b.releaseTime ?? '').localeCompare(a.releaseTime ?? ''));
  return found[0] ?? null;
}

export interface OfficialInstallOptions {
  /** Spielordner des offiziellen Launchers (Standard: officialMinecraftDir()) */
  minecraftDir?: string;
  /** heldix-bridge-<version>.jar aus den Ressourcen */
  bridgeJar: string;
  /** bridge.json von HeldixClient (geht als -Dheldix.bridge.file an die Brücke) */
  bridgeFile: string;
  /** Bild der Installation als data:-URL */
  icon: string | null;
  /** Installation im offiziellen Launcher auswählen (lastUsed/selectedProfile) */
  select: boolean;
  /** Version, falls im offiziellen Launcher noch keine installiert ist (lädt er dann herunter) */
  fallbackParent?: string | null;
}

export interface OfficialInstallResult {
  /** Version, von der die Installation erbt */
  parent: string;
  /** Wurde etwas geändert? */
  changed: boolean;
}

/**
 * Legt die Installation „HeldixClient“ im offiziellen Launcher an oder bringt sie auf den neuesten Stand.
 * Ändert nur Dateien, deren Inhalt sich wirklich ändert.
 */
export async function installOfficialProfile(options: OfficialInstallOptions): Promise<OfficialInstallResult> {
  const dir = options.minecraftDir ?? officialMinecraftDir();
  const profilesFile = path.join(dir, 'launcher_profiles.json');
  if (!(await exists(profilesFile))) {
    throw new Error('Der offizielle Minecraft Launcher ist auf diesem PC nicht eingerichtet. Installiere ihn (minecraft.net), starte ihn einmal und melde dich dort an.');
  }
  let changed = false;

  // 1. Die Brücke als Bibliothek
  const jarName = path.basename(options.bridgeJar);
  const bridgeVersion = /^heldix-bridge-(.+)\.jar$/.exec(jarName)?.[1];
  if (!bridgeVersion) throw new Error(`Unerwarteter Name der Brücke: ${jarName}`);
  const jarBytes = await readFile(options.bridgeJar);
  const sha1 = createHash('sha1').update(jarBytes).digest('hex');
  const libraryPath = `dev/heldixclient/heldix-bridge/${bridgeVersion}/heldix-bridge-${bridgeVersion}.jar`;
  const libraryFile = path.join(dir, 'libraries', ...libraryPath.split('/'));
  const current = await readFile(libraryFile).catch(() => null);
  if (!current || createHash('sha1').update(current).digest('hex') !== sha1) {
    await mkdir(path.dirname(libraryFile), { recursive: true });
    await copyFile(options.bridgeJar, libraryFile);
    changed = true;
  }

  // 2. Die Version „heldixclient“, erbt von einer installierten Vanilla-Version
  const parent = await installedParent(dir);
  const parentId = parent?.id ?? options.fallbackParent;
  if (!parentId) throw new Error('Im offiziellen Minecraft Launcher ist noch keine Minecraft-Version installiert. Starte dort einmal Minecraft und versuch es dann noch mal.');
  const versionDir = path.join(dir, 'versions', OFFICIAL_VERSION_ID);
  const version: Record<string, unknown> = {
    id: OFFICIAL_VERSION_ID,
    inheritsFrom: parentId,
    type: 'release',
    time: '2026-11-25T00:00:00+00:00',
    releaseTime: '2026-11-25T00:00:00+00:00',
    mainClass: BRIDGE_MAIN_CLASS,
    libraries: [{
      name: `dev.heldixclient:heldix-bridge:${bridgeVersion}`,
      downloads: { artifact: { path: libraryPath, sha1, size: jarBytes.length, url: pathToFileURL(options.bridgeJar).href } },
    }],
  };
  // Neuere Versionen (ab 1.13) übergeben JVM-Argumente: der Pfad zu bridge.json. Ältere nutzen den Standard-Datenordner.
  if (!parent || parent.arguments) version.arguments = { game: [], jvm: [`-Dheldix.bridge.file=${options.bridgeFile}`] };
  const versionFile = path.join(versionDir, `${OFFICIAL_VERSION_ID}.json`);
  if (JSON.stringify(await readJson(versionFile)) !== JSON.stringify(version)) {
    await writeJson(versionFile, version);
    changed = true;
  }
  const dummyJar = path.join(versionDir, `${OFFICIAL_VERSION_ID}.jar`);
  if (!(await exists(dummyJar))) {
    await writeFile(dummyJar, EMPTY_JAR);
    changed = true;
  }

  // 3. Die Installation in den Profil-Dateien (Store-Launcher: zusätzlich eine eigene Datei, falls vorhanden)
  const files = [profilesFile];
  const storeFile = path.join(dir, 'launcher_profiles_microsoft_store.json');
  if (await exists(storeFile)) files.push(storeFile);
  const now = new Date().toISOString();
  for (const file of files) {
    const data = await readJson<{ profiles?: Record<string, Record<string, unknown>>; selectedProfile?: string; settings?: { versionFilter?: { custom?: boolean } } }>(file);
    if (!data) throw new Error(`${path.basename(file)} des Minecraft Launchers ist beschädigt. Starte den Minecraft Launcher einmal, dann klappt es.`);
    const before = JSON.stringify(data);
    data.profiles ??= {};
    const existing = data.profiles[OFFICIAL_PROFILE_ID] ?? {};
    data.profiles[OFFICIAL_PROFILE_ID] = {
      ...existing,
      name: OFFICIAL_PROFILE_NAME,
      type: 'custom',
      lastVersionId: OFFICIAL_VERSION_ID,
      icon: options.icon ?? existing.icon ?? 'Grass',
      javaArgs: BRIDGE_JAVA_ARGS,
      created: existing.created ?? now,
      lastUsed: options.select ? now : (existing.lastUsed ?? now),
    };
    if (options.select) data.selectedProfile = OFFICIAL_PROFILE_ID;
    // „Mit Mods“ ausgeblendet? Dann wäre die Installation unsichtbar
    if (data.settings?.versionFilter?.custom === false) data.settings.versionFilter.custom = true;
    if (JSON.stringify(data) !== before) {
      await writeJson(file, data);
      changed = true;
    }
  }
  return { parent: parentId, changed };
}

/** Ist die Installation „HeldixClient“ im offiziellen Launcher eingetragen? */
export async function officialProfileInstalled(minecraftDir = officialMinecraftDir()): Promise<boolean> {
  const data = await readJson<{ profiles?: Record<string, unknown> }>(path.join(minecraftDir, 'launcher_profiles.json'));
  return Boolean(data?.profiles?.[OFFICIAL_PROFILE_ID]);
}
