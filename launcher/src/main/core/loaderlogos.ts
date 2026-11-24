// Echte Logos für die Instanz-Kacheln: Fabric aus der Fabric-Loader-JAR, Minecraft (Vanilla) als Grasblock aus der Client-JAR.
// Beide liegen nach dem ersten Download ohnehin im Datenordner; das Repository verteilt sie nicht selbst.
import AdmZip from 'adm-zip';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LoaderLogos } from '../../shared/api';
import { downloadFile, fetchJson } from './http';
import type { LauncherPaths } from './paths';

const FABRIC_ENTRY = 'assets/fabricloader/icon.png';
/** Grasblock von vorn (ab 1.13), ältere Versionen, zur Not das Ressourcenpaket-Bild */
const MINECRAFT_ENTRIES = ['assets/minecraft/textures/block/grass_block_side.png', 'assets/minecraft/textures/blocks/grass_side.png', 'pack.png'];
/** Aktuelle Fabric-Loader-Version für den Fall, dass noch keine Fabric-Instanz gestartet wurde */
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions/loader';

function dataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function cached(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

function fromJar(jar: string, entry: string): Buffer | null {
  try {
    return new AdmZip(jar).getEntry(entry)?.getData() ?? null;
  } catch {
    return null;
  }
}

/** Neueste Datei nach Änderungszeit */
async function newest(files: string[]): Promise<string[]> {
  const withTime = await Promise.all(files.map(async (file) => ({ file, time: (await stat(file).catch(() => null))?.mtimeMs ?? 0 })));
  return withTime.filter((f) => f.time > 0).sort((a, b) => b.time - a.time).map((f) => f.file);
}

async function fabricLogo(paths: LauncherPaths, cacheDir: string): Promise<Buffer | null> {
  const dir = path.join(paths.libraries, 'net', 'fabricmc', 'fabric-loader');
  const versions = await readdir(dir).catch(() => [] as string[]);
  const jars = await newest(versions.map((v) => path.join(dir, v, `fabric-loader-${v}.jar`)));
  for (const jar of jars) {
    const png = fromJar(jar, FABRIC_ENTRY);
    if (png) return png;
  }
  // noch keine Fabric-Instanz gestartet: die aktuelle Loader-JAR einmal laden (nur in den Zwischenspeicher)
  try {
    const list = await fetchJson<{ version: string; stable: boolean }[]>(FABRIC_META);
    const version = list.find((v) => v.stable)?.version ?? list[0]?.version;
    if (!version) return null;
    const jar = path.join(cacheDir, `fabric-loader-${version}.jar`);
    await downloadFile({ url: `https://maven.fabricmc.net/net/fabricmc/fabric-loader/${version}/fabric-loader-${version}.jar`, dest: jar });
    return fromJar(jar, FABRIC_ENTRY);
  } catch {
    return null;
  }
}

async function minecraftLogo(paths: LauncherPaths): Promise<Buffer | null> {
  const versions = await readdir(paths.versions).catch(() => [] as string[]);
  const jars = await newest(versions.map((v) => path.join(paths.versions, v, `${v}.jar`)));
  for (const entry of MINECRAFT_ENTRIES) {
    for (const jar of jars) {
      const png = fromJar(jar, entry);
      if (png) return png;
    }
  }
  return null;
}

/** Logos als Daten-URLs (null = nicht vorhanden, dann zeigt die Oberfläche ein eigenes Icon) */
export async function loaderLogos(paths: LauncherPaths): Promise<LoaderLogos> {
  const cacheDir = path.join(paths.cache, 'loader-logos');
  await mkdir(cacheDir, { recursive: true });
  const load = async (name: string, find: () => Promise<Buffer | null>): Promise<string | null> => {
    const file = path.join(cacheDir, `${name}.png`);
    let png = await cached(file);
    if (!png) {
      png = await find();
      if (png) await writeFile(file, png).catch(() => undefined);
    }
    return png ? dataUrl(png) : null;
  };
  const [fabric, vanilla] = await Promise.all([load('fabric', () => fabricLogo(paths, cacheDir)), load('minecraft-grass', () => minecraftLogo(paths))]);
  return { fabric, vanilla };
}
